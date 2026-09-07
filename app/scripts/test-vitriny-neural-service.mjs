import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createVitrinyNeuralService} from '../vitriny-neural/service.js';

const provider={
  id:'service-model',priority:1,local:true,costClass:'test',
  capabilities:['code.analyze','research.verify','growth.diagnose','commerce.catalog-review','support.draft-reply','ranking.evaluate'],
  available:async()=>true,invoke:async({capability})=>({text:`ok ${capability}`,model:'service-fixture'})
};

const disabledDb=new Database(':memory:');
try{
  const disabled=createVitrinyNeuralService({db:disabledDb,providers:[provider],env:{}});
  assert.equal(disabled.status().service.enabled,false);
  assert.equal(disabled.capture({type:'content.view',source:'vitrine-social',payload:{watchSeconds:1}}).accepted,false);
}finally{disabledDb.close();}

let clock=Date.parse('2026-09-07T12:00:00.000Z');
const now=()=>clock++;
const db=new Database(':memory:');
try{
  const service=createVitrinyNeuralService({
    db,providers:[provider],now,
    env:{VITRINY_NEURAL_ENABLED:'1',VITRINY_NEURAL_MODE:'low_risk_auto',VITRINY_NEURAL_MAX_DAILY_AUTO_ACTIONS:'2',VITRINY_NEURAL_AUTO_CONFIDENCE:'0.95'}
  });
  assert.equal(service.readiness().readyForShadow,true);
  assert.equal(service.readiness().readyForAdvisory,false);

  const strongReport={score:.93,categories:{safety:{score:.98},code:{score:.90},research:{score:.92},growth:{score:.88},commerce:{score:.84},support:{score:.90},ranking:{score:.89}}};
  const strong=service.recordQualification({modelName:'fixture-strong',suite:'service-test',report:strongReport});
  assert.equal(strong.productionEligible,true);
  assert.equal(service.readiness().readyForLowRiskAuto,true);

  const first=service.authorize({actionKey:'rank:home:exp-1',domain:'ranking',capability:'ranking.evaluate',risk:'low',confidence:.98,reversible:true,verified:true,weightChange:.01});
  assert.equal(first.execute,true);assert.equal(first.reservation.ok,true);
  assert.equal(service.commitAction(first.reservation.id).ok,true);

  const second=service.authorize({actionKey:'growth:cta:exp-2',domain:'growth',capability:'growth.diagnose',risk:'low',confidence:.99,reversible:true,verified:true,weightChange:.01});
  assert.equal(second.execute,true);assert.equal(second.reservation.ok,true);
  assert.equal(service.status().actionBudget.used,2);

  const third=service.authorize({actionKey:'rank:search:exp-3',domain:'ranking',capability:'ranking.evaluate',risk:'low',confidence:.99,reversible:true,verified:true,weightChange:.01});
  assert.equal(third.execute,false);assert.equal(third.reason,'daily_budget_exhausted');

  const duplicate=service.authorize({actionKey:'growth:cta:exp-2',domain:'growth',capability:'growth.diagnose',risk:'low',confidence:.99,reversible:true,verified:true,weightChange:.01});
  assert.equal(duplicate.execute,false);assert.equal(duplicate.reason,'duplicate_action');

  const payment=service.authorize({actionKey:'pay:test',domain:'commerce',risk:'payments',confidence:1,reversible:true,verified:true});
  assert.equal(payment.execute,false);assert.equal(payment.reason,'high_risk');assert.equal(payment.requiresHuman,true);

  assert.equal(service.releaseAction(second.reservation.id).ok,true);
  assert.equal(service.status().actionBudget.used,1);

  const weakCodeReport={score:.86,categories:{safety:{score:.96},code:{score:.30},research:{score:.90},growth:{score:.80},commerce:{score:.80},support:{score:.82},ranking:{score:.82}}};
  const weak=service.recordQualification({modelName:'fixture-weak-code',suite:'service-test-2',report:weakCodeReport});
  assert.equal(weak.productionEligible,true);
  assert.equal(weak.qualification.allowedCapabilities.includes('code.analyze'),false);
  const codeBlocked=service.authorize({actionKey:'code:auto:1',domain:'code',capability:'code.analyze',risk:'low',confidence:.99,reversible:true,verified:true});
  assert.equal(codeBlocked.execute,false);assert.equal(codeBlocked.reason,'capability_not_qualified');

  const captured=service.capture({type:'content.view',source:'vitrine-social',entityType:'post',entityId:'p1',actorId:'u1',dedupeKey:'svc:view:1',payload:{watchSeconds:20,completed:true,message:'private'}});
  assert.equal(captured.accepted,true);
  const payload=JSON.parse(db.prepare('SELECT payload_json FROM neural_events WHERE id=?').get(captured.id).payload_json);
  assert.equal('message' in payload,false);
  assert.equal(typeof payload.actorHash,'string');

  console.log(JSON.stringify({ok:true,readiness:service.readiness(),budget:service.status().actionBudget,qualifications:service.qualifications.list({providerId:'service-model'}).length}));
}finally{db.close();}
