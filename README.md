# FLOW — Web App (PWA)

The complete FLOW web app, installable as a Progressive Web App. All
files must stay together at the repo root (they reference each other
with relative paths) — do not nest them in a subfolder.

## Files
- `index.html` — the app itself (points at the production Supabase
  project `siqntfkpdstikrqffmep`)
- `manifest.json` — PWA metadata (name, icons, theme color)
- `service-worker.js` — caches the app shell (network-first) and the
  exact-version-pinned CDN libraries (cache-first) so the app can open
  offline; Supabase calls and Google Fonts always go straight to the network
- `vercel.json` — security headers (Content-Security-Policy etc.) and the
  SPA rewrite
- `icon-192.png`, `icon-512.png` — app icons for install/home screen
- `supabase_role_setup.sql`, `supabase_ais_setup.sql` — database setup to run in
  the Supabase SQL Editor (roles; live vessel positions)
- `supabase/functions/ais-poll/index.ts` — the Supabase Edge Function that
  collects live vessel positions (deployed to Supabase, not part of the website;
  see "Live vessel positions (AIS)" below)

## Deploy to Vercel

1. Push this folder's contents to a GitHub repo — all files at the
   repo root, no subfolder.
2. vercel.com → sign in with GitHub → **Add New → Project**.
3. Select this repo. Framework Preset: **Other**. Root Directory: `.`
4. Deploy. Every future push to this repo auto-redeploys.

## Notes
- This is also the exact file set that should be mirrored into the
  Android project's `www/` folder (`flow-apk-project-fixed/flow-apk/www/`
  in `FLOW---ANDROID`) so the two never drift out of sync. That copy is
  NOT an offline fallback: the Android app loads the live deployed URL
  via `capacitor.config.ts` (`server.url`), and Capacitor never falls
  back to the bundled `www/` when that URL is unreachable. Offline launch
  relies on the service worker cache (app shell + pinned CDN libraries).
- Because the app loads the live URL, once this is live on Vercel no
  separate Android rebuild is needed for content changes — only for
  native-level changes (permissions, icons, app version).
- `vercel.json` sets a Content-Security-Policy. Any NEW external origin
  (a CDN, API, font or image host, iframe source) must be added to the
  matching directive there (`script-src`, `connect-src`, `frame-src`…),
  or the browser will block it. CDN libraries must use exact-version
  URLs (e.g. `@2.117.3`, not `@2`) so they are cacheable offline;
  supabase-js and EmailJS also carry SRI `integrity` hashes, which must
  be recomputed when bumping their versions.

## Live vessel positions (AIS)

FLOW can show where each nominated vessel is right now — distance to its
anchorage / berth, speed, an AIS-based arrival estimate, and a warning when
that estimate is well after the nominated ETA or after the laycan closes.

**How it works.** Positions come from [aisstream.io](https://aisstream.io)
(free). The aisstream API key must never be in the app, so a small Supabase
**Edge Function** (`supabase/functions/ais-poll/index.ts`) collects the
positions on the server every 10 minutes and stores them in two tables
(`ais_positions`, `ais_status`). Each call is answered at once and the
function then listens to aisstream for about 90 seconds in the background.
The app only reads those tables (on login, every 2 minutes while open, and
instantly via Realtime) — it never sees the key and never changes the shared
workspace. Until this is set up, operators see "Live positions not set up
yet" on the dashboard and traders see nothing.

> **Already set this up before?** Run `supabase_ais_setup.sql` again (it
> only adds one column, `ais_status.last_cron_at`; nothing else changes) and
> deploy the function again (step 4: paste the new `index.ts`, or
> `supabase functions deploy ais-poll --no-verify-jwt`). The function must be
> redeployed for the nomination card's **MMSI** box (and labelled values such
> as "IMO No. 9321483") to be used — until then it still finds ships by IMO /
> name, and by an MMSI typed into the IMO box. Deploy it together with the
> app (or first).

### Set it up (about 15 minutes, once)

1. **Get an aisstream.io API key.** Go to <https://aisstream.io>, sign in
   (e.g. with a GitHub account), open **API Keys**, create a key and copy it.
2. **Create the tables.** Supabase Dashboard → **SQL Editor** → New query →
   paste all of [`supabase_ais_setup.sql`](supabase_ais_setup.sql) → **Run**.
   (Run `supabase_role_setup.sql` first if you never did — it defines the
   roles this file uses.) Safe to run again.
3. **Add two secrets.** Dashboard → **Edge Functions** → **Secrets** (in some
   dashboards: Project Settings → Edge Functions) → add:
   - `AISSTREAM_API_KEY` = the key from step 1
   - `AIS_CRON_SECRET` = any long random text you make up (30+ letters and
     digits, no spaces). Keep it — step 5 needs the same value.
4. **Deploy the function** — either way works:
   - *Dashboard (no tools needed):* Edge Functions → **Deploy a new function**
     → **Via Editor** → name it exactly `ais-poll` → delete the sample code →
     paste the whole of [`supabase/functions/ais-poll/index.ts`](supabase/functions/ais-poll/index.ts)
     → **Deploy**. Then open the function's **Details / Settings** and switch
     **"Enforce JWT verification"** (newer dashboards: "Verify JWT with legacy
     secret") **OFF** → Save.
   - *Command line:* `supabase login`, `supabase link --project-ref siqntfkpdstikrqffmep`,
     then `supabase functions deploy ais-poll --no-verify-jwt`.

   **JWT verification stays OFF — on purpose.** The function checks every
   call itself and only accepts (a) the scheduler, which sends the header
   `x-cron-secret: <AIS_CRON_SECRET>`, or (b) a signed-in FLOW account whose
   role is `operator` (the app's **Refresh now** button sends that person's
   own login token). Everything else gets 401/403. With verification ON,
   Supabase turns calls away before they reach the function: the scheduled
   call fails silently, and Refresh now says *"Supabase refused the request
   before ais-poll ran — “Verify JWT” is probably still ON"*.
5. **Run it every 10 minutes.** Dashboard → **Integrations** → **Cron**
   (enable it if asked — this switches on the `pg_cron` extension) →
   **Create job**:
   - Name `ais-poll-every-10-min`, Schedule `*/10 * * * *`
   - Type **Supabase Edge Function**, Method **POST**, Function **ais-poll**
   - HTTP header: `x-cron-secret` = the same value as `AIS_CRON_SECRET`
   - Body `{}`; the default timeout is fine (the function answers within a
     second and keeps collecting in the background for ~90 s).

   If the dashboard asks for the **pg_net** extension, enable it under
   Database → **Extensions** (search "pg_net"). Prefer SQL? Section 5 of
   `supabase_ais_setup.sql` has the same job as a `cron.schedule(...)` call
   (it needs both `pg_cron` and `pg_net` enabled under Database → Extensions).
6. **Check it works — both ways in:**
   - *By hand:* open FLOW as an operator → Dashboard → **Vessel Positions
     (AIS)** → **Refresh now**. After about 1 minute you get "Live positions
     updated — X of Y nominated vessels seen" and the list fills; each
     nomination card shows a "Live position (AIS)" line.
   - *The schedule:* this is a separate path, so check it too. **Don't press
     Refresh now** again; wait until a minute or two after the next 10-minute
     mark (…:10, …:20, …) and reload FLOW. The card header must say **"last
     scheduled call N min ago"** with N under 10. Every scheduled call is
     recorded the moment it arrives — also when it is skipped because your
     by-hand run is still going or finished less than 2 minutes earlier — so
     this works right after the by-hand check. (Or in the SQL Editor:
     `select last_cron_at, last_run_at, ok, found, error from ais_status;` —
     `last_cron_at` must move every 10 minutes; `last_run_at` follows about
     1 minute later whenever a run actually happened.) If it doesn't move:
     Edge Functions → ais-poll → **Invocations** shows each call's status —
     **202** = a run started; **200** = skipped because a run was still going
     or had just finished (normal right after Refresh now); **401** = the
     `x-cron-secret` header is missing / wrong, or JWT verification is still
     ON — and **Logs** shows the reason ("rejected 401: Invalid cron
     secret"). Note: Integrations → Cron → History says "Succeeded" even for
     a 401 — it only means the request was sent.
   - From then on FLOW keeps an eye on it: operators see "Automatic updates
     seem to have stopped" under the card title when no scheduled call has
     arrived for 25 minutes, and "Last update failed: …" when a run failed.

### What you see

- **Where the vessel is now:** each line shows the last AIS position
  (📍 rough sea area + coordinates, linking to OpenStreetMap), the **nm left**
  to the nomination's anchorage (straight line — the sea route can be longer),
  the speed and the expected arrival: **AIS arrival ~…** when the ship is
  heading for the port, or **at current speed ~…** when it is more than
  150 nm out and its course doesn't point at the port yet (no warnings are
  raised from that one). Each run takes about 1 minute; with MMSIs known
  most of it is spent searching worldwide, so ships far from Fujairah are
  found too (wherever aisstream.io has coverage).
- **Matching:** each nomination card has an **IMO** box and an **MMSI** box
  ("IMO Number / MMSI \*" — at least one is wanted). The MMSI is tried first
  (the ship is then found anywhere in the world on the next run), then the
  IMO (linked to the ship's MMSI from its static data). A 9-digit MMSI saved
  in the IMO box by an older version shows in the MMSI box; the saved value
  itself stays in the IMO field (where older app versions still read it)
  until someone edits that card's IMO / MMSI boxes. Neither → the vessel name is used
  (upper-case, spaces collapsed, an "MV"/"M/V"/"MT" prefix ignored, compared
  on the first 20 characters because AIS only carries 20) and the line says
  **matched by name** — check it is the right ship.
- **IMO / MMSI on the card:** IMO = 7 digits with a valid check digit, MMSI =
  9 digits starting 2–7; "IMO 9321483", "IMO No. 9321483", "MMSI: 636 012
  345" are accepted (the card, the app's live-position matching and the
  ais-poll function read them the same way). A wrong
  number turns red with the reason; with neither box valid the card says
  *"Add an IMO or MMSI so FLOW can track the vessel"*, its header badge says
  **ID missing** (otherwise "IMO ✓", "MMSI ✓" or both), and the nomination is
  listed in Needs Attention and the bell (never a toast). Generate Schedule,
  Send Nomination Email and Generate Email warn once but never block. Nine
  digits typed into the IMO box move to the MMSI box (and 7 digits in the
  MMSI box move to IMO when you leave it). **Look up** opens VesselFinder /
  MarineTraffic for the IMO (or the vessel name) in a new tab, to copy the
  MMSI from. Calling-instruction templates (text and .docx) and the e-mail
  templates accept `{{IMO}}` and `{{MMSI}}`; the nomination / cancellation
  e-mails list both when filled in. The import panel reads "IMO …" /
  "MMSI …" from the pasted text (also "IMO / MMSI: 9321483 / 636012345" and
  an "IMO/MMSI" column — 7 digits go to IMO, 9 to MMSI) and has an MMSI
  column.
- **Status:** **Arrived** (within 5 nm of its anchorage/berth point and under
  1 kn, or AIS "at anchor"/"moored" within 8 nm) · **Approaching** (within
  60 nm) · **Underway** (further) · **Stale** (last position older than 6 h)
  · **Not seen** (no AIS position).
- **AIS arrival** = time of the last position + straight-line distance ÷
  speed — only for a ship that is really closing in: course within ±70° of
  the anchorage and at least 1 kn of its speed toward it. No estimate and no
  warning for a ship heading away, for one moving within 3 nm of the point
  (manoeuvring, or leaving after supply), or for one doing under 3 kn within
  15 nm (waiting / drifting at the OPL). **Amber**
  when the estimate is more than 2 h after the ETA (for a time frame such as
  "PM", after the END of the frame); **red "may miss laycan"** when it is
  after the laycan closes. Both also appear in the bell, Needs Attention and
  Command Center — one alert per nomination. Each level toasts once per
  session (amber, and again if it turns red), even if a borderline ship
  flips back and forth; the texts follow every new position.
- **AIS ETA / destination** are what the crew typed. The ship broadcasts its
  ETA in UTC without a year; FLOW shows it in local time (hover for the
  original).
- **Reference points** (approximate; change `AIS_REF_POINTS` in `index.html`
  if your usual spots differ): FUJ A Fujairah Anchorage 25.170 N 56.440 E ·
  FUJ B Fujairah Berth 25.200 N 56.380 E · KFK A Khor Fakkan Anchorage
  25.370 N 56.420 E · KFK B Khor Fakkan Berth 25.350 N 56.365 E.
- **Links:** "Open map" (MarineTraffic, by MMSI) and VesselFinder (by IMO, or
  MMSI) open in a new tab.
- **No update for 24 hours** (schedule removed, key revoked…): the
  per-vessel lines and warnings are hidden and operators see one note, "AIS
  feed not updating since …"; traders see nothing. Everything comes back by
  itself on the next successful run.

### Limitations

- aisstream.io is built from volunteer **shore-based** receivers: ships near
  the coast are seen, ships in the open ocean often are not (no satellite
  AIS). Only ships that switch their AIS on are visible.
- Positions are at best about **10 minutes** old (the schedule) — the app
  says "seen N min ago". A ship that hasn't been heard for 6 h shows as Stale.
- A nomination entered with an **IMO** is linked to its MMSI from the ship's
  static data, which it broadcasts every ~6 minutes, so a new or far-away
  ship can take a few runs to appear. Once linked it is remembered for as
  long as the vessel is nominated.
- The distance is a **straight line**: for ships coming around Musandam from
  inside the Gulf the arrival estimate is optimistic. AIS destination / ETA
  are typed by the crew and are often out of date.
- The anchorage / berth points are approximate. At most 50 ships are
  followed worldwide per run (the nearest area is always fully covered).
- Free-plan friendly: one connection per run (~90 s; a run is shortened when
  the function instance is already part-way through its 150 s limit, and
  whatever was collected is saved if the platform stops it early) and
  messages about other ships are filtered without being decoded, to stay
  within the 2 s CPU limit. If aisstream drops the connection the function
  reconnects once; the card then says "Last update incomplete: …". Optional
  secrets `AIS_PHASE_A_SECONDS` (65), `AIS_PHASE_B_SECONDS` (25) and
  `AIS_REGION_BOX` (`22,54,27.5,60.5`) tune a run.

### Switching it off

- **Pause:** delete the cron job (Integrations → Cron). After 24 h without an
  update FLOW hides the positions; operators keep a small "AIS feed not
  updating" note on the dashboard card.
- **Remove completely:** delete the cron job and the `ais-poll` function, then
  run `drop table if exists public.ais_positions, public.ais_status;` in the
  SQL Editor. Operators then see only "Live positions not set up yet" on the
  dashboard card; traders see nothing; everything else in FLOW is unaffected.

## Tests
- `tests/` holds a browser test suite (Playwright, headless Chromium) that
  loads `index.html` against a **fake** Supabase — the real project is never
  contacted. See [`tests/README.md`](tests/README.md) for what it covers and
  how to run it: `cd tests && npm ci && npx playwright install chromium && npm test`.
- GitHub Actions (`.github/workflows/test.yml`) runs it on every push and
  pull request; a red X on a commit means a test failed (logs are attached to
  the run).
- `tests/` and `.github/` are development-only (and `supabase/` is server code):
  `.vercelignore` keeps them off the live site, and they should not be copied
  into the Android `www/` folder.
