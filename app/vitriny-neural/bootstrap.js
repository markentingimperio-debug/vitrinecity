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

export function createVitrinyNeuralRuntime({db,providers=[],now=Date.now,nodeId='local',neuralOptions={},criticOptions={},pseudonymSalt='vitriny-neural-v1'}={}){
  if(!db)throw new TypeError('Runtime Neural requer banco SQLite nesta fase.');
  const store=createVitrinyNeuralSqliteStore(db);
  const neural=createVitrinyNeural({store,now,nodeId,...neuralOptions});
  const skills=createSkillRegistry({now});
  for(const skill of [
    createMediaSkill({neural}),createCodeSkill({neural}),createGrowthSkill({neural}),createResearchSkill({neural}),
    createCommerceSkill({neural}),createSupportSkill({neural}),createRankingSkill({neural})
  ])skills.registerSkill(skill);
  for(const provider of providers)skills.registerProvider(provider);
  const critic=createGestoraCritic(criticOptions);
  const learning=createNeuralLearningLoop({neural,critic});
  const bridge=createPlatformBridge({neural,pseudonymSalt});
  return {
    neural,skills,critic,learning,bridge,
    status(){return {neural:neural.status(),skills:skills.status(),critic:critic.policy,bridge:bridge.policy};}
  };
}
