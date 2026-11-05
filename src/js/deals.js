/* ══════════════════════════════════════════════════════
   LOADING DEALS — bulk purchases (e.g. 40,000 MT) lifted a few thousand MT
   at a time. A loading record names the deal it lifts from (dealId); once it
   is marked Completed the quantity on its BL (blQty) is what the deal loses.
   Scheduled (uncompleted) loadings count as committed against the balance.
   Deals live in the workspace payload (loadingDeals, merged by id) and in
   the same local store as the loading records.
   ══════════════════════════════════════════════════════ */
let _dealEditingId = null;
function _dealById(id, withDeleted) { return (_loadingDeals || []).find(function(d) { return d && d.id === id && (withDeleted || !d.deletedAt); }) || null; }
function _dealLabel(d) {
  if (!d) return '';
  return [d.supplier || 'Deal', d.ref ? d.ref : '', (Number(d.qty) || 0).toLocaleString() + ' MT ' + (d.grade === 'LSMGO' ? 'LSMGO' : 'VLSFO'), d.date ? _dealDateStr(d.date) : ''].filter(Boolean).join(' · ');
}
function _dealDateStr(ymd) {
  const d = new Date(String(ymd) + 'T00:00:00');
  return isNaN(d.getTime()) ? String(ymd) : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
// Tonnes as on the BL: up to 3 decimals, never rounded away (4,412.5 stays 4,412.5).
function _mtStr(x) { return (Math.round((Number(x) || 0) * 1000) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 }); }
// What a completed loading lifted: the BL quantity, or the planned quantity until a BL figure is entered.
function _loadingLifted(r) { return r.blQty != null && r.blQty !== '' && !isNaN(Number(r.blQty)) ? Number(r.blQty) : (Number(r.qty) || 0); }
// A lifting's BL date: the date entered (YYYY-MM-DD), else the day it was marked
// Completed (older records), else the loading's end. {ymd, entered}.
function _loadingBlDate(r) {
  if (r && /^\d{4}-\d{2}-\d{2}$/.test(String(r.blDate || ''))) return { ymd: r.blDate, entered: true };
  const t = new Date(r && (r.completedAt || r.endAt || r.startAt) || '');
  return { ymd: isNaN(t.getTime()) ? '' : _localDateInputStr(t), entered: false };
}
// The deal's liftings in BL-date order with the quantity left after each, and its scheduled loadings.
function _dealLiftingRows(d) {
  const st = _dealStats(d);
  let left = st.bought;
  const lifted = st.loadings.filter(function(r) { return r.completed; }).map(function(r) {
    const bd = _loadingBlDate(r);
    return { rec: r, blDate: bd.ymd, blDateEntered: bd.entered, qty: _loadingLifted(r), blEntered: r.blQty != null && r.blQty !== '' && !isNaN(Number(r.blQty)) };
  }).sort(function(a, b) { return String(a.blDate).localeCompare(String(b.blDate)) || ((a.rec.completedAt || 0) - (b.rec.completedAt || 0)); });
  lifted.forEach(function(x) { left -= x.qty; x.leftAfter = left; });
  const scheduled = st.loadings.filter(function(r) { return !r.completed; });
  return { st: st, lifted: lifted, scheduled: scheduled };
}
function _dealLoadings(dealId) {
  return (_loadingRecords || []).filter(function(r) { return r && !r.deletedAt && r.dealId === dealId; })
    .sort(function(a, b) { return new Date(a.startAt) - new Date(b.startAt); });
}
function _dealStats(d) {
  const ls = _dealLoadings(d.id);
  let lifted = 0, committed = 0, liftings = 0;
  ls.forEach(function(r) { if (r.completed) { lifted += _loadingLifted(r); liftings++; } else committed += Number(r.qty) || 0; });
  const bought = Number(d.qty) || 0;
  return { loadings: ls, bought: bought, lifted: lifted, liftings: liftings, committed: committed, remaining: bought - lifted, available: bought - lifted - committed };
}
// Open deals of a grade, oldest first.
function _dealsOpen(grade) {
  return (_loadingDeals || []).filter(function(d) { return d && !d.deletedAt && d.status !== 'closed' && (!grade || (d.grade === 'LSMGO' ? 'LSMGO' : 'VLSFO') === grade); })
    .sort(function(a, b) { return String(a.date || '').localeCompare(String(b.date || '')) || ((a.createdAt || 0) - (b.createdAt || 0)); });
}
// The deal a new loading lifts from: an open deal of that grade at that terminal with
// quantity still available, else the oldest open deal of the grade with quantity available,
// else any open deal of the grade (the page shows the shortfall).
function _autoDealFor(grade, terminal, qty) {
  const open = _dealsOpen(grade);
  if (!open.length) return null;
  const t = String(terminal || '').trim().toLowerCase();
  const q = Number(qty) || 0;
  const byTerminal = function(pool) { return (t && pool.find(function(d) { return String(d.terminal || '').trim().toLowerCase() === t; })) || pool[0]; };
  // Deals with room for the whole loading first, then any with quantity free, then any open deal.
  const fits = q > 0 ? open.filter(function(d) { return _dealStats(d).available >= q; }) : [];
  if (fits.length) return byTerminal(fits);
  const avail = open.filter(function(d) { return _dealStats(d).available > 0; });
  return byTerminal(avail.length ? avail : open);
}
// The Deal dropdown on the Loading form: open deals of the chosen grade, the
// matching one pre-selected unless the user picked one (or "No deal") themselves.
function _ldRefreshDealSelect(preferId, reason) {
  const sel = document.getElementById('ld-deal');
  if (!sel) return;
  const grade = document.getElementById('ld-grade')?.value || 'VLSFO';
  const terminal = document.getElementById('ld-terminal')?.value || '';
  const qty = parseFloat(document.getElementById('ld-qty')?.value) || 0;
  const open = _dealsOpen(grade);
  const cur = preferId !== undefined ? preferId : sel.value;
  // A record's own deal (remembered while it is being edited) is still offered
  // when closed or of another grade, so an edit never unlinks it silently.
  if (preferId !== undefined) { if (preferId) sel.dataset.own = preferId; else delete sel.dataset.own; }
  const ownId = preferId !== undefined ? preferId : sel.dataset.own;
  const own = ownId && !open.some(function(d) { return d.id === ownId; }) ? _dealById(ownId) : null;
  const list = own ? open.concat([own]) : open;
  sel.innerHTML = '<option value="">No deal — not deducted from a bulk purchase</option>' + list.map(function(d) {
    const st = _dealStats(d), g = d.grade === 'LSMGO' ? 'LSMGO' : 'VLSFO';
    const note = g !== grade ? g + ' deal — not for this loading' : d.status === 'closed' ? 'closed deal' : _mtStr(st.available) + ' MT available';
    return '<option value="' + esc(d.id) + '">' + esc(_dealLabel(d)) + ' — ' + esc(note) + '</option>';
  }).join('');
  const valid = function(id) { return !!id && list.some(function(d) { return d.id === id; }); };
  const ownOtherGrade = !!own && (own.grade === 'LSMGO' ? 'LSMGO' : 'VLSFO') !== grade; // the record's own deal is for the other grade
  const ownFits = valid(ownId) && !ownOtherGrade;                                            // its own deal (open or closed) fits this grade
  const manual = sel.dataset.manual; // '1' a hand pick (or the record's own deal), 'none' "No deal" by hand, 'gone' "No deal" after a pick vanished
  let want = '';
  if (preferId !== undefined) { want = valid(preferId) ? preferId : ''; sel.dataset.manual = want ? '1' : 'none'; } // the record's own deal (or none): kept
  else if (manual === 'none' || (manual === 'gone' && reason !== 'grade')) want = '';               // "No deal" (by hand, or after a vanished pick): kept
  else if (manual === '1' && valid(cur) && !(cur === ownId && ownOtherGrade)) want = cur;           // the user's own pick: kept while it fits this grade
  else if (ownFits && (!manual || manual === 'gone' || reason === 'grade')) want = ownId;            // back on the record's own grade: its own deal
  else if (reason === 'grade' || !manual || manual === 'gone') { delete sel.dataset.manual; const a = _autoDealFor(grade, terminal, qty); want = a ? a.id : ''; } // the operator changed the grade, or never picked: (re-)picked
  else {
    // The deal picked (or the record's own) was removed or closed meanwhile:
    // not silently another one — "No deal", and the operator is told.
    sel.dataset.manual = 'gone';
    if (typeof showToast === 'function') showToast('The deal this loading was to lift from is no longer available — it is not linked to a deal now. Pick one if needed.', 'warning', 7000);
  }
  // An automatic pick moved by a colleague's change (the deal closed / removed): said, not silent.
  if (reason === 'pull' && cur && want !== cur && !manual && typeof showToast === 'function') {
    const to = want ? _dealById(want) : null;
    showToast('The deal for this loading changed' + (to ? ' to ' + (to.supplier || '') : ' to "No deal"') + ' — the one shown before is no longer available.', 'info', 6000);
  }
  sel.value = want;
  sel.disabled = !list.length && !want;
}

/* Completing a loading asks for the quantity on the BL — that is what the deal loses. */
let _blModal = null;
function completeLoadingPrompt(id, opts) {
  const rec = (_loadingRecords || []).find(function(r) { return r && r.id === id; });
  if (!rec || rec.deletedAt) { showToast('That loading is no longer in the list.', 'warning'); return; }
  if (rec.completed) { showToast('That loading is already marked Completed.', 'warning'); _refreshLoadingConsumers(); return; }
  // A barge transfer has no BL and no deal — it just completes. ROB stays as the
  // operator updates it by hand on Barge Fleet (for both barges).
  if (_isTransfer(rec)) {
    markLoadingRecordDone(rec.id);
    showToast('Transfer marked done — update ROB for ' + (rec.fromBarge || 'the giving barge') + ' and ' + _resolveRecordBargeName(rec) + ' on Barge Fleet.', 'success');
    return;
  }
  _openBlModal(rec, 'complete', opts || {});
}
function editLoadingBl(id) {
  const rec = (_loadingRecords || []).find(function(r) { return r && r.id === id; });
  if (!rec || rec.deletedAt) return;
  _openBlModal(rec, 'edit', {});
}
function _openBlModal(rec, mode, opts) {
  const m = document.getElementById('bl-modal');
  if (!m) { if (mode === 'complete') markLoadingRecordDone(rec.id); return; }
  _blModal = { id: rec.id, mode: mode, opts: opts, returnFocus: document.activeElement };
  const grade = rec.grade === 'LSMGO' ? 'LSMGO' : 'VLSFO';
  document.getElementById('bl-title').textContent = mode === 'complete' ? 'Mark loading Completed' : 'BL date and quantity';
  document.getElementById('bl-sub').textContent = (rec.terminal || 'Terminal') + ' · ' + (_resolveRecordBargeName(rec) || 'barge') + ' · planned ' + _mtStr(rec.qty) + ' MT ' + grade + ' · ' + fmt24(new Date(rec.startAt));
  document.getElementById('bl-confirm-btn').textContent = mode === 'complete' ? 'Mark Completed' : 'Save';
  const q = document.getElementById('bl-qty');
  q.value = rec.blQty != null && rec.blQty !== '' ? rec.blQty : (Number(rec.qty) || '');
  // BL date: as entered before, else the loading's end day (today if it ends later).
  const bd = document.getElementById('bl-date');
  if (bd) {
    let v = /^\d{4}-\d{2}-\d{2}$/.test(String(rec.blDate || '')) ? rec.blDate : '';
    if (!v) { const end = new Date(rec.endAt), now = new Date(); v = _localDateInputStr(!isNaN(end.getTime()) && end < now ? end : now); }
    bd.value = v;
  }
  _blPreview();
  m.style.display = 'flex';
  setTimeout(function() { try { q.focus(); q.select(); } catch (e) {} }, 30);
}
function _blPreview() {
  const el = document.getElementById('bl-deal');
  if (!el || !_blModal) return;
  const rec = (_loadingRecords || []).find(function(r) { return r && r.id === _blModal.id; });
  if (!rec) return;
  const grade = rec.grade === 'LSMGO' ? 'LSMGO' : 'VLSFO';
  const q = parseFloat(document.getElementById('bl-qty').value);
  const d = rec.dealId ? _dealById(rec.dealId) : null;
  if (!d || d.deletedAt) {
    el.innerHTML = 'Not linked to a deal — nothing is deducted from a bulk purchase.' + (_dealsOpen(grade).length ? ' Link it on the <b>Loading Deals</b> page.' : '');
    return;
  }
  const st = _dealStats(d);
  // Balance without this loading's own current contribution, then with the figure typed.
  const own = rec.completed ? _loadingLifted(rec) : 0;
  const before = st.remaining + own, after = before - (isNaN(q) ? 0 : q);
  el.innerHTML = 'Deal <b>' + esc(_dealLabel(d)) + '</b><br>Left to lift: ' + esc(_mtStr(before)) + ' MT → <b>' + esc(_mtStr(after)) + ' MT</b> after this BL' +
    (after < 0 ? ' <span style="color:var(--red);font-weight:700">— more than the deal has left</span>' : '');
}
function closeBlModal() {
  const was = _blModal;
  _blModal = null;
  const m = document.getElementById('bl-modal');
  if (m) m.style.display = 'none';
  try { if (was && was.returnFocus && was.returnFocus.focus && document.contains(was.returnFocus)) was.returnFocus.focus(); } catch (e) {}
}
// Escape closes; Tab stays inside the dialog (wherever focus went).
document.addEventListener('keydown', function(e) { if (_blModal) _blModalKeys(e); });
function _blModalKeys(e) {
  if (!_blModal) return;
  if (e.key === 'Escape') { e.preventDefault(); closeBlModal(); return; }
  if (e.key !== 'Tab') return;
  const m = document.getElementById('bl-modal');
  const items = Array.from(m.querySelectorAll('input, button')).filter(function(x) { return !x.disabled && x.offsetParent !== null; });
  if (!items.length) return;
  const i = items.indexOf(document.activeElement);
  let next = e.shiftKey ? i - 1 : i + 1;
  if (i === -1) next = 0;
  if (next >= items.length) next = 0;
  if (next < 0) next = items.length - 1;
  e.preventDefault();
  items[next].focus();
}
function blConfirm() {
  if (!_blModal) return;
  const q = parseFloat(document.getElementById('bl-qty').value);
  if (isNaN(q) || q < 0) { alert('Enter the quantity loaded per BL (0 or more).'); return; }
  const bdEl = document.getElementById('bl-date'), blDate = bdEl ? String(bdEl.value || '') : '';
  if (bdEl && !/^\d{4}-\d{2}-\d{2}$/.test(blDate)) { alert('Enter the BL date.'); return; }
  const m = _blModal;
  closeBlModal();
  const rec = (_loadingRecords || []).find(function(r) { return r && r.id === m.id; });
  if (!rec || rec.deletedAt) { showToast('That loading is no longer in the list.', 'warning'); return; }
  const grade = rec.grade === 'LSMGO' ? 'LSMGO' : 'VLSFO';
  if (m.mode === 'complete') {
    if (rec.completed) { showToast('That loading is already marked Completed' + (rec.blQty != null ? ' (BL ' + _mtStr(rec.blQty) + ' MT)' : '') + '.', 'warning'); _refreshLoadingConsumers(); return; }
    markLoadingRecordDone(rec.id, q, blDate); // saves, re-renders the list, forecast and deals
    const d = rec.dealId ? _dealById(rec.dealId) : null;
    const dealTxt = d ? ' Deal ' + (d.supplier || '') + ': ' + _mtStr(_dealStats(d).remaining) + ' MT left to lift.' : '';
    if (m.opts && m.opts.fromForecast) showToast('Loading at ' + (rec.terminal || 'the terminal') + ' marked Completed (BL ' + _mtStr(q) + ' MT ' + grade + ').' + dealTxt + ' Now record the reload in the barge\'s ROB so the stock shows.', 'success', 8000);
    else showToast('Loading at ' + (rec.terminal || 'the terminal') + ' marked Completed — BL ' + _mtStr(q) + ' MT ' + grade + '.' + dealTxt, 'success', 6000);
  } else {
    rec.blQty = q; rec.blAt = Date.now(); if (blDate) rec.blDate = blDate; _touchLoading(rec);
    saveLoadingRecords();
    renderLoadingList();
    _refreshLoadingConsumers();
  }
}

/* ── Loading Deals page ── */
function saveLoadingDeals() { return saveLoadingRecords(); } // same local store + the shared workspace
function _refreshDealsIfShown() { if (_currentPage === 'deals') renderDeals(); }
function dealToggleForm(show) {
  const card = document.getElementById('deal-form-card');
  if (!card) return;
  const open = show !== undefined ? show : card.style.display === 'none';
  card.style.display = open ? '' : 'none';
  if (!open && document.activeElement && card.contains(document.activeElement)) { try { document.activeElement.blur(); } catch (e) {} }
  if (open) {
    if (!_dealEditingId) {
      const dt = document.getElementById('dl-date');
      if (dt && !dt.value) dt.value = _localDateInputStr(new Date());
      document.getElementById('deal-form-title').textContent = 'New Deal';
      document.getElementById('deal-submit-label').textContent = 'Add Deal';
    }
    try { document.getElementById('dl-supplier').focus(); } catch (e) {}
  }
}
function _readDealForm() {
  const supplier = (document.getElementById('dl-supplier')?.value || '').trim();
  const terminal = (document.getElementById('dl-terminal')?.value || '').trim();
  const grade = document.getElementById('dl-grade')?.value === 'LSMGO' ? 'LSMGO' : 'VLSFO';
  const qty = parseFloat(document.getElementById('dl-qty')?.value);
  const date = document.getElementById('dl-date')?.value || '';
  const ref = (document.getElementById('dl-ref')?.value || '').trim();
  const notes = (document.getElementById('dl-notes')?.value || '').trim();
  if (!supplier) { alert('Enter the supplier.'); return null; }
  if (isNaN(qty) || qty <= 0) { alert('Enter the quantity bought (MT), greater than 0.'); return null; }
  return { supplier: supplier, terminal: terminal, grade: grade, qty: qty, date: date, ref: ref, notes: notes };
}
function _clearDealForm() {
  ['dl-supplier', 'dl-terminal', 'dl-qty', 'dl-ref', 'dl-notes', 'dl-date'].forEach(function(id) { const el = document.getElementById(id); if (el) el.value = ''; });
  const g = document.getElementById('dl-grade'); if (g) g.value = 'VLSFO';
}
function dealSubmit() {
  const data = _readDealForm();
  if (!data) return;
  const wasEdit = !!_dealEditingId;
  if (!Array.isArray(_loadingDeals)) _loadingDeals = [];
  if (_dealEditingId) {
    const d = _dealById(_dealEditingId);
    if (!d) { showToast('That deal was removed meanwhile — your changes were not saved.', 'warning', 6000); dealCancelEdit(); renderDeals(); return; }
    if (d) {
      const oldGrade = d.grade === 'LSMGO' ? 'LSMGO' : 'VLSFO';
      const linked = oldGrade !== data.grade ? _dealLoadings(d.id) : [];
      if (linked.length && !confirm(linked.length + ' ' + oldGrade + ' loading(s) lift from this deal. Change it to ' + data.grade + ' and unlink them?')) return;
      linked.forEach(function(r) { delete r.dealId; _touchLoading(r); });
      Object.assign(d, data); _touchDeal(d);
    }
  } else {
    _loadingDeals.push(Object.assign({ id: 'deal_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), status: 'open', createdAt: Date.now(), updatedAt: Date.now() }, data));
  }
  saveLoadingDeals();
  dealCancelEdit();
  renderDeals();
  _ldRefreshDealSelect();
  showToast(wasEdit ? 'Deal updated.' : 'Deal added — loadings of this grade now lift from it.', 'success');
}
function dealEdit(id) {
  const d = _dealById(id);
  if (!d) return;
  _dealEditingId = id;
  _dealEditingSeen = d.updatedAt || null;
  document.getElementById('dl-supplier').value = d.supplier || '';
  document.getElementById('dl-terminal').value = d.terminal || '';
  document.getElementById('dl-grade').value = d.grade === 'LSMGO' ? 'LSMGO' : 'VLSFO';
  document.getElementById('dl-qty').value = d.qty || '';
  document.getElementById('dl-date').value = d.date || '';
  document.getElementById('dl-ref').value = d.ref || '';
  document.getElementById('dl-notes').value = d.notes || '';
  document.getElementById('deal-form-title').textContent = 'Edit Deal';
  document.getElementById('deal-submit-label').textContent = 'Update Deal';
  dealToggleForm(true);
  const card = document.getElementById('deal-form-card');
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function dealCancelEdit() {
  _dealEditingId = null;
  _clearDealForm();
  dealToggleForm(false);
}
function dealClose(id) {
  const d = _dealById(id); if (!d) return;
  const st = _dealStats(d);
  if (st.committed > 0 && !confirm(_mtStr(st.committed) + ' MT of scheduled loadings still lift from this deal. Close it anyway?')) return;
  d.status = 'closed'; d.closedAt = Date.now(); _touchDeal(d);
  saveLoadingDeals(); renderDeals(); _ldRefreshDealSelect();
}
function dealReopen(id) {
  const d = _dealById(id); if (!d) return;
  d.status = 'open'; delete d.closedAt; _touchDeal(d);
  saveLoadingDeals(); renderDeals(); _ldRefreshDealSelect();
}
function dealDelete(id) {
  const d = _dealById(id); if (!d) return;
  const ls = _dealLoadings(id);
  if (!confirm('Remove the deal "' + (d.supplier || '') + '"?' + (ls.length ? '\n\n' + ls.length + ' loading(s) lift from it — they stay, unlinked from any deal.' : ''))) return;
  ls.forEach(function(r) { delete r.dealId; _touchLoading(r); });
  d.deletedAt = Date.now(); d.updatedAt = Date.now();
  saveLoadingDeals(); renderDeals(); renderLoadingList(); _ldRefreshDealSelect();
}
function dealLinkLoading(dealId, loadingId) {
  if (!loadingId) return;
  const rec = (_loadingRecords || []).find(function(r) { return r && r.id === loadingId; });
  const d = _dealById(dealId);
  if (!rec || !d) return;
  rec.dealId = dealId; _touchLoading(rec);
  saveLoadingRecords(); renderDeals(); renderLoadingList();
}
function dealUnlinkLoading(loadingId) {
  const rec = (_loadingRecords || []).find(function(r) { return r && r.id === loadingId; });
  if (!rec) return;
  delete rec.dealId; _touchLoading(rec);
  saveLoadingRecords(); renderDeals(); renderLoadingList();
}
function _dealCardHtml(d, operator) {
  const st = _dealStats(d);
  const grade = d.grade === 'LSMGO' ? 'LSMGO' : 'VLSFO';
  const gc = grade === 'LSMGO' ? 'var(--fuel-m)' : 'var(--fuel-v)', gbg = grade === 'LSMGO' ? 'var(--fuel-m-lt)' : 'var(--fuel-v-lt)';
  const closed = d.status === 'closed';
  const pct = function(x) { return st.bought > 0 ? Math.max(0, Math.min(100, x / st.bought * 100)) : 0; };
  const liftedPct = pct(st.lifted), commPct = Math.min(100 - liftedPct, pct(st.committed));
  let warn = '';
  if (st.remaining <= 0) warn = '<div class="deal-warn bad">Exhausted — the whole deal has been lifted' + (st.remaining < 0 ? ' (' + _mtStr(-st.remaining) + ' MT over the quantity bought)' : '') + '.</div>';
  else if (st.available < 0) warn = '<div class="deal-warn">Scheduled loadings exceed what is left by <b>' + esc(_mtStr(-st.available)) + ' MT</b> — a loading will come up short, or a new deal is needed.</div>';
  const ldMap = _bargeColorMap();
  const lr = _dealLiftingRows(d);
  const liftById = {}; lr.lifted.forEach(function(x) { liftById[x.rec.id] = x; });
  // Liftings in BL-date order (with what is left after each), then the scheduled ones.
  const rows = lr.lifted.map(function(x) { return x.rec; }).concat(lr.scheduled).map(function(r) {
    const lx = liftById[r.id];
    const when = r.completed ? fmt24(new Date(r.completedAt || r.endAt)) : fmt24(new Date(r.startAt));
    const act = operator ? '<td class="deal-act">' +
      (r.completed ? '<button class="btn btn-secondary btn-sm" onclick="editLoadingBl(\'' + escJs(r.id) + '\')" title="BL date and quantity">BL</button> ' : '<button class="btn btn-primary btn-sm" onclick="completeLoadingPrompt(\'' + escJs(r.id) + '\')" title="Mark Completed — asks for the BL quantity">Done</button> ') +
      '<button class="btn btn-secondary btn-sm" onclick="dealUnlinkLoading(\'' + escJs(r.id) + '\')" title="Unlink from this deal">×</button></td>' : '';
    return '<tr class="' + (r.completed ? 'done' : '') + '"><td>' + (lx ? esc(_dealDateStr(lx.blDate)) + (lx.blDateEntered ? '' : ' <span title="No BL date entered — the day it was marked Completed" style="color:var(--amber)">*</span>') : esc(when)) + '</td><td>' + _bargePill(_resolveRecordBargeName(r), ldMap) + '</td><td>' + esc(r.terminal || '—') + '</td>' +
      '<td class="n">' + esc(_mtStr(r.qty)) + '</td><td class="n">' + (r.completed ? '<b>' + esc(_mtStr(_loadingLifted(r))) + '</b>' + (r.blQty == null ? ' <span title="No BL figure entered — the planned quantity is used" style="color:var(--amber)">*</span>' : '') : '—') + '</td>' +
      '<td class="n">' + (lx ? esc(_mtStr(lx.leftAfter)) : '—') + '</td>' +
      '<td>' + (r.completed ? '<span class="ld-chip" style="background:var(--green-lt);color:var(--green)">LIFTED</span>' : '<span class="ld-chip" style="background:var(--amber-lt);color:var(--amber)">SCHEDULED</span>') + '</td>' + act + '</tr>';
  });
  const linked = {}; (_loadingRecords || []).forEach(function(r) { if (r && r.dealId) linked[r.id] = 1; });
  const linkable = operator && !closed ? (_loadingRecords || []).filter(function(r) { return r && !r.deletedAt && r.kind !== 'transfer' && (!r.dealId || !_dealById(r.dealId)) && (r.grade === 'LSMGO' ? 'LSMGO' : 'VLSFO') === grade; })
    .sort(function(a, b) { return new Date(b.startAt) - new Date(a.startAt); }) : [];
  const linkSel = linkable.length ? '<select onchange="dealLinkLoading(\'' + escJs(d.id) + '\', this.value)" aria-label="Link a loading to this deal"><option value="">Link a loading of ' + esc(grade) + '…</option>' +
    linkable.map(function(r) { return '<option value="' + esc(r.id) + '">' + esc(fmt24(new Date(r.startAt)) + ' · ' + (_resolveRecordBargeName(r) || '') + ' · ' + (r.terminal || '') + ' · ' + _mtStr(r.completed && r.blQty != null ? r.blQty : r.qty) + ' MT' + (r.completed ? ' (lifted)' : '')) + '</option>'; }).join('') + '</select>' : '';
  const actions = operator ? (closed
    ? '<button class="btn btn-secondary btn-sm" onclick="dealReopen(\'' + escJs(d.id) + '\')">Reopen</button>'
    : '<button class="btn btn-secondary btn-sm" onclick="dealEdit(\'' + escJs(d.id) + '\')">Edit</button><button class="btn btn-secondary btn-sm" onclick="dealClose(\'' + escJs(d.id) + '\')" title="No more loadings lift from it; the history stays">Close deal</button>') +
    '<button class="btn btn-secondary btn-sm" onclick="dealDelete(\'' + escJs(d.id) + '\')" title="Remove">Remove</button>' : '';
  return '<div class="card deal-card' + (closed ? ' deal-closed' : '') + '" data-deal-id="' + esc(d.id) + '">' +
    '<div class="deal-head"><span class="deal-name">' + esc(d.supplier || 'Deal') + '</span>' +
      '<span class="deal-pill" style="background:' + gbg + ';color:' + gc + '">' + esc(grade) + '</span>' +
      (closed ? '<span class="deal-pill" style="background:var(--surface2);color:var(--sub)">CLOSED</span>' : '') +
      '<span class="deal-meta">' + esc([d.ref ? 'Ref ' + d.ref : '', d.date ? _dealDateStr(d.date) : '', d.terminal ? 'Lifted at ' + d.terminal : ''].filter(Boolean).join(' · ')) + '</span>' +
      (d.notes ? '<span class="deal-meta">— ' + esc(d.notes) + '</span>' : '') + '</div>' +
    warn +
    '<div class="deal-nums">' +
      '<div class="deal-num"><div class="deal-num-l">Bought</div><div class="deal-num-v">' + esc(_mtStr(st.bought)) + '</div><div class="deal-num-d">MT</div></div>' +
      '<div class="deal-num"><div class="deal-num-l">Lifted</div><div class="deal-num-v">' + esc(_mtStr(st.lifted)) + '</div><div class="deal-num-d">' + st.liftings + ' loading' + (st.liftings === 1 ? '' : 's') + ' · per BL</div></div>' +
      '<div class="deal-num"><div class="deal-num-l">Left to lift</div><div class="deal-num-v ' + (st.remaining <= 0 ? 'bad' : 'good') + '">' + esc(_mtStr(st.remaining)) + '</div><div class="deal-num-d">bought − lifted</div></div>' +
      '<div class="deal-num"><div class="deal-num-l">Scheduled</div><div class="deal-num-v' + (st.committed ? ' warn' : '') + '">' + esc(_mtStr(st.committed)) + '</div><div class="deal-num-d">loadings not yet completed</div></div>' +
      '<div class="deal-num"><div class="deal-num-l">Free to plan</div><div class="deal-num-v ' + (st.available < 0 ? 'bad' : '') + '">' + esc(_mtStr(st.available)) + '</div><div class="deal-num-d">left − scheduled</div></div>' +
    '</div>' +
    '<div class="deal-bar" title="' + esc(Math.round(liftedPct) + '% lifted, ' + Math.round(commPct) + '% scheduled') + '"><i class="lifted' + (grade === 'LSMGO' ? ' m' : '') + '" style="width:' + liftedPct.toFixed(1) + '%"></i><i class="committed" style="width:' + commPct.toFixed(1) + '%"></i></div>' +
    (rows.length ? '<div class="deal-tbl-wrap"><table class="deal-tbl"><thead><tr><th>BL date / planned</th><th>Barge</th><th>Terminal</th><th class="n">Planned MT</th><th class="n">BL qty MT</th><th class="n">Left after MT</th><th>Status</th>' + (operator ? '<th class="deal-act"></th>' : '') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>'
      : '<div class="deal-meta">No loading lifts from this deal yet — schedule one on the Loading page (it links automatically) or link an existing one below.</div>') +
    '<div class="deal-foot">' + linkSel + '<span style="flex:1"></span>' +
      '<button class="btn btn-secondary btn-sm deal-xls" onclick="dealExportLiftingExcel(\'' + escJs(d.id) + '\', this)" title="Lifting report: BL date, BL quantity and what is left after each lifting">⬇ Excel</button>' +
      '<button class="btn btn-secondary btn-sm deal-pdf" onclick="dealExportLiftingPdf(\'' + escJs(d.id) + '\', this)" title="Lifting report as PDF">⬇ PDF</button>' +
      actions + '</div>' +
  '</div>';
}
/* ── Lifting report (Excel / PDF): the deal, each lifting with its BL date,
   BL quantity and what was left after it, then the loadings still scheduled. ── */
function _dealReportData(id) {
  const d = _dealById(id, true);
  if (!d) return null;
  const lr = _dealLiftingRows(d), st = lr.st;
  const grade = d.grade === 'LSMGO' ? 'LSMGO' : 'VLSFO';
  const head = [
    ['Supplier', d.supplier || ''], ['Reference', d.ref || '—'], ['Grade', grade], ['Terminal', d.terminal || '—'],
    ['Deal date', d.date ? _dealDateStr(d.date) : '—'], ['Status', d.status === 'closed' ? 'Closed' : 'Open'],
  ];
  const sums = [['Bought', st.bought], ['Lifted (per BL)', st.lifted], ['Left to lift', st.remaining], ['Scheduled', st.committed], ['Free to plan', st.available]];
  const lifted = lr.lifted.map(function(x, i) {
    const r = x.rec;
    return { n: i + 1, blDate: _dealDateStr(x.blDate) + (x.blDateEntered ? '' : ' *'), barge: _resolveRecordBargeName(r) || '', terminal: r.terminal || '',
      planned: Number(r.qty) || 0, bl: x.qty, blMark: x.blEntered ? '' : ' *', left: x.leftAfter };
  });
  const scheduled = lr.scheduled.map(function(r) {
    return { when: fmt24(new Date(r.startAt)), barge: _resolveRecordBargeName(r) || '', terminal: r.terminal || '', planned: Number(r.qty) || 0 };
  });
  const anyStar = lr.lifted.some(function(x) { return !x.blDateEntered || !x.blEntered; });
  const safe = String((d.supplier || 'Deal') + (d.ref ? ' ' + d.ref : '') + (d.date ? ' ' + d.date : '')).replace(/[^\w.\- ]+/g, '_').trim();
  return { d: d, grade: grade, head: head, sums: sums, lifted: lifted, scheduled: scheduled, anyStar: anyStar, file: 'FLOW_Lifting_Report_' + safe.replace(/\s+/g, '_'), generated: fmt24(new Date()) };
}
async function _dealExportBusy(btn, fn) {
  const label = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = 'Preparing…'; }
  await new Promise(function(r) { setTimeout(r, 0); });
  try { await fn(); }
  catch (err) { alert('Could not create the lifting report: ' + ((err && err.message) || err)); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = label; } }
}
async function dealExportLiftingExcel(id, btn) {
  const R = _dealReportData(id);
  if (!R) { showToast('That deal is no longer in the list.', 'warning'); return; }
  await _dealExportBusy(btn, async function() {
    const ExcelJS = await _loadExcelJS();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Lifting report');
    ws.columns = [{ width: 6 }, { width: 16 }, { width: 14 }, { width: 24 }, { width: 14 }, { width: 14 }, { width: 16 }];
    const thin = { style: 'thin', color: { argb: 'FFD8E0E8' } }, border = { top: thin, bottom: thin, left: thin, right: thin };
    const title = function(r, text, font) { ws.mergeCells('A' + r + ':G' + r); const c = ws.getCell('A' + r); c.value = text; c.font = font; };
    title(1, 'Lifting report — ' + (R.d.supplier || 'Deal') + ' · ' + R.grade, { bold: true, size: 14, color: { argb: 'FF0D1B2A' } });
    title(2, 'Generated ' + R.generated, { size: 9, color: { argb: 'FF8A9BAC' } });
    let r = 4;
    R.head.forEach(function(h) { ws.getCell('A' + r).value = h[0]; ws.mergeCells('A' + r + ':B' + r); ws.getCell('A' + r).font = { bold: true, color: { argb: 'FF4A6278' } }; ws.getCell('C' + r).value = h[1]; ws.mergeCells('C' + r + ':D' + r); r++; });
    r = 4;
    R.sums.forEach(function(sm) { ws.getCell('E' + r).value = sm[0] + ' (MT)'; ws.mergeCells('E' + r + ':F' + r); ws.getCell('E' + r).font = { bold: true, color: { argb: 'FF4A6278' } }; const c = ws.getCell('G' + r); c.value = Math.round(sm[1] * 1000) / 1000; c.numFmt = '#,##0.###'; c.font = { bold: sm[0] === 'Left to lift' }; r++; });
    r = Math.max(r, 4 + R.head.length) + 1;
    const header = function(cells) {
      const row = ws.getRow(r);
      cells.forEach(function(h, i) { const c = row.getCell(i + 1); c.value = h; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1B2A' } }; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = border; });
      row.height = 24; r++;
    };
    title(r, 'Liftings (in BL-date order)', { bold: true, size: 11, color: { argb: 'FF0D1B2A' } }); r++;
    header(['#', 'BL date', 'Barge', 'Terminal', 'Planned (MT)', 'BL qty (MT)', 'Left after (MT)']);
    if (!R.lifted.length) { title(r, 'No lifting yet.', { italic: true, color: { argb: 'FF8A9BAC' } }); r++; }
    R.lifted.forEach(function(x) {
      const row = ws.getRow(r++);
      [x.n, x.blDate, x.barge, x.terminal, x.planned, x.bl, x.left].forEach(function(v, i) {
        const c = row.getCell(i + 1); c.value = v; c.border = border;
        if (i >= 4) { c.numFmt = '#,##0.###'; c.alignment = { horizontal: 'right' }; }
        if (i === 5 && x.blMark) c.note = 'No BL quantity entered — the planned quantity is used';
        if (i === 6) c.font = { bold: true };
      });
    });
    if (R.lifted.length) {
      const row = ws.getRow(r++);
      row.getCell(4).value = 'Total lifted'; row.getCell(4).font = { bold: true };
      const t = row.getCell(6); t.value = Math.round(R.lifted.reduce(function(a, x) { return a + x.bl; }, 0) * 1000) / 1000; t.numFmt = '#,##0.###'; t.font = { bold: true };
      const lft = row.getCell(7); lft.value = R.lifted[R.lifted.length - 1].left; lft.numFmt = '#,##0.###'; lft.font = { bold: true };
    }
    r++;
    title(r, 'Scheduled loadings (not yet completed)', { bold: true, size: 11, color: { argb: 'FF0D1B2A' } }); r++;
    header(['#', 'Planned start', 'Barge', 'Terminal', 'Planned (MT)', '', '']);
    if (!R.scheduled.length) { title(r, 'None.', { italic: true, color: { argb: 'FF8A9BAC' } }); r++; }
    R.scheduled.forEach(function(x, i) {
      const row = ws.getRow(r++);
      [i + 1, x.when, x.barge, x.terminal, x.planned].forEach(function(v, j) { const c = row.getCell(j + 1); c.value = v; c.border = border; if (j === 4) { c.numFmt = '#,##0.###'; c.alignment = { horizontal: 'right' }; } });
    });
    if (R.anyStar) { r++; title(r, '* No BL date / BL quantity entered for that lifting — the day it was marked Completed / the planned quantity is used.', { size: 9, color: { argb: 'FFB8790F' } }); }
    const buf = await wb.xlsx.writeBuffer();
    await _flowSaveOrShareBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), R.file + '.xlsx');
  });
}
async function dealExportLiftingPdf(id, btn) {
  const R = _dealReportData(id);
  if (!R) { showToast('That deal is no longer in the list.', 'warning'); return; }
  await _dealExportBusy(btn, async function() {
    const jsPDF = await _loadJsPDF();
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 14;
    let y = M;
    const fmt = function(n) { return (Math.round((Number(n) || 0) * 1000) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 }); };
    const ink = function(c) { pdf.setTextColor(c[0], c[1], c[2]); };
    const room = function(h) { if (y + h > H - M) { pdf.addPage(); y = M; return true; } return false; };
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); ink([13, 27, 42]);
    pdf.text('Lifting report — ' + (R.d.supplier || 'Deal') + ' · ' + R.grade, M, y + 5); y += 9;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); ink([138, 155, 172]);
    pdf.text('Generated ' + R.generated, M, y + 3); y += 8;
    // deal + totals, two columns
    pdf.setFontSize(9.5);
    const half = (W - 2 * M) / 2, rowsN = Math.max(R.head.length, R.sums.length);
    for (let i = 0; i < rowsN; i++) {
      const h = R.head[i], s = R.sums[i];
      if (h) { pdf.setFont('helvetica', 'bold'); ink([74, 98, 120]); pdf.text(h[0], M, y + 4); pdf.setFont('helvetica', 'normal'); ink([13, 27, 42]); pdf.text(String(h[1]), M + 28, y + 4, { maxWidth: half - 30 }); }
      if (s) { pdf.setFont('helvetica', 'bold'); ink([74, 98, 120]); pdf.text(s[0] + ' (MT)', M + half, y + 4); pdf.setFont('helvetica', s[0] === 'Left to lift' ? 'bold' : 'normal'); ink([13, 27, 42]); pdf.text(fmt(s[1]), W - M, y + 4, { align: 'right' }); }
      y += 5.5;
    }
    y += 4;
    const table = function(caption, cols, rows, emptyText, totals) {
      room(20);
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); ink([13, 27, 42]); pdf.text(caption, M, y + 4); y += 7;
      const drawHead = function() {
        pdf.setFillColor(13, 27, 42); pdf.rect(M, y, W - 2 * M, 7, 'F');
        pdf.setFontSize(8.5); pdf.setFont('helvetica', 'bold'); ink([255, 255, 255]);
        let x = M; cols.forEach(function(c) { pdf.text(c.t, c.r ? x + c.w - 1.5 : x + 1.5, y + 4.8, { align: c.r ? 'right' : 'left' }); x += c.w; });
        y += 7;
      };
      drawHead();
      if (!rows.length) { pdf.setFont('helvetica', 'italic'); pdf.setFontSize(9); ink([138, 155, 172]); pdf.text(emptyText, M + 1.5, y + 5); y += 8; return; }
      rows.forEach(function(row, ri) {
        if (room(7)) drawHead();
        if (ri % 2) { pdf.setFillColor(242, 245, 249); pdf.rect(M, y, W - 2 * M, 6.5, 'F'); }
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); ink([13, 27, 42]);
        let x = M;
        cols.forEach(function(c, ci) { if (c.b) pdf.setFont('helvetica', 'bold'); pdf.text(String(row[ci]), c.r ? x + c.w - 1.5 : x + 1.5, y + 4.5, { align: c.r ? 'right' : 'left', maxWidth: c.w - 3 }); if (c.b) pdf.setFont('helvetica', 'normal'); x += c.w; });
        y += 6.5;
      });
      if (totals) {
        room(8); pdf.setDrawColor(13, 27, 42); pdf.line(M, y, W - M, y);
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); ink([13, 27, 42]);
        let x = M; cols.forEach(function(c, ci) { if (totals[ci] !== '') pdf.text(String(totals[ci]), c.r ? x + c.w - 1.5 : x + 1.5, y + 4.8, { align: c.r ? 'right' : 'left' }); x += c.w; });
        y += 8;
      }
      y += 4;
    };
    const tw = W - 2 * M;
    table('Liftings (in BL-date order)',
      [{ t: '#', w: tw * 0.06 }, { t: 'BL date', w: tw * 0.16 }, { t: 'Barge', w: tw * 0.13 }, { t: 'Terminal', w: tw * 0.23 }, { t: 'Planned MT', w: tw * 0.13, r: 1 }, { t: 'BL qty MT', w: tw * 0.14, r: 1 }, { t: 'Left after MT', w: tw * 0.15, r: 1, b: 1 }],
      R.lifted.map(function(x) { return [x.n, x.blDate, x.barge, x.terminal, fmt(x.planned), fmt(x.bl) + x.blMark, fmt(x.left)]; }),
      'No lifting yet.',
      R.lifted.length ? ['', '', '', 'Total lifted', '', fmt(R.lifted.reduce(function(a, x) { return a + x.bl; }, 0)), fmt(R.lifted[R.lifted.length - 1].left)] : null);
    table('Scheduled loadings (not yet completed)',
      [{ t: '#', w: tw * 0.06 }, { t: 'Planned start', w: tw * 0.24 }, { t: 'Barge', w: tw * 0.15 }, { t: 'Terminal', w: tw * 0.35 }, { t: 'Planned MT', w: tw * 0.2, r: 1 }],
      R.scheduled.map(function(x, i) { return [i + 1, x.when, x.barge, x.terminal, fmt(x.planned)]; }), 'None.');
    if (R.anyStar) { room(8); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); ink([184, 121, 15]); pdf.text('* No BL date / BL quantity entered for that lifting — the day it was marked Completed / the planned quantity is used.', M, y + 3, { maxWidth: tw }); }
    const pages = pdf.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) { pdf.setPage(i); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); ink([138, 155, 172]); pdf.text('FLOW · Loading Deals · page ' + i + ' of ' + pages, W / 2, H - 6, { align: 'center' }); }
    await _flowSaveOrShareBlob(pdf.output('blob'), R.file + '.pdf');
  });
}

function renderDeals() {
  const host = document.getElementById('deal-list');
  if (!host) return;
  const operator = !isTrader();
  const all = (_loadingDeals || []).filter(function(d) { return d && !d.deletedAt; });
  const open = _dealsOpen(null), closed = all.filter(function(d) { return d.status === 'closed'; }).sort(function(a, b) { return (b.closedAt || 0) - (a.closedAt || 0); });
  let remV = 0, remM = 0, comm = 0;
  open.forEach(function(d) { const st = _dealStats(d); if (d.grade === 'LSMGO') remM += Math.max(0, st.remaining); else remV += Math.max(0, st.remaining); comm += st.committed; });
  const setTxt = function(id, v) { const e = document.getElementById(id); if (e) e.textContent = v; };
  setTxt('deal-kpi-open', String(open.length)); setTxt('deal-kpi-v', _mtStr(remV)); setTxt('deal-kpi-m', _mtStr(remM)); setTxt('deal-kpi-committed', _mtStr(comm));
  const nb = document.getElementById('deal-new-btn'); if (nb) nb.style.display = operator ? '' : 'none';
  if (!all.length) {
    host.innerHTML = '<div class="deal-empty">No deals yet. Add the bulk quantity you bought — every loading of that grade is then deducted from it, by the quantity on its BL once completed.</div>';
    return;
  }
  host.innerHTML = (open.length ? open.map(function(d) { return _dealCardHtml(d, operator); }).join('') : '<div class="deal-empty">No open deal — new loadings are not deducted from a bulk purchase.</div>') +
    (closed.length ? '<div class="deal-sec">Closed deals</div>' + closed.map(function(d) { return _dealCardHtml(d, operator); }).join('') : '');
}

function renderLoadingList() {
  const el = document.getElementById('loading-list');
  if (!el) return;

  // Active loadings first (chronological), completed ones after — so the
  // list stays focused on what's still happening, while completed records
  // remain visible (not deleted) further down for reference.
  const sorted = (_loadingRecords || []).filter(function(r) { return !r.deletedAt; }).sort(function(a, b) {
    if (!!a.completed !== !!b.completed) return a.completed ? 1 : -1;
    return new Date(a.startAt) - new Date(b.startAt);
  });

  if (!sorted.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:16px;background:var(--surface);box-shadow:var(--sh-in-xs);border-radius:var(--radius);text-align:center">No loadings scheduled yet — add one above.</div>';
  } else {
    const ldMap = _bargeColorMap();
    el.innerHTML = sorted.map(function(r) {
      const start = new Date(r.startAt), end = new Date(r.endAt);
      const gradeColor = r.grade === 'LSMGO' ? 'var(--fuel-m)' : 'var(--fuel-v)';
      const gradeColorBg = r.grade === 'LSMGO' ? 'var(--fuel-m-lt)' : 'var(--fuel-v-lt)';
      const fmtD = function(d) { return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) + ' ' + d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false}); };
      const preTag = r.preOpsHours ? ('Pre ' + _formatDurationHours(r.preOpsHours)) : '';
      const postTag = r.postOpsHours ? ('Post ' + _formatDurationHours(r.postOpsHours)) : '';
      const xfer = _isTransfer(r);
      const durLine = r.endOverridden
        ? 'Manual end date'
        : xfer ? ['Pump ' + _formatDurationHours(r.pumpHours), r.hoseHours ? 'Hose ' + _formatDurationHours(r.hoseHours) : ''].filter(Boolean).join(' · ')
        : ['Pump ' + _formatDurationHours(r.pumpHours), preTag, postTag, (r.startWin && _etaFrame(r.startWin) ? 'Start frame ' + _formatDurationHours(_etaFrameHrs(r.startWin)) + ' — latest end' : '')].filter(Boolean).join(' · ');
      // Time-frame start: "16 Oct 2026 AM (06:00–12:00)".
      const startTxt = (r.startWin && _etaFrame(r.startWin)) ? _fmtEtaWin(start, r.startWin) : fmtD(start);
      const doneStyle = r.completed ? 'opacity:.55' : '';
      const actionBtns = r.completed
        ? (xfer ? '' : '<button class="btn btn-secondary btn-sm" onclick="editLoadingBl(\'' + escJs(r.id) + '\')" title="Quantity loaded per BL">BL</button>')
          + '<button class="btn btn-secondary btn-sm" onclick="undoLoadingRecordDone(\'' + escJs(r.id) + '\')" title="Undo — put back on the calendar">'
            + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>'
          + '</button>'
          + '<button class="btn btn-secondary btn-sm" onclick="deleteLoadingRecord(\'' + escJs(r.id) + '\')" title="Remove">'
            + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
          + '</button>'
        : '<button class="btn btn-primary btn-sm" onclick="completeLoadingPrompt(\'' + escJs(r.id) + '\')" title="' + (xfer ? 'Mark the transfer as done — removes it from the calendar and timeline; update both barges\' ROB on Barge Fleet' : 'Mark as done — asks for the quantity loaded per BL; removes it from the calendar and timeline') + '">'
            + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Done'
          + '</button>'
          + '<button class="btn btn-secondary btn-sm" onclick="editLoadingRecord(\'' + escJs(r.id) + '\')" title="Edit">'
            + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
          + '</button>'
          + '<button class="btn btn-secondary btn-sm" onclick="deleteLoadingRecord(\'' + escJs(r.id) + '\')" title="Remove">'
            + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
          + '</button>';
      if (xfer) {
        return '<div class="card ld-row-transfer" style="padding:12px 16px;margin-bottom:8px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;border-left:3px solid var(--purple);' + doneStyle + '">'
          + '<span style="font-size:9.5px;font-weight:700;padding:3px 9px;border-radius:4px;background:var(--purple);color:#fff;font-family:\'DM Mono\',monospace;letter-spacing:.04em">TRANSFER</span>'
          + '<span style="font-size:9.5px;font-weight:700;padding:3px 9px;border-radius:4px;background:' + gradeColorBg + ';color:' + gradeColor + ';font-family:\'DM Mono\',monospace;letter-spacing:.04em">' + esc(r.grade) + '</span>'
          + _bargePill(r.fromBarge || '', ldMap) + '<span style="color:var(--purple);font-weight:700">→</span>' + _bargePill(_resolveRecordBargeName(r), ldMap)
          + (r.completed ? '<span style="font-size:9.5px;font-weight:700;padding:3px 9px;border-radius:4px;background:var(--green-lt);color:var(--green);font-family:\'DM Mono\',monospace;letter-spacing:.04em">DONE</span>' : '')
          + '<div style="flex:1;min-width:160px">'
            + '<div style="font-size:13px;font-weight:700;color:var(--purple);' + (r.completed ? 'text-decoration:line-through' : '') + '">Barge transfer — ' + esc(r.fromBarge || '') + ' → ' + esc(_resolveRecordBargeName(r)) + '</div>'
            + '<div style="font-size:11px;color:var(--sub);margin-top:1px">' + (Number(r.qty) || 0).toLocaleString() + ' MT' + (r.notes ? ' · ' + esc(r.notes) : '') + '</div>'
          + '</div>'
          + '<div style="font-size:11.5px;color:var(--ink);text-align:right;min-width:170px">'
            + '<div class="ld-when">' + fmtD(start) + ' → ' + fmtD(end) + '</div>'
            + '<div style="color:var(--muted);margin-top:1px">' + durLine + '</div>'
          + '</div>'
          + '<div style="display:flex;gap:6px">' + actionBtns + '</div>'
        + '</div>';
      }
      return '<div class="card" style="padding:12px 16px;margin-bottom:8px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;' + doneStyle + '">'
        + '<span style="font-size:9.5px;font-weight:700;padding:3px 9px;border-radius:4px;background:' + gradeColorBg + ';color:' + gradeColor + ';font-family:\'DM Mono\',monospace;letter-spacing:.04em">' + esc(r.grade) + '</span>'
        + _bargePill(_resolveRecordBargeName(r), ldMap)
        + (r.completed ? '<span style="font-size:9.5px;font-weight:700;padding:3px 9px;border-radius:4px;background:var(--green-lt);color:var(--green);font-family:\'DM Mono\',monospace;letter-spacing:.04em">DONE</span>' : '')
        + '<div style="flex:1;min-width:160px">'
          + '<div style="font-size:13px;font-weight:700;color:var(--ink);' + (r.completed ? 'text-decoration:line-through' : '') + '">' + esc(r.terminal || '—') + '</div>'
          + '<div style="font-size:11px;color:var(--sub);margin-top:1px">' + (Number(r.qty) || 0).toLocaleString() + ' MT' + (r.completed && r.blQty != null ? ' planned · <b>BL ' + Number(r.blQty).toLocaleString() + ' MT</b>' + (r.blDate ? ' · BL date ' + esc(_dealDateStr(r.blDate)) : '') : '') + (r.notes ? ' · ' + esc(r.notes) : '') + '</div>'
          + (r.dealId ? '<div style="font-size:10.5px;color:var(--muted);margin-top:1px">Deal: ' + (_dealById(r.dealId) ? esc(_dealLabel(_dealById(r.dealId))) : 'removed — link it again on the Loading Deals page') + '</div>' : '')
          + (r.surveyor ? '<div style="font-size:10.5px;color:var(--muted);margin-top:1px;display:flex;align-items:center;gap:4px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>Surveyor: ' + esc(r.surveyor) + '</div>' : '')
        + '</div>'
        + '<div style="font-size:11.5px;color:var(--ink);text-align:right;min-width:170px">'
          + '<div class="ld-when">' + startTxt + ' → ' + fmtD(end) + '</div>'
          + '<div style="color:var(--muted);margin-top:1px">' + durLine + '</div>'
        + '</div>'
        + '<div style="display:flex;gap:6px">'
        + actionBtns
        + '</div>'
      + '</div>';
    }).join('');
  }

  // KPIs — scoped to ACTIVE loadings only; a completed one is no longer
  // "upcoming" regardless of what its original date said.
  // Barge transfers are not terminal loadings — they stay out of these figures.
  const active = sorted.filter(function(r) { return !r.completed && !_isTransfer(r); });
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 86400000);
  const totalV = active.filter(function(r) { return r.grade === 'VLSFO'; }).reduce(function(s, r) { return s + r.qty; }, 0);
  const totalM = active.filter(function(r) { return r.grade === 'LSMGO'; }).reduce(function(s, r) { return s + r.qty; }, 0);
  const upcoming = active.filter(function(r) { const d = new Date(r.startAt); return d >= now && d <= in7; }).length;
  const avgHrs = active.length ? (active.reduce(function(s, r) { return s + (r.estimatedHours || 0); }, 0) / active.length) : 0;

  const setTxt = function(id, val) { const e = document.getElementById(id); if (e) e.textContent = val; };
  setTxt('ld-kpi-total', String(active.length));
  setTxt('ld-kpi-upcoming', String(upcoming));
  setTxt('ld-kpi-vlsfo', totalV.toLocaleString());
  setTxt('ld-kpi-lsmgo', totalM.toLocaleString());
  setTxt('ld-kpi-avgdur', avgHrs > 0 ? avgHrs.toFixed(1) : '0');

  _refreshLoadingTerminalDatalist();
}

function renderLoadingPage() {
  const vEl = document.getElementById('ld-rate-vlsfo');
  const mEl = document.getElementById('ld-rate-lsmgo');
  if (vEl) vEl.value = _loadingConfig.rateVLSFO;
  if (mEl) mEl.value = _loadingConfig.rateLSMGO;
  if (!_loadingEditingId && !document.getElementById('ld-start-date').value) {
    document.getElementById('ld-start-date').value = _localDateInputStr(new Date());
  }
  _populateLoadingBargeSelect();
  _ldRefreshDealSelect();
  _recalcLoadingEstimate();
  renderLoadingList();
}

