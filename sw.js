// Phoenix SW — always network first, force update on new version
var CACHE_NAME = 'phoenix-v4.9.83';

self.addEventListener('install', function(e){
  self.skipWaiting();
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(names){
      return Promise.all(names.map(function(n){ return caches.delete(n); }));
    }).then(function(){
      return self.clients.claim();
    }).then(function(){
      return self.clients.matchAll({type:'window'}).then(function(clients){
        clients.forEach(function(c){ c.postMessage({type:'SW_UPDATED',version:CACHE_NAME}); });
      });
    })
  );
});

self.addEventListener('fetch', function(e){
  if(e.request.method !== 'GET') return;
  var url;
  try { url = new URL(e.request.url); } catch(_){ return; }
  if(url.origin !== self.location.origin) return;
  // Always network, no cache
  e.respondWith(
    fetch(e.request, {cache:'no-store'}).catch(function(){
      return new Response('Offline — please reconnect', {status:503});
    })
  );
});

self.addEventListener('message', function(e){
  if(e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
