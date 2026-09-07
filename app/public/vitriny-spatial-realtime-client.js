import {inferSpatialPresenceDistrict,startSpatialPresence} from '/vitriny-spatial-presence-client.js';

const TARGETS=new Set(['none','store','product','profile','course','service','campaign','content','restaurant','district','portal','business']);
function profile(){
  const memory=Number(navigator.deviceMemory||0),cores=Number(navigator.hardwareConcurrency||2),mobile=matchMedia('(max-width:760px)').matches;
  const score=(memory>=8?3:memory>=4?2:memory>=2?1:0)+(cores>=8?3:cores>=4?2:1)+(mobile?-1:1);
  return score>=6?'ULTRA':score>=3?'STANDARD':'LITE';
}
function fpsBucket(fps){return fps>=50?'excellent':fps>=35?'good':fps>=20?'constrained':'poor';}
function targetFromHref(href=''){
  const value=String(href||'').toLowerCase();
  if(value.startsWith('/produto/'))return'product';if(value.startsWith('/loja/'))return'store';if(value.startsWith('/perfil/'))return'profile';
  if(value.includes('curso')||value.includes('educacional'))return'course';if(value.includes('servico'))return'service';if(value.includes('afiliad'))return'campaign';
  return'none';
}

export function startSpatialTelemetryClient({district=inferSpatialPresenceDistrict(),fetchImpl=globalThis.fetch,documentRef=globalThis.document,navigatorRef=globalThis.navigator}={}){
  if(!district||typeof fetchImpl!=='function'||!documentRef)return null;
  const renderProfile=profile();let stopped=false,frames=0,lastSample=performance.now(),raf=0;
  const send=(event,{fpsBucket:fps='unknown',targetType='none',beacon=false}={})=>{
    if(stopped&&!beacon)return;const type=TARGETS.has(targetType)?targetType:'none',payload={event,district,profile:renderProfile,fpsBucket:fps,targetType:type};
    if(beacon){try{navigatorRef?.sendBeacon?.('/api/spatial/telemetry/event',new Blob([JSON.stringify(payload)],{type:'application/json'}));}catch{}return;}
    fetchImpl('/api/spatial/telemetry/event',{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',cache:'no-store',keepalive:true,body:JSON.stringify(payload)}).catch(()=>{});
  };
  const onClick=event=>{
    const anchor=event.target?.closest?.('a[href]');if(anchor){const targetType=targetFromHref(anchor.getAttribute('href'));if(targetType!=='none')send('entity_open',{targetType});}
  };
  const onSpatialEvent=event=>{const detail=event?.detail||{},targetType=TARGETS.has(detail.targetType)?detail.targetType:'none';send(detail.event==='portal_enter'?'portal_enter':'entity_open',{targetType});};
  const sample=now=>{
    if(stopped)return;frames++;
    if(now-lastSample>=5000){const fps=Math.round(frames*1000/(now-lastSample));frames=0;lastSample=now;if(documentRef.visibilityState!=='hidden')send('render_sample',{fpsBucket:fpsBucket(fps)});}
    raf=requestAnimationFrame(sample);
  };
  documentRef.addEventListener('click',onClick,{capture:true});globalThis.addEventListener?.('vitriny:spatial-event',onSpatialEvent);
  send('district_enter',{targetType:'district'});raf=requestAnimationFrame(sample);
  const stop=()=>{if(stopped)return;stopped=true;cancelAnimationFrame(raf);documentRef.removeEventListener('click',onClick,{capture:true});globalThis.removeEventListener?.('vitriny:spatial-event',onSpatialEvent);send('district_exit',{targetType:'district',beacon:true});};
  globalThis.addEventListener?.('pagehide',stop,{once:true});
  return Object.freeze({district,profile:renderProfile,send,stop});
}

export function startSpatialRealtime(options={}){
  const district=options.district||inferSpatialPresenceDistrict();if(!district)return null;
  const telemetry=startSpatialTelemetryClient({...options,district});
  const presence=startSpatialPresence({...options,district});
  return Object.freeze({district,presence,telemetry,stop:()=>{presence?.stop?.();telemetry?.stop?.();}});
}

export function autoStartSpatialRealtime(){return startSpatialRealtime();}
