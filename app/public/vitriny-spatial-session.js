export const SPATIAL_RETURN_KEY='vitrinySpatialReturn';
export const SPATIAL_WORLD_KEY='br:go:vitrine-city';
export const SPATIAL_EXPLORER_PATH='/vitriny-multiverse-explore.html';

const MAX_COORD=100000;
const DENIED_PATH_PARTS=['/admin','/pagamento','/checkout','/carteira','/api/','//'];

function number(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function clean(value,max=160){return String(value??'').replace(/\s+/g,' ').trim().slice(0,max);}
function bounded(value,limit=MAX_COORD){const n=number(value,0);return Math.max(-limit,Math.min(limit,n));}

export function isSafeSpatialPath(path){
  const value=clean(path,400);
  if(!value.startsWith('/v/br/go/vitrine-city'))return false;
  const lower=value.toLowerCase();
  return !DENIED_PATH_PARTS.some(part=>lower.includes(part));
}

export function isSafeInternalHref(href){
  const value=clean(href,500);
  if(!value.startsWith('/')||value.startsWith('//'))return false;
  const lower=value.toLowerCase();
  return !DENIED_PATH_PARTS.some(part=>lower.includes(part));
}

export function createSpatialReturnState(input={}){
  const createdAt=input.createdAt?new Date(input.createdAt):new Date();
  const spatialPath=isSafeSpatialPath(input.spatialPath)?clean(input.spatialPath,400):'/v/br/go/vitrine-city';
  const position=input.position||{};
  return Object.freeze({
    version:1,
    worldKey:SPATIAL_WORLD_KEY,
    spatialPath,
    districtId:clean(input.districtId,80),
    targetType:clean(input.targetType,40),
    targetId:clean(input.targetId,160),
    position:{x:bounded(position.x),y:bounded(position.y,10000),z:bounded(position.z)},
    yaw:bounded(input.yaw,Math.PI*100),
    pitch:Math.max(-1.4,Math.min(1.4,number(input.pitch,0))),
    createdAt:Number.isFinite(createdAt.getTime())?createdAt.toISOString():new Date().toISOString()
  });
}

export function encodeSpatialReturnState(input){return JSON.stringify(createSpatialReturnState(input));}

export function parseSpatialReturnState(raw,{now=Date.now(),maxAgeMs=2*60*60*1000}={}){
  let value;
  try{value=typeof raw==='string'?JSON.parse(raw):raw;}catch{return null;}
  if(!value||Number(value.version)!==1||value.worldKey!==SPATIAL_WORLD_KEY||!isSafeSpatialPath(value.spatialPath))return null;
  const created=Date.parse(value.createdAt||'');
  const current=number(now,Date.now()),maxAge=Math.max(60000,number(maxAgeMs,2*60*60*1000));
  if(!Number.isFinite(created)||created>current+5*60*1000||current-created>maxAge)return null;
  const position=value.position||{};
  if(![position.x,position.y,position.z,value.yaw,value.pitch].every(v=>Number.isFinite(Number(v))))return null;
  return createSpatialReturnState(value);
}

export function explorerReturnHref(){return `${SPATIAL_EXPLORER_PATH}?return=1`;}

export function storeInteriorHref(reference,name=''){
  const ref=clean(reference,120);
  if(!ref)return'';
  const params=new URLSearchParams({store:ref});
  const label=clean(name,120);if(label)params.set('name',label);
  return `/vitriny-store-interior.html?${params.toString()}`;
}

if(typeof window!=='undefined'&&typeof document!=='undefined'){
  queueMicrotask(()=>import('./vitriny-spatial-realtime-client.js').then(module=>module.autoStartSpatialRealtime()).catch(()=>{}));
}
