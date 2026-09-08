import {marketplaceSlug} from './marketplace-public.js';
import {validAffiliateUrl,platforms} from './affiliate-catalog.js';

const groups=new Set(['all','products','services','news','recipes','sports','trends']);
const kindOrder={article:0,product:1,service:2,course:3,affiliate:4};
const plain=value=>typeof value==='string'?value:'';
const named=value=>plain(value).trim().length>0;
const slugValid=value=>typeof value==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)&&value.length<=150;
const normalized=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const finiteNumber=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):undefined;
const falseFlag=value=>value===false||value===0||value==='0'||value==='false';
const publicInjected=row=>row&&typeof row==='object'&&!falseFlag(row.active)&&!falseFlag(row.available)&&!falseFlag(row.ready)&&!falseFlag(row.published)&&(!row.status||['active','published'].includes(row.status));
const rowsFrom=provider=>{const data=provider();return Array.isArray(data)?data:data&&typeof data==='object'?Object.entries(data).map(([slug,item])=>({...item,slug})):[];};
const compact=object=>Object.fromEntries(Object.entries(object).filter(([,value])=>value!==undefined&&value!==null&&value!==''));
const priceText=cents=>Number.isInteger(cents)&&cents>=0?'Preço informado: '+(cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):'';
const basicBody=(description,...facts)=>[plain(description),...facts].filter(named).join('\n\n');

function publicSourceUrl(value){
  if(typeof value!=='string'||value.length>2000||/[\\\x00-\x20\x7f]/.test(value))return null;
  if(value.startsWith('/')&&!value.startsWith('//'))return value;
  try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
function citations(title,sourcePath,raw){
  let rows=[];try{rows=typeof raw==='string'?JSON.parse(raw):raw||[];}catch{}
  const seen=new Set([sourcePath]),result=[{title,url:sourcePath}];
  if(Array.isArray(rows))for(const row of rows){const url=publicSourceUrl(row?.url);if(url&&!seen.has(url)){seen.add(url);result.push({title:named(row.title)?row.title:'Fonte do artigo',url});}}
  return result;
}

/** Synchronous, read-only public source adapter.
 * `courses()` must be the existing PUBLIC, ready course catalog (courseReady filtered).
 * `services()` must be the public DIGITAL_SERVICE_PACKAGES catalog. Both are re-read
 * on every call; explicit inactive/unavailable flags and database withdrawal win.
 * list returns an array, ordered by kind then stable key, with no top-N catalog cutoff.
 */
export function createWebStorySources({db,services=()=>[],courses=()=>[]}) {
  function columns(table){
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))return new Set();
    return new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map(row=>row.name));
  }
  const has=(cols,...required)=>required.every(name=>cols.has(name));
  const projection=(cols,names,prefix='')=>names.map(name=>cols.has(name)?`${prefix}"${name}" AS "${name}"`:`NULL AS "${name}"`).join(',');
  function articles(key){
    const cols=columns('editorial_articles');if(!has(cols,'id','slug','title','status'))return [];
    const fields=['id','slug','title','summary','body','image_url','portal','updated_at','published_at','sources_json'];
    return db.prepare(`SELECT ${projection(cols,fields)} FROM editorial_articles WHERE status='published' AND id NOT LIKE 'story-companion:%'${key===undefined?'':' AND id=?'}`).all(...(key===undefined?[]:[key])).filter(row=>named(row.id)&&named(row.title)&&named(row.slug)).map(row=>{
      const sourcePath='/artigo/'+encodeURIComponent(row.slug),portalGroups={noticias:'news',entretenimento:'news',celebridades:'news',receitas:'recipes',esportes:'sports'},group=Object.hasOwn(portalGroups,row.portal)?portalGroups[row.portal]:'trends';
      return {id:row.id,key:row.id,kind:'article',group,slug:row.slug,title:row.title,summary:plain(row.summary),body:plain(row.body),image_url:plain(row.image_url),portal:plain(row.portal),updated_at:plain(row.updated_at),sourcePath,sources:citations(row.title,sourcePath,row.sources_json),facts:compact({publishedAt:row.published_at,category:row.portal}),commercial:false};
    });
  }
  function products(key){
    const cols=columns('store_products'),stores=columns('store_profiles');
    if(!has(cols,'id','store_reference','name','active','marketplace_enabled','price_cents')||!has(stores,'order_reference','review_status','business_name'))return [];
    const fields=['id','name','description','category','price_cents','image_url','updated_at','sku','stock_quantity','variation_label','delivery_min_days','delivery_max_days','return_days','product_type','preparation_minutes','dietary_tags','allergens'];
    const where=["p.active=1","p.marketplace_enabled=1","p.price_cents>0","s.review_status='published'",...(cols.has('stock_quantity')?['p.stock_quantity>0']:[]),...(cols.has('available')?['p.available=1']:[]),...(key===undefined?[]:['p.id=?'])];
    return db.prepare(`SELECT ${projection(cols,fields,'p.')},s.business_name AS store_name FROM store_products p JOIN store_profiles s ON s.order_reference=p.store_reference WHERE ${where.join(' AND ')}`).all(...(key===undefined?[]:[key])).filter(row=>Number.isSafeInteger(Number(row.id))&&Number(row.id)>0&&Number.isSafeInteger(Number(row.price_cents))&&Number(row.price_cents)>0&&(!cols.has('stock_quantity')||(Number.isSafeInteger(Number(row.stock_quantity))&&Number(row.stock_quantity)>0))&&named(row.name)).map(row=>{
      const slug=marketplaceSlug(row.name,'produto'),sourcePath='/produto/'+row.id+'/'+slug,key='product:'+row.id,priceCents=finiteNumber(row.price_cents);
      const facts=compact({storeName:row.store_name,category:row.category,priceCents,stockQuantity:finiteNumber(row.stock_quantity),sku:row.sku,variation:row.variation_label,deliveryMinDays:finiteNumber(row.delivery_min_days),deliveryMaxDays:finiteNumber(row.delivery_max_days),returnDays:finiteNumber(row.return_days),productType:row.product_type,preparationMinutes:finiteNumber(row.preparation_minutes),dietaryTags:row.dietary_tags,allergens:row.allergens});
      return {id:key,key,kind:'product',group:'products',slug,title:row.name,summary:plain(row.description),body:basicBody(row.description,named(row.category)?'Categoria: '+row.category:'',named(row.store_name)?'Loja: '+row.store_name:'',priceText(priceCents)),image_url:plain(row.image_url),portal:'produtos',updated_at:plain(row.updated_at),sourcePath,sources:citations(row.name,sourcePath),facts,commercial:true};
    });
  }
  function serviceItems(key){
    return rowsFrom(services).filter(row=>publicInjected(row)&&slugValid(row.slug)&&named(row.title)&&(key===undefined||row.slug===key)).map(row=>{
      const sourcePath='/servicos-digitais.html?servico='+encodeURIComponent(row.slug),key='service:'+row.slug,priceCents=finiteNumber(row.amountCents??row.priceCents);
      return {id:key,key,kind:'service',group:'services',slug:row.slug,title:row.title,summary:plain(row.description),body:basicBody(row.description,priceText(priceCents)),image_url:plain(row.imageUrl??row.image_url),portal:'servicos',updated_at:plain(row.updated_at??row.updatedAt),sourcePath,sources:citations(row.title,sourcePath),facts:compact({priceCents}),commercial:true};
    });
  }
  function courseItems(key){
    const cols=columns('managed_courses'),hasCatalog=cols.size>0;
    if(hasCatalog&&!has(cols,'slug','status'))return [];
    const fields=['slug','title','description','audience','price_cents','modules','cover_url','updated_at'];
    const current=hasCatalog?new Map(db.prepare(`SELECT ${projection(cols,fields)} FROM managed_courses WHERE status='active'${key===undefined?'':' AND slug=?'}`).all(...(key===undefined?[]:[key])).map(row=>[row.slug,row])):null;
    return rowsFrom(courses).filter(row=>publicInjected(row)&&slugValid(row.slug)&&(key===undefined||row.slug===key)&&(!current||current.has(row.slug))).flatMap(item=>{
      const row=current?.get(item.slug),value=(column,fallback)=>row&&cols.has(column)?row[column]:fallback,title=value('title',item.title);
      if(!named(title))return [];
      const description=plain(value('description',item.description)),audience=plain(value('audience',item.audience)),priceCents=finiteNumber(value('price_cents',item.priceCents)),modules=finiteNumber(value('modules',item.modules)),sourcePath='/centro-educacional#'+encodeURIComponent(item.slug),key='course:'+item.slug;
      return [{id:key,key,kind:'course',group:'services',slug:item.slug,title,summary:description,body:basicBody(description,audience?'Público indicado: '+audience:'',modules===undefined?'':'Módulos: '+modules,priceText(priceCents)),image_url:plain(value('cover_url',item.coverUrl??item.imageUrl)),portal:'cursos',updated_at:plain(value('updated_at',item.updated_at??item.updatedAt)),sourcePath,sources:citations(title,sourcePath),facts:compact({audience,modules,priceCents}),commercial:true}];
    });
  }
  function affiliates(key){
    const cols=columns('affiliate_catalog');if(!has(cols,'slug','title','platform','affiliate_url','status','availability','health'))return [];
    const fields=['slug','title','description','category','keywords','platform','affiliate_url','image','updated_at','availability','health','checked_at'];
    return db.prepare(`SELECT ${projection(cols,fields)} FROM affiliate_catalog WHERE status='published' AND availability='available' AND health='reachable'${key===undefined?'':' AND slug=?'}`).all(...(key===undefined?[]:[key])).filter(row=>slugValid(row.slug)&&named(row.title)&&validAffiliateUrl(row.affiliate_url,row.platform)).map(row=>{
      const sourcePath='/ofertas/'+row.slug,key='affiliate:'+row.slug,platform=platforms[row.platform];
      return {id:key,key,kind:'affiliate',group:'products',slug:row.slug,title:row.title,summary:plain(row.description),body:basicBody(row.description,named(row.category)?'Categoria: '+row.category:'',platform?'Plataforma: '+platform:''),image_url:plain(row.image),portal:'ofertas',updated_at:plain(row.updated_at),sourcePath,sources:citations(row.title,sourcePath),facts:compact({platform,platformId:row.platform,category:row.category,keywords:row.keywords,availability:row.availability,linkHealth:row.health,linkCheckedAt:row.checked_at,affiliate:true}),commercial:true};
    });
  }
  function get(key){
    if(typeof key!=='string'||!key||key.length>300)return null;
    // Published legacy article IDs retain priority even if one happens to contain a prefix.
    const legacy=articles(key)[0];if(legacy)return legacy;
    const colon=key.indexOf(':');if(colon<0)return null;
    const type=key.slice(0,colon),id=key.slice(colon+1),providers={product:products,service:serviceItems,course:courseItems,affiliate:affiliates};
    if(!id||!Object.hasOwn(providers,type)||(type==='product'&&!/^[1-9]\d*$/.test(id)))return null;
    return providers[type](id)[0]||null;
  }
  function list({q='',group='all',limit=50,offset=0}={}){
    if(!groups.has(group))return [];
    const take=Math.max(0,Math.min(200,Number.isFinite(Number(limit))?Math.trunc(Number(limit)):50)),skip=Math.max(0,Number.isSafeInteger(Number(offset))?Number(offset):0);
    if(take===0)return [];
    const terms=normalized(plain(q).slice(0,200)).split(' ').filter(Boolean).slice(0,12),seen=new Set();
    return [...articles(),...products(),...serviceItems(),...courseItems(),...affiliates()].filter(item=>{
      if(seen.has(item.key))return false;seen.add(item.key);
      return (group==='all'||item.group===group)&&terms.every(term=>normalized([item.title,item.summary,item.body,item.portal,JSON.stringify(item.facts)].join(' ')).includes(term));
    }).sort((a,b)=>kindOrder[a.kind]-kindOrder[b.kind]||(a.key<b.key?-1:a.key>b.key?1:0)).slice(skip,skip+take);
  }
  return {get,list};
}
