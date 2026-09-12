import {readFileSync,statSync} from 'node:fs';
import path from 'node:path';
import {marketplaceSlug,publicStorePath} from './marketplace-public.js';
import {validAffiliateUrl,platforms} from './affiliate-catalog.js';
import {CITY_GUIDE_ITEMS} from './public/vitriny-city-guide-core.js';

const groups=new Set(['all','products','services','news','recipes','sports','trends']);
const kindOrder={article:0,product:1,service:2,course:3,affiliate:4,city:5,store:6,page:7};
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
const htmlText=value=>plain(value).replace(/<[^>]*>/g,' ').replace(/&#(x[0-9a-f]+|\d+);/gi,(_all,value)=>{const code=value[0].toLowerCase()==='x'?parseInt(value.slice(1),16):Number(value);return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';}).replace(/&(amp|lt|gt|quot|apos|nbsp);/g,(_all,name)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[name])).replace(/\s+/g,' ').trim();
const htmlAttributes=tag=>Object.fromEntries([...tag.matchAll(/([a-zA-Z][\w:-]*)\s*=\s*(["'])(.*?)\2/gs)].map(match=>[match[1].toLowerCase(),htmlText(match[3])]));
const cityGuideIds=new Set(['pesquisar','vitrines','descobrir','centros','entregas','cursos','jardim','jogos','musica','cinema','social','acessos','meu-predio','como-funciona','sobre','contato']);

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
 * `publicDir` enables the city presentation from the actual public home file;
 * `includePrayerPage` opts in to one fixed public prayer page, for comment campaigns.
 * no arbitrary path or remote page is accepted from a source or database field.
 * list returns an array, ordered by kind then stable key, with no top-N catalog cutoff.
 */
export function createWebStorySources({db,services=()=>[],courses=()=>[],publicDir=null,includePrayerPage=false}) {
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
  function products(key,storeReference){
    const cols=columns('store_products'),stores=columns('store_profiles');
    if(!has(cols,'id','store_reference','name','active','marketplace_enabled','price_cents')||!has(stores,'order_reference','review_status','business_name'))return [];
    const fields=['id','name','description','category','price_cents','image_url','updated_at','sku','stock_quantity','variation_label','delivery_min_days','delivery_max_days','return_days','product_type','preparation_minutes','dietary_tags','allergens'];
    const where=["p.active=1","p.marketplace_enabled=1","p.price_cents>0","s.review_status='published'",...(cols.has('stock_quantity')?['p.stock_quantity>0']:[]),...(cols.has('available')?['p.available=1']:[]),...(key===undefined?[]:['p.id=?']),...(storeReference===undefined?[]:['p.store_reference=?'])];
    return db.prepare(`SELECT ${projection(cols,fields,'p.')},s.business_name AS store_name FROM store_products p JOIN store_profiles s ON s.order_reference=p.store_reference WHERE ${where.join(' AND ')}`).all(...(key===undefined?[]:[key]),...(storeReference===undefined?[]:[storeReference])).filter(row=>Number.isSafeInteger(Number(row.id))&&Number(row.id)>0&&Number.isSafeInteger(Number(row.price_cents))&&Number(row.price_cents)>0&&(!cols.has('stock_quantity')||(Number.isSafeInteger(Number(row.stock_quantity))&&Number(row.stock_quantity)>0))&&named(row.name)).map(row=>{
      const slug=marketplaceSlug(row.name,'produto'),sourcePath='/produto/'+row.id+'/'+slug,key='product:'+row.id,priceCents=finiteNumber(row.price_cents);
      const facts=compact({storeName:row.store_name,category:row.category,priceCents,stockQuantity:finiteNumber(row.stock_quantity),sku:row.sku,variation:row.variation_label,deliveryMinDays:finiteNumber(row.delivery_min_days),deliveryMaxDays:finiteNumber(row.delivery_max_days),returnDays:finiteNumber(row.return_days),productType:row.product_type,preparationMinutes:finiteNumber(row.preparation_minutes),dietaryTags:row.dietary_tags,allergens:row.allergens});
      return {id:key,key,kind:'product',group:'products',slug,title:row.name,summary:plain(row.description),body:basicBody(row.description,named(row.category)?'Categoria: '+row.category:'',named(row.store_name)?'Loja: '+row.store_name:'',priceText(priceCents)),image_url:plain(row.image_url),portal:'produtos',updated_at:plain(row.updated_at),sourcePath,sources:citations(row.name,sourcePath),facts,commercial:true};
    });
  }
  function serviceItems(key){
    return rowsFrom(services).filter(row=>publicInjected(row)&&slugValid(row.slug)&&named(row.title)&&(key===undefined||row.slug===key)).map(row=>{
      const sourcePath='/servicos-digitais.html?servico='+encodeURIComponent(row.slug),key='service:'+row.slug,priceCents=finiteNumber(row.amountCents??row.priceCents);
      const body=named(row.editorialBody)?row.editorialBody:row.description,image=named(row.editorialImageUrl)?row.editorialImageUrl:row.imageUrl??row.image_url;
      return {id:key,key,kind:'service',group:'services',slug:row.slug,title:row.title,summary:plain(row.description),body:basicBody(body,priceText(priceCents)),image_url:plain(image),portal:'servicos',updated_at:plain(row.updated_at??row.updatedAt),sourcePath,sources:citations(row.title,sourcePath),facts:compact({priceCents}),commercial:true};
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
  function cityItems(key){
    if(!publicDir||(key!==undefined&&key!=='vitrine-city'))return [];
    let html;try{const file=path.join(publicDir,'index.html');if(statSync(file).size>512*1024)return [];html=readFileSync(file,'utf8');}catch{return [];}
    const head=html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1]||'';
    const title=htmlText(head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
    const summary=[...head.matchAll(/<meta\b[^>]*>/gi)].map(match=>htmlAttributes(match[0])).find(attrs=>attrs.name==='description')?.content||'';
    const hero=html.match(/<section\b[^>]*class=["'][^"']*\bhome-hero\b[^"']*["'][^>]*>([\s\S]*?)<\/section>/i)?.[1]||'';
    const accessNote=htmlText(hero.match(/<p\b[^>]*class=["'][^"']*\bhero-note\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1]);
    const image=[...hero.matchAll(/<img\b[^>]*>/gi)].map(match=>htmlAttributes(match[0])).find(attrs=>attrs.class?.split(/\s+/).includes('hero-panorama'));
    if(!title||!summary||!hero)return [];
    const destinations=CITY_GUIDE_ITEMS.filter(item=>cityGuideIds.has(item.id)&&publicSourceUrl(item.href)?.startsWith('/')).map(item=>({title:item.title,description:item.description,landmark:item.landmark,path:item.href}));
    const sourcePath='/',id='city:vitrine-city',body=basicBody(summary,accessNote,...destinations.map(item=>`${item.title}: ${item.description}${item.landmark?' Local no guia: '+item.landmark+'.':''}`));
    const imageUrl=publicSourceUrl(image?.src),facts=compact({accessNote,illustrationDescription:image?.alt,destinations});
    return [{id,key:id,kind:'city',group:'trends',slug:'vitrine-city',title,summary,body,image_url:imageUrl?.startsWith('/')?imageUrl:'',portal:'cidade',updated_at:'',sourcePath,sources:[{title,url:sourcePath},{title:'Guia público da cidade',url:'/multiverso?city=vitrine-city'}],facts,commercial:false}];
  }
  function prayerPageItems(key){
    if(includePrayerPage!==true||!publicDir||(key!==undefined&&key!=='oracao-do-dia'))return [];
    // Only this fixed, already-published page is a source. Never read a path or
    // URL supplied by a campaign, an article record or a catalog search.
    let html;try{const file=path.join(publicDir,'oracao-do-dia.html');if(statSync(file).size>512*1024)return [];html=readFileSync(file,'utf8');}catch{return [];}
    const head=html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1]||'';
    const title=htmlText(head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
    const summary=[...head.matchAll(/<meta\b[^>]*>/gi)].map(match=>htmlAttributes(match[0])).find(attrs=>attrs.name==='description')?.content||'';
    const selected=(tag,id)=>[...html.matchAll(new RegExp('<'+tag+'\\b([^>]*)>([\\s\\S]*?)<\\/'+tag+'>','gi'))].find(match=>htmlAttributes(match[1]).id===id);
    const prayerTitle=htmlText(selected('h2','prayerTitle')?.[2]),edition=htmlText(selected('time','prayerEdition')?.[2]),verse=htmlText(selected('p','dailyVerse')?.[2]);
    const paragraphs=[...html.matchAll(/<p\b[^>]*\sdata-prayer-paragraph(?=[\s=>])[^>]*>([\s\S]*?)<\/p>/gi)].map(match=>htmlText(match[1])).filter(Boolean);
    const image=[...html.matchAll(/<img\b[^>]*>/gi)].map(match=>htmlAttributes(match[0])).find(attrs=>attrs.id==='jesusArt');
    const imageUrl=image?.src||'';
    if(!title||!summary||!prayerTitle||!paragraphs.length||!verse||!/^\/assets\/prayer\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.(?:png|jpe?g|webp|avif)$/i.test(imageUrl))return [];
    try{if(!statSync(path.join(publicDir,imageUrl.slice(1))).isFile())return [];}catch{return [];}
    const id='page:oracao-do-dia',sourcePath='/oracao-do-dia.html';
    return [{id,key:id,kind:'page',group:'trends',slug:'oracao-do-dia',title,summary,body:basicBody(prayerTitle,edition,...paragraphs,verse),image_url:imageUrl,portal:'oracao',updated_at:'',sourcePath,sources:[{title,url:sourcePath}],facts:compact({prayerTitle,edition,verse,illustrationDescription:image.alt}),commercial:false}];
  }
  function storeItems(key){
    const cols=columns('store_profiles');if(!has(cols,'order_reference','business_name','review_status','description'))return [];
    const fields=['order_reference','business_name','description','facade_url','gallery_1_url','logo_url','city','state','website_url','instagram_url','tiktok_url','google_maps_url','updated_at'];
    return db.prepare(`SELECT ${projection(cols,fields)} FROM store_profiles WHERE review_status='published'${key===undefined?'':' AND order_reference=?'}`).all(...(key===undefined?[]:[key])).filter(row=>named(row.order_reference)&&row.order_reference.length<=120&&named(row.business_name)).map(row=>{
      const sourcePath=publicStorePath(row),id='store:'+row.order_reference;
      // Reuse the product gate. An unpublished, unavailable or sold-out item can
      // never become an offering in a store presentation through this adapter.
      const inventory=products(undefined,row.order_reference).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
      const categories=[...new Set(inventory.map(item=>plain(item.facts.category)).filter(named))].sort();
      const featured=inventory.slice(0,12).map(item=>compact({title:item.title,description:item.summary,category:item.facts.category,sourcePath:item.sourcePath}));
      const channels=[['Site','website_url'],['Instagram','instagram_url'],['TikTok','tiktok_url'],['Mapa','google_maps_url']].filter(([,field])=>publicSourceUrl(row[field])).map(([label])=>label);
      const location=[row.city,row.state].filter(named).join(' / ');
      const facts=compact({businessName:row.business_name,city:row.city,state:row.state,publicProductCount:inventory.length,productCategories:categories,products:featured,publicChannels:channels});
      const body=basicBody(row.description,location?'Localização informada na página: '+location+'.':'',channels.length?'Canais disponíveis na página: '+channels.join(', ')+'.':'',...featured.map(item=>`${item.title}: ${item.description||item.category||''}`));
      return {id,key:id,kind:'store',group:'services',slug:marketplaceSlug(row.business_name),title:row.business_name,summary:plain(row.description),body,image_url:plain(row.facade_url||row.gallery_1_url||row.logo_url),portal:'lojas',updated_at:plain(row.updated_at),sourcePath,sources:citations(row.business_name,sourcePath),facts,commercial:true};
    });
  }
  function get(key){
    if(typeof key!=='string'||!key||key.length>300)return null;
    // Published legacy article IDs retain priority even if one happens to contain a prefix.
    const legacy=articles(key)[0];if(legacy)return legacy;
    const colon=key.indexOf(':');if(colon<0)return null;
    const type=key.slice(0,colon),id=key.slice(colon+1),providers={product:products,service:serviceItems,course:courseItems,affiliate:affiliates,city:cityItems,store:storeItems,page:prayerPageItems};
    if(!id||!Object.hasOwn(providers,type)||(type==='product'&&!/^[1-9]\d*$/.test(id)))return null;
    return providers[type](id)[0]||null;
  }
  function list({q='',group='all',limit=50,offset=0}={}){
    if(!groups.has(group))return [];
    const take=Math.max(0,Math.min(200,Number.isFinite(Number(limit))?Math.trunc(Number(limit)):50)),skip=Math.max(0,Number.isSafeInteger(Number(offset))?Number(offset):0);
    if(take===0)return [];
    const terms=normalized(plain(q).slice(0,200)).split(' ').filter(Boolean).slice(0,12),seen=new Set();
    return [...articles(),...products(),...serviceItems(),...courseItems(),...affiliates(),...cityItems(),...storeItems(),...prayerPageItems()].filter(item=>{
      if(seen.has(item.key))return false;seen.add(item.key);
      return (group==='all'||item.group===group)&&terms.every(term=>normalized([item.title,item.summary,item.body,item.portal,JSON.stringify(item.facts)].join(' ')).includes(term));
    }).sort((a,b)=>kindOrder[a.kind]-kindOrder[b.kind]||(a.key<b.key?-1:a.key>b.key?1:0)).slice(skip,skip+take);
  }
  return {get,list};
}
