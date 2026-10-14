/* After a pull with no local edits the device must be "clean" (no spurious
   merge, no extra write) — otherwise devices would ping-pong writes. */
const U = require('./util.js');
const { check } = U;
(async () => {
  const browser = await U.H.launch();
  try {
    const db = U.H.createDb({ workspace: U.seedPayload() });
    const A = await U.open(browser, db, 'user-operator');
    const B = await U.open(browser, db, 'user-operator2');
    await U.helpers(A); await U.helpers(B);
    await A.page.evaluate(async () => {
      calculate();
      await new Promise(r => setTimeout(r, 300));
      _loadingRecords.push({ id: 'ld_n', barge: 'Barge 1', terminal: 'T', grade: 'VLSFO', qty: 100, startAt: new Date().toISOString(), endAt: new Date(Date.now()+3600e3).toISOString(), updatedAt: Date.now() });
      _agents.push({ id: 5000, name: 'Zeta Agency', emails: 'z@z' });
      _savedSupplies.push({ id: 'rec_n', vessel: 'ALPHA', barge: 'Barge 1', vlsfoAct: 100, mgoAct: 0, supplyDate: new Date().toISOString(), supplied: true });
      return saveSharedRecords();
    });
    const diffKeys = async (app) => app.page.evaluate(() => {
      const l = _mergeDoc(_buildLocalPayload()), b = _mergeDoc(_lastSyncedPayload);
      const out = [];
      ['records', 'checklistRecords'].forEach(k => { if (!_sameJSON(l[k], b[k])) out.push(k); });
      Object.keys(Object.assign({}, l.state, b.state)).forEach(k => { if (!_sameJSON(l.state[k], b.state[k])) out.push('state.' + k); });
      return out;
    });
    check((await diffKeys(A)).length === 0, 'A clean after its own save (' + (await diffKeys(A)) + ')');
    const wB = U.writes(db, 'user-operator2').length;
    await B.page.evaluate(() => _pollOnce(true));
    await B.page.waitForTimeout(500);
    const dk = await diffKeys(B);
    check(dk.length === 0, 'B clean right after pulling (' + dk + ')');
    check(U.writes(db, 'user-operator2').length === wB, 'B did not write after a pure pull');
    // B reloads (fresh init from cloud) — still clean, and no write on startup
    await B.page.reload({ waitUntil: 'load' }); await B.page.waitForTimeout(3000); await U.helpers(B);
    const dk2 = await diffKeys(B);
    check(dk2.length === 0, 'B clean after reload (' + dk2 + ')');
    check(U.writes(db, 'user-operator2').length === wB, 'no write on B startup');
    const wA = U.writes(db, 'user-operator').length;
    await A.page.evaluate(() => _pollOnce(true)); await A.page.waitForTimeout(500);
    check(U.writes(db, 'user-operator').length === wA, 'A poll: no extra write');
    check(U.realErrors(A).length === 0 && U.realErrors(B).length === 0, 'no page errors (' + U.realErrors(A).concat(U.realErrors(B)).join(' | ') + ')');
  } finally { await browser.close(); }
  U.summary('noise.test');
})().catch(e => { console.error(e); process.exit(2); });
