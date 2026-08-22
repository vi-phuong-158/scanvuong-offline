const CACHE = 'scanvuong-v1.0.2';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
));

self.addEventListener('activate', e => e.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('scanvuong-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));

// Cache first so the app opens instantly and works offline, then refresh the
// entry in the background so a newer build is picked up on the next load.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.match(req).then(cached => {
    const network = fetch(req).then(res => {
      if (res && res.ok && res.type !== 'opaque') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => cached || caches.match('./index.html'));
    // A cached hit is returned immediately below, but the refresh fetch above
    // must not be abandoned when the fetch event is otherwise done — without
    // waitUntil the service worker can be torn down mid-fetch, before the
    // cache is ever updated for the next load.
    if (cached) {
      e.waitUntil(network.catch(() => {}));
      return cached;
    }
    return network;
  }));
});
