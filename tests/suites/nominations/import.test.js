/* Import nomination panel — paste text / drop / pick an image → Read →
   review table → edit → Add. Nothing is saved before Add; added rows are
   normal nominations (nomUid, ranges, cloud sync, trader RPC); duplicates
   are flagged; hostile text stays text.
   node suites/nominations/import.test.js [appDir] */
const U = require('../r3/util.js');
const H = U.H;

let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) pass++; else fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 400)));
}
const EMAIL = `Dear Team,

Please find below nomination:

Vessel: MV OCEAN PRIDE (IMO 9321483)
ETA: 22/10/2026 0600LT
Port: Fujairah Anchorage
VLSFO 0.5% 500-600 MT
Agent: GAC

MT SEA LION - KFK
ETA 23rd Oct PM
MGO 100 mt
`;
// In-page: paste / drop helpers built on real ClipboardEvent / DragEvent objects.
const PAGE = () => {
  window.__open = function () {
    const o = document.getElementById('flow-welcome-overlay'); if (o) o.style.display = 'none';
    showPage('nominations');
  };
  window.__pasteText = function (sel, text) {
    const dt = new DataTransfer(); dt.setData('text/plain', text);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    document.querySelector(sel).dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  window.__pngFile = async function () {
    const c = document.createElement('canvas'); c.width = 40; c.height = 20;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 40, 20); g.fillStyle = '#000'; g.fillText('MV X', 2, 14);
    const b = await new Promise(r => c.toBlob(r, 'image/png'));
    return new File([b], 'shot.png', { type: 'image/png' });
  };
  window.__pasteImage = async function () {
    const dt = new DataTransfer(); dt.items.add(await __pngFile());
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    document.getElementById('nimp-zone').dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  window.__dropText = function (text) {
    const dt = new DataTransfer(); dt.setData('text/plain', text);
    const z = document.getElementById('nimp-zone');
    z.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    const dragCls = z.classList.contains('drag');
    z.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    return dragCls && !z.classList.contains('drag');
  };
  window.__rows = function () {
    return Array.from(document.querySelectorAll('#nimp-results tr.nimp-row')).map(tr => {
      const o = {}; tr.querySelectorAll('[data-k]').forEach(el => { o[el.dataset.k] = el.value; if (el.classList.contains('nimp-low')) (o.low = o.low || []).push(el.dataset.k); });
      const msg = tr.nextElementSibling; o.msg = msg ? msg.textContent : '';
      const rem = msg && msg.querySelector('[data-k="remarks"]'); if (rem) o.remarks = rem.value;
      return o;
    });
  };
  window.__names = function () { return captureCurrentState().vessels.map(v => v.name); };
};

(async () => {
  const browser = await H.launch();
  const dialogs = [];
  let dialogMode = 'accept';
  const onDialog = async d => { dialogs.push(d.message()); try { dialogMode === 'accept' ? await d.accept() : await d.dismiss(); } catch (e) {} };
  const db = H.createDb({ workspace: U.seedPayload() });
  const A = await U.open(browser, db, 'user-operator', { onDialog });
  const B = await U.open(browser, db, 'user-operator2');
  for (const x of [A, B]) { await U.helpers(x); await x.page.evaluate(PAGE); }
  const p = A.page;
  p.on('filechooser', () => {});
  await p.evaluate(() => __open());

  console.log('I1 panel, keyboard and paste');
  check('I1 panel starts collapsed', await p.evaluate(() => !document.getElementById('nimp').open));
  await p.focus('#nimp > summary');
  await p.keyboard.press('Enter');
  check('I1 summary opens with the keyboard', await p.evaluate(() => document.getElementById('nimp').open));
  await p.keyboard.press('Tab');
  check('I1 drop zone is the next Tab stop', await p.evaluate(() => document.activeElement && document.activeElement.id === 'nimp-zone'));
  await p.focus('#nimp-zone');
  const chooserP = p.waitForEvent('filechooser', { timeout: 20000 }).catch(() => null);
  await p.waitForTimeout(300); // let Playwright switch on file-chooser interception first
  await p.keyboard.press('Enter');
  const chooser = await chooserP;
  check('I1 Enter on the drop zone opens the image picker', !!chooser && !chooser.isMultiple());
  check('I1 file picker accepts images (camera/gallery on phones)', await p.getAttribute('#nimp-file', 'accept') === 'image/*');
  check('I1 on-device note shown', /never sent anywhere/.test(await p.textContent('#nimp')));
  // paste with the zone focused → lands in the textarea
  await p.focus('#nimp-zone');
  const prevented = await p.evaluate(t => __pasteText('#nimp-zone', t), EMAIL);
  check('I1 text pasted on the zone lands in the textarea', prevented && (await p.inputValue('#nimp-text')).includes('OCEAN PRIDE'));
  // image paste → thumbnail, then removed
  check('I1 pasted image is taken as a screenshot', await p.evaluate(() => __pasteImage()));
  check('I1 thumbnail + ready status', await p.evaluate(() => !document.getElementById('nimp-img').hidden && /Screenshot ready/.test(document.getElementById('nimp-status').textContent) && document.getElementById('nimp-thumb').src.startsWith('blob:')));
  await p.click('#nimp-img button');
  check('I1 image removed', await p.evaluate(() => document.getElementById('nimp-img').hidden && _niImage === null));
  check('I1 dropped text is appended', await p.evaluate(() => __dropText('MV DROPPED ONE')) && (await p.inputValue('#nimp-text')).endsWith('MV DROPPED ONE'));
  await p.fill('#nimp-text', EMAIL);

  console.log('I2 read → review → edit → add');
  const w0 = U.writes(db, 'user-operator').length, v0 = U.row(db).version;
  const cards0 = await p.evaluate(() => __names());
  await p.click('#nimp-read');
  await p.waitForSelector('#nimp-results tr.nimp-row');
  let rows = await p.evaluate(() => __rows());
  check('I2 two draft rows', rows.length === 2, rows);
  check('I2 row 1 fields', rows[0].name === 'OCEAN PRIDE' && rows[0].imo === '9321483' && rows[0].eta === '22 Oct 2026 06:00' && rows[0].qtyText === '500–600' && rows[0].area === 'FUJ-A', rows[0]);
  check('I2 row 2 fields', rows[1].name === 'SEA LION' && rows[1].mgoText === '100' && rows[1].area === 'KFK-A' && rows[1].eta === '23 Oct 2026 18:00', rows[1]);
  check('I2 guessed field highlighted (AM/PM → time)', (rows[1].low || []).includes('eta') && /Check:/.test(rows[1].msg), rows[1]);
  check('I2 original text visible in a collapsible box', await p.evaluate(() => { const d = document.querySelector('#nimp-results details.nimp-src'); return !!d && !d.open && d.querySelector('pre').textContent.includes('Dear Team'); }));
  check('I2 nothing saved after Read', U.writes(db, 'user-operator').length === w0 && U.row(db).version === v0 && JSON.stringify(await p.evaluate(() => __names())) === JSON.stringify(cards0));
  // edit row 2 inline: name, quantity as a range, clear the guessed flag
  await p.fill('#nimp-row-1 [data-k="name"]', 'SEA LION II');
  await p.fill('#nimp-row-1 [data-k="mgoText"]', '90-100');
  await p.fill('#nimp-row-1 [data-k="eta"]', '23 Oct 2026 20:00');
  rows = await p.evaluate(() => __rows());
  check('I2 edited values kept, flag cleared', rows[1].name === 'SEA LION II' && rows[1].mgoText === '90-100' && !(rows[1].low || []).includes('eta'), rows[1]);
  check('I2 still nothing saved while editing', U.writes(db, 'user-operator').length === w0);
  check('I2 add button counts the rows', /Add 2 nominations/.test(await p.textContent('#nimp-add-all')));
  await p.click('#nimp-add-all');
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => captureCurrentState().vessels.filter(v => /OCEAN PRIDE|SEA LION/.test(v.name)));
  const op = after.find(v => v.name === 'OCEAN PRIDE'), sl = after.find(v => v.name === 'SEA LION II');
  check('I2 two cards added', after.length === 2, after.map(v => v.name));
  check('I2 OCEAN PRIDE card: range + fields', op && op.qty === 600 && op.qtyMin === 500 && op.qtyMax === 600 && op.imo === '9321483' && op.eta === '22 Oct 2026 06:00' && op.area === 'FUJ-A' && op.type === 'VLSFO' && /^nom_/.test(op.nomUid), op);
  check('I2 SEA LION II card: edited name + MGO range', sl && sl.type === 'MGO' && sl.mgo === 100 && sl.mgoMin === 90 && sl.eta === '23 Oct 2026 20:00' && sl.area === 'KFK-A', sl);
  check('I2 card shows the range in its qty box', await p.evaluate(() => { const c = Array.from(document.querySelectorAll('.vcard')).find(x => x.querySelector('[id$="-name"]').value === 'OCEAN PRIDE'); return c && c.querySelector('[id$="-vlsfo"]').value === '500–600'; }));
  check('I2 review table emptied after adding', await p.evaluate(() => !document.querySelector('#nimp-results tr.nimp-row') && /Added 2 nominations/.test(document.getElementById('nimp-status').textContent)));
  const cloud = U.row(db).payload.state.vessels;
  check('I2 saved to the cloud with ranges', cloud.some(v => v.name === 'OCEAN PRIDE' && v.qtyMin === 500 && v.qtyMax === 600) && cloud.some(v => v.name === 'SEA LION II' && v.mgoMin === 90), cloud.map(v => v.name));
  await B.page.evaluate(() => _pollOnce(true));
  check('I2 second device has both, with the range', await B.page.evaluate(() => { const n = captureCurrentState().vessels.find(v => v.name === 'OCEAN PRIDE'); return !!n && n.qtyMin === 500 && __names().includes('SEA LION II') && __getV(n.nomUid, 'vlsfo') === '500–600'; }));

  console.log('I3 duplicates');
  await p.fill('#nimp-text', 'MV ALPHA ETA 21 Oct 2026 10:00 VLSFO 300 MT\n\nMV PRIDE OF OCEANS IMO 9321483 ETA 30 Oct 2026 0600 VLSFO 100 MT\n\nMV BRAND NEW ETA 30 Oct 2026 0900 VLSFO 50 MT');
  await p.click('#nimp-read');
  await p.waitForSelector('#nimp-results tr.nimp-row');
  rows = await p.evaluate(() => __rows());
  check('I3 same name, ETA within 2 days → duplicate warning', /Possible duplicate: ALPHA/.test(rows[0].msg), rows[0].msg);
  check('I3 same IMO → duplicate warning', /Possible duplicate: OCEAN PRIDE/.test(rows[1].msg) && /9321483/.test(rows[1].msg), rows[1].msg);
  check('I3 new vessel not flagged', !/duplicate/i.test(rows[2].msg), rows[2].msg);
  dialogMode = 'dismiss'; dialogs.length = 0;
  const n0 = (await p.evaluate(() => __names())).length;
  await p.click('#nimp-row-0 button:has-text("Add")');
  await p.waitForTimeout(200);
  check('I3 adding a duplicate asks first; Cancel adds nothing', dialogs.some(m => /already in the register/.test(m) && /ALPHA/.test(m)) && (await p.evaluate(() => __names())).length === n0);
  dialogMode = 'accept';
  await p.click('#nimp-row-2 button:has-text("Add")');
  await p.waitForTimeout(200);
  check('I3 per-row Add adds just that row', (await p.evaluate(() => __names())).filter(n => n === 'BRAND NEW').length === 1 && (await p.evaluate(() => __rows())).length === 2);
  await p.click('#nimp-results button:has-text("Discard")');
  check('I3 Discard clears the review', await p.evaluate(() => !document.querySelector('#nimp-results tr') && document.getElementById('nimp-text').value === ''));

  console.log('I4 validation + hostile text');
  await p.fill('#nimp-text', 'MV NO DATE VLSFO 100 MT');
  await p.click('#nimp-read');
  await p.waitForSelector('#nimp-results tr.nimp-row');
  const nBad = (await p.evaluate(() => __names())).length;
  await p.click('#nimp-add-all');
  check('I4 row without ETA/laycan is not added', (await p.evaluate(() => __names())).length === nBad && /need/.test(await p.textContent('#nimp-status')));
  check('I4 missing ETA highlighted red', await p.evaluate(() => document.querySelector('#nimp-row-0 [data-k="eta"]').classList.contains('nimp-miss') && /Needs/.test(document.getElementById('nimp-msg-0').textContent)));
  await p.fill('#nimp-row-0 [data-k="lc"]', '1-3 Nov 2026');
  check('I4 a laycan is enough', await p.evaluate(() => !/Needs/.test(document.getElementById('nimp-msg-0').textContent)));
  await p.click('#nimp-add-all');
  check('I4 fixed row added', (await p.evaluate(() => __names())).includes('NO DATE'));
  const evil = 'Vessel: <img src=x onerror="window.__xss=1">PAPA <b>BOLD</b>\nETA 26 Oct 2026 0800\nVLSFO 100 MT\nAgent: <svg onload="window.__xss=2">x\nRemarks: <script>window.__xss=3</script>"quoted" & done';
  await p.fill('#nimp-text', evil);
  await p.click('#nimp-read');
  await p.waitForSelector('#nimp-results tr.nimp-row');
  const x = await p.evaluate(() => ({ imgs: document.querySelectorAll('#nimp-results img, #nimp-results svg:not([aria-hidden]), #nimp-results script, #nimp-results b').length, pre: document.querySelector('#nimp-results pre').textContent, row: __rows()[0] }));
  check('I4 hostile text shown as text only', x.imgs === 0 && x.pre.includes('<img src=x') && x.pre.includes('<script>'), x);
  check('I4 hostile vessel name cleaned', x.row.name === 'PAPA BOLD', x.row);
  check('I4 hostile agent/remarks kept as plain values', /<svg/.test(x.row.agent) && /<script>/.test(x.row.remarks), x.row);
  await p.click('#nimp-add-all');
  await p.waitForTimeout(200);
  await p.evaluate(() => { renderTrashBin && renderTrashBin(); showPage('dashboard'); showPage('nominations'); });
  check('I4 no script ran', await p.evaluate(() => window.__xss === undefined));
  check('I4 hostile vessel added as plain text', (await p.evaluate(() => __names())).includes('PAPA BOLD'));

  console.log('I5 trader imports');
  const T = await U.open(browser, db, 'user-trader');
  await U.helpers(T); await T.page.evaluate(PAGE);
  const t = T.page;
  await t.evaluate(() => __open());
  check('I5 trader sees the panel', await t.isVisible('#nimp > summary'));
  await t.click('#nimp > summary');
  await t.fill('#nimp-text', 'MV TRADER STAR\nETA 28 Oct 2026 1100\nVLSFO 700-800 MT\nLSMGO 50 MT\nKhor Fakkan');
  await t.click('#nimp-read');
  await t.waitForSelector('#nimp-results tr.nimp-row');
  const rpc0 = db.log.filter(o => o.action === 'rpc' && o.name === 'trader_update_vessels').length;
  check('I5 trader: nothing written before Add', db.log.filter(o => o.action === 'rpc' && o.name === 'trader_update_vessels').length === rpc0);
  await t.click('#nimp-add-all');
  await t.waitForTimeout(500);
  const rpc = db.log.filter(o => o.action === 'rpc' && o.name === 'trader_update_vessels').pop();
  const tv = rpc && rpc.args.new_vessels.find(v => v.name === 'TRADER STAR');
  check('I5 trader nomination saved through trader_update_vessels', !!tv && tv.qty === 800 && tv.qtyMin === 700 && tv.mgo === 50 && tv.type === 'BOTH' && tv.area === 'KFK-A', tv);
  await p.evaluate(() => _pollOnce(true));
  check('I5 operator sees the trader\'s import with its range', await p.evaluate(() => { const v = captureCurrentState().vessels.find(x => x.name === 'TRADER STAR'); return !!v && __getV(v.nomUid, 'vlsfo') === '700–800'; }));

  const errs = [A, B, T].flatMap(U.realErrors);
  check('no page errors', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log(`import.test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
