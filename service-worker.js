/* FLOW — service worker
   Two caches, so the installed app can open offline:

   1. App shell (HTML/manifest/icons) — NETWORK-FIRST, cache only as the
      offline fallback (see the long note in the fetch handler for why).
   2. CDN libraries (supabase-js, XLSX, flatpickr, mammoth, Chart.js, and
      the lazily loaded jsPDF/html2canvas/ExcelJS/JSZip/EmailJS…) — CACHE-
      FIRST, but ONLY for URLs pinned to an exact version (e.g.
      `@supabase/supabase-js@2.117.3/…` or `/ajax/libs/xlsx/0.18.5/…`).
      Those files are immutable, so a cached copy can never be stale. A
      floating URL (`@2`, `@latest`) is never cached — it goes to the network.

   Never cached: Supabase API / realtime / storage calls (live data, and
   signed URLs), Google Fonts, and anything else cross-origin — those pass
   straight through to the network untouched. Offline, the app falls back to
   system fonts.

   Bump CACHE_VERSION whenever index.html changes so returning users pick up
   the new build instead of a stale cached copy. LIB_CACHE only needs a bump
   if the caching rules for libraries change (its URLs are versioned). */

const CACHE_VERSION = 'flow-shell-v5';
const LIB_CACHE = 'flow-libs-v1';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

const LIB_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];
// `name@1.2.3/` (npm via jsdelivr) or `/1.2.3/` (cdnjs path segment).
const EXACT_VERSION_RE = /(@\d+\.\d+\.\d+(?:[-+][\w.]+)?\/)|(\/\d+\.\d+\.\d+(?:[-+][\w.]+)?\/)/;

function isPinnedLibrary(url) {
  return LIB_HOSTS.includes(url.hostname) && EXACT_VERSION_RE.test(url.pathname);
}

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
          .filter((key) => key !== CACHE_VERSION && key !== LIB_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// CACHE-FIRST for exact-version CDN libraries.
// Scripts tagged crossorigin="anonymous" (supabase-js with SRI, the cdnjs
// tags) are CORS requests: their responses are type 'cors' with a real
// status, so only res.ok is cached. A dynamically injected <script> without
// crossOrigin is a no-cors request whose response is 'opaque' (status
// hidden); that is the only way to cache it, and a pinned URL is immutable,
// so it is accepted for no-cors requests only. An opaque copy is never
// served to a CORS request — the browser would reject it (and SRI needs CORS).
function libraryResponse(req) {
  return caches.open(LIB_CACHE).then((cache) =>
    cache.match(req).then((cached) => {
      if (cached && !(req.mode === 'cors' && cached.type === 'opaque')) return cached;
      return fetch(req).then((res) => {
        const cacheable = res && (res.ok || (res.type === 'opaque' && req.mode === 'no-cors'));
        if (cacheable) cache.put(req, res.clone());
        return res;
      }).catch((err) => {
        if (cached) return cached; // last resort, e.g. opaque copy offline
        throw err;
      });
    })
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // let the browser handle it normally
  const url = new URL(req.url);

  if (isPinnedLibrary(url)) {
    event.respondWith(libraryResponse(req));
    return;
  }

  // Only handle same-origin GET requests for files in our app shell list.
  // Everything else (Supabase, fonts.googleapis.com, unpinned CDN URLs, etc.)
  // is ignored here and goes straight to the network as normal.
  const isSameOrigin = url.origin === self.location.origin;
  const isShellPath = APP_SHELL.some((p) => {
    const shellUrl = new URL(p, self.location.origin).pathname;
    return url.pathname === shellUrl || (p === './' && url.pathname === '/');
  });

  if (!isSameOrigin || !isShellPath) {
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
  // the current code against current data. The cache is purely an
  // offline fallback, and is refreshed on every successful online load.
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
