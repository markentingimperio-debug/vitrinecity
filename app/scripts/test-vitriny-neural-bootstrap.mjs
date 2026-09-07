import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createVitrinyNeuralRuntime} from '../vitriny-neural/bootstrap.js';

const db=new Database(':memory:');
try{
  const provider={
    id:'local-test',
    capabilities:['image.generate','code.analyze','growth.diagnose','research.collect','commerce.catalog-review','support.draft-reply','ranking.evaluate'],
    local:true,priority:1,costClass:'free',available:async()=>true,
    invoke:async({capability,input})=>({capability,input,ok:true})
  };
  const runtime=createVitrinyNeuralRuntime({db,providers:[provider],nodeId:'bootstrap-test'});
  const status=runtime.status();
  assert.equal(status.neural.name,'Vitriny Neural');
  assert.equal(status.skills.skills.length,7);
  assert.equal(status.skills.providers.length,1);
  const image=await runtime.skills.run('media.generate',{type:'image',prompt:'fachada de loja moderna'});
  assert.equal(image.provider,'local-test');
  const commerce=await runtime.skills.run('commerce.advisor',{action:'catalog-review',objective:'melhorar conversão'});
  assert.equal(commerce.provider,'local-test');
  const ranking=await runtime.skills.run('ranking.optimizer',{action:'evaluate',sampleSize:5000});
  assert.equal(ranking.offlineOnly,true);
  console.log(JSON.stringify({ok:true,skills:status.skills.skills.map(s=>s.id)}));
}finally{db.close();}
