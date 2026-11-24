// Pozwala otworzyć aplikację także przy słabym internecie.
// Zawsze najpierw próbuje pobrać najnowszą wersję, kopię z pamięci używa tylko awaryjnie.
const CACHE = 'forma-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    // no-cache = zawsze sprawdź na serwerze, czy jest nowsza wersja
    fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }))
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
