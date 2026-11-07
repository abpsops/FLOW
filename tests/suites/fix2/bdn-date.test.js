/* BDN date — the date on the Bunker Delivery Note, per grade, picked from a calendar (no time).
   • Checklist: a date box next to each BDN No. (VLSFO / LSMGO), saved with the supply
   • Saved Records: shown on the record; Edit has both dates, the Change Summary lists them,
     saving updates the checklist row too; a date can be cleared
   • Monthly Report (Excel + PDF): "BDN Date (VLSFO)" / "BDN Date (LSMGO)" columns instead of
     the supply date and time; not entered yet → the supply day (no time) marked *, with a note;
     nothing for a grade not supplied; the month a supply counts in is unchanged
   • the archive PDF keeps its Date column; synced to another device
   node suites/fix2/bdn-date.test.js [appDir] */
const path = require('path');
if (process.argv[2]) process.env.APP_DIR = path.resolve(process.argv[2]);
const U = require('../r3/util.js');
const H = U.H;

let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) pass++; else fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 900)));
}
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const eta = h => { const d = new Date(Date.now() + h * 3600000); const p = n => String(n).padStart(2, '0'); return `${p(d.getDate())} ${MO[d.getMonth()]} ${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const VB = { imo: '', area: 'FUJ-A', spec: 'ISO 8217:2010', agent: 'AG', manifold: 'VESSEL MANIFOLD', remarks: '', lc: '', paq: 'no', bargeId: '1', refuelChk: false, rfv: 0, rfm: 0, rfvr: 750, rfmr: 275 };
const ALPHA = Object.assign({}, VB, { nomUid: 'n1', name: 'ALPHA', type: 'BOTH', qty: 100, mgo: 40, eta: eta(3) });
const T1 = U.thisMonthIso(300), T2 = U.thisMonthIso(200);
const R1 = { id: 'r1', checklistUid: 'c1', nomUid: 'nv', vessel: 'VITORIA', areaCode: 'FUJ-A', area: 'FUJ A', dateStr: 'x', supplyDate: T1, vlsfoAct: 697.5, mgoAct: 120, bdnV: 'BDN-1', bdnM: 'BDN-2', bdnDateV: '2026-10-30', bdnDateM: '2026-10-31', barge: 'Barge 1', supplied: true, savedAt: T1 };
const R2 = { id: 'r2', checklistUid: 'c2', vessel: 'DAISY', areaCode: 'FUJ-A', area: 'FUJ A', dateStr: 'x', supplyDate: T2, vlsfoAct: 0, mgoAct: 449, bdnV: '', bdnM: 'M/77', barge: 'Barge 1', supplied: true, savedAt: T2 };
const seed = (vessels, records) => { const s = U.seedPayload({ vessels: vessels || [] }); s.state.bakedSupplyIds = {}; if (records) s.records = records; return s; };

async function scenario(browser, name, fn) {
  const apps = [];
  try {
    await fn(async (db, uid) => {
      const a = await U.open(browser, db, uid || 'user-operator'); await U.helpers(a);
      await a.page.evaluate(() => { window.__dialogs = []; window.alert = m => window.__dialogs.push('alert:' + m); window.confirm = m => { window.__dialogs.push('confirm:' + m); return true; }; try { flowWelcomeGo('dashboard'); } catch (e) {} });
      apps.push(a); return a;
    });
  } catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
  const errs = [].concat(...apps.map(a => U.realErrors(a)));
  check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
  for (const a of apps) await a.ctx.close();
}

(async () => {
  const browser = await H.launch();

  await scenario(browser, 'B1 checklist', async (openT) => {
    const db = H.createDb({ workspace: seed([ALPHA]), realtime: false });
    const A = await openT(db);
    const ui = await A.page.evaluate(async () => {
      calculate(); await _waitForSaveIdle(); showPage('checklist');
      const v = document.getElementById('cl-bdv-n_n1'), m = document.getElementById('cl-bdm-n_n1');
      return { v: v && v.type, m: m && m.type, enabled: v && !v.disabled && m && !m.disabled, head: [...document.querySelectorAll('.cl-tbl thead th')].map(t => t.textContent.trim()) };
    });
    check('B1 the checklist has a calendar date box (no time) next to each BDN No.', ui.v === 'date' && ui.m === 'date' && ui.enabled && ui.head.includes('BDN No. / BDN date'), ui);
    const s = await A.page.evaluate(async () => {
      document.getElementById('cl-av-n_n1').value = '99'; document.getElementById('cl-am-n_n1').value = '40';
      document.getElementById('cl-bv-n_n1').value = 'BDN-V1'; document.getElementById('cl-bm-n_n1').value = 'BDN-M1';
      const v = document.getElementById('cl-bdv-n_n1'); v.value = '2026-11-04'; v.dispatchEvent(new Event('change'));
      const m = document.getElementById('cl-bdm-n_n1'); m.value = '2026-11-05'; m.dispatchEvent(new Event('change'));
      const mem = [_checklistRecords.n_n1.bdnDateV, _checklistRecords.n_n1.bdnDateM];
      await saveChecklistRecord('n_n1'); await _waitForSaveIdle();
      const r = _savedSupplies.find(x => x.nomUid === 'n1');
      showPage('records');
      const row = [...document.querySelectorAll('.saved-record-row')].find(e => /ALPHA/.test(e.textContent));
      return { mem, rec: r && [r.bdnDateV, r.bdnDateM, r.bdnV], line: row && (row.querySelector('.saved-record-bdn-date') || {}).textContent };
    });
    const cr = (U.row(db).payload.records || []).find(r => r.nomUid === 'n1');
    check('B1 the dates are kept on the row as they are picked, and saved with the supply (also in the cloud)', JSON.stringify(s.mem) === '["2026-11-04","2026-11-05"]' && JSON.stringify(s.rec) === '["2026-11-04","2026-11-05","BDN-V1"]' && cr && cr.bdnDateV === '2026-11-04' && cr.bdnDateM === '2026-11-05', { s, cr: cr && [cr.bdnDateV, cr.bdnDateM] });
    check('B1 Saved Records shows "BDN date: VLSFO 04 Nov 2026 | LSMGO 05 Nov 2026"', /BDN date: VLSFO 04 Nov 2026\s*\|\s*LSMGO 05 Nov 2026/.test(s.line || ''), s.line);
  });

  await scenario(browser, 'B2 edit', async (openT) => {
    const s0 = seed([], [R1, R2]);
    const db = H.createDb({ workspace: s0, realtime: false });
    const A = await openT(db);
    // completed checklist rows live only on the device that saved them (not synced): put one there
    await A.page.evaluate(cl => { _checklistRecords.c1 = cl; }, { uid: 'c1', nomUid: 'nv', vessel: 'VITORIA', state: 'completed', lockedAt: T1, supplied: true, nomV: 700, nomM: 120, actV: 697.5, actM: 120, bdnV: 'BDN-1', bdnM: 'BDN-2', bdnDateV: '2026-10-30', bdnDateM: '2026-10-31' });
    const f = await A.page.evaluate(() => {
      showPage('records'); openEditRecord('r1');
      const v = document.getElementById('er-bdn-date-v'), m = document.getElementById('er-bdn-date-m');
      const before = [v.type, v.value, m.value];
      v.value = '2026-11-01'; v.dispatchEvent(new Event('change')); m.value = ''; m.dispatchEvent(new Event('change'));
      return { before, diff: document.getElementById('er-diff-rows').textContent };
    });
    check('B2 Edit shows both BDN dates in calendar boxes', JSON.stringify(f.before) === '["date","2026-10-30","2026-10-31"]', f);
    check('B2 the Change Summary lists the BDN date changes (one changed, one cleared)', /BDN date \(VLSFO\): 30 Oct 2026 → 01 Nov 2026/.test(f.diff) && /BDN date \(LSMGO\): 31 Oct 2026 → —/.test(f.diff), f.diff);
    const r = await A.page.evaluate(async () => { await saveEditRecord(); await _waitForSaveIdle(); const x = _savedSupplies.find(y => y.id === 'r1'); return { rec: [x.bdnDateV, x.bdnDateM, x.mgoAct, x.bdnM], cl: [_checklistRecords.c1.bdnDateV, _checklistRecords.c1.bdnDateM] }; });
    const cr = U.row(db).payload.records.find(x => x.id === 'r1');
    check('B2 saved: the record (and the checklist row it came from) has the new date, the cleared one is empty, nothing else changed', JSON.stringify(r.rec) === '["2026-11-01","",120,"BDN-2"]' && JSON.stringify(r.cl) === '["2026-11-01",""]' && cr.bdnDateV === '2026-11-01' && cr.bdnDateM === '', { r, cr: [cr.bdnDateV, cr.bdnDateM] });
    const B = await openT(db, 'user-operator2');
    const b = await B.page.evaluate(() => { const x = _savedSupplies.find(y => y.id === 'r1'); return [x.bdnDateV, x.bdnDateM]; });
    check('B2 another device gets the BDN dates', JSON.stringify(b) === '["2026-11-01",""]', b);
  });

  await scenario(browser, 'B3 monthly report', async (openT) => {
    const db = H.createDb({ workspace: seed([], [R1, R2]), realtime: false });
    const A = await openT(db);
    const xl = await A.page.evaluate(async () => {
      const d = _parseDateLocal(_savedSupplies[0].supplyDate);
      showPage('reports'); try { openMonthlyReport(); } catch (e) {}
      setReportMode('month'); document.getElementById('report-month').value = String(d.getMonth()); document.getElementById('report-year').value = String(d.getFullYear());
      let got = null, name = ''; const orig = _flowSaveOrShareBlob; _flowSaveOrShareBlob = async (b, n) => { got = b; name = n; };
      try { await downloadMonthlyReport(null); } finally { _flowSaveOrShareBlob = orig; }
      const wb = new (await _loadExcelJS()).Workbook(); await wb.xlsx.load(await got.arrayBuffer());
      const ws = wb.getWorksheet('Supply Report'); const rows = [];
      ws.eachRow(r => rows.push(r.values.slice(1).map(v => v == null ? '' : String(v))));
      const day = _dealDateStr(_localDateInputStr(_parseDateLocal(_savedSupplies.find(x => x.id === 'r2').supplyDate)));
      return { name, rows, day, dialogs: window.__dialogs.slice() };
    });
    const flat = xl.rows.map(r => r.join(' | ')).join('\n');
    const head = xl.rows.find(r => r[0] === 'S.No.') || [];
    check('B3 Excel: "BDN Date" columns per grade instead of "Date of Supply"', head.join('|') === 'S.No.|Vessel Name|VLSFO Qty (MT)|BDN No. (VLSFO)|BDN Date (VLSFO)|MGO Qty (MT)|BDN No. (LSMGO)|BDN Date (LSMGO)|Barge' && !/Date of Supply/.test(flat), { head, dialogs: xl.dialogs });
    check('B3 Excel: entered BDN dates shown (date only, no time)', /1 \| VITORIA \| 697\.5 \| BDN-1 \| 30 Oct 2026 \| 120 \| BDN-2 \| 31 Oct 2026 \| Barge 1/.test(flat), flat.slice(0, 900));
    check('B3 Excel: not entered → the supply day marked *, nothing for the grade not supplied, and the note', flat.includes('2 | DAISY | 0 |  |  | 449 | M/77 | ' + xl.day + ' * | Barge 1') && /\* BDN date not entered yet — the supply date is shown\./.test(flat) && !/\d\d:\d\d/.test(xl.rows.slice(xl.rows.indexOf(head) + 1).map(r => r.join(' ')).join(' ')), { day: xl.day, flat: flat.slice(0, 1200) });
    check('B3 Excel: totals unchanged (VLSFO 697.5, MGO 569)', /\| TOTAL \| 697\.5 \|  \|  \| 569 \|/.test(flat), flat.slice(-400));
    const pdf = await A.page.evaluate(async () => {
      let html = ''; const orig = _flowExportReportPDF; _flowExportReportPDF = async h => { html = h; };
      try { await downloadMonthlyReportPDF(null); } finally { _flowExportReportPDF = orig; }
      const box = document.createElement('div'); box.innerHTML = html; document.body.appendChild(box);
      const out = { head: [...box.querySelectorAll('thead th')].map(t => t.textContent), rows: [...box.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent)), note: box.textContent.includes('* BDN date not entered yet') };
      box.remove();
      const arch = _flowReportPDFHTML({ rows: [{ vessel: 'X', dateStr: '01 Nov 2026 10:00', v: 1, m: 0, barge: 'B', port: 'P' }], totV: 1, totM: 0, badge: 'b', metaLines: [] });
      out.archHasDate = /<th>Date<\/th>/.test(arch) && !/BDN date/.test(arch);
      return out;
    });
    check('B3 PDF: BDN date columns instead of Date, the dates and the * note', JSON.stringify(pdf.head) === JSON.stringify(['S.No.', 'Vessel', 'VLSFO (MT)', 'BDN (VLSFO)', 'BDN date', 'MGO (MT)', 'BDN (LSMGO)', 'BDN date', 'Barge', 'Port']) && pdf.rows[0][4] === '30 Oct 2026' && pdf.rows[0][7] === '31 Oct 2026' && pdf.rows[1][4] === '' && / \*$/.test(pdf.rows[1][7]) && pdf.note, pdf);
    check('B3 the archive PDF keeps its Date column', pdf.archHasDate, pdf.archHasDate);
  });

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
