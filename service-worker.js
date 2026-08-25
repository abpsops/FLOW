/* FLOW — service worker
   Only caches the local app shell (HTML/CSS/JS/icons/manifest) so the app
   can still open offline. Everything else — Supabase sync calls, Google
   Fonts, the CDN libraries (XLSX, flatpickr, mammoth, Chart.js) — is left
   to pass straight through to the network, untouched, since caching those
   could serve stale libraries or break live cloud sync.

   Bump CACHE_VERSION whenever index.html / style.css / app.js change so
   returning users pick up the new build instead of a stale cached copy. */

const CACHE_VERSION = 'flow-shell-v2';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin GET requests for files in our app shell list.
  // Everything else (Supabase, fonts.googleapis.com, cdnjs, jsdelivr, etc.)
  // is ignored here and goes straight to the network as normal.
  const isSameOrigin = url.origin === self.location.origin;
  const isShellPath = APP_SHELL.some((p) => {
    const shellUrl = new URL(p, self.location.origin).pathname;
    return url.pathname === shellUrl || (p === './' && url.pathname === '/');
  });

  if (req.method !== 'GET' || !isSameOrigin || !isShellPath) {
    return; // let the browser handle it normally
  }

  // NETWORK-FIRST (not cache-first). This app has no hashed/versioned
  // filenames — index.html is the single, always-live entry point that
  // carries all of the app's logic — so serving a cached copy first
  // means a redeployed change silently doesn't show up until a second
  // reload. Worse: stale JS from before a deploy can end up running
  // against the current (newer) Supabase data shape, misreading state
  // like barge ROB as empty and then auto-saving that wrong "0" back up
  // as the new latest version — a corruption the app's own anti-zero-ROB
  // guard can't catch, since it only protects against an OLDER incoming
  // version, not a bad save made by stale-but-currently-running code.
  // Network-first means every online load — deploy or not — always runs
  // the current code against current data. The cache is now purely an
  // offline fallback, matching what this file's top comment says it's
  // for, and is refreshed on every successful online load.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req)) // offline: fall back to last cached copy
  );
});
