import fs from 'node:fs';
import path from 'node:path';

// Optional curated public content. Missing file means no invented content/offers.
export function createSearchContentProvider(dataDir, courses = () => []) {
  const filename = path.join(dataDir, 'search-content.json'); let modified, items = [];
  return () => {
    try {
      const stat = fs.statSync(filename);
      if (stat.size > 500000) throw Error('large');
      if (modified !== stat.mtimeMs) {
        const parsed = JSON.parse(fs.readFileSync(filename, 'utf8'));
        items = (Array.isArray(parsed) ? parsed : []).filter(item => item.status === 'published' && typeof item.title === 'string').slice(0, 500).flatMap(item => {
          const kind = ['recipe','news','sports','article','affiliate'].includes(item.kind) ? item.kind : 'article';
          const raw = String(item.url || '');
          let url;
          try { url = new URL(raw, 'https://vitrinecity.com'); } catch { return []; }
          if (url.protocol !== 'https:' || url.username || url.password) return [];
          const own = url.hostname === 'vitrinecity.com';
          if (kind !== 'affiliate' && (!own || !/^\/(conteudo|receitas|noticias|esportes|artigos)\//.test(url.pathname))) return [];
          if (kind === 'affiliate' && own) return [];
          return [{ title:item.title.slice(0,200),description:String(item.description || '').slice(0,600),keywords:String(item.keywords || '').slice(0,600),kind,url:own?url.pathname+url.search+url.hash:url.href }];
        });
        modified = stat.mtimeMs;
      }
    } catch { items = []; modified = undefined; }
    return [...courses().map(course => ({ title:course.title,description:course.description,keywords:course.audience,kind:'course',url:'/centro-educacional.html#'+encodeURIComponent(course.slug) })),...items];
  };
}
