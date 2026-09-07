const ACTIONS=new Set(['collect','compare','summarize','verify']);
function text(value,max,min=0){const v=String(value??'').trim();if(v.length<min||v.length>max||/[\u0000-\u001f\u007f]/.test(v))throw new Error('Entrada de pesquisa inválida.');return v;}

export function createResearchSkill({neural=null}={}){
  return {
    id:'research.supervised',version:'1',risk:'review',
    capabilities:['research.collect','research.compare','research.summarize','research.verify'],
    async execute({input,invoke,context={}}){
      const action=String(input?.action||'collect');if(!ACTIONS.has(action))throw new Error('Ação de pesquisa inválida.');
      const capability=`research.${action}`;
      const request={
        question:text(input.question,5000,3),
        sourcePolicy:text(input.sourcePolicy||'authoritative-first',120,2),
        maxSources:Math.max(1,Math.min(20,Number(input.maxSources)||8)),
        freshnessDays:Math.max(0,Math.min(3650,Number(input.freshnessDays)||30)),
        domains:Array.isArray(input.domains)?input.domains.slice(0,20).map(v=>text(v,120,2)):[],
        requireCitations:true,
        allowAutomaticApproval:false
      };
      const result=await invoke(capability,request,{preferredProviders:Array.isArray(input.preferredProviders)?input.preferredProviders:[],timeoutMs:Math.max(5000,Math.min(5*60*1000,Number(input.timeoutMs)||90000))});
      if(neural?.ingest)try{neural.ingest({type:`skill.${capability}.completed`,source:'vitriny-neural',entityType:'skill',entityId:'research.supervised',priority:2,payload:{provider:result.provider,maxSources:request.maxSources,learningContext:context.learningContext||{}}});}catch{}
      return {action,provider:result.provider,output:result.output,attempts:result.attempts,requiresReview:true};
    }
  };
}
