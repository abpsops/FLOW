/* R5 docx / storage / export / wipe tests. node r5_io.test.js [appDir] */
const fs = require('fs');
const path = require('path');
const H = require('../../harness/harness.js');
const JSZip = require('jszip/dist/jszip.min.js');
const XLSX = require('xlsx/dist/xlsx.full.min.js');
const appDir = process.argv[2] || H.APP_DIR;
let fails = 0;
const ok = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).slice(0, 1500))); if (!cond) fails++; };

const W = (t) => `<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const docXmlOf = (body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`;

(async () => {
  const browser = await H.launch();
  const db = H.createDb();
  const app = await H.openApp(browser, db, { appDir });
  const page = app.page;
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const mkDocx = async (body) => {
    const z = new JSZip();
    z.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
    z.file('word/document.xml', docXmlOf(body));
    return (await z.generateAsync({ type: 'nodebuffer' })).toString('base64');
  };
  const readDownloadDocXml = async (dl) => { const z = await JSZip.loadAsync(fs.readFileSync(await dl.path())); return z.file('word/document.xml').async('string'); };

  // ── 5a. xmlQtyReplace via a placeholder template with literal quantity lines ──
  const tplA = await mkDocx(W('To: The Master: {{VESSEL_NAME}}') + W('RMG: 500 MT / 380 CST') +
    '<w:p><w:r><w:t>MGO:</w:t></w:r><w:r><w:t xml:space="preserve"> 100 MT</w:t></w:r></w:p>' + W('Next line 999 MT'));
  const a = await ev(async (b64) => {
    const ab = _base64ToAb(b64);
    const r = await _ciCloneDocxSubstitute(ab, { vessel: 'NEW SHIP', type: 'BOTH', vlsfoQty: 1234, lsmgoQty: 56, location: 'KFK Anchorage', laycan: '1st Jan' });
    return { xml: r.docXml, warnings: r.warnings };
  }, tplA);
  ok('docx qty: RMG same-run replaced', a.xml.includes('RMG: 1,234 MT') && !a.xml.includes('500 MT'), a.xml);
  ok('docx qty: MGO split-run replaced', a.xml.includes('> 56 MT') && !a.xml.includes('100 MT'), a.xml);
  ok('docx qty: unrelated next paragraph untouched', a.xml.includes('Next line 999 MT'), a.xml);
  ok('docx placeholder vessel replaced, no warnings', a.xml.includes('To: The Master: NEW SHIP') && a.warnings.length === 0, a);

  // ── 5b. placeholder-less template: download applies the preview's fallback ──
  const tplB = await mkDocx(W('To: The Master: OLD VESSEL') + W('Location: FUJAIRAH ANCHORAGE') + W('RMG: - 500 MT / 380 CST / 0.5% MAX SULFUR') + W('MGO: - 100 MT / DMA / 0.1% MAX SULFUR') + W('Regards'));
  await ev((b64) => {
    _ciTemplates.kfk = { arrayBuffer: _base64ToAb(b64), fileName: 't.docx', isDocx: true, text: null };
    _ciVesselCtx = { vessel: 'M/T NEW ONE', type: 'BOTH', vlsfoQty: 1234, lsmgoQty: 56, location: 'KFK Anchorage', laycan: '1st Jan', tplKey: 'kfk' };
  }, tplB);
  const tplText = 'To: The Master: OLD VESSEL\nLocation: FUJAIRAH ANCHORAGE\nRMG: - 500 MT / 380 CST / 0.5% MAX SULFUR\nMGO: - 100 MT / DMA / 0.1% MAX SULFUR\nRegards';
  const preview = await ev((t) => ciApplyTemplate(t, _ciVesselCtx), tplText);
  const [dlB] = await Promise.all([page.waitForEvent('download'), ev(() => ciCloneDocxAndDownload(_ciTemplates.kfk.arrayBuffer, _ciVesselCtx))]);
  const xmlB = await readDownloadDocXml(dlB);
  const textB = [...xmlB.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map(m => [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:br\/>/g)].map(x => x[1] === undefined ? '\n' : x[1]).join('')).join('\n');
  ok('docx fallback: downloaded text equals preview', textB.trim() === preview.trim(), { textB, preview });
  ok('docx fallback: formatting (rPr bold) kept on rebuilt paragraph', /<w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">To: The Master: M\/T NEW ONE/.test(xmlB), xmlB);
  ok('download filename sanitized ("/" removed)', dlB.suggestedFilename() === 'Calling_Instructions_M_T_NEW_ONE.docx', dlB.suggestedFilename());

  // ── 5c. no placeholders and nothing recognisable → warns before download ──
  const tplC = await mkDocx(W('Hello world'));
  const warned = await ev(async (b64) => {
    let msg = null; const oc = window.confirm; window.confirm = (m) => { msg = m; return false; };
    try { await ciCloneDocxAndDownload(_base64ToAb(b64), _ciVesselCtx); } finally { window.confirm = oc; }
    return msg;
  }, tplC);
  ok('docx: unfaithful template warns (and cancel aborts)', !!warned && /may not exactly match/.test(warned), warned);

  // ── 15. ctx id set → live DOM re-read; .doc rejected ──
  const ctxRes = await ev(() => {
    const box = document.createElement('div'); box.id = '__vbox';
    box.innerHTML = '<input id="v77-name" value="ship x"><select id="v77-type"><option value="BOTH" selected>BOTH</option></select><input id="v77-vlsfo" value="100"><input id="v77-mgo" value="20"><select id="v77-area"><option value="KFK-A" selected>KFK-A</option></select><input id="v77-lc" value="22-24 Apr 2026">';
    document.body.appendChild(box);
    ciOpenForVessel(77);
    const id = _ciVesselCtx.id;
    document.getElementById('v77-vlsfo').value = '777';
    _ciTemplates.kfk = { arrayBuffer: null, fileName: 't.txt', isDocx: false, text: 'RMG: - 1 MT\nAt FUJAIRAH ANCHORAGE' };
    ciOpenPreview();
    const ta = document.getElementById('ci-preview-textarea').value;
    ciClosePreview(); ciCloseModal(); box.remove();
    return { id, ta };
  });
  ok('_ciVesselCtx.id is set and preview re-reads live quantity', ctxRes.id === 77 && /777 MT/.test(ctxRes.ta), ctxRes);
  const docRej = await ev(() => {
    _ciTemplates.fuj = null;
    ciLoadTemplate('fuj', { files: [new File(['x'], 'legacy.doc')], value: 'legacy.doc' });
    return { tpl: _ciTemplates.fuj, status: (document.getElementById('ci-fuj-status') || {}).textContent || '' };
  });
  ok('.doc template rejected with a clear message', docRej.tpl === null && /not supported/.test(docRej.status), docRej);

  // ── 13. templates: migrate localStorage → IndexedDB, survive reload ──
  const mig = await ev(async (b64) => {
    _ciTemplates.kfk = null; _ciTemplates.fuj = null;
    localStorage.setItem('abps_ci_templates_v1', JSON.stringify({ kfk: { fileName: 'k.docx', isDocx: true, text: 'T', arrayBufferB64: b64 }, fuj: null }));
    await _ciLoadTemplates();
    return { oldKey: localStorage.getItem('abps_ci_templates_v1'), loaded: !!(_ciTemplates.kfk && _ciTemplates.kfk.arrayBuffer && _ciTemplates.kfk.arrayBuffer.byteLength) };
  }, tplA);
  ok('templates migrated from localStorage (old key removed)', mig.oldKey === null && mig.loaded, mig);
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(2500);
  const afterReload = await ev(async () => { await _ciLoadTemplates(); return { kfk: _ciTemplates.kfk && _ciTemplates.kfk.fileName, bytes: _ciTemplates.kfk && _ciTemplates.kfk.arrayBuffer && _ciTemplates.kfk.arrayBuffer.byteLength, ls: localStorage.getItem('abps_ci_templates_v1') }; });
  ok('templates load from IndexedDB after reload', afterReload.kfk === 'k.docx' && afterReload.bytes > 0 && afterReload.ls === null, afterReload);
  const cleared = await ev(async () => { _ciClearTemplates(); await new Promise(r => setTimeout(r, 200)); _ciTemplates.kfk = null; await _ciLoadTemplates(); return _ciTemplates.kfk; });
  ok('_ciClearTemplates clears IndexedDB', cleared === null, cleared);

  // ── 14. native save path ──
  const nat = await ev(async () => {
    const before = document.querySelectorAll('#toast-stack .toast').length;
    window.Capacitor = { isNativePlatform: () => true, Plugins: { Filesystem: { writeFile: async (o) => { window.__wpath = o.path; throw new Error('disk full'); } }, Share: { share: async () => {} } } };
    let clicked = false; const oc = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { clicked = true; };
    const r1 = await _flowSaveOrShareBlob(new Blob(['x']), 'FLOW M/T A\\B:1.pdf');
    const toasts = [...document.querySelectorAll('#toast-stack .toast')].slice(before).map(t => t.textContent);
    window.Capacitor.Plugins.Filesystem.writeFile = async (o) => { window.__wpath2 = o.path; return { uri: 'file:///cache/' + o.path }; };
    const r2 = await _flowSaveOrShareBlob(new Blob(['x']), 'M/T B.xlsx');
    HTMLAnchorElement.prototype.click = oc; delete window.Capacitor;
    return { r1, r2, clicked, p1: window.__wpath, p2: window.__wpath2, toasts };
  });
  ok('native save failure → false + error toast, no <a download> fallback', nat.r1 === false && !nat.clicked && nat.toasts.some(t => /disk full/.test(t)), nat);
  ok('native path has no separators', nat.p1 === 'FLOW M_T A_B_1.pdf' && nat.p2 === 'M_T B.xlsx' && nat.r2 === true, nat);

  // ── 15. downloadExcel: sequence per barge ──
  await ev(() => {
    const t0 = new Date(2026, 0, 1, 8).getTime(), h = 3600e3;
    _bargeStates = {};
    _lastSched = [
      { sno: 1, name: 'A1', bargeLabel: 'B1', bargeStart: new Date(t0), etc: new Date(t0 + 2 * h), eta: new Date(t0), vQ: 1, mQ: 0, lc: null },
      { sno: 2, name: 'B-FIRST', bargeLabel: 'B2', bargeStart: new Date(t0 + 3 * h), etc: new Date(t0 + 4 * h), eta: new Date(t0), vQ: 1, mQ: 0, lc: null },
      { sno: 3, name: 'A2', bargeLabel: 'B1', bargeStart: new Date(t0 + 5 * h), etc: new Date(t0 + 6 * h), eta: new Date(t0), vQ: 1, mQ: 0, lc: null },
    ];
  });
  const [dlX] = await Promise.all([page.waitForEvent('download'), ev(() => downloadExcel())]);
  const wb = XLSX.read(fs.readFileSync(await dlX.path()));
  const rowsX = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }).filter(r => ['A1', 'B-FIRST', 'A2'].includes(r[1])).map(r => r[10]);
  ok('downloadExcel: Supply Plan per barge', JSON.stringify(rowsX) === JSON.stringify(['On Arrival', 'On Arrival', 'After A1']), rowsX);

  // ── 8. nuclearClear writes archive tombstones ──
  const nc = await ev(async () => {
    _archives = { 2025: { Jan: { records: [{ id: 'q', vessel: 'Q' }], archivedAt: '2025-02-01T00:00:00Z', month: 0, year: 2025 } } };
    await nuclearClear();
    const t = _archives[2025] && _archives[2025].Jan;
    _mergeArchives({ 2025: { Jan: { records: [{ id: 'q', vessel: 'Q' }], archivedAt: '2025-02-01T00:00:00Z', month: 0, year: 2025 } } });
    return { t, after: _archives[2025].Jan.deleted === true };
  });
  ok('Clear All Data tombstones archives (not resurrected by merge)', nc.t && nc.t.deleted === true && nc.after, nc);
  await app.ctx.close();

  // ── 11. Wipe Supabase: failure is reported, success clears memory + pauses sync ──
  const db2 = H.createDb({ workspace: { state: {}, records: [], version: 1 } });
  let alertMsg = '';
  const app2 = await H.openApp(browser, db2, { appDir, onDialog: d => { if (d.type() === 'alert') alertMsg = d.message(); d.accept(); } });
  db2.intercept = (op) => (op.action === 'delete' ? { data: null, error: { message: 'permission denied (RLS)' } } : null);
  const wf = await app2.page.evaluate(async () => {
    _savedSupplies = [{ id: 'keep', vessel: 'K' }];
    await wipeSupabaseWorkspace();
    return { n: _savedSupplies.length, syncing: _isSyncing, interval: !!_syncInterval };
  });
  ok('wipe failure: alert shown, data kept, auto-sync resumed', /NOT deleted/.test(alertMsg) && /permission denied/.test(alertMsg) && wf.n === 1 && !wf.syncing && wf.interval, { alertMsg, wf, ops: db2.log.filter(o => o.action === 'delete').length });
  ok('wipe failure: cloud row still present', db2.tables.abps_workspace.has('main'));
  db2.intercept = null;
  const ws = await app2.page.evaluate(async () => {
    _savedSupplies = [{ id: 'gone', vessel: 'G' }]; _archives = { 2025: {} }; _manualROB = { x: 1 };
    window.__marker = 1;
    await wipeSupabaseWorkspace();
    return { n: _savedSupplies.length, a: Object.keys(_archives).length, rob: Object.keys(_manualROB).length, syncing: _isSyncing, interval: !!_syncInterval };
  });
  ok('wipe success: memory cleared, sync paused', ws.n === 0 && ws.a === 0 && ws.rob === 0 && ws.syncing === true && ws.interval === false, ws);
  ok('wipe success: cloud row deleted', !db2.tables.abps_workspace.has('main'));
  await app2.page.waitForTimeout(2500);
  ok('wipe success: page reloaded clean', await app2.page.evaluate(() => typeof window.__marker === 'undefined' && _savedSupplies.length === 0));
  const errs = app.errors.concat(app2.errors).filter(e => !/capacitorExports|Native save failed|Could not save/.test(e));
  ok('no unexpected page errors', errs.length === 0, errs);
  await app2.ctx.close();

  await browser.close();
  console.log(fails ? `R5 IO: ${fails} FAILED` : 'R5 IO: ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
