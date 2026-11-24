/* More than one open card for one vessel; Deal Done Date; the coloured nominations Excel.
   • a banner over the nomination cards names every vessel with more than one open card
     (same IMO, or the same name however typed: "M/T HAYAT" = "HAYAT"); cancelled nominations
     don't count
   • Review duplicates lists each card side by side: quantity, location, ETA, laycan, barge,
     deal date, nomination email sent or not
   • Keep this one (operators): the other cards go to the Trash (restorable, nothing emailed,
     marked "Merged into another card"), the kept card says what was merged into it; saved
   • Not duplicates — separate calls: not listed again (saved), until another card of that
     vessel turns up
   • a trader sees the list but cannot merge
   • Deal Done Date: a date box on every card, empty until picked; saved only when set;
     a column in the Excel export
   • the Excel export is coloured and aligned: navy header, frozen header with filters,
     status colours, totals row; old column order kept (Barge, IMO, Deal Done Date added)
   node suites/fix2/dup-nominations.test.js [appDir] */
const path = require('path');
if (process.argv[2]) process.env.APP_DIR = path.resolve(process.argv[2]);
const H = require(path.join(__dirname, '..', '..', 'harness', 'harness.js'));
const U = require(path.join(__dirname, '..', 'r3', 'util.js'));
const ExcelJS = require('exceljs');

let pass = 0, fail = 0;
function check(name, cond, info) {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 900)));
}
const NOW = Date.now(), HR = 3600000;
const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const eta = h => { const d = new Date(Math.floor((NOW + h * HR) / 60000) * 60000 + 4 * HR); const p = n => String(n).padStart(2, '0'); return `${p(d.getUTCDate())} ${MO[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };
const V = (nomUid, name, h, qty, extra) => Object.assign({ nomUid, name, imo: '', area: 'FUJ-A', type: 'VLSFO', qty, mgo: 0, spec: 'ISO 8217:2010', agent: 'AG', manifold: 'VESSEL MANIFOLD', remarks: '', lc: '', eta: eta(h), paq: 'no', bargeId: '', refuelChk: false, rfv: 0, rfm: 0, rfvr: 750, rfmr: 275 }, extra || {});
const SHIPS = () => [V('nA', 'HAYAT', 20, 750), V('nB', 'M/T Hayat', 21, 1000, { area: 'KFK-A' }), V('nC', 'SEA STAR', 30, 500)];

(async () => {
  const browser = await H.launch();
  const scenario = async (name, fn) => {
    if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return;
    console.log('— ' + name);
    const apps = [];
    try { await fn(async (db, uid) => { const a = await U.open(browser, db, uid || 'user-operator'); await U.helpers(a); await a.page.evaluate(() => { window.__confirms = []; window.alert = () => {}; window.confirm = m => { window.__confirms.push(String(m)); return true; }; showPage('nominations'); }); await a.page.waitForTimeout(500); apps.push(a); return a; }); }
    catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
    const errs = [].concat(...apps.map(a => U.realErrors(a)));
    check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
    for (const a of apps) await a.ctx.close();
  };
  const banner = page => page.evaluate(() => { const b = document.getElementById('dup-banner'); return { shown: !!b && !b.hidden, text: b ? b.textContent.replace(/\s+/g, ' ').trim() : '' }; });
  const modal = page => page.evaluate(() => { openDupModal(); const m = document.getElementById('dup-modal');
    return { groups: [...m.querySelectorAll('.dup-group')].map(g => ({ hdr: g.querySelector('.dup-group-hdr').textContent, rows: [...g.querySelectorAll('tbody tr')].map(tr => tr.textContent.replace(/\s+/g, ' ').trim()), keep: g.querySelectorAll('.dup-keep').length, sep: g.querySelectorAll('.dup-sep').length })), empty: !!m.querySelector('.dup-empty') }; });
  const cloudVessels = db => (U.row(db).payload.state.vessels || []);

  await scenario('D1 the banner and the list', async (openT) => {
    const db = H.createDb({ workspace: U.seedPayload({ vessels: SHIPS() }), realtime: false });
    const A = await openT(db);
    const b = await banner(A.page);
    check('D1 a banner over the cards: 1 vessel has more than one open card — HAYAT (2) ("M/T Hayat" = "HAYAT")', b.shown && /1 vessel has more than one open nomination card/.test(b.text) && /HAYAT \(2\)/.test(b.text) && !/SEA STAR/.test(b.text), b);
    const m = await modal(A.page);
    check('D1 Review duplicates lists both cards side by side with quantity, location, ETA and email state; operators get Keep / Not duplicates', m.groups.length === 1 && m.groups[0].rows.length === 2 && /VLSFO 750 MT/.test(m.groups[0].rows[0]) && /VLSFO 1,000 MT/.test(m.groups[0].rows[1]) && /Khor Fakkan|KFK/.test(m.groups[0].rows[1]) && /Not sent/.test(m.groups[0].rows[0]) && m.groups[0].keep === 2 && m.groups[0].sep === 1, m);
    // same IMO, different names: one ship
    const r = await A.page.evaluate(async () => {
      const ids = [...document.querySelectorAll('.vcard[id^="vessel-"]')].map(c => c.id.replace('vessel-', ''));
      const star = ids.find(id => document.getElementById('v' + id + '-name').value === 'SEA STAR');
      addVessel({ name: 'OCEAN STAR', imo: '9321483', qty: 300 }); const nid = [...document.querySelectorAll('.vcard[id^="vessel-"]')].pop().id.replace('vessel-', '');
      const imo = document.getElementById('v' + star + '-imo'); imo.value = '9321483'; vidCommit(Number(star), 'imo');
      await new Promise(r => setTimeout(r, 800)); return true;
    });
    const b2 = await banner(A.page);
    check('D1 two names with the same IMO are one ship too (SEA STAR = OCEAN STAR, IMO 9321483)', r && /2 vessels have more than one open nomination card/.test(b2.text) && /SEA STAR \(2\)|OCEAN STAR \(2\)/.test(b2.text), b2);
  });

  await scenario('D2 keep one', async (openT) => {
    const db = H.createDb({ workspace: U.seedPayload({ vessels: SHIPS() }), realtime: false });
    const A = await openT(db);
    const k = await A.page.evaluate(async () => {
      openDupModal();
      const btn = [...document.querySelectorAll('#dup-modal tr')].find(tr => tr.dataset.nomUid === 'nB').querySelector('.dup-keep');
      btn.click(); await new Promise(r => setTimeout(r, 400)); await _waitForSaveIdle();
      const cards = [...document.querySelectorAll('.vcard[id^="vessel-"]')].map(c => ({ uid: c.dataset.nomUid, merged: (c.querySelector('.dup-merged') || {}).textContent || '' }));
      return { confirms: window.__confirms.slice(), cards, trash: _trashBin.map(t => ({ uid: t.def.nomUid, reason: t.reason, into: t.mergedInto })), trashTxt: (document.getElementById('trash-bin-list') || {}).textContent || '' };
    });
    const b = await banner(A.page);
    check('D2 Keep this one asks once (no "send a cancelled email" question); the other card goes to the Trash, marked merged', k.confirms.length === 1 && /Keep/.test(k.confirms[0]) && !/Cancelled/i.test(k.confirms[0]) && k.trash.length === 1 && k.trash[0].uid === 'nA' && k.trash[0].reason === 'merged' && k.trash[0].into === 'nB' && /Merged into another card/.test(k.trashTxt), k);
    check('D2 the kept card shows what was merged into it; the banner is gone', k.cards.length === 2 && /Merged with: HAYAT · VLSFO 750 MT/.test((k.cards.find(c => c.uid === 'nB') || {}).merged) && !b.shown, { k, b });
    const cv = cloudVessels(db);
    check('D2 saved: the cloud has the kept card (with mergedFrom), not the other one', cv.length === 2 && !cv.some(v => v.nomUid === 'nA') && (cv.find(v => v.nomUid === 'nB') || {}).mergedFrom && cv.find(v => v.nomUid === 'nB').mergedFrom[0].nomUid === 'nA', cv.map(v => [v.nomUid, v.mergedFrom]));
    check('D2 nothing was emailed', !db.log.some(o => /emailjs/.test(JSON.stringify(o))) && !U.realErrors(A).some(e => /emailjs/.test(e)));
    const back = await A.page.evaluate(async () => { restoreFromTrash(0); await new Promise(r => setTimeout(r, 600)); return true; });
    const b2 = await banner(A.page);
    check('D2 restoring it from the Trash brings it back (listed as a duplicate again)', back && b2.shown && /hayat \(2\)/i.test(b2.text), b2);
  });

  await scenario('D3 separate calls', async (openT) => {
    const db = H.createDb({ workspace: U.seedPayload({ vessels: SHIPS() }), realtime: false });
    const A = await openT(db);
    await A.page.evaluate(async () => { openDupModal(); document.querySelector('#dup-modal .dup-sep').click(); await new Promise(r => setTimeout(r, 300)); await _waitForSaveIdle(); });
    const b = await banner(A.page);
    const cv = cloudVessels(db);
    check('D3 Not duplicates — separate calls: not listed any more, and saved on both cards', !b.shown && JSON.stringify((cv.find(v => v.nomUid === 'nA') || {}).dupOk) === '["nB"]' && JSON.stringify((cv.find(v => v.nomUid === 'nB') || {}).dupOk) === '["nA"]' && !('dupOk' in (cv.find(v => v.nomUid === 'nC') || {})), { b, cv: cv.map(v => [v.nomUid, v.dupOk]) });
    const B = await openT(db, 'user-operator2');
    const bB = await banner(B.page);
    check('D3 …on another device too', !bB.shown, bB);
    await A.page.evaluate(async () => { addVessel({ name: 'HAYAT', qty: 200 }); await new Promise(r => setTimeout(r, 800)); });
    const b2 = await banner(A.page);
    check('D3 a third HAYAT card turns up: listed again (3)', b2.shown && /HAYAT \(3\)/.test(b2.text), b2);
  });

  await scenario('D4 trader and cancelled', async (openT) => {
    const db = H.createDb({ workspace: U.seedPayload({ vessels: SHIPS() }), realtime: false });
    const T = await openT(db, 'user-trader');
    const m = await modal(T.page);
    check('D4 a trader sees the duplicates but cannot merge', m.groups.length === 1 && m.groups[0].keep === 0 && m.groups[0].sep === 0, m);
    const A = await openT(db, 'user-operator2');
    const c = await A.page.evaluate(async () => { _nomCancelEmailLog.nA = { emailSent: true, sentAt: new Date().toISOString() }; renderDupBanner(); const b = document.getElementById('dup-banner'); return !b.hidden; });
    check('D4 a cancelled nomination does not count as a duplicate', c === false, c);
  });

  await scenario('E1 Deal Done Date', async (openT) => {
    const db = H.createDb({ workspace: U.seedPayload({ vessels: [V('nA', 'HAYAT', 20, 750), V('nC', 'SEA STAR', 30, 500, { dealDate: '2026-11-18' })] }), realtime: false });
    const A = await openT(db);
    const r = await A.page.evaluate(async () => {
      const ids = [...document.querySelectorAll('.vcard[id^="vessel-"]')].map(c => c.id.replace('vessel-', ''));
      const box = id => document.getElementById('v' + id + '-dealdate');
      const before = ids.map(id => [box(id).type, box(id).value, (box(id).closest('.field').querySelector('label') || {}).textContent]);
      box(ids[0]).value = '2026-11-24'; box(ids[0]).dispatchEvent(new Event('change'));
      await new Promise(r => setTimeout(r, 300)); await _waitForSaveIdle();
      return before;
    });
    check('E1 every card has a Deal Done Date box (date picker): empty until picked, a saved one shows', r[0][0] === 'date' && r[0][1] === '' && r[0][2] === 'Deal Done Date' && r[1][1] === '2026-11-18', r);
    const cv = cloudVessels(db);
    check('E1 picking a date saves it on that vessel (dealDate)', (cv.find(v => v.nomUid === 'nA') || {}).dealDate === '2026-11-24' && (cv.find(v => v.nomUid === 'nC') || {}).dealDate === '2026-11-18', cv.map(v => [v.nomUid, v.dealDate]));
    const x = await A.page.evaluate(async () => {
      calculate(); await new Promise(r => setTimeout(r, 300));
      let got = null; const o = _flowSaveOrShareBlob; _flowSaveOrShareBlob = async (b, n) => { got = { b, n }; return true; };
      try { await downloadExcel(); } finally { _flowSaveOrShareBlob = o; }
      const u = new Uint8Array(await got.b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
      return { name: got.n, b64: btoa(s) };
    });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(x.b64, 'base64'));
    const ws = wb.worksheets[0];
    let hdrRow = null; ws.eachRow((row, n) => { if (row.getCell(1).value === 'S.No.') hdrRow = n; });
    const hdr = hdrRow ? ws.getRow(hdrRow).values.slice(1) : [];
    const rowOf = name => { let f = null; ws.eachRow(row => { if (row.getCell(2).value === name) f = row; }); return f; };
    const hy = rowOf('HAYAT'), ss = rowOf('SEA STAR');
    check('E1 the Excel keeps its columns and adds Barge, IMO, Deal Done Date', JSON.stringify(hdr.slice(0, 14)) === JSON.stringify(['S.No.', 'Vessel Name', 'Anchorage', 'FO (MT)', 'MGO (MT)', 'Spec', 'Nominated Laycan', 'Actual ETA', 'Supply Start', 'ETC', 'Supply Plan', 'Laycan Status', 'Agent', 'Sampling / Manifold']) && JSON.stringify(hdr.slice(14)) === JSON.stringify(['Barge', 'IMO', 'Deal Done Date']), hdr);
    check('E1 each vessel\'s Deal Done Date is in its row', hy && hy.getCell(17).value === '24 Nov 2026' && ss && ss.getCell(17).value === '18 Nov 2026', [hy && hy.getCell(17).value, ss && ss.getCell(17).value]);
    const hc = ws.getRow(hdrRow).getCell(1);
    const st = hy.getCell(12);
    check('E1 coloured and aligned: navy header (white bold), frozen header with filters, status coloured, quantities right-aligned, totals row',
      hc.fill && hc.fill.fgColor.argb === 'FF0D1B2A' && hc.font.bold && hc.font.color.argb === 'FFFFFFFF' && ws.views[0].state === 'frozen' && ws.views[0].ySplit === hdrRow && !!ws.autoFilter &&
      st.fill && /FFE5F5EC|FFFFF5E0/.test(st.fill.fgColor.argb) && hy.getCell(4).alignment.horizontal === 'right' && hy.getCell(4).value === 750 &&
      (() => { let t = null; ws.eachRow(row => { if (/^Total \(/.test(String(row.getCell(2).value))) t = row; }); return t && t.getCell(4).value === 1250; })(),
      { hc: hc.fill, views: ws.views, st: st.fill, al: hy.getCell(4).alignment });
  });

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
