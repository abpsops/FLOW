/* ─── ARCHIVES ───────────────────────────────────────────────────────
   BUG FOUND: _archives was declared and used everywhere but NEVER saved
   to localStorage or the cloud, and NEVER loaded back on init(). It only
   ever existed as a plain JS variable for the current page session — the
   instant the tab closed or the app reloaded, every archived month was
   gone, with no wipe/clear action involved at all. saveArchives() /
   loadArchives() below fix that: archives now persist locally and sync
   to the cloud like every other dataset, and only disappear via an
   explicit Clear All Data or Wipe Cloud action. ───────────────────── */
const ARCHIVES_KEY = 'abps_archives';
var _archives={};

function saveArchives() {
  try { localStorage.setItem(ARCHIVES_KEY, JSON.stringify(_archives)); }
  catch(e) {
    // Used to be swallowed silently — a full localStorage (quota) meant the
    // archive simply wasn't kept on this device with no sign anything failed.
    console.error('saveArchives failed:', e);
    if (typeof showToast === 'function') showToast('Could not save archives on this device (' + ((e && e.name === 'QuotaExceededError') ? 'browser storage is full' : (e && e.message) || 'storage error') + '). They are still synced to the shared workspace.', 'warning', 8000);
  }
}

/* Archive tombstones: deleting an archived month leaves
   _archives[yr][mon] = { deleted:true, deletedAt } instead of removing the
   key, so the additive cloud merge below can tell "deleted here" apart from
   "never seen here" and doesn't resurrect it from another device's copy.
   Every reader must skip tombstones — use _isLiveArchive / _liveArchiveEntries. */
function _isLiveArchive(a) {
  return !!(a && !a.deleted && Array.isArray(a.records));
}
function _liveArchiveEntries() {
  const out = [];
  Object.keys(_archives || {}).forEach(function(yr) {
    const yObj = _archives[yr] || {};
    Object.keys(yObj).forEach(function(mon) {
      if (_isLiveArchive(yObj[mon])) out.push({ yr: yr, mon: mon, arch: yObj[mon] });
    });
  });
  return out;
}
function _archiveStamp(a) {
  const t = a ? Date.parse(a.deleted ? a.deletedAt : (a.updatedAt || a.archivedAt)) : NaN;
  return isNaN(t) ? 0 : t;
}
// Key used to dedupe rows inside one archive: the record id when there is
// one, otherwise the fuzzy vessel/day/qty/barge key.
function _archiveRowKey(r) {
  return r && r.id ? 'id:' + r.id : 'k:' + _recordDedupeKey(r || {});
}
function _mergeArchiveRecords(existing, incoming) {
  const out = (existing || []).slice();
  const idx = new Map();
  out.forEach(function(r, i) { idx.set(_archiveRowKey(r), i); });
  let added = 0, replaced = 0;
  (incoming || []).forEach(function(r) {
    const k = _archiveRowKey(r);
    if (idx.has(k)) {
      // Same record id: keep the newer copy (savedAt — an edit re-stamps it), so an
      // edited row re-archived elsewhere is not lost to an old cached copy.
      if (r && r.id) {
        const i = idx.get(k), cur = out[i];
        const tIn = Date.parse((r && r.savedAt) || '') || 0, tCur = Date.parse((cur && cur.savedAt) || '') || 0;
        if (tIn >= tCur && JSON.stringify(r) !== JSON.stringify(cur)) { out[i] = r; replaced++; }
      }
      return;
    }
    idx.set(k, out.length); out.push(r); added++;
  });
  return { records: out, added: added, replaced: replaced };
}
/* Two supply records are the SAME delivery: same checklist row AND provably the same
   call — same nomination (nomUid), or, without nomUids, the same vessel at the same
   supply time (to the minute). Checklist rows made before nomUids existed were named
   'v_<vessel>', so different calls of one ship share that checklistUid — and two calls
   can be a day or two apart: never guess from a date window (this decides deletions). */
function _sameDelivery(a, b) {
  if (!a || !b || !a.checklistUid || a.checklistUid !== b.checklistUid) return false;
  if (a.nomUid && b.nomUid) return a.nomUid === b.nomUid;
  const ta = a.supplyDate ? _parseDateLocal(a.supplyDate).getTime() : NaN, tb = b.supplyDate ? _parseDateLocal(b.supplyDate).getTime() : NaN;
  const nv = function(r) { return String((r && (r.vessel || r.name)) || '').trim().toLowerCase().replace(/\s+/g, ' '); };
  return !isNaN(ta) && !isNaN(tb) && Math.floor(ta / 60000) === Math.floor(tb / 60000) && nv(a) === nv(b);
}
// Two copies are PROVABLY one delivery — safe to delete one: the same record id, or the same
// nomination on the same checklist row. Rows without nomUids (saved before 12 Oct 2026) are
// never deleted on a match: the reports skip the older copy instead (see _getAllReportRecords).
function _provablySameDelivery(a, b) {
  return !!(a && b && ((a.id && a.id === b.id) || (a.nomUid && b.nomUid && _sameDelivery(a, b))));
}
// Archived copies of the delivery `supplyRec` (see _sameDelivery): removed when provably the
// same (_provablySameDelivery), kept otherwise. Returns all their ids — the caller lists them
// in the record's `supersedes`, so the reports skip them, also when a copy another device
// still has (archives merge as a union) syncs back.
// A row with supplyRec's own id is left to _mergeArchiveRecords (the newer copy wins).
function _dropArchivedCopies(supplyRec) {
  const checklistUid = supplyRec && supplyRec.checklistUid;
  if (!checklistUid || typeof _archives !== 'object' || !_archives) return [];
  const gone = [];
  Object.keys(_archives).forEach(function(yr) {
    const y = _archives[yr];
    if (!y || typeof y !== 'object') return;
    Object.keys(y).forEach(function(mon) {
      const a = y[mon];
      if (!_isLiveArchive(a) || !Array.isArray(a.records)) return;
      const keep = a.records.filter(function(r) {
        if (!_sameDelivery(supplyRec, r) || (r && r.id && r.id === supplyRec.id)) return true;
        if (r && r.id) gone.push(r.id);
        return !_provablySameDelivery(supplyRec, r);
      });
      if (keep.length !== a.records.length) y[mon] = Object.assign({}, a, { records: keep });
    });
  });
  return gone;
}
// Ids of archived copies the records `recs` replaced (see _dropArchivedCopies).
function _supersededIds(recs) {
  const out = new Set();
  (recs || []).forEach(function(r) { if (r && Array.isArray(r.supersedes)) r.supersedes.forEach(function(id) { if (id) out.add(id); }); });
  return out;
}
function _withSupersedes(rec, ids) {
  const all = Array.from(new Set([].concat(Array.isArray(rec.supersedes) ? rec.supersedes : [], ids || [])));
  if (all.length) rec.supersedes = all;
  return rec;
}
// Archived copies of one delivery (_provablySameDelivery) — re-saved or edited after its month
// was archived, or an old copy another device still had (archives merge as a union, so a copy
// removed on one device comes back from the others): only the newest (savedAt) is kept.
// Runs wherever archives come in: load, cloud merge, backup restore, archiving.
function _collapseArchiveCopies() {
  const byCl = new Map();
  _liveArchiveEntries().forEach(function(e) {
    e.arch.records.forEach(function(r, i) {
      if (r && r.checklistUid) { if (!byCl.has(r.checklistUid)) byCl.set(r.checklistUid, []); byCl.get(r.checklistUid).push({ e: e, r: r, i: i }); }
    });
  });
  const drop = new Set();
  // a copy a record replaced (re-save / edit) — synced back from a device that still had it
  const sup = _supersededIds([].concat.apply(typeof _savedSupplies !== 'undefined' && Array.isArray(_savedSupplies) ? _savedSupplies : [], _liveArchiveEntries().map(function(e) { return e.arch.records; })));
  if (sup.size) _liveArchiveEntries().forEach(function(e) { e.arch.records.forEach(function(r) { if (r && r.id && r.nomUid && sup.has(r.id)) drop.add(r); }); });
  byCl.forEach(function(list) {
    if (list.length < 2) return;
    const t = function(x) { return Date.parse((x.r && x.r.savedAt) || '') || 0; };
    list.sort(function(a, b) { return t(b) - t(a) || b.i - a.i; });
    const kept = [];
    list.forEach(function(x) { if (drop.has(x.r)) return; if (kept.some(function(k) { return _provablySameDelivery(k.r, x.r); })) drop.add(x.r); else kept.push(x); });
  });
  if (!drop.size) return 0;
  _liveArchiveEntries().forEach(function(e) {
    if (e.arch.records.some(function(r) { return drop.has(r); }))
      _archives[e.yr][e.mon] = Object.assign({}, e.arch, { records: e.arch.records.filter(function(r) { return !drop.has(r); }) });
  });
  return drop.size;
}
// Puts `rows` into the yr/mon archive, MERGING with an existing live archive
// (re-archiving a month used to replace — and so silently drop — whatever
// was archived there before). Returns how many rows were new.
function _archiveMergeRows(yr, key, mon, rows) {
  if (!_archives[yr]) _archives[yr] = {};
  const ex = _archives[yr][key];
  const now = new Date().toISOString();
  if (!_isLiveArchive(ex)) {
    _archives[yr][key] = { records: rows, archivedAt: now, month: mon, year: Number(yr) };
    return rows.length;
  }
  const merged = _mergeArchiveRecords(ex.records, rows);
  _archives[yr][key] = Object.assign({}, ex, { records: merged.records, archivedAt: now });
  return merged.added;
}
// 'YYYY-MM-DD' strings are parsed by Date() as UTC midnight, which lands on
// the previous day (and so possibly the previous month) west of UTC. Parse
// date-only strings as local dates; everything else as before.
function _parseDateLocal(v) {
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  return new Date(v);
}
// Actual delivered quantity of a (supplied) record. An actual of 0 is a real
// value — `act || nom` used to report such a record at its nominated qty.
function _recActQty(r, g) {
  const keys = g === 'v' ? ['vlsfoAct', 'vlsfoActual', 'vQ'] : ['mgoAct', 'mgoActual', 'mQ'];
  for (let i = 0; i < keys.length; i++) {
    const x = r && r[keys[i]];
    if (x !== undefined && x !== null && x !== '') return parseFloat(x) || 0;
  }
  return 0;
}

function loadArchivesLocal() {
  try {
    const raw = localStorage.getItem(ARCHIVES_KEY);
    if (raw) _archives = JSON.parse(raw) || {};
    _collapseArchiveCopies();
  } catch(e) { /* leave _archives as-is */ }
}

// Merge cloud-synced archives into the local set. Months only one side
// knows are taken as-is. When both sides have the month: two live archives
// are unioned (rows deduped); otherwise the newer of archivedAt / deletedAt
// wins, so a deletion (tombstone) made on one device is not undone by
// another device's older copy, while a later re-archive still beats an
// earlier deletion.
function _mergeArchives(remoteArchives) {
  if (!remoteArchives || typeof remoteArchives !== 'object') return;
  let changed = false;
  Object.keys(remoteArchives).forEach(function(yr) {
    const rYear = remoteArchives[yr];
    if (!rYear || typeof rYear !== 'object') return;
    if (!_archives[yr]) { _archives[yr] = {}; }
    Object.keys(rYear).forEach(function(mon) {
      const L = _archives[yr][mon], R = rYear[mon];
      if (!R) return;
      if (!L) { _archives[yr][mon] = R; changed = true; return; }
      if (_isLiveArchive(L) && _isLiveArchive(R)) {
        const merged = _mergeArchiveRecords(L.records, R.records);
        if (merged.added || merged.replaced) {
          _archives[yr][mon] = Object.assign({}, L, { records: merged.records,
            archivedAt: _archiveStamp(R) > _archiveStamp(L) ? R.archivedAt : L.archivedAt });
          changed = true;
        }
        return;
      }
      if (_archiveStamp(R) > _archiveStamp(L)) { _archives[yr][mon] = R; changed = true; }
    });
  });
  if (_collapseArchiveCopies()) changed = true;
  if (changed) saveArchives();
}

function archiveMonth(mon,yr){
  // IMPORTANT: archive the RAW records straight from _savedSupplies, not the
  // output of getMonthlyRows() — that function maps rows down to a display-only
  // shape (name/dateStr/vQ/mQ/...) for the report table and does NOT include
  // the real supplyDate field. Archiving that simplified shape used to strip
  // the delivery date off every record, so once combined back in later
  // (Monthly Report / Fuel Distribution) each record fell back to the
  // archive's timestamp instead of its real date — leaking last month's
  // deliveries into whatever month you happened to click "Archive" in.
  // Removal below uses exactly this selection (incl. the report's port
  // filter) — it used to drop every completed record of the month, so
  // archiving "FUJ only" deleted the KFK records without archiving them.
  var sel=(_savedSupplies||[]).filter(function(r){
    if(!r.supplyDate||!r.supplied)return false;
    var d=_parseDateLocal(r.supplyDate);
    return d.getMonth()===mon&&d.getFullYear()===yr&&_rowMatchesReportPort(r,_reportPort);
  });
  var rows=sel.map(function(r){return Object.assign({},r);});
  if(!rows.length){alert('No completed records for '+MO[mon]+' '+yr);return;}
  var key=MO[mon];
  var hadArchive=_isLiveArchive(_archives[yr]&&_archives[yr][key]);
  var added=_archiveMergeRows(yr,key,mon,rows);
  _collapseArchiveCopies(); // an older archived copy of a delivery archived now gives way to it
  var selSet=new Set(sel);
  _savedSupplies=_savedSupplies.filter(function(r){return !selSet.has(r);});
  saveArchives();
  saveSharedState();
  saveSharedRecords();renderSavedRecords();renderArchivePanel();
  alert(hadArchive
    ? 'Added '+added+' new record(s) to the existing '+key+' '+yr+' archive ('+_archives[yr][key].records.length+' total).'
    : 'Archived '+rows.length+' records for '+key+' '+yr);
}

// ── AUTOMATIC MONTH-END ARCHIVING ──────────────────────────────────
// archiveMonth() above has always existed but was only ever wired to a
// manual "Archive" button — nothing ever called it on its own, so a
// completed month just sat in _savedSupplies indefinitely until someone
// remembered to archive it by hand. This runs once per app load (operator
// sessions only) and silently archives any FULLY PAST month that still
// has completed ('supplied') records sitting unarchived, using the exact
// same logic as the manual archiveMonth() — just without its alert()/
// confirm() dialogs, since this has no one to click through them. The
// current, still-in-progress month is never touched here.
function autoArchivePastMonths() {
  if (typeof isTrader === 'function' && isTrader()) return; // operator-only write, same as the manual button
  if (!_savedSupplies || !_savedSupplies.length) return;

  const now = new Date();
  const curMon = now.getMonth(), curYr = now.getFullYear();
  const pending = {}; // "yr-mon" -> {mon, yr}
  _savedSupplies.forEach(function(r) {
    if (!r.supplyDate || r.supplied !== true) return;
    const d = _parseDateLocal(r.supplyDate);
    if (isNaN(d)) return;
    const mon = d.getMonth(), yr = d.getFullYear();
    if (yr > curYr || (yr === curYr && mon >= curMon)) return; // current/future month — leave alone
    const key = yr + '-' + mon;
    if (!pending[key]) pending[key] = { mon: mon, yr: yr };
  });

  // Skip months whose archive was deliberately deleted (tombstone) — the
  // operator restored those records to work on them; re-archiving on the
  // next load would undo that. A live archive gets late records merged in.
  const monthsToArchive = Object.values(pending).filter(function(p) {
    const a = _archives[p.yr] && _archives[p.yr][MO[p.mon]];
    return !(a && a.deleted);
  });
  if (!monthsToArchive.length) return;

  let archivedAny = false;
  monthsToArchive.forEach(function(p) {
    const sel = (_savedSupplies || []).filter(function(r) {
      if (!r.supplyDate || !r.supplied) return false;
      const d = _parseDateLocal(r.supplyDate);
      return d.getMonth() === p.mon && d.getFullYear() === p.yr;
    });
    const rows = sel.map(function(r) { return Object.assign({}, r); });
    if (!rows.length) return;
    _archiveMergeRows(p.yr, MO[p.mon], p.mon, rows);
    // Remove exactly what was archived (same predicate as the selection).
    const selSet = new Set(sel);
    _savedSupplies = _savedSupplies.filter(function(r) { return !selSet.has(r); });
    archivedAny = true;
  });
  if (archivedAny) _collapseArchiveCopies(); // an older archived copy of a delivery archived now gives way to it

  if (archivedAny) {
    saveArchives();
    saveSharedState();
    saveSharedRecords();
    if (typeof renderSavedRecords === 'function') renderSavedRecords();
    if (typeof renderArchivePanel === 'function') renderArchivePanel();
    if (typeof refreshDashboard === 'function' && document.getElementById('page-dashboard')?.classList.contains('active')) refreshDashboard();
  }
}

function deleteArchive(yr, mon) {
  const arch = _archives[yr] && _archives[yr][mon];
  if (!_isLiveArchive(arch)) return;
  const restore = confirm(
    `Delete the ${mon} ${yr} archive (${arch.records.length} record(s))?\n\n` +
    `Click OK to restore those records back into Saved Supply Records first (so the data isn't lost), ` +
    `or Cancel to stop without deleting anything.\n\n` +
    `(To permanently delete without keeping the data, restore it here first, then use "Remove Duplicates" ` +
    `or Delete on the individual record afterward.)`
  );
  if (!restore) return;
  // Restore archived rows back into the live Saved Supply Records list —
  // give any record missing an id a fresh one so it can be edited/deleted normally.
  const liveIds = new Set((_savedSupplies || []).map(x => x.id).filter(Boolean));
  arch.records.forEach(r => {
    if (r.id && liveIds.has(r.id)) return; // already live — don't duplicate it
    const restored = Object.assign({}, r, {
      id: r.id || (String(r.vessel||'rec').replace(/\s+/g,'_') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,7)),
      vessel: r.vessel || r.name || 'Unknown',
      vlsfoAct: r.vlsfoAct != null ? r.vlsfoAct : (r.vlsfoActual || r.vQ || 0),
      mgoAct:   r.mgoAct   != null ? r.mgoAct   : (r.mgoActual   || r.mQ || 0),
      supplyDate: r.supplyDate || r.date || arch.archivedAt,
      supplied: true
    });
    // ROB: a record that had no id (legacy) was deducted by computeLiveROB on
    // every pass while it was live, so its quantity is already folded into
    // the barge's baked opening ROB — but it could never be listed in
    // _bakedSupplyIds. Its freshly-minted id must therefore be marked baked,
    // or restoring it deducts it a second time. Records that kept their
    // original id need nothing: if they were baked the id is already in
    // _bakedSupplyIds, and if not they were never deducted from the opening.
    if (!r.id) _markRestoredRecordBaked(restored);
    _savedSupplies.push(restored);
  });
  // Tombstone instead of `delete`, so cloud sync can't resurrect it.
  _archives[yr][mon] = { deleted: true, deletedAt: new Date().toISOString(), month: arch.month, year: arch.year };
  saveArchives();
  saveSharedRecords();
  saveSharedState();
  renderArchivePanel();
  renderSavedRecords();
  showToast(`${mon} ${yr} archive deleted — ${arch.records.length} record(s) restored to Saved Supply Records.`, 'success');
}
function _markRestoredRecordBaked(rec) {
  if (typeof _bakedSupplyIds === 'undefined' || !rec || !rec.id) return;
  if (!(parseFloat(rec.vlsfoAct) || parseFloat(rec.mgoAct))) return; // computeLiveROB ignores 0/0 rows
  const cfg = _bargeConfig || [];
  const rb = String(rec.barge || '').trim();
  cfg.forEach(function(b) {
    if (rb ? rb === b.name : cfg.length === 1) {
      _bakedSupplyIds[b.id] = Array.from(new Set((_bakedSupplyIds[b.id] || []).concat([rec.id])));
    }
  });
}
function renderArchivePanel(){
  var el=document.getElementById('archive-panel');if(!el)return;
  var years=Object.keys(_archives).filter(function(y){
    return Object.keys(_archives[y]||{}).some(function(m){return _isLiveArchive(_archives[y][m]);});
  }).sort(function(a,b){return b-a;});
  if(!years.length){el.innerHTML='<p style="font-size:12px;color:var(--muted);padding:8px">No archives yet. Use Monthly Report to archive.</p>';return;}
  var html='';
  for(var yi=0;yi<years.length;yi++){
    var yr=years[yi];
    html+='<div style="margin-bottom:12px"><div style="font-size:11px;font-weight:700;color:var(--sub);text-transform:uppercase;margin-bottom:6px">'+yr+'</div>';
    var months=Object.keys(_archives[yr]).filter(function(m){return _isLiveArchive(_archives[yr][m]);}).sort(function(a,b){return MO.indexOf(a)-MO.indexOf(b);});
    for(var mi=0;mi<months.length;mi++){
      var mon=months[mi];var arch=_archives[yr][mon];
      var totV=arch.records.reduce(function(a,r){return a+_recActQty(r,'v');},0);
      var totM=arch.records.reduce(function(a,r){return a+_recActQty(r,'m');},0);
      var oc="'"+escJs(yr)+"','"+escJs(mon)+"'";
      html+='<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--surface);border:0.5px solid var(--border);border-radius:8px;margin-bottom:6px;gap:12px">';
      html+='<div><div style="font-size:13px;font-weight:600">'+esc(mon)+' '+esc(yr)+' <span style="font-size:10px;padding:2px 6px;border-radius:4px;background:var(--azure-lt);color:var(--azure)">READ-ONLY</span></div>';
      html+='<div style="font-size:11px;color:var(--sub);margin-top:2px">'+arch.records.length+' records &middot; VLSFO '+totV.toLocaleString()+' MT &middot; MGO '+totM.toLocaleString()+' MT</div>';
      html+='<div style="font-size:10px;color:var(--muted);margin-top:2px">Archived: '+(arch.archivedAt?new Date(arch.archivedAt).toLocaleString():'unknown date')+'</div></div>';
      html+='<div style="display:flex;gap:6px;flex-shrink:0"><button onclick="openArchiveWindow('+oc+')" style="padding:5px 12px;background:var(--azure-lt);border:0.5px solid var(--azure-bd);border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;color:var(--azure);font-family:DM Sans,sans-serif">View</button>'
        +'<button onclick="downloadArchivePDF('+oc+',this)" style="padding:5px 12px;background:var(--surface2,#F2F5F9);border:0.5px solid var(--border);border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;color:var(--ink);font-family:DM Sans,sans-serif">Print PDF</button>'
        +'<button onclick="deleteArchive('+oc+')" style="padding:5px 12px;background:var(--red-lt);border:0.5px solid #F3C7C0;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;color:var(--red-dk,#9B2C2C);font-family:DM Sans,sans-serif">Delete</button></div></div>';
    }
    html+='</div>';
  }
  el.innerHTML=html;
}
function openArchiveWindow(yr,mon){
  var arch=_archives[yr]&&_archives[yr][mon];if(!_isLiveArchive(arch))return;
  var totV=arch.records.reduce(function(a,r){return a+_recActQty(r,'v');},0);
  var totM=arch.records.reduce(function(a,r){return a+_recActQty(r,'m');},0);
  // Build modal inline instead of popup window (popup blockers break window.open)
  var existing=document.getElementById('_archiveModal');
  if(existing)existing.remove();
  var rows='';
  for(var i=0;i<arch.records.length;i++){
    var r=arch.records[i];
    var vv=_recActQty(r,'v');
    var mm=_recActQty(r,'m');
    rows+='<tr><td>'+esc(r.vessel||r.name||'—')+'</td><td>'+esc(r.dateStr||r.supplyDate||r.date||'—')+'</td><td>'+(vv>0?fmtMT(vv):'—')+'</td><td>'+(mm>0?fmtMT(mm):'—')+'</td><td>'+esc(r.barge||r.bargeLabel||'—')+'</td><td>'+esc(r.area||r.areaCode||'—')+'</td></tr>';
  }
  var modal=document.createElement('div');
  modal.id='_archiveModal';
  modal.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML='<div style="background:var(--surface);border-radius:14px;box-shadow:0 8px 48px rgba(0,0,0,.22);max-width:860px;width:100%;max-height:85vh;display:flex;flex-direction:column;overflow:hidden">'
    +'<div style="padding:18px 20px 14px;border-bottom:1px solid #eee;display:flex;align-items:center;justify-content:space-between">'
    +'<div><div style="font-size:16px;font-weight:700;color:var(--ink)">'+esc(mon)+' '+esc(yr)+' — Archive</div>'
    +'<div style="font-size:12px;color:var(--muted);margin-top:3px">'+arch.records.length+' records · VLSFO '+fmtMT(totV)+' MT · MGO '+fmtMT(totM)+' MT · Archived: '+new Date(arch.archivedAt).toLocaleDateString()+'</div></div>'
    +'<button onclick="document.getElementById(\'_archiveModal\').remove()" style="background:var(--surface2);border:none;border-radius:8px;padding:6px 14px;font-size:13px;font-weight:600;cursor:pointer;color:var(--ink)">✕ Close</button></div>'
    +'<div style="overflow-y:auto;padding:16px 20px">'
    +'<table style="width:100%;border-collapse:collapse;font-size:12px;font-family:DM Sans,sans-serif">'
    +'<thead><tr style="background:var(--ink-solid);color:#fff"><th style="padding:9px 12px;text-align:left;font-size:10px;letter-spacing:.06em;text-transform:uppercase">Vessel</th><th style="padding:9px 12px;text-align:left;font-size:10px;letter-spacing:.06em;text-transform:uppercase">Date</th><th style="padding:9px 12px;text-align:left;font-size:10px;letter-spacing:.06em;text-transform:uppercase">VLSFO (MT)</th><th style="padding:9px 12px;text-align:left;font-size:10px;letter-spacing:.06em;text-transform:uppercase">MGO (MT)</th><th style="padding:9px 12px;text-align:left;font-size:10px;letter-spacing:.06em;text-transform:uppercase">Barge</th><th style="padding:9px 12px;text-align:left;font-size:10px;letter-spacing:.06em;text-transform:uppercase">Port</th></tr></thead>'
    +'<tbody>'+rows+'</tbody></table></div>'
    +'<div style="padding:12px 20px;border-top:1px solid #eee;display:flex;justify-content:flex-end;gap:8px">'
    +'<button onclick="document.getElementById(\'_archiveModal\').remove()" style="background:var(--ink-solid);color:#fff;border:none;border-radius:8px;padding:8px 20px;font-size:12px;font-weight:600;cursor:pointer;font-family:DM Sans,sans-serif">Close</button>'
    +'</div></div>';
  document.body.appendChild(modal);
  modal.addEventListener('click',function(e){if(e.target===modal)modal.remove();});
}
// Shared colored table+header HTML for the two PDF report exports (Monthly
// Report and Archive). VLSFO/MGO columns are tinted blue/orange throughout
// the body — not just the header — matching the app's own fuel-type colors,
// so the PDF reads at a glance instead of being a flat black-and-white grid.
function _flowReportPDFHTML(opts) {
  var rows = opts.rows, totV = opts.totV, totM = opts.totM;
  var tableRows = rows.map(function(r, i){
    // Every cell is user/cloud data and this HTML is inserted into the live
    // DOM by _flowExportReportPDF, so escape it.
    return '<tr><td>' + (i+1) + '</td><td>' + esc(r.vessel) + '</td><td>' + esc(r.dateStr) + '</td>'
      + '<td class="v">' + (r.v > 0 ? fmtMT(r.v) : '—') + '</td>'
      + '<td>' + esc(r.bdnV || '—') + '</td>'
      + '<td class="m">' + (r.m > 0 ? fmtMT(r.m) : '—') + '</td>'
      + '<td>' + esc(r.bdnM || '—') + '</td>'
      + '<td>' + esc(r.barge || '—') + '</td><td>' + esc(r.port || '—') + '</td></tr>';
  }).join('');
  var metaHTML = opts.metaLines.map(function(l){ return '<div><strong>' + esc(l[0]) + ':</strong> ' + esc(l[1]) + '</div>'; }).join('');
  return '<div style="font-family:\'Segoe UI\',Arial,sans-serif; font-size:9pt; color:#0F1E30; background:#fff; padding:20px;">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0 8px;border-bottom:2px solid #0F1E30;margin-bottom:12px;">'
    + '<div><div style="font-size:16pt;font-weight:700;color:#0F1E30">FLOW — Monthly Supply Report</div>'
    + '<div style="display:inline-block;padding:3px 12px;background:#0F1E30;color:#fff;border-radius:20px;font-size:9pt;font-weight:700;margin-top:4px">' + esc(opts.badge) + '</div></div>'
    + '<div style="text-align:right;font-size:8.5pt;color:#7891A8">' + metaHTML + '</div></div>'
    + '<style>'
    + 'table{width:100%;border-collapse:collapse;font-size:8pt;}'
    + 'thead{background:#0F1E30;}'
    + 'th{color:rgba(255,255,255,.85);padding:7px 8px;text-align:left;font-size:7.5pt;font-weight:700;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;}'
    + 'th.v,th.m{text-align:right;}'
    + 'td{padding:6px 8px;border-bottom:0.5pt solid #E2E8F0;vertical-align:middle;}'
    + 'tr:nth-child(even) td{background:#F8FAFC;}'
    + 'td.v{text-align:right;color:#1D4ED8;font-weight:600;background:#EFF5FF;}'
    + 'td.m{text-align:right;color:#C2570A;font-weight:600;background:#FFF6EC;}'
    + 'tr:nth-child(even) td.v{background:#E6EFFD;}'
    + 'tr:nth-child(even) td.m{background:#FDEEDD;}'
    + 'tr.tot td{background:#0F1E30;color:#fff;font-weight:700;border-bottom:none;}'
    + 'tr.tot td.v{background:#1D4ED8;color:#fff;}'
    + 'tr.tot td.m{background:#C2570A;color:#fff;}'
    + '</style>'
    + '<table><thead><tr><th>S.No.</th><th>Vessel</th><th>Date</th><th class="v">VLSFO (MT)</th><th>BDN (VLSFO)</th><th class="m">MGO (MT)</th><th>BDN (LSMGO)</th><th>Barge</th><th>Port</th></tr></thead>'
    + '<tbody>' + tableRows
    + '<tr class="tot"><td colspan="3">TOTAL</td><td class="v">' + fmtMT(totV) + ' MT</td><td></td><td class="m">' + fmtMT(totM) + ' MT</td><td></td><td></td><td></td></tr>'
    + '</tbody></table>'
    + '<div style="margin-top:14px;padding-top:8px;border-top:1px solid #E2E8F0;font-size:7.5pt;color:#7891A8;text-align:center">FLOW — Bunker Planning System · ' + (opts.footerNote || 'System-generated for operational reference only.') + '</div>'
    + '</div>';
}
// Renders the built HTML off-screen, rasterizes it, and saves/shares it as a
// portrait A4 PDF. Shared by downloadArchivePDF and downloadMonthlyReportPDF.
async function _flowExportReportPDF(html, filename, btnEl) {
  var origLabel = btnEl ? btnEl.innerHTML : '';
  if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = 'Preparing…'; }
  await new Promise(function(r){ setTimeout(r, 0); });
  var container = document.createElement('div');
  container.style.cssText = 'position:fixed; left:-99999px; top:0; width:1000px; background:#fff;';
  container.innerHTML = html;
  document.body.appendChild(container);
  try {
    var html2canvasFn = await _loadHtml2Canvas();
    var jsPDF = await _loadJsPDF();
    var canvas = await html2canvasFn(container, {
      backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false,
      width: container.scrollWidth, height: container.scrollHeight
    });
    var pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    var pageW = pdf.internal.pageSize.getWidth();
    var pageH = pdf.internal.pageSize.getHeight();
    var imgRatio = canvas.height / canvas.width;
    var renderW = pageW - 16;
    var renderH = renderW * imgRatio;
    if (renderH > pageH - 16) { renderH = pageH - 16; renderW = renderH / imgRatio; }
    var imgData = canvas.toDataURL('image/png');
    pdf.addImage(imgData, 'PNG', (pageW - renderW) / 2, 8, renderW, renderH);
    var blob = pdf.output('blob');
    await _flowSaveOrShareBlob(blob, filename);
  } catch (err) {
    alert('Could not generate the PDF: ' + err.message);
  } finally {
    document.body.removeChild(container);
    if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = origLabel; }
  }
}
async function downloadArchivePDF(yr, mon, btnEl) {
  var arch = _archives[yr] && _archives[yr][mon];
  if (!_isLiveArchive(arch)) { alert('Archive not found.'); return; }
  var rows = arch.records.map(function(r){
    return {
      vessel: r.vessel || r.name || '—',
      dateStr: r.dateStr || (r.supplyDate ? _parseDateLocal(r.supplyDate).toLocaleDateString() : (r.date || '—')),
      v: _recActQty(r, 'v'),
      m: _recActQty(r, 'm'),
      barge: r.barge || r.bargeLabel || '—',
      port: r.area || r.areaCode || '—'
    };
  });
  var totV = rows.reduce(function(a,r){ return a + r.v; }, 0);
  var totM = rows.reduce(function(a,r){ return a + r.m; }, 0);
  var html = _flowReportPDFHTML({
    rows: rows, totV: totV, totM: totM,
    badge: mon + ' ' + yr + ' · Archived',
    metaLines: [
      ['Generated', fmt24(new Date())],
      ['Records', rows.length],
      arch.archivedAt ? ['Archived', new Date(arch.archivedAt).toLocaleDateString()] : null
    ].filter(Boolean),
    footerNote: 'Archived monthly supply report · System-generated for operational reference only.'
  });
  await _flowExportReportPDF(html, 'FLOW_Archive_' + mon + '_' + yr + '.pdf', btnEl);
}
function _archiveCurrentReport(){
  if(_reportMode==='range'){alert('Switch to monthly mode to archive.');return;}
  var mon=parseInt(document.getElementById('report-month').value),yr=parseInt(document.getElementById('report-year').value);
  archiveMonth(mon,yr);closeMonthlyReport();
  var ap=document.getElementById('archive-panel');if(ap){ap.style.display='block';ap.scrollIntoView({behavior:'smooth',block:'center'});}
  renderArchivePanel();
}
function initializeSystem() {
  _savedSupplies    = [];
  _checklist        = {};
  _checklistRecords = {};
  _trashBin         = [];
  _lastSched        = null;
  _manualROB        = {};
  try { localStorage.removeItem('abps_records'); } catch(e) {}
  if (typeof renderSavedRecords === 'function') renderSavedRecords();
  if (typeof renderTrashBin     === 'function') renderTrashBin();
}

/* ─── Refresh all modules from current nomination data ─── */
function refreshAllModules() {
  // Re-render checklist from latest schedule
  if (_lastSched && _lastSched.length) {
    if (typeof renderChecklist === 'function')      renderChecklist(_lastSched);
    if (typeof renderBargeTabsAndTL === 'function') renderBargeTabsAndTL(_lastSched, getBarges ? getBarges() : []);
  }
  if (typeof renderSavedRecords  === 'function') renderSavedRecords();
  if (typeof renderLiveROBDashboard === 'function') renderLiveROBDashboard();
  if (typeof renderWeekCalendar === 'function')  renderWeekCalendar(_calWeekOffset || 0);
  // Sync alerts page
  refreshAlertsPage();
  // Refresh KPIs
  refreshNominationKPIs();
  refreshScheduleKPIs();
  refreshDashboard();
  if (typeof _fwRefreshIfOpen === 'function') _fwRefreshIfOpen();
  if (typeof _rlRefreshIfShown === 'function') _rlRefreshIfShown();
}

/* ── Alerts page — mirror data from rendered panels ── */
function refreshAlertsPage() {
  // Mirror PAQ panel
  const srcPAQ = document.getElementById('paq-panel');
  const dstPAQ = document.getElementById('alerts-paq-panel');
  if (srcPAQ && dstPAQ) dstPAQ.innerHTML = srcPAQ.innerHTML;

  // Mirror replenishment alerts
  mirrorAlertPanel('ap-v', 'alerts-ap-v');
  mirrorAlertPanel('ap-m', 'alerts-ap-m');

  // Mirror Live ROB
  renderAlertsLiveROB();

  // Mirror reminders
  renderAlertsReminders();

  // Update alerts badge count
  updateAlertsBadge();
}

function mirrorAlertPanel(srcId, dstId) {
  const src = document.getElementById(srcId);
  const dst = document.getElementById(dstId);
  if (!src || !dst) return;
  dst.className = src.className;
  dst.innerHTML = src.innerHTML;
}

function renderAlertsLiveROB() {
  // live-rob-dashboard is now the real element in Alerts & Notices — just refresh it
  renderLiveROBDashboard();
}

function renderAlertsReminders() {
  const src = document.getElementById('reminder-panel');
  const dst = document.getElementById('alerts-reminder-panel');
  if (!src || !dst) return;
  dst.innerHTML = src.innerHTML;
}

function updateAlertsBadge() {
  let count = 0;
  // Count fired replenishment alerts
  const apv = document.getElementById('ap-v');
  const apm = document.getElementById('ap-m');
  if (apv && apv.className.includes('fired')) count++;
  if (apm && apm.className.includes('fired')) count++;
  // Count PAQ pending from nomination cards
  document.querySelectorAll('#vc .vcard[id^="vessel-"]').forEach(card => {
    const cid = card.id.replace('vessel-', '');
    const paqEl = document.getElementById('v' + cid + '-paq');
    if (paqEl && paqEl.value !== 'yes') count++;
  });
  const badge = document.getElementById('nav-badge-alerts');
  if (badge) {
    if (count > 0) { badge.textContent = count; badge.style.display = ''; }
    else badge.style.display = 'none';
  }
}

