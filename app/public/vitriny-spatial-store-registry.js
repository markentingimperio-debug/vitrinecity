function text(value,max=160){return String(value??'').replace(/\s+/g,' ').trim().slice(0,max);}
function positive(value){const n=Number(value);return Number.isFinite(n)&&n>0?n:0;}
function slug(value){return text(value,120).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,100)||'loja';}
function stableHash(value){let hash=2166136261;for(const char of String(value||'')){hash^=char.codePointAt(0);hash=Math.imul(hash,16777619)>>>0;}return hash>>>0;}
function safeMedia(value){const raw=text(value,500);if(!raw)return'';try{const url=new URL(raw,location?.origin||'https://vitrinecity.com');if(!['http:','https:'].includes(url.protocol))return'';return url.origin===(location?.origin||url.origin)?url.pathname+url.search:url.href;}catch{return'';}}

export function normalizeSpatialStore(raw={}){
  const reference=text(raw.order_reference??raw.reference,120),name=text(raw.business_name??raw.name,120);
  if(!reference||!name)return null;
  const businessType=text(raw.business_type??raw.businessType,40).toLowerCase()||'retail';
  const kind=['food','hybrid'].includes(businessType)?'food':businessType==='service'?'services':'retail';
  return Object.freeze({
    id:`store:${reference}`,reference,name,kind,
    description:text(raw.description,300),city:text(raw.city,80),state:text(raw.state,40),
    productCount:Math.max(0,Math.floor(positive(raw.product_count??raw.productCount))),
    rating:Math.max(0,Math.min(5,positive(raw.rating_average??raw.ratingAverage))),
    acceptingOrders:Boolean(Number(raw.accepting_orders??raw.acceptingOrders??1)),
    logoUrl:safeMedia(raw.logo_url??raw.logoUrl),facadeUrl:safeMedia(raw.facade_url??raw.facadeUrl),
    href:`/loja/${encodeURIComponent(reference)}/${slug(name)}`
  });
}

export function mapStoresToSpatialEntities(stores,{limit=48,origin={x:112,z:0},spacing=18,columns=4}={}){
  const normalized=(Array.isArray(stores)?stores:[]).map(normalizeSpatialStore).filter(Boolean)
    .sort((a,b)=>a.reference.localeCompare(b.reference)).slice(0,Math.max(0,Math.min(96,Number(limit)||48)));
  const cols=Math.max(2,Math.min(8,Math.floor(Number(columns)||4))),gap=Math.max(10,Math.min(40,Number(spacing)||18));
  return normalized.map((store,index)=>{
    const row=Math.floor(index/cols),column=index%cols,center=(cols-1)/2,hash=stableHash(store.reference),jitterX=((hash&15)/15-.5)*2.4,jitterZ=(((hash>>>4)&15)/15-.5)*2.4;
    const width=9+(hash%5),depth=8+((hash>>>8)%5),height=10+Math.min(18,store.productCount*1.2)+((hash>>>12)%7);
    return Object.freeze({
      ...store,entityType:'store',district:'commerce',
      position:{x:Number((Number(origin.x)+row*gap+jitterX).toFixed(3)),y:0,z:Number((Number(origin.z)+(column-center)*gap+jitterZ).toFixed(3))},
      size:{width,depth,height},accentIndex:hash%8,detail:store.rating?Math.min(1,.35+store.rating/7):.35
    });
  });
}

export async function fetchSpatialStores({fetchImpl=fetch,url='/api/marketplace/stores',timeoutMs=6000,limit=48}={}){
  const response=await fetchImpl(url,{headers:{accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(Math.max(1000,Math.min(20000,Number(timeoutMs)||6000)))});
  if(!response.ok)throw new Error(`spatial_stores_${response.status}`);
  const data=await response.json();
  return mapStoresToSpatialEntities(data?.stores,{limit});
}
