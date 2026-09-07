import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createEnvModelProviders} from '../vitriny-neural/providers/from-env.js';
import {createVitrinyNeuralRuntime} from '../vitriny-neural/bootstrap.js';

const requests=[];
const fetchImpl=async(url,options={})=>{
  requests.push({url:String(url),body:JSON.parse(options.body||'{}')});
  return new Response(JSON.stringify({model:'qwen-test',choices:[{message:{content:'Plano com testes, branch e rollback; sem deploy automático.'}}]}),{status:200,headers:{'content-type':'application/json'}});
};
const env={VITRINY_NEURAL_MODEL_ORIGIN:'http://model.internal:8080',VITRINY_NEURAL_MODEL_NAME:'qwen-test',VITRINY_NEURAL_MODEL_ID:'neural-local'};
const providers=createEnvModelProviders({env,fetchImpl});
assert.equal(providers.length,1);
assert.equal(providers[0].id,'neural-local');

const db=new Database(':memory:');
try{
  const runtime=createVitrinyNeuralRuntime({db,providers:null,env,fetchImpl,nodeId:'env-provider-test'});
  assert.equal(runtime.status().skills.providers.length,1);
  const result=await runtime.skills.run('code.engineer',{action:'plan',task:'Planejar mudança segura.',dryRun:true});
  assert.equal(result.provider,'neural-local');
  assert.match(result.output.text,/rollback/i);
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'http://model.internal:8080/v1/chat/completions');
  assert.equal(requests[0].body.model,'qwen-test');
  console.log(JSON.stringify({ok:true,provider:result.provider,model:result.output.model}));
}finally{db.close();}
