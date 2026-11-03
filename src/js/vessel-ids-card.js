/* ─── VESSEL IDENTIFIERS on the nomination card (rules: see _vidNorm) ───
   _vidRender(id): box states (red = invalid, amber = neither box holds a
   valid ID), the message under the pair, the header badge ("IMO ✓",
   "MMSI ✓", "IMO ✓ MMSI ✓" or "ID missing") and the Look up links.
   Typing: 9 digits in the IMO box move to the MMSI box at once (an IMO is
   never 9 digits); 7 digits in the MMSI box move to the IMO box when the
   box is left (every MMSI is typed through 7 digits). A move never
   overwrites a different number already in the other box. Every value
   shown is esc()'d; Look up URLs are built only from validated digits or
   encodeURIComponent(name) and set as attributes, never as markup. */
const _vidNotes = {}; // card id → "Moved … to MMSI" note, shown until either box is edited again
function _vidLookUrls(name, info) {
  if (info.imo.kind === 'ok') return { by: 'IMO ' + info.imo.val, vf: 'https://www.vesselfinder.com/vessels/details/' + info.imo.val, mt: 'https://www.marinetraffic.com/en/ais/details/ships/imo:' + info.imo.val };
  if (info.mmsi.kind === 'ok') return { by: 'MMSI ' + info.mmsi.val, vf: 'https://www.vesselfinder.com/vessels/details/' + info.mmsi.val, mt: 'https://www.marinetraffic.com/en/ais/details/ships/mmsi:' + info.mmsi.val };
  const n = String(name || '').trim().replace(/\s+/g, ' ').replace(/^(?:M\s*[\/.]\s*[VT]\.?|M[VT]\.?)\s+/i, '').slice(0, 60);
  if (!n) return null;
  const q = encodeURIComponent(n);
  return { by: 'name', vf: 'https://www.vesselfinder.com/vessels?name=' + q, mt: 'https://www.marinetraffic.com/en/ais/index/search/all/keyword:' + q };
}
function _vidRender(id) {
  const imoEl = document.getElementById('v' + id + '-imo'), mmsiEl = document.getElementById('v' + id + '-mmsi');
  if (!imoEl || !mmsiEl) return;
  const info = _vidInfo(imoEl.value, mmsiEl.value);
  // A box being typed into isn't "wrong" yet while its digits are still on
  // the way: the MMSI box below 9 digits; the IMO box below 7, or at 8 (on
  // the way to an MMSI, which then moves across). 7 digits in the IMO box
  // are checked at once (check digit), 9+ / letters in either box too.
  const typing = function(el, c, which) {
    if (document.activeElement !== el || c.kind !== 'bad' || !/^\d+$/.test(c.val)) return false;
    return which === 'imo' ? (c.val.length < 7 || c.val.length === 8) : c.val.length < 9;
  };
  const tI = typing(imoEl, info.imo, 'imo'), tM = typing(mmsiEl, info.mmsi, 'mmsi');
  const badI = info.imo.kind === 'bad' && !tI, badM = info.mmsi.kind === 'bad' && !tM;
  const miss = !info.ok && !badI && !badM && !tI && !tM;
  const cls = function(el, c, on) { if (el.classList.contains(c) !== !!on) el.classList.toggle(c, !!on); };
  [[imoEl, info.imo, badI], [mmsiEl, info.mmsi, badM]].forEach(function(x) {
    cls(x[0], 'vid-bad', x[2]); cls(x[0], 'vid-ok', x[1].kind === 'ok'); cls(x[0], 'vid-miss', miss);
    const inv = x[2] ? 'true' : 'false';
    if (x[0].getAttribute('aria-invalid') !== inv) x[0].setAttribute('aria-invalid', inv);
  });
  // Message line
  const parts = [];
  if (_vidNotes[id]) parts.push('<span class="vid-note">' + esc(_vidNotes[id]) + '</span>');
  if (badI) parts.push('<span class="vid-er" data-vid="imo">' + esc(info.imo.msg) + '</span>');
  if (badM) parts.push('<span class="vid-er" data-vid="mmsi">' + esc(info.mmsi.msg) + '</span>');
  if (!badI && !badM) {
    if (tI || tM) parts.push('<span class="vid-hint">' + (tI ? 'IMO: 7 digits' : 'MMSI: 9 digits, starting 2–7') + '</span>');
    else if (!info.ok) parts.push('<span class="vid-warn" data-vid="missing">Add an IMO or MMSI number</span>');
    else if (!_vidNotes[id]) parts.push('<span class="vid-hint">At least one is required</span>');
  }
  const msgEl = document.getElementById('v' + id + '-idmsg');
  const html = parts.join('');
  if (msgEl && msgEl._vidSig !== html) { msgEl._vidSig = html; msgEl.innerHTML = html; }
  // Header badge
  const badge = document.getElementById('v' + id + '-idbadge');
  if (badge) {
    const ok = [];
    if (info.imo.kind === 'ok') ok.push('IMO ✓');
    if (info.mmsi.kind === 'ok') ok.push('MMSI ✓');
    const txt = ok.length ? ok.join(' ') : 'ID missing', bc = 'vid-badge ' + (ok.length ? 'ok' : 'miss');
    const title = ok.length ? 'Valid: ' + ok.join(', ').replace(/ ✓/g, '') : 'No valid IMO or MMSI on this nomination';
    if (badge.textContent !== txt) badge.textContent = txt;
    if (badge.className !== bc) badge.className = bc;
    if (badge.title !== title) badge.title = title;
  }
  // Look up links (new tab): by IMO / MMSI when valid, else by the vessel name.
  const look = document.getElementById('v' + id + '-idlook');
  if (look) {
    const u = _vidLookUrls((document.getElementById('v' + id + '-name') || {}).value, info);
    if (look.hidden !== !u) look.hidden = !u;
    if (u) {
      [['vf', 'VesselFinder'], ['mt', 'MarineTraffic']].forEach(function(x) {
        const a = document.getElementById('v' + id + '-look-' + x[0]);
        if (!a) return;
        if (a.getAttribute('href') !== u[x[0]]) a.setAttribute('href', u[x[0]]);
        const lbl = 'Look up ' + (u.by === 'name' ? 'this vessel name' : u.by) + ' on ' + x[1] + ' (opens a new tab)';
        if (a.getAttribute('aria-label') !== lbl) a.setAttribute('aria-label', lbl);
      });
    }
  }
}
// Move the number in box `from` to the other box (see above). → true when moved.
function _vidMove(id, from) {
  const to = from === 'imo' ? 'mmsi' : 'imo';
  const src = document.getElementById('v' + id + '-' + from), dst = document.getElementById('v' + id + '-' + to);
  if (!src || !dst) return false;
  const d = _vidNorm(src.value), cur = _vidNorm(dst.value);
  if (!/^\d+$/.test(d) || (cur && cur !== d)) return false;
  const hadFocus = document.activeElement === src;
  dst.value = d; src.value = '';
  _vidNotes[id] = from === 'imo' ? 'Moved ' + d + ' to MMSI — 9 digits is an MMSI, not an IMO number' : 'Moved ' + d + ' to IMO — 7 digits is an IMO number, not an MMSI';
  if (hadFocus) { try { dst.focus(); dst.setSelectionRange(d.length, d.length); } catch (e) {} }
  return true;
}
function vidInput(id, which) {
  delete _vidNotes[id];
  if (which === 'imo') {
    const el = document.getElementById('v' + id + '-imo');
    if (el && /^\d{9}$/.test(_vidNorm(el.value))) _vidMove(id, 'imo');
  }
  _vidRender(id);
  clearTimeout(upd._t); upd._t = setTimeout(saveSharedState, 1500);
  _vidSyncAlertsSoon();
}
// Box left / changed: normalise ("IMO 9321483" → "9321483") and move a misplaced number.
function vidCommit(id, which) {
  const el = document.getElementById('v' + id + '-' + which), other = document.getElementById('v' + id + '-' + (which === 'imo' ? 'mmsi' : 'imo'));
  if (!el || !other) return;
  const before = el.value + '|' + other.value;
  const d = _vidNorm(el.value);
  if (/^\d+$/.test(d) && d !== el.value) el.value = d;
  if (which === 'imo' && /^\d{9}$/.test(d)) _vidMove(id, 'imo');
  else if (which === 'mmsi' && /^\d{7}$/.test(d)) _vidMove(id, 'mmsi');
  _vidRender(id);
  if (el.value + '|' + other.value !== before) {
    clearTimeout(upd._t); upd._t = setTimeout(saveSharedState, 1500);
    _vidSyncAlertsSoon();
  }
}

/* Nominations without a usable identifier — one per nomination, keyed
   'ids|<nomUid>': named, not yet supplied, not long past. They feed Needs
   Attention, the bell (never a toast) and the Generate Schedule warning. */
function _vidMissing(now) {
  now = now == null ? Date.now() : now;
  const out = [];
  document.querySelectorAll('#vc .vcard[id^="vessel-"]').forEach(function(card) {
    const cid = card.id.replace('vessel-', '');
    const g = function(f) { const el = document.getElementById('v' + cid + '-' + f); return el ? String(el.value || '') : ''; };
    const name = g('name').trim().replace(/\s+/g, ' ');
    if (!name) return;
    const ids = _cardIds(cid), info = _vidInfo(ids.imo, ids.mmsi);
    if (info.ok) return;
    const nomUid = card.dataset.nomUid || '';
    const eta = g('eta') ? parseDT(g('eta')) : null;
    let lc = null;
    try { lc = g('lc') ? parseLaycan(g('lc')) : null; } catch (e) { lc = null; }
    const last = Math.max(eta instanceof Date && !isNaN(eta.getTime()) ? eta.getTime() : 0, lc && lc.to instanceof Date && !isNaN(lc.to.getTime()) ? lc.to.getTime() : 0);
    if (last && last < now - 2 * 86400000) return; // long past — not an upcoming nomination any more
    try { if (typeof _isScheduleItemCompleted === 'function' && _isScheduleItemCompleted({ nomUid: nomUid || null, name: name, eta: eta })) return; } catch (e) {}
    const bad = [['IMO', info.imo], ['MMSI', info.mmsi]].filter(function(x) { return x[1].kind === 'bad'; });
    out.push({
      cid: cid, nomUid: nomUid, name: name, bad: bad.length > 0, key: 'ids|' + (nomUid || name.toUpperCase()),
      detail: bad.length
        ? bad.map(function(x) { return x[0] + ' ' + x[1].val.slice(0, 20) + ': ' + x[1].msg; }).join(' · ') + ' — add a valid IMO or MMSI'
        : 'No IMO or MMSI on this nomination'
    });
  });
  return out;
}
function _vidAlerts() {
  return _vidMissing().map(function(x) {
    return { key: x.key, label: x.bad ? 'Check IMO / MMSI' : 'IMO / MMSI missing', sub: x.name + ' — ' + x.detail, severity: 'warning', kind: 'ids', cid: x.cid, vesselName: x.name, text: x.detail };
  });
}
// Needs Attention / bell → the card, with the cursor in the box to fill.
function _vidGoTo(cid) {
  showPage('nominations');
  setTimeout(function() {
    const card = document.getElementById('vessel-' + cid);
    if (!card) return;
    if (typeof _globalSearchHighlight === 'function') _globalSearchHighlight(card);
    const ids = _cardIds(cid);
    const el = document.getElementById('v' + cid + '-' + (_vidCheck(ids.mmsi, 'mmsi').kind === 'bad' && !String(ids.imo).trim() ? 'mmsi' : 'imo'));
    if (el) { try { el.focus({ preventScroll: true }); } catch (e) {} }
  }, 80);
}
// Bell follows ID edits (after its first pass — startAutoSync decides what was already there at login).
let _vidAlertTimer = null, _vidAlertSig = null;
function _vidSyncAlertsSoon() {
  clearTimeout(_vidAlertTimer);
  _vidAlertTimer = setTimeout(function() {
    _vidAlertTimer = null;
    let sig = '';
    try { sig = _vidMissing().map(function(x) { return x.key + ':' + x.detail; }).join('|'); } catch (e) { return; }
    if (sig === _vidAlertSig) return;
    _vidAlertSig = sig;
    if (typeof _globalAlertsPrevKeys !== 'undefined' && _globalAlertsPrevKeys && typeof _refreshGlobalAlertsBell === 'function') {
      try { _refreshGlobalAlertsBell(); } catch (e) {}
    }
  }, 500);
}
// Send Nomination Email / Generate Email: a non-blocking warning for a card without a usable ID.
function _vidWarnCard(id, what) {
  const ids = _cardIds(id);
  if (_vidInfo(ids.imo, ids.mmsi).ok) return false;
  const name = ((document.getElementById('v' + id + '-name') || {}).value || '').trim() || 'This vessel';
  if (typeof showToast === 'function') showToast(name + ' has no valid IMO or MMSI — ' + what + ' Add one on the card.', 'warning', 7000);
  return true;
}
// Generate Schedule: ONE summary warning (never blocks).
function _vidWarnSchedule() {
  const miss = _vidMissing();
  if (!miss.length || typeof showToast !== 'function') return 0;
  const names = miss.slice(0, 3).map(function(x) { return x.name; }).join(', ') + (miss.length > 3 ? ' +' + (miss.length - 3) + ' more' : '');
  showToast(miss.length + (miss.length === 1 ? ' nomination has' : ' nominations have') + ' no valid IMO or MMSI (' + names + ') — the schedule is generated anyway; add them on the cards.', 'warning', 8000);
  return miss.length;
}

