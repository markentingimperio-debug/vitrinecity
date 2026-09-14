import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createKlingPaidVideoAdapter,hashKlingPaidVideoRequest} from '../vitriny-neural/providers/kling-paid-video.js';

// Synthetic fixtures only. No environment credentials, real HTTP, or paid jobs.
const START=1800000000000,ACCOUNT='account-fixture',REVISION='policy-fixture';
const content=()=>({prompt:'Uma planta fictícia crescendo em um vaso azul.',resolution:'720p',aspectRatio:'16:9',durationSeconds:5,externalTaskId:'external-fixture-001'});
const item=(extra={})=>({id:'task-fixture-001',external_id:'external-fixture-001',status:'submitted',create_time:START,update_time:START,...extra});
const cash=()=>({charge_type:'cash',cash_type:'balance',amount:'0.4200',currency:'USD',list_price:'0.5600'});
const unit=()=>({charge_type:'unit',amount:'3.000',package_type:'video'});
const output=()=>({type:'video',id:'output-fixture-001',url:'https://media.example.invalid/video.mp4?signature=fixture',duration:'5.000'});
const envelope=data=>({code:0,message:'PRIVATE ignored provider message',request_id:'remote-request-001',data});
const response=data=>new Response(JSON.stringify(envelope(data)),{headers:{'content-type':'application/json'}});
function request(extra={}){
  const input={requestId:'request-fixture-001',...content(),...extra};
  input.permit={authorized:true,scope:'store:fixture',requestId:input.requestId,requestHash:hashKlingPaidVideoRequest(content()),model:'kling-3.0',accountBinding:ACCOUNT,policyRevision:REVISION,externalTaskId:input.externalTaskId,reservationId:'reservation-fixture-001',quoteId:'quote-fixture-001',maximumMicroBrl:'999999',expiresAt:START+60000,...extra.permit};
  return input;
}
function fixture(options={}){
  const calls=[],authorizations=[],pollAuthorizations=[];
  const adapter=createKlingPaidVideoAdapter({enabled:true,apiKey:'fixture-not-real',accountBinding:ACCOUNT,policyRevision:REVISION,now:()=>START,
    assertAuthorized:p=>{authorizations.push(p);return true;},assertPollAuthorized:r=>{pollAuthorizations.push(r);return true;},
    fetchImpl:async(url,init)=>{calls.push({url,init});return response(init.method==='POST'?item():[item()]);},...options});
  return {adapter,calls,authorizations,pollAuthorizations};
}
const noDispatch=r=>{assert.equal(r.status,'not_dispatched');assert.equal(r.transportStarted,false);assert.equal(r.billingDisposition,'no_dispatch');assert.equal(r.billing.known,false);};
const held=r=>{assert.equal(r.billingDisposition,'hold');assert.equal(r.retryAllowed,false);};
async function receipt(f=fixture()){return (await f.adapter.invoke(request())).receipt;}

test('isolated factory is disabled by default and never reads credentials or activates any route',async()=>{
  let calls=0;for(const options of [{},{enabled:false,apiKey:'fixture'},{enabled:true},{enabled:true,apiKey:''}]){
    const a=createKlingPaidVideoAdapter({accountBinding:ACCOUNT,policyRevision:REVISION,assertAuthorized:()=>true,fetchImpl:async()=>{calls++;throw Error('No HTTP');},...options});
    noDispatch(await a.invoke(request()));
  }
  assert.equal(calls,0);assert.throws(()=>createKlingPaidVideoAdapter({baseUrl:'https://evil.invalid'}),/kling_config_invalid/);
});

test('single POST uses official current API, fixed safe options and no Studio, references, webhook or retry',async()=>{
  const f=fixture(),r=await f.adapter.invoke(request());
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,'https://api-singapore.klingai.com/text-to-video/kling-3.0');
  assert.deepEqual(JSON.parse(f.calls[0].init.body),{prompt:content().prompt,settings:{resolution:'720p',aspect_ratio:'16:9',duration:5,audio:'off',multi_shot:false},options:{external_task_id:'external-fixture-001',watermark_info:{enabled:false}}});
  assert.equal(f.calls[0].init.headers.authorization,'Bearer fixture-not-real');assert.equal(f.calls[0].init.method,'POST');assert.equal(f.calls[0].init.redirect,'error');
  assert.equal(r.status,'accepted');assert.equal(r.remoteTerminal,false);assert.equal(r.providerReceiptId,'task-fixture-001');assert.equal(r.receipt.externalTaskId,'external-fixture-001');assert.equal(r.receipt.accountBinding,ACCOUNT);held(r);
  assert.equal(r.output,null);assert.equal(r.billing.known,false);assert.doesNotMatch(JSON.stringify(r),/PRIVATE|fixture-not-real/);
});

test('permit binds body, scope, account, revision, quote and durable one-use reservation immediately before dispatch',async()=>{
  for(const permit of [{authorized:false},{scope:''},{requestHash:'0'.repeat(64)},{requestId:'other-request'},{accountBinding:'other-account'},{policyRevision:'other-revision'},{model:'kling-v1'},{externalTaskId:'other-external'},{quoteId:''},{reservationId:''},{maximumMicroBrl:'0'},{maximumMicroBrl:5},{expiresAt:START}]){
    const f=fixture();noDispatch(await f.adapter.invoke(request({permit})));assert.equal(f.calls.length,0);
  }
  const f=fixture(),changed=request();changed.prompt+=' changed';noDispatch(await f.adapter.invoke(changed));assert.equal(f.calls.length,0);
  const used=new Set(),g=fixture({assertAuthorized:p=>{if(used.has(p.reservationId))return false;used.add(p.reservationId);return true;}});
  assert.equal((await g.adapter.invoke(request())).status,'accepted');noDispatch(await g.adapter.invoke(request()));assert.equal(g.calls.length,1);
});

test('authorization must be synchronous exact true; rejected thenables are consumed and expiry/abort are rechecked',async()=>{
  for(const assertAuthorized of [undefined,()=>false,()=>({authorized:true}),async()=>true,async()=>{throw Error('PRIVATE rejected authorization');},()=>{throw Error('PRIVATE');}]){
    const f=fixture({assertAuthorized});noDispatch(await f.adapter.invoke(request()));assert.equal(f.calls.length,0);
  }
  let now=START;const f=fixture({now:()=>now,assertAuthorized:()=>{now+=60001;return true;}});noDispatch(await f.adapter.invoke(request()));assert.equal(f.calls.length,0);
  const signal=new AbortController(),g=fixture({assertAuthorized:()=>{signal.abort('PRIVATE');return true;}});noDispatch(await g.adapter.invoke(request({signal:signal.signal})));assert.equal(g.calls.length,0);
  await new Promise(resolve=>setImmediate(resolve));
});

test('request validation rejects image/video references, audio, 4k, tools, routing overrides and unsupported lengths',async()=>{
  for(const changes of [{image:'base64'},{imageUrl:'https://evil.invalid'},{contents:[]},{callbackUrl:'https://evil.invalid'},{audio:'native'},{multiShot:true},{watermark:true},{model:'kling-3.0-turbo'},{resolution:'4k'},{durationSeconds:2},{durationSeconds:16},{durationSeconds:3.5},{aspectRatio:'2:1'},{prompt:'x'.repeat(3073)},{prompt:'hello\u0000world'},{prompt:' '},{settings:{}},{options:{}},{url:'https://evil.invalid'}]){
    const f=fixture(),r=request();Object.assign(r,changes);noDispatch(await f.adapter.invoke(r));assert.equal(f.calls.length,0);
  }
  for(const settings of [{resolution:'1080p',aspectRatio:'9:16',durationSeconds:15},{resolution:'720p',aspectRatio:'1:1',durationSeconds:3}]){
    const f=fixture(),r=request(settings);r.permit.requestHash=hashKlingPaidVideoRequest({...content(),...settings});assert.equal((await f.adapter.invoke(r)).status,'accepted');
  }
});

test('canonical body and frozen permit cannot be changed during server authorization',async()=>{
  const r=request(),f=fixture({assertAuthorized:p=>{assert.equal(Object.isFrozen(p),true);r.prompt='mutated';r.durationSeconds=15;return true;}});
  assert.equal((await f.adapter.invoke(r)).status,'accepted');assert.equal(JSON.parse(f.calls[0].init.body).prompt,content().prompt);
  assert.notEqual(hashKlingPaidVideoRequest(content()),hashKlingPaidVideoRequest({...content(),durationSeconds:6}));
});

test('a submission response never delivers a video or terminal evidence; persisted receipt enables explicit polling',async()=>{
  const f=fixture({fetchImpl:async()=>response(item({status:'succeeded',outputs:[output()],billing:[cash()]}))}),r=await f.adapter.invoke(request());
  assert.equal(r.status,'accepted');assert.equal(r.remoteTerminal,false);assert.equal(r.output,null);held(r);assert.equal(r.receipt.taskId,'task-fixture-001');
  const g=fixture(),polled=await g.adapter.poll({receipt:r.receipt});assert.equal(polled.status,'pending');held(polled);
  assert.equal(g.calls[0].url,'https://api-singapore.klingai.com/tasks?task_ids=task-fixture-001');assert.equal(g.calls[0].init.method,'GET');assert.equal(g.calls[0].init.body,undefined);
  assert.equal(g.calls[0].init.headers['content-type'],'application/json');
});

test('polling requires current server ownership assertion and exact account/revision/receipt binding before GET',async()=>{
  const saved=await receipt();
  for(const assertPollAuthorized of [undefined,()=>false,async()=>true,async()=>{throw Error('PRIVATE');},()=>{throw Error('PRIVATE');}]){
    const f=fixture({assertPollAuthorized}),r=await f.adapter.poll({receipt:saved});held(r);assert.equal(r.transportStarted,false);assert.equal(f.calls.length,0);
  }
  for(const changes of [{accountBinding:'other-account'},{policyRevision:'other-policy'},{provider:'kling_studio'},{taskId:'a,b'},{externalTaskId:'../../secret'},{requestHash:''},{scope:'all'},{url:'https://evil.invalid'},{durationSeconds:1},{durationSeconds:16},{durationSeconds:undefined}]){
    const f=fixture(),r=await f.adapter.poll({receipt:{...saved,...changes}});held(r);assert.equal(r.transportStarted,false);assert.equal(f.calls.length,0);
  }
  const f=fixture({assertPollAuthorized:r=>r.scope==='store:fixture'});held(await f.adapter.poll({receipt:{...saved,scope:'store:foreign'}}));assert.equal(f.calls.length,0);
});

test('GET requires exactly one matching task and never leaks another account task or its output/billing',async()=>{
  const saved=await receipt();
  for(const data of [item(),[],[item(),item({id:'another-task'})],[item({id:'foreign-task',outputs:[output()],billing:[cash()]})],[item({external_id:'foreign-external',outputs:[output()],billing:[cash()]})],[item({status:'new-status'})]]){
    const f=fixture({fetchImpl:async()=>response(data)}),r=await f.adapter.poll({receipt:saved});held(r);assert.equal(r.ok,false);assert.equal(r.output,null);assert.equal(r.billing.known,false);
  }
});

test('completed task preserves literal cash/test-balance/unit receipts without conversion, invented price or download',async()=>{
  const saved=await receipt();
  for(const entries of [[cash()],[{...cash(),cash_type:'test_balance',currency:'CNY',amount:'0.000'}],[unit()],[cash(),unit()]]){
    const f=fixture({fetchImpl:async(url,init)=>{f.calls.push({url,init});return response([item({status:'succeeded',outputs:[output()],billing:entries})]);}}),r=await f.adapter.poll({receipt:saved});
    assert.equal(r.status,'completed');assert.equal(r.remoteTerminal,true);assert.equal(r.billing.known,true);assert.deepEqual(r.billing.entries,entries);assert.equal(r.billingDisposition,'reconcile');
    assert.equal(r.output.url,output().url);assert.equal(r.output.duration,'5.000');assert.equal(f.calls.length,1);assert.equal(f.calls[0].init.method,'GET');
    assert.equal(Object.hasOwn(r,'priceBrl'),false);assert.equal(Object.isFrozen(r.billing.entries[0]),true);
  }
});

test('missing, empty, malformed or imprecise billing is unknown rather than free; terminal failure retains known cost',async()=>{
  const saved=await receipt();
  for(const billing of [undefined,null,[],[{...cash(),amount:0.42}],[{...cash(),amount:'NaN'}],[{...cash(),amount:'-1'}],[{...cash(),currency:'BRL'}],[{...cash(),cash_type:'other'}],[{...unit(),package_type:'other'}],[{...unit(),currency:'USD'}]]){
    const r=await fixture({fetchImpl:async()=>response([item({status:'succeeded',outputs:[output()],billing})])}).adapter.poll({receipt:saved});
    assert.equal(r.remoteTerminal,true);held(r);assert.equal(r.billing.known,false);
  }
  const r=await fixture({fetchImpl:async()=>response([item({status:'failed',message:'PRIVATE',billing:[cash()]})])}).adapter.poll({receipt:saved});
  assert.equal(r.status,'failed');assert.equal(r.ok,false);assert.equal(r.remoteTerminal,true);assert.equal(r.billingDisposition,'reconcile');assert.deepEqual(r.billing.entries,[cash()]);assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);
});

test('unsafe or malformed outputs are not delivered but terminal receipt and valid billing are retained',async()=>{
  const saved=await receipt();
  for(const outputs of [undefined,[],[output(),output()],[{...output(),type:'image'}],[{...output(),url:'http://media.invalid/file'}],[{...output(),url:'https://user:password@media.invalid/file'}],[{...output(),url:'https://media.invalid:8080/file'}],[{...output(),url:'https://media.invalid/file\n'}],[{...output(),duration:5}]]){
    const r=await fixture({fetchImpl:async()=>response([item({status:'succeeded',outputs,billing:[cash()]})])}).adapter.poll({receipt:saved});
    assert.equal(r.ok,false);assert.equal(r.status,'invalid_response');assert.equal(r.output,null);assert.equal(r.remoteTerminal,true);assert.equal(r.billing.known,true);
  }
});

test('reported duration must exactly match authorized duration and polling authorization covers the immutable receipt',async()=>{
  const saved=await receipt();assert.equal(saved.durationSeconds,5);
  for(const duration of ['1','6','5.001','999999999999999999.001']){
    const r=await fixture({fetchImpl:async()=>response([item({status:'succeeded',outputs:[{...output(),duration}],billing:[cash()]})])}).adapter.poll({receipt:saved});
    assert.equal(r.status,'invalid_response');assert.equal(r.output,null);assert.equal(r.remoteTerminal,true);assert.equal(r.billing.known,true);
  }
  const f=fixture({assertPollAuthorized:r=>JSON.stringify(r)===JSON.stringify(saved)}),r=await f.adapter.poll({receipt:{...saved,durationSeconds:6}});held(r);assert.equal(f.calls.length,0);
});

test('explicit server key accepts bounded long values but rejects whitespace/control and has no arbitrary endpoint',async()=>{
  const f=fixture({apiKey:'x'.repeat(4096)});assert.equal((await f.adapter.invoke(request())).status,'accepted');assert.equal(f.calls[0].init.headers.authorization.length,4103);
  for(const apiKey of ['x'.repeat(4097),'abc\r\nHeader:secret','secret value'])assert.throws(()=>fixture({apiKey}),/kling_config_invalid/);
});

test('HTTP errors, vendor errors, redirect and malformed JSON hold after one POST, without sensitive messages',async()=>{
  for(const fetchImpl of [async()=>new Response(JSON.stringify({code:1303,message:'PRIVATE quota'}),{status:429,headers:{'content-type':'application/json'}}),async()=>new Response('{PRIVATE invalid'),async()=>{throw Error('PRIVATE network');},async()=>new Response(JSON.stringify(envelope(item())),{status:302,headers:{'content-type':'application/json'}})]){
    let count=0;const f=fixture({fetchImpl:async(...args)=>{count++;return fetchImpl(...args);}}),r=await f.adapter.invoke(request());held(r);assert.equal(r.transportStarted,true);assert.equal(r.ok,false);assert.equal(count,1);assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);assert.equal(r.receipt.externalTaskId,'external-fixture-001');
  }
});

test('unknown POST timeout can only be reconciled by external task ID, never replayed; late success does not mutate receipt',async()=>{
  let release,count=0;const f=fixture({timeoutMs:15,fetchImpl:async()=>{count++;return new Promise(resolve=>{release=resolve;});}}),r=await f.adapter.invoke(request());
  held(r);assert.equal(r.code,'kling_timeout_unknown');assert.equal(r.receipt.taskId,null);assert.equal(r.remoteTerminal,null);
  release(response(item()));await new Promise(resolve=>setImmediate(resolve));assert.equal(count,1);assert.equal(r.receipt.taskId,null);
  const g=fixture(),p=await g.adapter.poll({receipt:r.receipt});assert.equal(g.calls[0].url,'https://api-singapore.klingai.com/tasks?external_task_ids=external-fixture-001');assert.equal(p.receipt.taskId,'task-fixture-001');held(p);
});

test('abort stops waiting only: no remote cancellation or cost release and no cancellation API exists',async()=>{
  const controller=new AbortController(),f=fixture({fetchImpl:async()=>{queueMicrotask(()=>controller.abort('PRIVATE'));return new Promise(()=>{});}}),r=await f.adapter.invoke(request({signal:controller.signal}));
  held(r);assert.equal(r.code,'kling_cancelled_unknown');assert.equal(r.remoteTerminal,null);assert.equal(f.adapter.cancel,undefined);assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);
  const early=new AbortController();early.abort();const g=fixture();noDispatch(await g.adapter.invoke(request({signal:early.signal})));assert.equal(g.calls.length,0);
});

test('bounded stream parsing rejects overflows, invalid UTF8 and stalled bodies without exposing contents',async()=>{
  for(const fetchImpl of [async()=>new Response('PRIVATE',{headers:{'content-type':'application/json','content-length':'9999999'}}),async()=>new Response('x'.repeat(2048),{headers:{'content-type':'application/json'}}),async()=>new Response(new Uint8Array([0xff]),{headers:{'content-type':'application/json'}})]){
    const r=await fixture({fetchImpl,maxResponseBytes:1024}).adapter.invoke(request());held(r);assert.equal(r.ok,false);assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);
  }
  let cancelled=0;const r=await fixture({timeoutMs:15,fetchImpl:async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled++;}}),{headers:{'content-type':'application/json'}})}).adapter.invoke(request());
  held(r);assert.equal(r.code,'kling_timeout_unknown');assert.equal(cancelled,1);
});
