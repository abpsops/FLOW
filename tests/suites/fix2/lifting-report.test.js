/* Loading Deals — BL date on each lifting and the lifting report (Excel / PDF).
   • Mark Completed asks for the BL date (default: the loading's end day) and the BL quantity;
     both are saved on the loading, synced, editable later with the BL button
   • the deal card lists liftings in BL-date order with BL qty and "left after"; the loading list
     shows the BL date
   • ⬇ Excel: deal details, totals, each lifting (BL date, barge, terminal, planned, BL qty, left
     after), total lifted, scheduled loadings; ⬇ PDF: the same, as a real text PDF
   • an older lifting without a BL date / BL figure is marked * (completion day / planned used)
   • no BL date → refused; hostile names stay text
   node suites/fix2/lifting-report.test.js [appDir] */
const path = require('path');
if (process.argv[2]) process.env.APP_DIR = path.resolve(process.argv[2]);
const H = require(path.join(__dirname, '..', '..', 'harness', 'harness.js'));
const U = require(path.join(__dirname, '..', 'r3', 'util.js'));

let pass = 0, fail = 0;
function check(name, cond, info) {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 900)));
}
const DAY = 864e5, NOW = Date.now();
const iso = h => new Date(NOW + h * 3600000).toISOString();
const ld = (id, qty, s, e, extra) => Object.assign({ id, qty, barge: 'FNSA 11', grade: 'VLSFO', terminal: 'VOPAK TERMINAL', notes: '', surveyor: '', startAt: iso(s), endAt: iso(e), preOpsHours: 2.5, postOpsHours: 3.5, pumpHours: 5, estimatedHours: 11, endOverridden: false, updatedAt: NOW, dealId: 'deal_1' }, extra || {});
function seed(extraLoadings) {
  const s = U.seedPayload({});
  s.state.barges = [{ id: 1, name: 'FNSA 10', vrob: 3000, mrob: 300, vcap: 5000, mcap: 1000, vbuf: 200, mbuf: 50, vtph: 300, mtph: 100, vrfr: 750, mrfr: 275 }, { id: 2, name: 'FNSA 11', vrob: 400, mrob: 400, vcap: 5000, mcap: 1000, vbuf: 200, mbuf: 50, vtph: 300, mtph: 100, vrfr: 750, mrfr: 275 }];
  s.state.loadingDeals = [{ id: 'deal_1', supplier: 'ARAMCO <b>x</b>', terminal: 'VOPAK TERMINAL', grade: 'VLSFO', qty: 45000, date: '2026-11-01', ref: 'CTR-77', notes: '', status: 'open', createdAt: 1, updatedAt: 1 }];
  s.state.loadingRecords = [
    // an older lifting: completed before BL dates existed (no blDate), BL qty entered
    ld('l_old', 4500, -200, -190, { completed: true, completedAt: NOW - 189 * 3600000, blQty: 4312 }),
    ld('l_a', 4400, -30, -20),            // ended, to be completed with a BL date
    ld('l_b', 4000, 40, 50, { barge: 'FNSA 10' }), // scheduled
  ].concat(extraLoadings || []);
  return s;
}

(async () => {
  const browser = await H.launch();
  const scenario = async (name, fn) => {
    if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return;
    console.log('— ' + name);
    const apps = [];
    try { await fn(async (db, uid) => { const a = await U.open(browser, db, uid); await U.helpers(a); await a.page.evaluate(() => { window.__toasts = []; window.__alerts = []; window.alert = m => window.__alerts.push(String(m)); window.confirm = () => true; }); apps.push(a); return a; }); }
    catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
    const errs = [].concat(...apps.map(a => U.realErrors(a)));
    check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
    for (const a of apps) await a.ctx.close();
  };

  await scenario('L1 BL date on completion', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db, 'user-operator');
    const m = await A.page.evaluate(() => {
      showPage('loading'); completeLoadingPrompt('l_a');
      const rec = _loadingRecords.find(r => r.id === 'l_a');
      return { open: document.getElementById('bl-modal').style.display === 'flex', date: document.getElementById('bl-date').value, endDay: _localDateInputStr(new Date(rec.endAt)), qty: document.getElementById('bl-qty').value };
    });
    check('L1 the prompt asks for the BL date (default: the loading\'s end day) and the BL quantity (default: planned)', m.open && m.date === m.endDay && m.qty === '4400', m);
    const empty = await A.page.evaluate(() => { document.getElementById('bl-date').value = ''; blConfirm(); return { alerts: window.__alerts.slice(), open: document.getElementById('bl-modal').style.display === 'flex', done: !!_loadingRecords.find(r => r.id === 'l_a').completed }; });
    check('L1 no BL date → refused with a message, nothing completed', empty.alerts.some(a => /Enter the BL date/.test(a)) && empty.open && !empty.done, empty);
    const blDay = new Date(NOW - 1 * DAY); const ymd = blDay.getFullYear() + '-' + String(blDay.getMonth() + 1).padStart(2, '0') + '-' + String(blDay.getDate()).padStart(2, '0');
    const done = await A.page.evaluate(async (ymd) => { document.getElementById('bl-date').value = ymd; document.getElementById('bl-qty').value = '4380'; blConfirm(); await _waitForSaveIdle(); const r = _loadingRecords.find(x => x.id === 'l_a'); return { completed: r.completed, blQty: r.blQty, blDate: r.blDate, list: document.getElementById('loading-list').textContent.replace(/\s+/g, ' ') }; }, ymd);
    check('L1 saved: completed, BL 4,380 MT, BL date as entered; the loading list shows the BL date', done.completed && done.blQty === 4380 && done.blDate === ymd && /BL 4,380 MT · BL date/.test(done.list), done);
    const cloud = U.row(db).payload.state.loadingRecords.find(r => r.id === 'l_a');
    check('L1 the BL date reaches the cloud', cloud && cloud.blDate === ymd && cloud.blQty === 4380, cloud);
    // edit later with the BL button
    const ed = await A.page.evaluate(async () => { editLoadingBl('l_a'); const before = document.getElementById('bl-date').value; document.getElementById('bl-date').value = '2026-11-02'; document.getElementById('bl-qty').value = '4390'; blConfirm(); await _waitForSaveIdle(); const r = _loadingRecords.find(x => x.id === 'l_a'); return { before, blDate: r.blDate, blQty: r.blQty, title: document.getElementById('bl-title').textContent }; });
    check('L1 the BL button opens the saved BL date and quantity and both can be corrected', ed.before === ymd && ed.blDate === '2026-11-02' && ed.blQty === 4390, ed);
    // deal card: BL-date order, left after
    const card = await A.page.evaluate(() => { showPage('deals'); const c = document.querySelector('.deal-card[data-deal-id="deal_1"]'); return { head: [...c.querySelectorAll('.deal-tbl thead th')].map(t => t.textContent), rows: [...c.querySelectorAll('.deal-tbl tbody tr')].map(tr => [...tr.children].map(td => td.textContent.replace(/\s+/g, ' ').trim())), btns: [...c.querySelectorAll('.deal-foot button')].map(b => b.textContent.trim()) }; });
    check('L1 the deal card lists liftings by BL date with BL qty and left after (45,000 − 4,312 = 40,688; − 4,390 = 36,298), then the scheduled one', card.head.includes('BL date / planned') && card.head.includes('Left after MT') && card.rows.length === 3 && card.rows[0][4] === '4,312' && card.rows[0][5] === '40,688' && /\*/.test(card.rows[0][0]) && /02 Nov 2026/.test(card.rows[1][0]) && card.rows[1][4] === '4,390' && card.rows[1][5] === '36,298' && /SCHEDULED/.test(card.rows[2].join(' ')) && card.rows[2][5] === '—', card);
    check('L1 the card has ⬇ Excel and ⬇ PDF buttons', card.btns.includes('⬇ Excel') && card.btns.includes('⬇ PDF'), card.btns);
  });

  await scenario('L2 Excel and PDF', async (openT) => {
    const db = H.createDb({ workspace: seed([ld('l_c', 4000, -60, -50, { completed: true, completedAt: NOW - 49 * 3600000, blQty: 3990, blDate: '2026-11-03', barge: 'FNSA 10' })]), realtime: false });
    const A = await openT(db, 'user-operator');
    const xl = await A.page.evaluate(async () => {
      let got = null, name = '';
      const orig = _flowSaveOrShareBlob; _flowSaveOrShareBlob = async (b, n) => { got = b; name = n; };
      try { await dealExportLiftingExcel('deal_1', null); } finally { _flowSaveOrShareBlob = orig; }
      const wb = new (await _loadExcelJS()).Workbook(); await wb.xlsx.load(await got.arrayBuffer());
      const ws = wb.getWorksheet('Lifting report'); const rows = [];
      ws.eachRow(r => rows.push(r.values.slice(1).map(v => v == null ? '' : (typeof v === 'object' && v.richText ? v.richText.map(t => t.text).join('') : String(v)))));
      return { name, rows };
    });
    const flat = xl.rows.map(r => r.join(' | ')).join('\n');
    check('L2 Excel file name names the deal', /^FLOW_Lifting_Report_ARAMCO_b_x_b_CTR-77_2026-11-01\.xlsx$/.test(xl.name) || /^FLOW_Lifting_Report_.*CTR-77.*\.xlsx$/.test(xl.name), xl.name);
    check('L2 Excel: deal details and totals (bought 45,000, lifted 8,302, left 36,698, scheduled 8,400)', /Supplier \| ARAMCO <b>x<\/b>/.test(flat) && /Reference \| CTR-77/.test(flat) && /Bought \(MT\) \| 45000/.test(flat) && /Lifted \(per BL\) \(MT\) \| 8302/.test(flat) && /Left to lift \(MT\) \| 36698/.test(flat) && /Scheduled \(MT\) \| 8400/.test(flat), flat.slice(0, 1500));
    check('L2 Excel: liftings in BL-date order with BL date, barge, terminal, planned, BL qty, left after; total lifted', /1 \| \d{2} [A-Z][a-z]{2} 2026 \* \| FNSA 11 \| VOPAK TERMINAL \| 4500 \| 4312 \| 40688/.test(flat) && /2 \| 03 Nov 2026 \| FNSA 10 \| VOPAK TERMINAL \| 4000 \| 3990 \| 36698/.test(flat) && /Total lifted \|  \| 8302 \| 36698/.test(flat), flat.slice(0, 2000));
    check('L2 Excel: the scheduled loadings and the * note', /Scheduled loadings \(not yet completed\)/.test(flat) && /\| FNSA 11 \| VOPAK TERMINAL \| 4400/.test(flat) && /\| FNSA 10 \| VOPAK TERMINAL \| 4000/.test(flat) && /\* No BL date \/ BL quantity entered/.test(flat), flat.slice(-900));
    const pdf = await A.page.evaluate(async () => {
      let got = null, name = '';
      const orig = _flowSaveOrShareBlob; _flowSaveOrShareBlob = async (b, n) => { got = b; name = n; };
      try { await dealExportLiftingPdf('deal_1', null); } finally { _flowSaveOrShareBlob = orig; }
      const buf = new Uint8Array(await got.arrayBuffer()); let txt = ''; for (let i = 0; i < buf.length; i++) txt += String.fromCharCode(buf[i]);
      return { name, size: buf.length, head: txt.slice(0, 8), txt: txt };
    });
    const t = pdf.txt;
    check('L2 PDF: a real PDF (text, not an image) named like the Excel', /^%PDF-/.test(pdf.head) && /\.pdf$/.test(pdf.name) && pdf.size > 2000 && !/\/Subtype \/Image/.test(t), { name: pdf.name, size: pdf.size, head: pdf.head });
    check('L2 PDF: the deal, the liftings with BL date / BL qty / left after, totals and the scheduled loadings', /Lifting report/.test(t) && /CTR-77/.test(t) && /03 Nov 2026/.test(t) && /3,990/.test(t) && /36,698/.test(t) && /40,688/.test(t) && /Total lifted/.test(t) && /8,302/.test(t) && /Scheduled loadings/.test(t) && /4,400/.test(t), t.length);
    // the card buttons work end to end (button shows Preparing… then back)
    const btn = await A.page.evaluate(async () => {
      showPage('deals'); let n = 0; const orig = _flowSaveOrShareBlob; _flowSaveOrShareBlob = async () => { n++; };
      const b1 = document.querySelector('.deal-card[data-deal-id="deal_1"] .deal-xls'), b2 = document.querySelector('.deal-card[data-deal-id="deal_1"] .deal-pdf');
      b1.click(); const mid = b1.textContent; await new Promise(r => setTimeout(r, 1500)); b2.click(); await new Promise(r => setTimeout(r, 1500));
      _flowSaveOrShareBlob = orig; return { n, mid, after: [b1.textContent.trim(), b2.textContent.trim(), b1.disabled, b2.disabled] };
    });
    check('L2 the card buttons produce both files and come back after "Preparing…"', btn.n === 2 && /Preparing/.test(btn.mid) && btn.after[0] === '⬇ Excel' && btn.after[1] === '⬇ PDF' && !btn.after[2] && !btn.after[3], btn);
    // hostile supplier name stays text on the card
    const xss = await A.page.evaluate(() => { const c = document.querySelector('.deal-card[data-deal-id="deal_1"] .deal-name'); return { text: c.textContent, bTags: c.querySelectorAll('b').length }; });
    check('L2 a supplier name with markup shows as text', xss.text === 'ARAMCO <b>x</b>' && xss.bTags === 0, xss);
  });

  await scenario('L3 trader view and sync', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db, 'user-operator');
    const B = await openT(db, 'user-operator2');
    await A.page.evaluate(async () => { completeLoadingPrompt('l_a'); document.getElementById('bl-date').value = '2026-11-03'; document.getElementById('bl-qty').value = '4350'; blConfirm(); await _waitForSaveIdle(); });
    const b = await B.page.evaluate(async () => { await _pollOnce(true); showPage('deals'); const r = _loadingRecords.find(x => x.id === 'l_a'); return { blDate: r.blDate, blQty: r.blQty, row: [...document.querySelectorAll('.deal-card .deal-tbl tbody tr')].map(tr => tr.textContent.replace(/\s+/g, ' ')).find(x => /4,350/.test(x)) || '' }; });
    check('L3 another device gets the BL date and quantity and shows them on the deal card', b.blDate === '2026-11-03' && b.blQty === 4350 && /03 Nov 2026/.test(b.row), b);
  });

  await scenario('L4 decimals', async (openT) => {
    const db = H.createDb({ workspace: seed([ld('l_d', 4500, -80, -70, { completed: true, completedAt: NOW - 69 * 3600000, blQty: 4412.5, blDate: '2026-11-03' })]), realtime: false });
    const A = await openT(db, 'user-operator');
    const c = await A.page.evaluate(() => { showPage('deals'); const card = document.querySelector('.deal-card[data-deal-id="deal_1"]'); return { nums: [...card.querySelectorAll('.deal-num-v')].map(e => e.textContent), rows: [...card.querySelectorAll('.deal-tbl tbody tr')].map(tr => [...tr.children].map(td => td.textContent.replace(/\s+/g, ' ').trim())) }; });
    check('L4 a BL figure with decimals shows exactly on the card (4,412.5; left after 36,275.5) and in the totals (lifted 8,724.5)', c.rows.some(r => r[4] === '4,412.5' && r[5] === '36,275.5') && c.nums.includes('8,724.5') && c.nums.includes('36,275.5'), c);
  });

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
