const PRESENCE_KEY='vitrinySpatialPresenceSession';
const ALLOWED=new Set(['central','commerce','social','creator','food','education','entertainment','business','services']);

function safeStorage(){try{return globalThis.sessionStorage||null;}catch{return null;}}
function randomSession(){
  try{if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();}catch{}
  try{const bytes=new Uint8Array(20);globalThis.crypto?.getRandomValues?.(bytes);return [...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');}catch{}
  return `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,18)}`;
}

export function inferSpatialPresenceDistrict(locationLike=globalThis.location){
  const pathname=String(locationLike?.pathname||'').toLowerCase(),search=String(locationLike?.search||'');
  if(pathname.endsWith('/vitriny-multiverse-explore.html'))return'central';
  if(pathname.endsWith('/vitriny-store-interior.html'))return'commerce';
  if(pathname.endsWith('/vitriny-multiverse-food.html'))return'food';
  if(pathname.endsWith('/vitriny-multiverse-creator.html'))return'creator';
  if(pathname.endsWith('/vitriny-multiverse-business.html'))return'business';
  if(pathname.endsWith('/vitriny-multiverse-entertainment.html'))return'entertainment';
  if(pathname.endsWith('/vitriny-multiverse-district.html')){
    const district=new URLSearchParams(search).get('district')?.toLowerCase()||'';
    return ALLOWED.has(district)?district:null;
  }
  return null;
}

export function spatialPresenceSessionId(storage=safeStorage()){
  let current='';try{current=String(storage?.getItem(PRESENCE_KEY)||'');}catch{}
  if(/^[A-Za-z0-9_-]{16,96}$/.test(current))return current;
  const created=randomSession().replace(/[^A-Za-z0-9_-]/g,'').slice(0,96);
  try{storage?.setItem(PRESENCE_KEY,created);}catch{}
  return created;
}

function ensureBadge(documentRef){
  if(!documentRef?.body)return null;
  let badge=documentRef.getElementById('vitrinySpatialPresenceBadge');
  if(badge)return badge;
  badge=documentRef.createElement('div');badge.id='vitrinySpatialPresenceBadge';badge.setAttribute('aria-live','polite');badge.textContent='Presença espacial conectando…';
  Object.assign(badge.style,{position:'fixed',left:'max(12px, env(safe-area-inset-left))',bottom:'max(12px, env(safe-area-inset-bottom))',zIndex:'80',padding:'8px 11px',borderRadius:'999px',background:'rgba(5,13,24,.82)',border:'1px solid rgba(110,231,255,.28)',color:'#dffaff',font:'800 11px/1.2 Inter,system-ui,sans-serif',backdropFilter:'blur(12px)',boxShadow:'0 8px 28px rgba(0,0,0,.34)',pointerEvents:'none'});
  documentRef.body.appendChild(badge);return badge;
}

export function startSpatialPresence({district=inferSpatialPresenceDistrict(),fetchImpl=globalThis.fetch,documentRef=globalThis.document,navigatorRef=globalThis.navigator,heartbeatMs=20_000}={}){
  if(!ALLOWED.has(district)||typeof fetchImpl!=='function'||!documentRef)return null;
  const sessionId=spatialPresenceSessionId(),badge=ensureBadge(documentRef),interval=Math.max(10_000,Math.min(40_000,Number(heartbeatMs)||20_000));
  let stopped=false,timer=null,inFlight=false;
  const render=data=>{if(!badge||!data)return;const local=Number(data.count||data.districts?.[district]||0),total=Number(data.total||0);badge.textContent=`${local} ativos aqui · ${total} no multiverso`;};
  const beat=async()=>{
    if(stopped||inFlight||documentRef.visibilityState==='hidden')return;
    inFlight=true;
    try{
      const response=await fetchImpl('/api/spatial/presence/heartbeat',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},credentials:'same-origin',cache:'no-store',body:JSON.stringify({district,sessionId}),signal:AbortSignal.timeout(4_000)});
      if(response.ok)render(await response.json());else if(badge)badge.textContent='Presença espacial temporariamente indisponível';
    }catch{if(badge)badge.textContent='Presença espacial reconectando…';}
    finally{inFlight=false;}
  };
  const leave=()=>{
    if(stopped)return;stopped=true;if(timer)clearInterval(timer);
    try{const body=new Blob([JSON.stringify({sessionId})],{type:'application/json'});navigatorRef?.sendBeacon?.('/api/spatial/presence/leave',body);}catch{}
  };
  const onVisibility=()=>{if(documentRef.visibilityState==='visible')beat();};
  documentRef.addEventListener('visibilitychange',onVisibility);globalThis.addEventListener?.('pagehide',leave,{once:true});
  beat();timer=setInterval(beat,interval);
  return Object.freeze({district,sessionId,beat,stop:()=>{documentRef.removeEventListener('visibilitychange',onVisibility);leave();}});
}

export function autoStartSpatialPresence(){return startSpatialPresence();}
