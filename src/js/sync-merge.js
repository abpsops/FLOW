/* ── Merge helpers ─────────────────────────────────────────────────── */
function _deepClone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
// Key-order-independent JSON, so "unchanged" is detected even when two
// devices built the same object with its keys in a different order.
function _stableStr(x) {
  return JSON.stringify(x === undefined ? null : x, function(k, v) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = {}; Object.keys(v).sort().forEach(function(kk) { o[kk] = v[kk]; }); return o;
    }
    return v;
  });
}
function _sameJSON(a, b) { return _stableStr(a) === _stableStr(b); }
function _isPlainObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }

// Stable identity per collection — matched per item in a three-way merge.
// Agents are matched by name: their numeric ids are assigned per device.
const _MERGE_ID_FIELDS   = { vessels: 'nomUid', barges: 'id', records: 'id', loadingRecords: 'id', loadingDeals: 'id', bargeTrackingReports: 'id', bargeReloads: 'id', bargeBlocks: 'id', agents: 'name' };
const _MERGE_ATOMIC_KEYS = { lastSched: 1, lastSchedMeta: 1 };   // derived as a whole by calculate() — never splice two schedules together (meta travels with its schedule)
const _MERGE_SET_KEYS    = { robAuditLog: 1 }; // append-only log — union of both sides

function _mergeItemKey(item, field) {
  if (!item || typeof item !== 'object') return null;
  const v = item[field];
  if (v === undefined || v === null || v === '') return null;
  return field === 'name' ? String(v).trim().toLowerCase() : String(v);
}
function _pickIdField(key, arrays) {
  const cands = _MERGE_ID_FIELDS[key] ? [_MERGE_ID_FIELDS[key]] : ['id', 'uid', 'nomUid', 'checklistUid'];
  for (let i = 0; i < cands.length; i++) {
    const f = cands[i];
    if (arrays.every(function(a) { return a.every(function(it) { return _mergeItemKey(it, f) !== null; }); })) return f;
  }
  return null;
}
function _mergeConflict(ctx, path) { ctx.conflicts.push(path || '(root)'); }

// base / local / remote → merged. Rule at every level: only one side changed
// vs base → take that side; both changed → recurse into collections (per
// item / per key); a genuine clash on one value → newer updatedAt if the
// object carries one, otherwise local — and it's recorded as a conflict so
// the user is told.
function _merge3(b, l, r, key, ctx, path) {
  if (_sameJSON(l, r)) return l;
  if (_sameJSON(l, b)) return r;
  if (_sameJSON(r, b)) return l;
  if (Array.isArray(l) && Array.isArray(r) && !_MERGE_ATOMIC_KEYS[key]) {
    const bArr = Array.isArray(b) ? b : [];
    if (_MERGE_SET_KEYS[key]) return _mergeSet(bArr, l, r);
    const f = _pickIdField(key, [bArr, l, r]);
    if (f) return _mergeById(bArr, l, r, f, key, ctx, path);
  } else if (_isPlainObj(l) && _isPlainObj(r) && !_MERGE_ATOMIC_KEYS[key]) {
    // A manual end date and its flag are ONE value; a computed end (flag off) is derived again after the merge.
    if (key === 'loadingRecords[]' && _isPlainObj(b)) return _mergeByNewer(b, l, r, ctx, path, [{ keys: ['endOverridden', 'endAt'], sig: function(o) { return o && o.endOverridden ? [true, o.endAt] : [false, null]; } }]);
    if (key === 'loadingDeals[]' && _isPlainObj(b)) return _mergeByNewer(b, l, r, ctx, path);
    if (l.updatedAt != null || r.updatedAt != null) {
      _mergeConflict(ctx, path);
      return (Number(r.updatedAt) || 0) > (Number(l.updatedAt) || 0) ? r : l;
    }
    return _mergeKeys(_isPlainObj(b) ? b : {}, l, r, ctx, path);
  }
  _mergeConflict(ctx, path);
  return l;
}
// A loading record / deal edited on both sides: per key, the side that changed
// it vs base; a key both changed differently → the side with the newer
// updatedAt. So a completion + BL figure, a closed status or a tombstone set
// on one device is never undone by the other's edit of another field.
function _mergeByNewer(b, l, r, ctx, path, groups) {
  const newer = (Number(r.updatedAt) || 0) > (Number(l.updatedAt) || 0) ? r : l;
  const has = function(o, k) { return Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined; };
  const keys = Array.from(new Set(Object.keys(l).concat(Object.keys(r), Object.keys(b))));
  const out = {};
  let clash = false;
  // Keys that are ONE value (a manual end date and its flag): the side that
  // changed any of them gives all of them.
  const grouped = {};
  (groups || []).forEach(function(g) {
    const pick = g.sig || function(o) { return g.keys.map(function(k) { return has(o, k) ? o[k] : null; }); };
    const lCh = !_sameJSON(pick(l), pick(b)), rCh = !_sameJSON(pick(r), pick(b));
    let src = l;
    if (lCh && rCh && !_sameJSON(pick(l), pick(r))) { src = newer; clash = true; }
    else if (rCh && !lCh) src = r;
    g.keys.forEach(function(k) { grouped[k] = 1; if (has(src, k)) out[k] = src[k]; });
  });
  keys.forEach(function(k) {
    if (k === 'updatedAt' || grouped[k]) return;
    const inL = has(l, k), inR = has(r, k), inB = has(b, k);
    const lCh = inL ? (!inB || !_sameJSON(l[k], b[k])) : inB;
    const rCh = inR ? (!inB || !_sameJSON(r[k], b[k])) : inB;
    let src = l;
    if (lCh && rCh && !_sameJSON(inL ? l[k] : null, inR ? r[k] : null)) { src = newer; clash = true; }
    else if (rCh && !lCh) src = r;
    if (has(src, k)) out[k] = src[k];
  });
  out.updatedAt = Math.max(Number(l.updatedAt) || 0, Number(r.updatedAt) || 0);
  if (clash) _mergeConflict(ctx, path);
  return out;
}
// A merged loading record may carry the quantity from one side and the ops hours
// from the other: then pumping, duration and end time are derived again from the
// merged inputs with the merged rates (unless the end date was set by hand). When
// the merged inputs are exactly one side's, that side's own figures stay.
const _LD_INPUT_KEYS = ['qty', 'grade', 'preOpsHours', 'postOpsHours', 'startAt', 'startWin', 'endOverridden', 'kind', 'fromBarge', 'hoseHours'];
function _ldInputs(r) { return _stableStr(_LD_INPUT_KEYS.map(function(k) { return r && r[k] !== undefined ? r[k] : null; })); }
function _mergeLoadingDerived(merged, ld, rd) {
  const recs = merged && merged.state && Array.isArray(merged.state.loadingRecords) ? merged.state.loadingRecords : null;
  if (!recs) return merged;
  const cfg = Object.assign({ rateVLSFO: 300, rateLSMGO: 150 }, (merged.state.loadingConfig || {}));
  const byId = function(d) { const m = {}; ((d && d.state && d.state.loadingRecords) || []).forEach(function(x) { if (x && x.id != null) m[x.id] = x; }); return m; };
  const L = byId(ld), R = byId(rd);
  let changed = false;
  const out = recs.map(function(m) {
    if (!_isPlainObj(m)) return m;
    const l = L[m.id], r = R[m.id];
    if (!l || !r) return m;
    const manual = !!m.endOverridden; // a manual end date stays; pumping and duration still follow the inputs
    const mi = _ldInputs(m), li = _ldInputs(l), ri = _ldInputs(r);
    if (mi === li && mi === ri) return m;                       // same inputs on both sides: the per-key merge already took the changed figures
    if (mi === li) return _sameDerived(m, l, manual) ? m : Object.assign({}, m, _derivedOf(l, manual));
    if (mi === ri) return _sameDerived(m, r, manual) ? m : Object.assign({}, m, _derivedOf(r, manual));
    const start = new Date(m.startAt);
    if (isNaN(start.getTime())) return m;
    const q = Number(m.qty) || 0;
    let rate, total, pump;
    if (m.kind === 'transfer') {
      // A barge transfer pumps at the giving barge's rate, then hose-up.
      const fb = (merged.state.barges || []).find(function(b) { return b && b.name === m.fromBarge; });
      rate = Number(fb && (m.grade === 'LSMGO' ? fb.mtph : fb.vtph)) || 0;
      if (!rate) { const side = [l, r].find(function(x) { return Number(x.pumpHours) > 0 && Number(x.qty) > 0; }); rate = side ? Number(side.qty) / Number(side.pumpHours) : 0; }
      if (!rate) return m;
      pump = q > 0 ? q / rate : 0;
      total = pump > 0 ? pump + (Number(m.hoseHours) || 0) : 0;
    } else {
      rate = (m.grade === 'LSMGO' ? cfg.rateLSMGO : cfg.rateVLSFO) || 1;
      pump = q > 0 ? q / rate : 0;
      total = (Number(m.preOpsHours) || 0) + pump + (Number(m.postOpsHours) || 0);
    }
    const frame = m.startWin && typeof _etaFrameHrs === 'function' ? _etaFrameHrs(m.startWin) : 0;
    changed = true;
    return Object.assign({}, m, { pumpHours: pump, estimatedHours: total }, manual ? {} : { endAt: new Date(start.getTime() + (frame + total) * 3600000).toISOString() });
  });
  function _derivedOf(x, manual) { return manual ? { pumpHours: x.pumpHours, estimatedHours: x.estimatedHours } : { pumpHours: x.pumpHours, estimatedHours: x.estimatedHours, endAt: x.endAt }; }
  function _sameDerived(a, x, manual) { return a.pumpHours === x.pumpHours && a.estimatedHours === x.estimatedHours && (manual || a.endAt === x.endAt); }
  if (!changed && out.every(function(x, i) { return x === recs[i]; })) return merged;
  return Object.assign({}, merged, { state: Object.assign({}, merged.state, { loadingRecords: out }) });
}
function _mergeKeys(b, l, r, ctx, path) {
  const out = {};
  const has = function(o, k) { return Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined; };
  let keys = Object.keys(l).concat(Object.keys(r).filter(function(k) { return !has(l, k); }));
  // A vessel's ETA and its time frame (etaWin) are ONE value: merged per key
  // they could combine into a frame neither side set (B's exact 15:00 + A's
  // "AM"). Take both from the side that changed them; both changed → clash.
  if (has(l, 'etaWin') || has(r, 'etaWin') || has(b, 'etaWin')) {
    const pair = function(o) { return [has(o, 'eta') ? o.eta : null, has(o, 'etaWin') ? o.etaWin : null]; };
    const pb = pair(b), pl = pair(l), pr = pair(r);
    const lCh = !_sameJSON(pl, pb), rCh = !_sameJSON(pr, pb);
    let src = l;
    if (rCh && !lCh) src = r;
    else if (lCh && rCh && !_sameJSON(pl, pr)) _mergeConflict(ctx, path ? path + '.eta' : 'eta');
    ['eta', 'etaWin'].forEach(function(k) { if (has(src, k)) out[k] = src[k]; });
    keys = keys.filter(function(k) { return k !== 'eta' && k !== 'etaWin'; });
  }
  keys.forEach(function(k) {
    const inL = has(l, k), inR = has(r, k), inB = has(b, k);
    const p = path ? path + '.' + k : k;
    if (inL && inR) { out[k] = _merge3(b[k], l[k], r[k], k, ctx, p); return; }
    if (inL) {
      if (!inB) out[k] = l[k];                                     // added here
      else if (!_sameJSON(l[k], b[k])) { out[k] = l[k]; _mergeConflict(ctx, p); } // edited here, deleted there → keep edit
      return;                                                       // else deleted there, untouched here → deleted
    }
    if (inR) {
      if (!inB) out[k] = r[k];
      else if (!_sameJSON(r[k], b[k])) { out[k] = r[k]; _mergeConflict(ctx, p); }
    }
  });
  return out;
}
function _mergeById(b, l, r, f, key, ctx, path) {
  const index = function(arr) {
    const m = new Map(), seen = {};
    arr.forEach(function(it) {
      let k = _mergeItemKey(it, f);
      seen[k] = (seen[k] || 0) + 1;
      if (seen[k] > 1) k += '#' + seen[k]; // duplicate ids stay distinct
      m.set(k, it);
    });
    return m;
  };
  const bm = index(b), lm = index(l), rm = index(r);
  const out = [];
  const order = Array.from(lm.keys()).concat(Array.from(rm.keys()).filter(function(k) { return !lm.has(k); }));
  order.forEach(function(k) {
    const bi = bm.get(k), li = lm.get(k), ri = rm.get(k);
    const p = (path || key) + '[' + k + ']';
    if (li !== undefined && ri !== undefined) { out.push(_merge3(bi, li, ri, key + '[]', ctx, p)); return; }
    if (li !== undefined) {
      if (bi === undefined) out.push(li);
      else if (!_sameJSON(li, bi)) { out.push(li); _mergeConflict(ctx, p); }
      return;
    }
    if (bi === undefined) out.push(ri);
    else if (!_sameJSON(ri, bi)) { out.push(ri); _mergeConflict(ctx, p); }
  });
  return out;
}
function _mergeSet(b, l, r) {
  const bs = new Set(b.map(_stableStr)), ls = new Set(l.map(_stableStr)), rs = new Set(r.map(_stableStr));
  const out = l.filter(function(it) { const s = _stableStr(it); return !(bs.has(s) && !rs.has(s)); });
  r.forEach(function(it) { const s = _stableStr(it); if (!bs.has(s) && !ls.has(s)) out.push(it); });
  return out;
}
// The three parts of the payload that carry data ('version' is bookkeeping).
function _mergeDoc(p) {
  const st = Object.assign({}, (p && p.state) || {});
  delete st.version;
  return { state: st, records: (p && p.records) || [], checklistRecords: (p && p.checklistRecords) || {} };
}
function _samePayload(a, b) { return _sameJSON(_mergeDoc(a), _mergeDoc(b)); }
// Traders only ever write vessels — everything else always comes from the
// cloud, so only the vessels array is merged for them.
function _mergePayloads(base, local, remote) {
  const ctx = { conflicts: [] };
  let merged;
  if (isTrader()) {
    merged = _mergeDoc(_deepClone(remote));
    merged.state.vessels = _merge3((_mergeDoc(base).state.vessels) || [], _mergeDoc(local).state.vessels || [], merged.state.vessels || [], 'vessels', ctx, 'vessels');
  } else {
    const bd = _mergeDoc(base), ld = _mergeDoc(local), rd = _mergeDoc(remote);
    merged = _mergeLoadingDerived(_mergeBakes(bd, ld, rd, _merge3(bd, ld, rd, '', ctx, ''), ctx), ld, rd);
  }
  merged.state.version = (remote && remote.version) || (remote && remote.state && remote.state.version) || 0;
  return { merged: merged, conflicts: ctx.conflicts };
}
/* A barge's opening ROB and the supplies / reloads already folded into it (bakedSupplyIds)
   belong together: live ROB = opening − every supply not yet baked (computeLiveROB, with the
   manual overrides, their atIds and the clamp at 0). When both sides baked something
   different, the plain merge keeps this device's baked list (the clash rule), so the
   colleague's newly baked supplies are unbaked again: computeLiveROB deducts them once and
   the next save bakes them (and strips the overrides). But a grade only the colleague
   changed takes THEIR opening, which already holds those supplies — they were deducted
   twice. For such a grade the opening gets their quantities back (reloads taken off).
   Returns `m` with new objects — never mutates the inputs. */
function _mergeBakes(b, l, r, m, ctx) {
  const bakedOf = function(d) { return _isPlainObj(d && d.state && d.state.bakedSupplyIds) ? d.state.bakedSupplyIds : {}; };
  const bB = bakedOf(b), lB = bakedOf(l), rB = bakedOf(r), mB = bakedOf(m);
  const bids = Array.from(new Set(Object.keys(lB).concat(Object.keys(rB))));
  if (!bids.length || !m || !m.state || !Array.isArray(m.state.barges)) return m;
  const list = function(o, k) { return (Array.isArray(o[k]) ? o[k] : []).map(String); };
  const key = function(a) { return JSON.stringify(a.slice().sort()); };
  const bargeOf = function(d, id) { return ((d && d.state && d.state.barges) || []).find(function(x) { return x && String(x.id) === String(id); }); };
  const recs = Array.isArray(m.records) ? m.records : [], reloads = Array.isArray(m.state.bargeReloads) ? m.state.bargeReloads : [];
  // What computeLiveROB will take off (supplies) or add (reloads) for these ids, now unbaked
  // again, on this barge — same matching as computeLiveROB and the bake: a record by barge
  // name (blank = the only barge), with an actual; a reload by bargeId. An id it will not
  // count here (e.g. a record since moved to another barge) gets nothing back.
  const onlyBarge = m.state.barges.length === 1;
  const took = function(rec, actKey, bargeName) {
    const aV = parseFloat(rec.vlsfoAct) || 0, aM = parseFloat(rec.mgoAct) || 0, rb = String(rec.barge || '').trim();
    if ((aV === 0 && aM === 0) || !(rb === '' ? onlyBarge : rb === bargeName)) return 0;
    return parseFloat(rec[actKey]) || 0;
  };
  const effect = function(idList, actKey, rlKey, bid, bargeName) {
    return idList.reduce(function(t, id) {
      const rec = recs.find(function(x) { return x && String(x.id) === id; });
      if (rec) return t - took(rec, actKey, bargeName);
      const rl = reloads.find(function(x) { return x && String(x.id) === id; });
      return rl && String(rl.bargeId) === String(bid) ? t + (parseFloat(rl[rlKey]) || 0) : t;
    }, 0);
  };
  const barges = m.state.barges.slice();
  let changed = false;
  const resolved = {};
  bids.forEach(function(bid) {
    const bs = list(bB, bid), ls = list(lB, bid), rs = list(rB, bid);
    if (key(ls) === key(bs) || key(rs) === key(bs) || key(ls) === key(rs)) return; // one side baked (or both alike): consistent as merged
    resolved['state.bakedSupplyIds.' + bid] = 1; // the clash kept this device's list — handled here, not a conflict to report
    const inM = new Set(list(mB, bid));
    const unbaked = rs.filter(function(id) { return !inM.has(id); }); // the colleague's bakes the merged list drops
    const bb = bargeOf(b, bid), lb = bargeOf(l, bid), rb = bargeOf(r, bid), i = barges.findIndex(function(x) { return x && String(x.id) === String(bid); });
    if (!unbaked.length || !bb || !lb || !rb || i < 0) return;
    let mb = null;
    [['vrob', 'vlsfoAct', 'v'], ['mrob', 'mgoAct', 'm']].forEach(function(g) {
      const vb = parseFloat(bb[g[0]]) || 0, vl = parseFloat(lb[g[0]]) || 0, vr = parseFloat(rb[g[0]]) || 0;
      if (vr === vb || vl !== vb) return; // only a grade the colleague alone changed has their baked opening
      mb = mb || Object.assign({}, barges[i]);
      mb[g[0]] = Math.max(0, Math.round(vr - effect(unbaked, g[1], g[2], bid, barges[i].name)));
    });
    if (mb) { barges[i] = mb; changed = true; }
  });
  // The same supply saved on both devices before they synced has ONE id (_clSupplyRecordId),
  // so the merge keeps one record — but a device that baked it took ITS copy's quantity off
  // its opening. A grade whose merged opening is such a device's gets that copy back and the
  // merged record's taken off instead: ROB = opening − the one record, deducted once.
  const recIn = function(d, id) { return ((d && d.records) || []).find(function(x) { return x && String(x.id) === id; }); };
  bids.forEach(function(bid) {
    const bb = bargeOf(b, bid), lb = bargeOf(l, bid), rb = bargeOf(r, bid), m0 = bargeOf(m, bid), i = barges.findIndex(function(x) { return x && String(x.id) === String(bid); });
    if (!bb || !lb || !rb || !m0 || i < 0) return;
    const inB = new Set(list(bB, bid)), inM = new Set(list(mB, bid));
    let mb = null;
    [['vrob', 'vlsfoAct'], ['mrob', 'mgoAct']].forEach(function(g) {
      const vb = parseFloat(bb[g[0]]) || 0, vl = parseFloat(lb[g[0]]) || 0, vr = parseFloat(rb[g[0]]) || 0, vm = parseFloat(m0[g[0]]) || 0;
      const side = vl !== vb && vm === vl ? l : vr !== vb && vm === vr ? r : null; // whose opening the merge kept
      if (!side) return;
      const other = side === l ? r : l;
      const d = list(bakedOf(side), bid).reduce(function(t, id) {
        if (inB.has(id) || !inM.has(id) || recIn(b, id) || !recIn(other, id)) return t; // only a record both devices created since the last sync
        const own = recIn(side, id), merged = recs.find(function(x) { return x && String(x.id) === id; });
        return own && merged ? t + took(own, g[1], barges[i].name) - took(merged, g[1], barges[i].name) : t;
      }, 0);
      if (!d) return;
      mb = mb || Object.assign({}, barges[i]);
      mb[g[0]] = Math.max(0, Math.round((parseFloat(mb[g[0]]) || 0) + d));
    });
    if (mb) { barges[i] = mb; changed = true; }
  });
  // A baked record deleted on one device and edited on the other comes back
  // with the edit (the merge keeps edits). The delete's correction event (del)
  // gave back the record's whole take: it gives way to the editing device's
  // event of the same step (same id) or to nothing, and a merged opening that
  // holds the deleting device's event moves by the same difference.
  const rlOf = function(d) { return Array.isArray(d && d.state && d.state.bargeReloads) ? d.state.bargeReloads : []; };
  const lR = rlOf(l), rR = rlOf(r);
  let reloadsOut = null;
  reloads.forEach(function(ev, idx) {
    if (!ev || ev.kind !== 'correction' || ev.recId == null || !recs.some(function(x) { return x && String(x.id) === String(ev.recId); })) return;
    const le = lR.find(function(x) { return x && x.id === ev.id; }), re = rR.find(function(x) { return x && x.id === ev.id; });
    const dl = le && le.del ? 'l' : re && re.del ? 'r' : null;
    if (!dl) return;
    const dEv = dl === 'l' ? le : re, oEv = dl === 'l' ? re : le, dSide = dl === 'l' ? l : r;
    if (oEv && oEv.del) return; // deleted on both: it stays deleted… unless a third copy brought it back
    const repl = oEv || Object.assign({}, dEv, { v: 0, m: 0, note: (dEv.note || '') + ' — undone: the record was kept by an edit on another device' });
    if (!oEv) delete repl.del;
    reloadsOut = reloadsOut || reloads.slice();
    reloadsOut[idx] = repl;
    const bid = String(ev.bargeId), i = barges.findIndex(function(x) { return x && String(x.id) === bid; }), sb = bargeOf(dSide, bid);
    if (i < 0 || !sb || list(bakedOf(dSide), bid).indexOf(String(ev.id)) === -1) return;
    let nb = null;
    [['vrob', 'v'], ['mrob', 'm']].forEach(function(g) {
      if ((parseFloat(barges[i][g[0]]) || 0) !== (parseFloat(sb[g[0]]) || 0)) return; // the merged opening is not the deleting device's
      const diff = (parseFloat(repl[g[1]]) || 0) - (parseFloat(dEv[g[1]]) || 0);
      if (!diff) return;
      nb = nb || Object.assign({}, barges[i]);
      nb[g[0]] = Math.max(0, Math.round((parseFloat(nb[g[0]]) || 0) + diff));
    });
    if (nb) { barges[i] = nb; changed = true; }
  });
  // The same correction step (same id) written on both devices with different
  // figures — each changed a different field, or the same one differently,
  // before they synced. It is one step of one record: worked out again from
  // the merged record (what the last synced stamp says it took, minus what it
  // takes now), the merged record re-stamped, and an opening that holds one
  // device's figure moved by the difference.
  const bR = rlOf(b), num = function(x) { return parseFloat(x) || 0; };
  let recsOut = null;
  (reloadsOut || reloads).forEach(function(ev, idx) {
    if (!ev || ev.kind !== 'correction' || ev.recId == null) return;
    const le = lR.find(function(x) { return x && x.id === ev.id; }), re = rR.find(function(x) { return x && x.id === ev.id; });
    if (!le || !re || le.del || re.del || bR.some(function(x) { return x && x.id === ev.id; })) return;
    if (num(le.v) === num(re.v) && num(le.m) === num(re.m)) return;
    const bid = String(ev.bargeId), i = barges.findIndex(function(x) { return x && String(x.id) === bid; });
    const recId = String(ev.recId), baseRec = recIn(b, recId), ri = (recsOut || recs).findIndex(function(x) { return x && String(x.id) === recId; });
    if (i < 0 || !baseRec || ri < 0) return;
    const rec = (recsOut || recs)[ri], bst = baseRec.robTook && Array.isArray(baseRec.robTook[bid]) ? baseRec.robTook[bid] : null;
    const was = bst ? [num(bst[0]), num(bst[1])] : [took(baseRec, 'vlsfoAct', barges[i].name), took(baseRec, 'mgoAct', barges[i].name)];
    const txt = String(rec.barge || '').trim(), names = barges.map(function(x) { return x && String(x.name || '').trim(); });
    const on = txt === '' ? barges.length === 1 || !!(bst && String(bst[3]) === '') : txt === String(barges[i].name || '').trim() || names.indexOf(txt) === -1;
    const now = on ? [num(rec.vlsfoAct), num(rec.mgoAct)] : [0, 0];
    if (bst) [0, 1].forEach(function(g) { if (num(bst[g]) < num(bst[4 + g])) now[g] = Math.min(now[g], num(bst[g])); });
    const E = [0, 1].map(function(g) { const k = g ? 'm' : 'v'; return !num(le[k]) && !num(re[k]) ? 0 : was[g] - now[g]; });
    reloadsOut = reloadsOut || reloads.slice();
    reloadsOut[idx] = Object.assign({}, ev, { v: E[0], m: E[1] });
    const stp = /_(\d+)$/.exec(String(ev.id));
    recsOut = recsOut || recs.slice();
    recsOut[ri] = Object.assign({}, rec, { robTook: Object.assign({}, rec.robTook || {}) });
    recsOut[ri].robTook[bid] = [now[0], now[1], bst ? num(bst[2]) : 0, bst ? bst[3] : txt, num(rec.vlsfoAct), num(rec.mgoAct), stp ? +stp[1] : 1];
    const lb = bargeOf(l, bid), rb = bargeOf(r, bid);
    let nb = null;
    [['vrob', 'v', 0], ['mrob', 'm', 1]].forEach(function(g) {
      const mv = num(barges[i][g[0]]);
      const from = lb && num(lb[g[0]]) === mv && list(lB, bid).indexOf(String(ev.id)) !== -1 ? le : rb && num(rb[g[0]]) === mv && list(rB, bid).indexOf(String(ev.id)) !== -1 ? re : null;
      const adj = from ? E[g[2]] - num(from[g[1]]) : 0;
      if (!adj) return;
      nb = nb || Object.assign({}, barges[i]);
      nb[g[0]] = Math.max(0, Math.round(num(nb[g[0]]) + adj));
    });
    if (nb) { barges[i] = nb; changed = true; }
  });
  if (ctx && Array.isArray(ctx.conflicts) && Object.keys(resolved).length) ctx.conflicts = ctx.conflicts.filter(function(p) { return !resolved[p]; });
  if (!changed && !reloadsOut && !recsOut) return m;
  const st = Object.assign({}, m.state);
  if (changed) st.barges = barges;
  if (reloadsOut) st.bargeReloads = reloadsOut;
  return Object.assign({}, m, { state: st }, recsOut ? { records: recsOut } : {});
}

