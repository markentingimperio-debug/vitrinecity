import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {createContentProviderRouting,normalizeContentQuote,contentRoutingDay} from '../content-provider-routing.js';

const START=Date.parse('2026-09-12T14:00:00Z');
const reference={id:'lia-avatar-v1',sha256:'a'.repeat(64),source:'/owned/lia.png'};
const voice={id:'lia-voice-v1',sha256:'b'.repeat(64),source:'/owned/lia.wav'};
const request={capability:'video',content:{prompt:'Apresente o conteúdo do dia.',durationSeconds:8},referencedAvatar:reference,voice};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,options={}){
  const db=options.db||new Database(':memory:');if(!options.db)t.after(()=>db.close());
  const clock={time:START},calls=[];
  const config={enabled:true,maxAttempts:2,providers:{google:{enabled:true,configured:true,revision:'v1'},heygen:{enabled:true,configured:true,revision:'v1'},abacus:{enabled:true,configured:true,revision:'v1'}},dailyLimits:{USD:'2','heygen:credits':'10','abacus:credits':'10'}};
  function adapter(id,hooks={}){return {id,capabilities:{types:['video'],referencedAvatar:true,voice:true},
    async preflight(args){calls.push({operation:'preflight',id,args});return hooks.preflight?hooks.preflight(args):{status:'ready',configured:true,allowed:true,identityHash:args.identityHash,quote:{unit:'USD',amount:'0.50',upperBound:true,validUntil:clock.time+60000}};},
    async submit(args){calls.push({operation:'submit',id,args});if(!args.beforeSubmit())return {status:'unavailable',notSubmitted:true};return hooks.submit?hooks.submit(args):{status:'completed',receiptId:id+'-receipt',identityHash:args.identityHash,output:{assetId:id+'-asset'}};},
    async reconcile(args){calls.push({operation:'reconcile',id,args});return hooks.reconcile?hooks.reconcile(args):{status:'completed',receiptId:args.receiptId||id+'-receipt',identityHash:args.identityHash,output:{assetId:id+'-asset'}};}};}
  const adapters=options.adapters?.(adapter,config,clock,calls)||[adapter('google'),adapter('heygen')];
  const routerOptions={db,adapters,getPolicy:()=>config,now:()=>clock.time,claimTtlMs:5000,pollIntervalMs:1000,retryDelayMs:1000};
  const router=createContentProviderRouting(routerOptions);
  const add=(id='daily-new-11',overrides={})=>router.createJob({id,request,budgets:{USD:'1','heygen:credits':'5','abacus:credits':'5'},...overrides});
  return {db,router,routerOptions,clock,config,calls,add,adapter,advance:(ms=1000)=>clock.time+=ms,paid:()=>calls.filter(c=>c.operation==='submit')};
}

test('registry rejects OpenRouter, unknown IDs and duplicates without constructing any provider client',t=>{
  const db=new Database(':memory:');t.after(()=>db.close());const adapter={id:'openrouter',capabilities:{types:['video']},preflight(){},submit(){},reconcile(){}};
  for(const id of ['openrouter','random-router'])assert.throws(()=>createContentProviderRouting({db,adapters:[{...adapter,id}]}),{code:'routing_adapter_invalid'});
  assert.throws(()=>createContentProviderRouting({db,adapters:[{...adapter,id:'google'},{...adapter,id:'google'}]}),{code:'routing_adapter_invalid'});
  const disabled=createContentProviderRouting({db});assert.equal(disabled.status().enabled,false);assert.deepEqual(disabled.status().providers,[]);
});

test('quotes preserve exact six-decimal amounts and never convert provider credits or accept estimates',()=>{
  const quote={unit:'USD',amount:'0.100001',upperBound:true,validUntil:START+1000};assert.equal(normalizeContentQuote(quote,'google',START).amountAtomic,100001);
  assert.equal(normalizeContentQuote({...quote,unit:'abacus:credits',amount:'1.5'},'abacus',START).amountAtomic,1500000);
  for(const bad of [{...quote,amount:0.1},{...quote,amount:'0.0000001'},{...quote,amount:'1e2'},{...quote,amount:'-1'},{...quote,unit:'credits'},{...quote,unit:'abacus:credits'},{...quote,upperBound:false},{...quote,validUntil:START}])assert.throws(()=>normalizeContentQuote(bad,'google',START));
});

test('only explicitly configured and permitted adapters of the same capability and identity features run',async t=>{
  const f=fixture(t,{adapters:(make,config)=>{config.providers.google.configured=false;const lacking=make('heygen');lacking.capabilities.voice=false;return [make('google'),lacking,make('abacus')];}});f.add();await f.router.run('daily-new-11');assert.deepEqual(f.paid().map(c=>c.id),['abacus']);assert.equal(f.calls.filter(c=>c.operation==='preflight').length,1);
  const unconfigured=fixture(t);unconfigured.config.providers.google.enabled=false;unconfigured.config.providers.heygen.configured=false;unconfigured.add();assert.equal((await unconfigured.router.run('daily-new-11')).state,'unavailable');assert.equal(unconfigured.calls.length,0);
});

test('new jobs are idempotent and their content, budgets and identity cannot be replaced or reopen completed work',async t=>{
  const f=fixture(t);const a=f.add();assert.deepEqual(f.add(),a);assert.throws(()=>f.add('daily-new-11',{request:{...request,voice:{...voice,id:'other-voice'}}}),{code:'routing_job_conflict'});
  assert.throws(()=>f.add('daily-new-11',{budgets:{USD:'2'}}),{code:'routing_job_conflict'});await f.router.run(a.id);f.add();await f.router.run(a.id);assert.equal(f.paid().length,1);assert.equal(f.router.getJob(a.id).state,'completed');assert.deepEqual(f.router.result(a.id),{assetId:'google-asset'});
  assert.doesNotMatch(JSON.stringify(f.router.getJob(a.id)),/Apresente|owned\/lia|lia-voice-v1/);
});

test('a no-submission preflight outage can select an equivalent provider, preserving exact avatar and voice',async t=>{
  const f=fixture(t,{adapters:make=>[make('google',{preflight:()=>({status:'unavailable',notSubmitted:true,httpStatus:503})}),make('heygen')]});f.add();assert.equal((await f.router.run('daily-new-11')).state,'completed');assert.deepEqual(f.paid().map(c=>c.id),['heygen']);assert.deepEqual(f.paid()[0].args.request,request);assert(Object.isFrozen(f.paid()[0].args.request.voice));
});

test('unproven preflight failure and policy refusal do not route around the failure',async t=>{
  for(const outcome of [{status:'unavailable'},{status:'policy_refused'}]){const f=fixture(t,{adapters:make=>[make('google',{preflight:()=>outcome}),make('heygen')]});f.add();assert.equal((await f.router.run('daily-new-11')).state,outcome.status==='policy_refused'?'policy_refused':'blocked');assert.equal(f.paid().length,0);assert.equal(f.calls.length,1);}
});

test('unavailable proof contradicted by a receipt blocks preflight and never releases a submitted reservation',async t=>{
  for(const phase of ['preflight','submit'])for(const throws of [false,true]){
    const contradictory=()=>{const value={status:'unavailable',notSubmitted:true,receiptId:'accepted-real-id'};if(throws)throw Object.assign(Error('unavailable'),value);return value;};
    const f=fixture(t,{adapters:make=>[make('google',{[phase]:contradictory,reconcile:()=>({status:'unknown'})}),make('heygen')]});
    f.add();assert.equal((await f.router.run('daily-new-11')).state,phase==='preflight'?'blocked':'unknown');
    assert.equal(f.router.status().budgets[0].reservedOrSpent,phase==='preflight'?'0':'0.5');
    f.advance();await f.router.run('daily-new-11');assert.deepEqual(f.paid().map(call=>call.id),phase==='preflight'?[]:['google']);
    if(phase==='submit')assert.equal(f.calls.at(-1).operation,'reconcile');
  }
});

test('reservation and submission intent exist before POST; a proven pre-accept rejection releases them for one fallback',async t=>{
  let f;f=fixture(t,{adapters:make=>[make('google',{submit:()=>{const row=f.db.prepare('SELECT * FROM content_routing_attempts').get();assert.equal(row.state,'submitting');assert.equal(row.budget_state,'reserved');assert.equal(row.quote_atomic,500000);assert.equal(f.router.status().budgets[0].reservedOrSpent,'0.5');return {status:'rejected_before_acceptance',confirmed:true,notAccepted:true};}}),make('heygen')]});f.add();assert.equal((await f.router.run('daily-new-11')).state,'pending');assert.equal(f.paid().length,1);assert.equal(f.router.status().budgets[0].reservedOrSpent,'0');
  await f.router.run('daily-new-11');assert.equal(f.paid().length,1,'no busy fallback loop');f.advance();assert.equal((await f.router.run('daily-new-11')).state,'completed');assert.deepEqual(f.paid().map(c=>c.id),['google','heygen']);
});

test('two attempts is a hard total ceiling, including after process restart',async t=>{
  const f=fixture(t,{adapters:make=>['google','heygen','abacus'].map(id=>make(id,{submit:()=>({status:'rejected_before_acceptance',confirmed:true,notAccepted:true})}))});f.add();await f.router.run('daily-new-11');f.advance();await f.router.run('daily-new-11');f.advance();const restarted=createContentProviderRouting(f.routerOptions);assert.equal((await restarted.run('daily-new-11')).state,'exhausted');assert.equal(f.paid().length,2);
});

test('timeout, 5xx, invalid body and missing receipt all hold the same provider and its cost reservation',async t=>{
  for(const outcome of [null,{}, {status:'accepted'}, {status:'rejected_before_acceptance',confirmed:true,notAccepted:true,httpStatus:503},'timeout']){
    const f=fixture(t,{adapters:make=>[make('google',{submit:()=>{if(outcome==='timeout')throw Error('private credential detail');return outcome;},reconcile:()=>({status:'unknown'})}),make('heygen')]});f.add();assert.equal((await f.router.run('daily-new-11')).state,'unknown');assert.equal(f.router.status().budgets[0].reservedOrSpent,'0.5');f.advance();await createContentProviderRouting(f.routerOptions).run('daily-new-11');assert.equal(f.paid().length,1);assert.equal(f.calls.at(-1).operation,'reconcile');assert.equal(f.calls.at(-1).id,'google');assert.doesNotMatch(JSON.stringify(f.router.getJob('daily-new-11')),/private credential/);
  }
});

test('pending acceptance spends the authorized ceiling and polls only when due with the same receipt and key',async t=>{
  const f=fixture(t,{adapters:make=>[make('google',{submit:args=>({status:'accepted',receiptId:'operation/123',identityHash:args.identityHash})})]});f.add();assert.equal((await f.router.run('daily-new-11')).state,'provider_pending');assert.equal(f.router.getJob('daily-new-11').attempts[0].budgetState,'spent');await f.router.run('daily-new-11');assert.equal(f.calls.filter(c=>c.operation==='reconcile').length,0);
  f.advance();const restarted=createContentProviderRouting(f.routerOptions);assert.equal((await restarted.reconcile('daily-new-11')).state,'completed');assert.equal(f.calls.at(-1).args.receiptId,'operation/123');assert.equal(f.calls.at(-1).args.idempotencyKey,f.paid()[0].args.idempotencyKey);assert.equal(f.paid().length,1);
});

test('accepted attempts persist account revision and cannot reconcile against a replacement configuration',async t=>{
  const f=fixture(t,{adapters:make=>[make('google',{submit:args=>({status:'accepted',receiptId:'original-account/123',identityHash:args.identityHash})}),make('heygen')]});
  f.add();await f.router.run('daily-new-11');const saved=f.db.prepare('SELECT * FROM content_routing_attempts').get();assert.equal(saved.provider_revision,'v1');
  f.config.providers.google.revision='new-account-v2';f.advance();const restarted=createContentProviderRouting(f.routerOptions);
  const held=await restarted.reconcile('daily-new-11');assert.equal(held.state,'provider_pending');assert.equal(held.error,'routing_provider_revision_changed');assert.equal(held.attempts[0].hasReceipt,true);
  assert.equal(f.calls.filter(call=>call.operation==='reconcile').length,0);assert.equal(f.paid().length,1);assert.equal(restarted.status().budgets[0].reservedOrSpent,'0.5');
  f.config.providers.google.revision='v1';f.advance();assert.equal((await restarted.run('daily-new-11')).state,'completed');
  assert.equal(f.calls.at(-1).args.configurationRevision,'v1');assert.equal(f.calls.at(-1).args.receiptId,saved.receipt_id);assert.equal(f.calls.at(-1).args.idempotencyKey,saved.idempotency_key);assert.equal(f.paid().length,1);
});

test('legacy attempts without a persisted account revision fail closed after additive schema migration',async t=>{
  const f=fixture(t,{adapters:make=>[make('google',{submit:()=>({status:'unknown'})})]});f.add();await f.router.run('daily-new-11');
  f.db.exec('ALTER TABLE content_routing_attempts DROP COLUMN provider_revision');f.advance();const restarted=createContentProviderRouting(f.routerOptions);
  const held=await restarted.run('daily-new-11');assert.equal(held.state,'unknown');assert.equal(held.error,'routing_provider_revision_changed');
  assert.equal(f.db.prepare('SELECT provider_revision FROM content_routing_attempts').get().provider_revision,'');assert.equal(f.calls.filter(call=>call.operation==='reconcile').length,0);assert.equal(f.paid().length,1);assert.equal(restarted.status().budgets[0].reservedOrSpent,'0.5');
});

test('changed result identity or a malformed completed output is never delivered and cannot trigger another provider',async t=>{
  for(const invalid of [{identityHash:'f'.repeat(64),output:{assetId:'wrong'}},{output:null}]){const f=fixture(t,{adapters:make=>[make('google',{submit:args=>({status:'completed',receiptId:'receipt123',identityHash:args.identityHash,output:{assetId:'asset'},...invalid}),reconcile:()=>({status:'unknown'})}),make('heygen')]});f.add();assert.equal((await f.router.run('daily-new-11')).state,'unknown');assert.equal(f.router.result('daily-new-11'),null);f.advance();await f.router.run('daily-new-11');assert.equal(f.paid().length,1);}
});

test('policy refusal after dispatch is terminal and never falls back',async t=>{
  const f=fixture(t,{adapters:make=>[make('google',{submit:()=>({status:'policy_refused',confirmed:true,notAccepted:true})}),make('heygen')]});f.add();assert.equal((await f.router.run('daily-new-11')).state,'policy_refused');f.advance();await f.router.run('daily-new-11');assert.equal(f.paid().length,1);assert.equal(f.router.status().budgets[0].reservedOrSpent,'0');
});

test('contradictory refusal with an acceptance receipt cannot release an uncertain cost',async t=>{
  const f=fixture(t,{adapters:make=>[make('google',{submit:()=>({status:'policy_refused',confirmed:true,notAccepted:true,receiptId:'contradictory-receipt'})}),make('heygen')]});f.add();assert.equal((await f.router.run('daily-new-11')).state,'policy_refused');assert.equal(f.router.status().budgets[0].reservedOrSpent,'0.5');f.advance();await f.router.run('daily-new-11');assert.equal(f.paid().length,1);
});

test('job and daily budgets use independent exact units; Abacus credits cannot spend an available USD ceiling',async t=>{
  const f=fixture(t,{adapters:make=>[make('abacus',{preflight:args=>({status:'ready',configured:true,allowed:true,identityHash:args.identityHash,quote:{unit:'abacus:credits',amount:'3',upperBound:true,validUntil:START+60000}})})]});f.add('no-unit',{budgets:{USD:'100'}});assert.equal((await f.router.run('no-unit')).state,'quota_blocked');assert.equal(f.paid().length,0);
  f.add('credit-job',{budgets:{'abacus:credits':'3'}});assert.equal((await f.router.run('credit-job')).state,'completed');const s=f.router.status();assert.equal(s.budgets.find(x=>x.unit==='abacus:credits').reservedOrSpent,'3');assert.equal(s.budgets.find(x=>x.unit==='USD').reservedOrSpent,'0');
  f.add('over-job',{budgets:{'abacus:credits':'2.999999'}});assert.equal((await f.router.run('over-job')).state,'quota_blocked');assert.equal(f.paid().length,1);
});

test('concurrent jobs and independent SQLite connections cannot oversubscribe the daily cap',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'content-routing-')),file=path.join(dir,'routing.sqlite'),db=new Database(file),secondDb=new Database(file);t.after(()=>{secondDb.close();db.close();fs.rmSync(dir,{recursive:true,force:true});});
  let release;const f=fixture(t,{db,adapters:make=>[make('google',{submit:()=>new Promise(resolve=>release=resolve)})]});f.config.dailyLimits.USD='0.50';f.add('job-a');f.add('job-b');const second=createContentProviderRouting({...f.routerOptions,db:secondDb});const first=f.router.run('job-a');await tick();assert.equal((await second.run('job-b')).state,'quota_blocked');assert.equal(f.paid().length,1);release({status:'unknown'});await first;assert.equal(f.router.status().budgets[0].remaining,'0');
});

test('concurrent runs for one job reserve and submit only once',async t=>{
  let release;const f=fixture(t,{adapters:make=>[make('google',{preflight:args=>new Promise(resolve=>release=()=>resolve({status:'ready',configured:true,allowed:true,identityHash:args.identityHash,quote:{unit:'USD',amount:'0.5',upperBound:true,validUntil:START+60000}}))})]});f.add();const first=f.router.run('daily-new-11');await tick();const second=createContentProviderRouting(f.routerOptions);assert.equal((await second.run('daily-new-11')).state,'preflighting');assert.equal(f.calls.length,1);release();await first;assert.equal(f.paid().length,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM content_routing_attempts').get().n,1);
});

test('restart after a persisted intent treats a crash as unknown and never releases quota or submits again',async t=>{
  let release;const f=fixture(t,{adapters:make=>[make('google',{submit:()=>new Promise(resolve=>release=resolve),reconcile:()=>({status:'unknown'})})]});f.add();const first=f.router.run('daily-new-11');await tick();assert.equal(f.db.prepare('SELECT state FROM content_routing_attempts').get().state,'submitting');f.advance(6000);const restarted=createContentProviderRouting(f.routerOptions);assert.equal((await restarted.run('daily-new-11')).state,'unknown');assert.equal(f.paid().length,1);assert.equal(f.router.status().budgets[0].reservedOrSpent,'0.5');
  release({status:'completed',receiptId:'late-receipt',identityHash:f.router.getJob('daily-new-11').identityHash,output:{assetId:'late-asset'}});await first;assert.equal(f.router.getJob('daily-new-11').state,'completed');
});

test('expired preflight claim can be replaced safely, and the old result cannot authorize a second POST',async t=>{
  let release,calls=0;const f=fixture(t,{adapters:make=>[make('google',{preflight:args=>{const ready={status:'ready',configured:true,allowed:true,identityHash:args.identityHash,quote:{unit:'USD',amount:'0.5',upperBound:true,validUntil:START+60000}};return ++calls===1?new Promise(resolve=>release=()=>resolve(ready)):ready;}})]});f.add();const first=f.router.run('daily-new-11');await tick();f.advance(6000);assert.equal((await createContentProviderRouting(f.routerOptions).run('daily-new-11')).state,'completed');release();await first;assert.equal(f.paid().length,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM content_routing_attempts').get().n,1);
});

test('a late stale status response cannot demote a newer completed receipt',async t=>{
  let release,calls=0;const f=fixture(t,{adapters:make=>[make('google',{submit:args=>({status:'accepted',receiptId:'operation/one',identityHash:args.identityHash}),reconcile:args=>++calls===1?new Promise(resolve=>release=()=>resolve({status:'unknown'})):{status:'completed',receiptId:args.receiptId,identityHash:args.identityHash,output:{assetId:'verified'}}})]});f.add();await f.router.run('daily-new-11');f.advance();const first=f.router.reconcile('daily-new-11');await tick();f.advance(6000);assert.equal((await createContentProviderRouting(f.routerOptions).reconcile('daily-new-11')).state,'completed');release();await first;assert.equal(f.router.getJob('daily-new-11').state,'completed');assert.deepEqual(f.router.result('daily-new-11'),{assetId:'verified'});
});

test('a stale status response cannot clear a newer active claim or permit a third overlapping lookup',async t=>{
  const pending=[];const f=fixture(t,{adapters:make=>[make('google',{submit:args=>({status:'accepted',receiptId:'operation/one',identityHash:args.identityHash}),reconcile:args=>new Promise(resolve=>pending.push({resolve,args}))})]});
  f.add();await f.router.run('daily-new-11');f.advance();const first=f.router.reconcile('daily-new-11');await tick();assert.equal(pending.length,1);
  f.advance(6000);const second=createContentProviderRouting(f.routerOptions).reconcile('daily-new-11');await tick();assert.equal(pending.length,2);
  const claim=f.db.prepare('SELECT claim_token,claim_until FROM content_routing_jobs').get();assert(claim.claim_token);assert.equal(claim.claim_until,f.clock.time+5000);
  pending[0].resolve({status:'unknown'});await first;assert.deepEqual(f.db.prepare('SELECT claim_token,claim_until FROM content_routing_jobs').get(),claim);
  f.advance();await f.router.reconcile('daily-new-11');assert.equal(pending.length,2,'current claim still has four seconds and owns the only lookup');
  pending[1].resolve({status:'completed',receiptId:pending[1].args.receiptId,identityHash:pending[1].args.identityHash,output:{assetId:'current-reader'}});await second;
  assert.equal(f.router.getJob('daily-new-11').state,'completed');assert.deepEqual(f.router.result('daily-new-11'),{assetId:'current-reader'});assert.equal(f.paid().length,1);
});

test('pause, changed configuration and midnight are rechecked at the last synchronous submission guard',async t=>{
  for(const change of [f=>f.config.enabled=false,f=>f.config.providers.google.revision='v2',f=>f.clock.time=Date.parse('2026-09-13T03:00:00Z')]){
    let f;f=fixture(t,{adapters:make=>[make('google',{submit:args=>{change(f);assert.equal(args.beforeSubmit(),false);return {status:'unavailable',notSubmitted:true};}})]});if(change.toString().includes('03:00'))f.clock.time=Date.parse('2026-09-13T02:59:59Z');f.add();await f.router.run('daily-new-11');assert.equal(f.router.getJob('daily-new-11').attempts[0].budgetState,'released');
  }
  assert.equal(contentRoutingDay(Date.parse('2026-09-13T02:59:59Z')),'2026-09-12');assert.equal(contentRoutingDay(Date.parse('2026-09-13T03:00:00Z')),'2026-09-13');
});

test('cancelled work and a late accepted result never reopen the job or discard its retained cost',async t=>{
  let release;const f=fixture(t,{adapters:make=>[make('google',{submit:()=>new Promise(resolve=>release=resolve)})]});f.add();const promise=f.router.run('daily-new-11');await tick();f.router.cancel('daily-new-11');release({status:'completed',receiptId:'cancelled-late',identityHash:f.router.getJob('daily-new-11').identityHash,output:{assetId:'late'}});await promise;assert.equal(f.router.getJob('daily-new-11').state,'cancelled');assert.equal(f.router.getJob('daily-new-11').attempts[0].budgetState,'spent');assert.equal(f.router.result('daily-new-11'),null);f.add();await f.router.run('daily-new-11');assert.equal(f.paid().length,1);
});
