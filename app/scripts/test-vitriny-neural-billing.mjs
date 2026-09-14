import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {createNeuralBilling} from '../vitriny-neural/billing.js';

const exec=promisify(execFile),START=1_800_000_000_000,DAY=86400000,SCOPE='store:shop-a',ADMIN='admin-1';
const PLAN={code:'pilot-text-v1',name:'Plano de teste, sem preço comercial',monthlyCredits:100,taskReserveCredits:40,inputCreditsPer1000:10,outputCreditsPer1000:20};
function fixture({env={},plan=PLAN,grant=true,db=new Database(':memory:')}={}) {
  let time=START;
  const billing=createNeuralBilling({db,env:{VITRINY_NEURAL_BILLING_ENABLED:'1',...env},now:()=>time});
  if (plan) billing.createPlan(plan,ADMIN);
  if (grant) billing.grantPeriod({scope:SCOPE,planCode:plan.code,periodStart:START,periodEnd:START+30*DAY,idempotencyKey:'grant-request-0001'},ADMIN);
  return {db,billing,setTime:value=>{time=value;}};
}
const start=(billing,taskId,attemptId='attempt-1',extra={})=>billing.recordAttempt(SCOPE,taskId,{attemptId,type:'started',provider:'local-text',modelName:'fixture-v1',...extra});
const done=(billing,taskId,attemptId='attempt-1',extra={})=>billing.recordAttempt(SCOPE,taskId,{attemptId,type:'completed',provider:'local-text',modelName:'fixture-v1',inputTokens:100,outputTokens:100,known:true,durationMs:15,...extra});
const grant=(billing,scope=SCOPE,extra={})=>billing.grantPeriod({scope,planCode:PLAN.code,periodStart:START,periodEnd:START+30*DAY,idempotencyKey:'grant-request-0001',...extra},ADMIN);

test('billing is opt-in, separate from money and Ads tables',()=>{
  const db=new Database(':memory:');
  try {
    db.exec('CREATE TABLE ads_wallets(balance INTEGER); INSERT INTO ads_wallets VALUES(1234)');
    const billing=createNeuralBilling({db,env:{},now:()=>START});
    assert.equal(billing.enabled,false);
    assert.equal(billing.periodStatus(SCOPE).state,'none');
    assert.deepEqual(billing.plans(),[]);
    assert.throws(()=>billing.createPlan(PLAN,ADMIN),{code:'billing_disabled'});
    assert.throws(()=>billing.reserve(SCOPE,'task-a'),{code:'billing_disabled'});
    assert.equal(db.prepare('SELECT balance FROM ads_wallets').get().balance,1234);
  } finally {db.close();}
});
test('strict numeric, scope and metadata validation; immutable plans',()=>{
  const {db,billing}=fixture({plan:null,grant:false});
  try {
    for(const change of [{monthlyCredits:'100'},{monthlyCredits:1.5},{monthlyCredits:Infinity},{monthlyCredits:1_000_000_001},
      {taskReserveCredits:0},{inputCreditsPer1000:-1},{outputCreditsPer1000:null},{code:'../test'},{name:'Bearer abcdefghijklmnopqrstuvwxyz'},
      {unknown:'field'},{taskReserveCredits:101}]) assert.throws(()=>billing.createPlan({...PLAN,...change},ADMIN),{code:'billing_input_invalid'});
    const item=billing.createPlan(PLAN,ADMIN);
    assert.equal(item.monthlyCredits,100);
    assert.equal(billing.createPlan({...PLAN},'another-admin').duplicate,true);
    assert.throws(()=>billing.createPlan({...PLAN,monthlyCredits:200},ADMIN),{code:'billing_plan_conflict'});
    assert.throws(()=>billing.createPlan({...PLAN,code:'new-plan'},'Bearer abcdefghijklmnopqrstuvwxyz'),{code:'billing_input_invalid'});
    for(const scope of ['admin','shop-a','store:../other',null]) assert.throws(()=>billing.periodStatus(scope),{code:'billing_scope_denied'});
    for(const patch of [{periodStart:String(START)},{periodEnd:START},{periodEnd:START+367*DAY},{periodEnd:Number.NaN},{idempotencyKey:'x'},{actorId:'injected'}])
      assert.throws(()=>grant(billing,SCOPE,patch),{code:'billing_input_invalid'});
  } finally {db.close();}
});
test('manual period grants are idempotent, non-overlapping, no automatic renewal',()=>{
  const {db,billing,setTime}=fixture();
  try {
    const period=billing.periodStatus(SCOPE);
    assert.equal(period.active,true);assert.equal(period.periodId,period.id);
    assert.equal(period.grantedCredits,100);assert.equal(period.availableCredits,100);
    assert.equal(grant(billing).duplicate,true);
    assert.throws(()=>grant(billing,SCOPE,{periodEnd:START+31*DAY}),{code:'billing_conflict'});
    assert.throws(()=>grant(billing,SCOPE,{idempotencyKey:'overlap-request-2'}),{code:'billing_period_overlap'});
    assert.throws(()=>grant(billing,SCOPE,{periodStart:START-DAY,periodEnd:START+DAY,idempotencyKey:'overlap-request-3'}),{code:'billing_period_overlap'});
    assert.equal(billing.periods(SCOPE).length,1);
    setTime(START+30*DAY);
    assert.equal(billing.periodStatus(SCOPE).state,'expired');
    assert.equal(billing.periodStatus(SCOPE).spendableCredits,0);
    assert.throws(()=>billing.reserve(SCOPE,'after-expiry'),{code:'billing_subscription_required'});
    grant(billing,SCOPE,{periodStart:START+30*DAY,periodEnd:START+60*DAY,idempotencyKey:'new-period-00002'});
    assert.equal(billing.assertActive(SCOPE).active,true);assert.equal(billing.periods(SCOPE).length,2);
  } finally {db.close();}
});
test('tenant isolation covers balances, grants, reservations, attempts and ledger',()=>{
  const {db,billing}=fixture();
  try {
    billing.reserve(SCOPE,'private-task');start(billing,'private-task');done(billing,'private-task');billing.settle(SCOPE,'private-task');
    assert.equal(billing.periodStatus('store:shop-b').active,false);
    assert.equal(billing.report('store:shop-b','private-task'),null);
    assert.deepEqual(billing.periods('store:shop-b'),[]);assert.deepEqual(billing.ledger('store:shop-b'),[]);
    assert.throws(()=>billing.settle('store:shop-b','private-task'),{code:'billing_reservation_not_found'});
    assert.throws(()=>billing.recordAttempt('store:shop-b','private-task',{attemptId:'attempt-1',type:'started',provider:'local'}),{code:'billing_reservation_not_found'});
    grant(billing,'store:shop-b');
    assert.equal(billing.periodStatus('store:shop-b').usedCredits,0);
    assert.equal(billing.periodStatus(SCOPE).usedCredits,3);
  } finally {db.close();}
});
test('direct scoped period lookup can revoke an active period beyond the latest 20 grants',()=>{
  const {db,billing,setTime}=fixture();try{
    const active=billing.periodStatus(SCOPE);
    for(let n=1;n<=21;n++){
      setTime(START+n);
      grant(billing,SCOPE,{periodStart:START+n*30*DAY,periodEnd:START+(n+1)*30*DAY,idempotencyKey:'future-period-'+String(n).padStart(4,'0')});
    }
    assert.equal(billing.periods(SCOPE).some(item=>item.id===active.id),false);
    assert.equal(billing.getPeriod(SCOPE,active.id).id,active.id);
    assert.throws(()=>billing.getPeriod('store:shop-b',active.id),{code:'billing_period_not_found'});
    billing.revokePeriod(billing.getPeriod(SCOPE,active.id).id,ADMIN);
    assert.equal(billing.periodStatus(SCOPE).active,false);
  }finally{db.close();}
});
test('atomic full reservations cap spend, preserve idempotency and release unused credits',()=>{
  const {db,billing}=fixture();
  try {
    const item=billing.reserve(SCOPE,'task-1');assert.equal(item.reservedCredits,40);
    assert.equal(billing.reserve(SCOPE,'task-1').duplicate,true);
    billing.reserve(SCOPE,'task-2');
    assert.equal(billing.periodStatus(SCOPE).reservedCredits,80);assert.equal(billing.periodStatus(SCOPE).availableCredits,20);
    assert.throws(()=>billing.reserve(SCOPE,'task-3'),{code:'billing_credits_exhausted'});
    start(billing,'task-1');done(billing,'task-1');
    const settled=billing.settle(SCOPE,'task-1');
    assert.equal(settled.state,'settled');assert.equal(settled.chargedCredits,3);assert.equal(settled.heldCredits,0);
    assert.equal(billing.settle(SCOPE,'task-1').duplicate,true);
    assert.equal(billing.periodStatus(SCOPE).availableCredits,57);
    billing.reserve(SCOPE,'task-3');assert.equal(billing.periodStatus(SCOPE).availableCredits,17);
    assert.throws(()=>start(billing,'task-1','another-attempt'),{code:'billing_reservation_closed'});
    const ledger=billing.ledger(SCOPE);
    assert.equal(ledger.reduce((n,event)=>n+event.deltaUsed,0),3);
    assert.equal(ledger.reduce((n,event)=>n+event.deltaReserved,0),80);
    assert.equal(ledger.filter(event=>event.type==='settle').length,1);
  } finally {db.close();}
});
test('rounding uses total input and output tokens separately, not each attempt',()=>{
  const {db,billing}=fixture({plan:{...PLAN,inputCreditsPer1000:1,outputCreditsPer1000:1}});
  try {
    billing.reserve(SCOPE,'task-round');
    for(const n of [1,2,3]) {start(billing,'task-round',`attempt-${n}`);done(billing,'task-round',`attempt-${n}`,{inputTokens:1,outputTokens:1});}
    const result=billing.settle(SCOPE,'task-round');
    assert.equal(result.inputTokens,3);assert.equal(result.outputTokens,3);assert.equal(result.chargedCredits,2);
    assert.equal(result.knownAttempts,3);assert.equal(result.usageComplete,true);
  } finally {db.close();}
});
test('attempt metadata is immutable, idempotent and contains no prompts or output text',()=>{
  const {db,billing}=fixture();
  try {
    billing.reserve(SCOPE,'task-events');
    start(billing,'task-events');assert.equal(start(billing,'task-events').duplicate,true);
    assert.throws(()=>start(billing,'task-events','attempt-1',{provider:'changed'}),{code:'billing_attempt_conflict'});
    assert.throws(()=>done(billing,'task-events','missing-start'),{code:'billing_attempt_conflict'});
    assert.throws(()=>done(billing,'task-events','attempt-1',{modelName:'other-model'}),{code:'billing_attempt_conflict'});
    assert.throws(()=>done(billing,'task-events','attempt-1',{inputTokens:'5'}),{code:'billing_input_invalid'});
    assert.throws(()=>done(billing,'task-events','attempt-1',{known:false}),{code:'billing_input_invalid'});
    assert.throws(()=>start(billing,'task-events','attempt-2',{prompt:'customer data'}),{code:'billing_input_invalid'});
    assert.throws(()=>start(billing,'task-events','attempt-2',{modelName:'Bearer abcdefghijklmnopqrstuvwxyz'}),{code:'billing_input_invalid'});
    done(billing,'task-events');assert.equal(done(billing,'task-events').duplicate,true);
    assert.throws(()=>done(billing,'task-events','attempt-1',{inputTokens:9}),{code:'billing_attempt_conflict'});
    assert.throws(()=>done(billing,'task-events','attempt-1',{type:'failed'}),{code:'billing_attempt_conflict'});
    const events=db.prepare('SELECT * FROM neural_billing_attempt_events').all();assert.equal(events.length,2);
    assert.equal(events[0].model_name,'fixture-v1');assert.ok(!Object.hasOwn(events[0],'prompt'));assert.ok(!Object.hasOwn(events[0],'output_text'));
  } finally {db.close();}
});
test('missing usage and unknown failures hold allowance for explicit review, never silently cost zero',()=>{
  const {db,billing}=fixture();
  try {
    billing.reserve(SCOPE,'task-unknown');start(billing,'task-unknown');
    done(billing,'task-unknown','attempt-1',{type:'failed',known:false,inputTokens:null,outputTokens:null});
    assert.equal(billing.report(SCOPE,'task-unknown').state,'review_required');
    assert.throws(()=>start(billing,'task-unknown','fallback-attempt'),{code:'billing_usage_review_required'});
    const result=billing.settle(SCOPE,'task-unknown');
    assert.equal(result.state,'review_required');assert.equal(result.usageComplete,false);
    assert.equal(result.chargedCredits,0);assert.equal(result.heldCredits,40);
    assert.equal(billing.periodStatus(SCOPE).availableCredits,60);
    billing.settle(SCOPE,'task-unknown');
    assert.equal(billing.ledger(SCOPE).filter(event=>event.type==='review_required').length,1);
  } finally {db.close();}
});
test('cancellation or crash with an unfinished attempt stays reserved; late known usage can settle',()=>{
  const {db,billing}=fixture();
  try {
    billing.reserve(SCOPE,'task-late');start(billing,'task-late');
    assert.equal(billing.report(SCOPE,'task-late').state,'reserved');
    assert.equal(billing.settle(SCOPE,'task-late').state,'review_required');
    assert.equal(billing.periodStatus(SCOPE).reservedCredits,40);
    done(billing,'task-late');
    assert.equal(billing.settle(SCOPE,'task-late').state,'settled');
    assert.equal(billing.periodStatus(SCOPE).usedCredits,3);
    billing.reserve(SCOPE,'never-invoked');
    assert.equal(billing.settle(SCOPE,'never-invoked').chargedCredits,0);
  } finally {db.close();}
});
test('known failed attempt is charged once together with successful fallback',()=>{
  const {db,billing}=fixture();
  try {
    billing.reserve(SCOPE,'task-fallback');start(billing,'task-fallback','try-1');
    done(billing,'task-fallback','try-1',{type:'failed',inputTokens:100,outputTokens:0});
    start(billing,'task-fallback','try-2');done(billing,'task-fallback','try-2');
    assert.equal(billing.settle(SCOPE,'task-fallback').chargedCredits,4);
    assert.equal(billing.periodStatus(SCOPE).usedCredits,4);
  } finally {db.close();}
});
test('measured overrun never debits beyond reservation or makes balance negative',()=>{
  const {db,billing}=fixture();
  try {
    billing.reserve(SCOPE,'task-overrun');start(billing,'task-overrun');
    done(billing,'task-overrun','attempt-1',{inputTokens:10000,outputTokens:10000});
    const result=billing.settle(SCOPE,'task-overrun');
    assert.equal(result.measuredCredits,300);assert.equal(result.budgetExceeded,true);
    assert.equal(result.state,'review_required');assert.equal(result.chargedCredits,0);
    assert.equal(billing.periodStatus(SCOPE).availableCredits,60);
    assert.throws(()=>start(billing,'task-overrun','new-attempt'),{code:'billing_usage_review_required'});
    assert.throws(()=>billing.resolve(SCOPE,'task-overrun',{chargeCredits:41,reason:'Custo excedente confirmado',idempotencyKey:'resolve-overrun-1'},ADMIN),{code:'billing_input_invalid'});
  } finally {db.close();}
});
test('an exactly exhausted task budget blocks new attempts but can settle measured usage',()=>{
  const {db,billing}=fixture();
  try {
    billing.reserve(SCOPE,'task-exact');start(billing,'task-exact');
    done(billing,'task-exact','attempt-1',{inputTokens:0,outputTokens:2000});
    assert.equal(billing.report(SCOPE,'task-exact').measuredCredits,40);
    assert.throws(()=>billing.assertRunnable(SCOPE,'task-exact'),{code:'billing_task_budget_exhausted'});
    assert.throws(()=>start(billing,'task-exact','next'),{code:'billing_task_budget_exhausted'});
    assert.equal(billing.settle(SCOPE,'task-exact').chargedCredits,40);
  } finally {db.close();}
});
test('revocation and period rollover deny execution against old entitlement but preserve settlement',()=>{
  const {db,billing,setTime}=fixture();
  try {
    billing.reserve(SCOPE,'before-revoke');start(billing,'before-revoke');const first=billing.periodStatus(SCOPE);
    billing.revokePeriod(first.id,ADMIN);assert.equal(billing.revokePeriod(first.id,ADMIN).duplicate,true);
    assert.equal(billing.periodStatus(SCOPE).active,false);assert.equal(billing.periodStatus(SCOPE).reservedCredits,40);
    assert.throws(()=>billing.assertRunnable(SCOPE,'before-revoke'),{code:'billing_subscription_required'});
    assert.throws(()=>billing.reserve(SCOPE,'after-revoke'),{code:'billing_subscription_required'});
    assert.throws(()=>grant(billing,SCOPE,{idempotencyKey:'replacement-0001'}),{code:'billing_period_overlap'});
    done(billing,'before-revoke');assert.equal(billing.settle(SCOPE,'before-revoke').chargedCredits,3);
    grant(billing,SCOPE,{periodStart:START+30*DAY,periodEnd:START+60*DAY,idempotencyKey:'period-next-0001'});
    setTime(START+30*DAY);billing.reserve(SCOPE,'at-next-period');start(billing,'at-next-period');
    setTime(START+60*DAY);
    grant(billing,SCOPE,{periodStart:START+60*DAY,periodEnd:START+90*DAY,idempotencyKey:'period-third-001'});
    assert.equal(billing.assertActive(SCOPE).active,true);
    assert.throws(()=>billing.assertRunnable(SCOPE,'at-next-period'),{code:'billing_subscription_required'});
    done(billing,'at-next-period');billing.settle(SCOPE,'at-next-period');
    assert.equal(billing.periodStatus(SCOPE).usedCredits,0);
  } finally {db.close();}
});
test('manual resolution is audited, idempotent, bounded and unaffected by late usage',()=>{
  const {db,billing}=fixture();
  try {
    billing.reserve(SCOPE,'task-review');start(billing,'task-review');billing.settle(SCOPE,'task-review');
    const payload={chargeCredits:5,reason:'Reconciliação manual com evidência externa',idempotencyKey:'resolve-request-0001'};
    const result=billing.resolve(SCOPE,'task-review',payload,ADMIN);
    assert.equal(result.state,'reconciled');assert.equal(result.chargedCredits,5);assert.equal(result.heldCredits,0);
    assert.equal(billing.resolve(SCOPE,'task-review',payload,ADMIN).duplicate,true);
    assert.throws(()=>billing.resolve(SCOPE,'task-review',{...payload,chargeCredits:6},ADMIN),{code:'billing_conflict'});
    done(billing,'task-review');assert.equal(billing.settle(SCOPE,'task-review').chargedCredits,5);
    assert.equal(billing.periodStatus(SCOPE).usedCredits,5);
    const event=billing.ledger(SCOPE).find(event=>event.type==='reconcile');
    assert.equal(event.actorId,ADMIN);assert.equal(event.amountCredits,5);assert.equal(event.reason,payload.reason);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM neural_billing_resolutions').get().n,1);
    assert.throws(()=>start(billing,'task-review','late-start'),{code:'billing_reservation_closed'});
  } finally {db.close();}
});
test('credit mutations participate in outer engine transactions with rollback',()=>{
  const {db,billing}=fixture();
  try {
    assert.throws(()=>db.transaction(()=>{
      billing.reserve(SCOPE,'rolled-back');start(billing,'rolled-back');throw new Error('fixture rollback');
    }).immediate(),/fixture rollback/);
    assert.equal(billing.report(SCOPE,'rolled-back'),null);assert.equal(billing.periodStatus(SCOPE).availableCredits,100);
    assert.equal(billing.ledger(SCOPE).length,1);
    db.transaction(()=>{billing.reserve(SCOPE,'committed');start(billing,'committed');}).immediate();
    assert.equal(billing.periodStatus(SCOPE).reservedCredits,40);
  } finally {db.close();}
});
test('extreme token-rate products stay exact and trigger review rather than unsafe integer debit',()=>{
  const {db,billing}=fixture({plan:{...PLAN,monthlyCredits:1_000_000_000,taskReserveCredits:1_000_000_000,inputCreditsPer1000:1_000_000_000,outputCreditsPer1000:1_000_000_000}});
  try {
    billing.reserve(SCOPE,'extreme');
    for(let i=0;i<10;i++)start(billing,'extreme',`attempt-${i}`);
    for(let i=0;i<10;i++)done(billing,'extreme',`attempt-${i}`,{inputTokens:1_000_000_000,outputTokens:1_000_000_000});
    const result=billing.settle(SCOPE,'extreme');
    assert.equal(result.measuredCredits,null);assert.equal(result.measuredCreditsExact,'20000000000000000');
    assert.equal(result.measurementOverflow,true);assert.equal(result.state,'review_required');
    assert.equal(billing.periodStatus(SCOPE).usedCredits,0);assert.equal(billing.periodStatus(SCOPE).availableCredits,0);
  } finally {db.close();}
});
test('two independent processes cannot reserve more than the same SQLite allowance',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'neural-billing-concurrency-')),file=join(directory,'credits.sqlite');
  const db=new Database(file);
  try {
    db.pragma('journal_mode = WAL');
    fixture({db,plan:{...PLAN,taskReserveCredits:60}});
    const moduleUrl=new URL('../vitriny-neural/billing.js',import.meta.url).href;
    const child=task=>`import Database from 'better-sqlite3'; import {createNeuralBilling} from ${JSON.stringify(moduleUrl)}; const db=new Database(${JSON.stringify(file)},{timeout:5000}); const b=createNeuralBilling({db,env:{VITRINY_NEURAL_BILLING_ENABLED:'1'},now:()=>${START}}); try {b.reserve(${JSON.stringify(SCOPE)},${JSON.stringify(task)});process.stdout.write('reserved');}catch(error){process.stdout.write(error.code||'unexpected');}finally{db.close();}`;
    const results=await Promise.all(['parallel-a','parallel-b'].map(task=>exec(process.execPath,['--input-type=module','-e',child(task)],{cwd:fileURLToPath(new URL('..',import.meta.url))})));
    assert.deepEqual(results.map(result=>result.stdout).sort(),['billing_credits_exhausted','reserved']);
    const billing=createNeuralBilling({db,env:{VITRINY_NEURAL_BILLING_ENABLED:'1'},now:()=>START});
    assert.equal(billing.periodStatus(SCOPE).reservedCredits,60);assert.equal(billing.periodStatus(SCOPE).availableCredits,40);
  } finally {db.close();rmSync(directory,{recursive:true,force:true});}
});
