import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyResult, createSearchReader, isVideoResult, readPublicPage } from '../public/search-reader.js';
const origin='https://vitrinecity.com';
for(const value of ['javascript:alert(1)','data:text/html,test','file:///etc/passwd','https://name:secret@example.com','https://x.test/hello world','\\evil.test/test',null,undefined,'']) {
  assert.equal(classifyResult(value,origin),null,value);
}
for(const value of ['/admin','/api/health','/entrar.html','/ofertas/x?redirect=/admin','/ofertas/%2fadmin','https://vitrinecity.com.evil.test/artigos/organizar-petiscos.html','https://vitrinecity.com:444/ofertas/item','//evil.test/ofertas/item','https://www.youtube.com.evil.test/watch?v=dQw4w9WgXcQ','https://www.tiktok.com:444/@user/video/6718335390845095173']) {
  assert.equal(classifyResult(value,origin)?.kind,'external',value);
}
for(const value of ['/guias/plantas-em-vasos.html','/artigos/organizar-petiscos.html','/ofertas/produto-publico']) assert.equal(classifyResult(value,origin).kind,'local');
assert.equal(classifyResult('https://vitrinecity.com/ofertas/item','http://127.0.0.1:8765').url,'http://127.0.0.1:8765/ofertas/item');
const tik=classifyResult('https://www.tiktok.com/@scout2015/video/6718335390845095173?is_from_webapp=1',origin);
for(const value of ['https://youtu.be/dQw4w9WgXcQ','https://youtu.be/dQw4w9WgXcQ/','https://www.youtube.com/watch?v=dQw4w9WgXcQ','https://www.youtube.com/shorts/dQw4w9WgXcQ','https://www.youtube.com/live/dQw4w9WgXcQ']) {
  const yt=classifyResult(value,origin);assert.equal(yt.kind,'youtube');assert.equal(yt.id,'dQw4w9WgXcQ');assert.equal(yt.embed,undefined,'Video results contain no embedded player URL');
}
assert.equal(tik.kind,'tiktok');assert.equal(tik.embed,undefined,'TikTok is a direct outbound link, not an embedded player');
for(const value of ['https://vm.tiktok.com/short','https://www.tiktok.com/@user/video/123','http://www.tiktok.com/@user/video/6718335390845095173','https://tiktok.com.evil.test/@user/video/6718335390845095173']) assert.equal(classifyResult(value,origin).kind,'external');
let calls=0;
const fetcher=async(url,options)=>{calls++;assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');return new Response('<main>Leitura</main>',{headers:{'content-type':'text/html'}});};
assert.match(await readPublicPage('/ofertas/item',{origin,fetcher}),/Leitura/);
await assert.rejects(readPublicPage('https://evil.test/ofertas/item',{origin,fetcher}));assert.equal(calls,1,'External results must never be fetched for reading');
await assert.rejects(readPublicPage('/ofertas/item',{origin,fetcher:async()=>new Response('secret',{headers:{'content-type':'application/json'}})}));
await assert.rejects(readPublicPage('/ofertas/item',{origin,fetcher:async()=>new Response('not found',{status:404,headers:{'content-type':'text/html'}})}));
await assert.rejects(readPublicPage('/ofertas/item',{origin,fetcher:async()=>new Response('x'.repeat(500001),{headers:{'content-type':'text/html'}})}));
const js=fs.readFileSync(new URL('../public/search-reader.js',import.meta.url),'utf8');
assert.doesNotMatch(js,/main\.querySelector\(\s*['"]article['"]\s*\)/,'A related article card must not replace the main page content');
assert.match(js,/template\.innerHTML = html/);assert.doesNotMatch(js,/content\.innerHTML|eval\(|new Function|srcdoc|postMessage/);
assert.match(js,/dialog\.addEventListener\('close',cleanup\)/);assert.match(js,/content\.replaceChildren\(\)/);
assert.doesNotMatch(js,/video-eligibility|Carregar player|Assistir aqui|el\('iframe'|youtube-nocookie|tiktok\.com\/player\//,'No external player or eligibility request remains in the reader');

// A small DOM double checks the actual action builder without network calls.
class Element {
  constructor(tag) { this.tagName=tag.toUpperCase();this.children=[];this.attributes=new Map();this.listeners=new Map();this.textContent='';this.classList={add(){},remove(){}}; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children=[...children]; }
  setAttribute(name,value) { this.attributes.set(name,value); }
  getAttribute(name) { return this.attributes.get(name); }
  addEventListener(name,listener) { this.listeners.set(name,listener); }
  focus() {}
}
function documentDouble(supportsDialog) {
  const created=[];
  return {created,body:new Element('body'),createElement(tag){
    const element=new Element(tag);created.push(element);
    if(tag==='dialog' && supportsDialog) {
      element.showModal=()=>{element.open=true;};
      element.close=()=>{element.open=false;element.listeners.get('close')?.();};
    }
    return element;
  }};
}
const videos=[
  {url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ',label:'no YouTube'},
  {url:'https://www.youtube.com/shorts/dQw4w9WgXcQ',label:'no YouTube'},
  {url:'https://www.tiktok.com/@user/video/6718335390845095173',label:'no TikTok'},
  {url:'https://vm.tiktok.com/short',type:'video',label:'no TikTok'},
  {url:'https://vt.tiktok.com/short/',type:'web',verb:'Abrir',label:'no TikTok'},
  {url:'https://www.tiktok.com/t/short/',type:'web',verb:'Abrir',label:'no TikTok'},
  {url:'https://www.instagram.com/reel/EXEMPLO/',type:'web',label:'no Instagram'},
  {url:'https://www.instagram.com/reels/EXEMPLO/',type:'web',label:'no Instagram'},
  {url:'https://www.kwai.com/short-video/example',type:'web',label:'no Kwai'},
  {url:'https://k.kwai.com/p/example',type:'web',verb:'Abrir',label:'no Kwai'},
  {url:'https://video.example/watch/example',type:'video',label:'na fonte'}
];
for(const supportsDialog of [true,false]) {
  const document=documentDouble(supportsDialog);
  const reader=createSearchReader({document,origin,getRecommendations(){throw Error('Video links must not open recommendations or a dialog');}});
  for(const sample of videos) {
    const item={...sample,title:'<img src=x onerror=alert(1)> vídeo',affiliate:true};
    assert.equal(isVideoResult(item,origin),true,sample.url);
    const container=new Element('article');reader.attach(container,item);
    assert.equal(container.children.length,1,'Exactly one video action');
    const action=container.children[0];
    assert.equal(action.tagName,'A');assert.equal(action.href,sample.url);assert.equal(action.target,'_blank');
    assert.equal(action.rel,'noopener noreferrer sponsored');assert.equal(action.onclick,undefined,'Use native navigation, no async popup');
    assert.equal(action.textContent,(sample.verb || 'Assistir')+' '+sample.label+' · nova aba ↗');
    assert.match(action.getAttribute('aria-label'),/A VitrineCity continua aberta\./);
    assert.equal(action.getAttribute('aria-haspopup'),undefined);assert.equal(action.children.length,0,'Result title is text only');
    assert.equal(document.created.some(element=>element.tagName==='IFRAME'||element.open===true),false);
  }
  for(const url of ['javascript:alert(1)','https://name:secret@example.com','data:text/html,test','',null]) {
    const item={url,type:'video'},container=new Element('article');
    assert.equal(isVideoResult(item,origin),false);reader.attach(container,item);assert.equal(container.children.length,0);
  }
  assert.equal(isVideoResult({url:'/ofertas/produto-publico',type:'video'},origin),false,'Own readable pages stay in the local reader');
  if(supportsDialog) {
    const container=new Element('article');reader.attach(container,{url:'/ofertas/produto-publico'});
    assert.equal(container.children[0].tagName,'BUTTON');assert.equal(container.children[0].textContent,'Ler na Vitrine');
    assert.equal(container.children[0].getAttribute('aria-haspopup'),'dialog');
  }
  reader.close();
}
assert.equal(isVideoResult({url:'https://example.com/article',type:'web'},origin),false);
for(const url of ['https://www.instagram.com/agrotecniica/','https://www.instagram.com/p/EXEMPLO/','https://www.instagram.com.evil.test/reel/EXEMPLO/','https://www.instagram.com:444/reel/EXEMPLO/','https://k.kwai.com/','https://vt.tiktok.com/','http://www.instagram.com/reel/EXEMPLO/'])assert.equal(isVideoResult({url,type:'web'},origin),false,url);
assert.equal(isVideoResult(null,origin),false);
const html=fs.readFileSync(new URL('../public/pesquisar.html',import.meta.url),'utf8');assert.match(html,/search-reader.css/);assert.match(html,/search.js" type="module"/);assert.match(html,/vitrinecity-logo.png/);
assert.match(html,/https:\/\/www.youtube.com\/@agrotecnica362/);assert.match(js,/https:\/\/www.youtube.com\/@agrotecnica362/);
assert.match(html,/https:\/\/www.instagram.com\/agrotecniica\//);assert.match(js,/https:\/\/www.instagram.com\/agrotecniica\//);
assert.match(html,/https:\/\/www.tiktok.com\/@agrotecnica5/);assert.match(js,/https:\/\/www.tiktok.com\/@agrotecnica5/);
assert.match(html,/https:\/\/adubonpkparaplantas.com.br\//);assert.match(js,/https:\/\/adubonpkparaplantas.com.br\//);
assert.match(html,/https:\/\/shopee.com.br\/agrotecnicavendas#product_list/);assert.match(js,/https:\/\/shopee.com.br\/agrotecnicavendas#product_list/);
console.log('Reader: single safe outbound video action, no player/API, dialog fallback, own-page reading, bounded response and assets verified.');
