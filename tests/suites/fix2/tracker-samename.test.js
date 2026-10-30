/* Remaining Supply Tracker: a second call of the same vessel is its own row.
   • CMA CGM VITORIA twice — 1 Nov LSMGO on FNSA 11 and 18 Nov VLSFO on FNSA 10 — both rows,
     each under its own barge, with its own quantities (the table used to keep only the first)
   • a true duplicate (two checklist rows for ONE nomination) is still collapsed
   • legacy rows without a nomination id still dedupe by vessel name
   node suites/fix2/tracker-samename.test.js [appDir] */
const path = require('path');
if (process.argv[2]) process.env.APP_DIR = path.resolve(process.argv[2]);
const H = require(path.join(__dirname, '..', '..', 'harness', 'harness.js'));
const U = require(path.join(__dirname, '..', 'r3', 'util.js'));

let pass = 0, fail = 0;
function check(name, cond, info) {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 700)));
}
const VB = { imo: '9434905', area: 'FUJ-A', spec: 'ISO 8217:2017', agent: 'RAIS', manifold: 'VESSEL MANIFOLD', remarks: '', paq: 'no', refuelChk: false, rfv: 0, rfm: 0, rfvr: 750, rfmr: 275 };
const BARGE = { vcap: 5000, mcap: 1000, vbuf: 200, mbuf: 50, vtph: 300, mtph: 100, vrfr: 750, mrfr: 275 };
function seed() {
  const s = U.seedPayload({ vessels: [
    Object.assign({}, VB, { nomUid: 'nom_a', name: 'CMA CGM VITORIA', type: 'MGO', qty: 0, mgo: 100, eta: '01 Nov 2026 12:00', lc: '27-30 Oct 2026', bargeId: '2' }),
    Object.assign({}, VB, { nomUid: 'nom_b', name: 'CMA CGM VITORIA', type: 'VLSFO', qty: 1500, mgo: 0, eta: '18 Nov 2026 06:00', lc: '18 Nov 2026 - 12 Dec 2026', bargeId: '1' }),
    Object.assign({}, VB, { nomUid: 'nom_c', name: 'ERA S', type: 'VLSFO', qty: 500, mgo: 0, eta: '31 Oct 2026 08:00', lc: '30 Oct 2026 - 2 Nov 2026', bargeId: '2' }),
  ] });
  s.state.barges = [Object.assign({ id: 1, name: 'FNSA 10', vrob: 3229, mrob: 260 }, BARGE), Object.assign({ id: 2, name: 'FNSA 11', vrob: 4424, mrob: 486 }, BARGE)];
  return s;
}
// The tracker's rows: [barge, vessel, planned VLSFO text, planned LSMGO text]
const tracker = p => p.evaluate(() => {
  renderRemainingSupplyTracker();
  const out = [];
  document.querySelectorAll('#remaining-supply-tracker table, #remaining-supply-tracker .rst-table, [id^="rst-"] table').forEach(() => {});
  const host = document.getElementById('remaining-supply-tracker') || document.querySelector('[id*="remaining"]');
  const tables = Array.from((host || document).querySelectorAll('table'));
  tables.forEach(t => {
    const barge = ((t.closest('div') && t.closest('div').textContent) || '').match(/FNSA 1[01]/);
    Array.from(t.querySelectorAll('tbody tr')).forEach(tr => {
      const cells = Array.from(tr.children).map(td => td.textContent.replace(/\s+/g, ' ').trim());
      if (cells.some(c => /VITORIA|ERA S/.test(c))) out.push(cells);
    });
  });
  return out;
});

(async () => {
  const browser = await H.launch();
  const db = H.createDb({ workspace: seed(), realtime: false });
  const A = await U.open(browser, db, 'user-operator'); await U.helpers(A);
  await A.page.evaluate(() => { window.alert = () => {}; });
  const errsBefore = U.realErrors(A).length;
  await A.page.evaluate(async () => { calculate(); await _waitForSaveIdle(); showPage('checklist'); });
  const r = await A.page.evaluate(() => {
    renderRemainingSupplyTracker();
    // Rows of the tracker as rendered: look for each vessel's row and the barge heading above it.
    const text = (document.getElementById('remaining-supply-tracker') || document.body).innerText;
    const rowsFor = v => (text.match(new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    return { vitoria: rowsFor('CMA CGM VITORIA'), eras: rowsFor('ERA S'), has18Nov: /18 Nov 2026/.test(text), has1Nov: /01 Nov 2026/.test(text), keys: Object.keys(_checklistRecords) };
  });
  check('T1 two calls of CMA CGM VITORIA (different nominations): both rows in the tracker, 1 Nov and 18 Nov', r.vitoria >= 2 && r.has18Nov && r.has1Nov, r);
  // Each under its own barge: the 18 Nov row's VLSFO planned appears in the FNSA 10 block.
  const blocks = await A.page.evaluate(() => {
    const host = document.getElementById('remaining-supply-tracker') || document.body;
    const t = host.innerText; const i10 = t.indexOf('FNSA 10'), i11 = t.indexOf('FNSA 11');
    const b10 = i10 >= 0 && i11 > i10 ? t.slice(i10, i11) : (i10 >= 0 ? t.slice(i10) : ''), b11 = i11 >= 0 ? t.slice(i11, i10 > i11 ? i10 : undefined) : '';
    return { b10has18: /VITORIA[\s\S]*18 Nov 2026/.test(b10) || /18 Nov 2026/.test(b10), b11has1: /01 Nov 2026/.test(b11), b10: b10.slice(0, 200), b11: b11.slice(0, 200) };
  });
  check('T1 …the 18 Nov call under FNSA 10, the 1 Nov call under FNSA 11', blocks.b10has18 && blocks.b11has1, blocks);
  // A true duplicate (two rows for ONE nomination) is still collapsed.
  const dup = await A.page.evaluate(() => {
    const src = _checklistRecords['n_nom_b']; _checklistRecords['n_nom_b__dup'] = Object.assign({}, src, { uid: 'n_nom_b__dup', sno: 99 });
    renderRemainingSupplyTracker();
    const text = (document.getElementById('remaining-supply-tracker') || document.body).innerText;
    const n = (text.match(/18 Nov 2026/g) || []).length;
    delete _checklistRecords['n_nom_b__dup']; renderRemainingSupplyTracker();
    return n;
  });
  check('T2 two checklist rows for ONE nomination still show as one row', dup === 1, dup);
  // Legacy rows without a nomination id: still one row per vessel name.
  const legacy = await A.page.evaluate(() => {
    const a = Object.assign({}, _checklistRecords['n_nom_c'], { uid: 'v_era_s', nomUid: null, sno: 50 }), b = Object.assign({}, a, { uid: 'v_era_s_2', sno: 51 });
    _checklistRecords['v_era_s'] = a; _checklistRecords['v_era_s_2'] = b; delete _checklistRecords['n_nom_c'];
    renderRemainingSupplyTracker();
    const text = (document.getElementById('remaining-supply-tracker') || document.body).innerText;
    const n = (text.match(/ERA S/g) || []).length;
    delete _checklistRecords['v_era_s']; delete _checklistRecords['v_era_s_2']; _checklistRecords['n_nom_c'] = Object.assign({}, a, { uid: 'n_nom_c', nomUid: 'nom_c' });
    return n;
  });
  check('T3 legacy rows (no nomination id) of one vessel still collapse to one row', legacy === 1, legacy);
  check('no page errors', U.realErrors(A).length === errsBefore, U.realErrors(A).slice(0, 3));
  await A.ctx.close();
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
