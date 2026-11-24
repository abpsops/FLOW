/* Completed loadings cannot be removed; removed loadings can be restored.
   (24 Nov 2026: ten completed November loadings were removed one by one with × and the deals
   showed 0 lifted.)
   • a completed loading has no × Remove (BL and Undo stay); removing one anyway is refused
   • a removed loading is listed under "Removed loadings" on the Loading page with ↩ Restore;
     Restore brings it back exactly as it was (deal lifted again), saved for every device
   • a trader sees the list without Restore
   node suites/fix2/loading-restore.test.js [appDir] */
const path = require('path');
if (process.argv[2]) process.env.APP_DIR = path.resolve(process.argv[2]);
const H = require(path.join(__dirname, '..', '..', 'harness', 'harness.js'));
const U = require(path.join(__dirname, '..', 'r3', 'util.js'));

let pass = 0, fail = 0;
function check(name, cond, info) {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 900)));
}
const NOW = Date.now(), HR = 3600000;
const iso = h => new Date(NOW + h * HR).toISOString();
const DEAL = { id: 'deal_1', supplier: 'ARAMCO', terminal: 'VOPAK TERMINAL', grade: 'VLSFO', qty: 45000, date: '2026-11-01', ref: 'GUL26', notes: '', status: 'open', createdAt: 1, updatedAt: 1 };
const LD = (id, h, extra) => Object.assign({ id, barge: 'Barge 1', terminal: 'VOPAK TERMINAL', grade: 'VLSFO', qty: 5000, startAt: iso(h), endAt: iso(h + 12), preOpsHours: 2.5, postOpsHours: 3.5, pumpHours: 6, estimatedHours: 12, endOverridden: false, surveyor: '', notes: '', dealId: 'deal_1', updatedAt: NOW }, extra || {});
const seed = () => { const s = U.seedPayload({}); s.state.loadingDeals = [DEAL]; s.state.loadingRecords = [
  LD('done1', -100, { completed: true, completedAt: NOW - 80 * HR, blQty: 4829.408, blDate: '2026-11-23', blAt: NOW - 80 * HR }),
  LD('sched1', 50),
  LD('gone1', -200, { completed: true, completedAt: NOW - 190 * HR, blQty: 4425.76, blDate: '2026-11-17', blAt: NOW - 190 * HR, deletedAt: NOW - 2 * HR, updatedAt: NOW - 2 * HR }),
]; return s; };

(async () => {
  const browser = await H.launch();
  const scenario = async (name, fn) => {
    if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return;
    console.log('— ' + name);
    const apps = [];
    try { await fn(async (db, uid) => { const a = await U.open(browser, db, uid || 'user-operator'); await U.helpers(a); await a.page.evaluate(() => { window.__alerts = []; window.__confirms = []; window.alert = m => window.__alerts.push(String(m)); window.confirm = m => { window.__confirms.push(String(m)); return true; }; try { flowWelcomeGo('loading'); } catch (e) {} showPage('loading'); renderLoadingList(); }); apps.push(a); return a; }); }
    catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
    const errs = [].concat(...apps.map(a => U.realErrors(a)));
    check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
    for (const a of apps) await a.ctx.close();
  };
  const cloud = db => (U.row(db).payload.state.loadingRecords || []);

  await scenario('L1 completed loadings stay', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db);
    const r = await A.page.evaluate(async () => {
      const rows = [...document.querySelectorAll('#loading-list .card')];
      const btns = row => [...row.querySelectorAll('button')].map(b => b.getAttribute('onclick') || '');
      const done = rows.find(x => btns(x).some(o => /done1/.test(o))), sched = rows.find(x => btns(x).some(o => /sched1/.test(o)));
      const doneRemove = btns(done).some(o => /deleteLoadingRecord/.test(o)), schedRemove = btns(sched).some(o => /deleteLoadingRecord/.test(o));
      deleteLoadingRecord('done1'); await _waitForSaveIdle();
      return { doneRemove, schedRemove, doneUndo: btns(done).some(o => /undoLoadingRecordDone/.test(o)), still: !_loadingRecords.find(x => x.id === 'done1').deletedAt, alerts: window.__alerts.slice(), confirms: window.__confirms.length };
    });
    check('L1 a completed loading has no × Remove (Undo stays); a scheduled one keeps it', !r.doneRemove && r.doneUndo && r.schedRemove, r);
    check('L1 removing a completed loading anyway is refused, with the reason', r.still && r.alerts.length === 1 && /completed/.test(r.alerts[0]) && /Undo/.test(r.alerts[0]) && r.confirms === 0, r);
  });

  await scenario('L2 removed loadings and restore', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db);
    const before = await A.page.evaluate(() => ({ list: [...document.querySelectorAll('#ld-removed .ld-removed-row')].map(r => r.textContent.replace(/\s+/g, ' ')), sum: (document.getElementById('ld-removed').querySelector('summary') || {}).textContent || '' }));
    check('L2 "Removed loadings (1)" lists the removed one (grade, qty, deal, Done with its BL) with ↩ Restore', /Removed loadings \(1\)/.test(before.sum) && before.list.length === 1 && /VLSFO 5,000 MT/.test(before.list[0]) && /ARAMCO/.test(before.list[0]) && /BL 4,425\.76 MT/.test(before.list[0]) && /Restore/.test(before.list[0]), before);
    const r = await A.page.evaluate(async () => {
      document.querySelector('#ld-removed .ld-removed-row button').click(); await _waitForSaveIdle();
      return { back: !_loadingRecords.find(x => x.id === 'gone1').deletedAt, list: document.querySelectorAll('#ld-removed .ld-removed-row').length };
    });
    const c = cloud(db).find(x => x.id === 'gone1');
    check('L2 Restore brings it back exactly as it was and saves it (no deletedAt, BL kept)', r.back && r.list === 0 && c && !('deletedAt' in c) && c.blQty === 4425.76 && c.completed === true && c.dealId === 'deal_1', { r, c });
    // a scheduled loading removed → listed → restorable
    await A.page.evaluate(async () => { deleteLoadingRecord('sched1'); await _waitForSaveIdle(); });
    const s = await A.page.evaluate(() => ({ confirm: window.__confirms.pop(), list: [...document.querySelectorAll('#ld-removed .ld-removed-row')].length }));
    check('L2 removing a scheduled loading says where it goes, and it is listed there', /Removed loadings/.test(s.confirm) && s.list === 1, s);
    const B = await openT(db, 'user-operator2');
    const b = await B.page.evaluate(() => ({ gone1: !!(_loadingRecords.find(x => x.id === 'gone1') && !_loadingRecords.find(x => x.id === 'gone1').deletedAt) }));
    check('L2 the restore reaches another device', b.gone1, b);
  });

  await scenario('L3 trader', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const T = await openT(db, 'user-trader');
    const t = await T.page.evaluate(() => ({ rows: document.querySelectorAll('#ld-removed .ld-removed-row').length, btns: document.querySelectorAll('#ld-removed button').length }));
    check('L3 a trader sees removed loadings without Restore', t.rows === 1 && t.btns === 0, t);
  });

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
