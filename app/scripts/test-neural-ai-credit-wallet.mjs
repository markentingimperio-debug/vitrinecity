import assert from 'node:assert/strict';
import {test} from 'node:test';
import Database from 'better-sqlite3';
import {createAiCreditWallet} from '../vitriny-neural/ai-credit-wallet.js';

const DAY=86400000, START=1800000000000, SCOPE='store:example';
function fixture() {
  const db=new Database(':memory:'); let time=START;
  const wallet=createAiCreditWallet({db,enabled:true,now:()=>time});
  return {db,wallet,setTime:value=>{time=value;}};
}
const grant=(wallet,extra={})=>wallet.grant(SCOPE,{paymentReference:'verified-payment-example-1',amountMicroBrl:10_000_000,termsVersion:'draft-60-day-v1',...extra});
const reserve=(wallet,extra={})=>wallet.reserve(SCOPE,{requestId:'example-request-0001',maximumMicroBrl:1_000_000,quoteId:'example-quote-v1',requestHash:'a'.repeat(64),...extra});

test('wallet is disabled by default and never reads Ads or existing Neural balances',()=>{
  const db=new Database(':memory:');
  try {
    db.exec('CREATE TABLE ads_wallets(balance INTEGER); INSERT INTO ads_wallets VALUES(123)');
    const wallet=createAiCreditWallet({db});
    assert.throws(()=>grant(wallet),{code:'ai_wallet_disabled'});
    assert.equal(db.prepare('SELECT balance FROM ads_wallets').get().balance,123);
    assert.equal(wallet.status(SCOPE).enabled,false);
  } finally {db.close();}
});

test('new lots expire after exactly 60 days, not old balances, and payment reference is globally unique',()=>{
  const {db,wallet,setTime}=fixture();
  try {
    const lot=grant(wallet);
    assert.equal(lot.expiresAt,START+60*DAY);
    assert.equal(wallet.status(SCOPE).availableMicroBrl,10_000_000);
    assert.equal(grant(wallet).duplicate,true);
    assert.throws(()=>grant(wallet,{amountMicroBrl:20_000_000}),{code:'ai_wallet_conflict'});
    assert.throws(()=>wallet.grant('store:other',{paymentReference:'verified-payment-example-1',amountMicroBrl:10_000_000,termsVersion:'draft-60-day-v1'}),{code:'ai_wallet_conflict'});
    setTime(START+60*DAY);
    assert.equal(wallet.status(SCOPE).availableMicroBrl,0);
    assert.equal(wallet.status(SCOPE).expiredMicroBrl,10_000_000);
    assert.throws(()=>reserve(wallet),{code:'ai_wallet_insufficient'});
  } finally {db.close();}
});

test('reservation is atomic, idempotent and tied to request, quote and maximum',()=>{
  const {db,wallet}=fixture();
  try {
    grant(wallet); reserve(wallet);
    assert.equal(reserve(wallet).duplicate,true);
    assert.equal(wallet.status(SCOPE).reservedMicroBrl,1_000_000);
    assert.throws(()=>reserve(wallet,{requestHash:'b'.repeat(64)}),{code:'ai_wallet_conflict'});
    assert.throws(()=>reserve(wallet,{quoteId:'another-quote'}),{code:'ai_wallet_conflict'});
    assert.throws(()=>reserve(wallet,{maximumMicroBrl:2_000_000}),{code:'ai_wallet_conflict'});
    assert.throws(()=>reserve(wallet,{requestId:'example-request-0002',maximumMicroBrl:9_000_001}),{code:'ai_wallet_insufficient'});
    assert.equal(wallet.status(SCOPE).availableMicroBrl,9_000_000);
    assert.equal(wallet.status('store:other').availableMicroBrl,0);
    assert.throws(()=>wallet.settle('store:other','example-request-0001',{actualMicroBrl:1,receiptId:'receipt-1'}),{code:'ai_wallet_not_found'});
  } finally {db.close();}
});

test('final verified cost is charged once; unused reservation released; exact micro amounts retained',()=>{
  const {db,wallet}=fixture();
  try {
    grant(wallet); reserve(wallet);
    const receipt={actualMicroBrl:12345,receiptId:'provider-receipt-1'};
    assert.equal(wallet.settle(SCOPE,'example-request-0001',receipt).chargedMicroBrl,12345);
    assert.equal(wallet.settle(SCOPE,'example-request-0001',receipt).duplicate,true);
    assert.throws(()=>wallet.settle(SCOPE,'example-request-0001',{...receipt,actualMicroBrl:1}),{code:'ai_wallet_conflict'});
    assert.equal(wallet.status(SCOPE).availableMicroBrl,9_987_655);
    assert.equal(wallet.status(SCOPE).reservedMicroBrl,0);
    assert.equal(wallet.status(SCOPE).chargedMicroBrl,12345);
    assert.equal(wallet.history(SCOPE).filter(e=>e.type==='settled').length,1);
  } finally {db.close();}
});

test('unknown cost holds reserve then accepts known usage only for the same receipt',()=>{
  const {db,wallet}=fixture();
  try {
    grant(wallet); reserve(wallet);
    assert.equal(wallet.settle(SCOPE,'example-request-0001',{actualMicroBrl:null,receiptId:'pending-receipt'}).state,'review_required');
    assert.equal(wallet.status(SCOPE).reservedMicroBrl,1_000_000);
    assert.equal(wallet.status(SCOPE).chargedMicroBrl,0);
    assert.throws(()=>wallet.settle(SCOPE,'example-request-0001',{actualMicroBrl:800_000,receiptId:'other-receipt'}),{code:'ai_wallet_conflict'});
    assert.equal(wallet.settle(SCOPE,'example-request-0001',{actualMicroBrl:800_000,receiptId:'pending-receipt'}).state,'settled');
  } finally {db.close();}
});

test('excessive known cost preserves evidence and cannot be silently changed, reused or released',()=>{
  const {db,wallet}=fixture();
  try {
    grant(wallet); reserve(wallet);
    const over={actualMicroBrl:1_000_001,receiptId:'provider-receipt-1'};
    assert.equal(wallet.settle(SCOPE,'example-request-0001',over).state,'review_required');
    assert.equal(wallet.settle(SCOPE,'example-request-0001',over).state,'review_required');
    assert.equal(db.prepare('SELECT observed_micro FROM neural_ai_credit_receipt_evidence').get().observed_micro,1_000_001);
    assert.equal(wallet.status(SCOPE).chargedMicroBrl,0);
    assert.equal(wallet.status(SCOPE).reservedMicroBrl,1_000_000);
    for(const actualMicroBrl of [null,0,800_000])assert.throws(()=>wallet.settle(SCOPE,'example-request-0001',{...over,actualMicroBrl}),{code:'ai_wallet_conflict'});
    assert.throws(()=>wallet.settle(SCOPE,'example-request-0001',{...over,receiptId:'different-receipt'}),{code:'ai_wallet_conflict'});
    assert.throws(()=>wallet.release(SCOPE,'example-request-0001',{reason:'No usage confirmed',noConsumptionConfirmed:true}),{code:'ai_wallet_conflict'});
    reserve(wallet,{requestId:'example-request-0002'});
    assert.throws(()=>wallet.settle(SCOPE,'example-request-0002',{...over,actualMicroBrl:100}),{code:'ai_wallet_conflict'});
    assert.equal(wallet.history(SCOPE).filter(e=>e.type==='receipt_observed').length,1);
  } finally {db.close();}
});

test('failure writing ledger event rolls back receipt evidence, allocations and debit together',()=>{
  const {db,wallet}=fixture();
  try {
    grant(wallet); reserve(wallet);
    db.exec("CREATE TRIGGER fail_settled BEFORE INSERT ON neural_ai_credit_events WHEN NEW.type='settled' BEGIN SELECT RAISE(ABORT,'injected test failure'); END;");
    assert.throws(()=>wallet.settle(SCOPE,'example-request-0001',{actualMicroBrl:50,receiptId:'provider-receipt-1'}),/injected test failure/);
    assert.equal(wallet.status(SCOPE).reservedMicroBrl,1_000_000);
    assert.equal(wallet.status(SCOPE).chargedMicroBrl,0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM neural_ai_credit_receipt_evidence').get().n,0);
    assert.equal(db.prepare('SELECT receipt_id FROM neural_ai_credit_reservations').get().receipt_id,null);
  } finally {db.close();}
});

test('expiry during generation preserves accepted reserve but never renews the unused remainder',()=>{
  const {db,wallet,setTime}=fixture();
  try {
    grant(wallet); reserve(wallet);
    setTime(START+60*DAY);
    const status=wallet.status(SCOPE);
    assert.equal(status.availableMicroBrl,0); assert.equal(status.reservedMicroBrl,1_000_000);
    wallet.settle(SCOPE,'example-request-0001',{actualMicroBrl:400_000,receiptId:'provider-receipt-1'});
    assert.equal(wallet.status(SCOPE).availableMicroBrl,0);
    assert.equal(wallet.status(SCOPE).expiredMicroBrl,9_600_000);
    assert.equal(wallet.status(SCOPE).chargedMicroBrl,400_000);
  } finally {db.close();}
});

test('earliest-expiring lots are spent first and release requires confirmed absence of provider consumption',()=>{
  const {db,wallet,setTime}=fixture();
  try {
    grant(wallet,{amountMicroBrl:700_000});
    setTime(START+DAY); grant(wallet,{paymentReference:'verified-payment-example-2',amountMicroBrl:1_000_000});
    reserve(wallet);
    wallet.settle(SCOPE,'example-request-0001',{actualMicroBrl:800_000,receiptId:'provider-receipt-1'});
    setTime(START+60*DAY);
    assert.equal(wallet.status(SCOPE).availableMicroBrl,900_000);
    reserve(wallet,{requestId:'example-request-0002',maximumMicroBrl:500_000});
    assert.throws(()=>wallet.release(SCOPE,'example-request-0002',{reason:'Cancelled'}),{code:'ai_wallet_input_invalid'});
    const release={reason:'Provider confirmed no consumption',noConsumptionConfirmed:true};
    assert.equal(wallet.release(SCOPE,'example-request-0002',release).state,'released');
    assert.equal(wallet.release(SCOPE,'example-request-0002',release).duplicate,true);
    assert.equal(wallet.status(SCOPE).availableMicroBrl,900_000);
  } finally {db.close();}
});

test('rejects invalid scopes, unsafe integers, injected fields and reuse of provider receipt',()=>{
  const {db,wallet}=fixture();
  try {
    for(const amount of [-1,0,1.1,'100',Number.NaN,Number.MAX_SAFE_INTEGER])assert.throws(()=>grant(wallet,{amountMicroBrl:amount}),{code:'ai_wallet_input_invalid'});
    for(const scope of ['',null,'store:../private','admin','anything'])assert.throws(()=>wallet.status(scope),{code:'ai_wallet_scope_denied'});
    assert.throws(()=>grant(wallet,{expiresAt:START+DAY}),{code:'ai_wallet_input_invalid'});
    grant(wallet); reserve(wallet);
    wallet.settle(SCOPE,'example-request-0001',{actualMicroBrl:1,receiptId:'provider-receipt-1'});
    reserve(wallet,{requestId:'example-request-0002'});
    assert.throws(()=>wallet.settle(SCOPE,'example-request-0002',{actualMicroBrl:1,receiptId:'provider-receipt-1'}),{code:'ai_wallet_conflict'});
    assert.equal(wallet.status(SCOPE).reservedMicroBrl,1_000_000);
  } finally {db.close();}
});
