import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import express from 'express';
import Database from 'better-sqlite3';
import {setupDailyWebStories} from '../web-story-daily.js';

const origin='https://vitrinecity.test',sha=value=>createHash('sha256').update(value).digest('hex');
const paragraph='Observe as informações disponíveis e consulte a página de origem antes de escolher. O guia explica os cuidados, as condições e as possibilidades em detalhes para ajudar a compreender o assunto. ';
function setup({trends=[],enrich,getEnriched,text,configured=true}={}) {
  const db=new Database(':memory:');db.exec('CREATE TABLE editorial_articles(id TEXT PRIMARY KEY,slug TEXT,title TEXT,summary TEXT,body TEXT,image_url TEXT,portal TEXT,status TEXT,updated_at TEXT,published_at TEXT,sources_json TEXT);');
  const add=(id,portal='receitas')=>db.prepare('INSERT INTO editorial_articles VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,id.replace(/:/g,'-'),'Guia público completo '+id,paragraph,paragraph.repeat(5),'/assets/guide.png',portal,'published','2026-09-08T12:00:00Z','2026-09-08T12:00:00Z','[]');
  const app=express();app.use(express.json());const calls={configured:0,text:0,image:0,sync:0};
  const research={list:({q='',group='all',limit=50,offset=0}={})=>trends.filter(x=>(group==='all'||x.group===group)&&x.title.includes(q)).slice(offset,offset+limit),get:key=>trends.find(x=>x.key===key)||null,getEnriched:getEnriched||((s)=>s),enrich:enrich||((s)=>s),syncTrends:async()=>{calls.sync++;return {count:trends.length};}};
  const daily=setupDailyWebStories({app,db,siteUrl:origin,publicDir:fileURLToPath(new URL('../public',import.meta.url)),dataDir:'.',schedule:false,research,services:()=>[],courses:()=>[],isConfigured:()=>{calls.configured++;return configured;},requireAdmin:(req,res,next)=>{const role=req.headers['x-test-role'];if(!role)return res.sendStatus(401);if(role!=='admin')return res.sendStatus(403);req.user={id:1};next();},sameOriginOnly:(req,res,next)=>req.headers.origin===origin?next():res.sendStatus(403),requestText:async()=>{calls.text++;if(text)return text();return JSON.stringify({insufficient:true});},requestImage:async()=>{calls.image++;throw Error('unexpected image');},assets:{outputDir:fileURLToPath(new URL('../public/assets',import.meta.url)),image:async(url,{logo=false}={})=>({url,width:logo?192:1080,height:logo?192:1920,hash:'a'.repeat(64)}),poster:async()=>'/story-assets/a.jpg',library:async()=>[]}});
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
  const enrichSource=s=>checked?{...s,summary:'Pesquisa verificada',body:paragraph.repeat(8),sources:evidence.map(({excerpt,...rest})=>rest),facts:{evidence},evidenceReady:true}:s;
  const x=setup({getEnriched:enrichSource,enrich:async s=>{checked=true;return enrichSource(s);}});x.add('article-news','noticias');
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
