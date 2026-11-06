/* ══════════════════════════════════════════════════════
   MONTHLY LOADING REPORT — what was loaded in a month, from whom, on which
   dates (Loading page → Monthly loading report → ⬇ Excel / ⬇ PDF).
   • counts completed loadings whose BL date falls in the month, at the BL
     quantity (planned quantity until a BL figure is entered — marked *)
   • supplier = the linked Loading Deal's supplier; a loading with no deal is
     grouped under its terminal, marked "(no deal)"
   • barge transfers are not supplier liftings and are left out
   • loadings of the month not yet completed are listed separately at the end
   ══════════════════════════════════════════════════════ */
function _ldRepMonthNow() { return _localDateInputStr(new Date()).slice(0, 7); }
function _ldRepMonthLabel(ym) {
  const d = new Date(ym + '-01T00:00:00');
  return isNaN(d.getTime()) ? ym : d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}
function _ldRepSupplier(r) {
  const d = r.dealId ? _dealById(r.dealId, true) : null;
  if (d && String(d.supplier || '').trim()) return { name: String(d.supplier).trim(), ref: d.ref || '', deal: true };
  return { name: (String(r.terminal || '').trim() || 'Unknown terminal') + ' (no deal)', ref: '', deal: false };
}
// The month's report data. ym = 'YYYY-MM'.
function _ldMonthReportData(ym) {
  const recs = (_loadingRecords || []).filter(function(r) { return r && !r.deletedAt && !_isTransfer(r); });
  const lifted = recs.filter(function(r) { return r.completed; }).map(function(r) {
    const bd = _loadingBlDate(r), sp = _ldRepSupplier(r);
    const blEntered = r.blQty != null && r.blQty !== '' && !isNaN(Number(r.blQty));
    return { rec: r, ymd: bd.ymd, dateEntered: bd.entered, supplier: sp.name, ref: sp.ref, terminal: r.terminal || '', barge: _resolveRecordBargeName(r) || '',
      grade: r.grade === 'LSMGO' ? 'LSMGO' : 'VLSFO', planned: Number(r.qty) || 0, qty: _loadingLifted(r), blEntered: blEntered };
  }).filter(function(x) { return String(x.ymd).slice(0, 7) === ym; })
    .sort(function(a, b) { return String(a.ymd).localeCompare(String(b.ymd)) || ((a.rec.completedAt || 0) - (b.rec.completedAt || 0)); });
  const add = function(map, key, x) {
    const g = map[key] || (map[key] = { key: key, liftings: 0, v: 0, m: 0 });
    g.liftings++; if (x.grade === 'LSMGO') g.m += x.qty; else g.v += x.qty;
  };
  const sup = {}, day = {};
  lifted.forEach(function(x) { add(sup, x.supplier, x); add(day, x.ymd, x); });
  const total = function(g) { return g.v + g.m; };
  const bySupplier = Object.values(sup).sort(function(a, b) { return total(b) - total(a) || a.key.localeCompare(b.key); });
  const byDate = Object.values(day).sort(function(a, b) { return a.key.localeCompare(b.key); });
  const tot = { liftings: lifted.length, v: 0, m: 0 };
  lifted.forEach(function(x) { if (x.grade === 'LSMGO') tot.m += x.qty; else tot.v += x.qty; });
  const scheduled = recs.filter(function(r) { return !r.completed && _localDateInputStr(new Date(r.startAt)).slice(0, 7) === ym; })
    .sort(function(a, b) { return new Date(a.startAt) - new Date(b.startAt); })
    .map(function(r) { return { when: _ldStartTxt(r), supplier: _ldRepSupplier(r).name, terminal: r.terminal || '', barge: _resolveRecordBargeName(r) || '', grade: r.grade === 'LSMGO' ? 'LSMGO' : 'VLSFO', planned: Number(r.qty) || 0 }; });
  return { ym: ym, label: _ldRepMonthLabel(ym), lifted: lifted, bySupplier: bySupplier, byDate: byDate, tot: tot, scheduled: scheduled,
    anyStar: lifted.some(function(x) { return !x.dateEntered || !x.blEntered; }), file: 'FLOW_Loading_Report_' + ym, generated: fmt24(new Date()) };
}
function _ldRepMonth() {
  const el = document.getElementById('ld-rep-month');
  const v = el ? String(el.value || '').trim() : '';
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null;
}
// The one-line summary under the month picker.
function _ldRepRefresh() {
  const el = document.getElementById('ld-rep-month'), out = document.getElementById('ld-rep-summary');
  if (!el || !out) return;
  if (!el.value) el.value = _ldRepMonthNow();
  const ym = _ldRepMonth();
  if (!ym) { out.textContent = 'Pick a month.'; return; }
  const R = _ldMonthReportData(ym);
  out.textContent = R.tot.liftings
    ? R.label + ': ' + R.tot.liftings + ' lifting' + (R.tot.liftings === 1 ? '' : 's') + ' · VLSFO ' + _mtStr(R.tot.v) + ' MT · LSMGO ' + _mtStr(R.tot.m) + ' MT · ' + R.bySupplier.length + ' supplier' + (R.bySupplier.length === 1 ? '' : 's') + (R.scheduled.length ? ' · ' + R.scheduled.length + ' still scheduled' : '')
    : R.label + ': no completed loading yet' + (R.scheduled.length ? ' · ' + R.scheduled.length + ' scheduled' : '') + '.';
}
function _ldRepData() {
  const ym = _ldRepMonth();
  if (!ym) { alert('Pick a month for the loading report.'); return null; }
  return _ldMonthReportData(ym);
}
async function _ldRepBusy(btn, fn) {
  const label = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = 'Preparing…'; }
  await new Promise(function(r) { setTimeout(r, 0); });
  try { await fn(); }
  catch (err) { alert('Could not create the loading report: ' + ((err && err.message) || err)); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = label; } }
}
const _LDREP_STAR = '* No BL date / BL quantity entered for that loading — the day it was marked Completed / the planned quantity is used.';

async function loadingMonthReportExcel(btn) {
  const R = _ldRepData();
  if (!R) return;
  await _ldRepBusy(btn, async function() {
    const ExcelJS = await _loadExcelJS();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Loading report');
    ws.columns = [{ width: 6 }, { width: 15 }, { width: 28 }, { width: 14 }, { width: 24 }, { width: 14 }, { width: 10 }, { width: 14 }, { width: 14 }];
    const thin = { style: 'thin', color: { argb: 'FFD8E0E8' } }, border = { top: thin, bottom: thin, left: thin, right: thin };
    const NUM = '#,##0.###', r3 = function(n) { return Math.round((Number(n) || 0) * 1000) / 1000; };
    let r = 1;
    const title = function(text, font) { ws.mergeCells('A' + r + ':I' + r); const c = ws.getCell('A' + r); c.value = text; c.font = font; r++; };
    const header = function(cells) {
      const row = ws.getRow(r);
      cells.forEach(function(h, i) { const c = row.getCell(i + 1); c.value = h; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1B2A' } }; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = border; });
      row.height = 24; r++;
    };
    const line = function(vals, numFrom, bold) {
      const row = ws.getRow(r++);
      vals.forEach(function(v, i) { const c = row.getCell(i + 1); c.value = v; c.border = border; if (i >= numFrom && typeof v === 'number') { c.numFmt = NUM; c.alignment = { horizontal: 'right' }; } if (bold) c.font = { bold: true }; });
      return row;
    };
    title('Monthly loading report — ' + R.label, { bold: true, size: 14, color: { argb: 'FF0D1B2A' } });
    title('Completed loadings by BL date, at the BL quantity · generated ' + R.generated, { size: 9, color: { argb: 'FF8A9BAC' } });
    r++;
    title('Total', { bold: true, size: 11, color: { argb: 'FF0D1B2A' } });
    header(['', 'Liftings', 'VLSFO (MT)', 'LSMGO (MT)', 'Total (MT)']);
    line(['', R.tot.liftings, r3(R.tot.v), r3(R.tot.m), r3(R.tot.v + R.tot.m)], 1, true);
    r++;
    title('By supplier', { bold: true, size: 11, color: { argb: 'FF0D1B2A' } });
    header(['#', 'Supplier', 'Liftings', 'VLSFO (MT)', 'LSMGO (MT)', 'Total (MT)']);
    if (!R.bySupplier.length) title('No completed loading in ' + R.label + '.', { italic: true, color: { argb: 'FF8A9BAC' } });
    R.bySupplier.forEach(function(g, i) { line([i + 1, g.key, g.liftings, r3(g.v), r3(g.m), r3(g.v + g.m)], 2); });
    if (R.bySupplier.length) line(['', 'Total', R.tot.liftings, r3(R.tot.v), r3(R.tot.m), r3(R.tot.v + R.tot.m)], 2, true);
    r++;
    title('By date (BL date)', { bold: true, size: 11, color: { argb: 'FF0D1B2A' } });
    header(['#', 'Date', 'Liftings', 'VLSFO (MT)', 'LSMGO (MT)', 'Total (MT)']);
    if (!R.byDate.length) title('None.', { italic: true, color: { argb: 'FF8A9BAC' } });
    R.byDate.forEach(function(g, i) { line([i + 1, _dealDateStr(g.key), g.liftings, r3(g.v), r3(g.m), r3(g.v + g.m)], 2); });
    if (R.byDate.length) line(['', 'Total', R.tot.liftings, r3(R.tot.v), r3(R.tot.m), r3(R.tot.v + R.tot.m)], 2, true);
    r++;
    title('Liftings', { bold: true, size: 11, color: { argb: 'FF0D1B2A' } });
    header(['#', 'BL date', 'Supplier', 'Deal ref', 'Terminal', 'Barge', 'Grade', 'Planned (MT)', 'BL qty (MT)']);
    if (!R.lifted.length) title('None.', { italic: true, color: { argb: 'FF8A9BAC' } });
    R.lifted.forEach(function(x, i) {
      const row = line([i + 1, _dealDateStr(x.ymd) + (x.dateEntered ? '' : ' *'), x.supplier, x.ref || '—', x.terminal, x.barge, x.grade, r3(x.planned), r3(x.qty)], 7);
      row.getCell(9).font = { bold: true };
      if (!x.blEntered) row.getCell(9).note = 'No BL quantity entered — the planned quantity is used';
    });
    if (R.lifted.length) line(['', '', 'Total', '', '', '', '', '', r3(R.tot.v + R.tot.m)], 7, true);
    r++;
    title('Scheduled in ' + R.label + ' (not yet completed — not counted above)', { bold: true, size: 11, color: { argb: 'FF0D1B2A' } });
    header(['#', 'Planned start', 'Supplier', '', 'Terminal', 'Barge', 'Grade', 'Planned (MT)', '']);
    if (!R.scheduled.length) title('None.', { italic: true, color: { argb: 'FF8A9BAC' } });
    R.scheduled.forEach(function(x, i) { line([i + 1, x.when, x.supplier, '', x.terminal, x.barge, x.grade, r3(x.planned), ''], 7); });
    if (R.anyStar) { r++; title(_LDREP_STAR, { size: 9, color: { argb: 'FFB8790F' } }); }
    const buf = await wb.xlsx.writeBuffer();
    await _flowSaveOrShareBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), R.file + '.xlsx');
  });
}

async function loadingMonthReportPdf(btn) {
  const R = _ldRepData();
  if (!R) return;
  await _ldRepBusy(btn, async function() {
    const jsPDF = await _loadJsPDF();
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 14, tw = W - 2 * M;
    let y = M;
    const fmt = function(n) { return _mtStr(n); };
    const ink = function(c) { pdf.setTextColor(c[0], c[1], c[2]); };
    const room = function(h) { if (y + h > H - M) { pdf.addPage(); y = M; return true; } return false; };
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); ink([13, 27, 42]);
    pdf.text('Monthly loading report — ' + R.label, M, y + 5); y += 9;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); ink([138, 155, 172]);
    pdf.text('Completed loadings by BL date, at the BL quantity · generated ' + R.generated, M, y + 3); y += 8;
    // headline figures
    const boxes = [['Liftings', String(R.tot.liftings)], ['VLSFO MT', fmt(R.tot.v)], ['LSMGO MT', fmt(R.tot.m)], ['Total MT', fmt(R.tot.v + R.tot.m)]];
    const bw = tw / boxes.length;
    boxes.forEach(function(b, i) {
      const x = M + i * bw;
      pdf.setFillColor(242, 245, 249); pdf.rect(x + 1, y, bw - 2, 14, 'F');
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); ink([74, 98, 120]); pdf.text(b[0], x + 4, y + 5);
      pdf.setFontSize(12); ink([13, 27, 42]); pdf.text(b[1], x + 4, y + 11.5);
    });
    y += 20;
    const table = function(caption, cols, rows, emptyText, totals) {
      room(22);
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); ink([13, 27, 42]); pdf.text(caption, M, y + 4); y += 7;
      const drawHead = function() {
        pdf.setFillColor(13, 27, 42); pdf.rect(M, y, tw, 7, 'F');
        pdf.setFontSize(8.5); pdf.setFont('helvetica', 'bold'); ink([255, 255, 255]);
        let x = M; cols.forEach(function(c) { pdf.text(c.t, c.r ? x + c.w - 1.5 : x + 1.5, y + 4.8, { align: c.r ? 'right' : 'left' }); x += c.w; });
        y += 7;
      };
      drawHead();
      if (!rows.length) { pdf.setFont('helvetica', 'italic'); pdf.setFontSize(9); ink([138, 155, 172]); pdf.text(emptyText, M + 1.5, y + 5); y += 10; return; }
      rows.forEach(function(row, ri) {
        if (room(7)) drawHead();
        if (ri % 2) { pdf.setFillColor(242, 245, 249); pdf.rect(M, y, tw, 6.5, 'F'); }
        pdf.setFontSize(8.8); ink([13, 27, 42]);
        let x = M;
        cols.forEach(function(c, ci) { pdf.setFont('helvetica', c.b ? 'bold' : 'normal'); pdf.text(String(row[ci]), c.r ? x + c.w - 1.5 : x + 1.5, y + 4.5, { align: c.r ? 'right' : 'left', maxWidth: c.w - 3 }); x += c.w; });
        y += 6.5;
      });
      if (totals) {
        room(8); pdf.setDrawColor(13, 27, 42); pdf.line(M, y, W - M, y);
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); ink([13, 27, 42]);
        let x = M; cols.forEach(function(c, ci) { if (totals[ci] !== '') pdf.text(String(totals[ci]), c.r ? x + c.w - 1.5 : x + 1.5, y + 4.8, { align: c.r ? 'right' : 'left' }); x += c.w; });
        y += 8;
      }
      y += 5;
    };
    const sumCols = function(first) { return [{ t: '#', w: tw * 0.06 }, { t: first, w: tw * 0.38 }, { t: 'Liftings', w: tw * 0.11, r: 1 }, { t: 'VLSFO MT', w: tw * 0.15, r: 1 }, { t: 'LSMGO MT', w: tw * 0.15, r: 1 }, { t: 'Total MT', w: tw * 0.15, r: 1, b: 1 }]; };
    const totRow = ['', 'Total', String(R.tot.liftings), fmt(R.tot.v), fmt(R.tot.m), fmt(R.tot.v + R.tot.m)];
    table('By supplier', sumCols('Supplier'), R.bySupplier.map(function(g, i) { return [i + 1, g.key, g.liftings, fmt(g.v), fmt(g.m), fmt(g.v + g.m)]; }), 'No completed loading in ' + R.label + '.', R.bySupplier.length ? totRow : null);
    table('By date (BL date)', sumCols('Date'), R.byDate.map(function(g, i) { return [i + 1, _dealDateStr(g.key), g.liftings, fmt(g.v), fmt(g.m), fmt(g.v + g.m)]; }), 'None.', R.byDate.length ? totRow : null);
    table('Liftings',
      [{ t: '#', w: tw * 0.05 }, { t: 'BL date', w: tw * 0.14 }, { t: 'Supplier', w: tw * 0.22 }, { t: 'Terminal', w: tw * 0.17 }, { t: 'Barge', w: tw * 0.11 }, { t: 'Grade', w: tw * 0.09 }, { t: 'Planned MT', w: tw * 0.11, r: 1 }, { t: 'BL qty MT', w: tw * 0.11, r: 1, b: 1 }],
      R.lifted.map(function(x, i) { return [i + 1, _dealDateStr(x.ymd) + (x.dateEntered ? '' : ' *'), x.supplier + (x.ref ? ' · ' + x.ref : ''), x.terminal, x.barge, x.grade, fmt(x.planned), fmt(x.qty) + (x.blEntered ? '' : ' *')]; }),
      'None.', R.lifted.length ? ['', '', 'Total', '', '', '', '', fmt(R.tot.v + R.tot.m)] : null);
    table('Scheduled in ' + R.label + ' (not yet completed — not counted above)',
      [{ t: '#', w: tw * 0.05 }, { t: 'Planned start', w: tw * 0.2 }, { t: 'Supplier', w: tw * 0.25 }, { t: 'Terminal', w: tw * 0.18 }, { t: 'Barge', w: tw * 0.11 }, { t: 'Grade', w: tw * 0.09 }, { t: 'Planned MT', w: tw * 0.12, r: 1 }],
      R.scheduled.map(function(x, i) { return [i + 1, x.when, x.supplier, x.terminal, x.barge, x.grade, fmt(x.planned)]; }), 'None.');
    if (R.anyStar) { room(8); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); ink([184, 121, 15]); pdf.text(_LDREP_STAR, M, y + 3, { maxWidth: tw }); }
    const pages = pdf.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) { pdf.setPage(i); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); ink([138, 155, 172]); pdf.text('FLOW · Monthly loading report · ' + R.label + ' · page ' + i + ' of ' + pages, W / 2, H - 6, { align: 'center' }); }
    await _flowSaveOrShareBlob(pdf.output('blob'), R.file + '.pdf');
  });
}
