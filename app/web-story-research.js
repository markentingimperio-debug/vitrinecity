import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {createHash} from 'node:crypto';
import {publicImageAddress} from './catalog-product-images.js';

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
  'www.realmadrid.com':'realmadrid'
});
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const fail=code=>Object.assign(Error(code),{code});
const clean=value=>String(value||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
  .replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const v=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return v>0&&v<=0x10ffff?String.fromCodePoint(v):'';})
  .replace(/&(amp|quot|apos|lt|gt|nbsp);/g,(_,n)=>({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}[n]))
  .replace(/<[^>]*>/g,' ').replace(/[\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim();
const tag=(xml,name)=>clean(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>','i').exec(xml)?.[1]);
const normalize=value=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const checkSignal=signal=>{if(signal?.aborted)throw fail('research_aborted');};

export function storyResearchUrl(value,{feed=false}={}) {
  try {
    const raw=String(value||'');if(raw.length>1800||/[\\\s\x00-\x1f]/.test(raw))return '';
    const u=new URL(raw);
    if(u.protocol!=='https:'||u.port||u.username||u.password)return '';
    if(feed)return u.href===RSS?u.href:'';
    if(!Object.hasOwn(STORY_RESEARCH_PUBLISHERS,u.hostname))return '';
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

export function extractStoryResearchArticle(html) {
  const stripped=String(html).replace(/<(script|style|noscript|nav|footer|header|aside|form|button|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi,' ');
  const area=/<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(stripped)?.[1]||/<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(stripped)?.[1];
  if(!area)throw fail('research_no_article');
  const paragraphs=[...area.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(x=>clean(x[1])).filter(x=>x.length>=45);
  const excerpt=[...new Set(paragraphs)].slice(0,18).join('\n').slice(0,2400);
  if(excerpt.length<500)throw fail('research_insufficient_text');
  if(/ignore\s+(?:all\s+|the\s+)?(?:previous|prior|system)\s+instructions|ignore\s+(?:as\s+)?instru[cç][oõ]es|system\s*prompt|reveal\s+(?:the\s+)?(?:secret|password|token)/i.test(excerpt))throw fail('research_instruction_content');
  return {title:clean(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(area)?.[1]||/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(stripped)?.[1]).slice(0,180),excerpt};
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
    const n=normalize(title),group=/futebol|flamengo|vasco|corinthians|palmeiras|atletico|cruzeiro|santos|botafogo|gremio|real madrid|liga|campeonato|jogo|esporte|tenis|formula|copa/.test(n)?'sports':/receita|cozinha|planta|jardim|tecnologia|inteligencia artificial/.test(n)?'trends':'news';
    return {id:hash(title.toLowerCase()+'|'+publishedAt.slice(0,10)).slice(0,24),title,publishedAt,group,refs:[...new Map(refs.map(x=>[x.url,x])).values()].slice(0,8)};
  }).filter(x=>x.title.length>=3&&x.publishedAt);
}

export function createWebStoryResearch({db,fetchImpl,now=Date.now}) {
  db.exec(`CREATE TABLE IF NOT EXISTS web_story_trend_topics(id TEXT PRIMARY KEY,title TEXT NOT NULL,topic_group TEXT NOT NULL,published_at TEXT NOT NULL,references_json TEXT NOT NULL,evidence_json TEXT NOT NULL DEFAULT '[]',checked_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_web_story_trend_freshness ON web_story_trend_topics(published_at DESC,id);
    CREATE TABLE IF NOT EXISTS web_story_article_evidence(source_key TEXT NOT NULL,source_fingerprint TEXT NOT NULL,evidence_json TEXT NOT NULL,checked_at TEXT NOT NULL,PRIMARY KEY(source_key,source_fingerprint))`);
  // In-process identity remembers the original adapter object without persisting
  // a duplicate article body or trusting a caller-supplied fingerprint marker.
  const enrichmentOrigins=new WeakMap();
  const row=key=>db.prepare('SELECT * FROM web_story_trend_topics WHERE id=?').get(String(key||'').replace(/^trend:/,''));
  const fresh=checkedAt=>{const age=now()-Date.parse(checkedAt);return Boolean(checkedAt)&&age>=0&&age<=MAX_AGE;};
  const needsArticleEvidence=item=>item?.kind==='article'&&['news','sports','noticias','esportes'].includes(item.group||item.portal);
  const baseArticle=item=>enrichmentOrigins.get(item)||item;
  const articleFingerprint=item=>hash({key:item.key||item.id,title:item.title,summary:item.summary,body:item.body,image_url:item.image_url,portal:item.portal,group:item.group,updated_at:item.updated_at,sourcePath:item.sourcePath,sources:item.sources,facts:item.facts});
  const evidenceReady=(evidence,checkedAt)=>fresh(checkedAt)&&new Set(evidence.filter(x=>x&&storyResearchUrl(x.url)&&STORY_RESEARCH_PUBLISHERS[new URL(x.url).hostname]===x.publisher&&x.excerpt?.length>=500&&x.excerptHash===hash(x.excerpt)&&fresh(x.checkedAt)).map(x=>x.publisher)).size>=2;
  const storedArray=value=>{try{const items=JSON.parse(value);return Array.isArray(items)?items:[];}catch{return [];}};
  const independentReferences=refs=>new Set((Array.isArray(refs)?refs:[]).flatMap(ref=>{const url=storyResearchUrl(ref?.url);return url?[STORY_RESEARCH_PUBLISHERS[new URL(url).hostname]]:[];})).size>=2;
  const topicCanBeResearched=item=>!!item&&(evidenceReady(storedArray(item.evidence_json),item.checked_at)||independentReferences(storedArray(item.references_json)));
  const citations=evidence=>evidence.map(({title,url,publisher,checkedAt,excerptHash})=>({title,url,publisher,checkedAt,excerptHash}));
  function getEnriched(input) {
    if(!input||!needsArticleEvidence(input))return input;
    const base=baseArticle(input),fingerprint=articleFingerprint(base),cached=db.prepare('SELECT evidence_json,checked_at FROM web_story_article_evidence WHERE source_key=? AND source_fingerprint=?').get(base.key||base.id,fingerprint);
    let evidence=[];try{evidence=JSON.parse(cached?.evidence_json||'[]');}catch{}
    const ready=evidenceReady(evidence,cached?.checked_at);
    const enriched=ready?{...base,summary:'Pesquisa de fontes sobre '+base.title,body:evidence.map(x=>x.title+'\n'+x.excerpt).join('\n\n'),sources:citations(evidence),facts:{...base.facts,evidence,editorialTitleIsUnverifiedContext:true},checkedAt:cached.checked_at,evidenceReady:true}:{...base,evidenceReady:false};
    enrichmentOrigins.set(enriched,base);return enriched;
  }
  function source(item) {
    if(!item)return null;
    const evidence=JSON.parse(item.evidence_json),ready=evidenceReady(evidence,item.checked_at);
    const result={id:'trend:'+item.id,key:'trend:'+item.id,kind:'trend',group:item.topic_group,groups:[item.topic_group],slug:'tendencia-'+item.id,title:item.title,summary:'Pesquisa de fontes sobre '+item.title,body:ready?evidence.map(x=>x.title+'\n'+x.excerpt).join('\n\n'):'',image_url:'',portal:item.topic_group==='sports'?'esportes':'noticias',updated_at:item.updated_at,sourcePath:'/conteudo',sources:citations(evidence),facts:{topic:item.title,evidence:ready?evidence:[],trendIsInterestOnly:true},commercial:false,evidenceReady:ready,checkedAt:item.checked_at,researchOnly:true};
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
    return getEnriched(base).evidenceReady===true||independentReferences(base.sources);
  }
  function list({q='',group='all',limit=50,offset=0,automatic=false}={}) {
    if(!['all','news','sports','trends'].includes(group))return [];
    const take=Math.max(0,Math.min(200,Number.isFinite(Number(limit))?Math.trunc(Number(limit)):50)),skip=Math.max(0,Number.isSafeInteger(Number(offset))?Number(offset):0);
    if(!take)return [];
    const terms=normalize(String(q).slice(0,200)).split(' ').filter(Boolean).slice(0,12);
    return db.prepare("SELECT * FROM web_story_trend_topics WHERE published_at>=? AND (?='all' OR topic_group=?) ORDER BY published_at DESC,checked_at DESC,id ASC").all(new Date(now()-7*MAX_AGE).toISOString(),group,group)
      .filter(x=>terms.every(t=>normalize(x.title+' '+x.topic_group+' '+x.references_json).includes(t))&&(!automatic||topicCanBeResearched(x))).slice(skip,skip+take).map(source);
  }
  async function syncTrends({signal}={}) {
    const xml=await fetchStoryResearchText(RSS,{signal,fetchImpl,feed:true}),topics=parseStoryTrends(xml),timestamp=new Date(now()).toISOString();checkSignal(signal);
    const save=db.prepare(`INSERT INTO web_story_trend_topics(id,title,topic_group,published_at,references_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,topic_group=excluded.topic_group,published_at=excluded.published_at,references_json=excluded.references_json,evidence_json=CASE WHEN references_json<>excluded.references_json THEN '[]' ELSE evidence_json END,checked_at=CASE WHEN references_json<>excluded.references_json THEN NULL ELSE checked_at END,updated_at=CASE WHEN references_json<>excluded.references_json THEN excluded.updated_at ELSE updated_at END`);
    db.transaction(()=>{for(const t of topics)save.run(t.id,t.title,t.group,t.publishedAt,JSON.stringify(t.refs),timestamp,timestamp);})();
    return {count:topics.length,eligibleSourceLinks:topics.reduce((n,t)=>n+t.refs.length,0)};
  }
  async function collectEvidence(title,refs,signal) {
    const evidence=[],seen=new Set();let attempts=0;
    for(const ref of refs){if(attempts>=3||evidence.length>=2)break;if(seen.has(ref.publisher))continue;attempts++;checkSignal(signal);
      try {
        const html=await fetchStoryResearchText(ref.url,{signal,fetchImpl}),article=extractStoryResearchArticle(html);
        const terms=normalize(title).split(/\W+/).filter(x=>x.length>=4),haystack=normalize(article.title+' '+article.excerpt);
        if(terms.length&&!terms.some(t=>haystack.includes(t)))continue;
        seen.add(ref.publisher);evidence.push({title:article.title||ref.title,url:ref.url,publisher:ref.publisher,excerpt:article.excerpt,excerptHash:hash(article.excerpt),checkedAt:new Date(now()).toISOString()});
      }catch {checkSignal(signal);}
    }
    checkSignal(signal);return evidence;
  }
  async function enrich(input,{signal}={}) {
    checkSignal(signal);
    if(needsArticleEvidence(input)) {
      const base=baseArticle(input),current=getEnriched(base);if(current.evidenceReady)return current;
      const fingerprint=articleFingerprint(base),key=base.key||base.id;
      if(typeof key!=='string'||!key||key.length>300)throw fail('research_article_key_invalid');
      const refs=[...new Map((Array.isArray(base.sources)?base.sources:[]).map(item=>{const url=storyResearchUrl(item?.url);return url?[url,{title:clean(item.title).slice(0,180),url,publisher:STORY_RESEARCH_PUBLISHERS[new URL(url).hostname]}]:null;}).filter(Boolean)).values()];
      const evidence=await collectEvidence(base.title,refs,signal);
      if(articleFingerprint(base)!==fingerprint)throw fail('research_source_changed');
      db.prepare(`INSERT INTO web_story_article_evidence(source_key,source_fingerprint,evidence_json,checked_at) VALUES(?,?,?,?) ON CONFLICT(source_key,source_fingerprint) DO UPDATE SET evidence_json=excluded.evidence_json,checked_at=excluded.checked_at`).run(key,fingerprint,JSON.stringify(evidence),new Date(now()).toISOString());
      return getEnriched(base);
    }
    const key=typeof input==='string'?input:input?.key||input?.id,original=row(key);if(!original)throw fail('research_topic_missing');
    const current=source(original);if(current.evidenceReady)return current;
    const evidence=await collectEvidence(original.title,JSON.parse(original.references_json),signal);
    checkSignal(signal);const latest=row(key);if(!latest||latest.references_json!==original.references_json)throw fail('research_source_changed');
    const timestamp=new Date(now()).toISOString();
    db.prepare('UPDATE web_story_trend_topics SET evidence_json=?,checked_at=?,updated_at=? WHERE id=?').run(JSON.stringify(evidence),timestamp,timestamp,original.id);
    return get(key);
  }
  return {syncTrends,list,get,enrich,getEnriched,automaticEligible};
}
