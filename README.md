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
- `supabase_role_setup.sql` — database setup to run in the Supabase SQL
  Editor (roles)

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

## Vessel identifiers (IMO / MMSI)

Each nomination card has an **IMO** box and an **MMSI** box ("IMO Number /
MMSI \*" — at least one is wanted).

- **Rules:** IMO = 7 digits with a valid check digit, MMSI = 9 digits
  starting 2–7. "IMO 9321483", "IMO No. 9321483" and "MMSI: 636 012 345" are
  accepted. A wrong number turns red with the reason.
- **Missing ID:** with neither box valid the card says *"Add an IMO or MMSI
  number"* and its header badge says **ID missing** (otherwise "IMO ✓",
  "MMSI ✓" or both). The nomination is listed in Needs Attention and the bell
  (never a toast). Generate Schedule, Send Nomination Email and Generate Email
  warn once but never block.
- **Typing in the wrong box:** nine digits typed into the IMO box move to the
  MMSI box, and 7 digits in the MMSI box move to IMO when you leave it.
- **Older saved data:** a 9-digit MMSI saved in the IMO box by an older version
  shows in the MMSI box. The saved value itself stays in the IMO field, where
  older app versions still read it, until someone edits that card's IMO / MMSI
  boxes.
- **Look up:** opens VesselFinder / MarineTraffic for the IMO (or the vessel
  name) in a new tab, to copy the MMSI from.
- **Templates and e-mails:** calling-instruction templates (text and .docx)
  and the e-mail templates accept `{{IMO}}` and `{{MMSI}}`. The nomination and
  cancellation e-mails list both when filled in.
- **Import:** the import panel reads "IMO …" / "MMSI …" from the pasted text,
  also "IMO / MMSI: 9321483 / 636012345" and an "IMO/MMSI" column (7 digits go
  to IMO, 9 to MMSI). It has an MMSI column.
- **Search:** the global search finds a nomination by 3 or more digits of its
  IMO or MMSI.

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
