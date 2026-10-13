/* Agents XSS + tombstones + copy, dark-theme chart/print tokens, login form, and the
   vercel.json Content-Security-Policy applied for real. node t1.js [appDir] */
const H = require('../../harness/harness.js');
const appDir = process.argv[2] || H.APP_DIR;
const CSP = JSON.parse(require('fs').readFileSync(appDir + '/vercel.json', 'utf8')).headers[0].headers.find(h => h.key === 'Content-Security-Policy').value;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const browser = await H.launch();
  const db = H.createDb();

  // ── 1. Agents XSS + tombstones + copy ──
  let app = await H.openApp(browser, db, { appDir, uid: 'user-operator' });
  let p = app.page;
  await p.evaluate(() => {
    _mergeAgents([{ name: '<img src=x onerror="window.__xss=1">', emails: 'a"><img src=x onerror="window.__xss=2">@x.com' }]);
    showPage('agents');
  });
  await p.waitForTimeout(400);
  ok(await p.evaluate(() => window.__xss === undefined), 'agent XSS not executed');
  ok(await p.evaluate(() => document.getElementById('agents-tbody').textContent.includes('<img src=x')), 'agent name rendered as text');
  ok(await p.evaluate(() => document.getElementById('agent-directory-list').innerHTML.includes('&lt;img')), 'datalist escaped');
  // delete then legacy remote merge must not resurrect
  const r = await p.evaluate(() => {
    const a = _activeAgents().find(x => x.name === 'FNSA');
    deleteAgent(a.id); // dialog auto-accepted
    const before = _activeAgents().length;
    _mergeAgents([{ id: 70, name: 'FNSA', emails: 'fnsafujairah@fng.ae' }]);
    const afterLegacy = _activeAgents().some(x => x.name === 'FNSA');
    _mergeAgents([{ name: 'fnsa', emails: 'new@fng.ae', updatedAt: Date.now() + 1000 }]);
    const afterNewer = _activeAgents().find(x => x.name.toLowerCase() === 'fnsa');
    // rename
    const w = _activeAgents().find(x => x.name === 'World Wide Marine');
    openEditAgentModal(w.id); document.getElementById('am-name').value = 'WWM Renamed'; saveAgent();
    const tomb = _agents.find(x => x.name === 'World Wide Marine');
    // remote newer tombstone deletes local
    _mergeAgents([{ name: 'Viking Marine Services', emails: '', deleted: true, updatedAt: Date.now() + 5000 }]);
    const viking = _activeAgents().some(x => x.name === 'Viking Marine Services');
    return { before, afterLegacy, afterNewer: afterNewer && afterNewer.emails, tomb: tomb && tomb.deleted, viking,
      kpi: document.getElementById('kpi-total-agents').textContent, active: _activeAgents().length,
      rows: document.querySelectorAll('#agents-tbody tr').length };
  });
  ok(r.afterLegacy === false, 'deleted agent not resurrected by legacy merge');
  ok(r.afterNewer === 'new@fng.ae', 'newer remote edit wins');
  ok(r.tomb === true, 'rename leaves tombstone');
  ok(r.viking === false, 'newer remote tombstone deletes');
  ok(String(r.active) === r.kpi && r.rows === r.active, 'kpi/rows count only active (' + r.kpi + '/' + r.rows + ')');
  // cross-device: push A, open B
  await p.evaluate(() => { const a = _activeAgents().find(x => x.name === 'Trans Gulf Agency'); deleteAgent(a.id); });
  await p.evaluate(() => forcePush()); await p.waitForTimeout(800);
  const app2 = await H.openApp(browser, db, { appDir, uid: 'user-operator2' });
  const b = await app2.page.evaluate(() => ({ tg: _activeAgents().some(x => x.name === 'Trans Gulf Agency'), rn: _activeAgents().some(x => x.name === 'WWM Renamed'), old: _activeAgents().some(x => x.name === 'World Wide Marine') }));
  ok(!b.tg && b.rn && !b.old, 'device B sees delete + rename after sync ' + JSON.stringify(b));
  ok(app2.errors.length === 0, 'device B no errors ' + app2.errors.join('|'));
  await app2.ctx.close();
  await p.evaluate(() => { const o = document.getElementById('flow-welcome-overlay'); if (o) o.style.display = 'none'; });
  // copy emails (clipboard granted)
  await app.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://flow.test' });
  await p.click('button[onclick="copyAllAgentEmails(this)"]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.querySelector('button[onclick="copyAllAgentEmails(this)"]').textContent.includes('Copied')), 'copy all emails shows Copied');
  ok(!(await p.evaluate(() => navigator.clipboard.readText())).includes('fnsafujairah'), 'copied text excludes deleted agent');
  await p.waitForTimeout(2200);
  await p.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); });
  await p.click('button[onclick="copyAllAgentEmails(this)"]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.querySelector('button[onclick="copyAllAgentEmails(this)"]').textContent.includes('Copied')), 'copy fallback without navigator.clipboard');

  // keyboard nav
  await p.focus('#nav-reports'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => _currentPage === 'reports'), 'Enter on sidebar item navigates');
  await p.evaluate(() => showPage('dashboard')); await p.focus('.kpi-chip-teal'); await p.keyboard.press(' '); await p.waitForTimeout(300);
  ok(await p.evaluate(() => _currentPage === 'bargefleet'), 'Space on kpi chip navigates');
  ok(await p.evaluate(() => { showPage('bargetracking'); return document.getElementById('topbar-page-title').textContent; }) === 'Barge Tracking Reports', 'PAGE_META bargetracking');
  ok(await p.evaluate(() => getComputedStyle(document.getElementById('btr-upload-locked')).display) === 'none', 'btr locked note hidden for operator');

  // header-h follows header height
  const hh = await p.evaluate(async () => {
    const before = getComputedStyle(document.documentElement).getPropertyValue('--header-h');
    const d = document.createElement('div'); d.style.height = '77px'; document.getElementById('app-header').appendChild(d);
    await new Promise(r => setTimeout(r, 200));
    const after = getComputedStyle(document.documentElement).getPropertyValue('--header-h');
    return { before, after, h: document.getElementById('app-header').offsetHeight };
  });
  ok(hh.after.trim() === hh.h + 'px' && hh.after !== hh.before, '--header-h tracks header via ResizeObserver ' + JSON.stringify(hh));
  ok(app.errors.length === 0, 'operator page no errors ' + app.errors.join('|'));
  await app.ctx.close();

  // trader: locked note visible
  app = await H.openApp(browser, db, { appDir, uid: 'user-trader' });
  ok(await app.page.evaluate(() => { showPage('bargetracking'); return getComputedStyle(document.getElementById('btr-upload-locked')).display; }) === 'flex', 'btr locked note flex for trader');
  await app.ctx.close();

  // ── 2. Dark theme: chart theme + print tokens ──
  app = await H.openApp(browser, db, { appDir, uid: 'user-operator', localStorage: { 'flow-theme': 'dark', 'flow-skin': 'classic' } });
  p = app.page;
  ok(await p.evaluate(() => Chart.defaults.color) === '#C8D6E8', 'Chart.defaults.color dark on first load');
  const scr = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--surface').trim());
  await p.emulateMedia({ media: 'print' });
  const prt = await p.evaluate(() => ({ s: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim(), t: getComputedStyle(document.documentElement).getPropertyValue('--text').trim() }));
  ok(scr === '#10192A' && prt.s === '#FFFFFF' && prt.t === '#101F31', 'print forces light tokens in dark ' + JSON.stringify([scr, prt]));
  await app.ctx.close();

  // ── 3. Login form ──
  app = await H.openApp(browser, H.createDb(), { appDir, uid: 'user-operator', signedOut: true });
  p = app.page;
  await p.evaluate(() => { const o = window._handleOperatorLogin; window.__loginCalls = 0; window._handleOperatorLogin = function (e) { window.__loginCalls++; window.__prevented = e && e.type === 'submit'; return o.apply(this, arguments); }; });
  await p.fill('#og-email', 'a@b.com'); await p.fill('#og-password', 'pw'); await p.press('#og-password', 'Enter'); await p.waitForTimeout(1500);
  ok(await p.evaluate(() => window.__loginCalls === 1 && window.__prevented && location.href === 'https://flow.test/index.html'), 'Enter submits login form once, no navigation');
  ok(await p.evaluate(() => getComputedStyle(document.getElementById('operator-gate')).display) === 'none', 'login completes');
  ok(app.errors.length === 0, 'login no errors ' + app.errors.join('|'));
  await app.ctx.close();

  // ── 4. CSP ──
  app = await H.openApp(browser, H.createDb(), { appDir, uid: 'user-operator', csp: CSP });
  p = app.page;
  await p.evaluate(() => { window.__viol = []; document.addEventListener('securitypolicyviolation', e => window.__viol.push(e.violatedDirective + ' ' + e.blockedURI)); });
  const pages = await p.evaluate(() => [...new Set([...document.querySelectorAll('[onclick*="showPage("]')].map(el => (el.getAttribute('onclick').match(/showPage\('([^']+)'/) || [])[1]).filter(Boolean))]);
  for (const pg of pages) { await p.evaluate(pg => showPage(pg), pg); await p.waitForTimeout(200); }
  const libs = await p.evaluate(async () => {
    const load = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(src); document.head.appendChild(s); });
    const out = {};
    try { await _loadEmailJS(); out.emailjs = typeof emailjs; } catch (e) { out.emailjs = 'ERR ' + e.message; }
    for (const u of ['https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/chartjs-plugin-datalabels/2.2.0/chartjs-plugin-datalabels.min.js']) await load(u);
    const z = new JSZip(); z.file('a.txt', 'x'); out.zip = (await z.generateAsync({ type: 'blob' })).size;
    const wb = new ExcelJS.Workbook(); wb.addWorksheet('s').addRow([1, 2]); out.xl = (await wb.xlsx.writeBuffer()).byteLength;
    const pdf = new jspdf.jsPDF(); pdf.text('hi', 10, 10); out.pdf = pdf.output('blob').size;
    const c = await html2canvas(document.getElementById('app-header')); out.h2c = c.width;
    const w = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet([[1]]), 's'); out.xlsx = XLSX.write(w, { type: 'array', bookType: 'xlsx' }).byteLength;
    return out;
  });
  console.log('   libs under CSP', JSON.stringify(libs));
  await p.waitForTimeout(500);
  const viol = await p.evaluate(() => window.__viol);
  const refused = app.errors.filter(e => /Refused|Content Security Policy/i.test(e));
  ok(viol.length === 0 && refused.length === 0, 'no CSP violations ' + JSON.stringify(viol) + refused.join('|'));
  ok(app.errors.length === 0, 'CSP run no errors ' + app.errors.join('|'));
  // sanity: the CSP is really enforced (inline eval blocked)
  ok(await p.evaluate(async () => { const s = document.createElement('script'); s.src = 'https://unpkg.com/nope@1.0.0/x.js'; document.head.appendChild(s); await new Promise(r => setTimeout(r, 300)); return window.__viol.some(v => /script-src/.test(v)); }), 'CSP actually active (unlisted script origin blocked)');
  await app.ctx.close();

  await browser.close();
  console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
