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
