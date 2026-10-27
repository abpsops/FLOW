/* Checklist completion: Save is the one step that completes a supply, and it
   happens once per nomination.
   • A1 reload: a logged supply is not offered as Pending again although the saved
     schedule still lists it (nor when its card comes back and the schedule is
     regenerated); a stale Pending row of it is dropped; Save on such a row is
     refused with a message — one record, BDN kept, ROB deducted once; a double
     click on Save saves once, with no alert
   • A2 two devices (realtime): Save on a row a colleague already saved says so
     (no silent no-op) and the row doesn't come back when the Checklist reopens
   • A3 a colleague's unsaved edit to the row, merged after the supply was saved,
     doesn't bring it back as Pending on either device
   • B1 the same row saved on two devices before they sync: ONE record, report
     line, Delivery Log entry and ROB deduction on both devices and in the cloud
   • B2 …with different quantities (one or both devices baked it), and with one
     device offline: still one record, and ROB on every device is opening − that record
   • B3 older records keep their ids; a Pending saved record of the row is still
     replaced; re-saving after a delete gets a fresh id
   • C1 an open row has no 'Completed' tick; a row marked supplied without Save
     (older builds) is still Pending everywhere — timeline, alerts, typed actuals —
     on both devices; Save completes it
   node suites/fix2/checklist.test.js [appDir] */
const path = require('path');
if (process.argv[2]) process.env.APP_DIR = path.resolve(process.argv[2]);
const U = require('../r3/util.js');
const H = U.H;

let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) pass++; else fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 700)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const eta = h => { const d = new Date(Date.now() + h * 3600000); const p = n => String(n).padStart(2, '0'); return `${p(d.getDate())} ${MO[d.getMonth()]} ${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const VB = { imo: '', area: 'FUJ-A', spec: 'ISO 8217:2010', agent: 'AG', manifold: 'VESSEL MANIFOLD', remarks: '', lc: '', paq: 'no', bargeId: '1', refuelChk: false, rfv: 0, rfm: 0, rfvr: 750, rfmr: 275 };
const ALPHA = qty => Object.assign({}, VB, { nomUid: 'n1', name: 'ALPHA', type: 'VLSFO', qty: qty || 100, mgo: 0, eta: eta(3) });
const BRAVO = Object.assign({}, VB, { nomUid: 'n2', name: 'BRAVO', type: 'VLSFO', qty: 50, mgo: 0, eta: eta(10) });
const seed = (vessels, extra) => { const s = U.seedPayload(Object.assign({ vessels: vessels || [ALPHA(), BRAVO] }, extra || {})); s.state.bakedSupplyIds = {}; return s; };

const PAGE = () => {
  window.__dialogs = [];
  window.alert = m => { window.__dialogs.push('alert:' + m); };
  window.confirm = m => { window.__dialogs.push('confirm:' + m); return true; };
  try { flowWelcomeGo('dashboard'); } catch (e) {}
  window.__rob = () => { _bargeConfig = getBarges(); const l = getAllLiveROBs()[1]; return l ? Math.round(l.liveV) : null; };
  window.__fill = (uid, v, bdn) => {
    document.getElementById('cl-av-' + uid).value = String(v);
    if (bdn != null) document.getElementById('cl-bv-' + uid).value = bdn;
  };
  window.__rows = () => [...document.querySelectorAll('#checklist-rows tr[id^="cl-row-"]')].map(r => r.id.replace('cl-row-', '') + (r.querySelector('button.btn-success') ? ':open' : ':done'));
  window.__recs = nu => _savedSupplies.filter(r => r.nomUid === nu).map(r => ({ id: r.id, v: r.vlsfoAct, bdn: r.bdnV, supplied: r.supplied }));
  window.__dl = vessel => { let n = 0; Object.values(_deliveryLog || {}).forEach(m => ['timely', 'delayed'].forEach(b => _dlLive(m[b]).forEach(e => { if (e.vessel === vessel) n++; }))); return n; };
  window.__report = vessel => {
    const r = _savedSupplies.find(x => x.vessel === vessel); if (!r) return [];
    const d = _parseDateLocal(r.supplyDate);
    return getMonthlyRows(d.getMonth(), d.getFullYear()).filter(x => x.name === vessel).map(x => x.vQ);
  };
  window.__item = nu => (_lastSched || []).find(i => i.nomUid === nu);
  window.__jobs = nu => { _bargeConfig = getBarges(); return _getBargeTimeline(1, 'Barge 1').filter(j => j.nomUid === nu).length; };
};
async function open(browser, db, uid) {
  const app = await U.open(browser, db, uid);
  await app.page.evaluate(PAGE);
  return app;
}
const idle = X => X.page.evaluate(() => _waitForSaveIdle());
const poll = async X => { await X.page.evaluate(() => _pollOnce(true)); await sleep(150); };
const cloud = db => U.row(db).payload;
const cloudDl = (db, vessel) => { let n = 0; Object.values(cloud(db).state.deliveryLog || {}).forEach(m => ['timely', 'delayed'].forEach(b => (m[b] || []).forEach(e => { if (e && !e.deleted && e.vessel === vessel) n++; }))); return n; };
const saveRow = (X, uid, v, bdn) => X.page.evaluate(async ([uid, v, bdn]) => { showPage('checklist'); __fill(uid, v, bdn); await saveChecklistRecord(uid); await _waitForSaveIdle(); }, [uid, v, bdn]);

async function scenario(browser, name, fn, expectedErr) {
  const apps = [];
  try { await fn(async (db, uid) => { const a = await open(browser, db, uid || 'user-operator'); apps.push(a); return a; }); }
  catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
  const errs = [].concat(...apps.map(a => U.realErrors(a))).filter(e => !(expectedErr && expectedErr.test(e)));
  check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
  for (const a of apps) await a.ctx.close();
}

(async () => {
  const browser = await H.launch();

  /* A1 — one device: log ALPHA, reload */
  await scenario(browser, 'A1 reload', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db);
    await A.page.evaluate(async () => { calculate(); await _waitForSaveIdle(); showPage('checklist'); __fill('n_n1', 100, 'BDN-1'); document.querySelector('#cl-row-n_n1 button.btn-success').click(); });
    await sleep(300); await idle(A);
    const s1 = await A.page.evaluate(() => ({ rob: __rob(), recs: __recs('n1'), rows: __rows() }));
    check('A1 setup: ALPHA logged with the Save button (ROB 4000 → 3900, one record)', s1.rob === 3900 && s1.recs.length === 1 && s1.recs[0].bdn === 'BDN-1', s1);

    await A.page.reload({ waitUntil: 'load' }); await sleep(2500); await A.page.evaluate(PAGE);
    const s2 = await A.page.evaluate(() => { showPage('checklist'); return { sched: _lastSched.map(i => i.nomUid), rows: __rows(), open: Object.values(_checklistRecords).filter(r => r.nomUid === 'n1').length, rob: __rob() }; });
    check('A1 after a reload the saved schedule still lists ALPHA, but the Checklist does not offer it as Pending again (BRAVO still is)',
      s2.sched.includes('n1') && !s2.rows.some(r => /^n_n1/.test(r)) && s2.rows.includes('n_n2:open') && s2.open === 0 && s2.rob === 3900, s2);

    // a Pending row of the logged supply already in the data (synced by an older build / a merge)
    const s3 = await A.page.evaluate(() => {
      const r = _savedSupplies.find(x => x.nomUid === 'n1');
      window.__ghost = () => ({ uid: 'n_n1', nomUid: 'n1', sno: 1, vessel: 'ALPHA', area: 'FUJ-A', nomV: 100, nomM: null, actV: '', actM: '', bdnV: '', bdnM: '', supplied: false, notes: '', bargeLabel: 'Barge 1', supplyDate: r.supplyDate, state: 'draft', lockedAt: null });
      _checklistRecords.n_n1 = __ghost();
      renderChecklist(_lastSched);
      return { rows: __rows(), kept: !!_checklistRecords.n_n1 };
    });
    check('A1 a Pending row of an already logged supply is dropped when the Checklist renders', !s3.rows.some(r => /^n_n1/.test(r)) && !s3.kept, s3);

    // …and Save on such a row (still on screen) is refused
    const s4 = await A.page.evaluate(async () => {
      window.__dialogs = [];
      _checklistRecords.n_n1 = Object.assign(__ghost(), { actV: '100' });
      await saveChecklistRecord('n_n1'); await _waitForSaveIdle();
      return { dialogs: __dialogs.slice(), recs: __recs('n1'), rob: __rob(), row: !!_checklistRecords.n_n1, dl: __dl('ALPHA') };
    });
    check('A1 Save on a stale Pending row of a logged supply is refused with a message saying it is already saved', s4.dialogs.length === 1 && /already been saved/.test(s4.dialogs[0]), s4.dialogs);
    const c = cloud(db);
    check('A1 …and nothing changes: one record with its BDN, ROB 3900 (deducted once), one Delivery Log entry, the row is gone',
      s4.recs.length === 1 && s4.recs[0].bdn === 'BDN-1' && s4.recs[0].id === s1.recs[0].id && s4.rob === 3900 && s4.dl === 1 && !s4.row, s4);
    check('A1 …in the cloud too: one ALPHA record (BDN-1), opening ROB 3900', c.records.filter(r => r.nomUid === 'n1').length === 1 && c.records.find(r => r.nomUid === 'n1').bdnV === 'BDN-1' && c.state.barges[0].vrob === 3900,
      { recs: c.records.map(r => [r.id, r.vlsfoAct, r.bdnV]), vrob: c.state.barges[0].vrob });

    // ALPHA's card comes back (a colleague's edit merged after the supply was logged) and the schedule is regenerated
    const s5 = await A.page.evaluate(async ([v]) => { addVessel(v); calculate(); await _waitForSaveIdle(); showPage('checklist'); return { sched: _lastSched.map(i => i.nomUid), rows: __rows() }; }, [ALPHA()]);
    check('A1 a regenerated schedule that plans the logged nomination again does not create a Pending row for it', s5.sched.includes('n1') && !s5.rows.some(r => /^n_n1/.test(r)), s5);

    // double click on BRAVO's Save: one record, no 'This record is locked.'
    const s6 = await A.page.evaluate(async () => {
      window.__dialogs = []; showPage('checklist'); __fill('n_n2', 50, 'BDN-2');
      const btn = document.querySelector('#cl-row-n_n2 button.btn-success'); btn.click(); btn.click();
      await new Promise(r => setTimeout(r, 300)); await _waitForSaveIdle();
      return { dialogs: __dialogs.slice(), recs: __recs('n2').length };
    });
    check('A1 a double click on Save saves once, without a "This record is locked." alert', s6.recs === 1 && s6.dialogs.length === 0, s6);
  });

  /* A2 — two devices, realtime: B has the row on screen while A logs it */
  await scenario(browser, 'A2 stale row', async (openT) => {
    const db = H.createDb({ workspace: seed() });
    const A = await openT(db, 'user-operator');
    const B = await openT(db, 'user-operator2');
    await A.page.evaluate(async () => { calculate(); await _waitForSaveIdle(); });
    await sleep(1200);
    await B.page.evaluate(() => { showPage('checklist'); __fill('n_n1', 98, 'BDN-B'); });
    await saveRow(A, 'n_n1', 100, 'BDN-A');
    await sleep(1500); // realtime → B pulls A's save
    const pre = await B.page.evaluate(() => ({ onScreen: !!document.querySelector('#cl-row-n_n1 button.btn-success'), inMemory: !!_checklistRecords.n_n1, recs: __recs('n1') }));
    check('A2 setup: B pulled A\'s save while its Checklist still shows the ALPHA row', pre.onScreen && !pre.inMemory && pre.recs.length === 1, pre);
    await B.page.evaluate(() => { window.__dialogs = []; document.querySelector('#cl-row-n_n1 button.btn-success').click(); });
    await sleep(300); await idle(B);
    const s = await B.page.evaluate(() => ({ dialogs: __dialogs.slice(), rows: __rows(), recs: __recs('n1'), rob: __rob() }));
    check('A2 B\'s Save on that row says it is no longer open (not a silent no-op) and refreshes the Checklist', s.dialogs.length === 1 && /no longer open/.test(s.dialogs[0]) && !s.rows.some(r => /^n_n1/.test(r)) && s.rows.includes('n_n2:open'), s);
    await B.page.evaluate(() => { showPage('dashboard'); showPage('checklist'); });
    const again = await B.page.evaluate(() => ({ rows: __rows(), recs: __recs('n1'), rob: __rob() }));
    check('A2 reopening the Checklist on B does not bring ALPHA back; one record, ROB 3900 on B', !again.rows.some(r => /^n_n1/.test(r)) && again.recs.length === 1 && again.rob === 3900, again);
  });

  /* A3 — B typed into ALPHA's row (unsaved) while A logged it; B's next save merges */
  await scenario(browser, 'A3 merged edit', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db, 'user-operator');
    const B = await openT(db, 'user-operator2');
    await A.page.evaluate(async () => { calculate(); await _waitForSaveIdle(); });
    await poll(B);
    await B.page.evaluate(() => { showPage('checklist'); clUpdateNotes('n_n1', 'waiting for BDN'); });
    await saveRow(A, 'n_n1', 100, 'BDN-A');
    await B.page.evaluate(async () => { await saveSharedState(); await _waitForSaveIdle(); });
    await poll(A); await poll(B);
    const view = X => X.page.evaluate(() => { showPage('dashboard'); showPage('checklist'); return { rows: __rows(), recs: __recs('n1'), rob: __rob() }; });
    const a = await view(A), b = await view(B);
    check('A3 after the merge neither device shows ALPHA as Pending again; one record, ROB 3900 on both',
      [a, b].every(x => !x.rows.some(r => /^n_n1/.test(r)) && x.recs.length === 1 && x.rob === 3900), { a, b });
  });

  /* B1 — A and B both save the same 1000 MT row before syncing */
  await scenario(browser, 'B1 same row twice', async (openT) => {
    const db = H.createDb({ workspace: seed([ALPHA(1000)]), realtime: false });
    const A = await openT(db, 'user-operator');
    const B = await openT(db, 'user-operator2');
    await A.page.evaluate(async () => { calculate(); await _waitForSaveIdle(); });
    await poll(B);
    await saveRow(A, 'n_n1', 1000, 'BDN-7');
    await saveRow(B, 'n_n1', 1000, 'BDN-7'); // B hasn't pulled A's save
    for (let k = 0; k < 2; k++) { await poll(A); await poll(B); }
    const snap = X => X.page.evaluate(() => ({ recs: __recs('n1'), rob: __rob(), report: __report('ALPHA'), dl: __dl('ALPHA') }));
    const a = await snap(A), b = await snap(B), c = cloud(db);
    const ok = x => x.recs.length === 1 && x.rob === 3000 && JSON.stringify(x.report) === '[1000]' && x.dl === 1;
    check('B1 A: one ALPHA record, report 1000 MT, one Delivery Log entry, ROB 4000 → 3000', ok(a), a);
    check('B1 B: the same', ok(b) && b.recs[0].id === a.recs[0].id, b);
    check('B1 cloud: one ALPHA record and one Delivery Log entry', c.records.filter(r => r.nomUid === 'n1').length === 1 && cloudDl(db, 'ALPHA') === 1, c.records.map(r => [r.id, r.vlsfoAct]));
    // a reload of either device computes the same ROB from the cloud's baked opening
    await B.page.reload({ waitUntil: 'load' }); await sleep(2500); await B.page.evaluate(PAGE);
    const br = await snap(B);
    check('B1 after a reload B still shows ROB 3000 and one record', br.rob === 3000 && br.recs.length === 1, br);
  });

  /* B2 — different quantities: B stale (its ROB engine not loaded yet, so its save bakes nothing),
     B stale after viewing ROB (both devices bake the same id), B offline while A saves */
  for (const variant of ['stale', 'both baked', 'offline']) {
    await scenario(browser, 'B2 ' + variant, async (openT) => {
      const db = H.createDb({ workspace: seed(), realtime: false });
      const A = await openT(db, 'user-operator');
      const B = await openT(db, 'user-operator2');
      await A.page.evaluate(async () => { calculate(); await _waitForSaveIdle(); });
      await poll(B);
      if (variant === 'both baked') await B.page.evaluate(() => renderLiveROBDashboard());
      if (variant === 'offline') db.intercept = op => (op.uid === 'user-operator2' && op.table === 'abps_workspace') ? { data: null, error: { message: 'Failed to fetch' } } : null;
      await saveRow(A, 'n_n1', 100, 'BDN-A');
      await saveRow(B, 'n_n1', 98, 'BDN-B');
      db.intercept = null;
      for (let k = 0; k < 3; k++) { await poll(B); await idle(B); await poll(A); }
      const snap = X => X.page.evaluate(() => ({ recs: __recs('n1'), rob: __rob(), report: __report('ALPHA'), dl: __dl('ALPHA') }));
      const a = await snap(A), b = await snap(B), c = cloud(db);
      const cr = c.records.filter(r => r.nomUid === 'n1');
      const kept = cr.length === 1 ? cr[0].vlsfoAct : null;
      check(`B2 ${variant}: one ALPHA record everywhere (both devices and the cloud), the same one`, cr.length === 1 && a.recs.length === 1 && b.recs.length === 1 && a.recs[0].v === kept && b.recs[0].v === kept && (kept === 100 || kept === 98), { a: a.recs, b: b.recs, cloud: cr.map(r => [r.id, r.vlsfoAct]) });
      check(`B2 ${variant}: ROB on both devices = 4000 − that one record (deducted once); report and Delivery Log count it once`,
        a.rob === 4000 - kept && b.rob === 4000 - kept && JSON.stringify(a.report) === JSON.stringify([kept]) && a.dl === 1 && b.dl === 1 && cloudDl(db, 'ALPHA') === 1, { a, b, kept });
    }, variant === 'offline' ? /saveSharedState failed: Error: Supabase save failed: Failed to fetch/ : null); // the offline save is logged
  }

  /* B3 — ids: older records, a Pending saved record, re-save after delete */
  await scenario(browser, 'B3 ids', async (openT) => {
    const old = { id: 'v_zulu_1700000000000', checklistUid: 'v_zulu', vessel: 'ZULU', areaCode: 'FUJ-A', area: 'FUJ-A', dateStr: 'x', supplyDate: new Date(Date.now() - 2 * 86400000).toISOString(), vlsfoAct: 300, mgoAct: 0, barge: 'Barge 1', supplied: true, savedAt: new Date(Date.now() - 2 * 86400000).toISOString() };
    const pending = { id: 'n_n2_1700000000001', checklistUid: 'n_n2', nomUid: 'n2', vessel: 'BRAVO', areaCode: 'FUJ-A', area: 'FUJ-A', dateStr: 'x', supplyDate: new Date().toISOString(), vlsfoNom: 50, vlsfoAct: 0, mgoAct: 0, barge: 'Barge 1', supplied: false, savedAt: new Date().toISOString() };
    const s = seed(); s.records = [old, pending]; s.state.bakedSupplyIds = { 1: ['v_zulu_1700000000000'] };
    const db = H.createDb({ workspace: s, realtime: false });
    const A = await openT(db);
    await A.page.evaluate(async () => { calculate(); await _waitForSaveIdle(); });
    await saveRow(A, 'n_n2', 49, 'BDN-2');
    const r1 = await A.page.evaluate(() => ({ bravo: __recs('n2'), zulu: _savedSupplies.filter(r => r.vessel === 'ZULU').map(r => r.id) }));
    check('B3 saving a row replaces its Pending saved record (one BRAVO record, supplied, 49 MT)', r1.bravo.length === 1 && r1.bravo[0].supplied === true && r1.bravo[0].v === 49, r1);
    check('B3 an older record keeps its id', JSON.stringify(r1.zulu) === JSON.stringify(['v_zulu_1700000000000']) && cloud(db).records.some(r => r.id === 'v_zulu_1700000000000'), r1.zulu);
    await saveRow(A, 'n_n1', 100, 'BDN-1');
    const id1 = await A.page.evaluate(() => __recs('n1')[0].id);
    await A.page.evaluate(async id => { await deleteRecord(id); await _waitForSaveIdle(); }, id1);
    const reopened = await A.page.evaluate(() => { showPage('dashboard'); showPage('checklist'); return { rows: __rows(), recs: __recs('n1') }; });
    check('B3 deleting the record reopens its row', reopened.rows.includes('n_n1:open') && reopened.recs.length === 0, reopened);
    await saveRow(A, 'n_n1', 100, 'BDN-1');
    const r2 = await A.page.evaluate(() => ({ recs: __recs('n1'), dialogs: __dialogs.filter(d => /already been saved/.test(d)) }));
    check('B3 the reopened row saves again, as a new record with a fresh id (the deleted one is already folded into the opening ROB)', r2.recs.length === 1 && r2.recs[0].id !== id1 && !r2.dialogs.length, { id1, r2 });
  });

  /* C1 — the unsaved 'Completed' tick */
  await scenario(browser, 'C1 unsaved tick', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db, 'user-operator');
    const B = await openT(db, 'user-operator2');
    await A.page.evaluate(async () => { calculate(); await _waitForSaveIdle(); });
    await poll(B);
    const ui = await A.page.evaluate(() => { showPage('checklist'); const row = document.getElementById('cl-row-n_n1'); return { tick: !!row.querySelector('input[type=checkbox]'), status: row.querySelector('td:nth-child(10)').textContent.trim(), save: !!row.querySelector('button.btn-success') }; });
    check('C1 an open row shows Pending and a Save button, with no "Completed" tick to mark it supplied unsaved', !ui.tick && ui.status === 'Pending' && ui.save, ui);
    const before = await A.page.evaluate(() => ({ jobs: __jobs('n1'), alerts: computeGlobalAlerts().map(a => a.key).sort() }));
    // what the tick did (and older builds still do): supplied, not saved
    const a = await A.page.evaluate(() => {
      _checklistRecords.n_n1.supplied = true;
      clUpdateActual('n_n1', 'v', '95');
      return { done: _isScheduleItemCompleted(__item('n1')), jobs: __jobs('n1'), alerts: computeGlobalAlerts().map(a => a.key).sort(), actV: _checklistRecords.n_n1.actV, rob: __rob() };
    });
    check('C1 setup: ALPHA is planned on Barge 1 before the tick', before.jobs === 1, before);
    check('C1 a row marked supplied but not saved is not completed: ALPHA stays in the barge timeline, alerts unchanged', !a.done && a.jobs === 1 && JSON.stringify(a.alerts) === JSON.stringify(before.alerts) && a.rob === 4000, { before, a });
    check('C1 …and its typed actual is still kept', a.actV === '95', a);
    await A.page.evaluate(async () => { await saveSharedState(); await _waitForSaveIdle(); });
    await poll(B);
    const b = await B.page.evaluate(() => { showPage('checklist'); const row = document.getElementById('cl-row-n_n1'); return { supplied: _checklistRecords.n_n1 && _checklistRecords.n_n1.supplied, done: _isScheduleItemCompleted(__item('n1')), jobs: __jobs('n1'), save: !!(row && row.querySelector('button.btn-success')) }; });
    check('C1 on the other device (synced): still Pending — planned, not completed, Save offered', b.supplied === true && !b.done && b.jobs === 1 && b.save, b);
    await saveRow(A, 'n_n1', 95, 'BDN-1');
    const c = await A.page.evaluate(() => ({ done: _isScheduleItemCompleted(__item('n1')), jobs: __jobs('n1'), rob: __rob(), rows: __rows() }));
    check('C1 Save completes it: no longer planned, ROB 4000 → 3905', c.done && c.jobs === 0 && c.rob === 3905 && c.rows.includes('n_n1:done'), c);
  });

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
