/* Cardio Briefing service worker.
 * - App shell: stale-while-revalidate (opens instantly, updates in the background).
 * - data/editions.json and data/<date>/edition.json: network-first (always fresh when online), cache fallback offline.
 * - MP3s: not intercepted at all (the browser streams them with Range requests; nothing stale is ever served).
 * - Security: only same-origin GET requests under this app's scope are handled or cached. Everything else
 *   (other origins, other repos on the same github.io origin, non-GET) passes straight through untouched,
 *   and only successful, non-redirected same-origin ('basic') responses are ever written to the cache.
 */
const VERSION = 'cb-v3';
const SHELL = VERSION + '-shell';
const DATA = VERSION + '-data';
const SHELL_FILES = [
  './', 'index.html', 'app.js', 'style.css', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES.map((u) => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Cache Storage is shared by every site on this github.io origin: only delete our own old 'cb-' caches.
    for (const k of await caches.keys()) if (k.startsWith('cb-') && !k.startsWith(VERSION + '-')) await caches.delete(k);
    await self.clients.claim();
  })());
});

const SCOPE_PATH = new URL(self.registration.scope).pathname;   // e.g. /cardio-briefing/

function cacheable(res) {
  return res && res.ok && res.type === 'basic' && !res.redirected && new URL(res.url).origin === location.origin;
}

async function networkFirst(req) {
  const cache = await caches.open(DATA);
  try {
    const res = await fetch(req, { cache: 'no-store' });
    if (cacheable(res)) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(event, req) {
  const cache = await caches.open(SHELL);
  const key = req.mode === 'navigate' ? 'index.html' : req;
  const hit = await cache.match(key, { ignoreSearch: true });
  const update = fetch(req, { cache: 'no-cache' }).then((res) => {
    if (cacheable(res)) cache.put(key, res.clone());
    return res;
  });
  if (hit) {
    event.waitUntil(update.catch(() => {}));
    return hit;
  }
  return update;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;               // never touch cross-origin requests
  if (!url.pathname.startsWith(SCOPE_PATH)) return;         // same origin but outside /cardio-briefing/: ignore
  const path = url.pathname.slice(SCOPE_PATH.length);
  if (/\.mp3$/i.test(path)) return;                       // let the browser handle audio directly
  if (path.startsWith('data/')) { event.respondWith(networkFirst(req)); return; }
  event.respondWith(staleWhileRevalidate(event, req));
});
