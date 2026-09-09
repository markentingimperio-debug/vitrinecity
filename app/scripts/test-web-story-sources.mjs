import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
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

test('reviewed service guidance enriches the source without replacing the commercial summary or price',t=>{
  const f=fixture(t),server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
  const start=server.indexOf('const DIGITAL_SERVICE_PACKAGES = Object.freeze({'),end=server.indexOf('\nconst REFERRAL_RATE_BPS',start);
  assert.ok(start>=0&&end>start);
  const registry=runInNewContext(server.slice(start,end)+'\nDIGITAL_SERVICE_PACKAGES;');
  const sources=createWebStorySources({db:f.db,services:()=>registry});
  const selected=['ads-banner-outdoor-15-dias','10-videos-loja'];
  assert.deepEqual(Object.keys(registry).filter(key=>registry[key].editorialBody),selected);
  for(const [slug,price] of [[selected[0],7500],[selected[1],20000]]){
    const source=sources.get('service:'+slug),row=registry[slug];
    assert.equal(source.summary,row.description);assert.equal(source.facts.priceCents,price);
    assert.ok(source.body.startsWith(row.editorialBody));assert.ok(source.body.includes('Guia editorial de preparação: '));
    assert.ok(source.body.length>=650);assert.ok(source.body.includes('não acrescentam entregas ao pacote'));
    assert.equal(source.image_url,row.editorialImageUrl);assert.notEqual(source.image_url,row.imageUrl);assert.ok(row.imageUrl.startsWith('/assets/services/'));
    assert.equal(source.sourcePath,'/servicos-digitais.html?servico='+slug);assert.equal(source.sources[0].url,source.sourcePath);
  }
  const legacy=sources.get('service:ads-banner-outdoor-7-dias');
  assert.ok(!legacy.body.includes('Guia editorial'));assert.ok(legacy.body.length<400);assert.equal(legacy.facts.priceCents,5000);
});

test('guidance changes affect the source body while malformed or withdrawn guidance cannot create a public service',t=>{
  const f=fixture(t),row={slug:'guide',title:'Serviço',description:'Escopo contratado.',amountCents:1234,editorialBody:'Guia editorial revisado.',imageUrl:'/assets/original.jpg',editorialImageUrl:'/uploads/generated-videos/editorial.png'};
  const sources=createWebStorySources({db:f.db,services:()=>[row]}),first=sources.get('service:guide');
  row.editorialBody='Guia editorial atualizado.';
  assert.notEqual(sources.get('service:guide').body,first.body);assert.equal(sources.get('service:guide').summary,first.summary);
  row.editorialBody={private:'PRIVATE_NOT_TEXT'};row.editorialImageUrl='';assert.ok(!sources.get('service:guide').body.includes('Guia editorial'));assert.ok(!JSON.stringify(sources.get('service:guide')).includes('PRIVATE_'));assert.equal(sources.get('service:guide').image_url,row.imageUrl);
  row.editorialBody='Dica';row.active=false;assert.equal(sources.get('service:guide'),null);
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

test('city source comes from the real public home and existing guide, without invented operating claims',t=>{
  const db=new Database(':memory:');t.after(()=>db.close());
  const publicDir=fileURLToPath(new URL('../public/',import.meta.url)),sources=createWebStorySources({db,publicDir});
  const item=sources.get('city:vitrine-city');assert.ok(item);assert.equal(item.kind,'city');assert.equal(item.group,'trends');assert.equal(item.commercial,false);assert.equal(item.sourcePath,'/');
  assert.equal(item.facts.accessNote,'Visite sem cadastro. Entre na sua conta para jogar e conversar.');
  assert.ok(item.body.includes('Consulte as lojas com entrega local e a disponibilidade na sua cidade.'));
  assert.ok(item.body.includes('Centro Educacional'));assert.ok(item.body.includes('Pulse Arena'));assert.ok(item.body.includes('Lojas e vitrines'));
  assert.ok(item.facts.illustrationDescription.includes('conceitual'));assert.ok(item.body.length>650);
  assert.deepEqual(sources.list({group:'trends',q:'cidade'}),[item]);assert.deepEqual(sources.list({group:'news'}),[]);
  assert.equal(sources.get('city:../../server.js'),null);assert.equal(createWebStorySources({db}).get('city:vitrine-city'),null);
});

test('city adapter reads only selected public fields, refreshes text and withdraws missing home',t=>{
  const db=new Database(':memory:');t.after(()=>db.close());
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'vitrine-story-sources-'));
  t.after(()=>{const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('vitrine-story-sources-'));fs.rmSync(resolved,{recursive:true,force:true});});
  const file=path.join(root,'index.html');
  const markup=description=>`<html><head><title>Cidade &amp; encontros</title><meta content="${description}" name="description"><script>PRIVATE_SCRIPT_SECRET</script></head><body><section class="home-hero"><img class="hero-panorama" src="/assets/conceito.webp" alt="Ilustração conceitual"><p class="hero-note">Visita pública; conta para conversar.</p><form>PRIVATE_FORM_SECRET</form></section><section>PRIVATE_OUTSIDE_SECRET</section></body></html>`;
  fs.writeFileSync(file,markup('Primeira apresentação pública.'));const sources=createWebStorySources({db,publicDir:root}),first=sources.get('city:vitrine-city');
  assert.equal(first.title,'Cidade & encontros');assert.equal(first.summary,'Primeira apresentação pública.');assert.ok(!JSON.stringify(first).includes('PRIVATE_'));
  fs.writeFileSync(file,markup('Apresentação atualizada da plataforma.'));assert.notDeepEqual(sources.get('city:vitrine-city'),first);
  fs.unlinkSync(file);assert.equal(sources.get('city:vitrine-city'),null);assert.deepEqual(sources.list(),[]);
});

function storeDetails(f){
  f.db.exec('ALTER TABLE store_profiles ADD COLUMN description TEXT; ALTER TABLE store_profiles ADD COLUMN facade_url TEXT; ALTER TABLE store_profiles ADD COLUMN gallery_1_url TEXT; ALTER TABLE store_profiles ADD COLUMN logo_url TEXT; ALTER TABLE store_profiles ADD COLUMN city TEXT; ALTER TABLE store_profiles ADD COLUMN state TEXT; ALTER TABLE store_profiles ADD COLUMN website_url TEXT; ALTER TABLE store_profiles ADD COLUMN instagram_url TEXT; ALTER TABLE store_profiles ADD COLUMN tiktok_url TEXT; ALTER TABLE store_profiles ADD COLUMN google_maps_url TEXT; ALTER TABLE store_profiles ADD COLUMN updated_at TEXT; ALTER TABLE store_profiles ADD COLUMN admin_notes TEXT;');
  f.db.prepare('UPDATE store_profiles SET description=?,facade_url=?,logo_url=?,city=?,state=?,website_url=?,instagram_url=?,tiktok_url=?,updated_at=?,admin_notes=?').run('Loja de jardinagem com orientação sobre o uso de vasos e ferramentas manuais.','/assets/fachada.jpg','/assets/logo.png','Silvânia','GO','https://user:PRIVATE_PASSWORD@example.org','https://instagram.com/publico','javascript:alert(1)','2026-09-08T12:00:00Z','PRIVATE_STORE_ADMIN_NOTE');
}

test('store source uses public profile and eligible inventory only, with canonical destination and no private data',t=>{
  const f=fixture(t);storeDetails(f);f.product();f.product({id:2,name:'PRIVATE_DISABLED_ITEM',active:0});f.product({id:3,name:'PRIVATE_OUT_OF_STOCK_ITEM',stock_quantity:0});f.product({id:4,name:'PRIVATE_UNAVAILABLE_ITEM',available:0});f.product({id:5,name:'PRIVATE_NONMARKET_ITEM',marketplace_enabled:0});
  f.insert('store_profiles',{order_reference:'hidden',business_name:'PRIVATE_UNPUBLISHED_STORE',review_status:'pending',description:'PRIVATE_DESCRIPTION'});f.product({id:6,store_reference:'hidden',name:'PRIVATE_OTHER_STORE_ITEM'});
  const sources=createWebStorySources({db:f.db}),item=sources.get('store:store');
  assert.equal(item.kind,'store');assert.equal(item.group,'services');assert.equal(item.commercial,true);assert.equal(item.sourcePath,'/loja/store/loja-publica');assert.equal(item.image_url,'/assets/fachada.jpg');assert.equal(item.facts.city,'Silvânia');assert.equal(item.facts.publicProductCount,1);
  assert.deepEqual(item.facts.productCategories,['Jardinagem']);assert.deepEqual(item.facts.publicChannels,['Instagram']);assert.equal(item.facts.products[0].sourcePath,'/produto/1/vaso-de-ceramica');assert.ok(item.body.includes('furo para drenagem'));assert.ok(!JSON.stringify(item).includes('PRIVATE_'));
  assert.equal(sources.get('store:hidden'),null);assert.deepEqual(sources.list({group:'services',q:'silvania vasos'}),[item]);
  f.db.prepare('UPDATE store_products SET stock_quantity=0 WHERE id=1').run();const current=sources.get('store:store');assert.equal(current.facts.publicProductCount,0);assert.deepEqual(current.facts.products,[]);assert.ok(!current.body.includes('furo para drenagem'));assert.notDeepEqual(current,item);
  f.db.prepare("UPDATE store_profiles SET review_status='pending' WHERE order_reference='store'").run();assert.equal(sources.get('store:store'),null);assert.deepEqual(sources.list({group:'services'}),[]);
});

test('sparse stores stay sparse for the normal content gate and published legacy IDs keep precedence',t=>{
  const f=fixture(t);storeDetails(f);f.db.prepare("UPDATE store_profiles SET description='',city='',state='',instagram_url='',facade_url='',gallery_1_url='',logo_url=''").run();
  const sources=createWebStorySources({db:f.db}),item=sources.get('store:store');assert.equal(item.body,'');assert.equal(item.image_url,'');assert.equal(item.facts.publicProductCount,0);
  f.article({id:'store:store'});assert.equal(sources.get('store:store').kind,'article');assert.equal(sources.list().filter(item=>item.key==='store:store').length,1);assert.deepEqual(sources.list({group:'services'}),[]);
  for(const key of ['store:missing','store:','store:toString','city:constructor'])assert.equal(sources.get(key),null);
});
