/* ══════════════════════════════════════════════════════════════════
   BARGE RELOAD PLANNER — per-barge VLSFO/LSMGO stock forecast and
   "reload by" advice. Built on _bargeStockProjection(), the same
   simulation Free Windows' available-to-promise reads, so the two can
   never disagree:
   • a vessel job deducts its PLANNING quantity (top of a quantity range —
     schedule vQ/mQ already are) at its START: the fuel has to be onboard
     when the hoses connect, so that is the conservative moment;
   • a job whose ETC passed but whose supply isn't saved is still
     committed and comes off "now";
   • a planned Loading adds at its end, capped at tank capacity; dated
     reload events are already inside live ROB.
   Breach = first job of a grade (starting from now on, inside the
   horizon) after which projected stock is below the barge's minimum-stock
   buffer (or below zero). Nothing here writes data: "Plan this loading"
   only pre-fills the Loading form, which the operator still has to save.
   ══════════════════════════════════════════════════════════════════ */
var RL_HORIZON_DAYS = [3, 7, 14];
var RL_DEFAULT_DAYS = 7;
var RL_ALERT_HORIZON_HRS = 7 * 24;   // dashboard alerts use a fixed week, whatever the selector shows
var RL_ROUND_MT = 50;                // reload quantity rounded UP to a 50 MT parcel
var RL_SLOT_STEP_MIN = 15;           // suggested start rounded up to a quarter hour (the form takes HH:MM)
// Same pre-/post-loading defaults the Loading form starts with (berthing,
// connection, line-up / disconnection, sampling, documents).
var RL_PRE_OPS_HRS = 2.5, RL_POST_OPS_HRS = 3.5;
var RL_LS_KEY = 'flow_reload_horizon_days';
var _rlDaysMem = null; // in-memory fallback when localStorage is blocked

var RL_GRADES = [
  { g: 'VLSFO', k: 'v', nom: 'nomV', cap: 'vcap', buf: 'vbuf', color: 'var(--fuel-v)', lt: 'var(--fuel-v-lt)' },
  { g: 'LSMGO', k: 'm', nom: 'nomM', cap: 'mcap', buf: 'mbuf', color: 'var(--fuel-m)', lt: 'var(--fuel-m-lt)' }
];

function _rlHorizonDays() {
  if (_rlDaysMem) return _rlDaysMem;
  try { var d = parseInt(localStorage.getItem(RL_LS_KEY), 10); if (RL_HORIZON_DAYS.indexOf(d) !== -1) return d; } catch (e) {}
  return RL_DEFAULT_DAYS;
}
function rlSetHorizon(days) {
  days = Number(days);
  if (RL_HORIZON_DAYS.indexOf(days) === -1) return;
  _rlDaysMem = days;
  try { localStorage.setItem(RL_LS_KEY, String(days)); } catch (e) {} // per-viewer convenience only
  _rlRenderAllHosts();
}

function _rlTravelHrs() { return Math.max(0, Number(_calcParams && _calcParams.travelHrs) || 0); }
// Terminal time for a loading: pre-ops + quantity ÷ terminal rate + post-ops
// (the Loading form's own model, so the pre-filled form shows the same).
function _rlLoadingHrs(qty, grade) { return RL_PRE_OPS_HRS + computeLoadingDurationHours(qty, grade) + RL_POST_OPS_HRS; }
function _rlCeilTo(d, mins) {
  var step = mins * 60000, t = Math.ceil(d.getTime() / step) * step;
  return new Date(t);
}
function _rlFloorTo(d, mins) {
  var step = mins * 60000;
  return new Date(Math.floor(d.getTime() / step) * step);
}
function _rlHM(d) { return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function _rlDay(d) { return d.toLocaleDateString('en-GB', { weekday: 'short' }); }
// "Wed 15 Oct 20:00"
function _rlFmt(d) { return _rlDay(d) + ' ' + d.getDate() + ' ' + MO[d.getMonth()] + ' ' + _rlHM(d); }
// "Wed 20:00" — for alerts that sit next to today's date anyway
function _rlFmtShort(d) { return _rlDay(d) + ' ' + _rlHM(d); }
function _rlFmtSlot(a, b) {
  return a.toDateString() === b.toDateString() ? _rlDay(a) + ' ' + _rlHM(a) + '–' + _rlHM(b) : _rlFmtShort(a) + ' – ' + _rlFmtShort(b);
}
function _rlMT(n) { return Math.round(n || 0).toLocaleString() + ' MT'; }
function _rlDurText(h) { return h >= 10 ? Math.round(h) + ' h' : (Math.round(h * 2) / 2) + ' h'; }

// Barges the planner looks at — the ROB engine's own config, read only:
// filling it in from here would let the next save bake supplies into the
// opening ROB earlier than it otherwise would.
function _rlBarges() { return _bargeConfig || []; }

/* Usable loading windows for a barge between now and `until`: Free
   Windows' own gaps (jobs + ETC contingency, Loadings, Unavailable blocks,
   conflicts), less travel to the terminal at the start and travel +
   contingency before the next commitment at the end, less any
   hypothetical reloads already proposed. [{from, to}] */
function _rlLoadingWindows(b, until, hyps, liveROBs) {
  var now = new Date(), H = 3600000;
  if (!(until > now)) return [];
  var travel = _rlTravelHrs(), cont = _contingencyHrs();
  var rows = computeFreeWindows(b.id, b.name, now, until, { liveROBs: liveROBs });
  var out = [];
  rows.forEach(function(w) {
    if (w.status !== 'free' && w.status !== 'short') return; // short = too short for a VESSEL parcel; a loading has its own maths
    var from = new Date(Math.max(w.gapStart.getTime(), now.getTime()) + travel * H);
    var to = w.gapEnd ? new Date(Math.min(until.getTime(), w.gapEnd.getTime() - (travel + cont) * H)) : until;
    if (to > from) out.push({ from: from, to: to });
  });
  (hyps || []).forEach(function(h) {
    var bf = new Date(h.start.getTime() - travel * H), bt = new Date(h.end.getTime() + (cont + travel) * H);
    out = [].concat.apply([], out.map(function(w) {
      if (bt <= w.from || bf >= w.to) return [w];
      var parts = [];
      if (bf > w.from) parts.push({ from: w.from, to: bf });
      if (bt < w.to) parts.push({ from: bt, to: w.to });
      return parts;
    }));
  });
  return out;
}

// Other barges whose projected stock of `grade` at `at` covers `qty` on
// top of everything they're already committed to (Free Windows' ATP at
// that instant) — candidates to take the job over.
function _rlAltBarges(excludeId, gi, at, qty, liveROBs) {
  var out = [];
  var lookEnd = new Date(Math.max(at.getTime(), Date.now()) + FW_LOOKAHEAD_DAYS * 86400000);
  _rlBarges().forEach(function(b) {
    if (String(b.id) === String(excludeId)) return;
    var p = _bargeStockProjection(b.id, b.name, lookEnd, { liveROBs: liveROBs });
    var s = { v: p.start.v, m: p.start.m }, idx = 0;
    while (idx < p.items.length && p.items[idx].start < at) { p.apply(p.items[idx], s); idx++; }
    var atp = p.atpFrom(idx, s.v, s.m);
    var spare = Math.round(atp[gi.k]);
    if (spare >= qty) out.push({ id: b.id, name: b.name, spare: spare });
  });
  return out.sort(function(a, c) { return c.spare - a.spare; });
}

/* _bargeStockForecast(bargeId, horizonHrs[, {liveROBs}]) →
   { bargeId, bargeName, now, end, horizonHrs, vcap, mcap, vbuf, mbuf,
     robNow {v,m}, events [...], series {VLSFO:[{t,q}], LSMGO:[...]},
     recs [...], ok }
   events: one row per thing that moves (or blocks) stock, in Free
   Windows' order, with stock of both grades after it (clamped at 0
   exactly as Free Windows clamps). recs: one per breach — see _rlRecommend. */
function _bargeStockForecast(bargeId, horizonHrs, opts) {
  opts = opts || {};
  var H = 3600000;
  var b = _rlBarges().find(function(x) { return String(x.id) === String(bargeId); });
  if (!b) return null;
  var hrs = Number(horizonHrs) > 0 ? Number(horizonHrs) : RL_DEFAULT_DAYS * 24;
  var now = new Date(), end = new Date(now.getTime() + hrs * H);
  var liveROBs = opts.liveROBs || getAllLiveROBs();
  // Same 30-day look-ahead Free Windows uses, so later jobs still count
  // when sizing a reload.
  var lookEnd = new Date(Math.max(end.getTime(), now.getTime() + FW_LOOKAHEAD_DAYS * 86400000));
  var proj = _bargeStockProjection(b.id, b.name, lookEnd, { liveROBs: liveROBs });

  // ── Time series: the projection walked exactly as Free Windows walks it.
  var s = { v: proj.robNow.v, m: proj.robNow.m };
  var events = [{ t: now, kind: 'now', label: 'ROB now', v: s.v, m: s.m, dv: 0, dm: 0 }];
  (proj.pre || []).forEach(function(p) {
    var bv = s.v, bm = s.m;
    proj.applyPre(p, s);
    if (p.kind === 'overdue') events.push({ t: now, kind: 'overdue', label: p.vessel, vessel: p.vessel, nomUid: p.nomUid, jobStart: p.start, dv: -p.nomV, dm: -p.nomM, v: s.v, m: s.m });
    else events.push({ t: now, kind: 'pending-loading', label: p.terminal || 'Terminal', loadingId: p.loadingId, grade: p.grade, qty: p.qty, start: p.start, end: p.end, counted: p.counted, why: p.why, dv: s.v - bv, dm: s.m - bm, v: s.v, m: s.m });
  });
  s = { v: proj.start.v, m: proj.start.m };
  var lastT = now;
  proj.items.forEach(function(it, idx) {
    if (it.start >= end) return;
    var before = { v: s.v, m: s.m };
    proj.apply(it, s);
    // Stock moves at a job's start and a loading's end (an overlap/conflict
    // can't make the line run backwards in time).
    var t = it.kind === 'loading' ? it.end : it.start;
    if (t < lastT) t = lastT;
    if (t > end) t = end;
    lastT = t;
    var ev = { t: t, idx: idx, kind: it.kind, label: it.kind === 'vessel' ? it.vessel : (it.kind === 'loading' ? (it.terminal || 'Terminal') : (it.reason || 'blocked')),
      start: it.start, end: it.end, v: s.v, m: s.m, dv: s.v - before.v, dm: s.m - before.m, beforeV: before.v, beforeM: before.m };
    if (it.kind === 'vessel') { ev.vessel = it.vessel; ev.nomUid = it.nomUid; ev.nomV = it.nomV; ev.nomM = it.nomM; }
    if (it.kind === 'loading') { ev.grade = it.grade; ev.qty = it.qty; }
    events.push(ev);
  });
  var series = {};
  RL_GRADES.forEach(function(gi) {
    series[gi.g] = events.map(function(e) { return { t: e.t, q: e[gi.k] }; });
    series[gi.g].push({ t: end, q: s[gi.k] });
  });

  var fc = { bargeId: b.id, bargeName: b.name, now: now, end: end, horizonHrs: hrs,
    vcap: proj.vcap, mcap: proj.mcap, vbuf: proj.vbuf, mbuf: proj.mbuf, robNow: proj.robNow, start: proj.start,
    events: events, series: series, recs: [], travelHrs: _rlTravelHrs(), contingencyHrs: proj.cont };
  fc.recs = _rlAnalyse(b, proj, now, end, liveROBs);
  fc.recs.sort(function(a, c) { return (a.jobStart - c.jobStart) || (a.grade < c.grade ? -1 : 1); });
  fc.ok = fc.recs.length === 0;
  return fc;
}

/* Breaches of both grades, earliest first, each with its recommendation.
   After each one a hypothetical reload of the recommended size is assumed
   done and the walk repeats, so a further breach is only reported if one
   reload can't cover everything (tank too small, or a later stretch after
   the next planned loading). Proposed reloads of either grade occupy the
   barge, so two recommendations never share one terminal slot. */
function _rlAnalyse(b, proj, now, end, liveROBs) {
  var H = 3600000, travel = _rlTravelHrs(), cont = proj.cont;
  var busy = []; // every proposed reload so far (both grades)
  var gs = RL_GRADES.map(function(gi) {
    var steps = [];
    proj.items.forEach(function(it, idx) {
      if (it.kind === 'vessel' && it[gi.nom] > 0) steps.push({ t: it.start, kind: 'vessel', q: it[gi.nom], it: it, idx: idx });
      else if (it.kind === 'loading' && it.grade === gi.g) steps.push({ t: it.start, kind: 'loading', q: it.qty, it: it, idx: idx });
    });
    return { gi: gi, buf: proj[gi.buf], cap: proj[gi.cap], steps: steps, hyps: [], lastIdx: -1, done: false };
  });
  function merged(g) {
    var all = g.steps.concat(g.hyps.map(function(h) { return { t: h.start, kind: 'hyp', q: h.qty }; }));
    return all.sort(function(a, c) { return (a.t - c.t) || ((a.kind === 'hyp' ? 0 : 1) - (c.kind === 'hyp' ? 0 : 1)); });
  }
  function add(g, run, q) { return g.cap ? Math.min(g.cap, run + q) : run + q; }
  // Same clamped walk as Free Windows; the signed value after a job is kept
  // only to say how short it is.
  function firstBreach(g, afterIdx) {
    var run = proj.start[g.gi.k], seq = merged(g);
    for (var i = 0; i < seq.length; i++) {
      var st = seq[i];
      if (st.kind !== 'vessel') { run = add(g, Math.max(0, run), st.q); continue; }
      var before = Math.max(0, run);
      run = before - st.q;
      // A job already under way (started before now) can't be reloaded for.
      if (st.t >= now && st.t < end && st.idx > afterIdx && run < g.buf) return { step: st, before: before, after: run };
    }
    return null;
  }
  // Stock just before T, and what's needed from T to stay ≥ buffer for
  // every job of this grade until the next planned loading (or horizon end).
  function sizeAt(g, T) {
    var seq = merged(g), run = proj.start[g.gi.k], i = 0;
    for (; i < seq.length && seq[i].t < T; i++) {
      run = seq[i].kind === 'vessel' ? Math.max(0, run) - seq[i].q : add(g, Math.max(0, run), seq[i].q);
    }
    var stock = Math.max(0, run), low = stock, jobs = 0, until = end, untilWhy = 'horizon';
    for (; i < seq.length; i++) {
      var s2 = seq[i];
      if (s2.t >= end) break;
      if (s2.kind !== 'vessel') { until = s2.t; untilWhy = s2.kind === 'loading' ? 'loading' : 'reload'; break; }
      low -= s2.q; jobs++;
    }
    var need = Math.max(0, g.buf - low);
    var want = Math.ceil(need / RL_ROUND_MT) * RL_ROUND_MT;
    var room = g.cap ? Math.max(0, Math.floor(g.cap - stock)) : Infinity;
    return { stock: stock, need: need, want: want, qty: Math.min(want, room), room: room, capped: want > room, jobs: jobs, until: until, untilWhy: untilWhy };
  }

  var recs = [];
  for (var iter = 0; iter < 10; iter++) {
    var pick = null;
    gs.forEach(function(g) {
      if (g.done) return;
      var br = firstBreach(g, g.lastIdx);
      if (!br) { g.done = true; return; }
      if (!pick || br.step.t < pick.br.step.t) pick = { g: g, br: br };
    });
    if (!pick) break;
    var g = pick.g, gi = g.gi, br = pick.br, it = br.step.it;
    var reloadBy = new Date(it.start.getTime() - (travel + cont) * H);
    // Latest free window that fits travel + the whole loading before reload-by.
    var wins = _rlLoadingWindows(b, reloadBy, busy, liveROBs);
    var slot = null, size = null;
    for (var w = wins.length - 1; w >= 0 && !slot; w--) {
      var T = _rlCeilTo(wins[w].from, RL_SLOT_STEP_MIN);
      var sz = sizeAt(g, T);
      if (!(sz.qty > 0)) continue;
      var dur = _rlLoadingHrs(sz.qty, gi.g);
      if (T.getTime() + dur * H <= wins[w].to.getTime()) {
        slot = { start: T, end: new Date(T.getTime() + dur * H), windowFrom: wins[w].from, windowTo: wins[w].to };
        size = sz;
      }
    }
    var overdue = reloadBy <= now, planStart;
    if (!slot) {
      // No window: sized as if it finished right at reload-by (or now).
      size = sizeAt(g, overdue ? now : reloadBy);
      var d0 = _rlLoadingHrs(size.qty, gi.g);
      planStart = new Date(Math.max(_rlCeilTo(now, RL_SLOT_STEP_MIN).getTime(), _rlFloorTo(new Date(reloadBy.getTime() - d0 * H), RL_SLOT_STEP_MIN).getTime()));
    } else planStart = slot.start;
    var durHrs = _rlLoadingHrs(size.qty, gi.g);
    var rec = {
      key: 'reload|' + b.id + '|' + gi.g + '|' + (it.nomUid || it.vessel),
      bargeId: b.id, bargeName: b.name, grade: gi.g, vessel: it.vessel, nomUid: it.nomUid || null,
      jobStart: it.start, jobQty: it[gi.nom], before: br.before, after: br.after, buffer: g.buf,
      shortBy: Math.round(g.buf - br.after), belowZero: br.after < 0,
      reloadBy: reloadBy, overdue: overdue, travelHrs: travel, contingencyHrs: cont,
      qty: size.qty, need: Math.round(size.need), want: size.want, fill: size.room === Infinity ? null : size.room,
      capped: size.capped, stockAtLoad: Math.round(size.stock),
      coversJobs: size.jobs, coversUntil: size.until, coversUntilWhy: size.untilWhy,
      durHrs: durHrs, pumpHrs: computeLoadingDurationHours(size.qty, gi.g),
      slot: slot, planStart: planStart, alternatives: slot ? [] : _rlAltBarges(b.id, gi, it.start, it[gi.nom], liveROBs), insufficient: false
    };
    recs.push(rec);
    g.lastIdx = br.step.idx;
    if (!(rec.qty > 0)) { rec.insufficient = true; g.done = true; continue; }
    var h = { start: planStart, end: new Date(planStart.getTime() + durHrs * H), qty: rec.qty };
    g.hyps.push(h); busy.push(h);
    // Even with this reload the same job still short? Say by how much.
    var again = firstBreach(g, -1);
    if (again && again.step.idx === br.step.idx) { rec.insufficient = true; rec.stillShort = Math.round(g.buf - again.after); }
  }
  return recs;
}

/* ─── Dashboard alerts: one per breach in the next 7 days, keyed by
   barge + grade + nomination so it stays the same alert across renders. ─── */
function _rlAlerts() {
  var out = [], seen = {};
  var barges = _rlBarges();
  if (!barges.length) return out;
  var liveROBs = getAllLiveROBs(), now = Date.now();
  barges.forEach(function(b) {
    var fc;
    try { fc = _bargeStockForecast(b.id, RL_ALERT_HORIZON_HRS, { liveROBs: liveROBs }); } catch (e) { console.warn('ABPS: reload forecast failed for', b.name, e); return; }
    (fc && fc.recs || []).forEach(function(r) {
      if (seen[r.key]) return;
      seen[r.key] = 1;
      out.push({
        key: r.key, label: 'Reload needed', go: String(b.id), kind: 'reload', rec: r,
        sub: b.name + ' ' + r.grade + ' short for ' + r.vessel + ' (' + _rlFmtShort(r.jobStart) + ') — ' +
          (r.overdue ? 'reload overdue (was due ' + _rlFmtShort(r.reloadBy) + ')' : 'reload by ' + _rlFmtShort(r.reloadBy)),
        severity: (r.reloadBy.getTime() - now) < 24 * 3600000 ? 'error' : 'warning'
      });
    });
  });
  return out;
}

// Alert / Needs Attention click → the barge's forecast (Barge Fleet for
// operators; traders can't open Barge Fleet, so their copy on the dashboard).
function rlGoToForecast(bargeId) {
  var dd = document.getElementById('global-alerts-dropdown');
  if (dd) dd.style.display = 'none';
  var hostId = isTrader() ? 'dash-reload-planner' : 'reload-planner-section';
  _rlFlash = { key: _fwKey(bargeId), until: Date.now() + 1600 }; // survives a re-render mid-animation
  showPage(isTrader() ? 'dashboard' : 'bargefleet'); // renders the planner there
  var card = document.querySelector('#' + hostId + ' .rl-card[data-barge-key="' + _fwKey(bargeId) + '"]') || document.getElementById(hostId);
  if (!card) return;
  try { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { card.scrollIntoView(); }
  card.classList.add('rl-flash');
}
var _rlFlash = null;

/* ─── Plan this loading → the EXISTING Loading form, pre-filled. Saves
   nothing: the operator reviews it and presses Add Loading (which runs the
   usual conflict check). ─── */
// hrs: the horizon the recommendation was shown with (its size depends on it).
function rlPlanLoading(bargeId, key, hrs) {
  if (isTrader()) return;
  var fc = _bargeStockForecast(bargeId, Number(hrs) > 0 ? Number(hrs) : _rlHorizonDays() * 24);
  var rec = fc && fc.recs.find(function(r) { return r.key === key; });
  if (!rec) { showToast('That reload is no longer needed — the forecast has changed.', 'info'); _rlRenderAllHosts(); return; }
  showPage('loading');
  cancelLoadingEdit(); // a fresh form, never an edit of another loading
  _populateLoadingBargeSelect();
  var set = function(id, v) { var el = document.getElementById(id); if (el) el.value = v; };
  set('ld-barge', rec.bargeName);
  set('ld-grade', rec.grade);
  set('ld-qty', rec.qty);
  set('ld-start-date', _localDateInputStr(rec.planStart));
  set('ld-start-time', _localTimeInputStr(rec.planStart));
  _ldSetStartWin('');   // the planner proposes an exact start time
  set('ld-pre-ops', RL_PRE_OPS_HRS);
  set('ld-post-ops', RL_POST_OPS_HRS);
  // Most recent terminal this barge loaded at, as a starting point.
  var last = (_loadingRecords || []).filter(function(r) { return r && !r.deletedAt && r.terminal && r.barge === rec.bargeName; })
    .sort(function(a, c) { return new Date(c.startAt) - new Date(a.startAt); })[0];
  set('ld-terminal', last ? last.terminal : '');
  _ldRefreshDealSelect(); // the deal for THIS grade, terminal and quantity (the form may have held another grade)
  set('ld-notes', 'Reload plan — ' + rec.grade + ' for ' + rec.vessel + ' (' + _rlFmt(rec.jobStart) + '), reload by ' + _rlFmt(rec.reloadBy));
  _recalcLoadingEstimate();
  var card = document.getElementById('loading-form-card');
  if (card) {
    var note = document.getElementById('ld-prefill-note');
    if (!note) {
      note = document.createElement('div');
      note.id = 'ld-prefill-note';
      note.style.cssText = 'font-size:12px;color:var(--azure);background:var(--azure-lt);border:1px solid var(--border);border-left:3px solid var(--azure);border-radius:6px;padding:8px 10px;margin-bottom:12px';
      card.insertBefore(note, card.children[2] || null);
    }
    note.textContent = 'Pre-filled from the reload plan for ' + rec.bargeName + ' (' + rec.grade + ' short for ' + rec.vessel + '). Check the terminal and times, then press Add Loading — nothing is saved until you do.';
    note.style.display = '';
    try { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
  }
  var focusEl = document.getElementById(last ? 'ld-qty' : 'ld-terminal');
  if (focusEl) { try { focusEl.focus({ preventScroll: true }); } catch (e) { focusEl.focus(); } }
}
function _rlClearPrefillNote() {
  var note = document.getElementById('ld-prefill-note');
  if (note) note.style.display = 'none';
}

/* ─── Rendering ─────────────────────────────────────────────────── */
// Step-line chart: both grades as % of their own tank (VLSFO and LSMGO
// tanks differ ~5×, so a shared MT axis would flatten LSMGO). The SVG
// stretches to the card (lines keep 2px via non-scaling strokes); text and
// markers are HTML on top so they stay legible at phone width.
function _rlChartHtml(fc) {
  var span = fc.end - fc.now;
  var X = function(t) { return Math.max(0, Math.min(1000, ((t - fc.now) / span) * 1000)); };
  var pct = function(t) { return (X(t) / 10).toFixed(2); };
  var TOP = 8, BOT = 96;
  var scales = {};
  RL_GRADES.forEach(function(gi) {
    var cap = fc[gi.cap];
    if (!(cap > 0)) cap = Math.max(fc[gi.buf] || 0, Math.max.apply(null, fc.series[gi.g].map(function(p) { return p.q; }))) * 1.1 || 1;
    scales[gi.g] = cap;
  });
  var Y = function(q, g) { return BOT - Math.max(0, Math.min(1.04, q / scales[g])) * (BOT - TOP); };
  var stepPath = function(g) {
    var pts = fc.series[g], d = 'M0 ' + Y(pts[0].q, g).toFixed(2);
    for (var i = 1; i < pts.length; i++) d += ' H' + X(pts[i].t).toFixed(1) + ' V' + Y(pts[i].q, g).toFixed(2);
    return d;
  };
  var svg = '';
  // day grid
  var day = new Date(fc.now); day.setHours(24, 0, 0, 0);
  var labels = [], every = fc.horizonHrs > 7 * 24 ? 2 : 1, n = 0;
  for (; day < fc.end; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1), n++) {
    svg += '<line x1="' + X(day).toFixed(1) + '" y1="0" x2="' + X(day).toFixed(1) + '" y2="100" style="stroke:var(--border)" stroke-width="1" vector-effect="non-scaling-stroke"/>';
    if (n % every === 0) labels.push('<span class="rl-xl" style="left:' + pct(day) + '%">' + esc(_rlDay(day) + ' ' + day.getDate()) + '</span>');
  }
  // capacity ceiling
  svg += '<line x1="0" y1="' + TOP + '" x2="1000" y2="' + TOP + '" style="stroke:var(--muted)" stroke-width="1" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"/>';
  // planned loadings: a tinted band over their terminal time
  fc.events.forEach(function(e) {
    if (e.kind !== 'loading') return;
    var x1 = X(e.start), x2 = X(e.end);
    svg += '<rect x="' + x1.toFixed(1) + '" y="0" width="' + Math.max(2, x2 - x1).toFixed(1) + '" height="100" style="fill:' + (e.grade === 'LSMGO' ? 'var(--fuel-m-lt)' : 'var(--fuel-v-lt)') + '"/>';
  });
  // suggested slots + reload-by lines
  fc.recs.forEach(function(r) {
    if (r.slot && r.slot.start < fc.end) {
      var a = X(r.slot.start), z = X(r.slot.end);
      svg += '<rect x="' + a.toFixed(1) + '" y="0" width="' + Math.max(2, z - a).toFixed(1) + '" height="100" style="fill:var(--green-lt2);stroke:var(--green)" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>';
    }
    if (r.reloadBy > fc.now && r.reloadBy < fc.end) {
      svg += '<line x1="' + X(r.reloadBy).toFixed(1) + '" y1="0" x2="' + X(r.reloadBy).toFixed(1) + '" y2="100" style="stroke:var(--red)" stroke-width="1.5" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>';
    }
  });
  var defs = '';
  RL_GRADES.forEach(function(gi) {
    var yb = Y(fc[gi.buf] || 0, gi.g), id = 'rlclip-' + _fwKey(fc.bargeId) + '-' + gi.k;
    defs += '<clipPath id="' + id + '"><rect x="0" y="' + yb.toFixed(2) + '" width="1000" height="' + (100 - yb).toFixed(2) + '"/></clipPath>';
    // red zone: between the line and the buffer wherever the line is below
    // it (area above the line, clipped to the band under the buffer)
    svg += '<path d="' + stepPath(gi.g) + ' V0 H0 Z" clip-path="url(#' + id + ')" style="fill:var(--red-lt)"/>';
    // buffer
    svg += '<line x1="0" y1="' + yb.toFixed(2) + '" x2="1000" y2="' + yb.toFixed(2) + '" style="stroke:' + gi.color + '" stroke-width="1" stroke-dasharray="5 4" opacity=".75" vector-effect="non-scaling-stroke"/>';
  });
  RL_GRADES.forEach(function(gi) {
    var id = 'rlclip-' + _fwKey(fc.bargeId) + '-' + gi.k;
    svg += '<path d="' + stepPath(gi.g) + '" fill="none" style="stroke:' + gi.color + '" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>';
    svg += '<path d="' + stepPath(gi.g) + '" fill="none" clip-path="url(#' + id + ')" style="stroke:var(--red)" stroke-width="2.5" vector-effect="non-scaling-stroke"/>';
  });
  // HTML markers along the bottom edge: vessel jobs (diamond), loadings (square)
  var marks = fc.events.filter(function(e) { return e.kind === 'vessel' || e.kind === 'loading' || e.kind === 'block'; }).map(function(e) {
    var tip, col, cls = 'rl-mk';
    if (e.kind === 'vessel') {
      col = e.nomV > 0 && e.nomM > 0 ? 'var(--ink)' : (e.nomM > 0 ? 'var(--fuel-m)' : 'var(--fuel-v)');
      tip = e.vessel + ' · ' + _rlFmt(e.start) + ' · ' + [e.nomV > 0 ? e.nomV.toLocaleString() + ' MT VLSFO' : '', e.nomM > 0 ? e.nomM.toLocaleString() + ' MT LSMGO' : ''].filter(Boolean).join(' + ');
      return '<span class="' + cls + ' rl-mk-job" style="left:' + pct(e.start) + '%;background:' + col + '" title="' + esc(tip) + '"></span>';
    }
    if (e.kind === 'loading') {
      col = e.grade === 'LSMGO' ? 'var(--fuel-m)' : 'var(--fuel-v)';
      tip = 'Loading — ' + e.label + ' · ' + _rlFmt(e.start) + '–' + _rlHM(e.end) + ' · +' + e.qty.toLocaleString() + ' MT ' + e.grade;
      return '<span class="' + cls + ' rl-mk-load" style="left:' + pct(e.end) + '%;border-color:' + col + '" title="' + esc(tip) + '"></span>';
    }
    tip = 'Unavailable — ' + e.label + ' · ' + _rlFmt(e.start) + ' → ' + _rlFmt(e.end);
    return '<span class="' + cls + ' rl-mk-block" style="left:' + pct(e.start) + '%" title="' + esc(tip) + '"></span>';
  }).join('');
  var rbl = fc.recs.filter(function(r) { return r.reloadBy > fc.now && r.reloadBy < fc.end; }).map(function(r) {
    return '<span class="rl-rb" style="left:' + pct(r.reloadBy) + '%" title="' + esc('Reload ' + r.grade + ' by ' + _rlFmt(r.reloadBy)) + '">' + esc(r.grade) + '</span>';
  }).join('');
  var aria = fc.bargeName + ' stock forecast to ' + _rlFmt(fc.end) + ': VLSFO ' + _rlMT(fc.series.VLSFO[0].q) + ' now, lowest ' + _rlMT(Math.min.apply(null, fc.series.VLSFO.map(function(p) { return p.q; }))) +
    '; LSMGO ' + _rlMT(fc.series.LSMGO[0].q) + ' now, lowest ' + _rlMT(Math.min.apply(null, fc.series.LSMGO.map(function(p) { return p.q; }))) + '.';
  return '<div class="rl-chart" role="img" aria-label="' + esc(aria) + '">' +
      '<svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true" focusable="false"><defs>' + defs + '</defs>' + svg + '</svg>' +
      '<span class="rl-cap">Capacity</span>' + rbl + '<div class="rl-marks">' + marks + '</div>' +
    '</div>' +
    '<div class="rl-xaxis" aria-hidden="true">' + labels.join('') + '</div>';
}

function _rlRecHtml(r, operator, hrs) {
  var gi = RL_GRADES.find(function(x) { return x.g === r.grade; });
  var urgent = r.overdue || (r.reloadBy - Date.now()) < 24 * 3600000;
  var main = 'Reload <b style="color:' + gi.color + '">' + esc(r.grade) + ' ≥ ' + esc(r.qty.toLocaleString()) + ' MT</b> by <b>' + esc(_rlFmt(r.reloadBy)) + '</b>' +
    (r.overdue ? ' <span class="rl-tag rl-tag-red">overdue</span>' : '') +
    (r.slot ? ' · suggested slot ' + esc(_rlFmtSlot(r.slot.start, r.slot.end)) : '') +
    ' · ~' + esc(_rlDurText(r.durHrs)) + ' at terminal';
  var why = esc(r.vessel) + ' (' + esc(_rlFmt(r.jobStart)) + ') needs ' + esc(_rlMT(r.jobQty)) + ' ' + esc(r.grade) + '; ' +
    esc(_rlMT(r.before)) + ' projected onboard leaves ' + (r.belowZero ? '<b>' + esc(_rlMT(-r.after)) + ' short</b>' : esc(_rlMT(r.after))) +
    ' against a ' + esc(_rlMT(r.buffer)) + ' buffer (' + esc(_rlMT(r.shortBy)) + ' below).';
  var cover = 'Covers ' + r.coversJobs + ' job' + (r.coversJobs === 1 ? '' : 's') + ' until ' +
    (r.coversUntilWhy === 'loading' ? 'the next planned loading (' + esc(_rlFmt(r.coversUntil)) + ')' : r.coversUntilWhy === 'reload' ? 'the next reload above' : 'the end of the forecast (' + esc(_rlFmt(r.coversUntil)) + ')') +
    (r.fill != null ? ' · fill to capacity: ' + esc(_rlMT(r.fill)) : '') +
    ' · reload by = job start − ' + esc(String(r.travelHrs)) + 'h travel − ' + esc(String(r.contingencyHrs)) + 'h contingency.';
  var warn = '';
  if (r.capped) warn += '<div class="rl-rec-warn">Tank room caps this at ' + esc(_rlMT(r.qty)) + ' (' + esc(_rlMT(r.want)) + ' wanted) — plan a second loading or move a job.</div>';
  if (r.insufficient && r.stillShort > 0) warn += '<div class="rl-rec-warn">Even after this reload ' + esc(r.vessel) + ' is ' + esc(_rlMT(r.stillShort)) + ' below buffer — the job is larger than this barge can hold; split or reassign it.</div>';
  if (!r.slot) {
    var alts = r.alternatives.length
      ? ' Barges with enough ' + esc(r.grade) + ' then: ' + r.alternatives.slice(0, 4).map(function(a) { return '<b>' + esc(a.name) + '</b> (' + esc(_rlMT(a.spare)) + ' spare)'; }).join(', ') + '.'
      : ' No other barge has ' + esc(_rlMT(r.jobQty)) + ' ' + esc(r.grade) + ' to spare then.';
    warn += '<div class="rl-rec-warn rl-noslot">No free slot before ' + esc(_rlFmt(r.reloadBy)) + ' — reassign ' + esc(r.vessel) + ' or reload earlier.' + alts + '</div>';
  }
  var btn = operator && r.qty > 0
    ? '<button class="btn btn-primary btn-sm rl-plan-btn" onclick="rlPlanLoading(\'' + escJs(String(r.bargeId)) + '\',\'' + escJs(r.key) + '\',' + Number(hrs) + ')">Plan this loading</button>'
    : '';
  return '<div class="rl-rec ' + (urgent ? 'rl-rec-urgent' : '') + '" data-key="' + esc(r.key) + '" data-grade="' + esc(r.grade) + '">' +
      '<div class="rl-rec-body"><div class="rl-rec-main">' + main + '</div>' +
      '<div class="rl-rec-why">' + why + ' ' + cover + '</div>' + warn + '</div>' +
      (btn ? '<div class="rl-rec-act">' + btn + '</div>' : '') +
    '</div>';
}

// "Mark Completed" on a pending loading in the forecast: same as on the Loading page.
function rlCompleteLoading(id) {
  const rec = (_loadingRecords || []).find(function(r) { return r && r.id === id; });
  if (!rec || rec.deletedAt) { showToast('That loading is no longer in the list.', 'warning'); return; }
  if (rec.completed) { showToast('That loading is already marked Completed.', 'warning'); _refreshLoadingConsumers(); return; }
  completeLoadingPrompt(id, { fromForecast: true }); // asks for the BL quantity, then completes (saves, re-renders the forecast)
}
function _rlEventListHtml(fc) {
  var rows = fc.events.filter(function(e) { return e.kind !== 'now'; }).map(function(e) {
    var when = esc(_rlFmt(e.kind === 'overdue' ? e.jobStart : e.kind === 'loading' ? e.end : e.start));
    var after = 'VLSFO ' + _rlMT(e.v) + ' · LSMGO ' + _rlMT(e.m);
    if (e.kind === 'vessel' || e.kind === 'overdue') {
      var q = [e.dv ? '−' + _rlMT(-e.dv) + ' VLSFO' : '', e.dm ? '−' + _rlMT(-e.dm) + ' LSMGO' : ''].filter(Boolean).join(', ') || 'no fuel';
      return '<li>' + when + ' — ' + esc(e.vessel) + (e.kind === 'overdue' ? ' (ETC passed, supply not saved)' : '') + ': ' + esc(q) + ' → ' + esc(after) + '</li>';
    }
    if (e.kind === 'loading') return '<li>' + when + ' — Loading at ' + esc(e.label) + ': +' + esc(_rlMT(e.qty)) + ' ' + esc(e.grade) + ' → ' + esc(after) + '</li>';
    if (e.kind === 'pending-loading') {
      return '<li class="rl-pending">' + esc(_rlFmt(e.end)) + ' — Loading at ' + esc(e.label) + ' ended, <b>not marked Completed</b>' +
        (e.counted ? ': +' + esc(_rlMT(e.qty)) + ' ' + esc(e.grade) + ' counted until it is' : ' — ' + esc(_rlMT(e.qty)) + ' ' + esc(e.grade) + ' not counted (' + esc(e.why) + ')') +
        ' → ' + esc(after) + _rlDoneBtn(e) + '</li>';
    }
    return '<li>' + when + ' — Unavailable: ' + esc(e.label) + ' (until ' + esc(_rlFmt(e.end)) + ')</li>';
  });
  return '<details class="rl-events"><summary>Projected events (' + rows.length + ')</summary>' +
    (rows.length ? '<ol>' + rows.join('') + '</ol>' : '<div style="padding:4px 0">No committed jobs or loadings in this period.</div>') + '</details>';
}

function _rlDoneBtn(e) {
  if (typeof isTrader === 'function' && isTrader()) return '';
  return ' <button type="button" class="rl-done-btn" onclick="rlCompleteLoading(' + JSON.stringify(String(e.loadingId)).replace(/"/g, '&quot;') + ')" title="Mark this loading Completed on the Loading page — then record the reload in the barge\'s ROB">Mark Completed</button>';
}
// Ended-but-uncompleted loadings, shown above the recommendations so they
// are not buried in the collapsed events list.
function _rlPendingNoticeHtml(fc) {
  return fc.events.filter(function(e) { return e.kind === 'pending-loading'; }).map(function(e) {
    return '<div class="rl-pending-note">⚠ Loading at ' + esc(e.label) + ' ended ' + esc(_rlFmt(e.end)) + ' but is <b>not marked Completed</b>' +
      (e.counted ? ': +' + esc(_rlMT(e.qty)) + ' ' + esc(e.grade) + ' is counted in this forecast until it is.' : ' — its ' + esc(_rlMT(e.qty)) + ' ' + esc(e.grade) + ' is not counted (' + esc(e.why) + ').') +
      _rlDoneBtn(e) + '</div>';
  }).join('');
}

function _rlCardHtml(fc, operator) {
  var head = '<div class="rl-head"><div class="rl-name">' + esc(fc.bargeName) + '</div>' +
    '<div class="rl-now">ROB now <b style="color:var(--fuel-v)">' + esc(_rlMT(fc.robNow.v)) + '</b>' + (fc.vcap ? ' / ' + esc(_rlMT(fc.vcap)) : '') + ' VLSFO · ' +
    '<b style="color:var(--fuel-m)">' + esc(_rlMT(fc.robNow.m)) + '</b>' + (fc.mcap ? ' / ' + esc(_rlMT(fc.mcap)) : '') + ' LSMGO</div></div>';
  var legend = '<div class="rl-legend">' +
    '<span><i style="background:var(--fuel-v)"></i>VLSFO</span><span><i style="background:var(--fuel-m)"></i>LSMGO</span>' +
    '<span><i class="rl-dash"></i>buffer (' + esc(fc.vbuf.toLocaleString()) + ' / ' + esc(fc.mbuf.toLocaleString()) + ' MT)</span>' +
    '<span><i style="background:var(--red-lt);border:1px solid var(--red)"></i>below buffer</span>' +
    '<span><i class="rl-lg-job"></i>vessel job</span><span><i class="rl-lg-load"></i>loading</span>' +
    (fc.recs.some(function(r) { return r.slot; }) ? '<span><i style="background:var(--green-lt2);border:1px dashed var(--green)"></i>suggested slot</span>' : '') +
    '<span style="color:var(--muted)">% of tank</span></div>';
  var recs = fc.recs.length
    ? fc.recs.map(function(r) { return _rlRecHtml(r, operator, fc.horizonHrs); }).join('')
    : '<div class="rl-ok">All good through ' + esc(_rlFmt(fc.end)) + ' — stock stays above buffer for every committed job.</div>';
  var flash = _rlFlash && _rlFlash.key === _fwKey(fc.bargeId) && Date.now() < _rlFlash.until ? ' rl-flash' : '';
  return '<div class="card rl-card' + flash + '" data-barge-key="' + esc(_fwKey(fc.bargeId)) + '" data-barge-id="' + esc(String(fc.bargeId)) + '">' +
    head + _rlChartHtml(fc) + legend + '<div class="rl-recs">' + _rlPendingNoticeHtml(fc) + recs + '</div>' + _rlEventListHtml(fc) + '</div>';
}

// Render the planner into a host element (Barge Fleet section for
// operators; dashboard copy for traders). One forecast per barge per render.
function renderReloadPlanner(hostId) {
  var host = document.getElementById(hostId || 'reload-planner-body');
  if (!host) return;
  var days = _rlHorizonDays(), operator = !isTrader();
  var barges = _rlBarges();
  var sel = '<div class="rl-horizon" role="group" aria-label="Forecast horizon">' + RL_HORIZON_DAYS.map(function(d) {
    return '<button type="button" class="btn btn-sm ' + (d === days ? 'btn-primary' : 'btn-secondary') + '" aria-pressed="' + (d === days) + '" onclick="rlSetHorizon(' + d + ')">' + d + ' days</button>';
  }).join('') + '</div>';
  var stale = _fwScheduleStaleness();
  var hasSched = (_lastSched || []).length > 0;
  var gen = !hasSched ? 'No schedule generated yet — only loadings and live ROB are reflected.'
    : stale.known && stale.generatedAt ? 'Based on schedule generated ' + fmt24(stale.generatedAt) + '.' : 'Based on the last generated schedule.';
  var staleBox = stale.stale ? '<div class="rl-stale">⚠ Nominations/barges changed since (' + esc(stale.reasons.join(', ')) + ') — regenerate the schedule for an up-to-date forecast.</div>' : '';
  var intro = '<div class="rl-intro">' + esc(gen) + ' Jobs take their planned (maximum) quantity at supply start; loadings add at completion, capped at tank capacity. ' +
    'Reload by = the short job\'s start − ' + _rlTravelHrs() + 'h travel − ' + _contingencyHrs() + 'h contingency. Quantities round up to ' + RL_ROUND_MT + ' MT; terminal time = ' +
    RL_PRE_OPS_HRS + 'h pre-ops + quantity ÷ terminal rate + ' + RL_POST_OPS_HRS + 'h post-ops.</div>';
  var body;
  if (!barges.length) body = '<div class="rl-empty">' + ((_barges || []).length ? 'Generate the schedule to see the forecast.' : 'No barges configured.') + '</div>';
  else {
    var liveROBs = getAllLiveROBs();
    body = '<div class="rl-grid">' + barges.map(function(b) {
      try { return _rlCardHtml(_bargeStockForecast(b.id, days * 24, { liveROBs: liveROBs }), operator); }
      catch (e) { console.warn('ABPS: reload forecast failed for', b.name, e); return '<div class="card rl-card"><div class="rl-name">' + esc(b.name) + '</div><div class="rl-empty">Forecast unavailable.</div></div>'; }
    }).join('') + '</div>';
  }
  host.innerHTML = '<div class="rl-top">' + intro + sel + '</div>' + staleBox + body;
}
function renderDashReloadPlanner() {
  var card = document.getElementById('dash-reload-planner');
  if (!card) return;
  // Not shown on the dashboard: operators have the planner on Barge Fleet and
  // traders don't need it.
  card.style.display = 'none';
}
function _rlRenderAllHosts() {
  if (_currentPage === 'bargefleet') renderReloadPlanner('reload-planner-body');
  if (_currentPage === 'dashboard') renderDashReloadPlanner();
}
// Shared refresh point: schedule, loadings, ROB, blocks or a colleague's
// sync changed — re-render whatever planner is on screen and the bell.
function _rlRefreshIfShown() {
  try { _rlRenderAllHosts(); } catch (e) { console.warn('ABPS: reload planner refresh failed', e); }
  try { if (typeof _refreshGlobalAlertsBell === 'function') _refreshGlobalAlertsBell(); } catch (e) { console.warn('ABPS: alerts refresh failed', e); }
}

/* ─── Schedule staleness — Free Windows reads _lastSched, which is only as
   current as the last "Generate Schedule". A signature of what the schedule
   was built from is stored with it; comparing it to the live inputs tells
   the planner when the picture is out of date (never auto-regenerated). ─── */
function _fwHash(str) {
  var h = 5381;
  for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
function _fwInputSignature() {
  var st = captureCurrentState();
  var v = {};
  (st.vessels || []).forEach(function(x, i) {
    if (!String(x.name || '').trim()) return; // a blank card isn't a nomination yet
    v[x.nomUid || ('#' + i)] = _fwHash(_stableStr([x.name, x.type, x.qty, x.mgo, x.eta, x.lc, x.bargeId, x.refuelChk, x.rfv, x.rfm, x.rfvr, x.rfmr, !!x.lcOnly].concat(x.etaWin ? [x.etaWin] : [])));
  });
  // Barge ROB is left out on purpose: it moves with every saved supply and
  // Free Windows reads live ROB anyway.
  var b = _fwHash(_stableStr((st.barges || []).map(function(x) { return [x.id, x.name, x.vcap, x.mcap, x.vbuf, x.mbuf, x.vtph, x.mtph]; })));
  var l = _fwHash(_stableStr((_loadingRecords || []).filter(function(r) { return r && !r.deletedAt; })
    .map(function(r) { return [r.id, r.barge, r.startAt, r.endAt, r.grade, r.qty]; }).map(_stableStr).sort()));
  var k = _fwHash(_stableStr((_bargeBlocks || []).filter(function(x) { return x && !x.deletedAt; })
    .map(function(x) { return [x.id, x.bargeId, x.start, x.end]; }).map(_stableStr).sort()));
  var p = _fwHash(_stableStr([_calcParams && _calcParams.hoseHrs, _calcParams && _calcParams.travelHrs]));
  return { v: v, b: b, l: l, k: k, p: p };
}
function _fwScheduleStaleness() {
  var meta = _lastSchedMeta;
  if (!meta || !meta.sig) return { known: false, stale: false, reasons: [] };
  var cur = _fwInputSignature(), old = meta.sig, reasons = [];
  var oldV = old.v || {}, curV = cur.v || {}, edited = 0, added = 0, removed = 0;
  Object.keys(curV).forEach(function(k) { if (!(k in oldV)) added++; else if (oldV[k] !== curV[k]) edited++; });
  Object.keys(oldV).forEach(function(k) {
    if (k in curV) return;
    // A card disappears when its supply is saved — that's progress, not a change.
    var item = (_lastSched || []).find(function(it) { return it.nomUid === k; });
    if (item && _isScheduleItemCompleted(item)) return;
    removed++;
  });
  if (edited) reasons.push(edited + ' nomination' + (edited > 1 ? 's' : '') + ' edited');
  if (added) reasons.push(added + ' nomination' + (added > 1 ? 's' : '') + ' added');
  if (removed) reasons.push(removed + ' nomination' + (removed > 1 ? 's' : '') + ' removed');
  if (old.b !== cur.b) reasons.push('barge settings');
  if (old.l !== cur.l) reasons.push('loadings');
  if (old.k !== cur.k) reasons.push('unavailable blocks');
  if (old.p !== cur.p) reasons.push('hose-up/travel times');
  var at = meta.generatedAt ? new Date(meta.generatedAt) : null;
  return { known: true, generatedAt: (at && !isNaN(at.getTime())) ? at : null, stale: reasons.length > 0, reasons: reasons };
}
// Called by calculate() right after a schedule is built.
function _stampScheduleMeta() {
  try { _lastSchedMeta = { generatedAt: new Date().toISOString(), sig: _fwInputSignature() }; }
  catch (e) { _lastSchedMeta = null; console.warn('ABPS: could not stamp schedule inputs', e); }
}
// "Regenerate" from the Free Windows panel — the normal Generate Schedule,
// then a re-render. Operators only (traders never write the schedule).
function fwRegenerateSchedule() {
  if (isTrader()) return;
  calculate();
  renderFreeWindowsPanel();
}

/* ─── Unassigned demand — nominations that occupy no barge in the schedule
   Free Windows is built from: cards added/changed since the last Generate
   (not in it at all), plus any schedule entry whose barge label matches no
   configured barge. Their fuel and time are still needed, so free time on
   the barges is not spare capacity for them. ─── */
function _fwUnassignedDemand(weekStart, weekEnd) {
  var out = [];
  var barges = _bargeConfig || [];
  var names = barges.map(function(b) { return String(b.name || '').trim(); });
  var schedUids = {}, schedNames = {};
  var norm = function(s) { return String(s || '').trim().toLowerCase(); };
  var inWeek = function(t) { return t && !isNaN(t.getTime()) && t >= weekStart && t < weekEnd; };
  (_lastSched || []).forEach(function(it) {
    if (it.nomUid) schedUids[it.nomUid] = 1; else schedNames[norm(it.name)] = 1;
    if (_isScheduleItemCompleted(it)) return;
    var lbl = String(it.bargeLabel || '').trim();
    var placed = (lbl && names.indexOf(lbl) !== -1) || (!lbl && barges.length === 1) ||
                 (it.bargeId && barges.some(function(b) { return String(b.id) === String(it.bargeId); }));
    if (placed) return;
    var t = it.bargeStart || it.eta || it.etc; t = t ? new Date(t) : null;
    if (!inWeek(t)) return;
    out.push({ name: it.name, v: it.nomVQ != null ? it.nomVQ : (it.vQ || 0), m: it.nomMQ != null ? it.nomMQ : (it.mQ || 0), why: 'no barge' });
  });
  var vessels = [];
  try { vessels = captureCurrentState().vessels || []; } catch (e) {}
  vessels.forEach(function(x) {
    if (!String(x.name || '').trim()) return;
    if (x.nomUid ? schedUids[x.nomUid] : schedNames[norm(x.name)]) return;
    var eta = null, lc = null;
    try { eta = x.eta ? parseDT(x.eta) : null; } catch (e) {}
    try { lc = x.lc ? parseLaycan(x.lc) : null; } catch (e) {}
    var hit = eta ? inWeek(eta) : !!(lc && lc.from && lc.to && lc.from < weekEnd && lc.to >= weekStart);
    if (!hit) return;
    out.push({ name: x.name, v: x.type === 'MGO' ? 0 : (Number(x.qty) || 0), m: x.type === 'VLSFO' ? 0 : (Number(x.mgo) || 0), why: 'not in schedule' });
  });
  return {
    items: out, count: out.length,
    v: out.reduce(function(s, x) { return s + (x.v || 0); }, 0),
    m: out.reduce(function(s, x) { return s + (x.m || 0); }, 0)
  };
}

