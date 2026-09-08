const ID=/^[a-z][a-z0-9._-]{1,63}$/;

function ensureId(value,label){const v=String(value||'').trim();if(!ID.test(v))throw new Error(`${label} inválido.`);return v;}
function ensureFn(value,label){if(typeof value!=='function')throw new TypeError(`${label} precisa ser função.`);return value;}
function statOf(stats,id){if(!stats.has(id))stats.set(id,{success:0,fail:0,consecutiveFail:0,totalMs:0,lastMs:0,openedUntil:0,inputTokens:0,outputTokens:0,totalTokens:0});return stats.get(id);}
function usageOf(output){const u=output?.usage||output?.output?.usage||{};const input=Number(u.prompt_tokens??u.input_tokens??u.promptTokens??u.inputTokens??0)||0;const outputTokens=Number(u.completion_tokens??u.output_tokens??u.completionTokens??u.outputTokens??0)||0;const total=Number(u.total_tokens??u.totalTokens??0)||input+outputTokens;return{inputTokens:Math.max(0,input),outputTokens:Math.max(0,outputTokens),totalTokens:Math.max(0,total)};}

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
      costClass:String(provider.costClass||'unknown'),local:Boolean(provider.local),
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

  async function candidates(capability,{preferredProviders=[],evaluation=false}={}){
    const preferred=new Map(preferredProviders.map((id,index)=>[id,index])),clock=now();
    const rows=[];
    for(const provider of providers.values()){
      if(!provider.capabilities.has(capability))continue;
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
      if(!available)continue;
      const reliability=(s.success+1)/(s.success+s.fail+2);
      rows.push({provider,reliability,preferred:preferred.has(provider.id)?preferred.get(provider.id):999});
    }
    return rows.sort((a,b)=>a.preferred-b.preferred||a.provider.priority-b.provider.priority||b.reliability-a.reliability).map(x=>x.provider);
  }

  async function invoke(capability,input,{preferredProviders=[],timeoutMs=120000,evaluation=false,maxTokens=null}={}){
    let request=input;
    if(typeof knowledgeProvider==='function'&&input&&typeof input==='object'&&!Array.isArray(input)){
      // Caller-supplied knowledge cannot impersonate the reviewed system corpus.
      const {platformKnowledge:ignored,...plainInput}=input;request=plainInput;
      const query=[input.task,input.question,input.message,input.objective,input.prompt].filter(value=>typeof value==='string').join(' ').slice(0,6000);
      try{const sources=knowledgeProvider(query);if(Array.isArray(sources)&&sources.length)request={...plainInput,platformKnowledge:{scope:'public_platform_facts_only',sources}};}catch{/* Knowledge is optional; its failure does not grant broader access. */}
    }
    const list=await candidates(capability,{preferredProviders,evaluation});
    if(!list.length)throw new Error(`Nenhum provider disponível para ${capability}.`);
    const attempts=[];
    for(const provider of list){
      const started=now();
      try{
        const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
        try{
          const output=await provider.invoke({capability,input:request,signal:controller.signal,options:{evaluation,maxTokens}});
          const elapsed=Math.max(0,now()-started),s=statOf(stats,provider.id),usage=usageOf(output);s.success++;s.consecutiveFail=0;s.lastMs=elapsed;s.totalMs+=elapsed;s.openedUntil=0;s.inputTokens+=usage.inputTokens;s.outputTokens+=usage.outputTokens;s.totalTokens+=usage.totalTokens;
          return {provider:provider.id,output,durationMs:elapsed,usage,attempts:[...attempts,{provider:provider.id,ok:true}]};
        }finally{clearTimeout(timer);}
      }catch(error){
        const elapsed=Math.max(0,now()-started),s=statOf(stats,provider.id);s.fail++;s.consecutiveFail++;s.lastMs=elapsed;s.totalMs+=elapsed;if(s.consecutiveFail>=threshold)s.openedUntil=now()+cooldown;
        attempts.push({provider:provider.id,ok:false,error:String(error?.name==='AbortError'?'provider_timeout':error?.message||'provider_failed').slice(0,240)});
      }
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

  function status(){const clock=now();return {skills:[...skills.values()].map(s=>({id:s.id,version:s.version,capabilities:s.capabilities,risk:s.risk})),providers:[...providers.values()].map(p=>{const s=statOf(stats,p.id),calls=s.success+s.fail,policy=providerPolicies.get(p.id)||{enabled:true,allowedCapabilities:null,source:'default'};return{id:p.id,capabilities:[...p.capabilities],priority:p.priority,costClass:p.costClass,local:p.local,policy:{enabled:policy.enabled,allowedCapabilities:policy.allowedCapabilities?[...policy.allowedCapabilities]:null,source:policy.source},stats:{success:s.success,fail:s.fail,consecutiveFail:s.consecutiveFail,reliability:(s.success+1)/(calls+2),avgMs:calls?s.totalMs/calls:0,lastMs:s.lastMs,inputTokens:s.inputTokens,outputTokens:s.outputTokens,totalTokens:s.totalTokens,circuit:s.openedUntil>clock?'open':'closed',openedUntil:s.openedUntil||null}};})};}

  return {registerSkill,registerProvider,setProviderPolicy,run,invoke,candidates,status};
}
