import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import Database from 'better-sqlite3';
import {createNeuralConfig} from '../vitriny-neural/config.js';
import {setupVitrinyNeural} from '../vitriny-neural/server-integration.js';

const env={VITRINY_NEURAL_ENABLED:'1',VITRINY_NEURAL_MODE:'shadow',VITRINY_NEURAL_PSEUDONYM_SALT:'isolated-test-pseudonym-salt'};
const logger={info(){},warn(){},error(){}};
const event={type:'spatial.aggregate',source:'spatial',entityType:'runtime',entityId:'multiverse-render',payload:{renderSamples:4,fpsPoor:1,fpsConstrained:1,fpsGood:1,fpsExcellent:1,windowMinutes:30,channel:'spatial-render'},occurredAt:'2026-09-10T13:00:00Z'};
function fixture(extra={}) {
  const db=new Database(':memory:'),app=express();
  db.exec('CREATE TABLE ecosystem_policy(id INTEGER PRIMARY KEY,enabled INTEGER,paused INTEGER); INSERT INTO ecosystem_policy VALUES(1,1,0)');
  const integration=setupVitrinyNeural({app,db,env:{...env,...extra},logger,
    fetchImpl:async()=>{throw Error('Network calls are forbidden in this test');},
    requireAdmin(req,res,next){if(req.headers['x-test-admin']!=='yes')return res.sendStatus(401);next();},
    sameOriginOnly(_req,_res,next){next();}});
  return {db,app,integration,close(){integration.stop();db.close();}};
}
test('spatial event processing needs both global enablement and explicit opt-in',()=>{
  assert.equal(createNeuralConfig({env}).spatialEventsEnabled,false);
  assert.equal(createNeuralConfig({env:{...env,VITRINY_NEURAL_SPATIAL_EVENTS_ENABLED:'true'}}).spatialEventsEnabled,true);
  assert.equal(createNeuralConfig({env:{VITRINY_NEURAL_SPATIAL_EVENTS_ENABLED:'1'}}).spatialEventsEnabled,false);
  assert.equal(createNeuralConfig({env:{...env,VITRINY_NEURAL_MODE:'disabled',VITRINY_NEURAL_SPATIAL_EVENTS_ENABLED:'1'}}).spatialEventsEnabled,false);
});
test('default production configuration preserves pending events and attempts',()=>{
  const f=fixture();
  try {
    const id=f.integration.capture(event).id;
    const before=f.db.prepare('SELECT * FROM neural_events WHERE id=?').get(id);
    assert.equal(f.integration.status().spatialEvents.enabled,false);
    assert.equal(f.integration.status().spatialEvents.running,false);
    f.integration.service.spatialEvents.tick();
    assert.deepEqual(f.db.prepare('SELECT * FROM neural_events WHERE id=?').get(id),before);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM neural_signals').get().n,0);
  } finally {f.close();}
});
test('opt-in processes observations only, keeps shadow gates and stops its timer',()=>{
  const f=fixture({VITRINY_NEURAL_SPATIAL_EVENTS_ENABLED:'1'});
  try {
    assert.equal(f.integration.status().spatialEvents.running,true);
    assert.equal(f.integration.service.spatialEvents.start(),false);
    const id=f.integration.capture(event).id;
    f.integration.service.spatialEvents.tick();
    assert.equal(f.db.prepare('SELECT status FROM neural_events WHERE id=?').get(id).status,'processed');
    assert.ok(f.db.prepare('SELECT COUNT(*) n FROM neural_signals').get().n>0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM neural_lessons').get().n,0);
    assert.equal(f.integration.status().spatialEvents.automaticLearning,false);
    assert.equal(f.integration.service.authorize({domain:'ranking',risk:'low',verified:true,reversible:true,confidence:1}).execute,false);
    assert.equal(f.integration.status().actionBudget.used,0);
    assert.equal(f.integration.status().qualification,null);
    assert.equal(f.integration.status().service.mode,'shadow');
    f.integration.stop();
    assert.equal(f.integration.status().spatialEvents.running,false);
  } finally {f.close();}
});
test('processor status remains on the authenticated no-store status endpoint',async()=>{
  const f=fixture();
  const server=await new Promise(resolve=>{const s=f.app.listen(0,'127.0.0.1',()=>resolve(s));});
  try {
    const url=`http://127.0.0.1:${server.address().port}/api/admin/vitriny-neural/status`;
    assert.equal((await fetch(url)).status,401);
    const r=await fetch(url,{headers:{'x-test-admin':'yes'}});
    assert.equal(r.status,200);
    assert.equal(r.headers.get('cache-control'),'no-store');
    const state=await r.json();
    assert.equal(state.spatialEvents.enabled,false);
    assert.equal(state.spatialEvents.automaticLearning,false);
  } finally {await new Promise(resolve=>server.close(resolve));f.close();}
});

test('global pause, disabled Central and missing policy block consumption without using attempts',()=>{
  const f=fixture({VITRINY_NEURAL_SPATIAL_EVENTS_ENABLED:'1'});
  try {
    const id=f.integration.capture(event).id;
    const before=f.db.prepare('SELECT * FROM neural_events WHERE id=?').get(id);
    for(const sql of ['UPDATE ecosystem_policy SET paused=1','UPDATE ecosystem_policy SET paused=0,enabled=0','DELETE FROM ecosystem_policy','DROP TABLE ecosystem_policy']){
      f.db.exec(sql);
      assert.equal(f.integration.status().spatialEvents.paused,true);
      assert.equal(f.integration.service.spatialEvents.tick().skipped,true);
      assert.deepEqual(f.db.prepare('SELECT * FROM neural_events WHERE id=?').get(id),before);
      assert.equal(f.db.prepare('SELECT COUNT(*) n FROM neural_signals').get().n,0);
    }
  } finally {f.close();}
});
