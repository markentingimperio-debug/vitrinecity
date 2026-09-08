import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import {setupEmissora} from '../emissora.js';

async function fixture(t){
  const db=new Database(':memory:'),app=express();
  db.exec(`CREATE TABLE editorial_articles(id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,portal TEXT,title TEXT,summary TEXT,body TEXT,image_url TEXT,status TEXT,published_at TEXT,updated_at TEXT,sources_json TEXT,internal_note TEXT)`);
  const insert=(extra={})=>{
    const row={id:'article-1',slug:'artigo-publicado',portal:'noticias',title:'Informação pública',summary:'Resumo público da matéria.',body:'Texto completo público. BODY_NOT_IN_DTO',image_url:'/assets/editorial/exemplo.jpg',status:'published',published_at:'2026-09-08 12:00:00',updated_at:'2026-09-08 13:00:00',sources_json:'PRIVATE_SOURCE_METADATA',internal_note:'PRIVATE_EDITOR_NOTE',...extra};
    db.prepare('INSERT INTO editorial_articles('+Object.keys(row).join(',')+') VALUES('+Object.keys(row).map(()=>'?').join(',')+')').run(...Object.values(row));
  };
  const feed=setupEmissora({app,db,siteUrl:'https://vitrinecity.test'});
  const server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
  const base='http://127.0.0.1:'+server.address().port;
  const get=async(query='')=>{const response=await fetch(base+'/api/emissora/conteudos'+query);return {status:response.status,headers:response.headers,data:await response.json()};};
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();});
  return {db,feed,insert,get,base};
}

test('public feed projects only published editorial cards, includes companions and leaves the database unchanged',async t=>{
  const f=await fixture(t);f.insert();f.insert({id:'story-companion:trend:example',slug:'materia-com-story',portal:'receitas'});
  for(const status of ['draft','review','generating'])f.insert({id:status,slug:status,status,title:'PRIVATE_UNPUBLISHED_TITLE'});
  f.insert({id:'technology',slug:'technology',portal:'tecnologia'});
  const before=f.db.prepare('SELECT total_changes() n').get().n,result=await f.get();
  assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'public,max-age=60');assert.equal(result.headers.get('x-content-type-options'),'nosniff');assert.equal(result.headers.get('set-cookie'),null);
  assert.equal(result.data.total,2);assert.equal(result.data.pageSize,12);assert.ok(result.data.items.some(item=>item.slug==='materia-com-story'));
  assert.deepEqual(Object.keys(result.data.items[0]).sort(),['slug','category','title','summary','imageUrl','imageCredit','url','publishedAt','updatedAt'].sort());
  assert.doesNotMatch(JSON.stringify(result.data),/PRIVATE_|BODY_NOT_IN_DTO/);assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);
  assert.deepEqual(f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all(),[{name:'editorial_articles'}]);
});

test('category filters and empty channels are exact; celebrity articles join entertainment',async t=>{
  const f=await fixture(t);for(const portal of ['noticias','receitas','esportes','entretenimento','celebridades'])f.insert({id:portal,slug:portal,portal});
  for(const category of ['noticias','receitas','esportes']){const result=await f.get('?categoria='+category);assert.equal(result.data.total,1);assert.equal(result.data.items[0].category,category);}
  const entertainment=await f.get('?categoria=entretenimento');assert.equal(entertainment.data.total,2);assert.ok(entertainment.data.items.every(item=>item.category==='entretenimento'));
  f.db.prepare("UPDATE editorial_articles SET status='draft' WHERE portal='receitas'").run();const empty=(await f.get('?categoria=receitas')).data;assert.deepEqual(empty.items,[]);assert.equal(empty.total,0);assert.equal(empty.pages,1);
});

test('search normalizes case and accents, requires all words and treats SQL wildcard characters literally',async t=>{
  const f=await fixture(t);f.insert({title:'Receita de maçã',portal:'receitas',body:'Organize a preparação da sobremesa na cozinha.'});f.insert({id:'other',slug:'outro',title:'Receita diferente',portal:'receitas'});
  const match=await f.get('?categoria=receitas&q=MACA%20PREPARACAO');assert.equal(match.data.total,1);assert.equal(match.data.items[0].slug,'artigo-publicado');
  assert.equal((await f.get('?q=ma%C3%A7%C3%A3%20futebol')).data.total,0);
  for(const query of ['%',"' OR 1=1 --",'nome_inexistente'])assert.equal((await f.get('?q='+encodeURIComponent(query))).data.total,0);
});

test('pagination is stable, newest publication first and reaches content beyond the old discover limit',async t=>{
  const f=await fixture(t);for(let i=0;i<29;i++)f.insert({id:'page-'+i,slug:'pagina-'+String(i).padStart(2,'0'),published_at:'2026-09-08 12:00:00'});
  f.insert({id:'newest-sqlite',slug:'novo-sqlite',published_at:'2026-09-08 19:00:00'});f.insert({id:'older-iso',slug:'anterior-iso',published_at:'2026-09-08T18:00:00Z'});
  const pages=await Promise.all([f.get('?page=1'),f.get('?page=2'),f.get('?page=3')]);const items=pages.flatMap(result=>result.data.items);
  assert.equal(pages[0].data.total,31);assert.equal(pages[0].data.pages,3);assert.deepEqual(pages.map(result=>result.data.items.length),[12,12,7]);assert.equal(new Set(items.map(item=>item.slug)).size,31);
  assert.equal(items[0].slug,'novo-sqlite');assert.equal(items[1].slug,'anterior-iso');assert.equal(items[0].publishedAt,'2026-09-08T19:00:00.000Z');assert.equal(items[0].updatedAt,'2026-09-08T13:00:00.000Z');
  assert.deepEqual((await f.get('?page=4')).data.items,[]);assert.equal((await f.get('?page=4')).data.page,4);
});

test('unsafe images and destination overrides cannot escape to external, private or executable URLs',async t=>{
  const f=await fixture(t);const images=['javascript:alert(1)','https://external.test/news.jpg','https://user:secret@vitrinecity.test/assets/x.jpg','//vitrinecity.test/assets/x.jpg','/api/private/x.jpg','/assets/%2e%2e/server.js','/assets/image.jpg?secret=1'];
  for(let i=0;i<images.length;i++)f.insert({id:'bad-'+i,slug:'slug-'+i,image_url:images[i]});
  f.insert({id:'absolute',slug:'absolute',image_url:'https://vitrinecity.test/uploads/generated-videos/story.jpg'});
  const result=await f.get('?sourcePath=https://external.test');
  assert.ok(result.data.items.filter(item=>item.slug!=='absolute').every(item=>item.imageUrl===''));
  assert.equal(result.data.items.find(item=>item.slug==='absolute').imageUrl,'/uploads/generated-videos/story.jpg');assert.ok(result.data.items.every(item=>item.url==='/artigo/'+encodeURIComponent(item.slug)));
});

test('withdrawn articles disappear on the next read and invalid dates are not replaced by a fabricated fresh timestamp',async t=>{
  const f=await fixture(t);f.insert({published_at:null,updated_at:'not-a-date'});let result=await f.get();assert.equal(result.data.items[0].publishedAt,null);assert.equal(result.data.items[0].updatedAt,null);
  f.db.prepare("UPDATE editorial_articles SET status='draft'").run();result=await f.get();assert.equal(result.data.total,0);assert.deepEqual(result.data.items,[]);
});

test('repeated city covers are omitted while recipe photos and credited AI covers remain',async t=>{
  const f=await fixture(t);
  f.insert({id:'generic-news',slug:'generic-news',image_url:'/assets/vitriny-city-master.jpg'});
  f.insert({id:'generic-sports',slug:'generic-sports',portal:'esportes',image_url:'https://vitrinecity.test/assets/vitriny-city-master.jpg'});
  f.insert({id:'recipe',slug:'recipe',portal:'receitas',image_url:'/assets/recipes/bolo-cenoura.jpg'});
  f.insert({id:'ai',slug:'ai',image_url:'/uploads/generated-videos/story-ai-a7150844-9ec1-4972-a3b4-10bd7da19a09.png'});
  const {items}= (await f.get()).data;
  assert.equal(items.length,4);
  for(const item of items.filter(item=>item.slug.startsWith('generic-'))){assert.equal(item.imageUrl,'');assert.equal(item.imageCredit,'');}
  assert.equal(items.find(item=>item.slug==='recipe').imageUrl,'/assets/recipes/bolo-cenoura.jpg');assert.equal(items.find(item=>item.slug==='recipe').imageCredit,'');
  assert.equal(items.find(item=>item.slug==='ai').imageCredit,'Ilustração por IA');
  assert.equal(f.db.prepare("SELECT image_url FROM editorial_articles WHERE id='generic-news'").get().image_url,'/assets/vitriny-city-master.jpg');
});

test('invalid query/category/page parameters return controlled errors; writes are not routed',async t=>{
  const f=await fixture(t);f.insert();
  for(const suffix of ['?categoria=admin','?categoria=noticias&categoria=receitas','?page=0','?page=-1','?page=1.5','?page=10001','?page=Infinity','?page=1&page=2','?q=a&q=b','?q='+('a'.repeat(121)),'?q=a%00b']){
    const result=await f.get(suffix);assert.equal(result.status,400,suffix);assert.equal(result.headers.get('cache-control'),'no-store');assert.ok(typeof result.data.error==='string');
  }
  assert.equal((await fetch(f.base+'/api/emissora/conteudos',{method:'POST'})).status,404);
  f.db.exec('DROP TABLE editorial_articles');const unavailable=await f.get();assert.equal(unavailable.status,503);assert.doesNotMatch(JSON.stringify(unavailable.data),/SELECT|sqlite|editorial_articles|no such table/i);
});
