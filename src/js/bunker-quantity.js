/* ═══════════════════════════════════════════════════════════════════════
   BUNKER QUANTITY — current FY (Dashboard line chart + Analytics bar chart)
   FLOW's fiscal year is the calendar year (the chart runs Jan–Dec), so the
   "current FY" is just new Date().getFullYear() — FY27 from 1 Jan 2027.
   Jan–Jul 2026 are historical totals supplied directly by the user (FLOW
   wasn't tracking deliveries before August 2026, so there's no live record
   to compute those from). From August onward, each month is computed live
   from getMonthlyRows() — the SAME data source the Monthly Report uses —
   so this chart always matches the Monthly Report automatically, with
   zero manual upkeep required going forward.
   ═══════════════════════════════════════════════════════════════════ */
const FY26_SEED_MONTHLY_QTY = {
  0: { fo: 25805.705, mgo: 2872.832 },  // January
  1: { fo: 32249.945, mgo: 1830.057 },  // February
  2: { fo: 9508.502,  mgo: 2129.352 },  // March
  3: { fo: 5516.713,  mgo: 26.149   },  // April
  4: { fo: 4048.429,  mgo: 805.770  },  // May
  5: { fo: 4362.039,  mgo: 428.486  },  // June
  6: { fo: 11467.282, mgo: 1575.699 }   // July
};
const FY26_LIVE_FROM_MONTH = 7; // August (0-indexed) — first month computed live, not seeded
// Seed data is keyed by the year it belongs to, so FY26's historical figures
// can never leak into FY27's chart — any year not listed here is all live.
const FY_SEED_BY_YEAR = { 2026: { months: FY26_SEED_MONTHLY_QTY, liveFrom: FY26_LIVE_FROM_MONTH } };
const FY_FIRST_YEAR = 2026; // first FY FLOW has data for — the year dropdown reaches back to here
function _currentFY() { return new Date().getFullYear(); }
function _fyLabel(year) { return 'FY' + String(year).slice(-2); }

// ── Archived Fiscal Years ─────────────────────────────────────────────
// Deliberately stored under a key that does NOT start with "abps_" or
// "flow_" — Full Reset, Clear All Data, and Wipe Cloud all sweep every
// localStorage key with those prefixes, and an archived year must survive
// all three of those (explicit requirement). This also means archived
// years are local to the device that archived them — not synced via the
// shared Supabase workspace row, since that row is exactly what Wipe
// Cloud deletes.
const FY_ARCHIVE_LS_KEY = 'flowops_fy_archive_v1';
var _fyArchives = {};
function _saveFYArchives() {
  try { localStorage.setItem(FY_ARCHIVE_LS_KEY, JSON.stringify(_fyArchives)); } catch(e) {}
}
function _loadFYArchives() {
  try {
    const raw = localStorage.getItem(FY_ARCHIVE_LS_KEY);
    if (raw) _fyArchives = JSON.parse(raw) || {};
  } catch(e) { /* leave _fyArchives as-is */ }
}
_loadFYArchives();

// Freezes the current live monthly series under a label (e.g. "FY26") so
// it stays exactly as it was at archive time, unaffected by later records.
function archiveFiscalYear(label) {
  label = (label || '').trim();
  if (!label) return;
  if (_fyArchives[label] && !confirm(`"${label}" is already archived. Overwrite it with today's data?`)) return;
  const series = getMonthlyQuantitySeries(_currentFY());
  _fyArchives[label] = { series, archivedAt: new Date().toISOString() };
  _saveFYArchives();
  showToast(`${label} archived — the chart keeps showing live data until you pick it from the dropdown`, 'success');
  _populateFYChartSelector();
  if (typeof renderArchivedFYList === 'function') renderArchivedFYList();
}

function confirmArchiveFiscalYear() {
  const label = prompt('Archive the current chart data under which fiscal year label?', _fyLabel(_currentFY()));
  if (label === null) return;
  archiveFiscalYear(label);
}

// Removes an archived year entirely. If the chart is currently showing
// that year, it falls back to Live automatically.
function unarchiveFiscalYear(label) {
  if (!_fyArchives[label]) return;
  if (!confirm(`Remove the "${label}" archive? This can't be undone — you'd need to Archive Year again to recreate it from current data.`)) return;
  delete _fyArchives[label];
  _saveFYArchives();
  showToast(`${label} archive removed`, 'info');
  _populateFYChartSelector();
  _onFYChartSelectorChange();
  if (typeof renderArchivedFYList === 'function') renderArchivedFYList();
}

// Full-record view on the Archives page — every archived fiscal year with
// its complete monthly FO/MGO breakdown, not just a chart-side summary.
function renderArchivedFYList() {
  const el = document.getElementById('fy-archive-list');
  if (!el) return;
  const years = Object.keys(_fyArchives).sort().reverse();
  if (!years.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px 0">No fiscal years archived yet. Use <strong>Archive Year</strong> on the Bunker Quantity chart in Reports &amp; Analytics.</div>';
    return;
  }
  el.innerHTML = years.map(function(label) {
    const arch = _fyArchives[label];
    const totalFO = arch.series.reduce((s, m) => s + m.fo, 0);
    const totalMGO = arch.series.reduce((s, m) => s + m.mgo, 0);
    const monthRows = arch.series.map(m => `<tr><td style="padding:4px 8px;font-size:11px;color:var(--sub)">${esc(MO[m.month])}</td><td style="padding:4px 8px;font-size:11px;text-align:right;color:var(--fuel-v);font-weight:600">${fmtMT(m.fo)}</td><td style="padding:4px 8px;font-size:11px;text-align:right;color:var(--fuel-m);font-weight:600">${fmtMT(m.mgo)}</td></tr>`).join('');
    return `<details style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:8px">
      <summary style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13px;font-weight:700;color:var(--ink)">
        <span style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span>${esc(label)}</span>
          <span style="font-size:11px;font-weight:600;color:var(--muted)">VLSFO ${fmtMT(totalFO)} MT · LSMGO ${fmtMT(totalMGO)} MT · Archived ${esc(new Date(arch.archivedAt).toLocaleDateString('en-GB'))}</span>
        </span>
        <button class="btn btn-ghost btn-sm" onclick="event.preventDefault();event.stopPropagation();unarchiveFiscalYear('${escJs(label)}')" title="Remove this archive">Undo Archive</button>
      </summary>
      <table style="width:100%;margin-top:8px;border-top:1px solid var(--border)">
        <thead><tr><th style="padding:4px 8px;font-size:10px;text-align:left;color:var(--muted)">Month</th><th style="padding:4px 8px;font-size:10px;text-align:right;color:var(--muted)">VLSFO (MT)</th><th style="padding:4px 8px;font-size:10px;text-align:right;color:var(--muted)">LSMGO (MT)</th></tr></thead>
        <tbody>${monthRows}</tbody>
      </table>
    </details>`;
  }).join('');
}

// Populates the chart's year dropdown with the current FY ("FY27 (Live)"),
// every earlier FY back to FY_FIRST_YEAR (computed from seed + records, so
// FY26 stays reachable in 2027 even if nobody archived it) and every
// archived year, without changing what's currently selected.
function _populateFYChartSelector() {
  const sel = document.getElementById('rep-monthly-qty-year-select');
  if (!sel) return;
  const prev = sel.value;
  const cur = _currentFY();
  let past = '';
  for (let y = cur - 1; y >= FY_FIRST_YEAR; y--) past += `<option value="__fy:${y}">${_fyLabel(y)}</option>`;
  const years = Object.keys(_fyArchives).sort().reverse();
  sel.innerHTML = `<option value="__live__">${_fyLabel(cur)} (Live)</option>` + past +
    years.map(y => `<option value="${esc(y)}">${esc(y)} (Archived)</option>`).join('');
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}

// Fires when the dropdown changes — live stays live (current data,
// re-rendered as usual), an archived year renders its frozen snapshot.
function _onFYChartSelectorChange() {
  const sel = document.getElementById('rep-monthly-qty-year-select');
  const undoBtn = document.getElementById('rep-monthly-qty-undo-btn');
  if (!sel) return;
  if (sel.value === '__live__') {
    if (undoBtn) undoBtn.style.display = 'none';
    renderMonthlyQuantityChart('chart-monthly-qty-analytics', 'bar', 'rep-monthly-qty-summary', 'rep-monthly-qty-subtitle');
  } else if (sel.value.indexOf('__fy:') === 0) {
    // An earlier FY, recomputed from its seed + records (not a frozen archive)
    if (undoBtn) undoBtn.style.display = 'none';
    renderMonthlyQuantityChart('chart-monthly-qty-analytics', 'bar', 'rep-monthly-qty-summary', 'rep-monthly-qty-subtitle', null, null, Number(sel.value.slice(5)));
  } else {
    const arch = _fyArchives[sel.value];
    if (arch) {
      if (undoBtn) undoBtn.style.display = '';
      renderMonthlyQuantityChart('chart-monthly-qty-analytics', 'bar', 'rep-monthly-qty-summary', 'rep-monthly-qty-subtitle', arch.series, sel.value);
    }
  }
}

// "Undo Archive" next to the dropdown — removes whichever archived year is
// currently being viewed on the chart, then falls back to Live.
function _undoCurrentlyViewedFYArchive() {
  const sel = document.getElementById('rep-monthly-qty-year-select');
  if (!sel || sel.value === '__live__' || sel.value.indexOf('__fy:') === 0) return;
  unarchiveFiscalYear(sel.value);
}

// Label of whatever the Analytics year dropdown is showing (PDF export title).
function _fySelectedLabel() {
  const sel = document.getElementById('rep-monthly-qty-year-select');
  const v = sel ? sel.value : '__live__';
  if (!v || v === '__live__') return _fyLabel(_currentFY());
  if (v.indexOf('__fy:') === 0) return _fyLabel(Number(v.slice(5)));
  return v;
}

function getMonthlyQuantitySeries(year) {
  year = year || _currentFY();
  const seed = FY_SEED_BY_YEAR[year];
  const out = [];
  for (let m = 0; m < 12; m++) {
    if (seed && m < seed.liveFrom && seed.months[m]) {
      out.push({ month: m, fo: seed.months[m].fo, mgo: seed.months[m].mgo, live: false });
    } else {
      const rows = (typeof getMonthlyRows === 'function') ? getMonthlyRows(m, year) : [];
      const fo = rows.reduce((s, r) => s + (r.vQ || 0), 0);
      const mgo = rows.reduce((s, r) => s + (r.mQ || 0), 0);
      out.push({ month: m, fo, mgo, live: true });
    }
  }
  return out;
}

// Renders either the Dashboard's line chart or the Analytics bar chart from
// the exact same series/summary — `type` is 'line' or 'bar'.
function renderMonthlyQuantityChart(canvasId, type, summaryElId, subtitleElId, overrideSeries, fyLabel, year) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;

  year = year || _currentFY();
  const seed = overrideSeries ? null : FY_SEED_BY_YEAR[year];
  const series = overrideSeries || getMonthlyQuantitySeries(year);
  const labels = series.map(s => MO[s.month]);
  const foData = series.map(s => s.fo);
  const mgoData = series.map(s => s.mgo);
  const totalFO = foData.reduce((a, b) => a + b, 0);
  const totalMGO = mgoData.reduce((a, b) => a + b, 0);
  const grandTotal = totalFO + totalMGO;
  const liveMonthsCount = series.filter(s => s.live && (s.fo || s.mgo)).length;

  const summaryEl = summaryElId && document.getElementById(summaryElId);
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div style="background:var(--fuel-v-bg,rgba(37,99,235,.08));border-radius:10px;padding:10px 12px;text-align:center">
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Total FO</div>
        <div style="font-size:16px;font-weight:700;color:var(--fuel-v)">${fmtMT(totalFO)}</div>
        <div style="font-size:10px;color:var(--muted)">Metric Tons</div>
      </div>
      <div style="background:var(--fuel-m-bg,rgba(249,115,22,.08));border-radius:10px;padding:10px 12px;text-align:center">
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Total MGO</div>
        <div style="font-size:16px;font-weight:700;color:var(--fuel-m)">${fmtMT(totalMGO)}</div>
        <div style="font-size:10px;color:var(--muted)">Metric Tons</div>
      </div>
      <div style="background:var(--surface2);border-radius:10px;padding:10px 12px;text-align:center">
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Grand Total</div>
        <div style="font-size:16px;font-weight:700;color:var(--ink)">${fmtMT(grandTotal)}</div>
        <div style="font-size:10px;color:var(--muted)">Metric Tons</div>
      </div>
      <div style="background:var(--surface2);border-radius:10px;padding:10px 12px;text-align:center">
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Live Months</div>
        <div style="font-size:16px;font-weight:700;color:var(--ink)">${liveMonthsCount}</div>
        <div style="font-size:10px;color:var(--muted)">${MO[seed ? seed.liveFrom : 0]} onward</div>
      </div>`;
  }
  const subtitleEl = subtitleElId && document.getElementById(subtitleElId);
  if (subtitleEl) {
    subtitleEl.textContent = overrideSeries
      ? `Archived snapshot — ${fyLabel} — frozen at archive time, not affected by later records · Total: ${fmtMT(grandTotal)} MT`
      : (seed
          ? `${_fyLabel(year)} · ${MO[0]}–${MO[seed.liveFrom - 1]} from historical records · ${MO[seed.liveFrom]} onward computed live from Monthly Report`
          : `${_fyLabel(year)} · computed live from Monthly Report`) +
        ` · Grand total${year === _currentFY() ? ' so far' : ''}: ${fmtMT(grandTotal)} MT`;
  }

  const isLine = type === 'line';
  if (_chartInstances[canvasId]) _chartInstances[canvasId].destroy();
  _chartInstances[canvasId] = new Chart(canvas, {
    type: type,
    data: {
      labels,
      datasets: [
        {
          label: 'FO / VLSFO (MT)', data: foData,
          borderColor: _skinPal('rgba(37,99,235,1)'),
          backgroundColor: _skinPal(isLine ? 'rgba(37,99,235,.14)' : 'rgba(37,99,235,.8)'),
          fill: isLine, tension: .35, pointRadius: isLine ? 3 : 0,
          borderRadius: isLine ? 0 : 5, borderSkipped: false, borderWidth: isLine ? 2 : 0
        },
        {
          label: 'MGO / LSMGO (MT)', data: mgoData,
          borderColor: _skinPal('rgba(249,115,22,1)'),
          backgroundColor: _skinPal(isLine ? 'rgba(249,115,22,.14)' : 'rgba(249,115,22,.75)'),
          fill: isLine, tension: .35, pointRadius: isLine ? 3 : 0,
          borderRadius: isLine ? 0 : 5, borderSkipped: false, borderWidth: isLine ? 2 : 0
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index' },
      plugins: {
        legend: { position: 'top', labels: { font: { size: 11, family:_skinFont('DM Sans') }, boxWidth: 10, padding: 12, color: _chartTextColor() } },
        tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmtMT(c.parsed.y)} MT` } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10, family:_skinFont('DM Mono') }, color: _chartTextColor() } },
        y: { grid: { color: Chart.defaults.borderColor }, ticks: { font: { size: 10, family:_skinFont('DM Mono') }, color: _chartTextColor(), callback: v => fmtMT(v) + ' MT' } }
      }
    }
  });
}

function fmtShort(d) { if (!d) return '—'; return `${d.getDate()} ${MO[d.getMonth()]}`; }
// Round to whole minutes first — rounding only the fraction could show "1h 60m".
function durStr(h) { const t = Math.round((h || 0) * 60), hh = Math.floor(t / 60), mm = t % 60; return mm > 0 ? `${hh}h ${mm}m` : `${hh}h`; }
function addHrs(d,h) {
  const dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) {
    console.error('ABPS: addHrs() received an invalid date value:', d);
    throw new Error('Invalid date encountered while building the schedule (received: ' + JSON.stringify(d) + '). This usually means a vessel or barge record has a missing or corrupted ETA/date field — check entries with blank or unusual date values.');
  }
  return new Date(dt.getTime() + h * 3600000);
}

function parseDT(raw) {
  if (!raw || !raw.trim()) return null;
  raw = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) { const d = new Date(raw); return isNaN(d) ? null : d; }
  let ap = null;
  const apm = raw.match(/\s*(am|pm)\s*$/i);
  if (apm) { ap = apm[1].toLowerCase(); raw = raw.slice(0, raw.length - apm[0].length).trim(); }
  const tM = raw.match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
  let h = 0, m = 0, hasT = false;
  if (tM) {
    h = parseInt(tM[1]); m = parseInt(tM[2]); hasT = true;
    if (ap) { if (h < 1 || h > 12) return null; if (ap === 'am') { if (h === 12) h = 0; } else if (h !== 12) h += 12; }
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  }
  const ds = (hasT ? raw.replace(/(\d{1,2}):(\d{2})(?::\d{2})?/,'') : raw).trim().replace(/,/g,'').replace(/\s+/g,' ');
  let day, mon, yr;
  let mt;
  if ((mt = ds.match(/^(\d{1,2}) ([a-z]{3,9})\.? (\d{4})$/i)))      { day = +mt[1]; mon = MMAP[mt[2].toLowerCase().slice(0,3)]; yr = +mt[3]; }
  else if ((mt = ds.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)))        { yr = +mt[1]; mon = +mt[2]-1; day = +mt[3]; }        // YYYY-MM-DD [HH:mm]
  else if ((mt = ds.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4}|\d{2})$/))) { day = +mt[1]; mon = +mt[2]-1; yr = +mt[3]; if (mt[3].length === 2) yr += 2000; } // DD/MM/YYYY, DD/MM/YY
  else if ((mt = ds.match(/^(\d{1,2}) ([a-z]{3,9})\.?$/i)))          { day = +mt[1]; mon = MMAP[mt[2].toLowerCase().slice(0,3)]; yr = new Date().getFullYear(); }
  else if (ds === '' && hasT) { const n = new Date(); day = n.getDate(); mon = n.getMonth(); yr = n.getFullYear(); } // time only → today
  else return null; // unparseable — never silently turn garbage into "today"
  if (mon === undefined || isNaN(mon) || mon < 0 || mon > 11 || !(day >= 1 && day <= 31)) return null;
  const out = new Date(yr, mon, day, h, m, 0, 0);
  if (isNaN(out.getTime())) return null;
  // Reject impossible days (31 Feb would otherwise roll over into March).
  if (out.getDate() !== day || out.getMonth() !== mon) return null;
  return out;
}

function parseLaycan(raw) {
  if (!raw || !raw.trim()) return null;
  let s = raw.trim().replace(/(\d+)(st|nd|rd|th)/gi,'$1');
  let fromStr, toStr;
  if (/\bto\b/i.test(s)) { const p = s.split(/\s+to\s+/i); if (p.length === 2) { fromStr = p[0].trim(); toStr = p[1].trim(); } }
  if (!fromStr) { const m = s.match(/^(.+?)\s*[-–]\s*(.+)$/); if (m) { fromStr = m[1].trim(); toStr = m[2].trim(); } }
  if (!fromStr || !toStr) return null;

  /* ── Helper: push any date that parsed to exactly midnight forward
     to 23:59 of that same day. This means the laycan TO date is
     always treated as "end of that calendar day", so a vessel with
     ETA on the closing day of the laycan (e.g. 6 Jun 23:00 inside
     a "4–6 Jun" window) is never wrongly marked Delayed. ── */
  function endOfDay(d) {
    if (!d) return d;
    if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) {
      return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
    }
    return d;
  }

  let fromD, toD;
  const hasMonFrom = /[a-z]/i.test(fromStr), hasMonTo = /[a-z]/i.test(toStr);

  if (!hasMonFrom && hasMonTo) {
    // e.g. "4 – 6 Jun"  →  fromStr="4", toStr="6 Jun"
    toD = endOfDay(parseDT(toStr)); if (!toD) return null;
    const day = parseInt(fromStr, 10); if (isNaN(day)) return null;
    fromD = new Date(toD.getFullYear(), toD.getMonth(), day, 0, 0, 0);
  } else if (hasMonFrom && !hasMonTo) {
    // e.g. "4 Jun – 6"  →  fromStr="4 Jun", toStr="6"
    fromD = parseDT(fromStr); if (!fromD) return null;
    const day = parseInt(toStr, 10); if (isNaN(day)) return null;
    toD = new Date(fromD.getFullYear(), fromD.getMonth(), day, 23, 59, 59);
  } else {
    // e.g. "4 Jun – 6 Jun" or "4 Jun to 6 Jun"
    fromD = parseDT(fromStr); toD = parseDT(toStr);
    if (!fromD || !toD) return null;
    toD = endOfDay(toD);
  }

  if (!fromD || !toD) return null;
  return { from: fromD, to: toD, raw };
}

function fmtLC(lc) {
  if (!lc) return '—';
  const f = lc.from, t = lc.to;
  if (f.getMonth()===t.getMonth()&&f.getFullYear()===t.getFullYear()) return `${f.getDate()} – ${t.getDate()} ${MO[f.getMonth()]} ${f.getFullYear()}`;
  return `${fmtShort(f)} – ${fmtShort(t)} ${t.getFullYear()}`;
}

function calcETC(eta, vq, mq, vtph=300, mtph=100, hoseHrs=_calcParams.hoseHrs) { return addHrs(eta, hoseHrs + Math.max(vq/vtph, mq/mtph)); }

/* Inline check of the card's qty boxes: a range shows what planning uses,
   anything unreadable is flagged (it would otherwise plan as 0 / a guess). */
function _qtyHints(id) {
  [['vlsfo', 'hvq'], ['mgo', 'hmq']].forEach(function(p) {
    const el = document.getElementById('v' + id + '-' + p[0]), h = document.getElementById('v' + id + '-' + p[1]);
    if (!el || !h) return;
    const q = _parseQtyInput(el.value);
    el.classList.toggle('err', !q.ok);
    el.setAttribute('aria-invalid', q.ok ? 'false' : 'true');
    if (!q.ok) { h.textContent = 'Type a number or a range, e.g. 500-600'; h.className = 'hint er'; }
    else if (q.min != null) { h.textContent = 'Range ' + _fmtQtyRange(q.min, q.max) + ' MT · planned at ' + q.max.toLocaleString(); h.className = 'hint inf'; }
    else { h.textContent = ''; h.className = 'hint'; }
  });
}

