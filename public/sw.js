/* Phase 31: offline shell. Plain JS (not bundled). Same-origin GET only; nothing from the owner's content is fetched from a server anyway.
   - the page (navigations): network first, fall back to the saved copy, so a new deploy shows up when the network is good
     and a weak or missing connection still opens the card;
   - /assets/* (hashed, so never stale): saved on first use, then served from the saved copy;
   - everything else same-origin: network first, saved copy as the fallback. */
const CACHE = 'winterlight-v1';
const SHELL = ['./'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

async function networkFirst(req, key) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(key, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(key)) || (await cache.match('./'));
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('.mp3')) return; // the music is streamed in ranges; leave it to the browser
  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req, './')); // every ?view and ?query opens the same page
    return;
  }
  if (url.pathname.includes('/assets/')) {
    e.respondWith(cacheFirst(req));
    return;
  }
  e.respondWith(networkFirst(req, req));
});
