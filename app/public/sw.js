const CACHE_NAME = 'vitrinecity-pwa-v7';
const APP_SHELL = [
  '/',
  '/loja',
  '/cidade-premium',
  '/navegar.html',
  '/navegar.css?v=1',
  '/navegar.js?v=4',
  '/offline.html',
  '/manifest.webmanifest',
  '/pwa-install.js?v=2',
  '/assets/pwa-icon-192.png',
  '/assets/pwa-icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('vitrinecity-pwa-') && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/admin')) return;

  const offlineMapData = ['/api/maps/stores', '/api/maps/config'].includes(url.pathname);
  if (url.pathname.startsWith('/api/') && !offlineMapData) return;

  if (offlineMapData) {
    event.respondWith(
      fetch(request).then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
        return response;
      }).catch(() => caches.match(request).then(cached => cached || new Response(
        JSON.stringify(url.pathname.endsWith('/config') ? { enabled: false, offline: true } : { stores: [], filters: [], offline: true }),
        { headers: { 'Content-Type': 'application/json' } }
      )))
    );
    return;
  }

  if (request.mode === 'navigate') {
    // Never retain account, checkout, courier or other personal pages across sessions.
    const publicPage = ['/', '/index.html', '/loja', '/entregas', '/ofertas', '/cidade-premium', '/navegar.html', '/mapa-real.html', '/offline.html'].includes(url.pathname)
      || url.pathname.startsWith('/ofertas/') || url.pathname.startsWith('/artigos/');
    event.respondWith(fetch(request).then(response => {
      if (response.ok && publicPage && !/private|no-store/i.test(response.headers.get('Cache-Control') || '')) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(() => publicPage ? caches.match(request).then(cached => cached || caches.match('/offline.html')) : caches.match('/offline.html')));
    return;
  }

  // Scripts and styles change between releases, including URLs without a version suffix.
  if (['script','style'].includes(request.destination)) {
    event.respondWith(fetch(request).then(response => {
      if(response.ok) caches.open(CACHE_NAME).then(cache=>cache.put(request,response.clone()));
      return response;
    }).catch(()=>caches.match(request).then(cached=>cached||Response.error())));
    return;
  }
  if (!['style', 'script', 'image', 'font'].includes(request.destination)) return;
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    }))
  );
});
