import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createEcosystemCatalog} from '../ecosystem-catalog.js';
import {SPATIAL_CITIES} from '../vitriny-spatial/city-registry.js';
import {DISTRICT_INTEGRATIONS} from '../public/vitriny-district-integrations.js';
function fixture(){const db=new Database(':memory:');db.exec(`CREATE TABLE store_profiles(order_reference TEXT,business_name TEXT,review_status TEXT,description TEXT,facade_url TEXT,city TEXT);
CREATE TABLE store_products(id INTEGER,store_reference TEXT,name TEXT,active INTEGER,marketplace_enabled INTEGER,price_cents INTEGER,stock_quantity INTEGER,available INTEGER,description TEXT,image_url TEXT);
CREATE TABLE affiliate_catalog(slug TEXT,title TEXT,description TEXT,image TEXT,status TEXT,availability TEXT,health TEXT,platform TEXT);
CREATE TABLE social_accounts(id INTEGER,page_id TEXT,page_name TEXT,instagram_id TEXT,instagram_username TEXT,updated_at TEXT,status TEXT,token_encrypted TEXT);
CREATE TABLE social_provider_credentials(provider TEXT,credentials_encrypted TEXT);
CREATE TABLE tiktok_oauth_account(id INTEGER,status TEXT,expires_at INTEGER,refresh_expires_at INTEGER);
CREATE TABLE marketplace_orders(reference TEXT,payment_status TEXT,total_cents INTEGER,updated_at TEXT);
INSERT INTO store_profiles VALUES('store1','Loja Sertaneja','published','Moda local','/assets/store.jpg','Silvânia'),('private','Loja em revisão','draft','','','');
INSERT INTO store_products VALUES(1,'store1','Camisa',1,1,10000,4,1,'Moda','/assets/camisa.jpg'),(2,'store1','Bota sem estoque',1,1,20000,0,1,'Calçado',''),(3,'private','Produto privado',1,1,3000,1,1,'Teste','');
INSERT INTO social_accounts VALUES(1,'p1','Nome antigo','ig1','perfil','2026-09-01','connected','SECRET'),(2,'p1','Página atual','ig1','perfil','2026-09-09','connected','SECRET2');
INSERT INTO social_provider_credentials VALUES('youtube','SECRET3');
INSERT INTO tiktok_oauth_account VALUES(1,'connected',1,9999999999);
INSERT INTO marketplace_orders VALUES('pending','pending',90000,'2026-09-09'),('paid','approved',5000,'2026-09-09');`);return {db,service:createEcosystemCatalog({db,siteUrl:'https://vitrinecity.com',sourceCatalog:{get:()=>null},now:()=>new Date('2026-09-09T14:00:00Z')})};}
test('paginated registry links each store and product and distinguishes unavailable stock',()=>{const {service}=fixture();const first=service.list({kind:'products',limit:2});assert.equal(first.total,3);assert.equal(first.nextOffset,2);const second=service.list({kind:'products',offset:2,limit:2});assert.equal(second.items.length,1);assert.equal(second.nextOffset,null);const all=[...first.items,...second.items];assert.equal(all.find(i=>i.id==='product:1').url,'/produto/1/camisa');assert.equal(all.find(i=>i.id==='product:2').status,'pending');assert.equal(all.find(i=>i.id==='product:2').url,'');assert.equal(all.find(i=>i.id==='product:3').url,'');assert.equal(service.list({kind:'stores',q:'Sertaneja'}).items[0].url,'/loja/store1/loja-sertaneja');assert.ok(service.list({kind:'buildings',q:'Sertaneja'}).items.some(i=>i.id==='store:store1'));});
test('search parameters remain bound and invalid categories are rejected',()=>{const {service}=fixture();assert.equal(service.list({kind:'products',q:"%' OR 1=1 --"}).total,0);assert.throws(()=>service.list({kind:'social_accounts'}));assert.equal(service.list({kind:'products',limit:100000}).limit,100);});
test('Portuguese search handles accents and case consistently in SQL and static guides',()=>{const {db,service}=fixture();db.prepare('UPDATE store_products SET name=? WHERE id=1').run('Árvore em casa');assert.equal(service.list({kind:'products',q:'árvore'}).total,1);assert.equal(service.list({kind:'products',q:'ARVORE'}).total,1);assert.ok(service.list({kind:'pages',q:'pagina inicial'}).items.length>0);});
test('connection inventory removes secrets, deduplicates pages, never equates credentials with publishing',()=>{const {service}=fixture();const result=service.snapshot();assert.ok(!JSON.stringify(result).includes('SECRET'));const fb=result.connections.find(c=>c.id==='facebook');assert.equal(fb.connectedCount,1);assert.equal(fb.accounts[0].name,'Página atual');assert.equal(fb.canPublish,false);assert.equal(result.connections.find(c=>c.id==='youtube').canPublish,false);assert.match(result.connections.find(c=>c.id==='tiktok').reason,/expirado/);});
test('metrics show unavailable measurements as null and only approved payments as orders',()=>{const {service}=fixture();const items=service.snapshot().metrics.items;assert.equal(items.find(i=>i.id==='sessions').value,null);assert.equal(items.find(i=>i.id==='paid_orders').value,1);assert.equal(items.find(i=>i.id==='paid_value').value,5000);assert.equal(items.find(i=>i.id==='affiliate_commissions').available,false);});
test('empty installations still expose navigable real guide destinations',()=>{const db=new Database(':memory:');const service=createEcosystemCatalog({db,siteUrl:'https://vitrinecity.com'});assert.ok(service.list({kind:'buildings'}).items.some(i=>i.title==='VC Entregas'));assert.equal(service.list({kind:'products'}).total,0);});
test('TikTok uses the production millisecond expiry and WhatsApp reflects existing queue evidence',()=>{const {db,service}=fixture();db.prepare('UPDATE tiktok_oauth_account SET expires_at=?').run(1788021123640);db.exec("CREATE TABLE whatsapp_qr_schedules(status TEXT);INSERT INTO whatsapp_qr_schedules VALUES('sent'),('pending'),('pending');");const connections=service.snapshot().connections;assert.match(connections.find(c=>c.id==='tiktok').reason,/expirado/);const wa=connections.find(c=>c.id==='whatsapp');assert.equal(wa.status,'partial');assert.match(wa.reason,/1 envios aceitos pelo serviço e 2 pendentes/);assert.equal(wa.canPublish,false);});
test('draft articles and stories without current public source have no public action; offer review keeps its existing public page',()=>{const {db,service}=fixture();db.exec(`CREATE TABLE editorial_articles(id TEXT,slug TEXT,title TEXT,summary TEXT,image_url TEXT,status TEXT,portal TEXT);
INSERT INTO editorial_articles VALUES('draft','rascunho','Rascunho de artigo','','','draft','receitas');
CREATE TABLE editorial_web_stories(id TEXT,slug TEXT,article_id TEXT,published_json TEXT,published_source_hash TEXT);
INSERT INTO editorial_web_stories VALUES('story','antiga','withdrawn','{}','hash');
INSERT INTO affiliate_catalog VALUES('withdrawn','Oferta retirada','','','published','unavailable','broken','shopee');`);const pages=service.list({kind:'pages',limit:100}).items;assert.equal(pages.find(i=>i.id==='article:draft').url,'');assert.equal(pages.find(i=>i.id==='story:story').status,'pending');assert.equal(pages.find(i=>i.id==='story:story').url,'');const offer=service.list({kind:'products',q:'retirada'}).items[0];assert.equal(offer.status,'published');assert.equal(offer.url,'/ofertas/withdrawn');assert.ok(offer.meta.some(value=>value.includes('Oferta em revisão')));});

test('affiliate page visibility follows its public publisher, independently of AI readiness and provider checks',()=>{
  const {db,service}=fixture();db.exec(`INSERT INTO affiliate_catalog VALUES('public','Produto público','','','published','unknown','unchecked','mercadolivre'),('draft','Produto rascunho','','','draft','available','reachable','shopee');`);
  const items=service.list({kind:'products',q:'Produto'}).items;
  assert.equal(items.find(i=>i.id==='affiliate:public').status,'published');assert.equal(items.find(i=>i.id==='affiliate:public').url,'/ofertas/public');
  assert.equal(items.find(i=>i.id==='affiliate:draft').url,'');assert.equal(items.find(i=>i.id==='affiliate:draft').status,'pending');
  db.prepare("UPDATE affiliate_catalog SET status='draft' WHERE slug='public'").run();assert.equal(service.list({kind:'products',q:'público'}).items[0].url,'');db.close();
});

test('books and media use published rows, safe actual images and own destinations without exposing source URLs',()=>{
  const db=new Database(':memory:');db.exec(`CREATE TABLE digital_books(slug TEXT,title TEXT,summary TEXT,cover_url TEXT,status TEXT,category TEXT);
    INSERT INTO digital_books VALUES('jardim','Livro jardim','Guia de plantas','/assets/jardim.jpg','published','jardinagem'),('review','Livro em revisão','Resumo','javascript:alert(1)','review','plantas');
    CREATE TABLE vitriny_media_catalog(scope TEXT,slug TEXT,title TEXT,status TEXT,description TEXT,genre TEXT,url TEXT);
    INSERT INTO vitriny_media_catalog VALUES('music','sertanejo','Música sertaneja','published','Seleção musical','sertanejo','https://provider.test/PRIVATE_SOURCE'),('cinema','aventura','Cinema aventura','paused','Sessão pausada','aventura','https://provider.test/PRIVATE_SOURCE'),('invalid','unknown','Fora do catálogo','published','','','');`);
  const service=createEcosystemCatalog({db,siteUrl:'https://vitrinecity.com',sourceCatalog:{get(){throw Error('AI source should not decide these public pages');}}});
  const pages=service.list({kind:'pages',limit:100}).items,book=pages.find(i=>i.id==='book:jardim'),music=pages.find(i=>i.id==='media:music:sertanejo');
  assert.equal(book.url,'/livro/jardim');assert.equal(book.image,'/assets/jardim.jpg');assert.equal(book.adminUrl,'/admin-editora.html');
  assert.equal(pages.find(i=>i.id==='book:review').url,'');assert.equal(pages.find(i=>i.id==='book:review').image,'');
  assert.equal(music.url,'/musicas/sertanejo');assert.equal(music.image,'');assert.equal(music.adminUrl,'/admin-midia.html');
  assert.equal(pages.find(i=>i.id==='media:cinema:aventura').url,'');assert.ok(!pages.some(i=>i.id==='media:invalid:unknown'));assert.doesNotMatch(JSON.stringify(pages),/PRIVATE_SOURCE/);
  db.prepare("UPDATE vitriny_media_catalog SET status='paused' WHERE slug='sertanejo'").run();assert.equal(service.list({kind:'pages',q:'Música sertaneja'}).items[0].url,'');db.close();
});

test('services are re-read from the public callback; distinct service parameters remain distinct and withdrawals remove public actions',()=>{
  const db=new Database(':memory:');let rows=[{slug:'seo-local',title:'SEO local',description:'Planejamento regional',imageUrl:'/assets/services/seo.jpg'},{slug:'loja-digital',title:'Loja digital',description:'Página da loja'}];
  const service=createEcosystemCatalog({db,siteUrl:'https://vitrinecity.com',services:()=>rows});
  const pages=service.list({kind:'pages',q:'Serviço digital',limit:100}).items;
  const seo=pages.find(i=>i.id==='service:seo-local'),store=pages.find(i=>i.id==='service:loja-digital');
  assert.equal(seo.url,'/servicos-digitais.html?servico=seo-local');assert.equal(store.url,'/servicos-digitais.html?servico=loja-digital');assert.equal(seo.image,'/assets/services/seo.jpg');
  rows=[{...rows[0],published:false},{...rows[1],status:'draft'},{slug:'../private',title:'Invalid'}];
  const changed=service.list({kind:'pages',q:'Serviço digital',limit:100}).items.filter(i=>i.id.startsWith('service:'));
  assert.equal(changed.length,2);assert.ok(changed.every(i=>i.status==='pending'&&i.url===''));db.close();
});

test('public hubs, affiliate guides and city destinations are reachable through stable deduplicated pagination',()=>{
  const db=new Database(':memory:'),service=createEcosystemCatalog({db,siteUrl:'https://vitrinecity.com'}),items=[];let offset=0;
  do{const page=service.list({kind:'pages',limit:7,offset});items.push(...page.items);offset=page.nextOffset;}while(offset!==null);
  assert.equal(items.length,service.list({kind:'pages'}).total);assert.equal(new Set(items.map(i=>i.id)).size,items.length);
  for(const url of ['/noticias','/receitas','/esportes','/livros','/musicas','/cinema','/grupos-whatsapp.html','/artigos/organizar-petiscos.html','/centros/shopee'])assert.ok(items.some(i=>i.url===url),url);
  assert.equal(items.filter(i=>i.url==='/loja'||i.url==='/loja.html').length,1);assert.equal(items.filter(i=>i.url==='/central-creditos.html').length,1);
  assert.ok(service.list({kind:'pages',q:'Loja Oficial VitrineCity'}).items.length,'deduplicated label remains searchable');
  for(const city of SPATIAL_CITIES){const item=items.find(i=>i.id==='city:'+city.id);assert.equal(item.url,'/multiverso?city='+city.id);assert.equal(item.status,city.status==='active'?'published':'preview');}
  for(const district of DISTRICT_INTEGRATIONS)assert.ok(items.some(i=>i.url===district.href||district.id==='commerce'&&i.url==='/loja'),district.id);
  assert.ok(items.every(i=>!i.url.startsWith('/v/')),'logical spatial paths are not invented HTTP pages');
  const buildings=[];offset=0;do{const page=service.list({kind:'buildings',limit:7,offset});buildings.push(...page.items);offset=page.nextOffset;}while(offset!==null);
  assert.equal(buildings.filter(i=>i.status==='preview').length,4);const inventory=service.snapshot().inventory.find(i=>i.kind==='buildings');assert.equal(inventory.published,buildings.filter(i=>i.status==='published').length);db.close();
});
