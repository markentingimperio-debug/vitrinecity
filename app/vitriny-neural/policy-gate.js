const HIGH_RISK=new Set(['payments','security','credentials','destructive-db','production-deploy','permissions']);

function confidence(value){const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):0;}

export function createNeuralPolicyGate({config}={}){
  if(!config)throw new TypeError('Policy gate requer config.');
  function decide(proposal={}){
    const risk=String(proposal.risk||'review');
    const c=confidence(proposal.confidence);
    const reversible=proposal.reversible===true;
    const verified=proposal.verified===true;
    const financial=proposal.financial===true||risk==='payments';
    const destructive=proposal.destructive===true||risk==='destructive-db'||risk==='production-deploy';
    const highRisk=HIGH_RISK.has(risk)||financial||destructive;

    if(!config.enabled||config.mode==='disabled')return{decision:'blocked',execute:false,reason:'neural_disabled',requiresHuman:false};
    if(highRisk)return{decision:'human_review',execute:false,reason:'high_risk',requiresHuman:true};
    if(config.mode==='shadow')return{decision:'shadow_only',execute:false,reason:'shadow_mode',requiresHuman:false};
    if(config.mode==='advisory')return{decision:'recommend_only',execute:false,reason:'advisory_mode',requiresHuman:false};
    if(config.mode!=='low_risk_auto')return{decision:'blocked',execute:false,reason:'unsupported_mode',requiresHuman:false};
    if(risk!=='low')return{decision:'human_review',execute:false,reason:'risk_not_low',requiresHuman:true};
    if(!reversible)return{decision:'human_review',execute:false,reason:'not_reversible',requiresHuman:true};
    if(!verified)return{decision:'human_review',execute:false,reason:'not_verified',requiresHuman:true};
    if(c<config.autoConfidence)return{decision:'human_review',execute:false,reason:'confidence_below_threshold',requiresHuman:true};
    if(Number(proposal.weightChange||0)>config.maxAutoWeightChange)return{decision:'human_review',execute:false,reason:'change_too_large',requiresHuman:true};
    return{decision:'auto_execute_low_risk',execute:true,reason:'policy_passed',requiresHuman:false};
  }
  return{decide};
}
