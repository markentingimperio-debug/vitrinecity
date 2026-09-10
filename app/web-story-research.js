import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {createHash} from 'node:crypto';
import {publicImageAddress} from './catalog-product-images.js';
import {storyTopicCategory,storyEditorialPortal} from './web-story-categories.js';

const RSS='https://trends.google.com/trending/rss?geo=BR';
const MAX_BYTES=512*1024, MAX_AGE=24*60*60*1000;
// Observed in the public BR Trends feed on 2026-09-08. Publisher families, not
// subdomains, determine independence. Feed discovery never expands this list.
export const STORY_RESEARCH_PUBLISHERS=Object.freeze({
  'veja.abril.com.br':'abril','sports.sbt.com.br':'sbt',
  'diariodonordeste.verdesmares.com.br':'verdesmares','www.bbc.com':'bbc',
  'www1.folha.uol.com.br':'folha','oglobo.globo.com':'globo',
  'www.estadao.com.br':'estadao','www.nbcnews.com':'nbc',
  'forbes.com.br':'forbes','olhardigital.com.br':'olhardigital',
  'www.realmadrid.com':'realmadrid','agenciabrasil.ebc.com.br':'ebc','tvbrasil.ebc.com.br':'ebc',
  'panelinha.com.br':'panelinha','www.panelinha.com.br':'panelinha',
  'minhasplantas.com.br':'minhasplantas','www.minhasplantas.com.br':'minhasplantas',
  'www.embrapa.br':'embrapa','embrapa.br':'embrapa'
});
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const fail=code=>Object.assign(Error(code),{code});
const entities={amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ',ccedil:'ç',Ccedil:'Ç',aacute:'á',Aacute:'Á',eacute:'é',Eacute:'É',iacute:'í',Iacute:'Í',oacute:'ó',Oacute:'Ó',uacute:'ú',Uacute:'Ú',agrave:'à',Agrave:'À',acirc:'â',Acirc:'Â',ecirc:'ê',Ecirc:'Ê',ocirc:'ô',Ocirc:'Ô',atilde:'ã',Atilde:'Ã',otilde:'õ',Otilde:'Õ',uuml:'ü',Uuml:'Ü',ordm:'º',ordf:'ª',deg:'°',ndash:'–',mdash:'—',frac12:'½',frac14:'¼',frac34:'¾',lsquo:'‘',rsquo:'’',ldquo:'“',rdquo:'”'};
const clean=value=>String(value||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
  .replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const v=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return v>0&&v<=0x10ffff?String.fromCodePoint(v):'';})
  .replace(/&([a-zA-Z][a-zA-Z0-9]+);/g,(raw,n)=>entities[n]??raw)
  .replace(/<[^>]*>/g,' ').replace(/[\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim();
const tag=(xml,name)=>clean(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>','i').exec(xml)?.[1]);
const normalize=value=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const topicStopWords=new Set('para como sobre pela pelo pelas pelos esta este essa esse isso mais muito tudo todos todas hoje ontem amanha agora quando onde porque voce voces nossa nosso suas seus uma umas uns que sao sera ser dos das com sem entre ate saiba entenda confira veja video canal noticia noticias reportagem brasil brasileira brasileiro brasileiros brasileiras mundo pais paises nacional agenda proximo proximos nova novo novas novos acontece fazer veja dicas'.split(' '));
// Discovery titles and search snippets are untrusted context. Require overlap
// in the fetched article itself, never merely a generic country or call to read.
export function storyResearchTopicMatches(title,article){
  const terms=[...new Set(normalize(title).split(/[^a-z0-9]+/).filter(term=>term.length>=4&&!topicStopWords.has(term)))].slice(0,12);
  if(!terms.length)return false;
  const titleWords=new Set(normalize(article.title).split(/[^a-z0-9]+/)),bodyWords=normalize(article.excerpt).split(/[^a-z0-9]+/),allWords=new Set([...titleWords,...bodyWords]);
  if(terms.length===1)return terms[0].length>=6&&titleWords.has(terms[0])&&bodyWords.filter(word=>word===terms[0]).length>=2;
  return terms.filter(term=>allWords.has(term)).length>=Math.max(2,Math.ceil(terms.length*.6))&&terms.some(term=>titleWords.has(term));
}
const checkSignal=signal=>{if(signal?.aborted)throw fail('research_aborted');};

export function storyResearchUrl(value,{feed=false}={}) {
  try {
    const raw=String(value||'');if(raw.length>1800||/[\\\s\x00-\x1f]/.test(raw))return '';
    const u=new URL(raw);
    if(u.protocol!=='https:'||u.port||u.username||u.password)return '';
    if(feed)return u.href===RSS?u.href:'';
    if(!Object.hasOwn(STORY_RESEARCH_PUBLISHERS,u.hostname))return '';
    if(u.hostname==='www.bbc.com'&&/^\/portuguese(?:\/?$|\/topics(?:\/|$))/.test(u.pathname))return '';
    if(['panelinha.com.br','www.panelinha.com.br'].includes(u.hostname)&&!/^\/receita\/[a-z0-9-]+\/?$/i.test(u.pathname))return '';
    if(['minhasplantas.com.br','www.minhasplantas.com.br','www.embrapa.br','embrapa.br'].includes(u.hostname)&&u.pathname.split('/').filter(Boolean).length<2)return '';
    if(/\.(?:pdf|zip|exe|js|json|mp4|mp3|png|jpe?g|webp)$/i.test(u.pathname))return '';
    u.hash='';return u.href;
  }catch{return '';}
}

async function responseText(response) {
  const type=String(response.headers.get('content-type')||'');
  if(response.status!==200||!/^(?:text\/(?:html|xml)|application\/(?:rss\+xml|xml|xhtml\+xml))(?:;|$)/i.test(type))throw fail('research_response_invalid');
  if(Number(response.headers.get('content-length'))>MAX_BYTES)throw fail('research_too_large');
  let size=0;const chunks=[];
  for await(const chunk of response.body){size+=chunk.length;if(size>MAX_BYTES)throw fail('research_too_large');chunks.push(Buffer.from(chunk));}
  return Buffer.concat(chunks).toString('utf8');
}

// Real requests resolve once, reject all nonpublic answers and connect to that
// exact IPv4 address. No cookies, authorization, redirects, or arbitrary hosts.
export function fetchStoryResearchText(value,{signal,fetchImpl,feed=false}={}) {
  const url=storyResearchUrl(value,{feed});if(!url)return Promise.reject(fail('research_origin_denied'));
  checkSignal(signal);
  const timeoutSignal=AbortSignal.timeout(8000),combined=signal?AbortSignal.any([signal,timeoutSignal]):timeoutSignal;
  if(fetchImpl)return fetchImpl(url,{signal:combined,redirect:'error',credentials:'omit',headers:{accept:feed?'application/rss+xml,application/xml,text/xml':'text/html'}}).then(responseText);
  return new Promise((resolve,reject)=>{
    const request=https.get(url,{agent:false,family:4,signal:combined,headers:{accept:feed?'application/rss+xml,application/xml,text/xml':'text/html','user-agent':'VitrineCity Story Research/1.0'},lookup(host,options,callback){
      lookup(host,{family:4,all:true}).then(addresses=>{
        if(!addresses.length||addresses.some(x=>!publicImageAddress(x.address)))return callback(fail('research_non_public_address'));
        if(options.all)callback(null,[addresses[0]]);else callback(null,addresses[0].address,4);
      },callback);
    }},response=>{
      const type=String(response.headers['content-type']||'');
      if(response.statusCode!==200||!/^(?:text\/(?:html|xml)|application\/(?:rss\+xml|xml|xhtml\+xml))(?:;|$)/i.test(type)||Number(response.headers['content-length'])>MAX_BYTES){response.destroy();reject(fail('research_response_invalid'));return;}
      let size=0;const chunks=[];
      response.on('data',chunk=>{size+=chunk.length;if(size>MAX_BYTES){response.destroy(fail('research_too_large'));return;}chunks.push(chunk);});
      response.on('error',reject);response.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
    });
    request.on('error',()=>reject(fail(combined.aborted?'research_timeout_or_aborted':'research_unavailable')));
  });
}

function linkedData(html){
  const result=[];
  const visit=(value,depth=0)=>{if(depth>3||!value||typeof value!=='object')return;if(Array.isArray(value)){value.slice(0,80).forEach(x=>visit(x,depth+1));return;}result.push(value);if(value['@graph'])visit(value['@graph'],depth+1);};
  for(const match of String(html).matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){if(match[1].length>128*1024)continue;try{visit(JSON.parse(match[1]));}catch{}}
  return result;
}
const hasType=(node,types)=>[node['@type']].flat().some(type=>types.includes(type));
export function extractStoryRecipe(html,url){
  if(!storyResearchUrl(url)||!['panelinha.com.br','www.panelinha.com.br'].includes(new URL(url).hostname))throw fail('research_recipe_origin_denied');
  const recipes=linkedData(html).filter(node=>hasType(node,['Recipe']));if(recipes.length>1)throw fail('research_recipe_incomplete');
  let title='',ingredients=[],steps=[],components;
  if(recipes.length){
    const recipe=recipes[0];title=clean(recipe.name);ingredients=recipe.recipeIngredient;
    if(recipe.url&&storyResearchUrl(recipe.url)!==storyResearchUrl(url))throw fail('research_recipe_incomplete');
    const step=(value,depth=0)=>{if(depth>3)throw fail('research_recipe_incomplete');if(typeof value==='string'&&value.trim()){steps.push(clean(value));return;}if(value&&hasType(value,['HowToStep'])&&typeof value.text==='string'&&value.text.trim())steps.push(clean(value.text));else if(value&&hasType(value,['HowToSection'])&&Array.isArray(value.itemListElement)&&value.itemListElement.length&&value.itemListElement.length<=60)value.itemListElement.forEach(item=>step(item,depth+1));else throw fail('research_recipe_incomplete');};
    if(Array.isArray(recipe.recipeInstructions)&&recipe.recipeInstructions.length<=60)recipe.recipeInstructions.forEach(value=>step(value));else step(recipe.recipeInstructions);
  }else{
    // Panelinha's public recipe pages also use numbered ingredient lists and
    // split preparation lists around ads. Keep every component, in order.
    const text=String(html).replace(/<(script|style|aside|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi,' ');
    title=clean(/<h1\b[^>]*class=["'][^"']*\bheaderRecipeImageH1\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i.exec(text)?.[1]);
    const sections=[...text.matchAll(/<h3\b[^>]*class=["'][^"']*\btDivT\b[^"']*["'][^>]*>[\s\S]*?<\/h3>/gi)],lists=[...text.matchAll(/<ul\b[^>]*\bid=["']?recipe_bk_(\d+)_in(?:["']|(?=\s|>))[^>]*>([\s\S]*?)<\/ul>/gi)];
    if(!title||!sections.length||!lists.length||lists.length>8||sections.filter(section=>/^Para (?:o|a|os|as) /i.test(clean(section[0]))).length!==lists.length||!/<\/html>\s*$/i.test(text))throw fail('research_recipe_incomplete');
    components=[];
    for(let index=0;index<lists.length;index++){
      const list=lists[index];if(Number(list[1])!==index)throw fail('research_recipe_incomplete');
      const heading=sections.filter(section=>section.index<list.index).at(-1),next=sections.find(section=>section.index>list.index);
      if(!heading)throw fail('research_recipe_incomplete');
      const end=next?.index??text.length,body=text.slice(list.index+list[0].length,end),label=clean(heading[0]);
      const partIngredients=[...list[2].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(match=>clean(match[1]));
      const prep=[...body.matchAll(/<ol\b[^>]*class=(?:["'][^"']*\bolStd\b[^"']*["']|olStd(?=\s|>))[^>]*>([\s\S]*?)<\/ol>/gi)],partSteps=[];
      for(const block of prep){const counter=/counter-reset\s*:\s*item\s+(\d+)/i.exec(block[0])?.[1];if(counter===undefined||Number(counter)!==partSteps.length)throw fail('research_recipe_incomplete');partSteps.push(...[...block[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(match=>clean(match[1])));}
      if(!partIngredients.length||!partSteps.length||components.some(part=>part.title===label))throw fail('research_recipe_incomplete');
      components.push({title:label,ingredients:partIngredients,steps:partSteps});
      ingredients.push(...partIngredients.map(value=>label+': '+value));steps.push(...partSteps.map(value=>label+': '+value));
    }
  }
  if(!Array.isArray(ingredients)||!ingredients.length||ingredients.length>80||ingredients.some(x=>typeof x!=='string'||clean(x).length<2||clean(x).length>300)||!steps.length||steps.length>60||steps.some(x=>x.length<20||x.length>2000)||steps.join(' ').length<180||ingredients.join(' ').length+steps.join(' ').length>18000)throw fail('research_recipe_incomplete');
  if(!title||/ignore\s+(?:all\s+|the\s+)?(?:previous|system)\s+instructions|system\s*prompt|ignore\s+(?:as\s+)?instru[cç][oõ]es/i.test(ingredients.join(' ')+' '+steps.join(' ')))throw fail('research_recipe_incomplete');
  return {kind:'recipe',title:title.slice(0,180),ingredients:ingredients.map(clean),steps,...(components?{components}:{})};
}
export function extractStoryResearchArticle(html) {
  const structured=linkedData(html).filter(node=>hasType(node,['Article','NewsArticle','ReportageNewsArticle'])&&typeof node.articleBody==='string'&&node.articleBody.length>=500);
  if(structured.some(node=>node.isAccessibleForFree===false))throw fail('research_access_restricted');
  const stripped=String(html).replace(/<(script|style|noscript|nav|footer|header|aside|form|button|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi,' ');
  const area=/<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(stripped)?.[1]||/<(?:div|section)\b[^>]*itemprop=["']articleBody["'][^>]*>([\s\S]*?)<\/(?:div|section)>/i.exec(stripped)?.[1]||/<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(stripped)?.[1]||structured.length===1&&'<p>'+structured[0].articleBody+'</p>';
  if(!area)throw fail('research_no_article');
  const paragraphs=[...area.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(x=>clean(x[1])).filter(x=>x.length>=45);
  const excerpt=[...new Set(paragraphs)].slice(0,18).join('\n').slice(0,2400);
  if(excerpt.length<500)throw fail('research_insufficient_text');
  if(/ignore\s+(?:all\s+|the\s+)?(?:previous|prior|system)\s+instructions|ignore\s+(?:as\s+)?instru[cç][oõ]es|system\s*prompt|reveal\s+(?:the\s+)?(?:secret|password|token)/i.test(excerpt))throw fail('research_instruction_content');
  const title=clean(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(area)?.[1]||/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(stripped)?.[1]||structured[0]?.headline).slice(0,180);
  if(/em manuten[cç][aã]o|under construction|access denied|verifique.{0,20}humano|captcha|enable javascript/i.test(title))throw fail('research_no_article');
  const dateValue=structured[0]?.datePublished||/<meta\b[^>]*(?:property|name)=["']article:published_time["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1]||/<time\b[^>]*datetime=["']([^"']+)["']/i.exec(area)?.[1];
  const date=dateValue?Date.parse(dateValue):NaN;
  return {title,excerpt,publishedAt:Number.isFinite(date)?new Date(date).toISOString():null};
}

export function parseStoryTrends(xml) {
  if(String(xml).length>MAX_BYTES)throw fail('research_too_large');
  return [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0,30).map(match=>{
    const item=match[1],title=tag(item,'title').slice(0,180),date=Date.parse(tag(item,'pubDate'));
    const publishedAt=Number.isFinite(date)?new Date(date).toISOString():'';
    const refs=[...item.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/g)].slice(0,12).map(m=>{
      const url=storyResearchUrl(tag(m[1],'ht:news_item_url'));
      return url?{title:tag(m[1],'ht:news_item_title').slice(0,180),url,publisher:STORY_RESEARCH_PUBLISHERS[new URL(url).hostname]}:null;
    }).filter(Boolean);
    const {group}=storyTopicCategory(title);
    return {id:hash(title.toLowerCase()+'|'+publishedAt.slice(0,10)).slice(0,24),title,publishedAt,group,refs:[...new Map(refs.map(x=>[x.url,x])).values()].slice(0,8)};
  }).filter(x=>x.title.length>=3&&x.publishedAt);
}

export function createWebStoryResearch({db,fetchImpl,now=Date.now,searchSources=null,canRun=()=>true,requirePreparedEvidence=false}) {
  db.exec(`CREATE TABLE IF NOT EXISTS web_story_trend_topics(id TEXT PRIMARY KEY,title TEXT NOT NULL,topic_group TEXT NOT NULL,published_at TEXT NOT NULL,references_json TEXT NOT NULL,evidence_json TEXT NOT NULL DEFAULT '[]',checked_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_web_story_trend_freshness ON web_story_trend_topics(published_at DESC,id);
    CREATE TABLE IF NOT EXISTS web_story_article_evidence(source_key TEXT NOT NULL,source_fingerprint TEXT NOT NULL,evidence_json TEXT NOT NULL,checked_at TEXT NOT NULL,PRIMARY KEY(source_key,source_fingerprint))`);
  // In-process identity remembers the original adapter object without persisting
  // a duplicate article body or trusting a caller-supplied fingerprint marker.
  const enrichmentOrigins=new WeakMap();
  const checkpoint=(signal,isCurrent=()=>true)=>{checkSignal(signal);if(!canRun()||!isCurrent())throw fail('research_aborted');};
  const row=key=>db.prepare('SELECT * FROM web_story_trend_topics WHERE id=?').get(String(key||'').replace(/^trend:/,''));
  const fresh=checkedAt=>{const age=now()-Date.parse(checkedAt);return Boolean(checkedAt)&&age>=0&&age<=MAX_AGE;};
  const needsArticleEvidence=item=>item?.kind==='article'&&['news','sports','noticias','esportes'].includes(item.group||item.portal);
  const baseArticle=item=>enrichmentOrigins.get(item)||item;
  const articleFingerprint=item=>hash({key:item.key||item.id,title:item.title,summary:item.summary,body:item.body,image_url:item.image_url,portal:item.portal,group:item.group,updated_at:item.updated_at,sourcePath:item.sourcePath,sources:item.sources,facts:item.facts});
  const evidenceReady=(evidence,checkedAt,title)=>fresh(checkedAt)&&new Set(evidence.filter(x=>x&&storyResearchUrl(x.url)&&STORY_RESEARCH_PUBLISHERS[new URL(x.url).hostname]===x.publisher&&x.excerpt?.length>=500&&x.excerptHash===hash(x.excerpt)&&fresh(x.checkedAt)&&storyResearchTopicMatches(title,x)&&(!x.publishedAt||Number.isFinite(Date.parse(x.publishedAt))&&Date.parse(x.publishedAt)<=now()+300000&&Date.parse(x.publishedAt)>=now()-7*MAX_AGE)).map(x=>x.publisher)).size>=2;
  const storedArray=value=>{try{const items=JSON.parse(value);return Array.isArray(items)?items:[];}catch{return [];}};
  const independentReferences=refs=>new Set((Array.isArray(refs)?refs:[]).flatMap(ref=>{const url=storyResearchUrl(ref?.url);return url?[STORY_RESEARCH_PUBLISHERS[new URL(url).hostname]]:[];})).size>=2;
  const topicCanBeResearched=item=>!!item&&(evidenceReady(storedArray(item.evidence_json),item.checked_at,item.title)||!requirePreparedEvidence&&independentReferences(storedArray(item.references_json)));
  const citations=evidence=>evidence.map(({title,url,publisher,checkedAt,excerptHash})=>({title,url,publisher,checkedAt,excerptHash}));
  function getEnriched(input) {
    if(!input||!needsArticleEvidence(input))return input;
    const base=baseArticle(input),fingerprint=articleFingerprint(base),cached=db.prepare('SELECT evidence_json,checked_at FROM web_story_article_evidence WHERE source_key=? AND source_fingerprint=?').get(base.key||base.id,fingerprint);
    let evidence=[];try{evidence=JSON.parse(cached?.evidence_json||'[]');}catch{}
    const ready=evidenceReady(evidence,cached?.checked_at,base.title);
    const enriched=ready?{...base,summary:'Pesquisa de fontes sobre '+base.title,body:evidence.map(x=>x.title+'\n'+x.excerpt).join('\n\n'),sources:citations(evidence),facts:{...base.facts,evidence,editorialTitleIsUnverifiedContext:true},checkedAt:cached.checked_at,evidenceReady:true}:{...base,evidenceReady:false};
    enrichmentOrigins.set(enriched,base);return enriched;
  }
  function source(item) {
    if(!item)return null;
    const evidence=JSON.parse(item.evidence_json),ready=evidenceReady(evidence,item.checked_at,item.title);
    const result={id:'trend:'+item.id,key:'trend:'+item.id,kind:'trend',group:item.topic_group,groups:[item.topic_group],slug:'tendencia-'+item.id,title:item.title,summary:'Pesquisa de fontes sobre '+item.title,body:ready?evidence.map(x=>x.title+'\n'+x.excerpt).join('\n\n'):'',image_url:'',portal:storyEditorialPortal({group:item.topic_group,title:item.title}),updated_at:item.updated_at,sourcePath:'/conteudo',sources:citations(evidence),facts:{topic:item.title,evidence:ready?evidence:[],trendIsInterestOnly:true},commercial:false,evidenceReady:ready,checkedAt:item.checked_at,researchOnly:true};
    result.hash=hash(result);result.sourceHash=result.hash;return result;
  }
  function get(key){return source(row(key));}
  // This is feasibility, not approval: actual fetching, freshness, grounding and
  // independent editorial review still run after a candidate is selected.
  // Trend references come from the persisted feed, never caller-supplied flags.
  function automaticEligible(input){
    if(input?.kind==='trend')return topicCanBeResearched(row(input.key||input.id));
    if(!needsArticleEvidence(input))return true;
    const base=baseArticle(input);
    return getEnriched(base).evidenceReady===true||!requirePreparedEvidence&&independentReferences(base.sources);
  }
  function list({q='',group='all',limit=50,offset=0,automatic=false}={}) {
    if(!['all','news','recipes','sports','trends'].includes(group))return [];
    const take=Math.max(0,Math.min(200,Number.isFinite(Number(limit))?Math.trunc(Number(limit)):50)),skip=Math.max(0,Number.isSafeInteger(Number(offset))?Number(offset):0);
    if(!take)return [];
    const terms=normalize(String(q).slice(0,200)).split(' ').filter(Boolean).slice(0,12);
    return db.prepare("SELECT * FROM web_story_trend_topics WHERE published_at>=? AND (?='all' OR topic_group=?) ORDER BY published_at DESC,checked_at DESC,id ASC").all(new Date(now()-7*MAX_AGE).toISOString(),group,group)
      .filter(x=>terms.every(t=>normalize(x.title+' '+x.topic_group+' '+x.references_json).includes(t))&&(!automatic||topicCanBeResearched(x))).slice(skip,skip+take).map(source);
  }
  async function syncTrends({signal,isCurrent=()=>true}={}) {
    checkpoint(signal,isCurrent);const xml=await fetchStoryResearchText(RSS,{signal,fetchImpl,feed:true}),topics=parseStoryTrends(xml),timestamp=new Date(now()).toISOString();checkpoint(signal,isCurrent);
    const save=db.prepare(`INSERT INTO web_story_trend_topics(id,title,topic_group,published_at,references_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,topic_group=excluded.topic_group,published_at=excluded.published_at,references_json=excluded.references_json,evidence_json=CASE WHEN references_json<>excluded.references_json THEN '[]' ELSE evidence_json END,checked_at=CASE WHEN references_json<>excluded.references_json THEN NULL ELSE checked_at END,updated_at=CASE WHEN references_json<>excluded.references_json THEN excluded.updated_at ELSE updated_at END`);
    db.transaction(()=>{checkpoint(signal,isCurrent);for(const t of topics)save.run(t.id,t.title,t.group,t.publishedAt,JSON.stringify(t.refs),timestamp,timestamp);})();
    return {count:topics.length,eligibleSourceLinks:topics.reduce((n,t)=>n+t.refs.length,0)};
  }
  async function collectEvidence(title,refs,signal,{isCurrent=()=>true,fallback=false}={}) {
    const evidence=[],seen=new Set(),tried=new Set();let attempts=0;
    async function collect(rows,max){for(const ref of rows){if(attempts>=max||evidence.length>=2)break;if(seen.has(ref.publisher)||tried.has(ref.url))continue;attempts++;tried.add(ref.url);checkpoint(signal,isCurrent);
      try {
        const html=await fetchStoryResearchText(ref.url,{signal,fetchImpl}),article=extractStoryResearchArticle(html);checkpoint(signal,isCurrent);
        if(article.publishedAt&&(Date.parse(article.publishedAt)>now()+300000||Date.parse(article.publishedAt)<now()-7*MAX_AGE))continue;
        if(!storyResearchTopicMatches(title,article))continue;
        seen.add(ref.publisher);evidence.push({title:article.title||ref.title,url:ref.url,publisher:ref.publisher,excerpt:article.excerpt,excerptHash:hash(article.excerpt),publishedAt:article.publishedAt,checkedAt:new Date(now()).toISOString()});
      }catch {checkpoint(signal,isCurrent);}
    }}
    await collect(refs,3);
    if(fallback&&evidence.length<2&&typeof searchSources==='function'){
      checkpoint(signal,isCurrent);
      try{const results=await searchSources({query:clean(title).slice(0,180),signal});checkpoint(signal,isCurrent);
        const alternatives=(Array.isArray(results)?results:[]).slice(0,8).flatMap(item=>{const url=storyResearchUrl(item?.url);return url?[{url,title:clean(item.title).slice(0,180),publisher:STORY_RESEARCH_PUBLISHERS[new URL(url).hostname]}]:[];});
        await collect(alternatives,6);
      }catch{checkpoint(signal,isCurrent);}
    }
    checkpoint(signal,isCurrent);return evidence;
  }
  async function enrich(input,{signal,isCurrent=()=>true,fallback=false}={}) {
    checkpoint(signal,isCurrent);
    if(needsArticleEvidence(input)) {
      const base=baseArticle(input),current=getEnriched(base);if(current.evidenceReady)return current;
      const fingerprint=articleFingerprint(base),key=base.key||base.id;
      if(typeof key!=='string'||!key||key.length>300)throw fail('research_article_key_invalid');
      const refs=[...new Map((Array.isArray(base.sources)?base.sources:[]).map(item=>{const url=storyResearchUrl(item?.url);return url?[url,{title:clean(item.title).slice(0,180),url,publisher:STORY_RESEARCH_PUBLISHERS[new URL(url).hostname]}]:null;}).filter(Boolean)).values()];
      const evidence=await collectEvidence(base.title,refs,signal,{isCurrent,fallback});checkpoint(signal,isCurrent);
      if(articleFingerprint(base)!==fingerprint)throw fail('research_source_changed');
      db.prepare(`INSERT INTO web_story_article_evidence(source_key,source_fingerprint,evidence_json,checked_at) VALUES(?,?,?,?) ON CONFLICT(source_key,source_fingerprint) DO UPDATE SET evidence_json=excluded.evidence_json,checked_at=excluded.checked_at`).run(key,fingerprint,JSON.stringify(evidence),new Date(now()).toISOString());
      return getEnriched(base);
    }
    const key=typeof input==='string'?input:input?.key||input?.id,original=row(key);if(!original)throw fail('research_topic_missing');
    const current=source(original);if(current.evidenceReady)return current;
    const evidence=await collectEvidence(original.title,JSON.parse(original.references_json),signal,{isCurrent,fallback});
    checkpoint(signal,isCurrent);const latest=row(key);if(!latest||latest.references_json!==original.references_json||latest.title!==original.title||latest.published_at!==original.published_at)throw fail('research_source_changed');
    const timestamp=new Date(now()).toISOString();
    db.prepare('UPDATE web_story_trend_topics SET evidence_json=?,checked_at=?,updated_at=? WHERE id=?').run(JSON.stringify(evidence),timestamp,timestamp,original.id);
    return get(key);
  }
  function addDiscoveredTopic(topic,{isCurrent=()=>true}={}){
    checkpoint(null,isCurrent);if(!/^channel-[A-Za-z0-9_-]{11}$/.test(topic?.id)||topic.group!=='news'||!clean(topic.title)||!Number.isFinite(Date.parse(topic.publishedAt))||Date.parse(topic.publishedAt)>now()+300000)return false;
    const refs=(topic.refs||[]).flatMap(ref=>{const url=storyResearchUrl(ref.url);return url?[{url,title:clean(ref.title).slice(0,180),publisher:STORY_RESEARCH_PUBLISHERS[new URL(url).hostname]}]:[];}).slice(0,5),stamp=new Date(now()).toISOString();
    db.prepare(`INSERT INTO web_story_trend_topics(id,title,topic_group,published_at,references_json,created_at,updated_at) VALUES(?,?,'news',?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,references_json=excluded.references_json,evidence_json=CASE WHEN title<>excluded.title OR references_json<>excluded.references_json THEN '[]' ELSE evidence_json END,checked_at=CASE WHEN title<>excluded.title OR references_json<>excluded.references_json THEN NULL ELSE checked_at END,updated_at=CASE WHEN title<>excluded.title OR references_json<>excluded.references_json THEN excluded.updated_at ELSE updated_at END`).run(topic.id,clean(topic.title).slice(0,180),topic.publishedAt,JSON.stringify(refs),stamp,stamp);return true;
  }
  async function prepareCandidates({signal,isCurrent=()=>true,limit=3}={}){
    checkpoint(signal,isCurrent);const candidates=db.prepare('SELECT * FROM web_story_trend_topics WHERE published_at>=? AND (checked_at IS NULL OR checked_at<=?) ORDER BY COALESCE(checked_at,\'\'),published_at DESC,id LIMIT ?').all(new Date(now()-7*MAX_AGE).toISOString(),new Date(now()-3600000).toISOString(),Math.max(1,Math.min(3,limit)));
    let checked=0,ready=0;
    for(const candidate of candidates){checkpoint(signal,isCurrent);if(source(candidate).evidenceReady)continue;
      const claimed=db.prepare('UPDATE web_story_trend_topics SET checked_at=? WHERE id=? AND COALESCE(checked_at,\'\')=?').run(new Date(now()).toISOString(),candidate.id,candidate.checked_at||'').changes;if(!claimed)continue;
      checked++;const result=await enrich('trend:'+candidate.id,{signal,isCurrent,fallback:true});if(result.evidenceReady)ready++;
    }
    return {checked,ready};
  }
  async function findGardeningSource(title,{signal,isCurrent=()=>true}={}){
    checkpoint(signal,isCurrent);if(typeof searchSources!=='function')return null;
    const results=await searchSources({query:clean(title).slice(0,160)+' site:embrapa.br',signal});checkpoint(signal,isCurrent);
    for(const item of (Array.isArray(results)?results:[]).slice(0,3)){
      const url=storyResearchUrl(item?.url);if(!url||STORY_RESEARCH_PUBLISHERS[new URL(url).hostname]!=='embrapa')continue;
      try{const html=await fetchStoryResearchText(url,{signal,fetchImpl});checkpoint(signal,isCurrent);const article=extractStoryResearchArticle(html);if(!storyResearchTopicMatches(title,article))continue;return {kind:'article',title:article.title,text:article.excerpt,sourceUrl:url,publishedAt:article.publishedAt,checkedAt:new Date(now()).toISOString(),excerptOnly:true};}catch{checkpoint(signal,isCurrent);}
    }
    return null;
  }
  return {syncTrends,list,get,enrich,getEnriched,automaticEligible,addDiscoveredTopic,prepareCandidates,findGardeningSource};
}
