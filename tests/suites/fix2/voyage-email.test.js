/* "Email to Barge": the ticked rows of the barge tab on screen as the delivery-schedule e-mail.
   • one table in the operators' layout (S. NO. … SAMPLING MANIFOLD), 2 of 3 rows ticked → 2 rows,
     renumbered; FO/MGO, SPEC without "ISO ", laycan "29th-31st OCT", ETA "0600/30TH OCT",
     SUPPLY PLAN ON ARRIVAL / AFTER <vessel> as in the table, manifold cell yellow
   • To line from the barge card's Captain e-mail (saved, synced, survives a reload)
   • the mail file opens as an unsent message (X-Unsent) with the HTML table; Copy puts the same HTML
     on the clipboard; editing the plain text does not wipe the table preview
   • nothing ticked → a message, no e-mail; the other barge's tab → its own rows
   node suites/fix2/voyage-email.test.js [appDir] */
const path = require('path');
if (process.argv[2]) process.env.APP_DIR = path.resolve(process.argv[2]);
const H = require(path.join(__dirname, '..', '..', 'harness', 'harness.js'));
const U = require(path.join(__dirname, '..', 'r3', 'util.js'));

let pass = 0, fail = 0;
function check(name, cond, info) {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 700)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MU = MO.map(m => m.toUpperCase());
const p2 = n => String(n).padStart(2, '0');
const ord = n => { const s = (n % 100 >= 11 && n % 100 <= 13) ? 'th' : ['th', 'st', 'nd', 'rd'][Math.min(n % 10, 4)] || 'th'; return n + s; };
const dayAt = (d, h) => { const x = new Date(Date.now() + d * 864e5); x.setHours(h, 0, 0, 0); return x; };
const fmtDT = x => `${p2(x.getDate())} ${MO[x.getMonth()]} ${x.getFullYear()} ${p2(x.getHours())}:${p2(x.getMinutes())}`;
const fmtD = x => `${x.getDate()} ${MO[x.getMonth()]} ${x.getFullYear()}`;
// Three vessels on Barge 1 (ETAs day+2 06:00, day+2 09:00, day+3 08:00; laycan day+2..day+4), one on Barge 2.
const E1 = dayAt(2, 6), E2 = dayAt(2, 9), E3 = dayAt(3, 8), E4 = dayAt(2, 12);
const LF = dayAt(2, 0), LT = dayAt(4, 0), LC = `${fmtD(LF)} - ${fmtD(LT)}`;
const VBASE = { imo: '', area: 'FUJ-A', spec: 'ISO 8217:2010', agent: 'WSS', manifold: 'BARGE MANIFOLD', remarks: '', paq: 'no', refuelChk: false, rfv: 0, rfm: 0, rfvr: 750, rfmr: 275 };
const BARGE = { vcap: 5000, mcap: 1000, vbuf: 500, mbuf: 150, vtph: 300, mtph: 100, vrfr: 750, mrfr: 275 };
function seed() {
  const s = U.seedPayload({ vessels: [
    Object.assign({}, VBASE, { nomUid: 'n1', name: 'Etagas', type: 'VLSFO', qty: 550, mgo: 0, eta: fmtDT(E1), lc: LC, bargeId: '1' }),
    Object.assign({}, VBASE, { nomUid: 'n2', name: 'Sakuragawa', type: 'VLSFO', qty: 3800, mgo: 0, eta: fmtDT(E2), lc: LC, bargeId: '1', agent: 'VIKING', spec: 'ISO 8217:2017' }),
    Object.assign({}, VBASE, { nomUid: 'n3', name: 'Lila Confidence', type: 'VLSFO', qty: 800, mgo: 0, eta: fmtDT(E3), lc: LC, bargeId: '1', agent: 'SHARAF', spec: 'ISO 8217:2017' }),
    Object.assign({}, VBASE, { nomUid: 'n4', name: 'Desh Ujaala', type: 'VLSFO', qty: 2600, mgo: 0, eta: fmtDT(E4), lc: LC, bargeId: '2', agent: 'SHARAF', manifold: 'VESSEL MANIFOLD' }),
  ] });
  s.state.barges = [Object.assign({ id: 1, name: 'FNSA 10', vrob: 9000, mrob: 800, vcap: 10000, email: 'captain.fnsa10@example.com' }, BARGE, { vcap: 10000 }),
                    Object.assign({ id: 2, name: 'FNSA 11', vrob: 4000, mrob: 800 }, BARGE)];
  return s;
}
async function open(browser, db, uid) {
  const a = await U.open(browser, db, uid);
  await U.helpers(a);
  await a.page.evaluate(() => { window.__alerts = []; window.alert = m => window.__alerts.push(String(m)); window.confirm = () => true; });
  return a;
}
const generate = p => p.evaluate(async () => { calculate(); await _waitForSaveIdle(); showPage('schedule'); });
// What the composer shows after "Email to Barge": the table parsed back into rows.
const composer = p => p.evaluate(() => {
  const m = document.getElementById('em-modal');
  const html = document.getElementById('em-output-html');
  const rows = Array.from(html.querySelectorAll('table tr')).map(tr => Array.from(tr.children).map(td => ({ t: td.textContent.trim(), bg: (td.getAttribute('style') || '').replace(/\s/g, '').includes('background:#FFFF00'), tag: td.tagName })));
  return { open: m.style.display === 'flex', title: document.getElementById('em-modal-title').textContent, to: document.getElementById('em-to').value, subject: document.getElementById('em-subject').value,
    text: document.getElementById('em-output-text').value, head: rows[0] ? rows[0].map(c => c.t) : [], body: rows.slice(1).map(r => r.map(c => c.t)), yellow: rows.slice(1).map(r => r[10] && r[10].bg), greeting: /Good day Captain,/.test(html.textContent) && /Kindly find the below delivery scheduled for your good barge\./.test(html.textContent) };
});

(async () => {
  const browser = await H.launch();
  const scenario = async (name, fn) => {
    console.log('— ' + name);
    const apps = [];
    try { await fn(async (db, uid) => { const a = await open(browser, db, uid); apps.push(a); return a; }); }
    catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
    const errs = [].concat(...apps.map(a => U.realErrors(a)));
    check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
    for (const a of apps) await a.ctx.close();
  };

  /* V1 — the table for the ticked rows of the barge tab on screen */
  await scenario('V1 e-mail for FNSA 10', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db, 'user-operator');
    await generate(A.page);
    const all = await A.page.evaluate(() => { emailVoyageToBarge(); return 1; });
    let c = await composer(A.page);
    check('V1 button: the composer opens for FNSA 10, To = the Captain e-mail, subject with the barge name, the greeting as written', c.open && c.title === 'Voyage Schedule — FNSA 10' && c.to === 'captain.fnsa10@example.com' && /^Voyage Schedule — FNSA 10 — \d\d [A-Z][a-z]{2} \d{4}$/.test(c.subject) && c.greeting, c);
    check('V1 the 11 columns in order', JSON.stringify(c.head) === JSON.stringify(['S. NO.', 'VESSEL', 'ANCHORAGE AREA', 'FO (MT)', 'MGO (MT)', 'SPEC', 'NOMINATED ETA', 'ETA', 'SUPPLY PLAN', 'AGENT', 'SAMPLING MANIFOLD']), c.head);
    const lcTxt = LF.getMonth() === LT.getMonth() ? `${ord(LF.getDate())}-${ord(LT.getDate())} ${MU[LF.getMonth()]}` : `${ord(LF.getDate())} ${MU[LF.getMonth()]}-${ord(LT.getDate())} ${MU[LT.getMonth()]}`;
    const etaTxt = d => `${p2(d.getHours())}${p2(d.getMinutes())}/${ord(d.getDate()).toUpperCase()} ${MU[d.getMonth()]}`;
    check('V1 all 3 rows (all ticked): values as the operators write them', c.body.length === 3 &&
      JSON.stringify(c.body[0]) === JSON.stringify(['1', 'ETAGAS', 'FUJ A', '550', '0', '8217:2010', lcTxt, etaTxt(E1), 'ON ARRIVAL', 'WSS', 'BARGE MANIFOLD']) &&
      c.body[1][1] === 'SAKURAGAWA' && c.body[1][3] === '3,800' && c.body[1][5] === '8217:2017' && c.body[1][9] === 'VIKING' &&
      c.body[2][1] === 'LILA CONFIDENCE' && c.body[2][7] === etaTxt(E3) && /^(ON ARRIVAL|AFTER SAKURAGAWA)$/.test(c.body[2][8]), c.body);
    check('V1 the SAMPLING MANIFOLD cells are yellow', c.yellow.every(Boolean), c.yellow);
    check('V1 the plain-text alternative carries the same rows', /S\. NO\.\tVESSEL/.test(c.text) && /1\tETAGAS\tFUJ A\t550\t0\t8217:2010/.test(c.text) && /3\tLILA CONFIDENCE/.test(c.text), c.text);
    // Editing the plain text leaves the table preview alone.
    await A.page.evaluate(() => { const t = document.getElementById('em-output-text'); t.value += '\nAdded line'; _emailSyncPreview(); });
    c = await composer(A.page);
    check('V1 typing in the plain-text box does not replace the table preview', c.body.length === 3 && c.head.length === 11, c.head);
    // The mail file: an unsent message with the HTML table.
    const eml = await A.page.evaluate(async () => {
      const cap = {}; const oc = URL.createObjectURL; URL.createObjectURL = b => { cap.blob = b; return 'blob:x'; };
      const oa = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function() {};
      try { await emailDownloadEML(); } catch (e) { cap.err = String(e); }
      URL.createObjectURL = oc; HTMLAnchorElement.prototype.click = oa;
      if (!cap.blob) return { err: cap.err || 'no blob' };
      const raw = await cap.blob.text();
      const part = raw.split(/--GPSBUNKERS_[^\r\n]+/).find(x => /text\/html/.test(x)) || '';
      const b64 = part.replace(/[\s\S]*?\r\n\r\n/, '').replace(/\s+/g, '');
      let html = ''; try { html = decodeURIComponent(escape(atob(b64))); } catch (e) { html = '(decode failed)'; }
      return { unsent: /^X-Unsent: 1\r?$/m.test(raw), to: /^To: .*captain\.fnsa10@example\.com/m.test(raw), subject: /^Subject: Voyage Schedule — FNSA 10/m.test(raw), table: /<table[\s\S]*SAMPLING MANIFOLD[\s\S]*ETAGAS[\s\S]*LILA CONFIDENCE/.test(html), type: cap.blob.type };
    });
    check('V1 "Download Formatted Email": an unsent message (X-Unsent: 1) to the captain, with the HTML table', eml.unsent && eml.to && eml.subject && eml.table && eml.type === 'message/rfc822', eml);
    // Copy (formatted): the HTML table goes to the clipboard.
    const cp = await A.page.evaluate(async () => { let got = null; const o = _emailWriteRichClipboard; _emailWriteRichClipboard = (t, h) => { got = { t, h }; return Promise.resolve(); }; document.querySelector('#em-modal [onclick="emailCopyBody()"]').click(); await new Promise(r => setTimeout(r, 50)); _emailWriteRichClipboard = o; return got ? { table: /<table/.test(got.h) && /SAKURAGAWA/.test(got.h), text: /SAKURAGAWA/.test(got.t) } : null; });
    check('V1 "Copy Message (formatted)": the table as HTML (and the plain rows) on the clipboard', cp && cp.table && cp.text, cp);
    await A.page.evaluate(() => emailCloseModal());
    // Two of three ticked → two rows, renumbered, the plan as in the table.
    await A.page.evaluate(() => { document.querySelector('#voy-tab-1 .voy-print-chk[data-sno="1"]').checked = false; emailVoyageToBarge(); });
    c = await composer(A.page);
    check('V1 Etagas unticked: 2 rows, renumbered 1–2, Sakuragawa then Lila Confidence', c.body.length === 2 && c.body[0][0] === '1' && c.body[0][1] === 'SAKURAGAWA' && c.body[1][0] === '2' && c.body[1][1] === 'LILA CONFIDENCE', c.body);
    await A.page.evaluate(() => emailCloseModal());
    // Nothing ticked → message only.
    await A.page.evaluate(() => { document.querySelectorAll('#voy-tab-1 .voy-print-chk').forEach(c => { c.checked = false; }); window.__alerts = []; emailVoyageToBarge(); });
    const none = await A.page.evaluate(() => ({ open: document.getElementById('em-modal').style.display === 'flex', alerts: window.__alerts }));
    check('V1 nothing ticked: "No vessels selected" and no composer', !none.open && none.alerts.some(a => /No vessels selected/.test(a)), none);
  });

  /* V2 — the other barge's tab, and a barge without a Captain e-mail */
  await scenario('V2 FNSA 11 tab', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db, 'user-operator');
    await generate(A.page);
    await A.page.evaluate(() => { switchBargeTbl('2'); emailVoyageToBarge(); });
    const c = await composer(A.page);
    check('V2 FNSA 11: its own single row (Desh Ujaala, VESSEL MANIFOLD), To empty with a note to add the Captain e-mail', c.open && c.title === 'Voyage Schedule — FNSA 11' && c.to === '' && c.body.length === 1 && c.body[0][1] === 'DESH UJAALA' && c.body[0][10] === 'VESSEL MANIFOLD' && c.body[0][3] === '2,600' && /No Captain e-mail/.test(await A.page.evaluate(() => document.getElementById('em-to-note').textContent)), c);
  });

  /* V3 — the Captain e-mail on the barge card: saved, synced, kept through a reload */
  await scenario('V3 Captain e-mail field', async (openT) => {
    const db = H.createDb({ workspace: seed(), realtime: false });
    const A = await openT(db, 'user-operator');
    const B = await openT(db, 'user-operator2');
    await A.page.evaluate(async () => { const el = document.getElementById('b2-email'); el.value = 'master.fnsa11@example.com'; el.dispatchEvent(new Event('change', { bubbles: true })); await _waitForSaveIdle(); });
    const cloud = U.row(db).payload.state.barges.map(b => [b.id, b.email || '']);
    check('V3 typed on the card → saved to the cloud (FNSA 10 keeps its address)', JSON.stringify(cloud) === JSON.stringify([[1, 'captain.fnsa10@example.com'], [2, 'master.fnsa11@example.com']]), cloud);
    await B.page.evaluate(async () => { await _pollOnce(true); });
    check('V3 …and on the colleague\'s card after a pull', (await B.page.evaluate(() => document.getElementById('b2-email').value)) === 'master.fnsa11@example.com');
    await A.page.reload({ waitUntil: 'load' }); await sleep(1500);
    check('V3 …and after a reload', (await A.page.evaluate(() => document.getElementById('b2-email').value)) === 'master.fnsa11@example.com');
  });

  /* V4 — a single-barge fleet (no barge tabs: the table sits in the container itself) */
  await scenario('V4 single barge', async (openT) => {
    const s = seed(); s.state.barges = [s.state.barges[0]]; s.state.vessels = s.state.vessels.filter(v => v.bargeId === '1');
    const db = H.createDb({ workspace: s, realtime: false });
    const A = await openT(db, 'user-operator');
    await generate(A.page);
    await A.page.evaluate(() => { window.__alerts = []; emailVoyageToBarge(); });
    const c = await composer(A.page);
    check('V4 one barge, no tabs: the e-mail still opens for FNSA 10 with its 3 rows', c.open && c.title === 'Voyage Schedule — FNSA 10' && c.body.length === 3 && c.to === 'captain.fnsa10@example.com', [c.open, c.title, c.body.length, await A.page.evaluate(() => window.__alerts)]);
  });

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
