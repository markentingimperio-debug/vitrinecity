import {createHash} from 'node:crypto';
import {rasterSize} from '../../web-story-assets.js';

// Official Kling image-generation contract, inspected 2026-09-14:
// https://kling.ai/document-api/api/image/3-0-omni/image-generation
// api-COBzKYRI.js from the official documentation CDN. One image only.
const ORIGIN='https://api-singapore.klingai.com',MODEL='kling-v3';
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/;
const DECIMAL=/^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
function shape(x,keys,code){if(!plain(x)||Object.keys(x).some(k=>!keys.includes(k)))fail(code);}
const CONTENT=['prompt','aspectRatio','externalTaskId','referenceImageBase64'];
const PERMIT=['authorized','scope','requestId','requestHash','model','accountBinding','policyRevision','externalTaskId','reservationId','quoteId','maximumMicroBrl','expiresAt'];
const RECEIPT=['provider','model','scope','requestId','requestHash','accountBinding','policyRevision','externalTaskId','reservationId','quoteId','maximumMicroBrl','taskId'];
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function bodyFor(input){
  shape(input,CONTENT,'kling_input_invalid');
  if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>2500||!input.prompt.isWellFormed()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.prompt)||!['1:1','16:9','9:16'].includes(input.aspectRatio)||typeof input.externalTaskId!=='string'||!ID.test(input.externalTaskId))fail('kling_input_invalid');
  const body={model_name:MODEL,prompt:input.prompt,n:1,resolution:'1k',aspect_ratio:input.aspectRatio,watermark_info:{enabled:false},external_task_id:input.externalTaskId};
  if(input.referenceImageBase64!==undefined){
    const b64=input.referenceImageBase64;
    if(typeof b64!=='string'||b64.length>2800000||b64.length%4||! /^[A-Za-z0-9+/]+={0,2}$/.test(b64))fail('kling_input_invalid');
    const bytes=Buffer.from(b64,'base64');let size;try{size=rasterSize(bytes);}catch{fail('kling_input_invalid');}
    if(bytes.toString('base64')!==b64||!['png','jpeg'].includes(size.type)||size.width<300||size.height<300||size.width/size.height<0.4||size.width/size.height>2.5)fail('kling_input_invalid');
    body.image=b64;
  }
  return body;
}
export const hashKlingPaidImageRequest=input=>hash(bodyFor(input));
function safeUrl(value){try{const u=new URL(value);return typeof value==='string'&&value.length<=8192&&!/[\\\s\u0000-\u001f\u007f]/.test(value)&&u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash?value:null;}catch{return null;}}
function billing(task){
  // The legacy image endpoint does not label the cash currency. Never assume
  // CNY/USD or use list_price as deducted cost. Units are usable only when an
  // explicit zero balance deduction proves there was no additional cash part.
  if(typeof task.final_unit_deduction==='string'&&DECIMAL.test(task.final_unit_deduction)&&plain(task.final_balance_deduction)&&typeof task.final_balance_deduction.quota==='string'&&/^0(?:\.0+)?$/.test(task.final_balance_deduction.quota))return {known:true,entries:[{charge_type:'unit',package_type:'image',amount:task.final_unit_deduction}]};
  return {known:false,entries:null};
}
/** Private, non-retrying transport. Synchronous dispatch/poll assertions must
 * bind a persisted prepaid intention. It never handles wallet money itself. */
export function createKlingPaidImageAdapter({enabled=false,apiKey='',accountBinding='',policyRevision='',assertAuthorized,assertPollAuthorized,fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=60000}={}){
  if(typeof enabled!=='boolean'||typeof apiKey!=='string'||apiKey&&!/^[\x21-\x7e]{1,4096}$/.test(apiKey)||typeof accountBinding!=='string'||typeof policyRevision!=='string'||typeof now!=='function'||typeof fetchImpl!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)fail('kling_config_invalid');
  function binding(p){return p.model===MODEL&&p.accountBinding===accountBinding&&p.policyRevision===policyRevision&&/^(?:admin|store|user):[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(p.scope)&&[p.requestId,p.externalTaskId,p.reservationId,p.quoteId].every(x=>typeof x==='string'&&ID.test(x))&&/^[a-f0-9]{64}$/.test(p.requestHash)&&typeof p.maximumMicroBrl==='string'&&/^[1-9]\d{0,17}$/.test(p.maximumMicroBrl);}
  function base(receipt=null,polling=false){return {ok:false,provider:'kling_api',model:MODEL,status:'not_dispatched',code:null,transportStarted:false,retryAllowed:false,billingDisposition:polling?'hold':'no_dispatch',remoteTerminal:null,providerStatus:null,receipt,receiptId:receipt?.taskId?`kling_api:${receipt.taskId}`:null,billing:{known:false,entries:null},output:null};}
  function ready(){if(!enabled)fail('kling_disabled');if(!apiKey)fail('kling_key_missing');if(!ID.test(accountBinding)||!ID.test(policyRevision))fail('kling_binding_missing');}
  function assert(fn,value,code){let result;try{result=fn?.(value);}catch{}if(result!==true){if(result?.then)Promise.resolve(result).catch(()=>{});fail(code);}}
  async function exchange(url,body,receipt,signal,polling){
    const sent={...base(receipt,polling),transportStarted:true,status:'indeterminate',billingDisposition:'hold'},controller=new AbortController();
    let reader,timer;const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    const interrupted=new Promise(resolve=>{timer=setTimeout(()=>{abort();resolve({...sent,code:'kling_timeout_unknown'});},timeoutMs);controller.signal.addEventListener('abort',()=>resolve({...sent,code:'kling_transport_unknown'}),{once:true});});
    const run=async()=>{let response;try{
      response=await fetchImpl(url,{method:polling?'GET':'POST',redirect:'error',signal:controller.signal,headers:{authorization:`Bearer ${apiKey}`,accept:'application/json','content-type':'application/json'},...(polling?{}:{body:JSON.stringify(body)})});
      if(!response?.body?.getReader||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))fail('kling_response_invalid');
      reader=response.body.getReader();let bytes=0;const chunks=[];
      for(;;){const item=await reader.read();if(controller.signal.aborted)fail('kling_transport_unknown');if(item.done)break;bytes+=item.value.byteLength;if(bytes>262144)fail('kling_response_invalid');chunks.push(item.value);}
      const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes))),task=raw?.data;
      if(!plain(raw)||raw.code!==0||!plain(task)||typeof task.task_id!=='string'||!ID.test(task.task_id)||task.task_info?.external_task_id!==receipt.externalTaskId||receipt.taskId&&receipt.taskId!==task.task_id)return {...sent,code:'kling_receipt_mismatch'};
      const bound={...receipt,taskId:task.task_id},known={...sent,receipt:bound,receiptId:`kling_api:${task.task_id}`,billing:billing(task),providerStatus:task.task_status};
      if(response.redirected||!response.ok)return {...known,code:'kling_http_error'};
      if(!['submitted','processing','succeed','failed'].includes(task.task_status))return {...known,code:'kling_status_unknown'};
      if(!polling)return {...known,ok:true,status:'accepted',remoteTerminal:false};
      if(['submitted','processing'].includes(task.task_status))return {...known,ok:true,status:'pending',remoteTerminal:false};
      known.remoteTerminal=true;if(known.billing.known)known.billingDisposition='reconcile';
      if(task.task_status==='failed')return {...known,status:'failed',code:'kling_generation_failed'};
      const images=task.task_result?.images,outputUrl=Array.isArray(images)&&images.length===1?safeUrl(images[0]?.url):null;
      if(!outputUrl)return {...known,status:'invalid_response',code:'kling_output_invalid'};
      return {...known,ok:true,status:'completed',output:{type:'image',url:outputUrl,id:`image-${task.task_id}`}};
    }catch{return {...sent,code:'kling_transport_unknown'};}finally{try{await reader?.cancel();}catch{}try{if(!reader)await response?.body?.cancel();}catch{}}};
    try{return await Promise.race([run(),interrupted]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  async function invoke(input){let body,receipt;try{
    ready();shape(input,['requestId',...CONTENT,'permit','signal'],'kling_input_invalid');body=bodyFor(Object.fromEntries(CONTENT.map(k=>[k,input[k]])));shape(input.permit,PERMIT,'kling_authorization_invalid');
    const p=Object.freeze({...input.permit});if(!binding(p)||p.authorized!==true||p.requestId!==input.requestId||p.requestHash!==hash(body)||p.externalTaskId!==input.externalTaskId||!Number.isSafeInteger(p.expiresAt)||p.expiresAt<=now())fail('kling_authorization_invalid');
    if(input.signal!=null&&!(input.signal instanceof AbortSignal))fail('kling_input_invalid');if(input.signal?.aborted)fail('kling_cancelled_before_dispatch');
    const {authorized,expiresAt,...rest}=p;receipt={provider:'kling_api',...rest,taskId:null};
    assert(assertAuthorized,p,'kling_authorization_denied');if(p.expiresAt<=now()||input.signal?.aborted)fail('kling_cancelled_before_dispatch');
  }catch(error){return {...base(),code:['kling_disabled','kling_key_missing','kling_binding_missing','kling_input_invalid','kling_authorization_invalid','kling_authorization_denied','kling_cancelled_before_dispatch'].includes(error.code)?error.code:'kling_input_invalid'};}
    return exchange(`${ORIGIN}/v1/images/generations`,body,receipt,input.signal,false);
  }
  async function poll(input){let r;try{
    ready();shape(input,['receipt','signal'],'kling_input_invalid');shape(input.receipt,RECEIPT,'kling_receipt_invalid');r=Object.freeze({...input.receipt});
    if(r.provider!=='kling_api'||!binding(r)||r.taskId!==null&&(typeof r.taskId!=='string'||!ID.test(r.taskId)))fail('kling_receipt_invalid');
    if(input.signal!=null&&!(input.signal instanceof AbortSignal))fail('kling_input_invalid');if(input.signal?.aborted)fail('kling_cancelled_before_dispatch');assert(assertPollAuthorized,r,'kling_poll_authorization_denied');
  }catch{return {...base(null,true),code:'kling_poll_authorization_denied'};}
    return exchange(`${ORIGIN}/v1/images/generations/${encodeURIComponent(r.taskId||r.externalTaskId)}`,null,r,input.signal,true);
  }
  return Object.freeze({enabled,provider:'kling_api',model:MODEL,invoke,poll});
}
