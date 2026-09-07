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

export function createVitrinyNeuralRuntime({db,providers=null,env=process.env,fetchImpl=globalThis.fetch,now=Date.now,nodeId='local',neuralOptions={},criticOptions={},pseudonymSalt='vitriny-neural-v1',config=null}={}){
  if(!db)throw new TypeError('Runtime Neural requer banco SQLite nesta fase.');
  const runtimeConfig=config||createNeuralConfig({env});
  const store=createVitrinyNeuralSqliteStore(db);
  const neural=createVitrinyNeural({store,now,nodeId,...neuralOptions});
  const skills=createSkillRegistry({now});
  for(const skill of [
    createMediaSkill({neural}),createCodeSkill({neural}),createGrowthSkill({neural}),createResearchSkill({neural}),
    createCommerceSkill({neural}),createSupportSkill({neural}),createRankingSkill({neural})
  ])skills.registerSkill(skill);
  const resolvedProviders=Array.isArray(providers)?providers:createEnvModelProviders({env,fetchImpl});
  for(const provider of resolvedProviders)skills.registerProvider(provider);
  const critic=createGestoraCritic(criticOptions);
  const learning=createNeuralLearningLoop({neural,critic});
  const bridge=createPlatformBridge({neural,pseudonymSalt});
  const gate=createNeuralPolicyGate({config:runtimeConfig});
  return {
    neural,skills,critic,learning,bridge,config:runtimeConfig,gate,
    status(){return {neural:neural.status(),skills:skills.status(),critic:critic.policy,bridge:bridge.policy,config:runtimeConfig};}
  };
}
