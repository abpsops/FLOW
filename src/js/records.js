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
   A smart layer over the Delivery Log FLOW already builds automatically
   on every completed supply — no new data entry, no separate report to
   go looking for. Surfaces a vessel's own history (laycan compliance,
   past disputes) at the exact moment it's useful: while nominating it
   again. Per request, only counts history from September 2026 onward —
   anything before that month is ignored entirely, both for the
   timely/delayed rate and for disputes. Needs a minimum of 2 past
   completed supplies to say anything at all — a vessel supplied only
   once doesn't have a "track record" yet, it has one data point. */
const TRACK_RECORD_START_MONTH = '2026-09';
// "Sep 2026" — the fixed start of counted history, derived from the constant
// above so the wording can never drift from the rule actually applied.
function _trackRecordSinceLabel() {
  const p = TRACK_RECORD_START_MONTH.split('-');
  return MO[Number(p[1]) - 1] + ' ' + p[0];
}

// One key per vessel however its name was typed: case, extra spaces and an
// "MV"/"M/V"/"M.V." prefix are ignored ("Elandra sea" = "ELANDRA SEA").
function _trVesselKey(name) {
  return String(name || '').toLowerCase().replace(/[\s\u00a0]+/g, ' ').trim()
    .replace(/^m\s*[.\/]?\s*v\.?\s+/, '').replace(/[.,;:]+$/, '').trim();
}

function computeVesselTrackRecord(vesselName) {
  const name = _trVesselKey(vesselName);
  if (!name) return null;
  let timely = 0, delayed = 0, unready = 0, inconsistentDispute = 0;
  const disputes = [];
  const deliveries = [];
  Object.keys(_deliveryLog || {}).sort().forEach(function(monthKey) {
    if (monthKey < TRACK_RECORD_START_MONTH) return;
    const month = _deliveryLog[monthKey];
    const disputeByUid = {};
    _dlLive(month.disputes).forEach(function(e) {
      if (_trVesselKey(e.vessel) !== name || !_dlIsDispute(e)) return;
      disputes.push(e);
      if (e.checklistUid) disputeByUid[e.checklistUid] = e;
    });
    [['timely', false], ['delayed', true]].forEach(function(b) {
      _dlLive(month[b[0]]).forEach(function(e) {
        if (_trVesselKey(e.vessel) !== name) return;
        if (b[1]) delayed++; else timely++;
        if (e.flagUnready) unready++;
        if (e.flagInconsistentDispute) inconsistentDispute++;
        const d = e.checklistUid && disputeByUid[e.checklistUid];
        deliveries.push({ entry: e, delayed: b[1], dispute: d || null });
      });
    });
  });
  const total = timely + delayed;
  if (total < 2) return null; // not enough history yet to mean anything
  deliveries.sort(function(a, b) { return String(b.entry.supplyDate || b.entry.loggedAt || '').localeCompare(String(a.entry.supplyDate || a.entry.loggedAt || '')); });
  return { total, timely, delayed, disputes, unready, inconsistentDispute, deliveries };
}

// Renders the banner into a given container id, reading the vessel name
// from a given input id — kept generic so the same function drives both
// the live Nomination card (id-suffixed per card) and the Availability
// Checker's single vessel-name field.
function renderVesselTrackRecordBanner(nameInputId, bannerElId) {
  const nameEl = document.getElementById(nameInputId);
  const bannerEl = document.getElementById(bannerElId);
  if (!nameEl || !bannerEl) return;
  const tr = computeVesselTrackRecord(nameEl.value);
  if (!tr) { bannerEl.innerHTML = ''; return; }
  const delayPct = Math.round((tr.delayed / tr.total) * 100);
  const rows = [];
  if (tr.delayed > 0) {
    rows.push('Outside laycan in <strong>' + tr.delayed + ' of its last ' + tr.total + '</strong> nominations (' + delayPct + '%) since ' + _trackRecordSinceLabel() + '.');
  } else {
    rows.push('Within laycan on all <strong>' + tr.total + '</strong> nominations since ' + _trackRecordSinceLabel() + '.');
  }
  if (tr.disputes.length) {
    rows.push('<strong>' + tr.disputes.length + '</strong> past dispute' + (tr.disputes.length > 1 ? 's' : '') + ' recorded — see Delivery Log for details.');
  }
  // Counterparty red flags — genuinely different severity from a plain
  // delay or dispute (those can just be timing/paperwork; these are about
  // the counterparty's own conduct), so they get their own bold red lines
  // and push the whole banner into its strongest tier rather than blending
  // into the same amber used for an ordinary delay.
  const redRows = [];
  if (tr.unready > 0) {
    redRows.push('⚠ Unready on arrival <strong>' + tr.unready + '</strong> time' + (tr.unready > 1 ? 's' : '') + ' — agreed to bunker on arrival, then wasn\'t ready.');
  }
  if (tr.inconsistentDispute > 0) {
    redRows.push('⚠ Inconsistent dispute claims in <strong>' + tr.inconsistentDispute + '</strong> ' + (tr.inconsistentDispute > 1 ? 'deliveries' : 'delivery') + ' — quantity shortfall claim changed after the fact.');
  }
  const critical = redRows.length > 0;
  const severe = tr.delayed > 0 || tr.disputes.length > 0;
  const bg = critical ? 'var(--red-lt)' : severe ? 'var(--amber-lt)' : 'var(--green-lt)';
  const border = critical ? 'var(--red-bd)' : severe ? 'var(--amber-bd)' : 'var(--green-bd)';
  const color = critical ? 'var(--red)' : severe ? 'var(--amber)' : 'var(--green)';
  const allRows = critical ? redRows.concat(rows) : rows;
  bannerEl.innerHTML = '<div style="margin-top:8px;padding:8px 12px;background:' + bg + ';border:1px solid ' + border + ';border-radius:8px;font-size:11.5px;color:' + color + ';line-height:1.5">' +
    '<div style="font-weight:700;margin-bottom:2px">Track Record — ' + esc((nameEl.value || '').trim()) + '</div>' +
    allRows.join('<br>') +
  '</div>';
}

// The standing Dashboard widget — every vessel that has actually built up
// a track record (2+ deliveries since TRACK_RECORD_START_MONTH), not just whichever
// vessel someone happens to be typing right now. Flagged vessels
// (any delay or dispute history) are listed first.
function renderTrackRecordWatchlist() {
  const el = document.getElementById('dash-track-record-watchlist');
  if (!el) return;
  const sub = document.getElementById('dash-track-record-subtitle');
  if (sub) sub.textContent = 'Vessels with 2+ completed deliveries since ' + _trackRecordSinceLabel() + ' — laycan compliance & disputes. Click a vessel for details.';

  // One row per vessel (see _trVesselKey), shown in capitals.
  const names = new Map();
  Object.keys(_deliveryLog || {}).forEach(function(monthKey) {
    if (monthKey < TRACK_RECORD_START_MONTH) return;
    const month = _deliveryLog[monthKey];
    ['timely', 'delayed'].forEach(function(bucket) {
      _dlLive(month[bucket]).forEach(function(e) {
        const k = _trVesselKey(e.vessel);
        if (k && !names.has(k)) names.set(k, String(e.vessel).replace(/\s+/g, ' ').trim().toUpperCase());
      });
    });
  });

  const records = Array.from(names.values())
    .map(function(n) { const tr = computeVesselTrackRecord(n); return tr ? Object.assign({ name: n }, tr) : null; })
    .filter(Boolean)
    .sort(function(a, b) {
      const aCrit = a.unready > 0 || a.inconsistentDispute > 0;
      const bCrit = b.unready > 0 || b.inconsistentDispute > 0;
      if (aCrit !== bCrit) return aCrit ? -1 : 1; // conduct red-flags always float to the top
      const aFlag = a.delayed > 0 || a.disputes.length > 0;
      const bFlag = b.delayed > 0 || b.disputes.length > 0;
      if (aFlag !== bFlag) return aFlag ? -1 : 1;
      return b.delayed - a.delayed;
    });

  if (!records.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center;padding:20px">No vessels have enough history yet — builds up automatically as vessels get repeat deliveries.</div>';
    return;
  }

  el.innerHTML = '<div style="display:flex;flex-direction:column;gap:8px">' + records.map(function(r) {
    // Conduct red flags (unready-on-arrival, inconsistent dispute claims)
    // are a different kind of problem than a plain delay or paperwork
    // dispute — they get their own bold red badge instead of blending
    // into the same amber tier as everything else.
    const critical = r.unready > 0 || r.inconsistentDispute > 0;
    const flagged = r.delayed > 0 || r.disputes.length > 0;
    const bg = critical ? 'var(--red-lt)' : flagged ? 'var(--amber-lt)' : 'var(--green-lt)';
    const border = critical ? 'var(--red-bd)' : flagged ? 'var(--amber-bd)' : 'var(--green-bd)';
    const color = critical ? 'var(--red)' : flagged ? 'var(--amber)' : 'var(--green)';
    const delayPct = Math.round((r.delayed / r.total) * 100);
    const parts = [];
    if (r.unready > 0) parts.push('<strong>⚠ Unready ×' + r.unready + '</strong>');
    if (r.inconsistentDispute > 0) parts.push('<strong>⚠ Inconsistent dispute ×' + r.inconsistentDispute + '</strong>');
    parts.push(r.delayed > 0
      ? 'Outside laycan in <strong>' + r.delayed + ' of ' + r.total + '</strong> (' + delayPct + '%)'
      : 'Within laycan on all <strong>' + r.total + '</strong>');
    parts.push(r.disputes.length
      ? '<strong>' + r.disputes.length + '</strong> dispute' + (r.disputes.length > 1 ? 's' : '')
      : 'no disputes');
    // The deliveries behind the numbers, newest first.
    const rows = r.deliveries.map(function(d) {
      const e = d.entry;
      const qty = [e.vlsfoAct ? 'VLSFO ' + Number(e.vlsfoAct).toLocaleString() + ' MT' : '', e.mgoAct ? 'MGO ' + Number(e.mgoAct).toLocaleString() + ' MT' : ''].filter(Boolean).join(' · ');
      const lay = d.delayed
        ? '<span style="color:var(--amber);font-weight:700">Arrived after laycan</span>'
        : '<span style="color:var(--green);font-weight:700">Within laycan</span>';
      const flags = [];
      if (e.flagUnready) flags.push('<span style="color:var(--red);font-weight:700">⚠ Unready</span>');
      if (e.flagInconsistentDispute) flags.push('<span style="color:var(--red);font-weight:700">⚠ Inconsistent claim</span>');
      if (d.dispute) flags.push('<span style="color:var(--red);font-weight:700">⚠ Dispute</span>' + (d.dispute.remarks ? ': ' + esc(d.dispute.remarks) : ''));
      return '<div style="display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline;padding:6px 0;border-top:1px solid var(--border2);font-size:11.5px;color:var(--ink)">' +
        '<span style="min-width:110px;font-weight:600">' + esc(e.dateStr || '—') + '</span>' +
        '<span style="color:var(--muted)">' + (e.barge ? esc(e.barge) : '—') + (qty ? ' · ' + esc(qty) : '') + '</span>' +
        '<span>' + lay + '</span>' +
        (flags.length ? '<span>' + flags.join(' · ') + '</span>' : '') +
      '</div>';
    }).join('');
    return '<details class="tr-watch-row" style="background:' + bg + ';border:1px solid ' + border + ';border-radius:8px">' +
      '<summary style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;cursor:pointer;list-style:none">' +
        '<span style="font-size:12px;font-weight:700;color:var(--ink)">' + esc(r.name) + '</span>' +
        '<span style="font-size:11px;color:' + color + ';text-align:right">' + parts.join(' · ') + ' <span aria-hidden="true" style="color:var(--muted)">▾</span></span>' +
      '</summary>' +
      '<div style="padding:0 12px 8px">' + rows + '</div>' +
    '</details>';
  }).join('') + '</div>' +
  '<div style="margin-top:10px;font-size:10.5px;color:var(--muted);line-height:1.5">' +
    '<strong>How this is worked out:</strong> each completed delivery since ' + esc(_trackRecordSinceLabel()) + ' counts once. ' +
    '<em>Within laycan</em> / <em>arrived after laycan</em> compares the vessel\'s ETA with the end of its nominated laycan when the supply was saved. ' +
    'A <em>dispute</em> is a delivery marked <strong>⚠ Dispute</strong> on the Checklist — Remarks on their own don\'t count. ' +
    'Green = all within laycan and no disputes, amber = a late arrival or a dispute, red = unready on arrival or an inconsistent claim. Click a vessel to see its deliveries.' +
  '</div>';
}

// Called from saveChecklistRecord() at the exact moment a supply is saved —
// this is the single, automatic entry point for the whole Delivery Log.
function _logDelivery(rec, supplyRec) {
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

