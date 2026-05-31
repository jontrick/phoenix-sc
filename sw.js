var CACHE_NAME = 'phoenix-v4.9.18';
var CACHE_FILES = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', function(e) {
  // v4.7.39 hotfix: skipWaiting() so the new SW activates immediately instead of waiting
  // for every tab to close. Combined with clients.claim() in activate, this means a fresh
  // deploy reaches the running app on the next page load — no "close all tabs" dance.
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(CACHE_FILES);
    })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(name) { return name !== CACHE_NAME; })
             .map(function(name) { return caches.delete(name); })
      );
    }).then(function() {
      return self.clients.claim();
    }).then(function() {
      // Tell all open tabs to reload now that the new SW has taken control.
      // This is what makes deploys instant for PWA users — no manual cache clear needed.
      return self.clients.matchAll({type:'window'}).then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({type:'SW_UPDATED', version: CACHE_NAME});
        });
      });
    })
  );
});

// v4.7.39 hotfix: network-first for the HTML shell + manifest. Cache-first was the real
// reason deploys weren't reaching users — once index.html was cached, the SW served the
// stale copy forever (even after activating a new SW). Now: try the network first, fall
// back to cache only on failure (offline / flaky connection). Static asset fetches keep
// the old cache-first behaviour so the app loads fast.
self.addEventListener('fetch', function(e) {
  var req = e.request;
  // Only intercept GETs. Skip cross-origin (Supabase / worker / fonts CDNs handle their own caching).
  if(req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch(_e){ return; }
  if(url.origin !== self.location.origin) return;
  // Navigation requests + the explicit HTML / manifest entries → network-first.
  var isShell = req.mode === 'navigate'
             || url.pathname === '/'
             || url.pathname === '/index.html'
             || url.pathname === '/manifest.json';
  if(isShell){
    e.respondWith(
      fetch(req).then(function(networkRes){
        // Refresh the cached shell so offline opens load the latest version we've seen.
        var copy = networkRes.clone();
        caches.open(CACHE_NAME).then(function(cache){ cache.put(req, copy); }).catch(function(){});
        return networkRes;
      }).catch(function(){
        // Offline / network error — serve whatever we've cached.
        return caches.match(req).then(function(cached){
          return cached || caches.match('/index.html') || caches.match('/');
        });
      })
    );
    return;
  }
  // Everything else (images, audio, etc.) — cache-first, fall back to network.
  e.respondWith(
    caches.match(req).then(function(cached){
      return cached || fetch(req);
    })
  );
});
