/* ═══════════════════════════════════════════════════════════════
   LIVE ROB ENGINE
   
   Opening ROB  = barge config value (user-entered at schedule start)
   After each SAVED + COMPLETED supply → deduct actual quantity
   Manual ROB overrides → stored with full audit trail
   Availability Checker uses live ROB only, not nomination-based
═══════════════════════════════════════════════════════════════ */

const ROB_AUDIT_KEY = 'abps_rob_audit_v1';
let _robAuditLog = [];   // [{bargeId, bargeName, field, oldVal, newVal, reason, editedAt, editedBy}]
let _manualROB   = {};   // {bargeId: {v: number|null, m: number|null}}  null = use computed

// Which completed-supply record ids have already been folded into each
// barge's saved Opening ROB (vrob/mrob). saveSharedState() bakes the current
// Live ROB back into Opening ROB so the barge-config screen always shows the
// true current figure — but computeLiveROB() always re-walks the FULL,
// never-trimmed _savedSupplies history. Without this tracker, every bake+
// reload cycle would deduct the same completed supplies a second time,
// silently drifting ROB downward with no new completion or manual edit
// having happened. Recording, per barge, which record ids are already
// reflected in the baked opening lets computeLiveROB skip them next time —
// so ROB only ever moves for a genuinely NEW completed supply or an explicit
// manual override, exactly once each. {bargeId: [recordId, ...]}
let _bakedSupplyIds = {};

// When barge bid's ROB was last measured — Update ROB, a new opening typed
// in Save Parameters, or the barge removed (one added back with its id is a
// fresh figure): _manualROB['<bid>_measured'] = {at}. A supply baked into
// the opening before then is already in that figure, so correcting it later
// moves nothing (_correctBakedSupply). It is not an override: computeLiveROB
// and the bake leave the key alone.
function _robMeasured(bid, grades) {
  if (!_manualROB) _manualROB = {};
  const m = Object.assign({}, _manualROB[bid + '_measured'] || {}), now = Date.now();
  (grades || ['v', 'm']).forEach(function(g) { m[g] = now; }); // per grade: {v, m} (an older {at} covers both)
  _manualROB[bid + '_measured'] = m;
}
// When grade g ('v' | 'm') of barge bid was last measured (ms), or -1.
function _robMeasuredAt(bid, g) {
  const m = (_manualROB || {})[bid + '_measured'];
  if (!m) return -1;
  return Math.max(parseFloat(m.at) || -1, parseFloat(m[g]) || -1);
}
// A real manual override of barge bid (not the measured-time marker).
function _hasManualOverride(bid) {
  return Object.keys(_manualROB || {}).some(function(k) { return k.startsWith(bid + '_') && k !== bid + '_measured'; });
}

// Barge reloads as dated events: [{id, bargeId, v, m, at, by, note}].
// computeLiveROB adds them chronologically among the supplies (so supplies
// AFTER a reload still deduct), and baking folds them in like supplies —
// their ids are recorded in _bakedSupplyIds alongside the supply ids.
let _bargeReloads = [];

// One rule for "is this a single-barge fleet" — used by both the bake in
// saveSharedState() and computeLiveROB(), so they always agree on whether
// an unassigned record belongs to the (only) barge.
function _isSingleBargeFleet() {
  const n = (_barges && _barges.length) ? _barges.length : ((_bargeConfig && _bargeConfig.length) || 0);
  return n === 1;
}

/* ─── Load / Save audit log ─── */
async function loadROBAudit() {
  try {
    let raw = null;
    if (_hasSharedStorage) {
      try { const r = await window.storage.get(ROB_AUDIT_KEY, true); raw = r ? r.value : null; } catch(e) {}
    }
    if (!raw) raw = localStorage.getItem(ROB_AUDIT_KEY);
    if (raw) {
      // The shared (cloud) log may already have been restored by
      // applyState() — union with this device's cache instead of
      // overwriting it, so entries made on other devices aren't dropped.
      const cached = JSON.parse(raw) || [];
      const have = new Set((_robAuditLog || []).map(function(e) { return JSON.stringify(e); }));
      _robAuditLog = (_robAuditLog || []).concat(cached.filter(function(e) { return !have.has(JSON.stringify(e)); }));
    }
  } catch(e) { _robAuditLog = _robAuditLog || []; }
}

async function saveROBAudit() {
  const json = JSON.stringify(_robAuditLog);
  try { localStorage.setItem(ROB_AUDIT_KEY, json); } catch(e) {}
  if (_hasSharedStorage) {
    try { await window.storage.set(ROB_AUDIT_KEY, json, true); } catch(e) {}
  }
}

/* ─── Compute LIVE ROB per barge ─── */
/*
  Algorithm:
  1. Start from Opening ROB (barge config input).
  2. Walk through _savedSupplies sorted by supplyDate ascending.
  3. For each saved record that is 'supplied=true' and matches this barge:
     subtract actual quantity delivered.
  4. Apply manual override if set (replaces computed value from that point).
  Returns: { v: number, m: number, history: [{...}] }
*/
function computeLiveROB(bargeId, bargeName, openingV, openingM, upToDate) {
  // Single barge setup: deduct ALL saved records with actuals.
  // Multi-barge: match by barge name only. An unassigned (blank barge)
  // record in a multi-barge fleet is excluded from every barge's ROB until
  // it's tagged with the barge it belongs to (guessing "the first barge"
  // silently corrupted that barge's ROB).
  const isOnlyBarge = _isSingleBargeFleet();
  const bakedIds = new Set((_bakedSupplyIds && _bakedSupplyIds[bargeId]) || []);

  const completed = (_savedSupplies || [])
    .filter(function(r) {
      const aV = parseFloat(r.vlsfoAct)||0;
      const aM = parseFloat(r.mgoAct)||0;
      if (aV === 0 && aM === 0) return false;
      // Already folded into this barge's saved Opening ROB — deducting it
      // again here would double-count the same supply on every reload.
      if (r.id !== undefined && r.id !== null && bakedIds.has(r.id)) return false;
      var rb = (r.barge||'').trim();
      var bargeMatch = rb === '' ? isOnlyBarge : (rb === bargeName);
      if (!bargeMatch) return false;
      if (upToDate && r.supplyDate) {
        const d = new Date(r.supplyDate);
        if (!isNaN(d.getTime()) && d > upToDate) return false;
      }
      return true;
    });
  const reloads = (_bargeReloads || []).filter(function(rl) {
    if (String(rl.bargeId) !== String(bargeId) || bakedIds.has(rl.id)) return false;
    return !(upToDate && rl.at && new Date(rl.at) > upToDate);
  });
  // One chronological event list: supplies (by supply date) and reloads (by
  // when they happened).
  const tOf = function(d) { const t = d ? new Date(d).getTime() : 0; return isNaN(t) ? 0 : t; };
  const events = completed.map(function(r) { return { kind: 'supply', id: r.id, t: tOf(r.supplyDate), r: r }; })
    .concat(reloads.map(function(rl) { return { kind: 'reload', id: rl.id, t: tOf(rl.at), rl: rl }; }))
    .sort(function(a, b) { return a.t - b.t; });

  var bCfg=(_bargeConfig||[]).find(function(b){return b.id==bargeId;});
  // receivedV/M: legacy in-memory reload counter (pre dated reload events)
  var receivedV=(bCfg&&bCfg.receivedV)?parseFloat(bCfg.receivedV)||0:0;
  var receivedM=(bCfg&&bCfg.receivedM)?parseFloat(bCfg.receivedM)||0:0;
  let rv=openingV+receivedV, rm=openingM+receivedM;
  const history = [{ label: 'Opening ROB', v: rv, m: rm, source: 'opening' }];

  const _mrob = _manualROB || {};
  const took = {};

  // Check if there's a manual override before any supplies
  const manBefore = _mrob[bargeId + '_pre'];
  if (manBefore) {
    if (manBefore.v !== null && manBefore.v !== undefined) { rv = manBefore.v; }
    if (manBefore.m !== null && manBefore.m !== undefined) { rm = manBefore.m; }
    history.push({ label: 'Manual Override (pre-supply)', v: rv, m: rm, source: 'manual' });
  }

  const applyEvent = function(ev) {
    if (ev.kind === 'reload') {
      const addV = parseFloat(ev.rl.v) || 0, addM = parseFloat(ev.rl.m) || 0;
      const rd = ev.rl.at ? new Date(ev.rl.at) : null;
      if (ev.rl.kind === 'correction') {
        // A correction of a baked supply (_correctBakedSupply). Like a supply
        // it stops at 0. It is not a reload.
        rv = Math.max(0, rv + addV); rm = Math.max(0, rm + addM);
        const sgn = function(x) { return (x < 0 ? '−' : '+') + Math.abs(x).toLocaleString(); };
        history.push({ label: 'Correction (' + sgn(addV) + ' VLSFO / ' + sgn(addM) + ' MGO)' + (ev.rl.note ? ' — ' + ev.rl.note : ''),
          dateStr: rd && !isNaN(rd) ? fmt24(rd) : '', v: rv, m: rm, source: 'correction', reloadId: ev.rl.id });
        return;
      }
      rv = rv + addV; rm = rm + addM;
      history.push({ label: 'Reload (+' + addV.toLocaleString() + ' VLSFO / +' + addM.toLocaleString() + ' MGO)' + (ev.rl.note ? ' — ' + ev.rl.note : ''),
        dateStr: rd && !isNaN(rd) ? fmt24(rd) : '', v: rv, m: rm, source: 'reload', reloadId: ev.rl.id });
      return;
    }
    const r = ev.r;
    const actV = parseFloat(r.vlsfoAct) || 0;
    const actM = parseFloat(r.mgoAct)   || 0;
    const wasV = rv, wasM = rm;
    rv = Math.max(0, rv - actV);
    rm = Math.max(0, rm - actM);
    if (r.id !== undefined && r.id !== null) took[String(r.id)] = [wasV - rv, wasM - rm]; // what this supply really took off (the bake keeps it)
    history.push({
      label:     'Supplied to ' + r.vessel,
      dateStr:   r.dateStr,
      supDate:   new Date(r.supplyDate),
      vlsfoAct:  actV,
      mgoAct:    actM,
      v:         rv,
      m:         rm,
      source:    'supply',
      recordId:  r.id
    });
    const manAt = _mrob[bargeId + '_after_' + r.id];
    if (manAt) {
      if (manAt.v !== null && manAt.v !== undefined) { rv = manAt.v; }
      if (manAt.m !== null && manAt.m !== undefined) { rm = manAt.m; }
      history.push({ label: 'Manual Override (after ' + r.vessel + ')', v: rv, m: rm, source: 'manual' });
    }
  };
  const applyFinal = function(manFinal) {
    if (manFinal.v !== null && manFinal.v !== undefined) { rv = manFinal.v; }
    if (manFinal.m !== null && manFinal.m !== undefined) { rm = manFinal.m; }
    history.push({ label: 'Manual Override (current)', v: rv, m: rm, source: 'manual' });
  };

  // "Current ROB" override. When it records which events it already
  // accounted for (atIds), it's applied right after those, and anything
  // newer (a later supply or reload) still moves ROB from there — instead
  // of the override silently hiding every supply made after it. Legacy
  // overrides without atIds keep their old meaning (applied last).
  const manFinal = _mrob[bargeId + '_final'];
  if (manFinal && Array.isArray(manFinal.atIds)) {
    const known = new Set(manFinal.atIds);
    const isKnown = function(ev) { return ev.id === undefined || ev.id === null || known.has(ev.id); };
    events.filter(isKnown).forEach(applyEvent);
    applyFinal(manFinal);
    events.filter(function(ev) { return !isKnown(ev); }).forEach(applyEvent);
  } else {
    events.forEach(applyEvent);
    if (manFinal) applyFinal(manFinal);
  }

  return { v: rv, m: rm, history: history, completedCount: completed.length, took: took,
           eventIds: events.map(function(ev) { return ev.id; }).filter(function(id) { return id !== undefined && id !== null; }) };
}

// Event ids a new "current ROB" override for this barge accounts for.
function _robOverrideAtIds(bargeId) {
  const b = (_bargeConfig || []).find(function(x) { return x.id == bargeId; });
  if (!b) return [];
  return computeLiveROB(b.id, b.name, b.vrob, b.mrob, null).eventIds;
}

// A saved supply already folded into a barge's opening (_bakedSupplyIds) is
// skipped by computeLiveROB, so editing its quantity or barge, or deleting it,
// never moved live ROB (and Delete + re-save deducted the delivery twice).
// The difference is recorded as a 'correction' event in _bargeReloads — synced
// and merged by id like a reload, and baked into the opening at the next save.
// It is measured against what the record really took off that barge
// (record.robTook, stamped by the bake: a supply larger than what the barge
// held took only what there was); fuel given back first goes to later supplies
// the empty barge could not give in full. One event per record step, with an
// id from the record and its step number: two devices making the same change
// before they sync make ONE event. A supply baked before the barge's ROB was
// measured (Update ROB, a new opening, the barge removed — '<id>_measured')
// is already in that figure: nothing moves. A record keeps its barge unless
// it is deleted, zeroed or now names another barge of the fleet. Call after
// the change: before = the record as it was, after = as it is now (null =
// removed, `removed` says how). Archiving or clearing records never calls
// this — that fuel was supplied.
function _correctBakedSupply(before, after, removed) {
  if (!before || before.id === undefined || before.id === null) return;
  const id = String(before.id);
  // Another copy with the same id still stands for this delivery in the opening.
  if (!after && (_savedSupplies || []).some(function(r) { return r && String(r.id) === id; })) return;
  const onlyBarge = _isSingleBargeFleet(), fleet = getBarges();
  const num = function(x) { return parseFloat(x) || 0; };
  const acts = function(r) { return r ? [num(r.vlsfoAct), num(r.mgoAct)] : [0, 0]; };
  const textOf = function(r) { return String((r && r.barge) || '').trim(); };
  const names = function(r, b) { const rb = textOf(r); return rb === '' ? onlyBarge : rb === b.name; };
  const namesOther = function(r, b) { const rb = textOf(r); return rb !== '' && fleet.some(function(o) { return o !== b && o.name === rb; }); };
  const bakedOn = function(b, rid) { return ((_bakedSupplyIds && _bakedSupplyIds[b.id]) || []).map(String).indexOf(rid) !== -1; };
  const tOf = function(r) { const t = r && r.supplyDate ? new Date(r.supplyDate).getTime() : NaN; return isNaN(t) ? 0 : t; };
  const stampOf = function(r, b) { const st = r && r.robTook && r.robTook[b.id]; return Array.isArray(st) ? st : null; };
  const what = !after ? removed : textOf(after) !== textOf(before) ? 'moved to ' + (textOf(after) || 'no barge') : 'edited';
  const ts = new Date().toISOString();
  let any = false;
  fleet.forEach(function(b) {
    if (!bakedOn(b, id)) return;
    const st = stampOf(before, b), qb = acts(before);
    // A stamp an older build did not keep up: it changed the quantity, or
    // moved the record off this barge, and wrote its own correction event.
    const stale = st && ((st.length >= 6 && (num(st[4]) !== qb[0] || num(st[5]) !== qb[1])) || (namesOther(before, b) && (num(st[0]) || num(st[1]))));
    const fresh = st && !stale;
    let was, bakedAt = st ? num(st[2]) : 0, txt = fresh && st[3] != null ? String(st[3]) : textOf(before), n = st ? num(st[6]) : 0;
    if (fresh) was = [num(st[0]), num(st[1])];
    else {
      // What the opening holds for it as it is: the record as it was — when it
      // named this barge, or no other barge (by name or by having baked it)
      // could be the one it was taken from.
      const other = fleet.some(function(o) { return o !== b && (bakedOn(o, id) || namesOther(before, b) && o.name === textOf(before)); });
      if (!names(before, b) && other) { if (!st) return; was = [0, 0]; }
      else was = qb;
    }
    // On this barge: a record naming it is; one naming another barge of the
    // fleet is not; one naming no barge of the fleet (a name not added yet, a
    // barge renamed or removed since) stays where it was before.
    const beforeOn = names(before, b) ? true : namesOther(before, b) ? false
      : !st ? true : !!(num(st[0]) || num(st[1]) || String(st[3]) === textOf(before));
    const afterOn = !after ? false : names(after, b) ? true : namesOther(after, b) ? false : beforeOn;
    const now = afterOn ? acts(after) : [0, 0];
    // A supply that ran the barge empty took only what there was (took < its
    // quantity): taking "more" of it, while it stays on the barge, takes nothing more.
    if (fresh && beforeOn && afterOn) [0, 1].forEach(function(g) { if (num(st[g]) < num(st[4 + g])) now[g] = Math.min(now[g], num(st[g])); });
    const req = [was[0] - now[0], was[1] - now[1]];
    const setStamp = function(r, tv, tm, step) {
      r.robTook = Object.assign({}, r.robTook || {});
      r.robTook[b.id] = [Math.round(tv * 1000) / 1000, Math.round(tm * 1000) / 1000, bakedAt, txt, acts(r)[0], acts(r)[1], step];
    };
    if (!req[0] && !req[1]) { if (after) setStamp(after, now[0], now[1], n); return; } // the quantity it has now, so the next edit starts from it
    const q = function(g, i) { return g + ' ' + was[i].toLocaleString() + ' → ' + now[i].toLocaleString() + ' MT'; };
    const note = (before.vessel || 'Vessel') + ' supply ' + what + ': ' + [req[0] ? q('VLSFO', 0) : '', req[1] ? q('MGO', 1) : ''].filter(Boolean).join(', ');
    // A grade measured after the bake (Update ROB, a new opening, the barge
    // removed — '<id>_measured', or a "current ROB" figure standing now) already
    // holds this supply as it really was: that grade stays.
    const mr = _manualROB || {}, fin = mr[b.id + '_final'] || mr[b.id + '_pre'];
    if (fin && !mr[b.id + '_measured']) _robMeasured(b.id);
    const measAt = [_robMeasuredAt(b.id, 'v'), _robMeasuredAt(b.id, 'm')];
    const absorbed = [!!fin || bakedAt <= measAt[0], !!fin || bakedAt <= measAt[1]];
    const d = [absorbed[0] ? 0 : req[0], absorbed[1] ? 0 : req[1]];
    if (!d[0] && !d[1]) {
      if (after) setStamp(after, now[0], now[1], n);
      const cur = computeLiveROB(b.id, b.name, b.vrob, b.mrob, null), g = req[0] ? ['VLSFO', cur.v] : ['MGO', cur.m];
      if (!_robAuditLog) _robAuditLog = [];
      _robAuditLog.push({ bargeId: b.id, bargeName: b.name, field: g[0] + ' CORRECTION (no change)', oldVal: Math.round(g[1]), newVal: Math.round(g[1]), reason: note + ' — already in the ROB measured after it', editedAt: ts, editedBy: 'Supply correction' });
      any = true;
      return;
    }
    // Fuel given back first goes to later supplies that took less than their
    // quantity (the barge was empty then), oldest first.
    [0, 1].forEach(function(g) {
      if (d[g] <= 0) return;
      (_savedSupplies || []).filter(function(r) {
        if (!r || r === after || String(r.id) === id || !bakedOn(b, String(r.id))) return false;
        const s2 = stampOf(r, b);
        if (!s2 || num(s2[2]) <= measAt[g]) return false;
        if (s2.length >= 6 && (num(s2[4]) !== acts(r)[0] || num(s2[5]) !== acts(r)[1])) return false;
        const later = num(s2[2]) > bakedAt || (num(s2[2]) === bakedAt && tOf(r) > tOf(before));
        return later && !namesOther(r, b);
      }).sort(function(x, y) { return num(stampOf(x, b)[2]) - num(stampOf(y, b)[2]) || tOf(x) - tOf(y); }).forEach(function(r) {
        if (d[g] <= 0) return;
        const s2 = stampOf(r, b), short = acts(r)[g] - num(s2[g]);
        if (short <= 0) return;
        const pay = Math.min(d[g], short);
        d[g] -= pay;
        const nv = s2.slice(); nv[g] = num(s2[g]) + pay;
        r.robTook = Object.assign({}, r.robTook); r.robTook[b.id] = nv;
      });
    });
    let step = n + 1, evId = 'rc_' + b.id + '_' + id + '_' + step;
    while ((_bargeReloads || []).some(function(e) { return e && e.id === evId; })) evId = 'rc_' + b.id + '_' + id + '_' + (++step);
    const robWas = computeLiveROB(b.id, b.name, b.vrob, b.mrob, null);
    if (!Array.isArray(_bargeReloads)) _bargeReloads = [];
    if (d[0] || d[1]) {
      const ev = { id: evId, bargeId: b.id, v: d[0], m: d[1], at: Date.now(), by: ABPS_UID || '', note: note, kind: 'correction', recId: id };
      if (!after) ev.del = 1;
      _bargeReloads.push(ev);
    }
    const robNow = computeLiveROB(b.id, b.name, b.vrob, b.mrob, null);
    // What this record has now taken: `now`, or less when taking more stopped at 0.
    const applied = [robNow.v - robWas.v, robNow.m - robWas.m];
    const took = [0, 1].map(function(g) { return !absorbed[g] && req[g] < 0 ? was[g] - applied[g] : now[g]; });
    if (after) setStamp(after, took[0], took[1], step);
    if (!_robAuditLog) _robAuditLog = [];
    if (Math.round(robWas.v) !== Math.round(robNow.v)) _robAuditLog.push({ bargeId: b.id, bargeName: b.name, field: 'VLSFO CORRECTION', oldVal: Math.round(robWas.v), newVal: Math.round(robNow.v), reason: note, editedAt: ts, editedBy: 'Supply correction' });
    if (Math.round(robWas.m) !== Math.round(robNow.m)) _robAuditLog.push({ bargeId: b.id, bargeName: b.name, field: 'MGO CORRECTION', oldVal: Math.round(robWas.m), newVal: Math.round(robNow.m), reason: note, editedAt: ts, editedBy: 'Supply correction' });
    any = true;
  });
  if (any) {
    try { localStorage.setItem('abps_manual_rob_v1', JSON.stringify(_manualROB || {})); } catch (e) {}
    saveROBAudit();
  }
}

// The bake stamps each record it folds into barge bid's opening with what it
// really took off (took, from computeLiveROB — less than the quantity when the
// barge ran empty): rec.robTook[bid] = [vlsfo, mgo, bakedAt, barge text,
// quantity vlsfo, quantity mgo, correction step]. A record a "current ROB"
// figure folded in by this bake already accounted for (its atIds; all of
// them for an old figure without atIds) is stamped as baked before it was
// measured (bakedAt 0): correcting it later moves nothing.
function _stampRobTook(bid, prevIds, newIds, took, measured, now) {
  const prev = new Set((prevIds || []).map(String));
  (newIds || []).map(String).forEach(function(id) {
    if (prev.has(id)) return;
    const r = (_savedSupplies || []).find(function(x) { return x && String(x.id) === id; });
    if (!r) return; // a reload
    const q = [parseFloat(r.vlsfoAct) || 0, parseFloat(r.mgoAct) || 0], t = (took && took[id]) || q;
    const inFigure = measured === 'all' || (Array.isArray(measured) && measured.map(String).indexOf(id) !== -1);
    r.robTook = Object.assign({}, r.robTook || {});
    r.robTook[bid] = [Math.round(t[0] * 1000) / 1000, Math.round(t[1] * 1000) / 1000, inFigure ? 0 : now, String(r.barge || '').trim(), q[0], q[1], 0];
  });
}

/* ─── Get Live ROB for all barges ─── */
function getAllLiveROBs() {
  const result = {};
  if (!_bargeConfig || !_bargeConfig.length) return result;
  _bargeConfig.forEach(function(b) {
    const live = computeLiveROB(b.id, b.name, b.vrob, b.mrob, null);

    // Supplied totals = exactly the supplies computeLiveROB deducted from
    // this opening (same barge matching, already-baked ones excluded), so
    // Opening − Supplied (+ reloads / overrides) reconciles with Current ROB.
    // (Counting every unassigned record for every barge, and baked records
    // too, made the totals impossible to reconcile.)
    var directSumV = 0, directSumM = 0, directCount = 0;
    live.history.forEach(function(h) {
      if (h.source !== 'supply') return;
      directSumV += h.vlsfoAct || 0;
      directSumM += h.mgoAct || 0;
      directCount++;
    });

    // liveV/liveM come from computeLiveROB which applies _manualROB _final override
    result[b.id] = {
      bargeName:      b.name,
      bargeId:        b.id,
      openingV:       b.vrob,
      openingM:       b.mrob,
      liveV:          live.v,
      liveM:          live.m,
      totalSuppliedV: directSumV,
      totalSuppliedM: directSumM,
      history:        live.history,
      took:           live.took,
      completedCount: directCount,
      vcap:           b.vcap,
      mcap:           b.mcap,
      vbuf:           b.vbuf,
      mbuf:           b.mbuf,
      vtph:           b.vtph,
      mtph:           b.mtph
    };
  });
  return result;
}

/* ─── Render Live ROB Dashboard ─── */
function renderLiveROBDashboard() {
  const el = document.getElementById('live-rob-dashboard');
  if (!el) return;

  // Try to rebuild _bargeConfig from DOM if empty
  if (!_bargeConfig || !_bargeConfig.length) {
    if (typeof captureCurrentState === 'function') {
      const st = captureCurrentState();
      if (st && st.barges && st.barges.length) {
        _bargeConfig = st.barges;
      }
    }
  }

  if (!_bargeConfig || !_bargeConfig.length) {
    el.innerHTML = '<div style="font-size:13px;color:var(--muted);text-align:center;padding:20px">Add a barge and generate the schedule to see live ROB.</div>';
    return;
  }

  const liveROBs = getAllLiveROBs();
  const robMap = _bargeColorMap();
  let html = '';

  Object.values(liveROBs).forEach(function(rob) {
    const b = _bargeConfig.find(function(x) { return x.name === rob.bargeName; });
    if (!b) return;

    const vPct = rob.vcap > 0 ? Math.min(100, Math.round((rob.liveV / rob.vcap) * 100)) : 0;
    const mPct = rob.mcap > 0 ? Math.min(100, Math.round((rob.liveM / rob.mcap) * 100)) : 0;
    const vCol = vPct < 15 ? 'var(--red)' : vPct < 30 ? 'var(--amber)' : 'var(--fuel-v)';
    const mCol = mPct < 15 ? 'var(--red)' : mPct < 30 ? 'var(--amber)' : 'var(--fuel-m)';
    const hasManual = _hasManualOverride(b.id);

    // Ullage and Refill Time calculations
    const vUllage = Math.max(0, rob.vcap - rob.liveV);
    const mUllage = Math.max(0, rob.mcap - rob.liveM);
    const vRefillHrs = (b.vrfr||750) > 0 ? vUllage / (b.vrfr||750) : 0;
    const mRefillHrs = (b.mrfr||275) > 0 ? mUllage / (b.mrfr||275) : 0;

    const robBc = _bargeStyle(rob.bargeName, robMap);
    html += '<div class="rob-card"' + (robBc ? ' data-bc="1" data-bgn="' + esc(String(rob.bargeName).trim()) + '"' : '') + ' style="' + robBc + (robBc ? ';' : '') + 'background:var(--surface);border:none;border-radius:var(--radius);padding:1.25rem;margin-bottom:1rem;box-shadow:var(--sh-sm);position:relative;overflow:hidden">' +
      '<div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--azure),var(--teal))"></div>' +

      // Header
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--border2);flex-wrap:wrap;gap:8px">' +
      '<div style="display:flex;align-items:center;gap:10px">' +
      '<div style="width:10px;height:10px;border-radius:50%;background:' + (robBc ? 'var(--bc)' : 'linear-gradient(135deg,var(--azure),var(--teal))') + '"></div>' +
      '<div style="font-size:14px;font-weight:700;color:var(--ink);font-family:DM Sans,sans-serif;display:flex;align-items:center;gap:8px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2a4 4 0 0 1 4 4 4 4 0 0 1-4 4 4 4 0 0 1-4-4 4 4 0 0 1 4-4m0 8v12m-6-6l6 6 6-6"/></svg>' + esc(rob.bargeName) + '</div>' +
      (hasManual ? '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:var(--purple-lt);color:var(--purple);border:1px solid var(--purple-bd)">Manual Override Active</span>' : '') +
      '</div>' +
      '<div style="display:flex;gap:6px">' +
      '<button onclick="openROBEditor(' + esc(JSON.stringify(b.id)) + ')" style="display:inline-flex;align-items:center;gap:5px;padding:6px 12px;background:var(--azure);color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit ROB</button>' +
      '<button onclick="openReloadModal(' + esc(JSON.stringify(b.id)) + ')" style="display:inline-flex;align-items:center;gap:5px;padding:6px 12px;background:var(--green);color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add Reload</button>' +
      '<button onclick="toggleROBHistory(' + esc(JSON.stringify(b.id)) + ')" style="display:inline-flex;align-items:center;gap:5px;padding:6px 12px;background:var(--surface);border:none;box-shadow:var(--sh-sm);border-radius:6px;font-size:11px;cursor:pointer;font-family:DM Sans,sans-serif"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h6v6h-6z"/></svg>History</button>' +
      '</div></div>' +



      // ── ROB Summary Cards ──
      '<div class="rob-fuel-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">' +

        // VLSFO Card
        '<div style="background:linear-gradient(135deg,var(--fuel-v-lt) 0%,var(--surface) 100%);border:1.5px solid var(--azure-bd);border-radius:12px;padding:16px;position:relative;overflow:hidden">' +
          '<div style="position:absolute;top:0;left:0;bottom:0;width:3px;background:linear-gradient(180deg,var(--azure),#0A4FA8)"></div>' +
          '<div style="padding-left:10px">' +
            '<div style="font-size:10px;font-weight:700;color:var(--fuel-v);letter-spacing:.09em;text-transform:uppercase;margin-bottom:10px">VLSFO</div>' +
            // Three values stacked
            '<div class="rob-triplet" style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:10px">' +
              '<div style="text-align:center">' +
                '<div style="font-size:9px;color:var(--sub);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">Opening</div>' +
                '<div style="font-size:18px;font-weight:700;color:var(--ink);font-family:DM Mono,monospace;line-height:1">' + rob.openingV.toLocaleString() + '</div>' +
                '<div style="font-size:9px;color:var(--muted);margin-top:2px">MT</div>' +
              '</div>' +
              '<div style="font-size:18px;color:var(--red);font-weight:300;padding-bottom:14px">&minus;</div>' +
              '<div style="text-align:center">' +
                '<div style="font-size:9px;color:var(--red);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">Supplied</div>' +
                '<div style="font-size:18px;font-weight:700;color:var(--red);font-family:DM Mono,monospace;line-height:1">' + Math.round(rob.totalSuppliedV).toLocaleString() + '</div>' +
                '<div style="font-size:9px;color:var(--muted);margin-top:2px">MT</div>' +
              '</div>' +
              '<div style="font-size:18px;color:var(--sub);font-weight:300;padding-bottom:14px">=</div>' +
              '<div style="text-align:center">' +
                '<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;color:' + vCol + '">Current ROB</div>' +
                '<div style="font-size:26px;font-weight:700;font-family:DM Mono,monospace;line-height:1;color:' + vCol + '">' + Math.round(rob.liveV).toLocaleString() + '</div>' +
                '<div style="font-size:9px;color:var(--muted);margin-top:2px">MT</div>' +
              '</div>' +
            '</div>' +
            // Progress bar
            '<div style="background:var(--surface3);border-radius:99px;height:6px;overflow:hidden">' +
              '<div style="height:100%;border-radius:99px;background:' + vCol + ';width:' + vPct + '%;transition:width .5s ease"></div>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;margin-top:5px">' +
              '<span style="font-size:10px;color:var(--muted)">' + vPct + '% of ' + rob.vcap.toLocaleString() + ' MT cap</span>' +
              '<span style="font-size:10px;font-weight:600;color:' + vCol + '">' + rob.completedCount + ' supply record(s)</span>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // LSMGO Card
        '<div style="background:linear-gradient(135deg,var(--fuel-m-lt) 0%,var(--surface) 100%);border:1.5px solid var(--fuel-m-bd);border-radius:12px;padding:16px;position:relative;overflow:hidden">' +
          '<div style="position:absolute;top:0;left:0;bottom:0;width:3px;background:linear-gradient(180deg,var(--teal),#0A6B61)"></div>' +
          '<div style="padding-left:10px">' +
            '<div style="font-size:10px;font-weight:700;color:var(--fuel-m);letter-spacing:.09em;text-transform:uppercase;margin-bottom:10px">LSMGO</div>' +
            '<div class="rob-triplet" style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:10px">' +
              '<div style="text-align:center">' +
                '<div style="font-size:9px;color:var(--sub);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">Opening</div>' +
                '<div style="font-size:18px;font-weight:700;color:var(--ink);font-family:DM Mono,monospace;line-height:1">' + rob.openingM.toLocaleString() + '</div>' +
                '<div style="font-size:9px;color:var(--muted);margin-top:2px">MT</div>' +
              '</div>' +
              '<div style="font-size:18px;color:var(--red);font-weight:300;padding-bottom:14px">&minus;</div>' +
              '<div style="text-align:center">' +
                '<div style="font-size:9px;color:var(--red);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">Supplied</div>' +
                '<div style="font-size:18px;font-weight:700;color:var(--red);font-family:DM Mono,monospace;line-height:1">' + Math.round(rob.totalSuppliedM).toLocaleString() + '</div>' +
                '<div style="font-size:9px;color:var(--muted);margin-top:2px">MT</div>' +
              '</div>' +
              '<div style="font-size:18px;color:var(--sub);font-weight:300;padding-bottom:14px">=</div>' +
              '<div style="text-align:center">' +
                '<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;color:' + mCol + '">Current ROB</div>' +
                '<div style="font-size:26px;font-weight:700;font-family:DM Mono,monospace;line-height:1;color:' + mCol + '">' + Math.round(rob.liveM).toLocaleString() + '</div>' +
                '<div style="font-size:9px;color:var(--muted);margin-top:2px">MT</div>' +
              '</div>' +
            '</div>' +
            '<div style="background:var(--surface3);border-radius:99px;height:6px;overflow:hidden">' +
              '<div style="height:100%;border-radius:99px;background:' + mCol + ';width:' + mPct + '%;transition:width .5s ease"></div>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;margin-top:5px">' +
              '<span style="font-size:10px;color:var(--muted)">' + mPct + '% of ' + rob.mcap.toLocaleString() + ' MT cap</span>' +
              '<span style="font-size:10px;font-weight:600;color:' + mCol + '">from saved records</span>' +
            '</div>' +
          '</div>' +
        '</div>' +

      '</div>' +



      // Ullage & Refill Time
      '<div style="background:linear-gradient(90deg,var(--amber-lt),var(--surface));border:1.5px solid var(--amber-bd);border-radius:10px;padding:12px 16px;margin-bottom:12px">' +
      '<div style="font-size:10px;font-weight:700;color:var(--amber);letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px">Ullage &amp; Refill Planning</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px">' +
        '<div style="text-align:center;background:var(--surface);border-radius:7px;padding:9px">' +
          '<div style="font-size:9px;font-weight:700;color:var(--amber);letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px">VLSFO Ullage</div>' +
          '<div style="font-size:16px;font-weight:700;color:var(--ink);font-family:DM Mono,monospace">' + vUllage.toLocaleString() + '</div>' +
          '<div style="font-size:10px;color:var(--sub)">MT to fill</div>' +
        '</div>' +
        '<div style="text-align:center;background:var(--surface);border-radius:7px;padding:9px">' +
          '<div style="font-size:9px;font-weight:700;color:var(--amber);letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px">VLSFO Refill Time</div>' +
          '<div style="font-size:16px;font-weight:700;color:var(--ink);font-family:DM Mono,monospace">' + (vUllage > 0 ? durStr(vRefillHrs) : '—') + '</div>' +
          '<div style="font-size:10px;color:var(--sub)">@ ' + (b.vrfr||750) + ' MT/hr</div>' +
        '</div>' +
        '<div style="text-align:center;background:var(--surface);border-radius:7px;padding:9px">' +
          '<div style="font-size:9px;font-weight:700;color:var(--amber);letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px">LSMGO Ullage</div>' +
          '<div style="font-size:16px;font-weight:700;color:var(--ink);font-family:DM Mono,monospace">' + mUllage.toLocaleString() + '</div>' +
          '<div style="font-size:10px;color:var(--sub)">MT to fill</div>' +
        '</div>' +
        '<div style="text-align:center;background:var(--surface);border-radius:7px;padding:9px">' +
          '<div style="font-size:9px;font-weight:700;color:var(--amber);letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px">LSMGO Refill Time</div>' +
          '<div style="font-size:16px;font-weight:700;color:var(--ink);font-family:DM Mono,monospace">' + (mUllage > 0 ? durStr(mRefillHrs) : '—') + '</div>' +
          '<div style="font-size:10px;color:var(--sub)">@ ' + (b.mrfr||275) + ' MT/hr</div>' +
        '</div>' +
      '</div></div>' +

      // Deduction history (collapsible)
      '<div id="rob-history-' + esc(b.id) + '" style="display:none">' +
      '<div style="font-size:10px;font-weight:700;color:var(--sub);letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">ROB Deduction History</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:11.5px">' +
      '<thead><tr style="background:var(--ink-solid)">' +
        '<th style="color:#fff;padding:7px 10px;text-align:left;font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase">Event</th>' +
        '<th style="color:#fff;padding:7px 10px;text-align:left;font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase">Date</th>' +
        '<th style="color:#fff;padding:7px 10px;text-align:right;font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase">VLSFO Deducted</th>' +
        '<th style="color:#fff;padding:7px 10px;text-align:right;font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase">LSMGO Deducted</th>' +
        '<th style="color:#fff;padding:7px 10px;text-align:right;font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase">VLSFO ROB</th>' +
        '<th style="color:#fff;padding:7px 10px;text-align:right;font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase">LSMGO ROB</th>' +
        '<th style="color:#fff;padding:7px 10px;text-align:center;font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase">Source</th>' +
      '</tr></thead><tbody>' +
      rob.history.map(function(h, idx) {
        const srcBg = h.source === 'manual' ? 'var(--purple-lt)' : (h.source === 'opening' || h.source === 'reload') ? 'var(--azure-lt)' : h.source === 'correction' ? 'var(--amber-lt)' : 'var(--green-lt)';
        const srcColor = h.source === 'manual' ? 'var(--purple)' : (h.source === 'opening' || h.source === 'reload') ? 'var(--azure)' : h.source === 'correction' ? 'var(--amber)' : 'var(--green)';
        const srcLabel = h.source === 'manual' ? 'Manual' : h.source === 'opening' ? 'Opening' : h.source === 'reload' ? 'Reload' : h.source === 'correction' ? 'Correction' : 'Supply';
        return '<tr style="border-bottom:1px solid var(--border2);background:' + (idx % 2 === 0 ? 'var(--surface)' : 'var(--surface2)') + '">' +
          '<td style="padding:7px 10px;font-weight:600;color:var(--ink)">' + esc(h.label) + '</td>' +
          '<td style="padding:7px 10px;font-family:DM Mono,monospace;font-size:11px;color:var(--sub)">' + esc(h.dateStr || '—') + '</td>' +
          '<td style="padding:7px 10px;text-align:right;font-family:DM Mono,monospace;font-weight:600;color:' + (h.vlsfoAct > 0 ? 'var(--red)' : 'var(--muted)') + '">' + (h.vlsfoAct > 0 ? '−' + h.vlsfoAct.toLocaleString() + ' MT' : '—') + '</td>' +
          '<td style="padding:7px 10px;text-align:right;font-family:DM Mono,monospace;font-weight:600;color:' + (h.mgoAct > 0 ? 'var(--red)' : 'var(--muted)') + '">' + (h.mgoAct > 0 ? '−' + h.mgoAct.toLocaleString() + ' MT' : '—') + '</td>' +
          '<td style="padding:7px 10px;text-align:right;font-family:DM Mono,monospace;font-weight:600;color:var(--azure)">' + Math.round(h.v).toLocaleString() + ' MT</td>' +
          '<td style="padding:7px 10px;text-align:right;font-family:DM Mono,monospace;font-weight:600;color:var(--teal)">' + Math.round(h.m).toLocaleString() + ' MT</td>' +
          '<td style="padding:7px 10px;text-align:center"><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:' + srcBg + ';color:' + srcColor + '">' + srcLabel + '</span></td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>' +
      '</div>';
  });

  el.innerHTML = html || '<div style="font-size:13px;color:var(--muted);text-align:center;padding:20px">No barge data. Generate schedule first.</div>';

  // Also update the Barge ROB Summary to mirror Live ROB exactly
  renderBargeROBSummaryFromLive(liveROBs);
}

/* ─── Barge ROB Summary — Always mirrors Live ROB ─── */
function renderBargeROBSummaryFromLive(liveROBs) {
  const el = document.getElementById('barge-rob-summary');
  if (!el) return;

  if (!liveROBs || !Object.keys(liveROBs).length) {
    liveROBs = getAllLiveROBs();
  }
  if (!liveROBs || !Object.keys(liveROBs).length) {
    el.innerHTML = '<div style="font-size:13px;color:var(--muted);text-align:center;padding:16px;background:var(--surface);border-radius:var(--radius);box-shadow:var(--sh-in-xs)">Generate the schedule to see ROB Summary.</div>';
    return;
  }

  let html = '<div style="background:linear-gradient(135deg,var(--azure-lt),var(--fuel-v-lt));border:1.5px solid var(--azure-bd);border-radius:12px;padding:14px 16px;margin-bottom:6px">' +
    '<div style="font-size:10px;font-weight:700;color:var(--azure);letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px;display:flex;align-items:center;gap:8px">' +
    '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--azure);animation:pulse 2s infinite"></span>' +
    'Live Barge ROB Summary — Click "Update ROB" to override' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">';

  Object.values(liveROBs).forEach(function(rob) {
    const b = _bargeConfig.find(function(x) { return x.name === rob.bargeName || x.id == rob.bargeId; });
    if (!b) return;

    const vPct = rob.vcap > 0 ? Math.min(100, Math.round((rob.liveV / rob.vcap) * 100)) : 0;
    const mPct = rob.mcap > 0 ? Math.min(100, Math.round((rob.liveM / rob.mcap) * 100)) : 0;
    const vCol = vPct < 15 ? 'var(--red)' : vPct < 30 ? 'var(--amber)' : 'var(--fuel-v)';
    const mCol = mPct < 15 ? 'var(--red)' : mPct < 30 ? 'var(--amber)' : 'var(--fuel-m)';
    const hasManual = _hasManualOverride(b.id);

    // Exact barge-name match — a substring match counted "Barge 10"'s
    // supplies under "Barge 1" too.
    const _normBN = function(x) { return String(x || '').trim().toLowerCase(); };
    const supplyOps = (_savedSupplies||[]).filter(function(r) {
      if (!(r.barge||'').trim()) return _isSingleBargeFleet();
      return _normBN(r.barge) === _normBN(rob.bargeName);
    });
    const totalSupV = supplyOps.reduce(function(s,r){ return s+(parseFloat(r.vlsfoAct)||0); }, 0);
    const totalSupM = supplyOps.reduce(function(s,r){ return s+(parseFloat(r.mgoAct)||0); }, 0);
    const opsCount  = supplyOps.length;
    const plannedOps = (_lastSched||[]).filter(function(item){
      return _normBN(item.bargeLabel) === _normBN(rob.bargeName);
    }).length;

    const bid = b.id;

    html +=
      '<div style="background:var(--surface);border-radius:10px;border:none;box-shadow:var(--sh-sm);overflow:hidden" id="rob-sum-card-' + esc(bid) + '">' +

        // ── Card header ──
        '<div style="padding:12px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border2)">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M3 11V8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3"/><line x1="12" y1="11" x2="12" y2="22"/></svg>' +
            '<span style="font-size:13px;font-weight:700;color:var(--ink);font-family:DM Sans,sans-serif">' + esc(rob.bargeName) + '</span>' +
            (hasManual ? '<span style="font-size:8px;font-weight:700;padding:2px 6px;border-radius:4px;background:var(--purple-lt);color:var(--purple);border:1px solid var(--purple-bd)">Override</span>' : '') +
          '</div>' +
          '<button onclick="toggleROBSumEdit(' + esc(JSON.stringify(bid)) + ')" id="rob-sum-edit-btn-' + esc(bid) + '" style="display:inline-flex;align-items:center;gap:5px;padding:5px 11px;background:var(--azure);color:#fff;border:none;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif">' +
            '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.47"/></svg>' +
            'Update ROB' +
          '</button>' +
        '</div>' +

        // ── ROB display ──
        '<div style="padding:12px 14px" id="rob-sum-view-' + esc(bid) + '">' +

          // VLSFO row
          '<div style="margin-bottom:10px">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">' +
              '<span style="font-size:10px;font-weight:700;color:var(--fuel-v);text-transform:uppercase;letter-spacing:.06em">VLSFO</span>' +
              '<div style="display:flex;align-items:baseline;gap:6px">' +
                '<span style="font-size:20px;font-weight:800;font-family:DM Mono,monospace;color:' + vCol + ';line-height:1">' + Math.round(rob.liveV).toLocaleString() + '</span>' +
                '<span style="font-size:10px;color:var(--muted)">MT</span>' +
                '<span style="font-size:10px;font-weight:600;color:' + vCol + '">(' + vPct + '%)</span>' +
              '</div>' +
            '</div>' +
            '<div style="height:8px;background:var(--bg);border-radius:4px;overflow:hidden">' +
              '<div style="height:100%;background:' + vCol + ';width:' + vPct + '%;border-radius:4px;transition:width .4s"></div>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;margin-top:3px">' +
              '<span style="font-size:9px;color:var(--muted)">Cap: ' + (rob.vcap||0).toLocaleString() + ' MT</span>' +
              '<span style="font-size:9px;color:var(--muted)">Opening: ' + Math.round(rob.openingV||0).toLocaleString() + ' MT</span>' +
            '</div>' +
          '</div>' +

          // LSMGO row
          '<div style="margin-bottom:10px">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">' +
              '<span style="font-size:10px;font-weight:700;color:var(--fuel-m);text-transform:uppercase;letter-spacing:.06em">LSMGO</span>' +
              '<div style="display:flex;align-items:baseline;gap:6px">' +
                '<span style="font-size:20px;font-weight:800;font-family:DM Mono,monospace;color:' + mCol + ';line-height:1">' + Math.round(rob.liveM).toLocaleString() + '</span>' +
                '<span style="font-size:10px;color:var(--muted)">MT</span>' +
                '<span style="font-size:10px;font-weight:600;color:' + mCol + '">(' + mPct + '%)</span>' +
              '</div>' +
            '</div>' +
            '<div style="height:8px;background:var(--bg);border-radius:4px;overflow:hidden">' +
              '<div style="height:100%;background:' + mCol + ';width:' + mPct + '%;border-radius:4px;transition:width .4s"></div>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;margin-top:3px">' +
              '<span style="font-size:9px;color:var(--muted)">Cap: ' + (rob.mcap||0).toLocaleString() + ' MT</span>' +
              '<span style="font-size:9px;color:var(--muted)">Opening: ' + Math.round(rob.openingM||0).toLocaleString() + ' MT</span>' +
            '</div>' +
          '</div>' +

          // Stats strip
          '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;border-top:1px solid var(--border2);padding-top:8px">' +
            '<div style="text-align:center">' +
              '<div style="font-size:8px;text-transform:uppercase;color:var(--muted);font-weight:600;margin-bottom:2px">Ops</div>' +
              '<div style="font-size:13px;font-weight:700;font-family:DM Mono,monospace">' + opsCount + '<span style="font-size:8px;color:var(--muted)">/' + plannedOps + '</span></div>' +
            '</div>' +
            '<div style="text-align:center;border-left:1px solid var(--border2)">' +
              '<div style="font-size:8px;text-transform:uppercase;color:var(--azure);font-weight:600;margin-bottom:2px">V Supplied</div>' +
              '<div style="font-size:12px;font-weight:700;font-family:DM Mono,monospace;color:var(--azure)">' + Math.round(totalSupV).toLocaleString() + '<span style="font-size:8px;font-weight:400"> MT</span></div>' +
            '</div>' +
            '<div style="text-align:center;border-left:1px solid var(--border2)">' +
              '<div style="font-size:8px;text-transform:uppercase;color:var(--teal);font-weight:600;margin-bottom:2px">M Supplied</div>' +
              '<div style="font-size:12px;font-weight:700;font-family:DM Mono,monospace;color:var(--teal)">' + Math.round(totalSupM).toLocaleString() + '<span style="font-size:8px;font-weight:400"> MT</span></div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // ── Inline ROB editor (hidden by default) ──
        '<div id="rob-sum-edit-' + esc(bid) + '" style="display:none;border-top:2px solid var(--azure-bd);background:linear-gradient(135deg,var(--azure-lt),var(--green-lt));padding:14px 14px 10px">' +
          '<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--azure);margin-bottom:10px">Set New Current ROB</div>' +

          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">' +
            '<div>' +
              '<label style="font-size:9px;font-weight:700;color:var(--fuel-v);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:4px">VLSFO (MT)</label>' +
              '<div style="position:relative">' +
                '<input type="number" id="rob-sum-v-' + esc(bid) + '" value="' + Math.round(rob.liveV) + '" min="0" max="' + (rob.vcap||99999) + '" step="50" ' +
                  'style="width:100%;padding:9px 10px;border:2px solid var(--azure-bd);border-radius:7px;font-size:15px;font-weight:700;font-family:DM Mono,monospace;color:var(--azure);background:var(--surface);outline:none;box-sizing:border-box" ' +
                  'oninput="updateROBSumPreview(\'' + escJs(bid) + '\')">' +
              '</div>' +
              '<div style="font-size:9px;color:var(--muted);margin-top:3px">Was: <strong>' + Math.round(rob.liveV).toLocaleString() + ' MT</strong></div>' +
            '</div>' +
            '<div>' +
              '<label style="font-size:9px;font-weight:700;color:var(--fuel-m);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:4px">LSMGO (MT)</label>' +
              '<div style="position:relative">' +
                '<input type="number" id="rob-sum-m-' + esc(bid) + '" value="' + Math.round(rob.liveM) + '" min="0" max="' + (rob.mcap||99999) + '" step="50" ' +
                  'style="width:100%;padding:9px 10px;border:2px solid var(--fuel-m-bd);border-radius:7px;font-size:15px;font-weight:700;font-family:DM Mono,monospace;color:var(--teal);background:var(--surface);outline:none;box-sizing:border-box" ' +
                  'oninput="updateROBSumPreview(\'' + escJs(bid) + '\')">' +
              '</div>' +
              '<div style="font-size:9px;color:var(--muted);margin-top:3px">Was: <strong>' + Math.round(rob.liveM).toLocaleString() + ' MT</strong></div>' +
            '</div>' +
          '</div>' +

          // Preview of new %
          '<div id="rob-sum-preview-' + esc(bid) + '" style="display:none;margin-bottom:10px;padding:8px 10px;background:var(--surface);border-radius:7px;border:none;box-shadow:var(--sh-in-xs);font-size:11px;color:var(--ink);display:flex;gap:14px;flex-wrap:wrap">' +
          '</div>' +

          '<div>' +
            '<label style="font-size:9px;font-weight:700;color:var(--sub);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:4px">Reason (optional)</label>' +
            '<input type="text" id="rob-sum-reason-' + esc(bid) + '" placeholder="e.g. Refuelled at Fujairah, 12 Jun 2025" ' +
              'style="width:100%;padding:7px 10px;border:none;box-shadow:var(--sh-in-xs);border-radius:7px;font-size:12px;font-family:DM Sans,sans-serif;outline:none;box-sizing:border-box">' +
          '</div>' +

          '<div style="display:flex;gap:8px;margin-top:10px">' +
            '<button onclick="saveROBSumEdit(\'' + escJs(bid) + '\')" ' +
              'style="flex:1;padding:9px 0;background:linear-gradient(135deg,var(--ink-solid),var(--fuel-v));color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif">' +
              '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="vertical-align:middle;margin-right:4px"><polyline points="20 6 9 17 4 12"/></svg>' +
              'Confirm &amp; Apply ROB' +
            '</button>' +
            '<button onclick="toggleROBSumEdit(\'' + escJs(bid) + '\')" ' +
              'style="padding:9px 16px;background:var(--surface);border:none;box-shadow:var(--sh-sm);border-radius:7px;font-size:12px;cursor:pointer;font-family:DM Sans,sans-serif;color:var(--sub)">Cancel</button>' +
          '</div>' +
        '</div>' +

      '</div>'; // end card
  });

  html += '</div></div>';
  el.innerHTML = html;
}

/* ── ROB Summary inline edit helpers ── */
function toggleROBSumEdit(bid) {
  const editEl = document.getElementById('rob-sum-edit-' + bid);
  const btn    = document.getElementById('rob-sum-edit-btn-' + bid);
  if (!editEl) return;
  const isOpen = editEl.style.display !== 'none';
  editEl.style.display = isOpen ? 'none' : 'block';
  if (btn) {
    if (!isOpen) {
      btn.style.background = 'var(--amber)';
      btn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Cancel';
      // Focus VLSFO input
      setTimeout(function(){ const inp = document.getElementById('rob-sum-v-'+bid); if(inp) inp.focus(); }, 50);
    } else {
      btn.style.background = 'var(--azure)';
      btn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.47"/></svg> Update ROB';
    }
  }
}

function updateROBSumPreview(bid) {
  const b = _bargeConfig.find(function(x){ return x.id == bid; });
  if (!b) return;
  const newV = parseFloat(document.getElementById('rob-sum-v-' + bid)?.value) || 0;
  const newM = parseFloat(document.getElementById('rob-sum-m-' + bid)?.value) || 0;
  const vPct = b.vcap > 0 ? Math.min(100, Math.round((newV/b.vcap)*100)) : 0;
  const mPct = b.mcap > 0 ? Math.min(100, Math.round((newM/b.mcap)*100)) : 0;
  const vCol = vPct < 15 ? 'var(--red)' : vPct < 30 ? 'var(--amber)' : 'var(--fuel-v)';
  const mCol = mPct < 15 ? 'var(--red)' : mPct < 30 ? 'var(--amber)' : 'var(--fuel-m)';
  const prev = document.getElementById('rob-sum-preview-' + bid);
  if (prev) {
    prev.style.display = 'flex';
    prev.innerHTML =
      '<span style="color:' + vCol + ';font-weight:700;font-family:DM Mono,monospace">VLSFO → ' + newV.toLocaleString() + ' MT (' + vPct + '%)</span>' +
      '<span style="color:' + mCol + ';font-weight:700;font-family:DM Mono,monospace">LSMGO → ' + newM.toLocaleString() + ' MT (' + mPct + '%)</span>';
  }
}

async function saveROBSumEdit(bid) {
  const b = _bargeConfig.find(function(x){ return x.id == bid; });
  if (!b) return;
  const newV   = parseFloat(document.getElementById('rob-sum-v-' + bid)?.value);
  const newM   = parseFloat(document.getElementById('rob-sum-m-' + bid)?.value);
  const reason = (document.getElementById('rob-sum-reason-' + bid)?.value || '').trim() || 'Manual ROB update';
  if (isNaN(newV) || isNaN(newM) || newV < 0 || newM < 0) {
    alert('Enter valid positive values for both VLSFO and LSMGO.');
    return;
  }

  const liveROBs = getAllLiveROBs();
  const oldROB   = liveROBs[bid];
  const oldV = oldROB ? Math.round(oldROB.liveV) : 0;
  const oldM = oldROB ? Math.round(oldROB.liveM) : 0;
  const ts   = new Date().toISOString();

  // Store as _final override — this is the ONLY place this edit is
  // recorded. The "current ROB" you type here is just that: the current
  // remaining amount right now. It is intentionally NEVER written into
  // _bargeConfig's Opening ROB (b.vrob/b.mrob) — doing so used to cause a
  // double-deduction bug, where computeLiveROB() would re-subtract every
  // already-completed supply against a starting point that had already
  // had those same supplies subtracted from it once. Opening ROB is only
  // ever set from the Barge Fleet page's own "Opening ROB" field
  // (saveBargeEdit), which represents the true starting baseline, not a
  // live snapshot — those are two different things and must stay separate.
  if (!_manualROB) _manualROB = {};
  // atIds: the supplies/reloads this figure already accounts for — later
  // ones keep deducting from it (see computeLiveROB).
  _manualROB[bid + '_final'] = { v: newV, m: newM, reason: reason, editedAt: ts, editedBy: 'ROB Update', atIds: _robOverrideAtIds(bid), updatedAt: Date.now() };
  _robMeasured(bid);

  // Audit log
  if (!_robAuditLog) _robAuditLog = [];
  _robAuditLog.push({ bargeId: bid, bargeName: b.name, field: 'VLSFO', oldVal: oldV, newVal: Math.round(newV), reason: reason, editedAt: ts, editedBy: 'ROB Update' });
  _robAuditLog.push({ bargeId: bid, bargeName: b.name, field: 'LSMGO', oldVal: oldM, newVal: Math.round(newM), reason: reason, editedAt: ts, editedBy: 'ROB Update' });

  // Also sync barge states so scheduler uses new values
  if (_bargeStates && _bargeStates[bid]) {
    _bargeStates[bid].rv = newV;
    _bargeStates[bid].rm = newM;
  }

  if (typeof updateBargeView === 'function') updateBargeView(bid);

  // Audit first so it rides in the same write; saveManualROB() does the one
  // shared-state save (this used to write the whole state twice).
  await saveROBAudit();
  await saveManualROB();

  // Close the editor panel
  toggleROBSumEdit(bid);

  // Re-render everything that uses ROB
  renderLiveROBDashboard();
  renderRemainingSupplyTracker();
  renderWeekCalendar(_calWeekOffset||0);

  // Flash success on card
  const card = document.getElementById('rob-sum-card-' + bid);
  if (card) {
    card.style.transition = 'box-shadow .2s';
    card.style.boxShadow  = '0 0 0 3px var(--green)';
    setTimeout(function(){ card.style.boxShadow = ''; }, 1200);
  }

  // Toast
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;background:var(--green);color:#fff;border-radius:12px;padding:12px 22px;font-size:13px;font-weight:700;font-family:DM Sans,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.22);white-space:nowrap';
  t.innerHTML = '✓ ' + esc(b.name) + ' ROB updated — VLSFO ' + Math.round(newV).toLocaleString() + ' MT | LSMGO ' + Math.round(newM).toLocaleString() + ' MT';
  document.body.appendChild(t);
  setTimeout(function(){ t.style.transition='opacity .4s'; t.style.opacity='0'; setTimeout(function(){ t.remove(); }, 400); }, 3500);
}

function toggleROBHistory(bargeId) {
  const el = document.getElementById('rob-history-' + bargeId);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

/* ─── ROB Editor Modal ─── */
let _editingROBBargeId = null;

function openROBEditor(bargeId) {
  const b = _bargeConfig.find(function(x) { return x.id == bargeId; });
  if (!b) { alert('Generate schedule first.'); return; }
  _editingROBBargeId = bargeId;

  const liveROBs = getAllLiveROBs();
  const rob = liveROBs[bargeId];
  if (!rob) { alert('No ROB data found.'); return; }

  document.getElementById('rob-edit-barge-name').textContent = b.name;
  document.getElementById('rob-edit-vlsfo-cur').textContent  = Math.round(rob.liveV).toLocaleString() + ' MT';
  document.getElementById('rob-edit-mgo-cur').textContent    = Math.round(rob.liveM).toLocaleString() + ' MT';
  document.getElementById('rob-edit-vlsfo').value = Math.round(rob.liveV);
  document.getElementById('rob-edit-mgo').value   = Math.round(rob.liveM);
  document.getElementById('rob-edit-reason').value = '';
  document.getElementById('rob-edit-user').value   = '';

  // Show recent audit log for this barge
  const auditLog = _robAuditLog.filter(function(e) { return e.bargeId == bargeId; }).slice(-8).reverse();
  const auditEl = document.getElementById('rob-audit-list');
  if (auditLog.length) {
    auditEl.innerHTML = auditLog.map(function(e) {
      return '<div style="border-bottom:1px solid var(--border2);padding:6px 0;font-size:11.5px">' +
        '<span style="font-weight:600;color:var(--ink)">' + esc(e.field) + '</span>: ' +
        '<span style="color:var(--red)">' + esc((e.oldVal || 0).toLocaleString()) + ' MT</span> → ' +
        '<span style="color:var(--green)">' + esc((e.newVal || 0).toLocaleString()) + ' MT</span>' +
        '<span style="color:var(--muted);font-size:10.5px;margin-left:8px">' + esc(e.editedBy) + ' · ' + new Date(e.editedAt).toLocaleString() + '</span>' +
        (e.reason ? '<div style="color:var(--sub);font-size:10.5px;margin-top:2px">' + esc(e.reason) + '</div>' : '') +
        '</div>';
    }).join('');
  } else {
    auditEl.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px 0">No manual edits recorded yet.</div>';
  }

  document.getElementById('rob-editor-modal').style.display = 'flex';
}

function closeROBEditor() {
  document.getElementById('rob-editor-modal').style.display = 'none';
  _editingROBBargeId = null;
}


