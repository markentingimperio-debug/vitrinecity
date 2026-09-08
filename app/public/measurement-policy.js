import {toLegacyPublicPath} from './vitriny-public-routes.js';

// Shared allowlist: unknown and private routes never load Google Analytics.
export function measurementPage(pathname) {
  // Alias visits share their established page classification. This does not
  // expand measurement to private city pages, account pages or payment routes.
  pathname = toLegacyPublicPath(pathname);
  const fixed = new Set(['/', '/index.html', '/descobrir', '/descobrir.html', '/loja', '/loja.html',
    '/entregas', '/entregas.html', '/social', '/social.html', '/cidade', '/cidade-premium', '/cidade-premium.html',
    '/pesquisar.html', '/buscar.html', '/plantas-e-jardinagem', '/noticias', '/receitas', '/esportes',
    '/tecnologia', '/inteligencia-artificial', '/entretenimento', '/conteudo', '/livros',
    '/centro-educacional.html', '/para-empresas.html', '/solucoes.html', '/como-funciona.html',
    '/sobre.html', '/contato.html', '/afiliados.html', '/porque-vitrinecity.html', '/ofertas', '/guias/plantas-em-vasos.html']);
  if (fixed.has(pathname)) return { path: pathname === '/index.html' ? '/' : pathname, title: 'VitrineCity — ' + (pathname === '/' || pathname === '/index.html' ? 'Início' : pathname.replace(/^\//, '').replace(/\.html$/, '').replaceAll('-', ' ')) };
  // Group public detail pages. Do not export user-authored slugs or store identifiers.
  for (const prefix of ['produto', 'ofertas', 'artigo', 'livro', 'loja', 'cidade']) {
    if (new RegExp(`^/${prefix}/[a-zA-Z0-9_/-]+$`).test(pathname)) return { path: `/${prefix}/detalhe`, title: `VitrineCity — ${prefix}` };
  }
  return null;
}

export function measurementContext(location, referrer) {
  const page = measurementPage(location.pathname);
  if (!page) return null;
  const url = new URL(page.path, location.origin);
  const query = new URLSearchParams(location.search);
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid']) {
    const value = query.get(key) || '';
    if (/^[a-zA-Z0-9_-]{1,160}$/.test(value)) url.searchParams.set(key, value);
  }
  let source = '';
  try { const parsed = new URL(referrer); if (['https:', 'http:'].includes(parsed.protocol)) source = parsed.origin; } catch {}
  return { page_location: url.href, page_referrer: source, page_title: page.title };
}
