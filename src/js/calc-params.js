/* ═══ CALCULATION PARAMETERS (editable) ═══ */
const CALC_PARAMS_KEY = 'abps_calc_params_v1';
// contingencyHrs: planning margin added after each job's ETC by Free Windows
// and the Availability Check (never changes the scheduler's own ETCs).
let _calcParams = { hoseHrs: 6, travelHrs: 1, contingencyHrs: 1 };
function loadCalcParams() {
  try {
    const raw = localStorage.getItem(CALC_PARAMS_KEY);
    if (raw) { const p = JSON.parse(raw); _calcParams.hoseHrs = p.hoseHrs ?? 6; _calcParams.travelHrs = p.travelHrs ?? 1; _calcParams.contingencyHrs = p.contingencyHrs ?? 1; }
  } catch(e) {}
}
// Older saves/payloads carry no contingencyHrs — treat as the 1h default.
function _contingencyHrs() {
  const c = _calcParams ? _calcParams.contingencyHrs : null;
  return (c === null || c === undefined || isNaN(Number(c)) || Number(c) < 0) ? 1 : Number(c);
}
function saveCalcParams() {
  try { localStorage.setItem(CALC_PARAMS_KEY, JSON.stringify(_calcParams)); } catch(e) {}
}
/* ════════════════════════════════════════ */

// FT84: One-time migration of old positional UIDs to stable name-based UIDs.
// Old format: "3_desh_abhimaan" (sno + slug) → new format: "v_desh_abhimaan" (name only).
// Safe to run multiple times (idempotent).
function _migrateChecklistUids() {
  const oldStylePattern = /^\d+_/; // starts with digits then underscore
  const toMigrate = Object.entries(_checklistRecords).filter(([uid]) => oldStylePattern.test(uid));
  if (!toMigrate.length) return;
  let migrated = 0;
  toMigrate.forEach(([oldUid, rec]) => {
    // Derive the new stable UID from vessel name
    const newUid = _clUid(rec.sno, rec.vessel);
    if (newUid === oldUid) return; // already matches new format (shouldn't happen)
    if (_checklistRecords[newUid]) {
      // Conflict: new-style key already exists. Prefer whichever is locked/completed.
      const existing = _checklistRecords[newUid];
      const isDone = r => !!(r.lockedAt || r.supplied || r.state === 'completed');
      if (isDone(rec) && !isDone(existing)) {
        // Old key has a completed record — prefer it
        _checklistRecords[newUid] = Object.assign({}, rec, { uid: newUid });
      } else if (isDone(rec)) {
        // Both are real, completed supplies (same vessel, different calls) —
        // never drop a completed record; keep the old one under its own key.
        const altUid = newUid + '__resupply_' + oldUid.replace(/[^A-Za-z0-9_-]/g, '_');
        _checklistRecords[altUid] = Object.assign({}, rec, { uid: altUid });
      }
      // else the old one is an open duplicate draft — keep the existing record
    } else {
      // No conflict — migrate cleanly
      _checklistRecords[newUid] = Object.assign({}, rec, { uid: newUid });
    }
    delete _checklistRecords[oldUid];
    migrated++;
  });
  if (migrated > 0) {
    console.log(`ABPS FT84: migrated ${migrated} checklist record(s) to stable UIDs`);
    // Push migration to shared storage so all users benefit
    saveSharedState();
  }
}

async function init() {
  _loadSyncCfg();  // confirm Supabase sync is ready
  loadCalcParams(); // restore hose time + travel buffer
  renderCalcParamsView();
  if (typeof loadArchivesLocal === 'function') loadArchivesLocal();
  setSyncStatus('syncing', 'Loading workspace…');

  // Fix #3: load the local (synchronous, instant) nomination-email-sent
  // cache BEFORE any vessel cards get restored below, so each card's
  // "Send Nomination Email" button renders in the correct locked/unlocked
  // state on the very first paint, with no flash of an incorrect state.
  // The slower remote reconciliation still happens later, non-blocking.
  _loadNomEmailLogLocal();
  _loadNomCancelEmailLogLocal();

  // Load saved records first
  await loadSharedRecords(true);

  // Try to load shared state
  const loaded = await loadSharedState(false);

  // FT84 FIX: Migrate old positional UIDs (format "N_slug") to new name-based UIDs ("v_slug")
  // This runs once on init to clean up any legacy data from pre-FT84 saves.
  _migrateChecklistUids();

  if (!loaded) {
    // Nothing in shared storage — leave it genuinely empty. No demo barge,
    // no sample vessels. The operator adds everything themselves from a
    // clean slate, and that blank state gets saved as-is on their first
    // edit (no seed data to accidentally keep, edit, or forget to delete).
    setSyncStatus('ok', 'Fresh empty workspace');
  }

  // Silently roll any fully-completed past month into Archives — this used
  // to only ever happen if someone remembered to click "Archive" by hand,
  // so a finished month's records just sat in the live list indefinitely.
  if (typeof autoArchivePastMonths === 'function') autoArchivePastMonths();

  startAutoSync();
  _rtStart(); // instant updates on top of the poll (see REALTIME)
  startReminderAutoRefresh();
  await loadROBAudit();
  await loadManualROB();
  if (typeof _ciLoadTemplates === 'function') _ciLoadTemplates();
  if (typeof _loadDeliveryLogLocal === 'function') _loadDeliveryLogLocal();
  // Fix #3: reconcile with the remote copy of the nomination-email log
  // (the local copy was already loaded at the top of init(), before
  // vessels were restored). Once this resolves, re-check every currently
  // rendered card in case the remote log knows about a "sent" nomination
  // this device's local cache didn't have yet (e.g. sent from another
  // operator's browser).
  await _loadNomEmailLogRemote();
  await _loadNomCancelEmailLogRemote();
  document.querySelectorAll('.vcard[id^="vessel-"]').forEach(function(card) {
    const id = card.id.replace('vessel-', '');
    _refreshSendEmailButtonState(id);
    _refreshCancelEmailButtonState(id);
  });

  // If schedule was restored from state, rebuild dependent UI.
  // Wrapped defensively: a bug in any one of these renders should never be
  // able to abort the rest of init() and leave the app half-initialized —
  // that exact failure mode previously made correctly-restored data (like
  // barge ROB) look like it had been lost, when really a later render call
  // had simply crashed before the user ever saw the value on screen.
  if (_lastSched && _lastSched.length) {
    try {
      injectChecklistFromSchedule(_lastSched);
      renderChecklist(_lastSched);
      renderLiveROBDashboard();
      if (_bargeConfig && _bargeConfig.length) {
        renderBargeTabsAndTL(_lastSched, _bargeConfig);
      }
      renderRemainingSupplyTracker();
      renderWeekCalendar(0);
      refreshScheduleKPIs();
    } catch(e) {
      console.error('init(): error rebuilding dependent UI from restored schedule —', e.message);
      setSyncStatus('error', 'Some panels failed to render — try Pull or refresh');
    }
  }
}

// init() now runs only after a successful Operator Access login —
// see _startAppAfterLogin() / _handleOperatorLogin() and the
// DOMContentLoaded listener in the Operator Access module above,
// which checks for an existing Supabase session and either skips
// the gate or waits for the operator to sign in.

