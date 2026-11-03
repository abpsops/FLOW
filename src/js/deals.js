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
function _mtStr(x) { return Math.round(Number(x) || 0).toLocaleString(); }
// What a completed loading lifted: the BL quantity, or the planned quantity until a BL figure is entered.
function _loadingLifted(r) { return r.blQty != null && r.blQty !== '' && !isNaN(Number(r.blQty)) ? Number(r.blQty) : (Number(r.qty) || 0); }
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
  document.getElementById('bl-title').textContent = mode === 'complete' ? 'Mark loading Completed' : 'Quantity loaded per BL';
  document.getElementById('bl-sub').textContent = (rec.terminal || 'Terminal') + ' · ' + (_resolveRecordBargeName(rec) || 'barge') + ' · planned ' + _mtStr(rec.qty) + ' MT ' + grade + ' · ' + fmt24(new Date(rec.startAt));
  document.getElementById('bl-confirm-btn').textContent = mode === 'complete' ? 'Mark Completed' : 'Save';
  const q = document.getElementById('bl-qty');
  q.value = rec.blQty != null && rec.blQty !== '' ? rec.blQty : (Number(rec.qty) || '');
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
  const m = _blModal;
  closeBlModal();
  const rec = (_loadingRecords || []).find(function(r) { return r && r.id === m.id; });
  if (!rec || rec.deletedAt) { showToast('That loading is no longer in the list.', 'warning'); return; }
  const grade = rec.grade === 'LSMGO' ? 'LSMGO' : 'VLSFO';
  if (m.mode === 'complete') {
    if (rec.completed) { showToast('That loading is already marked Completed' + (rec.blQty != null ? ' (BL ' + _mtStr(rec.blQty) + ' MT)' : '') + '.', 'warning'); _refreshLoadingConsumers(); return; }
    markLoadingRecordDone(rec.id, q); // saves, re-renders the list, forecast and deals
    const d = rec.dealId ? _dealById(rec.dealId) : null;
    const dealTxt = d ? ' Deal ' + (d.supplier || '') + ': ' + _mtStr(_dealStats(d).remaining) + ' MT left to lift.' : '';
    if (m.opts && m.opts.fromForecast) showToast('Loading at ' + (rec.terminal || 'the terminal') + ' marked Completed (BL ' + _mtStr(q) + ' MT ' + grade + ').' + dealTxt + ' Now record the reload in the barge\'s ROB so the stock shows.', 'success', 8000);
    else showToast('Loading at ' + (rec.terminal || 'the terminal') + ' marked Completed — BL ' + _mtStr(q) + ' MT ' + grade + '.' + dealTxt, 'success', 6000);
  } else {
    rec.blQty = q; rec.blAt = Date.now(); _touchLoading(rec);
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
  const rows = st.loadings.map(function(r) {
    const when = r.completed ? fmt24(new Date(r.completedAt || r.endAt)) : fmt24(new Date(r.startAt));
    const act = operator ? '<td class="deal-act">' +
      (r.completed ? '<button class="btn btn-secondary btn-sm" onclick="editLoadingBl(\'' + escJs(r.id) + '\')" title="Quantity loaded per BL">BL</button> ' : '<button class="btn btn-primary btn-sm" onclick="completeLoadingPrompt(\'' + escJs(r.id) + '\')" title="Mark Completed — asks for the BL quantity">Done</button> ') +
      '<button class="btn btn-secondary btn-sm" onclick="dealUnlinkLoading(\'' + escJs(r.id) + '\')" title="Unlink from this deal">×</button></td>' : '';
    return '<tr class="' + (r.completed ? 'done' : '') + '"><td>' + esc(when) + '</td><td>' + _bargePill(_resolveRecordBargeName(r), ldMap) + '</td><td>' + esc(r.terminal || '—') + '</td>' +
      '<td class="n">' + esc(_mtStr(r.qty)) + '</td><td class="n">' + (r.completed ? '<b>' + esc(_mtStr(_loadingLifted(r))) + '</b>' + (r.blQty == null ? ' <span title="No BL figure entered — the planned quantity is used" style="color:var(--amber)">*</span>' : '') : '—') + '</td>' +
      '<td>' + (r.completed ? '<span class="ld-chip" style="background:var(--green-lt);color:var(--green)">LIFTED</span>' : '<span class="ld-chip" style="background:var(--amber-lt);color:var(--amber)">SCHEDULED</span>') + '</td>' + act + '</tr>';
  });
  const linked = {}; (_loadingRecords || []).forEach(function(r) { if (r && r.dealId) linked[r.id] = 1; });
  const linkable = operator && !closed ? (_loadingRecords || []).filter(function(r) { return r && !r.deletedAt && (!r.dealId || !_dealById(r.dealId)) && (r.grade === 'LSMGO' ? 'LSMGO' : 'VLSFO') === grade; })
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
    (rows.length ? '<div class="deal-tbl-wrap"><table class="deal-tbl"><thead><tr><th>When</th><th>Barge</th><th>Terminal</th><th class="n">Planned MT</th><th class="n">Lifted MT (BL)</th><th>Status</th>' + (operator ? '<th class="deal-act"></th>' : '') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>'
      : '<div class="deal-meta">No loading lifts from this deal yet — schedule one on the Loading page (it links automatically) or link an existing one below.</div>') +
    '<div class="deal-foot">' + linkSel + '<span style="flex:1"></span>' + actions + '</div>' +
  '</div>';
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
      const durLine = r.endOverridden
        ? 'Manual end date'
        : ['Pump ' + _formatDurationHours(r.pumpHours), preTag, postTag, (r.startWin && _etaFrame(r.startWin) ? 'Start frame ' + _formatDurationHours(_etaFrameHrs(r.startWin)) + ' — latest end' : '')].filter(Boolean).join(' · ');
      // Time-frame start: "16 Oct 2026 AM (06:00–12:00)".
      const startTxt = (r.startWin && _etaFrame(r.startWin)) ? _fmtEtaWin(start, r.startWin) : fmtD(start);
      const doneStyle = r.completed ? 'opacity:.55' : '';
      const actionBtns = r.completed
        ? '<button class="btn btn-secondary btn-sm" onclick="editLoadingBl(\'' + escJs(r.id) + '\')" title="Quantity loaded per BL">BL</button>'
          + '<button class="btn btn-secondary btn-sm" onclick="undoLoadingRecordDone(\'' + escJs(r.id) + '\')" title="Undo — put back on the calendar">'
            + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>'
          + '</button>'
          + '<button class="btn btn-secondary btn-sm" onclick="deleteLoadingRecord(\'' + escJs(r.id) + '\')" title="Remove">'
            + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
          + '</button>'
        : '<button class="btn btn-primary btn-sm" onclick="completeLoadingPrompt(\'' + escJs(r.id) + '\')" title="Mark as done — asks for the quantity loaded per BL; removes it from the calendar and timeline">'
            + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Done'
          + '</button>'
          + '<button class="btn btn-secondary btn-sm" onclick="editLoadingRecord(\'' + escJs(r.id) + '\')" title="Edit">'
            + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
          + '</button>'
          + '<button class="btn btn-secondary btn-sm" onclick="deleteLoadingRecord(\'' + escJs(r.id) + '\')" title="Remove">'
            + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
          + '</button>';
      return '<div class="card" style="padding:12px 16px;margin-bottom:8px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;' + doneStyle + '">'
        + '<span style="font-size:9.5px;font-weight:700;padding:3px 9px;border-radius:4px;background:' + gradeColorBg + ';color:' + gradeColor + ';font-family:\'DM Mono\',monospace;letter-spacing:.04em">' + esc(r.grade) + '</span>'
        + _bargePill(_resolveRecordBargeName(r), ldMap)
        + (r.completed ? '<span style="font-size:9.5px;font-weight:700;padding:3px 9px;border-radius:4px;background:var(--green-lt);color:var(--green);font-family:\'DM Mono\',monospace;letter-spacing:.04em">DONE</span>' : '')
        + '<div style="flex:1;min-width:160px">'
          + '<div style="font-size:13px;font-weight:700;color:var(--ink);' + (r.completed ? 'text-decoration:line-through' : '') + '">' + esc(r.terminal || '—') + '</div>'
          + '<div style="font-size:11px;color:var(--sub);margin-top:1px">' + (Number(r.qty) || 0).toLocaleString() + ' MT' + (r.completed && r.blQty != null ? ' planned · <b>BL ' + Number(r.blQty).toLocaleString() + ' MT</b>' : '') + (r.notes ? ' · ' + esc(r.notes) : '') + '</div>'
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
  const active = sorted.filter(function(r) { return !r.completed; });
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

