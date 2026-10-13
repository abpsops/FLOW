/* Parsing / formatting / vessel removal / clear-all propagation. */
const U = require('./util.js');
const { check } = U;

(async () => {
  const browser = await U.H.launch();
  try {
    const db = U.H.createDb({ workspace: U.seedPayload() });
    // dismiss confirms (rmV asks to e-mail Ops — answer "no")
    const A = await U.open(browser, db, 'user-operator', { onDialog: d => d.dismiss() });
    await U.helpers(A);

    console.log('M1 parseDT');
    const p = await A.page.evaluate(() => {
      const f = s => { const d = parseDT(s); return d ? `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}` : null; };
      const now = new Date();
      return { a: f('24 Mar 2025 08:00'), b: f('2026-10-05 14:30'), c: f('2026-10-05'), d: f('05/10/26'), e: f('05/10/2026 7:15 pm'),
        g: f('31 Feb 2026'), h: f('garbage'), i: f('08:00') === `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()} 8:0`, j: f('5 Oct'), k: f('32/01/2026'), l: f('13:00 pm') };
    });
    check(p.a === '2025-3-24 8:0', 'DD Mon YYYY HH:mm');
    check(p.b === '2026-10-5 14:30', 'YYYY-MM-DD HH:mm');
    check(p.c === '2026-10-5 0:0', 'YYYY-MM-DD');
    check(p.d === '2026-10-5 0:0', 'DD/MM/YY');
    check(p.e === '2026-10-5 19:15', 'DD/MM/YYYY h:mm pm');
    check(p.g === null, '31 Feb → null');
    check(p.h === null, 'garbage → null (not today)');
    check(p.i === true, 'time only → today');
    check(p.j && p.j.endsWith('-10-5 0:0'), 'DD Mon (current year)');
    check(p.k === null && p.l === null, 'day 32 / 13pm → null');

    console.log('M2 duration formatting');
    const d = await A.page.evaluate(() => [durStr(1.9999), durStr(0.5), _formatDurationHours(0.9999), _formatDurationHours(2.25), durStr(2)]);
    check(d[0] === '2h' && d[1] === '0h 30m' && d[2] === '1h' && d[3] === '2h 15m' && d[4] === '2h', 'no "1h 60m" (' + d.join(', ') + ')');

    console.log('M3 loading form uses local dates');
    const ld = await A.page.evaluate(() => {
      showPage('loading');
      const start = new Date(2026, 9, 12, 1, 30); // 01:30 local (Dubai) = previous day in UTC
      _loadingRecords.push({ id: 'ld_m3', barge: 'Barge 1', terminal: 'T', grade: 'VLSFO', qty: 100, startAt: start.toISOString(), endAt: new Date(2026, 9, 12, 2, 0).toISOString(), endOverridden: true, updatedAt: 1 });
      editLoadingRecord('ld_m3');
      return [document.getElementById('ld-start-date').value, document.getElementById('ld-start-time').value, document.getElementById('ld-end-date-override').value];
    });
    check(ld[0] === '2026-10-12' && ld[1] === '01:30' && ld[2] === '2026-10-12', 'edit form shows local date/time (' + ld.join(' ') + ')');
    await A.page.evaluate(() => cancelLoadingEdit());

    console.log('M4 removing a vessel');
    const rm = await A.page.evaluate(async () => {
      _checklistRecords = {
        u1: { uid: 'u1', vessel: 'ALPHA', nomUid: 'n1', state: 'pending' },
        u2: { uid: 'u2', vessel: 'ALPHA', nomUid: 'nOther', state: 'pending' },
        u3: { uid: 'u3', vessel: 'ALPHA', nomUid: 'n1', state: 'saved', lockedAt: 1 },
      };
      __setV('n1', 'imo', '9876543'); __setV('n1', 'remarks', 'keep me');
      rmV(Number(__cardFor('n1')));
      const keys = Object.keys(_checklistRecords).sort(); // rmV's own purge (renderChecklist later name-dedupes separately)
      await new Promise(r => setTimeout(r, 400));
      return { keys, def: _trashBin[_trashBin.length - 1].def };
    });
    check(JSON.stringify(rm.keys) === '["u2","u3"]', 'only the unlocked draft of THIS nomination removed (' + rm.keys + ')');
    check(rm.def.nomUid === 'n1' && rm.def.imo === '9876543' && rm.def.remarks === 'keep me', 'trash def keeps nomUid/imo/remarks');
    await A.page.reload({ waitUntil: 'load' }); await A.page.waitForTimeout(2500); await U.helpers(A);
    const tb = await A.page.evaluate(() => { const n = _trashBin.length; restoreFromTrash(n - 1); return { n, restored: __cardFor('n1') !== null, imo: __getV('n1', 'imo') }; });
    check(tb.n === 1 && tb.restored && tb.imo === '9876543', 'trash bin survives reload and restores the same nomination');

    console.log('M5 Clear All Data propagates, no resurrection');
    const B = await U.open(browser, db, 'user-operator2');
    await U.helpers(B);
    await A.page.evaluate(() => nuclearClear());
    await A.page.waitForTimeout(300);
    check((U.row(db).payload.state.vessels || []).length === 0, 'cloud is empty after Clear All');
    await B.page.evaluate(() => _pollOnce(true));
    check(await B.page.evaluate(() => document.querySelectorAll('.vcard[id^="vessel-"]').length) === 0, 'B pulled the empty workspace');
    await B.page.evaluate(() => { addVessel({ name: 'NEW-AFTER-CLEAR' }); return saveSharedState(); });
    await B.page.waitForTimeout(300);
    const names = U.row(db).payload.state.vessels.map(v => v.name);
    check(JSON.stringify(names) === '["NEW-AFTER-CLEAR"]', 'old vessels not resurrected (' + names + ')');
    check(U.realErrors(A).length === 0 && U.realErrors(B).length === 0, 'no page errors (' + U.realErrors(A).concat(U.realErrors(B)).join(' | ') + ')');
  } finally {
    await browser.close();
  }
  U.summary('misc.test');
})().catch(e => { console.error(e); process.exit(2); });
