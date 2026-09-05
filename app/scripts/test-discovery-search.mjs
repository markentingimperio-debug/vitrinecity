import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import { setupDiscoverySearch, normalizeSearch } from '../discovery-search.js';

const db = new Database(':memory:');
db.exec(`CREATE TABLE store_profiles(order_reference TEXT PRIMARY KEY,business_name TEXT,description TEXT,
  logo_url TEXT,facade_url TEXT,city TEXT,website_url TEXT,promotion_text TEXT,review_status TEXT,whatsapp TEXT,instagram_url TEXT);
CREATE TABLE lot_orders(reference TEXT PRIMARY KEY,segment TEXT,lot_code TEXT);
CREATE TABLE store_products(id INTEGER PRIMARY KEY,store_reference TEXT,name TEXT,description TEXT,category TEXT,price_cents INTEGER,image_url TEXT,active INTEGER);
CREATE TABLE marketplace_product_reviews(product_id INTEGER,rating INTEGER,status TEXT,verified_purchase INTEGER);`);
for (const [id,city,status] of [['published','São Paulo','published'],['hidden','São Paulo','pending'],['other','Goiânia','published']]) {
  db.prepare('INSERT INTO lot_orders VALUES (?,?,?)').run(id,'Receitas e cozinha',id);
  db.prepare('INSERT INTO store_profiles(order_reference,business_name,description,city,review_status) VALUES (?,?,?,?,?)')
    .run(id,'Confeitaria '+id,'Bolos e café',city,status);
}
for (const [id,ref,name,active] of [[1,'published','Bolo de café',1],[2,'published','Bolo de café',1],[3,'hidden','Bolo secreto',1],[4,'other','Bolo goiano',1],[5,'published','Bolo inativo',0],[6,'published','Forma para bolo',1]]) {
  db.prepare('INSERT INTO store_products VALUES (?,?,?,?,?,?,?,?)').run(id,ref,name,'Receita especial','Cozinha',2000,'',active);
}
db.exec("INSERT INTO marketplace_product_reviews VALUES (2,5,'published',1),(2,5,'published',1),(1,5,'published',0),(1,5,'pending',1)");
const app = express();setupDiscoverySearch(app,db,row=>'/loja/'+row.order_reference,()=>[{title:'Bolo simples',description:'Receita publicada',url:'/receitas/bolo',kind:'recipe'},{title:'Futebol',description:'Esportes',url:'/esportes/futebol',kind:'sports'}]);
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
  console.log('discovery-search: all behavioral checks passed');
} finally { await new Promise(resolve=>server.close(resolve));db.close(); }
