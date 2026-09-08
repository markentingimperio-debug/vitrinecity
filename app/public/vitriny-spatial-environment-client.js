const CITY_RE=/^[a-z0-9][a-z0-9-]{0,79}$/;
const PROFILES=new Set(['LITE','STANDARD','ULTRA']);
const SKYLINE_KINDS=new Set(['neural-tower','glass-spire','terrace','garden-tower','arcade','axis-tower','green-tower']);
const GREEN_KINDS=new Set(['canopy','garden','cerrado-tree','palm']);
const FURNITURE_KINDS=new Set(['bench','kiosk','garden-seat','transit-seat']);

function finite(value,min,max){const n=Number(value);return Number.isFinite(n)&&n>=min&&n<=max?n:null;}
function text(value,max=100){return String(value??'').trim().slice(0,max);}
function position(raw){
  const x=finite(raw?.x,-100000,100000),z=finite(raw?.z,-100000,100000),y=finite(raw?.y??0,-1000,1000);
  return x===null||y===null||z===null?null:Object.freeze({x,y,z});
}
function normalizeSkyline(raw){
  const id=text(raw?.id,160),kind=text(raw?.kind,40),p=position(raw?.position),width=finite(raw?.size?.width,2,200),depth=finite(raw?.size?.depth,2,200),height=finite(raw?.size?.height,3,240);
  if(!id||!SKYLINE_KINDS.has(kind)||!p||width===null||depth===null||height===null)return null;
  return Object.freeze({id,kind,position:p,size:Object.freeze({width,depth,height}),rotationY:finite(raw?.rotationY,-20,20)??0,accentIndex:Math.max(0,Math.min(7,Math.trunc(Number(raw?.accentIndex)||0))),windowDensity:finite(raw?.windowDensity,0,1)??.35});
}
function normalizeGreen(raw){const id=text(raw?.id,160),kind=text(raw?.kind,40),p=position(raw?.position),scale=finite(raw?.scale,.2,6);return id&&GREEN_KINDS.has(kind)&&p&&scale!==null?Object.freeze({id,kind,position:p,scale}):null;}
function normalizeLight(raw){const id=text(raw?.id,160),p=position(raw?.position),height=finite(raw?.height,2,20),intensity=finite(raw?.intensity,0,5);return id&&p&&height!==null&&intensity!==null?Object.freeze({id,position:p,height,intensity}):null;}
function normalizeFurniture(raw){const id=text(raw?.id,160),kind=text(raw?.kind,40),p=position(raw?.position),rotationY=finite(raw?.rotationY,-20,20);return id&&FURNITURE_KINDS.has(kind)&&p&&rotationY!==null?Object.freeze({id,kind,position:p,rotationY}):null;}

export function normalizeSpatialEnvironment(raw,{cityId,profileId='STANDARD'}={}){
  const id=text(cityId||raw?.cityId,80).toLowerCase(),profile=text(profileId||raw?.profileId,20).toUpperCase();
  if(!CITY_RE.test(id)||raw?.cityId!==id||raw?.worldKey!==`br:go:${id}`||!PROFILES.has(profile)||raw?.profileId!==profile)return null;
  const skyline=(Array.isArray(raw?.skyline)?raw.skyline:[]).slice(0,48).map(normalizeSkyline).filter(Boolean);
  const vegetation=(Array.isArray(raw?.vegetation)?raw.vegetation:[]).slice(0,64).map(normalizeGreen).filter(Boolean);
  const lights=(Array.isArray(raw?.lights)?raw.lights:[]).slice(0,56).map(normalizeLight).filter(Boolean);
  const furniture=(Array.isArray(raw?.furniture)?raw.furniture:[]).slice(0,32).map(normalizeFurniture).filter(Boolean);
  return Object.freeze({cityId:id,worldKey:`br:go:${id}`,profileId:profile,themeId:text(raw?.themeId,80),skyline:Object.freeze(skyline),vegetation:Object.freeze(vegetation),lights:Object.freeze(lights),furniture:Object.freeze(furniture),zones:Object.freeze(Array.isArray(raw?.zones)?raw.zones.slice(0,8):[])});
}

export async function fetchSpatialEnvironment({cityId='vitrine-city',profileId='STANDARD',fetchImpl=globalThis.fetch,timeoutMs=2500}={}){
  const id=text(cityId,80).toLowerCase(),profile=text(profileId,20).toUpperCase();
  if(!CITY_RE.test(id)||!PROFILES.has(profile))throw new TypeError('spatial_environment_request_invalid');
  if(typeof fetchImpl!=='function')throw new TypeError('spatial_environment_fetch_required');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(800,Math.min(8000,Number(timeoutMs)||2500)));
  try{
    const response=await fetchImpl(`/api/spatial/v1/cities/${encodeURIComponent(id)}/environment?profile=${profile}`,{headers:{accept:'application/json'},credentials:'same-origin',cache:'force-cache',signal:controller.signal});
    if(!response.ok)throw new Error(`spatial_environment_${response.status}`);
    const data=await response.json();if(Number(data?.apiVersion)!==1)throw new Error('spatial_environment_invalid');
    const environment=normalizeSpatialEnvironment(data.environment,{cityId:id,profileId:profile});if(!environment)throw new Error('spatial_environment_invalid');
    return environment;
  }finally{clearTimeout(timer);}
}
