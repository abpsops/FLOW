/* ── Local snapshot persistence ── */
function _activeChecklistRecords() {
  // Only ACTIVE (non-completed, non-locked) checklist records are synced.
  // Completed/locked records are already saved in _savedSupplies — including
  // them caused duplicate rows every time applyState ran.
  const active = {};
  Object.entries(_checklistRecords || {}).forEach(function([uid, rec]) {
    if (rec && !rec.lockedAt && rec.state !== 'completed') active[uid] = rec;
  });
  return active;
}
// What this device currently has, in payload shape (no baking) — the
// "local" side of a merge.
function _buildLocalPayload() {
  const state = captureCurrentState();
  state.manualROB      = Object.assign({}, _manualROB || {});
  state.robAuditLog    = _robAuditLog || [];
  state.bakedSupplyIds = _bakedSupplyIds || {};
  state.checklistRecords = _activeChecklistRecords();
  return _deepClone({ state: state, records: _savedSupplies || [], checklistRecords: _activeChecklistRecords() });
}
function _persistSyncBase() {
  try { localStorage.setItem(LS_SYNC_BASE_KEY, JSON.stringify({ version: _lastKnownVersion, payload: _lastSyncedPayload })); } catch(e) {}
}
function _isMarkedUnsynced() {
  try { return localStorage.getItem(LS_UNSYNCED_KEY) === '1'; } catch(e) { return false; }
}
function _markUnsynced(on) {
  try { if (on) localStorage.setItem(LS_UNSYNCED_KEY, '1'); else localStorage.removeItem(LS_UNSYNCED_KEY); } catch(e) {}
}
// How many things (nominations, records, barges, settings…) differ on this
// device from the copy it last synced — what a logout would throw away.
// Data derived from those edits (schedule, bake bookkeeping, ROB audit log)
// isn't counted again; a trader only ever writes nominations. 0 = no base
// to compare against (or nothing changed).
const _CHANGE_COUNT_SKIP = { lastSched: 1, lastSchedMeta: 1, bakedSupplyIds: 1, robAuditLog: 1, checklistRecords: 1 };
function _countLocalChanges() {
  if (!_lastSyncedPayload) return 0;
  const b = _mergeDoc(_lastSyncedPayload), l = _mergeDoc(_buildLocalPayload());
  let n = 0;
  const count = function(bv, lv, key) {
    if (_sameJSON(bv, lv)) return;
    if (bv == null && Array.isArray(lv)) bv = []; // a list the synced copy didn't have yet
    const f = Array.isArray(bv) && Array.isArray(lv) ? _pickIdField(key, [bv, lv]) : null;
    if (!f) { n++; return; }
    const index = function(arr) { const m = {}; arr.forEach(function(it) { m[_mergeItemKey(it, f)] = it; }); return m; };
    const bm = index(bv), lm = index(lv);
    Object.keys(Object.assign({}, bm, lm)).forEach(function(k) { if (!_sameJSON(bm[k], lm[k])) n++; });
  };
  if (isTrader()) { count(b.state.vessels || [], l.state.vessels || [], 'vessels'); return n; }
  Object.keys(Object.assign({}, b.state, l.state)).forEach(function(k) { if (!_CHANGE_COUNT_SKIP[k]) count(b.state[k], l.state[k], k); });
  count(b.records, l.records, 'records');
  Object.keys(Object.assign({}, b.checklistRecords, l.checklistRecords)).forEach(function(k) { if (!_sameJSON(b.checklistRecords[k], l.checklistRecords[k])) n++; });
  return n;
}
// Adopt a cloud row as the new merge base. When this device has no pending
// edits, vessels/barges are taken from what the UI actually rebuilt (inputs
// normalise blanks to defaults) so a later merge doesn't mistake that
// normalisation for a local edit and override a colleague's change.
function _adoptBase(row, normalize) {
  _lastKnownVersion = Number(row.version) || Number(row.payload && row.payload.version) || 0;
  const base = _deepClone(row.payload);
  base.state = base.state || {};
  if (normalize) {
    const cap = captureCurrentState();
    base.state.barges = _deepClone(cap.barges);
    base.state.vessels = _deepClone(cap.vessels);
  }
  _lastSyncedPayload = base;
  _persistSyncBase();
}

/* ── Keep the user's cursor when a merged state has to be re-rendered ── */
function _snapshotFocus() {
  const el = document.activeElement;
  if (!el || !el.id || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return null;
  const card = el.closest && el.closest('.vcard');
  if (!card) return null;
  const snap = { id: el.id, nomUid: card.dataset.nomUid || null, selStart: null, selEnd: null };
  try { snap.selStart = el.selectionStart; snap.selEnd = el.selectionEnd; } catch(e) {}
  const m = el.id.match(/^([vb])(\d+)-(.+)$/);
  if (m) { snap.prefix = m[1]; snap.field = m[3]; }
  return snap;
}
function _restoreFocus(snap) {
  if (!snap) return;
  let target = null;
  if (snap.prefix === 'v' && snap.nomUid) {
    const card = Array.from(document.querySelectorAll('.vcard[id^="vessel-"]')).find(function(c) { return c.dataset.nomUid === snap.nomUid; });
    if (card) target = document.getElementById('v' + card.id.replace('vessel-', '') + '-' + snap.field);
  } else target = document.getElementById(snap.id);
  if (!target) return;
  try {
    target.focus({ preventScroll: true });
    if (snap.selStart != null && target.setSelectionRange) target.setSelectionRange(snap.selStart, snap.selEnd);
  } catch(e) {}
}
function _isEditingSyncedForm() {
  const el = document.activeElement;
  if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return false;
  return !!(el.closest && (el.closest('#vc') || el.closest('#barge-list')));
}

// Apply a full payload (a pulled row, or a merge result) to memory + UI.
// replaceUnions=true when the payload already incorporates this device's
// own data (a merge result, or a remote copy pulled while nothing here was
// unsynced): then lists that applyState() normally only ever *adds* to
// (archives, agents, loadings…) are replaced, so a colleague's deletion
// actually reaches this device instead of being resurrected by the union.
function _applyPayload(payload, replaceUnions) {
  if (!payload || !payload.state) return;
  const st = payload.state;
  const focus = _snapshotFocus();
  const coloursBefore = JSON.stringify(Array.from(_bargeColorMap()));
  if (replaceUnions) {
    if (_isPlainObj(st.archives)) { _archives = _deepClone(st.archives); if (typeof _collapseArchiveCopies === 'function') _collapseArchiveCopies(); if (typeof saveArchives === 'function') saveArchives(); }
    if (Array.isArray(st.agents)) {
      _agents = _deepClone(st.agents);
      _agentNextId = Math.max(_agentNextId || 1000, ...(_agents.map(function(a) { return (Number(a.id) || 0) + 1; })));
      if (typeof _saveAgents === 'function') _saveAgents();
    }
    if (_isPlainObj(st.deliveryLog)) { _deliveryLog = _deepClone(st.deliveryLog); if (typeof _saveDeliveryLog === 'function') _saveDeliveryLog(); }
    if (Array.isArray(st.loadingRecords)) _loadingRecords = _deepClone(st.loadingRecords);
    if (Array.isArray(st.loadingDeals)) _loadingDeals = _deepClone(st.loadingDeals);
    if (_isPlainObj(st.fuelingInitiated)) _fuelingInitiated = _deepClone(st.fuelingInitiated);
    if (_isPlainObj(st.bakedSupplyIds)) _bakedSupplyIds = _deepClone(st.bakedSupplyIds);
  }
  applyState(st, !!replaceUnions); // a merge result or the cloud row itself: no zero-ROB guard
  if (Array.isArray(st.loadingRecords)) _saveLoadingToLocal();
  _manualROB = _isPlainObj(st.manualROB) ? _deepClone(st.manualROB) : {};
  try { localStorage.setItem('abps_manual_rob_v1', JSON.stringify(_manualROB)); } catch(e) {}
  if (Array.isArray(st.robAuditLog)) {
    _robAuditLog = _deepClone(st.robAuditLog);
    try { localStorage.setItem(ROB_AUDIT_KEY, JSON.stringify(_robAuditLog)); } catch(e) {}
  }
  if (Array.isArray(payload.records)) { _savedSupplies = _deepClone(payload.records); }
  // Top-up: active checklist records saved between state writes (same in
  // every apply path — initial load, auto-sync, Pull, merge).
  if (_isPlainObj(payload.checklistRecords)) {
    Object.entries(payload.checklistRecords).forEach(function([uid, remote]) {
      if (remote && !remote.lockedAt && remote.state !== 'completed') {
        if (!_checklistRecords[uid] || !_checklistRecords[uid].lockedAt) _checklistRecords[uid] = remote;
      }
    });
  }
  try { localStorage.setItem(LS_STATE_KEY, JSON.stringify(st)); } catch(e) {}
  try { localStorage.setItem(LS_RECORDS_KEY, JSON.stringify(_savedSupplies)); } catch(e) {}
  if (typeof renderSavedRecords === 'function') renderSavedRecords();
  if (typeof _refreshReportViews === 'function') _refreshReportViews(); // a colleague's record edits reach the reports on screen
  if (typeof _refreshBargeColours === 'function' && coloursBefore !== '[]' && JSON.stringify(Array.from(_bargeColorMap())) !== coloursBefore) _refreshBargeColours(); // …and a colleague's barge colour (not the first load)
  if (typeof renderTrashBin === 'function') renderTrashBin();
  if (typeof _fwRefreshIfOpen === 'function') _fwRefreshIfOpen(); // a colleague's blocks / schedule show up
  if (typeof _rlRefreshIfShown === 'function') _rlRefreshIfShown(); // …and their loadings / ROB in the reload plan
  if (typeof _refreshLoadingViews === 'function') _refreshLoadingViews(); // the Loading list, its Deal pick and the Deals page
  if (typeof _trAfterApply === 'function') _trAfterApply(); // track-record banners on the cards, the bell, the watchlist
  _restoreFocus(focus);
}
// After a pull / merge: the Loading list and the Deals page show the colleague's
// loadings, completions and deals; the form's Deal pick follows unless the
// operator chose one; an edit of a loading removed elsewhere is dropped.
function _refreshLoadingViews() {
  if (_loadingEditingId) {
    const rec = (_loadingRecords || []).find(function(r) { return r && r.id === _loadingEditingId; });
    if (!rec || rec.deletedAt) { cancelLoadingEdit(); if (typeof showToast === 'function') showToast('The loading you were editing was removed by a colleague.', 'warning'); }
    else if (rec.updatedAt && rec.updatedAt !== _loadingEditingSeen) {
      // Changed elsewhere while the form holds the old values: said once per change.
      _loadingEditingSeen = rec.updatedAt;
      if (typeof showToast === 'function') showToast('This loading was changed by a colleague meanwhile — the list shows their version. Review the form before Update (it saves every field as shown).', 'warning', 8000);
    }
  }
  if (_dealEditingId && typeof _dealById === 'function') {
    const d = _dealById(_dealEditingId);
    if (!d) { dealCancelEdit(); if (typeof showToast === 'function') showToast('The deal you were editing was removed by a colleague.', 'warning'); }
    else if (d.updatedAt && d.updatedAt !== _dealEditingSeen) {
      _dealEditingSeen = d.updatedAt;
      if (typeof showToast === 'function') showToast('This deal was changed by a colleague meanwhile — the card shows their version. Review the form before Update (it saves every field as shown).', 'warning', 8000);
    }
  }
  if (typeof _blModal !== 'undefined' && _blModal) {
    const rec = (_loadingRecords || []).find(function(r) { return r && r.id === _blModal.id; });
    if (!rec || rec.deletedAt) { closeBlModal(); if (typeof showToast === 'function') showToast('That loading was removed by a colleague.', 'warning'); }
    else if (_blModal.mode === 'complete' && rec.completed) { closeBlModal(); if (typeof showToast === 'function') showToast('A colleague already marked this loading Completed' + (rec.blQty != null ? ' (BL ' + _mtStr(rec.blQty) + ' MT)' : '') + '.', 'warning', 6000); }
    else _blPreview();
  }
  if (_currentPage === 'loading') { renderLoadingList(); _ldRefreshDealSelect(undefined, 'pull'); }
  if (typeof _refreshDealsIfShown === 'function') _refreshDealsIfShown();
}

function _toastMerged(conflicts) {
  if (conflicts && conflicts.length) {
    console.warn('FLOW sync: resolved', conflicts.length, 'conflicting edit(s) —', conflicts.slice(0, 20));
    if (typeof showToast === 'function') showToast('Merged with changes saved by a colleague — where you both edited the same field, the most recent edit was kept.', 'warning', 6000);
  }
}

