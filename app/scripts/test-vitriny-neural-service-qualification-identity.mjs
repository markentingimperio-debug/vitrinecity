import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createVitrinyNeuralService} from '../vitriny-neural/service.js';

const env={VITRINY_NEURAL_ENABLED:'1',VITRINY_NEURAL_MODE:'low_risk_auto'};
const strong={score:.99,categories:Object.fromEntries(['safety','code','research','growth','commerce','support','ranking'].map(name=>[name,{score:.99}]))};
const proposal={actionKey:'identity:ranking',domain:'ranking',capability:'ranking.evaluate',risk:'low',confidence:.99,reversible:true,verified:true,weightChange:.01};
function provider(modelName,id='identity-model'){
  const calls=[];
  return {id,modelName,local:true,priority:1,capabilities:['code.analyze','ranking.evaluate'],calls,
    invoke:async input=>{calls.push(input);return {text:'Rascunho para revisão.',model:modelName};}};
}
function fixture(db,providers){let clock=Date.parse('2026-09-14T12:00:00.000Z');return createVitrinyNeuralService({db,providers,env,now:()=>clock++});}

test('restarting the same provider with another model cannot inherit policy, readiness or execution approval',async()=>{
  const db=new Database(':memory:');
  try{
    const before=fixture(db,[provider('model-a')]);
    before.recordQualification({modelName:'model-a',report:strong});
    assert.equal(before.readiness().readyForLowRiskAuto,true);
    const changed=provider('model-b'),after=fixture(db,[changed]);
    const policy=after.runtime.skills.status().providers[0].policy;
    assert.equal(policy.enabled,false);assert.deepEqual(policy.allowedCapabilities,[]);
    assert.equal(after.status().qualification,null);
    assert.equal(after.readiness().readyForAdvisory,false);assert.equal(after.readiness().readyForLowRiskAuto,false);
    assert.equal(after.authorize(proposal).execute,false);
    await assert.rejects(after.runtime.skills.run('code.engineer',{task:'Analise este módulo.'}));
    assert.equal(changed.calls.length,0);
    const evaluation=await after.runtime.skills.run('code.engineer',{task:'Avalie apenas este rascunho.'},{evaluation:true});
    assert.equal(evaluation.provider,changed.id);assert.equal(changed.calls.length,1);
    assert.equal(after.runtime.skills.status().providers[0].policy.enabled,false);
    assert.equal(after.qualifications.latest(changed.id).modelName,'model-a');
  }finally{db.close();}
});

test('saving a different or missing alias never enables the configured model, including after an earlier match',()=>{
  const db=new Database(':memory:');
  try{
    const service=fixture(db,[provider('configured-model')]);
    for(const modelName of ['other-model','', 'configured-model', 'other-model']){
      service.recordQualification({modelName,report:strong});
      const matches=modelName==='configured-model',status=service.status();
      assert.equal(status.skills.providers[0].policy.enabled,matches,modelName);
      assert.equal(status.readiness.readyForLowRiskAuto,matches,modelName);
      assert.equal(status.qualification?.modelName??null,matches?modelName:null);
      const decision=service.authorize({...proposal,actionKey:'identity:'+ (modelName||'empty')});
      assert.equal(decision.execute,matches,modelName);
      if(decision.reservation?.id)service.releaseAction(decision.reservation.id);
    }
  }finally{db.close();}
});

test('matching model qualification is restored and a weak matching report remains blocked',()=>{
  const db=new Database(':memory:');
  try{
    const first=fixture(db,[provider('same-model')]);first.recordQualification({modelName:'same-model',report:strong});
    const restored=fixture(db,[provider('same-model')]);
    assert.equal(restored.runtime.skills.status().providers[0].policy.source,'persisted_qualification');
    assert.equal(restored.readiness().readyForLowRiskAuto,true);
    restored.recordQualification({modelName:'same-model',report:{score:.1,categories:{safety:{score:.1}}}});
    assert.equal(restored.runtime.skills.status().providers[0].policy.enabled,false);
    assert.equal(restored.readiness().readyForLowRiskAuto,false);
    assert.equal(restored.status().qualification.modelName,'same-model');
    assert.equal(restored.status().qualification.productionEligible,false);
    assert.equal(restored.authorize(proposal).execute,false);
  }finally{db.close();}
});

test('a record for another provider cannot qualify a different provider sharing its model alias',()=>{
  const db=new Database(':memory:');
  try{
    const first=fixture(db,[provider('shared-model','provider-before')]);
    first.recordQualification({modelName:'shared-model',report:strong});
    const after=fixture(db,[provider('shared-model','provider-after')]);
    assert.equal(after.status().qualification,null);
    assert.equal(after.readiness().readyForLowRiskAuto,false);
    assert.equal(after.authorize(proposal).execute,false);
    assert.equal(after.qualifications.latest('provider-before').modelName,'shared-model');
    assert.equal(after.qualifications.latest('provider-after'),null);
  }finally{db.close();}
});

test('unnamed generic adapters preserve legacy service qualification, without granting task model identity',()=>{
  const db=new Database(':memory:');
  try{
    const adapter=provider(undefined),service=fixture(db,[adapter]);
    service.recordQualification({modelName:'legacy-fixture-label',report:strong});
    assert.equal(service.readiness().readyForLowRiskAuto,true);
    const restored=fixture(db,[adapter]);
    assert.equal(restored.status().qualification.modelName,'legacy-fixture-label');
    assert.equal(restored.runtime.skills.status().providers[0].modelName,'');
    assert.equal(restored.runtime.skills.status().providers[0].policy.enabled,true);
  }finally{db.close();}
});
