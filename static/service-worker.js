// SW neutre — juste pour installabilité (pas de cache agressif)
const VER = "ankaa-mobile-v7";
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => self.clients.claim());
self.addEventListener("fetch", e => e.respondWith(fetch(e.request).catch(()=>fetch(e.request))));
