/* Calling Instructions — ⬇ Download PDF next to ⬇ Download .docx: the PDF is the generated
   .docx itself (the template's letterhead, fonts, colours, alignment, page size, plus the edits
   made in the preview), drawn page by page in the browser (docx-preview) — not a plain-text copy.
   • after Preview & Generate both buttons show; ⬇ Download .docx downloads the same formatted
     file again (it used to rebuild a plain-text document)
   • one PDF page per document page, A4 like the template, named Calling_Instructions_<vessel>.pdf
   • a letter longer than a page (no page break in the file) flows onto page 2 the way Word does,
     each PDF page A4 and unstretched
   • never a blank page (a typed page break at the foot of page 1 stays on page 1)
   • Office fonts the device lacks (Century, Calibri, …) are drawn with free look-alikes
   node suites/fix2/calling-pdf.test.js [appDir]   (PDF_OUT / PDF_OUT2 / PDF_OUT3=<file> save the PDFs to look at) */
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
const LONG_PARAS = [
  'Good day,',
  'We will be supplying bunkers to your good vessel at {{LOCATION}}. Grade and quantity to be supplied are as below.',
  'RMG: - {{VLSFO_QTY}} MT/380 CST/ 0.5% MAX SULFUR.',
  'Bunker supply Lay-can:{{LAYCAN}}',
  'Kindly advise us vessels ETA and after give FIRM notices basis 96/72/48/36/24/12 HRS to our common mail id at operations@example.com.',
  'Kindly contact FUJ PORT Control on VHF channel 16/10 two hours before your arrival informing nature of call and bunker supplier name and the name of local agent.',
  'For emergency 24 HRS contact phones no is +971500000000 (24x7). For Vessels carrying hazardous cargoes, anchoring position is BRAVO anchorage or Delta anchorage.',
  '"B" Anchorage Area', 'For vessels require bunkers, lube oil or de slopping total (50) anchoring positions.',
  '25* 15.0 N – 056* 35.0E', '25* 15.0 N – 056* 29.0E', '25* 09.7 N – 056* 35.0E', '25* 09.7 N – 056* 29.0E',
  'Note 1: Fujairah Port Authority will not accept single hull tankers in loaded condition; however single hull tankers in ballast condition could be accepted subject to Harbor master approval. Approval will be considered during port office HRS only.',
  'Please keep the STBD SIDE vessels clear for our bunker barge to come along side. Also advise us at the earliest your vessels Local Agent, Purpose of call, Duration of stay Fujairah, Vessel type, Year of Built, Tanker Hull Type IMO Number, Vessel (loaded or Ballast), Summer Draft, LOA, DWT, Manifold size / Distance from Stern / Height above sea level and required Pumping rate.',
  'If your good vessel is coming for bunkering only, we can act as agent provided there is no other service than bunkering, and any service other than bunkering you have to appoint a local agent for the same. FYG, Fujairah Port Authority will not allow two agents to act for the same call.',
  'Note 2: In case your agent is us, kindly advise us at the earliest in order to send you ISPS code form for filling and returning to our office along with a copy of international ship security certificate and copy of last port clearance. All these documents are needed by Fujairah Port Authorities at least 72 hours prior arrival failing to this Fujairah port authority will not grant permission to enter the anchorage area. Furthermore, you must please advise us, and port control the sailing time immediately upon completion of bunkering.',
  'Note 3: Please note Port of Fujairah already complied with ISPS Code, Port security level is Level ONE, vessels calling to FOAA with security level 2 or 3 then same to be informed via you appointed agent well in advance to Port Security Officer / boarding arrangements to furnish the DOS with SSO.',
  'LAST-ON-PAGE-ONE-OR-TWO Vessels to drop anchor only at allocated anchorage area and not to drop anchor at prohibited area or passing through prohibited areas may cause heavy fines as per port regulation.',
  'Note 4: We will not accept any REMARKS OR STAMPS like charterers account, sign for volume only and any other comments other than ships stamp/sign on the bunker delivery receipt, bunkering notice, before or after ullage or on our sample labels.',
  'Note 5: The quantity would not be determined based on receiving vessel tank gauging. The quantity will be based on entirely on the Before and After dips/ullage and calibration table of the barge tanks.',
  'Please copy all your messages to our common Operations e-mail Id.', '', '', 'Best Regards,', 'Operations', 'GULF PETROL SUPPLIES LLC (BUNKERS)'];
const SP = '<w:spacing w:before="0" w:after="200"/>';
const LONG_BODY =
  '<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="1F4E79"/><w:sz w:val="48"/></w:rPr><w:t>GPS LOGO</w:t></w:r></w:p>' +
  ['Gulf Petrol Supplies LLC (Bunkers)', '(A Fujairah National Group Company)', 'FNG Building No. 2, Al Mina Road,', 'P.O. Box 121, Fujairah, U.A.E'].map(t => P(t, '<w:sz w:val="20"/>', '<w:ind w:left="5000"/><w:spacing w:after="0"/>')).join('') +
  P('') + P('To: The Master: {{VESSEL_NAME}}', '<w:u w:val="single"/>') + P('') +
  LONG_PARAS.map(t => P(t, '<w:color w:val="1F4E79"/><w:sz w:val="22"/>', '<w:jc w:val="both"/>' + SP)).join('');
// like the GPS letter: Century text (East Asian font Calibri), a Calibri block, a page break
// typed after Note 3, page 2 after it
const CEN = '<w:rFonts w:ascii="Century" w:hAnsi="Century" w:eastAsia="Calibri"/><w:sz w:val="20"/>';
const CAL = '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/>';
const GPS_BODY = (fill) =>
  P('Gulf Petrol Supplies LLC (Bunkers)', CEN, '<w:ind w:left="5000"/><w:spacing w:after="0"/>') +
  P('To: The Master: {{VESSEL_NAME}}', CEN + '<w:u w:val="single"/>') +
  LONG_PARAS.slice(0, 13).map(t => P(t, CEN, '<w:jc w:val="both"/>' + SP)).join('') +
  P('"B" Anchorage Area', CAL, '<w:spacing w:after="0"/>') +
  Array.from({ length: fill }, (_, i) => P('Filler line ' + (i + 1) + ' of the notes about the anchorage and the port rules.', CEN, SP)).join('') +
  P(LONG_PARAS[18], CEN, '<w:jc w:val="both"/>' + SP) +
  '<w:p><w:pPr><w:spacing w:after="200"/></w:pPr><w:r><w:br w:type="page"/></w:r></w:p>' +
  LONG_PARAS.slice(19).map(t => P(t, CEN, '<w:jc w:val="both"/>' + SP)).join('');
async function templateB64(body) {
  const z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  z.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body || BODY}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1418"/></w:sectPr></w:body></w:document>`);
  return (await z.generateAsync({ type: 'nodebuffer' })).toString('base64');
}

(async () => {
  const browser = await H.launch();
  const db = H.createDb({ workspace: U.seedPayload({}), realtime: false }); db.cdnLog = [];
  const A = await U.open(browser, db, 'user-operator');
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
          head: txt.slice(0, 5), rev: /\/Creator \(FLOW Calling Instructions PDF r3/.test(txt), pages: (txt.match(/\/Type \/Page\b/g) || []).length, images: (txt.match(/\/Subtype \/Image/g) || []).length,
          media: (txt.match(/\/MediaBox \[([^\]]+)\]/) || [])[1] || '', err: (document.getElementById('ci-modal-error') || {}).textContent || '', pdfB64: btoa(b64out) };
      } finally { _flowSaveOrShareBlob = orig; }
    }, b64);
    if (process.env.PDF_OUT && r.pdfB64) fs.writeFileSync(process.env.PDF_OUT, Buffer.from(r.pdfB64, 'base64'));
    const mb = r.media.trim().split(/\s+/).map(Number);
    check('after Preview & Generate, ⬇ Download PDF shows next to ⬇ Download .docx', r.shown && r.label === '⬇ Download PDF', r.label);
    check('⬇ Download .docx downloads the same formatted file again (with the preview\'s edit and the letterhead formatting)', r.sameDocx && r.xmlEdit, { sameDocx: r.sameDocx, xmlEdit: r.xmlEdit, names: r.names });
    check('the PDF is named Calling_Instructions_M_T_ELANDRA_SEA.pdf', r.names.includes('Calling_Instructions_M_T_ELANDRA_SEA.pdf'), { names: r.names, err: r.err });
    check('the PDF is the document drawn page by page: 2 pages (the page break kept), each an image of the page, A4 like the template', r.head === '%PDF-' && r.rev && r.pages === 2 && r.images === 2 && Math.abs(mb[2] - 595.3) < 2 && Math.abs(mb[3] - 841.9) < 2, { pages: r.pages, images: r.images, media: r.media, err: r.err });
    // a letter longer than one page, no page break in the file: Word carries it over to page 2
    const b64long = await templateB64(LONG_BODY);
    const r2 = await A.page.evaluate(async (b64) => {
      const z = await JSZip.loadAsync(_base64ToAb(b64));
      const blob = await z.generateAsync({ type: 'blob' });
      const pdf = await _ciDocxToPdfBlob(blob);
      const pb = new Uint8Array(await pdf.arrayBuffer());
      let txt = ''; for (let i = 0; i < pb.length; i++) txt += String.fromCharCode(pb[i]);
      let b64out = ''; for (let i = 0; i < pb.length; i += 0x8000) b64out += String.fromCharCode.apply(null, pb.subarray(i, i + 0x8000));
      // the layout used: which block opens page 2
      const box = document.createElement('div'); box.style.cssText = 'position:fixed;left:-100000px;top:0;'; document.body.appendChild(box);
      const ab = await blob.arrayBuffer(); const lib = await _ciLoadDocxPreview();
      const set = new Set(); let pages = await _ciRenderDocxPages(lib, ab, box, set);
      for (let g = 0; g < 50; g++) { let k = -1; for (const p of pages) { k = _ciOverflowIndex(p); if (k >= 0) break; } if (k < 0) break; set.add(k); pages = await _ciRenderDocxPages(lib, ab, box, set); }
      const firstP2 = pages[1] ? (pages[1].querySelector('article > :not([data-ci-brk])') || {}).textContent : '';
      const fits = pages.map(p => { const i = _ciPageInfo(p); return [...p.querySelectorAll(':scope > article > *')].every(b => b.getBoundingClientRect().bottom <= i.bottom + 0.5); });
      box.remove();
      const imgs = [...txt.matchAll(/\/Width (\d+)\s*\/Height (\d+)/g)].map(m => [+m[1], +m[2]]);
      return { pages: (txt.match(/\/Type \/Page\b/g) || []).length, imgs, firstP2, fits, nPages: pages.length, pdfB64: btoa(b64out) };
    }, b64long);
    if (process.env.PDF_OUT2 && r2.pdfB64) fs.writeFileSync(process.env.PDF_OUT2, Buffer.from(r2.pdfB64, 'base64'));
    check('a letter longer than one page (no page break in the file) comes out on 2 A4 pages, the overflow carried to page 2 — not squeezed onto one', r2.pages === 2 && r2.nPages === 2 && r2.fits.every(Boolean), { pages: r2.pages, fits: r2.fits });
    check('…each page image has the A4 shape (text not stretched or squashed)', r2.imgs.length === 2 && r2.imgs.every(([w, h]) => Math.abs(h / w - 297 / 210) < 0.01), r2.imgs);
    check('…page 2 starts at a whole paragraph', /^(Note|LAST-ON|Please|If your|Vessels)/.test((r2.firstP2 || '').trim()), r2.firstP2);
    // the GPS letter: whatever the length of page 1, never a blank page (the typed page break
    // used to be pushed to a page of its own when it fell at the foot of page 1)
    const sweep = [];
    for (let fill = 0; fill <= 14; fill++) sweep.push([fill, await templateB64(GPS_BODY(fill))]);
    const r3 = await A.page.evaluate(async (list) => {
      const lib = await _ciLoadDocxPreview(); const out = [];
      for (const [fill, b64] of list) {
        const box = document.createElement('div'); box.style.cssText = 'position:fixed;left:-100000px;top:0;'; document.body.appendChild(box);
        const pages = await _ciLayoutDocx(lib, _base64ToAb(b64), box);
        out.push({ fill, pages: pages.length, blank: pages.filter(p => ![...p.querySelectorAll(':scope > article')].some(_ciHasInk)).length,
          fits: pages.every(p => { const i = _ciPageInfo(p); return [...p.querySelectorAll(':scope > article > *')].filter(_ciHasInk).every(b => b.getBoundingClientRect().bottom <= i.bottom + 0.5); }) });
        box.remove();
      }
      const fam = n => [...document.fonts].some(f => f.family.replace(/["']/g, '') === n && f.status === 'loaded');
      const box = document.createElement('div'); box.style.cssText = 'position:fixed;left:-100000px;top:0;'; document.body.appendChild(box);
      await _ciLayoutDocx(lib, _base64ToAb(list[0][1]), box);
      const p = [...box.querySelectorAll('article p')].find(x => /Good day/.test(x.textContent));
      const span = p && p.querySelector('span');
      const usedFont = span ? getComputedStyle(span).fontFamily : '';
      box.remove();
      return { out, century: fam('Century'), calibri: fam('Calibri') || _ciFontOnDevice('Calibri'), usedFont };
    }, sweep);
    if (process.env.PDF_OUT3) {
      const b = await A.page.evaluate(async (b64) => { const pdf = await _ciDocxToPdfBlob(new Blob([_base64ToAb(b64)])); const pb = new Uint8Array(await pdf.arrayBuffer()); let o = ''; for (let i = 0; i < pb.length; i += 0x8000) o += String.fromCharCode.apply(null, pb.subarray(i, i + 0x8000)); return btoa(o); }, sweep[6][1]);
      fs.writeFileSync(process.env.PDF_OUT3, Buffer.from(b, 'base64'));
    }
    const cdn = (db.cdnLog || []).join(' ');
    check('the GPS letter: no blank page, whatever the length of page 1 (a typed page break at the foot of page 1 does not get a page of its own)', r3.out.every(o => o.blank === 0 && o.fits && o.pages >= 2 && o.pages <= 3) && r3.out.some(o => o.pages === 2), r3.out);
    check('a font the device lacks (Century) is drawn with its look-alike, not the next font in the list (Calibri); one it has (Calibri — here the system\'s own look-alike) is used as is', r3.century && r3.calibri && /Century/.test(r3.usedFont) && /CenturySchL-Roma\.woff2/.test(cdn), { century: r3.century, calibri: r3.calibri, usedFont: r3.usedFont, cdn: (db.cdnLog || []).filter(u => /woff2/.test(u)) });
    const errs = U.realErrors(A);
    check('no page errors', errs.length === 0, errs.slice(0, 3));
  } catch (e) { check('threw', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
  finally { await A.ctx.close(); }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
