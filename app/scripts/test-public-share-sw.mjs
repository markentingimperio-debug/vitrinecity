import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
const ORIGIN='https://vitrinecity.test',CURRENT='vitrinecity-pwa-v8-share';
function fixture(){
  const handlers=new Map(),stores=new Map(),requests=[],removed=[];let offline=false;
  const key=value=>typeof value==='string'?new URL(value,ORIGIN).href:value.url;
  const fetch=async req=>{const url=key(req);requests.push(url);if(offline)throw Error('offline');return new Response(new URL(url).pathname,{headers:{'Cache-Control':'public'}});};
  const caches={
    async open(name){if(!stores.has(name))stores.set(name,new Map());const data=stores.get(name);return{
      async addAll(urls){for(const url of urls)data.set(key(url),await fetch(url));},
      async put(req,response){data.set(key(req),response.clone());},
      async match(req){return data.get(key(req))?.clone();}
    };},async keys(){return [...stores.keys()];},async delete(name){removed.push(name);return stores.delete(name);},
    async match(req){for(const map of stores.values())if(map.has(key(req)))return map.get(key(req)).clone();}
  };
  const self={location:{origin:ORIGIN},addEventListener:(name,fn)=>handlers.set(name,fn),skipWaiting(){},clients:{claim:async()=>{}}};
  vm.runInNewContext(source,{self,caches,fetch,URL,Response,Promise});
  const lifecycle=async type=>{let promise;handlers.get(type)({waitUntil:value=>promise=value});await promise;};
  const request=(pathname,{method='GET',mode='cors',destination='script'}={})=>{let response;handlers.get('fetch')({request:{url:key(pathname),method,mode,destination},respondWith:value=>response=Promise.resolve(value)});return response;};
  return{stores,caches,requests,removed,lifecycle,request,offline(){offline=true;}};
}
test('site PWA installs the exact sharing module, stylesheet and route dependency for offline fallback',async()=>{
  const f=fixture();await f.lifecycle('install');f.offline();
  for(const [pathname,destination] of [['/public-share.js?v=20260913-1','script'],['/public-share.css?v=20260913-1','style'],['/vitriny-public-routes.js','script']]){
    assert.ok(f.stores.get(CURRENT).has(ORIGIN+pathname));assert.equal(await(await f.request(pathname,{destination})).text(),new URL(pathname,ORIGIN).pathname);
  }
});
test('upgrade replaces only old website cache and does not touch Cultiva or personal caches',async()=>{
  const f=fixture();for(const name of ['vitrinecity-pwa-v7',CURRENT,'vitrinecity-games-v2-share','customer-data'])await f.caches.open(name);
  await f.lifecycle('activate');assert.deepEqual(f.removed,['vitrinecity-pwa-v7']);assert.ok(f.stores.has('vitrinecity-games-v2-share'));assert.ok(f.stores.has('customer-data'));
});
test('sharing cache does not add API or private navigation persistence or intercept writes',async()=>{
  const f=fixture();await f.lifecycle('install');const before=f.stores.get(CURRENT).size;
  for(const pathname of ['/api/auth/me','/api/marketplace/checkout','/admin-live.html'])assert.equal(f.request(pathname),undefined);
  assert.equal(f.request('/public-share.js',{method:'POST'}),undefined);
  for(const pathname of ['/minha-conta.html','/course-checkout.html','/games/dados','/chat-social.html'])await f.request(pathname,{mode:'navigate',destination:'document'});
  assert.equal(f.stores.get(CURRENT).size,before);
});
