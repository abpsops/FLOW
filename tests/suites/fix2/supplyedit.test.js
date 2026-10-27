/* Editing, moving or deleting a SAVED supply moves the barge ROB, on every device.
   A saved supply is folded ('baked') into the barge's opening ROB, so computeLiveROB
   skips it: an edit / move / delete of it never moved live ROB, and Delete + re-save
   deducted the delivery twice. Now the difference rides as a 'correction' event on the
   barge reload list (synced, merged by id, baked like a reload) — measured against what
   the bake really took off (record.robTook), one event per record step.
   'fresh device' = what the cloud row gives a device that just loaded it.
   • edit 1000 → 800: +200 here, in the cloud, on a colleague's device after sync and on a fresh one
   • a larger actual takes ROB down (clamped at 0 like a supply)
   • move barge A → B (and back): each barge right
   • delete → ROB restored; delete + re-save → deducted once
   • Remove Duplicates / deleting a completed checklist row give the copy back
   • an UNBAKED record's edit has no double effect
   • two devices: one edits the record while the other logs a different supply → both effects
   • a correction is labelled as one, never as a reload or a supply
   • a typo'd actual larger than the barge held: fixing it gives back only what was really taken (S8)
   • two devices deleting / editing the same record before they sync: corrected once (S9)
   • a ROB measured with Update ROB after the supply already holds its correction (S10)
   • a renamed barge / an unassigned record tagged with its barge: no correction (S11)
   • a removed barge added back under its name: its old supplies are not deducted again (S12)
   • archiving the month's records moves no ROB (S13)
   • Save Parameters after a correction keeps it (S14); an Update ROB saved by the previous build
     keeps the supplies before it out of later corrections (S15); a re-tag to a name no barge has
     keeps the supply on its barge (S16); two devices correcting different supplies: both count (S17);
     a tab on the previous build edits first: no double correction (S18, with PREV_APP_DIR)
   node suites/fix2/supplyedit.test.js [appDir] */
const path = require('path');
if (process.argv[2]) process.env.APP_DIR = path.resolve(process.argv[2]); // r3/util.js's U.open reads APP_DIR
const H = require(path.join(__dirname, '..', '..', 'harness', 'harness.js'));
const U = require(path.join(__dirname, '..', 'r3', 'util.js'));

let pass = 0, fail = 0;
function check(name, cond, info) {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 700)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const eta = h => { const d = new Date(Date.now() + h * 3600000); const p = n => String(n).padStart(2, '0'); return `${p(d.getDate())} ${MO[d.getMonth()]} ${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const VBASE = { imo: '', area: 'FUJ-A', spec: 'ISO 8217:2010', agent: 'AG', manifold: 'VESSEL MANIFOLD', remarks: '', lc: '', paq: 'no', bargeId: '1', refuelChk: false, rfv: 0, rfm: 0, rfvr: 750, rfmr: 275 };
const BARGE = { vcap: 5000, mcap: 1000, vbuf: 500, mbuf: 150, vtph: 300, mtph: 100, vrfr: 750, mrfr: 275 };

async function open(browser, db, uid) {
  const a = await U.open(browser, db, uid);
  await a.page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
  return a;
}
// Live ROB [VLSFO, MGO] of barge `id` as the dashboard shows it.
const live = (p, id) => p.evaluate(id => { try { renderLiveROBDashboard(); } catch (e) {} const l = getAllLiveROBs()[id || 1]; return l ? [Math.round(l.liveV), Math.round(l.liveM)] : null; }, id);
const cloudBarge = (db, id) => { const b = U.row(db).payload.state.barges.find(x => String(x.id) === String(id || 1)); return b ? [b.vrob, b.mrob] : null; };
// A fresh device's live ROB after it loads the cloud row.
async function fresh(openT, db, ids) { const F = await openT(db, 'user-operator'); await sleep(600); const out = []; for (const id of ids || [1]) out.push(await live(F.page, id)); return out.length === 1 ? out[0] : out; }
const generate = p => p.evaluate(async () => { calculate(); await _waitForSaveIdle(); });
const logSupply = (p, nom, v, m) => p.evaluate(async ([nom, v, m]) => {
  const uid = 'n_' + nom;
  if (!_checklistRecords[uid]) return 'no checklist row';
  showPage('checklist'); renderChecklist(_lastSched);
  document.getElementById('cl-av-' + uid).value = String(v);
  document.getElementById('cl-am-' + uid).value = String(m);
  await saveChecklistRecord(uid);
  await _waitForSaveIdle();
  return 'ok';
}, [nom, v, m]);
// Saved Records > Edit, the way a user does it.
const editRecord = (p, id, fields) => p.evaluate(async ([id, fields]) => {
  showPage('records'); openEditRecord(id);
  Object.keys(fields).forEach(k => { const el = document.getElementById(k); el.value = fields[k]; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await saveEditRecord(); await _waitForSaveIdle();
}, [id, fields]);
const recId = (p, vessel) => p.evaluate(v => (_savedSupplies.find(r => r.vessel === v) || {}).id, vessel);
const pull = p => p.evaluate(async () => { await _pollOnce(true); await _waitForSaveIdle(); });

// Barge 1 4000 / 800 (and Barge 2 3000 / 500), nominations ALPHA 1000 VLSFO, BRAVO 500 VLSFO on Barge 1.
function seed(o) {
  o = o || {};
  const s = U.seedPayload({ vessels: [
    Object.assign({}, VBASE, { nomUid: 'n1', name: 'ALPHA', type: 'VLSFO', qty: 1000, mgo: 0, eta: eta(3) }),
    Object.assign({}, VBASE, { nomUid: 'n2', name: 'BRAVO', type: 'VLSFO', qty: 500, mgo: 0, eta: eta(12) }),
  ] });
  s.state.barges = [Object.assign({ id: 1, name: 'Barge 1', vrob: 4000, mrob: 800 }, BARGE)];
  if (o.two) s.state.barges.push(Object.assign({ id: 2, name: 'Barge 2', vrob: 3000, mrob: 500 }, BARGE));
  s.state.bakedSupplyIds = {};
  return s;
}
// A saved supply record as saveChecklistRecord builds it.
function rec(o) {
  return Object.assign({ id: o.id, checklistUid: o.uid || o.id, nomUid: null, savedAt: o.savedAt || '2026-10-01T00:00:00.000Z', vessel: o.vessel || 'ALPHA', area: 'FUJ A', areaCode: 'FUJ-A',
    dateStr: '01 Oct 2026 10:00', supplyDate: '2026-10-01T06:00:00.000Z', vlsfoNom: o.v, mgoNom: 0, vlsfoAct: o.v, mgoAct: o.m || 0, bdnV: '', bdnM: '', barge: o.barge || 'Barge 1', notes: '', supplied: true });
}

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

  /* S1 — edit the actual of a baked supply */
  await scenario('S1 edit 1000 → 800 (and → 1200)', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db, 'user-operator');
    const B = await openT(db, 'user-operator2');
    await generate(A.page);
    const ok = await logSupply(A.page, 'n1', 1000, 0);
    const id = await recId(A.page, 'ALPHA');
    const baked = await A.page.evaluate(id => (_bakedSupplyIds[1] || []).includes(id), id);
    check('S1 precondition: ALPHA 1000 logged, baked into the opening, ROB 3000', ok === 'ok' && baked && same(await live(A.page), [3000, 800]) && same(cloudBarge(db), [3000, 800]), { ok, baked, live: await live(A.page), cloud: cloudBarge(db) });
    await pull(B.page);
    check('S1 colleague sees 3000 before the edit', same(await live(B.page), [3000, 800]), await live(B.page));

    await editRecord(A.page, id, { 'er-vlsfo-act': '800' });
    const r = { rec: await A.page.evaluate(id => _savedSupplies.find(x => x.id === id).vlsfoAct, id), A: await live(A.page), cloud: cloudBarge(db) };
    check('S1 edit 1000 → 800: ROB +200 on this device and in the cloud (3200)', r.rec === 800 && same(r.A, [3200, 800]) && same(r.cloud, [3200, 800]), r);
    await pull(B.page);
    check('S1 …on the colleague\'s device after sync (3200)', same(await live(B.page), [3200, 800]), await live(B.page));
    check('S1 …and on a fresh device (3200)', same(await fresh(openT, db), [3200, 800]));

    const ev = (U.row(db).payload.state.bargeReloads || []).filter(x => x.kind === 'correction'), took = (U.row(db).payload.records.find(x => x.id === id).robTook || {})['1'];
    check('S1 one correction event rc_1_<record>_1 (+200 VLSFO, Barge 1), baked like a reload; the record took 800 now (step 1)', ev.length === 1 && ev[0].id === 'rc_1_' + id + '_1' && ev[0].v === 200 && ev[0].m === 0 &&
      String(ev[0].bargeId) === '1' && ev[0].recId === id && U.row(db).payload.state.bakedSupplyIds['1'].includes(ev[0].id) && !U.row(db).payload.state.manualROB['1_final'] &&
      Array.isArray(took) && took[0] === 800 && took[1] === 0 && took[3] === 'Barge 1' && took[4] === 800 && took[6] === 1, { ev, took });
    const audit = U.row(db).payload.state.robAuditLog.filter(e => /CORRECTION/.test(e.field));
    check('S1 the ROB audit log says correction 3000 → 3200 (not RELOAD)', audit.length === 1 && audit[0].field === 'VLSFO CORRECTION' && audit[0].oldVal === 3000 && audit[0].newVal === 3200 && /ALPHA supply edited/.test(audit[0].reason), audit);

    // A correction is labelled as one wherever ROB history is shown, and never counts as a supply or reload.
    const lbl = await A.page.evaluate(id => {
      const keep = _bakedSupplyIds[1];
      _bakedSupplyIds[1] = keep.filter(x => !/^rc_/.test(x));   // as on a device that has not baked it yet
      const all = getAllLiveROBs()[1];
      renderLiveROBDashboard();
      const txt = document.getElementById('rob-history-1') ? document.getElementById('rob-history-1').textContent : '';
      _bakedSupplyIds[1] = keep; renderLiveROBDashboard();
      const h = all.history.filter(x => x.source !== 'opening');
      return { h: h.map(x => [x.label, x.source]), supplied: all.totalSuppliedV, count: all.completedCount, live: Math.round(all.liveV), txt };
    }, id);
    check('S1 Live ROB history: "Correction (+200 VLSFO / +0 MGO) — ALPHA supply edited …", source Correction, not Reload / Supply',
      lbl.h.length === 1 && /^Correction \(\+200 VLSFO \/ \+0 MGO\) — ALPHA supply edited: VLSFO 1,000 → 800 MT$/.test(lbl.h[0][0]) && lbl.h[0][1] === 'correction' &&
      lbl.supplied === 0 && lbl.count === 0 && /Correction/.test(lbl.txt) && !/Reload/.test(lbl.txt), lbl);

    await editRecord(A.page, id, { 'er-vlsfo-act': '1200' });
    check('S1 edit 800 → 1200 (a larger actual): ROB −400 → 2800 here and on a fresh device', same(await live(A.page), [2800, 800]) && same(await fresh(openT, db), [2800, 800]), [await live(A.page), cloudBarge(db)]);
    await editRecord(A.page, id, { 'er-notes': 'BDN checked', 'er-supplied': 'no' });
    check('S1 editing only notes / status leaves ROB alone (2800)', same(await live(A.page), [2800, 800]) && same(await fresh(openT, db), [2800, 800]), [await live(A.page), cloudBarge(db)]);
    // The next bake (a new supply) folds the correction into the opening — once.
    await logSupply(A.page, 'n2', 500, 0);
    const f = (U.row(db).payload.records.find(x => x.id === id).robTook || {})['1'], fin2 = U.row(db).payload.state.manualROB['1_final'];
    check('S1 BRAVO 500 logged: the bake folds the correction in — opening 2300 in the cloud, live 2300 everywhere, ALPHA took 1200', same(await live(A.page), [2300, 800]) && same(cloudBarge(db), [2300, 800]) && same(await fresh(openT, db), [2300, 800]) && f[0] === 1200 && !fin2, [await live(A.page), cloudBarge(db), f, fin2]);
  });

  /* S2 — a negative correction stops at 0 like a supply */
  await scenario('S2 clamp at 0', async (openT) => {
    const s = seed();
    s.state.barges[0].vrob = 100;              // 1100 on board, 1000 delivered and baked
    s.state.bakedSupplyIds = { 1: ['r1'] };
    s.records = [rec({ id: 'r1', v: 1000 })];
    const db = H.createDb({ workspace: s, realtime: false });
    const A = await openT(db, 'user-operator');
    check('S2 precondition: ROB 100', same(await live(A.page), [100, 800]), await live(A.page));
    await editRecord(A.page, 'r1', { 'er-vlsfo-act': '1500' });
    check('S2 edit 1000 → 1500 on a barge with 100 left: ROB 0, never negative (here and on a fresh device)', same(await live(A.page), [0, 800]) && same(await fresh(openT, db), [0, 800]), [await live(A.page), cloudBarge(db)]);
  });

  /* S3 — move the supply to another barge, then back */
  await scenario('S3 move Barge 1 → Barge 2 → Barge 1', async (openT) => {
    const s = seed({ two: true });
    s.state.barges[0].vrob = 3000;             // 4000 − 1000 baked
    s.state.bakedSupplyIds = { 1: ['r1'] };
    s.records = [rec({ id: 'r1', v: 1000, m: 100, barge: 'Barge 1' })];
    s.state.barges[0].mrob = 700;
    const db = H.createDb({ workspace: s, realtime: false });
    const A = await openT(db, 'user-operator');
    check('S3 precondition: Barge 1 3000 / 700, Barge 2 3000 / 500', same([await live(A.page, 1), await live(A.page, 2)], [[3000, 700], [3000, 500]]), [await live(A.page, 1), await live(A.page, 2)]);
    await editRecord(A.page, 'r1', { 'er-barge': 'Barge 2' });
    const r = { b1: await live(A.page, 1), b2: await live(A.page, 2), c2: cloudBarge(db, 2) };
    check('S3 moved to Barge 2: Barge 1 back to 4000 / 800, Barge 2 down to 2000 / 400 (Barge 2 bakes it: cloud 2000 / 400)', same([r.b1, r.b2, r.c2], [[4000, 800], [2000, 400], [2000, 400]]), r);
    check('S3 …and on a fresh device', same(await fresh(openT, db, [1, 2]), [[4000, 800], [2000, 400]]));
    await editRecord(A.page, 'r1', { 'er-barge': 'Barge 1', 'er-vlsfo-act': '900' });
    const r2 = { b1: await live(A.page, 1), b2: await live(A.page, 2) };
    check('S3 moved back to Barge 1 as 900: Barge 1 3100 / 700, Barge 2 3000 / 500 again (here and on a fresh device)', same([r2.b1, r2.b2], [[3100, 700], [3000, 500]]) && same(await fresh(openT, db, [1, 2]), [[3100, 700], [3000, 500]]), r2);
  });

  /* S4 — delete, then re-save from the re-opened checklist row */
  await scenario('S4 delete and re-save', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db, 'user-operator');
    await generate(A.page);
    await logSupply(A.page, 'n1', 1000, 0);
    check('S4 precondition: ROB 3000', same(await live(A.page), [3000, 800]), await live(A.page));
    const id = await recId(A.page, 'ALPHA');
    await A.page.evaluate(async id => { await deleteRecord(id); await _waitForSaveIdle(); }, id);
    check('S4 delete: ROB restored to 4000 (here and on a fresh device)', same(await live(A.page), [4000, 800]) && same(await fresh(openT, db), [4000, 800]), [await live(A.page), cloudBarge(db)]);
    const ok = await logSupply(A.page, 'n1', 950, 0);
    check('S4 re-save the re-opened row at 950: deducted once → 3050 (here, cloud, fresh device)', ok === 'ok' && same(await live(A.page), [3050, 800]) && same(cloudBarge(db), [3050, 800]) && same(await fresh(openT, db), [3050, 800]), [ok, await live(A.page), cloudBarge(db)]);
  });

  /* S5 — Remove Duplicates, and deleting a completed checklist row */
  await scenario('S5 remove duplicates / delete completed row', async (openT) => {
    const s = seed();
    s.state.barges[0].vrob = 2000;             // the same delivery saved twice, both baked
    s.state.bakedSupplyIds = { 1: ['u1_1', 'u1_2'] };
    s.records = [rec({ id: 'u1_1', uid: 'u1', v: 1000, savedAt: '2026-10-01T00:00:00.000Z' }), rec({ id: 'u1_2', uid: 'u1', v: 1000, savedAt: '2026-10-01T01:00:00.000Z' })];
    const db = H.createDb({ workspace: s, realtime: false });
    const A = await openT(db, 'user-operator');
    check('S5 precondition: the delivery deducted twice, ROB 2000', same(await live(A.page), [2000, 800]), await live(A.page));
    await A.page.evaluate(async () => { await removeDuplicateSavedRecords(); await _waitForSaveIdle(); });
    const r = { n: U.row(db).payload.records.length, A: await live(A.page), F: await fresh(openT, db) };
    check('S5 Remove Duplicates keeps one copy and gives the other back: 3000', r.n === 1 && same(r.A, [3000, 800]) && same(r.F, [3000, 800]), r);

    const db2 = H.createDb({ workspace: seed(), realtime: false });
    const B = await openT(db2, 'user-operator');
    await generate(B.page);
    await logSupply(B.page, 'n1', 1000, 0);
    await B.page.evaluate(async () => { deleteChecklistRecord('n_n1'); await _waitForSaveIdle(); });
    const r2 = { n: U.row(db2).payload.records.length, B: await live(B.page), F: await fresh(openT, db2) };
    check('S5 deleting a completed checklist row removes its supply from ROB too: 4000', r2.n === 0 && same(r2.B, [4000, 800]) && same(r2.F, [4000, 800]), r2);
  });

  /* S6 — an unbaked record: computeLiveROB re-reads it, nothing extra */
  await scenario('S6 unbaked record', async (openT) => {
    const s = seed();
    s.records = [rec({ id: 'r1', v: 1000 })]; // not in bakedSupplyIds: still deducted live
    const db = H.createDb({ workspace: s, realtime: false });
    const A = await openT(db, 'user-operator');
    const pre = { live: await live(A.page), baked: await A.page.evaluate(() => (_bakedSupplyIds[1] || []).includes('r1')) };
    check('S6 precondition: not baked, ROB 3000', !pre.baked && same(pre.live, [3000, 800]), pre);
    await editRecord(A.page, 'r1', { 'er-vlsfo-act': '800' });
    const r = { A: await live(A.page), cloud: cloudBarge(db), corr: await A.page.evaluate(() => Object.keys(_manualROB).filter(k => /_final$/.test(k)).length) };
    check('S6 edit 1000 → 800: ROB 3200 exactly once (no correction), cloud 3200, fresh device 3200', same(r.A, [3200, 800]) && same(r.cloud, [3200, 800]) && r.corr === 0 && same(await fresh(openT, db), [3200, 800]), r);
  });

  /* S7 — two operators: A edits the baked ALPHA record while B (not pulled) logs BRAVO */
  for (const order of ['B logs first', 'A edits first']) {
    await scenario('S7 two devices, ' + order, async (openT) => {
      const db = H.createDb({ workspace: seed(), realtime: false });
      const A = await openT(db, 'user-operator');
      const B = await openT(db, 'user-operator2');
      await generate(A.page);
      await logSupply(A.page, 'n1', 1000, 0);
      await pull(B.page);
      check('S7 precondition: both at 3000', same(await live(A.page), [3000, 800]) && same(await live(B.page), [3000, 800]), [await live(A.page), await live(B.page)]);
      const id = await recId(A.page, 'ALPHA');
      const countMerges = p => p.evaluate(() => { window.__merges = 0; const o = _mergePayloads; _mergePayloads = function() { window.__merges++; return o.apply(this, arguments); }; });
      await countMerges(A.page); await countMerges(B.page);
      if (order === 'B logs first') { await logSupply(B.page, 'n2', 500, 0); await editRecord(A.page, id, { 'er-vlsfo-act': '800' }); }
      else { await editRecord(A.page, id, { 'er-vlsfo-act': '800' }); await logSupply(B.page, 'n2', 500, 0); }
      await sleep(500);
      const second = order === 'B logs first' ? A : B;
      check('S7 the second writer met the first one\'s save (three-way merge ran)', await second.page.evaluate(() => window.__merges) >= 1);
      await pull(A.page); await pull(B.page);
      const r = { A: await live(A.page), B: await live(B.page), cloud: cloudBarge(db), recs: U.row(db).payload.records.map(x => [x.vessel, x.vlsfoAct]).sort() };
      const F = await fresh(openT, db);
      check('S7 both effects: 4000 − 800 − 500 = 2700 on both devices and a fresh one', same(r.A, [2700, 800]) && same(r.B, [2700, 800]) && same(F, [2700, 800]) && same(r.recs, [['ALPHA', 800], ['BRAVO', 500]]), Object.assign(r, { F }));
      await A.page.evaluate(async () => { await saveSharedState(); await _waitForSaveIdle(); });
      await pull(B.page);
      check('S7 …and stays 2700 after more saves', same(await live(A.page), [2700, 800]) && same(await live(B.page), [2700, 800]) && same(await fresh(openT, db), [2700, 800]), [cloudBarge(db), await live(A.page)]);
    });
  }

  /* S8 — a typo'd actual, larger than what the barge held, fixed afterwards */
  for (const how of ['edit', 'delete']) {
    await scenario('S8 typo 10000 for 1000, then ' + how, async (openT) => {
      const db = H.createDb({ workspace: seed(), realtime: false });
      const A = await openT(db, 'user-operator');
      await generate(A.page);
      await logSupply(A.page, 'n1', 10000, 0);
      check('S8 precondition: the typo empties the barge (ROB 0, cloud 0)', same(await live(A.page), [0, 800]) && same(cloudBarge(db), [0, 800]), [await live(A.page), cloudBarge(db)]);
      const id = await recId(A.page, 'ALPHA');
      if (how === 'edit') {
        await editRecord(A.page, id, { 'er-vlsfo-act': '1000' });
        check('S8 fixed to 1000: 4000 − 1000 = 3000 here and on a fresh device (not 9000)', same(await live(A.page), [3000, 800]) && same(await fresh(openT, db), [3000, 800]), [await live(A.page), cloudBarge(db)]);
        await editRecord(A.page, id, { 'er-vlsfo-act': '1200' });
        check('S8 …then 1000 → 1200: 2800', same(await live(A.page), [2800, 800]) && same(await fresh(openT, db), [2800, 800]), [await live(A.page), cloudBarge(db)]);
      } else {
        await A.page.evaluate(async id => { await deleteRecord(id); await _waitForSaveIdle(); }, id);
        check('S8 deleted: back to the 4000 on board (not 10000)', same(await live(A.page), [4000, 800]) && same(await fresh(openT, db), [4000, 800]), [await live(A.page), cloudBarge(db)]);
      }
    });
  }

  /* S9 — the same baked record changed on two devices before they sync */
  for (const pairing of [['delete', 'delete'], ['edit800', 'delete'], ['edit800', 'edit900'], ['delete', 'edit800']]) {
    await scenario('S9 two devices: ' + pairing.join(' / '), async (openT) => {
      const s = seed();
      s.state.barges[0].vrob = 3000;
      s.state.bakedSupplyIds = { 1: ['r1'] };
      s.records = [rec({ id: 'r1', v: 1000 })];
      const db = H.createDb({ workspace: s, realtime: false });
      const A = await openT(db, 'user-operator');
      const B = await openT(db, 'user-operator2');
      const act = async (p, a) => {
        if (a === 'delete') await p.evaluate(async () => { await deleteRecord('r1'); await _waitForSaveIdle(); });
        else await editRecord(p, 'r1', { 'er-vlsfo-act': a.slice(4) });
      };
      await act(A.page, pairing[0]);
      await act(B.page, pairing[1]);
      await pull(A.page); await pull(B.page);
      const recs = U.row(db).payload.records.filter(x => x.id === 'r1').map(x => x.vlsfoAct);
      const want = 4000 - (recs.length ? recs[0] : 0);
      const r = { A: await live(A.page), B: await live(B.page), recs, want };
      check('S9 one outcome everywhere: 4000 − what the surviving record says (' + want + '), corrected once', recs.length <= 1 && same(r.A, [want, 800]) && same(r.B, [want, 800]) && same(await fresh(openT, db), [want, 800]), r);
    });
  }

  /* S10 — Update ROB (a measured figure) after the supply, then the BDN corrects the supply */
  await scenario('S10 measured ROB, then a corrected supply', async (openT) => {
    const s = seed();
    s.state.barges[0].vrob = 3000;
    s.state.bakedSupplyIds = { 1: ['r1'] };
    s.records = [rec({ id: 'r1', v: 1000 })];
    const db = H.createDb({ workspace: s, realtime: false });
    const A = await openT(db, 'user-operator');
    await A.page.evaluate(async () => {
      renderLiveROBDashboard();
      const put = (id, v) => { let el = document.getElementById(id); if (!el) { el = document.createElement('input'); el.id = id; el.type = 'hidden'; document.body.appendChild(el); } el.value = v; };
      put('rob-sum-v-1', '2900'); put('rob-sum-m-1', '800'); put('rob-sum-reason-1', 'Dip');
      await saveROBSumEdit(1); await _waitForSaveIdle();
    });
    check('S10 precondition: Update ROB 2900', same(await live(A.page), [2900, 800]), await live(A.page));
    await editRecord(A.page, 'r1', { 'er-vlsfo-act': '800' });
    check('S10 the supply fixed 1000 → 800 afterwards: the measured 2900 stands (here and on a fresh device)', same(await live(A.page), [2900, 800]) && same(await fresh(openT, db), [2900, 800]), [await live(A.page), cloudBarge(db)]);
    await A.page.evaluate(async () => { await deleteRecord('r1'); await _waitForSaveIdle(); });
    check('S10 …and deleting it later moves nothing either', same(await live(A.page), [2900, 800]) && same(await fresh(openT, db), [2900, 800]), [await live(A.page), cloudBarge(db)]);
  });

  /* S11 — a renamed barge; an unassigned record tagged with its barge */
  await scenario('S11 rename / tag', async (openT) => {
    const s = seed({ two: true });
    s.state.barges[0].vrob = 2500;             // r1 (1000, 'Old Name') and r2 (500, blank, baked while Barge 1 was alone)
    s.state.barges[0].name = 'Sea Star II';
    s.state.bakedSupplyIds = { 1: ['r1', 'r2'] };
    s.records = [rec({ id: 'r1', v: 1000, barge: 'Sea Star' }), rec({ id: 'r2', v: 500, barge: '', vessel: 'BRAVO' })];
    const db = H.createDb({ workspace: s, realtime: false });
    const A = await openT(db, 'user-operator');
    check('S11 precondition: 2500 / 3000', same([await live(A.page, 1), await live(A.page, 2)], [[2500, 800], [3000, 500]]), [await live(A.page, 1), await live(A.page, 2)]);
    await editRecord(A.page, 'r1', { 'er-barge': 'Sea Star II' });
    await editRecord(A.page, 'r2', { 'er-barge': 'Sea Star II' });
    check('S11 the old record re-tagged with the renamed barge, the unassigned one tagged: nothing moves (2500 / 3000)', same([await live(A.page, 1), await live(A.page, 2)], [[2500, 800], [3000, 500]]) && same(await fresh(openT, db, [1, 2]), [[2500, 800], [3000, 500]]), [await live(A.page, 1), await live(A.page, 2), cloudBarge(db, 1)]);
    await editRecord(A.page, 'r1', { 'er-vlsfo-act': '900' });
    check('S11 …then 1000 → 900 on it: +100 → 2600', same(await live(A.page, 1), [2600, 800]) && same((await fresh(openT, db, [1, 2]))[0], [2600, 800]), [await live(A.page, 1), cloudBarge(db, 1)]);
  });

  /* S12 — remove a barge, add it back under its name */
  await scenario('S12 remove and re-add a barge', async (openT) => {
    const s = seed({ two: true });
    s.state.barges[1].vrob = 1500;             // Barge 2: 3000 − 1500 baked
    s.state.bakedSupplyIds = { 2: ['r1'] };
    s.records = [rec({ id: 'r1', v: 1500, barge: 'Barge 2' })];
    const db = H.createDb({ workspace: s, realtime: false });
    const A = await openT(db, 'user-operator');
    await A.page.evaluate(async () => { rmBarge(2); await _waitForSaveIdle(); });
    const B = await openT(db, 'user-operator');
    const r = await B.page.evaluate(async () => {
      addBarge({ vrob: 3200, mrob: 400 }); await new Promise(r => setTimeout(r, 300));
      const nb = _barges[_barges.length - 1];
      const nm = document.getElementById('b' + nb.id + '-name');
      return { id: nb.id, name: nm && nm.value };
    });
    await B.page.evaluate(async () => { await saveSharedState(); await _waitForSaveIdle(); });
    check('S12 added back as Barge 2: its fresh 3200 is not cut by the old 1500 supply (here, cloud, fresh device)', String(r.id) === '2' && r.name === 'Barge 2' && same(await live(B.page, 2), [3200, 400]) && same(cloudBarge(db, 2), [3200, 400]) && same(await fresh(openT, db, [2]), [3200, 400]), Object.assign(r, { live: await live(B.page, 2), cloud: cloudBarge(db, 2) }));
    await editRecord(B.page, 'r1', { 'er-vlsfo-act': '1000' });
    check('S12 …and correcting that old supply later moves nothing on it', same(await live(B.page, 2), [3200, 400]), await live(B.page, 2));
  });

  /* S13 — archiving a month moves records out of Saved Records: not a fuel event */
  await scenario('S13 archive', async (openT) => {
    const s = seed();
    s.state.barges[0].vrob = 3000;
    s.state.bakedSupplyIds = { 1: ['r1'] };
    s.records = [rec({ id: 'r1', v: 1000 })];
    const db = H.createDb({ workspace: s, realtime: false });
    const A = await openT(db, 'user-operator');
    await editRecord(A.page, 'r1', { 'er-vlsfo-act': '900' });
    check('S13 precondition: corrected to 900 → 3100', same(await live(A.page), [3100, 800]), await live(A.page));
    await A.page.evaluate(async () => { archiveMonth(9, 2026); await _waitForSaveIdle(); });
    const r = { n: U.row(db).payload.records.length, A: await live(A.page) };
    check('S13 the month archived (record out of Saved Records): ROB stays 3100 (here and on a fresh device)', r.n === 0 && same(r.A, [3100, 800]) && same(await fresh(openT, db), [3100, 800]), r);
  });

  /* S14 — Save Parameters after a correction (changing only the other grade) keeps the correction */
  await scenario('S14 correction, then Save Parameters', async (openT) => {
    const s = seed();
    s.state.barges[0].vrob = 3000; s.state.barges[0].mrob = 700;
    s.state.bakedSupplyIds = { 1: ['r1'] };
    s.records = [rec({ id: 'r1', v: 1000, m: 100 })];
    const db = H.createDb({ workspace: s, realtime: false });
    const A = await openT(db, 'user-operator');
    await generate(A.page); // the ROB engine loaded, so the save bakes (writes the opening field)
    await editRecord(A.page, 'r1', { 'er-vlsfo-act': '1200' });
    check('S14 precondition: 1000 → 1200 → 2800 / 700, the opening field shows it', same(await live(A.page), [2800, 700]) && (await A.page.evaluate(() => document.getElementById('b1-vrob').value)) === '2800', [await live(A.page)]);
    await A.page.evaluate(async () => { toggleBargeEdit(1); document.getElementById('b1-mrob').value = '650'; saveBargeEdit(1); await _waitForSaveIdle(); });
    check('S14 only MGO changed in Save Parameters: 2800 / 650 (here and on a fresh device)', same(await live(A.page), [2800, 650]) && same(await fresh(openT, db), [2800, 650]), [await live(A.page), cloudBarge(db)]);
  });

  /* S15 — an Update ROB figure saved by the live build (no '_measured' marker) */
  await scenario('S15 Update ROB from the live build', async (openT) => {
    const s = seed();
    s.state.barges[0].vrob = 3000;
    s.state.bakedSupplyIds = { 1: ['r1'] };
    s.records = [rec({ id: 'r1', v: 1000 })];
    s.state.manualROB = { '1_final': { v: 2900, m: 800, reason: 'Dip', editedAt: new Date().toISOString(), editedBy: 'ROB Update', atIds: [] } };
    const db = H.createDb({ workspace: s, realtime: false });
    const A = await openT(db, 'user-operator');
    await generate(A.page);
    await editRecord(A.page, 'r1', { 'er-vlsfo-act': '800' });
    check('S15 r1 1000 → 800 under the measured 2900: stays 2900', same(await live(A.page), [2900, 800]), await live(A.page));
    await logSupply(A.page, 'n2', 500, 0);
    check('S15 BRAVO 500 logged (the figure is baked in): 2400', same(await live(A.page), [2400, 800]) && same(cloudBarge(db), [2400, 800]), [await live(A.page), cloudBarge(db)]);
    await editRecord(A.page, 'r1', { 'er-vlsfo-act': '700' });
    check('S15 r1 edited again after that bake: still 2400 (it was in the measured figure)', same(await live(A.page), [2400, 800]) && same(await fresh(openT, db), [2400, 800]), [await live(A.page), cloudBarge(db)]);
    const id2 = await recId(A.page, 'BRAVO');
    await editRecord(A.page, id2, { 'er-vlsfo-act': '400' });
    check('S15 …while BRAVO, logged after the figure, corrects normally: 2500', same(await live(A.page), [2500, 800]) && same(await fresh(openT, db), [2500, 800]), [await live(A.page), cloudBarge(db)]);
  });

  /* S16 — re-tag a baked supply with a name no barge has yet, then rename the barge to it */
  await scenario('S16 re-tag, then rename the barge', async (openT) => {
    const s = seed({ two: true });
    s.state.barges[0].vrob = 3000;
    s.state.bakedSupplyIds = { 1: ['r1'] };
    s.records = [rec({ id: 'r1', v: 1000 })];
    const db = H.createDb({ workspace: s, realtime: false });
    const A = await openT(db, 'user-operator');
    await editRecord(A.page, 'r1', { 'er-barge': 'Sea Star' });
    check('S16 re-tagged "Sea Star" (no such barge yet): it stays with Barge 1 — 3000', same(await live(A.page, 1), [3000, 800]), await live(A.page, 1));
    await A.page.evaluate(async () => { toggleBargeEdit(1); document.getElementById('b1-name').value = 'Sea Star'; saveBargeEdit(1); await _waitForSaveIdle(); });
    check('S16 Barge 1 renamed "Sea Star": still 3000, Barge 2 untouched (here and on a fresh device)', same(await live(A.page, 1), [3000, 800]) && same(await live(A.page, 2), [3000, 500]) && same(await fresh(openT, db, [1, 2]), [[3000, 800], [3000, 500]]), [await live(A.page, 1), await live(A.page, 2)]);
  });

  /* S17 — two devices correct DIFFERENT supplies of the same barge before they sync */
  await scenario('S17 two devices, two records', async (openT) => {
    const s = seed();
    s.state.barges[0].vrob = 2500;
    s.state.bakedSupplyIds = { 1: ['r1', 'r2'] };
    s.records = [rec({ id: 'r1', v: 1000 }), rec({ id: 'r2', v: 500, vessel: 'BRAVO' })];
    const db = H.createDb({ workspace: s, realtime: false });
    const A = await openT(db, 'user-operator');
    const B = await openT(db, 'user-operator2');
    await editRecord(A.page, 'r1', { 'er-vlsfo-act': '1200' });
    await editRecord(B.page, 'r2', { 'er-vlsfo-act': '400' });
    await pull(A.page); await pull(B.page);
    const r = { A: await live(A.page), B: await live(B.page), F: await fresh(openT, db) };
    check('S17 both corrections count: 4000 − 1200 − 400 = 2400 everywhere', same(r.A, [2400, 800]) && same(r.B, [2400, 800]) && same(r.F, [2400, 800]), r);
  });

  /* S18 — a tab still on the previous build edits a supply, then this build edits it again */
  const PREV = process.env.PREV_APP_DIR;
  if (PREV) await scenario('S18 previous build, then this one', async (openT) => {
    const s = seed();
    s.state.barges[0].vrob = 3000;
    s.state.bakedSupplyIds = { 1: ['r1'] };
    s.records = [rec({ id: 'r1', v: 1000 })];
    s.records[0].robTook = { 1: [1000, 0, 1, 'Barge 1', 1000, 0, 0] };
    const db = H.createDb({ workspace: s, realtime: false });
    const O = await H.openApp(browser, db, { appDir: PREV, uid: 'user-operator2' });
    await O.page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
    await editRecord(O.page, 'r1', { 'er-vlsfo-act': '800' });
    const A = await openT(db, 'user-operator');
    check('S18 the previous build corrected 1000 → 800: 3200 here', same(await live(A.page), [3200, 800]), await live(A.page));
    await editRecord(A.page, 'r1', { 'er-vlsfo-act': '700' });
    check('S18 this build then 800 → 700: 3300, not 3500 (here and on a fresh device)', same(await live(A.page), [3300, 800]) && same(await fresh(openT, db), [3300, 800]), [await live(A.page), cloudBarge(db)]);
    await O.ctx.close();
  });

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
