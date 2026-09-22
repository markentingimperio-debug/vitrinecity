const CONNECTOR='lia-chrome-connector-v1';
const TIMEOUT_MS=45000;

export function safeTarget(value){
  if(!value||typeof value!=='object')throw new Error('invalid_target');
  let url;try{url=new URL(String(value.url||''));}catch{throw new Error('invalid_target');}
  const hostname=url.hostname.toLowerCase().replace(/\.$/,'');
  const ipv4=/^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname),ipv6=hostname.includes(':');
  if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||!hostname||ipv4||ipv6||hostname==='localhost'||/\.(?:local|localhost|internal|test|invalid|onion)$/.test(hostname))throw new Error('invalid_target');
  const youtube=hostname==='youtube.com'||hostname.endsWith('.youtube.com');
  return {url:url.href,playback:value.playback===true&&youtube,site:youtube?'youtube':'web'};
}

function waitForComplete(tabId,timeoutMs=TIMEOUT_MS){
  return new Promise((resolve,reject)=>{
    let done=false;
    const finish=(error,tab)=>{if(done)return;done=true;clearTimeout(timer);chrome.tabs.onUpdated.removeListener(listener);error?reject(error):resolve(tab);};
    const listener=(changedId,changeInfo,tab)=>{if(changedId===tabId&&changeInfo.status==='complete')finish(null,tab);};
    const timer=setTimeout(()=>finish(new Error('navigation_timeout')),timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(tab=>{if(tab.status==='complete')finish(null,tab);}).catch(error=>finish(error));
  });
}

async function openTarget(url){
  const tab=await chrome.tabs.create({url,active:true});
  if(!Number.isInteger(tab.id))throw new Error('tab_not_created');
  return await waitForComplete(tab.id);
}

async function firstYoutubeVideo(tabId){
  const [{result}]=await chrome.scripting.executeScript({target:{tabId},func:async()=>{
    const deadline=Date.now()+20000;
    while(Date.now()<deadline){
      const link=document.querySelector('a#video-title[href*="/watch"], ytd-video-renderer a[href*="/watch"]');
      if(link?.href)return {url:link.href,title:String(link.getAttribute('title')||link.textContent||'').trim().slice(0,240)};
      await new Promise(resolve=>setTimeout(resolve,400));
    }
    return null;
  }});
  if(!result?.url)throw new Error('youtube_result_not_found');
  const target=new URL(result.url);
  if(!(target.hostname==='youtube.com'||target.hostname.endsWith('.youtube.com'))||target.pathname!=='/watch'||!target.searchParams.get('v'))throw new Error('youtube_result_invalid');
  target.searchParams.set('autoplay','1');
  await chrome.tabs.update(tabId,{url:target.href,active:true});
  await waitForComplete(tabId);
  return result.title;
}

async function confirmPlayback(tabId){
  const [{result}]=await chrome.scripting.executeScript({target:{tabId},func:async()=>{
    const deadline=Date.now()+15000;
    let video=null;
    while(Date.now()<deadline){video=document.querySelector('video');if(video)break;await new Promise(resolve=>setTimeout(resolve,350));}
    if(!video)return {playing:false,currentTime:0,title:document.title};
    try{await video.play();}catch{}
    if(video.paused){
      const button=document.querySelector('.ytp-large-play-button, button.ytp-play-button');
      if(button instanceof HTMLElement)button.click();
    }
    const started=Number(video.currentTime||0);
    await new Promise(resolve=>setTimeout(resolve,2200));
    return {playing:!video.paused&&!video.ended&&Number(video.currentTime||0)>started,currentTime:Number(video.currentTime||0),title:document.title};
  }});
  return result||{playing:false,currentTime:0,title:''};
}

export async function executeTarget(value){
  const target=safeTarget(value);
  let tab=await openTarget(target.url),selectedTitle='';
  if(target.playback){
    const current=new URL(tab.url||target.url);
    if(current.pathname==='/results')selectedTitle=await firstYoutubeVideo(tab.id);
    const playback=await confirmPlayback(tab.id);
    tab=await chrome.tabs.get(tab.id);
    if(playback.playing!==true||!Number.isFinite(playback.currentTime)||playback.currentTime<0.2)throw new Error('playback_not_confirmed');
    return {connector:CONNECTOR,finalUrl:tab.url,title:String(selectedTitle||playback.title||tab.title||'YouTube').replace(/\s+-\s+YouTube$/i,'').slice(0,240),playing:true,currentTime:playback.currentTime};
  }
  tab=await chrome.tabs.get(tab.id);
  return {connector:CONNECTOR,finalUrl:tab.url,title:String(tab.title||new URL(tab.url).hostname).slice(0,240),opened:true};
}

if(globalThis.chrome?.runtime?.onMessage){
  chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
    if(message?.type!=='execute')return false;
    executeTarget(message.target).then(result=>sendResponse({ok:true,result})).catch(error=>sendResponse({ok:false,error:String(error?.message||'connector_failed').slice(0,120)}));
    return true;
  });
}
