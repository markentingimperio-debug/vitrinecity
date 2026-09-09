import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import express from 'express';
import Database from 'better-sqlite3';
import {setupDailyWebStories} from '../web-story-daily.js';
import {EDITORIAL_CHANNELS} from '../editorial-channel-sources.js';

const origin='https://vitrinecity.test',publicDir=fileURLToPath(new URL('../public',import.meta.url));
const body='O Banco Central publicou uma decisão sobre a taxa de juros e apresentou os dados da inflação que sustentam o comunicado. A documentação informa as condições da análise e os próximos procedimentos de acompanhamento. Os responsáveis explicam como consultar o documento completo nos canais públicos da instituição. ';
function fixture({complete=true,deferred=null}={}){
  const db=new Database(':memory:');db.exec('CREATE TABLE editorial_articles(id TEXT PRIMARY KEY,slug TEXT,title TEXT,summary TEXT,body TEXT,image_url TEXT,portal TEXT,status TEXT,updated_at TEXT,published_at TEXT,sources_json TEXT);');let allowed=true;const calls={feeds:0,search:0,articles:0,text:0,image:0};
  const app=express();app.use(express.json());
  const daily=setupDailyWebStories({app,db,siteUrl:origin,publicDir,dataDir:'.',services:()=>[],courses:()=>[],schedule:false,canRun:()=>allowed,isConfigured:()=>true,
    requireAdmin:(req,res,next)=>{if(req.headers['x-role']!=='admin')return res.sendStatus(req.headers['x-role']?403:401);req.user={id:1};next();},sameOriginOnly:(req,res,next)=>req.headers.origin===origin?next():res.sendStatus(403),
    searchSources:async()=>{calls.search++;return [{url:'https://www.bbc.com/portuguese/juros'},{url:'https://agenciabrasil.ebc.com.br/economia/juros'}];},
    sourceFetchImpl:async url=>{const c=EDITORIAL_CHANNELS.find(channel=>channel.feedUrl===url);if(c){calls.feeds++;if(deferred&&c.id==='tv-brasil')return deferred;const entry=c.id==='tv-brasil'?`<entry><id>yt:video:video000001</id><yt:videoId>video000001</yt:videoId><yt:channelId>${c.channelId.slice(2)}</yt:channelId><title>Banco Central aumenta juros no Brasil</title><published>${new Date().toISOString()}</published></entry>`:'';return new Response(`<feed><id>yt:channel:${c.channelId.slice(2)}</id><yt:channelId>${c.channelId.slice(2)}</yt:channelId>${entry}</feed>`,{headers:{'content-type':'text/xml'}});}if(url.includes('trends.google.com'))return new Response('<rss><channel></channel></rss>',{headers:{'content-type':'text/xml'}});calls.articles++;return new Response(complete?`<article><h1>Banco Central anuncia juros</h1><p>${body}</p><p>Confira o comunicado da instituição. ${body}</p></article>`:'<main>Resumo de busca não é fonte completa.</main>',{headers:{'content-type':'text/html'}});},
    requestText:async()=>{calls.text++;return JSON.stringify({insufficient:true});},requestImage:async()=>{calls.image++;throw Error('no image call');},assets:{outputDir:publicDir,image:async(url,{logo=false}={})=>{assert.equal(logo,true);return {url,width:192,height:192,hash:'a'.repeat(64)};},library:async()=>[]}});
  return {db,app,daily,calls,pause:()=>allowed=false,enable:()=>daily.automation.updateSettings({revision:1,enabled:true,dailyLimit:6,groups:['news']}),close:()=>{daily.close();db.close();}};
}
test('same hourly sync creates viable source before paid claim; incomplete metadata uses no job or quota',async()=>{
  for(const complete of [true,false]){const x=fixture({complete});x.enable();assert.equal(x.daily.catalog.list({automatic:true,group:'news'}).length,0);await x.daily.sync();
    assert.equal(x.calls.feeds,4);assert.equal(x.calls.search,1);assert.equal(x.calls.articles,2);assert.equal(x.daily.automation.status().quota.attempted,0);assert.equal(x.calls.text,0);assert.equal(x.daily.catalog.list({automatic:true,group:'news'}).length,Number(complete));
    const before={...x.calls};await x.daily.sync();assert.deepEqual(x.calls,before,'same clock and manual sync do not bypass hourly cooldown');
    x.daily.automation.run({manual:true});await x.daily.automation.awaitIdle();assert.equal(x.daily.automation.status().quota.attempted,Number(complete));assert.equal(x.calls.text,Number(complete),JSON.stringify(x.daily.automation.status().history));assert.equal(x.calls.image,0);assert.equal(x.daily.channelSources.snapshot().items[0].sourceStatus,complete?'evidence_ready':'research_pending');x.close();}
});
test('real admin routes enforce auth, origin, read-only GET, pause, singleflight and closed lifecycle',async()=>{
  let resolve;const deferred=new Promise(done=>resolve=done);const x=fixture({deferred});x.enable();const server=x.app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));const base='http://127.0.0.1:'+server.address().port;
  const request=(path='',method='GET',role='admin',originValue=origin)=>fetch(base+'/api/admin/editorial-sources'+path,{method,headers:{origin:originValue,...role?{'x-role':role}:{}}});
  try{
    assert.equal((await request('','GET',null)).status,401);assert.equal((await request('','GET','member')).status,403);assert.equal((await request('/sync','POST','admin','https://evil.test')).status,403);
    const before=x.db.prepare('SELECT total_changes() n').get().n;assert.equal((await request()).status,200);assert.equal((await request('?q=Banco&limit=12&sort=views')).status,200);assert.equal(x.db.prepare('SELECT total_changes() n').get().n,before);assert.equal(x.calls.feeds,0);
    assert.equal((await request('?limit=201')).status,400);assert.equal((await request('/sync','POST')).status,202);assert.equal((await request('/sync','POST')).status,409);const pending=x.daily.sync();x.pause();resolve(new Response('<feed/>',{headers:{'content-type':'text/xml'}}));await pending;
    assert.equal(x.calls.feeds,1);assert.equal(x.daily.channelSources.snapshot().total,0);assert.equal((await request('/sync','POST')).status,409);assert.equal((await(await request()).json()).controls.reason,'global_paused');x.daily.close();assert.equal((await(await request()).json()).controls.reason,'closed');assert.equal((await request('/sync','POST')).status,409);assert.equal(x.daily.automation.status().quota.attempted,0);
  }finally{await new Promise(done=>server.close(done));x.close();}
});
