/* ── TOAST NOTIFICATIONS ──────────────────────────────────────────
   Confirms an action actually happened. type: 'success'|'error'|
   'info'|'warning'. Auto-dismisses after `duration`ms (0 = sticky,
   dismiss via the × only — used for errors worth reading twice). ── */
const _TOAST_ICONS = {
  success: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  error:   '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  info:    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  warning: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
};
function showToast(message, type, duration) {
  type = type || 'success';
  duration = duration === undefined ? 3200 : duration;
  const stack = document.getElementById('toast-stack');
  if (!stack) return;
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.innerHTML =
    '<span class="toast-icon">' + (_TOAST_ICONS[type] || _TOAST_ICONS.success) + '</span>' +
    '<span class="toast-msg"></span>' +
    '<span class="toast-close" title="Dismiss">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
    '</span>';
  t.querySelector('.toast-msg').textContent = message; // textContent, not innerHTML — never trust caller text as markup
  const remove = function() {
    t.classList.add('toast-leaving');
    setTimeout(function() { t.remove(); }, 180);
  };
  t.querySelector('.toast-close').onclick = remove;
  stack.appendChild(t);
  if (duration > 0) setTimeout(remove, duration);
}

/* ── Hook into calculate() to trigger page route ── */
function _routerOnScheduleReady() {
  _scheduleReady = true;
  // Small delay lets renderOutput finish writing to DOM first
  setTimeout(function() {
    refreshScheduleKPIs();
    refreshNominationKPIs();
    refreshDashboard();
    refreshAlertsPage();
    updateAlertsBadge();
    if (typeof _rlRefreshIfShown === 'function') _rlRefreshIfShown();
  }, 150);
  showPage('schedule');
}

/* addVessel nom refresh is triggered via MutationObserver below */

/* ── Live clock ── */
function updateClock() {
  // Replaced by the second-resolution UAE clock below — this is a no-op stub
  // to prevent any earlier call from erroring
}
updateClock();
// The real UAE live clock is initialised later in the script (second-resolution, Asia/Dubai)

/* ── Date subtitle ── */
document.addEventListener('DOMContentLoaded', () => {
  refreshDashboard();
  showPage('dashboard');
  // Observe vessel card container to refresh KPIs on change. subtree:true
  // fires for every tiny DOM tweak (pickers, badges, button labels), and a
  // full dashboard rebuild destroys/recreates charts — so coalesce bursts
  // into one refresh and skip it entirely while the dashboard isn't on
  // screen (showPage('dashboard') refreshes on arrival anyway).
  const vcEl = document.getElementById('vc');
  if (vcEl) {
    new MutationObserver(() => { _scheduleDashRefresh(true); }).observe(vcEl, {childList:true, subtree:true});
  }
  // Observe barge list for KPI refresh
  const blEl = document.getElementById('barge-list');
  if (blEl) {
    new MutationObserver(() => _scheduleDashRefresh(false)).observe(blEl, {childList:true, subtree:true});
  }
});
let _dashRefreshTimer = null, _dashRefreshNomKPIs = false;
function _scheduleDashRefresh(nomKPIs) {
  if (nomKPIs) _dashRefreshNomKPIs = true;
  if (_dashRefreshTimer) return;
  _dashRefreshTimer = setTimeout(function() {
    _dashRefreshTimer = null;
    if (_dashRefreshNomKPIs) { _dashRefreshNomKPIs = false; try { refreshNominationKPIs(); } catch(e) { console.warn('ABPS: nomination KPI refresh failed:', e); } }
    if (_currentPage === 'dashboard') refreshDashboard();
    // Barge edits (ROB, buffers, capacity) re-draw the forecast on Barge Fleet.
    if (_currentPage === 'bargefleet' && typeof renderReloadPlanner === 'function') { try { renderReloadPlanner('reload-planner-body'); } catch(e) { console.warn('ABPS: reload planner refresh failed:', e); } }
  }, 200);
}
// Alias function names for compatibility
function permanentlyDeleteFromTrash(idx) { if(typeof permanentDeleteFromTrash==='function') permanentDeleteFromTrash(idx); }
