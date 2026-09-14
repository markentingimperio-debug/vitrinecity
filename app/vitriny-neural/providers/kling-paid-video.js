import {createHash} from 'node:crypto';

// Official current API schemas, read 2026-09-14 (not the Studio OAuth/CLI):
// https://kling.ai/document-api/api/video/3-0-omni/text-to-video
// https://kling.ai/document-api/api/get-started/authentication
// https://s15-kling.klingai.com/kos/s101/nlav112918/api-doc/assets/query-task-endpoints-DM5Id65U.js
const ORIGIN='https://api-singapore.klingai.com';
const MODEL='kling-3.0',PROVIDER='kling_api';
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/;
const SCOPE=/^(?:store|admin|user):[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH=/^[a-f0-9]{64}$/;
const CONTROL=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const DECIMAL=/^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/;
const CONTENT_KEYS=['prompt','resolution','aspectRatio','durationSeconds','externalTaskId'];
const PERMIT_KEYS=['authorized','scope','requestId','requestHash','model','accountBinding','policyRevision','externalTaskId','reservationId','quoteId','maximumMicroBrl','expiresAt'];
const RECEIPT_KEYS=['provider','model','scope','requestId','requestHash','accountBinding','policyRevision','externalTaskId','reservationId','quoteId','maximumMicroBrl','durationSeconds','taskId'];
const PRE_CODES=new Set(['kling_disabled','kling_key_missing','kling_binding_missing','kling_authorization_required','kling_input_invalid','kling_cancelled_before_dispatch','kling_authorization_invalid','kling_authorization_expired','kling_authorization_denied','kling_receipt_invalid','kling_poll_authorization_required','kling_poll_authorization_denied']);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const validId=v=>typeof v==='string'&&ID.test(v);
const digest=body=>createHash('sha256').update(body).digest('hex');
const unknownBilling=()=>({known:false,entries:null});
function object(v,keys,code){if(!plain(v)||Object.keys(v).some(k=>!keys.includes(k)))fail(code);}
function integer(v,min,max,code){if(!Number.isSafeInteger(v)||v<min||v>max)fail(code);return v;}
function freeze(v){if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;}
function discard(response){try{Promise.resolve(response?.body?.cancel()).catch(()=>{});}catch{}}
function syncAssertion(fn,value,code){
  try{
    const result=fn(value);
    if(result===true)return;
    // Callbacks are synchronous assertions, never awaited inside the send fence.
    if(result&&typeof result.then==='function')Promise.resolve(result).catch(()=>{});
  }catch{}
  fail(code);
}

function payloadFor(input){
  object(input,CONTENT_KEYS,'kling_input_invalid');
  const {prompt,resolution,aspectRatio,durationSeconds,externalTaskId}=input;
  if(typeof prompt!=='string'||!prompt.trim()||prompt.length>3072||!prompt.isWellFormed()||CONTROL.test(prompt)||!['720p','1080p'].includes(resolution)||!['16:9','9:16','1:1'].includes(aspectRatio)||!validId(externalTaskId))fail('kling_input_invalid');
  integer(durationSeconds,3,15,'kling_input_invalid');
  return {prompt,settings:{resolution,aspect_ratio:aspectRatio,duration:durationSeconds,audio:'off',multi_shot:false},options:{external_task_id:externalTaskId,watermark_info:{enabled:false}}};
}

/** The server prices/reserves this exact body hash, including the unique external
 * ID and fixed audio/multi-shot/watermark settings. No secrets are hashed. */
export function hashKlingPaidVideoRequest(input){return digest(JSON.stringify(payloadFor(input)));}

function validBinding(value,accountBinding,policyRevision,code){
  if(value.model!==MODEL||value.accountBinding!==accountBinding||value.policyRevision!==policyRevision||typeof value.scope!=='string'||!SCOPE.test(value.scope)||!validId(value.requestId)||typeof value.requestHash!=='string'||!HASH.test(value.requestHash)||!validId(value.externalTaskId)||!validId(value.reservationId)||!validId(value.quoteId)||typeof value.maximumMicroBrl!=='string'||!/^[1-9]\d{0,17}$/.test(value.maximumMicroBrl))fail(code);
}
function receiptOf(permit,durationSeconds){
  const {scope,requestId,requestHash,accountBinding,policyRevision,externalTaskId,reservationId,quoteId,maximumMicroBrl}=permit;
  return freeze({provider:PROVIDER,model:MODEL,scope,requestId,requestHash,accountBinding,policyRevision,externalTaskId,reservationId,quoteId,maximumMicroBrl,durationSeconds,taskId:null});
}
function billingOf(raw){
  if(!Array.isArray(raw)||!raw.length||raw.length>16)return unknownBilling();
  const entries=[];
  for(const entry of raw){
    if(!plain(entry)||typeof entry.amount!=='string'||!DECIMAL.test(entry.amount))return unknownBilling();
    if(entry.charge_type==='cash'){
      if(Object.keys(entry).some(k=>!['charge_type','cash_type','amount','currency','list_price'].includes(k))||!['balance','test_balance'].includes(entry.cash_type)||!['USD','CNY'].includes(entry.currency)||entry.list_price!==undefined&&(typeof entry.list_price!=='string'||!DECIMAL.test(entry.list_price)))return unknownBilling();
    }else if(entry.charge_type==='unit'){
      if(Object.keys(entry).some(k=>!['charge_type','amount','package_type'].includes(k))||!['video','image','audio'].includes(entry.package_type))return unknownBilling();
    }else return unknownBilling();
    // Preserve decimal strings exactly: no float conversion, FX, markup, unit
    // valuation, or substitution of list_price for the deducted amount.
    entries.push({...entry});
  }
  return {known:true,entries};
}
function outputOf(outputs,durationSeconds){
  if(!Array.isArray(outputs)||outputs.length!==1)return null;
  const o=outputs[0];
  if(!plain(o)||o.type!=='video'||!validId(o.id)||typeof o.duration!=='string'||!DECIMAL.test(o.duration)||!/[1-9]/.test(o.duration))return null;
  // Bind reported delivery duration to the originally authorized body. Compare
  // decimal strings exactly without floating point rounding (5.000 equals 5).
  const [whole,fraction='']=o.duration.split('.');
  if(BigInt(whole)!==BigInt(durationSeconds)||/[1-9]/.test(fraction))return null;
  function url(value){
    if(typeof value!=='string'||value.length>8192||/[\\\s\u0000-\u001f\u007f]/.test(value))return null;
    try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&u.hostname?value:null;}catch{return null;}
  }
  const safeUrl=url(o.url),watermarkUrl=o.watermark_url==null?null:url(o.watermark_url);
  if(!safeUrl||o.watermark_url!=null&&!watermarkUrl)return null;
  // INTERNAL evidence only. This module never downloads/follows a result URL
  // or grants permission to publish it in chat; a future asset boundary must
  // validate DNS/CDN/content and authenticated ownership separately.
  return {type:'video',id:o.id,url:safeUrl,duration:o.duration,...(watermarkUrl?{watermarkUrl}:{})};
}

/** Standalone, disabled by default. No env reads, registration, automatic worker,
 * wallet mutation, price calculation, Studio fallback, or real cancellation.
 *
 * assertAuthorized MUST synchronously consume a durable one-use dispatch claim:
 * authenticated scope, current consent/policy/account, exact body hash, valid
 * quote/reservation/budget, and globally unique external ID within the account.
 * This adapter validates bindings, NOT money. Never construct permits/callbacks
 * directly from a public request. Durable cross-process claims belong to caller.
 *
 * Persist the complete receipt/intention BEFORE invoke. A lost POST can only be
 * queried by its external ID: uniqueness is NOT a promise of POST idempotency.
 * assertPollAuthorized MUST verify current authenticated ownership against that
 * persisted receipt (including task ID when present). A syntactically valid
 * receipt is not authority. Polls do not require/consume another paid permit.
 *
 * Every started POST may be billed. Keep capacity/reservation held until an
 * explicitly polled terminal receipt proves remote settlement. A timeout/local
 * abort never cancels the remote job. Late transport completion does not mutate
 * returned evidence. `reconcile` is evidence for later accounting, never a debit
 * instruction or permission to release funds. Billing absence is not zero cost.
 */
export function createKlingPaidVideoAdapter(options={}){
  object(options,['enabled','apiKey','accountBinding','policyRevision','assertAuthorized','assertPollAuthorized','fetchImpl','now','timeoutMs','pollTimeoutMs','maxResponseBytes'],'kling_config_invalid');
  const {enabled=false,apiKey='',accountBinding='',policyRevision='',assertAuthorized,assertPollAuthorized,fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=60000,pollTimeoutMs=30000,maxResponseBytes=262144}=options;
  if(typeof enabled!=='boolean'||typeof apiKey!=='string'||apiKey&&!/^[\x21-\x7e]{1,4096}$/.test(apiKey)||typeof accountBinding!=='string'||accountBinding&&!validId(accountBinding)||typeof policyRevision!=='string'||policyRevision&&!validId(policyRevision)||typeof fetchImpl!=='function'||typeof now!=='function')fail('kling_config_invalid');
  integer(timeoutMs,1,120000,'kling_config_invalid');integer(pollTimeoutMs,1,120000,'kling_config_invalid');integer(maxResponseBytes,1024,1048576,'kling_config_invalid');
  function ready(){if(!enabled)fail('kling_disabled');if(!apiKey)fail('kling_key_missing');if(!accountBinding||!policyRevision)fail('kling_binding_missing');}
  const clock=()=>integer(now(),0,Number.MAX_SAFE_INTEGER,'kling_authorization_invalid');
  function base(receipt=null,polling=false){return {ok:false,provider:PROVIDER,model:MODEL,status:'not_dispatched',code:null,transportStarted:false,retryAllowed:false,billingDisposition:polling?'hold':'no_dispatch',remoteTerminal:null,providerStatus:null,providerCode:null,providerRequestId:null,providerReceiptId:receipt?.taskId||null,receiptId:receipt?.taskId?`${PROVIDER}:${receipt.taskId}`:null,receipt,billing:unknownBilling(),output:null};}
  function safePre(error,result){return freeze({...result,code:PRE_CODES.has(error?.code)?error.code:'kling_input_invalid'});}

  async function exchange(url,{body,signal,receipt,polling}){
    const sent={...base(receipt,polling),status:'indeterminate',transportStarted:true,billingDisposition:'hold'};
    const controller=new AbortController();let timer,reader,interruption=null;
    let interrupt;
    const interrupted=new Promise(resolve=>{interrupt=code=>{
      if(interruption)return;interruption=code;controller.abort();
      try{Promise.resolve(reader?.cancel()).catch(()=>{});}catch{}
      resolve(freeze({...sent,code}));
    };});
    const onAbort=()=>interrupt('kling_cancelled_unknown');
    signal?.addEventListener('abort',onAbort,{once:true});
    timer=setTimeout(()=>interrupt('kling_timeout_unknown'),polling?pollTimeoutMs:timeoutMs);
    const receive=async()=>{
      let response;
      try{
        response=await fetchImpl(url,{method:polling?'GET':'POST',redirect:'error',signal:controller.signal,headers:{authorization:`Bearer ${apiKey}`,accept:'application/json','content-type':'application/json'},...(polling?{}:{body})});
        if(controller.signal.aborted){discard(response);return freeze({...sent,code:interruption});}
        if(!response?.body?.getReader||!/^application\/json(?:\s*;|$)/i.test(response.headers?.get('content-type')||''))fail('kling_response_invalid');
        const declared=response.headers?.get('content-length');
        if(declared!=null&&(!/^\d+$/.test(declared)||BigInt(declared)>BigInt(maxResponseBytes)))fail('kling_response_too_large');
        reader=response.body.getReader();let bytes=0;const chunks=[];
        for(;;){
          const {value,done}=await reader.read();
          if(controller.signal.aborted)fail('kling_transport_unknown');
          if(done)break;
          if(!(value instanceof Uint8Array))fail('kling_response_invalid');
          bytes+=value.byteLength;if(bytes>maxResponseBytes)fail('kling_response_too_large');chunks.push(value);
        }
        const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes)));
        const envelopeEvidence={...sent,providerRequestId:validId(raw?.request_id)?raw.request_id:null,providerCode:Number.isSafeInteger(raw?.code)?raw.code:null};
        if(!plain(raw)||raw.code!==0)return freeze({...envelopeEvidence,code:'kling_provider_error'});
        const task=polling?(Array.isArray(raw.data)&&raw.data.length===1?raw.data[0]:null):raw.data;
        // Never return another task's output/billing or accept a response-selected
        // identity. Even an external-ID lookup must echo the exact external ID.
        if(!plain(task)||!validId(task.id)||task.external_id!==receipt.externalTaskId||receipt.taskId&&task.id!==receipt.taskId)return freeze({...envelopeEvidence,code:'kling_receipt_mismatch'});
        const boundReceipt=freeze({...receipt,taskId:task.id});
        const known={...envelopeEvidence,receipt:boundReceipt,providerReceiptId:task.id,receiptId:`${PROVIDER}:${task.id}`};
        if(!['submitted','processing','succeeded','failed'].includes(task.status))return freeze({...known,code:'kling_status_unknown'});
        known.providerStatus=task.status;
        if(!Number.isSafeInteger(task.create_time)||task.create_time<0||!Number.isSafeInteger(task.update_time)||task.update_time<task.create_time)return freeze({...known,code:'kling_response_invalid'});
        // Preserve optional billing evidence even on POST/HTTP anomalies, but
        // neither is an authorized settlement proof. Only the GET can settle.
        known.billing=billingOf(task.billing);
        if(response.redirected||response.status<200||response.status>=300)return freeze({...known,code:'kling_http_error'});
        if(!polling)return freeze({...known,ok:true,status:'accepted',remoteTerminal:false});
        const terminal=['succeeded','failed'].includes(task.status);
        known.remoteTerminal=terminal;
        if(!terminal)return freeze({...known,ok:true,status:'pending'});
        if(known.billing.known)known.billingDisposition='reconcile';
        if(task.status==='failed')return freeze({...known,status:'failed',code:'kling_generation_failed'});
        const output=outputOf(task.outputs,receipt.durationSeconds);
        if(!output)return freeze({...known,status:'invalid_response',code:'kling_output_invalid'});
        return freeze({...known,ok:true,status:'completed',output});
      }catch(error){
        return freeze({...sent,code:interruption||(['kling_response_invalid','kling_response_too_large'].includes(error?.code)?error.code:'kling_transport_unknown')});
      }finally{try{if(reader)Promise.resolve(reader.cancel()).catch(()=>{});else discard(response);}catch{}}
    };
    try{return await Promise.race([receive(),interrupted]);}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
  }

  async function invoke(input){
    let body,signal,receipt;
    try{
      ready();if(typeof assertAuthorized!=='function')fail('kling_authorization_required');
      object(input,['requestId',...CONTENT_KEYS,'permit','signal'],'kling_input_invalid');
      if(!validId(input.requestId))fail('kling_input_invalid');
      signal=input.signal;if(signal!=null&&!(signal instanceof AbortSignal))fail('kling_input_invalid');
      if(signal?.aborted)fail('kling_cancelled_before_dispatch');
      const payload=payloadFor(Object.fromEntries(CONTENT_KEYS.map(key=>[key,input[key]])));
      body=JSON.stringify(payload);
      object(input.permit,PERMIT_KEYS,'kling_authorization_invalid');
      const permit={...input.permit};validBinding(permit,accountBinding,policyRevision,'kling_authorization_invalid');
      if(permit.authorized!==true||permit.requestId!==input.requestId||permit.requestHash!==digest(body)||permit.externalTaskId!==input.externalTaskId)fail('kling_authorization_invalid');
      integer(permit.expiresAt,1,Number.MAX_SAFE_INTEGER,'kling_authorization_invalid');
      if(permit.expiresAt<=clock())fail('kling_authorization_expired');
      receipt=receiptOf(permit,payload.settings.duration);
      syncAssertion(assertAuthorized,Object.freeze(permit),'kling_authorization_denied');
      // No await between durable one-use claim, this fence, and the one POST.
      if(permit.expiresAt<=clock())fail('kling_authorization_expired');
      if(signal?.aborted)fail('kling_cancelled_before_dispatch');
    }catch(error){return safePre(error,base());}
    return exchange(`${ORIGIN}/text-to-video/${MODEL}`,{body,signal,receipt,polling:false});
  }

  async function poll(input){
    let signal,receipt,url;
    try{
      ready();if(typeof assertPollAuthorized!=='function')fail('kling_poll_authorization_required');
      object(input,['receipt','signal'],'kling_input_invalid');
      signal=input.signal;if(signal!=null&&!(signal instanceof AbortSignal))fail('kling_input_invalid');
      if(signal?.aborted)fail('kling_cancelled_before_dispatch');
      object(input.receipt,RECEIPT_KEYS,'kling_receipt_invalid');
      const copy={...input.receipt};validBinding(copy,accountBinding,policyRevision,'kling_receipt_invalid');
      if(copy.provider!==PROVIDER||copy.taskId!==null&&!validId(copy.taskId))fail('kling_receipt_invalid');
      integer(copy.durationSeconds,3,15,'kling_receipt_invalid');
      receipt=Object.freeze(copy);
      url=`${ORIGIN}/tasks?${receipt.taskId?'task_ids':'external_task_ids'}=${encodeURIComponent(receipt.taskId||receipt.externalTaskId)}`;
      syncAssertion(assertPollAuthorized,receipt,'kling_poll_authorization_denied');
      if(signal?.aborted)fail('kling_cancelled_before_dispatch');
    }catch(error){return safePre(error,base(null,true));}
    return exchange(url,{signal,receipt,polling:true});
  }
  return Object.freeze({enabled,provider:PROVIDER,model:MODEL,invoke,poll});
}
