const CACHE='mechyard-v5';
const LOCAL=['./','index.html','style.css','mechyard-v2.js','manifest.webmanifest','icon.png'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(LOCAL)));});
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&k.startsWith('mechyard-')).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>{e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{if(r&&r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});}return r;})));});
