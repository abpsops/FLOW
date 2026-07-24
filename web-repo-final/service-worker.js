/* FLOW — service worker
   Only caches the local app shell (HTML/CSS/JS/icons/manifest) so the app
   can still open offline. Everything else — Supabase sync calls, Google
   Fonts, the CDN libraries (XLSX, flatpickr, mammoth, Chart.js) — is left
   to pass straight through to the network, untouched, since caching those
   could serve stale libraries or break live cloud sync.

   Bump CACHE_VERSION whenever index.html / style.css / app.js change so
   returning users pick up the new build instead of a stale cached copy. */

const CACHE_VERSION = 'flow-shell-v1';

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

  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached); // offline: fall back to cache

      // Cache-first for instant loads, but refresh the cache in the background
      return cached || networkFetch;
    })
  );
});
