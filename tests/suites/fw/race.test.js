/* Sync race: a colleague's deletion must not come back when this device saves
   while (or after) it pulls that deletion.
   node race.test.js [appDir] [only]      env RACE_ITER = iterations per case (default 2)

   Two operator devices A and B share one fake workspace. Realtime fan-out and
   the timer poll are off, so every pull happens exactly when the test says.
   The interleavings are forced with gates on A's own DB calls / getSession:

   stale   A never pulled B's deletion: its save hits the version CAS, conflicts,
           and three-way merges (base = what A last synced).
   pulled  A pulled B's deletion first, then saves.
   race1   A's pull is in flight (row read, response held) when A saves; the pull
           lands while the save is still in _ensureFreshSession (before the CAS
           is built).
   race2   same, but the save's UPDATE has already been built (old version) and
           is held until the pull has landed.

   Per collection (bargeBlocks, vessels, loadingRecords — all merged by id):
   B deletes the item while A edits something unrelated  → stays deleted;
   B deletes it while A edits the item itself            → the edit wins (by design);
   both delete it                                        → stays deleted.
   Besides the final state, every cloud state written after B's deletion is
   recorded: the deleted item must never re-appear, not even transiently. */
const path = require('path');
const H = require(path.join(__dirname, '..', '..', 'harness', 'harness.js'));
const appDir = process.argv[2] || H.APP_DIR;
const only = process.argv[3] || '';
const ITER = Math.max(1, parseInt(process.env.RACE_ITER, 10) || 2);

let pass = 0, fail = 0;
function check(name, cond, info) {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 700)));
}

// Page-side: gates on this page's DB calls and on auth.getSession, plus helpers.
const PAGE_HELPERS = () => {
  window.__gates = [];
  const mk = (name, match, phase) => {
    let release; const p = new Promise(r => { release = r; });
    const g = { name, match, phase, p, release, used: false, hit: false };
    window.__gates.push(g); return g;
  };
  window.__gate = (name, matchSrc, phase) => { mk(name, new Function('op', 'return ' + matchSrc), phase); };
  window.__gateHit = (name) => !!(window.__gates.find(g => g.name === name) || {}).hit;
  window.__release = (name) => window.__gates.filter(g => g.name === name).forEach(g => g.release());
  window.__releaseAll = () => { window.__gates.forEach(g => g.release()); window.__gates = []; };
  if (!window.__dbWrapped) {
    window.__dbWrapped = true;
    const orig = window.__mockDb;
    window.__mockDb = async function (s) {
      const op = JSON.parse(s);
      const g = window.__gates.find(x => !x.used && x.match !== 'session' && x.match(op));
      if (!g) return orig(s);
      g.used = true; g.hit = true;
      if (g.phase === 'before') await g.p;
      const r = await orig(s);
      if (g.phase === 'after') await g.p;
      return r;
    };
    const auth = supabaseClient.auth, origGS = auth.getSession.bind(auth);
    auth.getSession = async function () {
      const g = window.__gates.find(x => !x.used && x.match === 'session');
      if (g) { g.used = true; g.hit = true; await g.p; }
      return origGS();
    };
    window.__gateSession = (name) => { mk(name, 'session', 'before'); };
  }
  // No timer polls during a case (realtime is off on the fake DB too).
  SYNC_POLL_MS = SYNC_POLL_LIVE_MS = 1e9; startAutoSync();
  window.__card = (nomUid) => {
    const c = Array.from(document.querySelectorAll('.vcard[id^="vessel-"]')).find(x => x.dataset.nomUid === nomUid);
    return c ? c.id.replace('vessel-', '') : null;
  };
  window.__remarks = (nomUid, txt) => { document.getElementById('v' + __card(nomUid) + '-remarks').value = txt; };
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(page, fn, arg, ms) {
  await page.waitForFunction(fn, arg, { timeout: ms || 10000, polling: 10 });
}

(async () => {
  const browser = await H.launch();
  const db = H.createDb();
  db.realtime = false;

  // Cloud history: the workspace payload after every write that changed it.
  const history = [];
  db.intercept = (op) => {
    if (op.action !== 'select' && op.table === 'abps_workspace') {
      process.nextTick(() => { const r = db.tables.abps_workspace.get('main'); if (r) history.push({ v: r.version, payload: JSON.parse(JSON.stringify(r.payload)) }); });
    }
    return null;
  };
  const cloud = () => db.tables.abps_workspace.get('main').payload;

  const A = await H.openApp(browser, db, { appDir, uid: 'user-operator' });
  await A.page.evaluate(() => {
    document.querySelectorAll('.vcard[id^="vessel-"]').forEach(c => c.remove());
    (_barges || []).slice().forEach(b => rmBarge(b.id));
    _bargeBlocks = []; _loadingRecords = []; _lastSched = [];
    addBarge({ name: 'B1', vrob: 4000, mrob: 800 });
    addVessel({ name: 'MV KEEP', type: 'VLSFO', qty: 500, mgo: 0, area: 'FUJ-A', lc: '', paq: 'no', eta: '' });
    return saveSharedState();
  });
  const B = await H.openApp(browser, db, { appDir, uid: 'user-operator2' });
  for (const app of [A, B]) await app.page.evaluate(PAGE_HELPERS);
  await B.page.evaluate(() => _pollOnce(true));
  const keepUid = await A.page.evaluate(() => document.querySelector('.vcard[id^="vessel-"]').dataset.nomUid);

  // Item kinds: how to create / delete / edit / read one, on a page.
  const KINDS = {
    block: {
      create: (tag) => { const b = _barges[0]; _bargeBlocks = _bargeBlocks.concat([{ id: 'blk_' + tag, bargeId: b.id, bargeName: 'B1', start: new Date(Date.now() + 40 * 3600e3).toISOString(), end: new Date(Date.now() + 50 * 3600e3).toISOString(), reason: 'R ' + tag, createdBy: 'x', createdAt: Date.now(), updatedAt: Date.now() }]); return 'blk_' + tag; },
      del: (id) => { const el = document.querySelector('#free-windows-panel .fw-blk-item[data-block-id="' + id + '"] button'); if (el) el.click(); else deleteBargeBlock(id); },
      edit: (id, txt) => { _bargeBlocks = _bargeBlocks.map(x => x.id === id ? Object.assign({}, x, { reason: txt, updatedAt: Date.now() }) : x); },
      alive: (st, id) => (st.bargeBlocks || []).some(x => x.id === id),
      text: (st, id) => ((st.bargeBlocks || []).find(x => x.id === id) || {}).reason,
    },
    vessel: {
      create: (tag) => { addVessel({ name: 'MV ' + tag, type: 'VLSFO', qty: 100, mgo: 0, area: 'FUJ-A', lc: '', paq: 'no', eta: '' }); const cs = document.querySelectorAll('.vcard[id^="vessel-"]'); return cs[cs.length - 1].dataset.nomUid; },
      del: (id) => { const c = __card(id); if (c) document.getElementById('vessel-' + c).remove(); saveSharedState(); },
      edit: (id, txt) => { __remarks(id, txt); },
      alive: (st, id) => (st.vessels || []).some(x => x.nomUid === id),
      text: (st, id) => ((st.vessels || []).find(x => x.nomUid === id) || {}).remarks,
    },
    loading: {
      create: (tag) => { _loadingRecords.push({ id: 'ld_' + tag, barge: 'B1', terminal: 'T ' + tag, grade: 'VLSFO', qty: 1000, startAt: new Date(Date.now() + 80 * 3600e3).toISOString(), endAt: new Date(Date.now() + 90 * 3600e3).toISOString(), updatedAt: Date.now() }); return 'ld_' + tag; },
      del: (id) => { deleteLoadingRecord(id); },   // tombstone (deletedAt), as the app does
      edit: null,                                     // tombstone vs edit = newer updatedAt wins (not an absence case)
      alive: (st, id) => (st.loadingRecords || []).some(x => x.id === id && !x.deletedAt),
      text: null,
    },
  };
  const fnSrc = f => f.toString();
  const inPage = (page, kind, fn, ...args) => page.evaluate(([src, args]) => (new Function('return (' + src + ')'))()(...args), [fnSrc(KINDS[kind][fn]), args]);
  const aliveIn = (kind, st, id) => (new Function('return (' + fnSrc(KINDS[kind].alive) + ')'))()(st, id);
  const textIn = (kind, st, id) => (new Function('return (' + fnSrc(KINDS[kind].text) + ')'))()(st, id);

  async function runCase(kind, action, mode, i) {
    const tag = kind + '_' + action + '_' + mode + '_' + i + '_' + Date.now().toString(36);
    const label = `${kind}/${action}/${mode} #${i}`;
    // Seed: A creates the item, B pulls it.
    const id = await inPage(A.page, kind, 'create', tag);
    await A.page.evaluate(async () => { await saveSharedState(); await _waitForSaveIdle(); });
    await B.page.evaluate(async () => { await _waitForSaveIdle(); await _pollOnce(true); });
    const bHas = await B.page.evaluate(([src, id]) => (new Function('return (' + src + ')'))()(_buildLocalPayload().state, id), [fnSrc(KINDS[kind].alive), id]);
    if (!bHas || !aliveIn(kind, cloud().state, id)) { check(label + ': seeded on both devices', false, { bHas }); return; }

    // B deletes it.
    await inPage(B.page, kind, 'del', id);
    await B.page.evaluate(() => _waitForSaveIdle());
    const delOk = !aliveIn(kind, cloud().state, id);
    const mark = history.length;

    // A's concurrent change.
    const aText = 'A ' + tag;
    const change = async () => {
      if (action === 'unrelated') await A.page.evaluate(([u, t]) => __remarks(u, t), [keepUid, aText]);
      else if (action === 'edit') await inPage(A.page, kind, 'edit', id, aText);
      else await inPage(A.page, kind, 'del', id);
    };
    const startSave = () => A.page.evaluate(() => { window.__savePromise = saveSharedState(); });
    const finish = () => A.page.evaluate(async () => { await window.__savePromise; await _waitForSaveIdle(); __releaseAll(); });

    if (mode === 'stale') {
      await change(); await startSave(); await finish();
    } else if (mode === 'pulled') {
      await A.page.evaluate(() => _pollOnce(true));
      await change(); await startSave(); await finish();
    } else {
      // Pull in flight: the row is read (already without the item) but the
      // response is held until the save has started.
      await A.page.evaluate(() => { __gate('pull', "op.action === 'select' && op.table === 'abps_workspace'", 'after'); window.__pullPromise = _pollOnce(true); });
      await until(A.page, () => __gateHit('pull'));
      if (mode === 'race1') await A.page.evaluate(() => __gateSession('save-session'));
      else await A.page.evaluate(() => __gate('save-update', "op.action === 'update' && op.table === 'abps_workspace'", 'before'));
      await change(); await startSave();
      await sleep(40);  // let the save run as far as it can (into the held getSession / UPDATE)
      await A.page.evaluate(() => __release('pull'));
      await A.page.evaluate(() => window.__pullPromise);   // the pull has landed (applied + adopted its base)
      await A.page.evaluate(() => { __release('save-session'); __release('save-update'); });
      await finish();
    }
    await B.page.evaluate(() => _pollOnce(true));

    const st = cloud().state;
    const aSt = await A.page.evaluate(() => _buildLocalPayload().state);
    const bSt = await B.page.evaluate(() => _buildLocalPayload().state);
    const later = history.slice(mark);
    if (action === 'edit') {
      check(`${label}: edit vs delete — A's edit wins (cloud, A, B)`, delOk && textIn(kind, st, id) === aText && textIn(kind, aSt, id) === aText && textIn(kind, bSt, id) === aText,
        { delOk, cloud: textIn(kind, st, id), A: textIn(kind, aSt, id), B: textIn(kind, bSt, id) });
    } else {
      const back = later.filter(h => aliveIn(kind, h.payload.state || {}, id)).map(h => h.v);
      check(`${label}: deletion survives (cloud, A, B; never re-written)`, delOk && !aliveIn(kind, st, id) && !aliveIn(kind, aSt, id) && !aliveIn(kind, bSt, id) && back.length === 0,
        { delOk, cloud: aliveIn(kind, st, id), A: aliveIn(kind, aSt, id), B: aliveIn(kind, bSt, id), resurrectedInVersions: back });
      if (action === 'unrelated') {
        const rm = ((st.vessels || []).find(v => v.nomUid === keepUid) || {}).remarks;
        check(`${label}: A's unrelated edit kept`, rm === aText, rm);
      }
    }
    // Keep the workspace small across iterations: drop what this case left
    // behind (an edited item, loading tombstones), then let B catch up.
    if (action === 'edit') await inPage(A.page, kind, 'del', id);
    await A.page.evaluate(async () => { _loadingRecords = _loadingRecords.filter(r => !r.deletedAt); await saveSharedState(); await _waitForSaveIdle(); });
    await B.page.evaluate(() => _pollOnce(true));
  }

  const CASES = [];
  for (const kind of ['block', 'vessel', 'loading']) {
    for (const mode of ['stale', 'pulled', 'race1', 'race2']) CASES.push([kind, 'unrelated', mode]);
    if (KINDS[kind].edit) for (const mode of ['stale', 'race2']) CASES.push([kind, 'edit', mode]);
    for (const mode of ['stale', 'race2']) CASES.push([kind, 'both', mode]);
  }
  for (const [kind, action, mode] of CASES) {
    if (only && !`${kind}/${action}/${mode}`.includes(only)) continue;
    for (let i = 0; i < ITER; i++) {
      try { await runCase(kind, action, mode, i); }
      catch (e) {
        check(`${kind}/${action}/${mode} #${i} (threw)`, false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | '));
        await A.page.evaluate(() => window.__releaseAll && __releaseAll()).catch(() => {});
      }
    }
  }
  const errs = [].concat(A.errors, B.errors).filter(e => !/capacitorExports/.test(e));
  check('no page errors', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log(`RACE: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exit(2); });
