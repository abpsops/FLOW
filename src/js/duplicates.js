/* ─── DUPLICATE DETECTION ────────────────────────────────────────────
   Root of the "doubled records / inflated totals" issue: a supply can
   end up saved twice — e.g. a checklist entry gets a new internal uid
   after a schedule is regenerated (its computed supply time shifts by
   a few hours), so the exact-id-based dedupe elsewhere in this file
   never recognizes it as the same delivery. The two rows then look
   like "MT KARACHI" vs "M T KARACHI" on the same day with identical
   quantities, or the exact same row twice — same vessel, same day,
   same MT figures, just a different save-time or a cosmetic spelling
   difference. This fuzzy key catches that pattern: normalize the
   vessel name (strip spaces/punctuation and any "MT"/"M/T" prefix) and
   compare same-vessel + same-calendar-day + matching VLSFO/MGO
   quantities — the parts that would only match by coincidence if two
   different real-world deliveries happened to tie exactly. ────────── */
function _normVesselKey(name) {
  return (name || '')
    .toUpperCase()
    .replace(/\bM\s*\.?\s*\/?\s*T\s*\.?\b/g, '')  // strip MT / M/T / M.T. tokens anywhere
    .replace(/[^A-Z0-9]/g, '');                    // strip remaining spaces/punctuation
}
function _recordDedupeKey(r) {
  const day = r.supplyDate ? _parseDateLocal(r.supplyDate).toDateString() : (r.dateStr || '');
  const v = Math.round(_recActQty(r, 'v') * 100) / 100;
  const m = Math.round(_recActQty(r, 'm') * 100) / 100;
  // Barge is part of the key: a vessel taking the same quantity from two
  // barges on one day is a real split delivery, not a duplicate.
  const barge = String(r.barge || r.bargeLabel || '').trim().toUpperCase().replace(/\s+/g, ' ');
  return _normVesselKey(r.vessel || r.name) + '|' + day + '|' + v + '|' + m + '|' + barge;
}
async function removeDuplicateSavedRecords() {
  const sorted = [..._savedSupplies].sort((a, b) => new Date(a.savedAt || 0) - new Date(b.savedAt || 0));
  const seen = new Map();
  const deduped = [];
  const removedList = [];
  // Saved twice from the same checklist row (two devices, or a re-save) = one delivery,
  // whatever the quantities: keep the most recently saved / edited copy.
  const isOlderCopy = r => r.checklistUid && sorted.some(o => o !== r && new Date(o.savedAt || 0) >= new Date(r.savedAt || 0) && sorted.indexOf(o) > sorted.indexOf(r) && _sameDelivery(o, r));
  sorted.forEach(r => {
    if (isOlderCopy(r)) { removedList.push(r); return; }
    const key = _recordDedupeKey(r);
    if (!key.replace(/\|/g, '')) { deduped.push(r); return; } // nothing to key on — keep, don't guess
    if (seen.has(key)) { removedList.push(r); return; }
    seen.set(key, true);
    deduped.push(r);
  });
  if (!removedList.length) { alert('No duplicate records found — every saved record has a unique vessel, day, quantity and barge combination.'); return; }
  const preview = removedList.slice(0, 8).map(r => `• ${r.vessel || '—'} — ${r.dateStr || '—'} — VLSFO ${(r.vlsfoAct||0).toLocaleString()} MT / MGO ${(r.mgoAct||0).toLocaleString()} MT`).join('\n');
  const more = removedList.length > 8 ? `\n…and ${removedList.length - 8} more` : '';
  if (!confirm(`Found ${removedList.length} duplicate record(s) — saved twice from the same checklist row (the latest copy is kept), or the same vessel, day, quantities and barge (the earliest copy is kept). These will be removed:\n\n${preview}${more}\n\nThis updates the shared workspace for everyone. Continue?`)) return;
  _savedSupplies = deduped;
  removedList.forEach(r => _correctBakedSupply(r, null, 'removed as a duplicate'));
  await saveSharedRecords();
  renderSavedRecords();
  renderLiveROBDashboard();
  showToast(`Removed ${removedList.length} duplicate record(s).`, 'success');
}

/* A saved record's quantity as the reports count it: the ACTUAL (an actual of 0 is
   real — reports never fall back to the nomination). A 0 actual with a nomination
   says so, so the list never shows a figure the reports don't use. */
function _srQtyTxt(r, g) {
  const act = _recActQty(r, g), nom = parseFloat(g === 'v' ? r.vlsfoNom : r.mgoNom) || 0;
  if (!r.supplied) return (nom ? nom.toLocaleString() : '0') + ' MT <span style="font-weight:400;color:var(--muted)">(nominated)</span>';
  return act.toLocaleString() + ' MT' + (!(act > 0) && nom > 0 ? ' <span style="font-weight:400;color:var(--amber)">(nominated ' + nom.toLocaleString() + ' MT — actual not entered)</span>' : '');
}
// Report views on screen follow a record change (edit here, or a colleague's via sync).
function _refreshReportViews() {
  const mm = document.getElementById('monthly-modal');
  if (mm && mm.style.display === 'flex' && typeof renderMonthlyPreview === 'function') { try { renderMonthlyPreview(); } catch (e) {} }
  if (typeof _currentPage === 'undefined') return;
  if (_currentPage === 'reports' && typeof refreshReports === 'function') { try { refreshReports(); } catch (e) {} }
  if (_currentPage === 'dashboard' && typeof refreshDashboard === 'function') { try { refreshDashboard(); } catch (e) {} }
}
function renderSavedRecords() {
  const el = document.getElementById('saved-records-list'); if (!el) return;
  if (!_savedSupplies.length) {
    el.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:12px 0;text-align:center">No saved records yet. Click "Save ✓" in the checklist to save supply records.</div>';
    return;
  }
  const srMap = _bargeColorMap();
  el.innerHTML = [..._savedSupplies].sort((a,b) => new Date(a.supplyDate) - new Date(b.supplyDate)).map(r => `
    <div class="saved-record-row${r.sts ? ' is-sts' : ''}" id="srrow-${esc(r.id)}">
      <div class="saved-record-info">
        <div class="saved-record-vessel">
          ${esc(r.vessel)}${_stsTag(r)}
          <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;background:${r.supplied?'var(--green-lt)':'var(--amber-lt)'};color:${r.supplied?'var(--green)':'var(--amber)'};border:1px solid ${r.supplied?'var(--green-bd)':'var(--amber-bd)'}">${r.supplied?'Completed':'Pending'}</span>
        </div>
        <div class="saved-record-meta">
           ${esc(r.dateStr)} &nbsp;|&nbsp;  ${_bargeDot(r.barge, srMap)}${esc(r.barge||'—')} &nbsp;|&nbsp;
          VLSFO: <strong>${_srQtyTxt(r, 'v')}</strong> &nbsp;|&nbsp;
          MGO: <strong>${_srQtyTxt(r, 'm')}</strong>
          ${r.agent ? `&nbsp;|&nbsp; Agent: ${esc(r.agent)}` : ''}
          ${r.spec  ? `&nbsp;|&nbsp; ${esc(r.spec)}` : ''}
        </div>
        ${(r.bdnV || r.bdnM) ? `<div class="saved-record-bdn" style="font-size:11px;color:var(--sub);margin-top:3px">BDN No.: ${[r.bdnV ? 'VLSFO <strong>' + esc(r.bdnV) + '</strong>' : '', r.bdnM ? 'LSMGO <strong>' + esc(r.bdnM) + '</strong>' : ''].filter(Boolean).join(' &nbsp;|&nbsp; ')}</div>` : ''}
        ${r.notes?`<div style="font-size:11px;color:var(--sub);margin-top:3px"> ${esc(r.notes)}</div>`:''}
        <div style="font-size:10px;color:var(--muted);margin-top:3px">Saved: ${new Date(r.savedAt).toLocaleString()}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;align-items:center">
        <button class="btn-ghost" style="font-size:11px;padding:5px 12px;border-color:var(--azure);color:var(--azure)" onclick="openEditRecord('${escJs(r.id)}')"> Edit</button>
        <button class="btn-danger" style="font-size:11px;padding:5px 10px" onclick="deleteRecord('${escJs(r.id)}')"> Delete</button>
      </div>
    </div>`).join('');
}

let _editingRecordId = null, _editingOrig = null, _editingShown = null;
const _ER_FIELDS = ['vessel', 'barge', 'agent', 'spec', 'dateStr', 'vlsfoAct', 'mgoAct', 'bdnV', 'bdnM', 'notes', 'supplied'];
function _erFormValues() {
  const g = function(id) { const el = document.getElementById(id); return el ? String(el.value == null ? '' : el.value) : ''; };
  return {
    vessel: g('er-vessel').trim(), barge: g('er-barge').trim(), agent: g('er-agent').trim(), spec: g('er-spec').trim(),
    dateStr: g('er-date').trim(), vlsfoAct: parseFloat(g('er-vlsfo-act')) || 0, mgoAct: parseFloat(g('er-mgo-act')) || 0,
    bdnV: g('er-bdn-v').trim().slice(0, 60), bdnM: g('er-bdn-m').trim().slice(0, 60), notes: g('er-notes').trim(), supplied: g('er-supplied') === 'yes',
  };
}
// A record's value for one dialog field, the way the dialog reads it.
function _erRecVal(r, k) {
  if (k === 'vlsfoAct') return _recActQty(r, 'v');
  if (k === 'mgoAct') return _recActQty(r, 'm');
  if (k === 'supplied') return !!r.supplied;
  return String(r[k] == null ? '' : r[k]).trim();
}
function openEditRecord(id) {
  const r = _savedSupplies.find(x => x.id === id); if (!r) return;
  _editingRecordId = id;
  document.getElementById('er-vessel').value    = r.vessel    || '';
  document.getElementById('er-barge').value     = r.barge     || '';
  document.getElementById('er-agent').value     = r.agent     || '';
  document.getElementById('er-spec').value      = r.spec      || '';
  document.getElementById('er-date').value      = r.dateStr   || '';
  document.getElementById('er-vlsfo-nom').value = r.vlsfoNom  || 0;
  document.getElementById('er-vlsfo-act').value = _recActQty(r, 'v');
  document.getElementById('er-mgo-nom').value   = r.mgoNom    || 0;
  document.getElementById('er-mgo-act').value   = _recActQty(r, 'm');
  document.getElementById('er-bdn-v').value     = r.bdnV      || '';
  document.getElementById('er-bdn-m').value     = r.bdnM      || '';
  document.getElementById('er-notes').value     = r.notes     || '';
  document.getElementById('er-supplied').value  = r.supplied ? 'yes' : 'no';
  // What the dialog showed: Save writes only what the user changed from this, onto the
  // record as it is THEN (a colleague's change made meanwhile is kept, or asked about).
  _editingOrig = JSON.parse(JSON.stringify(r));
  _editingShown = _erFormValues();
  _erSession = { id: id, saving: false };
  const diffEl = document.getElementById('er-diff');
  if (diffEl) { diffEl.style.display = 'none'; document.getElementById('er-diff-rows').innerHTML = ''; }
  document.getElementById('edit-record-modal').style.display = 'flex';
}
function closeEditRecord() { document.getElementById('edit-record-modal').style.display = 'none'; _editingRecordId = null; _editingOrig = null; _editingShown = null; _erSession = null; }
// One per opened dialog: a second click on Save while its save is in flight does nothing,
// and a save that finishes after the dialog was closed (or another record opened) leaves it alone.
let _erSession = null;
async function saveEditRecord() {
  const s = _erSession;
  if (!_editingRecordId || !s || s.saving) return;
  s.saving = true;
  try { await _saveEditRecord(s); } finally { s.saving = false; }
}
async function _saveEditRecord(s) {
  const idx = _savedSupplies.findIndex(x => x.id === _editingRecordId);
  if (idx === -1) { alert('This record was removed meanwhile (by you or a colleague) — nothing was saved.'); closeEditRecord(); return; }
  const savedId = _editingRecordId;
  const cur = _savedSupplies[idx], orig = _editingOrig || cur, shown = _editingShown || _erFormValues();
  const now = _erFormValues();
  // The fields the user changed in the dialog.
  const changed = _ER_FIELDS.filter(function(k) { return JSON.stringify(now[k]) !== JSON.stringify(shown[k]); });
  if (!changed.length) { closeEditRecord(); return; }
  const upd = {};
  changed.forEach(function(k) { upd[k] = now[k]; });
  if (!upd.vessel && changed.indexOf('vessel') >= 0) delete upd.vessel; // a name can't be emptied
  // A changed supply date moves the record to that day (the month the reports file it under).
  if (changed.indexOf('dateStr') >= 0) {
    const d = now.dateStr ? parseDT(now.dateStr) : null;
    if (!d) { alert('Supply date not understood — use e.g. 07 Oct 2026 05:57.'); return; }
    upd.supplyDate = d.toISOString();
    upd.dateStr = fmt24(d);
  }
  // A colleague changed the same field after this dialog was opened: ask before overwriting.
  const clash = changed.filter(function(k) { return k !== 'dateStr' && JSON.stringify(_erRecVal(cur, k)) !== JSON.stringify(_erRecVal(orig, k)); });
  if (changed.indexOf('dateStr') >= 0 && (cur.supplyDate !== orig.supplyDate || cur.dateStr !== orig.dateStr)) clash.push('dateStr');
  if (clash.length && !confirm('Someone else changed ' + clash.join(', ') + ' of this record while you were editing (now: ' +
      clash.map(function(k) { return k + ' = ' + _erRecVal(cur, k); }).join(', ') + ').\n\nSave your values anyway?')) return;
  const saved = _savedSupplies[idx] = Object.assign({}, cur, upd, { savedAt: new Date().toISOString() });
  // Already baked into a barge's opening ROB: live ROB follows the new quantity / barge.
  _correctBakedSupply(cur, saved);
  // A new date or vessel name can stop an archived copy of this delivery matching it
  // (_sameDelivery), and the reports would count that copy again: drop such copies now.
  const gone = (upd.supplyDate || upd.vessel) ? _dropArchivedCopies(cur) : [];
  if (gone.length) { _withSupersedes(saved, gone); try { saveArchives(); } catch (e) {} }
  // The checklist row this supply was saved from keeps the same BDN numbers
  // (the checklist Excel export reads them from there). A 'v_<vessel>' row is shared by
  // the ship's calls: only when it is still this call's row.
  const _cr = saved.checklistUid && _checklistRecords ? _checklistRecords[saved.checklistUid] : null;
  if (_cr && (String(saved.checklistUid).indexOf('v_') !== 0 ||
      _sameDelivery(Object.assign({}, _cr, { checklistUid: saved.checklistUid, supplyDate: _cr.supplyDate || _cr.lockedAt }), cur))) {
    _cr.bdnV = saved.bdnV || ''; _cr.bdnM = saved.bdnM || '';
  }
  await saveSharedRecords();
  if (_erSession === s) closeEditRecord();
  renderSavedRecords();
  renderLiveROBDashboard();
  _refreshReportViews();
  showToast('Record updated for ' + (saved.vessel || 'vessel'), 'success');
  setTimeout(() => {
    const row = document.getElementById(`srrow-${savedId}`);
    if (row) { row.style.transition='background .2s'; row.style.background='var(--green-lt)'; setTimeout(()=>{ row.style.background=''; },1400); }
  }, 60);
}
function updateEditDiff() {
  if (!_editingRecordId) return;
  const r = _savedSupplies.find(x => x.id === _editingRecordId); if (!r) return;
  // Only what the user changed in this dialog (Save writes nothing else), from the record
  // as it is now — a colleague's change synced in meanwhile is not shown as being undone.
  const now = _erFormValues(), shown = _editingShown || now;
  const edited = function(k) { return JSON.stringify(now[k]) !== JSON.stringify(shown[k]) && JSON.stringify(now[k]) !== JSON.stringify(_erRecVal(r, k)); };
  const diffs = [];
  [['vlsfoAct', 'v', 'VLSFO', 'var(--fuel-v)'], ['mgoAct', 'm', 'MGO', 'var(--fuel-m)']].forEach(function(q) {
    if (!edited(q[0])) return;
    const was = _recActQty(r, q[1]), to = now[q[0]], d = to - was;
    diffs.push(`<div style="display:flex;align-items:center;gap:8px"><span style="width:10px;height:10px;border-radius:50%;background:${q[3]};flex-shrink:0"></span><span>${q[2]}: <strong>${was.toLocaleString()} MT</strong> → <strong style="color:${q[3]}">${to.toLocaleString()} MT</strong> <span style="color:${d>0?'var(--green)':'var(--red)'};font-weight:700">(${d>0?'+':''}${d.toLocaleString()} MT)</span></span></div>`);
  });
  [['bdnV', 'VLSFO', 'var(--fuel-v)'], ['bdnM', 'LSMGO', 'var(--fuel-m)']].forEach(function(b) {
    if (edited(b[0])) diffs.push(`<div style="display:flex;align-items:center;gap:8px"><span style="width:10px;height:10px;border-radius:50%;background:${b[2]};flex-shrink:0"></span><span>BDN No. (${b[1]}): <strong>${esc(r[b[0]] || '—')}</strong> → <strong style="color:${b[2]}">${esc(now[b[0]] || '—')}</strong></span></div>`);
  });
  if (edited('supplied')) diffs.push(`<div style="display:flex;align-items:center;gap:8px"><span style="width:10px;height:10px;border-radius:50%;background:var(--amber);flex-shrink:0"></span><span>Status: <strong>${r.supplied?'Completed':'Pending'}</strong> → <strong style="color:${now.supplied?'var(--green)':'var(--amber)'}">${now.supplied?'Completed':'Pending'}</strong></span></div>`);
  const diffEl = document.getElementById('er-diff'), rowEl = document.getElementById('er-diff-rows');
  if (diffs.length) { diffEl.style.display='block'; rowEl.innerHTML=diffs.join(''); }
  else { diffEl.style.display='none'; rowEl.innerHTML=''; }
}
async function deleteRecord(id) {
  if (!id) { alert('Cannot delete — record has no ID. Use Edit to find and remove it.'); return; }
  const rec = _savedSupplies.find(r => r.id === id);
  const name = rec ? rec.vessel : 'this record';
  if (!confirm(`Delete supply record for ${name}?\n\nThis removes it from Saved Records, Monthly Report, and Analytics.`)) return;
  _savedSupplies = _savedSupplies.filter(r => r.id !== id);
  _correctBakedSupply(rec, null, 'deleted'); // its quantity goes back on the barge's ROB
  // Re-open ONLY the checklist row this record came from (checklistUid, or
  // the nomination's nomUid). Matching on vessel name reset every row of a
  // vessel with repeat calls. Legacy records with neither link fall back to
  // same vessel + same supply day.
  const _sameDay = (a, b) => a && b && _parseDateLocal(a).toDateString() === _parseDateLocal(b).toDateString();
  Object.values(_checklistRecords).forEach(cr => {
    if (!rec) return;
    const linked = rec.checklistUid ? cr.uid === rec.checklistUid
      : rec.nomUid ? cr.nomUid === rec.nomUid
      : (cr.vessel === rec.vessel && _sameDay(cr.supplyDate, rec.supplyDate));
    if (linked) {
      cr.state = 'draft'; cr.lockedAt = null; cr.actV = 0; cr.actM = 0; cr.supplied = false;
    }
  });
  // The deleted supply must stop counting in the Delivery Log / Track Record
  // too (tombstoned, so sync doesn't bring it back; re-saving re-logs it).
  if (rec && rec.checklistUid && typeof _removeDeliveryLogEntries === 'function') {
    _removeDeliveryLogEntries(rec.checklistUid);
    if (typeof renderDeliveryLog === 'function') { try { renderDeliveryLog(); } catch (e) {} }
  }
  await saveSharedRecords();
  renderSavedRecords();
  renderLiveROBDashboard();
  renderRemainingSupplyTracker();
  // Refresh reports/analytics page if visible
  if (typeof renderMonthlyPreview === 'function') renderMonthlyPreview(_savedSupplies);
  if (typeof renderReportCharts === 'function') renderReportCharts(_savedSupplies);
  // Flash feedback
  const row = document.getElementById(`rep-row-${id}`);
  if (row) { row.style.transition='opacity .3s'; row.style.opacity='0'; setTimeout(()=>row.remove(),300); }
}
async function confirmClearAllRecords() {
  if (isTrader()) return;
  if (!_savedSupplies.length) { alert('No saved records to clear.'); return; }
  const n = _savedSupplies.length;
  const ok = await _typedConfirm({
    title: 'Clear Saved Records', word: 'DELETE', action: 'Delete ' + n + ' record' + (n === 1 ? '' : 's'),
    intro: 'Deletes every saved supply record from the shared workspace — they disappear from Saved Records, the Monthly Report and Analytics on every device. This cannot be undone.',
    deletes: ['All ' + n + ' saved supply record' + (n === 1 ? '' : 's')],
    keeps: ['Nominations, barges, schedule and checklist', 'Monthly and fiscal-year archives']
  });
  if (!ok) return;
  return clearAllSavedRecords();
}
// Runs only via confirmClearAllRecords().
async function clearAllSavedRecords() {
  _savedSupplies = [];
  await saveSharedRecords();
  renderSavedRecords();
}
async function saveSupplyRecord(sno) {
  // Find the record by sno (uid is compound: sno + vessel slug)
  const rec = Object.values(_checklistRecords).find(function(r){ return r.sno === sno; });
  if (rec) {
    await saveChecklistRecord(rec.uid);
  }
}



