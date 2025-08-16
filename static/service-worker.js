// Service Worker neutre (n’altère pas le rendu, juste installable)
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => self.clients.claim());
self.addEventListener("fetch", (e) => {
  e.respondWith(fetch(e.request).catch(() => fetch(e.request)));
});
