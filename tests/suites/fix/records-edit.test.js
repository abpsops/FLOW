/* Editing a Saved Supply Record reaches every report: Monthly Report, the
   dashboard's Distributed chart, the Reports page — whatever FUJ / KFK button
   was last pressed in the Monthly Report, with an archived copy of the same
   delivery around, from another device, and with a colleague editing too.
   node records-edit.test.js [appDir] */
const path = require('path');
const H = require(path.join(__dirname, '..', '..', 'harness', 'harness.js'));
const U = require(path.join(__dirname, '..', 'r3', 'util.js'));
const appDir = process.argv[2] || H.APP_DIR;

let pass = 0, fail = 0;
function check(name, cond, info) {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 700)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clone = x => JSON.parse(JSON.stringify(x));
const AREA = { 'FUJ-A': 'FUJ A — Fujairah Anchorage', 'KFK-A': 'KFK A — Khor Fakkan Anchorage' };
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// This month, `day` days ago (at least the 1st), 10:00 local — a record as saveChecklistRecord builds it.
function thisMonth(daysAgo) { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), Math.max(1, n.getDate() - daysAgo), 10, 0).toISOString(); }
function rec(o) {
  return Object.assign({ id: o.uid + '_' + (o.ts || 1000), checklistUid: o.uid, nomUid: 'n_' + o.uid, savedAt: o.savedAt || '2026-10-01T00:00:00.000Z', vessel: o.vessel,
    area: AREA[o.areaCode || 'FUJ-A'], areaCode: o.areaCode || 'FUJ-A', dateStr: 'x', supplyDate: o.supplyDate || thisMonth(1),
    vlsfoNom: o.vNom || 0, mgoNom: o.mNom || 0, vlsfoAct: o.vAct || 0, mgoAct: o.mAct || 0, bdnV: '', bdnM: '', barge: 'Barge 1', notes: '', supplied: true }, o.extra || {});
}
async function open(browser, db, uid) {
  const app = await U.open(browser, db, uid || 'user-operator');
  await app.page.evaluate(() => { window.__dialogs = []; window.confirm = m => { window.__dialogs.push(String(m)); return true; }; window.alert = m => { window.__dialogs.push(String(m)); }; });
  return app;
}
const donut = p => p.evaluate(() => { const c = _chartInstances['fuel-dist-distributed']; return c ? c.data.datasets[0].data.slice() : null; });
const monthRows = p => p.evaluate(() => { const n = new Date(); return getMonthlyRows(n.getMonth(), n.getFullYear()).map(r => [r.name, r.vQ, r.mQ, r.fromArchive ? 'ARCH' : 'LIVE']); });
async function editRecord(p, id, fields) {
  await p.evaluate(([id, fields]) => {
    showPage('records'); openEditRecord(id);
    Object.keys(fields).forEach(k => { const el = document.getElementById(k); el.value = fields[k]; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  }, [id, fields]);
  await p.evaluate(() => saveEditRecord());
  await sleep(500);
}

(async () => {
  const browser = await H.launch();
  const all = [];
  const scenario = async (name, fn) => {
    console.log('— ' + name);
    const apps = [];
    try { await fn(async (db, uid) => { const a = await open(browser, db, uid); apps.push(a); return a; }); }
    catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
    const errs = [].concat(...apps.map(a => U.realErrors(a)));
    check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
    for (const a of apps) await a.ctx.close();
  };

  /* 1 — the Monthly Report's FUJ / KFK button stays in that window */
  await scenario('E1 port filter', async (openT) => {
    const seed = U.seedPayload({ vessels: [] });
    seed.records = [rec({ uid: 'a', vessel: 'ALPHA', vAct: 498.2, mAct: 50 }), rec({ uid: 'cp', vessel: 'CHILE PROSPERITY', areaCode: 'KFK-A', vAct: 799.4, mAct: 120 })];
    const db = H.createDb({ workspace: seed, realtime: false });
    const { page } = await openT(db);
    await page.evaluate(() => { try { flowWelcomeGo('dashboard'); } catch (e) {} openMonthlyReport(); setReportPort('FUJ'); });
    await sleep(200);
    const inWindow = await page.evaluate(() => document.getElementById('monthly-preview').textContent);
    await page.evaluate(() => closeMonthlyReport());
    check('FUJ Only filters the Monthly Report window (CHILE PROSPERITY at KFK not listed)', /ALPHA/.test(inWindow) && !/CHILE PROSPERITY/.test(inWindow), inWindow.slice(0, 200));
    await editRecord(page, 'cp_1000', { 'er-mgo-act': '150' });
    await page.evaluate(() => showPage('dashboard'));
    await sleep(500);
    const d = await donut(page);
    check('after closing the window: the Distributed chart counts every port, with the edited MGO (50 + 150)', d && d[0] === 1297.6 && d[1] === 200, d);
    await page.evaluate(() => showPage('reports'));
    await sleep(500);
    const rep = await page.evaluate(() => ({ kpi: document.getElementById('rep-total-lsmgo') && document.getElementById('rep-total-lsmgo').textContent, trend: _chartInstances['monthly-trend'] && _chartInstances['monthly-trend'].data.datasets[1].data }));
    check('…and the Reports page too', /200/.test(rep.kpi || '') && rep.trend && rep.trend[0] === 200, rep);
    check('getMonthlyRows without a port = every port (the Bunker Quantity charts use it)', JSON.stringify(await monthRows(page)) === JSON.stringify([['ALPHA', 498.2, 50, 'LIVE'], ['CHILE PROSPERITY', 799.4, 150, 'LIVE']]), await monthRows(page));
  });

  /* 2 — the list and the Edit dialog show the figure the reports count */
  await scenario('E2 actual vs nominated', async (openT) => {
    const seed = U.seedPayload({ vessels: [] });
    seed.records = [rec({ uid: 'cp', vessel: 'CHILE PROSPERITY', vNom: 500, mNom: 100, vAct: 498.5, mAct: 0 }), rec({ uid: 'lg', vessel: 'LEGACY', extra: { vlsfoAct: undefined, mgoAct: undefined, vlsfoActual: 300, mgoActual: 20 } })];
    const db = H.createDb({ workspace: seed, realtime: false });
    const { page } = await openT(db);
    await page.evaluate(() => { try { flowWelcomeGo('records'); } catch (e) {} showPage('records'); });
    await sleep(300);
    const row = await page.evaluate(() => [...document.querySelectorAll('.saved-record-row')].find(r => /CHILE/.test(r.textContent)).querySelector('.saved-record-meta').textContent.replace(/\s+/g, ' '));
    check('list: MGO 0 MT actual, "(nominated 100 MT — actual not entered)" — not the nominated figure as if supplied', /MGO: 0 MT \(nominated 100 MT — actual not entered\)/.test(row) && /VLSFO: 498.5 MT/.test(row), row);
    const dlg = await page.evaluate(() => { openEditRecord('cp_1000'); return { nomRO: document.getElementById('er-mgo-nom').readOnly, act: document.getElementById('er-mgo-act').value }; });
    check('Edit: Nom. boxes are read-only reference, Actual shows 0', dlg.nomRO && dlg.act === '0', dlg);
    await page.evaluate(() => closeEditRecord());
    const lg = await page.evaluate(() => { openEditRecord('lg_1000'); const o = { v: document.getElementById('er-vlsfo-act').value, m: document.getElementById('er-mgo-act').value }; closeEditRecord(); return o; });
    check('a legacy record (vlsfoActual / mgoActual) opens with its real actuals (not 0)', lg.v === '300' && lg.m === '20', lg);
    await editRecord(page, 'lg_1000', { 'er-notes': 'checked' });
    const lgSaved = U.row(db).payload.records.find(r => r.id === 'lg_1000');
    check('…and editing only its notes leaves its quantities alone', lgSaved.notes === 'checked' && lgSaved.vlsfoActual === 300 && lgSaved.mgoActual === 20 && lgSaved.vlsfoAct === undefined, lgSaved);
    await editRecord(page, 'cp_1000', { 'er-mgo-act': '99.2' });
    await page.evaluate(() => showPage('dashboard'));
    await sleep(400);
    check('entering the MGO actual reaches the Distributed chart and the Monthly Report', JSON.stringify(await donut(page)) === JSON.stringify([798.5, 119.2]) && (await monthRows(page)).some(r => r[0] === 'CHILE PROSPERITY' && r[2] === 99.2), [await donut(page), await monthRows(page)]);
  });

  /* 3 — an archived copy of the same delivery */
  await scenario('E3 archived copy', async (openT) => {
    const seed = U.seedPayload({ vessels: [] });
    const live = rec({ uid: 'cp', ts: 2000, vessel: 'CHILE PROSPERITY', vAct: 498.5, mAct: 99.2 });
    const arch = rec({ uid: 'cp', ts: 1000, vessel: 'CHILE PROSPERITY', vAct: 498.5, mAct: 99.2 });
    const n = new Date();
    seed.records = [live];
    seed.state.archives = { [n.getFullYear()]: { [MO[n.getMonth()]]: { records: [arch], archivedAt: '2026-10-01T00:00:00.000Z', month: n.getMonth(), year: n.getFullYear() } } };
    const db = H.createDb({ workspace: seed, realtime: false });
    const { page } = await openT(db);
    await page.evaluate(() => { try { flowWelcomeGo('dashboard'); } catch (e) {} });
    check('before the edit: one CHILE PROSPERITY row', (await monthRows(page)).length === 1, await monthRows(page));
    await editRecord(page, 'cp_2000', { 'er-mgo-act': '150.5' });
    await page.evaluate(() => showPage('dashboard'));
    await sleep(400);
    const rows = await monthRows(page);
    check('after editing the live copy: still one row, with the new MGO (the archived copy of the same checklist row is not counted)', rows.length === 1 && rows[0][2] === 150.5 && rows[0][3] === 'LIVE' && JSON.stringify(await donut(page)) === JSON.stringify([498.5, 150.5]), [rows, await donut(page)]);
    const done = await page.evaluate(arch => _isScheduleItemCompleted({ nomUid: arch.nomUid, name: arch.vessel, bargeStart: arch.supplyDate }), arch);
    check('an archived delivery counts as completed (never offered as Pending in the checklist again)', done === true);
    const notDone = await page.evaluate(arch => _isScheduleItemCompleted({ nomUid: 'other', name: arch.vessel, bargeStart: arch.supplyDate }), arch);
    check('…but not another nomination of the same ship', notDone === false);
  });

  /* 4 — two devices: archives merge keeps the newer row; a stale Edit dialog keeps a colleague's change */
  await scenario('E4 sync', async (openT) => {
    const seed = U.seedPayload({ vessels: [] });
    seed.records = [rec({ uid: 'cp', vessel: 'CHILE PROSPERITY', vAct: 498.5, mAct: 99.2 })];
    const db = H.createDb({ workspace: seed, realtime: false });
    const A = await openT(db, 'user-operator');
    const B = await openT(db, 'user-operator2');
    // B opens the dialog and types a BDN number; meanwhile A changes the MGO
    await B.page.evaluate(() => { showPage('records'); openEditRecord('cp_1000'); const m = document.getElementById('er-bdn-m'); m.value = 'BDN-9'; m.dispatchEvent(new Event('input', { bubbles: true })); });
    await editRecord(A.page, 'cp_1000', { 'er-mgo-act': '150.5' });
    await B.page.evaluate(() => { document.activeElement && document.activeElement.blur(); return _pollOnce(true); });
    await sleep(400);
    await B.page.evaluate(() => saveEditRecord());
    await sleep(700);
    const r = U.row(db).payload.records[0];
    check('a dialog left open while a colleague saved: only its own change (BDN) is written; their MGO stays', r.mgoAct === 150.5 && r.bdnM === 'BDN-9', r);
    // both change the MGO: asked before overwriting
    await B.page.evaluate(() => { openEditRecord('cp_1000'); const m = document.getElementById('er-mgo-act'); m.value = '120'; });
    await editRecord(A.page, 'cp_1000', { 'er-mgo-act': '130' });
    await B.page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.__dialogs = []; window.confirm = m => { window.__dialogs.push(m); return false; }; return _pollOnce(true); });
    await sleep(300);
    await B.page.evaluate(() => saveEditRecord());
    await sleep(400);
    const asked = await B.page.evaluate(() => window.__dialogs.join(' '));
    check('both changed the MGO: asked first ("Someone else changed mgoAct … now: mgoAct = 130"); Cancel keeps theirs', /Someone else changed mgoAct/.test(asked) && /mgoAct = 130/.test(asked) && U.row(db).payload.records[0].mgoAct === 130, asked);
    // archives: a same-id row edited and re-archived elsewhere wins over an old cached copy
    const merged = await A.page.evaluate(() => {
      _archives = { 2026: { Sep: { records: [{ id: 'x1', vessel: 'X', mgoAct: 99.2, savedAt: '2026-10-01T00:00:00.000Z', supplyDate: '2026-09-10T06:00:00.000Z', supplied: true }], archivedAt: '2026-10-01T00:00:00.000Z', month: 8, year: 2026 } } };
      _mergeArchives({ 2026: { Sep: { records: [{ id: 'x1', vessel: 'X', mgoAct: 150.5, savedAt: '2026-10-05T00:00:00.000Z', supplyDate: '2026-09-10T06:00:00.000Z', supplied: true }], archivedAt: '2026-10-05T00:00:00.000Z', month: 8, year: 2026 } } });
      const newer = _archives[2026].Sep.records[0].mgoAct;
      _mergeArchives({ 2026: { Sep: { records: [{ id: 'x1', vessel: 'X', mgoAct: 99.2, savedAt: '2026-10-01T00:00:00.000Z', supplyDate: '2026-09-10T06:00:00.000Z', supplied: true }], archivedAt: '2026-10-01T00:00:00.000Z', month: 8, year: 2026 } } });
      return [newer, _archives[2026].Sep.records[0].mgoAct];
    });
    check('archive merge: the newer copy of a same-id row wins (an edit re-stamps savedAt), an older cached copy never wins back', merged[0] === 150.5 && merged[1] === 150.5, merged);
  });

  /* 5 — supply date, Remove Duplicates, checklist blank actual */
  await scenario('E5 date, duplicates, blank actual', async (openT) => {
    const seed = U.seedPayload({ vessels: [] });
    seed.records = [rec({ uid: 'cp', ts: 1000, savedAt: '2026-10-02T00:00:00.000Z', vessel: 'CHILE PROSPERITY', vAct: 498.5, mAct: 99.2 }), rec({ uid: 'cp', ts: 2000, savedAt: '2026-10-03T00:00:00.000Z', vessel: 'CHILE PROSPERITY', vAct: 498.5, mAct: 150.5 })];
    const db = H.createDb({ workspace: seed, realtime: false });
    const { page } = await openT(db);
    await page.evaluate(() => removeDuplicateSavedRecords());
    await sleep(500);
    const recs = U.row(db).payload.records;
    check('Remove Duplicates: two saves of the same checklist row → the latest copy is kept (whatever the quantities)', recs.length === 1 && recs[0].id === 'cp_2000' && recs[0].mgoAct === 150.5, recs.map(r => [r.id, r.mgoAct]));
    await editRecord(page, 'cp_2000', { 'er-date': '05 Sep 2026 06:30' });
    const r = U.row(db).payload.records[0];
    const d = new Date(r.supplyDate);
    check('changing "Supply Date / Start" moves the supply date too (the month the reports file it under)', d.getMonth() === 8 && d.getDate() === 5 && /^05 Sep 2026\s+06:30$/.test(r.dateStr), [r.supplyDate, r.dateStr]);
    await page.evaluate(() => { openEditRecord('cp_2000'); document.getElementById('er-date').value = 'sometime'; window.__dialogs = []; });
    await page.evaluate(() => saveEditRecord());
    check('an unreadable date is refused with a message', await page.evaluate(() => window.__dialogs.some(m => /Supply date not understood/.test(m))) && U.row(db).payload.records[0].dateStr !== 'sometime');
    await page.evaluate(() => closeEditRecord());
    // checklist: LSMGO nominated, actual box left empty → asked
    const asked = await page.evaluate(() => {
      _checklistRecords.t1 = { uid: 't1', nomUid: 'nT', vessel: 'TEST SHIP', area: 'FUJ-A', supplyDate: new Date().toISOString(), nomV: 500, nomM: 100, actV: '', actM: '', bdnV: '', bdnM: '', state: 'draft', bargeLabel: 'Barge 1' };
      window.__dialogs = []; window.confirm = m => { window.__dialogs.push(m); return false; };
      const box = document.createElement('div'); box.innerHTML = '<input id="cl-av-t1" value="498"><input id="cl-am-t1" value="">'; document.body.appendChild(box);
      try { saveChecklistRecord("t1"); } catch (e) { window.__dialogs.push("threw " + e.message); }
      box.remove();
      return { dialogs: window.__dialogs.slice(), saved: _savedSupplies.some(r => r.checklistUid === 't1') };
    });
    check('checklist: an empty LSMGO actual with 100 MT nominated asks before saving 0 MT; Cancel saves nothing', asked.dialogs.some(m => /No actual quantity entered for LSMGO \(nominated 100 MT\)/.test(m)) && !asked.saved, asked);
  });

  await browser.close();
  console.log('RECORDS-EDIT: ' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
