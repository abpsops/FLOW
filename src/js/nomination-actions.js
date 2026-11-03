/* ─── NSC PERSISTENT CHECK MANAGEMENT ─── */
// _nscCheckData declared at top of script

function clearAllNSCChecks() {
  if (!confirm('Clear all availability checks?')) return;
  // Fix #2: this clears ONLY the local UI results cache (_nscCheckData and
  // its rendered cards). It must never touch _manualROB, _bargeConfig, or
  // _savedSupplies — those are the persistent ROB storage layers and are
  // intentionally left completely untouched here.
  const list = document.getElementById('nsc-checks-list');
  if (list) list.innerHTML = '';
  const hdr = document.getElementById('nsc-checks-header');
  if (hdr) hdr.style.display = 'none';
  Object.keys(_nscCheckData).forEach(k => delete _nscCheckData[k]);
}

function deleteNSCCheck(checkId) {
  const card = document.getElementById(checkId);
  if (!card) return;
  delete _nscCheckData[checkId];
  card.style.transition = 'opacity .25s, transform .25s';
  card.style.opacity = '0';
  card.style.transform = 'translateX(20px)';
  setTimeout(() => {
    card.remove();
    const list = document.getElementById('nsc-checks-list');
    const hdr  = document.getElementById('nsc-checks-header');
    if (list && hdr && list.children.length === 0) hdr.style.display = 'none';
  }, 250);
}

function addNSCToNominations(checkId) {
  const data = _nscCheckData[checkId];
  if (!data) { alert('Check data not found — please run the check again.'); return; }
  const { vesselName, vesselETA, vReq, mReq } = data;
  const etaDate = vesselETA ? new Date(vesselETA) : null;
  const etaStr  = etaDate ? `${pad(etaDate.getDate())} ${MO[etaDate.getMonth()]} ${etaDate.getFullYear()} ${pad(etaDate.getHours())}:${pad(etaDate.getMinutes())}` : '';
  const type = vReq > 0 && mReq > 0 ? 'BOTH' : mReq > 0 ? 'MGO' : 'VLSFO';
  document.getElementById('vessel-nominations')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  addVessel({ name: vesselName || 'NSC Vessel', area: 'FUJ-A', type, qty: vReq || 0, mgo: mReq || 0, eta: etaStr, lc: '', paq: 'no' });
  setTimeout(() => {
    const cards = document.querySelectorAll('.vcard[id^="vessel-"]');
    if (cards.length) {
      const last = cards[cards.length - 1];
      last.style.background = 'var(--azure-lt)';
      last.style.border = '2px solid var(--azure)';
      last.style.transition = 'background 1.2s, border 1.2s';
      setTimeout(() => { last.style.background = ''; last.style.border = ''; }, 2500);
      last.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 300);
  const card = document.getElementById(checkId);
  if (card) {
    const flash = document.createElement('div');
    flash.style.cssText = 'background:var(--green);color:#fff;font-size:12px;font-weight:700;padding:8px 16px;text-align:center;';
    flash.textContent = 'Added to Vessel Nomination Register — scroll up to edit details';
    card.insertBefore(flash, card.children[1] || card.lastChild);
    setTimeout(() => flash.remove(), 4000);
  }
  saveSharedState();
}

/* ─────────────────────────────────────────────────────────────────────
   ADD NOMINATION FROM AVAILABILITY CHECK
   Reads the feasibility engine's computed nominationPlan for this check
   (single barge / split supply / delayed start) and creates the correct
   number of pre-filled nomination entries, each with its feasible barge
   already selected and its share of the quantity already set. Split
   supply produces one nomination entry per contributing barge.
   ───────────────────────────────────────────────────────────────────── */
function addNominationFromNSC(checkId) {
  const data = _nscCheckData[checkId];
  if (!data || !data.nominationPlan || !data.nominationPlan.entries || !data.nominationPlan.entries.length) {
    alert('No feasible allocation available for this check — please run the check again.');
    return;
  }
  const plan = data.nominationPlan;
  const baseType = (entryVQty, entryMQty) => entryVQty > 0 && entryMQty > 0 ? 'BOTH' : entryMQty > 0 ? 'MGO' : 'VLSFO';

  document.getElementById('vessel-nominations')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const createdIds = [];
  plan.entries.forEach((entry, idx) => {
    const etaDate = entry.eta ? new Date(entry.eta) : null;
    const etaStr  = etaDate ? `${pad(etaDate.getDate())} ${MO[etaDate.getMonth()]} ${etaDate.getFullYear()} ${pad(etaDate.getHours())}:${pad(etaDate.getMinutes())}` : '';
    const suffix  = plan.entries.length > 1 ? ` (Split ${idx + 1}/${plan.entries.length} — ${entry.bargeName})` : '';
    addVessel({
      name: (data.vesselName || 'NSC Vessel') + suffix,
      area: 'FUJ-A',
      type: baseType(entry.vQty, entry.mQty),
      qty: entry.vQty || 0,
      mgo: entry.mQty || 0,
      eta: etaStr,
      lc: '',
      paq: 'no'
    });
    const cards = document.querySelectorAll('.vcard[id^="vessel-"]');
    const last = cards[cards.length - 1];
    if (last) {
      createdIds.push(last.id);
      // Preselect the feasible barge the engine identified for this entry
      // (addVessel() synchronously calls populateBargeDropdowns(), so options exist already)
      const bargeSel = last.querySelector('select[id$="-barge"]');
      if (bargeSel) bargeSel.value = String(entry.bargeId);
    }
  });

  setTimeout(() => {
    createdIds.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.style.background = 'var(--azure-lt)';
      el.style.border = '2px solid var(--green)';
      el.style.transition = 'background 1.2s, border 1.2s';
      setTimeout(() => { el.style.background = ''; el.style.border = ''; }, 2500);
    });
    const firstEl = createdIds[0] && document.getElementById(createdIds[0]);
    if (firstEl) firstEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 350);

  const card = document.getElementById(checkId);
  if (card) {
    const flash = document.createElement('div');
    flash.style.cssText = 'background:var(--green);color:#fff;font-size:12px;font-weight:700;padding:8px 16px;text-align:center;';
    flash.textContent = plan.entries.length > 1
      ? `Added ${plan.entries.length} nominations to the Vessel Register — one per feasible barge from the split supply plan`
      : `Added to Vessel Nomination Register — ${plan.entries[0].bargeName} preselected`;
    card.insertBefore(flash, card.children[1] || card.lastChild);
    setTimeout(() => flash.remove(), 4500);
  }
  saveSharedState();
}
let _perBargeDetailOpen = false;
function togglePerBargeDetail() {
  const el = document.getElementById('nsc-per-barge');
  const btn = document.getElementById('per-barge-toggle-btn');
  _perBargeDetailOpen = !_perBargeDetailOpen;
  el.style.display = _perBargeDetailOpen ? 'block' : 'none';
  btn.textContent = (_perBargeDetailOpen ? '▲ Hide' : '▼ Show') + ' Details';
}

function renderNSCPerBarge(barges, bargeState) {
  const wrap = document.getElementById('nsc-per-barge');
  if (!wrap) return;
  wrap.innerHTML = barges.map(b => {
    const bs = bargeState[b.id]; if (!bs) return '';
    return `<div class="nsc-panel">
      <div class="nsc-panel-header"><div class="nsc-barge-dot"></div><div style="font-size:13px;font-weight:700;color:var(--ink);font-family:DM Sans,sans-serif">${esc(b.name)} — ROB Detail</div></div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
        <div class="rob-stat"><div class="rob-stat-label">VLSFO ROB</div><div class="rob-stat-val">${Math.round(bs.rv).toLocaleString()}</div><div class="rob-stat-sub">MT remaining</div></div>
        <div class="rob-stat"><div class="rob-stat-label">VLSFO Cap</div><div class="rob-stat-val">${b.vcap.toLocaleString()}</div><div class="rob-stat-sub">MT capacity</div></div>
        <div class="rob-stat"><div class="rob-stat-label">MGO ROB</div><div class="rob-stat-val">${Math.round(bs.rm).toLocaleString()}</div><div class="rob-stat-sub">MT remaining</div></div>
        <div class="rob-stat"><div class="rob-stat-label">Last ETC</div><div class="rob-stat-val" style="font-size:11px">${bs.cursor?fmt24(bs.cursor):'—'}</div><div class="rob-stat-sub">free after this</div></div>
      </div>
    </div>`;
  }).join('');
}

/* ─── PAQ ─── */
function renderPAQReminders(sched) {
  const now = new Date();
  // Skip nominations already supplied, and only remind for vessels that
  // haven't arrived yet — a PAQ reminder for a vessel already alongside (or
  // gone) is noise.
  const pending = sched.filter(item => item.paq !== 'yes' && !_isScheduleItemCompleted(item));
  const reminders = pending.filter(item => item.eta && item.eta >= now && (item.eta-now)/86400000 <= 3);
  const el = document.getElementById('paq-panel'); if (!el) return;
  if (!pending.length) { el.innerHTML = `<div class="apanel clear"><div class="apt"><div class="apdot"></div>PAQ STATUS</div><div class="arow">All vessels have PAQ received.</div></div>`; return; }
  let html = '';
  if (reminders.length) {
    html += `<div class="apanel fired" style="margin-bottom:10px"><div class="apt"><div class="apdot"></div>PAQ REMINDER — ${reminders.length} vessel${reminders.length>1?'s':''} arriving within 3 days</div>`;
    reminders.forEach((item,i) => { const daysLeft=Math.max(0,((item.eta-now)/86400000)).toFixed(1); html+=`<div class="arow"><div class="snum">${i+1}</div><div><strong>${esc(item.name)}</strong> — ETA ${_itemEtaTxt(item)} (${daysLeft} days away). PAQ not received. <strong>Send reminder now.</strong></div></div>`; });
    html += '</div>';
  }
  const others = pending.filter(item => !reminders.includes(item));
  if (others.length) {
    html += `<div class="apanel" style="background:var(--amber-lt);border-color:var(--amber-bd)"><div class="apt" style="color:var(--amber)"><div class="apdot" style="background:var(--amber)"></div>PAQ PENDING — ${others.length} vessel${others.length>1?'s':''}</div>`;
    others.forEach((item,i) => { const eta=item.eta?(item.eta<now?`Arrived ${_itemEtaTxt(item)}`:`ETA ${_itemEtaTxt(item)}`):'ETA unknown'; html+=`<div class="arow" style="color:var(--amber)"><div class="snum" style="background:var(--amber-lt);color:var(--amber)">${i+1}</div><div><strong>${esc(item.name)}</strong> — ${eta}. Send reminder 2-3 days before arrival.</div></div>`; });
    html += '</div>';
  }
  el.innerHTML = html;
}

/* ─── BARGE SCHEDULE REMINDERS ─── */
let _reminderInterval = null;
let _dismissedReminders = new Set();
// Reminder identity = the nomination (nomUid), falling back to name + ETA.
// It used to be the schedule's sno, which is just a position number that
// changes every regenerate — so dismissals hit the wrong vessel and every
// 5-minute refresh re-fired the same OS notification.
function _reminderKey(item) {
  if (item && item.nomUid) return 'n:' + item.nomUid;
  var t = item && item.eta ? new Date(item.eta).getTime() : '';
  return 'v:' + String((item && item.name) || '').trim().toLowerCase() + '|' + t;
}
function _reminderDomId(key) { return 'reminder-row-' + String(key).replace(/[^A-Za-z0-9_-]/g, '_'); }
// Keys ("<reminderKey>#<threshold>") already notified this session — in
// memory and in sessionStorage so a reload doesn't re-notify either.
const _NOTIFIED_REMINDERS_KEY = 'flow_notified_reminders';
let _notifiedReminders = (function() {
  try { return new Set(JSON.parse(sessionStorage.getItem(_NOTIFIED_REMINDERS_KEY) || '[]')); } catch (e) { return new Set(); }
})();
function _saveNotifiedReminders() {
  try { sessionStorage.setItem(_NOTIFIED_REMINDERS_KEY, JSON.stringify(Array.from(_notifiedReminders))); } catch (e) {}
}

function renderScheduleReminders() {
  const el = document.getElementById('reminder-panel');
  const lastCheck = document.getElementById('reminder-last-check');
  if (!el) return;
  if (lastCheck) lastCheck.textContent = `Last checked: ${new Date().toLocaleTimeString()}`;

  if (!_lastSched || !_lastSched.length) {
    el.innerHTML = `<div style="font-size:13px;color:var(--muted);text-align:center;padding:16px">Generate the schedule first to see reminders.</div>`;
    return;
  }

  const now = new Date();
  // Vessels arriving within 24–30 hours (already-supplied nominations skipped)
  const urgent   = _lastSched.filter(item => {
    if (!item.eta || _isScheduleItemCompleted(item)) return false;
    const hrsAway = (item.eta - now) / 3600000;
    return hrsAway >= 0 && hrsAway <= 24;
  });
  const upcoming = _lastSched.filter(item => {
    if (!item.eta || _isScheduleItemCompleted(item)) return false;
    const hrsAway = (item.eta - now) / 3600000;
    return hrsAway > 24 && hrsAway <= 30;
  });
  const arrived  = _lastSched.filter(item => {
    if (!item.eta || _isScheduleItemCompleted(item)) return false;
    const hrsAway = (item.eta - now) / 3600000;
    return hrsAway < 0 && hrsAway > -6; // arrived within last 6 hrs
  });

  if (!urgent.length && !upcoming.length && !arrived.length) {
    el.innerHTML = `<div style="background:var(--green-lt);border:1.5px solid var(--green-bd);border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:12px">
      <div style="font-size:24px"></div>
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--green)">No urgent reminders</div>
        <div style="font-size:12px;color:var(--green);margin-top:2px">No vessels arriving within the next 30 hours. All clear.</div>
      </div>
    </div>`;
    return;
  }

  let html = '';

  // ARRIVED — need immediate action
  if (arrived.length) {
    html += `<div style="background:var(--red-lt);border:2px solid var(--red-bd);border-radius:12px;padding:14px 18px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--red);letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:8px">
        <span style="width:9px;height:9px;border-radius:50%;background:var(--red);display:inline-block;animation:pulse 1s infinite"></span>
        ARRIVED — BARGE SCHEDULE MUST BE SENT NOW
      </div>
      ${arrived.map((item, i) => _buildReminderRow(item, now, 'arrived', i)).join('')}
    </div>`;
  }

  // URGENT — within 24 hrs
  if (urgent.length) {
    html += `<div style="background:var(--amber-lt);border:2px solid var(--amber-bd);border-radius:12px;padding:14px 18px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--amber);letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:8px">
        <span style="width:9px;height:9px;border-radius:50%;background:var(--amber);display:inline-block;animation:pulse 2s infinite"></span>
        ARRIVING WITHIN 24 HOURS — SEND BARGE SCHEDULE
      </div>
      ${urgent.map((item, i) => _buildReminderRow(item, now, 'urgent', i)).join('')}
    </div>`;
  }

  // UPCOMING — 24–30 hrs
  if (upcoming.length) {
    html += `<div style="background:var(--azure-lt);border:1.5px solid var(--azure-bd);border-radius:12px;padding:14px 18px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--azure);letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:8px">
        <span style="width:9px;height:9px;border-radius:50%;background:var(--azure);display:inline-block"></span>
        ARRIVING WITHIN 24–30 HOURS — PREPARE TO SEND
      </div>
      ${upcoming.map((item, i) => _buildReminderRow(item, now, 'upcoming', i)).join('')}
    </div>`;
  }

  el.innerHTML = html;

  // Browser notification if browser supports it
  if (urgent.length || arrived.length) {
    _tryBrowserNotification(urgent.map(v => ({ v: v, tier: 'urgent' })).concat(arrived.map(v => ({ v: v, tier: 'arrived' }))));
  }
}

function _buildReminderRow(item, now, type, idx) {
  const hrsAway   = (item.eta - now) / 3600000;
  const isArrived = type === 'arrived';
  const isUrgent  = type === 'urgent';
  const rNomV=(item.nomVQ!==undefined&&item.nomVQ!==null)?item.nomVQ:item.vQ, rNomM=(item.nomMQ!==undefined&&item.nomMQ!==null)?item.nomMQ:item.mQ;
  const qty = [rNomV>0?'VLSFO '+esc(_nomQtyTxt(item,'V',rNomV))+' MT':'', rNomM>0?'MGO '+esc(_nomQtyTxt(item,'M',rNomM))+' MT':''].filter(Boolean).join(' + ') || '—';
  const color  = isArrived ? 'var(--red)' : isUrgent ? 'var(--amber)' : 'var(--azure)';
  const rKey = _reminderKey(item);
  const isDismissed = _dismissedReminders.has(rKey);
  if (isDismissed) return '';

  return '<div style="background:var(--surface);border:1px solid ' + (isArrived?'var(--red-bd)':isUrgent?'var(--amber-bd)':'var(--azure-bd)') + ';border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap" id="' + _reminderDomId(rKey) + '">' +
    '<div style="flex:1;min-width:200px">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">' +
        '<span style="font-size:13px;font-weight:700;color:var(--ink)">' + esc(item.name) + '</span>' +
        '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:' + (isArrived?'var(--red-lt)':isUrgent?'var(--amber-lt)':'var(--azure-lt)') + ';color:' + color + ';border:1px solid ' + (isArrived?'var(--red-bd)':isUrgent?'var(--amber-bd)':'var(--azure-bd)') + '">' +
          (isArrived ? ' ARRIVED' : '\u26a1 ' + Math.abs(hrsAway).toFixed(1) + ' hrs away') +
        '</span>' +
        '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:var(--azure-lt);color:var(--azure);border:1px solid var(--azure-bd)">\u2693 ' + esc(item.bargeLabel||'Barge TBD') + '</span>' +
        (item.paq==='yes'?'<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:var(--green-lt);color:var(--green);border:1px solid var(--green-bd)">PAQ \u2713</span>':'<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:var(--red-lt);color:var(--red);border:1px solid var(--red-bd)">PAQ \u26a0</span>') +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;font-size:11.5px;color:var(--sub)">' +
        '<div>\uD83D\uDCC5 ETA: <strong style="color:var(--ink)">' + _itemEtaTxt(item) + '</strong></div>' +
        '<div>\u26fd Qty: <strong style="color:var(--ink)">' + qty + '</strong></div>' +
        '<div>\uD83D\uDD50 Supply Start: <strong style="color:var(--ink)">' + fmt24(item.bargeStart) + '</strong></div>' +
      '</div>' +
      '<div style="margin-top:8px;padding:7px 12px;background:' + (isArrived?'var(--red-lt)':isUrgent?'var(--amber-lt)':'var(--azure-lt)') + ';border-radius:7px;font-size:11.5px;font-weight:600;color:' + color + '">' +
        (isArrived ? '\u26a1 Action required: Send barge schedule to vessel agent immediately.' : isUrgent ? '\uD83D\uDCE4 Send barge schedule to vessel agent — vessel arrives in < 24 hrs.' : '\uD83D\uDCCB Confirm barge schedule and notify vessel agent.') +
      '</div>' +
    '</div>' +
    '<div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">' +
      '<button onclick="openBunkerMsgModal(' + (Number(item.sno) || 0) + ')" style="padding:7px 14px;background:linear-gradient(135deg,var(--ink-solid),var(--azure));color:#fff;border:none;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;font-family:\'DM Sans\',sans-serif;white-space:nowrap">\uD83D\uDCCB Copy Schedule</button>' +
      '<button onclick="dismissReminder(\'' + escJs(rKey) + '\')" style="padding:5px 10px;background:var(--surface);border:none;box-shadow:var(--sh-xs);border-radius:7px;font-size:11px;color:var(--muted);cursor:pointer;font-family:\'DM Sans\',sans-serif;white-space:nowrap">\u2713 Dismiss</button>' +
    '</div>' +
  '</div>';
}

/* ─── BUNKER MESSAGE MODAL ─── */
var _bunkerMsgSno = null;

function openBunkerMsgModal(sno) {
  // Inline handlers (alert strips, action queue, calendar tickets) pass sno
  // as a string; compare loosely so the modal opens from all of them.
  var item = _lastSched.find(function(x) { return String(x.sno) === String(sno); });
  if (!item) return;
  _bunkerMsgSno = item.sno;

  var bmNomV=(item.nomVQ!==undefined&&item.nomVQ!==null)?item.nomVQ:item.vQ, bmNomM=(item.nomMQ!==undefined&&item.nomMQ!==null)?item.nomMQ:item.mQ;
  document.getElementById('bm-vessel-name').textContent = item.name;
  document.getElementById('bm-vlsfo-qty').textContent   = bmNomV > 0 ? _nomQtyTxt(item, 'V', bmNomV) + ' MT' : '—';
  document.getElementById('bm-mgo-qty').textContent     = bmNomM > 0 ? _nomQtyTxt(item, 'M', bmNomM) + ' MT' : '—';

  // Auto-detect fuel type
  var fuelType = (bmNomV > 0 && bmNomM > 0) ? 'both' : (bmNomM > 0 ? 'mgo' : 'vlsfo');
  document.getElementById('bm-fuel-type').value = fuelType;

  // Classify supply sequence using central logic — against THIS barge's
  // sequence only. _lastSched mixes every barge, so the "previous" item by
  // index could be a vessel on a different barge.
  var bargeSeq = _lastSched.filter(function(x) { return (x.bargeLabel || '') === (item.bargeLabel || ''); });
  var idx2 = bargeSeq.indexOf(item);
  var seq  = classifySeq(item, idx2, bargeSeq);

  // Rebuild dropdown dynamically
  var seqSel = document.getElementById('bm-seq-type');
  seqSel.innerHTML = '<option value="arrival">On Arrival</option>';
  if (seq.type === 'after' && seq.prevName) {
    seqSel.innerHTML += '<option value="after">After ' + esc(seq.prevName) + '</option>';
    seqSel.innerHTML += '<option value="timed">Timed Window (custom)</option>';
    seqSel.value = 'after';
    seqSel.dataset.prevname = seq.prevName;
  } else {
    seqSel.innerHTML += '<option value="timed">Timed Window (custom)</option>';
    seqSel.value = 'arrival';
  }

  // Pre-fill time window
  var supStart = item.bargeStart || item.eta;
  var supEnd   = item.etc;
  var pad2   = function(n) { return String(n).padStart(2, '0'); };
  var fmtT   = function(d) { return pad2(d.getHours()) + pad2(d.getMinutes()); };
  var fmtDay = function(d) { return d.getDate() + ' ' + MO[d.getMonth()] + "'" + String(d.getFullYear()).slice(2); };
  if (supStart && supEnd) {
    document.getElementById('bm-time-window').value = fmtT(supStart) + '-' + fmtT(supEnd) + ' HRS / ' + fmtDay(supStart);
  }

  // Barge name — use preferred/saved barge or vessel's assigned barge
  document.getElementById('bm-barge-input').value = item.bargeLabel || 'FNSA 10';

  // Pre-fill the ETA Nomination Mail tab from the same schedule item so it's
  // ready to review/copy the moment the operator switches tabs.
  var etaFromEl = document.getElementById('eta-date-from');
  var etaToEl   = document.getElementById('eta-date-to');
  var etaVEl    = document.getElementById('eta-vlsfo-qty');
  var etaMEl    = document.getElementById('eta-mgo-qty');
  if (etaFromEl) etaFromEl.value = supStart ? fmtDay(supStart) : '';
  if (etaToEl)   etaToEl.value   = supEnd   ? fmtDay(supEnd)   : (supStart ? fmtDay(supStart) : '');
  // A ranged nomination is nominated as its range ("500-600"), not its planning top.
  var bmRV = _nomRange(item, 'V'), bmRM = _nomRange(item, 'M');
  if (etaVEl)    etaVEl.value    = bmNomV > 0 ? (bmRV ? _qtyInputText(bmNomV, bmRV.min, bmRV.max) : bmNomV) : '';
  if (etaMEl)    etaMEl.value    = bmNomM > 0 ? (bmRM ? _qtyInputText(bmNomM, bmRM.min, bmRM.max) : bmNomM) : '';

  bmSwitchTab('schedule');
  _bunkerMsgToggleSeq();
  _bunkerMsgUpdatePreview();
  document.getElementById('bunker-msg-modal').style.display = 'flex';
}

function closeBunkerMsgModal() {
  document.getElementById('bunker-msg-modal').style.display = 'none';
  _bunkerMsgSno = null;
}

function _bunkerMsgToggleSeq() {
  var seq = document.getElementById('bm-seq-type').value;
  var tw  = document.getElementById('bm-time-window-row');
  // Show time window only for custom timed option
  if (tw) tw.style.display = seq === 'timed' ? 'flex' : 'none';
  _bunkerMsgUpdatePreview();
}

function _generateBunkerMsg(item, fuelType, seqType, timeWindow, bargeName) {
  var barge = (bargeName || (item ? item.bargeLabel : '') || 'FNSA 10').trim();
  var gbmNomV=(item&&item.nomVQ!==undefined&&item.nomVQ!==null)?item.nomVQ:(item?item.vQ:0), gbmNomM=(item&&item.nomMQ!==undefined&&item.nomMQ!==null)?item.nomMQ:(item?item.mQ:0);
  var vQty  = item && gbmNomV > 0 ? _nomQtyTxt(item, 'V', gbmNomV) : null;   // "500–600" for a range
  var mQty  = item && gbmNomM > 0 ? _nomQtyTxt(item, 'M', gbmNomM) : null;

  var manifoldLine, dischargeLine, qtyLine;

  if (fuelType === 'both') {
    manifoldLine  = 'MANIFOLD SIZE: 8" LSFO / 6" LSMGO';
    dischargeLine = 'DISCHARGE RATE: 300 TPH HSFO / 100 TPH LSMGO';
    qtyLine       = 'QUANTITY: ' + (vQty || '—') + ' MT VLSFO / ' + (mQty || '—') + ' MT LSMGO';
  } else if (fuelType === 'mgo') {
    manifoldLine  = 'MANIFOLD SIZE: 6" LSMGO';
    dischargeLine = 'DISCHARGE RATE: 100 TPH LSMGO';
    qtyLine       = 'QUANTITY: ' + (mQty || '—') + ' MT LSMGO';
  } else {
    manifoldLine  = 'MANIFOLD SIZE: 8" LSFO';
    dischargeLine = 'DISCHARGE RATE: 300 TPH HSFO';
    qtyLine       = 'QUANTITY: ' + (vQty || '—') + ' MT LSFO';
  }
  // ETA nominated only as a part of the day: say so in the message.
  if (item && item.etaWin && _etaFrame(item.etaWin)) qtyLine += '\nVESSEL ETA: ' + _itemEtaTxt(item);

  var body;
  if (seqType === 'arrival') {
    // On Arrival — barge alongside when vessel arrives
    body = 'Good day,\n\nFurther to our below, please note our bunker barge ' + barge +
      ' is scheduled for supply and expected to be alongside upon vessel\'s arrival at STBD side of the vessel\n\n' +
      'STANDBY VHF: CH 16 / 10\n' + manifoldLine + '\n' + dischargeLine + '\n\n' + qtyLine +
      '\n\nKindly ensure speedy turnaround of our bunker barge as she is on a very tight schedule.';

  } else if (seqType === 'after') {
    // After [Previous Vessel] — tight schedule, get time window from the time window field if filled
    var seqSel    = document.getElementById('bm-seq-type');
    var prevName  = (seqSel && seqSel.dataset.prevname) ? seqSel.dataset.prevname : 'previous vessel';
    var tw        = (timeWindow && timeWindow.trim()) ? timeWindow.trim() : null;
    var timePhrase = tw ? 'latest by ' + tw : 'upon completion of ' + prevName;
    body = 'Good day,\n\nFurther to the below, please note our bunker barge ' + barge +
      ' is scheduled for supply and expected to be alongside ' + timePhrase + ' at STBD side of the vessel.\n\n' +
      'STANDBY VHF: CH 16 / 10\n' + manifoldLine + '\n' + dischargeLine + '\n\n' + qtyLine +
      '\n\nKindly ensure speedy turnaround of our bunker barge as she is on a very tight schedule.';

  } else {
    // Timed (custom) — user-specified time window
    var tw2 = (timeWindow && timeWindow.trim()) ? timeWindow.trim() : '[TIME WINDOW]';
    body = 'Good day,\n\nFurther to the below, please note our bunker barge ' + barge +
      ' is scheduled for supply and expected to be alongside latest by ' + tw2 + ' at STBD side of the vessel.\n\n' +
      'STANDBY VHF: CH 16 / 10\n' + manifoldLine + '\n' + dischargeLine + '\n\n' + qtyLine +
      '\n\nKindly ensure speedy turnaround of our bunker barge as she is on a very tight schedule.';
  }
  return body;
}

function _bunkerMsgUpdatePreview() {
  var sno = _bunkerMsgSno;
  if (sno === null || sno === undefined) return;
  var item      = _lastSched.find(function(x) { return x.sno === sno; });
  if (!item) return;
  var fuelType  = document.getElementById('bm-fuel-type').value;
  var seqType   = document.getElementById('bm-seq-type').value;
  var timeWin   = document.getElementById('bm-time-window').value.trim();
  var bargeName = document.getElementById('bm-barge-input').value.trim();
  var msg = _generateBunkerMsg(item, fuelType, seqType, timeWin, bargeName);
  var prev = document.getElementById('bm-preview');
  if (prev) prev.textContent = msg;
}

function copyBunkerMsg() {
  var prev = document.getElementById('bm-preview');
  if (!prev) return;
  var text = prev.textContent;
  navigator.clipboard.writeText(text).then(function() {
    var btn = document.getElementById('bm-copy-btn');
    if (btn) { btn.textContent = '\u2713 Copied!'; btn.style.background = 'var(--green)'; setTimeout(function() { btn.textContent = '\uD83D\uDCCB Copy Message'; btn.style.background = ''; }, 2500); }
  }).catch(function() { prompt('Copy this message:', text); });
}

// Kept for any direct calls elsewhere in the system
function copyScheduleForVessel(sno) { openBunkerMsgModal(sno); }

/* ─── BUNKER MESSAGE MODAL — tab switcher ───
   Toggles between the "Bunker Schedule" message panel and the
   "ETA Nomination Mail" panel, and keeps the two tab buttons' active/
   inactive styling in sync. Switching into the ETA tab refreshes its
   preview immediately, so it's never left showing stale content. */
function bmSwitchTab(tab) {
  var schedBtn   = document.getElementById('bm-tab-schedule');
  var etaBtn     = document.getElementById('bm-tab-eta');
  var schedPanel = document.getElementById('bm-panel-schedule');
  var etaPanel   = document.getElementById('bm-panel-eta');
  if (!schedBtn || !etaBtn || !schedPanel || !etaPanel) return;

  var activeCss   = 'padding:7px 16px;background:var(--azure);color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif';
  var inactiveCss = 'padding:7px 16px;background:var(--surface);color:var(--sub);border:none;box-shadow:var(--sh-sm);border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif';

  if (tab === 'eta') {
    schedPanel.style.display = 'none';
    etaPanel.style.display   = '';
    schedBtn.style.cssText = inactiveCss;
    etaBtn.style.cssText   = activeCss;
    etaMailUpdatePreview();
  } else {
    etaPanel.style.display   = 'none';
    schedPanel.style.display = '';
    etaBtn.style.cssText   = inactiveCss;
    schedBtn.style.cssText = activeCss;
  }
}

/* ─── ETA NOMINATION MAIL — live preview ───
   Builds the subject line and formatted body from the vessel context
   (set by openBunkerMsgModal) plus whatever the operator has typed into
   the Supply Date / Quantity fields. Reuses _emailBodyToHtml so the
   "NOMINATED DATE OF SUPPLY" / "NOMINATED QUANTITY" lines and the CC
   footer get the exact same bold styling as the other outgoing mail
   templates, and the shared mailbox is linkified the same way. */
function etaMailUpdatePreview() {
  var subjectEl = document.getElementById('eta-subject-preview');
  var bodyEl    = document.getElementById('eta-mail-preview');
  if (!subjectEl || !bodyEl) return;

  var item = (_bunkerMsgSno !== null && _bunkerMsgSno !== undefined)
    ? _lastSched.find(function(x) { return x.sno === _bunkerMsgSno; })
    : null;
  var vessel = item ? item.name : (document.getElementById('bm-vessel-name').textContent || '').trim();

  var dateFromEl = document.getElementById('eta-date-from');
  var dateToEl   = document.getElementById('eta-date-to');
  var vQtyEl     = document.getElementById('eta-vlsfo-qty');
  var mQtyEl     = document.getElementById('eta-mgo-qty');
  var dateFrom = dateFromEl ? dateFromEl.value.trim() : '';
  var dateTo   = dateToEl   ? dateToEl.value.trim()   : '';
  var vQP      = _parseQtyInput(vQtyEl ? vQtyEl.value : ''), mQP = _parseQtyInput(mQtyEl ? mQtyEl.value : '');
  var vQty     = vQP.qty, mQty = mQP.qty;

  var dateRange = dateFrom && dateTo && dateFrom !== dateTo ? (dateFrom + ' to ' + dateTo)
    : (dateFrom || dateTo || '[SUPPLY DATE]');

  var vesselLabel = vessel || '[VESSEL]';
  var subject = 'Bunker Supply Nomination \u2013 ' + vesselLabel + ' \u2013 ' + dateRange;

  var lines = [
    'ATTN: OPERATIONS',
    '',
    'Good day all,',
    '',
    'Please be advised that ' + vesselLabel + ' is nominated for bunker supply as per details below. Kindly keep us posted with her firm and consistent ETA notices basis 96/72/48/36/24/12 HRS to our common mail ID at operations@gpsbunkers.com',
    '',
    'NOMINATED DATE OF SUPPLY \u2013 ' + dateRange + '.',
    'NOMINATED QUANTITY - ' + (vQty > 0 ? _qtyShow(vQP) : '\u2014') + ' MT LSFO / ' + (mQty > 0 ? _qtyShow(mQP) : '\u2014') + ' MT LSMGO',
    '',
    'PLEASE KEEP OUR COMMON E MAIL ID - operations@gpsbunkers.com IN CC FOR ALL COMMUNICATION - WHICH IS MONITORED 24 HRS.'
  ];
  var body = lines.join('\n');

  subjectEl.textContent = subject;
  bodyEl.innerHTML = _emailBodyToHtml(body);
  // Plain text kept alongside the rendered HTML so copy handlers don't have
  // to re-derive it from innerText (which can mangle blank lines).
  bodyEl.dataset.plainText = body;
}

function copyEtaSubject() {
  var el = document.getElementById('eta-subject-preview');
  if (!el) return;
  var text = el.textContent;
  _emailCopyPlainFallback(text);
  var btn = event ? event.currentTarget : null;
  if (btn) {
    var orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(function() { btn.textContent = orig; }, 2000);
  }
}

function copyEtaMailBody() {
  var bodyEl = document.getElementById('eta-mail-preview');
  if (!bodyEl) return;
  var text = bodyEl.dataset.plainText || bodyEl.innerText;
  var html = bodyEl.innerHTML;
  var btn = event ? event.currentTarget : null;
  var orig = btn ? btn.innerHTML : null;
  _emailWriteRichClipboard(text, html).then(function() {
    if (btn) {
      btn.textContent = '\u2713 Copied!';
      setTimeout(function() { btn.innerHTML = orig; }, 2500);
    }
  });
}


function dismissReminder(key) {
  _dismissedReminders.add(key);
  const row = document.getElementById(_reminderDomId(key));
  if (row) { row.style.opacity='0'; row.style.transition='opacity .3s'; setTimeout(()=>row.remove(), 300); }
}

// entries: [{ v: scheduleItem, tier: 'urgent'|'arrived' }] — each vessel
// notifies once per tier per session, not on every 5-minute refresh.
function _tryBrowserNotification(entries) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'denied') return;
  const pending = entries.filter(e => {
    const k = _reminderKey(e.v);
    return !_dismissedReminders.has(k) && !_notifiedReminders.has(k + '#' + e.tier);
  });
  if (!pending.length) return;
  if (Notification.permission === 'granted') {
    pending.forEach(e => {
      const v = e.v;
      _notifiedReminders.add(_reminderKey(v) + '#' + e.tier);
      const hrsAway = (v.eta - new Date()) / 3600000;
      try {
        new Notification(`⏰ Bunker Schedule — ${v.name}`, {
          body: hrsAway < 0 ? `${v.name} has arrived! Send barge schedule NOW.` : `${v.name} arrives in ${hrsAway.toFixed(1)} hrs. Send barge schedule.`,
          icon: ''
        });
      } catch(e) {}
    });
    _saveNotifiedReminders();
  } else if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function startReminderAutoRefresh() {
  if (_reminderInterval) clearInterval(_reminderInterval);
  _reminderInterval = setInterval(() => {
    // NOTE: the actual checkbox on the Alerts page is #alerts-reminder-auto
    // (see "Barge Schedule Reminders" section) — this used to check a
    // differently-named #reminder-auto-check that was never added anywhere,
    // so toggling the visible checkbox silently had no effect on this timer.
    const chk = document.getElementById('alerts-reminder-auto');
    if (chk && chk.checked && _lastSched.length) {
      renderScheduleReminders();
      if (typeof renderAlertsReminders === 'function') renderAlertsReminders();
    }
  }, 5 * 60 * 1000); // every 5 minutes
}

