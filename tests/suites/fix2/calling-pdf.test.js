/* Calling Instructions — ⬇ Download PDF next to ⬇ Download .docx.
   • after Preview & Generate both buttons show; the PDF holds the same text as the generated
     document (with the edits made in the preview), as a real text PDF on A4
   • long lines wrap, blank lines are kept, a long document runs onto numbered pages
   • file name Calling_Instructions_<vessel>.pdf (characters like "/" replaced)
   node suites/fix2/calling-pdf.test.js [appDir] */
const path = require('path');
if (process.argv[2]) process.env.APP_DIR = path.resolve(process.argv[2]);
const U = require('../r3/util.js');
const H = U.H;

let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) pass++; else fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 900)));
}

(async () => {
  const browser = await H.launch();
  const A = await U.open(browser, H.createDb({ workspace: U.seedPayload({}), realtime: false }), 'user-operator');
  try {
    await U.helpers(A);
    const r = await A.page.evaluate(async () => {
      try { flowWelcomeGo('dashboard'); } catch (e) {}
      const saved = []; const orig = _flowSaveOrShareBlob;
      _flowSaveOrShareBlob = async (b, n) => { saved.push({ name: n, blob: b }); return true; };
      try {
        _ciTemplates.fuj = { text: 'Gulf Petrol Supplies LLC (Bunkers)\n\nTo: The Master: OLD VESSEL\nLocation: FUJAIRAH ANCHORAGE\nRMG: - 500 MT / 380 CST / 0.5% MAX SULFUR\n\nRegards', isDocx: false, fileName: 'fuj.txt' };
        _ciVesselCtx = { vessel: 'M/T ELANDRA SEA', type: 'VLSFO', vlsfoQty: 700, lsmgoQty: 0, location: 'FUJ Anchorage', laycan: '17th - 18th Nov\'26', tplKey: 'fuj' };
        ciOpenPreview();
        const ta = document.getElementById('ci-preview-textarea');
        ta.value = ta.value + '\nEDITED LINE: please confirm arrival 2 hrs before\n' + 'A very long line of instructions '.repeat(12) + '\n' + Array.from({ length: 90 }, (_, i) => 'Clause ' + (i + 1)).join('\n');
        await ciConfirmAndGenerate();
        const shown = getComputedStyle(document.getElementById('ci-pdf2-btn')).display !== 'none' && getComputedStyle(document.getElementById('ci-pdf-btn')).display !== 'none';
        const btn = document.getElementById('ci-pdf2-btn');
        await ciDownloadCallingPdf(btn);
        const pdf = saved.find(x => /\.pdf$/.test(x.name));
        const buf = new Uint8Array(await pdf.blob.arrayBuffer()); let txt = ''; for (let i = 0; i < buf.length; i++) txt += String.fromCharCode(buf[i]);
        return { shown, label: btn.textContent.trim(), names: saved.map(x => x.name), head: txt.slice(0, 5), txt, size: buf.length };
      } finally { _flowSaveOrShareBlob = orig; }
    });
    const t = r.txt;
    check('after Preview & Generate, ⬇ Download PDF shows next to ⬇ Download .docx', r.shown && r.label === '⬇ Download PDF', r);
    check('the PDF is named Calling_Instructions_M_T_ELANDRA_SEA.pdf (and the .docx still downloads)', r.names.includes('Calling_Instructions_M_T_ELANDRA_SEA.pdf') && r.names.some(n => /\.docx$/.test(n)), r.names);
    check('a real text PDF with the generated text, the vessel and the edit made in the preview', r.head === '%PDF-' && /Gulf Petrol Supplies LLC/.test(t) && /M\/T ELANDRA SEA/.test(t) && /EDITED LINE: please confirm arrival/.test(t) && !/\/Subtype \/Image/.test(t), { size: r.size });
    check('a long document runs onto numbered pages, the last clause included', /Page 1 of [2-9]/.test(t) && /Clause 90/.test(t), (t.match(/Page \d of \d/g) || []).slice(0, 3));
    const errs = U.realErrors(A);
    check('no page errors', errs.length === 0, errs.slice(0, 3));
  } catch (e) { check('threw', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
  finally { await A.ctx.close(); }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
