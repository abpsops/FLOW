/* node space.test.js <appDir> <shotPrefix>
   1) Sidebar reaches the bottom of the window after scrolling (no gap) and
      its first item stays visible below the header.
   2) Operational Activity feed fills its card (no blank gap under the list). */
const H = require('../../harness/harness.js');
const appDir = process.argv[2] || H.APP_DIR, shot = process.argv[3];
function workspace() {
  const T = Date.now();
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const etaStr = (h) => { const d = new Date(T + h * 3600000); return String(d.getDate()).padStart(2, '0') + ' ' + M[d.getMonth()] + ' ' + d.getFullYear() + ' ' + String(d.getHours()).padStart(2, '0') + ':00'; };
  const v = (i, h) => ({ nomUid: 'nv' + i, name: 'VESSEL ' + i, imo: String(9300000 + i), area: i % 2 ? 'FUJ-A' : 'KFK-A', type: 'VLSFO', qty: 400 + i * 50, mgo: 0, spec: 'ISO 8217:2010', agent: 'GAC', manifold: '', remarks: '', lc: '', eta: etaStr(h), paq: 'yes', bargeId: '', refuelChk: false, rfv: 0, rfm: 0, rfvr: 750, rfmr: 275 });
  const recs = []; for (let i = 0; i < 12; i++) recs.push({ id: 'r' + i, vessel: 'DONE ' + i, supplied: true, supplyDate: new Date(T - (i + 1) * 5 * 3600000).toISOString(), savedAt: new Date(T - (i + 1) * 5 * 3600000).toISOString(), vlsfoAct: 500 + i, lsmgoAct: 0, barge: 'Barge Alpha' });
  return { state: {
    barges: [{ id: 1, name: 'Barge Alpha', vcap: 5000, mcap: 1000, vrob: 4000, mrob: 800, vbuf: 500, mbuf: 150, vtph: 300, mtph: 100, vrfr: 750, mrfr: 275 }, { id: 2, name: 'Barge Bravo', vcap: 5000, mcap: 1000, vrob: 4000, mrob: 800, vbuf: 500, mbuf: 150, vtph: 300, mtph: 100, vrfr: 750, mrfr: 275 }],
    vessels: [v(0, 6), v(1, 12), v(2, 20), v(3, 30), v(4, 40), v(5, 52), v(6, 64), v(7, 80)],
    checklist: {}, manualROB: {}, robAuditLog: [], calcParams: { hoseHrs: 6, travelHrs: 1 }, lastSched: [], checklistRecords: {},
    agents: [], archives: {}, deliveryLog: {}, loadingRecords: [], loadingConfig: { rateVLSFO: 300, rateLSMGO: 150 },
    bargeTrackingReports: [], fuelingInitiated: {}, bargeReloads: [], bakedSupplyIds: {}, version: 10,
  }, records: recs, checklistRecords: {}, version: 10 };
}
(async () => {
  const browser = await H.launch();
  let fail = 0;
  // The Glass look was removed — only Harbour Light and Classic remain.
  for (const skin of ['harbour', 'classic']) {
    const app = await H.openApp(browser, H.createDb({ workspace: workspace() }), { appDir, uid: 'user-operator', viewport: { width: 1920, height: 1040 }, localStorage: { 'flow-skin': skin } });
    const p = app.page;
    await p.evaluate(() => { try { flowWelcomeGo(); } catch (e) {} calculate(); showPage('dashboard'); try { refreshDashboard(); } catch (e) {} });
    await p.waitForTimeout(800);
    await p.evaluate(() => window.scrollTo(0, 900));
    await p.waitForTimeout(300);
    const r = await p.evaluate(() => {
      const sb = document.querySelector('.sidebar').getBoundingClientRect();
      const hh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 0;
      const feed = document.getElementById('dash-activity-feed');
      const card = feed.closest('.chart-card');
      const fr = feed.getBoundingClientRect(), cr = card.getBoundingClientRect();
      const title = card.querySelector('.chart-title').getBoundingClientRect();
      return { winH: innerHeight, hh, sbTop: Math.round(sb.top), sbBottom: Math.round(sb.bottom), cardH: Math.round(cr.height), feedBottomGap: Math.round(cr.bottom - fr.bottom), items: feed.children.length, scrollable: feed.scrollHeight > feed.clientHeight };
    });
    const sbOk = Math.abs(r.sbBottom - r.winH) <= 2 && Math.abs(r.sbTop - r.hh) <= 2;
    const feedOk = r.feedBottomGap <= 40; // only the card's own padding below the list
    console.log(skin, JSON.stringify(r), 'sidebar:', sbOk ? 'OK' : 'GAP', 'feed:', feedOk ? 'OK' : 'GAP');
    if (!sbOk || !feedOk) fail++;
    if (shot) {
      await p.screenshot({ path: shot + '-' + skin + '-scrolled.png' });
      await p.evaluate(() => { const c = document.getElementById('dash-activity-feed').closest('.chart-card'); c.scrollIntoView({ block: 'center' }); });
      await p.waitForTimeout(200);
      await p.screenshot({ path: shot + '-' + skin + '-activity.png' });
    }
    const errs = app.errors.filter(e => !/capacitorExports/.test(e));
    if (errs.length) { fail++; console.log('errors', errs); }
    await app.ctx.close();
  }
  await browser.close();
  console.log(fail ? 'SPACE: FAIL' : 'SPACE: PASS');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
