/* Barge identity colours: each barge has one palette colour (violet, pink, slate, olive, brown), saved
   with the barge and synced; it marks tabs, timeline cards, fleet status, ROB cards, records and report
   rows, never the fuel or status colours. node barge-colours.test.js [appDir] */
const path = require('path');
const H = require(path.join(__dirname, '..', '..', 'harness', 'harness.js'));
const U = require(path.join(__dirname, '..', 'r3', 'util.js'));

let pass = 0, fail = 0;
function check(name, cond, info) {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 700)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const eta = h => { const d = new Date(Date.now() + h * 3600000); const p = n => String(n).padStart(2, '0'); return `${p(d.getDate())} ${MO[d.getMonth()]} ${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const V = (nomUid, name, type, qty, mgo, h, bargeId) => ({ nomUid, name, imo: '', area: 'FUJ-A', type, qty, mgo, spec: 'ISO 8217:2010', agent: 'GAC', manifold: 'VESSEL MANIFOLD', remarks: '', lc: '', paq: 'yes', bargeId, refuelChk: false, rfv: 0, rfm: 0, rfvr: 750, rfmr: 275, eta: eta(h) });
const BARGE = (id, name, extra) => Object.assign({ id, name, vcap: 5000, mcap: 1000, vrob: 3600, mrob: 640, vbuf: 500, mbuf: 150, vtph: 300, mtph: 100, vrfr: 750, mrfr: 275 }, extra || {});
const thisMonth = d => new Date(new Date().getFullYear(), new Date().getMonth(), Math.max(1, new Date().getDate() - d), 10, 0).toISOString();
const REC = (id, vessel, barge) => ({ id, checklistUid: id, nomUid: 'n_' + id, savedAt: '2026-10-05T00:00:00.000Z', vessel, areaCode: 'FUJ-A', area: 'FUJ A', dateStr: 'x', supplyDate: thisMonth(1), vlsfoAct: 100, mgoAct: 0, barge, supplied: true, bdnV: '', bdnM: '' });
function seedOf(barges, records) {
  const seed = U.seedPayload({ vessels: [V('n1', 'ALPHA', 'VLSFO', 300, 0, 6, '1'), V('n2', 'BRAVO', 'MGO', 0, 200, 9, '2')] });
  seed.state.barges = barges;
  seed.records = records || [];
  return seed;
}
async function open(browser, db, uid) {
  const a = await U.open(browser, db, uid || 'user-operator');
  await a.page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
  return a;
}
const colours = p => p.evaluate(() => captureCurrentState().barges.map(b => [b.name, b.color]));

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

  await scenario('C1 defaults, saved and synced', async (openT) => {
    const db = H.createDb({ workspace: seedOf([BARGE(1, 'FNSA 10'), BARGE(2, 'FNSA 11')]), realtime: false });
    const A = await openT(db);
    check('two barges without a colour get violet and pink, in order', JSON.stringify(await colours(A.page)) === JSON.stringify([['FNSA 10', 'violet'], ['FNSA 11', 'pink']]), await colours(A.page));
    await A.page.evaluate(() => saveSharedState()); await sleep(600);
    const cloud = U.row(db).payload.state.barges.map(b => [b.name, b.color]);
    check('…and the colours are saved with the barges', JSON.stringify(cloud) === JSON.stringify([['FNSA 10', 'violet'], ['FNSA 11', 'pink']]), cloud);
    const B = await openT(db, 'user-operator2');
    check('another device shows the same colours', JSON.stringify(await colours(B.page)) === JSON.stringify([['FNSA 10', 'violet'], ['FNSA 11', 'pink']]), await colours(B.page));
  });

  await scenario('C2 explicit colours kept, defaults avoid them', async (openT) => {
    const db = H.createDb({ workspace: seedOf([BARGE(1, 'FNSA 10'), BARGE(2, 'FNSA 11', { color: 'violet' }), BARGE(3, 'FNSA 12', { color: 'brown' })]), realtime: false });
    const A = await openT(db);
    check('a barge without a colour takes the first one the others do not use', JSON.stringify(await colours(A.page)) === JSON.stringify([['FNSA 10', 'pink'], ['FNSA 11', 'violet'], ['FNSA 12', 'brown']]), await colours(A.page));
  });

  await scenario('C3 picker changes every screen and syncs', async (openT) => {
    const db = H.createDb({ workspace: seedOf([BARGE(1, 'FNSA 10'), BARGE(2, 'FNSA 11')], [REC('r1', 'ALPHA', 'FNSA 10'), REC('r2', 'BRAVO', 'FNSA 11')]), realtime: false });
    const A = await openT(db);
    await A.page.evaluate(() => { calculate(); });
    await sleep(1200);
    const probe = () => A.page.evaluate(() => {
      showPage('timeline');
      const tabs = [...document.querySelectorAll('#tl .barge-tl-tab')].map(t => [t.textContent.trim(), t.getAttribute('style') || '']);
      const cards = [...document.querySelectorAll('#tl .tli[data-bc]')].map(c => c.getAttribute('style'));
      const chips = [...document.querySelectorAll('#tl .tb-bg')].map(c => [c.textContent.trim(), c.getAttribute('style')]);
      showPage('dashboard'); try { renderDashFleetStatus(); } catch (e) {}
      const fleet = [...document.querySelectorAll('#dash-fleet-status .fs-row')].map(r => [r.querySelector('.fs-name').textContent.trim(), r.getAttribute('style')]);
      showPage('records'); renderSavedRecords();
      const recs = [...document.querySelectorAll('#saved-records-list .saved-record-meta .bg-dot')].map(d => d.getAttribute('style'));
      openMonthlyReport();
      const rep = [...document.querySelectorAll('#monthly-preview .bg-dot, #monthly-modal .bg-dot')].map(d => d.getAttribute('style'));
      closeMonthlyReport();
      showPage('bargefleet'); renderLiveROBDashboard();
      const rob = [...document.querySelectorAll('#live-rob-dashboard .rob-card[data-bc]')].map(c => c.getAttribute('style').split(';')[0]);
      const cardsB = [...document.querySelectorAll('.barge-card')].map(c => [c.id, c.getAttribute('data-bc'), c.querySelector('.bg-sw.on') && c.querySelector('.bg-sw.on').getAttribute('data-k')]);
      return { tabs, cards, chips, fleet, recs, rep, rob, cardsB };
    });
    let r = await probe();
    const has = (arr, key, n) => arr.filter(x => (Array.isArray(x) ? x[x.length - 1] : x).indexOf(key) >= 0).length >= n;
    check('timeline tabs, cards and chips carry each barge\'s colour', has(r.tabs, '--barge-1', 1) && has(r.tabs, '--barge-2', 1) && r.cards.length >= 2 && has(r.chips, '--barge-1', 1) && has(r.chips, '--barge-2', 1), r);
    check('Barge Fleet Status rows, ROB cards, saved records and the report preview carry it too', has(r.fleet, '--barge-1', 1) && has(r.fleet, '--barge-2', 1) && has(r.rob, '--barge-1', 1) && has(r.rob, '--barge-2', 1) && has(r.recs, '--barge-1', 1) && has(r.recs, '--barge-2', 1) && r.rep.length >= 2, r);
    check('each barge card marks its own swatch', JSON.stringify(r.cardsB) === JSON.stringify([['barge-1', '1', 'violet'], ['barge-2', '1', 'pink']]), r.cardsB);
    await A.page.evaluate(() => setBargeColor(2, 'olive'));
    r = await probe();
    check('picking olive for FNSA 11 repaints every screen at once', has(r.tabs, '--barge-4', 1) && has(r.chips, '--barge-4', 1) && has(r.fleet, '--barge-4', 1) && has(r.rob, '--barge-4', 1) && has(r.recs, '--barge-4', 1) && !has(r.fleet, '--barge-2', 1) && !has(r.recs, '--barge-2', 1) && r.cardsB[1][2] === 'olive', r);
    await sleep(1500);
    check('…and saves it to the cloud', U.row(db).payload.state.barges[1].color === 'olive', U.row(db).payload.state.barges);
    const B = await openT(db, 'user-operator2');
    check('…and another device shows olive', JSON.stringify(await colours(B.page)) === JSON.stringify([['FNSA 10', 'violet'], ['FNSA 11', 'olive']]), await colours(B.page));
    await A.page.evaluate(() => setBargeColor(2, 'nonsense; background:url(x)'));
    check('an unknown colour name is refused', (await colours(A.page))[1][1] === 'olive');
  });

  await scenario('C4 a hostile colour value from a synced state never becomes CSS', async (openT) => {
    const db = H.createDb({ workspace: seedOf([BARGE(1, 'FNSA 10', { color: 'red;background:url(//evil.test/x)' }), BARGE(2, 'FNSA 11', { color: '"><img src=x onerror="window.__pwn=1">' }), BARGE(3, '<b>FNSA 12</b>', { color: 123 })], [REC('r1', 'ALPHA', '<b>FNSA 12</b>'), REC('r2', 'BRAVO', 'GHOST')]), realtime: false });
    const A = await openT(db);
    await A.page.evaluate(() => { calculate(); showPage('records'); renderSavedRecords(); showPage('dashboard'); renderDashFleetStatus(); });
    await sleep(1200);
    const r = await A.page.evaluate(() => ({ pwn: window.__pwn || 0, colours: captureCurrentState().barges.map(b => b.color), evil: document.documentElement.outerHTML.indexOf('evil.test') >= 0, imgs: document.querySelectorAll('img[src="x"]').length, names: [...document.querySelectorAll('#saved-records-list .saved-record-meta')].map(m => m.textContent.replace(/\s+/g, ' ')) }));
    check('bad values are replaced by palette colours; nothing is injected; an unknown barge gets no dot and no error', r.pwn === 0 && !r.evil && r.imgs === 0 && JSON.stringify(r.colours) === JSON.stringify(['violet', 'pink', 'slate']) && r.names.some(t => /<b>FNSA 12<\/b>/.test(t)) && r.names.some(t => /GHOST/.test(t)), r);
  });

  await scenario('C5 removing and adding barges', async (openT) => {
    const db = H.createDb({ workspace: seedOf([BARGE(1, 'FNSA 10'), BARGE(2, 'FNSA 11'), BARGE(3, 'FNSA 12')]), realtime: false });
    const A = await openT(db);
    await A.page.evaluate(() => rmBarge(1));
    check('removing a barge leaves the others\' colours alone', JSON.stringify(await colours(A.page)) === JSON.stringify([['FNSA 11', 'pink'], ['FNSA 12', 'slate']]), await colours(A.page));
    await A.page.evaluate(() => addBarge({ name: 'FNSA 13' }));
    check('a new barge takes the first free colour (violet)', JSON.stringify(await colours(A.page)) === JSON.stringify([['FNSA 11', 'pink'], ['FNSA 12', 'slate'], ['Barge 4', 'violet']]) || (await colours(A.page)).slice(-1)[0][1] === 'violet', await colours(A.page));
  });

  await scenario('C6 fuel and status colours stay as they were', async (openT) => {
    const db = H.createDb({ workspace: seedOf([BARGE(1, 'FNSA 10'), BARGE(2, 'FNSA 11')]), realtime: false });
    const A = await openT(db);
    await A.page.evaluate(() => { calculate(); showPage('timeline'); });
    await sleep(1200);
    const r = await A.page.evaluate(() => {
      const fills = [...document.querySelectorAll('#tl .rbf')].map(f => f.getAttribute('style'));
      const vals = [...document.querySelectorAll('#tl .rbv')].map(f => f.getAttribute('style'));
      const status = [...document.querySelectorAll('#tl .tb-on, #tl .tb-ok, #tl .tb-dl')].length;
      const root = getComputedStyle(document.documentElement);
      const light = ['--barge-1', '--barge-2', '--barge-3', '--barge-4', '--barge-5'].map(k => root.getPropertyValue(k).trim());
      document.documentElement.setAttribute('data-theme', 'dark');
      const dr = getComputedStyle(document.documentElement);
      const dark = ['--barge-1', '--barge-2', '--barge-3', '--barge-4', '--barge-5'].map(k => dr.getPropertyValue(k).trim());
      document.documentElement.removeAttribute('data-theme');
      return { fills, vals, status, light, dark };
    });
    check('volume bars and figures still use fuel or alert colours, never a barge colour; status badges remain', r.fills.length >= 2 && r.fills.every(f => !/--bc|--barge/.test(f)) && r.vals.every(f => !/--bc|--barge/.test(f)) && r.status >= 2, r);
    check('five distinct barge colours in the light theme, five lighter ones in the dark theme', new Set(r.light).size === 5 && new Set(r.dark).size === 5 && r.light.every((c, i) => c && c !== r.dark[i]), r);
  });

  await scenario('C7 a trader opens the app with coloured barges', async (openT) => {
    const db = H.createDb({ workspace: seedOf([BARGE(1, 'FNSA 10', { color: 'olive' }), BARGE(2, 'FNSA 11')]), realtime: false });
    const T = await openT(db, 'user-trader');
    await sleep(500);
    check('barges and colours load for a trader', (await colours(T.page)).length === 2, await colours(T.page));
  });

  /* 8 — a colleague's colour change reaches the screens already showing */
  await scenario('C8 a colleague\'s change repaints without navigating', async (openT) => {
    const db = H.createDb({ workspace: seedOf([BARGE(1, 'FNSA 10'), BARGE(2, 'FNSA 11')]), realtime: false });
    const A = await openT(db);
    const B = await openT(db, 'user-operator2');
    await B.page.evaluate(() => { calculate(); showPage('timeline'); });
    await sleep(1200);
    const seen = () => B.page.evaluate(() => ({ tabs: [...document.querySelectorAll('#tl .barge-tl-tab')].map(t => (t.getAttribute('style') || '').replace(/.*--barge-(\d).*/, '$1')), chips: [...document.querySelectorAll('#tl .tb-bg')].map(c => (c.getAttribute('style') || '').replace(/.*--barge-(\d).*/, '$1')) }));
    await A.page.evaluate(() => setBargeColor(2, 'olive'));
    await sleep(1500);
    await B.page.evaluate(() => { document.activeElement && document.activeElement.blur(); return _pollOnce(true); });
    await sleep(600);
    const r = await seen();
    check('B\'s timeline tabs and chips switch to olive (barge-4) at once, without leaving the page', r.tabs[1] === '4' && r.chips.every(c => c === '1' || c === '4') && r.chips.includes('4'), r);
  });

  /* 8b — the repaint touches nothing else on the page */
  await scenario('C8b a colleague\'s colour change does not disturb what is being typed or chosen', async (openT) => {
    const db = H.createDb({ workspace: seedOf([BARGE(1, 'FNSA 10'), BARGE(2, 'FNSA 11')]), realtime: false });
    const A = await openT(db);
    const B = await openT(db, 'user-operator2');
    await A.page.evaluate(() => { calculate(); });
    await sleep(1200);
    // A is on the Checklist, typing an actual that has not been committed (no change event yet)
    await A.page.evaluate(() => { showPage('checklist'); const el = document.getElementById('cl-av-n_n1'); el.focus(); el.value = '1234'; window.__row = el; });
    await B.page.evaluate(() => setBargeColor(2, 'olive'));
    await sleep(1500);
    await A.page.evaluate(() => { return _pollOnce(false); }); await sleep(700);
    const chk = await A.page.evaluate(() => { const el = document.getElementById('cl-av-n_n1'); return { same: el === window.__row, val: el && el.value, focused: document.activeElement === el, dot: [...document.querySelectorAll('#checklist-rows .bg-dot')].map(d => d.getAttribute('style')) }; });
    check('the half-typed value and focus survive, and the checklist dots take the new colour', chk.same && chk.val === '1234' && chk.focused && chk.dot.some(s => /--barge-4/.test(s)), chk);
    // A is on the Voyage Schedule with the second barge's tab open and one vessel unticked
    await A.page.evaluate(() => { showPage('schedule'); switchBargeTbl('2'); const c = document.querySelector('#voy-tab-1 .voy-print-chk, .voy-print-chk'); window.__chk = c; if (c) c.checked = false; });
    await B.page.evaluate(() => setBargeColor(2, 'brown'));
    await sleep(1500);
    await A.page.evaluate(() => _pollOnce(false)); await sleep(700);
    const v = await A.page.evaluate(() => ({ tab2: document.getElementById('voy-tab-2').style.display !== 'none', tab1hidden: document.getElementById('voy-tab-1').style.display === 'none', unticked: [...document.querySelectorAll('.voy-print-chk')].filter(c => !c.checked).length, same: document.querySelector('.voy-print-chk') === window.__chk, tabStyle: [...document.querySelectorAll('#voy-barge-tabs .barge-tl-tab')].map(t => t.getAttribute('style')) }));
    check('the Voyage Schedule keeps the chosen barge tab and the Print ticks, and the tab takes the new colour', v.tab2 && v.tab1hidden && v.unticked === 1 && v.same && /--barge-5/.test(v.tabStyle[1]), v);
  });

  /* 9 — an older build saves the barges without colours */
  await scenario('C9 an older build\'s save does not reset the colours picked here', async (openT) => {
    const db = H.createDb({ workspace: seedOf([BARGE(1, 'FNSA 10'), BARGE(2, 'FNSA 11'), BARGE(3, 'FNSA 12')]), realtime: false });
    const A = await openT(db);
    await A.page.evaluate(() => { setBargeColor(2, 'olive'); setBargeColor(3, 'brown'); });
    await sleep(1500);
    // what an older build writes: the same barges, no colour, a changed vessel
    const row = U.row(db);
    row.payload.state.barges.forEach(b => { delete b.color; });
    row.payload.state.vessels[0].agent = 'CHANGED BY OLD BUILD';
    row.version += 5000; row.payload.version = row.version; row.payload.state.version = row.version;
    await A.page.evaluate(() => { document.activeElement && document.activeElement.blur(); return _pollOnce(true); });
    await sleep(700);
    const r = await A.page.evaluate(() => ({ agent: (captureCurrentState().vessels[0] || {}).agent, colours: captureCurrentState().barges.map(b => b.color) }));
    check('the change from the older build arrived, and the picked colours stayed (violet, olive, brown)', r.agent === 'CHANGED BY OLD BUILD' && JSON.stringify(r.colours) === JSON.stringify(['violet', 'olive', 'brown']), r);
  });

  /* 10 — exports stay as they were */
  await scenario('C10 PDF and image exports carry no barge colours', async (openT) => {
    const db = H.createDb({ workspace: seedOf([BARGE(1, 'FNSA 10'), BARGE(2, 'FNSA 11')]), realtime: false });
    const A = await openT(db);
    await A.page.evaluate(() => { calculate(); showPage('schedule'); });
    await sleep(1200);
    const r = await A.page.evaluate(async () => {
      const out = {};
      const card = document.getElementById('voy-barge-tabs-card');
      out.liveDots = card.querySelectorAll('.bg-dot').length; out.liveTabs = card.querySelectorAll('.barge-tl-tab[data-bc]').length;
      window.alert = m => { out.alert = String(m); };
      // image: what html2canvas is handed
      _loadHtml2Canvas = async () => async (el) => { out.png = { dots: [...el.querySelectorAll('.bg-dot')].filter(d => d.style.display !== 'none').length, coloured: el.querySelectorAll('[data-bc]').length }; throw new Error('stop'); };
      await downloadVoyageSchedulePNG();
      out.afterPng = { dots: [...card.querySelectorAll('.bg-dot')].filter(d => d.style.display === 'none').length, coloured: card.querySelectorAll('[data-bc]').length };
      // PDF: the HTML put in the off-screen container
      _loadHtml2Canvas = async () => async (el) => { out.pdf = { dots: el.querySelectorAll('.bg-dot').length, coloured: el.querySelectorAll('[data-bc]').length }; throw new Error('stop'); };
      _loadJsPDF = async () => function() {};
      await downloadBargePDF(1, null);
      return out;
    });
    check('before: the screen shows coloured dots and tabs', r.liveDots > 0 && r.liveTabs > 0, r);
    check('the image is captured without them, and the screen gets them back afterwards', r.png && r.png.dots === 0 && r.png.coloured === 0 && r.afterPng.dots === 0 && r.afterPng.coloured === r.liveTabs, r);
    check('the PDF table has no barge dots', r.pdf && r.pdf.dots === 0 && r.pdf.coloured === 0, r);
  }, /stop|Could not/);

  /* 11 — the Dashboard's weekly calendar, the Loading page and loading cards say which barge */
  await scenario('C11 calendar and loading cards name and colour their barge', async (openT) => {
    const iso = h => new Date(Date.now() + h * 3600000).toISOString();
    const seed = seedOf([BARGE(1, 'FNSA 10'), BARGE(2, 'FNSA 11')]);
    seed.state.vessels = [V('n1', 'ALPHA', 'VLSFO', 300, 0, 3, '1'), V('n2', 'BRAVO', 'MGO', 0, 200, 4, '2')];
    seed.state.loadingRecords = [
      { id: 'l1', barge: 'FNSA 10', terminal: 'VOPAK TERMINAL', grade: 'VLSFO', qty: 3840, startAt: iso(1), endAt: iso(7), surveyor: 'INTERTEK', notes: '' },
      { id: 'l2', barge: 'FNSA 11', terminal: 'GPS CHEMOIL TERMINAL', grade: 'LSMGO', qty: 1000, startAt: iso(2), endAt: iso(8), surveyor: 'SAYBOLT', notes: '' },
      { id: 'l3', barge: '', terminal: 'FOTT (ECOMAR)', grade: 'LSMGO', qty: 900, startAt: iso(3), endAt: iso(9), surveyor: '', notes: '' },
    ];
    const db = H.createDb({ workspace: seed, realtime: false });
    const A = await openT(db);
    await A.page.evaluate(() => { calculate(); });
    await sleep(1200);
    const probe = () => A.page.evaluate(() => {
      showPage('dashboard'); try { refreshDashboard(); } catch (e) {}
      const txt = e => e.textContent.replace(/\s+/g, ' ').trim();
      const vessels = [...document.querySelectorAll('.cal-vcard')].map(c => [c.querySelector('.bg-pill') ? txt(c.querySelector('.bg-pill')) : null, c.getAttribute('style') || '']);
      const loads = [...document.querySelectorAll('.cal-ticket-loading')].map(c => [txt(c.querySelector('.bg-pill') || c), (c.querySelector('.bg-pill') || c).getAttribute('style') || '', txt(c).indexOf('VOPAK') >= 0 ? 'vopak' : txt(c).indexOf('GPS') >= 0 ? 'gps' : 'fott']);
      showPage('loading');
      const rows = [...document.querySelectorAll('#loading-list .bg-pill, #page-loading .card .bg-pill')].map(txt);
      showPage('timeline');
      const tlLoad = [...document.querySelectorAll('#tl .tlc .bg-pill')].map(txt);
      showPage('dashboard');
      const feed = [...document.querySelectorAll('#dash-activity-feed')].map(txt).join(' ');
      return { vessels, loads, rows, tlLoad, feed };
    });
    let r = await probe();
    check('weekly calendar: each vessel card has its barge pill and colour edge', r.vessels.length === 2 && r.vessels.every(v => /^FNSA 1[01]$/.test(v[0]) && /--barge-/.test(v[1])) && r.vessels.some(v => v[0] === 'FNSA 10' && /--barge-1/.test(v[1])) && r.vessels.some(v => v[0] === 'FNSA 11' && /--barge-2/.test(v[1])), r.vessels);
    check('weekly calendar: each loading card says which barge — and "No barge" when none is set', r.loads.length === 3 && r.loads.find(l => l[2] === 'vopak')[0] === 'FNSA 10' && r.loads.find(l => l[2] === 'gps')[0] === 'FNSA 11' && r.loads.find(l => l[2] === 'fott')[0] === 'No barge' && /--barge-2/.test(r.loads.find(l => l[2] === 'gps')[1]), r.loads);
    check('Loading page rows, the loading entries on the Supply Timeline and the dashboard activity feed name the barge too', ['FNSA 10', 'FNSA 11', 'No barge'].every(n => r.rows.includes(n)) && r.tlLoad.some(t => /FNSA 1[01]/.test(t)) && /VOPAK TERMINAL[^|]*FNSA 10/.test(r.feed) && /GPS CHEMOIL TERMINAL[^|]*FNSA 11/.test(r.feed), r);
    await A.page.evaluate(() => setBargeColor(2, 'olive'));
    r = await probe();
    check('picking olive recolours the calendar cards in place', r.vessels.find(v => v[0] === 'FNSA 11')[1].indexOf('--barge-4') >= 0 && r.loads.find(l => l[2] === 'gps')[1].indexOf('--barge-4') >= 0, r);
  });

  /* 12 — a single-barge fleet, before the schedule has been generated */
  await scenario('C12 a loading with no barge on a one-barge fleet names that barge straight away', async (openT) => {
    const iso = h => new Date(Date.now() + h * 3600000).toISOString();
    const seed = seedOf([BARGE(1, 'FNSA 10')]);
    seed.state.loadingRecords = [{ id: 'l1', barge: '', terminal: 'VOPAK TERMINAL', grade: 'VLSFO', qty: 3840, startAt: iso(1), endAt: iso(7), surveyor: '', notes: '' }];
    const db = H.createDb({ workspace: seed, realtime: false });
    const A = await openT(db);
    await sleep(800);
    const r = await A.page.evaluate(() => {
      const out = { cfg: (_bargeConfig || []).length };
      showPage('dashboard'); try { refreshDashboard(); } catch (e) {}
      out.cal = [...document.querySelectorAll('.cal-ticket-loading .bg-pill')].map(e => e.textContent.replace(/\s+/g, ' ').trim());
      out.fleet = [...document.querySelectorAll('#dash-fleet-status .fs-name')].map(e => e.textContent.trim());
      out.feed = document.getElementById('dash-activity-feed').textContent.replace(/\s+/g, ' ');
      showPage('loading');
      out.row = [...document.querySelectorAll('#page-loading .card .bg-pill')].map(e => e.textContent.trim());
      out.select = [...document.querySelectorAll('#ld-barge option')].map(o => o.value);
      return out;
    });
    check('before Generate: the calendar card, fleet row, Loading row and form all say FNSA 10 (not "No barge" / "Unassigned")', r.cfg === 0 && r.cal[0] === 'FNSA 10' && r.fleet[0] === 'FNSA 10' && r.row[0] === 'FNSA 10' && r.select[0] === 'FNSA 10' && /FNSA 10/.test(r.feed) && !/Unassigned/.test(r.feed), r);
  });

  await browser.close();
  console.log('BARGE-COLOURS: ' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
