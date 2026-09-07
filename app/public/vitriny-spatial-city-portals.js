import {parseSpatialReturnState,SPATIAL_RETURN_KEY} from './vitriny-spatial-session.js';
import {planSpatialCityGates} from './vitriny-spatial-city-gates.js';
import {resolveCityReturnState} from './vitriny-spatial-city-navigation.js';

// Four explicit destinations for the preview. API strings never become navigation URLs.
const CITY_NAMES=Object.freeze({
  'vitrine-city':'Vitrine City',silvania:'Silvânia',anapolis:'Anápolis',goiania:'Goiânia'
});
export const TRANSIT_CITY_IDS=Object.freeze(Object.keys(CITY_NAMES));
const CHECKPOINT_PREFIX='vitrinySpatialCheckpoint:v1:';
const CITY_SET=new Set(TRANSIT_CITY_IDS);

function cityId(value){return typeof value==='string'&&CITY_SET.has(value)?value:null;}
function storageOrNull(){try{return globalThis.sessionStorage||null;}catch{return null;}}

export function cityTransitHref(destination){
  const id=cityId(destination);
  if(!id)throw new TypeError('spatial_transit_city_invalid');
  return `/vitriny-multiverse-explore.html?city=${id}&return=1`;
}

export function normalizeTransitCity(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const id=cityId(raw.id);
  if(!id||raw.worldKey!==`br:go:${id}`||raw.country!=='br'||raw.region!=='go')return null;
  if(!['active','preview'].includes(raw.status))return null;
  return Object.freeze({
    id,worldKey:`br:go:${id}`,name:CITY_NAMES[id],status:raw.status,
    route:`/v/br/go/${id}`,href:cityTransitHref(id)
  });
}

export function layoutCityPortals(cities,{currentCityId='vitrine-city'}={}){
  if(!cityId(currentCityId))throw new TypeError('spatial_transit_city_invalid');
  const byId=new Map();
  for(const raw of (Array.isArray(cities)?cities:[]).slice(0,32)){
    const city=normalizeTransitCity(raw);
    if(city&&city.id!==currentCityId&&!byId.has(city.id))byId.set(city.id,city);
  }
  const destinations=TRANSIT_CITY_IDS.filter(id=>byId.has(id));
  // Reuse the existing gate planner; reflow validated destinations into an accessible station.
  const gates=planSpatialCityGates({currentCityId,cities:destinations.map(id=>byId.get(id)),limit:4});
  return gates.map(({id},index)=>Object.freeze({
    ...byId.get(id),portalId:`city-${id}`,
    position:Object.freeze({x:(index-(destinations.length-1)/2)*26,y:0,z:96}),
    description:byId.get(id).status==='preview'
      ?`${CITY_NAMES[id]} · prévia procedural, sem comércio local ativo.`
      :`${CITY_NAMES[id]} · hub do ecossistema Vitriny.`
  }));
}

export async function fetchCityPortals({currentCityId='vitrine-city',fetchImpl=globalThis.fetch,timeoutMs=2000}={}){
  if(!cityId(currentCityId))throw new TypeError('spatial_transit_city_invalid');
  const controller=new AbortController();
  const delay=Number.isFinite(timeoutMs)?Math.max(100,Math.min(6000,timeoutMs)):2000;
  const timer=setTimeout(()=>controller.abort(),delay);
  try{
    if(typeof fetchImpl!=='function')throw new TypeError('spatial_transit_fetch_required');
    const response=await fetchImpl('/api/spatial/v1/cities',{
      headers:{accept:'application/json'},credentials:'same-origin',cache:'no-store',signal:controller.signal
    });
    if(!response.ok)throw new Error('spatial_transit_unavailable');
    const data=await response.json();
    if(data?.apiVersion!==1||!Array.isArray(data.items))throw new Error('spatial_transit_invalid');
    const portals=layoutCityPortals(data.items,{currentCityId});
    if(!portals.length)throw new Error('spatial_transit_empty');
    return {source:'api',portals};
  }catch{
    // Offline navigation stays explicitly preview-only. It never enables local commerce.
    const cities=TRANSIT_CITY_IDS.map(id=>({id,worldKey:`br:go:${id}`,country:'br',region:'go',status:'preview'}));
    return {source:'fallback',portals:layoutCityPortals(cities,{currentCityId})};
  }finally{clearTimeout(timer);}
}

export function saveCityCheckpoint(input,{storage=storageOrNull(),now=Date.now()}={}){
  const state=parseSpatialReturnState(input,{now});
  const id=state?.worldKey?.split(':')[2];
  if(!cityId(id)||!storage)return false;
  // Only camera state, not a navigation history, entity ID, URL query, or account data.
  const checkpoint={
    version:1,worldKey:state.worldKey,spatialPath:`/v/br/go/${id}`,
    position:state.position,yaw:state.yaw,pitch:state.pitch,createdAt:state.createdAt
  };
  try{storage.setItem(CHECKPOINT_PREFIX+id,JSON.stringify(checkpoint));return true;}catch{return false;}
}

export function loadCityCheckpoint(destination,{storage=storageOrNull(),now=Date.now()}={}){
  const id=cityId(destination);
  if(!id||!storage)return null;
  let checkpoint=null,legacy=null;
  try{
    const raw=storage.getItem(CHECKPOINT_PREFIX+id);
    const state=parseSpatialReturnState(raw,{now});
    if(state?.worldKey===`br:go:${id}`)checkpoint=state;
    else if(raw)storage.removeItem?.(CHECKPOINT_PREFIX+id);
  }catch{ /* A broken checkpoint must not hide a valid store return. */ }
  try{legacy=storage.getItem(SPATIAL_RETURN_KEY);}catch{}
  return resolveCityReturnState(`br:go:${id}`,{checkpoint,legacy,now});
}

export function spatialMovementBasis(yaw=Math.PI){
  const angle=Number.isFinite(yaw)?yaw:Math.PI;
  return {forward:{x:-Math.sin(angle),z:Math.cos(angle)},right:{x:-Math.cos(angle),z:-Math.sin(angle)}};
}

// Prevent procedural scenery from blocking the central plaza and the transit forecourt.
export function intersectsTransitPlaza(building){
  const x=building?.position?.x,z=building?.position?.z,w=building?.size?.width,d=building?.size?.depth;
  if(![x,z,w,d].every(Number.isFinite)||w<=0||d<=0)return true;
  const nearX=Math.max(0,Math.abs(x)-w/2),nearZ=Math.max(0,Math.abs(z)-d/2);
  return Math.hypot(nearX,nearZ)<80||(x+w/2>-52&&x-w/2<52&&z+d/2>80&&z-d/2<120);
}
