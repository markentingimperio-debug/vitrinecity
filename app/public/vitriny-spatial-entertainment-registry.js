function text(value,max=180){return String(value??'').replace(/\s+/g,' ').trim().slice(0,max);}
function positive(value){const n=Number(value);return Number.isFinite(n)&&n>0?n:0;}
function stableHash(value){let hash=2166136261;for(const char of String(value||'')){hash^=char.codePointAt(0);hash=Math.imul(hash,16777619)>>>0;}return hash>>>0;}
function safeInternalHref(value){const href=text(value,500);if(!href.startsWith('/')||href.startsWith('//'))return'';const lower=href.toLowerCase();if(['/admin','/api/','/pagamento','/checkout','/carteira','/wallet'].some(prefix=>lower===prefix||lower.startsWith(prefix)))return'';return href;}

function profileHref(handle){const value=text(handle,48).replace(/^@/,'').toLowerCase();return value?`/perfil/${encodeURIComponent(value)}`:'/social.html';}

export function normalizeEntertainmentPost(raw={}){
  const id=text(raw.id??raw.postId,120),caption=text(raw.caption??raw.title,260),authorHandle=text(raw.author?.handle??raw.handle,48).replace(/^@/,'').toLowerCase();
  if(!id&&!caption)return null;
  const mediaType=text(raw.mediaType??raw.media_type,24).toLowerCase()||'post';
  const playerUrl=text(raw.playerUrl??raw.player_url,700),imageUrl=text(raw.imageUrl??raw.image_url,700);
  const views=Math.max(0,Math.floor(positive(raw.views??raw.viewCount??raw.views_count))),engagement=Math.max(0,Math.floor(positive(raw.engagement??raw.interactions)));
  const href=safeInternalHref(raw.href)||profileHref(authorHandle);
  return Object.freeze({
    id:`entertainment:${id||stableHash(caption)}`,entityType:'entertainment',district:'entertainment',postId:id,
    title:caption||`Conteúdo de @${authorHandle||'vitriny'}`,caption,authorHandle,mediaType,playerUrl,imageUrl,views,engagement,href
  });
}

export function mapEntertainmentToSpatialEntities(items,{limit=18,radius=28}={}){
  const normalized=(Array.isArray(items)?items:[]).map(normalizeEntertainmentPost).filter(Boolean)
    .sort((a,b)=>(b.engagement+b.views*.05)-(a.engagement+a.views*.05)||a.id.localeCompare(b.id))
    .slice(0,Math.max(0,Math.min(36,Number(limit)||18)));
  const count=Math.max(1,normalized.length),r=Math.max(14,Math.min(46,Number(radius)||28));
  return normalized.map((item,index)=>{
    const angle=(index/count)*Math.PI*2-Math.PI/2,hash=stableHash(item.id),lane=index%3,radial=r+lane*6;
    return Object.freeze({...item,
      position:{x:Number((Math.cos(angle)*radial).toFixed(3)),y:0,z:Number((Math.sin(angle)*radial).toFixed(3))},
      size:{width:7+(hash%3),height:4.2+((hash>>>5)%3)*.45,depth:.45},accentIndex:hash%8,detail:Math.min(1,.35+Math.log10(item.views+item.engagement+10)/4)
    });
  });
}

export async function fetchSpatialEntertainment({fetchImpl=globalThis.fetch,url='/api/social/feed?limit=30',timeoutMs=5000,limit=18}={}){
  if(typeof fetchImpl!=='function')throw new TypeError('Spatial entertainment registry requer fetch.');
  const response=await fetchImpl(url,{headers:{accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(Math.max(1000,Math.min(15000,Number(timeoutMs)||5000)))});
  if(!response.ok)throw new Error(`spatial_entertainment_${response.status}`);
  const data=await response.json();return mapEntertainmentToSpatialEntities(data?.items,{limit});
}
