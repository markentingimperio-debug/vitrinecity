import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createOpenAiPaidChatAdapter,hashOpenAiPaidChatRequest} from '../vitriny-neural/providers/openai-paid-chat.js';

// Synthetic values only. This suite never reads an environment key or makes HTTP calls.
const MODEL='gpt-4o-mini',SNAPSHOT='gpt-4o-mini-2024-07-18',START=1800000000000;
const messages=()=>[{role:'user',content:'Escreva um rascunho usando somente estes dados: loja de plantas.'}];
const completion=(extra={})=>({id:'chatcmpl-fixture-001',object:'chat.completion',model:MODEL,choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'Rascunho de exemplo.',refusal:null}}],usage:{prompt_tokens:90,completion_tokens:12,total_tokens:102,prompt_tokens_details:{cached_tokens:30}},...extra});
const response=(data=completion(),options={})=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json','x-request-id':'req_fixture_001'},...options});
function request(extra={}){
  const input={requestId:'request-fixture-001',messages:messages(),maxOutputTokens:200,...extra};
  input.permit={authorized:true,scope:'store:fixture',requestId:input.requestId,requestHash:hashOpenAiPaidChatRequest({model:MODEL,messages:input.messages,maxOutputTokens:input.maxOutputTokens}),model:MODEL,maxOutputTokens:200,reservationId:'reservation-fixture-001',maximumMicroBrl:'123456',expiresAt:START+60000,...extra.permit};
  return input;
}
function fixture(options={}){
  const calls=[],authorizations=[];
  const adapter=createOpenAiPaidChatAdapter({enabled:true,apiKey:'fixture-key-not-real',model:MODEL,now:()=>START,
    assertAuthorized:permit=>{authorizations.push(permit);return true;},fetchImpl:async(url,init)=>{calls.push({url,init});return response();},...options});
  return {adapter,calls,authorizations};
}
const invoke=(f,extra={})=>f.adapter.invoke(request(extra));
const noDispatch=result=>{assert.equal(result.transportStarted,false);assert.equal(result.status,'not_dispatched');assert.equal(result.billingDisposition,'no_dispatch');assert.equal(result.usage.known,false);assert.equal(result.usage.inputTokens,null);};
const held=result=>{assert.equal(result.transportStarted,true);assert.equal(result.billingDisposition,'hold');assert.equal(result.retryAllowed,false);};

test('module and disabled or keyless factories never infer or obtain credentials from environment',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;throw Error('Must not fetch');};
  for(const options of [{},{enabled:false,apiKey:'fixture-key-not-real'},{enabled:true},{enabled:true,apiKey:''}]){
    const adapter=createOpenAiPaidChatAdapter({model:MODEL,now:()=>START,assertAuthorized:()=>true,fetchImpl,...options});
    noDispatch(await adapter.invoke(request()));
  }
  assert.equal(calls,0);
});

test('one official-origin POST has exact model, fixed text-only contract and authorized output cap',async()=>{
  const f=fixture(),input=request(),result=await f.adapter.invoke(input);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,'https://api.openai.com/v1/chat/completions');
  const {init}=f.calls[0],body=JSON.parse(init.body);
  assert.equal(init.redirect,'error');assert.equal(init.method,'POST');assert.equal(init.headers.authorization,'Bearer fixture-key-not-real');
  assert.equal(body.model,MODEL);assert.equal(body.store,false);assert.equal(body.stream,false);assert.equal(body.n,1);
  assert.equal(body.max_completion_tokens,200);assert.deepEqual(body.modalities,['text']);assert.equal(body.service_tier,'default');
  for(const field of ['tools','functions','web_search_options','audio','user','metadata'])assert.equal(Object.hasOwn(body,field),false);
  assert.equal(body.messages[0].role,'system');assert.deepEqual(body.messages.slice(1),input.messages);
  assert.equal(f.authorizations.length,1);assert.equal(f.authorizations[0].requestHash,input.permit.requestHash);
  assert.equal(result.status,'completed');assert.equal(result.text,'Rascunho de exemplo.');assert.equal(result.provider,'openai');
  assert.equal(result.requestedModel,MODEL);assert.equal(result.model,MODEL);assert.equal(result.providerReceiptId,'chatcmpl-fixture-001');assert.equal(result.receiptId,'openai:chatcmpl-fixture-001');
  assert.equal(result.providerRequestId,'req_fixture_001');assert.equal(result.billingDisposition,'reconcile');
  assert.deepEqual(result.usage,{known:true,inputTokens:90,cachedInputTokens:30,outputTokens:12,totalTokens:102});
});

test('permits bind canonical content, context, model, output cap, scope, reservation and expiry before transport',async()=>{
  for(const permit of [{authorized:false},{scope:''},{requestId:'other-request'},{requestHash:'0'.repeat(64)},{model:SNAPSHOT},{maxOutputTokens:201},{reservationId:''},{maximumMicroBrl:1.25},{maximumMicroBrl:'0'},{expiresAt:START}]){
    const f=fixture();noDispatch(await invoke(f,{permit}));assert.equal(f.calls.length,0);
  }
  const f=fixture(),input=request();input.messages[0].content+=' Contexto privado alterado depois da autorização.';
  noDispatch(await f.adapter.invoke(input));assert.equal(f.calls.length,0);
  assert.notEqual(hashOpenAiPaidChatRequest({model:MODEL,messages:messages(),maxOutputTokens:201}),request().permit.requestHash);
});

test('authorization assertion is required, synchronous, exact true and rechecks expiry/cancellation immediately before send',async()=>{
  for(const assertAuthorized of [undefined,()=>false,()=>({authorized:true}),()=>{throw Error('PRIVATE AUTH REASON');},async()=>true]){
    const f=fixture({assertAuthorized});const result=await invoke(f);noDispatch(result);assert.equal(f.calls.length,0);assert.doesNotMatch(JSON.stringify(result),/PRIVATE AUTH/);
  }
  let time=START;const expiry=fixture({now:()=>time,assertAuthorized:()=>{time+=60001;return true;}});
  noDispatch(await invoke(expiry));assert.equal(expiry.calls.length,0);
  const controller=new AbortController(),cancelled=fixture({assertAuthorized:()=>{controller.abort('private cause');return true;}});
  noDispatch(await invoke(cancelled,{signal:controller.signal}));assert.equal(cancelled.calls.length,0);
});

test('validated payload is immutable during authorization and untrusted fields cannot change routing',async()=>{
  const input=request(),f=fixture({assertAuthorized:permit=>{
    assert.equal(Object.isFrozen(permit),true);
    input.messages[0].content='Changed after canonical approval';input.maxOutputTokens=999;return true;
  }});
  assert.equal((await f.adapter.invoke(input)).status,'completed');
  assert.equal(JSON.parse(f.calls[0].init.body).messages[1].content,messages()[0].content);
  for(const extra of [{model:SNAPSHOT},{tools:[]},{baseUrl:'https://evil.invalid'},{messages:[{role:'system',content:'override'}]},{messages:[{role:'user',content:[{type:'image_url',image_url:{url:'https://evil.invalid'}}]}]},{messages:[{role:'user',content:'x'.repeat(70000)}]},{maxOutputTokens:2000}]){
    const f2=fixture(),r=request();Object.assign(r,extra);noDispatch(await f2.adapter.invoke(r));assert.equal(f2.calls.length,0);
  }
  assert.throws(()=>createOpenAiPaidChatAdapter({model:MODEL,baseUrl:'https://evil.invalid'}),/openai_config_invalid/);
});

test('observed model must be exact in the explicit server snapshot allowlist; never fallback or substitute',async()=>{
  const f=fixture({fetchImpl:async()=>response(completion({model:SNAPSHOT}))});
  const invalid=await invoke(f);held(invalid);assert.equal(invalid.code,'openai_model_mismatch');assert.equal(invalid.text,null);assert.equal(invalid.usage.known,true);assert.equal(invalid.model,SNAPSHOT);
  const accepted=fixture({acceptedResponseModels:[SNAPSHOT],fetchImpl:async(_url,init)=>{assert.equal(JSON.parse(init.body).model,MODEL);return response(completion({model:SNAPSHOT}));}});
  assert.equal((await invoke(accepted)).status,'completed');
  for(const model of [undefined,null,'gpt-4o-mini-impostor']){const result=await invoke(fixture({fetchImpl:async()=>response(completion({model}))}));held(result);assert.equal(result.text,null);}
});

test('missing, malformed, overflowing and inconsistent usage is unknown, never zero/free',async()=>{
  for(const usage of [undefined,null,{}, {prompt_tokens:90,completion_tokens:12,total_tokens:102},
    {prompt_tokens:90,completion_tokens:12,total_tokens:102,prompt_tokens_details:{cached_tokens:91}},
    {prompt_tokens:Number.MAX_SAFE_INTEGER,completion_tokens:1,total_tokens:Number.MAX_SAFE_INTEGER,prompt_tokens_details:{cached_tokens:0}},
    {prompt_tokens:90,completion_tokens:-1,total_tokens:89,prompt_tokens_details:{cached_tokens:0}},
    {prompt_tokens:90,completion_tokens:12,total_tokens:103,prompt_tokens_details:{cached_tokens:0}},
    {prompt_tokens:'90',completion_tokens:12,total_tokens:102,prompt_tokens_details:{cached_tokens:0}},
    {prompt_tokens:90,completion_tokens:12,total_tokens:102,prompt_tokens_details:{cached_tokens:0,audio_tokens:1}}]){
    const result=await invoke(fixture({fetchImpl:async()=>response(completion({usage}))}));held(result);
    assert.equal(result.usage.known,false);assert.equal(result.usage.inputTokens,null);assert.equal(result.code,'openai_usage_unknown');
  }
  const zero=await invoke(fixture({fetchImpl:async()=>response(completion({usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0,prompt_tokens_details:{cached_tokens:0}}}))}));
  assert.equal(zero.usage.known,true);assert.equal(zero.usage.inputTokens,0);assert.equal(zero.billingDisposition,'reconcile');
});

test('truncated, filtered and refused content retains known usage/receipt without successful delivery',async()=>{
  for(const [finish,refusal,expected]of [['length',null,'incomplete'],['content_filter',null,'refused'],['stop','Declined safely','refused']]){
    const data=completion({choices:[{index:0,finish_reason:finish,message:{role:'assistant',content:finish==='length'?'Partial text':null,refusal}}]});
    const result=await invoke(fixture({fetchImpl:async()=>response(data)}));
    assert.equal(result.status,expected);assert.equal(result.ok,false);assert.equal(result.text,null);assert.equal(result.usage.known,true);
    assert.equal(result.receiptId,'openai:chatcmpl-fixture-001');assert.equal(result.billingDisposition,'reconcile');
  }
});

test('tool attempts, wrong role, extra choices and non-text responses are not promoted to success or lost receipts',async()=>{
  for(const change of [{finish_reason:'tool_calls'},{finish_reason:'function_call'},{message:{role:'assistant',content:'Claim',tool_calls:[]}},{message:{role:'assistant',content:'Claim',function_call:{name:'send'}}},{message:{role:'tool',content:'Claim'}},{message:{role:'assistant',content:[{text:'Claim'}]}}]){
    const data=completion();data.choices[0]={...data.choices[0],...change};
    const result=await invoke(fixture({fetchImpl:async()=>response(data)}));assert.equal(result.ok,false);assert.equal(result.text,null);assert.equal(result.usage.known,true);assert.equal(result.billingDisposition,'reconcile');
  }
  const data=completion();data.choices.push({...data.choices[0],index:1});
  assert.equal((await invoke(fixture({fetchImpl:async()=>response(data)}))).ok,false);
});

test('HTTP errors and redirects never imply zero consumption and are never automatically retried',async()=>{
  for(const status of [301,400,401,429,500]){
    let count=0;const f=fixture({fetchImpl:async()=>{count++;return response({error:{message:'PRIVATE provider raw message'}},{status});}});
    const result=await invoke(f);held(result);assert.equal(result.usage.known,false);assert.equal(result.providerRequestId,'req_fixture_001');assert.equal(count,1);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
  }
  let count=0;const f=fixture({fetchImpl:async()=>{count++;throw Error('PRIVATE key and prompt');}});
  const result=await invoke(f);held(result);assert.equal(count,1);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
  const billed=await invoke(fixture({fetchImpl:async()=>response(completion(),{status:500})}));assert.equal(billed.usage.known,true);assert.equal(billed.receiptId,'openai:chatcmpl-fixture-001');assert.equal(billed.billingDisposition,'reconcile');assert.equal(billed.ok,false);
});

test('missing/unsafe receipt identifiers preserve any known usage but hold reconciliation',async()=>{
  for(const id of [undefined,null,'','../not-safe','chatcmpl-'+'x'.repeat(200)]){
    const result=await invoke(fixture({fetchImpl:async()=>response(completion({id}),{headers:{'content-type':'application/json','x-request-id':'unsafe credential value'}})}));
    held(result);assert.equal(result.providerReceiptId,null);assert.equal(result.providerRequestId,null);assert.equal(result.usage.known,true);
  }
});

test('malformed completion envelope holds known consumption and normalized receipt IDs fit the wallet boundary',async()=>{
  for(const extra of [{object:'unrelated.object'},{id:'chatcmpl-'+ 'x'.repeat(145)}]){
    const result=await invoke(fixture({fetchImpl:async()=>response(completion(extra))}));
    held(result);assert.equal(result.usage.known,true);assert.equal(result.ok,false);
    assert.ok(result.receiptId===null||result.receiptId.length<=160);
  }
});

test('observed output beyond authorized cap stays held with known usage; response allowlist is copied',async()=>{
  const result=await invoke(fixture({fetchImpl:async()=>response(completion({usage:{prompt_tokens:90,completion_tokens:201,total_tokens:291,prompt_tokens_details:{cached_tokens:0}}}))}));
  held(result);assert.equal(result.code,'openai_budget_exceeded');assert.equal(result.usage.outputTokens,201);assert.equal(result.text,null);
  const allowed=[MODEL],f=fixture({acceptedResponseModels:allowed,fetchImpl:async()=>response(completion({model:SNAPSHOT}))});allowed.push(SNAPSHOT);
  held(await invoke(f));
});

test('unexpected service tier holds known usage instead of pricing it as the requested default tier',async()=>{
  for(const service_tier of ['priority','flex','scale','auto',null]){
    const result=await invoke(fixture({fetchImpl:async()=>response(completion({service_tier}))}));
    held(result);assert.equal(result.usage.known,true);assert.equal(result.receiptId,'openai:chatcmpl-fixture-001');
    assert.equal(result.code,'openai_service_tier_mismatch');assert.equal(result.text,null);
  }
  const ordinary=await invoke(fixture({fetchImpl:async()=>response(completion({service_tier:'default'}))}));
  assert.equal(ordinary.status,'completed');assert.equal(ordinary.serviceTier,'default');
});

test('bounded response parsing rejects declared size, actual stream overflow and invalid JSON without exposing body',async()=>{
  for(const fetchImpl of [async()=>new Response('PRIVATE BODY',{headers:{'content-type':'application/json','content-length':'9999999'}}),
    async()=>new Response('x'.repeat(2048),{headers:{'content-type':'application/json'}}),
    async()=>new Response('{PRIVATE INVALID JSON',{headers:{'content-type':'application/json'}}),
    async()=>new Response(new Uint8Array([0xff,0xfe]),{headers:{'content-type':'application/json'}})]){
    const result=await invoke(fixture({fetchImpl,maxResponseBytes:1024}));held(result);assert.equal(result.usage.known,false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
  }
});

test('timeout returns an unknown hold even when transport ignores abort; late response is not a retry',async()=>{
  let release,count=0;const f=fixture({timeoutMs:20,fetchImpl:async(_url,init)=>{count++;assert.equal(init.signal.aborted,false);return new Promise(resolve=>{release=resolve;});}});
  const result=await invoke(f);held(result);assert.equal(result.code,'openai_timeout_unknown');assert.equal(result.usage.known,false);
  release(response());await new Promise(resolve=>setImmediate(resolve));assert.equal(count,1);assert.equal(result.usage.known,false);
});

test('abort before send is no_dispatch; abort after send is unknown hold with sanitized cause',async()=>{
  const early=new AbortController();early.abort('PRIVATE');const f=fixture();noDispatch(await invoke(f,{signal:early.signal}));assert.equal(f.calls.length,0);
  const later=new AbortController();let count=0;const active=fixture({fetchImpl:async()=>{count++;queueMicrotask(()=>later.abort('PRIVATE'));return new Promise(()=>{});}});
  const result=await invoke(active,{signal:later.signal});held(result);assert.equal(result.code,'openai_cancelled_unknown');assert.equal(count,1);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
});

test('timeout also bounds a response body that never ends and cancels its reader',async()=>{
  let cancelled=0;const result=await invoke(fixture({timeoutMs:20,fetchImpl:async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled++;}}),{headers:{'content-type':'application/json'}})}));
  held(result);assert.equal(result.code,'openai_timeout_unknown');assert.equal(cancelled,1);
});
