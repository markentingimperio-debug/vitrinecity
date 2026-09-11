import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/games/sw.js',import.meta.url),'utf8');
const ORIGIN='https://vitrinecity.test',CURRENT='vitrinecity-games-v1';
function harness(){
  const listeners=new Map(),stores=new Map(),requests=[],deleted=[];let offline=false,quota=false,cacheControl='public,max-age=0',redirect=false,skips=0,claims=0;
  const caches={async open(name){if(!stores.has(name))stores.set(name,new Map());const store=stores.get(name);return {async put(key,response){if(quota)throw Error('quota');store.set(String(key),response.clone());},async match(key){return store.get(String(key))?.clone();}};},async keys(){return [...stores.keys()];},async delete(name){deleted.push(name);return stores.delete(name);}};
  const fetch=async request=>{requests.push(request.url);if(offline)throw Error('offline');const response=new Response(new URL(request.url).pathname,{headers:{'Cache-Control':cacheControl}});if(redirect)Object.defineProperty(response,'redirected',{value:true});return response;};
  const self={location:{origin:ORIGIN},addEventListener:(type,fn)=>listeners.set(type,fn),skipWaiting:async()=>{skips++;},clients:{claim:async()=>{claims++;}}};
  vm.runInNewContext(source,{self,caches,fetch,URL,Request,Response,Set,Promise,Error});
  const lifecycle=async type=>{let work;listeners.get(type)({waitUntil:value=>{work=value;}});await work;};
  const request=(path,{mode='navigate',method='GET',headers={}}={})=>{let response;const url=new URL(path,ORIGIN).href;listeners.get('fetch')({request:{url,mode,method,headers:new Headers(headers)},respondWith:value=>{response=Promise.resolve(value);}});return response;};
  return {stores,requests,deleted,lifecycle,request,caches,flags(values){if('offline'in values)offline=values.offline;if('quota'in values)quota=values.quota;if('cacheControl'in values)cacheControl=values.cacheControl;if('redirect'in values)redirect=values.redirect;},get skips(){return skips;},get claims(){return claims;}};
}

test('install caches public puzzles and exact static shell, never API, farm, account or model assets',async()=>{
  const h=harness();await h.lifecycle('install');assert.equal(h.skips,1);
  const paths=h.requests.map(url=>new URL(url).pathname);
  for(const path of ['/games/','/games/blocos','/games/jardim','/games/plantas','/games/plants.js','/games/plants-core.js','/games/plants.css','/games/offline.html','/vitriny-casual.js','/vitriny-casual-storage.js','/vitriny-blocks-core.js','/vitriny-merge-core.js'])assert.ok(paths.includes(path));
  assert.ok(paths.every(path=>!path.startsWith('/api/')&&!/fazenda|entrar|conta|\.glb|three|chat|mercado|payments/.test(path)));
  assert.ok(paths.length<25,'small, fixed shell');
  const cached=h.stores.get(CURRENT);assert.equal(cached.size,paths.length);
});

test('offline puzzles preserve the same shell while farm returns an honest online-only page',async()=>{
  const h=harness();await h.lifecycle('install');h.flags({offline:true});
  for(const path of ['/games/','/games/blocos','/games/jardim','/games/plantas'])assert.equal(await(await h.request(`${path}?install=1`)).text(),path);
  assert.equal(await(await h.request('/games/fazenda')).text(),'/games/offline.html');
  assert.equal(await(await h.request('/games/cuidados')).text(),'/games/offline.html');
  assert.equal(await(await h.request('/vitriny-casual.js?v=1',{mode:'cors'})).text(),'/vitriny-casual.js');
  assert.equal(h.stores.get(CURRENT).has(`${ORIGIN}/games/fazenda`),false);
});

test('API, auth, commerce, unknown assets, external origins and writes are never intercepted',async()=>{
  const h=harness();await h.lifecycle('install');const calls=h.requests.length;
  for(const [path,options] of [
    ['/api/games/farm',{}],['/api/games/farm/action',{method:'POST'}],['/games/entrar',{}],['/games/privacidade',{}],['/games/ajuda',{}],['/minha-conta.html',{}],['/pagamento.html',{}],['/games/',{method:'POST'}],['/assets/avatar.glb',{mode:'cors'}],['https://elsewhere.test/games/',{}],['/games/',{headers:{Authorization:'fixture'}}]
  ])assert.equal(h.request(path,options),undefined,`${path} must pass to browser`);
  assert.equal(h.requests.length,calls);
});

test('successful farm requests never store the personalized response',async()=>{
  const h=harness();await h.lifecycle('install');const count=h.stores.get(CURRENT).size;
  assert.equal(await(await h.request('/games/fazenda')).text(),'/games/fazenda');assert.equal(h.stores.get(CURRENT).size,count);
});

test('private, no-store and redirected responses cannot become the offline public shell',async()=>{
  for(const flags of [{cacheControl:'private,max-age=0'},{cacheControl:'no-store'},{redirect:true}]){
    const h=harness();h.flags(flags);await assert.rejects(h.lifecycle('install'),/games_shell_not_public/);assert.equal(h.skips,0);
    const response=await h.request('/games/');assert.equal(response.status,200);assert.equal(h.stores.get(CURRENT)?.size||0,0);
  }
});

test('storage quota failure does not break a successful online game or asset request',async()=>{
  const h=harness();h.flags({quota:true});
  assert.equal(await(await h.request('/games/')).text(),'/games/');
  assert.equal(await(await h.request('/games/app.js',{mode:'cors'})).text(),'/games/app.js');
});

test('a fresh offline browser gets an explicit network error rather than an invalid response',async()=>{
  const h=harness();h.flags({offline:true});
  for(const [path,options] of [['/games/',{}],['/games/fazenda',{}],['/games/app.js',{mode:'cors'}]])assert.equal((await h.request(path,options)).type,'error');
});

test('activation removes only older Games caches and leaves commerce and browser data untouched',async()=>{
  const h=harness();for(const name of ['vitrinecity-games-v0',CURRENT,'vitrinecity-shell-v99','customer-data'])await h.caches.open(name);
  await h.lifecycle('activate');assert.deepEqual(h.deleted,['vitrinecity-games-v0']);assert.equal(h.claims,1);
  assert.equal(h.stores.has('vitrinecity-shell-v99'),true);assert.equal(h.stores.has('customer-data'),true);
});
