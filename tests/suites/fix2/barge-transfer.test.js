/* Barge transfer (self cargo discharge, barge to barge) — a new type on the Loading page.
   • Type "Barge transfer": From barge (discharges) → To barge (receives); terminal, ops hours
     and deal are hidden; duration = qty ÷ the giving barge's pump rate for the grade + hose-up
   • saved with the loadings (kind:'transfer'); purple ticket on the calendar ("TRANSFER",
     "FNSA 10 → FNSA 11"), purple entry on BOTH barges' timelines, purple row in the list
   • both barges are busy: the planner moves a vessel on either barge out of the window,
     Free Windows / Availability see it, a loading on either barge warns (once)
   • the stock forecast is not changed, no deal link, no BL: Done just completes it (ROB by hand)
   • edit (switch type back), sync to another device, merge recompute with the barge's rate,
     trader view, hostile names stay text, two different barges required
   node suites/fix2/barge-transfer.test.js [appDir] */
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
const iso = h => new Date(NOW + h * 3600000).toISOString();
const BARGES = [
  { id: 1, name: 'FNSA 10', vrob: 3000, mrob: 300, vcap: 5000, mcap: 1000, vbuf: 200, mbuf: 50, vtph: 300, mtph: 100, vrfr: 750, mrfr: 275 },
  { id: 2, name: 'FNSA 11', vrob: 400, mrob: 400, vcap: 5000, mcap: 1000, vbuf: 200, mbuf: 50, vtph: 250, mtph: 100, vrfr: 750, mrfr: 275 },
];
const xfer = (id, s, e, extra) => Object.assign({ id, kind: 'transfer', fromBarge: 'FNSA 10', barge: 'FNSA 11', terminal: '', grade: 'VLSFO', qty: 1500, startAt: iso(s), endAt: iso(e), preOpsHours: 0, pumpHours: 5, postOpsHours: 0, hoseHours: 6, estimatedHours: 11, endOverridden: false, surveyor: '', notes: '', updatedAt: NOW }, extra || {});
function seed(loadings, extra) {
  const s = U.seedPayload(Object.assign({ vessels: [] }, extra || {}));
  s.state.barges = JSON.parse(JSON.stringify(BARGES));
  s.state.loadingDeals = [{ id: 'deal_1', supplier: 'ARAMCO', terminal: 'VOPAK TERMINAL', grade: 'VLSFO', qty: 45000, date: '2026-11-01', ref: 'CTR-1', notes: '', status: 'open', createdAt: 1, updatedAt: 1 }];
  s.state.loadingRecords = loadings || [];
  return s;
}

(async () => {
  const browser = await H.launch();
  const scenario = async (name, fn) => {
    if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return;
    console.log('— ' + name);
    const apps = [];
    try { await fn(async (db, uid) => { const a = await U.open(browser, db, uid); await U.helpers(a); await a.page.evaluate(() => { window.__alerts = []; window.__confirms = []; window.alert = m => window.__alerts.push(String(m)); window.confirm = m => { window.__confirms.push(String(m)); return true; }; }); apps.push(a); return a; }); }
    catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
    const errs = [].concat(...apps.map(a => U.realErrors(a)));
    check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
    for (const a of apps) await a.ctx.close();
  };

  await scenario('X1 the form', async (openT) => {
    const db = H.createDb({ workspace: seed([]), realtime: false });
    const A = await openT(db, 'user-operator');
    const f = await A.page.evaluate(() => {
      showPage('loading');
      const vis = id => { const el = document.getElementById(id); const f = el.closest('.field') || el; return getComputedStyle(f).display !== 'none'; };
      const before = { from: vis('ld-from-barge'), terminal: vis('ld-terminal') };
      const k = document.getElementById('ld-kind'); k.value = 'transfer'; k.dispatchEvent(new Event('change'));
      document.getElementById('ld-from-barge').value = 'FNSA 10'; document.getElementById('ld-from-barge').dispatchEvent(new Event('change'));
      document.getElementById('ld-barge').value = 'FNSA 11';
      document.getElementById('ld-grade').value = 'VLSFO';
      document.getElementById('ld-qty').value = '1500';
      const t = new Date(); t.setDate(t.getDate() + 1);
      document.getElementById('ld-start-date').value = _localDateInputStr(t);
      document.getElementById('ld-start-time').value = '08:00';
      _recalcLoadingEstimate();
      return { before, after: { from: vis('ld-from-barge'), terminal: vis('ld-terminal'), preOps: vis('ld-pre-ops'), deal: vis('ld-deal') },
        label: document.getElementById('ld-barge-label').textContent, btn: document.getElementById('loading-submit-btn-label').textContent,
        pump: document.getElementById('ld-pump-duration-display').value, dur: document.getElementById('ld-duration-display').value };
    });
    check('X1 choosing "Barge transfer" shows From barge and hides terminal, pre/post ops and deal', !f.before.from && f.before.terminal && f.after.from && !f.after.terminal && !f.after.preOps && !f.after.deal && /To barge/.test(f.label) && f.btn === 'Add Transfer', f);
    check('X1 the estimate uses the giving barge\'s pump rate + hose-up (1,500 MT ÷ 300 = 5h, + 6h hose)', f.pump === '5h at 300 MT/h' && /^11h \(incl\. hose-up 6h\)$/.test(f.dur), f);
    const r = await A.page.evaluate(async () => {
      submitLoadingForm(); await _waitForSaveIdle();
      const rec = _loadingRecords.find(x => x.kind === 'transfer');
      return rec && { kind: rec.kind, from: rec.fromBarge, to: rec.barge, terminal: rec.terminal, hrs: rec.estimatedHours, pump: rec.pumpHours, hose: rec.hoseHours, span: (new Date(rec.endAt) - new Date(rec.startAt)) / 3600000, deal: 'dealId' in rec, h: new Date(rec.startAt).getHours(), alerts: window.__alerts.slice(), confirms: window.__confirms.length };
    });
    check('X1 Add Transfer saves {kind:transfer, FNSA 10 → FNSA 11}, 11h window, no terminal, no deal', r && r.kind === 'transfer' && r.from === 'FNSA 10' && r.to === 'FNSA 11' && r.terminal === '' && r.hrs === 11 && r.pump === 5 && r.hose === 6 && r.span === 11 && !r.deal && r.h === 8 && !r.alerts.length && !r.confirms, r);
    const saved = (U.row(db).payload.state.loadingRecords || []).find(x => x.kind === 'transfer');
    check('X1 it reaches the cloud', !!saved && saved.fromBarge === 'FNSA 10', saved);
    const v = await A.page.evaluate(async () => {
      const k = document.getElementById('ld-kind'); k.value = 'transfer'; k.dispatchEvent(new Event('change'));
      document.getElementById('ld-from-barge').value = 'FNSA 11'; document.getElementById('ld-barge').value = 'FNSA 11';
      document.getElementById('ld-qty').value = '100';
      const n = _loadingRecords.length; addLoadingRecord(); const same = _loadingRecords.length === n;
      document.getElementById('ld-from-barge').value = 'FNSA 10'; document.getElementById('ld-qty').value = '';
      addLoadingRecord(); const noQty = _loadingRecords.length === n;
      // picking the same barge on the "from" side moves the receiving side off it
      document.getElementById('ld-barge').value = 'FNSA 10'; _ldSyncFromBarge();
      return { same, noQty, alerts: window.__alerts.slice(), to: document.getElementById('ld-barge').value };
    });
    check('X1 the same barge on both sides / no quantity → refused with a message', v.same && v.noQty && v.alerts.some(a => /two different barges/.test(a)) && v.alerts.some(a => /quantity greater than 0/.test(a)) && v.to === 'FNSA 11', v);
  });

  await scenario('X2 calendar, list, timeline, dashboard', async (openT) => {
    const db = H.createDb({ workspace: seed([xfer('x1', 2, 13), { id: 'l1', barge: 'FNSA 11', grade: 'VLSFO', terminal: 'VOPAK', qty: 3000, startAt: iso(30), endAt: iso(41), preOpsHours: 2.5, postOpsHours: 3.5, pumpHours: 5, estimatedHours: 11, endOverridden: false, updatedAt: NOW }]), realtime: false });
    const A = await openT(db, 'user-operator');
    const c = await A.page.evaluate(() => {
      showPage('dashboard'); renderWeekCalendar(0);
      const t = document.querySelector('.cal-ticket-transfer');
      return t && { text: t.textContent.replace(/\s+/g, ' ').trim(), bg: t.getAttribute('style'), loadClass: t.classList.contains('cal-ticket-loading'), title: t.getAttribute('title'), onclick: t.getAttribute('onclick'),
        // Classic: solid purple; Harbour: light purple (like its light loading tickets)
        bgColor: getComputedStyle(t).backgroundColor, purple: (() => { const p = document.createElement('div'); p.style.background = document.documentElement.dataset.skin === 'harbour' ? 'var(--purple-lt)' : 'var(--purple)'; document.body.appendChild(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; })(),
        loads: document.querySelectorAll('.cal-ticket-loading').length };
    });
    check('X2 the calendar shows the transfer as a purple ticket: TRANSFER · VLSFO, FNSA 10 → FNSA 11, 1,500', c && /TRANSFER/.test(c.text) && /VLSFO/.test(c.text) && /FNSA 10 → FNSA 11/.test(c.text) && /1,500/.test(c.text) && !c.loadClass && c.bgColor === c.purple && /editLoadingRecord\('x1'\)/.test(c.onclick) && c.loads >= 1, c);
    const l = await A.page.evaluate(() => {
      showPage('loading');
      const row = document.querySelector('#loading-list .ld-row-transfer');
      return { row: row && row.textContent.replace(/\s+/g, ' '), kpiTotal: document.getElementById('ld-kpi-total').textContent, kpiV: document.getElementById('ld-kpi-vlsfo').textContent, rows: document.querySelectorAll('#loading-list .card').length };
    });
    check('X2 the Loading list shows a purple TRANSFER row "Barge transfer — FNSA 10 → FNSA 11"; KPIs count only the terminal loading', l.row && /TRANSFER/.test(l.row) && /Barge transfer — FNSA 10 → FNSA 11/.test(l.row) && /Pump 5h · Hose 6h/.test(l.row) && l.kpiTotal === '1' && l.kpiV === '3,000' && l.rows === 2, l);
    const tl = await A.page.evaluate(() => {
      showPage('schedule'); addVessel(); const id = document.querySelector('.vcard[id^="vessel-"]').id.replace('vessel-', '');
      document.getElementById('v' + id + '-name').value = 'SOME VESSEL'; document.getElementById('v' + id + '-vlsfo').value = '300';
      const d = new Date(Date.now() + 40 * 3600000), M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      document.getElementById('v' + id + '-eta').value = String(d.getDate()).padStart(2, '0') + ' ' + M[d.getMonth()] + ' ' + d.getFullYear() + ' 10:00';
      calculate(); window.__tlAlerts = window.__alerts.slice();
      return [...document.querySelectorAll('.tli-transfer')].map(e => [e.closest('[id^="tl-"]').id, e.textContent.replace(/\s+/g, ' ')]);
    });
    check('X2 both barges\' timelines show the transfer (discharges FNSA 10 / receives FNSA 11)', tl.length === 2 && new Set(tl.map(x => x[0])).size === 2 && tl.every(x => /Barge transfer — FNSA 10 → FNSA 11/.test(x[1]) && /Discharges ?FNSA 10/.test(x[1]) && /Receives ?FNSA 11/.test(x[1])), tl);
    const d = await A.page.evaluate(() => { showPage('dashboard'); _refreshLoadingConsumers(); return document.getElementById('dash-activity-feed').textContent.replace(/\s+/g, ' '); });
    check('X2 the dashboard feed says "Barge Transfer Scheduled — FNSA 10 → FNSA 11"', /Barge Transfer Scheduled — VLSFO/.test(d) && /FNSA 10 → FNSA 11 — 1,500 MT VLSFO/.test(d), d.slice(0, 400));
  });

  await scenario('X3 both barges are busy', async (openT) => {
    const db = H.createDb({ workspace: seed([xfer('x1', 20, 31)]), realtime: false });
    const A = await openT(db, 'user-operator');
    const p = await A.page.evaluate(() => {
      const rec = _loadingRecords.find(x => x.id === 'x1');
      const mid = new Date(new Date(rec.startAt).getTime() + 3 * 3600000);
      const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const f = d => String(d.getDate()).padStart(2, '0') + ' ' + M[d.getMonth()] + ' ' + d.getFullYear() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      addVessel(); addVessel();
      const cards = [...document.querySelectorAll('.vcard[id^="vessel-"]')].map(c => c.id.replace('vessel-', ''));
      [['ON TEN', '1'], ['ON ELEVEN', '2']].forEach(([n, b], i) => { const id = cards[i]; document.getElementById('v' + id + '-name').value = n; document.getElementById('v' + id + '-vlsfo').value = '300'; document.getElementById('v' + id + '-eta').value = f(mid); document.getElementById('v' + id + '-barge').value = b; });
      calculate();
      const end = new Date(rec.endAt).getTime();
      const out = _lastSched.map(i => ({ n: i.name, b: i.bargeLabel, startAfterEnd: new Date(i.bargeStart).getTime() >= end, start: new Date(i.bargeStart).toISOString() }));
      const tl10 = _getBargeTimeline(1, 'FNSA 10').filter(o => o.transferId === 'x1').length, tl11 = _getBargeTimeline(2, 'FNSA 11').filter(o => o.transferId === 'x1').length;
      const blocksList = _blocksForBarge(1, 'FNSA 10').length + _blocksForBarge(2, 'FNSA 11').length; // not listed with the Unavailable blocks
      const r = _freeWindowsWeekRange();
      const fw = [1, 2].map(id => { const rows = computeFreeWindows(id, id === 1 ? 'FNSA 10' : 'FNSA 11', r.weekStart, r.weekEnd);
        return { freeInside: rows.some(w => !w.kind && new Date(w.start) < new Date(rec.endAt) && new Date(w.end) > new Date(rec.startAt)), busy: rows.some(w => w.kind === 'block' && /Barge transfer FNSA 10 → FNSA 11/.test(w.label)) }; });
      return { out, tl10, tl11, blocksList, fwInside: fw, end: rec.endAt };
    });
    check('X3 the planner moves a vessel on FNSA 10 AND one on FNSA 11 out of the transfer window', p.out.length === 2 && p.out.every(x => x.startAfterEnd), p);
    check('X3 both barges\' timelines (Availability Check / Free Windows / conflicts) carry the transfer; not listed as Unavailable blocks', p.tl10 === 1 && p.tl11 === 1 && p.blocksList === 0, p);
    check('X3 Free Windows shows the transfer as busy and offers no free window overlapping it, on either barge', p.fwInside.every(x => !x.freeInside && x.busy), p.fwInside);
    const w = await A.page.evaluate(async () => {
      showPage('loading');
      const rec = _loadingRecords.find(x => x.id === 'x1'); const s = new Date(new Date(rec.startAt).getTime() + 2 * 3600000);
      const k = document.getElementById('ld-kind'); k.value = 'loading'; k.dispatchEvent(new Event('change'));
      document.getElementById('ld-barge').value = 'FNSA 10'; document.getElementById('ld-terminal').value = 'GPS'; document.getElementById('ld-qty').value = '900';
      document.getElementById('ld-start-date').value = _localDateInputStr(s); document.getElementById('ld-start-time').value = _localTimeInputStr(s);
      window.__confirms = []; addLoadingRecord(); await _waitForSaveIdle();
      return window.__confirms.slice();
    });
    check('X3 a loading on the giving barge inside the window warns once, naming the transfer', w.length === 1 && /FNSA 10 is already committed/.test(w[0]) && (w[0].match(/Barge transfer FNSA 10 → FNSA 11/g) || []).length === 1 && !/Barge unavailable/.test(w[0]), w);
    const w2 = await A.page.evaluate(async () => {
      const rec = _loadingRecords.find(x => x.id === 'x1'); const s = new Date(new Date(rec.startAt).getTime() + 1 * 3600000);
      const k = document.getElementById('ld-kind'); k.value = 'transfer'; k.dispatchEvent(new Event('change'));
      document.getElementById('ld-from-barge').value = 'FNSA 11'; document.getElementById('ld-barge').value = 'FNSA 10'; document.getElementById('ld-qty').value = '200';
      document.getElementById('ld-start-date').value = _localDateInputStr(s); document.getElementById('ld-start-time').value = _localTimeInputStr(s);
      window.__confirms = []; addLoadingRecord(); await _waitForSaveIdle();
      return window.__confirms.slice();
    });
    check('X3 a second transfer overlapping it warns for both barges', w2.length === 1 && /FNSA 11 is already committed/.test(w2[0]) && /FNSA 10 is already committed/.test(w2[0]) && /Save this transfer anyway/.test(w2[0]), w2);
  });

  await scenario('X4 no stock, no deal, Done without BL', async (openT) => {
    const db = H.createDb({ workspace: seed([xfer('x1', 2, 13)]), realtime: false });
    const A = await openT(db, 'user-operator');
    const s = await A.page.evaluate(() => {
      showPage('deals');
      const opts = [...document.querySelectorAll('.deal-card select option')].map(o => o.value);
      return { loads: _loadingsForBargeName('FNSA 11').length + _loadingsForBargeName('FNSA 10').length, xfers: _transfersForBargeName('FNSA 11').length + _transfersForBargeName('FNSA 10').length, linkable: opts.includes('x1') };
    });
    check('X4 the transfer is not a loading for the stock forecast and cannot be linked to a deal', s.loads === 0 && s.xfers === 2 && !s.linkable, s);
    const d = await A.page.evaluate(async () => {
      showPage('loading');
      const btn = [...document.querySelectorAll('#loading-list .ld-row-transfer button')].find(b => /Done/.test(b.textContent));
      btn.click(); await _waitForSaveIdle();
      const r = _loadingRecords.find(x => x.id === 'x1');
      renderWeekCalendar(0);
      return { completed: r.completed, bl: 'blQty' in r, modal: document.getElementById('bl-modal').style.display, toast: window.__toasts.join(' | '), cal: document.querySelectorAll('.cal-ticket-transfer').length,
        rob: getBarges().map(b => [b.vrob, b.mrob]), rowBtns: [...document.querySelectorAll('#loading-list .ld-row-transfer button')].map(b => b.textContent.trim() || b.title) };
    });
    check('X4 Done completes it without the BL prompt, says to update both ROBs by hand, ROB unchanged, off the calendar', d.completed && !d.bl && d.modal !== 'flex' && /update ROB for FNSA 10 and FNSA 11/.test(d.toast) && d.cal === 0 && JSON.stringify(d.rob) === JSON.stringify([[3000, 300], [400, 400]]) && !d.rowBtns.includes('BL'), d);
  });

  await scenario('X5 edit and switch type', async (openT) => {
    const db = H.createDb({ workspace: seed([xfer('x1', 2, 13, { notes: 'self cargo' })]), realtime: false });
    const A = await openT(db, 'user-operator');
    const e = await A.page.evaluate(() => {
      showPage('loading'); editLoadingRecord('x1');
      return { kind: document.getElementById('ld-kind').value, from: document.getElementById('ld-from-barge').value, to: document.getElementById('ld-barge').value, btn: document.getElementById('loading-submit-btn-label').textContent, qty: document.getElementById('ld-qty').value };
    });
    check('X5 Edit fills the transfer form (type, from, to, qty) and says "Update Transfer"', e.kind === 'transfer' && e.from === 'FNSA 10' && e.to === 'FNSA 11' && e.btn === 'Update Transfer' && e.qty === '1500', e);
    const u = await A.page.evaluate(async () => {
      document.getElementById('ld-qty').value = '3000'; submitLoadingForm(); await _waitForSaveIdle();
      const r1 = Object.assign({}, _loadingRecords.find(x => x.id === 'x1'));
      editLoadingRecord('x1');
      const k = document.getElementById('ld-kind'); k.value = 'loading'; k.dispatchEvent(new Event('change'));
      document.getElementById('ld-terminal').value = 'VOPAK'; submitLoadingForm(); await _waitForSaveIdle();
      const r2 = _loadingRecords.find(x => x.id === 'x1');
      return { r1: [r1.qty, r1.estimatedHours, r1.kind], r2: { kind: r2.kind, from: r2.fromBarge, hose: r2.hoseHours, terminal: r2.terminal, est: r2.estimatedHours }, btn: document.getElementById('loading-submit-btn-label').textContent };
    });
    check('X5 updating the quantity recomputes the window (3,000 ÷ 300 + 6 = 16h)', u.r1[0] === 3000 && u.r1[1] === 16 && u.r1[2] === 'transfer', u);
    check('X5 switching it back to a terminal loading drops kind / from barge / hose and uses the terminal rate', u.r2.kind === undefined && u.r2.from === undefined && u.r2.hose === undefined && u.r2.terminal === 'VOPAK' && u.r2.est === 16, u);
  });

  await scenario('X6 sync, merge, trader, hostile names', async (openT) => {
    const db = H.createDb({ workspace: seed([xfer('x9', 30, 41, { fromBarge: 'FNSA 10<img src=x onerror=window.__pwn=1>', notes: '<b>n</b>' })]), realtime: false });
    const A = await openT(db, 'user-operator');
    const B = await openT(db, 'user-operator2');
    await A.page.evaluate(async () => {
      showPage('loading');
      const k = document.getElementById('ld-kind'); k.value = 'transfer'; k.dispatchEvent(new Event('change'));
      document.getElementById('ld-from-barge').value = 'FNSA 11'; document.getElementById('ld-barge').value = 'FNSA 10';
      document.getElementById('ld-grade').value = 'LSMGO'; document.getElementById('ld-qty').value = '200';
      const t = new Date(); t.setDate(t.getDate() + 1); document.getElementById('ld-start-date').value = _localDateInputStr(t); document.getElementById('ld-start-time').value = '10:00';
      submitLoadingForm(); await _waitForSaveIdle();
    });
    const b = await B.page.evaluate(async () => {
      await _pollOnce(true); showPage('dashboard'); renderWeekCalendar(0);
      const r = _loadingRecords.find(x => x.kind === 'transfer' && x.fromBarge === 'FNSA 11');
      return r && { est: r.estimatedHours, grade: r.grade, cal: [...document.querySelectorAll('.cal-ticket-transfer')].map(t => t.textContent.replace(/\s+/g, ' ')).join(' | ') };
    });
    check('X6 another device gets the transfer (LSMGO 200 ÷ 100 + 6 = 8h) and shows it purple on its calendar', b && b.est === 8 && b.grade === 'LSMGO' && /FNSA 11 → FNSA 10/.test(b.cal), b);
    const m = await A.page.evaluate(() => {
      const base = { id: 'x1', kind: 'transfer', fromBarge: 'FNSA 11', barge: 'FNSA 10', grade: 'VLSFO', qty: 1000, startAt: '2026-12-01T08:00:00.000Z', endAt: '2026-12-01T18:00:00.000Z', preOpsHours: 0, postOpsHours: 0, pumpHours: 4, hoseHours: 6, estimatedHours: 10, endOverridden: false };
      const L = Object.assign({}, base, { qty: 2000, pumpHours: 8, estimatedHours: 14, endAt: '2026-12-01T22:00:00.000Z' });
      const R = Object.assign({}, base, { startAt: '2026-12-01T10:00:00.000Z', endAt: '2026-12-01T20:00:00.000Z' });
      const merged = { state: { barges: [{ name: 'FNSA 11', vtph: 250, mtph: 100 }], loadingConfig: { rateVLSFO: 300, rateLSMGO: 150 }, loadingRecords: [Object.assign({}, L, { startAt: R.startAt, endAt: R.endAt })] } };
      const out = _mergeLoadingDerived(merged, { state: { loadingRecords: [L] } }, { state: { loadingRecords: [R] } }).state.loadingRecords[0];
      return { pump: out.pumpHours, est: out.estimatedHours, end: out.endAt };
    });
    check('X6 merging a quantity change with a start change recomputes with the GIVING barge\'s rate (2,000 ÷ 250 + 6 = 14h)', m.pump === 8 && m.est === 14 && m.end === '2026-12-02T00:00:00.000Z', m);
    const x = await A.page.evaluate(() => {
      showPage('loading'); const row = [...document.querySelectorAll('#loading-list .ld-row-transfer')].find(r => /self|img/.test(r.textContent));
      showPage('schedule'); calculate();
      return { pwn: !!window.__pwn, imgs: document.querySelectorAll('#loading-list img, .tli-transfer img, .cal-ticket-transfer img, #dash-activity-feed img').length, row: row.textContent.includes('FNSA 10<img'), bTags: row.querySelectorAll('b').length };
    });
    check('X6 a hostile barge name / note shows as text (list, timeline, calendar, feed)', !x.pwn && x.imgs === 0 && x.row && x.bTags === 0, x);
    const T = await openT(db, 'user-trader');
    const t = await T.page.evaluate(() => { showPage('dashboard'); renderWeekCalendar(0); return document.querySelectorAll('.cal-ticket-transfer').length; });
    check('X6 a trader sees the transfers on the calendar', t >= 1, t);
  });

  await scenario('X7 review fixes', async (openT) => {
    const db = H.createDb({ workspace: seed([xfer('x1', 2, 13), { id: 'l1', barge: 'FNSA 11', grade: 'VLSFO', terminal: 'VOPAK', qty: 3000, startAt: iso(-60), endAt: iso(-49), updatedAt: NOW }]), realtime: false });
    const A = await openT(db, 'user-operator');
    const p = await A.page.evaluate(() => {
      showPage('loading'); editLoadingRecord('x1'); cancelLoadingEdit();
      const before = document.getElementById('ld-kind').value;
      const orig = _bargeStockForecast;
      _bargeStockForecast = () => ({ recs: [{ key: 'k1', bargeName: 'FNSA 11', grade: 'VLSFO', qty: 2000, planStart: new Date(Date.now() + 50 * 3600000), vessel: 'V', jobStart: new Date(), reloadBy: new Date() }] });
      try { rlPlanLoading('2', 'k1', 168); } finally { _bargeStockForecast = orig; }
      const vis = id => getComputedStyle(document.getElementById(id).closest('.field')).display !== 'none';
      return { before, kind: document.getElementById('ld-kind').value, terminal: document.getElementById('ld-terminal').value, termVis: vis('ld-terminal'), btn: document.getElementById('loading-submit-btn-label').textContent };
    });
    check('X7 "Plan this loading" after a transfer edit fills a TERMINAL loading (type reset, terminal shown, "Add Loading")', p.before === 'transfer' && p.kind === 'loading' && p.terminal === 'VOPAK' && p.termVis && p.btn === 'Add Loading', p);
    const lb = await A.page.evaluate(() => {
      editLoadingRecord('x1'); const k = document.getElementById('ld-kind'); k.value = 'loading'; k.dispatchEvent(new Event('change'));
      const a = document.getElementById('loading-submit-btn-label').textContent; cancelLoadingEdit(); return a;
    });
    check('X7 switching the type while editing keeps the button an Update ("Update Loading")', lb === 'Update Loading', lb);
    const m = await A.page.evaluate(() => {
      const b = { id: 'm1', barge: 'FNSA 11', terminal: 'VOPAK', grade: 'VLSFO', qty: 3000, startAt: '2026-12-01T08:00:00.000Z', endAt: '2026-12-01T24:00:00.000Z', updatedAt: 1 };
      const L = Object.assign({}, b, { kind: 'transfer', fromBarge: 'FNSA 10', terminal: '', updatedAt: 3 });
      const R = Object.assign({}, b, { dealId: 'deal_1', completed: true, blQty: 2990, blDate: '2026-12-02', updatedAt: 2 });
      const out = _merge3([b], [L], [R], 'loadingRecords', { conflicts: [] }, 'loadingRecords')[0];
      return { kind: out.kind, deal: 'dealId' in out, bl: 'blQty' in out || 'blDate' in out, completed: out.completed };
    });
    check('X7 a merge where one side made it a transfer and the other linked a deal / entered a BL keeps a clean transfer', m.kind === 'transfer' && !m.deal && !m.bl && m.completed === true, m);
    const tf = await A.page.evaluate(async () => {
      const k = document.getElementById('ld-kind'); k.value = 'transfer'; k.dispatchEvent(new Event('change'));
      document.getElementById('ld-from-barge').value = 'FNSA 10'; document.getElementById('ld-barge').value = 'FNSA 11'; document.getElementById('ld-qty').value = '600';
      const t = new Date(); t.setDate(t.getDate() + 3); document.getElementById('ld-start-date').value = _localDateInputStr(t);
      document.getElementById('ld-surveyor').value = 'SGS';
      _ldSetStartWin('AM'); submitLoadingForm(); await _waitForSaveIdle();
      const r = _loadingRecords.find(x => x.kind === 'transfer' && x.qty === 600);
      const row = [...document.querySelectorAll('#loading-list .ld-row-transfer')].find(e => /600 MT/.test(e.textContent));
      return { win: r && r.startWin, row: row && row.textContent.replace(/\s+/g, ' ') };
    });
    check('X7 a transfer with a time-frame start shows the frame and "latest end" in the list, and its surveyor', tf.win === 'AM' && /AM \(/.test(tf.row) && /Start frame/.test(tf.row) && /Surveyor: SGS/.test(tf.row), tf);
  });

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
