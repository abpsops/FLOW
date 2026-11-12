/* Calling Instructions — ⬇ Download PDF next to ⬇ Download .docx: the PDF is the generated
   .docx itself (the template's letterhead, fonts, colours, alignment, page size, plus the edits
   made in the preview), drawn page by page in the browser (docx-preview) — not a plain-text copy.
   • after Preview & Generate both buttons show; ⬇ Download .docx downloads the same formatted
     file again (it used to rebuild a plain-text document)
   • one PDF page per document page, A4 like the template, named Calling_Instructions_<vessel>.pdf
   node suites/fix2/calling-pdf.test.js [appDir]   (PDF_OUT=<file> saves the PDF to look at) */
const fs = require('fs');
const path = require('path');
if (process.argv[2]) process.env.APP_DIR = path.resolve(process.argv[2]);
const U = require('../r3/util.js');
const H = U.H;
const JSZip = require('jszip');

let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) pass++; else fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 900)));
}
// A letterhead-style template: big bold blue centred company name, small grey address, body
// lines with placeholders, a page break, A4 page size.
const P = (t, rpr, ppr) => `<w:p><w:pPr>${ppr || ''}</w:pPr><w:r><w:rPr>${rpr || ''}</w:rPr><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const BODY =
  P('GULF PETROL SUPPLIES LLC (BUNKERS)', '<w:b/><w:color w:val="1F4E79"/><w:sz w:val="36"/>', '<w:jc w:val="center"/>') +
  P('FNG Building No. 2, Al Mina Road, Fujairah, U.A.E', '<w:color w:val="7F7F7F"/><w:sz w:val="18"/>', '<w:jc w:val="center"/>') +
  P('') +
  P('To: The Master: {{VESSEL_NAME}}', '<w:b/>') +
  P('Location: {{LOCATION}}') +
  P('Laycan: {{LAYCAN}}') +
  P('Regards') +
  '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
  P('PAGE TWO — SAFETY CHECKLIST', '<w:b/><w:color w:val="C00000"/>', '<w:jc w:val="right"/>');
async function templateB64() {
  const z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  z.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${BODY}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1418"/></w:sectPr></w:body></w:document>`);
  return (await z.generateAsync({ type: 'nodebuffer' })).toString('base64');
}

(async () => {
  const browser = await H.launch();
  const A = await U.open(browser, H.createDb({ workspace: U.seedPayload({}), realtime: false }), 'user-operator');
  try {
    await U.helpers(A);
    const b64 = await templateB64();
    const r = await A.page.evaluate(async (b64) => {
      try { flowWelcomeGo('dashboard'); } catch (e) {}
      const saved = []; const orig = _flowSaveOrShareBlob;
      _flowSaveOrShareBlob = async (b, n) => { saved.push({ name: n, blob: b }); return true; };
      const bytes = async b => new Uint8Array(await b.arrayBuffer());
      try {
        // an uploaded .docx also keeps its text (mammoth) for the preview, as ciLoadTemplate does
        const ab = _base64ToAb(b64);
        _ciTemplates.fuj = { arrayBuffer: ab, fileName: 'fuj.docx', isDocx: true, text: (await mammoth.extractRawText({ arrayBuffer: ab.slice(0) })).value };
        _ciVesselCtx = { vessel: 'M/T ELANDRA SEA', type: 'VLSFO', vlsfoQty: 700, lsmgoQty: 0, location: 'FUJ Anchorage', laycan: '17th - 18th Nov\'26', tplKey: 'fuj' };
        ciOpenPreview();
        const ta = document.getElementById('ci-preview-textarea');
        ta.value = ta.value.replace('Regards', 'Best regards from the ops desk');
        await ciConfirmAndGenerate();
        const shown = getComputedStyle(document.getElementById('ci-pdf2-btn')).display !== 'none' && getComputedStyle(document.getElementById('ci-pdf-btn')).display !== 'none';
        // ⬇ Download .docx again: the same formatted file
        await ciDownloadPDF();
        const docs = saved.filter(x => /\.docx$/.test(x.name));
        const d0 = docs[0] && await bytes(docs[0].blob), d1 = docs[1] && await bytes(docs[1].blob);
        const sameDocx = !!(d0 && d1 && d0.length === d1.length && d0.every((v, i) => v === d1[i]));
        // the .docx content: the edit and the letterhead formatting are in it
        const z = await JSZip.loadAsync(d0); const xml = await z.file('word/document.xml').async('string');
        const btn = document.getElementById('ci-pdf2-btn');
        await ciDownloadCallingPdf(btn);
        const pdf = saved.find(x => /\.pdf$/.test(x.name));
        const pb = pdf ? await bytes(pdf.blob) : new Uint8Array();
        let txt = ''; for (let i = 0; i < pb.length; i++) txt += String.fromCharCode(pb[i]);
        let b64out = ''; for (let i = 0; i < pb.length; i += 0x8000) b64out += String.fromCharCode.apply(null, pb.subarray(i, i + 0x8000));
        return { shown, label: btn.textContent.trim(), names: saved.map(x => x.name), sameDocx, xmlEdit: /Best regards from the ops desk/.test(xml) && /1F4E79/.test(xml) && /ELANDRA SEA/.test(xml),
          head: txt.slice(0, 5), pages: (txt.match(/\/Type \/Page\b/g) || []).length, images: (txt.match(/\/Subtype \/Image/g) || []).length,
          media: (txt.match(/\/MediaBox \[([^\]]+)\]/) || [])[1] || '', err: (document.getElementById('ci-modal-error') || {}).textContent || '', pdfB64: btoa(b64out) };
      } finally { _flowSaveOrShareBlob = orig; }
    }, b64);
    if (process.env.PDF_OUT && r.pdfB64) fs.writeFileSync(process.env.PDF_OUT, Buffer.from(r.pdfB64, 'base64'));
    const mb = r.media.trim().split(/\s+/).map(Number);
    check('after Preview & Generate, ⬇ Download PDF shows next to ⬇ Download .docx', r.shown && r.label === '⬇ Download PDF', r.label);
    check('⬇ Download .docx downloads the same formatted file again (with the preview\'s edit and the letterhead formatting)', r.sameDocx && r.xmlEdit, { sameDocx: r.sameDocx, xmlEdit: r.xmlEdit, names: r.names });
    check('the PDF is named Calling_Instructions_M_T_ELANDRA_SEA.pdf', r.names.includes('Calling_Instructions_M_T_ELANDRA_SEA.pdf'), { names: r.names, err: r.err });
    check('the PDF is the document drawn page by page: 2 pages (the page break kept), each an image of the page, A4 like the template', r.head === '%PDF-' && r.pages === 2 && r.images === 2 && Math.abs(mb[2] - 595.3) < 2 && Math.abs(mb[3] - 841.9) < 2, { pages: r.pages, images: r.images, media: r.media, err: r.err });
    const errs = U.realErrors(A);
    check('no page errors', errs.length === 0, errs.slice(0, 3));
  } catch (e) { check('threw', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
  finally { await A.ctx.close(); }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
