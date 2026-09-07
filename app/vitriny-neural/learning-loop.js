import {computeNeuralReward} from './reward-engine.js';
import {createGestoraCritic} from './gestora-critic.js';

function object(value){return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}
function text(value,max,min=1){const v=String(value??'').trim();if(v.length<min||v.length>max)throw new Error('Texto de aprendizagem inválido.');return v;}

export function createNeuralLearningLoop({neural,critic=createGestoraCritic()}={}){
  if(!neural?.signal||!neural?.lesson)throw new TypeError('Learning loop requer Vitriny Neural.');

  function evaluateExperiment(input={}){
    const domain=text(input.domain,40,2);
    const hypothesis=text(input.hypothesis,1200,12);
    const baseline=object(input.baseline),current=object(input.current);
    const sampleSize=Math.max(0,Number(input.sampleSize)||0);
    const reward=computeNeuralReward(domain,{baseline,current,sampleSize,minimumSample:input.minimumSample||100});
    const risk=String(input.risk||'review');
    const critique=critic.review({domain,hypothesis,reward:reward.reward,confidence:reward.confidence,sampleSize,risk});

    neural.signal({
      metric:`learning.reward.${domain}`,
      dimension:text(input.dimension||'global',180,1),
      value:reward.reward,
      confidence:reward.confidence,
      metadata:{sampleSize,decision:critique.decision,components:reward.components.slice(0,20)}
    });

    const lowRisk=critique.mayAutoApprove===true;
    const lesson=neural.lesson({
      domain,
      hypothesis,
      evidence:{baseline,current,sampleSize,reward,critique,context:object(input.context)},
      reward:reward.reward,
      confidence:reward.confidence,
      sourceEventCount:sampleSize,
      verified:lowRisk,
      lowRisk
    });
    return {reward,critique,lesson};
  }

  return {evaluateExperiment,critic};
}
