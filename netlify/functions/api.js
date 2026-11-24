// CEPALCO API: logins, permissions and the shared Excel data, stored in Netlify Blobs.
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const st = () => getStore("cepalco");
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const FEATS = ["dmap"], ACTS = ["view", "create", "update", "delete"];
// Accounts Mapping: View = see the map; Edit = place / move / remove pins and import pins. Create and Delete do not apply.
const NA = { dmap: ["create", "delete"] };
// Accounts masterlist: same columns, same order as sheet "MONITORING FOR CODE". s=text, n=number, d=date (YYYY-MM-DD), x=number or text
const COLS = [["CUSTOMER TYPE","s"],["BILLING","s"],["DN/ODAA","s"],["JOB-ORDER","s"],["CLN","s"],["SUB-AREA","s"],["CUSTOMER NAME","s"],["AREA","x"],["RATE SCHED","x"],["CONTRACT NO.","n"],["MONTHS UNPAID","n"],["DUE DATE","d"],["PAYMENT DATE","d"],["REMAINING BALANCE","n"],["SMS","s"],["EMAIL","s"],["FIELD REMARKS","s"],["PHONE NO.","s"],["EMAIL ADDRESS","s"],["Contact Person","s"]];
const row = v => ({ view: v ? 1 : 0, create: 0, update: 0, delete: 0 });
// Guests start with NO access. The admin can tick View for Guest on the Admin page if a read-only guest login is wanted.
const defGuest = () => ({ dmap: row(0) });
// Password rules (new and reset passwords): at least 8 characters and not an obvious one.
const pwBad = (p, u) => { p = String(p || ""); if (p.length < 8) return "Password needs at least 8 characters"; if (p.toLowerCase() === String(u || "").toLowerCase() || /^(admin|password|12345678|cepalco\d*)$/i.test(p)) return "That password is too easy to guess"; return null; };
const hash = (p, salt) => crypto.scryptSync(p, salt, 32).toString("hex");
const mkUser = (u, p, role) => { const salt = crypto.randomBytes(16).toString("hex"); return { u, salt, h: hash(p, salt), role }; };

// Speed: the signing secret never changes, so keep it in memory; users/permissions and the account list are kept for a few seconds
// (writes always re-read the account list first, so edits never overwrite each other with stale data).
let _k = null, _db = null, _dbAt = 0, _acc = null, _accAt = 0;
const FRESH = 5000;
async function loadDb() {
  if (_db && Date.now() - _dbAt < FRESH) return _db;
  const s = st(); let db = await s.get("db", { type: "json" });
  if (!db) { db = { users: [mkUser("admin", process.env.ADMIN_PASSWORD || "admin", "admin")], perms: { guest: defGuest() } }; await s.setJSON("db", db); }
  _db = db; _dbAt = Date.now(); return db;
}
async function secret() {
  if (_k) return _k;
  const s = st(); let k = await s.get("secret");
  if (!k) { k = crypto.randomBytes(32).toString("hex"); await s.set("secret", k); }
  return (_k = k);
}
const sign = (b, k) => crypto.createHmac("sha256", k).update(b).digest("base64url");
const mk = (o, k) => { const b = Buffer.from(JSON.stringify(o)).toString("base64url"); return b + "." + sign(b, k); };
function ver(t, k) {
  try {
    const [b, s] = String(t || "").split("."); if (!b || !s) return null;
    const e = sign(b, k); if (s.length !== e.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e))) return null;
    const o = JSON.parse(Buffer.from(b, "base64url").toString()); return o.x > Date.now() ? o : null;
  } catch { return null; }
}
const who = (tok, db) => !tok ? null : tok.role === "guest" ? { u: "guest", role: "guest" } : (db.users.find(y => y.u === tok.u && y.role === tok.role) ? { u: tok.u, role: tok.role, must: !!tok.m } : null);
const can = (me, db, f, a = "view") => me.role === "admin" || !!(db.perms[me.role === "guest" ? "guest" : me.u]?.[f]?.[a]);
const permsOf = (me, db) => me.role === "admin" ? Object.fromEntries(FEATS.map(f => [f, { view: 1, create: 1, update: 1, delete: 1 }])) : (db.perms[me.role === "guest" ? "guest" : me.u] || defGuest());
const session = (me, db, k) => ({ t: mk({ u: me.u, role: me.role, x: Date.now() + 12 * 36e5, m: me.must ? 1 : 0 }, k), u: me.u, role: me.role, must: me.must ? 1 : 0, perms: permsOf(me, db) });

// ---- sign-in log (who signed in / out / failed, and when) ----
const SIGN_MAX = 1000;
const clientIp = req => String(req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "?").split(",")[0].trim().slice(0, 45);
async function signlog(s, req, u, ev) {
  try {
    const l = (await s.get("signins", { type: "json" })) || [];
    l.push({ t: Date.now(), u: String(u || "").slice(0, 40), e: ev, ip: clientIp(req) });
    await s.setJSON("signins", l.slice(-SIGN_MAX));
  } catch { /* the sign-in log must never block a login */ }
}

// ---- accounts data ----
const r2 = v => Math.round(v * 100) / 100;
function coerce(k, t, v) {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  if (t === "s") return String(v).trim();
  if (t === "d") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v).trim()), d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (!d || d.getUTCMonth() !== +m[2] - 1) throw new Error("Invalid date in " + k + " (use YYYY-MM-DD)");
    return m[0];
  }
  const n = typeof v === "number" ? v : Number(String(v).replace(/[\u20B1,\s]/g, ""));
  if (Number.isFinite(n)) return t === "n" ? r2(n) : n;
  if (t === "x") return String(v).trim();
  throw new Error("Invalid number in " + k);
}
// REMAINING BALANCE is the only money column: it is typed / loaded as is (no arrears, bill, total or paid columns any more).
function norm(o, id) {
  const r = { _id: id };
  for (const [k, t] of COLS) r[k] = coerce(k, t, o[k]);
  return r;
}
const newId = () => crypto.randomBytes(6).toString("hex");
const loadAcc = async s => { const a = (await s.get("accounts", { type: "json" })) || { n: "", r: [], at: 0 }; _acc = a; _accAt = Date.now(); return a; };
const readAcc = async s => (_acc && Date.now() - _accAt < FRESH) ? _acc : loadAcc(s);   // read-only views may use the short-lived copy
const saveAcc = async (s, a) => { a.at = Date.now(); await s.setJSON("accounts", a); _acc = a; _accAt = Date.now(); };
const canAnyAcc = (me, db) => ["create", "update", "delete"].some(x => can(me, db, "accounts", x));
// ---- change log (who changed what) ----
const AUDIT_MAX = 2000;
const short = v => v === null || v === undefined ? "" : String(v).slice(0, 60);
const diff = (o, n) => COLS.map(([k]) => k).filter(k => (o[k] ?? null) !== (n[k] ?? null)).slice(0, 12).map(k => [k, short(o[k]), short(n[k])]);
async function audit(s, me, act, rec, d) {
  try {
    const l = (await s.get("audit", { type: "json" })) || [];
    l.push({ t: Date.now(), u: me.u, a: act, id: rec ? rec._id : null, n: rec ? short(rec["CUSTOMER NAME"]) : "", cn: rec ? short(rec["CONTRACT NO."]) : "", d: d || null });
    await s.setJSON("audit", l.slice(-AUDIT_MAX));
  } catch { /* the change log must never block an edit */ }
}
// ---- backups of the whole account list (kept before Load Excel and before a restore) ----
const BK_KEEP = 8;
async function backup(s, label) {
  const cur = await s.get("accounts", { type: "json" }); if (!cur || !Array.isArray(cur.r) || !cur.r.length) return null;
  const idx = (await s.get("backups_idx", { type: "json" })) || [], key = "backup-" + Date.now() + "-" + newId();
  await s.setJSON(key, cur); idx.push({ key, t: Date.now(), label, count: cur.r.length, n: cur.n || "" });
  while (idx.length > BK_KEEP) { const o = idx.shift(); try { await s.delete(o.key); } catch { } }
  await s.setJSON("backups_idx", idx); return key;
}
const bad = e => J({ e: e.message || "Invalid data" }, 400);

// ---- Accounts Mapping: pin locations are stored by contract no. + customer name (not by row id), so they survive Load Excel ----
const keyCn = v => String(v ?? "").trim().replace(/\.0+$/, "");
const keyNm = v => String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const geoKey = x => keyCn(x["CONTRACT NO."]) + "|" + keyNm(x["CUSTOMER NAME"]);
const loadGeo = async s => { const g = (await s.get("geo", { type: "json" })) || {}; g.p = g.p || {}; return g; };
const okLL = (la, ln) => Number.isFinite(la) && Number.isFinite(ln) && la >= -90 && la <= 90 && ln >= -180 && ln <= 180 && !(la === 0 && ln === 0);

export default async (req) => {
  if (req.method !== "POST") return J({ e: "POST only" }, 405);
  let b; try { b = await req.json(); } catch { return J({ e: "Bad request" }, 400); }
  const [db, k] = await Promise.all([loadDb(), secret()]), s = st(), a = b.a;

  if (a === "login") {
    const u = String(b.u || "").trim().toLowerCase(), x = db.users.find(y => y.u === u);
    // Throttle: 5 wrong passwords from the same address for the same username locks that pair for 15 minutes.
    const ip = String(req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "?").split(",")[0].trim(), fk = ip + "|" + u.slice(0, 40), now = Date.now();
    const fails = (await s.get("fails", { type: "json" })) || {}, f = fails[fk];
    if (f && f.until > now) return J({ e: "Too many wrong sign-ins. Try again in " + Math.ceil((f.until - now) / 60000) + " minute(s)." }, 429);
    const okPw = !!x && crypto.timingSafeEqual(Buffer.from(hash(String(b.p || ""), x.salt)), Buffer.from(x.h));
    if (!okPw) {
      for (const k of Object.keys(fails)) if ((fails[k].until || 0) < now && now - (fails[k].last || 0) > 36e5) delete fails[k];
      const n = ((f && !(f.until && f.until <= now)) ? f.n || 0 : 0) + 1;
      fails[fk] = n >= 5 ? { n: 0, until: now + 15 * 6e4, last: now } : { n, until: 0, last: now };
      if (Object.keys(fails).length > 500) for (const k of Object.keys(fails).slice(0, 100)) delete fails[k];
      await s.setJSON("fails", fails);
      await signlog(s, req, u, n >= 5 ? "locked" : "failed");
      return J({ e: "Wrong username or password." }, 401);
    }
    if (f) { delete fails[fk]; await s.setJSON("fails", fails); }
    await signlog(s, req, u, "login");
    // A weak or default password (like admin/admin) works only to reach the "choose a new password" step.
    return J(session({ u, role: x.role, must: !!pwBad(b.p, u) }, db, k));
  }
  if (a === "guest") { await signlog(s, req, "guest", "login"); return J(session({ u: "guest", role: "guest" }, db, k)); }

  const me = who(ver(b.t, k), db);
  if (!me) return J({ e: "Please sign in again." }, 401);
  const save = async () => { await s.setJSON("db", db); _db = db; _dbAt = Date.now(); };
  if (a === "me") return J(session(me, db, k));
  if (a === "logout") { await signlog(s, req, me.u, "logout"); return J({ ok: 1 }); }
  if (a === "chpw") {
    const x = me.role === "guest" ? null : db.users.find(y => y.u === me.u); if (!x) return J({ e: "Guests have no password" }, 400);
    const o = String(b.o || ""), np = String(b.p || "");
    if (!crypto.timingSafeEqual(Buffer.from(hash(o, x.salt)), Buffer.from(x.h))) return J({ e: "The current password is wrong" }, 401);
    const m = pwBad(np, me.u) || (np === o ? "Choose a password different from the current one" : null); if (m) return J({ e: m }, 400);
    Object.assign(x, mkUser(me.u, np, x.role)); await save(); return J(session({ u: me.u, role: x.role }, db, k));
  }
  if (me.must) return J({ e: "Please choose a new password before continuing.", must: 1 }, 403);

  // Full account list: admin only (feeds Admin > Download Excel). Everyone else only ever receives the map data (dmap_get).
  if (a === "getdata") {
    if (me.role !== "admin") return J({ e: "Not allowed" }, 403);
    const d = await readAcc(s);
    return J({ n: d.n, at: d.at, cols: COLS, r: d.r });
  }
  // Accounts Mapping: all accounts (delinquent / partially paid / fully paid / unbilled), plus where each one is pinned. Phone numbers are included for everyone who may open the map.
  if (a === "dmap_get") {
    if (!can(me, db, "dmap")) return J({ e: "Not allowed" }, 403);
    const d = await readAcc(s), g = await loadGeo(s), withPhone = true;
    // s = status: 0 delinquent (balance left, no payment date), 1 partially paid (balance left and a payment date or "partial" in DN/ODAA), 2 fully paid (no balance and a payment date / PAID in DN/ODAA), 3 unbilled (no balance, nothing paid). Every account is sent; the page splits them into tabs.
    const nn = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
    const r = d.r.filter(x => x["CUSTOMER NAME"]).map(x => {
      const R = nn(x["REMAINING BALANCE"]), dnu = String(x["DN/ODAA"] || "").toUpperCase(), pay = !!x["PAYMENT DATE"], s = R > 0 ? (pay || dnu.includes("PARTIAL") ? 1 : 0) : (R < 0 || pay || dnu.includes("PAID") ? 2 : 3);
      const p = g.p[geoKey(x)];
      return { s, pd: x["PAYMENT DATE"] || "", id: x._id, name: x["CUSTOMER NAME"], cn: x["CONTRACT NO."], area: x["AREA"] ?? "", sub: x["SUB-AREA"] || "", type: x["CUSTOMER TYPE"] || "", m: x["MONTHS UNPAID"], d: x["DUE DATE"] || "", b: Math.max(0, R), dn: x["DN/ODAA"] || "", jo: x["JOB-ORDER"] || "", ...(p ? { la: p.la, ln: p.ln } : {}), ...(withPhone ? { p: x["PHONE NO."] || "" } : {}) };
    });
    return J({ v: 2, r, at: d.at || 0, canEdit: can(me, db, "dmap", "update") });
  }
  // One account ({id, la, ln}; la empty = remove the pin) or a batch from an imported file ({items: [{cn, name, la, ln}]}, matched to accounts by contract no. / name).
  if (a === "dmap_set") {
    if (!can(me, db, "dmap", "update")) return J({ e: "You do not have permission to place pins" }, 403);
    const d = await loadAcc(s), g = await loadGeo(s), t = Date.now();
    if (b.id) {
      const x = d.r.find(y => y._id === b.id); if (!x) return J({ e: "Account not found (it may have been deleted)" }, 404);
      if (b.la === null || b.la === undefined || b.la === "") { delete g.p[geoKey(x)]; await s.setJSON("geo", g); await audit(s, me, "map pin removed", x, null); return J({ ok: 1 }); }
      const la = Number(b.la), ln = Number(b.ln); if (!okLL(la, ln)) return J({ e: "That is not a valid location" }, 400);
      g.p[geoKey(x)] = { la: Math.round(la * 1e6) / 1e6, ln: Math.round(ln * 1e6) / 1e6, t, u: me.u };
      await s.setJSON("geo", g); await audit(s, me, "map pin set", x, null); return J({ ok: 1, la: g.p[geoKey(x)].la, ln: g.p[geoKey(x)].ln });
    }
    const items = Array.isArray(b.items) ? b.items.slice(0, 1000) : [];
    const byCn = new Map(), byNm = new Map();
    for (const y of d.r) { const c = keyCn(y["CONTRACT NO."]), n = keyNm(y["CUSTOMER NAME"]); if (c) (byCn.get(c) || byCn.set(c, []).get(c)).push(y); if (n) (byNm.get(n) || byNm.set(n, []).get(n)).push(y); }
    let n = 0, bad = 0; const miss = [];
    for (const it of items) {
      const la = Number(it && it.la), ln = Number(it && it.ln); if (!okLL(la, ln)) { bad++; continue; }
      const nmk = keyNm(it.name);
      // try the contract number first, then any other long number found in the placemark (alt), then the exact customer name
      let l = null;
      for (const c of [it.cn, ...(Array.isArray(it.alt) ? it.alt.slice(0, 6) : [])]) { const h = byCn.get(keyCn(c)); if (h) { l = h; break; } }
      if (l) { const same = l.filter(y => keyNm(y["CUSTOMER NAME"]) === nmk); if (same.length) l = same; }   // shared contract numbers: prefer the same customer name
      else { const nm = byNm.get(nmk); if (nm && new Set(nm.map(geoKey)).size === 1) l = nm; }          // no contract number: accept a name that identifies exactly one account
      if (!l) { if (miss.length < 30) miss.push(String(it.name || it.cn || "?").slice(0, 60)); continue; }
      for (const k of new Set(l.map(geoKey))) g.p[k] = { la: Math.round(la * 1e6) / 1e6, ln: Math.round(ln * 1e6) / 1e6, t, u: me.u };
      n++;
    }
    if (n) { await s.setJSON("geo", g); await audit(s, me, "map import", null, [["pins", "", String(n)]]); }
    return J({ ok: 1, saved: n, invalid: bad, missing: miss });
  }
  if (me.role !== "admin") return J({ e: "Admin only" }, 403);
  const pw = String(b.p || ""), u = String(b.u || "").trim().toLowerCase();

  if (a === "putdata") {
    if (!Array.isArray(b.r)) return J({ e: "No rows" }, 400);
    let r; try { r = b.r.filter(x => x && (x["CUSTOMER NAME"] || x["CONTRACT NO."])).map(x => norm(x, newId())); } catch (e) { return bad(e); }
    const bk = await backup(s, "Before Load Excel (" + me.u + ")");   // the old list is kept so a wrong upload can be undone
    await saveAcc(s, { n: String(b.n || "masterlist"), r }); await audit(s, me, "load excel", null, [["rows", "", String(r.length)], ["file", "", short(b.n)]]);
    await s.delete("rows"); await s.delete("file"); // old formats, no longer used
    return J({ ok: 1, count: r.length, backedUp: !!bk });
  }
  if (a === "signin_get") { const l = (await s.get("signins", { type: "json" })) || []; return J({ l: l.slice(-500).reverse() }); }
  if (a === "audit_get") { const l = (await s.get("audit", { type: "json" })) || []; return J({ l: l.slice(-500).reverse() }); }
  if (a === "backups") return J({ l: ((await s.get("backups_idx", { type: "json" })) || []).slice().reverse() });
  if (a === "backup_now") { const key = await backup(s, "Manual backup (" + me.u + ")"); return key ? J({ ok: 1 }) : J({ e: "Nothing to back up yet" }, 400); }
  if (a === "backup_restore") {
    const idx = (await s.get("backups_idx", { type: "json" })) || [], e = idx.find(y => y.key === b.key); if (!e) return J({ e: "Backup not found" }, 404);
    const snap = await s.get(e.key, { type: "json" }); if (!snap || !Array.isArray(snap.r)) return J({ e: "That backup file is missing" }, 404);
    await backup(s, "Before restoring a backup (" + me.u + ")");
    await saveAcc(s, { n: snap.n || "restored", r: snap.r }); await audit(s, me, "restore backup", null, [["rows", "", String(snap.r.length)], ["from", "", new Date(e.t).toISOString().slice(0, 16)]]);
    return J({ ok: 1, count: snap.r.length });
  }
  if (a === "users") return J({ users: db.users.map(({ u, role }) => ({ u, role })), perms: db.perms });
  if (a === "adduser") {
    if (!/^[a-z0-9._-]{3,20}$/.test(u)) return J({ e: "Username: 3-20 letters, numbers, . _ -" }, 400);
    if (u === "guest" || db.users.some(x => x.u === u)) return J({ e: "That username is taken" }, 400);
    { const m = pwBad(pw, u); if (m) return J({ e: m }, 400); }
    db.users.push(mkUser(u, pw, "user")); db.perms[u] = JSON.parse(JSON.stringify(db.perms.guest)); await save(); return J({ ok: 1 });
  }
  if (a === "setpw") {
    const x = db.users.find(y => y.u === u); if (!x) return J({ e: "No such user" }, 404);
    { const m = pwBad(pw, u); if (m) return J({ e: m }, 400); }
    Object.assign(x, mkUser(u, pw, x.role)); await save(); return J({ ok: 1 });
  }
  if (a === "deluser") {
    const x = db.users.find(y => y.u === u); if (!x || x.role === "admin") return J({ e: "Cannot delete that user" }, 400);
    db.users = db.users.filter(y => y !== x); delete db.perms[u]; await save(); return J({ ok: 1 });
  }
  if (a === "setperm") {
    const key = String(b.k || ""); if (key !== "guest" && !db.users.some(x => x.u === key && x.role === "user")) return J({ e: "No such user" }, 404);
    if (!FEATS.includes(b.f) || !ACTS.includes(b.x) || (NA[b.f] || []).includes(b.x)) return J({ e: "Bad permission" }, 400);
    const p = db.perms[key] = db.perms[key] || defGuest(); (p[b.f] = p[b.f] || row(0))[b.x] = b.v ? 1 : 0; await save(); return J({ ok: 1 });
  }
  return J({ e: "Unknown action" }, 400);
};
export const config = { path: "/api" };
