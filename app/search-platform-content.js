import {editorialImage} from './editorial-image-policy.js';

// Search only public editorial records. Article bodies help matching but are never
// returned as search snippets; drafts and unpublished books stay outside the index.
export function normalizeSearch(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

const stopWords = new Set(['como','fazer','um','uma','de','do','da','dos','das','para','com','o','a','os','as','e','em','no','na','nos','nas','quero','comprar']);
export function searchTerms(query) {
  const words = normalizeSearch(query).split(' ').filter(Boolean);
  const relevant = words.filter(word => !stopWords.has(word));
  return (relevant.length ? relevant : words).slice(0, 8);
}

export function contentRelevance(item, query) {
  const terms = searchTerms(query);
  if (!terms.length || normalizeSearch(query).length < 2) return -1;
  const title = normalizeSearch(item.title), description = normalizeSearch(item.description);
  const text = ' ' + normalizeSearch([item.title,item.description,item.keywords,item.searchText].filter(Boolean).join(' '));
  if (!terms.every(term => text.includes(' ' + term))) return -1;
  const phrase = normalizeSearch(query);
  return (title === phrase ? 100 : title.startsWith(phrase) ? 70 : 40)
    + terms.filter(term => (' ' + title).includes(' ' + term)).length * 8
    + terms.filter(term => (' ' + description).includes(' ' + term)).length * 2;
}

const publicGuides = Object.freeze([
  {kind:'article',title:'Plantas em vasos: checklist para começar',description:'Organize os cuidados com suas plantas em vasos: luz, rega, drenagem e escolha do substrato. Checklist gratuito, sem cadastro obrigatório.',keywords:'guia jardim jardinagem cuidar planta água adubo',url:'/guias/plantas-em-vasos.html'}
]);

export function publishedPlatformContent(db, query, {siteUrl=process.env.SITE_URL||'https://vitrinecity.com'}={}) {
  const terms = searchTerms(query);
  if (!terms.length || normalizeSearch(query).length < 2) return [];
  const hasTable = name => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  const match = expression => terms.map(() => `instr(' '||vc_normalize(${expression}), ?) > 0`).join(' AND ');
  const values = terms.map(term => ' ' + term), rows = [...publicGuides];
  if (hasTable('editorial_articles')) {
    rows.push(...db.prepare(`SELECT slug,title,summary description,portal keywords,body searchText,image_url imageUrl
      FROM editorial_articles WHERE status='published' AND ${match("title||' '||summary||' '||portal||' '||body")}
      ORDER BY CASE WHEN vc_normalize(title)=? THEN 0 WHEN instr(vc_normalize(title),?)=1 THEN 1 ELSE 2 END,published_at DESC,slug LIMIT 40`)
      .all(...values,normalizeSearch(query),normalizeSearch(query))
      .map(item => {
        const image=editorialImage(item.imageUrl,{siteUrl});
        return {...item,imageUrl:image.url,imageCredit:image.credit,kind:'article',url:'/artigo/'+encodeURIComponent(item.slug)};
      }));
  }
  if (hasTable('digital_books')) {
    rows.push(...db.prepare(`SELECT slug,title,summary description,category,keywords_json keywords,cover_url imageUrl,price_cents priceCents
      FROM digital_books WHERE status='published' AND ${match("title||' '||summary||' '||category||' '||keywords_json")}
      ORDER BY CASE WHEN vc_normalize(title)=? THEN 0 WHEN instr(vc_normalize(title),?)=1 THEN 1 ELSE 2 END,published_at DESC,slug LIMIT 30`)
      .all(...values,normalizeSearch(query),normalizeSearch(query))
      .map(item => ({...item,keywords:[item.category,item.keywords].filter(Boolean).join(' '),kind:'book',url:'/livro/'+encodeURIComponent(item.slug)})));
  }
  return rows;
}

export function rankSearchContent(items, query, limit = 20) {
  const seen = new Set();
  return items.map((item,index) => ({item,index,rankScore:contentRelevance(item,query)}))
    .filter(({item,rankScore}) => rankScore >= 0 && typeof item.url === 'string')
    .sort((a,b) => b.rankScore-a.rankScore || a.index-b.index)
    .filter(({item}) => {if(seen.has(item.url))return false;seen.add(item.url);return true;})
    .slice(0,limit).map(({item,rankScore}) => {
      const {searchText, ...publicItem} = item;
      return {...publicItem,rankScore};
    });
}
