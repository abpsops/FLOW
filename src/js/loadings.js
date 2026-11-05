/* ══════════════════════════════════════════════════════
   LOADING OPERATIONS — schedule terminal loadings, auto-estimate
   duration from a configurable MT/hour rate per grade plus editable
   pre-/post-loading ops buffers, and surface every loading on the
   dashboard calendar, dashboard activity feed, and Supply Timeline.
   ════════════════════════════════════════════════════ */

let _loadingEditingId = null; // non-null while the form is editing an existing record
let _loadingEditingSeen = null; // that record's updatedAt when the form was filled (a colleague's change since then is announced)
// A loading changed on THIS device outside the form (linked, unlinked, BL edited, undone):
// stamped, and the form — if it is editing that record — follows instead of calling it a colleague's.
function _touchLoading(rec) {
  rec.updatedAt = Date.now();
  if (_loadingEditingId === rec.id) { _loadingEditingSeen = rec.updatedAt; _ldRefreshDealSelect(rec.dealId || ''); }
}
let _dealEditingSeen = null; // the edited deal's updatedAt when the deal form was filled
function _touchDeal(d) {
  d.updatedAt = Date.now();
  if (_dealEditingId === d.id) _dealEditingSeen = d.updatedAt;
}

function _loadingRateFor(grade) {
  return (grade === 'LSMGO' ? _loadingConfig.rateLSMGO : _loadingConfig.rateVLSFO) || 1;
}

// Pumping time only (product transfer) — hours as a float.
function computeLoadingDurationHours(qty, grade) {
  const rate = _loadingRateFor(grade);
  if (!qty || qty <= 0 || !rate || rate <= 0) return 0;
  return qty / rate;
}

function _formatDurationHours(hrs) {
  if (!hrs || hrs <= 0) return '—';
  // Round to whole minutes FIRST — rounding only the fraction could yield "1h 60m".
  const total = Math.round(hrs * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h <= 0) return m + 'm';
  if (m <= 0) return h + 'h';
  return h + 'h ' + m + 'm';
}

function updateLoadingConfig() {
  const v = parseFloat(document.getElementById('ld-rate-vlsfo')?.value) || _loadingConfig.rateVLSFO;
  const m = parseFloat(document.getElementById('ld-rate-lsmgo')?.value) || _loadingConfig.rateLSMGO;
  _loadingConfig = { rateVLSFO: v, rateLSMGO: m };
  saveLoadingRecords();
  _recalcLoadingEstimate();
  renderLoadingList();
}

// Live estimate shown in the form as the operator types — does not
// touch any saved record until Add/Update Loading is pressed.
/* ── Barge transfers (self cargo discharge, barge to barge) ──
   A record with kind:'transfer': fromBarge discharges `qty` of `grade` into
   barge. It lives with the loadings (same list, calendar, sync) but is not a
   loading: it adds no stock in the forecast (both ROBs are updated by hand),
   links to no deal, and has no BL. Both barges are busy for its window: it
   counts as an Unavailable block for each of them (planner, Availability
   Check, Free Windows, conflict warnings — see _transferBlocksForBarge).
   Duration = quantity ÷ the giving barge's pump rate for the grade + hose-up. */
function _isTransfer(r) { return !!r && r.kind === 'transfer'; }
function _ldKind() { const el = document.getElementById('ld-kind'); return el && el.value === 'transfer' ? 'transfer' : 'loading'; }
function _xferRate(fromBargeName, grade) {
  const b = (typeof getBarges === 'function' ? getBarges() : (_bargeConfig || [])).find(function(x) { return x.name === fromBargeName; });
  if (!b) return 0;
  return Number(grade === 'LSMGO' ? b.mtph : b.vtph) || 0;
}
function _xferHoseHrs() { return Number((_calcParams || {}).hoseHrs) || 0; }
function _xferDuration(fromBargeName, grade, qty) {
  const rate = _xferRate(fromBargeName, grade);
  const pump = rate > 0 && qty > 0 ? qty / rate : 0;
  return { rate: rate, pump: pump, hose: _xferHoseHrs(), total: pump > 0 ? pump + _xferHoseHrs() : 0 };
}
// Show the fields of the chosen type (terminal loading / barge transfer).
function _ldKindChanged() {
  const xfer = _ldKind() === 'transfer';
  document.querySelectorAll('#loading-form-card .ld-xfer-only').forEach(function(el) { el.style.display = xfer ? '' : 'none'; });
  document.querySelectorAll('#loading-form-card .ld-load-only').forEach(function(el) { el.style.display = xfer ? 'none' : ''; });
  const lbl = document.getElementById('ld-barge-label');
  if (lbl) lbl.innerHTML = xfer ? 'To barge <span style="font-weight:400;color:var(--muted)">— receives</span>' : 'Barge';
  const sl = document.getElementById('ld-start-date-label');
  if (sl) sl.textContent = xfer ? 'Transfer Start Date' : 'Loading Start Date';
  const lb = document.getElementById('loading-submit-btn-label');
  if (lb && !_loadingEditingId) lb.textContent = xfer ? 'Add Transfer' : 'Add Loading';
  _populateLoadingBargeSelect();
  _recalcLoadingEstimate();
}
// Barges that can't be the other side: giving and receiving must differ.
function _ldSyncFromBarge() {
  const from = document.getElementById('ld-from-barge'), to = document.getElementById('ld-barge');
  if (!from || !to) return;
  if (from.value && from.value === to.value) {
    const other = Array.from(to.options).map(function(o) { return o.value; }).find(function(v) { return v !== from.value; });
    if (other) to.value = other;
  }
}

function _recalcLoadingEstimate() {
  const qty = parseFloat(document.getElementById('ld-qty')?.value) || 0;
  const grade = document.getElementById('ld-grade')?.value || 'VLSFO';
  const startDateStr = document.getElementById('ld-start-date')?.value;
  const startTimeStr = document.getElementById('ld-start-time')?.value || '08:00';
  const xfer = _ldKind() === 'transfer';
  const preOps = xfer ? 0 : (parseFloat(document.getElementById('ld-pre-ops')?.value) || 0);
  const postOps = xfer ? 0 : (parseFloat(document.getElementById('ld-post-ops')?.value) || 0);

  const xd = xfer ? _xferDuration((document.getElementById('ld-from-barge') || {}).value, grade, qty) : null;
  const pumpHrs = xfer ? xd.pump : computeLoadingDurationHours(qty, grade);
  const totalHrs = xfer ? xd.total : preOps + pumpHrs + postOps;
  // Time-frame start: completion = frame END + the operation (worst case).
  const win = _ldStartWin();
  const winHrs = win ? _etaFrameHrs(win) : 0;
  const hintEl = document.getElementById('ld-start-win-hint');
  if (hintEl) hintEl.textContent = win ? 'Starts ' + _etaFrameTxt(win) + ' — completion shown for a start at ' + pad(_etaFrame(win).to % 24) + ':00 (latest)' : '';

  const pumpEl = document.getElementById('ld-pump-duration-display');
  const durEl = document.getElementById('ld-duration-display');
  const compEl = document.getElementById('ld-completion-display');
  if (pumpEl) pumpEl.value = pumpHrs > 0 ? _formatDurationHours(pumpHrs) + (xfer ? ' at ' + xd.rate + ' MT/h' : '') : (xfer && qty > 0 && !xd.rate ? 'No pump rate for this grade on the giving barge' : '—');
  if (durEl) durEl.value = totalHrs > 0 ? _formatDurationHours(totalHrs) + (xfer ? ' (incl. hose-up ' + _formatDurationHours(xd.hose) + ')' : '') : '—';

  if (compEl) {
    if (totalHrs > 0 && startDateStr) {
      const start = new Date(startDateStr + 'T' + startTimeStr + ':00');
      if (!isNaN(start)) {
        const end = new Date(start.getTime() + (winHrs + totalHrs) * 3600000);
        compEl.value = (winHrs ? 'Latest ' : '') + end.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
          + ' ' + end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
      } else {
        compEl.value = '—';
      }
    } else {
      compEl.value = '—';
    }
  }
}

// Single entry point for the form's primary button — routes to add or
// update depending on whether we're currently editing a record.
function submitLoadingForm() {
  if (_loadingEditingId) updateLoadingRecord(_loadingEditingId);
  else addLoadingRecord();
}

// Native <input type="time"> renders 12h/24h based on the DEVICE's OS
// locale, not the page's lang attribute — Chrome ignores lang="en-GB" for
// the picker UI. A plain text field with digit-masking sidesteps that
// entirely: it's always 24h, and typing raw digits like "2300" auto-formats
// to "23:00" as you type, which is exactly what a native time input can't
// reliably do across devices.
function _maskTime24Input(el) {
  const digits = el.value.replace(/[^\d]/g, '').slice(0, 4);
  el.value = digits.length > 2 ? digits.slice(0, 2) + ':' + digits.slice(2) : digits;
}
function _validateTime24Input(el) {
  const digits = el.value.replace(/[^\d]/g, '');
  let hh = 8, mm = 0;
  if (digits.length === 3) { hh = parseInt(digits[0], 10); mm = parseInt(digits.slice(1), 10); }
  else if (digits.length === 4) { hh = parseInt(digits.slice(0, 2), 10); mm = parseInt(digits.slice(2), 10); }
  else if (digits.length <= 2 && digits.length > 0) { hh = parseInt(digits, 10); mm = 0; }
  hh = Math.min(23, Math.max(0, hh || 0));
  mm = Math.min(59, Math.max(0, mm || 0));
  el.value = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  _recalcLoadingEstimate();
}

// Local-calendar YYYY-MM-DD / HH:MM — toISOString() is UTC, which shifted
// the date a day back for anyone east of UTC (e.g. Dubai before 04:00).
function _localDateInputStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function _localTimeInputStr(d) {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// ── Loading start given as a time frame (AM / PM …) — see ETA_TIME_FRAMES ──
function _ldEnsureWinOptions() {
  const sel = document.getElementById('ld-start-win');
  if (sel && !sel.options.length) sel.innerHTML = _etaFrameOptionsHTML('AM');
  return sel;
}
// Form → frame code ('' = exact start time).
function _ldStartWin() {
  const chk = document.getElementById('ld-start-win-chk'), sel = document.getElementById('ld-start-win');
  return (chk && chk.checked && sel && _etaFrame(sel.value)) ? sel.value : '';
}
// Put the form into frame mode for `code` ('' = exact time).
function _ldSetStartWin(code) {
  const chk = document.getElementById('ld-start-win-chk'), sel = _ldEnsureWinOptions(), tm = document.getElementById('ld-start-time');
  if (!chk || !sel) return;
  const f = _etaFrame(code);
  chk.checked = !!f;
  sel.hidden = !f;
  if (f) sel.value = f.code;
  if (tm) { tm.disabled = !!f; if (f) tm.value = pad(f.from) + ':00'; }
  _recalcLoadingEstimate();
}
function _ldToggleStartWin() {
  const chk = document.getElementById('ld-start-win-chk'), sel = _ldEnsureWinOptions(), tm = document.getElementById('ld-start-time');
  if (!chk || !sel) return;
  // Ticking picks the frame that holds the time already typed.
  const h = tm ? parseInt(String(tm.value).slice(0, 2), 10) : NaN;
  _ldSetStartWin(chk.checked ? (isNaN(h) ? 'AM' : _etaFrameForHour(h)) : '');
}
function _ldStartWinChanged() { const sel = document.getElementById('ld-start-win'); if (sel) _ldSetStartWin(sel.value); }

function _readLoadingForm() {
  const barge = (document.getElementById('ld-barge')?.value || '').trim();
  const terminal = (document.getElementById('ld-terminal')?.value || '').trim();
  const grade = document.getElementById('ld-grade')?.value || 'VLSFO';
  const qty = parseFloat(document.getElementById('ld-qty')?.value) || 0;
  const startDateStr = document.getElementById('ld-start-date')?.value;
  const startTimeStr = document.getElementById('ld-start-time')?.value || '08:00';
  const preOps = parseFloat(document.getElementById('ld-pre-ops')?.value) || 0;
  const postOps = parseFloat(document.getElementById('ld-post-ops')?.value) || 0;
  const endOverride = document.getElementById('ld-end-date-override')?.value;
  const surveyor = (document.getElementById('ld-surveyor')?.value || '').trim();
  const notes = (document.getElementById('ld-notes')?.value || '').trim();
  const xfer = _ldKind() === 'transfer';
  // A transfer has no deal (the Deal field is hidden for it, whatever it still holds).
  let dealId = xfer ? '' : (document.getElementById('ld-deal')?.value || '');
  const deal = dealId ? _dealById(dealId) : null;
  if (!deal) dealId = ''; // a removed deal
  else if ((deal.grade === 'LSMGO' ? 'LSMGO' : 'VLSFO') !== grade) { alert('The deal "' + (deal.supplier || '') + '" is for ' + (deal.grade === 'LSMGO' ? 'LSMGO' : 'VLSFO') + ' — pick a ' + grade + ' deal, or "No deal".'); return null; }

  const fromBarge = xfer ? ((document.getElementById('ld-from-barge') || {}).value || '').trim() : '';
  if (xfer) {
    if (!fromBarge || !barge) { alert('Choose the barge that discharges and the barge that receives.'); return null; }
    if (fromBarge === barge) { alert('A transfer needs two different barges.'); return null; }
  } else if (!terminal) { alert('Enter a terminal.'); return null; }
  if (!qty || qty <= 0) { alert('Enter a quantity greater than 0.'); return null; }
  if (!startDateStr) { alert('Select a ' + (xfer ? 'transfer' : 'loading') + ' start date.'); return null; }
  if (xfer && !_xferRate(fromBarge, grade)) { alert(fromBarge + ' has no ' + (grade === 'LSMGO' ? 'MGO' : 'VLSFO') + ' pump rate — set it on Barge Fleet first.'); return null; }

  const startWin = _ldStartWin();
  const start = new Date(startDateStr + 'T' + (startWin ? pad(_etaFrame(startWin).from) + ':00' : startTimeStr) + ':00');
  if (isNaN(start)) { alert('That start date/time isn\'t valid.'); return null; }

  const xd = xfer ? _xferDuration(fromBarge, grade, qty) : null;
  const pumpHrs = xfer ? xd.pump : computeLoadingDurationHours(qty, grade);
  const totalHrs = xfer ? xd.total : preOps + pumpHrs + postOps;
  // Time-frame start (AM / PM …): start = frame start; the barge stays
  // committed until frame END + the whole operation (worst case).
  const estimatedEnd = new Date(start.getTime() + ((startWin ? _etaFrameHrs(startWin) : 0) + totalHrs) * 3600000);
  const end = endOverride ? new Date(endOverride + 'T23:59:59') : estimatedEnd;
  if (xfer) {
    return Object.assign({
      kind: 'transfer', fromBarge: fromBarge, barge: barge, terminal: '', grade: grade, qty: qty,
      startAt: start.toISOString(), endAt: end.toISOString(),
      preOpsHours: 0, pumpHours: pumpHrs, postOpsHours: 0, hoseHours: xd.hose, estimatedHours: totalHrs,
      endOverridden: !!endOverride, surveyor: surveyor, notes: notes,
    }, startWin ? { startWin: startWin } : {});
  }

  return Object.assign({
    barge, terminal, grade, qty,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    preOpsHours: preOps,
    pumpHours: pumpHrs,
    postOpsHours: postOps,
    estimatedHours: totalHrs,
    endOverridden: !!endOverride,
    surveyor,
    notes,
  }, startWin ? { startWin } : {}, dealId ? { dealId } : {});
}

function _clearLoadingForm() {
  if (typeof _rlClearPrefillNote === 'function') _rlClearPrefillNote();
  ['ld-terminal','ld-qty','ld-notes','ld-end-date-override','ld-surveyor'].forEach(function(id) {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const dl = document.getElementById('ld-deal');
  if (dl) { delete dl.dataset.manual; delete dl.dataset.own; dl.value = ''; }
  _ldRefreshDealSelect();
}

// ── Loading vs. vessel-supply / other-loading conflict check ──────────
// Reuses the exact same overlap math (_doesJobConflict) already trusted
// for vessel-to-vessel barge scheduling, so a Loading gets checked
// against that barge's live vessel supply commitments the same way. This
// warns rather than blocks — sometimes an overlap is known/intentional
// (e.g. loading finishing right as supply starts) — but it's never
// silent anymore.
function _checkLoadingConflict(bargeName, startAt, endAt, excludeLoadingId) {
  // (a transfer's own window shows up as a block on both its barges — the
  // record loop below reports it once, so blocks made from transfers are skipped)
  const conflicts = [];
  if (!bargeName) return conflicts;
  const b = (_bargeConfig || []).find(function(x) { return x.name === bargeName; });
  const travelHrs = (_calcParams && _calcParams.travelHrs) || 0;
  const jobStart = new Date(startAt);
  const jobEnd = new Date(endAt);

  // Against that barge's active vessel supply commitments
  if (b) {
    _getBargeTimeline(b.id, b.name).forEach(function(op) {
      if (op.transferId) return;
      if (_doesJobConflict(jobStart, jobEnd, op, travelHrs, 0)) {
        conflicts.push(op.isBlock ? `Barge unavailable — ${op.reason || 'blocked'} (${fmt24(op.start)} → ${fmt24(op.etc)})`
                                  : `Vessel ${op.vessel} (supply ${fmt24(op.start)} → ${fmt24(op.etc)})`);
      }
    });
  }

  // Against that barge's OTHER loadings (direct window overlap, no travel
  // buffer needed since both events are on the same barge already)
  (_loadingRecords || []).forEach(function(r) {
    if (r.id === excludeLoadingId) return;
    if (r.deletedAt) return;
    if (r.completed) return;
    if (r.barge !== bargeName && !(_isTransfer(r) && r.fromBarge === bargeName)) return;
    const rStart = new Date(r.startAt), rEnd = new Date(r.endAt);
    if (jobStart < rEnd && jobEnd > rStart) {
      conflicts.push(_isTransfer(r) ? `Barge transfer ${r.fromBarge} → ${r.barge} (${fmt24(rStart)} → ${fmt24(rEnd)})` : `Loading at ${r.terminal} (${fmt24(rStart)} → ${fmt24(rEnd)})`);
    }
  });

  return conflicts;
}

function _confirmLoadingConflicts(bargeName, startAt, endAt, excludeLoadingId, fromBarge) {
  // A transfer occupies both barges: each is checked.
  const names = fromBarge ? [fromBarge, bargeName] : [bargeName];
  const parts = names.map(function(n) { return { n: n, c: _checkLoadingConflict(n, startAt, endAt, excludeLoadingId) }; }).filter(function(x) { return x.c.length; });
  if (!parts.length) return true;
  return confirm(
    parts.map(function(x) { return `⚠ ${x.n} is already committed during this window:\n\n` + x.c.map(c => '• ' + c).join('\n'); }).join('\n\n') +
    `\n\nSave this ${fromBarge ? 'transfer' : 'Loading'} anyway?`
  );
}

function addLoadingRecord() {
  const data = _readLoadingForm();
  if (!data) return;
  if (!_confirmLoadingConflicts(data.barge, data.startAt, data.endAt, null, data.fromBarge)) return;
  const rec = Object.assign({ id: 'ld_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) }, data, { updatedAt: Date.now() });
  _loadingRecords.push(rec);
  saveLoadingRecords();
  _clearLoadingForm();
  _recalcLoadingEstimate();
  renderLoadingList();
  _refreshLoadingConsumers();
}

function editLoadingRecord(id) {
  const rec = (_loadingRecords || []).find(function(r) { return r.id === id; });
  if (!rec) return;
  _loadingEditingId = id;
  _loadingEditingSeen = rec.updatedAt || null;

  const start = new Date(rec.startAt);
  const kindEl = document.getElementById('ld-kind');
  if (kindEl) { kindEl.value = _isTransfer(rec) ? 'transfer' : 'loading'; _ldKindChanged(); }
  _populateLoadingBargeSelect();
  const bargeSel = document.getElementById('ld-barge');
  if (bargeSel && rec.barge) bargeSel.value = rec.barge;
  const fromSel = document.getElementById('ld-from-barge');
  if (fromSel && rec.fromBarge) fromSel.value = rec.fromBarge;
  document.getElementById('ld-terminal').value = rec.terminal || '';
  document.getElementById('ld-grade').value = rec.grade || 'VLSFO';
  document.getElementById('ld-qty').value = rec.qty || '';
  document.getElementById('ld-start-date').value = _localDateInputStr(start);
  document.getElementById('ld-start-time').value = _localTimeInputStr(start);
  _ldSetStartWin(rec.startWin || '');
  // A transfer has no ops hours: the hidden fields keep the defaults, so switching it to a loading starts from them.
  document.getElementById('ld-pre-ops').value = (!_isTransfer(rec) && rec.preOpsHours != null ? rec.preOpsHours : 2.5);
  document.getElementById('ld-post-ops').value = (!_isTransfer(rec) && rec.postOpsHours != null ? rec.postOpsHours : 3.5);
  document.getElementById('ld-end-date-override').value = rec.endOverridden ? _localDateInputStr(new Date(rec.endAt)) : '';
  document.getElementById('ld-surveyor').value = rec.surveyor || '';
  document.getElementById('ld-notes').value = rec.notes || '';
  _ldRefreshDealSelect(rec.dealId || '');

  document.getElementById('loading-submit-btn-label').textContent = _isTransfer(rec) ? 'Update Transfer' : 'Update Loading';
  document.getElementById('loading-cancel-edit-btn').style.display = '';
  _recalcLoadingEstimate();

  const card = document.getElementById('loading-form-card');
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateLoadingRecord(id) {
  const data = _readLoadingForm();
  if (!data) return;
  const idx = (_loadingRecords || []).findIndex(function(r) { return r.id === id; });
  if (idx === -1) { cancelLoadingEdit(); return; }
  if (!_confirmLoadingConflicts(data.barge, data.startAt, data.endAt, id, data.fromBarge)) return;
  // The form's fields replace the record's; everything else the record carries
  // (Completed + its BL figure set on another device meanwhile, a tombstone…)
  // is kept. Fields the form left out on purpose are cleared.
  const next = Object.assign({}, _loadingRecords[idx], data, { id: id, updatedAt: Date.now() });
  if (!data.startWin) delete next.startWin;
  if (!data.dealId) delete next.dealId;
  if (!_isTransfer(data)) { delete next.kind; delete next.fromBarge; delete next.hoseHours; }
  else { delete next.blQty; delete next.blAt; delete next.blDate; } // a transfer has no BL
  _loadingRecords[idx] = next;
  saveLoadingRecords();
  cancelLoadingEdit();
  renderLoadingList();
  _refreshLoadingConsumers();
}

function cancelLoadingEdit() {
  _loadingEditingId = null;
  _clearLoadingForm();
  document.getElementById('ld-pre-ops').value = 2.5;
  document.getElementById('ld-post-ops').value = 3.5;
  _ldSetStartWin('');
  document.getElementById('loading-submit-btn-label').textContent = _ldKind() === 'transfer' ? 'Add Transfer' : 'Add Loading';
  document.getElementById('loading-cancel-edit-btn').style.display = 'none';
  _recalcLoadingEstimate();
}

function deleteLoadingRecord(id) {
  if (!confirm('Remove this loading from the schedule?')) return;
  // Soft-delete (tombstone), not a physical removal from the array. The
  // sync merge in applyState() for loading records is additive-only — it
  // can only ever ADD or UPDATE an entry, it has no way to know "this id
  // is gone on purpose" versus "this device just hasn't synced it yet".
  // A physically-removed record looks identical to the second case to
  // that merge, so it gets silently resurrected the next time an older
  // local cache or a remote copy that still has it gets merged back in —
  // which is exactly what was being reported. Marking it deleted instead
  // means the deletion itself is a real, timestamped fact that travels
  // through the same merge (newer updatedAt wins) instead of an absence
  // the merge can't represent at all.
  const rec = (_loadingRecords || []).find(function(r) { return r.id === id; });
  if (!rec) return;
  rec.deletedAt = Date.now();
  rec.updatedAt = Date.now();
  saveLoadingRecords();
  if (_loadingEditingId === id) cancelLoadingEdit();
  renderLoadingList();
  _refreshLoadingConsumers();
}

// Marks a loading as complete — this removes it from the calendar and
// Supply Timeline ("what's still happening" views), but it now still
// appears in the dashboard Operational Activity feed as a completed
// entry (see renderDashActivity) instead of disappearing silently. The
// record itself isn't deleted; it stays visible (greyed, tagged Done)
// in the Loading page's own list, with an Undo option in case it was
// marked by mistake.
function markLoadingRecordDone(id, blQty, blDate) {
  const rec = (_loadingRecords || []).find(function(r) { return r.id === id; });
  if (!rec) return;
  rec.completed = true;
  rec.completedAt = Date.now();
  if (blQty != null && blQty !== '' && !isNaN(Number(blQty))) { rec.blQty = Number(blQty); rec.blAt = Date.now(); }
  if (blDate && /^\d{4}-\d{2}-\d{2}$/.test(blDate)) rec.blDate = blDate; // the BL's own date (YYYY-MM-DD)
  rec.updatedAt = Date.now(); // so the merge knows this is the newer copy
  saveLoadingRecords();
  if (_loadingEditingId === id) cancelLoadingEdit();
  renderLoadingList();
  _refreshLoadingConsumers();
}

function undoLoadingRecordDone(id) {
  const rec = (_loadingRecords || []).find(function(r) { return r.id === id; });
  if (!rec) return;
  rec.completed = false;
  delete rec.completedAt;
  _touchLoading(rec);
  saveLoadingRecords();
  renderLoadingList();
  _refreshLoadingConsumers();
}

// Everywhere else in the app that shows loadings — calendar, Supply
// Timeline, and the dashboard Operational Activity feed — refreshed
// together so a change never goes stale on the other pages.
function _refreshLoadingConsumers() {
  if (typeof renderWeekCalendar === 'function') renderWeekCalendar(_calWeekOffset || 0);
  if (typeof renderTimelineLoadingStrip === 'function') renderTimelineLoadingStrip();
  if (typeof refreshDashboard === 'function' && document.getElementById('page-dashboard')?.classList.contains('active')) refreshDashboard();
  if (typeof _rlRefreshIfShown === 'function') _rlRefreshIfShown(); // forecast + reload alerts
  if (typeof _refreshDealsIfShown === 'function') _refreshDealsIfShown(); // deal balances
}

function _refreshLoadingTerminalDatalist() {
  const dl = document.getElementById('ld-terminal-list');
  if (!dl) return;
  const known = Array.from(new Set((_loadingRecords || []).filter(function(r) { return !r.deletedAt; }).map(function(r) { return r.terminal; }).filter(Boolean)));
  dl.innerHTML = known.map(function(t) { return '<option value="' + t.replace(/"/g,'&quot;') + '">'; }).join('');
}

