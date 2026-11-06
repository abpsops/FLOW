# FLOW source — how index.html is made

`index.html` (repo root) is the app that ships: Vercel, GitHub Pages, the
service worker and the Android app all use that one file. It is **built**
from the files in this folder:

```
node tools/build.js            # write index.html from src/
node tools/build.js --check    # is index.html exactly what src/ builds?
node tools/build.js --where N  # which src/ file and line is index.html line N
```

`src/index.html` is the page skeleton. Each line of the form

```
<!-- @include js/deals.js -->
```

is replaced by that file's contents, unchanged. Nothing is minified,
renamed or wrapped: the output is the plain concatenation, so index.html
looks and runs exactly as if it had been written by hand. Line numbers in
browser errors and test output are index.html lines; `--where` turns them
into a `src/` file and line.

## Rules

- **Edit here, then build.** Change the file in `src/`, run
  `node tools/build.js`, commit both the `src/` change and index.html. An
  edit made directly in index.html is caught by the `build` test suite
  (it names the `src/` file and line to make the change in).
- **All JavaScript still shares one global scope.** The files are pieces
  of the same `<script>` blocks they were cut from, so a function in
  `js/deals.js` can call one in `js/sync-save.js` exactly as before, and
  `onclick="…"` attributes keep working. Each `js/` file is whole
  statements (the tests parse every file on its own).
- **Order matters** as it always did: files are joined in the order of
  the include lines in `src/index.html`.
- Every file in `src/` must be included exactly once (a stray file is
  refused), and must end with a newline.

## Map

**Skeleton:** `index.html` — head (theme bootstrap, CDN libraries),
styles, body, pages, modals and the script blocks, in page order.

**Styles (`css/`)**

| File | What |
|---|---|
| `app.css` | the app's main stylesheet (Classic look, light/dark tokens, every page) |
| `skin-harbour.css` | the Harbour Light look |
| `login-gate.css` | the sign-in screen |
| `vessel-ids.css` | IMO / MMSI badges and the import table's ID columns |

**Markup (`html/`)**

| File | What |
|---|---|
| `welcome.html` | the welcome screen (paper boats) — includes `js/welcome.js` |
| `login-gate.html` | the sign-in form |
| `topbar.html`, `sidebar.html` | the header bar and the navigation |
| `pages/*.html` | one file per page: dashboard, nominations, schedule, loading, timeline, bargefleet, availability, deals, reports, commandcenter, checklist, records, bargetracking, deliverylog, archives, trash, alerts, agents |
| `modal-edit-record.html` | Saved Records → Edit |
| `modals-ops.html` | Bunker Message, ROB editor, typed confirmation, Reload quantity, BL quantity |
| `modal-calling-instructions.html`, `modal-email.html`, `modal-monthly-report.html` | the other dialogs |

**JavaScript (`js/`), in load order**

| File | What |
|---|---|
| `esc.js` | `esc()` — the one HTML-escape helper (loads first) |
| `welcome.js` | welcome-screen animation |
| `agents.js` | Agent Directory |
| `router.js` | `showPage()`, topbar menu, light/dark theme, Harbour/Classic switch |
| `search.js` | global vessel search |
| `dashboard.js` | dashboard, action queue, nomination / schedule KPIs |
| `reports.js` | Reports & Analytics page |
| `shell.js` | toasts, clocks, page hooks |
| `auth.js` | sign-in (Supabase Auth) |
| `roles-alerts.js` | trader / operator restrictions, the alerts bell |
| `nomination-email.js` | nomination e-mail notifications and logs |
| `sync-core.js` | build id, workspace row, Supabase helpers, status dot |
| `sync-merge.js` | three-way merge rules (per item, per key, bakes) |
| `sync-apply.js` | local snapshot, applying a pulled / merged state, keeping the cursor |
| `sync-save.js` | the single serialized save pipeline, trader save path |
| `sync-load.js` | sync warning / offline banners, pull-and-merge, first load |
| `loadings.js` | Loading page: terminal loadings, durations, conflicts |
| `deals.js` | Loading Deals: bulk purchases, BL quantity, drawdown |
| `loading-report.js` | Monthly loading report (Excel / PDF): per supplier, per date, each lifting |
| `barge-tracking.js` | Barge Tracking report uploads |
| `state.js` | `captureCurrentState()` / `applyState()`, force push / pull |
| `live-rob.js` | Live ROB engine, ROB summary and editor |
| `supply-tracker.js` | Remaining Supply Tracker, exports, Email to Barge, voyage PNG |
| `core.js` | UAE clock, constants, formatters, quantity ranges, ETA time frames |
| `bunker-quantity.js` | FY bunker quantity charts |
| `nomination-cards.js` | nomination card preview, undo delete |
| `vessel-ids-card.js` | IMO / MMSI boxes on the card |
| `import-parser.js` | nomination text parser and the IMO / MMSI rules |
| `import-nomination.js` | Import Nomination panel (paste / drop / OCR → review → add) |
| `planner.js` | `planSchedule()` and `calculate()` |
| `command-center.js` | Command Center wallboard |
| `barge-timeline.js` | barge timelines, Free Windows, the stock projection |
| `reload-planner.js` | stock forecast / reload planner, reload alerts, Plan this loading |
| `barge-blocks.js` | Unavailable blocks |
| `availability-check.js` | Availability Check engine |
| `split-supply.js` | split-supply recommendations |
| `nomination-actions.js` | saved checks, add from Availability, PAQ, reminders, Bunker Message, ETA mail |
| `checklist.js` | Supply Operations Checklist |
| `records.js` | Saved Records, Delivery Log, counterparty track record |
| `archives.js` | monthly archives, refresh of all modules |
| `duplicates.js` | duplicate nomination detection |
| `reports-export.js` | analytics download, Monthly Report, Excel export |
| `calendar.js` | weekly supply calendar, barge dropdowns, date pickers |
| `resets.js` | print, typed confirmation, Full Reset / Clear / Nuclear clear / Wipe Cloud |
| `calc-params.js` | calculation parameters, start-up |
| `calling-instructions.js` | calling-instruction templates (.docx / .txt) |
| `email-generator.js` | built-in e-mail templates per location |
