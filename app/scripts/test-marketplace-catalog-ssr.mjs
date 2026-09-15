import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import express from 'express';
import Database from 'better-sqlite3';
import {publicMarketplaceProducts,renderMarketplaceCatalog} from '../marketplace-catalog-ssr.js';

const dir=fileURLToPath(new URL('..',import.meta.url));
const page=fs.readFileSync(path.join(dir,'public/loja.html'),'utf8');
const serverSource=fs.readFileSync(path.join(dir,'server.js'),'utf8');
function between(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return source.slice(a,b);}
const grid=html=>between(html,'<div class="grid" id="products">','</main>');
function fixture(t){
  const db=new Database(':memory:');t.after(()=>db.close());
  db.exec(`CREATE TABLE store_profiles(order_reference TEXT PRIMARY KEY,business_name TEXT,review_status TEXT,
      business_type TEXT,preparation_min_minutes INTEGER,preparation_max_minutes INTEGER,accepting_orders INTEGER,fulfillment_mode TEXT);
    CREATE TABLE store_products(id INTEGER PRIMARY KEY,store_reference TEXT,name TEXT,description TEXT,category TEXT,
      price_cents INTEGER,image_url TEXT,product_url TEXT,sku TEXT,stock_quantity INTEGER,variation_label TEXT,
      delivery_min_days INTEGER,delivery_max_days INTEGER,return_days INTEGER,product_type TEXT,menu_category_id INTEGER,
      menu_sort_order INTEGER,preparation_minutes INTEGER,available INTEGER,active INTEGER,marketplace_enabled INTEGER,updated_at TEXT);
    CREATE TABLE marketplace_product_reviews(product_id INTEGER,status TEXT,rating INTEGER);
    INSERT INTO store_profiles VALUES('store','Agrotécnica','published','physical',0,0,1,'shipping');
    INSERT INTO store_products(id,store_reference,name,description,category,price_cents,image_url,product_url,stock_quantity,
      product_type,available,active,marketplace_enabled,updated_at)
      VALUES(11,'store','Adubo para rosa','Nutrição das plantas','Adubos',1899,'/assets/adubo.jpg','https://shop.example/item',5,'physical',1,1,1,'2026-09-13');
    INSERT INTO marketplace_product_reviews VALUES(11,'published',5),(11,'published',3),(11,'rejected',1);`);
  return db;
}
async function httpFixture(t,db){
  const app=express();
  const shop=between(serverSource,"app.get('/loja',", "app.get(['/entregas'");
  const api=between(serverSource,"app.get('/api/marketplace/products',", "app.get('/api/customer/favorite-stores'");
  vm.runInNewContext(shop+'\n'+api,{app,db,fs,path,dir,SITE_URL:'https://vitrinecity.com',publicMarketplaceProducts,renderMarketplaceCatalog});
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return async(url,options={})=>{const r=await fetch(`http://127.0.0.1:${server.address().port}${url}`,{redirect:'manual',...options});return {status:r.status,location:r.headers.get('location'),body:await r.text()};};
}

test('the real shop route includes public product/store links and exact API prices without JavaScript',async t=>{
  const db=fixture(t),get=await httpFixture(t,db),r=await get('/loja'),api=JSON.parse((await get('/api/marketplace/products')).body);
  assert.equal(r.status,200);assert.equal(r.location,null);assert.equal(api.products.length,1);
  assert.equal(api.products[0].rating_average,4);assert.equal(api.products[0].rating_count,2);
  const initial=grid(r.body);assert.equal((initial.match(/<article class="card">/g)||[]).length,1);
  assert.match(initial,/href="\/produto\/11\/adubo-para-rosa"/);assert.match(initial,/href="\/loja\/store\/agrotecnica"/);
  assert.match(initial,/18,99/);assert.match(initial,/>Ver produto<\/a>/);
  assert.doesNotMatch(initial,/data-add|Carregando|shop\.example/);
  assert.match(r.body,/<link rel="canonical" href="https:\/\/vitrinecity.com\/loja">/);
  assert.match(r.body,/src="\/marketplace-terms\.js"/);
  assert.match(r.body,/id="marketplaceTerms"/);assert.match(r.body,/\/api\/marketplace\/checkout/);
  assert.equal((await get('/loja',{method:'HEAD'})).status,200);
});

for(const [condition,sql] of [
  ['inactive','UPDATE store_products SET active=0'],
  ['not in marketplace','UPDATE store_products SET marketplace_enabled=0'],
  ['unavailable','UPDATE store_products SET available=0'],
  ['no stock','UPDATE store_products SET stock_quantity=0'],
  ['no price','UPDATE store_products SET price_cents=0'],
  ['store not published',"UPDATE store_profiles SET review_status='review'"],
  ['missing store','DELETE FROM store_profiles']
])test(`SSR and JSON API both exclude ${condition}`,async t=>{
  const db=fixture(t),get=await httpFixture(t,db);db.exec(sql);
  const html=(await get('/loja')).body,api=JSON.parse((await get('/api/marketplace/products')).body);
  assert.equal(api.products.length,0);assert.doesNotMatch(grid(html),/href="\/produto\//);
  assert.match(grid(html),/Nenhum produto disponível/);assert.doesNotMatch(grid(html),/Carregando/);
});

test('category, search, local delivery and referer filters preserve the public API contract',async t=>{
  const db=fixture(t),get=await httpFixture(t,db);
  for(const query of ['?q=rosa','?q=Agrot%C3%A9cnica','?category=Adubos','?q=%20rosa%20&category=%20Adubos%20']){
    assert.match(grid((await get('/loja'+query)).body),/\/produto\/11\//);
    assert.equal(JSON.parse((await get('/api/marketplace/products'+query)).body).products.length,1);
  }
  for(const query of ['?q=ausente','?category=ausente',"?q=%27%20OR%201%3D1--",'?delivery=local']){
    assert.doesNotMatch(grid((await get('/loja'+query)).body),/href="\/produto\//);
    assert.equal(JSON.parse((await get('/api/marketplace/products'+query)).body).products.length,0);
  }
  assert.equal(JSON.parse((await get('/api/marketplace/products',{headers:{referer:'https://vitrinecity.com/loja?delivery=local'}})).body).products.length,0);
  db.exec("UPDATE store_profiles SET fulfillment_mode='local'");
  assert.equal(publicMarketplaceProducts(db,{delivery:'LOCAL'}).length,1);
  db.exec("UPDATE store_profiles SET fulfillment_mode='shipping'; UPDATE store_products SET product_type='digital'");
  assert.equal(publicMarketplaceProducts(db,{delivery:'local'}).length,1);
  const long='a'.repeat(80);db.prepare('UPDATE store_products SET name=?').run(long);
  assert.equal(publicMarketplaceProducts(db,{q:long+'ignored-tail'}).length,1);
});

test('cart and Lia parameters retain the same catalog and do not redirect or change canonical',async t=>{
  const db=fixture(t),get=await httpFixture(t,db),plain=(await get('/loja')).body;
  for(const query of ['?carrinho=1','?lia=1&carrinho=1']){
    const response=await get('/loja'+query);assert.equal(response.status,200);assert.equal(response.location,null);
    assert.equal(grid(response.body),grid(plain));
    assert.match(response.body,/pageParams.get\('carrinho'\)===\s*'1'/);
    assert.equal((response.body.match(/rel="canonical"/g)||[]).length,1);
  }
});

test('SSR escapes catalog text and rejects executable image URLs without leaking external purchase URLs',t=>{
  const db=fixture(t);db.prepare('UPDATE store_products SET name=?,category=?,image_url=?,product_url=?').run('Rosa "><script>alert(1)</script>','<img onerror=evil>','javascript:alert(1)','https://evil.example/secret');
  db.prepare('UPDATE store_profiles SET business_name=?,order_reference=?').run('Loja "<x>','store"><x>');
  db.prepare('UPDATE store_products SET store_reference=?').run('store"><x>');
  const initial=grid(renderMarketplaceCatalog(page,publicMarketplaceProducts(db)));
  assert.match(initial,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);assert.match(initial,/Loja &quot;&lt;x&gt;/);
  assert.match(initial,/src="https:\/\/vitrinecity.com\/assets\/store-seed\/utilidades.svg"/);
  assert.doesNotMatch(initial,/<script|<img onerror|javascript:|evil\.example|secret/);
  assert.match(initial,/store%22%3E%3Cx%3E/);
});

test('selection keeps the latest 120 eligible entries in the existing stable order',t=>{
  const db=fixture(t);
  const row=db.prepare('SELECT * FROM store_products').get(),keys=Object.keys(row);
  const insert=db.prepare(`INSERT INTO store_products(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`);
  for(let id=12;id<=140;id++)insert.run(...keys.map(key=>key==='id'?id:row[key]));
  const result=publicMarketplaceProducts(db);
  assert.equal(result.length,120);assert.equal(result[0].id,140);assert.equal(result.at(-1).id,21);
});

function loadFixture(fetch){
  const status={textContent:''},box={innerHTML:'<article class="card"><a href="/produto/11/adubo">Ver produto</a></article>',querySelector(){return this.innerHTML.includes('<article')?{}:null;}};
  const context=vm.createContext({URLSearchParams,fetch,search:{value:''},location:{search:''},productsBox:box,document:{getElementById:()=>status},console});
  const render=between(page,'function render(){','async function load(){');
  const load=between(page,'async function load(){',"const productsBox=document.getElementById('products')");
  vm.runInContext("let products=[],catalogLoaded=false,catalogRequest=0;const PRODUCT_FALLBACK='/assets/store-seed/utilidades.svg',esc=v=>String(v),slug=v=>String(v),money=v=>String(v);"+render+load,context);
  return {context,status,box,load:()=>vm.runInContext('load()',context),render:()=>vm.runInContext('render()',context)};
}
for(const [name,fetcher] of [
  ['network failure',async()=>{throw Error('network');}],
  ['HTTP 503',async()=>({ok:false,json:async()=>({error:'unavailable'})})],
  ['malformed payload',async()=>({ok:true,json:async()=>({})})]
])test(`the real browser load preserves SSR cards on ${name}`,async()=>{
  const f=loadFixture(fetcher),before=f.box.innerHTML;
  f.render();assert.equal(f.box.innerHTML,before,'early module render cannot erase SSR');
  await f.load();assert.equal(f.box.innerHTML,before);assert.match(f.status.textContent,/Não foi possível atualizar a busca/);
  assert.equal(vm.runInContext('catalogLoaded',f.context),false);
});

test('a successful refresh replaces SSR once and a later API failure preserves that result',async()=>{
  let failure=false;
  const f=loadFixture(async()=>({ok:!failure,json:async()=>({products:[{id:20,store_reference:'store',store_name:'Loja',name:'Novo',price_cents:300,stock_quantity:2}]})}));
  await f.load();assert.equal((f.box.innerHTML.match(/<article/g)||[]).length,1);assert.match(f.box.innerHTML,/data-add="20"/);
  const refreshed=f.box.innerHTML;failure=true;await f.load();assert.equal(f.box.innerHTML,refreshed);
});

test('an older search result cannot replace a newer successful query',async()=>{
  const pending=[];const f=loadFixture(()=>new Promise(resolve=>pending.push(resolve)));
  const old=f.load(),newer=f.load();
  pending[1]({ok:true,json:async()=>({products:[]})});await newer;const newest=f.box.innerHTML;
  pending[0]({ok:true,json:async()=>({products:[{id:99,name:'Old'}]})});await old;
  assert.equal(f.box.innerHTML,newest);assert.doesNotMatch(f.box.innerHTML,/Old/);
});
