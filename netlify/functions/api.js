// CEPALCO Map API: logins, permissions and the map places (from an uploaded KML), stored in Netlify Blobs.
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const st = () => getStore("cepalco");
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const FEATS = ["dmap"], ACTS = ["view", "create", "update", "delete"];
// Map: View = see the map; Edit = upload a KML, move and remove pins. Create and Delete do not apply.
const NA = { dmap: ["create", "delete"] };
const row = v => ({ view: v ? 1 : 0, create: 0, update: 0, delete: 0 });
// Guests start with NO access. The admin can tick View for Guest on the Admin page if a read-only guest login is wanted.
const defGuest = () => ({ dmap: row(0) });
// Password rules (new and reset passwords): at least 8 characters and not an obvious one.
const pwBad = (p, u) => { p = String(p || ""); if (p.length < 8) return "Password needs at least 8 characters"; if (p.toLowerCase() === String(u || "").toLowerCase() || /^(admin|password|12345678|cepalco\d*)$/i.test(p)) return "That password is too easy to guess"; return null; };
const hash = (p, salt) => crypto.scryptSync(p, salt, 32).toString("hex");
const mkUser = (u, p, role) => { const salt = crypto.randomBytes(16).toString("hex"); return { u, salt, h: hash(p, salt), role }; };

// Speed: the signing secret never changes, so keep it in memory; users/permissions and the account list are kept for a few seconds
// (writes always re-read the place list first, so edits never overwrite each other with stale data).
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

// ---- map places (loaded from a KML file) ----
// place = { id, n: name, c: category (KML folder), d: description, f: {extra fields}, la, ln }
const newId = () => crypto.randomBytes(6).toString("hex");
const clip = (v, n) => String(v ?? "").replace(/\u0000/g, "").trim().slice(0, n);
const keyNm = v => String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const rnd = v => Math.round(v * 1e6) / 1e6;
const okLL = (la, ln) => Number.isFinite(la) && Number.isFinite(ln) && la >= -90 && la <= 90 && ln >= -180 && ln <= 180 && !(la === 0 && ln === 0);
const MAX_PLACES = 30000;
function normPlace(it) {
  const la = Number(it && it.la), ln = Number(it && it.ln); if (!okLL(la, ln)) return null;
  const f = {}; if (it.f && typeof it.f === "object") for (const [k, v] of Object.entries(it.f).slice(0, 15)) { const kk = clip(k, 40), vv = clip(v, 200); if (kk && vv) f[kk] = vv; }
  return { id: newId(), n: clip(it.n, 200) || "Unnamed", c: clip(it.c, 80), d: clip(it.d, 1500), f, la: rnd(la), ln: rnd(ln) };
}
const pkey = p => keyNm(p.n) + "|" + p.la + "|" + p.ln;
const loadPlaces = async s => { const a = (await s.get("places", { type: "json" })) || { n: "", r: [], at: 0 }; if (!Array.isArray(a.r)) a.r = []; _acc = a; _accAt = Date.now(); return a; };
const readPlaces = async s => (_acc && Date.now() - _accAt < FRESH) ? _acc : loadPlaces(s);   // read-only views may use the short-lived copy
const savePlaces = async (s, a) => { a.at = Date.now(); await s.setJSON("places", a); _acc = a; _accAt = Date.now(); };
// ---- change log (who changed what) ----
const AUDIT_MAX = 2000;
const short = v => v === null || v === undefined ? "" : String(v).slice(0, 60);
async function audit(s, me, act, rec, d) {
  try {
    const l = (await s.get("audit", { type: "json" })) || [];
    l.push({ t: Date.now(), u: me.u, a: act, id: rec ? rec.id : null, n: rec ? short(rec.n) : "", cn: rec ? short(rec.c) : "", d: d || null });
    await s.setJSON("audit", l.slice(-AUDIT_MAX));
  } catch { /* the change log must never block an edit */ }
}
// ---- backups of the whole place list (kept before an upload and before a restore) ----
const BK_KEEP = 8;
async function backup(s, label) {
  const cur = await s.get("places", { type: "json" }); if (!cur || !Array.isArray(cur.r) || !cur.r.length) return null;
  const idx = (await s.get("backups_idx", { type: "json" })) || [], key = "backup-" + Date.now() + "-" + newId();
  await s.setJSON(key, cur); idx.push({ key, t: Date.now(), label, count: cur.r.length, n: cur.n || "" });
  while (idx.length > BK_KEEP) { const o = idx.shift(); try { await s.delete(o.key); } catch { } }
  await s.setJSON("backups_idx", idx); return key;
}

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

  // Map: every place with its category, description and extra fields. Everyone who may open the map receives it.
  if (a === "map_get") {
    if (!can(me, db, "dmap")) return J({ e: "Not allowed" }, 403);
    const d = await readPlaces(s);
    return J({ v: 3, r: d.r, at: d.at || 0, n: d.n || "", canEdit: can(me, db, "dmap", "update") });
  }
  // Upload from a KML: {mode: "replace" | "add", first, last, total, n: file name, items: [{n, c, d, f, la, ln}]}. Sent in chunks (first = first chunk).
  if (a === "map_put") {
    if (!can(me, db, "dmap", "update")) return J({ e: "You do not have permission to upload" }, 403);
    const mode = b.mode === "replace" ? "replace" : "add", items = Array.isArray(b.items) ? b.items.slice(0, 500) : [];
    let d = await loadPlaces(s), backedUp = false;
    if (b.first) {
      backedUp = !!(await backup(s, (mode === "replace" ? "Before replacing the map (" : "Before adding to the map (") + me.u + ")"));   // the old list is kept so a wrong upload can be undone
      if (mode === "replace") d = { n: clip(b.n, 120) || "upload", r: [], at: 0 }; else d.n = d.n || clip(b.n, 120);
    }
    const seen = new Set(d.r.map(pkey)); let saved = 0, dup = 0, invalid = 0;
    for (const it of items) {
      const p = normPlace(it); if (!p) { invalid++; continue; }
      if (seen.has(pkey(p))) { dup++; continue; }
      if (d.r.length >= MAX_PLACES) return J({ e: "The map is limited to " + MAX_PLACES + " places" }, 400);
      seen.add(pkey(p)); d.r.push(p); saved++;
    }
    await savePlaces(s, d);
    if (b.last) await audit(s, me, mode === "replace" ? "upload kml (replace)" : "upload kml (add)", null, [["places", "", String(Number(b.total) || saved)], ["file", "", short(b.n)]]);
    return J({ ok: 1, saved, dup, invalid, total: d.r.length, backedUp });
  }
  // Move a pin ({id, la, ln}) or remove it (map_del {id}).
  if (a === "map_move") {
    if (!can(me, db, "dmap", "update")) return J({ e: "You do not have permission to move pins" }, 403);
    const d = await loadPlaces(s), x = d.r.find(y => y.id === b.id); if (!x) return J({ e: "Place not found (it may have been removed)" }, 404);
    const la = Number(b.la), ln = Number(b.ln); if (!okLL(la, ln)) return J({ e: "That is not a valid location" }, 400);
    x.la = rnd(la); x.ln = rnd(ln); await savePlaces(s, d); await audit(s, me, "map pin moved", x, null); return J({ ok: 1, la: x.la, ln: x.ln });
  }
  if (a === "map_del") {
    if (!can(me, db, "dmap", "update")) return J({ e: "You do not have permission to remove pins" }, 403);
    const d = await loadPlaces(s), x = d.r.find(y => y.id === b.id); if (!x) return J({ e: "Place not found (it may have been removed)" }, 404);
    d.r = d.r.filter(y => y !== x); await savePlaces(s, d); await audit(s, me, "map pin removed", x, null); return J({ ok: 1 });
  }
  if (me.role !== "admin") return J({ e: "Admin only" }, 403);
  const pw = String(b.p || ""), u = String(b.u || "").trim().toLowerCase();

  if (a === "signin_get") { const l = (await s.get("signins", { type: "json" })) || []; return J({ l: l.slice(-500).reverse() }); }
  if (a === "audit_get") { const l = (await s.get("audit", { type: "json" })) || []; return J({ l: l.slice(-500).reverse() }); }
  if (a === "backups") return J({ l: ((await s.get("backups_idx", { type: "json" })) || []).slice().reverse() });
  if (a === "backup_now") { const key = await backup(s, "Manual backup (" + me.u + ")"); return key ? J({ ok: 1 }) : J({ e: "Nothing to back up yet" }, 400); }
  if (a === "backup_restore") {
    const idx = (await s.get("backups_idx", { type: "json" })) || [], e = idx.find(y => y.key === b.key); if (!e) return J({ e: "Backup not found" }, 404);
    const snap = await s.get(e.key, { type: "json" }); if (!snap || !Array.isArray(snap.r)) return J({ e: "That backup file is missing" }, 404);
    await backup(s, "Before restoring a backup (" + me.u + ")");
    await savePlaces(s, { n: snap.n || "restored", r: snap.r }); await audit(s, me, "restore backup", null, [["rows", "", String(snap.r.length)], ["from", "", new Date(e.t).toISOString().slice(0, 16)]]);
    return J({ ok: 1, count: snap.r.length });
  }
  if (a === "users") return J({ users: db.users.map(({ u, role }) => ({ u, role })), perms: db.perms });
  if (a === "adduser") {
    if (!/^[a-z0-9._-]{3,20}$/.test(u)) return J({ e: "Username: 3-20 letters, numbers, . _ -" }, 400);
    if (u === "guest" || db.users.some(x => x.u === u)) return J({ e: "That username is taken" }, 400);
    { const m = pwBad(pw, u); if (m) return J({ e: m }, 400); }
    db.users.push(mkUser(u, pw, "user")); db.perms[u] = { dmap: row(1) }; await save(); return J({ ok: 1 });
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
