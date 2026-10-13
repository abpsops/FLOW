/* Harbour Light / Classic skin switch behaviour: node skin.test.js [appDir] */
const path = require('path');
const H = require('../../harness/harness.js');
const appDir = process.argv[2] || H.APP_DIR;
let f = 0, p = 0; const ok = (n, c, x) => { c ? p++ : f++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' ' + JSON.stringify(x))); };
const J = JSON.stringify;
(async () => {
  const browser = await H.launch();
  const css = (pg, v) => pg.evaluate(v => getComputedStyle(document.documentElement).getPropertyValue(v).trim(), v);
  const disp = (pg, id) => pg.evaluate(id => getComputedStyle(document.getElementById(id)).display, id);
  // 1. default = harbour + light even when the saved theme is dark; saved theme untouched
  let app = await H.openApp(browser, H.createDb(), { appDir, uid: 'user-operator', localStorage: { 'flow-theme': 'dark' } });
  let pg = app.page;
  let r = await pg.evaluate(() => [document.documentElement.dataset.skin, document.documentElement.dataset.theme, Chart.defaults.color, _chartTextColor(), getComputedStyle(document.getElementById('theme-toggle-btn')).display, document.getElementById('skin-toggle-label').textContent, localStorage.getItem('flow-skin'), localStorage.getItem('flow-theme')]);
  ok('default harbour/light, harbour chart colours, theme toggle hidden, no skin pref written, flow-theme kept', J(r) === J(['harbour', 'light', '#5B6E86', '#5B6E86', 'none', 'Classic look', null, 'dark']), r);
  ok('harbour tokens (ground, surface, text)', J([await css(pg, '--bg'), await css(pg, '--surface'), await css(pg, '--text')]) === J(['#EEF2F7', '#FFFFFF', '#13233A']));
  ok('hero banner visible in harbour', await disp(pg, 'dash-hero') === 'block');
  r = await pg.evaluate(() => { _lastSched = [{ bargeStart: new Date().toISOString(), name: 'X <b>' }]; refreshDashboard(); const t = document.getElementById('dash-hero-title'); return [t.textContent, t.children.length, document.getElementById('dash-hero-date').textContent]; });
  ok('hero headline from live data, text only', /^Good (morning|afternoon|evening) — 1 supply today, /.test(r[0]) && r[1] === 0 && /FUJAIRAH$/.test(r[2]), r);
  await pg.emulateMedia({ media: 'print' });
  r = [await css(pg, '--surface'), await css(pg, '--text'), await css(pg, '--azure'), await disp(pg, 'dash-hero')];
  ok('print uses classic light tokens and hides hero under harbour', J(r) === J(['#FFFFFF', '#101F31', '#0E7A9B', 'none']), r);
  await pg.emulateMedia({ media: 'screen' });
  ok('_skinPal / _skinFont map under harbour', await pg.evaluate(() => _skinPal('rgba(47,111,237,.8)') === 'rgba(21,101,192,.8)' && _skinPal('rgba(249,115,22,1)') === 'rgba(14,159,142,1)' && _skinPal('#fff') === '#fff' && _skinFont('DM Mono') === 'IBM Plex Mono'));
  // 2. switch to classic: restores saved theme (dark here)
  await pg.evaluate(() => { showPage('reports'); toggleSkin(); });
  await pg.waitForTimeout(300);
  r = await pg.evaluate(() => [document.documentElement.dataset.skin, document.documentElement.dataset.theme, Chart.defaults.color, localStorage.getItem('flow-skin'), getComputedStyle(document.getElementById('theme-toggle-btn')).display, document.getElementById('skin-toggle-label').textContent, _skinPal('rgba(47,111,237,.8)'), _skinFont('DM Mono'), getComputedStyle(document.getElementById('dash-hero')).display]);
  ok('toggleSkin -> classic + saved dark, classic chart colour, theme toggle back, hero hidden', J(r) === J(['classic', 'dark', '#C8D6E8', 'classic', 'flex', 'New look', 'rgba(47,111,237,.8)', 'DM Mono', 'none']), r);
  ok('classic dark surface token', await css(pg, '--surface') === '#10192A');
  await pg.evaluate(() => toggleColorTheme());
  ok('classic theme toggle still works', await pg.evaluate(() => document.documentElement.dataset.theme === 'light' && Chart.defaults.color === '#47617D' && localStorage.getItem('flow-theme') === 'light'));
  await pg.evaluate(() => toggleSkin());
  ok('back to harbour (light forced, flow-theme untouched)', await pg.evaluate(() => document.documentElement.dataset.skin === 'harbour' && document.documentElement.dataset.theme === 'light' && localStorage.getItem('flow-skin') === 'harbour' && localStorage.getItem('flow-theme') === 'light'));
  const errs = app.errors.filter(e => !/capacitorExports/.test(e));
  ok('no page errors', errs.length === 0, errs);
  await app.ctx.close();
  // 3. persisted classic honoured before first paint; legacy 'premium' => harbour
  app = await H.openApp(browser, H.createDb(), { appDir, uid: 'user-operator', localStorage: { 'flow-skin': 'classic', 'flow-theme': 'light' } });
  r = await app.page.evaluate(() => [document.documentElement.dataset.skin, document.documentElement.dataset.theme, getComputedStyle(document.getElementById('dash-hero')).display]);
  ok('persisted classic + light honoured on load, hero hidden', J(r) === '["classic","light","none"]', r);
  await app.ctx.close();
  app = await H.openApp(browser, H.createDb(), { appDir, uid: 'user-operator', localStorage: { 'flow-skin': 'premium', 'flow-theme': 'dark' } });
  r = await app.page.evaluate(() => [document.documentElement.dataset.skin, document.documentElement.dataset.theme]);
  ok('legacy premium value treated as harbour', J(r) === '["harbour","light"]', r);
  // 4. html2canvas exports render classic-light under harbour
  r = await app.page.evaluate(async () => { const fake = (el, o) => { const d = document.implementation.createHTMLDocument(''); o.onclone(d); return Promise.resolve([d.documentElement.dataset.skin, d.documentElement.dataset.theme]); }; return _skinWrapH2C(fake)(document.body, {}); });
  ok('html2canvas clone is classic/light under harbour', J(r) === '["classic","light"]', r);
  await app.ctx.close();
  await browser.close();
  console.log(`SKIN: ${p} passed, ${f} failed`); process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
