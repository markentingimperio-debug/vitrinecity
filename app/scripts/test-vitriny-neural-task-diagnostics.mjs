import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import Database from 'better-sqlite3';
import express from 'express';
import {createVitrinyNeuralService} from '../vitriny-neural/service.js';
import {createNeuralTaskDiagnostics} from '../vitriny-neural/task-diagnostics.js';
import {mountVitrinyNeuralAdmin} from '../vitriny-neural/admin-api.js';

const secret='fixture-secret-do-not-return';
const report={score:1,categories:Object.fromEntries(['safety','code','research','growth','commerce','support','ranking'].map(name=>[name,{score:1}]))};
function fixture({mode='advisory',enabled='1',tasksEnabled='1',billingEnabled='0',preflight}={}){
  const db=new Database(':memory:');let clock=1800000000000,localCalls=0,remoteCalls=0;
  let response={ok:true,reachable:true,modelAvailable:true,modelName:'local-alias',code:'provider_model_available',httpStatus:200,noInference:true};
  const provider={id:'diagnostic-local',modelName:'local-alias',local:true,capabilities:['code.plan','growth.content-plan'],
    available:async()=>{throw Error('preflight must not use availability admission');},
    invoke:async()=>{throw Error('preflight must never invoke inference');},
    preflight:async options=>{localCalls++;assert.equal(options.timeoutMs,3000);return preflight?preflight(options):{...response,origin:secret,body:secret,apiKey:secret};}};
  const remote={...provider,id:'diagnostic-remote',local:false,preflight:async()=>{remoteCalls++;throw Error('remote must not be queried');}};
  const service=createVitrinyNeuralService({db,providers:[provider,remote],now:()=>clock,
    env:{VITRINY_NEURAL_ENABLED:enabled,VITRINY_NEURAL_MODE:mode,VITRINY_NEURAL_TASKS_ENABLED:tasksEnabled,VITRINY_NEURAL_BILLING_ENABLED:billingEnabled}});
  return {db,service,provider,counts:()=>({localCalls,remoteCalls}),advance:ms=>{clock+=ms;},setResponse:value=>{response=value;},
    qualify:(modelName='local-alias',value=report)=>{clock++;return service.recordQualification({providerId:provider.id,modelName,report:value});}};
}

test('connectivity alone does not qualify or execute tasks; remote providers stay untouched',async()=>{
  const f=fixture();try{
    const before=f.service.qualifications.list().length;
    const result=await f.service.taskDiagnostics.check();
    assert.equal(result.readyForTaskAttempt,false);assert.equal(result.tasksEnabled,true);
    assert.equal(result.providers.length,1);assert.equal(result.providers[0].reachable,true);
    assert.equal(result.providers[0].qualificationPresent,false);
    assert.equal(result.providers[0].probeCode,'provider_model_available');
    assert.equal(result.noInference,true);assert.equal(result.generationVerified,false);assert.equal(result.liveTaskAcceptance,'not_run_here');
    assert.equal(f.service.qualifications.list().length,before);assert.deepEqual(f.counts(),{localCalls:1,remoteCalls:0});
    assert.doesNotMatch(JSON.stringify(result),new RegExp(secret));
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM neural_tasks').get().n,0);
  }finally{f.db.close();}
});

test('matching live model and both qualified capabilities permit only a task attempt',async()=>{
  const f=fixture();try{
    f.qualify();const result=await f.service.taskDiagnostics.check();
    assert.equal(result.readyForTaskAttempt,true);assert.equal(result.providers[0].qualificationModelMatches,true);
    assert.deepEqual(result.capabilities,{'code.plan':true,'growth.content-plan':true});
    assert.equal(result.liveTaskAcceptance,'not_run_here');
  }finally{f.db.close();}
});

test('diagnostic leaves an expired store task and its held credits unchanged; normal status still reaps',async()=>{
  const f=fixture({billingEnabled:'1'});try{
    f.qualify();const {billing,tasks}=f.service,scope='store:diagnostic-shop';
    billing.createPlan({code:'diagnostic-plan',name:'Diagnostic fixture',monthlyCredits:1000,taskReserveCredits:100,inputCreditsPer1000:2,outputCreditsPer1000:5},'fixture-admin');
    billing.grantPeriod({scope,planCode:'diagnostic-plan',periodStart:1799999999000,periodEnd:1800001000000,idempotencyKey:'diagnostic-period-001'},'fixture-admin');
    const task=tasks.submit(scope,{instruction:'Crie um roteiro para a loja.',idempotencyKey:'diagnostic-task-001'});
    billing.reserve(scope,task.id);
    billing.recordAttempt(scope,task.id,{attemptId:'interrupted-attempt',type:'started',provider:f.provider.id,modelName:f.provider.modelName});
    // Durable fixture representing a process restart with an expired execution lease.
    f.db.prepare("UPDATE neural_tasks SET status='running',lease_token='expired-fixture',lease_until=?,started_at=? WHERE id=?")
      .run(1800000000000,1799999999000,task.id);
    const snapshot=()=>({task:f.db.prepare('SELECT * FROM neural_tasks WHERE id=?').get(task.id),
      reservation:billing.report(scope,task.id),period:billing.periodStatus(scope),ledger:billing.ledger(scope),
      changes:f.db.prepare('SELECT total_changes() n').get().n});
    const before=snapshot();assert.equal(before.period.reservedCredits,100);assert.equal(before.task.status,'running');
    await f.service.taskDiagnostics.check();await f.service.taskDiagnostics.check();
    assert.deepEqual(snapshot(),before,'Neither fresh nor cached diagnostics may reap, settle or write to SQLite');
    tasks.status('admin');
    assert.equal(f.db.prepare('SELECT status FROM neural_tasks WHERE id=?').get(task.id).status,'interrupted');
    assert.equal(billing.report(scope,task.id).state,'review_required');
    assert.equal(billing.periodStatus(scope).reservedCredits,100);
    assert.equal(billing.ledger(scope).length,before.ledger.length+1,'Normal runtime status still records review of uncertain consumption');
  }finally{f.db.close();}
});

test('offline provider blocks even a qualified model, and connectivity cache expires',async()=>{
  const f=fixture();try{
    f.qualify();assert.equal((await f.service.taskDiagnostics.check()).readyForTaskAttempt,true);
    f.setResponse({ok:false,reachable:false,modelAvailable:false,code:'provider_unreachable',httpStatus:null});
    assert.equal((await f.service.taskDiagnostics.check()).cached,true);assert.equal(f.counts().localCalls,1);
    f.advance(10000);const result=await f.service.taskDiagnostics.check();
    assert.equal(result.readyForTaskAttempt,false);assert.equal(result.providers[0].probeCode,'provider_unreachable');assert.equal(f.counts().localCalls,2);
  }finally{f.db.close();}
});

test('different qualification alias and a missing served alias each block attempts',async()=>{
  const f=fixture();try{
    f.qualify('old-model');let result=await f.service.taskDiagnostics.check();
    assert.equal(result.providers[0].qualificationPresent,true);assert.equal(result.providers[0].qualificationModelMatches,false);assert.equal(result.readyForTaskAttempt,false);
    f.qualify();f.advance(10000);f.setResponse({ok:false,reachable:true,modelAvailable:false,code:'provider_model_missing',httpStatus:200});
    result=await f.service.taskDiagnostics.check();assert.equal(result.providers[0].qualificationModelMatches,true);assert.equal(result.readyForTaskAttempt,false);
  }finally{f.db.close();}
});

test('policy and qualification changes are checked again while connectivity is cached',async()=>{
  const f=fixture();try{
    f.qualify();assert.equal((await f.service.taskDiagnostics.check()).readyForTaskAttempt,true);
    f.qualify('local-alias',{...report,categories:{...report.categories,code:{score:0}}});
    let result=await f.service.taskDiagnostics.check();assert.equal(result.cached,true);assert.equal(result.readyForTaskAttempt,false);
    assert.deepEqual(result.capabilities,{'code.plan':false,'growth.content-plan':true});assert.equal(f.counts().localCalls,1);
    f.service.runtime.skills.setProviderPolicy(f.provider.id,{enabled:false});
    result=await f.service.taskDiagnostics.check();assert.equal(result.capabilities['growth.content-plan'],false);
  }finally{f.db.close();}
});

test('disabled Neural, disabled tasks and shadow mode cannot be reported ready',async()=>{
  for(const options of [{enabled:'0'},{tasksEnabled:'0'},{mode:'shadow'}]){
    const f=fixture(options);try{f.qualify();const result=await f.service.taskDiagnostics.check();assert.equal(result.tasksEnabled,false);assert.equal(result.readyForTaskAttempt,false);}finally{f.db.close();}
  }
});

test('concurrent checks share one probe and failures can be retried',async()=>{
  let resolve,probes=0,fail=false,clock=1800000000000;
  const pending=new Promise(done=>{resolve=done;});
  const diagnostics=createNeuralTaskDiagnostics({now:()=>clock,getProviders:()=>[],getQualification:()=>null,getTaskStatus:()=>({enabled:true}),
    probeLocalProviders:async()=>{probes++;if(fail)throw Error(secret);return pending;}});
  const first=diagnostics.check(),second=diagnostics.check();await Promise.resolve();assert.equal(probes,1);
  resolve([]);const results=await Promise.all([first,second]);assert.equal(results[0].readyForTaskAttempt,false);assert.equal(results[1].cached,true);
  await diagnostics.check();assert.equal(probes,1);
  clock+=10000;fail=true;await assert.rejects(diagnostics.check());fail=false;await diagnostics.check();assert.equal(probes,3);
});

test('probe exceptions and arbitrary returned codes are sanitized by runtime',async()=>{
  for(const preflight of [async()=>{throw Error(secret);},async()=>({ok:false,code:secret,body:secret,httpStatus:secret})]){
    const f=fixture({preflight});try{
      const result=await f.service.taskDiagnostics.check();assert.equal(result.readyForTaskAttempt,false);
      assert.doesNotMatch(JSON.stringify(result),new RegExp(secret));assert.equal(result.providers[0].httpStatus,null);
    }finally{f.db.close();}
  }
});

test('admin endpoint requires authenticated same-origin JSON request and cannot select provider or infer',async()=>{
  const app=express();app.use(express.json());let checks=0,fail=false;
  const service={runtime:{neural:{},skills:{}},taskDiagnostics:{check:async()=>{checks++;if(fail)throw Error(secret);return{readyForTaskAttempt:false,noInference:true,liveTaskAcceptance:'not_run_here',providers:[]};}}};
  mountVitrinyNeuralAdmin({app,service,
    requireAdmin:(req,res,next)=>req.get('x-fixture-admin')==='yes'?next():res.status(401).json({error:'admin_required'}),
    sameOriginOnly:(req,res,next)=>req.get('origin')==='https://vitrinecity.test'?next():res.status(403).json({error:'origin_blocked'})});
  const server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
  const url=`http://127.0.0.1:${server.address().port}/api/admin/vitriny-neural/model/preflight`;
  async function request({headers={},body={},query=''}={}){
    const response=await fetch(url+query,{method:'POST',headers:{'x-fixture-admin':'yes',origin:'https://vitrinecity.test','content-type':'application/json','x-neural-request':'1',...headers},body:JSON.stringify(body)});
    const text=await response.text();assert.equal(response.headers.get('cache-control'),'no-store');assert.ok(!text.includes(secret));return response.status;
  }
  try{
    assert.equal(await request({headers:{'x-fixture-admin':''}}),401);
    assert.equal(await request({headers:{origin:'https://other.test'}}),403);
    assert.equal(await request({headers:{'x-neural-request':''}}),403);
    assert.equal(await request({headers:{'content-type':'text/plain'}}),403);
    assert.equal(await request({body:{origin:'http://attacker.test'}}),400);
    assert.equal(await request({body:[]}),400);
    assert.equal(await request({query:'?model=other'}),400);assert.equal(checks,0);
    assert.equal(await request(),200);assert.equal(checks,1);
    fail=true;assert.equal(await request(),503);
    service.taskDiagnostics=null;assert.equal(await request(),503);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('admin control has an explicit accessible action and displays only text',()=>{
  const html=readFileSync(new URL('../public/admin-vitriny-neural.html',import.meta.url),'utf8');
  const js=readFileSync(new URL('../public/vitriny-neural-admin.js',import.meta.url),'utf8');
  assert.match(html,/<button id="model-preflight" type="button">Verificar modelo local<\/button>/);
  assert.match(html,/id="model-preflight-result" aria-live="polite"/);
  assert.match(js,/api\('\/model\/preflight','POST',\{\}\)/);assert.match(js,/'x-neural-request':'1'/);
  assert.doesNotMatch(js,/innerHTML|insertAdjacentHTML|\beval\s*\(|new Function/);
});
