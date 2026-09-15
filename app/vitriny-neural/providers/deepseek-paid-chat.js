import {createHash} from 'node:crypto';
import {LIA_ORIGINAL_POLICY} from '../lia-policy.js';

const ENDPOINT='https://api.deepseek.com/chat/completions';
const MODEL='deepseek-flash';
const RESPONSE_MODELS=new Set([MODEL,'deepseek-v4-flash']);
const SYSTEM=LIA_ORIGINAL_POLICY;
const CONTROL=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,159}$/;
export const DEEPSEEK_TARIFF_SCHEDULE='deepseek-flash-utc-weekday-20260915';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
function object(x,keys,code){if(!plain(x)||Object.keys(x).some(k=>!keys.includes(k)))fail(code);}
function integer(x,min,max,code){if(!Number.isSafeInteger(x)||x<min||x>max)fail(code);return x;}
function freeze(x){if(x&&typeof x==='object'){for(const value of Object.values(x))freeze(value);Object.freeze(x);}return x;}
const safeId=x=>typeof x==='string'&&x.length<=128&&ID.test(x)?x:null;
const unknownUsage=()=>({known:false,inputTokens:null,cachedInputTokens:null,outputTokens:null,totalTokens:null});
function payloadFor({model,messages,maxOutputTokens}){
  if(model!==MODEL)fail('deepseek_input_invalid');
  integer(maxOutputTokens,1,16384,'deepseek_input_invalid');
  if(!Array.isArray(messages)||!messages.length||messages.length>32)fail('deepseek_input_invalid');
  const copy=messages.map(m=>{
    object(m,['role','content'],'deepseek_input_invalid');
    if(!['user','assistant'].includes(m.role)||typeof m.content!=='string'||!m.content.trim()||m.content.length>16000||CONTROL.test(m.content))fail('deepseek_input_invalid');
    return {role:m.role,content:m.content};
  });
  if(copy.at(-1).role!=='user')fail('deepseek_input_invalid');
  return {model,messages:[{role:'system',content:SYSTEM},...copy],max_tokens:maxOutputTokens,thinking:{type:'disabled'},stream:false};
}
// Domain-separated exact canonical body: an OpenAI permit cannot authorize this POST.
const digest=body=>createHash('sha256').update(`deepseek\n${ENDPOINT}\n${body}`).digest('hex');
export function hashDeepSeekPaidChatRequest(input){
  object(input,['model','messages','maxOutputTokens'],'deepseek_input_invalid');
  return digest(JSON.stringify(payloadFor(input)));
}
function bandAt(ms){const d=new Date(ms),day=d.getUTCDay(),h=d.getUTCHours();return day>=1&&day<=5&&(h>=1&&h<4||h>=6&&h<10)?'peak':'offPeak';}
/** Official pricing schedule read 2026-09-15. The docs do not define which
 * request timestamp determines the tariff. Reconcile only when the ENTIRE
 * dispatch/creation/receipt interval (including 5s clock tolerance) shares one
 * tariff. Ambiguous transitions remain held, never charged as peak by default.
 * createdAt is the provider's created Unix timestamp converted to milliseconds.
 */
export function deepSeekTariffWindow({dispatchedAt,receivedAt,createdAt}={}){
  if([dispatchedAt,receivedAt,createdAt].some(x=>!Number.isSafeInteger(x)||x<0||x>8640000000000000-5000)||receivedAt<dispatchedAt||receivedAt-dispatchedAt>120000||createdAt<dispatchedAt-5000||createdAt>receivedAt+5000)return null;
  const first=Math.min(dispatchedAt,createdAt)-5000,last=Math.max(receivedAt,createdAt)+5000;
  if(first<0||bandAt(first)!==bandAt(last))return null;
  return freeze({scheduleVersion:DEEPSEEK_TARIFF_SCHEDULE,band:bandAt(first),dispatchedAt,createdAt,receivedAt});
}
function usageOf(data){
  const u=data?.usage;if(!plain(u))return unknownUsage();
  const values=[u.prompt_tokens,u.prompt_cache_hit_tokens,u.prompt_cache_miss_tokens,u.completion_tokens,u.total_tokens];
  if(values.some(x=>!Number.isSafeInteger(x)||x<0))return unknownUsage();
  const [inputTokens,cachedInputTokens,miss,outputTokens,totalTokens]=values;
  if(BigInt(cachedInputTokens)+BigInt(miss)!==BigInt(inputTokens)||BigInt(inputTokens)+BigInt(outputTokens)!==BigInt(totalTokens))return unknownUsage();
  if(Object.hasOwn(u,'prompt_tokens_details')&&(!plain(u.prompt_tokens_details)||u.prompt_tokens_details.cached_tokens!==cachedInputTokens))return unknownUsage();
  if(Object.hasOwn(u,'completion_tokens_details')){
    const d=u.completion_tokens_details;if(!plain(d))return unknownUsage();
    if(Object.hasOwn(d,'reasoning_tokens')&&(!Number.isSafeInteger(d.reasoning_tokens)||d.reasoning_tokens<0||d.reasoning_tokens>outputTokens))return unknownUsage();
  }
  for(const d of [u.prompt_tokens_details,u.completion_tokens_details])for(const key of ['audio_tokens','image_tokens','cache_write_tokens'])if(d&&Object.hasOwn(d,key)&&d[key]!==0)return unknownUsage();
  // Completion tokens already include reasoning; never add the detail again.
  return {known:true,inputTokens,cachedInputTokens,outputTokens,totalTokens};
}
function discard(r){try{Promise.resolve(r?.body?.cancel()).catch(()=>{});}catch{}}

/** Paid text only; no env/DB reads, tools, media, retry or fallback. The caller
 * must make assertAuthorized a synchronous durable one-use dispatch claim.
 * Any outcome after fetch starts is held unless a strict receipt reconciles.
 * Prices are NOT chosen here: the runtime uses the frozen server tariff pair.
 */
export function createDeepSeekPaidChatAdapter(options={}){
  object(options,['enabled','apiKey','model','acceptedResponseModels','assertAuthorized','fetchImpl','now','maxOutputTokens','timeoutMs','maxResponseBytes','maxInputBytes'],'deepseek_config_invalid');
  const {enabled=false,apiKey='',model=MODEL,acceptedResponseModels=[model],assertAuthorized,fetchImpl=globalThis.fetch,now=Date.now,maxOutputTokens=1024,timeoutMs=45000,maxResponseBytes=262144,maxInputBytes=65536}=options;
  if(typeof enabled!=='boolean'||typeof apiKey!=='string'||apiKey&&!/^[\x21-\x7e]{1,512}$/.test(apiKey)||model!==MODEL||typeof fetchImpl!=='function'||typeof now!=='function'||!Array.isArray(acceptedResponseModels)||!acceptedResponseModels.length||acceptedResponseModels.length>8||acceptedResponseModels.some(x=>!RESPONSE_MODELS.has(x)))fail('deepseek_config_invalid');
  integer(maxOutputTokens,1,16384,'deepseek_config_invalid');integer(timeoutMs,1,120000,'deepseek_config_invalid');integer(maxResponseBytes,1024,1048576,'deepseek_config_invalid');integer(maxInputBytes,1024,262144,'deepseek_config_invalid');
  const accepted=new Set(acceptedResponseModels),clock=()=>integer(now(),0,8640000000000000,'deepseek_authorization_invalid');
  async function invoke(input){
    const base={ok:false,provider:'deepseek',requestedModel:model,model:null,providerReceiptId:null,receiptId:null,providerRequestId:null,status:'not_dispatched',code:null,text:null,finishReason:null,transportStarted:false,billingDisposition:'no_dispatch',retryAllowed:false,usage:unknownUsage(),pricingWindow:null};
    let body,permit,signal,limit,dispatchedAt;
    try{
      if(!enabled)fail('deepseek_disabled');if(!apiKey)fail('deepseek_key_missing');if(typeof assertAuthorized!=='function')fail('deepseek_authorization_required');
      object(input,['requestId','messages','maxOutputTokens','permit','signal'],'deepseek_input_invalid');
      if(typeof input.requestId!=='string'||!ID.test(input.requestId))fail('deepseek_input_invalid');
      signal=input.signal;if(signal!=null&&!(signal instanceof AbortSignal))fail('deepseek_input_invalid');if(signal?.aborted)fail('deepseek_cancelled_before_dispatch');
      limit=integer(input.maxOutputTokens,1,maxOutputTokens,'deepseek_input_invalid');body=JSON.stringify(payloadFor({model,messages:input.messages,maxOutputTokens:limit}));
      if(Buffer.byteLength(body,'utf8')>maxInputBytes)fail('deepseek_input_invalid');
      object(input.permit,['authorized','scope','requestId','requestHash','providerId','model','maxOutputTokens','reservationId','maximumMicroBrl','expiresAt'],'deepseek_authorization_invalid');permit=freeze({...input.permit});
      if(permit.authorized!==true||permit.providerId!=='deepseek'||typeof permit.scope!=='string'||!/^(?:store|admin|user):[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(permit.scope)||permit.requestId!==input.requestId||permit.requestHash!==digest(body)||permit.model!==model||permit.maxOutputTokens!==limit||typeof permit.reservationId!=='string'||!ID.test(permit.reservationId)||typeof permit.maximumMicroBrl!=='string'||!/^[1-9]\d{0,17}$/.test(permit.maximumMicroBrl))fail('deepseek_authorization_invalid');
      integer(permit.expiresAt,1,Number.MAX_SAFE_INTEGER,'deepseek_authorization_invalid');if(permit.expiresAt<=clock())fail('deepseek_authorization_expired');
      let assertion;try{assertion=assertAuthorized(permit);}catch{fail('deepseek_authorization_denied');}
      if(assertion!==true){if(assertion&&typeof assertion.then==='function')Promise.resolve(assertion).catch(()=>{});fail('deepseek_authorization_denied');}
      dispatchedAt=clock();if(permit.expiresAt<=dispatchedAt)fail('deepseek_authorization_expired');if(signal?.aborted)fail('deepseek_cancelled_before_dispatch');
    }catch(error){return freeze({...base,code:/^deepseek_(?:disabled|key_missing|authorization_(?:required|invalid|expired|denied)|input_invalid|cancelled_before_dispatch)$/.test(error?.code)?error.code:'deepseek_input_invalid'});}
    const controller=new AbortController();let timer,reader,interruption=null,providerRequestId=null,interrupt;
    const sent={...base,status:'indeterminate',transportStarted:true,billingDisposition:'hold'};
    const interrupted=new Promise(resolve=>{interrupt=code=>{if(interruption)return;interruption=code;controller.abort();try{Promise.resolve(reader?.cancel()).catch(()=>{});}catch{}resolve(freeze({...sent,providerRequestId,code}));};});
    const onAbort=()=>interrupt('deepseek_cancelled_unknown');signal?.addEventListener('abort',onAbort,{once:true});timer=setTimeout(()=>interrupt('deepseek_timeout_unknown'),timeoutMs);
    const receive=async()=>{
      let response;
      try{
        response=await fetchImpl(ENDPOINT,{method:'POST',redirect:'error',signal:controller.signal,headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json',accept:'application/json'},body});
        providerRequestId=safeId(response?.headers?.get('x-request-id'));
        if(controller.signal.aborted){discard(response);return freeze({...sent,providerRequestId,code:interruption});}
        if(!response?.body?.getReader)fail('deepseek_response_invalid');const declared=response.headers?.get('content-length');
        if(declared!=null&&(!/^\d+$/.test(declared)||BigInt(declared)>BigInt(maxResponseBytes))){discard(response);fail('deepseek_response_too_large');}
        reader=response.body.getReader();let bytes=0;const chunks=[];
        for(;;){const {value,done}=await reader.read();if(controller.signal.aborted)fail('deepseek_transport_unknown');if(done)break;if(!(value instanceof Uint8Array))fail('deepseek_response_invalid');bytes+=value.byteLength;if(bytes>maxResponseBytes)fail('deepseek_response_too_large');chunks.push(value);}
        const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes)));
        const usage=usageOf(data),observedModel=typeof data?.model==='string'&&RESPONSE_MODELS.has(data.model)?data.model:null,providerReceiptId=safeId(data?.id);
        const pricingWindow=Number.isSafeInteger(data?.created)?deepSeekTariffWindow({dispatchedAt,receivedAt:clock(),createdAt:data.created*1000}):null;
        const evidence={...sent,providerRequestId,model:observedModel,providerReceiptId,receiptId:providerReceiptId?`deepseek:${providerReceiptId}`:null,usage,pricingWindow};
        const modelMatches=observedModel!==null&&accepted.has(observedModel);
        if(plain(data)&&data.object==='chat.completion'&&modelMatches&&providerReceiptId&&usage.known&&pricingWindow&&usage.outputTokens<=limit)evidence.billingDisposition='reconcile';
        if(response.redirected||response.status<200||response.status>=300)return freeze({...evidence,code:'deepseek_http_error'});
        if(!plain(data)||data.object!=='chat.completion')return freeze({...evidence,code:'deepseek_response_invalid'});
        if(!modelMatches)return freeze({...evidence,code:'deepseek_model_mismatch'});
        if(!providerReceiptId)return freeze({...evidence,code:'deepseek_receipt_missing'});
        if(!usage.known)return freeze({...evidence,code:'deepseek_usage_unknown'});
        if(!pricingWindow)return freeze({...evidence,code:'deepseek_tariff_window_unknown'});
        if(usage.outputTokens>limit)return freeze({...evidence,code:'deepseek_budget_exceeded'});
        if(data.error!=null)return freeze({...evidence,code:'deepseek_provider_error'});
        const choice=Array.isArray(data.choices)&&data.choices.length===1?data.choices[0]:null,message=choice?.message;
        const finishReason=['stop','length','content_filter','tool_calls','insufficient_system_resource','aborted'].includes(choice?.finish_reason)?choice.finish_reason:null,result={...evidence,status:'invalid_response',finishReason};
        if(!plain(message)||message.role!=='assistant'||choice.index!==0||!finishReason)return freeze({...result,code:'deepseek_response_invalid'});
        if(finishReason==='tool_calls'||message.tool_calls!=null||message.function_call!=null||message.audio!=null)return freeze({...result,code:'deepseek_tools_not_allowed'});
        if(typeof message.refusal==='string'&&message.refusal.trim())return freeze({...result,status:'refused',code:'deepseek_refused'});
        if(message.refusal!=null&&typeof message.refusal!=='string')return freeze({...result,code:'deepseek_response_invalid'});
        if(finishReason!=='stop')return freeze({...result,status:'incomplete',code:'deepseek_incomplete'});
        if(typeof message.content!=='string'||!message.content.trim()||message.content.length>65536||CONTROL.test(message.content))return freeze({...result,code:'deepseek_response_invalid'});
        return freeze({...result,ok:true,status:'completed',code:null,text:message.content.trim()});
      }catch(error){return freeze({...sent,providerRequestId,code:interruption||(['deepseek_response_invalid','deepseek_response_too_large'].includes(error?.code)?error.code:'deepseek_transport_unknown')});}
      finally{try{if(reader)Promise.resolve(reader.cancel()).catch(()=>{});else discard(response);}catch{}}
    };
    try{return await Promise.race([receive(),interrupted]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
  }
  return Object.freeze({enabled,provider:'deepseek',model,invoke});
}
