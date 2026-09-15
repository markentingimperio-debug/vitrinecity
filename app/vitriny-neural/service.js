import {createVitrinyNeuralRuntime} from './bootstrap.js';
import {createNeuralConfig} from './config.js';
import {qualifyModel} from './provider-qualification.js';
import {createQualificationStore} from './qualification-store.js';
import {createNeuralActionBudget} from './action-budget.js';
import {createNeuralExecutionController} from './execution-controller.js';
import {assessNeuralReadiness} from './readiness.js';
import {createShadowObserver} from './shadow-observer.js';
import {createNeuralBenchmarkManager} from './benchmark-manager.js';
import {createNeuralWebResearchEngine} from './web-research-engine.js';
import {createNeuralDatasetBuilder} from './dataset-builder.js';
import {createAstraSupervisor} from './astra-supervisor.js';
import {createNeuralTaskEngine} from './task-engine.js';
import {createNeuralBilling} from './billing.js';
import {createNeuralTaskDiagnostics} from './task-diagnostics.js';
import {createNeuralChatEngine} from './chat-engine.js';
import path from 'node:path';
import {createCoinAiWalletAdapter} from './coin-wallet-adapter.js';
import {createChatArtifacts} from './chat-artifacts.js';
import {createPaidChatRuntime} from './paid-chat-runtime.js';
import {createReviewedTeachingKnowledge} from './reviewed-teaching-knowledge.js';
import {createLiaCuratedKnowledge} from './lia-curated-knowledge.js';

function primaryProviderId(runtime){const providers=runtime.skills.status().providers||[];return providers.find(provider=>provider.policy?.enabled!==false)?.id||providers[0]?.id||null;}
function qualificationMatchesProvider(provider,record){
  // Generic adapters without a configured model keep legacy provider-level
  // qualifications. Named model adapters must match the exact recorded alias;
  // task execution independently requires a nonempty, matching model identity.
  return Boolean(provider&&record&&record.providerId===provider.id&&(!provider.modelName||record.modelName===provider.modelName));
}

export function createVitrinyNeuralService({db,coinWallet,env=process.env,fetchImpl=globalThis.fetch,now=Date.now,nodeId='service',providers=null,pseudonymSalt='vitriny-neural-v1',logger=console}={}){
  if(!db)throw new TypeError('Vitriny Neural service requer banco.');
  const config=createNeuralConfig({env});
  const runtime=createVitrinyNeuralRuntime({db,env,fetchImpl,now,nodeId,providers,pseudonymSalt,config});
  const qualifications=createQualificationStore(db);
  const budget=createNeuralActionBudget({db,now,limit:config.maxDailyAutoActions});
  const observer=createShadowObserver({db,neural:runtime.neural,now,intervalMs:config.observerIntervalMs,logger,onSample:()=>supervisor.tick()});

  function applyQualificationPolicy(providerId,record,source='qualification'){
    if(!runtime.skills.setProviderPolicy||!record?.qualification)return null;
    const provider=runtime.skills.status().providers.find(item=>item.id===providerId);
    const matches=qualificationMatchesProvider(provider,record),qualification=record.qualification;
    return runtime.skills.setProviderPolicy(providerId,{enabled:matches&&qualification.productionEligible===true,allowedCapabilities:matches?qualification.allowedCapabilities||[]:[],source:matches?source:'qualification_model_mismatch'});
  }
  for(const provider of runtime.skills.status().providers){
    const saved=qualifications.latest(provider.id);
    if(saved?.qualification)applyQualificationPolicy(provider.id,saved,'persisted_qualification');
  }

  function activeQualificationRecord(){
    const providerId=primaryProviderId(runtime);
    if(!providerId)return null;
    const provider=runtime.skills.status().providers.find(item=>item.id===providerId),record=qualifications.latest(providerId);
    return qualificationMatchesProvider(provider,record)?record:null;
  }
  function activeQualification(){return activeQualificationRecord()?.qualification||null;}

  const execution=createNeuralExecutionController({gate:runtime.gate,budget,getQualification:activeQualification});

  function recordQualification({providerId=primaryProviderId(runtime),modelName='',suite='',report}={}){
    if(!providerId)throw new Error('Nenhum provider Neural disponível para qualificação.');
    const qualification=qualifyModel(report,{thresholds:{overall:config.benchmarkMinScore,safety:config.benchmarkMinSafety}});
    const saved=qualifications.save({providerId,modelName,suite,report,qualification,at:new Date(Number(now())).toISOString()});
    applyQualificationPolicy(providerId,saved,'semantic_benchmark');
    return saved;
  }

  const benchmarks=createNeuralBenchmarkManager({db,env,fetchImpl,now,recordQualification,logger});
  const webResearch=createNeuralWebResearchEngine({db,neural:runtime.neural,env,fetchImpl,now,logger});
  const training=createNeuralDatasetBuilder({db,now,nodeId});
  const supervisor=createAstraSupervisor({db,neural:runtime.neural,knowledge:runtime.knowledge,env,fetchImpl,now,getEvaluation:()=>{
    const q=activeQualificationRecord();
    // Only public model identifiers and aggregate scores. Reports contain raw
    // model outputs and are deliberately excluded from supervisory context.
    const b=db.prepare('SELECT provider_id,model_name,suite,status,total,passed,failed,score,created_at,completed_at FROM neural_benchmark_runs ORDER BY created_at DESC,id DESC LIMIT 1').get();
    return {skills:runtime.skills.status().skills.map(item=>item.id),
      qualification:q?{providerId:q.providerId,modelName:q.modelName,suite:q.suite,score:q.score,safetyScore:q.safetyScore,productionEligible:q.productionEligible,createdAt:q.createdAt}:null,
      benchmark:b?{providerId:b.provider_id,modelName:b.model_name,suite:b.suite,status:b.status,total:b.total,passed:b.passed,failed:b.failed,score:b.score,createdAt:b.created_at,completedAt:b.completed_at}:null};
  },canRun:()=>{
    if(!config.enabled)return false;
    const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ecosystem_policy'").get();
    return !exists||db.prepare('SELECT paused FROM ecosystem_policy WHERE id=1').get()?.paused===0;
  }});
  const billing=createNeuralBilling({db,env,now});
  const tasks=createNeuralTaskEngine({db,skills:runtime.skills,qualifications,config,billing,env,now});
  // Separate opt-in from the local-model shadow policy and legacy plan credits.
  // No production balance, policy, or recurring task is inferred from an API key.
  const paidEnabled=env.VITRINY_NEURAL_PAID_ENABLED==='true'&&coinWallet?.enabled===true;
  const paidWallet=coinWallet?.enabled===true?createCoinAiWalletAdapter({db,coinWallet,now,adminEmails:String(env.ADMIN_EMAILS||'').split(',')}):null;
  const paidArtifacts=paidEnabled?createChatArtifacts({db,now,directory:path.resolve(env.DATA_DIR||path.dirname(db.name),'neural-private-artifacts')}):null;
  let reviewedKnowledgeProvider=null;
  if(paidEnabled){
    const readers=[];
    try{readers.push(createReviewedTeachingKnowledge({db,now}).retrieve);}catch{/* Optional public reference cannot disable the chat. */}
    try{readers.push(createLiaCuratedKnowledge({db,now}).retrieve);}catch{/* Curated knowledge is optional and fail-closed. */}
    if(readers.length)reviewedKnowledgeProvider=query=>readers.flatMap(reader=>{try{return reader(query)||[];}catch{return[];}}).slice(0,2).map((item,index)=>({...item,citation:`LK${index+1}`}));
  }
  const paidChat=paidEnabled?createPaidChatRuntime({db,env,wallet:paidWallet,artifacts:paidArtifacts,fetchImpl,now,authorizeScope:scope=>paidWallet.allowsScope(scope),reviewedKnowledgeProvider}):null;
  const chat=createNeuralChatEngine({db,skills:runtime.skills,qualifications,config,env,now,paidRuntime:paidChat});
  const taskDiagnostics=createNeuralTaskDiagnostics({probeLocalProviders:runtime.probeLocalProviders,
    getProviders:()=>runtime.skills.status().providers,getQualification:qualifications.latest,getTaskStatus:()=>tasks.status('admin',{reapExpired:false}),now});

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
      webResearch:webResearch.status(),
      training:training.status(),
      supervisor:supervisor.status(),
      tasks:tasks.status('admin'),
      benchmark:{activeId:benchmarks.status().activeId,recent:benchmarks.list(5).map(item=>({id:item.id,status:item.status,providerId:item.providerId,modelName:item.modelName,score:item.score,grade:item.grade,createdAt:item.createdAt,completedAt:item.completedAt}))}
    };
  }

  return{runtime,config,qualifications,budget,observer,benchmarks,webResearch,training,supervisor,tasks,chat,billing,paidWallet,paidArtifacts,paidChat,taskDiagnostics,execution,recordQualification,readiness,capture,authorize,commitAction,releaseAction,status};
}
