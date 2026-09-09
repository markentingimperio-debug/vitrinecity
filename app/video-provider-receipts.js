import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {publicImageAddress} from './catalog-product-images.js';

const ORIGIN='https://openrouter.ai';
const fail=code=>Object.assign(new Error(code),{code});
export const videoJobId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(value)?value:'';
export function videoPollingUrl(value,jobId){
  if(!videoJobId(jobId)||typeof value!=='string'||/[\\\s%]/.test(value)||value.includes('/../')||value.includes('/./')||value.startsWith('//')||!value.startsWith('/')&&!value.startsWith('https://'))return '';
  try{const url=new URL(value,ORIGIN);
    return url.origin===ORIGIN&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname===`/api/v1/videos/${jobId}`?url.href:'';
  }catch{return '';}
}
export function videoReceipt(data){
  const jobId=videoJobId(data?.id);
  return {jobId,pollingUrl:videoPollingUrl(data?.polling_url,jobId)};
}
export function videoPollState(data,jobId){
  if(data?.id!==jobId)throw fail('video_job_mismatch');
  const status=String(data.status||'').toLowerCase();
  if(['failed','cancelled','expired'].includes(status))throw fail(`video_job_${status}`);
  if(['completed','succeeded'].includes(status))return 'completed';
  if(['pending','queued','processing','in_progress'].includes(status))return 'processing';
  throw fail('video_status_unknown');
}
export function videoRetryableFailure(error){
  return ['video_download_timeout','video_download_dns_failed','video_download_failed','video_download_incomplete','video_download_http_temporary'].includes(error?.code)||[408,429].includes(Number(error?.status))||Number(error?.status)>=500;
}
export function videoProjectUnchanged(current,expected){
  return !!current&&['format','production_status','remote_job_id','polling_url','output_url','prompt','model','duration_seconds','aspect_ratio'].every(key=>current[key]===expected[key]);
}
// Only fixed diagnostics cross into the admin UI; provider messages may contain
// signed URLs, credentials or private prompt details.
export function videoFailureMessage(error){
  const value=String(error?.message||'');
  if(/inference is blocked/i.test(value))return 'Geração bloqueada na conta do provedor. Não foi agendado novo envio.';
  if(/ZDR|data policy|data policies|guardrail restrictions/i.test(value))return 'Provedor indisponível sob a política de dados atual. Não foi agendado novo envio.';
  if(/insufficient credits|key limit|credit|quota|billing/i.test(value))return 'Provedor recusou por saldo ou limite. Não foi agendado novo envio.';
  if(['video_job_failed','video_job_cancelled','video_job_expired'].includes(error?.code))return 'O provedor encerrou esta tarefa sem vídeo. Recibo preservado; não foi criada outra geração.';
  if(videoRetryableFailure(error))return 'Consulta ou download temporariamente indisponível. Será consultada a mesma tarefa; não será criada outra geração.';
  return 'Resultado da geração precisa de conferência. Recibos disponíveis foram preservados; nenhum novo envio foi agendado.';
}
export function videoDownloadTarget(data,jobId,apiKey=''){
  if(!videoJobId(jobId))throw fail('video_job_invalid');
  const value=data?.unsigned_urls?.[0]||data?.data?.[0]?.url||data?.content_url||`${ORIGIN}/api/v1/videos/${jobId}/content?index=0`;
  if(typeof value!=='string'||/[\\\s]/.test(value)||value.startsWith('//'))throw fail('video_download_url_invalid');
  let url;try{url=new URL(value,ORIGIN);}catch{throw fail('video_download_url_invalid');}
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||isIP(url.hostname)||url.hostname.includes(':')||!url.hostname.includes('.')||/(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(url.hostname))throw fail('video_download_url_invalid');
  const headers={Accept:'video/mp4,application/octet-stream'};
  if(url.origin===ORIGIN){
    if(url.pathname!==`/api/v1/videos/${jobId}/content`||[...url.searchParams.keys()].some(key=>key!=='index')||url.searchParams.getAll('index').length>1||!/^\d{1,3}$/.test(url.searchParams.get('index')||'0'))throw fail('video_download_url_invalid');
    if(!apiKey)throw fail('video_download_auth_missing');
    headers.Authorization=`Bearer ${apiKey}`;
  }
  return {url:url.href,headers};
}

/** The transport connects to the exact public IPv4 address it checked. No
 * redirect following, cookies, proxy, or credentials on third-party hosts. */
export function downloadVideo(data,jobId,{apiKey='',request=https.get,lookupImpl=lookup,maxBytes=250*1024*1024,timeoutMs=120000}={}){
  let target;try{target=videoDownloadTarget(data,jobId,apiKey);}catch(error){return Promise.reject(error);}
  return new Promise((resolve,reject)=>{
    let done=false,timer;const finish=(error,body)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(body);};
    const req=request(target.url,{agent:false,family:4,headers:target.headers,lookup(host,options,callback){
      lookupImpl(host,{family:4,all:true}).then(addresses=>{
        if(!addresses.length||addresses.some(item=>!publicImageAddress(item.address)))return callback(fail('video_download_address_blocked'));
        if(options.all)callback(null,[addresses[0]]);else callback(null,addresses[0].address,4);
      },()=>callback(fail('video_download_dns_failed')));
    }},response=>{
      const type=String(response.headers['content-type']||'').split(';')[0].toLowerCase();
      if([408,429].includes(response.statusCode)||response.statusCode>=500){response.destroy();finish(fail('video_download_http_temporary'));return;}
      if(response.statusCode!==200||!['video/mp4','application/octet-stream'].includes(type)||Number(response.headers['content-length'])>maxBytes){response.destroy();finish(fail('video_download_response_invalid'));return;}
      const chunks=[];let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){response.destroy();finish(fail('video_download_too_large'));return;}chunks.push(chunk);});
      response.on('error',()=>finish(fail('video_download_incomplete')));
      response.on('aborted',()=>finish(fail('video_download_incomplete')));
      response.on('end',()=>{const body=Buffer.concat(chunks);if(body.length<12||body.toString('ascii',4,8)!=='ftyp'){finish(fail('video_download_not_mp4'));return;}finish(null,body);});
    });
    timer=setTimeout(()=>{req.destroy();finish(fail('video_download_timeout'));},timeoutMs);
    req.on('error',error=>finish(fail(['video_download_address_blocked','video_download_dns_failed'].includes(error?.code)?error.code:'video_download_failed')));
  });
}
