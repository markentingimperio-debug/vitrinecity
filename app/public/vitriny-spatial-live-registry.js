function text(value,max=180){return String(value??'').replace(/\s+/g,' ').trim().slice(0,max);}
function positive(value){const n=Number(value);return Number.isFinite(n)&&n>0?n:0;}
function stableHash(value){let hash=2166136261;for(const char of String(value||'')){hash^=char.codePointAt(0);hash=Math.imul(hash,16777619)>>>0;}return hash>>>0;}
function safeInternalHref(value){const href=text(value,500);if(!href.startsWith('/')||href.startsWith('//'))return'';const lower=href.toLowerCase();if(['/admin','/api/','/pagamento','/checkout','/carteira','/wallet'].some(prefix=>lower===prefix||lower.startsWith(prefix)))return'';return href;}

const DISTRICT_ORIGINS=Object.freeze({
  social:{x:82,z:82},education:{x:-116,z:0},services:{x:82,z:-82},creator:{x:0,z:116},business:{x:0,z:-116},food:{x:-82,z:82},entertainment:{x:-82,z:-82}
});

function gridPosition(index,{origin,columns=4,spacing=15}={}){
  const cols=Math.max(2,Math.min(6,Math.floor(Number(columns)||4))),gap=Math.max(9,Math.min(28,Number(spacing)||15)),row=Math.floor(index/cols),column=index%cols,center=(cols-1)/2;
  return {x:Number((origin.x+row*gap).toFixed(3)),y:0,z:Number((origin.z+(column-center)*gap).toFixed(3))};
}

export function normalizeSpatialProfile(raw={}){
  const id=Number(raw.id),handle=text(raw.handle,48).replace(/^@/,'').toLowerCase(),name=text(raw.name,120);
  if(!Number.isInteger(id)||id<1||!handle||!name)return null;
  return Object.freeze({
    id:`profile:${id}`,entityType:'profile',district:'social',profileId:id,handle,name,
    bio:text(raw.bio,240),city:text(raw.city,80),followers:Math.max(0,Math.floor(positive(raw.followers))),
    avatarUrl:text(raw.avatarUrl,500),href:`/perfil/${encodeURIComponent(handle)}`
  });
}

export function mapProfilesToSpatialEntities(profiles,{limit=18,origin=DISTRICT_ORIGINS.social,columns=3,spacing=14}={}){
  return (Array.isArray(profiles)?profiles:[]).map(normalizeSpatialProfile).filter(Boolean)
    .sort((a,b)=>b.followers-a.followers||a.handle.localeCompare(b.handle))
    .slice(0,Math.max(0,Math.min(36,Number(limit)||18))).map((profile,index)=>{
      const hash=stableHash(profile.handle),height=6+Math.min(12,Math.log2(profile.followers+1)*1.8)+((hash>>>8)%4);
      return Object.freeze({...profile,position:gridPosition(index,{origin,columns,spacing}),size:{width:5.5,depth:5.5,height},accentIndex:hash%8,detail:Math.min(1,.35+Math.log10(profile.followers+10)/4)});
    });
}

export function normalizeSpatialPromotion(raw={}){
  const kind=text(raw.kind,32).toLowerCase(),title=text(raw.title,140),url=safeInternalHref(raw.url);
  if(!title||!url||!['course','service'].includes(kind))return null;
  const district=kind==='course'?'education':'services',id=`${kind}:${text(raw.slug||title,120).toLowerCase()}`;
  return Object.freeze({id,entityType:kind,district,title,description:text(raw.description,260),amountCents:Math.max(0,Math.floor(positive(raw.amountCents??raw.amount_cents))),href:url});
}

export function mapPromotionsToSpatialEntities(items,{limitPerDistrict=14}={}){
  const normalized=(Array.isArray(items)?items:[]).map(normalizeSpatialPromotion).filter(Boolean),out=[];
  for(const district of ['education','services']){
    const group=normalized.filter(item=>item.district===district).slice(0,Math.max(0,Math.min(28,Number(limitPerDistrict)||14)));
    for(let index=0;index<group.length;index++){
      const item=group[index],hash=stableHash(`${item.district}:${item.id}`),origin=DISTRICT_ORIGINS[district];
      out.push(Object.freeze({...item,position:gridPosition(index,{origin,columns:3,spacing:14}),size:{width:6.5,depth:6.5,height:7+((hash>>>9)%8)},accentIndex:hash%8,detail:item.amountCents?Math.min(1,.45+Math.log10(item.amountCents+10)/8):.42}));
    }
  }
  return out;
}

export async function fetchSpatialProfiles({fetchImpl=globalThis.fetch,url='/api/social/profile-suggestions',timeoutMs=5000,limit=18}={}){
  if(typeof fetchImpl!=='function')throw new TypeError('Spatial social registry requer fetch.');
  const response=await fetchImpl(url,{headers:{accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(Math.max(1000,Math.min(15000,Number(timeoutMs)||5000)))});
  if(!response.ok)throw new Error(`spatial_profiles_${response.status}`);
  const data=await response.json();return mapProfilesToSpatialEntities(data?.suggestions,{limit});
}

export async function fetchSpatialPromotions({fetchImpl=globalThis.fetch,url='/api/promotions',timeoutMs=5000,limitPerDistrict=14}={}){
  if(typeof fetchImpl!=='function')throw new TypeError('Spatial promotion registry requer fetch.');
  const response=await fetchImpl(url,{headers:{accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(Math.max(1000,Math.min(15000,Number(timeoutMs)||5000)))});
  if(!response.ok)throw new Error(`spatial_promotions_${response.status}`);
  const data=await response.json();
  const items=Array.isArray(data)?data:Array.isArray(data?.items)?data.items:[
    ...(Array.isArray(data?.services)?data.services:[]),
    ...(Array.isArray(data?.courses)?data.courses:[]),
    ...(Array.isArray(data?.promotions)?data.promotions:[])
  ];
  return mapPromotionsToSpatialEntities(items,{limitPerDistrict});
}

export const spatialDistrictOrigins=DISTRICT_ORIGINS;
