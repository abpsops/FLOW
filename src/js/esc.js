/* esc(): the ONE HTML-escape helper for the whole app. Every value that came
   from user input, a file import, or the shared cloud workspace (vessel names,
   remarks, agents, barge names, notes…) MUST go through esc() before it is put
   into innerHTML or a template string — including attribute values, which is
   why quotes are escaped too. Without it, a vessel name like
   <img src=x onerror=…> runs as code in every operator's browser. */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
/* escJs(): for a value placed inside a single-quoted JS string literal that is
   itself inside a double-quoted HTML attribute, e.g. onclick="fn('${escJs(x)}')". */
function escJs(s) {
  return esc(String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n'));
}
/* Has THIS nomination (a schedule item / vessel card) already been supplied?
   Matches on the nomination's permanent nomUid, which checklist records and
   saved supplies carry. Matching on vessel name alone (the old behaviour)
   made a vessel that was supplied once vanish from the timeline, calendar,
   checklist and barge-availability checks when it was nominated again.
   Records saved before nomUid was stamped on them fall back to vessel name
   plus a supply date within 3 days of this item's start. */
function _recordMatchesScheduleItem(r, item) {
  if (!r || !item) return false;
  if (r.nomUid && item.nomUid) return r.nomUid === item.nomUid;
  var norm = function(s) { return String(s || '').trim().toLowerCase(); };
  if (norm(r.vessel) !== norm(item.name)) return false;
  var a = r.supplyDate ? new Date(r.supplyDate).getTime() : NaN;
  var start = item.bargeStart || item.eta;
  var b = start ? new Date(start).getTime() : NaN;
  if (isNaN(a) || isNaN(b)) return true; // can't tell — keep the legacy name match
  return Math.abs(a - b) < 3 * 86400000;
}
function _isScheduleItemCompleted(item) {
  var supplies = (typeof _savedSupplies !== 'undefined' && _savedSupplies) || [];
  for (var i = 0; i < supplies.length; i++) {
    if (supplies[i] && supplies[i].supplied && _recordMatchesScheduleItem(supplies[i], item)) return true;
  }
  // A checklist row counts only once it is saved (locked / completed). An
  // unsaved row marked supplied (the old 'Completed' tick, still sent by older
  // builds) took the vessel out of barge planning and alerts with nothing
  // logged. (An open row of a delivery that IS saved is caught above.)
  var cl = (typeof _checklistRecords !== 'undefined' && _checklistRecords) || {};
  for (var k in cl) {
    var r = cl[k];
    if (r && (r.lockedAt || r.state === 'completed') && _recordMatchesScheduleItem(r, item)) return true;
  }
  // Archived (month moved to an archive): still supplied — never offered as Pending again.
  if (typeof _liveArchiveEntries === 'function') {
    var ents = _liveArchiveEntries();
    for (var e = 0; e < ents.length; e++) {
      var recs = (ents[e].arch && ents[e].arch.records) || [];
      for (var j = 0; j < recs.length; j++) {
        var ar = recs[j];
        if (!ar || ar.supplied === false) continue;
        if (ar.nomUid && item.nomUid) { if (ar.nomUid === item.nomUid) return true; continue; }
        // without a nomUid only a dated match counts (an undated old row must not hide a new call)
        var at = ar.supplyDate ? new Date(ar.supplyDate).getTime() : NaN, st = (item.bargeStart || item.eta) ? new Date(item.bargeStart || item.eta).getTime() : NaN;
        if (!isNaN(at) && !isNaN(st) && String(ar.vessel || '').trim().toLowerCase() === String(item.name || '').trim().toLowerCase() && Math.abs(at - st) < 3 * 86400000) return true;
      }
    }
  }
  return false;
}
/* Chart.js renders to <canvas>, so it can't read our CSS variables directly —
   give it colors that hold legible contrast on both a white and a near-black
   canvas, and re-apply whenever the theme toggle flips. Individual charts
   still override these per-dataset colors (fuel-v/fuel-m/etc.) as before. */
/* Harbour Light skin helpers: _isPremiumSkin() (name kept from the earlier
   skin; true while the Harbour skin is active), _skinPal(c), which maps the
   classic chart colours to the Harbour palette (ocean blue + teal), and
   _skinFont(f) for chart tick fonts — only while Harbour is active; Classic
   gets its exact colours and fonts back. */
function _isPremiumSkin() { return document.documentElement.getAttribute('data-skin') === 'harbour'; }
function _skinPal(c) {
  if (!_isPremiumSkin() || typeof c !== 'string') return c;
  return c.replace(/^rgba\((47,111,237|37,99,235|14,122,155),/, 'rgba(21,101,192,')
          .replace(/^rgba\((255,122,26|249,115,22),/, 'rgba(14,159,142,');
}
function _skinFont(f) {
  if (!_isPremiumSkin()) return f;
  return f === 'DM Mono' ? 'IBM Plex Mono' : f === 'DM Sans' ? 'Plus Jakarta Sans' : f;
}
function _applyChartJsTheme() {
  if (typeof Chart === 'undefined') return;
  var dark = document.documentElement.getAttribute('data-theme') === 'dark';
  var harbour = _isPremiumSkin();
  var textColor = harbour ? '#5B6E86' : (dark ? '#C8D6E8' : '#47617D');
  Chart.defaults.color = textColor;
  Chart.defaults.borderColor = harbour ? '#E6ECF3' : (dark ? 'rgba(255,255,255,.09)' : 'rgba(19,38,62,.08)');
  Chart.defaults.font.family = harbour ? "'Plus Jakarta Sans', 'Inter', sans-serif" : "'DM Sans', sans-serif";
  // Chart.defaults.color alone doesn't reliably reach the legend plugin's own
  // nested default in every Chart.js code path — set it explicitly too so
  // legends never silently fall back to Chart.js's built-in near-black '#666'.
  if (Chart.defaults.plugins && Chart.defaults.plugins.legend && Chart.defaults.plugins.legend.labels) {
    Chart.defaults.plugins.legend.labels.color = textColor;
  }
}
_applyChartJsTheme();
// Chart.js is a `defer` script, so it isn't loaded yet on the call above;
// deferred scripts have all run by DOMContentLoaded — apply the theme then.
document.addEventListener('DOMContentLoaded', _applyChartJsTheme);
/* Keyboard access for clickable non-button elements (sidebar links, KPI
   chips…) marked role="button" tabindex="0": Enter/Space trigger their
   onclick, like a real <button>. One delegated listener covers them all. */
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  var el = e.target;
  if (!el || !el.getAttribute || el.getAttribute('role') !== 'button') return;
  if (/^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
  e.preventDefault();
  el.click();
});
/* Explicit per-chart text color, for legends/ticks that set their own
   `color` in options — belt-and-suspenders alongside Chart.defaults.color
   above, since some Chart.js legend configs don't reliably fall back to
   the global default. */
function _chartTextColor() {
  if (_isPremiumSkin()) return '#5B6E86';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? '#C8D6E8' : '#47617D';
}
