/* ─── PRINT ─── */
function printScheduleOnly() {
  const _prStsL = _stsLookup();
  if (!_lastSched.length){alert('Generate the schedule first.');return;}

  // Collect selected vessel SNOs from the voyage table checkboxes
  const checkedSNOs = new Set();
  document.querySelectorAll('.voy-print-chk:checked').forEach(chk => {
    checkedSNOs.add(parseInt(chk.dataset.sno));
  });
  if (checkedSNOs.size === 0) {
    alert('No vessels selected.\nUse the Print checkboxes in the Voyage Schedule table to select vessels.');
    return;
  }

  const printItems = _lastSched.filter(item => checkedSNOs.has(item.sno));
  const allSelected = checkedSNOs.size === _lastSched.length;
  const container = document.getElementById('print-only-container');
  const now = fmt24(new Date());
  const bargeNames = [...new Set(printItems.map(i=>i.bargeLabel).filter(Boolean))].join(' · ');
  const totV = printItems.reduce((a,i)=>a+((i.nomVQ!==undefined&&i.nomVQ!==null)?i.nomVQ:i.vQ), 0);
  const totM = printItems.reduce((a,i)=>a+((i.nomMQ!==undefined&&i.nomMQ!==null)?i.nomMQ:i.mQ), 0);
  const selNote = allSelected ? `${printItems.length} vessels` : `${printItems.length} of ${_lastSched.length} vessels selected`;

  const cols=[{label:'No.',w:'3%'},{label:'Vessel',w:'11%'},{label:'Area',w:'5%'},{label:'FO (MT)',w:'5%'},{label:'MGO (MT)',w:'5%'},{label:'Spec',w:'7%'},{label:'Laycan',w:'9%'},{label:'ETA',w:'9%'},{label:'Supply Start',w:'9%'},{label:'ETC',w:'9%'},{label:'Sequence',w:'8%'},{label:'Status',w:'5%'},{label:'PAQ',w:'4%'},{label:'Agent',w:'5%'},{label:'Barge',w:'5%'},{label:'Manifold',w:'5%'}];

  const rows = printItems.map((item, idx) => {
    const nomV_ = (item.nomVQ !== undefined && item.nomVQ !== null) ? item.nomVQ : item.vQ;
    const nomM_ = (item.nomMQ !== undefined && item.nomMQ !== null) ? item.nomMQ : item.mQ;
    const fo = nomV_>0?esc(_nomQtyTxt(item,'V',nomV_)):'—', mo = nomM_>0?esc(_nomQtyTxt(item,'M',nomM_)):'—';
    // Sequence within this vessel's own barge, over the full schedule (an
    // unticked previous vessel is still physically ahead of it).
    const sameBargePr = _lastSched.filter(x => (x.bargeLabel||'') === (item.bargeLabel||''));
    const seqPr = classifySeq(item, sameBargePr.indexOf(item), sameBargePr);
    const plan = seqPr.label;
    const lcIn = !!(item.lc&&item.eta&&_itemEtaEnd(item)>=item.lc.from&&item.eta<=item.lc.to);
    const lcStr = item.lc ? fmtLC(item.lc) : '—';
    const stat = item.noFirmETA ? 'No Firm ETA' : item.isDelayed ? 'Delayed' : 'On Laycan';
    const paqStr = item.paq==='yes' ? 'Rcvd' : ' Pending';
    const bg = idx%2===0 ? '#ffffff' : '#f7f9fc';
    const statColor = item.noFirmETA ? 'var(--purple)' : item.isDelayed ? 'var(--amber)' : 'var(--green)';
    const statBg    = item.noFirmETA ? 'var(--purple-lt)' : item.isDelayed ? '#FFF5E0' : '#E5F5EC';
    const paqColor  = item.paq==='yes' ? 'var(--green)' : 'var(--red)';
    const lcColor   = lcIn ? 'var(--green)' : 'var(--amber)';
    const areaS = areaShort(item.area);
    const prSts = _stsOf(_prStsL, item);
    return `<tr${prSts ? ' class="is-sts"' : ''} style="background:${bg}">
      <td style="text-align:center;color:var(--muted);font-weight:700">${esc(item.sno)}</td>
      <td><strong>${esc(item.name)}</strong>${_stsTag({ sts: prSts })}</td>
      <td style="font-size:6.5pt;font-weight:700;font-family:monospace">${esc(areaS)}</td>
      <td style="text-align:right;font-family:monospace">${fo}</td>
      <td style="text-align:right;font-family:monospace">${mo}</td>
      <td>${esc(item.spec||'—')}</td>
      <td style="color:${lcColor};font-family:monospace">${esc(lcStr)}</td>
      <td style="font-family:monospace">${_itemEtaTxt(item)}</td>
      <td style="font-family:monospace">${fmt24(item.bargeStart)}</td>
      <td style="font-family:monospace">${fmt24(item.etc)}</td>
      <td style="font-size:6.5pt;color:var(--fuel-v)">${esc(plan)}</td>
      <td><span style="font-size:6pt;padding:2px 4px;border-radius:3px;background:${statBg};color:${statColor};font-weight:700">${stat}</span></td>
      <td style="color:${paqColor};font-weight:700;font-size:6.5pt">${paqStr}</td>
      <td>${esc(item.agent||'—')}</td>
      <td>${esc(item.bargeLabel||'—')}</td>
      <td>${esc(item.mani||'—')}</td>
    </tr>`;
  }).join('');

  const colGroup = cols.map(c=>`<col style="width:${c.w}">`).join('');
  const thCells  = cols.map(c=>`<th>${c.label}</th>`).join('');

  container.innerHTML = `
    <div class="print-schedule-header">
      <table style="width:100%;border-collapse:collapse;margin-bottom:0"><tr>
        <td style="vertical-align:top">
          <div style="font-family:DM Sans,sans-serif;font-size:14pt;font-weight:700;color:var(--ink)">FLOW — Voyage Schedule</div>
          <div style="font-size:8pt;color:var(--pg-deliverylog);margin-top:3px">Generated: ${now} ${esc(_localTzLabel())} &nbsp;|&nbsp; Barges: ${esc(bargeNames||'—')} &nbsp;|&nbsp; ${selNote}</div>
        </td>
        <td style="text-align:right;vertical-align:top">
          <div style="font-size:8pt;color:var(--pg-deliverylog)">Total VLSFO: <strong style="color:var(--ink)">${totV.toLocaleString()} MT</strong> &nbsp;|&nbsp; Total MGO: <strong style="color:var(--ink)">${totM.toLocaleString()} MT</strong></div>
          ${!allSelected ? `<div style="font-size:7pt;color:var(--amber);margin-top:2px"> Partial schedule — ${_lastSched.length - checkedSNOs.size} vessel(s) excluded</div>` : ''}
        </td>
      </tr></table>
    </div>
    <div class="voy-wrap">
      <table class="voy-tbl" style="width:100%">
        <colgroup>${colGroup}</colgroup>
        <thead><tr>${thCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  container.style.display = 'block';
  setTimeout(() => { window.print(); setTimeout(() => { container.style.display = 'none'; }, 500); }, 80);
}
/* ─── TYPED CONFIRMATION for bulk-destructive actions ───
   A plain confirm() is one stray Enter/tap away from wiping the shared
   workspace for every device. These actions instead open a modal that says
   exactly what goes (and what stays), and the action button only enables
   once the word shown is typed. Resolves true ONLY on that explicit
   confirmation — Cancel, Escape and a backdrop click all resolve false, so
   the destructive function behind it never runs. */
let _dangerConfirm = null; // { word, resolve, returnFocus } while the modal is open
function _typedConfirm(opts) {
  return new Promise(function(resolve) {
    const modal = document.getElementById('danger-confirm-modal');
    if (!modal) { resolve(false); return; }
    if (_dangerConfirm) _dangerConfirm.resolve(false); // a superseded prompt never confirms
    _dangerConfirm = { word: String(opts.word).toUpperCase(), resolve: resolve, returnFocus: document.activeElement };
    const list = function(head, items, cls) {
      return items && items.length
        ? `<div class="${cls}"><div class="danger-confirm-head">${esc(head)}</div><ul>${items.map(function(i) { return '<li>' + esc(i) + '</li>'; }).join('')}</ul></div>`
        : '';
    };
    document.getElementById('danger-confirm-title').textContent = opts.title;
    document.getElementById('danger-confirm-intro').textContent = opts.intro || '';
    document.getElementById('danger-confirm-lists').innerHTML =
      list('Will be deleted', opts.deletes, 'danger-confirm-del') + list('Kept', opts.keeps, 'danger-confirm-keep');
    document.getElementById('danger-confirm-label').innerHTML = 'Type <strong class="danger-confirm-word">' + esc(_dangerConfirm.word) + '</strong> to confirm';
    const input = document.getElementById('danger-confirm-input');
    input.value = '';
    const go = document.getElementById('danger-confirm-go');
    go.textContent = opts.action || opts.title;
    go.disabled = true;
    modal.style.display = 'flex';
    setTimeout(function() { try { input.focus(); } catch(e) {} }, 30);
  });
}
function _dangerConfirmMatches() {
  const input = document.getElementById('danger-confirm-input');
  return !!(_dangerConfirm && input && input.value.trim().toUpperCase() === _dangerConfirm.word);
}
function _dangerConfirmSync() {
  const go = document.getElementById('danger-confirm-go');
  if (go) go.disabled = !_dangerConfirmMatches();
}
function _dangerConfirmClose(ok) {
  const modal = document.getElementById('danger-confirm-modal');
  const pending = _dangerConfirm;
  if (!pending) { if (modal) modal.style.display = 'none'; return; }
  // Re-checked here, not trusted from the button state: a click on a
  // still-disabled button (or a scripted one) must never confirm.
  const confirmed = !!ok && _dangerConfirmMatches();
  if (ok && !confirmed) return;
  _dangerConfirm = null;
  if (modal) modal.style.display = 'none';
  const inp = document.getElementById('danger-confirm-input');
  if (inp) inp.value = '';
  try { if (pending.returnFocus && pending.returnFocus.focus) pending.returnFocus.focus(); } catch(e) {}
  pending.resolve(confirmed);
}
document.addEventListener('keydown', function(e) {
  if (!_dangerConfirm) return;
  if (e.key === 'Escape') { e.preventDefault(); _dangerConfirmClose(false); }
  else if (e.key === 'Enter' && e.target && e.target.id === 'danger-confirm-input') { e.preventDefault(); if (_dangerConfirmMatches()) _dangerConfirmClose(true); }
});

// Sidebar "Data Management" disclosure — collapsed by default on every load.
function toggleDangerZone(force) {
  const btn = document.getElementById('danger-zone-toggle');
  const panel = document.getElementById('danger-zone-panel');
  if (!btn || !panel) return;
  const open = typeof force === 'boolean' ? force : btn.getAttribute('aria-expanded') !== 'true';
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  panel.hidden = !open;
}

/* ─── FULL RESET ─── */
async function confirmFullReset() {
  if (isTrader()) return; // operators only (RLS refuses the write anyway)
  const ok = await _typedConfirm({
    title: 'Full Reset', word: 'RESET', action: 'Reset workspace',
    intro: 'Clears the live plan on this device and in the shared workspace, so every device sees it on its next sync.',
    deletes: ['All vessel nominations', 'All barge configurations (incl. manual ROB overrides)', 'The generated schedule', 'Checklist data', 'Trash Bin on this device'],
    keeps: ['Saved supply records', 'Monthly and fiscal-year archives']
  });
  if (!ok) return;
  fullReset();
}
async function fullReset() {
  document.getElementById('vc').innerHTML = '';
  vc = 0;
  document.getElementById('barge-list').innerHTML = '';
  bc = 0; _barges = [];
  _lastSched=[]; _bargeStates={}; _bargeConfig=[];
  _lastSchedMeta=null; _bargeBlocks=[];
  _lastETC=null; _closingV=0; _closingM=0;
  _checklist={}; _checklistRecords={}; _trashBin=[];
  Object.values(_lcPickers).forEach(p=>{try{p.destroy();}catch(e){}});
  Object.values(_etaPickers).forEach(p=>{try{p.destroy();}catch(e){}});
  Object.keys(_lcPickers).forEach(k=>delete _lcPickers[k]);
  Object.keys(_etaPickers).forEach(k=>delete _etaPickers[k]);
  // Clear the actual RENDERED schedule output, not just the in-memory
  // _lastSched — otherwise the old voyage table/timeline stays visibly
  // painted on screen even though the underlying data was reset.
  _scheduleReady = false;
  const outputEl = document.getElementById('output');
  if (outputEl) { outputEl.classList.remove('vis'); outputEl.style.display = 'none'; }
  document.getElementById('nsc-section').classList.remove('vis');
  const sumCards = document.getElementById('sum-cards');
  if (sumCards) sumCards.innerHTML = '';
  const tlWrap = document.getElementById('tl');
  if (tlWrap) tlWrap.innerHTML = '';
  const voyWrap = document.getElementById('voy-barge-tabs');
  if (voyWrap) voyWrap.innerHTML = '';
  const apV = document.getElementById('ap-v');
  if (apV) apV.innerHTML = '';
  const apM = document.getElementById('ap-m');
  if (apM) apM.innerHTML = '';
  const brs = document.getElementById('barge-rob-summary');
  if (brs) brs.innerHTML = '<div style="font-size:13px;color:var(--muted);text-align:center;padding:16px;background:var(--surface);border-radius:var(--radius);box-shadow:var(--sh-in-xs)">Generate the schedule to see ROB Summary.</div>';
  const dlSpan = document.getElementById('per-barge-dl-btns');
  if (dlSpan) dlSpan.innerHTML = '';
  // Saved supply records are KEPT, as the confirmation promises (they used to
  // be wiped here). Manual ROB overrides are keyed by barge id and the barges
  // are gone — a new "Barge 1" would inherit the old one's override — so
  // they're cleared, locally too (loadManualROB falls back to that key).
  _manualROB={};
  try { localStorage.removeItem('abps_manual_rob_v1'); } catch(e) {}
  renderSavedRecords();
  renderTrashBin();
  // Leave blank — no auto-added barge. The operator adds their own.
  await saveSharedState();
  window.scrollTo({top:0,behavior:'smooth'});
  showToast('Workspace reset — nominations, barges, and schedule cleared', 'info');
}

/* ─── CLEAR CHECKLIST — wipes only active pending checklist rows ─── */
async function confirmClearChecklist() {
  if (isTrader()) return;
  const ok = await _typedConfirm({
    title: 'Clear Checklist', word: 'CLEAR', action: 'Clear checklist',
    intro: 'Removes every pending checklist row, here and in the shared workspace. Pending rows for vessels still in the schedule are rebuilt fresh — use this to fix duplicate or stale rows.',
    deletes: ['All pending (not yet supplied) checklist rows'],
    keeps: ['Completed rows and saved supply records', 'Barge ROB and vessel nominations', 'The schedule']
  });
  if (!ok) return;
  return clearChecklistRecords();
}
// Runs only via confirmClearChecklist() (or tests calling it directly).
async function clearChecklistRecords() {

  // Remove only PENDING checklist rows, exactly as the confirmation says.
  // This used to also wipe _lastSched, _bargeStates and _bargeConfig (the
  // schedule and every barge's ROB) despite promising to keep them. Keeping
  // completed rows matters too: re-creating them as pending would let the
  // same supply be saved twice. Pending rows for vessels still in the
  // schedule are rebuilt fresh (deduplicated) by renderChecklist below.
  Object.keys(_checklistRecords || {}).forEach(function(uid) {
    const r = _checklistRecords[uid];
    if (!r || !(r.state === 'completed' || r.lockedAt)) delete _checklistRecords[uid];
  });

  renderChecklist(_lastSched || []);
  if (typeof renderRemainingSupplyTracker === 'function') renderRemainingSupplyTracker();

  // Push the clean state to Supabase so stale data cannot come back on next sync
  let ok = false;
  try { ok = await saveSharedState(); }
  catch(e) { console.error('clearChecklistRecords: save failed', e); }
  if (ok) {
    _flashSyncBanner && _flashSyncBanner('✓ Checklist cleared — workspace updated', 'var(--azure)');
  } else {
    showToast('Checklist cleared on this device, but saving to the shared workspace failed — other devices may still show the old rows.', 'error', 8000);
  }
}

function _archiveTombstonesFor(arch) {
  const now = new Date().toISOString(), out = {};
  Object.keys(arch || {}).forEach(function(yr) {
    Object.keys(arch[yr] || {}).forEach(function(mon) {
      if (!out[yr]) out[yr] = {};
      out[yr][mon] = { deleted: true, deletedAt: now };
    });
  });
  return out;
}
/* ─── NUCLEAR CLEAR — wipes every key ABPS has ever written ─── */
async function confirmNuclearClear() {
  if (isTrader()) return;
  // Irreversible — typed confirmation (was confirm() + prompt())
  const ok = await _typedConfirm({
    title: 'Clear All Data', word: 'DELETE', action: 'Delete everything',
    intro: 'Permanently deletes everything FLOW holds, on this device and in the shared cloud workspace (incl. the nomination email logs). Nothing is kept and this cannot be undone.',
    deletes: ['All vessel nominations and barge configurations', 'All saved supply records and checklist records', 'All ROB history and manual overrides', 'All monthly archives', 'All schedule data', 'The shared workspace and email-log rows in Supabase'],
    keeps: ['Archived fiscal years (Bunker Quantity chart)']
  });
  if (!ok) return;
  nuclearClear();
}

async function nuclearClear() {
  // Block the 30-second auto-sync loop for the entire duration of this
  // operation. Without this, a background auto-sync tick could fire
  // mid-clear (or right after) and pull back a stale cached copy of the
  // very data this function is deleting — which is exactly how cleared
  // vessels/checklist rows were able to silently reappear minutes later.
  _isSyncing = true;
  try {
  // ── 1. Wipe all known localStorage keys ──
  const ALL_KEYS = [
    'abps_shared_state_v3',
    'abps_shared_records_v3',
    'abps_state_v4',
    'abps_records_v4',
    'abps_rob_audit_v1',
    'abps_manual_rob_v1',
    'abps_records',
    'abps_saved_records',
    'abps_checklist',
    'abps_checklist_records',
    'abps_trash',
    'abps_trash_bin_v1',
    'abps_archives',
    'abps_preferred_barge',
    'abps_nomination_email_log_v1',
    'abps_agents',
    // NOTE: deliberately NOT clearing abps_sync_cfg_v1 (keep credentials)
  ];
  ALL_KEYS.forEach(k => { try { localStorage.removeItem(k); } catch(e) {} });

  // Also sweep any other abps_ or flow_ keys that may have been written
  try {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('abps_') || k.startsWith('flow_'))) toRemove.push(k);
    }
    toRemove.forEach(k => { try { localStorage.removeItem(k); } catch(e) {} });
  } catch(e) {}

  // ── 2. Wipe the real shared cloud storage (Supabase abps_workspace table) ──
  // This deletes BOTH rows this app writes: the main shared state/records
  // row, and the permanent nomination-email-sent log row. Deleting these
  // (rather than just clearing locally) means every device/operator that
  // opens this workspace next will also see a genuinely blank slate, not
  // just this one browser. Failures here are surfaced, not swallowed —
  // a silently-failed delete left the old row in place, and the
  // push at the end of this function would not have overwritten it if
  // an auto-sync pull had already restored it locally first.
  let _cloudWipeFailed = false;
  if (typeof _syncReady === 'function' && _syncReady()) {
    try {
      const r1 = await supabaseClient.from('abps_workspace').delete().eq('id', ABPS_WORKSPACE_ID);
      if (r1.error) { _cloudWipeFailed = true; console.error('Clear All Data: failed to delete main workspace row:', r1.error.message); }
    } catch(e) { _cloudWipeFailed = true; console.error('Clear All Data: main workspace delete threw:', e.message); }
    try {
      const r2 = await supabaseClient.from('abps_workspace').delete().eq('id', 'nomination_email_log');
      if (r2.error) { _cloudWipeFailed = true; console.error('Clear All Data: failed to delete nomination_email_log row:', r2.error.message); }
    } catch(e) { _cloudWipeFailed = true; console.error('Clear All Data: nomination_email_log delete threw:', e.message); }
    try {
      const r3 = await supabaseClient.from('abps_workspace').delete().eq('id', 'nomination_cancel_email_log');
      if (r3.error) { _cloudWipeFailed = true; console.error('Clear All Data: failed to delete nomination_cancel_email_log row:', r3.error.message); }
    } catch(e) { _cloudWipeFailed = true; console.error('Clear All Data: nomination_cancel_email_log delete threw:', e.message); }
  }

  // ── 3. Reset all in-memory state ──
  _savedSupplies    = [];
  _checklist        = {};
  _checklistRecords = {};
  _trashBin         = [];
  try { localStorage.removeItem(TRASH_BIN_KEY); } catch(e) {}
  _bargeReloads     = []; // reload events keyed to the wiped barges — they'd re-add ROB to a new barge reusing the id
  _lastSched        = [];
  _bargeStates      = {};
  _bargeConfig      = [];
  _lastETC          = null;
  _closingV         = 0;
  _closingM         = 0;
  _manualROB        = {};
  _robAuditLog      = [];
  // Tombstone every archived month instead of just emptying the object —
  // otherwise the next sync from any other device (which still holds the
  // archives) merges them straight back in.
  _archives         = _archiveTombstonesFor(_archives);
  saveArchives();
  _lastKnownVersion = 0;
  _nomEmailLog      = {};
  _nomEmailLogLoaded = true; // nothing to load — we just wiped it, this is now the true (empty) state
  _calcParams       = { hoseHrs: 6, travelHrs: 1, contingencyHrs: 1 };
  _bargeBlocks      = []; // blocks belong to the wiped barges
  _lastSchedMeta    = null;
  // Loadings and deals: tombstoned (like archives) so another device's copy
  // cannot union them back; the local store is rewritten with the tombstones.
  (function() {
    const now = Date.now();
    const tomb = function(x) { return Object.assign({}, x, { deletedAt: x.deletedAt || now, updatedAt: now }); };
    _loadingRecords = (_loadingRecords || []).map(tomb);
    _loadingDeals = (_loadingDeals || []).map(tomb);
    _loadingEditingId = null; _dealEditingId = null;
    _saveLoadingToLocal();
    if (typeof renderLoadingList === 'function') renderLoadingList();
    if (typeof renderDeals === 'function') renderDeals();
  })();
  saveCalcParams();
  renderCalcParamsView();
  if (typeof _ciClearTemplates === 'function') _ciClearTemplates();
  // Tombstone every Delivery Log entry (like archives above) rather than
  // just emptying it, so another device's copy can't merge them back.
  _deliveryLog = _dlTombstonesFor(_deliveryLog);
  try { localStorage.removeItem('abps_delivery_log_v1'); } catch(e) {}
  _saveDeliveryLog();
  if (typeof renderDeliveryLog === 'function' && document.getElementById('dl-month-select')) renderDeliveryLog();

  // ── 4. Wipe DOM ──
  document.getElementById('vc').innerHTML = '';
  vc = 0;
  document.getElementById('barge-list').innerHTML = '';
  bc = 0; _barges = [];

  // Wipe the Availability Checker's saved check history (cards + in-memory data + inline result)
  Object.keys(_nscCheckData).forEach(k => delete _nscCheckData[k]);
  const nscList = document.getElementById('nsc-checks-list');
  if (nscList) nscList.innerHTML = '';
  const nscHdr = document.getElementById('nsc-checks-header');
  if (nscHdr) nscHdr.style.display = 'none';
  const nscInline = document.getElementById('nsc-unified-result');
  if (nscInline) { nscInline.innerHTML = ''; nscInline.className = 'nsc-result'; }
  const nscVesselName = document.getElementById('nsc-vessel-name');
  if (nscVesselName) nscVesselName.value = '';
  const nscEta = document.getElementById('nsc-vessel-eta');
  if (nscEta) nscEta.value = '';
  const nscReqV = document.getElementById('nsc-req-v');
  if (nscReqV) nscReqV.value = '500';
  const nscReqM = document.getElementById('nsc-req-m');
  if (nscReqM) nscReqM.value = '0';
  const nscPerBarge = document.getElementById('nsc-per-barge');
  if (nscPerBarge) nscPerBarge.innerHTML = '';

  // Wipe the actual RENDERED schedule output. _lastSched=[] above only
  // clears the in-memory data — the previous calculate() run's HTML table
  // (voyage schedule, timeline, summary cards) stays painted on screen
  // until something explicitly empties these containers. This was the
  // bug where Schedule Planner kept showing an old table after Clear All
  // Data even though Barge Fleet / Vessel Nominations were correctly blank.
  _scheduleReady = false;
  const outputEl = document.getElementById('output');
  if (outputEl) { outputEl.classList.remove('vis'); outputEl.style.display = 'none'; }
  const nscSection = document.getElementById('nsc-section');
  if (nscSection) nscSection.classList.remove('vis');
  const sumCards = document.getElementById('sum-cards');
  if (sumCards) sumCards.innerHTML = '';
  const tlWrap = document.getElementById('tl');
  if (tlWrap) tlWrap.innerHTML = '';
  const voyWrap = document.getElementById('voy-barge-tabs');
  if (voyWrap) voyWrap.innerHTML = '';
  const apV = document.getElementById('ap-v');
  if (apV) apV.innerHTML = '';
  const apM = document.getElementById('ap-m');
  if (apM) apM.innerHTML = '';
  const brs = document.getElementById('barge-rob-summary');
  if (brs) brs.innerHTML = '<div style="font-size:13px;color:var(--muted);text-align:center;padding:16px;background:var(--surface);border-radius:var(--radius);box-shadow:var(--sh-in-xs)">Generate the schedule to see ROB Summary.</div>';
  const dlSpan = document.getElementById('per-barge-dl-btns');
  if (dlSpan) dlSpan.innerHTML = '';

  Object.values(_lcPickers).forEach(p => { try { p.destroy(); } catch(e) {} });
  Object.values(_etaPickers).forEach(p => { try { p.destroy(); } catch(e) {} });
  Object.keys(_lcPickers).forEach(k => delete _lcPickers[k]);
  Object.keys(_etaPickers).forEach(k => delete _etaPickers[k]);

  // ── 5. Leave genuinely blank — no default barge, no sample data.
  // The person will add their own barges and vessels from scratch. ──
  renderSavedRecords();
  renderTrashBin();
  renderChecklist([]);
  renderLiveROBDashboard();

  // ── 6. Persist the clean state ──
  await saveSharedState();
  await saveSharedRecords();

  if (_cloudWipeFailed) {
    setSyncStatus('error', 'Cleared locally, but cloud delete failed — see console');
    alert('Local data is cleared, but deleting the old cloud record failed (network or permissions issue). ' +
          'The fresh empty state was still pushed on top of it just now, so this device and anyone who ' +
          'opens the workspace next should see it blank. If old vessels still reappear later, the safest ' +
          'fix is creating a brand-new Supabase project rather than continuing to reuse this one.');
  } else {
    setSyncStatus('ok', 'All data cleared — clean workspace');
  }
  showPage('dashboard');
  window.scrollTo({top:0, behavior:'smooth'});

  // Flash confirmation banner
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;background:var(--amber);color:#fff;border-radius:12px;padding:14px 24px;font-size:13px;font-weight:700;font-family:DM Sans,sans-serif;display:flex;align-items:center;gap:10px;box-shadow:0 8px 32px rgba(0,0,0,.25);white-space:nowrap';
  banner.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> All data cleared. Fresh workspace ready.';
  document.body.appendChild(banner);
  setTimeout(() => { banner.style.transition='opacity .4s'; banner.style.opacity='0'; setTimeout(()=>banner.remove(),400); }, 4000);
  } finally {
    // Always release the sync lock, even if something above threw —
    // otherwise auto-sync would stay permanently paused after an error.
    _isSyncing = false;
  }
}

/* ─── WIPE SUPABASE WORKSPACE — cloud rows + this browser's copy ─── */
async function confirmWipeSupabaseWorkspace() {
  if (isTrader()) return;
  if (!_syncReady()) {
    alert('Not connected to shared workspace — nothing to wipe.');
    return;
  }
  const ok = await _typedConfirm({
    title: 'Wipe Supabase Workspace', word: 'WIPE', action: 'Wipe cloud workspace',
    intro: 'Deletes the shared cloud rows so every device sees a clean slate on next load. This browser\'s local copy is cleared too and the app reloads, so nothing re-uploads the old data.',
    deletes: ['The shared workspace row (nominations, barges, schedule, checklist, records)', 'The nomination / cancellation email-log rows', 'This browser\'s local copy'],
    keeps: ['Archived fiscal years (Bunker Quantity chart)']
  });
  if (!ok) return;
  return wipeSupabaseWorkspace();
}
// Runs only via confirmWipeSupabaseWorkspace() (or tests calling it directly).
async function wipeSupabaseWorkspace() {
  if (!_syncReady()) {
    alert('Not connected to shared workspace — nothing to wipe.');
    return;
  }

  // Pause auto-sync for the whole operation (and, on success, until the
  // reload): a poll tick or a pending save would otherwise push this
  // device's in-memory copy straight back into the just-deleted row.
  _isSyncing = true;
  if (_syncInterval) { clearInterval(_syncInterval); _syncInterval = null; }
  setSyncStatus('syncing', 'Wiping cloud workspace…');
  try {
    // Supabase reports failures (RLS, expired session…) in `error`, it does
    // not throw — these results used to be ignored, so a wipe that deleted
    // nothing still reported success.
    const failures = [];
    for (const rowId of [ABPS_WORKSPACE_ID, 'nomination_email_log', 'nomination_cancel_email_log']) {
      const res = await supabaseClient.from('abps_workspace').delete().eq('id', rowId);
      if (res && res.error) failures.push(rowId + ': ' + (res.error.message || res.error));
    }
    if (failures.length) throw new Error(failures.join('; '));

    // Also wipe all localStorage flow_ and abps_ keys so a reload starts clean too
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('abps_') || k.startsWith('flow_'))) toRemove.push(k);
    }
    toRemove.forEach(k => { try { localStorage.removeItem(k); } catch(e) {} });
    _lastKnownVersion = 0;
    // Clear ALL in-memory state that could re-inject stale data on next render/save
    _savedSupplies = [];
    _archives = {};
    _manualROB = {};
    _bakedSupplyIds = {};
    _robAuditLog = [];
    _trashBin = [];
    _checklist = {};
    _checklistRecords = {};
    _lastSched = [];
    _bargeStates = {};
    _bargeConfig = [];
    _lastETC = null;
    _closingV = 0; _closingM = 0;
    renderChecklist([]);
    renderSavedRecords();
    if (typeof renderRemainingSupplyTracker === 'function') renderRemainingSupplyTracker();
    if (typeof _ciClearTemplates === 'function') _ciClearTemplates();
    _deliveryLog = {};
    try { localStorage.removeItem('abps_delivery_log_v1'); } catch(e) {}
    if (typeof renderDeliveryLog === 'function' && document.getElementById('dl-month-select')) renderDeliveryLog();
    setSyncStatus('ok', 'Cloud workspace wiped — reloading');
    _flashSyncBanner && _flashSyncBanner('✓ Supabase workspace wiped. Reloading…', 'var(--green)');
    // Reload so no DOM-held state (vessel/barge cards) can be saved back up.
    setTimeout(function() { location.reload(); }, 1200);
  } catch(e) {
    _isSyncing = false;
    startAutoSync();
    setSyncStatus('error', 'Wipe failed: ' + e.message);
    alert('Wipe failed — the cloud workspace was NOT deleted.\n\n' + e.message);
  }
}

