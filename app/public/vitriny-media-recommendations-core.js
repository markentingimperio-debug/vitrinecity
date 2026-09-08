const text = (value, limit = 300) => typeof value === 'string' ? value.slice(0, limit).trim() : '';
export const normalizeMediaTopic = value => text(value, 1800).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const has = (value, pattern) => pattern.test(' ' + value + ' ');

// Editorial relationships use only the selected title, category and public tags.
// A genre never makes an unrelated course, electronics item or promotion eligible.
export function mediaRecommendationContext(item, scope = 'music') {
  if (!item || !text(item.title)) return {key:'', queries:[], topics:[]};
  const tags = Array.isArray(item.tags) ? item.tags.slice(0, 20).map(value => text(value, 80)).join(' ') : text(item.tags, 600);
  const source = normalizeMediaTopic([text(item.title), text(item.genre, 80), text(item.genreLabel, 80), tags].join(' '));
  const key = [scope, text(item.slug, 100), source].join('|');
  const audio = {query:'fone', pattern:/\b(?:fone|fones|headphone|headphones|earbuds)\b/, reason:'Áudio para acompanhar a seleção'};
  let topics;
  if (scope === 'cinema') {
    if (has(source, /\b(?:animacao|animado|animados|pixar|blender|desenho|desenhos)\b/)) {
      topics = [
        {query:'animacao', pattern:/\b(?:animacao|animador|blender)\b/, reason:'Animação e criação visual'},
        {query:'desenho', pattern:/\b(?:desenho|desenhar|ilustracao)\b/, reason:'Desenho e criação visual'},
        {query:'projetor', pattern:/\b(?:projetor|projetores)\b/, reason:'Para a experiência de cinema'},
      ];
    } else topics = [
      {query:'cinema', pattern:/\b(?:cinema|cinematografia|cinematografico|cinematografica)\b/, reason:'Relacionado ao cinema'},
      {query:'projetor', pattern:/\b(?:projetor|projetores)\b/, reason:'Para a experiência de cinema'},
      {query:'audiovisual', pattern:/\b(?:audiovisual|filmagem|cineasta)\b/, reason:'Criação audiovisual'},
    ];
  } else if (scope === 'music' && has(source, /\b(?:sertanejo|sertaneja|sertanejeiro|country|barretos)\b/)) {
    topics = [
      {query:'sertanejo', pattern:/\b(?:sertanejo|sertaneja|sertanejeiro)\b/, reason:'Relacionado ao sertanejo'},
      {query:'violao', pattern:/\b(?:violao|viola)\b/, reason:'Instrumentos e aprendizado musical'},
      {query:'moda country', pattern:/\bcountry\b/, reason:'Moda ligada ao universo country'},
    ];
  } else if (scope === 'music' && has(source, /\b(?:eletronica|tomorrowland|dj|house|techno|trance|dance)\b/)) {
    topics = [
      {query:'producao musical', pattern:/\bproducao musical\b|\bprodutor musical\b/, reason:'Criação de música'},
      {query:'dj', pattern:/\bdj\b|\bcontroladora\b|\bdiscotecagem\b/, reason:'Equipamentos e formação de DJ'},
      audio,
    ];
  } else if (scope === 'music' && has(source, /\b(?:musica|musical|forro|pagode|samba|pop|mpb|rap|rock|jazz|blues|gospel|lofi|soul|funk)\b/)) {
    topics = [
      {query:'musica', pattern:/\b(?:musica|musical|musicais|canto|cantar)\b/, reason:'Instrumentos e aprendizado musical'},
      audio,
      {query:'instrumento musical', pattern:/\binstrumentos? musicais?\b/, reason:'Instrumentos musicais'},
    ];
  } else topics = [];
  return {key, queries:topics.map(topic => topic.query).slice(0, 3), topics};
}

export function safeMediaRecommendationHref(value, origin = 'https://vitrinecity.com') {
  if (typeof value !== 'string' || !value || value.length > 600 || /[\\\s\u0000-\u001f\u007f]/.test(value) || /%2e|%2f|%5c|%00/i.test(value) || value.startsWith('//')) return '';
  try {
    const base = new URL(origin), url = new URL(value, base);
    if (url.origin !== base.origin || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || value.split(/[?#]/, 1)[0].split('/').includes('..')) return '';
    const path = url.pathname;
    if (/^\/(?:produto\/[1-9]\d*(?:\/[a-z0-9-]+)?|ofertas\/[a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.test(path) && !url.hash) return path;
    if (['/centro-educacional', '/centro-educacional.html'].includes(path) && /^#[a-z0-9]+(?:-[a-z0-9]+)*$/.test(url.hash)) return '/centro-educacional' + url.hash;
  } catch {}
  return '';
}

export function rankMediaRecommendations(context, responses, {origin = 'https://vitrinecity.com', limit = 3} = {}) {
  if (!context?.topics?.length) return [];
  const candidates = (Array.isArray(responses) ? responses : []).slice(0, 3).flatMap(data => [
    ...(Array.isArray(data?.products) ? data.products : []).slice(0, 60).filter(row => row && typeof row === 'object').map(row => ({...row, title:row.name, url:row.productUrl, kind:'product'})),
    ...(Array.isArray(data?.contents) ? data.contents : []).slice(0, 30).filter(row => row && (['course', 'affiliate'].includes(row.kind) || safeMediaRecommendationHref(row.url, origin).startsWith('/ofertas/'))),
  ]);
  const found = new Map();
  for (const item of candidates) {
    if (!item || item.available === false || item.available === 0 || item.status && item.status !== 'published' && item.status !== 'active') continue;
    const href = safeMediaRecommendationHref(item.url, origin), title = text(item.title, 180);
    if (!href || !title) continue;
    const primary = normalizeMediaTopic([title, text(item.category, 100)].join(' '));
    // Match the actual product/course identity, not a passing phrase in a long ad.
    const matches = context.topics.map((topic, index) => ({topic, index})).filter(({topic}) => {
      if (!has(primary, topic.pattern)) return false;
      if (topic.query === 'sertanejo') return has(primary, /\b(?:musica|musical|curso|canto|cantor|cd|dvd|show|shows|karaoke)\b/);
      if (topic.query === 'moda country') return has(primary, /\b(?:moda|camisa|camiseta|bota|botas|chapeu|cinto|calca|jaqueta|vestido|fivela|roupa)\b/);
      return true;
    });
    if (!matches.length) continue;
    const affiliate = item.kind === 'affiliate' || href.startsWith('/ofertas/');
    const score = matches.length * 10 + (3 - matches[0].index);
    const candidate = {title, href, affiliate, kind:affiliate ? 'affiliate' : item.kind, reason:matches[0].topic.reason, score};
    if (!found.has(href) || found.get(href).score < score) found.set(href, candidate);
  }
  return [...found.values()].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'pt-BR')).slice(0, Math.max(1, Math.min(3, Number(limit) || 3)));
}

export function createMediaRecommendationLoader({scope = 'music', origin = 'https://vitrinecity.com', fetchImpl = globalThis.fetch, onResults = () => {}, timeoutMs = 7000, limit = 3} = {}) {
  let generation = 0, active = null, destroyed = false;
  const dismissed = new Set();
  function clear() {
    generation++;
    if (active) {active.controller.abort(); clearTimeout(active.timer); active = null;}
    onResults([]);
  }
  async function update(item) {
    clear();
    if (destroyed) return [];
    const context = mediaRecommendationContext(item, scope);
    if (!context.queries.length || dismissed.has(context.key)) return [];
    const own = generation, controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(10, Math.min(15000, Number(timeoutMs) || 7000)));
    active = {controller, timer, key:context.key};
    try {
      const responses = await Promise.allSettled(context.queries.map(async query => {
        const response = await fetchImpl('/api/discovery/search?q=' + encodeURIComponent(query), {signal:controller.signal, credentials:'same-origin', redirect:'error', headers:{accept:'application/json'}});
        if (!response.ok) return {};
        return response.json();
      }));
      if (destroyed || own !== generation || controller.signal.aborted) return [];
      const results = rankMediaRecommendations(context, responses.filter(result => result.status === 'fulfilled').map(result => result.value), {origin, limit});
      onResults(results);
      return results;
    } catch { return []; }
    finally { clearTimeout(timer); }
  }
  function dismiss() {
    if (active?.key) {dismissed.add(active.key); if (dismissed.size > 50) dismissed.delete(dismissed.values().next().value);}
    clear();
  }
  function destroy() { destroyed = true; clear(); dismissed.clear(); }
  return {update, clear, dismiss, destroy};
}
