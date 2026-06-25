var CACHE_NAME = 'phoenix-v4.9.84';

self.addEventListener('install', function(e){
  self.skipWaiting();
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(names){
      return Promise.all(names.map(function(n){ return caches.delete(n); }));
    }).then(function(){
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(e){
  if(e.request.method !== 'GET') return;
  var url;
  try { url = new URL(e.request.url); } catch(_){ return; }
  if(url.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request, {cache:'no-store'}));
});

self.addEventListener('message', function(e){
  if(e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
