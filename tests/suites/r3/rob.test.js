/* ROB correctness: overrides survive save/reload/pull, baking writes back,
   reloads are dated events, stable barge ids, reconciled totals, scheduler. */
const U = require('./util.js');
const { check } = U;
const live = (app, id) => app.page.evaluate((id) => { _bargeConfig = getBarges(); const r = getAllLiveROBs()[id]; return r ? { v: Math.round(r.liveV), m: Math.round(r.liveM), supV: r.totalSuppliedV, n: r.completedCount } : null; }, id);

(async () => {
  const browser = await U.H.launch();
  try {
    console.log('R1 manual override survives save, reload and pull');
    const db = U.H.createDb({ workspace: U.seedPayload() });
    const A = await U.open(browser, db, 'user-operator');
    const B = await U.open(browser, db, 'user-operator2');
    await U.helpers(A); await U.helpers(B);
    const w0 = U.writes(db, 'user-operator').length;
    await A.page.evaluate(async () => {
      _bargeConfig = getBarges(); renderLiveROBDashboard();
      document.getElementById('rob-sum-v-1').value = 3000; document.getElementById('rob-sum-m-1').value = 700;
      await saveROBSumEdit('1');
    });
    check(U.writes(db, 'user-operator').length - w0 === 1, 'saveROBSumEdit wrote the state once (' + (U.writes(db, 'user-operator').length - w0) + ')');
    let r = await live(A, 1);
    check(r.v === 3000 && r.m === 700, 'override applied in session (' + JSON.stringify(r) + ')');
    check(U.row(db).payload.state.manualROB['1_final'] && U.row(db).payload.state.manualROB['1_final'].v === 3000, 'override persisted in cloud');
    await A.page.evaluate(() => saveSharedState()); // another unrelated save
    check(!!U.row(db).payload.state.manualROB['1_final'], 'override survives a further save');
    await A.page.reload({ waitUntil: 'load' }); await A.page.waitForTimeout(2500); await U.helpers(A);
    r = await live(A, 1);
    check(r.v === 3000 && r.m === 700, 'override survives reload (' + JSON.stringify(r) + ')');
    await B.page.evaluate(() => _pollOnce(true));
    r = await live(B, 1);
    check(r.v === 3000 && r.m === 700, 'override visible on another device after pull (' + JSON.stringify(r) + ')');

    console.log('R2 later supply still deducts after an override; bake writes back');
    await A.page.evaluate(async () => {
      _savedSupplies.push({ id: 'rec_r2', vessel: 'ALPHA', barge: 'Barge 1', vlsfoAct: 200, mgoAct: 50, supplyDate: new Date().toISOString(), supplied: true });
    });
    r = await live(A, 1);
    check(r.v === 2800 && r.m === 650, 'supply after override deducts (' + JSON.stringify(r) + ')');
    await A.page.evaluate(() => saveSharedRecords());
    const ui = await A.page.evaluate(() => ({ vrob: document.getElementById('b1-vrob').value, cfg: _bargeConfig.find(b => b.id == 1).vrob, man: Object.keys(_manualROB) }));
    check(ui.vrob === '2800' && ui.cfg === 2800, 'baked opening written back to input + _bargeConfig (' + JSON.stringify(ui) + ')');
    check(ui.man.length === 0, 'override keys stripped only because this barge was baked');
    r = await live(A, 1);
    check(r.v === 2800 && r.m === 650, 'live unchanged by bake (' + JSON.stringify(r) + ')');
    const cloudB = U.row(db).payload.state.barges[0];
    check(cloudB.vrob === 2800 && cloudB.mrob === 650, 'cloud opening = baked value');
    await A.page.evaluate(() => saveSharedState());
    check(U.row(db).payload.state.barges[0].vrob === 2800, 'next capture does not push the old opening back');
    await A.page.reload({ waitUntil: 'load' }); await A.page.waitForTimeout(2500); await U.helpers(A);
    r = await live(A, 1);
    check(r.v === 2800 && r.m === 650 && r.n === 0, 'after reload: 2800/650, baked supply not double-deducted (' + JSON.stringify(r) + ')');

    console.log('R3 reloads are dated events; later supplies still deduct');
    await A.page.evaluate(async () => {
      _bargeConfig = getBarges(); _reloadBargeId = 1;
      document.getElementById('reload-vlsfo').value = 500; document.getElementById('reload-mgo').value = 100; document.getElementById('reload-note').value = 'Terminal X';
      await saveReloadQty();
    });
    r = await live(A, 1);
    check(r.v === 3300 && r.m === 750, 'reload added (' + JSON.stringify(r) + ')');
    check((U.row(db).payload.state.bargeReloads || []).length === 1, 'reload event synced to cloud');
    await A.page.evaluate(() => { _savedSupplies.push({ id: 'rec_r3', vessel: 'BRAVO', barge: 'Barge 1', vlsfoAct: 100, mgoAct: 0, supplyDate: new Date(Date.now() + 60000).toISOString(), supplied: true }); });
    r = await live(A, 1);
    check(r.v === 3200, 'supply after reload deducts (' + JSON.stringify(r) + ')');
    await A.page.evaluate(() => saveSharedRecords());
    await B.page.evaluate(() => _pollOnce(true));
    r = await live(B, 1);
    check(r.v === 3200 && r.m === 750, 'other device agrees after pull (' + JSON.stringify(r) + ')');

    console.log('R4 stable barge ids');
    {
      const p = U.seedPayload({ barges: [
        { id: 2, name: 'Barge 1', vcap: 5000, mcap: 1000, vrob: 1000, mrob: 800, vbuf: 500, mbuf: 150, vtph: 300, mtph: 100, vrfr: 900, mrfr: 300 },
        { id: 5, name: 'Barge 10', vcap: 5000, mcap: 1000, vrob: 4000, mrob: 0, vbuf: 500, mbuf: 150, vtph: 400, mtph: 100, vrfr: 750, mrfr: 275 }] });
      p.state.vessels[0].bargeId = '5';
      p.state.manualROB = { '5_final': { v: 3500, m: 0, atIds: ['x1'] } }; // set after x1 was already supplied
      p.records = [
        { id: 'x1', vessel: 'Q', barge: 'Barge 10', vlsfoAct: 300, mgoAct: 0, supplyDate: '2026-10-10T08:00:00', supplied: true },
        { id: 'x2', vessel: 'R', barge: '', vlsfoAct: 70, mgoAct: 0, supplyDate: '2026-10-10T09:00:00', supplied: true }];
      const db2 = U.H.createDb({ workspace: p });
      const C = await U.open(browser, db2, 'user-operator');
      await U.helpers(C);
      const ids = await C.page.evaluate(() => ({ ids: _barges.map(b => b.id), sel: __getV('n1', 'barge'), cap: captureCurrentState().barges.map(b => [b.id, b.vrfr, b.mrfr]) }));
      check(JSON.stringify(ids.ids) === '[2,5]', 'barge ids kept from state (' + JSON.stringify(ids.ids) + ')');
      check(ids.sel === '5', 'vessel barge assignment kept');
      check(JSON.stringify(ids.cap) === '[[2,900,300],[5,750,275]]', 'capture saves id + refill rates (' + JSON.stringify(ids.cap) + ')');
      const r5 = await live(C, 5), r2 = await live(C, 2);
      check(r5.v === 3500, 'override keyed by id 5 applies to the right barge (' + JSON.stringify(r5) + ')');
      check(r2.supV === 0 && r5.supV === 300, 'totals: unassigned record counted for no barge in a multi-barge fleet; exact name match (' + r2.supV + '/' + r5.supV + ')');
      const sum = await C.page.evaluate(() => { renderLiveROBDashboard(); return document.getElementById('rob-sum-card-2') ? document.getElementById('rob-sum-card-2').innerText : ''; });
      check(/V Supplied\s*0\s*MT/i.test(sum.replace(/\n/g, ' ')), '"Barge 1" summary does not count "Barge 10" supplies');
      const added = await C.page.evaluate(() => { addBarge({ name: 'New' }); return _barges.map(b => b.id); });
      check(JSON.stringify(added) === '[2,5,6]', 'new barge gets a fresh id (' + JSON.stringify(added) + ')');

      console.log('R5 scheduler: live ROB start + grade-aware auto choice');
      const sch = await C.page.evaluate(() => {
        document.getElementById('barge-6')?.remove(); _barges = _barges.filter(b => b.id !== 6);
        __setV('n1', 'barge', ''); __setV('n1', 'type', 'BOTH'); __setV('n1', 'vlsfo', '500'); __setV('n1', 'mgo', '300');
        calculate();
        return { st5: _bargeStates[5] && _bargeStates[5]._openingV, label: (_lastSched.find(s => s.nomUid === 'n1') || {}).bargeLabel };
      });
      check(sch.st5 === 3500, 'barge state starts from live ROB (' + sch.st5 + ')');
      check(sch.label === 'Barge 1', 'vessel needing VLSFO+MGO goes to the barge that has MGO (' + sch.label + ')');
      check(U.realErrors(C).length === 0, 'no page errors (' + U.realErrors(C).join(' | ') + ')');
      await C.ctx.close();
    }
    check(U.realErrors(A).length === 0 && U.realErrors(B).length === 0, 'no page errors A/B (' + U.realErrors(A).concat(U.realErrors(B)).join(' | ') + ')');
  } finally {
    await browser.close();
  }
  U.summary('rob.test');
})().catch(e => { console.error(e); process.exit(2); });
