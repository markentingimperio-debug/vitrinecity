// Synthetic fixtures only: never connect to a model or a production database.
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync, unlinkSync, rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createJarvisModelGate} from '../jarvis-model-gate.js';
import {createJarvis} from '../jarvis-core.js';

const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw Error('Unmocked network is forbidden.');};
const reply=()=>Response.json({choices:[{message:{content:'O catálogo está em /ofertas. [1]'},finish_reason:'stop'}]});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
let passed=0;
async function check(name,fn){await fn();passed++;console.log('model gate PASS: '+name);}
async function memory(fn){const db=new Database(':memory:');try{await fn(db);}finally{db.close();}}

try{
  await check('one shared owner across instances, idempotent release and no queue',()=>memory(async db=>{
    let clock=1000;
    const admin=createJarvisModelGate(db,{now:()=>clock}),other=createJarvisModelGate(db,{now:()=>clock});
    const first=admin.acquire('admin');assert.equal(typeof first?.release,'function');
    assert.equal(admin.acquire('admin'),null);assert.equal(other.acquire('public'),null);
    first.release();first.release();
    const next=other.acquire('public');assert.ok(next);assert.equal(admin.acquire('admin'),null);
    next.release();assert.ok(admin.acquire('admin'));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM jarvis_model_lease').get().n,1);
  }));

  await check('expiry is bounded to 65 seconds and stale release cannot unlock the replacement',()=>memory(async db=>{
    let clock=1000;
    const a=createJarvisModelGate(db,{now:()=>clock}),b=createJarvisModelGate(db,{now:()=>clock});
    const old=a.acquire('admin',9999999);assert.ok(old);
    clock+=64999;assert.equal(b.acquire('public'),null);
    clock++;const current=b.acquire('public',45000);assert.ok(current);
    old.release();assert.equal(a.acquire('admin'),null);
    clock+=44999;assert.equal(a.acquire('admin'),null);
    clock++;const replacement=a.acquire('admin',1);assert.ok(replacement);
    current.release();assert.equal(b.acquire('public'),null);
    clock++;assert.ok(b.acquire('public'));
  }));

  await check('owner and duration are validated without changing an active lease',()=>memory(async db=>{
    const gate=createJarvisModelGate(db,{now:()=>1000});
    const lease=gate.acquire('admin'),before=db.prepare('SELECT * FROM jarvis_model_lease').get();
    for(const owner of [null,'','ADMIN','model','admin; DROP TABLE jarvis_documents'])assert.throws(()=>gate.acquire(owner));
    for(const ttl of [null,0,-1,0.5,NaN,Infinity,'45000',{}])assert.throws(()=>gate.acquire('public',ttl));
    assert.deepEqual(db.prepare('SELECT * FROM jarvis_model_lease').get(),before);lease.release();
  }));

  await check('database connections and restart preserve an unexpired lease',async()=>{
    const dir=mkdtempSync(path.join(tmpdir(),'vitrinecity-model-gate-')),file=path.join(dir,'gate.db');
    let one,two,clock=1000;
    try{
      one=new Database(file);two=new Database(file);
      const first=createJarvisModelGate(one,{now:()=>clock}),second=createJarvisModelGate(two,{now:()=>clock});
      assert.ok(first.acquire('public'));assert.equal(second.acquire('admin'),null);
      one.close();one=null;
      one=new Database(file);const restarted=createJarvisModelGate(one,{now:()=>clock});
      assert.equal(restarted.acquire('admin'),null);
      clock+=65000;const acquired=restarted.acquire('admin');assert.ok(acquired);
      assert.equal(second.acquire('public'),null);acquired.release();assert.ok(second.acquire('public'));
    }finally{
      one?.close();two?.close();unlinkSync(file);rmdirSync(dir);
    }
  });

  await check('busy public inference gives admin approved-memory fallback without a model fetch',()=>memory(async db=>{
    let calls=0;
    const core=createJarvis(db,{env:{JARVIS_LOCAL_MODEL:'1'},fetchImpl:async()=>{calls++;return reply();}});
    const before=core.list(),gate=createJarvisModelGate(db),publicLease=gate.acquire('public',45000);
    const result=await core.ask({question:'catálogo ofertas'},7);
    assert.equal(result.mode,'retrieval');assert.equal(calls,0);assert.match(result.answer,/sem síntese de IA/);
    assert.deepEqual(core.list(),before);assert.equal(gate.acquire('admin'),null);
    publicLease.release();assert.equal((await core.ask({question:'catálogo ofertas'},7)).mode,'local_model');
    assert.equal(calls,1);assert.deepEqual(core.list(),before);
    const leaseRows=JSON.stringify(db.prepare('SELECT * FROM jarvis_model_lease').all());
    const runRows=JSON.stringify(db.prepare('SELECT * FROM jarvis_runs').all());
    assert.doesNotMatch(leaseRows+runRows,/catálogo|ofertas|FONTES|pergunta/);
  }));

  await check('admin retains the lease until the entire response body is read',()=>memory(async db=>{
    let calls=0,body;
    const started=deferred(),gate=createJarvisModelGate(db);
    const core=createJarvis(db,{env:{JARVIS_LOCAL_MODEL:'1'},fetchImpl:async()=>{
      calls++;return new Response(new ReadableStream({start(controller){body=controller;started.resolve();}}));
    }});
    const before=core.list(),request=core.ask({question:'catálogo ofertas'},7);
    await started.promise;assert.equal(gate.acquire('public',45000),null);
    await new Promise(resolve=>setImmediate(resolve));assert.equal(gate.acquire('public'),null);
    body.enqueue(new TextEncoder().encode(JSON.stringify({choices:[{message:{content:'Veja /ofertas. [1]'},finish_reason:'stop'}]})));
    body.close();const result=await request;
    assert.equal(result.mode,'local_model');assert.equal(calls,1);assert.deepEqual(core.list(),before);
    const next=gate.acquire('public');assert.ok(next);next.release();
  }));

  await check('transport, status, body, format and validation failures release the model lease',async()=>{
    for(const respond of [
      ()=>{throw Error('Synthetic transport failure');},
      ()=>new Response('unavailable',{status:503}),
      ()=>new Response(new ReadableStream({start(controller){controller.error(Error('Synthetic body failure'));}})),
      ()=>new Response('not JSON'),
      ()=>new Response('x'.repeat(30001)),
      ()=>Response.json({choices:[{message:{content:'No valid citation'},finish_reason:'stop'}]})
    ])await memory(async db=>{
      const gate=createJarvisModelGate(db);
      const core=createJarvis(db,{env:{JARVIS_LOCAL_MODEL:'1'},fetchImpl:async()=>respond()});
      const before=core.list(),result=await core.ask({question:'catálogo ofertas'},7);
      assert.equal(result.mode,'retrieval');assert.deepEqual(core.list(),before);
      const next=gate.acquire('public');assert.ok(next);next.release();
    });
  });

  await check('pausing an in-flight admin inference releases its lease after abort',()=>memory(async db=>{
    const started=deferred(),gate=createJarvisModelGate(db);
    const core=createJarvis(db,{env:{JARVIS_LOCAL_MODEL:'1'},fetchImpl:(_url,init)=>new Promise((_resolve,reject)=>{
      init.signal.addEventListener('abort',()=>reject(Error('Synthetic aborted request')),{once:true});started.resolve();
    })});
    const before=core.list(),request=core.ask({question:'catálogo ofertas'},7);
    await started.promise;assert.equal(gate.acquire('public'),null);
    core.setEnabled({enabled:false},7);await assert.rejects(request,error=>error.status===503);
    const next=gate.acquire('public');assert.ok(next);next.release();assert.deepEqual(core.list(),before);
  }));

  await check('questions without approved sources do not acquire or invoke the model',()=>memory(async db=>{
    let calls=0;
    const core=createJarvis(db,{env:{JARVIS_LOCAL_MODEL:'1'},fetchImpl:async()=>{calls++;throw Error('Unexpected model request');}});
    const gate=createJarvisModelGate(db),before=core.list(),leaseBefore=db.prepare('SELECT * FROM jarvis_model_lease').get();
    const result=await core.ask({question:'xenobiologia interplanetária'},7);
    assert.equal(result.status,'no_sources');assert.equal(calls,0);assert.deepEqual(core.list(),before);
    assert.deepEqual(db.prepare('SELECT * FROM jarvis_model_lease').get(),leaseBefore);assert.ok(gate.acquire('public'));
  }));

  console.log(JSON.stringify({suite:'jarvis-model-gate',passed,production:false,externalNetwork:false,realModelCalls:0}));
}finally{globalThis.fetch=originalFetch;}
