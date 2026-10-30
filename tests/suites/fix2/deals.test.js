/* Loading Deals: a bulk purchase (e.g. 40,000 MT) lifted a few thousand MT at a time.
   • a deal added on the Loading Deals page (Reports) — KPIs and card
   • a loading scheduled on the Loading page links to it automatically (terminal match, else the
     oldest open deal of the grade with quantity free); shown as SCHEDULED / committed
   • Mark Completed asks for the quantity per BL (default: planned), which is what the deal loses:
     lifted / left to lift / free to plan; the loading list shows the BL figure; toast says what is left
   • another grade or "No deal" chosen by hand: not linked; link / unlink from the deal card
   • over-committed and exhausted warnings; close / reopen / edit / remove (loadings unlinked)
   • the forecast's Mark Completed goes through the same BL prompt
   • two devices: deals created on both survive the merge; a BL entered on B reaches A
   • a trader cannot open the page; the What-if Planner is gone (nav, page, code)
   node suites/fix2/deals.test.js [appDir] */
const path = require('path');
if (process.argv[2]) process.env.APP_DIR = path.resolve(process.argv[2]);
const H = require(path.join(__dirname, '..', '..', 'harness', 'harness.js'));
const U = require(path.join(__dirname, '..', 'r3', 'util.js'));

let pass = 0, fail = 0;
function check(name, cond, info) {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 700)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = n => String(n).padStart(2, '0');
const fmtDT = x => `${p2(x.getDate())} ${MO[x.getMonth()]} ${x.getFullYear()} ${p2(x.getHours())}:${p2(x.getMinutes())}`;
const hrs = h => new Date(Date.now() + h * 3600000);
const VBASE = { imo: '', area: 'FUJ-A', spec: 'ISO 8217:2010', agent: 'AG', manifold: 'VESSEL MANIFOLD', remarks: '', lc: '', paq: 'no', refuelChk: false, rfv: 0, rfm: 0, rfvr: 750, rfmr: 275 };
const BARGE = { vcap: 5000, mcap: 1000, vbuf: 200, mbuf: 50, vtph: 300, mtph: 100, vrfr: 750, mrfr: 275 };
function seed(o) {
  o = o || {};
  const s = U.seedPayload({ vessels: [Object.assign({}, VBASE, { nomUid: 'n1', name: 'ERA S', type: 'VLSFO', qty: 500, mgo: 100, eta: fmtDT(hrs(30)), bargeId: '2' })] });
  s.state.barges = [Object.assign({ id: 1, name: 'FNSA 10', vrob: 3229, mrob: 260 }, BARGE), Object.assign({ id: 2, name: 'FNSA 11', vrob: 424, mrob: 486 }, BARGE)];
  s.state.loadingRecords = o.loadings || [];
  s.state.loadingDeals = o.deals || [];
  return s;
}
async function open(browser, db, uid) {
  const a = await U.open(browser, db, uid);
  await U.helpers(a);
  await a.page.evaluate(() => { window.confirm = () => true; window.alert = m => { window.__alerts = (window.__alerts || []).concat([String(m)]); }; });
  return a;
}
// Fill + submit the deal form on the Loading Deals page.
const addDeal = (p, d) => p.evaluate(async (d) => {
  showPage('deals'); dealToggleForm(true);
  document.getElementById('dl-supplier').value = d.supplier; document.getElementById('dl-terminal').value = d.terminal || '';
  document.getElementById('dl-grade').value = d.grade || 'VLSFO'; document.getElementById('dl-qty').value = d.qty;
  document.getElementById('dl-ref').value = d.ref || ''; document.getElementById('dl-notes').value = d.notes || '';
  if (d.date) document.getElementById('dl-date').value = d.date;
  dealSubmit(); await _waitForSaveIdle();
  return _loadingDeals[_loadingDeals.length - 1].id;
}, d);
// Fill + submit the loading form; returns the new record.
const addLoading = (p, l) => p.evaluate(async (l) => {
  showPage('loading');
  document.getElementById('ld-barge').value = l.barge || 'FNSA 11';
  document.getElementById('ld-grade').value = l.grade || 'VLSFO'; document.getElementById('ld-grade').dispatchEvent(new Event('change'));
  document.getElementById('ld-terminal').value = l.terminal || 'VOPAK TERMINAL'; document.getElementById('ld-terminal').dispatchEvent(new Event('input'));
  document.getElementById('ld-qty').value = l.qty; document.getElementById('ld-qty').dispatchEvent(new Event('input'));
  document.getElementById('ld-start-date').value = _localDateInputStr(new Date(Date.now() + (l.dayOffset || 1) * 86400000)); document.getElementById('ld-start-time').value = '08:00';
  const sel = document.getElementById('ld-deal');
  const before = { value: sel.value, disabled: sel.disabled, options: Array.from(sel.options).map(o => o.textContent) };
  if (l.pickDeal !== undefined) { sel.value = l.pickDeal; sel.dataset.manual = l.pickDeal ? '1' : 'none'; }
  if (l.thenTerminal) { document.getElementById('ld-terminal').value = l.thenTerminal; document.getElementById('ld-terminal').dispatchEvent(new Event('input')); }
  submitLoadingForm(); await _waitForSaveIdle();
  const r = _loadingRecords[_loadingRecords.length - 1];
  return { before: before, rec: { id: r.id, dealId: r.dealId || null, grade: r.grade, qty: r.qty, terminal: r.terminal } };
}, l);
const dealView = (p, id) => p.evaluate((id) => {
  showPage('deals');
  const d = _loadingDeals.find(x => x.id === id); const st = _dealStats(d);
  const card = document.querySelector('.deal-card[data-deal-id="' + id + '"]');
  const txt = card ? card.textContent.replace(/\s+/g, ' ').trim() : '';
  return { st: { bought: st.bought, lifted: st.lifted, committed: st.committed, remaining: st.remaining, available: st.available, liftings: st.liftings }, status: d.status, txt: txt.slice(0, 900),
    rows: card ? Array.from(card.querySelectorAll('.deal-tbl tbody tr')).map(tr => Array.from(tr.children).map(td => td.textContent.replace(/\s+/g, ' ').trim())) : [],
    warn: card && card.querySelector('.deal-warn') ? card.querySelector('.deal-warn').textContent.trim() : '',
    kpi: ['deal-kpi-open', 'deal-kpi-v', 'deal-kpi-m', 'deal-kpi-committed'].map(k => document.getElementById(k).textContent) };
}, id);

(async () => {
  const browser = await H.launch();
  const scenario = async (name, fn) => {
    console.log('— ' + name);
    const apps = [];
    try { await fn(async (db, uid) => { const a = await open(browser, db, uid); apps.push(a); return a; }); }
    catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
    const errs = [].concat(...apps.map(a => U.realErrors(a)));
    check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
    for (const a of apps) await a.ctx.close();
  };

  /* D1 — deal → loading links automatically → BL on completion draws it down */
  await scenario('D1 deal, auto-link, BL drawdown', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db, 'user-operator');
    const dealId = await addDeal(A.page, { supplier: 'VITOL', terminal: 'VOPAK TERMINAL', grade: 'VLSFO', qty: 40000, ref: 'CTR-2026-014' });
    let v = await dealView(A.page, dealId);
    check('D1 the deal is on the page: bought 40,000, nothing lifted, 40,000 left; KPIs 1 open deal / 40,000 VLSFO left', v.st.bought === 40000 && v.st.lifted === 0 && v.st.remaining === 40000 && v.status === 'open' && /VITOL/.test(v.txt) && /CTR-2026-014/.test(v.txt) && v.kpi[0] === '1' && v.kpi[1] === '40,000' && v.kpi[2] === '0', v);
    check('D1 …saved to the cloud (loadingDeals)', (U.row(db).payload.state.loadingDeals || []).some(d => d.id === dealId && d.qty === 40000 && d.supplier === 'VITOL'), U.row(db).payload.state.loadingDeals);
    const l1 = await addLoading(A.page, { terminal: 'VOPAK TERMINAL', qty: 4500 });
    check('D1 the Loading form pre-selects the deal (terminal match) and the saved loading carries its id', l1.before.value === dealId && l1.rec.dealId === dealId && /VITOL/.test(l1.before.options[1] || '') && /40,000 MT available/.test(l1.before.options[1] || ''), l1);
    v = await dealView(A.page, dealId);
    check('D1 scheduled: 4,500 committed, still 40,000 left, 35,500 free to plan; row SCHEDULED', v.st.committed === 4500 && v.st.remaining === 40000 && v.st.available === 35500 && v.rows.length === 1 && /SCHEDULED/.test(v.rows[0].join(' ')) && v.kpi[3] === '4,500', v);
    // Mark Completed → BL prompt
    const m = await A.page.evaluate((id) => {
      showPage('loading'); window.__toasts = [];
      completeLoadingPrompt(id);
      const modal = document.getElementById('bl-modal');
      return { shown: modal.style.display === 'flex', def: document.getElementById('bl-qty').value, preview: document.getElementById('bl-deal').textContent.replace(/\s+/g, ' '), completed: !!_loadingRecords.find(r => r.id === id).completed };
    }, l1.rec.id);
    check('D1 Mark Completed opens the BL prompt: default = planned 4,500, preview "40,000 MT → 35,500 MT after this BL", nothing completed yet', m.shown && m.def === '4500' && /40,000 MT → 35,500 MT/.test(m.preview) && !m.completed, m);
    const c = await A.page.evaluate(async (id) => {
      document.getElementById('bl-qty').value = '4312'; document.getElementById('bl-qty').dispatchEvent(new Event('input'));
      const preview = document.getElementById('bl-deal').textContent.replace(/\s+/g, ' ');
      blConfirm(); await _waitForSaveIdle();
      const r = _loadingRecords.find(x => x.id === id);
      return { preview, completed: r.completed, blQty: r.blQty, modalHidden: document.getElementById('bl-modal').style.display === 'none', list: document.getElementById('loading-list').textContent.replace(/\s+/g, ' '), toasts: window.__toasts };
    }, l1.rec.id);
    check('D1 BL 4,312 confirmed: loading Completed with blQty 4312, list shows "BL 4,312 MT", toast says 35,688 MT left', c.completed === true && c.blQty === 4312 && c.modalHidden && /35,688 MT after this BL/.test(c.preview) && /BL 4,312 MT/.test(c.list) && c.toasts.some(t => /BL 4,312 MT VLSFO/.test(t) && /35,688 MT left to lift/.test(t)), c);
    v = await dealView(A.page, dealId);
    check('D1 the deal: lifted 4,312 (1 loading), 35,688 left, nothing committed; row LIFTED 4,312', v.st.lifted === 4312 && v.st.liftings === 1 && v.st.remaining === 35688 && v.st.committed === 0 && v.st.available === 35688 && /LIFTED/.test(v.rows[0].join(' ')) && v.rows[0][4] === '4,312' && v.kpi[1] === '35,688', v);
    const cloud = U.row(db).payload.state.loadingRecords.find(r => r.id === l1.rec.id);
    check('D1 …the cloud copy of the loading has dealId + blQty', cloud && cloud.dealId === dealId && cloud.blQty === 4312 && cloud.completed === true, cloud);
    // BL corrected later from the list
    const e = await A.page.evaluate(async (id) => { editLoadingBl(id); document.getElementById('bl-qty').value = '4300'; blConfirm(); await _waitForSaveIdle(); return { bl: _loadingRecords.find(x => x.id === id).blQty, rem: _dealStats(_loadingDeals[0]).remaining }; }, l1.rec.id);
    check('D1 the BL figure can be corrected afterwards (4,300 → 35,700 left)', e.bl === 4300 && e.rem === 35700, e);
  });

  /* D2 — what does NOT link; manual "No deal"; link / unlink from the card */
  await scenario('D2 linking rules', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db, 'user-operator');
    const dealId = await addDeal(A.page, { supplier: 'VITOL', terminal: 'VOPAK TERMINAL', grade: 'VLSFO', qty: 40000 });
    const mgo = await addLoading(A.page, { grade: 'LSMGO', terminal: 'VOPAK TERMINAL', qty: 300 });
    check('D2 an LSMGO loading: no VLSFO deal offered, not linked', mgo.before.value === '' && mgo.before.options.length === 1 && mgo.before.disabled && mgo.rec.dealId === null, mgo);
    const other = await addLoading(A.page, { terminal: 'FOT TERMINAL', qty: 3000 });
    check('D2 a VLSFO loading at another terminal still lifts from the only open VLSFO deal', other.before.value === dealId && other.rec.dealId === dealId, other);
    const manual = await addLoading(A.page, { terminal: 'FOT TERMINAL', qty: 2000, pickDeal: '', thenTerminal: 'VOPAK TERMINAL' });
    check('D2 "No deal" chosen by hand stays even when the terminal changes to the deal\'s', manual.rec.dealId === null, manual);
    const link = await A.page.evaluate(async ({ dealId, recId }) => {
      showPage('deals');
      const card = document.querySelector('.deal-card[data-deal-id="' + dealId + '"]'); const sel = card.querySelector('.deal-foot select');
      const opts = Array.from(sel.options).map(o => [o.value, o.textContent]);
      dealLinkLoading(dealId, recId); await _waitForSaveIdle();
      const st = _dealStats(_loadingDeals.find(d => d.id === dealId));
      const linked = _loadingRecords.find(r => r.id === recId).dealId === dealId;
      dealUnlinkLoading(recId); await _waitForSaveIdle();
      return { opts, linked, committedAfterLink: st.committed, after: _loadingRecords.find(r => r.id === recId).dealId || null, committedAfter: _dealStats(_loadingDeals.find(d => d.id === dealId)).committed };
    }, { dealId, recId: manual.rec.id });
    check('D2 the card offers the unlinked VLSFO loading (not the LSMGO one); link → committed 5,000; unlink → 3,000', link.opts.some(o => o[0] === manual.rec.id) && !link.opts.some(o => o[0] === mgo.rec.id) && link.linked && link.committedAfterLink === 5000 && link.after === null && link.committedAfter === 3000, link);
    // edit the deal
    const ed = await A.page.evaluate(async (dealId) => { showPage('deals'); dealEdit(dealId); document.getElementById('dl-qty').value = '45000'; document.getElementById('dl-ref').value = 'CTR-9'; dealSubmit(); await _waitForSaveIdle(); const d = _loadingDeals.find(x => x.id === dealId); return { qty: d.qty, ref: d.ref, n: _loadingDeals.length, formHidden: document.getElementById('deal-form-card').style.display === 'none' }; }, dealId);
    check('D2 edit: quantity 45,000 and ref updated in place (still one deal), form closed', ed.qty === 45000 && ed.ref === 'CTR-9' && ed.n === 1 && ed.formHidden, ed);
  });

  /* D3 — over-committed, exhausted, close / reopen / remove */
  await scenario('D3 warnings and lifecycle', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db, 'user-operator');
    const dealId = await addDeal(A.page, { supplier: 'ADNOC', terminal: 'FOT', grade: 'LSMGO', qty: 1000 });
    const l1 = await addLoading(A.page, { grade: 'LSMGO', terminal: 'FOT', qty: 700 });
    const l2 = await addLoading(A.page, { grade: 'LSMGO', terminal: 'FOT', qty: 500, dayOffset: 3 });
    let v = await dealView(A.page, dealId);
    check('D3 1,200 scheduled against 1,000: "exceed what is left by 200 MT", free to plan −200', /exceed what is left by 200 MT/.test(v.warn) && v.st.available === -200 && v.st.committed === 1200 && v.kpi[2] === '1,000', v);
    await A.page.evaluate(async (id) => { completeLoadingPrompt(id); document.getElementById('bl-qty').value = '1000'; blConfirm(); await _waitForSaveIdle(); }, l1.rec.id);
    v = await dealView(A.page, dealId);
    check('D3 BL 1,000 lifted: deal exhausted (0 left), KPI LSMGO left 0, the second loading still scheduled', /Exhausted/.test(v.warn) && v.st.remaining === 0 && v.st.committed === 500 && v.kpi[2] === '0', v);
    // auto-link skips an exhausted deal when another open deal of the grade has quantity free
    const deal2 = await addDeal(A.page, { supplier: 'TOTAL', terminal: 'FOT', grade: 'LSMGO', qty: 2000 });
    const l3 = await addLoading(A.page, { grade: 'LSMGO', terminal: 'FOT', qty: 400, dayOffset: 5 });
    check('D3 a new loading lifts from the deal with quantity free (TOTAL), not the exhausted one', l3.rec.dealId === deal2 && l3.before.options.length === 3, l3);
    const lc = await A.page.evaluate(async (dealId) => {
      showPage('deals'); dealClose(dealId); await _waitForSaveIdle();
      const d = _loadingDeals.find(x => x.id === dealId); const status = d.status, closedAt = !!d.closedAt; const card = document.querySelector('.deal-card[data-deal-id="' + dealId + '"]');
      const closedUi = { cls: card.className, chip: /CLOSED/.test(card.textContent), underClosed: !!card.closest('#deal-list') && Array.from(document.querySelectorAll('.deal-sec')).some(e => /Closed deals/.test(e.textContent)) };
      showPage('loading'); document.getElementById('ld-grade').value = 'LSMGO'; _ldRefreshDealSelect();
      const opts = Array.from(document.getElementById('ld-deal').options).map(o => o.value);
      showPage('deals'); dealReopen(dealId); await _waitForSaveIdle();
      return { status, closedAt, closedUi, opts, reopened: _loadingDeals.find(x => x.id === dealId).status };
    }, dealId);
    check('D3 close: status closed, shown under "Closed deals", no longer offered on the Loading form; reopen works', lc.status === 'closed' && lc.closedAt && lc.closedUi.chip && /deal-closed/.test(lc.closedUi.cls) && lc.closedUi.underClosed && !lc.opts.includes(dealId) && lc.opts.includes(deal2) && lc.reopened === 'open', lc);
    const del = await A.page.evaluate(async (dealId) => { showPage('deals'); dealDelete(dealId); await _waitForSaveIdle(); const d = _loadingDeals.find(x => x.id === dealId); return { deleted: !!d.deletedAt, card: !!document.querySelector('.deal-card[data-deal-id="' + dealId + '"]'), stillLinked: _loadingRecords.filter(r => r.dealId === dealId).length, cloudDeleted: null }; }, dealId);
    const cloudD = (U.row(db).payload.state.loadingDeals || []).find(d => d.id === dealId);
    check('D3 remove: the deal is gone from the page (soft-deleted in the cloud), its loadings unlinked', del.deleted && !del.card && del.stillLinked === 0 && cloudD && !!cloudD.deletedAt, { del, cloudD });
  });

  /* D4 — the forecast's Mark Completed uses the BL prompt */
  await scenario('D4 forecast Mark Completed', async (openT) => {
    const ended = { id: 'ld_pending', qty: 4350, barge: 'FNSA 11', grade: 'VLSFO', terminal: 'VOPAK TERMINAL', notes: '', surveyor: '', startAt: hrs(-20).toISOString(), endAt: hrs(-9).toISOString(), preOpsHours: 2.5, postOpsHours: 3.5, pumpHours: 5, estimatedHours: 11, endOverridden: false, updatedAt: Date.now(), dealId: 'deal_seed' };
    const deal = { id: 'deal_seed', supplier: 'VITOL', terminal: 'VOPAK TERMINAL', grade: 'VLSFO', qty: 40000, date: '2026-10-01', ref: '', notes: '', status: 'open', createdAt: Date.now(), updatedAt: Date.now() };
    const db = H.createDb({ workspace: seed({ loadings: [ended], deals: [deal] }), realtime: false });
    const A = await openT(db, 'user-operator');
    const r = await A.page.evaluate(async () => {
      calculate(); await _waitForSaveIdle(); window.__toasts = [];
      rlCompleteLoading('ld_pending');
      const shown = document.getElementById('bl-modal').style.display === 'flex', notYet = !_loadingRecords[0].completed;
      document.getElementById('bl-qty').value = '4280'; blConfirm(); await _waitForSaveIdle();
      return { shown, notYet, completed: _loadingRecords[0].completed, bl: _loadingRecords[0].blQty, remaining: _dealStats(_loadingDeals[0]).remaining, toasts: window.__toasts };
    });
    check('D4 the forecast button opens the BL prompt; confirming completes with BL 4,280, deal 35,720 left, toast still says to record the reload', r.shown && r.notYet && r.completed === true && r.bl === 4280 && r.remaining === 35720 && r.toasts.some(t => /BL 4,280 MT VLSFO/.test(t) && /35,720 MT left/.test(t) && /record the reload/.test(t)), r);
  });

  /* D5 — two devices */
  await scenario('D5 sync', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db, 'user-operator');
    const B = await openT(db, 'user-operator2');
    const dA = await addDeal(A.page, { supplier: 'VITOL', terminal: 'VOPAK TERMINAL', grade: 'VLSFO', qty: 40000 });
    // B has not pulled: creates its own deal → both survive the merge
    const dB = await addDeal(B.page, { supplier: 'ADNOC', terminal: 'FOT', grade: 'LSMGO', qty: 1500 });
    const cloud = U.row(db).payload.state.loadingDeals || [];
    check('D5 deals created on two devices without pulling both reach the cloud', cloud.some(d => d.id === dA) && cloud.some(d => d.id === dB), cloud.map(d => d.supplier));
    const a2 = await A.page.evaluate(async () => { await _pollOnce(true); showPage('deals'); return { n: _loadingDeals.length, names: Array.from(document.querySelectorAll('.deal-name')).map(e => e.textContent) }; });
    check('D5 A sees both after a pull', a2.n === 2 && a2.names.includes('ADNOC') && a2.names.includes('VITOL'), a2);
    const l = await addLoading(A.page, { terminal: 'VOPAK TERMINAL', qty: 4500 });
    const b2 = await B.page.evaluate(async (id) => { await _pollOnce(true); completeLoadingPrompt(id); document.getElementById('bl-qty').value = '4400'; blConfirm(); await _waitForSaveIdle(); return _dealStats(_loadingDeals.find(d => d.supplier === 'VITOL')).remaining; }, l.rec.id);
    const a3 = await A.page.evaluate(async (dA) => { await _pollOnce(true); const d = _loadingDeals.find(x => x.id === dA); showPage('deals'); return { rem: _dealStats(d).remaining, lifted: _dealStats(d).lifted, txt: document.querySelector('.deal-card[data-deal-id="' + dA + '"]').textContent.replace(/\s+/g, ' ') }; }, dA);
    check('D5 B completes A\'s loading with BL 4,400 → A sees 35,600 left after a pull', b2 === 35600 && a3.rem === 35600 && a3.lifted === 4400 && /35,600/.test(a3.txt), { b2, a3: { rem: a3.rem, lifted: a3.lifted } });
    // reload on a fresh device: deals come from the cloud
    const C = await openT(db, 'user-operator');
    await sleep(300);
    const c = await C.page.evaluate(() => { showPage('deals'); return { n: _loadingDeals.filter(d => !d.deletedAt).length, kpiV: document.getElementById('deal-kpi-v').textContent }; });
    check('D5 a fresh device loads the deals from the cloud (VLSFO left 35,600)', c.n === 2 && c.kpiV === '35,600', c);
  });

  /* D6 — trader; What-if Planner gone */
  await scenario('D6 trader and What-if gone', async (openT) => {
    const db = H.createDb({ workspace: seed({ deals: [{ id: 'deal_seed', supplier: 'VITOL', terminal: 'VOPAK TERMINAL', grade: 'VLSFO', qty: 40000, date: '2026-10-01', ref: '', notes: '', status: 'open', createdAt: Date.now(), updatedAt: Date.now() }] }), realtime: false });
    const T = await openT(db, 'user-trader');
    await sleep(500);
    const t = await T.page.evaluate(() => { showPage('deals'); return { page: _currentPage, navHidden: document.getElementById('nav-deals').style.display === 'none' }; });
    check('D6 a trader is bounced off the Loading Deals page and does not see it in the menu', t.page === 'dashboard' && t.navHidden, t);
    const A = await openT(db, 'user-operator');
    const g = await A.page.evaluate(() => {
      let threw = null; try { showPage('simulator'); } catch (e) { threw = String(e); }
      return { nav: !!document.getElementById('nav-simulator'), page: !!document.getElementById('page-simulator'), fn: typeof _simOpen, meta: !!PAGE_META.simulator, threw, navText: document.getElementById('sidebar').textContent.replace(/\s+/g, ' '), navDeals: !!document.getElementById('nav-deals'), dealsSection: document.getElementById('page-deals').dataset.section, reloadSafe: typeof _buildReloadSafe === 'function' && typeof _buildReloadSafe() === 'boolean' };
    });
    check('D6 the What-if Planner is gone (no nav item, page, code or page meta); Loading Deals sits in the Reports section', !g.nav && !g.page && g.fn === 'undefined' && !g.meta && !/What-if/.test(g.navText) && g.navDeals && g.dealsSection === 'reports' && g.reloadSafe, g);
  });

  /* D7 — review findings: the form's pick, editing, update merges, dangling deals */
  await scenario('D7 form pick and editing', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db, 'user-operator');
    const dV = await addDeal(A.page, { supplier: 'VITOL', terminal: 'VOPAK TERMINAL', grade: 'VLSFO', qty: 40000 });
    const dM = await addDeal(A.page, { supplier: 'ADNOC', terminal: 'VOPAK TERMINAL', grade: 'LSMGO', qty: 2000 });
    // (1) "Plan this loading" from the forecast while the form held the other grade
    const mgo = await addLoading(A.page, { grade: 'LSMGO', terminal: 'VOPAK TERMINAL', qty: 300 });
    const plan = await A.page.evaluate(async () => {
      calculate(); await _waitForSaveIdle();
      const fc = _bargeStockForecast(2, 7 * 24, {}); const rec = fc.recs.find(r => r.grade === 'VLSFO');
      if (!rec) return { noRec: true, recs: fc.recs };
      rlPlanLoading('2', rec.key, 7 * 24);
      const sel = document.getElementById('ld-deal');
      return { grade: document.getElementById('ld-grade').value, deal: sel.value, opts: Array.from(sel.options).map(o => o.textContent) };
    });
    check('D7 "Plan this loading" (VLSFO) after an LSMGO loading: the Deal select is refreshed to the VLSFO deal', !plan.noRec && plan.grade === 'VLSFO' && plan.deal === dV && plan.opts.some(o => /VITOL/.test(o)) && !plan.opts.some(o => /ADNOC/.test(o)), plan);
    await A.page.evaluate(() => cancelLoadingEdit());
    // (2) a stale pick of another grade is never saved
    const stale = await A.page.evaluate(async (dM) => {
      showPage('loading'); document.getElementById('ld-grade').value = 'LSMGO'; _ldRefreshDealSelect(); document.getElementById('ld-deal').value = dM; document.getElementById('ld-deal').dataset.manual = '1';
      document.getElementById('ld-grade').value = 'VLSFO'; // changed without the change event (as a script or a prefill might)
      document.getElementById('ld-terminal').value = 'VOPAK TERMINAL'; document.getElementById('ld-qty').value = '1000'; document.getElementById('ld-start-date').value = _localDateInputStr(new Date(Date.now() + 86400000));
      window.__alerts = []; const n = _loadingRecords.length; submitLoadingForm(); await _waitForSaveIdle();
      const r = { saved: _loadingRecords.length - n, alerts: window.__alerts };
      cancelLoadingEdit(); return r;
    }, dM);
    check('D7 a dealId of another grade left in the select is refused with a message, never saved', stale.saved === 0 && stale.alerts.some(a => /is for LSMGO/.test(a)), stale);
    // (3) auto-link prefers a deal with room for the whole loading
    const dOld = await A.page.evaluate(async () => { _loadingDeals.push({ id: 'deal_old', supplier: 'OLDCO', terminal: 'FOT', grade: 'VLSFO', qty: 5000, date: '2026-08-01', ref: '', notes: '', status: 'open', createdAt: 1, updatedAt: Date.now() }); _loadingRecords.push({ id: 'ld_old', qty: 4900, barge: 'FNSA 10', grade: 'VLSFO', terminal: 'FOT', startAt: new Date(Date.now() - 100 * 3600000).toISOString(), endAt: new Date(Date.now() - 90 * 3600000).toISOString(), completed: true, completedAt: Date.now(), blQty: 4900, dealId: 'deal_old', updatedAt: Date.now() }); await saveLoadingRecords(); return _dealStats(_loadingDeals.find(d => d.id === 'deal_old')).available; });
    check('D7 seed: the old FOT deal has 100 MT free', dOld === 100, dOld);
    const big = await addLoading(A.page, { terminal: 'FOT', qty: 4500, dayOffset: 2 });
    check('D7 auto-link skips the terminal-matching deal with only 100 MT free for the 40,000 MT deal that fits the 4,500 MT loading', big.rec.dealId === dV, big);
    const small = await addLoading(A.page, { terminal: 'FOT', qty: 80, dayOffset: 4 });
    check('D7 …but an 80 MT loading at FOT takes the FOT deal with 100 MT free', small.rec.dealId === 'deal_old', small);
    // (4) editing a loading whose deal is closed keeps the link (the closed deal is offered)
    await A.page.evaluate(async (dV) => { showPage('deals'); dealClose(dV); await _waitForSaveIdle(); }, dV);
    const ed = await A.page.evaluate(async (id) => {
      showPage('loading'); editLoadingRecord(id);
      const sel = document.getElementById('ld-deal'); const opts = Array.from(sel.options).map(o => o.textContent);
      document.getElementById('ld-surveyor').value = 'SGS'; submitLoadingForm(); await _waitForSaveIdle();
      const r = _loadingRecords.find(x => x.id === id); return { selVal: sel.value, opts, dealId: r.dealId || null, surveyor: r.surveyor };
    }, big.rec.id);
    check('D7 editing a loading of a CLOSED deal: the deal is offered as "closed deal", the link survives the Update', ed.opts.some(o => /VITOL.*closed deal/.test(o)) && ed.dealId === dV && ed.surveyor === 'SGS', ed);
    await A.page.evaluate(async (dV) => { showPage('deals'); dealReopen(dV); await _waitForSaveIdle(); }, dV);
    // (5) Update keeps Completed + BL set on another device meanwhile
    const B = await openT(db, 'user-operator2');
    await B.page.evaluate(() => _pollOnce(true));
    const upd = await A.page.evaluate((id) => { showPage('loading'); editLoadingRecord(id); document.getElementById('ld-notes').value = 'edited on A'; return _loadingEditingId === id; }, big.rec.id);
    await B.page.evaluate(async (id) => { completeLoadingPrompt(id); document.getElementById('bl-qty').value = '4400'; blConfirm(); await _waitForSaveIdle(); }, big.rec.id);
    const after = await A.page.evaluate(async (id) => { await _pollOnce(true); submitLoadingForm(); await _waitForSaveIdle(); const r = _loadingRecords.find(x => x.id === id); return { completed: r.completed, bl: r.blQty, notes: r.notes, dealId: r.dealId || null }; }, big.rec.id);
    const cl = U.row(db).payload.state.loadingRecords.find(r => r.id === big.rec.id);
    check('D7 an Update after a pull keeps the completion + BL 4,400 entered on another device (and the deal link)', upd && after.completed === true && after.bl === 4400 && after.notes === 'edited on A' && after.dealId === dV && cl.completed === true && cl.blQty === 4400, { after, cl: cl && [cl.completed, cl.blQty] });
    // (6) a deal removed elsewhere while this device still points a loading at it: shown as removed, offered for re-linking
    await B.page.evaluate(async (dV) => { await _pollOnce(true); dealDelete(dV); await _waitForSaveIdle(); }, dV);
    const dang = await A.page.evaluate(async (dV) => {
      _loadingRecords.push({ id: 'ld_dang', qty: 500, barge: 'FNSA 11', grade: 'VLSFO', terminal: 'VOPAK TERMINAL', startAt: new Date(Date.now() + 10 * 3600000).toISOString(), endAt: new Date(Date.now() + 20 * 3600000).toISOString(), dealId: dV, updatedAt: Date.now() + 5 });
      await saveLoadingRecords(); await _pollOnce(true); showPage('loading');
      const list = document.getElementById('loading-list').textContent.replace(/\s+/g, ' ');
      const d2 = _loadingDeals.push({ id: 'deal_new', supplier: 'NEWCO', terminal: 'VOPAK TERMINAL', grade: 'VLSFO', qty: 10000, date: '2026-10-30', ref: '', notes: '', status: 'open', createdAt: Date.now(), updatedAt: Date.now() });
      showPage('deals');
      const sel = document.querySelector('.deal-card[data-deal-id="deal_new"] .deal-foot select');
      return { removedShown: /removed — link it again/.test(list), offered: !!sel && Array.from(sel.options).some(o => o.value === 'ld_dang'), dealGone: !_dealById(dV) };
    }, dV).catch(e => ({ threw: String(e) }));
    check('D7 a loading pointing at a removed deal shows "removed" and can be linked to another deal', dang.removedShown && dang.offered && dang.dealGone, dang);
  });

  /* D8 — merge per key, Clear All Data, Wipe Cloud, edit toast */
  await scenario('D8 merge, clear, wipe', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db, 'user-operator');
    const B = await openT(db, 'user-operator2');
    const dV = await addDeal(A.page, { supplier: 'VITOL', terminal: 'VOPAK TERMINAL', grade: 'VLSFO', qty: 40000, ref: 'CTR-1' });
    const l = await addLoading(A.page, { terminal: 'VOPAK TERMINAL', qty: 4500 });
    await B.page.evaluate(() => _pollOnce(true));
    // A closes the deal and completes the loading; B (stale) edits the ref and the loading's notes
    await A.page.evaluate(async (dV, id) => { showPage('deals'); dealClose(dV); await _waitForSaveIdle(); completeLoadingPrompt(id); document.getElementById('bl-qty').value = '4400'; blConfirm(); await _waitForSaveIdle(); }, dV, l.rec.id).catch(() => {});
    await A.page.evaluate(async ({ dV, id }) => { showPage('deals'); dealClose(dV); await _waitForSaveIdle(); if (!_loadingRecords.find(r => r.id === id).completed) { completeLoadingPrompt(id); document.getElementById('bl-qty').value = '4400'; blConfirm(); await _waitForSaveIdle(); } }, { dV, id: l.rec.id });
    await B.page.evaluate(async ({ dV, id }) => { await new Promise(r => setTimeout(r, 10)); showPage('deals'); dealEdit(dV); document.getElementById('dl-ref').value = 'CTR-77'; dealSubmit(); await _waitForSaveIdle(); showPage('loading'); editLoadingRecord(id); document.getElementById('ld-notes').value = 'B note'; submitLoadingForm(); await _waitForSaveIdle(); }, { dV, id: l.rec.id });
    const cloud = U.row(db).payload.state; const cd = cloud.loadingDeals.find(d => d.id === dV), cr = cloud.loadingRecords.find(r => r.id === l.rec.id);
    check('D8 merge per key: B\'s ref edit lands without reopening the deal A closed; B\'s note lands without undoing A\'s completion + BL', cd.status === 'closed' && !!cd.closedAt && cd.ref === 'CTR-77' && cr.completed === true && cr.blQty === 4400 && cr.notes === 'B note', { cd: [cd.status, cd.ref], cr: [cr.completed, cr.blQty, cr.notes] });
    const toast = await A.page.evaluate(async (dV) => { showPage('deals'); window.__toasts = []; dealReopen(dV); await _waitForSaveIdle(); dealEdit(dV); document.getElementById('dl-qty').value = '41000'; dealSubmit(); await _waitForSaveIdle(); return window.__toasts; }, dV);
    check('D8 editing a deal toasts "Deal updated."', toast.some(t => /Deal updated\./.test(t)) && !toast.some(t => /Deal added/.test(t)), toast);
    // Clear All Data tombstones loadings + deals; B cannot union them back
    const cleared = await A.page.evaluate(async () => { await nuclearClear(); await _waitForSaveIdle(); return { deals: _loadingDeals.filter(d => !d.deletedAt).length, recs: _loadingRecords.filter(r => !r.deletedAt).length, cards: document.querySelectorAll('.deal-card').length }; });
    await B.page.evaluate(async () => { await _pollOnce(true); _loadingDeals.push({ id: 'deal_b', supplier: 'BCO', terminal: '', grade: 'LSMGO', qty: 100, date: '', ref: '', notes: '', status: 'open', createdAt: Date.now(), updatedAt: Date.now() }); await saveLoadingDeals(); });
    const st2 = U.row(db).payload.state;
    check('D8 Clear All Data: no live deal or loading in memory, on the page, or in the cloud after another device\'s save', cleared.deals === 0 && cleared.recs === 0 && cleared.cards === 0 && !(st2.loadingDeals || []).some(d => d.id === dV && !d.deletedAt) && !(st2.loadingRecords || []).some(r => r.id === l.rec.id && !r.deletedAt) && (st2.loadingDeals || []).some(d => d.id === 'deal_b'), { cleared, deals: (st2.loadingDeals || []).map(d => [d.id, !!d.deletedAt]) });
  });
  await scenario('D8b wipe cloud', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const B = await openT(db, 'user-operator2');
    await addDeal(B.page, { supplier: 'VITOL', terminal: 'VOPAK TERMINAL', grade: 'VLSFO', qty: 40000 });
    await addLoading(B.page, { terminal: 'VOPAK TERMINAL', qty: 4500 });
    await B.page.evaluate(() => { if (_syncInterval) { clearInterval(_syncInterval); _syncInterval = null; } }); // B goes quiet (closed laptop)
    const W = await openT(db, 'user-operator');
    await W.page.evaluate(async () => { window.confirm = () => true; await wipeSupabaseWorkspace().catch(() => {}); });
    await sleep(300);
    check('D8b the cloud row is gone after Wipe Cloud', !U.row(db), U.row(db) && Object.keys(U.row(db)));
    const A = await openT(db, 'user-operator');
    await A.page.evaluate(async () => { addBarge({ name: 'FNSA 12' }); await saveSharedState(); await _waitForSaveIdle(); });
    // B reopens later: its local store still holds the deal + loading — they must not come back
    await B.page.reload({ waitUntil: 'load' }); await sleep(2500); await U.helpers(B);
    const b = await B.page.evaluate(async () => { await _waitForSaveIdle(); showPage('loading'); await saveLoadingRecords(); await _waitForSaveIdle(); return { deals: _loadingDeals.filter(d => !d.deletedAt).length, recs: _loadingRecords.filter(r => !r.deletedAt).length }; });
    const st = U.row(db) && U.row(db).payload.state;
    check('D8b a device reopened after the wipe does not resurrect its local deals / loadings into the new cloud row', b.deals === 0 && b.recs === 0 && st && !(st.loadingDeals || []).length && !(st.loadingRecords || []).length, { b, st: st && { d: (st.loadingDeals || []).length, r: (st.loadingRecords || []).length } });
  });

  /* D9 — phone width, reload guard, modal keys */
  await scenario('D9 phone, reload guard, keys', async (openT) => {
    const deal = { id: 'deal_seed', supplier: 'VITOL', terminal: 'VOPAK TERMINAL', grade: 'VLSFO', qty: 40000, date: '2026-10-01', ref: '', notes: '', status: 'open', createdAt: Date.now(), updatedAt: Date.now() };
    const mk = (id, s, e, extra) => Object.assign({ id, qty: 4500, barge: 'FNSA 11', grade: 'VLSFO', terminal: 'VOPAK TERMINAL', startAt: hrs(s).toISOString(), endAt: hrs(e).toISOString(), updatedAt: Date.now(), dealId: 'deal_seed' }, extra || {});
    const db = H.createDb({ workspace: seed({ deals: [deal], loadings: [mk('l1', -50, -40, { completed: true, completedAt: Date.now(), blQty: 4312 }), mk('l2', 10, 20), mk('l3', 40, 50)] }), realtime: false });
    const A = await openT(db, 'user-operator');
    await A.page.setViewportSize({ width: 390, height: 844 });
    const ph = await A.page.evaluate(() => {
      document.querySelectorAll('#flow-welcome-overlay').forEach(e => e.remove()); showPage('deals');
      const card = document.querySelector('.deal-card'); const wrap = card.querySelector('.deal-tbl-wrap'); const btn = card.querySelector('.rl-done-btn, .deal-act .btn');
      const main = document.querySelector('.main') || document.body;
      dealToggleForm(true);
      const w = id => Math.round(document.getElementById(id).getBoundingClientRect().width);
      return { cardW: Math.round(card.getBoundingClientRect().width), wrapScroll: wrap.scrollWidth > wrap.clientWidth, wrapW: Math.round(wrap.getBoundingClientRect().width), pageScroll: main.scrollWidth, btnX: btn ? Math.round(btn.getBoundingClientRect().left) : null, supplier: w('dl-supplier'), qty: w('dl-qty'), cols: getComputedStyle(document.querySelector('.dl-g4')).gridTemplateColumns.split(' ').length };
    });
    check('D9 at 390px the liftings table pans inside the card (no page overflow) and the deal form stacks to one column', ph.wrapScroll && ph.wrapW <= ph.cardW && ph.pageScroll <= 390 && ph.cols === 1 && ph.supplier > 250 && ph.qty > 250, ph);
    await A.page.setViewportSize({ width: 1400, height: 900 });
    const rs = await A.page.evaluate(async () => {
      dealCancelEdit(); showPage('deals'); calculate(); await saveSharedState(); await _waitForSaveIdle(); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); const base = _buildReloadSafe();
      dealToggleForm(true); document.getElementById('dl-supplier').value = 'typing…'; const typing = _buildReloadSafe();
      document.getElementById('dl-supplier').value = ''; dealEdit('deal_seed'); const editing = _buildReloadSafe(); dealCancelEdit();
      completeLoadingPrompt('l2'); const modal = _buildReloadSafe(); closeBlModal(); if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      const el = document.activeElement;
      const why = { saveRunning: !!_saveRunning, queued: !!_saveQueued, pull: !!_pullRunning, syncing: _isSyncing, cbu: _cloudBaseUnknown, unsynced: _isMarkedUnsynced(), same: _lastSyncedPayload ? _samePayload(_buildLocalPayload(), _lastSyncedPayload) : 'nobase', active: el && el.tagName + '#' + el.id, ldEd: _loadingEditingId, dlEd: _dealEditingId, bl: !!_blModal, fields: ['ld-terminal','ld-qty','ld-surveyor','ld-notes','dl-supplier','dl-terminal','dl-qty','dl-ref','dl-notes'].map(id => (document.getElementById(id)||{}).value), fixed: Array.from(document.querySelectorAll('body [style*="position:fixed"], body [style*="position: fixed"]')).filter(o => { const r = o.getBoundingClientRect(); return o.id !== 'flow-welcome-overlay' && r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9; }).map(o => o.id || o.className) };
      return { base, typing, editing, modal, after: _buildReloadSafe(), why };
    });
    check('D9 the automatic new-build reload waits while a deal is being typed / edited or the BL prompt is open', rs.base === true && rs.typing === false && rs.editing === false && rs.modal === false && rs.after === true, rs);
    await A.page.evaluate(() => { showPage('loading'); });
    await A.page.click('#loading-list .btn-primary'); // Done on the first scheduled loading
    await sleep(150);
    const k1 = await A.page.evaluate(() => ({ open: document.getElementById('bl-modal').style.display === 'flex', focus: document.activeElement && document.activeElement.id }));
    await A.page.keyboard.press('Tab'); await A.page.keyboard.press('Tab'); await A.page.keyboard.press('Tab'); await A.page.keyboard.press('Tab');
    const k2 = await A.page.evaluate(() => ({ inside: !!document.activeElement.closest('#bl-modal'), id: document.activeElement.id || document.activeElement.textContent.trim() }));
    await A.page.keyboard.press('Escape');
    const k3 = await A.page.evaluate(() => ({ open: document.getElementById('bl-modal').style.display === 'flex', completed: !!_loadingRecords.find(r => r.id === 'l2').completed, focusBack: document.activeElement && document.activeElement.closest('#loading-list') !== null }));
    check('D9 BL prompt: focus starts in the quantity box, Tab stays inside the dialog, Escape closes without completing and returns focus to the list', k1.open && k1.focus === 'bl-qty' && k2.inside && !k3.open && !k3.completed && k3.focusBack, { k1, k2, k3 });
  });

  /* D10 — re-review: the pull race, an empty cloud at reopen, derived fields after a merge, pull re-render,
     the Deal select while editing, grade changes */
  await scenario('D10 pull race and empty cloud', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const B = await openT(db, 'user-operator2');
    await B.page.evaluate(() => _waitForSaveIdle());
    // a pull in flight (slow select) while the operator submits a loading, then the tab is closed before the queued save runs
    const race = await B.page.evaluate(async () => {
      const orig = window.__mockDb;
      window.__mockDb = async function(s) { const op = JSON.parse(s); if (op.table === 'abps_workspace' && op.action === 'select') await new Promise(r => setTimeout(r, 1500)); return orig(s); };
      _pollOnce(true); await new Promise(r => setTimeout(r, 100));
      showPage('loading'); document.getElementById('ld-terminal').value = 'RACE TERMINAL'; document.getElementById('ld-qty').value = '1000'; document.getElementById('ld-start-date').value = _localDateInputStr(new Date(Date.now() + 86400000));
      submitLoadingForm(); await new Promise(r => setTimeout(r, 100));
      return { queued: !!_saveQueued, pull: !!_pullRunning, flagged: _isMarkedUnsynced(), inMem: _loadingRecords.some(r => r.terminal === 'RACE TERMINAL') };
    });
    await B.page.reload({ waitUntil: 'load' }); await sleep(2500); await U.helpers(B);
    const after = await B.page.evaluate(async () => { await _waitForSaveIdle(); addBarge({ name: 'FNSA 12' }); await saveSharedState(); await _waitForSaveIdle(); return _loadingRecords.some(r => r.terminal === 'RACE TERMINAL' && !r.deletedAt); });
    check('D10 a loading submitted while a pull was in flight (tab closed before its save) survives the reload and reaches the cloud', race.queued && race.pull && race.flagged && race.inMem && after && U.row(db).payload.state.loadingRecords.some(r => r.terminal === 'RACE TERMINAL'), { race, after });
    await B.ctx.close();
    // Wipe Cloud, device reopened while the cloud is still empty
    const db2 = H.createDb({ workspace: seed(), realtime: false });
    const C = await openT(db2, 'user-operator2');
    await addDeal(C.page, { supplier: 'VITOL', terminal: 'VOPAK TERMINAL', grade: 'VLSFO', qty: 40000 });
    await addLoading(C.page, { terminal: 'VOPAK TERMINAL', qty: 4500 });
    await C.page.evaluate(() => { if (_syncInterval) { clearInterval(_syncInterval); _syncInterval = null; } });
    const W = await openT(db2, 'user-operator');
    await W.page.evaluate(async () => { window.confirm = () => true; await wipeSupabaseWorkspace().catch(() => {}); });
    await sleep(300);
    await C.page.reload({ waitUntil: 'load' }); await sleep(2500); await U.helpers(C);
    const c1 = await C.page.evaluate(() => ({ recs: _loadingRecords.filter(r => !r.deletedAt).length, deals: _loadingDeals.filter(d => !d.deletedAt).length, row: !!_lastKnownVersion }));
    const A = await openT(db2, 'user-operator');
    await A.page.evaluate(async () => { addBarge({ name: 'FNSA 12' }); await saveSharedState(); await _waitForSaveIdle(); });
    const c2 = await C.page.evaluate(async () => { await _pollOnce(true); addBarge({ name: 'FNSA 13' }); await saveSharedState(); await _waitForSaveIdle(); return { recs: _loadingRecords.filter(r => !r.deletedAt).length, deals: _loadingDeals.filter(d => !d.deletedAt).length }; });
    const st = U.row(db2) && U.row(db2).payload.state;
    check('D10 reopened while the cloud is empty after a wipe: the local loadings / deals are dropped, not re-uploaded once a new row exists', c1.recs === 0 && c1.deals === 0 && c2.recs === 0 && c2.deals === 0 && st && !(st.loadingRecords || []).length && !(st.loadingDeals || []).length, { c1, c2, st: st && [(st.loadingRecords || []).length, (st.loadingDeals || []).length] });
  });

  await scenario('D10b merge recompute, pull re-render', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db, 'user-operator');
    const B = await openT(db, 'user-operator2');
    const l = await addLoading(A.page, { terminal: 'VOPAK TERMINAL', qty: 2000 });
    await B.page.evaluate(() => _pollOnce(true));
    await A.page.evaluate(async (id) => { editLoadingRecord(id); document.getElementById('ld-qty').value = '3000'; document.getElementById('ld-qty').dispatchEvent(new Event('input')); submitLoadingForm(); await _waitForSaveIdle(); }, l.rec.id);
    await B.page.evaluate(async (id) => { showPage('loading'); editLoadingRecord(id); document.getElementById('ld-pre-ops').value = '6'; document.getElementById('ld-pre-ops').dispatchEvent(new Event('input')); submitLoadingForm(); await _waitForSaveIdle(); }, l.rec.id);
    const cr = U.row(db).payload.state.loadingRecords.find(r => r.id === l.rec.id);
    const want = await A.page.evaluate((cr) => { const pump = computeLoadingDurationHours(cr.qty, cr.grade); const total = cr.preOpsHours + pump + cr.postOpsHours; return { pump, total, end: new Date(new Date(cr.startAt).getTime() + total * 3600000).toISOString() }; }, cr);
    check('D10b qty from A + pre-ops from B: pumping, duration and end time are derived again from the merged inputs', cr.qty === 3000 && cr.preOpsHours === 6 && Math.abs(cr.pumpHours - want.pump) < 1e-9 && Math.abs(cr.estimatedHours - want.total) < 1e-9 && cr.endAt === want.end, { cr: [cr.qty, cr.preOpsHours, cr.pumpHours, cr.estimatedHours, cr.endAt], want });
    // a colleague's deal + completion show up on B's open pages after a pull
    await B.page.evaluate(() => { showPage('deals'); });
    const dV = await addDeal(A.page, { supplier: 'VITOL', terminal: 'VOPAK TERMINAL', grade: 'VLSFO', qty: 40000 });
    await A.page.evaluate(async (id) => { dealLinkLoading(_loadingDeals[0].id, id); await _waitForSaveIdle(); completeLoadingPrompt(id); document.getElementById('bl-qty').value = '2900'; blConfirm(); await _waitForSaveIdle(); }, l.rec.id);
    const b = await B.page.evaluate(async () => { await _pollOnce(true); const deals = document.querySelectorAll('#deal-list .deal-card').length; const kpi = document.getElementById('deal-kpi-v').textContent; showPage('loading'); return { deals, kpi, listNow: /BL 2,900 MT/.test(document.getElementById('loading-list').textContent) }; });
    const b2 = await A.page.evaluate(async (id) => { deleteLoadingRecord(id); await _waitForSaveIdle(); }, l.rec.id).then(() => B.page.evaluate(async () => { window.__toasts = []; editLoadingRecord(_loadingRecords[0].id); await _pollOnce(true); return { editing: _loadingEditingId, toast: window.__toasts.some(t => /removed by a colleague/.test(t)), listHasIt: /VOPAK TERMINAL/.test(document.getElementById('loading-list').textContent) }; }));
    check('D10b after a pull the open Deals page shows the colleague\'s deal (KPI 37,100 left), the list shows the BL; an edit of a loading removed elsewhere is dropped with a toast', b.deals === 1 && b.kpi === '37,100' && b.listNow && b2.editing === null && b2.toast && !b2.listHasIt, { b, b2 });
  });

  await scenario('D10c Deal select while editing, grade changes', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db, 'user-operator');
    const dV = await addDeal(A.page, { supplier: 'VITOL', terminal: 'VOPAK TERMINAL', grade: 'VLSFO', qty: 40000 });
    const dO = await addDeal(A.page, { supplier: 'OTHERCO', terminal: 'FOT', grade: 'VLSFO', qty: 10000 });
    const dM = await addDeal(A.page, { supplier: 'MGOCO', terminal: 'VOPAK TERMINAL', grade: 'LSMGO', qty: 3000 });
    const l1 = await addLoading(A.page, { terminal: 'VOPAK TERMINAL', qty: 4500 });
    await A.page.evaluate(async (dV) => { showPage('deals'); dealClose(dV); await _waitForSaveIdle(); }, dV);
    const e1 = await A.page.evaluate(async (id) => {
      showPage('loading'); editLoadingRecord(id);
      document.getElementById('ld-qty').value = '4600'; document.getElementById('ld-qty').dispatchEvent(new Event('input'));
      const afterQty = document.getElementById('ld-deal').value;
      showPage('deals'); showPage('loading');
      const afterNav = document.getElementById('ld-deal').value;
      submitLoadingForm(); await _waitForSaveIdle();
      return { afterQty, afterNav, dealId: _loadingRecords.find(r => r.id === id).dealId || null };
    }, l1.rec.id);
    check('D10c editing a loading of a closed deal: a quantity keystroke and leaving/returning to the page keep its deal; the Update keeps the link', e1.afterQty === dV && e1.afterNav === dV && e1.dealId === dV, e1);
    const e2 = await A.page.evaluate(async (id, ) => {
      editLoadingRecord(id);
      const g = document.getElementById('ld-grade'); g.value = 'LSMGO'; g.dispatchEvent(new Event('change'));
      const onMgo = { val: document.getElementById('ld-deal').value, opts: Array.from(document.getElementById('ld-deal').options).map(o => o.textContent) };
      g.value = 'VLSFO'; g.dispatchEvent(new Event('change'));
      const back = document.getElementById('ld-deal').value;
      submitLoadingForm(); await _waitForSaveIdle();
      return { onMgo, back, dealId: _loadingRecords.find(r => r.id === id).dealId || null };
    }, l1.rec.id);
    check('D10c a grade round-trip while editing: the own deal is shown as "VLSFO deal — not for this loading" on LSMGO, and is back (and kept on Update) on VLSFO', e2.onMgo.opts.some(o => /VITOL.*VLSFO deal — not for this loading/.test(o)) && e2.back === dV && e2.dealId === dV, e2);
    const e3 = await A.page.evaluate(async (dM) => {
      cancelLoadingEdit(); window.__alerts = [];
      const g = document.getElementById('ld-grade'); g.value = 'LSMGO'; g.dispatchEvent(new Event('change'));
      document.getElementById('ld-deal').value = dM; document.getElementById('ld-deal').dispatchEvent(new Event('change'));
      g.value = 'VLSFO'; g.dispatchEvent(new Event('change'));
      const afterFlip = document.getElementById('ld-deal').value;
      // a hand-picked deal of the wrong grade never saves silently
      g.value = 'LSMGO'; g.dispatchEvent(new Event('change')); document.getElementById('ld-deal').value = dM; document.getElementById('ld-deal').dispatchEvent(new Event('change'));
      document.getElementById('ld-deal').dataset.own = dM; g.value = 'VLSFO'; _ldRefreshDealSelect(); document.getElementById('ld-deal').value = dM;
      document.getElementById('ld-terminal').value = 'VOPAK TERMINAL'; document.getElementById('ld-qty').value = '500'; document.getElementById('ld-start-date').value = _localDateInputStr(new Date(Date.now() + 3 * 86400000));
      const n = _loadingRecords.length; submitLoadingForm(); await _waitForSaveIdle();
      return { afterFlip, alerts: window.__alerts, saved: _loadingRecords.length - n };
    }, dM);
    check('D10c a hand-picked LSMGO deal then a flip to VLSFO: the auto pick for VLSFO (not "No deal"); a wrong-grade deal left selected is refused with a message, not saved', e3.afterFlip === dO && e3.alerts.some(a => /is for LSMGO/.test(a)) && e3.saved === 0, e3);
    const mgoL = await addLoading(A.page, { grade: 'LSMGO', terminal: 'VOPAK TERMINAL', qty: 300 });
    const g = await A.page.evaluate(async ({ dM, id }) => {
      showPage('deals'); window.confirm = () => false; dealEdit(dM); document.getElementById('dl-grade').value = 'VLSFO'; dealSubmit(); await _waitForSaveIdle();
      const refused = { grade: _loadingDeals.find(d => d.id === dM).grade, linked: _loadingRecords.find(r => r.id === id).dealId === dM };
      window.confirm = () => true; dealEdit(dM); document.getElementById('dl-grade').value = 'VLSFO'; dealSubmit(); await _waitForSaveIdle();
      return { refused, grade: _loadingDeals.find(d => d.id === dM).grade, linked: _loadingRecords.find(r => r.id === id).dealId || null, committed: _dealStats(_loadingDeals.find(d => d.id === dM)).committed };
    }, { dM, id: mgoL.rec.id });
    check('D10c changing a deal\'s grade with loadings linked asks first; declined → unchanged; accepted → the loadings are unlinked', g.refused.grade === 'LSMGO' && g.refused.linked && g.grade === 'VLSFO' && g.linked === null && g.committed === 0, g);
  });

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
