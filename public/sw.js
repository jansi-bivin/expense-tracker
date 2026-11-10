// v2: pages are network-first. v1 served a saved page first, which after a deploy could
// ask for app files of the previous version that no longer exist ("Application error").
// Bumping the version also clears v1's saved pages on activate.
const CACHE_VERSION = 'v2';
const CACHE_NAME = `exptrack-${CACHE_VERSION}`;

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

const STATIC_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/icon-192.svg',
  '/icon-512.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  // Activate new SW immediately without waiting for old one to finish
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  // Take control of all open clients immediately
  self.clients.claim();
});

/** Keep a copy of a good response (never an error page). */
function remember(request, response) {
  if (response && response.ok) {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Skip non-GET and cross-origin requests (Supabase included): always network
  if (req.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Page loads: network-first, so the page always matches the deployed app files.
  // The saved copy is used only when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((response) => remember(req, response))
        .catch(() => caches.match(req).then((cached) => cached || caches.match('/')))
    );
    return;
  }

  // App files are content-hashed (a new deploy gets new names): cache-first is safe
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.match(/\.(svg|png|jpg|jpeg|webp|woff2?|ico)$/)
  ) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((response) => remember(req, response)))
    );
    return;
  }

  // Everything else (API routes, app data requests): network, saved copy only when offline
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
  }
});
