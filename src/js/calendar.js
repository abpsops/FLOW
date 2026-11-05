/* ─── BARGE SYSTEM ─── */
/* ═══════════════════════════════════════════════════
   WEEKLY SUPPLY CALENDAR
   ═══════════════════════════════════════════════════ */
let _calWeekOffset = 0; // days offset from today

function shiftWeekCal(days) {
  _calWeekOffset = (days === 0) ? 0 : _calWeekOffset + days;
  renderWeekCalendar(_calWeekOffset);
  // Keep Free Windows in sync with whatever week is now showing, if it's
  // currently open — otherwise paging the calendar would silently leave
  // it stuck showing the previous week's availability.
  var fwPanel = document.getElementById('free-windows-panel');
  if (fwPanel && fwPanel.style.display !== 'none' && typeof renderFreeWindowsPanel === 'function') {
    renderFreeWindowsPanel();
  }
}

function renderWeekCalendar(offsetDays) {
  _calWeekOffset = offsetDays;
  const stsL = _stsLookup();
  const el = document.getElementById('week-calendar');
  if (!el) return;

  const today = new Date();
  today.setHours(0,0,0,0);
  const weekStart = new Date(today.getTime() + offsetDays * 86400000);

  // Build 7 day slots
  const days = Array.from({length:7}, (_,i) => {
    const d = new Date(weekStart.getTime() + i * 86400000);
    return d;
  });

  // Update header label
  const lblEl = document.getElementById('week-cal-label');
  if (lblEl) {
    const s = days[0].toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
    const e = days[6].toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
    lblEl.textContent = s + ' – ' + e;
  }

  // Completion is decided per nomination (nomUid, legacy name+date fallback)
  // via _isScheduleItemCompleted — a by-name set hid a vessel's repeat call
  // as soon as its earlier call had been supplied.

  // Gather supply items from _lastSched — placed under their ETA date, not
  // the barge's actual supply-start date. A vessel can be delayed to the
  // next day if its barge was busy (loading, another vessel, etc.) — but
  // the calendar is meant to answer "when is this vessel arriving/expected"
  // per the nominated ETA, not silently move it to whatever day the barge
  // happened to free up. That "actual start may differ" detail is still
  // fully visible via the ETC now shown directly on the card (see below).
  const allItems = (_lastSched || []).map(item => {
    const raw = item.eta || item.bargeStart;
    const d = raw ? (raw instanceof Date ? raw : new Date(raw)) : null;
    return { ...item, _etaDate: d };
  }).filter(x => x._etaDate && !isNaN(x._etaDate) && !_isScheduleItemCompleted(x));

  // Fallback from nominations
  let fallbackItems = [];
  if (!allItems.length) {
    document.querySelectorAll('#vc .vcard[id^="vessel-"]').forEach(card => {
      const cid = card.id.replace('vessel-','');
      const name  = document.getElementById('v'+cid+'-name')?.value   || ('Vessel '+cid);
      const ty    = document.getElementById('v'+cid+'-type')?.value    || 'BOTH';
      const vP    = _cardQty(cid, 'vlsfo'), mP = _cardQty(cid, 'mgo');
      const v     = ty!=='MGO'   ? vP.qty : 0;
      const m     = ty!=='VLSFO' ? mP.qty : 0;
      const d     = parseDT(document.getElementById('v'+cid+'-eta')?.value || '');
      const fb    = { name, vQ:v, mQ:m, _etaDate:new Date(d), bargeLabel:'', area:'' };
      const fbWin = _cardEtaWin(cid); if (fbWin) fb.etaWin = fbWin;
      if (_cardSts(cid)) fb.sts = true;
      if (_cardLcOnly(cid)) fb.lcOnly = true;
      if (v && vP.min != null) { fb.nomVMin = vP.min; fb.nomVMax = vP.max; }
      if (m && mP.min != null) { fb.nomMMin = mP.min; fb.nomMMax = mP.max; }
      if ((v||m) && d) fallbackItems.push(fb);
    });
  }
  const source = allItems.length ? allItems : fallbackItems;

  // Grade colour helpers — mapped to the app's own design tokens, not ad-hoc hex
  const gradeColor = (v,m) => v>0&&m>0
    ? { bg:'var(--purple-lt)', border:'var(--purple)',  text:'var(--purple)', label:'BOTH'  }
    : v>0
    ? { bg:'var(--fuel-v-lt)', border:'var(--fuel-v)',  text:'var(--fuel-v)', label:'VLSFO' }
    : { bg:'var(--fuel-m-lt)', border:'var(--fuel-m)',  text:'var(--fuel-m)', label:'LSMGO' };

  const fmt  = d => d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  const dow  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Inline SVG icon set — replaces emoji glyphs for a consistent, professional look
  const ICO_CLOCK  = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
  const ICO_PIN    = '<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
  const ICO_BARGE  = '<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><path d="M2 16l1.5 4h17L22 16"/><path d="M4 16V8l8-4 8 4v8"/></svg>';

  // ISO-style week number, for the technical "WK NN" designator
  const jan1 = new Date(weekStart.getFullYear(),0,1);
  const wkNum = Math.ceil((((weekStart - jan1) / 86400000) + jan1.getDay() + 1) / 7);
  const wkLbl = document.getElementById('week-cal-wk');
  if (wkLbl) wkLbl.textContent = 'WK ' + String(wkNum).padStart(2,'0');

  // Build HTML — 7 columns, ruled like a spec table rather than soft cards
  let colsHtml = '';
  let totalV7=0, totalM7=0, totalOps7=0;
  const bargeWk = {}; // barge label -> { v, m } supplied this week
  const calMap = _bargeColorMap();

  days.forEach((day, dayIdx) => {
    const isToday = day.toDateString() === new Date().toDateString();
    const isPast  = day < today;
    const isLast  = dayIdx === days.length - 1;
    const dayItems = source.filter(x => x._etaDate.toDateString() === day.toDateString())
      .sort((a,b) => a._etaDate - b._etaDate);

    totalOps7 += dayItems.length;
    dayItems.forEach(x => {
      const xv = (x.nomVQ!==undefined&&x.nomVQ!==null)?x.nomVQ:(x.vQ||0), xm = (x.nomMQ!==undefined&&x.nomMQ!==null)?x.nomMQ:(x.mQ||0);
      totalV7+=xv; totalM7+=xm;
      const bl = String(x.bargeLabel || '').trim();
      if (bl) { const b = bargeWk[bl] || (bargeWk[bl] = { v:0, m:0 }); b.v+=xv; b.m+=xm; }
    });

    const dayTotalV = dayItems.reduce((s,x)=>s+((x.nomVQ!==undefined&&x.nomVQ!==null)?x.nomVQ:(x.vQ||0)),0);
    const dayTotalM = dayItems.reduce((s,x)=>s+((x.nomMQ!==undefined&&x.nomMQ!==null)?x.nomMQ:(x.mQ||0)),0);
    const hasSup = dayItems.length > 0;

    // Loading operations whose date range overlaps this calendar day —
    // a loading marked Done is intentionally excluded here so completing
    // it removes it from the calendar immediately, even if its date range
    // technically still overlaps today/future days.
    const dayEnd = new Date(day.getTime() + 86400000);
    const dayLoadings = (_loadingRecords || []).filter(function(r) {
      if (r.deletedAt || r.completed) return false;
      const s = new Date(r.startAt), e = new Date(r.endAt);
      return s < dayEnd && e >= day;
    }).sort(function(a,b) { return new Date(a.startAt) - new Date(b.startAt); });

    colsHtml += `<div style="
      flex:1;min-width:0;display:flex;flex-direction:column;
      border-right:${isLast?'none':'1px solid var(--border)'};
      background:${isToday?'var(--azure-lt)':'transparent'};
      ${isPast?'opacity:.55':''}
    ">
      <!-- Day header — ruled cell, tabular date, hairline rule -->
      <div style="
        padding:9px 6px 8px;
        border-bottom:1px solid var(--border);
        border-top:3px solid ${isToday?'var(--azure)':'transparent'};
        background:var(--surface2);
        text-align:center;
      ">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);font-family:'DM Mono',monospace">${dow[day.getDay()]}</div>
        <div style="font-size:19px;font-weight:700;font-family:'DM Mono',monospace;color:${isToday?'var(--azure)':'var(--ink)'};line-height:1.25;margin-top:2px;letter-spacing:-.02em;font-variant-numeric:tabular-nums">${String(day.getDate()).padStart(2,'0')}</div>
        <div style="font-size:9px;font-weight:600;color:var(--muted);font-family:'DM Mono',monospace;text-transform:uppercase;letter-spacing:.06em">${months[day.getMonth()]}</div>
        ${hasSup?`<div style="margin-top:5px;font-size:8.5px;font-weight:700;padding:1px 7px;border:1px solid ${isToday?'var(--azure)':'var(--azure-bd)'};border-radius:3px;color:var(--azure);display:inline-block;letter-spacing:.03em;font-family:'DM Mono',monospace">${dayItems.length} OP${dayItems.length>1?'S':''}</div>`:`<div style="margin-top:5px;height:19px"></div>`}
      </div>

      <!-- Day total strip — ALWAYS rendered (even when empty) so every
           column's manifest area starts at the same y-coordinate; making
           this row conditional was what threw the week out of alignment,
           since flex columns with no supply would skip straight to the
           manifest while busy days pushed theirs down by this row's height. -->
      <div style="padding:6px 6px;border-bottom:1px solid var(--border);background:var(--surface);display:flex;gap:4px;flex-wrap:wrap;justify-content:center;min-height:23px;box-sizing:border-box">
        ${dayTotalV>0?`<span style="font-size:9px;font-weight:700;padding:1px 5px;border:1px solid var(--fuel-v-bd);border-radius:2px;color:var(--fuel-v);font-family:'DM Mono',monospace;font-variant-numeric:tabular-nums">V·${dayTotalV.toLocaleString()}</span>`:''}
        ${dayTotalM>0?`<span style="font-size:9px;font-weight:700;padding:1px 5px;border:1px solid var(--fuel-m-bd);border-radius:2px;color:var(--fuel-m);font-family:'DM Mono',monospace;font-variant-numeric:tabular-nums">M·${dayTotalM.toLocaleString()}</span>`:''}
      </div>

      <!-- Loading operations + vessel manifest — ONE merged list, sorted by
           actual clock time rather than shown as two fixed blocks. A
           Loading's position is keyed off when it FINISHES (endAt): a
           Loading that finishes before a vessel's ETA sits above that
           vessel; one that finishes after or overlaps sits below it. Each
           entry keeps its own card style (solid grade fill for a Loading,
           bordered light card for a vessel) so they're still easy to tell
           apart at a glance, just interleaved in true chronological order. -->
      <div style="flex:1;padding:6px;display:flex;flex-direction:column;gap:5px;overflow:visible;background:var(--surface)">
        ${(function() {
          const dayEntries = [
            ...dayLoadings.map(r => ({ kind: 'loading', sortKey: new Date(r.endAt).getTime(), data: r })),
            ...dayItems.map(x => ({ kind: 'vessel', sortKey: x._etaDate.getTime(), data: x })),
          ].sort((a, b) => a.sortKey - b.sortKey);

          if (!dayEntries.length) {
            return `<div style="flex:1;display:flex;align-items:center;justify-content:center;padding:16px 4px;text-align:center">
              <span style="font-size:9.5px;color:var(--muted);font-weight:600;font-family:'DM Mono',monospace;text-transform:uppercase;letter-spacing:.04em">No Supply</span>
            </div>`;
          }

          return dayEntries.map(function(entry) {
            if (entry.kind === 'loading' && _isTransfer(entry.data)) {
              // Barge-to-barge transfer — purple, so it never reads as a terminal loading.
              const r = entry.data;
              const start = new Date(r.startAt), end = new Date(r.endAt);
              const fromN = r.fromBarge || '', toN = _resolveRecordBargeName(r);
              const xWin = r.startWin && _etaFrame(r.startWin) ? _etaFrame(r.startWin).code : '';
              return `<div style="
                background:var(--purple);
                border:1px solid var(--purple-bd);
                border-radius:4px;
                padding:6px 7px;
                overflow:hidden;
                box-sizing:border-box;
                cursor:pointer;
                transition:filter .12s, transform .12s;
              " class="cal-ticket-clickable cal-ticket-transfer" onclick="showPage('loading');editLoadingRecord('${escJs(r.id)}')" title="Barge transfer — ${esc(fromN)} → ${esc(toN)}&#10;${esc(r.grade)} ${Number(r.qty).toLocaleString()} MT&#10;${start.toLocaleString('en-GB')} → ${end.toLocaleString('en-GB')}${r.notes?'&#10;'+esc(r.notes):''}&#10;Click to open in Loading">
                <div style="display:flex;align-items:center;flex-wrap:wrap;row-gap:3px;gap:4px">
                  <span style="font-family:'DM Mono',monospace;font-size:8.5px;font-weight:700;color:#fff;display:flex;align-items:center;gap:3px;font-variant-numeric:tabular-nums;flex-shrink:0;opacity:.95">${ICO_CLOCK}${xWin || fmt(start)}</span>
                  <span style="font-size:7.5px;font-weight:700;padding:1px 4px;border:1px solid rgba(255,255,255,.55);border-radius:2px;color:#fff;letter-spacing:.03em;font-family:'DM Mono',monospace;white-space:nowrap;flex-shrink:0;margin-left:auto">TRANSFER</span>
                </div>
                <div class="cal-xfer-route" style="font-size:10.5px;font-weight:700;color:#fff;white-space:normal;word-break:break-word;overflow-wrap:break-word;max-width:100%;line-height:1.35;margin-top:4px">${esc(fromN)} → ${esc(toN)}</div>
                <div style="display:flex;gap:8px;margin-top:4px;font-family:'DM Mono',monospace;font-size:9.5px;font-weight:700;font-variant-numeric:tabular-nums">
                  <span style="color:#fff">${esc(r.grade)}&nbsp;${Number(r.qty).toLocaleString()}</span>
                </div>
                <div style="margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,.3);display:flex;flex-direction:column;gap:2px">
                  <div style="font-size:8.5px;color:rgba(255,255,255,.85);font-weight:600;display:flex;align-items:center;gap:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:'DM Mono',monospace">${ICO_CLOCK}Ends ${fmt(end)}</div>
                </div>
              </div>`;
            }
            if (entry.kind === 'loading') {
              const r = entry.data;
              const isM = r.grade === 'LSMGO';
              const gc = isM ? 'var(--fuel-m)' : 'var(--fuel-v)';       // solid grade color — used as the card's fill
              const gcBd = isM ? 'var(--fuel-m-bd)' : 'var(--fuel-v-bd)';
              const start = new Date(r.startAt), end = new Date(r.endAt);
              const ldWin = r.startWin && _etaFrame(r.startWin) ? _etaFrame(r.startWin).code : '';
              return `<div style="
                background:${gc};
                border:1px solid ${gcBd};
                border-radius:4px;
                padding:6px 7px;
                overflow:hidden;
                box-sizing:border-box;
                cursor:pointer;
                transition:filter .12s, transform .12s;
              " class="cal-ticket-clickable cal-ticket-loading" onclick="showPage('loading');editLoadingRecord('${escJs(r.id)}')" title="${esc(r.terminal)} — ${esc(r.grade)} ${r.qty.toLocaleString()} MT&#10;Barge: ${esc(_resolveRecordBargeName(r))}&#10;${ldWin ? 'Start ' + _etaFrame(r.startWin).code + ' ' + _etaFrameHours(r.startWin) + ' (time frame) · ' : ''}${start.toLocaleString('en-GB')} → ${end.toLocaleString('en-GB')}${r.surveyor?'&#10;Surveyor: '+esc(r.surveyor):''}${r.notes?'&#10;'+esc(r.notes):''}&#10;Click to open in Loading">
                <div style="display:flex;align-items:center;flex-wrap:wrap;row-gap:3px;gap:4px">
                  <span style="font-family:'DM Mono',monospace;font-size:8.5px;font-weight:700;color:#fff;display:flex;align-items:center;gap:3px;font-variant-numeric:tabular-nums;flex-shrink:0;opacity:.95">${ICO_CLOCK}${ldWin || fmt(start)}</span>
                  <span style="font-size:7.5px;font-weight:700;padding:1px 4px;border:1px solid rgba(255,255,255,.55);border-radius:2px;color:#fff;letter-spacing:.03em;font-family:'DM Mono',monospace;white-space:nowrap;flex-shrink:0;margin-left:auto">LOAD · ${esc(r.grade)}</span>
                </div>
                <div style="font-size:10.5px;font-weight:700;color:#fff;white-space:normal;word-break:break-word;overflow-wrap:break-word;max-width:100%;line-height:1.35;margin-top:4px">${esc(r.terminal)}</div>
                <div style="display:flex;gap:8px;margin-top:4px;font-family:'DM Mono',monospace;font-size:9.5px;font-weight:700;font-variant-numeric:tabular-nums">
                  <span style="color:#fff">${esc(r.grade)}&nbsp;${r.qty.toLocaleString()}</span>
                </div>
                <div style="margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,.3);display:flex;flex-direction:column;gap:2px">
                  <div>${_bargePill(_resolveRecordBargeName(r), calMap, 'on-fill sm')}</div>
                  <div style="font-size:8.5px;color:rgba(255,255,255,.85);font-weight:600;display:flex;align-items:center;gap:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:'DM Mono',monospace">${ICO_CLOCK}Ends ${fmt(end)}</div>
                  ${r.surveyor?`<div style="font-size:8.5px;color:rgba(255,255,255,.85);font-weight:600;white-space:normal;word-break:break-word;overflow-wrap:break-word;line-height:1.35;font-family:'DM Mono',monospace">Surveyor: ${esc(r.surveyor)}</div>`:''}
                </div>
              </div>`;
            }

            const item = entry.data;
            const calNomV=(item.nomVQ!==undefined&&item.nomVQ!==null)?item.nomVQ:(item.vQ||0), calNomM=(item.nomMQ!==undefined&&item.nomMQ!==null)?item.nomMQ:(item.mQ||0);
            const gc = gradeColor(calNomV, calNomM);
            // Time-frame ETA: show the frame ("AM 06:00–12:00"), not its start time.
            const etaTime = (item.etaWin && _etaFrame(item.etaWin)) ? _etaFrame(item.etaWin).code : fmt(item._etaDate);
            const etcDate = item.etc ? (item.etc instanceof Date ? item.etc : new Date(item.etc)) : null;
            let etcDisplay = '';
            if (etcDate && !isNaN(etcDate)) {
              const crossesDay = etcDate.toDateString() !== item._etaDate.toDateString();
              etcDisplay = fmt(etcDate) + (crossesDay ? ' (' + etcDate.toLocaleDateString('en-GB',{day:'2-digit',month:'short'}) + ')' : '');
            }
            const loc = item.area || item.anchorage || item.location || '';
            const barge = item.bargeLabel || '';
            const hasSno = item.sno !== undefined && item.sno !== null;
            const calBst = barge ? _bargeStyle(barge, calMap) : '';
            return `<div ${calBst ? 'data-bc="1" data-bgn="' + esc(String(barge).trim()) + '"' : ''} style="${calBst}${calBst ? ';' : ''}
              background:var(--bg);
              border:1px solid var(--border);
              border-left:3px solid ${gc.border};
              border-radius:3px;
              padding:6px 7px;
              overflow:hidden;
              box-sizing:border-box;
              ${hasSno?'cursor:pointer':'cursor:default'};
              transition:border-color .12s, transform .12s;
            " class="${hasSno?'cal-ticket-clickable ':''}cal-vcard${_stsOf(stsL, item) ? ' is-sts' : ''}"${item.nomUid ? ` data-nu="${esc(item.nomUid)}"` : ''} ${hasSno?`onclick="_globalSearchGoSchedule('${escJs(String(item.sno))}')"`:''} title="${esc(item.name)}&#10;ETA: ${(item.etaWin && _etaFrame(item.etaWin)) ? etaTime + ' ' + _etaFrameHours(item.etaWin) + ' (time frame)' : etaTime}${etcDisplay?'&#10;ETC: '+etcDisplay:''}&#10;VLSFO: ${esc(_nomQtyTxt(item,'V',calNomV))} MT | MGO: ${esc(_nomQtyTxt(item,'M',calNomM))} MT${loc?'&#10;'+esc(loc):''}${barge?'&#10;'+esc(barge):''}${hasSno?'&#10;Click to open in Schedule':''}">
              <div style="display:flex;align-items:center;flex-wrap:wrap;row-gap:3px;gap:4px">
                <span style="font-family:'DM Mono',monospace;font-size:8.5px;font-weight:700;color:var(--muted);display:flex;align-items:center;gap:3px;font-variant-numeric:tabular-nums;flex-shrink:0">${ICO_CLOCK}${etaTime}</span>
                ${item.isDelayed?`<span style="font-size:7.5px;font-weight:700;padding:1px 4px;border-radius:2px;color:#fff;background:var(--red);letter-spacing:.03em;font-family:'DM Mono',monospace;white-space:nowrap;flex-shrink:0">DELAYED</span>`:item.isEarly?`<span style="font-size:7.5px;font-weight:700;padding:1px 4px;border-radius:2px;color:#fff;background:var(--teal);letter-spacing:.03em;font-family:'DM Mono',monospace;white-space:nowrap;flex-shrink:0">BEFORE LAYCAN</span>`:''}
                <span style="font-size:7.5px;font-weight:700;padding:1px 4px;border:1px solid ${gc.border};border-radius:2px;color:${gc.text};letter-spacing:.03em;font-family:'DM Mono',monospace;white-space:nowrap;flex-shrink:0;margin-left:auto">${gc.label}</span>
              </div>
              <div style="font-size:10.5px;font-weight:700;color:var(--ink);white-space:normal;word-break:break-word;overflow-wrap:break-word;max-width:100%;line-height:1.35;margin-top:4px">${esc(item.name)}<span data-sts-slot>${_stsTag({ sts: _stsOf(stsL, item) })}</span></div>
              <div style="display:flex;flex-wrap:wrap;row-gap:2px;gap:8px;margin-top:4px;font-family:'DM Mono',monospace;font-size:9.5px;font-weight:700;font-variant-numeric:tabular-nums">
                ${calNomV>0?`<span style="color:var(--fuel-v)">V&nbsp;${esc(_nomQtyTxt(item,'V',calNomV))}</span>`:''}
                ${calNomM>0?`<span style="color:var(--fuel-m)">M&nbsp;${esc(_nomQtyTxt(item,'M',calNomM))}</span>`:''}
              </div>
              ${barge||loc?`<div style="margin-top:4px;padding-top:4px;border-top:1px solid var(--border2);display:flex;flex-direction:column;gap:2px">
                ${barge?`<div>${_bargePill(barge, calMap, 'sm')}</div>`:''}
                ${loc?`<div style="font-size:8.5px;color:var(--muted);font-weight:600;display:flex;align-items:center;gap:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:'DM Mono',monospace">${ICO_PIN}${esc(loc)}</div>`:''}
              </div>`:''}
            </div>`;
          }).join('');
        })()}
      </div>
    </div>`;
  });

  // Week summary footer — ruled data strip, tabular figures, technical legend
  const footerHtml = `<div style="
    display:flex;align-items:center;gap:16px;padding:11px 14px;
    background:var(--surface2);border-top:1px solid var(--border);
    flex-wrap:wrap
  ">
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:9px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-family:'DM Mono',monospace">Week Total</span>
      <span style="font-size:14px;font-weight:700;color:var(--ink);font-family:'DM Mono',monospace;font-variant-numeric:tabular-nums">${totalOps7}</span>
      <span style="font-size:10px;color:var(--sub);font-weight:600">operation${totalOps7!==1?'s':''}</span>
    </div>
    ${totalV7>0?`<div style="display:flex;align-items:center;gap:6px;padding-left:14px;border-left:1px solid var(--border)"><span style="width:8px;height:8px;border-radius:2px;background:var(--fuel-v);display:inline-block"></span><span style="font-size:11.5px;font-family:'DM Mono',monospace;color:var(--fuel-v);font-weight:700;font-variant-numeric:tabular-nums">${totalV7.toLocaleString()} MT</span><span style="font-size:10px;color:var(--muted);font-weight:600">VLSFO</span></div>`:''}
    ${totalM7>0?`<div style="display:flex;align-items:center;gap:6px;padding-left:14px;border-left:1px solid var(--border)"><span style="width:8px;height:8px;border-radius:2px;background:var(--fuel-m);display:inline-block"></span><span style="font-size:11.5px;font-family:'DM Mono',monospace;color:var(--fuel-m);font-weight:700;font-variant-numeric:tabular-nums">${totalM7.toLocaleString()} MT</span><span style="font-size:10px;color:var(--muted);font-weight:600">LSMGO</span></div>`:''}
    ${!totalOps7?`<span style="font-size:11.5px;color:var(--muted);font-weight:600">No supplies scheduled this week — generate a schedule to populate the calendar</span>`:''}
    ${Object.keys(bargeWk).sort().map(function(bn) {
      const b = bargeWk[bn];
      return `<div style="display:flex;align-items:center;gap:6px;padding-left:14px;border-left:1px solid var(--border)">${_bargePill(bn, calMap, 'sm')}${b.v>0?`<span style="font-size:11px;font-family:'DM Mono',monospace;color:var(--fuel-v);font-weight:700;font-variant-numeric:tabular-nums">V·${b.v.toLocaleString()}</span>`:''}${b.m>0?`<span style="font-size:11px;font-family:'DM Mono',monospace;color:var(--fuel-m);font-weight:700;font-variant-numeric:tabular-nums">M·${b.m.toLocaleString()}</span>`:''}</div>`;
    }).join('')}
    <span style="margin-left:auto;display:flex;gap:14px">
      <span style="font-size:9px;font-weight:600;color:var(--sub);display:flex;align-items:center;gap:5px;font-family:'DM Mono',monospace"><span style="width:8px;height:8px;border-radius:2px;background:var(--fuel-v);display:inline-block"></span>VLSFO</span>
      <span style="font-size:9px;font-weight:600;color:var(--sub);display:flex;align-items:center;gap:5px;font-family:'DM Mono',monospace"><span style="width:8px;height:8px;border-radius:2px;background:var(--fuel-m);display:inline-block"></span>LSMGO</span>
      <span style="font-size:9px;font-weight:600;color:var(--sub);display:flex;align-items:center;gap:5px;font-family:'DM Mono',monospace"><span style="width:8px;height:8px;border-radius:2px;background:var(--purple);display:inline-block"></span>BOTH</span>
      <span class="cal-legend-xfer" style="font-size:9px;font-weight:600;color:var(--sub);display:flex;align-items:center;gap:5px;font-family:'DM Mono',monospace"><span style="width:8px;height:8px;border-radius:2px;background:var(--purple);outline:1.5px solid var(--purple-bd);display:inline-block"></span>TRANSFER</span>
    </span>
  </div>`;

  el.innerHTML = `
    <div style="border:1px solid var(--border);border-radius:var(--radius-xs);overflow:hidden;background:var(--surface)">
      <div style="display:flex;min-height:340px">
        ${colsHtml}
      </div>
      ${footerHtml}
    </div>`;
}


let _reloadBargeId = null;

function openReloadModal(bargeId) {
  _reloadBargeId = bargeId;
  const b = _bargeConfig.find(x => x.id == bargeId);
  if (!b) return;
  const liveROBs = getAllLiveROBs();
  const rob = liveROBs[bargeId];
  const curV = rob ? Math.round(rob.liveV) : 0;
  const curM = rob ? Math.round(rob.liveM) : 0;

  document.getElementById('reload-barge-sub').textContent = b.name + ' — current ROB + reload = new ROB';
  document.getElementById('reload-cur-v').textContent = curV.toLocaleString();
  document.getElementById('reload-cur-m').textContent = curM.toLocaleString();
  document.getElementById('reload-vlsfo').value = 0;
  document.getElementById('reload-mgo').value = 0;
  document.getElementById('reload-note').value = '';
  document.getElementById('reload-preview').style.display = 'none';
  document.getElementById('reload-modal').style.display = 'flex';
}

function closeReloadModal() {
  document.getElementById('reload-modal').style.display = 'none';
  _reloadBargeId = null;
}

function updateReloadPreview() {
  const bargeId = _reloadBargeId;
  if (!bargeId) return;
  const liveROBs = getAllLiveROBs();
  const rob = liveROBs[bargeId];
  const curV = rob ? rob.liveV : 0;
  const curM = rob ? rob.liveM : 0;
  const addV = parseFloat(document.getElementById('reload-vlsfo').value) || 0;
  const addM = parseFloat(document.getElementById('reload-mgo').value) || 0;

  const newV = Math.round(curV + addV);
  const newM = Math.round(curM + addM);
  const prev = document.getElementById('reload-preview');
  if (addV > 0 || addM > 0) {
    prev.style.display = 'grid';
    document.getElementById('reload-new-v').textContent = newV.toLocaleString();
    document.getElementById('reload-new-m').textContent = newM.toLocaleString();
  } else {
    prev.style.display = 'none';
  }
}

async function saveReloadQty() {
  const bargeId = _reloadBargeId;
  const b = _bargeConfig.find(x => x.id == bargeId);
  if (!b) return;

  const addV = parseFloat(document.getElementById('reload-vlsfo').value) || 0;
  const addM = parseFloat(document.getElementById('reload-mgo').value) || 0;
  if (addV < 0 || addM < 0) { alert('Reloaded quantities cannot be negative.'); return; }
  if (addV <= 0 && addM <= 0) { alert('Enter at least one reloaded quantity greater than zero.'); return; }

  // From here on this reload is being recorded: a second click on Save
  // (double-click, slow connection) must find nothing left to record.
  _reloadBargeId = null;
  const saveBtn = document.querySelector('#reload-modal button[onclick="saveReloadQty()"]');
  if (saveBtn) saveBtn.disabled = true;
  try {
  const liveROBs = getAllLiveROBs();
  const rob = liveROBs[bargeId];
  const curV = rob ? rob.liveV : 0;
  const curM = rob ? rob.liveM : 0;
  const note = document.getElementById('reload-note').value.trim() || 'Reload';
  const ts = new Date().toISOString();

  // Record the reload as a dated EVENT (synced, merged by id) rather than an
  // absolute "current ROB" override: the old override replaced the computed
  // ROB outright, so every supply completed after the reload was silently
  // ignored, and the reload itself was lost on the next save. computeLiveROB
  // adds reload events chronologically among the supplies, and baking folds
  // them into the opening like supplies.
  if (!Array.isArray(_bargeReloads)) _bargeReloads = [];
  _bargeReloads.push({ id: 'rl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), bargeId: bargeId, v: addV, m: addM, at: Date.now(), by: ABPS_UID || '', note: note });

  const after = getAllLiveROBs()[bargeId];
  const newV = after ? after.liveV : Math.max(0, curV + addV);
  const newM = after ? after.liveM : Math.max(0, curM + addM);

  // Log it
  _robAuditLog.push({ bargeId, bargeName: b.name, field: 'RELOAD', oldVal: Math.round(curV), newVal: Math.round(newV), reason: note, editedAt: ts, editedBy: 'Reload' });
  if (addM > 0) _robAuditLog.push({ bargeId, bargeName: b.name, field: 'MGO RELOAD', oldVal: Math.round(curM), newVal: Math.round(newM), reason: note, editedAt: ts, editedBy: 'Reload' });

  // Also update _bargeStates so scheduler knows new ROB
  if (_bargeStates[bargeId]) { _bargeStates[bargeId].rv = newV; _bargeStates[bargeId].rm = newM; }

  await saveROBAudit();
  await saveSharedState();

  closeReloadModal();
  renderLiveROBDashboard();
  renderRemainingSupplyTracker();
  renderBargeROBSummaryFromLive();
  if (typeof _rlRefreshIfShown === 'function') _rlRefreshIfShown();

  // Confirmation
  showToast('Reload saved — ' + b.name + ': VLSFO ' + Math.round(newV).toLocaleString() + ' MT | MGO ' + Math.round(newM).toLocaleString() + ' MT', 'success');
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}
function openCalcParamsEdit() {
  document.getElementById('calc-hose-input').value   = _calcParams.hoseHrs;
  document.getElementById('calc-travel-input').value = _calcParams.travelHrs;
  document.getElementById('calc-contingency-input').value = _contingencyHrs();
  document.getElementById('calc-view').style.display  = 'none';
  document.getElementById('calc-edit').style.display  = '';
  const btn = document.getElementById('calc-edit-btn');
  if (btn) { btn.style.background='var(--amber-lt)'; btn.style.borderColor='var(--amber-bd)'; btn.style.color='var(--amber)'; btn.innerHTML='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Cancel'; btn.onclick=closeCalcParamsEdit; }
}
function closeCalcParamsEdit() {
  document.getElementById('calc-view').style.display  = '';
  document.getElementById('calc-edit').style.display  = 'none';
  const btn = document.getElementById('calc-edit-btn');
  if (btn) { btn.style.background=''; btn.style.borderColor=''; btn.style.color=''; btn.innerHTML='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit Parameters'; btn.onclick=openCalcParamsEdit; }
}
function saveCalcParamsEdit() {
  const h = parseFloat(document.getElementById('calc-hose-input').value);
  const t = parseFloat(document.getElementById('calc-travel-input').value);
  const c = parseFloat(document.getElementById('calc-contingency-input').value);
  if (isNaN(h)||h<0||isNaN(t)||t<0||isNaN(c)||c<0) { alert('Enter valid positive numbers for all fields.'); return; }
  _calcParams.hoseHrs   = h;
  _calcParams.travelHrs = t;
  _calcParams.contingencyHrs = c;
  saveCalcParams();
  // Push to the shared workspace now — otherwise the next cloud pull (e.g. a
  // reload) hands back the old values before anything else got saved.
  if (!isTrader() && typeof saveSharedState === 'function') { try { saveSharedState(); } catch(e) {} }
  renderCalcParamsView();
  closeCalcParamsEdit();
  const card = document.getElementById('calc-params-card');
  if (card) { card.style.transition='box-shadow .2s'; card.style.boxShadow='0 0 0 2px var(--green)'; setTimeout(()=>card.style.boxShadow='',1000); }
}
function renderCalcParamsView() {
  const h = _calcParams.hoseHrs, t = _calcParams.travelHrs;
  const hEl = document.getElementById('calc-view-hose');
  const tEl = document.getElementById('calc-view-travel');
  const fEl = document.getElementById('calc-view-formulas');
  if (hEl) hEl.textContent = h + (h===1?' hr':' hrs');
  if (tEl) tEl.textContent = t + (t===1?' hr':' hrs');
  const c = _contingencyHrs(), cEl = document.getElementById('calc-view-contingency');
  if (cEl) cEl.textContent = c + (c===1?' hr':' hrs');
  if (fEl) fEl.innerHTML = `ETC = Supply Start + ${h}h + (Qty ÷ TPH)<br>Next Start ≥ ETC + ${t}h travel<br>Free Windows / Availability: ETC + ${c}h contingency`;
}

function addBarge(def = {}) {
  // Keep a restored barge's own id (ids key manual ROB overrides, baked
  // supply ids, reloads and vessel assignments) — numbering by position
  // re-keyed everything whenever a barge was removed or order changed.
  let id = (def.id != null && def.id !== '' && !isNaN(Number(def.id))) ? Number(def.id) : ++bc;
  if (_barges.some(x => x.id === id)) id = Math.max(bc, ...(_barges.map(x => x.id))) + 1; // duplicate in legacy data
  bc = Math.max(bc, id);
  const name = def.name||`Barge ${id}`;
  const vcap=def.vcap??5000,mcap=def.mcap??1000,vrob=def.vrob??4500,mrob=def.mrob??900;
  const email=String(def.email||'').trim(); // the barge's (captain's) e-mail — pre-fills "Email to Barge"
  const vbuf=def.vbuf??500,mbuf=def.mbuf??150,vtph=def.vtph??300,mtph=def.mtph??100;
  const vrfr=def.vrfr??750,mrfr=def.mrfr??275;
  const colorKey = _bargeKeyOk(def.color) ? def.color : _bargeDefaultKey();
  const c=document.createElement('div');
  c.className='vcard barge-card';c.id=`barge-${id}`;c.style.marginTop='10px';
  c._newerFields = _newerBuildFields(def, _BARGE_KEYS); // saved back unchanged (see _newerBuildFields)
  c.innerHTML=`
  <div class="vcard-hdr">
    <span class="vnum barge-tag"> ${esc(name)}</span>
    <div style="display:flex;gap:6px;align-items:center">
      <input type="hidden" id="b${id}-color" value="${colorKey}">
      <span class="bg-sw-row" role="group" aria-label="Barge colour">${_BARGE_PALETTE.map(function(k, i) { return `<button type="button" class="bg-sw${k === colorKey ? ' on' : ''}" data-k="${k}" style="--bc:var(--barge-${i + 1})" title="${_BARGE_PALETTE_LABEL[k]}" aria-label="Barge colour ${_BARGE_PALETTE_LABEL[k]}" onclick="setBargeColor(${id},'${k}')"></button>`; }).join('')}</span>
      <input type="text" id="b${id}-name" value="${esc(name)}" style="font-size:12px;padding:5px 9px;border:none;box-shadow:var(--sh-in-xs);border-radius:6px;width:130px;font-family:DM Sans,sans-serif" oninput="renameBargeDropdowns()">
      <input type="email" id="b${id}-email" value="${esc(email)}" placeholder="Captain e-mail" title="The barge's e-mail address — fills the To line of Email to Barge" style="font-size:12px;padding:5px 9px;border:none;box-shadow:var(--sh-in-xs);border-radius:6px;width:170px;font-family:DM Sans,sans-serif" onchange="saveSharedState()">
      <button class="btn btn-secondary btn-sm" id="b${id}-edit-btn" onclick="toggleBargeEdit(${id})" style="gap:5px">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Edit
      </button>
      <button class="btn btn-secondary btn-sm" id="b${id}-hide-btn" onclick="toggleBargeParams(${id})" style="gap:5px">
        <svg id="b${id}-hide-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
        <span id="b${id}-hide-label">Hide</span>
      </button>
      <button class="rm-btn" onclick="confirmRemoveBarge(${id})"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Remove</button>
    </div>
  </div>

  <!-- ── VIEW MODE: compact summary strip ── -->
  <div id="b${id}-view" style="display:flex;flex-wrap:wrap;gap:8px;padding:10px 0 6px 0;align-items:center">
    <div style="display:flex;gap:6px;flex-wrap:wrap" id="b${id}-summary"></div>
  </div>

  <!-- ── EDIT MODE: full parameter fields ── -->
  <div id="b${id}-params" style="display:none">
    <div class="g4 mb10" style="margin-top:8px">
      <div class="field"><label>VLSFO Capacity (MT)</label><input type="number" id="b${id}-vcap" value="${esc(vcap)}" min="0" step="100" oninput="updateBargeView(${id})"></div>
      <div class="field"><label>MGO Capacity (MT)</label><input type="number" id="b${id}-mcap" value="${esc(mcap)}" min="0" step="100" oninput="updateBargeView(${id})"></div>
      <div class="field"><label>Opening VLSFO ROB (MT)</label><input type="number" id="b${id}-vrob" value="${esc(vrob)}" min="0" step="50" oninput="updateBargeView(${id})"></div>
      <div class="field"><label>Opening MGO ROB (MT)</label><input type="number" id="b${id}-mrob" value="${esc(mrob)}" min="0" step="50" oninput="updateBargeView(${id})"></div>
    </div>
    <div class="g4 mb10">
      <div class="field">
        <label>VLSFO Alert Buffer (MT) <span style="font-weight:400;color:var(--muted)">— refuel trigger</span></label>
        <input type="number" id="b${id}-vbuf" value="${esc(vbuf)}" min="0" step="50" oninput="updateBargeView(${id})">
      </div>
      <div class="field">
        <label>MGO Alert Buffer (MT) <span style="font-weight:400;color:var(--muted)">— refuel trigger</span></label>
        <input type="number" id="b${id}-mbuf" value="${esc(mbuf)}" min="0" step="50" oninput="updateBargeView(${id})">
      </div>
      <div class="field"><label>VLSFO Pump Rate (MT/hr) <span style="font-weight:400;color:var(--muted)">— vessel supply</span></label><input type="number" id="b${id}-vtph" value="${esc(vtph)}" min="1" step="10" oninput="updateBargeView(${id})"></div>
      <div class="field"><label>MGO Pump Rate (MT/hr) <span style="font-weight:400;color:var(--muted)">— vessel supply</span></label><input type="number" id="b${id}-mtph" value="${esc(mtph)}" min="1" step="10" oninput="updateBargeView(${id})"></div>
    </div>
    <div class="g4 mb10">
      <div class="field"><label>VLSFO Refill Rate (MT/hr) <span style="font-weight:400;color:var(--muted)">— barge refill</span></label><input type="number" id="b${id}-vrfr" value="${esc(vrfr)}" min="1" step="10" oninput="updateBargeView(${id})"></div>
      <div class="field"><label>MGO Refill Rate (MT/hr) <span style="font-weight:400;color:var(--muted)">— barge refill</span></label><input type="number" id="b${id}-mrfr" value="${esc(mrfr)}" min="1" step="10" oninput="updateBargeView(${id})"></div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:10px">
      <button class="btn btn-primary btn-sm" onclick="saveBargeEdit(${id})">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        Save Parameters
      </button>
      <button class="btn btn-secondary btn-sm" onclick="cancelBargeEdit(${id})">Cancel</button>
    </div>
  </div>

  <!-- ── REFILL PREVIEW (shown in both modes) ── -->
  <div id="b${id}-refill-preview" style="font-size:12px;background:var(--bg);border-radius:8px;padding:10px 14px;margin-top:4px;border:1px solid var(--border2)">
    <div style="font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--sub);margin-bottom:8px">Barge Refill Summary</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:8px" id="b${id}-refill-grid"></div>
  </div>`;

  document.getElementById('barge-list').appendChild(c);
  _barges.push({id});
  _paintBargeCard(id);
  populateBargeDropdowns();
  updateBargeView(id);   // build view-mode summary + refill preview
}

/* ── Barge card state helpers ── */
const _bargeEditMode = {}; // {id: bool}
const _bargeEditOpening = {}; // {id: {v, m}} — Opening ROB fields when Edit was opened
const _bargeHidden   = {}; // {id: bool}

function _chip(label, val, color) {
  return `<div style="background:var(--surface2);border:1px solid var(--border2);border-radius:7px;padding:5px 10px;display:flex;flex-direction:column;gap:1px">
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:700">${label}</div>
    <div style="font-size:12px;font-weight:700;color:${color||'var(--ink)'};font-family:DM Mono,monospace">${val}</div>
  </div>`;
}

function updateBargeView(id) {
  const vcap = parseFloat(document.getElementById(`b${id}-vcap`)?.value)||0;
  const mcap = parseFloat(document.getElementById(`b${id}-mcap`)?.value)||0;
  const vrob = parseFloat(document.getElementById(`b${id}-vrob`)?.value)||0;
  const mrob = parseFloat(document.getElementById(`b${id}-mrob`)?.value)||0;
  const vbuf = parseFloat(document.getElementById(`b${id}-vbuf`)?.value)||0;
  const mbuf = parseFloat(document.getElementById(`b${id}-mbuf`)?.value)||0;
  const vtph = parseFloat(document.getElementById(`b${id}-vtph`)?.value)||300;
  const mtph = parseFloat(document.getElementById(`b${id}-mtph`)?.value)||100;
  const vrfr = parseFloat(document.getElementById(`b${id}-vrfr`)?.value)||750;
  const mrfr = parseFloat(document.getElementById(`b${id}-mrfr`)?.value)||275;

  const summary = document.getElementById(`b${id}-summary`);
  if (summary) {
    const vPct = vcap > 0 ? Math.round((vrob/vcap)*100) : 0;
    const mPct = mcap > 0 ? Math.round((mrob/mcap)*100) : 0;
    const vColor = vPct < 20 ? 'var(--red)' : vPct < 40 ? 'var(--amber)' : 'var(--green)';
    const mColor = mPct < 20 ? 'var(--red)' : mPct < 40 ? 'var(--amber)' : 'var(--green)';
    summary.innerHTML =
      _chip('VLSFO Cap', vcap.toLocaleString()+' MT') +
      _chip('VLSFO ROB', vrob.toLocaleString()+' MT ('+vPct+'%)', vColor) +
      _chip('MGO Cap', mcap.toLocaleString()+' MT') +
      _chip('MGO ROB', mrob.toLocaleString()+' MT ('+mPct+'%)', mColor) +
      _chip('VLSFO Buffer', vbuf.toLocaleString()+' MT') +
      _chip('MGO Buffer', mbuf.toLocaleString()+' MT') +
      _chip('VLSFO Pump', vtph+' MT/hr') +
      _chip('MGO Pump', mtph+' MT/hr') +
      _chip('VLSFO Refill', vrfr+' MT/hr') +
      _chip('MGO Refill', mrfr+' MT/hr');
  }
  // Always update refill preview too
  updateRefillPreview(id);
}

function toggleBargeEdit(id) {
  const paramsEl = document.getElementById(`b${id}-params`);
  const viewEl   = document.getElementById(`b${id}-view`);
  const editBtn  = document.getElementById(`b${id}-edit-btn`);
  const isEditing = _bargeEditMode[id];
  if (isEditing) {
    cancelBargeEdit(id); return;
  }
  _bargeEditMode[id] = true;
  _bargeEditOpening[id] = { v: parseFloat(document.getElementById(`b${id}-vrob`)?.value) || 0, m: parseFloat(document.getElementById(`b${id}-mrob`)?.value) || 0 };
  if (paramsEl) paramsEl.style.display = '';
  if (viewEl)   viewEl.style.display   = 'none';
  if (editBtn)  editBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Cancel`;
  editBtn.style.background   = 'var(--amber-lt)';
  editBtn.style.borderColor  = 'var(--amber-bd)';
  editBtn.style.color        = 'var(--amber)';
  // Also un-hide params section if user had hidden it
  if (_bargeHidden[id]) { toggleBargeParams(id); }
}

function saveBargeEdit(id) {
  _bargeEditMode[id] = false;
  const paramsEl = document.getElementById(`b${id}-params`);
  const viewEl   = document.getElementById(`b${id}-view`);
  const editBtn  = document.getElementById(`b${id}-edit-btn`);
  if (paramsEl) paramsEl.style.display = 'none';
  if (viewEl)   viewEl.style.display   = '';
  if (editBtn) {
    editBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit`;
    editBtn.style.background  = '';
    editBtn.style.borderColor = '';
    editBtn.style.color       = '';
  }
  updateBargeView(id);

  // Two-way ROB sync: editing the Opening ROB here is a fresh declaration of
  // truth for this barge, so clear any older manual override from the Live
  // Barge ROB Summary panel — otherwise that panel would keep showing its
  // own stale override instead of the value just entered here. Only when the
  // Opening ROB was actually changed: saving a buffer, rate or capacity must
  // not throw away a dip correction made with "Update ROB".
  const newVrob = parseFloat(document.getElementById(`b${id}-vrob`)?.value) || 0;
  const newMrob = parseFloat(document.getElementById(`b${id}-mrob`)?.value) || 0;
  const cfgNow = (_bargeConfig || []).find(x => x.id == id);
  const wasOpening = _bargeEditOpening[id] || (cfgNow ? { v: cfgNow.vrob, m: cfgNow.mrob } : null);
  delete _bargeEditOpening[id];
  const openingChanged = !wasOpening || newVrob !== wasOpening.v || newMrob !== wasOpening.m;
  if (_manualROB && openingChanged) {
    delete _manualROB[id + '_final'];
    delete _manualROB[id + '_pre'];
  }
  // …and it already holds the supplies baked so far: correcting one of them
  // later must not move this figure.
  if (openingChanged) _robMeasured(id, !wasOpening ? null : [newVrob !== wasOpening.v ? 'v' : '', newMrob !== wasOpening.m ? 'm' : ''].filter(Boolean));
  if (_bargeConfig) {
    const bc = _bargeConfig.find(x => x.id == id);
    if (bc) { bc.vrob = newVrob; bc.mrob = newMrob; }
  }
  if (_bargeStates && _bargeStates[id]) {
    _bargeStates[id].rv = newVrob;
    _bargeStates[id].rm = newMrob;
  }
  saveManualROB();
  saveSharedState();
  // Refresh the Live Barge ROB Summary so it immediately reflects this change
  if (typeof renderLiveROBDashboard === 'function') renderLiveROBDashboard();
  if (typeof renderRemainingSupplyTracker === 'function') renderRemainingSupplyTracker();

  // Flash confirmation
  const card = document.getElementById(`barge-${id}`);
  if (card) {
    card.style.transition = 'box-shadow .2s';
    card.style.boxShadow  = '0 0 0 2px var(--green)';
    setTimeout(() => { card.style.boxShadow = ''; }, 1000);
  }
}

function cancelBargeEdit(id) {
  _bargeEditMode[id] = false;
  const paramsEl = document.getElementById(`b${id}-params`);
  const viewEl   = document.getElementById(`b${id}-view`);
  const editBtn  = document.getElementById(`b${id}-edit-btn`);
  if (paramsEl) paramsEl.style.display = 'none';
  if (viewEl)   viewEl.style.display   = '';
  if (editBtn) {
    editBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit`;
    editBtn.style.background  = '';
    editBtn.style.borderColor = '';
    editBtn.style.color       = '';
  }
}

function toggleBargeParams(id) {
  const viewEl  = document.getElementById(`b${id}-view`);
  const refill  = document.getElementById(`b${id}-refill-preview`);
  const hideBtn = document.getElementById(`b${id}-hide-btn`);
  const hideIcon = document.getElementById(`b${id}-hide-icon`);
  const hideLbl = document.getElementById(`b${id}-hide-label`);
  const isHidden = _bargeHidden[id];
  _bargeHidden[id] = !isHidden;
  if (_bargeHidden[id]) {
    if (viewEl)  viewEl.style.display  = 'none';
    if (refill)  refill.style.display  = 'none';
    if (hideLbl) hideLbl.textContent   = 'Show';
    if (hideIcon) hideIcon.innerHTML   = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
    if (hideBtn) { hideBtn.style.background='var(--azure-lt)'; hideBtn.style.borderColor='var(--azure-bd)'; hideBtn.style.color='var(--azure)'; }
  } else {
    if (viewEl)  viewEl.style.display  = '';
    if (refill)  refill.style.display  = '';
    if (hideLbl) hideLbl.textContent   = 'Hide';
    if (hideIcon) hideIcon.innerHTML   = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>';
    if (hideBtn) { hideBtn.style.background=''; hideBtn.style.borderColor=''; hideBtn.style.color=''; }
  }
}

function updateRefillPreview(id) {
  const vcap=parseFloat(document.getElementById(`b${id}-vcap`)?.value)||0,mcap=parseFloat(document.getElementById(`b${id}-mcap`)?.value)||0;
  const vrob=parseFloat(document.getElementById(`b${id}-vrob`)?.value)||0,mrob=parseFloat(document.getElementById(`b${id}-mrob`)?.value)||0;
  const vrfr=parseFloat(document.getElementById(`b${id}-vrfr`)?.value)||750,mrfr=parseFloat(document.getElementById(`b${id}-mrfr`)?.value)||275;
  const grid=document.getElementById(`b${id}-refill-grid`);if(!grid)return;
  const vUllage=Math.max(0,vcap-vrob),mUllage=Math.max(0,mcap-mrob);
  const vRefillHrs=vrfr>0?vUllage/vrfr:0,mRefillHrs=mrfr>0?mUllage/mrfr:0;
  const cell=(label,val,sub)=>`<div style="background:var(--surface);border-radius:6px;padding:7px 10px;border:1px solid var(--border2)"><div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;font-weight:700">${label}</div><div style="font-size:13px;font-weight:600;color:var(--ink);font-family:DM Mono,monospace">${val}</div>${sub?`<div style="font-size:10px;color:var(--muted);margin-top:2px">${sub}</div>`:''}</div>`;
  grid.innerHTML=cell('VLSFO ROB',vrob.toLocaleString()+' MT',`Cap: ${vcap.toLocaleString()} MT`)+cell('VLSFO Ullage',vUllage.toLocaleString()+' MT','to fill')+cell('VLSFO Refill',vUllage>0?durStr(vRefillHrs):'—',`@ ${vrfr} MT/hr`)+cell('MGO Ullage',mUllage.toLocaleString()+' MT','to fill')+cell('MGO Refill',mUllage>0?durStr(mRefillHrs):'—',`@ ${mrfr} MT/hr`);
}

function rmBarge(id) {
  const name = (document.getElementById(`b${id}-name`)?.value || '').trim();
  document.getElementById(`barge-${id}`)?.remove(); _barges=_barges.filter(b=>b.id!==id);
  // What hangs off this barge's id goes with it: after a reload a barge added
  // later can be given the same id, and would otherwise inherit the removed
  // barge's ROB correction and Unavailable blocks. (Its reload events are
  // dropped by captureCurrentState with the barge.) Its baked-supply list
  // stays: such a barge, under the same name, matches the old records, and
  // the list keeps them from being deducted from its new opening again — and
  // (marked measured now) later corrections of those records move nothing.
  if (_manualROB) Object.keys(_manualROB).forEach(k => { if (k.startsWith(id + '_')) delete _manualROB[k]; });
  _robMeasured(id);
  const gone = new Set(_blocksForBarge(id, name).map(bk => bk.id));
  if (gone.size) _bargeBlocks = _bargeBlocks.filter(bk => !gone.has(bk && bk.id));
  try { localStorage.setItem('abps_manual_rob_v1', JSON.stringify(_manualROB || {})); } catch(e) {}
  populateBargeDropdowns(); saveSharedState();
}
// The card's Remove button: removing a barge is synced to every device and
// cannot be undone, so say what goes with it first.
function confirmRemoveBarge(id) {
  const name = (document.getElementById(`b${id}-name`)?.value || `Barge ${id}`).trim();
  const pinned = Array.from(document.querySelectorAll('[id^="v"][id$="-barge"]')).filter(s => s.value === String(id)).length;
  const reloads = (_bargeReloads || []).filter(rl => String(rl.bargeId) === String(id) && rl.kind !== 'correction').length;
  const blocks = _blocksForBarge(id, name).length;
  const hasFix = _hasManualOverride(id);
  const lost = [];
  if (pinned) lost.push(pinned + ' nomination' + (pinned === 1 ? '' : 's') + ' assigned to it go back to Auto');
  if (reloads) lost.push('its ' + reloads + ' recorded reload' + (reloads === 1 ? '' : 's') + ' are deleted');
  if (hasFix) lost.push('its manual ROB correction is deleted');
  if (blocks) lost.push('its ' + blocks + ' Unavailable block' + (blocks === 1 ? '' : 's') + ' are deleted');
  if (!confirm('Remove barge "' + name + '" for everyone?\n\n' + (lost.length ? '• ' + lost.join('\n• ') + '\n\n' : '') + 'Saved supply records are kept. This cannot be undone.')) return;
  rmBarge(id);
}
function renameBargeDropdowns() { populateBargeDropdowns(); clearTimeout(upd._t); upd._t=setTimeout(saveSharedState,1500); }
/* ── Barge colours ──────────────────────────────────────────────────────
   Each barge has one identity colour (a palette KEY, saved with the barge and synced).
   Colour = which barge; fuel colours stay on volumes, status colours on status. Only keys
   from the palette are ever turned into CSS, so a synced value can't inject anything. */
const _BARGE_PALETTE = ['violet', 'pink', 'slate', 'olive', 'brown'];
const _BARGE_PALETTE_LABEL = { violet: 'Violet', pink: 'Pink', slate: 'Slate', olive: 'Olive', brown: 'Brown' };
let _bargeColorReserve = null; // while barges load: keys the incoming state already assigns
function _bargeKeyOk(k) { return _BARGE_PALETTE.indexOf(k) >= 0; }
// Default for a barge with none: the first palette colour no other barge uses (same order on every device).
function _bargeDefaultKey() {
  const used = new Set(_bargeColorReserve ? Array.from(_bargeColorReserve) : []);
  (_barges || []).forEach(function(b) { const el = document.getElementById('b' + b.id + '-color'); if (el && el.value) used.add(el.value); });
  return _BARGE_PALETTE.find(function(k) { return !used.has(k); }) || _BARGE_PALETTE[((_barges || []).length) % _BARGE_PALETTE.length];
}
// barge name → palette key, from the barge cards on this device
function _bargeColorMap() {
  const m = new Map();
  (_barges || []).forEach(function(b) {
    const nm = String((document.getElementById('b' + b.id + '-name') || {}).value || '').trim();
    const k = (document.getElementById('b' + b.id + '-color') || {}).value;
    if (nm && _bargeKeyOk(k) && !m.has(nm)) m.set(nm, k);
  });
  return m;
}
function _bargeVars(key) { const i = _BARGE_PALETTE.indexOf(key) + 1; return i ? '--bc:var(--barge-' + i + ');--bc-lt:var(--barge-' + i + '-lt)' : ''; }
// inline-style declarations ('' for an unknown barge)
function _bargeStyle(name, map) { return _bargeVars((map || _bargeColorMap()).get(String(name == null ? '' : name).trim())); }
// ` data-bc="1" style="…"` for an element that has no style attribute of its own
function _bargeAttrs(name, map) { const st = _bargeStyle(name, map); return st ? ' data-bc="1" data-bgn="' + esc(String(name == null ? '' : name).trim()) + '" style="' + st + '"' : ''; }
// a small coloured dot before a barge name in lists and tables
function _bargeDot(name, map) { const st = _bargeStyle(name, map); return st ? '<span class="bg-dot" data-bgn="' + esc(String(name == null ? '' : name).trim()) + '" style="' + st + '"></span>' : ''; }
// The fleet as configured right now: the ROB engine's copy once the schedule has been generated,
// before that the barge cards (the `_barges` entries only carry ids — no names).
function _fleetNow() { return (_bargeConfig && _bargeConfig.length) ? _bargeConfig : getBarges(); }
// A pill with the barge's name in its colour, for cards that must say WHICH barge. A barge that is not
// on a card here keeps a plain pill, and a record with no barge says so.
function _bargePill(name, map, cls) {
  const nm = String(name == null ? '' : name).trim(), c = cls ? ' ' + cls : '';
  if (!nm || nm === 'Unassigned') return '<span class="bg-pill none' + c + '">No barge</span>';
  const st = _bargeStyle(nm, map);
  return st ? '<span class="bg-pill' + c + '" data-bc="1" data-bgn="' + esc(nm) + '" style="' + st + '"><span class="bg-dot"></span>' + esc(nm) + '</span>'
            : '<span class="bg-pill none' + c + '">' + esc(nm) + '</span>';
}
function setBargeColor(id, key) {
  if (!_bargeKeyOk(key)) return;
  const inp = document.getElementById('b' + id + '-color'); if (!inp) return;
  inp.value = key;
  _paintBargeCard(id);
  _refreshBargeColours();
  clearTimeout(upd._t); upd._t = setTimeout(saveSharedState, 600);
}
function _paintBargeCard(id) {
  const card = document.getElementById('barge-' + id), inp = document.getElementById('b' + id + '-color');
  if (!card || !inp) return;
  const st = _bargeVars(inp.value);
  if (st) { card.setAttribute('data-bc', '1'); card.setAttribute('style', 'margin-top:10px;' + st); }
  card.querySelectorAll('.bg-sw').forEach(function(sw) { sw.classList.toggle('on', sw.getAttribute('data-k') === inp.value); });
}
// A colour change recolours what is already on screen, in place: every coloured element carries its
// barge name (data-bgn) and takes the colour from the barge cards. Nothing is redrawn, so what
// someone is typing, the barge tab they chose and their Print ticks are untouched.
function _repaintBargeColours() {
  const map = _bargeColorMap();
  document.querySelectorAll('[data-bgn]').forEach(function(el) {
    const i = _BARGE_PALETTE.indexOf(map.get(String(el.getAttribute('data-bgn') || '').trim())) + 1;
    if (!i) return;
    el.style.setProperty('--bc', 'var(--barge-' + i + ')');
    el.style.setProperty('--bc-lt', 'var(--barge-' + i + '-lt)');
  });
}
function _refreshBargeColours() { _repaintBargeColours(); }
function getBarges() {
  return _barges.map(b=>{
    const id=b.id;
    return{id,name:(document.getElementById(`b${id}-name`)?.value||`Barge ${id}`).trim(),vcap:parseFloat(document.getElementById(`b${id}-vcap`)?.value)||5000,mcap:parseFloat(document.getElementById(`b${id}-mcap`)?.value)||1000,vrob:parseFloat(document.getElementById(`b${id}-vrob`)?.value)||0,mrob:parseFloat(document.getElementById(`b${id}-mrob`)?.value)||0,vbuf:parseFloat(document.getElementById(`b${id}-vbuf`)?.value)||500,mbuf:parseFloat(document.getElementById(`b${id}-mbuf`)?.value)||150,vtph:parseFloat(document.getElementById(`b${id}-vtph`)?.value)||300,mtph:parseFloat(document.getElementById(`b${id}-mtph`)?.value)||100,vrfr:parseFloat(document.getElementById(`b${id}-vrfr`)?.value)||750,mrfr:parseFloat(document.getElementById(`b${id}-mrfr`)?.value)||275,color:(document.getElementById(`b${id}-color`)?.value)||'',email:(document.getElementById(`b${id}-email`)?.value||'').trim()};
  });
}
/* ─── SUPPLY SEQUENCE CLASSIFIER ─── */
/*
  Rules:
  • gap >= 24 hrs  → "On Arrival"
  • gap <= 4 hrs   → "After [Prev Vessel Name]"  (tight scheduling)
  • 4 < gap < 24   → "After [Prev Vessel Name]" with timed window
  First vessel in sequence always = "On Arrival"
*/
function classifySeq(item, idx, items) {
  if (idx === 0) return { label: 'On Arrival', type: 'arrival', prevName: null };
  const prev  = items[idx - 1];
  if (!prev || !prev.etc || !item.bargeStart) return { label: 'On Arrival', type: 'arrival', prevName: null };
  const gapHrs = (item.bargeStart - prev.etc) / 3600000;
  if (gapHrs >= 24) {
    return { label: 'On Arrival', type: 'arrival', prevName: prev.name };
  }
  // <= 24 hrs gap → "After [Vessel Name]"
  return { label: 'After ' + prev.name, type: 'after', prevName: prev.name, gapHrs: gapHrs };
}

/* ─── BARGE DROPDOWNS on the nomination cards ─── */
function populateBargeDropdowns() {
  const barges = getBarges();
  document.querySelectorAll('[id^="v"][id$="-barge"]').forEach(sel => {
    // Keep each card's own choice; '' (Auto) stays Auto. (A remembered
    // "preferred barge" used to fill every Auto card here, silently pinning
    // the whole register to one barge on the next save.)
    const cur = sel.value || '';
    const selectVal = cur && barges.find(b => String(b.id) === cur) ? cur : '';
    sel.innerHTML = '<option value="">Auto (any barge)</option>' +
      barges.map(b => '<option value="' + esc(b.id) + '"' + (String(b.id) === selectVal ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('');
    sel.onchange = function() { saveSharedState(); };
  });
}

/* ─── FLATPICKR ─── */
const _lcPickers={}, _etaPickers={};
function openLaycanPicker(id) {
  const inp=document.getElementById(`v${id}-lc`);if(!inp)return;
  if(_lcPickers[id]){_lcPickers[id].open();return;}
  _lcPickers[id]=flatpickr(inp,{mode:'range',dateFormat:'j M Y',allowInput:false,disableMobile:true,minDate:'2026-01-01',
    onReady(_,__,fp){fp.open();},
    onChange(dates,dateStr){
      if(dates.length===2){
        const d1=dates[0],d2=dates[1];
        if(d1.getMonth()===d2.getMonth()&&d1.getFullYear()===d2.getFullYear()){inp.value=`${d1.getDate()}-${d2.getDate()} ${MO[d1.getMonth()]} ${d1.getFullYear()}`;}
        else{inp.value=`${d1.getDate()} ${MO[d1.getMonth()]} ${d1.getFullYear()} - ${d2.getDate()} ${MO[d2.getMonth()]} ${d2.getFullYear()}`;}
        upd(id);
      }
    }});
  if(inp.value){const lc=parseLaycan(inp.value);if(lc){try{_lcPickers[id].setDate([lc.from,lc.to]);}catch(e){}}}
  _lcPickers[id].open();
}
function openETAPicker(id) {
  const inp=document.getElementById(`v${id}-eta`);if(!inp)return;
  // "Time frame only" ticked: pick the DATE only — the time is the frame's start.
  const win=_cardEtaWin(id);
  if(_etaPickers[id]&&_etaPickers[id]._flowWin!==win){try{_etaPickers[id].destroy();}catch(e){} delete _etaPickers[id]; inp.setAttribute('readonly','readonly');}
  if(_etaPickers[id]){_etaPickers[id].open();return;}
  // flatpickr rewrites the box in its own format when it is created and on
  // setDate — with the date-only format that would drop the frame's start
  // time (a silent local edit). Keep the full value and put it back.
  const keep=inp.value;
  const restore=function(){if(!keep)return;const w=_cardEtaWin(id),d=parseDT(keep);inp.value=(w&&d)?_etaPickerStr(_etaFrameStart(d,w)):keep;};
  _etaPickers[id]=flatpickr(inp,{enableTime:!win,time_24hr:true,dateFormat:win?'j M Y':'j M Y H:i',allowInput:false,minuteIncrement:30,disableMobile:true,minDate:'2026-01-01',
    onReady(_,__,fp){fp.open();},
    onClose(){const w=_cardEtaWin(id);if(!w)return;const d=parseDT(inp.value);if(d){const v=_etaPickerStr(_etaFrameStart(d,w));if(inp.value!==v)inp.value=v;}},
    onChange(dates){if(dates.length===1){let d=dates[0];const w=_cardEtaWin(id);if(w)d=_etaFrameStart(d,w);inp.value=_etaPickerStr(d);upd(id);}}});
  _etaPickers[id]._flowWin=win;
  restore();
  if(keep){const eta=parseDT(keep);if(eta){try{_etaPickers[id].setDate(eta,false);}catch(e){}}}
  restore();
  inp.setAttribute('readonly','readonly');
  _etaPickers[id].open();
}

let _reportFromPicker=null,_reportToPicker=null;
function openReportFromPicker(){const inp=document.getElementById('report-from');if(!inp)return;if(_reportFromPicker){_reportFromPicker.open();return;}_reportFromPicker=flatpickr(inp,{dateFormat:'j M Y',allowInput:false,disableMobile:true,minDate:'2026-01-01',onReady(_,__,fp){fp.open();},onChange(){renderMonthlyPreview();}});_reportFromPicker.open();}
function openReportToPicker(){const inp=document.getElementById('report-to');if(!inp)return;if(_reportToPicker){_reportToPicker.open();return;}_reportToPicker=flatpickr(inp,{dateFormat:'j M Y',allowInput:false,disableMobile:true,minDate:'2026-01-01',onReady(_,__,fp){fp.open();},onChange(){renderMonthlyPreview();}});_reportToPicker.open();}

