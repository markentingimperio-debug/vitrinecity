/** Canonical Vitrine Coins boundary. No IO, environment or monetary mutation. */
export const VITRINE_COINS_POLICY = Object.freeze({
  version:'vitrine-coins-topup-15-v1',name:'Vitrine Coins',currency:'VITRINE_COINS',
  coinsPerBRL:'9.6',atomsPerCoin:'10000000',atomsPerBRL:'96000000',
  atomsPerMicroBRL:'96',atomsPerLegacyAdsUnit:'100000',
  feeStage:'topup',topupFeeBps:1500,usageMarkupBps:0,validityDays:60,
  courseMaxDiscountPercent:30
});
const MAX=9_000_000_000_000_000n;
export function coinAtoms(value){
  if(typeof value==='number'){if(!Number.isSafeInteger(value))throw Error('coin_amount_invalid');value=String(value);}
  if(typeof value!=='string'||! /^(?:0|[1-9]\d{0,15})$/.test(value))throw Error('coin_amount_invalid');
  const n=BigInt(value);if(n>MAX)throw Error('coin_amount_invalid');return n;
}
export function coinsFromAtoms(value){const n=coinAtoms(value),d=10000000n,f=(n%d).toString().padStart(7,'0').replace(/0+$/,'');return `${n/d}${f?'.'+f:''}`;}
export function atomsFromMicroBRL(value){return coinAtoms((coinAtoms(value)*96n).toString()).toString();}
export function atomsFromLegacyAdsUnits(value){return coinAtoms((coinAtoms(value)*100000n).toString()).toString();}
export function atomsFromRewardPoints(points,pointsPerBRL){
  const n=coinAtoms(points)*96000000n,d=coinAtoms(pointsPerBRL);
  if(d===0n||n%d!==0n)throw Error('coin_conversion_review_required');
  return coinAtoms((n/d).toString()).toString();
}
export function quoteCoinTopup(amountCents){
  const n=coinAtoms(amountCents);if(n<1n||n>500000n)throw Error('coin_topup_invalid');
  // Preserve the Ads rule: 15% of gross, rounded to a cent, once at purchase.
  const fee=(n*15n+50n)/100n,net=n-fee;
  return Object.freeze({policyVersion:VITRINE_COINS_POLICY.version,amountCents:Number(n),
    feeCents:Number(fee),netCents:Number(net),netAtoms:(net*960000n).toString(),
    netCoins:coinsFromAtoms((net*960000n).toString())});
}
export function assertCoinStatus(value){
  if(!value||value.currency!==VITRINE_COINS_POLICY.currency||value.policyVersion!==VITRINE_COINS_POLICY.version||value.unified!==true||typeof value.frozen!=='boolean')throw Error('coin_status_invalid');
  for(const key of ['availableAtoms','reservedAtoms','chargedAtoms','expiredAtoms'])coinAtoms(value[key]);
  return value;
}

/** Authoritative internal provider interface (owner resolved by server only):
 * createCoinWallet({db,enabled,now}) -> enabled, status(userId),
 * grant(userId,{sourceId,amountAtoms,origin,createdAt,expiresAt,termsVersion,paymentReference?}),
 * reserve(userId,{requestId,maximumAtoms,quoteId,requestHash,service}),
 * settle(userId,requestId,{actualAtoms,receiptId}),
 * release(userId,requestId,{reason,noConsumptionConfirmed:true}),
 * freeze(userId,{paymentReference,reason}),
 * spend(userId,{requestId,amountAtoms,service,description?}),
 * restore(userId,requestId,{reason}), history(userId).
 * All amounts are decimal-string atoms, never floating money. Source/request IDs
 * are idempotent and scope-bound. restore preserves ORIGINAL lot expirations and
 * is prohibited for API consumption. Migration copies individually proven legacy
 * lots without deleting history; incomplete coverage/ownership blocks cutover.
 */
