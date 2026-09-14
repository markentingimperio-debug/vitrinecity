import assert from 'node:assert/strict';
import express from 'express';
import {mountNeuralTasksApi} from '../vitriny-neural/tasks-api.js';

const origin='https://vitrinecity.test';
const adminBase='/api/admin/vitriny-neural/tasks';
const storeBase=reference=>`/api/store-portal/${reference}/neural/tasks`;
const error=code=>Object.assign(new Error('internal-secret-do-not-expose'),{code});
const calls=[],items=new Map();
let taskCounter=0,statusError=null;
const scoped=(scope,id)=>{
  const item=items.get(id);
  if(!item||item.scope!==scope)throw error('task_not_found');
  return item;
};
const tasks={
  status(scope){calls.push({method:'status',scope});if(statusError)throw statusError;return{enabled:true,scope};},
  list(scope){calls.push({method:'list',scope});return [...items.values()].filter(item=>item.scope===scope);},
  submit(scope,input){
    calls.push({method:'submit',scope,input});
    if(input.idempotencyKey){
      const prior=[...items.values()].find(item=>item.scope===scope&&item.idempotencyKey===input.idempotencyKey);
      if(prior)return {...prior,duplicate:true};
    }
    const item={id:`task-${++taskCounter}`,scope,status:'pending',...input};
    items.set(item.id,item);return item;
  },
  get(scope,id){calls.push({method:'get',scope,id});return scoped(scope,id);},
  start(scope,id){calls.push({method:'start',scope,id});const item=scoped(scope,id);item.status='running';return{...item};},
  cancel(scope,id){calls.push({method:'cancel',scope,id});const item=scoped(scope,id);item.status='cancelled';return{...item};},
  readFile(scope,id,filePath){
    calls.push({method:'readFile',scope,id,path:filePath});scoped(scope,id);
    if(filePath!=='website/index.html')throw error('task_file_not_found');
    return{path:filePath,content:'<!doctype html><script>fetch("/api/admin/private")</script><h1>Fixture</h1>'};
  }
};
const requireAdmin=(req,res,next)=>{
  if(!req.get('x-test-admin'))return res.status(401).json({error:'admin_login_required'});
  if(req.get('x-test-admin')!=='yes')return res.status(403).json({error:'admin_required'});
  req.user={id:1};return next();
};
const sameOriginOnly=(req,res,next)=>{
  if(req.get('origin')&&req.get('origin')!==origin)return res.status(403).json({error:'origin_blocked'});
  return next();
};
const getAuthorizedStore=(req,res)=>{
  const reference=req.params.reference;
  const canonical=reference==='store-a-alias'?'store-a':reference;
  const token=req.get('x-store-token')||req.body?.token;
  if(token!==`fixture-token-${canonical}`){res.status(403).json({error:'store_token_required'});return null;}
  if(canonical==='inactive'){res.status(403).json({error:'store_inactive'});return null;}
  if(canonical==='unpaid'){res.status(409).json({error:'store_unpaid'});return null;}
  if(canonical==='missing'){res.status(404).json({error:'store_missing'});return null;}
  if(canonical==='store-b'&&req.get('x-test-mfa')!=='yes'){
    res.status(428).json({error:'store_mfa_required',mfaRequired:true});return null;
  }
  return{storeReference:canonical};
};
function createApp(taskService){
  const app=express();app.use(express.json({limit:'128kb'}));
  mountNeuralTasksApi({app,tasks:taskService,requireAdmin,sameOriginOnly,getAuthorizedStore});
  return app;
}
async function listen(app){return new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});}
const server=await listen(createApp(tasks));
const unavailableServer=await listen(createApp(null));
const adminHeaders={'x-test-admin':'yes'};
const storeHeaders=reference=>({'x-store-token':`fixture-token-${reference}`,...(reference==='store-b'?{'x-test-mfa':'yes'}:{})});
async function request(route,{method='GET',body,headers={},target=server,defaultMutationHeaders=true}={}){
  const mutation=method!=='GET';
  const response=await fetch(`http://127.0.0.1:${target.address().port}${route}`,{
    method,headers:{...(mutation&&defaultMutationHeaders?{'content-type':'application/json','x-neural-request':'1',origin}:{}),...headers},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const text=await response.text();
  const data=response.headers.get('content-type')?.includes('application/json')?JSON.parse(text):null;
  assert.equal(response.headers.get('cache-control'),'no-store',`${method} ${route} must never be cached`);
  assert.ok(!text.includes('internal-secret-do-not-expose'),'internal errors must be redacted');
  return{response,status:response.status,data,text};
}

try{
  for(const route of [adminBase,adminBase+'/status',adminBase+'/unknown',adminBase+'/unknown/file?path=website/index.html']){
    assert.equal((await request(route)).status,401);
  }
  assert.equal((await request(adminBase,{headers:{'x-test-admin':'no'}})).status,403);
  assert.equal((await request(storeBase('store-a'))).status,403);
  assert.equal((await request(storeBase('store-b'),{headers:{'x-store-token':'fixture-token-store-b'}})).status,428);
  for(const suffix of ['', '/unknown/run', '/unknown/cancel']){
    const body=suffix?{}:{instruction:'Crie uma página.'};
    assert.equal((await request(adminBase+suffix,{method:'POST',body})).status,401);
    assert.equal((await request(storeBase('store-a')+suffix,{method:'POST',body})).status,403);
    assert.equal((await request(storeBase('store-b')+suffix,{method:'POST',body,headers:{'x-store-token':'fixture-token-store-b'}})).status,428);
  }
  for(const [reference,expected]of [['inactive',403],['unpaid',409],['missing',404]]){
    assert.equal((await request(storeBase(reference),{headers:storeHeaders(reference)})).status,expected);
  }
  assert.equal(calls.length,0,'unauthorized requests must never reach tasks');

  let result=await request(adminBase+'/status',{headers:adminHeaders});
  assert.equal(result.status,200);assert.equal(result.data.scope,'admin');
  result=await request(storeBase('store-a-alias')+'/status?scope=admin',{headers:storeHeaders('store-a')});
  assert.equal(result.status,200);assert.equal(result.data.scope,'store:store-a','use canonical store returned by authorization');

  const instruction='Crie uma página de apresentação da loja.';
  result=await request(adminBase,{method:'POST',headers:adminHeaders,body:{instruction,idempotencyKey:'admin-fixture-1'}});
  assert.equal(result.status,201);const adminTask=result.data.item;
  result=await request(storeBase('store-a'),{method:'POST',body:{instruction,idempotencyKey:'store-fixture-1',token:'fixture-token-store-a'}});
  assert.equal(result.status,201);const storeTask=result.data.item;
  const submitCall=calls.filter(call=>call.method==='submit').at(-1);
  assert.deepEqual(submitCall.input,{instruction,idempotencyKey:'store-fixture-1'});
  assert.equal(submitCall.scope,'store:store-a');
  assert.equal(Object.hasOwn(submitCall.input,'token'),false,'store credential never reaches engine');
  assert.equal(Object.hasOwn(submitCall.input,'kind'),false,'engine decides task type from the instruction');
  result=await request(storeBase('store-a'),{method:'POST',headers:storeHeaders('store-a'),body:{instruction,idempotencyKey:'store-fixture-1'}});
  assert.equal(result.status,200);assert.equal(result.data.item.id,storeTask.id);assert.equal(result.data.item.duplicate,true);

  for(const base of [adminBase,storeBase('store-a')]){
    const headers=base===adminBase?adminHeaders:storeHeaders('store-a');
    const count=calls.length;
    for(const field of ['kind','tenant','scope','owner','ownerUserId','storeReference','provider','tools','capability','approved','__proto__']){
      result=await request(base,{method:'POST',headers,body:Object.fromEntries([['instruction',instruction],[field,'admin']])});
      assert.equal(result.status,400,`${field} must not override trusted task context`);
      assert.equal(result.data.code,'task_input_invalid');
    }
    assert.equal((await request(base,{method:'POST',headers,body:[]})).status,400);
    assert.equal(calls.length,count,'invalid request bodies must not reach engine');
  }

  const countBeforeCsrf=calls.length;
  for(const [base,id,headers]of [[adminBase,adminTask.id,adminHeaders],[storeBase('store-a'),storeTask.id,storeHeaders('store-a')]]){
    for(const suffix of ['',`/${id}/run`,`/${id}/cancel`]){
      const body=suffix?{}:{instruction};
      assert.equal((await request(base+suffix,{method:'POST',body,headers:{...headers,origin:'https://evil.test'}})).status,403);
      assert.equal((await request(base+suffix,{method:'POST',body,headers:{...headers,'x-neural-request':''}})).status,403);
      assert.equal((await request(base+suffix,{method:'POST',body,headers:{...headers,'content-type':'text/plain'}})).status,403);
      assert.equal((await request(base+suffix,{method:'POST',body,headers:{...headers,'content-type':'application/json'},defaultMutationHeaders:false})).status,403);
    }
  }
  assert.equal(calls.length,countBeforeCsrf,'CSRF failures must not reach engine');

  result=await request(storeBase('store-a')+'/'+storeTask.id+'/run',{method:'POST',headers:storeHeaders('store-a'),body:{}});
  assert.equal(result.status,202);assert.equal(result.data.item.status,'running');
  result=await request(adminBase+'/'+adminTask.id+'/run',{method:'POST',headers:{...adminHeaders,'content-type':'application/json','x-neural-request':'1'},body:{},defaultMutationHeaders:false});
  assert.equal(result.status,202,'an explicit custom header protects clients that omit Origin');
  result=await request(storeBase('store-a')+'/'+storeTask.id+'/cancel',{method:'POST',headers:storeHeaders('store-a'),body:{token:'fixture-token-store-a'}});
  assert.equal(result.status,200);assert.equal(result.data.item.status,'cancelled');
  for(const suffix of ['/run','/cancel']){
    result=await request(storeBase('store-a')+'/'+storeTask.id+suffix,{method:'POST',headers:storeHeaders('store-a'),body:{scope:'admin'}});
    assert.equal(result.status,400);
  }

  for(const [base,id,headers]of [[storeBase('store-b'),storeTask.id,storeHeaders('store-b')],[adminBase,storeTask.id,adminHeaders],[storeBase('store-a'),adminTask.id,storeHeaders('store-a')]]){
    assert.equal((await request(base+'/'+id,{headers})).status,404);
    assert.equal((await request(base+'/'+id+'/file?path=website/index.html',{headers})).status,404);
    for(const suffix of ['/run','/cancel'])assert.equal((await request(base+'/'+id+suffix,{method:'POST',headers,body:{}})).status,404);
  }
  result=await request(storeBase('store-a'),{headers:storeHeaders('store-a')});
  assert.deepEqual(result.data.items.map(item=>item.id),[storeTask.id]);
  result=await request(storeBase('store-b'),{headers:storeHeaders('store-b')});
  assert.deepEqual(result.data.items,[]);
  result=await request(adminBase,{headers:adminHeaders});
  assert.deepEqual(result.data.items.map(item=>item.id),[adminTask.id]);

  result=await request(storeBase('store-a')+'/'+storeTask.id+'/file?path=website/index.html',{headers:storeHeaders('store-a')});
  assert.equal(result.status,200);assert.match(result.text,/<script>/);
  assert.match(result.response.headers.get('content-type'),/^text\/plain;/);
  assert.equal(result.response.headers.get('content-disposition'),'attachment; filename="index.html"');
  assert.equal(result.response.headers.get('content-security-policy'),"sandbox; default-src 'none'");
  assert.equal(result.response.headers.get('x-content-type-options'),'nosniff');
  for(const query of ['', '?path=', '?path=a&path=b','?path=%00bad']){
    assert.equal((await request(storeBase('store-a')+'/'+storeTask.id+'/file'+query,{headers:storeHeaders('store-a')})).status,400);
  }
  assert.equal((await request(storeBase('store-a')+'/'+storeTask.id+'/file?path=missing.txt',{headers:storeHeaders('store-a')})).status,404);

  const codes={task_input_invalid:400,task_disabled:503,task_scope_denied:403,task_not_found:404,task_quota_exhausted:429,task_busy:429,task_conflict:409,task_provider_unqualified:503,task_file_not_found:404,task_file_invalid:400,task_capacity_exhausted:429};
  for(const [code,status]of Object.entries(codes)){
    statusError=error(code);result=await request(adminBase+'/status',{headers:adminHeaders});
    assert.equal(result.status,status);assert.equal(result.data.code,code);
  }
  for(const code of ['unknown','__proto__','constructor']){
    statusError=error(code);result=await request(adminBase+'/status',{headers:adminHeaders});
    assert.equal(result.status,500);assert.equal(result.data.code,'task_internal_error');
  }
  statusError=null;
  assert.equal((await request(adminBase,{target:unavailableServer})).status,401,'unavailable service must not bypass auth');
  assert.equal((await request(adminBase,{target:unavailableServer,headers:adminHeaders})).status,503);
  assert.equal((await request(storeBase('store-a'),{target:unavailableServer,headers:storeHeaders('store-a')})).status,503);
  console.log(JSON.stringify({ok:true,suite:'vitriny-neural-tasks-api',assertions:'auth, tenant isolation, canonical scope, MFA, CSRF, whitelist, safe downloads, sanitized errors, availability'}));
}finally{
  await Promise.all([new Promise(resolve=>server.close(resolve)),new Promise(resolve=>unavailableServer.close(resolve))]);
}
