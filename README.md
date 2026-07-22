# FLOW — Web App

This is the complete FLOW web app, ready to deploy as-is. All 5 files
must stay together in the same folder (they reference each other).

## Deploy to Vercel (recommended)

1. Push this folder's contents to a new GitHub repo (all 5 files at
   the repo root — no subfolder).
2. Go to vercel.com → sign in with GitHub → **Add New → Project**.
3. Select this repo.
4. Framework Preset: **Other**. Root Directory: leave as `.` (root) —
   don't set it to a subfolder this time, since these files already
   sit at the top level.
5. Click **Deploy**. You'll get a live URL in under a minute.

From then on, every push to this repo auto-redeploys.

## Deploy to GitHub Pages instead

1. Push this folder's contents to a GitHub repo.
2. Repo **Settings → Pages** → Source: **Deploy from a branch** →
   Branch: **main**, folder: **/ (root)** → Save.
3. Your live URL appears on that same settings page after ~1 minute.

## Files in here

- `index.html` — the entire app (all HTML/CSS/JS is inline in this
  one file — same file the Android APK is built from, so the two
  stay identical by construction).
- `manifest.json` — PWA metadata (name, icons, theme color).
- `service-worker.js` — caches the app shell for offline loading.
  Optional — the app works fully without it, this is a bonus.
- `icon-192.png` / `icon-512.png` — app icons for the PWA manifest.

## Keeping this in sync with the Android app

Both this repo and the Android APK project should be built from the
exact same `index.html`. Whenever you get an updated file, replace
`index.html` here (upload with the same filename to overwrite) AND
replace `docs/index.html` in your Android project repo — same file,
two places it needs to land.
