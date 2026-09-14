import assert from 'node:assert/strict';
import {test} from 'node:test';
import Database from 'better-sqlite3';
import {createAiCreditWallet} from '../vitriny-neural/ai-credit-wallet.js';
import {createAiCreditPricing} from '../vitriny-neural/ai-credit-pricing.js';
import {createOpenAiPaidChatAdapter,hashOpenAiPaidChatRequest} from '../vitriny-neural/providers/openai-paid-chat.js';

// Integration fixtures only. These are NOT current provider tariffs, payment
// confirmation, purchase endpoints, consent handling or production activation.
const date='2026-09-14T17:00:00.000Z',time=Date.parse(date),scope='admin:fixture-owner';
function fixture(fetchImpl){
  const db=new Database(':memory:');
  const wallet=createAiCreditWallet({db,enabled:true,now:()=>time});
  wallet.grant(scope,{paymentReference:'fixture-payment-only',amountMicroBrl:1_000_000,termsVersion:'fixture-terms'});
  db.exec('CREATE TABLE fixture_dispatch_claims(request_id TEXT PRIMARY KEY)');
  const input={requestId:'fixture-request-001',messages:[{role:'user',content:'Explique este teste.'}],maxOutputTokens:100};
  const requestHash=hashOpenAiPaidChatRequest({model:'gpt-4o-mini',messages:input.messages,maxOutputTokens:input.maxOutputTokens});
  wallet.reserve(scope,{requestId:input.requestId,maximumMicroBrl:10000,quoteId:'fixture-quote',requestHash});
  input.permit={authorized:true,scope,requestId:input.requestId,requestHash,model:'gpt-4o-mini',maxOutputTokens:100,
    reservationId:input.requestId,maximumMicroBrl:'10000',expiresAt:time+10000};
  const assertAuthorized=db.transaction(permit=>{
    const row=db.prepare('SELECT * FROM neural_ai_credit_reservations WHERE scope=? AND request_id=?').get(permit.scope,permit.requestId);
    if(!row||row.state!=='reserved'||row.request_hash!==permit.requestHash||String(row.maximum_micro)!==permit.maximumMicroBrl)return false;
    return db.prepare('INSERT OR IGNORE INTO fixture_dispatch_claims VALUES(?)').run(permit.requestId).changes===1;
  });
  const adapter=createOpenAiPaidChatAdapter({enabled:true,apiKey:'fixture-key-not-real',model:'gpt-4o-mini',now:()=>time,
    fetchImpl,assertAuthorized:permit=>assertAuthorized.immediate(permit)});
  const pricing=createAiCreditPricing({tariffs:[{providerId:'openai',modelId:'gpt-4o-mini',version:'fixture-tariff',effectiveAt:date,
    inputUsdPerMillion:'0.1',cachedInputUsdPerMillion:'0.05',outputUsdPerMillion:'0.4'}],fxSnapshots:[{version:'fixture-fx',observedAt:date,usdToBrl:'5'}]});
  return {db,wallet,input,adapter,pricing};
}

test('mocked paid transport, pricing and ledger interoperate with one dispatch and exact one-time settlement',async()=>{
  let calls=0;
  const f=fixture(async()=>{
    calls++;
    return new Response(JSON.stringify({id:'chatcmpl-fixture-receipt',object:'chat.completion',model:'gpt-4o-mini',
      choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'Resposta simulada.'}}],
      usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120,prompt_tokens_details:{cached_tokens:40}}}),{status:200});
  });
  try{
    const receipt=await f.adapter.invoke(f.input);assert.equal(receipt.ok,true);assert.equal(receipt.billingDisposition,'reconcile');
    const {inputTokens,cachedInputTokens,outputTokens}=receipt.usage;
    const price=f.pricing.priceChat({providerId:'openai',modelId:receipt.requestedModel,tariffVersion:'fixture-tariff',fxVersion:'fixture-fx',pricedAt:date,
      usage:{inputTokens,cachedInputTokens,outputTokens}});
    const exact=BigInt(price.customerMicroBRL);assert.ok(exact<=BigInt(Number.MAX_SAFE_INTEGER));
    assert.equal(exact,120n);
    const amount=Number(exact),settlement={actualMicroBrl:amount,receiptId:receipt.receiptId};
    f.wallet.settle(scope,f.input.requestId,settlement);
    f.wallet.settle(scope,f.input.requestId,settlement);
    assert.equal(f.wallet.status(scope).chargedMicroBrl,120);
    assert.equal(f.wallet.status(scope).reservedMicroBrl,0);
    assert.equal(f.wallet.status(scope).availableMicroBrl,999880);
    const repeated=await f.adapter.invoke(f.input);assert.equal(repeated.transportStarted,false);assert.equal(calls,1);
  }finally{f.db.close();}
});

test('mocked uncertain transport retains reserved funds and cannot be automatically sent again',async()=>{
  let calls=0;
  const f=fixture(async()=>{calls++;throw new Error('fixture-disconnection');});
  try{
    const result=await f.adapter.invoke(f.input);
    assert.equal(result.transportStarted,true);assert.equal(result.billingDisposition,'hold');assert.equal(result.usage.known,false);
    assert.equal(result.receiptId,null);
    // No synthetic provider receipt, zero charge or release on ambiguous failure.
    assert.equal(f.wallet.status(scope).reservedMicroBrl,10000);
    assert.equal(f.wallet.status(scope).chargedMicroBrl,0);
    assert.equal((await f.adapter.invoke(f.input)).transportStarted,false);assert.equal(calls,1);
  }finally{f.db.close();}
});
