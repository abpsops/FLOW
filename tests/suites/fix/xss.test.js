/* Stored-XSS sweep: every user-controlled string in the shared workspace (and
   the per-device localStorage stores) is set to an HTML/attribute-breaking
   payload; then every page is visited and the main modals/previews opened,
   as operator and as trader. Nothing may execute or be parsed as markup.
   node xss.test.js [appDir] */
const path = require('path');
const H = require('../../harness/harness.js');
const appDir = process.argv[2] || H.APP_DIR;
const X = `"'><img src=x onerror="window.__xss=(window.__xss||0)+1">`;

let fails = 0, passes = 0;
const ok = (name, cond, extra) => {
  if (cond) passes++; else fails++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).slice(0, 1500)));
};
const realErrors = (app) => app.errors.filter(e => !/capacitorExports is not defined/.test(e));

function iso(d) { return new Date(d).toISOString(); }
function workspace() {
  const now = Date.now();
  const day = 86400000;
  const monthKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  const sup = (id, t, extra) => Object.assign({
    id, checklistUid: 'cl_' + id, nomUid: 'nx_' + id, vessel: X, agent: X, spec: X, notes: X, barge: X, bargeLabel: X, area: X, areaCode: X,
    dateStr: X, supplyDate: iso(t), savedAt: iso(t), vlsfoNom: 500, vlsfoAct: 480, mgoNom: 50, mgoAct: 40, bdnV: X, bdnM: X,
    supplied: true, remarks: X, port: X,
  }, extra || {});
  const records = [sup('r1', now - 2 * day), sup('r2', now - 40 * day), sup("r'3\"", now - 1 * day)];
  const dlEntry = (id, t) => ({ id, checklistUid: 'cl_' + id, nomUid: 'nx_' + id, vessel: X, dateStr: X, supplyDate: iso(t), barge: X, vlsfoAct: 480, mgoAct: 40, loggedAt: iso(t), remarks: X });
  const deliveryLog = {};
  [now - 2 * day, now - 40 * day, now - 70 * day].forEach((t, i) => {
    deliveryLog[monthKey(t)] = { timely: [dlEntry('t' + i, t)], delayed: [dlEntry('d' + i, t)], disputes: [dlEntry('p' + i, t)] };
  });
  const lastY = new Date(now - 400 * day).getFullYear();
  const archives = {};
  archives[lastY] = { Jan: { records: [sup('a1', new Date(lastY, 0, 5).getTime()), sup('a2', new Date(lastY, 0, 9).getTime())], archivedAt: iso(new Date(lastY, 1, 1)), month: 0, year: lastY } };
  const eta = (h) => { const d = new Date(now + h * 3600000); return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + String(d.getHours()).padStart(2, '0') + ':00'; };
  const vessel = (nomUid, h) => ({ nomUid, name: X, imo: X, area: 'FUJ-A', type: 'BOTH', qty: 500, mgo: 50, spec: X, agent: X, manifold: 'VESSEL MANIFOLD', remarks: X, lc: '', eta: eta(h), paq: 'no', bargeId: '', refuelChk: false, rfv: 0, rfm: 0, rfvr: 750, rfmr: 275 });
  const clr = (uid, st, extra) => Object.assign({
    uid, nomUid: 'nv' + uid, sno: 1, vessel: X, area: X, nomV: 500, nomM: 50, actV: '', actM: '', bdnV: X, bdnM: X, supplied: false, notes: X, remarks: X,
    bargeLabel: X, supplyDate: iso(now + 3600000), isDelayed: false, state: st, lockedAt: null,
  }, extra || {});
  const state = {
    barges: [
      { id: 1, name: X, vcap: 5000, mcap: 1000, vrob: 4000, mrob: 800, vbuf: 500, mbuf: 150, vtph: 300, mtph: 100, vrfr: 750, mrfr: 275 },
      { id: 2, name: 'B2' + X, vcap: 5000, mcap: 1000, vrob: 4000, mrob: 800, vbuf: 500, mbuf: 150, vtph: 300, mtph: 100, vrfr: 750, mrfr: 275 },
    ],
    vessels: [vessel('nv1', 10), vessel('nv2', 30), vessel('nv3', 60)],
    checklist: {}, manualROB: { '1_final': { v: 3900, m: 700, reason: X, editedAt: iso(now - day), editedBy: X } },
    robAuditLog: [{ bargeId: 1, bargeName: X, field: X, oldVal: 4000, newVal: 3900, reason: X, editedAt: iso(now - day), editedBy: X }],
    calcParams: { hoseHrs: 6, travelHrs: 1 }, lastSched: [],
    checklistRecords: { c1: clr('c1', 'draft'), c2: clr('c2', 'draft', { actV: '100', actM: '10' }) },
    agents: [{ id: 1001, name: X, emails: X + '@x.com, a@b.co', updatedAt: iso(now) }],
    archives, deliveryLog,
    loadingRecords: [
      { id: "l'1\"", barge: X, terminal: X, grade: 'VLSFO', qty: 500, startAt: iso(now + 2 * 3600000), endAt: iso(now + 6 * 3600000), surveyor: X, notes: X, updatedAt: now },
      { id: 'l2', barge: X, terminal: X, grade: 'LSMGO', qty: 100, startAt: iso(now - 9 * 3600000), endAt: iso(now - 5 * 3600000), surveyor: X, notes: X, completed: true, completedAt: now - 4 * 3600000, updatedAt: now },
    ],
    loadingConfig: { rateVLSFO: 300, rateLSMGO: 150 },
    bargeTrackingReports: [{ id: "btr'1\"", fileName: X, path: 'x/y.pdf', dateFrom: iso(now - 7 * day), dateTo: iso(now), uploadedAt: now - 3600000, uploadedByRole: 'trader', uploadedByEmail: X }],
    fuelingInitiated: { nv1: { at: now, by: X } },
    bargeReloads: [{ id: 'rl1', bargeId: 1, v: 100, m: 10, at: now - day, by: X, note: X }],
    bakedSupplyIds: {}, version: 1000,
  };
  return { state, records, checklistRecords: state.checklistRecords, version: 1000 };
}

function localStore() {
  const now = Date.now();
  return {
    abps_trash_bin_v1: JSON.stringify([{ id: 9, trashedAt: now, def: { nomUid: 'tr1', name: X, imo: X, area: X, type: 'BOTH', qty: X, mgo: X, spec: X, agent: X, manifold: X, lc: X, eta: X, remarks: X, paq: 'no' } }]),
    flowops_fy_archive_v1: JSON.stringify({ [X]: { series: [{ month: 0, fo: 10, mgo: 1 }, { month: 1, fo: 20, mgo: 2 }], archivedAt: new Date().toISOString() } }),
  };
}

async function probe(page) {
  return page.evaluate(() => ({
    fired: window.__xss,
    imgs: document.querySelectorAll('img[src="x"]').length,
    where: [...document.querySelectorAll('img[src="x"]')].slice(0, 5).map(i => {
      let p = i.parentElement, chain = [];
      for (let k = 0; p && k < 5; k++, p = p.parentElement) chain.push(p.tagName + (p.id ? '#' + p.id : '') + (p.className && typeof p.className === 'string' ? '.' + p.className.split(' ')[0] : ''));
      return chain.join(' < ');
    }),
  }));
}

async function run(browser, uid) {
  const db = H.createDb({ workspace: workspace() });
  const app = await H.openApp(browser, db, { appDir, uid, localStorage: localStore() });
  const page = app.page;
  page.on('dialog', d => d.dismiss().catch(() => {}));
  await page.waitForTimeout(1200);
  const step = async (label, fn, arg) => {
    try { await page.evaluate(fn, arg); } catch (e) { app.errors.push(label + ': ' + e.message); }
    await page.waitForTimeout(150);
    const p = await probe(page);
    if (p.fired !== undefined || p.imgs) {
      ok(`[${uid}] ${label}: no injected markup`, false, p);
      // clear so later steps are judged on their own
      await page.evaluate(() => { document.querySelectorAll('img[src="x"]').forEach(i => i.remove()); delete window.__xss; });
      return false;
    }
    return true;
  };
  const tag = `[${uid}]`;

  // Generate a schedule from the poisoned nominations (operator only — traders
  // get the schedule through sync, so seed theirs from the operator's result).
  if (uid === 'user-operator') {
    await step('calculate()', () => { if (typeof calculate === 'function') calculate(); });
  } else {
    await step('trader calculate()', () => { try { if (typeof calculate === 'function') calculate(); } catch (e) {} });
  }

  // Every sidebar page.
  const pages = await page.evaluate(() => [...new Set([...document.querySelectorAll('[onclick*="showPage("]')]
    .map(el => (el.getAttribute('onclick').match(/showPage\('([^']+)'/) || [])[1]).filter(Boolean))]);
  for (const p of pages) await step('showPage(' + p + ')', (p) => showPage(p), p);

  // Renderers that only run when their page/tab is active, or on demand.
  const calls = [
    ['renderSavedRecords', () => renderSavedRecords()],
    ['renderChecklist', () => renderChecklist(_lastSched)],
    ['renderDeliveryLog (each month)', () => { const s = document.getElementById('dl-month-select'); renderDeliveryLog(); [...s.options].forEach(o => { s.value = o.value; renderDeliveryLog(); }); }],
    ['renderTrackRecordWatchlist', () => { if (typeof renderTrackRecordWatchlist === 'function') renderTrackRecordWatchlist(); }],
    ['vessel track-record banner', () => { document.querySelectorAll('[id$="-name"][id^="v"]').forEach(el => { const id = el.id.replace('-name', ''); renderVesselTrackRecordBanner(el.id, id + '-track-record'); }); }],
    ['renderArchivePanel + openArchiveWindow', () => { renderArchivePanel(); const y = Object.keys(_archives)[0]; openArchiveWindow(y, 'Jan'); }],
    ['close archive modal', () => { const m = document.getElementById('_archiveModal'); if (m) m.remove(); }],
    ['renderArchivedFYList + selector', () => { renderArchivedFYList(); _populateFYChartSelector(); }],
    ['renderTrashBin + banners', () => { renderTrashBin(); showTrashBanner(_trashBin[0] && _trashBin[0].def.name); showUndoBanner(_trashBin[0] && _trashBin[0].def.name); }],
    ['renderLoadingList/page', () => { renderLoadingPage && renderLoadingPage(); renderLoadingList(); _populateLoadingBargeSelect(); _refreshLoadingTerminalDatalist(); }],
    ['editLoadingRecord', () => { editLoadingRecord(_loadingRecords[0].id); }],
    ['loading conflict text', () => { const c = _checkLoadingConflict(_bargeConfig[0] && _bargeConfig[0].name, new Date(), new Date(Date.now() + 864e5), null); document.body.insertAdjacentText('beforeend', c.join('')); }],
    ['renderBargeTrackingReports + banner', () => { renderBargeTrackingReports(); _showTrackingReportBanner(_bargeTrackingReports); }],
    ['renderLiveROBDashboard', () => { renderLiveROBDashboard(); }],
    ['ROB history toggle', () => { (_bargeConfig || []).forEach(b => toggleROBHistory(b.id)); }],
    ['renderRemainingSupplyTracker', () => { renderRemainingSupplyTracker(); }],
    ['openROBEditor', () => { openROBEditor(_bargeConfig[0].id); }],
    ['openReloadModal', () => { document.getElementById('rob-editor-modal').style.display = 'none'; openReloadModal(_bargeConfig[0].id); }],
    ['renderWeekCalendar', () => { renderWeekCalendar(0); }],
    ['renderTimelineLoadingStrip', () => { renderTimelineLoadingStrip(); }],
    ['dashboard renderers', () => { renderActionQueue && renderActionQueue(); renderDashFuelingStatus(); renderDashFleetStatus(); renderDashActivity(); }],
    ['alerts renderers', () => { renderAlertsLiveROB && renderAlertsLiveROB(); renderAlertsReminders && renderAlertsReminders(); renderPAQReminders(_lastSched); renderScheduleReminders(); }],
    ['renderAgentDirectory + edit modal', () => { renderAgentDirectory(); openEditAgentModal(_agents[0].id); }],
    ['openEditRecord', () => { openEditRecord(_savedSupplies[0].id); }],
    ['openEditRecord (quoted id)', () => { closeEditRecord(); openEditRecord("r'3\""); }],
    ['close edit record', () => { closeEditRecord(); }],
    ['monthly report preview', () => { document.getElementById('report-month').value = new Date().getMonth(); document.getElementById('report-year').value = new Date().getFullYear(); renderMonthlyPreview(); }],
    ['refreshReports', () => { if (typeof refreshReports === 'function') refreshReports(); }],
    ['PDF report HTML', () => { const rows = _getAllReportRecords().map(r => ({ vessel: r.vessel, dateStr: r.dateStr, v: 1, m: 0, bdnV: r.bdnV, bdnM: r.bdnM, barge: r.barge, port: r.area })); document.body.insertAdjacentHTML('beforeend', '<div id="__pdfprobe" style="display:none">' + _flowReportPDFHTML({ rows, totV: 1, totM: 0, badge: 'x', metaLines: [] }) + '</div>'); }],
    ['availability check', () => { const n = document.getElementById('nsc-vessel-name') || document.querySelector('#page-availability input[type=text]'); if (n) n.value = document.querySelector('[id$="-name"][id^="v"]').value; checkNSCUnified(); }],
    ['bunker msg modal', () => { if (_lastSched[0]) openBunkerMsgModal(_lastSched[0].sno); }],
    ['print schedule', () => { document.querySelectorAll('.voy-print-chk').forEach(c => c.checked = true); printScheduleOnly(); }],
    ['calling instructions', () => { const id = document.querySelector('.vcard[id^="vessel-"]').id.replace('vessel-', ''); ciOpenForVessel(Number(id)); }],
    ['calling instructions preview', () => { try { ciOpenPreview(); } catch (e) {} }],
    ['email modal', () => { try { ciCloseModal(); } catch (e) {} const id = document.querySelector('.vcard[id^="vessel-"]').id.replace('vessel-', ''); emailOpenForVessel(Number(id)); }],
    ['renderOutput + command center', () => { if (_lastSched.length && typeof renderCommandCenter === 'function') renderCommandCenter(); }],
    ['global search', () => { const s = document.querySelector('#global-search, input[type=search]'); if (s) { s.value = 'img'; s.dispatchEvent(new Event('input', { bubbles: true })); } }],
  ];
  for (const [label, fn] of calls) await step(label, fn);
  for (const p of pages) await step('revisit ' + p, (p) => showPage(p), p);
  const sanity = await page.evaluate(() => ({ sched: _lastSched.length, sup: _savedSupplies.length, cl: Object.keys(_checklistRecords).length, trash: _trashBin.length, loads: _loadingRecords.length, fy: Object.keys(_fyArchives).length, audit: _robAuditLog.length, wl: ((document.getElementById('dash-track-record-watchlist') || {}).innerHTML || '').includes('&lt;img') }));
  ok(`${tag} seeded data present (schedule generated, records, trash, loadings, FY archive, audit log)`, sanity.sched >= 3 && sanity.sup >= 2 && sanity.wl && sanity.trash === 1 && sanity.loads === 2 && sanity.fy === 1 && sanity.audit >= 1, sanity);
  await page.waitForTimeout(600);
  const fin = await probe(page);
  ok(`${tag} window.__xss never set`, fin.fired === undefined, fin);
  ok(`${tag} no img[src=x] in document`, fin.imgs === 0, fin);
  const visible = await page.evaluate((X) => document.body.innerText.includes('<img src=x'), X);
  ok(`${tag} payload rendered as visible text somewhere (sanity: data really loaded)`, visible);
  const errs = realErrors(app);
  ok(`${tag} no page errors`, errs.length === 0, errs.slice(0, 8));
  await app.ctx.close();
}

(async () => {
  const browser = await H.launch();
  for (const uid of ['user-operator', 'user-trader']) await run(browser, uid);
  await browser.close();
  console.log(`XSS: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
