/* ── GLOBAL VESSEL SEARCH ──────────────────────────────────────────
   Searches across the three places a vessel name lives — live
   Nomination cards (DOM inputs), the generated Schedule (_lastSched),
   and Saved Records (_savedSupplies) — and lets the operator jump
   straight to it instead of hunting through pages/sidebar tabs by hand. */
function _globalSearchClose() {
  const box = document.getElementById('global-search-results');
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
}

function _globalSearchRun(qRaw) {
  const q = (qRaw || '').trim().toLowerCase();
  const box = document.getElementById('global-search-results');
  if (!box) return;
  if (!q) { _globalSearchClose(); return; }

  const results = [];

  // 1) Live nomination cards — read straight from the DOM inputs so this
  // always reflects exactly what's on screen, including unsaved edits.
  // A query of 3+ digits also finds a nomination by its IMO / MMSI.
  const qDigits = /^[\d\s.\-]+$/.test(q) ? q.replace(/\D/g, '') : '';
  document.querySelectorAll('.vcard').forEach(function(card) {
    const nameInput = card.querySelector('input[id$="-name"]');
    const name = nameInput ? nameInput.value.trim() : '';
    const cardId = card.id.replace('vessel-', '');
    if (name && name.toLowerCase().includes(q)) {
      results.push({ type: 'Nomination', label: name, sub: 'Vessel Nominations', action: function() { _globalSearchGoNomination(cardId); } });
    } else if (qDigits.length >= 3 && /^vessel-/.test(card.id)) {
      const ids = _cardIds(cardId), imo = _vidNorm(ids.imo), mmsi = _vidNorm(ids.mmsi);
      const hit = (imo && imo.includes(qDigits)) ? 'IMO ' + imo : ((mmsi && mmsi.includes(qDigits)) ? 'MMSI ' + mmsi : '');
      if (hit) results.push({ type: 'Nomination', label: name || '(unnamed vessel)', sub: hit + ' · Vessel Nominations', action: function() { _globalSearchGoNomination(cardId); } });
    }
  });

  // 2) Generated schedule
  (typeof _lastSched !== 'undefined' ? _lastSched : []).forEach(function(item) {
    if (item.name && item.name.toLowerCase().includes(q)) {
      const etaStr = (item.eta instanceof Date && !isNaN(item.eta)) ? (item.etaWin ? _fmtEtaWinShort(item.eta, item.etaWin) : fmtShort(item.eta)) : '';
      results.push({ type: 'Schedule', label: item.name, sub: etaStr ? ('ETA ' + etaStr) : 'Bunker Schedule', action: function() { _globalSearchGoSchedule(item.sno); } });
    }
  });

  // 3) Saved supply records
  (typeof _savedSupplies !== 'undefined' ? _savedSupplies : []).forEach(function(rec) {
    if (rec.vessel && rec.vessel.toLowerCase().includes(q)) {
      results.push({ type: 'Record', label: rec.vessel, sub: rec.dateStr || 'Saved Record', action: function() { _globalSearchGoRecords(); } });
    }
  });

  if (!results.length) {
    box.innerHTML = '<div style="padding:14px 16px;font-size:12.5px;color:var(--muted)">No vessels matching "' + esc(qRaw) + '"</div>';
    box.style.display = 'block';
    return;
  }

  const badgeColor = { Nomination: 'var(--azure)', Schedule: 'var(--teal)', Record: 'var(--amber)' };
  box.innerHTML = results.slice(0, 25).map(function(r, i) {
    return '<div class="gs-result" data-idx="' + i + '" style="display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer;font-size:12.5px;border-bottom:1px solid rgba(13,27,42,.05)" onmouseover="this.style.background=\'var(--surface)\'" onmouseout="this.style.background=\'\'">' +
      '<span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#fff;background:' + (badgeColor[r.type] || 'var(--muted)') + ';border-radius:5px;padding:2px 7px;flex-shrink:0">' + esc(r.type) + '</span>' +
      '<span style="flex:1;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(r.label) + '</span>' +
      '<span style="color:var(--muted);font-size:11px;white-space:nowrap">' + esc(r.sub) + '</span>' +
      '</div>';
  }).join('');
  box.style.display = 'block';

  Array.prototype.forEach.call(box.querySelectorAll('.gs-result'), function(el, i) {
    el.addEventListener('click', function() {
      results[i].action();
      _globalSearchClose();
      const input = document.getElementById('global-search-input');
      if (input) { input.value = ''; input.blur(); }
    });
  });
}

function _globalSearchHighlight(el) {
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const prevOutline = el.style.outline, prevOffset = el.style.outlineOffset;
  el.style.outline = '3px solid var(--azure)';
  el.style.outlineOffset = '3px';
  setTimeout(function() { el.style.outline = prevOutline; el.style.outlineOffset = prevOffset; }, 2200);
}

function _globalSearchGoNomination(cardId) {
  showPage('nominations');
  setTimeout(function() { _globalSearchHighlight(document.getElementById('vessel-' + cardId)); }, 60);
}

function _globalSearchGoSchedule(sno) {
  showPage('schedule');
  // The Bunker Message modal is the existing, meaningful "jump to this
  // vessel" surface for a scheduled entry — full detail in one click,
  // rather than trying to scroll a re-rendered table to a bare row.
  setTimeout(function() { if (typeof openBunkerMsgModal === 'function') openBunkerMsgModal(sno); }, 60);
}

function _globalSearchGoRecords() {
  showPage('records');
}

document.addEventListener('click', function(e) {
  const wrap = document.getElementById('global-search-wrap');
  if (wrap && !wrap.contains(e.target)) _globalSearchClose();
});
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
}

