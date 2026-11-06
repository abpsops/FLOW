/* Monthly loading report (Loading page → Monthly loading report → ⬇ Excel / ⬇ PDF).
   • counts completed loadings whose BL date is in the chosen month, at the BL quantity
     (planned until a BL figure is entered, marked *); older loadings without a BL date
     use the day they were marked Completed (marked *)
   • supplier = the linked deal's supplier, else the terminal "(no deal)"
   • totals per supplier and per date, every lifting, the month's still-scheduled loadings
   • barge transfers, deleted loadings and other months are left out
   • summary line under the month picker; bad month refused; hostile names stay text
   node suites/fix2/loading-report.test.js [appDir] */
const path = require('path');
if (process.argv[2]) process.env.APP_DIR = path.resolve(process.argv[2]);
const H = require(path.join(__dirname, '..', '..', 'harness', 'harness.js'));
const U = require(path.join(__dirname, '..', 'r3', 'util.js'));

let pass = 0, fail = 0;
function check(name, cond, info) {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 900)));
}
const NOW = Date.now();
const at = (d, h) => new Date(Date.UTC(2026, 9, d, h || 8)).toISOString(); // October 2026
const ld = (id, extra) => Object.assign({ id, barge: 'FNSA 11', grade: 'VLSFO', terminal: 'VOPAK TERMINAL', qty: 4000, startAt: at(1), endAt: at(1, 18), preOpsHours: 2.5, postOpsHours: 3.5, pumpHours: 5, estimatedHours: 11, endOverridden: false, updatedAt: NOW }, extra || {});
function seed() {
  const s = U.seedPayload({ vessels: [] });
  s.state.barges = [{ id: 1, name: 'FNSA 10', vrob: 3000, mrob: 300, vcap: 5000, mcap: 1000, vbuf: 200, mbuf: 50, vtph: 300, mtph: 100 }, { id: 2, name: 'FNSA 11', vrob: 400, mrob: 400, vcap: 5000, mcap: 1000, vbuf: 200, mbuf: 50, vtph: 250, mtph: 100 }];
  s.state.loadingDeals = [
    { id: 'deal_1', supplier: 'ARAMCO', terminal: 'VOPAK TERMINAL', grade: 'VLSFO', qty: 45000, date: '2026-09-20', ref: 'CTR-77', status: 'open', createdAt: 1, updatedAt: 1 },
    { id: 'deal_2', supplier: 'BP <i>x</i>', terminal: 'FOTT', grade: 'LSMGO', qty: 5000, date: '2026-09-25', ref: '', status: 'open', createdAt: 1, updatedAt: 1 },
  ];
  s.state.loadingRecords = [
    ld('l1', { dealId: 'deal_1', completed: true, completedAt: Date.parse(at(3, 12)), blQty: 3990.5, blDate: '2026-10-03' }),
    ld('l2', { dealId: 'deal_1', barge: 'FNSA 10', qty: 2100, completed: true, completedAt: Date.parse(at(3, 14)), blQty: 2000, blDate: '2026-10-03' }),
    ld('l3', { dealId: 'deal_2', grade: 'LSMGO', terminal: 'FOTT', qty: 500, completed: true, completedAt: Date.parse(at(15, 10)), blQty: 500, blDate: '2026-10-15' }),
    ld('l4', { terminal: 'GPS', qty: 1200, completed: true, completedAt: Date.parse(at(20, 10)), blDate: '2026-10-20' }),          // no deal, no BL qty → *
    ld('l6', { qty: 800, completed: true, completedAt: Date.parse(at(25, 10)) }),                                                 // no BL date → completion day *
    ld('l5', { dealId: 'deal_1', completed: true, completedAt: Date.parse('2026-11-02T08:00:00Z'), blQty: 3000, blDate: '2026-11-02' }), // November
    ld('l8', { completed: true, completedAt: Date.parse(at(10, 10)), blQty: 999, blDate: '2026-10-10', deletedAt: NOW }),        // deleted
    ld('x1', { kind: 'transfer', fromBarge: 'FNSA 10', terminal: '', qty: 700, completed: true, completedAt: Date.parse(at(12, 10)) }), // transfer
    ld('l7', { dealId: 'deal_1', qty: 3500, startAt: at(28), endAt: at(28, 20) }),                                                // scheduled, not done
  ];
  return s;
}

(async () => {
  const browser = await H.launch();
  const scenario = async (name, fn) => {
    if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return;
    console.log('— ' + name);
    const apps = [];
    try { await fn(async (db, uid) => { const a = await U.open(browser, db, uid); await U.helpers(a); await a.page.evaluate(() => { window.__alerts = []; window.alert = m => window.__alerts.push(String(m)); window.confirm = () => true; }); apps.push(a); return a; }); }
    catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
    const errs = [].concat(...apps.map(a => U.realErrors(a)));
    check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
    for (const a of apps) await a.ctx.close();
  };

  await scenario('M1 data and summary', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db, 'user-operator');
    const d = await A.page.evaluate(() => {
      showPage('loading');
      const m = document.getElementById('ld-rep-month');
      const def = m.value;
      m.value = '2026-10'; m.dispatchEvent(new Event('change'));
      const R = _ldMonthReportData('2026-10');
      return { def, now: _localDateInputStr(new Date()).slice(0, 7), summary: document.getElementById('ld-rep-summary').textContent,
        btns: [...document.querySelectorAll('#ld-report-card button')].map(b => b.textContent.trim()),
        ids: R.lifted.map(x => x.rec.id), tot: R.tot, sup: R.bySupplier.map(g => [g.key, g.liftings, g.v, g.m]), days: R.byDate.map(g => [g.key, g.liftings, g.v, g.m]),
        stars: R.lifted.filter(x => !x.dateEntered || !x.blEntered).map(x => x.rec.id), sched: R.scheduled.map(x => [x.supplier, x.planned]), file: R.file };
    });
    check('M1 the card shows the current month by default, with ⬇ Excel and ⬇ PDF', d.def === d.now && d.btns.includes('⬇ Excel') && d.btns.includes('⬇ PDF'), d);
    check('M1 October counts the 5 completed loadings by BL date — not November, a deleted one or a barge transfer', JSON.stringify(d.ids) === JSON.stringify(['l1', 'l2', 'l3', 'l4', 'l6']) && d.tot.liftings === 5 && d.tot.v === 7990.5 && d.tot.m === 500, d);
    check('M1 per supplier: deal supplier, else terminal "(no deal)", largest first', JSON.stringify(d.sup) === JSON.stringify([['ARAMCO', 2, 5990.5, 0], ['GPS (no deal)', 1, 1200, 0], ['VOPAK TERMINAL (no deal)', 1, 800, 0], ['BP <i>x</i>', 1, 0, 500]]), d.sup);
    check('M1 per date (BL date): 03 Oct 2 liftings 5,990.5 · 15 Oct 500 LSMGO · 20 Oct 1,200 · 25 Oct 800 (completion day)', JSON.stringify(d.days) === JSON.stringify([['2026-10-03', 2, 5990.5, 0], ['2026-10-15', 1, 0, 500], ['2026-10-20', 1, 1200, 0], ['2026-10-25', 1, 800, 0]]), d.days);
    check('M1 no BL qty / no BL date are marked; the month\'s scheduled loading is listed separately', JSON.stringify(d.stars) === JSON.stringify(['l4', 'l6']) && JSON.stringify(d.sched) === JSON.stringify([['ARAMCO', 3500]]) && d.file === 'FLOW_Loading_Report_2026-10', d);
    check('M1 summary line under the picker', /^October 2026: 5 liftings · VLSFO 7,990\.5 MT · LSMGO 500 MT · 4 suppliers · 1 still scheduled$/.test(d.summary), d.summary);
    const e = await A.page.evaluate(() => {
      const m = document.getElementById('ld-rep-month'); m.value = '2025-02'; m.dispatchEvent(new Event('change'));
      const empty = document.getElementById('ld-rep-summary').textContent;
      m.type = 'text'; m.value = 'Oct'; let saved = 0; const o = _flowSaveOrShareBlob; _flowSaveOrShareBlob = async () => { saved++; };
      loadingMonthReportExcel(null); _flowSaveOrShareBlob = o; m.type = 'month';
      return { empty, alerts: window.__alerts.slice(), saved };
    });
    check('M1 an empty month says so; a bad month is refused with a message', /^February 2025: no completed loading yet\.$/.test(e.empty) && e.alerts.some(a => /Pick a month/.test(a)) && e.saved === 0, e);
    const live = await A.page.evaluate(async () => {
      const m = document.getElementById('ld-rep-month'); m.value = '2026-10'; m.dispatchEvent(new Event('change'));
      completeLoadingPrompt('l7'); document.getElementById('bl-date').value = '2026-10-29'; document.getElementById('bl-qty').value = '3480'; blConfirm(); await _waitForSaveIdle();
      return document.getElementById('ld-rep-summary').textContent;
    });
    check('M1 completing a loading updates the summary at once (6 liftings, VLSFO 11,470.5)', /6 liftings · VLSFO 11,470\.5 MT/.test(live) && !/still scheduled/.test(live), live);
  });

  await scenario('M2 Excel and PDF', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db, 'user-operator');
    const xl = await A.page.evaluate(async () => {
      showPage('loading'); document.getElementById('ld-rep-month').value = '2026-10';
      let got = null, name = '';
      const orig = _flowSaveOrShareBlob; _flowSaveOrShareBlob = async (b, n) => { got = b; name = n; };
      try { await loadingMonthReportExcel(null); } finally { _flowSaveOrShareBlob = orig; }
      const wb = new (await _loadExcelJS()).Workbook(); await wb.xlsx.load(await got.arrayBuffer());
      const ws = wb.getWorksheet('Loading report'); const rows = [];
      ws.eachRow(r => rows.push(r.values.slice(1).map(v => v == null ? '' : String(v))));
      return { name, rows, alerts: window.__alerts.slice() };
    });
    const flat = xl.rows.map(r => r.join(' | ')).join('\n');
    check('M2 Excel file FLOW_Loading_Report_2026-10.xlsx with title and month total (5 liftings, 7,990.5 + 500)', xl.name === 'FLOW_Loading_Report_2026-10.xlsx' && /Monthly loading report — October 2026/.test(flat) && /\| 5 \| 7990\.5 \| 500 \| 8490\.5/.test(flat), { name: xl.name, alerts: xl.alerts, flat: flat.slice(0, 800) });
    check('M2 Excel: by supplier with a total row', /1 \| ARAMCO \| 2 \| 5990\.5 \| 0 \| 5990\.5/.test(flat) && /4 \| BP <i>x<\/i> \| 1 \| 0 \| 500 \| 500/.test(flat) && /GPS \(no deal\) \| 1 \| 1200/.test(flat) && /\| Total \| 5 \| 7990\.5 \| 500 \| 8490\.5/.test(flat), flat.slice(0, 1600));
    check('M2 Excel: by date', /1 \| 03 Oct 2026 \| 2 \| 5990\.5 \| 0 \| 5990\.5/.test(flat) && /2 \| 15 Oct 2026 \| 1 \| 0 \| 500 \| 500/.test(flat) && /4 \| 25 Oct 2026 \| 1 \| 800/.test(flat), flat.slice(0, 2000));
    check('M2 Excel: each lifting (BL date, supplier, deal ref, terminal, barge, grade, planned, BL qty), * marks, total', /1 \| 03 Oct 2026 \| ARAMCO \| CTR-77 \| VOPAK TERMINAL \| FNSA 11 \| VLSFO \| 4000 \| 3990\.5/.test(flat) && /4 \| 20 Oct 2026 \| GPS \(no deal\) \| — \| GPS \| FNSA 11 \| VLSFO \| 1200 \| 1200/.test(flat) && /5 \| 25 Oct 2026 \* \| VOPAK TERMINAL \(no deal\)/.test(flat) && /\| Total \|  \|  \|  \|  \|  \| 8490\.5/.test(flat), flat.slice(0, 2600));
    check('M2 Excel: the month\'s scheduled loadings, and the * note', /Scheduled in October 2026 \(not yet completed/.test(flat) && /\| ARAMCO \|  \| VOPAK TERMINAL \| FNSA 11 \| VLSFO \| 3500/.test(flat) && /\* No BL date \/ BL quantity entered/.test(flat), flat.slice(-700));
    check('M2 Excel leaves out the transfer, the deleted loading and November', !/\| 700 \|/.test(flat) && !/999/.test(flat) && !/02 Nov 2026/.test(flat), flat.slice(0, 3000));
    const pdf = await A.page.evaluate(async () => {
      let got = null, name = '';
      const orig = _flowSaveOrShareBlob; _flowSaveOrShareBlob = async (b, n) => { got = b; name = n; };
      try { await loadingMonthReportPdf(null); } finally { _flowSaveOrShareBlob = orig; }
      const buf = new Uint8Array(await got.arrayBuffer()); let txt = ''; for (let i = 0; i < buf.length; i++) txt += String.fromCharCode(buf[i]);
      return { name, size: buf.length, txt };
    });
    const t = pdf.txt;
    check('M2 PDF: a real text PDF named FLOW_Loading_Report_2026-10.pdf', /^%PDF-/.test(t) && pdf.name === 'FLOW_Loading_Report_2026-10.pdf' && pdf.size > 2000 && !/\/Subtype \/Image/.test(t), { name: pdf.name, size: pdf.size });
    check('M2 PDF: title, totals, by supplier, by date, liftings and scheduled', /Monthly loading report/.test(t) && /October 2026/.test(t) && /By supplier/.test(t) && /ARAMCO/.test(t) && /5,990\.5/.test(t) && /By date/.test(t) && /03 Oct 2026/.test(t) && /8,490\.5/.test(t) && /Scheduled in October 2026/.test(t) && /3,500/.test(t), t.length);
    const btn = await A.page.evaluate(async () => {
      let n = 0; const orig = _flowSaveOrShareBlob; _flowSaveOrShareBlob = async () => { n++; };
      const b1 = document.querySelector('#ld-report-card .ld-rep-xls'), b2 = document.querySelector('#ld-report-card .ld-rep-pdf');
      b1.click(); const mid = b1.textContent; await new Promise(r => setTimeout(r, 1500)); b2.click(); await new Promise(r => setTimeout(r, 1500));
      _flowSaveOrShareBlob = orig; return { n, mid, after: [b1.textContent.trim(), b2.textContent.trim(), b1.disabled, b2.disabled] };
    });
    check('M2 the buttons produce both files and come back after "Preparing…"', btn.n === 2 && /Preparing/.test(btn.mid) && btn.after[0] === '⬇ Excel' && btn.after[1] === '⬇ PDF' && !btn.after[2] && !btn.after[3], btn);
  });

  await scenario('M3 review fixes', async (openT) => {
    const s = seed();
    s.state.loadingDeals.push({ id: 'deal_3', supplier: '  aramco ', terminal: 'VOPAK TERMINAL', grade: 'VLSFO', qty: 9000, date: '2026-10-01', ref: 'SPOT', status: 'open', createdAt: 1, updatedAt: 1 });
    s.state.loadingRecords.push(
      ld('l9', { dealId: 'deal_3', qty: 300, completed: true, completedAt: Date.parse(at(7, 10)), blQty: 300, blDate: '2026-10-07' }),
      // still running across the month-end: starts 31 Oct, ends 1 Nov → counts in November
      ld('l10', { dealId: 'deal_1', qty: 2500, startAt: at(31, 6), endAt: new Date(Date.UTC(2026, 10, 1, 12)).toISOString() }),
      ld('l11', { dealId: 'deal_1', qty: 1000, completed: true, completedAt: Date.parse(at(8, 10)), blQty: 1000, blDate: '2026-10-08', terminal: 'VOPAK HORIZON FUJAIRAH TERMINAL NUMBER TWO' }));
    const db = H.createDb({ workspace: s, realtime: false });
    const A = await openT(db, 'user-operator');
    const d = await A.page.evaluate(() => {
      const o = _ldMonthReportData('2026-10'), n = _ldMonthReportData('2026-11');
      return { sup: o.bySupplier.map(g => [g.key, g.liftings, g.v]), octSched: o.scheduled.map(x => x.planned), novSched: n.scheduled.map(x => x.planned) };
    });
    check('M3 "ARAMCO" and "  aramco " on different deals are one supplier (first spelling shown)', d.sup[0][0] === 'ARAMCO' && d.sup[0][1] === 4 && d.sup[0][2] === 7290.5 && !d.sup.some(g => /^aramco$/i.test(g[0]) && g !== d.sup[0]), d.sup);
    check('M3 a loading still running across the month-end is listed under the month it ends in (November), not October', JSON.stringify(d.octSched) === JSON.stringify([3500]) && JSON.stringify(d.novSched) === JSON.stringify([2500]), d);
    const fmt = await A.page.evaluate(async () => {
      showPage('loading'); document.getElementById('ld-rep-month').value = '2026-10';
      let got = null; const orig = _flowSaveOrShareBlob; _flowSaveOrShareBlob = async b => { got = b; };
      try { await loadingMonthReportExcel(null); } finally { _flowSaveOrShareBlob = orig; }
      const wb = new (await _loadExcelJS()).Workbook(); await wb.xlsx.load(await got.arrayBuffer());
      const ws = wb.getWorksheet('Loading report'); const out = {};
      ws.eachRow(r => r.eachCell(c => { if (c.value === 4000 || c.value === 3990.5 || c.value === 5) out[c.value] = out[c.value] || c.numFmt; }));
      return out;
    });
    check('M3 Excel shows whole tonnes / counts without a trailing dot, decimals only when there are some', fmt['4000'] === '#,##0' && fmt['3990.5'] === '#,##0.###', fmt);
  });

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
