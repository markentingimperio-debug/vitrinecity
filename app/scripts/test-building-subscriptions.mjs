import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {setupBuildingSubscriptions,BUILDING_TRIAL} from '../building-subscriptions.js';

const start=Date.parse('2026-09-11T16:15:12.789Z');
const input={name:'Teste',email:'USER@example.test',whatsapp:'',businessName:'Loja teste',segment:'Casa',lotCode:'L1',planCode:'basic_monthly_trial',trialConsent:true,trialConsentVersion:BUILDING_TRIAL.version,canResume:()=>true};
function fixture(t,{mutate,postError,readError,gate,trialEnabled,requestExtra}={}){
  const db=new Database(':memory:');db.exec(`CREATE TABLE lot_orders(reference TEXT PRIMARY KEY,name TEXT,email TEXT,whatsapp TEXT,lot_code TEXT,business_name TEXT,segment TEXT,amount_cents INTEGER,affiliate_id INTEGER,status TEXT,plan_code TEXT,billing_type TEXT,mp_subscription_id TEXT,mp_payment_id TEXT,fulfillment_status TEXT DEFAULT 'awaiting_payment',reserved_at TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE store_profiles(order_reference TEXT PRIMARY KEY,review_status TEXT,updated_at TEXT);`);
  let clock=start,reads=0;const calls=[],remote=new Map(),activated=[],payments=[];
  const request=async(path,options={})=>{
    calls.push({path,...options});
    const extra=requestExtra?.(path,options);if(extra!==undefined)return structuredClone(extra);
    if(path==='/preapproval'){
      if(gate)await gate;
      if(postError)throw postError;
      const item={...structuredClone(options.body),id:`mp-${remote.size+1}`,init_point:'https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=1'};
      mutate?.(item);remote.set(item.id,item);return structuredClone(item);
    }
    if(path.startsWith('/preapproval/search'))return {results:[...remote.values()]};
    const item=remote.get(path.split('/').at(-1));if(!item)throw Error('missing');
    if(options.method==='PUT'){item.status=options.body.status;return structuredClone(item);}
    if(readError&&++reads===1)throw readError;return structuredClone(item);
  };
  const service=setupBuildingSubscriptions({db,request,siteUrl:'https://vitrinecity.test',now:()=>clock,trialEnabled:trialEnabled||(()=>true),onActivation:o=>activated.push(o.reference),onPayment:(o,p)=>payments.push(p.id)});
  t.after(()=>{service.close();db.close();});
  return {db,service,remote,calls,activated,payments,advance:ms=>clock+=ms,authorize(order){remote.get(order.mp_subscription_id).status='authorized';return service.reconcile(order.reference);}};
}

test('trial explicitly defers first charge and retains reservation attribution before network',async t=>{
  const f=fixture(t);let captured;
  const {order}=await f.service.create({...input,onReserved:o=>{captured=o;assert.equal(f.calls.length,0);}});
  assert.equal(captured.reference,order.reference);assert.equal(order.trial_until,'2026-10-11T16:15:12.000Z');
  assert.equal(f.calls[0].body.auto_recurring.transaction_amount,10);assert.equal(f.calls[0].body.auto_recurring.start_date,order.trial_until);
  assert.equal(f.calls[0].body.status,'pending');assert.equal(f.calls[0].idempotencyKey,order.reference);
  assert.equal(f.service.details(order).trialActive,false);assert.equal(f.service.details(order).paymentReceived,false);
  assert.equal(f.db.prepare('SELECT email FROM building_trial_claims').get().email,'user@example.test');
});
test('missing consent, wrong version and disabled offer never create a provider draft',async t=>{
  const f=fixture(t);for(const change of [{trialConsent:false},{trialConsentVersion:'old'}])await assert.rejects(f.service.create({...input,...change}),e=>e.code==='trial_consent_required');
  assert.equal(f.calls.length,0);const off=fixture(t,{trialEnabled:()=>false});await assert.rejects(off.service.create(input));assert.equal(off.calls.length,0);
});
test('regular monthly plan keeps normal first charge with no trial metadata',async t=>{
  const f=fixture(t);const {order}=await f.service.create({...input,planCode:'basic_monthly',trialConsent:false});
  assert.equal(f.calls[0].body.auto_recurring.start_date,undefined);assert.equal(order.trial_until,null);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM building_trial_claims').get().n,0);
});
test('same pending email reuses verified checkout, while consumed email cannot obtain another trial',async t=>{
  const f=fixture(t);const first=await f.service.create(input);const again=await f.service.create({...input,email:'user@example.test'});
  assert.equal(again.replayed,true);assert.equal(again.order.reference,first.order.reference);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
  await f.authorize(first.order);await f.service.cancel(first.order.reference);
  await assert.rejects(f.service.create({...input,lotCode:'L2'}),e=>e.code==='trial_already_used');
});
test('simultaneous calls reserve the lot before the first provider response',async t=>{
  let release;const gate=new Promise(resolve=>release=resolve),f=fixture(t,{gate});
  const first=f.service.create(input);
  await assert.rejects(f.service.create({...input,email:'second@example.test'}),e=>e.code==='lot_reserved');
  release();await first;assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
});
test('knowing an email cannot recover another visitor checkout or management token',async t=>{
  const f=fixture(t);await f.service.create(input);await assert.rejects(f.service.create({...input,canResume:()=>false}),e=>e.code==='trial_already_used');
  assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
});
test('provider silently dropping or changing trial conditions is cancelled without a checkout URL',async t=>{
  for(const mutate of [s=>delete s.auto_recurring.start_date,s=>s.auto_recurring.transaction_amount=15,s=>s.auto_recurring.currency_id='USD',s=>s.auto_recurring.frequency=2,s=>s.next_payment_date='2026-09-11T16:15:13Z']){
    const f=fixture(t,{mutate});await assert.rejects(f.service.create(input),e=>e.code==='provider_mismatch');
    const order=f.db.prepare('SELECT * FROM lot_orders').get();assert.equal(order.status,'cancelled');assert.equal(order.mp_checkout_url,null);assert.equal([...f.remote.values()][0].status,'cancelled');
  }
});
test('provider date precision is accepted and agreed first charge date remains immutable',async t=>{
  const f=fixture(t,{mutate:s=>{s.auto_recurring.start_date='2026-10-11T16:15:13Z';}});
  const {order}=await f.service.create(input);assert.equal(f.service.details(order).trialUntil,'2026-10-11T16:15:12.000Z');
  await f.authorize(order);f.remote.get(order.mp_subscription_id).next_payment_date='2026-11-11T16:15:13Z';await f.service.reconcile(order.reference);
  assert.equal(f.service.get(order.reference).trial_until,'2026-10-11T16:15:12.000Z');
});
test('provider cannot extend the agreed trial to 31 days or a future year',async t=>{
  for(const date of ['2026-10-12T16:15:12Z','2027-10-11T16:15:12Z']){
    const f=fixture(t,{mutate:s=>{s.auto_recurring.start_date=date;}});
    await assert.rejects(f.service.create(input),e=>e.code==='provider_mismatch');
    const order=f.db.prepare('SELECT * FROM lot_orders').get();assert.equal(order.status,'cancelled');assert.equal(order.mp_checkout_url,null);assert.equal(order.trial_until,'2026-10-11T16:15:12.000Z');
  }
});
test('ambiguous network creation retains reservation and never blindly repeats POST',async t=>{
  const f=fixture(t,{postError:Error('timeout')});await assert.rejects(f.service.create(input),e=>e.code==='creation_uncertain');
  f.advance(60*60000);assert.ok(f.service.occupation('L1'));
  await assert.rejects(f.service.create(input),e=>e.code==='creation_pending');assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
});
test('explicit provider rejection releases lot and unused email claim',async t=>{
  const f=fixture(t,{postError:Object.assign(Error('bad input'),{providerStatus:400})});await assert.rejects(f.service.create(input));
  assert.equal(f.service.occupation('L1'),undefined);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM building_trial_claims').get().n,0);
});
test('failed readback can recover the same provider checkout without a second creation',async t=>{
  const f=fixture(t,{readError:Error('temporary')});await assert.rejects(f.service.create(input),e=>e.code==='verification_pending');
  const result=await f.service.create(input);assert.equal(result.replayed,true);assert.ok(result.order.mp_checkout_url);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
});
test('authorization activates trial without revenue and repeat events preserve published fulfillment',async t=>{
  const f=fixture(t);const {order}=await f.service.create(input);const active=await f.authorize(order);
  assert.equal(active.status,'approved');assert.equal(f.service.details(active).trialActive,true);assert.deepEqual(f.payments,[]);
  f.db.prepare("UPDATE lot_orders SET fulfillment_status='published' WHERE reference=?").run(order.reference);
  await f.service.reconcile(order.reference);assert.equal(f.service.get(order.reference).fulfillment_status,'published');assert.equal(f.activated.length,1);
});
test('late authorization cannot take a building already occupied by another order',async t=>{
  const f=fixture(t);const {order}=await f.service.create(input);f.advance(46*60000);
  f.db.prepare("INSERT INTO lot_orders(reference,lot_code,status,created_at) VALUES('owner','L1','approved','2026-09-11T17:00:00Z')").run();
  await assert.rejects(f.authorize(order));assert.equal(f.service.get(order.reference).status,'cancelled');assert.equal(f.service.occupation('L1').reference,'owner');
});
test('pending checkout can cancel and activated cancelled store becomes unpublished',async t=>{
  const f=fixture(t);const {order}=await f.service.create(input);await f.authorize(order);
  f.db.prepare("INSERT INTO store_profiles VALUES(?,'published','')").run(order.reference);
  await f.service.cancel(order.reference);assert.equal(f.service.get(order.reference).status,'cancelled');assert.equal(f.db.prepare('SELECT review_status FROM store_profiles').get().review_status,'subscription_suspended');
  const second=await f.service.create({...input,email:'pending@example.test',lotCode:'L2'});await f.service.cancel(second.order.reference);assert.equal(f.service.get(second.order.reference).status,'cancelled');
});
test('verified paid receipts are idempotent, track refunds, and cannot revive cancelled access',async t=>{
  const f=fixture(t);const {order}=await f.service.create(input);await f.authorize(order);await f.service.cancel(order.reference);
  const p={id:'pay1',external_reference:order.reference,currency_id:'BRL',transaction_amount:10,status:'approved'};
  f.service.recordPayment(p);f.service.recordPayment(p);assert.equal(f.payments.length,1);assert.equal(f.service.get(order.reference).subscription_paid_cents,1000);
  await f.service.reconcile(order.reference);assert.equal(f.service.get(order.reference).status,'cancelled');
  f.service.recordPayment({...p,status:'refunded'});assert.equal(f.service.get(order.reference).subscription_paid_cents,0);
  assert.throws(()=>f.service.recordPayment({...p,id:'bad',transaction_amount:1}),e=>e.code==='payment_mismatch');
});
test('trial expiry without payment suspends publication but retains reservation during reconciliation',async t=>{
  const f=fixture(t);const {order}=await f.service.create(input);await f.authorize(order);f.db.prepare("INSERT INTO store_profiles VALUES(?,'published','')").run(order.reference);
  f.advance(31*86400000);await f.service.reconcile(order.reference);
  assert.equal(f.service.get(order.reference).subscription_status,'awaiting_payment');assert.ok(f.service.occupation('L1'));
  f.service.recordPayment({id:'aftertrial',external_reference:order.reference,currency_id:'BRL',transaction_amount:10,status:'approved'});
  await f.service.reconcile(order.reference);assert.equal(f.service.get(order.reference).status,'approved');assert.equal(f.service.details(f.service.get(order.reference)).paymentReceived,true);
  assert.equal(f.db.prepare('SELECT review_status FROM store_profiles').get().review_status,'published');
});
test('reactivation restores only previously published stores and preserves subsequent admin decisions',async t=>{
  for(const state of ['draft','pending','published']){
    const f=fixture(t);const {order}=await f.service.create(input);await f.authorize(order);f.db.prepare('INSERT INTO store_profiles VALUES(?,?,?)').run(order.reference,state,'');
    f.remote.get(order.mp_subscription_id).status='paused';await f.service.reconcile(order.reference);
    if(state==='published')f.db.prepare("UPDATE store_profiles SET review_status='changes_requested'").run();
    await f.authorize(order);assert.equal(f.db.prepare('SELECT review_status FROM store_profiles').get().review_status,state==='published'?'changes_requested':state);
  }
});
test('recurring invoice event looks up real payment and reconciles receipt exactly once',async t=>{
  let invoice,payment;const f=fixture(t,{requestExtra:path=>path==='/authorized_payments/invoice1'?invoice:path==='/v1/payments/paid1'?payment:undefined});
  const {order}=await f.service.create(input);await f.authorize(order);
  invoice={preapproval_id:order.mp_subscription_id,external_reference:order.reference,currency_id:'BRL',transaction_amount:10,payment:{id:'paid1',status:'approved'}};
  payment={id:'paid1',currency_id:'BRL',transaction_amount:10,status:'approved'};
  await f.service.reconcileInvoice('invoice1');await f.service.reconcileInvoice('invoice1');assert.equal(f.service.get(order.reference).subscription_paid_cents,1000);assert.equal(f.payments.length,1);
  payment.external_reference='another-order';await assert.rejects(f.service.reconcileInvoice('invoice1'),e=>e.code==='invoice_mismatch');
});
test('scheduled invoice alone is not a payment receipt',async t=>{
  let invoice;const f=fixture(t,{requestExtra:path=>path==='/authorized_payments/future'?invoice:undefined});
  const {order}=await f.service.create(input);await f.authorize(order);
  invoice={preapproval_id:order.mp_subscription_id,external_reference:order.reference,currency_id:'BRL',transaction_amount:10,status:'scheduled'};
  await f.service.reconcileInvoice('future');assert.equal(f.service.get(order.reference).subscription_paid_cents,0);assert.equal(f.payments.length,0);
});
test('approval date uses financial approval and survives pending transitions, replays and refunds',async t=>{
  const f=fixture(t);const {order}=await f.service.create(input);const p={id:'timestamp',external_reference:order.reference,currency_id:'BRL',transaction_amount:10,status:'pending'};
  f.service.recordPayment(p);assert.equal(f.db.prepare('SELECT approved_at FROM building_subscription_receipts').get().approved_at,null);
  f.advance(2*86400000);const when='2026-09-13T12:34:56.000Z';f.service.recordPayment({...p,status:'approved',date_approved:when});
  f.advance(86400000);f.service.recordPayment({...p,status:'approved'});f.service.recordPayment({...p,status:'refunded'});
  assert.equal(f.db.prepare('SELECT approved_at FROM building_subscription_receipts').get().approved_at,when);
});
