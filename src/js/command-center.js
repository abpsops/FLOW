/* ─── COMMAND CENTER — live wallboard for a TV/office screen ───────────
   Reads the same live data everything else on the app already uses
   (getAllLiveROBs, _lastSched, _bargeConfig) — nothing here is separately
   computed or stored, so it's always exactly in sync with the rest of
   the app with no extra save/sync path of its own. */
// #cc-clock is static markup, so it is always in the DOM — checking for it
// never stopped the timers. Check whether the Command Center page is the
// one actually showing instead, so both intervals cancel themselves once
// the user navigates away (showPage restarts them on return).
function _ccPageActive() {
  const pg = document.getElementById('page-commandcenter');
  return !!(pg && pg.classList.contains('active'));
}
function renderCommandCenter() {
  function tick() {
    const now = new Date();
    const clockEl = document.getElementById('cc-clock');
    const dateEl = document.getElementById('cc-date');
    if (!clockEl || !_ccPageActive()) { clearInterval(_ccClockInterval); _ccClockInterval = null; return; }
    clockEl.textContent = now.toLocaleTimeString('en-GB', { hour12: false });
    if (dateEl) dateEl.textContent = now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  }
  tick();
  if (_ccClockInterval) clearInterval(_ccClockInterval);
  _ccClockInterval = setInterval(tick, 1000);

  const castBtn = document.getElementById('cc-cast-btn');
  if (castBtn) castBtn.style.display = ('PresentationRequest' in window) ? '' : 'none';

  // Data panels only used to render once, when the page was first opened —
  // fine for a quick check, wrong for something meant to sit on a TV all
  // day untouched. Now refreshes on the same 30s cadence as the rest of
  // the app's auto-sync, so it stays current without anyone touching it.
  _ccRefreshData();
  if (_ccDataInterval) clearInterval(_ccDataInterval);
  _ccDataInterval = setInterval(function() {
    if (!_ccPageActive()) { clearInterval(_ccDataInterval); _ccDataInterval = null; return; }
    _ccRefreshData();
  }, 30000);

  // ── Fit the fixed 1920×1080 canvas to whatever size #cc-wallboard actually
  //    is — a phone screen, a laptop card, or a TV cast full-screen — so the
  //    layout never collapses/overflows and text is always sharp, since it's
  //    real DOM text being scaled, not a raster image. ──
  _ccFitCanvas();
  if (!_ccListenersBound) {
    _ccListenersBound = true;
    window.addEventListener('resize', _ccFitCanvas);
    document.addEventListener('fullscreenchange', _ccFitCanvas);
    document.addEventListener('webkitfullscreenchange', _ccFitCanvas);
    if ('ResizeObserver' in window) {
      _ccResizeObserver = new ResizeObserver(_ccFitCanvas);
      const wrap = document.getElementById('cc-wallboard');
      if (wrap) _ccResizeObserver.observe(wrap);
    }
  }
}

function _ccRefreshData() {
  const _ccStsL = _stsLookup();
  // ── Vessel Schedule data — computed first so the ROB panel can show a
  //    "to be supplied" total per barge alongside current ROB. ──
  // Completion is per nomination (nomUid), not vessel name — see _isScheduleItemCompleted.
  const activeItems = (_lastSched || [])
    .filter(item => !_isScheduleItemCompleted(item))
    .sort((a, b) => new Date(a.bargeStart) - new Date(b.bargeStart));

  // ── "Up Next" spotlight — real ops rooms fixate on what's happening
  //    right now/next, so this gets its own large unmissable line instead
  //    of just being row 1 of the Schedule table. ──
  const upNextEl = document.getElementById('cc-upnext');
  if (upNextEl) {
    const next = activeItems[0];
    if (next) {
      const vQty = next.nomVQ || next.vQ || 0;
      const mQty = next.nomMQ || next.mQ || 0;
      const statusColor = next.isDelayed ? '#F0A500' : '#3ECF6E';
      const statusText = next.isDelayed ? 'DELAYED' : 'ON TIME';
      upNextEl.innerHTML = `<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
        <span style="font-size:10.5px;color:#F0A500;letter-spacing:.18em;font-weight:700;flex-shrink:0">UP NEXT</span>
        <span style="font-size:19px;font-weight:700;color:#FFFFFF">${esc(next.name)}${_stsOf(_stsLookup(), next) ? _stsTagDark() : ''}</span>
        <span style="font-size:12.5px;color:#CCC">${esc(next.bargeLabel || '')}</span>
        <span style="font-size:12.5px;color:#CCC">START ${fmt24(next.bargeStart)}${next.etaWin && _etaFrame(next.etaWin) ? ' · ETA ' + _etaFrameTxt(next.etaWin) : ''}</span>
        <span style="font-size:12.5px;color:#4FD1E8">VLSFO ${vQty ? esc(_nomQtyTxt(next, 'V', vQty)) + ' MT' : '—'}</span>
        <span style="font-size:12.5px;color:#F0A542">LSMGO ${mQty ? esc(_nomQtyTxt(next, 'M', mQty)) + ' MT' : '—'}</span>
        <span style="font-size:11px;font-weight:700;color:${statusColor};margin-left:auto;flex-shrink:0">${statusText}</span>
      </div>`;
    } else {
      upNextEl.innerHTML = `<div style="font-size:11px;color:#3ECF6E;letter-spacing:.1em;font-weight:700">NO UPCOMING VESSELS</div>`;
    }
  }

  // ── Barge ROB — current level plus what's still queued to go out
  //    against it from the active schedule, per grade. ──
  const robPanel = document.getElementById('cc-rob-panel');
  const liveROBs = getAllLiveROBs();
  const _ccNowTs = Date.now();
  if (robPanel) {
    const rows = (_bargeConfig || []).map(function(b) {
      const rob = liveROBs[b.id] || { liveV: 0, liveM: 0 };
      const vPct = b.vcap ? Math.round((rob.liveV || 0) / b.vcap * 100) : 0;
      const mPct = b.mcap ? Math.round((rob.liveM || 0) / b.mcap * 100) : 0;
      const vColor = vPct < 20 ? '#E5484D' : vPct < 40 ? '#F0A500' : '#3ECF6E';
      const mColor = mPct < 20 ? '#E5484D' : mPct < 40 ? '#F0A500' : '#3ECF6E';
      const bItems = activeItems.filter(item => item.bargeLabel === b.name);
      const toSupplyV = bItems.reduce((s, i) => s + (i.nomVQ || i.vQ || 0), 0);
      const toSupplyM = bItems.reduce((s, i) => s + (i.nomMQ || i.mQ || 0), 0);
      const isFree = bItems.length === 0;

      // ROB trend — one sample every ~10min (gated, not every 30s refresh,
      // or the array would balloon and the sparkline would be pointlessly
      // dense) so this is genuinely "trend over the last several hours",
      // not just noise from the refresh interval itself.
      const hist = _ccRobHistory[b.id] || (_ccRobHistory[b.id] = []);
      const lastSample = hist[hist.length - 1];
      if (!lastSample || (_ccNowTs - lastSample.t) >= CC_ROB_SAMPLE_MS) {
        hist.push({ t: _ccNowTs, v: rob.liveV || 0, m: rob.liveM || 0 });
        if (hist.length > 48) hist.shift();
        _ccSaveRobHistory();
      }

      return `<div style="margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #222">
        <div style="font-size:13px;font-weight:700;color:#EEE;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;gap:6px">
          <span>${esc(b.name)}</span>
          ${isFree ? '<span style="font-size:8px;font-weight:700;color:#3ECF6E;border:1px solid #3ECF6E;padding:1px 5px;border-radius:2px;flex-shrink:0">AVAILABLE</span>' : ''}
        </div>
        <div style="font-size:12.5px;color:#FFFFFF;display:flex;justify-content:space-between"><span>VLSFO</span><span style="color:${vColor}">${Math.round(rob.liveV || 0).toLocaleString()} MT (${vPct}%)</span></div>
        <div style="font-size:12.5px;color:#FFFFFF;display:flex;justify-content:space-between;margin-top:3px"><span>LSMGO</span><span style="color:${mColor}">${Math.round(rob.liveM || 0).toLocaleString()} MT (${mPct}%)</span></div>
        ${_ccSparklineSvg(hist)}
        <div style="margin-top:6px;padding-top:6px;border-top:1px dashed #222">
          <div style="font-size:9.5px;color:#F0A500;letter-spacing:.06em;margin-bottom:3px">TO BE SUPPLIED</div>
          <div style="font-size:12.5px;color:#FFFFFF;display:flex;justify-content:space-between"><span>VLSFO</span><span style="color:#4FD1E8">${toSupplyV ? toSupplyV.toLocaleString() + ' MT' : '—'}</span></div>
          <div style="font-size:12.5px;color:#FFFFFF;display:flex;justify-content:space-between;margin-top:3px"><span>LSMGO</span><span style="color:#F0A542">${toSupplyM ? toSupplyM.toLocaleString() + ' MT' : '—'}</span></div>
        </div>
      </div>`;
    }).join('');
    robPanel.innerHTML = '<div style="font-size:11.5px;color:#F0A500;letter-spacing:.1em;margin-bottom:9px;border-bottom:1px solid #2A2A2A;padding-bottom:6px">BARGE ROB</div>' +
      (rows || '<div style="font-size:12.5px;color:#FFFFFF">No barges configured</div>') +
      // "BACK TO OPS" as real in-flow content, not an absolutely-positioned
      // overlay — that was the actual problem: two separate buttons, each
      // pinned a fixed distance from the *canvas* bottom regardless of how
      // tall the ROB content actually was, so it landed right under the
      // content in one view and floated in a big gap in another (normal vs
      // Screen Mode) depending on how much empty space happened to be left
      // over. One button, sitting directly after the content every time,
      // in every mode, at any scale, fixes that structurally rather than
      // by tuning another pixel offset.
      '<div style="margin-top:14px;padding-top:12px;border-top:1px solid #2A2A2A">' +
      '<button id="cc-back-btn" onclick="_ccBackToOps()" style="display:flex;align-items:center;gap:5px;background:#000000;border:1px solid #F0A500;color:#F0A500;font-family:\'Courier New\',Courier,monospace;font-weight:700;font-size:10px;letter-spacing:.06em;padding:5px 9px;border-radius:2px;cursor:pointer;-webkit-tap-highlight-color:transparent">' +
      '<span>◄</span> BACK TO OPS</button></div>';
  }

  // ── Vessel Schedule (active vessels only, soonest first, split by barge
  //    when there's more than one — this is a wallboard meant to be read
  //    at a glance, not clicked through tabs like the Supply Timeline is) ──
  const schedPanel = document.getElementById('cc-schedule-panel');
  if (schedPanel) {
    const barges = _bargeConfig || [];
    // "to be supplied" = the full nominated quantity for each grade
    // separately, not one combined number — matches how ROB and every
    // other quantity in the app is always shown per grade, not summed.
    function scheduleTableHtml(items, loadings) {
      loadings = loadings || [];
      // Merge vessel rows and loading rows into ONE chronological sequence
      // by start time, same principle as the Supply Timeline's interleaved
      // cards — a planned loading is barge-occupying time, so it needs to
      // show up in-sequence on the wallboard too, not be invisible here.
      const merged = []
        .concat(items.map(function(it) { return { kind: 'vessel', t: new Date(it.bargeStart), data: it }; }))
        .concat(loadings.map(function(r) { return { kind: 'loading', t: new Date(r.startAt), data: r }; }))
        .sort(function(a, b) { return a.t - b.t; });

      // Shorter wallboard-only date format ("30 Aug 00:00", no year) — the
      // full fmt24() string ("30 Aug 2026  00:00") was too wide for this
      // column and overflowed visibly into the next one.
      function fmtWB(d) { return (!(d instanceof Date) || isNaN(d.getTime())) ? '—' : `${pad(d.getDate())} ${MO[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }

      const rows = merged.slice(0, 12).map(function(entry) {
        if (entry.kind === 'loading') {
          const r = entry.data;
          // Terminal-style alert line: a real color-washed fill (gradient
          // from the grade accent into the panel black) plus a bold left
          // rule, monospace, uppercase — reads as "Ops Terminal" signal
          // rather than a flat unfilled row.
          const accent = r.grade === 'LSMGO' ? '#F0A542' : '#4FD1E8';
          return `<div style="padding:6px 10px 6px 8px;border-top:1px solid #222;background:linear-gradient(90deg, ${accent}33, ${accent}0D 65%, transparent);border-left:3px solid ${accent}">
            <div style="display:flex;flex-direction:column;gap:2px;font-size:11.5px;font-family:'Courier New',Courier,monospace;letter-spacing:.03em">
              <span style="color:${accent};font-weight:700;white-space:normal;word-break:break-word">[ LOADING ] ${esc(String(r.terminal || '').toUpperCase())}</span>
              <span style="color:#EAEAEA;white-space:normal;word-break:break-word">${esc(r.grade)} · ${(Number(r.qty)||0).toLocaleString()} MT · ${fmtWB(entry.t)}${r.startWin && _etaFrame(r.startWin) ? ' ' + _etaFrame(r.startWin).code : ''}</span>
            </div>
          </div>`;
        }
        const item = entry.data;
        const statusColor = item.isDelayed ? '#F0A500' : '#3ECF6E';
        const statusText = item.isDelayed ? 'DELAY' : 'ONTIME';
        const vQty = item.nomVQ || item.vQ || 0;
        const mQty = item.nomMQ || item.mQ || 0;
        // A vessel's full name is never negotiable — it wraps onto a
        // second line rather than getting cut off with an ellipsis, no
        // matter how narrow this column gets in split-by-barge view. The
        // rest of the row's details flow as a wrapping line underneath
        // instead of fighting for fixed table-column widths that always
        // eventually clip something in a narrow sub-column.
        const ccSts = _stsOf(_ccStsL, item);
        return `<div style="padding:6px 0 6px ${ccSts ? '8px' : '0'};border-top:1px solid #222;${ccSts ? 'background:rgba(134,216,96,.14);border-left:3px solid #86D860' : ''}">
          <div style="color:#EEE;font-size:11.5px;font-weight:700;white-space:normal;word-break:break-word;line-height:1.35">${esc(item.name)}${ccSts ? _stsTagDark() : ''}</div>
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:3px;font-size:10.5px">
            <span style="color:#CCC;white-space:nowrap">${fmtWB(item.bargeStart)}${item.etaWin && _etaFrame(item.etaWin) ? ' · ' + _etaFrameTxt(item.etaWin) : ''}</span>
            <span style="color:#4FD1E8;white-space:nowrap">V ${vQty ? esc(_nomQtyTxt(item, 'V', vQty)) : '—'}</span>
            <span style="color:#F0A542;white-space:nowrap">M ${mQty ? esc(_nomQtyTxt(item, 'M', mQty)) : '—'}</span>
            <span style="color:${statusColor};font-weight:700;white-space:nowrap;margin-left:auto">${statusText}</span>
          </div>
        </div>`;
      }).join('');
      return '<div style="font-size:9.5px;color:#FFFFFF;letter-spacing:.08em;padding-bottom:5px;margin-bottom:2px;border-bottom:1px solid #2A2A2A">SCHEDULE</div>' +
        (rows || '<div style="color:#FFFFFF;font-size:12.5px;padding-top:8px">No active vessels</div>');
    }

    if (barges.length > 1) {
      // Split screen — one sub-column per barge, side by side.
      const cols = barges.map(function(b) {
        const bItems = activeItems.filter(item => item.bargeLabel === b.name);
        const bLoadings = (typeof _loadingsForBargeName === 'function') ? _loadingsForBargeName(b.name) : [];
        return `<div style="flex:1;min-width:0;padding:0 10px;border-right:1px solid #222">
          <div style="font-size:11px;color:#EEE;font-weight:700;margin-bottom:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(b.name)}</div>
          ${scheduleTableHtml(bItems, bLoadings)}
        </div>`;
      }).join('');
      schedPanel.innerHTML = '<div style="font-size:11.5px;color:#F0A500;letter-spacing:.1em;margin-bottom:9px;border-bottom:1px solid #2A2A2A;padding-bottom:6px">VESSEL SCHEDULE — SPLIT BY BARGE</div>' +
        `<div style="display:flex;margin:0 -10px">${cols}</div>`;
    } else {
      const singleBargeLoadings = (typeof _loadingsForBargeName === 'function')
        ? (barges.length === 1 ? _loadingsForBargeName(barges[0].name) : (_loadingRecords || []).filter(function(r) { return !r.deletedAt && !r.completed && r.kind !== 'transfer' && new Date(r.endAt) >= new Date(); }))
        : [];
      schedPanel.innerHTML = '<div style="font-size:11.5px;color:#F0A500;letter-spacing:.1em;margin-bottom:9px;border-bottom:1px solid #2A2A2A;padding-bottom:6px">VESSEL SCHEDULE</div>' +
        scheduleTableHtml(activeItems, singleBargeLoadings);
    }
  }

  // ── Alerts — now the same computeGlobalAlerts() the topbar bell uses,
  //    so Command Center and the bell can never drift out of sync with
  //    two separately-maintained definitions of "what counts as an
  //    alert". Mapped to this panel's own uppercase terminal labels. ──
  const alertsPanel = document.getElementById('cc-alerts-panel');
  const alerts = computeGlobalAlerts().map(function(a) {
    return { key: a.key, label: a.label.toUpperCase(), sub: a.sub, color: a.severity === 'error' ? '#E5484D' : '#F0A500' };
  });
  if (alertsPanel) {
    // Flash any alert that wasn't present on the previous refresh — a
    // wallboard nobody's staring at constantly needs something that
    // catches the eye on a walk-by, not just static red text. Skipped on
    // the very first render (nothing's genuinely "new" the moment the
    // page opens — everything already there isn't a surprise).
    alertsPanel.innerHTML = `<div style="font-size:11.5px;color:#E5484D;letter-spacing:.1em;margin-bottom:9px;border-bottom:1px solid #2A2A2A;padding-bottom:6px">ALERTS — ${alerts.length} ACTIVE</div>` +
      (alerts.length
        ? alerts.map(function(a) {
            const isNew = _ccPrevAlertKeys && !_ccPrevAlertKeys.has(a.key);
            return `<div class="${isNew ? 'cc-flash-new' : ''}" style="font-size:11.5px;color:${a.color};padding:5px 0;border-top:1px solid #222">${esc(a.label)}<br><span style="color:#FFFFFF;font-size:12px">${esc(a.sub)}</span></div>`;
          }).join('')
        : '<div style="font-size:11.5px;color:#3ECF6E;padding-top:5px">No active alerts</div>');
    _ccPrevAlertKeys = new Set(alerts.map(a => a.key));
  }

  // ── Activity — this week's totals (vs last week) + recently completed
  //    supplies. Turns the wallboard from "what's pending" into "what's
  //    pending + what just happened", which reads as momentum, not just
  //    a to-do list. ──
  const activityPanel = document.getElementById('cc-activity-panel');
  if (activityPanel) {
    function ccWeekBounds(d) {
      const day = d.getDay();
      const diffToMon = (day === 0 ? -6 : 1) - day;
      const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diffToMon, 0, 0, 0, 0);
      const sun = new Date(mon.getTime() + 7 * 86400000 - 1);
      return [mon, sun];
    }
    const _ccNow = new Date();
    const [thisMon, thisSun] = ccWeekBounds(_ccNow);
    const [lastMon, lastSun] = ccWeekBounds(new Date(_ccNow.getTime() - 7 * 86400000));
    let thisV = 0, thisM = 0, lastV = 0, lastM = 0;
    (_savedSupplies || []).forEach(function(r) {
      const d = new Date(r.savedAt || 0);
      if (isNaN(d.getTime())) return;
      const v = _recActQty(r, 'v');
      const m = _recActQty(r, 'm');
      if (d >= thisMon && d <= thisSun) { thisV += v; thisM += m; }
      else if (d >= lastMon && d <= lastSun) { lastV += v; lastM += m; }
    });
    function ccTrend(cur, prev) {
      if (cur === prev) return '<span style="color:#AAA">＝</span>';
      return cur > prev ? '<span style="color:#3ECF6E">▲</span>' : '<span style="color:#E5484D">▼</span>';
    }
    const recentCompleted = (_savedSupplies || [])
      .filter(function(r) { return r.savedAt; })
      .slice()
      .sort(function(a, b) { return new Date(b.savedAt) - new Date(a.savedAt); })
      .slice(0, 6);

    activityPanel.innerHTML =
      '<div style="font-size:11.5px;color:#F0A500;letter-spacing:.1em;margin-bottom:9px;border-bottom:1px solid #2A2A2A;padding-bottom:6px">THIS WEEK</div>' +
      `<div style="font-size:12.5px;color:#FFFFFF;display:flex;justify-content:space-between"><span>VLSFO</span><span style="color:#4FD1E8">${Math.round(thisV).toLocaleString()} MT ${ccTrend(thisV, lastV)}</span></div>` +
      `<div style="font-size:12.5px;color:#FFFFFF;display:flex;justify-content:space-between;margin-top:3px;margin-bottom:12px"><span>LSMGO</span><span style="color:#F0A542">${Math.round(thisM).toLocaleString()} MT ${ccTrend(thisM, lastM)}</span></div>` +
      '<div style="font-size:11.5px;color:#F0A500;letter-spacing:.1em;margin-bottom:8px;border-bottom:1px solid #2A2A2A;padding-bottom:6px">RECENTLY COMPLETED</div>' +
      (recentCompleted.length
        ? recentCompleted.map(function(r) {
            const d = new Date(r.savedAt);
            const v = _recActQty(r, 'v');
            const m = _recActQty(r, 'm');
            return `<div style="padding:5px 0 5px ${r.sts ? '8px' : '0'};border-top:1px solid #222;${r.sts ? 'background:rgba(134,216,96,.14);border-left:3px solid #86D860' : ''}">
              <div style="font-size:11.5px;color:#EEE;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(r.vessel || 'Vessel')}">${esc(r.vessel || 'Vessel')}${r.sts ? _stsTagDark() : ''}</div>
              <div style="font-size:10.5px;color:#3ECF6E;margin-top:2px">${v ? v.toLocaleString() + ' VLSFO ' : ''}${m ? m.toLocaleString() + ' LSMGO' : ''} · ${fmt24(d)}</div>
            </div>`;
          }).join('')
        : '<div style="font-size:11.5px;color:#FFFFFF;padding-top:4px">No completions yet</div>');
  }

  // ── Ticker ──
  const ticker = document.getElementById('cc-ticker');
  if (ticker) {
    const next = activeItems[0];
    const weekOps = activeItems.length;
    const totalV = activeItems.reduce((s, i) => s + (i.nomVQ || i.vQ || 0), 0);
    const totalM = activeItems.reduce((s, i) => s + (i.nomMQ || i.mQ || 0), 0);
    const nextText = next ? `NEXT: ${next.name} ${fmt24(next.bargeStart)}${next.etaWin && _etaFrame(next.etaWin) ? ' (ETA ' + _etaFrameTxt(next.etaWin) + ')' : ''} ${next.bargeLabel || ''}` : 'NO UPCOMING VESSELS';
    const line = `${nextText}   •   ACTIVE OPS: ${weekOps}   •   VLSFO ${totalV.toLocaleString()} MT   •   LSMGO ${totalM.toLocaleString()} MT   •   ALERTS: ${alerts.length}`;
    ticker.textContent = line + '          ' + line;
    ticker.style.animation = 'ccTickerScroll 24s linear infinite';
  }
}

let _ccResizeObserver = null;
let _ccListenersBound = false;
function _ccFitCanvas() {
  const wrap = document.getElementById('cc-wallboard');
  const canvas = document.getElementById('cc-canvas');
  if (!wrap || !canvas) return;
  const isFs = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
  // Outside fullscreen the wallboard is always exactly 16:9, so width alone
  // gives the right scale. In fullscreen the actual screen is very likely
  // a different ratio (e.g. a tall phone), so scale against whichever of
  // width/height is tighter — this is what keeps the canvas centered with
  // even letterboxing instead of leaving a big dead area on one side.
  const scale = isFs
    ? Math.min(wrap.clientWidth / 1280, wrap.clientHeight / 720)
    : wrap.clientWidth / 1280;
  canvas.style.transform = 'scale(' + scale + ')';
}

// Explicit way back to Operations from inside the terminal — needed
// because on a phone (especially the Android app, which has no browser
// chrome/back button at all) there is otherwise no way out once this
// screen — or worse, true Fullscreen mode — is open. Always exits
// fullscreen first if active, then routes back to the dashboard.
function _ccBackToOps() {
  const exitFs = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
  const isFs = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
  if (isFs && exitFs) {
    exitFs.call(document).catch(function() {}).then(function() { showPage('dashboard'); });
    // Fallback in case the promise never settles on some old WebViews.
    setTimeout(function() { showPage('dashboard'); }, 350);
  } else {
    showPage('dashboard');
  }
}

// True fullscreen (Fullscreen API) on just the terminal panel itself —
// no sidebar, no topbar, no browser chrome. This is what you'd point a
// TV's browser or a Chromecast-tab-cast at.
function _ccEnterScreenMode() {
  const el = document.getElementById('cc-wallboard');
  if (!el) return;
  const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
  if (req) req.call(el);
  else alert("This browser doesn't support fullscreen mode.");
}

// Attempts a one-click cast via the browser's Presentation API. Support
// for presenting arbitrary HTML (rather than just a <video>) varies a lot
// by browser/TV combination, so this is offered as a convenience where
// available — the fully reliable method on any Chromecast-enabled TV is
// still the browser's own native "Cast..." menu → "Cast tab", which every
// Chrome/Edge browser has regardless of what this button can do.
function _ccCastToTV() {
  if (!('PresentationRequest' in window)) {
    alert('One-click casting isn\'t available in this browser.\n\nUse your browser\'s built-in "Cast..." menu instead and choose "Cast tab" (not "Cast desktop") — that works on any Chromecast-enabled TV and keeps casting independent of whatever else you do on this device.');
    return;
  }
  try {
    const request = new PresentationRequest([location.href]);
    request.start().then(function() {
      showToast('Casting started', 'success');
    }).catch(function(err) {
      alert('Could not start casting (' + err.message + ').\n\nUse your browser\'s built-in "Cast..." menu instead and choose "Cast tab" — that works reliably on any Chromecast-enabled TV.');
    });
  } catch (e) {
    alert('Casting isn\'t available here. Use your browser\'s built-in "Cast..." menu → "Cast tab" instead.');
  }
}

