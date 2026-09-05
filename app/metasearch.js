import { createHash } from 'node:crypto';

export const SEARCH_ENGINES = Object.freeze({
  google: 'Google', bing: 'Bing', duckduckgo: 'DuckDuckGo', yahoo: 'Yahoo', brave: 'Brave',
  qwant: 'Qwant', startpage: 'Startpage', mojeek: 'Mojeek', wikipedia: 'Wikipedia', youtube: 'YouTube'
});
const text = (value, max = 500) => String(value || '').replace(/<[^>]*>/g, '').replace(/&(?:amp|quot|apos|lt|gt|nbsp);/g,
  value => ({'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' '}[value])).trim().slice(0, max);
export function publicResultUrl(value) {
  try {
    const url = new URL(String(value));
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    if (!url.hostname.includes('.') || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname)) return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(gclid|fbclid)$/i.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return ''; }
}
export function normalizeWebResults(data, engines) {
  const results = new Map();
  for (const raw of (Array.isArray(data.results) ? data.results : []).slice(0, 200)) {
    const url = publicResultUrl(raw.url); if (!url) continue;
    const providers = [...new Set([...(Array.isArray(raw.engines) ? raw.engines : []), raw.engine]
      .filter(name => engines.includes(name)))];
    if (!providers.length) continue;
    const existing = results.get(url);
    if (existing) { existing.providers = [...new Set([...existing.providers, ...providers])]; continue; }
    results.set(url, { url, title: text(raw.title, 200) || new URL(url).hostname,
      description: text(raw.content), providers, type: raw.template === 'videos.html' || providers.includes('youtube') ? 'video' : 'web' });
  }
  const suggestions = [...new Set((Array.isArray(data.suggestions) ? data.suggestions : [])
    .filter(value => typeof value === 'string').map(value => text(value, 120)).filter(Boolean))].slice(0, 8);
  const unavailable = [...new Set((Array.isArray(data.unresponsive_engines) ? data.unresponsive_engines : [])
    .map(item => Array.isArray(item) ? item[0] : '').filter(name => engines.includes(name)))];
  return { results: [...results.values()].slice(0, 40), suggestions, unavailable };
}

export function setupMetasearch(app, { env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  let base;
  try {
    base = new URL(env.SEARXNG_URL || '');
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) base = null;
  } catch { base = null; }
  const enabled = [...new Set(String(env.SEARCH_ENGINES || Object.keys(SEARCH_ENGINES).join(','))
    .split(',').map(value => value.trim()).filter(value => SEARCH_ENGINES[value]))];
  const cache = new Map(), pending = new Map(), visitors = new Map();
  function gate(req, res, kind) {
    const time = now();
    for (const [key, value] of visitors) if (value.until <= time) visitors.delete(key);
    // Ephemeral rate keys only; no query or user history is persisted.
    const key = createHash('sha256').update(`${req.ip}|${kind}`).digest('hex');
    const entry = visitors.get(key) || { count: 0, until: time + 60000 };
    if (entry.count >= (kind === 'suggest' ? 60 : 15) || visitors.size >= 5000 && !visitors.has(key)) {
      res.set('Retry-After', '60');res.status(429).json({ status: 'busy', results: [], suggestions: [] });return false;
    }
    entry.count++;visitors.set(key, entry);return true;
  }
  async function getJson(path, params, options = {}) {
    const url = new URL(path, base);url.search = new URLSearchParams(params).toString();
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(options.timeout || 12000),
      redirect: 'error', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', ...options.headers } });
    if (!response.ok) throw new Error('provider_unavailable');
    const reader = response.body.getReader();let size = 0;const chunks = [];
    try {
      while (true) {
        const {done,value} = await reader.read();if(done)break;
        size += value.length;if(size > 2000000) { await reader.cancel();throw new Error('provider_response_too_large'); }
        chunks.push(Buffer.from(value));
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally { reader.releaseLock(); }
  }
  async function cached(key, operation, ttl) {
    for(const [id,entry] of cache)if(entry.until <= now())cache.delete(id);
    if(cache.has(key))return cache.get(key).value;
    if(pending.has(key))return pending.get(key);
    if(pending.size >= 12)throw new Error('busy');
    const promise=operation().then(value=>{
      if(cache.size >= 300)cache.delete(cache.keys().next().value);
      cache.set(key,{value,until:now()+ttl});return value;
    }).finally(()=>pending.delete(key));
    pending.set(key,promise);return promise;
  }
  app.get('/api/search/providers', (_req,res)=>res.json({ configured:Boolean(base),
    providers:enabled.map(id=>({id,name:SEARCH_ENGINES[id],type:id==='youtube'?'video':'web'})) }));
  app.get('/api/search/web', async (req,res)=>{
    res.set('Cache-Control','no-store');
    const query=text(req.query.q,300),kind=['all','web','videos'].includes(req.query.type)?req.query.type:'all';
    const page=Math.min(5,Math.max(1,Math.floor(Number(req.query.page)||1)));
    if(query.length<2)return res.status(400).json({status:'invalid_query',results:[],suggestions:[]});
    if(!base)return res.status(503).json({status:'unconfigured',results:[],suggestions:[]});
    if(!gate(req,res,'search'))return;
    const chosen=enabled.filter(id=>kind==='all'||(kind==='videos'?id==='youtube':id!=='youtube'));
    if(!chosen.length)return res.json({status:'empty',results:[],suggestions:[],page,nextPage:null});
    try {
      const data=await cached(JSON.stringify([query,kind,page]),async()=>normalizeWebResults(await getJson('/search',{
        q:query,format:'json',language:'pt-BR',engines:chosen.join(','),categories:kind==='videos'?'videos':kind==='web'?'general':'general,videos',
        pageno:String(page),safesearch:'1'
      }),chosen),120000);
      res.json({status:data.unavailable.length?'partial':data.results.length?'ready':'empty',...data,page,
        // Engines have different pagination support. Only offer a bounded next request after a nonempty page.
        nextPage:data.results.length && page<5?page+1:null});
    }catch(error){res.status(error.message==='busy'?429:503).json({status:'unavailable',results:[],suggestions:[]});}
  });
  app.get('/api/search/autocomplete',async(req,res)=>{
    res.set('Cache-Control','no-store');
    const query=text(req.query.q,120);
    if(query.length<2)return res.json({suggestions:[]});
    if(!base)return res.status(503).json({status:'unconfigured',suggestions:[]});
    if(!gate(req,res,'suggest'))return;
    try {
      const suggestions=await cached('suggest:'+query,async()=>{
        // The default backend is configured in SearXNG; no scraping client is shipped to the browser.
        const data=await getJson('/autocompleter',{q:query},{timeout:3500});
        const values=Array.isArray(data?.[1])?data[1]:data;
        return [...new Set((Array.isArray(values)?values:[]).filter(value=>typeof value==='string')
          .map(value=>text(value,120)).filter(Boolean))].slice(0,8);
      },300000);
      res.json({suggestions:suggestions.map(label=>({label,type:'web'}))});
    }catch{res.status(503).json({status:'unavailable',suggestions:[]});}
  });
}
