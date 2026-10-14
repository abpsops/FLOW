/* Import nomination — screenshot path with the REAL Tesseract.js (WebAssembly,
   in a worker), under the real vercel.json CSP. The screenshots are made here:
   a typed nomination rendered in a styled div and captured as PNG (one light
   e-mail style, one dark-mode chat bubble). Tesseract, its core and the English
   model are served from tests/node_modules via the harness CDN_MAP, mapped
   from the pinned jsdelivr URLs the app uses.
   node suites/nominations/ocr.test.js [appDir] */
const fs = require('fs');
const path = require('path');
const H = require('../../harness/harness.js');
const appDir = process.argv[2] || H.APP_DIR;

let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) pass++; else fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 600)));
}
const csp = JSON.parse(fs.readFileSync(path.join(appDir, 'vercel.json'), 'utf8')).headers[0].headers.find(h => h.key === 'Content-Security-Policy').value;

async function shot(ctx, html) {
  const pg = await ctx.newPage();
  await pg.setContent('<body style="margin:0">' + html + '</body>');
  const png = await pg.locator('#n').screenshot();
  await pg.close();
  return png;
}
async function readImage(page, via, png) {
  if (via === 'file') await page.setInputFiles('#nimp-file', { name: 'nomination.png', mimeType: 'image/png', buffer: png });
  else await page.evaluate(async (b64) => {
    const bin = atob(b64), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const dt = new DataTransfer(); dt.items.add(new File([u8], 'image.png', { type: 'image/png' }));
    document.getElementById('nimp-zone').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, png.toString('base64'));
  const t0 = Date.now();
  await page.click('#nimp-read');
  const seen = [];
  for (;;) {
    const st = await page.textContent('#nimp-status');
    if (seen[seen.length - 1] !== st) seen.push(st);
    if (/Found|Could not|No text|No nomination/.test(st) || Date.now() - t0 > 240000) break;
    await page.waitForTimeout(150);
  }
  const rows = await page.evaluate(() => _niDrafts.map(d => ({ name: d.name, eta: d.eta, qtyText: d.qtyText, mgoText: d.mgoText, area: d.area, imo: d.imo })));
  return { secs: (Date.now() - t0) / 1000, seen, rows, text: await page.inputValue('#nimp-text') };
}

(async () => {
  const browser = await H.launch();
  const db = H.createDb();
  db.cdnLog = [];
  const app = await H.openApp(browser, db, { appDir, uid: 'user-operator', csp });
  const page = app.page;
  await page.evaluate(() => {
    window.__viol = [];
    document.addEventListener('securitypolicyviolation', e => window.__viol.push(e.violatedDirective + ' ' + e.blockedURI));
    const o = document.getElementById('flow-welcome-overlay'); if (o) o.style.display = 'none';
    showPage('nominations'); document.getElementById('nimp').open = true;
  });
  check('Tesseract is not loaded until an image is read', await page.evaluate(() => typeof window.Tesseract === 'undefined') && !db.cdnLog.some(u => /tesseract/.test(u)));

  // 1) light e-mail style screenshot, picked with the file picker
  const png1 = await shot(app.ctx, '<div id="n" style="font:20px Arial,Helvetica,sans-serif;padding:22px 26px;width:640px;background:#fff;color:#111;line-height:1.55">' +
    'Dear Team,<br><br>Please find below nomination:<br><br>Vessel: MV OCEAN PRIDE<br>IMO 9321483<br>ETA 16/10/2026 0600 LT<br>Location: Fujairah Anchorage<br>VLSFO 500-600 MT<br>LSMGO 50 MT<br>Agent: GAC<br><br>Best regards</div>');
  const r1 = await readImage(page, 'file', png1);
  console.log('   OCR #1 ' + r1.secs.toFixed(1) + 's: ' + JSON.stringify(r1.text));
  check('OCR #1 progress shown while reading', r1.seen.some(s => /Reading screenshot… \d+%/.test(s)) || r1.seen.some(s => /Loading OCR engine/.test(s)), r1.seen);
  check('OCR #1 one draft', r1.rows.length === 1, r1.rows);
  const a = r1.rows[0] || {};
  check('OCR #1 vessel name', a.name === 'OCEAN PRIDE', a);
  check('OCR #1 ETA', a.eta === '16 Oct 2026 06:00', a);
  check('OCR #1 VLSFO range + LSMGO', a.qtyText === '500–600' && a.mgoText === '50', a);
  check('OCR #1 IMO + location', a.imo === '9321483' && a.area === 'FUJ-A', a);
  check('OCR #1 text placed in the box for checking', /OCEAN PRIDE/.test(r1.text));

  // 2) dark-mode chat bubble, pasted (two vessels; inverted before OCR)
  const png2 = await shot(app.ctx, '<div id="n" style="font:19px Arial,Helvetica,sans-serif;padding:20px 24px;width:600px;background:#0b141a;color:#e9edef;line-height:1.6">' +
    'MV SEA BREEZE<br>ETA 18 Oct 2026 1400<br>VLSFO 800 MT<br>KFK anchorage<br><br>MT BLUE HERON<br>ETA 19 Oct 2026 0900<br>LSMGO 120-150 MT<br>Fujairah berth</div>');
  await page.click('#nimp-results button:has-text("Discard")');
  const r2 = await readImage(page, 'paste', png2);
  console.log('   OCR #2 ' + r2.secs.toFixed(1) + 's: ' + JSON.stringify(r2.text));
  check('OCR #2 two drafts from one screenshot', r2.rows.length === 2, r2.rows);
  const [b, c] = [r2.rows[0] || {}, r2.rows[1] || {}];
  check('OCR #2 vessel names', b.name === 'SEA BREEZE' && c.name === 'BLUE HERON', r2.rows);
  check('OCR #2 ETAs', b.eta === '18 Oct 2026 14:00' && c.eta === '19 Oct 2026 09:00', r2.rows);
  check('OCR #2 quantities', b.qtyText === '800' && c.mgoText === '120–150', r2.rows);
  check('OCR #2 locations', b.area === 'KFK-A' && c.area === 'FUJ-B', r2.rows);

  // add one → a normal nomination
  await page.click('#nimp-add-all');
  await page.waitForTimeout(300);
  check('OCR drafts add as nominations', await page.evaluate(() => captureCurrentState().vessels.filter(v => /SEA BREEZE|BLUE HERON/.test(v.name)).length === 2));

  const tess = db.cdnLog.filter(u => /tesseract/.test(u));
  check('only the pinned jsdelivr URLs were fetched', tess.length >= 4 && tess.every(u => /^https:\/\/cdn\.jsdelivr\.net\/npm\/(tesseract\.js@6\.0\.1\/dist\/|tesseract\.js-core@6\.0\.0\/|@tesseract\.js-data\/eng@1\.0\.0\/4\.0\.0_best_int\/)/.test(u)), tess);
  check('works under the real CSP (no violations)', (await page.evaluate(() => window.__viol)).length === 0, await page.evaluate(() => window.__viol));
  const errs = app.errors.filter(e => !/capacitorExports/.test(e));
  check('no page errors', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log(`ocr.test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
