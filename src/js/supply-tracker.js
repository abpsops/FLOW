// ═══════════════════════════════════════════════════════
// REMAINING SUPPLY TRACKER
// Shows planned vs supplied vs remaining per vessel + total
// ═══════════════════════════════════════════════════════
// Checklist record → the item shape _recordMatchesScheduleItem() expects, so
// the saved-supply fallback matches this nomination (nomUid, or name + date)
// rather than ANY earlier supply to a vessel of the same name.
function _rstRecAsItem(rec){
  return { name: rec.vessel, nomUid: rec.nomUid || null, eta: rec.supplyDate || rec.eta || null };
}
function renderRemainingSupplyTracker(){
  var el=document.getElementById('remaining-supply-tracker');
  if(!el)return;
  var recs=Object.values(_checklistRecords||{}).filter(function(r){return r.state!=='completed';}).sort(function(a,b){return a.sno-b.sno;});

  // Deduplicate PER NOMINATION (as the Checklist does): a row per nomUid;
  // only legacy rows without one fall back to the vessel name. Deduping by
  // name alone dropped a genuine second call of the same ship (different
  // dates, grades, even barges) from the table.
  var seenKeys = new Set();
  recs = recs.filter(function(r) {
    var key = r.nomUid ? 'n:' + r.nomUid : 'v:' + (r.vessel || '').trim().toLowerCase();
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  if(!recs.length){
    el.innerHTML='<div style="font-size:12px;color:var(--muted);padding:14px;text-align:center">Generate schedule first to see remaining quantities.</div>';
    return;
  }

  // Prune stale selections — a ticked uid that no longer has a matching
  // pending record (e.g. vessel completed or removed) should not linger.
  (function _pruneRSTSelection(){
    if (!_rstSelected.size) return;
    var live = new Set(recs.map(function(r){return r.uid;}));
    Array.from(_rstSelected).forEach(function(u){ if (!live.has(u)) _rstSelected.delete(u); });
  })();

  // Grand total across ALL barges for whatever rows are currently ticked.
  var rstSelV = 0, rstSelM = 0, rstSelCount = 0;
  recs.forEach(function(rec){
    if (!_rstSelected.has(rec.uid)) return;
    rstSelCount++;
    rstSelV += Number(rec.nomV) || 0;
    rstSelM += Number(rec.nomM) || 0;
  });

  var barges = _bargeConfig && _bargeConfig.length ? _bargeConfig : [{id:'all',name:'All Barges',vrob:0,mrob:0,vbuf:0,mbuf:0}];

  // Helper to resolve which barge a record belongs to (same matching logic
  // used for the visible rows below) — needed so completed vessels' actuals
  // still get subtracted from the right barge's ROB even though they're no
  // longer shown as individual rows.
  function _matchBargeId(rec) {
    var label = (rec.bargeLabel||'').toLowerCase().trim();
    for (var bi=0; bi<barges.length; bi++) {
      if (label === barges[bi].name.toLowerCase().trim()) return barges[bi].id;
    }
    for (var bi=0; bi<barges.length; bi++) {
      if (label.indexOf(barges[bi].name.toLowerCase().trim())>=0) return barges[bi].id;
    }
    return barges[0].id;
  }

  // Completed vessels are hidden from the tracker's rows, but their already-
  // delivered quantities must still reduce the barge's ROB — otherwise the
  // running ROB total would look higher than what's actually left on board.
  var completedTotals = {}; // bargeId -> {v, m}
  barges.forEach(function(b){ completedTotals[b.id] = {v:0, m:0}; });
  Object.values(_checklistRecords||{}).forEach(function(rec){
    if (rec.state !== 'completed') return;
    var bid = _matchBargeId(rec);
    var saved=(_savedSupplies||[]).find(function(r){return r.checklistUid===rec.uid;})
            || (_savedSupplies||[]).find(function(r){return _recordMatchesScheduleItem(r, _rstRecAsItem(rec));});
    var aV=saved?(parseFloat(saved.vlsfoAct)||0):(parseFloat(rec.actV)||0);
    var aM=saved?(parseFloat(saved.mgoAct)||0):(parseFloat(rec.actM)||0);
    completedTotals[bid].v += aV;
    completedTotals[bid].m += aM;
  });

  // Map records to barges
  var bargeMap = {}; // bargeId -> {barge, recs}
  barges.forEach(function(b){ bargeMap[b.id]={barge:b,recs:[]}; });

  recs.forEach(function(rec){
    bargeMap[_matchBargeId(rec)].recs.push(rec);
  });

  var html='';
  var hdr=function(txt,col){return '<th style="padding:6px 12px;text-align:right;color:'+(col||'rgba(255,255,255,.5)')+';font-size:9px;text-transform:uppercase;font-weight:600;letter-spacing:.05em">'+txt+'</th>';};

  barges.forEach(function(b){
    var bargeRecs=bargeMap[b.id].recs;
    var isEmpty = !bargeRecs.length && !(completedTotals[b.id].v||completedTotals[b.id].m);

    var openV=b.vrob||0, openM=b.mrob||0;
    // stN = planned qty for PENDING (not-yet-completed) rows only (Subtotal display)
    // stA = actuals for PENDING rows only (Subtotal display)
    var stNV=0, stNM=0, stAV=0, stAM=0;
    // pendingNV/pendingNM = planned quantities for truly PENDING items (state !== completed && state !== saved)
    // used for ROB After All Planned Supplies projection
    var pendingNV=0, pendingNM=0;
    // selV/selM = sum of nominated qty for rows in THIS barge that are ticked (display total)
    // selRemV/selRemM = sum of REMAINING-to-supply qty for ticked rows (state!=='saved' only,
    // matching pendingNV's convention) — this is what actually still needs deducting from
    // Live ROB, since already-delivered actuals are already reflected in Live ROB.
    var selV=0, selM=0, selCount=0, selRemV=0, selRemM=0;
    var rowHtml='';

    bargeRecs.forEach(function(rec){
      var nV=Number(rec.nomV)||0,nM=Number(rec.nomM)||0;
      var isSel = _rstSelected.has(rec.uid);
      var saved=(_savedSupplies||[]).find(function(r){return r.checklistUid===rec.uid;})
              || (_savedSupplies||[]).find(function(r){return _recordMatchesScheduleItem(r, _rstRecAsItem(rec));});
      var aV=saved?(parseFloat(saved.vlsfoAct)||0):(parseFloat(rec.actV)||0);
      var aM=saved?(parseFloat(saved.mgoAct)||0):(parseFloat(rec.actM)||0);
      var rV=Math.max(0,nV-aV),rM=Math.max(0,nM-aM);
      if (isSel) {
        selCount++; selV+=nV; selM+=nM;
        if (rec.state !== 'saved') { selRemV += rV; selRemM += rM; }
      }
      // Subtotal: ONLY pending/uncompleted items (exclude saved=executed records from pending calc)
      stNV+=nV; stNM+=nM; stAV+=aV; stAM+=aM;
      // Track remaining planned qty for truly pending items (no actuals yet)
      // This is used for "ROB after all planned supplies" projection
      if (rec.state !== 'saved') {
        pendingNV += Math.max(0, nV - aV);
        pendingNM += Math.max(0, nM - aM);
      }

      var badge=rec.state==='completed'
        ?'<span style="font-size:9px;padding:2px 7px;border-radius:4px;background:var(--green-lt);color:var(--green);font-weight:700">Done</span>'
        :rec.state==='saved'
          ?'<span style="font-size:9px;padding:2px 7px;border-radius:4px;background:var(--azure-lt);color:var(--azure);font-weight:700">Saved</span>'
          :'<span style="font-size:9px;padding:2px 7px;border-radius:4px;background:var(--amber-lt);color:var(--amber);font-weight:700">Pending</span>';

      var vRem=nV>0?(rV>0?'<span style="font-family:DM Mono,monospace;font-weight:700;color:var(--red)">'+rV.toLocaleString()+' MT</span>':'<span style="color:var(--green);font-weight:700">&#10003;</span>'):'&mdash;';
      var mRem=nM>0?(rM>0?'<span style="font-family:DM Mono,monospace;font-weight:700;color:var(--red)">'+rM.toLocaleString()+' MT</span>':'<span style="color:var(--green);font-weight:700">&#10003;</span>'):'&mdash;';

      var dateDisplay = (rec.supplyDate ? fmt24(rec.supplyDate instanceof Date ? rec.supplyDate : new Date(rec.supplyDate)) : '&mdash;') + (rec.etaWin ? ' ' + _etaFrameTag(rec.etaWin) : '');

      rowHtml+='<tr data-rst-uid="'+esc(rec.uid)+'" style="border-bottom:0.5px solid var(--border2)'+(isSel?';background:rgba(107,198,255,.08)':'')+'">'
        +'<td class="rst-select-col" style="padding:9px 10px;text-align:center"><input type="checkbox" onchange="toggleRSTSelection(\''+escJs(rec.uid)+'\', this.checked)" '+(isSel?'checked':'')+' style="width:15px;height:15px;cursor:pointer;accent-color:var(--azure,#3B82F6)" title="Tick to include this vessel in the Selected total and image export"></td>'
        +'<td style="padding:9px 14px;font-weight:600;color:var(--ink)">'+esc(rec.vessel)+'</td>'
        +'<td style="padding:9px 12px;font-family:DM Mono,monospace;font-size:11px;color:var(--sub);white-space:nowrap">'+dateDisplay+'</td>'
        +'<td style="padding:9px 10px;text-align:center">'+badge+'</td>'
        +'<td style="padding:9px 12px;text-align:right;font-family:DM Mono,monospace;color:var(--azure)">'+(nV>0?nV.toLocaleString()+' MT':'&mdash;')+'</td>'
        +'<td style="padding:9px 12px;text-align:right;font-family:DM Mono,monospace;color:'+(aV>0?'var(--teal)':'var(--muted)')+'">'+(nV>0?aV.toLocaleString()+' MT':'&mdash;')+'</td>'
        +'<td style="padding:9px 12px;text-align:right">'+vRem+'</td>'
        +'<td style="padding:9px 12px;text-align:right;font-family:DM Mono,monospace;color:var(--teal)">'+(nM>0?nM.toLocaleString()+' MT':'&mdash;')+'</td>'
        +'<td style="padding:9px 12px;text-align:right;font-family:DM Mono,monospace;color:'+(aM>0?'var(--teal)':'var(--muted)')+'">'+(nM>0?aM.toLocaleString()+' MT':'&mdash;')+'</td>'
        +'<td style="padding:9px 12px;text-align:right">'+mRem+'</td>'
        +'</tr>';
    });

    // Subtotal = ONLY pending items shown in table (not completed, not saved-executed)
    var tRV=Math.max(0,stNV-stAV), tRM=Math.max(0,stNM-stAM);

    // ── Live ROB (After Actuals) ──────────────────────────────────────────────
    // RULE: Use ONLY completed/actual supplies from computeLiveROB.
    // DO NOT include planned or pending supplies.
    // computeLiveROB deducts only records with non-zero vlsfoAct/mgoAct (_savedSupplies).
    var _lrob = computeLiveROB(b.id, b.name, b.vrob || 0, b.mrob || 0, null);
    var robLiveV = openV > 0 ? _lrob.v : null;
    var robLiveM = openM > 0 ? _lrob.m : null;

    // ── ROB After All Planned Supplies ────────────────────────────────────────
    // RULE: Base = Live ROB (actuals already applied). Subtract ONLY pending planned
    // quantities (items not yet executed/saved). DO NOT re-deduct completed actuals.
    var robAfterV = robLiveV !== null ? Math.max(0, robLiveV - pendingNV) : null;
    var robAfterM = robLiveM !== null ? Math.max(0, robLiveM - pendingNM) : null;

    // ── ROB After Selected (Ticked) Supplies ────────────────────────────────────
    // RULE: Base = Live ROB (actuals already applied). Subtract ONLY the remaining
    // qty of vessels the user has TICKED in this barge. DO NOT re-deduct actuals
    // already reflected in Live ROB. Always the exact remaining nominated amount —
    // never held back just because it exceeds what's currently on board.
    var robSelV = (robLiveV !== null && selCount > 0) ? Math.max(0, robLiveV - selRemV) : null;
    var robSelM = (robLiveM !== null && selCount > 0) ? Math.max(0, robLiveM - selRemM) : null;

    if (isEmpty) {
      // Nothing pending or completed for this barge yet — still show its
      // own block (so every configured barge always appears, however many
      // there are) but as a clean empty state rather than a table full of
      // misleading zeros / "Done" badges.
      html+=
        '<div class="rst-barge-block" data-rst-barge="'+esc(b.id)+'" style="margin-bottom:18px">'
        +'<div style="background:var(--ink-solid);padding:8px 14px;display:flex;align-items:center;gap:10px">'
          +'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6BC6FF" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M3 11V8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3"/><line x1="12" y1="11" x2="12" y2="22"/></svg>'
          +'<span style="font-size:11px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.08em">'+esc(b.name)+'</span>'
          +(openV>0?'<span style="margin-left:auto;font-size:10px;color:rgba(107,198,255,.7)">Opening ROB: VLSFO '+openV.toLocaleString()+' MT &nbsp;|&nbsp; MGO '+openM.toLocaleString()+' MT</span>':'')
        +'</div>'
        +(robLiveV!==null?
          '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:9px 14px;background:var(--amber-lt)">'
            +'<span style="font-size:11px;color:var(--amber);font-weight:600">Live ROB (after actuals)</span>'
            +'<span style="font-family:DM Mono,monospace;font-size:12px;font-weight:700;color:var(--amber)">VLSFO '+robLiveV.toLocaleString()+' MT</span>'
            +(robLiveM!==null?'<span style="font-family:DM Mono,monospace;font-size:12px;font-weight:700;color:var(--amber)">MGO '+robLiveM.toLocaleString()+' MT</span>':'')
          +'</div>'
        :'')
        +'<div style="font-size:12px;color:var(--muted);padding:16px 14px;text-align:center">No pending or completed supplies assigned to '+esc(b.name)+' yet.</div>'
        +'</div>';
      return;
    }

    html+=
      '<div class="rst-barge-block" data-rst-barge="'+esc(b.id)+'" style="margin-bottom:18px">'
      // Barge header
      +'<div style="background:var(--ink-solid);padding:8px 14px;display:flex;align-items:center;gap:10px">'
        +'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6BC6FF" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M3 11V8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3"/><line x1="12" y1="11" x2="12" y2="22"/></svg>'
        +'<span style="font-size:11px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.08em">'+esc(b.name)+'</span>'
        +(openV>0?'<span style="margin-left:auto;font-size:10px;color:rgba(107,198,255,.7)">Opening ROB: VLSFO '+openV.toLocaleString()+' MT &nbsp;|&nbsp; MGO '+openM.toLocaleString()+' MT</span>':'')
      +'</div>'
      +'<div style="overflow-x:auto">'
      +'<table style="width:100%;border-collapse:collapse;font-size:12px">'
      +'<thead>'
        +'<tr style="background:var(--ink-solid)">'
          +'<th class="rst-select-col" style="padding:7px 10px;color:#fff;font-size:9.5px;text-transform:uppercase" title="Tick vessels to include in the Selected total and image export">Sel.</th>'
          +'<th style="padding:7px 14px;text-align:left;color:#fff;font-size:9.5px;text-transform:uppercase;white-space:nowrap">Vessel</th>'
          +'<th style="padding:7px 12px;text-align:left;color:#fff;font-size:9.5px;text-transform:uppercase;white-space:nowrap">Date / Actual ETA</th>'
          +'<th style="padding:7px 10px;color:#fff;font-size:9.5px;text-transform:uppercase">Status</th>'
          +'<th colspan="3" style="padding:7px 12px;text-align:center;color:var(--fuel-v-bd);font-size:9.5px;text-transform:uppercase;border-left:1px solid rgba(255,255,255,.1)">VLSFO</th>'
          +'<th colspan="3" style="padding:7px 12px;text-align:center;color:var(--fuel-m-bd);font-size:9.5px;text-transform:uppercase;border-left:1px solid rgba(255,255,255,.1)">LSMGO</th>'
        +'</tr>'
        +'<tr style="background:var(--navy2)">'
          +'<th class="rst-select-col"></th><th></th><th></th><th></th>'
          +hdr('Planned','rgba(107,198,255,.7)')+hdr('Supplied','rgba(255,255,255,.5)')+hdr('Remaining','rgba(255,255,255,.5)')
          +hdr('Planned','rgba(107,198,255,.7)')+hdr('Supplied','rgba(255,255,255,.5)')+hdr('Remaining','rgba(255,255,255,.5)')
        +'</tr>'
      +'</thead>'
      +'<tbody>'+rowHtml+'</tbody>'
      +'<tfoot>'
        // Totals row — unchanged: always the full, exact nominated quantity
        // still to be supplied, regardless of ROB availability or ticks.
        +'<tr style="background:var(--bg);border-top:2px solid var(--border)">'
          +'<td class="rst-select-col"></td>'
          +'<td style="padding:9px 14px;font-weight:700;color:var(--ink)" colspan="3">SUBTOTAL (REMAINING)</td>'
          +'<td style="padding:9px 12px;text-align:right;font-family:DM Mono,monospace;font-weight:700;color:var(--azure)">'+stNV.toLocaleString()+' MT</td>'
          +'<td style="padding:9px 12px;text-align:right;font-family:DM Mono,monospace;color:var(--teal)">'+stAV.toLocaleString()+' MT</td>'
          +'<td style="padding:9px 12px;text-align:right;font-weight:700;color:'+(tRV>0?'var(--red)':'var(--green)')+'">'+(tRV>0?tRV.toLocaleString()+' MT':'&#10003; Done')+'</td>'
          +'<td style="padding:9px 12px;text-align:right;font-family:DM Mono,monospace;font-weight:700;color:var(--teal)">'+stNM.toLocaleString()+' MT</td>'
          +'<td style="padding:9px 12px;text-align:right;font-family:DM Mono,monospace;color:var(--teal)">'+stAM.toLocaleString()+' MT</td>'
          +'<td style="padding:9px 12px;text-align:right;font-weight:700;color:'+(tRM>0?'var(--red)':'var(--green)')+'">'+(tRM>0?tRM.toLocaleString()+' MT':'&#10003; Done')+'</td>'
        +'</tr>'
        // TOTAL (SELECTED) row — shows ONLY the ticked vessels' nominated
        // quantity for this barge. Always the exact nominated figure (never
        // reduced for ROB shortage — whatever is short still gets supplied).
        +(selCount>0?
          '<tr style="background:rgba(107,198,255,.08);border-top:1px dashed var(--azure-bd)">'
            +'<td class="rst-select-col"></td>'
            +'<td style="padding:8px 14px;font-size:11px;font-weight:700;color:var(--azure)" colspan="3">TOTAL (SELECTED) &mdash; '+selCount+' vessel'+(selCount>1?'s':'')+' ticked</td>'
            +'<td style="padding:8px 12px;text-align:right;font-family:DM Mono,monospace;font-weight:700;color:var(--azure)">'+selV.toLocaleString()+' MT</td>'
            +'<td></td><td></td>'
            +'<td style="padding:8px 12px;text-align:right;font-family:DM Mono,monospace;font-weight:700;color:var(--teal)">'+selM.toLocaleString()+' MT</td>'
            +'<td></td><td></td>'
          +'</tr>'
        :'')
        // Live ROB row (opening - actuals supplied so far)
        +(robLiveV!==null?
          '<tr style="background:var(--amber-lt);border-top:1px dashed var(--amber-bd)">'
            +'<td class="rst-select-col"></td>'
            +'<td style="padding:7px 14px;font-size:11px;color:var(--amber);font-weight:600" colspan="3">Live ROB (after actuals)</td>'
            +'<td></td><td></td>'
            +'<td style="padding:7px 12px;text-align:right;font-family:DM Mono,monospace;font-size:12px;font-weight:700;color:'+(robLiveV<(b.vbuf||0)?'var(--red)':'var(--amber)')+'">'+(robLiveV.toLocaleString())+' MT</td>'
            +'<td></td><td></td>'
            +'<td style="padding:7px 12px;text-align:right;font-family:DM Mono,monospace;font-size:12px;font-weight:700;color:'+(robLiveM<(b.mbuf||0)?'var(--red)':'var(--amber)')+'">'+(robLiveM!==null?robLiveM.toLocaleString()+' MT':'&mdash;')+'</td>'
          +'</tr>'
        :'')
        // ROB after SELECTED (ticked) supplies row — only shown when something's ticked
        +(robSelV!==null?
          '<tr style="background:rgba(107,198,255,.10);border-top:1px dashed var(--azure-bd)">'
            +'<td class="rst-select-col"></td>'
            +'<td style="padding:7px 14px;font-size:11px;color:var(--azure);font-weight:700" colspan="3">ROB after selected supplies ('+selCount+' ticked)</td>'
            +'<td></td><td></td>'
            +'<td style="padding:7px 12px;text-align:right;font-family:DM Mono,monospace;font-size:12px;font-weight:700;color:'+(robSelV<(b.vbuf||0)?'var(--red)':'var(--azure)')+'">'+(robSelV.toLocaleString())+' MT</td>'
            +'<td></td><td></td>'
            +'<td style="padding:7px 12px;text-align:right;font-family:DM Mono,monospace;font-size:12px;font-weight:700;color:'+(robSelM!==null&&robSelM<(b.mbuf||0)?'var(--red)':'var(--teal)')+'">'+(robSelM!==null?robSelM.toLocaleString()+' MT':'&mdash;')+'</td>'
          +'</tr>'
        :'')
        // Quantity Short By — how much MORE fuel this barge needs, beyond
        // what's currently on board (robLiveV/M), to fully cover whatever
        // is being checked (the ticked selection if anything's ticked,
        // otherwise the full remaining nominated amount for this barge).
        // "ROB after selected" above floors at 0 and hides a real shortfall
        // — this row surfaces the actual gap instead of silently masking it.
        +(robLiveV!==null?(function(){
          var _reqV = selCount>0 ? selRemV : tRV;
          var _reqM = selCount>0 ? selRemM : tRM;
          var _shortV = Math.max(0, _reqV - robLiveV);
          var _shortM = Math.max(0, (_reqM||0) - (robLiveM||0));
          var _enough = _shortV<=0 && _shortM<=0;
          return '<tr style="background:'+(_enough?'var(--green-lt)':'var(--red-lt)')+';border-top:1px dashed '+(_enough?'var(--green-bd)':'var(--red-bd)')+'">'
            +'<td class="rst-select-col"></td>'
            +'<td style="padding:7px 14px;font-size:11px;font-weight:700;color:'+(_enough?'var(--green)':'var(--red)')+'" colspan="3">Quantity short by'+(selCount>0?' (selected)':' (all remaining)')+'</td>'
            +'<td></td><td></td>'
            +(_enough
              ? '<td colspan="1" style="padding:7px 12px;text-align:right;font-weight:700;color:var(--green)">&#10003; Enough ROB</td><td></td><td></td>'
              : '<td style="padding:7px 12px;text-align:right;font-family:DM Mono,monospace;font-size:12px;font-weight:700;color:var(--red)">'+(_shortV>0?_shortV.toLocaleString()+' MT':'&mdash;')+'</td>'
                +'<td></td><td></td>'
                +'<td style="padding:7px 12px;text-align:right;font-family:DM Mono,monospace;font-size:12px;font-weight:700;color:var(--red)">'+(_shortM>0?_shortM.toLocaleString()+' MT':'&mdash;')+'</td>')
          +'</tr>';
        })():'')
        // ROB after ALL planned row
        +(robAfterV!==null?
          '<tr style="background:var(--azure-lt);border-top:1px dashed var(--azure-bd)">'
            +'<td class="rst-select-col"></td>'
            +'<td style="padding:7px 14px;font-size:11px;color:var(--azure);font-weight:600" colspan="3">ROB after all planned supplies</td>'
            +'<td></td><td></td>'
            +'<td style="padding:7px 12px;text-align:right;font-family:DM Mono,monospace;font-size:12px;font-weight:700;color:'+(robAfterV<(b.vbuf||0)?'var(--red)':'var(--azure)')+'">'+(robAfterV.toLocaleString())+' MT</td>'
            +'<td></td><td></td>'
            +'<td style="padding:7px 12px;text-align:right;font-family:DM Mono,monospace;font-size:12px;font-weight:700;color:'+(robAfterM!==null&&robAfterM<(b.mbuf||0)?'var(--red)':'var(--teal)')+'">'+(robAfterM!==null?robAfterM.toLocaleString()+' MT':'&mdash;')+'</td>'
          +'</tr>'
        :'')
      +'</tfoot>'
      +'</table></div>'
      +'</div>';
  });

  // Grand-total "Selected" summary bar across ALL barges — reflects only
  // the vessels currently ticked. Not part of the per-barge SUBTOTAL logic,
  // purely an additive convenience so a ticked group's combined qty is
  // visible at a glance, and it's what the image download will total too.
  var selBar = '<div class="rst-summary-bar" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:9px 14px;margin-bottom:14px;border-radius:6px;background:'
    +(rstSelCount>0?'rgba(107,198,255,.12)':'var(--bg)')+';border:1px solid '+(rstSelCount>0?'var(--azure-bd)':'var(--border2)')+'">'
    +'<span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:'+(rstSelCount>0?'var(--azure)':'var(--muted)')+'">'
      +(rstSelCount>0?('Selected: '+rstSelCount+' vessel'+(rstSelCount>1?'s':'')):'No vessels ticked')
    +'</span>'
    +(rstSelCount>0?
      ('<span style="font-family:DM Mono,monospace;font-size:12px;font-weight:700;color:var(--fuel-v)">VLSFO '+rstSelV.toLocaleString()+' MT</span>'
      +'<span style="font-family:DM Mono,monospace;font-size:12px;font-weight:700;color:var(--fuel-m)">LSMGO '+rstSelM.toLocaleString()+' MT</span>'
      +'<button onclick="clearRSTSelection()" class="btn btn-ghost btn-sm rst-noprint" style="margin-left:auto;font-size:10px;padding:3px 10px">Clear Selection</button>')
      :'<span style="font-size:11px;color:var(--muted)">Tick vessels below to see a combined selected total, and to limit the image download to just those vessels.</span>')
    +'</div>';

  el.innerHTML = (html ? (selBar + html) : '<div style="font-size:12px;color:var(--muted);padding:14px;text-align:center">No checklist records matched to barges.</div>');
}

/* ─── Download Remaining Supply Tracker as PNG ───
   Lazy-loads html2canvas (same pattern as ciLoadJSZip), renders the
   actual on-screen card — header, every per-barge table, footer
   totals — to a canvas at 2x scale for crisp text, then triggers a
   PNG file download. Nothing about the tracker's own data or layout
   changes; this only captures exactly what's already shown. ─────── */
/* Image/PDF exports always render in the Classic light look: under the
   Harbour skin the cloned document html2canvas paints from is switched back
   to classic + light, so generated files are unchanged by the skin. */
function _skinWrapH2C(fn) {
  if (!fn || !_isPremiumSkin()) return fn;
  return function(el, opts) {
    var o = Object.assign({}, opts || {}), prev = o.onclone;
    o.onclone = function(doc) {
      doc.documentElement.setAttribute('data-skin', 'classic');
      doc.documentElement.setAttribute('data-theme', 'light');
      if (typeof prev === 'function') return prev.apply(this, arguments);
    };
    return fn(el, o);
  };
}
async function _loadHtml2Canvas() {
  if (typeof html2canvas !== 'undefined') return _skinWrapH2C(html2canvas);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s.onload = () => resolve(_skinWrapH2C(window.html2canvas));
    s.onerror = () => reject(new Error('Could not load the image export library. Check your internet connection.'));
    document.head.appendChild(s);
  });
}

/* Lazy-loads jsPDF (same pattern as above) for genuine one-click PDF
   downloads — no print dialog, no "Save as PDF" step for the person
   to do themselves. */
async function _loadJsPDF() {
  if (window.jspdf && window.jspdf.jsPDF) return window.jspdf.jsPDF;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = () => resolve(window.jspdf.jsPDF);
    s.onerror = () => reject(new Error('Could not load the PDF export library. Check your internet connection.'));
    document.head.appendChild(s);
  });
}

/* Lazy-loads ExcelJS for genuinely COLORED .xlsx exports. The SheetJS
   ("xlsx.full.min.js") library already loaded at the top of this file only
   writes cell VALUES — its free tier silently drops font/fill/border
   styling on write, no matter what's set on the cell's `s:` property. That
   is a real limitation of that library, not a mistake in the styling code.
   ExcelJS is a separate, free library that actually persists styling. */
async function _loadExcelJS() {
  if (window.ExcelJS) return window.ExcelJS;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
    s.onload = () => resolve(window.ExcelJS);
    s.onerror = () => reject(new Error('Could not load the Excel export library. Check your internet connection.'));
    document.head.appendChild(s);
  });
}

/* Shared capture core for the Remaining Supply Tracker card — used by both
   the "Download as Image" and "Download as PDF" buttons. Unclips overflow,
   hides ticked-only rows/checkbox columns as needed, rasterizes, then always
   restores the live DOM exactly as it was.
   Alignment fix: previously each barge's table was shrunk to its OWN
   natural content width ('max-content' per table), while the card wrapping
   all of them sized to the WIDEST table. A barge with shorter vessel names
   (e.g. a single-vessel barge) then rendered narrower than the card and left
   a blank gap to its right in the export — visible as the empty strip next
   to shorter barge blocks. Fix: measure every table's natural width first,
   then force ALL tables (and their overflow-x wrappers) to that same widest
   width, so every barge block lines up edge-to-edge with no gaps. */
// iOS Safari silently produces a blank/null canvas past ~8000px on a side
// (or ~16.7M pixels total) — cap the html2canvas scale to stay inside that.
function _safeCanvasScale(desired, w, h) {
  w = Math.max(1, w || 1); h = Math.max(1, h || 1);
  const byWidth = 8000 / w, byHeight = 8000 / h, byArea = Math.sqrt(16000000 / (w * h));
  return Math.max(0.5, Math.min(desired, byWidth, byHeight, byArea));
}

async function _captureRemainingSupplyTrackerCanvas(scale) {
  const card = document.getElementById('remaining-tracker-card');
  if (!card) throw new Error('Tracker card not found.');

  // The card itself has overflow:hidden, and its inner table is often wrapped
  // in its own overflow-x:auto div — both clip the real content width. Without
  // removing both, html2canvas captures only what's visible and the right
  // edge gets cut off. Temporarily unclip everything, capture, then restore.
  const clippers = [card, ...Array.from(card.querySelectorAll('[style*="overflow-x:auto"], [style*="overflow-x: auto"]'))];
  const clipperOrigStyles = clippers.map(el => ({ overflow: el.style.overflow, overflowX: el.style.overflowX, width: el.style.width }));
  clippers.forEach(el => { el.style.overflow = 'visible'; el.style.overflowX = 'visible'; });

  // The tables themselves are styled width:100%, which stretches them to
  // fill the full card width even when the content is much narrower — and
  // the card itself is a block element that fills its parent regardless of
  // how narrow the table inside becomes. Both must shrink to their natural
  // content width before capture, or the image keeps a wide blank margin on
  // the right even after the table itself is narrowed. Restore both after.
  const cardOrigWidth = card.style.width;
  card.style.width = 'max-content';
  const tables = Array.from(card.querySelectorAll('table'));
  const tableOrigWidths = tables.map(t => t.style.width);
  // Step 1: let every table settle to its OWN natural width so it can be measured.
  tables.forEach(t => { t.style.width = 'max-content'; });
  // Step 2: force every table — and its overflow-x wrapper — to the WIDEST
  // one's width, so no barge block is left narrower than the card around it.
  const wrapDivs = Array.from(card.querySelectorAll('[style*="overflow-x:auto"], [style*="overflow-x: auto"]'));
  const wrapOrigWidths = wrapDivs.map(w => w.style.width);
  const maxTableWidth = Math.max(0, ...tables.map(t => Math.max(t.scrollWidth, t.offsetWidth)));
  tables.forEach(t => { t.style.width = maxTableWidth + 'px'; });
  wrapDivs.forEach(w => { w.style.width = maxTableWidth + 'px'; });

  // If specific vessels are ticked, the exported image should show ONLY
  // those ticked rows (plus their totals) — not the full tracker. Hide
  // everything else for the capture, then restore it right after.
  const hasTickedSelection = _rstSelected && _rstSelected.size > 0;
  const hiddenForExport = [];
  if (hasTickedSelection) {
    Array.from(card.querySelectorAll('tr[data-rst-uid]')).forEach(tr => {
      if (!_rstSelected.has(tr.getAttribute('data-rst-uid'))) {
        hiddenForExport.push({ el: tr, disp: tr.style.display });
        tr.style.display = 'none';
      }
    });
    Array.from(card.querySelectorAll('[data-rst-barge]')).forEach(blk => {
      const anyVisible = Array.from(blk.querySelectorAll('tr[data-rst-uid]'))
        .some(tr => tr.style.display !== 'none');
      if (!anyVisible) {
        hiddenForExport.push({ el: blk, disp: blk.style.display });
        blk.style.display = 'none';
      }
    });
  }
  // The tick-mark checkboxes themselves and any interactive controls (e.g.
  // "Clear Selection") are UI-only — never useful in a static exported
  // image — so they're always hidden for the capture, ticked or not.
  Array.from(card.querySelectorAll('.rst-select-col, .rst-noprint')).forEach(elx => {
    hiddenForExport.push({ el: elx, disp: elx.style.display });
    elx.style.display = 'none';
  });

  try {
    const html2canvasFn = await _loadHtml2Canvas();

    // Measure AFTER unclipping/equalizing so scrollWidth reflects the true,
    // tightly-fitted, ALIGNED content size rather than the stretched 100% width.
    const fullWidth  = Math.max(card.scrollWidth,  card.offsetWidth);
    const fullHeight = Math.max(card.scrollHeight, card.offsetHeight);

    const canvas = await html2canvasFn(card, {
      backgroundColor: '#ffffff',
      scale: _safeCanvasScale(scale, fullWidth, fullHeight),
      useCORS: true,
      logging: false,
      width: fullWidth,
      height: fullHeight,
      windowWidth: fullWidth,
      windowHeight: fullHeight,
      scrollX: 0,
      scrollY: 0
    });

    return { canvas: canvas, hasTickedSelection: hasTickedSelection };
  } finally {
    clippers.forEach((el, i) => {
      el.style.overflow = clipperOrigStyles[i].overflow;
      el.style.overflowX = clipperOrigStyles[i].overflowX;
    });
    tables.forEach((t, i) => { t.style.width = tableOrigWidths[i]; });
    wrapDivs.forEach((w, i) => { w.style.width = wrapOrigWidths[i]; });
    card.style.width = cardOrigWidth;
    hiddenForExport.forEach(h => { h.el.style.display = h.disp; });
  }
}

async function downloadRemainingSupplyTrackerPNG() {
  const btn = document.getElementById('rst-download-btn');
  const card = document.getElementById('remaining-tracker-card');
  if (!card) return;

  const recs = Object.values(_checklistRecords || {});
  if (!recs.length) {
    alert('Nothing to download yet — generate a schedule first so the tracker has data to show.');
    return;
  }

  const origLabel = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="animation:spin .8s linear infinite"><path d="M21 12a9 9 0 1 1-2.64-6.36"/></svg> Preparing image…';
  }
  // Yield to the browser so it actually PAINTS the spinner above before the
  // heavy synchronous rasterization below locks up the main thread.
  await new Promise(r => setTimeout(r, 0));

  try {
    const cap = await _captureRemainingSupplyTrackerCanvas(4); // high resolution, presentation-ready output
    const canvas = cap.canvas, hasTickedSelection = cap.hasTickedSelection;

    const stamp = new Date();
    const fname = (hasTickedSelection ? 'Remaining-Supply-Tracker-Selected-' : 'Remaining-Supply-Tracker-') + stamp.getFullYear() +
      String(stamp.getMonth()+1).padStart(2,'0') + String(stamp.getDate()).padStart(2,'0') +
      '-' + String(stamp.getHours()).padStart(2,'0') + String(stamp.getMinutes()).padStart(2,'0') + '.png';

    canvas.toBlob(function(blob) {
      if (!blob) { alert('Could not generate the image. Please try again.'); return; }
      _flowSaveOrShareBlob(blob, fname);
    }, 'image/png');

  } catch (e) {
    alert('Could not download the image: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origLabel; }
  }
}

/* ─── Download Remaining Supply Tracker as PDF ───
   Same capture core as the PNG export (same alignment fix, same ticked-only
   filtering), but paginates the result into a proper multi-page PDF via
   jsPDF — the tracker can run to many barges/vessels and easily exceed a
   single page's height, unlike the shorter per-barge schedule PDF. ─────── */
async function downloadRemainingSupplyTrackerPDF() {
  const btn = document.getElementById('rst-download-pdf-btn');
  const card = document.getElementById('remaining-tracker-card');
  if (!card) return;

  const recs = Object.values(_checklistRecords || {});
  if (!recs.length) {
    alert('Nothing to download yet — generate a schedule first so the tracker has data to show.');
    return;
  }

  const origLabel = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="animation:spin .8s linear infinite"><path d="M21 12a9 9 0 1 1-2.64-6.36"/></svg> Preparing PDF…';
  }
  await new Promise(r => setTimeout(r, 0));

  try {
    const jsPDF = await _loadJsPDF();
    const cap = await _captureRemainingSupplyTrackerCanvas(3);
    const canvas = cap.canvas, hasTickedSelection = cap.hasTickedSelection;

    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const marginMM = 8;
    const renderW = pageW - marginMM * 2;
    const pxPerMM = canvas.width / renderW;
    const pageHeightPx = Math.floor((pageH - marginMM * 2) * pxPerMM);

    let renderedPx = 0, pageIdx = 0;
    while (renderedPx < canvas.height) {
      const sliceHeightPx = Math.min(pageHeightPx, canvas.height - renderedPx);
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceHeightPx;
      pageCanvas.getContext('2d').drawImage(
        canvas, 0, renderedPx, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx
      );
      if (pageIdx > 0) pdf.addPage();
      pdf.addImage(pageCanvas.toDataURL('image/png'), 'PNG', marginMM, marginMM, renderW, sliceHeightPx / pxPerMM);
      renderedPx += sliceHeightPx;
      pageIdx++;
    }

    const stamp = new Date();
    const fname = (hasTickedSelection ? 'Remaining-Supply-Tracker-Selected-' : 'Remaining-Supply-Tracker-') + stamp.getFullYear() +
      String(stamp.getMonth()+1).padStart(2,'0') + String(stamp.getDate()).padStart(2,'0') +
      '-' + String(stamp.getHours()).padStart(2,'0') + String(stamp.getMinutes()).padStart(2,'0') + '.pdf';

    await _flowSaveOrShareBlob(pdf.output('blob'), fname);

  } catch (e) {
    alert('Could not generate the PDF: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origLabel; }
  }
}

/* ─── "Email to Barge": the ticked rows of the barge tab on screen as the
   delivery-schedule e-mail to the barge's captain, in the operators' usual
   layout (one table: S. NO. … SAMPLING MANIFOLD). Opens the e-mail composer
   with the table as the formatted body: "Download Formatted Email" opens it
   in Outlook as an unsent message with the table in place; "Copy Message
   (formatted)" pastes the same into any new message. (A mail link can only
   carry plain text, so "Open in Mail App" sends the plain-text version.) */
const _VOY_EMAIL_COLS = ['S. NO.', 'VESSEL', 'ANCHORAGE AREA', 'FO (MT)', 'MGO (MT)', 'SPEC', 'NOMINATED ETA', 'ETA', 'SUPPLY PLAN', 'AGENT', 'SAMPLING MANIFOLD'];
const _MON_UP = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
function _ordDay(n) { n = Number(n); const s = (n % 100 >= 11 && n % 100 <= 13) ? 'th' : ['th', 'st', 'nd', 'rd'][Math.min(n % 10, 4)] || 'th'; return n + s; }
// "29th-31st OCT" (same month) / "30th OCT-2nd NOV"
function _voyEmailLc(lc) {
  if (!lc || !lc.from || !lc.to) return '—';
  const f = lc.from instanceof Date ? lc.from : new Date(lc.from), t = lc.to instanceof Date ? lc.to : new Date(lc.to);
  if (isNaN(f) || isNaN(t)) return '—';
  if (f.getMonth() === t.getMonth() && f.getFullYear() === t.getFullYear()) return _ordDay(f.getDate()) + '-' + _ordDay(t.getDate()) + ' ' + _MON_UP[f.getMonth()];
  return _ordDay(f.getDate()) + ' ' + _MON_UP[f.getMonth()] + '-' + _ordDay(t.getDate()) + ' ' + _MON_UP[t.getMonth()];
}
// "0600/30TH OCT"; a time-frame ETA keeps its frame text ("AM/30TH OCT")
function _voyEmailEta(item) {
  const d = item && item.eta ? (item.eta instanceof Date ? item.eta : new Date(item.eta)) : null;
  if (!d || isNaN(d)) return '—';
  const day = _ordDay(d.getDate()).toUpperCase() + ' ' + _MON_UP[d.getMonth()];
  if (item.etaWin) return String(item.etaWin).toUpperCase() + '/' + day;
  if (item.noFirmETA) return 'TBA/' + day; // 00:00 with no frame = no firm ETA (as the schedule row says)
  return String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + '/' + day;
}
function _voyEmailQty(item, g) {
  const nom = g === 'V' ? (item.nomVQ != null ? item.nomVQ : item.vQ) : (item.nomMQ != null ? item.nomMQ : item.mQ);
  const n = Math.round(parseFloat(nom) || 0);
  return n > 0 ? _nomQtyTxt(item, g, n).replace(/\s*MT$/i, '') : '0';
}
// The barge tab on screen: its id, name and e-mail, and its ticked rows in table order.
function _voyEmailSelection() {
  // Several barges: one voy-tab-<id> per barge (the visible one is on screen).
  // One barge: the table sits in the container itself.
  const tabs = Array.from(document.querySelectorAll('[id^="voy-tab-"]'));
  const tab = tabs.length ? tabs.find(el => el.style.display !== 'none') : document.getElementById('voy-barge-tabs');
  if (!tab) return null;
  const fleet = getBarges() || [];
  const barge = tabs.length ? fleet.find(b => String(b.id) === String(tab.id.replace('voy-tab-', ''))) : (fleet.length === 1 ? fleet[0] : fleet.find(b => (_lastSched || []).some(it => it && it.bargeLabel === b.name)));
  if (!barge) return null;
  const bid = barge.id;
  const ticked = new Set(Array.from(tab.querySelectorAll('.voy-print-chk:checked')).map(c => c.getAttribute('data-sno')));
  const all = (_lastSched || []).filter(it => it && it.bargeLabel === barge.name && !_isScheduleItemCompleted(it));
  const rows = all.map((it, idx) => ({ item: it, plan: classifySeq(it, idx, all).label })).filter(r => ticked.has(String(r.item.sno)));
  return { bid, barge, rows, total: all.length };
}
function _voyEmailTableHtml(rows) {
  const th = 'border:1px solid #000;padding:3px 10px;text-align:center;color:#1E7B34;font-weight:700;font-family:Calibri,Arial,sans-serif;font-size:11pt;white-space:nowrap';
  const td = 'border:1px solid #000;padding:3px 10px;text-align:center;color:#1F4E9C;font-family:Calibri,Arial,sans-serif;font-size:11pt;white-space:nowrap';
  const head = '<tr>' + _VOY_EMAIL_COLS.map(c => '<th style="' + th + '">' + esc(c) + '</th>').join('') + '</tr>';
  const body = rows.map((r, i) => {
    const it = r.item, cells = [
      [String(i + 1), 'color:#000'], [String(it.name || '').toUpperCase(), ''], [areaShort(it.area), ''],
      [_voyEmailQty(it, 'V'), ''], [_voyEmailQty(it, 'M'), ''], [String(it.spec || '').replace(/^ISO\s*/i, ''), ''],
      [_voyEmailLc(it.lc), ''], [_voyEmailEta(it), ''], [String(r.plan || '').toUpperCase(), ''], [String(it.agent || '').toUpperCase(), ''],
      [String(it.mani || '').toUpperCase(), 'background:#FFFF00;color:#000;font-weight:700']
    ];
    return '<tr>' + cells.map(c => '<td style="' + td + (c[1] ? ';' + c[1] : '') + '">' + esc(c[0]) + '</td>').join('') + '</tr>';
  }).join('');
  return '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #000;font-family:Calibri,Arial,sans-serif;font-size:11pt">' + head + body + '</table>';
}
function _voyEmailTableText(rows) {
  const line = cells => cells.join('\t');
  return [line(_VOY_EMAIL_COLS)].concat(rows.map((r, i) => { const it = r.item; return line([i + 1, String(it.name || '').toUpperCase(), areaShort(it.area), _voyEmailQty(it, 'V'), _voyEmailQty(it, 'M'), String(it.spec || '').replace(/^ISO\s*/i, ''), _voyEmailLc(it.lc), _voyEmailEta(it), String(r.plan || '').toUpperCase(), String(it.agent || '').toUpperCase(), String(it.mani || '').toUpperCase()]); })).join('\n');
}
// A formatted body with a fixed block (the voyage table): {tableHtml, tableText}.
// The plain-text box stays editable — the HTML is rebuilt from it with the table
// kept where its rows stand in the text (text before/after it becomes paragraphs).
let _emailRawHtml = null;
function _emailRebuildFormatted() {
  const t = document.getElementById('em-output-text').value, f = _emailRawHtml;
  if (!f) return _emailBodyToHtml(t);
  const i = t.indexOf(f.tableText);
  if (i < 0) return _emailBodyToHtml(t); // the table rows themselves were edited: the text as typed, nothing dropped
  const before = t.slice(0, i).replace(/\s+$/, ''), after = t.slice(i + f.tableText.length).replace(/^\s+/, '');
  return (before ? _emailBodyToHtml(before) : '') + f.tableHtml + (after ? '<p style="margin:14px 0 0 0">&nbsp;</p>' + _emailBodyToHtml(after) : '');
}
function emailVoyageToBarge() {
  if (!_lastSched || !_lastSched.length) { alert('Nothing to send yet — generate the schedule first.'); return; }
  const sel = _voyEmailSelection();
  if (!sel) { alert('No barge tab is open in the Voyage Schedule.'); return; }
  if (!sel.rows.length) { alert(sel.total ? 'No vessels selected.\nTick the rows of ' + sel.barge.name + '\'s tab to include them in the e-mail.' : 'No pending supplies on ' + sel.barge.name + '.'); return; }
  const greeting = 'Good day Captain,\n\nKindly find the below delivery scheduled for your good barge.';
  const tableText = _voyEmailTableText(sel.rows);
  const text = greeting + '\n\n' + tableText + '\n';
  // Subject dated by the first vessel's ETA day: "VOYAGE SCHEDULE AS OF 30TH OCT - FNSA 10"
  const first = sel.rows[0].item, fd = first.eta ? (first.eta instanceof Date ? first.eta : new Date(first.eta)) : null;
  const asOf = fd && !isNaN(fd) ? _ordDay(fd.getDate()).toUpperCase() + ' ' + _MON_UP[fd.getMonth()] : _ordDay(new Date().getDate()).toUpperCase() + ' ' + _MON_UP[new Date().getMonth()];
  document.getElementById('em-modal-title').textContent = 'Voyage Schedule — ' + sel.barge.name;
  document.getElementById('em-to').value = sel.barge.email || '';
  document.getElementById('em-to-note').textContent = sel.barge.email ? 'From the Captain e-mail on the barge card.' : 'No Captain e-mail on the barge card yet — type the address, or add it on the Barge Fleet card to have it filled in next time.';
  document.getElementById('em-subject').value = 'VOYAGE SCHEDULE AS OF ' + asOf + ' - ' + String(sel.barge.name || '').toUpperCase();
  document.getElementById('em-output-text').value = text;
  _emailRawHtml = { tableHtml: _voyEmailTableHtml(sel.rows), tableText: tableText };
  document.getElementById('em-output-html').innerHTML = _emailRebuildFormatted();
  document.getElementById('em-modal-error').style.display = 'none';
  document.getElementById('em-modal').style.display = 'flex';
}

/* ─── Download Voyage Schedule table as PNG image (same pattern as the
   Remaining Supply Tracker download) — captures exactly what's on screen,
   nothing about the schedule's own data or layout changes. ─────────── */
async function downloadVoyageSchedulePNG() {
  const btn = document.getElementById('voy-download-btn');
  const card = document.getElementById('voy-barge-tabs-card');
  if (!card) return;

  if (!_lastSched || !_lastSched.length) {
    alert('Nothing to download yet — generate the schedule first.');
    return;
  }

  // Only the ticked rows should appear in the image — same selection the
  // Print button already respects. Hide unchecked rows (and the checkbox
  // column itself, since it's meaningless in a static image) right before
  // capture, then restore everything afterward so the live table is
  // untouched once the download finishes.
  const allChecks = Array.from(card.querySelectorAll('.voy-print-chk'));
  const checkedCount = allChecks.filter(c => c.checked).length;
  if (allChecks.length && checkedCount === 0) {
    alert('No vessels selected.\nUse the Print checkboxes in the Voyage Schedule table to choose which vessels to include in the image.');
    return;
  }

  const hiddenRows = [];   // <tr> elements temporarily hidden
  const hiddenCells = [];  // checkbox <td>/<th> cells temporarily hidden (header + body)
  allChecks.forEach(chk => {
    const row = chk.closest('tr');
    if (row && !chk.checked) {
      hiddenRows.push(row);
      row.style.display = 'none';
    }
  });
  // Hide the checkbox column entirely (header "PRINT" cell + every body cell)
  if (allChecks.length) {
    card.querySelectorAll('tr').forEach(row => {
      const firstCell = row.querySelector('th, td');
      if (firstCell && (firstCell.querySelector('.voy-print-chk') || firstCell.querySelector('#voy-select-all'))) {
        hiddenCells.push(firstCell);
        firstCell.style.display = 'none';
      }
    });
  }

  // ── Fix #4: the "Download ... PDF" button(s) live INSIDE this same card
  // (rendered above the table for each barge tab) so html2canvas would
  // otherwise capture them into the exported image. The PDF button must
  // NEVER appear in the image output under any condition — hide every
  // such button for the duration of the capture, then restore them all
  // afterward exactly as they were (this never disables or removes the
  // PDF button from the live page, only from the screenshot).
  const pdfBtns = Array.from(card.querySelectorAll('button[onclick^="downloadBargePDF"]'));
  const pdfBtnOrigDisplay = pdfBtns.map(b => b.style.display);
  pdfBtns.forEach(b => { b.style.display = 'none'; });
  // The barge colours are for the screen: the image keeps the plain tabs and names.
  const bcEls = Array.from(card.querySelectorAll('[data-bc]'));
  bcEls.forEach(e => e.removeAttribute('data-bc'));
  const bcDots = Array.from(card.querySelectorAll('.bg-dot'));
  bcDots.forEach(d => { d.style.display = 'none'; });

  const origLabel = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="animation:spin .8s linear infinite"><path d="M21 12a9 9 0 1 1-2.64-6.36"/></svg> Preparing image…';
  }
  // Yield to the browser so it actually PAINTS the spinner above before the
  // heavy synchronous rasterization below locks up the main thread.
  await new Promise(r => setTimeout(r, 0));

  // The table can be wider than its visible scroll container (.voy-wrap has
  // overflow-x:auto). html2canvas only captures what's actually laid out —
  // if the wrapper is still clipping at capture time, the right-most columns
  // get cut off, no matter what width/windowWidth options are passed. Fix:
  // temporarily remove the clipping (overflow:visible, width:max-content)
  // from every .voy-wrap inside the card so the full table lays out and
  // renders before the screenshot, then restore those styles afterward.
  const wraps = Array.from(card.querySelectorAll('.voy-wrap'));
  const wrapOrigStyles = wraps.map(w => ({ overflow: w.style.overflow, width: w.style.width }));
  wraps.forEach(w => { w.style.overflow = 'visible'; w.style.width = 'max-content'; });

  // .voy-tbl and the card itself are both styled/sized to stretch to their
  // full container width regardless of how narrow the actual content is —
  // that leaves a wide blank margin in the downloaded image. Shrink both to
  // their natural content width too, so the image crops tightly with no
  // wasted space, then restore everything after capture.
  const cardOrigWidth = card.style.width;
  card.style.width = 'max-content';
  const tables = Array.from(card.querySelectorAll('table'));
  const tableOrigWidths = tables.map(t => t.style.width);
  tables.forEach(t => { t.style.width = 'max-content'; });

  try {
    const html2canvasFn = await _loadHtml2Canvas();

    // Now that wrappers are unclipped, the card's own scrollWidth correctly
    // reflects the full table width — measure it fresh, after the unclip.
    const fullWidth  = Math.max(card.scrollWidth,  card.offsetWidth);
    const fullHeight = Math.max(card.scrollHeight, card.offsetHeight);

    const canvas = await html2canvasFn(card, {
      backgroundColor: '#ffffff',
      scale: _safeCanvasScale(5, fullWidth, fullHeight), // capped for iOS canvas limits; high resolution, presentation-ready output — this table is wider (many columns) than the Remaining Supply Tracker, so a higher multiplier keeps text equally sharp at the larger final image size
      useCORS: true,
      logging: false,
      width: fullWidth,
      height: fullHeight,
      windowWidth: fullWidth,
      windowHeight: fullHeight,
      scrollX: 0,
      scrollY: 0
    });

    const stamp = new Date();
    const fname = 'Voyage-Schedule-' + stamp.getFullYear() +
      String(stamp.getMonth()+1).padStart(2,'0') + String(stamp.getDate()).padStart(2,'0') +
      '-' + String(stamp.getHours()).padStart(2,'0') + String(stamp.getMinutes()).padStart(2,'0') + '.png';

    canvas.toBlob(function(blob) {
      if (!blob) { alert('Could not generate the image. Please try again.'); return; }
      _flowSaveOrShareBlob(blob, fname);
    }, 'image/png');

  } catch (e) {
    alert('Could not download the image: ' + e.message);
  } finally {
    // Always restore hidden rows/cells and unclip overrides, even if capture failed
    hiddenRows.forEach(row => { row.style.display = ''; });
    hiddenCells.forEach(cell => { cell.style.display = ''; });
    pdfBtns.forEach((b, i) => { b.style.display = pdfBtnOrigDisplay[i]; });
    bcEls.forEach(e => e.setAttribute('data-bc', '1'));
    bcDots.forEach(d => { d.style.display = ''; });
    wraps.forEach((w, i) => { w.style.overflow = wrapOrigStyles[i].overflow; w.style.width = wrapOrigStyles[i].width; });
    tables.forEach((t, i) => { t.style.width = tableOrigWidths[i]; });
    card.style.width = cardOrigWidth;
    if (btn) { btn.disabled = false; btn.innerHTML = origLabel; }
  }
}

async function saveROBEdit() {
  const bargeId = _editingROBBargeId;
  const b = _bargeConfig.find(function(x) { return x.id == bargeId; });
  if (!b || bargeId === null) return;

  const newV  = parseFloat(document.getElementById('rob-edit-vlsfo').value);
  const newM  = parseFloat(document.getElementById('rob-edit-mgo').value);
  const reason = document.getElementById('rob-edit-reason').value.trim();
  const user   = document.getElementById('rob-edit-user').value.trim() || 'User';

  if (isNaN(newV) || isNaN(newM)) { alert('Enter valid numeric values.'); return; }
  if (newV < 0 || newM < 0)       { alert('ROB cannot be negative.'); return; }

  const liveROBs = getAllLiveROBs();
  const cur = liveROBs[bargeId];

  // Log the change
  const ts = new Date().toISOString();
  if (Math.round(newV) !== Math.round(cur.liveV)) {
    _robAuditLog.push({ bargeId: bargeId, bargeName: b.name, field: 'VLSFO ROB', oldVal: Math.round(cur.liveV), newVal: newV, reason: reason, editedAt: ts, editedBy: user });
  }
  if (Math.round(newM) !== Math.round(cur.liveM)) {
    _robAuditLog.push({ bargeId: bargeId, bargeName: b.name, field: 'MGO ROB', oldVal: Math.round(cur.liveM), newVal: newM, reason: reason, editedAt: ts, editedBy: user });
  }

  // Store override — set as the final override so it takes effect immediately
  if (!_manualROB) _manualROB = {};
  _manualROB[bargeId + '_final'] = { v: newV, m: newM, reason: reason, editedAt: ts, editedBy: user, atIds: _robOverrideAtIds(bargeId), updatedAt: Date.now() };
  _robMeasured(bargeId);

  await saveROBAudit();
  await saveManualROB();

  closeROBEditor();
  renderLiveROBDashboard();
  // _bargeRobSummary is re-rendered inside renderLiveROBDashboard via the call chain
  // but force it explicitly to be sure
  setTimeout(function(){ renderBargeROBSummaryFromLive(getAllLiveROBs()); }, 50);

  // Update the bargeStates used by the availability checker
  if (_bargeStates[bargeId]) {
    _bargeStates[bargeId].rv = newV;
    _bargeStates[bargeId].rm = newM;
  }

  // Flash success
  const dashEl = document.getElementById('live-rob-dashboard');
  if (dashEl) {
    const banner = document.createElement('div');
    banner.style.cssText = 'background:var(--green);color:#fff;font-size:12px;font-weight:700;padding:10px 16px;border-radius:8px;text-align:center;margin-bottom:10px';
    banner.textContent = 'ROB for ' + b.name + ' updated. VLSFO: ' + newV.toLocaleString() + ' MT | MGO: ' + newM.toLocaleString() + ' MT. Availability Checker will use new values.';
    dashEl.insertBefore(banner, dashEl.firstChild);
    setTimeout(function() { banner.remove(); }, 5000);
  }
}

async function saveManualROB() {
  // Persist overrides as-is. _final used to be stripped here (and by every
  // save), so a manual ROB edit vanished on the next save/reload unless a
  // new supply happened to trigger a bake first. saveSharedState() now
  // strips override keys only for a barge it actually bakes in that write.
  try { localStorage.setItem('abps_manual_rob_v1', JSON.stringify(_manualROB || {})); } catch(e) {}
  const saved = saveSharedState(); // local-only when no cloud; errors surface via the banner
  if (typeof _rlRefreshIfShown === 'function') _rlRefreshIfShown(); // new ROB → new forecast
  return saved;
}

async function loadManualROB() {
  // IMPORTANT: applyState() (called via loadSharedState() earlier in init())
  // already restores _manualROB from the authoritative shared/synced state —
  // that copy is always the most current one, since it's written every time
  // saveSharedState() runs from ANY save path (Barge Parameters edit, ROB
  // Summary override, etc). This function's own localStorage key
  // ('abps_manual_rob_v1') is only updated by saveManualROB() specifically,
  // which is NOT called from every save path — so it can easily go stale.
  // Unconditionally overwriting _manualROB here was clobbering a correct,
  // just-restored override with old/empty data, which is exactly what
  // caused ROB overrides to silently reset after closing and reopening.
  // Only use this as a fallback when applyState() found nothing at all.
  if (_manualROB && Object.keys(_manualROB).length > 0) return;
  // A cloud copy was loaded and it has no overrides: that's the truth (e.g.
  // a colleague cleared one) — don't resurrect this device's stale cache.
  if (_lastSyncedPayload || _cloudBaseUnknown) return;
  try {
    const raw = localStorage.getItem('abps_manual_rob_v1');
    if (raw) _manualROB = JSON.parse(raw);
  } catch(e) { /* leave _manualROB as-is */ }
}


