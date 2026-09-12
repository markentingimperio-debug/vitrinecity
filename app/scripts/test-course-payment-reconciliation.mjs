import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHmac,timingSafeEqual} from 'node:crypto';
import vm from 'node:vm';
import express from 'express';
import Database from 'better-sqlite3';
import {setupCoursePaymentReconciliation} from '../course-payment-reconciliation.js';
import {setupSiteSalesExperience} from '../site-sales-experience.js';

const SOURCE=readFileSync(new URL('../server.js',import.meta.url),'utf8');
const extract=(start,end)=>{const a=SOURCE.indexOf(start),b=SOURCE.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return SOURCE.slice(a,b);};
const START=Date.parse('2026-09-11T17:00:00Z'),DAY=86400000;
function fixture(t){
  const db=new Database(':memory:'),app=express();let clock=START,enabled=true,effectsFail=false,providerFail=false,gate=null;
  db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY);CREATE TABLE affiliates(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1);INSERT INTO affiliates VALUES(1);');
  db.exec(extract('CREATE TABLE IF NOT EXISTS course_orders (','CREATE TABLE IF NOT EXISTS managed_courses ('));
  db.exec('CREATE TABLE fixture_affiliate(reference TEXT PRIMARY KEY,status TEXT);CREATE TABLE fixture_analytics(reference TEXT PRIMARY KEY);');
  const experience=setupSiteSalesExperience({app,db,requireAdmin:(_q,r)=>r.sendStatus(403),schedule:false,now:()=>clock});
  const browser={headers:{},user:{id:1}},response={cookie(){}};experience.session(browser,response);experience.markInterest(browser,response,'message');
  const remote=new Map(),calls=[];
  const request=async path=>{
    calls.push(path);if(gate)await gate;if(providerFail)throw Error('PRIVATE_PROVIDER_ERROR');
    if(path.startsWith('/v1/payments/search?')){
      const query=new URL('https://api.mercadopago.com'+path).searchParams;
      return {results:[...remote.values()].filter(p=>p.external_reference===query.get('external_reference')).map(p=>({id:p.id,external_reference:p.external_reference,status:p.status}))};
    }
    const item=remote.get(path.split('/').at(-1));if(!item)throw Error('missing');return structuredClone(item);
  };
  const args={db,request,schedule:false,now:()=>clock,canRun:()=>enabled,onSettlement:(order,payment)=>{
    db.prepare('INSERT INTO fixture_affiliate VALUES(?,?) ON CONFLICT(reference) DO UPDATE SET status=excluded.status').run(order.reference,payment.status);
    if(effectsFail)throw Error('PRIVATE_MEASUREMENT_ERROR');
    if(payment.status==='approved')db.prepare('INSERT OR IGNORE INTO fixture_analytics VALUES(?)').run(order.reference);
    experience.recordPayment({orderType:'course',orderReference:order.reference,status:payment.status,amountCents:order.amount_cents,paymentId:String(payment.id)});
  }};
  const service=setupCoursePaymentReconciliation(args);t.after(()=>{service.close();experience.close();db.close();});
  function seed(reference='course_one',{status='pending',preference='pref-private',age=0,attributed=true}={}){
    db.prepare('INSERT INTO course_orders(reference,user_id,course_slug,course_title,amount_cents,affiliate_id,status,mp_preference_id,created_at) VALUES(?,1,\'canva-para-lojas\',\'Canva para Lojas\',2399,1,?,?,?)')
      .run(reference,status,preference,new Date(clock-age).toISOString());
    if(attributed)experience.captureOrder(browser,{orderType:'course',orderReference:reference});return reference;
  }
  function payment(id='123',reference='course_one',extra={}){return {id,external_reference:reference,status:'approved',currency_id:'BRL',live_mode:true,transaction_amount:23.99,date_last_updated:new Date(clock).toISOString(),date_approved:new Date(clock).toISOString(),...extra};}
  return {db,app,args,service,experience,remote,calls,seed,payment,advance:ms=>clock+=ms,gate:value=>gate=value,failProvider:value=>providerFail=value,failEffects:value=>effectsFail=value,enable:value=>enabled=value,
    order:ref=>db.prepare('SELECT status,mp_payment_id FROM course_orders WHERE reference=?').get(ref||'course_one'),enrollment:ref=>db.prepare('SELECT status FROM course_enrollments WHERE order_reference=?').get(ref||'course_one')};
}

test('a missing webhook is recovered by GET and grants course access, affiliate/analytics and original Lia attribution once',async t=>{
  const f=fixture(t);f.seed();f.remote.set('123',f.payment());
  assert.deepEqual(await f.service.sweep(),{checked:1});assert.equal(f.order().status,'approved');assert.equal(f.enrollment().status,'active');
  assert.equal(f.experience.snapshot().metrics.paidOrders,1);assert.equal(f.experience.snapshot().metrics.revenueCents,2399);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM fixture_analytics').get().n,1);
  assert.equal(f.db.prepare('SELECT status FROM fixture_affiliate').get().status,'approved');
  assert.ok(f.calls[0].startsWith('/v1/payments/search?'));assert.equal(f.calls[1],'/v1/payments/123');
  assert.equal(f.service.settle('course_one',f.payment()).reason,'unchanged');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM course_enrollments').get().n,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM course_payment_receipts').get().n,1);
  assert.equal(f.experience.snapshot().metrics.paidOrders,1);
  const count=f.calls.length;await f.service.sweep();assert.equal(f.calls.length,count,'Durable backoff prevents repeated polls');
});

test('payment validation rejects wrong reference, amount, sub-cent value, currency, ID, mode and timestamp before writes',t=>{
  const f=fixture(t);f.seed();
  const invalid=[{external_reference:'course_other'},{transaction_amount:0.01},{transaction_amount:23.991},{currency_id:'USD'},{id:'../1'},{id:9007199254740992},{live_mode:false},{live_mode:undefined},{date_last_updated:'invalid'},{date_last_updated:undefined},{status:'unknown'}];
  for(const extra of invalid)assert.equal(f.service.settle('course_one',f.payment('123','course_one',extra)).reason,'payment_mismatch');
  assert.equal(f.order().status,'pending');assert.equal(f.enrollment(),undefined);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM course_payment_receipts').get().n,0);
  assert.equal(f.experience.snapshot().metrics.paidOrders,0);
});

test('sandbox, coin, unknown and preference-less orders cannot receive cash entitlement',t=>{
  const f=fixture(t);f.seed('course_coin_test');f.seed('course_nopref',{preference:''});
  for(const ref of ['course_coin_test','course_nopref','course_missing'])assert.equal(f.service.settle(ref,f.payment('123',ref)).reason,'order_not_eligible');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM course_enrollments').get().n,0);
});

test('a rejected card does not block a different approved payment and another declined card cannot revoke it',t=>{
  const f=fixture(t);f.seed();f.service.settle('course_one',f.payment('100','course_one',{status:'rejected'}));assert.equal(f.order().status,'rejected');
  f.advance(1000);f.service.settle('course_one',f.payment('200'));assert.equal(f.order().status,'approved');assert.equal(f.order().mp_payment_id,'200');
  f.advance(1000);f.service.settle('course_one',f.payment('300','course_one',{status:'rejected'}));assert.equal(f.order().status,'approved');assert.equal(f.order().mp_payment_id,'200');assert.equal(f.enrollment().status,'active');
});

test('mediation revokes access; only newer approval can restore it; refunds and chargebacks resist stale approvals',t=>{
  const f=fixture(t);f.seed();const approved=f.payment();f.service.settle('course_one',approved);
  f.advance(1000);const mediation=f.payment('123','course_one',{status:'in_mediation'});f.service.settle('course_one',mediation);
  assert.equal(f.enrollment().status,'revoked');assert.equal(f.experience.snapshot().metrics.paidOrders,0);
  f.service.settle('course_one',approved);f.service.settle('course_one',{...mediation,status:'approved'});assert.equal(f.order().status,'in_mediation');
  f.advance(1000);f.service.settle('course_one',f.payment());assert.equal(f.enrollment().status,'active');
  f.advance(1000);f.service.settle('course_one',f.payment('123','course_one',{status:'refunded'}));assert.equal(f.enrollment().status,'revoked');assert.equal(f.experience.snapshot().metrics.revenueCents,0);
  f.advance(1000);f.service.settle('course_one',f.payment());assert.equal(f.order().status,'refunded');
  f.service.settle('course_one',f.payment('123','course_one',{status:'charged_back'}));assert.equal(f.order().status,'charged_back');
});

test('provider outage preserves pending state, records a fixed error and backoff survives a new worker instance',async t=>{
  const f=fixture(t);f.seed();f.failProvider(true);await f.service.sweep();
  assert.equal(f.order().status,'pending');assert.equal(f.enrollment(),undefined);
  const state=f.db.prepare('SELECT * FROM course_payment_reconciliation').get();assert.equal(state.last_result,'provider_unavailable');assert.equal(state.attempt_count,1);assert.doesNotMatch(JSON.stringify(state),/PRIVATE/);
  const restarted=setupCoursePaymentReconciliation(f.args);t.after(()=>restarted.close());const before=f.calls.length;await restarted.sweep();assert.equal(f.calls.length,before);
  f.advance(3*60000);f.failProvider(false);f.remote.set('123',f.payment());await restarted.sweep();assert.equal(f.enrollment().status,'active');
});

test('reporting failure never blocks access, rolls back partial effects and is retried durably without provider replay',async t=>{
  const f=fixture(t);f.seed();f.failEffects(true);f.service.settle('course_one',f.payment());
  assert.equal(f.enrollment().status,'active');assert.equal(f.experience.snapshot().metrics.paidOrders,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM fixture_affiliate').get().n,0);
  assert.equal(f.db.prepare('SELECT last_result FROM course_payment_effects').get().last_result,'effects_pending');
  f.failEffects(false);f.advance(61000);const restarted=setupCoursePaymentReconciliation(f.args);t.after(()=>restarted.close());assert.equal(restarted.flushEffects('course_one'),true);
  assert.equal(f.experience.snapshot().metrics.paidOrders,1);assert.equal(f.calls.length,0);
});

test('an already approved legacy order recovers missing access/reporting and keeps the real provider approval time',t=>{
  const f=fixture(t);f.seed();const original=f.payment();f.db.exec("UPDATE course_orders SET status='approved',mp_payment_id='123'");
  f.advance(4*3600000);assert.equal(f.service.settle('course_one',original).reason,'unchanged');
  assert.equal(f.enrollment().status,'active');assert.equal(f.experience.snapshot().metrics.paidOrders,1);
  assert.equal(f.experience.snapshot().recentOrders[0].approvedAt,new Date(START).toISOString());
  const effect=f.db.prepare('SELECT * FROM course_payment_effects').get();
  f.db.exec("UPDATE course_enrollments SET status='revoked'");f.advance(1000);f.service.settle('course_one',original);
  assert.deepEqual(f.db.prepare('SELECT * FROM course_payment_effects').get(),effect);assert.equal(f.enrollment().status,'revoked','Repeated payment does not undo a manual revocation');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM fixture_analytics').get().n,1);
});

test('worker has a persisted per-order lease and one sweep in flight, with only two recent orders per batch',async t=>{
  const f=fixture(t);for(let i=0;i<6;i++)f.seed('course_'+i);f.seed('course_old',{age:8*DAY});f.seed('course_no-pref',{preference:''});
  let release;f.gate(new Promise(resolve=>release=resolve));const first=f.service.sweep();await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await f.service.sweep()).reason,'paused_or_running');const second=setupCoursePaymentReconciliation(f.args);t.after(()=>second.close());
  assert.equal((await second.reconcile('course_0')).reason,'not_due');release();f.gate(null);assert.deepEqual(await first,{checked:2});
  assert.equal(f.calls.length,2);assert.ok(f.calls.every(path=>path.startsWith('/v1/payments/search?')));
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM course_payment_reconciliation WHERE order_reference IN ('course_old','course_no-pref')").get().n,0);
});

test('search results are hints, GET identity and fresh payment details are revalidated',async t=>{
  const f=fixture(t);f.seed();let count=0;
  const instance=setupCoursePaymentReconciliation({...f.args,request:async path=>{
    count++;return path.includes('/search?')?{results:[{id:'111',external_reference:'course_other',status:'approved'},{id:'222',external_reference:'course_one',status:'approved'}]}:f.payment('333');
  }});t.after(()=>instance.close());await instance.sweep();assert.equal(count,2);assert.equal(f.order().status,'pending');assert.equal(f.enrollment(),undefined);
});

test('revocation during provider await wins over an older approved result and no attribution is invented for an unassisted sale',async t=>{
  const f=fixture(t);f.seed('course_one',{attributed:false});const approved=f.payment();f.service.settle('course_one',approved);
  f.remote.set('123',approved);let release;f.gate(new Promise(resolve=>release=resolve));const pending=f.service.reconcile('course_one');await new Promise(resolve=>setImmediate(resolve));
  f.advance(1000);f.service.settle('course_one',f.payment('123','course_one',{status:'refunded'}));
  release();await pending;assert.equal(f.enrollment().status,'revoked');assert.equal(f.experience.snapshot().recentOrders.length,0);
});

test('the real server webhook still requires a valid HMAC before provider GET or course settlement',async t=>{
  const f=fixture(t);f.seed();const app=express();app.use(express.json());let gets=0;
  const secret='fixture-secret-not-production';
  vm.runInNewContext(extract('function validMercadoPagoSignature(','\nconst applyCreditPayment =')+'\n'+extract("app.post('/api/payments/mercadopago/webhook',","\napp.get('/api/orders/:reference'"),{
    app,db:f.db,process:{env:{MERCADOPAGO_WEBHOOK_SECRET:secret,MERCADOPAGO_ACCESS_TOKEN:'fixture-only'}},createHmac,timingSafeEqual,Buffer,console,AbortSignal,
    coursePayments:f.service,mpHeaders:()=>({}),validMarketplaceWebhookRoute:()=>false,
    fetch:async()=>{gets++;return {ok:true,json:async()=>f.payment()};}
  });
  const server=await new Promise(resolve=>{const item=app.listen(0,'127.0.0.1',()=>resolve(item));});t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}/api/payments/mercadopago/webhook?data.id=123&type=payment`;
  assert.equal((await fetch(url,{method:'POST'})).status,401);assert.equal(gets,0);assert.equal(f.order().status,'pending');
  const digest=createHmac('sha256',secret).update('id:123;request-id:fixture-request;ts:123456;').digest('hex');
  const headers={'x-request-id':'fixture-request','x-signature':`ts=123456,v1=${digest}`};
  assert.equal((await fetch(url,{method:'POST',headers})).status,200);assert.equal(gets,1);assert.equal(f.enrollment().status,'active');
  assert.equal((await fetch(url,{method:'POST',headers})).status,200);assert.equal(f.experience.snapshot().metrics.paidOrders,1);
});
