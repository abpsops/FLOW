/* ─── Unavailable blocks (operator-only) ─── */
function _fwKey(id) { return String(id).replace(/[^A-Za-z0-9_-]/g, '_'); }
function _fwNormTime(el) {
  var d = el.value.replace(/[^\d]/g, '');
  var hh = 0, mm = 0;
  if (d.length >= 3) { hh = parseInt(d.slice(0, d.length - 2), 10); mm = parseInt(d.slice(-2), 10); }
  else if (d.length) hh = parseInt(d, 10);
  el.value = String(Math.min(23, hh || 0)).padStart(2, '0') + ':' + String(Math.min(59, mm || 0)).padStart(2, '0');
}
function fwToggleBlockForm(bargeId) {
  if (isTrader()) return;
  var f = document.getElementById('fw-blk-form-' + _fwKey(bargeId));
  if (!f) return;
  var show = f.style.display === 'none';
  f.style.display = show ? 'block' : 'none';
  if (show) {
    var k = _fwKey(bargeId), sd = document.getElementById('fw-blk-sd-' + k), ed = document.getElementById('fw-blk-ed-' + k);
    if (sd && !sd.value) sd.value = _localDateInputStr(new Date());
    if (ed && !ed.value) ed.value = _localDateInputStr(new Date());
  }
}
async function addBargeBlock(bargeId) {
  if (isTrader()) { showToast('Only an operator can block out barge time.', 'warning'); return; }
  var k = _fwKey(bargeId);
  var b = (_bargeConfig || []).find(function(x) { return String(x.id) === String(bargeId); });
  if (!b) return;
  var val = function(s) { var el = document.getElementById('fw-blk-' + s + '-' + k); return el ? String(el.value || '').trim() : ''; };
  var sd = val('sd'), st = val('st') || '00:00', ed = val('ed'), et = val('et') || '00:00', reason = val('reason');
  if (!sd || !ed) { alert('Pick a start and end date.'); return; }
  var start = new Date(sd + 'T' + st + ':00'), end = new Date(ed + 'T' + et + ':00');
  if (isNaN(start.getTime()) || isNaN(end.getTime())) { alert('That start/end date or time isn\'t valid.'); return; }
  if (end <= start) { alert('The end must be after the start.'); return; }
  var who = ABPS_UID || '';
  try {
    if (typeof supabaseClient !== 'undefined' && supabaseClient && supabaseClient.auth) {
      var sess = await supabaseClient.auth.getSession();
      var u = sess && sess.data && sess.data.session && sess.data.session.user;
      if (u && u.email) who = u.email;
    }
  } catch (e) {}
  var nowMs = Date.now();
  _bargeBlocks = (_bargeBlocks || []).concat([{
    id: 'blk_' + nowMs + '_' + Math.random().toString(36).slice(2, 7), bargeId: b.id, bargeName: b.name,
    start: start.toISOString(), end: end.toISOString(), reason: reason.slice(0, 120), createdBy: who, createdAt: nowMs, updatedAt: nowMs
  }]);
  saveSharedState();
  renderFreeWindowsPanel();
  _rlRefreshIfShown();
  // Already-scheduled jobs inside the block now show as Conflicts — say so.
  var hits = _getBargeTimeline(b.id, b.name).filter(function(op) { return !op.isBlock && op.start < end && op.etc > start; });
  showToast('Blocked ' + b.name + ' ' + fmt24(start) + ' → ' + fmt24(end) +
    (hits.length ? ' — overlaps ' + hits.map(function(op) { return op.vessel; }).join(', ') + '; regenerate the schedule to move them.' : ''),
    hits.length ? 'warning' : 'success', hits.length ? 8000 : undefined);
}
function deleteBargeBlock(id) {
  if (isTrader()) return;
  var bk = (_bargeBlocks || []).find(function(x) { return x.id === id; });
  if (!bk) return;
  if (!confirm('Remove this unavailable block (' + (bk.reason || 'no reason') + ')?')) return;
  _bargeBlocks = _bargeBlocks.filter(function(x) { return x.id !== id; });
  saveSharedState();
  renderFreeWindowsPanel();
  _rlRefreshIfShown();
}

// Re-render an open Free Windows panel after data changes — but not while
// the operator is typing in it (e.g. the block-out form).
function _fwRefreshIfOpen() {
  var panel = document.getElementById('free-windows-panel');
  if (!panel || panel.style.display === 'none') return;
  if (document.activeElement && panel.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
  try { renderFreeWindowsPanel(); } catch (e) { console.warn('ABPS: Free Windows refresh failed', e); }
}

function toggleFreeWindowsPanel() {
  var panel = document.getElementById('free-windows-panel');
  var btn = document.getElementById('free-windows-toggle-btn');
  if (!panel) return;
  var showing = panel.style.display !== 'none';
  panel.style.display = showing ? 'none' : 'block';
  if (btn) btn.classList.toggle('active', !showing);
  if (!showing) renderFreeWindowsPanel();
}

function _fwFmtDT(d) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}
function _fwH(h) { return (Math.round(h * 10) / 10).toLocaleString() + 'h'; }
// One-line arithmetic for a free/short row (also used in the Excel detail).
function _fwBreakdown(w) {
  var parts = [w.openEnded ? 'open-ended gap' : _fwH(w.gapHrs) + ' gap'];
  if (w.travelBefore > 0) parts.push(_fwH(w.travelBefore) + ' travel in');
  if (w.travelAfter > 0) parts.push(_fwH(w.travelAfter) + ' travel out');
  parts.push(_fwH(w.hoseHrs) + ' hose-up');
  parts.push(_fwH(w.contingencyHrs) + ' contingency');
  return parts.join(' − ') + (w.openEnded ? '' : ' = ' + _fwH(Math.max(0, w.usableHrs)) + ' pumping');
}
function _fwAtpText(w) {
  return 'Available to promise: ' + w.atpV.toLocaleString() + ' MT VLSFO / ' + w.atpM.toLocaleString() + ' MT LSMGO' +
    ' (lowest projected ROB before the next loading, ' + Math.round(w.lowV).toLocaleString() + ' / ' + Math.round(w.lowM).toLocaleString() +
    ' MT, less ' + w.vbuf.toLocaleString() + ' / ' + w.mbuf.toLocaleString() + ' MT minimum-stock buffer)';
}
// Shared header lines for panel + Excel: staleness and unassigned demand.
function _fwStatusInfo(range) {
  var stale = _fwScheduleStaleness();
  var hasSched = (_lastSched || []).length > 0;
  var genText = !hasSched ? 'No schedule generated yet — nominations are not reflected below'
    : stale.known && stale.generatedAt ? 'Based on schedule generated ' + fmt24(stale.generatedAt)
    : 'Based on the last generated schedule (generation time unknown — regenerate to track changes)';
  var staleText = stale.stale ? 'Nominations/barges changed since (' + stale.reasons.join(', ') + ') — regenerate' : '';
  return { stale: stale, hasSched: hasSched, genText: genText, staleText: staleText, unassigned: _fwUnassignedDemand(range.weekStart, range.weekEnd) };
}

async function downloadFreeWindowsReport(btnEl) {
  var barges = _bargeConfig || [];
  if (!barges.length) { alert('No barges configured.'); return; }
  var origLabel = btnEl ? btnEl.innerHTML : '';
  if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = 'Preparing…'; }
  await new Promise(function(r) { setTimeout(r, 0); });
  try {
    var range = _freeWindowsWeekRange();
    var weekLabel = range.weekStart.toLocaleDateString('en-GB',{day:'2-digit',month:'short'}) + '-' +
      new Date(range.weekEnd.getTime()-1).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
    var fmtDT = _fwFmtDT;
    var info = _fwStatusInfo(range);
    var NC = 11, lastCol = 'K';

    var ExcelJS = await _loadExcelJS();
    var wb = new ExcelJS.Workbook();
    var ws = wb.addWorksheet('Free Windows');
    ws.columns = [{width:14},{width:12},{width:14},{width:14},{width:8},{width:10},{width:48},{width:13},{width:13},{width:13},{width:13}];

    var line = function(r, text, font) {
      ws.mergeCells('A' + r + ':' + lastCol + r);
      var c = ws.getCell('A' + r); c.value = text; c.font = font; c.alignment = { wrapText: true, vertical: 'top' };
    };
    line(1, 'FLOW Free Windows — Week of ' + weekLabel, { bold:true, size:13, color:{argb:'FF0D1B2A'} });
    line(2, 'Exported ' + fmt24(new Date()) + ' · Purely informational — nothing here books anything', { size:9, color:{argb:'FF8A9BAC'} });
    line(3, info.genText + (info.staleText ? ' — WARNING: ' + info.staleText : ''), { size:9, bold: !!info.staleText, color:{argb: info.staleText ? 'FFB8790F' : 'FF47617D'} });
    var u = info.unassigned;
    line(4, 'Unassigned demand this week: ' + (u.count ? u.count + ' vessel' + (u.count > 1 ? 's' : '') + ' — ' + Math.round(u.v).toLocaleString() + ' MT VLSFO / ' + Math.round(u.m).toLocaleString() + ' MT LSMGO (' + u.items.map(function(x) { return x.name; }).join(', ') + ')' : 'none'),
      { size:9, bold: !!u.count, color:{argb: u.count ? 'FFB8790F' : 'FF47617D'} });
    var p0 = (_calcParams || {});
    line(5, 'Usable time = gap − travel (' + (Number(p0.travelHrs) || 0) + 'h each way between jobs) − hose-up (' + (p0.hoseHrs != null ? p0.hoseHrs : 6) + 'h) − contingency (' + _contingencyHrs() + 'h, also added after every job\'s ETC). Est. = min(pump capacity, available to promise). ATP = lowest projected ROB until the next loading of that grade (30-day look-ahead) less the minimum-stock buffer. Windows under ' + FW_MIN_PARCEL_MT + ' MT are "Too short".',
      { size:9, color:{argb:'FF47617D'} });
    ws.getRow(1).height = 20; ws.getRow(3).height = 15; ws.getRow(4).height = 15; ws.getRow(5).height = 30;

    var thinBorder = { style:'thin', color:{argb:'FFD8E0E8'} };
    var border = { top:thinBorder, bottom:thinBorder, left:thinBorder, right:thinBorder };

    var headers = ['Barge','Status','Start','End','Hours','Usable h','Detail','Est. VLSFO (MT)','Est. LSMGO (MT)','ATP VLSFO (MT)','ATP LSMGO (MT)'];
    var headerRow = ws.getRow(7);
    headers.forEach(function(h, i) {
      var cell = headerRow.getCell(i+1);
      cell.value = h;
      cell.font = { bold:true, color:{argb:'FFFFFFFF'} };
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF0D1B2A'} };
      cell.alignment = { horizontal:'center', vertical:'middle', wrapText:true };
      cell.border = border;
    });
    headerRow.height = 28;

    var rowIdx = 8;
    barges.forEach(function(b) {
      var windows = computeFreeWindows(b.id, b.name, range.weekStart, range.weekEnd);

      // Summary row: total quantity this barge is already committed to
      // supply within this week — same figure shown in the on-screen panel.
      var toSupplyV = 0, toSupplyM = 0;
      windows.forEach(function(w) {
        if (w.status === 'busy' && w.kind === 'vessel') { toSupplyV += (w.nomV || 0); toSupplyM += (w.nomM || 0); }
      });
      var sumRow = ws.getRow(rowIdx++);
      ws.mergeCells('A' + sumRow.number + ':G' + sumRow.number);
      var sumCell = sumRow.getCell(1);
      sumCell.value = b.name + ' — To be supplied this week (buffer ' + windows.meta.vbuf + ' / ' + windows.meta.mbuf + ' MT kept back)';
      sumCell.font = { bold:true, italic:true, color:{argb:'FF0D1B2A'} };
      sumRow.getCell(8).value = Math.round(toSupplyV);
      sumRow.getCell(9).value = Math.round(toSupplyM);
      for (var sc = 1; sc <= NC; sc++) {
        var sCell = sumRow.getCell(sc);
        sCell.border = border;
        sCell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF0F2F5'} };
        if (sc === 8 || sc === 9) { sCell.font = { bold:true }; sCell.alignment = { horizontal:'right' }; }
      }

      windows.forEach(function(w) {
        var row = ws.getRow(rowIdx++);
        var isLoading = w.status === 'busy' && w.kind === 'loading';
        var isM = isLoading && w.grade === 'LSMGO';
        var isGap = w.status === 'free' || w.status === 'short';
        var statusLbl = { free: 'Free', short: 'Too short', busy: 'Busy', unavailable: 'Unavailable', conflict: 'Conflict' }[w.status] || w.status;
        var detail;
        if (w.status === 'busy') detail = (w.label || '') + (isLoading ? ' — ROB ' + Math.round(isM ? w.beforeM : w.beforeV).toLocaleString() + ' → ' + Math.round(isM ? w.afterM : w.afterV).toLocaleString() + ' MT ' + w.grade : '');
        else if (w.status === 'unavailable') detail = 'Unavailable — ' + (w.reason || 'no reason given');
        else if (w.status === 'conflict') detail = 'CONFLICT: ' + w.a + ' overlaps ' + w.b + ' by ' + _fwH(w.overlapHrs) + ' (' + fmtDT(w.overlapStart) + ' → ' + fmtDT(w.overlapEnd) + ')';
        else detail = (w.status === 'short' ? (w.shortReason === 'stock' ? 'No spare stock — ' : 'Too short — ') : '') + _fwBreakdown(w) +
          (w.continuesPastRange && !w.openEnded ? '; gap runs to ' + fmtDT(w.gapEnd) : '') + '. ' + _fwAtpText(w);
        var vals = [
          b.name, statusLbl, fmtDT(w.start), fmtDT(w.end), Math.round((w.end - w.start) / 3600000),
          isGap ? (w.openEnded ? 'open' : Math.round(Math.max(0, w.usableHrs) * 10) / 10) : '',
          detail,
          isGap ? w.estV : '', isGap ? w.estM : '', isGap ? w.atpV : '', isGap ? w.atpM : '',
        ];
        var fillColor = w.status === 'free' ? 'FFE2F2EB' : w.status === 'short' ? 'FFEEF1F5' : w.status === 'unavailable' ? 'FFE4E8EE'
          : w.status === 'conflict' ? 'FFF3CCC5' : (isLoading ? (isM ? 'FFFFF6EC' : 'FFEFF5FF') : 'FFFAEAE8');
        var textColor = w.status === 'free' ? 'FF147A58' : (w.status === 'short' || w.status === 'unavailable') ? 'FF5B6B7D'
          : w.status === 'conflict' ? 'FFAE3A2E' : (isLoading ? (isM ? 'FFC2570A' : 'FF1D4ED8') : 'FFAE3A2E');
        vals.forEach(function(v, c) {
          var cell = row.getCell(c+1);
          cell.value = v;
          cell.border = border;
          cell.alignment = { vertical:'middle', wrapText: c === 6, horizontal: (c >= 7 || c === 5) ? 'right' : 'left' };
          cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb: fillColor} };
          if (c === 1) cell.font = { bold:true, color:{argb: textColor} };
        });
      });
    });

    var buf = await wb.xlsx.writeBuffer();
    var blob = new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await _flowSaveOrShareBlob(blob, 'FLOW_Free_Windows_' + weekLabel.replace(/\s+/g,'') + '.xlsx');
  } catch (err) {
    alert('Could not generate the Excel file: ' + err.message);
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = origLabel; }
  }
}

function renderFreeWindowsPanel() {
  var panel = document.getElementById('free-windows-panel');
  if (!panel) return;
  var barges = _bargeConfig || [];
  if (!barges.length) {
    panel.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center;padding:16px">No barges configured.</div>';
    return;
  }
  var fmtDT = _fwFmtDT;
  var operator = !isTrader();
  // Match the SAME week the Weekly Planned Supply calendar above is
  // currently showing (respects _calWeekOffset).
  var range = _freeWindowsWeekRange();
  var weekStart = range.weekStart, weekEnd = range.weekEnd;
  var weekLabel = weekStart.toLocaleDateString('en-GB',{day:'2-digit',month:'short'}) + ' – ' +
    new Date(weekEnd.getTime() - 1).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  var info = _fwStatusInfo(range);
  var cont = _contingencyHrs();
  var nowT = new Date();

  var liveROBsAll = (typeof getAllLiveROBs === 'function') ? getAllLiveROBs() : {};
  var cols = barges.map(function(b) {
    var windows = computeFreeWindows(b.id, b.name, weekStart, weekEnd);
    var liveRob = liveROBsAll[b.id] || {};
    var vtph = b.vtph || 300, mtph = b.mtph || 100;
    var k = _fwKey(b.id), bid = escJs(String(b.id));
    // Quantity this barge is already committed to supply within THIS week.
    var toSupplyV = 0, toSupplyM = 0;
    windows.forEach(function(w) {
      if (w.status === 'busy' && w.kind === 'vessel') { toSupplyV += (w.nomV || 0); toSupplyM += (w.nomM || 0); }
    });
    var robLine = '<div style="font-size:10px;color:var(--muted);margin-bottom:8px">' +
      'ROB now: <span style="color:var(--fuel-v);font-weight:700">' + Math.round(liveRob.liveV || 0).toLocaleString() + '</span>/' + Math.round(liveRob.vcap || 0).toLocaleString() + ' MT VLSFO' +
      ' · <span style="color:var(--fuel-m);font-weight:700">' + Math.round(liveRob.liveM || 0).toLocaleString() + '</span>/' + Math.round(liveRob.mcap || 0).toLocaleString() + ' MT LSMGO' +
      ' &nbsp;·&nbsp; Supply rate: ' + vtph + '/' + mtph + ' MT/h' +
      '<br>To be supplied this week: <span style="color:var(--fuel-v);font-weight:700">' + Math.round(toSupplyV).toLocaleString() + ' MT VLSFO</span>' +
      ' · <span style="color:var(--fuel-m);font-weight:700">' + Math.round(toSupplyM).toLocaleString() + ' MT LSMGO</span>' +
      '<br>Minimum-stock buffer kept back: ' + windows.meta.vbuf.toLocaleString() + ' / ' + windows.meta.mbuf.toLocaleString() + ' MT' +
    '</div>';

    // Block-out controls — operator data, so never rendered for a trader.
    var blockUi = '';
    if (operator) {
      var blocks = _blocksForBarge(b.id, b.name).filter(function(x) { return new Date(x.end) > nowT; })
        .sort(function(x, y) { return new Date(x.start) - new Date(y.start); });
      var inp = 'style="padding:5px 7px;font-size:11px"';
      blockUi = '<div style="margin-bottom:8px">' +
        '<button class="btn btn-secondary btn-sm" id="fw-blk-btn-' + k + '" onclick="fwToggleBlockForm(\'' + bid + '\')">+ Block out time</button>' +
        '<div id="fw-blk-form-' + k + '" style="display:none;margin-top:6px;padding:8px 10px;background:var(--surface2);border:1px solid var(--border2);border-radius:6px">' +
          '<div style="display:grid;grid-template-columns:1fr 70px;gap:6px">' +
            '<div class="field"><label for="fw-blk-sd-' + k + '">From</label><input type="date" id="fw-blk-sd-' + k + '" ' + inp + '></div>' +
            '<div class="field"><label for="fw-blk-st-' + k + '">Time</label><input type="text" id="fw-blk-st-' + k + '" inputmode="numeric" placeholder="HH:MM" maxlength="5" value="08:00" oninput="_maskTime24Input(this)" onblur="_fwNormTime(this)" ' + inp + '></div>' +
            '<div class="field"><label for="fw-blk-ed-' + k + '">To</label><input type="date" id="fw-blk-ed-' + k + '" ' + inp + '></div>' +
            '<div class="field"><label for="fw-blk-et-' + k + '">Time</label><input type="text" id="fw-blk-et-' + k + '" inputmode="numeric" placeholder="HH:MM" maxlength="5" value="18:00" oninput="_maskTime24Input(this)" onblur="_fwNormTime(this)" ' + inp + '></div>' +
          '</div>' +
          '<div class="field" style="margin-top:6px"><label for="fw-blk-reason-' + k + '">Reason</label><input type="text" id="fw-blk-reason-' + k + '" maxlength="120" placeholder="Maintenance, off-hire, crew change, weather…" ' + inp + '></div>' +
          '<div style="display:flex;gap:6px;margin-top:8px">' +
            '<button class="btn btn-primary btn-sm" id="fw-blk-save-' + k + '" onclick="addBargeBlock(\'' + bid + '\')">Save block</button>' +
            '<button class="btn btn-secondary btn-sm" onclick="fwToggleBlockForm(\'' + bid + '\')">Cancel</button>' +
          '</div>' +
        '</div>' +
        (blocks.length ? '<div style="margin-top:6px">' + blocks.map(function(x) {
          return '<div class="fw-blk-item" data-block-id="' + esc(x.id) + '" style="display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:10.5px;color:var(--sub);padding:3px 0;border-top:1px solid var(--border2)">' +
            '<span>' + fmtDT(new Date(x.start)) + ' → ' + fmtDT(new Date(x.end)) + ' · ' + esc(x.reason || 'No reason given') + (x.createdBy ? ' <span style="color:var(--muted)">(' + esc(x.createdBy) + ')</span>' : '') + '</span>' +
            '<button class="btn btn-secondary btn-sm" style="padding:2px 8px;font-size:10px" title="Remove this block" onclick="deleteBargeBlock(\'' + escJs(x.id) + '\')">Remove</button>' +
          '</div>';
        }).join('') + '</div>' : '') +
      '</div>';
    }

    var rows = windows.length ? windows.map(function(w) {
      var range2 = fmtDT(w.start) + ' → ' + fmtDT(w.end);
      if (w.status === 'conflict') {
        return '<div class="fw-row fw-conflict" style="padding:7px 10px;background:var(--red-lt);border:1px solid var(--red-bd);border-left:3px solid var(--red);border-radius:4px;margin-bottom:5px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
            '<div style="font-size:11.5px;font-weight:700;color:var(--red)">⚠ Conflict · ' + range2 + '</div>' +
            '<div style="font-size:10.5px;font-weight:700;color:var(--red)">' + _fwH(w.overlapHrs) + ' overlap</div>' +
          '</div>' +
          '<div style="font-size:10.5px;color:var(--red);margin-top:2px">' + esc(w.a) + ' overlaps ' + esc(w.b) + ' — the barge can\'t do both; fix one of them.</div>' +
        '</div>';
      }
      if (w.status === 'unavailable') {
        return '<div class="fw-row fw-unavailable" style="padding:7px 10px;background:repeating-linear-gradient(135deg,var(--surface2) 0 6px,var(--surface) 6px 12px);border:1px solid var(--border2);border-left:3px solid var(--muted);border-radius:4px;margin-bottom:5px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
            '<div style="font-size:11.5px;font-weight:700;color:var(--sub)">' + range2 + '</div>' +
            '<div style="font-size:10.5px;color:var(--sub);text-align:right">Unavailable — ' + esc(w.reason || 'no reason given') + '</div>' +
          '</div>' +
        '</div>';
      }
      if (w.status === 'busy') {
        // Loading gets its own grade colour; vessel-busy keeps red.
        var isLoading = w.kind === 'loading';
        var isM = isLoading && w.grade === 'LSMGO';
        var busyColor = isLoading ? (isM ? 'var(--fuel-m)' : 'var(--fuel-v)') : 'var(--red)';
        var busyBg = isLoading ? (isM ? 'var(--fuel-m-lt)' : 'var(--fuel-v-lt)') : 'var(--red-lt2)';
        // Loading: what's onboard right before vs. once it's done.
        var robChangeText = '';
        if (isLoading) {
          robChangeText = '<div style="font-size:10px;color:' + busyColor + ';margin-top:2px">' +
            'ROB ' + Math.round((isM ? w.beforeM : w.beforeV) || 0).toLocaleString() + ' → ' + Math.round((isM ? w.afterM : w.afterV) || 0).toLocaleString() + ' MT ' + esc(w.grade) +
          '</div>';
        }
        return '<div class="fw-row fw-busy" style="padding:7px 10px;background:' + busyBg + ';border-left:3px solid ' + busyColor + ';border-radius:4px;margin-bottom:5px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
            '<div style="font-size:11.5px;font-weight:700;color:' + busyColor + '">' + range2 + '</div>' +
            '<div style="font-size:10.5px;color:' + busyColor + ';text-align:right">Busy — ' + esc(w.label || '') + '</div>' +
          '</div>' +
          robChangeText +
        '</div>';
      }
      var tip = _fwBreakdown(w) + '\n' +
        (w.openEnded ? 'Pump capacity: unlimited (nothing booked after)' : 'Pump capacity: ' + w.pumpV.toLocaleString() + ' MT VLSFO or ' + w.pumpM.toLocaleString() + ' MT LSMGO') + '\n' +
        _fwAtpText(w) + (w.continuesPastRange && !w.openEnded ? '\nGap runs to ' + fmtDT(w.gapEnd) : '');
      var usableTxt = w.openEnded ? 'open-ended' : _fwH(Math.max(0, w.usableHrs)) + ' usable';
      if (w.status === 'short') {
        var why = w.shortReason === 'stock' ? 'No spare stock — committed to later jobs / buffer' : 'Too short';
        return '<div class="fw-row fw-short" title="' + esc(tip) + '" style="padding:7px 10px;background:var(--surface2);border-left:3px solid var(--muted);border-radius:4px;margin-bottom:5px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
            '<div style="font-size:11.5px;font-weight:700;color:var(--sub)">' + range2 + '</div>' +
            '<div style="font-size:10.5px;font-weight:700;color:var(--sub);text-align:right">' + why + '</div>' +
          '</div>' +
          '<div style="font-size:10px;color:var(--muted);margin-top:2px">' + _fwBreakdown(w) + '</div>' +
        '</div>';
      }
      return '<div class="fw-row fw-free" title="' + esc(tip) + '" style="padding:7px 10px;background:var(--green-lt2);border-left:3px solid var(--green);border-radius:4px;margin-bottom:5px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
          '<div>' +
            '<div style="font-size:11.5px;font-weight:700;color:var(--green)">' + range2 + '</div>' +
            '<div style="font-size:10px;color:var(--green)">' + (w.openEnded ? 'Free from here' : _fwH(w.gapHrs) + ' gap') + ' · ' + usableTxt + '</div>' +
          '</div>' +
          '<div style="font-size:10px;color:var(--green);text-align:right">~' + w.estV.toLocaleString() + ' MT VLSFO or ~' + w.estM.toLocaleString() + ' MT LSMGO max' +
            '<div style="color:var(--sub)">ATP ' + w.atpV.toLocaleString() + ' / ' + w.atpM.toLocaleString() + ' MT</div></div>' +
        '</div>' +
        '<div style="font-size:10px;color:var(--sub);margin-top:2px">' + _fwBreakdown(w) + (w.continuesPastRange && !w.openEnded ? ' · gap runs to ' + fmtDT(w.gapEnd) : '') + '</div>' +
      '</div>';
    }).join('') : '<div style="font-size:11px;color:var(--muted);padding:8px 0">Fully busy this week.</div>';
    return '<div class="fw-col" data-barge-id="' + esc(b.id) + '" style="flex:1;min-width:240px">' +
      '<div style="font-size:12.5px;font-weight:700;color:var(--ink);margin-bottom:4px">' + esc(b.name || '') + '</div>' +
      robLine + blockUi + rows +
    '</div>';
  }).join('');

  var genLine = '<div id="fw-sched-gen" style="font-size:10.5px;color:var(--muted);margin-bottom:6px">' + esc(info.genText) +
    (!info.staleText && operator && (!info.hasSched || !info.stale.known) && (document.querySelectorAll('.vcard[id^="vessel-"]').length) ?
      ' <button class="btn btn-secondary btn-sm" style="padding:2px 8px;font-size:10px;margin-left:4px" onclick="fwRegenerateSchedule()">Generate schedule</button>' : '') + '</div>';
  var staleBox = info.staleText ? '<div id="fw-stale-warning" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;background:var(--amber-lt);border:1px solid var(--amber-bd);border-left:3px solid var(--amber);border-radius:6px;padding:7px 10px;margin-bottom:8px">' +
      '<div style="font-size:11px;font-weight:700;color:var(--amber)">⚠ ' + esc(info.staleText) + '</div>' +
      (operator ? '<button class="btn btn-secondary btn-sm" id="fw-regenerate-btn" onclick="fwRegenerateSchedule()">Regenerate schedule</button>' : '') +
    '</div>' : '';
  var u = info.unassigned;
  var unassignedLine = '<div id="fw-unassigned" style="font-size:11px;margin-bottom:8px;' + (u.count ? 'color:var(--amber);font-weight:700' : 'color:var(--muted)') + '">' +
    'Unassigned demand this week: ' + (u.count
      ? u.count + ' vessel' + (u.count > 1 ? 's' : '') + ' — ' + Math.round(u.v).toLocaleString() + ' MT VLSFO / ' + Math.round(u.m).toLocaleString() + ' MT LSMGO' +
        '<span style="font-weight:400;color:var(--sub)"> · ' + u.items.map(function(x) { return esc(x.name); }).join(', ') + ' — not on any barge yet, so free time below is not spare capacity for them</span>'
      : 'none') +
  '</div>';
  var legendChip = function(bg, bd, txt, col) { return '<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px"><span style="width:10px;height:10px;border-radius:2px;background:' + bg + ';border-left:3px solid ' + bd + '"></span><span style="color:' + col + '">' + txt + '</span></span>'; };
  var legend = '<div style="font-size:10px;margin-bottom:8px;display:flex;flex-wrap:wrap;row-gap:4px">' +
    legendChip('var(--green-lt2)', 'var(--green)', 'Free', 'var(--sub)') +
    legendChip('var(--surface2)', 'var(--muted)', 'Too short', 'var(--sub)') +
    legendChip('var(--red-lt2)', 'var(--red)', 'Busy', 'var(--sub)') +
    legendChip('repeating-linear-gradient(135deg,var(--surface2) 0 3px,var(--surface) 3px 6px)', 'var(--muted)', 'Unavailable', 'var(--sub)') +
    legendChip('var(--red-lt)', 'var(--red)', 'Conflict', 'var(--sub)') +
  '</div>';

  panel.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">' +
      '<div style="font-size:11px;font-weight:700;color:var(--ink)">Week of ' + weekLabel + '</div>' +
      '<button class="btn btn-secondary btn-sm" id="free-windows-download-btn" onclick="downloadFreeWindowsReport(this)">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;vertical-align:-2px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
        'Download' +
      '</button>' +
    '</div>' +
    genLine + staleBox + unassignedLine +
    '<div style="font-size:10.5px;color:var(--muted);margin-bottom:8px">Free windows (green) are gaps in the schedule — vessel supply, Loading and Unavailable blocks all count as busy, and every job\'s ETC is padded by a ' + cont + 'h overrun contingency. Usable pumping time = gap − ' + ((_calcParams && _calcParams.travelHrs) || 0) + 'h travel each way between jobs − ' + ((_calcParams && _calcParams.hoseHrs != null) ? _calcParams.hoseHrs : 6) + 'h hook-up − ' + cont + 'h contingency (same numbers the scheduler uses). The estimate is also capped by available-to-promise: the lowest ROB the barge is projected to hold before its next loading of that grade (later jobs up to ' + FW_LOOKAHEAD_DAYS + ' days ahead included), less its minimum-stock buffer. Gaps under ' + FW_MIN_PARCEL_MT + ' MT show as Too short; overlapping bookings show as Conflict. Purely informational — nothing here books anything.</div>' +
    legend +
    '<div style="display:flex;gap:16px;flex-wrap:wrap">' + cols + '</div>';
}

