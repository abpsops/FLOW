/* Barge reload planner — stock forecast + "reload by" recommendations.
   node reload.test.js [appDir] [only] [shotDir]   (or $SHOTS_DIR for screenshots)
   Every scenario builds its own barges / vessels / loadings through the
   app's own functions (addBarge, addVessel, calculate, the Loading form)
   with times relative to now, like the Free Windows suite. */
const path = require('path');
const H = require(path.join(__dirname, '..', '..', 'harness', 'harness.js'));
const appDir = process.argv[2] || H.APP_DIR;
const only = process.argv[3] || '';
const SHOTS = process.argv[4] || process.env.SHOTS_DIR || '';

let pass = 0, fail = 0;
function check(name, cond, info) {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 700)));
}
const HR = 3600000;
const near = (a, b, tolMs) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= (tolMs == null ? 60000 : tolMs);

const PAGE_HELPERS = () => {
  window.__fmt = function (d) {
    const p = n => String(n).padStart(2, '0');
    return d.getDate() + ' ' + MO[d.getMonth()] + ' ' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  };
  // hours from now, to the minute, never exactly 00:00 (= "no firm ETA")
  window.__at = function (hrs) {
    const d = new Date(Date.now() + hrs * 3600000); d.setSeconds(0, 0);
    if (d.getHours() === 0 && d.getMinutes() === 0) d.setMinutes(7);
    return d;
  };
  window.__reset = function () {
    document.querySelectorAll('.vcard[id^="vessel-"]').forEach(c => c.remove());
    (_barges || []).slice().forEach(b => rmBarge(b.id));
    _lastSched = []; _checklistRecords = {}; _savedSupplies = []; _deliveryLog = {}; _loadingRecords = []; _bargeBlocks = []; _bargeReloads = []; _manualROB = {};
    _bargeConfig = [];
    _calcParams.travelHrs = 1; _calcParams.contingencyHrs = 1; _calcParams.hoseHrs = 6;
    _loadingConfig = { rateVLSFO: 300, rateLSMGO: 150 };
  };
  window.__barge = function (def) { addBarge(Object.assign({ vcap: 5000, mcap: 1000, vbuf: 500, mbuf: 150, vtph: 300, mtph: 100 }, def)); return _barges[_barges.length - 1].id; };
  window.__vessel = function (def) {
    const d = Object.assign({ area: 'FUJ-A', lc: '', paq: 'yes' }, def);
    if (d.etaHrs !== undefined) d.eta = __fmt(__at(d.etaHrs));
    addVessel(d);
    const cards = document.querySelectorAll('.vcard[id^="vessel-"]');
    return cards[cards.length - 1].dataset.nomUid;
  };
  window.__item = name => _lastSched.find(i => i.name === name);
  window.__iso = d => d instanceof Date ? d.toISOString() : d;
  // JSON-safe forecast
  window.__fc = function (bid, hrs) {
    const f = _bargeStockForecast(bid, hrs || 168);
    const D = x => x instanceof Date ? x.toISOString() : x;
    return {
      ok: f.ok, robNow: f.robNow, start: f.start, end: D(f.end),
      events: f.events.map(e => ({ kind: e.kind, label: e.label, grade: e.grade, t: D(e.t), start: D(e.start), v: e.v, m: e.m, idx: e.idx })),
      recs: f.recs.map(r => {
        const o = {};
        Object.keys(r).forEach(k => { const v = r[k]; o[k] = v instanceof Date ? v.toISOString() : v; });
        if (r.slot) o.slot = { start: D(r.slot.start), end: D(r.slot.end), windowFrom: D(r.slot.windowFrom), windowTo: D(r.slot.windowTo) };
        return o;
      })
    };
  };
  window.__toasts = [];
  if (!window.__toastWrapped) {
    const orig = showToast; window.__toastWrapped = true;
    showToast = function (m) { window.__toasts.push(String(m)); return orig.apply(this, arguments); };
  }
};

async function openApp(browser, db, uid, extra) {
  const app = await H.openApp(browser, db, Object.assign({ appDir, uid: uid || 'user-operator' }, extra || {}));
  app.warnings = [];
  app.page.on('console', m => { if (m.type() === 'warning' && /reload|planner|dashboard .* render failed/i.test(m.text())) app.warnings.push(m.text()); });
  await app.page.evaluate(PAGE_HELPERS);
  return app;
}
function realErrors(app) { return app.errors.filter(e => !/capacitorExports/.test(e)).concat(app.warnings || []); }

async function scenario(browser, name, fn, opts) {
  if (only && !name.includes(only)) return;
  console.log('— ' + name);
  const db = H.createDb();
  const apps = [];
  const open = async (uid, extra) => { const a = await openApp(browser, db, uid, extra); apps.push(a); return a; };
  try {
    const app = await open('user-operator', opts);
    await app.page.evaluate(() => __reset());
    await fn(app, { db, open });
  } catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
  const errs = [].concat(...apps.map(realErrors));
  check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
  for (const a of apps) await a.ctx.close();
}

// The standard fleet: Al Noor runs short of both grades this week.
const SEED_MAIN = () => {
  const b = __barge({ name: 'Al Noor', vrob: 3000, mrob: 600 });
  const b2 = __barge({ name: 'Spare Barge', vrob: 4500, mrob: 900 });
  __vessel({ name: 'SEA PEARL', type: 'BOTH', qty: 800, mgo: 200, etaHrs: 20, bargeId: b });   // LSMGO 600 → 400
  __vessel({ name: 'OPAL HORIZON', type: 'MGO', qty: 0, mgo: 300, etaHrs: 44, bargeId: b });   // 400 → 100 < 150 buffer
  __vessel({ name: 'MGO LATER', type: 'MGO', qty: 0, mgo: 120, etaHrs: 60, bargeId: b });      // 100 → −20
  __vessel({ name: 'BLUE FIN', type: 'VLSFO', qty: 1900, mgo: 0, etaHrs: 76, bargeId: b });    // VLSFO 2200 → 300 < 500
  calculate();
  // LSMGO top-up already planned after MGO LATER
  _loadingRecords.push({ id: 'ld_plan', barge: 'Al Noor', terminal: 'VOPAK', grade: 'LSMGO', qty: 600, startAt: __at(100).toISOString(), endAt: __at(108).toISOString(), updatedAt: Date.now() });
  return { b, b2 };
};

(async () => {
  const browser = await H.launch();

  /* 1 — the forecast and Free Windows read one simulation: stock after
     every job / loading and at every free gap is identical. */
  await scenario(browser, 'R1 forecast equals Free Windows', async ({ page }) => {
    const r = await page.evaluate((seed) => {
      const { b } = eval('(' + seed + ')')();
      _loadingRecords.push({ id: 'ld_v', barge: 'Al Noor', terminal: 'ENOC', grade: 'VLSFO', qty: 1500, startAt: __at(84).toISOString(), endAt: __at(92).toISOString(), updatedAt: Date.now() });
      const now = new Date();
      const fw = computeFreeWindows(b, 'Al Noor', now, new Date(now.getTime() + 168 * 3600000));
      const fc = _bargeStockForecast(b, 168);
      const busy = fw.filter(w => w.status === 'busy' && (w.kind === 'vessel' || w.kind === 'loading')).map(w => {
        const e = fc.events.find(x => (x.kind === w.kind) && x.start && x.start.getTime() === w.rawStart.getTime());
        return { label: w.label, fwV: w.afterV, fwM: w.afterM, fcV: e && e.v, fcM: e && e.m };
      });
      // stock at a free gap = stock after the last event before it; ATP =
      // lowest forecast stock from there until that grade's next loading − buffer
      const gaps = fw.filter(w => w.status === 'free' || w.status === 'short').map(w => {
        const prior = fc.events.filter(x => x.kind !== 'block' && (x.kind === 'now' || x.kind === 'overdue' || x.start < w.gapStart));
        const e = prior[prior.length - 1];
        const later = fc.events.filter(x => (x.kind === 'vessel' || x.kind === 'loading') && x.start >= w.gapStart);
        const low = (k, grade) => { let lo = e[k]; for (const x of later) { if (x.kind === 'loading' && x.grade === grade) break; if (x.kind === 'vessel') lo = Math.min(lo, x[k]); } return lo; };
        return { at: w.gapStart.toISOString(), fwV: w.robV, fwM: w.robM, fcV: e.v, fcM: e.m, atpV: w.atpV, atpM: w.atpM,
          fcAtpV: Math.max(0, low('v', 'VLSFO') - fc.vbuf), fcAtpM: Math.max(0, low('m', 'LSMGO') - fc.mbuf) };
      });
      return { busy, gaps, robNow: fc.robNow };
    }, SEED_MAIN.toString());
    check('R1 every busy job/loading: forecast stock after it = Free Windows ROB after it', r.busy.length >= 5 && r.busy.every(x => x.fwV === x.fcV && x.fwM === x.fcM), r.busy);
    check('R1 every free gap: forecast stock = Free Windows ROB at the gap', r.gaps.length >= 3 && r.gaps.every(x => x.fwV === x.fcV && x.fwM === x.fcM), r.gaps);
    check('R1 Free Windows available-to-promise = lowest forecast stock before that grade\'s next loading − buffer, at every gap', r.gaps.every(x => x.atpV === Math.round(x.fcAtpV) && x.atpM === Math.round(x.fcAtpM)) && r.gaps.some(x => x.atpV > 0), r.gaps);
    check('R1 forecast starts at live ROB now (3000 / 600)', r.robNow.v === 3000 && r.robNow.m === 600, r.robNow);
  });

  /* 2 — breach per grade, reload-by, quantity, slot */
  await scenario(browser, 'R2 breaches and recommendations', async ({ page }) => {
    const r = await page.evaluate((seed) => {
      _calcParams.contingencyHrs = 2; _calcParams.travelHrs = 1.5;
      eval('(' + seed + ')')();
      const b = _barges[0].id;
      const fc = __fc(b, 168);
      return { fc, opal: __iso(__item('OPAL HORIZON').bargeStart), blue: __iso(__item('BLUE FIN').bargeStart), pearl: { s: __iso(__item('SEA PEARL').bargeStart), etc: __iso(__item('SEA PEARL').etc) },
        mgoLater: __iso(__item('MGO LATER').bargeStart), mgoLaterEtc: __iso(__item('MGO LATER').etc), opalEtc: __iso(__item('OPAL HORIZON').etc) };
    }, SEED_MAIN.toString());
    const m = r.fc.recs.find(x => x.grade === 'LSMGO'), v = r.fc.recs.find(x => x.grade === 'VLSFO');
    check('R2 two breaches (one per grade), forecast not ok', r.fc.recs.length === 2 && !r.fc.ok, r.fc.recs.map(x => [x.grade, x.vessel]));
    check('R2 LSMGO breach at OPAL HORIZON: 400 onboard → 100 vs 150 buffer (50 below)', m && m.vessel === 'OPAL HORIZON' && m.before === 400 && m.after === 100 && m.shortBy === 50 && near(m.jobStart, r.opal, 0), m);
    check('R2 VLSFO breach at BLUE FIN: 2200 → 300 vs 500 buffer (200 below)', v && v.vessel === 'BLUE FIN' && v.before === 2200 && v.after === 300 && v.shortBy === 200, v);
    check('R2 reload-by = job start − 1.5h travel − 2h contingency (both grades)',
      m && v && near(m.reloadBy, new Date(new Date(r.opal).getTime() - 3.5 * HR), 0) && near(v.reloadBy, new Date(new Date(r.blue).getTime() - 3.5 * HR), 0), [m && m.reloadBy, v && v.reloadBy]);
    // LSMGO: covers OPAL (300) + MGO LATER (120) until the planned loading: 400 − 420 = −20 → need 170 → 200
    check('R2 LSMGO quantity covers every job until the next planned loading, rounded up to 50 (170 → 200)', m && m.need === 170 && m.qty === 200 && m.coversJobs === 2 && m.coversUntilWhy === 'loading', m && [m.need, m.qty, m.coversJobs, m.coversUntilWhy]);
    check('R2 LSMGO fill-to-capacity = 1000 − 400 onboard = 600', m && m.fill === 600 && m.stockAtLoad === 400, m && [m.fill, m.stockAtLoad]);
    check('R2 duration = 2.5h pre + 200/150 pump + 3.5h post', m && Math.abs(m.durHrs - (6 + 200 / 150)) < 1e-9, m && m.durHrs);
    // slot: after SEA PEARL's ETC + 2h contingency + 1.5h travel, ends by reload-by
    const earliest = new Date(r.pearl.etc).getTime() + 3.5 * HR;
    check('R2 LSMGO slot: after SEA PEARL (ETC + contingency + travel), finishes by reload-by', m && m.slot && new Date(m.slot.start).getTime() >= earliest && new Date(m.slot.start).getTime() < earliest + 15 * 60000 && new Date(m.slot.end) <= new Date(m.reloadBy) && near(m.slot.end, new Date(new Date(m.slot.start).getTime() + m.durHrs * HR), 1000), m && m.slot);
    // VLSFO: the only window long enough that the LSMGO reload doesn't take
    // is before SEA PEARL: 3000 − 800 − 1900 = 300 → need 200 → 200 MT.
    check('R2 VLSFO covers SEA PEARL + BLUE FIN to horizon end: need 200 → 200 MT, fill 2000', v && v.need === 200 && v.qty === 200 && v.coversJobs === 2 && v.coversUntilWhy === 'horizon' && v.fill === 2000, v && [v.need, v.qty, v.coversJobs, v.coversUntilWhy, v.fill]);
    const sS = x => new Date(x.slot.start).getTime(), sE = x => new Date(x.slot.end).getTime();
    check('R2 the two suggested slots never overlap (travel + contingency apart) and each ends by its reload-by',
      m && v && m.slot && v.slot && (sE(v) + 4.5 * HR <= sS(m) || sE(m) + 4.5 * HR <= sS(v)) && sE(v) <= new Date(v.reloadBy).getTime() && sE(v) <= new Date(r.pearl.s).getTime() - 3.5 * HR, [m && m.slot, v && v.slot, r.pearl]);
  });

  /* 3 — longer horizon: a later job counts; the tank caps the quantity */
  await scenario(browser, 'R3 horizon and capacity cap', async ({ page }) => {
    const r = await page.evaluate(() => {
      const b = __barge({ name: 'Cap', vrob: 3000, mrob: 900 });
      __vessel({ name: 'J1', type: 'VLSFO', qty: 2700, mgo: 0, etaHrs: 30, bargeId: b });       // 3000 → 300 < 500
      __vessel({ name: 'BIG LIFT', type: 'VLSFO', qty: 3500, mgo: 0, etaHrs: 24 * 10, bargeId: b });
      calculate();
      return { r7: __fc(b, 168).recs, r14: __fc(b, 336).recs };
    });
    const a = r.r7[0], c = r.r14[0], d = r.r14[1];
    check('R3 7 days: BIG LIFT (day 10) is outside, J1 alone: need 200 → 200 MT', r.r7.length === 1 && a.vessel === 'J1' && a.qty === 200 && a.coversJobs === 1, r.r7.map(x => [x.vessel, x.qty, x.coversJobs]));
    check('R3 14 days: need 500 − (3000 − 2700 − 3500) = 3700, capped by tank room 5000 − 3000 = 2000', c && c.vessel === 'J1' && c.want === 3700 && c.qty === 2000 && c.capped === true && c.fill === 2000 && c.coversJobs === 2, c && [c.want, c.qty, c.capped, c.fill, c.coversJobs]);
    check('R3 14 days: a second reload for BIG LIFT sized after the first (2300 onboard → 1700)', d && d.vessel === 'BIG LIFT' && d.stockAtLoad === 2300 && d.qty === 1700, d && [d.vessel, d.stockAtLoad, d.qty]);
  });

  /* 4 — suggested slot respects Unavailable blocks and existing jobs */
  await scenario(browser, 'R4 slot respects blocks and jobs', async ({ page }) => {
    const r = await page.evaluate(() => {
      const b = __barge({ name: 'B1', vrob: 4000, mrob: 400 });
      __vessel({ name: 'JOB A', type: 'MGO', qty: 0, mgo: 100, etaHrs: 10, bargeId: b });  // 400 → 300
      __vessel({ name: 'JOB C', type: 'MGO', qty: 0, mgo: 300, etaHrs: 70, bargeId: b });  // 300 → 0 < 150
      calculate();
      const A = __item('JOB A');
      const free = __fc(b, 168).recs[0];
      const aBusyEnd = new Date(A.etc.getTime() + 3600000);
      // block from 1h after A is free to 50h
      const bs = new Date(aBusyEnd.getTime() + 3600000), be = __at(50);
      _bargeBlocks.push({ id: 'blk1', bargeId: b, bargeName: 'B1', start: bs.toISOString(), end: be.toISOString(), reason: 'Dry dock' });
      const blocked = __fc(b, 168).recs[0];
      const conflicts = _checkLoadingConflict('B1', blocked.slot.start, blocked.slot.end, null);
      return { free, blocked, aEtc: A.etc.toISOString(), bs: bs.toISOString(), be: be.toISOString(), conflicts };
    });
    const earliest = new Date(r.aEtc).getTime() + 2 * HR; // + contingency + travel
    check('R4 without a block the slot starts right after JOB A (ETC + 1h + 1h travel)', r.free.slot && new Date(r.free.slot.start).getTime() >= earliest && new Date(r.free.slot.start).getTime() < earliest + 15 * 60000, [r.free.slot, r.aEtc]);
    check('R4 with a block the slot moves after the block (block end + travel), still before reload-by', r.blocked.slot && new Date(r.blocked.slot.start).getTime() >= new Date(r.be).getTime() + HR && new Date(r.blocked.slot.end) <= new Date(r.blocked.reloadBy), [r.blocked.slot, r.be]);
    check('R4 suggested slot passes the Loading form\'s own conflict check', r.conflicts.length === 0, r.conflicts);
  });

  /* 5 — no free slot: say so, suggest reassigning, list barges with stock */
  await scenario(browser, 'R5 no slot suggests reassign', async ({ page }) => {
    const r = await page.evaluate(() => {
      const b = __barge({ name: 'Tight', vrob: 4000, mrob: 450 });
      __barge({ name: 'Has Fuel', vrob: 4000, mrob: 900 });
      __barge({ name: 'Too Little', vrob: 4000, mrob: 300 });
      __vessel({ name: 'FIRST', type: 'MGO', qty: 0, mgo: 100, etaHrs: 5, bargeId: b });       // ETC ≈ +12h
      __vessel({ name: 'HOT ONE', type: 'MGO', qty: 0, mgo: 400, etaHrs: 15, bargeId: b });    // 350 → −50
      calculate();
      const rec = __fc(b, 168).recs[0];
      showPage('bargefleet');
      const card = document.querySelector('#reload-planner-body .rl-card[data-barge-id="' + b + '"]');
      return { rec, text: card ? card.textContent : '' };
    });
    check('R5 breach at HOT ONE, no slot found', r.rec && r.rec.vessel === 'HOT ONE' && r.rec.slot === null && r.rec.belowZero === true, r.rec && [r.rec.vessel, r.rec.slot]);
    check('R5 alternatives: Has Fuel (900 − 150 = 750 spare) listed, Too Little not', r.rec && r.rec.alternatives.length === 1 && r.rec.alternatives[0].name === 'Has Fuel' && r.rec.alternatives[0].spare === 750, r.rec && r.rec.alternatives);
    check('R5 card says "No free slot before … — reassign HOT ONE or reload earlier" and names Has Fuel', /No free slot before .* — reassign HOT ONE or reload earlier/.test(r.text) && /Has Fuel \(750 MT spare\)/.test(r.text) && !/Too Little \(/.test(r.text), r.text.slice(0, 900));
  });

  /* 6 — quantity ranges plan the max; completed jobs drop out */
  await scenario(browser, 'R6 ranges and completed jobs', async ({ page }) => {
    const r = await page.evaluate(() => {
      const b = __barge({ name: 'B1', vrob: 4000, mrob: 600 });
      const done = __vessel({ name: 'DONE ALREADY', type: 'MGO', qty: 0, mgo: 200, etaHrs: 8, bargeId: b });
      __vessel({ name: 'RANGED', type: 'MGO', qty: 0, mgo: 350, mgoMin: 200, mgoMax: 350, etaHrs: 30, bargeId: b });
      calculate();
      const before = __fc(b, 168);
      // DONE ALREADY supplied and saved: 200 MT comes off live ROB once, job leaves the plan
      _savedSupplies.push({ id: 'sup1', vessel: 'DONE ALREADY', nomUid: done, barge: 'B1', vlsfoAct: 0, mgoAct: 200, supplyDate: new Date().toISOString(), supplied: true });
      const after = __fc(b, 168);
      return { before, after };
    });
    const rb = r.before.recs[0];
    check('R6 range 200–350 MT plans the max: RANGED takes 350 (400 → 50, breach)', rb && rb.vessel === 'RANGED' && rb.jobQty === 350 && rb.before === 400 && rb.after === 50, rb);
    check('R6 completed job excluded: not in events, live ROB 400, no double deduction', !r.after.events.some(e => e.label === 'DONE ALREADY') && r.after.robNow.m === 400 && r.after.recs[0] && r.after.recs[0].before === 400, [r.after.robNow, r.after.events.map(e => e.label)]);
  });

  /* 7 — Plan this loading: pre-filled form, nothing saved; after saving the
     breach clears and the loading reaches a second device */
  await scenario(browser, 'R7 plan this loading', async (A, { db, open }) => {
    const pa = A.page;
    const setup = await pa.evaluate(async (seed) => {
      eval('(' + seed + ')')();
      await saveSharedState();
      await _waitForSaveIdle();
      try { flowWelcomeGo('dashboard'); } catch (e) {} // the welcome screen would sit over the buttons
      await new Promise(res => setTimeout(res, 600));
      showPage('bargefleet');
      const b = _barges[0].id;
      const rec = _bargeStockForecast(b, 168).recs.find(x => x.grade === 'LSMGO');
      return { b, rec: { qty: rec.qty, planStart: rec.planStart.toISOString(), key: rec.key, d: _localDateInputStr(rec.planStart), t: _localTimeInputStr(rec.planStart) }, nLoad: _loadingRecords.length, btns: document.querySelectorAll('#reload-planner-body .rl-plan-btn').length };
    }, SEED_MAIN.toString());
    const ver0 = db.tables.abps_workspace.get('main').version;
    const writes0 = db.log.filter(o => o.action !== 'select').length;
    check('R7 operator sees a Plan this loading button per recommendation', setup.btns === 2, setup.btns);
    await pa.click('#reload-planner-body .rl-rec[data-grade="LSMGO"] .rl-plan-btn');
    await pa.waitForTimeout(300);
    const form = await pa.evaluate(() => ({
      page: _currentPage, barge: document.getElementById('ld-barge').value, grade: document.getElementById('ld-grade').value,
      qty: document.getElementById('ld-qty').value, d: document.getElementById('ld-start-date').value, t: document.getElementById('ld-start-time').value,
      pre: document.getElementById('ld-pre-ops').value, post: document.getElementById('ld-post-ops').value, terminal: document.getElementById('ld-terminal').value,
      note: (document.getElementById('ld-prefill-note') || {}).textContent || '', dur: document.getElementById('ld-duration-display').value, n: _loadingRecords.length
    }));
    check('R7 opens the Loading page with barge, grade, quantity, start (local date/time) pre-filled', form.page === 'loading' && form.barge === 'Al Noor' && form.grade === 'LSMGO' && Number(form.qty) === setup.rec.qty &&
      form.d === setup.rec.d && form.t === setup.rec.t, [form, setup.rec]);
    check('R7 pre-ops/post-ops defaults + last terminal for the barge, estimate shown', form.pre === '2.5' && form.post === '3.5' && form.terminal === 'VOPAK' && form.dur === '7h 20m', [form.pre, form.post, form.terminal, form.dur]);
    check('R7 note says nothing is saved until Add Loading', /nothing is saved until you do/.test(form.note), form.note);
    await pa.waitForTimeout(500);
    check('R7 nothing saved yet (no new loading, no cloud write)', form.n === setup.nLoad && db.tables.abps_workspace.get('main').version === ver0 && db.log.filter(o => o.action !== 'select').length === writes0, [form.n, setup.nLoad, writes0]);
    await pa.click('#loading-submit-btn');
    await pa.waitForTimeout(300);
    const after = await pa.evaluate(async (b) => {
      await _waitForSaveIdle();
      const fc = _bargeStockForecast(b, 168);
      return { n: _loadingRecords.length, recs: fc.recs.map(r => [r.grade, r.vessel]), note: getComputedStyle(document.getElementById('ld-prefill-note')).display };
    }, setup.b);
    check('R7 after Add Loading: one new loading, LSMGO breach gone, VLSFO one stays', after.n === setup.nLoad + 1 && !after.recs.some(r => r[0] === 'LSMGO') && after.recs.some(r => r[0] === 'VLSFO'), after);
    check('R7 pre-fill note cleared after saving', after.note === 'none', after.note);
    const cloud = db.tables.abps_workspace.get('main').payload.state.loadingRecords || [];
    check('R7 loading saved to the shared workspace', cloud.filter(x => !x.deletedAt).length === 2 && cloud.some(x => x.grade === 'LSMGO' && x.qty === setup.rec.qty && x.barge === 'Al Noor'), cloud.map(x => [x.grade, x.qty]));
    const B = await open('user-operator2');
    const rb = await B.page.evaluate(async (b) => {
      const t0 = Date.now();
      for (;;) {
        const ok = _loadingRecords.filter(x => !x.deletedAt).length === 2 && (_bargeConfig || []).length > 0 && (_lastSched || []).length > 0;
        if (ok || Date.now() - t0 > 15000) break;
        await new Promise(res => setTimeout(res, 250));
      }
      showPage('bargefleet');
      const fc = _bargeStockForecast(b, 168);
      return { recs: fc.recs.map(r => [r.grade, r.vessel]), cards: document.querySelectorAll('#reload-planner-body .rl-card').length,
        lsRows: document.querySelectorAll('#reload-planner-body .rl-rec[data-grade="LSMGO"]').length };
    }, setup.b);
    check('R7 second device: loading synced, no LSMGO breach there either', rb.cards === 2 && rb.lsRows === 0 && !rb.recs.some(r => r[0] === 'LSMGO') && rb.recs.some(r => r[0] === 'VLSFO'), rb);
  });

  /* 8 — dashboard alerts: bell + Needs Attention, stable keys, link to the
     forecast; a planned loading clears it */
  await scenario(browser, 'R8 dashboard alert', async ({ page }) => {
    const r = await page.evaluate((seed) => {
      eval('(' + seed + ')')();
      showPage('dashboard');
      _refreshGlobalAlertsBell();
      const k1 = computeGlobalAlerts().filter(a => a.kind === 'reload').map(a => a.key);
      const k2 = computeGlobalAlerts().filter(a => a.kind === 'reload').map(a => a.key);
      const items = [...document.querySelectorAll('#global-alerts-list .ga-link')].map(x => x.textContent.replace(/\s+/g, ' ').trim());
      const aq = [...document.querySelectorAll('#dash-action-queue .aq-row')].filter(x => /RELOAD/.test(x.textContent)).map(x => x.textContent.replace(/\s+/g, ' ').trim());
      return { k1, k2, items, aq, badge: document.getElementById('global-alerts-badge').textContent };
    }, SEED_MAIN.toString());
    check('R8 two reload alerts with stable, unique keys', r.k1.length === 2 && JSON.stringify(r.k1) === JSON.stringify(r.k2) && new Set(r.k1).size === 2 && r.k1.every(k => /^reload\|\d+\|(VLSFO|LSMGO)\|/.test(k)), r.k1);
    check('R8 bell: "Al Noor LSMGO short for OPAL HORIZON (Ddd HH:MM) — reload by Ddd HH:MM"', r.items.some(t => /Reload needed\s*Al Noor LSMGO short for OPAL HORIZON \((Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d\d:\d\d\) — reload by (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d\d:\d\d/.test(t)), r.items);
    check('R8 Needs Attention lists both reloads with a View reload plan action', r.aq.length === 2 && r.aq.every(t => /View reload plan/.test(t)), r.aq);
    await page.evaluate(() => { toggleGlobalAlertsPanel(); document.querySelector('#global-alerts-list .ga-link').click(); });
    await page.waitForTimeout(400);
    const nav = await page.evaluate(() => ({ page: _currentPage, flash: document.querySelectorAll('#reload-planner-body .rl-card.rl-flash').length, dd: document.getElementById('global-alerts-dropdown').style.display }));
    check('R8 clicking the alert opens Barge Fleet at that barge\'s forecast', nav.page === 'bargefleet' && nav.flash === 1 && nav.dd === 'none', nav);
    const r2 = await page.evaluate(() => {
      _loadingRecords.push({ id: 'ld_fix', barge: 'Al Noor', terminal: 'VOPAK', grade: 'LSMGO', qty: 300, startAt: __at(30).toISOString(), endAt: __at(37).toISOString(), updatedAt: Date.now() });
      _refreshLoadingConsumers();
      return { alerts: computeGlobalAlerts().filter(a => a.kind === 'reload').map(a => a.sub), rows: document.querySelectorAll('#reload-planner-body .rl-rec[data-grade="LSMGO"]').length,
        bell: [...document.querySelectorAll('#global-alerts-list .ga-link')].length };
    });
    check('R8 a planned loading before the job clears that alert (bell + section re-rendered)', r2.alerts.length === 1 && /VLSFO/.test(r2.alerts[0]) && r2.rows === 0 && r2.bell === 1, r2);
  });

  /* 9 — trader: sees the forecast (dashboard copy) but no plan button */
  await scenario(browser, 'R9 trader view', async (A, { db, open }) => {
    await A.page.evaluate(async (seed) => { eval('(' + seed + ')')(); await saveSharedState(); await _waitForSaveIdle(); }, SEED_MAIN.toString());
    const T = await open('user-trader');
    const r = await T.page.evaluate(async () => {
      const t0 = Date.now();
      while (!((_lastSched || []).length && (_bargeConfig || []).length) && Date.now() - t0 > 15000 === false) await new Promise(res => setTimeout(res, 250));
      showPage('dashboard');
      const card = document.getElementById('dash-reload-planner');
      const n0 = _loadingRecords.length;
      rlPlanLoading(String(_bargeConfig[0].id), 'reload|' + _bargeConfig[0].id + '|LSMGO|x', 168);
      _refreshGlobalAlertsBell();
      const link = document.querySelector('#global-alerts-list .ga-link');
      if (link) link.click();
      return { shown: getComputedStyle(card).display !== 'none', cards: card.querySelectorAll('.rl-card').length, recs: card.querySelectorAll('.rl-rec').length,
        btns: document.querySelectorAll('.rl-plan-btn').length, page: _currentPage, n: _loadingRecords.length, n0, link: !!link,
        fleetNav: getComputedStyle(document.getElementById('nav-bargefleet')).display };
    });
    check('R9 trader dashboard shows the forecast with its recommendations', r.shown && r.cards === 2 && r.recs === 2, r);
    check('R9 trader gets no Plan this loading button and the call is a no-op', r.btns === 0 && r.n === r.n0, r);
    check('R9 trader alert click stays on the dashboard copy (Barge Fleet is hidden for traders)', r.link && r.page === 'dashboard' && r.fleetNav === 'none', r);
    const opCard = await A.page.evaluate(() => { showPage('dashboard'); return getComputedStyle(document.getElementById('dash-reload-planner')).display; });
    check('R9 operator dashboard does not duplicate the planner (it lives on Barge Fleet)', opCard === 'none', opCard);
  });

  /* 10 — hostile barge / vessel names render as text everywhere */
  await scenario(browser, 'R10 xss-safe names', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.__x = 0;
      const X = '<img src=x onerror="window.__x=1">\'";';
      const b = __barge({ name: 'B ' + X, vrob: 4000, mrob: 300 });
      __vessel({ name: 'V ' + X, type: 'MGO', qty: 0, mgo: 250, etaHrs: 30, bargeId: b });
      calculate();
      showPage('bargefleet');
      _refreshGlobalAlertsBell();
      renderActionQueue();
      await new Promise(res => setTimeout(res, 200));
      const sec = document.getElementById('reload-planner-body');
      const imgs = sec.querySelectorAll('img').length + document.querySelectorAll('#global-alerts-list img, #dash-action-queue img').length;
      const txt = sec.textContent;
      const titles = [...sec.querySelectorAll('[title]')].map(e => e.title);
      // the plan button's onclick survives the quotes in the key
      document.querySelector('#reload-planner-body .rl-plan-btn').click();
      return { imgs, x: window.__x, hasText: txt.includes('V <img src=x') && txt.includes('B <img src=x'), title: titles.some(t => t.includes('V <img src=x')),
        bell: document.getElementById('global-alerts-list').textContent.includes('V <img src=x'), page: _currentPage, barge: document.getElementById('ld-barge').value };
    });
    check('R10 no injected elements, nothing executed', r.imgs === 0 && r.x === 0, r);
    check('R10 names shown literally in card text, marker titles and alerts', r.hasText && r.title && r.bell, r);
    check('R10 Plan button works with quotes in the names', r.page === 'loading' && r.barge.startsWith('B <img'), r);
  });

  /* 11 — horizon selector, "all good", both looks + phone width */
  await scenario(browser, 'R11 horizon, all good, looks', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const b = __barge({ name: 'Calm Barge', vrob: 4000, mrob: 800 });
      __vessel({ name: 'SMALL', type: 'VLSFO', qty: 300, mgo: 0, etaHrs: 20, bargeId: b });
      __vessel({ name: 'LATE BIG', type: 'MGO', qty: 0, mgo: 700, etaHrs: 24 * 9, bargeId: b });
      calculate();
      showPage('bargefleet');
      const t7 = document.querySelector('#reload-planner-body .rl-card').textContent;
      [...document.querySelectorAll('#reload-planner-body .rl-horizon button')].find(x => /14 days/.test(x.textContent)).click();
      const t14 = document.querySelector('#reload-planner-body .rl-card').textContent;
      const pressed = document.querySelector('#reload-planner-body .rl-horizon [aria-pressed="true"]').textContent;
      return { t7, t14, pressed, ls: localStorage.getItem('flow_reload_horizon_days'), events: document.querySelectorAll('#reload-planner-body .rl-events li').length };
    });
    check('R11 7 days: "All good through <date>"', /All good through (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d+ \w{3} \d\d:\d\d/.test(r.t7), r.t7.slice(0, 400));
    check('R11 14 days: LATE BIG (day 9) now shows an LSMGO reload, choice remembered', /Reload LSMGO ≥ 50 MT/.test(r.t14) && r.pressed === '14 days' && r.ls === '14', [r.t14.slice(0, 500), r.pressed, r.ls]);
    check('R11 accessible event list lists both jobs', r.events === 2, r.events);
    await page.evaluate(() => rlSetHorizon(7));
    // Both looks (+ Classic dark): lines coloured from tokens, layout holds.
    const looks = [];
    for (const step of ['harbour', 'classic', 'classic-dark']) {
      const s = await page.evaluate((step) => {
        if (step === 'classic') toggleSkin();
        if (step === 'classic-dark' && document.documentElement.dataset.theme !== 'dark') toggleColorTheme();
        renderReloadPlanner('reload-planner-body');
        const path = document.querySelector('#reload-planner-body .rl-chart svg path[fill="none"]');
        const card = document.querySelector('#reload-planner-body .rl-card');
        return { skin: document.documentElement.dataset.skin, theme: document.documentElement.dataset.theme, stroke: getComputedStyle(path).stroke, bg: getComputedStyle(card).backgroundColor, w: card.getBoundingClientRect().width };
      }, step);
      looks.push(s);
    }
    check('R11 renders in Harbour, Classic and Classic dark with token colours', looks.length === 3 && looks.every(l => /rgb/.test(l.stroke) && l.w > 300) && looks[0].skin === 'harbour' && looks[1].skin === 'classic' && looks[2].theme === 'dark' && looks[1].bg !== looks[2].bg, looks);
  });

  /* 12 — phone width: no horizontal overflow; screenshots of both looks */
  await scenario(browser, 'R12 phone and screenshots', async ({ page }) => {
    const seedAndShow = async () => page.evaluate(async (seed) => {
      eval('(' + seed + ')')();
      try { flowWelcomeGo('dashboard'); } catch (e) {}
      await new Promise(res => setTimeout(res, 600));
      showPage('bargefleet');
    }, SEED_MAIN.toString());
    await seedAndShow();
    // scroll an element to just under the sticky top bar (screenshots)
    // (instant: the app scrolls smoothly, which a screenshot would catch mid-way)
    await page.evaluate(() => { window.__below = el => {
      const hb = document.getElementById('topbar'), off = (hb ? hb.getBoundingClientRect().bottom : 0) + 8;
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - off, behavior: 'instant' });
    }; });
    const fs = require('fs');
    if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
    const sec = page.locator('#reload-planner-section');
    if (SHOTS) {
      await sec.screenshot({ path: path.join(SHOTS, 'reload-harbour-desktop.png') });
      await page.locator('#reload-planner-body .rl-card').first().screenshot({ path: path.join(SHOTS, 'reload-breach-card.png') });
      await page.evaluate(() => { showPage('dashboard'); _refreshGlobalAlertsBell(); document.querySelectorAll('.toast, #toast-container > *').forEach(t => t.remove()); window.scrollTo(0, 0); toggleGlobalAlertsPanel(); });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOTS, 'reload-dashboard-alert.png') });
      await page.evaluate(() => { toggleGlobalAlertsPanel(); __below(document.getElementById('dash-action-queue')); });
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(SHOTS, 'reload-needs-attention.png') });
      await page.evaluate(() => { toggleSkin(); showPage('bargefleet'); });
      await page.waitForTimeout(300);
      await sec.screenshot({ path: path.join(SHOTS, 'reload-classic-desktop.png') });
      await page.evaluate(() => { toggleSkin(); });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => showPage('bargefleet'));
    await page.waitForTimeout(400);
    const m = await page.evaluate(() => {
      const body = document.getElementById('reload-planner-body');
      const cards = [...body.querySelectorAll('.rl-card')];
      return { docW: document.documentElement.scrollWidth, winW: innerWidth, cardsFit: cards.every(c => c.getBoundingClientRect().right <= innerWidth + 1), cardW: Math.round(cards[0].getBoundingClientRect().width), chartH: cards[0].querySelector('.rl-chart').getBoundingClientRect().height };
    });
    check('R12 phone width: cards fit the screen, no horizontal page scroll', m.docW <= m.winW + 1 && m.cardsFit && m.cardW > 250 && m.chartH >= 120, m);
    if (SHOTS) {
      for (const look of ['harbour', 'classic']) {
        if (look === 'classic') await page.evaluate(() => toggleSkin());
        await page.evaluate(() => __below(document.querySelector('#reload-planner-body .rl-chart')));
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(SHOTS, 'reload-phone-' + look + '.png') });
      }
      await page.evaluate(() => toggleSkin());
    }
  });

  await browser.close();
  console.log(`RELOAD: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})();
