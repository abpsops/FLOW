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

  /* 6 — older checklist rows were named 'v_<vessel>': different calls of one ship share that uid */
  await scenario('E6 legacy shared checklist uid', async (openT) => {
    const seed = U.seedPayload({ vessels: [] });
    const sep = { id: 'v_alpha_1757500000000', checklistUid: 'v_alpha', vessel: 'ALPHA', areaCode: 'FUJ-A', area: AREA['FUJ-A'], dateStr: '10 Sep 2026  10:00', supplyDate: '2026-09-10T06:00:00.000Z', vlsfoAct: 480, mgoAct: 0, barge: 'Barge 1', supplied: true, savedAt: '2026-09-10T08:00:00.000Z' };
    const oct = rec({ uid: 'v_alpha', ts: 3000, vessel: 'ALPHA', vAct: 495, mAct: 0, extra: { nomUid: undefined } });
    const oct2 = rec({ uid: 'v_alpha', ts: 3100, savedAt: '2026-10-09T00:00:00.000Z', vessel: 'ALPHA', vAct: 300, mAct: 0, supplyDate: (() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth() + 1, 15, 10, 0).toISOString(); })(), extra: { nomUid: undefined } }); // a later call (next month — past months are auto-archived on load)
    seed.records = [oct, oct2];
    seed.state.archives = { 2026: { Sep: { records: [sep], archivedAt: '2026-10-01T00:00:00.000Z', month: 8, year: 2026 } } };
    const db = H.createDb({ workspace: seed, realtime: false });
    const { page } = await openT(db);
    const sepRows = await page.evaluate(() => getMonthlyRows(8, 2026).map(r => [r.name, r.vQ]));
    check('a September delivery archived under the old uid still counts although a later ALPHA call is live with the same uid', JSON.stringify(sepRows) === JSON.stringify([['ALPHA', 480]]), sepRows);
    await page.evaluate(() => removeDuplicateSavedRecords());
    await sleep(400);
    check('Remove Duplicates keeps two different ALPHA calls that share the old uid', U.row(db).payload.records.length === 2, U.row(db).payload.records.map(r => r.id));
    const dropped = await page.evaluate(() => _dropArchivedCopies({ checklistUid: 'v_alpha', nomUid: 'n9', vessel: 'ALPHA', supplyDate: new Date().toISOString() }));
    check('saving a new ALPHA call from a reused old checklist row never deletes the archived September delivery', dropped === 0 && await page.evaluate(() => _archives[2026].Sep.records.length) === 1, dropped);
    const same = await page.evaluate(() => _dropArchivedCopies({ checklistUid: 'v_alpha', vessel: 'ALPHA', supplyDate: '2026-09-11T06:00:00.000Z' }));
    check('…but a re-save of that same September call (same ship, within 3 days) replaces its archived copy', same === 1, same);
    // double click on Save: no false "someone else changed"
    await page.evaluate(() => { showPage('records'); openEditRecord('v_alpha_3000'); document.getElementById('er-vlsfo-act').value = '500'; window.__dialogs = []; });
    await page.evaluate(() => Promise.all([saveEditRecord(), saveEditRecord()]));
    await sleep(400);
    check('a double click on Save Changes saves once, with no false "Someone else changed" prompt', await page.evaluate(() => !window.__dialogs.some(m => /Someone else changed/.test(m))) && U.row(db).payload.records.find(r => r.id === 'v_alpha_3000').vlsfoAct === 500);
  });

  /* 7 — the Edit dialog: a save still in flight, and a colleague's change synced in under it */
  await scenario('E7 dialog sessions and summary', async (openT) => {
    const seed = U.seedPayload({ vessels: [] });
    seed.records = [rec({ uid: 'a', vessel: 'ALPHA', vAct: 400, mAct: 50 }), rec({ uid: 'cp', vessel: 'CHILE PROSPERITY', vAct: 498.5, mAct: 99.2 })];
    const db = H.createDb({ workspace: seed, realtime: false });
    const A = await openT(db, 'user-operator');
    const B = await openT(db, 'user-operator2');
    const page = A.page;
    // ALPHA's save is slow; meanwhile the dialog is closed and CHILE PROSPERITY opened
    const mid = await page.evaluate(async () => {
      window.__orig = saveSharedRecords;
      window.saveSharedRecords = async function() { await new Promise(r => setTimeout(r, 500)); return window.__orig(); };
      showPage('records'); openEditRecord('a_1000'); document.getElementById('er-mgo-act').value = '60';
      const p1 = saveEditRecord();
      closeEditRecord(); openEditRecord('cp_1000'); document.getElementById('er-mgo-act').value = '150.5';
      await p1;
      return { open: document.getElementById('edit-record-modal').style.display, id: _editingRecordId, mgo: document.getElementById('er-mgo-act').value };
    });
    check('a save that finishes after another record was opened leaves that dialog open, with what was typed', mid.open === 'flex' && mid.id === 'cp_1000' && mid.mgo === '150.5', mid);
    await page.evaluate(() => saveEditRecord());
    await sleep(900);
    let recs = U.row(db).payload.records;
    check('…and both edits are saved', recs.find(r => r.id === 'a_1000').mgoAct === 60 && recs.find(r => r.id === 'cp_1000').mgoAct === 150.5, recs.map(r => [r.id, r.mgoAct]));
    // Save on a second record while the first save is still in flight: not swallowed
    await page.evaluate(async () => {
      openEditRecord('a_1000'); document.getElementById('er-mgo-act').value = '70';
      const p1 = saveEditRecord();
      closeEditRecord(); openEditRecord('cp_1000'); document.getElementById('er-mgo-act').value = '160';
      const p2 = saveEditRecord();
      await Promise.all([p1, p2]);
      window.saveSharedRecords = window.__orig;
    });
    await sleep(600);
    recs = U.row(db).payload.records;
    const closed = await page.evaluate(() => document.getElementById('edit-record-modal').style.display);
    check('Save on another record while the first save is in flight saves it too (and closes its dialog)', recs.find(r => r.id === 'a_1000').mgoAct === 70 && recs.find(r => r.id === 'cp_1000').mgoAct === 160 && closed === 'none', [recs.map(r => [r.id, r.mgoAct]), closed]);
    // B's dialog is open; A changes the VLSFO; B pulls and then types an MGO
    await B.page.evaluate(() => { document.activeElement && document.activeElement.blur(); return _pollOnce(true); });
    await sleep(300);
    await B.page.evaluate(() => { showPage('records'); openEditRecord('cp_1000'); });
    await editRecord(page, 'cp_1000', { 'er-vlsfo-act': '450' });
    await B.page.evaluate(() => { document.activeElement && document.activeElement.blur(); return _pollOnce(true); });
    await sleep(400);
    const sum = await B.page.evaluate(() => { const m = document.getElementById('er-mgo-act'); m.value = '170'; m.dispatchEvent(new Event('input', { bubbles: true })); return document.getElementById('er-diff-rows').textContent; });
    check('the change summary lists only what this dialog changes, from the record as it is now (no "VLSFO 450 → 498.5" a colleague\'s change would seem to undo)', /MGO: 160 MT → 170 MT/.test(sum) && !/VLSFO/.test(sum), sum);
    await B.page.evaluate(() => saveEditRecord());
    await sleep(600);
    const r = U.row(db).payload.records.find(x => x.id === 'cp_1000');
    check('…and Save writes just that: MGO 170, the colleague\'s VLSFO 450 stays', r.mgoAct === 170 && r.vlsfoAct === 450, [r.vlsfoAct, r.mgoAct]);
  });

  /* 8 — an archived copy of a delivery never comes back as a second one */
  await scenario('E8 archives keep one copy', async (openT) => {
    const n = new Date();
    const pm = new Date(n.getFullYear(), n.getMonth() - 1, 10, 10, 0), pmKey = MO[pm.getMonth()], pmYr = pm.getFullYear();
    const nextMonth = new Date(n.getFullYear(), n.getMonth() + 1, 15, 10, 0);
    const seed = U.seedPayload({ vessels: [] });
    // last month: re-saved (live, MGO edited to 150.5) next to its old archived copy; another delivery archived too
    const live = rec({ uid: 'cp', ts: 2000, savedAt: '2026-10-03T00:00:00.000Z', vessel: 'CHILE PROSPERITY', vAct: 498.5, mAct: 150.5, supplyDate: pm.toISOString() });
    const old = rec({ uid: 'cp', ts: 1000, vessel: 'CHILE PROSPERITY', vAct: 498.5, mAct: 99.2, supplyDate: pm.toISOString() });
    const other = rec({ uid: 'o', ts: 1000, vessel: 'OMEGA', vAct: 300, mAct: 0, supplyDate: pm.toISOString() });
    // this month, an older checklist row ('v_<vessel>', no nomUid): live + an archived copy with another id
    const beta = rec({ uid: 'v_beta', ts: 2000, vessel: 'BETA', vAct: 200, mAct: 20, extra: { nomUid: undefined } });
    const betaOld = rec({ uid: 'v_beta', ts: 1000, vessel: 'BETA', vAct: 200, mAct: 20, extra: { nomUid: undefined } });
    const gamma = rec({ uid: 'v_gamma', ts: 2000, vessel: 'GAMA', vAct: 100, mAct: 10, extra: { nomUid: undefined } });
    const gammaOld = rec({ uid: 'v_gamma', ts: 1000, vessel: 'GAMA', vAct: 100, mAct: 10, extra: { nomUid: undefined } });
    seed.records = [live, beta, gamma];
    seed.state.archives = { [pmYr]: { [pmKey]: { records: [old, other], archivedAt: '2026-10-01T00:00:00.000Z', month: pm.getMonth(), year: pmYr } } };
    seed.state.archives[n.getFullYear()] = Object.assign(seed.state.archives[n.getFullYear()] || {}, { [MO[n.getMonth()]]: { records: [betaOld, gammaOld], archivedAt: '2026-10-01T00:00:00.000Z', month: n.getMonth(), year: n.getFullYear() } });
    const db = H.createDb({ workspace: seed, realtime: false });
    const { page } = await openT(db);
    await sleep(300);
    const arch = await page.evaluate(([y, k, m]) => ({ rows: (_archives[y][k].records || []).map(r => [r.id, r.mgoAct]), rep: getMonthlyRows(m, y).map(r => [r.name, r.mQ]), live: _savedSupplies.some(r => r.id === 'cp_2000') }), [pmYr, pmKey, pm.getMonth()]);
    check('month-end archiving files the re-saved copy in place of its old archived copy: counted once, with the edited MGO; the other delivery stays', !arch.live && JSON.stringify(arch.rows.sort()) === JSON.stringify([['cp_2000', 150.5], ['o_1000', 0]]) && arch.rep.filter(r => r[0] === 'CHILE PROSPERITY').length === 1 && arch.rep.find(r => r[0] === 'CHILE PROSPERITY')[1] === 150.5, arch);
    const thisMon = () => page.evaluate(() => { const n = new Date(); return getMonthlyRows(n.getMonth(), n.getFullYear()).map(r => r.name); });
    check('this month before the edits: BETA and GAMA once each', JSON.stringify((await thisMon()).sort()) === JSON.stringify(['BETA', 'GAMA']), await thisMon());
    const ds = nextMonth.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ' 10:00';
    await editRecord(page, 'v_beta_2000', { 'er-date': ds });
    await editRecord(page, 'v_gamma_2000', { 'er-vessel': 'GAMMA' });
    const after = await thisMon();
    const nextRows = await page.evaluate(d => { const x = new Date(d); return getMonthlyRows(x.getMonth(), x.getFullYear()).map(r => r.name); }, nextMonth.toISOString());
    check('moving a supply date by weeks, or correcting the vessel name, does not bring its archived copy back as a second delivery', JSON.stringify(after) === JSON.stringify(['GAMMA']) && JSON.stringify(nextRows) === JSON.stringify(['BETA']), [after, nextRows]);
    // BDN numbers go to the 'v_<vessel>' checklist row only when it is this call's row
    const bdn = await page.evaluate(async (later) => {
      _checklistRecords.v_gamma = { uid: 'v_gamma', vessel: 'GAMMA', supplyDate: later, state: 'completed', bdnV: 'CL-NEXT', bdnM: '' };
      showPage('records'); openEditRecord('v_gamma_2000'); const v = document.getElementById('er-bdn-v'); v.value = 'OLD-CALL'; v.dispatchEvent(new Event('input', { bubbles: true }));
      await saveEditRecord();
      const kept = _checklistRecords.v_gamma.bdnV;
      _checklistRecords.v_gamma.supplyDate = _savedSupplies.find(r => r.id === 'v_gamma_2000').supplyDate;
      openEditRecord('v_gamma_2000'); const v2 = document.getElementById('er-bdn-v'); v2.value = 'SAME-CALL'; v2.dispatchEvent(new Event('input', { bubbles: true }));
      await saveEditRecord();
      return [kept, _checklistRecords.v_gamma.bdnV];
    }, nextMonth.toISOString());
    check('a BDN edit on an older call never overwrites the BDN of a later call that reuses the ship\'s old checklist row; on the same call it is copied', bdn[0] === 'CL-NEXT' && bdn[1] === 'SAME-CALL', bdn);
    // another device still has the old copy archived and syncs it back (archives merge as a union)
    const back = await page.evaluate(([y, k, m, o]) => {
      _mergeArchives({ [y]: { [k]: { records: [o], archivedAt: '2026-09-30T00:00:00.000Z', month: m, year: y } } });
      return { rows: _archives[y][k].records.map(r => r.id).sort(), rep: getMonthlyRows(m, y).filter(r => r.name === 'CHILE PROSPERITY').map(r => r.mQ) };
    }, [pmYr, pmKey, pm.getMonth(), old]);
    check('an old copy synced back from another device gives way to the newer one: still counted once, with the edited MGO', JSON.stringify(back.rows) === JSON.stringify(['cp_2000', 'o_1000']) && JSON.stringify(back.rep) === JSON.stringify([150.5]), back);
    // a device opening a workspace whose archive already holds both copies
    const seed2 = U.seedPayload({ vessels: [] });
    seed2.records = [];
    seed2.state.archives = { [pmYr]: { [pmKey]: { records: [old, Object.assign({}, live), other], archivedAt: '2026-10-01T00:00:00.000Z', month: pm.getMonth(), year: pmYr } } };
    const db2 = H.createDb({ workspace: seed2, realtime: false });
    const p2 = (await openT(db2, 'user-operator2')).page;
    await sleep(300);
    const fresh = await p2.evaluate(([y, k, m]) => ({ rows: _archives[y][k].records.map(r => r.id).sort(), rep: getMonthlyRows(m, y).map(r => [r.name, r.mQ]) }), [pmYr, pmKey, pm.getMonth()]);
    check('…and on a device that opens an archive already holding both copies: once, the newest', JSON.stringify(fresh.rows) === JSON.stringify(['cp_2000', 'o_1000']) && fresh.rep.filter(r => r[0] === 'CHILE PROSPERITY').length === 1 && fresh.rep.find(r => r[0] === 'CHILE PROSPERITY')[1] === 150.5, fresh);
  });

  await browser.close();
  console.log('RECORDS-EDIT: ' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
