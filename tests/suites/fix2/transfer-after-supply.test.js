/* Barge transfers go after the vessel supplies ("supply is priority").
   Seen on the schedule: HAYAT (FNSA 11, ETA 21 Nov 19:00) was pushed behind a transfer
   FNSA 10 → FNSA 11 typed for 22 Nov 06:00; it should be supplied first and the transfer
   should follow it.
   • Generate schedule supplies every vessel as if the transfer were not there, then moves the
     transfer to the first gap at or after the start typed where BOTH barges are free (after the
     supplies' ETC + contingency + travel, Unavailable blocks, loadings, other transfers);
     its saved start/end move with it (cloud, calendar, timelines, Free Windows), the start typed
     is kept (reqStartAt), the timeline/list say "Moved after the vessel supplies — asked for …"
   • a transfer clear of the supplies is not touched (no write)
   • two transfers between the same two barges (one each way) run at the same time
   • one already under way still holds the vessels back
   • adding / editing a transfer places it at once against the current schedule; the edit form
     opens with the start typed; once the supply is gone it goes back to the start typed
   • a transfer is qty ÷ 400 MT/h (VLSFO) + 4h ops: 4,400 MT = 15h fits the 16h gap after HAYAT
     (a record saved with the old 6h / 300 MT/h figures is brought up to date)
   • the stock forecast counts it: the receiving barge as loaded at its end, the discharging one
     gives it at its start (reload advice / Free Windows' available-to-promise follow)
   • the transfer is done before the loadings: a loading on EITHER barge asked for at or after the
     transfer's start moves to right after it (start typed kept, back once the transfer is gone);
     a loading asked for before the transfer keeps its place and the transfer waits for it
   node suites/fix2/transfer-after-supply.test.js [appDir] */
const path = require('path');
if (process.argv[2]) process.env.APP_DIR = path.resolve(process.argv[2]);
const H = require(path.join(__dirname, '..', '..', 'harness', 'harness.js'));
const U = require(path.join(__dirname, '..', 'r3', 'util.js'));

let pass = 0, fail = 0;
function check(name, cond, info) {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 900)));
}
const NOW = Date.now();
const HR = 3600000;
const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
// An ETA h hours from now (whole minutes), written as the app reads it: in Dubai time (the browser runs in Asia/Dubai).
const at = h => Math.floor((NOW + h * HR) / 60000) * 60000;
const eta = h => { const d = new Date(at(h) + 4 * HR); const p = n => String(n).padStart(2, '0'); return `${p(d.getUTCDate())} ${MO[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };
const iso = h => new Date(at(h)).toISOString();
const BARGES = [
  { id: 1, name: 'FNSA 10', vrob: 6000, mrob: 300, vcap: 8000, mcap: 1000, vbuf: 200, mbuf: 50, vtph: 300, mtph: 100, vrfr: 750, mrfr: 275 },
  { id: 2, name: 'FNSA 11', vrob: 3000, mrob: 400, vcap: 8000, mcap: 1000, vbuf: 200, mbuf: 50, vtph: 250, mtph: 100, vrfr: 750, mrfr: 275 },
];
const vessel = (nomUid, name, h, qty, bargeId) => ({ nomUid, name, imo: '', area: 'FUJ-A', type: 'VLSFO', qty, mgo: 0, spec: 'ISO 8217:2010', agent: 'AG', manifold: 'VESSEL MANIFOLD', remarks: '', lc: '', eta: eta(h), paq: 'no', bargeId: String(bargeId), refuelChk: false, rfv: 0, rfm: 0, rfvr: 750, rfmr: 275 });
// 1,500 MT VLSFO at the transfer rate 400 MT/h = 3h 45m + 4h ops = 7h 45m (saved with the old 11h: brought up to date)
const xfer = (id, s, extra) => Object.assign({ id, kind: 'transfer', fromBarge: 'FNSA 10', barge: 'FNSA 11', terminal: '', grade: 'VLSFO', qty: 1500, startAt: iso(s), endAt: iso(s + 11), preOpsHours: 0, pumpHours: 5, postOpsHours: 0, hoseHours: 6, estimatedHours: 11, endOverridden: false, surveyor: '', notes: '', updatedAt: NOW }, extra || {});
function seed(vessels, loadings) {
  const s = U.seedPayload({ vessels });
  s.state.barges = JSON.parse(JSON.stringify(BARGES));
  s.state.calcParams = { hoseHrs: 6, travelHrs: 1, contingencyHrs: 1 };
  s.state.loadingRecords = loadings || [];
  return s;
}
// JIN YU FU TONG 400 MT at +10h (ETC +17.6h), HAYAT 750 MT at +20h (ETC +29h) — both on FNSA 11
const SHIPS = () => [vessel('n1', 'JIN YU FU TONG', 10, 400, 2), vessel('n2', 'HAYAT', 20, 750, 2)];

(async () => {
  const browser = await H.launch();
  const scenario = async (name, fn) => {
    if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return;
    console.log('— ' + name);
    const apps = [];
    try { await fn(async (db, uid) => { const a = await U.open(browser, db, uid); await U.helpers(a); await a.page.evaluate(() => { window.__alerts = []; window.__confirms = []; window.alert = m => window.__alerts.push(String(m)); window.confirm = m => { window.__confirms.push(String(m)); return true; }; }); apps.push(a); return a; }); }
    catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
    const errs = [].concat(...apps.map(a => U.realErrors(a)));
    check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
    for (const a of apps) await a.ctx.close();
  };
  const generate = page => page.evaluate(async () => {
    showPage('schedule'); calculate(); await new Promise(r => setTimeout(r, 300)); await _waitForSaveIdle();
    const job = n => { const j = _lastSched.find(x => x.name === n); return j && { start: new Date(j.bargeStart).getTime(), etc: new Date(j.etc).getTime(), barge: j.bargeLabel }; };
    const x = id => { const r = _loadingRecords.find(y => y.id === id); return r && { start: new Date(r.startAt).getTime(), end: new Date(r.endAt).getTime(), req: r.reqStartAt || null, startWin: r.startWin || null, updatedAt: r.updatedAt }; };
    const tl = [...document.querySelectorAll('#tl-2 .tli')].map(e => (e.querySelector('.tlvn') || e).textContent.replace(/\s+/g, ' ').trim());
    return { jin: job('JIN YU FU TONG'), hayat: job('HAYAT'), x1: x('x1'), tl, toasts: window.__toasts.slice(),
      note: [...document.querySelectorAll('#tl-2 .tl-xfer-moved')].map(e => e.textContent) };
  });

  await scenario('T1 HAYAT before the transfer', async (openT) => {
    // the transfer was typed for +23h — in the middle of HAYAT's supply
    const db = H.createDb({ workspace: seed(SHIPS(), [xfer('x1', 23)]), realtime: false });
    const A = await openT(db, 'user-operator');
    const g = await generate(A.page);
    check('T1 HAYAT is supplied at its ETA on FNSA 11 (not pushed behind the transfer)', g.hayat && g.hayat.barge === 'FNSA 11' && Math.abs(g.hayat.start - at(20)) < 60000, { hayat: g.hayat, eta: at(20) });
    const after = g.hayat.etc + 2 * HR; // + 1h contingency + 1h travel
    check('T1 the transfer moves to right after HAYAT (ETC + contingency + travel), 7h 45m long (1,500 ÷ 400 + 4h ops)', g.x1 && g.x1.start === after && g.x1.end - g.x1.start === 7.75 * HR, { x1: g.x1, expected: new Date(after).toISOString() });
    check('T1 the start that was typed is kept on the transfer', g.x1.req === iso(23), g.x1);
    check('T1 FNSA 11\'s timeline reads JIN YU FU TONG, HAYAT, then the transfer', g.tl.length === 3 && /JIN YU FU TONG/.test(g.tl[0]) && /HAYAT/.test(g.tl[1]) && /Barge transfer — FNSA 10 → FNSA 11/.test(g.tl[2]), g.tl);
    check('T1 the transfer card says it was moved after the supplies and what was asked for', g.note.length === 1 && /^Moved after the vessel supplies — asked for /.test(g.note[0]), g.note);
    check('T1 a message says the transfer was moved, and to when', g.toasts.some(t => /Supplies first: transfer FNSA 10 → FNSA 11 moved to/.test(t)), g.toasts);
    const cloud = (U.row(db).payload.state.loadingRecords || []).find(r => r.id === 'x1');
    check('T1 the new times reach the cloud (other devices, calendar, Free Windows see the same)', cloud && cloud.startAt === new Date(after).toISOString() && cloud.reqStartAt === iso(23), cloud);
    const l = await A.page.evaluate(() => { showPage('loading'); const r = document.querySelector('#loading-list .ld-row-transfer'); return r && r.textContent.replace(/\s+/g, ' '); });
    check('T1 the Loading list row says "Moved after the vessel supplies — asked for …"', /Moved after the vessel supplies — asked for/.test(l || ''), l);
    const fw = await A.page.evaluate(() => { const r = _freeWindowsWeekRange(); const rec = _loadingRecords.find(x => x.id === 'x1');
      return [1, 2].map(id => computeFreeWindows(id, id === 1 ? 'FNSA 10' : 'FNSA 11', r.weekStart, r.weekEnd).some(w => !w.kind && w.status === 'free' && new Date(w.start) < new Date(rec.endAt) && new Date(w.end) > new Date(rec.startAt))); });
    check('T1 Free Windows offers nothing inside the transfer\'s new window, on either barge', fw.every(x => !x), fw);
    // generating again changes nothing
    const g2 = await generate(A.page);
    check('T1 generating again keeps it there (no further move, no new write)', g2.x1.start === g.x1.start && g2.x1.updatedAt === g.x1.updatedAt && g2.toasts.filter(t => /Supplies first/.test(t)).length === 1, { g2: g2.x1, g: g.x1 });
  });

  await scenario('T2 a transfer clear of the supplies', async (openT) => {
    const db = H.createDb({ workspace: seed(SHIPS(), [xfer('x1', 40)]), realtime: false });
    const A = await openT(db, 'user-operator');
    const g = await generate(A.page);
    check('T2 a transfer that does not touch a supply stays exactly where it was (no reqStartAt, not re-saved)', g.x1.start === at(40) && g.x1.req === null && g.x1.updatedAt === NOW && g.note.length === 0 && !g.toasts.some(t => /Supplies first/.test(t)), g);
  });

  await scenario('T3 a transfer already under way', async (openT) => {
    // started an hour ago, ends in 10h: JIN YU FU TONG (ETA +2h) has to wait for it
    const db = H.createDb({ workspace: seed([vessel('n1', 'JIN YU FU TONG', 2, 400, 2)], [xfer('x1', -1)]), realtime: false });
    const A = await openT(db, 'user-operator');
    const g = await generate(A.page);
    check('T3 a transfer already under way still keeps the barge busy: the vessel waits for it (+ travel); the transfer is not moved', g.jin && g.jin.start === at(10) + HR && g.x1.start === at(-1), { jin: g.jin, x1: g.x1, end: at(10) });
  });

  await scenario('T4 add / edit against the current schedule', async (openT) => {
    const db = H.createDb({ workspace: seed(SHIPS(), []), realtime: false });
    const A = await openT(db, 'user-operator');
    const g0 = await generate(A.page);
    const add = await A.page.evaluate(async (startIso) => {
      showPage('loading');
      const k = document.getElementById('ld-kind'); k.value = 'transfer'; k.dispatchEvent(new Event('change'));
      document.getElementById('ld-from-barge').value = 'FNSA 10'; document.getElementById('ld-from-barge').dispatchEvent(new Event('change'));
      document.getElementById('ld-barge').value = 'FNSA 11'; document.getElementById('ld-grade').value = 'VLSFO'; document.getElementById('ld-qty').value = '1500';
      const s = new Date(startIso);
      document.getElementById('ld-start-date').value = _localDateInputStr(s); document.getElementById('ld-start-time').value = _localTimeInputStr(s);
      window.__confirms = []; window.__toasts = [];
      submitLoadingForm(); await _waitForSaveIdle();
      const r = _loadingRecords.find(x => x.kind === 'transfer');
      return { id: r.id, start: new Date(r.startAt).getTime(), req: r.reqStartAt, confirms: window.__confirms.slice(), toasts: window.__toasts.slice() };
    }, iso(22));
    const after = g0.hayat.etc + 2 * HR;
    check('T4 a transfer added over HAYAT\'s supply is placed after it straight away — no "already committed" warning', add.start === after && add.req === iso(22) && add.confirms.length === 0 && add.toasts.some(t => /Supplies first/.test(t)), { add, expected: new Date(after).toISOString() });
    const ed = await A.page.evaluate(async (id) => {
      editLoadingRecord(id);
      const d = document.getElementById('ld-start-date').value, t = document.getElementById('ld-start-time').value;
      document.getElementById('ld-qty').value = '1800'; // 4h 30m + 4h ops
      submitLoadingForm(); await _waitForSaveIdle();
      const r = _loadingRecords.find(x => x.id === id);
      return { d, t, start: new Date(r.startAt).getTime(), hrs: (new Date(r.endAt) - new Date(r.startAt)) / 3600000, req: r.reqStartAt };
    }, add.id);
    const typed = new Date(at(22) + 4 * HR);
    check('T4 Edit opens with the start that was typed (not the moved one); saving keeps it after HAYAT with the new length', ed.t === String(typed.getUTCHours()).padStart(2, '0') + ':' + String(typed.getUTCMinutes()).padStart(2, '0') && ed.start === after && ed.hrs === 8.5 && ed.req === iso(22), ed);
    // HAYAT now comes two days later: the transfer goes back to the start typed
    const back = await A.page.evaluate(async ([id, etaLate]) => {
      showPage('schedule');
      const card = [...document.querySelectorAll('.vcard[id^="vessel-"]')].find(c => /HAYAT/.test((c.querySelector('[id$="-name"]') || {}).value || ''));
      document.getElementById('v' + card.id.replace('vessel-', '') + '-eta').value = etaLate;
      calculate(); await new Promise(r => setTimeout(r, 300)); await _waitForSaveIdle();
      const r = _loadingRecords.find(x => x.id === id);
      return { hayat: new Date(_lastSched.find(x => x.name === 'HAYAT').bargeStart).getTime(), start: new Date(r.startAt).getTime(), req: r.reqStartAt, note: _xferMovedNote(r) };
    }, [add.id, eta(60)]);
    check('T4 once HAYAT no longer needs that time, generating again puts the transfer back at the start typed', back.hayat > at(50) && back.start === at(22) && back.note === '', back);
  });

  await scenario('T5 another device', async (openT) => {
    const db = H.createDb({ workspace: seed(SHIPS(), [xfer('x1', 23)]), realtime: false });
    const A = await openT(db, 'user-operator');
    const g = await generate(A.page);
    const B = await openT(db, 'user-operator2');
    const b = await B.page.evaluate(() => { const r = _loadingRecords.find(x => x.id === 'x1'); return { start: new Date(r.startAt).getTime(), note: _xferMovedNote(r) }; });
    check('T5 another device opens with the transfer at its new time, marked as moved', b.start === g.x1.start && /Moved after the vessel supplies/.test(b.note), { b, a: g.x1 });
  });

  // FNSA 10 loading 5,000 MT: a 12h window
  const loading = (id, barge, h, hrs, extra) => Object.assign({ id, barge, terminal: 'VOPAK', grade: 'VLSFO', qty: 5000, startAt: iso(h), endAt: iso(h + hrs), preOpsHours: 2.5, postOpsHours: 3.5, pumpHours: 6, estimatedHours: hrs, endOverridden: false, surveyor: '', notes: '', updatedAt: NOW }, extra || {});
  const recAt = (page, id) => page.evaluate(id => { const r = _loadingRecords.find(x => x.id === id); return r && { start: new Date(r.startAt).getTime(), end: new Date(r.endAt).getTime(), req: r.reqStartAt || null, note: _xferMovedNote(r), deleted: !!r.deletedAt }; }, id);

  await scenario('T6 the discharging barge loads after the transfer', async (openT) => {
    // as on 22 Nov: transfer FNSA 10 → FNSA 11 typed at +23h (inside HAYAT), FNSA 10 loading typed at +34h (12h)
    const db = H.createDb({ workspace: seed(SHIPS(), [xfer('x1', 23), loading('l10', 'FNSA 10', 34, 12)]), realtime: false });
    const A = await openT(db, 'user-operator');
    const g = await generate(A.page);
    const l = await recAt(A.page, 'l10');
    const xStart = g.hayat.etc + 2 * HR;
    check('T6 the transfer goes right after HAYAT — FNSA 10\'s loading does not hold it back', g.x1.start === xStart && g.x1.end === xStart + 7.75 * HR, { x1: g.x1, expected: new Date(xStart).toISOString() });
    check('T6 FNSA 10\'s loading moves to right after the transfer (+ travel), same length; the start typed is kept', l.start === g.x1.end + HR && l.end - l.start === 12 * HR && l.req === iso(34), { l, x1end: g.x1.end });
    check('T6 the loading says it was moved after the barge transfer; a message says so', /^Moved after the barge transfer — asked for /.test(l.note) && g.toasts.some(t => /Transfer first: Loading on FNSA 10 moved to/.test(t)), { note: l.note, toasts: g.toasts });
    const cloud = (U.row(db).payload.state.loadingRecords || []).find(r => r.id === 'l10');
    check('T6 the loading\'s new times reach the cloud', cloud && new Date(cloud.startAt).getTime() === l.start && cloud.reqStartAt === iso(34), cloud);
    const g2 = await generate(A.page); const l2 = await recAt(A.page, 'l10');
    check('T6 generating again moves nothing', g2.x1.start === g.x1.start && l2.start === l.start, { g2: g2.x1, l2 });
    // the transfer is removed: the loading goes back to the start typed
    const back = await A.page.evaluate(async () => { const r = _loadingRecords.find(x => x.id === 'x1'); r.deletedAt = Date.now(); r.updatedAt = Date.now(); return true; });
    await generate(A.page); const l3 = await recAt(A.page, 'l10');
    check('T6 once the transfer is gone, generating again puts the loading back at the start typed', back && l3.start === at(34) && l3.note === '', l3);
  });

  await scenario('T7 a loading of the receiving barge', async (openT) => {
    // FNSA 11 loads at +31h for 5h, asked for after the transfer (+23h): the transfer is done first
    const db = H.createDb({ workspace: seed(SHIPS(), [xfer('x1', 23), loading('l11', 'FNSA 11', 31, 5)]), realtime: false });
    const A = await openT(db, 'user-operator');
    const g = await generate(A.page);
    const l = await recAt(A.page, 'l11');
    const xStart = g.hayat.etc + 2 * HR;
    check('T7 the transfer is done before the receiving barge\'s loading (asked for later): transfer right after HAYAT, the loading right after the transfer', g.x1.start === xStart && l.start === g.x1.end + HR && l.end - l.start === 5 * HR && l.req === iso(31), { l, x1: g.x1, xStart });
  });

  await scenario('T11 a loading asked for before the transfer', async (openT) => {
    // FNSA 10 loads from +22h for 12h — asked for before the transfer (+23h): it keeps its place, the transfer waits for it
    const db = H.createDb({ workspace: seed(SHIPS(), [xfer('x1', 23), loading('l10', 'FNSA 10', 22, 12)]), realtime: false });
    const A = await openT(db, 'user-operator');
    const g = await generate(A.page);
    const l = await recAt(A.page, 'l10');
    check('T11 a loading asked for before the transfer keeps its place; the transfer goes after it (+ travel)', l.start === at(22) && l.req === null && g.x1.start === at(34) + HR, { l, x1: g.x1 });
  });

  await scenario('T12 both barges load after the transfer (27 Nov)', async (openT) => {
    // as on 27 Nov: transfer asked for +23h; FNSA 10 loads +29h (17h) and FNSA 11 loads +29h (15h), both asked for later
    const db = H.createDb({ workspace: seed(SHIPS(), [xfer('x1', 23), loading('l10', 'FNSA 10', 29, 17), loading('l11', 'FNSA 11', 29, 15)]), realtime: false });
    const A = await openT(db, 'user-operator');
    const g = await generate(A.page);
    const l10 = await recAt(A.page, 'l10'), l11 = await recAt(A.page, 'l11');
    const xStart = g.hayat.etc + 2 * HR;
    check('T12 the transfer goes right after the supplies (not pushed behind the loadings)', g.x1.start === xStart, { x1: g.x1, xStart });
    check('T12 …and both barges\' loadings follow it (+ travel), each keeping its length', l10.start === g.x1.end + HR && l11.start === g.x1.end + HR && l10.end - l10.start === 17 * HR && l11.end - l11.start === 15 * HR, { l10, l11, x1end: g.x1.end });
  });

  await scenario('T8 a loading added on the discharging barge', async (openT) => {
    const db = H.createDb({ workspace: seed(SHIPS(), [xfer('x1', 23)]), realtime: false });
    const A = await openT(db, 'user-operator');
    const g = await generate(A.page);
    const r = await A.page.evaluate(async (s0) => {
      showPage('loading');
      const k = document.getElementById('ld-kind'); k.value = 'loading'; k.dispatchEvent(new Event('change'));
      document.getElementById('ld-barge').value = 'FNSA 10'; document.getElementById('ld-terminal').value = 'GPS'; document.getElementById('ld-qty').value = '900';
      const s = new Date(s0);
      document.getElementById('ld-start-date').value = _localDateInputStr(s); document.getElementById('ld-start-time').value = _localTimeInputStr(s);
      window.__confirms = []; addLoadingRecord(); await _waitForSaveIdle();
      const l = _loadingRecords.find(x => x.terminal === 'GPS');
      editLoadingRecord(l.id);
      const typed = document.getElementById('ld-start-time').value; cancelLoadingEdit();
      return { start: new Date(l.startAt).getTime(), req: l.reqStartAt, confirms: window.__confirms.length, typed };
    }, new Date(g.x1.start + HR).toISOString());
    const typedLocal = new Date(g.x1.start + HR + 4 * HR);
    check('T8 a loading typed on FNSA 10 inside the transfer is placed after it at once (no warning); Edit opens with the start typed', r.start === g.x1.end + HR && r.req === new Date(g.x1.start + HR).toISOString() && r.confirms === 0 && r.typed === String(typedLocal.getUTCHours()).padStart(2, '0') + ':' + String(typedLocal.getUTCMinutes()).padStart(2, '0'), r);
  });

  await scenario('T9 4,400 MT fits the gap after HAYAT', async (openT) => {
    // HAYAT on FNSA 11 ends +29h (+ 1h contingency + 1h travel = +31h); HUA CHUANG 66 comes at +48h
    // (+ 1h travel before it): a 16h gap. 4,400 MT saved with the old figures (÷ 300 + 6h = 20h 40m)
    // would not fit; at 400 MT/h + 4h ops = 15h it does.
    const big = xfer('x1', 23, { qty: 4400, pumpHours: 4400 / 300, hoseHours: 6, estimatedHours: 4400 / 300 + 6, endAt: iso(23 + 4400 / 300 + 6) });
    const db = H.createDb({ workspace: seed(SHIPS().concat([vessel('n3', 'HUA CHUANG 66', 48, 150, 2)]), [big]), realtime: false });
    const A = await openT(db, 'user-operator');
    const g = await generate(A.page);
    const r = await A.page.evaluate(() => { const r = _loadingRecords.find(x => x.id === 'x1'); return { pump: r.pumpHours, hose: r.hoseHours, est: r.estimatedHours }; });
    const hua = await A.page.evaluate(() => { const j = _lastSched.find(x => x.name === 'HUA CHUANG 66'); return new Date(j.bargeStart).getTime(); });
    check('T9 the transfer is 15h now (11h at 400 MT/h + 4h ops) and goes right after HAYAT, before HUA CHUANG 66', g.x1.start === g.hayat.etc + 2 * HR && g.x1.end - g.x1.start === 15 * HR && r.pump === 11 && r.hose === 4 && r.est === 15, { x1: g.x1, r, hayatEtc: g.hayat.etc });
    const dur = await A.page.evaluate(() => [...document.querySelectorAll('#tl-2 .tli-transfer .tmi-xfer-dur')].map(e => e.textContent.replace(/\s+/g, ' ').trim()));
    check('T9 the transfer card shows its duration: 15h (11h pumping at 400 MT/h + 4h ops)', dur.length === 1 && dur[0] === 'Duration15h (11h pumping at 400 MT/h + 4h ops)', dur);
    check('T9 HUA CHUANG 66 is still supplied at its ETA', Math.abs(hua - at(48)) < 60000, { hua, eta: at(48) });
  });

  await scenario('T10 the transfer counts in the stock forecast', async (openT) => {
    // FNSA 11: 3,000 MT VLSFO − JIN YU FU TONG 400 − HAYAT 750 = 1,850; GREEN SACHI (+48h) needs 2,000
    // → short without the transfer; with 1,500 MT from FNSA 10 (after HAYAT) it has enough.
    const db = H.createDb({ workspace: seed(SHIPS().concat([vessel('n4', 'GREEN SACHI', 48, 2000, 2)]), [xfer('x1', 23)]), realtime: false });
    const A = await openT(db, 'user-operator');
    await generate(A.page);
    const f = await A.page.evaluate(() => {
      const fc11 = _bargeStockForecast(2, 7 * 24), fc10 = _bargeStockForecast(1, 7 * 24);
      const x11 = fc11.events.find(e => e.xfer === 'in'), x10 = fc10.events.find(e => e.xfer === 'out');
      const gs = fc11.events.find(e => e.kind === 'vessel' && e.vessel === 'GREEN SACHI');
      const list = document.createElement('div'); list.innerHTML = _rlEventListHtml(fc11);
      return { recs11: fc11.recs.map(r => r.grade), inQ: x11 && x11.dv, afterGs: gs && gs.v, outQ: x10 && x10.dv, v10: x10 && x10.v,
        line: [...list.querySelectorAll('li.rl-xfer')].map(li => li.textContent) };
    });
    check('T10 the receiving barge counts the transfer as loaded at its end: GREEN SACHI is covered, no VLSFO reload asked for', f.inQ === 1500 && f.afterGs === 1350 && !f.recs11.includes('VLSFO'), f);
    check('T10 the discharging barge gives it at the start: FNSA 10\'s stock goes down by 1,500', f.outQ === -1500 && f.v10 === 4500, f);
    check('T10 the forecast\'s events list it as a barge transfer', f.line.length === 1 && /Barge transfer from FNSA 10: \+1,500 MT VLSFO/.test(f.line[0]), f.line);
  });

  await scenario('T13 two-way at the same time', async (openT) => {
    // FNSA 10 → FNSA 11 and FNSA 11 → FNSA 10 both asked for +40h: they run together
    const back = xfer('x2', 40, { fromBarge: 'FNSA 11', barge: 'FNSA 10', grade: 'LSMGO', qty: 300 });
    const db = H.createDb({ workspace: seed(SHIPS(), [xfer('x1', 40), back]), realtime: false });
    const A = await openT(db, 'user-operator');
    await generate(A.page);
    const a = await recAt(A.page, 'x1'), b = await recAt(A.page, 'x2');
    check('T13 a transfer each way between the same two barges runs at the same time (neither waits)', a.start === at(40) && b.start === at(40), { a, b });
  });

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
