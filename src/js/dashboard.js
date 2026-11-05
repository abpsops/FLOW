/* ── Schedule ready flag ── */
let _scheduleReady = false;

/* _parseLocalDate(): new Date('YYYY-MM-DD') parses as UTC midnight, but
   getMonth()/getDate()/toDateString() read LOCAL time — so west of UTC a
   delivery on the 1st lands in the previous day/month. Date-only strings are
   therefore built as local midnight; anything else (full ISO timestamps,
   Date objects, epoch ms) goes through new Date() unchanged. */
function _parseLocalDate(s) {
  if (s instanceof Date) return new Date(s.getTime());
  const m = typeof s === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim()) : null;
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return new Date(s);
}

/* ── Dashboard refresh — reads directly from live app state ── */
/* ── ACTION QUEUE — the dashboard's actual work surface.
   Pulls delayed operations + PAQ-pending nominations into one ranked
   list with inline actions, so the dashboard is something you act
   from, not just something you read. ── */
let _rlQueueCount = 0; // reload items in Needs Attention — the hero line counts them too
let _idQueueCount = 0;  // nominations without a valid IMO / MMSI in Needs Attention — counted in the hero line too
function renderActionQueue() {
  const el = document.getElementById('dash-action-queue');
  if (!el) return;

  const vcCards = document.querySelectorAll('#vc .vcard[id^="vessel-"]');
  const items = [];

  (_lastSched || []).forEach(item => {
    if (item.isDelayed) {
      items.push({
        urgency: 0, kind: 'DELAYED',
        name: item.name,
        detail: 'Outside laycan window' + (item.eta instanceof Date && !isNaN(item.eta) ? ' — ETA ' + _itemEtaTxt(item) : ''),
        sno: item.sno
      });
    }
  });

  // Projected barge shortfalls (reload planner, next 7 days).
  _rlQueueCount = 0;
  if (!isTrader() && typeof _rlAlerts === 'function') {
    try {
      _rlAlerts().forEach(function(a) {
        _rlQueueCount++;
        items.push({ urgency: a.severity === 'error' ? 0 : 0.5, kind: 'RELOAD', name: a.rec.bargeName + ' — ' + a.rec.grade + ' reload', detail: a.sub, go: a.go, key: a.key });
      });
    } catch (e) { console.warn('ABPS: reload queue items failed', e); }
  }

  // Upcoming nominations without a valid IMO or MMSI — one per nomination.
  _idQueueCount = 0;
  if (typeof _vidMissing === 'function') {
    try {
      _vidMissing().forEach(function(x) {
        _idQueueCount++;
        items.push({ urgency: 0.8, kind: 'ID', name: x.name, detail: x.detail, cid: x.cid, key: x.key });
      });
    } catch (e) { console.warn('ABPS: IMO/MMSI queue items failed', e); }
  }

  vcCards.forEach(card => {
    const cid = card.id.replace('vessel-', '');
    const paqEl = document.getElementById('v' + cid + '-paq');
    if (paqEl && paqEl.value !== 'yes') {
      const nm = document.getElementById('v' + cid + '-name')?.value || ('Vessel ' + cid);
      items.push({
        urgency: 1, kind: 'PAQ',
        name: nm,
        detail: 'Pre-Arrival Questionnaire not yet received',
        cid: cid
      });
    }
  });

  items.sort((a, b) => a.urgency - b.urgency);

  if (!items.length) {
    el.innerHTML = `<div style="border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);padding:26px 20px;text-align:center;margin-bottom:14px">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:6px"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      <div style="font-size:12.5px;font-weight:700;color:var(--ink)">All clear</div>
      <div style="font-size:10.5px;color:var(--muted);margin-top:2px">Nothing needs attention right now</div>
    </div>`;
    return;
  }

  const KIND_STYLE = {
    DELAYED: { color: 'var(--red)',   bg: 'var(--red-lt)',   border: 'var(--red)'   },
    PAQ:     { color: 'var(--amber)', bg: 'var(--amber-lt)', border: 'var(--amber)' },
    RELOAD:  { color: 'var(--red)',   bg: 'var(--red-lt)',   border: 'var(--red)'   },
    ID:      { color: 'var(--amber)', bg: 'var(--amber-lt)', border: 'var(--amber)' }
  };

  const shown = items.slice(0, 8);
  const rows = shown.map(it => {
    const s = KIND_STYLE[it.kind];
    let actionHtml = '';
    if (it.kind === 'DELAYED') {
      actionHtml = `<button class="aq-btn" onclick="_globalSearchGoSchedule('${escJs(String(it.sno))}')">View in Schedule</button>`;
    } else if (it.kind === 'PAQ') {
      actionHtml = `<button class="aq-btn aq-btn-primary" onclick="_aqMarkPaqReceived('${escJs(it.cid)}')">Mark Received</button>
        <button class="aq-btn" onclick="_globalSearchGoNomination('${escJs(it.cid)}')">Open</button>`;
    } else if (it.kind === 'RELOAD') {
      actionHtml = `<button class="aq-btn aq-btn-primary" onclick="rlGoToForecast('${escJs(it.go)}')">View reload plan</button>`;
    } else if (it.kind === 'ID') {
      actionHtml = `<button class="aq-btn aq-btn-primary" onclick="_vidGoTo('${escJs(it.cid)}')">Add IMO / MMSI</button>`;
    }
    return `<div class="aq-row"${it.key ? ` data-alert-key="${esc(it.key)}"` : ''}>
      <span class="aq-tag" style="color:${s.color};background:${s.bg};border-color:${s.border}">${it.kind}</span>
      <div class="aq-body">
        <div class="aq-name">${esc(it.name)}</div>
        <div class="aq-detail">${esc(it.detail)}</div>
      </div>
      <div class="aq-actions">${actionHtml}</div>
    </div>`;
  }).join('');

  const moreHtml = items.length > 8
    ? `<div style="padding:8px 14px;text-align:center;font-size:10.5px;color:var(--muted);font-weight:600;border-top:1px solid var(--border)">+${items.length - 8} more — <a onclick="showPage('alerts')" style="color:var(--azure);cursor:pointer;font-weight:700">view all in Alerts</a></div>`
    : '';

  el.innerHTML = `<div style="border:1px solid var(--border);border-radius:var(--radius-xs);overflow:hidden;background:var(--surface);margin-bottom:14px">
    <div style="padding:9px 14px;border-bottom:1px solid var(--border);background:var(--surface2);display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:10px;font-weight:700;color:var(--sub);text-transform:uppercase;letter-spacing:.08em;font-family:'DM Mono',monospace">Needs Attention — ${items.length}</span>
    </div>
    ${rows}
    ${moreHtml}
  </div>`;
}

function _aqMarkPaqReceived(cid) {
  const paqEl = document.getElementById('v' + cid + '-paq');
  if (!paqEl) return;
  const nm = document.getElementById('v' + cid + '-name')?.value || 'Vessel';
  paqEl.value = 'yes';
  paqEl.dispatchEvent(new Event('change'));
  refreshDashboard();
  showToast(nm + ' — PAQ marked received', 'success');
}

function refreshDashboard() {
  const now = new Date();
  safeSet('dash-date-sub',
    now.toLocaleDateString('en-GB', { weekday:'long', year:'numeric', month:'long', day:'numeric' }));

  _dashSafe('action queue', renderActionQueue);

  // ── Read vessel cards directly from DOM ──
  const vcCards = document.querySelectorAll('#vc .vcard[id^="vessel-"]');
  const nomCount = vcCards.length;
  safeSet('kpi-nominations', nomCount || '0');

  // Barge count from _bargeConfig (set by getBarges after schedule)
  const bargeCnt = (_bargeConfig && _bargeConfig.length) ? _bargeConfig.length
    : document.querySelectorAll('#barge-list .vcard').length;
  safeSet('kpi-barges', bargeCnt || '0');

  // PAQ pending — count from vessel cards
  let paqPending = 0, totalV = 0, totalM = 0;
  const paqPendingVessels = [];
  vcCards.forEach(card => {
    const cid = card.id.replace('vessel-', '');
    const paqEl = document.getElementById('v' + cid + '-paq');
    if (paqEl && paqEl.value !== 'yes') {
      paqPending++;
      const nm = document.getElementById('v' + cid + '-name')?.value || ('Vessel ' + cid);
      paqPendingVessels.push({ cid, name: nm });
    }
    const typeEl = document.getElementById('v' + cid + '-type');
    const ty = typeEl ? typeEl.value : 'BOTH';
    const vv = _cardQty(cid, 'vlsfo').qty;
    const mm = _cardQty(cid, 'mgo').qty;
    if (ty !== 'MGO') totalV += vv;
    if (ty !== 'VLSFO') totalM += mm;
  });
  safeSet('kpi-paq', paqPending);
  safeSet('kpi-vlsfo', totalV > 0 ? fmtMT(totalV) + ' MT' : '0 MT');
  safeSet('kpi-lsmgo', totalM > 0 ? fmtMT(totalM) + ' MT' : '0 MT');

  // Deliveries — actual supplies DELIVERED today (not the schedule preview,
  // which only shows what was last calculated). Bucketed by supplyDate with
  // supplied === true from _getAllReportRecords(), the same source and rules
  // the charts and Monthly Report use — savedAt is when the record was
  // saved, which can be a day or more after the fuel actually went in.
  let savedRecsAll = (_savedSupplies && _savedSupplies.length) ? _savedSupplies : null;
  if (!savedRecsAll) {
    // A corrupted cache must not take the whole dashboard down with it.
    try { savedRecsAll = JSON.parse(localStorage.getItem(LS_RECORDS_KEY) || '[]'); } catch(e) { savedRecsAll = []; }
    if (!Array.isArray(savedRecsAll)) savedRecsAll = [];
  }
  let suppliedRecs = [];
  try {
    suppliedRecs = (typeof _getAllReportRecords === 'function' ? _getAllReportRecords() : savedRecsAll)
      .filter(r => r && r.supplied === true && r.supplyDate);
  } catch(e) { console.warn('ABPS: dashboard could not read report records:', e && e.message); }
  const todayStr = now.toDateString();
  let deliveries = 0;
  suppliedRecs.forEach(r => {
    const d = _parseLocalDate(r.supplyDate);
    if (!isNaN(d) && d.toDateString() === todayStr) deliveries++;
  });

  // Delayed — from last schedule run (upcoming planned supplies flagged delayed)
  let delayed = 0;
  const delayedItems = [];
  // Early — arriving BEFORE laycan opens. Distinct from delayed (which needs
  // immediate action); this is informational, so it gets its own calm banner
  // rather than being folded into the urgent-red delayed one.
  let early = 0;
  const earlyItems = [];
  if (_lastSched && _lastSched.length) {
    _lastSched.forEach(item => {
      if (item.isDelayed) { delayed++; delayedItems.push(item); }
      else if (item.isEarly) { early++; earlyItems.push(item); }
    });
  }
  safeSet('kpi-deliveries', deliveries);
  safeSet('kpi-delayed', delayed);

  // VLSFO + MGO delivered this month, split by port (FUJ / KFK) — month
  // decided by supplyDate, same as the charts (see deliveries above).
  const savedRecs = savedRecsAll;
  const nowMonth = now.getMonth(), nowYear = now.getFullYear();
  const _monthPortMap = { 'FUJ-A':'FUJ', 'FUJ-B':'FUJ', 'KFK-A':'KFK', 'KFK-B':'KFK' };
  let monthlyFuj = 0, monthlyKfk = 0, monthlyFujM = 0, monthlyKfkM = 0;
  suppliedRecs.forEach(r => {
    const d = _parseLocalDate(r.supplyDate);
    if (d.getMonth() === nowMonth && d.getFullYear() === nowYear) {
      const areaKey = r.areaCode || r.area || '';
      const port = _monthPortMap[areaKey] || _monthPortMap[Object.keys(_monthPortMap).find(k => areaKey.includes(k)) || ''];
      const v = _recActQty(r, 'v');
      const m = _recActQty(r, 'm');
      if (port === 'FUJ') { monthlyFuj += v; monthlyFujM += m; }
      else if (port === 'KFK') { monthlyKfk += v; monthlyKfkM += m; }
    }
  });
  const kpiMonthlyEl = document.getElementById('kpi-monthly');
  if (kpiMonthlyEl) {
    kpiMonthlyEl.innerHTML =
      '<span style="color:var(--fuel-v,#2F6FED)">VLSFO</span> FUJ ' + fmtMT(monthlyFuj) + ' &middot; KFK ' + fmtMT(monthlyKfk) + '<br>'
      + '<span style="color:var(--fuel-m,#FF7A1A)">MGO</span> FUJ ' + fmtMT(monthlyFujM) + ' &middot; KFK ' + fmtMT(monthlyKfkM);
  }
  safeSet('kpi-monthly-sub', 'This month (' + now.toLocaleString('default',{month:'long'}) + ')');

  // Alert banners — clickable action rows, not just status text
  const alertsEl = document.getElementById('dash-alerts');
  if (alertsEl) {
    let html = '';
    const CHEVRON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:.6"><polyline points="9 18 15 12 9 6"/></svg>';
    if (paqPending > 0) {
      const first = paqPendingVessels[0];
      const names = paqPendingVessels.slice(0, 3).map(v => esc(v.name)).join(', ') + (paqPendingVessels.length > 3 ? ' +' + (paqPendingVessels.length - 3) + ' more' : '');
      html += `<div class="alert-strip warning" style="cursor:pointer" onclick="_globalSearchGoNomination('${escJs(first.cid)}')" title="Click to open ${esc(first.name)} in Nominations">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span><strong>${paqPending} nomination${paqPending>1?'s':''}</strong> have PAQ outstanding — ${names} — submission required within 6 hours.</span>
        ${CHEVRON}
      </div>`;
    }
    if (delayed > 0) {
      const first = delayedItems[0];
      const names = delayedItems.slice(0, 3).map(v => esc(v.name)).join(', ') + (delayedItems.length > 3 ? ' +' + (delayedItems.length - 3) + ' more' : '');
      html += `<div class="alert-strip critical" style="cursor:pointer" onclick="_globalSearchGoSchedule('${escJs(String(first.sno))}')" title="Click to open ${esc(first.name)} in Schedule">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span><strong>${delayed} operation${delayed>1?'s':''}</strong> delayed — ${names} — outside laycan window. Requires immediate action.</span>
        ${CHEVRON}
      </div>`;
    }
    if (early > 0) {
      const first = earlyItems[0];
      const names = earlyItems.slice(0, 3).map(v => esc(v.name)).join(', ') + (earlyItems.length > 3 ? ' +' + (earlyItems.length - 3) + ' more' : '');
      html += `<div class="alert-strip early" style="cursor:pointer" onclick="_globalSearchGoSchedule('${escJs(String(first.sno))}')" title="Click to open ${esc(first.name)} in Schedule">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span><strong>${early} vessel${early>1?'s':''}</strong> arriving before laycan opens — ${names}.</span>
        ${CHEVRON}
      </div>`;
    }
    alertsEl.innerHTML = html;
  }

  // Update alerts badge
  const totalAlerts = paqPending + delayed;
  const alertBadge = document.getElementById('nav-badge-alerts');
  if (alertBadge) {
    if (totalAlerts > 0) { alertBadge.textContent = totalAlerts; alertBadge.style.display = ''; }
    else alertBadge.style.display = 'none';
  }

  // Each widget is independent — one throwing on a malformed record must not
  // leave every widget after it blank.
  _dashSafe('charts',   () => renderDashCharts(savedRecs, []));
  _dashSafe('fueling',  () => renderDashFuelingStatus());
  _dashSafe('fleet',    () => renderDashFleetStatus());
  _dashSafe('reload planner', renderDashReloadPlanner);
  _dashSafe('watchlist',() => renderTrackRecordWatchlist());
  _dashSafe('activity', () => renderDashActivity(savedRecs, []));
  _dashSafe('hero',     () => _renderDashHero(now, totalAlerts + _rlQueueCount + _idQueueCount));
}
/* Harbour Light hero banner text (the banner itself is CSS-hidden in
   Classic). "Supplies today" = schedule items whose barge start falls on
   today's date; "need your attention" = the same PAQ + delayed total the
   Alerts badge shows. textContent only — no markup from data. */
function _renderDashHero(now, attention) {
  const dateEl = document.getElementById('dash-hero-date');
  const titleEl = document.getElementById('dash-hero-title');
  if (!dateEl || !titleEl) return;
  const todayStr = now.toDateString();
  let today = 0;
  (_lastSched || []).forEach(function(item) {
    const d = new Date(item && (item.bargeStart || item.eta));
    if (!isNaN(d) && d.toDateString() === todayStr) today++;
  });
  const h = now.getHours();
  const greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const att = attention > 0 ? attention + (attention === 1 ? ' needs' : ' need') + ' your attention.' : 'nothing needs your attention.';
  dateEl.textContent = (now.toLocaleDateString('en-GB', { weekday: 'long' }) + ' · '
    + now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) + ' · Fujairah').toUpperCase();
  titleEl.textContent = greet + ' — ' + today + (today === 1 ? ' supply' : ' supplies') + ' today, ' + att;
}
function _dashSafe(name, fn) {
  try { fn(); } catch(e) { console.warn('ABPS: dashboard ' + name + ' render failed:', e); }
}

let _fuelingInitiated = {}; // { [sno]: { initiatedAt: <ms> } } — operator-confirmed, not time-derived

// Fueling Status tracks initiation against a vessel's *nomination*, not
// its position in that day's generated schedule. sno (i+1 in
// generateSchedule) is purely positional and gets reassigned every time
// the schedule regenerates — e.g. the moment a completed supply is
// filtered out of the input, everything after it shifts down by one.
// A stale _fuelingInitiated["2"] entry left over from a now-completed
// vessel would then silently attach itself to whichever *different*
// vessel happens to land on sno=2 next — showing as "already initiated"
// the moment the app reloads (login, logout/back in, a fresh generate)
// without anyone touching it. nomUid is the nomination's permanent,
// never-reassigned identity, so it's what initiation state is actually
// keyed on now; sno is kept purely as a last-resort fallback for any
// stray item that somehow lacks a nomUid.
function _fuelKey(item) {
  if (item.nomUid) return 'nom_' + item.nomUid;
  if (item.sno !== undefined && item.sno !== null) return 'sno_' + item.sno;
  return null;
}

function initiateFueling(key) {
  if (isTrader()) return; // operator-only action — traders can view this widget but not confirm physical fueling start
  if (!key || _fuelingInitiated[key]) return; // already initiated
  _fuelingInitiated[key] = { initiatedAt: Date.now() };
  saveSharedState();
  renderDashFuelingStatus();
}

function undoInitiateFueling(key) {
  if (isTrader()) return; // same operator-only gate as initiating
  if (!key || !_fuelingInitiated[key]) return;
  delete _fuelingInitiated[key];
  saveSharedState();
  renderDashFuelingStatus();
}

function renderDashFuelingStatus() {
  const el = document.getElementById('dash-fueling-status');
  if (!el) return;
  const items = _lastSched || [];
  if (!items.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center;padding:24px;grid-column:1/-1">Generate schedule to see fueling status.</div>';
    return;
  }
  const now = new Date();
  const waiting = [], inProgress = [];
  items.forEach(function(item) {
    const start = new Date(item.bargeStart), end = new Date(item.etc);
    if (isNaN(start) || isNaN(end)) return;
    const key = _fuelKey(item);
    const initiated = key && _fuelingInitiated[key];
    // "In Progress" requires an operator to have actually clicked Initiate
    // — the scheduled start time passing on its own doesn't count as
    // fueling having begun, since the plan and the physical reality don't
    // always line up. Not-yet-initiated stays in Waiting even past its
    // scheduled start (itself useful signal — something that should have
    // started but hasn't been confirmed). No separate Completed bucket —
    // once it's past its ETC it simply drops off this widget rather than
    // needing its own section here.
    if (!initiated) waiting.push(item);
    else if (now < end) inProgress.push(item);
  });
  waiting.sort(function(a,b){ return new Date(a.bargeStart) - new Date(b.bargeStart); });
  inProgress.sort(function(a,b){ return new Date(a.etc) - new Date(b.etc); });

  function fmtQty(item) {
    const v = item.nomVQ || item.vQ || 0, m = item.nomMQ || item.mQ || 0;
    const parts = [];
    if (v > 0) parts.push('<span style="color:var(--fuel-v)">' + esc(_nomQtyTxt(item, 'V', v)) + ' V</span>');
    if (m > 0) parts.push('<span style="color:var(--fuel-m)">' + esc(_nomQtyTxt(item, 'M', m)) + ' M</span>');
    return parts.join(' · ');
  }

  function col(title, color, bg, list, emptyText, timeFn, showInitiateBtn, showUndoBtn) {
    const canInitiate = showInitiateBtn && !isTrader();
    const canUndo = showUndoBtn && !isTrader();
    const rows = list.slice(0, 6).map(function(item) {
      const hasSno = item.sno !== undefined && item.sno !== null;
      const isOverdue = showInitiateBtn && now >= new Date(item.bargeStart);
      // JSON.stringify() wraps a string in DOUBLE quotes — embedding that
      // directly inside an onclick="..." attribute (itself double-quoted)
      // breaks the HTML mid-attribute at the first inner quote, silently
      // truncating the handler to invalid JS. Use a single-quoted JS
      // string literal instead, with any single quotes in the value
      // itself escaped, since it's going inside single-quoted JS.
      const snoJs = hasSno ? "'" + escJs(String(item.sno)) + "'" : "''";
      const openHandler = hasSno ? 'onclick="_globalSearchGoSchedule(' + snoJs + ')" style="cursor:pointer"' : '';
      // Initiate/Undo are keyed on the stable nomUid-based key (_fuelKey),
      // NOT sno — sno is fine for _globalSearchGoSchedule above (pure
      // in-session navigation, never persisted) but would silently
      // misattribute initiation state across reloads, see _fuelKey's note.
      const fuelKey = _fuelKey(item);
      const fuelKeyJs = fuelKey ? "'" + escJs(fuelKey) + "'" : "''";
      const initiateBtn = (canInitiate && fuelKey)
        ? '<button onclick="event.stopPropagation();initiateFueling(' + fuelKeyJs + ')" style="font-size:9.5px;font-weight:700;padding:3px 8px;border-radius:4px;border:none;background:var(--green);color:#fff;cursor:pointer;white-space:nowrap;margin-left:6px">Initiate</button>'
        : '';
      // In case Initiate was clicked by mistake — same operator-only gate,
      // just moves the item straight back to Still Waiting.
      const undoBtn = (canUndo && fuelKey)
        ? '<button onclick="event.stopPropagation();undoInitiateFueling(' + fuelKeyJs + ')" title="Move back to Still Waiting" style="font-size:9.5px;font-weight:700;padding:3px 8px;border-radius:4px;border:1px solid var(--border2);background:var(--surface);color:var(--sub);cursor:pointer;white-space:nowrap;margin-left:6px">Undo</button>'
        : '';
      return '<div ' + openHandler + ' class="fs-row" style="padding:8px 10px;border-radius:6px;background:var(--surface);border:1px solid var(--border2);margin-bottom:6px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px">' +
          '<div style="font-size:12px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(item.name || '') + '</div>' +
          initiateBtn + undoBtn +
        '</div>' +
        '<div style="font-size:10.5px;color:' + (isOverdue ? 'var(--amber)' : 'var(--muted)') + ';margin-top:2px;display:flex;justify-content:space-between;gap:6px">' +
          '<span>' + esc(item.bargeLabel || 'Unassigned') + ' · ' + (isOverdue ? 'Ready to start' : timeFn(item)) + '</span>' +
          '<span style="font-family:\'DM Mono\',monospace;font-weight:700;color:var(--muted)">' + fmtQty(item) + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
    const more = list.length > 6 ? '<div style="font-size:10px;color:var(--muted);text-align:center;padding-top:2px">+' + (list.length - 6) + ' more</div>' : '';
    return '<div>' +
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid ' + color + '">' +
        '<span style="width:8px;height:8px;border-radius:50%;background:' + color + '"></span>' +
        '<span style="font-size:10.5px;font-weight:700;color:var(--sub);text-transform:uppercase;letter-spacing:.05em">' + title + '</span>' +
        '<span style="font-size:10.5px;font-weight:700;color:' + color + ';margin-left:auto">' + list.length + '</span>' +
      '</div>' +
      (rows || '<div style="font-size:11px;color:var(--muted);text-align:center;padding:14px 4px">' + emptyText + '</div>') +
      more +
    '</div>';
  }

  el.innerHTML =
    col('Still Waiting', 'var(--muted)', '', waiting, 'Nothing waiting', function(item) { return 'Starts ' + fmt24(item.bargeStart) + (item.etaWin && _etaFrame(item.etaWin) ? ' · ETA ' + _etaFrameTxt(item.etaWin) : ''); }, true, false) +
    col('Fueling — In Progress', 'var(--green)', '', inProgress, 'None active right now', function(item) { return 'Ends ' + fmt24(item.etc); }, false, true);
}

function renderDashFleetStatus() {
  const el = document.getElementById('dash-fleet-status');
  if (!el) return;
  const barges = _fleetNow();
  if (!barges.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center;padding:24px">No barges configured.</div>';
    return;
  }
  const liveROBs = (typeof getAllLiveROBs === 'function') ? getAllLiveROBs() : {};
  const cmapF = _bargeColorMap();
  el.innerHTML = barges.map(b => {
    const live = liveROBs[b.id];
    const v = live ? live.liveV : (parseFloat(b.vrob) || parseFloat(b.robV) || 0);
    const m = live ? live.liveM : (parseFloat(b.mrob) || parseFloat(b.robM) || 0);
    const cap = parseFloat(b.vcap) || parseFloat(b.cap) || 4000;
    const pctV = Math.min(100, Math.round(v / cap * 100));
    const pctM = Math.min(100, Math.round(m / (cap * 0.3) * 100));
    const statusClass = pctV < 20 ? 'badge-red' : pctV < 40 ? 'badge-amber' : 'badge-green';
    const statusLabel = pctV < 20 ? 'Refill' : pctV < 40 ? 'Low' : 'Available';
    return `<div class="fs-row"${_bargeAttrs(b.name, cmapF).replace(' style="', ' style="padding:10px 0;border-bottom:1px solid var(--border2);') || ' style="padding:10px 0;border-bottom:1px solid var(--border2)"'}>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div class="fs-name" style="font-size:12px;font-weight:700;color:var(--ink)">${_bargeDot(b.name, cmapF)}${esc(b.name||('Barge '+(b.id||'')))}</div>
        <span class="badge ${statusClass}" style="font-size:9.5px">${statusLabel}</span>
      </div>
      <div class="progress-bar-wrap">
        <div class="progress-row">
          <div class="progress-label-row"><span style="font-size:10px;color:var(--muted)">VLSFO</span><span style="font-size:10px;font-family:'DM Mono',monospace;color:var(--fuel-v)">${Math.round(v).toLocaleString()} MT</span></div>
          <div class="progress-track"><div class="progress-fill" style="width:${pctV}%;background:var(--fuel-v)"></div></div>
        </div>
        <div class="progress-row">
          <div class="progress-label-row"><span style="font-size:10px;color:var(--muted)">LSMGO</span><span style="font-size:10px;font-family:'DM Mono',monospace;color:var(--fuel-m)">${Math.round(m).toLocaleString()} MT</span></div>
          <div class="progress-track"><div class="progress-fill" style="width:${pctM}%;background:var(--fuel-m)"></div></div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderDashActivity(records, vessels) {
  const el = document.getElementById('dash-activity-feed');
  if (!el) return;
  const items = [];
  // Upcoming/active Loading operations — shown first since they're the
  // most time-sensitive item on this feed (terminal occupancy affects
  // how other supply gets planned).
  const _ldNow = new Date();
  (_loadingRecords || [])
    .filter(function(r) { return !r.deletedAt && !r.completed && new Date(r.endAt) >= _ldNow; })
    .sort(function(a, b) { return new Date(a.startAt) - new Date(b.startAt); })
    .slice(0, 5)
    .forEach(function(r) {
      const start = new Date(r.startAt), end = new Date(r.endAt);
      const t = start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
      const dateLbl = start.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      if (r.kind === 'transfer') {
        items.push({
          color: 'var(--purple)',
          title: `Barge Transfer Scheduled — ${r.grade}`,
          detail: `${r.fromBarge || ''} → ${_resolveRecordBargeName(r)} — ${(Number(r.qty) || 0).toLocaleString()} MT ${r.grade} · Ends ${end.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false})}`,
          time: dateLbl + ' ' + (r.startWin && _etaFrame(r.startWin) ? _etaFrame(r.startWin).code : t),
          onclick: `showPage('loading');editLoadingRecord('${escJs(r.id)}')`,
        });
        return;
      }
      const color = r.grade === 'LSMGO' ? 'var(--fuel-m)' : 'var(--fuel-v)';
      const ldWin = r.startWin && _etaFrame(r.startWin) ? _etaFrame(r.startWin).code : '';
      items.push({
        color,
        title: `Loading Scheduled — ${r.grade}`,
        detail: `${r.terminal} — ${r.qty.toLocaleString()} MT ${r.grade} · ${_resolveRecordBargeName(r)}${r.surveyor ? ' · Surveyor: ' + r.surveyor : ''} · Ends ${end.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false})}`,
        time: dateLbl + ' ' + (ldWin || t),
        onclick: `showPage('loading');editLoadingRecord('${escJs(r.id)}')`,
      });
    });
  // Recently-completed Loading operations — marking a Loading "Done" used
  // to just silently drop it from this feed with no record it ever
  // happened. Show it here instead, tagged by grade, same as the
  // scheduled ones above.
  (_loadingRecords || [])
    .filter(function(r) { return !r.deletedAt && r.completed && r.completedAt; })
    .sort(function(a, b) { return b.completedAt - a.completedAt; })
    .slice(0, 5)
    .forEach(function(r) {
      const d = new Date(r.completedAt);
      const t = isNaN(d) ? '—' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
      const dateLbl = isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      if (r.kind === 'transfer') {
        items.push({
          color: 'var(--purple)',
          title: `Barge Transfer Completed — ${r.grade}`,
          detail: `${r.fromBarge || ''} → ${_resolveRecordBargeName(r)} — ${(Number(r.qty) || 0).toLocaleString()} MT ${r.grade}`,
          time: (dateLbl + ' ' + t).trim() || '—',
          onclick: `showPage('loading')`,
        });
        return;
      }
      const color = r.grade === 'LSMGO' ? 'var(--fuel-m)' : 'var(--fuel-v)';
      items.push({
        color,
        title: `Loading Completed — ${r.grade}`,
        detail: `${r.terminal} — ${r.qty.toLocaleString()} MT ${r.grade}${r.surveyor ? ' · Surveyor: ' + r.surveyor : ''}`,
        time: (dateLbl + ' ' + t).trim() || '—',
        onclick: `showPage('loading')`,
      });
    });
  // From _savedSupplies (live in-memory — most accurate)
  const liveRecs = (_savedSupplies && _savedSupplies.length) ? _savedSupplies : records;
  liveRecs.slice(-8).reverse().forEach(r => {
    const d = new Date(r.savedAt || 0);
    const t = isNaN(d) ? '—' : d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    items.push({ color:'var(--green)', title:'Supply Completed', detail:`${r.vessel||'Vessel'} — ${r.vlsfoAct||r.vlsfoActual||0} MT VLSFO, ${r.mgoAct||r.mgoActual||0} MT LSMGO via ${r.barge||'Barge'}`, time: t });
  });
  // From vessel nomination cards in DOM (live). Cards are appended to #vc in
  // the order they're added, so the most recently added nomination is the
  // LAST element returned by querySelectorAll. Reverse before building items
  // so a freshly-added nomination shows up first, not pushed off the end of
  // the feed by items.slice(0,10) below.
  Array.from(document.querySelectorAll('#vc .vcard[id^="vessel-"]')).reverse().forEach(card => {
    const cid = card.id.replace('vessel-', '');
    const nm = document.getElementById('v'+cid+'-name')?.value || 'Vessel';
    const et = _cardEtaTxt(cid) || 'TBD';
    const vq = document.getElementById('v'+cid+'-vlsfo')?.value || '0';
    items.push({ color:'var(--fuel-v)', title:'Nomination', detail:`${nm} — ${vq} MT VLSFO  ETA ${et}`, time:'—' });
  });
  if (!items.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center;padding:24px">No activity yet. Add nominations or generate a schedule.</div>';
    return;
  }
  // title/detail/time are plain text built from cloud data (vessel, barge,
  // terminal, surveyor names) — escape them here, once, at the sink.
  el.innerHTML = items.slice(0,10).map(i =>
    `<div class="activity-item" ${i.onclick ? `style="cursor:pointer" onclick="${i.onclick}"` : ''}>
      <div class="activity-dot" style="background:${i.color}"></div>
      <div class="activity-content">
        <div class="activity-title">${esc(i.title)}</div>
        <div class="activity-detail">${esc(i.detail)}</div>
      </div>
      <div class="activity-time">${esc(i.time)}</div>
    </div>`
  ).join('');
}

function renderDashCharts(records, vessels) {
  // ── WEEKLY PLANNED SUPPLY CALENDAR ──
  renderWeekCalendar(0);

  // ── FUEL MIX DISTRIBUTION — real live data, split into DISTRIBUTED vs PLANNED ──
  {
    // DISTRIBUTED = actual quantities already delivered THIS CALENDAR MONTH ONLY.
    // Full history is still available in Monthly Report / Archives — this card
    // is meant to answer "how much have we put out so far this month," not an
    // all-time running total.
    //
    // Pulled straight from _getAllReportRecords() — the exact same function
    // getMonthlyRows() (the Monthly Report's own source of truth) uses — rather
    // than maintaining a second, separate live+archive merge here. That second
    // copy had already drifted out of sync with the report twice: once on
    // filter criteria (fixed, then found the report's dedup pass wasn't
    // mirrored either), which is exactly the kind of repeat drift that calling
    // the same function outright prevents going forward. _getAllReportRecords()
    // already includes the near-duplicate safety net (same vessel/day/quantity
    // records that slipped past id-matching) that this card never had.
    const _fdNow = new Date(), _fdMon = _fdNow.getMonth(), _fdYr = _fdNow.getFullYear();
    let distV = 0, distM = 0;
    (typeof _getAllReportRecords === 'function' ? _getAllReportRecords() : []).forEach(r => {
      if (!r.supplyDate || r.supplied !== true) return;
      const _fdD = _parseLocalDate(r.supplyDate);
      if (_fdD.getMonth() !== _fdMon || _fdD.getFullYear() !== _fdYr) return;
      distV += _recActQty(r, 'v');
      distM += _recActQty(r, 'm');
    });

    // PLANNED = quantities still to be supplied per fuel type, taking barge ROB
    // into account. The generated schedule (_lastSched) already factors each
    // barge's live ROB / availability when it assigns quantities, so it is the
    // ROB-aware source of truth for what's planned; live nomination inputs are
    // only used as a fallback before a schedule has been generated.
    let planV = 0, planM = 0;
    if (_lastSched && _lastSched.length) {
      _lastSched.forEach(item => {
        planV += ((item.nomVQ!==undefined&&item.nomVQ!==null)?item.nomVQ:item.vQ)||0;
        planM += ((item.nomMQ!==undefined&&item.nomMQ!==null)?item.nomMQ:item.mQ)||0;
      });
    } else {
      document.querySelectorAll('#vc .vcard[id^="vessel-"]').forEach(card => {
        const cid = card.id.replace('vessel-','');
        const ty = document.getElementById('v'+cid+'-type')?.value || 'BOTH';
        if (ty !== 'MGO')   planV += _cardQty(cid, 'vlsfo').qty;
        if (ty !== 'VLSFO') planM += _cardQty(cid, 'mgo').qty;
      });
    }

    const _fdTextColor = _chartTextColor();
    const _fdColors = [_skinPal('rgba(47,111,237,.85)'),_skinPal('rgba(255,122,26,.78)')];
    function _buildFuelDonut(key, canvasId, vVal, mVal) {
      const ctx = document.getElementById(canvasId);
      if (!ctx) return;
      if (_chartInstances[key]) _chartInstances[key].destroy();
      const rv = vVal || 0, rm = mVal || 0;
      _chartInstances[key] = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['VLSFO', 'LSMGO'],
          datasets: [{ data:[rv, rm], backgroundColor:_fdColors, borderWidth:2, borderColor:'#fff', hoverOffset:8 }]
        },
        options: {
          responsive:true, maintainAspectRatio:false, cutout:'66%',
          plugins:{
            legend:{ position:'bottom', labels:{ font:{size:10,family:_skinFont('DM Sans')}, boxWidth:10, padding:10, color:_fdTextColor,
              generateLabels: chart => chart.data.labels.map((label,i) => ({
                text: label+' — '+fmtMT(chart.data.datasets[0].data[i])+' MT',
                fillStyle: chart.data.datasets[0].backgroundColor[i],
                fontColor: _fdTextColor, color: _fdTextColor,
                strokeStyle:'#fff', lineWidth:0, hidden:false, index:i, datasetIndex:0
              }))
            }},
            tooltip:{ callbacks:{ label: c => ` ${c.label}: ${fmtMT(c.parsed)} MT` }}
          }
        }
      });
      // Safety net: if this chart was created while its container hadn't been
      // laid out yet (e.g. 0-width during a page transition), the canvas can
      // end up stuck at a bogus size with a clipped/invisible legend. A resize
      // on the next frame re-measures the now-visible container and redraws.
      requestAnimationFrame(() => { try { _chartInstances[key]?.resize(); } catch(e) {} });
    }
    _buildFuelDonut('fuel-dist-distributed', 'chart-fuel-dist-distributed', distV, distM);
    _buildFuelDonut('fuel-dist-planned',     'chart-fuel-dist-planned',     planV, planM);
    // Bunker Quantity line chart — current FY (FY26: Jan–Jul seeded, Aug onward live)
    const _dqTitle = document.getElementById('dash-monthly-qty-title');
    if (_dqTitle) _dqTitle.textContent = 'Bunker Quantity — ' + _fyLabel(_currentFY());
    renderMonthlyQuantityChart('chart-monthly-qty-dashboard', 'line', 'dash-monthly-qty-summary', 'dash-monthly-qty-subtitle');
  }
}

/* ── Nomination KPIs — reads directly from vessel cards in DOM ── */
function refreshNominationKPIs() {
  const cards = document.querySelectorAll('#vc .vcard[id^="vessel-"]');
  let paq = 0, v = 0, m = 0, unassigned = 0;
  cards.forEach(card => {
    const cid = card.id.replace('vessel-', '');
    const paqEl  = document.getElementById('v' + cid + '-paq');
    const typeEl = document.getElementById('v' + cid + '-type');
    const vEl    = document.getElementById('v' + cid + '-vlsfo');
    const mEl    = document.getElementById('v' + cid + '-mgo');
    const brg    = document.getElementById('v' + cid + '-barge');
    const ty = typeEl ? typeEl.value : 'BOTH';
    if (paqEl && paqEl.value !== 'yes') paq++;
    if (ty !== 'MGO')   v += _parseQtyInput(vEl?.value).qty;
    if (ty !== 'VLSFO') m += _parseQtyInput(mEl?.value).qty;
    if (!brg || !brg.value) unassigned++;
  });
  safeSet('nom-kpi-total',   cards.length);
  safeSet('nom-kpi-pending', unassigned);
  safeSet('nom-kpi-paq',     paq);
  safeSet('nom-kpi-vlsfo',   fmtMT(v));
  safeSet('nom-kpi-lsmgo',   fmtMT(m));
}

/* ── Schedule KPIs — reads from _lastSched set by calculate() ── */
function refreshScheduleKPIs() {
  if (!_lastSched || !_lastSched.length) {
    // No schedule — reset the KPI cards to their blank state instead of
    // silently leaving whatever numbers were last rendered (that stale-
    // display bug was why Schedule Planner kept showing old totals/table
    // even after Clear All Data wiped the underlying data).
    safeSet('sched-kpi-ops',     '—');
    safeSet('sched-kpi-delayed', '—');
    safeSet('sched-kpi-vlsfo',   '—');
    safeSet('sched-kpi-lsmgo',   '—');
    return;
  }
  let ops = _lastSched.length, delayed = 0, v = 0, m = 0;
  _lastSched.forEach(item => {
    if (item.isDelayed) delayed++;
    v += ((item.nomVQ!==undefined&&item.nomVQ!==null)?item.nomVQ:item.vQ) || 0;
    m += ((item.nomMQ!==undefined&&item.nomMQ!==null)?item.nomMQ:item.mQ) || 0;
  });
  safeSet('sched-kpi-ops',     ops);
  safeSet('sched-kpi-delayed', delayed);
  safeSet('sched-kpi-vlsfo',   v ? fmtMT(v) + ' MT' : '—');
  safeSet('sched-kpi-lsmgo',   m ? fmtMT(m) + ' MT' : '—');
}

