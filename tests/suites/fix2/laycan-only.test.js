/* "Laycan only": a vessel due before its laycan opens can be held to the laycan.
   • a nomination with ETA before its laycan is planned at the ETA → row tagged "Before Laycan"
     with a "Supply in laycan" button (operators only)
   • the button ticks "Laycan only" on the card, plans again: the barge starts at the laycan
     opening, the row says "On Laycan · held", the flag is in the cloud and on a fresh device
   • unticking plans it early again and removes the flag
   • a time-frame ETA (AM) before the laycan is held the same way (no frame wait at the laycan)
   • a trader sees no button
   • the button with an incomplete card elsewhere: the tick is saved, no false "planned" message (L5)
   • the nomination e-mail carries "Supply within laycan only" (L6)
   node suites/fix2/laycan-only.test.js [appDir] */
const path = require('path');
if (process.argv[2]) process.env.APP_DIR = path.resolve(process.argv[2]);
const H = require(path.join(__dirname, '..', '..', 'harness', 'harness.js'));
const U = require(path.join(__dirname, '..', 'r3', 'util.js'));

let pass = 0, fail = 0;
function check(name, cond, info) {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 600)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = n => String(n).padStart(2, '0');
const dayAt = (d, h) => { const x = new Date(Date.now() + d * 864e5); x.setHours(h, 0, 0, 0); return x; };
const fmtDT = x => `${p2(x.getDate())} ${MO[x.getMonth()]} ${x.getFullYear()} ${p2(x.getHours())}:${p2(x.getMinutes())}`;
const fmtD = x => `${x.getDate()} ${MO[x.getMonth()]} ${x.getFullYear()}`;
// Laycan: day +3 to day +5 (written with both month names, so a month boundary is fine).
const LC_FROM = dayAt(3, 0), LC_TO = dayAt(5, 0);
const LC = `${fmtD(LC_FROM)} - ${fmtD(LC_TO)}`;
const VBASE = { imo: '', area: 'FUJ-A', spec: 'ISO 8217:2010', agent: 'AG', manifold: 'VESSEL MANIFOLD', remarks: '', paq: 'no', bargeId: '', refuelChk: false, rfv: 0, rfm: 0, rfvr: 750, rfmr: 275 };
const BARGE = { vcap: 5000, mcap: 1000, vbuf: 500, mbuf: 150, vtph: 300, mtph: 100, vrfr: 750, mrfr: 275 };

function seed(o) {
  o = o || {};
  const vs = [Object.assign({}, VBASE, { nomUid: 'n1', name: 'ALPHA', type: 'VLSFO', qty: 800, mgo: 0, eta: fmtDT(dayAt(1, 6)), lc: LC }, o.n1 || {})];
  if (o.two) vs.push(Object.assign({}, VBASE, { nomUid: 'n2', name: 'BRAVO', type: 'VLSFO', qty: 500, mgo: 0, eta: fmtDT(dayAt(4, 9)), lc: LC }));
  const s = U.seedPayload({ vessels: vs });
  s.state.barges = [Object.assign({ id: 1, name: 'Barge 1', vrob: 4000, mrob: 800 }, BARGE)];
  return s;
}
async function open(browser, db, uid) {
  const a = await U.open(browser, db, uid);
  await U.helpers(a);
  await a.page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
  return a;
}
const generate = p => p.evaluate(async () => { calculate(); await _waitForSaveIdle(); });
// The planned item for a nomination, plus what its schedule row shows.
const planned = (p, nu) => p.evaluate(nu => {
  const it = (_lastSched || []).find(x => x.nomUid === nu);
  const row = document.querySelector('tr[data-nu="' + nu + '"]');
  const txt = row ? row.textContent.replace(/\s+/g, ' ') : '';
  // lcFrom: the laycan opening as the PAGE parsed it (its own timezone) — the expectation for a held start.
  return it ? { held: !!it.held, lcOnly: !!it.lcOnly, early: !!it.isEarly, start: new Date(it.bargeStart).getTime(), lcFrom: it.lc && it.lc.from ? new Date(it.lc.from).getTime() : null, tag: /Before Laycan/.test(txt) ? 'early' : /On Laycan · held/.test(txt) ? 'held' : /On Laycan/.test(txt) ? 'on' : '?', btn: !!(row && row.querySelector('.lc-hold-btn')) } : null;
}, nu);
const cloudV = (db, nu) => U.row(db).payload.state.vessels.find(v => v.nomUid === nu);
const ticked = (p, nu) => p.evaluate(nu => !!document.getElementById('v' + __cardFor(nu) + '-lconly').checked, nu);

(async () => {
  const browser = await H.launch();
  const scenario = async (name, fn) => {
    console.log('— ' + name);
    const apps = [];
    try { await fn(async (db, uid) => { const a = await open(browser, db, uid); apps.push(a); return a; }); }
    catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
    const errs = [].concat(...apps.map(a => U.realErrors(a)));
    check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
    for (const a of apps) await a.ctx.close();
  };

  /* L1 — early arrival: button → held to the laycan, synced */
  await scenario('L1 button holds the supply to the laycan', async (openT) => {
    const db = H.createDb({ workspace: seed({ two: true }), realtime: false });
    const A = await openT(db, 'user-operator');
    await generate(A.page);
    const before = await planned(A.page, 'n1');
    check('L1 ETA before the laycan: planned at the ETA, tagged "Before Laycan", with the button', before && before.early && !before.held && before.tag === 'early' && before.btn && before.lcFrom && before.start < before.lcFrom, before);
    await A.page.evaluate(async () => { document.querySelector('tr[data-nu="n1"] .lc-hold-btn').click(); await _waitForSaveIdle(); });
    const after = await planned(A.page, 'n1');
    check('L1 after the button: "Laycan only" ticked, planned again from the laycan opening, tagged "On Laycan · held", no button', (await ticked(A.page, 'n1')) && after && after.held && after.lcOnly && !after.early && after.tag === 'held' && !after.btn && after.start === after.lcFrom, after);
    check('L1 the flag is in the cloud (lcOnly: true) and BRAVO is untouched', cloudV(db, 'n1').lcOnly === true && !('lcOnly' in cloudV(db, 'n2')), [cloudV(db, 'n1'), cloudV(db, 'n2')]);
    const b2 = await planned(A.page, 'n2');
    check('L1 BRAVO (ETA inside the laycan) is still "On Laycan" without a button', b2 && b2.tag === 'on' && !b2.btn && !b2.held, b2);
    const F = await openT(db, 'user-operator');
    await generate(F.page);
    const fresh = await planned(F.page, 'n1');
    check('L1 a fresh device: tick restored, same plan (held from the laycan opening)', (await ticked(F.page, 'n1')) && fresh && fresh.held && fresh.start === fresh.lcFrom, fresh);
    // untick → early again
    await A.page.evaluate(async () => { const b = document.getElementById('v' + __cardFor('n1') + '-lconly'); b.checked = false; toggleLcOnly(__cardFor('n1')); await _waitForSaveIdle(); });
    await generate(A.page);
    const again = await planned(A.page, 'n1');
    check('L1 unticked: planned early again, the flag gone from the cloud', again && again.early && !again.held && again.tag === 'early' && again.btn && !('lcOnly' in cloudV(db, 'n1')), [again, cloudV(db, 'n1')]);
  });

  /* L2 — a time-frame ETA before the laycan */
  await scenario('L2 time frame before the laycan', async (openT) => {
    const db = H.createDb({ workspace: seed({ n1: { eta: fmtDT(dayAt(1, 0)), etaWin: 'AM', lcOnly: true } }), realtime: false });
    const A = await openT(db, 'user-operator');
    await generate(A.page);
    const it = await planned(A.page, 'n1');
    const v = await A.page.evaluate(() => { const x = getVessels(true).find(y => y.nomUid === 'n1'); return { held: x.held, winHrs: x.winHrs, frameEnd: _vesselFrameEnd(x), eff: x.effectiveETA.getTime() }; });
    check('L2 AM frame a day before the laycan, Laycan only: held, the frame kept on the row but no frame wait at the laycan, starts at the laycan opening', it && it.held && v.held && v.winHrs === 6 && v.frameEnd === null && v.eff === it.lcFrom && it.start === it.lcFrom, [it, v]);
  });

  /* L5 — the button while another card is incomplete: tick saved, honest message */
  await scenario('L5 button with an incomplete card elsewhere', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db, 'user-operator');
    await generate(A.page);
    await A.page.evaluate(async () => { window.__toasts = []; const o = showToast; showToast = function(m, t) { window.__toasts.push([String(m), t]); return o.apply(this, arguments); }; addVessel({ name: 'NEWCOMER' }); await _waitForSaveIdle(); });
    await A.page.evaluate(async () => { document.querySelector('tr[data-nu="n1"] .lc-hold-btn').click(); await _waitForSaveIdle(); });
    const r = { ticked: await ticked(A.page, 'n1'), cloud: cloudV(db, 'n1').lcOnly, toasts: (await A.page.evaluate(() => window.__toasts)).filter(Array.isArray) };
    check('L5 the plan could not run (NEWCOMER has no ETA/laycan): the tick is saved to the cloud, and the message says so — no success message', r.ticked && r.cloud === true && r.toasts.some(t => /ticked and saved/.test(t[0]) && t[1] === 'warning') && !r.toasts.some(t => t[1] === 'success'), r);
    await A.page.reload({ waitUntil: 'load' }); await sleep(1500); await U.helpers(A);
    check('L5 …and survives a reload', await ticked(A.page, 'n1'));
  });

  /* L6 — the nomination e-mail carries the rule */
  await scenario('L6 e-mail line', async (openT) => {
    const db = H.createDb({ workspace: seed({ n1: { lcOnly: true } }), realtime: false });
    const A = await openT(db, 'user-operator');
    const r = await A.page.evaluate(async () => {
      window.__capt = null; sendNominationEmailIfNeeded = async v => { window.__capt = v; };
      await sendNominationEmailForCard(__cardFor('n1'));
      const v = window.__capt; return { lcOnly: v && v.lcOnly, body: v ? _buildNominationEmail(v).body : '' };
    });
    check('L6 the e-mail vessel carries lcOnly and the body says "Supply within laycan only"', r.lcOnly === true && /Supply within laycan only/.test(r.body), { lcOnly: r.lcOnly, has: /Supply within laycan only/.test(r.body) });
  });

  /* L4 — a trader sees the tag but no button */
  await scenario('L4 trader', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db, 'user-operator');
    await generate(A.page);
    const T = await openT(db, 'user-trader');
    await sleep(800);
    const t = await T.page.evaluate(() => { const row = document.querySelector('tr[data-nu="n1"]'); return { row: !!row, early: !!(row && /Before Laycan/.test(row.textContent)), btn: !!(row && row.querySelector('.lc-hold-btn')) }; });
    check('L4 trader: "Before Laycan" shown, no "Supply in laycan" button', t.row && t.early && !t.btn, t);
  });

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
