import assert from 'node:assert/strict';
import test from 'node:test';
import {getEventListeners} from 'node:events';
import {createSkillRegistry} from '../vitriny-neural/skills/registry.js';
import {createOpenAICompatibleProvider} from '../vitriny-neural/providers/openai-compatible.js';

const capability='code.plan',input={task:'Gerar um rascunho.'};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function fixture({invoke=async()=>({text:'ok',usage:{prompt_tokens:12,completion_tokens:8}}),available=async()=>true,backup=false,now}={}){
  const calls=[],probes=[],registry=createSkillRegistry({now});
  registry.registerProvider({id:'local-primary',modelName:'fixture-model-v1',capabilities:[capability],priority:1,local:true,
    available:async()=>{probes.push('local-primary');return available();},invoke:async args=>{calls.push('local-primary');return invoke(args);}});
  if(backup)registry.registerProvider({id:'local-backup',modelName:'fixture-model-v2',capabilities:[capability],priority:2,local:true,
    available:async()=>{probes.push('local-backup');return true;},invoke:async()=>{calls.push('local-backup');return {text:'backup',usage:{input_tokens:4,output_tokens:3}};}});
  return{registry,calls,probes};
}

test('synchronous attempt start precedes inference and completion carries a stable identity',async()=>{
  const events=[],order=[];let clock=100;
  const {registry}=fixture({now:()=>clock,invoke:async()=>{order.push('invoke');clock=145;return {text:'ok',usage:{prompt_tokens:12,completion_tokens:8}};}});
  const result=await registry.invoke(capability,input,{onAttempt:event=>{events.push(event);order.push(event.type);}});
  assert.deepEqual(order,['started','invoke','completed']);
  assert.match(events[0].attemptId,uuid);
  assert.deepEqual(events[0],{type:'started',attemptId:events[0].attemptId,provider:'local-primary',modelName:'fixture-model-v1',inputTokens:null,outputTokens:null,known:false,durationMs:null});
  assert.deepEqual(events[1],{type:'completed',attemptId:events[0].attemptId,provider:'local-primary',modelName:'fixture-model-v1',inputTokens:12,outputTokens:8,known:true,durationMs:45});
  assert.deepEqual(result.usage,{inputTokens:12,outputTokens:8,totalTokens:20,known:true});
  assert.equal(Object.isFrozen(events[0]),true);
});

test('each failed and fallback attempt has its own identity; unknown failure is not free consumption',async()=>{
  const events=[],{registry,calls}=fixture({invoke:async()=>{throw new Error('provider unavailable');},backup:true});
  const result=await registry.invoke(capability,input,{onAttempt:event=>events.push(event)});
  assert.deepEqual(calls,['local-primary','local-backup']);
  assert.deepEqual(events.map(e=>e.type),['started','failed','started','completed']);
  assert.equal(events[0].attemptId,events[1].attemptId);
  assert.equal(events[2].attemptId,events[3].attemptId);
  assert.notEqual(events[0].attemptId,events[2].attemptId);
  assert.equal(events[1].known,false);assert.equal(events[1].inputTokens,null);assert.equal(events[1].outputTokens,null);
  assert.equal(events[3].known,true);assert.equal(events[3].inputTokens,4);assert.equal(events[3].outputTokens,3);
  assert.equal(result.provider,'local-backup');
});

test('all supported token aliases including nested output preserve strict known zero',async()=>{
  for(const usage of [
    {prompt_tokens:0,completion_tokens:0},
    {input_tokens:0,output_tokens:0},
    {promptTokens:0,completionTokens:0},
    {inputTokens:0,outputTokens:0}
  ]){
    for(const output of [{usage},{output:{usage}}]){
      const events=[],{registry}=fixture({invoke:async()=>output});
      const result=await registry.invoke(capability,input,{onAttempt:event=>events.push(event)});
      assert.deepEqual(result.usage,{inputTokens:0,outputTokens:0,totalTokens:0,known:true});
      assert.equal(events[1].known,true);assert.equal(events[1].inputTokens,0);assert.equal(events[1].outputTokens,0);
    }
  }
});

test('absent, null, strings, fractional, negative, nonfinite and unsafe counts remain unknown',async()=>{
  const invalid=[undefined,null,'0',true,-1,.5,Number.NaN,Infinity,Number.MAX_SAFE_INTEGER+1];
  const usages=[undefined,null,{},...invalid.flatMap(value=>[{prompt_tokens:value,completion_tokens:1},{prompt_tokens:1,completion_tokens:value}]),
    {prompt_tokens:null,input_tokens:10,completion_tokens:3},
    {prompt_tokens:Number.MAX_SAFE_INTEGER,completion_tokens:1}];
  for(const usage of usages){
    const events=[],{registry}=fixture({invoke:async()=>({text:'ok',usage})});
    const result=await registry.invoke(capability,input,{onAttempt:event=>events.push(event)});
    assert.equal(result.usage.known,false);
    assert.equal(events[1].known,false);assert.equal(events[1].inputTokens,null);assert.equal(events[1].outputTokens,null);
    assert.ok(Number.isSafeInteger(result.usage.inputTokens));assert.ok(Number.isSafeInteger(result.usage.outputTokens));
    assert.ok(Number.isSafeInteger(result.usage.totalTokens));
  }
});

test('reasoning details are not charged a second time over reported completion usage',async()=>{
  const {registry}=fixture({invoke:async()=>({usage:{prompt_tokens:10,completion_tokens:25,total_tokens:35,completion_tokens_details:{reasoning_tokens:20}}})});
  const result=await registry.invoke(capability,input);
  assert.deepEqual(result.usage,{inputTokens:10,outputTokens:25,totalTokens:35,known:true});
  assert.equal(registry.status().providers[0].stats.totalTokens,35);
});

test('OpenAI-compatible adapter preserves raw usage for strict normalization',async()=>{
  for(const usage of [null,{prompt_tokens:null,completion_tokens:'0'},{prompt_tokens:0,completion_tokens:0}]){
    const registry=createSkillRegistry(),events=[];
    registry.registerProvider(createOpenAICompatibleProvider({baseUrl:'http://127.0.0.1:18099',model:'fixture-model',fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:'ok'}}],usage})})}));
    const result=await registry.invoke(capability,input,{onAttempt:event=>events.push(event)});
    assert.deepEqual(result.output.usage,usage);
    assert.equal(events[1].known,usage?.prompt_tokens===0&&usage?.completion_tokens===0);
  }
});

test('unavailable, disallowed and pre-aborted requests do not emit inference events',async()=>{
  for(const options of [{},{allowedProviders:[]}]){
    const events=[],{registry,calls}=fixture({available:async()=>false});
    await assert.rejects(registry.invoke(capability,input,{...options,onAttempt:event=>events.push(event)}),/Nenhum provider/);
    assert.deepEqual(events,[]);assert.deepEqual(calls,[]);
  }
  const controller=new AbortController(),events=[],{registry,calls,probes}=fixture();controller.abort();
  await assert.rejects(registry.invoke(capability,input,{signal:controller.signal,onAttempt:event=>events.push(event)}),{name:'AbortError'});
  assert.deepEqual(events,[]);assert.deepEqual(calls,[]);assert.deepEqual(probes,[]);
});

test('start-hook error prevents inference and fallback without changing provider circuit',async()=>{
  const events=[],error=new Error('ledger unavailable'),controller=new AbortController(),{registry,calls}=fixture({backup:true});
  await assert.rejects(registry.invoke(capability,input,{signal:controller.signal,onAttempt:event=>{events.push(event);throw error;}}),cause=>cause===error);
  assert.deepEqual(events.map(e=>e.type),['started']);assert.deepEqual(calls,[]);
  for(const provider of registry.status().providers){assert.equal(provider.stats.fail,0);assert.equal(provider.stats.success,0);}
  assert.equal(getEventListeners(controller.signal,'abort').length,0);
});

test('completion-hook error propagates without a failed event or another inference',async()=>{
  const events=[],error=new Error('ledger completion unavailable'),controller=new AbortController(),{registry,calls}=fixture({backup:true});
  await assert.rejects(registry.invoke(capability,input,{signal:controller.signal,onAttempt:event=>{events.push(event);if(event.type==='completed')throw error;}}),cause=>cause===error);
  assert.deepEqual(events.map(e=>e.type),['started','completed']);assert.deepEqual(calls,['local-primary']);
  for(const provider of registry.status().providers){assert.equal(provider.stats.fail,0);assert.equal(provider.stats.success,0);}
  assert.equal(getEventListeners(controller.signal,'abort').length,0);
});

test('failure-hook error propagates without allowing fallback or counting a provider fault',async()=>{
  const events=[],error=new Error('ledger failure unavailable'),{registry,calls}=fixture({invoke:async()=>{throw new Error('provider offline');},backup:true});
  await assert.rejects(registry.invoke(capability,input,{onAttempt:event=>{events.push(event);if(event.type==='failed')throw error;}}),cause=>cause===error);
  assert.deepEqual(events.map(e=>e.type),['started','failed']);assert.deepEqual(calls,['local-primary']);
  assert.equal(registry.status().providers[0].stats.fail,0);
});

test('async and thenable hooks are rejected and never open fallback',async()=>{
  for(const stage of ['started','completed','failed']){
    // Promise.prototype exposes a native then method without being a Promise
    // instance. This exercises malformed thenables without constructing an
    // object that might accidentally be assimilated as a successful hook.
    for(const hookResult of [()=>Promise.resolve(),()=>Promise.reject(new Error('async ledger rejected')),()=>Promise.prototype]){
      const events=[],{registry,calls}=fixture({backup:true,invoke:async()=>{if(stage==='failed')throw new Error('offline');return {usage:{prompt_tokens:1,completion_tokens:1}};}});
      await assert.rejects(registry.invoke(capability,input,{onAttempt:event=>{events.push(event);if(event.type===stage)return hookResult();}}),/onAttempt precisa concluir/);
      assert.deepEqual(calls,stage==='started'?[]:['local-primary']);
      assert.deepEqual(events.map(e=>e.type),stage==='started'?['started']:['started',stage]);
      assert.equal(registry.status().providers[0].stats.fail,0);
    }
  }
});

test('invalid hooks fail before availability probing',async()=>{
  for(const onAttempt of [{},'callback',false,1]){
    const {registry,calls,probes}=fixture();
    await assert.rejects(registry.invoke(capability,input,{onAttempt}),/onAttempt precisa ser função/);
    assert.deepEqual(calls,[]);assert.deepEqual(probes,[]);
  }
});

test('cancelled cooperative inference records unknown failure and does not open fallback',async()=>{
  const entered=deferred(),controller=new AbortController(),events=[];
  const {registry,calls}=fixture({backup:true,invoke:async({signal})=>{entered.resolve();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}});
  const pending=registry.invoke(capability,input,{signal:controller.signal,onAttempt:event=>events.push(event)});
  await entered.promise;const reason=new Error('task_cancelled');controller.abort(reason);
  await assert.rejects(pending,error=>error===reason);
  assert.deepEqual(events.map(e=>e.type),['started','failed']);assert.equal(events[1].known,false);
  assert.deepEqual(calls,['local-primary']);assert.equal(registry.status().providers[0].stats.fail,0);
});

test('late response records tokens even though cancelled task rejects output and cannot fallback',async()=>{
  const entered=deferred(),output=deferred(),controller=new AbortController(),events=[];
  const {registry,calls}=fixture({backup:true,invoke:async()=>{entered.resolve();return output.promise;}});
  const pending=registry.invoke(capability,input,{signal:controller.signal,onAttempt:event=>events.push(event)});
  let settled=false;pending.then(()=>{settled=true;},()=>{settled=true;});
  await entered.promise;const reason=new Error('task_cancelled');controller.abort(reason);await Promise.resolve();await Promise.resolve();
  assert.equal(settled,false);assert.deepEqual(events.map(e=>e.type),['started']);
  output.resolve({usage:{prompt_tokens:30,completion_tokens:15}});
  await assert.rejects(pending,error=>error===reason);
  assert.deepEqual(events.map(e=>e.type),['started','completed']);assert.equal(events[1].inputTokens,30);assert.equal(events[1].outputTokens,15);assert.equal(events[1].known,true);
  assert.deepEqual(calls,['local-primary']);assert.equal(registry.status().providers[0].stats.success,0);
  assert.equal(getEventListeners(controller.signal,'abort').length,0);
});

test('unknown late response stays unknown rather than an invented zero',async()=>{
  const entered=deferred(),output=deferred(),controller=new AbortController(),events=[];
  const {registry}=fixture({invoke:async()=>{entered.resolve();return output.promise;}});
  const pending=registry.invoke(capability,input,{signal:controller.signal,onAttempt:event=>events.push(event)});
  await entered.promise;controller.abort();output.resolve({text:'late'});
  await assert.rejects(pending,{name:'AbortError'});
  assert.deepEqual(events.map(e=>e.type),['started','completed']);assert.equal(events[1].known,false);assert.equal(events[1].inputTokens,null);assert.equal(events[1].outputTokens,null);
});

test('cancellation by admission hook cannot start provider inference',async()=>{
  const controller=new AbortController(),events=[],{registry,calls}=fixture({backup:true});
  await assert.rejects(registry.invoke(capability,input,{signal:controller.signal,onAttempt:event=>{events.push(event);if(event.type==='started')controller.abort();}}),{name:'AbortError'});
  assert.deepEqual(calls,[]);assert.deepEqual(events.map(e=>e.type),['started','failed']);
  assert.equal(registry.status().providers[0].stats.fail,0);
});

test('hook is private to registry and is not forwarded into provider input or options',async()=>{
  let seen;const {registry}=fixture({invoke:async args=>{seen=args;return {usage:{prompt_tokens:1,completion_tokens:2}};}});
  await registry.invoke(capability,input,{onAttempt:()=>{},evaluation:true,maxTokens:77,taskProtocol:'draft-v1'});
  assert.deepEqual(seen.input,input);assert.deepEqual(seen.options,{evaluation:true,maxTokens:77,taskProtocol:'draft-v1'});
});
