import {createVitrinyNeural} from './core.js';
import {createVitrinyNeuralSqliteStore} from './sqlite-store.js';
import {createSkillRegistry} from './skills/registry.js';
import {createMediaSkill} from './skills/media.js';
import {createCodeSkill} from './skills/code.js';
import {createGrowthSkill} from './skills/growth.js';
import {createResearchSkill} from './skills/research.js';
import {createCommerceSkill} from './skills/commerce.js';
import {createSupportSkill} from './skills/support.js';
import {createRankingSkill} from './skills/ranking.js';
import {createGestoraCritic} from './gestora-critic.js';
import {createNeuralLearningLoop} from './learning-loop.js';
import {createPlatformBridge} from './platform-bridge.js';
import {createEnvModelProviders} from './providers/from-env.js';
import {createNeuralConfig} from './config.js';
import {createNeuralPolicyGate} from './policy-gate.js';
import {createApprovedPlatformKnowledge} from './approved-platform-knowledge.js';

export function createVitrinyNeuralRuntime({db,providers=null,env=process.env,fetchImpl=globalThis.fetch,now=Date.now,nodeId='local',neuralOptions={},criticOptions={},pseudonymSalt='vitriny-neural-v1',config=null}={}){
  if(!db)throw new TypeError('Runtime Neural requer banco SQLite nesta fase.');
  const runtimeConfig=config||createNeuralConfig({env});
  const store=createVitrinyNeuralSqliteStore(db);
  const neural=createVitrinyNeural({store,now,nodeId,...neuralOptions});
  const knowledge=createApprovedPlatformKnowledge({db,now});
  const skills=createSkillRegistry({now,knowledgeProvider:knowledge.retrieve});
  for(const skill of [
    createMediaSkill({neural}),createCodeSkill({neural}),createGrowthSkill({neural}),createResearchSkill({neural}),
    createCommerceSkill({neural}),createSupportSkill({neural}),createRankingSkill({neural})
  ])skills.registerSkill(skill);
  const resolvedProviders=Array.isArray(providers)?providers:createEnvModelProviders({env,fetchImpl});
  for(const provider of resolvedProviders)skills.registerProvider(provider);
  const critic=createGestoraCritic(criticOptions);
  const gate=createNeuralPolicyGate({config:runtimeConfig});
  const learning=createNeuralLearningLoop({neural,critic,gate});
  const bridge=createPlatformBridge({neural,pseudonymSalt});
  async function probeLocalProviders(){
    const codes=new Set(['provider_model_available','provider_probe_cancelled','provider_probe_timeout','provider_http_error','provider_invalid_response','provider_response_too_large','provider_model_missing','provider_model_not_ready','provider_unreachable']);
    return Promise.all(resolvedProviders.filter(provider=>provider.local===true).map(async provider=>{
      const result={providerId:provider.id,modelName:String(provider.modelName||''),ok:false,reachable:false,modelAvailable:false,code:'provider_probe_unsupported',httpStatus:null,noInference:true};
      if(typeof provider.preflight!=='function')return result;
      try{
        const probe=await provider.preflight({timeoutMs:3000});
        const validSuccess=probe?.ok===true&&probe.reachable===true&&probe.modelAvailable===true&&probe.modelName===result.modelName&&probe.code==='provider_model_available'&&probe.noInference===true;
        return {...result,ok:validSuccess,reachable:probe?.reachable===true,modelAvailable:validSuccess,
          code:probe?.ok===true&&!validSuccess?'provider_invalid_response':codes.has(probe?.code)?probe.code:'provider_invalid_response',
          httpStatus:Number.isInteger(probe?.httpStatus)&&probe.httpStatus>=100&&probe.httpStatus<=599?probe.httpStatus:null};
      }catch{return {...result,code:'provider_unreachable'};}
    }));
  }
  return {
    neural,skills,critic,learning,bridge,knowledge,config:runtimeConfig,gate,probeLocalProviders,
    status(){return {neural:neural.status(),skills:skills.status(),critic:critic.policy,bridge:bridge.policy,knowledge:knowledge.status(),config:runtimeConfig};}
  };
}
