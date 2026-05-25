/* Game Vault — companion service worker.
 *
 * Why this file exists (it is the project's ONE allowed second file):
 * Chrome's beforeinstallprompt algorithm still requires a registered service
 * worker with a fetch handler, even though menu install no longer does. Without
 * it the in-page "Install as app" button can never fire a prompt on Android.
 *
 * Strategy: network-first so the deployed app is always fresh when online,
 * falling back to cache for offline launches. App data lives in
 * localStorage/IndexedDB and is untouched by this worker.
 */
const CACHE = 'game-vault-v1';
const CORE = ['./', './game-vault.html'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// A fetch handler is mandatory for Chrome's install prompt. Network-first with
// cache fallback keeps content current online and the app usable offline.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./game-vault.html')))
  );
});
