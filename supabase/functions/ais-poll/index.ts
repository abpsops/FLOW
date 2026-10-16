// @ts-nocheck — written in plain-JavaScript style on purpose (see "TESTS" below).
/* ═══════════════════════════════════════════════════════════════════
   FLOW — ais-poll  (Supabase Edge Function, one self-contained file)
   ───────────────────────────────────────────────────────────────────
   Collects live AIS positions of the nominated vessels from
   aisstream.io and stores them in the `ais_positions` table, plus one
   run summary row in `ais_status` (see supabase_ais_setup.sql). The
   FLOW app only ever READS those two tables — the aisstream API key
   never reaches the browser.

   HOW ONE RUN WORKS (~1½ min, one WebSocket connection; scheduled every 2 minutes)
     Phase A (up to ~55 s; ~5–15 s once MMSIs are known): a box over the Gulf of Oman / Strait of Hormuz
       approaches, no MMSI filter. Learns IMO → MMSI from ShipStaticData
       and catches positions of tracked ships near Fujairah/Khor Fakkan.
       What was collected is saved at the end of phase A (checkpoint).
     Phase B (the rest of ~55 s): the subscription is replaced by a worldwide box +
       FiltersShipMMSI (the known MMSIs not yet seen, max 50 — the MMSIs
       typed on the nomination cards first) to catch tracked ships that
       are still far away.
     Which ships: every nomination card (payload.state.vessels) by its
       MMSI box (vessel.mmsi), its IMO box (vessel.imo; 9 digits there =
       an MMSI typed before the MMSI box existed), or — with neither — its
       name; plus schedule items that no longer have a card.
     If aisstream drops the connection mid-run the function reconnects
     once; the run then records a note ("Partial run: …") in ais_status.
     CPU (free plan: 2 s per request): messages are NOT JSON.parse'd
     blindly. A cheap indexOf scan (prefilter) reads MMSI / IMO / name
     from the raw text and only messages about a tracked ship are
     parsed. Position reports of unknown ships are kept as raw text (no
     parse) for the run, so a ship identified later by its static data
     still gets the position it reported before that.

   TIME LIMIT: Supabase's 150 s wall clock counts from when the WORKER
     started, and a warm worker also serves later requests. The run is
     therefore planned against the worker's boot time (BOOT_MS below):
     phase B is shortened first, then phase A, so that collecting ends
     ~140 s after boot with time left to save; a worker too close to its
     limit does not start a run at all (the next cron tick will). If the
     runtime still stops the worker (beforeunload), the run stops at
     once, saves what it has and records ok=false in ais_status.

   BACKGROUND MODE
     Cron callers (Supabase Cron / pg_net) and the app's "Refresh now"
     get an immediate 202 {started:true}; the collection keeps running
     via EdgeRuntime.waitUntil() and writes ais_status when done (the
     app watches ais_status.last_run_at). Without EdgeRuntime (other
     runtimes, tests) the request waits for the run and returns 200.
     A run in progress (ais_status.running_since, a lock that goes stale
     after 3 min) or a successful run < 2 min ago → 200 with the current
     status and nothing new is started.
     Every authenticated scheduled call records its arrival in
     ais_status.last_cron_at — also when it is skipped — so the app can
     tell operators when the schedule itself has stopped.

   AUTH — deploy with JWT verification OFF:
       supabase functions deploy ais-poll --no-verify-jwt
     (Dashboard: Edge Functions → ais-poll → Details → "Verify JWT with
     legacy secret" / "Enforce JWT verification" = OFF). The function
     checks every call itself and accepts ONLY
       • header  x-cron-secret: <AIS_CRON_SECRET>   (the scheduler), or
       • Authorization: Bearer <user JWT> of an account whose user_roles
         row says 'operator' (the app's Refresh now button).
     Anything else → 401 / 403 (and a warning in the function's Logs).

   SECRETS (Dashboard → Edge Functions → Secrets)
     AISSTREAM_API_KEY  your aisstream.io key
     AIS_CRON_SECRET    any long random string, also put in the cron job
     SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided automatically.
     Optional tuning: AIS_PHASE_A_SECONDS (20), AIS_PHASE_B_SECONDS (70), AIS_THROTTLE_SECONDS (20),
     AIS_REGION_BOX ("22,54,27.5,60.5" = latMin,lonMin,latMax,lonMax).

   TESTS: everything between the AIS-PURE-START / AIS-PURE-END markers
   uses only web-standard APIs (WebSocket, Request/Response, TextDecoder,
   console) and plain JavaScript syntax — no TypeScript annotations, no
   Deno.* — and ends with `const AIS = {...}`. tests/suites/ais/edge.test.js
   reads this file, evaluates that block in Node 22 and drives it against
   a local mock WebSocket server and a fake Supabase client. Only the few
   lines after AIS-PURE-END are Deno-specific. Keep it that way when
   editing (a TS annotation in the pure block would break the tests).
   ═══════════════════════════════════════════════════════════════════ */
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

// @@AIS-PURE-START@@
const DEFAULTS = {
  url: 'wss://stream.aisstream.io/v0/stream',
  // [[latMin, lonMin], [latMax, lonMax]] — Gulf of Oman + Strait of Hormuz approaches
  regionBox: [[22.0, 54.0], [27.5, 60.5]],
  phaseAms: 20000,       // ~1½ minutes per run (phase A + B + connect/save); scheduled every 2 minutes,
  phaseBms: 70000,       // so the stream is listened to almost all the time
  openTimeoutMs: 10000,
  throttleMs: 20000,      // a successful run less than 20 s ago → return the cached status (no double runs)
  lockStaleMs: 180000,    // a run "in progress" for more than 3 min is considered dead
  wallBudgetMs: 140000,   // collecting + saving must end this long after the WORKER booted (limit 150 s)
  reserveMs: 8000,        // kept free at the end for the final database writes
  minRunMs: 15000,        // less collecting time than this left on the worker → don't start (next tick will)
  minPhaseBms: 3000,      // a phase B shorter than this (after shortening) is skipped
  adaptivePhases: true,   // split the run by what we know: MMSIs known → mostly worldwide (phase B)
  allKnownPhaseAms: 5000, // every tracked vessel has an MMSI → only a short regional pass
  mixedPhaseAms: 15000,   // some MMSIs known → 15 s regional (to learn the rest), the rest worldwide
  maxReconnects: 1,       // aisstream dropped us mid-run → reconnect once if there is time
  reconnectMinMs: 8000,
  maxMmsiFilter: 50,      // aisstream limit for FiltersShipMMSI
  heardMax: 25,           // coverage check: details of the first N ships heard in a run are saved (ais_status.heard)
  heardCountMax: 5000,    // … and the number of different ships heard (ais_status.heard_count), counted up to this
  pruneDays: 30,          // rows not updated for this long are deleted (unless still tracked)
  bufferMax: 20000,       // ships whose last raw position text is kept (unparsed) until identified (~15 MB max)
  binaryType: 'arraybuffer',
  earlyExit: true,        // stop as soon as every tracked vessel has a position
};
const WORLD_BOX = [[-90, -180], [90, 180]];
const POSITION_TYPES = ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport'];
// Phase A covers a busy area: Class A only (big ships). Phase B is MMSI-filtered, so Class B costs nothing there.
const PHASE_A_TYPES = ['PositionReport', 'ShipStaticData'];
const PHASE_B_TYPES = ['PositionReport', 'ShipStaticData', 'StandardClassBPositionReport'];
const AIS_NAME_LEN = 20; // AIS carries at most 20 characters of a ship's name
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

/* Vessel name as compared everywhere (the app has an identical copy, _aisNormName):
   upper-case, AIS "@" padding removed, spaces collapsed, a leading MV / M/V / M.V.
   (or MT / M/T / M.T.) prefix stripped. */
function normName(s) {
  const t = String(s == null ? '' : s).toUpperCase().replace(/@+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.replace(/^(?:M\s*[\/.]\s*[VT]\.?|M[VT]\.?)\s+/, '');
}
/* The key two names are matched on: the normalised name cut to AIS's 20
   characters ("MARAN GAS ALEXANDROUPOLIS" is broadcast as "MARAN GAS
   ALEXANDROU"). The app's _aisNameKey is identical. */
function nameKey(s) { return normName(s).slice(0, AIS_NAME_LEN).trim(); }
/* One identifier box → its number: a leading "IMO" / "MMSI" label ("IMO No.",
   "IMO Nr", "IMO number", "MMSI #", then ":" "-" "=" …) is dropped, then
   spaces / dots / dashes inside the number. A copy of the app's _vidNorm —
   the nomination card calls a box valid by exactly this grammar, so keep
   the two the same (tests/suites/ais/edge.test.js compares them). */
function normId(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(/^(?:IMO|MMSI)(?![A-Za-z])\s*(?:no\.?|nr\.?|number|#)?\s*[:.#=\-\u2013]?\s*/i, '');
  const d = s.replace(/[\s.\-]/g, '');
  return /^\d+$/.test(d) ? d : s;
}
/* One identifier box: 7 digits = IMO number, 9 digits = MMSI. "IMO 9873022",
   "IMO No. 9873022", "MMSI: 538 001 234" are accepted. Anything else → null. */
function classifyId(raw) {
  const s = normId(raw);
  if (/^\d{7}$/.test(s)) return { kind: 'imo', value: s };
  if (/^\d{9}$/.test(s)) return { kind: 'mmsi', value: s };
  return null;
}
/* A nomination's identifiers → {mmsi, imo} (null when absent). The MMSI box
   (vessel.mmsi) first; 7 digits there count as the IMO. The IMO box
   (vessel.imo): 7 digits = IMO; 9 digits = an MMSI typed there before the
   MMSI box existed (used when the MMSI box is empty). The app's
   _aisVesselIds() reads them the same way (it keeps that legacy MMSI apart
   only to try it after the IMO). */
function vesselIds(v) {
  const m = classifyId(v && v.mmsi), i = classifyId(v && v.imo);
  const imo = i && i.kind === 'imo' ? i.value : (m && m.kind === 'imo' ? m.value : null);
  const mmsi = m && m.kind === 'mmsi' ? m.value : (i && i.kind === 'mmsi' ? i.value : null);
  return { mmsi, imo };
}
/* Tracked vessels from the shared workspace payload (abps_workspace id='main'):
   the nomination cards (payload.state.vessels) plus schedule items
   (payload.state.lastSched) that no longer have a card. Schedule items carry
   no IMO / MMSI, so an item belonging to a card (same nomUid, or same name)
   is skipped — the card's MMSI / IMO decides how that vessel is tracked.
   One entry per vessel: cards sharing an MMSI or an IMO are one vessel (an
   entry gains the other identifier from a later card); without either, one
   entry per normalised name. key = 'mmsi:…' / 'imo:…' / 'name:…'. */
function trackedFromPayload(payload) {
  const st = (payload && typeof payload === 'object' && payload.state && typeof payload.state === 'object') ? payload.state : {};
  const cards = (Array.isArray(st.vessels) ? st.vessels : []).filter((v) => v && typeof v === 'object');
  const cardUids = new Set(), cardNames = new Set();
  for (const v of cards) { if (v.nomUid) cardUids.add(String(v.nomUid)); const n = nameKey(v.name); if (n) cardNames.add(n); }
  const sched = (Array.isArray(st.lastSched) ? st.lastSched : []).filter((v) => v && typeof v === 'object' &&
    !(v.nomUid && cardUids.has(String(v.nomUid))) && !cardNames.has(nameKey(v.name)));
  const out = [], byId = new Map();
  for (const v of cards.concat(sched)) {
    const ids = vesselIds(v);
    const name = normName(v.name);
    const look = [];
    if (ids.mmsi) look.push('mmsi:' + ids.mmsi);
    if (ids.imo) look.push('imo:' + ids.imo);
    if (!look.length && name) look.push('name:' + name);
    if (!look.length) continue;
    let e = null;
    for (const k of look) { if (byId.has(k)) { e = byId.get(k); break; } }
    if (!e) { e = { key: look[0], imo: ids.imo || null, mmsi: ids.mmsi || null, name: name || null }; out.push(e); }
    else {
      if (!e.mmsi && ids.mmsi && !byId.has('mmsi:' + ids.mmsi)) e.mmsi = ids.mmsi;
      if (!e.imo && ids.imo && !byId.has('imo:' + ids.imo)) e.imo = ids.imo;
    }
    for (const k of look) if (!byId.has(k)) byId.set(k, e);
  }
  return out;
}
/* Lookup sets for one run. known: MMSI → {by, key} — tracked MMSIs (typed on
   the cards) first, then the IMO→MMSI / name→MMSI links learned in earlier
   runs (stored in ais_positions). A vessel with both an MMSI and an IMO is in
   trackedMmsi AND trackedImo (same key). trackedNames is keyed by nameKey()
   and holds ONLY vessels without IMO/MMSI. */
function buildContext(tracked, existingRows) {
  const ctx = { trackedImo: new Map(), trackedMmsi: new Map(), trackedNames: new Map(), known: new Map(), keys: new Set() };
  for (const t of tracked || []) {
    ctx.keys.add(t.key);
    if (t.imo) ctx.trackedImo.set(t.imo, t.key);
    if (t.mmsi) ctx.trackedMmsi.set(t.mmsi, t.key);
    if (!t.imo && !t.mmsi && t.name) ctx.trackedNames.set(nameKey(t.name), t.key);
  }
  for (const [mmsi, key] of ctx.trackedMmsi) ctx.known.set(mmsi, { by: 'mmsi', key });
  for (const r of existingRows || []) {
    const mmsi = String((r && r.mmsi) || '');
    if (!/^\d{9}$/.test(mmsi) || ctx.known.has(mmsi)) continue;
    if (r.imo && ctx.trackedImo.has(String(r.imo))) { ctx.known.set(mmsi, { by: 'imo', key: ctx.trackedImo.get(String(r.imo)) }); continue; }
    const n = nameKey(r.name);
    if (n && ctx.trackedNames.has(n)) ctx.known.set(mmsi, { by: 'name', key: ctx.trackedNames.get(n) });
  }
  return ctx;
}
/* The aisstream subscription message. Phase 'A' = region box, no MMSI filter;
   phase 'B' = whole world + FiltersShipMMSI (strings, max 50). */
function buildSubscription(apiKey, phase, opts) {
  opts = opts || {};
  if (phase === 'A') {
    return { APIKey: apiKey, BoundingBoxes: [opts.regionBox || DEFAULTS.regionBox], FilterMessageTypes: PHASE_A_TYPES.slice() };
  }
  const max = opts.max || DEFAULTS.maxMmsiFilter;
  return { APIKey: apiKey, BoundingBoxes: [WORLD_BOX], FiltersShipMMSI: (opts.mmsi || []).map(String).slice(0, max), FilterMessageTypes: PHASE_B_TYPES.slice() };
}
/* Phase B filter: known MMSIs with no position yet this run — the MMSIs typed
   on the cards first, then those learned from IMO / name; MMSIs whose vessel
   is already found through another MMSI (same name / IMO) go last. */
function pickPhaseBMmsis(ctx, obs, max) {
  const foundKeys = new Set();
  for (const r of obs.values()) if (r.position_time != null) foundKeys.add(r.key);
  const typed = [], learned = [], b = [];
  for (const [mmsi, m] of ctx.known) {
    const r = obs.get(mmsi);
    if (r && r.position_time != null) continue;
    if (foundKeys.has(m.key)) b.push(mmsi);
    else (ctx.trackedMmsi.has(mmsi) ? typed : learned).push(mmsi);
  }
  return typed.concat(learned, b).slice(0, max || DEFAULTS.maxMmsiFilter);
}
/* Split the run (phase A regional + phase B worldwide, same total) by what is
   known. Worldwide-by-MMSI finds a ship wherever aisstream hears it, so it gets
   most of the time as soon as MMSIs are known; the regional pass is only needed
   to learn MMSIs from IMO / name broadcasts near Fujairah. */
function adaptPhases(cfg, ctx) {
  if (!cfg || cfg.adaptivePhases === false) return cfg;
  const total = (cfg.phaseAms || 0) + (cfg.phaseBms || 0);
  const known = pickPhaseBMmsis(ctx, new Map(), cfg.maxMmsiFilter).length;
  const tracked = ctx && ctx.keys ? ctx.keys.size : 0;
  if (!known) return cfg; // nothing known yet: normal split — MMSIs learned in phase A still get the worldwide phase
  const a = Math.min(total, known >= tracked ? cfg.allKnownPhaseAms : cfg.mixedPhaseAms);
  return Object.assign({}, cfg, { phaseAms: a, phaseBms: total - a });
}
/* How long phases A and B may run when collecting can last `leftMs` more:
   phase B is cut first, then phase A. */
function planPhases(cfg, leftMs) {
  let a = cfg.phaseAms, b = cfg.phaseBms;
  if (!(leftMs >= a + b)) {
    const left = Math.max(0, leftMs || 0);
    b = Math.max(0, Math.min(b, left - a));
    a = Math.max(0, Math.min(a, left - b));
  }
  return { a, b };
}

/* ── Cheap raw-text scanning (no JSON.parse of the message) ── */
function scanDigits(raw, key) {
  const i = raw.indexOf(key);
  if (i < 0) return null;
  let j = i + key.length;
  while (raw.charCodeAt(j) === 32) j++;
  const s = j;
  while (j < raw.length) { const c = raw.charCodeAt(j); if (c < 48 || c > 57) break; j++; }
  return j > s ? raw.slice(s, j) : null;
}
/* The string value after `key`. JSON escapes (aisstream is a Go service:
   "&" arrives as &, quotes as \") are decoded — only for that short
   string, and only when it contains a backslash. */
function scanString(raw, key) {
  const i = raw.indexOf(key);
  if (i < 0) return null;
  let j = i + key.length;
  while (raw.charCodeAt(j) === 32) j++;
  if (raw.charCodeAt(j) !== 34) return null;
  let k = j + 1, esc = false;
  for (;;) {
    k = raw.indexOf('"', k);
    if (k < 0) return null;
    let bs = 0;
    for (let p = k - 1; p > j && raw.charCodeAt(p) === 92; p--) bs++;
    if (bs % 2 === 0) break;   // not an escaped quote
    esc = true;
    k++;
  }
  const s = raw.slice(j + 1, k);
  if (!esc && s.indexOf('\\') === -1) return s;
  try { return JSON.parse('"' + s + '"'); } catch (_) { return s; }
}
/* Decide what to do with one raw message:
     true    → parse it (a tracked ship, or an aisstream error message)
     false   → ignore it
     '<mmsi>'→ an unknown ship's position: keep the raw text (unparsed) in
               case its static data identifies it as tracked later. */
function prefilter(raw, ctx) {
  if (raw.length < 300 && raw.indexOf('"error"') !== -1) return true;
  const mmsi = scanDigits(raw, '"MMSI":');
  if (mmsi && ctx.known.has(mmsi)) return true;
  const isStatic = raw.indexOf('"ShipStaticData"') !== -1;
  if (isStatic && ctx.trackedImo.size) {
    const imo = scanDigits(raw, '"ImoNumber":');
    if (imo && ctx.trackedImo.has(imo)) return true;
  }
  if (ctx.trackedNames.size) {
    const sn = scanString(raw, '"ShipName":');
    if (sn && ctx.trackedNames.has(nameKey(sn))) return true;
    if (isStatic) { const n = scanString(raw, '"Name":'); if (n && ctx.trackedNames.has(nameKey(n))) return true; }
  }
  return (!isStatic && mmsi) ? mmsi : false;
}

// A number right after "key": in the raw text (no JSON.parse) — coverage check only.
function scanNum(raw, key) {
  const i = raw.indexOf(key);
  if (i < 0) return null;
  let j = i + key.length;
  while (raw.charCodeAt(j) === 32) j++;
  const st = j;
  while (j < raw.length) { const c = raw[j]; if ((c >= '0' && c <= '9') || c === '-' || c === '.' || c === 'e' || c === 'E' || c === '+') j++; else break; }
  if (j === st) return null;
  const n = Number(raw.slice(st, j));
  return isFinite(n) ? n : null;
}
/* Coverage check: remember who aisstream actually delivered (cheap raw scans,
   details only for the first cfg.heardMax different ships). */
function noteHeard(heard, heardSet, raw, cfg, phase) {
  const mmsi = scanDigits(raw, '"MMSI":');
  if (!mmsi) return;
  if (heardSet.size < (cfg.heardCountMax || 5000)) heardSet.add(mmsi);
  if (heard.has(mmsi) || heard.size >= (cfg.heardMax || 25)) return;
  const lat = scanNum(raw, '"latitude":'), lon = scanNum(raw, '"longitude":');
  const sn = scanString(raw, '"ShipName":');
  const t = scanString(raw, '"time_utc":');
  const sog = scanNum(raw, '"Sog":');
  heard.set(mmsi, {
    mmsi, name: cleanText(sn || '').slice(0, 40) || null,
    lat: (lat != null && Math.abs(lat) <= 90) ? Math.round(lat * 10000) / 10000 : null,
    lon: (lon != null && Math.abs(lon) <= 180) ? Math.round(lon * 10000) / 10000 : null,
    sog: (sog != null && sog >= 0 && sog < 102.2) ? round1(sog) : null,
    time: t ? new Date(parseAisTime(t, Date.now())).toISOString() : null,
    phase,
  });
}

/* ── Parsing (only for messages that passed the prefilter) ── */
function num(x) { if (x === null || x === undefined || x === '') return null; const n = Number(x); return isFinite(n) ? n : null; }
function pad2(n) { return String(n).padStart(2, '0'); }
function round1(n) { return Math.round(n * 10) / 10; }
function cleanText(s) { return String(s == null ? '' : s).replace(/@+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80); }
// "2026-10-15 10:11:12.123456789 +0000 UTC" → epoch ms (fallback when unreadable)
function parseAisTime(s, fallbackMs) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?\s*(?:([+-])(\d{2}):?(\d{2}))?/.exec(String(s == null ? '' : s).trim());
  if (!m) return fallbackMs;
  const ms = m[7] ? Math.min(999, Math.floor(Number('0.' + m[7]) * 1000)) : 0;
  let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms);
  if (m[8]) { const off = (+m[9] * 60 + +m[10]) * 60000; t -= m[8] === '+' ? off : -off; }
  return isFinite(t) ? t : fallbackMs;
}
// Position report → fields, or null when there is no usable fix (91/181, Valid=false, 0/0).
function parsePosition(body, meta, nowMs) {
  body = body || {}; meta = meta || {};
  const lat = num(body.Latitude != null ? body.Latitude : meta.latitude);
  const lon = num(body.Longitude != null ? body.Longitude : meta.longitude);
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (body.Valid === false || (lat === 0 && lon === 0)) return null;
  const sog = num(body.Sog), cog = num(body.Cog), hdg = num(body.TrueHeading), ns = num(body.NavigationalStatus);
  return {
    lat, lon,
    sog: sog != null && sog >= 0 && sog < 102.3 ? round1(sog) : null,   // 102.3 = not available
    cog: cog != null && cog >= 0 && cog < 360 ? round1(cog) : null,     // 360 = not available
    heading: hdg != null && hdg >= 0 && hdg < 360 ? Math.round(hdg) : null, // 511 = not available
    nav_status: ns != null && ns >= 0 && ns <= 15 ? Math.round(ns) : null,
    position_time: parseAisTime(meta.time_utc, nowMs),
  };
}
// {Month, Day, Hour, Minute} → "10-16 14:00" (as broadcast; no year, UTC). null when not set.
function formatAisEta(e) {
  e = e || {};
  const mo = num(e.Month), d = num(e.Day), h = num(e.Hour), mi = num(e.Minute);
  if (!mo || !d || mo > 12 || d > 31) return null;
  let s = pad2(mo) + '-' + pad2(d);
  if (h != null && mi != null && h < 24 && mi < 60) s += ' ' + pad2(h) + ':' + pad2(mi);
  return s;
}
function parseStatic(body, meta, nowMs) {
  body = body || {}; meta = meta || {};
  const imoN = num(body.ImoNumber);
  const dr = num(body.MaximumStaticDraught);
  return {
    imo: imoN != null && imoN >= 1000000 && imoN <= 9999999 ? String(Math.round(imoN)) : null,
    name: cleanText(body.Name) || cleanText(meta.ShipName) || null,
    destination: cleanText(body.Destination) || null,
    ais_eta: formatAisEta(body.Eta),
    draught: dr != null && dr > 0 ? round1(dr) : null,
    static_time: parseAisTime(meta.time_utc, nowMs),
  };
}
/* One ship's observations in this run. Positions / static data only
   replace older ones (by their own AIS time). The match (by/key) is the
   latest one: a name match is upgraded when static data shows a tracked IMO. */
function observe(obs, mmsi, match, upd) {
  let r = obs.get(mmsi);
  if (!r) { r = { mmsi, by: match.by, key: match.key, imo: null, name: null, position_time: null, static_time: null }; obs.set(mmsi, r); }
  r.by = match.by; r.key = match.key;
  const p = upd.pos;
  if (p && (r.position_time == null || p.position_time >= r.position_time)) {
    r.lat = p.lat; r.lon = p.lon; r.sog = p.sog; r.cog = p.cog; r.heading = p.heading; r.nav_status = p.nav_status; r.position_time = p.position_time;
  }
  const s = upd.stat;
  if (s && (r.static_time == null || s.static_time >= r.static_time)) {
    r.static_time = s.static_time; r.destination = s.destination; r.ais_eta = s.ais_eta; r.draught = s.draught;
    if (s.imo) r.imo = s.imo;
    if (s.name) r.name = s.name;
  }
  if (!r.name && upd.name) r.name = cleanText(upd.name) || null;
  return r;
}
const ROW_COLUMNS = ['mmsi', 'imo', 'name', 'lat', 'lon', 'sog', 'cog', 'heading', 'nav_status', 'destination', 'ais_eta', 'draught', 'matched_by', 'position_time', 'static_time', 'updated_at'];
/* The ais_positions row to upsert: the stored row merged with this run's
   observation. The newest position wins — an older time_utc never
   overwrites a newer stored position (same for static data). */
function mergeRow(existing, rec, nowIso) {
  const out = {};
  for (const c of ROW_COLUMNS) out[c] = existing && existing[c] !== undefined ? existing[c] : null;
  out.mmsi = String(rec.mmsi);
  const exPos = existing && existing.position_time ? Date.parse(existing.position_time) : NaN;
  if (rec.position_time != null && (isNaN(exPos) || rec.position_time >= exPos)) {
    out.lat = rec.lat; out.lon = rec.lon; out.sog = rec.sog; out.cog = rec.cog; out.heading = rec.heading; out.nav_status = rec.nav_status;
    out.position_time = new Date(rec.position_time).toISOString();
  }
  const exSt = existing && existing.static_time ? Date.parse(existing.static_time) : NaN;
  if (rec.static_time != null && (isNaN(exSt) || rec.static_time >= exSt)) {
    out.destination = rec.destination == null ? null : rec.destination;
    out.ais_eta = rec.ais_eta == null ? null : rec.ais_eta;
    out.draught = rec.draught == null ? null : rec.draught;
    out.static_time = new Date(rec.static_time).toISOString();
  }
  if (rec.imo) out.imo = rec.imo;
  if (rec.name) out.name = rec.name;
  out.matched_by = rec.by;
  out.updated_at = nowIso;
  return out;
}
/* Stored rows to delete: untouched for pruneDays AND not linked to a vessel
   that is still tracked (that link is the only memory of its IMO→MMSI). */
function pruneList(rows, ctx, cutoffMs) {
  const out = [];
  for (const r of rows || []) {
    const mmsi = String((r && r.mmsi) || '');
    const t = Date.parse((r && r.updated_at) || '');
    if (!mmsi || isNaN(t) || t >= cutoffMs) continue;
    if (ctx && ctx.known.has(mmsi)) continue;
    out.push(mmsi);
  }
  return out;
}
// WebSocket message data → text. Text frames arrive as strings, binary frames as
// ArrayBuffer (binaryType 'arraybuffer') or Blob (→ Promise<string>).
function messageText(data, decoder) {
  if (typeof data === 'string') return data;
  decoder = decoder || new TextDecoder();
  if (data instanceof ArrayBuffer) return decoder.decode(new Uint8Array(data));
  if (ArrayBuffer.isView(data)) return decoder.decode(data);
  if (data && typeof data.text === 'function') return data.text();
  return null;
}
function errMsg(e) { return String((e && e.message) || e || 'unknown error').slice(0, 300); }
function countFound(obs) {
  const keys = new Set();
  for (const r of obs.values()) if (r.position_time != null) keys.add(r.key);
  return keys.size;
}
function logLine(deps, level, msg) {
  const l = deps && deps.log;
  if (l === false) return;
  try { (l || console)[level]('[ais-poll] ' + msg); } catch (_) { /* no console */ }
}

/* Runs in progress in this worker — interruptRuns(reason) stops them so they
   save what they have (called from the runtime's beforeunload). */
const ACTIVE_RUNS = new Set();
function interruptRuns(reason) {
  let n = 0;
  for (const r of ACTIVE_RUNS) { n++; try { r.interrupt(reason); } catch (_) { /* keep going */ } }
  return n;
}

/* One collection: phase A then phase B on one WebSocket (one reconnect if
   aisstream drops it). o: {cfg, ctx, apiKey, WebSocketImpl?, now?, control?,
   onCheckpoint?(obs) → Promise}. Resolves (never rejects) with
   {obs: Map mmsi → observation, stats, error, interrupted}. */
function collect(o) {
  const cfg = o.cfg, ctx = o.ctx;
  const WS = o.WebSocketImpl || globalThis.WebSocket;
  const nowFn = o.now || Date.now;
  const deadline = typeof cfg.deadline === 'number' ? cfg.deadline : Infinity;
  const decoder = new TextDecoder();
  const obs = new Map(), buffer = new Map();
  const heard = new Map(), heardSet = new Set(); // coverage check
  const pc = adaptPhases(cfg, ctx); // this run's split between the regional and worldwide phases
  const stats = { messages: 0, parsed: 0, buffered: 0, learned: 0, phase: 'connecting', subscriptions: [], phaseBMmsi: 0, connections: 0, reconnects: 0, warnings: [], plannedA: null, plannedB: null };
  return new Promise((resolve) => {
    let ws = null, done = false, error = null, interrupted = false, phaseBList = null, plan = null;
    const timers = [], pending = new Set();
    const later = (fn, ms) => { timers.push(setTimeout(fn, ms)); };
    const track = (p) => { pending.add(p); p.then(() => pending.delete(p), () => pending.delete(p)); };
    const finish = (err, kind) => {
      if (done) return;
      done = true;
      if (err && !error) error = err;
      if (kind === 'interrupted') interrupted = true;
      timers.forEach(clearTimeout);
      const s = ws; ws = null;
      try { if (s) s.close(); } catch (_) { /* already closed */ }
      Promise.allSettled([...pending]).then(() => { stats.heard = [...heard.values()]; stats.heardCount = heardSet.size; resolve({ obs, stats, error, interrupted }); });
    };
    if (o.control) o.control.stop = () => finish('Interrupted by the runtime (' + (o.control.reason || 'shutdown') + ')', 'interrupted');
    const currentSub = () => stats.phase === 'B'
      ? buildSubscription(o.apiKey, 'B', { mmsi: phaseBList, max: cfg.maxMmsiFilter })
      : buildSubscription(o.apiKey, 'A', { regionBox: cfg.regionBox });
    const send = (sock, sub) => {
      stats.subscriptions.push(Object.assign({}, sub, { APIKey: sub.APIKey ? '***' : '' }));
      sock.send(JSON.stringify(sub));
    };
    const handleMsg = (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.error) { finish('aisstream.io: ' + String(msg.error).slice(0, 200)); return; }
      const type = msg.MessageType, meta = msg.MetaData || {}, body = (msg.Message || {})[type] || {};
      const mmsi = String(meta.MMSI != null ? meta.MMSI : (body.UserID != null ? body.UserID : ''));
      if (!/^\d{9}$/.test(mmsi)) return;
      const now = nowFn();
      let match = ctx.known.get(mmsi);
      if (type === 'ShipStaticData') {
        const st = parseStatic(body, meta, now);
        // A tracked IMO wins — also over an earlier name match for this MMSI.
        if (st.imo && ctx.trackedImo.has(st.imo) && (!match || match.by === 'name')) {
          const wasKnown = !!match;
          match = { by: 'imo', key: ctx.trackedImo.get(st.imo) };
          ctx.known.set(mmsi, match);
          if (!wasKnown) stats.learned++;
        }
        if (!match) {
          const n1 = nameKey(st.name), n2 = nameKey(meta.ShipName);
          if (n1 && ctx.trackedNames.has(n1)) match = { by: 'name', key: ctx.trackedNames.get(n1) };
          else if (n2 && ctx.trackedNames.has(n2)) match = { by: 'name', key: ctx.trackedNames.get(n2) };
          if (!match) return;
          ctx.known.set(mmsi, match);
          stats.learned++;
        }
        const b = buffer.get(mmsi);
        if (b) { buffer.delete(mmsi); try { stats.parsed++; handleMsg(JSON.parse(b)); } catch (_) { /* bad JSON */ } }
        observe(obs, mmsi, match, { stat: st, name: meta.ShipName });
      } else if (POSITION_TYPES.indexOf(type) !== -1) {
        if (!match) {
          const n = nameKey(meta.ShipName);
          if (!n || !ctx.trackedNames.has(n)) return;
          match = { by: 'name', key: ctx.trackedNames.get(n) };
          ctx.known.set(mmsi, match);
          stats.learned++;
        }
        const pos = parsePosition(body, meta, now);
        observe(obs, mmsi, match, { pos, name: meta.ShipName });
      }
    };
    const handleRaw = (raw) => {
      if (done || typeof raw !== 'string' || !raw) return;
      try { noteHeard(heard, heardSet, raw, cfg, stats.phase); } catch (_) { /* diagnostics only */ }
      const d = prefilter(raw, ctx);
      if (d === false) return;
      if (typeof d === 'string') {
        if (buffer.size < cfg.bufferMax || buffer.has(d)) { buffer.set(d, raw); stats.buffered++; }
        return;
      }
      let msg;
      try { stats.parsed++; msg = JSON.parse(raw); } catch (_) { return; }
      handleMsg(msg);
      if (!done && cfg.earlyExit && ctx.keys.size && countFound(obs) >= ctx.keys.size) finish();
    };
    const startPhaseB = () => {
      if (done) return;
      // Save what phase A collected first: a later kill then loses only phase B.
      if (typeof o.onCheckpoint === 'function' && obs.size) { try { track(Promise.resolve(o.onCheckpoint(obs))); } catch (_) { /* best effort */ } }
      const list = pickPhaseBMmsis(ctx, obs, cfg.maxMmsiFilter);
      const b = Math.min(plan.b, deadline - nowFn());
      if (!list.length || !(b > 0) || b < Math.min(pc.phaseBms, cfg.minPhaseBms)) { finish(); return; }
      stats.phase = 'B';
      stats.phaseBMmsi = list.length;
      phaseBList = list;
      buffer.clear(); // phase B only delivers filtered MMSIs
      if (ws && ws.readyState === 1) {
        try { send(ws, currentSub()); } catch (e) { lost('could not switch the subscription: ' + errMsg(e)); }
      } // otherwise the reconnect's onopen sends it
      later(() => finish(), b);
    };
    // The connection went away before the run was over: reconnect once if there is time.
    const lost = (what) => {
      if (done) return;
      const note = 'aisstream.io ' + what + ' during phase ' + stats.phase;
      if (stats.phase === 'connecting') { finish('aisstream.io ' + what); return; }
      if (stats.reconnects < cfg.maxReconnects && deadline - nowFn() > cfg.reconnectMinMs) {
        stats.reconnects++;
        stats.warnings.push(note + ' — reconnected');
        const s = ws; ws = null;
        try { if (s) s.close(); } catch (_) { /* gone */ }
        open();
        return;
      }
      finish(note);
    };
    const open = () => {
      let sock;
      try { sock = new WS(cfg.url); } catch (e) { if (stats.phase === 'connecting') finish('Could not open the aisstream.io connection: ' + errMsg(e)); else finish('aisstream.io reconnect failed: ' + errMsg(e)); return; }
      ws = sock;
      stats.connections++;
      try { sock.binaryType = cfg.binaryType || 'arraybuffer'; } catch (_) { /* runtime default */ }
      sock.onopen = () => {
        if (done || sock !== ws) return;
        if (stats.phase === 'connecting') {
          stats.phase = 'A';
          plan = planPhases(pc, deadline - nowFn());
          stats.plannedA = plan.a; stats.plannedB = plan.b;
          later(startPhaseB, plan.a);
        }
        // aisstream closes the socket unless the subscription arrives within 3 s — send it at once.
        try { send(sock, currentSub()); } catch (e) { lost('could not send the subscription: ' + errMsg(e)); }
      };
      sock.onmessage = (ev) => {
        if (done || sock !== ws) return;
        stats.messages++;
        const t = messageText(ev && ev.data, decoder);
        if (typeof t === 'string') handleRaw(t);
        else if (t && typeof t.then === 'function') track(t.then(handleRaw, () => {}));
      };
      sock.onerror = (ev) => { if (!done && sock === ws) lost('connection error' + (ev && ev.message ? ' (' + String(ev.message).slice(0, 120) + ')' : '')); };
      sock.onclose = (ev) => {
        if (done || sock !== ws) return;
        lost('closed the connection' + (ev && ev.code ? ' (code ' + ev.code + (ev.reason ? ', ' + String(ev.reason).slice(0, 120) : '') + ')' : ''));
      };
    };
    if (!(deadline - nowFn() > 0)) { finish('No time left on this worker'); return; }
    later(() => { if (stats.phase === 'connecting') finish('Timed out connecting to aisstream.io'); }, Math.min(cfg.openTimeoutMs, Math.max(0, deadline - nowFn())));
    if (isFinite(deadline)) later(() => finish(), Math.max(0, deadline - nowFn())); // hard stop at the time budget
    open();
  });
}

/* One complete run: read tracked vessels, collect, persist, write ais_status.
   Never throws; resolves with the summary that is also returned to callers. */
async function runPoll(db, cfg, deps, via) {
  deps = deps || {};
  const now = deps.now || Date.now;
  const t0 = now();
  const run = { reason: null, stop: null, interrupt(reason) { if (this.reason) return; this.reason = String(reason || 'shutdown'); if (this.stop) this.stop(); } };
  ACTIVE_RUNS.add(run);
  let tracked = [], found = 0, messages = 0, parsed = 0, ok = false, complete = false, error = null, plannedA = null, plannedB = null, heard = [], heardCount = 0;
  try {
    const checkInterrupted = () => { if (run.reason) throw new Error('Interrupted by the runtime (' + run.reason + ')'); };
    if (!cfg.apiKey) throw new Error('The AISSTREAM_API_KEY secret is not set (Edge Functions → Secrets)');
    const w = await db.from('abps_workspace').select('payload').eq('id', 'main').maybeSingle();
    if (w.error) throw new Error('Could not read the workspace: ' + w.error.message);
    tracked = trackedFromPayload(w.data && w.data.payload);
    const ex = await db.from('ais_positions').select('*');
    if (ex.error) throw new Error('Could not read ais_positions (run supabase_ais_setup.sql): ' + ex.error.message);
    checkInterrupted();
    const rowsBefore = ex.data || [];
    const existing = new Map(rowsBefore.map((r) => [String(r.mmsi), r]));
    const ctx = buildContext(tracked, rowsBefore);
    let partial = null;
    if (tracked.length) {
      const save = async (obs) => {
        const nowIso = new Date(now()).toISOString();
        const rows = [...obs.values()].map((rec) => mergeRow(existing.get(rec.mmsi), rec, nowIso));
        if (!rows.length) return null;
        const up = await db.from('ais_positions').upsert(rows, { onConflict: 'mmsi' });
        return up && up.error ? up.error.message : null;
      };
      const res = await collect({ cfg, ctx, apiKey: cfg.apiKey, WebSocketImpl: deps.WebSocketImpl, now, control: run, onCheckpoint: save });
      messages = res.stats.messages; parsed = res.stats.parsed; plannedA = res.stats.plannedA; plannedB = res.stats.plannedB;
      heard = res.stats.heard || []; heardCount = res.stats.heardCount || 0;
      found = countFound(res.obs);
      const saveErr = await save(res.obs);
      if (saveErr) throw new Error('Could not save positions: ' + saveErr);
      if (res.interrupted) throw new Error(res.error + (res.obs.size ? ' — partial results saved' : ''));
      if (res.error && !res.obs.size) throw new Error(res.error);
      if (res.error) partial = 'Partial run: ' + res.error;
      const notes = [partial].concat(res.stats.warnings).filter(Boolean);
      error = notes.length ? notes.join('; ') : null;
    }
    if (!run.reason) {
      const old = pruneList(rowsBefore, ctx, now() - cfg.pruneDays * 86400000);
      if (old.length) { try { await db.from('ais_positions').delete().in('mmsi', old); } catch (_) { /* housekeeping only */ } }
    }
    ok = true;
    complete = !partial;
  } catch (e) {
    error = errMsg(e);
  } finally {
    ACTIVE_RUNS.delete(run);
  }
  const t1 = now();
  const st = { id: 1, running_since: null, last_run_at: new Date(t1).toISOString(), ok, tracked: tracked.length, found, messages, error, duration_ms: t1 - t0 };
  if (ok && complete) st.last_ok_at = st.last_run_at;   // a partial run does not block a retry (throttle)
  // Coverage check (columns added by supabase_ais_setup.sql; the run still saves without them):
  // who aisstream actually delivered, and what this run searched for.
  const extra = {
    heard_count: heardCount,
    heard,
    searched: tracked.slice(0, 50).map((t) => ({ name: t.name || null, imo: t.imo || null, mmsi: t.mmsi || null })),
  };
  let statusError = null;
  try {
    let r = await db.from('ais_status').upsert(Object.assign({}, st, extra), { onConflict: 'id' });
    if (r && r.error && /heard|searched|column|schema cache/i.test(r.error.message || '')) r = await db.from('ais_status').upsert(st, { onConflict: 'id' });
    if (r && r.error) statusError = r.error.message;
  } catch (e) { statusError = errMsg(e); }
  const summary = { ok, complete: ok && complete, tracked: tracked.length, found, messages, parsed, duration_ms: t1 - t0, error, status_error: statusError, phases: { a: plannedA, b: plannedB } };
  logLine(deps, ok ? (error ? 'warn' : 'info') : 'error', 'run ' + (ok ? (complete ? 'ok' : 'partial') : 'FAILED') + ' (' + (via || '?') + '): tracked ' + summary.tracked + ', found ' + found + ', ' + messages + ' messages in ' + summary.duration_ms + ' ms' + (error ? ' — ' + error : '') + (statusError ? ' [ais_status not saved: ' + statusError + ']' : ''));
  return summary;
}

// Constant-time string comparison (cron secret).
function safeEqual(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
/* Who is calling? x-cron-secret (scheduler) or an operator's JWT (app). */
async function authorize(req, db, cronSecret) {
  const cs = req.headers.get('x-cron-secret');
  if (cs) {
    if (!cronSecret) return { ok: false, status: 401, error: 'Invalid cron secret (the AIS_CRON_SECRET secret is not set)' };
    if (safeEqual(cs, cronSecret)) return { ok: true, via: 'cron' };
    return { ok: false, status: 401, error: 'Invalid cron secret' };
  }
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') || '');
  if (!m) return { ok: false, status: 401, error: 'Not signed in (no x-cron-secret header and no login token)' };
  let user = null;
  try { const r = await db.auth.getUser(m[1].trim()); user = r && r.data && r.data.user; } catch (_) { user = null; }
  if (!user || !user.id) return { ok: false, status: 401, error: 'Invalid or expired session' };
  const r = await db.from('user_roles').select('role').eq('user_id', user.id).maybeSingle();
  if (r.error) return { ok: false, status: 500, error: 'Role lookup failed: ' + r.error.message };
  if (!r.data || r.data.role !== 'operator') return { ok: false, status: 403, error: 'Only operators can refresh live positions' };
  return { ok: true, via: 'operator', uid: user.id };
}
/* A scheduled call arrived (x-cron-secret): ais_status.last_cron_at = now, whether
   it then runs or is skipped (a run in progress / just finished). The app warns
   operators when this gets old — so it must move on every tick of a working
   schedule. Errors are ignored (e.g. the column doesn't exist yet). */
async function markCronCall(db, t) {
  try { await db.from('ais_status').upsert({ id: 1, last_cron_at: new Date(t).toISOString() }, { onConflict: 'id' }); } catch (_) { /* optional */ }
}
// Atomically take the "run in progress" lock (ais_status.running_since).
async function claimRun(db, t, cfg) {
  await db.from('ais_status').upsert({ id: 1 }, { onConflict: 'id', ignoreDuplicates: true });
  const staleIso = new Date(t - cfg.lockStaleMs).toISOString();
  const r = await db.from('ais_status')
    .update({ running_since: new Date(t).toISOString() })
    .eq('id', 1)
    .or('running_since.is.null,running_since.lt."' + staleIso + '"')
    .select('id');
  if (r.error) return { ok: false, error: r.error.message };
  return { ok: !!(r.data && r.data.length) };
}
function parseBox(s) {
  const p = String(s || '').split(',').map(Number);
  if (p.length !== 4 || p.some((x) => !isFinite(x))) return null;
  return [[p[0], p[1]], [p[2], p[3]]];
}
function makeConfig(env, over) {
  const c = Object.assign({}, DEFAULTS);
  const n = (k) => { const v = env(k); if (v == null || v === '') return null; const x = Number(v); return isFinite(x) && x >= 0 ? x : null; };
  if (n('AIS_PHASE_A_SECONDS') != null) c.phaseAms = n('AIS_PHASE_A_SECONDS') * 1000;
  if (n('AIS_PHASE_B_SECONDS') != null) c.phaseBms = n('AIS_PHASE_B_SECONDS') * 1000;
  if (n('AIS_THROTTLE_SECONDS') != null) c.throttleMs = n('AIS_THROTTLE_SECONDS') * 1000;
  const box = parseBox(env('AIS_REGION_BOX'));
  if (box) c.regionBox = box;
  if (env('AIS_STREAM_URL')) c.url = env('AIS_STREAM_URL');
  c.apiKey = env('AISSTREAM_API_KEY') || '';
  Object.assign(c, over || {});
  // Sanity caps; the real limit is applied per run from the worker's boot time (planPhases).
  c.phaseAms = Math.min(c.phaseAms, 120000);
  c.phaseBms = Math.min(c.phaseBms, 120000);
  return c;
}
function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS) });
}
/* The HTTP handler. deps: { env(name), createClient, waitUntil?(promise),
   bootMs? (when this worker started), WebSocketImpl?, now?(), config?
   (overrides, tests), log? (console-like, or false) }. */
async function handleRequest(req, deps) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') return new Response('ok', { status: 200, headers: CORS });
  if (method !== 'POST' && method !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });
  const env = deps.env || (() => undefined);
  const now = deps.now || Date.now;
  const tReq = now();
  const cfg = makeConfig(env, deps.config);
  const sbUrl = env('SUPABASE_URL'), sbKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!sbUrl || !sbKey) return json(500, { ok: false, error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not available' });
  const db = deps.createClient(sbUrl, sbKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  try {
    const auth = await authorize(req, db, env('AIS_CRON_SECRET'));
    if (!auth.ok) {
      // Visible in Edge Functions → ais-poll → Logs (a rejected scheduled call writes nothing else).
      logLine(deps, 'warn', 'rejected ' + auth.status + ': ' + auth.error);
      return json(auth.status, { ok: false, error: auth.error });
    }
    if (auth.via === 'cron') await markCronCall(db, tReq);
    const s = await db.from('ais_status').select('*').eq('id', 1).maybeSingle();
    if (s.error) return json(500, { ok: false, error: 'ais_status is missing — run supabase_ais_setup.sql (' + s.error.message + ')' });
    const status = s.data || null;
    const t = now();
    if (status && status.running_since && t - Date.parse(status.running_since) < cfg.lockStaleMs) return json(200, { ok: true, running: true, status });
    if (status && status.last_ok_at && t - Date.parse(status.last_ok_at) < cfg.throttleMs) return json(200, { ok: true, throttled: true, status });
    // Plan against the worker's age: a warm worker may already be well into its 150 s.
    const boot = typeof deps.bootMs === 'number' && deps.bootMs <= tReq ? deps.bootMs : tReq;
    const deadline = boot + cfg.wallBudgetMs - cfg.reserveMs;
    if (deadline - now() < cfg.minRunMs) {
      logLine(deps, 'warn', 'not starting: this worker is ' + Math.round((now() - boot) / 1000) + ' s old, too close to its time limit');
      return json(200, { ok: true, busy: true, deferred: true, status, error: 'This function instance is near its time limit — the next run will collect positions' });
    }
    const claim = await claimRun(db, t, cfg);
    if (claim.error) return json(500, { ok: false, error: 'Could not start a run: ' + claim.error });
    if (!claim.ok) {
      const again = await db.from('ais_status').select('*').eq('id', 1).maybeSingle();
      return json(200, { ok: true, running: true, status: again.data || null });
    }
    const work = runPoll(db, Object.assign({}, cfg, { deadline }), deps, auth.via).catch((e) => ({ ok: false, error: errMsg(e) }));
    if (typeof deps.waitUntil === 'function') {
      // Background mode: answer now, keep collecting after the response.
      deps.waitUntil(work);
      return json(202, { ok: true, started: true, via: auth.via });
    }
    const result = await work;
    return json(result.ok ? 200 : 502, result);
  } catch (e) {
    return json(500, { ok: false, error: errMsg(e) });
  }
}

const AIS = {
  DEFAULTS, WORLD_BOX, CORS, POSITION_TYPES, PHASE_A_TYPES, PHASE_B_TYPES, ROW_COLUMNS, AIS_NAME_LEN, ACTIVE_RUNS,
  normName, nameKey, normId, classifyId, vesselIds, trackedFromPayload, buildContext, buildSubscription, pickPhaseBMmsis, planPhases,
  scanDigits, scanString, scanNum, noteHeard, prefilter, parseAisTime, parsePosition, parseStatic, formatAisEta,
  observe, mergeRow, pruneList, messageText, countFound, collect, runPoll, interruptRuns, safeEqual, authorize, claimRun, markCronCall,
  parseBox, makeConfig, handleRequest, adaptPhases
};
// @@AIS-PURE-END@@

/* ── Deno / Supabase Edge Runtime entry (the only runtime-specific part) ── */
const BOOT_MS = Date.now(); // the 150 s wall clock counts from here, across every request this worker serves
// The runtime is about to stop this worker (wall clock / CPU / memory limit): save what the run has.
addEventListener('beforeunload', (ev) => {
  const reason = (ev && ev.detail && ev.detail.reason) || 'shutdown';
  if (AIS.interruptRuns(String(reason))) console.warn('[ais-poll] worker stopping (' + reason + ') during a run — saving partial results');
});
Deno.serve((req) => AIS.handleRequest(req, {
  env: (k) => Deno.env.get(k),
  createClient,
  bootMs: BOOT_MS,
  // Supabase keeps the worker alive for promises handed to EdgeRuntime.waitUntil()
  // (up to the wall-clock limit) after the response has been sent.
  waitUntil: (typeof EdgeRuntime !== 'undefined' && EdgeRuntime && typeof EdgeRuntime.waitUntil === 'function')
    ? (p) => EdgeRuntime.waitUntil(p)
    : null,
}));
