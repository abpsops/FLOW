/* Quantity ranges on nominations ("VLSFO 500–600 MT").
   The card's qty box takes one number or a range; planning (scheduler,
   Availability Check, Free Windows, ROB) uses the TOP of the range, every
   place people read the nomination shows the range, the checklist compares
   actuals against it, and it survives save / sync / trash. Vessels saved
   without a range behave exactly as before.
   node suites/nominations/range.test.js [appDir] */
const fs = require('fs');
const XLSX = require('xlsx');
const H = require('../../harness/harness.js');
const U = require('../r3/util.js');
const appDir = process.argv[2] || H.APP_DIR;

let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) pass++; else fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 400)));
}
const HELPERS = () => {
  window.__fmt = function (d) { const p = n => String(n).padStart(2, '0'); return p(d.getDate()) + ' ' + MO[d.getMonth()] + ' ' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
  window.__at = function (hrs) { const d = new Date(Date.now() + hrs * 3600000); d.setSeconds(0, 0); if (d.getHours() === 0 && d.getMinutes() === 0) d.setMinutes(7); return d; };
  window.__reset = function () {
    const o = document.getElementById('flow-welcome-overlay'); if (o) o.style.display = 'none';
    document.querySelectorAll('.vcard[id^="vessel-"]').forEach(c => c.remove());
    (_barges || []).slice().forEach(b => rmBarge(b.id));
    _lastSched = []; _checklistRecords = {}; _savedSupplies = []; _deliveryLog = {};
  };
  window.__barge = function (def) { addBarge(def); return _barges[_barges.length - 1].id; };
  window.__vessel = function (def) {
    const d = Object.assign({ area: 'FUJ-A', lc: '', paq: 'no' }, def);
    if (d.etaHrs !== undefined) d.eta = __fmt(__at(d.etaHrs));
    addVessel(d);
    const cards = document.querySelectorAll('.vcard[id^="vessel-"]');
    return cards[cards.length - 1].id.replace('vessel-', '');
  };
  window.__typeQty = function (id, g, val) { const el = document.getElementById('v' + id + '-' + g); el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); };
};

async function scenario(browser, name, fn) {
  const db = H.createDb();
  const app = await H.openApp(browser, db, { appDir, uid: 'user-operator' });
  await app.page.evaluate(HELPERS);
  await app.page.evaluate(() => __reset());
  try { await fn(app.page, app, db); }
  catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
  const errs = app.errors.filter(e => !/capacitorExports/.test(e));
  check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
  await app.ctx.close();
}

(async () => {
  const browser = await H.launch();

  await scenario(browser, 'R1 parse', async (page) => {
    const r = await page.evaluate(() => ['500', '500-600', '500–600', '500 to 600', 'abt 500/600', '1,500 - 1,800 MT', '600-500', '550-550', '', 'abc', '500-', '12.5'].map(s => _parseQtyInput(s)));
    const eq = (x, ok, qty, min, max) => x.ok === ok && x.qty === qty && x.min === min && x.max === max;
    check('R1 single number', eq(r[0], true, 500, null, null), r[0]);
    check('R1 "500-600" → plan 600, range 500–600', eq(r[1], true, 600, 500, 600), r[1]);
    check('R1 en dash', eq(r[2], true, 600, 500, 600), r[2]);
    check('R1 "500 to 600"', eq(r[3], true, 600, 500, 600), r[3]);
    check('R1 "abt 500/600"', eq(r[4], true, 600, 500, 600), r[4]);
    check('R1 thousands commas + MT', eq(r[5], true, 1800, 1500, 1800), r[5]);
    check('R1 reversed range is put in order', eq(r[6], true, 600, 500, 600), r[6]);
    check('R1 equal ends = single number', eq(r[7], true, 550, null, null), r[7]);
    check('R1 empty = 0', eq(r[8], true, 0, null, null), r[8]);
    check('R1 garbage flagged', r[9].ok === false && r[10].ok === false, [r[9], r[10]]);
    check('R1 decimals', eq(r[11], true, 12.5, null, null), r[11]);
  });

  await scenario(browser, 'R2 card entry + validation', async (page) => {
    const r = await page.evaluate(() => {
      const id = __vessel({ name: 'RANGE ONE', type: 'BOTH', qty: 0, mgo: 0, etaHrs: 30 });
      const out = {};
      __typeQty(id, 'vlsfo', '500-600');
      out.hint = document.getElementById('v' + id + '-hvq').textContent;
      out.err = document.getElementById('v' + id + '-vlsfo').classList.contains('err');
      __typeQty(id, 'mgo', '50 to 80');
      out.mhint = document.getElementById('v' + id + '-hmq').textContent;
      out.cap = captureCurrentState().vessels[0];
      __typeQty(id, 'vlsfo', 'lots');
      out.badHint = document.getElementById('v' + id + '-hvq').textContent;
      out.badCls = document.getElementById('v' + id + '-hvq').className;
      out.badErr = document.getElementById('v' + id + '-vlsfo').classList.contains('err');
      out.badAria = document.getElementById('v' + id + '-vlsfo').getAttribute('aria-invalid');
      __typeQty(id, 'vlsfo', '700'); refreshNominationKPIs();
      out.single = captureCurrentState().vessels[0];
      out.singleHint = document.getElementById('v' + id + '-hvq').textContent;
      out.kpi = document.getElementById('nom-kpi-vlsfo').textContent;
      __typeQty(id, 'vlsfo', '500–600'); refreshNominationKPIs();
      out.kpi2 = document.getElementById('nom-kpi-vlsfo').textContent;
      out.type = document.getElementById('v' + id + '-vlsfo').type;
      return out;
    });
    check('R2 range hint shown', /Range 500–600 MT/.test(r.hint) && /planned at 600/.test(r.hint), r.hint);
    check('R2 range input not flagged', r.err === false);
    check('R2 MGO range hint', /Range 50–80 MT/.test(r.mhint), r.mhint);
    check('R2 saved: planning = top, range kept', r.cap.qty === 600 && r.cap.qtyMin === 500 && r.cap.qtyMax === 600 && r.cap.mgo === 80 && r.cap.mgoMin === 50 && r.cap.mgoMax === 80, r.cap);
    check('R2 unreadable qty flagged inline', /number or a range/.test(r.badHint) && /er/.test(r.badCls) && r.badErr && r.badAria === 'true', r);
    check('R2 single number stores no range fields', r.single.qty === 700 && !('qtyMin' in r.single) && !('qtyMax' in r.single) && r.singleHint === '', r.single);
    check('R2 KPI total uses the planning figure', r.kpi === '700' && r.kpi2 === '600', [r.kpi, r.kpi2]);
    check('R2 qty box is a text field (accepts ranges)', r.type === 'text');
  });

  await scenario(browser, 'R3 scheduler + displays', async (page, app) => {
    const r = await page.evaluate(async () => {
      const b = __barge({ name: 'B1', vrob: 4000, mrob: 800, vbuf: 0, mbuf: 0, vtph: 300, mtph: 100 });
      const id = __vessel({ name: 'RANGER', type: 'BOTH', qty: 600, qtyMin: 500, qtyMax: 600, mgo: 80, mgoMin: 50, mgoMax: 80, etaHrs: 30, bargeId: b, agent: 'AG' });
      calculate();
      const it = _lastSched[0];
      const out = { card: document.getElementById('v' + id + '-vlsfo').value, mcard: document.getElementById('v' + id + '-mgo').value };
      out.item = { nomVQ: it.nomVQ, vQ: it.vQ, nomVMin: it.nomVMin, nomVMax: it.nomVMax, nomMQ: it.nomMQ, nomMMin: it.nomMMin, robVA: it.robVA, hrs: (it.etc - it.bargeStart) / 3600000 };
      out.hose = _calcParams.hoseHrs;
      out.voy = document.getElementById('voy-barge-tabs') ? document.getElementById('voy-barge-tabs').textContent : '';
      out.tl = document.getElementById('tl').textContent;
      renderWeekCalendar(0);
      out.cal = document.getElementById('week-calendar').innerHTML;
      renderChecklist(_lastSched);
      out.cl = document.getElementById('checklist-rows').textContent;
      out.msg = _generateBunkerMsg(it, 'both', 'arrival', '', 'B1');
      openBunkerMsgModal(it.sno);
      out.bm = document.getElementById('bm-vlsfo-qty').textContent + ' | ' + document.getElementById('bm-mgo-qty').textContent;
      out.etaQ = document.getElementById('eta-vlsfo-qty').value;
      etaMailUpdatePreview();
      out.etaMail = document.getElementById('eta-mail-preview').dataset.plainText;
      closeBunkerMsgModal();
      out.email = _buildNominationEmail(captureCurrentState().vessels[0]).body;
      ciOpenForVessel(id);
      out.ciPrev = document.getElementById('ci-prev-vlsfo').textContent + ' | ' + document.getElementById('ci-prev-lsmgo').textContent;
      out.ciTxt = ciApplyTemplate('To: The Master: X\nRMG: - 1 MT / 380 CST\nMGO: - 1 MT', _ciVesselCtx) + '\n' + ciApplyTemplate('{{VESSEL_NAME}}\n{{VLSFO_QTY}}', _ciVesselCtx);
      ciCloseModal();
      emailOpenForVessel(id);
      out.em = document.getElementById('em-output-text').value;
      emailCloseModal();
      showPage('dashboard'); if (typeof refreshDashboard === 'function') refreshDashboard();
      return out;
    });
    check('R3 card shows the range', r.card === '500–600' && r.mcard === '50–80', [r.card, r.mcard]);
    check('R3 scheduler plans the TOP of the range', r.item.nomVQ === 600 && r.item.vQ === 600 && r.item.nomMQ === 80, r.item);
    check('R3 schedule item carries the range', r.item.nomVMin === 500 && r.item.nomVMax === 600 && r.item.nomMMin === 50, r.item);
    check('R3 ROB after supply deducts the max', r.item.robVA === 3400, r.item);
    check('R3 ETC from the max (hose + 600/300 h)', Math.abs(r.item.hrs - (r.hose + Math.max(600 / 300, 80 / 100))) < 0.01, r.item);
    check('R3 voyage table shows 500–600', /500–600/.test(r.voy) && /50–80/.test(r.voy), r.voy.slice(0, 300));
    check('R3 timeline shows the range', /VLSFO 500–600 MT/.test(r.tl) && /MGO 50–80 MT/.test(r.tl), r.tl.slice(0, 300));
    check('R3 week calendar ticket shows the range', /V&nbsp;500–600/.test(r.cal) && /M&nbsp;50–80/.test(r.cal));
    check('R3 checklist nominated column shows the range', /500–600 MT/.test(r.cl) && /50–80 MT/.test(r.cl), r.cl.slice(0, 300));
    check('R3 bunker message quantity line', /QUANTITY: 500–600 MT VLSFO \/ 50–80 MT LSMGO/.test(r.msg), r.msg);
    check('R3 bunker modal quantities', r.bm === '500–600 MT | 50–80 MT', r.bm);
    check('R3 ETA nomination mail uses the range', r.etaQ === '500–600' && /NOMINATED QUANTITY - 500–600 MT LSFO \/ 50–80 MT LSMGO/.test(r.etaMail), [r.etaQ, r.etaMail]);
    check('R3 nomination email', /VLSFO: 500–600 MT/.test(r.email) && /MGO: 50–80 MT/.test(r.email), r.email);
    check('R3 calling instructions preview + text', r.ciPrev === '500–600 MT | 50–80 MT' && /RMG: - 500–600 MT/.test(r.ciTxt) && /MGO: - 50–80 MT/.test(r.ciTxt) && /500–600 MT/.test(r.ciTxt.split('\n').pop()), [r.ciPrev, r.ciTxt]);
    check('R3 agent email generator', /500–600 MT LSFO \/ 50–80 MT LSMGO/.test(r.em), r.em.slice(0, 400));

    // Excel exports (schedule + per barge + checklist) and the printed schedule
    const read = async (fn) => {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(fn)]);
      const wb = XLSX.read(fs.readFileSync(await dl.path()));
      return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false });
    };
    const rows = await read(() => downloadExcel());
    const row = rows.find(x => x[1] === 'RANGER') || [];
    check('R3 schedule Excel shows 500–600 / 50–80', row[3] === '500–600' && row[4] === '50–80', row);
    const bid = await page.evaluate(() => _barges[0].id);
    const rowsB = await read(new Function('downloadExcelForBarge(' + JSON.stringify(bid) + ')'));
    const rowB = rowsB.find(x => x[1] === 'RANGER') || [];
    check('R3 per-barge Excel shows the range', rowB[3] === '500–600' && rowB[4] === '50–80', rowB);
    const rowsC = await read(() => downloadChecklist());
    const rowC = rowsC.find(x => x[1] === 'RANGER') || [];
    check('R3 checklist Excel nominated columns', rowC[4] === '500–600' && rowC[7] === '50–80', rowC);
    const pr = await page.evaluate(() => { const w = window.print; window.print = () => {}; try { printScheduleOnly(); } finally { window.print = w; } return document.getElementById('print-only-container').textContent; });
    check('R3 printed schedule shows the range', /500–600/.test(pr), pr.slice(0, 200));
  });

  await scenario(browser, 'R4 availability + free windows use the max', async (page) => {
    const r = await page.evaluate(() => {
      const b = __barge({ name: 'B1', vrob: 4500, mrob: 900, vbuf: 0, mbuf: 0 });
      __vessel({ name: 'RANGED', type: 'VLSFO', qty: 1000, qtyMin: 900, qtyMax: 1000, mgo: 0, etaHrs: -30, bargeId: b });
      calculate();
      const fw = computeFreeWindows(b, 'B1', new Date(), new Date(Date.now() + 7 * 86400000));
      document.getElementById('nsc-vessel-name').value = 'CHECK';
      document.getElementById('nsc-req-v').value = '3550';
      document.getElementById('nsc-req-m').value = '';
      document.getElementById('nsc-vessel-eta').value = '';
      checkNSCUnified();
      const t1 = document.getElementById('nsc-unified-result').textContent;
      document.getElementById('nsc-req-v').value = '3450';
      checkNSCUnified();
      const t2 = document.getElementById('nsc-unified-result').textContent;
      return { fw0: fw[0], t1, t2 };
    });
    check('R4 free-window estimate deducts the max (≤ 3500)', r.fw0 && r.fw0.estV <= 3500, r.fw0);
    check('R4 availability: 3550 MT not feasible (3500 left after the max)', /NOT FEASIBLE/.test(r.t1), r.t1.slice(-200));
    check('R4 availability: 3450 MT feasible', !/NOT FEASIBLE/.test(r.t2) && /FEASIBLE/.test(r.t2), r.t2.slice(-200));
  });

  await scenario(browser, 'R5 checklist range check', async (page) => {
    const r = await page.evaluate(() => {
      const b = __barge({ name: 'B1' });
      __vessel({ name: 'RANGED', type: 'BOTH', qty: 600, qtyMin: 500, qtyMax: 600, mgo: 80, mgoMin: 50, mgoMax: 80, etaHrs: 20, bargeId: b });
      __vessel({ name: 'SINGLE', type: 'VLSFO', qty: 500, mgo: 0, etaHrs: 40, bargeId: b });
      calculate();
      renderChecklist(_lastSched);
      const rec = Object.values(_checklistRecords).find(x => x.vessel === 'RANGED');
      const one = Object.values(_checklistRecords).find(x => x.vessel === 'SINGLE');
      const badge = (uid, f, v) => { clUpdateActual(uid, f, v); return document.getElementById('cl-d' + f + '-' + uid).textContent; };
      return {
        rec: { nomV: rec.nomV, nomVMin: rec.nomVMin, nomVMax: rec.nomVMax, nomMMin: rec.nomMMin },
        inR: badge(rec.uid, 'v', '550'), lo: badge(rec.uid, 'v', '480'), hi: badge(rec.uid, 'v', '650'), edge: badge(rec.uid, 'v', '500'),
        mIn: badge(rec.uid, 'm', '60'), mLo: badge(rec.uid, 'm', '40'),
        sMatch: badge(one.uid, 'v', '500'), sShort: badge(one.uid, 'v', '480'), oneKeys: Object.keys(one).filter(k => /Min|Max/.test(k)),
        rendered: (renderChecklist([]), document.getElementById('cl-dv-' + rec.uid).textContent)
      };
    });
    check('R5 record keeps planning nomV = max + range', r.rec.nomV === 600 && r.rec.nomVMin === 500 && r.rec.nomVMax === 600 && r.rec.nomMMin === 50, r.rec);
    check('R5 actual within range = OK', r.inR === 'In range' && r.edge === 'In range' && r.mIn === 'In range', r);
    check('R5 below min = short by (min − actual)', r.lo === 'Short 20 MT' && r.mLo === 'Short 10 MT', r);
    check('R5 above max = over', r.hi === '+50 MT over', r.hi);
    check('R5 single nomination unchanged (Match / −20 MT)', r.sMatch === 'Match' && r.sShort === '-20 MT' && r.oneKeys.length === 0, r);
    check('R5 badge on re-render matches', r.rendered === 'In range', r.rendered);
  });

  await scenario(browser, 'R6 trash / restore keeps the range', async (page) => {
    const r = await page.evaluate(() => {
      const id = __vessel({ name: 'BINNED', type: 'VLSFO', qty: 600, qtyMin: 500, qtyMax: 600, etaHrs: 20 });
      window.confirm = () => false; // no cancellation email
      rmV(+id);
      const def = _trashBin[_trashBin.length - 1].def;
      renderTrashBin();
      const binText = document.getElementById('trash-bin-list').textContent;
      restoreFromTrash(_trashBin.length - 1);
      const v = captureCurrentState().vessels.find(x => x.name === 'BINNED');
      return { def: [def.qty, def.qtyMin, def.qtyMax], bin: /VLSFO 500–600 MT/.test(binText), v: v && [v.qty, v.qtyMin, v.qtyMax] };
    });
    check('R6 trash entry keeps qtyMin/qtyMax', JSON.stringify(r.def) === '[600,500,600]', r.def);
    check('R6 trash list shows the range', r.bin);
    check('R6 restored card keeps the range', JSON.stringify(r.v) === '[600,500,600]', r.v);
  });

  // ── Multi-device: range round-trips through cloud save/merge and the trader RPC ──
  {
    console.log('R7 sync round-trip');
    const seed = U.seedPayload();
    seed.state.vessels[0].qty = 600; seed.state.vessels[0].qtyMin = 500; seed.state.vessels[0].qtyMax = 600;
    const db = H.createDb({ workspace: seed });
    const A = await U.open(browser, db, 'user-operator');
    const B = await U.open(browser, db, 'user-operator2');
    const T = await U.open(browser, db, 'user-trader');
    for (const x of [A, B, T]) await U.helpers(x);
    check('R7 seeded range shows on every device', (await A.page.evaluate(() => __getV('n1', 'vlsfo'))) === '500–600' && (await T.page.evaluate(() => __getV('n1', 'vlsfo'))) === '500–600');
    await A.page.evaluate(async () => { __setV('n2', 'vlsfo', '650-700'); return saveSharedState(); });
    let n2 = U.row(db).payload.state.vessels.find(v => v.nomUid === 'n2');
    check('R7 A saved a new range', n2.qty === 700 && n2.qtyMin === 650 && n2.qtyMax === 700, n2);
    // B (stale) edits another field of n1 → merge keeps both A's range and n1's range
    await B.page.evaluate(async () => { __setV('n1', 'agent', 'B-AGENT'); return saveSharedState(); });
    const vs = U.row(db).payload.state.vessels;
    n2 = vs.find(v => v.nomUid === 'n2'); const n1 = vs.find(v => v.nomUid === 'n1');
    check('R7 three-way merge keeps A\'s range', n2.qtyMin === 650 && n2.qtyMax === 700, n2);
    check('R7 merge keeps n1 range + B\'s edit', n1.qtyMin === 500 && n1.qtyMax === 600 && n1.agent === 'B-AGENT', n1);
    check('R7 B now shows A\'s range', (await B.page.evaluate(() => __getV('n2', 'vlsfo'))) === '650–700');
    // single number again → range fields dropped everywhere
    await A.page.evaluate(async () => { await _pollOnce(true); __setV('n2', 'vlsfo', '700'); return saveSharedState(); });
    n2 = U.row(db).payload.state.vessels.find(v => v.nomUid === 'n2');
    check('R7 back to a single number drops the range', n2.qty === 700 && !('qtyMin' in n2) && !('qtyMax' in n2), n2);
    // trader edits a range → goes through trader_update_vessels
    await T.page.evaluate(async () => { await _pollOnce(true); __setV('n2', 'mgo', '40-60'); __setV('n2', 'type', 'BOTH'); return saveSharedState(); });
    const rpc = db.log.filter(o => o.action === 'rpc' && o.name === 'trader_update_vessels').pop();
    const tv = rpc && rpc.args.new_vessels.find(v => v.nomUid === 'n2');
    check('R7 trader RPC carries mgoMin/mgoMax', tv && tv.mgo === 60 && tv.mgoMin === 40 && tv.mgoMax === 60, tv);
    await A.page.evaluate(() => _pollOnce(true));
    check('R7 operator sees the trader\'s range', (await A.page.evaluate(() => __getV('n2', 'mgo'))) === '40–60');
    const errs = [A, B, T].flatMap(U.realErrors);
    check('R7 no page errors', errs.length === 0, errs.slice(0, 3));
    for (const x of [A, B, T]) await x.ctx.close();
  }

  // ── Legacy: vessels saved before ranges existed behave exactly as before ──
  {
    console.log('R8 legacy vessels unchanged');
    const seed = U.seedPayload();
    const before = JSON.stringify(seed.state.vessels);
    const db = H.createDb({ workspace: seed });
    const A = await U.open(browser, db, 'user-operator');
    await U.helpers(A);
    const r = await A.page.evaluate(async () => {
      const ui = [__getV('n1', 'vlsfo'), __getV('n2', 'vlsfo')];
      const hints = Array.from(document.querySelectorAll('[id$="-hvq"]')).map(h => h.textContent).join('');
      const cap = captureCurrentState().vessels;
      calculate();
      const items = _lastSched.map(i => Object.keys(i).filter(k => /Min$|Max$/.test(k)));
      const voy = document.getElementById('voy-barge-tabs') ? document.getElementById('voy-barge-tabs').textContent : '';
      return { ui, hints, cap, items, voy };
    });
    check('R8 legacy qty shows as a plain number', JSON.stringify(r.ui) === '["500","700"]', r.ui);
    check('R8 no range hints for legacy cards', r.hints === '', r.hints);
    check('R8 captured vessels identical to the stored ones', JSON.stringify(r.cap) === before, { cap: r.cap });
    check('R8 schedule items carry no range fields', r.items.every(k => k.length === 0), r.items);
    check('R8 voyage table shows plain quantities', /500/.test(r.voy) && !/–\d/.test(r.voy.replace(/\d{1,2} – \d{1,2}/g, '')), r.voy.slice(0, 200));
    const w0 = U.writes(db, 'user-operator').length;
    await A.page.evaluate(() => saveSharedState());
    check('R8 no extra cloud write for an untouched legacy workspace', U.writes(db, 'user-operator').length === w0);
    const errs = U.realErrors(A);
    check('R8 no page errors', errs.length === 0, errs.slice(0, 3));
    await A.ctx.close();
  }

  await browser.close();
  console.log(`range.test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
