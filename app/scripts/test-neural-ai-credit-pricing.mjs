import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAiCreditPricing, roundRationalToMicroBRL, creditsFromMicroBRL,
  newAiCreditPurchaseTerms, AI_CREDIT_POLICY, PROPOSED_CREDIT_CONVERSION
} from '../vitriny-neural/ai-credit-pricing.js';

// EXAMPLE-ONLY fixtures: these are not commercial tariffs, model prices or FX quotes.
const at='2026-01-10T12:00:00.000Z';
const tariff=()=>({providerId:'example-provider',modelId:'example-chat',version:'example-tariff-v1',effectiveAt:'2026-01-01T00:00:00.000Z',inputUsdPerMillion:'2',cachedInputUsdPerMillion:'0.5',outputUsdPerMillion:'8'});
const fx=()=>({version:'example-fx-v1',observedAt:'2026-01-10T00:00:00.000Z',usdToBrl:'5'});
const usage=()=>({inputTokens:1000,cachedInputTokens:250,outputTokens:100});
const request=(extra={})=>({providerId:'example-provider',modelId:'example-chat',tariffVersion:'example-tariff-v1',fxVersion:'example-fx-v1',usage:usage(),pricedAt:at,...extra});
const quote=(extra={})=>({quoteId:'example-quote-v1',providerId:'example-provider',modelId:'example-image',kind:'image',tariffVersion:'example-image-tariff-v1',tariffEffectiveAt:'2026-01-01T00:00:00.000Z',status:'confirmed',quotedAt:'2026-01-10T11:00:00.000Z',expiresAt:'2026-01-10T13:00:00.000Z',requestFingerprint:'a'.repeat(64),totalUsd:'0.04',...extra});
const mediaRequest=(extra={})=>({quoteId:'example-quote-v1',providerId:'example-provider',modelId:'example-image',kind:'image',tariffVersion:'example-image-tariff-v1',fxVersion:'example-fx-v1',requestFingerprint:'a'.repeat(64),pricedAt:at,...extra});
const pricing=(extra={})=>createAiCreditPricing({tariffs:[tariff()],fxSnapshots:[fx()],mediaQuotes:[],...extra});
const errorCode=code=>error=>error?.code===code;

test('chat separates cached input, converts USD to BRL, and adds 15 percent with only final microBRL rounding',()=>{
  const result=pricing().priceChat(request());
  assert.deepEqual(result.costUsdExact,{numerator:'97',denominator:'40000'});
  assert.deepEqual(result.costBrlExact,{numerator:'97',denominator:'8000'});
  assert.deepEqual(result.customerBrlExact,{numerator:'2231',denominator:'160000'});
  assert.equal(result.customerMicroBRL,'13944');assert.equal(result.customerBRL,'0.013944');
  assert.equal(result.credits,'1.3944');assert.equal(result.kind,'chat');
  assert.deepEqual(result.usage,{inputTokens:'1000',cachedInputTokens:'250',uncachedInputTokens:'750',outputTokens:'100'});
  assert.equal(result.audit.providerId,'example-provider');assert.equal(result.audit.modelId,'example-chat');
  assert.equal(result.audit.tariffVersion,'example-tariff-v1');assert.equal(result.audit.tariffEffectiveAt,tariff().effectiveAt);
  assert.equal(result.audit.fxVersion,'example-fx-v1');assert.equal(result.audit.fxObservedAt,fx().observedAt);
  assert.equal(result.audit.pricedAt,at);assert.equal(result.audit.markupNumerator,'23');assert.equal(result.audit.markupDenominator,'20');
  assert.equal(result.audit.policyVersion,'ai-credit-policy-v2');
  assert.equal(result.audit.rounding,'half_up_at_final_microBRL');assert.equal(result.audit.creditConversionStatus,'proposed');
  assert.doesNotThrow(()=>JSON.stringify(result));
});

test('rounding happens after summing components, conversion and markup, not per token or in USD',()=>{
  const p=pricing({tariffs:[{...tariff(),inputUsdPerMillion:'0.0000003',cachedInputUsdPerMillion:'0',outputUsdPerMillion:'0.0000003'}],fxSnapshots:[{...fx(),usdToBrl:'1'}]});
  const result=p.priceChat(request({usage:{inputTokens:1_000_000,cachedInputTokens:0,outputTokens:1_000_000}}));
  assert.deepEqual(result.customerBrlExact,{numerator:'69',denominator:'100000000'});
  assert.equal(result.customerMicroBRL,'1');assert.equal(result.credits,'0.0001');
  const second=pricing({tariffs:[{...tariff(),inputUsdPerMillion:'0.0000004'}],fxSnapshots:[{...fx(),usdToBrl:'2'}]});
  assert.equal(second.priceChat(request({usage:{inputTokens:1_000_000,cachedInputTokens:0,outputTokens:0}})).customerMicroBRL,'1');
});

test('half-up rounding and fractional credit display use integers, including values above the Number safe range',()=>{
  assert.equal(roundRationalToMicroBRL({numerator:1n,denominator:2_000_000n}),1n);
  assert.equal(roundRationalToMicroBRL({numerator:499n,denominator:1_000_000_000n}),0n);
  assert.equal(roundRationalToMicroBRL({numerator:3n,denominator:2_000_000n}),2n);
  assert.equal(creditsFromMicroBRL(1n),'0.0001');assert.equal(creditsFromMicroBRL(1_000_000n),'100');
  assert.equal(creditsFromMicroBRL(0n),'0');assert.equal(creditsFromMicroBRL(1250n,'80'),'0.1');
  const tokens=9007199254740993n;
  const p=pricing({tariffs:[{...tariff(),inputUsdPerMillion:'1'}],fxSnapshots:[{...fx(),usdToBrl:'1'}]});
  assert.equal(p.priceChat(request({usage:{inputTokens:tokens,cachedInputTokens:0n,outputTokens:0n}})).customerMicroBRL,((tokens*23n+10n)/20n).toString());
});

test('absent usage, missing cache count and explicitly unknown receipts never become free usage',()=>{
  for(const value of [undefined,null,{}, {inputTokens:0,outputTokens:0},{...usage(),known:false},
    {...usage(),inputTokens:null},{...usage(),cachedInputTokens:undefined},{...usage(),outputTokens:null}]){
    assert.throws(()=>pricing().priceChat(request({usage:value})),errorCode('usage_unknown'));
  }
});

test('malformed, negative, fractional, unsafe and inconsistent counts are rejected',()=>{
  for(const invalid of [-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'0',true]){
    for(const key of ['inputTokens','cachedInputTokens','outputTokens'])assert.throws(()=>pricing().priceChat(request({usage:{...usage(),[key]:invalid}})),errorCode('usage_invalid'));
  }
  assert.throws(()=>pricing().priceChat(request({usage:{inputTokens:5,cachedInputTokens:6,outputTokens:0}})),errorCode('usage_invalid'));
  assert.throws(()=>pricing().priceChat(request({usage:{...usage(),known:'yes'}})),errorCode('usage_invalid'));
});

test('explicit zero usage and explicit zero prices are allowed, but missing rates have no fallback',()=>{
  const p=pricing();assert.equal(p.priceChat(request({usage:{inputTokens:0,cachedInputTokens:0,outputTokens:0}})).customerMicroBRL,'0');
  const free={...tariff(),inputUsdPerMillion:'0',cachedInputUsdPerMillion:'0.000',outputUsdPerMillion:'0'};
  assert.equal(pricing({tariffs:[free]}).priceChat(request()).customerMicroBRL,'0');
  for(const key of ['inputUsdPerMillion','cachedInputUsdPerMillion','outputUsdPerMillion']){
    const missing=tariff();delete missing[key];assert.throws(()=>pricing({tariffs:[missing]}),errorCode('tariff_invalid'));
    for(const invalid of [undefined,null,'',0,0.5,' 0','-1','1e-6','Infinity'])assert.throws(()=>pricing({tariffs:[{...tariff(),[key]:invalid}]}),errorCode('tariff_invalid'));
  }
  for(const invalid of ['0',0,null,'','-1','1e1'])assert.throws(()=>pricing({fxSnapshots:[{...fx(),usdToBrl:invalid}]}),errorCode('fx_invalid'));
});

test('provider, model, tariff and FX versions are exact lookups without defaults or request-side price overrides',()=>{
  const p=pricing();
  for(const changes of [{providerId:'other'},{modelId:'other'},{tariffVersion:'other'}])assert.throws(()=>p.priceChat(request(changes)),errorCode('tariff_not_found'));
  assert.throws(()=>p.priceChat(request({fxVersion:'other'})),errorCode('fx_not_found'));
  for(const changes of [{inputUsdPerMillion:'0'},{fx:{usdToBrl:'0'}},{markup:'1'},{creditConversion:{creditsPerBRL:'1'}}])assert.throws(()=>p.priceChat(request(changes)),errorCode('pricing_request_invalid'));
  assert.throws(()=>pricing({tariffs:[tariff(),tariff()]}),errorCode('tariff_duplicate'));
  assert.throws(()=>pricing({fxSnapshots:[fx(),fx()]}),errorCode('fx_duplicate'));
});

test('snapshots are copied immutably and dates prevent future tariffs or FX from silently applying',()=>{
  const t=tariff(),f=fx(),p=pricing({tariffs:[t],fxSnapshots:[f]});t.inputUsdPerMillion='0';f.usdToBrl='1';
  const result=p.priceChat(request());assert.equal(result.customerMicroBRL,'13944');assert(Object.isFrozen(result.audit));
  assert.throws(()=>{result.audit.fxVersion='changed';},TypeError);
  assert.throws(()=>pricing({tariffs:[{...tariff(),effectiveAt:'2026-01-11T00:00:00.000Z'}]}).priceChat(request()),errorCode('tariff_not_effective'));
  assert.throws(()=>pricing({fxSnapshots:[{...fx(),observedAt:'2026-01-11T00:00:00.000Z'}]}).priceChat(request()),errorCode('fx_not_effective'));
  assert.throws(()=>p.priceChat(request({pricedAt:'2026-02-30T00:00:00.000Z'})),errorCode('pricing_request_invalid'));
  assert.throws(()=>pricing({tariffs:[{...tariff(),version:''}]}),errorCode('tariff_invalid'));
});

test('confirmed image/video quotes price only their bound request, carrying audit metadata without estimating',()=>{
  for(const kind of ['image','video']){
    const q=quote({kind}),p=pricing({mediaQuotes:[q]});const result=p.priceMedia(mediaRequest({kind}));
    assert.equal(result.kind,kind);assert.equal(result.basis,'confirmed_quote');assert.equal(result.customerMicroBRL,'230000');assert.equal(result.credits,'23');
    assert.deepEqual(result.costBrlExact,{numerator:'1',denominator:'5'});assert.deepEqual(result.customerBrlExact,{numerator:'23',denominator:'100'});
    assert.equal(result.audit.quoteId,q.quoteId);assert.equal(result.audit.quoteExpiresAt,q.expiresAt);assert.equal(result.audit.requestFingerprint,q.requestFingerprint);
    assert.equal(result.audit.tariffVersion,q.tariffVersion);assert.equal(result.audit.tariffEffectiveAt,q.tariffEffectiveAt);
  }
  assert.equal(pricing({mediaQuotes:[quote({totalUsd:'0'})]}).priceMedia(mediaRequest()).customerMicroBRL,'0');
});

// Provider names below are only identities in synthetic tariff/quote fixtures;
// these tests do not assert that any connector/model/capability is enabled.
test('chat, image and video across providers use exactly one 23/20 multiplier with matching v2 audit receipts',()=>{
  for(const [kind,providerId] of [['chat','openai'],['chat','openrouter'],['image','openai'],['image','kling_api'],['video','kling_api'],['video','google']]){
    const modelId=`example-${providerId}-${kind}`;
    const t={...tariff(),providerId,modelId,inputUsdPerMillion:'2.5',cachedInputUsdPerMillion:'0',outputUsdPerMillion:'0'};
    const q=quote({providerId,modelId,kind:kind==='chat'?'image':kind,totalUsd:'2.5'});
    const p=pricing({tariffs:[t],mediaQuotes:kind==='chat'?[]:[q]});
    const input=kind==='chat'?request({providerId,modelId,usage:{inputTokens:1_000_000,cachedInputTokens:0,outputTokens:0}}):mediaRequest({providerId,modelId,kind});
    const result=kind==='chat'?p.priceChat(input):p.priceMedia(input);
    assert.equal(result.kind,kind);assert.equal(result.customerMicroBRL,'14375000');assert.equal(result.customerBRL,'14.375000');assert.equal(result.credits,'1437.5');
    assert.deepEqual(result.costUsdExact,{numerator:'5',denominator:'2'});assert.deepEqual(result.costBrlExact,{numerator:'25',denominator:'2'});
    assert.deepEqual(result.customerBrlExact,{numerator:'115',denominator:'8'});
    const cost=result.costBrlExact,customer=result.customerBrlExact;
    assert.equal(BigInt(customer.numerator)*BigInt(cost.denominator)*20n,BigInt(cost.numerator)*BigInt(customer.denominator)*23n);
    assert.equal(result.audit.providerId,providerId);assert.equal(result.audit.modelId,modelId);
    assert.equal(result.audit.markupNumerator,'23');assert.equal(result.audit.markupDenominator,'20');assert.equal(result.audit.policyVersion,'ai-credit-policy-v2');
    assert.equal(result.audit.markupNumerator,AI_CREDIT_POLICY.markupNumerator);assert.equal(result.audit.markupDenominator,AI_CREDIT_POLICY.markupDenominator);assert.equal(result.audit.policyVersion,AI_CREDIT_POLICY.version);
    assert.equal(result.audit.fxVersion,fx().version);assert.equal(result.audit.usdToBrl,'5');assert.equal(result.audit.rounding,'half_up_at_final_microBRL');
    if(kind==='chat'){assert.deepEqual(result.audit.tariffSnapshot,t);}else{assert.deepEqual(result.audit.quoteSnapshot,q);assert.equal(result.audit.requestFingerprint,q.requestFingerprint);}
    // Pure repeated calculation is stable, not a second fee on the prior result.
    assert.deepEqual(kind==='chat'?p.priceChat(input):p.priceMedia(input),result);
    assert(Object.isFrozen(result.audit));assert.doesNotThrow(()=>JSON.stringify(result));
  }
});

test('known zero cost remains exact zero for all modalities and still records the 15 percent policy',()=>{
  for(const [kind,providerId] of [['chat','openai'],['image','openrouter'],['video','kling_api']]){
    const modelId=`example-${kind}`,t={...tariff(),providerId,modelId,inputUsdPerMillion:'0',cachedInputUsdPerMillion:'0.000',outputUsdPerMillion:'0'};
    const p=pricing({tariffs:[t],mediaQuotes:kind==='chat'?[]:[quote({providerId,modelId,kind,totalUsd:'0.000'})]});
    const result=kind==='chat'?p.priceChat(request({providerId,modelId})):p.priceMedia(mediaRequest({providerId,modelId,kind}));
    for(const field of ['costUsdExact','costBrlExact','customerBrlExact'])assert.deepEqual(result[field],{numerator:'0',denominator:'1'});
    assert.equal(result.customerMicroBRL,'0');assert.equal(result.customerBRL,'0.000000');assert.equal(result.credits,'0');
    assert.equal(result.audit.policyVersion,'ai-credit-policy-v2');assert.equal(result.audit.markupNumerator,'23');assert.equal(result.audit.markupDenominator,'20');
  }
});

test('all modalities preserve high precision through USD, FX and one 15 percent markup before final rounding',()=>{
  const usd='0.123456789123456789',usdToBrl='5.123456789123456789';
  const numerator=123456789123456789n*5123456789123456789n*23n,denominator=10n**36n*20n;
  const expectedMicro=(numerator*1_000_000n*2n+denominator)/(denominator*2n);
  for(const kind of ['chat','image','video']){
    const p=pricing({tariffs:[{...tariff(),inputUsdPerMillion:usd,cachedInputUsdPerMillion:'0',outputUsdPerMillion:'0'}],fxSnapshots:[{...fx(),usdToBrl}],mediaQuotes:kind==='chat'?[]:[quote({kind,totalUsd:usd})]});
    const result=kind==='chat'?p.priceChat(request({usage:{inputTokens:1_000_000,cachedInputTokens:0,outputTokens:0}})):p.priceMedia(mediaRequest({kind}));
    const exact=result.customerBrlExact;
    assert.equal(BigInt(exact.numerator)*denominator,numerator*BigInt(exact.denominator));
    assert.equal(result.customerMicroBRL,expectedMicro.toString());assert.equal(result.audit.usdToBrl,usdToBrl);
    assert.equal(result.audit.markupNumerator,'23');assert.equal(result.audit.markupDenominator,'20');assert.equal(result.audit.policyVersion,'ai-credit-policy-v2');
  }
  // A half-micro threshold must not retain the old 50% result or round USD first.
  const tiny=pricing({tariffs:[{...tariff(),inputUsdPerMillion:'0.0000004',cachedInputUsdPerMillion:'0',outputUsdPerMillion:'0'}],fxSnapshots:[{...fx(),usdToBrl:'1'}]});
  const result=tiny.priceChat(request({usage:{inputTokens:1_000_000,cachedInputTokens:0,outputTokens:0}}));
  assert.deepEqual(result.customerBrlExact,{numerator:'23',denominator:'50000000'});assert.equal(result.customerMicroBRL,'0');
});

test('missing, unconfirmed, expired, mismatched and price-less quotes cannot be guessed or reused for another request',()=>{
  assert.throws(()=>pricing().priceMedia(mediaRequest()),errorCode('quote_unconfirmed'));
  assert.throws(()=>pricing({mediaQuotes:[quote({status:'estimated'})]}),errorCode('quote_unconfirmed'));
  for(const invalid of [undefined,null,'',0])assert.throws(()=>pricing({mediaQuotes:[quote({totalUsd:invalid})]}),errorCode('quote_invalid'));
  const p=pricing({mediaQuotes:[quote()]});
  assert.throws(()=>p.priceMedia(mediaRequest({pricedAt:quote().expiresAt})),errorCode('quote_expired'));
  for(const changes of [{kind:'video'},{modelId:'other'},{providerId:'other'},{tariffVersion:'other'},{requestFingerprint:'b'.repeat(64)}])assert.throws(()=>p.priceMedia(mediaRequest(changes)),errorCode('quote_mismatch'));
  assert.throws(()=>p.priceMedia(mediaRequest({pricedAt:'2026-01-10T10:00:00.000Z'})),errorCode('quote_not_effective'));
  assert.throws(()=>p.priceMedia(mediaRequest({totalUsd:'0'})),errorCode('pricing_request_invalid'));
});

test('new-credit terms expire exactly 60 days after purchase and cannot be applied as a legacy-wallet migration',()=>{
  const input={newPurchase:true,purchaseId:'example-purchase',purchasedAt:'2026-01-31T23:30:00.000Z'},before=structuredClone(input);
  const result=newAiCreditPurchaseTerms(input);
  assert.equal(result.expiresAt,'2026-04-01T23:30:00.000Z');assert.equal(result.validityDays,60);
  assert.equal(result.appliesTo,'new_ai_credit_purchase_only');assert.equal(result.usageScope,'internal_ai_services_only');
  assert.equal(result.purchaseId,input.purchaseId);assert.deepEqual(input,before);
  assert.throws(()=>newAiCreditPurchaseTerms({...input,newPurchase:false}),errorCode('new_purchase_required'));
  assert.throws(()=>newAiCreditPurchaseTerms({...input,walletId:'existing-wallet'}),errorCode('purchase_invalid'));
  assert.throws(()=>newAiCreditPurchaseTerms({...input,purchasedAt:'invalid'}),errorCode('purchase_invalid'));
  assert.equal(AI_CREDIT_POLICY.legacyBalances,'unchanged');assert.equal(AI_CREDIT_POLICY.refunds,'review_under_applicable_rules');
  assert.equal(AI_CREDIT_POLICY.version,'ai-credit-policy-v2');assert.equal(result.policyVersion,'ai-credit-policy-v2');
  assert.equal(AI_CREDIT_POLICY.markupNumerator,'23');assert.equal(AI_CREDIT_POLICY.markupDenominator,'20');
  assert.equal(PROPOSED_CREDIT_CONVERSION.creditsPerBRL,'100');assert.equal(PROPOSED_CREDIT_CONVERSION.status,'proposed');
  assert(Object.isFrozen(AI_CREDIT_POLICY));assert(Object.isFrozen(result));
});

test('rounding helpers reject non-integer monetary inputs and invalid denominators or conversion',()=>{
  for(const numerator of [-1n,1,'1'])assert.throws(()=>roundRationalToMicroBRL({numerator,denominator:1n}),errorCode('amount_invalid'));
  for(const denominator of [0n,-1n,1])assert.throws(()=>roundRationalToMicroBRL({numerator:1n,denominator}),errorCode('amount_invalid'));
  for(const amount of [-1n,1,'1'])assert.throws(()=>creditsFromMicroBRL(amount),errorCode('amount_invalid'));
  for(const conversion of ['0',0,'1.5',''])assert.throws(()=>creditsFromMicroBRL(1n,conversion),errorCode('credit_conversion_invalid'));
});
