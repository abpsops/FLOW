# FLOW tests

Browser tests for `../index.html`. Each suite opens the real app in headless
Chromium (Playwright) and drives it the way a user would.

**They never touch the real Supabase.** The harness swaps supabase-js for a fake
(`harness/mock-supabase.js`) backed by an in-memory database in Node, with the
same row-level rules and RPCs as `supabase_role_setup.sql`, plus fake realtime
events. Several browser windows can share one fake database, so "two operators
and a trader at once" is testable. CDN libraries are served from the
exact-version npm packages in `package.json`; any other outside request is
blocked and fails the test.

## What's covered

| Suite | Checks |
|---|---|
| `check-scripts` | every inline `<script>` in index.html parses |
| `smoke` | operator and trader open every page with no errors |
| `r1-basics` | agents list escaping/deletion/copy, dark-theme colours, login form, the real `vercel.json` CSP |
| `r2-dashboard-email` | dashboard escaping and KPIs, role lookup, offline launch, nomination email logs |
| `r3-sync` | two operators + a trader editing one shared workspace |
| `r3-rob` | barge ROB overrides, baking, reloads, scheduler |
| `r3-misc` | parsing and formatting, removing vessels, clear-all reaching other devices |
| `r3-noise` | a plain refresh causes no extra cloud writes |
| `r4-schedule` | timeline, barge availability, checklist, notifications |
| `r5-data` | saved records, reports, archives, deletions, dates |
| `r5-io` | Word templates, storage, Excel export, Supabase wipe |
| `fix` | report totals, checklist duplicates, delivery-log deletions across devices, Nuclear clear |
| `xss` | hostile text in every field shows as text on every page and modal |
| `free-windows` | Free Windows planner maths and exports |
| `planner-core` | `planSchedule()` (the pure planner behind Generate) gives exactly the recorded plans for 300 seeded random weeks (barges, laycans, no-firm ETAs, time frames, ranges, refuels, pins, blocks, supplies, reloads) and never touches its inputs / the page. Re-record with `GOLDEN=write APP_DIR=<old app> node suites/planner/planner.test.js` only when the planner is changed on purpose |
| `what-if-planner` | What-if Planner sandbox: ETA / delay / exact time / quantity / cancel / pin / out-of-service / starting ROB / time-frame vessels each give exactly the plan the real cards give; nothing is saved, synced or stored; "Find a better plan" is never worse on shortfall, waiting or laycan, matches a brute force, pins reproduce the promised plan; Apply sets the real barge dropdowns and regenerates; limits (one barge, all pinned, 11 vessels), stale copies, odd input, hostile names, traders, phone |
| `sync-race` | a colleague's deletion never comes back when a save races a pull (forced interleavings; `RACE_ITER=n` repeats) |
| `fix-small` | Audit fixes (26 Oct): nomination import never hangs on a line starting with a rejected date-like token ("0.5% VLSFO…", "31/02"); a hand-picked barge never pins the Auto nominations (the remembered "preferred barge" is gone); a double-click on Save in the Reload dialog records one reload, negatives refused; "Save Parameters" keeps the manual ROB correction unless Opening ROB changed; barge Remove asks first and takes its ROB correction, baked ids, blocks and reloads with it |
| `sts-operations` | STS (ship-to-ship) tick on a nomination: saved only when ticked; survives reload, two-operator merge (tick + untick), the trader save path and trash/restore; carried onto the schedule, checklist row and saved record; whole card / pill / row filled green on the nomination card, Weekly Planned Supply, Voyage Schedule, Supply Timeline, Checklist, Saved Records and the What-if Planner; ticking after Generate updates them at once; the plan itself never changes; phone width + dark |
| `reload-planner` | Barge stock forecast + reload plan: forecast equals Free Windows' stock/ATP, first breach per grade, reload-by = job start − travel − contingency, quantity to the next planned loading (rounded to 50, capped at tank room), slot around jobs and Unavailable blocks, no-slot → reassign + barges with stock, ranges plan the max, completed jobs out, Plan this loading pre-fills the Loading form (nothing saved until Add; then syncs to a 2nd device), trader view, dashboard alerts, hostile names, Harbour/Classic/phone (`SHOTS_DIR=…` saves screenshots) |
| `skin` | Harbour Light / Classic look switch |
| `bunker-modal` | Bunker Message opens from dashboard links |
| `layout-space` | sidebar and activity feed fill the window |
| `realtime` | instant sync between devices, polling fallback, reconnect, logout |
| `loose-ends` | FY labels follow the year, Danger zone typed confirmation |
| `nominations-parse` | Import nomination parser on 20 realistic samples (broker e-mail, WhatsApp, Excel/pipe tables, several vessels, ranges, IMO check digit, odd dates, Fujairah/Khor Fakkan synonyms, hostile names) |
| `nominations-import` | Import nomination panel: keyboard, paste/drop text or image → Read → review → edit → Add; nothing saved before Add; duplicates; validation; trader import; second device |
| `nominations-range` | Quantity ranges (500–600 MT): card entry/validation, every display and export, scheduler/availability/free windows plan the max, checklist in-range check, sync/trader/trash, legacy vessels unchanged |
| `nominations-ocr` | Screenshot import with the real Tesseract.js (WebAssembly worker) under the real `vercel.json` CSP, on PNGs rendered in the test |
| `eta-timeframe` | ETA / loading time frames (AM, PM…) on cards, schedule, sync, loading and the parser |
| `vessel-ids` | IMO + MMSI on nominations: check digit / MMSI rules, "IMO …" normalising, red / amber states and messages, header badge, auto-move between the boxes (keyboard), Look up links (validated digits or encoded name only), legacy 9-digit MMSI in the IMO box (and "IMO No. …") shown in the right box but saved back unchanged until that card's ID boxes are edited — no write, and an older build's save cannot lose it, capture only when set, two operators + merge + trader RPC + trash, Needs Attention + bell keyed per nomination (no toasts, also for traders), non-blocking warnings on Generate Schedule / Send Nomination Email / Generate Email, e-mail + calling-instruction `{{IMO}}` / `{{MMSI}}` (text and .docx), global search, import parser (incl. "IMO / MMSI: 9321483 / 636012345" and an IMO/MMSI column) + MMSI review column + add, Harbour / Classic / 390 px, hostile text (`SHOTS_DIR=…` saves screenshots) |

## Run locally

Needs Node 18+ (CI uses 22).

```sh
cd tests
npm ci
npx playwright install chromium
npm test
```

A full run takes about 3–4 minutes (three suites at a time). Each suite's full
output is written to `tests/.out/<suite>.log`, and a summary table is printed at
the end. The exit code is non-zero if anything fails.

- One suite, or a few: `npm test -- realtime` or `npm test -- r3- skin`
  (matches suite names and file paths). `node run-all.js --list` shows them all.
- A single file directly: `node suites/r3/sync.test.js` (optional first
  argument: a different folder containing an `index.html`).
- `JOBS=1 npm test` runs one suite at a time (slower machines);
  `APP_DIR=/some/other/copy npm test` tests another copy of the app.
- Chromium: Playwright's own download by default. `PLAYWRIGHT_BROWSERS_PATH`
  points Playwright at an existing browser folder; `CHROMIUM_PATH` uses a
  specific Chrome/Chromium executable.

GitHub Actions runs `npm test` on every push and pull request
(`.github/workflows/test.yml`); on failure the logs are attached to the run as
`test-logs`.

## Add a test

1. Add a file under `suites/<area>/`, e.g. `suites/r3/my-thing.test.js`:

   ```js
   const H = require('../../harness/harness.js');
   (async () => {
     const browser = await H.launch();
     const db = H.createDb(); // empty shared workspace; see createDb() for options
     const app = await H.openApp(browser, db, { uid: 'user-operator' }); // appDir defaults to the repo root
     const ok = await app.page.evaluate(() => typeof showPage === 'function');
     console.log((ok ? 'PASS ' : 'FAIL ') + 'app loaded');
     const errs = app.errors.filter(e => !/capacitorExports/.test(e));
     await browser.close();
     process.exit(ok && !errs.length ? 0 : 1);
   })().catch(e => { console.error(e); process.exit(2); });
   ```

   Print one `PASS …` / `FAIL …` line per check and exit non-zero on failure.
   `suites/r3/util.js` has helpers for multi-device tests (`seedPayload`,
   `check`, `open`, `row`, `writes`); the top of `harness/harness.js` documents
   the fake database (`db.intercept` to simulate failures, `readPolicy`,
   `realtime`, `beforeLoad`, `csp`, …).
2. Register it in the `SUITES` list at the top of `run-all.js`.
3. If index.html starts loading a new CDN library, add the npm package at the
   same exact version to `package.json` and a line to `CDN_MAP` in
   `harness/harness.js` — otherwise the request is blocked and tests fail.
   (Tesseract.js is an example: the library, its worker, the WebAssembly core
   and the English model are all pinned devDependencies mapped in `CDN_MAP`.)
