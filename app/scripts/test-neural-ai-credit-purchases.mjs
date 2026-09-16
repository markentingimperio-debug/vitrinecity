import assert from 'node:assert/strict';
import {test} from 'node:test';
import Database from 'better-sqlite3';
import express from 'express';
import {createAiCreditWallet} from '../vitriny-neural/ai-credit-wallet.js';
import {createAiCreditPurchases,mountAiCreditPurchases,AI_PURCHASE_TERMS,assertAiPurchaseStatus} from '../vitriny-neural/ai-credit-purchases.js';

const START=Date.parse('2026-09-14T17:00:00.000Z'),SCOPE='store:sample-shop',ACCOUNT='123456789';
function fixture(extra={}){
  const db=new Database(':memory:');let time=START,calls=0,lastPreference;
  const wallet=createAiCreditWallet({db,enabled:true,now:()=>time});
  const purchases=createAiCreditPurchases({db,wallet,enabled:true,expectedCollectorId:ACCOUNT,paymentReady:()=>true,now:()=>time,
    createPreference:async order=>{calls++;lastPreference=order;return {id:'fixture-preference',init_point:'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=fixture',collector_id:ACCOUNT};},
    fetchPayment:async()=>{throw Error('mock network not provided');},searchPayments:async()=>({results:[]}),...extra});
  return {db,wallet,purchases,setTime:n=>{time=n;},get calls(){return calls;},get preference(){return lastPreference;}};
}
const input=(changes={})=>({amountCents:1000,key:'fixture-checkout-key',termsAccepted:true,termsVersion:AI_PURCHASE_TERMS.version,...changes});
const receipt=(reference,changes={})=>({id:'987654321',collector_id:ACCOUNT,external_reference:reference,transaction_amount:10,transaction_amount_refunded:0,
  currency_id:'BRL',live_mode:true,status:'approved',date_last_updated:new Date(START).toISOString(),...changes});

test('separate prepaid checkout creates one intent and duplicate clicks never create another preference',async()=>{
  const f=fixture();try{
    const first=await f.purchases.checkout(SCOPE,input()),again=await f.purchases.checkout(SCOPE,input());
    assert.equal(first.order.status,'pending');assert.equal(again.duplicate,true);assert.equal(again.order.reference,first.order.reference);assert.equal(f.calls,1);
    assert.equal(f.wallet.status(SCOPE).availableMicroBrl,0);assert.equal(f.preference.amountCents,1000);
    assert.equal(f.preference.returnPath,`/neural-workspace.html?store=sample-shop&purchase=${first.order.reference}`);
    assert.equal(f.db.prepare("SELECT name FROM sqlite_master WHERE name IN ('wallets','credit_orders','neural_billing_periods')").all().length,0);
    assert.throws(()=>f.purchases.order('store:other',first.order.reference),{code:'ai_purchase_not_found'});
    await assert.rejects(()=>f.purchases.checkout(SCOPE,input({amountCents:2500})),{code:'ai_purchase_conflict'});
  }finally{f.db.close();}
});

test('unknown preference submission is held and never retried, even with same idempotency key',async()=>{
  let calls=0;const f=fixture({createPreference:async()=>{calls++;throw Error('lost response');}});try{
    const first=await f.purchases.checkout(SCOPE,input());assert.equal(first.order.status,'payment_unknown');assert.equal(first.order.checkoutUrl,null);
    const duplicate=await f.purchases.checkout(SCOPE,input());assert.equal(duplicate.duplicate,true);assert.equal(calls,1);
    f.purchases.reconcileVerifiedPayment(receipt(first.order.reference));
    assert.equal(f.wallet.status(SCOPE).availableMicroBrl,10_000_000);
  }finally{f.db.close();}
});

test('checkout requires exact terms, fixed presets, merchant identity and excludes injected fields',async()=>{
  const f=fixture();try{
    for(const bad of [input({amountCents:1500}),input({amountCents:'1000'}),input({termsAccepted:'true'}),input({termsVersion:'old'}),{...input(),scope:'store:other'}])await assert.rejects(()=>f.purchases.checkout(SCOPE,bad));
    await assert.rejects(()=>f.purchases.checkout('user:123',input()),{code:'ai_purchase_scope_denied'});assert.equal(f.calls,0);
    assertAiPurchaseStatus(f.purchases.status(SCOPE));
    assert.match(f.purchases.status(SCOPE).terms.refunds,/Direitos legais/);
  }finally{f.db.close();}
  const unavailable=fixture({expectedCollectorId:''});try{assert.equal(unavailable.purchases.status(SCOPE).canPurchase,false);await assert.rejects(()=>unavailable.purchases.checkout(SCOPE,input()),{code:'ai_purchase_unavailable'});}finally{unavailable.db.close();}
});

test('approved authenticated receipts grant the full top-up once, never take an extra 15 percent',async()=>{
  const f=fixture();try{
    const {order}=await f.purchases.checkout(SCOPE,input());
    f.purchases.reconcileVerifiedPayment(receipt(order.reference));f.purchases.reconcileVerifiedPayment(receipt(order.reference));
    assert.equal(f.wallet.status(SCOPE).availableMicroBrl,10_000_000);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM neural_ai_credit_lots').get().n,1);
    const lot=f.db.prepare('SELECT * FROM neural_ai_credit_lots').get();assert.equal(lot.expires_at,START+60*86400000);assert.equal(lot.scope,SCOPE);
    const status=f.purchases.status(SCOPE);assert.equal(status.availableMicro,10_000_000);assert.equal(status.orders[0].checkoutUrl,null);
  }finally{f.db.close();}
});

test('receipt must match merchant, live mode, exact amount, currency, reference and numeric payment ID',async()=>{
  const f=fixture();try{
    const {order}=await f.purchases.checkout(SCOPE,input());
    for(const bad of [{collector_id:'999'},{collector_id:null},{live_mode:false},{transaction_amount:9.99},{currency_id:'USD'},{id:'../foo'},{date_last_updated:'bad'},{transaction_amount_refunded:11}]){
      assert.throws(()=>f.purchases.reconcileVerifiedPayment(receipt(order.reference,bad)),{code:'ai_purchase_payment_mismatch'});
    }
    assert.equal(f.wallet.status(SCOPE).availableMicroBrl,0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM neural_ai_purchase_receipts').get().n,0);
    assert.equal(f.purchases.reconcileVerifiedPayment(receipt('ai_00000000-0000-0000-0000-000000000000')).reason,'order_not_found');
  }finally{f.db.close();}
});

test('payment IDs cannot fund two orders or another tenant',async()=>{
  const f=fixture();try{
    const a=await f.purchases.checkout(SCOPE,input()),b=await f.purchases.checkout('store:other',input());
    f.purchases.reconcileVerifiedPayment(receipt(a.order.reference));
    assert.throws(()=>f.purchases.reconcileVerifiedPayment(receipt(b.order.reference)),{code:'ai_purchase_payment_mismatch'});
    assert.equal(f.wallet.status('store:other').availableMicroBrl,0);
  }finally{f.db.close();}
});

test('receipt and lot grant roll back atomically on a ledger-write failure',async()=>{
  const f=fixture();try{
    const {order}=await f.purchases.checkout(SCOPE,input());
    f.db.exec("CREATE TRIGGER fixture_break_grant BEFORE INSERT ON neural_ai_credit_events BEGIN SELECT RAISE(ABORT,'fixture'); END");
    assert.throws(()=>f.purchases.reconcileVerifiedPayment(receipt(order.reference)));
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM neural_ai_purchase_receipts').get().n,0);assert.equal(f.wallet.status(SCOPE).availableMicroBrl,0);
    f.db.exec('DROP TRIGGER fixture_break_grant');f.purchases.reconcileVerifiedPayment(receipt(order.reference));assert.equal(f.wallet.status(SCOPE).availableMicroBrl,10_000_000);
  }finally{f.db.close();}
});

test('refunded/disputed receipts freeze scope without erasing in-flight reservations or creating negative balances',async()=>{
  const f=fixture();try{
    const {order}=await f.purchases.checkout(SCOPE,input());f.purchases.reconcileVerifiedPayment(receipt(order.reference));
    f.wallet.reserve(SCOPE,{requestId:'fixture-request-1',maximumMicroBrl:3_000_000,quoteId:'quote-fixture',requestHash:'a'.repeat(64)});
    f.setTime(START+1000);f.purchases.reconcileVerifiedPayment(receipt(order.reference,{status:'refunded',transaction_amount_refunded:10,date_last_updated:new Date(START+1000).toISOString()}));
    let s=f.wallet.status(SCOPE);assert.equal(s.availableMicroBrl,0);assert.equal(s.frozenMicroBrl,7_000_000);assert.equal(s.reservedMicroBrl,3_000_000);
    assert.throws(()=>f.wallet.reserve(SCOPE,{requestId:'fixture-request-2',maximumMicroBrl:1,quoteId:'quote-fixture',requestHash:'b'.repeat(64)}),{code:'ai_wallet_frozen'});
    f.wallet.settle(SCOPE,'fixture-request-1',{actualMicroBrl:2_000_000,receiptId:'openai:fixture-receipt'});
    s=f.wallet.status(SCOPE);assert.equal(s.chargedMicroBrl,2_000_000);assert.equal(s.frozenMicroBrl,8_000_000);assert.equal(s.reservedMicroBrl,0);
    f.setTime(START+2000);assert.equal(f.purchases.reconcileVerifiedPayment(receipt(order.reference,{date_last_updated:new Date(START+2000).toISOString()})).reason,'terminal_payment');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM neural_ai_credit_lots').get().n,1);
    await assert.rejects(()=>f.purchases.checkout(SCOPE,input({key:'another-purchase-key'})),{code:'ai_purchase_frozen'});
  }finally{f.db.close();}
});

test('stale events cannot revoke paid order and a failed second payment cannot change it',async()=>{
  const f=fixture();try{
    const {order}=await f.purchases.checkout(SCOPE,input());f.purchases.reconcileVerifiedPayment(receipt(order.reference));
    assert.equal(f.purchases.reconcileVerifiedPayment(receipt(order.reference,{status:'pending',date_last_updated:new Date(START-1000).toISOString()})).reason,'older_payment');
    f.purchases.reconcileVerifiedPayment(receipt(order.reference,{id:'987654322',status:'rejected'}));
    assert.equal(f.purchases.order(SCOPE,order.reference).status,'approved');assert.equal(f.wallet.status(SCOPE).frozen,false);
    f.purchases.reconcileVerifiedPayment(receipt(order.reference,{id:'987654323'}));
    assert.equal(f.wallet.status(SCOPE).frozen,true);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM neural_ai_credit_lots').get().n,1);
  }finally{f.db.close();}
});

test('partial refunds freeze scope even when the provider status still says approved',async()=>{
  const f=fixture();try{
    const {order}=await f.purchases.checkout(SCOPE,input());f.purchases.reconcileVerifiedPayment(receipt(order.reference,{transaction_amount_refunded:1}));
    assert.equal(f.wallet.status(SCOPE).frozen,true);assert.equal(f.wallet.status(SCOPE).availableMicroBrl,0);assert.equal(f.purchases.order(SCOPE,order.reference).status,'review_required');
  }finally{f.db.close();}
});

test('refresh performs read-only authenticated payment lookup, requires exact returned ID and is throttled',async()=>{
  let reference,calls=0,fetches=0;const f=fixture({searchPayments:async()=>{calls++;return {results:[{id:'987654321',external_reference:reference,status:'approved'}]};},fetchPayment:async()=>{fetches++;return receipt(reference);}});
  try{
    reference=(await f.purchases.checkout(SCOPE,input())).order.reference;await f.purchases.refresh(SCOPE,reference);await f.purchases.refresh(SCOPE,reference);
    assert.equal(calls,1);assert.equal(fetches,1);assert.equal(f.wallet.status(SCOPE).availableMicroBrl,10_000_000);
  }finally{f.db.close();}
});

test('checkout rejects non-MercadoPago response links without exposing them or retrying',async()=>{
  for(const url of ['https://mercadopago.com.evil.test/pay','https://www.mercadopago.com.br@evil.test','http://www.mercadopago.com.br/pay','https://www.mercadopago.com.br:444/pay']){
    const f=fixture({createPreference:async()=>({id:'pref',init_point:url})});try{
      const result=await f.purchases.checkout(SCOPE,input());assert.equal(result.order.status,'payment_unknown');assert.equal(result.order.checkoutUrl,null);
    }finally{f.db.close();}
  }
});

test('mounted routes enforce authenticated scopes, JSON/origin headers and cross-tenant order protection',async()=>{
  const f=fixture(),app=express();app.use(express.json());
  mountAiCreditPurchases({app,purchases:f.purchases,requireAdmin:(req,res,next)=>{if(req.get('x-fixture-admin')!=='yes')return res.sendStatus(401);req.user={id:'owner'};next();},
    sameOriginOnly:(req,res,next)=>req.get('origin')==='https://vitrinecity.com'?next():res.sendStatus(403),
    getAuthorizedStore:req=>req.get('x-fixture-store')===req.params.reference?{storeReference:req.params.reference}:null});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const url=`http://127.0.0.1:${server.address().port}`;
  const base='/api/store-portal/sample-shop/neural/chat/credits',headers={'x-fixture-store':'sample-shop','x-neural-request':'1','content-type':'application/json',origin:'https://vitrinecity.com'};
  try{
    assert.equal((await fetch(url+'/api/admin/vitriny-neural/chat/credits/status')).status,401);
    assert.equal((await fetch(url+base+'/checkout',{method:'POST',headers:{...headers,origin:'https://evil.test'},body:JSON.stringify(input())})).status,403);
    const response=await fetch(url+base+'/checkout',{method:'POST',headers,body:JSON.stringify(input())});assert.equal(response.status,200);const result=await response.json();
    const owned=await fetch(url+base+'/orders/'+result.order.reference,{headers});assert.equal(owned.status,200);
    const other=await fetch(url+'/api/store-portal/other/neural/chat/credits/orders/'+result.order.reference,{headers:{'x-fixture-store':'other'}});assert.equal(other.status,404);
    assert.equal(owned.headers.get('cache-control'),'no-store');
    assertAiPurchaseStatus(await (await fetch(url+base+'/status',{headers})).json());
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));f.db.close();}
});
