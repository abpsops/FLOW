/* ── Reports ── */
function refreshReports() {
  // Use live _savedSupplies first, fall back to localStorage
  let records = (_savedSupplies && _savedSupplies.length) ? _savedSupplies : null;
  if (!records) {
    try { records = JSON.parse(localStorage.getItem(LS_RECORDS_KEY) || '[]'); } catch(e) { records = []; }
    if (!Array.isArray(records)) records = [];
  }
  // KPIs: same source and rules as the Monthly Report / analytics charts —
  // live + archived records via _getAllReportRecords() (deduped), supplied
  // only, every port (the Monthly Report's FUJ / KFK button filters that report
  // only), and the ACTUAL qty via _recActQty (an
  // actual of 0 is real; `act || actual` used to fall through to stale
  // fields). Unsupplied drafts used to inflate "Completed deliveries".
  const delivered = (typeof _getAllReportRecords === 'function' ? _getAllReportRecords() : records).filter(r =>
    r && r.supplied === true);
  let totalV=0, totalM=0;
  delivered.forEach(r => {
    totalV += _recActQty(r, 'v');
    totalM += _recActQty(r, 'm');
  });
  const ops = delivered.length;
  const avgV = ops ? (totalV/ops) : 0;
  const avgM = ops ? (totalM/ops) : 0;
  safeSet('rep-total-vlsfo', fmtMT(totalV)+' MT');
  safeSet('rep-total-lsmgo', fmtMT(totalM)+' MT');
  safeSet('rep-ops-count', ops);
  safeSet('rep-avg-vol', fmtMT(avgV+avgM)+' MT');
  safeSet('rep-avg-vlsfo', fmtMT(avgV)+' MT');
  safeSet('rep-avg-mgo',   fmtMT(avgM)+' MT');

  // Render records table — connected to _savedSupplies (same as Monthly Report)
  const tbody = document.getElementById('rep-records-body');
  if (tbody) {
    const dispRecs = (_savedSupplies && _savedSupplies.length) ? _savedSupplies : records;
    if (!dispRecs.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:24px">No saved records yet. Save supply records in the Checklist to build reports.</td></tr>';
    } else {
      tbody.innerHTML = dispRecs.slice().reverse().slice(0,50).map((r,i) =>
        `<tr id="rep-row-${esc(r.id||i)}">
          <td class="sno">${i+1}</td>
          <td style="font-weight:600">${esc(r.vessel||'—')}</td>
          <td>${esc(_resolveRecordBargeName(r))}</td>
          <td class="mono">${esc(r.dateStr||r.date||'—')}</td>
          <td class="num azure">${esc(fmtMT(r.vlsfoAct||r.vlsfoActual||0))}</td>
          <td class="num teal">${esc(fmtMT(r.mgoAct||r.mgoActual||0))}</td>
          <td>${esc(r.area||r.location||'—')}</td>
          <td><span class="badge badge-green"><span class="badge-dot"></span>${r.supplied?'Completed':'Saved'}</span></td>
          <td><button onclick="deleteRecord('${escJs(r.id||'')}')" style="background:var(--red-lt);border:1px solid var(--red-bd);color:var(--red);border-radius:5px;padding:3px 10px;font-size:10px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="vertical-align:middle;margin-right:3px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>Delete
          </button></td>
        </tr>`
      ).join('');
    }
  }

  renderReportCharts(records);
}

// Resolve the actual barge name for a saved supply record. Records normally
// carry it in r.barge (sometimes r.bargeLabel on archived/legacy records).
// If neither is present but only one barge is configured in the fleet, that
// barge did the work by definition, so use its name — the record should
// never be shown as "Unassigned" in Reports & Analytics when a real barge
// (e.g. "FNSA 10") is the actual, known source.
function _resolveRecordBargeName(r) {
  const direct = (r.barge || r.bargeLabel || '').toString().trim();
  if (direct) return direct;
  const fleet = _fleetNow();
  if (fleet.length === 1 && fleet[0].name) return fleet[0].name;
  return 'Unassigned';
}

function renderReportCharts(records) {
  // This calendar month only — "how did this month go", not an all-time
  // running total. Full history stays available via Monthly Report / Archives.
  //
  // Records come from _getAllReportRecords() with the exact same rules the
  // Monthly Report and the Dashboard's Fuel Type Distribution donut use:
  // month decided by supplyDate (the day the fuel was actually delivered),
  // supplied === true, the report's port filter, and the near-duplicate
  // safety net. These charts used to carry their own separate live+archive
  // merge instead, which had drifted from the report on every one of those
  // points — it decided the month by savedAt (the day the record was
  // saved, not delivered), counted records that weren't marked supplied,
  // ignored the port filter, and only de-duplicated by id. That's why the
  // same month showed a different VLSFO total here than in the report.
  const _rcNow = new Date(), _rcMon = _rcNow.getMonth(), _rcYr = _rcNow.getFullYear();
  const recs = (typeof _getAllReportRecords === 'function' ? _getAllReportRecords() : []).filter(r => {
    if (!r.supplyDate || r.supplied !== true) return false;
    const _rcD = _parseLocalDate(r.supplyDate);
    return !isNaN(_rcD.getTime()) && _rcD.getMonth() === _rcMon && _rcD.getFullYear() === _rcYr;
  });
  // Monthly trend
  {
    const ctx = document.getElementById('chart-monthly-trend');
    if (_chartInstances['monthly-trend']) _chartInstances['monthly-trend'].destroy();
    const buckets = {};
    recs.forEach(r => {
      const d = _parseLocalDate(r.supplyDate||r.savedAt||r.date||0);
      if(isNaN(d.getTime())) return;
      const key = d.toLocaleString('default',{month:'short',year:'2-digit'});
      if(!buckets[key]) buckets[key]={v:0,m:0};
      buckets[key].v += _recActQty(r,'v');
      buckets[key].m += _recActQty(r,'m');
    });
    const labels = Object.keys(buckets);
    _chartInstances['monthly-trend'] = new Chart(ctx, {
      type:'bar',
      data:{
        labels: labels.length?labels:['No data'],
        datasets:[
          {label:'VLSFO (MT)',data:labels.map(k=>buckets[k].v),backgroundColor:_skinPal('rgba(47,111,237,.78)'),borderRadius:5,borderSkipped:false},
          {label:'LSMGO (MT)',data:labels.map(k=>buckets[k].m),backgroundColor:_skinPal('rgba(255,122,26,.68)'),borderRadius:5,borderSkipped:false}
        ]
      },
      options:{
        responsive:true,maintainAspectRatio:false,interaction:{mode:'index'},
        plugins:{legend:{position:'top',labels:{font:{size:11,family:_skinFont('DM Sans')},boxWidth:10,padding:12,color:_chartTextColor()}},tooltip:{callbacks:{label:c=>` ${c.dataset.label}: ${fmtMT(c.parsed.y)} MT`}}},
        scales:{x:{grid:{display:false},ticks:{font:{size:10,family:_skinFont('DM Mono')},color:_chartTextColor()}},y:{grid:{color:Chart.defaults.borderColor},ticks:{font:{size:10,family:_skinFont('DM Mono')},color:_chartTextColor(),callback:v=>fmtMT(v)+' MT'}}}
      }
    });
  }

  // Bunker Quantity bar chart — same series as the Dashboard's line chart
  // (current FY live from getMonthlyRows; FY26 Jan–Jul seeded). Re-renders
  // whatever the year dropdown currently shows (live, past FY or archive).
  _populateFYChartSelector();
  _onFYChartSelectorChange();

  // Barge Performance — grouped bar per barge (VLSFO + MGO)
  {
    const ctx = document.getElementById('chart-fuel-mix');
    if (_chartInstances['fuel-mix']) _chartInstances['fuel-mix'].destroy();
    const bargeBuckets = {};
    recs.forEach(r => {
      const bname = _resolveRecordBargeName(r);
      if (!bargeBuckets[bname]) bargeBuckets[bname] = {v:0, m:0};
      bargeBuckets[bname].v += _recActQty(r,'v');
      bargeBuckets[bname].m += _recActQty(r,'m');
    });
    const bLabels = Object.keys(bargeBuckets);
    _chartInstances['fuel-mix'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: bLabels.length ? bLabels : ['No data'],
        datasets: [
          { label:'VLSFO (MT)', data: bLabels.map(k=>bargeBuckets[k].v), backgroundColor:_skinPal('rgba(47,111,237,.82)'), borderRadius:5, borderSkipped:false },
          { label:'LSMGO (MT)', data: bLabels.map(k=>bargeBuckets[k].m), backgroundColor:_skinPal('rgba(255,122,26,.75)'), borderRadius:5, borderSkipped:false }
        ]
      },
      options: {
        responsive:true, maintainAspectRatio:false, interaction:{mode:'index'},
        plugins:{
          legend:{position:'top',labels:{font:{size:11,family:_skinFont('DM Sans')},boxWidth:10,padding:12,color:_chartTextColor()}},
          tooltip:{callbacks:{label:c=>` ${c.dataset.label}: ${fmtMT(c.parsed.y)} MT`}}
        },
        scales:{
          x:{grid:{display:false},ticks:{font:{size:11,family:_skinFont('DM Sans')},color:_chartTextColor()}},
          y:{grid:{color:Chart.defaults.borderColor},ticks:{font:{size:10,family:_skinFont('DM Mono')},color:_chartTextColor(),callback:v=>fmtMT(v)+' MT'}}
        }
      }
    });
  }

  // Vessel volume bar (horizontal) — VLSFO + MGO stacked
  {
    const ctx = document.getElementById('chart-vessel-vol');
    if (_chartInstances['vessel-vol']) _chartInstances['vessel-vol'].destroy();
    const vBuckets = {};
    recs.forEach(r => {
      const name = r.vessel||'Unknown';
      if(!vBuckets[name]) vBuckets[name]={v:0,m:0};
      vBuckets[name].v += _recActQty(r,'v');
      vBuckets[name].m += _recActQty(r,'m');
    });
    const sorted = Object.entries(vBuckets).sort((a,b)=>(b[1].v+b[1].m)-(a[1].v+a[1].m)).slice(0,8);
    _chartInstances['vessel-vol'] = new Chart(ctx, {
      type:'bar',
      data:{
        labels:sorted.map(x=>x[0]),
        datasets:[
          {label:'VLSFO (MT)',data:sorted.map(x=>x[1].v),backgroundColor:_skinPal('rgba(47,111,237,.8)'),borderRadius:4,borderSkipped:false,stack:'s'},
          {label:'LSMGO (MT)',data:sorted.map(x=>x[1].m),backgroundColor:_skinPal('rgba(255,122,26,.72)'),borderRadius:4,borderSkipped:false,stack:'s'}
        ]
      },
      options:{
        indexAxis:'y',responsive:true,maintainAspectRatio:false,
        interaction:{mode:'index'},
        plugins:{
          legend:{position:'top',labels:{font:{size:11,family:_skinFont('DM Sans')},boxWidth:10,padding:10,color:_chartTextColor()}},
          tooltip:{callbacks:{label:c=>` ${c.dataset.label}: ${fmtMT(c.parsed.x)} MT`}}
        },
        scales:{
          x:{grid:{color:Chart.defaults.borderColor},stacked:true,ticks:{font:{size:10,family:_skinFont('DM Mono')},color:_chartTextColor(),callback:v=>fmtMT(v)}},
          y:{grid:{display:false},stacked:true,ticks:{font:{size:11,family:_skinFont('DM Sans')},color:_chartTextColor()}}
        }
      }
    });
  }

  // Top Ports by Vessel Count
  {
    const ctx = document.getElementById('chart-supply-freq');
    if (_chartInstances['supply-freq']) _chartInstances['supply-freq'].destroy();
    // Map area codes → port buckets
    const portMap = { 'FUJ-A':'FUJ', 'FUJ-B':'FUJ', 'KFK-A':'KFK', 'KFK-B':'KFK' };
    const portCounts = { 'FUJ': 0, 'KFK': 0 };
    recs.forEach(r => {
      // areaCode holds the raw code (FUJ-A etc); area may be a human-readable label
      const areaKey = r.areaCode || r.area || '';
      const port = portMap[areaKey] || portMap[Object.keys(portMap).find(k => areaKey.includes(k)) || ''];
      if (port) portCounts[port]++;
    });
    const labels = ['FUJ', 'KFK'];
    const data   = [portCounts['FUJ'], portCounts['KFK']];
    _chartInstances['supply-freq'] = new Chart(ctx, {
      type:'bar',
      data:{
        labels,
        datasets:[{
          label:'Vessel Count',
          data,
          backgroundColor:_skinPal('rgba(14,122,155,.82)'),
          borderRadius:6,
          borderSkipped:false
        }]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{
          legend:{display:false},
          title:{display:true, text:'Top ports by vessel count', font:{size:13,family:_skinFont('DM Sans'),weight:'600'}, color:_chartTextColor(), padding:{bottom:10}},
          tooltip:{callbacks:{label:c=>` ${c.parsed.y} vessel${c.parsed.y!==1?'s':''}`}}
        },
        scales:{
          x:{grid:{display:false}, ticks:{font:{size:11,family:_skinFont('DM Sans')},color:_chartTextColor()}},
          y:{grid:{color:Chart.defaults.borderColor}, ticks:{font:{size:10,family:_skinFont('DM Mono')},color:_chartTextColor(), stepSize:1, callback:v=>Number.isInteger(v)?v:''}}
        }
      }
    });
  }
}

// renderArchivePanel is defined in the archive section below

// renderTrashBin is defined in the vessel nomination section below

function safeSet(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

