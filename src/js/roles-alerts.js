/* ═══════════════════════════════════════════════════════════════
   ROLE ACCESS — per-account trader / operator restriction
   ─────────────────────────────────────────────────────────────
   Each signed-in Supabase account has a row in the `user_roles`
   table (role = 'operator' or 'trader'). Operators keep full
   access to everything, exactly as before. Trader accounts are
   restricted to Dashboard (view only) + Vessel Nominations
   (view + edit) — every other sidebar page and every destructive
   admin action (the sidebar Data Management: Full Reset, Wipe Cloud,
   Clear All Data, Clear Checklist, Clear Saved Records) is hidden
   from them.

   IMPORTANT: hiding UI here is convenience only, not the real
   security boundary. The actual enforcement lives in Supabase's
   Row Level Security policies + the trader_update_vessels() RPC
   function (see the SQL setup file) — those refuse the write at
   the database level even if someone bypasses this UI entirely
   via browser dev tools. The UI still defaults to LEAST privilege:
   only an account whose user_roles row says 'operator' gets the
   operator view. A lookup that keeps failing (retried with backoff),
   or an account with no role row at all (which RLS lets write
   nothing), gets the trader view plus a notice explaining why.
   ═══════════════════════════════════════════════════════════════ */

let ABPS_ROLE = 'trader'; // least-privilege UI default until the real lookup resolves
let ABPS_UID = null;
function isTrader() { return ABPS_ROLE === 'trader'; }

/* ─── Global in-app alerts (topbar bell) ─────────────────────────────
   Single shared source of truth for "what counts as an alert" — ROB
   below 20% per grade per barge, and any active vessel outside its
   nominated laycan. Lives in the topbar (not Command Center, which
   traders can't even open — see TRADER_ALLOWED_PAGES above) so both
   roles see it, on every page, without needing OS-level push
   permissions — this is what was actually meant by "in-app" alerts. */
let _globalAlertsPrevKeys = null; // null = first computation, don't toast anything yet
function computeGlobalAlerts() {
  const alerts = [];
  (_lastSched || []).forEach(function(item) {
    // Match THIS nomination (nomUid), not just the vessel name — a vessel
    // supplied last week and re-nominated today must still raise its alert.
    if (_isScheduleItemCompleted(item)) return;
    if (item.isDelayed) alerts.push({ key: 'laycan|' + item.name, label: 'Outside laycan', sub: item.name, severity: 'warning' });
  });
  const liveROBs = (typeof getAllLiveROBs === 'function') ? getAllLiveROBs() : {};
  (_bargeConfig || []).forEach(function(b) {
    const rob = liveROBs[b.id] || { liveV: 0, liveM: 0 };
    if (b.vcap && (rob.liveV || 0) / b.vcap < 0.2) alerts.push({ key: 'vrob|' + b.name, label: 'VLSFO ROB low', sub: b.name, severity: 'error' });
    if (b.mcap && (rob.liveM || 0) / b.mcap < 0.2) alerts.push({ key: 'mrob|' + b.name, label: 'LSMGO ROB low', sub: b.name, severity: 'error' });
  });
  // Projected shortfalls from the reload planner (next 7 days), one per
  // barge + grade + nomination; `go` = barge id to open the forecast at.
  if (!isTrader() && typeof _rlAlerts === 'function') {
    try { _rlAlerts().forEach(function(a) { alerts.push(a); }); } catch (e) { console.warn('ABPS: reload alerts failed', e); }
  }
  // Upcoming nominations without a valid IMO or MMSI — one per nomination
  // ('ids|<nomUid>'). Listed, never toasted (see _refreshGlobalAlertsBell).
  if (typeof _vidAlerts === 'function') {
    try { _vidAlerts().forEach(function(a) { alerts.push(a); }); } catch (e) { console.warn('ABPS: IMO/MMSI alerts failed', e); }
  }
  return alerts;
}

function toggleGlobalAlertsPanel(evt) {
  if (evt) evt.stopPropagation();
  const dd = document.getElementById('global-alerts-dropdown');
  if (!dd) return;
  dd.style.display = (dd.style.display === 'none' || !dd.style.display) ? 'block' : 'none';
}
document.addEventListener('click', function(evt) {
  const wrap = document.getElementById('global-alerts-wrap');
  const dd = document.getElementById('global-alerts-dropdown');
  if (dd && dd.style.display === 'block' && wrap && !wrap.contains(evt.target)) dd.style.display = 'none';
});

function _refreshGlobalAlertsBell() {
  const badge = document.getElementById('global-alerts-badge');
  const list = document.getElementById('global-alerts-list');
  if (!badge && !list) return; // topbar not in DOM yet (e.g. login gate)
  const alerts = computeGlobalAlerts();

  if (badge) {
    if (alerts.length) { badge.textContent = alerts.length > 9 ? '9+' : alerts.length; badge.style.display = ''; }
    else badge.style.display = 'none';
  }
  if (list) {
    list.innerHTML = alerts.length
      ? alerts.map(function(a) {
          const color = a.severity === 'error' ? 'var(--red)' : 'var(--amber)';
          // Missing IMO / MMSI opens the nomination card.
          if (a.kind === 'ids' && a.cid != null) return `<div class="ga-item ga-open" role="button" tabindex="0" data-alert-key="${esc(a.key)}" onclick="_vidGoTo('${escJs(a.cid)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();_vidGoTo('${escJs(a.cid)}')}" style="padding:7px 6px;border-top:1px solid var(--border);font-size:12px;cursor:pointer">
            <div style="font-weight:700;color:${color}">${esc(a.label)}</div>
            <div style="color:var(--sub);font-size:11px;margin-top:1px">${esc(a.sub)}</div>
          </div>`;
          // Reload alerts open the barge's forecast.
          if (a.go != null) return `<div class="ga-item ga-link" role="button" tabindex="0" data-alert-key="${esc(a.key)}" onclick="rlGoToForecast('${escJs(a.go)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();rlGoToForecast('${escJs(a.go)}')}" style="padding:7px 6px;border-top:1px solid var(--border);font-size:12px;cursor:pointer">
            <div style="font-weight:700;color:${color}">${esc(a.label)}</div>
            <div style="color:var(--sub);font-size:11px;margin-top:1px">${esc(a.sub)}</div>
          </div>`;
          return `<div style="padding:7px 6px;border-top:1px solid var(--border);font-size:12px">
            <div style="font-weight:700;color:${color}">${esc(a.label)}</div>
            <div style="color:var(--sub);font-size:11px;margin-top:1px">${esc(a.sub)}</div>
          </div>`;
        }).join('')
      : '<div style="padding:14px 6px;text-align:center;color:var(--muted);font-size:12px">No active alerts</div>';
  }

  // Toast any alert that's genuinely new since the last check — skipped on
  // the very first computation after page load, since nothing already
  // there when you open the app is a "new" surprise.
  if (_globalAlertsPrevKeys) {
    alerts.forEach(function(a) {
      // A missing IMO / MMSI is listed (bell, Needs Attention) but never toasted:
      // a new card has none until it's typed in, and the Generate Schedule /
      // e-mail warnings already say it once when it matters.
      if (a.kind === 'ids') return;
      if (!_globalAlertsPrevKeys.has(a.key)) {
        showToast(`${a.label} — ${a.sub}`, a.severity, 5000);
      }
    });
  }
  _globalAlertsPrevKeys = new Set(alerts.map(a => a.key));
}

const TRADER_ALLOWED_PAGES = ['dashboard', 'nominations', 'bargetracking'];

function _roleTimeout(p, ms) {
  return Promise.race([p, new Promise(function(_, rej) { setTimeout(function() { rej(new Error('timed out')); }, ms); })]);
}
function _readRoleCache(uid) {
  try { const c = JSON.parse(localStorage.getItem(ROLE_CACHE_LS_KEY) || 'null'); return (c && uid && c.uid === uid) ? c.role : null; } catch(e) { return null; }
}

async function _fetchAndApplyUserRole() {
  // Least privilege: nothing becomes 'operator' unless the server says so.
  ABPS_ROLE = 'trader';
  ABPS_UID = null;
  let resolved = false, noRoleRow = false, lastErr = null;
  const last = (typeof _readLastLogin === 'function') ? _readLastLogin() : null;

  if (supabaseClient && !_flowOfflineLaunch) {
    for (let attempt = 0; attempt < 3 && !resolved; attempt++) {
      if (attempt) await new Promise(function(r) { setTimeout(r, 600 * Math.pow(2, attempt - 1)); }); // 0.6s, 1.2s
      try {
        const { data: sessionData } = await _roleTimeout(supabaseClient.auth.getSession(), 8000);
        const uid = sessionData && sessionData.session && sessionData.session.user && sessionData.session.user.id;
        ABPS_UID = uid || null;
        if (!uid) { resolved = true; break; } // no session — nothing to look up, stay least-privileged
        const { data, error } = await _roleTimeout(supabaseClient
          .from('user_roles')
          .select('role')
          .eq('user_id', uid)
          .maybeSingle(), 8000);
        if (error) throw new Error(error.message || 'role lookup error');
        if (data && data.role === 'operator') ABPS_ROLE = 'operator';
        else if (!data || data.role !== 'trader') noRoleRow = true;
        resolved = true;
        try { localStorage.setItem(ROLE_CACHE_LS_KEY, JSON.stringify({ uid: uid, role: noRoleRow ? null : ABPS_ROLE })); } catch(e) {}
      } catch(e) {
        lastErr = e;
        console.warn('ABPS: role lookup attempt ' + (attempt + 1) + ' failed:', e && e.message);
      }
    }
  }

  if (_flowOfflineLaunch) {
    // Offline launch: no server to ask. The last role the server confirmed
    // for this same account is used for page visibility only — every write
    // still needs a live session, so this can't grant anything server-side.
    ABPS_UID = (last && last.uid) || null;
    const cached = _readRoleCache(ABPS_UID);
    if (cached === 'operator') ABPS_ROLE = 'operator';
  } else if (!resolved) {
    console.warn('ABPS: role lookup failed after retries — using the restricted trader view for this session.', lastErr && lastErr.message);
    showToast('Could not confirm your account role (' + ((lastErr && lastErr.message) || 'connection problem') + '). Showing the limited view — reload to try again.', 'warning', 0);
  } else if (noRoleRow && ABPS_UID) {
    showToast('This account has no assigned role, so it can view but not change the shared workspace. Ask your operations lead to add it in Supabase (user_roles).', 'warning', 0);
  }
  _applyRoleUIRestrictions();
}

let _origShowPageForRole = null;
function _applyRoleUIRestrictions() {
  // Bulk-delete actions are operator-only and start hidden (least privilege)
  // until the role lookup confirms an operator.
  const dz = document.getElementById('danger-zone');
  if (dz) dz.style.display = isTrader() ? 'none' : '';
  if (!isTrader()) return; // operators see everything — nothing to change

  // Hide every sidebar nav item except Dashboard + Vessel Nominations
  document.querySelectorAll('#sidebar a[id^="nav-"]').forEach(function(a) {
    const pageId = a.id.replace('nav-', '');
    if (TRADER_ALLOWED_PAGES.indexOf(pageId) === -1) a.style.display = 'none';
  });

  // Hide sidebar links that don't have nav- ids: Monthly Report (the
  // destructive actions sit in the Data Management section, hidden above)
  document.querySelectorAll('#sidebar a[onclick^="openMonthlyReport"]').forEach(function(a) {
    a.style.display = 'none';
  });

  // Belt-and-braces: hide each destructive action itself too
  ['topbar-fullreset-btn', 'topbar-wipecloud-btn', 'topbar-clearall-btn', 'danger-clearchecklist-btn', 'danger-clearrecords-btn'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // Free Windows is an operator planning/commercial tool (nominating into
  // open capacity) — not part of what a trader needs, so hide the toggle
  // button entirely rather than let them open a panel meant for the other
  // role.
  const freeWinBtn = document.getElementById('free-windows-toggle-btn');
  if (freeWinBtn) freeWinBtn.style.display = 'none';
  const freeWinPanel = document.getElementById('free-windows-panel');
  if (freeWinPanel) freeWinPanel.style.display = 'none';

  // Belt-and-braces: if a trader ever lands on a restricted page (deep link,
  // stale hash, leftover code path), bounce them back to Dashboard instead
  // of silently rendering a page they shouldn't be on.
  if (typeof showPage === 'function' && !_origShowPageForRole) {
    _origShowPageForRole = showPage;
    showPage = function(id) {
      if (isTrader() && TRADER_ALLOWED_PAGES.indexOf(id) === -1) id = 'dashboard';
      return _origShowPageForRole(id);
    };
  }

  // Small visible indicator so a trader (and anyone glancing at their
  // screen) can tell this is a restricted view, not a bug.
  const menuBtn = document.getElementById('topbar-menu-btn');
  if (menuBtn && !document.getElementById('role-badge')) {
    const badge = document.createElement('span');
    badge.id = 'role-badge';
    badge.textContent = 'Trader view';
    badge.style.cssText = 'font-size:10.5px;font-weight:700;letter-spacing:.03em;color:#fff;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.4);border-radius:5px;padding:3px 8px;margin-right:6px;white-space:nowrap';
    menuBtn.parentNode.parentNode.insertBefore(badge, menuBtn.parentNode);
  }
}
