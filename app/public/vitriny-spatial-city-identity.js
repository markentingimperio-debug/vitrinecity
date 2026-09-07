const CITY_IDS=new Set(['vitrine-city','silvania','anapolis','goiania']);
const HEX=/^#[0-9a-f]{6}$/i;
const FALLBACK=Object.freeze({
  'vitrine-city':Object.freeze({themeId:'neural-nexus',tagline:'Núcleo inteligente do ecossistema Vitriny',palette:{background:'#02050c',fog:'#07101c',ground:'#09131c',road:'#101a24',accent:'#6ee7ff',secondary:'#8f8cff'},landmark:{id:'neural-spire',label:'Vitriny Neural Spire',kind:'spire'}}),
  silvania:Object.freeze({themeId:'cerrado-gardens',tagline:'Cidade-jardim digital inspirada no Cerrado',palette:{background:'#03100c',fog:'#082219',ground:'#0d2119',road:'#15251f',accent:'#85e6a8',secondary:'#ffc56b'},landmark:{id:'cerrado-crown',label:'Coroa do Cerrado',kind:'crown'}}),
  anapolis:Object.freeze({themeId:'connected-axis',tagline:'Eixo de conexões, negócios e mobilidade digital',palette:{background:'#06101b',fog:'#0a1d30',ground:'#0d1b2a',road:'#162334',accent:'#6f9cff',secondary:'#ffb36b'},landmark:{id:'connection-arch',label:'Arco Conector',kind:'arch'}}),
  goiania:Object.freeze({themeId:'green-metropolis',tagline:'Metrópole verde, criativa e conectada',palette:{background:'#050711',fog:'#101328',ground:'#121827',road:'#1a2030',accent:'#b58cff',secondary:'#85e6a8'},landmark:{id:'metropolis-orbit',label:'Órbita Metropolitana',kind:'orbital'}})
});

function cityId(value){const id=String(value||'').trim().toLowerCase();return CITY_IDS.has(id)?id:'vitrine-city';}
function clean(value,max=120){return String(value||'').replace(/\s+/g,' ').trim().slice(0,max);}
export function spatialIdentityCityFromLocation(locationLike=globalThis.location){try{return cityId(new URLSearchParams(String(locationLike?.search||'')).get('city'));}catch{return'vitrine-city';}}
export function fallbackSpatialCityIdentity(id='vitrine-city'){return FALLBACK[cityId(id)];}
export function normalizeSpatialCityIdentity(raw,id='vitrine-city'){
  const fallback=fallbackSpatialCityIdentity(id),palette=raw?.palette||{},landmark=raw?.landmark||{};
  const color=key=>HEX.test(String(palette[key]||''))?String(palette[key]).toLowerCase():fallback.palette[key];
  const kind=['spire','crown','arch','orbital'].includes(landmark.kind)?landmark.kind:fallback.landmark.kind;
  return Object.freeze({
    themeId:clean(raw?.themeId,60)||fallback.themeId,tagline:clean(raw?.tagline,140)||fallback.tagline,
    palette:Object.freeze({background:color('background'),fog:color('fog'),ground:color('ground'),road:color('road'),accent:color('accent'),secondary:color('secondary')}),
    landmark:Object.freeze({id:clean(landmark.id,80)||fallback.landmark.id,label:clean(landmark.label,100)||fallback.landmark.label,kind})
  });
}
export async function fetchSpatialCityIdentity({cityId:id=spatialIdentityCityFromLocation(),fetchImpl=globalThis.fetch,timeoutMs=2200}={}){
  const safeId=cityId(id),fallback=fallbackSpatialCityIdentity(safeId);if(typeof fetchImpl!=='function')return normalizeSpatialCityIdentity(fallback,safeId);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(500,Math.min(6000,Number(timeoutMs)||2200)));
  try{
    const response=await fetchImpl(`/api/spatial/v1/cities/${encodeURIComponent(safeId)}`,{headers:{accept:'application/json'},cache:'no-store',credentials:'same-origin',signal:controller.signal});
    if(!response.ok)throw new Error('identity_unavailable');
    const data=await response.json();return normalizeSpatialCityIdentity(data?.city?.identity||fallback,safeId);
  }catch{return normalizeSpatialCityIdentity(fallback,safeId);}finally{clearTimeout(timer);}
}
export function applySpatialCityIdentity(identity,{documentRef=globalThis.document}={}){
  if(!documentRef?.documentElement)return false;const normalized=normalizeSpatialCityIdentity(identity);
  const root=documentRef.documentElement,p=normalized.palette;
  root.style.setProperty('--spatial-bg',p.background);root.style.setProperty('--spatial-fog',p.fog);root.style.setProperty('--spatial-ground',p.ground);root.style.setProperty('--spatial-road',p.road);root.style.setProperty('--spatial-accent',p.accent);root.style.setProperty('--spatial-secondary',p.secondary);
  root.dataset.spatialTheme=normalized.themeId;
  const brand=documentRef.querySelector('.brand');
  if(brand){let line=documentRef.getElementById('cityIdentityLine');if(!line){line=documentRef.createElement('span');line.id='cityIdentityLine';line.setAttribute('aria-label','Identidade espacial da cidade');brand.appendChild(line);}line.textContent=`${normalized.tagline} · ${normalized.landmark.label}`;}
  return true;
}
export async function autoApplySpatialCityIdentity(options={}){const identity=await fetchSpatialCityIdentity(options);applySpatialCityIdentity(identity,options);return identity;}
