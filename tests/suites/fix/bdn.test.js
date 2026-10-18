/* Saved Supply Records → Edit: the BDN numbers (VLSFO / LSMGO) can be changed.
   node bdn.test.js [appDir]   ($SHOTS_DIR=… saves screenshots) */
const fs = require('fs');
const path = require('path');
const H = require(path.join(__dirname, '..', '..', 'harness', 'harness.js'));
const U = require(path.join(__dirname, '..', 'r3', 'util.js'));
const appDir = process.argv[2] || H.APP_DIR;
const SHOTS = process.env.SHOTS_DIR || '';

let pass = 0, fail = 0;
function check(name, cond, info) {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 700)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const REC = { id: 'cl1_1700000000000', checklistUid: 'cl1', nomUid: 'n1', savedAt: '2026-10-07T09:20:58.000Z', vessel: 'CMA CGM VITORIA', area: 'FUJ A', areaCode: 'FUJ-A', dateStr: '07 Oct 2026  05:57', supplyDate: '2026-10-07T01:57:00.000Z', vlsfoNom: 700, mgoNom: 0, vlsfoAct: 697.614, mgoAct: 0, bdnV: 'BDN-1001', bdnM: '', barge: 'FNSA 10', notes: 'None', supplied: true };
const REC2 = { id: 'cl2_1700000000001', checklistUid: 'cl2', savedAt: '2026-10-09T13:56:14.000Z', vessel: 'MT DAISY', dateStr: '—', supplyDate: '2026-10-09T08:00:00.000Z', vlsfoNom: 0, mgoNom: 450, vlsfoAct: 0, mgoAct: 449.416, barge: 'FNSA 10', notes: 'None', supplied: true };
const CL = { uid: 'cl1', nomUid: 'n1', vessel: 'CMA CGM VITORIA', state: 'completed', lockedAt: '2026-10-07T09:20:58.000Z', supplied: true, nomV: 700, nomM: null, actV: 697.614, actM: 0, bdnV: 'BDN-1001', bdnM: '' };

(async () => {
  const browser = await H.launch();
  const seed = U.seedPayload({ vessels: [] });
  seed.records = [REC, REC2];
  seed.checklistRecords = { cl1: CL };
  seed.state.checklistRecords = { cl1: CL };
  const db = H.createDb({ workspace: seed, realtime: false });
  const app = await U.open(browser, db, 'user-operator');
  const page = app.page;
  try {
    await page.evaluate(() => { try { flowWelcomeGo('records'); } catch (e) {} showPage('records'); });
    await sleep(300);
    const list = await page.evaluate(() => [...document.querySelectorAll('.saved-record-row')].map(r => ({ v: r.querySelector('.saved-record-vessel').textContent.trim(), bdn: (r.querySelector('.saved-record-bdn') || {}).textContent || '' })));
    check('list shows the BDN numbers of a record that has them, nothing for one without', /BDN No\.: VLSFO BDN-1001/.test(list.find(x => /VITORIA/.test(x.v)).bdn) && list.find(x => /DAISY/.test(x.v)).bdn === '', list);

    await page.evaluate(() => openEditRecord('cl1_1700000000000'));
    await sleep(150);
    const f0 = await page.evaluate(() => ({ v: document.getElementById('er-bdn-v').value, m: document.getElementById('er-bdn-m').value, open: document.getElementById('edit-record-modal').style.display, sub: document.querySelector('#edit-record-modal').textContent.includes('Modify actuals, BDN numbers') }));
    check('Edit shows the BDN boxes filled with the saved numbers', f0.open === 'flex' && f0.v === 'BDN-1001' && f0.m === '' && f0.sub, f0);
    await page.evaluate(() => {
      const v = document.getElementById('er-bdn-v'), m = document.getElementById('er-bdn-m');
      v.value = '  BDN-1001-A '; v.dispatchEvent(new Event('input', { bubbles: true }));
      m.value = 'MGO/77'; m.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const diff = await page.evaluate(() => ({ shown: document.getElementById('er-diff').style.display, txt: document.getElementById('er-diff-rows').textContent }));
    check('Change Summary lists the BDN changes', diff.shown === 'block' && /BDN No\. \(VLSFO\): BDN-1001 → BDN-1001-A/.test(diff.txt) && /BDN No\. \(LSMGO\): — → MGO\/77/.test(diff.txt), diff);
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.locator('#edit-record-modal > div').screenshot({ path: path.join(SHOTS, 'bdn-edit.png') }); }
    const w0 = U.writes(db, 'user-operator').length;
    // completed checklist rows live only on the device that saved them (they are not synced): put one there
    await page.evaluate(cl => { _checklistRecords.cl1 = JSON.parse(JSON.stringify(cl)); }, CL);
    await page.evaluate(() => saveEditRecord());
    await sleep(600);
    const row = U.row(db), rec = row.payload.records.find(r => r.id === 'cl1_1700000000000');
    const cl = await page.evaluate(() => _checklistRecords.cl1 && { bdnV: _checklistRecords.cl1.bdnV, bdnM: _checklistRecords.cl1.bdnM });
    check('saved: the record carries the new BDN numbers (trimmed); other fields unchanged', U.writes(db, 'user-operator').length > w0 && rec.bdnV === 'BDN-1001-A' && rec.bdnM === 'MGO/77' && rec.vlsfoAct === 697.614 && rec.vessel === 'CMA CGM VITORIA' && rec.barge === 'FNSA 10', rec);
    check('…and the checklist row it was saved from (on this device) gets the same numbers — the checklist Excel export reads them there', cl && cl.bdnV === 'BDN-1001-A' && cl.bdnM === 'MGO/77', cl);
    const list2 = await page.evaluate(() => [...document.querySelectorAll('.saved-record-row')].map(r => (r.querySelector('.saved-record-bdn') || {}).textContent || ''));
    check('list shows the new numbers', list2.some(t => /VLSFO BDN-1001-A\s*\|\s*LSMGO MGO\/77/.test(t)), list2);
    const rep = await page.evaluate(() => { const r = _savedSupplies.find(x => x.id === 'cl1_1700000000000'); return [r.bdnV, r.bdnM]; });
    check('reports read the edited numbers (the saved record is their source)', rep[0] === 'BDN-1001-A' && rep[1] === 'MGO/77', rep);

    // a record without a checklist link; hostile text is shown as text
    await page.evaluate(() => openEditRecord('cl2_1700000000001'));
    await sleep(100);
    await page.evaluate(() => { const m = document.getElementById('er-bdn-m'); m.value = '<img src=x onerror="window.__pwn=1">'; m.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.evaluate(() => saveEditRecord());
    await sleep(500);
    const x = await page.evaluate(() => ({ pwn: window.__pwn || 0, imgs: document.querySelectorAll('#saved-records-list img, #er-diff-rows img').length, txt: [...document.querySelectorAll('.saved-record-bdn')].map(e => e.textContent).join(' ') }));
    check('a record without a checklist link saves too; HTML in a BDN number is shown as text', x.pwn === 0 && x.imgs === 0 && /LSMGO <img/.test(x.txt) && U.row(db).payload.records.find(r => r.id === 'cl2_1700000000001').bdnM === '<img src=x onerror="window.__pwn=1">', x);
    // clearing a BDN number
    await page.evaluate(() => openEditRecord('cl1_1700000000000'));
    await sleep(100);
    await page.evaluate(() => { const v = document.getElementById('er-bdn-v'); v.value = ''; v.dispatchEvent(new Event('input', { bubbles: true })); return saveEditRecord(); });
    await sleep(500);
    check('a BDN number can be cleared', U.row(db).payload.records.find(r => r.id === 'cl1_1700000000000').bdnV === '');
    const errs = U.realErrors(app);
    check('no page errors', errs.length === 0, errs.slice(0, 3));
  } catch (e) {
    check('threw', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | '));
  }
  await app.ctx.close();
  await browser.close();
  console.log('BDN: ' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
