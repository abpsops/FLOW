/* The schedule planner core — planSchedule(), the pure function behind
   calculate() and the what-if sandbox.
   1. GOLDEN: 300 seeded random weeks (1–3 barges, 2–9 vessels, laycans early /
      on time / delayed, no-firm ETAs, time frames, refuels, pinned barges,
      Unavailable blocks, saved supplies, reloads) are generated and run through
      calculate(); the full schedule, alerts and barge states must equal what the
      planner produced before it was split into a pure core (golden.json).
        GOLDEN=write APP_DIR=<old app> node planner.test.js     re-record
   2. PURITY: planSchedule() never touches its inputs, the DOM or app state.
   node suites/planner/planner.test.js [appDir] */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const H = require('../../harness/harness.js');
const appDir = process.argv[2] || H.APP_DIR;
const GOLDEN_FILE = path.join(__dirname, 'golden.json');
const WRITE = process.env.GOLDEN === 'write';
const SEEDS = parseInt(process.env.SEEDS, 10) || 300;

let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) pass++; else fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 700)));
}

// Installed in the page: a seeded week generator + a dump of everything calculate() produces.
const HELPERS = () => {
  const p = n => String(n).padStart(2, '0');
  const fmt = d => p(d.getDate()) + ' ' + MO[d.getMonth()] + ' ' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  const mulberry = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  window.__toastLog = [];
  const realToast = window.showToast;
  window.showToast = function (m) { window.__toastLog.push(String(m)); };
  window.__reset = function () {
    const o = document.getElementById('flow-welcome-overlay'); if (o) o.style.display = 'none';
    document.querySelectorAll('.vcard[id^="vessel-"]').forEach(c => c.remove());
    (_barges || []).slice().forEach(b => rmBarge(b.id));
    _lastSched = []; _checklistRecords = {}; _savedSupplies = []; _deliveryLog = {}; _loadingRecords = []; _bargeBlocks = []; _bargeReloads = []; _manualROB = {}; _bakedSupplyIds = {};
    _calcParams.travelHrs = 1; _calcParams.hoseHrs = 6; _calcParams.contingencyHrs = 1;
    window.__toastLog.length = 0;
  };
  const NAMES = ['ALPHA STAR', 'BRAVO WAVE', 'CORAL SEA', 'DELTA QUEEN', 'EAGLE ONE', 'FJORD PRIDE', 'GALAXY TIDE', 'HARBOR MIST', 'IRON DUKE', 'JADE OCEAN'];
  const BNAMES = ['FNSA 10', 'FNSA 11', 'FNSA 12'];
  const FR = [['EAM', 0], ['AM', 6], ['NOON', 11], ['PM', 12], ['LPM', 18]];
  window.__build = function (seed) {
    __reset();
    const R = mulberry(seed), ri = (a, b) => a + Math.floor(R() * (b - a + 1)), pick = a => a[Math.floor(R() * a.length)], chance = q => R() < q;
    _calcParams.hoseHrs = pick([4, 6, 6, 8]); _calcParams.travelHrs = pick([0, 1, 1, 2]);
    const nb = pick([1, 1, 2, 2, 2, 3]), ids = [];
    for (let i = 0; i < nb; i++) {
      const vcap = pick([5000, 5000, 3000, 1500]), mcap = pick([1000, 1000, 600, 300]);
      addBarge({ name: BNAMES[i], vcap, mcap, vrob: chance(0.1) ? 0 : ri(0, vcap / 50) * 50, mrob: chance(0.1) ? 0 : ri(0, mcap / 25) * 25,
        vbuf: pick([0, 150, 500]), mbuf: pick([0, 50, 150]), vtph: pick([300, 300, 200, 100]), mtph: pick([100, 100, 60, 150]) });
      ids.push(_barges[_barges.length - 1].id);
    }
    const base = new Date(2026, 10, 5, 0, 0, 0, 0);
    const nv = ri(2, 9);
    for (let i = 0; i < nv; i++) {
      const type = pick(['VLSFO', 'VLSFO', 'MGO', 'BOTH']);
      const day = ri(0, 6), eta = new Date(base.getTime() + day * 86400000 + ri(6, 22 * 12) * 5 * 60000 / 1);
      eta.setMinutes(Math.round(eta.getMinutes() / 5) * 5, 0, 0);
      let etaStr = fmt(eta), etaWin = '';
      if (chance(0.1)) { eta.setHours(0, 0, 0, 0); etaStr = fmt(eta); }                      // no firm ETA
      else if (chance(0.15)) { const f = pick(FR); eta.setHours(f[1], 0, 0, 0); etaStr = fmt(eta); etaWin = f[0]; }
      const d0 = new Date(eta); d0.setHours(0, 0, 0, 0);
      let lc = '';
      if (chance(0.65)) { const from = d0.getDate() + pick([-3, -2, -1, 0, 0, 0, 1]); lc = from + '-' + (from + 2) + ' Nov 2026'; }
      const qty = type === 'MGO' ? 0 : ri(1, 24) * 50, mgo = type === 'VLSFO' ? 0 : ri(1, 10) * 25;
      const def = { name: NAMES[i], type, qty, mgo, eta: etaStr, lc, area: pick(['FUJ-A', 'KFK-A']), agent: 'AG', paq: pick(['yes', 'no']) };
      if (etaWin) def.etaWin = etaWin;
      if (qty && chance(0.2)) { def.qtyMin = Math.max(50, qty - 100); def.qtyMax = qty; }
      if (chance(0.2)) { def.refuelChk = true; def.rfv = ri(2, 40) * 50; def.rfm = chance(0.5) ? ri(1, 12) * 25 : 0; }
      if (chance(nb > 1 ? 0.25 : 0.1)) def.bargeId = String(pick(ids));
      addVessel(def);
    }
    if (chance(0.35)) for (let k = ri(1, 2); k > 0; k--) {
      const bi = ri(0, nb - 1), s = new Date(base.getTime() + ri(0, 5 * 24) * 3600000);
      _bargeBlocks.push({ id: 'blk' + seed + '_' + k, bargeId: ids[bi], bargeName: BNAMES[bi], start: s.toISOString(), end: new Date(s.getTime() + ri(3, 40) * 3600000).toISOString(), reason: pick(['Dry-dock', 'Weather', 'Maintenance']) });
    }
    if (chance(0.3)) for (let k = ri(1, 3); k > 0; k--) {
      const bi = ri(0, nb - 1);
      _savedSupplies.push({ id: 's' + seed + '_' + k, vessel: 'OLD ' + k, barge: BNAMES[bi], vlsfoAct: ri(1, 8) * 50, mgoAct: chance(0.5) ? ri(1, 6) * 25 : 0, supplyDate: new Date(base.getTime() - ri(1, 5) * 86400000).toISOString() });
    }
    if (chance(0.2)) { const bi = ri(0, nb - 1); _bargeReloads.push({ id: 'r' + seed, bargeId: ids[bi], v: ri(1, 20) * 50, m: ri(0, 8) * 25, at: new Date(base.getTime() - 86400000).toISOString() }); }
    return { nb, nv };
  };
  // everything calculate() leaves behind that a user (or another module) can see
  window.__dump = function () {
    const clean = o => JSON.parse(JSON.stringify(o));
    return {
      sched: _lastSched.map(i => clean(Object.assign({}, i, { nomUid: i.nomUid ? 'uid' : null }))),
      bargeStates: Object.values(_bargeStates).map(s => clean({ name: s.name, cursor: s.cursor, rv: s.rv, rm: s.rm, ov: s._openingV, om: s._openingM, vcap: s.vcap, mcap: s.mcap, vbuf: s.vbuf, mbuf: s.mbuf })),
      bargeConfig: clean((_bargeConfig || []).map(b => ({ name: b.name, vcap: b.vcap, mcap: b.mcap, vrob: b.vrob, mrob: b.mrob, vtph: b.vtph, mtph: b.mtph }))),
      lastETC: _lastETC, closingV: _closingV, closingM: _closingM,
      apV: document.getElementById('ap-v').textContent, apM: document.getElementById('ap-m').textContent,
      sumCards: document.getElementById('sum-cards').textContent,
      toasts: window.__toastLog.slice()
    };
  };
};

const summary = d => d.sched.map(i => [i.name, i.bargeLabel, i.bargeStart, i.etc, i.vQ, i.mQ, i.robVA, i.robMA, i.waitedForBarge ? 'W' : '', i.isPartial ? 'P' : '', i.vLow ? 'vL' : '', i.mLow ? 'mL' : '', i.refuelSlot ? 'R' : ''].join('|')).join('\n');
const hash = d => crypto.createHash('sha1').update(JSON.stringify(d)).digest('hex');

(async () => {
  const browser = await H.launch();
  const db = H.createDb();
  const app = await H.openApp(browser, db, { appDir, uid: 'user-operator', onDialog: async d => { try { await d.accept(); } catch (e) {} } });
  const page = app.page;
  await page.evaluate(HELPERS);

  /* 1 ── golden */
  const got = {};
  let moved = 0, framed = 0, ranged = 0;
  const t0 = Date.now();
  for (let seed = 1; seed <= SEEDS; seed++) {
    const d = await page.evaluate(seed => { __build(seed); calculate(); return __dump(); }, seed);
    got[seed] = { h: hash(d), n: d.sched.length, s: summary(d) };
    if (d.toasts.some(t => /Unavailable blocks moved/.test(t))) moved++;
    if (d.sched.some(i => i.etaWin)) framed++;
    if (d.sched.some(i => i.nomVMin != null || i.nomMMin != null)) ranged++;
  }
  console.log('ran ' + SEEDS + ' weeks in ' + Math.round((Date.now() - t0) / 1000) + ' s');
  const items = Object.values(got).reduce((n, g) => n + g.n, 0);
  check('golden: weeks produce real schedules (' + items + ' sched items)', items > SEEDS * 3, items);
  check('golden: the weeks include blocks moving jobs (' + moved + '), time frames (' + framed + ') and ranged quantities (' + ranged + ')', moved >= 10 && framed >= 10 && ranged >= 10, { moved, framed, ranged });
  if (WRITE) {
    fs.writeFileSync(GOLDEN_FILE, JSON.stringify(got));
    console.log('golden written: ' + GOLDEN_FILE);
  } else {
    const gold = JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8'));
    const bad = Object.keys(gold).filter(k => !got[k] || got[k].h !== gold[k].h);
    check('golden: all ' + Object.keys(gold).length + ' weeks identical to the recorded planner output', bad.length === 0 && Object.keys(gold).length === SEEDS, bad.slice(0, 5));
    if (bad.length) { const k = bad[0]; console.log('first differing week ' + k + '\n--- recorded\n' + gold[k].s + '\n--- now\n' + (got[k] && got[k].s)); }
  }

  /* 2 ── purity */
  if (await page.evaluate(() => typeof planSchedule === 'function')) {
    const r = await page.evaluate(() => {
      const out = [];
      for (let seed = 1; seed <= 60; seed++) {
        __build(seed);
        const vessels = getVessels(), barges = getBarges();
        const opening = {}; barges.forEach(b => { const l = computeLiveROB(b.id, b.name, b.vrob, b.mrob, null); opening[b.id] = { v: l.v, m: l.m }; });
        const params = _planCtxLive();
        const snap = () => JSON.stringify({ vessels, barges, opening, dom: document.getElementById('vc') ? document.getElementById('vc').innerHTML.length : 0, sched: _lastSched, bs: _bargeStates, cfg: _bargeConfig, ce: [_lastETC, _closingV, _closingM], calc: _calcParams, blocks: _bargeBlocks });
        const before = snap();
        const a = planSchedule({ vessels, barges, opening, params });
        const mid = snap();
        const b = planSchedule({ vessels, barges, opening, params });
        const after = snap();
        out.push({ seed, untouched: before === mid && mid === after, same: JSON.stringify(a) === JSON.stringify(b), order: vessels.map(v => v.name).join() });
      }
      return out;
    });
    check('purity: 60 weeks — planSchedule never changes its inputs, the DOM or app state', r.every(x => x.untouched), r.filter(x => !x.untouched).slice(0, 3));
    check('purity: same input twice → identical plan', r.every(x => x.same), r.filter(x => !x.same).slice(0, 3));
  }

  const errs = app.errors.filter(e => !/capacitorExports/.test(e));
  check('no page errors', errs.length === 0, errs.slice(0, 3));
  await app.ctx.close();
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
