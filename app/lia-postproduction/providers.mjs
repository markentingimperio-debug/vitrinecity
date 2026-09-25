/** Real ElevenLabs/Sync transports. No retries of paid POSTs; no public input URLs.
 * The durable executor, not this adapter, authorizes and records each dispatch.
 */
import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {BlockList,isIP} from 'node:net';

export function problem(code) { return Object.assign(new Error(code), {code}); }
export function requireValue(value,code) { if(!value)throw problem(code); }
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const LANGUAGES=new Map([['pt-BR','pt'],['en','en']]);
const MODELS=new Set(['eleven_flash_v2_5','eleven_turbo_v2_5']);
const BLOCKED=new BlockList();
for(const [network,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])BLOCKED.addSubnet(network,bits);
export const publicIPv4=ip=>isIP(ip)===4&&!BLOCKED.check(ip);
const safeId=x=>typeof x==='string'&&ID.test(x);
const secret=x=>typeof x==='string'&&/^[\x21-\x7e]{8,4096}$/.test(x);

export async function boundedBytes(response,limit) {
  requireValue(response?.body?.getReader,'provider_response_invalid');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try {
    for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
      requireValue(size<=limit,'provider_response_too_large');chunks.push(Buffer.from(part.value));}
    return Buffer.concat(chunks,size);
  } finally {try{await reader.cancel();}catch{}reader.releaseLock();}
}
function validateAlignment(value) {
  requireValue(value&&Array.isArray(value.characters)&&value.characters.length>0&&value.characters.length<=16000,'voice_alignment_invalid');
  const {characters,character_start_times_seconds:starts,character_end_times_seconds:ends}=value;
  requireValue(Array.isArray(starts)&&Array.isArray(ends)&&starts.length===characters.length&&ends.length===characters.length,'voice_alignment_invalid');
  for(let i=0;i<characters.length;i++)requireValue(typeof characters[i]==='string'&&characters[i].length<=8&&
    Number.isFinite(starts[i])&&Number.isFinite(ends[i])&&starts[i]>=0&&ends[i]>=starts[i]&&ends[i]<=120&&
    (!i||starts[i]>=starts[i-1]),'voice_alignment_invalid');
  return {characters,character_start_times_seconds:starts,character_end_times_seconds:ends};
}
export function speechBody({voiceId,model,language,text,previousText='',nextText=''}) {
  requireValue(safeId(voiceId)&&MODELS.has(model)&&LANGUAGES.has(language),'voice_configuration_invalid');
  for(const part of [text,previousText,nextText])requireValue(typeof part==='string'&&part.length<=2000&&part.isWellFormed()&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(part),'voice_text_invalid');
  requireValue(text.trim().length>0,'voice_text_invalid');
  return {text,model_id:model,language_code:LANGUAGES.get(language),previous_text:previousText,next_text:nextText};
}
function syncReceipt(body,expectedId=null) {
  requireValue(body&&safeId(body.id)&&(!expectedId||body.id===expectedId)&&body.model==='lipsync-2','sync_receipt_mismatch');
  requireValue(['PENDING','PROCESSING','COMPLETED','FAILED','REJECTED'].includes(body.status),'sync_status_unknown');
  if(body.status==='COMPLETED')requireValue(typeof body.outputUrl==='string'&&body.outputUrl.length<8192,'sync_output_missing');
  return {id:body.id,model:body.model,status:body.status,...(body.status==='COMPLETED'?{outputUrl:body.outputUrl}:{})};
}

export function createVoiceSyncProviders({elevenLabsKey='',syncKey='',fetchImpl=globalThis.fetch,timeoutMs=120000}={}) {
  requireValue(typeof fetchImpl==='function'&&Number.isSafeInteger(timeoutMs)&&timeoutMs>=100&&timeoutMs<=180000,'provider_configuration_invalid');
  async function json(url,options,limit,signal) {
    const timeout=AbortSignal.timeout(timeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout;
    try {
      const res=await fetchImpl(url,{...options,redirect:'error',signal:combined});
      requireValue(res.ok&&!res.redirected,'provider_response_rejected');
      requireValue(/^application\/json(?:\s*;|$)/i.test(res.headers.get('content-type')||''),'provider_response_invalid');
      const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await boundedBytes(res,limit)));
      const requestId=res.headers.get('request-id')||res.headers.get('x-request-id');
      return {data,requestId:safeId(requestId)?requestId:null};
    } catch(error) {
      if(error?.code?.startsWith('provider_'))throw error;
      throw problem('provider_result_unknown'); // Never leak headers, scripts or provider error bodies.
    }
  }
  function preflight({voice,sync=false}) {
    speechBody({...voice,text:'preflight'});
    requireValue(secret(elevenLabsKey),'elevenlabs_key_missing');
    if(sync)requireValue(secret(syncKey),'sync_key_missing');
    return true;
  }
  async function speech(input,signal) {
    requireValue(secret(elevenLabsKey),'elevenlabs_key_missing');
    const body=speechBody(input);
    const result=await json(`https://api.elevenlabs.io/v1/text-to-speech/${input.voiceId}/with-timestamps?output_format=mp3_44100_128`,
      {method:'POST',headers:{'xi-api-key':elevenLabsKey,'content-type':'application/json',accept:'application/json'},body:JSON.stringify(body)},8*1024*1024,signal);
    const b64=result.data?.audio_base64;
    requireValue(typeof b64==='string'&&b64.length>4&&b64.length<=7000000&&b64.length%4===0&&/^[A-Za-z0-9+/]+={0,2}$/.test(b64),'voice_audio_invalid');
    const audio=Buffer.from(b64,'base64');requireValue(audio.toString('base64')===b64,'voice_audio_invalid');
    const alignment=validateAlignment(result.data.normalized_alignment||result.data.alignment);
    return {audio,alignment,requestId:result.requestId};
  }
  async function startSync({video,audio},signal) {
    requireValue(secret(syncKey),'sync_key_missing');
    for(const bytes of [video,audio])requireValue(Buffer.isBuffer(bytes)&&bytes.length>64&&bytes.length<20_000_000,'sync_upload_limit');
    const form=new FormData();form.set('model','lipsync-2');
    form.set('options',JSON.stringify({sync_mode:'cut_off'})); // Executor supplies equal measured durations, never long speech.
    form.set('video',new Blob([video],{type:'video/mp4'}),'scene.mp4');
    form.set('audio',new Blob([audio],{type:'audio/wav'}),'speech.wav');
    const {data}=await json('https://api.sync.so/v2/generate',{method:'POST',headers:{'x-api-key':syncKey,accept:'application/json'},body:form},262144,signal);
    return syncReceipt(data);
  }
  async function pollSync(id,signal) {
    requireValue(secret(syncKey)&&safeId(id),'sync_configuration_invalid');
    const {data}=await json(`https://api.sync.so/v2/generate/${id}`,{method:'GET',headers:{'x-api-key':syncKey,accept:'application/json'}},262144,signal);
    return syncReceipt(data,id);
  }
  return Object.freeze({preflight,speech,startSync,pollSync});
}

/** Provider output only. Exact administrator-approved hosts, public IPv4 pinned to
 * the TLS request, no redirects, no credentials. Never use fetch on arbitrary URLs.
 */
export function createSyncDownloader({allowedHosts=[],lookupImpl=lookup,requestImpl=https.request,limit=20_000_000,timeoutMs=60000}={}) {
  requireValue(Array.isArray(allowedHosts)&&allowedHosts.every(x=>typeof x==='string'&&/^[a-z0-9.-]+$/.test(x)&&!x.startsWith('.')),'download_hosts_invalid');
  const hosts=new Set(allowedHosts);
  return async function download(value,signal) {
    let url;try{url=new URL(value);}catch{throw problem('download_url_invalid');}
    requireValue(typeof value==='string'&&!/[\\\s\x00-\x1f]/.test(value)&&value.length<=8192&&url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.hash&&hosts.has(url.hostname),'download_url_denied');
    const addresses=await lookupImpl(url.hostname,{family:4,all:true});
    requireValue(addresses.length>0&&addresses.every(x=>publicIPv4(x.address)),'download_address_denied');
    signal?.throwIfAborted();
    return new Promise((resolve,reject)=>{
      let request,timer,settled=false;
      const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error){request?.destroy();reject(problem(error));}else resolve(value);};
      const abort=()=>finish('download_interrupted');
      timer=setTimeout(()=>finish('download_timeout'),timeoutMs);signal?.addEventListener('abort',abort,{once:true});
      const pinned=(_host,options,cb)=>options?.all?cb(null,[{address:addresses[0].address,family:4}]):cb(null,addresses[0].address,4);
      try{request=requestImpl(url,{method:'GET',lookup:pinned,agent:false,headers:{accept:'video/mp4'}},response=>{
        if(response.statusCode!==200||! /^(?:video\/mp4|application\/octet-stream)(?:\s*;|$)/i.test(response.headers['content-type']||'')){response.destroy();return finish('download_response_denied');}
        const chunks=[];let bytes=0;
        response.on('data',chunk=>{bytes+=chunk.length;if(bytes>limit){response.destroy();finish('download_too_large');}else chunks.push(chunk);});
        response.on('end',()=>{if(bytes<64)return finish('download_empty');finish(null,Buffer.concat(chunks,bytes));});
        response.on('error',()=>finish('download_interrupted'));
      });request.on('error',()=>finish('download_interrupted'));request.end();}catch{finish('download_interrupted');}
    });
  };
}
