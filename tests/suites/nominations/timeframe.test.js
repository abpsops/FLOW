/* ETA time frames ("ETA 16 Oct AM") on nominations and Loadings.
   A vessel card can be ticked "Time frame only": the date is picked and a
   frame chosen (EAM 00–06, AM 06–12, NOON 11–13, PM 12–18, LPM 18–24).
   Stored as vessel.etaWin (Loading: record.startWin), only when set; the
   ETA string stays "date + frame start" so every reader keeps working.
   Planning: barge ready from the frame START, committed until the frame
   END + the normal supply time. A frame is never "no firm ETA" (EAM starts
   at 00:00). The import parser reads frames from pasted text.
   node suites/nominations/timeframe.test.js [appDir] */
const fs = require('fs');
const XLSX = require('xlsx');
const H = require('../../harness/harness.js');
const U = require('../r3/util.js');
const appDir = process.argv[2] || H.APP_DIR;

let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) pass++; else fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 500)));
}
const HELPERS = () => {
  const p = n => String(n).padStart(2, '0');
  window.__fmt = function (d) { return p(d.getDate()) + ' ' + MO[d.getMonth()] + ' ' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
  // midnight, `days` days from today
  window.__day = function (days) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days); return d; };
  window.__dt = function (days, h, mi) { const d = __day(days); d.setHours(h, mi || 0, 0, 0); return d; };
  window.__reset = function () {
    const o = document.getElementById('flow-welcome-overlay'); if (o) o.style.display = 'none';
    document.querySelectorAll('.vcard[id^="vessel-"]').forEach(c => c.remove());
    (_barges || []).slice().forEach(b => rmBarge(b.id));
    _lastSched = []; _checklistRecords = {}; _savedSupplies = []; _deliveryLog = {}; _loadingRecords = []; _bargeBlocks = []; _bargeReloads = []; _manualROB = {};
    _calcParams.travelHrs = 1; _calcParams.hoseHrs = 6; _calcParams.contingencyHrs = 1;
    _loadingConfig = { rateVLSFO: 300, rateLSMGO: 150 };
  };
  window.__barge = function (def) { addBarge(Object.assign({ vcap: 5000, mcap: 1000, vrob: 4000, mrob: 800, vbuf: 0, mbuf: 0, vtph: 300, mtph: 100 }, def)); return _barges[_barges.length - 1].id; };
  window.__vessel = function (def) {
    addVessel(Object.assign({ area: 'FUJ-A', lc: '', paq: 'no', type: 'VLSFO', qty: 600, mgo: 0 }, def));
    const cards = document.querySelectorAll('.vcard[id^="vessel-"]');
    return cards[cards.length - 1].id.replace('vessel-', '');
  };
  // Tick / untick the card's "Time frame only" box and pick a frame, as a user would.
  window.__frame = function (id, code) {
    const chk = document.getElementById('v' + id + '-etawin-chk'), sel = document.getElementById('v' + id + '-etawin');
    if (!code) { chk.checked = false; chk.dispatchEvent(new Event('change', { bubbles: true })); return; }
    if (!chk.checked) { chk.checked = true; chk.dispatchEvent(new Event('change', { bubbles: true })); }
    sel.value = code; sel.dispatchEvent(new Event('change', { bubbles: true }));
  };
  window.__cap = function (id) { const c = document.getElementById('vessel-' + id); return captureCurrentState().vessels.find(v => v.nomUid === c.dataset.nomUid); };
  window.__item = name => _lastSched.find(i => i.name === name);
};

async function scenario(browser, name, fn, opts) {
  const db = H.createDb();
  const app = await H.openApp(browser, db, Object.assign({ appDir, uid: 'user-operator' }, opts || {}));
  await app.page.evaluate(HELPERS);
  await app.page.evaluate(() => __reset());
  try { await fn(app.page, app, db); }
  catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
  const errs = app.errors.filter(e => !/capacitorExports/.test(e));
  check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
  await app.ctx.close();
}

(async () => {
  const browser = await H.launch();

  await scenario(browser, 'T1 frame table + formatting', async (page) => {
    const r = await page.evaluate(() => ({
      codes: ETA_TIME_FRAMES.map(f => f.code + ':' + f.from + '-' + f.to).join(' '),
      opts: (() => { const s = document.createElement('select'); s.innerHTML = _etaFrameOptionsHTML('PM'); return Array.from(s.options).map(o => o.textContent + (o.selected ? '*' : '')); })(),
      full: _fmtEtaWin(new Date(2026, 9, 16, 6, 0), 'AM'),
      eam: _fmtEtaWin('16 Oct 2026 00:00', 'EAM'),
      none: _fmtEtaWin(new Date(2026, 9, 16, 6, 30), ''), noneWant: fmt24(new Date(2026, 9, 16, 6, 30)),
      short: _fmtEtaWinShort(new Date(2026, 9, 16, 18), 'LPM'),
      lpmEnd: _etaFrameEnd(new Date(2026, 9, 16, 9, 30), 'LPM').toString(),
      bogus: _etaFrame('<b>'), hrs: ['EAM', 'AM', 'NOON', 'PM', 'LPM'].map(_etaFrameHrs),
      forHour: [0, 5, 6, 11, 12, 17, 18, 23].map(_etaFrameForHour).join(' ')
    }));
    check('T1 five frames with their hours', r.codes === 'EAM:0-6 AM:6-12 NOON:11-13 PM:12-18 LPM:18-24', r.codes);
    check('T1 every option label shows its hours', r.opts.length === 5 && r.opts[0] === 'EAM — Early AM 00:00–06:00' && r.opts[2] === 'NOON — Noon 11:00–13:00' && r.opts[3] === 'PM — Afternoon 12:00–18:00*' && r.opts[4] === 'LPM — Late PM 18:00–24:00', r.opts);
    check('T1 display "16 Oct 2026 AM (06:00–12:00)"', r.full === '16 Oct 2026 AM (06:00–12:00)' && r.eam === '16 Oct 2026 EAM (00:00–06:00)', [r.full, r.eam]);
    check('T1 no frame = the usual date & time', r.none === r.noneWant && /06:30/.test(r.none), r.none);
    check('T1 compact "16 Oct LPM"', r.short === '16 Oct LPM', r.short);
    check('T1 LPM ends at midnight (next day 00:00)', /Sat Oct 17 2026 00:00/.test(r.lpmEnd), r.lpmEnd);
    check('T1 ticking picks the frame holding the hour (NOON only when chosen)', r.forHour === 'EAM EAM AM AM PM PM LPM LPM', r.forHour);
    check('T1 unknown codes are ignored', r.bogus === null && r.hrs.join(',') === '6,6,2,6,6', r);
  });

  await scenario(browser, 'T2 card checkbox + select', async (page) => {
    const r = await page.evaluate(() => {
      const b = __barge({ name: 'B1' });
      const D = __dt(2, 8, 30);
      const id = __vessel({ name: 'FRAME ONE', eta: __fmt(D), bargeId: b });
      const g = s => document.getElementById('v' + id + '-' + s);
      const out = { selHidden0: g('etawin').hidden, cap0: __cap(id) };
      __frame(id, 'AM');
      out.afterTick = { eta: g('eta').value, sel: g('etawin').value, hidden: g('etawin').hidden, cap: __cap(id) };
      __frame(id, 'PM');
      out.pm = { eta: g('eta').value, cap: __cap(id), het: g('het').textContent, prev: g('prev').textContent };
      // the ETA picker is date-only while a frame is ticked; picking a day keeps the frame start
      openETAPicker(+id);
      const fp = _etaPickers[id];
      out.pickerTime = fp.config.enableTime;
      fp.setDate(__dt(3, 15, 0), true);
      fp.close();
      out.picked = g('eta').value;
      __frame(id, '');
      out.untick = { eta: g('eta').value, hidden: g('etawin').hidden, cap: __cap(id), het: g('het').textContent };
      openETAPicker(+id); out.pickerTime2 = _etaPickers[id].config.enableTime; _etaPickers[id].close();
      out.D = __fmt(__dt(2, 6)); out.D12 = __fmt(__dt(2, 12)); out.D3 = __fmt(__dt(3, 12));
      out.etcExpect = fmt24(new Date(__dt(2, 18).getTime() + (6 + 2) * 3600000));
      return out;
    });
    check('T2 select hidden until ticked; untouched card stores no etaWin', r.selHidden0 && !('etaWin' in r.cap0), r.cap0);
    check('T2 ticking picks the frame holding the time (08:30 → AM) and moves ETA to 06:00', r.afterTick.sel === 'AM' && r.afterTick.eta === r.D && !r.afterTick.hidden && r.afterTick.cap.etaWin === 'AM' && r.afterTick.cap.eta === r.D, r.afterTick);
    check('T2 choosing PM → etaWin PM, ETA = date 12:00', r.pm.cap.etaWin === 'PM' && r.pm.eta === r.D12 && r.pm.cap.eta === r.D12, r.pm);
    check('T2 echo line shows "… PM (12:00–18:00)"', /→ \d\d \w{3} \d{4} PM \(12:00–18:00\)$/.test(r.pm.het), r.pm.het);
    check('T2 ETA→ETC strip: frame + latest ETC = frame end + supply', /PM \(12:00–18:00\)/.test(r.pm.prev) && r.pm.prev.includes(r.etcExpect) && /latest/.test(r.pm.prev) && /6h frame \+ 8h supply/.test(r.pm.prev), [r.pm.prev, r.etcExpect]);
    check('T2 picker is date-only in frame mode and keeps the frame start', r.pickerTime === false && r.picked === r.D3, [r.pickerTime, r.picked, r.D3]);
    check('T2 unticking restores a normal date & time entry', r.untick.hidden && !('etaWin' in r.untick.cap) && r.untick.eta === r.D3 && r.pickerTime2 === true && !/PM/.test(r.untick.het), r.untick);
  });

  await scenario(browser, 'T3 schedule: frame start → frame end + supply', async (page, app) => {
    const r = await page.evaluate(async () => {
      const b = __barge({ name: 'B1' });
      const A = __vessel({ name: 'FRAMED', eta: __fmt(__dt(2, 9)), qty: 600, bargeId: b, agent: 'AG' });
      __frame(A, 'AM');
      // a firm vessel arriving inside A's frame, on the same barge
      __vessel({ name: 'INSIDE', eta: __fmt(__dt(2, 10)), qty: 300, bargeId: b });
      calculate();
      const a = __item('FRAMED'), x = __item('INSIDE');
      const D = x => new Date(x).getTime();
      const out = {
        a: { start: D(a.bargeStart), etc: D(a.etc), win: a.etaWin, nf: a.noFirmETA, hrs: a.totalHrs },
        x: { start: D(x.bargeStart), waited: x.waitedForBarge },
        want: { start: __dt(2, 6).getTime(), etc: __dt(2, 20).getTime(), xStart: __dt(2, 21).getTime() }
      };
      // Free Windows / stock projection / loading conflict all read the same occupancy
      const fw = computeFreeWindows(b, 'B1', __day(1), __day(5));
      out.fwFreeInside = fw.filter(w => w.status === 'free' && w.start < __dt(2, 20) && w.end > __dt(2, 6)).length;
      out.fwBusy = fw.filter(w => w.status === 'busy' && /FRAMED/.test(w.label)).map(w => [D(w.rawStart), D(w.rawEnd)]);
      const proj = _bargeStockProjection(b, 'B1', __day(6));
      out.proj = proj.items.filter(i => i.vessel === 'FRAMED').map(i => [D(i.start), D(i.end)]);
      // Availability Check reads _getBargeTimeline: same start/ETC
      out.tlOps = _getBargeTimeline(b, 'B1', true).filter(o => o.vessel === 'FRAMED').map(o => [D(o.start), D(o.etc)]);
      document.getElementById('nsc-vessel-name').value = 'ASKER';
      document.getElementById('nsc-req-v').value = '200'; document.getElementById('nsc-req-m').value = '';
      document.getElementById('nsc-vessel-eta').value = __fmt(__dt(2, 13));
      checkNSCUnified();
      out.nsc = document.getElementById('nsc-unified-result').textContent;
      out.conflict = _checkLoadingConflict('B1', __dt(2, 14).toISOString(), __dt(2, 16).toISOString(), null);
      out.conflictAfter = _checkLoadingConflict('B1', __dt(3, 12).toISOString(), __dt(3, 13).toISOString(), null);
      // displays
      out.voy = document.getElementById('voy-barge-tabs').textContent;
      out.tl = document.getElementById('tl').textContent;
      out.tlTag = !!document.querySelector('#tl .tf-tag');
      renderWeekCalendar(0); out.cal = document.getElementById('week-calendar').innerHTML;
      renderChecklist(_lastSched); out.cl = document.getElementById('checklist-rows').textContent;
      out.clRec = Object.values(_checklistRecords).find(c => c.vessel === 'FRAMED').etaWin;
      out.msg = _generateBunkerMsg(a, 'vlsfo', 'arrival', '', 'B1');
      out.email = _buildNominationEmail(captureCurrentState().vessels.find(v => v.name === 'FRAMED')).body;
      out.paq = document.getElementById('paq-panel').textContent;
      out.rem = _buildReminderRow(a, new Date(), 'upcoming', 0);
      showPage('dashboard'); if (typeof refreshDashboard === 'function') refreshDashboard();
      out.feed = (document.getElementById('dash-activity-feed') || {}).textContent || '';
      out.search = (() => { try { return JSON.stringify(_lastSched.filter(i => i.etaWin).map(i => _fmtEtaWinShort(i.eta, i.etaWin))); } catch (e) { return String(e); } })();
      const tpl = 'ETA {{ETA}} for {{VESSEL_NAME}}';
      ciOpenForVessel(+A); out.ci = ciApplyTemplate(tpl, _ciVesselCtx); ciCloseModal();
      showPage('commandcenter'); await new Promise(r => setTimeout(r, 300));
      out.cc = document.getElementById('page-commandcenter') ? document.getElementById('page-commandcenter').textContent : '';
      showPage('nominations');
      out.etaTxt = _fmtEtaWin(__dt(2, 6), 'AM');
      return out;
    });
    check('T3 supply starts at the frame start (06:00)', r.a.start === r.want.start && r.a.win === 'AM' && r.a.nf === false, r.a);
    check('T3 ETC = frame end 12:00 + 8h supply = 20:00 (latest)', r.a.etc === r.want.etc && Math.abs(r.a.hrs - 14) < 0.01, r);
    check('T3 a vessel arriving inside the frame waits for the reserved slot (+1h travel)', r.x.start === r.want.xStart && r.x.waited === true, r.x);
    check('T3 Free Windows: busy 06:00 → 20:00, nothing free inside', r.fwFreeInside === 0 && r.fwBusy.length === 1 && r.fwBusy[0][0] === r.want.start && r.fwBusy[0][1] === r.want.etc, r);
    check('T3 stock projection uses the same occupancy', r.proj.length === 1 && r.proj[0][0] === r.want.start && r.proj[0][1] === r.want.etc, r.proj);
    check('T3 Availability Check timeline = the same reserved slot', r.tlOps.length === 1 && r.tlOps[0][0] === r.want.start && r.tlOps[0][1] === r.want.etc, r.tlOps);
    check('T3 Availability Check: a 13:00 request inside the frame is not offered at 13:00', /Requested time cannot be met/.test(r.nsc) && /FRAMED \(\d\d \w{3} \d{4}\s+06:00 → \d\d \w{3} \d{4}\s+20:00\)/.test(r.nsc), r.nsc.slice(0, 900));
    check('T3 a Loading inside the reserved frame is flagged; after it is not', r.conflict.some(c => /FRAMED/.test(c)) && !r.conflictAfter.some(c => /FRAMED/.test(c)), [r.conflict, r.conflictAfter]);
    check('T3 schedule table shows "… AM (06:00–12:00)"', r.voy.includes(r.etaTxt), r.voy.slice(0, 400));
    check('T3 timeline: frame tag, ETA text, latest ETC, explanation', r.tlTag && r.tl.includes(r.etaTxt) && /ETC \(latest\)/.test(r.tl) && /ETA given as a time frame/.test(r.tl) && /incl\. 6h frame/.test(r.tl), r.tl.slice(0, 600));
    check('T3 week calendar ticket shows "AM" (hours in its tooltip)', />AM</.test(r.cal) && /ETA: AM 06:00–12:00 \(time frame\)/.test(r.cal), r.cal.slice(0, 300));
    check('T3 checklist shows the frame', r.clRec === 'AM' && /AM 06:00–12:00/.test(r.cl), r.cl.slice(0, 300));
    check('T3 bunker message names the ETA frame', r.msg.includes('VESSEL ETA: ' + r.etaTxt), r.msg);
    check('T3 nomination e-mail: ETA as a frame', r.email.includes('ETA: ' + r.etaTxt), r.email);
    check('T3 PAQ reminder + arrival reminder show the frame', r.paq.includes(r.etaTxt) && r.rem.includes(r.etaTxt), [r.paq.slice(0, 300), r.rem.slice(0, 300)]);
    check('T3 dashboard activity feed shows the frame', /AM \(06:00–12:00\)/.test(r.feed), r.feed.slice(0, 400));
    check('T3 calling instructions {{ETA}}', r.ci.includes('ETA ' + r.etaTxt + ' for FRAMED'), r.ci);
    check('T3 Command Center shows the frame', /AM \(06:00–12:00\)/.test(r.cc), r.cc.slice(0, 300));
    // Excel schedule export
    const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => downloadExcel())]);
    const wb = XLSX.read(fs.readFileSync(await dl.path()));
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false });
    const row = rows.find(x => x[1] === 'FRAMED') || [];
    check('T3 schedule Excel ETA column shows the frame', row.some(c => String(c) === r.etaTxt), row);
  });

  await scenario(browser, 'T4 EAM is not "no firm ETA"', async (page) => {
    const r = await page.evaluate(() => {
      const b = __barge({ name: 'B1' });
      const e = __vessel({ name: 'EARLY BIRD', eta: __fmt(__dt(2, 0)), bargeId: b });
      __frame(e, 'EAM');
      __vessel({ name: 'NO FIRM', eta: __fmt(__dt(2, 0)), bargeId: b });
      __vessel({ name: 'FIRM LATER', eta: __fmt(__dt(2, 3)), bargeId: b, qty: 300 });
      const vs = getVessels();
      calculate();
      const lc = document.getElementById('v' + e + '-het').textContent;
      return {
        vs: vs.map(v => [v.name, v.noFirmETA, v.etaWin || '']), seq: _lastSched.map(i => i.name),
        eam: __item('EARLY BIRD'), eta: document.getElementById('v' + e + '-eta').value, want: __fmt(__dt(2, 0)), het: lc,
        voy: document.getElementById('voy-barge-tabs').textContent
      };
    });
    check('T4 EAM vessel: ETA 00:00 kept, not flagged no-firm', r.eta === r.want && r.vs[0][1] === false && r.vs[0][2] === 'EAM', r.vs);
    check('T4 a plain 00:00 ETA is still no-firm', r.vs[1][1] === true, r.vs);
    check('T4 EAM scheduled with firm vessels, no-firm one last', r.seq[0] === 'EARLY BIRD' && r.seq[r.seq.length - 1] === 'NO FIRM' && r.eam.noFirmETA === false, r.seq);
    check('T4 EAM shown as a frame, not "NO FIRM ETA"', /EAM \(00:00–06:00\)/.test(r.het) && /EAM \(00:00–06:00\)/.test(r.voy), [r.het, r.voy.slice(0, 300)]);
  });

  await scenario(browser, 'T5 laycan with frames', async (page) => {
    const r = await page.evaluate(() => {
      const lcTxt = (a, b) => { const x = __day(a), y = __day(b); return x.getDate() + ' ' + MO[x.getMonth()] + ' ' + x.getFullYear() + ' - ' + y.getDate() + ' ' + MO[y.getMonth()] + ' ' + y.getFullYear(); };
      const mk = (name, lc, days, h, code) => { const id = __vessel({ name, lc, eta: __fmt(__dt(days, h)) }); __frame(id, code); return id; };
      // laycan opens day 4: an AM frame on day 3 is early; LPM on day 3 ends at day-4 00:00 → not early
      const e1 = mk('EARLY AM', lcTxt(4, 5), 3, 7, 'AM');
      mk('LPM EDGE', lcTxt(4, 5), 3, 19, 'LPM');
      // laycan closed end of day 2: EAM on day 3 starts after it → delayed; LPM on day 2 starts inside → not delayed
      const l1 = mk('LATE EAM', lcTxt(1, 2), 3, 1, 'EAM');
      mk('LPM INSIDE', lcTxt(1, 2), 2, 20, 'LPM');
      const vs = getVessels().map(v => ({ n: v.name, early: v.isEarly, late: v.isDelayed }));
      upd(+e1); upd(+l1);
      return { vs, boxE: document.getElementById('v' + e1 + '-lcbox').className + ' ' + document.getElementById('v' + e1 + '-lcbox').textContent,
               boxL: document.getElementById('v' + l1 + '-lcbox').className };
    });
    const f = n => r.vs.find(v => v.n === n) || {};
    check('T5 early only if the frame END is before laycan opens', f('EARLY AM').early === true && f('LPM EDGE').early === false, r.vs);
    check('T5 delayed only if the frame START is after laycan closes', f('LATE EAM').late === true && f('LPM INSIDE').late === false && f('LPM INSIDE').early === false, r.vs);
    check('T5 card laycan box agrees', /early/.test(r.boxE) && /ETA frame is before laycan/.test(r.boxE) && /late/.test(r.boxL), r);
  });

  // ── Multi-device: etaWin round-trips through save / merge / trader RPC ──
  {
    console.log('T6 sync round-trip');
    const seed = U.seedPayload();
    seed.state.vessels[0].eta = '20 Oct 2026 06:00'; seed.state.vessels[0].etaWin = 'AM';
    const db = H.createDb({ workspace: seed, protectTraderFields: true });
    const A = await U.open(browser, db, 'user-operator');
    const B = await U.open(browser, db, 'user-operator2');
    const T = await U.open(browser, db, 'user-trader');
    for (const x of [A, B, T]) { await U.helpers(x); await x.page.evaluate(HELPERS); }
    const shows = (x, uid) => x.page.evaluate(u => { const id = __cardFor(u); return document.getElementById('v' + id + '-etawin-chk').checked + ':' + document.getElementById('v' + id + '-etawin').value + ':' + document.getElementById('v' + id + '-eta').value; }, uid);
    check('T6 seeded frame shows on every device', (await shows(A, 'n1')) === 'true:AM:20 Oct 2026 06:00' && (await shows(B, 'n1')) === 'true:AM:20 Oct 2026 06:00' && (await shows(T, 'n1')) === 'true:AM:20 Oct 2026 06:00');
    check('T6 trader may edit the frame (not an operator-only field)', await T.page.evaluate(() => !document.getElementById('v' + __cardFor('n1') + '-etawin-chk').disabled && !document.getElementById('v' + __cardFor('n1') + '-etawin').disabled));
    await A.page.evaluate(async () => { __frame(__cardFor('n2'), 'LPM'); return saveSharedState(); });
    let n2 = U.row(db).payload.state.vessels.find(v => v.nomUid === 'n2');
    check('T6 A saved a new frame', n2.etaWin === 'LPM' && n2.eta === '21 Oct 2026 18:00', n2);
    await B.page.evaluate(async () => { __setV('n1', 'agent', 'B-AGENT'); return saveSharedState(); });
    let vs = U.row(db).payload.state.vessels;
    n2 = vs.find(v => v.nomUid === 'n2'); let n1 = vs.find(v => v.nomUid === 'n1');
    check('T6 three-way merge keeps A\'s frame and n1\'s frame + B\'s edit', n2.etaWin === 'LPM' && n1.etaWin === 'AM' && n1.agent === 'B-AGENT', vs);
    check('T6 B now shows A\'s frame', (await shows(B, 'n2')) === 'true:LPM:21 Oct 2026 18:00');
    await T.page.evaluate(async () => { await _pollOnce(true); __frame(__cardFor('n1'), 'NOON'); return saveSharedState(); });
    const rpc = db.log.filter(o => o.action === 'rpc' && o.name === 'trader_update_vessels').pop();
    const tv = rpc && rpc.args.new_vessels.find(v => v.nomUid === 'n1');
    check('T6 trader RPC carries etaWin + frame-start ETA', tv && tv.etaWin === 'NOON' && tv.eta === '20 Oct 2026 11:00', tv);
    n1 = U.row(db).payload.state.vessels.find(v => v.nomUid === 'n1');
    check('T6 server keeps the trader\'s frame (protected-field merge)', n1.etaWin === 'NOON', n1);
    await A.page.evaluate(() => _pollOnce(true));
    check('T6 operator sees the trader\'s frame', (await shows(A, 'n1')) === 'true:NOON:20 Oct 2026 11:00');
    await A.page.evaluate(async () => { __frame(__cardFor('n2'), ''); return saveSharedState(); });
    n2 = U.row(db).payload.state.vessels.find(v => v.nomUid === 'n2');
    check('T6 unticking drops etaWin everywhere', !('etaWin' in n2) && n2.eta === '21 Oct 2026 18:00', n2);
    await B.page.evaluate(() => _pollOnce(true));
    check('T6 B unticked too', (await shows(B, 'n2')).startsWith('false:'));
    // trash / restore keeps the frame
    const tr = await A.page.evaluate(() => {
      window.confirm = () => false;
      rmV(+__cardFor('n1'));
      const def = _trashBin[_trashBin.length - 1].def;
      restoreFromTrash(_trashBin.length - 1);
      return { def: def.etaWin, v: captureCurrentState().vessels.find(x => x.nomUid === 'n1').etaWin };
    });
    check('T6 trash + restore keeps the frame', tr.def === 'NOON' && tr.v === 'NOON', tr);
    const errs = [A, B, T].flatMap(U.realErrors);
    check('T6 no page errors', errs.length === 0, errs.slice(0, 3));
    for (const x of [A, B, T]) await x.ctx.close();
  }

  // Legacy workspace: nothing changes, no extra write
  {
    console.log('T7 legacy vessels unchanged');
    const seed = U.seedPayload();
    const before = JSON.stringify(seed.state.vessels);
    const db = H.createDb({ workspace: seed });
    const A = await U.open(browser, db, 'user-operator');
    const r = await A.page.evaluate(() => ({ cap: captureCurrentState().vessels, ticked: document.querySelectorAll('[id$="-etawin-chk"]:checked').length }));
    check('T7 captured vessels identical to the stored ones', JSON.stringify(r.cap) === before && r.ticked === 0, r);
    const w0 = U.writes(db, 'user-operator').length;
    await A.page.evaluate(() => saveSharedState());
    check('T7 no extra cloud write for an untouched legacy workspace', U.writes(db, 'user-operator').length === w0);
    check('T7 no page errors', U.realErrors(A).length === 0, U.realErrors(A).slice(0, 3));
    await A.ctx.close();
  }

  await scenario(browser, 'T8 Loading form with a time frame', async (page) => {
    const r = await page.evaluate(() => {
      const b = __barge({ name: 'B1' });
      showPage('loading');
      _populateLoadingBargeSelect();
      const g = id => document.getElementById(id);
      g('ld-barge').value = 'B1'; g('ld-terminal').value = 'TERM ONE'; g('ld-grade').value = 'VLSFO'; g('ld-qty').value = '1500';
      g('ld-start-date').value = _localDateInputStr(__day(2)); g('ld-start-time').value = '14:30';
      g('ld-pre-ops').value = '2'; g('ld-post-ops').value = '3';
      _recalcLoadingEstimate();
      const out = { hidden0: g('ld-start-win').hidden };
      g('ld-start-win-chk').checked = true; g('ld-start-win-chk').dispatchEvent(new Event('change'));
      out.tick = { sel: g('ld-start-win').value, time: g('ld-start-time').value, dis: g('ld-start-time').disabled, hint: g('ld-start-win-hint').textContent, comp: g('ld-completion-display').value };
      const pump = computeLoadingDurationHours(1500, 'VLSFO');
      out.wantEnd = new Date(__dt(2, 18).getTime() + (2 + pump + 3) * 3600000);
      const endTxt = d => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
      out.wantComp = 'Latest ' + endTxt(out.wantEnd);
      window.confirm = () => true;
      submitLoadingForm();
      const rec = _loadingRecords[_loadingRecords.length - 1];
      out.rec = { startAt: rec.startAt, endAt: rec.endAt, startWin: rec.startWin, est: rec.estimatedHours };
      out.wantStart = __dt(2, 12).toISOString();
      out.list = g('loading-list').textContent;
      renderWeekCalendar(0); out.cal = g('week-calendar').innerHTML;
      // occupancy: Free Windows + vessel conflict see start → frame end + operation
      _bargeConfig = getBarges();
      const fw = computeFreeWindows(b, 'B1', __day(1), __day(5));
      out.fwBusy = fw.filter(w => w.kind === 'loading').map(w => [w.rawStart.toISOString(), w.rawEnd.toISOString()]);
      // edit → the frame comes back; change it; cancel → cleared
      editLoadingRecord(rec.id);
      out.edit = { chk: g('ld-start-win-chk').checked, sel: g('ld-start-win').value, time: g('ld-start-time').value };
      g('ld-start-win').value = 'LPM'; g('ld-start-win').dispatchEvent(new Event('change'));
      submitLoadingForm();
      const rec2 = _loadingRecords.find(x => x.id === rec.id);
      out.rec2 = { startAt: rec2.startAt, startWin: rec2.startWin, endAt: rec2.endAt };
      out.want2 = __dt(2, 18).toISOString(); out.want2End = new Date(__dt(3, 0).getTime() + (2 + pump + 3) * 3600000).toISOString();
      out.afterUpdate = { chk: g('ld-start-win-chk').checked, dis: g('ld-start-time').disabled, hidden: g('ld-start-win').hidden };
      // an exact-time loading stores no startWin
      g('ld-terminal').value = 'TERM TWO'; g('ld-qty').value = '300'; g('ld-start-date').value = _localDateInputStr(__day(4)); g('ld-start-time').value = '09:00';
      submitLoadingForm();
      out.plain = _loadingRecords[_loadingRecords.length - 1];
      out.plainH = new Date(out.plain.startAt).getHours();
      out.timeline = (() => { renderBargeTabsAndTL([], getBarges()); return document.getElementById('tl').textContent; })();
      return out;
    });
    check('T8 frame select hidden until ticked', r.hidden0 === true);
    check('T8 ticking 14:30 → PM, start time locked to 12:00', r.tick.sel === 'PM' && r.tick.time === '12:00' && r.tick.dis === true && /PM \(12:00–18:00\)/.test(r.tick.hint), r.tick);
    check('T8 estimated completion = frame END + operation (latest)', r.tick.comp === r.wantComp, [r.tick.comp, r.wantComp]);
    check('T8 saved: startAt = frame start, endAt = frame end + duration, startWin kept', r.rec.startAt === r.wantStart && r.rec.endAt === r.wantEnd.toISOString() && r.rec.startWin === 'PM', r.rec);
    check('T8 loading list shows "… PM (12:00–18:00)"', /\d\d \w{3} \d{4} PM \(12:00–18:00\) →/.test(r.list) && /latest end/.test(r.list), r.list.slice(0, 400));
    check('T8 calendar ticket shows the frame (hours in its tooltip)', />PM</.test(r.cal) && /Start PM 12:00–18:00 \(time frame\)/.test(r.cal), r.cal.slice(0, 300));
    check('T8 Free Windows blocks the barge start → frame end + operation', r.fwBusy.length >= 1 && r.fwBusy[0][0] === r.wantStart && r.fwBusy[0][1] === r.wantEnd.toISOString(), r.fwBusy);
    check('T8 edit restores the frame', r.edit.chk && r.edit.sel === 'PM' && r.edit.time === '12:00', r.edit);
    check('T8 update to LPM moves start to 18:00 and end with it', r.rec2.startWin === 'LPM' && r.rec2.startAt === r.want2 && r.rec2.endAt === r.want2End, r.rec2);
    check('T8 form cleared back to exact time after update', !r.afterUpdate.chk && !r.afterUpdate.dis && r.afterUpdate.hidden, r.afterUpdate);
    check('T8 exact-time loading stores no startWin', !('startWin' in r.plain) && r.plainH === 9, r.plain);
    check('T8 Supply Timeline loading card shows the frame', /LPM \(18:00–24:00\)/.test(r.timeline), r.timeline.slice(0, 300));
  });

  // Loading frame syncs to a second operator; "Plan this loading" stays an exact time
  {
    console.log('T9 loading sync + reload planner prefill');
    const db = H.createDb({ workspace: U.seedPayload() });
    const A = await U.open(browser, db, 'user-operator');
    const B = await U.open(browser, db, 'user-operator2');
    for (const x of [A, B]) await x.page.evaluate(HELPERS);
    await A.page.evaluate(async () => {
      showPage('loading'); _populateLoadingBargeSelect();
      const g = id => document.getElementById(id);
      g('ld-barge').value = 'Barge 1'; g('ld-terminal').value = 'SYNC TERM'; g('ld-qty').value = '600'; g('ld-start-date').value = _localDateInputStr(__day(3));
      _ldSetStartWin('EAM');
      window.confirm = () => true;
      submitLoadingForm();
      await saveSharedState();
    });
    const cloud = (U.row(db).payload.state.loadingRecords || []).find(x => x.terminal === 'SYNC TERM');
    check('T9 cloud copy carries startWin', cloud && cloud.startWin === 'EAM', cloud);
    await B.page.evaluate(() => _pollOnce(true));
    const b = await B.page.evaluate(() => { const r = _loadingRecords.find(x => x.terminal === 'SYNC TERM'); showPage('loading'); renderLoadingList(); return { win: r && r.startWin, list: document.getElementById('loading-list').textContent }; });
    check('T9 second operator gets the frame and shows it', b.win === 'EAM' && /EAM \(00:00–06:00\)/.test(b.list), b);
    const pre = await A.page.evaluate(() => {
      _ldSetStartWin('AM');
      const g = id => document.getElementById(id);
      // what rlPlanLoading does to the form: a fresh exact start time
      cancelLoadingEdit(); g('ld-start-time').value = '07:15'; _ldSetStartWin('');
      return { chk: g('ld-start-win-chk').checked, dis: g('ld-start-time').disabled, time: g('ld-start-time').value, fn: /_ldSetStartWin\(''\)/.test(String(rlPlanLoading)) };
    });
    check('T9 Plan this loading pre-fills an exact time (frame cleared)', !pre.chk && !pre.dis && pre.time === '07:15' && pre.fn, pre);
    const errs = [A, B].flatMap(U.realErrors);
    check('T9 no page errors', errs.length === 0, errs.slice(0, 3));
    for (const x of [A, B]) await x.ctx.close();
  }

  await scenario(browser, 'T10 import parser reads time frames', async (page) => {
    const r = await page.evaluate(() => {
      const now = new Date(2026, 9, 14, 9, 0);
      const P = t => { const d = _parseNominationText(t, { now })[0]; return { eta: d.eta, win: d.etaWin, low: d.low.eta || '' }; };
      return {
        am: P('MV ALPHA ONE\nETA 16 Oct AM\nVLSFO 500 MT'),
        eam: P('MV BRAVO TWO\nETA: 16/10 EAM\nVLSFO 300 MT'),
        lpm: P('MV CHARLIE THREE\nETA 16th Oct LPM\nLSMGO 50 MT'),
        noon: P('MV DELTA FOUR eta 16.10 noon, 400 mt vlsfo'),
        pm: P('MV ECHO FIVE 16 Oct PM 500 mt vlsfo'),
        exact: P('MV FOX SIX\nETA 16 Oct 0600\nVLSFO 500 MT'),
        exact2: P('MV GOLF SEVEN\nETA 16 Oct 2026 14:30\nVLSFO 500 MT'),
        year: P('MV HOTEL EIGHT\nETA 16 Oct 2026 AM\nVLSFO 500 MT'),
        early: P('MV INDIA NINE\nETA 16 Oct early morning\nVLSFO 500 MT'),
        after: P('MV JULIET TEN\nETA 16 Oct afternoon\nVLSFO 500 MT'),
        eve: P('MV KILO ELEVEN\nETA 16 Oct evening\nVLSFO 500 MT'),
        night: P('MV LIMA TWELVE\nETA 16 Oct night\nVLSFO 500 MT'),
        table: _parseNominationText('Vessel\tETA\tVLSFO\tLocation\nMV TAB ONE\t16 Oct PM\t500\tFujairah\nMV TAB TWO\t17 Oct 0800\t300\tFujairah', { now }).map(d => [d.name, d.eta, d.etaWin])
      };
    });
    const is = (x, eta, win) => x.eta === eta && x.win === win;
    check('T10 "ETA 16 Oct AM" → 06:00 + AM', is(r.am, '16 Oct 2026 06:00', 'AM') && /time frame AM/.test(r.am.low), r.am);
    check('T10 "ETA: 16/10 EAM" → 00:00 + EAM, not "no firm ETA"', is(r.eam, '16 Oct 2026 00:00', 'EAM') && !/no firm/i.test(r.eam.low), r.eam);
    check('T10 "ETA 16th Oct LPM" → 18:00 + LPM', is(r.lpm, '16 Oct 2026 18:00', 'LPM'), r.lpm);
    check('T10 "eta 16.10 noon" → 11:00 + NOON', is(r.noon, '16 Oct 2026 11:00', 'NOON'), r.noon);
    check('T10 unlabelled "16 Oct PM" → 12:00 + PM', is(r.pm, '16 Oct 2026 12:00', 'PM'), r.pm);
    check('T10 an explicit time still wins', is(r.exact, '16 Oct 2026 06:00', '') && is(r.exact2, '16 Oct 2026 14:30', ''), [r.exact, r.exact2]);
    check('T10 "16 Oct 2026 AM" keeps the year and the frame', is(r.year, '16 Oct 2026 06:00', 'AM'), r.year);
    check('T10 spelled-out frames (early morning / afternoon / evening)', is(r.early, '16 Oct 2026 00:00', 'EAM') && is(r.after, '16 Oct 2026 12:00', 'PM') && is(r.eve, '16 Oct 2026 18:00', 'LPM'), [r.early, r.after, r.eve]);
    check('T10 "night" is still a guessed time, not a frame', is(r.night, '16 Oct 2026 22:00', '') && !!r.night.low, r.night);
    check('T10 table ETA column with a frame', JSON.stringify(r.table) === JSON.stringify([['TAB ONE', '16 Oct 2026 12:00', 'PM'], ['TAB TWO', '17 Oct 2026 08:00', '']]), r.table);
  });

  await scenario(browser, 'T11 import review row → card', async (page) => {
    await page.evaluate(() => { showPage('nominations'); document.getElementById('nimp').open = true; });
    await page.fill('#nimp-text', 'MV TIMEFRAME ONE\nETA 16 Oct AM\nVLSFO 500 MT\nFujairah');
    await page.click('#nimp-read');
    await page.waitForSelector('#nimp-results tr.nimp-row');
    const row0 = await page.evaluate(() => { const tr = document.getElementById('nimp-row-0'); return { eta: tr.querySelector('[data-k="eta"]').value, win: tr.querySelector('[data-k="etaWin"]').value, opts: tr.querySelector('[data-k="etaWin"]').options.length, msg: document.getElementById('nimp-msg-0').textContent }; });
    check('T11 review row: ETA at 06:00 and the AM frame selected', /^16 Oct \d{4} 06:00$/.test(row0.eta) && row0.win === 'AM' && row0.opts === 6 && /time frame AM \(06:00–12:00\)/.test(row0.msg), row0);
    await page.selectOption('#nimp-row-0 [data-k="etaWin"]', 'PM');
    const row1 = await page.evaluate(() => document.querySelector('#nimp-row-0 [data-k="eta"]').value);
    check('T11 choosing PM in the row moves the ETA to 12:00', /^16 Oct \d{4} 12:00$/.test(row1), row1);
    await page.click('#nimp-add-all');
    await page.waitForTimeout(300);
    const card = await page.evaluate(() => { const v = captureCurrentState().vessels.find(x => x.name === 'TIMEFRAME ONE'); const c = Array.from(document.querySelectorAll('.vcard')).find(x => x.dataset.nomUid === v.nomUid); const id = c.id.replace('vessel-', ''); return { v, chk: document.getElementById('v' + id + '-etawin-chk').checked, sel: document.getElementById('v' + id + '-etawin').value }; });
    check('T11 added card keeps the frame', card.v.etaWin === 'PM' && /12:00$/.test(card.v.eta) && card.chk && card.sel === 'PM', card);
    // an explicit time typed over a frame drops it
    await page.fill('#nimp-text', 'MV TIMEFRAME TWO\nETA 16 Oct LPM\nVLSFO 200 MT');
    await page.click('#nimp-read');
    await page.waitForSelector('#nimp-results tr.nimp-row');
    const y = await page.evaluate(() => document.querySelector('#nimp-row-0 [data-k="eta"]').value.slice(0, 11));
    await page.fill('#nimp-row-0 [data-k="eta"]', y + ' 21:30');
    const row2 = await page.evaluate(() => ({ win: document.querySelector('#nimp-row-0 [data-k="etaWin"]').value, d: _niDrafts[0].etaWin }));
    check('T11 typing an exact time clears the frame', row2.win === '' && row2.d === '', row2);
    await page.click('#nimp-add-all');
    await page.waitForTimeout(300);
    const v2 = await page.evaluate(() => captureCurrentState().vessels.find(x => x.name === 'TIMEFRAME TWO'));
    check('T11 added as an exact time', v2 && !('etaWin' in v2) && /21:30$/.test(v2.eta), v2);
  });

  // ── T12: fixes from the adversarial review ──
  await scenario(browser, 'T12 review fixes', async (page) => {
    // parser: years vs 24h times, 2-digit years, "12 noon", "late afternoon", time after a frame
    const P = await page.evaluate(() => {
      const now = new Date(2026, 9, 15, 9, 0);
      const one = t => { const d = _parseNominationText('MV PARSE ONE\n' + t + '\nVLSFO 500 MT', { now })[0]; return { eta: d.eta, win: d.etaWin || '' }; };
      return {
        y2000pm: one('ETA 16 Oct 2000 PM'), y1930pm: one('ETA 16th October 1930pm'), y2026am: one('ETA 16 Oct 2026 AM'),
        yy26pm: one('ETA: 16-Oct-26 PM'), noon12: one('ETA 16 Oct 12 noon'), lateaft: one('ETA 16 Oct late afternoon'),
        pm2000: one('ETA 16 Oct PM 2000 LT'), pmslash: one('ETA 15/10 PM/1800'), lpm: one('ETA 16 Oct LPM'), exact: one('ETA 16 Oct 0600'),
      };
    });
    check('T12 "16 Oct 2000 PM" is 20:00 this year, not the year 2000', P.y2000pm.eta === '16 Oct 2026 20:00' && !P.y2000pm.win, P.y2000pm);
    check('T12 "1930pm" is 19:30 this year', P.y1930pm.eta === '16 Oct 2026 19:30' && !P.y1930pm.win, P.y1930pm);
    check('T12 "16 Oct 2026 AM" still reads the year + AM frame', P.y2026am.eta === '16 Oct 2026 06:00' && P.y2026am.win === 'AM', P.y2026am);
    check('T12 "16-Oct-26 PM" keeps the PM frame', P.yy26pm.eta === '16 Oct 2026 12:00' && P.yy26pm.win === 'PM', P.yy26pm);
    check('T12 "16 Oct 12 noon" is NOON this year', P.noon12.eta === '16 Oct 2026 11:00' && P.noon12.win === 'NOON', P.noon12);
    check('T12 "late afternoon" is the PM frame', P.lateaft.win === 'PM' && /12:00$/.test(P.lateaft.eta), P.lateaft);
    check('T12 "PM 2000 LT" keeps the stated 20:00 (no frame)', P.pm2000.eta === '16 Oct 2026 20:00' && !P.pm2000.win, P.pm2000);
    check('T12 "PM/1800" keeps 18:00 (no frame)', /18:00$/.test(P.pmslash.eta) && !P.pmslash.win, P.pmslash);
    check('T12 LPM / exact time unchanged', P.lpm.win === 'LPM' && /18:00$/.test(P.lpm.eta) && P.exact.eta === '16 Oct 2026 06:00' && !P.exact.win, [P.lpm, P.exact]);

    // picker: opening and closing a frame card's picker never changes the stored ETA; box stays readonly
    const pk = await page.evaluate(async () => {
      const id = __vessel({ name: 'PICK', eta: __fmt(__dt(2, 9)) });
      __frame(id, 'PM');
      const inp = document.getElementById('v' + id + '-eta');
      const before = __cap(id).eta;
      openETAPicker(id); await new Promise(r => setTimeout(r, 50));
      const whileOpen = inp.value;
      _etaPickers[id].close(); await new Promise(r => setTimeout(r, 50));
      const after = __cap(id).eta;
      __frame(id, 'AM'); const ro1 = inp.hasAttribute('readonly');
      openETAPicker(id); _etaPickers[id].close(); __frame(id, ''); const ro2 = inp.hasAttribute('readonly');
      return { before, whileOpen, after, ro1, ro2 };
    });
    check('T12 picker open/close keeps the frame start time', /12:00$/.test(pk.before) && pk.after === pk.before && /12:00$/.test(pk.whileOpen), pk);
    check('T12 ETA box stays readonly after ticking/unticking', pk.ro1 && pk.ro2, pk);

    // merge: ETA and frame move together
    const m = await page.evaluate(() => {
      const base = { vessels: [{ nomUid: 'n1', name: 'X', eta: '20 Oct 2026 06:00' }] };
      const A = { vessels: [{ nomUid: 'n1', name: 'X', eta: '20 Oct 2026 06:00', etaWin: 'AM' }] };   // ticked AM
      const B = { vessels: [{ nomUid: 'n1', name: 'X', eta: '20 Oct 2026 15:00' }] };                  // exact 15:00
      const ctx1 = { conflicts: [] }, ctx2 = { conflicts: [] }, ctx3 = { conflicts: [] };
      const both = _merge3(base, A, B, 'state', ctx1, '').vessels[0];
      const onlyA = _merge3(base, A, base, 'state', ctx2, '').vessels[0];
      const onlyB = _merge3(base, base, B, 'state', ctx3, '').vessels[0];
      return { both, c1: ctx1.conflicts, onlyA, onlyB, c3: ctx3.conflicts };
    });
    check('T12 concurrent tick + exact time: no hybrid, conflict recorded', m.c1.length > 0 && ((m.both.etaWin === 'AM' && m.both.eta === '20 Oct 2026 06:00') || (!m.both.etaWin && m.both.eta === '20 Oct 2026 15:00')), m);
    check('T12 one side changed: its ETA + frame taken together', m.onlyA.etaWin === 'AM' && m.onlyA.eta === '20 Oct 2026 06:00' && !m.onlyB.etaWin && m.onlyB.eta === '20 Oct 2026 15:00' && m.c3.length === 0, m);

    // timeline: barge only free after the frame ended → no "incl. frame", waited note
    const tl = await page.evaluate(() => {
      const b1 = __barge({ name: 'B1' });
      __vessel({ name: 'FIRST', eta: __fmt(__dt(2, 4)), qty: 1500, bargeId: b1 });
      const id = __vessel({ name: 'FRAMED', eta: __fmt(__dt(2, 9)), qty: 600, bargeId: b1 });
      __frame(id, 'AM');
      calculate();
      const it = __item('FRAMED');
      const card = Array.from(document.querySelectorAll('.tli')).find(c => /FRAMED/.test(c.textContent));
      return { start: fmt24(it.bargeStart), etc: fmt24(it.etc), text: card ? card.textContent.replace(/\s+/g, ' ') : '' };
    });
    check('T12 timeline: no frame hours counted when the barge arrives after the frame', !/incl\. \d+h frame/.test(tl.text) && tl.text.includes('Barge ready from ' + tl.start.replace(/\s+/g, ' ')), tl);

    // calendar ticket shows the frame code only
    const cal = await page.evaluate(() => { showPage('dashboard'); try { renderWeekCalendar(0); } catch (e) {} const t = document.body.innerHTML; return { clipped: /AM 06:00–1[^2]/.test(t) }; });
    check('T12 calendar ticket does not carry the clipped frame hours', !cal.clipped, cal);
  });

  await browser.close();
  console.log(`timeframe.test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
