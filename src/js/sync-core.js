/* ═══════════════════════════════════════════════════════════════
   STORAGE LAYER v5 — Supabase Real Internet Sync
   ─────────────────────────────────────────────────────────────
   HOW IT WORKS:
   • One shared Supabase project + table holds the team's live state
   • Push → writes full state to the `abps_workspace` table row
   • Pull → reads that row — works from any PC, any browser
   • Falls back to localStorage if Supabase is briefly unreachable
   ═══════════════════════════════════════════════════════════════ */

/* ── BUILD ID: baked at generation time — each new file is a clean slate ──
   localStorage keys include this ID, so a new file never loads old data.
   If Supabase sync is active, shared state still comes from the cloud (same
   workspace), but local-only caches start fresh. ── */
const _FLOW_BUILD_ID = '202606290803';
const LS_STATE_KEY   = 'flow_state_'   + _FLOW_BUILD_ID;
const LS_RECORDS_KEY = 'flow_records_' + _FLOW_BUILD_ID;

/* ── SHARED WORKSPACE — Supabase table ──────────────────────────────
   All operators read/write the single row with id = ABPS_WORKSPACE_ID
   in the `abps_workspace` table. Push/Pull and auto-sync just work
   for anyone signed in through the Operator Access gate above.
   ──────────────────────────────────────────────────────────────────── */
const ABPS_WORKSPACE_ID = 'main';

let _syncInterval     = null;
let _lastKnownVersion = 0;     // numeric row version of the last SUCCESSFUL pull or push (never set optimistically)
let _isSyncing        = false; // a pull (poll / Clear All Data) is running — polls skip while true
let _hasSharedStorage = false; // legacy compat — always false now

/* ── Optimistic concurrency + three-way merge ─────────────────────────
   Every write is a compare-and-swap on the row's `version`: it only lands
   if nobody else saved since our last pull/push. If someone did, we fetch
   their copy and three-way merge it with ours, using the payload we last
   synced (_lastSyncedPayload) as the common base — so two operators editing
   at the same time both keep their changes instead of the later save
   silently wiping the earlier one. */
let _lastSyncedPayload = null;  // deep clone of {state, records, checklistRecords} as of last successful pull/push
let _cloudBaseUnknown  = false; // first pull failed — we're showing local data and must NOT write to the cloud yet
let _initialPullDone   = false;
let _saveRunning       = null;  // promise of the save currently writing (one at a time)
let _saveQueued        = null;  // promise of the single follow-up save that coalesces calls made meanwhile
let _traderRpcLegacy   = false; // SQL not re-run yet: trader_update_vessels has no expected_version param
let _pollFailCount     = 0;
let _forcePushOnce     = false; // explicit Push: write even if nothing changed
let _pullRunning       = null;  // promise that settles when the pull now reading + applying the cloud row ends
function _beginPull() {
  let end; const p = new Promise(function(r) { end = r; });
  _pullRunning = p;
  return function() { if (_pullRunning === p) _pullRunning = null; end(); };
}
const LS_SYNC_BASE_KEY = 'flow_syncbase_' + _FLOW_BUILD_ID; // last synced payload (merge base) — survives reloads
const LS_UNSYNCED_KEY  = 'flow_unsynced_' + _FLOW_BUILD_ID; // '1' while this device has changes the cloud hasn't got

/* ── Sync is always ready once signed in — Supabase client handles auth ── */
function _loadSyncCfg() {
  _updateSyncUI();
}

function _saveSyncCfg() {
  // No-op by design — the shared workspace is fixed for every operator.
  _updateSyncUI();
}

function _clearSyncCfg() {
  // No-op by design — sync can't be disconnected; it's how the team shares data.
  _updateSyncUI();
}

function _syncReady() {
  return !!supabaseClient; // false if the Supabase CDN script failed to load
}

function _updateSyncUI() {
  const setupBtn  = document.getElementById('sync-setup-btn');
  const pushBtn   = document.getElementById('sync-push-btn');
  const pullBtn   = document.getElementById('sync-pull-btn');
  const configBtn = document.getElementById('sync-config-btn');
  if (!setupBtn) return;
  // Sync is always pre-configured to the shared team workspace — no setup state to show.
  setupBtn.style.display  = 'none';
  pushBtn.style.display   = '';
  pullBtn.style.display   = '';
  configBtn.style.display = 'none';
  setSyncStatus('ok', 'Shared workspace connected');
}

/* ── Supabase table helpers (replaces JSONBin) ── */

// Proactively refreshes the sign-in session if it's expired or close to
// expiring, before a real sync call is attempted. autoRefreshToken only
// runs its background timer while the tab is actively alive — this app
// is normally left open all day as a dashboard, and browsers routinely
// throttle or fully pause timers on an inactive/backgrounded tab, which
// lets the token quietly expire while nobody's looking. The first sync
// call after the tab becomes active again would otherwise just get
// rejected outright and surface as "Cloud sync failed", when a proactive
// refresh right here would have silently fixed it. Errors here are
// swallowed on purpose — if refresh genuinely fails, the real call right
// after this still runs and its real error is what the user sees.
// Signed out while the app is open (the sign-in expired or was revoked): the cloud
// would answer every read with "no workspace" and refuse every save (row-level
// security), and the app would take the shared workspace for empty. So no cloud
// call is made without a sign-in: the sign-in form comes up instead (this
// device's changes are kept and sync after signing in) and the call fails.
const FLOW_SIGNED_OUT_MSG = 'Signed out — sign in again to sync (the changes on this device are kept)';
async function _ensureFreshSession() {
  if (!supabaseClient) return;
  let lost = '';
  try {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) return; // the real call below surfaces it (offline, …)
    if (!data || !data.session) lost = 'no session';
    else {
      const expiresAt = data.session.expires_at; // unix seconds
      const nowSec = Math.floor(Date.now() / 1000);
      if (!expiresAt || expiresAt <= nowSec + 60) {
        const r = await supabaseClient.auth.refreshSession();
        if (r && r.error && !_isNetworkAuthError(r.error)) lost = 'refresh refused: ' + (r.error.message || r.error);
        else if (r && !r.error && (!r.data || !r.data.session)) lost = 'refresh gave no session';
      }
    }
  } catch(e) { /* real call below will surface any genuine problem */ }
  if (lost && navigator.onLine !== false) {
    if (typeof _flowSessionLostGate === 'function') _flowSessionLostGate(lost);
    throw new Error(FLOW_SIGNED_OUT_MSG);
  }
}

// Compare-and-swap write. Never a blind upsert: an UPDATE only matches the
// row if its version is still the one we last synced, and an INSERT only
// succeeds if no row exists yet. Returns 'ok' or 'conflict'; throws on a
// real error (network, auth, RLS).
// expectedVersion is the version `payload` was built on, captured by the
// caller together with the payload — never re-read _lastKnownVersion here,
// after an await: a pull landing meanwhile would move it forward and let a
// payload built on the OLD version overwrite the newer row.
async function _jbPut(payload, expectedVersion) {
  if (!supabaseClient) throw new Error(_supabaseLoadError || 'Supabase client not available');
  await _ensureFreshSession();
  const now = new Date().toISOString();
  if (expectedVersion) {
    const { data, error } = await supabaseClient
      .from('abps_workspace')
      .update({ payload, version: payload.version, updated_at: now })
      .eq('id', ABPS_WORKSPACE_ID)
      .eq('version', expectedVersion)
      .select('version');
    if (error) throw new Error(`Supabase save failed: ${error.message}`);
    return (data && data.length) ? 'ok' : 'conflict';
  }
  const { error } = await supabaseClient
    .from('abps_workspace')
    .insert({ id: ABPS_WORKSPACE_ID, payload, version: payload.version, updated_at: now })
    .select('version');
  if (error) {
    if (error.code === '23505' || /duplicate key/i.test(error.message || '')) return 'conflict';
    throw new Error(`Supabase save failed: ${error.message}`);
  }
  return 'ok';
}

// Full row (payload + numeric version), or null when the cloud has no row.
async function _jbGetRow() {
  if (!supabaseClient) throw new Error(_supabaseLoadError || 'Supabase client not available');
  await _ensureFreshSession();
  const { data, error } = await supabaseClient
    .from('abps_workspace')
    .select('payload, version')
    .eq('id', ABPS_WORKSPACE_ID)
    .maybeSingle();
  if (error) throw new Error(`Supabase load failed: ${error.message}`);
  if (!data || !data.payload) return null;
  return { payload: data.payload, version: Number(data.version) || Number(data.payload.version) || 0 };
}

async function _jbGet() {
  const row = await _jbGetRow();
  return row ? row.payload : null;
}

/* ── Status dot ── */
let _syncStatusTimer = null;
let _ccClockInterval = null;
let _ccDataInterval = null;
let _ccPrevAlertKeys = null; // null = first render, don't flash anything yet
const CC_ROB_HISTORY_KEY = 'flowops_cc_rob_history_v1'; // operational cache only — fine to lose on reset, unlike the FY archive
const CC_ROB_SAMPLE_MS = 10 * 60 * 1000; // one sparkline point every ~10min, capped below
let _ccRobHistory = (function() {
  try { return JSON.parse(localStorage.getItem(CC_ROB_HISTORY_KEY) || '{}'); } catch(e) { return {}; }
})();
function _ccSaveRobHistory() {
  try { localStorage.setItem(CC_ROB_HISTORY_KEY, JSON.stringify(_ccRobHistory)); } catch(e) {}
}
function _ccSparklineSvg(hist) {
  if (!hist || hist.length < 2) return '';
  const w = 90, h = 18;
  const maxV = Math.max(1, ...hist.map(p => p.v));
  const maxM = Math.max(1, ...hist.map(p => p.m));
  const ptsV = hist.map((p, i) => `${(i / (hist.length - 1) * w).toFixed(1)},${(h - (p.v / maxV) * h).toFixed(1)}`).join(' ');
  const ptsM = hist.map((p, i) => `${(i / (hist.length - 1) * w).toFixed(1)},${(h - (p.m / maxM) * h).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${h}" style="display:block;margin-top:5px" viewBox="0 0 ${w} ${h}">
    <polyline points="${ptsV}" fill="none" stroke="#4FD1E8" stroke-width="1.3"/>
    <polyline points="${ptsM}" fill="none" stroke="#F0A542" stroke-width="1.3"/>
  </svg>`;
}
function setSyncStatus(state, msg) {
  // Debounce rapid status updates (e.g. during auto-sync polling) to prevent topbar flicker
  if (_syncStatusTimer) clearTimeout(_syncStatusTimer);
  _syncStatusTimer = setTimeout(function() {
    const dot   = document.getElementById('sync-dot');
    const msgEl = document.getElementById('sync-msg');
    if (!dot || !msgEl) return;
    // Only update DOM if value actually changed — prevents unnecessary repaints
    const newClass = 'sync-dot' + (state === 'syncing' ? ' syncing' : state === 'error' ? ' error' : '');
    if (dot.className !== newClass) dot.className = newClass;
    if (msgEl.textContent !== msg) msgEl.textContent = msg;
  }, state === 'syncing' ? 0 : 120); // show 'syncing' immediately, debounce others
}

/* ── Save / Load full state ── */

