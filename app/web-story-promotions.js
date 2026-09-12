import {createHash} from 'node:crypto';
import {normalizeStoryImagePath} from './web-story-assets.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const kinds=new Set(['article','product','service','course','affiliate','city','store','page']);
const commercial=new Set(['product','service','course','affiliate','store']);
const commercialPages=new Set(['/loja','/loja.html','/ofertas','/centro-educacional','/centro-educacional.html','/comprar-lote.html','/para-empresas.html','/entregas']);
const clean=value=>String(value??'').replace(/<[^>]*>/g,' ').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim();
const normalized=value=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const concise=(value,max=60)=>{const text=clean(value);return text.length<=max?text:text.slice(0,max-1).replace(/\s+\S*$/,'')+'…';};
const topics={plants:/\b(plantas?|jardinagem|jardim|adubos?|vasos?|hortas?|zamioculca|suculentas?)\b/,recipes:/\b(receitas?|cozinha|culinaria|panelas?|bolos?|cozinhar|forno|utensilios?)\b/,technology:/\b(tecnologia|inteligencia artificial|computadores?|celulares?|notebooks?|software|canva)\b/,business:/\b(negocios?|empresas?|lojistas?|vendas?|marketing|empreender|empreendedor|predios?|fachadas?)\b/,games:/\b(jogos?|games?|jogar|arcade|puzzle|blocos)\b/,sports:/\b(esportes?|futebol|corrida|treinos?|bicicletas?|ciclismo)\b/,home:/\b(decoracao|moveis|sofas?|quartos?|camas?)\b/,autos:/\b(carros?|automoveis|automotivo|motos?|veiculos?)\b/};
const tags=text=>Object.keys(topics).filter(key=>topics[key].test(normalized(text)));
const stop=new Set(['para','como','mais','voce','seus','suas','sobre','este','esta','com','uma','por','dos','das','nos','nas','que','completo','guia','vitrinecity','conheca','melhor','dicas','produto','produtos','curso','cursos','conteudo']);
const words=text=>new Set(normalized(text).match(/[a-z0-9]{4,}/g)?.filter(word=>!stop.has(word))||[]);
const sensitive=text=>/\b(morte|mortes|morreu|luto|suicidio|depressao|cancer|diabetes|tratamento|doenca|saude|abuso|violencia|crime|guerra|tragedia|desastre|eleicao|politica|emprestimo|investimento|endividamento)\b/.test(normalized(text));
const prayer=text=>/\b(oracao|oracoes|jesus|amem|biblia|religiao|religiosidade|cura espiritual)\b/.test(normalized(text));
const contextText=story=>[story?.title,story?.description,story?.category,...(story?.pages||[]).map(page=>page.text)].join(' ');
const sourceText=source=>[source.title,source.summary,source.portal,source.facts?.category,source.facts?.keywords,source.facts?.productCategories?.join(' ')].join(' ');
const fingerprint=source=>hash(JSON.stringify([source.key,source.kind,source.title,source.summary,source.image_url,source.sourcePath,source.updated_at,source.facts]));
const publicPages=new Set(['/','/loja','/loja.html','/ofertas','/descobrir','/centro-educacional','/centro-educacional.html','/entregas','/vitriny-games.html','/vitriny-mini-fazenda.html','/vitriny-music-arena.html','/vitriny-cinema.html','/social','/comprar-lote.html','/para-empresas.html','/como-funciona.html','/sobre.html','/contato.html','/guias/plantas-em-vasos.html','/games/','/games/plantas','/games/cuidados']);

// Only a first-party public landing page; never a checkout, redirect, API or
// arbitrary affiliate URL. Affiliate landing pages keep the original partner link.
export function safeStoryPromotionDestination(value,origin){
  if(typeof value!=='string'||value.length>1200||!value.startsWith('/')||value.startsWith('//')||/[\\\x00-\x20\x7f]/.test(value))return null;
  try{
    const url=new URL(value,origin),decoded=decodeURIComponent(value.split(/[?#]/)[0]);
    if(url.origin!==new URL(origin).origin||decoded.split('/').some(part=>part==='.'||part==='..')||/[\\\x00-\x20\x7f]/.test(decoded)||/%(?:2f|5c|25)/i.test(value.split(/[?#]/)[0]))return null;
    const pathname=decodeURIComponent(url.pathname);
    const publicDetail=/^\/(?:artigo|ofertas|cursos)\/[\p{L}\p{N}][\p{L}\p{N}_-]{0,160}$/u.test(pathname)||/^\/produto\/[1-9]\d{0,12}\/[a-z0-9][a-z0-9-]{0,160}$/.test(pathname)||/^\/loja\/[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}\/[a-z0-9][a-z0-9-]{0,160}$/.test(pathname);
    if(!publicPages.has(pathname)&&!publicDetail&&pathname!=='/servicos-digitais.html')return null;
    if(url.hash&&(!['/centro-educacional','/centro-educacional.html'].includes(pathname)||!/^#[a-z0-9][a-z0-9-]{0,150}$/.test(url.hash)))return null;
    const seen=new Set();for(const [key,entry] of url.searchParams){
      if(seen.has(key))return null;seen.add(key);
      if(key==='servico'&&pathname==='/servicos-digitais.html'&&/^[a-z0-9][a-z0-9-]{0,150}$/.test(entry))continue;
      if(key==='utm_source'&&entry==='web_stories'||key==='utm_medium'&&entry==='internal_recommendation'||key==='utm_campaign'&&/^ws_[a-f0-9]{24}$/.test(entry)||key==='utm_content'&&/^item_[a-f0-9]{24}$/.test(entry))continue;
      return null;
    }
    if(pathname==='/servicos-digitais.html'&&!url.searchParams.has('servico'))return null;
    return url.pathname+url.search+url.hash;
  }catch{return null;}
}

export function storyPromotionSlots(story){
  const pages=story?.pages;if(!Array.isArray(pages)||pages.length<10||pages.length>40||sensitive(contextText(story))||prayer(contextText(story)))return [];
  const count=pages.length>=20?2:1,last=pages.length-(story.homeCta?3:2),candidates=[];
  for(let after=3;after<=last;after++)if(/[.!?…][”"')\]]?$/.test(clean(pages[after-1]?.text)))candidates.push(after);
  const result=[];for(let part=1;part<=count;part++){
    const target=pages.length*part/(count+1),chosen=candidates.filter(after=>result.every(previous=>Math.abs(previous-after)>=5)).sort((a,b)=>Math.abs(a-target)-Math.abs(b-target)||a-b)[0];
    if(chosen!==undefined)result.push(chosen);
  }
  return result.sort((a,b)=>a-b);
}

function normalizedPromotion(item,origin){
  if(!item||!kinds.has(item.kind)||typeof item.key!=='string'||!item.key||!item.title||item.active===false||item.available===false||item.ready===false||item.status&&!['published','active'].includes(item.status))return null;
  const href=safeStoryPromotionDestination(item.sourcePath,origin);if(!href||sensitive(sourceText(item))||prayer(sourceText(item)))return null;
  if(item.kind==='product'&&(!Number.isSafeInteger(item.facts?.priceCents)||item.facts.priceCents<=0||!Number.isSafeInteger(item.facts?.stockQuantity)||item.facts.stockQuantity<=0))return null;
  if(item.kind==='affiliate'&&(item.facts?.availability!=='available'||item.facts?.linkHealth!=='reachable'))return null;
  try{const image=normalizeStoryImagePath(item.image_url,origin);if(!/^\/(?:assets|uploads\/(?:generated-videos|store-assets))\//.test(image))return null;return {...item,sourcePath:href,image_url:image};}catch{return null;}
}

// Revalidated again by the renderer so an optional caller cannot inject a URL,
// text-heavy ad, a cover/end insertion or more than the editorial density limit.
export function normalizeStoryPromotions(story,input,{origin}){
  const slots=new Set(storyPromotionSlots(story)),seen=new Set(),result=[];
  for(const item of Array.isArray(input)?input:[]){
    if(!item||!slots.has(item.afterPage)||seen.has(item.key)||!kinds.has(item.kind))continue;
    const href=safeStoryPromotionDestination(item.href,origin);let image;try{image=normalizeStoryImagePath(item.image,origin);}catch{continue;}
    if(!href||!/^\/(?:assets|uploads\/(?:generated-videos|store-assets))\//.test(image)||!Number.isInteger(item.width)||!Number.isInteger(item.height)||item.width<640||item.height<360||item.width>10000||item.height>10000)continue;
    const title=concise(item.title);if(!title)continue;
    const isAd=commercial.has(item.kind)||commercialPages.has(new URL(href,origin).pathname);
    result.push({key:item.key,kind:item.kind,afterPage:item.afterPage,href,image,width:item.width,height:item.height,title,label:isAd?'Publicidade':'Conteúdo recomendado',description:isAd?'Veja os detalhes na página.':'Explore mais na VitrineCity.',disclosure:item.kind==='affiliate'?'Link de afiliado: podemos receber comissão.':'',cta:isAd?'Ver detalhes':'Conhecer'});
    slots.delete(item.afterPage);seen.add(item.key);
  }
  return result.sort((a,b)=>a.afterPage-b.afterPage);
}

/** Read-only contextual selection. No AI, visitor data, counters, remote image
 * fetch, ads/serve or CPC budget. Inject the existing public source catalog. */
export function createWebStoryPromotions({sourceCatalog,assets,origin}){
  function allSources(){
    const rows=[];for(let offset=0;offset<10000;offset+=200){const batch=sourceCatalog.list({group:'all',limit:200,offset});if(!Array.isArray(batch))break;rows.push(...batch);if(batch.length<200)break;}
    const city=rows.find(item=>item.kind==='city'&&item.key==='city:vitrine-city');
    for(const destination of city?.facts?.destinations||[])if(publicPages.has(destination.path)&&destination.path!=='/')rows.push({key:city.key+'#'+hash(destination.path).slice(0,16),kind:'page',title:destination.title,summary:destination.description,image_url:city.image_url,sourcePath:destination.path,portal:'cidade',commercial:false,parentKey:city.key});
    return rows;
  }
  function fresh(item){
    if(!item.parentKey)return sourceCatalog.get(item.key);
    const parent=sourceCatalog.get(item.parentKey),destination=parent?.facts?.destinations?.find(value=>value.path===item.sourcePath);
    return destination?{key:item.key,kind:'page',title:destination.title,summary:destination.description,image_url:parent.image_url,sourcePath:destination.path,portal:'cidade',commercial:false,parentKey:item.parentKey}:null;
  }
  async function select(story,{slug='',sourceKey='',fingerprint:sourceHash=''}={}){
    const slots=storyPromotionSlots(story);if(!slots.length)return [];
    try{
      const context=contextText(story),topicSet=new Set(tags(context)),terms=words([story.title,story.description].join(' ')),seed=hash(slug+'\n'+sourceHash),seen=new Set();
      const candidates=allSources().map(item=>normalizedPromotion(item,origin)).filter(item=>item&&item.key!==sourceKey&&item.sourcePath!==story.sourcePath&&!seen.has(item.key)&&seen.add(item.key)).map(item=>{
        const text=sourceText(item),overlap=[...words(text)].filter(word=>terms.has(word)).length,shared=tags(text).filter(tag=>topicSet.has(tag)).length;
        return {item,score:shared*5+Math.min(overlap,5),tie:hash(seed+'\n'+item.key)};
      });
      const related=candidates.filter(value=>value.score>=2).sort((a,b)=>b.score-a.score||a.tie.localeCompare(b.tie));
      const fallback=candidates.find(value=>value.item.kind==='city'&&value.item.key==='city:vitrine-city');
      const ranked=[...related,...(fallback&&!related.includes(fallback)?[fallback]:[])],selected=[];
      for(const {item,score} of ranked){
        if(selected.length>=slots.length)break;
        try{
          const before=normalizedPromotion(fresh(item),origin);if(!before||fingerprint(before)!==fingerprint(item))continue;
          const asset=await assets.image(before.image_url,{catalog:true});
          const after=normalizedPromotion(fresh(item),origin);if(!after||fingerprint(after)!==fingerprint(before))continue;
          const url=new URL(after.sourcePath,origin);url.searchParams.set('utm_source','web_stories');url.searchParams.set('utm_medium','internal_recommendation');url.searchParams.set('utm_campaign','ws_'+seed.slice(0,24));url.searchParams.set('utm_content','item_'+hash(item.key).slice(0,24));
          selected.push({key:item.key,kind:item.kind,afterPage:slots[selected.length],title:score<2&&item.kind==='city'?'Conheça a VitrineCity':item.title,href:url.pathname+url.search+url.hash,image:asset.url,width:asset.width,height:asset.height,snapshot:after});
        }catch{/* An unavailable local asset removes only this suggestion. */}
      }
      return normalizeStoryPromotions(story,selected.filter(item=>{const current=normalizedPromotion(fresh(item.snapshot),origin);return current&&fingerprint(current)===fingerprint(item.snapshot);}),{origin});
    }catch{return [];}
  }
  return {select};
}
