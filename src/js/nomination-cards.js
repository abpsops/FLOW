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

  // Move to Trash Bin instead of permanent delete
  const trashEntry = {
    id: id,
    trashedAt: Date.now(),
    // nomUid/imo/mmsi/remarks included so a restored vessel keeps its identity
    // (email log, checklist link) and its details — and a newer build's fields.
    def: Object.assign(_deepClone(card._newerFields) || {}, {nomUid: nomUidForCancel || '', name,imo,area,type,qty,mgo,spec,agent,manifold,lc,eta,remarks,paq,bargeId,refuelChk,rfv,rfm,rfvr,rfmr}, _cardQtyRangeFields(id), _cardEtaWinFields(id), _cardStsFields(id), _cardLcOnlyFields(id), _cardIdFields(id))
  };
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
        <div style="font-size:11px;color:var(--sub);margin-top:2px">${fuelLine} · ${esc(d.area)} · Removed: ${esc(trashedTime)}</div>
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

