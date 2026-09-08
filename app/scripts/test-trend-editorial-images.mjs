import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import {setupTrendRadar} from '../trend-radar.js';

const body='Este conteúdo de teste apresenta informações editoriais para conferir a imagem do assunto. '.repeat(10);
const summary='Um resumo completo de teste para conferir o tratamento de capas editoriais na plataforma.';
async function fixture(t,options={}){
  const app=express(),db=new Database(':memory:'),next=(_req,_res,done)=>done(),state={imageUrl:'',run:null,auto:false};app.use(express.json());
  db.exec(`CREATE TABLE store_products(id TEXT,name TEXT,category TEXT,price_cents INTEGER,image_url TEXT,store_reference TEXT,active INTEGER,marketplace_enabled INTEGER,stock_quantity INTEGER,updated_at TEXT);
    CREATE TABLE store_profiles(order_reference TEXT,business_name TEXT,review_status TEXT);`);
  const timeout=globalThis.setTimeout,interval=globalThis.setInterval;
  // Capture the actual scheduled routine without waiting or starting a live feed.
  globalThis.setTimeout=fn=>{state.run=fn;return {unref(){}};};globalThis.setInterval=()=>({unref(){}});
  try{setupTrendRadar({app,db,...options,requireAdmin:next,sameOriginOnly:next,publicPage:()=>next,automationAllowed:()=>state.auto,
    generateEditorialDraft:async({title})=>({title,summary,body,imageUrl:state.imageUrl}),reviewEditorialDraft:async()=>({approved:true,requiresSources:false,risk:'low',notes:'Fixture isolates media validation.'})});}
  finally{globalThis.setTimeout=timeout;globalThis.setInterval=interval;}
  db.exec('DELETE FROM editorial_articles; DELETE FROM trend_topics;');
  db.prepare("INSERT INTO editorial_articles(id,slug,portal,title,summary,body,image_url,status,sources_json) VALUES('fixture','fixture','noticias','Notícia de teste',?,?,?,'published',?)").run(summary,body,'',JSON.stringify([{title:'Fonte de teste A',url:'https://example.org/a'},{title:'Fonte de teste B',url:'https://example.com/b'}]));
  const server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const call=async(endpoint,method='GET')=>{const res=await fetch('http://127.0.0.1:'+server.address().port+endpoint,{method,headers:{'content-type':'application/json'},...(method==='POST'?{body:'{}'}:{})});return {status:res.status,html:await res.text()};};
  const image=value=>db.prepare("UPDATE editorial_articles SET image_url=? WHERE id='fixture'").run(value);
  return {state,db,call,image};
}

test('missing and generic city covers use text layouts and are omitted from sharing metadata and schema',async t=>{
  const f=await fixture(t);
  for(const value of ['', '/assets/vitriny-city-master.jpg','https://vitrinecity.com/assets/vitriny-city-master.jpg','/assets/vitrinecity-avenida-premium.webp']){
    f.image(value);const index=(await f.call('/noticias')).html,page=(await f.call('/artigo/fixture')).html;
    assert.match(index,/<article class="text-only">/);assert.ok(!index.includes('<img '));assert.match(index,/Notícia de teste/);
    assert.match(page,/<div class="article-rule" aria-hidden="true"><\/div>/);assert.ok(!page.includes('<img '));assert.ok(!page.includes('property="og:image"'));assert.match(page,/<meta name="twitter:card" content="summary">/);
    const schema=JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);assert.equal(schema.image,undefined);assert.equal(schema.headline,'Notícia de teste');
    assert.ok(!page.includes('vitriny-city-master'));assert.ok(!page.includes('vitrinecity-avenida-premium'));
  }
});

test('real recipe and product images remain available, without invented AI credit',async t=>{
  const f=await fixture(t);f.image('/assets/recipes/bolo-cenoura.jpg');f.db.exec("UPDATE editorial_articles SET id='story-companion:fixture',portal='receitas' WHERE id='fixture'");
  f.db.prepare('INSERT INTO store_profiles VALUES(?,?,?)').run('store','Loja de teste','published');
  f.db.prepare('INSERT INTO store_products VALUES(?,?,?,?,?,?,?,?,?,?)').run('product','Forma de bolo','cozinha',2000,'/uploads/store-assets/forma.jpg','store',1,1,2,'2026-09-08');
  const page=(await f.call('/artigo/fixture')).html,index=(await f.call('/receitas')).html;
  assert.match(page,/src="\/assets\/recipes\/bolo-cenoura.jpg"/);assert.match(index,/src="\/assets\/recipes\/bolo-cenoura.jpg"/);assert.match(page,/src="\/uploads\/store-assets\/forma.jpg"/);assert.match(page,/property="og:image" content="https:\/\/vitrinecity.com\/assets\/recipes\/bolo-cenoura.jpg"/);
  assert.ok(!page.includes('Ilustração por IA'));assert.ok(!page.includes('ilustração gerada por IA'));
  f.db.exec("UPDATE store_products SET image_url='/assets/vitriny-city-master.jpg'");const noProductPhoto=(await f.call('/artigo/fixture')).html;assert.ok(!noProductPhoto.includes('vitriny-city-master'));assert.match(noProductPhoto,/Ver detalhes do produto/);
});

test('trusted generated image names receive an honest visible illustration credit in cards and articles',async t=>{
  const f=await fixture(t);const file='/uploads/generated-videos/editorial-1788864000000-deadbeef.png';f.image(file);
  const index=(await f.call('/noticias')).html,page=(await f.call('/artigo/fixture')).html;
  assert.match(index,/<figcaption>Ilustração por IA<\/figcaption>/);assert.match(page,/<figcaption>Ilustração por IA<\/figcaption>/);assert.match(page,/alt="Ilustração por IA sobre Notícia de teste"/);
  f.image('javascript:alert(1)');const unsafe=(await f.call('/artigo/fixture')).html;assert.ok(!unsafe.includes('javascript:'));assert.ok(!unsafe.includes('property="og:image"'));
});

test('the product carousel preserves trusted remote catalog photos without using an editorial placeholder',async t=>{
  const f=await fixture(t);f.image('/assets/recipes/bolo-cenoura.jpg');
  f.db.prepare('INSERT INTO store_profiles VALUES(?,?,?)').run('store','Loja de teste','published');
  f.db.prepare('INSERT INTO store_products VALUES(?,?,?,?,?,?,?,?,?,?)').run('product','Forma de bolo','cozinha',2000,'','store',1,1,2,'2026-09-08');
  const photos=['https://http2.mlstatic.com/D_Q_NP_2X_629064-MLA114933297788_082026-AB.webp','https://adubonpkparaplantas.com.br/wp-content/uploads/2026/09/produto.jpg'];
  for(const photo of photos){
    f.db.prepare("UPDATE store_products SET image_url=? WHERE id='product'").run(photo);
    const page=(await f.call('/artigo/fixture')).html;assert.ok(page.includes('src="'+photo+'"'),'Existing trusted catalog photos remain visible');assert.ok(!page.includes('product-without-image">Ver detalhes'));
  }
  for(const photo of ['javascript:alert(1)','https://user:secret@http2.mlstatic.com/D_photo.jpg','https://127.0.0.1/private.jpg','/assets/vitriny-city-master.jpg?cache=1']){
    f.db.prepare("UPDATE store_products SET image_url=? WHERE id='product'").run(photo);
    const page=(await f.call('/artigo/fixture')).html;assert.ok(!page.includes('src="'+photo+'"'));assert.match(page,/product-without-image">Ver detalhes/);assert.ok(!page.includes('src="/assets/vitriny-city-master'));
  }
});

test('configured staging origin accepts its absolute photos in index, article, draft and publication gates',async t=>{
  const siteUrl='https://staging.vitrinecity.test',f=await fixture(t,{siteUrl}),photo=siteUrl+'/assets/recipes/bolo-cenoura.jpg';f.image(photo);
  assert.match((await f.call('/noticias')).html,/src="\/assets\/recipes\/bolo-cenoura.jpg"/);
  const page=(await f.call('/artigo/fixture')).html;
  assert.ok(page.includes('property="og:image" content="'+photo+'"'));assert.ok(page.includes('rel="canonical" href="'+siteUrl+'/artigo/fixture"'));
  f.db.prepare("UPDATE editorial_articles SET status='draft' WHERE id='fixture'").run();assert.equal((await f.call('/api/admin/articles/fixture/publish','POST')).status,200);
  for(const value of [siteUrl+'/assets/vitriny-city-master.jpg','https://outside.invalid/assets/recipes/bolo-cenoura.jpg']){f.image(value);assert.equal((await f.call('/api/admin/articles/fixture/publish','POST')).status,409);}
  f.db.prepare("INSERT INTO trend_topics(id,title,portal,status) VALUES('staging-draft','Rascunho staging','noticias','new')").run();f.state.imageUrl=photo;
  assert.equal((await f.call('/api/admin/trends/staging-draft/draft','POST')).status,200);assert.equal(f.db.prepare("SELECT image_url FROM editorial_articles WHERE trend_id='staging-draft'").get().image_url,'/assets/recipes/bolo-cenoura.jpg');
});

test('manual publishing rejects placeholder variants; preparing a draft never inserts the city fallback',async t=>{
  const f=await fixture(t);f.db.exec("UPDATE editorial_articles SET status='draft' WHERE id='fixture'");
  for(const value of ['/assets/vitriny-city-master.jpg','https://vitrinecity.com/assets/vitriny-city-master.jpg','/assets/vitriny-city-master.jpg?cache=1']){f.image(value);assert.equal((await f.call('/api/admin/articles/fixture/publish','POST')).status,409);}
  f.image('/assets/editorial/esportes-calendario.jpg');assert.equal((await f.call('/api/admin/articles/fixture/publish','POST')).status,200);
  f.db.prepare("INSERT INTO trend_topics(id,title,portal,status) VALUES('draft-fixture','Rascunho de teste','noticias','new')").run();f.state.imageUrl='';assert.equal((await f.call('/api/admin/trends/draft-fixture/draft','POST')).status,200);assert.equal(f.db.prepare("SELECT image_url FROM editorial_articles WHERE trend_id='draft-fixture'").get().image_url,'');
});

test('the actual automatic routine holds generic images even when all other review gates pass',async t=>{
  const f=await fixture(t),originalFetch=globalThis.fetch;f.state.auto=true;
  globalThis.fetch=async url=>{assert.equal(String(url),'https://trends.google.com/trending/rss?geo=BR');return {ok:true,text:async()=>'<rss><channel></channel></rss>'};};
  try{
    for(const [i,image]of ['/assets/vitriny-city-master.jpg','https://vitrinecity.com/assets/vitriny-city-master.jpg','/assets/vitrinecity-avenida-premium.webp','/uploads/generated-videos/editorial-1788864000000-deadbeef.png'].entries()){
      const id='auto-'+i;f.db.prepare("INSERT INTO trend_topics(id,title,portal,status) VALUES(?,?,'noticias','new')").run(id,'Assunto de teste '+i);f.state.imageUrl=image;await f.state.run();
      const article=f.db.prepare('SELECT id,status,image_url FROM editorial_articles WHERE trend_id=?').get(id);assert.ok(article);
      assert.equal(article.status,i===3?'published':'draft');assert.equal(article.image_url,i===3?image:'');
      assert.equal(f.db.prepare("SELECT approved FROM editorial_agent_reviews WHERE article_id=? AND agent_code='midia'").get(article.id).approved,i===3?1:0);
    }
  }finally{globalThis.fetch=originalFetch;}
});
