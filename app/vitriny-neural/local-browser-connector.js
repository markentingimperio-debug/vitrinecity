import {isIP} from 'node:net';
import {isPlaybackRequest,resolveRequestedBrowserUrl} from './browser-target.js';

const invalid=(code,status=400)=>{throw Object.assign(Error(code),{status});};
function validPublicUrl(raw){
  let target;try{target=new URL(String(raw||''));}catch{invalid('lia_local_browser_target_invalid');}
  const hostname=target.hostname.toLowerCase().replace(/\.$/,'');
  if(target.protocol!=='https:'||target.username||target.password||target.port&&target.port!=='443'||!hostname||isIP(hostname)||hostname==='localhost'||/\.(?:local|localhost|internal|test|invalid|onion)$/.test(hostname))invalid('lia_local_browser_target_invalid');
  return {target,hostname};
}

export function createLocalBrowserPlan(instruction){
  const {target,hostname}=validPublicUrl(resolveRequestedBrowserUrl(instruction));
  const youtube=hostname==='youtube.com'||hostname.endsWith('.youtube.com');
  return {url:target.href,playback:youtube&&isPlaybackRequest(instruction),site:youtube?'youtube':'web'};
}

export function validateLocalBrowserResult(plan,value){
  if(!plan||typeof plan!=='object'||!value||typeof value!=='object'||value.connector!=='lia-chrome-connector-v1')invalid('lia_local_browser_result_invalid');
  const {target:finalUrl,hostname}=validPublicUrl(value.finalUrl);
  const title=String(value.title||'').trim().slice(0,240);
  if(!title)invalid('lia_local_browser_result_invalid');
  if(plan.playback){
    const youtube=hostname==='youtube.com'||hostname.endsWith('.youtube.com');
    const currentTime=Number(value.currentTime);
    if(!youtube||finalUrl.pathname!=='/watch'||!finalUrl.searchParams.get('v')||value.playing!==true||!Number.isFinite(currentTime)||currentTime<0.2)invalid('lia_local_browser_playback_unconfirmed');
    return {connector:value.connector,finalUrl:finalUrl.href,title,playing:true,currentTime:Math.round(currentTime*10)/10};
  }
  if(value.opened!==true)invalid('lia_local_browser_open_unconfirmed');
  return {connector:value.connector,finalUrl:finalUrl.href,title,opened:true};
}
