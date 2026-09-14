/** Pure, isolated AI-credit pricing. No database, wallet, payment, clock, network
 * or environment access. It does not reserve or debit credits.
 *
 * Construct the factory ONLY from server-owned, confirmed snapshots. This module
 * validates shape and arithmetic, not the authenticity of a provider quote or FX
 * source. Never construct it from a request body. Per-call input can select an
 * exact snapshot version but cannot supply/override rates, FX or the markup.
 * All monetary inputs are decimal STRINGS; results use strings for JSON safety.
 * New customer calculations apply the approved 15% uplift exactly once to the
 * provider cost after FX conversion. Credit purchases/legacy receipts are not
 * repriced here. Internal production costs must not debit customer wallets.
 */
const MICRO=1_000_000n, MARKUP_NUMERATOR=23n, MARKUP_DENOMINATOR=20n;
const VALIDITY_MS=60n*24n*60n*60n*1000n;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};

export const PROPOSED_CREDIT_CONVERSION=freeze({version:'proposal-100-credits-per-brl-v1',status:'proposed',creditsPerBRL:'100'});
export const AI_CREDIT_POLICY=freeze({
  version:'ai-credit-policy-v2',markupNumerator:MARKUP_NUMERATOR.toString(),markupDenominator:MARKUP_DENOMINATOR.toString(),
  validityDays:60,appliesTo:'new_ai_credit_purchase_only',usageScope:'internal_ai_services_only',
  legacyBalances:'unchanged',refunds:'review_under_applicable_rules'
});

function object(value,keys,code){
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.keys(value).some(key=>!keys.includes(key)))fail(code);
  return value;
}
function id(value,code){
  if(typeof value!=='string'||value.length>160||!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value))fail(code);
  return value;
}
function timestamp(value,code){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))fail(code);
  const time=Date.parse(value);if(!Number.isSafeInteger(time)||new Date(time).toISOString()!==value)fail(code);
  return time;
}
function gcd(a,b){while(b){const next=a%b;a=b;b=next;}return a;}
function rational(n,d){const divisor=gcd(n,d);return {n:n/divisor,d:d/divisor};}
function add(a,b){return rational(a.n*b.d+b.n*a.d,a.d*b.d);}
function multiply(a,b){return rational(a.n*b.n,a.d*b.d);}
function receiptFraction(value){return {numerator:value.n.toString(),denominator:value.d.toString()};}
function decimal(value,code,{positive=false}={}){
  // Bound decimal length/scale to keep malformed server configuration cheap to reject.
  if(typeof value!=='string'||value.length>80||!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value))fail(code);
  const [whole,fraction='']=value.split('.'),n=BigInt(whole+fraction),d=10n**BigInt(fraction.length);
  if(positive&&n===0n)fail(code);return rational(n,d);
}
function bigAmount(value){if(typeof value!=='bigint'||value<0n)fail('amount_invalid');return value;}
function creditRate(value){if(typeof value!=='string'||value.length>30||!/^[1-9]\d*$/.test(value))fail('credit_conversion_invalid');return BigInt(value);}
function scaledText(amount,trim=false){
  const whole=amount/MICRO,fraction=(amount%MICRO).toString().padStart(6,'0');
  return trim?`${whole}${fraction.replace(/0+$/,'')?'.'+fraction.replace(/0+$/,''):''}`:`${whole}.${fraction}`;
}

/** Non-negative BRL fraction -> microBRL, nearest integer, ties upward. */
export function roundRationalToMicroBRL({numerator,denominator}={}){
  bigAmount(numerator);if(typeof denominator!=='bigint'||denominator<=0n)fail('amount_invalid');
  const scaled=numerator*MICRO,quotient=scaled/denominator,remainder=scaled%denominator;
  return quotient+(remainder*2n>=denominator?1n:0n);
}

/** Display conversion only: never round a fractional credit up to a whole credit. */
export function creditsFromMicroBRL(microBRL,creditsPerBRL=PROPOSED_CREDIT_CONVERSION.creditsPerBRL){
  return scaledText(bigAmount(microBRL)*creditRate(creditsPerBRL),true);
}

function tokenCount(value){
  if(value===undefined||value===null)fail('usage_unknown');
  if(typeof value==='number'){if(!Number.isSafeInteger(value)||value<0)fail('usage_invalid');return BigInt(value);}
  if(typeof value==='bigint'&&value>=0n&&value.toString().length<=80)return value;
  fail('usage_invalid');
}
function readUsage(value){
  if(value===undefined||value===null)fail('usage_unknown');
  object(value,['inputTokens','cachedInputTokens','outputTokens','known'],'usage_invalid');
  if(value.known===false)fail('usage_unknown');
  if(value.known!==undefined&&value.known!==true)fail('usage_invalid');
  const input=tokenCount(value.inputTokens),cached=tokenCount(value.cachedInputTokens),output=tokenCount(value.outputTokens);
  if(cached>input)fail('usage_invalid');return {input,cached,output,uncached:input-cached};
}
const tariffKey=(provider,model,version)=>JSON.stringify([provider,model,version]);
function readTariff(value){
  const code='tariff_invalid';object(value,['providerId','modelId','version','effectiveAt','inputUsdPerMillion','cachedInputUsdPerMillion','outputUsdPerMillion'],code);
  const snapshot={providerId:id(value.providerId,code),modelId:id(value.modelId,code),version:id(value.version,code),effectiveAt:value.effectiveAt,
    inputUsdPerMillion:value.inputUsdPerMillion,cachedInputUsdPerMillion:value.cachedInputUsdPerMillion,outputUsdPerMillion:value.outputUsdPerMillion};
  return freeze({snapshot,at:timestamp(value.effectiveAt,code),input:decimal(value.inputUsdPerMillion,code),cached:decimal(value.cachedInputUsdPerMillion,code),output:decimal(value.outputUsdPerMillion,code)});
}
function readFx(value){
  const code='fx_invalid';object(value,['version','observedAt','usdToBrl'],code);
  return freeze({snapshot:{version:id(value.version,code),observedAt:value.observedAt,usdToBrl:value.usdToBrl},at:timestamp(value.observedAt,code),rate:decimal(value.usdToBrl,code,{positive:true})});
}
function fingerprint(value,code){if(typeof value!=='string'||! /^[a-f0-9]{64}$/.test(value))fail(code);return value;}
function readQuote(value){
  const code='quote_invalid';object(value,['quoteId','providerId','modelId','kind','tariffVersion','tariffEffectiveAt','status','quotedAt','expiresAt','requestFingerprint','totalUsd'],code);
  if(value.status!=='confirmed')fail('quote_unconfirmed');if(!['image','video'].includes(value.kind))fail(code);
  const snapshot={quoteId:id(value.quoteId,code),providerId:id(value.providerId,code),modelId:id(value.modelId,code),kind:value.kind,
    tariffVersion:id(value.tariffVersion,code),tariffEffectiveAt:value.tariffEffectiveAt,status:'confirmed',quotedAt:value.quotedAt,expiresAt:value.expiresAt,
    requestFingerprint:fingerprint(value.requestFingerprint,code),totalUsd:value.totalUsd};
  const effectiveAt=timestamp(value.tariffEffectiveAt,code),quotedAt=timestamp(value.quotedAt,code),expiresAt=timestamp(value.expiresAt,code);
  if(effectiveAt>quotedAt||expiresAt<=quotedAt)fail(code);
  return freeze({snapshot,quotedAt,expiresAt,cost:decimal(value.totalUsd,code)});
}
function snapshots(values,read,key,duplicate){
  if(!Array.isArray(values)||values.length>10000)fail('pricing_config_invalid');
  const result=new Map();for(const value of values){const normalized=read(value),identity=key(normalized.snapshot);if(result.has(identity))fail(duplicate);result.set(identity,normalized);}return result;
}

/** All snapshots are copied/frozen at construction. Request fingerprints bind
 * media quotes to the exact server-approved request (quantity, size, duration,
 * quality, etc.); the core does not guess a media price from a model name.
 * Quote reuse/debit idempotency belongs to a future authenticated ledger, not
 * this calculator. Repeated calls here only return the same calculation.
 */
export function createAiCreditPricing(config={}){
  object(config,['tariffs','fxSnapshots','mediaQuotes','creditConversion'],'pricing_config_invalid');
  const tariffs=snapshots(config.tariffs??[],readTariff,s=>tariffKey(s.providerId,s.modelId,s.version),'tariff_duplicate');
  const rates=snapshots(config.fxSnapshots??[],readFx,s=>s.version,'fx_duplicate');
  const quotes=snapshots(config.mediaQuotes??[],readQuote,s=>s.quoteId,'quote_duplicate');
  const supplied=config.creditConversion??PROPOSED_CREDIT_CONVERSION;
  object(supplied,['version','status','creditsPerBRL'],'credit_conversion_invalid');creditRate(supplied.creditsPerBRL);
  if(!['proposed','configured'].includes(supplied.status))fail('credit_conversion_invalid');
  const conversion=freeze({version:id(supplied.version,'credit_conversion_invalid'),status:supplied.status,creditsPerBRL:supplied.creditsPerBRL});
  function common(input,keys){
    const code='pricing_request_invalid';object(input,keys,code);
    id(input.providerId,code);id(input.modelId,code);id(input.tariffVersion,code);id(input.fxVersion,code);
    const at=timestamp(input.pricedAt,code),fx=rates.get(input.fxVersion);
    if(!fx)fail('fx_not_found');if(fx.at>at)fail('fx_not_effective');return {at,fx};
  }
  function finish(kind,costUsd,fx,audit,extra){
    const costBrl=multiply(costUsd,fx.rate),customerBrl=multiply(costBrl,{n:MARKUP_NUMERATOR,d:MARKUP_DENOMINATOR});
    const microBRL=roundRationalToMicroBRL({numerator:customerBrl.n,denominator:customerBrl.d});
    return freeze({kind,...extra,costUsdExact:receiptFraction(costUsd),costBrlExact:receiptFraction(costBrl),customerBrlExact:receiptFraction(customerBrl),
      customerMicroBRL:microBRL.toString(),customerBRL:scaledText(microBRL),credits:creditsFromMicroBRL(microBRL,conversion.creditsPerBRL),
      audit:{...audit,fxVersion:fx.snapshot.version,fxObservedAt:fx.snapshot.observedAt,usdToBrl:fx.snapshot.usdToBrl,
        markupNumerator:AI_CREDIT_POLICY.markupNumerator,markupDenominator:AI_CREDIT_POLICY.markupDenominator,rounding:'half_up_at_final_microBRL',policyVersion:AI_CREDIT_POLICY.version,
        creditConversionVersion:conversion.version,creditConversionStatus:conversion.status,creditsPerBRL:conversion.creditsPerBRL}});
  }
  function priceChat(input){
    const {at,fx}=common(input,['providerId','modelId','tariffVersion','fxVersion','pricedAt','usage']);
    const tariff=tariffs.get(tariffKey(input.providerId,input.modelId,input.tariffVersion));
    if(!tariff)fail('tariff_not_found');if(tariff.at>at)fail('tariff_not_effective');
    const counts=readUsage(input.usage);
    const cost=add(add(multiply(tariff.input,{n:counts.uncached,d:MICRO}),multiply(tariff.cached,{n:counts.cached,d:MICRO})),multiply(tariff.output,{n:counts.output,d:MICRO}));
    return finish('chat',cost,fx,{providerId:input.providerId,modelId:input.modelId,tariffVersion:input.tariffVersion,tariffEffectiveAt:tariff.snapshot.effectiveAt,
      pricedAt:input.pricedAt,tariffSnapshot:tariff.snapshot},{basis:'reported_usage',usage:{inputTokens:counts.input.toString(),cachedInputTokens:counts.cached.toString(),uncachedInputTokens:counts.uncached.toString(),outputTokens:counts.output.toString()}});
  }
  function priceMedia(input){
    const {at,fx}=common(input,['quoteId','providerId','modelId','kind','tariffVersion','fxVersion','pricedAt','requestFingerprint']);
    id(input.quoteId,'pricing_request_invalid');fingerprint(input.requestFingerprint,'pricing_request_invalid');
    const quote=quotes.get(input.quoteId);if(!quote)fail('quote_unconfirmed');const snapshot=quote.snapshot;
    if(['providerId','modelId','kind','tariffVersion','requestFingerprint'].some(key=>input[key]!==snapshot[key]))fail('quote_mismatch');
    if(at<quote.quotedAt)fail('quote_not_effective');if(at>=quote.expiresAt)fail('quote_expired');
    return finish(snapshot.kind,quote.cost,fx,{providerId:snapshot.providerId,modelId:snapshot.modelId,tariffVersion:snapshot.tariffVersion,
      tariffEffectiveAt:snapshot.tariffEffectiveAt,pricedAt:input.pricedAt,quoteId:snapshot.quoteId,quoteConfirmedAt:snapshot.quotedAt,
      quoteExpiresAt:snapshot.expiresAt,requestFingerprint:snapshot.requestFingerprint,quoteSnapshot:snapshot},{basis:'confirmed_quote'});
  }
  return Object.freeze({priceChat,priceMedia});
}

/** Terms for one NEW purchase only. No access to existing wallets or balances,
 * no migration and no automatic forfeiture. 60 days means an exact UTC duration.
 */
export function newAiCreditPurchaseTerms(input){
  object(input,['newPurchase','purchaseId','purchasedAt'],'purchase_invalid');
  if(input.newPurchase!==true)fail('new_purchase_required');
  const purchaseId=id(input.purchaseId,'purchase_invalid'),purchasedAt=timestamp(input.purchasedAt,'purchase_invalid');
  const expiry=BigInt(purchasedAt)+VALIDITY_MS;
  if(expiry>8_640_000_000_000_000n)fail('purchase_invalid');
  return freeze({purchaseId,purchasedAt:input.purchasedAt,expiresAt:new Date(Number(expiry)).toISOString(),validityDays:60,
    appliesTo:AI_CREDIT_POLICY.appliesTo,usageScope:AI_CREDIT_POLICY.usageScope,policyVersion:AI_CREDIT_POLICY.version,refunds:AI_CREDIT_POLICY.refunds});
}
