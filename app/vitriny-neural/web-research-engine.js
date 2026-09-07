import {createHash,randomUUID} from 'node:crypto';

const DEFAULT_ENGINES=['google','bing','duckduckgo','brave','qwant','startpage','mojeek','wikipedia'];
const SOCIAL_HOSTS=new Set(['instagram.com','www.instagram.com','tiktok.com','www.tiktok.com','kwai.com','www.kwai.com','reddit.com','www.reddit.com']);
const SOCIAL_DOMAINS=['instagram.com','tiktok.com','kwai.com','reddit.com'];
const SEARCH_ENGINE_IDS=new Set([...DEFAULT_ENGINES,'yahoo','youtube']);

function truthy(value){return ['1','true','yes','on'].includes(String(value??'').trim().toLowerCase());}
function clamp(value,min=0,max=1){return Math.max(min,Math.min(max,Number(value)||0));}
function safeText(value,max=500,min=0){const v=String(value??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();if(v.length<min)return'';return v.slice(0,max);}
function safeUrl(value){
  try{const u=new URL(String(value||''));if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return'';if(!u.hostname.includes('.'))return'';if(/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u.hostname))return'';u.hash='';for(const key of [...u.searchParams.keys()])if(/^utm_|^(gclid|fbclid)$/i.test(key))u.searchParams.delete(key);return u.href;}catch{return'';}
}
function hostOf(url){try{return new URL(url).hostname.toLowerCase();}catch{return'';}}
function sourceType(host){
  if(!host)return'unknown';
  if(host.endsWith('.gov.br')||host.endsWith('.gov')||host.endsWith('.edu')||host.endsWith('.edu.br'))return'official';
  if(host==='github.com'||host.endsWith('.github.com')||host.startsWith('docs.')||host.startsWith('developer.')||host.startsWith('developers.'))return'technical';
  if(SOCIAL_HOSTS.has(host)||[...SOCIAL_HOSTS].some(x=>host.endsWith('.'+x)))return'social';
  if(host.includes('wikipedia.org'))return'encyclopedia';
  return'web';
}
export function scoreResearchSource({url,providers=[],title='',description=''}={}){
  const host=hostOf(url),type=sourceType(host),providerCount=new Set(providers).size;
  let authority=type==='official'?.96:type==='technical'?.88:type==='encyclopedia'?.76:type==='social'?.48:.62;
  if(host.endsWith('openai.com')||host.endsWith('anthropic.com')||host.endsWith('google.com')||host.endsWith('microsoft.com')||host.endsWith('meta.com'))authority=Math.max(authority,.9);
  const corroboration=clamp(providerCount/4);
  const substance=clamp((safeText(title,200).length+safeText(description,700).length)/500);
  const score=clamp(authority*.62+corroboration*.23+substance*.15);
  return{score,authority,corroboration,substance,type,host};
}
function configuredEngines(env){return [...new Set(String(env.SEARCH_ENGINES||DEFAULT_ENGINES.join(',')).split(',').map(x=>x.trim()).filter(x=>SEARCH_ENGINE_IDS.has(x)))].slice(0,10);}
function configuredTopics(env){
  const raw=String(env.VITRINY_NEURAL_RESEARCH_TOPICS||'inteligência artificial para negócios,SEO técnico e indexação,marketplace e comércio eletrônico,marketing digital e aquisição de clientes,programação web e arquitetura de software').split(',').map(x=>safeText(x,140,3)).filter(Boolean);
  return [...new Set(raw)].slice(0,20);
}
function configuredSocialDomains(env){
  const requested=String(env.VITRINY_NEURAL_SOCIAL_DOMAINS||SOCIAL_DOMAINS.join(',')).split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  return [...new Set(requested.filter(x=>SOCIAL_DOMAINS.includes(x)))];
}
function makeConfig(env){
  const intervalMs=Math.max(10*60*1000,Math.min(24*60*60*1000,Number(env.VITRINY_NEURAL_WEB_RESEARCH_INTERVAL_MS)||60*60*1000));
  return{
    enabled:truthy(env.VITRINY_NEURAL_WEB_RESEARCH_ENABLED),
    intervalMs,
    dailyRuns:Math.max(1,Math.min(144,Number(env.VITRINY_NEURAL_WEB_RESEARCH_DAILY_RUNS)||Math.min(144,Math.ceil(24*60*60*1000/intervalMs)))),
    maxResults:Math.max(5,Math.min(40,Number(env.VITRINY_NEURAL_WEB_RESEARCH_MAX_RESULTS)||20)),
    candidateThreshold:Math.max(.5,Math.min(.98,Number(env.VITRINY_NEURAL_RESEARCH_CANDIDATE_SCORE)||.72)),
    socialEnabled:truthy(env.VITRINY_NEURAL_SOCIAL_RESEARCH_ENABLED??'1'),
    socialDomains:configuredSocialDomains(env),
    topics:configuredTopics(env),engines:configuredEngines(env)
  };
}

export function createNeuralWebResearchEngine({db,neural=null,env=process.env,fetchImpl=globalThis.fetch,now=Date.now,logger=console}={}){
  if(!db?.prepare||!db?.exec)throw new TypeError('Web Research requer SQLite.');
  if(typeof fetchImpl!=='function')throw new TypeError('Web Research requer fetch.');
  const config=makeConfig(env);let base=null;try{const u=new URL(String(env.SEARXNG_URL||''));if(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password)base=u;}catch{}
  db.exec(`CREATE TABLE IF NOT EXISTS neural_research_runs(
    id TEXT PRIMARY KEY,topic TEXT NOT NULL,status TEXT NOT NULL,query TEXT NOT NULL,results INTEGER NOT NULL DEFAULT 0,candidates INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '',started_at TEXT NOT NULL,completed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS neural_research_sources(
    fingerprint TEXT PRIMARY KEY,url TEXT NOT NULL,title TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '',host TEXT NOT NULL DEFAULT '',source_type TEXT NOT NULL DEFAULT 'web',score REAL NOT NULL DEFAULT 0,providers_json TEXT NOT NULL DEFAULT '[]',first_seen_at TEXT NOT NULL,last_seen_at TEXT NOT NULL,seen_count INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS neural_knowledge_candidates(
    id TEXT PRIMARY KEY,topic TEXT NOT NULL,query TEXT NOT NULL,source_fingerprint TEXT NOT NULL REFERENCES neural_research_sources(fingerprint),claim TEXT NOT NULL,score REAL NOT NULL,status TEXT NOT NULL DEFAULT 'candidate',created_at TEXT NOT NULL,reviewed_at TEXT,review_note TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_neural_research_runs_started ON neural_research_runs(started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_neural_candidates_status_score ON neural_knowledge_candidates(status,score DESC,created_at DESC);`);
  let timer=null,running=false,topicIndex=0;
  const stamp=()=>new Date(Number(now())).toISOString();
  function dayKey(){return stamp().slice(0,10);}
  function runsToday(){return Number(db.prepare("SELECT COUNT(*) n FROM neural_research_runs WHERE substr(started_at,1,10)=?").get(dayKey())?.n||0);}
  async function search(query){
    if(!base)throw new Error('searxng_unconfigured');
    const url=new URL('/search',base);url.search=new URLSearchParams({q:query,format:'json',language:'pt-BR',engines:config.engines.join(','),categories:'general',pageno:'1',safesearch:'1'}).toString();
    const response=await fetchImpl(url,{redirect:'error',headers:{accept:'application/json','x-requested-with':'Vitriny-Neural'},signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error(`searxng_${response.status}`);
    const text=await response.text();if(Buffer.byteLength(text,'utf8')>2_000_000)throw new Error('search_response_too_large');
    const data=JSON.parse(text);return Array.isArray(data.results)?data.results.slice(0,config.maxResults):[];
  }
  function socialQuery(query){
    if(!config.socialEnabled||!config.socialDomains.length)return'';
    return `${query} (${config.socialDomains.map(domain=>`site:${domain}`).join(' OR ')})`;
  }
  async function collect(query){
    const batches=[await search(query)];
    const social=socialQuery(query);
    if(social)batches.push(await search(social));
    const seen=new Set(),merged=[];
    for(const raw of batches.flat()){
      const url=safeUrl(raw?.url);if(!url||seen.has(url))continue;seen.add(url);merged.push(raw);
      if(merged.length>=config.maxResults*2)break;
    }
    return merged;
  }
  function saveSource(raw,at){
    const url=safeUrl(raw.url);if(!url)return null;
    const providers=[...new Set([...(Array.isArray(raw.engines)?raw.engines:[]),raw.engine].filter(x=>config.engines.includes(x)))];
    const title=safeText(raw.title,220),description=safeText(raw.content,900),rating=scoreResearchSource({url,providers,title,description});
    const fingerprint=createHash('sha256').update(url).digest('hex');
    db.prepare(`INSERT INTO neural_research_sources(fingerprint,url,title,description,host,source_type,score,providers_json,first_seen_at,last_seen_at,seen_count)
      VALUES(?,?,?,?,?,?,?,?,?,?,1)
      ON CONFLICT(fingerprint) DO UPDATE SET title=excluded.title,description=excluded.description,host=excluded.host,source_type=excluded.source_type,score=MAX(neural_research_sources.score,excluded.score),providers_json=excluded.providers_json,last_seen_at=excluded.last_seen_at,seen_count=neural_research_sources.seen_count+1`)
      .run(fingerprint,url,title,description,rating.host,rating.type,rating.score,JSON.stringify(providers),at,at);
    return{fingerprint,url,title,description,providers,...rating};
  }
  function maybeCandidate(topic,query,source,at){
    if(!source||source.score<config.candidateThreshold||source.description.length<60)return null;
    const existing=db.prepare('SELECT id FROM neural_knowledge_candidates WHERE source_fingerprint=? AND query=? LIMIT 1').get(source.fingerprint,query);if(existing)return null;
    const claim=safeText(`${source.title}: ${source.description}`,1100,20);if(!claim)return null;
    const id=randomUUID();db.prepare('INSERT INTO neural_knowledge_candidates(id,topic,query,source_fingerprint,claim,score,status,created_at) VALUES(?,?,?,?,?,?,\'candidate\',?)').run(id,topic,query,source.fingerprint,claim,source.score,at);
    try{neural?.signal?.({metric:'research.candidate.score',dimension:topic,value:source.score,confidence:source.score,metadata:{sourceType:source.type,host:source.host,providers:source.providers.length},createdAt:at});}catch{}
    return{id,score:source.score};
  }
  async function run({topic=null,query=null,actor='scheduler'}={}){
    if(running)throw new Error('research_already_running');
    if(!base)throw new Error('searxng_unconfigured');
    if(runsToday()>=config.dailyRuns)throw new Error('research_daily_limit');
    const selected=safeText(topic||config.topics[topicIndex++%Math.max(1,config.topics.length)]||'',140,3);if(!selected)throw new Error('research_topic_missing');
    const q=safeText(query||`${selected} melhores práticas evidências documentação oficial tendências 2026`,300,3);
    const id=randomUUID(),started=stamp();db.prepare('INSERT INTO neural_research_runs(id,topic,status,query,started_at) VALUES(?,?,\'running\',?,?)').run(id,selected,q,started);running=true;
    try{
      const raw=await collect(q),sources=[];let candidates=0;
      for(const item of raw){const source=saveSource(item,stamp());if(!source)continue;sources.push(source);if(maybeCandidate(selected,q,source,stamp()))candidates++;}
      db.prepare("UPDATE neural_research_runs SET status='completed',results=?,candidates=?,completed_at=? WHERE id=?").run(sources.length,candidates,stamp(),id);
      try{neural?.signal?.({metric:'research.run.candidates',dimension:selected,value:candidates,confidence:sources.length?Math.min(1,candidates/sources.length):0,metadata:{results:sources.length,actor,socialEnabled:config.socialEnabled},createdAt:stamp()});}catch{}
      return{id,status:'completed',topic:selected,query:q,results:sources.length,candidates,topSources:sources.sort((a,b)=>b.score-a.score).slice(0,5).map(x=>({url:x.url,title:x.title,score:x.score,type:x.type,providers:x.providers}))};
    }catch(error){db.prepare("UPDATE neural_research_runs SET status='failed',error=?,completed_at=? WHERE id=?").run(String(error?.message||'research_failed').slice(0,300),stamp(),id);throw error;}
    finally{running=false;}
  }
  function listCandidates({status='candidate',limit=50}={}){const n=Math.max(1,Math.min(200,Number(limit)||50));return db.prepare(`SELECT c.*,s.url,s.title,s.host,s.source_type,s.providers_json FROM neural_knowledge_candidates c JOIN neural_research_sources s ON s.fingerprint=c.source_fingerprint WHERE c.status=? ORDER BY c.score DESC,c.created_at DESC LIMIT ?`).all(String(status),n).map(row=>({...row,providers:JSON.parse(row.providers_json||'[]')}));}
  function reviewCandidate(id,{status,note=''}={}){if(!['approved','rejected','candidate'].includes(status))throw new Error('candidate_status_invalid');const at=stamp();const info=db.prepare('UPDATE neural_knowledge_candidates SET status=?,reviewed_at=?,review_note=? WHERE id=?').run(status,status==='candidate'?null:at,safeText(note,500),String(id));if(!info.changes)throw new Error('candidate_not_found');return db.prepare('SELECT * FROM neural_knowledge_candidates WHERE id=?').get(String(id));}
  function status(){const last=db.prepare('SELECT * FROM neural_research_runs ORDER BY started_at DESC LIMIT 1').get()||null;return{enabled:config.enabled,configured:Boolean(base),running,intervalMs:config.intervalMs,dailyRuns:config.dailyRuns,runsToday:runsToday(),topics:config.topics,engines:config.engines,candidateThreshold:config.candidateThreshold,socialEnabled:config.socialEnabled,socialDomains:config.socialDomains,pendingCandidates:Number(db.prepare("SELECT COUNT(*) n FROM neural_knowledge_candidates WHERE status='candidate'").get()?.n||0),approvedCandidates:Number(db.prepare("SELECT COUNT(*) n FROM neural_knowledge_candidates WHERE status='approved'").get()?.n||0),last};}
  function schedule(){if(timer||!config.enabled)return false;const tick=async()=>{try{await run();}catch(error){if(!['research_daily_limit','searxng_unconfigured'].includes(error?.message))logger?.warn?.('[vitriny-neural] web research',String(error?.message||error));}finally{timer=setTimeout(tick,config.intervalMs);timer.unref?.();}};timer=setTimeout(tick,5000);timer.unref?.();return true;}
  function stop(){if(timer){clearTimeout(timer);timer=null;}return true;}
  return{config,run,status,listCandidates,reviewCandidate,schedule,stop,scoreSource:scoreResearchSource};
}
