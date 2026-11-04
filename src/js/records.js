/* ─── SAVED RECORDS ─── */
let _savedSupplies = [];

/* ─── DELIVERY LOG ───────────────────────────────────────────────────
   {monthKey: {timely:[...], delayed:[...], disputes:[...]}} — monthKey
   is 'YYYY-MM'. Timely/Delayed are marked automatically (from the same
   laycan-vs-ETA logic already used everywhere else in the app). Disputes
   are captured automatically from the Checklist Remarks field whenever a
   supply is saved with non-empty remarks — the operator never fills this
   in separately. Persists through the normal state save/load path (cloud
   + local), and is only ever cleared by Clear All Data or Wipe Cloud —
   never by Full Reset or Clear Checklist. */
let _deliveryLog = {};

function _dlMonthKey(dateInput) {
  const d = dateInput ? new Date(dateInput) : new Date();
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0,7);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
}
function _dlMonthLabel(key) {
  const [y,m] = key.split('-').map(Number);
  const d = new Date(y, m-1, 1);
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}
function _dlEnsureMonth(key) {
  if (!_deliveryLog[key]) _deliveryLog[key] = { timely: [], delayed: [], disputes: [] };
  ['timely', 'delayed', 'disputes'].forEach(function(b) { if (!Array.isArray(_deliveryLog[key][b])) _deliveryLog[key][b] = []; });
  return _deliveryLog[key];
}
/* Delivery Log deletion tombstones. Removing an entry splices it out of its
   bucket AND records month.removed[checklistUid] = {deletedAt, updatedAt},
   so the additive cloud merge (_mergeDeliveryLog) can tell "deleted on
   another device" from "not seen here yet" and doesn't resurrect it. An
   entry and a tombstone for the same checklistUid: the newer one wins (a
   later re-log beats an earlier deletion). Tombstones live beside the
   buckets, not in them, so every reader of timely/delayed/disputes — and
   older app versions — never sees a deleted entry; _dlLive() additionally
   skips any entry flagged deleted:true. */
function _dlLive(arr) {
  return (Array.isArray(arr) ? arr : []).filter(function(e) { return e && !e.deleted; });
}
function _dlStamp(e) {
  if (!e) return 0;
  const u = Number(e.updatedAt);
  if (u) return u;
  const t = Date.parse(e.deletedAt || e.loggedAt);
  return isNaN(t) ? 0 : t;
}
function _dlSameEntry(a, b) {
  if (!a || !b) return false;
  if (a.checklistUid || b.checklistUid) return !!a.checklistUid && a.checklistUid === b.checklistUid;
  if (a.id || b.id) return !!a.id && a.id === b.id;
  return _sameJSON(a, b); // legacy entry with neither key
}
// Is this entry superseded by a (newer or equal) deletion in `month`?
function _dlIsRemoved(month, e) {
  const t = e && e.checklistUid && month && month.removed && month.removed[e.checklistUid];
  return !!t && _dlStamp(t) >= _dlStamp(e);
}
function _dlTombstone(month, uid, now) {
  if (!month.removed || typeof month.removed !== 'object') month.removed = {};
  month.removed[uid] = { deletedAt: new Date(now).toISOString(), updatedAt: now };
}
// Clear All Data: every entry dropped and tombstoned.
function _dlTombstonesFor(log) {
  const now = Date.now(), out = {};
  Object.keys(log || {}).forEach(function(key) {
    const month = log[key] || {};
    const m = { timely: [], delayed: [], disputes: [] };
    if (month.removed && typeof month.removed === 'object') m.removed = Object.assign({}, month.removed);
    ['timely', 'delayed', 'disputes'].forEach(function(b) {
      (Array.isArray(month[b]) ? month[b] : []).forEach(function(e) { if (e && e.checklistUid) _dlTombstone(m, e.checklistUid, now); });
    });
    out[key] = m;
  });
  return out;
}

/* ─── Counterparty Track Record Intelligence ─────────────────────────
   A layer over the Delivery Log FLOW builds automatically on every saved
   supply — no extra data entry. A supply is FLAGGED when the vessel came
   outside its laycan (after it closed = late, or before it opened = early,
   held to the laycan included), was unready on arrival, made an
   inconsistent claim or was marked ⚠ Dispute.
   • The whole history counts (the Delivery Log starts July 2026) and a
     single flagged supply is enough — no minimum number of supplies.
   • The Dashboard watchlist shows the last TR_WATCH_MONTHS months only
     (older flags drop off by themselves), plus any flagged vessel that is
     nominated again, whenever its flags were.
   • The history itself is never cleared: a vessel with an out-of-laycan
     supply at any time is flagged again on its new nomination card, in the
     alerts bell and when the schedule is generated.
   Early arrivals are recorded from Nov 2026 on (isEarly on the entry);
   older supplies only know late vs within. */
const TR_WATCH_MONTHS = 2;

// One key per vessel however its name was typed: case, spaces, punctuation
// and a ship-type prefix (MV, M/V, M.V., MT, M/T, M.T.) are ignored
// ("MT DAISY" = "Daisy", "M.V.STAR NINA" = "Star Nina", "SEA-VALIANT" =
// "SEA VALIANT", "ST. JOHN'S" = "ST JOHNS"). A nomination's IMO also matches.
function _trVesselKey(name) {
  return String(name || '').toLowerCase().replace(/[\s\u00a0]+/g, ' ').trim()
    .replace(/^m\s*[.\/]?\s*[vt]\b\.?\s*/, '').replace(/[^a-z0-9]+/g, '');
}
function _trEntryTime(e) {
  const t = new Date(e && (e.supplyDate || e.loggedAt) || '').getTime();
  return isNaN(t) ? 0 : t;
}
// Start of the watchlist window: the same day TR_WATCH_MONTHS months ago, 00:00.
function _trWatchFrom(now) {
  const d = new Date(now == null ? Date.now() : now);
  const from = new Date(d.getFullYear(), d.getMonth() - TR_WATCH_MONTHS, d.getDate());
  if (from.getDate() !== d.getDate()) from.setDate(0); // 31 Dec → 31 Oct, not 1 Nov
  return from;
}

/* The Delivery Log indexed by vessel — built once and reused until the end
   of the current task (a render pass, a bell refresh), so many cards and the
   watchlist cost one scan of the log, not one each. */
let _trIndexCache = null;
function _trIndex() {
  if (_trIndexCache) return _trIndexCache;
  const byKey = new Map(), byImo = new Map();
  const add = function(map, k, d) { if (!k) return; if (!map.has(k)) map.set(k, []); map.get(k).push(d); };
  Object.keys(_deliveryLog || {}).sort().forEach(function(monthKey) {
    const month = _deliveryLog[monthKey] || {};
    const disputeByUid = {}, disputesNoUid = [];
    _dlLive(month.disputes).forEach(function(e) {
      if (!_trVesselKey(e.vessel) || !_dlIsDispute(e)) return;
      if (e.checklistUid) disputeByUid[e.checklistUid] = e; else disputesNoUid.push(e);
    });
    [['timely', false], ['delayed', true]].forEach(function(b) {
      _dlLive(month[b[0]]).forEach(function(e) {
        const key = _trVesselKey(e.vessel);
        if (!key) return;
        const late = b[1], early = !late && !!e.isEarly;
        const dispute = (e.checklistUid && disputeByUid[e.checklistUid]) || null;
        if (dispute) delete disputeByUid[e.checklistUid];
        const d = { entry: e, key: key, late: late, early: early, dispute: dispute,
          flagged: late || early || !!e.flagUnready || !!e.flagInconsistentDispute || !!dispute };
        add(byKey, key, d);
        add(byImo, String(e.imo || '').trim(), d);
      });
    });
    // A dispute whose supply is not in the log any more still counts.
    Object.keys(disputeByUid).map(function(k) { return disputeByUid[k]; }).concat(disputesNoUid).forEach(function(e) {
      const key = _trVesselKey(e.vessel);
      const d = { entry: e, key: key, late: false, early: false, dispute: e, flagged: true, orphanDispute: true };
      add(byKey, key, d);
      add(byImo, String(e.imo || '').trim(), d);
    });
  });
  _trIndexCache = { byKey: byKey, byImo: byImo };
  Promise.resolve().then(function() { _trIndexCache = null; });
  return _trIndexCache;
}

/* Everything the Delivery Log says about one vessel (all months), newest
   first — by name, and by IMO when one is given. null when it has never
   been supplied. Each delivery: entry, key, late, early, dispute (the
   ⚠ Dispute entry or null), flagged. */
function computeVesselTrackRecord(vesselName, imo) {
  const name = _trVesselKey(vesselName);
  const im = String(imo || '').trim();
  if (!name && !im) return null;
  const idx = _trIndex(), seen = new Set(), deliveries = [];
  (idx.byKey.get(name) || []).concat(im ? (idx.byImo.get(im) || []) : []).forEach(function(d) {
    if (!seen.has(d)) { seen.add(d); deliveries.push(d); }
  });
  if (!deliveries.length) return null;
  deliveries.sort(function(a, b) { return _trEntryTime(b.entry) - _trEntryTime(a.entry); });
  const sup = deliveries.filter(function(d) { return !d.orphanDispute; });
  const count = function(f) { return deliveries.filter(f).length; };
  const laycan = sup.filter(function(d) { return d.late || d.early; });
  return {
    total: sup.length,
    late: count(function(d) { return d.late; }),
    early: count(function(d) { return d.early; }),
    within: sup.filter(function(d) { return !d.late && !d.early; }).length,
    unready: count(function(d) { return !!d.entry.flagUnready && !d.orphanDispute; }),
    inconsistentDispute: count(function(d) { return !!d.entry.flagInconsistentDispute && !d.orphanDispute; }),
    disputes: deliveries.filter(function(d) { return d.dispute; }).map(function(d) { return d.dispute; }),
    flagged: count(function(d) { return d.flagged; }),
    lastLaycanFlag: laycan.length ? laycan[0] : null,
    deliveries: deliveries,
    // kept for older callers: "delayed" = late
    get delayed() { return this.late; }, get timely() { return this.total - this.late; }
  };
}
// "after laycan 2× · before laycan 1×" — the out-of-laycan part of a record ('' when none).
function _trLaycanSummary(tr) {
  if (!tr) return '';
  return [tr.late ? 'after laycan ' + tr.late + '×' : '', tr.early ? 'before laycan ' + tr.early + '×' : ''].filter(Boolean).join(' · ');
}
function _trDay(e) {
  const t = _trEntryTime(e);
  return t ? new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : (e && e.dateStr) || '—';
}

// The banner under a vessel name (nomination card, Availability Check): shown
// as soon as the vessel has one flagged supply in its whole history; a clean
// record is shown once it has 2+ supplies.
function renderVesselTrackRecordBanner(nameInputId, bannerElId) {
  const nameEl = document.getElementById(nameInputId);
  const bannerEl = document.getElementById(bannerElId);
  if (!nameEl || !bannerEl) return;
  const imoEl = /^v\d+-name$/.test(nameInputId) ? document.getElementById(nameInputId.replace(/-name$/, '-imo')) : null;
  const tr = computeVesselTrackRecord(nameEl.value, imoEl ? imoEl.value : '');
  if (!tr || (!tr.flagged && tr.total < 2)) { bannerEl.innerHTML = ''; return; }
  const rows = [];
  if (tr.late || tr.early) {
    const parts = [];
    if (tr.late) parts.push('<strong>after</strong> its laycan <strong>' + tr.late + '×</strong>');
    if (tr.early) parts.push('<strong>before</strong> its laycan <strong>' + tr.early + '×</strong>');
    rows.push('⚠ Came ' + parts.join(' and ') + ' in ' + tr.total + ' suppl' + (tr.total > 1 ? 'ies' : 'y') + ' — last ' + esc(_trDay(tr.lastLaycanFlag.entry)) + '.');
  } else if (tr.total === 1) {
    rows.push('Within laycan on its only supply.');
  } else if (tr.total > 1) {
    rows.push('Within laycan on all <strong>' + tr.total + '</strong> supplies.');
  }
  if (tr.disputes.length) rows.push('<strong>' + tr.disputes.length + '</strong> dispute' + (tr.disputes.length > 1 ? 's' : '') + ' recorded — see Delivery Log.');
  const redRows = [];
  if (tr.unready > 0) redRows.push('⚠ Unready on arrival <strong>' + tr.unready + '</strong> time' + (tr.unready > 1 ? 's' : '') + ' — agreed to bunker on arrival, then wasn\'t ready.');
  if (tr.inconsistentDispute > 0) redRows.push('⚠ Inconsistent dispute claims in <strong>' + tr.inconsistentDispute + '</strong> ' + (tr.inconsistentDispute > 1 ? 'supplies' : 'supply') + ' — quantity claim changed after the fact.');
  const critical = redRows.length > 0, severe = tr.flagged > 0;
  const bg = critical ? 'var(--red-lt)' : severe ? 'var(--amber-lt)' : 'var(--green-lt)';
  const border = critical ? 'var(--red-bd)' : severe ? 'var(--amber-bd)' : 'var(--green-bd)';
  const color = critical ? 'var(--red)' : severe ? 'var(--amber)' : 'var(--green)';
  bannerEl.innerHTML = '<div class="tr-banner" style="margin-top:8px;padding:8px 12px;background:' + bg + ';border:1px solid ' + border + ';border-radius:8px;font-size:11.5px;color:' + color + ';line-height:1.5">' +
    '<div style="font-weight:700;margin-bottom:2px">Track Record — ' + esc((nameEl.value || '').trim()) + '</div>' +
    redRows.concat(rows).join('<br>') +
  '</div>';
}

/* Open nominations (cards not yet supplied, however overdue) of a vessel
   with an out-of-laycan supply at any time — one per nomination. They feed
   the alerts bell, the Generate Schedule warning and the watchlist's
   "Nominated again" marker. */
function _trRenominated(now) {
  now = now == null ? Date.now() : now;
  const out = [];
  document.querySelectorAll('#vc .vcard[id^="vessel-"]').forEach(function(card) {
    const cid = card.id.replace('vessel-', '');
    const g = function(f) { const el = document.getElementById('v' + cid + '-' + f); return el ? String(el.value || '') : ''; };
    const name = g('name').trim().replace(/\s+/g, ' ');
    if (!name) return;
    const tr = computeVesselTrackRecord(name, g('imo').trim());
    if (!tr || !(tr.late || tr.early)) return;
    const nomUid = card.dataset.nomUid || '';
    const eta = g('eta') ? parseDT(g('eta')) : null;
    // Every open nomination counts, however overdue — only a supplied one is skipped.
    try { if (typeof _isScheduleItemCompleted === 'function' && _isScheduleItemCompleted({ nomUid: nomUid || null, name: name, eta: eta })) return; } catch (e) {}
    out.push({ cid: cid, nomUid: nomUid, name: name, key: tr.deliveries[0].key || _trVesselKey(name), tr: tr,
      eta: eta instanceof Date && !isNaN(eta.getTime()) ? eta : null, lcText: g('lc').trim() });
  });
  return out;
}
function _trAlerts() {
  return _trRenominated().map(function(x) {
    return { key: 'tr|' + (x.nomUid || x.name.toUpperCase()), label: 'Nominated again — came outside laycan before',
      sub: x.name + ' — ' + _trLaycanSummary(x.tr) + ' (last ' + _trDay(x.tr.lastLaycanFlag.entry) + ')', severity: 'warning', kind: 'tr', cid: x.cid };
  });
}
// Every nomination card's banner, again — after the Delivery Log arrives or
// changes (a pull, a merge, a saved supply): cards are drawn before it.
function _trRefreshCardBanners() {
  document.querySelectorAll('#vc .vcard[id^="vessel-"]').forEach(function(card) {
    const cid = card.id.replace('vessel-', '');
    if (document.getElementById('v' + cid + '-track-record')) renderVesselTrackRecordBanner('v' + cid + '-name', 'v' + cid + '-track-record');
  });
}
// Bell → the nomination card.
function _trGoTo(cid) {
  showPage('nominations');
  setTimeout(function() {
    const card = document.getElementById('vessel-' + cid);
    if (!card) return;
    if (typeof _globalSearchHighlight === 'function') _globalSearchHighlight(card);
    const b = document.getElementById('v' + cid + '-track-record');
    if (b && b.scrollIntoView) b.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 80);
}
// The bell follows vessel names typed / imported (after its first pass at login).
let _trAlertTimer = null, _trAlertSig = null;
function _trSyncAlertsSoon() {
  clearTimeout(_trAlertTimer);
  _trAlertTimer = setTimeout(function() {
    _trAlertTimer = null;
    let sig = '';
    try { sig = _trRenominated().map(function(x) { return x.cid + ':' + x.key; }).join('|'); } catch (e) { return; }
    if (sig === _trAlertSig) return;
    _trAlertSig = sig;
    if (typeof _globalAlertsPrevKeys !== 'undefined' && _globalAlertsPrevKeys && typeof _refreshGlobalAlertsBell === 'function') {
      try { _refreshGlobalAlertsBell(); } catch (e) {}
    }
    if (_currentPage === 'dashboard') { try { renderTrackRecordWatchlist(); } catch (e) {} }
  }, 600);
}
// After a pull / merge / first load: banners, bell and watchlist follow the Delivery Log.
function _trAfterApply() {
  _trIndexCache = null; // a pulled / merged Delivery Log
  try { _trRefreshCardBanners(); } catch (e) {}
  _trSyncAlertsSoon();
}
// Generate Schedule: ONE summary warning (never blocks).
function _trWarnSchedule() {
  const list = _trRenominated();
  if (!list.length || typeof showToast !== 'function') return 0;
  const names = list.slice(0, 3).map(function(x) { return x.name + ' (' + _trLaycanSummary(x.tr) + ')'; }).join(', ') + (list.length > 3 ? ' +' + (list.length - 3) + ' more' : '');
  showToast('Track record: ' + list.length + (list.length === 1 ? ' nomination is a vessel that' : ' nominations are vessels that') + ' came outside laycan before — ' + names + '. Planned as usual.', 'warning', 9000);
  return list.length;
}

// The Dashboard watchlist: vessels with a flagged supply in the last
// TR_WATCH_MONTHS months (rolling — older flags drop off by themselves; the
// history stays), plus any vessel with an out-of-laycan past that is
// nominated again, shown first.
function renderTrackRecordWatchlist() {
  const el = document.getElementById('dash-track-record-watchlist');
  if (!el) return;
  const from = _trWatchFrom(), fromT = from.getTime();
  const fromLabel = from.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const sub = document.getElementById('dash-track-record-subtitle');
  if (sub) sub.textContent = 'Vessels that came outside laycan (after or before it), were unready or disputed since ' + fromLabel + ' (last ' + TR_WATCH_MONTHS + ' months), and flagged vessels nominated again. Click a vessel for details.';

  let again = [];
  try { again = typeof _trRenominated === 'function' && document.getElementById('vc') ? _trRenominated() : []; } catch (e) { again = []; }
  const againByKey = {};
  again.forEach(function(x) { (againByKey[x.key] = againByKey[x.key] || []).push(x); });

  const names = new Map();
  Object.keys(_deliveryLog || {}).forEach(function(monthKey) {
    const month = _deliveryLog[monthKey] || {};
    ['timely', 'delayed', 'disputes'].forEach(function(bucket) {
      _dlLive(month[bucket]).forEach(function(e) {
        const k = _trVesselKey(e.vessel);
        if (k && !names.has(k)) names.set(k, String(e.vessel).replace(/\s+/g, ' ').trim().toUpperCase().replace(/^M\s*[.\/]?\s*[VT]\.?\s+/, ''));
      });
    });
  });

  const rows = [];
  names.forEach(function(label, key) {
    const tr = computeVesselTrackRecord(label);
    if (!tr) return;
    const recent = tr.deliveries.filter(function(d) { return d.flagged && _trEntryTime(d.entry) >= fromT; });
    const nominated = againByKey[key] || [];
    if (!recent.length && !nominated.length) return;
    rows.push({ label: label, tr: tr, recent: recent, nominated: nominated });
  });
  rows.sort(function(a, b) {
    if (!!a.nominated.length !== !!b.nominated.length) return a.nominated.length ? -1 : 1;
    const ac = a.tr.unready > 0 || a.tr.inconsistentDispute > 0, bc = b.tr.unready > 0 || b.tr.inconsistentDispute > 0;
    if (ac !== bc) return ac ? -1 : 1;
    const at = a.recent.length ? _trEntryTime(a.recent[0].entry) : 0, bt = b.recent.length ? _trEntryTime(b.recent[0].entry) : 0;
    return bt - at;
  });

  if (!rows.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center;padding:20px">No vessel came outside laycan, was unready or disputed in the last ' + TR_WATCH_MONTHS + ' months, and no flagged vessel is nominated.</div>';
    return;
  }

  const fmtD = function(d) { return d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : 'no ETA'; };
  el.innerHTML = '<div style="display:flex;flex-direction:column;gap:8px">' + rows.map(function(r) {
    const tr = r.tr, recent = r.recent;
    const critical = recent.some(function(d) { return d.entry.flagUnready || d.entry.flagInconsistentDispute; }) || (r.nominated.length && (tr.unready || tr.inconsistentDispute));
    const bg = critical ? 'var(--red-lt)' : 'var(--amber-lt)';
    const border = critical ? 'var(--red-bd)' : 'var(--amber-bd)';
    const color = critical ? 'var(--red)' : 'var(--amber)';
    const n = function(f) { return recent.filter(f).length; };
    const parts = [];
    if (r.nominated.length) parts.push('<strong class="tr-again">⚑ Nominated again' + (r.nominated[0].eta ? ' — ETA ' + esc(fmtD(r.nominated[0].eta)) : '') + '</strong>');
    const late = n(function(d) { return d.late; }), early = n(function(d) { return d.early; });
    if (late) parts.push('<strong>After laycan ×' + late + '</strong>');
    if (early) parts.push('<strong>Before laycan ×' + early + '</strong>');
    const unr = n(function(d) { return d.entry.flagUnready && !d.orphanDispute; }), inc = n(function(d) { return d.entry.flagInconsistentDispute && !d.orphanDispute; }), dis = n(function(d) { return d.dispute; });
    if (unr) parts.push('<strong>⚠ Unready ×' + unr + '</strong>');
    if (inc) parts.push('<strong>⚠ Inconsistent claim ×' + inc + '</strong>');
    if (dis) parts.push('<strong>' + dis + '</strong> dispute' + (dis > 1 ? 's' : ''));
    if (!recent.length) parts.push('nothing in the last ' + TR_WATCH_MONTHS + ' months');
    const history = !tr.total ? 'No supply on record' : 'All supplies: ' + tr.total + (tr.late || tr.early ? ' — ' + esc(_trLaycanSummary(tr)) : tr.total === 1 ? ' — within laycan' : ' — all within laycan');
    const shown = recent.length ? recent : tr.deliveries.filter(function(d) { return d.flagged; });
    const lines = shown.map(function(d) {
      const e = d.entry;
      const qty = [e.vlsfoAct ? 'VLSFO ' + Number(e.vlsfoAct).toLocaleString() + ' MT' : '', e.mgoAct ? 'MGO ' + Number(e.mgoAct).toLocaleString() + ' MT' : ''].filter(Boolean).join(' · ');
      const lay = d.orphanDispute ? '' : d.late
        ? '<span style="color:var(--amber);font-weight:700">Came after laycan</span>'
        : d.early ? '<span style="color:var(--amber);font-weight:700">Came before laycan</span>'
        : '<span style="color:var(--green);font-weight:700">Within laycan</span>';
      const flags = [];
      if (e.flagUnready && !d.orphanDispute) flags.push('<span style="color:var(--red);font-weight:700">⚠ Unready</span>');
      if (e.flagInconsistentDispute && !d.orphanDispute) flags.push('<span style="color:var(--red);font-weight:700">⚠ Inconsistent claim</span>');
      if (d.dispute) flags.push('<span style="color:var(--red);font-weight:700">⚠ Dispute</span>' + (d.dispute.remarks ? ': ' + esc(d.dispute.remarks) : ''));
      return '<div style="display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline;padding:6px 0;border-top:1px solid var(--border2);font-size:11.5px;color:var(--ink)">' +
        '<span style="min-width:110px;font-weight:600">' + esc(e.dateStr && e.dateStr !== '—' ? e.dateStr : _trDay(e)) + '</span>' +
        '<span style="color:var(--muted)">' + (e.barge ? esc(e.barge) : '—') + (qty ? ' · ' + esc(qty) : '') + '</span>' +
        (lay ? '<span>' + lay + '</span>' : '') +
        (flags.length ? '<span>' + flags.join(' · ') + '</span>' : '') +
      '</div>';
    }).join('');
    const nomLines = r.nominated.map(function(x) {
      return '<div style="padding:6px 0;border-top:1px solid var(--border2);font-size:11.5px;color:var(--ink)"><span class="tr-again-line" role="button" tabindex="0" style="cursor:pointer;text-decoration:underline" onclick="_trGoTo(\'' + escJs(x.cid) + '\')" onkeydown="if(event.key===\'Enter\'){_trGoTo(\'' + escJs(x.cid) + '\')}">New nomination' + (x.eta ? ' — ETA ' + esc(fmtD(x.eta)) : '') + (x.lcText ? ' · laycan ' + esc(x.lcText) : '') + '</span> — open the card</div>';
    }).join('');
    return '<details class="tr-watch-row" data-vessel="' + esc(r.label) + '" style="background:' + bg + ';border:1px solid ' + border + ';border-radius:8px">' +
      '<summary style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;cursor:pointer;list-style:none">' +
        '<span style="font-size:12px;font-weight:700;color:var(--ink)">' + esc(r.label) + '</span>' +
        '<span style="font-size:11px;color:' + color + ';text-align:right">' + parts.join(' · ') + ' <span aria-hidden="true" style="color:var(--muted)">▾</span></span>' +
      '</summary>' +
      '<div style="padding:0 12px 8px">' + nomLines + lines +
        '<div style="padding-top:6px;font-size:10.5px;color:var(--muted)">' + history + '</div></div>' +
    '</details>';
  }).join('') + '</div>' +
  '<div style="margin-top:10px;font-size:10.5px;color:var(--muted);line-height:1.5">' +
    '<strong>How this works:</strong> a supply is flagged when the vessel came <em>after</em> its laycan closed or <em>before</em> it opened (compared when the supply is saved; before-laycan is recorded from Nov 2026), was unready on arrival, made an inconsistent claim, or was marked <strong>⚠ Dispute</strong> on the Checklist. ' +
    'One flagged supply is enough. This list keeps the last ' + TR_WATCH_MONTHS + ' months and clears older ones by itself; the full history is kept, so a vessel that came outside laycan is still flagged on its new nomination card, in the alerts bell and when the schedule is generated. ' +
    'Red = unready or inconsistent claim, amber = outside laycan or a dispute.' +
  '</div>';
}

// The nomination card's laycan status and IMO right now (a card corrected after
// Generate must not be logged with the old schedule's late / early). null when
// the card is gone (the values stamped from the schedule are used then).
function _trLiveLaycan(rec) {
  if (!rec || !rec.nomUid || typeof getVessels !== 'function') return null;
  let v = null;
  try { v = getVessels(true).find(function(x) { return x.nomUid === rec.nomUid; }); } catch (e) { return null; }
  return v ? { isDelayed: !!v.isDelayed, isEarly: !!(v.isEarly || v.held), imo: String(v.imo || '').trim() } : null;
}

// Called from saveChecklistRecord() at the exact moment a supply is saved —
// this is the single, automatic entry point for the whole Delivery Log.
function _logDelivery(rec, supplyRec) {
  const live = _trLiveLaycan(rec);
  if (live) { rec.isDelayed = live.isDelayed; rec.isEarly = live.isEarly; }
  const key = _dlMonthKey(supplyRec.supplyDate || rec.supplyDate);
  const month = _dlEnsureMonth(key);
  const base = {
    id: supplyRec.id,
    checklistUid: rec.uid,
    nomUid: rec.nomUid || null,
    vessel: rec.vessel,
    dateStr: supplyRec.dateStr,
    supplyDate: supplyRec.supplyDate,
    barge: rec.bargeLabel || '',
    vlsfoAct: supplyRec.vlsfoAct,
    mgoAct: supplyRec.mgoAct,
    flagUnready: !!rec.flagUnready,
    flagInconsistentDispute: !!rec.flagInconsistentDispute,
    remarks: (rec.notes || '').trim(),
    loggedAt: new Date().toISOString(),
    updatedAt: Date.now(),
  };

  // Timely / Delayed — automatic, based on whether actual ETA fell within
  // the nominated laycan window (rec.isDelayed, same rule used everywhere
  // else in the app for laycan compliance).
  // Came BEFORE the laycan opened (held to it included): kept on the entry
  // so the track record can flag it (only stored when true).
  if (!rec.isDelayed && rec.isEarly) base.isEarly = true;
  if (live && live.imo) base.imo = live.imo; // lets a re-nomination match by IMO too
  const bucket = rec.isDelayed ? month.delayed : month.timely;
  const already = bucket.some(function(e) { return e && !e.deleted && e.checklistUid === rec.uid; });
  if (!already) bucket.push(base);
  // A re-log after a deletion: this newer entry supersedes the tombstone.
  if (month.removed && month.removed[rec.uid]) delete month.removed[rec.uid];

  // Dispute — only when the delivery is marked ⚠ Dispute on the Checklist;
  // the Remarks are kept as its details. (Remarks on their own used to count
  // as a dispute, so any note at all, even "no dispute", was logged as one.)
  const marked = typeof rec.flagDispute === 'boolean' ? rec.flagDispute : _clDisputeState(rec);
  _dlSetDispute(month, base, marked, rec.notes);

  _saveDeliveryLog();
}

// Adds, updates or clears (isDispute:false, kept so the change syncs and
// wins the merge) this delivery's entry in month.disputes.
function _dlSetDispute(month, base, isDispute, notes) {
  if (!month || !base) return;
  if (!Array.isArray(month.disputes)) month.disputes = [];
  const remarks = (notes || '').trim();
  const now = Date.now();
  const existing = month.disputes.find(function(e) { return e && !e.deleted && e.checklistUid === base.checklistUid; });
  if (existing) {
    existing.isDispute = !!isDispute;
    existing.remarks = remarks;
    existing.updatedAt = Math.max(now, _dlStamp(existing) + 1);
  } else if (isDispute) {
    month.disputes.push(Object.assign({}, base, { remarks: remarks, isDispute: true, updatedAt: now }));
  }
}

// Is this Delivery Log dispute entry a real dispute? Entries logged since the
// ⚠ Dispute button carry isDispute. Older ones were logged for ANY remark, so
// they count only when the remark actually reads like a dispute (a claim,
// shortfall, discrepancy, protest…) and isn't a "no dispute" / "nil" note.
const _DL_DISPUTE_WORDS = /disput|claim|short|discrepan|protest|\blop\b|less\s+(?:qty|quantity|received)|differen|\bdiff\b|off[\s-]?spec|complain|contaminat|water\s+content|sample|surveyor\s+(?:found|reported)|reject|underdeliver|under[\s-]delivered|over[\s-]?claim/i;
const _DL_NEG_TOPIC = '(?:disput\\w*|claims?|issues?|discrepanc\\w*|protests?|shortfall|shortage|complaints?|differences?)';
const _DL_NO_DISPUTE = new RegExp('\\b(?:no|nil|without|zero|not\\s+any|none)\\s+(?:\\w+\\s+)?' + _DL_NEG_TOPIC + '(?:\\s*(?:,|/|or|and|nor)\\s*' + _DL_NEG_TOPIC + ')*\\b', 'gi');
function _dlRemarkLooksLikeDispute(text) {
  const t = String(text || '').replace(_DL_NO_DISPUTE, ' ');
  return _DL_DISPUTE_WORDS.test(t);
}
function _dlIsDispute(e) {
  if (!e) return false;
  if (typeof e.isDispute === 'boolean') return e.isDispute;
  return _dlRemarkLooksLikeDispute(e.remarks);
}

function _saveDeliveryLog() {
  try { localStorage.setItem('abps_delivery_log_v1', JSON.stringify(_deliveryLog)); } catch(e) {}
  _trIndexCache = null; // the log changed: the next look-up rebuilds the index
  // A supply saved / removed / flagged: card banners, the bell and the watchlist follow.
  if (typeof _trAfterApply === 'function') { clearTimeout(_saveDeliveryLog._t); _saveDeliveryLog._t = setTimeout(_trAfterApply, 0); }
}
function _loadDeliveryLogLocal() {
  try {
    const raw = localStorage.getItem('abps_delivery_log_v1');
    if (raw) _deliveryLog = JSON.parse(raw) || {};
  } catch(e) {}
}

// Merge of an incoming (cloud/remote) Delivery Log into the local one —
// same never-lose philosophy as _mergeAgents()/_mergeArchives(). Entries are
// keyed by checklistUid (else id) within their bucket: one only the remote
// has is added; one both have keeps the newer copy (_dlStamp). Deletion
// tombstones (month.removed) are unioned, newer wins, and any entry on
// either side that is not newer than its tombstone is dropped — so a
// deletion made on another device isn't resurrected by this device's
// older copy, while a later re-log still beats an earlier deletion.
function _mergeDeliveryLog(remoteLog) {
  if (!remoteLog || typeof remoteLog !== 'object') return;
  Object.keys(remoteLog).forEach(function(key) {
    const remoteMonth = remoteLog[key] || {};
    const localMonth = _dlEnsureMonth(key);
    if (remoteMonth.removed && typeof remoteMonth.removed === 'object') {
      Object.keys(remoteMonth.removed).forEach(function(uid) {
        const rt = remoteMonth.removed[uid];
        const lt = localMonth.removed && localMonth.removed[uid];
        if (rt && (!lt || _dlStamp(rt) > _dlStamp(lt))) {
          if (!localMonth.removed || typeof localMonth.removed !== 'object') localMonth.removed = {};
          localMonth.removed[uid] = rt;
        }
      });
    }
    ['timely', 'delayed', 'disputes'].forEach(function(bucket) {
      const remoteEntries = Array.isArray(remoteMonth[bucket]) ? remoteMonth[bucket] : [];
      remoteEntries.forEach(function(re) {
        if (!re) return;
        const i = localMonth[bucket].findIndex(function(le) { return _dlSameEntry(le, re); });
        if (i < 0) localMonth[bucket].push(re);
        else if (_dlStamp(re) > _dlStamp(localMonth[bucket][i])) localMonth[bucket][i] = re;
      });
      localMonth[bucket] = localMonth[bucket].filter(function(e) { return e && !_dlIsRemoved(localMonth, e); });
    });
    // A tombstone a newer live entry has superseded is no longer needed.
    if (localMonth.removed) {
      Object.keys(localMonth.removed).forEach(function(uid) {
        const t = localMonth.removed[uid];
        const newer = ['timely', 'delayed', 'disputes'].some(function(b) {
          return localMonth[b].some(function(e) { return e.checklistUid === uid && _dlStamp(e) > _dlStamp(t); });
        });
        if (newer) delete localMonth.removed[uid];
      });
    }
  });
  _saveDeliveryLog();
}

function renderDeliveryLog() {
  const sel = document.getElementById('dl-month-select');
  if (!sel) return;

  // Months holding only tombstones (all entries deleted) aren't offered.
  const keys = Object.keys(_deliveryLog).filter(function(k) {
    const m = _deliveryLog[k] || {};
    return _dlLive(m.timely).length || _dlLive(m.delayed).length || _dlLive(m.disputes).filter(_dlIsDispute).length;
  }).sort().reverse();
  const currentKey = _dlMonthKey(new Date());
  if (!keys.length) keys.push(currentKey);
  else if (!keys.includes(currentKey)) keys.unshift(currentKey);

  const prevVal = sel.value;
  sel.innerHTML = keys.map(function(k) { return '<option value="'+esc(k)+'">'+esc(_dlMonthLabel(k))+'</option>'; }).join('');
  sel.value = keys.includes(prevVal) ? prevVal : currentKey;

  const key = sel.value;
  // Live entries only — deleted ones are tombstones (see _dlLive).
  const rawMonth = _deliveryLog[key] || {};
  const month = { timely: _dlLive(rawMonth.timely), delayed: _dlLive(rawMonth.delayed), disputes: _dlLive(rawMonth.disputes).filter(_dlIsDispute) };

  document.getElementById('dl-count-timely').textContent   = month.timely.length;
  document.getElementById('dl-count-delayed').textContent  = month.delayed.length;
  document.getElementById('dl-count-disputes').textContent = month.disputes.length;

  const rowHtml = function(e, extra) {
    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--border2);font-size:12.5px">'
      + '<div><strong>'+esc(e.vessel||'—')+'</strong><span style="color:var(--muted);margin-left:8px">'+esc(e.dateStr||'')+'</span></div>'
      + '<div style="color:var(--muted)">'+(e.barge?('Barge '+esc(e.barge)+' · '):'')+(e.vlsfoAct?('VLSFO '+esc(e.vlsfoAct.toLocaleString())+' MT '):'')+(e.mgoAct?('MGO '+esc(e.mgoAct.toLocaleString())+' MT'):'')+'</div>'
      + (extra||'')
      + '</div>';
  };

  const timelyEl = document.getElementById('dl-list-timely');
  timelyEl.innerHTML = month.timely.length
    ? month.timely.map(function(e){ return rowHtml(e); }).join('')
    : '<div style="font-size:12px;color:var(--muted);padding:8px 0">No timely deliveries logged for this month.</div>';

  const delayedEl = document.getElementById('dl-list-delayed');
  delayedEl.innerHTML = month.delayed.length
    ? month.delayed.map(function(e){ return rowHtml(e); }).join('')
    : '<div style="font-size:12px;color:var(--muted);padding:8px 0">No delayed deliveries logged for this month.</div>';

  const disputesEl = document.getElementById('dl-list-disputes');
  disputesEl.innerHTML = month.disputes.length
    ? month.disputes.map(function(e){
        return '<div style="padding:9px 0;border-bottom:1px solid var(--border2);font-size:12.5px">'
          + '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px">'
          + '<strong>'+esc(e.vessel||'—')+'</strong><span style="color:var(--muted)">'+esc(e.dateStr||'')+'</span>'
          + '</div>'
          + '<div style="margin-top:4px;padding:8px 10px;background:var(--red-lt);border:1px solid #F3C7C0;border-radius:6px;color:var(--red-dk,#9B2C2C)">'+(e.remarks ? esc(e.remarks) : '<em>No remarks entered</em>')+'</div>'
          + '</div>';
      }).join('')
    : '<div style="font-size:12px;color:var(--muted);padding:8px 0">No disputes logged for this month.</div>';
}

