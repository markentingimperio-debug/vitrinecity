import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import {mountJarvis} from '../jarvis-core.js';

const db=new Database(':memory:');
const app=express();
app.use(express.json({limit:'128kb'}));
const env={
  JARVIS_LOCAL_MODEL:'0',
  VITRINY_NEURAL_ENABLED:'1',
  VITRINY_NEURAL_MODE:'shadow',
  VITRINY_NEURAL_PSEUDONYM_SALT:'integration-shadow-salt-2026'
};
const core=mountJarvis({
  app,db,env,researchSchedule:false,
  requireAdmin(req,_res,next){req.user={id:1};next();},
  sameOriginOnly(_req,_res,next){next();}
});

assert.equal(core.neural.enabled,true);
assert.equal(core.neural.service.config.mode,'shadow');
assert.equal(core.neural.service.observer.status().running,true);

const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const base=`http://127.0.0.1:${server.address().port}`;
try{
  const jarvis=await fetch(base+'/api/admin/jarvis/status').then(r=>r.json());
  assert.equal(jarvis.name,'Jarvis');
  const neural=await fetch(base+'/api/admin/vitriny-neural/status').then(r=>r.json());
  assert.equal(neural.service.enabled,true);
  assert.equal(neural.service.mode,'shadow');
  assert.equal(neural.observer.running,true);

  const decision=await fetch(base+'/api/admin/vitriny-neural/policy/decide',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({actionKey:'shadow:test:1',domain:'ranking',capability:'ranking.evaluate',risk:'low',confidence:1,reversible:true,verified:true})
  }).then(r=>r.json());
  assert.equal(decision.decision.execute,false);
  assert.equal(decision.decision.reason,'shadow_mode');

  console.log(JSON.stringify({ok:true,jarvis:jarvis.name,neural:{enabled:neural.service.enabled,mode:neural.service.mode,observer:neural.observer.running},shadowDecision:decision.decision.reason}));
}finally{
  core.neural.stop();
  await new Promise(resolve=>server.close(resolve));
  db.close();
}
