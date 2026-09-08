function text(value,max=180){return String(value??'').replace(/\s+/g,' ').trim().slice(0,max);}
function positive(value){const n=Number(value);return Number.isFinite(n)&&n>0?n:0;}
function safeImage(value){const raw=text(value,700);if(!raw||/[\\\s]/.test(raw))return '';try{const url=new URL(raw,'https://vitrinecity.com');return url.protocol==='https:'&&!url.username&&!url.password&&!/^\/(?:api|admin)(?:\/|$)/.test(url.pathname)?raw:'';}catch{return '';}}
function slug(value,fallback='produto'){return text(value,120).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,100)||fallback;}

export function normalizeInteriorProduct(raw={}){
  const id=Number(raw.id),storeReference=text(raw.store_reference??raw.storeReference,120),name=text(raw.name??raw.title,140);
  if(!Number.isInteger(id)||id<1||!storeReference||!name)return null;
  return Object.freeze({
    id,storeReference,name,
    description:text(raw.description,260),category:text(raw.category,80)||'Produto',
    priceCents:Math.max(0,Math.floor(positive(raw.price_cents??raw.priceCents))),
    stockQuantity:Math.max(0,Math.floor(positive(raw.stock_quantity??raw.stockQuantity))),
    rating:Math.max(0,Math.min(5,positive(raw.rating_average??raw.ratingAverage))),
    imageUrl:safeImage(raw.image_url??raw.imageUrl),
    href:`/produto/${id}/${slug(name)}`
  });
}

export function layoutStoreProducts(products,{storeReference,limit=24,columns=4,spacingX=7.5,spacingZ=8.5}={}){
  const reference=text(storeReference,120);
  const normalized=(Array.isArray(products)?products:[]).map(normalizeInteriorProduct).filter(Boolean)
    .filter(item=>!reference||item.storeReference===reference)
    .slice(0,Math.max(0,Math.min(48,Number(limit)||24)));
  const cols=Math.max(2,Math.min(6,Math.floor(Number(columns)||4))),gapX=Math.max(5,Math.min(14,Number(spacingX)||7.5)),gapZ=Math.max(6,Math.min(16,Number(spacingZ)||8.5));
  return normalized.map((product,index)=>{
    const row=Math.floor(index/cols),column=index%cols,center=(cols-1)/2;
    return Object.freeze({...product,position:{x:Number(((column-center)*gapX).toFixed(3)),y:0,z:Number((-5-row*gapZ).toFixed(3))},accentIndex:(product.id*2654435761>>>0)%8});
  });
}

export async function fetchStoreInteriorData({fetchImpl=globalThis.fetch,storeReference,storeName='',timeoutMs=6000,limit=24}={}){
  if(typeof fetchImpl!=='function')throw new TypeError('Store interior requer fetch.');
  const reference=text(storeReference,120);if(!reference)throw new TypeError('storeReference obrigatório.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(1000,Math.min(20000,Number(timeoutMs)||6000)));
  try{
    const storesPromise=fetchImpl('/api/marketplace/stores',{headers:{accept:'application/json'},cache:'no-store',signal:controller.signal});
    const q=text(storeName,120),productsUrl=q?`/api/marketplace/products?q=${encodeURIComponent(q)}`:'/api/marketplace/products';
    const productsPromise=fetchImpl(productsUrl,{headers:{accept:'application/json'},cache:'no-store',signal:controller.signal});
    const [storesResponse,productsResponse]=await Promise.all([storesPromise,productsPromise]);
    if(!storesResponse.ok)throw new Error(`spatial_store_${storesResponse.status}`);
    if(!productsResponse.ok)throw new Error(`spatial_products_${productsResponse.status}`);
    const [storesData,productsData]=await Promise.all([storesResponse.json(),productsResponse.json()]);
    const store=(Array.isArray(storesData?.stores)?storesData.stores:[]).find(item=>String(item.order_reference||item.reference||'')===reference)||null;
    if(!store)throw new Error('spatial_store_not_found');
    const products=layoutStoreProducts(productsData?.products,{storeReference:reference,limit});
    return {store,products};
  }finally{clearTimeout(timer);}
}
