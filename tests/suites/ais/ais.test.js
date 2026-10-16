/* Live vessel positions (AIS) in the app — read-only view of ais_positions /
   ais_status (filled by the ais-poll Edge Function, faked here).
   node ais.test.js [appDir] [only] [shotDir]   (or $SHOTS_DIR for screenshots)
   Positions are placed at exact great-circle distances/bearings from the
   anchorage reference points, with times relative to now. */
const fs = require('fs');
const path = require('path');
const H = require(path.join(__dirname, '..', '..', 'harness', 'harness.js'));
const U = require(path.join(__dirname, '..', 'r3', 'util.js'));
const appDir = process.argv[2] || H.APP_DIR;
const only = process.argv[3] || '';
const SHOTS = process.argv[4] || process.env.SHOTS_DIR || '';

let pass = 0, fail = 0;
function check(name, cond, info) {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 900)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HR = 3600000, MIN = 60000;

/* ── geometry / time helpers (same Earth radius as the app) ── */
const R_NM = 3440.065, RAD = Math.PI / 180;
const REF = { 'FUJ-A': [25.170, 56.440], 'FUJ-B': [25.200, 56.380], 'KFK-A': [25.370, 56.420], 'KFK-B': [25.350, 56.365] };
function dest(area, bearingDeg, nm) {
  const [lat0, lon0] = REF[area];
  const d = nm / R_NM, b = bearingDeg * RAD, p1 = lat0 * RAD, l1 = lon0 * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: +(p2 / RAD).toFixed(6), lon: +(l2 / RAD).toFixed(6) };
}
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = n => String(n).padStart(2, '0');
// "16 Oct 2026 08:00" in Asia/Dubai (UTC+4, no DST) — the app's ETA format
function dubai(ms) { const d = new Date(ms + 4 * HR); return p2(d.getUTCDate()) + ' ' + MO[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ' ' + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()); }
const iso = ms => new Date(ms).toISOString();

/* ── the standard scene ── */
function vessel(o) {
  return Object.assign({ nomUid: '', name: '', imo: '', area: 'FUJ-A', type: 'VLSFO', qty: 500, mgo: 0, spec: 'ISO 8217:2010', agent: '', manifold: 'VESSEL MANIFOLD', remarks: '', lc: '', eta: '', paq: 'yes', bargeId: '', refuelChk: false, rfv: 0, rfm: 0, rfvr: 750, rfmr: 275 }, o);
}
function scene(now) {
  // Time-frame vessel: a frame starting >= 20 h ahead; AIS arrival = frame start + 3.5 h
  // (> 2 h after the START, but before the frame END → no warning, because the END counts).
  const loc = new Date(now + 4 * HR);
  let fs0 = Date.UTC(loc.getUTCFullYear(), loc.getUTCMonth(), loc.getUTCDate()) - 4 * HR; // local midnight (UTC ms)
  while (fs0 < now + 20 * HR) fs0 += 6 * HR;
  const frameCode = { 0: 'EAM', 6: 'AM', 12: 'PM', 18: 'LPM' }[new Date(fs0 + 4 * HR).getUTCHours()];
  const frameHrs = (fs0 + 3.5 * HR - now) / HR;
  // The ship's own AIS ETA (broadcast in UTC, 'MM-DD HH:MM') and how the app shows it in Dubai time.
  const etaU = new Date(Math.floor((now + 5 * HR) / MIN) * MIN), etaL = new Date(etaU.getTime() + 4 * HR);
  const aisEta = p2(etaU.getUTCMonth() + 1) + '-' + p2(etaU.getUTCDate()) + ' ' + p2(etaU.getUTCHours()) + ':' + p2(etaU.getUTCMinutes());
  const aisEtaLocal = etaL.getUTCDate() + ' ' + MO[etaL.getUTCMonth()] + ' ' + p2(etaL.getUTCHours()) + ':' + p2(etaL.getUTCMinutes());
  const v = [
    vessel({ nomUid: 'n1', name: 'OCEAN PEARL', imo: '9873022', area: 'FUJ-A', eta: dubai(now + 1 * HR), lc: dubai(now - 24 * HR) + ' - ' + dubai(now + 30 * HR) }),
    vessel({ nomUid: 'n2', name: 'BLUE MARLIN', imo: '538009876', area: 'KFK-A', eta: dubai(now + 20 * HR), lc: dubai(now - 24 * HR) + ' - ' + dubai(now + 10 * HR) }),
    vessel({ nomUid: 'n3', name: 'MV Sea Breeze', imo: '', area: 'FUJ-B', eta: dubai(now - 2 * HR) }),
    vessel({ nomUid: 'n4', name: 'GHOST TRADER', imo: '9111111', area: 'FUJ-A', eta: dubai(now + 5 * HR) }),
    vessel({ nomUid: 'n5', name: 'OLD TIMER', imo: '9333333', area: 'KFK-B', eta: dubai(now + 3 * HR) }),
    vessel({ nomUid: 'n6', name: 'FRAME RUNNER', imo: '9444444', area: 'FUJ-A', eta: dubai(fs0), etaWin: frameCode }),
  ];
  const pos = [
    Object.assign({ mmsi: '636012345', imo: '9873022', name: 'OCEAN PEARL', sog: 10, cog: 290, heading: 291, nav_status: 0, destination: 'FUJAIRAH OPL', ais_eta: aisEta, draught: 11.2, matched_by: 'imo', position_time: iso(now - 8 * MIN), static_time: iso(now - 30 * MIN), updated_at: iso(now - 5 * MIN) }, dest('FUJ-A', 110, 40)),
    Object.assign({ mmsi: '538009876', imo: null, name: 'BLUE MARLIN', sog: 12, cog: 310, heading: 310, nav_status: 0, destination: 'KHOR FAKKAN', ais_eta: null, matched_by: 'mmsi', position_time: iso(now - 3 * MIN), updated_at: iso(now - 5 * MIN) }, dest('KFK-A', 130, 300)),
    Object.assign({ mmsi: '477000003', imo: '9555555', name: 'SEA BREEZE', sog: 0.2, cog: 0, heading: 80, nav_status: 1, destination: 'FUJAIRAH', matched_by: 'name', position_time: iso(now - 12 * MIN), updated_at: iso(now - 5 * MIN) }, dest('FUJ-B', 90, 2)),
    Object.assign({ mmsi: '244000007', imo: '9222222', name: 'GHOST TRADER', sog: 11, nav_status: 0, matched_by: 'imo', position_time: iso(now - 20 * MIN), updated_at: iso(now - 5 * MIN) }, dest('FUJ-A', 120, 20)),
    Object.assign({ mmsi: '255000005', imo: '9333333', name: 'OLD TIMER', sog: 9, nav_status: 0, matched_by: 'imo', position_time: iso(now - 7 * HR), updated_at: iso(now - 5 * MIN) }, dest('KFK-B', 100, 100)),
    Object.assign({ mmsi: '311000006', imo: '9444444', name: 'FRAME RUNNER', sog: 10, nav_status: 0, matched_by: 'imo', position_time: iso(now - 1 * MIN), updated_at: iso(now - 5 * MIN) }, dest('FUJ-A', 140, 10 * frameHrs)),
  ];
  const status = { last_run_at: iso(now - 5 * MIN), last_ok_at: iso(now - 5 * MIN), last_cron_at: iso(now - 5 * MIN), running_since: null, ok: true, tracked: 6, found: 5, messages: 4200, error: null, duration_ms: 90000 };
  return { vessels: v, positions: pos, status, frameCode, frameStart: fs0, aisEta, aisEtaLocal };
}
function makeDb(now, opts) {
  opts = opts || {};
  const s = scene(now);
  const ais = opts.ais === false ? false : (opts.ais || { positions: s.positions, status: s.status });
  const db = H.createDb({ workspace: U.seedPayload({ vessels: opts.vessels || s.vessels }), ais, functions: opts.functions });
  return { db, s };
}

// Toast log from the very first paint (catches "toasts on login" too).
const TOAST_LOG = () => {
  window.__toastLog = [];
  document.addEventListener('DOMContentLoaded', () => {
    const st = document.getElementById('toast-stack');
    if (st) new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
      const t = n.querySelector && n.querySelector('.toast-msg');
      if (t) window.__toastLog.push({ m: t.textContent, type: (n.className.match(/toast-(\w+)/) || [])[1] });
    }))).observe(st, { childList: true });
  });
};
const PAGE_HELPERS = () => {
  window.__cid = nomUid => { const c = [...document.querySelectorAll('.vcard[id^="vessel-"]')].find(x => x.dataset.nomUid === nomUid); return c ? c.id.replace('vessel-', '') : null; };
  window.__line = nomUid => document.getElementById('v' + __cid(nomUid) + '-ais');
  window.__toasts = () => (window.__toastLog || []).map(t => t.m);
};
async function open(browser, db, uid, extra) {
  const app = await H.openApp(browser, db, Object.assign({ appDir, uid: uid || 'user-operator', beforeLoad: async (ctx, page) => { await page.addInitScript(TOAST_LOG); } }, extra || {}));
  app.warnings = [];
  app.page.on('console', m => { if (m.type() === 'warning' && /AIS/i.test(m.text())) app.warnings.push(m.text()); });
  await app.page.evaluate(PAGE_HELPERS);
  await app.page.waitForFunction(() => typeof _ais !== 'undefined' && (_ais.state === 'ready' || _ais.state === 'missing' || _ais.state === 'error') && !_ais.loading, null, { timeout: 15000 });
  return app;
}
function realErrors(app) { return app.errors.filter(e => !/capacitorExports/.test(e)).concat(app.warnings || []); }
async function until(page, fn, arg, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 5000)) { if (await page.evaluate(fn, arg)) return Date.now() - t0; await sleep(100); }
  return -1;
}
async function scenario(browser, name, fn) {
  if (only && !name.includes(only)) return;
  console.log('— ' + name);
  const apps = [];
  const openT = async (db, uid, extra) => { const a = await open(browser, db, uid, extra); apps.push(a); return a; };
  try { await fn(openT); } catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 5).join(' | ')); }
  const errs = [].concat(...apps.map(realErrors));
  check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
  for (const a of apps) await a.ctx.close();
}
const writesBy = (db, uid) => db.log.filter(o => o.uid === uid && o.table === 'abps_workspace' && ['update', 'insert', 'upsert', 'delete'].includes(o.action)).length + db.log.filter(o => o.uid === uid && o.action === 'rpc').length;
const shot = async (locOrPage, file) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await locOrPage.screenshot({ path: path.join(SHOTS, file) }); };

(async () => {
  const browser = await H.launch();

  /* 1 — matching, distance, status rules, estimate, warnings */
  await scenario(browser, 'A1 matching, status and warnings', async (openT) => {
    const now = Date.now();
    const { db, s } = makeDb(now);
    const { page } = await openT(db, 'user-operator');
    const m = await page.evaluate(() => {
      const r = {};
      ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'].forEach(n => { const v = _aisCardVessel(__cid(n)); const x = _aisMatch(v, _ais.positions); r[n] = x ? { mmsi: x.pos.mmsi, by: x.by } : null; });
      r.cls = [_aisClassifyId('IMO 9873022'), _aisClassifyId('538 009 876'), _aisClassifyId('12345')];
      r.norm = [_aisNormName('M/V  sea breeze'), _aisNormName('MT. Ocean')];
      return r;
    });
    check('A1 IMO box with 7 digits → matched by IMO', m.n1 && m.n1.mmsi === '636012345' && m.n1.by === 'imo', m.n1);
    check('A1 legacy: 9 digits saved in the IMO box → matched as MMSI', m.n2 && m.n2.mmsi === '538009876' && m.n2.by === 'mmsi', m.n2);
    check('A1 no IMO → matched by normalised name ("MV Sea Breeze" = "SEA BREEZE")', m.n3 && m.n3.mmsi === '477000003' && m.n3.by === 'name', m.n3);
    check('A1 a nomination WITH an IMO is never matched by name (same-name ship, other IMO ignored)', m.n4 === null, m.n4);
    check('A1 classify / normalise helpers', JSON.stringify(m.cls) === '[{"kind":"imo","value":"9873022"},{"kind":"mmsi","value":"538009876"},null]' && m.norm.join('|') === 'SEA BREEZE|OCEAN', m);
    // The MMSI box (vessel.mmsi): tried first, then the IMO box, then a legacy 9-digit IMO box; never by name with an identifier.
    const mm = await page.evaluate(() => {
      const P = _ais.positions;
      const f = v => { const x = _aisMatch(v, P); return x ? x.pos.mmsi + ':' + x.by : null; };
      const id2 = __cid('n2'), cv = _aisCardVessel(id2);
      return {
        n2boxes: [document.getElementById('v' + id2 + '-imo').value, document.getElementById('v' + id2 + '-mmsi').value], n2card: [cv.imo, cv.mmsi],
        mmsiField: f({ name: 'X', imo: '', mmsi: '538009876' }),
        both: f({ name: 'X', imo: '9873022', mmsi: '636012345' }),
        mmsiFirst: f({ name: 'X', imo: '9222222', mmsi: '636012345' }),
        fallback: f({ name: 'X', imo: '9873022', mmsi: '999999999' }),
        legacy: f({ name: 'X', imo: '538009876' }),
        legacyLoses: f({ name: 'X', imo: '538009876', mmsi: '636012345' }),
        noName: f({ name: 'GHOST TRADER', imo: '', mmsi: '244000099' }),
        sevenInMmsi: f({ name: 'X', imo: '', mmsi: '9873022' }),
        // the card's label grammar (_vidNorm): a box the card calls valid is matched by its number
        labelled: ['IMO No. 9873022', 'IMO Nr. 9873022', 'IMO number 9873022', 'IMO No.: 9873022', 'IMO=9873022', 'IMO \u2013 9873022', 'imo9873022', 'MMSI No: 538 009 876', 'MMSI # 538009876'].map(x => { const c = _aisClassifyId(x); return c && c.kind + ':' + c.value; }),
        labelledOk: ['IMO No. 9873022', 'MMSI No: 538 009 876'].map((x, i) => _vidCheck(x, i ? 'mmsi' : 'imo').kind),
        labelledMatch: [f({ name: 'X', imo: 'IMO No. 9873022' }), f({ name: 'X', imo: '', mmsi: 'MMSI No: 538009876' })],
        ids: [_aisIdTxt({ imo: '9111111', mmsi: '244000007' }), _aisIdTxt({ imo: '538009876' }), _aisIdTxt({ imo: '', mmsi: '' })],
      };
    });
    check('A1 legacy 9-digit IMO box shows in the card\'s MMSI box and is read from there', JSON.stringify(mm.n2boxes) === '["","538009876"]' && JSON.stringify(mm.n2card) === '["","538009876"]', mm);
    check('A1 MMSI box: matched by MMSI, ahead of the IMO box (even a different IMO); MMSI not on AIS → falls back to the IMO; 7 digits in the MMSI box count as the IMO',
      mm.mmsiField === '538009876:mmsi' && mm.both === '636012345:mmsi' && mm.mmsiFirst === '636012345:mmsi' && mm.fallback === '636012345:imo' && mm.sevenInMmsi === '636012345:imo', mm);
    check('A1 legacy 9 digits in the IMO box → MMSI (the MMSI box wins when both are set); an MMSI-only nomination is never matched by name',
      mm.legacy === '538009876:mmsi' && mm.legacyLoses === '636012345:mmsi' && mm.noName === null, mm);
    check('A1 same label grammar as the card: "IMO No. …", "Nr", "number", "=", "–", "MMSI No: …" are classified and matched by their number',
      mm.labelled.join(',') === 'imo:9873022,imo:9873022,imo:9873022,imo:9873022,imo:9873022,imo:9873022,imo:9873022,mmsi:538009876,mmsi:538009876' && mm.labelledOk.join(',') === 'ok,ok' && mm.labelledMatch.join(',') === '636012345:imo,538009876:mmsi', mm);
    check('A1 identifier text for the card line / dashboard row', JSON.stringify(mm.ids) === JSON.stringify(['MMSI 244000007 / IMO 9111111', 'MMSI 538009876', '']), mm.ids);

    const a = await page.evaluate(() => {
      const out = {};
      ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'].forEach(n => {
        const v = _aisCardVessel(__cid(n)); const x = _aisAssess(v, _aisMatch(v, _ais.positions));
        out[n] = { status: x.status, dist: x.distNm, est: x.est ? x.est.getTime() : null, warn: x.warn, byName: x.matchedByName };
      });
      out.now = Date.now();
      return out;
    });
    check('A1 great-circle distance: 40 nm / 300 nm / 2 nm as placed', Math.abs(a.n1.dist - 40) < 0.05 && Math.abs(a.n2.dist - 300) < 0.05 && Math.abs(a.n3.dist - 2) < 0.05, [a.n1.dist, a.n2.dist, a.n3.dist]);
    check('A1 statuses: Approaching (40 nm, 10 kn), Underway (300 nm), Arrived (2 nm, 0.2 kn), Not seen, Stale (7 h old)',
      a.n1.status === 'approaching' && a.n2.status === 'underway' && a.n3.status === 'arrived' && a.n4.status === 'notseen' && a.n5.status === 'stale' && a.n6.status === 'underway', [a.n1.status, a.n2.status, a.n3.status, a.n4.status, a.n5.status, a.n6.status]);
    check('A1 AIS arrival estimate = time of the fix + distance / SOG (fix 8 min old, 40 nm at 10 kn → +3 h 52)', Math.abs(a.n1.est - (Date.parse(s.positions[0].position_time) + 4 * HR)) < 1000, (a.n1.est - a.now) / HR);
    check('A1 amber warning: AIS arrival > 2 h after the ETA ("2.9h after ETA")', a.n1.warn && a.n1.warn.level === 'amber' && /^AIS suggests arrival ~\d+ \w{3} \d\d:\d\d, 2\.9h after ETA$/.test(a.n1.warn.text), a.n1.warn);
    check('A1 red warning: AIS arrival after the laycan closes → "may miss laycan"', a.n2.warn && a.n2.warn.level === 'red' && /may miss laycan/.test(a.n2.warn.text) && /after the laycan closes/.test(a.n2.warn.text), a.n2.warn);
    check('A1 time-frame ETA (' + s.frameCode + '): judged against the frame END → no warning although 3.5 h after the frame start', a.n6.warn === null && a.n6.est != null, a.n6);
    const fr = await page.evaluate(() => {
      const v = _aisCardVessel(__cid('n6')); const m = _aisMatch(v, _ais.positions);
      const asStart = _aisAssess(Object.assign({}, v, { etaWin: '', etaEnd: v.eta }), m);          // same ETA as an exact time
      const late = _aisAssess(Object.assign({}, v, { etaEnd: new Date(v.etaEnd.getTime() - 5 * 3600000) }), m); // AIS arrival now 2.5 h after this frame END
      return { win: v.etaWin, asStart: asStart.warn, late: late.warn };
    });
    check('A1 the same ETA as an exact time would warn (frame start + 3.5 h)', fr.asStart && fr.asStart.level === 'amber' && /3\.5h after ETA/.test(fr.asStart.text), fr.asStart);
    check('A1 frame vessel warns once the frame END is > 2 h before the AIS arrival, and says so', fr.late && fr.late.level === 'amber' && new RegExp('end of the ' + s.frameCode + ' frame').test(fr.late.text), fr.late);

    const rules = await page.evaluate(() => {
      const now = Date.parse('2026-10-15T10:00:00Z');
      const ref = AIS_REF_POINTS['FUJ-A'];
      const at = (dLat, o) => ({ pos: Object.assign({ mmsi: '111111111', lat: ref.lat + dLat, lon: ref.lon, sog: 0, nav_status: 0, position_time: new Date(now - 60000).toISOString() }, o || {}), by: 'imo' });
      const nm = 1 / 60.0405; // degrees of latitude per nautical mile
      const v = { area: 'FUJ-A', etaEnd: null, lcTo: null };
      const st = (dLat, o) => _aisAssess(v, at(dLat, o), now).status;
      return {
        arrived: st(4 * nm, { sog: 0.6 }),
        movingInside: st(4 * nm, { sog: 3 }),
        anchored7: st(7 * nm, { nav_status: 1, sog: 0 }),
        moored7: st(7 * nm, { nav_status: 5, sog: 0 }),
        anchored9: st(9 * nm, { nav_status: 1, sog: 0 }),
        drifting7: st(7 * nm, { sog: 0.2 }),
        approaching59: st(59 * nm, { sog: 11 }),
        underway61: st(61 * nm, { sog: 11 }),
        stale: st(1 * nm, { position_time: new Date(now - 6.1 * 3600000).toISOString() }),
        fresh6: st(1 * nm, { position_time: new Date(now - 5.9 * 3600000).toISOString() }),
        noPos: _aisAssess(v, { pos: { mmsi: '1', lat: null, lon: null }, by: 'imo' }, now).status,
        none: _aisAssess(v, null, now).status,
        nan: _aisAssess(v, at(0, { lat: 'abc' }), now).status,
        slowEst: _aisAssess({ area: 'FUJ-A', etaEnd: new Date(now), lcTo: null }, at(30 * nm, { sog: 0.5 }), now).est,
        dist60: _aisDistNm(25, 56, 26, 56),
      };
    });
    check('A1 Arrived: ≤ 5 nm and < 1 kn, or at anchor / moored ≤ 8 nm',
      rules.arrived === 'arrived' && rules.anchored7 === 'arrived' && rules.moored7 === 'arrived' && rules.movingInside === 'approaching' && rules.anchored9 === 'approaching' && rules.drifting7 === 'approaching', rules);
    check('A1 Approaching ≤ 60 nm, Underway beyond; Stale after 6 h; Not seen without a position (NaN-safe)',
      rules.approaching59 === 'approaching' && rules.underway61 === 'underway' && rules.stale === 'stale' && rules.fresh6 === 'arrived' && rules.noPos === 'notseen' && rules.none === 'notseen' && rules.nan === 'notseen', rules);
    check('A1 no arrival estimate for a ship doing < 1 kn; 1° of latitude = 60.04 nm', rules.slowEst === null && Math.abs(rules.dist60 - 60.04) < 0.01, rules);
    const r7 = await page.evaluate(() => {
      const now = Date.parse('2026-10-15T10:00:00Z'), H = 3600000;
      const ref = AIS_REF_POINTS['FUJ-A'], nm = 1 / 60.0405;
      // ships due north of the anchorage: bearing to it = 180°
      const at = (dNm, o) => ({ pos: Object.assign({ mmsi: '111111111', lat: ref.lat + dNm * nm, lon: ref.lon, sog: 12, cog: 180, nav_status: 0, position_time: new Date(now - 60000).toISOString() }, o || {}), by: 'imo' });
      const fix = now - 4 * H;
      const A = (v, m) => { const x = _aisAssess(Object.assign({ area: 'FUJ-A' }, v), m, now); return { st: x.status, est: x.est ? x.est.getTime() : null, warn: x.warn ? x.warn.level : null, course: x.course }; };
      return {
        fix, now,
        old: A({ etaEnd: new Date(fix + 10 * H), lcTo: new Date(fix + 11 * H) }, at(120, { position_time: new Date(fix).toISOString() })),
        skew: A({}, at(120, { position_time: new Date(now + 10 * 60000).toISOString() })),
        away: A({ lcTo: new Date(now - H) }, at(20, { sog: 1.5, cog: 0 })),
        leaving: A({ etaEnd: new Date(now - 5 * H), lcTo: new Date(now - 2 * H) }, at(30, { sog: 13, cog: 350 })),
        off80: A({}, at(30, { sog: 13, cog: 100 })),
        off60: A({}, at(30, { sog: 13, cog: 240 })),
        near: A({ etaEnd: new Date(now - 6 * H), lcTo: new Date(now - H) }, at(2.6, { sog: 4, cog: 90 })),
        departing: A({ etaEnd: new Date(now - 6 * H), lcTo: new Date(now - H) }, at(1.5, { sog: 9, cog: 0 })),   // supplied late, leaving: inside 3 nm
        drift: A({ etaEnd: new Date(now - 3 * H), lcTo: new Date(now + 5 * H) }, at(12, { sog: 1.5, cog: 150 })),  // drifting at the OPL, 30° off
        drift29: A({ lcTo: new Date(now + H) }, at(14, { sog: 2.9, cog: 180 })),
        steaming12: A({}, at(12, { sog: 4, cog: 180 })),
        slowFarOff70: A({}, at(40, { sog: 2, cog: 250 })),   // 70° off at 2 kn → only 0.7 kn closing
        slowAhead: A({}, at(40, { sog: 1.0, cog: 181 })),     // pointed at the port at 1.0 kn → closing a hair under 1 kn
        slowTxt: (() => { const x = _aisAssess({ area: 'FUJ-A' }, at(40, { sog: 1.0, cog: 181 }), now); return _aisCourseTxt(x); })(),
        nocog: A({}, at(30, { sog: 13, cog: null, heading: null })),
        hdgAway: A({}, at(30, { sog: 13, cog: null, heading: 0 })),
      };
    });
    check('A1 the estimate counts from the time of the fix: an on-time ship with a 4-h-old fix gets no warning (est = fix + 10 h)',
      r7.old.st === 'underway' && r7.old.warn === null && Math.abs(r7.old.est - (r7.fix + 10 * HR)) < 1000, r7.old);
    check('A1 a fix stamped in the future (clock skew) counts as now', Math.abs(r7.skew.est - (r7.now + 10 * HR)) < 1000, r7.skew);
    check('A1 heading away (drifting off the port, or leaving after supply): no estimate, no warning — not even after the laycan',
      r7.away.course === 'away' && r7.away.est === null && r7.away.warn === null && r7.leaving.est === null && r7.leaving.warn === null && r7.off80.course === 'away' && r7.hdgAway.course === 'away', r7);
    check('A1 course within ±70° AND ≥ 1 kn closing counts as approaching; unknown course → estimate kept',
      r7.off60.course === 'toward' && r7.off60.est != null && r7.slowFarOff70.course === 'slow' && r7.slowFarOff70.est === null && r7.nocog.course === 'unknown' && r7.nocog.est != null, r7);
    check('A1 pointed at the port but closing under 1 kn is "slow", never labelled "heading away"',
      r7.slowAhead.course === 'slow' && r7.slowAhead.est === null && r7.slowAhead.warn === null && /slow toward FUJ A/.test(r7.slowTxt) && !/away/.test(r7.slowTxt), [r7.slowAhead, r7.slowTxt]);
    check('A1 moving within 3 nm (manoeuvring, or leaving after a late supply): no estimate, no warning — whatever the course',
      r7.near.course === 'near' && r7.near.est === null && r7.near.warn === null && r7.departing.course === 'near' && r7.departing.warn === null && r7.departing.st === 'approaching', [r7.near, r7.departing]);
    check('A1 slow (< 3 kn) within 15 nm = waiting / drifting at the OPL: no estimate, no red warning; 4 kn there → normal estimate',
      r7.drift.course === 'waiting' && r7.drift.est === null && r7.drift.warn === null && r7.drift29.course === 'waiting' && r7.drift29.warn === null && r7.steaming12.course === 'toward' && r7.steaming12.est != null, [r7.drift, r7.drift29, r7.steaming12]);
    const lm = await page.evaluate(() => {
      const t = new Date().toISOString();
      const P = [{ mmsi: '311000779', name: 'MARAN GAS ALEXANDROU', lat: 25, lon: 56, position_time: t }, { mmsi: '311000777', name: 'P&O NEPTUNE', lat: 25, lon: 56, position_time: t }];
      const a = _aisMatch({ name: 'MV Maran Gas Alexandroupolis', imo: '' }, P), b = _aisMatch({ name: 'p&o  neptune', imo: '' }, P);
      return [a && a.pos.mmsi, a && a.by, b && b.pos.mmsi, _aisNameKey('Maran Gas Alexandroupolis')];
    });
    check('A1 a nominated name longer than 20 characters matches the AIS name (AIS keeps 20); "&" in names', lm[0] === '311000779' && lm[1] === 'name' && lm[2] === '311000777' && lm[3] === 'MARAN GAS ALEXANDROU', lm);
    const et = await page.evaluate(() => {
      const now = Date.parse('2026-12-30T10:00:00Z');
      const f = (r) => { const e = _aisEtaLocal(r, now); return e ? [e.date.toISOString(), e.hasTime] : null; };
      return [f('01-02 06:30'), f('12-29 23:00'), f('03-02'), f('13-01 00:00'), f('<b>')];
    });
    check('A1 AIS ETA (UTC, no year) → the nearest year: 01-02 after New Year, 12-29 this year; date only; junk → null',
      JSON.stringify(et) === JSON.stringify([['2027-01-02T06:30:00.000Z', true], ['2026-12-29T23:00:00.000Z', true], ['2027-03-02T00:00:00.000Z', false], null, null]), et);
  });

  /* 2 — the nomination card line in both looks + phone; screenshots */
  await scenario(browser, 'A2 nomination card line', async (openT) => {
    const now = Date.now();
    const { db, s } = makeDb(now);
    const { page } = await openT(db, 'user-operator');
    await page.evaluate(() => { try { flowWelcomeGo('nominations'); } catch (e) {} showPage('nominations'); });
    const L = await page.evaluate(() => {
      const r = {};
      ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'].forEach(n => {
        const el = __line(n);
        r[n] = { show: el.classList.contains('show'), text: el.textContent.replace(/\s+/g, ' ').trim(), chip: (el.querySelector('.ais-chip') || {}).textContent, links: [...el.querySelectorAll('a')].map(a => ({ href: a.getAttribute('href'), t: a.target, rel: a.rel, text: a.textContent })), warn: el.querySelector('.ais-warn') ? { cls: el.querySelector('.ais-warn').className, text: el.querySelector('.ais-warn').textContent } : null };
      });
      const n1 = __line('n1'), prev = document.getElementById('v' + __cid('n1') + '-prev');
      r.order = prev && prev.nextElementSibling === n1;
      return r;
    });
    check('A2 the line sits right under the ETA strip', L.order === true);
    check('A2 every nomination with a name / IMO gets a "Live position (AIS)" line', ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'].every(n => L[n].show && /^Live position \(AIS\)/.test(L[n].text)), L);
    check('A2 Approaching line: chip, distance to FUJ A, speed, AIS arrival, AIS destination + AIS ETA (UTC broadcast shown in local time), last seen',
      L.n1.chip === 'Approaching' && /40 nm to FUJ A/.test(L.n1.text) && /10\.0 kn/.test(L.n1.text) && /AIS arrival ~\d+ \w{3} \d\d:\d\d/.test(L.n1.text) && /Dest\. FUJAIRAH OPL/.test(L.n1.text) && L.n1.text.includes('AIS ETA ' + s.aisEtaLocal) && /seen 8 min ago/.test(L.n1.text), L.n1.text);
    check('A2 map links: MarineTraffic by MMSI ("Open map") + VesselFinder by IMO, new tab, rel=noopener',
      JSON.stringify(L.n1.links.map(l => l.href)) === JSON.stringify(['https://www.marinetraffic.com/en/ais/details/ships/mmsi:636012345', 'https://www.vesselfinder.com/vessels/details/9873022']) &&
      L.n1.links[0].text === 'Open map' && L.n1.links.every(l => l.t === '_blank' && l.rel === 'noopener'), L.n1.links);
    check('A2 VesselFinder falls back to the MMSI when the IMO is unknown', L.n2.links[1] && L.n2.links[1].href === 'https://www.vesselfinder.com/vessels/details/538009876', L.n2.links);
    check('A2 amber warning on the card', L.n1.warn && /amber/.test(L.n1.warn.cls) && /2\.9h after ETA/.test(L.n1.warn.text), L.n1.warn);
    check('A2 red "may miss laycan" on the card', L.n2.warn && /red/.test(L.n2.warn.cls) && /may miss laycan/.test(L.n2.warn.text), L.n2.warn);
    check('A2 name match flagged "matched by name"; Arrived chip', L.n3.chip === 'Arrived' && /matched by name/.test(L.n3.text) && !/matched by name/.test(L.n1.text), L.n3.text);
    check('A2 Not seen: says which IMO it looks for, no links', L.n4.chip === 'Not seen' && /No AIS position yet for IMO 9111111/.test(L.n4.text) && L.n4.links.length === 0, L.n4);
    check('A2 Stale chip with the age', L.n5.chip === 'Stale' && /seen 7 h ago/.test(L.n5.text), L.n5.text);

    // edits re-match the card: IMO cleared → name match; area changed → distance from the new point
    const ed = await page.evaluate(async () => {
      const id = __cid('n1');
      const imo = document.getElementById('v' + id + '-imo');
      imo.value = ''; imo.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 600));
      const t1 = __line('n1').textContent;
      imo.value = '9873022'; imo.dispatchEvent(new Event('input', { bubbles: true }));
      const area = document.getElementById('v' + id + '-area');
      area.value = 'KFK-B'; area.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 600));
      const t2 = __line('n1').textContent;
      area.value = 'FUJ-A'; area.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 600));
      return { t1, t2, t3: __line('n1').textContent };
    });
    check('A2 editing IMO / anchorage re-matches the line (name match → flagged; distance to KFK B)',
      /matched by name/.test(ed.t1) && /to KFK B/.test(ed.t2) && /40 nm to FUJ A/.test(ed.t3), ed);
    // the MMSI box re-matches too: GHOST TRADER (card IMO not on AIS) is found by the MMSI typed next to it
    const mb = await page.evaluate(async () => {
      const id = __cid('n4'), el = document.getElementById('v' + id + '-mmsi');
      el.value = '244000007'; el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 600));
      const t1 = __line('n4').textContent, chip1 = (__line('n4').querySelector('.ais-chip') || {}).textContent;
      el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 600));
      return { t1, chip1, t2: __line('n4').textContent };
    });
    check('A2 typing an MMSI re-matches the line by MMSI (IMO not on AIS); cleared → "Not seen" for the IMO again',
      mb.chip1 === 'Approaching' && /20 nm to FUJ A/.test(mb.t1) && !/matched by name/.test(mb.t1) && /No AIS position yet for IMO 9111111/.test(mb.t2), mb);

    // both looks, token colours, layout
    const looks = [];
    for (const step of ['harbour', 'classic', 'classic-dark']) {
      looks.push(await page.evaluate((step) => {
        if (step === 'classic' && _isPremiumSkin()) toggleSkin();
        if (step === 'harbour' && !_isPremiumSkin()) toggleSkin();
        if (step === 'classic-dark' && document.documentElement.dataset.theme !== 'dark') toggleColorTheme();
        const el = __line('n1'), chip = el.querySelector('.ais-chip'), warn = el.querySelector('.ais-warn');
        const r = el.getBoundingClientRect(), card = document.getElementById('vessel-' + __cid('n1')).getBoundingClientRect();
        return { skin: document.documentElement.dataset.skin, theme: document.documentElement.dataset.theme, chipBg: getComputedStyle(chip).backgroundColor, chipFg: getComputedStyle(chip).color, warnFg: getComputedStyle(warn).color, lineBg: getComputedStyle(el).backgroundColor, display: getComputedStyle(el).display, inside: r.left >= card.left - 1 && r.right <= card.right + 1, h: r.height };
      }, step));
    }
    check('A2 renders in Harbour, Classic and Classic dark with token colours, inside the card',
      looks[0].skin === 'harbour' && looks[1].skin === 'classic' && looks[2].theme === 'dark' && looks.every(l => l.display === 'flex' && l.inside && l.h > 20 && /rgb/.test(l.chipBg)) &&
      looks[0].chipFg !== looks[1].chipFg && looks[1].lineBg !== looks[2].lineBg, looks);
    await page.evaluate(() => { if (document.documentElement.dataset.theme === 'dark') toggleColorTheme(); if (!_isPremiumSkin()) toggleSkin(); });

    if (SHOTS) {
      await page.evaluate(() => { document.querySelectorAll('#toast-stack .toast').forEach(t => t.remove()); const c = document.getElementById('vessel-' + __cid('n1')); const hb = document.getElementById('topbar'); window.scrollTo({ top: c.getBoundingClientRect().top + scrollY - (hb ? hb.getBoundingClientRect().bottom : 0) - 8, behavior: 'instant' }); });
      await sleep(250);
      await shot(page.locator('#vessel-' + await page.evaluate(() => __cid('n1'))), 'ais-card-harbour-desktop.png');
      await page.evaluate(() => { toggleSkin(); const c = document.getElementById('vessel-' + __cid('n1')); const hb = document.getElementById('topbar'); window.scrollTo({ top: c.getBoundingClientRect().top + scrollY - (hb ? hb.getBoundingClientRect().bottom : 0) - 8, behavior: 'instant' }); });
      await sleep(250);
      await shot(page.locator('#vessel-' + await page.evaluate(() => __cid('n1'))), 'ais-card-classic-desktop.png');
      await page.evaluate(() => toggleSkin());
    }

    // phone width
    await page.setViewportSize({ width: 390, height: 844 });
    await sleep(400);
    const ph = await page.evaluate(() => {
      const lines = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'].map(n => __line(n).getBoundingClientRect());
      return { docW: document.documentElement.scrollWidth, winW: innerWidth, fit: lines.every(r => r.left >= 0 && r.right <= innerWidth + 1), w: Math.round(lines[0].width) };
    });
    check('A2 phone (390 px): lines wrap inside the screen, no horizontal page scroll', ph.docW <= ph.winW + 1 && ph.fit && ph.w > 250, ph);
    if (SHOTS) {
      await page.evaluate(() => { document.querySelectorAll('#toast-stack .toast').forEach(t => t.remove()); const el = __line('n1'); const hb = document.getElementById('topbar'); window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - (hb ? hb.getBoundingClientRect().bottom : 0) - 230, behavior: 'instant' }); });
      await sleep(250);
      await shot(page, 'ais-card-phone-harbour.png');
      await page.evaluate(() => toggleSkin());
      await sleep(250);
      await shot(page, 'ais-card-phone-classic.png');
      await page.evaluate(() => toggleSkin());
    }
  });

  /* 3 — dashboard card, alerts (bell / Needs Attention, keyed per vessel), realtime, no writes */
  await scenario(browser, 'A3 dashboard card and alerts', async (openT) => {
    const now = Date.now();
    const { db, s } = makeDb(now);
    const app = await openT(db, 'user-operator', { settleMs: 1200 });
    const { page } = app;
    await page.evaluate(() => { try { flowWelcomeGo('dashboard'); } catch (e) {} showPage('dashboard'); });
    await sleep(300);
    const d = await page.evaluate(() => {
      const card = document.getElementById('dash-ais'), btn = document.getElementById('ais-refresh-btn');
      const rows = [...card.querySelectorAll('.ais-row')];
      return {
        shown: card.style.display !== 'none' && card.getBoundingClientRect().height > 50,
        title: card.querySelector('.chart-title').textContent, sub: document.getElementById('dash-ais-sub').textContent,
        btn: btn.style.display !== 'none' && !btn.disabled && btn.textContent === 'Refresh now',
        rows: rows.map(r => ({ name: r.querySelector('.ais-row-name').textContent, st: r.dataset.aisStatus, text: r.textContent.replace(/\s+/g, ' '), warn: r.querySelector('.ais-warn') ? r.querySelector('.ais-warn').className : '' })),
      };
    });
    check('A3 operator dashboard: "Vessel Positions (AIS)" card with Refresh now', d.shown && d.title === 'Vessel Positions (AIS)' && d.btn, d);
    check('A3 header: last update, last scheduled (cron) call, how many vessels were seen', /^Updated 5 min ago · last scheduled call 5 min ago · 4 of 6 nominated vessels seen$/.test(d.sub), d.sub);
    check('A3 one row per nomination, warnings first (red, amber), not seen last',
      d.rows.length === 6 && d.rows[0].name === 'BLUE MARLIN' && /red/.test(d.rows[0].warn) && d.rows[1].name === 'OCEAN PEARL' && /amber/.test(d.rows[1].warn) && d.rows[5].st === 'notseen', d.rows.map(r => r.name + ':' + r.st));
    if (SHOTS) { await page.evaluate(() => document.querySelectorAll('#toast-stack .toast').forEach(t => t.remove())); await shot(page.locator('#dash-ais'), 'ais-dashboard-operator.png'); }
    const op = d.rows[1].text;
    check('A3 row: status, distance & reference point, speed, AIS arrival vs ETA, last seen, map link',
      /Approaching/.test(op) && /40 nm to FUJ A/.test(op) && /10\.0 kn/.test(op) && /AIS ~\d+ \w{3} \d\d:\d\d · ETA \d+ \w{3} \d\d:\d\d/.test(op) && /seen 8 min ago/.test(op) && /Open map/.test(op), op);
    const fr = d.rows.find(r => r.name === 'FRAME RUNNER');
    check('A3 time-frame ETA shown as its frame ("' + s.frameCode + '")', fr && new RegExp('ETA \\d+ \\w{3} ' + s.frameCode).test(fr.text), fr && fr.text);

    const al = await page.evaluate(() => {
      const a = computeGlobalAlerts().filter(x => /^ais\|/.test(x.key));
      const q = [...document.querySelectorAll('#dash-action-queue .aq-row')].map(r => ({ key: r.dataset.alertKey || '', tag: r.querySelector('.aq-tag').textContent, name: r.querySelector('.aq-name').textContent }));
      return { a: a.map(x => ({ key: x.key, sev: x.severity, label: x.label, sub: x.sub })), q, badge: document.getElementById('global-alerts-badge').textContent, bell: document.getElementById('global-alerts-list').textContent, hero: document.getElementById('dash-hero-title').textContent };
    });
    check('A3 bell alerts keyed per nomination: ais|n1 (amber), ais|n2 (red)',
      al.a.length === 2 && al.a.find(x => x.key === 'ais|n1' && x.sev === 'warning' && /^OCEAN PEARL — AIS suggests arrival/.test(x.sub)) && al.a.find(x => x.key === 'ais|n2' && x.sev === 'error' && x.label === 'AIS: may miss laycan'), al.a);
    check('A3 bell lists them', /AIS: may miss laycan/.test(al.bell) && /AIS: arriving after ETA/.test(al.bell) && Number(al.badge) >= 2, al.bell);
    check('A3 Needs Attention lists both with an AIS tag (keyed rows)', al.q.filter(r => r.tag === 'AIS').length === 2 && al.q.some(r => r.key === 'ais|n2' && r.name === 'BLUE MARLIN'), al.q);
    check('A3 hero counts them', /2 need your attention|\d+ need your attention/.test(al.hero) && !/nothing needs/.test(al.hero), al.hero);
    check('A3 warnings already there at login do not toast', !(await page.evaluate(() => __toasts().some(t => /AIS:/.test(t)))), await page.evaluate(() => __toasts()));
    // Needs Attention → Open goes to the nomination
    await page.evaluate(() => { const b = [...document.querySelectorAll('#dash-action-queue .aq-row')].find(r => r.dataset.alertKey === 'ais|n1').querySelector('.aq-btn'); b.click(); });
    await sleep(300);
    check('A3 "Open" in Needs Attention opens the nomination', await page.evaluate(() => _currentPage === 'nominations'));
    await page.evaluate(() => showPage('dashboard'));

    // realtime: the function writes → open apps update without waiting for the 2-min poll; same keys don't re-toast
    const w0 = writesBy(db, 'user-operator');
    const loads0 = await page.evaluate(() => _ais.loads);
    H.aisWrite(db, 'ais_positions', Object.assign({}, s.positions[0], dest('FUJ-A', 110, 50), { position_time: iso(Date.now() - 1 * MIN), updated_at: iso(Date.now()) }));
    const dt = await until(page, () => /50 nm to FUJ A/.test(__line('n1').textContent), null, 4000);
    check('A3 Realtime: a new position appears without waiting for the poll (' + dt + ' ms)', dt >= 0 && await page.evaluate(() => _ais.channel && /^ais-positions-/.test(_ais.channel.name)), dt);
    check('A3 same warning, new numbers → same key, no new toast', !(await page.evaluate(() => __toasts().some(t => /AIS:/.test(t)))) && await page.evaluate(() => computeGlobalAlerts().filter(a => a.key === 'ais|n1').length === 1));
    // FRAME RUNNER now far away → a NEW warning → exactly one toast for it
    H.aisWrite(db, 'ais_positions', Object.assign({}, s.positions[5], dest('FUJ-A', 140, 600), { position_time: iso(Date.now() - 1 * MIN), updated_at: iso(Date.now()) }));
    const dt2 = await until(page, () => __toasts().some(t => /^AIS: arriving after ETA — FRAME RUNNER/.test(t)), null, 4000);
    H.aisWrite(db, 'ais_status', { id: 1, last_run_at: iso(Date.now()), last_ok_at: iso(Date.now()), ok: true, tracked: 6, found: 5 });
    await sleep(1200);
    const toasts = await page.evaluate(() => __toasts().filter(t => /AIS:/.test(t)));
    check('A3 a newly late vessel toasts once (' + dt2 + ' ms), further updates do not repeat it', dt2 >= 0 && toasts.length === 1, toasts);
    // a borderline vessel flapping around its threshold toasts once per level per session
    const P0 = s.positions[0];
    const moveOP = (nmFromRef) => H.aisWrite(db, 'ais_positions', Object.assign({}, P0, dest('FUJ-A', 110, nmFromRef), { position_time: iso(Date.now() - 1 * MIN), updated_at: iso(Date.now()) }));
    const hasN1 = (sev) => page.evaluate((sev) => computeGlobalAlerts().some(a => a.key === 'ais|n1' && (!sev || a.severity === sev)), sev);
    const waitN1 = async (sev, present) => { const t0 = Date.now(); while (Date.now() - t0 < 4000) { if ((await hasN1(sev)) === present) return true; await sleep(100); } return false; };
    moveOP(10);  const f1 = await waitN1(null, false);      // on time now → alert gone
    moveOP(50);  const f2 = await waitN1('warning', true);  // late again (amber) — already toasted at login
    await sleep(300);
    const t1 = await page.evaluate(() => __toasts().filter(t => /OCEAN PEARL/.test(t)).length);
    moveOP(400); const f3 = await waitN1('error', true);    // after the laycan now → red → one toast
    await sleep(400);
    const t15 = await page.evaluate(() => __toasts().filter(t => /OCEAN PEARL/.test(t)));
    check('A3 amber → red (same nomination) toasts the new level straight away', t15.length === 1 && /^AIS: may miss laycan — OCEAN PEARL/.test(t15[0]), t15);
    moveOP(10);  const f4 = await waitN1(null, false);
    moveOP(400); const f5 = await waitN1('error', true);    // red again → no repeat
    await sleep(400);
    const t2 = await page.evaluate(() => __toasts().filter(t => /OCEAN PEARL/.test(t)));
    check('A3 a vessel flapping across the threshold: no repeat toast for the same level; escalation to red toasts once',
      f1 && f2 && f3 && f4 && f5 && t1 === 0 && t2.length === 1 && /^AIS: may miss laycan — OCEAN PEARL/.test(t2[0]), [f1, f2, f3, f4, f5, t1, t2]);
    check('A3 the poll / realtime reads never write the workspace', writesBy(db, 'user-operator') === w0 && (await page.evaluate(() => _ais.loads)) > loads0, [w0, writesBy(db, 'user-operator')]);
    // 2-minute poll + tab coming back
    const p = await page.evaluate(async () => {
      const l0 = _ais.loads;
      _ais.loadedAt = Date.now() - AIS_CFG.pollMs - 1000;
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise(r => setTimeout(r, 400));
      return { pollMs: AIS_CFG.pollMs, timer: !!_ais.timer, l0, l1: _ais.loads };
    });
    check('A3 re-reads every 2 min while visible (and when the tab comes back after that)', p.pollMs === 120000 && p.timer && p.l1 === p.l0 + 1, p);

    if (SHOTS) {
      await page.evaluate(() => { document.querySelectorAll('#toast-stack .toast').forEach(t => t.remove()); });
      await page.evaluate(() => { const el = document.getElementById('dash-action-queue'); const hb = document.getElementById('topbar'); window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - (hb ? hb.getBoundingClientRect().bottom : 0) - 8, behavior: 'instant' }); toggleGlobalAlertsPanel(); });
      await sleep(250);
      await shot(page, 'ais-alerts-needs-attention.png');
      await page.evaluate(() => toggleGlobalAlertsPanel());
    }
    // phone: dashboard card fits
    await page.setViewportSize({ width: 390, height: 844 });
    await sleep(400);
    const ph = await page.evaluate(() => {
      const card = document.getElementById('dash-ais').getBoundingClientRect();
      const rows = [...document.querySelectorAll('#dash-ais .ais-row')].map(r => r.getBoundingClientRect());
      return { docW: document.documentElement.scrollWidth, winW: innerWidth, fit: card.right <= innerWidth + 1 && rows.every(r => r.right <= innerWidth + 1) };
    });
    check('A3 phone (390 px): dashboard card fits, no horizontal scroll', ph.docW <= ph.winW + 1 && ph.fit, ph);
    if (SHOTS) {
      await page.evaluate(() => { document.querySelectorAll('#toast-stack .toast').forEach(t => t.remove()); const el = document.getElementById('dash-ais'); const hb = document.getElementById('topbar'); window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - (hb ? hb.getBoundingClientRect().bottom : 0) - 8, behavior: 'instant' }); });
      await sleep(250);
      await shot(page, 'ais-dashboard-phone.png');
    }
  });

  /* 4 — operator "Refresh now" */
  await scenario(browser, 'A4 Refresh now', async (openT) => {
    const now = Date.now();
    let runs = 0;
    const functions = {
      'ais-poll': async (op, ctx) => {
        runs++;
        const mode = ctx.db.__mode;
        if (mode === 'started') {
          setTimeout(() => {
            ctx.write('ais_positions', [{ mmsi: '311000099', imo: '9111111', name: 'GHOST TRADER', matched_by: 'imo', sog: 8, nav_status: 0, position_time: iso(Date.now() - MIN), updated_at: iso(Date.now()), ...dest('FUJ-A', 100, 25) }]);
            ctx.write('ais_status', { id: 1, running_since: null, last_run_at: iso(Date.now()), last_ok_at: iso(Date.now()), ok: true, tracked: 6, found: 6, error: null });
          }, 1200);
          return { status: 202, body: { ok: true, started: true, via: 'operator' } };
        }
        if (mode === 'started-silent') { setTimeout(() => { const st = ctx.db.tables.ais_status.get(1); Object.assign(st, { last_run_at: iso(Date.now()), ok: false, error: 'aisstream.io: Api Key Is Not Valid', running_since: null }); }, 800); return { status: 202, body: { ok: true, started: true } }; }
        if (mode === 'started-partial') {
          setTimeout(() => ctx.write('ais_status', { id: 1, running_since: null, last_run_at: iso(Date.now()), ok: true, tracked: 6, found: 5, error: 'Partial run: aisstream.io closed the connection (code 1011) during phase A' }), 800);
          return { status: 202, body: { ok: true, started: true } };
        }
        if (mode === 'gateway') return { status: 401, body: { code: 401, message: 'Invalid JWT' } };   // Supabase's gateway, not the function
        if (mode === 'deferred') return { status: 200, body: { ok: true, busy: true, deferred: true, error: 'This function instance is near its time limit' } };
        if (mode === 'never') return { status: 202, body: { ok: true, started: true } };
        if (mode === 'throttled') return { status: 200, body: { ok: true, throttled: true, status: {} } };
        if (mode === 'running') return { status: 200, body: { ok: true, running: true, status: {} } };
        if (mode === 'error') return { status: 502, body: { ok: false, error: 'The AISSTREAM_API_KEY secret is not set (Edge Functions → Secrets)' } };
        if (mode === 'forbidden') return { status: 403, body: { ok: false, error: 'Only operators can refresh live positions' } };
        if (mode === 'fetch') return { fetchError: 'down' };
        if (mode === 'sync') return { status: 200, body: { ok: true, tracked: 6, found: 3, messages: 900 } };
        return { status: 500, body: null };
      },
    };
    const { db } = makeDb(now, { functions });
    db.__mode = 'started';
    const { page } = await openT(db, 'user-operator');
    await page.evaluate(() => { try { flowWelcomeGo('dashboard'); } catch (e) {} showPage('dashboard'); });
    const btnState = () => page.evaluate(() => { const b = document.getElementById('ais-refresh-btn'); return { disabled: b.disabled, text: b.textContent, sub: document.getElementById('dash-ais-sub').textContent }; });
    await page.evaluate(() => document.getElementById('ais-refresh-btn').click());
    await sleep(250);
    const during = await btnState();
    check('A4 click → functions.invoke("ais-poll") as the operator; button disabled "Refreshing…" while it runs',
      db.invokeLog.length === 1 && db.invokeLog[0].name === 'ais-poll' && db.invokeLog[0].uid === 'user-operator' && during.disabled && during.text === 'Refreshing…' && /^Refreshing…/.test(during.sub), [db.invokeLog, during]);
    await page.evaluate(() => document.getElementById('ais-refresh-btn').click());
    check('A4 a second click while running does nothing', db.invokeLog.length === 1);
    check('A4 202 started → "Fetching live positions…" toast', await page.evaluate(() => __toasts().some(t => /^Fetching live positions — this takes about 1½ minutes/.test(t))));
    const dt = await until(page, () => __toasts().some(t => /^Live positions updated — 6 of 6 nominated vessels seen\.$/.test(t)), null, 6000);
    const after = await btnState();
    check('A4 picks up the result when ais_status.last_run_at changes (' + dt + ' ms), button back', dt >= 0 && !after.disabled && after.text === 'Refresh now', after);
    check('A4 the new position is shown (GHOST TRADER now seen)', await page.evaluate(() => /Approaching/.test(__line('n4').textContent)));

    // without Realtime: the short ais_status poll finds the end of the run
    db.realtime = false; db.__mode = 'started-silent';
    await page.evaluate(() => { AIS_CFG.refreshPollMs = 300; window.__toastLog.length = 0; });
    await page.evaluate(() => aisRefreshNow());
    const dt2 = await until(page, () => __toasts().some(t => /^Live position update failed: aisstream\.io: Api Key Is Not Valid$/.test(t)), null, 5000);
    check('A4 no Realtime: the short status poll sees the run end; a failed run is reported (' + dt2 + ' ms)', dt2 >= 0 && !(await btnState()).disabled);
    check('A4 operator sees the failure under the card title', /Last update failed: aisstream\.io: Api Key Is Not Valid/.test((await btnState()).sub));
    db.realtime = true;
    db.__mode = 'started-partial';
    await page.evaluate(() => { window.__toastLog.length = 0; aisRefreshNow(); });
    const dtp = await until(page, () => window.__toastLog.some(t => t.type === 'warning' && /^Live positions partly updated — 5 of 6 nominated vessels seen\. Partial run: aisstream\.io closed the connection/.test(t.m)), null, 5000);
    check('A4 a partial run (connection dropped) → warning toast + "Last update incomplete" under the title (' + dtp + ' ms)', dtp >= 0 && /Last update incomplete: Partial run/.test((await btnState()).sub), [await page.evaluate(() => __toasts()), (await btnState()).sub]);

    const cases = [
      ['notDeployed', null, /^The ais-poll function is not deployed yet — see README/],
      ['error', 'error', /^Live position refresh failed: The AISSTREAM_API_KEY secret is not set/],
      ['forbidden', 'forbidden', /^Only operators can refresh live positions$/],
      ['gatewayJwt', 'gateway', /^Supabase refused the request before ais-poll ran — “Verify JWT” is probably still ON for the ais-poll function/],
      ['deferred', 'deferred', /^The live-position service is restarting — try Refresh now again in a minute\.$/],
      ['fetch', 'fetch', /^Could not reach the ais-poll function — is it deployed\?/],
      ['throttled', 'throttled', /^Live positions were updated less than 2 minutes ago/],
      ['running', 'running', /^A live position update is already running/],
      ['sync', 'sync', /^Live positions updated — 3 of 6 nominated vessels seen\.$/],
    ];
    for (const [label, mode, re] of cases) {
      if (mode === null) delete db.functions['ais-poll']; else { db.functions['ais-poll'] = functions['ais-poll']; db.__mode = mode; }
      if (label === 'running') await page.evaluate(() => { AIS_CFG.refreshTimeoutMs = 800; });
      await page.evaluate(() => { window.__toastLog.length = 0; });
      await page.evaluate(() => aisRefreshNow());
      const t = await until(page, (re) => __toasts().some(x => new RegExp(re).test(x)), re.source, 4000);
      let timedOut = true;
      if (label === 'running') { await until(page, () => !_ais.refresh, null, 4000); timedOut = await page.evaluate(() => __toasts().some(t => /^Still collecting live positions/.test(t))); }
      const b = await btnState();
      check('A4 ' + label + ' → toast ' + re.source.slice(1, 50) + '…, button usable again' + (label === 'running' ? ' (waited for the run, then timed out politely)' : ''), t >= 0 && timedOut && !b.disabled && b.text === 'Refresh now', [await page.evaluate(() => __toasts()), b]);
    }
    db.functions['ais-poll'] = functions['ais-poll']; db.__mode = 'never';
    const w0 = writesBy(db, 'user-operator');
    await page.evaluate(() => { window.__toastLog.length = 0; AIS_CFG.refreshTimeoutMs = 700; aisRefreshNow(); });
    const t3 = await until(page, () => __toasts().some(x => /^Still collecting live positions/.test(x)), null, 4000);
    check('A4 a run that never reports back → "Still collecting…" after the timeout, nothing written to the workspace', t3 >= 0 && writesBy(db, 'user-operator') === w0 && !(await btnState()).disabled);
    if (SHOTS) {
      await page.evaluate(() => { AIS_CFG.refreshTimeoutMs = 600000; document.querySelectorAll('#toast-stack .toast').forEach(t => t.remove()); aisRefreshNow(); });
      await sleep(400);
      await shot(page.locator('#dash-ais'), 'ais-dashboard-refreshing.png');
      await page.evaluate(() => _aisRefreshEnd());
    }
  });

  /* 5 — trader: card without the button, read-only */
  await scenario(browser, 'A5 trader view', async (openT) => {
    const now = Date.now();
    const { db } = makeDb(now, { functions: { 'ais-poll': async () => ({ status: 202, body: { ok: true, started: true } }) } });
    const { page } = await openT(db, 'user-trader');
    await page.evaluate(() => { try { flowWelcomeGo('dashboard'); } catch (e) {} showPage('dashboard'); });
    await sleep(300);
    const t = await page.evaluate(() => ({
      role: ABPS_ROLE, shown: document.getElementById('dash-ais').style.display !== 'none', btn: document.getElementById('ais-refresh-btn').style.display,
      rows: document.querySelectorAll('#dash-ais .ais-row').length, line: __line('n1').classList.contains('show'),
      alerts: computeGlobalAlerts().filter(a => /^ais\|/.test(a.key)).length,
    }));
    check('A5 trader sees the positions card (6 rows) but no Refresh now button', t.role === 'trader' && t.shown && t.btn === 'none' && t.rows === 6, t);
    check('A5 trader sees the card lines and the AIS alerts too', t.line && t.alerts === 2, t);
    await page.evaluate(() => aisRefreshNow());
    await sleep(300);
    check('A5 aisRefreshNow() does nothing for a trader (no function call)', db.invokeLog.length === 0);
    if (SHOTS) {
      await page.evaluate(() => { document.querySelectorAll('#toast-stack .toast').forEach(t => t.remove()); const el = document.getElementById('dash-ais'); const hb = document.getElementById('topbar'); window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - (hb ? hb.getBoundingClientRect().bottom : 0) - 8, behavior: 'instant' }); });
      await sleep(250);
      await shot(page, 'ais-dashboard-trader.png');
    }
  });

  /* 6 — not configured: friendly note for operators, nothing for traders, no writes, no channel */
  await scenario(browser, 'A6 not configured', async (openT) => {
    const now = Date.now();
    const { db } = makeDb(now, { ais: false });
    const op = await openT(db, 'user-operator');
    await op.page.evaluate(() => { try { flowWelcomeGo('dashboard'); } catch (e) {} showPage('dashboard'); });
    await sleep(300);
    const w0 = writesBy(db, 'user-operator');
    const o = await op.page.evaluate(async () => {
      await _aisLoad('test'); await _aisLoad('test'); _aisRenderAll(); refreshDashboard();
      return {
        state: _ais.state, shown: document.getElementById('dash-ais').style.display !== 'none', note: document.getElementById('dash-ais-body').textContent,
        btn: document.getElementById('ais-refresh-btn').style.display, lines: document.querySelectorAll('.ais-line.show').length,
        channels: window.__mockRealtime.channels.map(c => c.name), alerts: computeGlobalAlerts().filter(a => /^ais\|/.test(a.key)).length,
      };
    });
    await sleep(1500);
    check('A6 tables missing → operator card says "Live positions not set up yet — see README"', o.state === 'missing' && o.shown && /^Live positions not set up yet — see README → “Live vessel positions \(AIS\)”\.$/.test(o.note.trim()) && o.btn === 'none', o);
    check('A6 no card lines, no AIS alerts, no AIS realtime channel', o.lines === 0 && o.alerts === 0 && o.channels.length === 1 && o.channels[0] === 'workspace', o);
    check('A6 nothing written to the workspace', writesBy(db, 'user-operator') === w0, [w0, writesBy(db, 'user-operator')]);
    if (SHOTS) {
      await op.page.evaluate(() => { document.querySelectorAll('#toast-stack .toast').forEach(t => t.remove()); });
      await shot(op.page.locator('#dash-ais'), 'ais-not-configured-operator.png');
    }
    const tr = await openT(db, 'user-trader');
    await tr.page.evaluate(() => { try { flowWelcomeGo('dashboard'); } catch (e) {} showPage('dashboard'); });
    const t = await tr.page.evaluate(() => ({ state: _ais.state, shown: document.getElementById('dash-ais').style.display !== 'none', lines: document.querySelectorAll('.ais-line.show').length, toasts: __toasts().filter(x => /AIS|position/i.test(x)) }));
    check('A6 trader: nothing shown, no toasts', t.state === 'missing' && !t.shown && t.lines === 0 && t.toasts.length === 0, t);
    // tables exist but the function never ran → still "not set up", but Refresh now offered to operators
    const { db: db2 } = makeDb(now, { ais: { positions: [], status: {} } });
    const op2 = await openT(db2, 'user-operator');
    await op2.page.evaluate(() => { try { flowWelcomeGo('dashboard'); } catch (e) {} showPage('dashboard'); });
    const o2 = await op2.page.evaluate(() => ({ state: _ais.state, note: document.getElementById('dash-ais-body').textContent, btn: document.getElementById('ais-refresh-btn').style.display, lines: document.querySelectorAll('.ais-line.show').length, ch: window.__mockRealtime.channels.length }));
    check('A6 tables created but never run: note + Refresh now for operators, no "Not seen" noise on cards', o2.state === 'ready' && /not set up yet/.test(o2.note) && /press Refresh now/.test(o2.note) && o2.btn === '' && o2.lines === 0, o2);
    const tr2 = await openT(db2, 'user-trader');
    check('A6 …and still nothing for traders', await tr2.page.evaluate(() => document.getElementById('dash-ais').style.display === 'none'));
    // client writes to the AIS tables are refused (RLS in the fake mirrors the SQL)
    const rls = await op2.page.evaluate(async () => { const r = await supabaseClient.from('ais_positions').upsert({ mmsi: '1' }); return r.error && r.error.code; });
    check('A6 the app cannot write ais_positions (RLS)', rls === '42501', rls);
  });

  /* 7 — hostile AIS text never becomes markup */
  await scenario(browser, 'A7 XSS', async (openT) => {
    const now = Date.now();
    const evil = '<img src=x onerror="window.__xss=1">';
    const vessels = [vessel({ nomUid: 'x1', name: evil, imo: '', area: 'FUJ-A', eta: dubai(now + 1 * HR), lc: dubai(now - 24 * HR) + ' - ' + dubai(now + 2 * HR) })];
    const positions = [Object.assign({
      mmsi: '123"><img src=x onerror="window.__xss=3">', imo: '"><svg onload="window.__xss=4">', name: evil, sog: 10, nav_status: 0,
      destination: '"><svg onload="window.__xss=2"></svg>', ais_eta: '<b onmouseover="window.__xss=5">10-16</b>', matched_by: 'name',
      position_time: iso(now - 5 * MIN), updated_at: iso(now - 5 * MIN),
    }, dest('FUJ-A', 110, 40))];
    const status = { last_run_at: iso(now - 5 * MIN), last_ok_at: iso(now - 30 * MIN), ok: false, error: '<img src=x onerror="window.__xss=6">', tracked: 1, found: 1 };
    const { db } = makeDb(now, { vessels, ais: { positions, status }, functions: { 'ais-poll': async () => ({ status: 502, body: { ok: false, error: '<img src=x onerror="window.__xss=7">' } }) } });
    const { page } = await openT(db, 'user-operator');
    await page.evaluate(() => { try { flowWelcomeGo('dashboard'); } catch (e) {} showPage('dashboard'); });
    await page.evaluate(() => aisRefreshNow());
    await sleep(800);
    await page.evaluate(() => showPage('nominations'));
    await sleep(300);
    const r = await page.evaluate(() => {
      const line = __line('x1'), dash = document.getElementById('dash-ais');
      const bad = sel => [...document.querySelectorAll(sel)].filter(el => el.closest('#dash-ais, .ais-line, #global-alerts-list, #dash-action-queue, #toast-stack')).length;
      return {
        xss: window.__xss, imgs: bad('img[src="x"]'), svgs: bad('svg[onload]'), bs: bad('b[onmouseover]'),
        lineText: line.textContent, dashText: dash.textContent, links: [...line.querySelectorAll('a')].length,
        alert: computeGlobalAlerts().filter(a => /^ais\|/.test(a.key)).map(a => a.sub), toasts: __toasts(),
      };
    });
    check('A7 nothing executed, no injected elements', r.xss === undefined && r.imgs === 0 && r.svgs === 0 && r.bs === 0, r);
    check('A7 hostile name / destination / AIS ETA shown as text', r.lineText.includes('Dest. "><svg onload="window.__xss=2"></svg>') && r.lineText.includes('AIS ETA <b onmouseover="window.__xss=5">10-16</b>') && r.dashText.includes('<img src=x onerror="window.__xss=1">'), r.lineText);
    check('A7 malformed MMSI / IMO → no map links at all', r.links === 0, r.links);
    check('A7 hostile error text from the function / status shown as text', r.dashText.includes('Last update failed: <img src=x onerror="window.__xss=6">') && r.toasts.some(t => t.includes('<img src=x onerror="window.__xss=7">')), [r.dashText, r.toasts]);
    check('A7 the alert carries the raw name as text (bell escapes it)', r.alert.length === 1 && r.alert[0].startsWith('<img src=x'), r.alert);
  });

  /* 8 — the 2-minute poll / passing time never rebuild the dashboard (charts, week calendar) */
  await scenario(browser, 'A8 no dashboard rebuilds', async (openT) => {
    const now = Date.now();
    const { db, s } = makeDb(now);
    const { page } = await openT(db, 'user-operator');
    await page.evaluate(() => { try { flowWelcomeGo('dashboard'); } catch (e) {} showPage('dashboard'); });
    await sleep(500);
    await page.evaluate(() => {
      shiftWeekCal(7);
      window.__dashRefreshes = 0;
      const orig = refreshDashboard;
      refreshDashboard = function () { window.__dashRefreshes++; return orig.apply(this, arguments); };
    });
    await sleep(500);
    const b = await page.evaluate(() => ({ off: _calWeekOffset, n: window.__dashRefreshes, seen: __line('n1').querySelector('.ais-ago').textContent }));
    const a = await page.evaluate(async () => {
      const realNow = Date.now;
      Date.now = () => realNow() + 3 * 60000;   // 3 minutes later: polls re-read unchanged data, the 30-s tick runs
      try {
        await _aisLoad('poll'); await _aisLoad('poll'); _aisTickAgo(document);
        await new Promise(r => setTimeout(r, 700));
        return { off: _calWeekOffset, n: window.__dashRefreshes, seen: __line('n1').querySelector('.ais-ago').textContent, sub: document.getElementById('dash-ais-sub').textContent };
      } finally { Date.now = realNow; }
    });
    check('A8 polls with unchanged data + time passing: "seen" ages in place, no dashboard rebuild, week calendar stays on next week',
      b.off === 7 && b.seen === 'seen 8 min ago' && a.seen === 'seen 11 min ago' && /^Updated 8 min ago/.test(a.sub) && a.n === 0 && a.off === 7, [b, a]);
    // a moored ship's new fix: same position and speed, newer time → "seen" resets
    H.aisWrite(db, 'ais_positions', Object.assign({}, s.positions[2], { position_time: iso(Date.now() - MIN), updated_at: iso(Date.now()) }));
    const dts = await until(page, () => __line('n3').querySelector('.ais-ago').textContent === 'seen 1 min ago', null, 4000);
    check('A8 a new fix with the same position/speed resets "seen …" on the card line (' + dts + ' ms)', dts >= 0, await page.evaluate(() => __line('n3').textContent));
    H.aisWrite(db, 'ais_positions', Object.assign({}, s.positions[0], dest('FUJ-A', 110, 45), { position_time: iso(Date.now() - MIN), updated_at: iso(Date.now()) }));
    const dt = await until(page, () => /45 nm to FUJ A/.test(__line('n1').textContent) && /45 nm/.test(document.getElementById('dash-ais').textContent), null, 4000);
    const aqSame = await until(page, () => { const r = document.querySelector('#dash-action-queue [data-alert-key="ais|n1"] .aq-detail'), w = __line('n1').querySelector('.ais-warn'); return !!(r && w && r.textContent === w.textContent); }, null, 4000);
    check('A8 Needs Attention shows the new estimate / hours after a new fix (same level)', aqSame >= 0, await page.evaluate(() => [((document.querySelector('#dash-action-queue [data-alert-key="ais|n1"] .aq-detail') || {}).textContent), (__line('n1').querySelector('.ais-warn') || {}).textContent]));
    H.aisWrite(db, 'ais_positions', Object.assign({}, s.positions[0], dest('FUJ-A', 110, 10), { position_time: iso(Date.now() - MIN), updated_at: iso(Date.now()) }));
    const dt2 = await until(page, () => !document.querySelector('#dash-action-queue [data-alert-key="ais|n1"]') && document.querySelector('#dash-action-queue [data-alert-key="ais|n2"]'), null, 4000);
    await sleep(500);
    const fin = await page.evaluate(() => ({ off: _calWeekOffset, n: window.__dashRefreshes, hero: document.getElementById('dash-hero-title').textContent }));
    check('A8 a real change updates the card line, the AIS card and Needs Attention — still no rebuild (' + dt + ' / ' + dt2 + ' ms)', dt >= 0 && dt2 >= 0 && fin.n === 0 && fin.off === 7, fin);
  });

  /* 9 — the feed stopped (cron deleted, key revoked…): no stale lines everywhere */
  await scenario(browser, 'A9 feed stopped', async (openT) => {
    const now = Date.now();
    const s = scene(now);
    const old = iso(now - 30 * HR);
    const positions = s.positions.map(p => Object.assign({}, p, { updated_at: old }));
    const status = { last_run_at: iso(now - 10 * MIN), last_ok_at: old, last_cron_at: iso(now - 10 * MIN), running_since: null, ok: false, error: 'aisstream.io: Api Key Is Not Valid', tracked: 6, found: 0 };
    const { db } = makeDb(now, { ais: { positions, status } });
    const op = await openT(db, 'user-operator');
    await op.page.evaluate(() => { try { flowWelcomeGo('dashboard'); } catch (e) {} showPage('dashboard'); });
    await sleep(300);
    const o = await op.page.evaluate(() => ({ note: document.getElementById('dash-ais-body').textContent.trim(), lines: document.querySelectorAll('.ais-line.show').length, alerts: computeGlobalAlerts().filter(a => /^ais\|/.test(a.key)).length, btn: document.getElementById('ais-refresh-btn').style.display, rows: document.querySelectorAll('#dash-ais .ais-row').length }));
    check('A9 no successful update for 30 h → one note for operators ("AIS feed not updating since …", last error), Refresh offered',
      /^AIS feed not updating since \d+ \w{3} \d\d:\d\d — no successful update for 30 h\. Vessel positions are hidden until it runs again/.test(o.note) && /Last error: aisstream\.io: Api Key Is Not Valid/.test(o.note) && o.btn === '' && o.rows === 0, o);
    check('A9 …and no stale per-vessel lines or warnings', o.lines === 0 && o.alerts === 0, o);
    if (SHOTS) { await op.page.evaluate(() => document.querySelectorAll('#toast-stack .toast').forEach(t => t.remove())); await shot(op.page.locator('#dash-ais'), 'ais-feed-stopped-operator.png'); }
    const tr = await openT(db, 'user-trader');
    const t = await tr.page.evaluate(() => ({ shown: document.getElementById('dash-ais').style.display !== 'none', lines: document.querySelectorAll('.ais-line.show').length }));
    check('A9 traders see nothing', !t.shown && t.lines === 0, t);
    H.aisWrite(db, 'ais_status', { id: 1, last_run_at: iso(Date.now()), last_ok_at: iso(Date.now()), ok: true, error: null });
    const dt = await until(op.page, () => document.querySelectorAll('.ais-line.show').length === 6 && document.querySelectorAll('#dash-ais .ais-row').length === 6, null, 4000);
    check('A9 when updates resume, lines and rows come back by themselves', dt >= 0);
  });

  /* 10 — are the scheduled (cron) runs happening? operators are told when not */
  await scenario(browser, 'A10 scheduled runs', async (openT) => {
    const now = Date.now();
    const s = scene(now);
    const noCron = Object.assign({}, s.status, { last_run_at: iso(now - 40 * MIN), last_ok_at: iso(now - 40 * MIN) });
    delete noCron.last_cron_at;   // supabase_ais_setup.sql not re-run: no last_cron_at column
    const cases = [
      ['stopped', Object.assign({}, s.status, { last_cron_at: iso(now - 47 * MIN), last_run_at: iso(now - 3 * MIN), last_ok_at: iso(now - 3 * MIN) }), /^Automatic updates seem to have stopped — last scheduled call 47 min ago\. Check the cron job \(README steps 5–6\)\.$/],
      ['neverScheduled', Object.assign({}, s.status, { last_cron_at: null }), /^No scheduled call yet — if the cron job is set up, one arrives within 10 minutes/],
      ['oldSqlStopped', noCron, /^Updates seem to have stopped — last run 40 min ago\. Check the cron job/],
      ['fine', s.status, null],
    ];
    for (const [label, status, re] of cases) {
      const { db } = makeDb(now, { ais: { positions: s.positions, status } });
      const op = await openT(db, 'user-operator');
      const t = await op.page.evaluate(() => { const el = document.querySelector('#dash-ais-sub [data-ais-sched]'); return el ? el.textContent : ''; });
      check('A10 ' + label + (re ? ' → operators warned: ' + re.source.slice(1, 60) + '…' : ' → no warning'), re ? re.test(t) : t === '', t);
      if (label === 'stopped') {
        if (SHOTS) { await op.page.evaluate(() => { try { flowWelcomeGo('dashboard'); } catch (e) {} showPage('dashboard'); document.querySelectorAll('#toast-stack .toast').forEach(t => t.remove()); }); await sleep(300); await shot(op.page.locator('#dash-ais'), 'ais-cron-stopped-operator.png'); }
        const tr = await openT(db, 'user-trader');
        check('A10 traders never see it', await tr.page.evaluate(() => !document.querySelector('#dash-ais-sub [data-ais-sched]') && document.querySelectorAll('#dash-ais .ais-row').length === 6));
      }
    }
  });

  await browser.close();
  console.log(`AIS: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exit(2); });
