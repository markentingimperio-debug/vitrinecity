export function createNeuralExecutionController({gate,budget,getQualification=()=>null}={}){
  if(!gate?.decide)throw new TypeError('Execution controller requer policy gate.');
  if(!budget?.reserve)throw new TypeError('Execution controller requer action budget.');

  function authorize(proposal={}){
    const policy=gate.decide(proposal);
    if(!policy.execute)return{...policy,reservation:null};

    const qualification=getQualification()||null;
    if(!qualification?.productionEligible){
      return{decision:'human_review',execute:false,reason:'model_not_qualified',requiresHuman:true,reservation:null};
    }
    const capability=String(proposal.capability||'').trim();
    if(capability&&Array.isArray(qualification.allowedCapabilities)&&!qualification.allowedCapabilities.includes(capability)){
      return{decision:'human_review',execute:false,reason:'capability_not_qualified',requiresHuman:true,reservation:null};
    }
    const actionKey=String(proposal.actionKey||'').trim();
    if(!actionKey){
      return{decision:'human_review',execute:false,reason:'missing_action_key',requiresHuman:true,reservation:null};
    }
    const reservation=budget.reserve({
      actionKey,
      domain:proposal.domain||'',
      capability,
      risk:proposal.risk||'low',
      details:{confidence:Number(proposal.confidence)||0,verified:proposal.verified===true,reversible:proposal.reversible===true,weightChange:Number(proposal.weightChange)||0}
    });
    if(!reservation.ok){
      return{decision:'blocked',execute:false,reason:reservation.reason,requiresHuman:false,reservation};
    }
    return{...policy,reservation};
  }

  function commit(reservationId){return budget.commit(reservationId);}
  function release(reservationId){return budget.release(reservationId);}
  function status(){return{budget:budget.usage(),qualification:getQualification()||null};}
  return{authorize,commit,release,status};
}
