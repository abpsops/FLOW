/* R5 data/report/archive tests. node r5_data.test.js [appDir] */
const H = require('../../harness/harness.js');
const appDir = process.argv[2] || H.APP_DIR;
let fails = 0;
const ok = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); if (!cond) fails++; };

(async () => {
  const browser = await H.launch();
  const db = H.createDb();
  const app = await H.openApp(browser, db, { appDir });
  const page = app.page;
  const ev = (fn, arg) => page.evaluate(fn, arg);

  // ── 1. XSS ──
  const XSS = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';
  await ev((XSS) => {
    const now = new Date();
    _savedSupplies = [{ id: "a'b\"c", vessel: XSS, agent: XSS, spec: XSS, notes: XSS, barge: XSS, dateStr: XSS, supplyDate: now.toISOString(), savedAt: now.toISOString(), vlsfoAct: 1, mgoAct: 0, supplied: true, area: 'FUJ-A' }];
    renderSavedRecords();
    _archives = { 2025: { Jan: { records: [{ vessel: XSS, barge: XSS, area: XSS, vlsfoAct: 5, supplyDate: '2025-01-05' }], archivedAt: '2025-02-01T00:00:00Z', month: 0, year: 2025 } } };
    renderArchivePanel(); openArchiveWindow('2025', 'Jan');
    _flowReportPDFHTML; // existence
    document.body.insertAdjacentHTML('beforeend', '<div id="__pdfprobe">' + _flowReportPDFHTML({ rows: [{ vessel: XSS, dateStr: XSS, v: 1, m: 0, bdnV: XSS, bdnM: XSS, barge: XSS, port: XSS }], totV: 1, totM: 0, badge: XSS, metaLines: [['x', XSS]] }) + '</div>');
    document.getElementById('report-month').value = now.getMonth(); document.getElementById('report-year').value = now.getFullYear();
    _reportMode = 'month'; _reportPort = 'ALL'; renderMonthlyPreview();
    _lastSched = [{ sno: 1, name: XSS, eta: new Date(), bargeLabel: XSS, area: XSS, vQ: 10, mQ: 0, nomUid: 'n1' }];
    _loadingRecords = [{ id: "l'1", terminal: XSS, grade: 'VLSFO', qty: 5, startAt: new Date().toISOString(), endAt: new Date(Date.now() + 3600e3).toISOString(), surveyor: XSS, notes: '"><img src=x onerror="window.__xss=99">' }];
    renderWeekCalendar(0);
    _deliveryLog = {}; _deliveryLog[_dlMonthKey(new Date())] = { timely: [], delayed: [], disputes: [{ vessel: XSS, remarks: XSS, dateStr: 'x', isDispute: true }] };
    renderDeliveryLog();
    ciLoadTemplate('kfk', { files: [new File(['hello'], '<img src=x onerror=window.__xss=7>.txt')] });
  }, XSS);
  await page.waitForTimeout(600);
  const xss = await ev(() => ({
    fired: window.__xss || 0,
    imgs: [...document.querySelectorAll('img')].filter(i => i.getAttribute('src') === 'x').length,
    editOnclick: document.querySelector('#saved-records-list .btn-ghost').getAttribute('onclick'),
    calTitleOk: !!document.querySelector('.cal-ticket-loading') && document.querySelector('.cal-ticket-loading').getAttribute('title').includes('"><img'),
  }));
  ok('XSS: no injected <img> anywhere / nothing fired', xss.fired === 0 && xss.imgs === 0, xss);
  ok('XSS: loading notes stay inside title attribute', xss.calTitleOk, xss);
  await ev(() => document.querySelector('#saved-records-list .btn-ghost').click());
  ok('XSS: Edit button with quote in id still opens record', await ev(() => _editingRecordId === "a'b\"c"));
  await ev(() => { closeEditRecord(); const m = document.getElementById('_archiveModal'); if (m) m.remove(); document.getElementById('__pdfprobe').remove(); });

  // ── 2/3. archive with port filter + re-archive merge ──
  const arch = await ev(() => {
    _archives = {};
    const mk = (id, area, v) => ({ id, vessel: 'V' + id, area, areaCode: area, supplyDate: '2025-03-10T08:00:00Z', vlsfoAct: v, mgoAct: 0, supplied: true, barge: 'B1' });
    _savedSupplies = [mk('f1', 'FUJ-A', 100), mk('k1', 'KFK-A', 200)];
    _reportPort = 'FUJ';
    archiveMonth(2, 2025);
    const afterFuj = { live: _savedSupplies.map(r => r.id), arch: _archives[2025].Mar.records.map(r => r.id) };
    _savedSupplies.push(mk('f2', 'FUJ-B', 300));
    _reportPort = 'ALL';
    archiveMonth(2, 2025);
    return { afterFuj, after2: { live: _savedSupplies.map(r => r.id), arch: _archives[2025].Mar.records.map(r => r.id).sort() } };
  });
  ok('archive FUJ-only keeps KFK record live', JSON.stringify(arch.afterFuj) === JSON.stringify({ live: ['k1'], arch: ['f1'] }), arch);
  ok('re-archive merges instead of overwriting', JSON.stringify(arch.after2.arch) === JSON.stringify(['f1', 'f2', 'k1']) && arch.after2.live.length === 0, arch);

  // ── 6. dedupe ──
  const dd = await ev(() => {
    _archives = {};
    const base = { vessel: 'MT KARACHI', supplyDate: '2025-04-02T08:00:00Z', vlsfoAct: 500, mgoAct: 0, supplied: true };
    _savedSupplies = [Object.assign({ id: 'a', barge: 'B1' }, base), Object.assign({ id: 'b', barge: 'B2' }, base), Object.assign({ id: 'c', barge: 'B1' }, base)];
    const liveOnly = _getAllReportRecords().length;
    _archives = { 2025: { Apr: { records: [Object.assign({ barge: 'B1', vessel: 'M/T KARACHI' }, base)], archivedAt: '2025-05-01T00:00:00Z', month: 3, year: 2025 } } };
    const withArch = _getAllReportRecords().length;
    const k1 = _recordDedupeKey(_savedSupplies[0]), k2 = _recordDedupeKey(_savedSupplies[1]);
    return { liveOnly, withArch, diffKey: k1 !== k2 };
  });
  ok('two live records never collapsed; split barges differ in key', dd.liveOnly === 3 && dd.diffKey, dd);
  ok('live-vs-archive duplicate collapsed', dd.withArch === 3, dd);

  // ── 7. totals use actual even when 0 ──
  const tot = await ev(() => {
    _archives = {};
    _savedSupplies = [{ id: 'z', vessel: 'ZERO', supplyDate: '2025-06-03T08:00:00Z', vlsfoNom: 500, vlsfoAct: 0, mgoNom: 50, mgoAct: 40, supplied: true }];
    _reportPort = 'ALL';
    const r = getMonthlyRows(5, 2025)[0];
    const rr = getRowsByRange(new Date(2025, 5, 1), new Date(2025, 5, 30))[0];
    return { v: r.vQ, m: r.mQ, rv: rr.vQ };
  });
  ok('report uses actual 0, not nominated', tot.v === 0 && tot.m === 40 && tot.rv === 0, tot);

  // analytics report KPIs include archives
  await ev(() => {
    _savedSupplies = [{ id: 'l1', vessel: 'L', supplyDate: '2025-07-03T08:00:00Z', vlsfoAct: 100, mgoAct: 0, supplied: true }];
    _archives = { 2025: { Jan: { records: [{ id: 'a1', vessel: 'A', supplyDate: '2025-01-03T08:00:00Z', vlsfoAct: 250, mgoAct: 0 }], archivedAt: '2025-02-01T00:00:00Z', month: 0, year: 2025 } } };
  });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), ev(() => downloadAnalyticsReport())]);
  const html = require('fs').readFileSync(await dl.path(), 'utf8');
  ok('analytics report KPIs include archived records (350 MT, 2 ops)', /350(\.0+)? MT/.test(html) && /Records: 2/.test(html), html.match(/kpi-value">[^<]*/g));

  // ── 8. tombstones ──
  const tb = await ev(() => {
    _savedSupplies = [];
    _archives = { 2025: { Feb: { records: [{ id: 'x1', vessel: 'X', supplyDate: '2025-02-03T08:00:00Z', vlsfoAct: 10, mgoAct: 0 }], archivedAt: '2025-03-01T00:00:00Z', month: 1, year: 2025 } } };
    const remoteOld = JSON.parse(JSON.stringify(_archives));
    deleteArchive('2025', 'Feb'); // confirm auto-accepted → restore
    const t1 = JSON.parse(JSON.stringify(_archives[2025].Feb));
    _mergeArchives(remoteOld); // another device's older copy
    const stillDeleted = !!_archives[2025].Feb.deleted;
    renderArchivePanel();
    const panelEmpty = /No archives yet/.test(document.getElementById('archive-panel').textContent);
    const repCount = _getAllReportRecords().filter(r => r._fromArchive).length;
    const newer = { 2025: { Feb: { records: [{ id: 'x9', vessel: 'Y', supplyDate: '2025-02-04T08:00:00Z', vlsfoAct: 1 }], archivedAt: new Date(Date.now() + 60000).toISOString(), month: 1, year: 2025 } } };
    _mergeArchives(newer);
    const reArchivedWins = !_archives[2025].Feb.deleted && _archives[2025].Feb.records[0].id === 'x9';
    return { t1, stillDeleted, panelEmpty, repCount, restored: _savedSupplies.length, reArchivedWins };
  });
  ok('deleteArchive leaves tombstone & restores records', tb.t1.deleted === true && !!tb.t1.deletedAt && tb.restored === 1, tb);
  ok('older remote copy does not resurrect deleted archive', tb.stillDeleted && tb.panelEmpty && tb.repCount === 0, tb);
  ok('newer re-archive beats tombstone', tb.reArchivedWins, tb);

  // ── 9. restoring legacy (id-less) archive doesn't double deduct ROB ──
  const rob = await ev(() => {
    _savedSupplies = []; _manualROB = {}; _bakedSupplyIds = {};
    _bargeConfig = [{ id: 1, name: 'B1', vrob: 1000, mrob: 100, vcap: 5000, mcap: 1000 }];
    _archives = { 2025: { May: { records: [{ vessel: 'LEGACY', supplyDate: '2025-05-03T08:00:00Z', vlsfoAct: 300, mgoAct: 0, barge: 'B1' }], archivedAt: '2025-06-01T00:00:00Z', month: 4, year: 2025 } } };
    deleteArchive('2025', 'May');
    const restoredId = _savedSupplies[0].id;
    return { live: computeLiveROB(1, 'B1', 1000, 100, null).v, baked: (_bakedSupplyIds[1] || []).includes(restoredId) };
  });
  ok('restored legacy record is marked baked (ROB not deducted again)', rob.baked && rob.live === 1000, rob);

  // ── 10. calendar repeat call + deleteRecord only resets linked checklist row ──
  const cal = await ev(() => {
    const t = new Date(); t.setHours(10, 0, 0, 0);
    _loadingRecords = [];
    _lastSched = [{ sno: 1, name: 'REPEATER', eta: t, bargeLabel: 'B1', vQ: 10, mQ: 0, nomUid: 'nomB' }];
    _savedSupplies = [{ id: 's1', vessel: 'REPEATER', nomUid: 'nomA', supplyDate: new Date(Date.now() - 20 * 86400e3).toISOString(), vlsfoAct: 5, supplied: true }];
    _checklistRecords = {};
    renderWeekCalendar(0);
    const shown = document.getElementById('week-calendar').textContent.includes('REPEATER');
    _checklistRecords = {
      u1: { uid: 'u1', vessel: 'REPEATER', state: 'completed', lockedAt: 'x', actV: 5, supplied: true, supplyDate: '2025-01-01T00:00:00Z' },
      u2: { uid: 'u2', vessel: 'REPEATER', state: 'completed', lockedAt: 'y', actV: 7, supplied: true, supplyDate: '2025-02-01T00:00:00Z' },
    };
    _savedSupplies = [{ id: 'r2', checklistUid: 'u2', vessel: 'REPEATER', supplyDate: '2025-02-01T00:00:00Z', vlsfoAct: 7, supplied: true }];
    return shown;
  });
  ok('week calendar shows repeat call of an already-supplied vessel', cal);
  await ev(() => deleteRecord('r2'));
  const cr = await ev(() => ({ u1: _checklistRecords.u1.state, u2: _checklistRecords.u2.state }));
  ok('deleteRecord resets only the linked checklist row', cr.u1 === 'completed' && cr.u2 === 'draft', cr);

  // ── 4. full reset keeps saved supplies ──
  const fr = await ev(async () => {
    _savedSupplies = [{ id: 'keep', vessel: 'K', supplyDate: '2025-01-01T00:00:00Z', vlsfoAct: 1, supplied: true }];
    _manualROB = { '1_final': { v: 1 } };
    try { localStorage.setItem('abps_manual_rob_v1', '{"1_pre":{"v":5}}'); } catch (e) {}
    await fullReset();
    return { n: _savedSupplies.length, rob: Object.keys(_manualROB).length, ls: localStorage.getItem('abps_manual_rob_v1') };
  });
  ok('fullReset keeps saved records, clears ROB overrides', fr.n === 1 && fr.rob === 0 && fr.ls === null, fr);

  // ── 12. clear checklist ──
  const cc = await ev(async () => {
    _bargeConfig = [{ id: 1, name: 'B1', vrob: 900, mrob: 90 }];
    _lastSched = [];
    _checklistRecords = { p: { uid: 'p', vessel: 'PEND', state: 'draft' }, c: { uid: 'c', vessel: 'DONE', state: 'completed', lockedAt: 'x', supplied: true } };
    await clearChecklistRecords();
    return { keys: Object.keys(_checklistRecords), barges: _bargeConfig.length };
  });
  ok('clearChecklist removes only pending rows, keeps barges', JSON.stringify(cc) === JSON.stringify({ keys: ['c'], barges: 1 }), cc);

  // ── 13. saveArchives quota warning ──
  const q = await ev(() => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; };
    try { saveArchives(); } finally { Storage.prototype.setItem = orig; }
    return [...document.querySelectorAll('#toast-stack .toast')].map(t => t.textContent).join(' | ');
  });
  ok('saveArchives quota failure shows a toast', /storage is full/.test(q), q);

  // ── 15. local date-only parse ──
  ok('_parseDateLocal date-only is local midnight', await ev(() => { const d = _parseDateLocal('2026-03-01'); return d.getDate() === 1 && d.getMonth() === 2 && d.getHours() === 0; }));
  ok('_localTzLabel is not "UTC" in Asia/Dubai', await ev(() => _localTzLabel()) !== 'UTC', await ev(() => _localTzLabel()));

  // print schedule: per-barge sequence + tz label + escaping
  const pr = await ev(() => {
    window.print = () => {};
    const t0 = new Date(2026, 0, 1, 8).getTime(), h = 3600e3;
    _lastSched = [
      { sno: 1, name: 'A1', bargeLabel: 'B1', bargeStart: new Date(t0), etc: new Date(t0 + 2 * h), eta: new Date(t0), vQ: 1, mQ: 0 },
      { sno: 2, name: 'B-FIRST', bargeLabel: 'B2', bargeStart: new Date(t0 + 3 * h), etc: new Date(t0 + 4 * h), eta: new Date(t0), vQ: 1, mQ: 0 },
      { sno: 3, name: 'A2', bargeLabel: 'B1', bargeStart: new Date(t0 + 5 * h), etc: new Date(t0 + 6 * h), eta: new Date(t0), vQ: 1, mQ: 0 },
    ];
    const box = document.createElement('div'); box.id = '__chk';
    box.innerHTML = [1, 2, 3].map(n => '<input type="checkbox" class="voy-print-chk" data-sno="' + n + '" checked>').join('');
    document.body.appendChild(box);
    printScheduleOnly();
    box.remove();
    const c = document.getElementById('print-only-container');
    const rows = [...c.querySelectorAll('.voy-tbl tbody tr')].map(tr => tr.children[10].textContent.trim());
    return { rows, hdr: c.querySelector('.print-schedule-header').textContent };
  });
  ok('print: sequence computed per barge', JSON.stringify(pr.rows) === JSON.stringify(['On Arrival', 'On Arrival', 'After A1']), pr.rows);
  ok('print: no "UTC" label for local time', !/UTC/.test(pr.hdr), pr.hdr);

  ok('no page errors except known capacitor ones', app.errors.filter(e => !/capacitorExports|saveArchives failed: QuotaExceededError/.test(e)).length === 0, app.errors);
  await app.ctx.close();

  // month bucketing in a negative-UTC zone
  const app2 = await H.openApp(browser, H.createDb(), { appDir, timezoneId: 'America/New_York' });
  const mb = await app2.page.evaluate(() => { _archives = {}; _reportPort = 'ALL'; _savedSupplies = [{ id: 'd', vessel: 'D', supplyDate: '2026-03-01', vlsfoAct: 1, supplied: true }]; return getMonthlyRows(2, 2026).length; });
  ok('date-only supplyDate buckets into its own month west of UTC', mb === 1, mb);
  await app2.ctx.close();

  await browser.close();
  console.log(fails ? `R5 DATA: ${fails} FAILED` : 'R5 DATA: ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
