// PHOENIX SERVICE WORKER — v4.9.208
//
// This file was ZERO BYTES. Registration in index.html was already complete and
// correct — update polling, skipWaiting, controllerchange reload, the lot — but
// it was registering an empty script, so nothing installed a fetch handler and
// nothing ever reported a new version. Jon is remote and cannot `git pull`, so
// in practice he could not receive a deploy at all without deleting the PWA and
// reinstalling it.
//
// STRATEGY — network-first for the app shell, cache as the fallback.
// The usual PWA advice is cache-first for speed, and it is wrong here: this app
// ships several times a day and the cost of showing a stale build is that Jon
// draws a dose from an out-of-date protocol. Freshness beats a 200ms saving.
// Offline still works — the cache answers when the network does not.
//
// SW_VERSION must match APP_VERSION in index.html. A harness assertion enforces
// it, because a service worker pinned to a stale version is exactly the kind of
// silent drift that would make this whole mechanism lie.
const SW_VERSION = '4.9.280';
const CACHE = 'phoenix-v' + SW_VERSION;

// Only same-origin static assets are cached. Supabase, the coach worker, tiles
// and fonts are never cached — a cached API response would be worse than no
// cache at all, and a cached auth response would be a security problem.
const SHELL = ['./', './index.html', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // addAll fails the whole install if any single entry 404s, which would leave
    // the old worker in place forever. Add individually and tolerate misses.
    await Promise.all(SHELL.map(async (url) => {
      try { await cache.add(new Request(url, { cache: 'reload' })); } catch (_e) {}
    }));
    // Take over as soon as installed rather than waiting for every tab to close.
    // index.html's registration already handles the reload that follows.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter(n => n.startsWith('phoenix-v') && n !== CACHE)
           .map(n => caches.delete(n))
    );
    await self.clients.claim();
    // Tell every open tab which version is now live. index.html compares this
    // against its own APP_VERSION and reloads only on a genuine change.
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach(c => {
      try { c.postMessage({ type: 'SW_UPDATED', version: CACHE }); } catch (_e) {}
    });
  })());
});

// index.html posts this when it finds a waiting worker.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'GET_VERSION') {
    try { event.source.postMessage({ type: 'SW_VERSION', version: SW_VERSION }); } catch (_e) {}
  }
});

function isShell(url) {
  return url.pathname.endsWith('/') ||
         url.pathname.endsWith('/index.html') ||
         url.pathname.endsWith('/manifest.json');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                       // never touch writes

  let url;
  try { url = new URL(req.url); } catch (_e) { return; }
  if (url.origin !== self.location.origin) return;        // Supabase, worker, CDNs
  if (url.pathname.indexOf('/rest/v1') === 0) return;     // belt and braces

  // NETWORK-FIRST for the shell: a navigation must reflect the latest deploy.
  if (req.mode === 'navigate' || isShell(url)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE);
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch (_e) {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        const shell = await caches.match('./index.html');
        if (shell) return shell;
        throw _e;
      }
    })());
    return;
  }

  // Everything else same-origin: cache-first, refreshed in the background.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then(async (res) => {
      if (res && res.ok) {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    }).catch(() => null);
    return cached || (await network) || new Response('', { status: 504 });
  })());
});
