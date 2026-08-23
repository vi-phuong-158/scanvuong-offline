const CACHE = 'vigil-lens-v2.3.0';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './document-detector.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './assets/fonts/BeVietnamPro-Regular.woff2',
  './assets/fonts/BeVietnamPro-Medium.woff2',
  './assets/fonts/BeVietnamPro-SemiBold.woff2',
  './assets/fonts/BeVietnamPro-Bold.woff2',
  './assets/ml/doccornernet_lean.ort',
  './assets/ml/ort-wasm-simd-threaded.wasm',
  './assets/ml/ort-wasm-simd-threaded.mjs',
  './assets/ml/scanic-ort.wasm.min.js'
];

self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE).then(c => c.addAll(ASSETS))
));

// Allow the app to trigger activation via postMessage when user taps "Cập nhật"
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', e => e.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.filter(k => (k.startsWith('scanvuong-') || k.startsWith('vigil-lens-')) && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));

// Cache first so the app opens instantly and works offline, then refresh the
// entry in the background so a newer build is picked up on the next load.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(req, { ignoreSearch: true }).then(cached => {
        if (cached) {
          e.waitUntil(
            fetch(req).then(res => {
              if (res && res.ok && res.type !== 'opaque') {
                cache.put(req, res.clone());
              }
            }).catch(() => {})
          );
          return cached;
        }
        return fetch(req).then(res => {
          if (res && res.ok && res.type !== 'opaque') {
            cache.put(req, res.clone());
          }
          return res;
        }).catch(() => cache.match('./index.html'));
      })
    )
  );
});
