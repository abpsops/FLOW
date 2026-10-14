/* Free Windows reliability tests (items 1–8).
   node fw.test.js [appDir] [only]   — default appDir = the repository root
   Every scenario builds its own barges / vessels / loadings through the app's
   own functions (addBarge, addVessel, calculate…) with times relative to now. */
const path = require('path');
const H = require(path.join(__dirname, '..', '..', 'harness', 'harness.js'));
const appDir = process.argv[2] || H.APP_DIR;
const only = process.argv[3] || '';

let pass = 0, fail = 0;
function check(name, cond, info) {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 600)));
}
const HR = 3600000;
const near = (a, b, tolMs) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= (tolMs || 60000);

const PAGE_HELPERS = () => {
  window.__fmt = function (d) {
    const p = n => String(n).padStart(2, '0');
    return d.getDate() + ' ' + MO[d.getMonth()] + ' ' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  };
  // hours from now, rounded to the minute, never exactly 00:00 (= "no firm ETA")
  window.__at = function (hrs) {
    const d = new Date(Date.now() + hrs * 3600000); d.setSeconds(0, 0);
    if (d.getHours() === 0 && d.getMinutes() === 0) d.setMinutes(7);
    return d;
  };
  window.__reset = function () {
    document.querySelectorAll('.vcard[id^="vessel-"]').forEach(c => c.remove());
    (_barges || []).slice().forEach(b => rmBarge(b.id));
    _lastSched = []; _checklistRecords = {}; _savedSupplies = []; _deliveryLog = {}; _loadingRecords = [];
    if (typeof _bargeBlocks !== 'undefined') _bargeBlocks = [];
  };
  window.__barge = function (def) { addBarge(def); return _barges[_barges.length - 1].id; };
  window.__vessel = function (def) {
    const d = Object.assign({ area: 'FUJ-A', lc: '', paq: 'no' }, def);
    if (d.etaHrs !== undefined) d.eta = __fmt(__at(d.etaHrs));
    addVessel(d);
    const cards = document.querySelectorAll('.vcard[id^="vessel-"]');
    return cards[cards.length - 1].dataset.nomUid;
  };
  window.__card = function (nomUid) {
    const c = Array.from(document.querySelectorAll('.vcard[id^="vessel-"]')).find(x => x.dataset.nomUid === nomUid);
    return c ? c.id.replace('vessel-', '') : null;
  };
  window.__nsc = function (v, m, etaHrs, name) {
    document.getElementById('nsc-vessel-name').value = name || 'CHECK VSL';
    document.getElementById('nsc-req-v').value = v || '';
    document.getElementById('nsc-req-m').value = m || '';
    document.getElementById('nsc-vessel-eta').value = etaHrs === null || etaHrs === undefined ? '' : __fmt(__at(etaHrs));
    checkNSCUnified();
    const res = document.getElementById('nsc-unified-result');
    const ids = Object.keys(_nscCheckData);
    return { text: res ? res.textContent : '', data: _nscCheckData[ids[ids.length - 1]] };
  };
  window.__fw = function (bid, name) {
    const r = _freeWindowsWeekRange();
    return computeFreeWindows(bid, name, r.weekStart, r.weekEnd).map(w => {
      const o = {};
      Object.keys(w).forEach(k => { o[k] = (w[k] instanceof Date) ? w[k].toISOString() : (w[k] === Infinity ? 'Inf' : w[k]); });
      return o;
    });
  };
  window.__toasts = [];
  if (!window.__toastWrapped) {
    const orig = showToast; window.__toastWrapped = true;
    showToast = function (m) { window.__toasts.push(String(m)); return orig.apply(this, arguments); };
  }
};

async function openApp(browser, db, uid) {
  const app = await H.openApp(browser, db, { appDir, uid: uid || 'user-operator' });
  await app.page.evaluate(PAGE_HELPERS);
  return app;
}
function realErrors(app) { return app.errors.filter(e => !/capacitorExports/.test(e)); }

async function scenario(browser, name, fn) {
  if (only && !name.includes(only)) return;
  console.log('— ' + name);
  const db = H.createDb();
  const apps = [];
  const open = async (uid) => { const a = await openApp(browser, db, uid); apps.push(a); return a; };
  try {
    const app = await open('user-operator');
    await app.page.evaluate(() => __reset());
    await fn(app, { db, open });
  } catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
  const errs = [].concat(...apps.map(realErrors));
  check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
  for (const a of apps) await a.ctx.close();
}

(async () => {
  const browser = await H.launch();

  /* 1 — a later committed job (even one after the displayed week) reduces
     what an earlier window can offer: ATP = lowest projected ROB, not ROB at
     window start. */
  await scenario(browser, 'T1 later jobs reduce earlier window', async ({ page }) => {
    const r = await page.evaluate(() => {
      const b = __barge({ name: 'B1', vrob: 4000, mrob: 800, vbuf: 500, mbuf: 150 });
      __vessel({ name: 'MV FIRST', type: 'VLSFO', qty: 500, mgo: 0, etaHrs: 10, bargeId: b });
      __vessel({ name: 'MV LATER', type: 'VLSFO', qty: 2000, mgo: 0, etaHrs: 120, bargeId: b });
      __vessel({ name: 'MV NEXT WEEK', type: 'VLSFO', qty: 400, mgo: 0, etaHrs: 216, bargeId: b });
      calculate();
      return __fw(b, 'B1');
    });
    const gaps = r.filter(w => w.status === 'free' || w.status === 'short');
    const second = gaps[1];
    check('T1 window between FIRST and LATER is free', second && second.status === 'free', second);
    check('T1 its estimate is capped by ROB after ALL later jobs (4000−500−2000−400−500 buffer = 600), not 3500 onboard', second && second.estV === 600, second && { estV: second.estV, atpV: second.atpV });
    check('T1 ATP reported = 600 VLSFO, 650 LSMGO (800−150 buffer)', second && second.atpV === 600 && second.atpM === 650, second && [second.atpV, second.atpM]);
    check('T1 job after the displayed week still counted, but not displayed', !r.some(w => /NEXT WEEK/.test(w.label || '')) && second && second.atpV === 600);
  });

  /* 2 — minimum-stock buffer is never offered */
  await scenario(browser, 'T2 buffer subtracted', async ({ page }) => {
    const r = await page.evaluate(() => {
      const b = __barge({ name: 'B1', vrob: 2000, mrob: 300, vbuf: 700, mbuf: 150 });
      __vessel({ name: 'FAR AWAY', type: 'VLSFO', qty: 1, mgo: 0, etaHrs: 24 * 40, bargeId: b }); // beyond the 30-day look-ahead
      calculate();
      return __fw(b, 'B1');
    });
    const w = r[0];
    check('T2 open window estimate = ROB − buffer (2000−700=1300 VLSFO, 300−150=150 LSMGO)', w && w.status === 'free' && w.estV === 1300 && w.estM === 150, w && [w.status, w.estV, w.estM]);
  });

  /* 3 — travel (both ends) + hose-up + contingency shrink usable hours; a
     short gap becomes "Too short" */
  await scenario(browser, 'T3 travel contingency too short', async ({ page }) => {
    const r = await page.evaluate(() => {
      const b = __barge({ name: 'B1', vrob: 4000, mrob: 800 });
      __vessel({ name: 'MV A', type: 'VLSFO', qty: 600, mgo: 0, etaHrs: 3, bargeId: b });   // ETC +11h
      __vessel({ name: 'MV B', type: 'VLSFO', qty: 300, mgo: 0, etaHrs: 25, bargeId: b });  // ETC +32h
      __vessel({ name: 'MV C', type: 'VLSFO', qty: 300, mgo: 0, etaHrs: 41, bargeId: b });
      calculate();
      const s = _lastSched.map(i => ({ n: i.name, s: i.bargeStart.toISOString(), e: i.etc.toISOString() }));
      toggleFreeWindowsPanel();
      const shortTxt = [...document.querySelectorAll('#free-windows-panel .fw-short')].map(x => x.textContent);
      const freeTitle = (document.querySelector('#free-windows-panel .fw-free') || {}).title || '';
      return { rows: __fw(b, 'B1'), s, shortTxt, freeTitle, p: _calcParams };
    });
    const [A, B, C] = r.s;
    const gAB = r.rows.find(w => w.gapEnd && near(w.gapEnd, B.s));
    const gBC = r.rows.find(w => w.gapEnd && near(w.gapEnd, C.s));
    check('T3 A→B gap starts at ETC + 1h contingency', gAB && near(gAB.gapStart, new Date(new Date(A.e).getTime() + HR)), gAB && [gAB.gapStart, A.e]);
    check('T3 A→B usable = 13h gap − 1h travel in − 1h travel out − 6h hose − 1h contingency = 4h', gAB && Math.abs(gAB.usableHrs - 4) < 0.05 && gAB.travelBefore === 1 && gAB.travelAfter === 1 && gAB.contingencyHrs === 1, gAB && [gAB.usableHrs, gAB.travelBefore, gAB.travelAfter]);
    check('T3 A→B estimate = 4h × 300 MT/h = 1200 VLSFO, still free', gAB && gAB.status === 'free' && gAB.estV === 1200, gAB && [gAB.status, gAB.estV]);
    check('T3 B→C (8h gap) is Too short (usable ≤ 0)', gBC && gBC.status === 'short' && gBC.shortReason === 'time' && gBC.usableHrs < 0, gBC && [gBC.status, gBC.usableHrs]);
    check('T3 panel renders a grey Too short row with the breakdown', r.shortTxt.some(t => /Too short/.test(t) && /travel in/.test(t) && /contingency/.test(t)), r.shortTxt);
    check('T3 free row tooltip shows usable hours + ATP', /= 4h pumping/.test(r.freeTitle) && /Available to promise/.test(r.freeTitle), r.freeTitle);
  });

  /* 4 — overlapping Loading + supply: shown as a Conflict, nothing moved */
  await scenario(browser, 'T4 conflict shown not hidden', async ({ page }) => {
    const r = await page.evaluate(() => {
      const b = __barge({ name: 'B1', vrob: 4000, mrob: 800 });
      __vessel({ name: 'MV OVERLAP', type: 'VLSFO', qty: 1500, mgo: 0, etaHrs: 5, bargeId: b }); // ETC +16h
      calculate();
      const ls = __at(10), le = __at(20);
      _loadingRecords.push({ id: 'ld_t4', barge: 'B1', terminal: 'VOPAK', grade: 'VLSFO', qty: 1000, startAt: ls.toISOString(), endAt: le.toISOString(), updatedAt: Date.now() });
      toggleFreeWindowsPanel();
      const conf = [...document.querySelectorAll('#free-windows-panel .fw-conflict')].map(x => x.textContent);
      const it = _lastSched[0];
      return { rows: __fw(b, 'B1'), ls: ls.toISOString(), le: le.toISOString(), vs: it.bargeStart.toISOString(), ve: it.etc.toISOString(), conf };
    });
    const ld = r.rows.find(w => w.kind === 'loading');
    const vs = r.rows.find(w => w.kind === 'vessel');
    const cf = r.rows.find(w => w.status === 'conflict');
    check('T4 loading keeps its own start (not re-sequenced after the supply)', ld && near(ld.start, r.ls) && near(ld.end, r.le), ld && [ld.start, r.ls]);
    check('T4 supply keeps its own times', vs && near(vs.start, r.vs) && near(vs.end, r.ve));
    check('T4 Conflict row names both items and the overlap window', cf && /MV OVERLAP/.test(cf.a) && /VOPAK/.test(cf.b) && near(cf.overlapStart, r.ls) && near(cf.overlapEnd, r.ve), cf);
    check('T4 panel shows the red Conflict block', r.conf.length === 1 && /Conflict/.test(r.conf[0]) && /MV OVERLAP/.test(r.conf[0]) && /VOPAK/.test(r.conf[0]), r.conf);
    const after = r.rows.find(w => (w.status === 'free' || w.status === 'short') && new Date(w.gapStart) > new Date(r.ls));
    check('T4 free time resumes after the LATER end (+ contingency)', after && near(after.gapStart, new Date(new Date(r.le).getTime() + HR)), after && after.gapStart);
  });

  /* 5 — staleness: generated-at line, amber warning after an edit, gone after
     Regenerate, and the stamp survives a reload */
  await scenario(browser, 'T5 staleness', async ({ page }) => {
    const r1 = await page.evaluate(async () => {
      const b = __barge({ name: 'B1', vrob: 4000, mrob: 800 });
      const u = __vessel({ name: 'MV STALE', type: 'VLSFO', qty: 500, mgo: 0, etaHrs: 20, bargeId: b });
      calculate();
      await saveSharedState();
      toggleFreeWindowsPanel();
      const gen = document.getElementById('fw-sched-gen').textContent;
      const warn0 = !!document.getElementById('fw-stale-warning');
      document.getElementById('v' + __card(u) + '-vlsfo').value = '900';
      renderFreeWindowsPanel();
      const w1 = document.getElementById('fw-stale-warning');
      return { gen, warn0, warn1: w1 ? w1.textContent : null, at: _lastSchedMeta && _lastSchedMeta.generatedAt };
    });
    check('T5 panel says "Based on schedule generated <time>"', /Based on schedule generated \d/.test(r1.gen), r1.gen);
    check('T5 no warning right after generating', r1.warn0 === false);
    check('T5 amber warning after editing a nomination, with a Regenerate button', r1.warn1 && /changed since/.test(r1.warn1) && /1 nomination edited/.test(r1.warn1) && /Regenerate/.test(r1.warn1), r1.warn1);
    await page.evaluate(() => document.getElementById('fw-regenerate-btn').click());
    await page.waitForTimeout(300);
    const r2 = await page.evaluate(async () => { await saveSharedState(); return { warn: !!document.getElementById('fw-stale-warning'), q: _lastSched[0].vQ, at: _lastSchedMeta.generatedAt }; });
    check('T5 Regenerate re-ran the schedule and cleared the warning', !r2.warn && r2.q === 900, r2);
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(2500);
    await page.evaluate(PAGE_HELPERS);
    const r3 = await page.evaluate(() => { toggleFreeWindowsPanel(); return { at: _lastSchedMeta && _lastSchedMeta.generatedAt, warn: !!document.getElementById('fw-stale-warning'), gen: document.getElementById('fw-sched-gen').textContent }; });
    check('T5 generation stamp persisted across reload, still not stale', r3.at === r2.at && !r3.warn && /Based on schedule generated/.test(r3.gen), r3);
  });

  /* 6 — contingency param: persisted + synced, and moves the Availability
     Check's earliest start (scheduler ETCs unchanged) */
  await scenario(browser, 'T6 contingency param', async ({ page }, { db }) => {
    await page.evaluate(async () => {
      openCalcParamsEdit();
      document.getElementById('calc-contingency-input').value = '3';
      saveCalcParamsEdit();
      await _waitForSaveIdle();
    });
    const inCloud = (db.tables.abps_workspace.get('main') || { payload: { state: {} } }).payload.state.calcParams;
    check('T6 contingency saved to the shared workspace', inCloud && inCloud.contingencyHrs === 3, inCloud);
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(2500);
    await page.evaluate(PAGE_HELPERS);
    const p = await page.evaluate(() => ({ c: _calcParams.contingencyHrs, view: document.getElementById('calc-view-contingency').textContent }));
    check('T6 contingency survives reload (3 hrs shown)', p.c === 3 && p.view === '3 hrs', p);
  });
  await scenario(browser, 'T6b contingency moves Availability Check', async ({ page }) => {
    const r = await page.evaluate(() => {
      _calcParams.contingencyHrs = 3;
      const b = __barge({ name: 'B1', vrob: 4000, mrob: 800 });
      __vessel({ name: 'MV BUSY', type: 'VLSFO', qty: 600, mgo: 0, etaHrs: 2, bargeId: b }); // ETC +10h
      calculate();
      const etc = _lastSched[0].etc.toISOString();
      const a = __nsc(500, 0, 4);
      _calcParams.contingencyHrs = 1;
      const etcAfter = _lastSched[0].etc.toISOString();
      const c = __nsc(500, 0, 4);
      const e = x => x.data && x.data.nominationPlan && x.data.nominationPlan.entries[0].eta;
      return { etc, etcAfter, eta3: e(a), eta1: e(c), travel: _calcParams.travelHrs };
    });
    check('T6 with 3h contingency, earliest start = ETC + 3h + travel', r.eta3 && near(r.eta3, new Date(new Date(r.etc).getTime() + (3 + r.travel) * HR)), r);
    check('T6 with 1h contingency, earliest start = ETC + 1h + travel', r.eta1 && near(r.eta1, new Date(new Date(r.etc).getTime() + (1 + r.travel) * HR)), r);
    check('T6 scheduler ETC itself unchanged by the contingency', r.etc === r.etcAfter);
  });

  /* 7 — unassigned demand line */
  await scenario(browser, 'T7 unassigned demand', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.__fwx = 0;
      __barge({ name: 'B1', vrob: 4000, mrob: 800 });
      __barge({ name: 'B2', vrob: 4000, mrob: 800 });
      __vessel({ name: 'MV AUTO', type: 'VLSFO', qty: 500, mgo: 0, etaHrs: 24 });            // Auto barge
      __vessel({ name: 'MV PLACED', type: 'VLSFO', qty: 100, mgo: 0, etaHrs: 26 });
      calculate();
      const autoLabel = _lastSched[0].bargeLabel;
      _lastSched[0].bargeLabel = '';                                                          // legacy entry with no barge
      __vessel({ name: 'MV NEW', type: 'VLSFO', qty: 800, mgo: 0, etaHrs: 48 });              // added after Generate
      __vessel({ name: 'Y <img src=x onerror="window.__fwx=1">', type: 'MGO', qty: 0, mgo: 200, etaHrs: 30 });
      __vessel({ name: 'MV NEXT MONTH', type: 'VLSFO', qty: 999, mgo: 0, etaHrs: 24 * 20 });  // not this week
      toggleFreeWindowsPanel();
      const el = document.getElementById('fw-unassigned');
      return { autoLabel, text: el ? el.textContent : null, imgs: document.querySelectorAll('#free-windows-panel img').length };
    });
    check('T7 the scheduler always assigns a barge to Auto nominations', !!r.autoLabel, r.autoLabel);
    check('T7 line: 3 vessels — 1,300 MT VLSFO / 200 MT LSMGO', r.text && /Unassigned demand this week: 3 vessels — 1,300 MT VLSFO \/ 200 MT LSMGO/.test(r.text), r.text);
    check('T7 names listed (escaped), placed + next-month ones excluded', r.text && /MV AUTO/.test(r.text) && /MV NEW/.test(r.text) && /Y <img src=x/.test(r.text) && !/MV PLACED/.test(r.text) && !/NEXT MONTH/.test(r.text), r.text);
    const x = await page.evaluate(() => window.__fwx);
    check('T7 vessel name not executed as HTML', r.imgs === 0 && x === 0, { imgs: r.imgs, x });
  });

  /* 8 — Unavailable blocks: UI, Free Windows, Availability Check, scheduler,
     two-device sync (add + delete), trader can't see or write them */
  await scenario(browser, 'T8 block out time', async (A, { db, open }) => {
    const pa = A.page;
    const setup = await pa.evaluate(async () => {
      const b = __barge({ name: 'B1', vrob: 4000, mrob: 800 });
      __vessel({ name: 'MV BLOCKED', type: 'VLSFO', qty: 600, mgo: 0, etaHrs: 24, bargeId: b }); // ETC +32h
      __vessel({ name: 'MV LATER', type: 'VLSFO', qty: 300, mgo: 0, etaHrs: 70, bargeId: b });
      calculate();
      await saveSharedState();
      toggleFreeWindowsPanel();
      return { b, k: _fwKey(b) };
    });
    // Block 1 through the panel UI: +20h → +30h
    // Open the form, fill it and press Save in ONE page task: on a busy machine a
    // panel re-render between separate steps would swap in fresh, empty inputs.
    const fill = async (sH, eH, reason) => {
      await pa.evaluate(() => _waitForSaveIdle());
      await pa.evaluate(([k, sH, eH, reason]) => {
        const form = document.getElementById('fw-blk-form-' + k);
        if (!form || form.style.display === 'none') document.getElementById('fw-blk-btn-' + k).click();
        const s = __at(sH), e = __at(eH);
        document.getElementById('fw-blk-sd-' + k).value = _localDateInputStr(s);
        document.getElementById('fw-blk-st-' + k).value = _localTimeInputStr(s);
        document.getElementById('fw-blk-ed-' + k).value = _localDateInputStr(e);
        document.getElementById('fw-blk-et-' + k).value = _localTimeInputStr(e);
        document.getElementById('fw-blk-reason-' + k).value = reason;
        document.getElementById('fw-blk-save-' + k).click();
      }, [setup.k, sH, eH, reason]);
      await pa.waitForTimeout(300);
      await pa.evaluate(() => _waitForSaveIdle());
    };
    await fill(20, 30, 'Dry dock <b>x</b>');
    const r1 = await pa.evaluate((b) => {
      const rows = __fw(b, 'B1');
      const un = [...document.querySelectorAll('#free-windows-panel .fw-unavailable')];
      return { blocks: _bargeBlocks.map(x => ({ reason: x.reason, by: x.createdBy, start: x.start, end: x.end, id: x.id })), rows,
        unTxt: un.map(x => x.textContent), unB: un.some(x => x.querySelector('b')),
        stale: (document.getElementById('fw-stale-warning') || {}).textContent || '', toasts: window.__toasts.slice() };
    }, setup.b);
    const blk = r1.blocks[0];
    check('T8 block saved from the panel form (with creator)', r1.blocks.length === 1 && blk.reason === 'Dry dock <b>x</b>' && blk.by === 'user-operator@test', r1.blocks);
    check('T8 Free Windows shows it as Unavailable — reason (escaped)', r1.unTxt.length === 1 && /Unavailable — Dry dock <b>x<\/b>/.test(r1.unTxt[0]) && !r1.unB, r1.unTxt);
    const before = r1.rows.find(w => (w.status === 'free' || w.status === 'short') && w.gapEnd && near(w.gapEnd, blk.start));
    check('T8 the free window before it stops at the block start', !!before, r1.rows.map(w => [w.status, w.gapEnd]));
    const cf = r1.rows.find(w => w.status === 'conflict');
    check('T8 already-scheduled job inside the block is flagged as a Conflict', cf && /Unavailable/.test(cf.a) && /MV BLOCKED/.test(cf.b), cf);
    check('T8 toast warns about the overlapping job', r1.toasts.some(t => /overlaps MV BLOCKED/.test(t)), r1.toasts);
    check('T8 schedule flagged stale (unavailable blocks)', /unavailable blocks/.test(r1.stale), r1.stale);

    // Regenerate: the scheduler waits the block out (+ transit) and warns
    await pa.evaluate(() => document.getElementById('fw-regenerate-btn').click());
    await pa.waitForTimeout(300);
    const r2 = await pa.evaluate(async (b) => {
      await _waitForSaveIdle();
      const it = _lastSched.find(i => i.name === 'MV BLOCKED');
      return { start: it.bargeStart.toISOString(), waited: it.waitedForBarge, conf: __fw(b, 'B1').filter(w => w.status === 'conflict').length,
        toasts: window.__toasts.filter(t => /Unavailable blocks moved/.test(t)) };
    }, setup.b);
    check('T8 regenerated job starts after block end + travel', near(r2.start, new Date(new Date(blk.end).getTime() + HR)) && r2.waited === true, r2);
    check('T8 scheduler warned that it moved the job', r2.toasts.length === 1 && /MV BLOCKED on B1 waits for "Dry dock/.test(r2.toasts[0]), r2.toasts);
    check('T8 no conflict left after regenerate', r2.conf === 0);

    // Block 2 (+44h → +56h) and an Availability Check request inside it
    await fill(44, 56, 'Weather');
    const ac = await pa.evaluate(() => {
      const r = __nsc(500, 0, 46, 'NEW REQ');
      const blk2 = _bargeBlocks.find(x => x.reason === 'Weather');
      const e = r.data && r.data.nominationPlan && r.data.nominationPlan.entries[0];
      return { text: r.text, eta: e && e.eta, bs: blk2.start, be: blk2.end, travel: _calcParams.travelHrs };
    });
    const eta = ac.eta && new Date(ac.eta).getTime();
    check('T8 Availability Check does not start inside the block (≥ block end + travel)', eta && eta >= new Date(ac.be).getTime() + ac.travel * HR - 1000, ac);
    check('T8 Availability Check says the requested time is not feasible', !/Requested Time is Feasible/.test(ac.text), ac.text.slice(0, 300));

    // Second operator device picks both blocks up from the cloud
    // (A slow machine may still be applying the pulled workspace when the page
    // settles, so give it up to 15 s, re-rendering the open panel as a later
    // state change would.)
    const B = await open('user-operator2');
    const rb = await B.page.evaluate(async () => {
      toggleFreeWindowsPanel();
      const t0 = Date.now();
      for (;;) {
        const r = { n: _bargeBlocks.length, un: document.querySelectorAll('#free-windows-panel .fw-unavailable').length, items: document.querySelectorAll('#free-windows-panel .fw-blk-item').length };
        if ((r.n === 2 && r.un === 2 && r.items === 2) || Date.now() - t0 > 15000) return r;
        await new Promise(res => setTimeout(res, 250));
        renderFreeWindowsPanel();
      }
    });
    check('T8 blocks synced to a second operator device and shown there', rb.n === 2 && rb.un === 2 && rb.items === 2, rb);

    // Trader: no controls, cannot write
    const T = await open('user-trader');
    await T.page.waitForFunction(() => _bargeBlocks.length === 2 && (_bargeConfig || []).length > 0, null, { timeout: 15000 }).catch(() => {});
    const verBefore = db.tables.abps_workspace.get('main').version;
    const rt = await T.page.evaluate(async (bid) => {
      const btnHidden = getComputedStyle(document.getElementById('free-windows-toggle-btn')).display === 'none';
      renderFreeWindowsPanel(); // even if forced open
      const ctrl = document.querySelectorAll('#free-windows-panel [id^="fw-blk-"], #free-windows-panel .fw-blk-item button').length;
      const n0 = _bargeBlocks.length;
      await addBargeBlock(bid);
      deleteBargeBlock(_bargeBlocks[0] && _bargeBlocks[0].id);
      return { btnHidden, ctrl, n0, n1: _bargeBlocks.length };
    }, setup.b);
    check('T8 trader: Free Windows button hidden, no block controls even if rendered', rt.btnHidden && rt.ctrl === 0, rt);
    check('T8 trader: add/delete are no-ops', rt.n1 === rt.n0 && rt.n0 === 2, rt);
    const cloudBlocks = () => (db.tables.abps_workspace.get('main').payload.state.bargeBlocks || []).map(x => x.reason);
    check('T8 trader wrote nothing to the workspace', db.tables.abps_workspace.get('main').version === verBefore && cloudBlocks().length === 2);

    // Delete on B while A (not pulled) edits something else — deletion must survive the merge
    await B.page.evaluate(async () => {
      const id = _bargeBlocks.find(x => x.reason === 'Weather').id;
      document.querySelector('#free-windows-panel .fw-blk-item[data-block-id="' + id + '"] button').click(); // confirm() auto-accepted
      await _waitForSaveIdle();
    });
    check('T8 delete on device B reached the cloud', JSON.stringify(cloudBlocks()) === JSON.stringify(['Dry dock <b>x</b>']), cloudBlocks());
    await pa.evaluate(async () => {
      const c = document.querySelector('.vcard[id^="vessel-"]');
      document.getElementById('v' + c.id.replace('vessel-', '') + '-remarks').value = 'edited on A';
      await saveSharedState();
    });
    const ra = await pa.evaluate(() => { renderFreeWindowsPanel(); return { blocks: _bargeBlocks.map(x => x.reason), un: document.querySelectorAll('#free-windows-panel .fw-unavailable').length }; });
    check('T8 deletion not resurrected by A\'s concurrent save (merged), A shows 1 block', JSON.stringify(cloudBlocks()) === JSON.stringify(['Dry dock <b>x</b>']) && ra.blocks.length === 1 && ra.un === 1, { cloud: cloudBlocks(), ra });
    const remarks = db.tables.abps_workspace.get('main').payload.state.vessels.map(v => v.remarks);
    check('T8 A\'s concurrent edit kept too', remarks.includes('edited on A'), remarks);

    // Excel export reflects the new row types / numbers / header notes
    const xl = await pa.evaluate(async () => {
      let got = null;
      const orig = _flowSaveOrShareBlob;
      _flowSaveOrShareBlob = async (blob, name) => { got = blob; };
      try { await downloadFreeWindowsReport(null); } finally { _flowSaveOrShareBlob = orig; }
      const ExcelJS = await _loadExcelJS();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await got.arrayBuffer());
      const ws = wb.getWorksheet('Free Windows');
      const rows = [];
      ws.eachRow(r => rows.push(r.values.slice(1).map(v => v == null ? '' : String(v))));
      return rows;
    });
    const flat = xl.map(r => r.join(' | ')).join('\n');
    check('T8 Excel: Unavailable row with reason', /\| Unavailable \|.*Unavailable — Dry dock <b>x<\/b>/.test(flat), flat.slice(0, 1500));
    check('T8 Excel: ATP columns + staleness + unassigned + contingency notes', /ATP VLSFO \(MT\)/.test(flat) && /Based on schedule generated/.test(flat) && /Unassigned demand this week/.test(flat) && /contingency \(1h/.test(flat), flat.slice(0, 900));
    check('T8 Excel: Free rows carry usable hours + ATP numbers', xl.some(r => r[1] === 'Free' && /available to promise/i.test(r[6]) && r[9] !== ''), xl.filter(r => r[1] === 'Free'));
  });

  /* Excel: Conflict + Too short rows */
  await scenario(browser, 'T9 excel conflict and too short', async ({ page }) => {
    const xl = await page.evaluate(async () => {
      const b = __barge({ name: 'B1', vrob: 4000, mrob: 800 });
      __vessel({ name: 'MV X', type: 'VLSFO', qty: 1500, mgo: 0, etaHrs: 5, bargeId: b });
      __vessel({ name: 'MV Y', type: 'VLSFO', qty: 300, mgo: 0, etaHrs: 27, bargeId: b });
      calculate();
      _loadingRecords.push({ id: 'ld_x', barge: 'B1', terminal: 'VOPAK', grade: 'VLSFO', qty: 500, startAt: __at(10).toISOString(), endAt: __at(18).toISOString(), updatedAt: Date.now() });
      let got = null; const orig = _flowSaveOrShareBlob;
      _flowSaveOrShareBlob = async (blob) => { got = blob; };
      try { await downloadFreeWindowsReport(null); } finally { _flowSaveOrShareBlob = orig; }
      const wb = new (await _loadExcelJS()).Workbook(); await wb.xlsx.load(await got.arrayBuffer());
      const rows = []; wb.getWorksheet('Free Windows').eachRow(r => rows.push(r.values.slice(1).map(v => v == null ? '' : String(v))));
      return rows;
    });
    check('T9 Excel: Conflict row naming both', xl.some(r => r[1] === 'Conflict' && /MV X/.test(r[6]) && /VOPAK/.test(r[6])), xl.map(r => r.slice(0, 7)));
    check('T9 Excel: Too short row', xl.some(r => r[1] === 'Too short' && /pumping/.test(r[6])), xl.map(r => r.slice(0, 7)));
  });

  await browser.close();
  console.log(`FW: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})();
