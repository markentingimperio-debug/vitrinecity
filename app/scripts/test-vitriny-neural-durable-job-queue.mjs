import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Worker} from 'node:worker_threads';
import {createRequire} from 'node:module';
import Database from 'better-sqlite3';
import {createDurableJobQueue} from '../vitriny-neural/durable-job-queue.js';

const lanes={chat:{concurrency:2,perScopeConcurrency:1},image:{concurrency:1,perScopeConcurrency:1},video:{concurrency:1,perScopeConcurrency:1}};
const providers=()=>['chat','image','video'].map(lane=>({id:`fixture-${lane}`,enabled:true,lanes:[lane],capabilities:[`${lane}.test`],concurrency:lanes[lane].concurrency,perScopeConcurrency:1}));
const make=(options={})=>createDurableJobQueue({db:options.db||new Database(':memory:'),lanes,providers,...options});
const input=(scope='admin:1',lane='chat',extra={})=>({id:randomUUID(),scope,lane,capability:`${lane}.test`,idempotencyKey:randomUUID(),requestHash:'a'.repeat(64),groupKey:randomUUID(),...extra});
const done=(queue,job)=>{assert.equal(queue.markDispatched(job.id,job.lease_token),true);assert.equal(queue.settle(job.id,job.lease_token,{status:'completed',proof:'response_received'}),true);};

test('fifty durable jobs dispatch fairly across accounts and respect lane/account capacity',()=>{
  const db=new Database(':memory:'),queue=make({db});try{
    const ids=[];for(let scope=1;scope<=10;scope++)for(let n=0;n<5;n++)ids.push(queue.enqueue(input(`admin:${scope}`)).id);
    const served=[];
    for(let n=0;n<25;n++){
      const first=queue.claim('chat'),second=queue.claim('chat');
      assert.ok(first&&second);assert.notEqual(first.scope,second.scope);assert.equal(queue.claim('chat'),null);
      served.push(first.scope,second.scope);done(queue,first);done(queue,second);
    }
    assert.equal(new Set(served.slice(0,10)).size,10);assert.equal(queue.claim('chat'),null);
    assert.equal(new Set(ids).size,50);assert.equal(db.prepare("SELECT COUNT(*) n FROM neural_durable_jobs WHERE status='completed'").get().n,50);
  }finally{db.close();}
});

test('chat, image and video have independent lanes but shared provider limits remain effective',()=>{
  const db=new Database(':memory:'),queue=make({db});try{
    for(const lane of Object.keys(lanes))queue.enqueue(input('admin:1',lane));
    const chat=queue.claim('chat'),image=queue.claim('image'),video=queue.claim('video');assert.ok(chat&&image&&video);
    queue.enqueue(input('admin:2','image'));assert.equal(queue.claim('image'),null);
    done(queue,chat);done(queue,image);done(queue,video);
  }finally{db.close();}
  const sharedDb=new Database(':memory:'),shared=make({db:sharedDb,providers:()=>[{id:'shared',enabled:true,lanes:['chat','image'],capabilities:['chat.test','image.test'],concurrency:1,perScopeConcurrency:1}]});try{
    shared.enqueue(input('admin:1'));shared.enqueue(input('admin:2','image'));
    const job=shared.claim('chat');assert.ok(job);assert.equal(shared.claim('image'),null);done(shared,job);assert.ok(shared.claim('image'));
  }finally{sharedDb.close();}
});

test('two SQLite connections fence claims, idempotency, leases and retained capacity',()=>{
  const dir=mkdtempSync(join(tmpdir(),'neural-queue-test-')),file=join(dir,'queue.sqlite'),a=new Database(file),b=new Database(file);
  try{
    const one=make({db:a}),two=make({db:b});const seed=input();one.enqueue(seed);
    assert.equal(two.enqueue(seed).duplicate,true);assert.throws(()=>two.enqueue({...seed,requestHash:'b'.repeat(64)}),{code:'queue_conflict'});
    const claimed=one.claim('chat');assert.ok(claimed);assert.equal(two.claim('chat'),null);
    assert.equal(two.markDispatched(claimed.id,'foreign-token'),false);assert.equal(one.markDispatched(claimed.id,claimed.lease_token),true);
    assert.equal(two.settle(claimed.id,'foreign-token',{status:'completed',proof:'response_received'}),false);
    assert.equal(two.get(seed.scope,seed.id).status,'dispatched');assert.throws(()=>two.get('admin:2',seed.id),{code:'queue_not_found'});
  }finally{a.close();b.close();rmSync(dir,{recursive:true,force:true});}
});

test('independent concurrent SQLite workers do not claim or dispatch the same job twice despite startup skew',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'neural-queue-workers-')),file=join(dir,'queue.sqlite'),db=new Database(file),workers=[];
  const barrier=new SharedArrayBuffer(8),lock=new Int32Array(barrier),ready=new Set(),firstDispatches=new Map();let overlapVerified=false;
  try{
    const queue=make({db});for(let n=0;n<50;n++)queue.enqueue(input(`admin:${n%10+1}`));
    const source=`const {parentPort,workerData}=require('node:worker_threads');
      const Database=require(workerData.sqliteModule);
      (async()=>{
        const {createDurableJobQueue}=await import(workerData.module);
        const db=new Database(workerData.file),lock=new Int32Array(workerData.barrier);
        const waitFor=slot=>{if(Atomics.wait(lock,slot,0,15000)==='timed-out')throw Error('worker barrier timed out');};
        try{
          const queue=createDurableJobQueue({db,lanes:workerData.lanes,providers:()=>workerData.providers});
          parentPort.postMessage({ready:true,workerId:workerData.workerId});waitFor(0);
          if(workerData.delayMs)await new Promise(resolve=>setTimeout(resolve,workerData.delayMs));
          const claimed=[];
          for(let n=0;n<100;n++){
            const job=queue.claim('chat',{workerId:workerData.workerId});
            if(!job){if(!claimed.length)throw Error('worker could not claim its first job');break;}
            if(!queue.markDispatched(job.id,job.lease_token))throw Error('dispatch fence lost');
            claimed.push(job.id);
            if(claimed.length===1){
              parentPort.postMessage({firstDispatched:job.id,workerId:workerData.workerId});
              // Hold the first lease until the parent observes BOTH transports.
              // The fast worker cannot drain the backlog before the slow one runs.
              waitFor(1);
            }
            await new Promise(resolve=>setTimeout(resolve,1));
            if(!queue.settle(job.id,job.lease_token,{status:'completed',proof:'response_received'}))throw Error('settlement fence lost');
          }
          parentPort.postMessage({claimed,workerId:workerData.workerId});
        }finally{db.close();}
      })().catch(error=>{throw error;});`;
    const results=await Promise.all([0,1].map(index=>new Promise((resolve,reject)=>{
      const workerId=`fixture-worker-${index+1}`;
      // Exceeds the observed legacy drain time in the scheduling reproduction;
      // correctness now depends on barriers, not timer fairness or equal shares.
      const worker=new Worker(source,{eval:true,workerData:{file,barrier,workerId,delayMs:index===1?3000:0,lanes,providers:providers(),sqliteModule:createRequire(import.meta.url).resolve('better-sqlite3'),module:new URL('../vitriny-neural/durable-job-queue.js',import.meta.url).href}});workers.push(worker);
      let settled=false;const timer=setTimeout(()=>finish(Error(`worker timed out: ${workerId}`)),20000);
      function finish(error,result){if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(result);}
      worker.once('error',error=>finish(error));
      worker.once('exit',code=>{if(!settled)finish(Error(`worker exited before reporting results: ${workerId} (${code})`));});
      worker.on('message',message=>{
        if(settled)return;
        try{
          assert.equal(message.workerId,workerId);
          if(message.ready){
            assert.equal(ready.has(workerId),false);ready.add(workerId);
            if(ready.size===2){Atomics.store(lock,0,1);Atomics.notify(lock,0,2);}
          }else if(message.firstDispatched){
            assert.equal(firstDispatches.has(workerId),false);firstDispatches.set(workerId,message.firstDispatched);
            if(firstDispatches.size===2){
              const occupied=db.prepare("SELECT id,scope,lease_owner,lease_token FROM neural_durable_jobs WHERE status='dispatched'").all();
              assert.equal(occupied.length,2);assert.equal(new Set(occupied.map(job=>job.scope)).size,2);
              assert.equal(new Set(occupied.map(job=>job.lease_token)).size,2);
              for(const job of occupied)assert.equal(firstDispatches.get(job.lease_owner),job.id);
              assert.equal(queue.claim('chat'),null);
              assert.equal(db.prepare("SELECT COUNT(*) n FROM neural_durable_jobs WHERE status='completed'").get().n,0);
              overlapVerified=true;Atomics.store(lock,1,1);Atomics.notify(lock,1,2);
            }
          }else if(Array.isArray(message.claimed))finish(null,message.claimed);
          else throw Error('unexpected worker message');
        }catch(error){finish(error);}
      });
    })));
    const claimed=results.flat();assert.equal(claimed.length,50);assert.equal(new Set(claimed).size,50);
    assert.equal(overlapVerified,true);assert.ok(results.every(ids=>ids.length>0));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM neural_durable_jobs WHERE status='completed'").get().n,50);
  }finally{await Promise.all(workers.map(worker=>worker.terminate()));db.close();rmSync(dir,{recursive:true,force:true});}
});

test('restart resumes never-dispatched work but never replays dispatched unknown jobs',()=>{
  let clock=1000;const db=new Database(':memory:'),first=make({db,now:()=>clock,leaseMs:1000});try{
    const lostLease=first.enqueue(input('admin:1')),lostDispatch=first.enqueue(input('admin:2'));
    const a=first.claim('chat'),b=first.claim('chat');assert.equal(a.id,lostLease.id);assert.equal(b.id,lostDispatch.id);
    first.markDispatched(b.id,b.lease_token);clock+=1001;
    const restarted=make({db,now:()=>clock,leaseMs:1000});restarted.recover();
    assert.equal(restarted.get('admin:2',b.id).status,'unknown');assert.equal(restarted.get('admin:1',a.id).status,'queued');
    const retried=restarted.claim('chat');assert.equal(retried.id,a.id);assert.notEqual(retried.lease_token,a.lease_token);
    assert.equal(first.markDispatched(a.id,a.lease_token),false);done(restarted,retried);
    restarted.enqueue(input('admin:2'));assert.equal(restarted.claim('chat'),null);
    clock+=100000000;restarted.recover();assert.equal(restarted.claim('chat'),null);
    assert.equal(restarted.settle(b.id,b.lease_token,{status:'failed',proof:'timeout'}),false);
    assert.equal(restarted.settle(b.id,b.lease_token,{status:'completed',proof:'response_received'}),true);assert.ok(restarted.claim('chat'));
  }finally{db.close();}
});

test('queued cancellation frees backlog but dispatched cancellation holds slots until evidence',()=>{
  const db=new Database(':memory:'),queue=make({db});try{
    const before=queue.enqueue(input());assert.equal(queue.cancel(before.scope,before.id).status,'cancelled');assert.equal(queue.claim('chat'),null);
    const active=queue.enqueue(input()),claim=queue.claim('chat');queue.markDispatched(claim.id,claim.lease_token);
    queue.enqueue(input());const cancelled=queue.cancel(active.scope,active.id);assert.equal(cancelled.status,'unknown');assert.equal(cancelled.cancel_requested,1);
    assert.equal(queue.claim('chat'),null);assert.equal(queue.markUnknown(claim.id,claim.lease_token,'timeout'),true);assert.equal(queue.claim('chat'),null);
    assert.equal(queue.settle(claim.id,claim.lease_token,{status:'completed',proof:'response_received'}),true);
    assert.equal(queue.get(active.scope,active.id).status,'cancelled');assert.ok(queue.claim('chat'));
  }finally{db.close();}
});

test('leased cancellation fences dispatch, and only one transport per conversation can occupy capacity',()=>{
  const db=new Database(':memory:'),queue=make({db,lanes:{chat:{concurrency:4,perScopeConcurrency:4}},limits:{perScopeConcurrency:4},providers:()=>[{id:'fixture-chat',enabled:true,lanes:['chat'],capabilities:['chat.test'],concurrency:4,perScopeConcurrency:4}]});try{
    const group=randomUUID(),a=queue.enqueue(input('admin:1','chat',{groupKey:group})),b=queue.enqueue(input('admin:1','chat',{groupKey:group}));
    const claim=queue.claim('chat');assert.equal(claim.id,a.id);assert.equal(queue.claim('chat'),null);
    assert.equal(queue.cancel(a.scope,a.id).status,'cancelled');assert.equal(queue.markDispatched(a.id,claim.lease_token),false);
    assert.equal(queue.claim('chat').id,b.id);
  }finally{db.close();}
});

test('missing lane/provider/capability and revoked authorization are fail-closed at both fences',()=>{
  const db=new Database(':memory:');let allowed=true,registry=providers();
  const queue=make({db,providers:()=>registry,authorize:()=>allowed});try{
    queue.enqueue(input());registry=[];assert.equal(queue.claim('chat'),null);
    registry=providers();allowed=false;assert.equal(queue.claim('chat'),null);
    allowed=true;const claim=queue.claim('chat');allowed=false;assert.equal(queue.markDispatched(claim.id,claim.lease_token),false);
    allowed=true;registry=[];assert.equal(queue.markDispatched(claim.id,claim.lease_token),false);
    assert.equal(queue.get(claim.scope,claim.id).status,'leased');
  }finally{db.close();}
  const disabledDb=new Database(':memory:'),disabled=createDurableJobQueue({db:disabledDb,providers});try{disabled.enqueue(input());assert.equal(disabled.claim('chat'),null);}finally{disabledDb.close();}
});

test('global, account and lane backlog limits are durable; duplicate recovery is quota-neutral',()=>{
  const db=new Database(':memory:'),queue=make({db,limits:{backlog:3,perScopeBacklog:2,retained:5,perScopeRetained:4},lanes:{chat:{concurrency:1,perScopeConcurrency:1,backlog:3}}});try{
    const first=input();queue.enqueue(first);queue.enqueue(input());assert.equal(queue.enqueue(first).duplicate,true);
    assert.throws(()=>queue.enqueue(input()),{code:'queue_quota'});
    queue.enqueue(input('admin:2'));assert.throws(()=>queue.enqueue(input('admin:3')),{code:'queue_quota'});
    queue.cancel(first.scope,first.id);queue.enqueue(input('admin:3'));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM neural_durable_jobs').get().n,4);
  }finally{db.close();}
});

test('an enqueue transaction rolls back with its parent request transaction',()=>{
  const db=new Database(':memory:'),queue=make({db});try{
    assert.throws(db.transaction(()=>{queue.enqueue(input());throw Error('fixture rollback');}));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM neural_durable_jobs').get().n,0);
  }finally{db.close();}
});

test('accidental asynchronous policy callbacks fail closed without unhandled rejections',async()=>{
  for(const callback of ['authorize','providers']){
    const db=new Database(':memory:'),queue=make({db,[callback]:async()=>{throw Error('fixture async policy rejected');}});
    try{queue.enqueue(input());assert.equal(queue.claim('chat'),null);await new Promise(resolve=>setImmediate(resolve));}
    finally{db.close();}
  }
});

test('legacy dispatched imports retain unknown capacity without enabling a provider or applying backlog quotas',()=>{
  const db=new Database(':memory:'),queue=make({db,limits:{backlog:1}});try{
    const old=input('admin:1'),pending=input('admin:2');queue.enqueue(pending);queue.adoptUnknown(old);
    assert.equal(queue.get(old.scope,old.id).status,'unknown');assert.equal(queue.get(old.scope,old.id).provider_id,null);
    // The unknown provider identity consumes provider capacity conservatively.
    const token=queue.get(old.scope,old.id).lease_token;
    assert.equal(queue.settle(old.id,token,{status:'failed',proof:'not_dispatched'}),false);
    const other=queue.claim('chat');assert.ok(other);assert.equal(other.id,pending.id);assert.equal(queue.claim('chat'),null);
    assert.equal(queue.summary('admin:1').requiresReview,true);assert.equal(queue.summary('admin:2').unresolved,0);
  }finally{db.close();}
});
