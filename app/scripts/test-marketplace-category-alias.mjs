import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import express from 'express';
import Database from 'better-sqlite3';
import {marketplaceSlug} from '../marketplace-public.js';

const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
function extract(start,end){
  const first=source.indexOf(start),last=source.indexOf(end,first+start.length);
  assert.ok(first>=0&&last>first,`Server fixture missing: ${start}`);
  return source.slice(first,last);
}
const handler=extract("app.get('/categoria/:slug',", "\napp.get('/cidade/:slug',");
const renderer=extract('function renderIndexableListingPage(', "\napp.get(['/loja/:reference'");
const escape=extract('function escapeHtml(', '\nfunction managementSecret(');

async function fixture(t){
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE store_profiles(order_reference TEXT PRIMARY KEY,business_name TEXT,review_status TEXT);
    CREATE TABLE store_products(id INTEGER PRIMARY KEY,store_reference TEXT,name TEXT,description TEXT,category TEXT,
      active INTEGER,marketplace_enabled INTEGER,price_cents INTEGER,stock_quantity INTEGER,image_url TEXT,updated_at TEXT,available INTEGER NOT NULL DEFAULT 1);
    INSERT INTO store_profiles VALUES('store','Agrotecnica','published');
    INSERT INTO store_products VALUES(20,'store','Terra vegetal','Terra para plantio','Terras e Substratos',1,1,1000,3,'','2026-09-13',1);`);
  const app=express();
  vm.runInNewContext(`${escape}\n${renderer}\n${handler}`,{
    app,db,marketplaceSlug,URL,SITE_URL:'https://vitrinecity.com',PRODUCT_FALLBACK_PATH:'/assets/store-seed/utilidades.svg',
    safePublicUrl:(_value,_origin,fallback)=>fallback
  });
  const server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const get=async pathname=>{const r=await fetch(`http://127.0.0.1:${server.address().port}${pathname}`,{redirect:'manual'});return {status:r.status,location:r.headers.get('location'),body:await r.text()};};
  return {db,get};
}

test('legacy category permanently redirects once to the eligible canonical category',async t=>{
  const f=await fixture(t),before=f.db.prepare('SELECT * FROM store_products').all();
  const old=await f.get('/categoria/terra-e-substratos');
  assert.equal(old.status,301);assert.equal(old.location,'/categoria/terras-e-substratos');
  const current=await f.get(old.location);
  assert.equal(current.status,200);assert.equal(current.location,null);
  assert.match(current.body,/<link rel="canonical" href="https:\/\/vitrinecity.com\/categoria\/terras-e-substratos">/);
  assert.match(current.body,/<h1>Terras e Substratos<\/h1>/);
  assert.match(current.body,/href="\/produto\/20\/terra-vegetal"/);
  assert.deepEqual(f.db.prepare('SELECT * FROM store_products').all(),before);
});

test('redirect keeps only valid Lia context and never reflects destination or arbitrary query parameters',async t=>{
  const f=await fixture(t);
  for(const query of ['?returnTo=https%3A%2F%2Fevil.test&redirect=%2Fadmin&slug=adubos','?lia=2','?lia=1&lia=2','?lia%5Bredirect%5D=https%3A%2F%2Fevil.test']){
    assert.equal((await f.get('/categoria/terra-e-substratos'+query)).location,'/categoria/terras-e-substratos');
  }
  const old=await f.get('/categoria/terra-e-substratos?lia=1&returnTo=%2Fadmin&next=https%3A%2F%2Fevil.test');
  assert.equal(old.status,301);assert.equal(old.location,'/categoria/terras-e-substratos?lia=1');
  const current=await f.get(old.location);
  assert.equal(current.status,200);
  assert.match(current.body,/<link rel="canonical" href="https:\/\/vitrinecity.com\/categoria\/terras-e-substratos">/);
});

for(const [name,sql] of [
  ['inactive product','UPDATE store_products SET active=0'],
  ['paused product','UPDATE store_products SET available=0'],
  ['marketplace disabled','UPDATE store_products SET marketplace_enabled=0'],
  ['no stock','UPDATE store_products SET stock_quantity=0'],
  ['no price','UPDATE store_products SET price_cents=0'],
  ['unpublished store',"UPDATE store_profiles SET review_status='review'"],
  ['missing store','DELETE FROM store_profiles'],
  ['different category',"UPDATE store_products SET category='Adubos'"],
  ['missing product','DELETE FROM store_products']
])test(`legacy category remains 404 when the destination has ${name}`,async t=>{
  const f=await fixture(t);f.db.exec(sql);
  for(const slug of ['terra-e-substratos','terras-e-substratos']){
    const response=await f.get('/categoria/'+slug);
    assert.equal(response.status,404);assert.equal(response.location,null);
  }
});

test('alias is exact and never absorbs unrelated categories',async t=>{
  const f=await fixture(t);
  for(const path of ['/categoria/terra-e-substrato','/categoria/terra-e-substratos-extra']){
    const response=await f.get(path);assert.equal(response.status,404);assert.equal(response.location,null);
  }
  f.db.prepare('UPDATE store_products SET category=?').run('Adubos');
  const category=await f.get('/categoria/adubos');
  assert.equal(category.status,200);assert.equal(category.location,null);
  assert.match(category.body,/<link rel="canonical" href="https:\/\/vitrinecity.com\/categoria\/adubos">/);
});
