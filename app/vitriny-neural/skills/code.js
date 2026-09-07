const ACTIONS=new Set(['analyze','plan','patch','test-plan','review']);
const SECRET_PATTERN=/-----BEGIN .*PRIVATE KEY-----|\b(?:sk-proj-|ghp_|github_pat_|AKIA)[A-Za-z0-9_\-]{10,}/;
function text(value,max,min=0){const v=String(value??'').trim();if(v.length<min||v.length>max||/[\u0000-\u001f\u007f]/.test(v)||SECRET_PATTERN.test(v))throw new Error('Entrada de código inválida.');return v;}

export function createCodeSkill({neural=null}={}){
  return {
    id:'code.engineer',version:'1',risk:'review',
    capabilities:['code.analyze','code.plan','code.patch','code.review','code.test-plan'],
    async execute({input,invoke,context={}}){
      const action=String(input?.action||'analyze');if(!ACTIONS.has(action))throw new Error('Ação de engenharia inválida.');
      const capability=`code.${action}`;
      const request={
        task:text(input.task,6000,3),
        repository:text(input.repository||'vitrinecity',160,2),
        branch:text(input.branch||'',160),
        files:Array.isArray(input.files)?input.files.slice(0,80).map(v=>text(v,300,1)):[],
        constraints:Array.isArray(input.constraints)?input.constraints.slice(0,40).map(v=>text(v,500,1)):[],
        requireTests:input.requireTests!==false,
        dryRun:input.dryRun!==false
      };
      const result=await invoke(capability,request,{preferredProviders:Array.isArray(input.preferredProviders)?input.preferredProviders:[],timeoutMs:Math.max(5000,Math.min(10*60*1000,Number(input.timeoutMs)||120000))});
      if(neural?.ingest)try{neural.ingest({type:`skill.${capability}.completed`,source:'vitriny-neural',entityType:'skill',entityId:'code.engineer',priority:3,payload:{provider:result.provider,dryRun:request.dryRun,learningContext:context.learningContext||{}}});}catch{}
      return {action,provider:result.provider,output:result.output,attempts:result.attempts};
    }
  };
}
