/* Stock forecast: a loading whose window has passed but that nobody marked Completed
   counts in the forecast (from now, capped at tank capacity) until it is marked Completed,
   and is flagged in Projected events with a "Mark Completed" button.
   • FNSA 11 at 424 MT with a 4,350 MT loading that ended last night, not completed:
     stock from now = 4,774, the "reload by" recommendation is gone, the event is listed
   • the Mark Completed button completes the loading: it drops out of the forecast (stock back
     to the ROB) with a toast saying to record the reload; the Loading page shows it completed
   • a loading already marked Completed, a deleted one, or another barge's: not counted
   • capped at tank capacity; a trader sees the line but no button
   • NOT counted (only flagged) once the ROB already holds it: a reload of that grade recorded
     after the loading started, an ROB Update after it started, or ended over 2 days ago
   • a loading that ended before an overdue job tops the tank up before that job draws on it
   • the flag is visible on the Barge Fleet card itself (not only in the collapsed events list);
     Mark Completed twice does not re-save
   node suites/fix2/pending-loading.test.js [appDir] */
const path = require('path');
if (process.argv[2]) process.env.APP_DIR = path.resolve(process.argv[2]);
const H = require(path.join(__dirname, '..', '..', 'harness', 'harness.js'));
const U = require(path.join(__dirname, '..', 'r3', 'util.js'));

let pass = 0, fail = 0;
function check(name, cond, info) {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 700)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = n => String(n).padStart(2, '0');
const fmtDT = x => `${p2(x.getDate())} ${MO[x.getMonth()]} ${x.getFullYear()} ${p2(x.getHours())}:${p2(x.getMinutes())}`;
const hrs = h => new Date(Date.now() + h * 3600000);
const VBASE = { imo: '', area: 'FUJ-A', spec: 'ISO 8217:2010', agent: 'AG', manifold: 'VESSEL MANIFOLD', remarks: '', lc: '', paq: 'no', refuelChk: false, rfv: 0, rfm: 0, rfvr: 750, rfmr: 275 };
const BARGE = { vcap: 5000, mcap: 1000, vbuf: 200, mbuf: 50, vtph: 300, mtph: 100, vrfr: 750, mrfr: 275 };
const loading = o => Object.assign({ id: o.id, qty: o.qty, barge: o.barge, grade: o.grade || 'VLSFO', terminal: 'VOPAK TERMINAL', notes: '', surveyor: '', startAt: hrs(o.s).toISOString(), endAt: hrs(o.e).toISOString(), preOpsHours: 2.5, postOpsHours: 3.5, pumpHours: 5, estimatedHours: 11, endOverridden: false, updatedAt: Date.now() }, o.extra || {});

// FNSA 11 at 424 / 486 with ERA S (500 VLSFO) tomorrow 08:00; FNSA 10 untouched.
function seed(o) {
  o = o || {};
  const s = U.seedPayload({ vessels: [Object.assign({}, VBASE, { nomUid: 'n1', name: 'ERA S', type: 'VLSFO', qty: 500, mgo: 100, eta: fmtDT(hrs(22)), bargeId: '2' })] });
  s.state.barges = [Object.assign({ id: 1, name: 'FNSA 10', vrob: 3229, mrob: 260 }, BARGE), Object.assign({ id: 2, name: 'FNSA 11', vrob: 424, mrob: 486 }, BARGE)];
  s.state.loadingRecords = o.loadings || [loading({ id: 'ld_pending', qty: 4350, barge: 'FNSA 11', s: -20, e: -9 })]; // ended 9 h ago, not completed
  return s;
}
async function open(browser, db, uid) {
  const a = await U.open(browser, db, uid);
  await U.helpers(a);
  await a.page.evaluate(() => { window.__toasts = []; const o = showToast; showToast = function(m, t) { window.__toasts.push(String(m)); return o.apply(this, arguments); }; window.confirm = () => true; window.alert = () => {}; });
  return a;
}
// The forecast for FNSA 11, as the planner computes and renders it.
const forecast = p => p.evaluate(async () => {
  calculate(); await _waitForSaveIdle();
  const fc = _bargeStockForecast(2, 7 * 24, {});
  const html = _rlCardHtml(fc, !isTrader());
  const div = document.createElement('div'); div.innerHTML = html;
  const pend = Array.from(div.querySelectorAll('li.rl-pending')).map(li => ({ text: li.textContent.replace(/\s+/g, ' ').trim(), btn: !!li.querySelector('.rl-done-btn') }));
  const first = fc.events.find(e => e.kind === 'pending-loading');
  return { robNow: [Math.round(fc.robNow.v), Math.round(fc.robNow.m)], start: [Math.round(fc.start ? fc.start.v : fc.events[fc.events.length ? 0 : 0].v), 0], pending: pend, firstV: first ? Math.round(first.v) : null, recs: fc.recs.map(r => [r.grade, Math.round(r.qty || 0)]), eventKinds: fc.events.map(e => e.kind) };
});

(async () => {
  const browser = await H.launch();
  const scenario = async (name, fn) => {
    console.log('— ' + name);
    const apps = [];
    try { await fn(async (db, uid) => { const a = await open(browser, db, uid); apps.push(a); return a; }); }
    catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
    const errs = [].concat(...apps.map(a => U.realErrors(a)));
    check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
    for (const a of apps) await a.ctx.close();
  };

  /* P1 — the ended, uncompleted loading counts and is flagged; Mark Completed drops it */
  await scenario('P1 pending loading', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db, 'user-operator');
    const f = await forecast(A.page);
    check('P1 ROB now is still the recorded 424, the pending loading lifts the stock to 4,774 from now (424 + 4,350)', f.robNow[0] === 424 && f.firstV === 4774, f);
    check('P1 the event is flagged: ended, not marked Completed, +4,350 MT VLSFO counted, with a Mark Completed button', f.pending.length === 1 && /ended, not marked Completed/.test(f.pending[0].text) && /\+4,350 MT VLSFO counted/.test(f.pending[0].text) && f.pending[0].btn, f.pending);
    check('P1 no VLSFO reload is recommended any more (ERA S needs 500 of 4,774)', !f.recs.some(r => r[0] === 'VLSFO'), f.recs);
    // Mark Completed from the forecast
    await A.page.evaluate(async () => { renderReloadPlanner && 0; rlCompleteLoading('ld_pending'); blConfirm(); await _waitForSaveIdle(); });
    const rec = U.row(db).payload.state.loadingRecords.find(r => r.id === 'ld_pending');
    const g = await forecast(A.page);
    check('P1 Mark Completed: the loading is Completed in the cloud, drops out of the forecast (stock back to 424 until the reload is recorded), the VLSFO reload is recommended again', rec && rec.completed === true && !!rec.completedAt && g.pending.length === 0 && g.firstV === null && g.recs.some(r => r[0] === 'VLSFO'), { rec: rec && [rec.completed, !!rec.completedAt], g });
    check('P1 …and the toast says to record the reload (BL 4,350 MT VLSFO)', (await A.page.evaluate(() => window.__toasts)).some(t => /marked Completed/.test(t) && /record the reload/.test(t) && /BL 4,350 MT VLSFO/.test(t)), await A.page.evaluate(() => window.__toasts));
  });

  /* P2 — what is NOT counted: completed, deleted, another barge; capacity cap; LSMGO */
  await scenario('P2 scope and cap', async (openT) => {
    const db = H.createDb({ workspace: seed({ loadings: [
      loading({ id: 'ld_done', qty: 4350, barge: 'FNSA 11', s: -20, e: -9, extra: { completed: true, completedAt: Date.now() - 3600000 } }),
      loading({ id: 'ld_del', qty: 4350, barge: 'FNSA 11', s: -20, e: -9, extra: { deletedAt: Date.now() - 3600000 } }),
      loading({ id: 'ld_other', qty: 4350, barge: 'FNSA 10', s: -20, e: -9 }),
      loading({ id: 'ld_big', qty: 9000, barge: 'FNSA 11', s: -30, e: -25 }),          // ended: counted, capped at 5,000
      loading({ id: 'ld_mgo', qty: 900, barge: 'FNSA 11', s: -8, e: -2, grade: 'LSMGO' }), // ended: counted, capped at 1,000
    ] }), realtime: false });
    const A = await openT(db, 'user-operator');
    const f = await A.page.evaluate(async () => { calculate(); await _waitForSaveIdle(); const fc = _bargeStockForecast(2, 7 * 24, {}); const ev = fc.events.filter(e => e.kind === 'pending-loading'); return { ids: ev.map(e => e.loadingId), v: ev.map(e => Math.round(e.v)), m: ev.map(e => Math.round(e.m)) }; });
    check('P2 only the ended, uncompleted loadings of this barge count (not the completed, deleted or FNSA 10 ones), oldest first', JSON.stringify(f.ids) === JSON.stringify(['ld_big', 'ld_mgo']), f);
    check('P2 capped at tank capacity: VLSFO 424 + 9,000 → 5,000; LSMGO 486 + 900 → 1,000', f.v[0] === 5000 && f.m[1] === 1000, f);
  });

  /* P3 — a trader sees the flagged line but no button */
  await scenario('P3 trader', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db, 'user-operator');
    await A.page.evaluate(async () => { calculate(); await _waitForSaveIdle(); });
    const T = await openT(db, 'user-trader');
    await sleep(800);
    const t = await T.page.evaluate(() => { const fc = _bargeStockForecast(2, 7 * 24, {}); const d = document.createElement('div'); d.innerHTML = _rlCardHtml(fc, false); const li = d.querySelector('li.rl-pending'); return { line: !!li, btn: !!(li && li.querySelector('.rl-done-btn')) }; });
    check('P3 trader: the flagged line without the Mark Completed button', t.line && !t.btn, t);
  });

  /* P4 — not counted once the ROB already holds it */
  await scenario('P4 superseded', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db, 'user-operator');
    // (a) the reload recorded through the Reload box after the loading started
    const a = await A.page.evaluate(async () => {
      calculate(); await _waitForSaveIdle();
      openReloadModal(2); document.getElementById('reload-vlsfo').value = '4350'; document.getElementById('reload-mgo').value = ''; await saveReloadQty(); await _waitForSaveIdle();
      const fc = _bargeStockForecast(2, 7 * 24, {}); const ev = fc.events.find(e => e.kind === 'pending-loading');
      const d = document.createElement('div'); d.innerHTML = _rlCardHtml(fc, true);
      return { robNow: Math.round(fc.robNow.v), start: Math.round(fc.start.v), counted: ev && ev.counted, why: ev && ev.why, dv: ev && ev.dv, note: (d.querySelector('.rl-pending-note') || {}).textContent, li: (d.querySelector('li.rl-pending') || {}).textContent, recs: fc.recs.map(r => r.grade) };
    });
    check('P4a reload recorded in ROB after the loading started: ROB 4,774, NOT added again (start 4,774, not 5,000), flagged as not counted', a.robNow === 4774 && a.start === 4774 && a.counted === false && /reload was recorded/.test(a.why) && a.dv === 0 && /not counted \(a VLSFO reload was recorded in ROB after it started\)/.test(a.note) && /not counted/.test(a.li) && /Mark Completed/.test(a.note), a);
    // (b) an ROB Update after the loading started (cloud dataset without the reload)
    const db2 = H.createDb({ workspace: seed(), realtime: false });
    const B = await openT(db2, 'user-operator');
    const b = await B.page.evaluate(async () => {
      calculate(); await _waitForSaveIdle();
      _manualROB['2_final'] = { v: 424, m: 486, reason: 'sounding', editedAt: new Date().toISOString(), editedBy: 'ROB Update', atIds: [], updatedAt: Date.now() };
      const noMarker = _bargeStockForecast(2, 7 * 24, {});
      _robMeasured(2);
      const fc = _bargeStockForecast(2, 7 * 24, {}); const ev = fc.events.find(e => e.kind === 'pending-loading');
      return { start: Math.round(fc.start.v), legacyStart: Math.round(noMarker.start.v), counted: ev && ev.counted, why: ev && ev.why, recs: fc.recs.map(r => r.grade) };
    });
    check('P4b ROB updated after the loading started (with or without the measured marker): not counted, stock stays 424, VLSFO reload still recommended', b.start === 424 && b.legacyStart === 424 && b.counted === false && /ROB was updated/.test(b.why) && b.recs.includes('VLSFO'), b);
    // (c) a forgotten record from 3 weeks ago
    const db3 = H.createDb({ workspace: seed({ loadings: [loading({ id: 'ld_old', qty: 4350, barge: 'FNSA 11', s: -21 * 24 - 11, e: -21 * 24 })] }), realtime: false });
    const C = await openT(db3, 'user-operator');
    const c = await C.page.evaluate(async () => { calculate(); await _waitForSaveIdle(); const fc = _bargeStockForecast(2, 7 * 24, {}); const ev = fc.events.find(e => e.kind === 'pending-loading'); return { start: Math.round(fc.start.v), counted: ev && ev.counted, why: ev && ev.why, recs: fc.recs.map(r => r.grade) }; });
    check('P4c a loading that ended 3 weeks ago: flagged but not counted, VLSFO reload still recommended', c.start === 424 && c.counted === false && /over 2 days ago/.test(c.why) && c.recs.includes('VLSFO'), c);
  });

  /* P5 — a loading that ended before an overdue job is added before that job's deduction */
  await scenario('P5 order against an overdue job', async (openT) => {
    const s5 = U.seedPayload({ vessels: [Object.assign({}, VBASE, { nomUid: 'n1', name: 'ERA S', type: 'VLSFO', qty: 1000, mgo: 0, eta: fmtDT(hrs(-6)), bargeId: '2' })] });
    s5.state.barges = [Object.assign({ id: 1, name: 'FNSA 10', vrob: 3229, mrob: 260 }, BARGE), Object.assign({ id: 2, name: 'FNSA 11', vrob: 424, mrob: 486 }, BARGE)];
    s5.state.loadingRecords = [loading({ id: 'ld_pending', qty: 4350, barge: 'FNSA 11', s: -30, e: -20 })];
    const db = H.createDb({ workspace: s5, realtime: false });
    const A = await openT(db, 'user-operator');
    const f = await A.page.evaluate(async () => { calculate(); await _waitForSaveIdle(); const fc = _bargeStockForecast(2, 7 * 24, {}); return { kinds: fc.events.map(e => e.kind), v: fc.events.map(e => Math.round(e.v)), start: Math.round(fc.start.v) }; });
    check('P5 loading (ended −20 h) before the overdue job (−6 h): 424 + 4,350 − 1,000 = 3,774 (not 0 + 4,350)', f.start === 3774 && JSON.stringify(f.kinds.slice(0, 3)) === JSON.stringify(['now', 'pending-loading', 'overdue']) && f.v[1] === 4774 && f.v[2] === 3774, f);
  });

  /* P6 — the flag is visible on the Barge Fleet card; Mark Completed twice does not re-save */
  await scenario('P6 card notice and guard', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db, 'user-operator');
    await A.page.evaluate(async () => { calculate(); await _waitForSaveIdle(); showPage('bargefleet'); renderReloadPlanner('reload-planner-body'); });
    const vis = await A.page.evaluate(() => {
      const card = document.querySelector('.rl-card[data-barge-id="2"]'); const note = card && card.querySelector('.rl-recs .rl-pending-note'); const btn = note && note.querySelector('.rl-done-btn');
      const r = btn && btn.getBoundingClientRect();
      return { note: note && note.textContent.replace(/\s+/g, ' ').trim(), btnShown: !!(r && r.width > 0 && r.height > 0), detailsOpen: !!(card && card.querySelector('details.rl-events[open]')) };
    });
    check('P6 the "not marked Completed" notice with its Mark Completed button is visible on the card without expanding Projected events', /ended .* but is not marked Completed: \+4,350 MT VLSFO is counted/.test(vis.note || '') && vis.btnShown, vis);
    const g = await A.page.evaluate(async () => {
      window.__toasts = []; rlCompleteLoading('ld_pending'); blConfirm(); await _waitForSaveIdle();
      const rec = _loadingRecords.find(r => r.id === 'ld_pending'); const at = rec.completedAt, up = rec.updatedAt;
      await new Promise(r => setTimeout(r, 20));
      rlCompleteLoading('ld_pending'); await _waitForSaveIdle();
      return { toasts: window.__toasts, same: rec.completedAt === at && rec.updatedAt === up, note: !!document.querySelector('.rl-card[data-barge-id="2"] .rl-pending-note') };
    });
    check('P6 a second Mark Completed does not re-save or re-toast the success; the notice is gone', g.same && g.toasts.filter(t => /marked Completed \(BL .*Now record/.test(t)).length === g.toasts.filter(t => /already marked Completed/.test(t)).length && g.toasts.some(t => /already marked Completed/.test(t)) && !g.note, g);
  });

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
