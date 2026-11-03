/* ─── DOWNLOAD ANALYTICS REPORT ─── */
// Lazy-loads the datalabels plugin (draws exact numbers directly on each
// bar/point) — only needed for the high-quality Analytics export, not the
// normal in-app charts, so it's not loaded on every page view.
async function _loadChartDataLabels() {
  if (typeof ChartDataLabels !== 'undefined') return ChartDataLabels;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/chartjs-plugin-datalabels/2.2.0/chartjs-plugin-datalabels.min.js';
    s.onload = () => resolve(ChartDataLabels);
    s.onerror = () => reject(new Error('Could not load the chart labels plugin. Check your internet connection.'));
    document.head.appendChild(s);
  });
}

async function downloadAnalyticsReport() {
  const btn = document.querySelector('button[onclick="downloadAnalyticsReport()"]');
  const origLabel = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = 'Preparing high-res charts…'; }
  try {
    await new Promise(r => setTimeout(r, 0));

    // Live + archived completed records (same source as Monthly Report), so
    // "All time" really is all time and matches the report totals.
    const recs = _getAllReportRecords().filter(r => r.supplied);
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});

    // Totals are actual delivered quantities over every completed record,
    // live and archived (_getAllReportRecords) — the export previously
    // counted live records only while labelling the period "All time".
    let totalV = 0, totalM = 0;
    recs.forEach(r => {
      totalV += _recActQty(r, 'v');
      totalM += _recActQty(r, 'm');
    });
    const ops = recs.length;
    const avgV = ops ? (totalV/ops) : 0;

  // Maps each canvas's DOM id to the key it's actually stored under in
  // _chartInstances (inconsistent historically — most use a short name,
  // the newer Bunker Quantity chart uses its full canvas id).
  const chartMap = [
    { canvasId: 'chart-monthly-trend',         instKey: 'monthly-trend',              title: 'Monthly Supply Trend (VLSFO & LSMGO)' },
    { canvasId: 'chart-fuel-mix',               instKey: 'fuel-mix',                   title: 'Barge Performance — Supplied per Grade' },
    { canvasId: 'chart-vessel-vol',             instKey: 'vessel-vol',                 title: 'Top Vessels by Volume (VLSFO + LSMGO)' },
    { canvasId: 'chart-supply-freq',            instKey: 'supply-freq',                title: 'Top Ports by Vessel Count' },
    { canvasId: 'chart-monthly-qty-analytics',  instKey: 'chart-monthly-qty-analytics',title: 'Bunker Quantity — ' + _fySelectedLabel() }
  ];

  let chartsHtml = '';
  let ChartDataLabelsPlugin = null;
  try {
    ChartDataLabelsPlugin = await _loadChartDataLabels();
  } catch (e) {
    console.warn('Datalabels plugin failed to load — export will still work, just without printed numbers:', e.message);
  }
  // IMPORTANT: never call Chart.register(ChartDataLabelsPlugin) here — that
  // registers it GLOBALLY, silently turning on permanent number-overlays
  // on every chart in the whole app (including ones this function never
  // touches, like the dashboard donuts). Instead it's passed directly into
  // each TEMPORARY chart's own `plugins:` array below, scoping it to only
  // that one export-only chart instance.

  for (const { canvasId, instKey, title } of chartMap) {
    const liveChart = _chartInstances[instKey];
    if (!liveChart) continue;

    // Build a completely separate, detached, high-resolution chart from a
    // clone of the live chart's data — the live chart itself is NEVER
    // touched, so there's no restore step needed and no risk of leaving it
    // broken (which is what happened when this used to mutate it in place).
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 1800;
    tempCanvas.height = 900;
    let tempChart = null;
    try {
      const clonedData = JSON.parse(JSON.stringify(liveChart.data));
      const isLine = liveChart.config.type === 'line';
      const isDonut = liveChart.config.type === 'doughnut' || liveChart.config.type === 'pie';

      tempChart = new Chart(tempCanvas, {
        type: liveChart.config.type,
        data: clonedData,
        plugins: ChartDataLabelsPlugin ? [ChartDataLabelsPlugin] : [],
        options: {
          responsive: false, animation: false, devicePixelRatio: 1, // canvas is already explicitly high-res
          plugins: {
            legend: { display: true, position: 'top', labels: { font: { size: 20, family: 'DM Sans' }, boxWidth: 20, padding: 20, color: '#1a2332' } },
            datalabels: !ChartDataLabelsPlugin ? { display: false } : (isDonut ? {
              color: '#1a2332', font: { size: 18, family: 'DM Mono, monospace', weight: '700' },
              formatter: (value) => value ? fmtMT(value) : ''
            } : {
              color: isLine ? (ctx => ctx.datasetIndex === 0 ? 'rgba(37,99,235,1)' : 'rgba(249,115,22,1)') : '#1a2332',
              anchor: 'end', align: isLine ? 'top' : 'end', offset: 6,
              font: { size: 16, family: 'DM Mono, monospace', weight: '700' },
              formatter: (value) => (typeof value === 'number' && value !== 0) ? fmtMT(value) : ''
            })
          },
          scales: isDonut ? undefined : {
            x: { grid: { display: false }, ticks: { font: { size: 16, family: 'DM Mono' }, color: '#1a2332' } },
            y: { grid: { color: '#E0E0E0' }, ticks: { font: { size: 16, family: 'DM Mono' }, color: '#1a2332', callback: v => fmtMT(v) + ' MT' } }
          }
        }
      });

      const img = tempCanvas.toDataURL('image/png', 1.0);
      chartsHtml += `
        <div style="margin-bottom:32px;page-break-inside:avoid">
          <div style="font-size:11px;font-weight:700;color:var(--ink);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;border-left:3px solid #1565C0;padding-left:8px">${title}</div>
          <img src="${img}" style="width:100%;max-width:900px;border:1px solid #E0E0E0;border-radius:6px" />
        </div>`;
    } catch (e) {
      console.warn(`Could not render high-res export for "${title}":`, e.message);
    } finally {
      if (tempChart) tempChart.destroy(); // temp chart + detached canvas are discarded either way — nothing here ever touched the live chart
    }
  }

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>FLOW Analytics Report — ${dateStr}</title>
  <style>
    body{font-family:'DM Sans',Arial,sans-serif;margin:0;padding:32px 48px;color:#0F1E30;background:#fff}
    .header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:2px solid #0F1E30;margin-bottom:24px}
    .logo{font-size:22px;font-weight:800;letter-spacing:.05em;color:#0F1E30}
    .logo span{color:#2C5FA8}
    .meta{font-size:11px;color:#555;text-align:right;line-height:1.7}
    .kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:28px}
    .kpi{background:#F5F8FF;border:1px solid #C8D8F0;border-radius:8px;padding:14px 16px}
    .kpi-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#555;display:block;margin-bottom:4px}
    .kpi-value{font-size:20px;font-weight:800;color:#2C5FA8;display:block;font-family:monospace}
    .kpi-sub{font-size:9px;color:#888;margin-top:2px}
    .section-title{font-size:14px;font-weight:700;color:#0F1E30;margin:28px 0 16px;border-bottom:1px solid #E0E0E0;padding-bottom:6px}
    @media print{.kpi-grid{break-inside:avoid}}
  </style>
  </head><body>
  <div class="header">
    <div><div class="logo">FLOW <span>Analytics</span></div><div style="font-size:11px;color:#555;margin-top:4px">Bunker Planning System</div></div>
    <div class="meta">Generated: ${now.toLocaleString()}<br>Records: ${ops}<br>Period: All time</div>
  </div>
  <div class="kpi-grid">
    <div class="kpi"><span class="kpi-label">Total VLSFO Delivered</span><span class="kpi-value">${fmtMT(totalV)} MT</span><div class="kpi-sub">All completed records (live + archived)</div></div>
    <div class="kpi"><span class="kpi-label">Total LSMGO Delivered</span><span class="kpi-value">${fmtMT(totalM)} MT</span><div class="kpi-sub">All completed records (live + archived)</div></div>
    <div class="kpi"><span class="kpi-label">Supply Operations</span><span class="kpi-value">${ops}</span><div class="kpi-sub">Completed deliveries</div></div>
    <div class="kpi"><span class="kpi-label">Avg per Delivery</span><span class="kpi-value">${fmtMT(avgV)} MT</span><div class="kpi-sub">VLSFO average</div></div>
  </div>
  <div class="section-title">Performance Charts</div>
  ${chartsHtml || '<p style="color:#888;font-size:12px">No chart data available. Open Analytics page first to generate charts.</p>'}
  </body></html>`;

  const blob = new Blob([html], {type:'text/html'});
  await _flowSaveOrShareBlob(blob, `FLOW_Analytics_${now.toISOString().slice(0,10)}.html`);
  } catch (e) {
    console.error('Analytics download failed:', e);
    alert('Could not generate the analytics report: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origLabel; }
  }
}
function downloadChecklist() {
  try {
    if (typeof XLSX === 'undefined') { alert('The Excel export library has not finished loading yet — wait a moment and try again.'); return; }
    const records = Object.values(_checklistRecords || {}).sort(_clDateSort);
    if (!records.length) { alert('No checklist records. Generate the schedule first.'); return; }
    const WB = XLSX.utils.book_new(), ws = {};
    const S = {hdr:{font:{bold:true,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'0D1B2A'}},alignment:{horizontal:'center'}}};
    const hdrs = ['S.No.','Vessel','Date of Supply','Barge','Nom. VLSFO (MT)','Actual VLSFO (MT)','BDN No. (VLSFO)','Nom. MGO (MT)','Actual MGO (MT)','BDN No. (LSMGO)','Supplied?','Locked?','Notes'];
    hdrs.forEach((h,c) => ws[XLSX.utils.encode_cell({r:0,c})] = {v:h,t:'s',s:S.hdr});
    records.forEach((rec,i) => {
      const actV = rec.actV !== '' ? parseFloat(rec.actV)||0 : '';
      const actM = rec.actM !== '' ? parseFloat(rec.actM)||0 : '';
      [i+1, rec.vessel, rec.supplyDate ? fmt24(rec.supplyDate) : '—', rec.bargeLabel||'',
       (rec.nomV===null||rec.nomV===undefined)?'':(_nomRange(rec,'V')?_nomQtyTxt(rec,'V',rec.nomV):rec.nomV), actV, rec.bdnV||'',
       (rec.nomM===null||rec.nomM===undefined)?'':(_nomRange(rec,'M')?_nomQtyTxt(rec,'M',rec.nomM):rec.nomM), actM, rec.bdnM||'',
       rec.lockedAt?'YES':'PENDING', rec.lockedAt?'LOCKED':'', rec.notes||'']
        .forEach((v,c) => ws[XLSX.utils.encode_cell({r:i+1,c})] = {v,t:typeof v==='number'?'n':'s'});
    });
    ws['!ref'] = XLSX.utils.encode_range({s:{r:0,c:0},e:{r:records.length,c:12}});
    ws['!cols'] = [{wch:6},{wch:22},{wch:22},{wch:16},{wch:16},{wch:16},{wch:16},{wch:14},{wch:14},{wch:16},{wch:12},{wch:10},{wch:25}];
    XLSX.utils.book_append_sheet(WB, ws, 'Checklist');
    _flowSaveOrShareBlob(new Blob([XLSX.write(WB,{bookType:'xlsx',type:'array'})],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}), 'FLOW_Checklist.xlsx');
  } catch (e) {
    alert('Could not download the checklist: ' + e.message);
  }
}

/* ─── MONTHLY REPORT ─── */
let _reportMode = 'month';
// Date-field example placeholders ("01 Jan 2026") follow the current year.
function _setYearPlaceholders() {
  const y = new Date().getFullYear();
  [['report-from', '01 Jan '], ['report-to', '31 Jan '], ['btr-from', '01 Jan '], ['btr-to', '31 Jan ']].forEach(function(p) {
    const el = document.getElementById(p[0]);
    if (el) el.placeholder = p[1] + y;
  });
}
document.addEventListener('DOMContentLoaded', _setYearPlaceholders);
function openMonthlyReport() {
  if (!_lastSched.length && !_savedSupplies.length) { alert('Run schedule or save some records first.'); return; }
  const now = new Date();
  document.getElementById('report-month').value = now.getMonth();
  document.getElementById('report-year').value  = Math.max(2026, now.getFullYear());
  _setYearPlaceholders();
  setReportMode('month');
  setReportPort('ALL');
  renderMonthlyPreview();
  document.getElementById('monthly-modal').style.display = 'flex';
}
function closeMonthlyReport() {
  document.getElementById('monthly-modal').style.display = 'none';
  _reportPort = 'ALL'; // the FUJ / KFK choice belongs to this window only
}
let _reportPort = 'ALL';
function setReportPort(port) {
  _reportPort = port;
  ['all','fuj','kfk'].forEach(function(p){
    var btn = document.getElementById('report-port-'+p);
    if (!btn) return;
    var active = p.toUpperCase() === port;
    btn.style.background = active ? 'var(--azure)' : 'var(--surface)';
    btn.style.color = active ? '#fff' : 'var(--sub)';
  });
  renderMonthlyPreview();
}
/* The Monthly Report window's FUJ / KFK choice applies to that report (preview,
   downloads, Archive Month) only — callers pass it explicitly. Everything else
   (dashboard, Reports page, Bunker Quantity charts, auto-archive) counts every
   port: the choice used to stay set after closing the window and silently
   filter the dashboard's Distributed chart and the Reports page too. */
function _rowMatchesReportPort(r, port) {
  port = port || 'ALL';
  if (port === 'ALL') return true;
  var areaKey = r.areaCode || r.area || '';
  const _rpMap = { 'FUJ-A':'FUJ', 'FUJ-B':'FUJ', 'KFK-A':'KFK', 'KFK-B':'KFK' };
  var rowPort = _rpMap[areaKey] || _rpMap[Object.keys(_rpMap).find(k => areaKey.includes(k)) || ''];
  if (!rowPort) rowPort = areaKey.includes('KFK') ? 'KFK' : areaKey.includes('FUJ') ? 'FUJ' : null;
  return rowPort === port;
}
function setReportMode(mode) {
  _reportMode = mode;
  document.getElementById('report-mode-month').style.display = mode==='month' ? '' : 'none';
  document.getElementById('report-mode-range').style.display = mode==='range' ? '' : 'none';
  document.getElementById('mode-month-btn').style.background = mode==='month' ? 'var(--azure)' : 'var(--surface)';
  document.getElementById('mode-month-btn').style.color = mode==='month' ? '#fff' : 'var(--sub)';
  document.getElementById('mode-range-btn').style.background = mode==='range' ? 'var(--azure)' : 'var(--surface)';
  document.getElementById('mode-range-btn').style.color = mode==='range' ? '#fff' : 'var(--sub)';
  renderMonthlyPreview();
}
function renderMonthlyPreview() {
  const prev = document.getElementById('monthly-preview'); if (!prev) return;
  let rows, rangeLabel;
  if (_reportMode === 'range') {
    const fromVal = document.getElementById('report-from')?.value, toVal = document.getElementById('report-to')?.value;
    const fromD = fromVal ? parseDT(fromVal) : null, toD = toVal ? parseDT(toVal) : null;
    if (!fromD || !toD) { prev.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:8px 0">Select a From and To date to view the range.</div>'; return; }
    const toEnd = new Date(toD.getFullYear(), toD.getMonth(), toD.getDate(), 23, 59, 59);
    rows = getRowsByRange(fromD, toEnd, _reportPort);
    rangeLabel = `${fmtShort(fromD)} ${fromD.getFullYear()} – ${fmtShort(toD)} ${toD.getFullYear()}`;
  } else {
    const mon = parseInt(document.getElementById('report-month').value), yr = parseInt(document.getElementById('report-year').value);
    rows = getMonthlyRows(mon, yr, _reportPort);
    rangeLabel = `${MO[mon]} ${yr}`;
  }
  if (_reportPort !== 'ALL') rangeLabel += ` — ${_reportPort}`;
  if (!rows.length) { prev.innerHTML = `<div style="font-size:12px;color:var(--muted);padding:10px 14px;background:var(--surface);border-radius:8px;border:none;box-shadow:var(--sh-in-xs)">No <strong>completed and saved</strong> supply records found for ${rangeLabel}.<br><span style="font-size:11px">Only supplies marked as  Completed and saved via the checklist appear in Monthly Reports.</span></div>`; return; }
  const totV = rows.reduce((a,r)=>a+(r.vQ||0),0), totM = rows.reduce((a,r)=>a+(r.mQ||0),0);
  const rpMap = _bargeColorMap();
  prev.innerHTML = `<div style="font-size:12px;color:var(--sub);margin-bottom:8px">${rows.length} record${rows.length>1?'s':''} — <strong>${rangeLabel}</strong></div>
  <table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="background:var(--ink-solid);color:#fff"><th style="padding:6px 8px;text-align:left">Vessel</th><th style="padding:6px 8px;text-align:left">Date</th><th style="padding:6px 8px;text-align:right">VLSFO</th><th style="padding:6px 8px;text-align:left">BDN (VLSFO)</th><th style="padding:6px 8px;text-align:right">MGO</th><th style="padding:6px 8px;text-align:left">BDN (LSMGO)</th><th style="padding:6px 8px;text-align:left">Barge</th></tr></thead>
  <tbody>${rows.map(r=>`<tr style="border-bottom:.5px solid var(--border2)"><td style="padding:6px 8px;font-weight:500">${esc(r.name)}</td><td style="padding:6px 8px;font-family:DM Mono,monospace">${esc(r.dateStr)}</td><td style="padding:6px 8px;text-align:right;font-family:DM Mono,monospace">${r.vQ>0?fmtMT(r.vQ):'—'}</td><td style="padding:6px 8px;font-family:DM Mono,monospace">${esc(r.bdnV||'—')}</td><td style="padding:6px 8px;text-align:right;font-family:DM Mono,monospace">${r.mQ>0?fmtMT(r.mQ):'—'}</td><td style="padding:6px 8px;font-family:DM Mono,monospace">${esc(r.bdnM||'—')}</td><td style="padding:6px 8px">${_bargeDot(r.bargeLabel, rpMap)}${esc(r.bargeLabel||'—')}</td></tr>`).join('')}
  <tr style="background:var(--bg);font-weight:700"><td style="padding:6px 8px" colspan="2">TOTAL</td><td style="padding:6px 8px;text-align:right;font-family:DM Mono,monospace">${fmtMT(totV)} MT</td><td style="padding:6px 8px"></td><td style="padding:6px 8px;text-align:right;font-family:DM Mono,monospace">${fmtMT(totM)} MT</td><td style="padding:6px 8px"></td><td style="padding:6px 8px"></td></tr>
  </tbody></table>`;
}
setTimeout(() => {
  const rm = document.getElementById('report-month'), ry = document.getElementById('report-year');
  if (rm) rm.addEventListener('change', renderMonthlyPreview);
  if (ry) ry.addEventListener('input', renderMonthlyPreview);
}, 100);
function _getAllReportRecords() {
  // Combine live saved supplies + archived records for Monthly Report visibility
  const base = _savedSupplies || [];
  const archRows = [];
  if (typeof _archives !== 'undefined') {
    _liveArchiveEntries().forEach(({ arch }) => { // skips deleted-archive tombstones
          arch.records.forEach(r => {
            archRows.push(Object.assign({}, r, {
              vessel: r.vessel || r.name || 'Unknown',
              vlsfoAct: _recActQty(r, 'v'),
              mgoAct:   _recActQty(r, 'm'),
              supplyDate: r.supplyDate || r.date || (arch.month != null && arch.year != null ? new Date(arch.year, arch.month, 1).toISOString() : arch.archivedAt) || '',
              supplied: true,
              _fromArchive: true
            }));
          });
    });
  }
  const liveIds = new Set(base.map(r => r.id).filter(Boolean));
  // The same delivery live and archived (_sameDelivery): the live record wins over the
  // archived copy (even after its quantities were edited, which changes the fuzzy key below).
  const liveByCl = new Map();
  base.forEach(r => { if (r && r.checklistUid) { if (!liveByCl.has(r.checklistUid)) liveByCl.set(r.checklistUid, []); liveByCl.get(r.checklistUid).push(r); } });
  // Safety net for the same delivery present BOTH live and archived without
  // a matching id: drop the archived copy when its fuzzy key equals a live
  // record's. Two live records (or two archived ones) are never collapsed —
  // that silently dropped genuine split / repeat deliveries from reports.
  const liveKeys = new Set(base.map(r => _recordDedupeKey(r)));
  const supIds = _supersededIds(base.concat(archRows)); // copies a re-saved / edited record replaced
  // Two archived copies of one delivery that the archive keeps (rows without nomUids are never
  // deleted on a match, and one record can be archived in two months): count the newest.
  const archHidden = new Set(), archByCl = new Map();
  archRows.forEach(r => { if (r.checklistUid) { if (!archByCl.has(r.checklistUid)) archByCl.set(r.checklistUid, []); archByCl.get(r.checklistUid).push(r); } });
  archByCl.forEach(list => {
    if (list.length < 2) return;
    const t = r => Date.parse(r.savedAt || '') || 0, kept = [];
    list.slice().sort((a, b) => t(b) - t(a)).forEach(r => { if (kept.some(k => (k.id && k.id === r.id) || _sameDelivery(k, r))) archHidden.add(r); else kept.push(r); });
  });
  const combined = [...base, ...archRows.filter(r => {
    if (archHidden.has(r)) return false;
    if (r.id && liveIds.has(r.id)) return false;
    if (r.id && supIds.has(r.id)) return false;
    if (r.checklistUid && liveByCl.has(r.checklistUid) && liveByCl.get(r.checklistUid).some(l => _sameDelivery(l, r))) return false;
    const key = _recordDedupeKey(r);
    return !(key.replace(/\|/g, '') && liveKeys.has(key));
  })];
  return combined;
}
function getRowsByRange(fromD, toD, port) {
  return _getAllReportRecords().filter(r => {
    if (!r.supplyDate) return false;
    const d = _parseDateLocal(r.supplyDate);
    return d >= fromD && d <= toD && r.supplied === true && _rowMatchesReportPort(r, port);
  }).sort((a,b) => _parseDateLocal(a.supplyDate) - _parseDateLocal(b.supplyDate))
    // Only supplied rows reach here, so report the ACTUAL quantity (0 is a
    // real actual) — never fall back to the nominated figure.
    .map(r => ({name:r.vessel||r.name, dateStr:r.dateStr||(r.supplyDate?_parseDateLocal(r.supplyDate).toLocaleDateString():'—'), vQ:_recActQty(r,'v'), mQ:_recActQty(r,'m'), bdnV:r.bdnV||'', bdnM:r.bdnM||'', bargeLabel:r.barge||r.bargeLabel, fromSaved:true, fromArchive:!!r._fromArchive, spec:r.spec, agent:r.agent, notes:r.notes, area:r.area, areaCode:r.areaCode}));
}
function getMonthlyRows(mon, yr, port) {
  return _getAllReportRecords().filter(r => {
    if (!r.supplyDate) return false;
    const d = _parseDateLocal(r.supplyDate);
    return d.getMonth() === mon && d.getFullYear() === yr && r.supplied === true && _rowMatchesReportPort(r, port);
  }).sort((a,b) => _parseDateLocal(a.supplyDate) - _parseDateLocal(b.supplyDate))
    .map(r => ({name:r.vessel||r.name, dateStr:r.dateStr||(r.supplyDate?_parseDateLocal(r.supplyDate).toLocaleDateString():'—'), vQ:_recActQty(r,'v'), mQ:_recActQty(r,'m'), bdnV:r.bdnV||'', bdnM:r.bdnM||'', bargeLabel:r.barge||r.bargeLabel, fromSaved:true, fromArchive:!!r._fromArchive, spec:r.spec, agent:r.agent, notes:r.notes, area:r.area, areaCode:r.areaCode}));
}
async function downloadMonthlyReport(btnEl) {
  let rows, rangeLabel;
  if (_reportMode==='range') {
    const fromVal=document.getElementById('report-from')?.value,toVal=document.getElementById('report-to')?.value;
    const fromD=fromVal?parseDT(fromVal):null,toD=toVal?parseDT(toVal):null;
    if(!fromD||!toD){alert('Select a From and To date.');return;}
    const toEnd=new Date(toD.getFullYear(),toD.getMonth(),toD.getDate(),23,59,59);
    rows=getRowsByRange(fromD,toEnd,_reportPort);rangeLabel=`${fmtShort(fromD)}-${fmtShort(toD)}_${toD.getFullYear()}`;
  } else {
    const mon=parseInt(document.getElementById('report-month').value),yr=parseInt(document.getElementById('report-year').value);
    rows=getMonthlyRows(mon,yr,_reportPort);rangeLabel=`${MO[mon]}_${yr}`;
  }
  if (_reportPort !== 'ALL') rangeLabel += `_${_reportPort}`;
  if (!rows.length){alert('No supplies in selected period.');return;}

  const origLabel = btnEl ? btnEl.innerHTML : '';
  if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = 'Preparing…'; }
  await new Promise(r => setTimeout(r, 0));

  try {
    const ExcelJS = await _loadExcelJS();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Supply Report');
    ws.columns = [{width:6},{width:22},{width:22},{width:15},{width:18},{width:15},{width:18},{width:16}];

    // Title + subtitle rows
    ws.mergeCells('A1:H1');
    const titleCell = ws.getCell('A1');
    titleCell.value = `FLOW Supply Report — ${rangeLabel.replace(/_/g,' ')}`;
    titleCell.font = { bold:true, size:13, color:{argb:'FF0D1B2A'} };
    ws.mergeCells('A2:H2');
    const subCell = ws.getCell('A2');
    subCell.value = `Generated ${fmt24(new Date())} · ${rows.length} record${rows.length>1?'s':''}`;
    subCell.font = { size:9, color:{argb:'FF8A9BAC'} };
    ws.getRow(1).height = 20; ws.getRow(2).height = 15;

    const thinBorder = { style:'thin', color:{argb:'FFD8E0E8'} };
    const border = { top:thinBorder, bottom:thinBorder, left:thinBorder, right:thinBorder };

    // Header row (row 4)
    const headers = ['S.No.','Vessel Name','Date of Supply','VLSFO Qty (MT)','BDN No. (VLSFO)','MGO Qty (MT)','BDN No. (LSMGO)','Barge'];
    const headerRow = ws.getRow(4);
    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i+1);
      cell.value = h;
      cell.font = { bold:true, color:{argb:'FFFFFFFF'} };
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb: i===3 ? 'FF2F6FED' : i===5 ? 'FFFF7A1A' : 'FF0D1B2A'} };
      cell.alignment = { horizontal:'center', vertical:'middle' };
      cell.border = border;
    });
    headerRow.height = 20;

    // Data rows
    rows.forEach((r, i) => {
      const row = ws.getRow(5+i);
      const alt = i % 2 === 1;
      const vals = [i+1, r.name, r.dateStr, r.vQ||0, r.bdnV||'', r.mQ||0, r.bdnM||'', r.bargeLabel||''];
      vals.forEach((v, c) => {
        const cell = row.getCell(c+1);
        cell.value = v;
        cell.border = border;
        cell.alignment = { vertical:'middle', horizontal: c===3||c===5 ? 'right' : 'left' };
        if (c === 3) { cell.font = { color:{argb:'FF1D4ED8'}, bold:true }; cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb: alt?'FFE6EFFD':'FFEFF5FF'} }; }
        else if (c === 5) { cell.font = { color:{argb:'FFC2570A'}, bold:true }; cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb: alt?'FFFDEEDD':'FFFFF6EC'} }; }
        else if (alt) { cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF8FAFC'} }; }
      });
    });

    // Total row
    const totRow = ws.getRow(5+rows.length);
    const totV = rows.reduce((a,r)=>a+(r.vQ||0),0), totM = rows.reduce((a,r)=>a+(r.mQ||0),0);
    const totVals = ['', 'TOTAL', '', totV, '', totM, '', ''];
    totVals.forEach((v, c) => {
      const cell = totRow.getCell(c+1);
      cell.value = v;
      cell.font = { bold:true, color:{argb:'FFFFFFFF'} };
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb: c===3 ? 'FF2F6FED' : c===5 ? 'FFFF7A1A' : 'FF0D1B2A'} };
      cell.alignment = { vertical:'middle', horizontal: c===3||c===5 ? 'right' : 'left' };
      cell.border = border;
    });

    ws.views = [{ state:'frozen', ySplit:4 }];

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await _flowSaveOrShareBlob(blob, `FLOW_Report_${rangeLabel}.xlsx`);
  } catch (err) {
    alert('Could not generate the Excel file: ' + err.message);
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = origLabel; }
  }
}

async function downloadMonthlyReportPDF(btnEl) {
  let rows, rangeLabel, badge;
  if (_reportMode==='range') {
    const fromVal=document.getElementById('report-from')?.value,toVal=document.getElementById('report-to')?.value;
    const fromD=fromVal?parseDT(fromVal):null,toD=toVal?parseDT(toVal):null;
    if(!fromD||!toD){alert('Select a From and To date.');return;}
    const toEnd=new Date(toD.getFullYear(),toD.getMonth(),toD.getDate(),23,59,59);
    rows=getRowsByRange(fromD,toEnd,_reportPort);
    rangeLabel=`${fmtShort(fromD)}-${fmtShort(toD)}_${toD.getFullYear()}`;
    badge=`${fmtShort(fromD)} ${fromD.getFullYear()} – ${fmtShort(toD)} ${toD.getFullYear()}`;
  } else {
    const mon=parseInt(document.getElementById('report-month').value),yr=parseInt(document.getElementById('report-year').value);
    rows=getMonthlyRows(mon,yr,_reportPort);
    rangeLabel=`${MO[mon]}_${yr}`;
    badge=`${MO[mon]} ${yr}`;
  }
  if (_reportPort !== 'ALL') { rangeLabel += `_${_reportPort}`; badge += ` · ${_reportPort}`; }
  if (!rows.length){alert('No supplies in selected period.');return;}
  const pdfRows = rows.map(r => ({ vessel:r.name, dateStr:r.dateStr, v:r.vQ||0, m:r.mQ||0, bdnV:r.bdnV||'', bdnM:r.bdnM||'', barge:r.bargeLabel, port:r.area||r.areaCode }));
  const totV = rows.reduce((a,r)=>a+(r.vQ||0),0), totM = rows.reduce((a,r)=>a+(r.mQ||0),0);
  const html = _flowReportPDFHTML({
    rows: pdfRows, totV, totM, badge,
    metaLines: [['Generated', fmt24(new Date())], ['Records', rows.length]],
    footerNote: 'Monthly supply report · System-generated for operational reference only.'
  });
  await _flowExportReportPDF(html, `FLOW_Report_${rangeLabel}.pdf`, btnEl);
}

/* ─── DOWNLOAD EXCEL ─── */
function downloadExcel() {
  if (!_lastSched.length) { alert('Run the schedule first.'); return; }
  const WB = XLSX.utils.book_new();
  const S = {
    hdr:{font:{bold:true,color:{rgb:'FFFFFF'},sz:11},fill:{fgColor:{rgb:'0D1B2A'}},alignment:{horizontal:'center',vertical:'center',wrapText:true}},
    ok:{font:{color:{rgb:'1E6E3E'},bold:true},fill:{fgColor:{rgb:'E5F5EC'}},alignment:{horizontal:'center'}},
    dl:{font:{color:{rgb:'C97B00'},bold:true},fill:{fgColor:{rgb:'FFF5E0'}},alignment:{horizontal:'center'}},
    alrt:{font:{color:{rgb:'BE2B2B'},bold:true},fill:{fgColor:{rgb:'FDEAEA'}},alignment:{horizontal:'center'}},
    num:{alignment:{horizontal:'center'}},ctr:{alignment:{horizontal:'center'}},
    def:{alignment:{horizontal:'left',vertical:'center'}},boldL:{font:{bold:true},alignment:{horizontal:'left'}},
    title:{font:{bold:true,sz:14}},sum:{font:{bold:true,sz:12},fill:{fgColor:{rgb:'F2F5F9'}},alignment:{horizontal:'center'}},
  };
  const ws1={}; let r=0;
  ws1[XLSX.utils.encode_cell({r,c:0})]={v:'FLOW — Voyage Schedule',t:'s',s:S.title};
  ws1[XLSX.utils.encode_cell({r,c:2})]={v:'Generated: '+fmt24(new Date()),t:'s',s:{font:{sz:10,color:{rgb:'8A9BAC'}},alignment:{horizontal:'right'}}};
  r+=2;
  const totV=_lastSched.reduce((a,i)=>a+i.vQ,0),totM=_lastSched.reduce((a,i)=>a+i.mQ,0);
  const openV=Object.values(_bargeStates).reduce((s,bs)=>s+bs._openingV,0);
  const openM=Object.values(_bargeStates).reduce((s,bs)=>s+bs._openingM,0);
  const closV=openV-Math.round(totV),closM=openM-Math.round(totM);
  ['Total VLSFO Supplied','Total MGO Supplied','Closing VLSFO ROB','Closing MGO ROB'].forEach((lbl,i)=>{
    ws1[XLSX.utils.encode_cell({r,c:i*2})]={v:lbl,t:'s',s:{font:{sz:10,color:{rgb:'4A6278'}},fill:{fgColor:{rgb:'F2F5F9'}},alignment:{horizontal:'center'}}};
    ws1[XLSX.utils.encode_cell({r,c:i*2+1})]={v:[totV,totM,closV,closM][i].toLocaleString()+' MT',t:'s',s:S.sum};
  }); r+=2;
  const hdrs=['S.No.','Vessel Name','Anchorage','FO (MT)','MGO (MT)','Spec','Nominated Laycan','Actual ETA','Supply Start','ETC','Supply Plan','Laycan Status','Agent','Sampling / Manifold'];
  hdrs.forEach((h,c)=>{ws1[XLSX.utils.encode_cell({r,c})]={v:h,t:'s',s:S.hdr};}); r++;
  _lastSched.forEach((item,idx)=>{
    // "After <vessel>" only makes sense within the same barge's sequence —
    // classifying across the merged list named another barge's vessel.
    const sameBarge = _lastSched.filter(x => (x.bargeLabel||'') === (item.bargeLabel||''));
    const seq  = classifySeq(item, sameBarge.indexOf(item), sameBarge);
    const plan = seq.label;
    const areaLabel=AREA_OPTIONS.find(o=>o.value===item.area)?.label||item.area||'—';
    const nomV=(item.nomVQ!==undefined&&item.nomVQ!==null)?item.nomVQ:item.vQ, nomM=(item.nomMQ!==undefined&&item.nomMQ!==null)?item.nomMQ:item.mQ;
    [{v:item.sno,t:'n',s:S.num},{v:item.name,t:'s',s:S.boldL},{v:areaLabel,t:'s',s:S.ctr},
     // a ranged nomination exports as text "500–600" (the planning figure is its top)
     {v:_nomRange(item,'V')?_nomQtyTxt(item,'V',nomV):(nomV||'—'),t:nomV&&!_nomRange(item,'V')?'n':'s',s:S.num},{v:_nomRange(item,'M')?_nomQtyTxt(item,'M',nomM):(nomM||'—'),t:nomM&&!_nomRange(item,'M')?'n':'s',s:S.num},
     {v:item.spec||'—',t:'s',s:S.def},{v:fmtLC(item.lc),t:'s',s:S.ctr},{v:_itemEtaTxt(item),t:'s',s:S.ctr},
     {v:fmt24(item.bargeStart),t:'s',s:S.ctr},{v:fmt24(item.etc),t:'s',s:S.ctr},
     {v:plan,t:'s',s:{font:{sz:10,color:{rgb:'1A6FD4'}},fill:{fgColor:{rgb:'EBF3FD'}},alignment:{horizontal:'center'}}},
     {v:item.isDelayed?'Delayed':'On Laycan',t:'s',s:item.isDelayed?S.dl:S.ok},
     {v:item.agent||'—',t:'s',s:S.def},{v:item.mani||'—',t:'s',s:S.def},
    ].forEach((cell,c)=>{ws1[XLSX.utils.encode_cell({r,c})]= cell;}); r++;
  });
  ws1['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r,c:hdrs.length-1}});
  ws1['!cols']=[{wch:6},{wch:20},{wch:14},{wch:10},{wch:10},{wch:16},{wch:18},{wch:22},{wch:22},{wch:22},{wch:22},{wch:14},{wch:12},{wch:22}];
  XLSX.utils.book_append_sheet(WB,ws1,'Voyage Schedule');
  _flowSaveOrShareBlob(new Blob([XLSX.write(WB,{bookType:'xlsx',type:'array'})],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}), `FLOW_Schedule_${fmt24(new Date()).replace(/\s+/g,'-').replace(/:/g,'')}.xlsx`);
}


// Times below come from toLocale*String() with no timeZone, i.e. the
// browser's LOCAL time — they were wrongly labelled "UTC". Name the real zone.
function _localTzLabel(d) {
  try {
    const p = new Intl.DateTimeFormat('en-GB', { timeZoneName: 'short' }).formatToParts(d || new Date()).find(x => x.type === 'timeZoneName');
    if (p && p.value) return p.value;
  } catch (e) {}
  return 'local time';
}
/* ── Download Schedule as PDF (print-to-PDF the voyage table) ── */
async function downloadBargePDF(bargeId, btnEl) {
  if (!_lastSched || !_lastSched.length) { alert('Generate the schedule first.'); return; }
  const b = _bargeConfig.find(x => x.id == bargeId);
  if (!b) return;
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) + ' ' + now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) + ' ' + _localTzLabel(now);

  // Get the table for this specific barge only
  const tabEl = document.getElementById('voy-tab-' + bargeId);
  const tbl = tabEl ? tabEl.querySelector('.voy-tbl') : null;

  // Fallback: single barge - get first table in voy-barge-tabs
  const singleTbl = !tbl ? document.querySelector('#voy-barge-tabs .voy-tbl') : null;
  const targetTbl = tbl || singleTbl;

  if (!targetTbl) { alert('No schedule table found for ' + b.name + '. Generate schedule first.'); return; }

  // Only ticked rows go into the PDF — same selection the Print/Download as
  // Image actions already respect. Work on a CLONE of the table (never the
  // live DOM) so unchecked rows and the checkbox column are genuinely
  // removed from the captured HTML, not just visually hidden — the live
  // table on screen is completely untouched by this function.
  const allChecks = Array.from(targetTbl.querySelectorAll('.voy-print-chk'));
  const checkedCount = allChecks.filter(c => c.checked).length;
  if (allChecks.length && checkedCount === 0) {
    alert('No vessels selected.\nUse the Print checkboxes in the Voyage Schedule table to choose which vessels to include in the PDF.');
    return;
  }

  const tblClone = targetTbl.cloneNode(true);
  tblClone.querySelectorAll('.bg-dot').forEach(function(d) { d.remove(); }); // the barge colour is for the screen; exports stay as they were
  if (allChecks.length) {
    // Remove unchecked rows entirely from the clone
    Array.from(tblClone.querySelectorAll('.voy-print-chk')).forEach(chk => {
      if (!chk.checked) {
        const row = chk.closest('tr');
        if (row) row.remove();
      }
    });
    // Remove the checkbox column entirely (header + every remaining row)
    tblClone.querySelectorAll('tr').forEach(row => {
      const firstCell = row.querySelector('th, td');
      if (firstCell && (firstCell.querySelector('.voy-print-chk') || firstCell.querySelector('#voy-select-all'))) {
        firstCell.remove();
      }
    });
  }

  const tableHtml = tblClone.outerHTML;
  if (!tableHtml) { alert('No schedule table found for ' + b.name + '. Generate schedule first.'); return; }

  const origLabel = btnEl ? btnEl.innerHTML : '';
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="animation:spin .8s linear infinite"><path d="M21 12a9 9 0 1 1-2.64-6.36"/></svg> Preparing PDF…';
  }
  // Yield so the spinner above actually paints before the heavy rendering
  // below runs (same fix as the PNG export buttons).
  await new Promise(r => setTimeout(r, 0));

  // Build the exact same styled document as before, but off-screen in THIS
  // page (not a popup window — popups get blocked, and more importantly a
  // separate window can't be captured/downloaded directly). html2canvas
  // rasterizes it, jsPDF embeds that as a real PDF page, and the file goes
  // straight to disk — no print dialog, no "now click Save as PDF" step.
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed; left:-99999px; top:0; width:1600px; background:#fff;';
  container.innerHTML = `
    <div style="font-family:'Segoe UI',Arial,sans-serif; font-size:9pt; color:#0F1E30; background:#fff; padding:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0 8px;border-bottom:2px solid #0F1E30;margin-bottom:12px;">
        <div>
          <div style="font-size:16pt;font-weight:700;color:#0F1E30">Bunker Schedule — Voyage Plan</div>
          <div style="display:inline-block;padding:3px 12px;background:#0F1E30;color:#fff;border-radius:20px;font-size:9pt;font-weight:700;margin-top:4px">${esc(b.name)}</div>
        </div>
        <div style="text-align:right;font-size:8.5pt;color:#7891A8">
          <div><strong>Generated:</strong> ${dateStr}</div>
          <div><strong>Vessels:</strong> ${(_lastSched||[]).filter(x=>(x.bargeLabel||'')===(b.name)).length}</div>
        </div>
      </div>
      <style>
        table { width:100%; border-collapse:collapse; font-size:7.5pt; }
        thead { background:#0F1E30; }
        th { color:rgba(255,255,255,.72); padding:5px 6px; text-align:left; font-size:7pt; font-weight:700; letter-spacing:.06em; white-space:nowrap; text-transform:uppercase; }
        td { padding:5px 6px; border-bottom:0.5pt solid #E2E8F0; vertical-align:middle; }
        tr:nth-child(even) td { background:#F8FAFC; }
        .stag { font-size:6.5pt; font-weight:700; padding:1px 5px; border-radius:10px; display:inline-block; border:1px solid; }
        .st-ok { background:#DCFCE7; color:#15803D; border-color:#86EFAC; }
        .st-dl { background:#FEF3C7; color:#B45309; border-color:#F59E0B; }
        .lc-rng { font-family:monospace; font-size:7pt; font-weight:600; }
        .lc-rng.in { color:#15803D; } .lc-rng.out { color:#B45309; }
      </style>
      ${tableHtml}
      <div style="margin-top:14px;padding-top:8px;border-top:1px solid #E2E8F0;font-size:7.5pt;color:#7891A8;text-align:center">FLOW — Bunker Planning System · ${esc(b.name)} Schedule · System-generated for operational reference only.</div>
    </div>
  `;
  document.body.appendChild(container);

  try {
    const html2canvasFn = await _loadHtml2Canvas();
    const jsPDF = await _loadJsPDF();

    const canvas = await html2canvasFn(container, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
      width: container.scrollWidth,
      height: container.scrollHeight
    });

    // A3 landscape, matching the original print layout's page size.
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgRatio = canvas.height / canvas.width;
    let renderW = pageW - 16; // ~8mm margin each side, matching the original @page margin
    let renderH = renderW * imgRatio;
    if (renderH > pageH - 16) { renderH = pageH - 16; renderW = renderH / imgRatio; }
    const imgData = canvas.toDataURL('image/png');
    pdf.addImage(imgData, 'PNG', (pageW - renderW) / 2, 8, renderW, renderH);

    const blob = pdf.output('blob');
    const filename = `FLOW_${b.name.replace(/\s+/g,'_')}_Schedule_${fmt24(now).replace(/\s+/g,'-').replace(/:/g,'')}.pdf`;
    await _flowSaveOrShareBlob(blob, filename);
  } catch (err) {
    alert('Could not generate the PDF: ' + err.message);
  } finally {
    document.body.removeChild(container);
    if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = origLabel; }
  }
}

function downloadSchedulePDF() {
  // Redirect to first barge PDF for backwards compatibility
  if (_bargeConfig && _bargeConfig.length) downloadBargePDF(_bargeConfig[0].id);
}


function downloadExcelForBarge(bargeId) {
  if (!_lastSched.length){alert('Run schedule first.');return;}
  const b=_bargeConfig.find(x=>x.id===bargeId);if(!b)return;
  const rows=_lastSched.filter(item=>item.bargeLabel===b.name);
  if(!rows.length){alert(`No vessels assigned to ${b.name}.`);return;}
  const WB=XLSX.utils.book_new(),ws={};
  const S={hdr:{font:{bold:true,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'0D1B2A'}},alignment:{horizontal:'center',wrapText:true}}};
  ws[XLSX.utils.encode_cell({r:0,c:0})]={v:`Voyage Schedule — ${b.name}`,t:'s',s:{font:{bold:true,sz:13}}};
  ['S.No.','Vessel','Anchorage','FO (MT)','MGO (MT)','Spec','Nominated Laycan','Actual ETA','Supply Start','ETC','Supply Plan','Laycan Status','PAQ','Agent','Sampling/Manifold'].forEach((h,c)=>ws[XLSX.utils.encode_cell({r:2,c})]={v:h,t:'s',s:S.hdr});
  rows.forEach((item,i)=>{
    const areaLabel=AREA_OPTIONS.find(o=>o.value===item.area)?.label||item.area||'';
    const seqXl = classifySeq(item, i, rows);
    const nomV=(item.nomVQ!==undefined&&item.nomVQ!==null)?item.nomVQ:item.vQ, nomM=(item.nomMQ!==undefined&&item.nomMQ!==null)?item.nomMQ:item.mQ;
    [item.sno,item.name,areaLabel,_nomRange(item,'V')?_nomQtyTxt(item,'V',nomV):(nomV||0),_nomRange(item,'M')?_nomQtyTxt(item,'M',nomM):(nomM||0),item.spec||'',fmtLC(item.lc),_itemEtaTxt(item),fmt24(item.bargeStart),fmt24(item.etc),seqXl.label,item.isDelayed?'Delayed':'On Laycan',item.paq==='yes'?'Received':'Pending',item.agent||'',item.mani||''].forEach((v,c)=>ws[XLSX.utils.encode_cell({r:3+i,c})]={v,t:typeof v==='number'?'n':'s'});
  });
  ws['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:3+rows.length-1,c:14}});
  ws['!cols']=[{wch:6},{wch:20},{wch:14},{wch:10},{wch:10},{wch:14},{wch:18},{wch:22},{wch:22},{wch:22},{wch:20},{wch:14},{wch:10},{wch:12},{wch:22}];
  XLSX.utils.book_append_sheet(WB,ws,b.name.substring(0,30));
  _flowSaveOrShareBlob(new Blob([XLSX.write(WB,{bookType:'xlsx',type:'array'})],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}), `FLOW_${b.name.replace(/\s+/g,'_')}_${fmt24(new Date()).replace(/\s+/g,'-').replace(/:/g,'')}.xlsx`);
}

