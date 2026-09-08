import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import { setupDiscoverySearch, normalizeSearch } from '../discovery-search.js';

const db = new Database(':memory:');
db.exec(`CREATE TABLE store_profiles(order_reference TEXT PRIMARY KEY,business_name TEXT,description TEXT,
  logo_url TEXT,facade_url TEXT,city TEXT,website_url TEXT,promotion_text TEXT,review_status TEXT,whatsapp TEXT,instagram_url TEXT);
CREATE TABLE lot_orders(reference TEXT PRIMARY KEY,segment TEXT,lot_code TEXT);
CREATE TABLE store_products(id INTEGER PRIMARY KEY,store_reference TEXT,name TEXT,description TEXT,category TEXT,price_cents INTEGER,image_url TEXT,active INTEGER);
CREATE TABLE marketplace_product_reviews(product_id INTEGER,rating INTEGER,status TEXT,verified_purchase INTEGER);
CREATE TABLE editorial_articles(slug TEXT,title TEXT,summary TEXT,portal TEXT,body TEXT,image_url TEXT,status TEXT,published_at TEXT);
CREATE TABLE digital_books(slug TEXT,title TEXT,summary TEXT,category TEXT,keywords_json TEXT,cover_url TEXT,price_cents INTEGER,status TEXT,published_at TEXT);`);
for (const [id,city,status] of [['published','São Paulo','published'],['hidden','São Paulo','pending'],['other','Goiânia','published']]) {
  db.prepare('INSERT INTO lot_orders VALUES (?,?,?)').run(id,'Receitas e cozinha',id);
  db.prepare('INSERT INTO store_profiles(order_reference,business_name,description,city,review_status) VALUES (?,?,?,?,?)')
    .run(id,'Confeitaria '+id,'Bolos e café',city,status);
}
for (const [id,ref,name,active] of [[1,'published','Bolo de café',1],[2,'published','Bolo de café',1],[3,'hidden','Bolo secreto',1],[4,'other','Bolo goiano',1],[5,'published','Bolo inativo',0],[6,'published','Forma para bolo',1]]) {
  db.prepare('INSERT INTO store_products VALUES (?,?,?,?,?,?,?,?)').run(id,ref,name,'Receita especial','Cozinha',2000,'',active);
}
db.exec("INSERT INTO marketplace_product_reviews VALUES (2,5,'published',1),(2,5,'published',1),(1,5,'published',0),(1,5,'pending',1)");
db.prepare('INSERT INTO editorial_articles VALUES (?,?,?,?,?,?,?,?)').run('cuidar-de-plantas','Como cuidar de plantas em casa','Luz e rega adequadas','jardinagem','Confira o substrato e a drenagem.','/assets/planta.webp','published','2026-09-08');
db.prepare('INSERT INTO editorial_articles VALUES (?,?,?,?,?,?,?,?)').run('plantas-rascunho','Segredo das plantas','Rascunho privado','jardinagem','Não publicar.','','draft','2026-09-08');
db.prepare('INSERT INTO digital_books VALUES (?,?,?,?,?,?,?,?,?)').run('livro-plantas','Plantas em casa','Cuidados de cultivo','jardinagem','["zamioculca"]','/assets/livro.webp',999,'published','2026-09-08');
db.prepare('INSERT INTO digital_books VALUES (?,?,?,?,?,?,?,?,?)').run('livro-privado','Plantas secretas','Rascunho','jardinagem','[]','',999,'writing','2026-09-08');
const app = express();setupDiscoverySearch(app,db,row=>'/loja/'+row.order_reference,()=>[{title:'Bolo simples',description:'Receita publicada',url:'/receitas/bolo',kind:'recipe'},{title:'Futebol',description:'Esportes',url:'/esportes/futebol',kind:'sports'},
  {title:'Curso de plantas em vasos',description:'Aprenda jardinagem em casa',url:'/centro-educacional.html#plantas',kind:'course'},
  {title:'Kit para plantas',description:'Seleção com link de afiliado para cultivar em vasos',url:'/ofertas/kit-plantas',kind:'article'}]);
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const get=async(route,q,city='')=>{const r=await fetch(origin+route+'?'+new URLSearchParams({q,city}));assert.equal(r.status,200);return r.json();};
try {
  assert.equal(normalizeSearch('  São  PAULO! '),'sao paulo');
  let result=await get('/api/discovery/search','cafe bolo','sao paulo');
  assert.deepEqual(result.products.map(p=>p.id),[2,1], 'Word order and accents match; verified reviews break ties.');
  assert.equal(result.products[1].verifiedReviews,0,'Unverified or pending reviews cannot improve trust.');
  assert.equal(result.products[0].productUrl,'/produto/2/bolo-de-cafe');
  result=await get('/api/discovery/search','bolo');
  assert.deepEqual(new Set(result.products.map(p=>p.id)),new Set([1,2,4,6]));
  assert.ok(result.products.find(p=>p.id===6));
  result=await get('/api/discovery/search/suggestions','bolo');
  assert.ok(!result.suggestions.some(p=>/secreto|inativo/.test(p.label)),'Unpublished inventory never leaks through suggestions.');
  assert.equal(result.suggestions.filter(p=>p.label==='Bolo de café').length,1);
  assert.equal((await get('/api/discovery/search','bolo','cidade inexistente')).products.length,0);
  assert.equal((await get('/api/discovery/search','%')).products.length,0);
  assert.equal((await get('/api/discovery/search',"' OR 1=1 --")).products.length,0);
  assert.equal((await get('/api/discovery/search','x')).stores.length,0);
  result=await get('/api/discovery/search','como fazer bolo');
  assert.equal(result.contents[0].url,'/receitas/bolo');
  assert.deepEqual(new Set(result.products.map(p=>p.id)),new Set([1,2,4,6]),'Related inventory remains products, separately from published recipes.');
  assert.equal(result.contents.length,1,'Only the explicitly published content is a recipe.');
  result=await get('/api/discovery/search/suggestions','como fazer bol');assert.ok(!result.suggestions.some(item=>item.label==='Futebol'),'Partial words must begin at word boundaries.');
  for (const q of ['TikTok Ads','como anunciar no tik tok','como criar uma campanha no TikTok','quanto custa um anúncio no tiktok','tráfego pago no TikTok']) {
    result=await get('/api/discovery/search',q);
    assert.equal(result.contents[0].url,'https://getstartedtiktok.partnerlinks.io/gzte5cj93jzz');
    assert.equal(result.contents[0].kind,'affiliate');assert.match(result.contents[0].description,/comissão/);
    assert.equal(result.contents[1].url,'/artigos/tiktok-ads.html');
  }
  for (const q of ['TikTok Shop afiliado','baixar vídeos do TikTok','Google Ads','como fazer bolo','tiktok','tiktok addsong','TikTok Ads futebol','TikTok Ads plantas']) {
    result=await get('/api/discovery/search',q);assert.ok(!result.contents.some(item=>item.kind==='affiliate'));
  }
  result=await get('/api/discovery/search/suggestions','tik tok ads');assert.equal(result.suggestions[0].category,'Oferta de afiliado');
  result=await get('/api/discovery/search','confetaria');assert.equal(result.suggestedQuery,'confeitaria');assert.equal(result.stores.length,0,'Never silently replace the query');
  result=await get('/api/discovery/search/suggestions','confetaria');assert.equal(result.suggestions[0].label,'confeitaria');
  result=await get('/api/discovery/search','confetaria','cidade inexistente');assert.equal(result.suggestedQuery,null,'Correction respects city filter');
  db.prepare('INSERT INTO store_profiles(order_reference,business_name,description,city,review_status) VALUES (?,?,?,?,?)').run('official_agrotecnica','Agrotecnica','Loja oficial','São Paulo','published');
  db.prepare('INSERT INTO store_products VALUES (?,?,?,?,?,?,?,?)').run(100,'official_agrotecnica','Bolo especial','Bolo','Cozinha',2500,'',1);
  db.prepare('INSERT INTO store_products VALUES (?,?,?,?,?,?,?,?)').run(101,'official_agrotecnica','Bolo indisponível','Bolo','Cozinha',2500,'',0);
  result=await get('/api/discovery/search','bolo');
  assert.equal(result.products[0].id,100);assert.equal(result.products[0].officialStore,true);assert.match(result.products[0].rankReason,/Prioridade da plataforma/);
  assert.equal((await get('/api/discovery/search/suggestions','bolo')).suggestions[0].label,'Bolo especial');
  assert.equal(result.products.find(p=>p.id===2).officialStore,false);assert.ok(!result.products.some(p=>p.id===101));
  assert.ok(!(await get('/api/discovery/search','bolo','Goiânia')).products.some(p=>p.officialStore),'Official priority must preserve city filter');
  assert.ok(!(await get('/api/discovery/search','parafusadeira')).products.some(p=>p.officialStore),'Never inject unrelated official products');
  db.prepare("UPDATE store_profiles SET review_status='pending' WHERE order_reference='official_agrotecnica'").run();
  assert.ok(!(await get('/api/discovery/search','bolo')).products.some(p=>p.officialStore),'Unpublished official stores remain hidden');
  result=await get('/api/discovery/search','plantas');
  const urls=result.contents.map(item=>item.url);
  for(const url of ['/artigo/cuidar-de-plantas','/livro/livro-plantas','/guias/plantas-em-vasos.html','/centro-educacional.html#plantas','/ofertas/kit-plantas'])assert.ok(urls.includes(url),url+' is available in the primary internal search');
  assert.ok(result.contents.every(item=>!item.searchText),'Article bodies never leak into search responses');
  assert.ok(!urls.some(url=>/rascunho|privado|futebol/.test(url)),'Drafts and unrelated content stay absent');
  result=await get('/api/discovery/search','curso plantas');assert.equal(result.contents[0].url,'/centro-educacional.html#plantas');assert.equal(result.contents.length,1,'Every meaningful query term must match');
  result=await get('/api/discovery/search','substrato drenagem');assert.ok(result.contents.some(item=>item.url==='/artigo/cuidar-de-plantas'),'Published article body supports relevant discovery');
  result=await get('/api/discovery/search','zamioculca');assert.equal(result.contents[0].url,'/livro/livro-plantas','Published book keywords are indexed');
  result=await get('/api/discovery/search','plantas','cidade inexistente');assert.ok(result.contents.some(item=>item.kind==='book'),'The city filter applies to local inventory, not digital content');
  result=await get('/api/discovery/search/suggestions','plantas');assert.ok(result.suggestions.some(item=>item.category==='Livro digital'));assert.ok(result.suggestions.every(item=>!/rascunho|secretas|futebol/i.test(item.label)));
  result=await get('/api/discovery/search','astronomia marciana');assert.equal(result.contents.length+result.products.length+result.stores.length,0,'An external-only query gets no unrelated internal promotion');
  db.exec('DROP TABLE editorial_articles; DROP TABLE digital_books;');
  result=await get('/api/discovery/search','plantas');assert.ok(result.contents.some(item=>item.kind==='course'),'An installation without optional editorial tables still searches existing courses and catalogs');
  console.log('discovery-search: relevant official inventory, published articles/books/courses/affiliate pages, strict matching, drafts, city filtering and external-only fallback passed');
} finally { await new Promise(resolve=>server.close(resolve));db.close(); }
