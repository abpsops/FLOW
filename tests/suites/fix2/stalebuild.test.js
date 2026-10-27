/* Stale builds: a tab / wallboard / the Android app left open across a deploy.
   (a) New version check
   • at load a fingerprint of the deployed index.html is noted (HEAD: ETag, else
     Last-Modified, else a hash of the whole file — that one at most hourly)
   • a new deploy is found on visibilitychange / focus → banner "A new version of
     FLOW is available — Reload"
   • reloads by itself only when safe (no unsaved / unsynced edit, no save in flight,
     no field focused, no dialog open), back on the same page without the welcome
     screen; otherwise the banner stays, and it reloads once it is safe
   • the banner's Reload saves a pending edit first
   • never in a loop: a fingerprint that changes on every request → one reload, then
     banner only; a second deploy within 30 minutes → banner only
   • offline: no requests at all
   (b) Fields of a NEWER build (keys this build doesn't know) on a vessel / barge
   • survive this build's edit + save, a merge with the newer build's save, a pull then
     save, the trader save path and trash → restore; a key the newer build removed is
     not brought back; a known optional field cleared here (sts, mmsi, a range) stays cleared
   node suites/fix2/stalebuild.test.js [appDir] */
const fs = require('fs');
const path = require('path');
if (process.argv[2]) process.env.APP_DIR = path.resolve(process.argv[2]); // util.js reads APP_DIR when loaded
const H = require('../../harness/harness.js');
const U = require('../r3/util.js');
const appDir = H.APP_DIR;

let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) pass++; else fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 600)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// index.html as the harness serves it (supabase-js is mocked → no SRI on that tag).
function appHtml() {
  return fs.readFileSync(path.join(appDir, 'index.html'), 'utf8').replace(/(<script[^>]*supabase-js@[^>]*?)\s+integrity="[^"]*"/, '$1');
}
// A host whose index.html headers / bytes the test controls: st.etag (string or fn),
// st.lastModified, st.suffix (appended to the HTML = "a new build"). st.log: requests.
function host(st) {
  st.log = []; st.loads = 0;
  return async (ctx, page) => {
    await page.route('**/index.html', route => {
      const req = route.request();
      st.log.push(req.method() + (req.isNavigationRequest() ? ':nav' : ''));
      const headers = { 'content-type': 'text/html; charset=utf-8' };
      const et = typeof st.etag === 'function' ? st.etag() : st.etag;
      if (et) headers.etag = et;
      if (st.lastModified) headers['last-modified'] = st.lastModified;
      return route.fulfill({ status: 200, headers, body: req.method() === 'HEAD' ? '' : appHtml() + (st.suffix || '') });
    });
    page.on('load', () => { st.loads++; });
  };
}
const openOp = (browser, db, st, extra) => U.open(browser, db, 'user-operator', Object.assign({ beforeLoad: host(st), onDialog: d => d.dismiss().catch(() => {}) }, extra || {}));

// In-page: hide the welcome screen, nothing focused.
const calm = page => page.evaluate(() => {
  const o = document.getElementById('flow-welcome-overlay'); if (o) o.style.display = 'none';
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
});
// Look for a new build the way the app does when it comes back into view / gets focus;
// with st, wait until that check has had its answer (unless a build was found already —
// then nothing is fetched and the decision is immediate).
async function trigger(page, how, st) {
  const heads = st ? st.log.filter(x => x === 'HEAD').length : 0;
  const found = await page.evaluate(how => {
    let f = false;
    try { _buildLastCheck = 0; f = !!_buildNewFp; } catch (e) {}
    if (how === 'focus') window.dispatchEvent(new Event('focus'));
    else document.dispatchEvent(new Event('visibilitychange'));
    return f;
  }, how || 'visible').catch(() => true);
  for (let i = 0; st && !found && i < 50; i++) {
    const busy = await page.evaluate(() => { try { return _buildChecking; } catch (e) { return false; } }).catch(() => false);
    if (st.log.filter(x => x === 'HEAD').length > heads && !busy) break;
    await sleep(100);
  }
}
// Resolves true if the page reloads within ms (then waits for the app to settle).
async function reloaded(page, ms) {
  const ok = await page.waitForEvent('load', { timeout: ms || 10000 }).then(() => true, () => false);
  if (ok) { await sleep(3000); await U.helpers({ page }); }
  return ok;
}
const banner = page => page.evaluate(() => {
  const b = document.getElementById('build-update-banner');
  return b && b.style.display !== 'none' ? { text: b.textContent, reload: !![...b.querySelectorAll('button')].find(x => /^Reload$/.test(x.textContent.trim())) } : null;
});
const pageState = page => page.evaluate(() => ({
  fp: typeof _buildFp === 'undefined' ? undefined : _buildFp,
  page: _currentPage,
  welcome: (document.getElementById('flow-welcome-overlay') || {}).style.display,
  mark: window.__mark,
}));
function noErrors(name, apps) {
  for (const a of apps) { const errs = U.realErrors(a); check(name + ': no page errors (' + errs.length + ')', errs.length === 0, errs.slice(0, 3)); }
}
async function scenario(name, fn) {
  try { await fn(); }
  catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
}
const v = (db, uid) => U.row(db).payload.state.vessels.find(x => x.nomUid === uid);

(async () => {
  const browser = await H.launch();

  /* A1 — ETag host: a deploy is found and the page reloads by itself (safe), on the same page */
  await scenario('A1', async () => {
    const st = { etag: '"v1"' };
    const db = H.createDb({ workspace: U.seedPayload() });
    const A = await openOp(browser, db, st); await U.helpers(A);
    const writes0 = U.writes(db, 'user-operator').length; // (a first load of the seed fills in the agent directory)
    check('A1 at load the deployed build is fingerprinted with a HEAD request (its ETag)', st.log.includes('HEAD') && (await pageState(A.page)).fp === '"v1"', [st.log, (await pageState(A.page)).fp]);
    check('A1 …and with an ETag the whole file is not downloaded again', st.log.filter(x => x === 'GET').length === 0, st.log);
    await calm(A.page);
    await A.page.evaluate(() => { showPage('schedule'); window.__mark = 1; });
    await trigger(A.page, 'visible', st);
    check('A1 same build → nothing happens (no banner, no reload)', !(await banner(A.page)) && st.loads === 1, [await banner(A.page), st.loads]);
    st.etag = '"v2"';
    await trigger(A.page, 'visible');
    const r1 = await reloaded(A.page, 10000);
    const s1 = await pageState(A.page);
    check('A1 a new deploy (ETag changed) found when the app comes back into view → reloads by itself when nothing can be lost', r1 && s1.mark === undefined && st.loads === 2, [r1, s1, st.loads]);
    check('A1 …back on the page that was on screen, without the welcome screen', s1.page === 'schedule' && s1.welcome !== 'flex', s1);
    check('A1 …now running (and fingerprinting) the new build', s1.fp === '"v2"' && !(await banner(A.page)), s1);
    // a second deploy within 30 minutes: banner only (never reloads in a loop)
    await calm(A.page);
    await A.page.evaluate(() => { window.__mark = 2; });
    st.etag = '"v3"';
    await trigger(A.page, 'focus', st);
    const r2 = await reloaded(A.page, 1500);
    const b2 = await banner(A.page);
    check('A1 a second deploy found on focus within 30 minutes of the last automatic reload → banner only, no reload', !r2 && b2 && /A new version of FLOW is available/.test(b2.text) && b2.reload, [r2, b2]);
    // the user's own Reload always works
    await A.page.evaluate(() => [...document.querySelectorAll('#build-update-banner button')].find(x => x.textContent.trim() === 'Reload').click());
    const r3 = await reloaded(A.page, 10000);
    const s3 = await pageState(A.page);
    check('A1 the banner\'s Reload reloads onto the new build, same page', r3 && s3.fp === '"v3"' && s3.page === 'schedule' && s3.mark === undefined, [r3, s3]);
    check('A1 no cloud write was caused by any of it', U.writes(db, 'user-operator').length === writes0, [writes0, U.writes(db, 'user-operator').length]);
    noErrors('A1', [A]);
    await A.ctx.close();
  });

  /* A2 — not safe → banner only; reloads once it is safe */
  await scenario('A2', async () => {
    const st = { etag: '"a1"' };
    const db = H.createDb({ workspace: U.seedPayload() });
    const A = await openOp(browser, db, st); await U.helpers(A);
    await calm(A.page);
    await A.page.evaluate(() => { showPage('nominations'); window.__mark = 1; __setV('n1', 'agent', 'PENDING AG'); }); // typed, not saved yet
    st.etag = '"a2"';
    await trigger(A.page, 'visible', st);
    let r = await reloaded(A.page, 1500);
    const b = await banner(A.page);
    check('A2 an edit not saved yet → banner "A new version of FLOW is available — Reload", no reload', !r && b && /A new version of FLOW is available/.test(b.text) && b.reload && (await pageState(A.page)).mark === 1, [r, b]);
    await A.page.evaluate(() => saveSharedState());
    check('A2 (the edit is then saved)', v(db, 'n1').agent === 'PENDING AG', v(db, 'n1').agent);
    await A.page.evaluate(() => { const id = __cardFor('n1'); document.getElementById('v' + id + '-remarks').focus(); });
    await trigger(A.page, 'focus');
    r = await reloaded(A.page, 1500);
    check('A2 a field focused → still banner only', !r && !!(await banner(A.page)), r);
    await A.page.evaluate(() => { document.activeElement.blur(); document.getElementById('agent-modal').style.display = 'flex'; });
    await trigger(A.page);
    r = await reloaded(A.page, 1500);
    check('A2 a dialog open → still banner only', !r && !!(await banner(A.page)), r);
    await A.page.evaluate(() => { document.getElementById('agent-modal').style.display = 'none'; _markUnsynced(true); });
    await trigger(A.page);
    r = await reloaded(A.page, 1500);
    check('A2 changes the cloud hasn\'t got (unsynced) → still banner only', !r, r);
    await A.page.evaluate(() => { _markUnsynced(false); window.__saveHeld = new Promise(() => {}); _saveRunning = window.__saveHeld; });
    await trigger(A.page);
    r = await reloaded(A.page, 1500);
    check('A2 a save in flight → still banner only', !r, r);
    await A.page.evaluate(() => { _saveRunning = null; showPage('loading'); document.getElementById('ld-qty').value = '2500'; document.getElementById('ld-surveyor').value = 'SGS'; });
    await trigger(A.page);
    r = await reloaded(A.page, 1500);
    check('A2 the Loading form half filled in (not saved) → still banner only', !r && (await A.page.evaluate(() => document.getElementById('ld-qty').value)) === '2500', r);
    await A.page.evaluate(() => { document.getElementById('ld-qty').value = ''; document.getElementById('ld-surveyor').value = ''; const up = document.getElementById('btr-upload-btn'); up.disabled = true; });
    await trigger(A.page);
    r = await reloaded(A.page, 1500);
    check('A2 a report upload on its way → still banner only', !r, r);
    await A.page.evaluate(() => { document.getElementById('btr-upload-btn').disabled = false; showPage('nominations'); });
    await trigger(A.page, 'focus');
    r = await reloaded(A.page);
    const s = await pageState(A.page);
    check('A2 once nothing can be lost → reloads by itself, same page, the saved edit is there', r && s.mark === undefined && s.page === 'nominations' && (await A.page.evaluate(() => __getV('n1', 'agent'))) === 'PENDING AG', [r, s]);
    noErrors('A2', [A]);
    await A.ctx.close();
  });

  /* A3 — the banner's Reload saves a pending edit first */
  await scenario('A3', async () => {
    const st = { etag: '"b1"' };
    const db = H.createDb({ workspace: U.seedPayload() });
    const A = await openOp(browser, db, st); await U.helpers(A);
    await calm(A.page);
    await A.page.evaluate(() => { __setV('n2', 'agent', 'BUTTON AG'); });
    st.etag = '"b2"';
    await trigger(A.page, 'visible', st);
    check('A3 banner shown (an edit is pending)', !!(await banner(A.page)) && st.loads === 1, st.loads);
    await A.page.evaluate(() => [...document.querySelectorAll('#build-update-banner button')].find(x => x.textContent.trim() === 'Reload').click());
    const r = await reloaded(A.page);
    check('A3 Reload saved the pending edit to the shared workspace before reloading', r && v(db, 'n2').agent === 'BUTTON AG', [r, v(db, 'n2').agent]);
    check('A3 …and it is on the card after the reload', (await A.page.evaluate(() => __getV('n2', 'agent'))) === 'BUTTON AG');
    noErrors('A3', [A]);
    await A.ctx.close();
  });

  /* A4 — a host whose fingerprint changes on every request: one reload, never a loop */
  await scenario('A4', async () => {
    let n = 0;
    const st = { etag: () => '"r' + (++n) + '"' };
    const db = H.createDb({ workspace: U.seedPayload() });
    const A = await openOp(browser, db, st); await U.helpers(A);
    await calm(A.page);
    await trigger(A.page, 'visible'); // (no waiting here: the reload must not be missed)
    const r1 = await reloaded(A.page, 10000);
    check('A4 first change → one automatic reload', r1 && st.loads === 2, [r1, st.loads]);
    for (let i = 0; i < 4; i++) {
      await calm(A.page);
      await trigger(A.page, i % 2 ? 'focus' : 'visible', st);
    }
    const r2 = await reloaded(A.page, 2000);
    const rec = await A.page.evaluate(() => JSON.parse(sessionStorage.getItem('flow_build_reload') || 'null'));
    check('A4 the reload did not land on the build it was for → no more automatic reloads (banner only)', !r2 && st.loads === 2 && !!(await banner(A.page)) && rec && rec.off === true, [r2, st.loads, rec]);
    noErrors('A4', [A]);
    await A.ctx.close();
  });

  /* A5 — offline: no requests; online again → the check works */
  await scenario('A5', async () => {
    const st = { etag: '"o1"' };
    const db = H.createDb({ workspace: U.seedPayload() });
    const A = await openOp(browser, db, st); await U.helpers(A);
    await calm(A.page);
    await A.ctx.setOffline(true);
    st.log.length = 0; st.etag = '"o2"';
    await trigger(A.page); await trigger(A.page, 'focus');
    await A.page.evaluate(() => { try { _buildCheck(true); } catch (e) {} });
    await sleep(1500);
    check('A5 offline: no request for index.html at all, no banner', st.log.length === 0 && !(await banner(A.page)), st.log);
    await A.ctx.setOffline(false);
    await A.page.evaluate(() => { __setV('n1', 'agent', 'KEEP'); }); // not safe → banner only
    await trigger(A.page, 'visible', st);
    check('A5 back online → the new deploy is found (banner)', st.log.includes('HEAD') && !!(await banner(A.page)) && st.loads === 1, [st.log, st.loads]);
    noErrors('A5', [A]);
    await A.ctx.close();
  });

  /* A6 — no ETag / Last-Modified: hash of the whole file, at most hourly; Last-Modified alone */
  await scenario('A6', async () => {
    const st = { etag: null };
    const db = H.createDb({ workspace: U.seedPayload() });
    const A = await openOp(browser, db, st); await U.helpers(A);
    await calm(A.page);
    const fp0 = (await pageState(A.page)).fp;
    check('A6 no ETag / Last-Modified → fingerprint = hash of the file (HEAD, then one GET)', typeof fp0 === 'string' && fp0[0] === '#' && st.log.filter(x => x === 'GET').length === 1 && st.log.includes('HEAD'), [fp0, st.log]);
    await A.page.evaluate(() => { __setV('n1', 'agent', 'KEEP'); }); // not safe → banner only
    st.suffix = '\n<!-- a new build -->\n';
    st.log.length = 0;
    await trigger(A.page, 'visible', st);
    check('A6 within the hour: only the cheap HEAD, the file is not downloaded again', st.log.join() === 'HEAD' && !(await banner(A.page)), st.log);
    await A.page.evaluate(() => { _buildLastHash = 0; });
    await trigger(A.page, 'focus', st);
    check('A6 an hour on: the file is hashed again and the new build is found (banner)', st.log.includes('GET') && !!(await banner(A.page)) && st.loads === 1, [st.log, st.loads]);
    noErrors('A6', [A]);
    await A.ctx.close();

    const st2 = { etag: null, lastModified: 'Mon, 26 Oct 2026 10:00:00 GMT' };
    const B = await openOp(browser, H.createDb({ workspace: U.seedPayload() }), st2); await U.helpers(B);
    await calm(B.page);
    check('A6 Last-Modified alone is used as the fingerprint (no GET)', (await pageState(B.page)).fp === st2.lastModified && !st2.log.includes('GET'), [await pageState(B.page), st2.log]);
    await B.page.evaluate(() => { __setV('n1', 'agent', 'KEEP'); });
    st2.lastModified = 'Tue, 27 Oct 2026 09:00:00 GMT';
    await trigger(B.page, 'visible', st2);
    check('A6 …and a newer Last-Modified is a new build (banner)', !!(await banner(B.page)), await pageState(B.page));
    noErrors('A6 (Last-Modified)', [B]);
    await B.ctx.close();
  });

  /* B — fields written by a newer build survive this build's saves */
  await scenario('B', async () => {
    const seed = U.seedPayload();
    Object.assign(seed.state.vessels[0], { berthSlot: 'B7', futureObj: { a: 1, b: [2, 3] }, sts: true, mmsi: '636012345', qty: 500, qtyMin: 450, qtyMax: 500 });
    seed.state.barges[0].futureBarge = 'X1';
    const db = H.createDb({ workspace: seed, realtime: false });
    const A = await U.open(browser, db, 'user-operator', { onDialog: d => d.dismiss().catch(() => {}) }); await U.helpers(A);
    check('B the save made while loading (the seed\'s agent directory) keeps the unknown fields', U.writes(db, 'user-operator').length >= 1 && v(db, 'n1').berthSlot === 'B7' && U.row(db).payload.state.barges[0].futureBarge === 'X1', v(db, 'n1'));
    const B = await U.open(browser, db, 'user-operator2'); await U.helpers(B);
    check('B a second operator loading the row with unknown fields makes no write (no ping-pong)', U.writes(db, 'user-operator2').length === 0, U.writes(db, 'user-operator2').length);
    await B.ctx.close();
    // 1. edit + save (plain compare-and-swap, no conflict)
    await A.page.evaluate(() => { __setV('n1', 'agent', 'AG-EDIT'); return saveSharedState(); });
    let n1 = v(db, 'n1');
    check('B1 this build edits + saves the vessel → the newer build\'s fields on it are kept', n1.agent === 'AG-EDIT' && n1.berthSlot === 'B7' && JSON.stringify(n1.futureObj) === '{"a":1,"b":[2,3]}', n1);
    check('B1 …and on the barge', U.row(db).payload.state.barges[0].futureBarge === 'X1', U.row(db).payload.state.barges[0]);
    check('B1 …and the known optional fields as they were', n1.sts === true && n1.mmsi === '636012345' && n1.qtyMin === 450 && n1.qtyMax === 500, n1);
    // 2. known optional fields cleared here stay cleared
    await A.page.evaluate(() => {
      const id = __cardFor('n1');
      const b = document.getElementById('v' + id + '-sts'); b.checked = false; b.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('v' + id + '-mmsi').value = '';
      document.getElementById('v' + id + '-vlsfo').value = '480';
      return saveSharedState();
    });
    await A.page.evaluate(() => saveSharedState());
    n1 = v(db, 'n1');
    check('B2 sts unticked, MMSI cleared, range → single quantity: they stay cleared (not carried over)', !('sts' in n1) && !('mmsi' in n1) && !('qtyMin' in n1) && !('qtyMax' in n1) && n1.qty === 480, n1);
    check('B2 …while the unknown fields stay', n1.berthSlot === 'B7' && !!n1.futureObj, n1);
    // 3. a newer build saves a new field meanwhile; this copy (not pulled) saves → merge
    const row = U.row(db);
    const p = JSON.parse(JSON.stringify(row.payload));
    const pn2 = p.state.vessels.find(x => x.nomUid === 'n2'); pn2.berthSlot = 'C1'; pn2.remarks = 'from the new build';
    p.state.barges[0].futureBarge = 'X2';
    p.version = p.state.version = Date.now() + 5000; row.payload = p; row.version = p.version; row.updated_at = new Date().toISOString();
    await A.page.evaluate(() => { __setV('n2', 'agent', 'AG2-EDIT'); return saveSharedState(); });
    let n2 = v(db, 'n2');
    check('B3 merge with a newer build\'s save: its new field and edit survive this copy\'s save', n2.berthSlot === 'C1' && n2.remarks === 'from the new build' && n2.agent === 'AG2-EDIT', n2);
    check('B3 …the barge field the newer build changed too', U.row(db).payload.state.barges[0].futureBarge === 'X2', U.row(db).payload.state.barges[0]);
    // 4. the newer build writes a field, this copy pulls, then saves something else (no conflict)
    const row4 = U.row(db), p4 = JSON.parse(JSON.stringify(row4.payload));
    p4.state.vessels.find(x => x.nomUid === 'n1').laterKey = 7;
    p4.version = p4.state.version = Date.now() + 10000; row4.payload = p4; row4.version = p4.version;
    await A.page.evaluate(() => _pollOnce(true));
    await A.page.evaluate(() => { __setV('n2', 'agent', 'AG2-AGAIN'); return saveSharedState(); });
    n1 = v(db, 'n1');
    check('B4 pulled, then an unrelated save: the newer build\'s field is kept', n1.laterKey === 7 && v(db, 'n2').agent === 'AG2-AGAIN', n1);
    // 5. the newer build removes its fields → not brought back
    const row5 = U.row(db), p5 = JSON.parse(JSON.stringify(row5.payload));
    const p5n1 = p5.state.vessels.find(x => x.nomUid === 'n1'); delete p5n1.laterKey; delete p5n1.futureObj;
    p5.version = p5.state.version = Date.now() + 15000; row5.payload = p5; row5.version = p5.version;
    await A.page.evaluate(() => _pollOnce(true));
    await A.page.evaluate(() => { __setV('n1', 'remarks', 'r5'); return saveSharedState(); });
    n1 = v(db, 'n1');
    check('B5 a field the newer build removed is not brought back by this copy', !('laterKey' in n1) && !('futureObj' in n1) && n1.berthSlot === 'B7' && n1.remarks === 'r5', n1);
    // 6. trader save path (RPC)
    const T = await U.open(browser, db, 'user-trader'); await U.helpers(T);
    await T.page.evaluate(() => { __setV('n1', 'remarks', 'trader edit'); return saveSharedState(); });
    n1 = v(db, 'n1'); n2 = v(db, 'n2');
    check('B6 a trader\'s save keeps the newer build\'s fields', n1.remarks === 'trader edit' && n1.berthSlot === 'B7' && n2.berthSlot === 'C1', [n1, n2]);
    // 7. trash → restore
    await A.page.evaluate(() => _pollOnce(true));
    await A.page.evaluate(async () => { rmV(__cardFor('n1')); await new Promise(r => setTimeout(r, 600)); await saveSharedState(); });
    const gone = !v(db, 'n1');
    await A.page.evaluate(async () => { restoreFromTrash(_trashBin.findIndex(e => e.def && e.def.nomUid === 'n1')); await saveSharedState(); });
    n1 = v(db, 'n1');
    check('B7 removed to the Trash and restored: the newer build\'s field comes back with it', gone && n1 && n1.berthSlot === 'B7' && n1.remarks === 'trader edit', [gone, n1]);
    noErrors('B', [A, T]);
    await A.ctx.close(); await T.ctx.close();
  });

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
