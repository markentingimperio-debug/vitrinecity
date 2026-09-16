import assert from 'node:assert/strict';
import {test} from 'node:test';
import Database from 'better-sqlite3';
import {createVitrinyNeuralService} from '../vitriny-neural/service.js';

const report={score:.99,categories:Object.fromEntries(['safety','code','research','growth','commerce','support','ranking'].map(key=>[key,{score:.99}]))};
const actor='test-admin',scope='store:paid-shop';
const actions=[{tool:'route',kind:'website',message:'Site.'},{tool:'files.write',path:'index.html',content:'<!doctype html><h1>Minha loja</h1>'},{tool:'finish',message:'Rascunho para revisão.'}];
function fixture({respond,credits=1000,reserve=100,grant=true,env={}}={}){
  const db=new Database(':memory:');let clock=Date.now(),calls=0;
  const provider={id:'billing-local',modelName:'billing-fixture-v1',local:true,capabilities:['code.plan','growth.content-plan'],
    invoke:async request=>{calls++;return {model:'billing-fixture-v1',...await (respond?respond(request,calls):{text:JSON.stringify(actions[(calls-1)%3]),usage:{prompt_tokens:10,completion_tokens:5}})};}};
  const service=createVitrinyNeuralService({db,providers:[provider],now:()=>clock,env:{VITRINY_NEURAL_ENABLED:'1',VITRINY_NEURAL_MODE:'advisory',VITRINY_NEURAL_TASKS_ENABLED:'1',VITRINY_NEURAL_BILLING_ENABLED:'1',...env}});
  service.recordQualification({providerId:provider.id,modelName:provider.modelName,report});
  service.billing.createPlan({code:'teste-v1',name:'Plano de teste',monthlyCredits:credits,taskReserveCredits:reserve,inputCreditsPer1000:100,outputCreditsPer1000:200},actor);
  const period=grant?service.billing.grantPeriod({scope,planCode:'teste-v1',periodStart:clock-1000,periodEnd:clock+600000,idempotencyKey:'test-period-0001'},actor):null;
  return {db,service,tasks:service.tasks,billing:service.billing,period,calls:()=>calls,advance:ms=>{clock+=ms;},now:()=>clock};
}
const submit=(f,key='request-billing-0001')=>f.tasks.submit(scope,{instruction:'Crie um site para minha loja.',idempotencyKey:key});
async function run(f,key){const item=submit(f,key);f.tasks.start(scope,item.id);await f.tasks.wait(item.id);return f.tasks.get(scope,item.id);}

test('plano de IA permite loja autenticada sem allowlist e liquida tokens, sem dupla cobrança',async()=>{
  const f=fixture();try{
    const item=submit(f);f.tasks.start(scope,item.id);
    assert.equal(f.billing.periodStatus(scope).reservedCredits,100);
    await f.tasks.wait(item.id);
    const done=f.tasks.get(scope,item.id);
    assert.equal(done.status,'draft_ready');assert.equal(done.usage.inputTokens,30);assert.equal(done.usage.outputTokens,15);assert.equal(done.usage.complete,true);
    assert.equal(done.attempts.length,3);assert.equal(done.billing.state,'settled');assert.equal(done.billing.chargedCredits,6);
    assert.equal(f.billing.periodStatus(scope).availableCredits,994);assert.equal(f.billing.periodStatus(scope).reservedCredits,0);
    f.tasks.start(scope,item.id);f.billing.settle(scope,item.id);
    assert.equal(f.billing.ledger(scope).filter(e=>e.type==='settle').length,1);assert.equal(f.calls(),3);
    assert.equal(f.tasks.status(scope).billing.usedCredits,6);
    assert.equal(f.billing.report('store:other-shop',item.id),null);assert.deepEqual(f.tasks.list('store:other-shop'),[]);
    assert.throws(()=>f.tasks.get('store:other-shop',item.id),{code:'task_not_found'});
  }finally{f.db.close();}
});
test('sem período não cria tarefa; saldo insuficiente não inicia nem consome cota',async()=>{
  const missing=fixture({grant:false});try{assert.throws(()=>submit(missing),{code:'billing_subscription_required'});assert.equal(missing.calls(),0);}finally{missing.db.close();}
  const f=fixture({credits:100,reserve:100});try{
    await run(f);const next=submit(f,'request-billing-0002');
    assert.throws(()=>f.tasks.start(scope,next.id),{code:'billing_credits_exhausted'});
    assert.equal(f.tasks.get(scope,next.id).status,'queued');assert.equal(f.billing.report(scope,next.id),null);
    assert.equal(f.tasks.status(scope).usage.dailyRuns,1);assert.equal(f.calls(),3);
  }finally{f.db.close();}
});
test('uso ausente ou parcial interrompe a tarefa e mantém reserva para revisão',async()=>{
  for(const usage of [undefined,{prompt_tokens:10},{prompt_tokens:null,completion_tokens:0}]){
    const f=fixture({respond:async()=>({text:JSON.stringify(actions[0]),usage})});try{
      const done=await run(f);assert.equal(done.status,'failed');assert.equal(done.errorCode,'billing_usage_review_required');
      assert.equal(done.usage.complete,false);assert.equal(done.billing.state,'review_required');assert.equal(done.billing.chargedCredits,0);
      assert.equal(f.billing.periodStatus(scope).reservedCredits,100);assert.equal(f.calls(),1);
      assert.equal(f.tasks.billingCanResolve(scope,done.id),true);
      f.billing.resolve(scope,done.id,{chargeCredits:0,reason:'Conferido no servidor de inferência de teste.',idempotencyKey:'resolve-fixture-0001'},actor);
      assert.equal(f.billing.periodStatus(scope).reservedCredits,0);
      assert.equal(f.billing.periodStatus(scope).availableCredits,1000);
    }finally{f.db.close();}
  }
});
test('erro sem recibo não faz fallback para outra inferência',async()=>{
  let backup=0;const f=fixture({respond:async()=>{throw new Error('provider secret');}});
  try{
    f.service.runtime.skills.registerProvider({id:'billing-backup',modelName:'backup',local:true,capabilities:['code.plan'],invoke:async()=>{backup++;return {text:'backup'};}});
    f.service.recordQualification({providerId:'billing-backup',modelName:'backup',report});
    const done=await run(f);assert.equal(done.billing.state,'review_required');assert.equal(backup,0);assert.equal(f.calls(),1);
    assert.equal(done.attempts[0].state,'failed');assert.equal(JSON.stringify(done).includes('provider secret'),false);
  }finally{f.db.close();}
});
test('modelo divergente interrompe comandos mas liquida o recibo conhecido uma única vez',async()=>{
  const f=fixture({respond:async()=>({model:'unexpected-private-model',text:JSON.stringify(actions[0]),usage:{prompt_tokens:10,completion_tokens:5}})});
  try{
    const done=await run(f);
    assert.equal(done.status,'failed');assert.equal(done.errorCode,'task_provider_unqualified');
    assert.equal(f.calls(),1);assert.equal(done.events.length,0);assert.equal(done.files.length,0);
    assert.equal(done.usage.complete,true);assert.equal(done.billing.chargedCredits,2);
    assert.equal(done.billing.state,'settled');assert.equal(f.billing.ledger(scope).filter(event=>event.type==='settle').length,1);
    assert.doesNotMatch(JSON.stringify(done),/unexpected-private-model/);
  }finally{f.db.close();}
});
test('cancelamento retém reserva até retorno tardio e contabiliza tokens sem gravar artefatos',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture({respond:async()=>{await gate;return {text:JSON.stringify(actions[0]),usage:{prompt_tokens:10,completion_tokens:5}};}});
  try{
    const item=submit(f);f.tasks.start(scope,item.id);await new Promise(resolve=>setImmediate(resolve));f.tasks.cancel(scope,item.id);
    assert.equal(f.billing.report(scope,item.id).state,'review_required');assert.equal(f.tasks.billingCanResolve(scope,item.id),false);
    release();await f.tasks.wait(item.id);
    const done=f.tasks.get(scope,item.id);assert.equal(done.status,'cancelled');assert.equal(done.files.length,0);
    assert.equal(done.usage.inputTokens,10);assert.equal(done.usage.complete,true);assert.equal(done.billing.chargedCredits,2);
    assert.equal(f.billing.periodStatus(scope).reservedCredits,0);assert.equal(f.tasks.billingCanResolve(scope,item.id),true);
  }finally{release();f.db.close();}
});
test('resposta acima da reserva não cobra excedente nem continua',async()=>{
  const f=fixture({reserve:1});try{
    const done=await run(f);assert.equal(done.billing.state,'review_required');assert.equal(done.billing.budgetExceeded,true);
    assert.equal(done.billing.chargedCredits,0);assert.equal(f.calls(),1);assert.equal(f.billing.periodStatus(scope).availableCredits,999);
    assert.throws(()=>f.billing.resolve(scope,done.id,{chargeCredits:2,reason:'Tentativa acima do teto.',idempotencyKey:'resolve-excess-001'},actor),{code:'billing_input_invalid'});
  }finally{f.db.close();}
});
test('limite exato impede próxima etapa; revogação bloqueia próximas chamadas e mantém extrato',async()=>{
  const limited=fixture({reserve:2});try{const done=await run(limited);assert.equal(done.errorCode,'billing_task_budget_exhausted');assert.equal(done.billing.chargedCredits,2);assert.equal(limited.calls(),1);}finally{limited.db.close();}
  let f;f=fixture({respond:async()=>{f.billing.revokePeriod(f.period.id,actor);return {text:JSON.stringify(actions[0]),usage:{prompt_tokens:10,completion_tokens:5}};}});
  try{
    const done=await run(f);assert.equal(done.status,'failed');assert.equal(done.errorCode,'billing_subscription_required');assert.equal(done.billing.chargedCredits,2);assert.equal(f.calls(),1);
    assert.equal(f.tasks.status(scope).billing.active,false);assert.equal(f.tasks.get(scope,done.id).billing.chargedCredits,2);
    assert.throws(()=>submit(f,'request-billing-0002'),{code:'billing_subscription_required'});
  }finally{f.db.close();}
});
test('período novo não paga consumo do anterior e expirado não inicia tarefa',async()=>{
  const f=fixture();try{
    const done=await run(f);f.advance(600000);
    assert.throws(()=>submit(f,'request-billing-0002'),{code:'billing_subscription_required'});
    const period=f.billing.grantPeriod({scope,planCode:'teste-v1',periodStart:f.now(),periodEnd:f.now()+600000,idempotencyKey:'test-period-0002'},actor);
    assert.equal(period.availableCredits,1000);assert.equal(f.tasks.get(scope,done.id).billing.chargedCredits,6);
  }finally{f.db.close();}
});
test('falha antes de enviar ao modelo libera reserva sem consumo',async()=>{
  const f=fixture();try{
    f.service.runtime.skills.setProviderPolicy('billing-local',{enabled:false});
    const item=submit(f);assert.throws(()=>f.tasks.start(scope,item.id),{code:'task_provider_unqualified'});assert.equal(f.billing.report(scope,item.id),null);
    assert.equal(f.billing.periodStatus(scope).availableCredits,1000);assert.equal(f.calls(),0);
  }finally{f.db.close();}
});
test('runtime reconstruído preserva reserva incerta, não repete inferência e exige conciliação',()=>{
  const f=fixture();let restoredDb;
  try{
    const item=submit(f);f.billing.reserve(scope,item.id);
    f.billing.recordAttempt(scope,item.id,{attemptId:'durable-attempt-1',type:'started',provider:'billing-local',modelName:'billing-fixture-v1'});
    f.db.prepare("UPDATE neural_tasks SET status='running',lease_token='old-process',lease_until=?,started_at=? WHERE id=?").run(f.now()+120000,f.now(),item.id);
    f.db.prepare("INSERT INTO neural_task_attempts(id,task_id,provider,model_name,state,created_at,updated_at) VALUES(?,?,?,?,'started',?,?)").run('durable-attempt-1',item.id,'billing-local','billing-fixture-v1',f.now(),f.now());
    // Recreate runtime from persisted SQLite bytes, without any in-memory handles.
    restoredDb=new Database(f.db.serialize());let calls=0;
    const service=createVitrinyNeuralService({db:restoredDb,now:f.now,providers:[{id:'billing-local',modelName:'billing-fixture-v1',local:true,capabilities:['code.plan'],invoke:async()=>{calls++;throw new Error('must not replay');}}],
      env:{VITRINY_NEURAL_ENABLED:'1',VITRINY_NEURAL_MODE:'advisory',VITRINY_NEURAL_TASKS_ENABLED:'1',VITRINY_NEURAL_BILLING_ENABLED:'1'}});
    assert.equal(service.tasks.billingCanResolve(scope,item.id),false);
    f.advance(120001);const recovered=service.tasks.get(scope,item.id);
    assert.equal(recovered.status,'interrupted');assert.equal(recovered.billing.state,'review_required');assert.equal(recovered.billing.heldCredits,100);
    assert.equal(service.tasks.start(scope,item.id).status,'interrupted');assert.equal(calls,0);
    assert.equal(service.tasks.billingCanResolve(scope,item.id),true);
    assert.equal(service.tasks.billingCanResolve(scope,'missing'),false);
    assert.equal(service.tasks.billingCanResolve('store:other-shop',item.id),false);
    service.billing.resolve(scope,item.id,{chargeCredits:0,reason:'Processo de teste confirmado encerrado; sem inferência real.',idempotencyKey:'restart-resolve-0001'},actor);
    assert.equal(service.billing.periodStatus(scope).availableCredits,1000);
  }finally{restoredDb?.close();f.db.close();}
});
