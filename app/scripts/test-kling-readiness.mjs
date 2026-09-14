import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {createKlingReadiness,mountKlingReadinessApi} from '../vitriny-neural/kling-readiness.js';
import {KLING_READINESS_VERSION,KLING_READINESS_STATES,assertKlingReadiness} from '../public/neural-kling-contract.js';

const NOW = Date.parse('2026-09-14T19:00:00.000Z');
const response = (body={code:0,data:{code:0,resource_pack_subscribe_infos:[]}},status=200) => Response.json(body,{status});
const failFetch = () => { throw Error('network must not be used'); };

test('missing API key never uses Studio or network', async () => {
  const service=createKlingReadiness({env:{KLING_HOME:'/private',KLING_ACCESS_KEY:'legacy',KLING_SECRET_KEY:'legacy'},fetchImpl:failFetch,now:()=>NOW});
  for(const state of [service.status(),await service.check()]){
    assertKlingReadiness(state);assert.equal(state.version,KLING_READINESS_VERSION);assert.equal(state.stage,'credentials_missing');assert.equal(state.checkedAt,null);
    assert.equal(state.generationEnabled,false);assert.equal(state.customerBillingEnabled,false);
  }
});
test('local status is not proof; explicit check contacts only free fixed GET without secrets in output',async()=>{
  let calls=0; const secret='test-only-secret';
  const service=createKlingReadiness({env:{KLING_API_KEY:secret},now:()=>NOW,fetchImpl:async(url,options)=>{
    calls++;assert.equal(url,`https://api-singapore.klingai.com/account/costs?start_time=${NOW-3600000}&end_time=${NOW}`);
    assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,`Bearer ${secret}`);
    assert.equal(options.headers['Content-Type'],'application/json');
    assert.equal(options.body,undefined);return response({code:0,message:secret,request_id:secret,data:{code:0,resource_pack_subscribe_infos:[{private:secret,remaining_quantity:1000}]}});
  }});
  assert.equal(service.status().stage,'not_checked');assert.equal(calls,0);
  const state=await service.check();assert.equal(state.stage,'access_verified');assert.equal(state.packageCount,1);assert.equal(calls,1);
  assert.equal(state.generationEnabled,false);assert.equal(state.customerBillingEnabled,false);assert.equal(state.studioCreditsShared,false);
  assert.equal(JSON.stringify(state).includes(secret),false);assert.equal(Object.hasOwn(state,'balance'),false);
});

test('verified account response may omit package information without claiming zero or balance',async()=>{
  // Sanitized shape observed from the official account read: both codes are
  // numeric zero and data is an object, but the package property is absent.
  const body={code:0,data:{code:0}};let calls=0;
  const service=createKlingReadiness({env:{KLING_API_KEY:'test-only-secret'},now:()=>NOW,fetchImpl:async(url,options)=>{
    calls++;assert.equal(url,`https://api-singapore.klingai.com/account/costs?start_time=${NOW-3600000}&end_time=${NOW}`);
    assert.equal(options.method,'GET');assert.equal(options.body,undefined);return response(body);
  }});
  const state=await service.check();assertKlingReadiness(state);
  assert.equal(state.version,2);assert.equal(state.stage,'access_verified');assert.equal(state.packageCount,null);
  assert.equal(state.checkedAt,new Date(NOW).toISOString());assert.equal(state.generationEnabled,false);assert.equal(state.customerBillingEnabled,false);
  assert.equal(Object.hasOwn(state,'balance'),false);assert.equal(Object.hasOwn(state,'remaining_quantity'),false);
  assert.deepEqual(service.status(),state);assert.deepEqual(await service.check(),state);assert.equal(calls,1);
  const empty=createKlingReadiness({env:{KLING_API_KEY:'test-only-secret'},now:()=>NOW,fetchImpl:async()=>response()});
  const zero=await empty.check();assert.equal(zero.stage,'access_verified');assert.equal(zero.packageCount,0);
  assert.notEqual(zero.packageCount,state.packageCount);
});

test('a reported package field must be a valid bounded array; null is not omission',async()=>{
  for(const packages of [null,false,0,'',{},[null],[[]],['package'],Array.from({length:10001},()=>({}))]){
    const service=createKlingReadiness({env:{KLING_API_KEY:'fake'},now:()=>NOW,fetchImpl:async()=>response({code:0,data:{code:0,resource_pack_subscribe_infos:packages}})});
    const state=await service.check();assert.equal(state.stage,'unavailable');assert.equal(state.packageCount,null);
  }
});
test('single-flight and cache serialize simultaneous checks; old evidence expires',async()=>{
  let time=NOW,calls=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const service=createKlingReadiness({env:{KLING_API_KEY:'fake'},now:()=>time,fetchImpl:async()=>{calls++;await gate;return response();}});
  const checks=Array.from({length:50},()=>service.check());assert.equal(calls,1);release();
  const states=await Promise.all(checks);assert(states.every(state=>state.stage==='access_verified'));
  await service.check();assert.equal(calls,1);time+=60001;assert.equal(service.status().stage,'not_checked');
  await service.check();assert.equal(calls,2);
});
test('malformed configured key rejected without network',async()=>{
  const service=createKlingReadiness({env:{KLING_API_KEY:'bad\nkey'},now:()=>NOW,fetchImpl:failFetch});
  assert.equal((await service.check()).stage,'credentials_rejected');
});
test('provider HTTP denial is sanitized and not marked connected',async()=>{
  for(const status of [401,403]){
    const service=createKlingReadiness({env:{KLING_API_KEY:'fake'},now:()=>NOW,fetchImpl:async()=>response({message:'private'},status)});
    assert.equal((await service.check()).stage,'credentials_rejected');assert.equal(service.status().packageCount,null);
  }
});
test('provider body contracts, wrong content type, redirects and oversized payloads fail closed',async()=>{
  const samples=[()=>response({code:1,data:{resource_pack_subscribe_infos:[]}}),()=>response({code:0,data:{resource_pack_subscribe_infos:{}}}),
    ()=>response({code:0,data:{resource_pack_subscribe_infos:[null]}}),()=>response({code:0}),()=>response({},500),
    ()=>new Response('{}',{headers:{'content-type':'text/html'}}),
    ()=>new Response('{}',{headers:{'content-type':'application/json','content-length':'262145'}}),
    ()=>new Response('x'.repeat(262145),{headers:{'content-type':'application/json'}}),
    ()=>{const r=response();Object.defineProperty(r,'redirected',{value:true});return r;}];
  for(const sample of samples){const service=createKlingReadiness({env:{KLING_API_KEY:'fake'},now:()=>NOW,fetchImpl:async()=>sample()});
    const result=await service.check();assert.equal(result.stage,'unavailable');assert.equal(result.packageCount,null);}
});
test('hard timeout returns unavailable even if transport ignores abort; late success cannot change it',async()=>{
  let finish;const service=createKlingReadiness({env:{KLING_API_KEY:'fake'},now:()=>NOW,timeoutMs:10,fetchImpl:()=>new Promise(resolve=>{finish=resolve;})});
  assert.equal((await service.check()).stage,'unavailable');finish(response());await new Promise(resolve=>setImmediate(resolve));
  assert.equal(service.status().stage,'unavailable');
});
test('both numeric success codes are required with reported or omitted packages',async()=>{
  for(const code of [1001,undefined,null,false,'0'])for(const packageFields of [{},{resource_pack_subscribe_infos:[]}]){
    for(const body of [{code:0,data:{code,...packageFields}},{code,data:{code:0,...packageFields}}]){
      const service=createKlingReadiness({env:{KLING_API_KEY:'fake'},now:()=>NOW,fetchImpl:async()=>response(body)});
      assert.equal((await service.check()).stage,'unavailable');
    }
  }
});

test('v2 unknown package count is explicit; consumers retain valid v1 states without weakening v1',()=>{
  const base=createKlingReadiness({env:{},now:()=>NOW}).status();
  assert.equal(KLING_READINESS_VERSION,2);
  for(const version of [1,2])for(const stage of Object.keys(KLING_READINESS_STATES)){
    const state={...base,version,stage,configured:stage!=='credentials_missing',
      checkedAt:['credentials_missing','not_checked'].includes(stage)?null:new Date(NOW).toISOString(),
      packageCount:stage==='access_verified'?0:null};
    assert.equal(assertKlingReadiness(state),state);
    if(stage==='access_verified'){
      assertKlingReadiness({...state,packageCount:2});
      if(version===1)assert.throws(()=>assertKlingReadiness({...state,packageCount:null}));
      else assertKlingReadiness({...state,packageCount:null});
    }else assert.throws(()=>assertKlingReadiness({...state,packageCount:0}));
  }
  const verified={...base,stage:'access_verified',configured:true,checkedAt:new Date(NOW).toISOString()};
  for(const version of [0,3,'2',null])assert.throws(()=>assertKlingReadiness({...verified,version}));
  for(const packageCount of [undefined,-1,'0',false,0.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>assertKlingReadiness({...verified,packageCount}));
  const missing={...verified};delete missing.packageCount;assert.throws(()=>assertKlingReadiness(missing));
});
test('canonical contract rejects false-green and additional secret fields',()=>{
  const base=createKlingReadiness({env:{},now:()=>NOW}).status();
  for(const value of [{...base,generationEnabled:true},{...base,customerBillingEnabled:true},{...base,apiKey:'fake'},
    {...base,stage:'access_verified'},{...base,packageCount:0},{...base,stage:'toString'},{...base,checkedAt:'2026-02-30T00:00:00.000Z'}]) assert.throws(()=>assertKlingReadiness(value));
});
test('mounted HTTP boundary requires admin and origin; never accepts a key/prompt/override',async t=>{
  const app=express();app.use(express.json());app.use((err,_req,res,_next)=>res.status(400).json({ok:false}));let checks=0;
  const state=createKlingReadiness({env:{},now:()=>NOW}).status();
  mountKlingReadinessApi({app,readiness:{status:()=>state,check:async()=>{checks++;return state;}},
    requireAdmin:(req,res,next)=>req.get('x-test-admin')==='yes'?next():res.status(401).json({ok:false}),
    sameOriginOnly:(req,res,next)=>req.get('origin')==='https://vitrinecity.com'?next():res.status(403).json({ok:false})});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}/api/admin/vitriny-neural/kling`;
  const headers={'x-test-admin':'yes','x-neural-request':'1','content-type':'application/json',origin:'https://vitrinecity.com'};
  assert.equal((await fetch(base+'/status')).status,401);
  const status=await fetch(base+'/status',{headers});assert.equal(status.headers.get('cache-control'),'no-store');assertKlingReadiness((await status.json()).status);assert.equal(checks,0);
  for(const data of [{key:'secret'},{prompt:'generate'},[],null])assert.equal((await fetch(base+'/check',{method:'POST',headers,body:JSON.stringify(data)})).status,400);
  assert.equal((await fetch(base+'/check?force=1',{method:'POST',headers,body:'{}'})).status,400);
  assert.equal((await fetch(base+'/check',{method:'POST',headers:{...headers,origin:'https://evil.example'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/check',{method:'POST',headers:{...headers,'x-neural-request':'0'},body:'{}'})).status,400);
  assert.equal(checks,0);const check=await fetch(base+'/check',{method:'POST',headers,body:'{}'});assert.equal(check.status,200);assertKlingReadiness((await check.json()).status);assert.equal(checks,1);
});
