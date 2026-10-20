/* What-if Planner: a private sandbox over planSchedule().
   • Every kind of what-if (ETA, delay, exact time, quantity, cancel, pin, barge
     out of service, starting ROB, a time-frame vessel) must give EXACTLY the
     plan the real planner gives when the same change is made on the real cards.
   • Nothing leaves the sandbox: no save, no sync write, no change to the real
     nominations / schedule / blocks / ROB.
   • "Find a better plan" only offers a plan that is no worse on any measure, its
     pins reproduce the plan it promised, and Apply copies it onto the real plan.
   node suites/planner/sim.test.js [appDir] */
const H = require('../../harness/harness.js');
const appDir = process.argv[2] || H.APP_DIR;

let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) pass++; else fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 700)));
}

const HELPERS = () => {
  const p = n => String(n).padStart(2, '0');
  window.__fmt = d => p(d.getDate()) + ' ' + MO[d.getMonth()] + ' ' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  window.__t0 = new Date(2026, 10, 5, 8, 0, 0, 0);
  window.__at = h => new Date(window.__t0.getTime() + h * 3600000);
  window.__reset = function () {
    const o = document.getElementById('flow-welcome-overlay'); if (o) o.style.display = 'none';
    document.querySelectorAll('.vcard[id^="vessel-"]').forEach(c => c.remove());
    (_barges || []).slice().forEach(b => rmBarge(b.id));
    _lastSched = []; _checklistRecords = {}; _savedSupplies = []; _deliveryLog = {}; _loadingRecords = []; _bargeBlocks = []; _bargeReloads = []; _manualROB = {}; _bakedSupplyIds = {};
    _calcParams.travelHrs = 1; _calcParams.hoseHrs = 6; _calcParams.contingencyHrs = 1;
    _sim = null;
  };
  window.__barge = def => { addBarge(Object.assign({ vcap: 5000, mcap: 1000, vrob: 4000, mrob: 800, vbuf: 500, mbuf: 150, vtph: 300, mtph: 100 }, def)); return _barges[_barges.length - 1].id; };
  window.__vessel = def => {
    const d = Object.assign({ area: 'FUJ-A', lc: '', paq: 'no', type: 'VLSFO', qty: 600, mgo: 0 }, def);
    if (d.etaHrs !== undefined) d.eta = __fmt(__at(d.etaHrs));
    addVessel(d);
    const cards = document.querySelectorAll('.vcard[id^="vessel-"]');
    const c = cards[cards.length - 1];
    return { id: c.id.replace('vessel-', ''), uid: c.dataset.nomUid };
  };
  // two barges, five vessels — a week where the barge choice matters
  window.__week = function () {
    __reset();
    const a = __barge({ name: 'FNSA 10', vrob: 2000, mrob: 600 }), b = __barge({ name: 'FNSA 11', vrob: 4800, mrob: 900 });
    const v = {};
    v.chile = __vessel({ name: 'CHILE PROSPERITY', type: 'BOTH', qty: 1500, mgo: 100, etaHrs: 0 });
    v.maran = __vessel({ name: 'MARAN VENUS', qty: 4500, etaHrs: 1 });
    v.pacific = __vessel({ name: 'PACIFIC DAWN', type: 'MGO', qty: 0, mgo: 250, etaHrs: 14 });
    v.orient = __vessel({ name: 'ORIENT STAR', qty: 900, eta: __fmt(new Date(2026, 10, 6, 12, 0)), etaWin: 'PM' });
    v.north = __vessel({ name: 'NORTH SEA', qty: 600, etaHrs: 40 });
    return { a, b, v };
  };
  window.__rows = sched => sched.map(i => [i.name, i.bargeLabel, +new Date(i.bargeStart), +new Date(i.etc), i.vQ, i.mQ, i.robVA, i.robMA, !!i.waitedForBarge, !!i.isPartial, i.etaWin || '', i.isDelayed ? 'D' : ''].join('|')).join('\n');
  window.__open = function () { _sim = null; showPage('simulator'); };
  window.__scen = () => planSchedule(_simInputs(_sim.snap, _sim.edits));
  window.__base = () => planSchedule(_simInputs(_sim.snap, _simEmptyEdits()));
  window.__q = (sel) => document.querySelector(sel);
  window.__change = (el, value) => { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); };
  window.__click = sel => { const el = document.querySelector(sel); if (!el) throw new Error('no ' + sel); el.click(); };
  window.__live = () => { calculate(); return __rows(_lastSched); };
};

async function scenario(browser, name, fn, opts) {
  const db = H.createDb();
  const dialogs = [];
  const app = await H.openApp(browser, db, Object.assign({ appDir, uid: 'user-operator', onDialog: async d => { dialogs.push(d.type() + ': ' + d.message()); try { await d.accept(); } catch (e) {} } }, opts || {}));
  await app.page.evaluate(HELPERS);
  await app.page.evaluate(() => __reset());
  try { await fn(app.page, app, db, dialogs); }
  catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
  const errs = app.errors.filter(e => !/capacitorExports/.test(e));
  check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
  await app.ctx.close();
}

(async () => {
  const browser = await H.launch();

  /* S1 — opens equal to the current plan */
  await scenario(browser, 'S1 baseline', async (page) => {
    const r = await page.evaluate(() => {
      __week(); calculate(); const live = __rows(_lastSched);
      __open();
      return { live, base: __rows(__base().sched), scen: __rows(__scen().sched), nEdits: Object.keys(_sim.edits.v).length + Object.keys(_sim.edits.b).length + _sim.edits.blocks.length,
        same: [...document.querySelectorAll('.sim-kpi-d')].map(e => e.textContent), rows: document.querySelectorAll('.sim-tbl tbody tr').length, active: document.getElementById('page-simulator').classList.contains('active') };
    });
    check('S1 page opens and shows the five vessels', r.active && r.rows === 5, r.rows);
    check('S1 the sandbox baseline is exactly the plan Generate produced', r.base === r.live && r.scen === r.live, { live: r.live.slice(0, 200), base: r.base.slice(0, 200) });
    check('S1 nothing edited → every measure reads "same as current plan"', r.nEdits === 0 && r.same.length === 5 && r.same.every(t => /same as current plan/.test(t)), r.same);
  });

  /* S2 — each what-if equals the same change made for real */
  const same = async (title, doSandbox, doReal) => {
    await scenario(browser, 'S2 ' + title, async (page) => {
      const r = await page.evaluate(async ({ doSandbox, doReal }) => {
        const W = __week(); calculate(); __open();
        const before = __rows(_lastSched);
        await (new Function('W', 'return (async()=>{' + doSandbox + '})()'))(W);
        const sand = __rows(__scen().sched), edited = JSON.stringify(_sim.edits);
        const untouched = __rows(_lastSched) === before;
        // …now the same change on the real cards
        await (new Function('W', 'return (async()=>{' + doReal + '})()'))(W);
        const real = __live();
        return { sand, real, edited, untouched, differsFromBefore: sand !== before };
      }, { doSandbox, doReal });
      check('S2 ' + title + ': sandbox plan == the real planner after the same change', r.sand === r.real, { sand: r.sand, real: r.real });
      check('S2 ' + title + ': the change really moved something; the real plan was untouched while experimenting', r.differsFromBefore && r.untouched, r);
    });
  };
  const K = key => `[data-key="' + W.v.${key}.uid + '"]`;
  const sel = (kind, key) => `'[data-sim="${kind}"][data-key="' + W.v.${key}.uid + '"]'`;
  await same('delay +12 h', `__click(${sel('shift', 'maran')}.replace(']', '][data-h="12"]'));`, `const c = W.v.maran.id; document.getElementById('v'+c+'-eta').value = __fmt(__at(13));`);
  await same('delay +6 h twice accumulates', `__click(${sel('shift', 'chile')}.replace(']', '][data-h="6"]')); __click(${sel('shift', 'chile')}.replace(']', '][data-h="6"]'));`, `document.getElementById('v'+W.v.chile.id+'-eta').value = __fmt(__at(12));`);
  await same('exact ETA typed', `__change(__q(${sel('eta', 'pacific')}), '2026-11-05T22:30');`, `document.getElementById('v'+W.v.pacific.id+'-eta').value = '05 Nov 2026 22:30';`);
  await same('cancel a vessel', `__click(${sel('cancel', 'maran')});`, `document.getElementById('vessel-'+W.v.maran.id).remove();`);
  await same('pin a barge', `__change(__q(${sel('pin', 'chile')}), String(W.a));`, `document.getElementById('v'+W.v.chile.id+'-barge').value = String(W.a);`);
  await same('change quantities', `__change(__q(${sel('vq', 'maran')}), '3000'); __change(__q(${sel('mq', 'chile')}), '40');`, `document.getElementById('v'+W.v.maran.id+'-vlsfo').value = '3000'; document.getElementById('v'+W.v.chile.id+'-mgo').value = '40';`);
  await same('barge out of service', `document.getElementById('sim-blk-from-'+W.b).value = '2026-11-05T06:00'; document.getElementById('sim-blk-to-'+W.b).value = '2026-11-05T20:00'; __click('[data-sim="blk-add"][data-bid="'+W.b+'"]');`,
    `_bargeBlocks.push({ id: 'real1', bargeId: W.b, bargeName: 'FNSA 11', start: new Date(2026,10,5,6,0).toISOString(), end: new Date(2026,10,5,20,0).toISOString(), reason: 'x' });`);
  await same('barge starts with less fuel', `__change(__q('[data-sim="brob-v"][data-bid="'+W.b+'"]'), '1200');`, `document.getElementById('b'+W.b+'-vrob').value = '1200';`);
  await same('time-frame vessel pushed a day', `__click(${sel('shift', 'orient')}.replace(']', '][data-h="24"]'));`, `document.getElementById('v'+W.v.orient.id+'-eta').value = __fmt(new Date(2026, 10, 7, 12, 0));`);
  await same('time frame replaced by an exact time', `__change(__q(${sel('eta', 'orient')}), '2026-11-06T09:15');`,
    `const c = W.v.orient.id; const chk = document.getElementById('v'+c+'-etawin-chk'); chk.checked = false; chk.dispatchEvent(new Event('change', {bubbles:true})); document.getElementById('v'+c+'-eta').value = '06 Nov 2026 09:15';`);
  await same('everything at once', `__click(${sel('shift', 'maran')}.replace(']', '][data-h="24"]')); __click(${sel('cancel', 'pacific')}); __change(__q(${sel('pin', 'north')}), String(W.a)); __change(__q('[data-sim="brob-m"][data-bid="'+W.a+'"]'), '100');`,
    `document.getElementById('v'+W.v.maran.id+'-eta').value = __fmt(__at(25)); document.getElementById('vessel-'+W.v.pacific.id).remove(); document.getElementById('v'+W.v.north.id+'-barge').value = String(W.a); document.getElementById('b'+W.a+'-mrob').value = '100';`);

  /* S3 — nothing leaves the sandbox */
  await scenario(browser, 'S3 isolation', async (page, app, db) => {
    await page.evaluate(() => { __week(); calculate(); });
    await page.waitForTimeout(3500);   // let the app's own delayed autosave / backup settle first
    await page.evaluate(() => { window.__saves = 0; const o = window.saveSharedState; window.saveSharedState = function () { window.__saves++; return o.apply(this, arguments); }; });
    const writes0 = db.log.filter(o => o.table === 'abps_workspace' && ['update', 'insert', 'upsert'].includes(o.action)).length;
    const snapA = await page.evaluate(() => JSON.stringify({ st: captureCurrentState(), ls: _lastSched, blocks: _bargeBlocks, rob: _manualROB, rel: _bargeReloads, meta: _lastSchedMeta, cards: [...document.querySelectorAll('.vcard')].map(c => c.innerHTML.length) }));
    const keysA = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)])));
    await page.evaluate(async () => {
      const W = { v: {} }; _simTake(); __open();
      const vs = _sim.snap.vessels; const k = n => _simKey(vs.find(v => v.name === n)); const bid = _sim.snap.barges[1].id;
      __click('[data-sim="shift"][data-h="12"][data-key="' + k('MARAN VENUS') + '"]');
      __change(__q('[data-sim="eta"][data-key="' + k('CHILE PROSPERITY') + '"]'), '2026-11-05T11:00');
      __click('[data-sim="cancel"][data-key="' + k('NORTH SEA') + '"]');
      __change(__q('[data-sim="pin"][data-key="' + k('PACIFIC DAWN') + '"]'), String(bid));
      __change(__q('[data-sim="vq"][data-key="' + k('ORIENT STAR') + '"]'), '100');
      document.getElementById('sim-blk-from-' + bid).value = '2026-11-05T06:00'; document.getElementById('sim-blk-to-' + bid).value = '2026-11-05T20:00'; __click('[data-sim="blk-add"][data-bid="' + bid + '"]');
      __change(__q('[data-sim="brob-v"][data-bid="' + bid + '"]'), '900');
      __click('[data-sim="suggest"]');
      await new Promise(r => { const t = setInterval(() => { if (_sim.suggest && _sim.suggest.result) { clearInterval(t); r(); } }, 50); });
      if (_sim.suggest.result.status === 'found') __click('[data-sim="suggest-try"]');
      __click('[data-sim="refresh"]'); __click('[data-sim="reset"]');
      showPage('dashboard'); showPage('simulator'); showPage('schedule');
    });
    await page.waitForTimeout(1500);
    const snapB = await page.evaluate(() => JSON.stringify({ st: captureCurrentState(), ls: _lastSched, blocks: _bargeBlocks, rob: _manualROB, rel: _bargeReloads, meta: _lastSchedMeta, cards: [...document.querySelectorAll('.vcard')].map(c => c.innerHTML.length) }));
    const keysB = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)])));
    const writes1 = db.log.filter(o => o.table === 'abps_workspace' && ['update', 'insert', 'upsert'].includes(o.action)).length;
    const saves = await page.evaluate(() => window.__saves);
    check('S3 a full session of what-ifs, a search and a reset triggers no save', saves === 0, saves);
    check('S3 …and no write reaches the shared database', writes1 === writes0, [writes0, writes1]);
    check('S3 …and the nominations, schedule, blocks and ROB are byte-for-byte unchanged', snapA === snapB);
    check('S3 …and browser storage is untouched', keysA === keysB);
    const leak = await page.evaluate(() => { const s = JSON.stringify(captureCurrentState()) + JSON.stringify(_buildSavePayload ? _buildSavePayload() : {}); return /sim-|_sim|whatif|what-if/i.test(s); });
    check('S3 sandbox state never appears in what would be saved', !leak);
  });

  /* S4 — the look-ahead */
  await scenario(browser, 'S4 suggestion', async (page, app, db, dialogs) => {
    const r = await page.evaluate(async () => {
      const W = __week(); calculate(); __open();
      const base = _simMetrics(__base());
      __click('[data-sim="suggest"]');
      await new Promise(r => { const t = setInterval(() => { if (_sim.suggest && _sim.suggest.result) { clearInterval(t); r(); } }, 50); });
      const res = _sim.suggest.result;
      const text = document.querySelector('.sim-found') ? document.querySelector('.sim-found').innerText : '';
      const tryBtn = !!document.querySelector('[data-sim="suggest-try"]');
      return { status: res.status, base, best: res.best && res.best.metrics, picks: res.best && res.best.picks, text, tryBtn, checked: res.checked, applyBefore: !!document.querySelector('[data-sim="apply"]') };
    });
    check('S4 finds a better plan for the week where the greedy rule fails', r.status === 'found' && r.tryBtn, r);
    check('S4 the plan is no worse on shortfall, waiting or laycan, and better on one', r.best.short <= r.base.short && r.best.wait <= r.base.wait + 0.01 && r.best.late <= r.base.late && (r.best.short < r.base.short || r.best.wait < r.base.wait - 0.01 || r.best.late < r.base.late), { base: r.base, best: r.best });
    check('S4 says what it gains and which vessels move', /less short|less vessel waiting|fewer/.test(r.text) && /MARAN VENUS|CHILE PROSPERITY/.test(r.text), r.text);
    check('S4 before trying it, nothing can be applied', !r.applyBefore);
    const t = await page.evaluate(() => {
      __click('[data-sim="suggest-try"]');
      const scen = _simMetrics(__scen()), promised = _sim.suggest.result.best.metrics;
      const only = _simOnlyPins(_sim.edits), applyBtn = !!document.querySelector('[data-sim="apply"]');
      return { scen, promised, only, applyBtn, pins: Object.keys(_sim.edits.v).length, rows: __rows(__scen().sched) };
    });
    check('S4 trying it in the sandbox gives exactly the promised numbers', JSON.stringify(t.scen) === JSON.stringify(t.promised), t);
    check('S4 only barge choices changed → "Apply" is offered', t.only && t.applyBtn && t.pins >= 1, t);
    // apply for real
    const a = await page.evaluate(async () => {
      const sandRows = __rows(__scen().sched);
      const pinned = Object.keys(_sim.edits.v).map(k => { const v = _sim.snap.vessels.find(x => _simKey(x) === k); return [v.name, _sim.edits.v[k].pin]; });
      __click('[data-sim="apply"]');
      await new Promise(r => setTimeout(r, 300));
      const cardPins = [...document.querySelectorAll('.vcard[id^="vessel-"]')].map(c => [document.getElementById(c.id.replace('vessel-', 'v') + '-name').value, document.getElementById(c.id.replace('vessel-', 'v') + '-barge').value]);
      return { sandRows, real: __rows(_lastSched), pinned, cardPins, page: _currentPage, edits: JSON.stringify(_sim.edits) };
    });
    check('S4 Apply asked first, naming the vessels', dialogs.some(d => /^confirm: Set these barge choices/.test(d) && /MARAN VENUS|CHILE PROSPERITY/.test(d)), dialogs);
    check('S4 after Apply the REAL schedule is exactly the plan that was shown', a.real === a.sandRows, { real: a.real, sand: a.sandRows });
    check('S4 only the suggested vessels were pinned on the nomination cards', a.cardPins.filter(c => c[1]).length === a.pinned.length && a.pinned.every(p => a.cardPins.some(c => c[0] === p[0] && String(c[1]) === String(p[1]))), a);
    check('S4 Apply lands on the Schedule Planner and the sandbox starts clean', a.page === 'schedule' && a.edits === JSON.stringify({ v: {}, b: {}, blocks: [] }), [a.page, a.edits]);
  });

  /* S5 — Apply only offered for barge choices; declined confirm changes nothing */
  await scenario(browser, 'S5 apply rules', async (page, app, db, dialogs) => {
    const r = await page.evaluate(async () => {
      const W = __week(); calculate(); __open();
      __change(__q('[data-sim="pin"][data-key="' + W.v.chile.uid + '"]'), String(W.a));
      const pinOnly = !!document.querySelector('[data-sim="apply"]');
      __click('[data-sim="shift"][data-h="6"][data-key="' + W.v.maran.uid + '"]');
      const mixed = !!document.querySelector('[data-sim="apply"]');
      const note = document.getElementById('sim-suggest').innerText;
      __click('[data-sim="vreset"][data-key="' + W.v.maran.uid + '"]');
      const again = !!document.querySelector('[data-sim="apply"]');
      // a colleague edits a nomination meanwhile → stale: no Apply, banner
      document.getElementById('v' + W.v.north.id + '-vlsfo').value = '650';
      _simRender();
      const stale = !!document.querySelector('[data-sim="apply"]'), banner = document.querySelector('.sim-banner').innerText;
      return { pinOnly, mixed, again, stale, banner, note };
    });
    check('S5 a barge pin alone can be applied', r.pinOnly && r.again, r);
    check('S5 once ETAs / quantities are changed too, Apply disappears and says why', !r.mixed && /only thing changed/.test(r.note), r);
    check('S5 when the live nominations change underneath, Apply is withheld and the page says so', !r.stale && /have changed since/.test(r.banner), r);
    const d = await page.evaluate(async () => {
      const W = __week(); calculate(); __open();
      __change(__q('[data-sim="pin"][data-key="' + W.v.chile.uid + '"]'), String(W.a));
      window.confirm = () => false;
      const before = __rows(_lastSched), pinBefore = document.getElementById('v' + W.v.chile.id + '-barge').value;
      __click('[data-sim="apply"]');
      return { same: __rows(_lastSched) === before, pin: document.getElementById('v' + W.v.chile.id + '-barge').value, pinBefore, page: _currentPage };
    });
    check('S5 declining the confirmation changes nothing', d.same && d.pin === d.pinBefore && d.page === 'simulator', d);
  });

  /* S6 — search quality, on random weeks, against independent bookkeeping */
  await scenario(browser, 'S6 search quality', async (page) => {
    const r = await page.evaluate(async () => {
      const R0 = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
      const out = { weeks: 0, found: 0, notDominating: [], notReproduced: [], notBest: [], worseThanGreedyPins: [] };
      // metrics written out here, independent of _simMetrics
      const M = plan => { let short = 0, wait = 0, late = 0; plan.sched.forEach((i, k) => { short += (i.nomVQ - i.vQ) + (i.nomMQ - i.mQ); const m = plan.meta[k]; wait += Math.max(0, (new Date(i.bargeStart) - m.readyAt) / 3600000); if (m.vessel.lc && new Date(i.bargeStart) > m.vessel.lc.to) late++; }); return { short, wait, late, low: plan.vAl.length + plan.mAl.length }; };
      for (let w = 0; w < 60; w++) {
        const R = R0(77 + w), ri = (a, b) => a + Math.floor(R() * (b - a + 1)), chance = q => R() < q;
        const nb = chance(0.7) ? 2 : 3;
        const barges = [...Array(nb)].map((_, i) => ({ id: i + 1, name: 'B' + (i + 1), vcap: 5000, mcap: 1000, vbuf: 500, mbuf: 150, vtph: 300, mtph: 100 }));
        const opening = {}; barges.forEach(b => opening[b.id] = { v: ri(1500, 5000), m: ri(300, 1000) });
        const vessels = [];
        const nv = ri(3, nb === 2 ? 8 : 6);
        for (let i = 0; i < nv; i++) {
          const eta = new Date(2026, 10, 5, 0, 0).getTime() + ri(0, 7 * 24 * 12) * 5 * 60000, e = new Date(eta);
          const type = chance(0.55) ? 'VLSFO' : (chance(0.4) ? 'MGO' : 'BOTH');
          const to = new Date(eta + ri(-1, 2) * 86400000);
          vessels.push({ id: i, name: 'V' + i, lc: { from: new Date(+to - 2 * 86400000), to }, eta: e, effectiveETA: e, vq: type === 'MGO' ? 0 : ri(2, 30) * 50, mq: type === 'VLSFO' ? 0 : ri(1, 12) * 25, type, isDelayed: e > to, isEarly: false, noFirmETA: false, paq: 'no', bargeId: chance(0.12) ? String(ri(1, nb)) : '', refuel: false, rfv: 0, rfm: 0, rfvr: 750, rfmr: 275, nomUid: 'u' + i, etaWin: '', winHrs: 0, vqMin: null, mqMin: null });
        }
        const params = { hoseHrs: 6, travelHrs: 1, blocksFor: () => [] };
        const inp = { vessels, barges, opening, params };
        const g = M(planSchedule(inp));
        const res = await _simSearch(inp, {});
        out.weeks++;
        if (res.status !== 'found') continue;
        out.found++;
        // reproduce: pin exactly the picks and re-plan
        const pin = new Map(res.best.picks.map(p => [p.key, p.bargeId]));
        const plan = planSchedule({ vessels: vessels.map(v => pin.has(v.nomUid) ? Object.assign({}, v, { bargeId: pin.get(v.nomUid) }) : v), barges, opening, params });
        const m = M(plan);
        if (!(m.short <= g.short + 0.5 && m.wait <= g.wait + 0.01 && m.late <= g.late)) out.notDominating.push(w);
        if (plan.sched.reduce((a, i) => a + i.vQ + i.mQ, 0) <= planSchedule(inp).sched.reduce((a, i) => a + i.vQ + i.mQ, 0) + 0.5 && m.low > g.low) out.notDominating.push('alerts ' + w);
        if (JSON.stringify(_simMetrics(plan)) !== JSON.stringify(res.best.metrics)) out.notReproduced.push(w);
        // best possible: brute force every assignment of the free vessels, same dominance rule
        const free = vessels.filter(v => !v.bargeId);
        if (free.length <= 8 && !res.truncated) {
          let bestGain = 0;
          for (let idx = 0; idx < Math.pow(nb, free.length); idx++) {
            let x = idx; const a = new Map(); free.forEach(v => { a.set(v, String((x % nb) + 1)); x = Math.floor(x / nb); });
            const mm = _simMetrics(planSchedule({ vessels: vessels.map(v => a.has(v) ? Object.assign({}, v, { bargeId: a.get(v) }) : v), barges, opening, params }));
            const gm = _simMetrics(planSchedule(inp));
            if (_simDominates(mm, gm)) bestGain = Math.max(bestGain, _simGain(gm, mm));
          }
          if (Math.abs(bestGain - _simGain(_simMetrics(planSchedule(inp)), res.best.metrics)) > 1e-6) out.notBest.push(w);
        }
      }
      return out;
    });
    check('S6 60 random weeks searched (' + r.found + ' with a better plan)', r.weeks === 60 && r.found >= 10, r);
    check('S6 every suggested plan is no worse than the current one on shortfall, waiting and laycan (and on alerts unless more fuel moves)', r.notDominating.length === 0, r.notDominating);
    check('S6 pinning exactly the listed vessels reproduces the promised plan', r.notReproduced.length === 0, r.notReproduced);
    check('S6 nothing better was missed (matches a brute-force over every assignment)', r.notBest.length === 0, r.notBest);
  });

  /* S7 — limits: one barge, all pinned, too many vessels, stopping */
  await scenario(browser, 'S7 limits', async (page) => {
    const r = await page.evaluate(async () => {
      const out = {};
      __reset(); const a = __barge({ name: 'ONLY' }); __vessel({ name: 'ALPHA ONE', etaHrs: 0 }); __vessel({ name: 'BRAVO TWO', etaHrs: 2 }); calculate(); __open();
      out.single = { btn: !!document.querySelector('[data-sim="suggest"]'), text: document.getElementById('sim-suggest').innerText };
      // all pinned
      const W = __week(); calculate(); __open();
      Object.values(W.v).forEach(v => __change(__q('[data-sim="pin"][data-key="' + v.uid + '"]'), String(W.a)));
      __click('[data-sim="suggest"]'); await new Promise(r => { const t = setInterval(() => { if (_sim.suggest && _sim.suggest.result) { clearInterval(t); r(); } }, 30); });
      out.pinned = _sim.suggest.result.status;
      // 11 free vessels, 3 barges → looks ahead over the first 8 only
      __reset(); __barge({ name: 'T1', vrob: 3000 }); __barge({ name: 'T2', vrob: 3000 }); __barge({ name: 'T3', vrob: 3000 });
      for (let i = 0; i < 11; i++) __vessel({ name: 'VESSEL ' + String.fromCharCode(65 + i) + 'X' + i, qty: 300 + (i % 4) * 400, etaHrs: i * 1.5 });
      calculate(); __open();
      const t0 = Date.now(); __click('[data-sim="suggest"]'); await new Promise(r => { const t = setInterval(() => { if (_sim.suggest && _sim.suggest.result) { clearInterval(t); r(); } }, 30); });
      const res = _sim.suggest.result;
      out.big = { status: res.status, covered: res.covered, vessels: res.vessels, truncated: res.truncated, checked: res.checked, ms: Date.now() - t0, text: document.getElementById('sim-suggest').innerText };
      // editing while it runs cancels the stale answer
      __click('[data-sim="suggest"]');
      __click('[data-sim="shift"][data-h="6"][data-key="' + _simKey(_sim.snap.vessels[0]) + '"]');
      await new Promise(r => setTimeout(r, 1500));
      out.afterEdit = { suggest: _sim.suggest, spinner: !!document.querySelector('.sim-spin') };
      // stop button
      __click('[data-sim="suggest"]'); const hadStop = !!document.querySelector('[data-sim="suggest-cancel"]'); __click('[data-sim="suggest-cancel"]');
      await new Promise(r => setTimeout(r, 600));
      out.stop = { hadStop, suggest: _sim.suggest, spinner: !!document.querySelector('.sim-spin') };
      return out;
    });
    check('S7 one barge → no suggestion button, says so', !r.single.btn && /only one barge/i.test(r.single.text), r.single);
    check('S7 every vessel pinned → nothing to reassign', r.pinned === 'pinned', r.pinned);
    check('S7 11 vessels / 3 barges: covers the first 8 within budget and says so', r.big.truncated && r.big.covered === 8 && r.big.vessels === 11 && r.big.checked <= SIM_BUDGET(), r.big);
    check('S7 …in reasonable time', r.big.ms < 15000, r.big.ms);
    check('S7 editing during a search discards the old answer', r.afterEdit.suggest === null && !r.afterEdit.spinner, r.afterEdit);
    check('S7 Stop abandons the search', r.stop.hadStop && r.stop.suggest === null && !r.stop.spinner, r.stop);
  });

  /* S8 — keeping up with live data */
  await scenario(browser, 'S8 refresh and stale copies', async (page) => {
    const r = await page.evaluate(() => {
      const W = __week(); calculate(); __open();
      __click('[data-sim="shift"][data-h="12"][data-key="' + W.v.maran.uid + '"]');
      __click('[data-sim="cancel"][data-key="' + W.v.north.uid + '"]');
      __change(__q('[data-sim="pin"][data-key="' + W.v.chile.uid + '"]'), String(W.a));
      // leave and come back: edits are kept, nothing re-snapshotted behind them
      showPage('dashboard'); showPage('simulator');
      const kept = Object.keys(_sim.edits.v).length;
      // live data moves on: MARAN's quantity is edited, NORTH SEA is removed for real
      document.getElementById('v' + W.v.maran.id + '-vlsfo').value = '2500';
      document.getElementById('vessel-' + W.v.north.id).remove();
      const banner = (_simRender(), document.querySelector('.sim-banner').innerText);
      __click('[data-sim="refresh"]');
      return { kept, banner, keys: Object.keys(_sim.edits.v).sort(), maranQty: _sim.snap.vessels.find(v => v.name === 'MARAN VENUS').vq, shift: _sim.edits.v[W.v.maran.uid] && _sim.edits.v[W.v.maran.uid].shiftHrs, uids: { maran: W.v.maran.uid, chile: W.v.chile.uid }, rows: document.querySelectorAll('.sim-tbl tbody tr').length };
    });
    check('S8 leaving the page and returning keeps the what-ifs', r.kept === 3, r.kept);
    check('S8 when live data changes the page says so', /have changed since/.test(r.banner), r.banner);
    check('S8 Refresh plans the latest data, keeps edits for vessels still there, drops edits for removed ones', r.maranQty === 2500 && r.shift === 12 && r.keys.length === 2 && r.keys.includes(r.uids.chile) && r.rows === 4, r);
    const q = await page.evaluate(() => {
      const W = __week(); calculate(); __open();
      __click('[data-sim="cancel"][data-key="' + W.v.maran.uid + '"]');
      showPage('dashboard');
      document.getElementById('vessel-' + W.v.north.id).remove();
      showPage('simulator');
      return { vessels: _sim.snap.vessels.length, edits: Object.keys(_sim.edits.v).length };
    });
    check('S8 coming back with edits in place does not silently re-read the cards', q.vessels === 5 && q.edits === 1, q);
    const c = await page.evaluate(() => {
      __week(); calculate(); __open(); _sim.edits = _simEmptyEdits(); showPage('dashboard');
      const n = document.querySelectorAll('.vcard[id^="vessel-"]'); n[0].remove();
      showPage('simulator');
      return _sim.snap.vessels.length;
    });
    check('S8 with no what-ifs, returning re-reads the live data', c === 4, c);
  });

  /* S9 — odd input */
  await scenario(browser, 'S9 odd input', async (page, app, db, dialogs) => {
    const r = await page.evaluate(() => {
      const out = {};
      const W = __week(); calculate(); __open();
      const base = __rows(__scen().sched), E = () => JSON.stringify(_sim.edits);
      const ve = W.v.maran.uid;
      __change(__q('[data-sim="vq"][data-key="' + ve + '"]'), '-50'); out.neg = E();
      __change(__q('[data-sim="vq"][data-key="' + ve + '"]'), 'abc'); out.nan = E();
      __change(__q('[data-sim="vq"][data-key="' + ve + '"]'), '4500'); out.same = E();
      __change(__q('[data-sim="eta"][data-key="' + ve + '"]'), ''); out.clearedEta = E();
      __click('[data-sim="shift"][data-h="6"][data-key="' + ve + '"]'); const shifted = E();
      __change(__q('[data-sim="eta"][data-key="' + ve + '"]'), ''); out.shiftUndone = E();
      document.getElementById('sim-blk-from-' + W.a).value = '2026-11-05T20:00'; document.getElementById('sim-blk-to-' + W.a).value = '2026-11-05T10:00';
      window.__toastsSeen = []; const ot = showToast; showToast = function (m) { window.__toastsSeen.push(String(m)); return ot.apply(this, arguments); };
      __click('[data-sim="blk-add"][data-bid="' + W.a + '"]'); out.badBlock = { blocks: _sim.edits.blocks.length, toast: window.__toastsSeen.join('|') };
      document.getElementById('sim-blk-from-' + W.a).value = ''; __click('[data-sim="blk-add"][data-bid="' + W.a + '"]'); out.emptyBlock = _sim.edits.blocks.length;
      // park a barge for a month: everything waits or moves
      document.getElementById('sim-blk-from-' + W.a).value = '2026-11-01T00:00'; document.getElementById('sim-blk-to-' + W.a).value = '2026-12-01T00:00'; __click('[data-sim="blk-add"][data-bid="' + W.a + '"]');
      document.getElementById('sim-blk-from-' + W.b).value = '2026-11-01T00:00'; document.getElementById('sim-blk-to-' + W.b).value = '2026-12-01T00:00'; __click('[data-sim="blk-add"][data-bid="' + W.b + '"]');
      out.bothParked = { rows: document.querySelectorAll('.sim-tbl tbody tr').length, text: document.querySelector('.sim-kpis').innerText.replace(/\s+/g, ' ') };
      __click('[data-sim="reset"]');
      // cancel everything
      Object.values(W.v).forEach(v => __click('[data-sim="cancel"][data-key="' + v.uid + '"]'));
      out.allCancelled = { scen: __scen().sched.length, kpi: [...document.querySelectorAll('.sim-kpi-v')].map(e => e.textContent), rows: document.querySelectorAll('.sim-off').length };
      __click('[data-sim="restore"][data-key="' + W.v.chile.uid + '"]'); out.restored = __scen().sched.length;
      __click('[data-sim="reset"]');
      out.resetOk = __rows(__scen().sched) === base;
      return out;
    });
    const empty = JSON.stringify({ v: {}, b: {}, blocks: [] });
    check('S9 a negative or unreadable quantity is ignored; the original value is not an edit', r.neg === empty && r.nan === empty && r.same === empty, [r.neg, r.nan, r.same]);
    check('S9 clearing the ETA box puts the vessel back', r.clearedEta === empty && r.shiftUndone === empty, [r.clearedEta, r.shiftUndone]);
    check('S9 an out-of-service time that ends before it starts, or is empty, is refused', r.badBlock.blocks === 0 && /later end/.test(r.badBlock.toast) && r.emptyBlock === 0, r.badBlock);
    check('S9 both barges out for a month: still plans, vessels wait it out', r.bothParked.rows === 5, r.bothParked);
    check('S9 every vessel cancelled: empty plan, zero deliveries, no error', r.allCancelled.scen === 0 && r.allCancelled.rows === 5 && r.allCancelled.kpi[0] === '0 MT', r.allCancelled);
    check('S9 restoring one brings it back; Undo all returns to the current plan', r.restored === 1 && r.resetOk, r);
    check('S9 odd input raised no browser alerts', dialogs.length === 0, dialogs);
  });

  /* S10 — a vessel with only a laycan, and an unreadable card */
  await scenario(browser, 'S10 laycan-only and bad cards', async (page, app, db, dialogs) => {
    const r = await page.evaluate(() => {
      __reset(); __barge({ name: 'B1' });
      const l = __vessel({ name: 'LAYCAN ONLY', lc: '8-10 Nov 2026', eta: '', qty: 500 }); __vessel({ name: 'TIMED ONE', qty: 400, etaHrs: 3 });
      calculate(); __open();
      const baseRow = __rows(__base().sched);
      __click('[data-sim="shift"][data-h="24"][data-key="' + l.uid + '"]');
      const shifted = __rows(__scen().sched), eta = document.querySelector('[data-sim="eta"][data-key="' + l.uid + '"]').value;
      // the real card, same change
      document.getElementById('v' + l.id + '-eta').value = '10 Nov 2026 00:00'; // laycan midpoint 9 Nov 12:00 (+24h) = 10 Nov 12:00
      return { baseRow, shifted, eta };
    });
    check('S10 a laycan-only vessel can be shifted (starts from the laycan midpoint)', r.eta === '2026-11-10T11:59' && r.shifted !== r.baseRow, r);
    const b = await page.evaluate(() => {
      __week(); calculate();
      document.getElementById('v' + document.querySelector('.vcard').id.replace('vessel-', '') + '-eta').value = 'garbage';
      window.__dlg = 0; _sim = null; showPage('simulator');
      return document.getElementById('sim-root').innerText;
    });
    check('S10 an unreadable ETA on a card is explained on the page — no pop-up', /cannot read Actual ETA/.test(b) && dialogs.length === 0, [b.slice(0, 200), dialogs]);
    const g = await page.evaluate(() => { _sim = null; try { getVessels(); } catch (e) {} return 1; });
    check('S10 Generate still alerts about the same card as before', dialogs.some(d => /cannot read Actual ETA/.test(d)), dialogs);
  });

  /* S11 — hostile text */
  await scenario(browser, 'S11 escaping', async (page) => {
    const r = await page.evaluate(() => {
      __reset(); window.__x = 0;
      const a = __barge({ name: '<img src=x onerror="window.__x=1">BAD', vrob: 3000 }); __barge({ name: 'OK 2', vrob: 3000 });
      __vessel({ name: '<b onmouseover="window.__x=2">V</b>"\'', etaHrs: 0, agent: '<i>', qty: 500 }); __vessel({ name: 'SECOND', etaHrs: 3, qty: 400 });
      calculate(); __open();
      __click('[data-sim="suggest"]');
      return new Promise(r => setTimeout(() => {
        const root = document.getElementById('sim-root');
        r({ x: window.__x, imgs: root.querySelectorAll('img').length, bold: root.querySelectorAll('b[onmouseover]').length, handlers: root.querySelectorAll('[onerror],[onmouseover]').length });
      }, 800));
    });
    check('S11 vessel and barge names are escaped everywhere on the page', r.x === 0 && r.imgs === 0 && r.bold === 0 && r.handlers === 0, r);
  });

  /* S12 — traders never see it */
  await scenario(browser, 'S12 trader', async (page) => {
    await page.waitForTimeout(800);
    const r = await page.evaluate(async () => {
      await new Promise(r => setTimeout(r, 500));
      const nav = document.getElementById('nav-simulator');
      try { showPage('simulator'); } catch (e) {}
      return { navHidden: !nav || getComputedStyle(nav).display === 'none', page: _currentPage, pageActive: document.getElementById('page-simulator').classList.contains('active') };
    });
    check('S12 a trader has no menu entry and cannot open the page', r.navHidden && r.page === 'dashboard' && !r.pageActive, r);
  }, { uid: 'user-trader' });

  /* S13 — phone width */
  for (const w of [390, 1280]) await scenario(browser, 'S13 width ' + w, async (page) => {
    const r = await page.evaluate(() => {
      __week(); calculate(); __open();
      __click('[data-sim="shift"][data-h="6"][data-key="' + [...document.querySelectorAll('[data-sim="shift"]')][0].dataset.key + '"]');
      const de = document.documentElement, wrap = document.querySelector('.sim-wrap');
      return { over: de.scrollWidth - de.clientWidth, wrapScrolls: wrap.scrollWidth > wrap.clientWidth, kpiW: [...document.querySelectorAll('.sim-kpi')].every(k => k.getBoundingClientRect().right <= de.clientWidth + 1) };
    });
    check('S13 ' + w + 'px: the page itself never scrolls sideways (the table scrolls inside its frame)', r.over <= 0 && r.kpiW, r);
  }, { viewport: { width: w, height: 900 } });

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
function SIM_BUDGET() { return 12000; }
