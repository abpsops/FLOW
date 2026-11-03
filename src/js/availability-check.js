/* ─────────────────────────────────────────────────────────────────────
   HELPER: Does a proposed job genuinely conflict with a committed op?
   A conflict exists only when there is REAL time overlap that would
   delay the committed op. (Phase 10 — 2h tolerance applied here)
   ───────────────────────────────────────────────────────────────────── */
function _doesJobConflict(jobStart, jobEnd, op, travelHrs, toleranceHrs) {
  var tol = toleranceHrs || 0;
  var opBusyFrom  = addHrs(op.start, -travelHrs);
  var opBusyUntil = addHrs(_opBusyEnd(op), travelHrs); // ETC + contingency + transit
  var overlap = jobStart < opBusyUntil && jobEnd > opBusyFrom;
  if (!overlap) return false;
  var overlapHrs = (
    Math.min(jobEnd.getTime(), opBusyUntil.getTime()) -
    Math.max(jobStart.getTime(), opBusyFrom.getTime())
  ) / 3600000;
  return overlapHrs > tol;
}

/* ─────────────────────────────────────────────────────────────────────
   HELPER: Can a job [start, start+jobHrs] complete before nextOpStart?
   ───────────────────────────────────────────────────────────────────── */
function _jobFitsBeforeOp(jobStart, jobHrs, nextOpStart, travelHrs, toleranceHrs) {
  if (!nextOpStart) return true;
  var jobEnd = addHrs(jobStart, jobHrs + travelHrs);
  var margin = (nextOpStart - jobEnd) / 3600000;
  return margin >= -(toleranceHrs || 0);
}

/* ─────────────────────────────────────────────────────────────────────
   HELPER: Enumerate ALL scheduling gaps on a barge timeline (Phase 3)
   ───────────────────────────────────────────────────────────────────── */
function _findAllGaps(ops, freeFrom) {
  var gaps = [];
  var now  = new Date();
  var absEarliest = new Date(Math.max(now.getTime(), freeFrom ? freeFrom.getTime() : now.getTime()));

  if (ops.length === 0) {
    gaps.push({
      type: 'empty', gapStart: absEarliest, gapEnd: null, gapHrs: Infinity,
      prevOp: null, nextOp: null, label: 'Fully available', isNow: true
    });
    return gaps;
  }

  // Gap before first op
  var firstStart = ops[0].start;
  var beforeHrs = (firstStart - absEarliest) / 3600000;
  if (beforeHrs > 0) {
    gaps.push({
      type: 'before_first', gapStart: absEarliest, gapEnd: firstStart, gapHrs: beforeHrs,
      prevOp: null, nextOp: ops[0], label: 'Now until ' + ops[0].vessel, isNow: true
    });
  }

  // Gaps between consecutive ops
  for (var i = 0; i < ops.length - 1; i++) {
    var rawOpen  = addHrs(_opBusyEnd(ops[i]), _calcParams.travelHrs);
    var gapOpen  = new Date(Math.max(rawOpen.getTime(), now.getTime()));
    var gapClose = ops[i + 1].start;
    var hrs      = (gapClose - gapOpen) / 3600000;
    if (hrs > 0) {
      gaps.push({
        type: 'between', gapStart: gapOpen, gapEnd: gapClose, gapHrs: hrs,
        prevOp: ops[i], nextOp: ops[i + 1],
        label: 'Between ' + ops[i].vessel + ' and ' + ops[i + 1].vessel
      });
    }
  }

  // Open-ended gap after last op (Phase 6: future commitment ≠ blocker for past slot)
  var afterRaw   = addHrs(_opBusyEnd(ops[ops.length - 1]), _calcParams.travelHrs);
  var afterStart = new Date(Math.max(afterRaw.getTime(), now.getTime()));
  gaps.push({
    type: 'after_last', gapStart: afterStart, gapEnd: null, gapHrs: Infinity,
    prevOp: ops[ops.length - 1], nextOp: null,
    label: 'After ' + ops[ops.length - 1].vessel
  });

  return gaps;
}

/* ─────────────────────────────────────────────────────────────────────
   HELPER: Evaluate whether a job fits inside a gap window
   ───────────────────────────────────────────────────────────────────── */
function _evalGapForJob(gap, requestedETA, jobDurationHrs, travelBuffer) {
  var now    = new Date();
  // The new job gets the same overrun contingency as committed ones, so a
  // gap fits here exactly when Free Windows calls it usable.
  var TOTAL  = jobDurationHrs + travelBuffer + _contingencyHrs();
  var earliest = new Date(Math.max(gap.gapStart.getTime(), now.getTime()));
  var latestStart = null;

  if (gap.gapEnd !== null) {
    latestStart = new Date(gap.gapEnd.getTime() - TOTAL * 3600000);
    if (latestStart < earliest) {
      return { fits: false, requestedOk: false, earliestStart: earliest, latestStart: null, reason: 'Window too short' };
    }
  }

  var effectiveHrs = gap.gapEnd
    ? (gap.gapEnd.getTime() - earliest.getTime()) / 3600000
    : Infinity;

  if (effectiveHrs < TOTAL) {
    return {
      fits: false, requestedOk: false, earliestStart: earliest, latestStart: null,
      reason: 'Window too short (' + effectiveHrs.toFixed(1) + 'h available, ' + TOTAL.toFixed(1) + 'h needed)'
    };
  }

  // No requested ETA = "as soon as possible": the earliest start in this
  // window IS the requested time, so the window is OK whenever the job fits.
  // (Previously a blank ETA could never be "feasible at requested time".)
  var requestedOk = true;
  if (requestedETA) {
    requestedOk = requestedETA >= now &&
                  requestedETA >= earliest &&
                  (latestStart === null || requestedETA <= latestStart);
  }

  return { fits: true, requestedOk: requestedOk, earliestStart: earliest, latestStart: latestStart, reason: null };
}

/* ─────────────────────────────────────────────────────────────────────
   HELPER: Find the earliest conflict-free start for a job on a barge
   Used by split-supply engine (Phase 7) and rescheduling (Phase 9)
   ───────────────────────────────────────────────────────────────────── */
function _findEarliestStart(timeline, freeFrom, requestedETA, jobHrs, travelHrs) {
  var now = new Date();
  var TOL = 2; // Phase 10 overlap tolerance

  var candidates = [];
  if (requestedETA) candidates.push(requestedETA);
  candidates.push(freeFrom || now);
  candidates.push(now);
  timeline.forEach(function (op) { candidates.push(addHrs(_opBusyEnd(op), travelHrs)); });
  candidates.sort(function (a, b) { return a - b; });
  var cont = _contingencyHrs();

  for (var ci = 0; ci < candidates.length; ci++) {
    var tryStart = new Date(Math.max(candidates[ci].getTime(), now.getTime(), freeFrom ? freeFrom.getTime() : 0));
    var tryEndTravel = addHrs(tryStart, jobHrs + cont + travelHrs);

    var conflict = timeline.some(function (op) {
      return _doesJobConflict(tryStart, tryEndTravel, op, travelHrs, TOL);
    });

    if (!conflict) {
      var prevOp = null;
      for (var pi = timeline.length - 1; pi >= 0; pi--) {
        if (addHrs(_opBusyEnd(timeline[pi]), travelHrs) <= tryStart) {
          prevOp = timeline[pi]; break;
        }
      }
      var lbl = (requestedETA && Math.abs(tryStart - requestedETA) < 300000)
        ? 'On vessel arrival'
        : prevOp
          ? (prevOp.isBlock ? 'After unavailable block (' + (prevOp.reason || 'blocked') + ') ends ' + fmt24(prevOp.etc) : 'After ' + prevOp.vessel + ' ETC ' + fmt24(prevOp.etc))
          : 'At earliest available time';
      return { start: tryStart, etc: addHrs(tryStart, jobHrs), label: lbl, onTime: requestedETA && Math.abs(tryStart - requestedETA) < 300000 };
    }
  }

  // Ultimate fallback: after all ops
  var lastOp  = timeline.reduce(function (a, b) { return _opBusyEnd(b) > _opBusyEnd(a) ? b : a; }, timeline[0]);
  var afterAll = addHrs(_opBusyEnd(lastOp), travelHrs);
  afterAll = new Date(Math.max(afterAll.getTime(), now.getTime()));
  return { start: afterAll, etc: addHrs(afterAll, jobHrs), label: 'After all ops (' + fmt24(lastOp.etc) + ')', onTime: false };
}

/* ─────────────────────────────────────────────────────────────────────
   PUBLIC ENTRY POINT — wraps with error handling
   ───────────────────────────────────────────────────────────────────── */
function checkNSCUnified() {
  // ── READ-ONLY ENFORCEMENT (Fix #2) ──────────────────────────────────
  // Check Availability is a pure simulation tool and must NEVER write to
  // any persisted ROB storage layer (_manualROB, _savedSupplies baked
  // values, or _bargeConfig opening ROB). Snapshot the three storage
  // layers before running the check and compare after — if anything
  // differs, the check is rolled back immediately and the change is
  // surfaced loudly instead of silently corrupting stored ROB. This is
  // a tripwire against future regressions, not just a one-time fix.
  const _preCheckManualROB    = JSON.stringify(_manualROB || {});
  const _preCheckBargeOpening = JSON.stringify((_bargeConfig || []).map(function(b){ return {id:b.id, vrob:b.vrob, mrob:b.mrob}; }));
  const _preCheckSuppliesLen  = (_savedSupplies || []).length;
  // Keep restorable copies of every guarded layer (not just _manualROB), so
  // the "no stored values were changed" message below is actually true.
  const _preCheckSuppliesArr  = (_savedSupplies || []).slice();
  const _preCheckSuppliesJson = JSON.stringify(_savedSupplies || []);

  try {
    _checkNSCUnifiedInner();
  } catch (e) {
    console.error('checkNSCUnified error:', e);
    alert('Availability check error: ' + e.message + '\n\nLine: ' + (e.stack || '').split('\n')[1]);
  }

  const _postCheckManualROB    = JSON.stringify(_manualROB || {});
  const _postCheckBargeOpening = JSON.stringify((_bargeConfig || []).map(function(b){ return {id:b.id, vrob:b.vrob, mrob:b.mrob}; }));
  const _postCheckSuppliesLen  = (_savedSupplies || []).length;

  if (_preCheckManualROB !== _postCheckManualROB ||
      _preCheckBargeOpening !== _postCheckBargeOpening ||
      _preCheckSuppliesLen !== _postCheckSuppliesLen) {
    console.error('ABPS INTEGRITY ALERT: Check Availability mutated stored ROB data — this must never happen. Reverting.');
    try { _manualROB = JSON.parse(_preCheckManualROB); } catch(e) {}
    try {
      var _openSnap = JSON.parse(_preCheckBargeOpening);
      (_bargeConfig || []).forEach(function(b) {
        var o = _openSnap.find(function(x) { return x.id === b.id; });
        if (o) { b.vrob = o.vrob; b.mrob = o.mrob; }
      });
    } catch(e) {}
    // Restore the supply list wholesale (same objects; any baked values
    // changed in place are restored from the JSON snapshot).
    if (JSON.stringify(_savedSupplies || []) !== _preCheckSuppliesJson) {
      try { _savedSupplies = JSON.parse(_preCheckSuppliesJson); } catch(e) { _savedSupplies = _preCheckSuppliesArr; }
    }
    alert('A data-integrity issue was caught and blocked: the availability check tried to modify saved ROB data. No stored values were changed. Please reload and contact support if this keeps happening.');
  }
}

/* ═════════════════════════════════════════════════════════════════════
   MAIN ENGINE — _checkNSCUnifiedInner
   Phase 1 → Phase 13
   ═════════════════════════════════════════════════════════════════════ */
function _checkNSCUnifiedInner() {
  /* ── PHASE 1: Data Collection ── */
  var barges = _bargeConfig, states = _bargeStates;
  if (!barges || !barges.length) {
    barges = []; states = {};
    _barges.forEach(function (b) {
      var vcap = parseFloat(document.getElementById('b' + b.id + '-vcap')?.value) || 0;
      var mcap = parseFloat(document.getElementById('b' + b.id + '-mcap')?.value) || 0;
      var vrob = parseFloat(document.getElementById('b' + b.id + '-vrob')?.value) || 0;
      var mrob = parseFloat(document.getElementById('b' + b.id + '-mrob')?.value) || 0;
      var vbuf = parseFloat(document.getElementById('b' + b.id + '-vbuf')?.value) || 0;
      var mbuf = parseFloat(document.getElementById('b' + b.id + '-mbuf')?.value) || 0;
      var vtph = parseFloat(document.getElementById('b' + b.id + '-vtph')?.value) || 300;
      var mtph = parseFloat(document.getElementById('b' + b.id + '-mtph')?.value) || 100;
      var vrfr = parseFloat(document.getElementById('b' + b.id + '-vrfr')?.value) || 750;
      var mrfr = parseFloat(document.getElementById('b' + b.id + '-mrfr')?.value) || 275;
      var name = (document.getElementById('b' + b.id + '-name')?.value) || ('Barge ' + b.id);
      barges.push({ id: b.id, name: name, vcap: vcap, mcap: mcap, vrob: vrob, mrob: mrob, vbuf: vbuf, mbuf: mbuf, vtph: vtph, mtph: mtph, vrfr: vrfr, mrfr: mrfr });
      states[b.id] = { rv: vrob, rm: mrob, cursor: null };
    });
    if (!barges.length) { alert('Add at least one barge with ROB values to check availability.'); return; }
  }

  var vReq        = parseFloat(document.getElementById('nsc-req-v')?.value) || 0;
  var mReq        = parseFloat(document.getElementById('nsc-req-m')?.value) || 0;
  var vesselName  = (document.getElementById('nsc-vessel-name')?.value || '').trim() || 'Unnamed Vessel';
  var etaRaw      = document.getElementById('nsc-vessel-eta')?.value || '';
  var rangeEndETA = null;
  var requestedETA;
  if (_nscDateMode === 'range') {
    if (etaRaw && (!_nscRangeStart || !_nscRangeEnd)) { alert('Pick both a start and end date for the range (click the start date, then the end date on the calendar).'); return; }
    requestedETA = _nscRangeStart || null;
    rangeEndETA  = _nscRangeEnd || null;
    if (requestedETA && rangeEndETA && rangeEndETA < requestedETA) { alert('The range end must be after the range start.'); return; }
  } else {
    requestedETA = etaRaw ? parseDT(etaRaw) : null;
    if (etaRaw && !requestedETA) { alert('Cannot parse ETA. Use the calendar picker.'); return; }
  }
  if (!vReq && !mReq) { alert('Enter at least one fuel quantity to check.'); return; }

  if (requestedETA) {
    var nowCheck = new Date();
    var pastHrs  = (nowCheck - requestedETA) / 3600000;
    if (pastHrs > 2) {
      if (!confirm(
        'The selected time (' + fmt24(requestedETA) + ') is ' + pastHrs.toFixed(1) + ' hours in the past.\n\n' +
        'The system will check future availability only — past slots will be excluded.\n\nContinue?'
      )) return;
    }
  }

  var now       = new Date();
  var liveROBs  = getAllLiveROBs();
  var travelHrs = _calcParams.travelHrs;
  var hoseHrs   = _calcParams.hoseHrs;
  var TOL       = 2; // Phase 10: 2-hour overlap tolerance

  /* ══════════════════════════════════════════════════════════════════
     PHASE 2 + 3: Per-barge: calculate true free time & build timeline
     ══════════════════════════════════════════════════════════════════ */
  var bargeResults = barges.map(function (b) {
    var liveData = liveROBs[b.id];
    var bs       = states[b.id] || {};
    var liveRv   = liveData ? liveData.liveV : (bs.rv || 0);
    var liveRm   = liveData ? liveData.liveM : (bs.rm || 0);

    // Build full timeline. robOps also keeps ops whose ETC has passed but
    // whose supply was never saved: that fuel is still committed (live ROB
    // only deducts saved supplies), so it counts in the ROB math below —
    // but it occupies no future time, so `timeline` (gaps/free time) drops it.
    var robOps   = _getBargeTimeline(b.id, b.name, true);
    var timeline = robOps.filter(function (op) { return !op.pastEtc; });

    /* PHASE 2: True Free Time ─────────────────────────────────────────
       Rule: freeFrom = ETC of last op that ACTUALLY BLOCKS the requested
       window + transit. Future ops far away are NOT blockers. (Phase 6) */
    var reqJobHrs = hoseHrs + Math.max(
      vReq > 0 ? vReq / (b.vtph || 300) : 0,
      mReq > 0 ? mReq / (b.mtph || 100) : 0
    );
    var reqStart  = requestedETA || now;
    var reqJobEnd = addHrs(reqStart, reqJobHrs + travelHrs);

    var freeFrom;
    if (timeline.length === 0) {
      freeFrom = now; // Phase 2 Rule 1: no planned ops → free immediately
    } else {
      var blockingOps = timeline.filter(function (op) {
        var opBusyFrom  = addHrs(op.start, -travelHrs);
        var opBusyUntil = addHrs(_opBusyEnd(op), travelHrs);
        return reqStart < opBusyUntil && reqJobEnd > opBusyFrom;
      });

      if (blockingOps.length === 0) {
        freeFrom = now; // Phase 6: no genuine block → barge available
      } else {
        var lastBlocker = blockingOps.reduce(function (lat, op) { return _opBusyEnd(op) > _opBusyEnd(lat) ? op : lat; }, blockingOps[0]);
        freeFrom = addHrs(_opBusyEnd(lastBlocker), travelHrs);
      }
    }

    /* PHASE 11: ROB Protection ─────────────────────────────────────────
       Only deduct ops that occur BEFORE the requested supply window.
       Ops after the requested window do NOT consume ROB yet. */
    var opsBeforeReq = requestedETA
      ? robOps.filter(function (op) { return op.pastEtc || op.start < requestedETA; })
      : robOps;
    var plannedVbeforeReq = opsBeforeReq.reduce(function (s, op) { return s + (op.vQ || 0); }, 0);
    var plannedMbeforeReq = opsBeforeReq.reduce(function (s, op) { return s + (op.mQ || 0); }, 0);

    // Total planned quantities (for the analysis table)
    var totalPlannedV = robOps.reduce(function (s, op) { return s + (op.vQ || 0); }, 0);
    var totalPlannedM = robOps.reduce(function (s, op) { return s + (op.mQ || 0); }, 0);

    var availRv = Math.max(0, liveRv - plannedVbeforeReq);
    var availRm = Math.max(0, liveRm - plannedMbeforeReq);

    // 72h planned snapshot (informational)
    var cut72 = new Date(now.getTime() + 72 * 3600000);
    var planned72V = 0, planned72M = 0;
    timeline.forEach(function (op) {
      if (op.start >= now && op.start <= cut72) { planned72V += op.vQ || 0; planned72M += op.mQ || 0; }
    });

    /* PHASE 11: Free ROB = Current ROB − Committed Qty */
    var freeROBv = Math.max(0, availRv - (vReq > 0 ? vReq : 0));
    var freeROBm = Math.max(0, availRm - (mReq > 0 ? mReq : 0));
    var canV     = availRv >= vReq;
    var canM     = availRm >= mReq;
    var canFull  = (vReq === 0 || canV) && (mReq === 0 || canM);
    var shortV   = Math.max(0, vReq - availRv);
    var shortM   = Math.max(0, mReq - availRm);

    /* PHASE 3: Build gaps and evaluate each one */
    var gaps       = _findAllGaps(timeline, freeFrom);
    var jobHrs     = reqJobHrs;
    var supplyV    = vReq, supplyM = mReq;
    var robAfterV  = availRv - (vReq > 0 ? vReq : 0);
    var robAfterM  = availRm - (mReq > 0 ? mReq : 0);
    var vBelowBuf  = vReq > 0 && robAfterV < (b.vbuf || 0);
    var mBelowBuf  = mReq > 0 && robAfterM < (b.mbuf || 0);

    var gapAnalysis = gaps.map(function (gap) {
      var ev         = _evalGapForJob(gap, requestedETA, jobHrs, travelHrs);
      var startTime  = (requestedETA && ev.requestedOk) ? requestedETA : ev.earliestStart;
      var etcTime    = canFull ? calcETC(startTime, supplyV, supplyM, b.vtph, b.mtph) : addHrs(startTime, jobHrs);
      var cReasons   = [];
      if (vBelowBuf && vReq > 0) cReasons.push('VLSFO ROB after (' + Math.round(robAfterV).toLocaleString() + ' MT) below buffer (' + b.vbuf + ' MT)');
      if (mBelowBuf && mReq > 0) cReasons.push('MGO ROB after (' + Math.round(robAfterM).toLocaleString() + ' MT) below buffer (' + b.mbuf + ' MT)');
      // Protect the very next committed supply's own quantity — even if the
      // barge clears the generic safety buffer, it may still not carry enough
      // to fully cover the next planned vessel's nominated qty.
      if (gap.nextOp) {
        if (vReq > 0 && (gap.nextOp.vQ || 0) > 0 && robAfterV < gap.nextOp.vQ) {
          cReasons.push('Must complete loading before ' + gap.nextOp.vessel + ' (ETA ' + fmt24(gap.nextOp.start) + ') to fully cover its committed ' + Math.round(gap.nextOp.vQ).toLocaleString() + ' MT VLSFO');
        }
        if (mReq > 0 && (gap.nextOp.mQ || 0) > 0 && robAfterM < gap.nextOp.mQ) {
          cReasons.push('Must complete loading before ' + gap.nextOp.vessel + ' (ETA ' + fmt24(gap.nextOp.start) + ') to fully cover its committed ' + Math.round(gap.nextOp.mQ).toLocaleString() + ' MT MGO');
        }
      }
      var feasibility = !canFull ? 'no_stock' : !ev.fits ? 'infeasible' : cReasons.length === 0 ? 'feasible' : 'constrained';
      return {
        gap: gap, eval: ev, startTime: startTime, etcTime: etcTime,
        constraintReasons: cReasons, feasibility: feasibility,
        requestedFitsHere: ev.fits && ev.requestedOk && canFull,
        anyFitsHere: ev.fits && canFull
      };
    });

    var requestedGap      = gapAnalysis.find(function (ga) { return ga.requestedFitsHere; }) || null;
    var requestedFeasible = !!requestedGap;
    var feasibleGaps      = gapAnalysis.filter(function (ga) { return ga.anyFitsHere; });
    var nearestGap        = feasibleGaps.length
      ? feasibleGaps.slice().sort(function (a, b) { return a.eval.earliestStart - b.eval.earliestStart; })[0]
      : null;
    var nearestSlot       = nearestGap ? nearestGap.eval.earliestStart : null;

    /* Blocking reasons (only when genuinely blocked) */
    var blockingReasons = [];
    if (!requestedFeasible && requestedETA && canFull) {
      var jobEnd2 = addHrs(requestedETA, jobHrs + travelHrs);
      var directConflicts = timeline.filter(function (op) {
        return _doesJobConflict(requestedETA, jobEnd2, op, travelHrs, 0);
      });
      if (directConflicts.length) {
        directConflicts.forEach(function (op) {
          if (op.isBlock) { blockingReasons.push('Barge unavailable: ' + (op.reason || 'blocked') + ' (' + fmt24(op.start) + ' → ' + fmt24(op.etc) + ')'); return; }
          blockingReasons.push('Conflicts with committed supply: ' + op.vessel +
            ' (' + fmt24(op.start) + ' → ' + fmt24(op.etc) + ')' +
            (op.noFirmETA ? ' — ETA not firm yet, this conflict is provisional' : ''));
        });
      } else if (freeFrom > requestedETA) {
        var blockOp = timeline.filter(function (op) { return addHrs(_opBusyEnd(op), travelHrs) > requestedETA; })
          .sort(function (a, b) { return a.etc - b.etc; })[0];
        blockingReasons.push('Barge free from ' + fmt24(freeFrom) +
          (blockOp ? ' (after ' + blockOp.vessel + ' ETC ' + fmt24(blockOp.etc) + ' + ' + travelHrs + 'h transit)' : ''));
      } else if (!feasibleGaps.length) {
        blockingReasons.push('No scheduling window available (' + jobHrs.toFixed(1) + 'h job + ' + travelHrs + 'h transit needed)');
      } else {
        blockingReasons.push('Requested time does not fit in any available scheduling window');
      }
    }

    /* Phase 4 single-barge determination */
    var canFullySupply    = canFull && feasibleGaps.length > 0;
    var canFullyAtRequest = canFull && requestedFeasible;

    return {
      b, bs, canFull, canV, canM, shortV, shortM,
      liveRv, liveRm,
      totalPlannedV, totalPlannedM,
      plannedV: plannedVbeforeReq, plannedM: plannedMbeforeReq,
      availRv, availRm, freeROBv, freeROBm,
      planned72V, planned72M,
      supplyV, supplyM, robAfterV, robAfterM, vBelowBuf, mBelowBuf,
      jobDurationHrs: jobHrs, freeFrom, timeline,
      gaps, gapAnalysis, requestedFeasible, requestedGap,
      nearestGap, nearestSlot, blockingReasons,
      canFullySupply, canFullyAtRequest,
      stockBlockReason: !canFull
        ? 'Insufficient ROB — ' +
          (!canV && vReq > 0 ? 'VLSFO: ' + Math.round(availRv).toLocaleString() + ' MT available (need ' + vReq.toLocaleString() + ' MT) ' : '') +
          (!canM && mReq > 0 ? 'MGO: ' + Math.round(availRm).toLocaleString() + ' MT available (need ' + mReq.toLocaleString() + ' MT)' : '')
        : null
    };
  });

  /* ══════════════════════════════════════════════════════════════════
     PHASE 12: FEASIBILITY DECISION TREE
     Evaluate in strict order — only reject after ALL steps fail
     ══════════════════════════════════════════════════════════════════ */

  /* Step 1 + 4: Single barge — requested time */
  var feasibleAtRequested    = bargeResults.filter(function (r) { return r.canFull && r.requestedFeasible && r.requestedGap && r.requestedGap.feasibility === 'feasible'; });
  var constrainedAtRequested = bargeResults.filter(function (r) { return r.canFull && r.requestedFeasible && r.requestedGap && r.requestedGap.feasibility === 'constrained'; });
  var anyFeasibleAtRequested = feasibleAtRequested.length + constrainedAtRequested.length > 0;

  /* Step 2+5: Alternative barges — any barge can do it (same logic, all barges checked above) */
  /* (the bargeResults loop already covers all barges — feasibleAtRequested includes best alt) */

  /* Step 3+6: Gap utilisation — any barge has a feasible gap (even if not at requested time) */
  var anyGapFeasible = bargeResults.some(function (r) { return r.canFull && r.nearestGap; });

  /* Step 4 (split supply): evaluate ALL split combinations — Phase 7 */
  var splitResult = null;
  if (!anyFeasibleAtRequested) {
    splitResult = _evaluateSplitSupply(bargeResults, vReq, mReq, requestedETA, travelHrs, hoseHrs, TOL);
  }

  /* Step 8: Delayed start — find nearest overall feasible slot across all barges.
     Always evaluated (not only when no split exists) so the options can be
     ranked below instead of a needless STS pre-empting a simple delay. */
  var delayedOption = null;
  if (!anyFeasibleAtRequested) {
    bargeResults.forEach(function (r) {
      if (r.canFull && r.nearestGap) {
        var delayHrs = requestedETA ? Math.max(0, (r.nearestGap.eval.earliestStart - requestedETA) / 3600000) : 0;
        if (!delayedOption || r.nearestGap.eval.earliestStart < delayedOption.earliest) {
          delayedOption = { barge: r, gap: r.nearestGap, delayHrs: delayHrs, earliest: r.nearestGap.eval.earliestStart };
        }
      }
    });
  }

  /* Rank split vs delayed single-barge start: one barge doing the whole job
     (just later) beats an STS consolidation, which ties up two barges and
     adds a transfer; for a genuine two-barge split, prefer whichever
     finishes first. */
  if (splitResult && delayedOption) {
    var _isSts = splitResult.type === 'vlsfo_sts' || splitResult.type === 'mgo_sts';
    var _dEtc  = delayedOption.gap && delayedOption.gap.etcTime;
    if (_isSts || (_dEtc && splitResult.overallEtc && _dEtc <= splitResult.overallEtc)) splitResult = null;
  }

  /* Overall result categorisation */
  var isFeasibleViaSplit   = !!splitResult;
  var isFeasibleDelayed    = !anyFeasibleAtRequested && !isFeasibleViaSplit && !!delayedOption;
  var overallFeasible      = anyFeasibleAtRequested || isFeasibleViaSplit || isFeasibleDelayed;
  var blockedAtRequested   = bargeResults.filter(function (r) { return r.canFull && !r.requestedFeasible; });

  /* ══════════════════════════════════════════════════════════════════
     PHASE 13: Build HTML Output
     1. Barge Analysis Table
     2. Feasibility Summary Table
     3. Main verdict card (single / split / delayed / not feasible)
     4. Per-barge detailed gap analysis
     5. Final Decision block
     ══════════════════════════════════════════════════════════════════ */
  var html = '';

  /* ── Request context header ── */
  if (requestedETA) {
    var hrsAway = (requestedETA - now) / 3600000;
    var urgBg   = hrsAway < 0 ? 'var(--red-lt)' : hrsAway < 12 ? 'var(--red-lt)' : hrsAway < 30 ? 'var(--amber-lt)' : 'var(--azure-lt)';
    var urgBd   = hrsAway < 0 ? 'var(--red-bd)' : hrsAway < 12 ? 'var(--red-bd)' : hrsAway < 30 ? 'var(--amber-bd)' : 'var(--azure-bd)';
    var etaLineLabel = rangeEndETA
      ? 'Requested window: <strong>' + fmt24(requestedETA) + '</strong> &rarr; <strong>' + fmt24(rangeEndETA) + '</strong>'
      : 'Requested supply time: <strong>' + fmt24(requestedETA) + '</strong>';
    html += '<div style="background:' + urgBg + ';border:1.5px solid ' + urgBd + ';border-radius:10px;padding:12px 16px;margin-bottom:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
      '<div style="flex:1"><div style="font-size:13px;font-weight:700;color:var(--ink)">' + esc(vesselName) + '</div>' +
      '<div style="font-size:12px;color:var(--sub);margin-top:2px">' + etaLineLabel + ' &nbsp;|&nbsp; ' +
      (hrsAway >= 0 ? hrsAway.toFixed(1) + ' hrs from now' : 'Already arrived') + '</div></div></div>';
  }

  /* ── Quantities header ── */
  html += '<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">' +
    (vReq > 0 ? '<div style="background:var(--fuel-v-lt);border:1px solid var(--fuel-v-bd);border-radius:8px;padding:8px 14px;font-size:12px;font-weight:700;color:var(--fuel-v)">VLSFO: ' + vReq.toLocaleString() + ' MT</div>' : '') +
    (mReq > 0 ? '<div style="background:var(--fuel-m-lt);border:1px solid var(--fuel-m-bd);border-radius:8px;padding:8px 14px;font-size:12px;font-weight:700;color:var(--fuel-m)">MGO: ' + mReq.toLocaleString() + ' MT</div>' : '') +
    '</div>';

  /* ──────────────────────────────────────────────────────────────────
     PHASE 13 SECTION 1 — BARGE ANALYSIS TABLE
     ────────────────────────────────────────────────────────────────── */
  html += '<div style="margin-bottom:16px">' +
    '<div style="font-size:10px;font-weight:700;color:var(--sub);letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">Barge Analysis</div>' +
    '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11.5px;background:var(--surface);border-radius:10px;overflow:hidden;border:none;box-shadow:var(--sh-sm)">' +
    '<thead><tr style="background:linear-gradient(135deg,var(--ink-solid),var(--navy2))">' +
    ['Barge', 'ROB (V / M)', 'Planned Qty', 'Free ROB', 'Earliest Free', 'Transit', 'Can Fully Supply', 'Split Supply', 'Status'].map(function (h) {
      return '<th style="color:rgba(255,255,255,.82);padding:8px 10px;text-align:left;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap">' + h + '</th>';
    }).join('') + '</tr></thead><tbody>' +
    bargeResults.map(function (r, i) {
      var rowBg    = i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)';
      var statusC  = r.canFull && r.canFullyAtRequest ? 'var(--green)'
                   : r.canFull && r.canFullySupply    ? 'var(--amber)'
                   : r.canFull                         ? 'var(--amber)'
                   : 'var(--red)';
      var statusL  = r.canFull && r.canFullyAtRequest ? 'Available — On Time'
                   : r.canFull && r.canFullySupply    ? 'Available — Delayed'
                   : r.canFull                         ? 'Available — No Gap'
                   : 'Insufficient Stock';
      var splitCap = r.canV || r.canM; // can contribute at least one fuel
      var plannedStr = '';
      if (r.totalPlannedV > 0 && vReq > 0) plannedStr += Math.round(r.totalPlannedV).toLocaleString() + 'MT V';
      if (r.totalPlannedM > 0 && mReq > 0) plannedStr += (plannedStr ? ' / ' : '') + Math.round(r.totalPlannedM).toLocaleString() + 'MT M';
      if (!plannedStr) plannedStr = '—';
      var freeROBstr = '';
      if (vReq > 0) freeROBstr += Math.round(r.availRv).toLocaleString() + 'MT V';
      if (mReq > 0) freeROBstr += (freeROBstr ? ' / ' : '') + Math.round(r.availRm).toLocaleString() + 'MT M';
      return '<tr style="border-bottom:1px solid var(--border2);background:' + rowBg + '">' +
        '<td style="padding:8px 10px;font-weight:700;white-space:nowrap">' + esc(r.b.name) + '</td>' +
        '<td style="padding:8px 10px;font-family:\'DM Mono\',monospace;font-size:11px;color:var(--azure)">' + Math.round(r.liveRv).toLocaleString() + ' / ' + Math.round(r.liveRm).toLocaleString() + ' MT</td>' +
        '<td style="padding:8px 10px;font-size:11px;color:' + (r.totalPlannedV > 0 || r.totalPlannedM > 0 ? 'var(--amber)' : 'var(--muted)') + '">' + plannedStr + '</td>' +
        '<td style="padding:8px 10px;font-family:\'DM Mono\',monospace;font-weight:700;font-size:11px;color:' + (r.canFull ? 'var(--green)' : 'var(--red)') + '">' + freeROBstr + '</td>' +
        '<td style="padding:8px 10px;font-size:11px;font-family:\'DM Mono\',monospace;white-space:nowrap">' + fmt24(r.freeFrom) + '</td>' +
        '<td style="padding:8px 10px;font-size:11px;text-align:center">' + travelHrs + 'h</td>' +
        '<td style="padding:8px 10px;text-align:center"><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:' + (r.canFullyAtRequest ? 'var(--green-lt)' : r.canFull ? 'var(--amber-lt)' : 'var(--red-lt)') + ';color:' + (r.canFullyAtRequest ? 'var(--green)' : r.canFull ? 'var(--amber)' : 'var(--red)') + ';border:1px solid ' + (r.canFullyAtRequest ? 'var(--green-bd)' : r.canFull ? 'var(--amber-bd)' : 'var(--red-bd)') + '">' + (r.canFullyAtRequest ? 'YES' : r.canFull ? 'DELAYED' : 'NO') + '</span></td>' +
        '<td style="padding:8px 10px;text-align:center"><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:' + (splitCap ? 'var(--azure-lt)' : 'var(--red-lt)') + ';color:' + (splitCap ? 'var(--azure)' : 'var(--red)') + ';border:1px solid ' + (splitCap ? 'var(--azure-bd)' : 'var(--red-bd)') + '">' + (splitCap ? 'YES' : 'NO') + '</span></td>' +
        '<td style="padding:8px 10px"><span style="font-size:10px;font-weight:700;color:' + statusC + '">' + statusL + '</span></td>' +
        '</tr>';
    }).join('') +
    '</tbody></table></div></div>';

  /* ──────────────────────────────────────────────────────────────────
     PHASE 13 SECTION 2 — FEASIBILITY SUMMARY TABLE
     ────────────────────────────────────────────────────────────────── */
  var checkSingleBarge = feasibleAtRequested.length > 0 || constrainedAtRequested.length > 0;
  var checkAltBarge    = checkSingleBarge && bargeResults.length > 1; // covered in step 1 (all evaluated)
  var checkGapUtil     = anyGapFeasible;
  var checkSplit       = !!splitResult;
  var checkBerth       = checkSplit && splitResult && splitResult.berthOk !== false;
  var checkROB         = bargeResults.some(function (r) { return r.canFull; });
  var checkPlanImpact  = bargeResults.every(function (r) {
    // No committed op is delayed = planned supply impact passes
    return !r.requestedGap || r.requestedGap.constraintReasons.length === 0;
  });

  function _fRow(label, pass, note) {
    var c = pass ? 'var(--green)' : 'var(--red)';
    var bg = pass ? 'var(--green-lt)' : 'var(--red-lt)';
    var bd = pass ? 'var(--green-bd)' : 'var(--red-bd)';
    return '<tr style="border-bottom:1px solid var(--border2)">' +
      '<td style="padding:7px 12px;font-size:12px;color:var(--ink);font-weight:600">' + label + '</td>' +
      '<td style="padding:7px 12px;text-align:center"><span style="font-size:10px;font-weight:700;padding:2px 10px;border-radius:4px;background:' + bg + ';color:' + c + ';border:1px solid ' + bd + '">' + (pass ? 'PASS' : 'FAIL') + '</span></td>' +
      (note ? '<td style="padding:7px 12px;font-size:11px;color:var(--sub)">' + esc(note) + '</td>' : '<td></td>') +
      '</tr>';
  }

  html += '<div style="margin-bottom:16px">' +
    '<div style="font-size:10px;font-weight:700;color:var(--sub);letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">Feasibility Summary</div>' +
    '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;background:var(--surface);border-radius:10px;border:none;box-shadow:var(--sh-sm);overflow:hidden">' +
    '<thead><tr style="background:var(--ink-solid)">' +
    '<th style="padding:8px 12px;text-align:left;font-size:9px;font-weight:700;color:rgba(255,255,255,.82);letter-spacing:.07em;text-transform:uppercase">Check</th>' +
    '<th style="padding:8px 12px;text-align:center;font-size:9px;font-weight:700;color:rgba(255,255,255,.82);letter-spacing:.07em;text-transform:uppercase">Result</th>' +
    '<th style="padding:8px 12px;text-align:left;font-size:9px;font-weight:700;color:rgba(255,255,255,.82);letter-spacing:.07em;text-transform:uppercase">Note</th>' +
    '</tr></thead><tbody>' +
    _fRow('Single Barge', checkSingleBarge, checkSingleBarge ? 'At least one barge can supply fully at requested time' : 'No single barge can supply fully at requested time') +
    _fRow('Alternative Barge', checkAltBarge || checkSingleBarge, bargeResults.length > 1 ? 'All barges evaluated' : 'Only one barge in fleet') +
    _fRow('Gap Utilisation', checkGapUtil, checkGapUtil ? 'Feasible window found — may be delayed' : 'No gap fits the job on any barge') +
    _fRow('Split Supply', checkSplit, checkSplit ? (splitResult ? splitResult.summary : 'Split supply option found') : 'No viable split supply combination') +
    _fRow('Berth Constraint', !checkSplit || checkBerth, checkSplit ? 'One barge alongside at a time — sequenced correctly' : 'N/A') +
    _fRow('ROB Constraint', checkROB, checkROB ? 'At least one barge has sufficient stock' : 'ALL barges are short on stock') +
    _fRow('Planned Supply Impact', checkPlanImpact, checkPlanImpact ? 'No committed supplies delayed' : 'Some operations may be constrained — review schedule') +
    '</tbody></table></div></div>';

  /* ──────────────────────────────────────────────────────────────────
     PHASE 13 SECTION 3 — MAIN VERDICT CARD
     ────────────────────────────────────────────────────────────────── */

  /* ─── Case A: FEASIBLE at requested time (single barge) ─── */
  var goodList = feasibleAtRequested.length ? feasibleAtRequested : constrainedAtRequested;

  if (goodList.length) {
    var best    = goodList[0];
    var ga      = best.requestedGap;
    var fColor  = ga.feasibility === 'feasible' ? 'var(--green)' : 'var(--amber)';
    var fBg     = ga.feasibility === 'feasible' ? 'var(--green-lt)' : 'var(--amber-lt)';
    var fBd     = ga.feasibility === 'feasible' ? 'var(--green-bd)' : 'var(--amber-bd)';
    var gapTypeLbl = ga.gap.type === 'between'      ? 'Feasible between scheduled operations'
                   : ga.gap.type === 'before_first' ? 'Feasible before first scheduled operation'
                   : ga.gap.type === 'after_last'   ? 'Feasible after last scheduled operation'
                   : 'Barge fully available';

    html += '<div style="background:' + fBg + ';border:2px solid ' + fBd + ';border-radius:12px;padding:16px 18px;margin-bottom:14px">' +
      '<div style="font-size:14px;font-weight:700;color:' + fColor + ';margin-bottom:12px">✓ Requested Time is Feasible — ' + esc(best.b.name) + '</div>' +
      '<div style="margin-bottom:10px;display:inline-flex;align-items:center;gap:8px;background:var(--surface);border:1.5px solid ' + fBd + ';border-radius:7px;padding:6px 12px">' +
      '<span style="font-size:12px;font-weight:700;color:' + fColor + '">' + gapTypeLbl + '</span></div>' +
      (ga.gap.type === 'between' ? '<div style="font-size:11.5px;color:var(--sub);margin-top:5px">Gap window: <strong>' + fmt24(ga.gap.gapStart) + '</strong> → <strong>' + fmt24(ga.gap.gapEnd) + '</strong> (' + ga.gap.gapHrs.toFixed(1) + ' hrs)</div>' : '') +
      (ga.gap.prevOp ? '<div style="font-size:11.5px;color:var(--sub);margin-top:3px">After: <strong>' + esc(ga.gap.prevOp.vessel) + '</strong> ETC ' + fmt24(ga.gap.prevOp.etc) + '</div>' : '') +
      (ga.gap.nextOp ? '<div style="font-size:11.5px;color:var(--sub);margin-top:3px">Before: <strong>' + esc(ga.gap.nextOp.vessel) + '</strong> ETA ' + fmt24(ga.gap.nextOp.start) + '</div>' : '') +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px;margin-bottom:12px">' +
      '<div class="rob-stat"><div class="rob-stat-label">Supply Start</div><div class="rob-stat-val" style="font-size:11px;color:' + fColor + '">' + fmt24(ga.startTime) + '</div></div>' +
      '<div class="rob-stat"><div class="rob-stat-label">ETC</div><div class="rob-stat-val" style="font-size:11px;color:' + fColor + '">' + fmt24(ga.etcTime) + '</div></div>' +
      '<div class="rob-stat"><div class="rob-stat-label">Duration</div><div class="rob-stat-val" style="font-size:12px">' + durStr(best.jobDurationHrs) + '</div></div>' +
      '<div class="rob-stat"><div class="rob-stat-label">Gap Available</div><div class="rob-stat-val" style="font-size:11px">' + (ga.gap.gapHrs === Infinity ? '∞ Open' : ga.gap.gapHrs.toFixed(1) + ' hrs') + '</div></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:' + (ga.constraintReasons.length ? '12px' : '0') + '">' +
      (vReq > 0 ? '<div style="background:var(--surface);border:1px solid ' + fBd + ';border-radius:7px;padding:8px 12px"><div style="font-size:10px;font-weight:700;color:var(--sub);letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px">VLSFO After Supply</div><div style="font-size:13px;font-weight:700;color:' + (best.vBelowBuf ? 'var(--red)' : 'var(--green)') + '">' + Math.round(best.robAfterV).toLocaleString() + ' MT</div><div style="font-size:10.5px;color:var(--sub)">Buffer: ' + best.b.vbuf.toLocaleString() + ' MT ' + (best.vBelowBuf ? '<span style="color:var(--red);font-weight:700">Below Buffer</span>' : '<span style="color:var(--green)">OK</span>') + '</div></div>' : '') +
      (mReq > 0 ? '<div style="background:var(--surface);border:1px solid ' + fBd + ';border-radius:7px;padding:8px 12px"><div style="font-size:10px;font-weight:700;color:var(--sub);letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px">MGO After Supply</div><div style="font-size:13px;font-weight:700;color:' + (best.mBelowBuf ? 'var(--red)' : 'var(--green)') + '">' + Math.round(best.robAfterM).toLocaleString() + ' MT</div><div style="font-size:10.5px;color:var(--sub)">Buffer: ' + best.b.mbuf.toLocaleString() + ' MT ' + (best.mBelowBuf ? '<span style="color:var(--red);font-weight:700">Below Buffer</span>' : '<span style="color:var(--green)">OK</span>') + '</div></div>' : '') +
      '</div>' +
      (ga.constraintReasons.length ? '<div style="background:var(--surface);border:1.5px solid ' + fBd + ';border-radius:8px;padding:10px 14px;margin-top:10px"><div style="font-size:10px;font-weight:700;color:' + fColor + ';letter-spacing:.07em;text-transform:uppercase;margin-bottom:6px">Operational Constraints</div>' + ga.constraintReasons.map(function (r) { return '<div style="font-size:12px;color:var(--sub);margin-bottom:3px">• ' + esc(r) + '</div>'; }).join('') + '</div>' : '') +
      '</div>';

    // Other barges also feasible
    var otherGood = goodList.filter(function (r) { return r.b.id !== best.b.id; });
    if (otherGood.length) {
      html += '<div style="font-size:10px;font-weight:700;color:var(--sub);letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">Also feasible at requested time:</div>' +
        '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">' +
        otherGood.map(function (r) {
          var ga2 = r.requestedGap;
          var ac = ga2.feasibility === 'feasible' ? 'var(--green)' : 'var(--amber)';
          var ab = ga2.feasibility === 'feasible' ? 'var(--green-lt)' : 'var(--amber-lt)';
          return '<div style="background:' + ab + ';border:1px solid;border-radius:8px;padding:9px 14px;font-size:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
            '<strong>' + esc(r.b.name) + '</strong>' +
            '<span>' + esc(ga2.gap.label) + '</span>' +
            '<span>→ ETC: ' + fmt24(ga2.etcTime) + '</span>' +
            '<span style="font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:4px;background:' + ac + ';color:#fff">' + ga2.feasibility.toUpperCase() + '</span>' +
            '</div>';
        }).join('') + '</div>';
    }

    // Show blocked barges
    if (blockedAtRequested.length) {
      html += '<div style="background:var(--surface);border:none;box-shadow:var(--sh-xs);border-radius:10px;padding:10px 14px;margin-bottom:14px">' +
        '<div style="font-size:10px;font-weight:700;color:var(--sub);letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px">Other barges — not feasible at requested time:</div>' +
        blockedAtRequested.map(function (r) {
          return '<div style="border-top:1px solid var(--border2);padding:7px 0;font-size:12px">' +
            '<strong style="color:var(--ink)">' + esc(r.b.name) + '</strong> — ' +
            '<span style="color:var(--red)">' + esc(r.blockingReasons[0] || r.stockBlockReason || 'Not available') + '</span>' +
            (r.nearestSlot ? ' &nbsp;→&nbsp; Nearest: <strong style="color:var(--azure)">' + fmt24(r.nearestSlot) + '</strong> (' + esc(r.nearestGap.gap.label) + ')' : '') +
            '</div>';
        }).join('') + '</div>';
    }

  /* ─── Case B: SPLIT SUPPLY FEASIBLE ─── */
  } else if (isFeasibleViaSplit && splitResult) {
    html += _buildSplitSupplyCard(splitResult, requestedETA, vReq, mReq, travelHrs, hoseHrs);

  /* ─── Case C: DELAYED — nearest feasible slot ─── */
  } else if (isFeasibleDelayed && delayedOption) {
    var dR  = delayedOption.barge;
    var dGa = delayedOption.gap;
    html += '<div style="background:var(--amber-lt);border:2px solid var(--amber-bd);border-radius:12px;padding:16px 18px;margin-bottom:14px">' +
      '<div style="font-size:14px;font-weight:700;color:var(--amber);margin-bottom:10px">⏳ Delayed Start Feasible — ' + esc(dR.b.name) + '</div>' +
      '<div style="font-size:12px;color:var(--sub);margin-bottom:12px">Requested time cannot be met. The earliest feasible slot is shown below. No committed supplies are impacted.</div>' +
      (dR.blockingReasons && dR.blockingReasons.length ? '<div style="background:var(--surface);border:1px solid var(--amber-bd);border-radius:8px;padding:10px 14px;margin-bottom:12px"><div style="font-size:10px;font-weight:700;color:var(--amber);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">Why the requested time doesn\'t work</div>' + dR.blockingReasons.map(function (r) { return '<div style="font-size:12px;color:var(--sub);margin-bottom:2px">• ' + esc(r) + '</div>'; }).join('') + '</div>' : '') +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px">' +
      '<div class="rob-stat"><div class="rob-stat-label">Earliest Feasible</div><div class="rob-stat-val" style="color:var(--amber)">' + fmt24(dGa.eval.earliestStart) + '</div></div>' +
      '<div class="rob-stat"><div class="rob-stat-label">Delay vs Requested</div><div class="rob-stat-val" style="color:var(--amber)">+' + delayedOption.delayHrs.toFixed(1) + ' hrs</div></div>' +
      '<div class="rob-stat"><div class="rob-stat-label">Gap Window</div><div class="rob-stat-val" style="font-size:11px">' + esc(dGa.gap.label) + '</div></div>' +
      '</div>' +
      (dGa.gap.prevOp ? '<div style="font-size:11.5px;color:var(--sub);margin-bottom:3px">After: <strong>' + esc(dGa.gap.prevOp.vessel) + '</strong> ETC ' + fmt24(dGa.gap.prevOp.etc) + '</div>' : '') +
      (dGa.gap.nextOp ? '<div style="font-size:11.5px;color:var(--sub)">Before: <strong>' + esc(dGa.gap.nextOp.vessel) + '</strong> ETA ' + fmt24(dGa.gap.nextOp.start) + '</div>' : '') +
      '</div>';

    // Show all barges' nearest slots for comparison
    var allNearest = bargeResults.filter(function (r) { return r.canFull && r.nearestGap; })
      .sort(function (a, b) { return a.nearestGap.eval.earliestStart - b.nearestGap.eval.earliestStart; });
    if (allNearest.length > 1) {
      html += '<div style="background:var(--surface);border:none;box-shadow:var(--sh-xs);border-radius:10px;padding:10px 14px;margin-bottom:14px">' +
        '<div style="font-size:10px;font-weight:700;color:var(--sub);letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px">All barges — nearest feasible windows:</div>' +
        allNearest.map(function (r) {
          var dh = requestedETA ? Math.max(0, (r.nearestGap.eval.earliestStart - requestedETA) / 3600000) : 0;
          return '<div style="border-top:1px solid var(--border2);padding:7px 0;font-size:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
            '<strong>' + esc(r.b.name) + '</strong>' +
            '<span style="color:var(--azure)">' + fmt24(r.nearestGap.eval.earliestStart) + '</span>' +
            (dh > 0.1 ? '<span style="color:var(--amber);font-size:10.5px">+' + dh.toFixed(1) + 'h delay</span>' : '<span style="color:var(--green);font-size:10.5px">On time</span>') +
            '<span style="color:var(--sub);font-size:11px">(' + esc(r.nearestGap.gap.label) + ')</span>' +
            '</div>';
        }).join('') + '</div>';
    }

    // Barges with insufficient stock
    bargeResults.filter(function (r) { return !r.canFull; }).forEach(function (r) {
      html += '<div style="background:var(--surface);border:1.5px solid var(--red-bd);border-radius:10px;padding:12px 14px;margin-bottom:10px">' +
        '<div style="font-size:12px;font-weight:700;color:var(--red);margin-bottom:4px">' + esc(r.b.name) + ' — Insufficient Stock</div>' +
        '<div style="font-size:12px;color:var(--sub)">' + esc(r.stockBlockReason) + '</div>' +
        '</div>';
    });

  /* ─── Case D: TRULY NOT FEASIBLE ─── */
  } else {
    html += '<div style="background:var(--red-lt);border:2px solid var(--red-bd);border-radius:12px;padding:16px 18px;margin-bottom:14px">' +
      '<div style="font-size:14px;font-weight:700;color:var(--red);margin-bottom:8px">✗ Not Feasible — All Options Exhausted</div>' +
      '<div style="font-size:12px;color:var(--red);margin-bottom:14px">' +
      (requestedETA ? fmt24(requestedETA) : 'Requested time') + ' cannot be accommodated on any barge. ' +
      'Every scheduling combination, gap, split supply, and rescheduling option has been tested and failed. ' +
      'See full analysis below.</div>';

    bargeResults.forEach(function (r) {
      if (!r.canFull) {
        html += '<div style="background:var(--surface);border:1.5px solid var(--red-bd);border-radius:10px;padding:12px 14px;margin-bottom:10px">' +
          '<div style="font-size:12px;font-weight:700;color:var(--ink);margin-bottom:6px">' + esc(r.b.name) + ' — <span style="color:var(--red)">Stock Insufficient</span></div>' +
          '<div style="font-size:12px;color:var(--sub)">' + esc(r.stockBlockReason) + '</div>' +
          '<div style="font-size:11px;color:var(--muted);margin-top:4px">Action required: arrange barge refuelling before this supply.</div></div>';
        return;
      }

      html += '<div style="background:var(--surface);border:1.5px solid var(--red-bd);border-radius:10px;padding:12px 14px;margin-bottom:10px">' +
        '<div style="font-size:12px;font-weight:700;color:var(--ink);margin-bottom:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
        esc(r.b.name) + '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:var(--red-lt);color:var(--red);border:1px solid var(--red-bd)">BLOCKED</span></div>';

      html += '<div style="margin-bottom:10px"><div style="font-size:10px;font-weight:700;color:var(--red);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">Why blocked:</div>' +
        (r.blockingReasons || []).map(function (reason) {
          return '<div style="font-size:12px;color:var(--sub);display:flex;gap:8px;margin-bottom:3px"><span style="color:var(--red);font-weight:700;flex-shrink:0">✗</span>' + esc(reason) + '</div>';
        }).join('') + '</div>';

      html += '<div style="font-size:10px;font-weight:700;color:var(--sub);letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px">Available windows on this barge:</div>';
      r.gapAnalysis.forEach(function (ga) {
        var isNearest = r.nearestGap && ga === r.nearestGap;
        var gBg   = isNearest ? 'var(--green-lt)' : 'var(--bg)';
        var gBd   = isNearest ? 'var(--green-bd)' : 'var(--border)';
        var gColor = isNearest ? 'var(--green)' : 'var(--sub)';
        html += '<div style="background:' + gBg + ';border:1.5px solid ' + gBd + ';border-radius:8px;padding:10px 12px;margin-bottom:6px">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">' +
          (isNearest ? '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:var(--green);color:#fff">★ NEAREST</span>' : '') +
          '<span style="font-size:11px;font-weight:700;color:' + gColor + '">' + esc(ga.gap.label) + '</span>' +
          '<span style="font-size:10px;color:var(--muted)">Available: ' + (ga.gap.gapHrs === Infinity ? 'Open-ended' : ga.gap.gapHrs.toFixed(1) + ' hrs') + '</span>' +
          (ga.gap.prevOp ? '<span style="font-size:10px;color:var(--muted)">After ' + esc(ga.gap.prevOp.vessel) + ' ETC ' + fmt24(ga.gap.prevOp.etc) + '</span>' : '') +
          (ga.gap.nextOp ? '<span style="font-size:10px;color:var(--muted)">Before ' + esc(ga.gap.nextOp.vessel) + ' ETA ' + fmt24(ga.gap.nextOp.start) + '</span>' : '') +
          '</div>';
        if (ga.eval.fits) {
          var delayHrs = requestedETA ? Math.max(0, (ga.eval.earliestStart - requestedETA) / 3600000) : 0;
          var fromNow  = (ga.eval.earliestStart.getTime() - now.getTime()) / 3600000;
          html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px">' +
            '<div class="rob-stat"><div class="rob-stat-label">Earliest Start</div><div class="rob-stat-val" style="font-size:11px;color:' + gColor + '">' + fmt24(ga.eval.earliestStart) + '</div><div class="rob-stat-sub">' + (fromNow <= 0.1 ? 'Now' : fromNow.toFixed(1) + ' hrs from now') + '</div></div>' +
            '<div class="rob-stat"><div class="rob-stat-label">ETC</div><div class="rob-stat-val" style="font-size:11px">' + fmt24(ga.etcTime) + '</div></div>' +
            '<div class="rob-stat"><div class="rob-stat-label">Delay vs Requested</div><div class="rob-stat-val" style="color:' + (delayHrs > 0 ? 'var(--amber)' : 'var(--green)') + '">' + (delayHrs > 0 ? '+' + delayHrs.toFixed(1) + ' hrs' : 'On time') + '</div></div>' +
            '<div class="rob-stat"><div class="rob-stat-label">Status</div><div class="rob-stat-val" style="font-size:10px">' + (ga.constraintReasons.length ? '<span style="color:var(--amber)">Constrained</span>' : '<span style="color:var(--green)">Clear</span>') + '</div></div>' +
            '</div>';
          if (ga.constraintReasons.length) {
            html += '<div style="font-size:11px;color:var(--amber);margin-top:5px">' + esc(ga.constraintReasons[0]) + '</div>';
          }
        } else {
          html += '<div style="font-size:11.5px;color:var(--red)">' + esc(ga.eval.reason) + '</div>';
        }
        html += '</div>';
      });

      html += '</div>';
    });
    html += '</div>';
  }

  /* ──────────────────────────────────────────────────────────────────
     PHASE 13 SECTION 4 — COMPLETE WINDOW ANALYSIS TABLE
     (all barges, all ROB, nearest slots)
     ────────────────────────────────────────────────────────────────── */
  html += '<div style="margin-top:8px">' +
    '<div style="font-size:10px;font-weight:700;color:var(--sub);letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px">' +
    'Complete Window Analysis — All Barges' + (requestedETA ? ' at ' + fmt24(requestedETA) : '') + '</div>' +
    '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;background:var(--surface);border-radius:10px;overflow:hidden;border:none;box-shadow:var(--sh-sm)">' +
    '<thead><tr style="background:linear-gradient(135deg,var(--ink-solid),var(--navy2))">' +
    ['Barge', 'Live VLSFO', 'Planned Ops', 'Available VLSFO', 'Live MGO', 'Planned MGO', 'Available MGO', 'Stock OK?', 'Requested Slot', 'Nearest Feasible', 'ROB After V', 'ROB After M', 'Verdict'].map(function (h) {
      return '<th style="color:rgba(255,255,255,.8);padding:8px 10px;text-align:left;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap">' + h + '</th>';
    }).join('') + '</tr></thead><tbody>' +
    bargeResults.map(function (r, i) {
      var ga3       = r.requestedGap;
      var nearest3  = r.nearestGap;
      var delayHrs3 = requestedETA && nearest3 ? Math.max(0, (nearest3.eval.earliestStart - requestedETA) / 3600000) : 0;
      var verd      = !r.canFull ? 'No Stock' : r.requestedFeasible ? (ga3 && ga3.feasibility === 'feasible' ? 'Feasible' : 'Constrained') : (nearest3 ? 'Delayed' : 'No Window');
      var vC        = !r.canFull ? 'var(--red)' : r.requestedFeasible ? (ga3 && ga3.feasibility === 'feasible' ? 'var(--green)' : 'var(--amber)') : nearest3 ? 'var(--amber)' : 'var(--red)';
      var vBG       = !r.canFull ? 'var(--red-lt)' : r.requestedFeasible ? (ga3 && ga3.feasibility === 'feasible' ? 'var(--green-lt)' : 'var(--amber-lt)') : nearest3 ? 'var(--amber-lt)' : 'var(--red-lt)';
      var rowBg     = i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)';
      return '<tr style="border-bottom:1px solid var(--border2);background:' + rowBg + '">' +
        '<td style="padding:8px 10px;font-weight:700;white-space:nowrap">' + esc(r.b.name) + '</td>' +
        '<td style="padding:8px 10px;font-family:\'DM Mono\',monospace;font-size:11px;color:var(--azure)">' + Math.round(r.liveRv).toLocaleString() + ' MT</td>' +
        '<td style="padding:8px 10px;font-size:11px;color:' + (r.totalPlannedV > 0 ? 'var(--amber)' : 'var(--muted)') + '">' + (r.totalPlannedV > 0 && vReq > 0 ? '−' + Math.round(r.totalPlannedV).toLocaleString() + ' MT' : '—') + '</td>' +
        '<td style="padding:8px 10px;font-family:\'DM Mono\',monospace;font-weight:700;font-size:11px;color:' + (r.canV || vReq === 0 ? 'var(--green)' : 'var(--red)') + '">' + Math.round(r.availRv).toLocaleString() + ' MT</td>' +
        '<td style="padding:8px 10px;font-family:\'DM Mono\',monospace;font-size:11px;color:var(--teal)">' + Math.round(r.liveRm).toLocaleString() + ' MT</td>' +
        '<td style="padding:8px 10px;font-size:11px;color:' + (r.totalPlannedM > 0 ? 'var(--amber)' : 'var(--muted)') + '">' + (r.totalPlannedM > 0 && mReq > 0 ? '−' + Math.round(r.totalPlannedM).toLocaleString() + ' MT' : '—') + '</td>' +
        '<td style="padding:8px 10px;font-family:\'DM Mono\',monospace;font-weight:700;font-size:11px;color:' + (r.canM || mReq === 0 ? 'var(--teal)' : 'var(--red)') + '">' + Math.round(r.availRm).toLocaleString() + ' MT</td>' +
        '<td style="padding:8px 10px;text-align:center"><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:' + (r.canFull ? 'var(--green-lt)' : 'var(--red-lt)') + ';color:' + (r.canFull ? 'var(--green)' : 'var(--red)') + ';border:1px solid ' + (r.canFull ? 'var(--green-bd)' : 'var(--red-bd)') + '">' + (r.canFull ? '✓ Yes' : '✗ No') + '</span></td>' +
        '<td style="padding:8px 10px;text-align:center" title="' + (!r.requestedFeasible && r.blockingReasons && r.blockingReasons.length ? esc(r.blockingReasons.join(' | ')) : '') + '"><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:' + (r.requestedFeasible ? 'var(--green-lt)' : 'var(--red-lt)') + ';color:' + (r.requestedFeasible ? 'var(--green)' : 'var(--red)') + ';border:1px solid ' + (r.requestedFeasible ? 'var(--green-bd)' : 'var(--red-bd)') + '">' + (r.requestedFeasible ? '✓ Fits' : '✗ Blocked') + '</span></td>' +
        '<td style="padding:8px 10px;font-size:11px;font-family:\'DM Mono\',monospace;white-space:nowrap">' + (nearest3 ? fmt24(nearest3.eval.earliestStart) + (delayHrs3 > 0.1 ? '<br><span style="font-size:9px;color:var(--amber)">+' + delayHrs3.toFixed(1) + 'h delay</span>' : '<br><span style="font-size:9px;color:var(--green)">✓ On time</span>') : '<span style="color:var(--red);font-size:11px">No slot</span>') + '</td>' +
        '<td style="padding:8px 10px;font-weight:700;font-size:11px;color:' + (r.vBelowBuf ? 'var(--red)' : 'var(--green)') + ';font-family:\'DM Mono\',monospace;white-space:nowrap">' + (vReq > 0 ? Math.round(r.robAfterV).toLocaleString() + ' MT' : '—') + '</td>' +
        '<td style="padding:8px 10px;font-weight:700;font-size:11px;color:' + (r.mBelowBuf ? 'var(--red)' : 'var(--teal)') + ';font-family:\'DM Mono\',monospace;white-space:nowrap">' + (mReq > 0 ? Math.round(r.robAfterM).toLocaleString() + ' MT' : '—') + '</td>' +
        '<td style="padding:8px 10px"><span style="font-size:11px;font-weight:700;padding:4px 10px;border-radius:5px;background:' + vBG + ';color:' + vC + ';white-space:nowrap">' + verd + '</span></td>' +
        '</tr>';
    }).join('') +
    '</tbody></table></div></div>';

  /* ──────────────────────────────────────────────────────────────────
     BUILD NOMINATION PLAN — used by the "Add Nomination" button so the
     vessel can be pushed straight into the Nominations page with the
     correct barge(s) and quantities already worked out by the engine.
     For split supply this becomes multiple nomination entries, one
     per contributing barge, each carrying only that barge's share.
     Built BEFORE the Final Decision HTML below, which reads it to decide
     whether to render the button (it used to be built after, so the
     button never appeared there).
     ────────────────────────────────────────────────────────────────── */
  var nominationPlan = null;
  if (goodList.length) {
    var nb = goodList[0];
    nominationPlan = {
      mode: 'single',
      entries: [{
        bargeId: nb.b.id, bargeName: nb.b.name,
        vQty: vReq, mQty: mReq,
        eta: nb.requestedGap.startTime
      }]
    };
  } else if (isFeasibleViaSplit && splitResult) {
    var sEntries = [];
    if (splitResult.type === 'partial_mgo') {
      sEntries.push({ bargeId: splitResult.vBarge.b.id, bargeName: splitResult.vBarge.b.name, vQty: vReq, mQty: splitResult.vOnlyMgo, eta: splitResult.vStart });
      if (splitResult.remainMgo > 0) sEntries.push({ bargeId: splitResult.mBarge.b.id, bargeName: splitResult.mBarge.b.name, vQty: 0, mQty: splitResult.remainMgo, eta: splitResult.mFreeAt });
    } else if (splitResult.type === 'vlsfo_split') {
      sEntries.push({ bargeId: splitResult.firstR.b.id, bargeName: splitResult.firstR.b.name, vQty: splitResult.firstQty, mQty: 0, eta: splitResult.firstStart });
      sEntries.push({ bargeId: splitResult.secondR.b.id, bargeName: splitResult.secondR.b.name, vQty: splitResult.secondQty, mQty: 0, eta: splitResult.secondStart });
    } else if (splitResult.type === 'mgo_split') {
      sEntries.push({ bargeId: splitResult.firstR.b.id, bargeName: splitResult.firstR.b.name, vQty: 0, mQty: splitResult.firstQty, eta: splitResult.firstStart });
      sEntries.push({ bargeId: splitResult.secondR.b.id, bargeName: splitResult.secondR.b.name, vQty: 0, mQty: splitResult.secondQty, eta: splitResult.secondStart });
    } else if (splitResult.type === 'vlsfo_sts') {
      // Only the recipient barge actually supplies the vessel — the donor's
      // STS transfer is an internal step, not a vessel supply entry.
      sEntries.push({ bargeId: splitResult.recipient.b.id, bargeName: splitResult.recipient.b.name, vQty: splitResult.vReq, mQty: 0, eta: splitResult.supplyStart, stsNote: splitResult.donor.b.name + ' transferred ' + Math.round(splitResult.transferAmt).toLocaleString() + ' MT VLSFO in first' });
    } else if (splitResult.type === 'mgo_sts') {
      sEntries.push({ bargeId: splitResult.recipient.b.id, bargeName: splitResult.recipient.b.name, vQty: 0, mQty: splitResult.mReq, eta: splitResult.supplyStart, stsNote: splitResult.donor.b.name + ' transferred ' + Math.round(splitResult.transferAmt).toLocaleString() + ' MT MGO in first' });
    } else { // standard / standard_after_ops — one fuel each
      var fIsV = splitResult.firstFuel === 'VLSFO';
      var sIsV = splitResult.secondFuel === 'VLSFO';
      sEntries.push({ bargeId: splitResult.firstR.b.id, bargeName: splitResult.firstR.b.name, vQty: fIsV ? splitResult.firstQty : 0, mQty: !fIsV ? splitResult.firstQty : 0, eta: splitResult.firstStart });
      sEntries.push({ bargeId: splitResult.secondR.b.id, bargeName: splitResult.secondR.b.name, vQty: sIsV ? splitResult.secondQty : 0, mQty: !sIsV ? splitResult.secondQty : 0, eta: splitResult.secondStart });
    }
    nominationPlan = { mode: 'split', entries: sEntries };
  } else if (isFeasibleDelayed && delayedOption) {
    nominationPlan = {
      mode: 'delayed',
      entries: [{
        bargeId: delayedOption.barge.b.id, bargeName: delayedOption.barge.b.name,
        vQty: vReq, mQty: mReq,
        eta: delayedOption.earliest
      }]
    };
  }

  /* ──────────────────────────────────────────────────────────────────
     PHASE 13 SECTION 5 — FINAL DECISION BLOCK
     ────────────────────────────────────────────────────────────────── */
  var finalStatus, finalColor, finalBg, finalBd, finalReason, finalPlan;

  if (feasibleAtRequested.length) {
    finalStatus = 'FEASIBLE';
    finalColor  = 'var(--green)'; finalBg = 'var(--green-lt)'; finalBd = 'var(--green-bd)';
    var fb = feasibleAtRequested[0];
    finalReason = fb.b.name + (requestedETA
      ? ' can supply fully at the requested time of ' + fmt24(requestedETA) + '. No committed ops are delayed.'
      : ' can supply fully at the earliest available time (no ETA given). No committed ops are delayed.');
    finalPlan   = fb.b.name + ' — alongside at ' + fmt24(fb.requestedGap.startTime) + ', ETC ' + fmt24(fb.requestedGap.etcTime) + '.' +
      (vReq > 0 ? ' VLSFO: ' + vReq.toLocaleString() + ' MT.' : '') +
      (mReq > 0 ? ' MGO: ' + mReq.toLocaleString() + ' MT.' : '') +
      ' ROB after: ' + (vReq > 0 ? Math.round(fb.robAfterV).toLocaleString() + ' MT VLSFO' : '') + (mReq > 0 && vReq > 0 ? ' / ' : '') + (mReq > 0 ? Math.round(fb.robAfterM).toLocaleString() + ' MT MGO' : '') + '.';
  } else if (constrainedAtRequested.length) {
    finalStatus = 'FEASIBLE WITH CONSTRAINTS';
    finalColor  = 'var(--amber)'; finalBg = 'var(--amber-lt)'; finalBd = 'var(--amber-bd)';
    var fb2 = constrainedAtRequested[0];
    finalReason = fb2.b.name + ' can supply at the requested time with minor constraints (buffer or overlap tolerance applied).';
    finalPlan   = fb2.b.name + ' — alongside at ' + fmt24(fb2.requestedGap.startTime) + ', ETC ' + fmt24(fb2.requestedGap.etcTime) + '. Review buffer levels before confirming.';
  } else if (isFeasibleViaSplit && splitResult) {
    finalStatus = 'SPLIT SUPPLY FEASIBLE';
    finalColor  = 'var(--amber)'; finalBg = 'var(--amber-lt)'; finalBd = 'var(--amber-bd)';
    finalReason = 'No single barge can complete the full supply at the requested time. A coordinated two-barge split supply is feasible.';
    finalPlan   = splitResult.plan || 'See split supply card above for barge allocation and timeline.';
  } else if (isFeasibleDelayed && delayedOption) {
    finalStatus = 'DELAYED START FEASIBLE';
    finalColor  = 'var(--amber)'; finalBg = 'var(--amber-lt)'; finalBd = 'var(--amber-bd)';
    var dBarge = delayedOption.barge;
    finalReason = 'Requested time cannot be met. ' + dBarge.b.name + ' is available ' + delayedOption.delayHrs.toFixed(1) + 'h after the requested time with no impact on committed ops.';
    finalPlan   = dBarge.b.name + ' — earliest alongside: ' + fmt24(delayedOption.earliest) + '. ETC: ' + fmt24(delayedOption.gap.etcTime) + '. Delay: +' + delayedOption.delayHrs.toFixed(1) + 'h.';
  } else {
    finalStatus = 'NOT FEASIBLE';
    finalColor  = 'var(--red)'; finalBg = 'var(--red-lt)'; finalBd = 'var(--red-bd)';
    var stockIssues = bargeResults.filter(function (r) { return !r.canFull; });
    var timingIssues = bargeResults.filter(function (r) { return r.canFull && !r.nearestGap; });
    finalReason = 'All scheduling options have been exhausted. ' +
      (stockIssues.length ? stockIssues.map(function (r) { return r.b.name + ' insufficient stock'; }).join('; ') + '. ' : '') +
      (timingIssues.length ? 'No scheduling window available on remaining barges.' : '');
    finalPlan = 'Actions required: ' +
      (stockIssues.length ? 'Arrange refuelling for ' + stockIssues.map(function (r) { return r.b.name; }).join(', ') + '. ' : '') +
      'Review vessel ETA or negotiate a revised supply window with the vessel operator.';
  }

  html += '<div style="margin-top:16px;background:' + finalBg + ';border:2px solid ' + finalBd + ';border-radius:12px;padding:16px 18px">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:8px">' +
    '<div style="font-size:10px;font-weight:700;color:' + finalColor + ';letter-spacing:.09em;text-transform:uppercase">Final Decision</div>' +
    (nominationPlan ? '<button onclick="addNominationFromNSC(\'__NSC_CHECK_ID__\')" style="display:flex;align-items:center;gap:6px;padding:7px 14px;background:' + finalColor + ';color:#fff;border:none;border-radius:7px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:\'DM Sans\',sans-serif"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' + (nominationPlan.mode === 'split' ? 'Add ' + nominationPlan.entries.length + ' Nominations for This Plan' : 'Add Nomination for This Plan') + '</button>' : '') +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap">' +
    '<span style="font-size:15px;font-weight:800;color:' + finalColor + ';letter-spacing:.04em">' + finalStatus + '</span>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr;gap:10px">' +
    '<div style="background:var(--surface);border:1px solid ' + finalBd + ';border-radius:8px;padding:10px 14px">' +
    '<div style="font-size:10px;font-weight:700;color:' + finalColor + ';letter-spacing:.07em;text-transform:uppercase;margin-bottom:5px">Reason</div>' +
    '<div style="font-size:12px;color:var(--sub)">' + esc(finalReason) + '</div>' +
    '</div>' +
    '<div style="background:var(--surface);border:1px solid ' + finalBd + ';border-radius:8px;padding:10px 14px">' +
    '<div style="font-size:10px;font-weight:700;color:' + finalColor + ';letter-spacing:.07em;text-transform:uppercase;margin-bottom:5px">Recommended Plan</div>' +
    '<div style="font-size:12px;color:var(--ink);font-weight:600">' + esc(finalPlan) + '</div>' +
    '</div>' +
    '</div></div>';

  /* ──────────────────────────────────────────────────────────────────
     RANGE WINDOW CHECK — only when the user picked a Date Range instead
     of a single ETA. Doesn't change any of the feasibility maths above
     (which already ran using the range START as the request time); this
     just reports, per barge, whether the earliest slot found actually
     falls inside the chosen window or spills past its end. ────────────
     ────────────────────────────────────────────────────────────────── */
  if (rangeEndETA) {
    html += '<div style="margin-bottom:16px">' +
      '<div style="font-size:10px;font-weight:700;color:var(--sub);letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">Window Check — ' + fmt24(requestedETA) + ' &rarr; ' + fmt24(rangeEndETA) + '</div>' +
      '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11.5px;background:var(--surface);border-radius:10px;overflow:hidden;border:none;box-shadow:var(--sh-sm)">' +
      '<thead><tr style="background:var(--ink-solid)">' +
      ['Barge', 'Earliest Feasible Slot', 'Within Window'].map(function (h) {
        return '<th style="color:rgba(255,255,255,.82);padding:8px 10px;text-align:left;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap">' + h + '</th>';
      }).join('') + '</tr></thead><tbody>' +
      bargeResults.map(function (r, i) {
        var rowBg = i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)';
        var slot  = r.canFull ? (r.nearestSlot || null) : null;
        var within = slot ? (slot <= rangeEndETA) : false;
        var slotLabel = !r.canFull ? 'Insufficient stock' : slot ? fmt24(slot) : 'No feasible slot found';
        var badge = (slot && within)
          ? '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:var(--green-lt);color:var(--green);border:1px solid var(--green-bd)">YES</span>'
          : '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:var(--red-lt);color:var(--red);border:1px solid var(--red-bd)">' + (slot ? 'AFTER WINDOW' : 'NO') + '</span>';
        return '<tr style="border-bottom:1px solid var(--border2);background:' + rowBg + '">' +
          '<td style="padding:8px 10px;font-weight:700;white-space:nowrap">' + esc(r.b.name) + '</td>' +
          '<td style="padding:8px 10px;font-family:\'DM Mono\',monospace;font-size:11px;white-space:nowrap">' + slotLabel + '</td>' +
          '<td style="padding:8px 10px">' + badge + '</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<div style="font-size:11px;color:var(--muted);margin-top:6px">Checked against the earliest feasible slot per barge; a slot after the window end still means the barge needs the vessel to wait beyond the requested range.</div>' +
      '</div>';
  }

  /* ──────────────────────────────────────────────────────────────────
     PERSIST AS CARD
     ────────────────────────────────────────────────────────────────── */
  var checkId  = 'nsc_' + Date.now();
  html = html.split('__NSC_CHECK_ID__').join(checkId);
  var topStatus = overallFeasible
    ? (anyFeasibleAtRequested
        ? (feasibleAtRequested.length ? 'Feasible' : 'Feasible with Constraints')
        : isFeasibleViaSplit ? 'Split Supply Feasible' : 'Delayed Start Feasible')
    : 'Not Feasible';
  var topColor  = overallFeasible
    ? (feasibleAtRequested.length ? 'var(--green)' : 'var(--amber)')
    : 'var(--red)';

  var card = document.createElement('div');
  card.id = checkId;
  card.style.cssText = 'background:var(--surface);border:none;border-radius:var(--radius);margin-bottom:14px;box-shadow:var(--sh-sm);overflow:hidden;';
  card.innerHTML =
    '<div style="background:linear-gradient(135deg,var(--ink-solid),var(--navy2));padding:12px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
    '<div style="flex:1;min-width:0">' +
    '<div style="font-size:13px;font-weight:700;color:#fff;font-family:DM Sans,sans-serif">' + esc(vesselName) + '</div>' +
    '<div style="font-size:11px;color:rgba(255,255,255,.55);margin-top:2px;font-family:\'DM Mono\',monospace">' +
    (requestedETA ? fmt24(requestedETA) : 'No ETA') + ' &nbsp;|&nbsp; ' +
    (vReq > 0 ? 'VLSFO ' + vReq.toLocaleString() + ' MT ' : '') +
    (mReq > 0 ? 'MGO ' + mReq.toLocaleString() + ' MT' : '') +
    ' &nbsp;|&nbsp; Checked: ' + fmt24(new Date()) + '</div></div>' +
    '<span style="font-size:11px;font-weight:700;padding:4px 12px;border-radius:6px;background:' + topColor + ';color:#fff;white-space:nowrap">' + topStatus + '</span>' +
    '<div style="display:flex;gap:6px;flex-shrink:0">' +
    (nominationPlan ? '<button onclick="addNominationFromNSC(\'' + checkId + '\')" style="display:flex;align-items:center;gap:6px;padding:6px 12px;background:var(--green);color:#fff;border:1px solid var(--green);border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:\'DM Sans\',sans-serif"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' + (nominationPlan.mode === 'split' ? 'Add ' + nominationPlan.entries.length + ' Nominations' : 'Add Nomination') + '</button>' : '') +
    '<button onclick="deleteNSCCheck(\'' + checkId + '\')" style="padding:6px 10px;background:rgba(255,255,255,.12);color:rgba(255,255,255,.8);border:1px solid rgba(255,255,255,.2);border-radius:6px;font-size:11px;cursor:pointer;font-family:\'DM Sans\',sans-serif">✕ Remove</button>' +
    '</div></div>' +
    '<div style="padding:14px 16px">' + html + '</div>';

  card._nscData = {
    vesselName: vesselName, vesselETA: requestedETA ? requestedETA.toISOString() : null, vReq: vReq, mReq: mReq,
    nominationPlan: nominationPlan ? {
      mode: nominationPlan.mode,
      entries: nominationPlan.entries.map(function (e) {
        return { bargeId: e.bargeId, bargeName: e.bargeName, vQty: e.vQty, mQty: e.mQty, eta: e.eta ? e.eta.toISOString() : null };
      })
    } : null
  };
  _nscCheckData[checkId] = card._nscData;

  var inlineEl = document.getElementById('nsc-unified-result');
  if (inlineEl) {
    inlineEl.innerHTML = html;
    inlineEl.className = 'nsc-result show';
    inlineEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  var list = document.getElementById('nsc-checks-list');
  if (list) {
    list.insertBefore(card, list.firstChild);
    var hdrEl = document.getElementById('nsc-checks-header');
    if (hdrEl) hdrEl.style.display = 'block';
  }
}

