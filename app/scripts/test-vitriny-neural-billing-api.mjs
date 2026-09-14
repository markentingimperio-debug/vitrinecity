import assert from 'node:assert/strict';
import express from 'express';
import {mountNeuralBillingApi} from '../vitriny-neural/billing-api.js';

const origin='https://vitrinecity.test';
const adminBase='/api/admin/vitriny-neural/billing';
const adminStore=reference=>`${adminBase}/stores/${reference}`;
const merchantBase=reference=>`/api/store-portal/${reference}/neural/billing`;
const secret='internal-billing-secret-do-not-expose';
const error=code=>Object.assign(new Error(secret),{code,status:200});
const calls=[],storeLookups=[],authorizationCalls=[];
let statusError=null,canResolve=true;
const periodItems=[{id:'period-a',scope:'store:store-a'},{id:'period-b',scope:'store:store-b'}];
const billing={
  enabled:true,
  plans(){calls.push({method:'plans'});return[{code:'fixture',monthlyCredits:100}];},
  createPlan(input,actor){calls.push({method:'createPlan',input,actor});return{...input};},
  periodStatus(scope){calls.push({method:'periodStatus',scope});if(statusError)throw statusError;return{scope,active:true,availableCredits:75};},
  ledger(scope){calls.push({method:'ledger',scope});return[{id:`entry-${scope}`,scope,currency:'ai_credits'}];},
  periods(scope){calls.push({method:'periods',scope});return periodItems.filter(item=>item.scope===scope);},
  getPeriod(scope,id){calls.push({method:'getPeriod',scope,id});const item=periodItems.find(period=>period.scope===scope&&period.id===id);if(!item)throw error('billing_period_not_found');return item;},
  grantPeriod(input,actor){calls.push({method:'grantPeriod',input,actor});return{id:'created-period',...input,duplicate:input.idempotencyKey==='duplicate-fixture'};},
  revokePeriod(id,actor){calls.push({method:'revokePeriod',id,actor});return{id,status:'revoked'};},
  resolve(scope,id,input,actor){calls.push({method:'resolve',scope,id,input,actor});return{taskId:id,status:'settled'};}
};
const tasks={
  billingCanResolve(scope,id){calls.push({method:'billingCanResolve',scope,id});return canResolve;}
};
const requireAdmin=(req,res,next)=>{
  if(!req.get('x-test-admin'))return res.status(401).json({error:'admin_login_required'});
  if(req.get('x-test-admin')!=='yes')return res.status(403).json({error:'admin_required'});
  if(req.get('x-test-mfa')==='required')return res.status(428).json({error:'admin_mfa_required'});
  req.user={id:42};return next();
};
const sameOriginOnly=(req,res,next)=>{
  if(req.get('origin')&&req.get('origin')!==origin)return res.status(403).json({error:'origin_blocked'});
  return next();
};
const getAuthorizedStore=(req,res)=>{
  authorizationCalls.push(req.params.reference);
  const reference=req.params.reference==='store-a-alias'?'store-a':req.params.reference;
  if(req.get('x-store-token')!==`fixture-token-${reference}`){res.status(403).json({error:'store_token_required'});return null;}
  if(reference==='store-b'&&req.get('x-test-mfa')!=='yes'){res.status(428).json({error:'store_mfa_required'});return null;}
  if(reference==='inactive'){res.status(403).json({error:'store_inactive'});return null;}
  if(reference==='unpaid'){res.status(409).json({error:'store_unpaid'});return null;}
  if(reference==='missing'){res.status(404).json({error:'store_missing'});return null;}
  if(reference==='invalid-canonical')return{storeReference:'../admin'};
  return{storeReference:reference};
};
const storeExists=reference=>{storeLookups.push(reference);return ['store-a','store-b','inactive'].includes(reference);};
const adminHeaders={'x-test-admin':'yes'};
const storeHeaders=reference=>({'x-store-token':`fixture-token-${reference}`,...(reference==='store-b'?{'x-test-mfa':'yes'}:{})});
function createApp(service=billing,taskService=tasks){
  const app=express();app.use(express.json({limit:'128kb'}));
  mountNeuralBillingApi({app,billing:service,tasks:taskService,requireAdmin,sameOriginOnly,getAuthorizedStore,storeExists});
  return app;
}
async function listen(app){return new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});}
const server=await listen(createApp());
const unavailableServer=await listen(createApp(null));
const noTasksServer=await listen(createApp(billing,null));
async function request(path,{method='GET',body,headers={},target=server,defaultMutationHeaders=true,cacheExpected=true}={}){
  const response=await fetch(`http://127.0.0.1:${target.address().port}${path}`,{
    method,
    headers:{...(method!=='GET'&&defaultMutationHeaders?{'content-type':'application/json','x-neural-request':'1',origin}:{}),...headers},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const text=await response.text();
  if(cacheExpected)assert.equal(response.headers.get('cache-control'),'no-store',`${method} ${path} must not be cached`);
  assert.ok(!text.includes(secret),'do not leak internal errors');
  return{status:response.status,data:response.headers.get('content-type')?.includes('application/json')?JSON.parse(text):null,text};
}
const plan={code:'fixture',name:'Plano de teste',monthlyCredits:100,taskReserveCredits:20,inputCreditsPer1000:1,outputCreditsPer1000:2};
const period={planCode:'fixture',periodStart:Date.parse('2026-09-01T00:00:00.000Z'),periodEnd:Date.parse('2026-10-01T00:00:00.000Z'),idempotencyKey:'fixture-period-key'};
const resolution={chargeCredits:3,reason:'Conciliação manual com evidência do servidor local.',idempotencyKey:'fixture-resolution-key'};
const writes=[
  {path:adminBase+'/plans',body:plan},
  {path:adminStore('store-a')+'/periods',body:period},
  {path:adminStore('store-a')+'/periods/period-a/revoke',body:{}},
  {path:adminStore('store-a')+'/tasks/task-a/resolve',body:resolution}
];

try{
  assert.throws(()=>mountNeuralBillingApi({app:express(),requireAdmin,sameOriginOnly,getAuthorizedStore}),TypeError,'store existence check is mandatory');
  for(const path of [adminBase+'/plans',...['status','ledger','periods'].map(part=>adminStore('store-a')+'/'+part)]){
    assert.equal((await request(path)).status,401);
    assert.equal((await request(path,{headers:{'x-test-admin':'no'}})).status,403);
    assert.equal((await request(path,{headers:{...adminHeaders,'x-test-mfa':'required'}})).status,428);
  }
  for(const {path,body}of writes){
    assert.equal((await request(path,{method:'POST',body})).status,401);
    assert.equal((await request(path,{method:'POST',body,headers:storeHeaders('store-a')})).status,401,'a merchant token does not grant admin writes');
  }
  for(const suffix of ['/status','/ledger']){
    assert.equal((await request(merchantBase('store-a')+suffix)).status,403);
    assert.equal((await request(merchantBase('store-a')+suffix,{headers:storeHeaders('store-b')})).status,403,'another store token cannot read this store');
    assert.equal((await request(merchantBase('store-b')+suffix,{headers:{'x-store-token':'fixture-token-store-b'}})).status,428);
    for(const [reference,status]of [['inactive',403],['unpaid',409],['missing',404],['invalid-canonical',403]]){
      assert.equal((await request(merchantBase(reference)+suffix,{headers:storeHeaders(reference)})).status,status);
    }
  }
  assert.equal(calls.length,0,'denied requests cannot reach the credit service');
  assert.equal(storeLookups.length,0,'store lookup must follow admin authorization');

  let result=await request(adminBase+'/plans',{headers:adminHeaders});
  assert.equal(result.status,200);assert.equal(result.data.items[0].code,'fixture');
  const priorAuthCalls=authorizationCalls.length;
  result=await request(adminStore('store-a')+'/status?scope=store:store-b',{headers:adminHeaders});
  assert.equal(result.status,200);assert.equal(result.data.scope,'store:store-a');
  assert.equal(result.data.enabled,true);assert.equal(result.data.currency,'ai_credits');
  assert.equal(authorizationCalls.length,priorAuthCalls,'admin billing access does not request merchant credentials');
  assert.equal((await request(adminStore('missing')+'/status',{headers:adminHeaders})).status,404);
  assert.equal((await request(adminStore('bad%20reference')+'/status',{headers:adminHeaders})).status,400);
  assert.equal((await request(adminStore('inactive')+'/status',{headers:adminHeaders})).status,200,'admin can reconcile an existing suspended store');
  result=await request(merchantBase('store-a-alias')+'/status?scope=admin&reference=store-b',{headers:storeHeaders('store-a')});
  assert.equal(result.data.scope,'store:store-a','scope comes from canonical authorization result');
  for(const reference of ['store-a','store-b']){
    result=await request(merchantBase(reference)+'/ledger?scope=admin',{headers:storeHeaders(reference)});
    assert.equal(result.status,200);assert.equal(result.data.items.length,1);assert.equal(result.data.items[0].scope,`store:${reference}`);
  }
  result=await request(adminStore('store-a')+'/periods',{headers:adminHeaders});
  assert.deepEqual(result.data.items,[periodItems[0]]);
  result=await request(adminStore('store-b')+'/ledger',{headers:adminHeaders});
  assert.equal(result.data.items[0].scope,'store:store-b');

  result=await request(adminBase+'/plans',{method:'POST',body:plan,headers:adminHeaders});
  assert.equal(result.status,201);assert.deepEqual(calls.at(-1),{method:'createPlan',input:plan,actor:'42'});
  result=await request(adminStore('store-a')+'/periods?scope=admin',{method:'POST',body:period,headers:adminHeaders});
  assert.equal(result.status,201);assert.deepEqual(calls.at(-1),{method:'grantPeriod',input:{...period,scope:'store:store-a'},actor:'42'});
  result=await request(adminStore('store-a')+'/periods',{method:'POST',body:{...period,idempotencyKey:'duplicate-fixture'},headers:adminHeaders});
  assert.equal(result.status,200);assert.equal(result.data.item.duplicate,true);

  let before=calls.length;
  for(const {path,body}of writes){
    for(const field of ['scope','storeReference','actor','owner','monthlyPrice','currency','balance','paid','provider','token','__proto__','constructor']){
      const payload=Object.fromEntries([...Object.entries(body),[field,'spoofed']]);
      result=await request(path,{method:'POST',body:payload,headers:adminHeaders});
      assert.equal(result.status,400,`${field} must not override trusted billing context`);
      assert.equal(result.data.code,'billing_input_invalid');
    }
    assert.equal((await request(path,{method:'POST',body:[],headers:adminHeaders})).status,400);
    if(Object.keys(body).length)assert.equal((await request(path,{method:'POST',headers:adminHeaders})).status,400);
  }
  assert.equal((await request(adminBase+'/plans',{method:'POST',body:{...plan,name:'a'.repeat(17*1024)},headers:adminHeaders})).status,400);
  assert.equal(calls.length,before,'invalid bodies cannot change credits');
  assert.equal((await request(adminStore('missing')+'/periods',{method:'POST',body:period,headers:adminHeaders})).status,404);

  before=calls.length;
  for(const {path,body}of writes){
    for(const headers of [
      {...adminHeaders,origin:'https://evil.test'},
      {...adminHeaders,'x-neural-request':''},
      {...adminHeaders,'content-type':'text/plain'}
    ])assert.equal((await request(path,{method:'POST',body,headers})).status,403);
    assert.equal((await request(path,{method:'POST',body,headers:{...adminHeaders,'content-type':'application/json'},defaultMutationHeaders:false})).status,403);
  }
  assert.equal(calls.length,before,'forged requests cannot mutate billing');
  result=await request(adminBase+'/plans',{method:'POST',body:plan,headers:{...adminHeaders,'content-type':'application/json','x-neural-request':'1'},defaultMutationHeaders:false});
  assert.equal(result.status,201,'explicit custom header protects clients omitting Origin');

  before=calls.filter(call=>call.method==='revokePeriod').length;
  for(const id of ['period-b','unknown','__proto__']){
    result=await request(adminStore('store-a')+`/periods/${id}/revoke`,{method:'POST',body:{},headers:adminHeaders});
    assert.equal(result.status,404);assert.equal(result.data.code,'billing_period_not_found');
  }
  assert.equal(calls.filter(call=>call.method==='revokePeriod').length,before,'period ownership is checked before revocation');
  result=await request(adminStore('store-a')+'/periods/period-a/revoke',{method:'POST',body:{},headers:adminHeaders});
  assert.equal(result.status,200);assert.deepEqual(calls.at(-1),{method:'revokePeriod',id:'period-a',actor:'42'});
  assert.deepEqual(calls.at(-2),{method:'getPeriod',scope:'store:store-a',id:'period-a'});

  canResolve=false;
  before=calls.filter(call=>call.method==='resolve').length;
  result=await request(adminStore('store-a')+'/tasks/task-a/resolve',{method:'POST',body:resolution,headers:adminHeaders});
  assert.equal(result.status,409);assert.equal(result.data.code,'billing_task_unsettled');
  assert.equal(calls.filter(call=>call.method==='resolve').length,before,'no reconciliation while a provider could still run');
  result=await request(adminStore('store-a')+'/tasks/task-a/resolve',{method:'POST',body:resolution,headers:adminHeaders,target:noTasksServer});
  assert.equal(result.status,503);assert.equal(result.data.code,'billing_tasks_unavailable');
  canResolve=true;
  result=await request(adminStore('store-a')+'/tasks/task-a/resolve?scope=store:store-b',{method:'POST',body:resolution,headers:adminHeaders});
  assert.equal(result.status,200);
  assert.deepEqual(calls.at(-2),{method:'billingCanResolve',scope:'store:store-a',id:'task-a'});
  assert.deepEqual(calls.at(-1),{method:'resolve',scope:'store:store-a',id:'task-a',input:resolution,actor:'42'});

  for(const suffix of ['/plans','/periods','/periods/period-a/revoke','/tasks/task-a/resolve','/status','/ledger']){
    result=await request(merchantBase('store-a')+suffix,{method:'POST',body:resolution,headers:storeHeaders('store-a'),cacheExpected:false});
    assert.equal(result.status,404,'there are no merchant billing mutation routes');
  }
  for(const suffix of ['/plans','/periods'])assert.equal((await request(merchantBase('store-a')+suffix,{headers:storeHeaders('store-a'),cacheExpected:false})).status,404);

  const errors={billing_input_invalid:400,billing_scope_invalid:400,billing_plan_invalid:400,billing_period_invalid:400,billing_resolution_invalid:400,billing_actor_invalid:403,billing_scope_denied:403,billing_plan_not_found:404,billing_store_not_found:404,billing_period_not_found:404,billing_reservation_not_found:404,billing_plan_conflict:409,billing_period_overlap:409,billing_idempotency_conflict:409,billing_period_conflict:409,billing_reservation_conflict:409,billing_reservation_not_reconcilable:409,billing_task_unsettled:409,billing_conflict:409,billing_attempt_conflict:409,billing_reservation_closed:409,billing_review_required:409,billing_usage_review_required:409,billing_subscription_required:402,billing_insufficient_credits:402,billing_credits_exhausted:402,billing_task_budget_exhausted:402,billing_attempt_limit:429,billing_disabled:503,billing_unavailable:503,billing_tasks_unavailable:503};
  for(const [code,status]of Object.entries(errors)){
    statusError=error(code);result=await request(merchantBase('store-a')+'/status',{headers:storeHeaders('store-a')});
    assert.equal(result.status,status);assert.equal(result.data.code,code);
  }
  for(const code of ['unknown','__proto__','constructor','task_internal_error']){
    statusError=error(code);result=await request(adminStore('store-a')+'/status',{headers:adminHeaders});
    assert.equal(result.status,500);assert.equal(result.data.code,'billing_internal_error');
  }
  statusError=null;
  billing.enabled=false;
  result=await request(merchantBase('store-a')+'/status',{headers:storeHeaders('store-a')});
  assert.equal(result.data.enabled,false);assert.equal(result.data.currency,'ai_credits');
  billing.enabled=true;
  assert.equal((await request(adminBase+'/plans',{target:unavailableServer})).status,401,'service absence never bypasses authentication');
  assert.equal((await request(adminBase+'/plans',{target:unavailableServer,headers:adminHeaders})).status,503);
  assert.equal((await request(merchantBase('store-a')+'/status',{target:unavailableServer,headers:storeHeaders('store-a')})).status,503);
  console.log(JSON.stringify({ok:true,suite:'vitriny-neural-billing-api',assertions:'admin and merchant auth, canonical store isolation, MFA, no-store, JSON/CSRF, strict payloads, scoped revocation, unsettled-provider protection, actor propagation, sanitized errors, availability, no merchant writes'}));
}finally{
  await Promise.all([server,unavailableServer,noTasksServer].map(instance=>new Promise(resolve=>instance.close(resolve))));
}
