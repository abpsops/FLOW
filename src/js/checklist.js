/* ─── CHECKLIST ─── */
// ═══════════════════════════════════════════════════════════
// INDEPENDENT PERSISTENT CHECKLIST
// - Records are NEVER deleted when nomination is removed
// - Each record is fully isolated (no row shifting, no data sharing)
// - Once "Completed" a record is permanently locked
// - Nominations feed INTO checklist only on schedule generation
// - Actual quantities are always manual user input
// ═══════════════════════════════════════════════════════════

// (declared at top level) // { [uid]: { uid, sno, vessel, nomV, nomM, actV, actM, supplied, notes, bargeLabel, supplyDate, lockedAt } }

function _clUid(sno, name) {
  // ── FT84 FIX (Issues 2 & 3): UID must be STABLE across recalculations.
  // The old key was `sno + slug(name)` where sno is the scheduler's position number.
  // sno changes every time Generate Schedule runs (vessel order shifts), which caused
  // a new _checklistRecords key to be created each run → DUPLICATE checklist entries.
  // Deletion by the old key then left orphan records that appeared as valid nominations.
  //
  // New key: vessel name slug only.  Name is stable; position is not.
  // The sno parameter is kept for backward-compat call sites but is IGNORED.
  const slug = (name || '').toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g,'_').replace(/^_|_$/g,'').slice(0, 40);
  return 'v_' + (slug || String(Date.now()));
}

// Called ONLY from renderOutput — injects new records, never overwrites existing
// FT84 FIX (Issue 2): UID is now vessel-name-based (stable). Running this function
// 1 time or 100 times produces exactly the same _checklistRecords — fully idempotent.
function injectChecklistFromSchedule(sched) {
  // Deduplicate the incoming schedule PER NOMINATION (nomUid) before
  // processing — a stale _lastSched can contain the same nomination twice.
  // Deduping by vessel name (the old behaviour) dropped a genuine second
  // nomination of the same vessel. Legacy items without a nomUid still
  // dedupe by name.
  const seenKeys = new Set();
  const dedupedSched = sched.filter(item => {
    const key = item.nomUid ? 'n:' + item.nomUid : 'v:' + (item.name || '').trim().toLowerCase();
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  dedupedSched.forEach(item => {
    // Already supplied (a saved record, a saved row, an archived month) —
    // never offer it as Pending again. Completed rows aren't synced or kept
    // across a reload, and the saved schedule still lists the vessel until
    // the next Generate, so the row used to come back and could be saved twice.
    if (_isScheduleItemCompleted(item)) return;
    // Find the record that already belongs to THIS nomination, if any.
    const existing = _clFindRecordForItem(item);
    let uid;
    if (existing) {
      uid = existing.uid;
      // Already saved/locked — this nomination is done; never touch it.
      if (existing.lockedAt) return;
    } else if (item.nomUid) {
      uid = 'n_' + String(item.nomUid).replace(/[^A-Za-z0-9_-]/g, '_');
    } else {
      // Legacy schedule item (no nomUid): name-based uid, or — when that
      // uid is already taken by an earlier, different supply of the same
      // vessel — a deterministic re-supply uid keyed by the supply DATE
      // (sno is positional and changes every regenerate).
      uid = _clUid(item.sno, item.name);
      if (_checklistRecords[uid]) {
        const st = item.bargeStart || item.eta;
        const d = st ? new Date(st) : null;
        uid = uid + '__resupply_' + (d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10).replace(/-/g, '') : 'nodate');
        if (_checklistRecords[uid]) return;
      }
    }

    if (!_checklistRecords[uid]) {
      // Distinguish "this fuel type was never part of the nomination" (null —
      // hide the field) from "nominated quantity is 0 / not yet available from
      // ROB" (keep it visible so the operator can still see and enter actuals).
      _checklistRecords[uid] = {
        uid,
        nomUid:     item.nomUid || null, // the nomination this row belongs to
        sno:        item.sno,      // display order (updated each run, never used as key)
        vessel:     item.name,
        area:       item.area || '',
        nomV:       (item.nomVQ !== undefined && item.nomVQ !== null) ? item.nomVQ : ((item.vQ === undefined || item.vQ === null || item.vQ === '') ? null : (typeof item.vQ === 'number' ? item.vQ : (parseFloat(item.vQ) || 0))),
        nomM:       (item.nomMQ !== undefined && item.nomMQ !== null) ? item.nomMQ : ((item.mQ === undefined || item.mQ === null || item.mQ === '') ? null : (typeof item.mQ === 'number' ? item.mQ : (parseFloat(item.mQ) || 0))),
        actV:       '',   // deliberately blank — user must enter actual
        actM:       '',   // deliberately blank
        bdnV:       '',   // BDN No. for the VLSFO delivery (blank until entered)
        bdnM:       '',   // BDN No. for the LSMGO delivery (blank until entered)
        supplied:   false,
        notes:      '',
        bargeLabel: item.bargeLabel || '',
        supplyDate: item.bargeStart || item.eta,
        isDelayed:  !!item.isDelayed,
        isEarly:    !!(item.isEarly || item.held), // came before the laycan opened (held to it included)
        state:      'draft',
        lockedAt:   null
      };
      _clStampRange(_checklistRecords[uid], item);
    } else if (!_checklistRecords[uid].lockedAt) {
      // Existing unlocked record: update display sno and nomination ref only, never actuals
      _checklistRecords[uid].sno        = item.sno;          // keep display order current
      if (item.nomUid) _checklistRecords[uid].nomUid = item.nomUid; // stamp/refresh nomination identity
      _checklistRecords[uid].nomV       = (item.nomVQ !== undefined && item.nomVQ !== null) ? item.nomVQ : ((item.vQ === undefined || item.vQ === null || item.vQ === '') ? null : (typeof item.vQ === 'number' ? item.vQ : (parseFloat(item.vQ) || 0)));
      _checklistRecords[uid].nomM       = (item.nomMQ !== undefined && item.nomMQ !== null) ? item.nomMQ : ((item.mQ === undefined || item.mQ === null || item.mQ === '') ? null : (typeof item.mQ === 'number' ? item.mQ : (parseFloat(item.mQ) || 0)));
      _checklistRecords[uid].vessel     = item.name;
      _checklistRecords[uid].area       = item.area || _checklistRecords[uid].area || '';
      _checklistRecords[uid].bargeLabel = item.bargeLabel || '';
      _checklistRecords[uid].supplyDate = item.bargeStart || item.eta;
      _checklistRecords[uid].isDelayed  = !!item.isDelayed;
      _checklistRecords[uid].isEarly    = !!(item.isEarly || item.held);
      _clStampRange(_checklistRecords[uid], item);
    }
    // If supplied/locked: DO NOT touch any field
  });
}

// Copy a ranged nomination's min/max onto its checklist record (dropped again
// if the nomination is changed back to a single figure).
function _clStampRange(rec, item) {
  ['V', 'M'].forEach(function(g) {
    const r = _nomRange(item, g);
    if (r) { rec['nom' + g + 'Min'] = r.min; rec['nom' + g + 'Max'] = r.max; }
    else { delete rec['nom' + g + 'Min']; delete rec['nom' + g + 'Max']; }
  });
  // Time-frame ETA (AM / PM …) rides along for display only.
  if (item && item.etaWin && _etaFrame(item.etaWin)) rec.etaWin = item.etaWin; else delete rec.etaWin;
  // Ship-to-ship supply: same treatment.
  if (item && item.sts) rec.sts = true; else delete rec.sts;
}
// Actual vs nominated badge. For a ranged nomination anything inside
// min–max is OK; below min is short by (min − actual); above max is over.
function _clDevBadge(act, nom, rng) {
  if (act === '' || act === null || act === undefined) return '';
  const a = parseFloat(act);
  if (isNaN(a)) return '';
  const pill = function(bg, fg, txt) { return '<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;background:' + bg + ';color:' + fg + ';margin-left:4px">' + txt + '</span>'; };
  const mt = function(d) { return parseFloat(Math.abs(d).toFixed(2)).toLocaleString() + ' MT'; };
  if (rng) {
    if (a < rng.min) return pill('var(--red-lt)', 'var(--red)', 'Short ' + mt(rng.min - a));
    if (a > rng.max) return pill('var(--azure-lt)', 'var(--azure)', '+' + mt(a - rng.max) + ' over');
    return pill('var(--green-lt)', 'var(--green)', 'In range');
  }
  if (nom === 0) return '';
  const dev = a - nom;
  if (dev === 0) return pill('var(--green-lt)', 'var(--green)', 'Match');
  return pill(dev > 0 ? 'var(--azure-lt)' : 'var(--red-lt)', dev > 0 ? 'var(--azure)' : 'var(--red)', (dev > 0 ? '+' : '') + parseFloat(dev.toFixed(2)).toLocaleString() + ' MT');
}
// The checklist record that belongs to this schedule item's nomination:
// matched by nomUid; otherwise a legacy record (saved before nomUid was
// stamped) of the same vessel — a saved (locked) legacy record only when
// _recordMatchesScheduleItem says it's the same supply (date within 3d),
// an open draft by name (the old name-keyed scheme only ever had one).
function _clFindRecordForItem(item) {
  const recs = Object.values(_checklistRecords || {});
  if (item.nomUid) {
    const byUid = recs.find(r => r && r.nomUid === item.nomUid);
    if (byUid) return byUid;
  }
  const nm = (item.name || '').trim().toLowerCase();
  const legacy = recs.filter(r => r && !r.nomUid && (r.vessel || '').trim().toLowerCase() === nm);
  const done = legacy.find(r => r.lockedAt && _recordMatchesScheduleItem(r, item));
  if (done) return done;
  return legacy.find(r => !r.lockedAt) || null;
}

// (declared at top level)

// Sort by actual supply date ascending — sno is just the order vessels were
// generated in, not the chronological order of supply, and could be
// misleading once vessels get re-nominated for later dates.
// Top-level (not nested) so both renderChecklist() and downloadChecklist()
// can use it — it was previously declared INSIDE renderChecklist(), which
// left it out of scope for downloadChecklist(), silently breaking the
// "Download Checklist" button with an uncaught ReferenceError.
function _clDateSort(a, b) {
  const da = a.supplyDate ? new Date(a.supplyDate).getTime() : Infinity;
  const db = b.supplyDate ? new Date(b.supplyDate).getTime() : Infinity;
  if (da !== db) return da - db;
  return a.sno - b.sno; // stable tie-breaker when dates are equal/missing
}

// De-duplicate checklist records PER NOMINATION (nomUid; legacy records
// without one by vessel name) and purge the redundant copies from
// _checklistRecords so they don't come back. Rules: a locked/completed
// record is NEVER deleted (it's a real, saved supply); among a group's open
// records only the most advanced one is kept; and an open legacy record is
// dropped as a duplicate of a completed one only when it's the same supply
// (date within 3 days) — a later re-nomination of the vessel is kept.
// An open record of a delivery that is already saved (_isScheduleItemCompleted:
// Saved Records or an archived month) is dropped too — a colleague's unsaved
// edit to the row brings it back through the merge, and older builds created
// them from a stale schedule. Done = saved (locked): an unsaved row marked
// supplied is still open.
function _clDedupeRecords() {
  const isDone = r => !!(r.lockedAt || r.state === 'completed');
  const rank = r => (r.lockedAt ? 4 : 0) + (r.state === 'completed' ? 2 : r.state === 'saved' ? 1 : 0) + (r.supplied ? 1 : 0);
  const keyOf = r => r.nomUid ? 'n:' + r.nomUid : 'v:' + (r.vessel || '').trim().toLowerCase();
  const groups = new Map();
  Object.values(_checklistRecords || {}).forEach(r => {
    if (!r) return;
    const k = keyOf(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  const keep = [];
  groups.forEach((list, k) => {
    const done = list.filter(isDone);
    const open = list.filter(r => !isDone(r)).sort((a, b) => rank(b) - rank(a));
    done.forEach(r => keep.push(r));
    // An open record is a duplicate only of a record already kept for the
    // SAME nomination: anything in a nomUid group, or — for legacy name-keyed
    // records — one whose supply date is within 3 days. Two open legacy calls
    // of the same vessel on different dates (the "__resupply_" uids) are two
    // nominations and both stay; this used to keep only the first.
    const kept = done.slice();
    open.forEach(r => {
      const dup = kept.some(d => k.charAt(0) === 'n' ||
        _recordMatchesScheduleItem(d, { name: r.vessel, bargeStart: r.supplyDate })) ||
        _isScheduleItemCompleted({ nomUid: r.nomUid || null, name: r.vessel, bargeStart: r.supplyDate });
      if (dup) delete _checklistRecords[r.uid];
      else { kept.push(r); keep.push(r); }
    });
  });
  return keep.sort(_clDateSort);
}

function renderChecklist(sched) {
  const stsL = _stsLookup();
  const wrap = document.getElementById('checklist-rows'); if (!wrap) return;
  const clMap = _bargeColorMap();

  // Inject/update from schedule (but never delete existing records)
  if (sched && sched.length) injectChecklistFromSchedule(sched);

  // Refresh tracker whenever checklist renders
  if(typeof renderRemainingSupplyTracker==="function") setTimeout(function(){renderRemainingSupplyTracker();},50);
  // Note: legacy _checklist[sno] bidirectional sync removed in FT84 — sno is positional
  // and could map to different vessels after a recalculation. All state lives in _checklistRecords.

  let dedupedRecords = _clDedupeRecords();

  // If no records from _checklistRecords, try to inject from _lastSched directly
  if (!dedupedRecords.length && _lastSched && _lastSched.length) {
    injectChecklistFromSchedule(_lastSched);
    dedupedRecords = _clDedupeRecords();
  }
  if (!dedupedRecords.length) {
    wrap.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:20px;text-align:center">No checklist records. Generate the schedule first.</div>';
    return;
  }

  const th = s => `<th style="padding:10px 12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;white-space:nowrap">${s}</th>`;

  wrap.innerHTML = `<div style="overflow-x:auto"><table class="cl-tbl">
    <thead><tr>
      ${th('No.')}${th('Vessel')}${th('Supply Date')}
      ${th('Nom. VLSFO')}${th('Actual VLSFO')}
      ${th('Nom. LSMGO')}${th('Actual LSMGO')}
      ${th('Barge')}${th('BDN No. / BDN date')}${th('Status')}${th('Remarks')}${th('Action')}
    </tr></thead>
    <tbody>` +
    dedupedRecords.map((rec, idx) => {
      const isLocked = rec.state === 'completed' && rec.lockedAt;
      // Every value below can come from the shared cloud workspace — escape
      // for HTML (esc) and for the inline-handler JS strings (escJs).
      const uA = esc(rec.uid), uJ = escJs(rec.uid);
      // supplyDate is an ISO string after a JSON reload/cloud sync, which
      // fmt24() (Date-only) rendered as '—'.
      const _sd = rec.supplyDate ? new Date(rec.supplyDate) : null;
      const rowBg = isLocked ? 'background:var(--green-lt)' : '';
      const lockStyle = isLocked ? 'opacity:.65;pointer-events:none' : '';
      const lockBadge = ''; // Locked indicator removed — not shown to user

      // null = this fuel type was never part of the nomination → show '—', no input.
      // A real number (including 0, e.g. ROB not yet available) → always show the
      // value and the actuals input, so the operator can still record what's loaded.
      const nomVDisplay = (rec.nomV === null || rec.nomV === undefined) ? '—' : esc(_nomQtyTxt(rec, 'V', rec.nomV)) + ' MT';
      const nomMDisplay = (rec.nomM === null || rec.nomM === undefined) ? '—' : esc(_nomQtyTxt(rec, 'M', rec.nomM)) + ' MT';

      const devBadge = (act, nom, g) => _clDevBadge(act, nom, _nomRange(rec, g));

      const recSts = _stsOf(stsL, rec);
      return `<tr${recSts && !isLocked ? ' class="is-sts"' : ''}${!isLocked && rec.nomUid ? ` data-nu="${esc(rec.nomUid)}"` : ''} style="border-bottom:1px solid var(--border2);${rowBg}" id="cl-row-${uA}">
        <td style="padding:9px 12px;color:var(--muted);font-weight:700;font-family:DM Mono,monospace">${idx + 1}</td>
        <td style="padding:9px 12px;font-weight:600">${esc(rec.vessel)}<span data-sts-slot>${_stsTag({ sts: recSts })}</span>${lockBadge}</td>
        <td style="padding:9px 12px;font-family:DM Mono,monospace;font-size:11px;white-space:nowrap">${_sd ? fmt24(_sd) : '—'}${rec.etaWin ? '<div style="margin-top:3px">' + _etaFrameTag(rec.etaWin) + '</div>' : ''}</td>

        <td style="padding:9px 12px;text-align:center">
          <div style="font-family:DM Mono,monospace;font-weight:700;color:var(--azure)">${nomVDisplay}</div>
          <div style="font-size:9px;color:var(--muted);margin-top:1px">Nomination</div>
        </td>

        <td style="padding:9px 12px">
          ${rec.nomV !== null && rec.nomV !== undefined ? `<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
            <input type="number" id="cl-av-${uA}" value="${esc(rec.actV)}" min="0" step="0.1"
              placeholder="${esc(rec.nomV)}" ${isLocked ? 'disabled' : ''}
              onchange="clUpdateActual('${uJ}','v',this.value)"
              style="width:82px;font-size:12px;padding:5px 7px;border:none;box-shadow:var(--sh-in-xs);border-radius:6px;font-family:DM Mono,monospace;background:var(--surface);outline:none;${lockStyle}"
              onfocus="this.style.borderColor='var(--azure)'" onblur="this.style.borderColor='var(--border)'">
            <span style="font-size:11px;color:var(--sub)">MT</span>
            <span id="cl-dv-${uA}">${devBadge(rec.actV, rec.nomV, 'V')}</span>
          </div>` : '<span style="color:var(--muted)">—</span>'}
        </td>

        <td style="padding:9px 12px;text-align:center">
          <div style="font-family:DM Mono,monospace;font-weight:700;color:var(--teal)">${nomMDisplay}</div>
          <div style="font-size:9px;color:var(--muted);margin-top:1px">Nomination</div>
        </td>

        <td style="padding:9px 12px">
          ${rec.nomM !== null && rec.nomM !== undefined ? `<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
            <input type="number" id="cl-am-${uA}" value="${esc(rec.actM)}" min="0" step="0.1"
              placeholder="${esc(rec.nomM)}" ${isLocked ? 'disabled' : ''}
              onchange="clUpdateActual('${uJ}','m',this.value)"
              style="width:82px;font-size:12px;padding:5px 7px;border:none;box-shadow:var(--sh-in-xs);border-radius:6px;font-family:DM Mono,monospace;background:var(--surface);outline:none;${lockStyle}"
              onfocus="this.style.borderColor='var(--teal)'" onblur="this.style.borderColor='var(--border)'">
            <span style="font-size:11px;color:var(--sub)">MT</span>
            <span id="cl-dm-${uA}">${devBadge(rec.actM, rec.nomM, 'M')}</span>
          </div>` : '<span style="color:var(--muted)">—</span>'}
        </td>

        <td style="padding:9px 12px;font-size:12px">${_bargeDot(rec.bargeLabel, clMap)}${esc(rec.bargeLabel || '—')}</td>

        <td style="padding:9px 12px">
          <div style="display:flex;flex-direction:column;gap:4px">
            <div style="display:flex;align-items:center;gap:5px">
              <span style="font-size:9px;font-weight:700;color:var(--fuel-v);width:34px;flex-shrink:0">VLSFO</span>
              <input type="text" id="cl-bv-${uA}" value="${esc(rec.bdnV || '')}"
                ${(rec.nomV === null || rec.nomV === undefined || isLocked) ? 'disabled' : ''}
                onchange="clUpdateBdn('${uJ}','v',this.value)"
                placeholder="${(rec.nomV === null || rec.nomV === undefined) ? '—' : 'BDN No.'}"
                style="width:88px;font-size:11px;padding:5px 7px;border:none;box-shadow:var(--sh-in-xs);border-radius:5px;font-family:DM Mono,monospace;background:${(rec.nomV === null || rec.nomV === undefined) ? 'var(--surface2)' : 'var(--surface)'};outline:none;${lockStyle}">
              <input type="date" id="cl-bdv-${uA}" value="${esc(_bdnYmd(rec.bdnDateV))}" title="BDN date (VLSFO)" aria-label="BDN date (VLSFO)"
                ${(rec.nomV === null || rec.nomV === undefined || isLocked) ? 'disabled' : ''}
                onchange="clUpdateBdnDate('${uJ}','v',this.value)"
                style="width:122px;font-size:11px;padding:4px 6px;border:none;box-shadow:var(--sh-in-xs);border-radius:5px;font-family:DM Mono,monospace;background:${(rec.nomV === null || rec.nomV === undefined) ? 'var(--surface2)' : 'var(--surface)'};outline:none;${lockStyle}">
            </div>
            <div style="display:flex;align-items:center;gap:5px">
              <span style="font-size:9px;font-weight:700;color:var(--teal);width:34px;flex-shrink:0">LSMGO</span>
              <input type="text" id="cl-bm-${uA}" value="${esc(rec.bdnM || '')}"
                ${(rec.nomM === null || rec.nomM === undefined || isLocked) ? 'disabled' : ''}
                onchange="clUpdateBdn('${uJ}','m',this.value)"
                placeholder="${(rec.nomM === null || rec.nomM === undefined) ? '—' : 'BDN No.'}"
                style="width:88px;font-size:11px;padding:5px 7px;border:none;box-shadow:var(--sh-in-xs);border-radius:5px;font-family:DM Mono,monospace;background:${(rec.nomM === null || rec.nomM === undefined) ? 'var(--surface2)' : 'var(--surface)'};outline:none;${lockStyle}">
              <input type="date" id="cl-bdm-${uA}" value="${esc(_bdnYmd(rec.bdnDateM))}" title="BDN date (LSMGO)" aria-label="BDN date (LSMGO)"
                ${(rec.nomM === null || rec.nomM === undefined || isLocked) ? 'disabled' : ''}
                onchange="clUpdateBdnDate('${uJ}','m',this.value)"
                style="width:122px;font-size:11px;padding:4px 6px;border:none;box-shadow:var(--sh-in-xs);border-radius:5px;font-family:DM Mono,monospace;background:${(rec.nomM === null || rec.nomM === undefined) ? 'var(--surface2)' : 'var(--surface)'};outline:none;${lockStyle}">
            </div>
          </div>
        </td>

        <td style="padding:9px 12px">
          ${isLocked
            ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:var(--green)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>Completed</span>`
            : /* Pending until Save — Save is the one step that completes a supply. The old
                 'Completed' tick marked the row supplied without saving it, which took the
                 vessel out of barge planning on every device with nothing logged. */
              `<span style="font-size:11px;font-weight:700;color:var(--muted);white-space:nowrap">Pending</span>`}
        </td>

        <td style="padding:9px 12px">
          <input type="text" value="${esc(rec.notes||'')}" ${isLocked?'disabled':''}
            onchange="clUpdateNotes('${uJ}',this.value)"
            placeholder="Remarks…" title="Free notes. To log a dispute, press ⚠ Dispute below — the remarks are then kept as its details."
            style="font-size:11px;padding:5px 7px;border:none;box-shadow:var(--sh-in-xs);border-radius:5px;width:110px;font-family:DM Sans,sans-serif;${lockStyle}">
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">
            <button type="button" id="cl-flag-disputed-${uA}" onclick="clToggleFlag('${uJ}','disputed')" title="Mark this delivery as disputed (logged in the Delivery Log and the vessel's Track Record, with the Remarks as details). Remarks alone are never counted as a dispute."
              style="font-size:8.5px;font-weight:700;padding:2px 6px;border-radius:3px;cursor:pointer;white-space:nowrap;border:1px solid ${_clDisputeState(rec)?'var(--red-bd)':'var(--border2)'};background:${_clDisputeState(rec)?'var(--red-lt)':'transparent'};color:${_clDisputeState(rec)?'var(--red)':'var(--muted)'}">⚠ Dispute</button>
            <button type="button" id="cl-flag-unready-${uA}" onclick="clToggleFlag('${uJ}','unready')" title="Vessel arrived on time but was not ready to commence bunkering"
              style="font-size:8.5px;font-weight:700;padding:2px 6px;border-radius:3px;cursor:pointer;white-space:nowrap;border:1px solid ${rec.flagUnready?'var(--red-bd)':'var(--border2)'};background:${rec.flagUnready?'var(--red-lt)':'transparent'};color:${rec.flagUnready?'var(--red)':'var(--muted)'}">⚠ Unready</button>
            <button type="button" id="cl-flag-dispute-${uA}" onclick="clToggleFlag('${uJ}','dispute')" title="Vessel's quantity dispute claim changed/was inconsistent"
              style="font-size:8.5px;font-weight:700;padding:2px 6px;border-radius:3px;cursor:pointer;white-space:nowrap;border:1px solid ${rec.flagInconsistentDispute?'var(--red-bd)':'var(--border2)'};background:${rec.flagInconsistentDispute?'var(--red-lt)':'transparent'};color:${rec.flagInconsistentDispute?'var(--red)':'var(--muted)'}">⚠ Inconsistent</button>
          </div>
        </td>

        <td style="padding:9px 12px;white-space:nowrap">
          ${rec.state==='completed'&&rec.lockedAt
            ? '<span style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:5px;background:var(--green-lt);color:var(--green)">Completed</span>'
            : `<button class="btn-success" style="font-size:11px;padding:5px 10px;margin-right:4px" onclick="saveChecklistRecord('${uJ}')">Save</button>`}
          <button style="padding:5px 8px;background:var(--red-lt);border:1.5px solid var(--red-bd);border-radius:5px;font-size:11px;color:var(--red);cursor:pointer;font-family:DM Sans,sans-serif;font-weight:600;${isLocked?'':'margin-left:2px'}"
            onclick="deleteChecklistRecord('${uJ}')" title="Remove">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </td>
      </tr>`;
    }).join('') + '</tbody></table></div>';
}

// Update actual quantity in record (no re-render, just update state + badge)
function clUpdateActual(uid, field, val) {
  const rec = _checklistRecords[uid];
  if (!rec || rec.lockedAt) return;
  if (field === 'v') { rec.actV = val; }
  if (field === 'm') { rec.actM = val; }
  // Update deviation badge in place
  const nom = field === 'v' ? rec.nomV : rec.nomM;
  const badgeEl = document.getElementById(`cl-d${field}-${uid}`);
  if (badgeEl) badgeEl.innerHTML = _clDevBadge(val, nom, _nomRange(rec, field === 'v' ? 'V' : 'M'));
}

function clUpdateNotes(uid, val) {
  const rec = _checklistRecords[uid];
  if (!rec || rec.lockedAt) return;
  rec.notes = val;
}

// Counterparty red flags — deliberately NOT gated by rec.lockedAt like the
// rest of this row. A vessel's dispute claim quietly changing, or turning
// out they were never actually ready to bunker, is almost always something
// discovered DAYS after the delivery was already saved and locked — by
// then the row's own "Save" button is gone (replaced by a Completed
// badge), so this has to persist itself immediately rather than waiting
// for that button the way Notes/quantities do.
function clToggleFlag(uid, kind) {
  const rec = _checklistRecords[uid];
  if (!rec) return;
  if (kind === 'unready') rec.flagUnready = !rec.flagUnready;
  else if (kind === 'dispute') rec.flagInconsistentDispute = !rec.flagInconsistentDispute;
  else if (kind === 'disputed') rec.flagDispute = !_clDisputeState(rec);

  const btn = document.getElementById('cl-flag-' + kind + '-' + uid);
  if (btn) {
    const active = kind === 'unready' ? rec.flagUnready : kind === 'disputed' ? rec.flagDispute : rec.flagInconsistentDispute;
    btn.style.border = '1px solid ' + (active ? 'var(--red-bd)' : 'var(--border2)');
    btn.style.background = active ? 'var(--red-lt)' : 'transparent';
    btn.style.color = active ? 'var(--red)' : 'var(--muted)';
  }

  // If this record already has a Delivery Log entry (i.e. it was already
  // saved before this flag got toggled — whether or not it's since been
  // locked), update that entry in place so the Track Record Watchlist
  // picks it up without needing the delivery to be re-saved. This matters
  // even for an unlocked-but-already-saved record: the existing save path
  // only ever creates a bucket entry once and never refreshes it on a
  // second save, so waiting for "Save" to pick this up wouldn't work
  // either. For a record that's never been saved at all, this safely does
  // nothing — saveChecklistRecord() will pick up the flag naturally on
  // its first save.
  if (typeof _updateDeliveryLogFlags === 'function') _updateDeliveryLogFlags(rec);
  saveSharedState();
}

// Finds this record's existing Delivery Log entry (by checklistUid, across
// both the timely and delayed buckets) and updates its flags in place —
// see clToggleFlag() above for why this can't just wait for a normal save.
function _updateDeliveryLogFlags(rec) {
  let touched = false;
  Object.keys(_deliveryLog || {}).forEach(function(key) {
    const month = _deliveryLog[key];
    let logged = null;
    ['timely', 'delayed'].forEach(function(bucket) {
      _dlLive(month[bucket]).forEach(function(e) {
        if (e.checklistUid === rec.uid) {
          e.flagUnready = !!rec.flagUnready;
          e.flagInconsistentDispute = !!rec.flagInconsistentDispute;
          e.updatedAt = Date.now(); // so the merge keeps this newer copy
          logged = e;
          touched = true;
        }
      });
    });
    if (logged && typeof rec.flagDispute === 'boolean') _dlSetDispute(month, logged, rec.flagDispute, rec.notes);
  });
  if (touched) _saveDeliveryLog();
}

// The ⚠ Dispute button's current state. Records saved before the button
// existed have no flagDispute yet: they show whatever the Delivery Log
// already counts for them (see _dlIsDispute).
function _clDisputeState(rec) {
  if (!rec) return false;
  if (typeof rec.flagDispute === 'boolean') return rec.flagDispute;
  let found = false;
  Object.keys(_deliveryLog || {}).forEach(function(key) {
    _dlLive((_deliveryLog[key] || {}).disputes).forEach(function(e) { if (e.checklistUid === rec.uid && _dlIsDispute(e)) found = true; });
  });
  return found;
}

// BDN No. — stored separately per grade (bdnV for VLSFO, bdnM for LSMGO) since
// a vessel can take one or both grades in the same delivery, each with its
// own Bunker Delivery Note reference number.
function clUpdateBdn(uid, field, val) {
  const rec = _checklistRecords[uid];
  if (!rec || rec.lockedAt) return;
  if (field === 'v') { rec.bdnV = val; }
  if (field === 'm') { rec.bdnM = val; }
}
// BDN date — the date on the Bunker Delivery Note, per grade, picked from a calendar
// (date only, 'YYYY-MM-DD'). The Monthly Report shows it instead of the supply time.
function _bdnYmd(v) {
  const s = String(v || ''), m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); // no 31 Feb: the date must exist
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? s : '';
}
function clUpdateBdnDate(uid, field, val) {
  const rec = _checklistRecords[uid];
  if (!rec || rec.lockedAt) return;
  const d = _bdnYmd(val);
  if (field === 'v') rec.bdnDateV = d;
  if (field === 'm') rec.bdnDateM = d;
}

// Id of the supply record a checklist row saves. A nomination's supply gets
// the same id on every device, so the same row saved on two devices before
// they sync makes ONE record (the merge matches records — and Delivery Log
// entries — by id), and both devices bake that one id into the barge's
// opening ROB: it is deducted once. Rows without a nomination id (old
// 'v_<vessel>' rows, shared by different calls of one ship) keep a
// timestamped id, and so does a re-save once that id is taken — e.g. its
// earlier record was deleted after being folded into the opening ROB
// (_bakedSupplyIds), where the new record would never be deducted.
function _clSupplyRecordId(rec) {
  const stamped = rec.uid + '_' + Date.now();
  if (!rec.nomUid) return stamped;
  const id = 'sup_' + String(rec.nomUid).replace(/[^A-Za-z0-9_-]/g, '_');
  const taken = (_savedSupplies || []).some(r => r && r.id === id && r.checklistUid !== rec.uid) ||
    Object.keys(_bakedSupplyIds || {}).some(b => (_bakedSupplyIds[b] || []).indexOf(id) !== -1);
  return taken ? stamped : id;
}

async function saveChecklistRecord(uid) {
  const rec = _checklistRecords[uid];
  if (!rec) {
    // The row on screen is out of date: it was saved (or removed) on another
    // device and this one has synced since. Say so and show the current list.
    alert('This checklist row is no longer open — it was saved or removed on another device.\n\nThe checklist has been refreshed. Check Saved Records before entering this supply again.');
    renderChecklist(_lastSched);
    return;
  }
  // Already saved — e.g. the second click of a double-click, while the first
  // one is still saving (the row only loses its Save button after that).
  if (rec.lockedAt) return;
  // This delivery is already logged (Saved Records, or an archived month) —
  // a stale row brought back by a reload, a colleague's sync or an old
  // schedule. Saving it again would record the supply twice and deduct it
  // from the barge's ROB twice.
  if (_isScheduleItemCompleted({ nomUid: rec.nomUid || null, name: rec.vessel, bargeStart: rec.supplyDate })) {
    alert((rec.vessel || 'This vessel') + ' — this supply has already been saved (see Saved Records). It was not saved again: that would count the delivery twice and deduct it from the barge ROB twice.\n\nTo correct the quantities or BDN No., edit the saved record in Saved Records.');
    renderChecklist(_lastSched); // drops the stale row (_clDedupeRecords)
    return;
  }

  // Read from DOM first, fallback to rec state
  const inpV = document.getElementById('cl-av-' + uid);
  const inpM = document.getElementById('cl-am-' + uid);
  const inpBv = document.getElementById('cl-bv-' + uid);
  const inpBm = document.getElementById('cl-bm-' + uid);

  // Get raw values from DOM inputs
  const rawV = inpV ? inpV.value.trim() : '';
  const rawM = inpM ? inpM.value.trim() : '';

  // Use DOM value if present, else fall back to previously stored rec value
  const actV = rawV !== '' ? (parseFloat(rawV) || 0)
             : (rec.actV !== '' && rec.actV !== undefined ? (parseFloat(rec.actV) || 0) : 0);
  const actM = rawM !== '' ? (parseFloat(rawM) || 0)
             : (rec.actM !== '' && rec.actM !== undefined ? (parseFloat(rec.actM) || 0) : 0);

  // Save is final (locks the row, removes the nomination) — a click with
  // no actual quantity entered must not silently log a 0/0 supply. Require
  // an explicit confirmation (Cancel is the default) for a zero delivery.
  if (!(actV > 0) && !(actM > 0)) {
    if (!confirm('No actual quantity entered for ' + (rec.vessel || 'this vessel') + '.\n\nRecord a ZERO delivery (0 MT VLSFO, 0 MT MGO)? This locks the record and removes the nomination.\n\nPress Cancel to go back and enter the actual quantities.')) return;
  } else {
    // One grade nominated but its actual box left empty (the grey number in it is
    // only the nomination): reports would count 0 MT for it — ask first.
    const blankNom = [];
    if (rawV === '' && !(actV > 0) && parseFloat(rec.nomV) > 0) blankNom.push('VLSFO (nominated ' + rec.nomV + ' MT)');
    if (rawM === '' && !(actM > 0) && parseFloat(rec.nomM) > 0) blankNom.push('LSMGO (nominated ' + rec.nomM + ' MT)');
    if (blankNom.length && !confirm('No actual quantity entered for ' + blankNom.join(' and ') + ' — ' + (rec.vessel || 'this vessel') + '.\n\nSave it as 0 MT supplied? Reports count the ACTUAL quantity, not the nomination.\n\nPress Cancel to go back and enter it.')) return;
  }

  // Always sync back to rec so state is consistent
  rec.actV = String(actV);
  rec.actM = String(actM);
  rec.bdnV = inpBv ? inpBv.value.trim() : (rec.bdnV || '');
  rec.bdnM = inpBm ? inpBm.value.trim() : (rec.bdnM || '');
  const inpBdv = document.getElementById('cl-bdv-' + uid), inpBdm = document.getElementById('cl-bdm-' + uid);
  rec.bdnDateV = inpBdv ? _bdnYmd(inpBdv.value) : _bdnYmd(rec.bdnDateV);
  rec.bdnDateM = inpBdm ? _bdnYmd(inpBdm.value) : _bdnYmd(rec.bdnDateM);

  // Also update input display to confirm what was captured
  if (inpV) inpV.value = actV > 0 ? actV : (inpV.value || '');
  if (inpM) inpM.value = actM > 0 ? actM : (inpM.value || '');

  // Resolve area label for display
  const _areaLabel = (typeof AREA_OPTIONS !== 'undefined' && rec.area)
    ? (AREA_OPTIONS.find(o => o.value === rec.area)?.label || rec.area)
    : (rec.area || '—');

  // State: every click of Save/Update completes and locks the record
  // immediately — entering the actual supplied quantity and pressing
  // Save IS the operator's confirmation that the supply happened. There
  // is no separate "tick Pending, then Save" step; one click is final.
  // This MUST happen before supplyRec is built below — supplyRec takes a
  // snapshot of rec.supplied at the moment it's constructed, so setting
  // rec.supplied afterward had no effect on the already-built object,
  // which is why saved records kept showing "Pending" even though the
  // checklist itself correctly marked the row as completed.
  rec.supplied = true;
  rec.state    = 'completed';
  rec.lockedAt = new Date().toISOString();
  rec.actV     = String(actV);
  rec.actM     = String(actM);

  // supplyDate is an ISO string once the record has been through a JSON
  // reload/sync — fmt24() needs a Date, or dateStr was persisted as '—'.
  const _sDate = rec.supplyDate ? new Date(rec.supplyDate) : null;
  const _sDateOk = !!(_sDate && !isNaN(_sDate.getTime()));
  const supplyRec = {
    id: _clSupplyRecordId(rec),  // one id per nomination's supply — see _clSupplyRecordId
    checklistUid: uid,         // FT84 FIX (Issue 3): enables delete by ChecklistID only
    nomUid: rec.nomUid || null, // the nomination supplied — completion is tracked per nomination
    savedAt: new Date().toISOString(),
    vessel: rec.vessel,
    area: _areaLabel,
    areaCode: rec.area || '',
    dateStr: _sDateOk ? fmt24(_sDate) : fmt24(new Date()),
    supplyDate: _sDateOk ? _sDate.toISOString() : new Date().toISOString(),
    vlsfoNom: rec.nomV,
    mgoNom:   rec.nomM,
    vlsfoAct: actV,
    mgoAct:   actM,
    bdnV:     rec.bdnV || '',
    bdnM:     rec.bdnM || '',
    bdnDateV: _bdnYmd(rec.bdnDateV),
    bdnDateM: _bdnYmd(rec.bdnDateM),
    barge:    rec.bargeLabel || '',
    notes:    rec.notes || '',
    supplied: true,
  };
  if (_stsOf(_stsLookup(), rec)) supplyRec.sts = true;   // ship-to-ship supply (the nomination's card says; the record's own stamp if the card is gone)

  // Replace existing saved record for this exact checklist entry (stable uid),
  // never by vessel+date — date formatting can shift between schedule runs and
  // previously caused duplicate Saved Supply rows for the same checklist record.
  const _replaced = _savedSupplies.filter(r => r.checklistUid === uid);
  _savedSupplies = _savedSupplies.filter(r => r.checklistUid !== uid);
  _replaced.forEach(r => _correctBakedSupply(r, null, 'replaced by a new save')); // the new record is deducted instead
  _savedSupplies.push(supplyRec);
  // …and so does an archived copy of the same checklist row (it would come back in
  // the reports as a second delivery as soon as one of the two copies is edited).
  const _gone = typeof _dropArchivedCopies === 'function' ? _dropArchivedCopies(supplyRec) : [];
  _withSupersedes(supplyRec, Array.from(_supersededIds(_replaced)).concat(_gone));
  if (_gone.length) { try { saveArchives(); } catch (e) {} }

  // Delivery Log — automatic Timely/Delayed classification + Dispute
  // capture from Remarks, exactly at the moment this supply is saved.
  _logDelivery(rec, supplyRec);

  // Completed records are kept in _checklistRecords (marked state:'completed',
  // lockedAt set) rather than deleted. injectChecklistFromSchedule() already
  // checks for an existing completed/supplied record before creating a new
  // one for the same vessel, so duplicates on re-schedule/reload are already
  // prevented at the injection point — deleting here was unnecessary and
  // broke the Remaining Supply Tracker, which needs completed records to
  // still be present in order to show their "Done" status and correctly
  // deduct them from the running ROB total.

  // Remove THIS nomination from the Vessel Nomination Register immediately —
  // by nomUid, so a second nomination of the same vessel survives.
  removeNominationByUid(rec.nomUid, rec.vessel);

  await saveSharedRecords();
  renderSavedRecords();
  renderLiveROBDashboard();
  renderChecklist(_lastSched);
  if(typeof renderRemainingSupplyTracker==="function")renderRemainingSupplyTracker();
  // Remove saved vessel from Voyage Schedule immediately
  if(_lastSched&&_lastSched.length&&typeof renderBargeTabsAndTL==="function"){
    var br=[];
    if(typeof getBarges==="function") br=getBarges();
    if(!br||!br.length) br=(_bargeConfig||[]).map(function(b){return {id:b.id,name:b.name};});
    if(br&&br.length) renderBargeTabsAndTL(_lastSched,br);
  }
  showToast(rec.vessel + ' — supply logged (VLSFO ' + Math.round(actV).toLocaleString() + ' MT, MGO ' + Math.round(actM).toLocaleString() + ' MT)', 'success');
}

function deleteChecklistRecord(uid) {
  // FT84 FIX (Issue 3): Delete targets ChecklistID (uid) ONLY.
  // Never uses sno, array index, or vessel name as the deletion key.
  const rec = _checklistRecords[uid];
  if (!rec) return;
  if (rec.state==='completed'&&rec.lockedAt){
    if(!confirm('Completed record for ' + rec.vessel + '. Delete anyway?'))return;
    // Remove the single matching saved supply for this uid (not all records for this vessel)
    const keep=function(r){return r.id!==uid&&!(r.vessel===rec.vessel&&r.checklistUid===uid);};
    const gone=_savedSupplies.filter(function(r){return !keep(r);});
    _savedSupplies=_savedSupplies.filter(keep);
    gone.forEach(function(r){_correctBakedSupply(r,null,'deleted');}); // its quantity goes back on the barge's ROB
    // …and its Delivery Log entries (timely/delayed/disputes), which would
    // otherwise keep counting a deleted supply in the Delivery Log and the
    // vessel's Track Record.
    _removeDeliveryLogEntries(uid);
    saveSharedRecords();renderSavedRecords();
    if (typeof renderDeliveryLog === 'function') { try { renderDeliveryLog(); } catch (e) {} }
    delete _checklistRecords[uid];
    // DO NOT touch _checklist[sno] — sno is positional and may refer to a different vessel after a re-run
    renderChecklist(_lastSched);
    return;
  }
  if(!confirm('Remove '+rec.vessel+' from checklist?'))return;
  delete _checklistRecords[uid];
  // DO NOT touch _checklist[sno] — positional index is not a safe deletion key
  renderChecklist(_lastSched);
}

// Remove a nomination card from the Vessel Nomination Register by its
// permanent nomUid (removeNominationByName removes the FIRST card with that
// vessel name — which could be a different, later nomination of the same
// vessel). Falls back to the name match only for legacy records without a
// nomUid.
function removeNominationByUid(nomUid, vesselName) {
  if (!nomUid) {
    if (typeof removeNominationByName === 'function') removeNominationByName(vesselName);
    return;
  }
  const cards = document.querySelectorAll('.vcard[id^="vessel-"]');
  for (let i = 0; i < cards.length; i++) {
    if (cards[i].dataset.nomUid === nomUid) {
      cards[i].remove();
      if (typeof renumberVessels === 'function') renumberVessels();
      if (typeof saveSharedState === 'function') saveSharedState();
      return;
    }
  }
}

// Drop every Delivery Log entry (all months/buckets) for a checklist uid.
// Splices the entries out and records a tombstone per month (see _dlLive),
// so a sync with a device that still has them doesn't bring them back.
function _removeDeliveryLogEntries(checklistUid) {
  let touched = false;
  if (!checklistUid) return false;
  const now = Date.now();
  Object.keys(_deliveryLog || {}).forEach(function(key) {
    const month = _deliveryLog[key];
    let hit = false;
    ['timely', 'delayed', 'disputes'].forEach(function(bucket) {
      if (!month || !Array.isArray(month[bucket])) return;
      const before = month[bucket].length;
      month[bucket] = month[bucket].filter(function(e) { return !e || e.checklistUid !== checklistUid; });
      if (month[bucket].length !== before) hit = true;
    });
    if (hit) { _dlTombstone(month, checklistUid, now); touched = true; }
  });
  if (touched) _saveDeliveryLog();
  return touched;
}

