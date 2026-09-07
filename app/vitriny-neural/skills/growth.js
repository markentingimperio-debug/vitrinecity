const ACTIONS=new Set(['diagnose','campaign-plan','content-plan','seo-plan','experiment','metric-review']);
function text(value,max,min=0){const v=String(value??'').trim();if(v.length<min||v.length>max||/[\u0000-\u001f\u007f]/.test(v))throw new Error('Entrada de marketing inválida.');return v;}
function safeMetrics(value){if(!value||typeof value!=='object'||Array.isArray(value))return{};const out={};for(const [k,v] of Object.entries(value).slice(0,80)){const key=text(k,80,1),n=Number(v);if(Number.isFinite(n))out[key]=n;}return out;}

export function createGrowthSkill({neural=null}={}){
  return {
    id:'growth.optimizer',version:'1',risk:'low',
    capabilities:['growth.diagnose','growth.campaign-plan','growth.content-plan','growth.seo-plan','growth.experiment','growth.metric-review'],
    async execute({input,invoke,context={}}){
      const action=String(input?.action||'diagnose');if(!ACTIONS.has(action))throw new Error('Ação de growth inválida.');
      const capability=`growth.${action}`;
      const request={
        objective:text(input.objective,2000,3),
        businessContext:text(input.businessContext||'',5000),
        audience:text(input.audience||'',1200),
        channel:text(input.channel||'multi',80,1),
        budgetCents:Math.max(0,Math.min(1_000_000_000,Number(input.budgetCents)||0)),
        metrics:safeMetrics(input.metrics),
        constraints:Array.isArray(input.constraints)?input.constraints.slice(0,30).map(v=>text(v,500,1)):[],
        requireMeasurementPlan:true
      };
      const result=await invoke(capability,request,{preferredProviders:Array.isArray(input.preferredProviders)?input.preferredProviders:[],timeoutMs:Math.max(5000,Math.min(5*60*1000,Number(input.timeoutMs)||90000))});
      if(neural?.ingest)try{neural.ingest({type:`skill.${capability}.completed`,source:'vitriny-neural',entityType:'skill',entityId:'growth.optimizer',priority:2,payload:{provider:result.provider,objective:request.objective.slice(0,180),learningContext:context.learningContext||{}}});}catch{}
      return {action,provider:result.provider,output:result.output,attempts:result.attempts};
    }
  };
}
