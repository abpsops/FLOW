/* "Last known position" — a position report pasted from the ship's public page
   (MyShipTracking / VesselFinder / MarineTraffic), a noon report or an agent's
   message, stored on the nomination as vessel.posRpt.
   node report.test.js [appDir] [only] [shotDir]   (or $SHOTS_DIR for screenshots) */
const fs = require('fs');
const path = require('path');
const H = require(path.join(__dirname, '..', '..', 'harness', 'harness.js'));
const U = require(path.join(__dirname, '..', 'r3', 'util.js'));
const appDir = process.argv[2] || H.APP_DIR;
const only = process.argv[3] || '';
const SHOTS = process.argv[4] || process.env.SHOTS_DIR || '';

let pass = 0, fail = 0;
function check(name, cond, info) {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 900)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HR = 3600000, MIN = 60000;
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = n => String(n).padStart(2, '0');
// "16 Oct 2026 08:00" in Asia/Dubai (UTC+4) — the app's ETA format (the harness runs the page in Dubai time)
function dubai(ms) { const d = new Date(ms + 4 * HR); return p2(d.getUTCDate()) + ' ' + MO[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ' ' + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()); }
// "2026-10-15 20:28" in UTC (MyShipTracking's format)
function utcTxt(ms) { const d = new Date(ms); return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()) + ' ' + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()); }
const iso = ms => new Date(ms).toISOString();
const clone = x => JSON.parse(JSON.stringify(x));

function vessel(o) {
  return Object.assign({ nomUid: '', name: '', imo: '', area: 'FUJ-A', type: 'VLSFO', qty: 500, mgo: 0, spec: 'ISO 8217:2010', agent: '', manifold: 'VESSEL MANIFOLD', remarks: '', lc: '', eta: '', paq: 'yes', bargeId: '', refuelChk: false, rfv: 0, rfm: 0, rfvr: 750, rfmr: 275 }, o);
}
function scene(now) {
  return [
    vessel({ nomUid: 'n1', name: 'SEA VALIANT', imo: '9420629', mmsi: '538009850', area: 'FUJ-A', eta: dubai(now + 60 * HR), lc: dubai(now - 24 * HR).slice(0, 11) + ' - ' + dubai(now + 120 * HR).slice(0, 11) }),
    vessel({ nomUid: 'n2', name: 'CMA CGM DAKAR', imo: '9448827', mmsi: '248222000', area: 'FUJ-A', eta: dubai(now + 20 * HR) }),
    vessel({ nomUid: 'n3', name: 'SEA VALIANT', imo: '9420629', area: 'KFK-A', eta: dubai(now + 70 * HR), type: 'MGO', qty: 0, mgo: 100 }),
    vessel({ nomUid: 'n4', name: 'OCEAN PEARL', imo: '9873022', area: 'FUJ-A', eta: dubai(now + 5 * HR) }),
    vessel({ nomUid: 'n5', name: 'REIMEI', imo: '', area: 'FUJ-A', eta: dubai(now + 30 * HR) }),
  ];
}
function aisData(now) {
  return {
    positions: [{ mmsi: '636012345', imo: '9873022', name: 'OCEAN PEARL', lat: 25.0, lon: 56.9, sog: 10, cog: 290, heading: 290, nav_status: 0, destination: 'FUJAIRAH', ais_eta: null, matched_by: 'imo', position_time: iso(now - 8 * MIN), updated_at: iso(now - 5 * MIN) }],
    status: { last_run_at: iso(now - 2 * MIN), last_ok_at: iso(now - 2 * MIN), last_cron_at: iso(now - 2 * MIN), running_since: null, ok: true, tracked: 5, found: 1, messages: 900, error: null, duration_ms: 90000 },
  };
}
// The page texts (as copied with Ctrl+A / Ctrl+C), relative to `now`.
function mstPage(now, o) {
  o = o || {};
  return `MyShipTracking   Vessels   Ports
SEA VALIANT
The current position of ${o.name || 'SEA VALIANT'} is in Arabian Sea with coordinates ${o.lat || '19.27129'}° / ${o.lon || '65.06209'}° as reported on ${utcTxt(o.at || now - 2 * HR)} by AIS to our vessel tracker app. The vessel's current speed is ${o.sog || '11.5'} Knots and is heading at the port of ${o.dest || 'FUJAIRAH'}.
The vessel ${o.name || 'SEA VALIANT'} (IMO: ${o.imo || '9420629'}, MMSI: ${o.mmsi || '538009850'}) is a Bulk Carrier that was built in 2010 ( 16 years old ). It's sailing under the flag of [MH] Marshall Islands.
Vessel Info
Status\tActive
Current Trip
SOHAR
OMSOH
ATD
2026-10-12
07:20 (UTC)
FUJAIRAH
AEFJR
ETA*
${utcTxt(o.eta || now + 50 * HR).replace(' ', '\n')} (UTC)
Current Position
Longitude\t---
Latitude\t---
Status\tUnder way using engine
Speed\t11.5 Knots
Course\t302°
Area\tArabian Sea
Station\tT-AIS
Position Received\t2 h ago
Events
2026-10-12 08:01
Status Changed
At anchor
Under way using engine`;
}
const VF_TEXT = `VesselFinder  Vessels  Ports
The current position of CMA CGM DAKAR is at Gulf of Oman reported 3 hours ago by AIS. The vessel is en route to the port of Fujairah, United Arab Emirates (UAE), sailing at a speed of 0.4 knots and expected to arrive there on Oct 17, 08:00.
The vessel CMA CGM DAKAR (IMO 9448827, MMSI 248222000) is a Container Ship built in 2009 (17 years old) and currently sailing under the flag of Malta.
Navigation Status  Under way using engine    Position received  3 hours ago`;

const TOAST_LOG = () => {
  window.__toastLog = [];
  document.addEventListener('DOMContentLoaded', () => {
    const st = document.getElementById('toast-stack');
    if (st) new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
      const t = n.querySelector && n.querySelector('.toast-msg');
      if (t) window.__toastLog.push({ m: t.textContent, type: (n.className.match(/toast-(\w+)/) || [])[1] });
    }))).observe(st, { childList: true });
  });
};
const PAGE_HELPERS = () => {
  window.__cid = nomUid => { const c = [...document.querySelectorAll('.vcard[id^="vessel-"]')].find(x => x.dataset.nomUid === nomUid); return c ? c.id.replace('vessel-', '') : null; };
  window.__panel = nomUid => document.getElementById('v' + __cid(nomUid) + '-prpt');
  window.__dlg = k => document.querySelector('.prd-ov [data-prd="' + k + '"]');
  window.__paste = async text => { const t = __dlg('text'); t.value = text; t.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 250)); };
  window.__setF = (k, val) => { const el = __dlg(k); el.value = val; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
  window.__toasts = () => (window.__toastLog || []).map(t => t.m);
  window.__cells = nomUid => { const o = {}; (__panel(nomUid) ? __panel(nomUid).querySelectorAll('.prpt-cell') : []).forEach(c => { o[c.querySelector('.prpt-k').textContent] = c.querySelector('.prpt-v').textContent.replace(/\s+/g, ' ').trim(); }); return o; };
};
async function open(browser, db, uid, extra) {
  const app = await H.openApp(browser, db, Object.assign({ appDir, uid: uid || 'user-operator', beforeLoad: async (ctx, page) => { await page.addInitScript(TOAST_LOG); } }, extra || {}));
  await app.page.evaluate(PAGE_HELPERS);
  await app.page.waitForFunction(() => typeof _ais !== 'undefined' && (_ais.state === 'ready' || _ais.state === 'missing' || _ais.state === 'error' || _ais.state === 'idle') && !_ais.loading, null, { timeout: 15000 });
  return app;
}
function realErrors(app) { return app.errors.filter(e => !/capacitorExports/.test(e)); }
async function scenario(browser, name, fn) {
  if (only && !name.includes(only)) return;
  console.log('— ' + name);
  const apps = [];
  const openT = async (db, uid, extra) => { const a = await open(browser, db, uid, extra); apps.push(a); return a; };
  try { await fn(openT); } catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 5).join(' | ')); }
  const errs = [].concat(...apps.map(realErrors));
  check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
  for (const a of apps) await a.ctx.close();
}
const shot = async (locOrPage, file) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await locOrPage.screenshot({ path: path.join(SHOTS, file) }); };
const vOf = (db, nomUid) => U.row(db).payload.state.vessels.find(v => v.nomUid === nomUid);
async function scrollTo(page, sel, off) {
  await page.evaluate(([s, o]) => { document.querySelectorAll('#toast-stack .toast').forEach(t => t.remove()); const el = document.querySelector(s); const hb = document.getElementById('topbar'); window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - (hb ? hb.getBoundingClientRect().bottom : 0) - (o || 8), behavior: 'instant' }); }, [sel, off]);
  await sleep(250);
}

(async () => {
  const browser = await H.launch();

  /* 1 — the parser (pure) */
  await scenario(browser, 'R1 parser', async (openT) => {
    const db = H.createDb({ workspace: U.seedPayload({ vessels: [] }) });
    const { page } = await openT(db, 'user-operator');
    const now = Date.parse('2026-10-16T08:00:00Z');
    const r = await page.evaluate(([now, mst]) => {
      const P = t => { const p = _prParse(t, now); return Object.assign({}, p, { eta: p.eta == null ? null : new Date(p.eta).toISOString(), at: p.at == null ? null : new Date(p.at).toISOString(), arrAt: p.arrAt == null ? null : new Date(p.arrAt).toISOString() }); };
      return {
        mst: P(mst),
        mstProse: P('The current position of EAGLE HALIFAX is in Gulf of Mexico with coordinates 29.35138° / -94.78444° as reported on 2026-10-15 20:28 by AIS to our vessel tracker app. The vessel\'s current speed is 12.6 Knots and is heading at the port of HOUSTON.'),
        vfA: P('The current position of EPOS is at Arabian Sea reported 6 days ago by AIS. The vessel is en route to the port of Fujairah, United Arab Emirates (UAE), sailing at a speed of 12.1 knots and expected to arrive there on Oct 10, 21:30.\nThe vessel EPOS (IMO 9687588, MMSI 636092814) is a Crude Oil Tanker built in 2015'),
        vfArr: P('The current position of X is at Gulf of Oman reported 3 hours ago by AIS. The vessel arrived at the port of Khor al Fakkan Anch., United Arab Emirates (UAE) on Sep 10, 19:32 UTC.\nNavigation Status  Moored    Position received  6 hours ago'),
        vfTable: P('Predicted ETA  -    Distance / Time  -    Course / Speed  67.7° / 0.4 kn    Current draught  11.5 m\nNavigation Status  Moored    Position received  6 hours ago\nDestination  Los Angeles, United States (USA)   ATA: Apr 12, 14:29 UTC   |   ETA: Apr 9, 23:00   |   ATD: Jun 7, 21:44 UTC\nVesselFinder'),
        mt: P('MarineTraffic SEA VALIANT\nNavigational Status: Under way using engine\nSpeed/Course: 11.5 kn / 213°\nLatitude / Longitude: 19.27129° / 65.06209°\nPosition Received: 2 hours ago\nDestination: FUJAIRAH\nReported ETA: 2026-10-18 23:00 (UTC)'),
        noon: P('Noon report 16/10: Pos 19-16.3N 065-03.7E, course 300, speed 11.5 kts, ETA Fujairah 18th Oct 2300 UTC, ROB fine'),
        noon2: P('MV SEA VALIANT noon position LAT 19°16\'N LONG 065°03\'E avg spd 11.2 kn ETA FUJ 18/2300 UTC'),
        agent: P('Vessel anchored at Fujairah OPL since 15th Oct 0800 hrs, position 25 10.2N 056 27.6E'),
        nothing: P('hello world, nothing here'),
        empty: P(''),
        future: P('The current position of X is in Arabian Sea with coordinates 19.1° / 65.1° as reported on 2026-10-20 10:00 by AIS'),
        coords: [_prCoord1("19°16.3'N", 'lat'), _prCoord1('065-03.7E', 'lon'), _prCoord1('1916N', 'lat'), _prCoord1('06503E', 'lon'), _prCoord1('-19.27', 'lat'), _prCoord1('19.27 E', 'lat'), _prCoord1('91', 'lat'), _prCoord1('19 61N', 'lat'), _prCoord1("19°16'12\"S", 'lat'), _prCoord1('S 19.5', 'lat')],
      };
    }, [now, mstPage(now, { eta: Date.parse('2026-10-18T10:00:00Z'), at: Date.parse('2026-10-16T06:00:00Z') })]);
    const m = r.mst;
    check('R1 MyShipTracking page: source, ship, exact position, area, status, speed, course, destination, ETA (UTC), reported (UTC)',
      m.src === 'mst' && m.name === 'SEA VALIANT' && m.imo === '9420629' && m.mmsi === '538009850' && m.lat === 19.27129 && m.lon === 65.06209 && m.area === 'Arabian Sea' &&
      m.nav === 'Under way' && m.sog === 11.5 && m.cog === 302 && m.dest === 'FUJAIRAH' && m.eta === '2026-10-18T10:00:00.000Z' && m.at === '2026-10-16T06:00:00.000Z' && m.atApprox === false, m);
    check('R1 …"Status Active" (registry) and the event list ("Status Changed / At anchor") are not taken as the AIS status', m.nav === 'Under way', m.nav);
    check('R1 MyShipTracking prose alone (negative longitude)', r.mstProse.lat === 29.35138 && r.mstProse.lon === -94.78444 && r.mstProse.dest === 'HOUSTON' && r.mstProse.sog === 12.6 && r.mstProse.at === '2026-10-15T20:28:00.000Z', r.mstProse);
    check('R1 VesselFinder prose: sea area only (no coordinates on the free page), destination without the country, ETA year inferred, "6 days ago" → approximate time',
      r.vfA.src === 'vf' && r.vfA.lat === null && r.vfA.area === 'Arabian Sea' && r.vfA.dest === 'Fujairah' && r.vfA.sog === 12.1 && r.vfA.eta === '2026-10-10T21:30:00.000Z' &&
      r.vfA.at === '2026-10-10T08:00:00.000Z' && r.vfA.atApprox === true && r.vfA.imo === '9687588' && r.vfA.mmsi === '636092814', r.vfA);
    check('R1 VesselFinder "arrived at the port of …" + table status / "Position received 6 hours ago"',
      r.vfArr.arr === 'Khor al Fakkan Anch.' && r.vfArr.arrAt === '2026-09-10T19:32:00.000Z' && r.vfArr.nav === 'Moored' && r.vfArr.atApprox && r.vfArr.at === '2026-10-16T05:00:00.000Z', r.vfArr);
    check('R1 VesselFinder table: Course / Speed, Destination label, ETA label', r.vfTable.cog === 67.7 && r.vfTable.sog === 0.4 && r.vfTable.dest === 'Los Angeles' && r.vfTable.nav === 'Moored' && r.vfTable.eta != null, r.vfTable);
    check('R1 MarineTraffic-style labels: status, speed/course, lat/lon, destination, reported ETA',
      r.mt.src === 'mt' && r.mt.nav === 'Under way' && r.mt.sog === 11.5 && r.mt.cog === 213 && r.mt.lat === 19.27129 && r.mt.lon === 65.06209 && r.mt.dest === 'FUJAIRAH' && r.mt.eta === '2026-10-18T23:00:00.000Z' && r.mt.atApprox, r.mt);
    check('R1 noon reports: degrees-minutes positions, speed, "ETA Fujairah 18th Oct 2300 UTC" / "ETA FUJ 18/2300 UTC"',
      r.noon.src === 'report' && r.noon.lat === 19.27167 && r.noon.lon === 65.06167 && r.noon.sog === 11.5 && r.noon.dest === 'Fujairah' && r.noon.eta === '2026-10-18T23:00:00.000Z' && r.noon.at === null &&
      r.noon2.lat === 19.26667 && r.noon2.lon === 65.05 && r.noon2.sog === 11.2 && r.noon2.dest === 'FUJ' && r.noon2.eta === '2026-10-18T23:00:00.000Z', [r.noon, r.noon2]);
    check('R1 agent message: "anchored" + "25 10.2N 056 27.6E"; area named from the position', r.agent.nav === 'At anchor' && r.agent.lat === 25.17 && r.agent.lon === 56.46 && r.agent.area === 'off Fujairah / Khor Fakkan', r.agent);
    check('R1 nothing recognised → empty result (never throws)', r.nothing.found.length === 0 && r.nothing.lat === null && r.empty.found.length === 0, [r.nothing, r.empty]);
    check('R1 a report time in the future is not trusted', r.future.at === null && r.future.lat === 19.1, r.future);
    check('R1 coordinates: DM / DDMM / signed / wrong axis / out of range / 61 minutes / DMS south / "S 19.5"',
      JSON.stringify(r.coords) === JSON.stringify([19.27167, 65.06167, 19.26667, 65.05, -19.27, null, null, null, -19.27, -19.5]), r.coords);
  });

  /* 2 — the card: prompt, dialog, paste, save, the same ship's other card, payload */
  await scenario(browser, 'R2 card + dialog', async (openT) => {
    const now = Date.now();
    const seed = U.seedPayload({ vessels: scene(now) });
    const db = H.createDb({ workspace: seed, ais: aisData(now), realtime: false });
    const before = clone(seed.state.vessels);
    const { page } = await openT(db, 'user-operator');
    await page.evaluate(() => { try { flowWelcomeGo('nominations'); } catch (e) {} showPage('nominations'); });
    await sleep(300);
    const p0 = await page.evaluate(() => ['n1', 'n2', 'n3', 'n4', 'n5'].map(n => ({ n, show: __panel(n).classList.contains('show'), txt: __panel(n).textContent.replace(/\s+/g, ' ').trim() })));
    check('R2 no report yet: a one-line "Last known position — not added yet" prompt on cards AIS has not seen',
      ['n1', 'n2', 'n3', 'n5'].every(n => { const x = p0.find(y => y.n === n); return x.show && /Last known position\s*not added yet\s*\+ Add from MyShipTracking \/ VesselFinder/.test(x.txt); }), p0);
    check('R2 …but none on a card with a fresh live AIS position (OCEAN PEARL)', !p0.find(x => x.n === 'n4').show, p0.find(x => x.n === 'n4'));
    await page.evaluate(() => __panel('n1').querySelector('.prpt-btn').click());
    await sleep(150);
    const d0 = await page.evaluate(() => ({
      title: document.getElementById('prd-title').textContent,
      links: [...document.querySelectorAll('.prd-ov [data-prd-link]')].map(a => a.getAttribute('data-prd-link') + '=' + a.href + '|' + a.target + '|' + a.rel),
      focus: document.activeElement === __dlg('text'), modal: document.querySelector('.prd').getAttribute('aria-modal'), remove: !!__dlg('remove'),
    }));
    check('R2 dialog: title, links to the ship\'s pages (MyShipTracking by MMSI+IMO, VesselFinder by IMO, MarineTraffic by MMSI) in a new tab, focus in the paste box',
      d0.title === 'Last known position — SEA VALIANT' && d0.focus && d0.modal === 'true' && !d0.remove &&
      d0.links.join(',') === 'mst=https://www.myshiptracking.com/vessels/mmsi-538009850-imo-9420629|_blank|noopener,vf=https://www.vesselfinder.com/vessels/details/9420629|_blank|noopener,mt=https://www.marinetraffic.com/en/ais/details/ships/mmsi:538009850|_blank|noopener', d0);
    const atMs = Math.floor((now - 2 * HR) / MIN) * MIN, etaMs = Math.floor((now + 50 * HR) / MIN) * MIN;
    await page.evaluate(t => __paste(t), mstPage(now, { at: atMs, eta: etaMs }));
    const d1 = await page.evaluate(() => ({
      found: __dlg('found').textContent, warn: __dlg('warn').hidden,
      f: ['lat', 'lon', 'area', 'nav', 'sog', 'cog', 'dest', 'eta', 'at', 'src'].map(k => __dlg(k).value), calc: __dlg('calc').textContent,
    }));
    check('R2 paste: "Found position, status, speed, heading to, ETA, reported time — from MyShipTracking", no wrong-ship warning',
      /^Found position, status, speed, heading to, ETA, reported time — from MyShipTracking\.$/.test(d1.found) && d1.warn, d1);
    check('R2 …fields filled for checking (local times)', JSON.stringify(d1.f) === JSON.stringify(['19.27129 N', '65.06209 E', 'Arabian Sea', 'Under way', '11.5', '302', 'FUJAIRAH', await page.evaluate(t => _prFmtLocal(t), etaMs), await page.evaluate(t => _prFmtLocal(t), atMs), 'mst']), d1.f);
    check('R2 …preview of distance left and expected arrival', /^→ [\d,]+ nm left to FUJ A · expected arrival ~\d+ \w{3} \d\d:\d\d at 11\.5 kn/.test(d1.calc), d1.calc);
    if (SHOTS) await shot(page.locator('.prd'), 'report-dialog.png');
    const w0 = U.writes(db, 'user-operator').length;
    await page.evaluate(() => __dlg('save').click());
    await sleep(900);
    const c1 = await page.evaluate(() => ({ open: !!document.querySelector('.prd-ov'), cells: __cells('n1'), hd: __panel('n1').querySelector('.prpt-hd').textContent.replace(/\s+/g, ' ').trim(), n3: __cells('n3'), toasts: __toasts(), focusBtn: document.activeElement && document.activeElement.classList.contains('prpt-btn') }));
    check('R2 saved: dialog closed, card shows the table: Last position, Status / speed, Heading to, ETA, Reported, Distance left, Expected arrival',
      !c1.open && /^📍 Arabian Sea · 19\.27°N 65\.06°E$/.test(c1.cells['Last position']) && c1.cells['Status / speed'] === 'Under way · 11.5 kn' && c1.cells['Heading to'] === 'FUJAIRAH' &&
      /^\d+ \w{3} \d\d:\d\d$/.test(c1.cells['ETA']) && /^\d+ \w{3} \d\d:\d\d · 2 h ago$/.test(c1.cells['Reported']) && /^[\d,]+ nm to FUJ A$/.test(c1.cells['Distance left']) && /^~\d+ \w{3} \d\d:\d\d at 11\.5 kn$/.test(c1.cells['Expected arrival']), c1);
    check('R2 header: label, status chip (Underway — far from the port), source, Update', /^Last known position\s*Underway\s*from MyShipTracking\s*Update$/.test(c1.hd), c1.hd);
    const distN1 = parseFloat(c1.cells['Distance left'].replace(/,/g, ''));
    check('R2 distance 19.27N 65.06E → FUJ A ≈ 600 nm (great circle)', distN1 > 580 && distN1 < 620, distN1);
    check('R2 the other nomination of the same ship (same IMO) got the same report — distance to ITS anchorage (KFK A)', /^[\d,]+ nm to KFK A$/.test(c1.n3['Distance left'] || '') && c1.n3['Heading to'] === 'FUJAIRAH', c1.n3);
    check('R2 toast says so', c1.toasts.some(t => /^Last known position saved \(also on 1 other nomination for the same ship\)\.$/.test(t)), c1.toasts);
    const v1 = vOf(db, 'n1'), v3 = vOf(db, 'n3');
    check('R2 one save; vessel.posRpt stored with only the set fields, ISO times and an updatedAt stamp',
      U.writes(db, 'user-operator').length === w0 + 1 && v1.posRpt && v1.posRpt.src === 'mst' && v1.posRpt.lat === 19.27129 && v1.posRpt.lon === 65.06209 && v1.posRpt.nav === 'Under way' && v1.posRpt.sog === 11.5 && v1.posRpt.cog === 302 &&
      v1.posRpt.dest === 'FUJAIRAH' && v1.posRpt.eta === iso(etaMs) && v1.posRpt.at === iso(atMs) && !('atApprox' in v1.posRpt) && typeof v1.posRpt.updatedAt === 'number' && v1.posRpt.by === 'user-operator@test' && JSON.stringify(v3.posRpt) === JSON.stringify(v1.posRpt), v1.posRpt);
    const others = ['n2', 'n4', 'n5'].map(n => vOf(db, n));
    check('R2 vessels without a report: no posRpt key, otherwise byte-identical', others.every((v, i) => !('posRpt' in v) && JSON.stringify(v) === JSON.stringify(before.find(b => b.nomUid === ['n2', 'n4', 'n5'][i]))), others);
    if (SHOTS) { await scrollTo(page, '#vessel-' + await page.evaluate(() => __cid('n1'))); await shot(page.locator('#vessel-' + await page.evaluate(() => __cid('n1'))), 'report-card-harbour.png'); }

    // Wrong ship pasted: warning, but may still save
    await page.evaluate(() => __panel('n2').querySelector('.prpt-btn').click());
    await sleep(100);
    await page.evaluate(t => __paste(t), mstPage(now, { name: 'SOME OTHER', imo: '9111111', mmsi: '311000111' }));
    const wr = await page.evaluate(() => ({ hidden: __dlg('warn').hidden, txt: __dlg('warn').textContent }));
    check('R2 a page for another ship → "This page is for IMO 9111111 — the nomination has IMO 9448827 … MMSI …"', !wr.hidden && /IMO 9111111 — the nomination has IMO 9448827/.test(wr.txt) && /MMSI 311000111 — the nomination has MMSI 248222000/.test(wr.txt), wr);
    // VesselFinder instead: no coordinates → sea area only, no distance
    await page.evaluate(t => __paste(t), VF_TEXT);
    const vf = await page.evaluate(() => ({ found: __dlg('found').textContent, hidden: __dlg('warn').hidden, lat: __dlg('lat').value, area: __dlg('area').value, at: __dlg('at').value, note: __dlg('atnote').hidden, calc: __dlg('calc').textContent, src: __dlg('src').value }));
    check('R2 VesselFinder paste: sea area, approximate time note, "no exact position" hint, no distance', /No exact position on this page/.test(vf.found) && vf.hidden && vf.lat === '' && vf.area === 'Gulf of Oman' && vf.at !== '' && !vf.note && vf.src === 'vf' && /Add the position/.test(vf.calc), vf);
    await page.evaluate(() => __dlg('save').click());
    await sleep(600);
    const c2 = await page.evaluate(() => ({ cells: __cells('n2'), n1same: __cells('n1')['Heading to'] }));
    check('R2 VesselFinder report on the card: "📍 Gulf of Oman (no exact position)", "Under way · 0.4 kn", "Fujairah", ETA, "~… · 3 h ago", no distance',
      c2.cells['Last position'] === '📍 Gulf of Oman (no exact position)' && c2.cells['Status / speed'] === 'Under way · 0.4 kn' && c2.cells['Heading to'] === 'Fujairah' && /^~\d+ \w{3} \d\d:\d\d · 3 h ago$/.test(c2.cells['Reported']) && !('Distance left' in c2.cells) && c2.n1same === 'FUJAIRAH', c2);
    check('R2 approximate time stored as such', vOf(db, 'n2').posRpt.atApprox === true && vOf(db, 'n2').posRpt.src === 'vf' && !('lat' in vOf(db, 'n2').posRpt), vOf(db, 'n2').posRpt);

    // Typed by hand + validation
    await page.evaluate(() => __panel('n5').querySelector('.prpt-btn').click());
    await sleep(100);
    const d5 = await page.evaluate(() => ({ links: [...document.querySelectorAll('.prd-ov [data-prd-link]')].map(a => a.getAttribute('data-prd-link') + '=' + a.href), hint: document.querySelector('.prd-ov .prd-hint').textContent }));
    check('R2 name-only nomination: VesselFinder search link only, no MyShipTracking (needs the MMSI)', d5.links.join(',') === 'vf=https://www.vesselfinder.com/vessels?name=REIMEI' && /Add the MMSI on the card/.test(d5.hint), d5);
    await page.evaluate(() => __dlg('save').click());
    const e1 = await page.evaluate(() => __dlg('err').textContent);
    await page.evaluate(() => { __setF('lat', '24 21.5N'); __setF('lon', 'east'); __dlg('save').click(); });
    const e2 = await page.evaluate(() => __dlg('err').textContent);
    await page.evaluate(() => { __setF('lon', '056 41E'); __setF('sog', '55'); __dlg('save').click(); });
    const e3 = await page.evaluate(() => __dlg('err').textContent);
    await page.evaluate(() => { __setF('sog', '0.2'); __setF('nav', 'At anchor'); __setF('at', 'yesterday'); __dlg('save').click(); });
    const e4 = await page.evaluate(() => __dlg('err').textContent);
    check('R2 validation: nothing / bad longitude / speed > 40 / unreadable time — each says what to fix, nothing saved',
      /^Nothing to save yet/.test(e1) && /^Latitude \/ longitude not understood/.test(e2) && /^Speed must be/.test(e3) && /^Reported time not understood/.test(e4) && !('posRpt' in vOf(db, 'n5')), [e1, e2, e3, e4]);
    await page.evaluate(() => { __setF('at', ''); __setF('src', 'report'); __dlg('save').click(); });
    await sleep(600);
    const c5 = await page.evaluate(() => ({ cells: __cells('n5'), toasts: __toasts() }));
    check('R2 typed DM position at anchor near Sohar: saved, time set to now (said so), distance to FUJ A, "not moving"',
      /^📍 Gulf of Oman · 24\.36°N 56\.68°E$/.test(c5.cells['Last position']) && c5.cells['Status / speed'] === 'At anchor · 0.2 kn' && /^~.* · just now$/.test(c5.cells['Reported']) && /^\d+ nm to FUJ A$/.test(c5.cells['Distance left']) &&
      c5.toasts.some(t => /reported time set to now/.test(t)) && vOf(db, 'n5').posRpt.src === 'report' && vOf(db, 'n5').posRpt.atApprox === true, c5);

    // Reopen → form shows the saved report; Remove
    await page.evaluate(() => __panel('n2').querySelector('.prpt-btn').click());
    await sleep(100);
    const r2 = await page.evaluate(() => ({ dest: __dlg('dest').value, area: __dlg('area').value, note: __dlg('atnote').hidden, rm: !!__dlg('remove') }));
    check('R2 Update opens the saved report (approximate-time note, Remove offered)', r2.dest === 'Fujairah' && r2.area === 'Gulf of Oman' && !r2.note && r2.rm, r2);
    await page.keyboard.press('Escape');
    check('R2 Esc closes the dialog without saving', await page.evaluate(() => !document.querySelector('.prd-ov')));
    await page.evaluate(() => { window.confirm = () => true; __panel('n1').querySelector('.prpt-btn').click(); });
    await sleep(100);
    await page.evaluate(() => __dlg('remove').click());
    await sleep(600);
    check('R2 Remove: gone from this card and from the same ship\'s other card; posRpt keys dropped',
      !('posRpt' in vOf(db, 'n1')) && !('posRpt' in vOf(db, 'n3')) && await page.evaluate(() => /not added yet/.test(__panel('n1').textContent) && /not added yet/.test(__panel('n3').textContent)), [vOf(db, 'n1'), vOf(db, 'n3')]);
  });

  /* 3 — dashboard rows, AIS not live, warnings stay off the bell */
  await scenario(browser, 'R3 dashboard', async (openT) => {
    const now = Date.now();
    const vs = scene(now);
    // SEA VALIANT 40 nm out, 10 kn toward FUJ A, reported 1 h ago, laycan closed → red "Last report suggests…" (card + row only)
    const lat = 25.170 - 40 / 60.0405;
    vs[0].lc = dubai(now - 72 * HR).slice(0, 11) + ' - ' + dubai(now - 30 * HR).slice(0, 11);
    vs[0].eta = dubai(now - 31 * HR);
    vs[0].posRpt = { src: 'mst', lat: +lat.toFixed(5), lon: 56.44, nav: 'Under way', sog: 10, cog: 0, dest: 'FUJAIRAH', at: iso(now - HR), updatedAt: now - HR };
    vs[1].posRpt = { src: 'vf', area: 'Gulf of Oman', nav: 'Under way', sog: 0.4, dest: 'Fujairah', at: iso(now - 3 * HR), atApprox: true, updatedAt: now - 3 * HR };
    vs[4].posRpt = { src: 'report', lat: 19.5, lon: 64.8, sog: 11, at: iso(now - 4 * 24 * HR), updatedAt: now - 4 * 24 * HR };
    const db = H.createDb({ workspace: U.seedPayload({ vessels: vs }), ais: aisData(now), realtime: false });
    const { page } = await openT(db, 'user-operator', { settleMs: 1000 });
    await page.evaluate(() => { try { flowWelcomeGo('dashboard'); } catch (e) {} showPage('dashboard'); });
    await sleep(500);
    const d = await page.evaluate(() => ({
      sub: document.getElementById('dash-ais-sub').textContent,
      rows: [...document.querySelectorAll('#dash-ais-body .ais-row')].map(r => ({ src: r.dataset.src || 'ais', name: r.querySelector('.ais-row-name').textContent, txt: r.textContent.replace(/\s+/g, ' ').trim(), warn: r.querySelector('.ais-warn') ? r.querySelector('.ais-warn').className : '' })),
      alerts: _aisAlerts().length, bell: (typeof _globalAlerts === 'function' ? '' : ''),
    }));
    check('R3 sub line counts the vessels shown from a last known position', /1 of 5 nominated vessels seen · 3 from a last known position/.test(d.sub), d.sub);
    const sv = d.rows.find(r => r.name === 'SEA VALIANT' && r.src === 'report'), dk = d.rows.find(r => r.name === 'CMA CGM DAKAR'), rm = d.rows.find(r => r.name === 'REIMEI'), op = d.rows.find(r => r.name === 'OCEAN PEARL');
    check('R3 report rows: chip, "last known position" tag, position, distance, status/speed, destination, expected, reported + source, Update position',
      sv && /Approaching\s*last known position/.test(sv.txt) && /40 nm left to FUJ A/.test(sv.txt) && /Under way · 10\.0 kn/.test(sv.txt) && /to FUJAIRAH/.test(sv.txt) && /expected ~\d+ \w{3} \d\d:\d\d/.test(sv.txt) && /reported \d+ \w{3} \d\d:\d\d · 1 h ago · MyShipTracking/.test(sv.txt) && /Update position/.test(sv.txt), sv);
    check('R3 red warning from a recent report (laycan closed) on the row — "Last report suggests arrival …"', sv && /ais-warn red/.test(sv.warn) && /Last report suggests arrival ~/.test(sv.txt), sv);
    check('R3 …but never in the bell / Needs Attention (AIS alerts only)', d.alerts === 0, d.alerts);
    check('R3 VesselFinder report row: sea area, no distance; old report (4 days) shown in amber, its worked-out arrival marked "already past", no estimate warning',
      dk && /📍 Gulf of Oman \(no exact position\)/.test(dk.txt) && !/nm left/.test(dk.txt) && rm && /reported ~?\d+ \w{3} \d\d:\d\d · 4 days ago/.test(rm.txt) && /expected ~\d+ \w{3} \d\d:\d\d — already past, get a newer report/.test(rm.txt) && rm.warn === '', [dk, rm]);
    check('R3 live AIS row unchanged (OCEAN PEARL), and the second SEA VALIANT nomination without its own report gets "+ Add last position"',
      op && op.src === 'ais' && !/last known position/.test(op.txt) && d.rows.some(r => r.name === 'SEA VALIANT' && r.src === 'ais' && /\+ Add last position/.test(r.txt)), d.rows.map(r => r.name + ':' + r.src));
    const amber = await page.evaluate(() => { const el = [...document.querySelectorAll('#dash-ais-body .ais-row')].find(r => r.querySelector('.ais-row-name').textContent === 'REIMEI').querySelector('.prpt-old'); return el ? getComputedStyle(el).color : null; });
    check('R3 amber colour for a day-old report', !!amber && amber !== 'rgb(0, 0, 0)', amber);
    if (SHOTS) { await scrollTo(page, '#dash-ais'); await shot(page.locator('#dash-ais'), 'report-dashboard.png'); }
    // Update position from the dashboard opens the dialog for that card
    await page.evaluate(() => [...document.querySelectorAll('#dash-ais-body .ais-row')].find(r => r.querySelector('.ais-row-name').textContent === 'CMA CGM DAKAR').querySelector('.prpt-link').click());
    await sleep(150);
    check('R3 "Update position" in the row opens the dialog for that nomination', await page.evaluate(() => /CMA CGM DAKAR/.test(document.getElementById('prd-title').textContent) && __dlg('dest').value === 'Fujairah'));
    await page.keyboard.press('Escape');
    // the card's panel: red warning there too; the header knows a newer live AIS fix when there is one
    await page.evaluate(() => { try { flowWelcomeGo('nominations'); } catch (e) {} showPage('nominations'); });
    await sleep(300);
    const card = await page.evaluate(() => ({ warn: __panel('n1').querySelector('.ais-warn') ? __panel('n1').querySelector('.ais-warn').textContent : '' }));
    check('R3 card panel carries the same warning', /^Last report suggests arrival ~.* may miss laycan$/.test(card.warn), card);
    if (SHOTS) {
      await page.setViewportSize({ width: 390, height: 844 });
      await sleep(300);
      await scrollTo(page, '#v' + await page.evaluate(() => __cid('n1')) + '-prpt', 200);
      await shot(page, 'report-card-phone.png');
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    const ph = await page.evaluate(async () => {
      const r = __panel('n1').getBoundingClientRect();
      return { fit: r.right <= innerWidth + 1, docW: document.documentElement.scrollWidth, winW: innerWidth };
    });
    check('R3 panel fits the card width, no horizontal page scroll', ph.fit && ph.docW <= ph.winW + 1, ph);
  });

  /* 4 — AIS not set up / trader / sync: reload, trader RPC, merge takes the newer report whole */
  await scenario(browser, 'R4 sync, trader, AIS not set up', async (openT) => {
    const now = Date.now();
    const vs = scene(now);
    const db = H.createDb({ workspace: U.seedPayload({ vessels: vs }), realtime: false });
    const A = await openT(db, 'user-operator');
    await A.page.evaluate(() => { try { flowWelcomeGo('nominations'); } catch (e) {} showPage('nominations'); });
    await sleep(300);
    check('R4 without AIS set up the card panel still works (prompt on every card)', await A.page.evaluate(() => ['n1', 'n2', 'n3', 'n4', 'n5'].every(n => /not added yet/.test(__panel(n).textContent))));
    // A saves a report on n2
    await A.page.evaluate(() => __panel('n2').querySelector('.prpt-btn').click());
    await sleep(100);
    await A.page.evaluate(t => __paste(t), VF_TEXT);
    await A.page.evaluate(() => __dlg('save').click());
    await sleep(700);
    const stamp1 = vOf(db, 'n2').posRpt.updatedAt;
    // B (second operator) opens: sees it; reload of A keeps it
    const B = await openT(db, 'user-operator2');
    await B.page.evaluate(() => { try { flowWelcomeGo('nominations'); } catch (e) {} showPage('nominations'); });
    await sleep(300);
    check('R4 another operator sees the report after loading', await B.page.evaluate(() => __cells('n2')['Heading to'] === 'Fujairah' && /from VesselFinder/.test(__panel('n2').textContent)));
    // both edit the same nomination's report without pulling in between → the newer one wins WHOLE
    await A.page.evaluate(async t => { __panel('n2').querySelector('.prpt-btn').click(); await new Promise(r => setTimeout(r, 80)); await __paste(t); __dlg('save').click(); }, mstPage(now, { name: 'CMA CGM DAKAR', imo: '9448827', mmsi: '248222000', lat: '25.12000', lon: '56.50000', dest: 'FUJAIRAH ANCH', sog: '0.3' }));
    await sleep(700);
    await sleep(20);
    await B.page.evaluate(async () => { __panel('n2').querySelector('.prpt-btn').click(); await new Promise(r => setTimeout(r, 80)); __setF('dest', 'KHOR FAKKAN'); __setF('area', 'Gulf of Oman'); __dlg('save').click(); });
    await sleep(1500);
    const merged = vOf(db, 'n2').posRpt;
    check('R4 two operators saving different reports: the newer report wins whole (no mix of the two)', merged && merged.dest === 'KHOR FAKKAN' && !('lat' in merged) && merged.updatedAt > stamp1, merged);
    await A.page.evaluate(() => _pollOnce(true));
    await sleep(500);
    check('R4 …and the first operator converges to it', await A.page.evaluate(() => __cells('n2')['Heading to'] === 'KHOR FAKKAN'));
    // reload keeps it; a clean reload writes nothing
    const wB = U.writes(db, 'user-operator2').length;
    const C = await openT(db, 'user-operator2');
    await sleep(1500);
    check('R4 reopening: report restored, no write', await C.page.evaluate(() => __cells('n2')['Heading to'] === 'KHOR FAKKAN') && U.writes(db, 'user-operator2').length === wB);
    // trader saves a report through the RPC; the server keeps it
    const T = await openT(db, 'user-trader');
    await T.page.evaluate(() => { try { flowWelcomeGo('nominations'); } catch (e) {} showPage('nominations'); });
    await sleep(300);
    await T.page.evaluate(async t => { __panel('n1').querySelector('.prpt-btn').click(); await new Promise(r => setTimeout(r, 80)); await __paste(t); __dlg('save').click(); }, mstPage(now));
    await sleep(900);
    const rpc = db.log.filter(o => o.action === 'rpc' && o.name === 'trader_update_vessels').pop();
    const tv = rpc && rpc.args.new_vessels.find(v => v.nomUid === 'n1');
    check('R4 a trader may save a report: carried by trader_update_vessels and kept (also on the same ship\'s other card)', tv && tv.posRpt && tv.posRpt.lat === 19.27129 && vOf(db, 'n1').posRpt && vOf(db, 'n3').posRpt && vOf(db, 'n3').posRpt.updatedAt === vOf(db, 'n1').posRpt.updatedAt, tv && tv.posRpt);
    // trash + restore keeps it
    const tr = await A.page.evaluate(async () => {
      await _pollOnce(true);
      window.confirm = () => false;
      rmV(+__cid('n1'));
      await new Promise(r => setTimeout(r, 400));
      const def = _trashBin[_trashBin.length - 1].def;
      restoreFromTrash(_trashBin.length - 1);
      await new Promise(r => setTimeout(r, 300));
      return { def: !!def.posRpt, cell: __cells('n1')['Heading to'] };
    });
    check('R4 removing to the trash and restoring keeps the report', tr.def && tr.cell === 'FUJAIRAH', tr);
    // dashboard while AIS is not set up: operator sees the note + the report rows
    await A.page.evaluate(() => { try { flowWelcomeGo('dashboard'); } catch (e) {} showPage('dashboard'); renderDashAis(); });
    await sleep(300);
    const dash = await A.page.evaluate(() => ({ show: document.getElementById('dash-ais').style.display !== 'none', setup: !!document.querySelector('#dash-ais-body [data-ais-setup]'), rows: document.querySelectorAll('#dash-ais-body .ais-row[data-src="report"]').length }));
    check('R4 dashboard without AIS: setup note + the report rows', dash.show && dash.setup && dash.rows === 3, dash);
  });

  /* 5 — untrusted text */
  await scenario(browser, 'R5 XSS', async (openT) => {
    const now = Date.now();
    const vs = scene(now);
    const bad = '<img src=x onerror="window.__pwn=1">';
    vs[1].posRpt = { src: '<b>x</b>', area: bad, nav: bad, dest: bad, arr: bad, by: bad, at: iso(now - HR), updatedAt: now };
    vs[2].posRpt = { src: 'mst', lat: '"><svg onload=window.__pwn=2>', lon: 5, area: 'A', at: 'not a date', updatedAt: 'x' };
    const db = H.createDb({ workspace: U.seedPayload({ vessels: vs }), ais: aisData(now), realtime: false });
    const { page } = await openT(db, 'user-operator');
    await page.evaluate(() => { try { flowWelcomeGo('nominations'); } catch (e) {} showPage('nominations'); });
    await sleep(300);
    await page.evaluate(t => { __panel('n5').querySelector('.prpt-btn').click(); return new Promise(r => setTimeout(r, 80)).then(() => __paste(t)); }, 'The current position of ' + bad + ' is in ' + bad + ' with coordinates 19.1° / 65.1° as reported on 2026-10-15 20:28 by AIS. heading at the port of ' + bad + '. IMO: 9111111');
    await page.evaluate(() => __dlg('save').click());
    await sleep(600);
    await page.evaluate(() => { try { flowWelcomeGo('dashboard'); } catch (e) {} showPage('dashboard'); });
    await sleep(400);
    const r = await page.evaluate(() => ({ pwn: window.__pwn || 0, imgs: document.querySelectorAll('#vc img[src="x"], #dash-ais img[src="x"], .prd-ov img').length, n2: __cells('n2'), n3: __panel('n3').textContent, n5: __cells('n5') }));
    check('R5 pasted / synced HTML is shown as text everywhere (card, dialog, dashboard), never run', r.pwn === 0 && r.imgs === 0 && /<img/.test(r.n2['Heading to'] || '') && /<img/.test(r.n5['Heading to'] || ''), r);
    check('R5 an unknown status / source is dropped; a bad latitude drops the position (kept: area)', !/onerror/.test(r.n2['Status / speed']) && /from Other/.test(await page.evaluate(() => __panel('n2').textContent)) && /📍 A \(no exact position\)/.test(r.n3), r);
  });

  /* 6 — parser cases from the review (noon reports / agents / time zones / New Year) */
  await scenario(browser, 'R6 parser review cases', async (openT) => {
    const db = H.createDb({ workspace: U.seedPayload({ vessels: [] }) });
    const { page } = await openT(db, 'user-operator');
    const now = Date.parse('2026-10-16T08:00:00Z');
    const r = await page.evaluate(now => {
      const P = (t, n) => { const p = _prParse(t, n == null ? now : n); return { sog: p.sog, eta: p.eta == null ? null : new Date(p.eta).toISOString(), etaDay: p.etaDay, at: p.at == null ? null : new Date(p.at).toISOString(), approx: p.atApprox, unread: p.agoUnread, dest: p.dest, nav: p.nav, lat: p.lat, lon: p.lon }; };
      return {
        wind: P('Good day. Noon position 16 Oct: 19-16N 065-03E. Wind speed 25 kts NW, sea rough. Vessel speed reduced to 9.5 kts. ETA Fujairah 18th Oct 2300 LT.'),
        windDir: P('NOON REPORT\nPOSN: 19-16N 065-03E\nWIND DIR/SPEED: NW/22 KTS\nAVG SPEED: 11.2 KTS\nETA FUJAIRAH 18/2300 LT'),
        current: P('Pos 19-16N 065-03E. Ocean current speed is 1.5 knots against. Avg speed 10.8 kts.'),
        maxAvg: P('Pos 19-16N 065-03E max speed 14 kts, average speed 11.2 kts'),
        ordered: P('Pos 19-16N 065-03E. Ordered speed 12.5 kts. Speed 10.8 kts'),
        onlyMax: P('Pos 19-16N 065-03E max speed 14 kts'),
        yearNoTime: P('Noon pos 19-16N 065-03E, ETA Fujairah 18th Oct 2026 AGW WP'),
        yearTime: P('Noon pos 19-16N 065-03E, ETA Fujairah 18 Oct 2026 at 2300 LT'),
        yearSlash: P('Noon pos 19-16N 065-03E, ETA 18 Oct 2026 / 2300LT'),
        yearAsTime: P('Noon pos 19-16N 065-03E, ETA Fujairah 18 Oct 2030'),
        utcParen: P('Noon pos 19-16N 065-03E, ETA Fujairah 18 Oct 2300 (UTC)'),
        utcPlus4: P('Noon pos 19-16N 065-03E, ETA Fujairah 18 Oct 2300 UTC+4'),
        gmtPlus4: P('Noon pos 19-16N 065-03E, ETA Fujairah 18 Oct 2300 hrs GMT+4'),
        isoLT: P('MV SEA VALIANT position 19.27N 065.06E speed 11 kts ETA: 2026-10-18 23:00 LT'),
        monLT: P('MV SEA VALIANT position 19.27N 065.06E speed 11 kts ETA: Oct 18, 23:00 LT'),
        siteUtc: P('MyShipTracking ETA* 2026-10-18 23:00 (UTC)'),
        dms: P('Vessel anchored Fujairah OPL, pos 25 10 30N 056 27E'),
        dms2: P("Pos 25°10'30N 056°27'E"),
        willAnchor: P('Dear all, MV ABC ETA Fujairah 18th Oct 2300 LT, will be anchored at OPL on arrival. Currently underway at 12 kts.'),
        wasAnchor: P('Vessel was anchored at Sohar, now underway to Fujairah. pos 24-30N 056-50E'),
        hasBeen: P('Vessel has been anchored at Fujairah OPL since 15th Oct 0800 hrs, position 25 10.2N 056 27.6E'),
        destined: P('MV X anchored, destined for Fujairah, pos 25 10.2N 056 27.6E'),
        abt: P('MV X pos 19-16N 065-03E ETA abt 18th Oct 2300 LT'),
        revised: P('MV X pos 19-16N 065-03E ETA revised from 15th Oct 1200 LT to 18th Oct 2300 LT'),
        tba: P('MV SEA VALIANT pos 19-16N 065-03E. ETA Fujairah: TBA, ETD Sohar 16th Oct 1200 LT'),
        month: P('MarineTraffic\nLatitude / Longitude: 19.27129° / 65.06209°\nPosition Received: a month ago'),
        compound: P('MarineTraffic\nLatitude / Longitude: 19.27129° / 65.06209°\nPosition Received: 1 hour 20 minutes ago'),
        weeks: P('The current position of X is at Arabian Sea reported 2 weeks ago by AIS.'),
        unread: P('The current position of X is at Arabian Sea reported quite some time ago by AIS.'),
        newYear: P('The current position of X is at Arabian Sea reported 3 hours ago by AIS. The vessel is en route to the port of Fujairah, United Arab Emirates (UAE), sailing at a speed of 12.1 knots and expected to arrive there on Dec 30, 21:30.', Date.parse('2027-01-03T08:00:00Z')),
        newYear2: P('The current position of X is at Arabian Sea reported 3 hours ago by AIS. The vessel is en route to the port of Fujairah, United Arab Emirates (UAE), sailing at a speed of 12.1 knots and expected to arrive there on Jan 2, 06:00.', Date.parse('2026-12-30T08:00:00Z')),
        bigBlank: (() => { const t0 = performance.now(); _prParse('Destination' + '\n'.repeat(20000) + 'x', now); return performance.now() - t0; })(),
        // round 2
        barge1: P('MV SEA VALIANT anchored at Fujairah OPL, pos 25 10.2N 056 27.6E. Barge now proceeding alongside.'),
        barge2: P('Vessel at anchor Fujairah OPL since 0800 LT. Bunker barge currently underway to vessel.'),
        barge3: P('Vessel drifting off Fujairah. Barge now en route.'),
        barge4: P('Vessel berthed at Sohar. Pilot now proceeding to vessel.'),
        timePos: P('Position at 08:00 25 10.2 N 056 27.6 E'),
        datePos: P('16/10 12:00 19 16N 065 03E'),
        datePos2: P('MV SEA VALIANT - NOON 16/10 - 19 16N 065 03E - SPD 11.5 KTS'),
        dotDate: P('NOON 16.10 19 16N 065 03E'),
        dueTo: P('Pos 19-16N 065-03E. ETA amended 18th Oct 2300 LT owing to late departure from Sohar 16th Oct 1200 LT'),
        dueTo2: P('Pos 19-16N 065-03E. ETA revised 18th Oct 2300 LT due to bad weather.'),
        dueTo3: P('Pos 19-16N 065-03E. ETA Fujairah 18th Oct 2300 LT, revised from 15th Oct due to weather.'),
        asTo: P('Pos 19-16N 065-03E. ETA FUJ 18/2300 LT, will keep you updated as to any change'),
        windLine: P('NOON REPORT\nPOSITION: 19-16N 065-03E\nCOURSE: 300\nWIND: NW 4\nSPEED: 11.5 KTS\nETA FUJAIRAH 18/2300 LT'),
        windLine2: P('NOON REPORT\nPOSITION: 19-16N 065-03E\nWIND: NW/22 KTS\nSPEED: 11.5 KTS'),
        windSent: P('Pos 19-16N 065-03E. Wind NE 3. Speed 11 kts.'),
        seaOrdered: P('Pos: 19-16N 065-03E\nSea state: 3\nSpeed: 11.5 kts\nSpeed ordered: 12 kts'),
        etb: P('Pos 19-16N 065-03E. ETA/ETB Fujairah: 18th Oct 2300 LT'),
        etb2: P('Pos 19-16N 065-03E. ETA / ETB 18/2300 LT'),
        nor: P('Pos 19-16N 065-03E. ETA OPL (for NOR) 18th Oct 2300 LT'),
        window: P('Pos 19-16N 065-03E. ETA Fujairah 18 Oct 2300 UTC - 19 Oct 0300 UTC'),
        notice: P('Pos 19-16N 065-03E. ETA Fujairah 18/2300 UTC -12 hrs notice'),
        vfFrag: P('Destination  Fujairah, United Arab Emirates (UAE)   ATA: -   |   ETA: Oct 18, 23:00'),
        mtFrag: P('Destination: FUJAIRAH\nReported ETA: 2026-10-18 23:00\nSpeed/Course: 11.5 kn / 213°'),
        newPort: P('Pos 19-16N 065-03E. ETA New Mangalore 18th Oct 2300 LT'),
        // round 3
        castOff: P('Vessel anchored at Fujairah OPL for bunkers. Barge cast off 1400 LT and vessel now underway to Sohar.'),
        pilotBoarded: P('Vessel anchored at Fujairah OPL 0600 LT. NOR tendered 0618 LT. Pilot boarded 1000 LT and vessel now proceeding to berth.'),
        tugFast: P('Vessel at anchor. Tug made fast 0900 LT and vessel now underway to berth.'),
        crewChange: P('Crew change completed and vessel now proceeding to Fujairah'),
        bargeTug: P('MV X at anchor Fujairah OPL. Barge and tug now proceeding alongside.'),
        lines1: P('MV SEA VALIANT\nETA Fujairah OPL: 18th Oct 2300 LT\nBunker barge: TBA\nVessel currently drifting off Fujairah'),
        lines2: P('NOON REPORT\nMV SEA VALIANT\nPOS: 19-16N 065-03E\nALL CREW WELL\nVESSEL PROCEEDING TO FUJAIRAH'),
        lines3: P('Vessel: MV SEA VALIANT\nBarge: ABC 1\nStatus: Vessel anchored at Fujairah OPL'),
        speedNext: P('MarineTraffic\nSEA VALIANT\nNavigational status\nUnder way using engine\nSpeed\n11.5 kn\nCourse\n213 °\nLatitude / Longitude\n19.27129° / 65.06209°\nPosition Received\n2 hours ago'),
        speedNext2: P('NOON REPORT 16/10\nPOSITION\n19-16N 065-03E\nSPEED\n11.5 KTS'),
        agentNoTz: P('Good day, MV SEA VALIANT ETA Fujairah 18th Oct 2300 hrs. Vessel currently underway at 12 kts.'),
        agentNoTz2: P('MV SEA VALIANT ETA FUJ 18/2300 HRS, speed 12 kts'),
        agentAtd: P('Dear Sirs,\nMV SEA VALIANT\nATD: 16th Oct 1200 hrs\nETA Fujairah: 18th Oct 2300 hrs\nBest regards'),
        agentIso: P('Vessel underway, ETA: 2026-10-18 23:00'),
        noonAtd: P('NOON REPORT\nPOSITION: 19-16N 065-03E\nATD: 15th Oct 1200 LT\nETA: 18th Oct 2300'),
        revisedTo: P('Pos 19-16N 065-03E. ETA Fujairah 15th Oct 1200 LT revised to 18th Oct 2300 LT due to weather'),
        revisedTo2: P('ETA 15/1200 LT has been revised to 18/2300 LT'),
        revisedAbt: P('Pos 19-16N 065-03E. ETA revised from 15th Oct 1200 LT to abt 18th Oct 2300 LT'),
        revisedDay: P('ETA revised from 15th Oct 1200 LT to Sunday 18th Oct 2300 LT'),
        tbaLine: P('Pos 19-16N 065-03E\nETA: to be advised\nETD Sohar: 16th Oct 1200 LT'),
        agwEtd: P('NOON REPORT\nPOSITION: 19-16N 065-03E\nETA FUJAIRAH: AGW WP\nETD SOHAR: 16th Oct 1200 LT'),
        norTendered: P('Vessel arrived Fujairah OPL. ETA berth awaited. NOR tendered 15th Oct 1200 LT'),
        gmtSpaced: P('Noon pos 19-16N 065-03E, ETA Fujairah 18 Oct 2300 hrs GMT + 4'),
        gmtHrs: P('Noon pos 19-16N 065-03E, ETA Fujairah 18th Oct 2300 hrs (GMT+4 hrs)'),
        utc4h: P('ETA Fujairah 18th Oct 2300 UTC+4h'),
        onThe: P('Pos 19-16N 065-03E. ETA Fujairah on the 18th Oct 2300 LT'),
      };
    }, now);
    check('R6 ship speed, not the wind\'s / current\'s / max / ordered speed', r.wind.sog === 9.5 && r.windDir.sog === 11.2 && r.current.sog === 10.8 && r.maxAvg.sog === 11.2 && r.ordered.sog === 10.8 && r.onlyMax.sog === null, [r.wind.sog, r.windDir.sog, r.current.sog, r.maxAvg.sog, r.ordered.sog, r.onlyMax.sog]);
    // the page runs in Asia/Dubai (UTC+4): 23:00 LT = 19:00Z
    check('R6 ETA with a year: never the year as a time; date only when no time is given', r.yearNoTime.eta === '2026-10-17T20:00:00.000Z' && r.yearNoTime.etaDay === true && r.yearTime.eta === '2026-10-18T19:00:00.000Z' && !r.yearTime.etaDay && r.yearSlash.eta === '2026-10-18T19:00:00.000Z' && r.yearAsTime.eta === '2026-10-18T16:30:00.000Z',
      [r.yearNoTime, r.yearTime.eta, r.yearSlash.eta, r.yearAsTime.eta]);
    check('R6 ETA time zones: "(UTC)", "UTC+4", "hrs GMT+4", ISO / "Oct 18, 23:00" with LT; site ETA stays UTC',
      r.utcParen.eta === '2026-10-18T23:00:00.000Z' && r.utcPlus4.eta === '2026-10-18T19:00:00.000Z' && r.gmtPlus4.eta === '2026-10-18T19:00:00.000Z' && r.isoLT.eta === '2026-10-18T19:00:00.000Z' && r.monLT.eta === '2026-10-18T19:00:00.000Z' && r.siteUtc.eta === '2026-10-18T23:00:00.000Z',
      [r.utcParen.eta, r.utcPlus4.eta, r.gmtPlus4.eta, r.isoLT.eta, r.monLT.eta, r.siteUtc.eta]);
    check('R6 degrees-minutes-seconds without a seconds mark', r.dms.lat === 25.175 && r.dms.lon === 56.45 && r.dms2.lat === 25.175 && r.dms2.lon === 56.45, [r.dms, r.dms2]);
    check('R6 status in the present only: "will be anchored … currently underway" / "was anchored, now underway" → Under way; "has been anchored" → At anchor',
      r.willAnchor.nav === 'Under way' && r.wasAnchor.nav === 'Under way' && r.hasBeen.nav === 'At anchor', [r.willAnchor.nav, r.wasAnchor.nav, r.hasBeen.nav]);
    check('R6 no junk destinations ("destined for", "ETA abt", "ETA revised from"); a revised ETA takes the new time; "ETA: TBA, ETD …" is no ETA',
      r.destined.dest === '' && r.abt.dest === '' && r.abt.eta === '2026-10-18T19:00:00.000Z' && r.revised.dest === '' && r.revised.eta === '2026-10-18T19:00:00.000Z' && r.tba.eta === null,
      [r.destined.dest, r.abt, r.revised, r.tba.eta]);
    check('R6 "a month ago", "1 hour 20 minutes ago", "2 weeks ago"; an unreadable "… ago" is flagged (no silent now)',
      r.month.at === new Date(now - 30 * 86400000).toISOString() && r.month.approx && r.compound.at === new Date(now - 80 * 60000).toISOString() && r.weeks.at === new Date(now - 14 * 86400000).toISOString() && r.unread.at === null && r.unread.unread === true && r.month.unread === false,
      [r.month, r.compound.at, r.weeks.at, r.unread]);
    check('R6 an ETA without a year around New Year: nearest year (30 Dec seen on 3 Jan → last year; 2 Jan seen on 30 Dec → next year)',
      r.newYear.eta === '2026-12-30T21:30:00.000Z' && r.newYear2.eta === '2027-01-02T06:00:00.000Z', [r.newYear.eta, r.newYear2.eta]);
    check('R6 a paste with thousands of blank lines parses quickly', r.bigBlank < 500, r.bigBlank);
    check('R6b a barge / pilot "now proceeding" does not make the anchored / drifting / berthed ship "Under way"',
      r.barge1.nav === 'At anchor' && r.barge2.nav === 'At anchor' && r.barge3.nav === 'Drifting' && r.barge4.nav === 'Moored' && r.wasAnchor.nav === 'Under way' && r.willAnchor.nav === 'Under way', [r.barge1.nav, r.barge2.nav, r.barge3.nav, r.barge4.nav]);
    check('R6b a time or date just before the position is not read as part of it',
      r.timePos.lat === 25.17 && r.timePos.lon === 56.46 && r.datePos.lat === 19.26667 && r.datePos.lon === 65.05 && r.datePos2.lat === 19.26667 && r.datePos2.sog === 11.5 && r.dotDate.lat === 19.26667, [r.timePos, r.datePos, r.datePos2, r.dotDate]);
    check('R6b "due to" / "owing to" / "as to" after an ETA keep that ETA (only "revised from X to Y" takes Y)',
      [r.dueTo, r.dueTo2, r.dueTo3, r.asTo].every(x => x.eta === '2026-10-18T19:00:00.000Z'), [r.dueTo.eta, r.dueTo2.eta, r.dueTo3.eta, r.asTo.eta]);
    check('R6b speed in line-per-field reports: a WIND / Sea state line before SPEED, and "Speed ordered" after it',
      r.windLine.sog === 11.5 && r.windLine2.sog === 11.5 && r.windSent.sog === 11 && r.seaOrdered.sog === 11.5, [r.windLine.sog, r.windLine2.sog, r.windSent.sog, r.seaOrdered.sog]);
    check('R6b "ETA/ETB …", "ETA / ETB …" and "ETA OPL (for NOR) …" are read', [r.etb, r.etb2, r.nor].every(x => x.eta === '2026-10-18T19:00:00.000Z'), [r.etb.eta, r.etb2.eta, r.nor.eta]);
    check('R6b "UTC - 19 Oct" (a window) and "UTC -12 hrs notice" are not time-zone offsets', r.window.eta === '2026-10-18T23:00:00.000Z' && r.notice.eta === '2026-10-18T23:00:00.000Z', [r.window.eta, r.notice.eta]);
    check('R6b copied fragments of VesselFinder / MarineTraffic pages keep their ETA in UTC', r.vfFrag.eta === '2026-10-18T23:00:00.000Z' && r.mtFrag.eta === '2026-10-18T23:00:00.000Z', [r.vfFrag.eta, r.mtFrag.eta]);
    check('R6b "ETA New Mangalore" keeps the whole port name', r.newPort.dest === 'New Mangalore', r.newPort.dest);
    const L = '2026-10-18T19:00:00.000Z';
    check('R6c the vessel is the subject: "Barge cast off … and vessel now underway", "Pilot boarded … and vessel now proceeding", "Tug made fast … and vessel now underway", "Crew change completed and vessel now proceeding" → Under way; "Barge and tug now proceeding alongside" → still At anchor',
      r.castOff.nav === 'Under way' && r.pilotBoarded.nav === 'Under way' && r.tugFast.nav === 'Under way' && r.crewChange.nav === 'Under way' && r.bargeTug.nav === 'At anchor', [r.castOff.nav, r.pilotBoarded.nav, r.tugFast.nav, r.crewChange.nav, r.bargeTug.nav]);
    check('R6c line-per-field messages: a line break ends the clause', r.lines1.nav === 'Drifting' && r.lines2.nav === 'Under way' && r.lines3.nav === 'At anchor', [r.lines1.nav, r.lines2.nav, r.lines3.nav]);
    check('R6c the speed value on the line after its label', r.speedNext.sog === 11.5 && r.speedNext2.sog === 11.5, [r.speedNext.sog, r.speedNext2.sog]);
    check('R6c messages without a time zone mean local time (incl. an agent\'s "ATD:" line and ISO dates in a message)',
      [r.agentNoTz, r.agentNoTz2, r.agentAtd, r.agentIso, r.noonAtd].every(x => x.eta === L), [r.agentNoTz.eta, r.agentNoTz2.eta, r.agentAtd.eta, r.agentIso.eta, r.noonAtd.eta]);
    check('R6c revised ETAs take the new time ("revised to", "has been revised to", "to abt", "to Sunday")', [r.revisedTo, r.revisedTo2, r.revisedAbt, r.revisedDay].every(x => x.eta === L), [r.revisedTo.eta, r.revisedTo2.eta, r.revisedAbt.eta, r.revisedDay.eta]);
    check('R6c an undated ETA never takes the next ETD / NOR line', r.tbaLine.eta === null && r.agwEtd.eta === null && r.norTendered.eta === null, [r.tbaLine.eta, r.agwEtd.eta, r.norTendered.eta]);
    check('R6c "GMT + 4", "(GMT+4 hrs)", "UTC+4h" are offsets', [r.gmtSpaced, r.gmtHrs, r.utc4h].every(x => x.eta === L), [r.gmtSpaced.eta, r.gmtHrs.eta, r.utc4h.eta]);
    check('R6c "ETA Fujairah on the 18th" → Fujairah', r.onThe.dest === 'Fujairah' && r.onThe.eta === L, r.onThe);
  });

  /* 7 — dialog review cases: card re-numbered by a sync, removed nomination, keyboard, backdrop, arrived re-save, IMO conflict */
  await scenario(browser, 'R7 dialog review cases', async (openT) => {
    const now = Date.now();
    const vs = scene(now);
    const db = H.createDb({ workspace: U.seedPayload({ vessels: vs }), realtime: false });
    const A = await openT(db, 'user-operator');
    const page = A.page;
    await page.evaluate(() => { try { flowWelcomeGo('nominations'); } catch (e) {} showPage('nominations'); });
    await sleep(300);
    // A opens CMA CGM DAKAR (n2), goes to copy the page; meanwhile a colleague removes SEA VALIANT (n1) → cards re-numbered
    await page.evaluate(() => __panel('n2').querySelector('.prpt-btn').click());
    await sleep(120);
    const idBefore = await page.evaluate(() => __cid('n2'));
    {
      const row = U.row(db), p = clone(row.payload), ver = Date.now();
      p.state.vessels = p.state.vessels.filter(v => v.nomUid !== 'n1');
      p.version = ver; p.state.version = ver; row.payload = p; row.version = ver;
    }
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); return _pollOnce(true); });
    await sleep(800);
    const ren = await page.evaluate(() => ({ id: __cid('n2'), n1: __cid('n1'), dlg: !!document.querySelector('.prd-ov') }));
    await page.evaluate(t => __paste(t), VF_TEXT);
    await page.evaluate(() => __dlg('save').click());
    await sleep(700);
    const after = { n2: vOf(db, 'n2').posRpt, n3: vOf(db, 'n3').posRpt, n4: vOf(db, 'n4').posRpt };
    check('R7 a sync re-numbers the cards while the box is open → the report still goes to ITS nomination (CMA CGM DAKAR), no other card', ren.id !== idBefore && ren.n1 === null && ren.dlg && after.n2 && after.n2.src === 'vf' && !after.n3 && !after.n4, { idBefore, ren, after });
    // the nomination itself removed while the box is open → nothing saved, says why
    await page.evaluate(() => __panel('n4').querySelector('.prpt-btn').click());
    await sleep(120);
    {
      const row = U.row(db), p = clone(row.payload), ver = Date.now();
      p.state.vessels = p.state.vessels.filter(v => v.nomUid !== 'n4');
      p.version = ver; p.state.version = ver; row.payload = p; row.version = ver;
    }
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); return _pollOnce(true); });
    await sleep(800);
    await page.evaluate(t => __paste(t), mstPage(now));
    await page.evaluate(() => __dlg('save').click());
    await sleep(400);
    const gone = await page.evaluate(() => ({ err: __dlg('err').textContent, open: !!document.querySelector('.prd-ov') }));
    check('R7 its nomination removed meanwhile → "removed or changed by a colleague … nothing was saved", box stays open', gone.open && /removed or changed by a colleague/.test(gone.err) && !U.row(db).payload.state.vessels.some(v => v.posRpt && v.posRpt.src === 'mst'), gone);
    // keyboard: click on the title (focus leaves the inputs), Esc still closes
    await page.click('#prd-title');
    await page.keyboard.press('Escape');
    check('R7 Esc closes the box after a click on its text', await page.evaluate(() => !document.querySelector('.prd-ov')));
    await page.evaluate(() => __panel('n3').querySelector('.prpt-btn').click());
    await sleep(120);
    await page.evaluate(() => document.body.focus());
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('Tab');
    check('R7 Tab with focus outside the box goes into the box', await page.evaluate(() => document.querySelector('.prd-ov').contains(document.activeElement)));
    // backdrop: press on the backdrop and release inside the box → stays open; a click on the backdrop closes
    const box = await page.evaluate(() => { const r = document.querySelector('.prd').getBoundingClientRect(); return { x: r.left + 40, y: r.top + 40, bx: Math.max(5, r.left - 6), by: r.top + 60 }; });
    await page.mouse.move(box.bx, box.by); await page.mouse.down(); await page.mouse.move(box.x, box.y); await page.mouse.up();
    const stays = await page.evaluate(() => !!document.querySelector('.prd-ov'));
    await page.mouse.click(box.bx, box.by);
    const closed = await page.evaluate(() => !document.querySelector('.prd-ov'));
    check('R7 a drag that starts on the backdrop does not close the box; a click on the backdrop does', stays && closed, { stays, closed });
    // arrived report: re-saved unchanged keeps "arrived" + its time
    await page.evaluate(() => __panel('n3').querySelector('.prpt-btn').click());
    await sleep(120);
    await page.evaluate(t => __paste(t), 'VesselFinder The current position of SEA VALIANT is at Gulf of Oman reported 3 hours ago by AIS. The vessel arrived at the port of Fujairah, United Arab Emirates (UAE) on Oct 15, 19:32 UTC. (IMO 9420629, MMSI 538009850)');
    await page.evaluate(() => __dlg('save').click());
    await sleep(600);
    const a1 = clone(vOf(db, 'n3').posRpt);
    await page.evaluate(() => __panel('n3').querySelector('.prpt-btn').click());
    await sleep(120);
    const destBox = await page.evaluate(() => __dlg('dest').value);
    await page.evaluate(() => __dlg('save').click());
    await sleep(600);
    const a2 = vOf(db, 'n3').posRpt;
    const focusOk = await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('prpt-btn') && __panel('n3').contains(document.activeElement));
    check('R7 an "arrived" report re-saved unchanged keeps the arrival and its time ("arrived Fujairah" in the box)', a1.arr === 'Fujairah' && a1.arrAt && destBox === 'arrived Fujairah' && a2.arr === 'Fujairah' && a2.arrAt === a1.arrAt && !a2.dest, { a1, destBox, a2 });
    check('R7 after Save, focus is on the card\'s new Update button', focusOk);
    // date-only ETA from a noon report shows as a date
    await page.evaluate(() => __panel('n5').querySelector('.prpt-btn').click());
    await sleep(120);
    await page.evaluate(t => __paste(t), 'Noon pos 19-16N 065-03E, speed 11 kts, ETA Fujairah 18th Oct ' + new Date().getFullYear() + ' AGW WP');
    const etaBox = await page.evaluate(() => __dlg('eta').value);
    await page.evaluate(() => { __setF('at', _prFmtLocal(Date.now() - 3600000)); __dlg('save').click(); });
    await sleep(600);
    const c5 = await page.evaluate(() => __cells('n5'));
    check('R7 a date-only ETA: date in the box, "18 Oct (date only)" on the card, stored with etaDay', /^18 Oct \d{4}$/.test(etaBox) && c5['ETA'] === '18 Oct (date only)' && vOf(db, 'n5').posRpt.etaDay === true, { etaBox, c5 });
    // unreadable "… ago" → must type the time
    await page.evaluate(() => __panel('n5').querySelector('.prpt-btn').click());
    await sleep(120);
    await page.evaluate(t => __paste(t), 'The current position of REIMEI is at Gulf of Oman reported quite some time ago by AIS.');
    await page.evaluate(() => { __setF('at', ''); __dlg('save').click(); });
    const unr = await page.evaluate(() => __dlg('err').textContent);
    check('R7 page says "… ago" but FLOW cannot read it → asks for the Reported time (not set to now)', /could not read it — type the Reported time/.test(unr), unr);
    await page.keyboard.press('Escape');
  });

  /* 8 — same ship only when the IMOs agree; stale AIS row with a report says "Update position"; absurd synced times */
  await scenario(browser, 'R8 same ship + stale AIS', async (openT) => {
    const now = Date.now();
    const vs = scene(now);
    vs[1].mmsi = '538009850'; vs[1].imo = '9448827';        // CMA CGM DAKAR typed with SEA VALIANT's MMSI by mistake
    vs[3].posRpt = { src: 'mst', lat: 24.9, lon: 57.2, sog: 9, at: iso(now - 20 * HR), updatedAt: now - 20 * HR };     // OCEAN PEARL: report older than its stale AIS fix
    vs[4].posRpt = { src: 'mst', lat: 24.9, lon: 57.2, at: 1e20, eta: -5, updatedAt: 1 };                            // absurd synced times
    const ais = aisData(now);
    ais.positions[0].position_time = iso(now - 8 * HR);
    const db = H.createDb({ workspace: U.seedPayload({ vessels: vs }), ais, realtime: false });
    const { page } = await openT(db, 'user-operator', { settleMs: 800 });
    await page.evaluate(() => { try { flowWelcomeGo('nominations'); } catch (e) {} showPage('nominations'); });
    await sleep(300);
    await page.evaluate(t => { __panel('n1').querySelector('.prpt-btn').click(); return new Promise(r => setTimeout(r, 100)).then(() => __paste(t)).then(() => __dlg('save').click()); }, mstPage(now));
    await sleep(700);
    check('R8 a card with the same MMSI but another IMO is another ship: not given the report', vOf(db, 'n1').posRpt && vOf(db, 'n3').posRpt && !vOf(db, 'n2').posRpt, [!!vOf(db, 'n2').posRpt]);
    // n3 (SEA VALIANT, IMO only) gets an MMSI and loses its IMO; saving from it: MMSI matches n1 (IMO 9420629) and n2 (IMO 9448827) → ambiguous
    await page.evaluate(() => { const id = __cid('n3'); document.getElementById('v' + id + '-imo').value = ''; document.getElementById('v' + id + '-mmsi').value = '538009850'; });
    const grp = await page.evaluate(() => _prSameShipCards(__cid('n3')).map(c => document.getElementById('vessel-' + c).dataset.nomUid));
    check('R8 from a card without an IMO whose MMSI matches two different IMOs: only that card', JSON.stringify(grp) === '["n3"]', grp);
    await page.evaluate(() => { showPage('dashboard'); renderDashAis(); });
    await sleep(300);
    const row = await page.evaluate(() => { const r = [...document.querySelectorAll('#dash-ais-body .ais-row')].find(x => x.querySelector('.ais-row-name').textContent === 'OCEAN PEARL'); return r ? { src: r.dataset.src || 'ais', txt: r.textContent } : null; });
    check('R8 stale live AIS newer than the report: AIS row, button says "Update position" (a report exists)', row && row.src === 'ais' && /Update position/.test(row.txt) && !/\+ Add last position/.test(row.txt), row);
    const n5 = await page.evaluate(() => { showPage('nominations'); return __cells('n5'); });
    check('R8 absurd synced times are ignored (no crash): no reported time, no ETA', n5['Reported'] === 'time not given' && n5['ETA'] === '—', n5);
  });

  await browser.close();
  console.log('Last known position: ' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
