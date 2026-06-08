var CACHE_NAME = 'phoenix-v4.9.71';

self.addEventListener('install', function(e) {
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(names.map(function(name) {
        return caches.delete(name);
      }));
    }).then(function() {
      return self.clients.claim();
    }).then(function() {
      return self.clients.matchAll({type:'window'}).then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({type:'SW_UPDATED', version: CACHE_NAME});
        });
      });
    })
  );
});

self.addEventListener('fetch', function(e) {
  if(e.request.method !== 'GET') return;
  var url;
  try { url = new URL(e.request.url); } catch(_) { return; }
  if(url.origin !== self.location.origin) return;
  // Always network first, no caching at all
  e.respondWith(
    fetch(e.request, {cache: 'no-store'}).catch(function() {
      return caches.match(e.request);
    })
  );
});

self.addEventListener('message', function(e) {
  if(e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
