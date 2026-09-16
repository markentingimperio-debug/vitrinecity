import test from 'node:test';
import assert from 'node:assert/strict';
import {checkDeepSeek} from './check-deepseek.mjs';

test('DeepSeek readiness never calls network merely because a key exists',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;throw Error('must not send');};
  assert.equal((await checkDeepSeek({env:{},probe:true,fetchImpl})).code,'key_missing');
  assert.equal((await checkDeepSeek({env:{DEEPSEEK_API_KEY:'fixture-secret'},fetchImpl})).code,'not_probed');
  assert.equal(calls,0);
});
test('explicit metadata probe uses one fixed GET and does not claim generation',async()=>{
  let calls=0;
  const result=await checkDeepSeek({env:{DEEPSEEK_API_KEY:'fixture-secret'},probe:true,fetchImpl:async(url,options)=>{
    calls++;assert.equal(url,'https://api.deepseek.com/models');assert.equal(options.method,'GET');assert.equal(options.body,undefined);
    assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer fixture-secret');
    return new Response(JSON.stringify({data:[{id:'deepseek-flash'}],secret:'private-untrusted'}));
  }});
  assert.equal(calls,1);assert.equal(result.authenticated,true);assert.equal(result.modelAvailable,true);assert.equal(result.generationVerified,false);
  assert(!JSON.stringify(result).includes('secret'));assert(!JSON.stringify(result).includes('private'));
});
test('metadata rejection, malformed body and redirect never reveal provider payload or retry',async()=>{
  for(const response of [()=>new Response('private-token',{status:401}),()=>new Response('{private-invalid'),()=>new Response('x',{headers:{'content-length':'70000'}})]){
    let calls=0;const result=await checkDeepSeek({env:{DEEPSEEK_API_KEY:'fixture-secret'},probe:true,fetchImpl:async()=>{calls++;return response();}});
    assert.equal(calls,1);assert.equal(result.generationVerified,false);assert(!JSON.stringify(result).includes('private'));assert.equal(result.authenticated,undefined);
  }
});
