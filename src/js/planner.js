/* ─── PLANNER CORE ───
   Pure: the same inputs always give the same plan, and nothing outside the
   returned object is read or written (no DOM, no globals, inputs untouched).
   calculate() gathers the live inputs, calls this, then renders.
     vessels  getVessels()-shaped rows        barges   getBarges()-shaped rows
     opening  {bargeId: {v, m}} — ROB on board when the plan starts
     params   _planCtxLive()-shaped {hoseHrs, travelHrs, blocksFor(barge)}
   Returns {sequence, sched, vAl, mAl, blockMoves, totV, totM, bargeState, meta}
   — meta[i] belongs to sched[i]: {vessel, bargeId, bargeName, readyAt, waitHrs, pastLaycan}. */
function planSchedule(inp) {
  const P = inp.params, barges = inp.barges, opening = inp.opening || {};
  // Sort: firm-ETA vessels first by ETA, no-firm-ETA (00:00) vessels go to end —
  // and among themselves, ordered by their NOMINATED LAYCAN (not the placeholder
  // ETA date), since a no-firm vessel's ETA field carries no real timing info.
  const vessels = inp.vessels.slice().sort((a, b) => {
    if (a.noFirmETA && !b.noFirmETA) return 1;
    if (!a.noFirmETA && b.noFirmETA) return -1;
    if (a.noFirmETA && b.noFirmETA) {
      const aKey = (a.lc && a.lc.from) ? a.lc.from.getTime() : a.effectiveETA;
      const bKey = (b.lc && b.lc.from) ? b.lc.from.getTime() : b.effectiveETA;
      return aKey - bKey;
    }
    return a.effectiveETA - b.effectiveETA;
  });
  const onTime = vessels.filter(v => !v.isDelayed);
  const delayed = vessels.filter(v => v.isDelayed);
  const placed = new Set();
  const sequence = [];
  let cursor = null;

  for (let i = 0; i < onTime.length; i++) {
    const ov = onTime[i];
    let found = true;
    while (found) {
      found = false;
      for (let d = 0; d < delayed.length; d++) {
        const dv = delayed[d];
        if (placed.has(dv)) continue;
        const dvBargeStart = (cursor && addHrs(cursor,P.travelHrs) > dv.effectiveETA) ? addHrs(cursor,P.travelHrs) : dv.effectiveETA;
        const dvETC  = _vesselJobETC(dvBargeStart, dv, undefined, undefined, P);
        const dvDone = addHrs(dvETC,P.travelHrs);
        if (dv.effectiveETA <= ov.effectiveETA && dvDone <= ov.effectiveETA) { placed.add(dv); sequence.push(dv); cursor=dvETC; found=true; break; }
      }
    }
    sequence.push(ov);
    const ovStart = (cursor && addHrs(cursor,P.travelHrs) > ov.effectiveETA) ? addHrs(cursor,P.travelHrs) : ov.effectiveETA;
    cursor = _vesselJobETC(ovStart, ov, undefined, undefined, P);
  }
  delayed.filter(dv => !placed.has(dv)).forEach(dv => sequence.push(dv));

  const bargeState = {};
  barges.forEach(b => {
    // Plan from what's actually on board NOW (opening minus completed
    // supplies, plus reloads / manual overrides) — not the opening figure,
    // which ignored everything already delivered.
    const o = opening[b.id];
    const openV = o ? o.v : b.vrob, openM = o ? o.m : b.mrob;
    bargeState[b.id] = { cursor:null, rv:openV, rm:openM, _openingV:openV, _openingM:openM, vcap:b.vcap, mcap:b.mcap, vbuf:b.vbuf, mbuf:b.mbuf, name:b.name };
  });
  const sched = [], vAl = [], mAl = [], blockMoves = [], meta = [];
  let totV = 0, totM = 0;

  for (let i = 0; i < sequence.length; i++) {
    const v = sequence[i];
    let barge, bs;
    if (v.bargeId && bargeState[v.bargeId]) { barge = barges.find(b => b.id==v.bargeId); bs = bargeState[v.bargeId]; }
    else {
      // Auto choice: the barge that can cover the most of the grades this
      // vessel actually needs (both, if both), then whichever is free
      // earliest, then the most ROB of those grades — not VLSFO ROB alone.
      const etaMs = v.effectiveETA ? v.effectiveETA.getTime() : 0;
      const score = b => {
        const st = bargeState[b.id];
        const covV = v.vq > 0 ? Math.min(1, st.rv / v.vq) : 1;
        const covM = v.mq > 0 ? Math.min(1, st.rm / v.mq) : 1;
        const free = st.cursor ? addHrs(st.cursor,P.travelHrs).getTime() : -Infinity;
        let avail = Math.max(free, etaMs);
        // A barge sitting in an Unavailable block isn't free then.
        if (isFinite(avail)) avail = _schedStartOutsideBlocks(b, new Date(avail), v.vq, v.mq, _vesselFrameEnd(v), P).start.getTime();
        return { cov: Math.min(covV, covM), avail, rob: (v.vq > 0 ? st.rv : 0) + (v.mq > 0 ? st.rm : 0) };
      };
      barge = barges.reduce((best,b) => {
        const sb = score(b), sbest = score(best);
        if (sb.cov !== sbest.cov) return sb.cov > sbest.cov ? b : best;
        if (sb.avail !== sbest.avail) return sb.avail < sbest.avail ? b : best;
        return sb.rob > sbest.rob ? b : best;
      }, barges[0]);
      bs = bargeState[barge.id];
    }
    const VCAP = barge.vcap, MCAP = barge.mcap;
    const earliestBarge = bs.cursor ? addHrs(bs.cursor,P.travelHrs) : null;
    let bargeStart = earliestBarge && earliestBarge > v.effectiveETA ? earliestBarge : v.effectiveETA;
    let waitedForBarge = !!(earliestBarge && earliestBarge > (_vesselFrameEnd(v) || v.effectiveETA));
    // Never plan a supply inside an Unavailable block: wait it out (plus
    // transit) and say so — the job is moved, not silently overlapped.
    const blk = _schedStartOutsideBlocks(barge, bargeStart, v.vq, v.mq, _vesselFrameEnd(v), P);
    if (blk.block) {
      blockMoves.push({ vessel: v.name, barge: barge.name, reason: blk.block.reason || 'blocked', from: bargeStart, to: blk.start });
      bargeStart = blk.start; waitedForBarge = true;
    }
    // How long the vessel waits for a barge after it is there (a time frame:
    // after the frame END — before that it has not necessarily arrived).
    const readyAt = _vesselFrameEnd(v) || v.effectiveETA;
    meta.push({ vessel: v, bargeId: barge.id, bargeName: barge.name, readyAt, waitHrs: Math.max(0, (bargeStart - readyAt) / 3600000), pastLaycan: !!(v.lc && bargeStart > v.lc.to) });
    const sv = Math.min(v.vq, bs.rv), sm = Math.min(v.mq, bs.rm);
    // ETC/Duration reflect the time to pump the FULL nominated quantity —
    // not however much ROB happens to be left. Running out of ROB partway
    // through is a real operational fact (flagged separately via isPartial /
    // "Partial supply — insufficient ROB"), but it doesn't shrink the actual
    // pumping time the timeline is meant to show; it just means the barge
    // needs a top-up before or during that window.
    // Time-frame ETA: ETC = worst case (frame end + supply time) — this is
    // what the timeline, Free Windows, stock projection and Availability
    // Check all read as the barge's occupancy.
    const etc = _vesselJobETC(bargeStart, v, barge.vtph, barge.mtph, P);
    let rva = bs.rv-sv, rma = bs.rm-sm;
    const nxt = sequence[i+1];
    const vLow = rva < barge.vbuf || (nxt && nxt.vq > 0 && (rva-nxt.vq) < barge.vbuf);
    const mLow = rma < barge.mbuf || (nxt && nxt.mq > 0 && (rma-nxt.mq) < barge.mbuf);
    if (vLow) vAl.push({after:v.name, rob:Math.round(rva), top:Math.round(VCAP-rva), before:nxt?.name||null, etc, barge:barge.name});
    if (mLow) mAl.push({after:v.name, rob:Math.round(rma), top:Math.round(MCAP-rma), before:nxt?.name||null, etc, barge:barge.name});

    let refuelSlot = null;
    if (v.refuel && (v.rfv > 0 || v.rfm > 0)) {
      const rfStart = addHrs(etc, P.travelHrs);
      const rfDuration = Math.max(v.rfv / (v.rfvr||750), v.rfm / (v.rfmr||275));
      const rfEnd = addHrs(rfStart, rfDuration);
      rva = Math.min(VCAP, rva + v.rfv);
      rma = Math.min(MCAP, rma + v.rfm);
      refuelSlot = { rfStart, rfEnd, rfDuration, rfv: v.rfv, rfm: v.rfm };
      bs.cursor = addHrs(rfEnd, P.travelHrs);
    } else {
      bs.cursor = etc;
    }

    // Ranged nominations: everything above planned with v.vq/v.mq = the TOP of
    // the range; the range rides along on the item only for display.
    const rangeF = {};
    if (v.vqMin != null) { rangeF.nomVMin = Math.round(v.vqMin); rangeF.nomVMax = Math.round(v.vq || 0); }
    if (v.mqMin != null) { rangeF.nomMMin = Math.round(v.mqMin); rangeF.nomMMax = Math.round(v.mq || 0); }
    // Time-frame ETA rides along on the item (only when set): eta = frame start.
    if (v.sts) rangeF.sts = true;          // ship-to-ship supply — rides along for display only
    if (v.etaWin) { rangeF.etaWin = v.etaWin; rangeF.supplyHrs = P.hoseHrs + Math.max(v.vq / (barge.vtph || 300), v.mq / (barge.mtph || 100)); }
    sched.push(Object.assign({sno:i+1, nomUid:v.nomUid||null, name:v.name, area:v.area, spec:v.spec, agent:v.agent, mani:v.mani, lc:v.lc, eta:v.eta||v.effectiveETA, bargeStart, etc, bargeLabel:barge.name, vQ:Math.round(sv), mQ:Math.round(sm), nomVQ:Math.round(v.vq||0), nomMQ:Math.round(v.mq||0), robVA:Math.round(rva), robMA:Math.round(rma), isPartial:sv<v.vq||sm<v.mq, isDelayed:v.isDelayed, isEarly:v.isEarly, noFirmETA:v.noFirmETA, waitedForBarge, totalHrs:(etc-bargeStart)/3600000, vLow, mLow, paq:v.paq, VCAP, MCAP, refuelSlot}, rangeF, v.held ? { held: true, lcOnly: true } : v.lcOnly ? { lcOnly: true } : {}));
    bs.rv=rva; bs.rm=rma;
    totV+=sv; totM+=sm;
  }
  return { sequence, sched, vAl, mAl, blockMoves, totV, totM, bargeState, meta };
}

/* ─── CALCULATE ─── */
let _calculating = false; // Guard: prevent concurrent schedule generation (Issue 1 fix)
function calculate() {
  if (_calculating) { console.warn('ABPS: schedule generation already in progress — ignored'); return; }
  _calculating = true;
  try {
  let vessels;
  try { vessels = getVessels(); } catch(e) { _calculating = false; return; }
  if (!vessels.length) { alert('Add at least one vessel.'); _calculating = false; return; }
  const barges = getBarges();
  if (!barges.length) { alert('Add at least one barge.'); _calculating = false; return; }
  // Nominations without a valid IMO / MMSI: one summary warning, never a block.
  try { _vidWarnSchedule(); } catch (e) { console.warn('ABPS: IMO/MMSI check failed', e); }
  // Vessels that came outside laycan before: one summary warning, never a block.
  try { _trWarnSchedule(); } catch (e) { console.warn('ABPS: track record check failed', e); }

  // Warn (don't block) on near-duplicate vessel names — likely typos that would otherwise
  // silently create two separate checklist entries for what is probably the same vessel.
  (function warnNearDuplicateVesselNames() {
    function lev(a, b) {
      const m = a.length, n = b.length;
      if (!m) return n; if (!n) return m;
      const d = Array.from({length:m+1}, (_,i) => [i, ...Array(n).fill(0)]);
      for (let j=0;j<=n;j++) d[0][j] = j;
      for (let i=1;i<=m;i++) for (let j=1;j<=n;j++)
        d[i][j] = a[i-1]===b[j-1] ? d[i-1][j-1] : 1+Math.min(d[i-1][j], d[i][j-1], d[i-1][j-1]);
      return d[m][n];
    }
    const seen = [];
    const flagged = [];
    vessels.forEach(v => {
      const nm = (v.name||'').toLowerCase();
      seen.forEach(prev => {
        if (prev === nm) return; // exact duplicate handled elsewhere / is intentional (e.g. two calls)
        const dist = lev(prev, nm);
        if (dist > 0 && dist <= 2 && Math.min(prev.length, nm.length) > 4) {
          flagged.push(prev + '  /  ' + nm);
        }
      });
      seen.push(nm);
    });
    if (flagged.length) {
      const unique = [...new Set(flagged)];
      console.warn('ABPS: possible vessel name typo(s) detected:', unique);
      alert('Heads up — these vessel names look very similar and might be a typo for the same vessel:\n\n' +
            unique.join('\n') +
            '\n\nIf they really are two different vessels, you can ignore this. Otherwise, fix the spelling so they don\'t show up as separate checklist entries.');
    }
  })();

  // Opening = what is actually on board NOW: computeLiveROB reads the saved
  // supplies / reloads / overrides, so it stays out of the pure planner.
  const opening = {};
  barges.forEach(b => {
    let openV = b.vrob, openM = b.mrob;
    try { const live = computeLiveROB(b.id, b.name, b.vrob, b.mrob, null); openV = live.v; openM = live.m; } catch(e) {}
    opening[b.id] = { v: openV, m: openM };
  });
  const { sched, vAl, mAl, blockMoves, totV, totM, bargeState } = planSchedule({ vessels, barges, opening, params: _planCtxLive() });

  _bargeStates = bargeState; _bargeConfig = barges;
  // Compute aggregate last ETC across all barges (latest cursor = overall last completion)
  let _lastETC_agg = null;
  let _closingV_agg = 0, _closingM_agg = 0;
  barges.forEach(function(b) {
    const bs = bargeState[b.id];
    if (bs) {
      _closingV_agg += bs.rv;
      _closingM_agg += bs.rm;
      if (bs.cursor && (!_lastETC_agg || bs.cursor > _lastETC_agg)) _lastETC_agg = bs.cursor;
    }
  });
  _lastETC = _lastETC_agg;
  _closingV = _closingV_agg;
  _closingM = _closingM_agg;
  // Stamp what this schedule was built from before it's rendered + saved,
  // so Free Windows can tell when nominations/barges change afterwards.
  _stampScheduleMeta();
  renderOutput(sched, totV, totM, vAl, mAl, barges, bargeState);
  if(typeof _routerOnScheduleReady==='function') _routerOnScheduleReady();
  // Sync all modules after schedule generation
  setTimeout(refreshAllModules, 100);
  showToast('Schedule generated — ' + vessels.length + ' vessel' + (vessels.length!==1?'s':'') + ' across ' + barges.length + ' barge' + (barges.length!==1?'s':''), 'success');
  if (blockMoves.length) {
    showToast('Unavailable blocks moved ' + blockMoves.length + ' job' + (blockMoves.length !== 1 ? 's' : '') + ': ' +
      blockMoves.map(m => m.vessel + ' on ' + m.barge + ' waits for "' + m.reason + '" until ' + fmt24(m.to)).join('; ') + '. Check laycans.', 'warning', 10000);
  }
  } catch(e) {
    console.error('ABPS schedule generation failed:', e);
    alert('Something went wrong generating the schedule: ' + (e && e.message ? e.message : e) + '\n\nPlease try again. If this keeps happening, let support know.');
  } finally {
    _calculating = false; // Always release guard, even if generation threw partway through
  }
}


function renderOutput(sched, totV, totM, vAl, mAl, barges, bargeState) {
  _lastSched = sched;
  // page routing handles visibility
  // page router handles navigation

  const totalOpeningV = Object.values(bargeState).reduce((sum, bs) => sum + bs._openingV, 0);
  const totalOpeningM = Object.values(bargeState).reduce((sum, bs) => sum + bs._openingM, 0);
  const closingV = totalOpeningV - Math.round(totV);
  const closingM = totalOpeningM - Math.round(totM);

  document.getElementById('sum-cards').innerHTML = `
    <div class="scard"><label>VLSFO to be Supplied</label><span>${Math.round(totV).toLocaleString()}</span><small>Metric Tonnes</small></div>
    <div class="scard"><label>MGO to be Supplied</label><span>${Math.round(totM).toLocaleString()}</span><small>Metric Tonnes</small></div>
    <div class="scard"><label>Closing VLSFO ROB</label><span>${closingV.toLocaleString()}</span><small>Opening ${totalOpeningV.toLocaleString()} − To be Supplied ${Math.round(totV).toLocaleString()} MT</small></div>
    <div class="scard"><label>Closing MGO ROB</label><span>${closingM.toLocaleString()}</span><small>Opening ${totalOpeningM.toLocaleString()} − To be Supplied ${Math.round(totM).toLocaleString()} MT</small></div>`;

  renderPAQReminders(sched);
  renderNSCPerBarge(barges, bargeState);
  renderScheduleReminders();
  // Inject new schedule entries into the persistent checklist (never overwrites existing)
  injectChecklistFromSchedule(sched);
  renderChecklist(sched);
  // Update remaining supply tracker immediately after schedule generation
  if(typeof renderRemainingSupplyTracker==="function") renderRemainingSupplyTracker();
  renderSavedRecords();
  renderLiveROBDashboard();
  // Refresh report charts (port by vessel, monthly trend etc) after schedule generate
  if(typeof renderReportCharts==="function") setTimeout(function(){ renderReportCharts(_savedSupplies); }, 100);
  // Persist the new schedule immediately so it survives reload/navigation/other devices
  if (typeof saveSharedState === 'function') { try { saveSharedState(); } catch(e) { console.error('ABPS: saveSharedState after generate failed:', e); } }

  const dlSpan = document.getElementById('per-barge-dl-btns');
  if (dlSpan && barges.length > 1) {
    dlSpan.innerHTML = barges.map(b => `<button class="btn btn-secondary btn-sm" onclick="downloadExcelForBarge(${Number(b.id)})">⬇ ${esc(b.name)}</button>`).join('');
  } else if (dlSpan) { dlSpan.innerHTML = ''; }

  // Barge ROB Summary is now rendered by renderLiveROBDashboard via renderBargeROBSummaryFromLive
  // Just show a placeholder until Live ROB is rendered
  const brs = document.getElementById('barge-rob-summary');
  if (brs) { brs.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:10px;text-align:center">Syncing with Live ROB…</div>'; }

  function buildAP(el, alerts, fuel) {
    if (alerts.length) {
      el.className = 'apanel fired';
      let h = `<div class="apt"><div class="apdot"></div>${fuel} Refuel — ${alerts.length} Alert${alerts.length>1?'s':''}</div>`;
      alerts.forEach((a,i) => h += `<div class="arow"><div class="snum">${i+1}</div><div>After <strong>${esc(a.after)}</strong> (ETC ${fmt24(a.etc)}) — ROB <strong>${a.rob.toLocaleString()} MT</strong> on <strong>${esc(a.barge||'barge')}</strong>. ${a.before?`Refuel before <strong>${esc(a.before)}</strong>.`:'Refuel at earliest.'} Top-up: <strong>~${a.top.toLocaleString()} MT</strong>.</div></div>`);
      el.innerHTML = h;
    } else {
      el.className = 'apanel clear';
      el.innerHTML = `<div class="apt"><div class="apdot"></div>${fuel} Refuel</div><div class="arow">${fuel} ROB sufficient. No refuel required.</div>`;
    }
  }
  buildAP(document.getElementById('ap-v'), vAl, 'VLSFO');
  buildAP(document.getElementById('ap-m'), mAl, 'MGO');
  renderBargeTabsAndTL(sched, barges);
}

function renderBargeTabsAndTL(sched, barges) {
  const tlWrap = document.getElementById('tl'), voyWrap = document.getElementById('voy-barge-tabs');
  const bargeGroups = {};
  barges.forEach(b => { bargeGroups[b.id] = {name:b.name, items:[]}; });

  // Filter: active vessels only for timeline (exclude completed & saved).
  // Per nomination (nomUid), not per vessel name — a re-nominated vessel
  // must still show up after its earlier supply was saved.
  const isDone = item => _isScheduleItemCompleted(item);

  sched.forEach(item => {
    const bid = Object.keys(bargeGroups).find(id => bargeGroups[id].name === item.bargeLabel);
    if (bid) bargeGroups[bid].items.push(item);
    else { const firstKey = Object.keys(bargeGroups)[0]; if (firstKey) bargeGroups[firstKey].items.push(item); }
  });
  const bargeKeys = barges.map(b => b.id);
  const cmap = _bargeColorMap();

  if (barges.length > 1) {
    let tabsHtml = '<div class="barge-tl-tabs">';
    bargeKeys.forEach((bid,i) => { tabsHtml += `<button class="barge-tl-tab${i===0?' active':''}"${_bargeAttrs(bargeGroups[bid].name, cmap)} onclick="switchBargeTL('${escJs(bid)}')">${esc(bargeGroups[bid].name)}</button>`; });
    tabsHtml += '</div>';
    bargeKeys.forEach((bid,i) => { tabsHtml += `<div id="tl-${bid}" style="${i>0?'display:none':''}"></div>`; });
    tlWrap.innerHTML = tabsHtml;
    bargeKeys.forEach(bid => buildTL(bargeGroups[bid].items.filter(item => !isDone(item)), `tl-${bid}`, _loadingsForBargeName(bargeGroups[bid].name).concat(_transfersForBargeName(bargeGroups[bid].name))));
  } else {
    tlWrap.innerHTML = '<div id="tl-single"></div>';
    const singleBargeName = bargeKeys[0] ? bargeGroups[bargeKeys[0]].name : '';
    buildTL(sched.filter(item => !isDone(item)), 'tl-single', _loadingsForBargeName(singleBargeName).concat(_transfersForBargeName(singleBargeName)));
  }

  if (voyWrap) {
    const colHdrs = `<th style="width:36px;text-align:center;padding:8px 6px">
      <label title="Select all / deselect all" style="cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px">
        <input type="checkbox" id="voy-select-all" onchange="toggleAllVoyPrint(this.checked)" style="width:14px;height:14px;accent-color:#93C4F7;cursor:pointer">
        <span style="font-size:8px;color:rgba(255,255,255,.65);letter-spacing:.04em;font-weight:700">PRINT</span>
      </label>
    </th><th>No.</th><th>Vessel</th><th>Anchorage</th><th>FO (MT)</th><th>MGO (MT)</th><th>Spec</th><th>Nominated Laycan</th><th>Actual ETA</th><th>Supply Start</th><th>ETC</th><th>Supply Sequence</th><th>Laycan Status</th><th>PAQ</th><th>Agent</th><th>Barge</th><th>Sampling / Manifold</th>`;

    // Exclude saved/completed nominations — only show pending (unsupplied) in voyage schedule
    const filterActive = function(items){
      return items.filter(function(item){ return !_isScheduleItemCompleted(item); });
    };

    if (barges.length > 1) {
      let vtHtml = '<div class="barge-tl-tabs">';
      bargeKeys.forEach((bid,i) => { vtHtml += `<button class="barge-tl-tab${i===0?' active':''}"${_bargeAttrs(bargeGroups[bid].name, cmap)} onclick="switchBargeTbl('${escJs(bid)}')">${esc(bargeGroups[bid].name)}</button>`; });
      vtHtml += '</div>';
      bargeKeys.forEach((bid,i) => {
        const activeItems = filterActive(bargeGroups[bid].items);
        vtHtml += `<div id="voy-tab-${bid}" style="${i>0?'display:none':''}">
          <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
            <button onclick="downloadBargePDF('${escJs(bid)}', this)" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;background:var(--ink-solid);color:#fff;border:none;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              Download ${esc(bargeGroups[bid].name)} PDF
            </button>
          </div>
          <div class="voy-wrap"><table class="voy-tbl"><thead><tr>${colHdrs}</tr></thead><tbody>${buildVoyRows(activeItems)}</tbody></table></div>
        </div>`;
      });
      voyWrap.innerHTML = vtHtml;
    } else {
      const singleBid = bargeKeys[0];
      const bargeName = singleBid ? (bargeGroups[singleBid]?.name || 'Barge') : 'Barge';
      voyWrap.innerHTML = `
        <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
          <button onclick="downloadBargePDF('${escJs(singleBid)}', this)" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;background:var(--ink-solid);color:#fff;border:none;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            Download ${esc(bargeName)} PDF
          </button>
        </div>
        <div class="voy-wrap"><table class="voy-tbl"><thead><tr>${colHdrs}</tr></thead><tbody>${buildVoyRows(filterActive(sched))}</tbody></table></div>`;
    }
  }
}


function switchBargeTL(bid) {
  // Hide all tl- divs inside #tl
  const tlWrap = document.getElementById('tl');
  if (!tlWrap) return;
  tlWrap.querySelectorAll('[id^="tl-"]').forEach(el => el.style.display='none');
  const tlEl = document.getElementById('tl-'+bid);
  if (tlEl) tlEl.style.display='';
  tlWrap.querySelectorAll('.barge-tl-tab').forEach(function(el) {
    const bname = (_bargeConfig||[]).find(function(b){return b.id==bid;});
    el.classList.toggle('active', el.textContent.trim() === (bname?bname.name:''));
  });
}

function switchBargeTbl(bid) {
  const voyWrap = document.getElementById('voy-barge-tabs');
  if (!voyWrap) return;
  // Only hide voy-tab- divs (not any other elements)
  voyWrap.querySelectorAll('[id^="voy-tab-"]').forEach(el => el.style.display='none');
  const tblEl = document.getElementById('voy-tab-'+bid);
  if (tblEl) tblEl.style.display='';
  voyWrap.querySelectorAll('.barge-tl-tab').forEach(function(el) {
    const bname = (_bargeConfig||[]).find(function(b){return b.id==bid;});
    el.classList.toggle('active', el.textContent.trim() === (bname?bname.name:''));
  });
}

function buildVoyRows(items) {
  const cmapV = _bargeColorMap(), stsL = _stsLookup();
  if (!items || !items.length) return '<tr><td colspan="17" style="text-align:center;padding:24px;color:var(--muted);font-size:13px">No vessels scheduled. Add vessel nominations and generate the schedule.</td></tr>';
  return items.map((item,idx) => {
    const nomV_ = (item.nomVQ !== undefined && item.nomVQ !== null) ? item.nomVQ : item.vQ;
    const nomM_ = (item.nomMQ !== undefined && item.nomMQ !== null) ? item.nomMQ : item.mQ;
    const fo = nomV_>0?esc(_nomQtyTxt(item,'V',nomV_)):'—', mo = nomM_>0?esc(_nomQtyTxt(item,'M',nomM_)):'—';
    const seq  = classifySeq(item, idx, items);
    const plan = seq.label;
    const lcIn = !!(item.lc&&item.eta&&_itemEtaEnd(item)>=item.lc.from&&item.eta<=item.lc.to);
    const lcStr = item.lc?`<span class="lc-rng ${lcIn?'in':'out'}">${fmtLC(item.lc)}</span>`:'—';
    const clRec = _checklistRecords ? Object.values(_checklistRecords).find(r => r.lockedAt && _recordMatchesScheduleItem(r, item)) : null;
    const completedBadge = clRec ? '<span class="stag" style="background:var(--green-lt);color:var(--green);border:1px solid var(--green-bd);margin-left:4px">Done</span>' : '';
    const displayNo = idx + 1; // Re-number from 1 after filtering
    const st = (item.noFirmETA
      ? '<span class="stag" style="background:var(--purple-lt);color:var(--purple);border:1px solid var(--purple-bd)">No Firm ETA</span>'
      : item.isDelayed?'<span class="stag st-dl">Delayed</span>':item.isEarly?'<span class="stag st-early">Before Laycan</span>' + _holdBtn(item):item.held?'<span class="stag st-ok" title="Laycan only: the vessel arrives early and is supplied once the laycan opens">On Laycan · held</span>':'<span class="stag st-ok">On Laycan</span>') + completedBadge;
    const seqStyle = seq.type === 'arrival'
      ? 'background:var(--green-lt);color:var(--green);border:1px solid var(--green-bd)'
      : 'background:var(--azure-lt);color:var(--azure);border:1px solid var(--azure-bd)';
    const pl = `<span class="stag" style="${seqStyle}">${esc(plan)}</span>`;
    const paqT = item.paq==='yes'?'<span class="stag st-ok">Received</span>':'<span class="stag st-dl">Pending</span>';
    const rowBg = item.noFirmETA ? 'background:rgba(240,230,255,.35)' : '';
    const cls = ` style="${rowBg}"` + (_stsOf(stsL, item) ? ' class="is-sts"' : '') + (item.nomUid ? ` data-nu="${esc(item.nomUid)}"` : '');
    const areaS = areaShort(item.area);
    const etaDisplay = item.noFirmETA
      ? `<span style="color:var(--purple);font-style:italic">${_itemEtaTxt(item)} <span style="font-size:9px;font-weight:700">(NO FIRM ETA)</span></span>`
      : _itemEtaTxt(item);
    const chkCell = `<td style="text-align:center;padding:6px 4px"><input type="checkbox" class="voy-print-chk" data-sno="${esc(item.sno)}" checked style="width:15px;height:15px;accent-color:var(--azure);cursor:pointer" title="Include in print"></td>`;
    return `<tr${cls}>${chkCell}<td class="sno">${esc(item.sno)}</td><td><strong>${esc(item.name)}</strong><span data-sts-slot>${_stsTag({ sts: _stsOf(stsL, item) })}</span></td><td style="font-size:11px;font-weight:700;font-family:DM Mono,monospace">${esc(areaS)}</td><td>${fo}</td><td>${mo}</td><td style="font-size:11px">${esc(item.spec||'—')}</td><td>${lcStr}</td><td>${etaDisplay}</td><td>${fmt24(item.bargeStart)}</td><td>${fmt24(item.etc)}</td><td>${pl}</td><td>${st}</td><td>${paqT}</td><td>${esc(item.agent||'—')}</td><td style="font-size:11px">${_bargeDot(item.bargeLabel, cmapV)}${esc(item.bargeLabel||'—')}</td><td style="font-size:11px">${esc(item.mani||'—')}</td></tr>`;
  }).join('');
}

function toggleAllVoyPrint(checked) {
  document.querySelectorAll('.voy-print-chk').forEach(chk => { chk.checked = checked; });
}

function toggleRefuelPanel(id) {
  const chk = document.getElementById(`v${id}-refuel-chk`);
  const panel = document.getElementById(`v${id}-refuel-panel`);
  if (panel) panel.style.display = chk.checked ? 'block' : 'none';
  calcRefuelTime(id);
  saveSharedState();
}

function calcRefuelTime(id) {
  const rfv = parseFloat(document.getElementById(`v${id}-rfv`)?.value)||0;
  const rfm = parseFloat(document.getElementById(`v${id}-rfm`)?.value)||0;
  const rfvr = parseFloat(document.getElementById(`v${id}-rfvr`)?.value)||750;
  const rfmr = parseFloat(document.getElementById(`v${id}-rfmr`)?.value)||275;
  const prev = document.getElementById(`v${id}-rfprev`); if (!prev) return;
  if (rfv <= 0 && rfm <= 0) { prev.style.display='none'; return; }
  const rfDuration = Math.max(rfv/(rfvr||750), rfm/(rfmr||275));
  prev.style.display = 'block';
  prev.innerHTML = `Barge refuelling: VLSFO <strong>${rfv.toLocaleString()} MT</strong> + MGO <strong>${rfm.toLocaleString()} MT</strong> — Loading time: <strong>${durStr(rfDuration)}</strong> + 2 hr transit. Next vessel scheduled after refuel completes.`;
}

function buildTL(items, containerId, loadingsForBarge) {
  const stsL = _stsLookup();
  const tl = document.getElementById(containerId);
  if (!tl) return;
  tl.innerHTML = '';

  // Merge vessel supply items with this barge's Loading entries into one
  // chronological sequence — a Loading now shows up as its own entry in
  // between the vessel cards it actually falls between, instead of as a
  // separate summary block above the whole timeline.
  const vEntries = (items || []).map(function(it) { return { type: 'vessel', time: new Date(it.bargeStart || it.eta), item: it }; });
  const lEntries = (loadingsForBarge || []).map(function(r) { return { type: 'loading', time: new Date(r.startAt), rec: r }; });
  const merged = vEntries.concat(lEntries).sort(function(a, b) { return a.time - b.time; });
  const cmap = _bargeColorMap();

  if (!merged.length) {
    tl.innerHTML = '<div style="background:var(--green-lt);border:1.5px solid var(--green-bd);border-radius:12px;padding:20px;text-align:center;margin-bottom:1rem">' +
      '<div style="margin-bottom:8px;display:flex;justify-content:center"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 12 15 17 9"/></svg></div>' +
      '<div style="font-size:14px;font-weight:700;color:var(--green);margin-bottom:4px">All Vessels Completed</div>' +
      '<div style="font-size:12px;color:var(--green)">All vessels in this schedule have been marked as completed and saved. Timeline is clear.</div>' +
      '</div>';
    return;
  }
  merged.forEach(entry => {
    if (entry.type === 'loading' && _isTransfer(entry.rec)) {
      // Barge-to-barge transfer — purple; both barges are busy for its whole window.
      const rec = entry.rec;
      const toN = _resolveRecordBargeName(rec), fromN = rec.fromBarge || '';
      const ld = document.createElement('div');
      ld.className = 'tli tli-transfer';
      ld.innerHTML = `<div class="tls"><div class="tld" style="background:var(--purple)"></div><div class="tll"></div></div>
      <div class="tlc" style="border-color:var(--purple-bd);background:var(--purple-lt)">
        <div class="tlch"><div class="tlvn" style="color:var(--purple)">Barge transfer — ${esc(fromN)} → ${esc(toN)}</div><div class="br"><span class="tb" style="background:var(--purple);color:#fff;border:1px solid var(--purple-bd)">${esc(rec.grade)}</span><span class="tb" style="background:var(--surface);color:var(--purple);border:1px solid var(--purple-bd)">Barge busy</span></div></div>
        <div class="tlm">
          <div class="tmi"><label>Transfer Start</label><span>${_ldStartTxt(rec)}</span></div>
          <div class="tmi"><label>Transfer End</label><span>${fmt24(new Date(rec.endAt))}</span></div>
          <div class="tmi"><label>Quantity</label><span>${(Number(rec.qty)||0).toLocaleString()} MT</span></div>
          <div class="tmi"><label>Discharges</label><span>${esc(fromN)}</span></div>
          <div class="tmi"><label>Receives</label><span>${esc(toN)}</span></div>
          ${rec.surveyor ? `<div class="tmi"><label>Surveyor</label><span>${esc(rec.surveyor)}</span></div>` : ''}
        </div>
        ${rec.notes ? `<div style="font-size:11px;color:var(--sub);margin-top:8px">${esc(rec.notes)}</div>` : ''}
      </div>`;
      tl.appendChild(ld);
      return;
    }
    if (entry.type === 'loading') {
      const rec = entry.rec;
      const gradeColor = rec.grade === 'LSMGO' ? 'var(--fuel-m)' : 'var(--fuel-v)';
      const gradeColorBg = rec.grade === 'LSMGO' ? 'var(--fuel-m-lt)' : 'var(--fuel-v-lt)';
      const ld = document.createElement('div');
      ld.className = 'tli';
      ld.innerHTML = `<div class="tls"><div class="tld" style="background:var(--amber)"></div><div class="tll"></div></div>
      <div class="tlc" style="border-color:var(--amber-bd);background:var(--amber-lt)">
        <div class="tlch"><div class="tlvn">Loading — ${esc(rec.terminal)}</div><div class="br"><span class="tb" style="background:${gradeColorBg};color:${gradeColor};border:1px solid var(--amber-bd)">${esc(rec.grade)}</span>${_bargePill(_resolveRecordBargeName(rec), cmap)}</div></div>
        <div class="tlm">
          <div class="tmi"><label>Loading Start</label><span>${_ldStartTxt(rec)}</span></div>
          <div class="tmi"><label>Loading End</label><span>${fmt24(new Date(rec.endAt))}</span></div>
          <div class="tmi"><label>Quantity</label><span>${(Number(rec.qty)||0).toLocaleString()} MT</span></div>
          ${rec.surveyor ? `<div class="tmi"><label>Surveyor</label><span>${esc(rec.surveyor)}</span></div>` : ''}
        </div>
        ${rec.notes ? `<div style="font-size:11px;color:var(--sub);margin-top:8px">${esc(rec.notes)}</div>` : ''}
      </div>`;
      tl.appendChild(ld);
      return;
    }
    const item = entry.item;
    const vP = Math.min(100, Math.round((item.robVA/item.VCAP)*100));
    const mP = Math.min(100, Math.round((item.robMA/item.MCAP)*100));
    const vC = vP<15?'var(--red)':vP<30?'var(--amber)':'var(--fuel-v)';
    const mC = mP<15?'var(--red)':mP<30?'var(--amber)':'var(--fuel-m)';
    const tlNomV=(item.nomVQ!==undefined&&item.nomVQ!==null)?item.nomVQ:item.vQ, tlNomM=(item.nomMQ!==undefined&&item.nomMQ!==null)?item.nomMQ:item.mQ;
    const qty = [tlNomV>0?`VLSFO ${esc(_nomQtyTxt(item,'V',tlNomV))} MT`:'', tlNomM>0?`MGO ${esc(_nomQtyTxt(item,'M',tlNomM))} MT`:''].filter(Boolean).join(' | ')||'—';
    const dc  = (item.vLow||item.mLow)?'var(--red)':item.noFirmETA?'var(--purple)':item.isDelayed?'var(--amber)':item.isEarly?'var(--teal)':'var(--azure)';
    const cc  = (item.vLow&&item.mLow)?'wvm':item.vLow?'wv':item.mLow?'wm':item.isDelayed?'del':'';
    const supB= item.isPartial?`<span class="tb tb-pt">Part Supply</span>`:`<span class="tb tb-ok">Full Supply</span>`;
    const dlB = item.noFirmETA
      ? `<span class="tb" style="background:var(--purple-lt);color:var(--purple);border:1px solid var(--purple-bd)">No Firm ETA</span>`
      : item.isDelayed?`<span class="tb tb-dl">Delayed</span>`:item.isEarly?`<span class="tb tb-early">Before Laycan</span>` + _holdBtn(item):item.held?`<span class="tb tb-on" title="Laycan only: supplied once the laycan opens">On Laycan · held</span>`:`<span class="tb tb-on">On Laycan</span>`;
    const vB  = item.vLow?`<span class="tb tb-wv">VLSFO Alert</span>`:'';
    const mB  = item.mLow?`<span class="tb tb-wm">MGO Alert</span>`:'';
    const paqB= item.paq==='yes'?`<span class="tb tb-ok">PAQ ✓</span>`:`<span class="tb tb-dl">PAQ Pending</span>`;
    const bgSt = _bargeStyle(item.bargeLabel, cmap);
    const bgB = item.bargeLabel?(bgSt?`<span class="tb tb-bg" data-bgn="${esc(String(item.bargeLabel).trim())}" style="${bgSt}">${esc(item.bargeLabel)}</span>`:`<span class="tb tb-on">${esc(item.bargeLabel)}</span>`):'';
    const areaLabel = AREA_OPTIONS.find(o=>o.value===item.area)?.label || item.area || '—';
    const vT  = (item.vLow && item.refuelSlot && item.refuelSlot.rfv>0)?`<div class="cat cat-v"><div class="pdot" style="background:var(--red)"></div>VLSFO ROB LOW — refuelling scheduled</div>`:(item.vLow?`<div class="cat cat-v"><div class="pdot" style="background:var(--red)"></div>VLSFO ROB LOW</div>`:'');
    const mT  = (item.mLow && item.refuelSlot && item.refuelSlot.rfm>0)?`<div class="cat cat-m"><div class="pdot" style="background:var(--amber)"></div>MGO ROB LOW — refuelling scheduled</div>`:(item.mLow?`<div class="cat cat-m"><div class="pdot" style="background:var(--amber)"></div>MGO ROB LOW</div>`:'');
    const pT  = item.isPartial?`<div class="pt-tag">Partial supply — insufficient ROB</div>`:'';
    const dlN = item.noFirmETA
      ? `<div class="dl-note" style="background:var(--purple-lt);border-color:var(--purple-bd);color:var(--purple)">ETA is 00:00 — no firm arrival time confirmed. This vessel is scheduled last, after all firm-ETA vessels. Update ETA when confirmed.</div>`
      : item.isDelayed?`<div class="dl-note">Actual ETA (${_itemEtaTxt(item)}) is outside nominated laycan (${fmtLC(item.lc)}). Vessel slotted by ETA order.</div>`:item.isEarly?`<div class="dl-note" style="background:var(--teal-lt);border-color:var(--teal-bd);color:var(--teal)">Actual ETA (${_itemEtaTxt(item)}) is before nominated laycan opens (${fmtLC(item.lc)}).</div>`:'';

    const waitN = item.waitedForBarge?`<div class="travel-notice">Vessel arrived at ${_itemEtaTxt(item)} but barge was still on previous job. Supply started at ${fmt24(item.bargeStart)} (after previous ETC + 1 hr travel buffer).</div>`:'';
    // Time-frame ETA: say how the slot was reserved (frame start → frame end + supply).
    const tfN = item.etaWin && _etaFrame(item.etaWin) ? `<div class="travel-notice tf-note">ETA given as a time frame — <strong>${_etaFrameTxt(item.etaWin)}</strong>. Barge ready from ${fmt24(item.bargeStart)}; reserved until ${fmt24(item.etc)} (frame end + ${durStr(item.supplyHrs || 0)} supply, latest ETC).</div>` : '';
    // Hours of the frame actually inside this job (0 when the barge only got there after the frame ended).
    const tfEnd = (item.etaWin && _etaFrame(item.etaWin)) ? _etaFrameEnd(item.eta instanceof Date ? item.eta : parseDT(item.eta), item.etaWin) : null;
    const tfIn = (tfEnd instanceof Date && item.bargeStart) ? Math.max(0, Math.min(_etaFrameHrs(item.etaWin), (tfEnd - new Date(item.bargeStart)) / 3600000)) : 0;
    const travN = (!item.waitedForBarge&&item.sno>1)?`<div class="travel-notice" style="color:var(--green);background:var(--green-lt);border-color:var(--green-bd)">Barge free before vessel ETA. Supply starts on vessel arrival.</div>`:'';
    const rfBlock = item.refuelSlot ? `
      <div style="margin-top:12px;padding:10px 14px;background:linear-gradient(90deg,var(--teal-lt),var(--surface));border:1.5px solid var(--fuel-m-bd);border-radius:8px">
        <div style="font-size:11px;font-weight:700;color:var(--teal);letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px">Barge Refuelling Slot</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;font-size:11.5px">
          <div class="tmi"><label>Loading Start</label><span>${fmt24(item.refuelSlot.rfStart)}</span></div>
          <div class="tmi"><label>Loading End</label><span>${fmt24(item.refuelSlot.rfEnd)}</span></div>
          <div class="tmi"><label>VLSFO Loading</label><span>${item.refuelSlot.rfv.toLocaleString()} MT</span></div>
          <div class="tmi"><label>MGO Loading</label><span>${item.refuelSlot.rfm.toLocaleString()} MT</span></div>
        </div>
      </div>` : '';
    const d = document.createElement('div');
    const itemSts = _stsOf(stsL, item);
    d.className = 'tli' + (itemSts ? ' is-sts' : '');
    if (item.nomUid) d.setAttribute('data-nu', item.nomUid);
    if (bgSt) { d.setAttribute('data-bc', '1'); d.setAttribute('data-bgn', String(item.bargeLabel).trim()); d.setAttribute('style', bgSt); }
    d.innerHTML = `<div class="tls"><div class="tld" style="background:${dc}"></div><div class="tll"></div></div>
    <div class="tlc ${cc}">
      <div class="tlch"><div class="tlvn">#${esc(item.sno)} — ${esc(item.name)}<span data-sts-slot>${_stsTag({ sts: itemSts })}</span></div><div class="br">${_etaFrameTag(item.etaWin)}${dlB}${supB}${vB}${mB}${paqB}${bgB}</div></div>
      <div class="tlm">
        <div class="tmi"><label>Laycan</label><span>${fmtLC(item.lc)}</span></div>
        <div class="tmi"><label>Actual ETA</label><span>${_itemEtaTxt(item)}</span></div>
        <div class="tmi"><label>Supply Start</label><span>${fmt24(item.bargeStart)}</span></div>
        <div class="tmi"><label>${item.etaWin ? 'ETC (latest)' : 'ETC'}</label><span>${fmt24(item.etc)}</span></div>
        <div class="tmi"><label>Duration</label><span>${durStr(item.totalHrs)}${tfIn > 0 ? ' <small style="color:var(--muted)">incl. ' + durStr(tfIn) + ' frame</small>' : ''}</span></div>
        <div class="tmi"><label>Quantity</label><span>${qty}</span></div>
      </div>
      <div style="font-size:11px;color:var(--sub);margin-bottom:8px">📍 ${esc(areaLabel)}</div>
      <div class="rbs">
        <div class="rbr"><span class="rbl">VLSFO</span><div class="rbt"><div class="rbf" style="width:${vP}%;background:${vC}"></div></div><span class="rbv" style="color:${vC}">${item.robVA.toLocaleString()} MT</span></div>
        <div class="rbr"><span class="rbl">MGO</span><div class="rbt"><div class="rbf" style="width:${mP}%;background:${mC}"></div></div><span class="rbv" style="color:${mC}">${item.robMA.toLocaleString()} MT</span></div>
      </div>
      ${(item.vLow||item.mLow)?`<div class="cat-tags">${vT}${mT}</div>`:''}
      ${pT}${dlN}${tfN}${waitN}${travN}${rfBlock}
    </div>`;
    tl.appendChild(d);
  });
}

