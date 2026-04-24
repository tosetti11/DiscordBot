// Self-destructing service worker — clears all caches and unregisters itself
// This ensures all users get fresh content without manual cache clearing

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => self.registration.unregister())
  );
});
