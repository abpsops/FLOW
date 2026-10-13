/* Smoke test: node smoke.js [appDir]   (default: the repository root)
   Loads the app as an operator (empty workspace) and as a trader, visits every
   sidebar page, and fails if any uncaught error / console.error appears. */
const H = require('./harness.js');
const appDir = process.argv[2] || H.APP_DIR;
(async () => {
  const browser = await H.launch();
  let failed = false;
  for (const uid of ['user-operator', 'user-trader']) {
    const db = H.createDb();
    const app = await H.openApp(browser, db, { appDir, uid });
    const pages = await app.page.evaluate(() =>
      [...document.querySelectorAll('[onclick*="showPage("]')]
        .map(el => (el.getAttribute('onclick').match(/showPage\('([^']+)'/) || [])[1])
        .filter(Boolean));
    const unique = [...new Set(pages)];
    for (const p of unique) {
      await app.page.evaluate(p => { try { showPage(p); } catch (e) { console.error('showPage(' + p + ') threw: ' + e.message); } }, p);
      await app.page.waitForTimeout(250);
    }
    const gate = await app.page.evaluate(() => { const g = document.getElementById('operator-gate'); return g ? getComputedStyle(g).display : 'n/a'; });
    console.log(`[${uid}] visited ${unique.length} pages; login gate display=${gate}; errors=${app.errors.length}`);
    app.errors.forEach(e => console.log('   ' + e.split('\n').slice(0, 3).join('\n   ')));
    if (app.errors.length) failed = true;
    await app.ctx.close();
  }
  await browser.close();
  console.log(failed ? 'SMOKE: FAIL' : 'SMOKE: PASS');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
