/** HeyGen v3 lip sync with an externally generated voice. No retries or fallback.
 * Call only inside the executor's persisted, approved stage. Assets are uploaded
 * as bytes; the application never has to publish its own private source URLs.
 */
import {createHash} from 'node:crypto';
import {createVoiceSyncProviders,createSyncDownloader,requireValue,problem,boundedBytes} from './providers.mjs';
const ORIGIN='https://api.heygen.com';
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const isId=value=>typeof value==='string'&&ID.test(value);
const KEY=/^[\x21-\x7e]{8,4096}$/;
const JOB_KEY=/^[A-Za-z0-9][A-Za-z0-9_.:-]{11,180}$/;
const MODES=new Set(['speed','precision']);
const ERRORS=new Set(['unauthorized','insufficient_api_key_scope','insufficient_credit','insufficient_credits','payment_required','invalid_parameter','rate_limit_exceeded','request_in_progress','resource_not_found']);
const knownStatus={pending:'PENDING',running:'PROCESSING',completed:'COMPLETED',failed:'FAILED'};
const digest=value=>createHash('sha256').update(value).digest('hex');
export const heygenBinding=({mode,accountBinding})=>{
  requireValue(MODES.has(mode)&&typeof accountBinding==='string'&&/^[a-f0-9]{64}$/.test(accountBinding),'heygen_binding_invalid');
  return `heygen:${mode}:${accountBinding}`;
};
function plain(value){return !!value&&typeof value==='object'&&!Array.isArray(value);}
function sourceBytes(value,type){
  requireValue(Buffer.isBuffer(value)&&value.length>=64&&value.length<20_000_000,'heygen_upload_invalid');
  requireValue(type==='video'?value.toString('ascii',4,8)==='ftyp':value.toString('ascii',0,4)==='RIFF'&&value.toString('ascii',8,12)==='WAVE','heygen_upload_type_invalid');
}
export function heygenBody({videoAssetId,audioAssetId,mode,callbackId}){
  requireValue(isId(videoAssetId)&&isId(audioAssetId)&&videoAssetId!==audioAssetId&&MODES.has(mode)&&JOB_KEY.test(callbackId||''),'heygen_input_invalid');
  return {video:{type:'asset_id',asset_id:videoAssetId},audio:{type:'asset_id',asset_id:audioAssetId},mode,
    enable_caption:false,enable_dynamic_duration:false,disable_music_track:true,enable_speech_enhancement:false,
    enable_watermark:false,keep_the_same_format:true,fps_mode:'cfr',callback_id:callbackId};
}
function receipt(raw,expectedId){
  requireValue(plain(raw)&&!raw.error&&plain(raw.data),'heygen_receipt_invalid');
  const value=raw.data;
  requireValue(typeof value.id==='string'&&ID.test(value.id)&&value.id===expectedId&&Object.hasOwn(knownStatus,value.status),'heygen_receipt_mismatch');
  const result={id:value.id,provider:'heygen',status:knownStatus[value.status]};
  if(result.status==='COMPLETED'){
    requireValue(Number.isFinite(value.duration)&&value.duration>0&&value.duration<=16,'heygen_duration_invalid');
    let u;try{u=new URL(value.video_url);}catch{throw problem('heygen_output_invalid');}
    requireValue(typeof value.video_url==='string'&&value.video_url.length<=8192&&!/[\\\s\x00-\x1f\x7f]/.test(value.video_url)&&u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&!u.port,'heygen_output_invalid');
    result.outputUrl=value.video_url;result.durationSeconds=value.duration;
  }
  return result;
}
export function createHeyGenLipSync({apiKey,mode='precision',accountBinding,fetchImpl=globalThis.fetch,timeoutMs=90000,beforeRequest=()=>true}={}){
  const binding=heygenBinding({mode,accountBinding});
  requireValue(KEY.test(apiKey||'')&&typeof fetchImpl==='function'&&typeof beforeRequest==='function'&&Number.isSafeInteger(timeoutMs)&&timeoutMs>=100&&timeoutMs<=120000,'heygen_configuration_invalid');
  async function request(route,method,body,idempotencyKey,signal,guard=()=>true){
    requireValue(route==='/v3/assets'||route==='/v3/lipsyncs'||/^\/v3\/lipsyncs\/[A-Za-z0-9_-]{1,128}$/.test(route),'heygen_endpoint_denied');
    signal?.throwIfAborted();requireValue(beforeRequest()===true&&guard()===true,'heygen_authorization_revoked');
    const timeout=AbortSignal.timeout(timeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout;
    const headers={'x-api-key':apiKey,accept:'application/json'};
    if(idempotencyKey)headers['Idempotency-Key']=idempotencyKey;
    if(body!==undefined&&!(body instanceof FormData))headers['content-type']='application/json';
    let response;
    try{
      response=await fetchImpl(ORIGIN+route,{method,headers,redirect:'error',signal:combined,...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)})});
      requireValue(response&&!response.redirected&&/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''),'heygen_response_invalid');
      const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await boundedBytes(response,262144)));
      if(!response.ok||raw?.error){
        const code=raw?.error?.code;
        throw problem(ERRORS.has(code)?'heygen_'+code:'heygen_http_error');
      }
      requireValue(plain(raw),'heygen_response_invalid');return raw;
    }catch(error){
      if(typeof error?.code==='string'&&error.code.startsWith('heygen_'))throw error;
      throw problem('heygen_result_unknown');
    }finally{try{await response?.body?.cancel();}catch{}}
  }
  async function upload(bytes,type,key,signal,guard){
    const mime=type==='video'?'video/mp4':'audio/wav';
    const form=new FormData();form.set('file',new Blob([bytes],{type:mime}),type==='video'?'scene.mp4':'speech.wav');
    const raw=await request('/v3/assets','POST',form,key,signal,guard),asset=raw.data;
    requireValue(plain(asset)&&isId(asset.asset_id)&&asset.mime_type===mime&&asset.size_bytes===bytes.length,'heygen_asset_mismatch');
    return asset.asset_id; // Deliberately discard the provider's source asset URL.
  }
  async function startSync({video,audio,idempotencyKey,assertAuthorized},signal){
    requireValue(typeof assertAuthorized==='function','heygen_authorization_required');
    // Validate BOTH inputs before uploading either of them.
    sourceBytes(video,'video');sourceBytes(audio,'audio');requireValue(JOB_KEY.test(idempotencyKey||''),'heygen_idempotency_required');
    const stable=digest(binding+':'+idempotencyKey+':'+digest(video)+':'+digest(audio));
    const videoAssetId=await upload(video,'video','lia:video:'+stable,signal,assertAuthorized);
    const audioAssetId=await upload(audio,'audio','lia:audio:'+stable,signal,assertAuthorized);
    const body=heygenBody({videoAssetId,audioAssetId,mode,callbackId:'lia:'+stable});
    const raw=await request('/v3/lipsyncs','POST',body,'lia:lipsync:'+stable,signal,assertAuthorized);
    requireValue(plain(raw.data)&&isId(raw.data.lipsync_id),'heygen_receipt_invalid');
    return {provider:'heygen',mode,binding,id:raw.data.lipsync_id,status:'PENDING',videoAssetId,audioAssetId};
  }
  async function pollSync(id,signal){
    requireValue(typeof id==='string'&&ID.test(id),'heygen_receipt_invalid');
    return receipt(await request('/v3/lipsyncs/'+id,'GET',undefined,undefined,signal),id);
  }
  return Object.freeze({binding,mode,provider:'heygen',startSync,pollSync});
}
/** Preserve ElevenLabs TTS; replace ONLY the lip-sync port. Never call Sync on error. */
export function createElevenLabsHeyGenProviders({elevenLabsKey,heygenKey,mode='precision',accountBinding,fetchImpl=globalThis.fetch,beforeRequest}={}){
  const speech=createVoiceSyncProviders({elevenLabsKey,fetchImpl});
  const lips=createHeyGenLipSync({apiKey:heygenKey,mode,accountBinding,fetchImpl,beforeRequest});
  return Object.freeze({synchronizationBinding:lips.binding,
    preflight:({voice})=>speech.preflight({voice,sync:false}),speech:speech.speech,
    startSync:lips.startSync,pollSync:lips.pollSync});
}
export function createHeyGenDownloader(options={}){
  requireValue(Array.isArray(options.allowedHosts)&&options.allowedHosts.length>0,'heygen_output_hosts_required');
  return createSyncDownloader(options); // Exact host allowlist, pinned public IPv4, TLS, no redirects.
}
