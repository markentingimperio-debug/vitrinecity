import {normalizeSpatialCityId,spatialExplorerHref} from './vitriny-spatial-api-client.js';

function finite(value,fallback){const n=Number(value);return Number.isFinite(n)?n:fallback;}

export function planSpatialCityGates({currentCityId='vitrine-city',cities=[],radius=98,limit=8}={}){
  const current=normalizeSpatialCityId(currentCityId),safeRadius=Math.max(82,Math.min(180,finite(radius,98))),safeLimit=Math.max(1,Math.min(12,Math.trunc(finite(limit,8))));
  const unique=new Map();
  for(const raw of Array.isArray(cities)?cities:[]){
    const id=normalizeSpatialCityId(raw?.id,'');
    if(!id||id===current||unique.has(id)||String(raw?.worldKey||'')!==`br:go:${id}`)continue;
    unique.set(id,{id,worldKey:`br:go:${id}`,name:String(raw?.name||id).trim().slice(0,100)||id,status:String(raw?.status||'preview').toLowerCase()==='active'?'active':'preview',route:String(raw?.route||`/v/br/go/${id}`).slice(0,240)});
    if(unique.size>=safeLimit)break;
  }
  const items=[...unique.values()],count=items.length;
  return Object.freeze(items.map((city,index)=>{
    const angle=-Math.PI/2+(count>1?(Math.PI*2*index/count):0),x=Math.cos(angle)*safeRadius,z=Math.sin(angle)*safeRadius;
    return Object.freeze({...city,href:spatialExplorerHref(city.id),angle,x:Number(x.toFixed(4)),z:Number(z.toFixed(4))});
  }));
}

export function spatialCityGateHint(gate,currentCityName='Vitrine City'){
  if(!gate)return'';
  const status=gate.status==='active'?'cidade ativa':'cidade em preview';
  return `Portal de ${String(currentCityName||'Vitrine City').slice(0,100)} para ${gate.name} · ${status}`;
}
