/* ═══════════════════════════════════════════════════════
   PAGE ROUTER — showPage() drives all navigation
   Each sidebar click calls showPage(id)
   topbar title updates per page
═══════════════════════════════════════════════════════ */

const PAGE_META = {
  dashboard:    { title: 'Operations Dashboard',        sub: 'Bunker planning overview — live data',                                    section: 'operations' },
  nominations:  { title: 'Vessel Nominations',          sub: 'Central nomination register — intake, assignment, PAQ tracking',           section: 'operations' },
  schedule:     { title: 'Schedule Planner',            sub: 'Intelligent barge-vessel assignment · ROB impact · Conflict detection',     section: 'operations' },
  loading:      { title: 'Loading Operations',          sub: 'Terminal loading schedule — quantity, grade, and estimated duration',       section: 'planning' },
  timeline:     { title: 'Supply Timeline',             sub: 'Operational supply timeline — active vessels only',                        section: 'operations' },
  alerts:       { title: 'Alerts & Notices',            sub: 'PAQ status · Barge ROB alerts · Replenishment · Schedule reminders',        section: 'operations' },
  bargefleet:   { title: 'Barge Fleet Configuration',   sub: 'Register barges, ROB, pump rates and operational parameters',               section: 'planning' },
  availability: { title: 'Availability Check',          sub: 'Next Supply Availability — multi-barge checker with split recommendation', section: 'planning' },
  agents:       { title: 'Agent Directory',             sub: 'Fujairah shipping agents — company names & email contacts',                section: 'planning' },
  reports:      { title: 'Reports & Analytics',         sub: 'Supply performance, fuel volumes, barge utilisation',                      section: 'reports' },
  deals:        { title: 'Loading Deals',               sub: 'Bulk purchases — what each loading lifted (per BL) and what is left to lift', section: 'reports' },
  commandcenter:{ title: 'Command Center',              sub: 'Live wallboard — barge ROB, vessel schedule, active alerts',                section: 'system' },
  checklist:    { title: 'Supply Operations Checklist', sub: 'Enter actuals and save each supply',                                         section: 'reports' },
  records:      { title: 'Saved Supply Records',        sub: 'All completed supply operations — historical log',                          section: 'reports' },
  bargetracking:{ title: 'Barge Tracking Reports',      sub: 'Barge tracking report uploads — view and download',                        section: 'reports' },
  deliverylog:  { title: 'Delivery Log',                sub: 'Timely / Delayed deliveries and dispute log — by month',                    section: 'system' },
  archives:     { title: 'Archives',                    sub: 'Monthly archives — survive Full Reset',                                    section: 'system' },
  trash:        { title: 'Trash Bin',                   sub: 'Removed vessels — restore or permanently delete',                           section: 'system' },
};

const SECTION_LABELS = { operations: 'Operations', planning: 'Planning', reports: 'Reports', system: 'System' };

let _currentPage = 'dashboard';
let _chartInstances = {};

function showPage(id) {
  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  // Show target
  const page = document.getElementById('page-' + id);
  if (page) page.classList.add('active');

  // Update sidebar active
  document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
  const navEl = document.getElementById('nav-' + id);
  if (navEl) navEl.classList.add('active');

  // Update topbar
  const meta = PAGE_META[id] || { title: id, sub: '', section: 'operations' };
  document.getElementById('topbar-page-title').textContent = meta.title;
  document.getElementById('topbar-page-sub').textContent   = meta.sub;
  const sec = meta.section || 'operations';
  document.getElementById('topbar-section-label').textContent = SECTION_LABELS[sec] || sec;
  document.getElementById('topbar').style.setProperty('--topbar-fill', 'var(--pg-' + id + ')');

  _currentPage = id;

  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');

  // Page-specific refresh hooks
  if (id === 'dashboard')    refreshDashboard();
  if (id === 'reports')      refreshReports();
  if (id === 'deals')        renderDeals();
  if (id === 'commandcenter') renderCommandCenter();
  if (id === 'records')      renderSavedRecords();
  if (id === 'checklist')    { renderChecklist(_lastSched || []); }
  if (id === 'loading')      { renderLoadingPage(); }
  if (id === 'bargefleet')   renderReloadPlanner('reload-planner-body');
  if (id === 'bargetracking') { renderBargeTrackingPage(); }
  if (id === 'timeline')     {
    renderLiveROBDashboard();
    if (_lastSched && _lastSched.length && typeof renderBargeTabsAndTL === 'function')
      renderBargeTabsAndTL(_lastSched, _bargeConfig && _bargeConfig.length ? _bargeConfig : []);
    if (typeof renderTimelineLoadingStrip === 'function') renderTimelineLoadingStrip();
  }
  if (id === 'nominations')  refreshNominationKPIs();
  if (id === 'schedule')     refreshScheduleKPIs();
  if (id === 'archives')     { renderArchivePanel(); renderArchivedFYList(); }
  if (id === 'deliverylog')  renderDeliveryLog();
  if (id === 'agents')       renderAgentDirectory();
  if (id === 'trash')        renderTrashBin();
  if (id === 'alerts')       refreshAlertsPage();
}

/* ─── Topbar overflow menu (Full Reset / Wipe Cloud / Clear All Data / Log Out) ─── */
function toggleTopbarMenu(evt) {
  if (evt) evt.stopPropagation();
  const dd = document.getElementById('topbar-menu-dropdown');
  if (!dd) return;
  dd.style.display = (dd.style.display === 'none' || !dd.style.display) ? 'block' : 'none';
}
function closeTopbarMenu() {
  const dd = document.getElementById('topbar-menu-dropdown');
  if (dd) dd.style.display = 'none';
}
document.addEventListener('click', function(evt) {
  const wrap = document.getElementById('topbar-menu-wrap');
  if (wrap && !wrap.contains(evt.target)) closeTopbarMenu();
});

function toggleSidebar() {
  // Narrow phone viewports keep the existing slide-in overlay drawer.
  // Anything wider (including a phone's "Desktop site" mode, which reports
  // a viewport past the 768px breakpoint) gets a persistent collapse that
  // reclaims the sidebar's width for the main content.
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.toggle('open');
    return;
  }
  const collapsed = document.body.classList.toggle('sidebar-collapsed');
  try { localStorage.setItem('abps_sidebar_collapsed', collapsed ? '1' : '0'); } catch(e) {}
}
// Restore a previously-collapsed sidebar on load (desktop-width sessions only).
(function _restoreSidebarCollapsed() {
  try {
    if (localStorage.getItem('abps_sidebar_collapsed') === '1' && window.innerWidth > 768) {
      document.addEventListener('DOMContentLoaded', function() {
        document.body.classList.add('sidebar-collapsed');
      });
    }
  } catch(e) {}
})();

/* ── LIGHT / DARK THEME TOGGLE ──────────��───────────────────────────
   Flips html[data-theme] between 'light' and 'dark', persists the
   choice per-device in localStorage, and syncs the sun/moon icon. ── */
function _syncThemeIcon() {
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  var sun = document.getElementById('theme-icon-sun');
  var moon = document.getElementById('theme-icon-moon');
  if (sun)  sun.style.display  = isDark ? 'none' : 'block';
  if (moon) moon.style.display = isDark ? 'block' : 'none';
}
function toggleColorTheme() {
  var html = document.documentElement;
  var next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  try { localStorage.setItem('flow-theme', next); } catch(e) {}
  _syncThemeIcon();
  // Charts render to <canvas> and can't read CSS variables, so their tick/
  // legend colors are baked in at creation time — re-apply the palette and
  // rebuild any charts that already exist so they don't stay stuck on the
  // previous theme's (invisible) text color.
  try {
    if (typeof _applyChartJsTheme === 'function') _applyChartJsTheme();
    if (typeof _savedSupplies !== 'undefined' && typeof renderReportCharts === 'function') renderReportCharts(_savedSupplies);
    if (typeof refreshDashboard === 'function') refreshDashboard();
    if (typeof renderWeekCalendar === 'function') renderWeekCalendar(_calWeekOffset || 0);
  } catch(e) { /* charts/data not ready yet — safe to ignore */ }
  if (typeof _flowWelcomeApplyTheme === 'function') _flowWelcomeApplyTheme();
}
document.addEventListener('DOMContentLoaded', _syncThemeIcon);

/* ── HARBOUR LIGHT / CLASSIC SKIN SWITCH ─────────────────────────────
   Purely visual. Harbour is light-only (forces data-theme="light", hides
   the light/dark toggle); Classic restores the original look and the
   visitor's own saved light/dark choice. Persisted per device in
   localStorage 'flow-skin'. To drop the Harbour skin entirely remove this,
   the #skin-toggle-btn, the skin-harbour style block, the #dash-hero
   markup + _renderDashHero(), and the 'flow-skin' lines in the <head>
   script — everything else falls back to Classic by itself. ── */
function _syncSkinUI() {
  var harbour = _isPremiumSkin();
  var lbl = document.getElementById('skin-toggle-label');
  var btn = document.getElementById('skin-toggle-btn');
  var t = harbour ? 'Classic look' : 'New look';
  if (lbl) lbl.textContent = t;
  if (btn) { btn.title = 'Switch to the ' + t; btn.setAttribute('aria-label', 'Switch to the ' + t); }
  var tm = document.querySelector('meta[name="theme-color"]');
  if (tm) tm.setAttribute('content', harbour ? '#0B2545' : '#0F1E30');
}
function toggleSkin() {
  var html = document.documentElement;
  var next = _isPremiumSkin() ? 'classic' : 'harbour';
  html.setAttribute('data-skin', next);
  try { localStorage.setItem('flow-skin', next); } catch(e) {}
  if (next === 'harbour') {
    html.setAttribute('data-theme', 'light');
  } else {
    var saved = null;
    try { saved = localStorage.getItem('flow-theme'); } catch(e) {}
    html.setAttribute('data-theme', saved || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  }
  _syncThemeIcon();
  _syncSkinUI();
  try {
    if (typeof _applyChartJsTheme === 'function') _applyChartJsTheme();
    if (typeof _savedSupplies !== 'undefined' && typeof renderReportCharts === 'function') renderReportCharts(_savedSupplies);
    if (typeof refreshDashboard === 'function') refreshDashboard();
    if (typeof renderWeekCalendar === 'function') renderWeekCalendar(_calWeekOffset || 0);
  } catch(e) { /* charts/data not ready yet — safe to ignore */ }
  if (typeof _flowWelcomeApplyTheme === 'function') _flowWelcomeApplyTheme();
}
document.addEventListener('DOMContentLoaded', _syncSkinUI);

