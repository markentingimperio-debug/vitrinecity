import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import Database from 'better-sqlite3';
import {createAdminTeachingPilot} from '../vitriny-neural/admin-teaching-pilot.js';

// Entirely synthetic: in-memory ledgers, injected HTTP responses, no credentials.
const START=Date.parse('2026-09-15T12:00:00.000Z'),DS='deepseek-flash',OA='gpt-5.6-luna';
const messages=()=>[{role:'user',content:'Prepare uma aula usando apenas os fatos públicos aprovados fornecidos.'}];
const tariff=(providerId,modelId,version,input,cached,output)=>({providerId,modelId,version,effectiveAt:'2026-09-14T00:00:00.000Z',inputUsdPerMillion:input,cachedInputUsdPerMillion:cached,outputUsdPerMillion:output});
function config(extra={}){return{budgetMicroBrl:'20000000',maxOutputTokens:8192,fx:{version:'fixture-fx',observedAt:'2026-09-14T12:00:00.000Z',usdToBrl:'5'},tariffs:{
  deepseek:{peak:tariff('deepseek',DS,'fixture-peak','0.30','0.006','1.20'),offPeak:tariff('deepseek',DS,'fixture-offpeak','0.15','0.003','0.60')},
  openai:{actual:tariff('openai',OA,'fixture-luna','0.20','0.02','1.20'),ceiling:tariff('openai',OA,'fixture-luna-cap','0.25','0.02','1.20')}
},...extra};}
function completion(model,id='receipt-fixture-001',now=START){return{id,object:'chat.completion',model,created:Math.floor(now/1000),choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'{"lesson":"Exemplo candidato, não aprovado."}'}}],usage:{prompt_tokens:100,prompt_cache_hit_tokens:40,prompt_cache_miss_tokens:60,completion_tokens:20,total_tokens:120,prompt_tokens_details:{cached_tokens:40,cache_write_tokens:0}}};}
const response=data=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json','x-request-id':'fixture-request-001'}});
function fixture(t,extra={}){
  const db=new Database(':memory:');t.after(()=>db.close());const calls=[],clock={time:START},cfg=extra.config||config();
  const options={db,config:cfg,providerKeys:{deepseek:'synthetic-deepseek-key',openai:'synthetic-openai-key'},now:()=>clock.time,fetchImpl:async(url,init)=>{
    const body=JSON.parse(init.body);calls.push({url,body});
    const row=db.prepare('SELECT * FROM admin_teaching_pilot_runs ORDER BY created_at DESC,rowid DESC LIMIT 1').get();
    assert.equal(row.state,'dispatching');assert.equal(row.maximum_micro,row.charged_micro);
    assert.ok(row.maximum_micro>0);assert.ok(Number(pilot.status().usedMicroBrl)<=Number(pilot.status().budgetMicroBrl));
    return extra.receive?extra.receive({url,init,body,row,calls,clock,db}):response(completion(body.model,'receipt-fixture-'+calls.length,clock.time));
  }};
  const pilot=createAdminTeachingPilot(options);
  return{pilot,db,calls,clock,cfg,options,run:(overrides={})=>pilot.executeLesson({id:'lesson-fixture-001',providerId:'deepseek',model:DS,role:'teacher',messages:messages(),...overrides})};
}

test('zero budget and factories/status do not dispatch; ledger cannot silently raise its original cap',async t=>{
  const f=fixture(t,{config:config({budgetMicroBrl:'0'})});assert.equal(f.calls.length,0);assert.equal(f.pilot.status().remainingMicroBrl,'0');
  await assert.rejects(f.run(),{code:'teaching_budget_exhausted'});assert.equal(f.calls.length,0);assert.equal(f.pilot.status().count,0);
  const restarted=createAdminTeachingPilot({...f.options,config:config()});assert.equal(restarted.status().budgetMicroBrl,'0');
});

test('DeepSeek reserves peak ceiling before POST, settles verified off-peak usage with no customer uplift',async t=>{
  const f=fixture(t),r=await f.run();assert.equal(r.state,'completed');assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].url,'https://api.deepseek.com/chat/completions');assert.equal(f.calls[0].body.max_tokens,8192);assert.deepEqual(f.calls[0].body.thinking,{type:'disabled'});
  // 60*.15 + 40*.003 + 20*.60 = 21.12 microUSD; FX5 = 105.6 microBRL, conservatively ceil106.
  assert.equal(r.actualMicroBrl,'106');assert.equal(r.actualMicroUsd,'22');assert.equal(r.result.cost.exactUsd.numerator,'33');assert.equal(r.result.cost.exactUsd.denominator,'1562500');
  assert.equal(r.result.usage.known,true);assert.match(r.result.text,/candidato/);assert.ok(Number(r.maximumMicroBrl)>106);
  assert.equal(f.pilot.status().spentMicroBrl,'106');assert.equal(f.pilot.status().heldMicroBrl,'0');
});

test('DeepSeek peak dispatch settles peak and ambiguous tariff interval remains fully held',async t=>{
  const f=fixture(t);f.clock.time=Date.parse('2026-09-15T02:00:00.000Z');assert.equal((await f.run()).actualMicroBrl,'212');
  const g=fixture(t);g.clock.time=Date.parse('2026-09-15T04:00:00.000Z');const held=await g.run();
  assert.equal(held.state,'held');assert.equal(held.actualMicroBrl,null);assert.equal(held.chargedMicroBrl,held.maximumMicroBrl);assert.equal(held.result.text,null);
});

test('Luna uses none, reserves cache-write ceiling and settles only explicit zero-write text receipt',async t=>{
  const f=fixture(t),r=await f.run({providerId:'openai',model:OA,role:'reviewer'});
  assert.equal(r.state,'completed');assert.equal(f.calls[0].body.reasoning_effort,'none');assert.equal(f.calls[0].body.store,false);
  // (60*.20 + 40*.02 + 20*1.20)*5 = 184 microBRL.
  assert.equal(r.actualMicroBrl,'184');assert.equal(r.actualMicroUsd,'37');
  const record=f.db.prepare('SELECT input_json,pricing_json FROM admin_teaching_pilot_runs').get(),bound=JSON.parse(record.input_json).inputBound;
  assert.equal(r.maximumMicroBrl,String(Math.ceil((bound*.25+8192*1.2)*5)));assert.equal(JSON.parse(record.pricing_json).tariffs.actual.inputUsdPerMillion,'0.20');
  const g=fixture(t,{receive:({body})=>{const data=completion(body.model);delete data.usage.prompt_tokens_details.cache_write_tokens;return response(data);}});
  const held=await g.run({providerId:'openai',model:OA});assert.equal(held.state,'held');assert.equal(held.actualMicroBrl,null);assert.equal(held.result.text,null);
});

test('same stable id returns original result across restart and changed messages/role/model reject without dispatch',async t=>{
  const f=fixture(t),r=await f.run();assert.deepEqual(await f.run(),r);
  const restarted=createAdminTeachingPilot(f.options);assert.deepEqual(restarted.get(r.id),r);
  assert.deepEqual(await restarted.executeLesson({id:r.id,providerId:'deepseek',model:DS,role:'teacher',messages:messages()}),r);
  for(const overrides of [{messages:[{role:'user',content:'Outra pergunta pública.'}]},{role:'reviewer'},{providerId:'openai',model:OA}])await assert.rejects(f.run(overrides),{code:'teaching_id_conflict'});
  assert.equal(f.calls.length,1);
});

test('concurrent callers and another factory cannot claim a dispatch twice',async t=>{
  let finish;const waiting=new Promise(resolve=>{finish=resolve;});const f=fixture(t,{receive:async({body})=>{await waiting;return response(completion(body.model));}});
  const first=f.run();assert.equal(f.calls.length,1);
  const other=createAdminTeachingPilot(f.options),duplicate=await other.executeLesson({id:'lesson-fixture-001',providerId:'deepseek',model:DS,role:'teacher',messages:messages()});
  assert.equal(duplicate.state,'held');assert.equal(f.calls.length,1);finish();assert.equal((await first).state,'completed');assert.equal(f.calls.length,1);
});

test('transport uncertainty survives restart, retains full reserve and never replays or exposes error text',async t=>{
  const f=fixture(t,{receive:()=>{throw Error('synthetic-deepseek-key PRIVATE');}}),r=await f.run();
  assert.equal(r.state,'held');assert.equal(r.actualMicroBrl,null);assert.equal(r.chargedMicroBrl,r.maximumMicroBrl);assert.equal(r.retryAllowed,false);
  assert.equal(f.pilot.status().actualMicroBrl,null);assert.equal(f.pilot.status().actualMicroUsd,null);assert.equal(f.pilot.status().spentMicroBrl,'0');
  const restarted=createAdminTeachingPilot(f.options);assert.deepEqual(restarted.get(r.id),r);assert.deepEqual(await f.run(),r);assert.equal(f.calls.length,1);
  assert.doesNotMatch(JSON.stringify(r),/PRIVATE|synthetic-deepseek-key/);
});

test('budget includes unknown reservations and prevents another id overspending',async t=>{
  const f=fixture(t,{config:config({budgetMicroBrl:'100000'}),receive:()=>{throw Error('uncertain');}});
  const one=await f.run();assert.equal(one.state,'held');assert.ok(Number(one.maximumMicroBrl)>50000);
  await assert.rejects(f.run({id:'lesson-fixture-002'}),{code:'teaching_budget_exhausted'});assert.equal(f.calls.length,1);assert.ok(Number(f.pilot.status().usedMicroBrl)<=100000);
});

test('errors after dispatch retain ceiling even with usage; reused receipts and excessive usage never settle',async t=>{
  const f=fixture(t,{receive:({body})=>response({...completion(body.model),choices:[{index:0,finish_reason:'length',message:{role:'assistant',content:'partial'}}]})});
  const r=await f.run();assert.equal(r.state,'held');assert.equal(r.chargedMicroBrl,r.maximumMicroBrl);assert.equal(r.result.text,null);
  const g=fixture(t,{receive:({body})=>response(completion(body.model))});assert.equal((await g.run()).state,'completed');const reused=await g.run({id:'lesson-fixture-002'});
  assert.equal(reused.state,'held');assert.equal(reused.code,'teaching_receipt_reused');assert.equal(reused.actualMicroBrl,null);assert.equal(reused.result.text,null);
  assert.equal(reused.result.ok,false);
  const h=fixture(t,{receive:({body})=>{const data=completion(body.model);Object.assign(data.usage,{prompt_tokens:100000,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:100000,total_tokens:100020});data.usage.prompt_tokens_details.cached_tokens=0;return response(data);}});
  const over=await h.run();assert.equal(over.state,'held');assert.equal(over.code,'teaching_usage_limit');assert.equal(over.actualMicroBrl,null);
});

test('keyless no-dispatch is durable, does not spend, and a later key does not replay its id',async t=>{
  const f=fixture(t);const noKey=createAdminTeachingPilot({...f.options,providerKeys:{}}),input={id:'lesson-keyless-001',providerId:'deepseek',model:DS,role:'teacher',messages:messages()};
  const r=await noKey.executeLesson(input);assert.equal(r.state,'not_dispatched');assert.equal(r.chargedMicroBrl,'0');assert.equal(f.calls.length,0);
  assert.deepEqual(await f.pilot.executeLesson(input),r);assert.equal(f.calls.length,0);
});

test('strict input limits, immutable tariff snapshots, fresh FX and dedicated ledger fail closed',async t=>{
  const f=fixture(t);f.cfg.tariffs.deepseek.offPeak.inputUsdPerMillion='0';f.cfg.fx.usdToBrl='1000';assert.equal((await f.run()).actualMicroBrl,'106');
  await assert.rejects(f.run({id:'lesson-too-long',messages:[{role:'user',content:'x'.repeat(16001)}]}));
  await assert.rejects(f.run({id:'lesson-total-long',messages:Array.from({length:5},()=>({role:'user',content:'x'.repeat(15000)}))}),{code:'teaching_input_limit'});
  await assert.rejects(f.run({id:'lesson-fields',maximumMicroBrl:'1'}),{code:'teaching_input_invalid'});
  const g=fixture(t);g.clock.time+=8*86400000;await assert.rejects(g.run(),{code:'teaching_fx_stale'});assert.equal(g.calls.length,0);
  assert.throws(()=>createAdminTeachingPilot({...g.options,config:config({budgetMicroBrl:'20000001'})}),{code:'teaching_config_invalid'});
  assert.throws(()=>createAdminTeachingPilot({...g.options,config:config({maxOutputTokens:8193})}),{code:'teaching_config_invalid'});
  assert.throws(()=>createAdminTeachingPilot({...f.options,config:config({budgetMicroBrl:'0'})}),{code:'teaching_budget_below_existing_usage'});
  const operational=new Database(':memory:');t.after(()=>operational.close());operational.exec('CREATE TABLE existing_private_data(id INTEGER); INSERT INTO existing_private_data VALUES(7)');
  assert.throws(()=>createAdminTeachingPilot({...g.options,db:operational}),{code:'teaching_dedicated_ledger_required'});assert.equal(operational.prepare('SELECT id FROM existing_private_data').get().id,7);
  const source=readFileSync(new URL('../vitriny-neural/admin-teaching-pilot.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/process\.env|node:fs|coin-wallet|customerCoins|\.approve|\.review\(|\.createCandidate\(/);
  assert.deepEqual(f.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name).sort(),['admin_teaching_pilot_meta','admin_teaching_pilot_runs']);
});
