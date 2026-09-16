import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import {createWebStoryPromotions,storyPromotionSlots,normalizeStoryPromotions,safeStoryPromotionDestination} from '../web-story-promotions.js';
import {createWebStorySources} from '../web-story-sources.js';
import {renderWebStory} from '../web-story-render.js';
import {setupWebStories} from '../web-stories.js';

const origin='https://vitrinecity.test';
const image='/assets/garden.jpg';
const story=(count=10,extra={})=>({title:'Cuidar das plantas em vasos',description:'Um guia completo de jardinagem para organizar os cuidados em casa.',category:'Plantas',poster:'/story-assets/'+'a'.repeat(32)+'.jpg',logo:'/assets/pwa-icon-192.png',sourcePath:'/artigo/plantas-em-casa',pages:Array.from({length:count},(_,index)=>({text:`Observe a planta e confira os cuidados nesta etapa ${index+1}.`,image,width:720,height:1280,alt:'Planta em vaso'})),...extra});
const product=(id=1,extra={})=>({key:'product:'+id,kind:'product',title:'Vaso para plantas '+id,summary:'Vaso de jardinagem.',sourcePath:`/produto/${id}/vaso-para-plantas`,image_url:image,portal:'produtos',facts:{category:'Jardinagem',priceCents:2500,stockQuantity:4},commercial:true,...extra});
const city=()=>({key:'city:vitrine-city',kind:'city',title:'VitrineCity',summary:'Conheça a cidade digital e seus espaços.',sourcePath:'/',image_url:'/assets/city.jpg',facts:{destinations:[{title:'Prédio de jogos',description:'Escolha jogos para jogar na plataforma.',path:'/vitriny-games.html'},{title:'Quero meu prédio',description:'Conheça opções para apresentar seu negócio.',path:'/comprar-lote.html'}]},commercial:false});
function fixture(rows=[product()],options={}){
  const catalog=new Map(rows.map(item=>[item.key,item])),calls=[];
  const sourceCatalog={get:key=>catalog.get(key)||null,list:({limit=200,offset=0})=>[...catalog.values()].slice(offset,offset+limit)};
  const assets={async image(value){calls.push(value);if(options.onImage)await options.onImage(value,catalog);return {url:value,width:720,height:1280};}};
  return {catalog,calls,sourceCatalog,assets,select:createWebStoryPromotions({sourceCatalog,assets,origin}).select};
}

test('density is at most1/10 or2/20, never cover/end or the middle of a sentence',()=>{
  assert.deepEqual(storyPromotionSlots(story(9)),[]);assert.deepEqual(storyPromotionSlots(story(10)),[5]);assert.deepEqual(storyPromotionSlots(story(20)),[7,13]);
  const partial=story(10);partial.pages[4].text='Adicione os ingredientes e';assert.deepEqual(storyPromotionSlots(partial),[4]);
  partial.pages.forEach(page=>page.text='Trecho incompleto sem ponto');assert.deepEqual(storyPromotionSlots(partial),[]);
  for(const count of [10,19,20,40]){const slots=storyPromotionSlots(story(count,{homeCta:'Visitar a cidade'}));assert(slots.every(after=>after>=3&&after<=count-3));assert(slots.length<=Math.min(2,Math.floor(count/10)));if(slots.length===2)assert(slots[1]-slots[0]>=5);}
});

test('context-only selection skips irrelevant products and never inspects a visitor profile',async()=>{
  const f=fixture([product(1,{title:'Notebook portátil',summary:'Computador para trabalho.',facts:{category:'Tecnologia',priceCents:99900,stockQuantity:4}}),product(2)]);
  const result=await f.select(story(),{slug:'plantas',fingerprint:'a'.repeat(64),visitor:{religion:'ignored',email:'must-not-leak'}});
  assert.equal(result.length,1);assert.equal(result[0].key,'product:2');assert.equal(result[0].label,'Publicidade');assert.doesNotMatch(JSON.stringify(result),/ignored|must-not-leak/);
  const url=new URL(result[0].href,origin);assert.equal(url.searchParams.get('utm_source'),'web_stories');assert.match(url.searchParams.get('utm_campaign'),/^ws_[a-f0-9]{24}$/);assert.match(url.searchParams.get('utm_content'),/^item_[a-f0-9]{24}$/);
});

test('sensitive news and prayers receive no sales insertion; unrelated stories use only a real institutional fallback',async()=>{
  const f=fixture([product(),city()]);
  for(const title of ['Oração do dia com Jesus','Notícia sobre uma tragédia','Cuidado no tratamento da depressão'])assert.deepEqual(await f.select(story(20,{title})),[]);
  const different=story(10,{title:'Uma história sobre astronomia',description:'Conheça a observação do universo.',category:'Ciência',pages:story().pages.map(page=>({...page,text:'O céu oferece muitas possibilidades de observação.'}))});
  const result=await f.select(different,{slug:'astronomia'});assert.equal(result.length,1);assert.equal(result[0].key,'city:vitrine-city');assert.equal(result[0].title,'Conheça a VitrineCity');assert.equal(result[0].label,'Conteúdo recomendado');
  assert.deepEqual(await fixture([product()]).select(different),[]);assert.deepEqual(await fixture([]).select(story()),[]);
});

test('all public source kinds can be selected, including services, courses, articles, stores and city game/building destinations',async()=>{
  for(const [kind,sourcePath] of [['service','/servicos-digitais.html?servico=jardinagem'],['course','/centro-educacional#jardinagem'],['article','/artigo/jardinagem'],['store','/loja/loja_publica/jardinagem'],['page','/guias/plantas-em-vasos.html']]){
    const f=fixture([{key:kind+':jardinagem',kind,title:'Jardinagem para plantas',summary:'Conheça cuidados para plantas.',sourcePath,image_url:image}]);
    const result=await f.select(story());assert.equal(result.length,1,kind);assert.equal(result[0].kind,kind);assert.equal(new URL(result[0].href,origin).hash,new URL(sourcePath,origin).hash,'course identity remains in fragment');
  }
  const f=fixture([city()]);const games=await f.select(story(10,{title:'Jogos para jogar',description:'Escolha um jogo e divirta-se.',category:'Jogos',pages:story().pages.map(page=>({...page,text:'Escolha um jogo e explore suas regras.'}))}));assert.equal(new URL(games[0].href,origin).pathname,'/vitriny-games.html');assert.equal(games[0].label,'Conteúdo recomendado');
  const building=await f.select(story(10,{title:'Um prédio para seu negócio',description:'Apresente sua empresa na cidade.',category:'Negócios',pages:story().pages.map(page=>({...page,text:'Apresentar seu negócio é uma etapa importante.'}))}));assert.equal(new URL(building[0].href,origin).pathname,'/comprar-lote.html');assert.equal(building[0].label,'Publicidade');
});

test('the full paginated catalog participates, with deterministic rotation rather than the first four courses',async()=>{
  const rows=Array.from({length:205},(_,index)=>product(index+1,{title:'Item genérico '+index,summary:'Sem associação temática.',facts:{category:'Outros',priceCents:100,stockQuantity:2}}));rows.push(product(206));
  assert.equal((await fixture(rows).select(story()))[0].key,'product:206');
  const f=fixture(Array.from({length:8},(_,index)=>product(index+1))),seen=new Set();
  for(let index=0;index<16;index++){const args={slug:'story-'+index,fingerprint:'fixed'};const first=await f.select(story(),args);assert.deepEqual(await f.select(story(),args),first);seen.add(first[0].key);}
  assert(seen.size>4,'different stories distribute equal contextual candidates beyond four fixed entries');
});

test('local-only assets and exact public destinations reject malicious URLs before any image read',async()=>{
  const bad=['javascript:alert(1)','//evil.test/x','https://evil.test/x','/api/ads/serve','/admin','/minha-conta.html','/ir/affiliate','/produto/1/x?access_token=secret','/produto/1/x?next=https://evil.test','/assets/../admin','/produto%2f1%2fx','/produto/1/x?utm_source=web_stories&utm_source=web_stories','/produto/1/x#token'];
  for(const value of bad){assert.equal(safeStoryPromotionDestination(value,origin),null,value);const f=fixture([product(1,{sourcePath:value})]);assert.deepEqual(await f.select(story()),[]);assert.equal(f.calls.length,0);}
  for(const value of ['https://evil.test/image.jpg','//evil.test/image.jpg','/assets/%2e%2e/private.jpg','/uploads/private/file.jpg','/assets/../private.jpg','/api/catalog/product-images/1']){const f=fixture([product(1,{image_url:value})]);assert.deepEqual(await f.select(story()),[]);assert.equal(f.calls.length,0);}
});

test('catalog sources gate unpublished stores, inactive or unavailable stock and broken affiliates without database writes',async t=>{
  const db=new Database(':memory:');t.after(()=>db.close());db.exec(`CREATE TABLE store_profiles(order_reference TEXT,business_name TEXT,review_status TEXT);CREATE TABLE store_products(id INTEGER,store_reference TEXT,name TEXT,description TEXT,category TEXT,price_cents INTEGER,image_url TEXT,active INTEGER,marketplace_enabled INTEGER,stock_quantity INTEGER,available INTEGER);CREATE TABLE affiliate_catalog(slug TEXT,title TEXT,description TEXT,category TEXT,keywords TEXT,platform TEXT,affiliate_url TEXT,image TEXT,status TEXT,availability TEXT,health TEXT);INSERT INTO store_profiles VALUES('store','Loja Jardim','published');INSERT INTO store_products VALUES(1,'store','Vaso de plantas','Vaso para jardinagem.','Jardinagem',2500,'/assets/garden.jpg',1,1,3,1);INSERT INTO affiliate_catalog VALUES('vaso-parceiro','Vaso de plantas parceiro','Conheça o vaso.','Jardinagem','plantas','shopee','https://s.shopee.com.br/official','/assets/garden.jpg','published','available','reachable');`);
  const sourceCatalog=createWebStorySources({db}),assets={image:async url=>({url,width:720,height:1280})},select=createWebStoryPromotions({sourceCatalog,assets,origin}).select;
  assert.equal((await select(story(20))).length,2);
  for(const [field,value] of [['active',0],['marketplace_enabled',0],['stock_quantity',0],['available',0]]){db.prepare(`UPDATE store_products SET ${field}=?`).run(value);assert(!(await select(story(20))).some(item=>item.kind==='product'));db.prepare(`UPDATE store_products SET ${field}=?`).run(field==='stock_quantity'?3:1);}
  db.exec("UPDATE store_profiles SET review_status='pending'");assert(!(await select(story(20))).some(item=>item.kind==='product'));
  for(const [field,value] of [['status','draft'],['availability','unknown'],['health','unreachable'],['affiliate_url','javascript:alert(1)']]){const old=db.prepare(`SELECT ${field} value FROM affiliate_catalog`).get().value;db.prepare(`UPDATE affiliate_catalog SET ${field}=?`).run(value);assert.deepEqual(await select(story(20)),[]);db.prepare(`UPDATE affiliate_catalog SET ${field}=?`).run(old);}
  db.pragma('query_only = ON');const result=await select(story(20));assert.equal(result.length,1);assert.equal(result[0].kind,'affiliate');assert.match(result[0].disclosure,/comissão/);assert.equal(new URL(result[0].href,origin).pathname,'/ofertas/vaso-parceiro');
});

test('withdrawal while another asset is loading is revalidated for every selected item immediately before rendering',async()=>{
  let loads=0;const f=fixture([product(1),product(2)],{onImage(_value,catalog){if(++loads===2)catalog.clear();}});assert.deepEqual(await f.select(story(20)),[]);
  const missing=fixture([product()],{onImage(){throw Error('local image missing');}});assert.deepEqual(await missing.select(story()),[]);
});

test('rendering preserves narrative and canonical, escapes promotions and uses an outlink without delay or a paid ad request',async()=>{
  const original=story(20),snapshot=JSON.stringify(original),f=fixture([product(1,{title:'Vaso "especial" <img src=x onerror=evil()> & plantas'}),product(2,{kind:'affiliate',key:'affiliate:vaso',sourcePath:'/ofertas/vaso',facts:{availability:'available',linkHealth:'reachable',category:'Jardinagem'}})]),promotions=await f.select(original,{slug:'guia'}),html=renderWebStory(original,{origin,slug:'guia',promotions});
  assert.equal(JSON.stringify(original),snapshot);assert.equal((html.match(/class="promotion-layout"/g)||[]).length,2);assert.equal((html.match(/<amp-story-page /g)||[]).length,22);assert.match(html,/Publicidade/);assert.match(html,/Link de afiliado: podemos receber comissão/);assert.doesNotMatch(html,/<img src=x|onerror=evil|<script(?! async| type="application\/ld\+json")/);assert.match(html,/&quot;especial&quot;/);assert.match(html,/&amp; plantas/);assert.match(html,/canonical" href="https:\/\/vitrinecity.test\/stories\/guia/);assert.doesNotMatch(html,/amp-story-auto-ads|ads\/serve|auto-advance-after|setTimeout|amp-analytics/);
  for(const page of original.pages)assert(html.includes(page.text));
  assert.match(html,/\.editorial-layout \.copy > p:first-of-type\{font-size:23px\}/);assert.doesNotMatch(html,/\.editorial-layout \.copy p\{font-size:23px\}/,'editorial credit and page count keep their own small type size');
  for(const match of html.matchAll(/<amp-story-page id="recommendation-\d+"[^>]*>([\s\S]*?)<\/amp-story-page>/g)){assert.match(match[1],/<amp-story-page-outlink layout="nodisplay" theme="light"><a [^>]+>[^<]+<\/a><\/amp-story-page-outlink>$/);assert([...match[1].replace(/<[^>]*>/g,'')].length<180);}
  assert.deepEqual(normalizeStoryPromotions(original,[...promotions,{...promotions[0],key:'evil',afterPage:1,href:'javascript:bad'}],{origin}),promotions);
  if(process.env.VC_STORY_QA_OUTPUT){await fs.mkdir(process.env.VC_STORY_QA_OUTPUT,{recursive:true});await fs.writeFile(path.join(process.env.VC_STORY_QA_OUTPUT,'promotions-public.html'),html);await fs.writeFile(path.join(process.env.VC_STORY_QA_OUTPUT,'promotions-preview.html'),renderWebStory(original,{origin,slug:'guia',preview:true,promotions}));}
});

test('preview/public routes share promotion selection while editorial JSON, source hashes and review gates remain intact',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'story-promotion-http-')),db=new Database(':memory:'),app=express(),source={key:'source',id:'source',kind:'article',slug:'plantas-em-casa',title:'Cuidar das plantas em vasos',summary:story().description,body:story().pages.map(page=>page.text).join(' '),image_url:image,sourcePath:'/artigo/plantas-em-casa',portal:'plantas',commercial:false},f=fixture([source,product()]);
  db.exec('CREATE TABLE editorial_articles(id TEXT,status TEXT)');app.use(express.json());
  const service=setupWebStories({app,db,publicDir:root,dataDir:root,siteUrl:origin,sourceCatalog:f.sourceCatalog,assets:{...f.assets,outputDir:path.join(root,'assets'),poster:async()=>story().poster},requireAdmin:(_req,_res,next)=>next(),sameOriginOnly:(_req,_res,next)=>next()});
  const server=await new Promise(resolve=>{const active=app.listen(0,'127.0.0.1',()=>resolve(active));});t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();await fs.rm(root,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port,call=async(url,body)=>fetch(base+url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
  const item=await service.createManualDraft({sourceKey:'source',draft:story()});const saved=db.prepare('SELECT draft_json,source_hash,revision FROM editorial_web_stories').get();
  assert.equal((await call('/api/admin/web-stories/'+item.id+'/publish',{revision:1,reviewed:true,rightsConfirmed:true})).status,409);
  const preview=await(await call('/api/admin/web-stories/'+item.id+'/preview',{revision:1})).json();assert.match(preview.html,/class="promotion-layout"/);
  const framed=await(await call(preview.url)).text();assert.deepEqual([...framed.matchAll(/href="([^"]+utm_[^"]+)"/g)].map(match=>match[1]),[...preview.html.matchAll(/href="([^"]+utm_[^"]+)"/g)].map(match=>match[1]));
  assert.equal((await call('/api/admin/web-stories/'+item.id+'/publish',{revision:1,reviewed:true,rightsConfirmed:true})).status,200);
  db.pragma('query_only = ON');const publicResponse=await call(item.url);assert.equal(publicResponse.status,200);const published=await publicResponse.text();assert.match(published,/class="promotion-layout"/);assert.deepEqual([...published.matchAll(/href="([^"]+utm_[^"]+)"/g)].map(match=>match[1]),[...preview.html.matchAll(/href="([^"]+utm_[^"]+)"/g)].map(match=>match[1]));
  assert.deepEqual(db.prepare('SELECT draft_json,source_hash,revision FROM editorial_web_stories').get(),saved);assert.equal(db.prepare('SELECT published_json FROM editorial_web_stories').get().published_json,saved.draft_json);
  f.catalog.delete('product:1');assert.doesNotMatch(await(await call(item.url)).text(),/class="promotion-layout"/);assert.deepEqual(db.prepare('SELECT draft_json,source_hash,revision FROM editorial_web_stories').get(),saved);
});
