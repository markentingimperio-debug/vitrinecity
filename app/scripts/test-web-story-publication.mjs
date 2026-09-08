import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import Database from 'better-sqlite3';
import {setupWebStories} from '../web-stories.js';

const appDir=fileURLToPath(new URL('..',import.meta.url)),picture='/assets/recipes/bolo-cenoura.jpg';
const texts=[
  'Conheça o contexto antes de escolher a opção mais adequada para sua rotina.',
  'Comece identificando sua necessidade e o espaço disponível para utilizar.',
  'Compare as características informadas e confira as medidas no catálogo.',
  'Verifique os materiais apresentados sem presumir recursos não descritos.',
  'Confira as instruções de uso para entender os cuidados de conservação.',
  'Considere as limitações da opção e avalie se combinam com sua necessidade.',
  'Organize as dúvidas que ainda precisam de resposta antes de tomar a decisão.',
  'Consulte as condições atuais de atendimento e disponibilidade na plataforma.',
  'Use as informações de origem para complementar sua avaliação com cuidado.',
  'Continue explorando conteúdos completos e úteis dentro da VitrineCity.'
];
const draft=(title='Guia de escolha')=>({title,description:'Um guia completo de teste para avaliar informações antes de escolher.',cta:'Ver detalhes',homeCta:'Explorar a VitrineCity',pages:texts.map((text,index)=>({text,image:picture,alt:`Ilustração de teste ${index+1}`}))});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function fixture(t,{commercial=true,trend=false}={}){
  const folder=mkdtempSync(path.join(tmpdir(),'vc-story-publication-')),db=new Database(':memory:'),app=express();
  db.exec(`CREATE TABLE editorial_articles(id TEXT PRIMARY KEY,trend_id TEXT,slug TEXT NOT NULL UNIQUE,portal TEXT NOT NULL,title TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',body TEXT NOT NULL DEFAULT '',image_url TEXT NOT NULL DEFAULT '',sources_json TEXT NOT NULL DEFAULT '[]',status TEXT NOT NULL DEFAULT 'draft',published_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  const state={available:true,source:{id:'fixture',key:'fixture',kind:commercial?'product':'article',group:commercial?'products':'recipes',slug:'guia-fixture',title:'Guia completo',summary:'Descrição completa e verificável desta fonte de teste.',body:texts.join(' '),image_url:picture,portal:commercial?'produtos':'receitas',updated_at:'2026-09-08T12:00:00Z',sourcePath:commercial?'/produto/1/fixture':'/artigo/guia-fixture',commercial,facts:{priceCents:1000}},generated:draft(),approved:true,noDraft:false,generateGate:null,imageGate:null,generationCalls:0};
  if(trend){Object.assign(state.source,{id:'trend:fixture',key:'trend:fixture',kind:'trend',group:'news',portal:'noticias',sourcePath:'/conteudo',commercial:false,facts:{topic:'Assunto de teste'},sources:[{title:'Primeira fonte de teste',url:'https://www.bbc.com/news/fixture',checkedAt:'2026-09-08T12:00:00Z'},{title:'Segunda fonte de teste',url:'https://www.estadao.com.br/fixture',checkedAt:'2026-09-08T12:00:00Z'}]});state.generated.articleBody=texts.join('\n\n')+'\n\n'+texts.join('\n\n');}
  const sourceCatalog={get:key=>key===state.source.key&&state.available?structuredClone(state.source):null,list:()=>state.available?[structuredClone(state.source)]:[]};
  const assets={outputDir:folder,library:async()=>[],image:async(url,{logo=false}={})=>{if(state.imageGate)await state.imageGate();if(![picture,'/assets/pwa-icon-192.png'].includes(url))throw Object.assign(Error('invalid fixture image'),{status:400});return {url,width:logo?192:1200,height:logo?192:675,hash:'fixture'};},poster:async()=>'/story-assets/0123456789abcdef0123456789abcdef.jpg'};
  app.use(express.json());
  const requireAdmin=(req,res,next)=>{if(req.get('x-admin')!=='fixture')return res.status(401).json({error:'admin'});req.user={id:'fixture-admin'};next();};
  let origin;
  const sameOriginOnly=(req,res,next)=>req.get('origin')===origin?next():res.status(403).json({error:'origin'});
  const instance=setupWebStories({app,db,requireAdmin,sameOriginOnly,siteUrl:'https://vitrinecity.test',publicDir:path.join(appDir,'public'),dataDir:folder,assets,sourceCatalog,
    generateStory:async(source,context)=>{state.generationCalls++;if(state.generateGate)await state.generateGate(source,context);return state.noDraft?{approved:false,notes:'Faltam informações verificadas.'}:{draft:structuredClone(state.generated),approved:state.approved,notes:state.approved?'Conteúdo verificado.':'Aguardando revisão.'};}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));origin='http://127.0.0.1:'+server.address().port;
  const call=async(url,{method='GET',body,admin=false}={})=>{const response=await fetch(origin+url,{method,headers:{origin,'content-type':'application/json',...(admin?{'x-admin':'fixture'}:{})},body:body===undefined?undefined:JSON.stringify(body)});const raw=await response.text();return {status:response.status,raw,json:()=>JSON.parse(raw)};};
  const generate=options=>instance.generateAndPublish({key:state.source.key},options);
  const row=()=>db.prepare('SELECT * FROM editorial_web_stories WHERE article_id=?').get(state.source.key);
  const companion=()=>db.prepare('SELECT * FROM editorial_articles WHERE id=?').get('story-companion:'+state.source.key);
  const publicUrl=()=>'/stories/'+row().slug;
  const snapshot=()=>{const value=row();return value?{...value}:null;};
  const update=async(changes={})=>{const item=row(),body={revision:item.revision,draft:{...JSON.parse(item.draft_json),...changes}};return call('/api/admin/web-stories/'+item.id,{method:'PUT',body,admin:true});};
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();assert.equal(path.dirname(path.resolve(folder)),path.resolve(tmpdir()));assert.ok(path.basename(folder).startsWith('vc-story-publication-'));rmSync(folder,{recursive:true,force:true});});
  return {state,db,instance,call,generate,row,publicUrl,snapshot,update,companion};
}

test('approved automatic stories have at least ten pages and a stable public identity',async t=>{
  const f=await fixture(t),created=await f.generate();assert.equal(created.status,'published');
  const first=f.row(),document=await f.call(f.publicUrl());assert.equal(document.status,200);assert.equal((document.raw.match(/<amp-story-page id=/g)||[]).length,10);
  const repeat=await f.generate();assert.equal(repeat.storyId,created.storyId);assert.equal(f.state.generationCalls,1);assert.equal(f.row().revision,first.revision);
  f.state.source.facts.priceCents=1500;f.state.generated.title='Guia atualizado';const changed=await f.generate();assert.equal(changed.storyId,first.id);assert.equal(f.row().slug,first.slug);assert.equal(f.row().published_at,first.published_at);
  assert.match((await f.call(f.publicUrl())).raw,/Guia atualizado/);assert.equal(f.db.prepare('SELECT count(*) n FROM editorial_web_stories').get().n,1);
});

test('the final page leads home and the source CTA appears before it',async t=>{
  const f=await fixture(t);await f.generate();const document=await f.call(f.publicUrl());assert.equal(document.status,200);
  const pages=[...document.raw.matchAll(/<amp-story-page id="([^"]+)">([\s\S]*?)<\/amp-story-page>/g)];
  assert.match(pages.at(-1)[2],/href="https:\/\/vitrinecity\.test\/"/);assert.match(pages.at(-1)[2],/Explorar a VitrineCity/);
  assert.match(pages.at(-2)[2],/href="https:\/\/vitrinecity\.test\/produto\/1\/fixture"/);assert.ok(!pages.at(-1)[2].includes('/produto/1/fixture'));
});

test('automatic publication rejects fewer than ten pages and excessive rendered text without writing a story',async t=>{
  const f=await fixture(t);f.state.generated.pages.pop();await assert.rejects(f.generate(),error=>error.status===400&&/10 e 40/.test(error.message));assert.equal(f.row(),undefined);
  f.state.generated=draft('T'.repeat(90));f.state.generated.pages[0].text='A'.repeat(130);await assert.rejects(f.generate(),error=>error.status===400&&/texto demais/.test(error.message));assert.equal(f.row(),undefined);
});

test('unapproved and incomplete generated content cannot become public',async t=>{
  const f=await fixture(t);f.state.noDraft=true;assert.equal((await f.generate()).status,'review');assert.equal(f.row(),undefined);
  f.state.noDraft=false;f.state.approved=false;const held=await f.generate();assert.equal(held.status,'review');assert.equal(f.row().published_json,null);assert.equal((await f.call(f.publicUrl())).status,404);
  assert.ok(!(await f.call('/stories')).raw.includes(f.row().slug));assert.ok(!f.instance.sitemapPaths().includes(f.publicUrl()));
});

test('a commercial update held for review preserves its old snapshot privately and cannot re-expose it',async t=>{
  const f=await fixture(t);await f.generate();const before=f.snapshot();
  f.state.source.facts.priceCents=2200;f.state.generated.title='Preço novo em revisão';f.state.approved=false;
  assert.equal((await f.call(f.publicUrl())).status,404,'Changed commercial facts hide the outdated version immediately');
  assert.equal((await f.generate()).status,'review');const held=f.row();assert.equal(held.id,before.id);assert.equal(held.slug,before.slug);assert.equal(held.published_json,before.published_json);assert.equal(held.published_source_hash,before.published_source_hash);assert.notEqual(held.source_hash,held.published_source_hash);
  assert.equal((await f.call(f.publicUrl())).status,404);assert.ok(!(await f.call('/stories')).raw.includes(held.slug));assert.ok(!(await f.call('/sitemap-stories.xml')).raw.includes(held.slug));
  f.state.approved=true;assert.equal((await f.generate()).storyId,before.id);assert.equal((await f.call(f.publicUrl())).status,200);assert.equal(f.row().source_hash,f.row().published_source_hash);
});

test('editorial review updates preserve the last public snapshot until a replacement is approved',async t=>{
  const f=await fixture(t,{commercial:false});await f.generate();const before=f.snapshot();
  f.state.source.body+=' Informação adicional da fonte.';f.state.generated.title='Novo texto aguardando revisão';f.state.approved=false;assert.equal((await f.generate()).status,'review');
  assert.equal(f.row().published_json,before.published_json);const page=await f.call(f.publicUrl());assert.equal(page.status,200);assert.ok(!page.raw.includes('Novo texto aguardando revisão'));
});

test('deactivating a commercial source removes its page, directory entry and sitemap visibility',async t=>{
  const f=await fixture(t);await f.generate();const path=f.publicUrl(),slug=f.row().slug;f.state.available=false;
  assert.equal((await f.call(path)).status,404);assert.ok(!(await f.call('/stories')).raw.includes(slug));assert.ok(!(await f.call('/sitemap-stories.xml')).raw.includes(slug));assert.ok(!f.instance.sitemapPaths().includes(path));
  await assert.rejects(f.generate(),error=>error.status===409);assert.notEqual(f.row().published_json,null,'Withdrawal hides rather than erases the saved version');
});

test('manual withdrawal is never undone by a later automatic round, even after the source changes',async t=>{
  const f=await fixture(t);await f.generate();const item=f.row();
  assert.equal((await f.call('/api/admin/web-stories/'+item.id+'/unpublish',{method:'POST',admin:true,body:{revision:item.revision}})).status,200);
  const before=f.snapshot(),calls=f.state.generationCalls;f.state.source.facts.priceCents=1800;assert.equal((await f.generate()).status,'review');assert.deepEqual(f.snapshot(),before);assert.equal(f.state.generationCalls,calls);assert.equal((await f.call(f.publicUrl())).status,404);
});

test('manual edits are preserved and never overwritten by automatic generation',async t=>{
  const f=await fixture(t);f.state.approved=false;await f.generate();assert.equal((await f.update({title:'Título manual preservado'})).status,200);
  const before=f.snapshot(),calls=f.state.generationCalls;f.state.approved=true;assert.equal((await f.generate()).status,'review');assert.deepEqual(f.snapshot(),before);assert.equal(f.state.generationCalls,calls);
});

test('an edit committed while generation awaits wins and prevents automatic publication',async t=>{
  const f=await fixture(t);f.state.approved=false;await f.generate();const entered=deferred(),release=deferred();
  f.state.approved=true;f.state.generateGate=async()=>{entered.resolve();await release.promise;};const pending=f.generate();await entered.promise;
  assert.equal((await f.update({title:'Edição feita durante a geração'})).status,200);const before=f.snapshot();release.resolve();await assert.rejects(pending,error=>error.status===409);
  assert.deepEqual(f.snapshot(),before);assert.equal(f.row().published_json,null);assert.equal((await f.call(f.publicUrl())).status,404);
});

test('manual withdrawal during generation wins over a pending commercial update',async t=>{
  const f=await fixture(t);await f.generate();const entered=deferred(),release=deferred();f.state.source.facts.priceCents=1900;
  f.state.generateGate=async()=>{entered.resolve();await release.promise;};const pending=f.generate();await entered.promise;const item=f.row();
  assert.equal((await f.call('/api/admin/web-stories/'+item.id+'/unpublish',{method:'POST',admin:true,body:{revision:item.revision}})).status,200);const before=f.snapshot();release.resolve();await assert.rejects(pending,error=>error.status===409);
  assert.deepEqual(f.snapshot(),before);assert.equal(f.row().published_json,null);
});

test('pause, abort and changed source invalidate work waiting on the generation provider',async t=>{
  for(const mode of ['pause','abort','source']){
    const f=await fixture(t),entered=deferred(),release=deferred(),controller=new AbortController();let current=true;
    f.state.generateGate=async()=>{entered.resolve();await release.promise;};const pending=f.generate({signal:controller.signal,isCurrent:()=>current});await entered.promise;
    if(mode==='pause')current=false;else if(mode==='abort')controller.abort();else f.state.source.title='Fonte alterada durante a geração';
    release.resolve();await assert.rejects(pending,error=>error.status===409);assert.equal(f.row(),undefined);
  }
});

test('the final transaction checks eligibility again after asynchronous image preparation',async t=>{
  const f=await fixture(t),entered=deferred(),release=deferred();let current=true;
  f.state.imageGate=async()=>{entered.resolve();await release.promise;};const pending=f.generate({isCurrent:()=>current});await entered.promise;current=false;release.resolve();await assert.rejects(pending,error=>error.status===409);assert.equal(f.row(),undefined);
});

test('concurrent first-generation requests can create only one source story and public URL',async t=>{
  const f=await fixture(t),firstEntered=deferred(),bothEntered=deferred(),release=deferred();let count=0;
  f.state.generateGate=async()=>{if(++count===1)firstEntered.resolve();else bothEntered.resolve();await release.promise;};
  const first=f.generate();await firstEntered.promise;const second=f.generate();await bothEntered.promise;release.resolve();const results=await Promise.allSettled([first,second]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.filter(result=>result.status==='rejected'&&result.reason.status===409).length,1);assert.equal(f.db.prepare('SELECT count(*) n FROM editorial_web_stories').get().n,1);
});

test('an approved Trend publishes its complete companion article and links to its stable descriptive URL',async t=>{
  const f=await fixture(t,{trend:true});assert.equal((await f.generate()).status,'published');
  const story=f.row(),article=f.companion(),published=JSON.parse(story.published_json);
  assert.equal(article.id,'story-companion:trend:fixture');assert.equal(article.status,'published');assert.equal(article.title,published.title);assert.equal(article.summary,published.description);assert.equal(article.body,f.state.generated.articleBody);assert.ok(article.body.length>=900&&article.body.length<=3000);assert.equal(article.image_url,published.pages[0].image);assert.deepEqual(JSON.parse(article.sources_json),published.sources);assert.equal(published.sources.length,2);
  assert.match(article.slug,/^guia-de-escolha-[a-f0-9]{8}$/);assert.equal(published.sourcePath,'/artigo/'+article.slug);assert.match(published.companionHash,/^[a-f0-9]{64}$/);
  const page=await f.call(f.publicUrl());assert.equal(page.status,200);const pages=[...page.raw.matchAll(/<amp-story-page id="([^"]+)">([\s\S]*?)<\/amp-story-page>/g)];assert.ok(pages.at(-2)[2].includes('href="https://vitrinecity.test/artigo/'+article.slug+'"'));assert.match(pages.at(-1)[2],/href="https:\/\/vitrinecity\.test\/"/);
  f.state.source.body+=' Informação nova sobre o assunto.';f.state.generated.title='Guia de escolha atualizado';f.state.generated.articleBody+=' Informação complementar aprovada.';assert.equal((await f.generate()).storyId,story.id);assert.equal(f.companion().slug,article.slug);assert.equal(f.companion().published_at,article.published_at);assert.equal(f.companion().body,f.state.generated.articleBody);assert.equal(f.db.prepare('SELECT count(*) n FROM editorial_articles').get().n,1);
});

test('a Trend held for review or missing a complete article publishes neither document',async t=>{
  const f=await fixture(t,{trend:true});f.state.approved=false;assert.equal((await f.generate()).status,'review');assert.equal(f.companion(),undefined);assert.equal(f.row().published_json,null);assert.equal((await f.call(f.publicUrl())).status,404);assert.ok(!f.instance.sitemapPaths().includes(f.publicUrl()));
  const held=f.snapshot();f.state.approved=true;f.state.generated.articleBody='Artigo incompleto.';await assert.rejects(f.generate(),error=>error.status===400&&/Artigo relacionado/.test(error.message));assert.equal(f.companion(),undefined);assert.deepEqual(f.snapshot(),held);
});

test('a late publication failure rolls back both Trend documents and audit records atomically',async t=>{
  for(const existing of [false,true]){
    const f=await fixture(t,{trend:true});if(existing)await f.generate();
    const before={story:f.snapshot(),article:f.companion(),events:f.db.prepare('SELECT * FROM editorial_web_story_events ORDER BY id').all()};
    f.state.source.body+=' Atualização nova da origem.';f.state.generated.articleBody+=' Complemento novo do artigo.';
    f.db.exec("CREATE TRIGGER fixture_publication_failure BEFORE INSERT ON editorial_web_story_events WHEN NEW.event='published_automatic' BEGIN SELECT RAISE(ABORT,'fixture publication failure'); END");
    await assert.rejects(f.generate(),/fixture publication failure/);
    assert.deepEqual(f.snapshot(),before.story);assert.deepEqual(f.companion(),before.article);assert.deepEqual(f.db.prepare('SELECT * FROM editorial_web_story_events ORDER BY id').all(),before.events);
    if(existing)assert.equal((await f.call(f.publicUrl())).status,200);else assert.equal(f.db.prepare('SELECT count(*) n FROM editorial_web_stories WHERE published_json IS NOT NULL').get().n,0);
  }
});

test('a manually edited companion cannot be overwritten and its withdrawal hides the Trend story',async t=>{
  const f=await fixture(t,{trend:true});await f.generate();const story=f.snapshot(),article=f.companion();
  f.db.prepare('UPDATE editorial_articles SET body=? WHERE id=?').run(article.body+' Ajuste editorial manual preservado.',article.id);const manual=f.companion();f.state.source.body+=' Mudança da fonte que requer atualização.';
  await assert.rejects(f.generate(),error=>error.status===409&&/edição manual/.test(error.message));assert.deepEqual(f.companion(),manual);assert.deepEqual(f.snapshot(),story);
  f.db.prepare("UPDATE editorial_articles SET status='draft' WHERE id=?").run(article.id);const withdrawn=f.companion();
  assert.equal((await f.call(f.publicUrl())).status,404);assert.equal((await f.call(f.publicUrl()+'/fontes')).status,404);assert.ok(!(await f.call('/stories')).raw.includes(story.slug));assert.ok(!(await f.call('/sitemap-stories.xml')).raw.includes(story.slug));assert.ok(!f.instance.sitemapPaths().includes(f.publicUrl()));
  await assert.rejects(f.generate(),error=>error.status===409);assert.deepEqual(f.companion(),withdrawn);assert.deepEqual(f.snapshot(),story);
});
