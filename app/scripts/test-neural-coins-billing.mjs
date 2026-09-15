import assert from 'node:assert/strict';
import {test} from 'node:test';
import Database from 'better-sqlite3';
import {createCoinWallet} from '../vitrine-coins-wallet.js';
import {createCoinAiWalletAdapter} from '../vitriny-neural/coin-wallet-adapter.js';
import {createAiCreditPurchases,COIN_PURCHASE_TERMS} from '../vitriny-neural/ai-credit-purchases.js';
import {createAiCreditPricing} from '../vitriny-neural/ai-credit-pricing.js';
import {VITRINE_COINS_POLICY as POLICY,quoteCoinTopup,atomsFromMicroBRL} from '../public/vitrine-coins-contract.js';
const START=Date.parse('2026-09-14T17:00:00.000Z');
function fixture(){
  const db=new Database(':memory:');let time=START,calls=0;
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,is_admin INTEGER,email TEXT,account_status TEXT);INSERT INTO users VALUES(1,1,'admin@example.test','active'),(2,0,'user@example.test','active');`);
  const coins=createCoinWallet({db,enabled:true,now:()=>time}),wallet=createCoinAiWalletAdapter({db,coinWallet:coins,now:()=>time});
  const purchases=createAiCreditPurchases({db,wallet,enabled:true,now:()=>time,expectedCollectorId:'123',paymentReady:()=>true,createPreference:async()=>{calls++;return {id:'fixture',init_point:'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=fixture'};}});
  return {db,coins,wallet,purchases,get calls(){return calls;},advance:n=>time+=n};
}
const input={amountCents:1000,key:'coin-test-order-key',termsAccepted:true,termsVersion:POLICY.version};
const receipt=(ref,more={})=>({id:'456',collector_id:'123',external_reference:ref,transaction_amount:10,currency_id:'BRL',live_mode:true,status:'approved',date_last_updated:new Date(START).toISOString(),...more});
test('canonical recharge takes fee once, 10 BRL buys 81.6 Coins, admin/personal see the same balance',async()=>{
  const f=fixture();try{
    const {order}=await f.purchases.checkout('user:1',input);
    assert.deepEqual([order.feeCents,order.netCents,order.netCoins],[150,850,'81.6']);
    f.purchases.reconcileVerifiedPayment(receipt(order.reference));f.advance(1000);f.purchases.reconcileVerifiedPayment(receipt(order.reference));
    assert.equal(f.coins.status(1).availableCoins,'81.6');assert.equal(f.wallet.status('admin:1').availableMicroBrl,8500000);
    assert.equal(f.purchases.status('user:1').terms,COIN_PURCHASE_TERMS);assert.equal(f.purchases.status('user:1').coinWallet.availableCoins,'81.6');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vitrine_coin_lots').get().n,1);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='neural_ai_credit_lots'").get().n,0);
    assert.throws(()=>f.purchases.status('store:sample'),{code:'ai_purchase_scope_denied'});
    assert.throws(()=>f.wallet.status('admin:2'),{code:'ai_wallet_scope_denied'});
    f.wallet.reserve('user:1',{requestId:'video-test',maximumMicroBrl:2171232,quoteId:'quote-test',requestHash:'a'.repeat(64)});
    assert.throws(()=>f.coins.spend(1,{requestId:'ads-too-much',amountAtoms:atomsFromMicroBRL('7000000'),service:'ads'}),{code:'coin_wallet_insufficient'});
    f.wallet.settle('user:1','video-test',{actualMicroBrl:2171232,receiptId:'kling-video-test'});
    assert.equal(f.coins.status(1).chargedAtoms,atomsFromMicroBRL('2171232'));
    assert.equal(f.coins.status(1).availableCoins,'60.7561728');
    assert.throws(()=>f.coins.restore(1,'video-test',{reason:'not permitted'}));
    f.purchases.reconcileVerifiedPayment(receipt(order.reference,{status:'refunded',date_last_updated:new Date(START+2000).toISOString()}));
    assert.equal(f.wallet.status('admin:1').frozen,true);assert.equal(f.coins.status(1).availableAtoms,'0');
  }finally{f.db.close();}
});
test('new Coins quotes use provider cost only, old quote policy remains 15 percent, malformed override denied',()=>{
  const fx={version:'ptax-20260914',observedAt:new Date(START-1000).toISOString(),usdToBrl:'5.1696'};
  const quote={quoteId:'quote-test',providerId:'kling_api',modelId:'kling-3.0',kind:'video',tariffVersion:'kling-v3-confirmed',tariffEffectiveAt:fx.observedAt,status:'confirmed',quotedAt:new Date(START).toISOString(),expiresAt:new Date(START+600000).toISOString(),requestFingerprint:'a'.repeat(64),totalUsd:'0.42'};
  const request={quoteId:quote.quoteId,providerId:quote.providerId,modelId:quote.modelId,kind:'video',tariffVersion:quote.tariffVersion,fxVersion:fx.version,pricedAt:quote.quotedAt,requestFingerprint:quote.requestFingerprint};
  const config={fxSnapshots:[fx],mediaQuotes:[quote]};
  const current=createAiCreditPricing({...config,billingPolicyVersion:POLICY.version}).priceMedia(request);
  assert.equal(current.customerMicroBRL,'2171232');assert.equal(current.credits,'20.8438272');assert.equal(current.audit.usageMarkupBps,0);
  assert.equal(createAiCreditPricing(config).priceMedia(request).customerMicroBRL,'2496917');
  assert.throws(()=>createAiCreditPricing({...config,billingPolicyVersion:'random'}),{code:'pricing_policy_invalid'});
  assert.throws(()=>createAiCreditPricing({...config,billingPolicyVersion:POLICY.version,creditConversion:{version:'changed',status:'configured',creditsPerBRL:'100'}}));
  assert.equal(quoteCoinTopup(1000).netAtoms,'816000000');
});
test('revoked account stops new dispatch and scope cannot be injected into adapter',()=>{
  const f=fixture();try{
    for(const scope of ['user:01','user:-1','user:999','store:1','user:1:2','admin:2'])assert.equal(f.wallet.allowsScope(scope),false);
    assert.equal(f.wallet.allowsScope('user:2'),true);
    f.db.prepare("UPDATE users SET account_status='suspended' WHERE id=2").run();assert.equal(f.wallet.allowsScope('user:2'),false);
  }finally{f.db.close();}
});
