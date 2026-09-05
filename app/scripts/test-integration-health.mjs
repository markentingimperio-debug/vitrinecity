import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import express from 'express';
import { createIntegrationObserver, integrationHealth, openRouterOperation } from '../integration-health.js';
import { fetchMetaAggregatedInsights } from '../external-social-metrics.js';
import { setupAffiliateCatalog } from '../affiliate-catalog.js';

test('AI observations preserve results/errors, isolate account checks, and never retain payloads', async()=>{
  const now=Date.parse('2026-09-05T16:00:00Z');
  const observer=createIntegrationObserver({now:()=>now});
  const db=new Database(':memory:');
  try{
    const error=Object.assign(new Error('Inference is blocked: private-token private-prompt'),{status:403});
    await assert.rejects(observer.run(openRouterOperation('https://openrouter.ai/api/v1/chat/completions'),async()=>{throw error;}),e=>e===error);
    const response={data:{secret:'private-token'}};
    assert.equal(await observer.run(openRouterOperation('https://openrouter.ai/api/v1/key'),async()=>response),response);
    let items=integrationHealth(db,{observer,now});
    assert.equal(items.find(i=>i.id==='openrouter_text').code,'access_blocked');
    assert.equal(items.find(i=>i.id==='openrouter_account').status,'completed');
    assert.equal(items.find(i=>i.id==='openrouter_media').status,'unverified');
    assert(!JSON.stringify(items).includes('private-'));
    await observer.run('openrouter_text',async()=>response);
    items=integrationHealth(db,{observer,now:now+49*3600000});
    assert.equal(items.find(i=>i.id==='openrouter_text').status,'stale');
    assert.equal(items.find(i=>i.id==='openrouter_text').code,null);
    await assert.rejects(observer.run('attacker-input',async()=>response));
  }finally{db.close();}
});

test('social diagnostics use the latest persisted run, flag stalled work, and redact arbitrary errors',()=>{
  const db=new Database(':memory:');
  db.exec('CREATE TABLE social_external_sync_runs(id INTEGER PRIMARY KEY, provider TEXT,status TEXT,error_code TEXT,started_at TEXT,finished_at TEXT)');
  const insert=db.prepare('INSERT INTO social_external_sync_runs(provider,status,error_code,started_at,finished_at) VALUES(?,?,?,?,?)');
  insert.run('facebook','completed','','2026-09-05 10:00:00','2026-09-05 10:01:00');
  insert.run('facebook','failed','permissions','2026-09-05 11:00:00','2026-09-05 11:01:00');
  insert.run('tiktok','failed','access_token=private-token','2026-09-05 11:00:00','2026-09-05 11:01:00');
  insert.run('youtube','running','','2026-09-05 10:00:00',null);
  try{
    const items=integrationHealth(db,{now:Date.parse('2026-09-05T12:00:00Z')});
    assert.equal(items.find(i=>i.id==='facebook').code,'permissions');
    assert.equal(items.find(i=>i.id==='facebook').observedAt,'2026-09-05T11:01:00.000Z');
    assert.equal(items.find(i=>i.id==='youtube').status,'stalled');
    assert.equal(items.find(i=>i.id==='tiktok').code,'request_failed');
    assert.equal(items.find(i=>i.id==='kwai').status,'unverified');
    assert(!JSON.stringify(items).includes('private-token'));
    insert.run('facebook','completed','','2026-09-05 11:30:00','2026-09-05 11:31:00');
    assert.equal(integrationHealth(db).find(i=>i.id==='facebook').code,null);
  }finally{db.close();}
});

test('Meta permission failures keep the public error contract and attach a safe diagnostic',async()=>{
  let calls=0;
  const fetchImpl=async()=>{calls++;return {ok:false,status:400,json:async()=>({error:{code:10,message:'Requires pages_read_user_content; private-token'}})}};
  await assert.rejects(fetchMetaAggregatedInsights({accounts:[{pageId:'page-test',accessToken:'private-token'}],fetchImpl}),e=>e.message==='meta_api_400'&&e.diagnosticCode==='permissions');
  assert.equal(calls,1);
});

test('health API remains admin-only, non-cacheable, and performs no provider request',async()=>{
  const db=new Database(':memory:'),app=express();app.use(express.json());
  const catalog=setupAffiliateCatalog({app,db,siteUrl:'https://vitrinecity.com',publicDir:'/tmp',startMonitor:false,
    requireAdmin:(req,res,next)=>req.headers['x-admin']==='test'?next():res.sendStatus(401),sameOriginOnly:(_req,_res,next)=>next()});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try{
    const base='http://127.0.0.1:'+server.address().port;
    assert.equal((await fetch(base+'/api/admin/platform-health')).status,401);
    const response=await fetch(base+'/api/admin/platform-health',{headers:{'x-admin':'test'}});
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    const data=await response.json();assert.equal(data.integrations.length,9);
    assert.equal(data.integrations.find(i=>i.id==='facebook').status,'unverified');
  }finally{catalog.close();await new Promise(r=>server.close(r));db.close();}
});

test('a generic unsupported Meta field still falls back to basic metrics',async()=>{
  let calls=0;
  const fetchImpl=async()=>++calls===1
    ? {ok:false,status:400,json:async()=>({error:{code:100,message:'Unsupported metric'}})}
    : {ok:true,status:200,json:async()=>({data:[{id:'post-test',reactions:{summary:{total_count:3}}}]})};
  const result=await fetchMetaAggregatedInsights({accounts:[{pageId:'page-test',accessToken:'private-token'}],fetchImpl});
  assert.equal(calls,2);assert.equal(result.facebook[0].likes,3);
});
