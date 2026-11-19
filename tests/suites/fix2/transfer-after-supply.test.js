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
   • one already under way still holds the vessels back
   • adding / editing a transfer places it at once against the current schedule; the edit form
     opens with the start typed; once the supply is gone it goes back to the start typed
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
// 1,500 MT at FNSA 10's 300 MT/h = 5h + 6h hose-up = 11h
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
    check('T1 the transfer moves to right after HAYAT (ETC + contingency + travel), still 11h long', g.x1 && g.x1.start === after && g.x1.end - g.x1.start === 11 * HR, { x1: g.x1, expected: new Date(after).toISOString() });
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
      document.getElementById('ld-qty').value = '1800'; // 6h + 6h hose
      submitLoadingForm(); await _waitForSaveIdle();
      const r = _loadingRecords.find(x => x.id === id);
      return { d, t, start: new Date(r.startAt).getTime(), hrs: (new Date(r.endAt) - new Date(r.startAt)) / 3600000, req: r.reqStartAt };
    }, add.id);
    const typed = new Date(at(22) + 4 * HR);
    check('T4 Edit opens with the start that was typed (not the moved one); saving keeps it after HAYAT with the new length', ed.t === String(typed.getUTCHours()).padStart(2, '0') + ':' + String(typed.getUTCMinutes()).padStart(2, '0') && ed.start === after && ed.hrs === 12 && ed.req === iso(22), ed);
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

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
