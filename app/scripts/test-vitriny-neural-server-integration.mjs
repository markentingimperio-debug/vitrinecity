import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import {setupVitrinyNeural} from '../vitriny-neural/server-integration.js';

const db=new Database(':memory:');
const app=express();app.use(express.json({limit:'128kb'}));
const provider={
  id:'integration-model',priority:1,local:true,costClass:'test',
  capabilities:['code.analyze','research.verify','growth.diagnose','commerce.catalog-review','support.draft-reply','ranking.evaluate'],
  available:async()=>true,invoke:async({capability})=>({text:`ok ${capability}`,model:'integration-fixture'})
};
const env={VITRINY_NEURAL_ENABLED:'1',VITRINY_NEURAL_MODE:'low_risk_auto',VITRINY_NEURAL_MAX_DAILY_AUTO_ACTIONS:'1',VITRINY_NEURAL_AUTO_CONFIDENCE:'0.95'};
const logger={info(){},warn(){},error(){}};
const integration=setupVitrinyNeural({
  app,db,env,logger,
  requireAdmin(req,_res,next){req.user={id:1};next();},
  sameOriginOnly(_req,_res,next){next();}
});
// Override providers for deterministic integration test while preserving the mounted service.
for(const item of integration.service.runtime.skills.status().providers){void item;}
integration.service.runtime.skills.registerProvider(provider);

const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const base=`http://127.0.0.1:${server.address().port}`;
async function request(path,{method='GET',body}={}){const r=await fetch(base+path,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return{status:r.status,json:await r.json()};}
try{
  const status=await request('/api/admin/vitriny-neural/status');
  assert.equal(status.status,200);assert.equal(status.json.service.enabled,true);

  const report={score:.94,categories:{safety:{score:.98},code:{score:.90},research:{score:.91},growth:{score:.85},commerce:{score:.82},support:{score:.88},ranking:{score:.87}}};
  const qualified=await request('/api/admin/vitriny-neural/models/qualify',{method:'POST',body:{providerId:'integration-model',modelName:'fixture',suite:'integration',report}});
  assert.equal(qualified.status,200);assert.equal(qualified.json.qualification.productionEligible,true);assert.equal(qualified.json.readiness.readyForLowRiskAuto,true);

  const first=await request('/api/admin/vitriny-neural/policy/decide',{method:'POST',body:{actionKey:'ranking:test:1',domain:'ranking',capability:'ranking.evaluate',risk:'low',confidence:.99,reversible:true,verified:true,weightChange:.01}});
  assert.equal(first.status,200);assert.equal(first.json.decision.execute,true);assert.equal(first.json.decision.reservation.ok,true);

  const second=await request('/api/admin/vitriny-neural/policy/decide',{method:'POST',body:{actionKey:'ranking:test:2',domain:'ranking',capability:'ranking.evaluate',risk:'low',confidence:.99,reversible:true,verified:true,weightChange:.01}});
  assert.equal(second.json.decision.execute,false);assert.equal(second.json.decision.reason,'daily_budget_exhausted');

  const actions=await request('/api/admin/vitriny-neural/actions');assert.equal(actions.json.usage.used,1);
  const committed=await request(`/api/admin/vitriny-neural/actions/${first.json.decision.reservation.id}/commit`,{method:'POST',body:{}});assert.equal(committed.json.result.ok,true);

  const event=await request('/api/admin/vitriny-neural/events',{method:'POST',body:{type:'content.view',entityType:'post',entityId:'p1',actorId:'u1',dedupeKey:'admin:view:1',payload:{watchSeconds:10,completed:true,message:'private'}}});
  assert.equal(event.json.accepted,true);
  const stored=JSON.parse(db.prepare('SELECT payload_json FROM neural_events WHERE id=?').get(event.json.id).payload_json);
  assert.equal(stored.watchSeconds,10);assert.equal('message' in stored,false);assert.equal(typeof stored.actorHash,'string');

  console.log(JSON.stringify({ok:true,service:status.json.service,readiness:qualified.json.readiness,actionBudget:actions.json.usage}));
}finally{await new Promise(resolve=>server.close(resolve));db.close();}
