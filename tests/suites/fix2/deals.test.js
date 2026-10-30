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
  if (l.pickDeal !== undefined) { sel.value = l.pickDeal; sel.dataset.manual = '1'; }
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

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
