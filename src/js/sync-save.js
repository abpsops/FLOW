/* ── Single serialized save pipeline ──────────────────────────────────
   One write at a time. Calls made while a save is in flight all share ONE
   follow-up save, which captures state when it starts, so nothing typed in
   the meantime is lost and two writes never race each other.
   A save also never STARTS underneath a pull (_pullRunning): it would
   capture the UI before the pulled row is applied while the pull moves the
   version/base forward under it, and that stale capture then wrote a
   colleague's deletion back (or reverted their edits). It waits for the
   pull and captures the post-pull state instead. */
function saveSharedState() {
  if (_saveQueued) return _saveQueued;
  const ahead = _saveRunning || _pullRunning;
  if (ahead) {
    // A real change waiting behind a pull / save is flagged now: if the tab is
    // closed before the queued save runs, the next load takes the merge path
    // instead of adopting the cloud's copy. Nothing to push (or no base to
    // compare with, e.g. after a wipe) → no flag.
    try { if (!isTrader() && _lastSyncedPayload && !_samePayload(_buildLocalPayload(), _lastSyncedPayload)) _markUnsynced(true); } catch (e) {}
    _saveQueued = ahead.catch(function() {}).then(function() { _saveQueued = null; return saveSharedState(); });
    return _saveQueued;
  }
  return _runSave();
}
function _runSave() {
  const p = _doSaveSharedState().catch(function(e) {
    console.error('saveSharedState failed:', e);
    setSyncStatus('error', `Saved locally only — cloud sync failed: ${e.message}`);
    _showSyncWarningBanner(e.message);
    return false;
  });
  _saveRunning = p;
  p.then(function() { if (_saveRunning === p) _saveRunning = null; });
  return p;
}
async function _waitForSaveIdle() {
  while (_saveRunning || _saveQueued) {
    try { await (_saveQueued || _saveRunning); } catch(e) {}
  }
}
function _nextVersion() { return Math.max(Date.now(), (Number(_lastKnownVersion) || 0) + 1); }

// Operator payload: capture + bake live ROB into opening ROB.
function _buildSavePayload() {
  const state   = captureCurrentState();
  state.version = _nextVersion();

  // Bake current live ROB into barges vrob/mrob so the Barge Fleet config
  // screen always shows the true current figure. This must be idempotent:
  // record exactly which completed-supply (and reload) ids are now folded
  // into each barge's opening so a future computeLiveROB() call (which always
  // walks the full, never-trimmed history) skips them instead of deducting
  // them a second time.
  const liveROBs = getAllLiveROBs();
  const isOnlyBargeNow = _isSingleBargeFleet(); // same rule as computeLiveROB
  const bakeT = Date.now();
  const bakedNow = new Set();
  state.barges = state.barges.map(function(b) {
    const rob = liveROBs[b.id];
    if (!rob) return b;

    // Matches computeLiveROB's own matching rule exactly (see its comment)
    // — an unassigned record only auto-attributes when there's genuinely
    // only one barge it could mean, never to "whichever barge is first".
    const matchedIds = (_savedSupplies || [])
      .filter(function(r) {
        const aV = parseFloat(r.vlsfoAct)||0, aM = parseFloat(r.mgoAct)||0;
        if (aV === 0 && aM === 0) return false;
        const rb = (r.barge||'').trim();
        if (rb === '') return isOnlyBargeNow;
        return rb === b.name;
      })
      .map(function(r) { return r.id; })
      .concat((_bargeReloads || []).filter(function(rl) { return String(rl.bargeId) === String(b.id); }).map(function(rl) { return rl.id; }))
      .filter(function(id) { return id !== undefined && id !== null; });

    const prevBaked = (_bakedSupplyIds && _bakedSupplyIds[b.id]) || [];
    const prevBakedSet = new Set(prevBaked);
    const hasNewToBake = matchedIds.some(function(id) { return !prevBakedSet.has(id); });

    // Only re-bake when there's a genuinely NEW completed supply / reload to
    // fold in since this barge's last bake.
    if (!hasNewToBake) return b;

    _bakedSupplyIds[b.id] = Array.from(new Set(prevBaked.concat(matchedIds)));
    const fig = (_manualROB || {})[b.id + '_final'], pre = (_manualROB || {})[b.id + '_pre'];
    _stampRobTook(b.id, prevBaked, matchedIds, rob.took, pre || (fig && !Array.isArray(fig.atIds)) ? 'all' : fig ? fig.atIds : null, bakeT);
    bakedNow.add(String(b.id));
    const nv = Math.round(rob.liveV), nm = Math.round(rob.liveM);
    // Write the baked opening back to the barge card inputs and the ROB
    // engine's config too — otherwise computeLiveROB keeps starting from the
    // OLD opening while skipping the now-baked supplies (ROB jumps up), and
    // the next capture pushes the old opening back to the cloud.
    _writeBackBakedOpening(b.id, nv, nm);
    // (No per-barge _robBakedAt stamp: nothing read it and the next capture
    // dropped it, which made every bake look like an unsynced local edit.
    // _bakedSupplyIds is the bake bookkeeping.)
    return Object.assign({}, b, { vrob: nv, mrob: nm });
  });
  state.bakedSupplyIds = _bakedSupplyIds;

  // Strip the manual-override keys (pre / after-each / final) ONLY for the
  // barges baked in THIS call — their new opening already reflects them.
  // Every other barge's override must survive the save, a reload, and a
  // pull on another device.
  const savedManualROB = Object.assign({}, _manualROB || {});
  Object.keys(savedManualROB).forEach(function(k) {
    const bid = k.replace(/_pre$|_final$|_after_.*$/, '');
    if (bid !== k && bakedNow.has(bid)) delete savedManualROB[k];
  });
  // A "current ROB" figure folded in here was measured: the supplies baked
  // before it stay in it (_correctBakedSupply moves nothing for them).
  bakedNow.forEach(function(bid) {
    if ((_manualROB || {})[bid + '_final'] || (_manualROB || {})[bid + '_pre']) savedManualROB[bid + '_measured'] = { v: bakeT - 1, m: bakeT - 1 };
  });
  _manualROB = savedManualROB;
  state.manualROB   = Object.assign({}, savedManualROB);
  state.robAuditLog = _robAuditLog || [];

  const activeChecklistRecords = _activeChecklistRecords();
  state.checklistRecords = activeChecklistRecords;
  return _deepClone({ state, records: _savedSupplies || [], checklistRecords: activeChecklistRecords, version: state.version });
}

function _writeBackBakedOpening(bargeId, v, m) {
  const vi = document.getElementById(`b${bargeId}-vrob`), mi = document.getElementById(`b${bargeId}-mrob`);
  if (vi) vi.value = v;
  if (mi) mi.value = m;
  const cfg = (_bargeConfig || []).find(function(x) { return String(x.id) === String(bargeId); });
  if (cfg) { cfg.vrob = v; cfg.mrob = m; delete cfg.receivedV; delete cfg.receivedM; }
  try { if (typeof updateBargeView === 'function') updateBargeView(bargeId); } catch(e) {}
}

function _persistLocalPayload(payload) {
  try { localStorage.setItem(LS_STATE_KEY,   JSON.stringify(payload.state)); } catch(e) {}
  try { localStorage.setItem(LS_RECORDS_KEY, JSON.stringify(payload.records || _savedSupplies)); } catch(e) {}
}

function _onCloudSaveOk(payload) {
  _lastKnownVersion = payload.version; // only ever set after a successful write
  _lastSyncedPayload = _deepClone(payload);
  _persistSyncBase();
  _markUnsynced(false);
  setSyncStatus('ok', `Saved & synced — ${new Date().toLocaleTimeString()}`);
  _clearSyncWarningBanner();
}

async function _doSaveSharedState() {
  if (isTrader()) return _traderSave();

  let payload = _buildSavePayload();
  // Always persist locally first
  _persistLocalPayload(payload);
  if (!_syncReady()) {
    setSyncStatus('ok', `Saved locally — ${new Date().toLocaleTimeString()}`);
    return true; // no cloud configured — local-only save is the expected outcome
  }
  if (_cloudBaseUnknown) {
    // We never managed to read the cloud copy, so we don't know what we'd
    // be overwriting. Keep the change on this device; it's merged and
    // pushed as soon as a pull succeeds.
    _markUnsynced(true);
    setSyncStatus('error', 'Offline — change kept on this device, will sync when reconnected');
    _showOfflineBanner();
    return false;
  }
  const forced = _forcePushOnce; _forcePushOnce = false;
  if (!forced && _lastSyncedPayload && _lastKnownVersion && _samePayload(payload, _lastSyncedPayload)) {
    // Nothing differs from what the cloud already has (e.g. the debounced
    // save every vessel card fires on load) — don't bump the version for
    // nothing; that only forces every other device into a merge.
    _markUnsynced(false);
    setSyncStatus('ok', `Saved & synced — ${new Date().toLocaleTimeString()}`);
    _clearSyncWarningBanner();
    return true;
  }
  _markUnsynced(true);
  for (let attempt = 0; attempt < 4; attempt++) {
    // Version + merge base are taken in the same synchronous step that built
    // `payload`, so the compare-and-swap and the three-way merge below always
    // describe the state the payload was captured from — even if a newer base
    // is adopted during the awaits (with base = the newer row, an item a
    // colleague deleted would look "added locally" and be written back).
    const expected = _lastKnownVersion, base = _lastSyncedPayload;
    const res = await _jbPut(payload, expected);
    if (res === 'ok') { _onCloudSaveOk(payload); return true; }

    // Conflict — somebody saved since our last sync. Merge and retry.
    const row = await _jbGetRow();
    if (!row) { _lastKnownVersion = 0; continue; } // row was deleted (wipe) → insert ours
    if (expected && row.version === expected) {
      // Nothing changed remotely, yet the UPDATE matched no row: the
      // database refused it (row-level security), it isn't a conflict.
      throw new Error('Save was rejected by the database (row-level security) — this account may not have operator write access');
    }
    // Merge what this device has NOW, not `payload`: a change made while this save was
    // on the network (another record saved, a delete) is only there, and applying the
    // merge replaces local state. `base` still fits — pulls don't run under a save.
    const { merged, conflicts } = _mergePayloads(base, _buildSavePayload(), row.payload);
    _applyPayload(merged, true);
    _adoptBase(row, false);
    _toastMerged(conflicts);
    payload = _buildSavePayload();   // recapture from the merged UI (re-bakes idempotently)
    _persistLocalPayload(payload);
  }
  throw new Error('Could not save — the shared workspace kept changing underneath this save. Please try again.');
}

// ── TRADER-SAFE SAVE PATH ────────────────────────────────────────────
// Trader accounts never write barges, checklist, ROB, or any other
// operational data. The ONLY thing pushed is the vessels/nominations array,
// through the trader_update_vessels() RPC (the only write path RLS grants
// a trader). It now carries expected_version, so a trader's save can't
// silently overwrite a nomination change made a moment earlier by someone
// else: on 'version_conflict' we pull, merge the vessels, and retry.
function _isMissingRpcSignature(error) {
  const msg = [error && error.message, error && error.details, error && error.hint].filter(Boolean).join(' ');
  if (/version_conflict/i.test(msg)) return false;
  return (error && (error.code === 'PGRST202' || error.code === '42883')) ||
    /could not find the function|function .*does not exist|expected_version/i.test(msg);
}
async function _traderSave() {
  const state = captureCurrentState();
  state.version = _nextVersion();
  try { localStorage.setItem(LS_STATE_KEY, JSON.stringify(state)); } catch(e) {}
  if (!_syncReady()) { setSyncStatus('ok', `Saved locally — ${new Date().toLocaleTimeString()}`); return true; }
  if (_cloudBaseUnknown) {
    _markUnsynced(true);
    setSyncStatus('error', 'Offline — change kept on this device, will sync when reconnected');
    _showOfflineBanner();
    return false;
  }
  if (_lastSyncedPayload && _lastKnownVersion && _sameJSON(state.vessels, (_lastSyncedPayload.state || {}).vessels)) {
    _markUnsynced(false);
    setSyncStatus('ok', `Saved & synced — ${new Date().toLocaleTimeString()}`);
    return true; // vessels unchanged — nothing for a trader to write
  }
  _markUnsynced(true);
  let vessels = state.vessels;
  for (let attempt = 0; attempt < 4; attempt++) {
    const version = _nextVersion();
    let error = null;
    if (!_traderRpcLegacy) {
      ({ error } = await supabaseClient.rpc('trader_update_vessels', {
        new_vessels: vessels, new_version: version, expected_version: _lastKnownVersion || null
      }));
      if (error && _isMissingRpcSignature(error)) {
        // supabase_role_setup.sql hasn't been re-run yet — fall back to the
        // old 2-argument function so trader saves keep working meanwhile.
        console.warn('FLOW: trader_update_vessels(expected_version) not installed yet — using the old signature. Re-run supabase_role_setup.sql.');
        _traderRpcLegacy = true; error = null;
      }
    }
    if (_traderRpcLegacy) {
      // No server-side version check on the old function: narrow the race
      // by merging with the latest cloud copy right before writing.
      const row = await _jbGetRow();
      if (row && row.version !== _lastKnownVersion) {
        const { merged, conflicts } = _mergePayloads(_lastSyncedPayload, { state: { vessels } }, row.payload);
        _applyPayload(merged, true);
        _adoptBase(row, false);
        _toastMerged(conflicts);
        vessels = captureCurrentState().vessels;
      }
      ({ error } = await supabaseClient.rpc('trader_update_vessels', { new_vessels: vessels, new_version: version }));
    }
    if (!error) {
      _lastKnownVersion = version;
      if (_lastSyncedPayload && _lastSyncedPayload.state) {
        _lastSyncedPayload.state.vessels = _deepClone(vessels);
        _lastSyncedPayload.version = version;
        _lastSyncedPayload.state.version = version;
      }
      _persistSyncBase();
      _markUnsynced(false);
      setSyncStatus('ok', `Saved & synced — ${new Date().toLocaleTimeString()}`);
      _clearSyncWarningBanner();
      return true;
    }
    if (!/version_conflict/i.test(error.message || '')) throw new Error(error.message || String(error));
    const row = await _jbGetRow();
    if (!row) throw new Error('Workspace row not found — ask an operator to save at least once first');
    const { merged, conflicts } = _mergePayloads(_lastSyncedPayload, { state: { vessels } }, row.payload);
    _applyPayload(merged, true);
    _adoptBase(row, false);
    _toastMerged(conflicts);
    vessels = captureCurrentState().vessels;
  }
  throw new Error('Could not save — the shared workspace kept changing underneath this save. Please try again.');
}

