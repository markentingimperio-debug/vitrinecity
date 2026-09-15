import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import {setupTrendRadar} from '../trend-radar.js';
import {setupDigitalPublisher} from '../digital-publisher.js';

const portals=['conteudo','noticias','esportes','receitas','plantas-e-jardinagem','tecnologia','inteligencia-artificial','entretenimento'];
const canonical=html=>[...html.matchAll(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"[^>]*>/g)].map(match=>match[1]);
async function fixture(t,siteUrl='https://vitrinecity.com/base?ignored=1#fragment'){
  const app=express(),db=new Database(':memory:'),next=(_req,_res,done)=>done();let providerCalls=0;
  const noGeneration=()=>{providerCalls++;throw Error('No generation in SEO test');};
  db.exec('CREATE TABLE managed_courses(slug TEXT,status TEXT,material_url TEXT);CREATE TABLE store_products(id TEXT,name TEXT,category TEXT,price_cents INTEGER,image_url TEXT,store_reference TEXT,active INTEGER,marketplace_enabled INTEGER,stock_quantity INTEGER,updated_at TEXT);CREATE TABLE store_profiles(order_reference TEXT,business_name TEXT,review_status TEXT);');
  const timeout=globalThis.setTimeout,interval=globalThis.setInterval;
  globalThis.setTimeout=()=>({unref(){}});globalThis.setInterval=()=>({unref(){}});
  try{setupTrendRadar({app,db,siteUrl,requireAdmin:next,sameOriginOnly:next,publicPage:()=>next,canRun:()=>false,automationAllowed:()=>false,generateEditorialDraft:noGeneration,reviewEditorialDraft:noGeneration});}
  finally{globalThis.setTimeout=timeout;globalThis.setInterval=interval;}
  const publisher=setupDigitalPublisher({app,db,siteUrl,requireAdmin:next,requireUser:next,sameOriginOnly:next,activeEnrollment:()=>false,schedule:false,canRun:()=>false,generateBookPlan:noGeneration,generateBookChapter:noGeneration,generateBookCover:noGeneration,generateBookIllustration:noGeneration});
  db.exec('DELETE FROM editorial_articles;DELETE FROM digital_books;DELETE FROM digital_book_chapters;');
  for(const portal of portals.filter(p=>p!=='conteudo'))db.prepare("INSERT INTO editorial_articles(id,slug,portal,title,summary,body,image_url,status) VALUES(?,?,?,?,?,?,?,'published')").run(portal,'exemplo-'+portal,portal,'Artigo '+portal+' <script>','Resumo publicado e acessível sem JavaScript.','Texto editorial útil. '.repeat(40),'/assets/editorial/exemplo.png');
  db.prepare("INSERT INTO editorial_articles(id,slug,portal,title,status) VALUES('private','artigo-privado','receitas','RASCUNHO NÃO PUBLICADO','draft')").run();
  db.prepare("INSERT INTO digital_books(id,slug,title,category,summary,status) VALUES('book','guia-publicado','Guia <seguro> & publicado','plantas','Resumo do guia publicado para leitura.','published'),('draft','guia-privado','LIVRO PRIVADO','plantas','Não deve aparecer.','review')").run();
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));publisher.close();db.close();assert.equal(providerCalls,0);});
  return {db,async get(path,host='www.vitrinecity.com'){const response=await fetch('http://127.0.0.1:'+server.address().port+path,{headers:{host,'x-forwarded-host':'injected.invalid','x-forwarded-proto':'http'},redirect:'manual'});return {status:response.status,html:await response.text()};}};
}

test('all eight editorial hubs have one clean configured canonical across www, query and trailing slash',async t=>{
  const f=await fixture(t);
  for(const portal of portals)for(const suffix of ['', '?utm_source=facebook&canonical=https%3A%2F%2Finjected.invalid', '/?lia=1']){
    const page=await f.get('/'+portal+suffix);assert.equal(page.status,200);assert.deepEqual(canonical(page.html),['https://vitrinecity.com/'+portal]);
    assert.equal((page.html.match(/<h1\b/g)||[]).length,1);assert.match(page.html,/<a href="\/artigo\/exemplo-/);assert.match(page.html,/Resumo publicado e acessível sem JavaScript/);assert.ok(!page.html.includes('RASCUNHO NÃO PUBLICADO'));assert.ok(!page.html.includes('<script></h2>'));assert.ok(!/name="robots" content="noindex/.test(page.html));
  }
});

test('books SSR exposes one heading, truthful description and published links without leaking review items',async t=>{
  const f=await fixture(t);
  for(const suffix of ['', '?utm_campaign=books', '/?lia=1']){const page=await f.get('/livros'+suffix,'forged.invalid');assert.equal(page.status,200);assert.deepEqual(canonical(page.html),['https://vitrinecity.com/livros']);assert.equal((page.html.match(/<h1\b/g)||[]).length,1);assert.match(page.html,/<h1>Livros e guias digitais da VitrineCity<\/h1>/);assert.match(page.html,/<meta name="description" content="Conheça os livros e guias digitais publicados/);assert.match(page.html,/href="\/livro\/guia-publicado"/);assert.match(page.html,/Guia &lt;seguro&gt; &amp; publicado/);assert.ok(!page.html.includes('LIVRO PRIVADO'));assert.ok(!page.html.includes('injected.invalid'));}
});

test('explicit deployment origin wins over request hosts in both existing services',async t=>{
  const f=await fixture(t,'https://preview.vitrinecity.test:8443/configuration?x=1');
  for(const portal of [...portals,'livros']){const page=await f.get('/'+portal+'?src=external','www.vitrinecity.com');assert.deepEqual(canonical(page.html),['https://preview.vitrinecity.test:8443/'+portal]);}
});

test('empty books and editorial categories retain useful headings and indexable canonical without inventing entries',async t=>{
  const f=await fixture(t);f.db.exec('DELETE FROM digital_books;DELETE FROM editorial_articles;');
  const books=(await f.get('/livros')).html,recipes=(await f.get('/receitas')).html;
  assert.deepEqual(canonical(books),['https://vitrinecity.com/livros']);assert.match(books,/Os primeiros livros estão em produção/);assert.ok(!books.includes('/livro/guia-publicado'));assert.equal((books.match(/<h1\b/g)||[]).length,1);
  assert.deepEqual(canonical(recipes),['https://vitrinecity.com/receitas']);assert.match(recipes,/Os primeiros artigos estão em preparação editorial/);assert.ok(!recipes.includes('/artigo/exemplo'));
});
