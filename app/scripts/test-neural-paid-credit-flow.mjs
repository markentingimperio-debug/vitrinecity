import assert from 'node:assert/strict';
import {test} from 'node:test';
import Database from 'better-sqlite3';
import {createAiCreditWallet} from '../vitriny-neural/ai-credit-wallet.js';
import {createAiCreditPricing} from '../vitriny-neural/ai-credit-pricing.js';
import {createOpenAiPaidChatAdapter,hashOpenAiPaidChatRequest} from '../vitriny-neural/providers/openai-paid-chat.js';

// Integration fixtures only. These are NOT current provider tariffs, payment
// confirmation, purchase endpoints, consent handling or production activation.
const date='2026-09-14T17:00:00.000Z',time=Date.parse(date),scope='admin:fixture-owner';
function fixture(fetchImpl,{model='gpt-4o-mini',reasoningEffort,rates={inputUsdPerMillion:'0.1',cachedInputUsdPerMillion:'0.05',outputUsdPerMillion:'0.4'}}={}){
  const db=new Database(':memory:');
  const wallet=createAiCreditWallet({db,enabled:true,now:()=>time});
  wallet.grant(scope,{paymentReference:'fixture-payment-only',amountMicroBrl:1_000_000,termsVersion:'fixture-terms'});
  db.exec('CREATE TABLE fixture_dispatch_claims(request_id TEXT PRIMARY KEY)');
  const input={requestId:'fixture-request-001',messages:[{role:'user',content:'Explique este teste.'}],maxOutputTokens:100};
  const requestHash=hashOpenAiPaidChatRequest({model,reasoningEffort,messages:input.messages,maxOutputTokens:input.maxOutputTokens});
  wallet.reserve(scope,{requestId:input.requestId,maximumMicroBrl:10000,quoteId:'fixture-quote',requestHash});
  input.permit={authorized:true,scope,requestId:input.requestId,requestHash,model,maxOutputTokens:100,
    reservationId:input.requestId,maximumMicroBrl:'10000',expiresAt:time+10000};
  const assertAuthorized=db.transaction(permit=>{
    const row=db.prepare('SELECT * FROM neural_ai_credit_reservations WHERE scope=? AND request_id=?').get(permit.scope,permit.requestId);
    if(!row||row.state!=='reserved'||row.request_hash!==permit.requestHash||String(row.maximum_micro)!==permit.maximumMicroBrl)return false;
    return db.prepare('INSERT OR IGNORE INTO fixture_dispatch_claims VALUES(?)').run(permit.requestId).changes===1;
  });
  const adapter=createOpenAiPaidChatAdapter({enabled:true,apiKey:'fixture-key-not-real',model,reasoningEffort,now:()=>time,
    fetchImpl,assertAuthorized:permit=>assertAuthorized.immediate(permit)});
  const pricing=createAiCreditPricing({tariffs:[{providerId:'openai',modelId:model,version:'fixture-tariff',effectiveAt:date,
    ...rates}],fxSnapshots:[{version:'fixture-fx',observedAt:date,usdToBrl:'5'}]});
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
    assert.equal(exact,92n);
    assert.equal(price.audit.policyVersion,'ai-credit-policy-v2');
    assert.equal(price.audit.markupNumerator,'23');assert.equal(price.audit.markupDenominator,'20');
    const amount=Number(exact),settlement={actualMicroBrl:amount,receiptId:receipt.receiptId};
    f.wallet.settle(scope,f.input.requestId,settlement);
    f.wallet.settle(scope,f.input.requestId,settlement);
    assert.equal(f.wallet.status(scope).chargedMicroBrl,92);
    assert.equal(f.wallet.status(scope).reservedMicroBrl,0);
    assert.equal(f.wallet.status(scope).availableMicroBrl,999908);
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

test('mocked Luna text usage with confirmed zero cache writes settles once with the same 15 percent policy',async()=>{
  let calls=0;const model='gpt-5.6-luna';
  // Illustrative dated-rate values and fixture FX, never a live price registry.
  const rates={inputUsdPerMillion:'0.20',cachedInputUsdPerMillion:'0.02',outputUsdPerMillion:'1.20'};
  const f=fixture(async(_url,init)=>{
    calls++;assert.equal(JSON.parse(init.body).reasoning_effort,'none');
    return new Response(JSON.stringify({id:'chatcmpl-luna-fixture',object:'chat.completion',model,
      choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'Resposta Luna simulada.'}}],
      usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120,prompt_tokens_details:{cached_tokens:40,cache_write_tokens:0}}}));
  },{model,rates});
  try{
    const receipt=await f.adapter.invoke(f.input);assert.equal(receipt.ok,true);assert.equal(receipt.billingDisposition,'reconcile');
    const {inputTokens,cachedInputTokens,outputTokens}=receipt.usage;
    const price=f.pricing.priceChat({providerId:'openai',modelId:model,tariffVersion:'fixture-tariff',fxVersion:'fixture-fx',pricedAt:date,
      usage:{inputTokens,cachedInputTokens,outputTokens}});
    // ((60*.20 + 40*.02 + 20*1.20)/1M USD) * 5 BRL/USD * 1.15
    assert.equal(price.customerMicroBRL,'212');assert.equal(price.audit.policyVersion,'ai-credit-policy-v2');
    assert.deepEqual(price.customerBrlExact,{numerator:'529',denominator:'2500000'});
    const settlement={actualMicroBrl:212,receiptId:receipt.receiptId};
    f.wallet.settle(scope,f.input.requestId,settlement);f.wallet.settle(scope,f.input.requestId,settlement);
    assert.equal(f.wallet.status(scope).chargedMicroBrl,212);assert.equal(f.wallet.status(scope).availableMicroBrl,999788);
    assert.equal((await f.adapter.invoke(f.input)).transportStarted,false);assert.equal(calls,1);
  }finally{f.db.close();}
});

test('mocked Luna missing cache-write evidence holds its reservation without pricing or a second dispatch',async()=>{
  let calls=0;const model='gpt-5.6-luna';
  const f=fixture(async()=>{
    calls++;return new Response(JSON.stringify({id:'chatcmpl-luna-unknown',object:'chat.completion',model,
      choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'Nao entregar como concluido.'}}],
      usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120,prompt_tokens_details:{cached_tokens:40}}}));
  },{model});
  try{
    const receipt=await f.adapter.invoke(f.input);assert.equal(receipt.ok,false);assert.equal(receipt.billingDisposition,'hold');
    assert.equal(receipt.usage.known,false);assert.equal(receipt.receiptId,'openai:chatcmpl-luna-unknown');
    assert.equal(f.wallet.status(scope).reservedMicroBrl,10000);assert.equal(f.wallet.status(scope).chargedMicroBrl,0);
    assert.equal((await f.adapter.invoke(f.input)).transportStarted,false);assert.equal(calls,1);
  }finally{f.db.close();}
});

test('stronger text models settle their own token tariff plus 15 percent, counting reasoning only once',async()=>{
  for(const [model,reasoningEffort,input,cache,output,expected] of [
    ['gpt-5.6-terra','high','2','0.2','12',2116],
    ['gpt-6-astra','high','10','1','50',9430]
  ]){
    let calls=0;const f=fixture(async(_url,init)=>{
      calls++;const body=JSON.parse(init.body);assert.equal(body.model,model);assert.equal(body.reasoning_effort,'high');
      return new Response(JSON.stringify({id:'chatcmpl-strong-fixture',object:'chat.completion',model,
        choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'Analise simulada.'}}],
        usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120,
          prompt_tokens_details:{cached_tokens:40,cache_write_tokens:0,image_tokens:0},
          completion_tokens_details:{reasoning_tokens:8,audio_tokens:0}}}));
    },{model,reasoningEffort,rates:{inputUsdPerMillion:input,cachedInputUsdPerMillion:cache,outputUsdPerMillion:output}});
    try{
      const receipt=await f.adapter.invoke(f.input);assert.equal(receipt.ok,true);assert.equal(receipt.usage.outputTokens,20);
      const {inputTokens,cachedInputTokens,outputTokens}=receipt.usage;
      const price=f.pricing.priceChat({providerId:'openai',modelId:model,tariffVersion:'fixture-tariff',fxVersion:'fixture-fx',pricedAt:date,
        usage:{inputTokens,cachedInputTokens,outputTokens}});
      assert.equal(price.customerMicroBRL,String(expected));assert.equal(price.audit.modelId,model);
      assert.equal(price.audit.markupNumerator,'23');assert.equal(price.audit.markupDenominator,'20');
      const settlement={actualMicroBrl:expected,receiptId:receipt.receiptId};
      f.wallet.settle(scope,f.input.requestId,settlement);f.wallet.settle(scope,f.input.requestId,settlement);
      assert.equal(f.wallet.status(scope).chargedMicroBrl,expected);assert.equal(f.wallet.status(scope).availableMicroBrl,1000000-expected);
      assert.equal((await f.adapter.invoke(f.input)).transportStarted,false);assert.equal(calls,1);
    }finally{f.db.close();}
  }
});

test('prepaid reservation failure prevents any paid model dispatch; other reservations cannot reuse that balance',async()=>{
  const db=new Database(':memory:');let calls=0;
  try{
    const wallet=createAiCreditWallet({db,enabled:true,now:()=>time});
    const input={model:'gpt-6-astra',reasoningEffort:'high',messages:[{role:'user',content:'Teste sem saldo suficiente.'}],maxOutputTokens:100};
    const requestHash=hashOpenAiPaidChatRequest(input);
    const reserveAndCreate=()=>{
      wallet.reserve(scope,{requestId:'fixture-budget-request',maximumMicroBrl:9430,quoteId:'fixture-astra-quote',requestHash});
      return createOpenAiPaidChatAdapter({model:input.model,reasoningEffort:input.reasoningEffort,enabled:true,apiKey:'fixture-only',
        assertAuthorized:()=>false,fetchImpl:async()=>{calls++;throw Error('No dispatch expected');}});
    };
    assert.throws(reserveAndCreate,{code:'ai_wallet_insufficient'});
    wallet.grant(scope,{paymentReference:'fixture-small-prepaid',amountMicroBrl:10000,termsVersion:'fixture-terms'});
    wallet.reserve(scope,{requestId:'fixture-earlier-request',maximumMicroBrl:600,quoteId:'fixture-earlier-quote',requestHash:'a'.repeat(64)});
    assert.equal(wallet.status(scope).availableMicroBrl,9400);
    assert.throws(reserveAndCreate,{code:'ai_wallet_insufficient'});
    assert.equal(calls,0);assert.equal(wallet.status(scope).chargedMicroBrl,0);
    assert.equal(wallet.status(scope).reservedMicroBrl,600);assert.equal(wallet.status(scope).availableMicroBrl,9400);
  }finally{db.close();}
});
