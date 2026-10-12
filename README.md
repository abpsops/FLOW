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
