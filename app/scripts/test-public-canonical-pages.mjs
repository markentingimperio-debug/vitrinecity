import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import express from 'express';

const appDir=fileURLToPath(new URL('..',import.meta.url));
const publicDir=path.join(appDir,'public');
const serverSource=fs.readFileSync(path.join(appDir,'server.js'),'utf8');
const pages={
  'privacy.html':'/privacy.html',
  'termos-predio-digital.html':'/termos-predio-digital.html',
  'termos-afiliados.html':'/termos-afiliados.html',
  'cidade-exploravel.html':'/cidade',
  'cidade-25d-demo.html':'/cidade/bairro-premium',
  'passeio-virtual.html':'/cidade/avenida-premium',
  'mapa-real.html':'/cidade-premium',
  'comprar-lote.html':'/comprar-lote.html',
  'pacote-videos.html':'/pacote-videos.html',
  'carteira.html':'/carteira.html'
};
function canonical(html){
  const tags=html.match(/<link\b[^>]*\brel=["']canonical["'][^>]*>/gi)||[];
  assert.equal(tags.length,1,'exactly one canonical');
  assert.ok(html.indexOf(tags[0])<html.indexOf('</head>'),'canonical is in head');
  return tags[0].match(/\bhref="([^"]+)"/i)?.[1];
}
function sourceBetween(start,end){
  const from=serverSource.indexOf(start),to=serverSource.indexOf(end,from+start.length);
  assert.ok(from>=0&&to>from,'actual server fixture anchors exist');
  return serverSource.slice(from,to);
}
async function fixture(t){
  const app=express();
  const publicPage=sourceBetween('const publicPage = file =>','\nlet dailyStories,ecosystem;');
  const aliases=['/cidade','/cidade/bairro-premium','/cidade/avenida-premium','/cidade-premium'];
  const routes=aliases.map(alias=>{
    const line=serverSource.split(/\r?\n/).find(line=>line.startsWith(`app.get('${alias}', publicPage(`));
    assert.ok(line,`real route ${alias}`);return line;
  });
  vm.runInNewContext(publicPage+'\n'+routes.join('\n'),{app,fs,path,dir:appDir});
  const siteMap=sourceBetween("app.get('/sitemap.xml'",'\nfunction metaCatalogCsvCell(');
  const escapeXml=sourceBetween('function escapeXml(', '\nfunction publicStoreProfile(');
  const emptyCatalog={sitemapPaths:()=>[]};
  vm.runInNewContext(escapeXml+'\n'+siteMap,{
    app,URL,SITE_URL:'https://vitrinecity.com',db:{prepare:()=>({all:()=>[]})},
    affiliateCatalog:emptyCatalog,courseLandingPages:emptyCatalog,mediaCatalog:emptyCatalog,webStories:emptyCatalog
  });
  app.use(express.static(publicDir,{extensions:['html']}));
  const listener=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>new Promise(resolve=>listener.close(resolve)));
  return async (url,method='GET')=>{
    const r=await fetch(`http://127.0.0.1:${listener.address().port}${url}`,{method,redirect:'manual'});
    return {status:r.status,location:r.headers.get('location'),body:await r.text()};
  };
}

for(const [file,canonicalPath] of Object.entries(pages))test(`${file} has one clean apex canonical`,()=>{
  const html=fs.readFileSync(path.join(publicDir,file),'utf8');
  assert.equal(canonical(html),'https://vitrinecity.com'+canonicalPath);
  const robots=html.match(/<meta\b[^>]*\bname="robots"[^>]*>/gi)||[];
  if(file==='carteira.html'){
    assert.equal(robots.length,1);assert.match(robots[0],/content="noindex,follow"/);
  }else assert.equal(robots.length,0,'public page remains indexable');
});

test('real city routes and direct files serve 200 and point to the same existing canonical route',async t=>{
  const get=await fixture(t);
  for(const [file,alias] of Object.entries(pages).filter(([,alias])=>alias.startsWith('/cidade'))){
    for(const route of [alias,'/'+file]){
      assert.equal((await get(route,'HEAD')).status,200);
      const r=await get(route);
      assert.equal(r.status,200);assert.equal(r.location,null);
      assert.equal(canonical(r.body),'https://vitrinecity.com'+alias);
    }
    const siteMap=sourceBetween("app.get('/sitemap.xml'",'  const stores =');
    if(alias!=='/cidade-premium')assert.ok(siteMap.includes(`'${alias}'`),'canonical route remains in sitemap');
  }
});

test('premium city canonical consolidates the real route and direct file without rewriting map query state',async t=>{
  const get=await fixture(t);
  const plain=await get('/cidade-premium');
  for(const route of ['/cidade-premium?store=qa-store&utm_source=qa','/mapa-real.html?store=qa-store']){
    const result=await get(route);
    assert.equal(result.status,200);assert.equal(result.location,null);
    assert.equal(result.body,plain.body);
    assert.equal(canonical(result.body),'https://vitrinecity.com/cidade-premium');
  }
  assert.match(plain.body,/mapa-real\.js\?v=14/);
  const sitemap=await get('/sitemap.xml');
  assert.doesNotMatch(sitemap.body,/<loc>https:\/\/vitrinecity\.com\/cidade-premium<\/loc>/);
});

test('query-bearing purchase and wallet URLs retain query behavior with no redirect or rewritten forms',async t=>{
  const get=await fixture(t);
  for(const [file,queries] of [
    ['comprar-lote.html',['?plano=basic_monthly','?plano=basic_monthly&lia=1']],
    ['pacote-videos.html',['?resultado=falha','?lia=1']],
    ['carteira.html',['?redirect=','?resultado=pendente&ref=qa_reference#socialConnectArea']]
  ]){
    const plain=await get('/'+file);
    for(const query of queries){
      const r=await get('/'+file+query);
      assert.equal(r.status,200);assert.equal(r.location,null);
      assert.equal(r.body,plain.body,'metadata does not redirect or rewrite query-bearing response');
      assert.equal(canonical(r.body),'https://vitrinecity.com/'+file);
    }
  }
  const lot=(await get('/comprar-lote.html')).body;
  assert.match(lot,/id="checkout-form"/);assert.match(lot,/mountBuildingCheckout\(\)/);
  assert.match(lot,/href="\/comprar-lote\.html\?plano=basic_monthly"/);
  const video=(await get('/pacote-videos.html')).body;
  assert.match(video,/form\.onsubmit=/);assert.match(video,/\/api\/services\/videos\/checkout/);
});

test('every canonical target resolves locally and private wallet is absent from the existing sitemap',async t=>{
  const get=await fixture(t);
  for(const canonicalPath of Object.values(pages))assert.equal((await get(canonicalPath)).status,200);
  const siteMap=sourceBetween("app.get('/sitemap.xml'",'  const stores =');
  assert.doesNotMatch(siteMap,/carteira\.html/);
});

test('search and private chat stay usable while excluded from indexing and the sitemap',async t=>{
  const get=await fixture(t);
  const sitemap=await get('/sitemap.xml');
  for(const file of ['buscar.html','chat-social.html']){
    const plain=await get('/'+file);
    const queried=await get('/'+file+'?q=plantas&usuario=exemplo');
    assert.equal(plain.status,200);assert.equal(queried.status,200);
    assert.equal(queried.location,null);assert.equal(queried.body,plain.body);
    assert.match(plain.body,/<meta name="robots" content="noindex,follow">/);
    assert.ok(plain.body.indexOf('content="noindex,follow"')<plain.body.indexOf('</head>'));
    assert.ok(!sitemap.body.includes('/'+file));
  }
});

test('operational fiscal policy stays available with noindex but is excluded from the real sitemap output',async t=>{
  const get=await fixture(t);
  const policy=await get('/politica-fiscal-marketplace.html');
  assert.equal(policy.status,200);assert.equal(policy.location,null);
  assert.match(policy.body,/<meta name="robots" content="noindex">/);
  const sitemap=await get('/sitemap.xml');
  assert.equal(sitemap.status,200);
  assert.doesNotMatch(sitemap.body,/politica-fiscal-marketplace\.html/);
  assert.doesNotMatch(sitemap.body,/carteira\.html/);
  for(const pathname of [
    '/cidade','/cidade/bairro-premium','/cidade/avenida-premium','/comprar-lote.html',
    '/privacy.html','/termos-predio-digital.html','/termos-marketplace.html',
    '/politica-vendedor-marketplace.html','/politica-comprador-marketplace.html',
    '/politica-devolucao-marketplace.html','/politica-cancelamento-marketplace.html',
    '/politica-disputas-marketplace.html'
  ])assert.ok(sitemap.body.includes('<loc>https://vitrinecity.com'+pathname+'</loc>'),`public sitemap entry preserved: ${pathname}`);
});
