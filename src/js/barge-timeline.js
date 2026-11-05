/* ─── NSC UNIFIED MULTI-BARGE CHECKER ─── */
let _nscEtaPicker = null;
let _nscDateMode = 'single'; // 'single' | 'range' — which ETA input mode is active
let _nscRangeStart = null, _nscRangeEnd = null; // set only in range mode

function setNscDateMode(mode) {
  if (mode === _nscDateMode) return;
  _nscDateMode = mode;
  var btnS = document.getElementById('nsc-mode-single');
  var btnR = document.getElementById('nsc-mode-range');
  [btnS, btnR].forEach(function(b){ if(b){ b.style.background='transparent'; b.style.color='var(--sub)'; b.classList.remove('active'); } });
  var active = mode === 'single' ? btnS : btnR;
  if (active) { active.style.background='var(--azure)'; active.style.color='#fff'; active.classList.add('active'); }
  var hint = document.getElementById('nsc-range-hint');
  if (hint) hint.style.display = mode === 'range' ? 'block' : 'none';
  // A flatpickr instance is bound to one mode ('range' vs single); switching
  // modes means the old instance and any stored dates no longer apply.
  if (_nscEtaPicker) { _nscEtaPicker.destroy(); _nscEtaPicker = null; }
  _nscRangeStart = null; _nscRangeEnd = null;
  var inp = document.getElementById('nsc-vessel-eta');
  if (inp) { inp.value = ''; inp.placeholder = mode === 'range' ? 'Select arrival date range…' : 'Select arrival date & time…'; }
}

function openNscEtaPicker() {
  const inp = document.getElementById('nsc-vessel-eta'); if (!inp) return;
  if (_nscEtaPicker) { _nscEtaPicker.open(); return; }

  if (_nscDateMode === 'range') {
    _nscEtaPicker = flatpickr(inp, {
      mode: 'range', enableTime: true, time_24hr: true, dateFormat: 'j M Y H:i',
      allowInput: false, minuteIncrement: 30, disableMobile: true,
      onReady(_, __, fp) { fp.open(); },
      onChange(dates) {
        if (dates.length === 2) {
          _nscRangeStart = dates[0]; _nscRangeEnd = dates[1];
          const f = d => `${pad(d.getDate())} ${MO[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
          inp.value = f(dates[0]) + '  →  ' + f(dates[1]);
        } else {
          _nscRangeStart = null; _nscRangeEnd = null;
        }
      }
    });
  } else {
    _nscEtaPicker = flatpickr(inp, {
      enableTime: true, time_24hr: true, dateFormat: 'j M Y H:i',
      allowInput: false, minuteIncrement: 30, disableMobile: true,
      onReady(_, __, fp) { fp.open(); },
      onChange(dates) {
        if (dates.length === 1) {
          const d = dates[0];
          inp.value = `${pad(d.getDate())} ${MO[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        }
      }
    });
  }
  _nscEtaPicker.open();
}




/*
  ══════════════════════════════════════════════════════════════════════
  BARGE AVAILABILITY & FEASIBILITY ENGINE — v5 (Complete Rebuild)
  ══════════════════════════════════════════════════════════════════════
  DESIGN PHILOSOPHY — Think like an experienced bunker planner:
    • Find a workable solution first — "NOT FEASIBLE" is a last resort
    • Protect existing commitments at all times
    • Maximise barge utilisation — use every gap
    • Never reject because a future commitment exists if the job fits before it
    • Explore every possible scheduling combination before rejecting

  PHASES (per specification):
    1  Data Collection
    2  Calculate True Free Time (ETC of last op + transit — not just "has ops")
    3  Build Timeline (all gaps between commitments are valid opportunities)
    4  Single Barge Check (any one barge can complete the full supply)
    5  Alternative Barge Check (if primary fails, evaluate entire fleet)
    6  Gap Utilisation (supply fits in any free gap between ops)
    7  Split Supply Engine (sequential / staggered / multi-barge splits)
    8  Berth Occupancy (only one barge alongside; second waits for berth)
    9  Smart Rescheduling (alternative sequences, start times, allocations)
   10  Overlap Tolerance (±2 h flexibility if no commitment is missed)
   11  ROB Protection (committed qty reserved; only free ROB allocated)
   12  Feasibility Decision Tree (all 10 steps before any rejection)
   13  Output Format (Barge Analysis table + Feasibility Summary + Final Decision)
  ══════════════════════════════════════════════════════════════════════
*/

/* ─────────────────────────────────────────────────────────────────────
   HELPER: Build the sorted, future-only timeline for a barge
   ───────────────────────────────────────────────────────────────────── */
// includePastUnsaved: also return ops whose ETC has already passed but whose
// supply was never saved (flagged pastEtc:true). Live ROB only deducts SAVED
// supplies, so those quantities are still committed and must stay in the
// ROB-commitment math — but they no longer occupy any future time, so time
// gap / free-window logic must filter them back out.
function _getBargeTimeline(bargeId, bargeName, includePastUnsaved) {
  var now = new Date();
  var cont = _contingencyHrs();

  var ops = (_lastSched || [])
    .filter(function (item) {
      var itemBarge  = (item.bargeLabel || '').trim();
      var targetName = (bargeName || '').trim();
      var singleBarge = (_bargeConfig || []).length === 1;
      var bargeMatch = (itemBarge === targetName) ||
                       (itemBarge === '' && singleBarge) ||
                       (item.bargeId && String(item.bargeId) === String(bargeId));
      if (!bargeMatch) return false;
      var opEtc = item.etc;
      if (!opEtc) return false;
      // Completion is per nomination (nomUid), not vessel name — a vessel
      // supplied once and re-nominated must still occupy its barge.
      if (_isScheduleItemCompleted(item)) return false;
      if (opEtc <= now && !includePastUnsaved) return false; // past ops excluded
      return true;
    })
    .map(function (item) {
      return {
        vessel: item.name,
        nomUid: item.nomUid || null,
        start:  item.bargeStart || item.eta || item.etc,
        etc:    item.etc,
        vQ:     item.vQ || 0,
        mQ:     item.mQ || 0,
        // Nominated (planning) quantity — vQ/mQ are capped at the ROB the
        // scheduler saw, so a short barge's job shows less than it needs.
        nomVQ:  item.nomVQ != null ? item.nomVQ : (item.vQ || 0),
        nomMQ:  item.nomMQ != null ? item.nomMQ : (item.mQ || 0),
        sno:    item.sno,
        pastEtc: item.etc <= now,
        kind:   'vessel',
        // ETC + overrun contingency = when the barge is really free again for
        // planning. The ETC itself stays the scheduler's figure.
        busyUntil: addHrs(item.etc, cont)
      };
    });
  // Unavailable blocks occupy the barge like a job (fixed times, no
  // contingency), so Check Availability never proposes a start inside one
  // and the Loading conflict check sees them too.
  _blocksForBarge(bargeId, bargeName).concat(_transferBlocksForBarge(bargeId, bargeName)).forEach(function (bk) {
    var s = new Date(bk.start), e = new Date(bk.end);
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || e <= now || e <= s) return;
    ops.push(Object.assign({ vessel: 'Unavailable — ' + (bk.reason || 'blocked'), nomUid: null, start: s, etc: e, busyUntil: e,
               vQ: 0, mQ: 0, sno: null, pastEtc: false, kind: 'block', isBlock: true, blockId: bk.id, reason: bk.reason || '' }, bk.transferId ? { transferId: bk.transferId } : {}));
  });
  return ops.sort(function (a, b) { return a.start - b.start; });
}
// End of an op's busy time for gap/conflict maths (ETC + contingency).
function _opBusyEnd(op) { return op.busyUntil || op.etc; }

// A barge transfer keeps BOTH barges busy: for planning it is an Unavailable
// block on each (not listed with the Unavailable blocks, not editable there).
function _transferBlocksForBarge(bargeId, bargeName) {
  let name = bargeName;
  if (!name && bargeId != null) { const b = (_bargeConfig || []).find(function(x) { return String(x.id) === String(bargeId); }); name = b && b.name; }
  if (!name) return [];
  return (_loadingRecords || []).filter(function(r) {
    return r && r.kind === 'transfer' && !r.deletedAt && !r.completed && (r.barge === name || r.fromBarge === name);
  }).map(function(r) {
    return { id: 'xfer_' + r.id, transferId: r.id, bargeName: name, start: r.startAt, end: r.endAt,
      reason: 'Barge transfer ' + r.fromBarge + ' → ' + r.barge + ' · ' + (Number(r.qty) || 0).toLocaleString() + ' MT ' + (r.grade === 'LSMGO' ? 'LSMGO' : 'VLSFO') };
  });
}
function _blocksForBarge(bargeId, bargeName, list) {
  return (list || _bargeBlocks || []).filter(function (bk) {
    if (!bk || bk.deletedAt) return false;
    // By id (survives a rename); legacy/hand-made entries without one by name.
    if (bk.bargeId !== undefined && bk.bargeId !== null && bk.bargeId !== '') return String(bk.bargeId) === String(bargeId);
    return !!bargeName && bk.bargeName === bargeName;
  });
}

/* ─── Free Windows — inverts a barge's commitments (vessel supply, Loading,
   Unavailable blocks) into the gaps between them, with what could honestly
   be offered in each gap:
   • time: gap − travel in (after a job) − travel out (before the next one)
     − hose-up − contingency = usable pumping hours (the same hoseHrs /
     travelHrs the scheduler uses; each job's ETC is padded by the overrun
     contingency first). Vessel-supply rate vtph/mtph, NOT the terminal
     loading rate.
   • stock: available-to-promise = the LOWEST simulated ROB per grade from
     the gap until that grade's next Loading (looking up to 30 days ahead,
     past the week shown), minus the barge's minimum-stock buffer. Fuel
     already promised to a later job is never offered again.
   Overlapping commitments are shown as a Conflict, never re-sequenced.
   Rows: status free | short | busy | unavailable | conflict. ─── */
var FW_MIN_PARCEL_MT = 50;   // below this a gap isn't a sellable parcel
var FW_LOOKAHEAD_DAYS = 30;  // later commitments still claim stock even outside the week shown

/* ─── Barge stock projection — the ONE simulation of a barge's stock that
   Free Windows (available-to-promise) and the reload planner both read, so
   the two can never disagree. Start = live ROB now (supplies, reloads and
   overrides already in it) less committed jobs whose ETC passed but whose
   supply isn't saved yet; then, in start order up to lookEnd: vessel jobs
   (completed ones skipped by _getBargeTimeline), Unavailable blocks and
   planned Loadings. opts.liveROBs: a getAllLiveROBs() result to reuse when
   projecting several barges in one pass. ─── */
// Why an ended-but-uncompleted loading must NOT be added to the stock
// forecast ('' = it counts): its fuel is evidently already in the live ROB,
// or the record is too old to trust. The ROB figure a reload event or an
// ROB Update gives already holds whatever that loading delivered.
var PL_MAX_AGE_HRS = 48;
function _pendingLoadingNotCounted(bargeId, grade, start, end, now) {
  var gk = grade === 'LSMGO' ? 'm' : 'v';
  var ts = function(x) { var n = typeof x === 'number' ? x : new Date(x).getTime(); return isNaN(n) ? -1 : n; };
  var s0 = start.getTime();
  if ((_bargeReloads || []).some(function(rl) { return rl && rl.kind !== 'correction' && String(rl.bargeId) === String(bargeId) && Number(rl[gk]) > 0 && ts(rl.at) >= s0; })) return 'a ' + grade + ' reload was recorded in ROB after it started';
  var fin = (_manualROB || {})[bargeId + '_final'];
  var measured = Math.max(_robMeasuredAt(bargeId, gk), fin ? ts(fin.editedAt) : -1);
  if (measured >= s0) return 'ROB was updated after it started';
  if (now.getTime() - end.getTime() > PL_MAX_AGE_HRS * 3600000) return 'it ended over ' + (PL_MAX_AGE_HRS / 24) + ' days ago';
  return '';
}
function _bargeStockProjection(bargeId, bargeName, lookEnd, opts) {
  var now = new Date();
  var cont = _contingencyHrs();
  var barge = (_bargeConfig || []).find(function(x) { return x.id === bargeId || x.name === bargeName; }) || {};
  // Same minimum-stock buffers the Availability Check protects.
  var vbuf = Math.max(0, Number(barge.vbuf) || 0), mbuf = Math.max(0, Number(barge.mbuf) || 0);
  var liveROBs = (opts && opts.liveROBs) || ((typeof getAllLiveROBs === 'function') ? getAllLiveROBs() : {});
  var liveRob = liveROBs[bargeId] || Object.values(liveROBs).find(function(r) { return r.bargeName === bargeName; }) || {};
  var vcap = liveRob.vcap || 0, mcap = liveRob.mcap || 0;
  var st = { v: liveRob.liveV || 0, m: liveRob.liveM || 0 };

  var items = [], past = [], pre = [];
  var pastBusyEnd = null;
  // A job commits its planning quantity (nominated, top of a range) — not
  // the scheduler's vQ/mQ, which stop at whatever ROB it saw at generation
  // and so hid a shortfall (or a loading planned before the job).
  var qV = function(op) { return op.nomVQ != null ? op.nomVQ : (op.vQ || 0); };
  var qM = function(op) { return op.nomMQ != null ? op.nomMQ : (op.mQ || 0); };
  _getBargeTimeline(bargeId, bargeName, true).forEach(function(op) {
    if (op.pastEtc) {
      // ETC passed but supply not saved: still committed fuel (live ROB
      // hasn't deducted it) and the barge may still be in its contingency.
      var pj = { kind: 'overdue', t: op.start, vessel: op.vessel, nomUid: op.nomUid, nomV: qV(op), nomM: qM(op), start: op.start, end: op.etc };
      past.push(pj); pre.push(pj);
      var pe = _opBusyEnd(op);
      if (!pastBusyEnd || pe > pastBusyEnd) pastBusyEnd = pe;
      return;
    }
    if (op.start >= lookEnd) return;
    if (op.kind === 'block') items.push({ kind: 'block', start: op.start, end: op.etc, busyEnd: op.etc, label: 'Unavailable — ' + (op.reason || 'blocked'), reason: op.reason || '', blockId: op.blockId });
    else items.push({ kind: 'vessel', start: op.start, end: op.etc, busyEnd: _opBusyEnd(op), label: 'Vessel — ' + op.vessel, vessel: op.vessel, nomUid: op.nomUid, sno: op.sno, nomV: qV(op), nomM: qM(op) });
  });
  // A loading whose window has passed but that nobody marked Completed: the
  // plan says the fuel is on board, so it counts from now — until it is marked
  // Completed (then the reload recorded in ROB takes over). Not counted (only
  // flagged) once the ROB evidently already holds it — a reload of that grade
  // recorded after it started, the ROB updated after it started — or when it
  // ended so long ago that a forgotten record would inflate stock forever.
  var pendingLoads = [];
  var bid = barge.id != null ? barge.id : bargeId;
  (_loadingRecords || []).filter(function(r) {
    return r && r.kind !== 'transfer' && !r.deletedAt && !r.completed && _resolveRecordBargeName(r) === bargeName && !isNaN(new Date(r.endAt).getTime()) && new Date(r.endAt) < now;
  }).sort(function(a, b) { return new Date(a.endAt) - new Date(b.endAt); }).forEach(function(r) {
    var q = Number(r.qty) || 0, g = r.grade === 'LSMGO' ? 'LSMGO' : 'VLSFO';
    if (!q) return;
    var en = new Date(r.endAt), st0 = new Date(r.startAt);
    if (isNaN(st0.getTime())) st0 = en;
    var why = _pendingLoadingNotCounted(bid, g, st0, en, now);
    var p = { kind: 'pending', t: en, loadingId: r.id, terminal: r.terminal || '', grade: g, qty: q, start: st0, end: en, counted: !why, why: why };
    pendingLoads.push(p); pre.push(p);
  });
  // Overdue jobs (at their start) and pending loadings (at their end) in the
  // order they happened: a loading that ended before an overdue job topped
  // the tank up BEFORE that job drew on it.
  pre.sort(function(a, b) { return a.t - b.t; });
  function applyPre(p, s) {
    if (p.kind === 'overdue') { s.v = Math.max(0, s.v - p.nomV); s.m = Math.max(0, s.m - p.nomM); }
    else if (p.counted) {
      if (p.grade === 'LSMGO') s.m = mcap ? Math.min(mcap, s.m + p.qty) : s.m + p.qty;
      else s.v = vcap ? Math.min(vcap, s.v + p.qty) : s.v + p.qty;
    }
  }
  pre.forEach(function(p) { applyPre(p, st); });
  (_loadingsForBargeName(bargeName) || []).forEach(function(r) {
    var s = new Date(r.startAt), e = new Date(r.endAt);
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || s >= lookEnd) return;
    items.push({ kind: 'loading', start: s, end: e, busyEnd: addHrs(e, cont), label: 'Loading — ' + (r.terminal || 'Terminal'), terminal: r.terminal || '', loadingId: r.id, grade: r.grade === 'LSMGO' ? 'LSMGO' : 'VLSFO', qty: Number(r.qty) || 0 });
  });
  items.sort(function(a, b) { return (a.start - b.start) || (a.end - b.end); });

  // Vessel supply deducts (at its start — conservative), Loading tops up
  // (capped at tank capacity) at its end.
  function apply(it, s) {
    if (it.kind === 'vessel') { s.v = Math.max(0, s.v - it.nomV); s.m = Math.max(0, s.m - it.nomM); }
    else if (it.kind === 'loading') {
      if (it.grade === 'LSMGO') s.m = mcap ? Math.min(mcap, s.m + it.qty) : s.m + it.qty;
      else s.v = vcap ? Math.min(vcap, s.v + it.qty) : s.v + it.qty;
    }
  }
  // Available-to-promise from items[idx] on: lowest projected ROB per grade
  // until that grade's next Loading (which could refill it), less buffer.
  function atpFrom(idx, v, m) {
    var s = { v: v, m: m }, minV = v, minM = m, stopV = false, stopM = false;
    for (var k = idx; k < items.length && !(stopV && stopM); k++) {
      var it = items[k];
      if (it.kind === 'loading') { if (it.grade === 'LSMGO') stopM = true; else stopV = true; continue; }
      apply(it, s);
      if (!stopV) minV = Math.min(minV, s.v);
      if (!stopM) minM = Math.min(minM, s.m);
    }
    return { v: Math.max(0, minV - vbuf), m: Math.max(0, minM - mbuf), lowV: minV, lowM: minM };
  }
  return { now: now, barge: barge, liveRob: liveRob, pendingLoads: pendingLoads, pre: pre, applyPre: applyPre, vcap: vcap, mcap: mcap, vbuf: vbuf, mbuf: mbuf, cont: cont,
           robNow: { v: liveRob.liveV || 0, m: liveRob.liveM || 0 }, start: { v: st.v, m: st.m },
           past: past, pastBusyEnd: pastBusyEnd, items: items, apply: apply, atpFrom: atpFrom };
}

// opts.liveROBs: passed through to _bargeStockProjection (see there).
function computeFreeWindows(bargeId, bargeName, rangeStart, rangeEnd, opts) {
  var H = 3600000;
  var now = new Date();
  // Never start before "now" — even if the given range begins earlier.
  var cursor0 = (rangeStart && rangeStart > now) ? rangeStart : now;
  var horizonEnd = rangeEnd || new Date(cursor0.getTime() + 7 * 86400000);
  var lookEnd = new Date(Math.max(horizonEnd.getTime(), now.getTime() + FW_LOOKAHEAD_DAYS * 86400000));
  var travel = Math.max(0, Number(_calcParams && _calcParams.travelHrs) || 0);
  var hoseHrs = (_calcParams && _calcParams.hoseHrs != null && !isNaN(Number(_calcParams.hoseHrs))) ? Number(_calcParams.hoseHrs) : 6;

  // Stock simulation shared with the reload planner (_bargeStockForecast).
  var proj = _bargeStockProjection(bargeId, bargeName, lookEnd, opts);
  var cont = proj.cont;
  var barge = proj.barge;
  var vtph = barge.vtph || 300, mtph = barge.mtph || 100;
  var vbuf = proj.vbuf, mbuf = proj.mbuf;
  var liveRob = proj.liveRob;
  var st = { v: proj.start.v, m: proj.start.m };
  var items = proj.items, apply = proj.apply, atpFrom = proj.atpFrom;
  var pastBusyEnd = proj.pastBusyEnd;

  var rows = [];
  function inRange(s, e) { return e > cursor0 && s < horizonEnd; }
  function clipS(d) { return d < cursor0 ? cursor0 : d; }
  function clipE(d) { return d > horizonEnd ? horizonEnd : d; }

  // gs = when the barge is free (null = idle right now), ge = next
  // commitment's start (null = open-ended).
  function pushGap(gs, ge, afterJob, idx) {
    var visStart = new Date(Math.max(gs ? gs.getTime() : now.getTime(), now.getTime()));
    if (ge && ge <= visStart) return;
    var dispStart = clipS(visStart), dispEnd = ge ? clipE(ge) : horizonEnd;
    if (dispEnd <= dispStart) return; // outside the range shown
    // Travel in only after a job (an idle barge is already on station);
    // travel out only if something follows. Usable time is measured over
    // the whole gap, even where it runs past the week shown.
    var effStart = new Date(Math.max(visStart.getTime(), (gs && afterJob) ? gs.getTime() + travel * H : 0));
    var travelBefore = (effStart - visStart) / H;
    var travelAfter = ge ? travel : 0;
    var gapHrs = ge ? (ge - visStart) / H : Infinity;
    var usable = ge ? gapHrs - travelBefore - travelAfter - hoseHrs - cont : Infinity;
    var pumpV = usable === Infinity ? Infinity : Math.max(0, Math.floor(usable * vtph));
    var pumpM = usable === Infinity ? Infinity : Math.max(0, Math.floor(usable * mtph));
    var atp = atpFrom(idx, st.v, st.m);
    var estV = Math.round(Math.min(pumpV, atp.v)), estM = Math.round(Math.min(pumpM, atp.m));
    var tooShort = !(usable > 0) || Math.max(pumpV, pumpM) < FW_MIN_PARCEL_MT;
    var noStock = !tooShort && estV < FW_MIN_PARCEL_MT && estM < FW_MIN_PARCEL_MT;
    rows.push({
      status: (tooShort || noStock) ? 'short' : 'free', shortReason: tooShort ? 'time' : (noStock ? 'stock' : null),
      start: dispStart, end: dispEnd, hrs: (dispEnd - dispStart) / H,
      gapStart: visStart, gapEnd: ge || null, openEnded: !ge, continuesPastRange: !ge || ge > horizonEnd,
      gapHrs: gapHrs, usableHrs: usable, travelBefore: travelBefore, travelAfter: travelAfter, hoseHrs: hoseHrs, contingencyHrs: cont,
      pumpV: pumpV, pumpM: pumpM, robV: st.v, robM: st.m, lowV: atp.lowV, lowM: atp.lowM,
      atpV: Math.round(atp.v), atpM: Math.round(atp.m), vbuf: vbuf, mbuf: mbuf, estV: estV, estM: estM
    });
  }

  var freeFrom = pastBusyEnd, afterJob = !!pastBusyEnd;
  items.forEach(function(it, i) {
    if (!freeFrom || it.start > freeFrom) pushGap(freeFrom, it.start, afterJob, i);
    var before = { v: st.v, m: st.m };
    apply(it, st);
    if (inRange(it.start, it.end)) {
      rows.push({
        status: it.kind === 'block' ? 'unavailable' : 'busy', kind: it.kind, label: it.label, reason: it.reason, blockId: it.blockId,
        grade: it.grade, qty: it.qty, nomV: it.nomV, nomM: it.nomM,
        start: clipS(it.start), end: clipE(it.end), rawStart: it.start, rawEnd: it.end, busyEnd: it.busyEnd,
        beforeV: before.v, beforeM: before.m, afterV: st.v, afterM: st.m
      });
    }
    // A barge can't do two things at once: anything earlier still running
    // when this starts is a double-booking. Show it — never quietly move
    // either item; free time simply resumes after the later end.
    for (var j = 0; j < i; j++) {
      var pr = items[j];
      if (pr.end > it.start) {
        var cs = it.start, ce = pr.end < it.end ? pr.end : it.end;
        if (ce > cs && inRange(cs, ce)) {
          rows.push({ status: 'conflict', kind: 'conflict', a: pr.label, b: it.label, aKind: pr.kind, bKind: it.kind,
            label: pr.label + ' overlaps ' + it.label, start: clipS(cs), end: clipE(ce), overlapStart: cs, overlapEnd: ce, overlapHrs: (ce - cs) / H });
        }
      }
    }
    if (!freeFrom || it.busyEnd > freeFrom) freeFrom = it.busyEnd;
    afterJob = true;
  });
  pushGap(freeFrom, null, afterJob, items.length);

  rows.meta = { robNowV: liveRob.liveV || 0, robNowM: liveRob.liveM || 0, vbuf: vbuf, mbuf: mbuf, vtph: vtph, mtph: mtph,
                hoseHrs: hoseHrs, travelHrs: travel, contingencyHrs: cont };
  return rows;
}

// Shared by both the panel render and the Excel download — the week Free
// Windows covers always matches whatever week the Weekly Planned Supply
// calendar above it is currently showing (respects _calWeekOffset).
function _freeWindowsWeekRange() {
  var today = new Date(); today.setHours(0,0,0,0);
  var weekStart = new Date(today.getTime() + (_calWeekOffset || 0) * 86400000);
  var weekEnd = new Date(weekStart.getTime() + 7 * 86400000);
  return { weekStart: weekStart, weekEnd: weekEnd };
}

