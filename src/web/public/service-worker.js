const CACHE_NAME = 'gk-cache-v8';
const ASSETS_TO_CACHE = [
  '/',
  '/style.css',
  '/app.js',
  '/TheGamblingKing.jpg',
  '/manifest.json'
];

// Install — cache core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network first (bypass HTTP cache), fallback to SW cache
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Only handle same-origin requests — skip external CDN/font URLs
  if (url.origin !== self.location.origin) {
    return;
  }

  // Don't cache API calls or auth routes
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
    return;
  }

  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
      .then(response => {
        // Cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
