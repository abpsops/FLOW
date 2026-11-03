/* ─── UAE LIVE CLOCK — Asia/Dubai (UTC+4), 24-hour, updates every second ─── */
(function uaeClock() {
  const DAYS  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const pad = n => String(n).padStart(2,'0');

  function tickUAE() {
    const timeEl = document.getElementById('live-clock-time');
    const dateEl = document.getElementById('live-clock-date');
    if (!timeEl && !dateEl) return;

    // Use Intl.DateTimeFormat for reliable UAE timezone handling
    const now = new Date();
    try {
      const uaeParts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Dubai',
        year:    'numeric',
        month:   '2-digit',
        day:     '2-digit',
        hour:    '2-digit',
        minute:  '2-digit',
        second:  '2-digit',
        hour12:  false,
        weekday: 'short'
      }).formatToParts(now);

      const get = type => (uaeParts.find(p => p.type === type) || {}).value || '';
      const hh  = get('hour');
      const mi  = get('minute');
      const ss  = get('second');
      const dd  = get('day');
      const mo  = parseInt(get('month'), 10) - 1; // 0-indexed
      const yr  = get('year');
      const wd  = get('weekday');

      const timeStr = (hh === '24' ? '00' : hh) + ':' + mi + ':' + ss;
      const dateStr = wd + ' ' + dd + ' ' + MONTHS[mo] + ' ' + yr + ' · UAE';

      if (timeEl) timeEl.textContent = timeStr;
      if (dateEl) dateEl.textContent = dateStr;

      // Legacy fallback — update old single-text clock if still present
      const legacyEl = document.getElementById('live-clock');
      if (legacyEl && !legacyEl.querySelector('#live-clock-time')) {
        legacyEl.textContent = dd + ' ' + MONTHS[mo] + ' ' + yr + '  ' + timeStr + ' UAE';
      }
    } catch(e) {
      // Fallback: UTC+4 manual offset
      const uae = new Date(now.getTime() + 4 * 3600000);
      const timeStr = pad(uae.getUTCHours()) + ':' + pad(uae.getUTCMinutes()) + ':' + pad(uae.getUTCSeconds());
      const dateStr = DAYS[uae.getUTCDay()].slice(0,3) + ' ' + pad(uae.getUTCDate()) + ' ' + MONTHS[uae.getUTCMonth()] + ' ' + uae.getUTCFullYear() + ' · UAE';
      if (timeEl) timeEl.textContent = timeStr;
      if (dateEl) dateEl.textContent = dateStr;
    }
  }

  tickUAE();
  setInterval(tickUAE, 1000);
})();

/* ─── CONSTANTS ─── */
let vc = 0, bc = 0;
let _barges = [];
let _lastETC = null, _closingV = 0, _closingM = 0, _lastSched = [];
// When _lastSched was generated + a signature of the inputs it was built
// from ({generatedAt, sig}) — lets Free Windows say when it's out of date.
// Synced with the schedule (atomic, like lastSched).
let _lastSchedMeta = null;
// Operator-entered barge downtime (maintenance, off-hire, crew change,
// weather): [{id, bargeId, bargeName, start, end, reason, createdBy, createdAt, updatedAt}].
// Synced per id; a deletion is a plain removal (the three-way merge treats
// "removed here, untouched there" as removed).
let _bargeBlocks = [];
let _bargeStates = {}, _bargeConfig = [];
const _nscCheckData = {}; // NSC check data store
let _checklistRecords = {}; // Persistent independent checklist records

// ── Loading tab: per-terminal loading operations, shown on the dashboard
// calendar. _loadingConfig holds a configurable rate (MT/hour) per grade,
// used to auto-estimate how long a loading operation will take.
let _loadingRecords = [];
// Bulk purchases (Loading Deals): [{id, supplier, terminal, grade, qty, date, ref, notes, status, createdAt, updatedAt, closedAt?, deletedAt?}].
// A loading record's dealId names the deal it lifts from; its blQty is the quantity on the BL.
let _loadingDeals = [];
let _loadingConfig = { rateVLSFO: 300, rateLSMGO: 150 }; // MT/hour, editable on the Loading page
const LS_LOADING_KEY = 'flow_loading_' + _FLOW_BUILD_ID;
function _loadLoadingFromLocal() {
  try {
    const raw = localStorage.getItem(LS_LOADING_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      _loadingRecords = parsed.records || [];
      _loadingDeals = parsed.deals || [];
      _loadingConfig = Object.assign({ rateVLSFO: 300, rateLSMGO: 150 }, parsed.config || {});
    }
  } catch(e) {}
}
function _saveLoadingToLocal() {
  try { localStorage.setItem(LS_LOADING_KEY, JSON.stringify({ records: _loadingRecords, deals: _loadingDeals, config: _loadingConfig })); } catch(e) {}
}
_loadLoadingFromLocal();


/* ─── Remaining Supply Tracker — row selection (tick marks) ───
   Purely a UI/export convenience: lets the user tick specific vessels
   in the Remaining Supply Tracker so a "Selected" total can be shown
   and so the downloaded image can be limited to just the ticked rows.
   Does not affect Subtotal/Planned figures anywhere — those always
   keep showing the full, exact nominated quantity as before. ─────── */
let _rstSelected = new Set();
function toggleRSTSelection(uid, checked) {
  if (!uid) return;
  if (checked) _rstSelected.add(uid); else _rstSelected.delete(uid);
  if (typeof renderRemainingSupplyTracker === 'function') renderRemainingSupplyTracker();
}
function clearRSTSelection() {
  if (!_rstSelected.size) return;
  _rstSelected.clear();
  if (typeof renderRemainingSupplyTracker === 'function') renderRemainingSupplyTracker();
}
let _checklist = {};        // Legacy checklist sync store
// Soft-deleted vessels — must be at top level. Kept in this browser's
// localStorage (not the cloud) so "Restore" still works after a reload.
const TRASH_BIN_KEY = 'abps_trash_bin_v1';
let _trashBin = (function() {
  try { const v = JSON.parse(localStorage.getItem(TRASH_BIN_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch(e) { return []; }
})();
function _saveTrashBin() {
  try { localStorage.setItem(TRASH_BIN_KEY, JSON.stringify(_trashBin || [])); } catch(e) {}
}
const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MMAP = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
const pad = n => String(n).padStart(2,'0');

/* ─── ANCHORAGE OPTIONS ─── */
const AREA_OPTIONS = [
  { value: 'FUJ-A', label: 'FUJ A — Fujairah Anchorage', short: 'FUJ A' },
  { value: 'FUJ-B', label: 'FUJ B — Fujairah Berth',     short: 'FUJ B' },
  { value: 'KFK-A', label: 'KFK A — Khor Fakkan Anchorage', short: 'KFK A' },
  { value: 'KFK-B', label: 'KFK B — Khor Fakkan Berth',   short: 'KFK B' },
];
function areaShort(val) { return AREA_OPTIONS.find(o=>o.value===val)?.short || val || '—'; }
function areaOptionsHTML(selected) {
  return AREA_OPTIONS.map(o => `<option value="${o.value}" ${selected===o.value?'selected':''}>${o.label}</option>`).join('');
}

/* ─── FORMATTERS ─── */
function fmt24(d) { if (!(d instanceof Date) || isNaN(d.getTime())) return '—'; return `${pad(d.getDate())} ${MO[d.getMonth()]} ${d.getFullYear()}  ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
// Exact-decimal MT formatter for reports/archives/exports — preserves real
// source precision (e.g. 1873.176) instead of Math.round()'ing it away, but
// doesn't pad clean whole numbers with fake .000. Used anywhere a figure is
// meant to be an auditable report value rather than a rounded UI display.
function fmtMT(n) {
  n = parseFloat(n) || 0;
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

/* ─── NOMINATED QUANTITY RANGES ───
   Nominations often come as a range ("VLSFO 500–600 MT", "abt 500/600").
   The card's quantity box takes one number or a range. The PLANNING figure
   (vessel qty/mgo, schedule item nomVQ/nomMQ — everything the scheduler,
   Availability Check, Free Windows and ROB maths read) is the TOP of the
   range, so a barge is never loaded short. The range itself (vessel
   qtyMin/qtyMax + mgoMin/mgoMax, schedule item nomVMin/nomVMax +
   nomMMin/nomMMax) is only for showing people and for the checklist's
   within-range check. A single number stores no range fields, so older
   vessels and payloads are untouched. */
function _parseQtyInput(raw) {
  // thousands commas ("1,500") and a trailing "MT" are fine to type
  const s = String(raw == null ? '' : raw).trim().replace(/(\d),(?=\d{3}(?!\d))/g, '$1').replace(/\s*m\.?t\.?$/i, '').trim();
  if (!s) return { ok: true, qty: 0, min: null, max: null };
  const N = '(\\d+(?:\\.\\d+)?)', PRE = '(?:abt\\.?|about|approx\\.?|ca\\.?|~)?\\s*';
  let m = s.match(new RegExp('^' + PRE + N + '$', 'i'));
  if (m) return { ok: true, qty: parseFloat(m[1]), min: null, max: null };
  m = s.match(new RegExp('^' + PRE + N + '\\s*(?:-|–|—|/|to)\\s*' + N + '$', 'i'));
  if (m) {
    let a = parseFloat(m[1]), b = parseFloat(m[2]);
    if (a > b) { const t = a; a = b; b = t; }
    return a === b ? { ok: true, qty: b, min: null, max: null } : { ok: true, qty: b, min: a, max: b };
  }
  return { ok: false, qty: parseFloat(s) || 0, min: null, max: null };
}
// What goes back into a card's qty box for a saved vessel.
function _qtyInputText(qty, min, max) {
  return (min != null && max != null && +min < +max) ? (+min) + '–' + (+max) : String(qty || 0);
}
function _fmtQtyRange(min, max) { return Number(min).toLocaleString() + '–' + Number(max).toLocaleString(); }
// Card qty box (g = 'vlsfo' | 'mgo') → parsed {ok, qty, min, max}.
function _cardQty(id, g) {
  const el = document.getElementById('v' + id + '-' + g);
  return _parseQtyInput(el ? el.value : '');
}
// Range fields to store on a vessel record ({} when both are single numbers).
function _cardQtyRangeFields(id) {
  const out = {}, v = _cardQty(id, 'vlsfo'), m = _cardQty(id, 'mgo');
  if (v.min != null) { out.qtyMin = v.min; out.qtyMax = v.max; }
  if (m.min != null) { out.mgoMin = m.min; out.mgoMax = m.max; }
  return out;
}
// Range of a schedule item / checklist record (g = 'V' | 'M'), or null.
function _nomRange(o, g) {
  const mn = o ? o['nom' + g + 'Min'] : null, mx = o ? o['nom' + g + 'Max'] : null;
  return (mn != null && mx != null && +mn < +mx) ? { min: +mn, max: +mx } : null;
}
// "500–600" for a ranged nomination, else the planning figure n.
function _nomQtyTxt(o, g, n) {
  const r = _nomRange(o, g);
  return r ? _fmtQtyRange(r.min, r.max) : Number(n || 0).toLocaleString();
}

/* ─── ETA TIME FRAMES (AM / PM …) ───
   Some nominations give only a part of the day for the ETA ("16 Oct AM").
   A vessel card (and a Loading) can then be ticked "Time frame only": the
   date is picked and a frame chosen from ETA_TIME_FRAMES. Stored as
   vessel.etaWin = 'AM' (Loading: record.startWin) — only when set, so older
   records are untouched. The stored ETA string stays a normal date + time:
   the date at the frame's START ("16 Oct 2026 06:00"), so parseDT() and
   every existing reader keep working. Planning treats the frame as worst
   case: the barge is ready from the frame START and stays committed until
   the frame END + the normal supply duration (schedule ETC, timeline,
   Free Windows, stock projection, Availability Check all read that ETC).
   A frame ETA is never "no firm ETA", even EAM, which starts at 00:00. */
const ETA_TIME_FRAMES = [
  { code: 'EAM',  label: 'Early AM',  from: 0,  to: 6 },
  { code: 'AM',   label: 'Morning',   from: 6,  to: 12 },
  { code: 'NOON', label: 'Noon',      from: 11, to: 13 },
  { code: 'PM',   label: 'Afternoon', from: 12, to: 18 },
  { code: 'LPM',  label: 'Late PM',   from: 18, to: 24 },
];
function _etaFrame(code) {
  const c = String(code || '').toUpperCase();
  return ETA_TIME_FRAMES.find(function(f) { return f.code === c; }) || null;
}
// Frame length in hours (0 = no frame).
function _etaFrameHrs(code) { const f = _etaFrame(code); return f ? f.to - f.from : 0; }
// "06:00–12:00"
function _etaFrameHours(code) {
  const f = _etaFrame(code);
  return f ? pad(f.from) + ':00–' + pad(f.to) + ':00' : '';
}
// "AM (06:00–12:00)"
function _etaFrameTxt(code) { const f = _etaFrame(code); return f ? f.code + ' (' + _etaFrameHours(code) + ')' : ''; }
// Date d moved to the frame's start / end hour (same calendar day; LPM ends at 24:00 = next 00:00).
function _etaFrameStart(d, code) {
  const f = _etaFrame(code);
  if (!f || !(d instanceof Date) || isNaN(d.getTime())) return d;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), f.from, 0, 0, 0);
}
function _etaFrameEnd(d, code) {
  const s = _etaFrameStart(d, code);
  return (s instanceof Date && !isNaN(s.getTime())) ? new Date(s.getTime() + _etaFrameHrs(code) * 3600000) : s;
}
// The frame that contains hour h (used when a timed ETA is switched to a frame):
// EAM / AM / PM / LPM tile the day; NOON (overlapping AM/PM) only when chosen.
function _etaFrameForHour(h) {
  const f = ETA_TIME_FRAMES.find(function(x) { return x.code !== 'NOON' && h >= x.from && h < x.to; });
  return f ? f.code : 'AM';
}
// <option>s for a frame <select>, every label with its hours
// ("AM — Morning 06:00–12:00"; compact: "AM 06:00–12:00").
function _etaFrameOptionsHTML(sel, compact) {
  return ETA_TIME_FRAMES.map(function(f) {
    return '<option value="' + f.code + '"' + (f.code === sel ? ' selected' : '') + (compact ? ' title="' + f.label + '"' : '') + '>' + f.code + (compact ? ' ' : ' — ' + f.label + ' ') + _etaFrameHours(f.code) + '</option>';
  }).join('');
}
// "16 Oct 2026 AM (06:00–12:00)" — or fmt24(d) when there is no frame.
function _fmtEtaWin(d, code) {
  if (typeof d === 'string') d = parseDT(d);
  if (!(d instanceof Date) || isNaN(d.getTime())) return '—';
  if (!_etaFrame(code)) return fmt24(d);
  return pad(d.getDate()) + ' ' + MO[d.getMonth()] + ' ' + d.getFullYear() + ' ' + _etaFrameTxt(code);
}
// "16 Oct AM" — compact, for tickets / lists.
function _fmtEtaWinShort(d, code) {
  if (typeof d === 'string') d = parseDT(d);
  if (!(d instanceof Date) || isNaN(d.getTime())) return '—';
  return d.getDate() + ' ' + MO[d.getMonth()] + ' ' + (_etaFrame(code) ? _etaFrame(code).code : pad(d.getHours()) + ':' + pad(d.getMinutes()));
}
// A schedule item's / checklist record's ETA as text.
function _itemEtaTxt(item) {
  if (!item) return '—';
  if (!item.etaWin) return fmt24(item.eta);
  return _fmtEtaWin(item.eta instanceof Date ? item.eta : (item.eta ? new Date(item.eta) : null), item.etaWin);
}
// Fields to store on a vessel record: {etaWin} only for a time-frame ETA ({} otherwise).
function _cardEtaWinFields(id) { const w = _cardEtaWin(id); return w ? { etaWin: w } : {}; }
// STS (ship-to-ship) supply: stored on the nomination only when ticked, like etaWin.
function _cardSts(id) { const el = document.getElementById('v' + id + '-sts'); return !!(el && el.checked); }
function _cardStsFields(id) { return _cardSts(id) ? { sts: true } : {}; }
// "Laycan only" (supply once the laycan opens): stored as lcOnly: true only when ticked.
function _cardLcOnly(id) { const el = document.getElementById('v' + id + '-lconly'); return !!(el && el.checked); }
function _cardLcOnlyFields(id) { return _cardLcOnly(id) ? { lcOnly: true } : {}; }
function toggleLcOnly(id) { saveSharedState(); }
// Shown next to "Before Laycan" for a nomination that still has a card (operators).
function _holdBtn(item) {
  if (!item || !item.nomUid || (typeof isTrader === 'function' && isTrader()) || item.lcOnly) return '';
  return '<button type="button" class="lc-hold-btn" onclick="holdToLaycan(' + JSON.stringify(String(item.nomUid)).replace(/"/g, '&quot;') + ')" title="Supply this vessel only once its laycan opens, and plan again">Supply in laycan</button>';
}
// The "Supply in laycan" button on a schedule row planned before its laycan:
// ticks Laycan only on that nomination's card and plans again.
function holdToLaycan(nomUid) {
  const card = Array.from(document.querySelectorAll('.vcard[id^="vessel-"]')).find(c => c.dataset.nomUid === nomUid);
  if (!card) { showToast('That nomination has no card any more — plan again first.', 'warning'); return; }
  const id = card.id.replace('vessel-', ''), box = document.getElementById('v' + id + '-lconly');
  if (!box) return;
  box.checked = true;
  toggleLcOnly(id); // saved like a tick on the card, whatever the plan below does
  const name = ((document.getElementById('v' + id + '-name') || {}).value || 'Vessel').trim();
  const before = _lastSched;
  calculate();
  if (_lastSched !== before) showToast(name + ' is now supplied within its laycan only — schedule planned again.', 'success');
  else showToast('Laycan only is ticked and saved for ' + name + ' — the schedule could not be planned again (see the message); Generate once the cards are complete.', 'warning', 7000);
}
// The tick on a nomination card: the NOMINATION is the one source of truth. Nothing
// planned is edited (the schedule and checklist records are derived data that merge
// as a whole between devices — touching them from a tick would clash with a colleague's
// Generate). The screens ask the nomination at render time (_stsLookup / _stsOf) and
// this just repaints what is already on screen IN PLACE (never redrawn — a redraw would
// wipe what someone is typing into the checklist, or the print ticks). It does not
// affect planning, so nothing needs regenerating. Then save.
function toggleSts(id) {
  const card = document.getElementById('vessel-' + id); if (!card) return;
  const on = _cardSts(id);
  if (on) card.setAttribute('data-sts', '1'); else card.removeAttribute('data-sts');
  const uid = card.dataset.nomUid || '';
  if (uid) _repaintSts(uid);
  saveSharedState();
}
// Which nominations are STS right now, read from the cards. `all` = the nominations that
// have a card; for one without a card (already supplied, or removed) the flag stamped on
// the schedule item / record when it was planned or saved is used instead.
function _stsLookup() {
  const on = new Set(), all = new Set();
  document.querySelectorAll('.vcard[id^="vessel-"]').forEach(function(c) {
    const u = c.dataset.nomUid; if (!u) return;
    all.add(u);
    const box = document.getElementById('v' + c.id.replace('vessel-', '') + '-sts');
    if (box && box.checked) on.add(u);
  });
  return { on: on, all: all };
}
function _stsOf(look, o) { return !!(o && (o.nomUid && look.all.has(o.nomUid) ? look.on.has(o.nomUid) : o.sts)); }
// Elements for a live nomination (calendar pill, voyage row, timeline card, open
// checklist row) carry data-nu="<nomUid>" and an empty data-sts-slot for the tag.
// _repaintSts(uid) repaints that nomination; with no uid, every one that has a card.
function _repaintSts(nomUid) {
  const look = _stsLookup();
  document.querySelectorAll('[data-nu]').forEach(function(el) {
    const u = el.getAttribute('data-nu');
    if ((nomUid && u !== nomUid) || !look.all.has(u)) return;
    const on = look.on.has(u);
    el.classList.toggle('is-sts', on);
    const slot = el.querySelector('[data-sts-slot]');
    if (slot) slot.innerHTML = on ? _stsTag({ sts: true }) : '';
  });
}
function _stsTag(o) { return o && o.sts ? '<span class="sts-tag" title="Ship-to-ship supply">STS</span>' : ''; }
function _stsTagDark() { return '<span style="display:inline-block;font-size:9px;font-weight:800;letter-spacing:.08em;padding:0 6px;margin-left:6px;border-radius:4px;background:#86D860;color:#0B1A06;vertical-align:middle">STS</span>'; }
// Latest arrival of a schedule item: frame END for a time-frame ETA, else the ETA.
function _itemEtaEnd(item) {
  if (!item || !item.eta) return item ? item.eta : null;
  const d = item.eta instanceof Date ? item.eta : new Date(item.eta);
  return item.etaWin && _etaFrame(item.etaWin) ? new Date(d.getTime() + _etaFrameHrs(item.etaWin) * 3600000) : item.eta;
}
// Small "AM 06:00–12:00" tag (codes come from ETA_TIME_FRAMES only — safe as markup).
function _etaFrameTag(code, cls) {
  const f = _etaFrame(code);
  return f ? '<span class="tf-tag' + (cls ? ' ' + cls : '') + '" title="ETA time frame — ' + f.label + ' ' + _etaFrameHours(f.code) + '">' + f.code + ' ' + _etaFrameHours(f.code) + '</span>' : '';
}
// A Loading's start as text: "16 Oct 2026 AM (06:00–12:00)" for a time-frame start.
function _ldStartTxt(r) {
  const d = new Date(r && r.startAt);
  return (r && r.startWin && _etaFrame(r.startWin)) ? _fmtEtaWin(d, r.startWin) : fmt24(d);
}
// Card → frame code ('' = exact time).
function _cardEtaWin(id) {
  const chk = document.getElementById('v' + id + '-etawin-chk'), sel = document.getElementById('v' + id + '-etawin');
  return (chk && chk.checked && sel && _etaFrame(sel.value)) ? sel.value : '';
}
// Card's ETA as people read it ("16 Oct 2026 AM (06:00–12:00)" or the typed value).
function _cardEtaTxt(id) {
  const raw = document.getElementById('v' + id + '-eta')?.value || '';
  const win = _cardEtaWin(id);
  return (win && parseDT(raw)) ? _fmtEtaWin(parseDT(raw), win) : raw;
}
// A saved vessel / def's ETA as text (v.eta string + optional v.etaWin).
function _vesselEtaTxt(v) {
  if (!v || !v.eta) return '';
  return (v.etaWin && _etaFrame(v.etaWin) && parseDT(v.eta)) ? _fmtEtaWin(parseDT(v.eta), v.etaWin) : String(v.eta);
}
// ETA picker value "16 Oct 2026 06:00" for date d at the frame start.
function _etaPickerStr(d) { return pad(d.getDate()) + ' ' + MO[d.getMonth()] + ' ' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
// Card: the "Time frame only" box was ticked / unticked.
function toggleEtaWin(id) {
  const chk = document.getElementById('v' + id + '-etawin-chk'), sel = document.getElementById('v' + id + '-etawin');
  const inp = document.getElementById('v' + id + '-eta');
  if (!chk || !sel || !inp) return;
  const on = chk.checked;
  sel.hidden = !on;
  const d = parseDT(inp.value);
  if (on) {
    if (d) { sel.value = _etaFrameForHour(d.getHours()); inp.value = _etaPickerStr(_etaFrameStart(d, sel.value)); }
    else if (!_etaFrame(sel.value)) sel.value = 'AM';
  }
  inp.placeholder = on ? 'Select date…' : 'Select date & time…';
  // The picker is rebuilt in the right mode (date only / date & time) next time it opens.
  if (_etaPickers[id]) { try { _etaPickers[id].destroy(); } catch (e) {} delete _etaPickers[id]; }
  inp.setAttribute('readonly', 'readonly'); // flatpickr.destroy() removes it
  upd(id);
}
// Card: another frame was chosen → ETA moves to that frame's start.
function etaWinChanged(id) {
  const sel = document.getElementById('v' + id + '-etawin'), inp = document.getElementById('v' + id + '-eta');
  if (!sel || !inp) return;
  const d = parseDT(inp.value);
  if (d) inp.value = _etaPickerStr(_etaFrameStart(d, sel.value));
  upd(id);
}

