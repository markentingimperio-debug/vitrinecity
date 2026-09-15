import test from 'node:test';
import assert from 'node:assert/strict';
import {createAiTextClient,resolveAiTextConfig} from '../ai-text-provider.js';

const keys={OPENROUTER_API_KEY:'router-private-key',OPENAI_API_KEY:'openai-private-key',OPENROUTER_MODEL:'nvidia/nemotron-3.5-lightning:free',OPENAI_MODEL:'gpt-4o-mini'};
const ok=data=>({ok:true,status:200,json:async()=>data});

test('unset and auto provider preserve OpenRouter priority and legacy model selection',()=>{
  for(const override of [undefined,'','auto']) {
    const config=resolveAiTextConfig({...keys,AI_TEXT_PROVIDER:override});
    assert.equal(config.provider,'openrouter');assert.equal(config.model,keys.OPENROUTER_MODEL);assert.equal(config.configured,true);assert.equal(config.explicit,false);
  }
  const config=resolveAiTextConfig({OPENAI_API_KEY:keys.OPENAI_API_KEY});
  assert.equal(config.provider,'openai');assert.equal(config.model,'gpt-4o-mini');
});

test('explicit OpenAI uses its own key/model even with OpenRouter configured',async()=>{
  const calls=[],response={status:'completed',output:[{type:'function_call',call_id:'call_1',name:'get_operations_overview',arguments:'{}'}]};
  const client=createAiTextClient({env:{...keys,AI_TEXT_PROVIDER:'openai'},fetchImpl:async(url,options)=>{calls.push({url,...options});return ok(response);}});
  const input=[{type:'function_call_output',call_id:'earlier_call',output:'{"count":2}'}],tools=[{type:'function',name:'get_operations_overview',parameters:{type:'object',properties:{}}}];
  assert.equal(await client.request({model:'gpt-4o-mini',instructions:'Synthetic test',input,tools,max_output_tokens:32,store:true}),response);
  assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.openai.com/v1/responses');
  assert.equal(calls[0].headers.Authorization,'Bearer '+keys.OPENAI_API_KEY);
  assert.equal(calls[0].headers['HTTP-Referer'],undefined);assert.equal(calls[0].redirect,'error');
  assert.deepEqual(JSON.parse(calls[0].body),{model:'gpt-4o-mini',instructions:'Synthetic test',input,tools,max_output_tokens:32,store:false});
  assert(!JSON.stringify(client.config).includes('private-key'));
});

test('explicit OpenAI honors OPENAI_DIRECT_MODEL rather than an OpenRouter model',()=>{
  assert.equal(resolveAiTextConfig({...keys,AI_TEXT_PROVIDER:'openai',OPENAI_DIRECT_MODEL:'gpt-4.1-mini'}).model,'gpt-4.1-mini');
});

for(const [env,code] of [
  [{...keys,AI_TEXT_PROVIDER:'unknown'},'ai_text_provider_invalid'],
  [{OPENROUTER_API_KEY:keys.OPENROUTER_API_KEY,AI_TEXT_PROVIDER:'openai'},'ai_text_key_missing'],
  [{OPENAI_API_KEY:keys.OPENAI_API_KEY,AI_TEXT_PROVIDER:'openrouter'},'ai_text_key_missing'],
  [{...keys,AI_TEXT_PROVIDER:'openai',OPENAI_DIRECT_MODEL:'openai/gpt-4o-mini'},'ai_text_model_invalid']
]) test('configuration fails closed without fallback or network: '+code+JSON.stringify(Object.keys(env)),async()=>{
  let calls=0;const client=createAiTextClient({env,fetchImpl:async()=>{calls++;throw Error('must not request');}});
  assert.equal(client.config.configured,false);assert.equal(client.config.error,code);
  await assert.rejects(client.request({input:'synthetic'}),error=>error.code===code&&error.status===503);
  assert.equal(calls,0);
});

test('per-request model override cannot pass an OpenRouter model to OpenAI',async()=>{
  let calls=0;const client=createAiTextClient({env:{...keys,AI_TEXT_PROVIDER:'openai'},fetchImpl:async()=>{calls++;return ok({});}});
  await assert.rejects(client.request({model:keys.OPENROUTER_MODEL,input:'synthetic'}),error=>error.code==='ai_text_model_override_rejected'&&error.status===400);
  assert.equal(calls,0);
});

test('OpenRouter retries its configured fallback without crossing providers',async()=>{
  const calls=[];const client=createAiTextClient({env:{...keys,AI_TEXT_PROVIDER:'openrouter'},fetchImpl:async(url,options)=>{
    calls.push({url,...options});return calls.length===1?{ok:false,status:429,json:async()=>({error:{code:'rate_limit'}})}:ok({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'OK'}]}]});
  }});
  await client.request({input:'synthetic'});
  assert.equal(calls.length,2);assert(calls.every(call=>call.url==='https://openrouter.ai/api/v1/responses'&&call.headers.Authorization==='Bearer '+keys.OPENROUTER_API_KEY));
  assert.deepEqual(calls.map(call=>JSON.parse(call.body).model),[keys.OPENROUTER_MODEL,'openrouter/free']);
});

test('only completed usable Responses envelopes count as successful analysis',async()=>{
  for(const data of [{}, {status:'completed',output:[]}, {status:'incomplete',output:[{type:'message',content:[{type:'output_text',text:'partial private text'}]}]}, {status:'completed',output:[{type:'function_call',name:'tool'}]}]) {
    let calls=0;const diagnostics=[];
    const client=createAiTextClient({env:{...keys,AI_TEXT_PROVIDER:'openai'},onFailure:detail=>diagnostics.push(detail),fetchImpl:async()=>{calls++;return ok(data);}});
    await assert.rejects(client.request({input:'synthetic'}),error=>error.code==='AI_TEXT_REQUEST_FAILED'&&error.status===502);
    assert.equal(calls,1);assert.equal(diagnostics[0].code,'response_not_completed');assert(!JSON.stringify(diagnostics).includes('private'));
  }
});

test('malformed HTTP 200 JSON produces gateway failure, never success status',async()=>{
  const client=createAiTextClient({env:{...keys,AI_TEXT_PROVIDER:'openai'},fetchImpl:async()=>({ok:true,status:200,json:async()=>{throw SyntaxError('private bad JSON');}})});
  await assert.rejects(client.request({input:'synthetic'}),error=>error.code==='AI_TEXT_REQUEST_FAILED'&&error.status===502&&!error.message.includes('private'));
});

test('OpenAI error does not retry on OpenRouter, and diagnostics contain no provider payload',async()=>{
  let calls=0;const diagnostics=[];
  const client=createAiTextClient({env:{...keys,AI_TEXT_PROVIDER:'openai'},onFailure:detail=>diagnostics.push(detail),fetchImpl:async()=>{
    calls++;return {ok:false,status:429,json:async()=>({error:{code:'insufficient_quota',message:'private-prompt '+keys.OPENAI_API_KEY}})};
  }});
  await assert.rejects(client.request({input:'private-prompt'}),error=>error.code==='AI_TEXT_REQUEST_FAILED'&&error.status===429&&!error.message.includes('private'));
  assert.equal(calls,1);assert.equal(diagnostics[0].code,'insufficient_quota');assert(!JSON.stringify(diagnostics).includes('private'));
});

const deepseekEnv={...keys,AI_TEXT_PROVIDER:'deepseek',DEEPSEEK_API_KEY:'deepseek-private-key',AI_TEXT_FALLBACK_PROVIDER:'openai',OPENAI_DIRECT_MODEL:'gpt-4o-mini'};
const completed=(model='deepseek-flash',value='OK')=>({status:'completed',model,output:[{type:'message',content:[{type:'output_text',text:value}]}],usage:{input_tokens:12,input_tokens_details:{cached_tokens:4},output_tokens:9,output_tokens_details:{reasoning_tokens:3}}});
const rejected=(status=429,extra={})=>({ok:false,status,json:async()=>({error:{code:'rate_limit',message:'PRIVATE_PROVIDER_MESSAGE'},...extra})});

test('DeepSeek requires explicit opt-in and selects only its own key/model without changing legacy auto',async()=>{
  const calls=[],client=createAiTextClient({env:deepseekEnv,fetchImpl:async(url,options)=>{calls.push({url,options});return ok(completed());}});
  assert.equal(client.config.provider,'deepseek');assert.equal(client.config.model,'deepseek-flash');assert.equal(client.config.fallbackConfigured,true);
  assert.equal(resolveAiTextConfig({...deepseekEnv,AI_TEXT_PROVIDER:'auto'}).provider,'openrouter');
  const response=await client.request({instructions:'SYSTEM',input:'USER',max_output_tokens:1400,reasoning:{effort:'low'},store:true});
  assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.deepseek.com/responses');
  assert.equal(calls[0].options.headers.Authorization,'Bearer deepseek-private-key');assert.equal(calls[0].options.headers['HTTP-Referer'],undefined);
  assert.deepEqual(JSON.parse(calls[0].options.body),{instructions:'SYSTEM',input:'USER',max_output_tokens:1400,reasoning:{effort:'low'},store:false,model:'deepseek-flash'});
  assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.credentials,'omit');
  assert.deepEqual(response.aiText,{provider:'deepseek',model:'deepseek-flash',requestedModel:'deepseek-flash',fallbackUsed:false});
  assert.deepEqual(response.usage,completed().usage);assert.doesNotMatch(JSON.stringify(client.config),/private-key/);
});

test('only proven 401/402/429 rejection enables one OpenAI fallback with separate key/model and actual metadata',async()=>{
  for(const status of [401,402,429]){
    const calls=[],observed=[],client=createAiTextClient({env:deepseekEnv,fetchImpl:async(url,options)=>{calls.push({url,options});return calls.length===1?rejected(status):ok(completed('gpt-4o-mini-2024-07-18'));}});
    const response=await client.request({model:'deepseek-flash',input:'USER'}, {observe:async(details,operation)=>{observed.push(details.provider);return operation();}});
    assert.equal(calls.length,2);assert.equal(calls[1].url,'https://api.openai.com/v1/responses');
    assert.equal(calls[1].options.headers.Authorization,'Bearer openai-private-key');assert.equal(JSON.parse(calls[1].options.body).model,'gpt-4o-mini');
    assert.deepEqual(observed,['deepseek','openai']);
    assert.deepEqual(response.aiText,{provider:'openai',model:'gpt-4o-mini-2024-07-18',requestedModel:'gpt-4o-mini',fallbackUsed:true});
  }
});

test('unknown consumption, malformed responses, partial output and refusal never fall back',async()=>{
  const modes=[
    async()=>{throw Error('PRIVATE_TIMEOUT');}, async()=>({ok:true,status:200,json:async()=>{throw Error('PRIVATE_PARSE');}}),
    async()=>rejected(500),async()=>rejected(503),async()=>rejected(408),async()=>rejected(403),
    async()=>rejected(429,{usage:{input_tokens:0,output_tokens:0}}),async()=>rejected(429,{output:[]}),
    async()=>({ok:false,status:429,json:async()=>({error:{code:'rate_limit',usage:{output_tokens:1}}})}),
    async()=>ok({}),async()=>ok({...completed(),status:'incomplete'}),
    async()=>ok({...completed(),output:[{type:'message',content:[{type:'refusal',refusal:'No'}]}]})
  ];
  for(const mode of modes){
    let calls=0;const diagnostic=[],client=createAiTextClient({env:deepseekEnv,onFailure:d=>diagnostic.push(d),fetchImpl:async()=>{calls++;return mode();}});
    await assert.rejects(client.request({input:'private user prompt'}),error=>error.code==='AI_TEXT_REQUEST_FAILED'&&!error.message.includes('PRIVATE'));
    assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(diagnostic),/PRIVATE|private user/);
  }
});

test('stateless/unsupported contracts route to OpenAI before DeepSeek and preserve the entire request',async()=>{
  const bodies=[{previous_response_id:'resp_previous'},{conversation:'conv_existing'},{tools:[{type:'web_search'}]},
    {tools:[{type:'file_search',vector_store_ids:['vs_1']}]},{tools:[{type:'code_interpreter'}]},{tools:[{type:'mcp'}]},
    {tools:[{type:'custom',name:'apply_patch'}]},{parallel_tool_calls:false},{max_tool_calls:1},
    {reasoning:{effort:'medium',summary:'auto'}},{reasoning:{effort:'medium'}},{text:{verbosity:'low'}},{metadata:{task:'existing'}},
    {input:[{role:'developer',content:'Authoritative instruction'}]},
    {input:[{type:'reasoning',encrypted_content:'OPAQUE'}]},
    {input:[{role:'user',content:[{type:'input_file',file_id:'file_1'}]}]}
  ];
  for(const extra of bodies){
    const calls=[],client=createAiTextClient({env:deepseekEnv,fetchImpl:async(url,options)=>{calls.push({url,options});return ok(completed('gpt-4o-mini'));}});
    const body={input:'USER',...extra};const result=await client.request(body);
    assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.openai.com/v1/responses');
    assert.deepEqual(JSON.parse(calls[0].options.body),{...body,model:'gpt-4o-mini',store:false});assert.equal(result.aiText.fallbackUsed,true);
    let forbidden=0;const closed=createAiTextClient({env:{...deepseekEnv,AI_TEXT_FALLBACK_PROVIDER:'none'},fetchImpl:async()=>{forbidden++;throw Error('MUST_NOT_REQUEST');}});
    await assert.rejects(closed.request(body),error=>error.code==='ai_text_capability_unsupported');assert.equal(forbidden,0);
  }
});

test('missing or invalid configuration does not trigger an implicit paid fallback',async()=>{
  for(const extra of [{DEEPSEEK_API_KEY:''},{DEEPSEEK_MODEL:'openai/wrong-model'},{AI_TEXT_FALLBACK_PROVIDER:'unknown'},{DEEPSEEK_REASONING_EFFORT:'medium'}]){
    let calls=0;const client=createAiTextClient({env:{...deepseekEnv,...extra},fetchImpl:async()=>{calls++;throw Error('MUST_NOT_REQUEST');}});
    await assert.rejects(client.request({input:'USER'}));assert.equal(calls,0);assert.equal(client.config.configured,false);
  }
  for(const extra of [{AI_TEXT_FALLBACK_PROVIDER:''},{OPENAI_API_KEY:''},{OPENAI_DIRECT_MODEL:'openai/wrong-model'}]){
    let calls=0;const client=createAiTextClient({env:{...deepseekEnv,...extra},fetchImpl:async()=>{calls++;return rejected();}});
    await assert.rejects(client.request({input:'USER'}));assert.equal(calls,1);
  }
});

test('completed function calls are never retried and prior tool outputs survive fallback without replay',async()=>{
  const tool={type:'function',name:'run_ecosystem_cycle',parameters:{type:'object',properties:{},additionalProperties:false},strict:true};
  const call={type:'function_call',call_id:'call_once',name:tool.name,arguments:'{}'},requests=[];
  const client=createAiTextClient({env:deepseekEnv,fetchImpl:async(url,options)=>{
    requests.push({url,body:JSON.parse(options.body)});
    return requests.length===1?ok({status:'completed',model:'deepseek-flash',output:[call]}):requests.length===2?rejected(429):ok(completed('gpt-4o-mini'));
  }});
  const first=await client.request({input:'Run approved cycle',tools:[tool]});
  assert.equal(requests.length,1);assert.deepEqual(first.output,[call]);
  const input=[{role:'user',content:'Run approved cycle'},...first.output,{type:'function_call_output',call_id:call.call_id,output:'{"status":"already_requested"}'}];
  const final=await client.request({input,tools:[tool]});
  assert.equal(final.aiText.provider,'openai');assert.deepEqual(requests[2].body.input,input);assert.equal(requests.length,3);
  const repeated=createAiTextClient({env:deepseekEnv,fetchImpl:async()=>ok({status:'completed',output:[call]})});
  await assert.rejects(repeated.request({input,tools:[tool]}),error=>error.code==='AI_TEXT_REQUEST_FAILED');
});

test('duplicate, unrequested, malformed and partly refused tool output fails without executing or fallback',async()=>{
  const tool={type:'function',name:'safe_read',parameters:{type:'object',properties:{}}};
  const call={type:'function_call',call_id:'call_1',name:'safe_read',arguments:'{}'};
  for(const output of [[call,call],[{...call,name:'unapproved_tool'}],[{...call,arguments:'[]'}],[{...call,status:'in_progress'}],
    [call,{type:'message',content:[{type:'refusal',refusal:'No'}]}]]){
    let calls=0;const client=createAiTextClient({env:deepseekEnv,fetchImpl:async()=>{calls++;return ok({status:'completed',output});}});
    await assert.rejects(client.request({input:'USER',tools:[tool]}));assert.equal(calls,1);
  }
});

test('OpenAI fallback failure stops at two attempts and arbitrary provider error codes are not logged',async()=>{
  const calls=[],diagnostic=[],client=createAiTextClient({env:deepseekEnv,onFailure:d=>diagnostic.push(d),fetchImpl:async(url)=>{
    calls.push(url);return {ok:false,status:429,json:async()=>({error:{code:'PRIVATE_SECRET_AS_CODE',message:'private key'}})};
  }});
  await assert.rejects(client.request({input:'USER'}));assert.equal(calls.length,2);assert.doesNotMatch(JSON.stringify(diagnostic),/PRIVATE|private key/);
});

test('DeepSeek defaults to no reasoning for short replies and does not copy that default into OpenAI fallback',async()=>{
  const calls=[],client=createAiTextClient({env:deepseekEnv,fetchImpl:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return calls.length===1?rejected():ok(completed('gpt-4o-mini'));}});
  const body={input:'Short Lia reply',max_output_tokens:350};
  await client.request(body);
  assert.equal(client.config.reasoningEffort,'none');assert.deepEqual(calls[0].body.reasoning,{effort:'none'});
  assert.equal(calls[0].body.max_output_tokens,350);assert.equal(calls[1].body.reasoning,undefined);assert.equal(body.reasoning,undefined);
  for(const effort of ['none','low','high','max']){
    const sent=[],configured=createAiTextClient({env:{...deepseekEnv,DEEPSEEK_REASONING_EFFORT:effort},fetchImpl:async(_url,options)=>{sent.push(JSON.parse(options.body));return ok(completed());}});
    await configured.request({input:'USER'});await configured.request({input:'USER',reasoning:{effort:'none'}});
    assert.deepEqual(sent[0].reasoning,{effort});assert.deepEqual(sent[1].reasoning,{effort:'none'});
  }
});
