/* ── Persistent warning banner for sync failures ──────────────────────
   The small topbar status dot is easy to miss. When cloud sync fails,
   show an unmissable banner so the operator knows their changes are only
   on THIS device/browser and won't appear for teammates or survive a
   browser data clear, until the underlying issue (usually an expired
   sign-in session) is fixed. ─────────────────────────────────────────── */
function _showSyncWarningBanner(errMsg) {
  let banner = document.getElementById('sync-warning-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'sync-warning-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999997;background:var(--amber-lt);border-bottom:1px solid #F5C842;color:var(--amber);font-size:12px;font-weight:600;padding:8px 16px;text-align:center;display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap';
    banner.innerHTML = '<span>⚠ Cloud sync failed — your changes are saved on this device only and won\'t reach your team until this is fixed.</span>' +
      '<span id="sync-warning-detail" style="font-weight:400;opacity:.85"></span>' +
      '<button onclick="_retrySyncNow()" style="background:var(--amber);color:#fff;border:none;border-radius:5px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer">Retry</button>' +
      '<button onclick="document.getElementById(\'sync-warning-banner\').style.display=\'none\'" style="background:transparent;color:var(--amber);border:1px solid var(--amber);border-radius:5px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer">Dismiss</button>';
    document.body.appendChild(banner);
  }
  // Show the real reason inline instead of only in a hover tooltip, and
  // phrase the common cases in plain language so this is self-diagnosable
  // without having to go dig through code every time it happens.
  // Never advise signing out here: Log Out wipes this device's copy, which
  // is the only one holding these changes. A reload keeps them and merges
  // them in once a pull succeeds (after signing in again if it has to).
  const m = (errMsg || '').toLowerCase();
  let friendly = errMsg ? `(${errMsg})` : '';
  if (m.includes('jwt') || m.includes('session') || m.includes('expired') || m.includes('401') || m.includes('row-level security') || m.includes('row level security')) {
    friendly = "(Your sign-in session isn't valid right now — click Retry. If that doesn't clear it, reload the page: your changes stay on this device. If it keeps happening, contact your operations lead.)";
  } else if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('network')) {
    friendly = '(Could not reach the server — check your internet connection.)';
  }
  const detailEl = document.getElementById('sync-warning-detail');
  if (detailEl) detailEl.textContent = friendly;
  banner.title = errMsg || '';
  banner.style.display = 'flex';
}
function _clearSyncWarningBanner() {
  const banner = document.getElementById('sync-warning-banner');
  if (banner) banner.style.display = 'none';
}
async function _retrySyncNow() {
  setSyncStatus('syncing', 'Retrying…');
  // Don't just re-run the same save against whatever session is already
  // cached — that's exactly why Retry could fail over and over with the
  // identical error even right after a fresh launch. Force an actual new
  // token from Supabase first; only fall through to the save once that's
  // done (or clearly not possible), so Retry has a real chance of fixing
  // a bad session instead of repeating it.
  if (supabaseClient) {
    try { await supabaseClient.auth.refreshSession(); } catch (e) { /* fall through — the save below will surface the real error if this didn't help */ }
  }
  // Still waiting for the first successful pull: recover (merge + push)
  // rather than saving blind.
  if (_cloudBaseUnknown) { await _pollOnce(true); return; }
  await saveSharedState();
}

/* ── Offline banner: first pull failed, so we're showing this device's
   cached copy and holding every change locally until the cloud answers. ── */
function _showOfflineBanner() {
  let banner = document.getElementById('sync-offline-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'sync-offline-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999998;background:var(--amber-lt);border-bottom:1px solid #F5C842;color:var(--amber);font-size:12px;font-weight:600;padding:8px 16px;text-align:center;display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap';
    banner.innerHTML = '<span>⚠ Offline / cloud not reachable — changes are kept on this device and will sync when reconnected.</span>' +
      '<button onclick="_retrySyncNow()" style="background:var(--amber);color:#fff;border:none;border-radius:5px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer">Retry now</button>';
    document.body.appendChild(banner);
  }
  banner.style.display = 'flex';
}
function _hideOfflineBanner() {
  const banner = document.getElementById('sync-offline-banner');
  if (banner) banner.style.display = 'none';
}

// Cached state from a previous session that never reached the cloud
// (flagged by _markUnsynced), together with the merge base it diverged from.
function _readUnsyncedLocal() {
  try {
    if (localStorage.getItem(LS_UNSYNCED_KEY) !== '1') return null;
    const raw = localStorage.getItem(LS_STATE_KEY);
    if (!raw) return null;
    const baseRaw = localStorage.getItem(LS_SYNC_BASE_KEY);
    const base = baseRaw ? JSON.parse(baseRaw) : null;
    const recRaw = localStorage.getItem(LS_RECORDS_KEY);
    return { state: JSON.parse(raw), records: recRaw ? JSON.parse(recRaw) : null, base: base && base.payload ? base.payload : null, baseVersion: base ? Number(base.version) || 0 : 0 };
  } catch(e) { return null; }
}
function _applyLocalCache(cache) {
  applyState(cache.state);
  if (Array.isArray(cache.records)) _savedSupplies = cache.records;
  if (cache.state && _isPlainObj(cache.state.manualROB)) _manualROB = cache.state.manualROB;
  if (typeof renderSavedRecords === 'function') renderSavedRecords();
}

// First pull failed: show the cached copy, but remember we don't know what
// the cloud holds — no cloud writes until a pull succeeds (see _pollOnce).
function _enterOfflineMode(err, silent) {
  _cloudBaseUnknown = true;
  _showOfflineBanner();
  setSyncStatus('error', `Cloud not reachable — showing this device's copy (${err.message})`);
  let cache = _readUnsyncedLocal();
  if (!cache) {
    try {
      const raw = localStorage.getItem(LS_STATE_KEY);
      const recRaw = localStorage.getItem(LS_RECORDS_KEY);
      if (raw) cache = { state: JSON.parse(raw), records: recRaw ? JSON.parse(recRaw) : null, base: null, baseVersion: 0 };
    } catch(e) {}
  }
  if (!cache) return false;
  _applyLocalCache(cache);
  // Merge base: the last synced copy if we have it, else the cache as loaded
  // (so only edits made from now on count as "local changes").
  _lastSyncedPayload = cache.base ? _deepClone(cache.base) : _buildLocalPayload();
  _lastKnownVersion = cache.base ? cache.baseVersion : 0;
  return true;
}

// Pull the cloud row and reconcile it with this device. Returns true if
// anything was applied. Never runs underneath a save.
async function _pullAndMerge(opts) {
  opts = opts || {};
  const row = await _jbGetRow(); // throws if unreachable
  const recovering = _cloudBaseUnknown;
  if (!row || !row.payload || !row.payload.state) {
    // Reachable but empty: a genuinely blank workspace (new project or just
    // wiped). Don't resurrect anything into it automatically.
    if (recovering) { _cloudBaseUnknown = false; _hideOfflineBanner(); }
    _lastKnownVersion = 0;
    _lastSyncedPayload = null;
    return false;
  }
  if (!opts.force && !recovering && !(row.version > _lastKnownVersion)) return false; // only ever move forward
  _initialPullDone = true;
  const local = _buildLocalPayload();
  const base = _lastSyncedPayload;
  // No base yet (the cloud was empty when we loaded): local edits that
  // never reached the cloud are flagged unsynced — merge them (union)
  // rather than letting the first row someone else created wipe them.
  const localDirty = base ? !_samePayload(local, base) : _isMarkedUnsynced();
  _cloudBaseUnknown = false;
  _hideOfflineBanner();
  if (!localDirty) {
    if (!base && row.payload && row.payload.state) _adoptCloudLoadings(row.payload.state); // first row after an empty cloud: no union of the local store
    _applyPayload(row.payload, !!base);
    _adoptBase(row, true);
    _markUnsynced(false);
    return true;
  }
  // This device has changes the cloud hasn't seen (offline edits, or a
  // pending debounced edit): merge them onto the cloud copy, then push.
  const { merged, conflicts } = _mergePayloads(base, local, row.payload);
  _applyPayload(merged, true);
  _adoptBase(row, false);
  _toastMerged(conflicts);
  saveSharedState();
  return true;
}

async function loadSharedState(silent = false, force = false) {
  if (!silent) setSyncStatus('syncing', 'Loading…');
  // Try Supabase first if configured
  if (_syncReady()) {
    await _waitForSaveIdle(); // never apply remote state underneath an in-flight save
    const firstLoad = !_initialPullDone && !_cloudBaseUnknown;
    let applied;
    const endPull = _beginPull(); // ...and no save starts underneath this pull
    try {
      if (firstLoad) {
        // Unsynced edits from a previous session on this device: restore
        // them and their merge base first, so the pull below merges instead
        // of overwriting them.
        const cache = _readUnsyncedLocal();
        const row = await _jbGetRow();
        _initialPullDone = true;
        if (cache && cache.base && row) {
          _applyLocalCache(cache);
          _lastSyncedPayload = _deepClone(cache.base);
          _lastKnownVersion = cache.baseVersion;
        } else if (cache && !cache.base) {
          console.warn('FLOW: unsynced local changes found without a merge base — the cloud copy wins.');
        }
        applied = await _applyPulledRow(row, true);
      } else {
        applied = await _pullAndMerge({ force: force });
      }
    } catch(e) {
      setSyncStatus('error', `Pull failed: ${e.message}`);
      // Network/auth error on the very first pull: show the cached copy but
      // hold all cloud writes until a pull succeeds (no stale overwrite).
      if (firstLoad) return _enterOfflineMode(e, silent);
      if (_cloudBaseUnknown) { _showOfflineBanner(); return false; }
      _showSyncWarningBanner(e.message);
      return false;
    } finally {
      endPull();
    }
    if (applied) {
      if (!silent) setSyncStatus('ok', `Pulled — ${new Date(_lastKnownVersion).toLocaleTimeString()}`);
      _clearSyncWarningBanner();
      return true;
    }
    // Bug fix (kept): the cloud IS reachable but has no row yet — that is a
    // true "this workspace is empty" answer and must NOT fall through to the
    // localStorage fallback below (which could resurrect stale data).
    if (!silent) setSyncStatus('ok', _lastKnownVersion ? `Up to date — ${new Date().toLocaleTimeString()}` : 'Fresh empty workspace');
    return false;
  }
  // Fallback: localStorage — only reached when the cloud is not configured.
  try {
    const raw = localStorage.getItem(LS_STATE_KEY);
    if (raw) {
      const state = JSON.parse(raw);
      applyState(state);
      if (!silent) setSyncStatus('ok', `Loaded from local — ${new Date().toLocaleTimeString()}`);
      return true;
    }
  } catch(e) {}
  if (!silent) setSyncStatus('ok', 'Fresh workspace');
  return false;
}
// First successful pull of the session (row may be null = empty cloud).
// The cloud's loadings and deals replace the local store's copy (nothing on
// this device is unsynced — a change waiting to be pushed flags the device,
// see saveSharedState, and then the merge path runs instead): a Wipe Cloud /
// Clear All Data done elsewhere sticks. A row written by an older build has
// no loadingDeals key at all: that list stays as it is here.
function _adoptCloudLoadings(st) {
  if (_isMarkedUnsynced()) return;
  const adopt = function(cloud, local) { return Array.isArray(cloud) ? _deepClone(cloud) : (st ? local : []); };
  _loadingRecords = adopt(st && st.loadingRecords, _loadingRecords);
  _loadingDeals = adopt(st && st.loadingDeals, _loadingDeals);
  _saveLoadingToLocal();
}
async function _applyPulledRow(row, force) {
  if (!row) {
    const hadBase = !!_lastSyncedPayload; // an unsynced cache restored above: its edits are merged later, not dropped
    _lastKnownVersion = 0; _lastSyncedPayload = null;
    // Reachable but empty (wiped elsewhere): nothing of the local store's
    // loadings / deals survives either, unless this device has unsynced edits.
    if (!hadBase && !_isMarkedUnsynced() && ((_loadingRecords || []).length || (_loadingDeals || []).length)) {
      _adoptCloudLoadings(null);
      if (typeof renderLoadingList === 'function') renderLoadingList();
      if (typeof _refreshDealsIfShown === 'function') _refreshDealsIfShown();
    }
    return false;
  }
  if (_lastSyncedPayload) {
    // Restored unsynced local changes above — reconcile via the merge path
    // using the row we already fetched.
    const local = _buildLocalPayload();
    if (!_samePayload(local, _lastSyncedPayload)) {
      const { merged, conflicts } = _mergePayloads(_lastSyncedPayload, local, row.payload);
      _applyPayload(merged, true);
      _adoptBase(row, false);
      _toastMerged(conflicts);
      saveSharedState();
      return true;
    }
  }
  // Nothing unsynced on this device: the cloud's loadings and deals are the
  // truth — the local store's copy (which may predate a Wipe Cloud / Clear
  // All Data elsewhere) must not be unioned back in and re-uploaded.
  if (row.payload && row.payload.state) _adoptCloudLoadings(row.payload.state);
  _applyPayload(row.payload, false);
  _adoptBase(row, true);
  _markUnsynced(false);
  return true;
}

async function loadSharedRecords(silent = false) {
  // Bug fix: this used to unconditionally load _savedSupplies from
  // localStorage before the cloud was ever checked. On a BRAND NEW
  // Supabase project (genuinely zero rows), loadSharedState() correctly
  // finds nothing to restore for barges/vessels — but it has no records
  // payload to act on either, so it never got the chance to clear out
  // whatever this function had already preloaded from a previous
  // session's local cache. That's how old completed supplies (from an
  // earlier/different Supabase project on the same browser) kept
  // reappearing in the Activity feed even on a "blank" workspace.
  //
  // Fix: only trust the local cache once we know the cloud was actually
  // unreachable or not configured. If the cloud IS reachable, defer to
  // whatever loadSharedState() decides — including "nothing" — and do
  // not silently resurrect a local-only cache on top of that decision.
  if (typeof _syncReady === 'function' && _syncReady()) {
    // Cloud is configured — let loadSharedState() be the single source
    // of truth for _savedSupplies. Don't touch it here at all.
    if (!silent) renderSavedRecords();
    return;
  }
  try {
    const raw = localStorage.getItem(LS_RECORDS_KEY);
    if (raw) _savedSupplies = JSON.parse(raw);
  } catch(e) {}
  if (!silent) renderSavedRecords();
}

// Records and loadings ride in the same payload as everything else, so they
// go through the one serialized save pipeline (fresh version, compare-and-
// swap, merge on conflict) instead of re-writing the whole row under an old
// version number the way they used to. Errors surface via the banner.
async function saveSharedRecords() {
  try { localStorage.setItem(LS_RECORDS_KEY, JSON.stringify(_savedSupplies)); } catch(e) {}
  if (isTrader()) {
    // Supply records are operator data — RLS refuses them for traders.
    if (typeof showToast === 'function') showToast('Supply records can only be saved by an operator account — this change stays on this device only.', 'warning');
    return false;
  }
  return saveSharedState();
}

async function saveLoadingRecords() {
  _saveLoadingToLocal();
  if (isTrader()) {
    if (typeof showToast === 'function') showToast('Loadings can only be saved by an operator account — this change stays on this device only.', 'warning');
    return false;
  }
  return saveSharedState();
}

