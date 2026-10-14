/* Import nomination — the rule-based text parser (_parseNominationText) run
   inside the real app page against realistic broker / WhatsApp / Excel text.
   "Today" is pinned to 14 Oct 2026 09:00 so relative dates are deterministic.
   node suites/nominations/parse.test.js [appDir] */
const H = require('../../harness/harness.js');
const appDir = process.argv[2] || H.APP_DIR;

let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) pass++; else fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 500)));
}
const AGENTS = ['Gulf Agency Company (GAC)', 'Inchcape Shipping Services', 'Wilhelmsen Ships Service', 'Sharaf Shipping Agency'];

// [name, text, expected drafts (partial: only listed fields are compared), extra(drafts) checks]
const SAMPLES = [
  ['S1 broker email', `From: ops@brokerx.com
Subject: Bunker Nomination - MV OCEAN PRIDE / Fujairah

Dear Team,

Please find below nomination:

Vessel: MV OCEAN PRIDE (IMO 9321483)
ETA: 14/10/2026 0600LT
Laycan: 14-16 Oct 2026
Port: Fujairah Anchorage
Grade/Qty: VLSFO 0.5% 500-600 MT
           LSMGO 0.1% 50 MT
Spec: ISO 8217:2017
Agent: Gulf Agency Company
Remarks: Vessel to provide PAQ 24 hrs prior.

Best regards,
John Smith
Bunker Desk`, [{ name: 'OCEAN PRIDE', imo: '9321483', eta: '14 Oct 2026 06:00', lc: '14-16 Oct 2026', type: 'BOTH', qty: 600, qtyMin: 500, qtyMax: 600, mgo: 50, mgoMin: null, area: 'FUJ-A', spec: 'ISO 8217:2017', agent: 'Gulf Agency Company (GAC)', remarks: 'Vessel to provide PAQ 24 hrs prior.' }],
  d => d[0].low && Object.keys(d[0].low).length === 0 && !/John|Bunker Desk|Dear/.test(d[0].remarks)],

  ['S2 WhatsApp one-liner', 'MV SEA BREEZE 500/600 VLSFO + 50 MGO ETA 15/1800 KFK A agent inchcape',
    [{ name: 'SEA BREEZE', eta: '15 Oct 2026 18:00', type: 'BOTH', qty: 600, qtyMin: 500, qtyMax: 600, mgo: 50, area: 'KFK-A', agent: 'Inchcape Shipping Services' }],
    d => !!d[0].low.eta], // month implied by "15/1800" → flagged

  ['S3 Excel table (tab separated)', 'Vessel\tIMO\tETA\tVLSFO\tLSMGO\tLocation\tAgent\nMV ALPHA STAR\t9074729\t16/10/2026 08:00\t800-900\t\tFUJ-A\tGAC\nMT BRAVO\t\t17-Oct-26 1400\t\t120\tKhor Fakkan\tWilhelmsen\nM/V CHARLIE\t\t18 Oct 2026 22:00\t1,200\t80\tFujairah berth\t',
    [{ name: 'ALPHA STAR', imo: '9074729', eta: '16 Oct 2026 08:00', type: 'VLSFO', qty: 900, qtyMin: 800, qtyMax: 900, area: 'FUJ-A', agent: 'Gulf Agency Company (GAC)' },
     { name: 'BRAVO', imo: '', eta: '17 Oct 2026 14:00', type: 'MGO', qty: 0, mgo: 120, area: 'KFK-A', agent: 'Wilhelmsen Ships Service' },
     { name: 'CHARLIE', eta: '18 Oct 2026 22:00', type: 'BOTH', qty: 1200, mgo: 80, area: 'FUJ-B' }]],

  ['S4 two vessels, blank-line separated', `MV OCEAN STAR - FUJ A
ETA 14/10 0600
VLSFO 500-600 / LSMGO 50

MT SEA LION - KFK
ETA 15th PM
MGO 100 mt
Agent: Wilhelmsen`,
    [{ name: 'OCEAN STAR', eta: '14 Oct 2026 06:00', qty: 600, qtyMin: 500, mgo: 50, area: 'FUJ-A', agent: '' },
     { name: 'SEA LION', eta: '15 Oct 2026 18:00', type: 'MGO', mgo: 100, area: 'KFK-A', agent: 'Wilhelmsen Ships Service' }],
    d => !!d[1].low.eta && !d[0].low.eta],

  ['S5 "abt 500/600" range in a sentence', 'Pls nominate abt 500/600 mt vlsfo for MV GREEN HAWK eta 20 Oct 2026 0800 fujairah',
    [{ name: 'GREEN HAWK', eta: '20 Oct 2026 08:00', type: 'VLSFO', qty: 600, qtyMin: 500, qtyMax: 600, area: 'FUJ-A' }]],

  ['S6 IMO with a wrong check digit', 'Vessel: KAPPA (IMO 9321484)\nETA 18 Oct 2026 10:00\nVLSFO 300 MT',
    [{ name: 'KAPPA', imo: '9321484', qty: 300 }], d => /check digit/.test(d[0].low.imo || '')],

  ['S7 unlabelled 7-digit number accepted only if it is a valid IMO', 'MV LAMBDA 9074729 ETA 19 Oct 2026 0900 VLSFO 250 MT\nRef 1234567',
    [{ name: 'LAMBDA', imo: '9074729', qty: 250 }]],

  ['S8 missing fields', 'MV LONELY',
    [{ name: 'LONELY', eta: '', lc: '', qty: 0, mgo: 0, area: 'FUJ-A' }],
    d => !!d[0].low.eta && !!d[0].low.qty && !!d[0].low.area],

  ['S9 odd date formats', `MV DELTA ONE ETA: Oct 20, 2026 @ 2230 hrs VLSFO 400

MT ECHO
ETA 21.10.26 1400
LSMGO 80 MT

MV FOXTROT ETA 2026-10-22 06:30 250 mt VLSFO

MV GOLF eta 23rd Oct AM, 350mt vlsfo

MV HOTEL ETA 24-Oct-2026 / 1530 hrs 100 MT VLSFO

MV INDIA eta tomorrow 0600, 90 mt lsmgo`,
    [{ name: 'DELTA ONE', eta: '20 Oct 2026 22:30', qty: 400 },
     { name: 'ECHO', eta: '21 Oct 2026 14:00', mgo: 80 },
     { name: 'FOXTROT', eta: '22 Oct 2026 06:30', qty: 250 },
     { name: 'GOLF', eta: '23 Oct 2026 06:00', qty: 350 },
     { name: 'HOTEL', eta: '24 Oct 2026 15:30', qty: 100 },
     { name: 'INDIA', eta: '15 Oct 2026 06:00', mgo: 90 }],
    d => !!d[3].low.eta && !d[0].low.eta],

  ['S10 Khor Fakkan / Fujairah synonyms', `MV JULIET ETA 25 Oct 2026 0600 Location: Khor Fakkan Berth VLSFO 100

MV KILO ETA 25 Oct 2026 0700 at Khorfakkan anchorage VLSFO 100

MV LIMA ETA 25 Oct 2026 0800 Fujairah Anchorage A VLSFO 100

MV MIKE ETA 25 Oct 2026 0900 OPL Fujairah VLSFO 100

MV NOVEMBER ETA 25 Oct 2026 1000 FUJ-B VLSFO 100

MV OSCAR ETA 25 Oct 2026 1100 Fujairah oil terminal jetty VLSFO 100`,
    [{ name: 'JULIET', area: 'KFK-B' }, { name: 'KILO', area: 'KFK-A' }, { name: 'LIMA', area: 'FUJ-A' },
     { name: 'MIKE', area: 'FUJ-A' }, { name: 'NOVEMBER', area: 'FUJ-B' }, { name: 'OSCAR', area: 'FUJ-B' }],
    d => /OPL/.test(d[3].low.area || '') && /OPL/.test(d[3].remarks)],

  ['S11 hostile vessel name', 'Vessel: <img src=x onerror="window.__xss=1">PAPA\nETA 26 Oct 2026 0800\nVLSFO 100 MT\nRemarks: <script>window.__xss=2</script> fine',
    [{ name: 'PAPA', eta: '26 Oct 2026 08:00', qty: 100 }],
    d => !/[<>"]/.test(d[0].name)],

  ['S12 HSFO is not put in the VLSFO field; cbm flagged', 'MV QUEBEC\nETA 27 Oct 2026 0600\nIFO 380 3.5% 700 MT\nLSMGO 60 cbm',
    [{ name: 'QUEBEC', qty: 0, mgo: 60, type: 'MGO' }],
    d => /HSFO/.test(d[0].remarks) && !!d[0].low.qty && /cbm/.test(d[0].low.mgo || '')],

  ['S13 laycan only, quantity without grade, unlisted spec', 'MV ROMEO\nLaycan 20-22 Nov\nQty: 1,200 MT\nSpec: ISO 8217:2005',
    // No ETA given: planned from the first laycan day, flagged for checking.
    [{ name: 'ROMEO', eta: '20 Nov 2026 00:00', lc: '20-22 Nov 2026', qty: 1200, spec: 'ISO 8217:2010' }],
    d => /assumed VLSFO/.test(d[0].low.qty || '') && /2005/.test(d[0].low.spec || '') && /first laycan day/.test(d[0].low.eta || '')],

  ['S14 laycan across months; IFO 0.5% counts as VLSFO', 'MV SIERRA\nL/C 30 Oct - 2 Nov 2026\nIFO 0.5% 1000 mt',
    [{ name: 'SIERRA', lc: '30 Oct 2026 - 2 Nov 2026', qty: 1000 }], d => !d[0].low.qty],

  ['S15 pipe table', '| Vessel | ETA | VLSFO | MGO | Port |\n|---|---|---|---|---|\n| MV TANGO | 26/10/2026 1200 | 450 | 30 | Fujairah berth |\n| MV UNIFORM | 27/10/2026 | 500-550 | | KFK anchorage |',
    [{ name: 'TANGO', eta: '26 Oct 2026 12:00', qty: 450, mgo: 30, area: 'FUJ-B' },
     { name: 'UNIFORM', eta: '27 Oct 2026 00:00', qty: 550, qtyMin: 500, area: 'KFK-A' }],
    d => /no firm ETA/.test(d[1].low.eta || '')],

  ['S16 numbered list with a shared header (agent + location)', 'Dear all, pls see 2 noms for tomorrow, both at Fujairah anch, agent GAC\n\n1) MV VICTOR ETA 15/10 0800 VLSFO 300-350\n2) MT WHISKEY ETA 15/10 1600 LSMGO 60-80 MT',
    [{ name: 'VICTOR', eta: '15 Oct 2026 08:00', qty: 350, qtyMin: 300, area: 'FUJ-A', agent: 'Gulf Agency Company (GAC)' },
     { name: 'WHISKEY', eta: '15 Oct 2026 16:00', mgo: 80, mgoMin: 60, mgoMax: 80, type: 'MGO', agent: 'Gulf Agency Company (GAC)' }]],

  ['S17 "MT" as a unit never becomes a vessel', 'Qty 500 MT VLSFO for M/V XRAY HAWK, eta tomorrow 0600',
    [{ name: 'XRAY HAWK', qty: 500, eta: '15 Oct 2026 06:00' }]],

  ['S18 all-caps name line (no prefix) is a flagged guess', 'YANKEE WAVE\nETA 28 Oct 2026 0900\nVLSFO 600 MT\nFujairah',
    [{ name: 'YANKEE WAVE', qty: 600, area: 'FUJ-A' }], d => !!d[0].low.name],

  ['S19 year rolls over for an early-January ETA', 'MV ZULU ETA 3 Jan 0800 VLSFO 200 MT',
    [{ name: 'ZULU', eta: '03 Jan 2027 08:00' }]],

  ['S20 empty / no nomination', '   ', []],

  // A real trader fixture (names changed): "Name:" label on a vessel starting
  // with "On", dates as "6/8th Oct", a "6/7/8" list of days that is NOT a date,
  // a range, agent TBC, "2010 specs", and an account line for the remarks.
  ['S21 trader fixture with Name:/Dates:', `Acc: Acme Energy

Selling: Basis supply on 6/7/8 all dates as per our ops timing

FUJ Anch / VLSFO 0.5% / LSMGO 0.1% /2010 specs / GPS GTC / 30 DDD

Fixture details:
Name: On Horizon
Port: Fujairah
Dates: 6/8th Oct
Qty: Vlsfo 1400 to 1600 MT /Lsmgo 100 MT
Agents: TBC`, [{ name: 'ON HORIZON', lc: '6-8 Oct 2026', eta: '06 Oct 2026 00:00', type: 'BOTH', qty: 1600, qtyMin: 1400, qtyMax: 1600, mgo: 100, agent: '', spec: 'ISO 8217:2010' }],
    d => /Account: Acme Energy/.test(d[0].remarks) && /Agent TBC/.test(d[0].remarks) && !d[0].low.name && !d[0].low.agent && !/Fixture details|Name:|Dates:/.test(d[0].remarks)],
];

(async () => {
  const browser = await H.launch();
  const db = H.createDb();
  const app = await H.openApp(browser, db, { appDir, uid: 'user-operator' });
  const page = app.page;

  for (const [name, text, expect, extra] of SAMPLES) {
    const got = await page.evaluate(([t, ag]) => _parseNominationText(t, { now: new Date(2026, 9, 14, 9, 0), agents: ag }), [text, AGENTS]);
    const diffs = [];
    if (got.length !== expect.length) diffs.push('count ' + got.length + ' ≠ ' + expect.length);
    expect.forEach((e, i) => {
      const g = got[i] || {};
      Object.keys(e).forEach(k => { if (JSON.stringify(g[k]) !== JSON.stringify(e[k])) diffs.push(`#${i}.${k}: ${JSON.stringify(g[k])} ≠ ${JSON.stringify(e[k])}`); });
    });
    check(name, !diffs.length, diffs);
    if (extra) check(name + ' (flags / remarks)', extra(got), got.map(d => ({ low: d.low, remarks: d.remarks, name: d.name })));
  }

  // IMO check digit: real IMOs pass, one-digit typos fail
  const imo = await page.evaluate(() => [['9321483', '9074729', '9176187', '9811000'].map(_imoValid), ['9321484', '9074720', '932148', 'abcdefg', ''].map(_imoValid)]);
  check('IMO checksum accepts real numbers', imo[0].every(Boolean), imo[0]);
  check('IMO checksum rejects typos / junk', imo[1].every(x => !x), imo[1]);

  // Deterministic: same text + same "now" → same drafts
  // Screenshot-reading slips seen on a real fixture: superscript "th" read as
  // a quote, and "Vlsfo" read as "Visfo".
  const ocrFix = await page.evaluate(() => {
    const t = _niOcrClean('Name: On Peace\nDates: 6/8" Oct\nQty: Visfo 1400 to 1600 MT /Lsmgo 100 MT');
    return { t: t, d: _parseNominationText(t, { now: new Date(2026, 9, 14) })[0] };
  });
  check('OCR clean-up: 6/8" Oct and Visfo', /6\/8th Oct/.test(ocrFix.t) && /VLSFO 1400/.test(ocrFix.t) && ocrFix.d.lc === '6-8 Oct 2026' && ocrFix.d.qty === 1600 && ocrFix.d.qtyMin === 1400 && ocrFix.d.mgo === 100, ocrFix);
  const det = await page.evaluate(([t]) => JSON.stringify(_parseNominationText(t, { now: new Date(2026, 9, 14) })) === JSON.stringify(_parseNominationText(t, { now: new Date(2026, 9, 14) })), [SAMPLES[0][1]]);
  check('parser is deterministic', det);

  // Defaults come from the live app: the Agent Directory and the Anchorage dropdown
  const live = await page.evaluate(() => {
    const names = _activeAgents().map(a => a.name);
    const d = _parseNominationText('MV ALPHA ETA 20 Oct 2026 0800 VLSFO 100 Agent: ' + (names[0] || 'Nobody'), { now: new Date(2026, 9, 14) })[0];
    return { first: names[0] || '', agent: d.agent, low: d.low.agent || '', areas: AREA_OPTIONS.map(o => o.value) };
  });
  check('agent matched against the app\'s Agent Directory', !live.first || (live.agent === live.first && !live.low), live);
  const allAreas = await page.evaluate(() => _parseNominationText('MV A ETA 20 Oct 2026 0800 VLSFO 1 KFK B', { now: new Date(2026, 9, 14) })[0].area);
  check('location is always one of the dropdown values', live.areas.includes(allAreas), allAreas);
  check('no page script ran from hostile text', await page.evaluate(() => window.__xss === undefined));

  const errs = app.errors.filter(e => !/capacitorExports/.test(e));
  check('no page errors', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log(`parse.test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
