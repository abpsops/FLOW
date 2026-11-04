/* Track Record — out-of-laycan vessels flagged from the first supply, rolling 2-month watchlist,
   history kept for re-nominations.
   • a vessel that came after its laycan ONCE is flagged (no 2-supply minimum); "MT DAISY" = "DAISY"
   • a supply before the laycan opened (or held to it) is recorded on save (isEarly) and flagged
   • the whole history counts (July 2026 on); clean vessels are not listed
   • the Dashboard watchlist keeps only the last 2 months: an older flag drops off by itself…
   • …but the history stays: that vessel nominated again is back on the watchlist ("Nominated
     again", first), its card shows the banner, the bell lists it (click → card, new = toast) and
     Generate Schedule warns once (never blocks)
   • a clean vessel or one with no history raises nothing; a trader sees the bell entry too
   node suites/fix2/trackrecord-laycan.test.js [appDir] */
const path = require('path');
if (process.argv[2]) process.env.APP_DIR = path.resolve(process.argv[2]);
const H = require(path.join(__dirname, '..', '..', 'harness', 'harness.js'));
const U = require(path.join(__dirname, '..', 'r3', 'util.js'));

let pass = 0, fail = 0;
function check(name, cond, info) {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 700)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = n => String(n).padStart(2, '0');
const DAY = 864e5, NOW = Date.now();
const monthKey = t => { const d = new Date(t); return d.getFullYear() + '-' + p2(d.getMonth() + 1); };
const fmtDT = d => `${p2(d.getDate())} ${MO[d.getMonth()]} ${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
const fmtD = d => `${p2(d.getDate())} ${MO[d.getMonth()]} ${d.getFullYear()}`;
let seq = 0;
const ent = (vessel, daysAgo, extra) => { seq++; const t = NOW - daysAgo * DAY; return Object.assign({ id: 'sup_' + seq, checklistUid: 'cl_' + seq, vessel, dateStr: fmtD(new Date(t)), supplyDate: new Date(t).toISOString(), barge: 'Barge 1', vlsfoAct: 500, mgoAct: 0, loggedAt: new Date(t).toISOString(), updatedAt: t }, extra || {}); };
// deliveryLog from [bucket, entry] pairs, filed by the entry's month
function log(list) {
  const dl = {};
  list.forEach(([bucket, e]) => { const k = monthKey(e.supplyDate); dl[k] = dl[k] || { timely: [], delayed: [], disputes: [] }; dl[k][bucket].push(e); });
  return dl;
}
const VB = { imo: '', area: 'FUJ-A', type: 'VLSFO', mgo: 0, spec: 'ISO 8217:2010', agent: 'AG', manifold: 'VESSEL MANIFOLD', remarks: '', paq: 'no', bargeId: '', refuelChk: false, rfv: 0, rfm: 0, rfvr: 750, rfmr: 275 };
const nom = (nomUid, name, daysAhead) => { const eta = new Date(NOW + daysAhead * DAY); eta.setHours(8, 0, 0, 0); const lc0 = new Date(eta.getTime() - DAY), lc1 = new Date(eta.getTime() + DAY); return Object.assign({}, VB, { nomUid, name, qty: 500, eta: fmtDT(eta), lc: `${p2(lc0.getDate())}-${p2(lc1.getDate())} ${MO[lc1.getMonth()]} ${lc1.getFullYear()}` }); };

(async () => {
  const browser = await H.launch();
  const scenario = async (name, fn) => {
    if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return;
    console.log('— ' + name);
    const apps = [];
    try { await fn(async (db, uid) => { const a = await U.open(browser, db, uid); await U.helpers(a); await a.page.evaluate(() => { window.__toasts = []; window.alert = () => {}; window.confirm = () => true; }); /* U.helpers already records toasts */ apps.push(a); return a; }); }
    catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
    const errs = [].concat(...apps.map(a => U.realErrors(a)));
    check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
    for (const a of apps) await a.ctx.close();
  };
  const watch = p => p.evaluate(() => { renderTrackRecordWatchlist(); return [...document.querySelectorAll('#dash-track-record-watchlist details.tr-watch-row')].map(r => ({ name: r.dataset.vessel, text: r.querySelector('summary').textContent.replace(/\s+/g, ' '), body: r.textContent.replace(/\s+/g, ' '), bg: r.style.background })); });

  /* T1 — flagged from the first supply; names merged; clean vessels not listed; whole history */
  await scenario('T1 first supply, names, history', async (openT) => {
    const dl = log([
      ['delayed', ent('STAR NINA', 10)],                 // late once → flagged
      ['timely', ent('MT DAISY', 20)], ['delayed', ent('DAISY', 8)], // one vessel, late once
      ['timely', ent('SEA VALIANT', 5)], ['timely', ent('SEA VALIANT', 3)],   // clean
      ['delayed', ent('INCE ANADOLU', 110)],             // late, 110 days ago (Jul/Aug) — history only
      ['timely', ent('MV ATREBATES', 12, { flagUnready: true })],
    ]);
    const db = H.createDb({ workspace: U.seedPayload({ deliveryLog: dl }), realtime: false });
    const A = await openT(db, 'user-operator');
    const w = await watch(A.page);
    const names = w.map(r => r.name);
    check('T1 a vessel that came after laycan once is listed (STAR NINA, no 2-supply minimum)', w.some(r => r.name === 'STAR NINA' && /After laycan ×1/.test(r.text)), w);
    check('T1 "MT DAISY" and "DAISY" are one vessel: one row, after laycan ×1, 2 supplies in its history', names.filter(n => /DAISY/.test(n)).length === 1 && w.some(r => r.name === 'DAISY' && /After laycan ×1/.test(r.text) && /All supplies: 2/.test(r.body)), w);
    check('T1 a clean vessel is not listed; an unready flag is (red)', !names.includes('SEA VALIANT') && w.some(r => r.name === 'ATREBATES' && /Unready ×1/.test(r.text) && /red/.test(r.bg)), w);
    check('T1 a late supply older than 2 months is not on the watchlist', !names.includes('INCE ANADOLU'), names);
    const tr = await A.page.evaluate(() => { const t = computeVesselTrackRecord('ince anadolu'); const d = computeVesselTrackRecord('m/t daisy'); return { late: t && t.late, total: t && t.total, dl: d && d.late, dt: d && d.total }; });
    check('T1 …but its history is kept (computeVesselTrackRecord: late 1 of 1); MT/M-T prefixes match', tr.late === 1 && tr.total === 1 && tr.dl === 1 && tr.dt === 2, tr);
    const keys = await A.page.evaluate(() => ['MT DAISY', 'M/T Daisy', 'm.t. daisy', 'MV DAISY', 'Daisy'].map(_trVesselKey));
    check('T1 vessel key ignores MT / M/T / M.T. / MV prefixes', new Set(keys).size === 1 && keys[0] === 'daisy', keys);
  });

  /* T2 — re-nomination: banner, bell (click → card), watchlist "Nominated again", Generate Schedule warning */
  await scenario('T2 nominated again', async (openT) => {
    const dl = log([['delayed', ent('INCE ANADOLU', 110)], ['timely', ent('SEA VALIANT', 5)], ['timely', ent('SEA VALIANT', 3)], ['timely', ent('LONE ONE', 4)]]);
    const db = H.createDb({ workspace: U.seedPayload({ deliveryLog: dl, vessels: [nom('n1', 'M/V Ince Anadolu', 3), nom('n2', 'SEA VALIANT', 4), nom('n3', 'LONE ONE', 5)] }), realtime: false });
    const A = await openT(db, 'user-operator');
    await sleep(900);
    const card = await A.page.evaluate(() => { const b = id => (document.getElementById('v' + __cardFor(id) + '-track-record') || {}).textContent || ''; return { n1: b('n1').replace(/\s+/g, ' '), n2: b('n2').replace(/\s+/g, ' '), n3: b('n3') }; });
    check('T2 the card of the returning vessel shows the banner: came after its laycan 1×, with the date', /Came after its laycan 1×/.test(card.n1) && /last \d{2} [A-Z][a-z]{2} \d{4}/.test(card.n1), card);
    check('T2 a clean vessel with 2 supplies shows the green "within laycan" banner; a clean single supply shows nothing', /Within laycan on all 2/.test(card.n2) && card.n3 === '', card);
    const bell = await A.page.evaluate(() => { _refreshGlobalAlertsBell(); return [...document.querySelectorAll('#global-alerts-list [data-alert-key]')].map(e => ({ key: e.dataset.alertKey, text: e.textContent.replace(/\s+/g, ' ').trim() })); });
    const tb = bell.filter(b => /^tr\|/.test(b.key));
    check('T2 the bell lists it once: "Nominated again — came outside laycan before", after laycan 1×', tb.length === 1 && tb[0].key === 'tr|n1' && /Nominated again/.test(tb[0].text) && /after laycan 1×/.test(tb[0].text), bell);
    const go = await A.page.evaluate(async () => { showPage('dashboard'); document.querySelector('#global-alerts-list [data-alert-key="tr|n1"]').click(); await new Promise(r => setTimeout(r, 400)); return { page: _currentPage }; });
    check('T2 clicking it opens the nomination card (Nominations page)', go.page === 'nominations', go);
    const w = await watch(A.page);
    check('T2 the watchlist shows it again (older than 2 months) as "Nominated again" with the ETA, first', w.length >= 1 && w[0].name === 'INCE ANADOLU' && /Nominated again — ETA/.test(w[0].text) && /nothing in the last 2 months/.test(w[0].text) && /New nomination/.test(w[0].body), w);
    const gen = await A.page.evaluate(async () => { window.__toasts = []; calculate(); await _waitForSaveIdle(); return { toasts: window.__toasts.filter(t => /Track record/.test(t)), planned: (_lastSched || []).length }; });
    check('T2 Generate Schedule warns once naming the vessel, and still plans every nomination', gen.toasts.length === 1 && /Ince Anadolu \(after laycan 1×\)/i.test(gen.toasts[0]) && /Planned as usual/.test(gen.toasts[0]) && gen.planned === 3, gen);
  });

  /* T3 — a vessel typed in a new card raises the alert (toast once); removed → gone */
  await scenario('T3 typing a flagged name', async (openT) => {
    const dl = log([['delayed', ent('STAR NINA', 15)]]);
    const db = H.createDb({ workspace: U.seedPayload({ deliveryLog: dl }), realtime: false });
    const A = await openT(db, 'user-operator');
    await sleep(800);
    const r = await A.page.evaluate(async () => {
      _refreshGlobalAlertsBell(); window.__toasts = [];
      addVessel({ name: '' });
      const cid = document.querySelectorAll('.vcard[id^="vessel-"]')[document.querySelectorAll('.vcard[id^="vessel-"]').length - 1].id.replace('vessel-', '');
      const inp = document.getElementById('v' + cid + '-name');
      inp.value = 'star nina'; inp.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 1500));
      const banner = (document.getElementById('v' + cid + '-track-record') || {}).textContent || '';
      const keys = [...document.querySelectorAll('#global-alerts-list [data-alert-key]')].map(e => e.dataset.alertKey);
      return { banner, toasts: window.__toasts.filter(t => /Nominated again/.test(t)), tr: keys.filter(k => /^tr\|/.test(k)).length };
    });
    check('T3 typing a flagged vessel into a new card: banner, bell entry, one toast', /Came after its laycan 1×/.test(r.banner) && r.tr === 1 && r.toasts.length === 1, r);
  });

  /* T4 — early recorded on save (isEarly / held), flagged; late stays late */
  await scenario('T4 early recorded on save', async (openT) => {
    const db = H.createDb({ workspace: U.seedPayload({}), realtime: false });
    const A = await openT(db, 'user-operator');
    const r = await A.page.evaluate(async () => {
      const sup = (uid, vessel, flags) => { const rec = Object.assign({ uid, vessel, bargeLabel: 'Barge 1', notes: '' }, flags); _checklistRecords[uid] = rec; _logDelivery(rec, { id: 'sup_' + uid, supplyDate: new Date().toISOString(), dateStr: 'today', vlsfoAct: 300, mgoAct: 0 }); };
      sup('e1', 'EARLY BIRD', { isDelayed: false, isEarly: true });
      sup('l1', 'LATE ONE', { isDelayed: true, isEarly: false });
      sup('w1', 'WITHIN ONE', { isDelayed: false, isEarly: false });
      await saveSharedState(); await _waitForSaveIdle();
      const all = Object.values(_deliveryLog).flatMap(m => [].concat(m.timely || [], m.delayed || []));
      const e = all.find(x => x.checklistUid === 'e1'), w = all.find(x => x.checklistUid === 'w1');
      showPage('dashboard');
      const rows = (renderTrackRecordWatchlist(), [...document.querySelectorAll('#dash-track-record-watchlist details.tr-watch-row')].map(x => [x.dataset.vessel, x.querySelector('summary').textContent.replace(/\s+/g, ' ')]));
      return { eEarly: e && e.isEarly, wHas: w && ('isEarly' in w), rows };
    });
    check('T4 a supply before the laycan is saved with isEarly (only when true)', r.eEarly === true && r.wHas === false, r);
    check('T4 the watchlist shows "Before laycan ×1" and "After laycan ×1"; the within-laycan supply is not listed', r.rows.some(x => x[0] === 'EARLY BIRD' && /Before laycan ×1/.test(x[1])) && r.rows.some(x => x[0] === 'LATE ONE' && /After laycan ×1/.test(x[1])) && !r.rows.some(x => x[0] === 'WITHIN ONE'), r.rows);
    const cloud = Object.values(U.row(db).payload.state.deliveryLog).flatMap(m => [].concat(m.timely || [], m.delayed || []));
    check('T4 isEarly reaches the cloud', cloud.some(x => x.vessel === 'EARLY BIRD' && x.isEarly === true), cloud.map(x => [x.vessel, x.isEarly]));
    // the checklist record takes isEarly (or held) from the schedule
    const ck = await A.page.evaluate(() => { const lc0 = new Date(Date.now() + 5 * 864e5); const id = __cardFor('n1'); const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], p = n => String(n).padStart(2, '0');
      const eta = new Date(Date.now() + 864e5); eta.setHours(8, 0, 0, 0); const l1 = new Date(lc0.getTime() + 2 * 864e5);
      __setV('n1', 'eta', `${p(eta.getDate())} ${MO[eta.getMonth()]} ${eta.getFullYear()} 08:00`); __setV('n1', 'lc', `${p(lc0.getDate())} ${MO[lc0.getMonth()]} ${lc0.getFullYear()} - ${p(l1.getDate())} ${MO[l1.getMonth()]} ${l1.getFullYear()}`);
      calculate(); renderChecklist(_lastSched || []); const rec = Object.values(_checklistRecords).find(r => r.nomUid === 'n1'); return { isEarly: rec && rec.isEarly, item: (_lastSched.find(i => i.nomUid === 'n1') || {}).isEarly }; });
    check('T4 a nomination due before its laycan: its checklist record carries isEarly', ck.isEarly === true && ck.item === true, ck);
  });

  /* T5 — trader sees the bell entry; nothing for vessels without history */
  await scenario('T5 trader, no history', async (openT) => {
    const dl = log([['delayed', ent('STAR NINA', 15)]]);
    const db = H.createDb({ workspace: U.seedPayload({ deliveryLog: dl, vessels: [nom('n1', 'STAR NINA', 3), nom('n2', 'BRAND NEW', 4)] }), realtime: false });
    const T = await openT(db, 'user-trader');
    await sleep(900);
    const t = await T.page.evaluate(() => { _refreshGlobalAlertsBell(); return [...document.querySelectorAll('#global-alerts-list [data-alert-key]')].map(e => e.dataset.alertKey).filter(k => /^tr\|/.test(k)); });
    check('T5 a trader sees the bell entry for the returning vessel only (not for a vessel with no history)', t.length === 1 && t[0] === 'tr|n1', t);
  });

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
