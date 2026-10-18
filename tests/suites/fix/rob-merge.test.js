/* Barge ROB when two operators' saves meet (version conflict → three-way merge):
   a colleague's supply is deducted once, a barge a supply emptied stays empty.
   node rob-merge.test.js [appDir] */
const path = require('path');
const H = require(path.join(__dirname, '..', '..', 'harness', 'harness.js'));
const U = require(path.join(__dirname, '..', 'r3', 'util.js'));

let pass = 0, fail = 0;
function check(name, cond, info) {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 700)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const eta = h => { const d = new Date(Date.now() + h * 3600000); const p = n => String(n).padStart(2, '0'); return `${p(d.getDate())} ${MO[d.getMonth()]} ${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const VBASE = { imo: '', area: 'FUJ-A', spec: 'ISO 8217:2010', agent: 'AG', manifold: 'VESSEL MANIFOLD', remarks: '', lc: '', paq: 'no', bargeId: '1', refuelChk: false, rfv: 0, rfm: 0, rfvr: 750, rfmr: 275 };

async function open(browser, db, uid) {
  const a = await U.open(browser, db, uid);
  await a.page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; window.__toasts = []; const t = showToast; showToast = function(m) { window.__toasts.push(String(m)); return t.apply(this, arguments); }; });
  return a;
}
const slow = p => p.evaluate(() => {
  const o = window.__mockDb;
  window.__mockDb = async function(q) { await new Promise(r => setTimeout(r, 500)); const r = await o(q); await new Promise(r2 => setTimeout(r2, 500)); return r; };
});
const live = p => p.evaluate(() => { try { renderLiveROBDashboard(); } catch (e) {} const l = getAllLiveROBs()[1]; return l ? [Math.round(l.liveV), Math.round(l.liveM)] : null; });
const cloudBarge = db => U.row(db).payload.state.barges.map(b => [b.vrob, b.mrob])[0];
// Generate the schedule, then log a supply in the checklist row of nomination `nom`.
const logSupply = (p, nom, v, m) => p.evaluate(async ([nom, v, m]) => {
  const uid = 'n_' + nom;
  if (!_checklistRecords[uid]) return 'no checklist row';
  document.getElementById('cl-av-' + uid).value = String(v);
  document.getElementById('cl-am-' + uid).value = String(m);
  await saveChecklistRecord(uid);
  await _waitForSaveIdle();
  return 'ok';
}, [nom, v, m]);
const generate = p => p.evaluate(async () => { calculate(); await _waitForSaveIdle(); });

(async () => {
  const browser = await H.launch();
  const scenario = async (name, fn, expectedErr) => {
    console.log('— ' + name);
    const apps = [];
    try { await fn(async (db, uid) => { const a = await open(browser, db, uid); apps.push(a); return a; }); }
    catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
    const errs = [].concat(...apps.map(a => U.realErrors(a))).filter(e => !(expectedErr && expectedErr.test(e)));
    check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
    for (const a of apps) await a.ctx.close();
  };
  const twoSupplies = (bGrade, o) => {
    o = o || {};
    const seed = U.seedPayload({ vessels: [
      Object.assign({}, VBASE, { nomUid: 'n1', name: 'ALPHA', type: 'VLSFO', qty: 100, mgo: 0, eta: eta(3) }),
      Object.assign({}, VBASE, { nomUid: 'n2', name: 'BRAVO', type: bGrade, qty: bGrade === 'VLSFO' ? 50 : 0, mgo: bGrade === 'MGO' ? 50 : 0, eta: eta(10) }),
    ] });
    seed.state.bakedSupplyIds = {};
    if (o.vrob != null) seed.state.barges[0].vrob = o.vrob;
    // a synced "current ROB" override (ROB Update panel, e.g. after a dip)
    if (o.override) seed.state.manualROB = { '1_final': { v: o.override[0], m: o.override[1], reason: 'dip', editedAt: new Date().toISOString(), editedBy: 'ROB Update', atIds: [] } };
    return seed;
  };

  // Barge 1: 4000 VLSFO / 800 MGO. B logs BRAVO 50 MT; A (not pulled yet) logs ALPHA 100 MT VLSFO.
  // R1d: with a synced ROB override 2000 / 600 → 1900 / 550. R1e: 100 MT on board, 50 + 80 delivered → 0 (never negative).
  for (const [bGrade, want, timing, o, aQty, tag] of [['MGO', [3900, 750], 'after', null, 100, 'a'], ['MGO', [3900, 750], 'during', null, 100, 'b'], ['VLSFO', [3850, 800], 'after', null, 100, 'c'],
      ['MGO', [1900, 550], 'after', { override: [2000, 600] }, 100, 'd'], ['VLSFO', [0, 800], 'after', { vrob: 100 }, 80, 'e']]) {
    await scenario(`R1${tag} two supplies, BRAVO ${bGrade}, A logs ${timing} its schedule save${o ? ' — ' + JSON.stringify(o) : ''}`, async (openT) => {
      const db = H.createDb({ workspace: twoSupplies(bGrade, o), realtime: false });
      const A = await openT(db, 'user-operator');
      const B = await openT(db, 'user-operator2');
      if (timing === 'after') await generate(A.page);
      await generate(B.page);
      const okB = await logSupply(B.page, 'n2', bGrade === 'VLSFO' ? 50 : 0, bGrade === 'MGO' ? 50 : 0);
      await slow(A.page);
      let okA;
      if (timing === 'after') okA = await logSupply(A.page, 'n1', aQty, 0);
      else okA = await A.page.evaluate(async () => {   // the schedule save is still on the network when ALPHA is logged
        calculate(); await new Promise(r => setTimeout(r, 300));
        const inflight = !!_saveRunning;
        document.getElementById('cl-av-n_n1').value = '100'; document.getElementById('cl-am-n_n1').value = '0';
        await saveChecklistRecord('n_n1'); await _waitForSaveIdle();
        return inflight ? 'ok' : 'save was not in flight';
      });
      await sleep(800);
      await B.page.evaluate(() => _pollOnce(true)); await sleep(600);
      const F = await openT(db, 'user-operator');
      await sleep(600);
      const r = { okA, okB, cloud: cloudBarge(db), A: await live(A.page), B: await live(B.page), fresh: await live(F.page), toasts: await A.page.evaluate(() => window.__toasts.filter(t => /bakedSupplyIds|barges/.test(t))) };
      check(`each supply is deducted once — ${want.join(' / ')} in the cloud, on both devices and on a fresh one`, okA === 'ok' && okB === 'ok' && [r.cloud, r.A, r.B, r.fresh].every(x => JSON.stringify(x) === JSON.stringify(want)) && !r.toasts.length, r);
      if (tag === 'e') {
        const rl = await F.page.evaluate(async () => { openReloadModal(1); document.getElementById('reload-vlsfo').value = '1000'; await saveReloadQty(); await _waitForSaveIdle(); const l = getAllLiveROBs()[1]; return [Math.round(l.liveV), Math.round(l.liveM)]; });
        check('…and a later 1000 MT reload gives exactly 1000', JSON.stringify(rl) === JSON.stringify([1000, 800]) && JSON.stringify(cloudBarge(db)) === JSON.stringify([1000, 800]), [rl, cloudBarge(db)]);
      }
    });
  }

  // The save reaches the server but its response is lost: the next save meets this device's own write.
  for (const [mode, want] of [['override', [1900, 600]], ['clamp', [0, 800]]]) {
    await scenario(`R4 a save whose response was lost (${mode})`, async (openT) => {
      const seed = twoSupplies('MGO', mode === 'override' ? { override: [2000, 600] } : { vrob: 60 });
      const db = H.createDb({ workspace: seed, realtime: false });
      const A = await openT(db, 'user-operator');
      await generate(A.page);
      const dropped = await A.page.evaluate(async () => {
        const o = window.__mockDb; let n = 0;
        window.__mockDb = async function(q) { const op = JSON.parse(q); const r = await o(q); if (!n && op.table === 'abps_workspace' && op.action === 'update') { n++; window.__mockDb = o; throw new Error('Failed to fetch'); } return r; };
        document.getElementById('cl-av-n_n1').value = '100'; document.getElementById('cl-am-n_n1').value = '0';
        await saveChecklistRecord('n_n1'); await _waitForSaveIdle();
        return n;
      });
      await A.page.evaluate(async () => { await _pollOnce(true); await _waitForSaveIdle(); });
      await sleep(800);
      const F = await openT(db, 'user-operator2');
      await sleep(600);
      const r = { dropped, cloud: cloudBarge(db), A: await live(A.page), fresh: await live(F.page) };
      check(`its own write is not applied twice: ${want.join(' / ')} everywhere`, dropped === 1 && [r.cloud, r.A, r.fresh].every(x => JSON.stringify(x) === JSON.stringify(want)), r);
    }, /saveSharedState failed: Error: Failed to fetch/); // the network failure this test injects
  }

  // B changes the MGO figure (Barge Fleet opening edit, or a dip in ROB Update), then logs BRAVO 50 VLSFO;
  // A (not pulled yet) logs ALPHA 100 VLSFO → VLSFO 3850, and B's MGO figure stays.
  for (const [tag, wantM] of [['opening edit', 1000], ['ROB Update dip', 700]]) {
    await scenario(`R5 colleague's ${tag} on the other grade, then both log supplies`, async (openT) => {
      const db = H.createDb({ workspace: twoSupplies('VLSFO'), realtime: false });
      const A = await openT(db, 'user-operator');
      const B = await openT(db, 'user-operator2');
      await generate(A.page);
      await generate(B.page);
      const okEdit = tag === 'opening edit'
        ? await B.page.evaluate(async () => { const el = document.getElementById('b1-mrob'); if (!el) return 'no b1-mrob'; el.value = '1000'; el.dispatchEvent(new Event('input', { bubbles: true })); saveBargeEdit(1); await _waitForSaveIdle(); return 'ok'; })
        : await B.page.evaluate(async () => { renderLiveROBDashboard(); const v = document.getElementById('rob-sum-v-1'), m = document.getElementById('rob-sum-m-1'); if (!v || !m) return 'no rob-sum inputs'; v.value = '4000'; m.value = '700'; const rr = document.getElementById('rob-sum-reason-1'); if (rr) rr.value = 'dip'; await saveROBSumEdit(1); await _waitForSaveIdle(); return 'ok'; });
      const okB = await logSupply(B.page, 'n2', 50, 0);
      await slow(A.page);
      const okA = await logSupply(A.page, 'n1', 100, 0);
      await sleep(800);
      await B.page.evaluate(() => _pollOnce(true)); await sleep(600);
      const F = await openT(db, 'user-operator');
      await sleep(600);
      const want = [3850, wantM];
      const r = { okEdit, okA, okB, cloud: cloudBarge(db), A: await live(A.page), B: await live(B.page), fresh: await live(F.page) };
      check(`VLSFO 4000 − 50 − 100 = 3850, and the colleague's MGO ${wantM} is kept — everywhere`, okEdit === 'ok' && okA === 'ok' && okB === 'ok' && [r.cloud, r.A, r.B, r.fresh].every(x => JSON.stringify(x) === JSON.stringify(want)), r);
    });
  }

  // A is offline: logs ALPHA 100 VLSFO, then records a dip of 3500 / 800; B logs BRAVO 50 VLSFO; A reconnects.
  // The dip came before BRAVO, so BRAVO still deducts after it: 3450.
  await scenario('R6 offline supply + dip on one device, a colleague\'s supply meanwhile', async (openT) => {
    const db = H.createDb({ workspace: twoSupplies('VLSFO'), realtime: false });
    const A = await openT(db, 'user-operator');
    const B = await openT(db, 'user-operator2');
    await generate(A.page);
    await generate(B.page);
    await A.page.evaluate(() => { window.__realDb = window.__mockDb; window.__mockDb = async function() { throw new Error('Failed to fetch'); }; });
    const okA = await logSupply(A.page, 'n1', 100, 0);
    const dip = await A.page.evaluate(async () => {
      renderLiveROBDashboard(); const v = document.getElementById('rob-sum-v-1'), m = document.getElementById('rob-sum-m-1');
      if (!v || !m) return 'no rob-sum inputs';
      v.value = '3500'; m.value = '800'; const rr = document.getElementById('rob-sum-reason-1'); if (rr) rr.value = 'dip';
      await saveROBSumEdit(1); await _waitForSaveIdle(); return 'ok';
    });
    const okB = await logSupply(B.page, 'n2', 50, 0);
    await A.page.evaluate(async () => { window.__mockDb = window.__realDb; await _pollOnce(true); await _waitForSaveIdle(); });
    await sleep(800);
    await B.page.evaluate(() => _pollOnce(true)); await sleep(600);
    const F = await openT(db, 'user-operator');
    await sleep(600);
    const r = { okA, dip, okB, cloud: cloudBarge(db), A: await live(A.page), B: await live(B.page), fresh: await live(F.page) };
    check('3500 after the dip, then BRAVO 50 → 3450 on every device', okA === 'ok' && dip === 'ok' && okB === 'ok' && [r.A, r.B, r.fresh].every(x => JSON.stringify(x) === JSON.stringify([3450, 800])), r);
  }, /Failed to fetch/); // this test takes A offline

  // Barge 1: 100 VLSFO. B logs ALPHA 100 MT (barge empty); A (not pulled) saves a remark.
  await scenario('R2 a supply that empties the barge, then a colleague\'s conflicting save', async (openT) => {
    const seed = twoSupplies('MGO');
    seed.state.barges[0].vrob = 100;
    const db = H.createDb({ workspace: seed, realtime: false });
    const A = await openT(db, 'user-operator');
    const B = await openT(db, 'user-operator2');
    await generate(B.page);
    const okB = await logSupply(B.page, 'n1', 100, 0);
    await U.helpers(A);
    await A.page.evaluate(() => { const el = document.getElementById('v' + __cardFor('n2') + '-remarks'); el.value = 'A remark'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return saveSharedState(); });
    await sleep(800);
    const F = await openT(db, 'user-operator');
    await sleep(600);
    const r = { okB, cloud: cloudBarge(db), A: await live(A.page), fresh: await live(F.page), remark: (U.row(db).payload.state.vessels.find(v => v.nomUid === 'n2') || {}).remarks };
    check('the barge stays empty (VLSFO 0) everywhere; the remark is saved', okB === 'ok' && [r.cloud, r.A, r.fresh].every(x => x && x[0] === 0) && r.remark === 'A remark', r);
  });

  // The merge itself: a supply both sides baked counts once; a reload both baked too; one-sided changes as before.
  await scenario('R3 merge rules', async (openT) => {
    const db = H.createDb({ workspace: U.seedPayload({}), realtime: false });
    const { page } = await openT(db);
    const out = await page.evaluate(() => {
      const doc = (v, m, baked, recs, reloads) => ({ state: { barges: [{ id: 1, name: 'Barge 1', vrob: v, mrob: m }], bakedSupplyIds: { 1: baked }, bargeReloads: reloads || [] }, records: recs || [], checklistRecords: {}, version: 1 });
      const S1 = { id: 's1', barge: 'Barge 1', vlsfoAct: 100, mgoAct: 0 }, S2 = { id: 's2', barge: 'Barge 1', vlsfoAct: 0, mgoAct: 50 }, S3 = { id: 's3', barge: 'Barge 1', vlsfoAct: 30, mgoAct: 0 };
      const R1 = { id: 'r1', bargeId: 1, v: 200, m: 0 };
      const res = {};
      let x = _mergePayloads(doc(4000, 800, []), doc(3900, 800, ['s1'], [S1]), doc(4000, 750, ['s2'], [S2]));
      res.diffGrades = [x.merged.state.barges[0].vrob, x.merged.state.barges[0].mrob, x.merged.state.bakedSupplyIds[1].slice().sort(), x.conflicts];
      _savedSupplies = x.merged.records; _bakedSupplyIds = x.merged.state.bakedSupplyIds; _manualROB = {};
      const lr = computeLiveROB(1, 'Barge 1', x.merged.state.barges[0].vrob, x.merged.state.barges[0].mrob, null);
      res.diffGradesLive = [Math.round(lr.v), Math.round(lr.m)];
      x = _mergePayloads(doc(4000, 800, []), doc(3870, 800, ['s1', 's3'], [S1, S3]), doc(3900, 800, ['s1'], [S1]));
      res.bothBakedOne = [x.merged.state.barges[0].vrob, x.merged.state.bakedSupplyIds[1].slice().sort()];
      x = _mergePayloads(doc(4000, 800, []), doc(4170, 800, ['s3', 'r1'], [S3], [R1]), doc(4200, 800, ['r1'], [], [R1]));
      res.reloadBoth = [x.merged.state.barges[0].vrob];
      const S4 = { id: 's4', barge: 'Barge 1', vlsfoAct: 50, mgoAct: 0 }, S5 = { id: 's5', barge: 'Barge 1', vlsfoAct: 50, mgoAct: 0 };
      x = _mergePayloads(doc(4000, 800, []), doc(3950, 800, ['s4'], [S4, S5]), doc(3950, 800, ['s5'], [S4, S5]));
      _savedSupplies = x.merged.records; _bakedSupplyIds = x.merged.state.bakedSupplyIds;
      const eq = computeLiveROB(1, 'Barge 1', x.merged.state.barges[0].vrob, x.merged.state.barges[0].mrob, null);
      res.equalMoves = [Math.round(eq.v), Math.round(eq.m)];
      x = _mergePayloads(doc(4000, 800, ['s0']), doc(3900, 800, ['s0', 's1'], [S1]), doc(4000, 800, ['s0']));
      res.oneSided = [x.merged.state.barges[0].vrob, x.merged.state.bakedSupplyIds[1].slice().sort()];
      const l = doc(3900, 800, ['s1'], [S1]), r = doc(4000, 750, ['s2'], [S2]), rCopy = JSON.stringify(r), lCopy = JSON.stringify(l);
      _mergePayloads(doc(4000, 800, []), l, r);
      res.untouched = JSON.stringify(r) === rCopy && JSON.stringify(l) === lCopy;
      return res;
    });
    check('both sides baked different supplies: this device\'s baked list; the MGO opening taken from the colleague gets their 50 MT back; no conflict reported', JSON.stringify(out.diffGrades) === JSON.stringify([3900, 800, ['s1'], []]), out.diffGrades);
    check('…so the live ROB deducts the colleague\'s supply once: 3900 / 750', JSON.stringify(out.diffGradesLive) === JSON.stringify([3900, 750]), out.diffGradesLive);
    check('same grade, one supply baked on both sides plus one more locally: 4000 − 100 − 30 = 3870', JSON.stringify(out.bothBakedOne) === JSON.stringify([3870, ['s1', 's3']]), out.bothBakedOne);
    check('a reload baked on both sides is added once: 4000 + 200 − 30 = 4170', JSON.stringify(out.reloadBoth) === JSON.stringify([4170]), out.reloadBoth);
    check('only one side baked: its opening and list, as before', JSON.stringify(out.oneSided) === JSON.stringify([3900, ['s0', 's1']]), out.oneSided);
    check('two different 50 MT VLSFO supplies, one on each side (both openings 3950): live 3900', JSON.stringify(out.equalMoves) === JSON.stringify([3900, 800]), out.equalMoves);
    check('the merge does not change its inputs (the remote row becomes the next merge base)', out.untouched === true);
  });

  await browser.close();
  console.log('ROB-MERGE: ' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
