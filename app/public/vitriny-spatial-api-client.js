import {parseSpatialChunkId,generateSpatialChunk} from './vitriny-spatial-client-core.js';

const CITY_RE=/^[a-z0-9][a-z0-9-]{0,79}$/;
const FALLBACK_CITIES=Object.freeze({
  'vitrine-city':Object.freeze({id:'vitrine-city',worldKey:'br:go:vitrine-city',name:'Vitrine City',country:'br',countryName:'Brasil',region:'go',regionName:'Goiás',status:'active',chunkSize:128,route:'/v/br/go/vitrine-city'}),
  'silvania':Object.freeze({id:'silvania',worldKey:'br:go:silvania',name:'Silvânia',country:'br',countryName:'Brasil',region:'go',regionName:'Goiás',status:'preview',chunkSize:128,route:'/v/br/go/silvania'}),
  'anapolis':Object.freeze({id:'anapolis',worldKey:'br:go:anapolis',name:'Anápolis',country:'br',countryName:'Brasil',region:'go',regionName:'Goiás',status:'preview',chunkSize:128,route:'/v/br/go/anapolis'}),
  'goiania':Object.freeze({id:'goiania',worldKey:'br:go:goiania',name:'Goiânia',country:'br',countryName:'Brasil',region:'go',regionName:'Goiás',status:'preview',chunkSize:128,route:'/v/br/go/goiania'})
});

function finite(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function clamp(value,min,max){return Math.max(min,Math.min(max,finite(value,min)));}
function hash32(value){let h=2166136261>>>0;for(const ch of String(value||'')){h^=ch.codePointAt(0);h=Math.imul(h,16777619)>>>0;}return h>>>0;}
function timeoutSignal(timeoutMs){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(800,Math.min(20000,Number(timeoutMs)||6000)));
  return{signal:controller.signal,clear:()=>clearTimeout(timer)};
}

export function normalizeSpatialCityId(value,fallback='vitrine-city'){
  const id=String(value??'').trim().toLowerCase();
  if(CITY_RE.test(id))return id;
  const safeFallback=String(fallback||'vitrine-city').trim().toLowerCase();
  return CITY_RE.test(safeFallback)?safeFallback:'vitrine-city';
}

export function spatialCityFromLocation(locationLike=globalThis.location){
  try{return normalizeSpatialCityId(new URLSearchParams(String(locationLike?.search||'')).get('city'));}catch{return'vitrine-city';}
}

export function spatialFallbackCity(cityId='vitrine-city'){
  return FALLBACK_CITIES[normalizeSpatialCityId(cityId)]||FALLBACK_CITIES['vitrine-city'];
}

export function spatialExplorerHref(cityId='vitrine-city',{returnState=false}={}){
  const params=new URLSearchParams({city:normalizeSpatialCityId(cityId)});if(returnState)params.set('return','1');
  return `/vitriny-multiverse-explore.html?${params.toString()}`;
}

export async function fetchSpatialCityContext({cityId='vitrine-city',fetchImpl=globalThis.fetch,timeoutMs=6000}={}){
  if(typeof fetchImpl!=='function')throw new TypeError('spatial_api_fetch_required');
  const id=normalizeSpatialCityId(cityId),timer=timeoutSignal(timeoutMs);
  try{
    const response=await fetchImpl(`/api/spatial/v1/cities/${encodeURIComponent(id)}`,{headers:{accept:'application/json'},cache:'no-store',signal:timer.signal});
    if(!response.ok)throw new Error(`spatial_city_${response.status}`);
    const data=await response.json(),city=data?.city;
    if(!city||normalizeSpatialCityId(city.id,'')!==id||String(city.worldKey||'')!==`br:go:${id}`)throw new Error('spatial_city_invalid');
    return Object.freeze({...spatialFallbackCity(id),...city,id,worldKey:`br:go:${id}`,chunkSize:Math.max(16,Math.min(2048,Math.trunc(finite(city.chunkSize,128))))});
  }finally{timer.clear();}
}

export function adaptSpatialApiChunk(data,{cityId,requestedId}={}){
  const id=normalizeSpatialCityId(cityId),city=data?.city,chunk=data?.chunk;
  if(Number(data?.apiVersion)!==1||!city||!chunk||city.id!==id||city.worldKey!==`br:go:${id}`)throw new Error('spatial_chunk_invalid');
  const x=Math.trunc(finite(chunk.x,NaN)),z=Math.trunc(finite(chunk.z,NaN)),size=Math.trunc(finite(chunk.size,NaN));
  if(!Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(size)||size<16||size>2048)throw new Error('spatial_chunk_invalid');
  const canonicalId=`${city.worldKey}@${x},${z}`;
  if(requestedId&&String(requestedId)!==canonicalId)throw new Error('spatial_chunk_mismatch');
  const buildings=(Array.isArray(data.buildings)?data.buildings:[]).slice(0,36).map(raw=>{
    const buildingId=String(raw?.id||'').slice(0,220);if(!buildingId)return null;
    const width=clamp(raw?.size?.width,4,size),depth=clamp(raw?.size?.depth,4,size),height=clamp(raw?.size?.height,3,180);
    return Object.freeze({
      id:buildingId,kind:String(raw?.kind||'retail').slice(0,40),
      position:{x:finite(raw?.position?.x),y:0,z:finite(raw?.position?.z)},size:{width,depth,height},
      accentIndex:hash32(buildingId)%8,detail:clamp(raw?.windowDensity??raw?.emissiveAccent??.35,0,1)
    });
  }).filter(Boolean);
  return Object.freeze({id:canonicalId,worldKey:city.worldKey,x,z,chunkSize:size,buildings,source:'spatial-api-v1'});
}

export function createSpatialApiChunkLoader({cityId='vitrine-city',fetchImpl=globalThis.fetch,timeoutMs=6000,onSource=()=>{},fallback=true}={}){
  const id=normalizeSpatialCityId(cityId);
  return async requestedId=>{
    const parsed=parseSpatialChunkId(requestedId);
    if(parsed.worldKey!==`br:go:${id}`)throw new Error('spatial_chunk_world_mismatch');
    const timer=timeoutSignal(timeoutMs);
    try{
      const response=await fetchImpl(`/api/spatial/v1/cities/${encodeURIComponent(id)}/chunks/${parsed.x}/${parsed.z}`,{headers:{accept:'application/json'},cache:'force-cache',signal:timer.signal});
      if(!response.ok)throw new Error(`spatial_chunk_${response.status}`);
      const adapted=adaptSpatialApiChunk(await response.json(),{cityId:id,requestedId});onSource('api',adapted);return adapted;
    }catch(error){
      if(!fallback)throw error;
      const local=generateSpatialChunk(requestedId,{chunkSize:spatialFallbackCity(id).chunkSize,grid:3,seed:`offline:${id}`});
      const adapted=Object.freeze({...local,source:'local-fallback'});onSource('fallback',adapted,error);return adapted;
    }finally{timer.clear();}
  };
}
