/* R2 behavioural tests: node r2.test.js [appDir] */
const H = require('../../harness/harness.js');
const appDir = process.argv[2] || H.APP_DIR;
const XSS = '<img src=x onerror="window.__xss=1">';
let fails = 0;
function ok(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; }
// Today in the app's timezone (the harness runs pages in Asia/Dubai, UTC+4) — the runner's clock is
// a day behind between 20:00 and 24:00 UTC.
function todayISO() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
const realErrors = errs => errs.filter(e => !/capacitorExports/.test(e));

(async () => {
  const browser = await H.launch();

  // ── 1/2/7/10: XSS escaping, onclick handlers, KPI by supplyDate, alerts ──
  {
    const future = new Date(Date.now() + 5 * 3600e3).toISOString();
    const future2 = new Date(Date.now() + 9 * 3600e3).toISOString();
    const state = {
      barges: [{ id: 1, name: XSS, vcap: 5000, mcap: 1000, vrob: 100, mrob: 50, vbuf: 500, mbuf: 150, vtph: 300, mtph: 100 }],
      vessels: [{ nomUid: 'n1', name: XSS, area: 'FUJ-A', type: 'VLSFO', qty: 100, paq: 'no', eta: '', lc: '' }],
      loadingRecords: [{ id: "ld'1", terminal: XSS, surveyor: XSS, grade: 'VLSFO', qty: 100, startAt: future, endAt: future2 }],
      checklistRecords: {}, archives: {}, agents: []
    };
    const records = [
      { id: 'r1', vessel: XSS, barge: XSS, supplied: true, supplyDate: todayISO(), savedAt: '2020-01-01T00:00:00Z', vlsfoAct: 100, mgoAct: 0, areaCode: 'FUJ-A', dateStr: XSS, area: XSS },
      { id: 'r2', vessel: 'OLD', supplied: false, supplyDate: todayISO(), savedAt: new Date().toISOString(), vlsfoAct: 999, areaCode: 'FUJ-A' }
    ];
    const db = H.createDb({ workspace: { version: 5, state, records } });
    const app = await H.openApp(browser, db, { appDir, uid: 'user-operator' });
    const p = app.page;
    await p.evaluate(() => showPage('dashboard'));
    await p.waitForTimeout(400);
    const r = await p.evaluate((XSS) => {
      // _barges only carries ids here (names live in the barge-card inputs), so feed the fleet widget directly
      _bargeConfig = [{ id: 1, name: XSS, vcap: 5000, mcap: 1000 }];
      refreshDashboard();
      const out = {};
      // Nomination-card / barge inputs (other regions) may hand back a truncated
      // value; what matters here is that it arrives as text, not markup.
      out.aqName = (document.querySelector('#dash-action-queue .aq-name') || {}).textContent;
      out.aqNameOk = out.aqName && out.aqName.startsWith('<img src=x') && !document.querySelector('#dash-action-queue img');
      out.deliveries = document.getElementById('kpi-deliveries').textContent;
      out.monthly = document.getElementById('kpi-monthly').textContent;
      const asText = id => document.getElementById(id).textContent.includes('<img src=x') && !document.getElementById(id).querySelector('img');
      out.fleet = asText('dash-fleet-status');
      out.activity = asText('dash-activity-feed');
      out.alerts = asText('dash-alerts');
      return out;
    }, XSS);
    ok(r.aqNameOk, 'action queue shows vessel name as text (got ' + r.aqName + ')');
    ok(r.deliveries === '1', 'deliveries today counts supplied records by supplyDate (got ' + r.deliveries + ')');
    ok(/FUJ 100/.test(r.monthly) && !/999/.test(r.monthly), 'monthly KPI uses supplied records by supplyDate (' + r.monthly + ')');
    ok(r.fleet && r.activity && r.alerts, 'fleet/activity/alert strips render names as text ' + JSON.stringify([r.fleet, r.activity, r.alerts]));

    // Delayed/early strip + action queue onclick with a quote-y sno; re-nominated vessel alert
    const r2 = await p.evaluate((XSS) => {
      _savedSupplies.push({ id: 'old', vessel: 'ALPHA', nomUid: 'nom_old', supplied: true, supplyDate: '2026-01-01' });
      _lastSched = [{ name: XSS, sno: '1"\'x', isDelayed: true, nomUid: 'nX', eta: new Date('2020-01-01T00:00:00Z'), bargeStart: new Date('2020-01-01T00:00:00Z'), etc: new Date('2020-01-01T04:00:00Z') }, { name: 'ALPHA', sno: 2, isDelayed: true, nomUid: 'nom_new' }];
      refreshDashboard();
      _refreshGlobalAlertsBell();
      const bellEl = document.getElementById('global-alerts-list');
      const bell = bellEl ? (bellEl.textContent.includes(XSS) && !bellEl.querySelector('img')) : 'n/a';
      const alerts = computeGlobalAlerts().map(a => a.sub);
      const strip = document.querySelector('#dash-alerts .alert-strip.critical');
      let threw = null;
      try { strip.click(); } catch (e) { threw = e.message; }
      const page = _currentPage;
      const btn = document.querySelector('#dash-action-queue .aq-btn');
      const handler = btn.getAttribute('onclick');
      return { threw, page, handler, alerts, bell, title: strip.getAttribute('title') };
    }, XSS);
    ok(!r2.threw && r2.page === 'schedule', 'delayed alert strip onclick navigates to schedule (page=' + r2.page + ')');
    ok(r2.handler === "_globalSearchGoSchedule('1\"\\'x')", 'action queue onclick is a valid single-quoted call: ' + r2.handler);
    ok(r2.title.includes(XSS), 'strip title attribute holds the raw name as text');
    ok(r2.alerts.includes('ALPHA'), 're-nominated vessel keeps its laycan alert');
    ok(r2.bell === true || r2.bell === 'n/a', 'alerts bell renders names as text');

    // Global search + reports
    await p.evaluate((XSS) => { _globalSearchRun(XSS); }, XSS);
    const gs = await p.evaluate(() => document.getElementById('global-search-results').textContent);
    ok(gs.includes('<img'), 'global search shows the query/name as text');
    await p.evaluate(() => _globalSearchRun('<svg onload="window.__xss=2">zzz'));
    await p.evaluate(() => showPage('reports'));
    await p.waitForTimeout(300);
    const rep = await p.evaluate((XSS) => document.getElementById('rep-records-body').textContent.includes(XSS), XSS);
    ok(rep, 'reports table renders vessel as text');
    await p.evaluate(() => showPage('dashboard'));
    await p.waitForTimeout(300);
    // Other regions (week calendar, barge cards — not R2) are fixed by other
    // agents, so check that no markup was injected into R2's own sinks.
    const injected = await p.evaluate(() => ['dash-action-queue', 'dash-alerts', 'dash-fleet-status', 'dash-activity-feed', 'dash-fueling-status', 'global-search-results', 'rep-records-body', 'global-alerts-list', 'kpi-monthly']
      .filter(id => { const el = document.getElementById(id); return el && el.querySelector('img,svg[onload]'); }));
    ok(injected.length === 0, 'no markup injected into R2 renderers: ' + injected.join(','));
    const errs = realErrors(app.errors).filter(e => !/Unexpected token '<'/.test(e)); // barge-name onclick at week calendar (~16512, out of region)
    ok(errs.length === 0, 'no page errors: ' + errs.join(' | '));

    // 6: debounced observer, skipped off-dashboard
    const counts = await p.evaluate(async () => {
      let n = 0; const orig = window.refreshDashboard;
      window.refreshDashboard = function () { n++; return orig.apply(this, arguments); };
      const vc = document.getElementById('vc');
      for (let i = 0; i < 30; i++) vc.appendChild(document.createElement('span'));
      await new Promise(r => setTimeout(r, 400));
      const onDash = n; n = 0;
      _currentPage = 'nominations';
      for (let i = 0; i < 30; i++) vc.appendChild(document.createElement('span'));
      await new Promise(r => setTimeout(r, 400));
      const offDash = n;
      window.refreshDashboard = orig;
      return { onDash, offDash };
    });
    ok(counts.onDash === 1 && counts.offDash === 0, 'observer coalesces refreshes and skips off-dashboard ' + JSON.stringify(counts));

    // 8: a failing sub-render doesn't stop the rest
    const resil = await p.evaluate(() => {
      _currentPage = 'dashboard';
      const orig = window.renderDashFuelingStatus;
      window.renderDashFuelingStatus = () => { throw new Error('boom'); };
      document.getElementById('dash-fleet-status').innerHTML = '';
      let threw = false;
      try { refreshDashboard(); } catch (e) { threw = true; }
      window.renderDashFuelingStatus = orig;
      return { threw, fleet: document.getElementById('dash-fleet-status').innerHTML.length > 0 };
    });
    ok(!resil.threw && resil.fleet, 'refreshDashboard survives a throwing sub-render');
    await app.ctx.close();
  }

  // ── 8: corrupt LS_RECORDS_KEY ──
  {
    const db = H.createDb();
    const app = await H.openApp(browser, db, { appDir, uid: 'user-operator' });
    const r = await app.page.evaluate(() => {
      _savedSupplies = []; localStorage.setItem(LS_RECORDS_KEY, '{not json');
      let e1 = null, e2 = null;
      try { refreshDashboard(); } catch (e) { e1 = e.message; }
      try { refreshReports(); } catch (e) { e2 = e.message; }
      return { e1, e2 };
    });
    ok(!r.e1 && !r.e2, 'corrupt cached records do not throw ' + JSON.stringify(r));
    await app.ctx.close();
  }

  // ── 9: local date parsing in a UTC-negative zone ──
  {
    const db = H.createDb();
    const app = await H.openApp(browser, db, { appDir, uid: 'user-operator', timezoneId: 'America/New_York' });
    const r = await app.page.evaluate(() => {
      const d = _parseLocalDate('2026-10-01');
      return [d.getFullYear(), d.getMonth(), d.getDate(), _parseLocalDate('2026-10-01T12:00:00Z').getUTCHours()];
    });
    ok(JSON.stringify(r) === '[2026,9,1,12]', '_parseLocalDate is local for date-only strings ' + JSON.stringify(r));
    await app.ctx.close();
  }

  // ── 3: role lookup least privilege ──
  {
    const roleOf = async (db, uid) => {
      const app = await H.openApp(browser, db, { appDir, uid, settleMs: 5500 });
      const r = await app.page.evaluate(() => ({ role: ABPS_ROLE, toast: document.getElementById('toast-stack').textContent, schedHidden: (document.getElementById('nav-schedule') || {}).style?.display === 'none' }));
      r.errors = realErrors(app.errors);
      await app.ctx.close();
      return r;
    };
    let r = await roleOf(H.createDb(), 'user-operator');
    ok(r.role === 'operator' && !r.schedHidden, 'operator row -> operator view');
    r = await roleOf(H.createDb(), 'user-trader');
    ok(r.role === 'trader' && r.schedHidden, 'trader row -> trader view');
    r = await roleOf(H.createDb(), 'user-nobody');
    ok(r.role === 'trader' && /no assigned role/.test(r.toast), 'no role row -> trader view + notice');
    const failing = H.createDb();
    let tries = 0;
    failing.intercept = op => (op.table === 'user_roles' ? (tries++, { data: null, error: { message: 'upstream timeout' } }) : null);
    r = await roleOf(failing, 'user-operator');
    ok(r.role === 'trader' && /Could not confirm your account role/.test(r.toast) && tries === 3, 'lookup error -> retried 3x, trader view + toast (tries=' + tries + ')');
  }

  // ── 4: offline launch ──
  {
    const lsSeed = { abps_last_login_v1: JSON.stringify({ uid: 'user-operator', at: '2026-10-01T00:00:00Z' }), abps_role_cache_v1: JSON.stringify({ uid: 'user-operator', role: 'operator' }) };
    // (a) library failed to load + offline
    const db = H.createDb();
    const app = await H.openApp(browser, db, { appDir, uid: 'user-operator', localStorage: lsSeed, settleMs: 0 }).catch(e => { throw e; });
    await app.ctx.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false, configurable: true }); });
    await app.ctx.route(/supabase-js@[^/]+\/dist\/umd\/supabase\.js/, r => r.abort());
    await app.page.reload({ waitUntil: 'load' });
    await app.page.waitForTimeout(3000);
    let r = await app.page.evaluate(() => ({ gate: getComputedStyle(document.getElementById('operator-gate')).display, toast: document.getElementById('toast-stack').textContent, client: !!supabaseClient, role: ABPS_ROLE }));
    ok(r.gate === 'none' && /Offline — read-only/.test(r.toast) && !r.client && r.role === 'operator', 'offline + no library + previous login -> enters offline mode ' + JSON.stringify({ gate: r.gate, client: r.client, role: r.role }));
    // (b) same but no previous-login record -> gate stays
    await app.page.evaluate(() => localStorage.removeItem('abps_last_login_v1'));
    await app.page.reload({ waitUntil: 'load' });
    await app.page.waitForTimeout(2000);
    r = await app.page.evaluate(() => getComputedStyle(document.getElementById('operator-gate')).display);
    ok(r !== 'none', 'offline without a recorded login -> login gate shown');
    await app.ctx.close();

    // (b2) library loaded, offline, session can't be verified -> offline mode only with a stored sb- session
    {
      const appL = await H.openApp(browser, H.createDb(), { appDir, uid: 'user-operator', signedOut: true, localStorage: Object.assign({ 'sb-test-auth-token': '{"x":1}' }, lsSeed), settleMs: 0 });
      await appL.ctx.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false, configurable: true }); });
      await appL.page.reload({ waitUntil: 'load' });
      await appL.page.waitForTimeout(3000);
      let g = await appL.page.evaluate(() => [getComputedStyle(document.getElementById('operator-gate')).display, _flowOfflineLaunch]);
      ok(g[0] === 'none' && g[1] === true, 'offline + library + stored session -> offline mode ' + JSON.stringify(g));
      await appL.page.evaluate(() => localStorage.removeItem('sb-test-auth-token'));
      await appL.page.reload({ waitUntil: 'load' });
      await appL.page.waitForTimeout(2000);
      g = await appL.page.evaluate(() => getComputedStyle(document.getElementById('operator-gate')).display);
      ok(g !== 'none', 'offline + library + no stored session -> login gate');
      await appL.ctx.close();
    }
    // (c) online, signed out -> gate (unchanged)
    const app2 = await H.openApp(browser, H.createDb(), { appDir, uid: 'user-operator', signedOut: true, localStorage: lsSeed });
    r = await app2.page.evaluate(() => getComputedStyle(document.getElementById('operator-gate')).display);
    ok(r !== 'none', 'online + signed out -> login gate shown even with a recorded login');
    await app2.ctx.close();

    // (d) online valid session records the login
    const app3 = await H.openApp(browser, H.createDb(), { appDir, uid: 'user-operator' });
    r = await app3.page.evaluate(() => JSON.parse(localStorage.getItem('abps_last_login_v1') || 'null'));
    ok(r && r.uid === 'user-operator', 'valid online session records last login');

    // ── 11: logout clears data keys, keeps prefs ──
    await app3.page.evaluate(() => {
      localStorage.setItem('flow-theme', 'dark'); localStorage.setItem('abps_sidebar_collapsed', '1');
      localStorage.setItem('abps_archives', '{}'); localStorage.setItem('flowops_fy_archive_v1', '{}');
      localStorage.setItem('sb-x-auth-token', '{}'); localStorage.setItem('unrelated', '1');
    });
    await app3.ctx.addInitScript(() => { if (sessionStorage.getItem('__loggedOut')) window.__mockSignedOut = true; });
    await app3.page.evaluate(() => sessionStorage.setItem('__loggedOut', '1'));
    await Promise.all([app3.page.waitForNavigation({ waitUntil: 'load' }), app3.page.evaluate(() => operatorLogout())]);
    await app3.page.waitForTimeout(500);
    r = await app3.page.evaluate(() => Object.keys(localStorage).sort());
    // abps_agents is the built-in default directory, re-seeded on every load (even at the login gate);
    // flow_build_fp is the deployed-build fingerprint, written again by every load's update check
    r = r.filter(k => k !== 'abps_agents' && k !== 'flow_build_fp');
    ok(JSON.stringify(r) === JSON.stringify(['abps_sidebar_collapsed', 'flow-theme', 'unrelated']), 'logout leaves only prefs: ' + JSON.stringify(r));
    await app3.ctx.close();
  }

  // ── 5: email logs ──
  {
    const db = H.createDb({ roles: { 'user-trader2': 'trader' } });
    const stub = async (page) => page.evaluate(() => {
      window.__sent = 0; window.__banners = [];
      window.emailjs = { init() {}, send: async () => { window.__sent++; return { status: 200 }; } };
      window._flashNominationEmailBanner = (m, ok) => window.__banners.push((ok ? 'OK: ' : 'WARN: ') + m);
    });
    const A = await H.openApp(browser, db, { appDir, uid: 'user-operator' });
    const B = await H.openApp(browser, db, { appDir, uid: 'user-trader' });
    await stub(A.page); await stub(B.page);
    const send = (page, uid, fn) => page.evaluate(([uid, fn]) => window[fn || 'sendNominationEmailIfNeeded']({ nomUid: uid, name: 'V ' + uid }).then(() => ({ sent: __sent, banners: __banners.slice() })), [uid, fn]);
    let r = await send(A.page, 'X');
    const row = () => Object.keys((db.tables.abps_workspace.get('nomination_email_log') || { payload: {} }).payload).sort().join(',');
    ok(r.sent === 1 && row() === 'X', 'operator send recorded via RPC (row=' + row() + ')');
    r = await send(B.page, 'X');
    ok(r.sent === 0 && /already sent from another device/.test(r.banners.join()), 'second device blocked by fresh remote read');
    r = await send(B.page, 'Y');
    ok(r.sent === 1 && row() === 'X,Y', 'trader send recorded via RPC without clobbering (row=' + row() + ')');
    db.noEmailLogRpc = true;
    // B's write of Y happened after A last read the log — fallback must merge, not overwrite
    r = await send(A.page, 'Z');
    ok(r.sent === 2 && row() === 'X,Y,Z', 'RPC missing -> operator re-read+merge upsert (row=' + row() + ')');
    r = await send(B.page, 'W');
    ok(/recording it in the shared log failed/.test(r.banners.join()), 'RPC missing for trader -> failure surfaced');
    db.noEmailLogRpc = false;
    db.intercept = op => (op.action === 'rpc' && op.name === 'log_nomination_email') ? { data: null, error: { message: 'disk full', code: 'XX000' } } : null;
    r = await send(A.page, 'Q');
    ok(/recording it in the shared log failed \(disk full\)/.test(r.banners.join()), 'write error is surfaced');
    db.intercept = op => (op.action === 'select' && op.table === 'abps_workspace') ? { data: null, error: { message: 'offline' } } : null;
    const before = r.sent;
    r = await send(A.page, 'R');
    ok(r.sent === before && /Could not check/.test(r.banners.join()), 'unreadable remote log blocks the send');
    db.intercept = null;
    r = await send(B.page, 'C1', 'sendNominationCancelledEmailIfNeeded');
    const crow = Object.keys((db.tables.abps_workspace.get('nomination_cancel_email_log') || { payload: {} }).payload).join(',');
    ok(crow === 'C1', 'trader cancel email recorded in cancel log (row=' + crow + ')');
    const beforeC = (await A.page.evaluate(() => __sent));
    r = await send(A.page, 'C1', 'sendNominationCancelledEmailIfNeeded');
    ok(r.sent === beforeC && /already sent from another device/.test(r.banners.join()), 'cancel duplicate from other device blocked');
    ok(realErrors(A.errors).filter(e => !/email send failed/.test(e)).length === 0 && realErrors(B.errors).length === 0, 'no page errors in email tests: ' + realErrors(A.errors).concat(realErrors(B.errors)).join(' | '));
    await A.ctx.close(); await B.ctx.close();
  }

  await browser.close();
  console.log(fails ? `R2 TESTS: ${fails} FAILED` : 'R2 TESTS: ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
