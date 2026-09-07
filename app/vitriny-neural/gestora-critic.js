const HIGH_RISK=new Set(['payments','security','credentials','destructive-db','production-deploy','permissions']);

function clamp(v,min=0,max=1){return Math.max(min,Math.min(max,Number(v)||0));}
function safeText(v,max=1200){const s=String(v??'').trim();if(!s||s.length>max)throw new Error('Texto de crítica inválido.');return s;}

export function createGestoraCritic({minimumSample=300,autoApproveConfidence=.95,experimentConfidence=.70}={}){
  function review(input={}){
    const domain=String(input.domain||'').trim();
    const hypothesis=safeText(input.hypothesis);
    const confidence=clamp(input.confidence);
    const reward=Math.max(-1,Math.min(1,Number(input.reward)||0));
    const sampleSize=Math.max(0,Number(input.sampleSize)||0);
    const risk=String(input.risk||'review').trim();
    const blockers=[];
    if(HIGH_RISK.has(risk))blockers.push('high_risk_domain');
    if(sampleSize<minimumSample)blockers.push('insufficient_sample');
    if(reward<=0)blockers.push('non_positive_reward');
    if(confidence<experimentConfidence)blockers.push('low_confidence');

    let decision='human_review';
    if(reward<0)decision='reject_or_rollback';
    else if(blockers.includes('high_risk_domain'))decision='human_review';
    else if(sampleSize>=minimumSample&&confidence>=autoApproveConfidence&&reward>0&&risk==='low')decision='auto_approve_low_risk';
    else if(sampleSize>=minimumSample&&confidence>=experimentConfidence&&reward>0)decision='controlled_experiment';

    return {
      domain,hypothesis,reward,confidence,sampleSize,risk,decision,blockers,
      requiresHuman:decision==='human_review'||decision==='reject_or_rollback',
      mayAutoApprove:decision==='auto_approve_low_risk'
    };
  }
  return {review,policy:{minimumSample,autoApproveConfidence,experimentConfidence,highRisk:[...HIGH_RISK]}};
}
