/* Cardio Briefing service worker.
 * - App shell: network-first with a 3.5 s timeout, cache fallback offline (updates show on the next open).
 * - data/editions.json and data/<date>/edition.json: network-first (always fresh when online), cache fallback offline.
 * - MP3s: not intercepted at all (the browser streams them with Range requests; nothing stale is ever served).
 * - Security: only same-origin GET requests under this app's scope are handled or cached. Everything else
 *   (other origins, other repos on the same github.io origin, non-GET) passes straight through untouched,
 *   and only successful, non-redirected same-origin ('basic') responses are ever written to the cache.
 */
const VERSION = 'cb-v5';
const SHELL = VERSION + '-shell';
const DATA = VERSION + '-data';
const SHELL_FILES = [
  './', 'index.html', 'app.js', 'playlist.html', 'playlist.js', 'style.css', 'manifest.json',
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

/* App shell: network-first with a short timeout (fresh page/JS/CSS whenever online, so an update is seen on the
 * very next open), falling back to the cached copy when offline or the network is slow. */
async function shellNetworkFirst(event, req) {
  const cache = await caches.open(SHELL);
  const p = new URL(req.url).pathname;
  // Navigations to the app root share the cached index.html; other pages (playlist.html) are cached as themselves.
  const key = req.mode === 'navigate' && (p === SCOPE_PATH || p.endsWith('/index.html')) ? 'index.html' : req;
  const net = fetch(req, { cache: 'no-cache' }).then((res) => {
    if (cacheable(res)) cache.put(key, res.clone());
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, 3500, null));
  try {
    const res = await Promise.race([net, timeout]);
    if (res) return res;
  } catch { /* offline: fall back to cache */ }
  const hit = await cache.match(key, { ignoreSearch: true });
  if (hit) { event.waitUntil(net.catch(() => {})); return hit; }
  return net;
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
  event.respondWith(shellNetworkFirst(event, req));
});
