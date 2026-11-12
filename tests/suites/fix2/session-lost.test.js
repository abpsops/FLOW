/* The sign-in expires while the app is open (a tab left open overnight; seen on 12 Nov 2026:
   "cloud sync failed: new row violates row-level security policy").
   Signed out, the cloud answers every read with "no workspace" and refuses every save, so the
   app took the shared workspace for empty and tried to create a new one. Now:
   • no cloud call is made without a sign-in — the sign-in form comes up over the app, saying
     the changes on this device are kept; the shared workspace is not touched (no insert)
   • a pull while signed out fails instead of treating the workspace as empty
   • a SIGNED_OUT reported by the auth library brings the form up too
   • signing in again resumes the app (no restart): this device's change is merged and saved,
     a colleague's change made meanwhile is kept, live updates restart
   node suites/fix2/session-lost.test.js [appDir] */
const path = require('path');
if (process.argv[2]) process.env.APP_DIR = path.resolve(process.argv[2]);
const U = require('../r3/util.js');
const H = U.H;

let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) pass++; else fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 900)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const writes = (db, kind) => db.log.filter(o => o.table === 'abps_workspace' && ['insert', 'upsert', 'update'].includes(o.action) && (!kind || o.action === kind));

async function scenario(browser, name, fn) {
  const apps = [];
  try { await fn(async (db, uid) => { const a = await U.open(browser, db, uid || 'user-operator'); await U.helpers(a); await a.page.evaluate(() => { try { flowWelcomeGo('dashboard'); } catch (e) {} window.__dialogs = []; window.alert = m => window.__dialogs.push(String(m)); window.confirm = () => true; }); apps.push(a); return a; }); }
  catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
  const errs = [].concat(...apps.map(a => U.realErrors(a)));
  check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
  for (const a of apps) await a.ctx.close();
}
const gate = p => p.evaluate(() => { const g = document.getElementById('operator-gate'); return { shown: !!g && getComputedStyle(g).display !== 'none', msg: (document.getElementById('og-error') || {}).textContent || '' }; });
const signIn = p => p.evaluate(async () => {
  document.getElementById('og-email').value = 'ops@test'; document.getElementById('og-password').value = 'x';
  await _handleOperatorLogin({ preventDefault() {} });
  await new Promise(r => setTimeout(r, 900)); await _waitForSaveIdle();
});

(async () => {
  const browser = await H.launch();

  await scenario(browser, 'S1 save after the sign-in expired', async (openT) => {
    const db = H.createDb({ workspace: U.seedPayload({}), realtime: false });
    const A = await openT(db);
    const before = await gate(A.page);
    check('S1 signed in: no sign-in form over the app', !before.shown, before);
    const v0 = U.row(db).version, w0 = writes(db).length;
    const r = await A.page.evaluate(async () => {
      window.__mockSessionExpire(false); // the stored session is gone, nothing announced it
      addVessel({ name: 'NIGHT SHIFT', nomUid: 'nx', type: 'VLSFO', qty: 300, eta: '20 Nov 2026 08:00' });
      const ok = await saveSharedState();
      return { ok, synced: !!_lastSyncedPayload, unsynced: _isMarkedUnsynced(), card: !!__cardFor('nx') };
    });
    const g = await gate(A.page);
    check('S1 the save does not reach the cloud and makes no attempt to create a new workspace', U.row(db).version === v0 && writes(db, 'insert').length === 0 && writes(db).length === w0, { v: U.row(db).version, writes: writes(db).map(o => [o.action, o.uid]) });
    check('S1 the sign-in form comes up, saying the changes on this device are kept', g.shown && /sign-in has expired/i.test(g.msg) && /changes on this device are kept/i.test(g.msg), g);
    check('S1 the change stays on this device, flagged unsynced; the synced base is kept', r.card && r.unsynced && r.synced && r.ok !== true, r);
    // a colleague changes the workspace meanwhile
    const B = await openT(db, 'user-operator2');
    await B.page.evaluate(async () => { addVessel({ name: 'DAY SHIFT', nomUid: 'nd', type: 'VLSFO', qty: 200, eta: '21 Nov 2026 08:00' }); await saveSharedState(); await _waitForSaveIdle(); });
    await signIn(A.page);
    const after = await gate(A.page);
    const names = (U.row(db).payload.state.vessels || []).map(v => v.name).sort();
    const a2 = await A.page.evaluate(() => ({ unsynced: _isMarkedUnsynced(), cards: document.querySelectorAll('.vcard[id^="vessel-"]').length, rt: typeof _rtWanted !== 'undefined' ? _rtWanted : null }));
    check('S1 after signing in again: the form goes away and the app carries on (not restarted)', !after.shown && a2.cards === 4, { after, a2 });
    check('S1 …this device\'s change and the colleague\'s are both in the shared workspace', names.includes('NIGHT SHIFT') && names.includes('DAY SHIFT') && names.includes('ALPHA') && !a2.unsynced, { names, a2 });
  });

  await scenario(browser, 'S2 pull while signed out', async (openT) => {
    const db = H.createDb({ workspace: U.seedPayload({}), realtime: false });
    const A = await openT(db);
    await A.page.evaluate(() => _waitForSaveIdle());
    const w0 = writes(db).length;
    const r = await A.page.evaluate(async () => {
      window.__mockSessionExpire(false);
      await _pollOnce(true);
      return { synced: !!_lastSyncedPayload, base: !!(_lastSyncedPayload && _lastSyncedPayload.state && _lastSyncedPayload.state.vessels && _lastSyncedPayload.state.vessels.length), cards: document.querySelectorAll('.vcard[id^="vessel-"]').length, status: (document.getElementById('sync-msg') || {}).textContent || '' };
    });
    const g = await gate(A.page);
    check('S2 a pull while signed out is not taken as "the workspace is empty": the base and the nominations stay', r.synced && r.base && r.cards === 2, r);
    check('S2 …and the sign-in form comes up', g.shown && /sign-in has expired/i.test(g.msg), g);
    check('S2 nothing was written while signed out', writes(db).length === w0, writes(db).slice(w0).map(o => [o.action, o.uid]));
  });

  await scenario(browser, 'S3 SIGNED_OUT event', async (openT) => {
    const db = H.createDb({ workspace: U.seedPayload({}), realtime: false });
    const A = await openT(db);
    await A.page.evaluate(() => window.__mockSessionExpire());
    await sleep(200);
    const g = await gate(A.page);
    check('S3 the auth library reporting SIGNED_OUT brings the sign-in form up at once', g.shown && /sign-in has expired/i.test(g.msg), g);
    await signIn(A.page);
    const g2 = await gate(A.page);
    const w = await A.page.evaluate(async () => { addVessel({ name: 'AFTER', nomUid: 'na2', type: 'VLSFO', qty: 100, eta: '22 Nov 2026 08:00' }); await saveSharedState(); await _waitForSaveIdle(); return true; });
    check('S3 after signing in, saving works again', !g2.shown && w && (U.row(db).payload.state.vessels || []).some(v => v.name === 'AFTER'), g2);
  });

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
