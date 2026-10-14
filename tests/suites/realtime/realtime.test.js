/* Realtime (Supabase postgres_changes) sync tests.
   node realtime.test.js [appDir]
   Two operators + a trader on one fake Supabase; harness.js delivers row-change
   events to the other open pages (db.realtime=false turns that off). */
const path = require('path');
if (process.argv[2]) process.env.APP_DIR = process.argv[2];
const U = require('../r3/util.js');
const { check } = U;

const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(page, fn, arg, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await page.evaluate(fn, arg)) return Date.now() - t0;
    await wait(50);
  }
  return -1;
}
const stats = app => app.page.evaluate(() => ({ ticks: _pollTicks, pulls: _rtPulls, events: _rtEvents, status: _rtStatus, ver: _lastKnownVersion }));
const selectsBy = (db, uid) => db.log.filter(o => o.uid === uid && o.table === 'abps_workspace' && o.action === 'select').length;

(async () => {
  const browser = await U.H.launch();
  try {
    // ── 1. Operator → operator + trader, delivered by realtime (not the poll) ──
    console.log('T1 instant delivery');
    {
      const db = U.H.createDb({ workspace: U.seedPayload() });
      const A = await U.open(browser, db, 'user-operator');
      const B = await U.open(browser, db, 'user-operator2');
      const T = await U.open(browser, db, 'user-trader');
      for (const x of [A, B, T]) await U.helpers(x);

      const ind = await B.page.evaluate(() => { const el = document.getElementById('sync-live'); return { state: el.dataset.state, text: el.textContent.trim(), shown: getComputedStyle(el).display !== 'none' }; });
      check(ind.state === 'live' && ind.text === 'Live' && ind.shown, '"Live" indicator shown when subscribed ' + JSON.stringify(ind));
      check(await B.page.evaluate(() => _pollIntervalMs()) === 60000, 'safety-net poll slowed to 60 s while live');
      check(await T.page.evaluate(() => _rtStatus) === 'live', 'trader subscribed too');

      const b0 = await stats(B), t0s = await stats(T);
      const tStart = Date.now();
      await A.page.evaluate(async () => { __setV('n1', 'agent', 'RT-EDIT-A'); return saveSharedState(); });
      const dtB = await until(B.page, () => __getV('n1', 'agent') === 'RT-EDIT-A', null, 5000);
      check(dtB >= 0 && Date.now() - tStart < 2500, `B shows A's edit within 2 s (${dtB} ms after save)`);
      const b1 = await stats(B);
      check(b1.ticks === b0.ticks && b1.pulls === b0.pulls + 1, `delivered by realtime pull, not the poll (ticks ${b0.ticks}→${b1.ticks}, rt pulls ${b0.pulls}→${b1.pulls})`);
      const dtT = await until(T.page, () => __getV('n1', 'agent') === 'RT-EDIT-A', null, 5000);
      check(dtT >= 0, `trader received it too (${dtT} ms)`);
      check((await stats(T)).ticks === t0s.ticks, 'trader: no poll involved');

      // a brand-new nomination
      await A.page.evaluate(async () => { addVessel({ name: 'RT-NEW', nomUid: 'rtnew', qty: 321 }); return saveSharedState(); });
      const dtNew = await until(B.page, () => !!__cardFor('rtnew'), null, 5000);
      check(dtNew >= 0 && dtNew < 2000, `B shows A's new nomination within 2 s (${dtNew} ms)`);

      // trader's own write (rpc) reaches the operators the same way
      await T.page.evaluate(async () => { __setV('n2', 'remarks', 'from trader'); return saveSharedState(); });
      const dtA = await until(A.page, () => __getV('n2', 'remarks') === 'from trader', null, 5000);
      check(dtA >= 0 && dtA < 2000, `trader's save (rpc) reaches operator A within 2 s (${dtA} ms)`);

      // email-log row change → the log is refreshed on other devices
      await A.page.evaluate(() => supabaseClient.rpc('log_nomination_email', { log_id: 'nomination_email_log', nom_uid: 'n1', entry: { emailSent: true, sentAt: new Date().toISOString(), vessel: 'ALPHA' } }));
      const dtLog = await until(B.page, () => !!(_nomEmailLog.n1 && _nomEmailLog.n1.emailSent), null, 4000);
      check(dtLog >= 0, `email-log event refreshed B's nomination email log (${dtLog} ms)`);
      check(await B.page.evaluate(() => { const id = __cardFor('n1'); const b = document.getElementById('v' + id + '-send-email-btn'); return !!b && /sent/i.test(b.className + ' ' + b.textContent); }), "B's Send Email button now shows sent");

      check(U.realErrors(A).length + U.realErrors(B).length + U.realErrors(T).length === 0, 'no page errors (' + [A, B, T].map(U.realErrors).flat().join(' | ') + ')');
      await A.ctx.close(); await B.ctx.close(); await T.ctx.close();
    }

    // ── 2. Own-save echo doesn't trigger a redundant pull/apply ──
    console.log('T2 own-save echo ignored');
    {
      const db = U.H.createDb({ workspace: U.seedPayload(), realtimeEcho: true });
      const A = await U.open(browser, db, 'user-operator');
      await U.helpers(A);
      await A.page.evaluate(() => { window.__applies = 0; const o = _applyPayload; _applyPayload = function () { window.__applies++; return o.apply(this, arguments); }; });
      const a0 = await stats(A), sel0 = selectsBy(db, 'user-operator');
      await A.page.evaluate(async () => { __setV('n1', 'agent', 'ECHO'); return saveSharedState(); });
      await wait(1500);
      const a1 = await stats(A);
      check(a1.events > a0.events, `echo event was delivered to the writer (${a0.events}→${a1.events})`);
      check(a1.pulls === a0.pulls, 'echo did not schedule a pull');
      check(selectsBy(db, 'user-operator') === sel0, 'no extra select of the workspace row after own save');
      check(await A.page.evaluate(() => window.__applies) === 0, 'no payload re-applied');
      // a burst of colleague events costs one pull (debounce)
      await A.page.evaluate(() => { const ev = { eventType: 'UPDATE', schema: 'public', table: 'abps_workspace', new: { id: 'main', version: 1 }, old: { id: 'main' } }; for (let i = 0; i < 5; i++) window.__mockRealtimeDeliver([ev]); });
      await wait(900);
      check((await stats(A)).pulls === a1.pulls + 1, '5 events in a burst → 1 debounced pull');
      await A.ctx.close();
    }

    // ── 3. Typing in a focused field isn't clobbered (focus deferral) ──
    console.log('T3 focus deferral');
    {
      const db = U.H.createDb({ workspace: U.seedPayload() });
      const A = await U.open(browser, db, 'user-operator');
      const B = await U.open(browser, db, 'user-operator2');
      await U.helpers(A); await U.helpers(B);
      await B.page.evaluate(() => { const o = document.getElementById('flow-welcome-overlay'); if (o) o.style.display = 'none'; showPage('nominations'); });
      const sel = await B.page.evaluate(() => '#v' + __cardFor('n2') + '-remarks');
      await B.page.click(sel);
      await B.page.keyboard.type('typing in B');
      // still mid-edit: hold back the field's own 1.5 s debounced save, so
      // only the realtime path is exercised here
      await B.page.evaluate(() => clearTimeout(upd._t));
      const bEv0 = (await stats(B)).events;
      await A.page.evaluate(async () => { __setV('n1', 'agent', 'WHILE-TYPING'); return saveSharedState(); });
      await wait(1500);
      const mid = await B.page.evaluate(s => ({ typed: document.querySelector(s).value, focused: document.activeElement === document.querySelector(s), agent: __getV('n1', 'agent') }), sel);
      check(mid.typed === 'typing in B' && mid.focused, 'B keeps its typed text and focus while A\'s change arrives ' + JSON.stringify(mid));
      check(mid.agent !== 'WHILE-TYPING', 'remote change deferred while B is typing');
      const bm = await B.page.evaluate(() => ({ armed: !!_deferPollUntilBlur._armed, events: _rtEvents, pulls: _rtPulls }));
      check(bm.events > bEv0 && bm.armed, 'the realtime event arrived and the pull was deferred until blur ' + JSON.stringify(bm));
      await B.page.evaluate(() => document.activeElement.blur());
      const dt = await until(B.page, () => __getV('n1', 'agent') === 'WHILE-TYPING', null, 5000);
      check(dt >= 0, `applied after blur (${dt} ms)`);
      check(await B.page.evaluate(s => document.querySelector(s).value, sel) === 'typing in B', "B's typed text survived the merge");
      check(U.realErrors(A).length + U.realErrors(B).length === 0, 'no page errors');
      await A.ctx.close(); await B.ctx.close();
    }

    // ── 4. Realtime not enabled in SQL (no events) → polling still delivers ──
    console.log('T4 polling fallback (db.realtime=false)');
    {
      const db = U.H.createDb({ workspace: U.seedPayload(), realtime: false });
      const A = await U.open(browser, db, 'user-operator');
      const B = await U.open(browser, db, 'user-operator2');
      await U.helpers(A); await U.helpers(B);
      // shorten both cadences so the test doesn't wait a minute
      await B.page.evaluate(() => { SYNC_POLL_MS = 1200; SYNC_POLL_LIVE_MS = 1200; startAutoSync(); });
      const b0 = await stats(B);
      await A.page.evaluate(async () => { __setV('n1', 'agent', 'VIA-POLL'); return saveSharedState(); });
      const dt = await until(B.page, () => __getV('n1', 'agent') === 'VIA-POLL', null, 6000);
      const b1 = await stats(B);
      check(dt >= 0, `B got A's edit via polling (${dt} ms)`);
      check(b1.pulls === b0.pulls && b1.events === b0.events && b1.ticks > b0.ticks, `no realtime event/pull; poll ticks ${b0.ticks}→${b1.ticks}`);
      await A.ctx.close(); await B.ctx.close();
    }

    // ── 5. Channel drops → 30 s poll + indicator; reconnect with backoff + catch-up ──
    console.log('T5 drop / reconnect');
    {
      const db = U.H.createDb({ workspace: U.seedPayload() });
      const A = await U.open(browser, db, 'user-operator');
      const B = await U.open(browser, db, 'user-operator2');
      await U.helpers(A); await U.helpers(B);
      await B.page.evaluate(() => { window.__mockRealtimeDown = true; window.__mockRealtimeDrop('CHANNEL_ERROR'); });
      await wait(250);
      const d = await B.page.evaluate(() => ({ st: _rtStatus, ms: _pollIntervalMs(), txt: document.getElementById('sync-live').textContent.trim(), state: document.getElementById('sync-live').dataset.state }));
      check(d.st === 'down' && d.ms === 30000, 'poll back to 30 s while the channel is down ' + JSON.stringify(d));
      check(d.txt === 'Syncing every 30 s' && d.state === 'down', 'indicator says "Syncing every 30 s"');
      // a change made while B's channel is down — no event reaches B
      await A.page.evaluate(async () => { __setV('n1', 'agent', 'WHILE-DOWN'); return saveSharedState(); });
      await wait(600);
      check(await B.page.evaluate(() => __getV('n1', 'agent')) !== 'WHILE-DOWN', 'nothing delivered while down');
      const created0 = await B.page.evaluate(() => window.__mockRealtime.created);
      await B.page.evaluate(() => { window.__mockRealtimeDown = false; });
      const dt = await until(B.page, () => _rtStatus === 'live', null, 9000);
      check(dt >= 0, `resubscribed after backoff (${dt} ms)`);
      check(await B.page.evaluate(() => window.__mockRealtime.created) > created0, 'a fresh channel was created');
      const dt2 = await until(B.page, () => __getV('n1', 'agent') === 'WHILE-DOWN', null, 3000);
      check(dt2 >= 0, `catch-up pull on reconnect fetched the missed change (${dt2} ms)`);
      check(await B.page.evaluate(() => _pollIntervalMs()) === 60000, 'poll slowed to 60 s again');
      check(await B.page.evaluate(() => window.__mockRealtime.channels.length) === 1, 'exactly one open channel after reconnect');
      check(U.realErrors(A).length + U.realErrors(B).length === 0, 'no page errors (' + U.realErrors(A).concat(U.realErrors(B)).join(' | ') + ')');
      await A.ctx.close(); await B.ctx.close();
    }

    // ── 6. Logout unsubscribes ──
    console.log('T6 logout');
    {
      const db = U.H.createDb({ workspace: U.seedPayload() });
      const A = await U.open(browser, db, 'user-operator');
      let report = null;
      await A.ctx.exposeFunction('__rtReport', s => { report = JSON.parse(s); });
      const before = await A.page.evaluate(() => window.__mockRealtime.channels.length);
      await A.page.evaluate(() => {
        const so = supabaseClient.auth.signOut;
        supabaseClient.auth.signOut = function () {
          window.__rtReport(JSON.stringify({ open: window.__mockRealtime.channels.length, removed: window.__mockRealtime.removed, status: _rtStatus, wanted: _rtWanted }));
          return so.apply(this, arguments);
        };
      });
      await Promise.all([A.page.waitForEvent('load'), A.page.evaluate(() => { operatorLogout(); })]);
      check(before === 1, 'one channel open before logout');
      check(report && report.open === 0 && report.removed >= 1 && report.status === 'off' && report.wanted === false, 'logout removed the channel before signing out ' + JSON.stringify(report));
      await A.ctx.close();
    }
  } catch (e) {
    check(false, 'threw: ' + (e && e.stack || e));
  } finally {
    await browser.close();
    U.summary('realtime.test');
  }
})();
