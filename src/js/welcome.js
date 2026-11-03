// ── FLOW welcome screen: paper boats on open water ──────────────────
// Palette follows the app's own light/dark theme (html[data-theme]),
// so this screen always matches whatever theme the operator is in.
// Boats get accent colors cycled by DOM order (40 boats, 25 colors),
// echoing the range of accent colors used across the app's own page
// headers/highlights — several of the extra hues below are pulled
// straight from the --pg-* page-accent tokens (alerts/dashboard/
// checklist/deliverylog/records/trash) so new boats stay on-brand
// instead of being arbitrary extra hues.
var FLOW_WELCOME_THEMES = {
  dark: {
    bg: '#0A1420', wordmark: 'rgba(214,224,234,.92)', rule: 'rgba(214,224,234,.14)',
    wave: 'rgba(214,224,234,.22)',
    boatColors: ['#5FC7E0', '#E0A542', '#8FA6D8', '#E08464', '#6FC49A', '#B893E0',
                 '#E86F63', '#4FD1C4', '#E087B0', '#D4C15F', '#9FB4CC', '#C97A52', '#C879D1',
                 '#7FB3E8', '#E8C26A', '#5FB8A8', '#E89A8C', '#A3C46F', '#9C8FE0',
                 '#E07A98', '#6FA8C4', '#D9A05C', '#8CCFB0', '#C48FC9', '#B8B060'],
    btnBorder: 'rgba(0,180,216,.45)', btnBg: 'rgba(0,180,216,.12)', btnText: '#5FC7E0',
    footer: 'rgba(214,224,234,.32)'
  },
  light: {
    bg: '#F7F4EE', wordmark: 'rgba(30,38,46,.9)', rule: 'rgba(30,38,46,.12)',
    wave: 'rgba(30,42,51,.2)',
    boatColors: ['#2C6E8E', '#B5822A', '#4A5D8E', '#B5573A', '#2F7A54', '#7A5AA8',
                 '#A23347', '#0F6B5C', '#C15B8C', '#8A7A1F', '#435872', '#8B4230', '#7A3A87',
                 '#3D7FB8', '#A8761C', '#1F7F72', '#B0614F', '#5E7F2A', '#5C4FA0',
                 '#A94A6E', '#2E6A86', '#9C5F1E', '#3E8A66', '#8E4F94', '#6E6A1A'],
    btnBorder: 'rgba(20,90,120,.4)', btnBg: 'rgba(20,90,120,.08)', btnText: '#1E5A78',
    footer: 'rgba(30,38,46,.38)'
  }
};

function _flowWelcomeApplyTheme() {
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  var t = isDark ? FLOW_WELCOME_THEMES.dark : FLOW_WELCOME_THEMES.light;
  var el = document.getElementById('flow-welcome-overlay');
  if (!el) return;
  el.style.background = t.bg;
  var wm = document.getElementById('flow-welcome-wordmark');
  if (wm) wm.style.color = t.wordmark;
  var logoImg = document.getElementById('flow-welcome-logo-img');
  if (logoImg) logoImg.style.filter = isDark ? 'none' : 'invert(1)';
  var rule = document.getElementById('flow-welcome-rule');
  if (rule) rule.style.background = t.rule;
  document.querySelectorAll('.flow-wave-line').forEach(function(p) { p.setAttribute('stroke', t.wave); });
  document.querySelectorAll('.flow-boat').forEach(function(boat, i) {
    var color = t.boatColors[i % t.boatColors.length];
    var hull = boat.querySelector('.boat-hull');
    var sail = boat.querySelector('.boat-sail');
    if (hull) { hull.setAttribute('fill', color); hull.style.opacity = 0.95; }
    if (sail) { sail.setAttribute('fill', color); sail.style.opacity = 0.65; }
  });
  var btn = document.getElementById('flow-welcome-btn');
  if (btn) {
    btn.style.border = '1px solid ' + t.btnBorder;
    btn.style.background = t.btnBg;
    btn.style.color = t.btnText;
    btn.onmouseover = function() { btn.style.transform = 'translateY(-2px)'; };
    btn.onmouseout = function() { btn.style.transform = 'translateY(0)'; };
  }
  var footer = document.getElementById('flow-welcome-footer');
  if (footer) footer.style.color = t.footer;
}

function showFlowWelcomeRadar() {
  var el = document.getElementById('flow-welcome-overlay');
  if (!el) return;
  el.style.display = 'flex';
  _flowWelcomeApplyTheme();
}

// Navigates to the chosen page (if any) and dismisses the welcome overlay.
function flowWelcomeGo(pageId) {
  var el = document.getElementById('flow-welcome-overlay');
  if (el) el.style.display = 'none';
  if (pageId && pageId !== 'dashboard' && typeof showPage === 'function') showPage(pageId);
}
