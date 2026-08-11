# FLOW — Web App (PWA)

The complete FLOW web app, installable as a Progressive Web App. All
files must stay together at the repo root (they reference each other
with relative paths) — do not nest them in a subfolder.

## Files
- `index.html` — the app itself (points at the production Supabase
  project `siqntfkpdstikrqffmep`)
- `manifest.json` — PWA metadata (name, icons, theme color)
- `service-worker.js` — caches the app shell for offline load;
  Supabase calls and CDN libraries always go straight to the network
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
  in `FLOW---ANDROID`) as the offline fallback bundle, so the two never
  drift out of sync.
- The Android app itself loads this live deployed URL directly via
  `capacitor.config.ts` (`server.url`), so once this is live on
  Vercel, no separate Android rebuild is needed for content changes —
  only for native-level changes (permissions, icons, app version).
