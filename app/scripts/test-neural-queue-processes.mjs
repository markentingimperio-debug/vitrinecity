import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {createDurableJobQueue} from '../vitriny-neural/durable-job-queue.js';

const create=db=>createDurableJobQueue({db,lanes:{chat:{concurrency:2,perScopeConcurrency:1}},
  providers:()=>[{id:'fixture-provider',enabled:true,lanes:['chat'],capabilities:['support.draft-reply'],concurrency:2,perScopeConcurrency:1}]});

if(process.argv[2]==='--claim-worker'){
  globalThis.fetch=()=>{throw Error('external_network_disabled_in_queue_test');};
  const db=new Database(process.argv[3],{timeout:5000}),queue=create(db);
  process.send({ready:true});
  process.once('message',()=>{
    const claimed=[];
    for(let n=0;n<5;n++){const job=queue.claim('chat');if(job)claimed.push({id:job.id,scope:job.scope});}
    db.close();process.send({claimed},()=>process.disconnect());
  });
}else{
  test('four independent processes cannot overclaim two shared slots under a 50-job burst',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'lia-queue-race-')),filename=join(dir,'queue.db'),db=new Database(filename,{timeout:5000});
    const children=[];
    try{
      db.pragma('journal_mode = WAL');const queue=create(db);
      for(let n=0;n<50;n++)queue.enqueue({id:randomUUID(),scope:`admin:fixture-${n}`,lane:'chat',capability:'support.draft-reply',
        idempotencyKey:randomUUID(),requestHash:'a'.repeat(64),groupKey:randomUUID()});
      const ready=[],results=[],exits=[];
      for(let n=0;n<4;n++){
        const child=fork(fileURLToPath(import.meta.url),['--claim-worker',filename],{
          env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,NODE_ENV:'test'},
          stdio:['ignore','pipe','pipe','ipc']});
        children.push(child);exits.push(once(child,'exit'));
        ready.push(new Promise((resolve,reject)=>{child.once('error',reject);child.once('message',message=>message?.ready?resolve():reject(Error('worker_not_ready')));}));
        results.push(new Promise((resolve,reject)=>{child.once('error',reject);child.on('message',message=>{if(Array.isArray(message?.claimed))resolve(message.claimed);});child.once('exit',code=>{if(code!==0)reject(Error('worker_failed'));});}));
      }
      const timeout=AbortSignal.timeout(15000);
      const timed=promise=>Promise.race([promise,new Promise((_,reject)=>timeout.addEventListener('abort',()=>reject(Error('queue_worker_timeout')),{once:true}))]);
      await timed(Promise.all(ready));for(const child of children)child.send({claim:true});
      const claimed=(await timed(Promise.all(results))).flat();await timed(Promise.all(exits));
      assert.equal(claimed.length,2);assert.equal(new Set(claimed.map(j=>j.id)).size,2);
      assert.equal(new Set(claimed.map(j=>j.scope)).size,2);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM neural_durable_jobs WHERE status='leased'").get().n,2);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM neural_durable_jobs WHERE status='queued'").get().n,48);
      assert.equal(queue.claim('chat'),null);
    }finally{
      for(const child of children)if(child.exitCode===null)child.kill();
      await Promise.all(children.map(child=>child.exitCode===null?once(child,'exit').catch(()=>{}):Promise.resolve()));
      db.close();assert.ok(dir.startsWith(join(tmpdir(),'lia-queue-race-')));rmSync(dir,{recursive:true,force:true});
    }
  });
}
