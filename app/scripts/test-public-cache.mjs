import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const handlers={},stored=[];let fail=false;
const context={URL,Response,console,self:{location:{origin:'https://vitrinecity.com'},addEventListener:(n,f)=>handlers[n]=f,skipWaiting(){},clients:{claim(){}}},
  caches:{open:async()=>({put:async(req)=>stored.push(req.url),addAll:async()=>{}}),match:async(req)=>new Response(typeof req==='string'&&req==='/offline.html'?'offline':'old'),keys:async()=>[]},
  fetch:async()=>{if(fail)throw Error('offline');return new Response('new');}};
vm.runInNewContext(fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),context);
async function request(path,mode='navigate',destination='document'){
  let pending;handlers.fetch({request:{url:'https://vitrinecity.com'+path,method:'GET',mode,destination},respondWith:p=>pending=p});
  return pending?await (await pending).text():null;
}
assert.equal(await request('/minha-conta'), 'new');assert.equal(stored.length,0,'Personal pages must not enter shared offline cache');
assert.equal(await request('/loja'),'new');await Promise.resolve();assert(stored.includes('https://vitrinecity.com/loja'));
assert.equal(await request('/global-market-banner.js','cors','script'),'new','Scripts must prefer network over cached old code');
fail=true;assert.equal(await request('/minha-conta'),'offline');assert.equal(await request('/loja'),'old');
assert.equal(await request('/global-market-banner.js','cors','script'),'old','Keep public assets usable offline');
assert.equal(await request('/api/private'),null);
console.log('Public cache: fresh scripts, offline fallback and personal-page isolation passed.');
