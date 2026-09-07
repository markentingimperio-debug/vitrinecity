import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createVitrinyNeuralRuntime} from '../vitriny-neural/bootstrap.js';

let clock=Date.parse('2026-09-07T03:30:00.000Z');
const db=new Database(':memory:');
const runtime=createVitrinyNeuralRuntime({db,nodeId:'learning-test',now:()=>clock++,pseudonymSalt:'test-salt'});

try{
  const captured=runtime.bridge.capture({
    type:'content.view',source:'vitrine-social',entityType:'post',entityId:'p42',actorId:'user-123',
    dedupeKey:'bridge:view:p42:u123',payload:{watchSeconds:42,completed:true,message:'dado privado que deve ser removido',unknownField:'x'}
  });
  assert.equal(captured.accepted,true);
  const row=db.prepare('SELECT payload_json FROM neural_events WHERE id=?').get(captured.id);
  const payload=JSON.parse(row.payload_json);
  assert.equal(payload.watchSeconds,42);
  assert.equal(payload.completed,true);
  assert.equal(typeof payload.actorHash,'string');
  assert.equal(payload.actorHash.length,24);
  assert.equal('message' in payload,false);
  assert.equal('unknownField' in payload,false);

  let badType=false;
  try{runtime.bridge.capture({type:'user.private-message',source:'vitrine-social',payload:{}});}catch{badType=true;}
  assert.equal(badType,true);

  const strong=runtime.learning.evaluateExperiment({
    domain:'ranking',hypothesis:'Dobrar CTR em experimento offline sem piorar sinais de qualidade.',risk:'low',sampleSize:10000,
    baseline:{ctr:.05,reportRate:.01},current:{ctr:.10,reportRate:.01},dimension:'feed:home'
  });
  assert.equal(strong.critique.decision,'auto_approve_low_risk');
  assert.equal(strong.lesson.status,'approved');
  assert.equal(strong.reward.reward>0,true);

  const payment=runtime.learning.evaluateExperiment({
    domain:'commerce',hypothesis:'Mudança comercial ligada a pagamentos deve permanecer sob revisão humana.',risk:'payments',sampleSize:20000,
    baseline:{conversionRate:.02,refundRate:.02},current:{conversionRate:.04,refundRate:.02},dimension:'checkout'
  });
  assert.equal(payment.critique.requiresHuman,true);
  assert.equal(payment.lesson.status,'candidate');

  const negative=runtime.learning.evaluateExperiment({
    domain:'content',hypothesis:'Formato que reduz retenção deve ser rejeitado ou revertido.',risk:'low',sampleSize:5000,
    baseline:{retention:.70,reportRate:.01},current:{retention:.35,reportRate:.02},dimension:'format:test'
  });
  assert.equal(negative.reward.reward<0,true);
  assert.equal(negative.critique.decision,'reject_or_rollback');
  assert.equal(negative.lesson.status,'candidate');

  const status=runtime.status();
  assert.equal(status.neural.name,'Vitriny Neural');
  assert.equal(status.bridge.rawPersonalData,false);
  assert.equal(status.critic.highRisk.includes('payments'),true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM neural_lessons WHERE status='approved'").get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM neural_lessons WHERE status='candidate'").get().n,2);
  console.log(JSON.stringify({ok:true,learning:{strong:strong.critique.decision,payment:payment.critique.decision,negative:negative.critique.decision},status}));
}finally{db.close();}
