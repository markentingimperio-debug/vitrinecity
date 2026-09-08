import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createWebStorySources} from '../web-story-sources.js';

function fixture(t,{stock=true,availability=true}={}) {
  const db=new Database(':memory:');t.after(()=>db.close());
  db.exec(`CREATE TABLE editorial_articles(id TEXT PRIMARY KEY,slug TEXT,title TEXT,summary TEXT,body TEXT,image_url TEXT,portal TEXT,status TEXT,updated_at TEXT,published_at TEXT,sources_json TEXT,internal_note TEXT);
    CREATE TABLE store_profiles(order_reference TEXT PRIMARY KEY,business_name TEXT,review_status TEXT,owner_email TEXT);
    CREATE TABLE store_products(id INTEGER PRIMARY KEY,store_reference TEXT,name TEXT,description TEXT,category TEXT,price_cents INTEGER,image_url TEXT,active INTEGER,marketplace_enabled INTEGER,updated_at TEXT,sku TEXT,variation_label TEXT,delivery_min_days INTEGER,delivery_max_days INTEGER,return_days INTEGER,product_type TEXT,fiscal_ncm TEXT,cost_price INTEGER,private_download_url TEXT${stock?',stock_quantity INTEGER':''}${availability?',available INTEGER':''});
    CREATE TABLE managed_courses(slug TEXT PRIMARY KEY,title TEXT,description TEXT,audience TEXT,price_cents INTEGER,modules INTEGER,cover_url TEXT,status TEXT,updated_at TEXT,material_url TEXT,video_url TEXT);
    CREATE TABLE affiliate_catalog(slug TEXT PRIMARY KEY,platform TEXT,title TEXT,description TEXT,category TEXT,keywords TEXT,image TEXT,affiliate_url TEXT,status TEXT,availability TEXT,health TEXT,updated_at TEXT,checked_at TEXT,evidence TEXT,clicks INTEGER);`);
  const insert=(table,data)=>db.prepare(`INSERT INTO ${table}(${Object.keys(data).join(',')}) VALUES(${Object.keys(data).map(()=>'?').join(',')})`).run(...Object.values(data));
  const article=(extra={})=>insert('editorial_articles',{id:'legacy-article',slug:'guia-publicado',title:'Guia público',summary:'Resumo original.',body:'Primeiro parágrafo original.\n\nSegundo parágrafo, com ressalva e detalhe importante.\n',image_url:'/assets/editorial/ia-revisao-humana.jpg',portal:'noticias',status:'published',updated_at:'2026-09-08T14:00:00Z',published_at:'2026-09-08T13:00:00Z',sources_json:JSON.stringify([{title:'Fonte oficial',url:'https://example.org/fonte'}]),internal_note:'INTERNAL_EDITORIAL_SECRET',...extra});
  insert('store_profiles',{order_reference:'store',business_name:'Loja Pública',review_status:'published',owner_email:'PRIVATE_OWNER_EMAIL'});
  const product=(extra={})=>insert('store_products',{id:1,store_reference:'store',name:'Vaso de cerâmica',description:'Vaso de cerâmica com furo para drenagem.',category:'Jardinagem',price_cents:3590,image_url:'/assets/product.jpg',active:1,marketplace_enabled:1,updated_at:'2026-09-08T14:01:00Z',sku:'VASO-01',variation_label:'Azul',delivery_min_days:3,delivery_max_days:7,return_days:7,product_type:'retail',fiscal_ncm:'PRIVATE_FISCAL',cost_price:1000,private_download_url:'PRIVATE_DOWNLOAD',...(stock?{stock_quantity:4}:{}),...(availability?{available:1}:{}),...extra});
  const course=(extra={})=>insert('managed_courses',{slug:'curso-publico',title:'Curso público atualizado',description:'Aprenda a organizar uma loja.',audience:'Lojistas iniciantes',price_cents:2399,modules:5,cover_url:'/assets/course.jpg',status:'active',updated_at:'2026-09-08T14:02:00Z',material_url:'PRIVATE_PAID_MATERIAL',video_url:'PRIVATE_PAID_VIDEO',...extra});
  const affiliate=(extra={})=>insert('affiliate_catalog',{slug:'oferta-publica',platform:'shopee',title:'Ferramenta de jardinagem',description:'Ferramenta manual para jardinagem.',category:'Jardinagem',keywords:'jardim plantas',image:'https://example.org/public-image.jpg',affiliate_url:'https://s.shopee.com.br/approved-affiliate',status:'published',availability:'available',health:'reachable',updated_at:'2026-09-08T14:03:00Z',checked_at:'2026-09-08T14:03:00Z',evidence:'PRIVATE_ADMIN_EVIDENCE',clicks:987,...extra});
  return {db,article,product,course,affiliate,insert};
}

test('legacy article identity, original text, editorial grouping and actual references are preserved',t=>{
  const f=fixture(t);f.article();const sources=createWebStorySources({db:f.db}),item=sources.get('legacy-article');
  assert.equal(item.id,'legacy-article');assert.equal(item.key,'legacy-article');assert.equal(item.kind,'article');assert.equal(item.group,'news');assert.equal(item.commercial,false);
  assert.equal(item.body,f.db.prepare('SELECT body FROM editorial_articles').get().body);assert.equal(item.summary,'Resumo original.');assert.equal(item.updated_at,'2026-09-08T14:00:00Z');assert.equal(item.sourcePath,'/artigo/guia-publicado');
  assert.deepEqual(item.sources,[{title:'Guia público',url:'/artigo/guia-publicado'},{title:'Fonte oficial',url:'https://example.org/fonte'}]);assert.ok(!JSON.stringify(item).includes('INTERNAL_EDITORIAL_SECRET'));
  for(const [portal,group] of [['receitas','recipes'],['esportes','sports'],['tecnologia','trends'],['constructor','trends']]){f.db.prepare('UPDATE editorial_articles SET portal=?').run(portal);assert.equal(sources.get('legacy-article').group,group);}
  f.db.prepare("UPDATE editorial_articles SET status='draft'").run();assert.equal(sources.get('legacy-article'),null);assert.deepEqual(sources.list(),[]);
});
test('published companion article stays in database but cannot become another story source',t=>{
  const f=fixture(t);f.article({id:'story-companion:trend:fixture',slug:'companion-fixture'});const sources=createWebStorySources({db:f.db});
  assert.equal(sources.get('story-companion:trend:fixture'),null);assert.deepEqual(sources.list(),[]);assert.equal(f.db.prepare("SELECT status FROM editorial_articles WHERE id='story-companion:trend:fixture'").get().status,'published');
});
test('products require published stores, active marketplace listing and positive stock when configured',t=>{
  const f=fixture(t);f.product();const sources=createWebStorySources({db:f.db}),item=sources.get('product:1');
  assert.equal(item.sourcePath,'/produto/1/vaso-de-ceramica');assert.equal(item.group,'products');assert.equal(item.commercial,true);assert.equal(item.facts.priceCents,3590);assert.equal(item.facts.stockQuantity,4);assert.equal(item.facts.storeName,'Loja Pública');
  assert.ok(item.body.includes('Vaso de cerâmica com furo para drenagem.'));assert.ok(item.body.length<200);assert.ok(!JSON.stringify(item).includes('PRIVATE_'));assert.equal(sources.get('product:01'),null);
  for(const [column,bad,good] of [['active',0,1],['marketplace_enabled',0,1],['stock_quantity',0,4],['available',0,1],['price_cents',0,3590],['price_cents','invalid',3590]]){f.db.prepare(`UPDATE store_products SET ${column}=?`).run(bad);assert.equal(sources.get('product:1'),null,column);assert.deepEqual(sources.list({group:'products'}),[]);f.db.prepare(`UPDATE store_products SET ${column}=?`).run(good);}
  f.db.prepare("UPDATE store_profiles SET review_status='pending'").run();assert.equal(sources.get('product:1'),null);
});
test('legacy product schema without optional stock/availability remains usable without fabricated inventory',t=>{
  const f=fixture(t,{stock:false,availability:false});f.product();const item=createWebStorySources({db:f.db}).get('product:1');assert.ok(item);assert.ok(!Object.hasOwn(item.facts,'stockQuantity'));assert.ok(!item.body.includes('estoque'));
});
test('public services are read from the injected registry with only real description and public price',t=>{
  const f=fixture(t);let catalog=Object.freeze({'seo-local':Object.freeze({title:'SEO local',description:'Auditoria das páginas públicas.',amountCents:35000,imageUrl:'/assets/services/seo-local.jpg',privateToken:'PRIVATE_SERVICE_TOKEN'})});
  const sources=createWebStorySources({db:f.db,services:()=>catalog}),item=sources.get('service:seo-local');
  assert.equal(item.kind,'service');assert.equal(item.group,'services');assert.equal(item.sourcePath,'/servicos-digitais.html?servico=seo-local');assert.equal(item.facts.priceCents,35000);assert.equal(item.updated_at,'');assert.ok(item.body.startsWith('Auditoria das páginas públicas.'));assert.ok(!JSON.stringify(item).includes('PRIVATE_'));
  catalog=[];assert.equal(sources.get('service:seo-local'),null);
  catalog=[{slug:'paused',title:'Pausado',description:'Texto',status:'paused'},{slug:'inactive',title:'Inativo',active:false},{slug:'unavailable',title:'Indisponível',available:'false'}];assert.deepEqual(sources.list({group:'services'}),[]);
});
test('courses use the ready public injection and current database metadata; no paid material is returned',t=>{
  const f=fixture(t);f.course();let catalog=[{slug:'curso-publico',title:'Título antigo da injeção',description:'Antigo',status:'active',available:true,materialUrl:'PRIVATE_PROVIDER_MATERIAL',videoUrl:'PRIVATE_PROVIDER_VIDEO'}];
  const sources=createWebStorySources({db:f.db,courses:()=>catalog}),item=sources.get('course:curso-publico');
  assert.equal(item.title,'Curso público atualizado');assert.equal(item.summary,'Aprenda a organizar uma loja.');assert.equal(item.group,'services');assert.equal(item.kind,'course');assert.equal(item.facts.modules,5);assert.equal(item.sourcePath,'/centro-educacional#curso-publico');assert.ok(!JSON.stringify(item).includes('PRIVATE_'));
  catalog[0].available=false;assert.equal(sources.get('course:curso-publico'),null);catalog[0].available=true;
  f.db.prepare("UPDATE managed_courses SET status='draft'").run();assert.equal(sources.get('course:curso-publico'),null);assert.deepEqual(sources.list(),[]);
});
test('missing schemas are handled gracefully and public providers still work without a courses table',t=>{
  const db=new Database(':memory:');t.after(()=>db.close());const sources=createWebStorySources({db,courses:()=>[{slug:'publico',title:'Curso público',description:'Descrição pública',available:true,modules:3,priceCents:0}]});
  assert.equal(sources.get('missing'),null);assert.equal(sources.get('product:1'),null);assert.equal(sources.get('affiliate:missing'),null);assert.equal(sources.list().length,1);assert.equal(sources.get('course:publico').facts.priceCents,0);
  db.exec('CREATE TABLE editorial_articles(id TEXT,title TEXT); CREATE TABLE affiliate_catalog(slug TEXT,title TEXT); CREATE TABLE managed_courses(slug TEXT)');assert.deepEqual(sources.list(),[]);
});
test('affiliates require confirmed availability, reachable health and platform URL validation',t=>{
  const f=fixture(t);f.affiliate();const sources=createWebStorySources({db:f.db}),item=sources.get('affiliate:oferta-publica');
  assert.equal(item.kind,'affiliate');assert.equal(item.group,'products');assert.equal(item.sourcePath,'/ofertas/oferta-publica');assert.equal(item.facts.affiliate,true);assert.equal(item.facts.platform,'Shopee');assert.equal(item.facts.linkCheckedAt,'2026-09-08T14:03:00Z');assert.ok(!Object.hasOwn(item.facts,'priceCents'));assert.ok(!JSON.stringify(item).includes('approved-affiliate'));assert.ok(!JSON.stringify(item).includes('PRIVATE_ADMIN_EVIDENCE'));
  for(const [column,bad,good] of [['status','draft','published'],['availability','unknown','available'],['availability','unavailable','available'],['health','unchecked','reachable'],['health','broken','reachable'],['health','review','reachable'],['affiliate_url','https://evil.test/x','https://s.shopee.com.br/approved-affiliate']]){f.db.prepare(`UPDATE affiliate_catalog SET ${column}=?`).run(bad);assert.equal(sources.get('affiliate:oferta-publica'),null,column);f.db.prepare(`UPDATE affiliate_catalog SET ${column}=?`).run(good);}
});
test('pagination is deterministic, capped at 200 per call and reaches every eligible item',t=>{
  const f=fixture(t);for(let i=250;i>=0;i--)f.article({id:'article-'+String(i).padStart(3,'0'),slug:'article-'+i,title:'Artigo '+i,portal:i%2?'receitas':'esportes'});
  f.product();f.affiliate();const sources=createWebStorySources({db:f.db}),first=sources.list({limit:999});assert.equal(first.length,200);const second=sources.list({offset:200,limit:200});assert.equal(second.length,53);
  const keys=[...first,...second].map(item=>item.key);assert.equal(new Set(keys).size,253);assert.equal(keys[0],'article-000');assert.equal(keys.at(-1),'affiliate:oferta-publica');assert.deepEqual(sources.list({limit:999}),first);
  assert.deepEqual(sources.list({offset:253}),[]);assert.deepEqual(sources.list({limit:0}),[]);assert.deepEqual(sources.list({group:'unknown'}),[]);assert.equal(sources.list({group:'recipes',offset:100,limit:50}).length,25);assert.equal(sources.list({q:'CERÂMICA',group:'products'})[0].key,'product:1');
});
test('get/list share legacy ID precedence and reject unknown/prototype key prefixes',t=>{
  const f=fixture(t);f.article({id:'product:1'});f.product();const sources=createWebStorySources({db:f.db});assert.equal(sources.get('product:1').kind,'article');assert.equal(sources.list().filter(item=>item.key==='product:1').length,1);assert.deepEqual(sources.list({group:'products'}),[]);
  for(const key of ['toString:x','constructor:x','__proto__:x','product:1 OR 1=1','',null,{},'unknown:x'])assert.equal(sources.get(key),null);
});
test('malformed bibliographies and unsafe protocols do not create invalid references',t=>{
  const f=fixture(t);f.article({sources_json:'{invalid'});const sources=createWebStorySources({db:f.db});assert.equal(sources.get('legacy-article').sources.length,1);
  f.db.prepare('UPDATE editorial_articles SET sources_json=?').run(JSON.stringify([{title:'Unsafe',url:'javascript:alert(1)'},{title:'Credential',url:'https://user:password@example.org/x'},{title:'Safe',url:'https://example.org/fonte'},{title:'Duplicate',url:'https://example.org/fonte'}]));
  assert.deepEqual(sources.get('legacy-article').sources,[{title:'Guia público',url:'/artigo/guia-publicado'},{title:'Safe',url:'https://example.org/fonte'}]);
});
