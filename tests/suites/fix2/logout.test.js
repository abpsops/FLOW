/* Log Out and the sync-failure banner.
   • the banner never tells people to sign out to fix a sync problem (Log Out wipes the only copy
     of unsynced edits); it says Retry, then reload, then contact the operations lead
   • Log Out with edits the cloud hasn't got: tries one save first; if it still fails, the confirm
     says how many unsynced changes will be lost. Cancel keeps the session and the edits; OK logs out
     and still clears the device (shared computers)
   • an edit whose debounced save hasn't fired yet is saved before the wipe (operator and trader)
   • signOut is scope 'local': a second device on the same login stays signed in and can still save
     (global-scope revocation is emulated in this test — the harness mock ignores the scope)
   • offline: a logout with offline edits warns; an offline launch without the library still logs out
   node suites/fix2/logout.test.js [appDir] */
const path = require('path');
const appDir = path.resolve(process.argv[2] || process.env.APP_DIR || path.join(__dirname, '..', '..', '..'));
process.env.APP_DIR = appDir; // r3/util.js reads it
const H = require('../../harness/harness.js');
const U = require('../r3/util.js');

let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) pass++; else fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 600)));
}
const JWT = { data: null, error: { message: 'JWT expired', code: 'PGRST301' } };
const isWrite = op => op.table === 'abps_workspace' && ['update', 'insert', 'upsert'].includes(op.action);
// The failures this suite injects are logged by the app on purpose; anything else counts.
const pageErrors = app => app.errors.filter(e => !/capacitorExports/.test(e) && !/saveSharedState failed: .*JWT expired/.test(e));

// Opens a device whose dialogs are recorded and answered by dlg.mode ('accept' / 'dismiss').
async function device(browser, db, uid, extra) {
  const dlg = { mode: 'accept', seen: [] };
  const app = await H.openApp(browser, db, Object.assign({ appDir, uid, onDialog: d => { dlg.seen.push(d.message()); (dlg.mode === 'dismiss' ? d.dismiss() : d.accept()).catch(() => {}); } }, extra || {}));
  await U.helpers(app);
  app.dlg = dlg;
  // Every signOut call reaches Node with its arguments (before the real one runs).
  app.signOuts = [];
  app.onSignOut = null;
  await app.ctx.exposeFunction('__soCall', async s => { const a = JSON.parse(s); app.signOuts.push(a); if (app.onSignOut) await app.onSignOut(a); });
  await app.page.evaluate(() => {
    if (!supabaseClient) return;
    const so = supabaseClient.auth.signOut;
    supabaseClient.auth.signOut = function () { const self = this, args = arguments; return window.__soCall(JSON.stringify(args[0] === undefined ? null : args[0])).then(() => so.apply(self, args)); };
  });
  return app;
}
// Shows the login gate on the next load (the mock signs every fresh page in otherwise).
async function gateAfterReload(app) {
  await app.ctx.addInitScript(() => { if (sessionStorage.getItem('__loggedOut')) window.__mockSignedOut = true; });
  await app.page.evaluate(() => sessionStorage.setItem('__loggedOut', '1'));
}
async function logoutAndReload(app) {
  await Promise.all([app.page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }), app.page.evaluate(() => { operatorLogout(); })]);
  await app.page.waitForTimeout(1500);
}
// flow_build_* is the build fingerprint the next load writes again — no user data, so it is not counted
const localCopy = page => page.evaluate(() => {
  const keys = Object.keys(localStorage);
  const st = keys.find(k => /^flow_state_/.test(k)), un = keys.find(k => /^flow_unsynced_/.test(k));
  return { state: st ? localStorage.getItem(st) : null, unsynced: un ? localStorage.getItem(un) : null, flowKeys: keys.filter(k => /^(flow_|abps_last_login|sb-)/.test(k) && !/^flow_build_/.test(k)).length };
});
const sessionOf = page => page.evaluate(async () => { const r = await supabaseClient.auth.getSession(); return !!(r && r.data && r.data.session); });
const gateShown = page => page.evaluate(() => getComputedStyle(document.getElementById('operator-gate')).display !== 'none');
const vesselIn = (db, nomUid) => (((U.row(db) || {}).payload || {}).state || {}).vessels.find(v => v.nomUid === nomUid) || {};

(async () => {
  const browser = await H.launch();
  try {
    /* T1 — operator, session dead (every write 'JWT expired'): banner, then Log Out → Cancel, then Log Out → OK */
    {
      const db = H.createDb({ workspace: U.seedPayload() });
      const A = await device(browser, db, 'user-operator');
      await A.page.waitForTimeout(1000);
      db.intercept = op => (isWrite(op) ? JWT : null);
      const saved = await A.page.evaluate(() => { __setV('n1', 'agent', 'LOST-1'); __setV('n2', 'remarks', 'LOST-2'); return saveSharedState(); });
      const banner = await A.page.evaluate(() => { const b = document.getElementById('sync-warning-banner'); return { shown: !!b && b.style.display !== 'none', text: b ? b.textContent : '', detail: (document.getElementById('sync-warning-detail') || {}).textContent || '' }; });
      check('T1 the failed save shows the sync banner and marks the device unsynced', saved === false && banner.shown && (await localCopy(A.page)).unsynced === '1', { saved, banner });
      check('T1 the banner no longer tells people to sign out / log out', !/sign(ing)?[ -]?out|log(ging)?[ -]?out|sign .*back in/i.test(banner.text), banner.detail);
      check('T1 the banner says Retry, then reload (changes stay on this device), then who to contact', /Retry/.test(banner.detail) && /reload the page/i.test(banner.detail) && /stay on this device/i.test(banner.detail) && /operations lead|support/i.test(banner.detail), banner.detail);

      // Log Out → Cancel
      A.dlg.mode = 'dismiss'; A.dlg.seen = [];
      const tries0 = U.writes(db, 'user-operator').length;
      await A.page.evaluate(() => { window.__notReloaded = 1; });
      await A.page.evaluate(() => operatorLogout());
      const tries1 = U.writes(db, 'user-operator').length;
      check('T1 Log Out first tries to save the unsynced edits once more', tries1 > tries0, { tries0, tries1 });
      check('T1 one confirm, and it says plainly that 2 unsynced changes will be lost', A.dlg.seen.length === 1 && /2 unsynced changes/.test(A.dlg.seen[0]) && /\blose/i.test(A.dlg.seen[0]) && /never reached the shared workspace/i.test(A.dlg.seen[0]), A.dlg.seen);
      check('T1 the warning tells them how to keep the changes (Retry / reload)', /Retry/.test(A.dlg.seen[0] || '') && /reload the page/i.test(A.dlg.seen[0] || ''), A.dlg.seen);
      const kept = await A.page.evaluate(() => ({ noReload: window.__notReloaded === 1, n1: __getV('n1', 'agent'), n2: __getV('n2', 'remarks') }));
      const lc = await localCopy(A.page);
      check('T1 Cancel: no sign-out, the session is still there, the page did not reload', A.signOuts.length === 0 && (await sessionOf(A.page)) && kept.noReload, { signOuts: A.signOuts, kept });
      check('T1 Cancel: the edits are still on screen and in this device\'s storage (still flagged unsynced)', kept.n1 === 'LOST-1' && kept.n2 === 'LOST-2' && lc.unsynced === '1' && /LOST-1/.test(lc.state || '') && /LOST-2/.test(lc.state || ''), { kept, unsynced: lc.unsynced });
      check('T1 Cancel: the cloud still does not have them (nothing pretended to sync)', vesselIn(db, 'n1').agent === 'AG1', vesselIn(db, 'n1'));

      // Log Out → OK
      A.dlg.mode = 'accept'; A.dlg.seen = [];
      await gateAfterReload(A);
      await logoutAndReload(A);
      check('T1 OK: the confirm accepted was the unsynced-changes warning', A.dlg.seen.length === 1 && /2 unsynced changes/.test(A.dlg.seen[0]), A.dlg.seen);
      check('T1 OK: signs out THIS device only (scope local)', A.signOuts.length === 1 && A.signOuts[0] && A.signOuts[0].scope === 'local', A.signOuts);
      const after = await localCopy(A.page);
      check('T1 OK: logged out — login gate shown and the device copy cleared (shared computers)', (await gateShown(A.page)) && after.state === null && after.unsynced === null && after.flowKeys === 0, after);
      check('T1 no page errors', pageErrors(A).length === 0, pageErrors(A).slice(0, 3));
      await A.ctx.close();
    }

    /* T2 — the save failed earlier but the cloud accepts it again by the time Log Out is pressed */
    {
      const db = H.createDb({ workspace: U.seedPayload() });
      const A = await device(browser, db, 'user-operator');
      await A.page.waitForTimeout(1000);
      db.intercept = op => (isWrite(op) ? JWT : null);
      await A.page.evaluate(() => { __setV('n1', 'agent', 'SAVED-AT-LOGOUT'); return saveSharedState(); });
      db.intercept = null; // e.g. the session was refreshed meanwhile
      A.dlg.seen = [];
      await logoutAndReload(A);
      check('T2 Log Out saves the pending edit before wiping the device', vesselIn(db, 'n1').agent === 'SAVED-AT-LOGOUT', vesselIn(db, 'n1'));
      check('T2 nothing is lost, so the usual logout confirm is shown (no false alarm)', A.dlg.seen.length === 1 && /^Log out of the shared FLOW workspace on this device\?/.test(A.dlg.seen[0]), A.dlg.seen);
      await A.ctx.close();
    }

    /* T3 — an edit typed a moment ago (its 1.5 s debounced save hasn't fired) is saved before the wipe */
    {
      const db = H.createDb({ workspace: U.seedPayload() });
      const A = await device(browser, db, 'user-operator');
      await A.page.waitForTimeout(1000);
      await A.page.evaluate(() => { const el = document.getElementById('v' + __cardFor('n2') + '-agent'); el.value = 'JUST-TYPED'; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await logoutAndReload(A);
      check('T3 operator: the just-typed edit reached the cloud before logout', vesselIn(db, 'n2').agent === 'JUST-TYPED', vesselIn(db, 'n2'));
      await A.ctx.close();
    }

    /* T4 — two devices on the same login; one logs out. A global sign-out (the old default) is emulated
       the way GoTrue applies it: every other session of that user is revoked, so its requests are
       refused and supabase-js drops its session. */
    {
      const db = H.createDb({ workspace: U.seedPayload() });
      const A = await device(browser, db, 'user-operator');
      const B = await device(browser, db, 'user-operator');
      await B.page.waitForTimeout(1000);
      let revoked = false;
      A.onSignOut = async a => {
        if (a && (a.scope === 'local' || a.scope === 'others')) return;
        revoked = true;
        db.intercept = op => (op.uid === 'user-operator' ? JWT : null);
        await B.page.evaluate(() => { const so = supabaseClient.auth.signOut; return so.call(supabaseClient.auth); }); // B's session dropped
      };
      await gateAfterReload(A);
      await logoutAndReload(A);
      check('T4 device A signed out with scope local', A.signOuts.length === 1 && A.signOuts[0] && A.signOuts[0].scope === 'local', A.signOuts);
      check('T4 device A is logged out (login gate)', await gateShown(A.page));
      await A.ctx.close();
      check('T4 device B (same login) is still signed in', !revoked && (await sessionOf(B.page)), { revoked });
      const ok = await B.page.evaluate(() => { __setV('n1', 'agent', 'FROM-B'); return saveSharedState(); });
      const bBanner = await B.page.evaluate(() => { const b = document.getElementById('sync-warning-banner'); return !!b && b.style.display !== 'none'; });
      check('T4 device B can still save after A logged out', ok === true && vesselIn(db, 'n1').agent === 'FROM-B' && !bBanner, { ok, agent: vesselIn(db, 'n1').agent, bBanner });
      check('T4 device B no page errors', pageErrors(B).length === 0, pageErrors(B).slice(0, 3));
      await B.ctx.close();
    }

    /* T5 — trader: debounced edit saved via the trader RPC before logout; a failing RPC warns */
    {
      const db = H.createDb({ workspace: U.seedPayload() });
      const T = await device(browser, db, 'user-trader');
      await T.page.waitForTimeout(1000);
      await T.page.evaluate(() => { const el = document.getElementById('v' + __cardFor('n1') + '-remarks'); el.value = 'TRADER-NOTE'; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await gateAfterReload(T);
      await logoutAndReload(T);
      check('T5 trader: the just-typed nomination edit reached the cloud before logout', vesselIn(db, 'n1').remarks === 'TRADER-NOTE', vesselIn(db, 'n1'));
      check('T5 trader: usual confirm, scope local, logged out and device cleared', T.dlg.seen.length === 1 && /^Log out of the shared FLOW/.test(T.dlg.seen[0]) && T.signOuts.length === 1 && T.signOuts[0] && T.signOuts[0].scope === 'local' && (await gateShown(T.page)) && (await localCopy(T.page)).flowKeys === 0, { seen: T.dlg.seen, so: T.signOuts });
      check('T5 trader no page errors', pageErrors(T).length === 0, pageErrors(T).slice(0, 3));
      await T.ctx.close();

      const T2 = await device(browser, db, 'user-trader');
      await T2.page.waitForTimeout(1000);
      db.intercept = op => (op.action === 'rpc' && op.name === 'trader_update_vessels' ? JWT : null);
      await T2.page.evaluate(() => { __setV('n2', 'remarks', 'TRADER-UNSYNCED'); return saveSharedState(); });
      T2.dlg.mode = 'dismiss'; T2.dlg.seen = [];
      await T2.page.evaluate(() => operatorLogout());
      check('T5 trader with a failing save: warned that 1 unsynced change will be lost', T2.dlg.seen.length === 1 && /1 unsynced change\b/.test(T2.dlg.seen[0]) && /\blose/i.test(T2.dlg.seen[0]), T2.dlg.seen);
      check('T5 trader Cancel keeps the session and the edit', T2.signOuts.length === 0 && (await sessionOf(T2.page)) && (await T2.page.evaluate(() => __getV('n2', 'remarks'))) === 'TRADER-UNSYNCED' && (await localCopy(T2.page)).unsynced === '1');
      db.intercept = null;
      await T2.ctx.close();
    }

    /* T6 — offline */
    {
      // (a) cloud unreachable while working: the offline edit is not wiped silently
      const db = H.createDb({ workspace: U.seedPayload() });
      const A = await device(browser, db, 'user-operator');
      await A.page.waitForTimeout(1000);
      db.intercept = op => (op.table === 'abps_workspace' ? { data: null, error: { message: 'TypeError: Failed to fetch' } } : null);
      await A.page.evaluate(() => { __setV('n1', 'remarks', 'OFFLINE-EDIT'); return saveSharedState(); });
      A.dlg.mode = 'dismiss'; A.dlg.seen = [];
      await A.page.evaluate(() => operatorLogout());
      check('T6 offline edit: Log Out warns that 1 unsynced change will be lost', A.dlg.seen.length === 1 && /1 unsynced change\b/.test(A.dlg.seen[0]), A.dlg.seen);
      check('T6 offline edit: Cancel keeps it', A.signOuts.length === 0 && /OFFLINE-EDIT/.test((await localCopy(A.page)).state || ''));
      A.dlg.mode = 'accept';
      await gateAfterReload(A);
      await logoutAndReload(A);
      check('T6 offline edit: OK still logs out (scope local) and clears the device', A.signOuts.length === 1 && A.signOuts[0] && A.signOuts[0].scope === 'local' && (await gateShown(A.page)) && (await localCopy(A.page)).flowKeys === 0, A.signOuts);
      await A.ctx.close();

      // (b) offline launch where the Supabase library could not load at all (supabaseClient is null)
      const lsSeed = { abps_last_login_v1: JSON.stringify({ uid: 'user-operator', at: '2026-10-01T00:00:00Z' }), abps_role_cache_v1: JSON.stringify({ uid: 'user-operator', role: 'operator' }) };
      const O = await device(browser, H.createDb(), 'user-operator', { localStorage: lsSeed, settleMs: 0 });
      await O.ctx.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false, configurable: true }); });
      await O.ctx.route(/supabase-js@[^/]+\/dist\/umd\/supabase\.js/, r => r.abort());
      await O.page.reload({ waitUntil: 'load' });
      await O.page.waitForTimeout(3000);
      const off = await O.page.evaluate(() => ({ offline: _flowOfflineLaunch, client: !!supabaseClient, gate: getComputedStyle(document.getElementById('operator-gate')).display }));
      check('T6 offline launch without the library opens in offline mode', off.offline === true && off.client === false && off.gate === 'none', off);
      O.dlg.seen = [];
      await logoutAndReload(O);
      const left = await O.page.evaluate(() => Object.keys(localStorage).filter(k => /^(flow_|abps_last_login|abps_role_cache|sb-)/.test(k)));
      check('T6 offline launch: Log Out still works (usual confirm, device cleared, login gate)', O.dlg.seen.length === 1 && /^Log out of the shared FLOW/.test(O.dlg.seen[0]) && left.length === 0 && (await gateShown(O.page)), { seen: O.dlg.seen, left });
      const uncaught = O.errors.filter(e => /^pageerror/.test(e) && !/capacitorExports/.test(e));
      check('T6 offline launch: no uncaught page errors', uncaught.length === 0, uncaught.slice(0, 3));
      await O.ctx.close();
    }
  } catch (e) {
    check('threw', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | '));
  } finally {
    await browser.close();
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  }
})().catch(e => { console.error(e); process.exit(1); });
