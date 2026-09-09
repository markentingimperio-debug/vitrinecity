import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import express from 'express';
import Database from 'better-sqlite3';
import {setupDailyWebStories} from '../web-story-daily.js';

const origin='https://vitrinecity.test',sha=value=>createHash('sha256').update(value).digest('hex');
const paragraph='Observe as informações disponíveis e consulte a página de origem antes de escolher. O guia explica os cuidados, as condições e as possibilidades em detalhes para ajudar a compreender o assunto. ';
const recipe='Ingredientes da massa: 3 cenouras médias; 3 ovos; 1 xícara de óleo; 2 xícaras de açúcar; 2 e meia xícaras de farinha; 1 colher de sopa de fermento. Para a cobertura: 4 colheres de sopa de chocolate em pó; 4 colheres de sopa de açúcar; 2 colheres de sopa de manteiga; meia xícara de leite. Preparo: aqueça o forno a 180 °C e unte uma forma média. Bata as cenouras, os ovos e o óleo até obter uma mistura uniforme. Misture o açúcar e a farinha em uma tigela. Adicione o líquido aos poucos e mexa até incorporar. Acrescente o fermento delicadamente. Asse por aproximadamente 35 a 45 minutos, conforme o forno. Faça o teste do palito no centro e retire quando ele sair sem massa crua. Espere amornar antes de desenformar. Para a cobertura, leve os ingredientes ao fogo baixo, mexendo até engrossar levemente. Espalhe sobre o bolo morno. Conserve o bolo coberto e sob refrigeração em dias quentes se a cobertura levar leite.';
function setup({trends=[],enrich,getEnriched,automaticEligible=()=>false,text,configured=true,services=()=>[]}={}) {
  const db=new Database(':memory:');db.exec('CREATE TABLE editorial_articles(id TEXT PRIMARY KEY,slug TEXT,title TEXT,summary TEXT,body TEXT,image_url TEXT,portal TEXT,status TEXT,updated_at TEXT,published_at TEXT,sources_json TEXT);');
  const add=(id,portal='receitas')=>db.prepare('INSERT INTO editorial_articles VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,id.replace(/:/g,'-'),'Guia público completo '+id,paragraph,portal==='receitas'?recipe:paragraph.repeat(5),'/assets/guide.png',portal,'published','2026-09-08T12:00:00Z','2026-09-08T12:00:00Z','[]');
  const app=express();app.use(express.json());const calls={configured:0,text:0,image:0,sync:0};
  const research={list:({q='',group='all',limit=50,offset=0}={})=>trends.filter(x=>(group==='all'||x.group===group)&&x.title.includes(q)).slice(offset,offset+limit),get:key=>trends.find(x=>x.key===key)||null,getEnriched:getEnriched||((s)=>s),enrich:enrich||((s)=>s),automaticEligible,syncTrends:async()=>{calls.sync++;return {count:trends.length};}};
  const daily=setupDailyWebStories({app,db,siteUrl:origin,publicDir:fileURLToPath(new URL('../public',import.meta.url)),dataDir:'.',schedule:false,research,services,courses:()=>[],isConfigured:()=>{calls.configured++;return configured;},requireAdmin:(req,res,next)=>{const role=req.headers['x-test-role'];if(!role)return res.sendStatus(401);if(role!=='admin')return res.sendStatus(403);req.user={id:1};next();},sameOriginOnly:(req,res,next)=>req.headers.origin===origin?next():res.sendStatus(403),requestText:async(...args)=>{calls.text++;if(text)return text(...args);return JSON.stringify({insufficient:true});},requestImage:async()=>{calls.image++;throw Error('unexpected image');},assets:{outputDir:fileURLToPath(new URL('../public/assets',import.meta.url)),image:async(url,{logo=false}={})=>({url,width:logo?192:1080,height:logo?192:1920,hash:'a'.repeat(64)}),poster:async()=>'/story-assets/a.jpg',library:async()=>[]}});
  return {db,add,app,calls,daily,close:()=>{daily.close();db.close();}};
}
test('schedule=false constructs without timers, provider calls, sync or eager configuration (TDZ safe)',()=>{
  const x=setup();assert.deepEqual(x.calls,{configured:0,text:0,image:0,sync:0});assert.equal(x.daily.automation.status().enabled,false);assert.equal(x.calls.configured,1);x.close();
});
test('merged pagination reaches >200 Trends and then own sources; legacy IDs win',()=>{
  const trends=Array.from({length:250},(_,i)=>({key:'trend:'+i,id:'trend:'+i,kind:'trend',group:'news',title:'Tema '+i}));
  const x=setup({trends});x.add('article-a','noticias');x.add('article-b','noticias');
  assert.deepEqual(x.daily.catalog.list({group:'news',limit:4,offset:248}).map(s=>s.key),['trend:248','trend:249','article-a','article-b']);
  assert.deepEqual(x.daily.catalog.list({group:'news',limit:2,offset:250}).map(s=>s.key),['article-a','article-b']);assert.equal(x.daily.catalog.list({limit:0}).length,0);
  x.add('trend:0','noticias');assert.equal(x.daily.catalog.get('trend:0').kind,'article');assert.equal(x.daily.catalog.get(null),null);assert.equal(x.daily.catalog.list({group:'news',limit:1})[0].key,'trend:1');x.close();
});
test('article fingerprint is raw-source stable after evidence enrichment, without extra jobs',async()=>{
  let checked=false;const evidence=['bbc','estadao'].map(publisher=>({publisher,url:'https://'+publisher+'.example/article',title:'Fonte '+publisher,excerpt:paragraph.repeat(4),excerptHash:sha(paragraph.repeat(4)),checkedAt:'2026-09-08T18:00:00Z'}));
  const enrichSource=s=>checked?{...s,summary:'Pesquisa verificada',body:paragraph.repeat(8)+' A matéria reúne o contexto da consulta e os registros disponibilizados pelas fontes.',sources:evidence.map(({excerpt,...rest})=>rest),facts:{evidence},evidenceReady:true}:s;
  const x=setup({automaticEligible:()=>true,getEnriched:enrichSource,enrich:async s=>{checked=true;return enrichSource(s);}});x.add('article-news','noticias');
  x.daily.automation.updateSettings({revision:1,enabled:true,dailyLimit:2,groups:['news']});x.daily.automation.run({manual:true});await x.daily.automation.awaitIdle();assert.equal(checked,true);assert.equal(x.daily.automation.status().quota.attempted,1);
  x.daily.automation.run({manual:true});await x.daily.automation.awaitIdle();assert.equal(x.daily.automation.status().quota.attempted,1,'cache metadata is not a new editorial version');assert.equal(x.calls.text,1);x.close();
});
test('HTTP admin + same-origin protection, category settings and manual run respect daily quota',async()=>{
  const x=setup();x.add('recipe-a');x.add('recipe-b');const server=x.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
  const req=(pathname,{method='GET',role='admin',foreign=false,body}={})=>fetch(base+pathname,{method,headers:{'content-type':'application/json',origin:foreign?'https://foreign.test':origin,...(role?{'x-test-role':role}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  try {
    assert.equal((await req('/api/admin/web-story-automation',{role:null})).status,401);assert.equal((await req('/api/admin/web-story-automation',{role:'member'})).status,403);
    assert.equal((await req('/api/admin/web-story-automation',{method:'PUT',foreign:true,body:{revision:1,enabled:true}})).status,403);
    assert.equal((await req('/api/admin/web-story-automation/run',{method:'POST'})).status,409);
    const saved=await req('/api/admin/web-story-automation',{method:'PUT',body:{revision:1,enabled:true,dailyLimit:1,groups:['recipes']}});assert.equal(saved.status,200);assert.deepEqual((await saved.json()).groups,['recipes']);
    assert.equal((await req('/api/admin/web-story-automation/run',{method:'POST',foreign:true})).status,403);
    assert.equal((await req('/api/admin/web-story-automation/run',{method:'POST'})).status,202);await x.daily.automation.awaitIdle();assert.equal(x.daily.automation.status().quota.attempted,1);assert.equal(x.calls.text,1);
    assert.equal((await req('/api/admin/web-story-automation/run',{method:'POST'})).status,202);await x.daily.automation.awaitIdle();assert.equal(x.daily.automation.status().quota.attempted,1);assert.equal(x.calls.text,1,'no extra provider cost after cap');
    const changed=await req('/api/admin/web-story-automation',{method:'PUT',body:{revision:2,groups:['news','sports'],enabled:false}});assert.equal(changed.status,200);assert.deepEqual((await changed.json()).groups,['news','sports']);
    assert.equal((await req('/api/admin/web-story-automation',{method:'PUT',body:{revision:2,enabled:true}})).status,409);
  }finally{await new Promise(resolve=>server.close(resolve));x.close();}
});
test('unknown provider codes never reach history; not-configured API does not enable jobs',async()=>{
  const secret='account private-token fixture';const x=setup({text:()=>{throw Object.assign(Error(secret),{code:secret});}});x.add('recipe');x.daily.automation.updateSettings({revision:1,enabled:true,dailyLimit:1,groups:['recipes']});x.daily.automation.run({manual:true});await x.daily.automation.awaitIdle();assert.doesNotMatch(JSON.stringify(x.daily.automation.status()),/private-token|account/);assert.match(x.daily.automation.status().history[0].summary,/precisa de revisão/);x.close();
  const y=setup({configured:false});y.add('recipe');const server=y.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));try{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/admin/web-story-automation',{method:'PUT',headers:{'content-type':'application/json','x-test-role':'admin',origin},body:JSON.stringify({revision:1,enabled:true})});assert.equal(response.status,503);assert.equal(y.daily.automation.status().enabled,false);assert.equal(y.calls.sync,0);assert.equal(y.calls.text,0);}finally{await new Promise(resolve=>server.close(resolve));y.close();}
});

test('automatic feasibility filters before merged pagination while manual sources remain visible',()=>{
  const trends=Array.from({length:251},(_,i)=>({key:'trend:'+i,id:'trend:'+i,kind:'trend',group:'news',title:'Tema '+i}));
  const x=setup({trends,automaticEligible:s=>s.key==='trend:250'||s.key.startsWith('eligible-')});
  for(let i=0;i<225;i++)x.add('blocked-'+String(i).padStart(3,'0'),'noticias');
  x.add('eligible-a','noticias');x.add('eligible-b','noticias');
  assert.deepEqual(x.daily.catalog.list({group:'news',automatic:true,limit:2}).map(s=>s.key),['trend:250','eligible-a']);
  assert.deepEqual(x.daily.catalog.list({group:'news',automatic:true,offset:1,limit:3}).map(s=>s.key),['eligible-a','eligible-b']);
  assert.deepEqual(x.daily.catalog.list({group:'news',automatic:true,offset:2,limit:2}).map(s=>s.key),['eligible-b']);
  assert.equal(x.daily.catalog.list({group:'news',limit:1})[0].key,'trend:0');
  assert.ok(x.daily.catalog.get('blocked-000'));assert.equal(x.calls.text,0);assert.equal(x.calls.sync,0);x.close();
});

test('impossible news and sports consume no job/quota while recipes still enter the normal quality checks',async()=>{
  const x=setup();x.add('blocked-news','noticias');x.add('blocked-sports','esportes');x.add('eligible-recipe');
  x.daily.automation.updateSettings({revision:1,enabled:true,dailyLimit:3,groups:['news','sports','recipes']});
  x.daily.automation.run({manual:true});await x.daily.automation.awaitIdle();
  assert.equal(x.daily.automation.status().quota.attempted,1);assert.equal(x.calls.text,1);assert.equal(x.calls.image,0);
  assert.deepEqual(x.daily.automation.status().history.map(job=>job.sourceKey),['eligible-recipe']);
  assert.equal(x.daily.catalog.list({group:'news'}).length,1);assert.equal(x.daily.catalog.list({group:'sports'}).length,1);x.close();
});

test('an entirely impossible research list completes with zero attempts, calls or hidden queue entries',async()=>{
  const x=setup({trends:[{key:'trend:blocked',id:'trend:blocked',kind:'trend',group:'news',title:'Tema sem fontes'}]});x.add('article-blocked','noticias');
  x.daily.automation.updateSettings({revision:1,enabled:true,dailyLimit:6,groups:['news']});
  x.daily.automation.run({manual:true});await x.daily.automation.awaitIdle();
  const status=x.daily.automation.status();assert.equal(status.quota.attempted,0);assert.equal(status.quota.remaining,6);assert.equal(status.reason,'no_candidates');assert.deepEqual(status.history,[]);assert.equal(x.calls.text,0);assert.equal(x.calls.image,0);assert.equal(x.calls.sync,0);x.close();
});

test('hundreds of short services or unusable photos do not consume slots or hide a later viable source',async()=>{
  const complete='O serviço prepara a descrição do negócio e apresenta os dados fornecidos pelo responsável. A equipe organiza o material aprovado e informa o formato de publicação na página contratada. O cliente acompanha a conferência dos textos e pode solicitar correções antes da entrega.';
  const services=()=>[...Array.from({length:225},(_,i)=>({slug:'a-'+i,title:'Plano '+i,description:'Anuncie sua loja no painel.',imageUrl:'/assets/cover.png'})),{slug:'b-no-photo',title:'Plano sem foto',description:complete},{slug:'z-complete',title:'Apresentação do negócio',description:complete,imageUrl:'/assets/cover.png'}];
  const x=setup({services});x.daily.automation.updateSettings({revision:1,enabled:true,dailyLimit:6,groups:['services']});
  assert.deepEqual(x.daily.catalog.list({group:'services',automatic:true}).map(x=>x.key),['service:z-complete']);
  assert.equal(x.daily.catalog.list({group:'services',limit:200}).length,200,'manual catalog remains available for corrections');
  x.daily.automation.run({manual:true});await x.daily.automation.awaitIdle();const status=x.daily.automation.status();
  assert.equal(status.quota.attempted,1);assert.equal(status.quota.remaining,5);assert.equal(x.calls.text,1);assert.equal(status.history[0].sourceKey,'service:z-complete');x.close();
});

test('explicit technical errors retain diagnostics as failed; unknown or mixed editorial failures remain review',async()=>{
  for(const [code,expected] of [['ai_text_unavailable','failed'],['openai_story_network_error','failed'],['unrecognized_provider_condition','review']]){
    const x=setup({text:()=>{throw Object.assign(Error('private provider detail'),{code});}});x.add('recipe');x.daily.automation.updateSettings({revision:1,enabled:true,dailyLimit:6,groups:['recipes']});
    x.daily.automation.run({manual:true});await x.daily.automation.awaitIdle();assert.equal(x.daily.automation.status().history[0].status,expected,code);
    x.daily.automation.run({manual:true});await x.daily.automation.awaitIdle();assert.equal(x.calls.text,1,'no same-day immediate retry');assert.equal(x.daily.automation.status().quota.attempted,1);assert.doesNotMatch(JSON.stringify(x.daily.automation.status()),/private provider detail/);x.close();
  }
  let drafts=0;const x=setup({text:system=>{if(system.startsWith('Você revisa'))return JSON.stringify({approved:false,grounded:true,original:true,complete:false,nonRepetitive:true,commerceBalanced:true,risk:'low',notes:'Faltou uma informação do procedimento.'});if(++drafts===2)throw Object.assign(Error('technical'),{code:'ai_text_unavailable'});return JSON.stringify({title:'Receita completa para preparar em casa',description:'Conheça os ingredientes e as etapas desta receita caseira.',imagePrompt:'Ilustração culinária.'});}});
  x.add('recipe');x.daily.automation.updateSettings({revision:1,enabled:true,dailyLimit:6,groups:['recipes']});x.daily.automation.run({manual:true});await x.daily.automation.awaitIdle();
  const held=x.daily.automation.status().history[0];assert.equal(held.status,'review');assert(held.diagnostics.qualityFailures.includes('complete'));assert.equal(x.calls.text,3);assert.equal(x.calls.image,0);x.close();
});

test('manual recovery is revision-bound, shows its later publication and never rewrites six old review jobs or quota',async()=>{
  const x=setup();x.add('recovery-recipe');const date=x.daily.automation.status().quota.date;
  const insert=x.db.prepare("INSERT INTO web_story_automation_jobs(source_key,fingerprint,group_name,day,status,owner,settings_revision,actor,started_at,summary) VALUES(?,?,'recipes',?,'review','old-worker',1,'old-reviewer',1,'Revisão antiga sem diagnóstico detalhado.')");
  for(let i=0;i<6;i++)insert.run(i?'legacy-'+i:'recovery-recipe','old-hash-'+i,date);
  const before=x.db.prepare('SELECT * FROM web_story_automation_jobs ORDER BY id').all(),server=x.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const call=async(path,method='GET',body)=>{const res=await fetch('http://127.0.0.1:'+server.address().port+path,{method,headers:{origin,'content-type':'application/json','x-test-role':'admin'},body:body?JSON.stringify(body):undefined});return {status:res.status,data:await res.json()};};
  try{
    const listed=await call('/api/admin/web-stories/sources?sourceKey=recovery-recipe');assert.deepEqual(listed.data.items.map(i=>i.id),['recovery-recipe']);
    assert.equal((await call('/api/admin/web-stories/sources?sourceKey=missing')).data.items.length,0);
    assert.equal(x.db.prepare('SELECT count(*) n FROM editorial_web_stories').get().n,0);
    let recovery=x.daily.automation.status().history.find(j=>j.sourceKey==='recovery-recipe').recovery;assert.equal(recovery.published,false);assert.match(recovery.editorUrl,/\?source=recovery-recipe$/);
    const created=await call('/api/admin/web-stories','POST',{articleId:'recovery-recipe'});assert.equal(created.status,201);let item=created.data;assert(item.draft.pages.length>=10);assert.equal(item.draft.pages.slice(1).map(p=>p.text).join(' '),recipe);
    const endpoint='/api/admin/web-stories/'+item.id;
    assert.equal((await call(endpoint+'/publish','POST',{revision:item.revision,reviewed:true,rightsConfirmed:true})).status,409);
    assert.equal((await call(endpoint+'/preview','POST',{revision:item.revision})).status,200);
    x.db.prepare("UPDATE editorial_articles SET summary=summary||' Mais detalhes.' WHERE id='recovery-recipe'").run();
    assert.equal((await call(endpoint+'/publish','POST',{revision:item.revision,reviewed:true,rightsConfirmed:true})).status,409,'changed source invalidates previously opened preview');
    item=(await call(endpoint+'/regenerate','POST',{revision:item.revision,confirmed:true})).data;
    assert.equal((await call(endpoint+'/preview','POST',{revision:item.revision})).status,200);
    assert.equal((await call(endpoint+'/publish','POST',{revision:item.revision,reviewed:true,rightsConfirmed:true})).status,200);
    const status=x.daily.automation.status(),job=status.history.find(j=>j.sourceKey==='recovery-recipe');assert.equal(job.status,'review');assert.equal(job.recovery.published,true);assert.equal(job.recovery.publishedRevision,item.revision);assert.match(job.recovery.editorUrl,/\?story=/);assert.equal(status.quota.remaining,0);assert.equal(status.publications.total,1);assert.equal(status.publications.today,1);
    assert.deepEqual(x.db.prepare('SELECT * FROM web_story_automation_jobs ORDER BY id').all(),before);assert.equal(x.calls.text,0);assert.equal(x.calls.image,0);
    assert.equal(x.db.prepare("SELECT actor FROM editorial_web_story_events WHERE event='published'").get().actor,'1');
    x.db.prepare("UPDATE editorial_articles SET status='draft' WHERE id='recovery-recipe'").run();assert.equal(x.daily.automation.status().history.find(j=>j.sourceKey==='recovery-recipe').recovery.published,false);assert.equal(x.daily.automation.status().publications.total,0);
  }finally{await new Promise(r=>server.close(r));x.close();}
});
