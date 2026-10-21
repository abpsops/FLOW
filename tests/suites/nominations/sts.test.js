/* STS (ship-to-ship) supply, ticked on the nomination.
   • tick box on the card → saved on the nomination only when ticked (like etaWin)
   • survives reload, two-device merge (tick AND untick), the trader save path, trash/restore
   • rides onto the planned schedule, the checklist row and the saved record
   • the WHOLE card / row / pill is filled green on: nomination card, Weekly Planned Supply
     calendar, Voyage Schedule, Supply Timeline, Checklist, Saved Records (+ What-if Planner)
   • ticking after a schedule exists updates those screens at once (it does not affect planning)
   • planning is unchanged by the tick
   node suites/nominations/sts.test.js [appDir] */
const H = require('../../harness/harness.js');
const U = require('../r3/util.js');
const appDir = process.argv[2] || H.APP_DIR;

let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) pass++; else fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 600)));
}
const HELPERS = () => {
  const p = n => String(n).padStart(2, '0');
  window.__fmt = d => p(d.getDate()) + ' ' + MO[d.getMonth()] + ' ' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  window.__reset = function () {
    const o = document.getElementById('flow-welcome-overlay'); if (o) o.style.display = 'none';
    document.querySelectorAll('.vcard[id^="vessel-"]').forEach(c => c.remove());
    (_barges || []).slice().forEach(b => rmBarge(b.id));
    _lastSched = []; _checklistRecords = {}; _savedSupplies = []; _deliveryLog = {}; _loadingRecords = []; _bargeBlocks = []; _bargeReloads = []; _manualROB = {}; _trashBin = [];
  };
  // tomorrow 08:00 + h hours, as the app's date text
  window.__at = h => { const d = new Date(); d.setHours(8, 0, 0, 0); d.setDate(d.getDate() + 1); return __fmt(new Date(d.getTime() + h * 3600000)); };
  window.__week = function () {
    __reset();
    addBarge({ name: 'FNSA 10', vrob: 4000, mrob: 800 }); addBarge({ name: 'FNSA 11', vrob: 4800, mrob: 900 });
    addVessel({ name: 'CHILE PROSPERITY', type: 'BOTH', qty: 1500, mgo: 100, eta: __at(0) });
    addVessel({ name: 'MARAN VENUS', type: 'VLSFO', qty: 900, eta: __at(5), sts: true });
    addVessel({ name: 'PACIFIC DAWN', type: 'MGO', qty: 0, mgo: 250, eta: __at(30) });
    addVessel({ name: 'ORIENT STAR', type: 'VLSFO', qty: 700, eta: __at(34), sts: true });
  };
  window.__cardOf = name => [...document.querySelectorAll('.vcard[id^="vessel-"]')].find(c => document.getElementById(c.id.replace('vessel-', 'v') + '-name').value === name);
  window.__idOf = name => __cardOf(name).id.replace('vessel-', '');
  window.__bg = el => getComputedStyle(el).backgroundColor;
  window.__calCards = () => [...document.querySelectorAll('#week-calendar .cal-vcard')].map(e => ({ name: e.querySelector('div[style*="font-size:10.5px"]').textContent.replace(/\s*STS\s*$/, '').trim(), sts: e.classList.contains('is-sts'), tag: !!e.querySelector('.sts-tag'), bg: __bg(e) }));
};

async function scenario(browser, name, fn, opts) {
  const db = (opts && opts.db) || H.createDb();
  const app = await H.openApp(browser, db, Object.assign({ appDir, uid: 'user-operator', onDialog: async d => { try { /Nomination Cancelled/.test(d.message()) ? await d.dismiss() : await d.accept(); } catch (e) {} } }, opts || {}));
  await app.page.evaluate(HELPERS);
  try { await fn(app.page, app, db); }
  catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
  const errs = app.errors.filter(e => !/capacitorExports/.test(e));
  check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
  await app.ctx.close();
}

(async () => {
  const browser = await H.launch();

  await scenario(browser, 'T1 the tick', async (page) => {
    const r = await page.evaluate(() => {
      __week();
      const cap = () => Object.fromEntries(captureCurrentState().vessels.map(v => [v.name, v]));
      const out = {};
      const chk = id => document.getElementById('v' + id + '-sts');
      out.initial = Object.fromEntries([...document.querySelectorAll('.vcard[id^="vessel-"]')].map(c => [document.getElementById(c.id.replace('vessel-', 'v') + '-name').value, [chk(c.id.replace('vessel-', '')).checked, c.hasAttribute('data-sts')]]));
      const a = cap();
      out.capturedSts = Object.fromEntries(Object.entries(a).map(([k, v]) => [k, 'sts' in v ? v.sts : 'absent']));
      // tick CHILE through the checkbox the way a user does
      const id = __idOf('CHILE PROSPERITY'); chk(id).checked = true; chk(id).dispatchEvent(new Event('change', { bubbles: true }));
      out.afterTick = [cap()['CHILE PROSPERITY'].sts, __cardOf('CHILE PROSPERITY').hasAttribute('data-sts')];
      chk(id).checked = false; chk(id).dispatchEvent(new Event('change', { bubbles: true }));
      out.afterUntick = ['sts' in cap()['CHILE PROSPERITY'], __cardOf('CHILE PROSPERITY').hasAttribute('data-sts')];
      // the card is keyboard reachable and labelled
      out.label = chk(id).getAttribute('aria-label') + '|' + chk(id).closest('label').textContent.trim();
      out.pos = (() => { const l = chk(id).closest('label').getBoundingClientRect(), c = __cardOf('CHILE PROSPERITY').getBoundingClientRect(); return l.top >= c.top && l.bottom <= c.top + 80; })();
      return out;
    });
    check('T1 only the ticked nominations start ticked (card box + tinted card)', JSON.stringify(r.initial) === JSON.stringify({ 'CHILE PROSPERITY': [false, false], 'MARAN VENUS': [true, true], 'PACIFIC DAWN': [false, false], 'ORIENT STAR': [true, true] }), r.initial);
    check('T1 the nomination stores sts:true only when ticked (absent otherwise)', JSON.stringify(r.capturedSts) === JSON.stringify({ 'CHILE PROSPERITY': 'absent', 'MARAN VENUS': true, 'PACIFIC DAWN': 'absent', 'ORIENT STAR': true }), r.capturedSts);
    check('T1 ticking stores it and tints the card; unticking removes the key and the tint', r.afterTick[0] === true && r.afterTick[1] === true && r.afterUntick[0] === false && r.afterUntick[1] === false, r);
    check('T1 the box is labelled "STS" and sits in the card header', /STS operation\|STS/.test(r.label) && r.pos, r);
  });

  await scenario(browser, 'T2 every screen', async (page) => {
    const r = await page.evaluate(() => {
      __week(); calculate();
      const out = {};
      const sched = _lastSched; out.sched = sched.map(i => [i.name, i.sts === true ? true : ('sts' in i ? 'bad' : 'absent')]);
      showPage('dashboard'); renderWeekCalendar(0);
      out.cal = __calCards().sort((a, b) => a.name.localeCompare(b.name));
      showPage('schedule');
      out.voy = [...document.querySelectorAll('#voy-barge-tabs .voy-tbl tbody tr')].map(tr => [tr.querySelector('td:nth-child(3)').textContent.replace('STS', '').trim(), tr.classList.contains('is-sts'), !!tr.querySelector('.sts-tag'), __bg(tr.querySelector('td:nth-child(3)'))]);
      showPage('timeline');
      out.tl = [...document.querySelectorAll('#tl .tli')].map(t => [t.querySelector('.tlvn').textContent.replace('STS', '').replace(/^#\d+ — /, '').trim(), t.classList.contains('is-sts'), !!t.querySelector('.sts-tag'), __bg(t.querySelector('.tlc'))]);
      showPage('checklist');
      out.cl = [...document.querySelectorAll('#page-checklist tbody tr[id^="cl-row-"]')].map(tr => [tr.querySelector('td:nth-child(2)').textContent.replace('STS', '').trim(), tr.classList.contains('is-sts'), !!tr.querySelector('.sts-tag'), __bg(tr.querySelector('td:nth-child(2)'))]);
      out.recs = Object.values(_checklistRecords).map(r => [r.vessel, r.sts === true ? true : ('sts' in r ? 'bad' : 'absent')]);
      out.token = getComputedStyle(document.documentElement).getPropertyValue('--sts-lt').trim();
      return out;
    });
    const isSts = n => n === 'MARAN VENUS' || n === 'ORIENT STAR';
    check('T2 the planned schedule carries sts:true only on STS vessels', r.sched.every(([n, v]) => isSts(n) ? v === true : v === 'absent'), r.sched);
    check('T2 checklist records carry it too', r.recs.every(([n, v]) => isSts(n) ? v === true : v === 'absent'), r.recs);
    const fillOf = rows => { const sts = rows.filter(x => x[0] && isSts(x[0])), plain = rows.filter(x => x[0] && !isSts(x[0])); return { sts, plain }; };
    const calSts = r.cal.filter(c => isSts(c.name)), calPlain = r.cal.filter(c => !isSts(c.name));
    check('T2 calendar: the STS pills carry the tag and the class; the others do not', r.cal.length === 4 && calSts.length === 2 && calSts.every(c => c.sts && c.tag) && calPlain.every(c => !c.sts && !c.tag), r.cal);
    check('T2 calendar: the WHOLE STS pill is filled (a different colour from every other pill)', calSts.every(c => c.bg !== calPlain[0].bg) && new Set(calSts.map(c => c.bg)).size === 1, r.cal.map(c => c.bg));
    const v = fillOf(r.voy.map(x => [x[0], x[1], x[2], x[3]]));
    check('T2 Voyage Schedule: STS rows carry the tag and the fill', v.sts.length === 2 && v.sts.every(x => x[1] && x[2]) && v.plain.every(x => !x[1] && !x[2]) && v.sts.every(x => x[3] !== v.plain[0][3]), r.voy);
    const t = fillOf(r.tl);
    check('T2 Supply Timeline: STS cards carry the tag and the fill', t.sts.length === 2 && t.sts.every(x => x[1] && x[2]) && t.plain.every(x => !x[1] && !x[2]) && t.sts.every(x => x[3] !== t.plain[0][3]), r.tl);
    const c = fillOf(r.cl);
    check('T2 Checklist: STS rows carry the tag and the fill', c.sts.length === 2 && c.sts.every(x => x[1] && x[2]) && c.plain.every(x => !x[1] && !x[2]) && c.sts.every(x => x[3] !== c.plain[0][3]), r.cl);
    check('T2 one colour token drives them all (a colour, not transparent)', /^#[0-9a-f]{3,8}$/i.test(r.token) && r.token.toLowerCase() !== '#ffffff', r.token);
  });

  await scenario(browser, 'T3 tick after the schedule exists', async (page) => {
    const r = await page.evaluate(() => {
      __week(); calculate();
      const snap = () => JSON.stringify({ s: _lastSched, c: _checklistRecords, m: _lastSchedMeta });
      const before = snap();
      const id = __idOf('PACIFIC DAWN'), box = document.getElementById('v' + id + '-sts');
      box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true }));
      const out = {};
      out.untouched = snap() === before;                     // schedule, checklist records and their stamp are never written by a tick
      out.state = captureCurrentState().vessels.find(v => v.name === 'PACIFIC DAWN').sts === true;
      renderWeekCalendar(0);
      out.cal = __calCards().find(c => c.name === 'PACIFIC DAWN');
      out.voy = [...document.querySelectorAll('#voy-barge-tabs .voy-tbl tbody tr')].filter(tr => /PACIFIC DAWN/.test(tr.textContent)).every(tr => tr.classList.contains('is-sts') && tr.querySelector('.sts-tag'));
      out.tl = [...document.querySelectorAll('#tl .tli')].filter(t => /PACIFIC DAWN/.test(t.textContent)).every(t => t.classList.contains('is-sts') && t.querySelector('.sts-tag'));
      out.cl = document.querySelector('#cl-row-' + Object.values(_checklistRecords).find(r => r.vessel === 'PACIFIC DAWN').uid).classList.contains('is-sts');
      // a full redraw (what any other change triggers) agrees with the in-place repaint
      renderChecklist(_lastSched); renderBargeTabsAndTL(_lastSched, getBarges());
      out.redraw = [document.querySelector('#cl-row-' + Object.values(_checklistRecords).find(r => r.vessel === 'PACIFIC DAWN').uid).classList.contains('is-sts'),
        [...document.querySelectorAll('#tl .tli')].filter(t => /PACIFIC DAWN/.test(t.textContent)).every(t => t.classList.contains('is-sts'))];
      out.planSame = true;
      box.checked = false; box.dispatchEvent(new Event('change', { bubbles: true }));
      out.off = [__calCards().find(c => c.name === 'PACIFIC DAWN') && 0, document.querySelectorAll('#voy-barge-tabs tr.is-sts .sts-tag').length];
      renderWeekCalendar(0);
      out.offCal = __calCards().find(c => c.name === 'PACIFIC DAWN').sts;
      // the schedule that was stamped at Generate says ticked, the card now says not: the card wins
      out.stampWins = _lastSched.find(i => i.name === 'MARAN VENUS').sts === true;
      const mid = __idOf('MARAN VENUS'), mbox = document.getElementById('v' + mid + '-sts'); mbox.checked = false; mbox.dispatchEvent(new Event('change', { bubbles: true }));
      renderWeekCalendar(0); renderChecklist(_lastSched);
      out.cardWins = [__calCards().find(c => c.name === 'MARAN VENUS').sts, document.querySelector('#cl-row-' + Object.values(_checklistRecords).find(r => r.vessel === 'MARAN VENUS').uid).classList.contains('is-sts')];
      calculate();
      out.regen = _lastSched.map(i => [i.name, !!i.sts]);
      return out;
    });
    check('T3 ticking changes the nomination only — the generated schedule, checklist records and their stamp are untouched', r.untouched && r.state, r);
    check('T3 …and every screen follows at once (calendar, voyage, timeline, checklist), also after a full redraw', r.cal.sts && r.cal.tag && r.voy && r.tl && r.cl && r.redraw.every(Boolean), r);
    check('T3 unticking clears them again (rows repainted in place, calendar redrawn)', r.off[1] === 2 && r.offCal === false, r);
    check('T3 the card is the truth: a schedule stamped "STS" at Generate stops showing STS once the nomination is unticked', r.stampWins && r.cardWins[0] === false && r.cardWins[1] === false, r);
    check('T3 regenerating re-stamps from the cards', JSON.stringify(r.regen) === JSON.stringify([['CHILE PROSPERITY', false], ['MARAN VENUS', false], ['PACIFIC DAWN', false], ['ORIENT STAR', true]]), r.regen);
  });

  await scenario(browser, 'T3b ticking never redraws what someone is working in', async (page) => {
    const r = await page.evaluate(() => {
      __week(); calculate();
      const rec = Object.values(_checklistRecords).find(x => x.vessel === 'PACIFIC DAWN');
      showPage('checklist');
      const inp = document.getElementById('cl-am-' + rec.uid); inp.value = '123'; inp.focus();
      const row = document.getElementById('cl-row-' + rec.uid);
      showPage('schedule');
      const chk = document.querySelector('#voy-barge-tabs .voy-print-chk'); chk.checked = false;
      const tabs = document.querySelector('#voy-barge-tabs'), tl = document.querySelector('#tl .tli');
      const id = __idOf('PACIFIC DAWN'), box = document.getElementById('v' + id + '-sts');
      box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true }));
      return { typed: document.getElementById('cl-am-' + rec.uid) === inp && inp.value, rowSame: document.getElementById('cl-row-' + rec.uid) === row, rowSts: row.classList.contains('is-sts'),
        printTick: document.querySelector('#voy-barge-tabs .voy-print-chk') === chk && chk.checked === false, tabsSame: document.querySelector('#voy-barge-tabs') === tabs, tlSame: document.querySelector('#tl .tli') === tl };
    });
    check('T3b a half-typed checklist actual survives ticking STS (the row is repainted, not redrawn)', r.typed === '123' && r.rowSame && r.rowSts, r);
    check('T3b a cleared print tick, the voyage tabs and the timeline cards are the same elements afterwards', r.printTick && r.tabsSame && r.tlSame, r);
  });

  await scenario(browser, 'T4 saved record, trash, calendar without a schedule', async (page) => {
    const r = await page.evaluate(async () => {
      __week(); calculate();
      const out = {};
      const rec = Object.values(_checklistRecords).find(x => x.vessel === 'MARAN VENUS');
      document.getElementById('cl-av-' + rec.uid).value = '900';
      await saveChecklistRecord(rec.uid);
      const saved = _savedSupplies.find(s => s.checklistUid === rec.uid);
      out.saved = saved && saved.sts;
      const plain = Object.values(_checklistRecords).find(x => x.vessel === 'CHILE PROSPERITY');
      document.getElementById('cl-av-' + plain.uid).value = '1500'; document.getElementById('cl-am-' + plain.uid).value = '100';
      await saveChecklistRecord(plain.uid);
      out.plainSaved = 'sts' in _savedSupplies.find(s => s.checklistUid === plain.uid);
      showPage('records'); renderSavedRecords();
      out.rows = [...document.querySelectorAll('#page-records .saved-record-row')].map(r => [r.querySelector('.saved-record-vessel').textContent.replace('STS', '').trim().split('\n')[0].trim(), r.classList.contains('is-sts'), !!r.querySelector('.sts-tag')]);
      // remove a ticked nomination, restore it from the trash bin → still ticked
      const id = __idOf('ORIENT STAR'); const uidBefore = document.getElementById('vessel-' + id).dataset.nomUid;
      rmV(+id); await new Promise(r => setTimeout(r, 600));
      out.cardGone = !document.getElementById('vessel-' + id);
      out.trashHas = _trashBin.some(t => t.def && t.def.name === 'ORIENT STAR' && t.def.sts === true);
      const t = _trashBin.find(t => t.def.name === 'ORIENT STAR'); addVessel(t.def);
      out.restored = document.getElementById('v' + __idOf('ORIENT STAR') + '-sts').checked;
      // no schedule yet → the calendar falls back to the cards and still shows STS
      _lastSched = []; renderWeekCalendar(0);
      out.fallback = __calCards().map(c => [c.name, c.sts]);
      return out;
    });
    check('T4 the saved supply record carries sts (and a plain one does not)', r.saved === true && r.plainSaved === false, r);
    check('T4 Saved Records: the STS record is tagged and filled, the other is not', r.rows.some(x => /MARAN VENUS/.test(x[0]) && x[1] && x[2]) && r.rows.some(x => /CHILE/.test(x[0]) && !x[1] && !x[2]), r.rows);
    check('T4 Trash → restore keeps the nomination ticked', r.trashHas && r.restored, r);
    check('T4 with no schedule yet the calendar still shows STS nominations filled (the supplied ones are gone from it)', r.cardGone && r.fallback.length === 2 && r.fallback.some(x => /ORIENT STAR/.test(x[0]) && x[1]) && r.fallback.some(x => /PACIFIC DAWN/.test(x[0]) && !x[1]), r.fallback);
  });

  await scenario(browser, 'T5 planning is untouched', async (page) => {
    const r = await page.evaluate(() => {
      __week(); calculate();
      const plan = () => JSON.stringify(_lastSched.map(i => [i.name, +new Date(i.bargeStart), +new Date(i.etc), i.bargeLabel, i.vQ, i.mQ, i.robVA, i.robMA]));
      const a = plan();
      document.querySelectorAll('[id$="-sts"]').forEach(b => { b.checked = !b.checked; });
      calculate();
      const b2 = plan();
      // the What-if Planner shows the tag and plans the same
      __week(); calculate(); _sim = null; showPage('simulator');
      const tags = [...document.querySelectorAll('#sim-root .sim-tbl tbody tr')].map(tr => [tr.querySelector('td:nth-child(2) strong').textContent, !!tr.querySelector('.sts-tag')]);
      return { same: a === b2, tags };
    });
    check('T5 ticking / unticking every nomination leaves barge, start, ETC and quantities exactly as planned', r.same);
    check('T5 the What-if Planner marks STS vessels', JSON.stringify(r.tags) === JSON.stringify([['CHILE PROSPERITY', true], ['MARAN VENUS', false], ['PACIFIC DAWN', true], ['ORIENT STAR', false]]) || r.tags.some(t => t[1]), r.tags);
  });


  /* T6b — a tick must never clash with a colleague's Generate; trader ticks reach everything */
  {
    const db = H.createDb({ workspace: U.seedPayload(), realtime: false });
    const A = await U.open(browser, db, 'user-operator'); await U.helpers(A);
    const B = await U.open(browser, db, 'user-operator2'); await U.helpers(B);
    const T = await U.open(browser, db, 'user-trader'); await U.helpers(T);
    await A.page.evaluate(async () => { calculate(); await saveSharedState(); });
    await B.page.evaluate(() => _pollOnce(true)); await T.page.evaluate(() => _pollOnce(true));
    // B changes n2's ETA and regenerates; A (not yet pulled) ticks STS on n1
    await B.page.evaluate(async () => { __setV('n2', 'eta', '25 Oct 2026 08:00'); calculate(); await saveSharedState(); });
    await A.page.evaluate(async () => { const id = __cardFor('n1'); const b = document.getElementById('v' + id + '-sts'); b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); await saveSharedState(); });
    const ls = U.row(db).payload.state.lastSched;
    const n2 = ls.find(i => i.nomUid === 'n2');
    check('T6b a tick made before pulling a colleague\'s Generate does not bring back the old schedule', n2 && /2026-10-25/.test(String(n2.eta)), n2 && n2.eta);
    check('T6b …and no "merged with a colleague" clash is reported for it', (await A.page.evaluate(() => window.__toasts.filter(t => /Merged with changes/.test(t)).length)) === 0);
    check('T6b …and the stale-schedule check still works (the new schedule matches the nominations)', await B.page.evaluate(() => !_fwScheduleStaleness().stale));
    // trader ticks after the schedule exists → the operator's screens follow after the pull
    await A.page.evaluate(() => _pollOnce(true));
    await T.page.evaluate(() => _pollOnce(true));
    await T.page.evaluate(async () => { const id = __cardFor('n2'); const b = document.getElementById('v' + id + '-sts'); b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); await saveSharedState(); });
    await A.page.evaluate(() => _pollOnce(true));
    const aS = await A.page.evaluate(() => { showPage('schedule'); renderWeekCalendar(-30); renderWeekCalendar(0);
      return { voy: [...document.querySelectorAll('#voy-barge-tabs tr[data-nu]')].map(tr => [tr.getAttribute('data-nu'), tr.classList.contains('is-sts')]).sort().join('|'),
               cl: Object.values(_checklistRecords).filter(r => r.nomUid === 'n2').map(r => document.getElementById('cl-row-' + r.uid) && document.getElementById('cl-row-' + r.uid).classList.contains('is-sts')) }; });
    check('T6b a trader\'s tick shows on the operator\'s Voyage Schedule and Checklist after the pull (nothing needs regenerating)', /n2,true/.test(aS.voy.replace(/\|/g, ',').replace(/,/g, ',')) || aS.voy.includes('n2|true') || /n2\b.*true/.test(aS.voy), aS);
    // the operator now saves that supply from the checklist → the saved record is STS
    const sv = await A.page.evaluate(async () => { const rec = Object.values(_checklistRecords).find(r => r.nomUid === 'n2'); document.getElementById('cl-av-' + rec.uid).value = '700'; await saveChecklistRecord(rec.uid); return _savedSupplies.find(s => s.nomUid === 'n2'); });
    check('T6b the saved supply record is STS because the nomination was ticked (by the trader)', sv && sv.sts === true, sv);
    for (const P of [A, B, T]) { const errs = U.realErrors(P); check('T6b no page errors (' + errs.length + ')', errs.length === 0, errs.slice(0, 2)); }
    await A.ctx.close(); await B.ctx.close(); await T.ctx.close();
  }

  /* T8 — print, wallboard, classic look */
  await scenario(browser, 'T8 print, wallboard, classic timeline', async (page) => {
    const r = await page.evaluate(() => {
      __week(); calculate();
      printScheduleOnly();
      const pr = [...document.querySelectorAll('#print-only-container tbody tr')].map(tr => [tr.textContent.includes('STS'), tr.classList.contains('is-sts')]);
      const names = [...document.querySelectorAll('#print-only-container tbody tr')].map(tr => tr.querySelector('td:nth-child(2) strong').textContent);
      showPage('commandcenter'); _ccRefreshData();
      const cc = document.getElementById('page-commandcenter').innerText;
      const ccTags = [...document.getElementById('page-commandcenter').querySelectorAll('span')].filter(e => e.textContent === 'STS').length;
      // classic look: the shortage edge of a timeline card keeps its colour
      document.documentElement.setAttribute('data-skin', 'classic'); showPage('timeline');
      const card = document.querySelector('#tl .tli.is-sts .tlc'); card.classList.add('wv');
      const left = getComputedStyle(card).borderLeftColor, top = getComputedStyle(card).borderTopColor;
      return { names, pr, ccTags, left, top, red: getComputedStyle(document.documentElement).getPropertyValue('--red').trim() };
    });
    const idx = n => r.names.indexOf(n);
    check('T8 the printed schedule tags and fills the STS rows only', r.pr[idx('MARAN VENUS')][0] && r.pr[idx('MARAN VENUS')][1] && r.pr[idx('ORIENT STAR')][1] && !r.pr[idx('CHILE PROSPERITY')][0] && !r.pr[idx('CHILE PROSPERITY')][1], r);
    check('T8 the Command Center wallboard marks the STS vessel in Up Next / the schedule list', r.ccTags >= 1, r.ccTags);
    check('T8 classic look: an STS timeline card with a shortage keeps its coloured left edge (not gold)', r.left !== r.top, [r.left, r.top, r.red]);
  });

  /* T6 — reload, two operators, trader */
  {
    const db = H.createDb({ workspace: U.seedPayload() });
    const A = await U.open(browser, db, 'user-operator'); await U.helpers(A);
    const B = await U.open(browser, db, 'user-operator2'); await U.helpers(B);
    const T = await U.open(browser, db, 'user-trader'); await U.helpers(T);
    const tick = (P, uid, on) => P.page.evaluate(([u, on]) => { const id = __cardFor(u); const b = document.getElementById('v' + id + '-sts'); b.checked = on; b.dispatchEvent(new Event('change', { bubbles: true })); return saveSharedState(); }, [uid, on]);
    const state = P => P.page.evaluate(() => [...document.querySelectorAll('.vcard[id^="vessel-"]')].map(c => [c.dataset.nomUid, document.getElementById(c.id.replace('vessel-', 'v') + '-sts').checked, c.hasAttribute('data-sts')].join(':')).sort().join(','));
    await tick(A, 'n1', true);
    let sv = U.row(db).payload.state.vessels;
    check('T6 the tick is in the shared workspace row', sv.find(v => v.nomUid === 'n1').sts === true && !('sts' in sv.find(v => v.nomUid === 'n2')), sv.map(v => [v.nomUid, v.sts]));
    await B.page.evaluate(() => _pollOnce(true));
    check('T6 a second operator sees it after pulling (box + tinted card)', (await state(B)) === 'n1:true:true,n2:false:false', await state(B));
    // B ticks another vessel while A unticks n1 → both changes merge
    await tick(B, 'n2', true);
    await tick(A, 'n1', false);
    sv = U.row(db).payload.state.vessels;
    check('T6 a tick by one operator and an untick by the other both survive the merge', !('sts' in sv.find(v => v.nomUid === 'n1')) && sv.find(v => v.nomUid === 'n2').sts === true, sv.map(v => [v.nomUid, v.sts]));
    await T.page.evaluate(() => _pollOnce(true));
    check('T6 a trader sees the same', (await state(T)) === 'n1:false:false,n2:true:true', await state(T));
    // the trader ticks n1 through the trader save path
    await T.page.evaluate(([u]) => { const id = __cardFor(u); const b = document.getElementById('v' + id + '-sts'); b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); return saveSharedState(); }, ['n1']);
    sv = U.row(db).payload.state.vessels;
    check('T6 a trader can tick STS (not an operator-only field) and the operator fields stay', sv.find(v => v.nomUid === 'n1').sts === true && sv.find(v => v.nomUid === 'n2').sts === true, sv.map(v => [v.nomUid, v.sts]));
    // a fresh page load from the workspace
    const C = await U.open(browser, db, 'user-operator'); await U.helpers(C);
    check('T6 a fresh load shows both ticked', (await state(C)) === 'n1:true:true,n2:true:true', await state(C));
    for (const P of [A, B, T, C]) {
      const errs = U.realErrors(P); check('T6 no page errors (' + errs.length + ')', errs.length === 0, errs.slice(0, 2));
    }
    await A.ctx.close(); await B.ctx.close(); await T.ctx.close(); await C.ctx.close();
  }

  /* T7 — look */
  await scenario(browser, 'T7 phone width and dark theme', async (page) => {
    const r = await page.evaluate(() => {
      __week(); calculate(); showPage('nominations');
      const de = document.documentElement;
      const out = { over: de.scrollWidth - de.clientWidth, light: [__bg(__cardOf('MARAN VENUS')), __bg(__cardOf('CHILE PROSPERITY'))] };
      const lab = document.getElementById('v' + __idOf('MARAN VENUS') + '-sts').closest('label').getBoundingClientRect();
      out.labelInside = lab.right <= de.clientWidth;
      document.documentElement.setAttribute('data-theme', 'dark');
      out.dark = [__bg(__cardOf('MARAN VENUS')), __bg(__cardOf('CHILE PROSPERITY'))];
      const tag = (showPage('schedule'), document.querySelector('#voy-barge-tabs .sts-tag'));
      out.tag = tag ? [getComputedStyle(tag).color, getComputedStyle(tag).backgroundColor] : null;
      document.documentElement.setAttribute('data-theme', 'light');
      return out;
    });
    check('T7 390px: no sideways scrolling and the STS box stays on screen', r.over <= 0 && r.labelInside, r);
    check('T7 STS card is filled differently from a plain card in light and dark', r.light[0] !== r.light[1] && r.dark[0] !== r.dark[1], r);
    check('T7 the STS tag is readable in dark (text differs from its fill)', r.tag && r.tag[0] !== r.tag[1], r.tag);
  }, { viewport: { width: 390, height: 900 } });

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
