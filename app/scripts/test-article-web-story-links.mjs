import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import {setupTrendRadar,publishedStoryForArticle} from '../trend-radar.js';

async function fixture(t){
  const db=new Database(':memory:'),app=express(),next=(_req,_res,done)=>done();
  db.exec(`CREATE TABLE store_products(id TEXT,name TEXT,category TEXT,price_cents INTEGER,image_url TEXT,store_reference TEXT,active INTEGER,marketplace_enabled INTEGER,stock_quantity INTEGER,updated_at TEXT);
    CREATE TABLE store_profiles(order_reference TEXT,business_name TEXT,review_status TEXT);`);
  setupTrendRadar({app,db,requireAdmin:next,sameOriginOnly:next,publicPage:()=>next,automationAllowed:()=>false});
  db.prepare("INSERT INTO editorial_articles(id,slug,portal,title,summary,body,status,sources_json) VALUES(?,?,'receitas',?,?,?,'published','[]')").run('article-fixture','receita-fixture','Receita de teste','Resumo público de teste','Conteúdo completo do artigo de teste.');
  const server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const article=()=>db.prepare('SELECT * FROM editorial_articles WHERE id=?').get('article-fixture');
  const read=async(slug='receita-fixture')=>{const response=await fetch('http://127.0.0.1:'+server.address().port+'/artigo/'+encodeURIComponent(slug));return {status:response.status,html:await response.text()};};
  const stories=()=>db.exec('CREATE TABLE editorial_web_stories(article_id TEXT UNIQUE,slug TEXT,published_json TEXT,published_at TEXT,draft_json TEXT)');
  const insert=(key='article-fixture',slug='receita-visual',snapshot={sourcePath:'/artigo/receita-fixture'},publishedAt='2026-09-08T12:00:00Z')=>db.prepare('INSERT INTO editorial_web_stories VALUES(?,?,?,?,?)').run(key,slug,snapshot===null?null:JSON.stringify(snapshot),publishedAt,JSON.stringify({title:'Rascunho privado <script>não mostrar</script>',sourcePath:'/artigo/privado'}));
  return {db,article,read,stories,insert};
}

test('article shows only its published story and gracefully supports an installation without stories',async t=>{
  const f=await fixture(t);assert.equal(publishedStoryForArticle(f.db,f.article()),null);assert.equal((await f.read()).status,200);
  f.stories();f.insert('article-fixture','receita-visual',null,null);assert.ok(!(await f.read()).html.includes('Ver este conteúdo em Web Story'));
  f.db.prepare('UPDATE editorial_web_stories SET published_json=?,published_at=?').run(JSON.stringify({sourcePath:'/artigo/receita-fixture'}),'2026-09-08T12:00:00Z');
  const published=await f.read();assert.match(published.html,/<a href="\/stories\/receita-visual">Ver este conteúdo em Web Story →<\/a>/);assert.ok(!published.html.includes('Rascunho privado'));assert.match(published.html,/Conteúdo completo do artigo de teste/);
  f.db.exec('UPDATE editorial_web_stories SET published_json=NULL,published_at=NULL');assert.ok(!(await f.read()).html.includes('/stories/receita-visual'));
  f.db.exec("UPDATE editorial_articles SET status='draft' WHERE id='article-fixture'");assert.equal((await f.read()).status,404);
});

test('unrelated source, external destination, malformed snapshots and unsafe slugs do not create links',async t=>{
  const f=await fixture(t);f.stories();f.insert('another-article');assert.equal(publishedStoryForArticle(f.db,f.article()),null);
  f.insert('article-fixture','receita-visual',{sourcePath:'/artigo/another-article'});assert.equal(publishedStoryForArticle(f.db,f.article()),null);
  for(const snapshot of ['{broken',JSON.stringify({sourcePath:'https://evil.test/artigo/receita-fixture'})]){f.db.prepare("UPDATE editorial_web_stories SET published_json=? WHERE article_id='article-fixture'").run(snapshot);assert.equal(publishedStoryForArticle(f.db,f.article()),null);}
  f.db.prepare("UPDATE editorial_web_stories SET published_json=?,slug=? WHERE article_id='article-fixture'").run(JSON.stringify({sourcePath:'/artigo/receita-fixture'}),'x" onclick="alert(1)');assert.equal(publishedStoryForArticle(f.db,f.article()),null);assert.ok(!(await f.read()).html.includes('onclick='));
});

test('a published companion article points back to the exact original story key without creating another story',async t=>{
  const f=await fixture(t);f.stories();f.db.prepare('UPDATE editorial_articles SET id=?,slug=? WHERE id=?').run('story-companion:trend:fixture','assunto-companion','article-fixture');
  f.insert('trend:fixture','assunto-visual',{sourcePath:'/artigo/assunto-companion',companionHash:'fixture'});
  const page=await f.read('assunto-companion');assert.equal(page.status,200);assert.match(page.html,/href="\/stories\/assunto-visual"/);assert.equal(f.db.prepare('SELECT count(*) n FROM editorial_web_stories').get().n,1);
  f.db.exec('UPDATE editorial_web_stories SET published_at=NULL');assert.ok(!(await f.read('assunto-companion')).html.includes('/stories/assunto-visual'));
});
