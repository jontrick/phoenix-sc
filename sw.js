var CACHE_NAME = 'phoenix-v4.9.45';
var CACHE_FILES = ['/', '/index.html', '/manifest.json'];

// INSTALL: skip waiting immediately so new SW activates without waiting for tabs to close
self.addEventListener('install', function(e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(CACHE_FILES);
    })
  );
});

// ACTIVATE: delete old caches, claim all clients, tell them to reload
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
      return self.clients.matchAll({type:'window'}).then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({type:'SW_UPDATED', version: CACHE_NAME});
        });
      });
    })
  );
});

// FETCH: always network-first for HTML — never serve stale shell
self.addEventListener('fetch', function(e) {
  var req = e.request;
  if(req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch(_e){ return; }
  if(url.origin !== self.location.origin) return;

  var isShell = req.mode === 'navigate'
             || url.pathname === '/'
             || url.pathname === '/index.html'
             || url.pathname === '/manifest.json'
             || url.pathname === '/sw.js';

  if(isShell){
    // Network first — NEVER serve cached shell
    e.respondWith(
      fetch(req, {cache: 'no-cache'}).then(function(networkRes){
        if(networkRes && networkRes.status === 200){
          var copy = networkRes.clone();
          caches.open(CACHE_NAME).then(function(cache){ cache.put(req, copy); }).catch(function(){});
        }
        return networkRes;
      }).catch(function(){
        return caches.match(req).then(function(cached){
          return cached || caches.match('/index.html') || caches.match('/');
        });
      })
    );
    return;
  }

  // Everything else: cache first
  e.respondWith(
    caches.match(req).then(function(cached){
      return cached || fetch(req);
    })
  );
});

// SKIP_WAITING message from app
self.addEventListener('message', function(e){
  if(e.data && e.data.type === 'SKIP_WAITING'){
    self.skipWaiting();
  }
});
