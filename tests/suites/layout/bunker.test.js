/* node bunker.test.js <appDir> — the dashboard's inline "View in Schedule"
   handlers pass sno as a STRING; the Bunker Message modal must still open. */
const H = require('../../harness/harness.js');
const appDir = process.argv[2] || H.APP_DIR;
function workspace() {
  const T = Date.now();
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const etaStr = (h) => { const d = new Date(T + h * 3600000); return String(d.getDate()).padStart(2, '0') + ' ' + M[d.getMonth()] + ' ' + d.getFullYear() + ' ' + String(d.getHours()).padStart(2, '0') + ':00'; };
  const v = (i, name, area, h) => ({ nomUid: 'nv' + i, name, imo: String(9300000 + i), area, type: 'VLSFO', qty: 500, mgo: 0, spec: 'ISO 8217:2010', agent: 'GAC', manifold: '', remarks: '', lc: '', eta: etaStr(h), paq: 'yes', bargeId: '', refuelChk: false, rfv: 0, rfm: 0, rfvr: 750, rfmr: 275 });
  return { state: {
    barges: [{ id: 1, name: 'Barge Alpha', vcap: 5000, mcap: 1000, vrob: 4000, mrob: 800, vbuf: 500, mbuf: 150, vtph: 300, mtph: 100, vrfr: 750, mrfr: 275 }],
    vessels: [v(0, 'ALPHA ONE', 'FUJ-A', 6), v(1, 'BRAVO TWO', 'KFK-A', 12)],
    checklist: {}, manualROB: {}, robAuditLog: [], calcParams: { hoseHrs: 6, travelHrs: 1 }, lastSched: [], checklistRecords: {},
    agents: [], archives: {}, deliveryLog: {}, loadingRecords: [], loadingConfig: { rateVLSFO: 300, rateLSMGO: 150 },
    bargeTrackingReports: [], fuelingInitiated: {}, bargeReloads: [], bakedSupplyIds: {}, version: 10,
  }, records: [], checklistRecords: {}, version: 10 };
}
(async () => {
  const browser = await H.launch();
  const app = await H.openApp(browser, H.createDb({ workspace: workspace() }), { appDir, uid: 'user-operator' });
  const p = app.page;
  await p.evaluate(() => { try { flowWelcomeGo(); } catch (e) {} calculate(); });
  await p.waitForTimeout(500);
  const opened = await p.evaluate(() => {
    if (!_lastSched || !_lastSched.length) return 'no-schedule';
    _globalSearchGoSchedule(String(_lastSched[1].sno)); // exactly what the inline handlers pass
    return 'called:' + _lastSched[1].name;
  });
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => [getComputedStyle(document.getElementById('bunker-msg-modal')).display, (document.getElementById('bm-vessel-name') || {}).textContent]);
  const errs = app.errors.filter(e => !/capacitorExports/.test(e));
  console.log(opened, '| modal display:', r[0], '| vessel:', r[1], '| errors:', errs.length);
  await browser.close();
  const ok = r[0] === 'flex' && opened.endsWith(r[1]) && errs.length === 0;
  console.log(ok ? 'BUNKER: PASS' : 'BUNKER: FAIL');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
