import {isSafeInternalHref} from './vitriny-spatial-session.js';
import {normalizeInteriorProduct} from './vitriny-store-interior-core.js';

const clean=(value,max)=>String(value??'').replace(/[\u0000-\u001f]/g,'').trim().slice(0,max);
export function safeBillboardHref(value,{campaign=false}={}){
  const href=clean(value,500);
  if(/[\\\s]/.test(href)||/%(?:0[ad]|5c|2f)/i.test(href))return '';
  if(campaign)return /^\/api\/ads\/\d+\/click\?token=[A-Za-z0-9_-]{12,100}$/.test(href)?href:'';
  // Only display ordinary public destinations; a screen never initiates a purchase.
  return isSafeInternalHref(href)&&!href.includes('..')?href:'';
}
export function normalizeBillboard(raw,{campaign=false}={}){
  const title=clean(raw?.title,140),href=safeBillboardHref(campaign?raw?.clickUrl:raw?.url,{campaign});if(!title||!href)return null;
  let imageUrl='';const image=clean(raw.imageUrl,700);
  if(image&&!/[\\\s]/.test(image)){try{const url=new URL(image,'https://vitrinecity.com');if(url.protocol==='https:'&&!url.username&&!url.password)imageUrl=image;}catch{}}
  return Object.freeze({title,href,imageUrl,label:campaign?'PATROCINADO':clean(raw.label,70)||'NA CIDADE',description:clean(raw.description||raw.text,220),amountCents:Math.max(0,Math.floor(Number(raw.amountCents)||0)),campaign});
}
export async function fetchBillboardPlaylist({fetchImpl=globalThis.fetch,active=false,city='',timeoutMs=5000}={}){
  if(!active)return [];
  async function get(url){const response=await fetchImpl(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(timeoutMs)});if(!response.ok)throw new Error(`billboard_${response.status}`);return response.json();}
  const [promotions,ads]=await Promise.allSettled([get('/api/promotions'),get(`/api/ads/serve?placement=map${city?`&city=${encodeURIComponent(city)}`:''}`)]);
  return [...(ads.status==='fulfilled'&&Array.isArray(ads.value?.ads)?ads.value.ads:[]).map(raw=>normalizeBillboard(raw,{campaign:true})),...(promotions.status==='fulfilled'&&Array.isArray(promotions.value?.items)?promotions.value.items:[]).map(raw=>normalizeBillboard(raw))].filter(Boolean).slice(0,32);
}
export function billboardIndex({elapsed=0,offset=0,count=0,paused=false}={}){return count>0?((paused?0:Math.floor(Math.max(0,elapsed)/8))+offset)%count:0;}

export function storeBillboardPlaylist(store,products=[]){
  const items=(Array.isArray(products)?products:[]).map(normalizeInteriorProduct).filter(product=>product&&product.storeReference===store.reference).slice(0,24).map(product=>normalizeBillboard({title:product.name,url:product.href,imageUrl:product.imageUrl,label:store.name,amountCents:product.priceCents,description:product.description})).filter(Boolean);
  if(items.length)return items;
  const intro=normalizeBillboard({title:'Conheça o que oferecemos',label:store.name,url:store.mapHref||store.href,imageUrl:store.facadeUrl||store.logoUrl,description:store.description||'Visite a página da loja para saber mais.'});
  return intro?[intro]:[];
}
export async function fetchStoreBillboardPlaylist(store,{fetchImpl=globalThis.fetch}={}){
  if(!store.productCount)return storeBillboardPlaylist(store);
  try{const response=await fetchImpl(`/api/marketplace/products?q=${encodeURIComponent(store.name)}`,{headers:{accept:'application/json'},signal:AbortSignal.timeout(7000)});if(!response.ok)throw new Error('products_unavailable');return storeBillboardPlaylist(store,(await response.json())?.products);}catch{return storeBillboardPlaylist(store);}
}
