const CAPABILITIES=Object.freeze(['code.plan','growth.content-plan']);
const CACHE_MS=10000;

/** Connectivity and existing admission prerequisites, never inference or authorization. */
export function createNeuralTaskDiagnostics({probeLocalProviders,getProviders,getQualification,getTaskStatus,now=Date.now}={}){
  if([probeLocalProviders,getProviders,getQualification,getTaskStatus].some(fn=>typeof fn!=='function'))throw new TypeError('Diagnóstico requer runtime e políticas de tarefas.');
  let cached=null,inFlight=null;
  async function connectivity(){
    if(cached&&now()>=cached.checkedAt&&now()<cached.expiresAt)return {snapshot:cached,fromCache:true};
    if(inFlight)return {snapshot:await inFlight,fromCache:true};
    inFlight=Promise.resolve().then(probeLocalProviders).then(providers=>{
      const checkedAt=Number(now());
      cached={providers,checkedAt,expiresAt:checkedAt+CACHE_MS};
      return cached;
    });
    try{return {snapshot:await inFlight,fromCache:false};}
    finally{inFlight=null;}
  }
  async function check(){
    const {snapshot,fromCache}=await connectivity();
    // Only connectivity is cached. Revocation, flags and qualification stay current.
    const task=getTaskStatus(),tasksEnabled=task?.enabled===true;
    const taskQuotaAvailable=task?.usage?.remaining!==0&&task?.usage?.remainingRuns!==0;
    const probes=new Map(snapshot.providers.map(probe=>[probe.providerId,probe]));
    const providers=getProviders().filter(provider=>provider.local===true).map(provider=>{
      const probe=probes.get(provider.id),record=getQualification(provider.id);
      const qualificationPresent=Boolean(record?.qualification);
      const qualificationModelMatches=Boolean(provider.modelName)&&record?.modelName===provider.modelName;
      const enabled=provider.policy?.enabled===true,circuitClosed=provider.stats?.circuit!=='open';
      const qualifiedCapabilities=CAPABILITIES.filter(capability=>qualificationModelMatches&&record?.qualification?.productionEligible===true&&
        record.qualification.allowedCapabilities?.includes(capability)&&provider.capabilities?.includes(capability)&&
        (!provider.policy?.allowedCapabilities||provider.policy.allowedCapabilities.includes(capability)));
      const reachable=probe?.reachable===true,modelAvailable=probe?.modelAvailable===true;
      const connectionReady=probe?.ok===true&&reachable&&modelAvailable&&probe.modelName===provider.modelName;
      return {providerId:provider.id,modelName:provider.modelName||'',enabled,circuitClosed,reachable,modelAvailable,
        probeCode:probe?.code||'provider_probe_unsupported',httpStatus:probe?.httpStatus??null,
        qualificationPresent,qualificationModelMatches,qualifiedCapabilities,
        blockedCapabilities:CAPABILITIES.filter(capability=>!qualifiedCapabilities.includes(capability)),
        readyForTaskAttempt:tasksEnabled&&taskQuotaAvailable&&enabled&&circuitClosed&&connectionReady&&qualifiedCapabilities.length===CAPABILITIES.length,
        capabilities:Object.fromEntries(CAPABILITIES.map(capability=>[capability,tasksEnabled&&taskQuotaAvailable&&enabled&&circuitClosed&&connectionReady&&qualifiedCapabilities.includes(capability)]))};
    });
    const capabilities=Object.fromEntries(CAPABILITIES.map(capability=>[capability,providers.some(provider=>provider.capabilities[capability])]));
    return {checkedAt:snapshot.checkedAt,expiresAt:snapshot.expiresAt,cached:fromCache,cacheMs:CACHE_MS,
      noInference:true,generationVerified:false,liveTaskAcceptance:'not_run_here',tasksEnabled,taskQuotaAvailable,
      readyForTaskAttempt:CAPABILITIES.every(capability=>capabilities[capability]),capabilities,providers};
  }
  return {check};
}
