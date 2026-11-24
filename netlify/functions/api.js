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
// place = { id, n: name, c: category (KML folder), d: description, f: {extra fields}, la, ln }   (empty c / d / f are left out)
// Large maps (70,000+ places) are stored in shards of up to 1000 places each, so no single read, write or response gets too big:
//   "pidx"  = { n: file name, at, sh: [{ i: shard id (first 6 characters of every place id in it), k: blob key, c: count }] }
//   "ps-<k>" = the places of one shard      "pkeys" = short hashes of name + location (to skip duplicates when adding)
const newId = () => crypto.randomBytes(6).toString("hex");
const clip = (v, n) => String(v ?? "").replace(/\u0000/g, "").trim().slice(0, n);
const keyNm = v => String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const rnd = v => Math.round(v * 1e6) / 1e6;
const okLL = (la, ln) => Number.isFinite(la) && Number.isFinite(ln) && la >= -90 && la <= 90 && ln >= -180 && ln <= 180 && !(la === 0 && ln === 0);
// Overdue balances (from the collection reports): one snapshot, replaced by every upload. Stored as { at, by, asof, run, files, n, sum, m: { contractNo without leading zeros: [amount, bills, status, loc number, name] } }.
// BAL_NEEDS_EDIT: true = only users with Edit (and admin) can see or upload balances; false = anyone with View can see them.
const MAX_BAL = 100000, BAL_NEEDS_EDIT = true;
// contract number of a place (without leading zeros): from its CONTRACTNO field or the "CONTRACTNO: ..." line of its description
const pkey = p => { let v = ""; if (p.f) for (const k in p.f) if (/contract/i.test(k)) { v = p.f[k]; break; } if (!v && p.d) { const m = /contract\s*(?:no\.?|number|#)?\s*[:=]\s*(\d[\d-]*)/i.exec(p.d); if (m) v = m[1]; } return String(v).replace(/\D/g, "").replace(/^0+/, ""); };
let _bk = null, _bkAt = 0;   // set of contract numbers that have a balance (kept a few seconds; bal_put / bal_del refresh it)
async function balKeys(s) {
  if (_bk && Date.now() - _bkAt < FRESH) return _bk;
  const r = await s.get("bal", { type: "json", consistency: "strong" }); _bk = r && r.m ? new Set(Object.keys(r.m)) : null; _bkAt = Date.now(); return _bk;
}
const MAX_PLACES = 250000, SHARD_MAX = 1000, PAGE_BYTES = 3.2e6;
function normPlace(it, sid) {
  const la = Number(it && it.la), ln = Number(it && it.ln); if (!okLL(la, ln)) return null;
  const f = {}; if (it.f && typeof it.f === "object") for (const [k, v] of Object.entries(it.f).slice(0, 15)) { const kk = clip(k, 40), vv = clip(v, 200); if (kk && vv) f[kk] = vv; }
  const c = clip(it.c, 80), d = clip(it.d, 1500), p = { id: sid + crypto.randomBytes(4).toString("hex"), n: clip(it.n, 200) || "Unnamed", la: rnd(la), ln: rnd(ln) };
  if (c) p.c = c; if (d) p.d = d; if (Object.keys(f).length) p.f = f; return p;
}
// duplicate = same name, same location AND same description (so two accounts of one customer at one spot are both kept)
const hk = p => crypto.createHash("sha1").update(keyNm(p.n) + "|" + p.la + "|" + p.ln + "|" + keyNm(p.d)).digest("base64url").slice(0, 8);
const emptyIdx = n => ({ n: n || "", at: 0, sh: [] });
const total = x => x.sh.reduce((t, e) => t + e.c, 0);
const loadIdx = async s => { const x = await s.get("pidx", { type: "json" }); _acc = x && Array.isArray(x.sh) ? x : emptyIdx(); _accAt = Date.now(); return _acc; };
const readIdx = async s => (_acc && Date.now() - _accAt < FRESH) ? _acc : loadIdx(s);   // read-only views may use the short-lived copy
const saveIdx = async (s, x) => { x.at = Date.now(); await s.setJSON("pidx", x); _acc = x; _accAt = Date.now(); };
const loadShard = async (s, e) => { try { const t = await s.get("ps-" + e.k); return t ? JSON.parse(t) : []; } catch { return []; } };
const loadPk = async s => (await s.get("pkeys", { type: "json" })) || [];
// delete shard files that neither the live map nor any backup uses any more
async function gc(s, x) {
  try {
    const keep = new Set(x.sh.map(e => "ps-" + e.k)); for (const b of ((await s.get("backups_idx", { type: "json" })) || [])) for (const k of b.sk || []) keep.add("ps-" + k);
    const l = await s.list({ prefix: "ps-" });
    for (const b of l.blobs || []) if (!keep.has(b.key)) { try { await s.delete(b.key); } catch { } }
  } catch { /* cleaning up must never block an edit */ }
}
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
// ---- backups of the whole place list (kept before an upload and before a restore). A backup only remembers which shard files made up the map, so it is quick even for 70,000+ places. ----
const BK_KEEP = 4;
async function backup(s, label) {
  const x = await loadIdx(s); if (!x.sh.length) return null;
  const idx = (await s.get("backups_idx", { type: "json" })) || [], key = "backup-" + Date.now() + "-" + newId();
  await s.setJSON(key, { n: x.n, sh: x.sh, pk: await loadPk(s) });
  idx.push({ key, t: Date.now(), label, count: total(x), n: x.n || "", sk: x.sh.map(e => e.k) });
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

  // Map: the places, a page at a time ({from}: shard number to start at). Each reply holds as many whole shards as fit in about 3 MB and says where the next one starts.
  if (a === "map_get") {
    if (!can(me, db, "dmap")) return J({ e: "Not allowed" }, 403);
    const x = await readIdx(s), out = []; let j = Math.max(0, Number(b.from) || 0), bytes = 0, mode = "all";
    // {bal: 1}: only the places that have an overdue balance. The server reads the shards (several at a time) and sends just those, so the browser gets a small fraction of the data.
    const bk = b.bal && can(me, db, "dmap", BAL_NEEDS_EDIT ? "update" : "view") ? await balKeys(s) : null;
    if (bk) {
      mode = "bal"; const t0 = Date.now();
      while (j < x.sh.length) {
        const batch = x.sh.slice(j, j + 12), txt = await Promise.all(batch.map(e => s.get("ps-" + e.k).catch(() => null)));
        for (const t of txt) { let arr = []; try { arr = t ? JSON.parse(t) : []; } catch { } for (const p of arr) if (bk.has(pkey(p))) { out.push(p); bytes += 120 + (p.n || "").length + (p.d || "").length; } }
        j += batch.length;
        if (bytes > PAGE_BYTES * 0.8 || Date.now() - t0 > 6000) break;
      }
    } else {
      while (j < x.sh.length) {
        const t = await s.get("ps-" + x.sh[j].k), sz = t ? t.length : 0;
        if (out.length && bytes + sz > PAGE_BYTES) break;
        try { if (t) out.push(...JSON.parse(t)); } catch { }
        bytes += sz; j++;
      }
    }
    return J({ v: 4, r: out, next: j < x.sh.length ? j : null, total: total(x), sh: x.sh.length, mode, at: x.at || 0, n: x.n || "", canEdit: can(me, db, "dmap", "update") });
  }
  // Upload from a KML, sent in chunks of up to 1000 places: {mode: "replace" | "add", first, last, total, n: file name, items: [{n, c, d, f, la, ln}]}. Every chunk becomes one shard.
  if (a === "map_put") {
    if (!can(me, db, "dmap", "update")) return J({ e: "You do not have permission to upload" }, 403);
    const mode = b.mode === "replace" ? "replace" : "add", items = Array.isArray(b.items) ? b.items.slice(0, SHARD_MAX) : [];
    let x = await loadIdx(s), pk, backedUp = false;
    if (b.first) {
      backedUp = !!(await backup(s, (mode === "replace" ? "Before replacing the map (" : "Before adding to the map (") + me.u + ")"));   // the old list is kept so a wrong upload can be undone
      if (mode === "replace") { x = emptyIdx(clip(b.n, 120) || "upload"); pk = []; } else x.n = x.n || clip(b.n, 120);
    }
    pk = pk || await loadPk(s);
    const seen = new Set(pk), sid = crypto.randomBytes(3).toString("hex"), arr = []; let dup = 0, invalid = 0;
    for (const it of items) {
      const p = normPlace(it, sid); if (!p) { invalid++; continue; }
      const h = hk(p); if (seen.has(h)) { dup++; continue; }
      seen.add(h); pk.push(h); arr.push(p);
    }
    if (total(x) + arr.length > MAX_PLACES) return J({ e: "The map is limited to " + MAX_PLACES + " places" }, 400);
    if (arr.length) { const k = newId(); await s.setJSON("ps-" + k, arr); x.sh.push({ i: sid, k, c: arr.length }); }
    await s.setJSON("pkeys", pk); await saveIdx(s, x);
    if (b.first && mode === "replace") await gc(s, x);
    if (b.last) await audit(s, me, mode === "replace" ? "upload kml (replace)" : "upload kml (add)", null, [["places", "", String(Number(b.total) || arr.length)], ["file", "", short(b.n)]]);
    return J({ ok: 1, saved: arr.length, dup, invalid, total: total(x), backedUp });
  }
  // Overdue balances: bal_get (the snapshot), bal_put ({items: [[contract, amount, bills, status, loc, name]], asof, run, files}), bal_del.
  if (a === "bal_get") {
    if (!can(me, db, "dmap", BAL_NEEDS_EDIT ? "update" : "view")) return J({ e: "Not allowed" }, 403);
    const r = await s.get("bal", { type: "json" }); return J(r ? { ok: 1, ...r } : { ok: 1, n: 0 });
  }
  if (a === "bal_put") {
    if (!can(me, db, "dmap", "update")) return J({ e: "You do not have permission to upload balances" }, 403);
    const items = Array.isArray(b.items) ? b.items.slice(0, MAX_BAL) : [], m = {}; let sum = 0;
    for (const it of items) {
      if (!Array.isArray(it)) continue;
      const k = String(it[0] ?? "").replace(/\D/g, "").replace(/^0+/, ""), amt = Math.round(Number(it[1]) * 100) / 100; if (!k || !Number.isFinite(amt)) continue;
      m[k] = [amt, Math.max(0, Math.min(999, Number(it[2]) | 0)), clip(it[3], 20), clip(it[4], 12), clip(it[5], 30)];
    }
    for (const v of Object.values(m)) sum += v[0];
    const n = Object.keys(m).length; if (!n) return J({ e: "No valid balances found" }, 400);
    const rec = { at: Date.now(), by: me.u, asof: clip(b.asof, 40), run: clip(b.run, 20), files: (Array.isArray(b.files) ? b.files : []).slice(0, 10).map(x => clip(x, 80)), n, sum: Math.round(sum * 100) / 100, m };
    await s.setJSON("bal", rec); _bk = new Set(Object.keys(m)); _bkAt = Date.now();
    await audit(s, me, "upload balances", null, [["accounts", "", String(n)], ["as of", "", rec.asof], ["files", "", short(rec.files.join(", "))]]);
    return J({ ok: 1, n });
  }
  if (a === "bal_del") {
    if (!can(me, db, "dmap", "update")) return J({ e: "You do not have permission to remove balances" }, 403);
    await s.delete("bal"); _bk = null; _bkAt = Date.now(); await audit(s, me, "remove balances", null, null); return J({ ok: 1 });
  }
  // Move a pin ({id, la, ln}) or remove it (map_del {id}). Only the one shard that holds the place is rewritten.
  if (a === "map_move" || a === "map_del") {
    if (!can(me, db, "dmap", "update")) return J({ e: "You do not have permission to " + (a === "map_del" ? "remove" : "move") + " pins" }, 403);
    const x = await loadIdx(s), e = x.sh.find(y => y.i === String(b.id || "").slice(0, 6)), arr = e ? await loadShard(s, e) : [], i = arr.findIndex(y => y.id === b.id);
    if (i < 0) return J({ e: "Place not found (it may have been removed)" }, 404);
    const p = arr[i], pk = await loadPk(s), h0 = hk(p), oldKey = e.k;
    if (a === "map_move") {
      const la = Number(b.la), ln = Number(b.ln); if (!okLL(la, ln)) return J({ e: "That is not a valid location" }, 400);
      p.la = rnd(la); p.ln = rnd(ln); const j = pk.indexOf(h0); if (j >= 0) pk[j] = hk(p);
    } else { arr.splice(i, 1); const j = pk.indexOf(h0); if (j >= 0) pk.splice(j, 1); }
    if (arr.length) { e.k = newId(); e.c = arr.length; await s.setJSON("ps-" + e.k, arr); } else x.sh = x.sh.filter(y => y !== e);   // new file name: backups still point at the old one
    await s.setJSON("pkeys", pk); await saveIdx(s, x); await gc(s, x);
    await audit(s, me, a === "map_move" ? "map pin moved" : "map pin removed", p, null);
    return a === "map_move" ? J({ ok: 1, la: p.la, ln: p.ln }) : J({ ok: 1 });
  }
  if (me.role !== "admin") return J({ e: "Admin only" }, 403);
  const pw = String(b.p || ""), u = String(b.u || "").trim().toLowerCase();

  if (a === "signin_get") { const l = (await s.get("signins", { type: "json" })) || []; return J({ l: l.slice(-500).reverse() }); }
  if (a === "audit_get") { const l = (await s.get("audit", { type: "json" })) || []; return J({ l: l.slice(-500).reverse() }); }
  if (a === "backups") return J({ l: ((await s.get("backups_idx", { type: "json" })) || []).slice().reverse() });
  if (a === "backup_now") { const key = await backup(s, "Manual backup (" + me.u + ")"); return key ? J({ ok: 1 }) : J({ e: "Nothing to back up yet" }, 400); }
  if (a === "backup_restore") {
    const idx = (await s.get("backups_idx", { type: "json" })) || [], e = idx.find(y => y.key === b.key); if (!e) return J({ e: "Backup not found" }, 404);
    const snap = await s.get(e.key, { type: "json" }); if (!snap || !Array.isArray(snap.sh)) return J({ e: "That backup file is missing" }, 404);
    await backup(s, "Before restoring a backup (" + me.u + ")");
    const x = { n: snap.n || "restored", at: 0, sh: snap.sh }; await s.setJSON("pkeys", snap.pk || []); await saveIdx(s, x); await gc(s, x);
    await audit(s, me, "restore backup", null, [["places", "", String(total(x))], ["from", "", new Date(e.t).toISOString().slice(0, 16)]]);
    return J({ ok: 1, count: total(x) });
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
