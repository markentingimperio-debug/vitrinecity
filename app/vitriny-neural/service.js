import {createVitrinyNeuralRuntime} from './bootstrap.js';
import {createNeuralConfig} from './config.js';
import {qualifyModel} from './provider-qualification.js';
import {createQualificationStore} from './qualification-store.js';
import {createNeuralActionBudget} from './action-budget.js';
import {createNeuralExecutionController} from './execution-controller.js';
import {assessNeuralReadiness} from './readiness.js';
import {createShadowObserver} from './shadow-observer.js';
import {createNeuralBenchmarkManager} from './benchmark-manager.js';

function primaryProviderId(runtime){const providers=runtime.skills.status().providers||[];return providers.find(provider=>provider.policy?.enabled!==false)?.id||providers[0]?.id||null;}

export function createVitrinyNeuralService({db,env=process.env,fetchImpl=globalThis.fetch,now=Date.now,nodeId='service',providers=null,pseudonymSalt='vitriny-neural-v1',logger=console}={}){
  if(!db)throw new TypeError('Vitriny Neural service requer banco.');
  const config=createNeuralConfig({env});
  const runtime=createVitrinyNeuralRuntime({db,env,fetchImpl,now,nodeId,providers,pseudonymSalt,config});
  const qualifications=createQualificationStore(db);
  const budget=createNeuralActionBudget({db,now,limit:config.maxDailyAutoActions});
  const observer=createShadowObserver({db,neural:runtime.neural,now,intervalMs:config.observerIntervalMs,logger});

  function applyQualificationPolicy(providerId,qualification,source='qualification'){
    if(!runtime.skills.setProviderPolicy||!qualification)return null;
    return runtime.skills.setProviderPolicy(providerId,{enabled:qualification.productionEligible===true,allowedCapabilities:qualification.allowedCapabilities||[],source});
  }
  for(const provider of runtime.skills.status().providers){
    const saved=qualifications.latest(provider.id);
    if(saved?.qualification)applyQualificationPolicy(provider.id,saved.qualification,'persisted_qualification');
  }

  function activeQualificationRecord(){
    const providerId=primaryProviderId(runtime);
    return providerId?qualifications.latest(providerId):null;
  }
  function activeQualification(){return activeQualificationRecord()?.qualification||null;}

  const execution=createNeuralExecutionController({gate:runtime.gate,budget,getQualification:activeQualification});

  function recordQualification({providerId=primaryProviderId(runtime),modelName='',suite='',report}={}){
    if(!providerId)throw new Error('Nenhum provider Neural disponível para qualificação.');
    const qualification=qualifyModel(report,{thresholds:{overall:config.benchmarkMinScore,safety:config.benchmarkMinSafety}});
    const saved=qualifications.save({providerId,modelName,suite,report,qualification,at:new Date(Number(now())).toISOString()});
    applyQualificationPolicy(providerId,qualification,'semantic_benchmark');
    return saved;
  }

  const benchmarks=createNeuralBenchmarkManager({db,env,fetchImpl,now,recordQualification,logger});

  function readiness(){return assessNeuralReadiness({runtime,qualification:activeQualification()});}

  function capture(event){
    if(!config.enabled)return{accepted:false,reason:'neural_disabled'};
    return runtime.bridge.capture(event);
  }

  function authorize(proposal){return execution.authorize(proposal);}
  function commitAction(id){return execution.commit(id);}
  function releaseAction(id){return execution.release(id);}

  function status(){
    const qualification=activeQualificationRecord();
    return{
      ...runtime.status(),
      service:{version:1,enabled:config.enabled,mode:config.mode,primaryProviderId:primaryProviderId(runtime)},
      readiness:readiness(),
      qualification:qualification?{id:qualification.id,providerId:qualification.providerId,modelName:qualification.modelName,score:qualification.score,safetyScore:qualification.safetyScore,productionEligible:qualification.productionEligible,createdAt:qualification.createdAt}:null,
      actionBudget:budget.usage(),
      observer:observer.status(),
      benchmark:{activeId:benchmarks.status().activeId,recent:benchmarks.list(5).map(item=>({id:item.id,status:item.status,providerId:item.providerId,modelName:item.modelName,score:item.score,grade:item.grade,createdAt:item.createdAt,completedAt:item.completedAt}))}
    };
  }

  return{runtime,config,qualifications,budget,observer,benchmarks,execution,recordQualification,readiness,capture,authorize,commitAction,releaseAction,status};
}
