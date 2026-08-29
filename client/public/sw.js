// Service Worker for the Pneuma Sense PWA
// Provides offline capability by caching all app assets on first load.

// __BASE_URL__ is rewritten at build time (scripts/apply-base.mjs) so the
// deployed paths match Vite's base. Do not hand-edit the built copy.
const BASE = '__BASE_URL__';

// Bump this whenever the shell changes. `activate` deletes every cache whose
// name doesn't match, which is what evicts a stale precached index.html from
// browsers that installed an older build.
const CACHE_NAME = 'pretracheal-monitor-v2';

// On install, cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([BASE, BASE + 'index.html', BASE + 'manifest.json']);
    })
  );
  self.skipWaiting();
});

// On activate, clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Network-first strategy: try network, fall back to cache
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip chrome-extension and other non-http requests
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Network failed, try cache
        return caches.match(event.request).then((cached) => {
          return cached || new Response('Offline', { status: 503 });
        });
      })
  );
});
