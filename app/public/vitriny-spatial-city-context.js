import {spatialFallbackCities,spatialFallbackCity} from './vitriny-spatial-api-client.js';

const KNOWN_CITY_IDS=new Set(spatialFallbackCities().map(city=>city.id));
const CITY_RE=/^[a-z0-9][a-z0-9-]{0,79}$/;
const BLOCKED_PREFIXES=Object.freeze(['/admin','/api','/checkout','/pagamento','/wallet','/carteira']);
const DESTINATIONS=Object.freeze([
  Object.freeze({id:'social',label:'Vitriny Social',href:'/social.html',activeOnly:false}),
  Object.freeze({id:'marketplace',label:'Marketplace & Lojas',href:'/loja.html',activeOnly:true}),
  Object.freeze({id:'map',label:'Mapa real',href:'/mapa-real.html',activeOnly:false}),
  Object.freeze({id:'deliveries',label:'Vitrine Entregas',href:'/entregas.html',activeOnly:true})
]);

function strictCityId(value){
  const id=String(value??'').trim().toLowerCase();
  return CITY_RE.test(id)&&KNOWN_CITY_IDS.has(id)?id:null;
}
function safeInternalPath(value){
  const raw=String(value||'').trim();
  if(!raw.startsWith('/')||raw.startsWith('//')||/[\\\u0000-\u001f]/.test(raw))return null;
  try{
    const url=new URL(raw,'https://vitrinecity.local');
    if(url.origin!=='https://vitrinecity.local')return null;
    const lower=url.pathname.toLowerCase();
    if(BLOCKED_PREFIXES.some(prefix=>lower===prefix||lower.startsWith(`${prefix}/`)||lower.startsWith(`${prefix}.`)))return null;
    return `${url.pathname}${url.search}${url.hash}`;
  }catch{return null;}
}
function timeoutSignal(timeoutMs){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(500,Math.min(10000,Number(timeoutMs)||1800)));
  return{signal:controller.signal,clear:()=>clearTimeout(timer)};
}

export function isKnownSpatialContextCity(value){return Boolean(strictCityId(value));}

export function spatialContextCityFromLocation(locationLike=globalThis.location){
  try{
    const params=new URLSearchParams(String(locationLike?.search||''));
    return strictCityId(params.get('cidade')||params.get('city')||'vitrine-city')||'vitrine-city';
  }catch{return'vitrine-city';}
}

export function withSpatialCityContext(href,cityId='vitrine-city'){
  const id=strictCityId(cityId);if(!id)return null;
  const safe=safeInternalPath(href);if(!safe)return null;
  const url=new URL(safe,'https://vitrinecity.local');
  url.searchParams.set('cidade',id);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function spatialEcosystemDestination(destinationId,{cityId='vitrine-city',cityStatus=''}={}){
  const definition=DESTINATIONS.find(item=>item.id===String(destinationId||'').trim().toLowerCase());if(!definition)return null;
  const id=strictCityId(cityId);if(!id)return null;
  const fallbackCity=spatialFallbackCity(id);
  const canonicalActive=fallbackCity.id===id&&fallbackCity.status==='active';
  const serverActive=String(cityStatus||fallbackCity.status).trim().toLowerCase()==='active';
  const enabled=!definition.activeOnly||(canonicalActive&&serverActive);
  return Object.freeze({
    id:definition.id,label:definition.label,cityId:id,contextMode:'navigation-only',activeOnly:definition.activeOnly,
    enabled,href:withSpatialCityContext(definition.href,id),
    reason:enabled?'':`Disponível quando ${fallbackCity.name} estiver ativa para operação local.`
  });
}

export function spatialEcosystemDestinations(options={}){
  return Object.freeze(DESTINATIONS.map(item=>spatialEcosystemDestination(item.id,options)).filter(Boolean));
}

export function normalizeSpatialNavigationContext(data,{cityId='vitrine-city'}={}){
  const id=strictCityId(cityId);
  if(!id||Number(data?.apiVersion)!==1||data?.contextMode!=='navigation-only'||strictCityId(data?.city?.id)!==id)throw new Error('spatial_context_invalid');
  const fallbackCity=spatialFallbackCity(id),serverStatus=String(data.city.status||'preview').trim().toLowerCase()==='active'?'active':'preview';
  const city=Object.freeze({...fallbackCity,name:String(data.city.name||fallbackCity.name).trim().slice(0,100)||fallbackCity.name,status:serverStatus});
  const modules=spatialEcosystemDestinations({cityId:id,cityStatus:serverStatus});
  return Object.freeze({apiVersion:1,contextMode:'navigation-only',city,modules,source:'spatial-api-v1'});
}

export async function fetchSpatialNavigationContext({cityId='vitrine-city',fetchImpl=globalThis.fetch,timeoutMs=1800}={}){
  if(typeof fetchImpl!=='function')throw new TypeError('spatial_context_fetch_required');
  const id=strictCityId(cityId);if(!id)throw new Error('spatial_context_city_invalid');
  const timer=timeoutSignal(timeoutMs);
  try{
    const response=await fetchImpl(`/api/spatial/v1/context?city=${encodeURIComponent(id)}`,{headers:{accept:'application/json'},cache:'no-store',signal:timer.signal});
    if(!response.ok)throw new Error(`spatial_context_${response.status}`);
    return normalizeSpatialNavigationContext(await response.json(),{cityId:id});
  }finally{timer.clear();}
}

export const spatialContextBlockedPrefixes=BLOCKED_PREFIXES;
