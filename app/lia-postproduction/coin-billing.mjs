/** Adapter to the EXISTING createCoinAiWalletAdapter. No new balance or grants.
 * Rates are reviewed ceilings in micro-BRL supplied only by the server.
 * Provider consumption is held for reconciliation, never invented from a list price.
 */
import {randomUUID} from 'node:crypto';
import {requireValue} from './providers.mjs';
export function createPostProductionCoinBilling({wallet,tariff,now=Date.now}={}) {
  requireValue(wallet?.unified===true&&['allowsScope','reserve','authorizeReservation','release','settle'].every(k=>typeof wallet[k]==='function'),'canonical_coin_wallet_required');
  function checkedTariff(){
    requireValue(tariff&&typeof tariff.version==='string'&&/^[A-Za-z0-9._-]{1,80}$/.test(tariff.version)&&
      Number.isSafeInteger(tariff.reviewedAt)&&tariff.reviewedAt<=now()&&now()-tariff.reviewedAt<=7*86400000,'postproduction_tariff_stale');
    for(const key of ['speechMicroBrlPer1000Chars','syncMicroBrlPerSecond','editingMicroBrl'])requireValue(Number.isSafeInteger(tariff[key])&&tariff[key]>=0&&tariff[key]<=1e10,'postproduction_tariff_invalid');
    return tariff;
  }
  return Object.freeze({
    quote({scope,billingInputs}){
      requireValue(wallet.allowsScope(scope)===true,'postproduction_access_denied');const t=checkedTariff();
      if(billingInputs.synchronization?.provider==='heygen')requireValue(t.synchronizationProvider==='heygen'&&t.synchronizationMode===billingInputs.synchronization.mode,'heygen_tariff_not_reviewed');
      const chars=billingInputs.speechCharacters,ms=billingInputs.syncMilliseconds;
      requireValue(Number.isSafeInteger(chars)&&chars>0&&Number.isSafeInteger(ms)&&ms>=0,'postproduction_tariff_invalid');
      requireValue(t.speechMicroBrlPer1000Chars>0&&(!ms||t.syncMicroBrlPerSecond>0),'postproduction_tariff_invalid');
      const ceiling=(BigInt(chars)*BigInt(t.speechMicroBrlPer1000Chars)+999n)/1000n+
        (BigInt(ms)*BigInt(t.syncMicroBrlPerSecond)+999n)/1000n+BigInt(t.editingMicroBrl);
      requireValue(ceiling>0n&&ceiling<=100000000000n,'postproduction_quote_invalid');
      return {quoteId:randomUUID(),maximumMicroBrl:Number(ceiling),expiresAt:now()+600000};
    },
    reserve({scope,requestId,fingerprint,quote}){return wallet.reserve(scope,{requestId,requestHash:fingerprint,maximumMicroBrl:quote.maximumMicroBrl,quoteId:quote.quoteId});},
    isReserved({scope,requestId,fingerprint,quote}){return wallet.authorizeReservation(scope,{requestId,requestHash:fingerprint,maximumMicroBrl:quote.maximumMicroBrl,quoteId:quote.quoteId})===true;},
    release({scope,requestId,reason}){requireValue(reason==='not_dispatched','postproduction_release_denied');return wallet.release(scope,requestId,{reason:'postproduction_not_dispatched',noConsumptionConfirmed:true});},
    hold({scope,requestId}){return wallet.settle(scope,requestId,{actualMicroBrl:null,receiptId:'lia_postproduction:'+requestId});}
  });
}
