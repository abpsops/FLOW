/* Vessel identifiers on nominations — IMO number + MMSI.
   A nomination card has an IMO box (vessel.imo, as before) and an MMSI box
   (vessel.mmsi — stored only when filled, so older vessels stay
   byte-identical). At least ONE valid identifier is wanted (live position
   tracking finds a ship by its MMSI / IMO) but nothing is ever blocked:
   IMO = 7 digits with a valid check digit, MMSI = 9 digits starting 2–7.
   Covers: the rules, the card (labels, red / amber states, messages, badge,
   auto-move between the boxes, Look up links), legacy 9-digit MMSIs saved in
   the IMO box, capture / sync (two operators + trader RPC, merge, trash),
   Needs Attention + bell (keyed per nomination, no toasts), non-blocking
   warnings (Generate Schedule, Send Nomination Email, Generate Email),
   e-mail / calling-instruction placeholders, global search, the import
   parser + review table, Harbour / Classic / 390 px, hostile text.
   node suites/nominations/ids.test.js [appDir]    ($SHOTS_DIR saves screenshots) */
const fs = require('fs');
const path = require('path');
const H = require('../../harness/harness.js');
const U = require('../r3/util.js');
const appDir = process.argv[2] || H.APP_DIR;
const SHOTS = process.env.SHOTS_DIR || '';

let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) pass++; else fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 700)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clone = x => JSON.parse(JSON.stringify(x));
const shot = async (target, file) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await target.screenshot({ path: path.join(SHOTS, file) });
};

// Toast log from the very first paint (catches toasts at login too).
const TOAST_LOG = () => {
  window.__toastLog = [];
  document.addEventListener('DOMContentLoaded', () => {
    const st = document.getElementById('toast-stack');
    if (st) new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
      const t = n.querySelector && n.querySelector('.toast-msg');
      if (t) window.__toastLog.push(t.textContent);
    }))).observe(st, { childList: true });
  });
};
const HELPERS = () => {
  const p = n => String(n).padStart(2, '0');
  window.__eta = function (days, h) { const d = new Date(); d.setHours(h == null ? 8 : h, 0, 0, 0); d.setDate(d.getDate() + days); return p(d.getDate()) + ' ' + MO[d.getMonth()] + ' ' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
  window.__open = function (page) { const o = document.getElementById('flow-welcome-overlay'); if (o) o.style.display = 'none'; if (page) showPage(page); };
  window.__vessel = function (def) {
    addVessel(Object.assign({ area: 'FUJ-A', type: 'VLSFO', qty: 500, mgo: 0, paq: 'yes', eta: __eta(2) }, def));
    const cards = document.querySelectorAll('.vcard[id^="vessel-"]');
    return cards[cards.length - 1].id.replace('vessel-', '');
  };
  window.__cid = nomUid => { const c = [...document.querySelectorAll('.vcard[id^="vessel-"]')].find(x => x.dataset.nomUid === nomUid); return c ? c.id.replace('vessel-', '') : null; };
  // Type a value into a box the way a user's input does (input event), optionally leaving it (change).
  window.__set = function (id, which, value, commit) {
    const el = document.getElementById('v' + id + '-' + which);
    el.value = value; el.dispatchEvent(new Event('input', { bubbles: true }));
    if (commit) el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  window.__st = function (id) {
    const g = s => document.getElementById('v' + id + '-' + s);
    const msg = g('idmsg'), b = g('idbadge'), look = g('idlook');
    return {
      imo: g('imo').value, mmsi: g('mmsi').value, badge: b.textContent, badgeCls: b.className,
      msg: msg.textContent, red: [...msg.querySelectorAll('.vid-er')].map(x => x.textContent), amber: [...msg.querySelectorAll('.vid-warn')].map(x => x.textContent),
      hint: [...msg.querySelectorAll('.vid-hint')].map(x => x.textContent), note: [...msg.querySelectorAll('.vid-note')].map(x => x.textContent),
      imoCls: g('imo').className, mmsiCls: g('mmsi').className, imoInv: g('imo').getAttribute('aria-invalid'), mmsiInv: g('mmsi').getAttribute('aria-invalid'),
      look: { hidden: look.hidden, links: [...look.querySelectorAll('a')].map(a => ({ href: a.getAttribute('href'), target: a.target, rel: a.rel, text: a.textContent, attrs: a.attributes.length })) },
      focus: document.activeElement && document.activeElement.id,
    };
  };
  window.__cap = function (id) { const c = document.getElementById('vessel-' + id); return captureCurrentState().vessels.find(v => v.nomUid === c.dataset.nomUid); };
  window.__idToasts = () => (window.__toastLog || []).filter(t => /IMO|MMSI/.test(t));
};
async function open(browser, db, uid, extra) {
  const app = await H.openApp(browser, db, Object.assign({ appDir, uid: uid || 'user-operator', beforeLoad: async (ctx, page) => { await page.addInitScript(TOAST_LOG); } }, extra || {}));
  await app.page.evaluate(HELPERS);
  await U.helpers(app);
  return app;
}
async function scenario(browser, name, fn) {
  console.log('— ' + name);
  const apps = [];
  const openT = async (db, uid, extra) => { const a = await open(browser, db, uid, extra); apps.push(a); return a; };
  try { await fn(openT); } catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 5).join(' | ')); }
  const errs = [].concat(...apps.map(U.realErrors));
  check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
  for (const a of apps) await a.ctx.close();
}
const vessel = o => Object.assign({ nomUid: '', name: '', imo: '', area: 'FUJ-A', type: 'VLSFO', qty: 500, mgo: 0, spec: 'ISO 8217:2010', agent: 'AG', manifold: 'VESSEL MANIFOLD', remarks: '', lc: '', eta: '', paq: 'yes', bargeId: '', refuelChk: false, rfv: 0, rfm: 0, rfvr: 750, rfmr: 275 }, o);
const MOS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const etaStr = days => { const d = new Date(Date.now() + days * 86400000); return String(d.getDate()).padStart(2, '0') + ' ' + MOS[d.getMonth()] + ' ' + d.getFullYear() + ' 08:00'; };

(async () => {
  const browser = await H.launch();

  /* ── 1. Rules: IMO check digit, MMSI, normalising, "at least one" ── */
  await scenario(browser, 'V1 rules', async (openT) => {
    const { page } = await openT(H.createDb());
    const r = await page.evaluate(() => ({
      imoOk: ['9074729', '9321483', '9873022', '9811000', '9176187', '9300001'].map(_imoValid),
      imoBad: ['9321484', '9074720', '9300000', '932148', '93214833', 'abcdefg', ''].map(_imoValid),
      norm: ['IMO 9321483', 'IMO No: 9321483', 'imo9321483', 'IMO: 932 1483', 'MMSI: 636 012 345', '636-012-345', ' 9321483 ', 'M/V ABC', 'MMSI No. 636012345'].map(_vidNorm),
      mmsiOk: ['636012345', '538009876', '211111111', '775000001', '412000004'].map(_mmsiValid),
      mmsiBad: ['123456789', '812345678', '036012345', '63601234', '6360123456', 'abc', ''].map(_mmsiValid),
      msgs: [_vidCheck('9321484', 'imo').msg, _vidCheck('12345', 'imo').msg, _vidCheck('538009876', 'imo').msg, _vidCheck('123456789', 'mmsi').msg, _vidCheck('63601234', 'mmsi').msg, _vidCheck('IMO 9321483', 'imo').kind, _vidCheck('', 'mmsi').kind],
      ok: [['9321483', ''], ['', '636012345'], ['9321483', '636012345'], ['9321484', '636012345'], ['9321483', '123456789'], ['9321484', ''], ['', ''], ['', '123456789'], ['IMO 9321483', '']].map(x => _vidInfo(x[0], x[1]).ok),
      split: [_vidSplitDef('538009876', ''), _vidSplitDef('MMSI: 538 009 876', undefined), _vidSplitDef('538009876', '538009876'), _vidSplitDef('538009876', '636012345'), _vidSplitDef('9321483', '636012345'), _vidSplitDef('', ''), _vidSplitDef(undefined, undefined)],
      vesselOk: [_vidVesselOk({ imo: '538009876' }), _vidVesselOk({ imo: '' }), _vidVesselOk({ imo: '9321483' }), _vidVesselOk({ imo: '9321484', mmsi: '636012345' })],
    }));
    check('V1 IMO check digit (weights 7..2, sum mod 10): real numbers pass', r.imoOk.every(Boolean), r.imoOk);
    check('V1 IMO typos / wrong length / junk fail', r.imoBad.every(x => !x), r.imoBad);
    check('V1 "IMO 9321483", "IMO No: …", spaces / dashes → digits', JSON.stringify(r.norm) === JSON.stringify(['9321483', '9321483', '9321483', '9321483', '636012345', '636012345', '9321483', 'M/V ABC', '636012345']), r.norm);
    check('V1 MMSI = 9 digits starting 2–7', r.mmsiOk.every(Boolean) && r.mmsiBad.every(x => !x), [r.mmsiOk, r.mmsiBad]);
    check('V1 messages: check digit / 7 digits / 9 digits is an MMSI / MMSI rule', JSON.stringify(r.msgs) === JSON.stringify(['Not a valid IMO (check digit)', 'Not a valid IMO (7 digits)', 'Not a valid IMO — 9 digits is an MMSI', 'MMSI must be 9 digits starting 2–7', 'MMSI must be 9 digits starting 2–7', 'ok', 'empty']), r.msgs);
    check('V1 complete = IMO OR MMSI valid (an invalid one beside a valid one still counts as complete)', JSON.stringify(r.ok) === JSON.stringify([true, true, true, true, true, false, false, false, true]), r.ok);
    check('V1 legacy: 9 digits in the IMO box → MMSI box (never over a different MMSI)', JSON.stringify(r.split) === JSON.stringify([{ imo: '', mmsi: '538009876' }, { imo: '', mmsi: '538009876' }, { imo: '', mmsi: '538009876' }, { imo: '538009876', mmsi: '636012345' }, { imo: '9321483', mmsi: '636012345' }, { imo: '', mmsi: '' }, { imo: '', mmsi: '' }]), r.split);
    check('V1 saved vessels: legacy 9-digit IMO counts as a valid MMSI', JSON.stringify(r.vesselOk) === '[true,false,true,true]', r.vesselOk);
  });

  /* ── 2. The card: labels, states, messages, badge, auto-move, capture ── */
  await scenario(browser, 'V2 card', async (openT) => {
    const db = H.createDb();
    const { page } = await openT(db);
    await page.evaluate(() => __open('nominations'));
    const id = await page.evaluate(() => __vessel({ name: 'ALPHA STAR' }));
    const r0 = await page.evaluate(id => {
      const f = document.querySelector('#vessel-' + id + ' .vid-field'), lbl = f.querySelector('label');
      const hdr = document.querySelector('#vessel-' + id + ' .vcard-hdr');
      return { st: __st(id), lbl: lbl.textContent.replace(/\s+/g, ' ').trim(), title: lbl.title, stars: document.querySelectorAll('#vessel-' + id + ' .vid-req').length, inHdr: hdr.contains(document.getElementById('v' + id + '-idbadge')),
        aria: [document.getElementById('v' + id + '-imo').getAttribute('aria-label'), document.getElementById('v' + id + '-mmsi').getAttribute('aria-label')], next: document.getElementById('v' + id + '-imo').closest('.vid-pair').contains(document.getElementById('v' + id + '-mmsi')), cap: __cap(id) };
    }, id);
    check('V2 one label for the pair: "IMO Number / MMSI * — at least one" (boxes not starred separately), hint "needed for live position tracking"', r0.lbl === 'IMO Number / MMSI * — at least one' && r0.stars === 1 && /needed for live position tracking/.test(r0.title) && r0.next && /^IMO number/.test(r0.aria[0]) && /^MMSI/.test(r0.aria[1]), r0);
    check('V2 empty: amber "Add an IMO or MMSI so FLOW can track the vessel", both boxes amber, badge "ID missing" in the card header',
      JSON.stringify(r0.st.amber) === JSON.stringify(['Add an IMO or MMSI so FLOW can track the vessel']) && !r0.st.red.length && /vid-miss/.test(r0.st.imoCls) && /vid-miss/.test(r0.st.mmsiCls) && r0.st.badge === 'ID missing' && /miss/.test(r0.st.badgeCls) && r0.inHdr, r0.st);
    check('V2 a card without an MMSI stores no mmsi key; imo stays as before', r0.cap && !('mmsi' in r0.cap) && r0.cap.imo === '', r0.cap);
    await shot(page.locator('#vessel-' + id), '01-card-missing-ids-harbour.png');

    // invalid IMO (check digit) → red, its own message, aria-invalid; still "ID missing"
    let s = await page.evaluate(id => { __set(id, 'imo', '9321484', true); return __st(id); }, id);
    check('V2 invalid IMO: red "Not a valid IMO (check digit)", aria-invalid, no amber, badge "ID missing"', JSON.stringify(s.red) === '["Not a valid IMO (check digit)"]' && /vid-bad/.test(s.imoCls) && s.imoInv === 'true' && !s.amber.length && s.badge === 'ID missing', s);
    await shot(page.locator('#vessel-' + id + ' .vid-field'), '03-invalid-imo-message.png');
    await shot(page.locator('#vessel-' + id), '03b-card-invalid-imo.png');
    // "IMO 9321483" accepted; normalised to digits when the box is left
    s = await page.evaluate(id => { __set(id, 'imo', 'IMO 9321483'); const a = __st(id); document.getElementById('v' + id + '-imo').dispatchEvent(new Event('change', { bubbles: true })); return { typed: a, left: __st(id) }; }, id);
    check('V2 "IMO 9321483" is valid as typed and normalised to 9321483 on leaving the box; badge "IMO ✓", hint shown', s.typed.badge === 'IMO ✓' && !s.typed.red.length && s.left.imo === '9321483' && s.left.badge === 'IMO ✓' && /ok/.test(s.left.badgeCls) && /needed for live position tracking/.test(s.left.hint.join()), s);
    check('V2 a valid IMO alone is complete: no amber / red, the boxes are not amber', !s.left.amber.length && !s.left.red.length && /vid-ok/.test(s.left.imoCls) && !/vid-miss/.test(s.left.imoCls + s.left.mmsiCls), s.left);
    await shot(page.locator('#vessel-' + id), '02-card-valid-imo-only-harbour.png');
    // invalid MMSI next to a valid IMO: red for the MMSI, but the nomination is complete
    s = await page.evaluate(id => { __set(id, 'mmsi', '123456789', true); return __st(id); }, id);
    check('V2 invalid MMSI beside a valid IMO: red "MMSI must be 9 digits starting 2–7", badge stays "IMO ✓" (complete)', JSON.stringify(s.red) === '["MMSI must be 9 digits starting 2–7"]' && /vid-bad/.test(s.mmsiCls) && s.badge === 'IMO ✓' && !s.amber.length, s);
    s = await page.evaluate(id => { __set(id, 'mmsi', '636 012 345', true); return __st(id); }, id);
    check('V2 both valid: badge "IMO ✓ MMSI ✓", MMSI normalised, no red / amber', s.badge === 'IMO ✓ MMSI ✓' && s.mmsi === '636012345' && !s.red.length && !s.amber.length && /vid-ok/.test(s.imoCls) && /vid-ok/.test(s.mmsiCls), s);
    await shot(page.locator('#vessel-' + id), '02b-card-imo-and-mmsi-harbour.png');
    let cap = await page.evaluate(id => __cap(id), id);
    check('V2 captured: imo + mmsi', cap.imo === '9321483' && cap.mmsi === '636012345', cap);
    s = await page.evaluate(id => { __set(id, 'imo', '', true); return __st(id); }, id);
    check('V2 MMSI only: badge "MMSI ✓", complete', s.badge === 'MMSI ✓' && !s.amber.length && !s.red.length, s);
    s = await page.evaluate(id => { __set(id, 'imo', '9321484', true); return __st(id); }, id);
    check('V2 invalid IMO beside a valid MMSI: red for the IMO, badge "MMSI ✓" (complete)', s.badge === 'MMSI ✓' && JSON.stringify(s.red) === '["Not a valid IMO (check digit)"]', s);

    // keyboard: 9 digits typed into the IMO box move to the MMSI box at once (with a note), cursor follows
    const id2 = await page.evaluate(() => __vessel({ name: 'BRAVO WAVE' }));
    await page.click('#v' + id2 + '-imo');
    await page.keyboard.type('63601234');
    let k = await page.evaluate(id => __st(id), id2);
    check('V2 typing: a partial number is not red while the box is being typed into ("IMO: 7 digits")', !k.red.length && !/vid-bad/.test(k.imoCls) && /IMO: 7 digits/.test(k.hint.join()), k);
    await page.keyboard.type('5');
    k = await page.evaluate(id => __st(id), id2);
    check('V2 typing a 9-digit number into the IMO box moves it to MMSI with a note; the cursor moves along', k.imo === '' && k.mmsi === '636012345' && /Moved 636012345 to MMSI/.test(k.note.join()) && k.focus === 'v' + id2 + '-mmsi' && k.badge === 'MMSI ✓', k);
    await page.keyboard.type('9');  // keeps typing → into the MMSI box
    k = await page.evaluate(id => __st(id), id2);
    check('V2 …and the note goes on the next edit', !k.note.length && k.mmsi === '6360123459', k);
    await page.keyboard.press('Backspace');
    // keyboard: 7 digits typed into the IMO box are checked at once (still in the box)
    const id5 = await page.evaluate(() => __vessel({ name: 'GOLF' }));
    await page.click('#v' + id5 + '-imo');
    await page.keyboard.type('932148');
    k = await page.evaluate(id => __st(id), id5);
    const k6 = k;
    await page.keyboard.type('4');
    k = await page.evaluate(id => __st(id), id5);
    check('V2 typing: 6 digits in the IMO box = hint only; the 7th digit is checked straight away (red "check digit" while still typing)',
      !k6.red.length && /IMO: 7 digits/.test(k6.hint.join()) && JSON.stringify(k.red) === '["Not a valid IMO (check digit)"]' && k.focus === 'v' + id5 + '-imo' && k.badge === 'ID missing', { k6, k });
    await page.keyboard.press('Backspace');
    await page.keyboard.type('3');
    k = await page.evaluate(id => __st(id), id5);
    check('V2 …fixing the last digit → valid at once ("IMO ✓")', !k.red.length && k.imo === '9321483' && k.badge === 'IMO ✓', k);
    await page.keyboard.press('Tab');
    // keyboard: 7 digits typed into the MMSI box stay while typing, move to IMO when the box is left
    const id3 = await page.evaluate(() => __vessel({ name: 'CHARLIE' }));
    await page.click('#v' + id3 + '-mmsi');
    await page.keyboard.type('9321483');
    k = await page.evaluate(id => __st(id), id3);
    check('V2 typing 7 digits into the MMSI box: not moved, not red while typing', k.mmsi === '9321483' && k.imo === '' && !k.red.length && /MMSI: 9 digits/.test(k.hint.join()), k);
    await page.keyboard.press('Tab');
    k = await page.evaluate(id => __st(id), id3);
    check('V2 …leaving the box moves the 7 digits to IMO with a note', k.imo === '9321483' && k.mmsi === '' && /Moved 9321483 to IMO/.test(k.note.join()) && k.badge === 'IMO ✓', k);
    await page.click('#v' + id3 + '-mmsi');
    await page.keyboard.type('12');
    await page.keyboard.press('Tab');
    k = await page.evaluate(id => __st(id), id3);
    check('V2 a partial MMSI turns red once the box is left', JSON.stringify(k.red) === '["MMSI must be 9 digits starting 2–7"]' && k.mmsiInv === 'true' && k.badge === 'IMO ✓', k);
    // a move never overwrites a different number in the other box
    k = await page.evaluate(() => { const id = __vessel({ name: 'DELTA', mmsi: '636012345' }); __set(id, 'imo', '538009876', true); return __st(id); });
    check('V2 9 digits in IMO while the MMSI box holds another number: not moved, red "9 digits is an MMSI"', k.imo === '538009876' && k.mmsi === '636012345' && /9 digits is an MMSI/.test(k.red.join()) && k.badge === 'MMSI ✓', k);
    // saving: the cloud copy gets mmsi only where filled
    await page.evaluate(() => saveSharedState());
    await sleep(300);
    const vs = U.row(db).payload.state.vessels;
    const by = n => vs.find(v => v.name === n) || {};
    check('V2 saved: mmsi stored where filled, no mmsi key where empty', by('ALPHA STAR').mmsi === '636012345' && by('ALPHA STAR').imo === '9321484' && by('BRAVO WAVE').mmsi === '636012345' && by('CHARLIE').imo === '9321483' && by('CHARLIE').mmsi === '12' && by('DELTA').mmsi === '636012345', vs.map(v => [v.name, v.imo, v.mmsi]));
    const id4 = await page.evaluate(() => __vessel({ name: 'ECHO' }));
    cap = await page.evaluate(id => __cap(id), id4);
    check('V2 a new card without an MMSI: no mmsi key', !('mmsi' in cap), cap);
  });

  /* ── 3. Look up links (validated digits or encoded name only) + hostile text ── */
  await scenario(browser, 'V3 look up links + hostile text', async (openT) => {
    const { page } = await openT(H.createDb());
    await page.evaluate(() => __open('nominations'));
    const r = await page.evaluate(() => {
      const a = __vessel({ name: 'MV Sea Breeze', imo: '9321483' }), b = __vessel({ name: 'LIMA', mmsi: '636012345' }), c = __vessel({ name: 'MV Sea Breeze' }), d = __vessel({ name: '' });
      const e = __vessel({ name: 'KILO', imo: '9321484', mmsi: '123456789' });
      return { a: __st(a).look, b: __st(b).look, c: __st(c).look, d: __st(d).look, e: __st(e).look };
    });
    const L = (x, i) => x.links[i] || {};
    check('V3 by a valid IMO: VesselFinder details + MarineTraffic imo:, new tab, rel=noopener',
      L(r.a, 0).href === 'https://www.vesselfinder.com/vessels/details/9321483' && L(r.a, 1).href === 'https://www.marinetraffic.com/en/ais/details/ships/imo:9321483' && r.a.links.every(l => l.target === '_blank' && l.rel === 'noopener') && !r.a.hidden, r.a);
    check('V3 by a valid MMSI when there is no valid IMO', L(r.b, 0).href === 'https://www.vesselfinder.com/vessels/details/636012345' && L(r.b, 1).href === 'https://www.marinetraffic.com/en/ais/details/ships/mmsi:636012345', r.b);
    check('V3 no valid ID → search by the name (MV prefix dropped, URL-encoded)', L(r.c, 0).href === 'https://www.vesselfinder.com/vessels?name=Sea%20Breeze' && L(r.c, 1).href === 'https://www.marinetraffic.com/en/ais/index/search/all/keyword:Sea%20Breeze', r.c);
    check('V3 invalid numbers are never put into a link (name search instead); nothing to look up → links hidden', L(r.e, 0).href === 'https://www.vesselfinder.com/vessels?name=KILO' && r.d.hidden === true, [r.e, r.d]);
    // hostile name + hostile IMO / MMSI text
    const evil = '<img src=x onerror="window.__xss=1">"\' & javascript:alert(2)';
    const x = await page.evaluate(evil => {
      const id = __vessel({ name: evil, imo: '"><svg onload="window.__xss=2">', mmsi: "'><img src=y onerror=window.__xss=3>" });
      const card = document.getElementById('vessel-' + id);
      return { st: __st(id), injected: card.querySelectorAll('img, svg:not([aria-hidden]):not([width])').length, imo: document.getElementById('v' + id + '-imo').value, id };
    }, evil);
    const hv = L(x.st.look, 0).href || '', hm = L(x.st.look, 1).href || '';
    check('V3 hostile name: link is https + encodeURIComponent(name) only, no attribute break-out', hv.startsWith('https://www.vesselfinder.com/vessels?name=%3Cimg%20src%3Dx%20onerror%3D%22window.__xss%3D1%22%3E%22\'%20%26%20javascript%3Aalert(2)') && hm.startsWith('https://www.marinetraffic.com/') && !/[<>" ]/.test(hv) && x.st.look.links.every(l => l.attrs === 6), x.st.look);
    check('V3 hostile IMO / MMSI text stays text (red messages), nothing injected, no script ran', x.imo === '"><svg onload="window.__xss=2">' && x.st.red.length === 2 && x.injected === 0 && await page.evaluate(() => window.__xss === undefined), x);
    await page.evaluate(() => { showPage('dashboard'); refreshDashboard(); _refreshGlobalAlertsBell(); });
    const na = await page.evaluate(() => ({ q: document.getElementById('dash-action-queue').innerHTML, bell: document.getElementById('global-alerts-list').innerHTML, n: document.querySelectorAll('#dash-action-queue img, #dash-action-queue svg[onload], #global-alerts-list img, #global-alerts-list svg[onload]').length }));
    check('V3 hostile name / IMO in Needs Attention + bell are escaped', na.n === 0 && /&lt;img src=x/.test(na.q) && /&lt;img src=x/.test(na.bell) && await page.evaluate(() => window.__xss === undefined), na.n);
  });

  /* ── 4. Needs Attention + bell + hero, keyed per nomination; no toasts ── */
  await scenario(browser, 'V4 needs attention + bell', async (openT) => {
    const seed = U.seedPayload({ vessels: [
      vessel({ nomUid: 'n1', name: 'ALPHA', eta: etaStr(1) }),                                  // nothing → item
      vessel({ nomUid: 'n2', name: 'BRAVO', imo: '9321483', eta: etaStr(1) }),                  // valid IMO
      vessel({ nomUid: 'n3', name: 'CHARLIE', imo: '9321484', eta: etaStr(2) }),                // invalid IMO only → item
      vessel({ nomUid: 'n4', name: 'DELTA', imo: '9321484', mmsi: '636012345', eta: etaStr(2) }),// invalid IMO + valid MMSI → complete
      vessel({ nomUid: 'n5', name: 'ECHO', eta: etaStr(0) }),                                   // already supplied
      vessel({ nomUid: 'n6', name: 'FOXTROT', eta: etaStr(-10) }),                              // long past
      vessel({ nomUid: 'n7', name: 'GOLF', imo: '538009876', eta: etaStr(3) }),                 // legacy MMSI in the IMO box
      vessel({ nomUid: 'n8', name: '', eta: etaStr(3) }),                                       // blank card: not a nomination yet
    ] });
    seed.records = [{ id: 'r5', vessel: 'ECHO', nomUid: 'n5', barge: 'Barge 1', supplied: true, supplyDate: new Date().toISOString(), savedAt: new Date().toISOString(), vlsfoAct: 500, mgoAct: 0 }];
    const db = H.createDb({ workspace: seed });
    const { page } = await openT(db);
    await page.waitForFunction(() => typeof _globalAlertsPrevKeys !== 'undefined' && _globalAlertsPrevKeys !== null, null, { timeout: 15000 });
    await page.evaluate(() => { __open('dashboard'); refreshDashboard(); });
    await sleep(300);
    const r = await page.evaluate(() => {
      const a = computeGlobalAlerts().filter(x => x.kind === 'ids');
      const q = [...document.querySelectorAll('#dash-action-queue .aq-row')].map(row => ({ key: row.dataset.alertKey || '', tag: row.querySelector('.aq-tag').textContent, name: row.querySelector('.aq-name').textContent, detail: row.querySelector('.aq-detail').textContent, btn: (row.querySelector('.aq-btn') || {}).textContent }));
      return { a: a.map(x => ({ key: x.key, label: x.label, sub: x.sub, sev: x.severity })), q, badge: document.getElementById('global-alerts-badge').textContent, bell: document.getElementById('global-alerts-list').textContent, hero: document.getElementById('dash-hero-title').textContent, toasts: __idToasts() };
    });
    const ids = r.q.filter(x => x.tag === 'ID');
    check('V4 bell: one alert per nomination without a valid IMO / MMSI (ids|<nomUid>) — not for complete, supplied, long-past, legacy-MMSI or blank cards',
      r.a.map(x => x.key).join(',') === 'ids|n1,ids|n3' && r.a.every(x => x.sev === 'warning') && r.a[0].label === 'IMO / MMSI missing' && r.a[1].label === 'Check IMO / MMSI', r.a);
    check('V4 bell lists them; badge counts them', /IMO \/ MMSI missing/.test(r.bell) && /ALPHA — No IMO or MMSI/.test(r.bell) && /CHARLIE — IMO 9321484: Not a valid IMO \(check digit\)/.test(r.bell) && Number(r.badge) >= 2, r.bell);
    check('V4 Needs Attention: an "ID" row per nomination, keyed, with "Add IMO / MMSI"',
      ids.length === 2 && ids[0].key === 'ids|n1' && ids[0].name === 'ALPHA' && /No IMO or MMSI/.test(ids[0].detail) && ids[1].key === 'ids|n3' && /check digit/.test(ids[1].detail) && ids.every(x => x.btn === 'Add IMO / MMSI'), r.q);
    check('V4 hero counts them', /— \d+ supplies? today, 2 need your attention\./.test(r.hero), r.hero);
    check('V4 no toast about IMO / MMSI at login', r.toasts.length === 0, r.toasts);
    await shot(page.locator('#dash-action-queue'), '05-needs-attention.png');
    if (SHOTS) {
      await page.evaluate(() => toggleGlobalAlertsPanel());
      await shot(page.locator('#global-alerts-dropdown'), '05b-bell.png');
      await page.evaluate(() => toggleGlobalAlertsPanel());
    }
    // "Add IMO / MMSI" → the card, cursor in the IMO box; typing a valid MMSI clears it — no toast
    await page.evaluate(() => [...document.querySelectorAll('#dash-action-queue .aq-row')].find(x => x.dataset.alertKey === 'ids|n1').querySelector('.aq-btn').click());
    await sleep(400);
    const go = await page.evaluate(() => ({ page: _currentPage, focus: document.activeElement && document.activeElement.id, want: 'v' + __cid('n1') + '-imo' }));
    check('V4 "Add IMO / MMSI" opens the nomination with the cursor in its IMO box', go.page === 'nominations' && go.focus === go.want, go);
    await page.keyboard.type('636012345');
    await sleep(800);
    const after = await page.evaluate(() => ({ a: computeGlobalAlerts().filter(x => x.kind === 'ids').map(x => x.key), bell: document.getElementById('global-alerts-list').textContent, st: __st(__cid('n1')), toasts: __idToasts() }));
    check('V4 fixed on the card → gone from the bell (updated while typing), no toast', after.a.join(',') === 'ids|n3' && !/ALPHA — No IMO/.test(after.bell) && after.st.mmsi === '636012345' && after.toasts.length === 0, after);
    // a colleague's new nomination without IDs shows up on the next bell pass — listed, never toasted
    await page.evaluate(() => { __vessel({ name: 'HOTEL NEW', nomUid: 'n9' }); _refreshGlobalAlertsBell(); });
    const nw = await page.evaluate(() => ({ a: computeGlobalAlerts().filter(x => x.kind === 'ids').map(x => x.key), toasts: __idToasts() }));
    check('V4 a new nomination without IDs: listed (ids|n9), no toast', nw.a.join(',') === 'ids|n3,ids|n9' && nw.toasts.length === 0, nw);
    // the bell item opens the nomination too
    await page.evaluate(() => { showPage('dashboard'); _refreshGlobalAlertsBell(); document.querySelector('#global-alerts-list [data-alert-key="ids|n3"]').click(); });
    await sleep(300);
    check('V4 the bell item opens that nomination', await page.evaluate(() => _currentPage === 'nominations' && document.activeElement && document.activeElement.id === 'v' + __cid('n3') + '-imo'));
    // traders can fix IDs too, so they see the same list
    await page.evaluate(() => saveSharedState());
    const opKeys = await page.evaluate(() => computeGlobalAlerts().filter(x => x.kind === 'ids').map(x => x.key).join(','));
    const T = await openT(db, 'user-trader');
    const t = await T.page.evaluate(() => computeGlobalAlerts().filter(x => x.kind === 'ids').map(x => x.key).join(','));
    check('V4 trader sees the same keyed items (and may fix them)', t === opKeys && opKeys === 'ids|n3,ids|n9' && await T.page.evaluate(() => !document.getElementById('v' + __cid('n3') + '-imo').disabled && !document.getElementById('v' + __cid('n3') + '-mmsi').disabled), [t, opKeys]);
  });

  /* ── 5. Warnings never block: Generate Schedule, Send Nomination Email, Generate Email ── */
  await scenario(browser, 'V5 non-blocking warnings', async (openT) => {
    const dialogs = [];
    const { page } = await openT(H.createDb(), 'user-operator', { onDialog: d => { dialogs.push(d.message()); d.accept().catch(() => {}); } });
    await page.evaluate(() => {
      __open('nominations');
      document.querySelectorAll('.vcard[id^="vessel-"]').forEach(c => c.remove());
      addBarge({ name: 'B1', vcap: 5000, mcap: 1000, vrob: 4000, mrob: 800, vbuf: 0, mbuf: 0, vtph: 300, mtph: 100 });
      window.__a = __vessel({ name: 'NOID ONE', eta: __eta(1, 6) });
      window.__b = __vessel({ name: 'NOID TWO', imo: '9321484', eta: __eta(1, 14) });
      window.__c = __vessel({ name: 'GOOD SHIP', mmsi: '636012345', eta: __eta(2, 6) });
      window.__mail = [];
      window.emailjs = { init() {}, send: async (s, t, params) => { window.__mail.push(params); return { status: 200 }; } };
      window._flashNominationEmailBanner = () => {};
      window.__toastLog.length = 0;
    });
    const r = await page.evaluate(async () => { calculate(); await new Promise(r => setTimeout(r, 50)); return { sched: _lastSched.map(i => i.name), toasts: __idToasts() }; });
    check('V5 Generate Schedule: ONE summary warning naming both, schedule still generated (no dialog)',
      r.sched.length === 3 && r.toasts.length === 1 && /^2 nominations have no valid IMO or MMSI \(NOID ONE, NOID TWO\) — the schedule is generated/.test(r.toasts[0]) && dialogs.length === 0, { r, dialogs });
    const r2 = await page.evaluate(async () => { __set(__a, 'imo', '9321483', true); __set(__b, 'mmsi', '538009876', true); window.__toastLog.length = 0; calculate(); await new Promise(r => setTimeout(r, 50)); return { sched: _lastSched.length, toasts: __idToasts() }; });
    check('V5 all nominations with an ID: no warning', r2.sched === 3 && r2.toasts.length === 0, r2);
    await page.evaluate(() => { __set(__a, 'imo', '', true); __set(__b, 'mmsi', '', true); window.__toastLog.length = 0; showPage('nominations'); });
    // Send Nomination Email (button on the card): warns, sends anyway
    await page.click('#v' + await page.evaluate(() => __a) + '-send-email-btn');
    await sleep(500);
    await page.click('#v' + await page.evaluate(() => __c) + '-send-email-btn');
    await sleep(500);
    const m = await page.evaluate(() => ({ mail: __mail.map(x => x.message), subj: __mail.map(x => x.subject), toasts: __idToasts() }));
    check('V5 Send Nomination Email without an ID: warning toast, e-mail still sent',
      m.toasts.length === 1 && /^NOID ONE has no valid IMO or MMSI — the nomination e-mail is sent without it\./.test(m.toasts[0]) && m.mail.length === 2 && /^Vessel Name: NOID ONE$/m.test(m.mail[0]), m);
    check('V5 a nomination with an ID: no warning; its e-mail names the MMSI', /^Vessel Name: GOOD SHIP \(MMSI 636012345\)$/m.test(m.mail[1]), m.mail[1]);
    // Generate Email: warns, the e-mail modal opens anyway
    await page.evaluate(() => { window.__toastLog.length = 0; });
    await page.click('#vessel-' + await page.evaluate(() => __b) + ' button:has-text("Generate Email")');
    await sleep(300);
    const g = await page.evaluate(() => ({ modal: document.getElementById('em-modal').style.display, subject: document.getElementById('em-subject').value, toasts: __idToasts() }));
    check('V5 Generate Email without a valid ID: warning toast, e-mail generated', g.modal === 'flex' && /NOID TWO/.test(g.subject) && g.toasts.length === 1 && /^NOID TWO has no valid IMO or MMSI — the e-mail is generated without it\./.test(g.toasts[0]), g);
    await page.evaluate(() => emailCloseModal());
    check('V5 never a blocking dialog', dialogs.length === 0, dialogs);
  });

  /* ── 6. E-mails, calling instructions, global search ── */
  await scenario(browser, 'V6 placeholders + search', async (openT) => {
    const { page } = await openT(H.createDb());
    await page.evaluate(() => __open('nominations'));
    const r = await page.evaluate(() => {
      const base = { name: 'X', type: 'VLSFO', qty: 500, area: 'FUJ-A' };
      const line = b => b.split('\n').find(l => /^Vessel Name:/.test(l));
      const em = o => line(_buildNominationEmail(Object.assign({}, base, o)).body);
      const cx = o => line(_buildNominationCancelledEmail(Object.assign({}, base, o)).body);
      const id = __vessel({ name: 'CI STAR', imo: '9321483', mmsi: '636012345', lc: '20-22 Oct 2026', qty: 600 });
      ciOpenForVessel(+id);
      const ctx = _ciVesselCtx;
      const t1 = ciApplyTemplate('To: {{VESSEL_NAME}} IMO {{IMO}} MMSI {{MMSI}}', ctx);
      const t2 = ciApplyTemplate('Master of the vessel with IMO {{IMO}} / MMSI {{MMSI}}', ctx);
      const xml = '<w:document><w:body><w:p><w:r><w:t>IMO: {{IM</w:t></w:r><w:r><w:t>O}} / MMSI: {{MMSI}}</w:t></w:r></w:p><w:p><w:r><w:t>{{VESSEL_NAME}}</w:t></w:r></w:p></w:body></w:document>';
      const dx = ciDocxReplaceParagraphText(xml, ctx, []);
      ciCloseModal();
      // the card changes → the next Calling Instructions run reads the live boxes
      __set(id, 'mmsi', '538009876', true);
      ciOpenForVessel(+id); const t3 = ciApplyTemplate('{{MMSI}}', _ciVesselCtx); ciCloseModal();
      emailOpenForVessel(+id);
      const ea = _emailApply('{{VESSEL_NAME}} — IMO {{IMO}} — MMSI {{MMSI}}', _emailVesselCtx);
      emailCloseModal();
      const blank = __vessel({ name: 'BLANK' });
      ciOpenForVessel(+blank); const t4 = ciApplyTemplate('[{{IMO}}][{{MMSI}}]', _ciVesselCtx); ciCloseModal();
      return {
        em: [em({ imo: '9321483', mmsi: '636012345' }), em({ imo: '9321483' }), em({ mmsi: '636012345' }), em({}), em({ imo: '538009876' })],
        cx: cx({ imo: '9321483', mmsi: '636012345' }),
        t1, t2, t3, t4, ea, dx: dx.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|'),
      };
    });
    check('V6 nomination e-mail names the identifiers that are filled in (legacy 9-digit IMO box = MMSI)',
      JSON.stringify(r.em) === JSON.stringify(['Vessel Name: X (IMO 9321483 / MMSI 636012345)', 'Vessel Name: X (IMO 9321483)', 'Vessel Name: X (MMSI 636012345)', 'Vessel Name: X', 'Vessel Name: X (MMSI 538009876)']), r.em);
    check('V6 cancellation e-mail too', r.cx === 'Vessel Name: X (IMO 9321483 / MMSI 636012345)', r.cx);
    check('V6 calling instructions (text): {{IMO}} and {{MMSI}} next to {{VESSEL_NAME}}; a template with only {{IMO}} / {{MMSI}} is a placeholder template',
      r.t1 === 'To: CI STAR IMO 9321483 MMSI 636012345' && r.t2 === 'Master of the vessel with IMO 9321483 / MMSI 636012345', [r.t1, r.t2]);
    check('V6 calling instructions (.docx): {{IMO}} split across runs and {{MMSI}} replaced', /IMO: 9321483 \/ MMSI: 636012345/.test(r.dx) && /CI STAR/.test(r.dx) && !/\{\{/.test(r.dx), r.dx);
    check('V6 the live card value is used; empty boxes → empty text', r.t3 === '538009876' && r.t4 === '[][]', [r.t3, r.t4]);
    check('V6 Generate Email template: {{IMO}} / {{MMSI}}', r.ea === 'CI STAR — IMO 9321483 — MMSI 538009876', r.ea);
    // global search by IMO / MMSI digits
    await page.fill('#global-search-input', '538009');
    await page.evaluate(() => _globalSearchRun(document.getElementById('global-search-input').value));
    const sr = await page.evaluate(() => document.getElementById('global-search-results').textContent);
    check('V6 global search finds a nomination by its MMSI digits', /CI STAR/.test(sr) && /MMSI 538009876/.test(sr), sr);
    await page.evaluate(() => _globalSearchRun('9321483'));
    check('V6 …and by its IMO', /CI STAR/.test(await page.evaluate(() => document.getElementById('global-search-results').textContent)));
  });

  /* ── 7. Sync: legacy migration without writes, two operators, merge, trader RPC, trash ── */
  await scenario(browser, 'V7 sync', async (openT) => {
    const seed = U.seedPayload();
    const db = H.createDb({ workspace: seed, realtime: false, protectTraderFields: true });
    const A = await openT(db, 'user-operator');
    await A.page.evaluate(() => saveSharedState());
    await sleep(300);
    const wA0 = U.writes(db, 'user-operator').length;
    // An older app saved an MMSI into BRAVO's IMO box.
    const row = U.row(db);
    const legacy = clone(row.payload);
    legacy.state.vessels.find(v => v.nomUid === 'n2').imo = '538009876';
    const ver = Date.now();
    legacy.version = ver; legacy.state.version = ver;
    row.payload = legacy; row.version = ver;
    const before = clone(legacy.state.vessels);
    await A.page.evaluate(() => _pollOnce(true));
    await sleep(2200); // past every debounced save
    const a1 = await A.page.evaluate(() => ({ imo: __getV('n2', 'imo'), mmsi: __getV('n2', 'mmsi'), badge: document.getElementById('v' + __cardFor('n2') + '-idbadge').textContent }));
    check('V7 legacy 9-digit IMO shows in the MMSI box after a pull', a1.imo === '' && a1.mmsi === '538009876' && a1.badge === 'MMSI ✓', a1);
    await A.page.evaluate(() => saveSharedState());
    check('V7 …and causes no write (the re-rendered card is the merge base)', U.writes(db, 'user-operator').length === wA0 && JSON.stringify(U.row(db).payload.state.vessels) === JSON.stringify(before), U.writes(db, 'user-operator').length - wA0);
    const B = await openT(db, 'user-operator2');
    await sleep(2000);
    await B.page.evaluate(() => saveSharedState());
    const b1 = await B.page.evaluate(() => ({ imo: __getV('n2', 'imo'), mmsi: __getV('n2', 'mmsi'), n1: captureCurrentState().vessels.find(v => v.nomUid === 'n1') }));
    check('V7 a second operator opening the workspace: migrated on screen, no write; untouched vessels byte-identical (no mmsi key)',
      b1.imo === '' && b1.mmsi === '538009876' && U.writes(db, 'user-operator2').length === 0 && JSON.stringify(b1.n1) === JSON.stringify(before.find(v => v.nomUid === 'n1')), b1);
    // the move is saved with the card's next edit
    await B.page.evaluate(() => { __setV('n2', 'agent', 'NEW AGENT'); return saveSharedState(); });
    let n2 = U.row(db).payload.state.vessels.find(v => v.nomUid === 'n2');
    check('V7 next edit saves the move: imo "" + mmsi', U.writes(db, 'user-operator2').length === 1 && n2.imo === '' && n2.mmsi === '538009876' && n2.agent === 'NEW AGENT', n2);
    await A.page.evaluate(() => _pollOnce(true));
    await sleep(500);
    await A.page.evaluate(() => saveSharedState());
    check('V7 the other operator converges with no extra write', U.writes(db, 'user-operator').length === wA0 && await A.page.evaluate(() => __getV('n2', 'agent') === 'NEW AGENT' && __getV('n2', 'mmsi') === '538009876'));
    // A types an MMSI on ALPHA; B (not pulled yet) types an IMO on ALPHA → both kept by the three-way merge
    await A.page.evaluate(() => { __set(__cardFor('n1'), 'mmsi', '636012345', true); return saveSharedState(); });
    await B.page.evaluate(() => { __set(__cardFor('n1'), 'imo', '9321483', true); return saveSharedState(); });
    let n1 = U.row(db).payload.state.vessels.find(v => v.nomUid === 'n1');
    check('V7 three-way merge: A\'s MMSI + B\'s IMO on the same nomination both kept, no conflict toast', n1.mmsi === '636012345' && n1.imo === '9321483' && await B.page.evaluate(() => !(window.__toastLog || []).some(t => /Merged with changes/.test(t))), n1);
    check('V7 B shows A\'s MMSI after the merge', await B.page.evaluate(() => __getV('n1', 'mmsi') === '636012345' && document.getElementById('v' + __cardFor('n1') + '-idbadge').textContent === 'IMO ✓ MMSI ✓'));
    // trader edits an MMSI → trader_update_vessels carries it; the server keeps it; operators see it
    const T = await openT(db, 'user-trader');
    await T.page.evaluate(() => _pollOnce(true));
    const dis = await T.page.evaluate(() => [document.getElementById('v' + __cardFor('n2') + '-imo').disabled, document.getElementById('v' + __cardFor('n2') + '-mmsi').disabled]);
    await T.page.evaluate(() => { __set(__cardFor('n2'), 'mmsi', '211111111', true); __set(__cardFor('n2'), 'imo', '9074729', true); return saveSharedState(); });
    const rpc = db.log.filter(o => o.action === 'rpc' && o.name === 'trader_update_vessels').pop();
    const tv = rpc && rpc.args.new_vessels.find(v => v.nomUid === 'n2');
    n2 = U.row(db).payload.state.vessels.find(v => v.nomUid === 'n2');
    check('V7 trader may edit IMO / MMSI; the RPC carries them and the server keeps them (not operator-protected fields)', !dis[0] && !dis[1] && tv && tv.mmsi === '211111111' && tv.imo === '9074729' && n2.mmsi === '211111111' && n2.imo === '9074729', { dis, tv, n2 });
    await A.page.evaluate(() => _pollOnce(true));
    check('V7 operator sees the trader\'s IDs', await A.page.evaluate(() => __getV('n2', 'mmsi') === '211111111' && __getV('n2', 'imo') === '9074729'));
    // trader clears the MMSI → the key disappears again
    await T.page.evaluate(() => { __set(__cardFor('n2'), 'mmsi', '', true); return saveSharedState(); });
    n2 = U.row(db).payload.state.vessels.find(v => v.nomUid === 'n2');
    check('V7 clearing the MMSI box drops the mmsi key', !('mmsi' in n2) && n2.imo === '9074729', n2);
    // trash + restore keeps the MMSI
    await A.page.evaluate(() => _pollOnce(true));
    const tr = await A.page.evaluate(() => {
      window.confirm = () => false;
      rmV(+__cardFor('n1'));
      const def = _trashBin[_trashBin.length - 1].def;
      restoreFromTrash(_trashBin.length - 1);
      return { def: [def.imo, def.mmsi], box: [__getV('n1', 'imo'), __getV('n1', 'mmsi')] };
    });
    check('V7 trash + restore keeps IMO and MMSI', JSON.stringify(tr.def) === '["9321483","636012345"]' && JSON.stringify(tr.box) === '["9321483","636012345"]', tr);
    // nobody keeps writing
    await A.page.evaluate(() => saveSharedState());
    await sleep(300);
    const wA = U.writes(db, 'user-operator').length, wB = U.writes(db, 'user-operator2').length;
    await B.page.evaluate(() => _pollOnce(true));
    await sleep(2000);
    await A.page.evaluate(() => _pollOnce(true));
    await sleep(500);
    const clean = await B.page.evaluate(() => { const l = _mergeDoc(_buildLocalPayload()), b = _mergeDoc(_lastSyncedPayload); return _sameJSON(l.state.vessels, b.state.vessels); });
    check('V7 after everything: pulls cause no further writes, B is clean', U.writes(db, 'user-operator').length === wA && U.writes(db, 'user-operator2').length === wB && clean);
  });

  /* ── 8. Import: parser, review table (MMSI column), add to the card ── */
  await scenario(browser, 'V8 import', async (openT) => {
    const db = H.createDb({ workspace: U.seedPayload() });
    const { page } = await openT(db);
    const P = await page.evaluate(() => {
      const now = new Date(2026, 9, 14, 9, 0);
      const one = t => { const d = _parseNominationText(t, { now })[0]; return { name: d.name, imo: d.imo, mmsi: d.mmsi, qty: d.qty, mgo: d.mgo, low: d.low, remarks: d.remarks }; };
      return {
        a: one('Vessel: MV OCEAN PRIDE\nIMO: 9321483\nMMSI: 636012345\nETA 22 Oct 2026 0600\nVLSFO 500 MT'),
        b: one('MV SEA LION IMO No: 9074729 MMSI 538009876 ETA 23 Oct 2026 1000 VLSFO 300 MT'),
        c: one('MV KILO\nIMO No. 9811000\nMMSI No. 211111111\nETA 24 Oct 2026 0800\nLSMGO 50 MT'),
        d: one('MV BAD MMSI\nMMSI: 123456789\nETA 24 Oct 2026 0800\nVLSFO 100 MT'),
        e: one('MV NINE\nIMO: 636012345\nETA 24 Oct 2026 0800\nVLSFO 100 MT'),
        f: one('Vessel: MV OCEAN PRIDE (IMO 9321483, MMSI 636 012 345)\nETA 22 Oct 2026 0600\nVLSFO 500 MT'),
        g: one('MV PLAIN ETA 25 Oct 2026 0800 VLSFO 200 MT'),
        h: one('OCEAN PRIDE IMO 9321483\nETA 22 Oct 2026 0600\nVLSFO 500 MT'),
        i: one('MMSI 636012345\nOCEAN PRIDE MMSI 636012345\nETA 22 Oct 2026 0600\nVLSFO 500 MT'),
        combo: _parseNominationText('Vessel\tIMO / MMSI\tETA\tVLSFO\nMV COMBO ONE\t9321483\t22 Oct 2026 0600\t500\nMV COMBO TWO\t636012345\t23 Oct 2026 0600\t300\nMV COMBO THREE\t9321484\t24 Oct 2026 0600\t200', { now }).map(d => [d.name, d.imo, d.mmsi, !!d.low.imo, !!d.low.mmsi]),
        tbl: _parseNominationText('Vessel\tIMO\tMMSI\tETA\tVLSFO\nMV TAB ONE\t9321483\t636012345\t22 Oct 2026 0600\t500\nMV TAB TWO\t\t538009876\t23 Oct 2026 0600\t300', { now }).map(d => [d.name, d.imo, d.mmsi, d.qty]),
      };
    });
    check('V8 parser: "IMO: …" + "MMSI: …" lines; MMSI line not in remarks, quantity untouched', P.a.name === 'OCEAN PRIDE' && P.a.imo === '9321483' && P.a.mmsi === '636012345' && P.a.qty === 500 && !/MMSI|636012345/.test(P.a.remarks) && !P.a.low.mmsi, P.a);
    check('V8 parser: "IMO No: …" / "MMSI …" inline; "IMO No. …" / "MMSI No. …"', P.b.imo === '9074729' && P.b.mmsi === '538009876' && P.b.qty === 300 && P.b.name === 'SEA LION' && P.c.imo === '9811000' && P.c.mmsi === '211111111' && P.c.mgo === 50, [P.b, P.c]);
    check('V8 parser: invalid MMSI kept and flagged; 9 digits after "IMO" taken as the MMSI (flagged)', P.d.mmsi === '123456789' && /9 digits starting 2–7/.test(P.d.low.mmsi) && P.e.imo === '' && P.e.mmsi === '636012345' && /taken as the MMSI/.test(P.e.low.mmsi), [P.d, P.e]);
    check('V8 parser: "(IMO 9321483, MMSI 636 012 345)" after the name; no IDs → empty', P.f.name === 'OCEAN PRIDE' && P.f.imo === '9321483' && P.f.mmsi === '636012345' && P.g.imo === '' && P.g.mmsi === '', [P.f, P.g]);
    check('V8 parser: an all-caps name line with "IMO …" / "MMSI …" after it keeps the name (an "MMSI …" line is never the name)', P.h.name === 'OCEAN PRIDE' && P.h.imo === '9321483' && P.i.name === 'OCEAN PRIDE' && P.i.mmsi === '636012345' && !/MMSI/.test(P.i.remarks), [P.h, P.i]);
    check('V8 parser: one "IMO / MMSI" column — 7 digits land in IMO (check digit flagged), 9 digits in MMSI', JSON.stringify(P.combo) === JSON.stringify([['COMBO ONE', '9321483', '', false, false], ['COMBO TWO', '', '636012345', false, false], ['COMBO THREE', '9321484', '', true, false]]), P.combo);
    check('V8 parser: table with an MMSI column', JSON.stringify(P.tbl) === JSON.stringify([['TAB ONE', '9321483', '636012345', 500], ['TAB TWO', '', '538009876', 300]]), P.tbl);

    // review table
    await page.evaluate(() => { __open('nominations'); document.getElementById('nimp').open = true; });
    await page.fill('#nimp-text', 'MV IMPORT ONE\nIMO 9321483\nMMSI: 123456789\nETA 22 Oct 2026 0600\nVLSFO 500 MT\n\nMV IMPORT TWO\nETA 23 Oct 2026 0800\nVLSFO 300 MT\n\nMV IMPORT THREE (IMO 9074729)\nETA 24 Oct 2026 0800\nVLSFO 200 MT');
    await page.click('#nimp-read');
    await page.waitForSelector('#nimp-results tr.nimp-row');
    const rv = await page.evaluate(() => ({
      hdr: [...document.querySelectorAll('#nimp-results thead th')].map(t => t.textContent),
      rows: [...document.querySelectorAll('#nimp-results tr.nimp-row')].map(tr => { const g = k => tr.querySelector('[data-k="' + k + '"]'); return { imo: g('imo').value, mmsi: g('mmsi').value, imoCls: g('imo').className, mmsiCls: g('mmsi').className, mmsiLbl: g('mmsi').closest('td').dataset.label, msg: tr.nextElementSibling.textContent }; }),
      cols: document.querySelectorAll('#nimp-results colgroup col').length,
    }));
    check('V8 review table: an MMSI column right after IMO (one more column than before)', JSON.stringify(rv.hdr.slice(1, 5)) === JSON.stringify(['Vessel', 'IMO', 'MMSI', 'ETA']) && rv.cols === 12 && rv.rows[0].mmsiLbl === 'MMSI', rv.hdr);
    check('V8 invalid MMSI highlighted red with its message (IMO valid → no "missing")', rv.rows[0].imo === '9321483' && rv.rows[0].mmsi === '123456789' && /nimp-idbad/.test(rv.rows[0].mmsiCls) && !/nimp-idbad|nimp-low/.test(rv.rows[0].imoCls) && /MMSI must be 9 digits starting 2–7/.test(rv.rows[0].msg) && !/No IMO or MMSI/.test(rv.rows[0].msg), rv.rows[0]);
    check('V8 no IMO / MMSI: both cells amber, "No IMO or MMSI" note (not a blocking problem)', /nimp-low/.test(rv.rows[1].imoCls) && /nimp-low/.test(rv.rows[1].mmsiCls) && /No IMO or MMSI — add one/.test(rv.rows[1].msg) && !/Needs/.test(rv.rows[1].msg), rv.rows[1]);
    check('V8 a valid IMO alone: nothing highlighted', !/nimp-low|nimp-idbad/.test(rv.rows[2].imoCls + rv.rows[2].mmsiCls), rv.rows[2]);
    await shot(page.locator('#nimp-results'), '07-import-review-mmsi-column.png');
    // edit in the table
    await page.fill('#nimp-row-0 [data-k="mmsi"]', '636012345');
    await page.fill('#nimp-row-1 [data-k="mmsi"]', '538009876');
    const ed = await page.evaluate(() => [0, 1].map(i => { const tr = document.getElementById('nimp-row-' + i); return { imoCls: tr.querySelector('[data-k="imo"]').className, mmsiCls: tr.querySelector('[data-k="mmsi"]').className, msg: tr.nextElementSibling.textContent, d: _niDrafts[i].mmsi }; }));
    check('V8 editing the MMSI cell clears the highlight and the note', ed.every(x => !/nimp-low|nimp-idbad/.test(x.imoCls + x.mmsiCls) && !/MMSI must|No IMO or MMSI/.test(x.msg)) && ed[0].d === '636012345' && ed[1].d === '538009876', ed);
    // row 3: a 9-digit number typed into the IMO cell lands in the card's MMSI box
    await page.fill('#nimp-row-2 [data-k="imo"]', '412000004');
    await page.click('#nimp-add-all');
    await sleep(500);
    const cards = await page.evaluate(() => ['IMPORT ONE', 'IMPORT TWO', 'IMPORT THREE'].map(n => { const v = captureCurrentState().vessels.find(x => x.name === n); const c = [...document.querySelectorAll('.vcard')].find(x => x.dataset.nomUid === (v && v.nomUid)); const id = c && c.id.replace('vessel-', ''); return { v, box: id ? [document.getElementById('v' + id + '-imo').value, document.getElementById('v' + id + '-mmsi').value, document.getElementById('v' + id + '-idbadge').textContent] : null }; }));
    check('V8 added cards carry IMO + MMSI (shown in the boxes, badge)', cards[0].v && cards[0].v.imo === '9321483' && cards[0].v.mmsi === '636012345' && cards[0].box[2] === 'IMO ✓ MMSI ✓' && cards[1].v.mmsi === '538009876' && cards[1].v.imo === '' && cards[1].box[2] === 'MMSI ✓', cards.slice(0, 2));
    check('V8 a 9-digit number in the IMO cell becomes the MMSI', cards[2].v && cards[2].v.imo === '' && cards[2].v.mmsi === '412000004' && JSON.stringify(cards[2].box) === '["","412000004","MMSI ✓"]', cards[2]);
    const cloud = U.row(db).payload.state.vessels;
    check('V8 saved to the cloud with the MMSI', cloud.some(v => v.name === 'IMPORT ONE' && v.mmsi === '636012345') && cloud.some(v => v.name === 'IMPORT TWO' && v.mmsi === '538009876'), cloud.map(v => [v.name, v.imo, v.mmsi]));
    // duplicates by MMSI
    await page.fill('#nimp-text', 'MV SOMETHING ELSE\nMMSI 538009876\nETA 30 Oct 2026 0600\nVLSFO 100 MT');
    await page.click('#nimp-read');
    await page.waitForSelector('#nimp-results tr.nimp-row');
    const dup = await page.evaluate(() => document.getElementById('nimp-msg-0').textContent);
    check('V8 same MMSI as a nomination in the register → possible duplicate', /Possible duplicate: IMPORT TWO/.test(dup) && /MMSI 538009876/.test(dup), dup);
  });

  /* ── 9. Looks: Classic skin, phone 390 px ── */
  await scenario(browser, 'V9 classic + phone', async (openT) => {
    const seed = U.seedPayload({ vessels: [vessel({ nomUid: 'p1', name: 'PHONE CHECK', eta: etaStr(2) }), vessel({ nomUid: 'p2', name: 'PHONE VALID', imo: '9321484', mmsi: '636012345', eta: etaStr(3) })] });
    const C = await openT(H.createDb({ workspace: seed }), 'user-operator', { localStorage: { 'flow-skin': 'classic' } });
    await C.page.evaluate(() => __open('nominations'));
    const c = await C.page.evaluate(() => {
      const id = __cid('p2'), el = document.getElementById('v' + id + '-imo'), b = document.getElementById('v' + id + '-idbadge');
      const cs = getComputedStyle(el), bs = getComputedStyle(b);
      return { skin: document.documentElement.dataset.skin, border: cs.borderTopColor, badge: b.textContent, bdisp: bs.display, bcol: bs.color, lbl: getComputedStyle(document.querySelector('#vessel-' + id + ' .vid-field label')).textTransform };
    });
    const red = s => { const m = /rgba?\((\d+), (\d+), (\d+)/.exec(s); return m && +m[1] > 150 && +m[2] < 110 && +m[3] < 110; };
    check('V9 Classic: invalid IMO has a red border, badge shown, classic label style', c.skin === 'classic' && red(c.border) && c.badge === 'MMSI ✓' && c.bdisp !== 'none' && c.lbl === 'uppercase', c);
    await shot(C.page.locator('#vessel-' + await C.page.evaluate(() => __cid('p2'))), '04-classic-card.png');
    await C.page.evaluate(() => document.getElementById('vessel-' + __cid('p1')).scrollIntoView({ block: 'center' })); // clear of the sticky top bar
    await shot(C.page.locator('#vessel-' + await C.page.evaluate(() => __cid('p1'))), '04b-classic-card-missing.png');
    // Harbour: same red state
    const Hh = await openT(H.createDb({ workspace: seed }), 'user-operator');
    await Hh.page.evaluate(() => __open('nominations'));
    const hb = await Hh.page.evaluate(() => getComputedStyle(document.getElementById('v' + __cid('p2') + '-imo')).borderTopColor);
    check('V9 Harbour: invalid IMO has a red border', red(hb), hb);
    // phone
    const Ph = await openT(H.createDb({ workspace: seed }), 'user-operator', { viewport: { width: 390, height: 844 } });
    await Ph.page.evaluate(() => __open('nominations'));
    await sleep(300);
    const ph = await Ph.page.evaluate(() => {
      const id = __cid('p1'), card = document.getElementById('vessel-' + id), f = card.querySelector('.vid-field'), n = card.querySelector('.vname-field');
      const r = el => el.getBoundingClientRect();
      const grid = f.parentElement;
      return { docW: document.documentElement.scrollWidth, cardOver: card.scrollWidth - card.clientWidth, fw: Math.round(r(f).width), gw: Math.round(r(grid).width), nw: Math.round(r(n).width),
        iw: [Math.round(r(document.getElementById('v' + id + '-imo')).width), Math.round(r(document.getElementById('v' + id + '-mmsi')).width)], same: Math.abs(r(document.getElementById('v' + id + '-imo')).top - r(document.getElementById('v' + id + '-mmsi')).top) < 2,
        msgOver: card.querySelector('.vid-msg').scrollWidth - card.querySelector('.vid-msg').clientWidth, hdrBadge: getComputedStyle(document.getElementById('v' + id + '-idbadge')).display };
    });
    check('V9 390 px: no sideways scroll; name and IMO / MMSI each get a full row; both boxes side by side and wide enough for 9 digits',
      ph.docW <= 391 && ph.cardOver <= 1 && Math.abs(ph.fw - ph.gw) <= 1 && Math.abs(ph.nw - ph.gw) <= 1 && ph.same && ph.iw.every(w => w >= 120) && ph.msgOver <= 1 && ph.hdrBadge !== 'none', ph);
    await Ph.page.evaluate(() => document.getElementById('vessel-' + __cid('p1')).scrollIntoView());
    await shot(Ph.page.locator('#vessel-' + await Ph.page.evaluate(() => __cid('p1'))), '06-phone-390-card.png');
  });

  await browser.close();
  console.log(`ids.test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
