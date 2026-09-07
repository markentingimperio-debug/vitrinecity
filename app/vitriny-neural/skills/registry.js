const ID=/^[a-z][a-z0-9._-]{1,63}$/;

function ensureId(value,label){const v=String(value||'').trim();if(!ID.test(v))throw new Error(`${label} inválido.`);return v;}
function ensureFn(value,label){if(typeof value!=='function')throw new TypeError(`${label} precisa ser função.`);return value;}

export function createSkillRegistry({now=Date.now}={}){
  const skills=new Map(),providers=new Map(),stats=new Map();

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
    providers.set(id,normalized);return normalized;
  }

  async function candidates(capability,{preferredProviders=[]}={}){
    const preferred=new Map(preferredProviders.map((id,index)=>[id,index]));
    const rows=[];
    for(const provider of providers.values()){
      if(!provider.capabilities.has(capability))continue;
      let available=false;try{available=await provider.available(capability);}catch{}
      if(!available)continue;
      const s=stats.get(provider.id)||{success:0,fail:0};
      const reliability=(s.success+1)/(s.success+s.fail+2);
      rows.push({provider,reliability,preferred:preferred.has(provider.id)?preferred.get(provider.id):999});
    }
    return rows.sort((a,b)=>a.preferred-b.preferred||a.provider.priority-b.provider.priority||b.reliability-a.reliability).map(x=>x.provider);
  }

  async function invoke(capability,input,{preferredProviders=[],timeoutMs=120000}={}){
    const list=await candidates(capability,{preferredProviders});
    if(!list.length)throw new Error(`Nenhum provider disponível para ${capability}.`);
    const attempts=[];
    for(const provider of list){
      const started=now();
      try{
        const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
        try{
          const output=await provider.invoke({capability,input,signal:controller.signal});
          const s=stats.get(provider.id)||{success:0,fail:0};s.success++;stats.set(provider.id,s);
          return {provider:provider.id,output,durationMs:now()-started,attempts:[...attempts,{provider:provider.id,ok:true}]};
        }finally{clearTimeout(timer);}
      }catch(error){
        const s=stats.get(provider.id)||{success:0,fail:0};s.fail++;stats.set(provider.id,s);
        attempts.push({provider:provider.id,ok:false,error:String(error?.message||'provider_failed').slice(0,240)});
      }
    }
    const error=new Error(`Todos os providers falharam para ${capability}.`);error.attempts=attempts;throw error;
  }

  async function run(skillId,input,context={}){
    const skill=skills.get(ensureId(skillId,'Skill'));if(!skill)throw new Error(`Skill ${skillId} não encontrada.`);
    return skill.execute({input,context,invoke,candidates,registry:{skills,providers,stats}});
  }

  function status(){return {skills:[...skills.values()].map(s=>({id:s.id,version:s.version,capabilities:s.capabilities,risk:s.risk})),providers:[...providers.values()].map(p=>({id:p.id,capabilities:[...p.capabilities],priority:p.priority,costClass:p.costClass,local:p.local,stats:stats.get(p.id)||{success:0,fail:0}}))};}

  return {registerSkill,registerProvider,run,invoke,candidates,status};
}
