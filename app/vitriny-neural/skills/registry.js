import {randomUUID} from 'node:crypto';

const ID=/^[a-z][a-z0-9._-]{1,63}$/;

function ensureId(value,label){const v=String(value||'').trim();if(!ID.test(v))throw new Error(`${label} inválido.`);return v;}
function ensureFn(value,label){if(typeof value!=='function')throw new TypeError(`${label} precisa ser função.`);return value;}
function abortIfRequested(signal){if(signal?.aborted)throw signal.reason instanceof Error?signal.reason:Object.assign(new Error('provider_aborted'),{name:'AbortError'});}
function statOf(stats,id){if(!stats.has(id))stats.set(id,{success:0,fail:0,consecutiveFail:0,totalMs:0,lastMs:0,openedUntil:0,inputTokens:0,outputTokens:0,totalTokens:0});return stats.get(id);}
function usageOf(output){
  const u=output?.usage||output?.output?.usage||{};
  const field=names=>{for(const name of names)if(Object.prototype.hasOwnProperty.call(u,name))return u[name];};
  const input=field(['prompt_tokens','input_tokens','promptTokens','inputTokens']);
  const outputTokens=field(['completion_tokens','output_tokens','completionTokens','outputTokens']);
  const valid=value=>Number.isSafeInteger(value)&&value>=0;
  const known=valid(input)&&valid(outputTokens)&&Number.isSafeInteger(input+outputTokens);
  // Missing/invalid usage is not zero consumption. Keep numeric fields for old
  // dashboards, but accounting must consult `known`. Completion usage already
  // includes any reasoning tokens reported by the provider; do not add them twice.
  return{inputTokens:valid(input)?input:0,outputTokens:valid(outputTokens)?outputTokens:0,totalTokens:known?input+outputTokens:0,known};
}
function emitAttempt(callback,event){
  if(!callback)return;
  const result=callback(Object.freeze(event));
  if(result&&typeof result.then==='function'){
    // Avoid an unhandled rejection from an accidentally async hook. Never await
    // it or continue inference: the durable accounting hook must be synchronous.
    Promise.resolve(result).catch(()=>{});
    throw new TypeError('onAttempt precisa concluir de forma síncrona.');
  }
}

export function createSkillRegistry({now=Date.now,circuitFailureThreshold=3,circuitCooldownMs=60000,knowledgeProvider=null}={}){
  const skills=new Map(),providers=new Map(),stats=new Map(),providerPolicies=new Map();
  const threshold=Math.max(1,Math.min(20,Number(circuitFailureThreshold)||3));
  const cooldown=Math.max(1000,Math.min(30*60*1000,Number(circuitCooldownMs)||60000));

  function registerSkill(skill){
    const id=ensureId(skill?.id,'Skill');
    if(skills.has(id))throw new Error(`Skill ${id} já registrada.`);
    const capabilities=[...new Set((skill.capabilities||[]).map(x=>ensureId(x,'Capability')))];
    if(!capabilities.length)throw new Error('Skill precisa declarar capacidades.');
    const normalized={id,version:String(skill.version||'1'),capabilities,execute:ensureFn(skill.execute,'execute'),risk:skill.risk||'low'};
    skills.set(id,normalized);return normalized;
  }

  function registerProvider(provider){
    const id=ensureId(provider?.id,'Provider');
    if(providers.has(id))throw new Error(`Provider ${id} já registrado.`);
    const capabilities=new Set((provider.capabilities||[]).map(x=>ensureId(x,'Capability')));
    if(!capabilities.size)throw new Error('Provider precisa declarar capacidades.');
    const normalized={
      id,capabilities,priority:Number.isFinite(Number(provider.priority))?Number(provider.priority):100,
      costClass:String(provider.costClass||'unknown'),local:Boolean(provider.local),modelName:String(provider.modelName||''),
      available:typeof provider.available==='function'?provider.available:async()=>true,
      invoke:ensureFn(provider.invoke,'invoke')
    };
    providers.set(id,normalized);statOf(stats,id);providerPolicies.set(id,{enabled:true,allowedCapabilities:null,source:'default'});return normalized;
  }

  function setProviderPolicy(providerId,{enabled=true,allowedCapabilities=null,source='qualification'}={}){
    const id=ensureId(providerId,'Provider'),provider=providers.get(id);if(!provider)throw new Error(`Provider ${id} não registrado.`);
    let allowed=null;
    if(Array.isArray(allowedCapabilities))allowed=new Set(allowedCapabilities.map(x=>ensureId(x,'Capability')).filter(cap=>provider.capabilities.has(cap)));
    const policy={enabled:Boolean(enabled),allowedCapabilities:allowed,source:String(source||'qualification').slice(0,80)};
    providerPolicies.set(id,policy);
    return{id,enabled:policy.enabled,allowedCapabilities:allowed?[...allowed]:null,source:policy.source};
  }

  async function candidates(capability,{preferredProviders=[],evaluation=false,localOnly=false,allowedProviders=null,signal=null}={}){
    abortIfRequested(signal);
    const preferred=new Map(preferredProviders.map((id,index)=>[id,index])),clock=now();
    const allowed=Array.isArray(allowedProviders)?new Set(allowedProviders):null;
    const rows=[];
    for(const provider of providers.values()){
      abortIfRequested(signal);
      if(!provider.capabilities.has(capability))continue;
      // Routing restrictions are admission checks, not ranking preferences. An empty
      // allowlist denies all providers, including during administrative evaluation.
      if(localOnly&&!provider.local)continue;
      if(allowed&&!allowed.has(provider.id))continue;
      const policy=providerPolicies.get(provider.id)||{enabled:true,allowedCapabilities:null};
      // Um provider reprovado em benchmark continua bloqueado para operação, mas pode ser chamado
      // explicitamente pela console administrativa para diagnóstico/benchmark, sem executar ações.
      if(!evaluation){
        if(!policy.enabled)continue;
        if(policy.allowedCapabilities&&!policy.allowedCapabilities.has(capability))continue;
      }
      const s=statOf(stats,provider.id);
      if(s.openedUntil>clock)continue;
      if(s.openedUntil&&s.openedUntil<=clock){s.openedUntil=0;s.consecutiveFail=0;}
      let available=false;try{available=await provider.available(capability);}catch{}
      abortIfRequested(signal);
      if(!available)continue;
      const reliability=(s.success+1)/(s.success+s.fail+2);
      rows.push({provider,reliability,preferred:preferred.has(provider.id)?preferred.get(provider.id):999});
    }
    return rows.sort((a,b)=>a.preferred-b.preferred||a.provider.priority-b.provider.priority||b.reliability-a.reliability).map(x=>x.provider);
  }

  async function invoke(capability,input,{preferredProviders=[],timeoutMs=120000,evaluation=false,maxTokens=null,localOnly=false,allowedProviders=null,signal=null,taskProtocol=null,onAttempt=null}={}){
    abortIfRequested(signal);
    if(onAttempt!==null)ensureFn(onAttempt,'onAttempt');
    let request=input;
    if(typeof knowledgeProvider==='function'&&input&&typeof input==='object'&&!Array.isArray(input)){
      // Caller-supplied knowledge cannot impersonate the reviewed system corpus.
      const {platformKnowledge:ignored,...plainInput}=input;request=plainInput;
      const query=[input.task,input.question,input.message,input.objective,input.prompt].filter(value=>typeof value==='string').join(' ').slice(0,6000);
      try{const sources=knowledgeProvider(query);if(Array.isArray(sources)&&sources.length)request={...plainInput,platformKnowledge:{scope:'public_platform_facts_only',sources}};}catch{/* Knowledge is optional; its failure does not grant broader access. */}
    }
    const list=await candidates(capability,{preferredProviders,evaluation,localOnly,allowedProviders,signal});
    abortIfRequested(signal);
    if(!list.length)throw new Error(`Nenhum provider disponível para ${capability}.`);
    const attempts=[];
    for(const provider of list){
      abortIfRequested(signal);
      // Availability awaits and earlier attempts allow policy revocation after
      // candidate selection. Admission must still hold at each dispatch.
      const currentPolicy=providerPolicies.get(provider.id)||{enabled:true,allowedCapabilities:null};
      if(!evaluation&&(!currentPolicy.enabled||(currentPolicy.allowedCapabilities&&!currentPolicy.allowedCapabilities.has(capability))))continue;
      if(statOf(stats,provider.id).openedUntil>now())continue;
      const started=now(),attemptId=randomUUID(),identity={attemptId,provider:provider.id,modelName:provider.modelName};
      const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
      const forwardAbort=()=>controller.abort(signal.reason);
      signal?.addEventListener('abort',forwardAbort,{once:true});
      try{
        abortIfRequested(signal);
        // Hook errors are ledger/admission errors, never provider errors. In
        // particular, a failed start record must prevent this call and fallback.
        emitAttempt(onAttempt,{type:'started',...identity,inputTokens:null,outputTokens:null,known:false,durationMs:null});
        let output,error,failed=false;
        try{abortIfRequested(signal);output=await provider.invoke({capability,input:request,signal:controller.signal,options:{evaluation,maxTokens,...(taskProtocol==='draft-v1'?{taskProtocol}: {})}});}
        catch(cause){failed=true;error=cause;}
        const elapsed=Math.max(0,now()-started);
        if(failed){
          emitAttempt(onAttempt,{type:'failed',...identity,inputTokens:null,outputTokens:null,known:false,durationMs:elapsed});
          // Caller cancellation is not a provider fault and never permits fallback.
          abortIfRequested(signal);
          const s=statOf(stats,provider.id);s.fail++;s.consecutiveFail++;s.lastMs=elapsed;s.totalMs+=elapsed;if(s.consecutiveFail>=threshold)s.openedUntil=now()+cooldown;
          attempts.push({provider:provider.id,ok:false,error:String(error?.name==='AbortError'?'provider_timeout':error?.message||'provider_failed').slice(0,240)});
          continue;
        }
        const usage=usageOf(output);
        // Record even a late response to a cancelled task: it still consumed
        // inference. Do not turn a failed completion hook into a second event.
        emitAttempt(onAttempt,{type:'completed',...identity,inputTokens:usage.known?usage.inputTokens:null,outputTokens:usage.known?usage.outputTokens:null,known:usage.known,durationMs:elapsed});
        abortIfRequested(signal);
        const s=statOf(stats,provider.id);s.success++;s.consecutiveFail=0;s.lastMs=elapsed;s.totalMs+=elapsed;s.openedUntil=0;s.inputTokens+=usage.inputTokens;s.outputTokens+=usage.outputTokens;s.totalTokens+=usage.totalTokens;
        return {provider:provider.id,output,durationMs:elapsed,usage,attempts:[...attempts,{provider:provider.id,ok:true}]};
      }finally{clearTimeout(timer);signal?.removeEventListener('abort',forwardAbort);}
    }
    const error=new Error(`Todos os providers falharam para ${capability}.`);error.attempts=attempts;throw error;
  }

  async function run(skillId,input,context={}){
    const skill=skills.get(ensureId(skillId,'Skill'));if(!skill)throw new Error(`Skill ${skillId} não encontrada.`);
    const evaluation=context?.evaluation===true;
    const invokeForSkill=(capability,payload,options={})=>invoke(capability,payload,{...options,evaluation,maxTokens:evaluation?(Number(context.maxTokens)||400):options.maxTokens});
    const candidatesForSkill=(capability,options={})=>candidates(capability,{...options,evaluation});
    return skill.execute({input,context,invoke:invokeForSkill,candidates:candidatesForSkill,registry:{skills,providers,stats,providerPolicies}});
  }

  function status(){const clock=now();return {skills:[...skills.values()].map(s=>({id:s.id,version:s.version,capabilities:s.capabilities,risk:s.risk})),providers:[...providers.values()].map(p=>{const s=statOf(stats,p.id),calls=s.success+s.fail,policy=providerPolicies.get(p.id)||{enabled:true,allowedCapabilities:null,source:'default'};return{id:p.id,modelName:p.modelName,capabilities:[...p.capabilities],priority:p.priority,costClass:p.costClass,local:p.local,policy:{enabled:policy.enabled,allowedCapabilities:policy.allowedCapabilities?[...policy.allowedCapabilities]:null,source:policy.source},stats:{success:s.success,fail:s.fail,consecutiveFail:s.consecutiveFail,reliability:(s.success+1)/(calls+2),avgMs:calls?s.totalMs/calls:0,lastMs:s.lastMs,inputTokens:s.inputTokens,outputTokens:s.outputTokens,totalTokens:s.totalTokens,circuit:s.openedUntil>clock?'open':'closed',openedUntil:s.openedUntil||null}};})};}

  return {registerSkill,registerProvider,setProviderPolicy,run,invoke,candidates,status};
}
