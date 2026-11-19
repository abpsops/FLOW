/* IMO from the Track Record on the nomination card.
   A vessel supplied before carries the IMO it was supplied under (Delivery Log).
   • typing its name ("M/T HAYAT" = "HAYAT") fills an EMPTY IMO box with it, says so,
     and the nomination is saved with it
   • a different number already in the box is never overwritten: "Track Record: IMO … — use it"
   • two IMOs for one name (two ships): nothing filled, both listed with their last supply to pick
   • the name changed after the IMO was filled in → the IMO filled in goes again
   • a card that only loads (not typed) shows the link but never fills (no write)
   • unknown vessel / an unusable IMO in the log: nothing
   node suites/fix2/trackrecord-imo.test.js [appDir] */
const path = require('path');
if (process.argv[2]) process.env.APP_DIR = path.resolve(process.argv[2]);
const H = require(path.join(__dirname, '..', '..', 'harness', 'harness.js'));
const U = require(path.join(__dirname, '..', 'r3', 'util.js'));

let pass = 0, fail = 0;
function check(name, cond, info) {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 900)));
}
const NOW = Date.now(), DAY = 864e5;
let seq = 0;
const ent = (vessel, daysAgo, imo) => { seq++; const t = NOW - daysAgo * DAY; return Object.assign({ id: 'sup_' + seq, checklistUid: 'cl_' + seq, vessel, dateStr: '', supplyDate: new Date(t).toISOString(), barge: 'Barge 1', vlsfoAct: 500, mgoAct: 0, loggedAt: new Date(t).toISOString(), updatedAt: t }, imo ? { imo } : {}); };
const monthKey = iso => iso.slice(0, 7);
function log(list) {
  const dl = {};
  list.forEach(e => { const k = monthKey(e.supplyDate); dl[k] = dl[k] || { timely: [], delayed: [], disputes: [] }; dl[k].timely.push(e); });
  return dl;
}
// 9321483, 9074729 and 9176838 are valid IMOs (check digit)
const DL = log([
  ent('HAYAT', 40, '9321483'), ent('M/T HAYAT', 10, '9321483'),
  ent('SEA STAR', 50, '9074729'), ent('SEA STAR', 5, '9176838'),
  ent('NO NUMBER', 8), ent('BAD NUMBER', 8, '<b>123</b>'),
]);
const VB = { imo: '', area: 'FUJ-A', type: 'VLSFO', qty: 500, mgo: 0, spec: 'ISO 8217:2010', agent: 'AG', manifold: 'VESSEL MANIFOLD', remarks: '', lc: '', eta: '', paq: 'no', bargeId: '', refuelChk: false, rfv: 0, rfm: 0, rfvr: 750, rfmr: 275 };

(async () => {
  const browser = await H.launch();
  const scenario = async (name, fn) => {
    if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return;
    console.log('— ' + name);
    const apps = [];
    try { await fn(async (db, uid) => { const a = await U.open(browser, db, uid); await U.helpers(a); await a.page.evaluate(() => { window.alert = () => {}; window.confirm = () => true; showPage('nominations'); }); apps.push(a); return a; }); }
    catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
    const errs = [].concat(...apps.map(a => U.realErrors(a)));
    check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
    for (const a of apps) await a.ctx.close();
  };
  // a new card, its name typed (input events, then the 400 ms pause)
  const typeName = (page, name, id) => page.evaluate(async ([name, id]) => {
    if (id == null) { addVessel(); id = [...document.querySelectorAll('.vcard[id^="vessel-"]')].pop().id.replace('vessel-', ''); }
    const el = document.getElementById('v' + id + '-name');
    el.value = name; el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 700));
    return { id, imo: document.getElementById('v' + id + '-imo').value, mmsi: document.getElementById('v' + id + '-mmsi').value,
      tr: document.getElementById('v' + id + '-trimo').textContent.replace(/\s+/g, ' ').trim(),
      btns: [...document.querySelectorAll('#v' + id + '-trimo .vid-tr-use')].map(b => b.textContent),
      badge: (document.getElementById('v' + id + '-idbadge') || {}).textContent || '' };
  }, [name, id == null ? null : id]);
  const ws = (extra) => U.seedPayload(Object.assign({ deliveryLog: JSON.parse(JSON.stringify(DL)), vessels: [] }, extra || {}));

  await scenario('I1 a vessel supplied before', async (openT) => {
    const db = H.createDb({ workspace: ws(), realtime: false });
    const A = await openT(db, 'user-operator');
    const r = await typeName(A.page, 'HAYAT');
    check('I1 typing a name the Track Record knows fills the empty IMO box with the IMO it was supplied under', r.imo === '9321483' && r.mmsi === '' && /IMO ✓/.test(r.badge), r);
    check('I1 …and says where it came from', /^IMO filled in from the Track Record — supplied /.test(r.tr), r.tr);
    await A.page.evaluate(() => _waitForSaveIdle());
    await A.page.waitForTimeout(1800); await A.page.evaluate(() => _waitForSaveIdle());
    const v = (U.row(db).payload.state.vessels || []).find(x => x.name === 'HAYAT');
    check('I1 the nomination is saved with it', v && v.imo === '9321483', v);
    const r2 = await typeName(A.page, 'M/T Hayat');
    check('I1 the name as typed does not matter ("M/T Hayat" = "HAYAT")', r2.imo === '9321483', r2);
    // the name changes to a vessel with no record: the IMO filled in goes again
    const r3 = await typeName(A.page, 'HAYAT STAR', r2.id);
    check('I1 changing the name after the IMO was filled in takes that IMO back out', r3.imo === '' && r3.tr === '', r3);
  });

  await scenario('I2 a different IMO already in the box', async (openT) => {
    const db = H.createDb({ workspace: ws(), realtime: false });
    const A = await openT(db, 'user-operator');
    const r = await A.page.evaluate(async () => {
      addVessel(); const id = [...document.querySelectorAll('.vcard[id^="vessel-"]')].pop().id.replace('vessel-', '');
      const imo = document.getElementById('v' + id + '-imo'); imo.value = '9074729'; vidCommit(Number(id), 'imo');
      return id;
    });
    const t = await typeName(A.page, 'HAYAT', r);
    check('I2 an IMO already typed is never overwritten; a link offers the Track Record\'s', t.imo === '9074729' && /^Track Record: IMO 9321483 — use it$/.test(t.tr), t);
    const u = await A.page.evaluate(async (id) => { document.querySelector('#v' + id + '-trimo .vid-tr-use').click(); return { imo: document.getElementById('v' + id + '-imo').value, tr: document.getElementById('v' + id + '-trimo').textContent }; }, r);
    check('I2 clicking it puts that IMO in the box and the link goes', u.imo === '9321483' && u.tr === '', u);
  });

  await scenario('I3 two ships with one name', async (openT) => {
    const db = H.createDb({ workspace: ws(), realtime: false });
    const A = await openT(db, 'user-operator');
    const valid = await A.page.evaluate(() => ['9321483', '9074729', '9176838'].every(_imoValid));
    check('I3 (the test IMOs are valid)', valid);
    const t = await typeName(A.page, 'SEA STAR');
    check('I3 two IMOs for one name: nothing is filled, both are listed (latest supply first) to pick from', t.imo === '' && /Track Record has 2 ships by this name — pick one/.test(t.tr) && JSON.stringify(t.btns) === JSON.stringify(['IMO 9176838', 'IMO 9074729']) && /last supplied/.test(t.tr), t);
    const u = await A.page.evaluate(async (id) => { document.querySelectorAll('#v' + id + '-trimo .vid-tr-use')[1].click(); return { imo: document.getElementById('v' + id + '-imo').value, tr: document.getElementById('v' + id + '-trimo').textContent }; }, t.id);
    check('I3 picking one puts it in the box', u.imo === '9074729' && u.tr === '', u);
  });

  await scenario('I4 a card that only loads', async (openT) => {
    const db = H.createDb({ workspace: ws({ vessels: [Object.assign({}, VB, { nomUid: 'n1', name: 'HAYAT' })] }), realtime: false });
    const w0 = U.writes(db, 'user-operator').length;
    const A = await openT(db, 'user-operator');
    await A.page.waitForTimeout(2000);
    const r = await A.page.evaluate(() => { const id = document.querySelector('.vcard[id^="vessel-"]').id.replace('vessel-', ''); return { imo: document.getElementById('v' + id + '-imo').value, tr: document.getElementById('v' + id + '-trimo').textContent.replace(/\s+/g, ' ').trim() }; });
    check('I4 a saved nomination with no IMO is not changed by itself on loading; the link is offered', r.imo === '' && /^Track Record: IMO 9321483 — use it$/.test(r.tr) && U.writes(db, 'user-operator').length === w0, { r, writes: U.writes(db, 'user-operator').length - w0 });
  });

  await scenario('I5 nothing to offer', async (openT) => {
    const db = H.createDb({ workspace: ws(), realtime: false });
    const A = await openT(db, 'user-operator');
    const a = await typeName(A.page, 'NEVER SUPPLIED');
    const b = await typeName(A.page, 'NO NUMBER');
    const c = await typeName(A.page, 'BAD NUMBER');
    check('I5 a vessel never supplied, or supplied with no / an unusable IMO: nothing is filled or offered', [a, b, c].every(x => x.imo === '' && x.tr === ''), [a, b, c]);
  });

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
