import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import express from 'express';
import Database from 'better-sqlite3';
import {marketplaceSlug,publicStorePath,renderPublicStorePage} from '../marketplace-public.js';
import {renderReviewPhotos,renderImportedReviewSource} from '../review-importer.js';

const source=readFileSync(new URL('../server.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
function extract(start,end){
  const first=source.indexOf(start),last=source.indexOf(end,first+start.length);
  assert.ok(first>=0&&last>first,`Server fixture missing: ${start}`);
  return source.slice(first,last);
}
// Execute the actual public route SQL and renderers, not an imitation of eligibility.
const publicRoutes=extract('function marketplaceProductSlug(',"\napp.get('/cidade/:slug',");
const escape=extract('function escapeHtml(','\nfunction managementSecret(');

async function fixture(t){
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE store_profiles(order_reference TEXT PRIMARY KEY,business_name TEXT,review_status TEXT,
      description TEXT,logo_url TEXT,facade_url TEXT,website_url TEXT,instagram_url TEXT,tiktok_url TEXT,
      google_maps_url TEXT,whatsapp TEXT,promotion_text TEXT,address TEXT,city TEXT,state TEXT,postal_code TEXT,
      location_notes TEXT,video_url TEXT,gallery_1_url TEXT,gallery_2_url TEXT,gallery_3_url TEXT);
    CREATE TABLE store_products(id INTEGER PRIMARY KEY,store_reference TEXT,name TEXT,description TEXT,category TEXT,
      price_cents INTEGER,image_url TEXT,product_url TEXT DEFAULT '',product_type TEXT DEFAULT 'physical',sku TEXT,
      stock_quantity INTEGER,weight_grams INTEGER,variation_label TEXT,delivery_min_days INTEGER DEFAULT 2,
      delivery_max_days INTEGER DEFAULT 5,return_days INTEGER DEFAULT 7,updated_at TEXT,
      active INTEGER NOT NULL DEFAULT 1,marketplace_enabled INTEGER NOT NULL DEFAULT 1,available INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT);
    CREATE TABLE marketplace_product_reviews(id INTEGER PRIMARY KEY,product_id INTEGER,user_id INTEGER,status TEXT,
      rating INTEGER,title TEXT,body TEXT,verified_purchase INTEGER,created_at TEXT);
    CREATE TABLE marketplace_review_sources(review_id INTEGER,author_name TEXT,source TEXT,source_url TEXT,variation TEXT);
    CREATE TABLE marketplace_review_photos(id INTEGER PRIMARY KEY,review_id INTEGER,status TEXT,url TEXT);
    INSERT INTO store_profiles(order_reference,business_name,review_status) VALUES('store','Loja Fixture','published');
    INSERT INTO store_products(id,store_reference,name,description,category,price_cents,stock_quantity,available,updated_at)
      VALUES(1,'store','Produto disponível','Item disponível da fixture','Adubos',1899,5,1,'2026-09-15'),
        (2,'store','Produto pausado','Item pausado da fixture','Adubos',2599,8,0,'2026-09-15');`);
  const app=express();
  vm.runInNewContext(`${escape}\n${publicRoutes}`,{
    app,db,marketplaceSlug,publicStorePath,renderPublicStorePage,renderReviewPhotos,renderImportedReviewSource,
    URL,URLSearchParams,SITE_URL:'https://vitrinecity.test',
    // Decoration and the error shell have no role in product selection or pricing.
    decorateExplorationPage:html=>html,publicErrorPage:(res,status)=>res.status(status).send('Página não encontrada.'),
    safePublicUrl:(_value,_origin,fallback)=>fallback
  });
  const server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const get=async pathname=>{const r=await fetch(`http://127.0.0.1:${server.address().port}${pathname}`,{redirect:'manual'});return {status:r.status,location:r.headers.get('location'),body:await r.text()};};
  return {db,get};
}

test('store and category show only available products without changing catalog values',async t=>{
  const f=await fixture(t),before=f.db.prepare('SELECT * FROM store_products ORDER BY id').all();
  for(const path of ['/loja/store/loja-fixture','/categoria/adubos']){
    const r=await f.get(path);assert.equal(r.status,200);
    assert.match(r.body,/href="\/produto\/1\/produto-disponivel"/);assert.match(r.body,/18,99/);
    assert.doesNotMatch(r.body,/Produto pausado|\/produto\/2(?:\/|\")|25,99/);
  }
  assert.deepEqual(f.db.prepare('SELECT * FROM store_products ORDER BY id').all(),before);
});

test('an available product retains its page, exact price, stock and canonical redirect',async t=>{
  const f=await fixture(t),old=await f.get('/produto/1');
  assert.equal(old.status,301);assert.equal(old.location,'/produto/1/produto-disponivel');
  const r=await f.get(old.location);assert.equal(r.status,200);
  assert.match(r.body,/<h1>Produto disponível<\/h1>/);assert.match(r.body,/>Adicionar ao carrinho<\/button>/);
  const schemas=[...r.body.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(match=>JSON.parse(match[1]));
  const product=schemas.find(value=>value['@type']==='Product');
  assert.equal(product.offers.price,'18.99');assert.equal(product.offers.availability,'https://schema.org/InStock');
  assert.equal(product.offers.inventoryLevel.value,5);
});

test('a paused product is 404 even with stock, a legacy URL, Lia context or a direct buy URL',async t=>{
  const f=await fixture(t);f.db.prepare('UPDATE store_products SET product_url=? WHERE id=2').run('https://partner.test/item');
  for(const path of ['/produto/2','/produto/2/produto-pausado','/produto/2/old-name?lia=1']){
    const r=await f.get(path);assert.equal(r.status,404);assert.equal(r.location,null);
    assert.doesNotMatch(r.body,/InStock|Adicionar ao carrinho|partner\.test|25,99/);
  }
});

test('pausing the final product keeps the store public but removes the product and empty category',async t=>{
  const f=await fixture(t);f.db.exec('UPDATE store_products SET available=0 WHERE id=1');
  const store=await f.get('/loja/store/loja-fixture');assert.equal(store.status,200);
  assert.doesNotMatch(store.body,/href="\/produto\//);
  assert.equal((await f.get('/categoria/adubos')).status,404);
  assert.equal((await f.get('/produto/1/produto-disponivel')).status,404);
  f.db.exec('UPDATE store_products SET available=1 WHERE id=1');
  assert.equal((await f.get('/categoria/adubos')).status,200);
  assert.equal((await f.get('/produto/1/produto-disponivel')).status,200);
});

for(const [name,sql] of [
  ['inactive','UPDATE store_products SET active=0'],
  ['marketplace disabled','UPDATE store_products SET marketplace_enabled=0'],
  ['no stock','UPDATE store_products SET stock_quantity=0'],
  ['no price','UPDATE store_products SET price_cents=0'],
  ['unpublished store',"UPDATE store_profiles SET review_status='review'"]
])test(`availability never overrides the existing ${name} restriction`,async t=>{
  const f=await fixture(t);f.db.exec('UPDATE store_products SET available=1');f.db.exec(sql);
  assert.equal((await f.get('/produto/1/produto-disponivel')).status,404);
  assert.equal((await f.get('/categoria/adubos')).status,404);
  const store=await f.get('/loja/store/loja-fixture');
  assert.equal(store.status,name==='unpublished store'?404:200);assert.doesNotMatch(store.body,/href="\/produto\//);
});
