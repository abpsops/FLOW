/* ══════════════════════════════════════════════════════
   SYNC SETUP — no longer needed. Supabase is pre-configured
   in code and authentication happens through the Operator
   Access gate, so there's nothing left for an operator to set
   up here. Stub kept in case any old UI element still calls it.
   ════════════════════════════════════════════════════ */
function openSyncSetup() {
  alert('Team sync is already connected via Supabase — no setup needed.');
}
function closeSyncSetup() {}
function disconnectSync() {}

/* ── Fields saved by a NEWER build ─────────────────────────────────
   captureCurrentState() rebuilds every vessel and barge from its card, so a
   key this build doesn't know (one a later release adds, already in use by a
   colleague while this copy is still open) would be left out of this copy's
   next save, and the three-way merge reads a missing key as a deletion.
   addVessel / addBarge keep such keys from the copy the card was built from
   (the cloud row, a merge, the local cache, the trash) on the card, and the
   capture writes them back unchanged (a field read from the card always wins).
   Only keys outside these lists are kept, so a field this build writes, or
   leaves out on purpose when it is cleared (qtyMin…, etaWin, sts, mmsi), saves
   exactly as the card says. A new field goes into its list in the build that
   starts writing it. */
const _VESSEL_KEYS = ['nomUid', 'name', 'imo', 'mmsi', 'area', 'type', 'qty', 'mgo', 'qtyMin', 'qtyMax', 'mgoMin', 'mgoMax', 'spec', 'agent', 'manifold', 'remarks', 'lc', 'eta', 'etaWin', 'paq', 'bargeId', 'refuelChk', 'rfv', 'rfm', 'rfvr', 'rfmr', 'sts', 'lcOnly'];
// buf: legacy single buffer (read as vbuf/mbuf); _robBakedAt, receivedV/M: retired; _robGuardApplied: applyState's marker.
const _BARGE_KEYS = ['id', 'name', 'vcap', 'mcap', 'vrob', 'mrob', 'vbuf', 'mbuf', 'vtph', 'mtph', 'vrfr', 'mrfr', 'color', 'email', 'buf', '_robBakedAt', 'receivedV', 'receivedM', '_robGuardApplied'];
function _newerBuildFields(def, known) {
  const out = {};
  if (_isPlainObj(def)) Object.keys(def).forEach(function(k) {
    if (known.indexOf(k) === -1 && def[k] !== undefined) out[k] = _deepClone(def[k]);
  });
  return out;
}

function captureCurrentState() {
  const barges = [];
  _barges.forEach(b => {
    const id = b.id;
    barges.push(Object.assign(_deepClone(document.getElementById(`barge-${id}`)?._newerFields) || {}, {
      id, name: document.getElementById(`b${id}-name`)?.value||`Barge ${id}`,
      vcap: parseFloat(document.getElementById(`b${id}-vcap`)?.value)||5000,
      mcap: parseFloat(document.getElementById(`b${id}-mcap`)?.value)||1000,
      vrob: parseFloat(document.getElementById(`b${id}-vrob`)?.value)||0,
      mrob: parseFloat(document.getElementById(`b${id}-mrob`)?.value)||0,
      vbuf: parseFloat(document.getElementById(`b${id}-vbuf`)?.value)||500,
      mbuf: parseFloat(document.getElementById(`b${id}-mbuf`)?.value)||150,
      vtph: parseFloat(document.getElementById(`b${id}-vtph`)?.value)||300,
      mtph: parseFloat(document.getElementById(`b${id}-mtph`)?.value)||100,
      // Refill rates were never captured, so they reset to 750/275 on reload.
      vrfr: parseFloat(document.getElementById(`b${id}-vrfr`)?.value)||750,
      mrfr: parseFloat(document.getElementById(`b${id}-mrfr`)?.value)||275,
      color: (document.getElementById(`b${id}-color`)?.value)||'',
      email: (document.getElementById(`b${id}-email`)?.value||'').trim(),  // the captain's e-mail (Email to Barge)
    }));
  });
  // Reload events only for barges that still exist — a removed barge's
  // reloads must not attach to a new barge that later reuses its id.
  _bargeReloads = (_bargeReloads || []).filter(function(rl) {
    return _barges.some(function(b) { return String(b.id) === String(rl.bargeId); });
  });

  const vessels = [];
  document.querySelectorAll('.vcard[id^="vessel-"]').forEach(c => {
    const id = c.id.replace('vessel-','');
    vessels.push(Object.assign(_deepClone(c._newerFields) || {}, {
      nomUid:   c.dataset.nomUid || '',
      name:     document.getElementById(`v${id}-name`)?.value||'',
      imo:      document.getElementById(`v${id}-imo`)?.value||'',
      area:     document.getElementById(`v${id}-area`)?.value||'FUJ-A',
      type:     document.getElementById(`v${id}-type`)?.value||'VLSFO',
      qty:      _cardQty(id, 'vlsfo').qty,
      mgo:      _cardQty(id, 'mgo').qty,
      spec:     document.getElementById(`v${id}-spec`)?.value||'',
      agent:    document.getElementById(`v${id}-agent`)?.value||'',
      manifold: document.getElementById(`v${id}-manifold`)?.value||'',
      remarks:  document.getElementById(`v${id}-remarks`)?.value||'',
      lc:       document.getElementById(`v${id}-lc`)?.value||'',
      eta:      document.getElementById(`v${id}-eta`)?.value||'',
      paq:      document.getElementById(`v${id}-paq`)?.value||'no',
      bargeId:  document.getElementById(`v${id}-barge`)?.value||'',
      refuelChk: document.getElementById(`v${id}-refuel-chk`)?.checked||false,
      rfv:  parseFloat(document.getElementById(`v${id}-rfv`)?.value)||0,
      rfm:  parseFloat(document.getElementById(`v${id}-rfm`)?.value)||0,
      rfvr: parseFloat(document.getElementById(`v${id}-rfvr`)?.value)||750,
      rfmr: parseFloat(document.getElementById(`v${id}-rfmr`)?.value)||275,
    }, _cardQtyRangeFields(id), _cardEtaWinFields(id), _cardStsFields(id), _cardLcOnlyFields(id), _cardIdFields(id))); // keys of a newer build first (_newerBuildFields); qtyMin/qtyMax, mgoMin/mgoMax — only for a range; sts — only when ticked; etaWin — only for a time-frame ETA; imo (+ mmsi only when set) — see _cardIdStore
  });

  return { barges, vessels, checklist: _checklist, manualROB: _manualROB, calcParams: _calcParams, lastSched: _lastSched||[], checklistRecords: _checklistRecords||{}, agents: _agents||[], archives: _archives||{}, deliveryLog: _deliveryLog||{}, loadingRecords: _loadingRecords||[], loadingDeals: _loadingDeals||[], loadingConfig: _loadingConfig||{}, bargeTrackingReports: _bargeTrackingReports||[], fuelingInitiated: _fuelingInitiated||{}, bargeReloads: _bargeReloads||[], bargeBlocks: _bargeBlocks||[], lastSchedMeta: _lastSchedMeta||null };
}

/* ── ANTI-ZERO-RESET GUARD (Fix #1) ──────────────────────────────────
   Both VLSFO and MGO ROB must behave IDENTICALLY and must never silently
   collapse to zero on reload/reopen unless the user explicitly set them
   to zero. We only intervene when the INCOMING state is provably STALER
   than what this device already has cached locally (incoming.version <
   local.version) — never when the incoming state is the newer, current
   truth. That way a deliberate "edit ROB down to 0, then reload" always
   wins (incoming version is newest), while a corrupted/incomplete/older
   payload that would wipe a barge's ROB back to 0 gets caught and the
   last good local value is kept instead. Applied identically to vrob
   and mrob — neither grade is special-cased — so they can't drift apart. */
function _guardAgainstZeroROBReset(incomingBarges, incomingVersion) {
  if (!incomingBarges || !incomingBarges.length) return incomingBarges;
  let localState = null;
  try {
    const raw = localStorage.getItem(LS_STATE_KEY);
    if (raw) localState = JSON.parse(raw);
  } catch(e) { return incomingBarges; }
  if (!localState || !localState.barges || !localState.barges.length) return incomingBarges;

  // Only guard if the incoming payload is older (or has no version info at
  // all to prove it's current) than the local cache — a genuinely newer
  // incoming state (e.g. the user just zeroed it out and saved) must win.
  const localVersion = localState.version || 0;
  const incomingIsOlderOrUnknown = !incomingVersion || incomingVersion < localVersion;
  if (!incomingIsOlderOrUnknown) return incomingBarges;

  return incomingBarges.map(function(b) {
    const localMatch = localState.barges.find(function(lb) {
      return String(lb.id) === String(b.id) || lb.name === b.name;
    });
    if (!localMatch) return b;

    const fixed = Object.assign({}, b);
    ['vrob', 'mrob'].forEach(function(field) {
      const incomingVal = parseFloat(b[field]) || 0;
      const localVal     = parseFloat(localMatch[field]) || 0;
      if (incomingVal === 0 && localVal > 0) {
        fixed[field] = localVal;
        fixed._robGuardApplied = true;
      }
    });
    return fixed;
  });
}

function applyState(state, trusted) {
  if (!state) return;

  // The colours on screen now, by barge id + name: a state without a colour for a barge (saved
  // by an older build, which doesn't know colours) must not reset what was picked here.
  const prevBargeColours = new Map();
  (_barges || []).forEach(function(b) {
    const k = (document.getElementById('b' + b.id + '-color') || {}).value;
    if (_bargeKeyOk(k)) prevBargeColours.set(String(b.id) + '|' + String((document.getElementById('b' + b.id + '-name') || {}).value || '').trim(), k);
  });

  // Clear current UI
  document.getElementById('vc').innerHTML = '';
  document.getElementById('barge-list').innerHTML = '';
  vc = 0; bc = 0; _barges = [];
  Object.values(_lcPickers).forEach(p => { try { p.destroy(); } catch(e) {} });
  Object.values(_etaPickers).forEach(p => { try { p.destroy(); } catch(e) {} });
  Object.keys(_lcPickers).forEach(k => delete _lcPickers[k]);
  Object.keys(_etaPickers).forEach(k => delete _etaPickers[k]);

  // Restore barges
  if (state.barges && state.barges.length) {
    // (A merge's version is the remote row's, older than this device's last save: the
    // guard would put back the stock of a barge a supply in the merge just emptied.)
    const guardedBarges = trusted ? state.barges : _guardAgainstZeroROBReset(state.barges, state.version);
    const keptColour = function(b) { return !_bargeKeyOk(b && b.color) ? prevBargeColours.get(String(b && b.id) + '|' + String((b && b.name) || '').trim()) : undefined; };
    _bargeColorReserve = new Set(guardedBarges.map(function(b) { return _bargeKeyOk(b && b.color) ? b.color : keptColour(b); }).filter(_bargeKeyOk)); // defaults avoid colours the state already assigns
    try {
    guardedBarges.forEach(b => {
      // Backward compat: old saves had single 'buf' field
      if (b.buf !== undefined && b.vbuf === undefined) { b.vbuf = b.buf; b.mbuf = Math.round(b.buf * 0.3); }
      const kc = keptColour(b);
      addBarge(kc ? Object.assign({}, b, { color: kc }) : b);
    });
    } finally { _bargeColorReserve = null; }
    if (guardedBarges.some(function(b){ return b._robGuardApplied; })) {
      console.warn('ABPS: prevented a zero-ROB reset on reload for one or more barges — restored from local cache instead.');
    }
  }
  // else: state.barges is genuinely empty (e.g. after Clear All Data) —
  // leave it empty rather than silently re-adding a default barge. An
  // intentionally blank workspace should stay blank until the operator
  // adds their own barge.

  // Restore vessels
  if (state.vessels && state.vessels.length) {
    state.vessels.forEach(v => addVessel(v));
  }

  // Restore checklist
  if (state.checklist)         _checklist         = state.checklist;
  if (state.bakedSupplyIds) {
    // Merge rather than overwrite — never forget a previously-baked id, even
    // if this particular incoming state predates a more recent local bake.
    Object.keys(state.bakedSupplyIds).forEach(function(bid) {
      const incoming = state.bakedSupplyIds[bid] || [];
      const existing = _bakedSupplyIds[bid] || [];
      _bakedSupplyIds[bid] = Array.from(new Set(existing.concat(incoming)));
    });
  }
  if (state.manualROB) {
    // Adopt as-is. Overrides used to be stripped here for any barge that had
    // EVER been baked — which deleted every override made after the first
    // bake. saveSharedState() strips exactly the keys it folds into the
    // opening, in the same write, so nothing stale can be left behind.
    _manualROB = state.manualROB;
  }
  // Barge reload events (dated, merged by id) — authoritative list.
  if (Array.isArray(state.bargeReloads)) _bargeReloads = state.bargeReloads.slice();
  // Unavailable blocks — authoritative like reloads, so a deletion reaches every device.
  if (Array.isArray(state.bargeBlocks)) _bargeBlocks = state.bargeBlocks.filter(function(b) { return b && b.id; }).map(function(b) { return Object.assign({}, b); });
  if (state.calcParams)      { _calcParams        = state.calcParams; renderCalcParamsView(); }
  // Restore only ACTIVE (non-completed) checklist records.
  // Completed records live in _savedSupplies — merging them here was the root cause
  // of ever-growing duplicate rows across sessions, syncs, and navigation.
  // Strategy: clear current active records, then load remote active records,
  // but KEEP any locally-locked records that the remote doesn't know about yet.
  if (state.checklistRecords) {
    // Preserve local records that are locked but not in remote (locally completed, not yet synced)
    const localLocked = {};
    Object.entries(_checklistRecords).forEach(function([uid, rec]) {
      if (rec.lockedAt) localLocked[uid] = rec;
    });
    // Start fresh with only active (non-locked) remote records
    _checklistRecords = {};
    Object.entries(state.checklistRecords).forEach(function([uid, remote]) {
      if (!remote.lockedAt && remote.state !== 'completed') {
        _checklistRecords[uid] = remote;
      }
    });
    // Re-apply any locally-locked records that remote didn't include
    Object.entries(localLocked).forEach(function([uid, rec]) {
      if (!_checklistRecords[uid]) _checklistRecords[uid] = rec;
    });
  } else {
    // No checklistRecords in state — clear active drafts but keep any local locked records
    const keep = {};
    Object.entries(_checklistRecords).forEach(function([uid, rec]) {
      if (rec.lockedAt) keep[uid] = rec;
    });
    _checklistRecords = keep;
  }
  // Restore / merge Archives — additive union, same reasoning as Agent
  // Directory above: an archived month should never disappear just because
  // a different device's state doesn't happen to know about it yet.
  if (state.archives && typeof _mergeArchives === 'function') {
    _mergeArchives(state.archives);
  }

  // Restore / merge Agent Directory — additive union so an agency added on
  // any device, at any point, is never lost when a newer/older state is
  // pulled or the app is rebuilt/redeployed. See _mergeAgents() below.
  if (state.agents && state.agents.length) {
    _mergeAgents(state.agents);
  }

  // Restore / merge Delivery Log — same additive philosophy as Archives and
  // Agents: entries are only ever added, never dropped, on a pull.
  if (state.deliveryLog && typeof _mergeDeliveryLog === 'function') {
    _mergeDeliveryLog(state.deliveryLog);
  }

  // Restore Loading records — merge by id so entries added on another
  // device/tab aren't lost, and a locally-edited record (newer updatedAt)
  // isn't clobbered by an older remote copy of the same id.
  if (state.loadingRecords && state.loadingRecords.length) {
    const localById = {};
    (_loadingRecords || []).forEach(function(r) { localById[r.id] = r; });
    state.loadingRecords.forEach(function(remote) {
      const local = localById[remote.id];
      // Strictly newer wins; on a tie keep the local copy (same rule as the
      // sync merge). Mark Done / Undo now bump updatedAt too.
      if (!local || (remote.updatedAt || 0) > (local.updatedAt || 0)) {
        localById[remote.id] = remote;
      }
    });
    _loadingRecords = Object.values(localById);
  }
  // Loading deals: the same merge by id (newer updatedAt wins, tie → local).
  if (state.loadingDeals && state.loadingDeals.length) {
    const dealsById = {};
    (_loadingDeals || []).forEach(function(d) { dealsById[d.id] = d; });
    state.loadingDeals.forEach(function(remote) {
      const local = dealsById[remote.id];
      if (!local || (remote.updatedAt || 0) > (local.updatedAt || 0)) dealsById[remote.id] = remote;
    });
    _loadingDeals = Object.values(dealsById);
  }
  if (state.loadingConfig) _loadingConfig = Object.assign({}, _loadingConfig, state.loadingConfig);

  // Restore Barge Tracking Reports — adopt the incoming list as
  // authoritative, unlike the union-merge used for Loading records above.
  // Reports are only uploaded/deleted by operators, rarely, so there's no
  // real concurrent-edit race to protect against here — and unlike a
  // union merge, this lets an operator's deletion actually reach every
  // other device instead of the report staying stuck in everyone else's
  // list forever (a union merge can only ever add, never remove).
  // After merging, check whether any of them are new to THIS browser and,
  // if so, surface the cross-user alert banner.
  if (state.bargeTrackingReports) {
    _bargeTrackingReports = state.bargeTrackingReports.slice();
  }
  if (typeof _checkNewTrackingReportAlerts === 'function') _checkNewTrackingReportAlerts();
  if (document.getElementById('page-bargetracking')?.classList.contains('active') && typeof renderBargeTrackingReports === 'function') {
    renderBargeTrackingReports();
  }

  // Restore manually-confirmed Fueling Status — union merge (never drop a
  // key), same reasoning as Loading records: two operators could each
  // initiate a different vessel around the same time before either has
  // pulled the other's change, and this is purely additive (a vessel never
  // gets "un-initiated"), so a plain union is both safe and sufficient —
  // no need for the authoritative-replace treatment Tracking Reports needed
  // for deletions.
  if (state.fuelingInitiated) {
    _fuelingInitiated = Object.assign({}, _fuelingInitiated || {}, state.fuelingInitiated);
  }
  if (typeof renderDashFuelingStatus === 'function' && document.getElementById('page-dashboard')?.classList.contains('active')) {
    renderDashFuelingStatus();
  }

  if (state.lastSched && state.lastSched.length) {
    // Restore dates (serialised as strings) back to Date objects.
    // item.lc (laycan) is a NESTED object with its own .from/.to dates —
    // missing this caused fmtLC() to crash with "f.getMonth is not a
    // function" on every reload, which stopped init() partway through and
    // looked like saved data (including barge ROB) had been lost, even
    // though it was actually loaded correctly into memory just before the
    // crash. Also guard refuelSlot's nested dates for the same reason.
    _lastSched = state.lastSched.map(function(item) {
      const restored = Object.assign({}, item);
      if (restored.eta        && !(restored.eta        instanceof Date)) restored.eta        = new Date(restored.eta);
      if (restored.bargeStart && !(restored.bargeStart instanceof Date)) restored.bargeStart = new Date(restored.bargeStart);
      if (restored.etc        && !(restored.etc        instanceof Date)) restored.etc        = new Date(restored.etc);
      if (restored.lc && typeof restored.lc === 'object') {
        restored.lc = Object.assign({}, restored.lc);
        if (restored.lc.from && !(restored.lc.from instanceof Date)) restored.lc.from = new Date(restored.lc.from);
        if (restored.lc.to   && !(restored.lc.to   instanceof Date)) restored.lc.to   = new Date(restored.lc.to);
      }
      if (restored.refuelSlot && typeof restored.refuelSlot === 'object') {
        restored.refuelSlot = Object.assign({}, restored.refuelSlot);
        if (restored.refuelSlot.rfStart && !(restored.refuelSlot.rfStart instanceof Date)) restored.refuelSlot.rfStart = new Date(restored.refuelSlot.rfStart);
        if (restored.refuelSlot.rfEnd   && !(restored.refuelSlot.rfEnd   instanceof Date)) restored.refuelSlot.rfEnd   = new Date(restored.refuelSlot.rfEnd);
      }
      return restored;
    });
  } else if (Array.isArray(state.lastSched)) {
    // An explicitly empty schedule (e.g. after Clear All Data) must clear
    // ours too — otherwise the next save pushes the old one back.
    _lastSched = [];
  }
  // Generation stamp travels with the schedule it describes (absent on
  // payloads saved before it existed → unknown, never guessed).
  if (Array.isArray(state.lastSched)) _lastSchedMeta = _isPlainObj(state.lastSchedMeta) ? state.lastSchedMeta : null;

  // Keep the ROB engine's barge config in step with the barges just
  // restored (opening ROB / names can change on another device).
  if (_bargeConfig && _bargeConfig.length && typeof getBarges === 'function') {
    const prevCfg = _bargeConfig;
    _bargeConfig = getBarges().map(function(nb) {
      const old = prevCfg.find(function(p) { return String(p.id) === String(nb.id); }) || {};
      return Object.assign({}, old, nb);
    });
  }
  // The cards are new: anything already drawn for a nomination follows its tick.
  try { _repaintSts(); } catch (e) {}
}

async function forcePush() {
  // saveSharedState() returns false when a cloud sync is configured but the
  // write failed — in that case it has already set an 'error' status and
  // shown the warning banner, so don't stomp on that with a false "Pushed"
  // success message (that previously masked real push failures from the
  // operator, who'd otherwise have no way to know their team never got it).
  await _waitForSaveIdle();
  _forcePushOnce = true;
  const synced = await saveSharedState();
  if (synced) {
    setSyncStatus('ok', `Pushed your config at ${new Date().toLocaleTimeString()}`);
  }
}

async function forcePull() {
  setSyncStatus('syncing', 'Pulling latest from shared workspace…');
  // Force a re-apply of the current cloud copy (merging any local edits) —
  // no longer by zeroing _lastKnownVersion, which the next save's
  // compare-and-swap depends on.
  const changed = await loadSharedState(false, true);
  await loadSharedRecords(true);
  // Re-render every dependent panel (checklist, Live ROB dashboard, saved
  // records, KPIs, alerts, calendar) so pulled data shows up immediately
  // instead of only taking effect after the next unrelated re-render.
  refreshAllModules();
  if (!changed) setSyncStatus('ok', `Already up to date — ${new Date().toLocaleTimeString()}`);
}


