// SW Ankaa — pré-cache léger des assets UI (sons/icônes) pour démarrage fluide.
const VERSION = 'v1';
const CORE = [
  '/', '/static/style.css?v=13', '/static/script.js?v=13',
  '/static/assets/ui_click.mp3',
  '/static/assets/portal_open.mp3',
  '/static/assets/portal_close.mp3',
  '/static/assets/mode_select.mp3',
  '/static/assets/oeil_orus_ailes.png',
  '/static/assets/fond_cosmique.jpg',
];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(VERSION).then(c=>c.addAll(CORE)));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k)))));
});
self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);
  if (e.request.method!=='GET') return;
  // Cache-first pour /static/ ; network-first pour /invoquer
  if (url.pathname.startsWith('/static/')) {
    e.respondWith(caches.match(e.request).then(r=>r || fetch(e.request)));
  }
});
