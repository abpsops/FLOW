/* Stock forecast: a loading whose window has passed but that nobody marked Completed
   counts in the forecast (from now, capped at tank capacity) until it is marked Completed,
   and is flagged in Projected events with a "Mark Completed" button.
   • FNSA 11 at 424 MT with a 4,350 MT loading that ended last night, not completed:
     stock from now = 4,774, the "reload by" recommendation is gone, the event is listed
   • the Mark Completed button completes the loading: it drops out of the forecast (stock back
     to the ROB) with a toast saying to record the reload; the Loading page shows it completed
   • a loading already marked Completed, a deleted one, or another barge's: not counted
   • capped at tank capacity; a trader sees the line but no button
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
    await A.page.evaluate(async () => { renderReloadPlanner && 0; rlCompleteLoading('ld_pending'); await _waitForSaveIdle(); });
    const rec = U.row(db).payload.state.loadingRecords.find(r => r.id === 'ld_pending');
    const g = await forecast(A.page);
    check('P1 Mark Completed: the loading is Completed in the cloud, drops out of the forecast (stock back to 424 until the reload is recorded), the VLSFO reload is recommended again', rec && rec.completed === true && !!rec.completedAt && g.pending.length === 0 && g.firstV === null && g.recs.some(r => r[0] === 'VLSFO'), { rec: rec && [rec.completed, !!rec.completedAt], g });
    check('P1 …and the toast says to record the reload', (await A.page.evaluate(() => window.__toasts)).some(t => /marked Completed/.test(t) && /record the reload/.test(t) && /4,350 MT VLSFO/.test(t)), await A.page.evaluate(() => window.__toasts));
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

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
