import {normalizeSpatialCityId,spatialFallbackCities,spatialFallbackCity} from './vitriny-spatial-api-client.js';

const KNOWN_CITY_IDS=new Set(spatialFallbackCities().map(city=>city.id));
const BLOCKED_PREFIXES=Object.freeze(['/admin','/api','/checkout','/pagamento','/wallet','/carteira']);
const DESTINATIONS=Object.freeze([
  Object.freeze({id:'social',label:'Vitriny Social',href:'/social.html',activeOnly:false}),
  Object.freeze({id:'marketplace',label:'Marketplace & Lojas',href:'/loja.html',activeOnly:true}),
  Object.freeze({id:'map',label:'Mapa real',href:'/mapa-real.html',activeOnly:false}),
  Object.freeze({id:'deliveries',label:'Vitrine Entregas',href:'/entregas.html',activeOnly:true})
]);

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

export function isKnownSpatialContextCity(value){
  const id=normalizeSpatialCityId(value,'');return Boolean(id&&KNOWN_CITY_IDS.has(id));
}

export function spatialContextCityFromLocation(locationLike=globalThis.location){
  try{
    const params=new URLSearchParams(String(locationLike?.search||''));
    const requested=params.get('cidade')||params.get('city')||'vitrine-city';
    return isKnownSpatialContextCity(requested)?normalizeSpatialCityId(requested):'vitrine-city';
  }catch{return'vitrine-city';}
}

export function withSpatialCityContext(href,cityId='vitrine-city'){
  const id=normalizeSpatialCityId(cityId,'');if(!id||!KNOWN_CITY_IDS.has(id))return null;
  const safe=safeInternalPath(href);if(!safe)return null;
  const url=new URL(safe,'https://vitrinecity.local');
  url.searchParams.set('cidade',id);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function spatialEcosystemDestination(destinationId,{cityId='vitrine-city',cityStatus=''}={}){
  const definition=DESTINATIONS.find(item=>item.id===String(destinationId||'').trim().toLowerCase());if(!definition)return null;
  const id=normalizeSpatialCityId(cityId,'');if(!id||!KNOWN_CITY_IDS.has(id))return null;
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

export const spatialContextBlockedPrefixes=BLOCKED_PREFIXES;
