/* ais-poll Edge Function — pure logic + end-to-end runs in Node 22.
   node edge.test.js [appDir]
   Loads supabase/functions/ais-poll/index.ts the documented way: the block
   between // @@AIS-PURE-START@@ and // @@AIS-PURE-END@@ is plain JavaScript
   using only web-standard APIs, evaluated here with new Function(). The
   end-to-end runs use Node's built-in WebSocket client against a local mock
   aisstream server (mock-ws.js) and a fake Supabase service-role client. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { startWsServer } = require('./mock-ws.js');

const appDir = process.argv[2] || process.env.APP_DIR || path.resolve(__dirname, '..', '..', '..');
const FILE = path.join(appDir, 'supabase', 'functions', 'ais-poll', 'index.ts');

let pass = 0, fail = 0;
function check(name, cond, info) {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 900)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadAis() {
  const src = fs.readFileSync(FILE, 'utf8');
  const a = src.indexOf('// @@AIS-PURE-START@@'), b = src.indexOf('// @@AIS-PURE-END@@');
  if (a < 0 || b < a) throw new Error('AIS-PURE markers not found in ' + FILE);
  return { src, AIS: new Function(src.slice(a, b) + '\nreturn AIS;')() };
}

/* ── Fake Supabase (service role) — just the calls ais-poll makes ── */
const PK = { abps_workspace: 'id', ais_positions: 'mmsi', ais_status: 'id', user_roles: 'user_id' };
function makeFakeDb(seed) {
  seed = seed || {};
  const db = {
    tables: { abps_workspace: new Map(), ais_positions: new Map(), ais_status: new Map(), user_roles: new Map() },
    users: { 'jwt-operator': { id: 'u-op' }, 'jwt-trader': { id: 'u-tr' }, 'jwt-norole': { id: 'u-none' } },
    missing: new Set(seed.missing || []),
    noColumns: new Set(seed.noColumns || []),   // columns the table doesn't have yet (SQL not re-run)
    log: [],
  };
  db.tables.user_roles.set('u-op', { user_id: 'u-op', role: 'operator' });
  db.tables.user_roles.set('u-tr', { user_id: 'u-tr', role: 'trader' });
  if (seed.payload) db.tables.abps_workspace.set('main', { id: 'main', payload: seed.payload, version: 1 });
  for (const r of seed.positions || []) db.tables.ais_positions.set(String(r.mmsi), structuredClone(r));
  if (seed.status !== null) db.tables.ais_status.set('1', Object.assign({ id: 1 }, seed.status || {}));
  const key = (t, v) => String(v);
  const cmp = (a, b) => { const da = Date.parse(a), dbb = Date.parse(b); if (!isNaN(da) && !isNaN(dbb) && /\d{4}-\d\d-\d\d/.test(String(a))) return da - dbb; return Number(a) - Number(b); };
  const test = (row, f) => {
    const v = row[f.col];
    if (f.op === 'eq') return v != null && String(v) === String(f.val);
    if (f.op === 'lt') return v != null && cmp(v, f.val) < 0;
    if (f.op === 'is') return f.val === 'null' ? v == null : String(v) === f.val;
    if (f.op === 'in') return f.val.map(String).includes(String(v));
    if (f.op === 'or') return f.list.some(g => test(row, g));
    return true;
  };
  function parseOr(str) {
    const parts = []; let cur = '', q = false;
    for (const ch of str) { if (ch === '"') { q = !q; cur += ch; } else if (ch === ',' && !q) { parts.push(cur); cur = ''; } else cur += ch; }
    if (cur) parts.push(cur);
    return parts.map(p => { const i = p.indexOf('.'), j = p.indexOf('.', i + 1); return { col: p.slice(0, i), op: p.slice(i + 1, j), val: p.slice(j + 1).replace(/^"|"$/g, '') }; });
  }
  class Q {
    constructor(t) { this.t = t; this.action = 'select'; this.filters = []; this.single = false; this.returning = false; }
    select() { if (this.action !== 'select') this.returning = true; return this; }
    eq(col, val) { this.filters.push({ op: 'eq', col, val }); return this; }
    lt(col, val) { this.filters.push({ op: 'lt', col, val }); return this; }
    in(col, val) { this.filters.push({ op: 'in', col, val }); return this; }
    or(str) { this.filters.push({ op: 'or', list: parseOr(str) }); return this; }
    maybeSingle() { this.single = true; return this; }
    upsert(rows, opts) { this.action = 'upsert'; this.rows = rows; this.opts = opts || {}; return this; }
    update(vals) { this.action = 'update'; this.vals = vals; return this; }
    delete() { this.action = 'delete'; return this; }
    then(res, rej) { return Promise.resolve().then(() => this.exec()).then(res, rej); }
    exec() {
      db.log.push({ table: this.t, action: this.action, filters: this.filters, rows: structuredClone(this.rows), vals: this.vals, opts: this.opts, at: Date.now() });
      if (db.missing.has(this.t)) return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public." + this.t + "' in the schema cache" } };
      const t = db.tables[this.t];
      const hit = () => [...t.values()].filter(r => this.filters.every(f => test(r, f)));
      if (this.action === 'select') { const rows = hit().map(r => structuredClone(r)); return { data: this.single ? (rows[0] || null) : rows, error: null }; }
      if (this.action === 'upsert') {
        const rows = Array.isArray(this.rows) ? this.rows : [this.rows];
        if (this.t === 'ais_status') for (const c of db.noColumns) if (rows.some(r => c in r)) return { data: null, error: { code: 'PGRST204', message: "Could not find the '" + c + "' column of 'ais_status' in the schema cache" } };
        for (const r of rows) {
          const k = key(this.t, r[PK[this.t]]);
          if (t.has(k)) { if (!this.opts.ignoreDuplicates) Object.assign(t.get(k), structuredClone(r)); }
          else t.set(k, structuredClone(r));
        }
        return { data: null, error: null };
      }
      if (this.action === 'update') { const rows = hit(); rows.forEach(r => Object.assign(r, structuredClone(this.vals))); return { data: this.returning ? rows.map(r => ({ id: r.id })) : null, error: null }; }
      if (this.action === 'delete') { for (const r of hit()) t.delete(key(this.t, r[PK[this.t]])); return { data: null, error: null }; }
      return { data: null, error: { message: 'unsupported' } };
    }
  }
  db.client = {
    auth: { getUser: async (jwt) => db.users[jwt] ? { data: { user: db.users[jwt] }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } } },
    from: (t) => new Q(t),
  };
  db.status = () => db.tables.ais_status.get('1');
  db.row = (mmsi) => db.tables.ais_positions.get(String(mmsi));
  return db;
}

/* ── aisstream-shaped messages ── */
const aisTime = (ms) => new Date(ms).toISOString().replace('T', ' ').replace('Z', '') + '456789 +0000 UTC';
// aisstream is written in Go: encoding/json escapes & < > inside strings.
const goEsc = (s) => s.replace(/&/g, '\\u0026').replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
function posMsg(mmsi, name, lat, lon, tMs, o) {
  o = o || {};
  return goEsc(JSON.stringify({
    Message: { [o.type || 'PositionReport']: { Cog: o.cog == null ? 123.4 : o.cog, CommunicationState: 59916, Latitude: lat, Longitude: lon, MessageID: 1, NavigationalStatus: o.nav == null ? 0 : o.nav, PositionAccuracy: true, Raim: false, RateOfTurn: 0, RepeatIndicator: 0, Sog: o.sog == null ? 10.3 : o.sog, Spare: 0, SpecialManoeuvreIndicator: 0, Timestamp: 31, TrueHeading: o.hdg == null ? 120 : o.hdg, UserID: Number(mmsi), Valid: o.valid === undefined ? true : o.valid } },
    MessageType: o.type || 'PositionReport',
    MetaData: { MMSI: Number(mmsi), MMSI_String: Number(mmsi), ShipName: (name || '').padEnd(20, ' '), latitude: lat, longitude: lon, time_utc: aisTime(tMs) },
  }));
}
function staticMsg(mmsi, imo, name, tMs, o) {
  o = o || {};
  return goEsc(JSON.stringify({
    Message: { ShipStaticData: { AisVersion: 1, CallSign: 'ABCD   ', Destination: (o.dest || 'FUJAIRAH') + '@@@@', Dimension: { A: 150, B: 30, C: 15, D: 15 }, Dte: false, Eta: o.eta || { Day: 16, Hour: 14, Minute: 0, Month: 10 }, FixType: 1, ImoNumber: imo, MaximumStaticDraught: o.draught == null ? 12.5 : o.draught, MessageID: 5, Name: name + '@@@', RepeatIndicator: 0, Spare: false, Type: 80, UserID: Number(mmsi), Valid: true } },
    MessageType: 'ShipStaticData',
    MetaData: { MMSI: Number(mmsi), MMSI_String: Number(mmsi), ShipName: name, latitude: 25.1, longitude: 56.5, time_utc: aisTime(tMs) },
  }));
}

/* ── the workspace used by the end-to-end runs (real shapes: schedule items have no imo) ── */
const PAYLOAD = {
  version: 7,
  state: {
    vessels: [
      { nomUid: 'n1', name: 'ALPHA STAR', imo: '9000001', area: 'FUJ-A' },     // IMO → learn MMSI 311000001 from static data
      { nomUid: 'n2', name: 'BRAVO WAVE', imo: '538000002', area: 'KFK-A' },   // MMSI given → only seen far away (phase B)
      { nomUid: 'n3', name: 'MV Sea  Breeze', imo: '', area: 'FUJ-B' },       // name only → AIS "SEA BREEZE"
      { nomUid: 'n4', name: 'DELTA GHOST', imo: 'IMO 9000004', area: 'FUJ-A' },// never seen; linked 40 days ago
    ],
    lastSched: [
      { sno: 1, nomUid: 'n1', name: 'ALPHA STAR', area: 'FUJ-A', eta: '2026-10-16T04:00:00.000Z', vq: 500 },  // the card's own schedule row
      { sno: 2, nomUid: 'old-uid', name: 'Bravo Wave', area: 'KFK-A', eta: '2026-10-16T08:00:00.000Z' },     // same vessel, other uid
      { sno: 3, nomUid: 'n9', name: 'ECHO SCHED', area: 'FUJ-A', eta: '2026-10-16T12:00:00.000Z' },          // card removed, still scheduled
    ],
  },
};
const MMSI = { alpha: '311000001', bravo: '538000002', sea: '477000003', echo: '244000005', delta: '412000004', decoy: '636000999' };

(async () => {
  let AIS, src;
  try { ({ AIS, src } = loadAis()); check('E0 pure block of index.ts loads in Node', typeof AIS.handleRequest === 'function'); }
  catch (e) { check('E0 pure block of index.ts loads in Node', false, String(e && e.stack || e)); console.log(`AIS-EDGE: ${pass} passed, ${fail} failed`); process.exit(1); }

  /* ── 1. Deno entry + whole file is valid (TS-free) syntax ── */
  {
    const tmp = path.join(os.tmpdir(), 'ais-poll-check-' + process.pid + '.mjs');
    fs.writeFileSync(tmp, src);
    const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
    fs.unlinkSync(tmp);
    check('E1 the whole index.ts parses (plain JS syntax, ES module)', r.status === 0, r.stderr);
    const entry = src.slice(src.indexOf('@@AIS-PURE-END@@'));
    check('E1 single file: npm:@supabase/supabase-js@2 import, Deno.serve entry, EdgeRuntime.waitUntil background mode, no local imports',
      /import \{ createClient \} from 'npm:@supabase\/supabase-js@2[.\d]*'/.test(src) && /Deno\.serve\(/.test(src) && /EdgeRuntime\.waitUntil\(p\)/.test(src) && !/from\s+['"]\.{1,2}\//.test(src));
    check('E1 entry records the worker boot time and saves partial results on beforeunload',
      /const BOOT_MS = Date\.now\(\)/.test(entry) && /bootMs: BOOT_MS/.test(entry) && /addEventListener\('beforeunload'/.test(entry) && /AIS\.interruptRuns\(/.test(entry));
    check('E1 the pure block uses no Deno.* API', !/Deno\./.test(src.slice(src.indexOf('@@AIS-PURE-START@@'), src.indexOf('@@AIS-PURE-END@@'))));
  }

  /* ── 2. Pure helpers ── */
  {
    const N = AIS.normName;
    check('E2 normName: upper-case, spaces collapsed, MV / M/V / M.V. / MT prefix and AIS @ padding stripped',
      N('mv  Sea   breeze') === 'SEA BREEZE' && N('M/V SEA BREEZE') === 'SEA BREEZE' && N('M.V. Sea Breeze') === 'SEA BREEZE' && N('MT OCEAN') === 'OCEAN' && N('SEA BREEZE@@@@  ') === 'SEA BREEZE' && N('MVSEA') === 'MVSEA' && N(null) === '');
    check('E2 nameKey: names compared on AIS\'s 20 characters ("MARAN GAS ALEXANDROUPOLIS" = "MARAN GAS ALEXANDROU")',
      AIS.nameKey('MV Maran Gas Alexandroupolis') === 'MARAN GAS ALEXANDROU' && AIS.nameKey('MARAN GAS ALEXANDROU') === 'MARAN GAS ALEXANDROU' && AIS.nameKey('SEA BREEZE PRINCESS ROYAL') === 'SEA BREEZE PRINCESS' && AIS.nameKey('SHORT') === 'SHORT');
    const C = AIS.classifyId;
    check('E2 classifyId: 7 digits = IMO, 9 digits = MMSI, prefixes/spaces ok, anything else null',
      JSON.stringify([C('9873022'), C('IMO 9873022'), C('IMO9873022'), C('MMSI: 538 001 234'), C('53800123'), C('abc'), C('')]) ===
      JSON.stringify([{ kind: 'imo', value: '9873022' }, { kind: 'imo', value: '9873022' }, { kind: 'imo', value: '9873022' }, { kind: 'mmsi', value: '538001234' }, null, null, null]));
    // One grammar: the app's _vidNorm / _aisClassifyId (from index.html) and the function's classifyId agree on every sample.
    {
      const html = fs.readFileSync(path.join(appDir, 'index.html'), 'utf8');
      const fnSrc = name => { const m = html.match(new RegExp('function ' + name + '\\(raw\\) \\{[\\s\\S]*?\\n\\}')); return m ? m[0] : ''; };
      const app = new Function(fnSrc('_vidNorm') + '\n' + fnSrc('_aisClassifyId') + '\nreturn { norm: _vidNorm, cls: _aisClassifyId };')();
      const S = ['9873022', 'IMO 9873022', 'IMO9873022', 'imo 9873022 ', 'IMO No. 9873022', 'IMO No.: 9873022', 'IMO NO 9873022', 'IMO Nr. 9873022', 'IMO number 9873022', 'IMO=9873022', 'IMO \u2013 9873022', 'IMO#9873022', 'IMO: 987 3022',
        'MMSI: 538 001 234', 'MMSI No: 538001234', 'MMSI #538001234', 'MMSI-538-001-234', '538.001.234', '53800123', 'abc', '', 'Imogen 9873022', 'IMO 9873022 / MMSI 538001234', null, undefined];
      const diff = S.filter(x => JSON.stringify(app.cls(x)) !== JSON.stringify(AIS.classifyId(x)) || app.norm(x) !== AIS.normId(x));
      check('E2 classifyId / normId = the app\'s _aisClassifyId / _vidNorm on every sample ("IMO No. …", "Nr", "number", "=", "–", "MMSI No: …")',
        fnSrc('_vidNorm') && fnSrc('_aisClassifyId') && diff.length === 0 && AIS.classifyId('IMO No. 9873022').value === '9873022' && AIS.classifyId('MMSI No: 538001234').kind === 'mmsi' && AIS.classifyId('Imogen 9873022') === null, diff.map(x => [x, app.cls(x), AIS.classifyId(x)]));
      const lv = AIS.trackedFromPayload({ state: { vessels: [{ nomUid: 'l1', name: 'LABEL ONE', imo: 'IMO No. 9321483' }, { nomUid: 'l2', name: 'LABEL TWO', imo: '', mmsi: 'MMSI No: 636012345' }], lastSched: [] } });
      check('E2 a labelled box ("IMO No. 9321483", "MMSI No: 636012345") is tracked by its number, not by name', lv.map(t => t.key).join(',') === 'imo:9321483,mmsi:636012345', lv);
    }
    // The nomination card's own MMSI box (vessel.mmsi) — added next to the IMO box.
    const V = AIS.vesselIds;
    check('E2 vesselIds: MMSI box first (7 digits there = IMO), IMO box 7 digits = IMO, 9 digits in the IMO box = legacy MMSI only when the MMSI box is empty',
      JSON.stringify([V({ imo: '9321483', mmsi: '636012345' }), V({ imo: '', mmsi: 'MMSI 636 012 345' }), V({ imo: '538009876' }), V({ imo: '538009876', mmsi: '636012345' }), V({ mmsi: '9321483' }), V({ imo: 'x', mmsi: '12' }), V(null)]) ===
      JSON.stringify([{ mmsi: '636012345', imo: '9321483' }, { mmsi: '636012345', imo: null }, { mmsi: '538009876', imo: null }, { mmsi: '636012345', imo: null }, { mmsi: null, imo: '9321483' }, { mmsi: null, imo: null }, { mmsi: null, imo: null }]));
    const PM = { state: { vessels: [
      { nomUid: 'm1', name: 'MIKE ONE', imo: '9321483', mmsi: '636012345' },  // both boxes → ONE vessel, keyed by its MMSI
      { nomUid: 'm2', name: 'MIKE TWO', imo: '', mmsi: '538009876' },         // MMSI box only
      { nomUid: 'm3', name: 'MIKE THREE', imo: '538001234' },                 // legacy: MMSI typed in the IMO box
      { nomUid: 'm4', name: 'MIKE ONE AGAIN', imo: '9321483' },               // same IMO as m1 → same vessel
      { nomUid: 'm5', name: 'MIKE FIVE', imo: '9074729' },                    // IMO only …
      { nomUid: 'm6', name: 'MIKE FIVE', imo: '9074729', mmsi: '211111111' }, // … a later card with the same IMO adds its MMSI
      { nomUid: 'm7', name: 'Name Only' },
    ], lastSched: [{ sno: 1, nomUid: 'm2', name: 'MIKE TWO' }] } };
    const tm = AIS.trackedFromPayload(PM);
    check('E2 tracked from the MMSI box: one entry per vessel (cards sharing an MMSI / IMO merge), key mmsi: when known, legacy 9-digit IMO box = MMSI',
      tm.map(t => t.key).join(',') === 'mmsi:636012345,mmsi:538009876,mmsi:538001234,imo:9074729,name:NAME ONLY' &&
      tm[0].imo === '9321483' && tm[0].mmsi === '636012345' && tm[2].mmsi === '538001234' && tm[2].imo === null && tm[3].mmsi === '211111111' && tm[3].imo === '9074729', tm);
    const cm = AIS.buildContext(tm, [{ mmsi: '311000555', imo: '9321483', name: 'MIKE ONE' }, { mmsi: '311000556', imo: null, name: 'MIKE TWO' }]);
    check('E2 context: a vessel with MMSI + IMO is in trackedMmsi AND trackedImo (same key); only ID-less vessels are name-tracked; an earlier IMO link joins the same vessel',
      [...cm.trackedMmsi.keys()].join(',') === '636012345,538009876,538001234,211111111' && cm.trackedImo.get('9321483') === 'mmsi:636012345' && cm.trackedImo.get('9074729') === 'imo:9074729' &&
      [...cm.trackedNames.keys()].join(',') === 'NAME ONLY' && cm.known.get('311000555').by === 'imo' && cm.known.get('311000555').key === 'mmsi:636012345' && !cm.known.has('311000556') && cm.known.get('538009876').by === 'mmsi', { mm: [...cm.trackedMmsi.keys()], names: [...cm.trackedNames.keys()], known: [...cm.known] });
    const pb0 = AIS.pickPhaseBMmsis(cm, new Map(), 50);
    const obsM = new Map([['311000555', { mmsi: '311000555', key: 'mmsi:636012345', position_time: Date.now() }]]);
    const pb1 = AIS.pickPhaseBMmsis(cm, obsM, 50);
    check('E2 phase B prefers the MMSIs typed on the cards, then learned ones; a vessel already found through another MMSI goes last',
      pb0.join(',') === '636012345,538009876,538001234,211111111,311000555' && pb1.join(',') === '538009876,538001234,211111111,636012345', { pb0, pb1 });
    const nowM = Date.now();
    check('E2 prefilter: positions of MMSIs from the MMSI box are parsed; a same-name ship of an MMSI vessel is not a name match',
      AIS.prefilter(posMsg('538009876', 'WHATEVER', 25, 56, nowM), cm) === true && AIS.prefilter(posMsg('211111111', 'X', 25, 56, nowM), cm) === true && AIS.prefilter(posMsg('311000999', 'MIKE TWO', 25, 56, nowM), cm) === '311000999');
    const tr = AIS.trackedFromPayload(PAYLOAD);
    check('E2 tracked = cards + schedule items without a card; a card\'s own schedule row (same nomUid or name) adds nothing',
      tr.length === 5 && tr.map(t => t.key).join(',') === 'imo:9000001,mmsi:538000002,name:SEA BREEZE,imo:9000004,name:ECHO SCHED', tr.map(t => t.key));
    const one = AIS.trackedFromPayload({ state: { vessels: [{ nomUid: 'n1', name: 'ALPHA STAR', imo: '9000001' }], lastSched: [{ sno: 1, nomUid: 'n1', name: 'ALPHA STAR', area: 'FUJ-A' }] } });
    const ctx1 = AIS.buildContext(one, []);
    check('E2 an IMO card + its schedule row = ONE tracked vessel, and its name is not name-tracked', one.length === 1 && one[0].key === 'imo:9000001' && ctx1.trackedNames.size === 0, one);
    check('E2 tracked vessels tolerate a missing / odd payload', AIS.trackedFromPayload(null).length === 0 && AIS.trackedFromPayload({ state: { vessels: 'x', lastSched: [null, 5] } }).length === 0);
    const a = AIS.buildSubscription('K', 'A', { regionBox: AIS.DEFAULTS.regionBox });
    const b = AIS.buildSubscription('K', 'B', { mmsi: Array.from({ length: 60 }, (_, i) => 200000000 + i) });
    check('E2 phase A subscription: region box, no MMSI filter, Class A types',
      a.APIKey === 'K' && JSON.stringify(a.BoundingBoxes) === '[[[22,54],[27.5,60.5]]]' && !('FiltersShipMMSI' in a) && a.FilterMessageTypes.includes('PositionReport') && a.FilterMessageTypes.includes('ShipStaticData'), a);
    check('E2 phase B subscription: worldwide box, FiltersShipMMSI as strings, capped at 50',
      JSON.stringify(b.BoundingBoxes) === '[[[-90,-180],[90,180]]]' && b.FiltersShipMMSI.length === 50 && b.FiltersShipMMSI.every(x => typeof x === 'string') && b.FiltersShipMMSI[0] === '200000000', b.FiltersShipMMSI.length);
    // time budget (worker age): phase B is cut first, then phase A
    const D = AIS.DEFAULTS, P = (left) => AIS.planPhases(D, left);
    const fresh = P(140000 - 8000), age70 = P(140000 - 8000 - 70000), age50 = P(140000 - 8000 - 50000);
    check('E2 phases planned against the worker\'s age: fresh 65+25 s; 50 s old → phase B shortened to 17 s; 70 s old → phase A only',
      fresh.a === 65000 && fresh.b === 25000 && age50.a === 65000 && age50.b === 17000 && age70.a === 62000 && age70.b === 0, { fresh, age50, age70 });
    // prefilter
    const ctx = AIS.buildContext(tr, [{ mmsi: MMSI.echo, imo: '9000005', name: 'ECHO SCHED' }]);
    const now = Date.now();
    const realParse = JSON.parse; let parses = 0;
    JSON.parse = function () { parses++; return realParse.apply(this, arguments); };
    const d = [
      AIS.prefilter(posMsg(MMSI.echo, 'ECHO SCHED', 25, 56, now), ctx),          // known from an earlier run
      AIS.prefilter(posMsg(MMSI.bravo, 'BRAVO WAVE', 25, 56, now), ctx),         // tracked MMSI
      AIS.prefilter(staticMsg('311000001', 9000001, 'ALPHA STAR', now), ctx),    // static with a tracked IMO
      AIS.prefilter(posMsg(MMSI.sea, 'SEA BREEZE', 25, 56, now), ctx),           // tracked name (ShipName)
      AIS.prefilter(posMsg('311000009', 'ALPHA STAR', 25, 56, now), ctx),        // name of an IMO card → NOT a name match
      AIS.prefilter(posMsg('211111111', 'NOISE', 25, 56, now), ctx),             // unknown position → keep raw
      AIS.prefilter(staticMsg('211111112', 9111111, 'OTHER', now), ctx),         // unrelated static → skip
      AIS.prefilter('{"error": "Api Key Is Not Valid"}', ctx),                   // aisstream error
    ];
    JSON.parse = realParse;
    check('E2 prefilter: parse tracked / known / static-with-IMO / name-only vessels; keep unknown positions raw; skip the rest',
      JSON.stringify(d) === JSON.stringify([true, true, true, true, '311000009', '211111111', false, true]), d);
    check('E2 prefilter never calls JSON.parse on a message', parses === 0, parses);
    // names with JSON escapes (Go escapes & < >; quotes / backslashes always)
    const esc = [
      AIS.scanString(posMsg('311000777', 'P&O NEPTUNE', 25, 56, now), '"ShipName":'),
      AIS.scanString('{"ShipName":"SEA \\"STAR\\"   ","x":1}', '"ShipName":'),
      AIS.scanString('{"ShipName":"A\\\\B","x":1}', '"ShipName":'),
      AIS.scanString('{"ShipName":"PLAIN","x":1}', '"ShipName":'),
    ];
    check('E2 scanString decodes JSON escapes (\\u0026, \\", \\\\)', esc[0].trim() === 'P&O NEPTUNE' && esc[1].trim() === 'SEA "STAR"' && esc[2] === 'A\\B' && esc[3] === 'PLAIN', esc);
    const ctxE = AIS.buildContext(AIS.trackedFromPayload({ state: { vessels: [{ name: 'P&O Neptune' }, { name: 'Sea "Star"' }, { name: 'Maran Gas Alexandroupolis' }] } }), []);
    const dE = [
      AIS.prefilter(posMsg('311000777', 'P&O NEPTUNE', 25, 56, now), ctxE),
      AIS.prefilter(staticMsg('311000777', 0, 'P&O NEPTUNE', now), ctxE),
      AIS.prefilter(posMsg('311000778', 'SEA "STAR"', 25, 56, now), ctxE),
      AIS.prefilter(posMsg('311000779', 'MARAN GAS ALEXANDROU', 25, 56, now), ctxE),
    ];
    check('E2 prefilter matches names with &, quotes and AIS-truncated 20-char names', dE.every(x => x === true), dE);
    // parsing
    const meta = { time_utc: '2026-10-15 10:11:12.987654321 +0000 UTC' };
    check('E2 time_utc parsed to the millisecond (UTC)', new Date(AIS.parseAisTime(meta.time_utc, 0)).toISOString() === '2026-10-15T10:11:12.987Z' && AIS.parseAisTime('garbage', 42) === 42);
    const Pp = (bd) => AIS.parsePosition(bd, meta, 0);
    check('E2 invalid fixes dropped: 91/181, Valid=false, 0/0',
      Pp({ Latitude: 91, Longitude: 181 }) === null && Pp({ Latitude: 25, Longitude: 181 }) === null && Pp({ Latitude: 25, Longitude: 56, Valid: false }) === null && Pp({ Latitude: 0, Longitude: 0 }) === null);
    const pp = Pp({ Latitude: 25.123, Longitude: 56.456, Sog: 102.3, Cog: 360, TrueHeading: 511, NavigationalStatus: 1 });
    check('E2 "not available" values become null (SOG 102.3, COG 360, heading 511)', pp && pp.sog === null && pp.cog === null && pp.heading === null && pp.nav_status === 1 && pp.lat === 25.123, pp);
    check('E2 AIS ETA formatted as broadcast ("10-16 14:00"), month 0 = none, hour 24 = date only',
      AIS.formatAisEta({ Month: 10, Day: 16, Hour: 14, Minute: 0 }) === '10-16 14:00' && AIS.formatAisEta({ Month: 0, Day: 0, Hour: 24, Minute: 60 }) === null && AIS.formatAisEta({ Month: 3, Day: 2, Hour: 24, Minute: 60 }) === '03-02');
    const st = AIS.parseStatic({ ImoNumber: 0, Name: 'X@@', Destination: '@@@@', MaximumStaticDraught: 0 }, meta, 0);
    check('E2 static data: IMO 0 / empty destination / draught 0 → null', st.imo === null && st.destination === null && st.draught === null && st.name === 'X', st);
    // newer-position rule
    const ex = { mmsi: '311000001', lat: 1, lon: 2, sog: 3, position_time: '2026-10-15T10:00:00.000Z', destination: 'OLD', static_time: '2026-10-15T10:00:00.000Z', imo: '9000001' };
    const older = AIS.mergeRow(ex, { mmsi: '311000001', by: 'imo', lat: 9, lon: 9, sog: 9, position_time: Date.parse('2026-10-15T09:00:00Z'), static_time: Date.parse('2026-10-15T09:00:00Z'), destination: 'STALE' }, 'NOW');
    const newer = AIS.mergeRow(ex, { mmsi: '311000001', by: 'imo', lat: 9, lon: 8, sog: 7, position_time: Date.parse('2026-10-15T11:00:00Z'), static_time: Date.parse('2026-10-15T11:00:00Z'), destination: 'NEW' }, 'NOW');
    check('E2 merge: an older time_utc never overwrites the stored position / static data', older.lat === 1 && older.position_time === ex.position_time && older.destination === 'OLD' && older.updated_at === 'NOW' && older.matched_by === 'imo', older);
    check('E2 merge: a newer one replaces them; every column present (bulk upsert)', newer.lat === 9 && newer.lon === 8 && newer.position_time === '2026-10-15T11:00:00.000Z' && newer.destination === 'NEW' && AIS.ROW_COLUMNS.every(c => c in newer), newer);
    const obs = new Map();
    AIS.observe(obs, '1', { by: 'name', key: 'k' }, { pos: { lat: 1, lon: 1, position_time: 200 } });
    AIS.observe(obs, '1', { by: 'imo', key: 'k2' }, { pos: { lat: 2, lon: 2, position_time: 100 } });
    check('E2 within a run the newest position wins; a later IMO match replaces a name match', obs.get('1').lat === 1 && obs.get('1').by === 'imo' && obs.get('1').key === 'k2');
    // prune list
    const old = Date.now() - 40 * 86400000, ctxP = AIS.buildContext(AIS.trackedFromPayload(PAYLOAD), [{ mmsi: MMSI.delta, imo: '9000004' }]);
    const pl = AIS.pruneList([{ mmsi: MMSI.delta, imo: '9000004', updated_at: new Date(old).toISOString() }, { mmsi: '999000001', updated_at: new Date(old).toISOString() }, { mmsi: '999000002', updated_at: new Date().toISOString() }], ctxP, Date.now() - 30 * 86400000);
    check('E2 prune: only rows untouched for 30 days AND not linked to a tracked vessel', JSON.stringify(pl) === '["999000001"]', pl);
    const txt = '{"a":1}';
    const viaBlob = AIS.messageText(new Blob([txt]));
    check('E2 messageText: string, ArrayBuffer, Uint8Array, Blob (async)',
      AIS.messageText(txt) === txt && AIS.messageText(new TextEncoder().encode(txt).buffer) === txt && AIS.messageText(new TextEncoder().encode(txt)) === txt && typeof viaBlob.then === 'function' && (await viaBlob) === txt);
    const cfg = AIS.makeConfig(k => ({ AIS_PHASE_A_SECONDS: '200', AIS_PHASE_B_SECONDS: '100', AIS_REGION_BOX: '20,50,30,60', AISSTREAM_API_KEY: 'K' })[k]);
    check('E2 config from env (sanity caps; the real limit comes from the worker age)', cfg.phaseAms === 120000 && cfg.phaseBms === 100000 && JSON.stringify(cfg.regionBox) === '[[20,50],[30,60]]' && cfg.apiKey === 'K' && cfg.wallBudgetMs === 140000, cfg);
    check('E2 safeEqual', AIS.safeEqual('abc', 'abc') && !AIS.safeEqual('abc', 'abd') && !AIS.safeEqual('abc', 'abcd'));
  }

  /* ── 3. End-to-end against a mock aisstream ── */
  let script = () => {};
  const srv = await startWsServer(conn => script(conn));
  const ENV = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key', AISSTREAM_API_KEY: 'test-key', AIS_CRON_SECRET: 'cron-secret-123' };
  const baseCfg = { url: srv.url, phaseAms: 1500, phaseBms: 800, openTimeoutMs: 3000, minPhaseBms: 200, reconnectMinMs: 300 };
  const call = (fake, headers, extra) => {
    extra = extra || {};
    const req = new Request('http://localhost/functions/v1/ais-poll', { method: extra.method || 'POST', headers: headers || {}, body: (extra.method || 'POST') === 'POST' ? '{}' : undefined });
    return AIS.handleRequest(req, Object.assign({
      env: k => (extra.env || ENV)[k],
      createClient: (url, key) => { fake.created = { url, key }; return fake.client; },
      config: Object.assign({}, baseCfg, extra.config || {}),
      log: false,
    }, extra.deps || {}));
  };
  const CRON = { 'x-cron-secret': 'cron-secret-123' };
  const send = (conn, list) => list.forEach(([m, bin]) => conn.send(m, bin));

  // The main mock stream: everything an aisstream run could throw at us.
  const T = Date.now();
  let subs = [], firstMsgDelay = null;
  const mainScript = (conn) => {
    subs = [];
    conn.on('message', async (raw) => {
      const sub = JSON.parse(String(raw));
      subs.push(sub);
      if (subs.length === 1) {
        firstMsgDelay = Date.now() - conn.connectedAt;
        const noise = [];
        for (let i = 0; i < 300; i++) noise.push([posMsg(String(200000000 + i), 'NOISE ' + i, 25 + i / 1000, 56.5, T - 60000), i % 2 === 1]);
        for (let i = 0; i < 40; i++) noise.push([staticMsg(String(210000000 + i), 9100000 + i, 'OTHER ' + i, T - 60000), i % 3 === 0]);
        send(conn, noise.slice(0, 170));
        await sleep(20);
        send(conn, [
          [posMsg(MMSI.alpha, 'ALPHA STAR', 25.30, 56.90, T - 10 * 60000, { sog: 10 }), false], // position first (Class A: every few s)
          [posMsg(MMSI.decoy, 'ALPHA STAR', 24.10, 55.10, T - 4 * 60000, { sog: 7 }), true],   // another ship with the same name
          [staticMsg(MMSI.alpha, 9000001, 'ALPHA STAR', T - 9 * 60000), true],                  // IMO 9000001 → learn MMSI (binary frame)
          [posMsg(MMSI.alpha, 'ALPHA STAR', 24.00, 57.50, T - 20 * 60000, { sog: 3 }), false], // OLDER position → ignored
          [posMsg(MMSI.sea, 'SEA BREEZE', 91, 181, T - 6 * 60000), true],                      // invalid fix
          [posMsg(MMSI.sea, 'SEA BREEZE', 25.21, 56.37, T - 5 * 60000, { sog: 0.2, nav: 5 }), false],
          [posMsg(MMSI.echo, 'ECHO SCHED', 10.0, 10.0, T - 30 * 60000), true],                 // older than the stored row
        ]);
        await sleep(20);
        send(conn, noise.slice(170));
      } else if (subs.length === 2) {
        send(conn, [[posMsg(MMSI.bravo, 'BRAVO WAVE', 1.25, 103.8, T - 2 * 60000, { sog: 12.5 }), true]]); // Singapore Strait
      }
    });
  };

  // 3a — a full run (no EdgeRuntime → the request waits and returns 200)
  {
    script = mainScript;
    const fake = makeFakeDb({
      payload: PAYLOAD,
      positions: [{ mmsi: MMSI.echo, imo: '9000005', name: 'ECHO SCHED', lat: 25.2, lon: 56.4, sog: 0, matched_by: 'name', position_time: new Date(T - 60000).toISOString(), updated_at: new Date(T - 600000).toISOString() },
        { mmsi: MMSI.delta, imo: '9000004', name: 'DELTA GHOST', lat: -30, lon: 40, matched_by: 'imo', position_time: new Date(T - 40 * 86400000).toISOString(), updated_at: new Date(T - 40 * 86400000).toISOString() },
        { mmsi: '999000001', imo: null, name: 'OLD ROW', lat: 1, lon: 1, matched_by: 'name', position_time: new Date(T - 40 * 86400000).toISOString(), updated_at: new Date(T - 40 * 86400000).toISOString() }],
      status: {},
    });
    const realParse = JSON.parse; const parsedTexts = [];
    JSON.parse = function (s) { if (typeof s === 'string' && s.indexOf('"MessageType"') !== -1) parsedTexts.push(s); return realParse.apply(this, arguments); };
    const t0 = Date.now();
    const res = await call(fake, CRON);
    JSON.parse = realParse;
    const body = await res.json();
    check('E3 cron call runs the collection and answers 200 with a summary (tracked 5, no double count of scheduled vessels)', res.status === 200 && body.ok === true && body.complete === true && body.tracked === 5 && body.found === 4, body);
    check('E3 service-role client created from SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY', fake.created && fake.created.url === ENV.SUPABASE_URL && fake.created.key === 'service-key');
    check('E3 subscription sent within 3 s of connecting (' + firstMsgDelay + ' ms)', firstMsgDelay != null && firstMsgDelay < 3000);
    const A = subs[0], B = subs[1];
    check('E3 phase A: API key, Gulf of Oman / Hormuz box, no MMSI filter',
      A && A.APIKey === 'test-key' && JSON.stringify(A.BoundingBoxes) === '[[[22,54],[27.5,60.5]]]' && !A.FiltersShipMMSI, A);
    check('E3 phase B replaces it: worldwide box + FiltersShipMMSI (strings) of the known MMSIs not seen yet (incl. a 40-day-old link)',
      B && JSON.stringify(B.BoundingBoxes) === '[[[-90,-180],[90,180]]]' && Array.isArray(B.FiltersShipMMSI) && B.FiltersShipMMSI.includes(MMSI.bravo) && B.FiltersShipMMSI.includes(MMSI.delta) &&
      !B.FiltersShipMMSI.includes(MMSI.alpha) && !B.FiltersShipMMSI.includes(MMSI.sea) && !B.FiltersShipMMSI.includes(MMSI.decoy) && B.FiltersShipMMSI.every(x => typeof x === 'string') && B.FiltersShipMMSI.length <= 50, B);
    check('E3 one WebSocket connection for the run', srv.connections.length === 1, srv.connections.length);
    const noiseParsed = parsedTexts.filter(s => /"MMSI":(20\d{7}|21\d{7}|636000999)/.test(s));
    check('E3 CPU: the 341 unrelated messages (incl. a same-name ship) were never JSON.parse\'d (' + parsedTexts.length + ' parses for ' + body.messages + ' messages)',
      noiseParsed.length === 0 && parsedTexts.length === 7 && body.parsed === 7 && body.messages === 348, { noise: noiseParsed.length, parses: parsedTexts.length, body });
    const alpha = fake.row(MMSI.alpha), bravo = fake.row(MMSI.bravo), sea = fake.row(MMSI.sea), echo = fake.row(MMSI.echo);
    check('E3 IMO → MMSI learned from ShipStaticData; the position sent before it was kept and used; matched_by imo (not name)',
      alpha && alpha.imo === '9000001' && alpha.matched_by === 'imo' && alpha.lat === 25.30 && alpha.lon === 56.90 && alpha.position_time === new Date(T - 10 * 60000).toISOString(), alpha);
    check('E3 an older position later in the run did not overwrite the newer one', alpha && alpha.sog === 10 && alpha.lat !== 24.0);
    check('E3 a different ship with the same name as an IMO nomination is not stored', !fake.row(MMSI.decoy));
    check('E3 static data stored: name, destination (no @ padding), AIS ETA as given, draught, static_time',
      alpha && alpha.name === 'ALPHA STAR' && alpha.destination === 'FUJAIRAH' && alpha.ais_eta === '10-16 14:00' && alpha.draught === 12.5 && alpha.static_time === new Date(T - 9 * 60000).toISOString(), alpha);
    check('E3 MMSI-tracked vessel caught in phase B (worldwide)', bravo && bravo.matched_by === 'mmsi' && bravo.lat === 1.25 && bravo.sog === 12.5, bravo);
    check('E3 name-only vessel matched by normalised name ("MV Sea  Breeze" = AIS "SEA BREEZE"), invalid 91/181 fix ignored',
      sea && sea.matched_by === 'name' && sea.name === 'SEA BREEZE' && sea.lat === 25.21 && sea.nav_status === 5, sea);
    check('E3 scheduled vessel without a card tracked by name; stored NEWER position kept (older time_utc ignored), updated_at refreshed',
      echo && echo.lat === 25.2 && echo.position_time === new Date(T - 60000).toISOString() && Date.parse(echo.updated_at) >= t0, echo);
    check('E3 prune: a 30-day-old unrelated row deleted, the 40-day-old link of a still-nominated vessel kept',
      !fake.row('999000001') && !!fake.row(MMSI.delta) && fake.tables.ais_positions.size === 5 && !fake.row('200000001'), [...fake.tables.ais_positions.keys()]);
    const st = fake.status();
    check('E3 ais_status: ok, tracked 5, found 4, messages, duration, last_ok_at, lock released; last_cron_at = when the scheduled call ARRIVED',
      st.ok === true && st.tracked === 5 && st.found === 4 && st.messages === 348 && st.duration_ms > 1000 && st.last_ok_at === st.last_run_at && st.running_since === null && st.error === null &&
      Date.parse(st.last_cron_at) >= t0 && Date.parse(st.last_cron_at) < Date.parse(st.last_run_at) - 1000, st);
    const upserts = fake.log.filter(o => o.table === 'ais_positions' && o.action === 'upsert');
    check('E3 phase A saved at the switch (checkpoint), then everything at the end — upserts on mmsi',
      upserts.length === 2 && upserts.every(u => u.opts.onConflict === 'mmsi') && upserts[0].rows.some(r => r.mmsi === MMSI.alpha) && !upserts[0].rows.some(r => r.mmsi === MMSI.bravo) && upserts[1].rows.some(r => r.mmsi === MMSI.bravo), upserts.map(u => u.rows.map(r => r.mmsi)));
    check('E3 the workspace is only read, never written', fake.log.filter(o => o.table === 'abps_workspace' && o.action !== 'select').length === 0);

    // 3b — throttle: a successful run < 2 min ago → cached status, no connection
    const n0 = srv.connections.length;
    const r2 = await call(fake, { Authorization: 'Bearer jwt-operator' });
    const b2 = await r2.json();
    check('E3 throttle: a second call within 2 min returns the cached status without connecting',
      r2.status === 200 && b2.throttled === true && b2.status && b2.status.found === 4 && srv.connections.length === n0, b2);
    const lc0 = fake.status().last_cron_at;
    await sleep(20);
    const r3 = await call(fake, CRON);
    const b3 = await r3.json();
    check('E3 a scheduled call skipped by the throttle (HTTP 200) still records that it arrived (last_cron_at moves)',
      r3.status === 200 && b3.throttled === true && Date.parse(fake.status().last_cron_at) > Date.parse(lc0) && srv.connections.length === n0, [lc0, fake.status().last_cron_at]);
  }

  // 3m — a run where the nominations carry the MMSI box: typed MMSIs drive phase A matching and the phase B filter
  {
    let subsM = [];
    script = (conn) => {
      subsM = [];
      conn.on('message', async (raw) => {
        subsM.push(JSON.parse(String(raw)));
        if (subsM.length === 1) {
          send(conn, [
            [posMsg('636012345', 'MIKE ONE', 25.30, 56.90, T - 5 * 60000, { sog: 9 }), false],            // MMSI box of MIKE ONE (it also has an IMO)
            [posMsg('311000999', 'MIKE TWO', 25.10, 56.80, T - 5 * 60000), false],                          // same name as an MMSI vessel → ignored
          ]);
        } else if (subsM.length === 2) {
          send(conn, [[posMsg('538009876', 'MIKE TWO', 1.25, 103.8, T - 2 * 60000, { sog: 12 }), true], [posMsg('538001234', 'MIKE THREE', 10.5, 60.1, T - 3 * 60000), false]]);
        }
      });
    };
    const fake = makeFakeDb({ payload: { version: 9, state: { vessels: [
      { nomUid: 'm1', name: 'MIKE ONE', imo: '9321483', mmsi: '636012345', area: 'FUJ-A' },
      { nomUid: 'm2', name: 'MIKE TWO', imo: '', mmsi: '538009876', area: 'KFK-A' },
      { nomUid: 'm3', name: 'MIKE THREE', imo: '538001234', area: 'FUJ-A' },
    ], lastSched: [] } }, status: {} });
    const res = await call(fake, CRON);
    const body = await res.json();
    const one = fake.row('636012345'), two = fake.row('538009876'), three = fake.row('538001234');
    check('E3m MMSI box: tracked 3, all found; MIKE ONE (MMSI + IMO) matched by its MMSI in phase A', res.status === 200 && body.ok === true && body.tracked === 3 && body.found === 3 && one && one.matched_by === 'mmsi' && one.lat === 25.30, { body, one });
    check('E3m phase B filter = the typed MMSIs not seen yet (MMSI box first, then the legacy one); the same-name ship is not stored',
      subsM[1] && JSON.stringify(subsM[1].FiltersShipMMSI) === JSON.stringify(['538009876', '538001234']) && !fake.row('311000999'), subsM[1] && subsM[1].FiltersShipMMSI);
    check('E3m MMSI-box and legacy vessels stored from phase B (matched_by mmsi)', two && two.matched_by === 'mmsi' && two.lat === 1.25 && three && three.matched_by === 'mmsi', { two, three });
  }

  // 3c — auth + CORS (+ rejections are logged)
  {
    const fake = makeFakeDb({ payload: PAYLOAD, status: { last_ok_at: new Date().toISOString(), last_run_at: new Date().toISOString(), ok: true } });
    const pre = await call(fake, { Origin: 'https://flow.example', 'Access-Control-Request-Method': 'POST' }, { method: 'OPTIONS' });
    check('E4 CORS preflight answered (allows authorization + x-cron-secret)',
      pre.status === 200 && pre.headers.get('access-control-allow-origin') === '*' && /x-cron-secret/.test(pre.headers.get('access-control-allow-headers')) && /authorization/.test(pre.headers.get('access-control-allow-headers')));
    const codes = {};
    for (const [label, h] of [['none', {}], ['badSecret', { 'x-cron-secret': 'nope' }], ['badJwt', { Authorization: 'Bearer forged' }], ['anonKey', { Authorization: 'Bearer anon-key-jwt' }], ['trader', { Authorization: 'Bearer jwt-trader' }], ['noRole', { Authorization: 'Bearer jwt-norole' }], ['operator', { Authorization: 'Bearer jwt-operator' }], ['cron', CRON]]) {
      const r = await call(fake, h);
      codes[label] = r.status + (r.headers.get('access-control-allow-origin') === '*' ? '' : ' (no CORS)');
    }
    check('E4 auth: no credentials / wrong secret / bad JWT → 401, trader / no role → 403, operator JWT and cron secret accepted',
      codes.none === '401' && codes.badSecret === '401' && codes.badJwt === '401' && codes.anonKey === '401' && codes.trader === '403' && codes.noRole === '403' && codes.operator === '200' && codes.cron === '200', codes);
    const logs = [];
    const cap = { info: m => logs.push(['info', m]), warn: m => logs.push(['warn', m]), error: m => logs.push(['error', m]) };
    const noSecret = await call(fake, { 'x-cron-secret': 'whatever' }, { env: Object.assign({}, ENV, { AIS_CRON_SECRET: '' }), deps: { log: cap } });
    const nb = await noSecret.json();
    check('E4 with no AIS_CRON_SECRET configured, no cron secret is accepted — and the reason is said', noSecret.status === 401 && /AIS_CRON_SECRET secret is not set/.test(nb.error), nb);
    await call(fake, { 'x-cron-secret': 'typo' }, { deps: { log: cap } });
    check('E4 rejected calls are logged (Edge Functions → Logs)', logs.some(l => l[0] === 'warn' && /rejected 401: Invalid cron secret/.test(l[1])) && logs.some(l => /AIS_CRON_SECRET secret is not set/.test(l[1])), logs);
    const missing = makeFakeDb({ payload: PAYLOAD, missing: ['ais_status'] });
    const rm = await call(missing, CRON);
    check('E4 tables not created yet → clear 500 "run supabase_ais_setup.sql"', rm.status === 500 && /supabase_ais_setup\.sql/.test((await rm.json()).error));
  }

  // 3d — background mode (EdgeRuntime.waitUntil): 202 at once, collection continues; lock
  {
    script = mainScript;
    const fake = makeFakeDb({ payload: PAYLOAD, status: {} });
    const bg = [];
    const deps = { waitUntil: p => bg.push(p) };
    const n0 = srv.connections.length;
    const t0 = Date.now();
    const r = await call(fake, { Authorization: 'Bearer jwt-operator' }, { deps });
    const dt = Date.now() - t0;
    const b = await r.json();
    check('E5 background mode: 202 {started:true} straight away (' + dt + ' ms), work handed to waitUntil',
      r.status === 202 && b.started === true && b.via === 'operator' && bg.length === 1 && dt < 1000, b);
    check('E5 the run is marked in ais_status.running_since while it collects', !!fake.status().running_since && !fake.status().last_run_at, fake.status());
    await sleep(150);
    const opRunCron = fake.status().last_cron_at;
    const tCron = Date.now();
    const r2 = await call(fake, CRON, { deps });
    const b2 = await r2.json();
    const cronSeen = fake.status().last_cron_at;
    check('E5 a scheduled call during the run → 200 {running:true}, nothing new started — but its arrival is recorded',
      r2.status === 200 && b2.running === true && bg.length === 1 && opRunCron === undefined && Date.parse(cronSeen) >= tCron - 5, [b2, opRunCron, cronSeen]);
    const result = await bg[0];
    const st = fake.status();
    check('E5 the background run finished: ais_status written, lock released, positions stored; the operator run did not touch last_cron_at',
      result.ok === true && st.ok === true && st.found === 4 && st.running_since === null && !!st.last_run_at && st.last_cron_at === cronSeen && fake.tables.ais_positions.size === 4 && srv.connections.length === n0 + 1, { result, st });
    // stale lock (a run killed mid-way) is ignored after 3 min
    fake.tables.ais_status.set('1', { id: 1, running_since: new Date(Date.now() - 4 * 60000).toISOString(), last_ok_at: new Date(Date.now() - 20 * 60000).toISOString() });
    const r3 = await call(fake, CRON, { deps });
    check('E5 a stale lock (> 3 min) does not block a new run', r3.status === 202 && bg.length === 2);
    await bg[1];
    // a fresh lock taken by someone else between the status read and the claim
    fake.tables.ais_status.set('1', { id: 1, running_since: null, last_ok_at: null });
    const origFrom = fake.client.from;
    let reads = 0;
    fake.client.from = (t) => {
      const q = origFrom(t);
      if (t === 'ais_status') { const sel = q.maybeSingle.bind(q); q.maybeSingle = () => { if (++reads === 1) fake.tables.ais_status.get('1').running_since = new Date().toISOString(); return sel(); }; }
      return q;
    };
    const r4 = await call(fake, CRON, { deps });
    fake.client.from = origFrom;
    const b4 = await r4.json();
    check('E5 the lock is claimed atomically (a concurrent run wins → running:true); the scheduled call is still recorded', r4.status === 200 && b4.running === true && bg.length === 2 && !!fake.status().last_cron_at, b4);
  }

  // 3e — the worker's 150 s clock (warm worker reuse) + runtime shutdown
  {
    script = mainScript;
    const tiny = { wallBudgetMs: 6000, reserveMs: 500, minRunMs: 1000, phaseAms: 1500, phaseBms: 1500 };
    const fake = makeFakeDb({ payload: PAYLOAD, status: {} });
    const n0 = srv.connections.length;
    const r1 = await call(fake, CRON, { config: tiny, deps: { bootMs: Date.now() - 5000 } });
    const b1 = await r1.json();
    check('E6 a worker too close to its limit does not start (no connection, no lock) and says why',
      r1.status === 200 && b1.busy === true && b1.deferred === true && /time limit/.test(b1.error) && srv.connections.length === n0 && !fake.status().running_since && !!fake.status().last_cron_at, b1);
    const t0 = Date.now();
    const r2 = await call(fake, CRON, { config: tiny, deps: { bootMs: Date.now() - 3600 } });
    const b2 = await r2.json();
    const took = Date.now() - t0;
    check('E6 a warm worker: phase B is shortened to fit the worker\'s remaining time (A ' + b2.phases.a + ' ms, B ' + b2.phases.b + ' ms, run ' + took + ' ms)',
      r2.status === 200 && b2.ok === true && b2.phases.a === 1500 && b2.phases.b > 0 && b2.phases.b < 1500 && took < 2600 && subs.length === 2, b2);
    // runtime shutdown (beforeunload → interruptRuns) mid-run: partial results saved, ok=false, lock released
    script = (conn) => conn.on('message', () => {
      send(conn, [[posMsg(MMSI.sea, 'SEA BREEZE', 25.2, 56.4, Date.now() - 60000, { sog: 0.1 }), false], [staticMsg(MMSI.alpha, 9000001, 'ALPHA STAR', Date.now() - 1000), false]]);
    });
    const fake2 = makeFakeDb({ payload: PAYLOAD, status: { last_ok_at: new Date(Date.now() - 30 * 60000).toISOString() } });
    const bg = [];
    const okBefore = fake2.status().last_ok_at;
    const r3 = await call(fake2, CRON, { config: { phaseAms: 8000, phaseBms: 5000 }, deps: { waitUntil: p => bg.push(p) } });
    await sleep(400);
    const n = AIS.interruptRuns('WallClockTime');
    const t1 = Date.now();
    const res = await bg[0];
    const st = fake2.status();
    check('E6 beforeunload: the running run stops at once (' + (Date.now() - t1) + ' ms) and saves what it has',
      r3.status === 202 && n === 1 && Date.now() - t1 < 1500 && fake2.row(MMSI.sea) && fake2.row(MMSI.sea).lat === 25.2 && AIS.ACTIVE_RUNS.size === 0, res);
    check('E6 …recording ok=false "Interrupted by the runtime (WallClockTime) — partial results saved", lock released, last_ok_at unchanged',
      st.ok === false && /^Interrupted by the runtime \(WallClockTime\) — partial results saved$/.test(st.error) && st.running_since === null && st.last_ok_at === okBefore, st);
    check('E6 interruptRuns with nothing running is harmless', AIS.interruptRuns('EarlyDrop') === 0);
  }

  // 3f — Blob frames (binaryType 'blob') + text frames; long and escaped names end to end
  {
    script = (conn) => conn.on('message', () => {
      send(conn, [
        [posMsg(MMSI.bravo, 'BRAVO WAVE', 25.5, 56.8, Date.now() - 60000, { sog: 9 }), true],
        [posMsg('201000000', 'NOISE', 25, 56, Date.now()), true],
        [posMsg(MMSI.sea, 'SEA BREEZE', 25.2, 56.4, Date.now() - 1000), false],
        [posMsg('311000777', 'P&O NEPTUNE', 25.3, 56.5, Date.now() - 2000), true],
        [posMsg('311000779', 'MARAN GAS ALEXANDROU', 25.1, 56.6, Date.now() - 3000), false],
      ]);
    });
    const fake = makeFakeDb({ payload: { state: { vessels: [{ name: 'B', imo: MMSI.bravo }, { name: 'Sea Breeze' }, { name: 'P&O Neptune' }, { name: 'MV Maran Gas Alexandroupolis' }] } }, status: {} });
    const r = await call(fake, CRON, { config: { binaryType: 'blob', phaseAms: 3000 } });
    const b = await r.json();
    const po = fake.row('311000777'), mg = fake.row('311000779');
    check('E7 binary frames delivered as Blob are read too (and early exit once every vessel is found)',
      r.status === 200 && b.found === 4 && fake.row(MMSI.bravo) && fake.row(MMSI.bravo).lat === 25.5 && fake.row(MMSI.sea) && b.duration_ms < 2500, b);
    check('E7 "P&O Neptune" (sent as P\\u0026O) and a 25-character name (AIS keeps 20) are matched by name',
      po && po.name === 'P&O NEPTUNE' && po.matched_by === 'name' && mg && mg.name === 'MARAN GAS ALEXANDROU' && mg.matched_by === 'name', [po, mg]);
  }

  // 3g — aisstream drops the connection mid-run
  {
    let conns = 0;
    script = (conn) => {
      const nth = ++conns, got = [];
      conn.on('message', (raw) => {
        got.push(JSON.parse(String(raw)));
        if (nth === 1) { send(conn, [[posMsg(MMSI.sea, 'SEA BREEZE', 25.2, 56.4, Date.now() - 60000, { sog: 0.1 }), false]]); setTimeout(() => conn.close(1011, 'server restart'), 50); }
        else if (got.length === 2 && got[1].FiltersShipMMSI) send(conn, [[posMsg(MMSI.bravo, 'BRAVO WAVE', 1.3, 103.9, Date.now() - 60000, { sog: 11 }), true]]);
      });
    };
    const fake = makeFakeDb({ payload: { state: { vessels: [{ name: 'B', imo: MMSI.bravo }, { name: 'Sea Breeze' }, { name: 'Never Seen', imo: '9000777' }] } }, status: {} });
    const n0 = srv.connections.length;
    const r = await call(fake, CRON, { config: { phaseAms: 1000, phaseBms: 700 } });
    const b = await r.json();
    const st = fake.status();
    check('E8 closed mid phase A → reconnects once, carries on into phase B, and records it',
      r.status === 200 && srv.connections.length === n0 + 2 && b.found === 2 && st.ok === true && /closed the connection \(code 1011, server restart\) during phase A — reconnected/.test(st.error) && !!st.last_ok_at, { b, st });
    // closed again after the reconnect → partial: ok with a note, but last_ok_at untouched (a retry isn't throttled)
    conns = 0;
    script = (conn) => { conn.on('message', () => { send(conn, [[posMsg(MMSI.sea, 'SEA BREEZE', 25.2, 56.4, Date.now() - 60000, { sog: 0.1 }), false]]); setTimeout(() => conn.close(1011, 'bye'), 50); }); };
    const fake2 = makeFakeDb({ payload: { state: { vessels: [{ name: 'B', imo: MMSI.bravo }, { name: 'Sea Breeze' }] } }, status: { last_ok_at: new Date(Date.now() - 30 * 60000).toISOString() } });
    const okBefore = fake2.status().last_ok_at;
    const r2 = await call(fake2, CRON, { config: { phaseAms: 1500, phaseBms: 700 } });
    const st2 = fake2.status();
    check('E8 dropped twice → "Partial run: …" note, positions kept, last_ok_at untouched',
      r2.status === 200 && st2.ok === true && /^Partial run: aisstream\.io closed the connection \(code 1011, bye\) during phase A/.test(st2.error) && st2.last_ok_at === okBefore && !!fake2.row(MMSI.sea), st2);
    const n1 = srv.connections.length;
    const r3 = await call(fake2, CRON, { config: { phaseAms: 300, phaseBms: 200 } });
    check('E8 …so the next call is not throttled', (await r3.json()).throttled !== true && srv.connections.length > n1);
    // closed with nothing received, twice → failure
    script = (conn) => { conn.on('message', () => setTimeout(() => conn.close(1008, 'policy'), 30)); };
    const fake3 = makeFakeDb({ payload: { state: { vessels: [{ name: 'Sea Breeze' }] } }, status: {} });
    const r4 = await call(fake3, CRON, { config: { phaseAms: 1500, phaseBms: 500 } });
    check('E8 dropped with nothing received → ok=false', r4.status === 502 && fake3.status().ok === false && /closed the connection \(code 1008/.test(fake3.status().error), fake3.status());
  }

  // 3h — supabase_ais_setup.sql not re-run yet (no last_cron_at column): status still saved
  {
    script = (conn) => conn.on('message', () => send(conn, [[posMsg(MMSI.sea, 'SEA BREEZE', 25.2, 56.4, Date.now() - 60000), false]]));
    const fake = makeFakeDb({ payload: { state: { vessels: [{ name: 'Sea Breeze' }] } }, status: {}, noColumns: ['last_cron_at'] });
    const r = await call(fake, CRON);
    const st = fake.status();
    check('E9 without the new last_cron_at column the scheduled call still runs and the status is saved', r.status === 200 && st.ok === true && st.found === 1 && !('last_cron_at' in st) && (await r.json()).status_error === null, st);
  }

  // 3i — error paths write ais_status.ok = false
  {
    script = (conn) => conn.on('message', () => { conn.send('{"error": "Api Key Is Not Valid"}'); conn.close(1000, 'bye'); });
    const fake = makeFakeDb({ payload: PAYLOAD, status: { last_ok_at: new Date(Date.now() - 30 * 60000).toISOString() } });
    const okBefore = fake.status().last_ok_at;
    const r = await call(fake, CRON);
    const b = await r.json();
    const st = fake.status();
    check('E10 aisstream error (bad API key) → 502, ais_status.ok=false with the error, last_ok_at unchanged, lock released',
      r.status === 502 && b.ok === false && /Api Key Is Not Valid/.test(b.error) && st.ok === false && /Api Key Is Not Valid/.test(st.error) && st.last_ok_at === okBefore && st.running_since === null && !!st.last_run_at, { b, st });
    const n0 = srv.connections.length;
    const fake2 = makeFakeDb({ payload: PAYLOAD, status: {} });
    const r2 = await call(fake2, CRON, { env: Object.assign({}, ENV, { AISSTREAM_API_KEY: '' }) });
    const st2 = fake2.status();
    check('E10 missing AISSTREAM_API_KEY → ok=false "secret is not set", no connection attempted',
      r2.status === 502 && st2.ok === false && /AISSTREAM_API_KEY/.test(st2.error) && srv.connections.length === n0, st2);
    const fake3 = makeFakeDb({ payload: PAYLOAD, status: {} });
    const r3 = await call(fake3, CRON, { config: { url: 'ws://127.0.0.1:1/v0/stream', openTimeoutMs: 1500 } });
    const st3 = fake3.status();
    check('E10 aisstream unreachable → ok=false with a connection error', r3.status === 502 && st3.ok === false && /aisstream/i.test(st3.error), st3);
    const fake4 = makeFakeDb({ payload: PAYLOAD, status: {} });
    const bg = [];
    const r4 = await call(fake4, CRON, { env: Object.assign({}, ENV, { AISSTREAM_API_KEY: '' }), deps: { waitUntil: p => bg.push(p) } });
    await bg[0];
    check('E10 background mode: 202, then ais_status.ok=false', r4.status === 202 && fake4.status().ok === false && /AISSTREAM_API_KEY/.test(fake4.status().error));
    const n1 = srv.connections.length;
    const fake5 = makeFakeDb({ payload: { state: { vessels: [] } }, status: {} });
    const r5 = await call(fake5, CRON);
    check('E10 no nominated vessels → ok with tracked 0 and no connection', r5.status === 200 && fake5.status().ok === true && fake5.status().tracked === 0 && srv.connections.length === n1);
  }

  await srv.close();
  console.log(`AIS-EDGE: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exit(2); });
