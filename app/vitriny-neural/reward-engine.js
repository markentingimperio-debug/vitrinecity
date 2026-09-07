const DOMAIN_METRICS=Object.freeze({
  content:{retention:.25,completion:.20,clickRate:.15,conversionRate:.25,shareRate:.10,reportRate:-.25},
  ranking:{ctr:.25,conversionRate:.30,dwellTime:.15,queryReformulationRate:-.15,abandonmentRate:-.20,reportRate:-.20},
  growth:{roas:.30,conversionRate:.25,ctr:.15,cpa:-.20,revenuePerVisit:.20,unsubscribeRate:-.15},
  commerce:{conversionRate:.30,marginRate:.25,revenuePerVisit:.20,refundRate:-.20,stockoutRate:-.15},
  support:{resolutionRate:.35,satisfaction:.30,firstResponseSpeed:.10,reopenRate:-.20,escalationRate:-.10},
  code:{testPassRate:.35,errorRate:-.30,latencyMs:-.15,rollbackRate:-.20,incidentRate:-.30},
  platform:{availability:.30,errorRate:-.30,latencyMs:-.20,conversionRate:.20,complaintRate:-.20}
});

function finite(value){const n=Number(value);return Number.isFinite(n)?n:null;}
function clamp(value,min=-1,max=1){return Math.max(min,Math.min(max,value));}
function relativeDelta(before,after){
  const b=finite(before),a=finite(after);if(b===null||a===null)return null;
  const scale=Math.max(Math.abs(b),1e-9);
  return clamp((a-b)/scale);
}

export function computeNeuralReward(domain,{baseline={},current={},sampleSize=0,minimumSample=100}={}){
  const weights=DOMAIN_METRICS[domain];
  if(!weights)throw new Error(`Domínio sem política de reward: ${domain}`);
  const components=[];let weighted=0,totalWeight=0;
  for(const [metric,weight] of Object.entries(weights)){
    if(!(metric in baseline)||!(metric in current))continue;
    const delta=relativeDelta(baseline[metric],current[metric]);if(delta===null)continue;
    const contribution=delta*weight;
    components.push({metric,weight,baseline:Number(baseline[metric]),current:Number(current[metric]),delta,contribution});
    weighted+=contribution;totalWeight+=Math.abs(weight);
  }
  if(!components.length)throw new Error('Nenhuma métrica comparável para calcular reward.');
  const raw=totalWeight?weighted/totalWeight:0;
  const n=Math.max(0,Number(sampleSize)||0);
  const sampleFactor=clamp(n/Math.max(1,Number(minimumSample)||100),0,1);
  const reward=clamp(raw*sampleFactor);
  const effect=Math.abs(raw);
  const confidence=clamp(.45+Math.min(.35,Math.log10(n+1)/10)+Math.min(.19,effect/2),0,0.99);
  return {domain,reward,confidence,rawReward:raw,sampleSize:n,sampleFactor,components};
}

export const neuralRewardPolicy=Object.freeze({domains:Object.keys(DOMAIN_METRICS),metrics:DOMAIN_METRICS,range:[-1,1]});
