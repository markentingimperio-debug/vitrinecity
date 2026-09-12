const CACHE_NAME='vitrinecity-games-v1';
const PUBLIC_PAGES=new Set(['/games/','/games/blocos','/games/jardim','/games/plantas']);
const STATIC_ASSETS=new Set([
  '/games/manifest.webmanifest','/games/offline.html','/games/app.js','/games/app.css','/games/install.js','/games/install.css',
  '/games/plants.js','/games/plants.css','/games/plants-core.js',
  '/vitriny-games.css','/vitriny-casual.css','/vitriny-casual.js','/vitriny-casual-storage.js','/vitriny-blocks-core.js','/vitriny-merge-core.js',
  '/assets/pwa-icon-192.png','/assets/pwa-icon-512.png','/assets/pwa-icon-maskable-512.png'
]);
const APP_SHELL=[...PUBLIC_PAGES,...STATIC_ASSETS];
function key(url){return new URL(url.pathname,self.location.origin).href;}
function mayCache(response){return response.ok&&!response.redirected&&!/private|no-store/i.test(response.headers.get('Cache-Control')||'');}
async function remember(request,response){if(mayCache(response)){try{const cache=await caches.open(CACHE_NAME);await cache.put(key(new URL(request.url)),response.clone());}catch{/* Storage limits must not interrupt a successful online request. */}}return response;}
self.addEventListener('install',event=>{event.waitUntil((async()=>{const cache=await caches.open(CACHE_NAME);for(const pathname of APP_SHELL){const request=new Request(new URL(pathname,self.location.origin),{cache:'reload',credentials:'same-origin'}),response=await fetch(request);if(!mayCache(response))throw Error('games_shell_not_public');await cache.put(key(new URL(request.url)),response);}await self.skipWaiting();})());});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{const names=await caches.keys();await Promise.all(names.filter(name=>name.startsWith('vitrinecity-games-')&&name!==CACHE_NAME).map(name=>caches.delete(name)));await self.clients.claim();})());});
self.addEventListener('fetch',event=>{
  const request=event.request;if(request.method!=='GET'||request.headers.has('Authorization'))return;
  const url=new URL(request.url);if(url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
  if(request.mode==='navigate'){
    if(['/games/fazenda','/games/cuidados'].includes(url.pathname)){event.respondWith(fetch(request).catch(async()=>await(await caches.open(CACHE_NAME)).match(new URL('/games/offline.html',self.location.origin).href)||Response.error()));return;}
    if(!PUBLIC_PAGES.has(url.pathname))return;
    event.respondWith(fetch(request).then(response=>remember(request,response)).catch(async()=>{const cache=await caches.open(CACHE_NAME);return await cache.match(key(url))||await cache.match(new URL('/games/offline.html',self.location.origin).href)||Response.error();}));return;
  }
  if(!STATIC_ASSETS.has(url.pathname))return;
  event.respondWith(fetch(request).then(response=>remember(request,response)).catch(async()=>await(await caches.open(CACHE_NAME)).match(key(url))||Response.error()));
});
