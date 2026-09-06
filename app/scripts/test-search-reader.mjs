import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyResult, readPublicPage } from '../public/search-reader.js';
const origin='https://vitrinecity.com';
for(const value of ['javascript:alert(1)','data:text/html,test','file:///etc/passwd','https://name:secret@example.com','https://x.test/hello world','\\evil.test/test',null]) {
  if(value===null)continue;
  assert.equal(classifyResult(value,origin),null,value);
}
for(const value of ['/admin','/api/health','/entrar.html','/ofertas/x?redirect=/admin','/ofertas/%2fadmin','https://vitrinecity.com.evil.test/artigos/organizar-petiscos.html','https://vitrinecity.com:444/ofertas/item','//evil.test/ofertas/item','https://www.youtube.com.evil.test/watch?v=dQw4w9WgXcQ','https://www.tiktok.com:444/@user/video/6718335390845095173']) {
  assert.equal(classifyResult(value,origin)?.kind,'external',value);
}
for(const value of ['/guias/plantas-em-vasos.html','/artigos/organizar-petiscos.html','/ofertas/produto-publico']) assert.equal(classifyResult(value,origin).kind,'local');
assert.equal(classifyResult('https://vitrinecity.com/ofertas/item','http://127.0.0.1:8765').url,'http://127.0.0.1:8765/ofertas/item');
const tik=classifyResult('https://www.tiktok.com/@scout2015/video/6718335390845095173?is_from_webapp=1',origin);
for(const value of ['https://youtu.be/dQw4w9WgXcQ','https://www.youtube.com/watch?v=dQw4w9WgXcQ','https://www.youtube.com/shorts/dQw4w9WgXcQ']) {
  const yt=classifyResult(value,origin);assert.equal(yt.kind,'youtube');assert.equal(yt.id,'dQw4w9WgXcQ');assert.equal(yt.embed,undefined,'Client cannot embed before eligibility response');
}
assert.equal(tik.kind,'tiktok');assert.match(tik.embed,/^https:\/\/www.tiktok.com\/player\/v1\/6718335390845095173\?autoplay=0/);
for(const value of ['https://vm.tiktok.com/short','https://www.tiktok.com/@user/video/123','http://www.tiktok.com/@user/video/6718335390845095173','https://tiktok.com.evil.test/@user/video/6718335390845095173']) assert.equal(classifyResult(value,origin).kind,'external');
let calls=0;
const fetcher=async(url,options)=>{calls++;assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');return new Response('<main>Leitura</main>',{headers:{'content-type':'text/html'}});};
assert.match(await readPublicPage('/ofertas/item',{origin,fetcher}),/Leitura/);
await assert.rejects(readPublicPage('https://evil.test/ofertas/item',{origin,fetcher}));assert.equal(calls,1,'External results must never be fetched for reading');
await assert.rejects(readPublicPage('/ofertas/item',{origin,fetcher:async()=>new Response('secret',{headers:{'content-type':'application/json'}})}));
await assert.rejects(readPublicPage('/ofertas/item',{origin,fetcher:async()=>new Response('not found',{status:404,headers:{'content-type':'text/html'}})}));
await assert.rejects(readPublicPage('/ofertas/item',{origin,fetcher:async()=>new Response('x'.repeat(500001),{headers:{'content-type':'text/html'}})}));
const js=fs.readFileSync(new URL('../public/search-reader.js',import.meta.url),'utf8');
assert.match(js,/template\.innerHTML = html/);assert.doesNotMatch(js,/content\.innerHTML|eval\(|new Function|srcdoc|postMessage/);
assert.match(js,/dialog\.addEventListener\('close',cleanup\)/);assert.match(js,/content\.replaceChildren\(\)/);assert.match(js,/strict-origin-when-cross-origin/);
assert.match(js,/data\.available!==true/);assert.match(js,/data\.id!==info\.id/);assert.match(js,/data\.provider!=='youtube'/);
const html=fs.readFileSync(new URL('../public/pesquisar.html',import.meta.url),'utf8');assert.match(html,/search-reader.css/);assert.match(html,/search.js" type="module"/);assert.match(html,/vitrinecity-logo.png/);
assert.match(html,/https:\/\/www.youtube.com\/@agrotecnica362/);assert.match(js,/https:\/\/www.youtube.com\/@agrotecnica362/);
assert.match(html,/https:\/\/www.instagram.com\/agrotecniica\//);assert.match(js,/https:\/\/www.instagram.com\/agrotecniica\//);
assert.match(html,/https:\/\/www.tiktok.com\/@agrotecnica5/);assert.match(js,/https:\/\/www.tiktok.com\/@agrotecnica5/);
assert.match(html,/https:\/\/adubonpkparaplantas.com.br\//);assert.match(js,/https:\/\/adubonpkparaplantas.com.br\//);
assert.match(html,/https:\/\/shopee.com.br\/agrotecnicavendas#product_list/);assert.match(js,/https:\/\/shopee.com.br\/agrotecnicavendas#product_list/);
console.log('Reader: URL allowlist, no external fetch/proxy, bounded response, no credentials, markup fallback and assets verified.');
