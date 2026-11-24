/* ─── LIVE PREVIEW ─── */
function upd(id) {
  _qtyHints(id);
  const lcR = document.getElementById(`v${id}-lc`)?.value || '';
  const etR = document.getElementById(`v${id}-eta`)?.value || '';
  const ty  = document.getElementById(`v${id}-type`)?.value;
  const vq  = ty === 'MGO'   ? 0 : _cardQty(id, 'vlsfo').qty;
  const mq  = ty === 'VLSFO' ? 0 : _cardQty(id, 'mgo').qty;
  const lcEl = document.getElementById(`v${id}-lc`), etEl = document.getElementById(`v${id}-eta`);
  const hLC = document.getElementById(`v${id}-hlc`), hET = document.getElementById(`v${id}-het`);
  const prev = document.getElementById(`v${id}-prev`), lcbx = document.getElementById(`v${id}-lcbox`);
  const win = _cardEtaWin(id);
  const lc = parseLaycan(lcR), eta0 = parseDT(etR);
  // Time-frame ETA: planned from the frame start, worst case arrives at its end.
  const eta = (eta0 && win) ? _etaFrameStart(eta0, win) : eta0;
  const etaEnd = (eta && win) ? _etaFrameEnd(eta, win) : eta;
  const winHrs = win ? _etaFrameHrs(win) : 0;
  if (lc) { hLC.textContent='→ '+fmtLC(lc); hLC.className='hint ok'; lcEl.classList.remove('err'); }
  else if (lcR) { hLC.textContent='Using Actual ETA for scheduling'; hLC.className='hint inf'; lcEl.classList.remove('err'); }
  else { hLC.textContent=''; hLC.className='hint'; lcEl.classList.remove('err'); }
  if (etR&&!eta) { hET.textContent='Cannot parse — try: 24 Mar 2025 08:00'; hET.className='hint er'; etEl.classList.add('err'); }
  else if (eta) { hET.textContent='→ '+(win ? _fmtEtaWin(eta, win) : fmt24(eta)); hET.className='hint ok'; etEl.classList.remove('err'); }
  else if (win) { hET.textContent='Pick the date — '+_etaFrameTxt(win); hET.className='hint inf'; etEl.classList.remove('err'); }
  else { hET.textContent=''; hET.className='hint'; etEl.classList.remove('err'); }
  if (eta) {
    // Pump rates of the barge that will do this supply (the assigned one,
    // or the only one) — not a hard-coded 300/100 MT/h.
    let vtph = 300, mtph = 100;
    try {
      const fleet = (typeof getBarges === 'function') ? getBarges() : [];
      const selB = document.getElementById(`v${id}-barge`)?.value || '';
      const bg = fleet.find(function(b) { return String(b.id) === String(selB); }) || (fleet.length === 1 ? fleet[0] : null);
      if (bg) { vtph = bg.vtph || vtph; mtph = bg.mtph || mtph; }
    } catch(e) {}
    // Frame: worst-case finish = frame END + the normal supply duration.
    const supHrs = _calcParams.hoseHrs+Math.max(vq/vtph,mq/mtph);
    const etc=calcETC(etaEnd,vq,mq,vtph,mtph); prev.className='etc-prev show';
    prev.innerHTML = win
      ? `<strong>ETA:</strong> ${esc(_fmtEtaWin(eta, win))} &nbsp;→&nbsp; <strong>ETC:</strong> ${fmt24(etc)} <span style="color:var(--muted)">latest</span> &nbsp;<span style="color:var(--muted)">(barge ready from ${pad(eta.getHours())}:00 · ${durStr(winHrs)} frame + ${durStr(supHrs)} supply)</span>`
      : `<strong>ETA:</strong> ${fmt24(eta)} &nbsp;→&nbsp; <strong>ETC:</strong> ${fmt24(etc)} &nbsp;<span style="color:var(--muted)">(${durStr(supHrs)} total)</span>`;
  }
  else { prev.className='etc-prev'; }
  if (lc&&eta) {
    // Frame: early only if even its END is before laycan opens; late if its START is after it closes.
    if (etaEnd>=lc.from&&eta<=lc.to) { lcbx.className='lc-box ok show'; lcbx.innerHTML=`ETA${win?' frame':''} is <strong>within laycan</strong> (${fmtLC(lc)}).`; }
    // After laycan closes = genuinely late — this is the case the dashboard's
    // "Delayed" / "Requires immediate action" alert is built around, so it
    // gets the urgent red styling, not the milder amber it had before.
    else if (eta>lc.to) { const dh=((eta-lc.to)/3600000).toFixed(1); lcbx.className='lc-box late show'; lcbx.innerHTML=`ETA is <strong>${dh} hrs after laycan closes — Delayed</strong> (${fmtLC(lc)}). Vessel slotted after on-laycan supplies.`; }
    // Before laycan opens = arriving early, not a problem — this was
    // previously using the SAME red "late" class as a genuine delay, making
    // an early arrival look just as alarming as one that's actually overdue.
    else { lcbx.className='lc-box early show'; lcbx.innerHTML=`ETA${win?' frame':''} is <strong>before laycan opens — Before Laycan</strong> (${fmtLC(lc)}).`; }
  } else { lcbx.className='lc-box'; }
  // auto-save on change (debounced) — also refresh the dashboard so the
  // Operational Activity card picks up the new ETA/quantity right away.
  // (The MutationObserver on #vc only fires when cards are added/removed;
  // it never fires for a value changing inside an existing card, which is
  // exactly what happens when you re-pick a vessel's ETA.)
  clearTimeout(upd._t);
  upd._t = setTimeout(function(){
    saveSharedState();
    if (typeof refreshDashboard === 'function') refreshDashboard();
  }, 1200);
}

function tQ(id) {
  const t = document.getElementById(`v${id}-type`)?.value;
  document.getElementById(`v${id}-vw`).style.display = t==='MGO' ? 'none' : '';
  document.getElementById(`v${id}-mw`).style.display = t==='VLSFO' ? 'none' : '';
}

/* ─── UNDO DELETE VESSEL ─── */
let _deletedVesselStack = []; // stack of {def, position}

function rmV(id) {
  const card = document.getElementById(`vessel-${id}`);
  if (!card) return;
  const name     = document.getElementById(`v${id}-name`)?.value || '';
  const imo      = document.getElementById(`v${id}-imo`)?.value || '';
  const area     = document.getElementById(`v${id}-area`)?.value || 'FUJ-A';
  const type     = document.getElementById(`v${id}-type`)?.value || 'VLSFO';
  const qty      = _cardQty(id, 'vlsfo').qty;
  const mgo      = _cardQty(id, 'mgo').qty;
  const spec     = document.getElementById(`v${id}-spec`)?.value || '';
  const agent    = document.getElementById(`v${id}-agent`)?.value || '';
  const manifold = document.getElementById(`v${id}-manifold`)?.value || '';
  const lc       = document.getElementById(`v${id}-lc`)?.value || '';
  const eta      = document.getElementById(`v${id}-eta`)?.value || '';
  const remarks  = document.getElementById(`v${id}-remarks`)?.value || '';
  const paq      = document.getElementById(`v${id}-paq`)?.value || 'no';
  const bargeId  = document.getElementById(`v${id}-barge`)?.value || '';
  const refuelChk= document.getElementById(`v${id}-refuel-chk`)?.checked || false;
  const rfv      = parseFloat(document.getElementById(`v${id}-rfv`)?.value) || 0;
  const rfm      = parseFloat(document.getElementById(`v${id}-rfm`)?.value) || 0;
  const rfvr     = parseFloat(document.getElementById(`v${id}-rfvr`)?.value) || 750;
  const rfmr     = parseFloat(document.getElementById(`v${id}-rfmr`)?.value) || 275;

  // Removing a nomination and cancelling it were previously two completely
  // disconnected actions — deleting here never sent any email to Ops,
  // for anyone, operator or trader. If this nomination hasn't already had
  // a cancellation email sent (via the card's own "Cancel Nomination"
  // button), offer to send one now in the same step, so a deletion can't
  // silently happen with Ops never being told.
  const nomUidForCancel = card.dataset.nomUid;
  const alreadyCancelled = !!(nomUidForCancel && _nomCancelEmailLog[nomUidForCancel] && _nomCancelEmailLog[nomUidForCancel].emailSent);
  if (name && !alreadyCancelled) {
    if (confirm(`Also send a "Nomination Cancelled" email to Ops for ${name}?\n\n(Choose Cancel if you're just correcting/redoing this entry — nothing will be emailed.)`)) {
      sendNominationCancelledEmailIfNeeded(Object.assign({
        nomUid: nomUidForCancel, name, imo, area, type, qty, mgo,
        agent, manifold, spec, lc, eta, remarks
      }, _cardQtyRangeFields(id), _cardEtaWinFields(id), _cardLcOnlyFields(id), _cardIdFields(id)));
    }
  }
  _trashVesselCard(id);
}
// The card → Trash (restorable), its draft checklist rows dropped, the card
// removed. opts.mergedInto: merged into another card (Duplicates) — nothing
// is emailed, and the removal is immediate.
function _trashVesselCard(id, opts) {
  const card = document.getElementById(`vessel-${id}`);
  if (!card) return;
  const name     = document.getElementById(`v${id}-name`)?.value || '';
  const imo      = document.getElementById(`v${id}-imo`)?.value || '';
  const area     = document.getElementById(`v${id}-area`)?.value || 'FUJ-A';
  const type     = document.getElementById(`v${id}-type`)?.value || 'VLSFO';
  const qty      = _cardQty(id, 'vlsfo').qty;
  const mgo      = _cardQty(id, 'mgo').qty;
  const spec     = document.getElementById(`v${id}-spec`)?.value || '';
  const agent    = document.getElementById(`v${id}-agent`)?.value || '';
  const manifold = document.getElementById(`v${id}-manifold`)?.value || '';
  const lc       = document.getElementById(`v${id}-lc`)?.value || '';
  const eta      = document.getElementById(`v${id}-eta`)?.value || '';
  const remarks  = document.getElementById(`v${id}-remarks`)?.value || '';
  const paq      = document.getElementById(`v${id}-paq`)?.value || 'no';
  const bargeId  = document.getElementById(`v${id}-barge`)?.value || '';
  const refuelChk= document.getElementById(`v${id}-refuel-chk`)?.checked || false;
  const rfv      = parseFloat(document.getElementById(`v${id}-rfv`)?.value) || 0;
  const rfm      = parseFloat(document.getElementById(`v${id}-rfm`)?.value) || 0;
  const rfvr     = parseFloat(document.getElementById(`v${id}-rfvr`)?.value) || 750;
  const rfmr     = parseFloat(document.getElementById(`v${id}-rfmr`)?.value) || 275;
  const nomUidForCancel = card.dataset.nomUid;

  // Move to Trash Bin instead of permanent delete
  const trashEntry = {
    id: id,
    trashedAt: Date.now(),
    // nomUid/imo/mmsi/remarks included so a restored vessel keeps its identity
    // (email log, checklist link) and its details — and a newer build's fields.
    def: Object.assign(_deepClone(card._newerFields) || {}, {nomUid: nomUidForCancel || '', name,imo,area,type,qty,mgo,spec,agent,manifold,lc,eta,remarks,paq,bargeId,refuelChk,rfv,rfm,rfvr,rfmr}, _cardQtyRangeFields(id), _cardEtaWinFields(id), _cardStsFields(id), _cardLcOnlyFields(id), _cardIdFields(id), _cardExtraFields(id))
  };
  if (opts && opts.mergedInto) { trashEntry.reason = 'merged'; trashEntry.mergedInto = opts.mergedInto; }
  _trashBin.push(trashEntry);
  _saveTrashBin();

  // Vessel removed from Nomination — it should no longer linger in the
  // Supply Checklist or the Remaining Supply Tracker. Drop only this
  // nomination's still-editable DRAFT record(s): never a locked / saved /
  // completed one, and never another call of a vessel with the same name.
  (function _purgeChecklistForRemovedVessel() {
    if (!name || typeof _checklistRecords !== 'object') return;
    const item = { name: name, nomUid: nomUidForCancel || null, eta: parseDT(eta) };
    Object.keys(_checklistRecords).forEach(function(uid) {
      const rec = _checklistRecords[uid];
      if (!rec || rec.lockedAt || rec.state === 'saved' || rec.state === 'completed') return;
      const matches = (rec.nomUid && item.nomUid) ? rec.nomUid === item.nomUid : _recordMatchesScheduleItem(rec, item);
      if (matches) delete _checklistRecords[uid];
    });
  })();
  if (typeof _rstSelected !== 'undefined') {
    // Also drop any tick-mark selection tied to the removed vessel's uid(s)
    Array.from(_rstSelected).forEach(function(uid){ if (!_checklistRecords[uid]) _rstSelected.delete(uid); });
  }

  if (opts && opts.mergedInto) { card.remove(); return; } // the caller saves and re-renders once
  card.style.transition = 'opacity .25s, transform .25s';
  card.style.opacity = '0';
  card.style.transform = 'translateX(20px)';
  setTimeout(() => {
    card.remove();
    renumberVessels();
    saveSharedState();
    renderTrashBin();
    showTrashBanner(name);
    if (typeof renderChecklist === 'function') renderChecklist(_lastSched || []);
    if (typeof renderRemainingSupplyTracker === 'function') renderRemainingSupplyTracker();
    if (typeof _dupRefreshSoon === 'function') _dupRefreshSoon();
  }, 250);
}

// Remove vessel nomination card when supply is saved/completed in checklist
function removeNominationByName(vesselName) {
  if (!vesselName) return;
  const target = vesselName.trim().toUpperCase().replace(/\s+/g, ' ');
  // Find the vessel card matching this name
  var cards = document.querySelectorAll('.vcard[id^="vessel-"]');
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    var cid = card.id.replace('vessel-', '');
    var nameEl = document.getElementById('v' + cid + '-name');
    var cardName = nameEl ? (nameEl.value || '').trim().toUpperCase().replace(/\s+/g, ' ') : '';
    if (nameEl && cardName === target) {
      // Remove immediately and synchronously — a delayed/animated removal can
      // leave the card in the DOM if the user clicks "Generate Schedule" before
      // the fade-out timer fires, which then re-reads the stale card and makes
      // the vessel reappear in the Nomination Register / Voyage Schedule.
      card.remove();
      renumberVessels();
      saveSharedState();
      break;
    }
  }
}


// (declared at top level)

function renderTrashBin() {
  const container = document.getElementById('trash-bin-section');
  const list = document.getElementById('trash-bin-list');
  if (!container || !list) return;

  if (_trashBin.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = '';

  list.innerHTML = _trashBin.map((entry, idx) => {
    const d = entry.def;
    const trashedTime = new Date(entry.trashedAt).toLocaleString();
    const fuelLine = d.type === 'BOTH'
      ? `VLSFO ${esc(_vesselQtyTxt(d, 'qty'))} MT + MGO ${esc(_vesselQtyTxt(d, 'mgo'))} MT`
      : d.type === 'MGO' ? `MGO ${esc(_vesselQtyTxt(d, 'mgo'))} MT` : `VLSFO ${esc(_vesselQtyTxt(d, 'qty'))} MT`;
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--surface);border:none;box-shadow:var(--sh-xs);border-radius:8px;margin-bottom:8px;gap:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:180px">
        <div style="font-size:13px;font-weight:700;color:var(--ink)">${esc(d.name || '(unnamed vessel)')}</div>
        <div style="font-size:11px;color:var(--sub);margin-top:2px">${fuelLine} · ${esc(d.area)} · ${entry.reason === 'merged' ? 'Merged into another card (Duplicates)' : 'Removed'}: ${esc(trashedTime)}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button onclick="restoreFromTrash(${idx})" style="padding:6px 14px;background:var(--green-lt);border:1.5px solid var(--green-bd);border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;color:var(--green);font-family:DM Sans,sans-serif">↩ Restore</button>
        <button onclick="permanentDeleteFromTrash(${idx})" style="padding:6px 12px;background:var(--red-lt);border:1.5px solid var(--red-bd);border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;color:var(--red);font-family:DM Sans,sans-serif"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Delete Forever</button>
      </div>
    </div>`;
  }).join('');
}

function restoreFromTrash(idx) {
  const entry = _trashBin[idx];
  if (!entry) return;
  _trashBin.splice(idx, 1);
  _saveTrashBin();
  addVessel(entry.def);
  renderTrashBin();
  saveSharedState();
  if (typeof _dupRefreshSoon === 'function') _dupRefreshSoon();
}

function permanentDeleteFromTrash(idx) {
  if (!confirm('Permanently delete this vessel? This cannot be undone.')) return;
  _trashBin.splice(idx, 1);
  _saveTrashBin();
  renderTrashBin();
  saveSharedState();
}

function clearTrashBin() {
  if (!_trashBin.length) return;
  if (!confirm(`Permanently delete all ${_trashBin.length} vessel(s) in the Trash Bin?`)) return;
  _trashBin = [];
  _saveTrashBin();
  renderTrashBin();
  saveSharedState();
}

function showTrashBanner(name) {
  let banner = document.getElementById('trash-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'trash-banner';
    banner.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;background:var(--ink-solid);color:#fff;border-radius:12px;padding:12px 20px;font-size:13px;font-weight:600;font-family:DM Sans,sans-serif;display:flex;align-items:center;gap:14px;box-shadow:0 8px 32px rgba(13,27,42,.35);transition:opacity .3s,transform .3s;white-space:nowrap';
    document.body.appendChild(banner);
  }
  banner.innerHTML = `<span><strong>${esc(name||'Vessel')}</strong> moved to Trash</span><button onclick="restoreFromTrash(_trashBin.length-1)" style="background:var(--azure);color:#fff;border:none;border-radius:7px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif">Undo</button><button onclick="hideTrashBanner()" style="background:rgba(255,255,255,.12);color:#fff;border:none;border-radius:7px;padding:6px 10px;font-size:12px;cursor:pointer"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
  banner.style.opacity = '1';
  banner.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(showTrashBanner._t);
  showTrashBanner._t = setTimeout(hideTrashBanner, 8000);
}
function hideTrashBanner() {
  const b = document.getElementById('trash-banner');
  if (b) { b.style.opacity='0'; b.style.transform='translateX(-50%) translateY(20px)'; setTimeout(()=>b.remove(),300); }
}

let _undoBannerTimeout = null;
function showUndoBanner(name) {
  let banner = document.getElementById('undo-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'undo-banner';
    banner.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;background:var(--ink-solid);color:#fff;border-radius:12px;padding:12px 20px;font-size:13px;font-weight:600;font-family:DM Sans,sans-serif;display:flex;align-items:center;gap:14px;box-shadow:0 8px 32px rgba(13,27,42,.35);transition:opacity .3s,transform .3s;white-space:nowrap';
    document.body.appendChild(banner);
  }
  banner.innerHTML = `<span><strong>${esc(name||'Vessel')}</strong> removed</span><button onclick="undoLastVesselDelete()" style="background:var(--azure);color:#fff;border:none;border-radius:7px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif">Undo</button><button onclick="hideUndoBanner()" style="background:rgba(255,255,255,.12);color:#fff;border:none;border-radius:7px;padding:6px 10px;font-size:12px;cursor:pointer"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
  banner.style.opacity = '1';
  banner.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(_undoBannerTimeout);
  _undoBannerTimeout = setTimeout(hideUndoBanner, 8000);
}
function hideUndoBanner() {
  const b = document.getElementById('undo-banner');
  if (b) { b.style.opacity='0'; b.style.transform='translateX(-50%) translateY(20px)'; setTimeout(()=>b.remove(),300); }
}
function undoLastVesselDelete() {
  if (!_deletedVesselStack.length) return;
  const {def} = _deletedVesselStack.pop();
  addVessel(def);
  hideUndoBanner();
  saveSharedState();
  // Flash the restored vessel card
  setTimeout(() => {
    const cards = document.querySelectorAll('.vcard[id^="vessel-"]');
    if (cards.length) {
      const last = cards[cards.length-1];
      last.style.background = 'var(--azure-lt)';
      last.style.transition = 'background 1s';
      setTimeout(() => { last.style.background = ''; }, 1500);
    }
  }, 100);
}

function renumberVessels() {
  let n = 1;
  document.querySelectorAll('.vcard[id^="vessel-"]').forEach(function(card) {
    var numEl = card.querySelector('.vnum');
    if (numEl) numEl.textContent = 'VESSEL ' + String(n++).padStart(2,'0');
    var cid = card.id.replace('vessel-',''); if(cid) { var te=document.getElementById('v'+cid+'-type'); if(te) tQ(cid); }
  });
}


/* ─── Deal Done Date (nomination card) ─── a date only ('YYYY-MM-DD'), empty
   until picked; saved on the vessel as dealDate only when set. */
function _dealDateYmd(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10), dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? s : ''; // a real day (no 31 Feb)
}
// Fields a card keeps beyond its inputs: dealDate, dupOk, mergedFrom — each only when set.
function _cardExtraFields(id) {
  const out = {}, card = document.getElementById('vessel-' + id);
  const dd = _dealDateYmd((document.getElementById('v' + id + '-dealdate') || {}).value);
  if (dd) out.dealDate = dd;
  if (card && Array.isArray(card._dupOk) && card._dupOk.length) out.dupOk = card._dupOk.slice();
  if (card && Array.isArray(card._mergedFrom) && card._mergedFrom.length) out.mergedFrom = _deepClone(card._mergedFrom);
  return out;
}
// The Deal Done Date of a nomination (by nomUid, else by name) — '' when none.
function _dealDateForNom(nomUid, name) {
  const cards = Array.prototype.slice.call(document.querySelectorAll('.vcard[id^="vessel-"]'));
  let c = nomUid ? cards.find(function(x) { return x.dataset.nomUid === nomUid; }) : null;
  if (!c && name) { const k = _normVesselKey(name); c = cards.find(function(x) { return _normVesselKey((document.getElementById('v' + x.id.replace('vessel-', '') + '-name') || {}).value) === k; }); }
  return c ? _dealDateYmd((document.getElementById('v' + c.id.replace('vessel-', '') + '-dealdate') || {}).value) : '';
}
function _dealDateTxt(ymd) {
  const s = _dealDateYmd(ymd);
  if (!s) return '';
  return new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* ─── Duplicates — more than one open card for one vessel ───
   Cards are the same vessel when their IMOs match (valid IMO) or their names
   match as the Track Record matches them ("M/T Hayat" = "HAYAT"). Cancelled
   nominations do not count. A group stops being listed once its cards are
   marked as separate calls (each card keeps the others' nomUids in dupOk).
   Merge (operators): keep one card; the others go to the Trash (restorable,
   nothing is emailed) and the kept card notes what was merged into it. */
function _dupCardInfo(card) {
  const id = card.id.replace('vessel-', '');
  const g = function(s) { return document.getElementById('v' + id + '-' + s); };
  const name = ((g('name') || {}).value || '').trim();
  const ids = _cardIds(id), imoN = _vidNorm(ids.imo);
  const type = (g('type') || {}).value || 'VLSFO';
  const def = Object.assign({ type: type, qty: _cardQty(id, 'vlsfo').qty, mgo: _cardQty(id, 'mgo').qty }, _cardQtyRangeFields(id));
  const qt = function(k) { const t = String(_vesselQtyTxt(def, k)); return /^\d+(\.\d+)?$/.test(t) ? Number(t).toLocaleString('en-US') : t; }; // 1,000
  const qtyTxt = type === 'BOTH' ? 'VLSFO ' + qt('qty') + ' + MGO ' + qt('mgo') + ' MT'
    : type === 'MGO' ? 'MGO ' + qt('mgo') + ' MT' : 'VLSFO ' + qt('qty') + ' MT';
  const area = (g('area') || {}).value || '';
  const bSel = g('barge');
  const nomUid = card.dataset.nomUid || '';
  return { id: id, card: card, nomUid: nomUid, name: name, key: _trVesselKey(name), imo: _imoValid(imoN) ? imoN : '',
    num: ((card.querySelector('.vnum') || {}).textContent || '').trim(), qtyTxt: qtyTxt,
    area: (AREA_OPTIONS.find(function(o) { return o.value === area; }) || {}).label || area,
    eta: ((g('eta') || {}).value || '').trim(), lc: ((g('lc') || {}).value || '').trim(),
    barge: bSel && bSel.value ? (bSel.options[bSel.selectedIndex] || {}).text || '' : 'Auto',
    deal: _dealDateTxt((g('dealdate') || {}).value),
    emailed: !!(nomUid && typeof _nomEmailLog === 'object' && _nomEmailLog[nomUid] && _nomEmailLog[nomUid].emailSent),
    cancelled: !!(nomUid && typeof _nomCancelEmailLog === 'object' && _nomCancelEmailLog[nomUid] && _nomCancelEmailLog[nomUid].emailSent),
    dupOk: Array.isArray(card._dupOk) ? card._dupOk : [] };
}
function _dupGroups() {
  const cards = Array.prototype.slice.call(document.querySelectorAll('#vc .vcard[id^="vessel-"]')).map(_dupCardInfo)
    .filter(function(c) { return c.key && !c.cancelled; });
  const parent = cards.map(function(_, i) { return i; });
  const find = function(i) { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const join = function(a, b) { parent[find(a)] = find(b); };
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
    if (cards[i].key === cards[j].key || (cards[i].imo && cards[i].imo === cards[j].imo)) join(i, j);
  }
  const by = {};
  cards.forEach(function(c, i) { const r = find(i); (by[r] = by[r] || []).push(c); });
  const sep = function(a, b) { return a.dupOk.indexOf(b.nomUid) !== -1 || b.dupOk.indexOf(a.nomUid) !== -1; };
  return Object.keys(by).map(function(k) { return by[k]; }).filter(function(g) {
    if (g.length < 2) return false;
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) if (!sep(g[i], g[j])) return true;
    return false; // every pair confirmed as separate calls
  });
}
let _dupTimer = null;
function _dupRefreshSoon() {
  clearTimeout(_dupTimer);
  _dupTimer = setTimeout(function() { _dupTimer = null; try { renderDupBanner(); } catch (e) { console.warn('ABPS: duplicates check failed', e); } }, 300);
}
function renderDupBanner() {
  const el = document.getElementById('dup-banner');
  const groups = _dupGroups();
  if (el) {
    if (!groups.length) { el.hidden = true; el.innerHTML = ''; }
    else {
      el.hidden = false;
      el.innerHTML = '<span class="dup-ico" aria-hidden="true">⚠</span><span><b>' + groups.length + ' vessel' + (groups.length !== 1 ? 's have' : ' has') + ' more than one open nomination card</b> — ' +
        groups.map(function(g) { return esc(g[0].name) + ' (' + g.length + ')'; }).join(', ') + '</span>' +
        '<button type="button" class="btn btn-sm dup-review-btn" onclick="openDupModal()">Review duplicates</button>';
    }
  }
  const m = document.getElementById('dup-modal');
  if (m && m.style.display === 'flex') _dupRenderModal(groups);
}
function openDupModal() {
  let m = document.getElementById('dup-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'dup-modal'; m.className = 'dup-modal';
    m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'dup-modal-title');
    m.addEventListener('click', function(e) { if (e.target === m) closeDupModal(); });
    document.body.appendChild(m);
  }
  m.style.display = 'flex';
  _dupRenderModal(_dupGroups());
}
function closeDupModal() { const m = document.getElementById('dup-modal'); if (m) m.style.display = 'none'; }
function _dupRenderModal(groups) {
  const m = document.getElementById('dup-modal');
  if (!m) return;
  const op = !(typeof isTrader === 'function' && isTrader());
  const cell = function(v) { return '<td>' + (v ? esc(v) : '<span class="dup-none">—</span>') + '</td>'; };
  const body = !groups.length
    ? '<div class="dup-empty">No duplicates — every vessel has one open nomination card.</div>'
    : groups.map(function(g, gi) {
      return '<div class="dup-group" data-dup-group="' + gi + '">' +
        '<div class="dup-group-hdr"><b>' + esc(g[0].name) + '</b> — ' + g.length + ' open cards</div>' +
        '<div class="dup-tbl-wrap"><table class="dup-tbl"><thead><tr><th>Card</th><th>Quantity</th><th>Location</th><th>ETA</th><th>Laycan</th><th>Barge</th><th>Deal done</th><th>Nomination email</th>' + (op ? '<th></th>' : '') + '</tr></thead><tbody>' +
        g.map(function(c) {
          return '<tr data-nom-uid="' + esc(c.nomUid) + '"><td><b>' + esc(c.num || ('Card ' + c.id)) + '</b><div class="dup-sub">' + esc(c.name) + (c.imo ? ' · IMO ' + esc(c.imo) : '') + '</div></td>' +
            cell(c.qtyTxt) + cell(c.area) + cell(c.eta) + cell(c.lc) + cell(c.barge) + cell(c.deal) + '<td>' + (c.emailed ? '<span class="dup-sent">Sent ✓</span>' : '<span class="dup-none">Not sent</span>') + '</td>' +
            (op ? '<td><button type="button" class="btn btn-primary btn-sm dup-keep" onclick="dupKeep(' + JSON.stringify(c.nomUid).replace(/"/g, '&quot;') + ')">Keep this one</button></td>' : '') + '</tr>';
        }).join('') + '</tbody></table></div>' +
        (op ? '<div class="dup-actions"><button type="button" class="btn btn-secondary btn-sm dup-sep" onclick="dupSeparate(' + gi + ')">Not duplicates — separate calls</button>' +
          '<span class="dup-hint">Keep this one: the other card' + (g.length > 2 ? 's go' : ' goes') + ' to the Trash (restore from there); nothing is emailed.</span></div>'
          : '<div class="dup-hint">Only an operator can merge.</div>') +
      '</div>';
    }).join('');
  m.innerHTML = '<div class="dup-box"><div class="dup-box-hdr"><div id="dup-modal-title" class="dup-title">Duplicate nominations</div>' +
    '<button type="button" class="dup-x" onclick="closeDupModal()" aria-label="Close">✕</button></div>' +
    '<div class="dup-intro">Each vessel below has more than one open card. Keep the right one — the quantity, location and ETA of the card you keep are what the schedule, calendar, Calling Instructions and emails use.</div>' +
    body + '</div>';
}
function dupKeep(nomUid) {
  if (typeof isTrader === 'function' && isTrader()) return;
  const groups = _dupGroups();
  const g = groups.find(function(gr) { return gr.some(function(c) { return c.nomUid === nomUid; }); });
  if (!g) return;
  const keep = g.find(function(c) { return c.nomUid === nomUid; });
  const others = g.filter(function(c) { return c !== keep; });
  if (!confirm('Keep ' + (keep.num || keep.name) + ' — ' + keep.name + ', ' + keep.qtyTxt + ', ' + keep.area + (keep.eta ? ', ETA ' + keep.eta : '') + '?\n\n' +
    'The other ' + (others.length === 1 ? 'card goes' : others.length + ' cards go') + ' to the Trash (you can restore from there). Nothing is emailed.')) return;
  const kc = keep.card;
  kc._mergedFrom = Array.isArray(kc._mergedFrom) ? kc._mergedFrom : [];
  others.forEach(function(o) {
    kc._mergedFrom.push({ at: new Date().toISOString(), nomUid: o.nomUid, name: o.name, qty: o.qtyTxt, area: o.area, eta: o.eta });
    _trashVesselCard(o.id, { mergedInto: keep.nomUid });
  });
  renumberVessels();
  _dupRenderMergedNote(keep.id);
  saveSharedState();
  renderTrashBin();
  if (typeof renderChecklist === 'function') renderChecklist(_lastSched || []);
  if (typeof renderRemainingSupplyTracker === 'function') renderRemainingSupplyTracker();
  renderDupBanner();
  if (typeof _trSyncAlertsSoon === 'function') _trSyncAlertsSoon();
  if (typeof showToast === 'function') showToast(keep.name + ': kept ' + (keep.num || 'one card') + '; ' + others.length + ' other card' + (others.length !== 1 ? 's' : '') + ' moved to the Trash. Generate Schedule to update the calendar.', 'success', 8000);
}
function dupSeparate(gi) {
  if (typeof isTrader === 'function' && isTrader()) return;
  const g = _dupGroups()[gi];
  if (!g) return;
  g.forEach(function(c) {
    const set = Array.isArray(c.card._dupOk) ? c.card._dupOk.slice() : [];
    g.forEach(function(o) { if (o !== c && o.nomUid && set.indexOf(o.nomUid) === -1) set.push(o.nomUid); });
    c.card._dupOk = set;
  });
  saveSharedState();
  renderDupBanner();
  if (typeof showToast === 'function') showToast(g[0].name + ': marked as separate calls — not listed as duplicates any more.', 'success');
}
// "Merged with: HAYAT · VLSFO 750 MT · FUJ-A · ETA 21 Nov 2026 19:00 (24 Nov 10:15)"
function _dupRenderMergedNote(id) {
  const el = document.getElementById('v' + id + '-merged'), card = document.getElementById('vessel-' + id);
  if (!el || !card) return;
  const list = Array.isArray(card._mergedFrom) ? card._mergedFrom : [];
  el.innerHTML = list.length ? list.map(function(x) {
    const at = new Date(x.at);
    return '<div class="dup-merged-line">Merged with: ' + esc([x.name, x.qty, x.area, x.eta ? 'ETA ' + x.eta : ''].filter(Boolean).join(' · ')) +
      (isNaN(at.getTime()) ? '' : ' <span class="dup-merged-at">(' + esc(fmt24(at)) + ')</span>') + '</div>';
  }).join('') : '';
}
