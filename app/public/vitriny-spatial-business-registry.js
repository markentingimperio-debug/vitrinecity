import {normalizeSpatialStore} from './vitriny-spatial-store-registry.js';

function stableHash(value){let hash=2166136261;for(const char of String(value||'')){hash^=char.codePointAt(0);hash=Math.imul(hash,16777619)>>>0;}return hash>>>0;}

export function mapBusinessesToSpatialEntities(stores,{limit=28,rows=4,spacingX=12,spacingZ=14}={}){
  const normalized=(Array.isArray(stores)?stores:[]).map(normalizeSpatialStore).filter(Boolean)
    .sort((a,b)=>b.rating-a.rating||b.productCount-a.productCount||a.name.localeCompare(b.name))
    .slice(0,Math.max(0,Math.min(56,Number(limit)||28)));
  const rowCount=Math.max(2,Math.min(6,Math.floor(Number(rows)||4))),gapX=Math.max(9,Math.min(24,Number(spacingX)||12)),gapZ=Math.max(10,Math.min(28,Number(spacingZ)||14));
  return normalized.map((business,index)=>{
    const lane=index%rowCount,depth=Math.floor(index/rowCount),center=(rowCount-1)/2,hash=stableHash(business.reference),height=12+Math.min(22,business.productCount*.75)+Math.round(business.rating*1.4)+((hash>>>7)%6);
    return Object.freeze({...business,entityType:'business',district:'business',
      position:{x:Number(((lane-center)*gapX).toFixed(3)),y:0,z:Number((-8-depth*gapZ).toFixed(3))},
      size:{width:7.5+(hash%4),depth:7.5+((hash>>>5)%4),height},accentIndex:hash%8,detail:Math.min(1,.4+business.rating/8)
    });
  });
}

export async function fetchSpatialBusinesses({fetchImpl=globalThis.fetch,url='/api/marketplace/stores',timeoutMs=5000,limit=28}={}){
  if(typeof fetchImpl!=='function')throw new TypeError('Spatial business registry requer fetch.');
  const response=await fetchImpl(url,{headers:{accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(Math.max(1000,Math.min(15000,Number(timeoutMs)||5000)))});
  if(!response.ok)throw new Error(`spatial_business_${response.status}`);
  const data=await response.json();return mapBusinessesToSpatialEntities(data?.stores,{limit});
}
