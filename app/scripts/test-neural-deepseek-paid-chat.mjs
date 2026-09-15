import assert from 'node:assert/strict';
import {test} from 'node:test';
import Database from 'better-sqlite3';
import {createDeepSeekPaidChatAdapter,hashDeepSeekPaidChatRequest,deepSeekTariffWindow,DEEPSEEK_TARIFF_SCHEDULE} from '../vitriny-neural/providers/deepseek-paid-chat.js';
import {createPaidChatRuntime} from '../vitriny-neural/paid-chat-runtime.js';
import {createCoinWallet} from '../vitrine-coins-wallet.js';
import {createCoinAiWalletAdapter} from '../vitriny-neural/coin-wallet-adapter.js';
import {VITRINE_COINS_POLICY} from '../public/vitrine-coins-contract.js';

// In-memory SQLite, fake keys, injected synthetic transport only. No HTTP or secrets.
const START=Date.parse('2026-09-15T17:00:00.000Z'),MODEL='deepseek-flash';
const messages=()=>[{role:'user',content:'Escreva um rascunho de texto.'}];
function completion(extra={}){return {id:'deepseek-fixture-001',object:'chat.completion',model:MODEL,created:START/1000,choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'Rascunho sintético.',reasoning_content:null}}],usage:{prompt_tokens:100,prompt_cache_hit_tokens:40,prompt_cache_miss_tokens:60,completion_tokens:20,total_tokens:120,prompt_tokens_details:{cached_tokens:40},completion_tokens_details:{reasoning_tokens:0}},...extra};}
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','x-request-id':'fixture-request-001'}});
function request(){const msg=messages();return {requestId:'fixture-request-001',messages:msg,maxOutputTokens:128,permit:{authorized:true,providerId:'deepseek',scope:'user:1',requestId:'fixture-request-001',requestHash:hashDeepSeekPaidChatRequest({model:MODEL,messages:msg,maxOutputTokens:128}),model:MODEL,maxOutputTokens:128,reservationId:'fixture-request-001',maximumMicroBrl:'100000',expiresAt:START+60000}};}
function adapterFixture(options={}){const calls=[];const adapter=createDeepSeekPaidChatAdapter({enabled:true,apiKey:'synthetic-no-secret',model:MODEL,maxOutputTokens:128,now:()=>START,assertAuthorized:()=>true,fetchImpl:async(...args)=>{calls.push(args);return response(completion());},...options});return {adapter,calls};}
const held=r=>{assert.equal(r.billingDisposition,'hold');assert.equal(r.transportStarted,true);assert.equal(r.retryAllowed,false);assert.equal(r.text,null);};

test('DeepSeek text uses fixed endpoint, disabled thinking, canonical permit and exact cached usage',async()=>{
  const f=adapterFixture(),input=request(),r=await f.adapter.invoke(input);
  assert.equal(f.calls.length,1);const [url,init]=f.calls[0],body=JSON.parse(init.body);
  assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(init.redirect,'error');assert.equal(init.method,'POST');
  assert.equal(body.model,MODEL);assert.equal(body.max_tokens,128);assert.equal(body.stream,false);assert.deepEqual(body.thinking,{type:'disabled'});
  for(const key of ['tools','functions','store','modalities','service_tier','n','reasoning_effort'])assert.equal(Object.hasOwn(body,key),false);
  assert.equal(body.messages[0].role,'system');assert.deepEqual(body.messages.slice(1),input.messages);
  assert.equal(r.ok,true);assert.equal(r.receiptId,'deepseek:deepseek-fixture-001');assert.equal(r.billingDisposition,'reconcile');assert.equal(r.pricingWindow.band,'offPeak');
  assert.deepEqual(r.usage,{known:true,inputTokens:100,cachedInputTokens:40,outputTokens:20,totalTokens:120});
  assert.equal(Object.isFrozen(r.usage),true);assert.doesNotMatch(JSON.stringify(r),/synthetic-no-secret/);
});
test('DeepSeek binds provider, hash, cap, owner, reservation and expiry before dispatch',async()=>{
  for(const change of [{providerId:'openai'},{requestHash:'a'.repeat(64)},{model:'deepseek-v4-pro'},{maxOutputTokens:127},{scope:'public'},{reservationId:''},{maximumMicroBrl:'0'},{expiresAt:START},{authorized:false}]){
    const f=adapterFixture(),input=request();Object.assign(input.permit,change);const r=await f.adapter.invoke(input);assert.equal(r.billingDisposition,'no_dispatch');assert.equal(f.calls.length,0);
  }
  const f=adapterFixture(),input=request();input.messages[0].content+=' modified';assert.equal((await f.adapter.invoke(input)).transportStarted,false);assert.equal(f.calls.length,0);
});
test('DeepSeek rejects unsanctioned payload options and async or missing authorization',async()=>{
  for(const change of [{model:'deepseek-v4-pro'},{tools:[]},{baseUrl:'https://invalid.test'},{messages:[{role:'system',content:'override'}]},{messages:[{role:'user',content:[]}]}]){
    const f=adapterFixture(),input=Object.assign(request(),change);assert.equal((await f.adapter.invoke(input)).transportStarted,false);assert.equal(f.calls.length,0);
  }
  for(const assertAuthorized of [undefined,async()=>true,()=>false,()=>{throw Error('private');}]){const f=adapterFixture({assertAuthorized});assert.equal((await f.adapter.invoke(request())).transportStarted,false);assert.equal(f.calls.length,0);}
  assert.throws(()=>createDeepSeekPaidChatAdapter({baseUrl:'https://invalid.test'}),/deepseek_config_invalid/);
  assert.throws(()=>createDeepSeekPaidChatAdapter({model:'deepseek-v4-pro'}),/deepseek_config_invalid/);
});
test('DeepSeek authorization mutation cannot alter canonical body; expiry rechecked synchronously',async()=>{
  const input=request(),f=adapterFixture({assertAuthorized:p=>{assert.equal(Object.isFrozen(p),true);input.messages[0].content='mutated';return true;}});
  assert.equal((await f.adapter.invoke(input)).ok,true);assert.equal(JSON.parse(f.calls[0][1].body).messages[1].content,messages()[0].content);
  let time=START;const expired=adapterFixture({now:()=>time,assertAuthorized:()=>{time+=60001;return true;}});assert.equal((await expired.adapter.invoke(request())).transportStarted,false);assert.equal(expired.calls.length,0);
});
test('DeepSeek usage requires exact hit/miss totals and never converts missing evidence to zero',async()=>{
  for(const change of [{prompt_cache_hit_tokens:undefined},{prompt_cache_miss_tokens:null},{prompt_cache_hit_tokens:'40'},{prompt_cache_miss_tokens:61},{total_tokens:121},{prompt_tokens_details:{cached_tokens:39}},{completion_tokens_details:{reasoning_tokens:21}},{prompt_tokens_details:{cached_tokens:40,image_tokens:1}}]){
    const data=completion();data.usage={...data.usage,...change};const f=adapterFixture({fetchImpl:async()=>response(data)});const r=await f.adapter.invoke(request());held(r);assert.equal(r.usage.known,false);
  }
  const data=completion();data.usage.completion_tokens_details.reasoning_tokens=10;const r=await adapterFixture({fetchImpl:async()=>response(data)}).adapter.invoke(request());assert.equal(r.usage.outputTokens,20);assert.equal(r.ok,true);
});
test('DeepSeek unknown/model/receipt/time mismatch remains held, including cap violations',async()=>{
  for(const extra of [{model:'deepseek-v4-pro'},{model:'deepseek-v4-flash'},{id:null},{created:undefined},{created:START/1000-100},{usage:{...completion().usage,completion_tokens:129,total_tokens:229}}]){
    held(await adapterFixture({fetchImpl:async()=>response(completion(extra))}).adapter.invoke(request()));
  }
  assert.equal((await adapterFixture({acceptedResponseModels:['deepseek-v4-flash'],fetchImpl:async()=>response(completion({model:'deepseek-v4-flash'}))}).adapter.invoke(request())).ok,true);
});
test('DeepSeek tools/refusals/truncation never execute or retry but preserve known billable receipt',async()=>{
  for(const finish of ['tool_calls','content_filter','length','aborted','insufficient_system_resource']){
    const data=completion();data.choices[0].finish_reason=finish;const r=await adapterFixture({fetchImpl:async()=>response(data)}).adapter.invoke(request());assert.equal(r.ok,false);assert.equal(r.billingDisposition,'reconcile');assert.equal(r.retryAllowed,false);assert.equal(r.text,null);
  }
  for(const change of [{refusal:'Cannot comply.'},{refusal:{reason:'invalid'}}]){const data=completion();Object.assign(data.choices[0].message,change);const r=await adapterFixture({fetchImpl:async()=>response(data)}).adapter.invoke(request());assert.equal(r.ok,false);assert.equal(r.text,null);assert.equal(r.billingDisposition,'reconcile');}
  const r=await adapterFixture({fetchImpl:async()=>response(completion({error:{message:'Private reason'}}))}).adapter.invoke(request());assert.equal(r.ok,false);assert.equal(r.text,null);assert.equal(r.billingDisposition,'reconcile');assert.doesNotMatch(JSON.stringify(r),/Private reason/);
});
test('DeepSeek rejection without consumption proof, timeout, malformed JSON and oversized body never retry',async()=>{
  for(const status of [401,402,429,500])held(await adapterFixture({fetchImpl:async()=>response({error:{type:'rejected',message:'PRIVATE'}},status)}).adapter.invoke(request()));
  held(await adapterFixture({fetchImpl:async()=>{throw Error('private network');}}).adapter.invoke(request()));
  held(await adapterFixture({fetchImpl:async()=>new Response('{invalid')}).adapter.invoke(request()));
  held(await adapterFixture({maxResponseBytes:1024,fetchImpl:async()=>new Response('x'.repeat(1100))}).adapter.invoke(request()));
  let resolveLate,calls=0;const f=adapterFixture({timeoutMs:5,fetchImpl:()=>{calls++;return new Promise(resolve=>resolveLate=resolve);}}),r=await f.adapter.invoke(request());held(r);assert.equal(r.code,'deepseek_timeout_unknown');resolveLate(response(completion()));await new Promise(resolve=>setImmediate(resolve));assert.equal(r.billingDisposition,'hold');assert.equal(calls,1);
});
test('DeepSeek cancellation is free only before dispatch',async()=>{
  const c=new AbortController();c.abort();const f=adapterFixture(),r=await f.adapter.invoke({...request(),signal:c.signal});assert.equal(r.transportStarted,false);assert.equal(f.calls.length,0);
  const c2=new AbortController(),g=adapterFixture({fetchImpl:async()=>{c2.abort();return response(completion());}});held(await g.adapter.invoke({...request(),signal:c2.signal}));
});
test('DeepSeek UTC tariff windows handle both weekday bands, weekends and ambiguous boundaries',()=>{
  const classify=at=>{const t=Date.parse(at);return deepSeekTariffWindow({dispatchedAt:t,receivedAt:t+1000,createdAt:t});};
  for(const time of ['2026-09-15T01:30:00Z','2026-09-15T06:30:00Z'])assert.equal(classify(time).band,'peak');
  for(const time of ['2026-09-15T00:30:00Z','2026-09-15T04:30:00Z','2026-09-15T10:30:00Z','2026-09-19T02:30:00Z','2026-09-20T06:30:00Z'])assert.equal(classify(time).band,'offPeak');
  for(const time of ['2026-09-15T01:00:00Z','2026-09-15T03:59:58Z','2026-09-15T06:00:00Z','2026-09-15T09:59:58Z'])assert.equal(classify(time),null);
  assert.equal(deepSeekTariffWindow({dispatchedAt:START,receivedAt:START+120001,createdAt:START}),null);
  assert.equal(deepSeekTariffWindow({dispatchedAt:START,receivedAt:START-1,createdAt:START}),null);
});

const CONFIG={enabled:true,billingPolicyVersion:VITRINE_COINS_POLICY.version,fx:{version:'synthetic-fx',observedAt:'2026-09-14T17:00:00.000Z',usdToBrl:'5'},
  chat:{providerId:'deepseek',primary:true,model:MODEL,acceptedResponseModels:[MODEL],tariffSchedule:DEEPSEEK_TARIFF_SCHEDULE,tariffVersion:'synthetic-deepseek',effectiveAt:'2026-09-14T00:00:00.000Z',maxOutputTokens:128,
    tariffs:{peak:{inputUsdPerMillion:'0.30',cachedInputUsdPerMillion:'0.006',outputUsdPerMillion:'1.20'},offPeak:{inputUsdPerMillion:'0.15',cachedInputUsdPerMillion:'0.003',outputUsdPerMillion:'0.60'}}}};
const OPENAI={model:'gpt-4o-mini',tariffVersion:'synthetic-openai',effectiveAt:'2026-09-14T00:00:00.000Z',inputUsdPerMillion:'0.15',cachedInputUsdPerMillion:'0.075',outputUsdPerMillion:'0.60',maxOutputTokens:128};
function runtimeFixture({config=CONFIG,at=START,env={DEEPSEEK_API_KEY:'fake-key',OPENAI_API_KEY:'fake-key'},fetchBehavior}={}){
  const db=new Database(':memory:');let time=at,runtime,currentConfig=config;const calls=[];
  db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,is_admin INTEGER,email TEXT,account_status TEXT);INSERT INTO users VALUES(1,1,'fixture@example.test','active');CREATE TABLE neural_chat_requests(id TEXT,scope TEXT,assistant_message_id TEXT);");
  const coins=createCoinWallet({db,enabled:true,now:()=>time}),wallet=createCoinAiWalletAdapter({db,coinWallet:coins,now:()=>time});
  wallet.grant('user:1',{paymentReference:'mercadopago:123',amountMicroBrl:8500000,termsVersion:VITRINE_COINS_POLICY.version});
  function rebuild(next=currentConfig){runtime?.close();currentConfig=next;runtime=createPaidChatRuntime({db,wallet,config:next,env,now:()=>time,pollIntervalMs:30000,fetchImpl:async(url,init)=>{
    calls.push({url,body:JSON.parse(init.body)});assert.equal(db.prepare('SELECT state FROM neural_paid_chat_requests WHERE state=\'dispatched\'').get()?.state,'dispatched','dispatch must be durable before POST');
    if(fetchBehavior)return fetchBehavior(url,init,time);
    return response(url.includes('deepseek')?completion({id:'synthetic-receipt-'+calls.length,created:Math.floor(time/1000)}):{...completion({id:'synthetic-openai-'+calls.length,model:'gpt-4o-mini'}),usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120,prompt_tokens_details:{cached_tokens:40}}});
  }});runtime.setScopeAuthorizer(scope=>scope==='user:1');return runtime;}
  rebuild();return {db,wallet,calls,env,get runtime(){return runtime;},rebuild,setTime:t=>time=t,
    prepare:(id='00000000-0000-4000-8000-000000000001')=>runtime.prepare('user:1',{requestId:id,conversationId:'00000000-0000-4000-8000-000000000003',kind:'chat',message:'Escreva um rascunho.'}),
    confirm:(q,id='00000000-0000-4000-8000-000000000001')=>runtime.confirm('user:1',id,{quoteId:q.quoteId,idempotencyKey:'confirmation-'+id}),
    row:(id='00000000-0000-4000-8000-000000000001')=>db.prepare('SELECT * FROM neural_paid_chat_requests WHERE request_id=?').get(id),
    close:()=>{runtime.close();db.close();}};
}
test('paid DeepSeek snapshots both tariffs, reserves peak ceiling, charges offpeak cached actual once without use markup',async()=>{
  const f=runtimeFixture();try{
    assert.equal(f.runtime.prefersText,true);const q=f.prepare(),snapshot=JSON.parse(f.row().quote_json);assert.equal(f.calls.length,0);assert.equal(f.wallet.status('user:1').reservedMicroBrl,0);
    assert.equal(snapshot.providerId,'deepseek');assert.equal(snapshot.tariffs.offPeak.cachedInputUsdPerMillion,'0.003');assert.equal(snapshot.tariffs.peak.inputUsdPerMillion,'0.30');
    f.confirm(q);f.confirm(q);assert.equal(f.wallet.status('user:1').reservedMicroBrl,q.amountMicro);await f.runtime.wait('00000000-0000-4000-8000-000000000001');f.confirm(q);await f.runtime.wait('00000000-0000-4000-8000-000000000001');
    assert.equal(f.calls.length,1);assert.equal(f.row().state,'settled');assert.equal(f.row().charged_micro,106);assert.equal(f.wallet.status('user:1').chargedMicroBrl,106);assert.equal(f.wallet.status('user:1').reservedMicroBrl,0);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM vitrine_coin_events WHERE type='settled'").get().n,1);
    f.rebuild();await f.runtime.wait('00000000-0000-4000-8000-000000000001');assert.equal(f.calls.length,1);assert.equal(f.row().charged_micro,106);
  }finally{f.close();}
});
test('paid DeepSeek actual dispatch tariff wins over quote time, maximum covers either band',async()=>{
  const f=runtimeFixture({at:Date.parse('2026-09-15T00:58:00Z')});try{const q=f.prepare();f.setTime(Date.parse('2026-09-15T01:02:00Z'));f.confirm(q);await f.runtime.wait('00000000-0000-4000-8000-000000000001');assert.equal(f.row().state,'settled');assert.equal(f.row().charged_micro,211);assert.ok(q.amountMicro>=211);}finally{f.close();}
});
test('paid DeepSeek ambiguous transition and unknown transport remain held through restart with zero debit/no fallback',async()=>{
  for(const fetchBehavior of [async()=>{throw Error('response lost');},async()=>response({error:{type:'rate_limit'}},429),async()=>response(completion({created:Date.parse('2026-09-15T01:00:00Z')/1000}))]){
    const f=runtimeFixture({fetchBehavior});try{const q=f.prepare();f.confirm(q);await f.runtime.wait('00000000-0000-4000-8000-000000000001');assert.equal(f.row().state,'held');assert.equal(f.wallet.status('user:1').chargedMicroBrl,0);assert.equal(f.wallet.status('user:1').reservedMicroBrl,q.amountMicro);f.rebuild();f.confirm(q);f.setTime(START+180000);await f.runtime.wait('00000000-0000-4000-8000-000000000001');assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,'https://api.deepseek.com/chat/completions');}finally{f.close();}
  }
});
test('paid DeepSeek snapshot survives server config changes; old OpenAI quote is still OpenAI after switch',async()=>{
  const f=runtimeFixture();try{const q=f.prepare();const changed=structuredClone(CONFIG);changed.chat.tariffs.offPeak.inputUsdPerMillion='99';f.rebuild(changed);f.confirm(q);await f.runtime.wait('00000000-0000-4000-8000-000000000001');assert.equal(f.row().charged_micro,106);}finally{f.close();}
  const old=runtimeFixture({config:{...CONFIG,chat:OPENAI}});try{
    assert.equal(old.runtime.prefersText,false);const q=old.prepare();const raw=JSON.parse(old.row().quote_json);delete raw.providerId;old.db.prepare('UPDATE neural_paid_chat_requests SET quote_json=?').run(JSON.stringify(raw));
    old.rebuild(CONFIG);old.confirm(q);await old.runtime.wait('00000000-0000-4000-8000-000000000001');assert.equal(old.calls.length,1);assert.equal(old.calls[0].url,'https://api.openai.com/v1/chat/completions');assert.equal(old.row().charged_micro,120);assert.equal(old.row().state,'settled');
  }finally{old.close();}
  const inverse=runtimeFixture();try{const q=inverse.prepare();inverse.rebuild({...CONFIG,chat:OPENAI});inverse.confirm(q);await inverse.runtime.wait('00000000-0000-4000-8000-000000000001');assert.equal(inverse.calls.length,1);assert.equal(inverse.calls[0].url,'https://api.deepseek.com/chat/completions');assert.equal(inverse.row().charged_micro,106);assert.equal(inverse.row().state,'settled');}finally{inverse.close();}
});
test('paid DeepSeek opt-in fails closed without key, schedule or tariff; admin revocation blocks before POST',async()=>{
  for(const change of [{providerId:'other'},{tariffSchedule:undefined},{tariffVersion:undefined},{effectiveAt:undefined},{effectiveAt:'2026-09-16T00:00:00.000Z'},{maxOutputTokens:16385},{tariffs:{peak:CONFIG.chat.tariffs.peak}},{model:'deepseek-v4-pro'}]){
    const f=runtimeFixture({config:{...CONFIG,chat:{...CONFIG.chat,...change}}});try{assert.equal(f.runtime.status('user:1').capabilities.chat,false);assert.equal(f.runtime.prefersText,false);assert.equal(f.prepare(),null);assert.equal(f.calls.length,0);}finally{f.close();}
  }
  const noKey=runtimeFixture({env:{OPENAI_API_KEY:'fake'}});try{assert.equal(noKey.prepare(),null);assert.equal(noKey.runtime.prefersText,false);assert.equal(noKey.calls.length,0);}finally{noKey.close();}
  const f=runtimeFixture();try{const q=f.prepare();f.confirm(q);f.db.prepare("UPDATE users SET account_status='suspended' WHERE id=1").run();await f.runtime.wait('00000000-0000-4000-8000-000000000001');assert.equal(f.calls.length,0);assert.equal(f.row().state,'released');}finally{f.close();}
});
test('paid DeepSeek request hash cannot be altered after reservation and receipt reuse never double charges',async()=>{
  const f=runtimeFixture();try{const q=f.prepare();f.confirm(q);const input=JSON.parse(f.row().input_json);input.messages[0].content='changed';f.db.prepare('UPDATE neural_paid_chat_requests SET input_json=?').run(JSON.stringify(input));await f.runtime.wait('00000000-0000-4000-8000-000000000001');assert.equal(f.calls.length,0);assert.equal(f.row().state,'released');}finally{f.close();}
  const g=runtimeFixture({fetchBehavior:async()=>response(completion())});try{
    for(const id of ['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002']){const q=g.prepare(id);g.confirm(q,id);await g.runtime.wait(id);}
    assert.equal(g.calls.length,2);assert.equal(g.row('00000000-0000-4000-8000-000000000001').state,'settled');assert.equal(g.row('00000000-0000-4000-8000-000000000002').state,'held');assert.equal(g.wallet.status('user:1').chargedMicroBrl,106);
  }finally{g.close();}
});
