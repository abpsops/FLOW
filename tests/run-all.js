/* Runs the script syntax check + every browser suite, a few at a time.
   node run-all.js [filter...]      e.g.  npm test -- realtime   |   npm test -- r3- skin
   A suite runs when its name or file contains any filter word (case-insensitive).
   Env: APP_DIR (app to test, default the repository root), JOBS (parallel suites,
   default 3), SUITE_TIMEOUT_MIN (per-suite kill timer, default 15).
   Each suite's full output goes to tests/.out/<name>.log. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const APP_DIR = path.resolve(process.env.APP_DIR || path.join(ROOT, '..'));
const OUT = path.join(ROOT, '.out');
const JOBS = Math.max(1, parseInt(process.env.JOBS, 10) || 3);
const TIMEOUT_MS = (parseFloat(process.env.SUITE_TIMEOUT_MIN) || 15) * 60000;

// name, script (relative to tests/), what it covers (shown by --list)
const SUITES = [
  ['check-scripts', 'check-scripts.js', 'every inline <script> in index.html parses'],
  ['smoke', 'harness/smoke.js', 'operator + trader open every page with no errors'],
  ['r1-basics', 'suites/r1/t1.js', 'agents XSS/tombstones, dark theme tokens, login form, real CSP'],
  ['r2-dashboard-email', 'suites/r2/r2.test.js', 'dashboard escaping/KPIs, role lookup, offline launch, email logs'],
  ['r3-sync', 'suites/r3/sync.test.js', 'two operators + trader editing one workspace'],
  ['r3-rob', 'suites/r3/rob.test.js', 'barge ROB overrides, baking, reloads, scheduler'],
  ['r3-misc', 'suites/r3/misc.test.js', 'parsing/formatting, vessel removal, clear-all propagation'],
  ['r3-noise', 'suites/r3/noise.test.js', 'a clean pull causes no extra writes'],
  ['r4-schedule', 'suites/r4/test_r4.js', 'timeline, availability engine, checklist, notifications'],
  ['r5-data', 'suites/r5/r5_data.test.js', 'records, reports, archives, tombstones, dates'],
  ['r5-io', 'suites/r5/r5_io.test.js', 'docx templates, storage, Excel export, Supabase wipe'],
  ['fix', 'suites/fix/fix.test.js', 'reports KPIs, checklist dedupe, delivery-log tombstones, nuclear clear'],
  ['xss', 'suites/fix/xss.test.js', 'stored-XSS sweep over every page and modal'],
  ['records-edit', 'suites/fix/records-edit.test.js', 'edited saved records reach Monthly Report / Distributed chart / Reports: port filter scoped, actual vs nominated, archived copies, stale dialog, archive merge, supply date, duplicates, blank actual'],
  ['barge-colours', 'suites/fix/barge-colours.test.js', 'barge identity colours: palette, defaults, picker, sync, every screen, hostile values, fuel/status colours untouched'],
  ['rob-merge', 'suites/fix/rob-merge.test.js', 'barge ROB when two saves meet: a colleague\'s supply deducted once (different / same grade, save in flight), an emptied barge stays empty, merge rules'],
  ['records-bdn', 'suites/fix/bdn.test.js', 'Saved Supply Records → Edit: BDN numbers (VLSFO / LSMGO), change summary, list, XSS'],
  ['track-record', 'suites/fix/trackrecord.test.js', 'disputes only when marked, vessel names merged, watchlist details'],
  ['free-windows', 'suites/fw/fw.test.js', 'Free Windows planner calculations and exports'],
  ['sync-race', 'suites/fw/race.test.js', 'deletions survive a save racing a pull (forced interleavings)'],
  ['reload-planner', 'suites/reload/reload.test.js', 'stock forecast, breaches, reload-by, slot, Plan this loading, alerts'],
  ['planner-core', 'suites/planner/planner.test.js', 'planSchedule() is the exact planner calculate() always was (300 recorded random weeks) and is pure'],
  ['what-if-planner', 'suites/planner/sim.test.js', 'What-if sandbox equals the real planner for every kind of change, nothing saved or synced, look-ahead suggestions never worse + apply, limits, traders, phone'],
  ['skin', 'suites/skin/skin.test.js', 'Harbour Light / Classic look switch'],
  ['bunker-modal', 'suites/layout/bunker.test.js', 'Bunker Message opens from dashboard links'],
  ['layout-space', 'suites/layout/space.test.js', 'sidebar and activity feed fill the window'],
  ['realtime', 'suites/realtime/realtime.test.js', 'Supabase realtime sync, fallback polling, reconnect'],
  ['loose-ends', 'suites/realtime/loose.test.js', 'FY labels by year, Data Management typed confirmation'],
  ['nominations-parse', 'suites/nominations/parse.test.js', 'import parser: e-mail, WhatsApp, tables, ranges, IMO, dates, places'],
  ['nominations-import', 'suites/nominations/import.test.js', 'import panel: paste/drop → review → edit → add, duplicates, trader'],
  ['nominations-range', 'suites/nominations/range.test.js', 'quantity ranges: entry, displays, exports, planning max, sync'],
  ['nominations-ocr', 'suites/nominations/ocr.test.js', 'screenshot import with real Tesseract.js under the real CSP'],
  ['eta-timeframe', 'suites/nominations/timeframe.test.js', 'ETA / loading time frames (AM, PM…): card, schedule, sync, loading, parser'],
  ['sts-operations', 'suites/nominations/sts.test.js', 'STS tick on a nomination: stored only when ticked, merges between devices and via trader, gold fill on card / calendar / voyage / timeline / checklist / saved records, plan unchanged'],
  ['vessel-ids', 'suites/nominations/ids.test.js', 'IMO + MMSI on nominations: rules, card states, auto-move, look up, legacy move, sync, Needs Attention, warnings, placeholders, import'],
];

const args = process.argv.slice(2);
if (args.includes('--list')) {
  for (const [n, f, d] of SUITES) console.log(n.padEnd(20) + f.padEnd(36) + d);
  process.exit(0);
}
const filters = args.map(a => a.toLowerCase());
const chosen = SUITES.filter(([n, f]) => !filters.length || filters.some(w => n.toLowerCase().includes(w) || f.toLowerCase().includes(w)));
if (!chosen.length) { console.error('No suite matches: ' + args.join(' ') + '  (see node run-all.js --list)'); process.exit(2); }
if (!fs.existsSync(path.join(APP_DIR, 'index.html'))) { console.error('No index.html in ' + APP_DIR); process.exit(2); }

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

function runOne([name, file]) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const log = fs.createWriteStream(path.join(OUT, name + '.log'));
    const argv = file === 'check-scripts.js' ? [path.join(APP_DIR, 'index.html')] : [APP_DIR];
    const child = spawn(process.execPath, [path.join(ROOT, file), ...argv], {
      cwd: ROOT, env: Object.assign({}, process.env, { APP_DIR }), stdio: ['ignore', 'pipe', 'pipe'],
    });
    let tail = '', timedOut = false, buf = '', passed = 0;
    const keep = d => {
      log.write(d); const t = d.toString(); tail = (tail + t).slice(-4000);
      // count individual checks: suites print one "PASS …" / "  ok …" line per assertion
      buf += t; const ls = buf.split('\n'); buf = ls.pop();
      for (const l of ls) if (/^\s*(PASS|ok)\b/.test(l)) passed++;
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, TIMEOUT_MS);
    child.on('close', code => {
      clearTimeout(timer);
      const secs = (Date.now() - t0) / 1000;
      const last = tail.trim().split('\n').filter(Boolean).pop() || '';
      const ok = code === 0 && !timedOut;
      log.end((timedOut ? `\n[run-all] killed after ${TIMEOUT_MS / 60000} min\n` : '') + `\n[run-all] exit ${code} in ${secs.toFixed(1)}s\n`);
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} (${secs.toFixed(1)}s)`);
      resolve({ name, ok, code, secs, passed, last: timedOut ? 'timed out' : last });
    });
  });
}

(async () => {
  const t0 = Date.now();
  console.log(`Testing ${APP_DIR} — ${chosen.length} suite(s), ${JOBS} at a time; logs in ${path.relative(process.cwd(), OUT) || OUT}/`);
  const queue = chosen.slice(), results = [];
  await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
    while (queue.length) results.push(await runOne(queue.shift()));
  }));
  const order = new Map(chosen.map(([n], i) => [n, i]));
  results.sort((a, b) => order.get(a.name) - order.get(b.name));
  const w = Math.max(...results.map(r => r.name.length), 5);
  const total = (Date.now() - t0) / 1000;
  const lines = ['', 'SUITE'.padEnd(w) + '  RESULT  CHECKS  TIME     LAST LINE', '-'.repeat(w + 68)];
  for (const r of results) lines.push(r.name.padEnd(w) + '  ' + (r.ok ? 'pass' : 'FAIL').padEnd(6) + '  ' + String(r.passed || '-').padStart(6) + '  ' + (r.secs.toFixed(1) + 's').padEnd(7) + '  ' + r.last.replace(/\s+/g, ' ').slice(0, 110));
  const failed = results.filter(r => !r.ok);
  lines.push('-'.repeat(w + 68));
  lines.push(`${results.length - failed.length}/${results.length} suites passed in ${total.toFixed(1)}s` + (failed.length ? ` — FAILED: ${failed.map(r => r.name).join(', ')} (see .out/<suite>.log)` : ''));
  console.log(lines.join('\n'));
  fs.writeFileSync(path.join(OUT, 'summary.txt'), lines.join('\n') + '\n');
  process.exit(failed.length ? 1 : 0);
})();
