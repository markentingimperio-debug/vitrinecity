import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {createSkillRegistry} from '../vitriny-neural/skills/registry.js';

const capability='code.analyze';
const input={task:'Analyze a merchant task without remote fallback.'};
const completed=[];

function fixture({localFails=false}={}){
  const registry=createSkillRegistry(),calls=[],probes=[];
  for(const provider of [
    {id:'local-primary',local:true,priority:10},
    {id:'remote-premium',local:false,priority:20},
    {id:'local-backup',local:true,priority:30}
  ]){
    registry.registerProvider({
      ...provider,capabilities:[capability,'growth.diagnose'],
      available:async()=>{probes.push(provider.id);return true;},
      invoke:async()=>{
        calls.push(provider.id);
        if(localFails&&provider.local)throw new Error('Local provider unavailable');
        return {summary:'ok'};
      }
    });
  }
  return {registry,calls,probes};
}

async function check(name,run){await run();completed.push(name);}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

await check('local failure never invokes or probes a remote fallback',async()=>{
  const {registry,calls,probes}=fixture({localFails:true});
  await assert.rejects(registry.invoke(capability,input,{localOnly:true}),error=>{
    assert.match(error.message,/Todos os providers falharam/);
    assert.deepEqual(error.attempts.map(attempt=>attempt.provider),['local-primary','local-backup']);
    return true;
  });
  assert.deepEqual(calls,['local-primary','local-backup']);
  assert.deepEqual(probes,['local-primary','local-backup']);
});

await check('preferred remote provider cannot bypass local-only filtering',async()=>{
  const {registry,calls,probes}=fixture();
  const options={localOnly:true,preferredProviders:['remote-premium']};
  assert.deepEqual((await registry.candidates(capability,options)).map(p=>p.id),['local-primary','local-backup']);
  const result=await registry.invoke(capability,input,options);
  assert.equal(result.provider,'local-primary');
  assert.deepEqual(calls,['local-primary']);
  assert.equal(probes.includes('remote-premium'),false);
});

await check('explicit allowlist controls preferred providers and all fallback attempts',async()=>{
  const {registry,calls,probes}=fixture({localFails:true});
  const options={localOnly:true,allowedProviders:['local-primary'],preferredProviders:['remote-premium','local-backup']};
  assert.deepEqual((await registry.candidates(capability,options)).map(p=>p.id),['local-primary']);
  await assert.rejects(registry.invoke(capability,input,options),error=>{
    assert.deepEqual(error.attempts.map(attempt=>attempt.provider),['local-primary']);
    return true;
  });
  assert.deepEqual(calls,['local-primary']);
  assert.deepEqual([...new Set(probes)],['local-primary']);
});

await check('empty or unknown allowlist denies all providers without probing them',async()=>{
  for(const allowedProviders of [[],['unknown-provider']]){
    const {registry,calls,probes}=fixture();
    const options={allowedProviders,preferredProviders:['remote-premium']};
    assert.deepEqual(await registry.candidates(capability,options),[]);
    await assert.rejects(registry.invoke(capability,input,options),/Nenhum provider disponível/);
    assert.deepEqual(calls,[]);
    assert.deepEqual(probes,[]);
  }
});

await check('disabled and capability-blocked providers stay blocked despite preference and allowlist',async()=>{
  for(const policy of [{enabled:false},{allowedCapabilities:['growth.diagnose']},{allowedCapabilities:[]}]){
    const {registry,calls,probes}=fixture();
    registry.setProviderPolicy('local-primary',policy);
    const options={localOnly:true,allowedProviders:['local-primary'],preferredProviders:['local-primary']};
    assert.deepEqual(await registry.candidates(capability,options),[]);
    await assert.rejects(registry.invoke(capability,input,options),/Nenhum provider disponível/);
    assert.deepEqual(calls,[]);
    assert.deepEqual(probes,[]);
  }
});
await check('policy revocation after selection blocks dispatch and every fallback attempt',async()=>{
  for(const policy of [{enabled:false},{allowedCapabilities:['growth.diagnose']},{allowedCapabilities:[]}]){
    const registry=createSkillRegistry(),calls=[],events=[];
    registry.registerProvider({id:'local-primary',local:true,priority:1,capabilities:[capability],invoke:async()=>{
      calls.push('local-primary');registry.setProviderPolicy('local-backup',policy);throw Error('primary failed');
    }});
    registry.registerProvider({id:'local-backup',local:true,priority:2,capabilities:[capability,'growth.diagnose'],invoke:async()=>calls.push('local-backup')});
    await assert.rejects(registry.invoke(capability,input,{localOnly:true,onAttempt:event=>events.push(event)}),/Todos os providers falharam/);
    assert.deepEqual(calls,['local-primary']);assert.deepEqual(events.map(event=>event.type),['started','failed']);
  }
  const registry=createSkillRegistry(),calls=[];
  registry.registerProvider({id:'local-primary',local:true,capabilities:[capability],available:async()=>{
    registry.setProviderPolicy('local-primary',{enabled:false});return true;
  },invoke:async()=>calls.push('local-primary')});
  await assert.rejects(registry.invoke(capability,input,{localOnly:true}),/Todos os providers falharam/);
  assert.deepEqual(calls,[]);
});

await check('administrative evaluation does not bypass local-only or allowlist restrictions',async()=>{
  const {registry,calls,probes}=fixture();
  registry.setProviderPolicy('local-primary',{enabled:false});
  const options={evaluation:true,localOnly:true,allowedProviders:['local-primary'],preferredProviders:['remote-premium']};
  const result=await registry.invoke(capability,input,options);
  assert.equal(result.provider,'local-primary');
  assert.deepEqual(calls,['local-primary']);
  assert.deepEqual(probes,['local-primary']);
  assert.deepEqual(await registry.candidates(capability,{evaluation:true,allowedProviders:[]}),[]);
  assert.deepEqual(await registry.candidates(capability,{evaluation:true,localOnly:true,allowedProviders:['remote-premium']}),[]);
});

await check('default routing preserves existing remote fallback',async()=>{
  const {registry,calls}=fixture({localFails:true});
  const result=await registry.invoke(capability,input);
  assert.equal(result.provider,'remote-premium');
  assert.deepEqual(calls,['local-primary','remote-premium']);
  assert.deepEqual(result.attempts.map(attempt=>({provider:attempt.provider,ok:attempt.ok})),[
    {provider:'local-primary',ok:false},{provider:'remote-premium',ok:true}
  ]);
});

await check('an explicit allowed remote provider remains usable when local-only is off',async()=>{
  const {registry,calls,probes}=fixture();
  const result=await registry.invoke(capability,input,{allowedProviders:['remote-premium'],preferredProviders:['local-primary']});
  assert.equal(result.provider,'remote-premium');
  assert.deepEqual(calls,['remote-premium']);
  assert.deepEqual(probes,['remote-premium']);
});

await check('pre-aborted invocation never probes or invokes providers',async()=>{
  const {registry,calls,probes}=fixture(),controller=new AbortController();
  const reason=Object.assign(new Error('task_cancelled'),{code:'task_cancelled'});
  controller.abort(reason);
  await assert.rejects(registry.invoke(capability,input,{signal:controller.signal}),error=>error===reason);
  assert.deepEqual(calls,[]);
  assert.deepEqual(probes,[]);
});

await check('cancellation during availability stops all remaining probes and calls',async()=>{
  const registry=createSkillRegistry(),controller=new AbortController(),entered=deferred(),availability=deferred(),probes=[],calls=[];
  registry.registerProvider({id:'local-primary',local:true,capabilities:[capability],available:async()=>{
    probes.push('local-primary');entered.resolve();return availability.promise;
  },invoke:async()=>calls.push('local-primary')});
  registry.registerProvider({id:'local-backup',local:true,capabilities:[capability],available:async()=>{
    probes.push('local-backup');return true;
  },invoke:async()=>calls.push('local-backup')});
  const pending=registry.invoke(capability,input,{localOnly:true,signal:controller.signal});
  await entered.promise;controller.abort();availability.resolve(true);
  await assert.rejects(pending,{name:'AbortError'});
  assert.deepEqual(probes,['local-primary']);
  assert.deepEqual(calls,[]);
});

await check('external cancellation reaches provider and prevents local and remote fallback',async()=>{
  const registry=createSkillRegistry(),controller=new AbortController(),entered=deferred(),calls=[],probes=[];
  let attemptSignal;
  registry.registerProvider({id:'local-primary',local:true,capabilities:[capability],priority:1,invoke:async({signal})=>{
    calls.push('local-primary');attemptSignal=signal;entered.resolve();
    return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  }});
  for(const [id,local] of [['local-backup',true],['remote-premium',false]]){
    registry.registerProvider({id,local,capabilities:[capability],priority:2,available:async()=>{probes.push(id);return true;},invoke:async()=>calls.push(id)});
  }
  const pending=registry.invoke(capability,input,{localOnly:true,signal:controller.signal});
  await entered.promise;
  const reason=Object.assign(new Error('task_timeout'),{code:'task_timeout'});controller.abort(reason);
  await assert.rejects(pending,error=>error===reason);
  assert.equal(attemptSignal.aborted,true);
  assert.equal(attemptSignal.reason,reason);
  assert.deepEqual(calls,['local-primary']);
  assert.deepEqual(probes,['local-backup']);
  assert.equal(registry.status().providers.find(p=>p.id==='local-primary').stats.fail,0);
  assert.equal(getEventListeners(controller.signal,'abort').length,0);
});

await check('noncooperative provider stays awaited and its late response is rejected after cancellation',async()=>{
  const registry=createSkillRegistry(),controller=new AbortController(),entered=deferred(),output=deferred();
  let settled=false;
  registry.registerProvider({id:'local-primary',local:true,capabilities:[capability],invoke:async()=>{entered.resolve();return output.promise;}});
  const pending=registry.invoke(capability,input,{localOnly:true,signal:controller.signal});
  pending.then(()=>{settled=true;},()=>{settled=true;});
  await entered.promise;controller.abort();await Promise.resolve();await Promise.resolve();
  assert.equal(settled,false,'Cancellation must not detach the still-running model promise.');
  output.resolve({summary:'late output'});
  await assert.rejects(pending,{name:'AbortError'});
  assert.equal(registry.status().providers[0].stats.success,0);
  assert.equal(getEventListeners(controller.signal,'abort').length,0);
});

await check('signal propagation preserves evaluation and maxTokens and cleans listeners on success',async()=>{
  const registry=createSkillRegistry(),controller=new AbortController();
  let seen;
  registry.registerProvider({id:'local-primary',local:true,modelName:'fixture-model',capabilities:[capability],invoke:async args=>{seen=args;return {summary:'ok'};}});
  const result=await registry.invoke(capability,input,{localOnly:true,allowedProviders:['local-primary'],signal:controller.signal,evaluation:true,maxTokens:777});
  assert.equal(result.provider,'local-primary');
  assert.deepEqual(seen.options,{evaluation:true,maxTokens:777});
  assert.deepEqual(seen.input,input);
  assert.equal(seen.signal.aborted,false);
  assert.equal(getEventListeners(controller.signal,'abort').length,0);
  assert.equal(registry.status().providers[0].modelName,'fixture-model');
});

console.log(JSON.stringify({ok:true,tests:completed.length,completed}));
