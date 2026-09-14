import {toLegacyPublicPath} from './vitriny-public-routes.js';
import {PUBLIC_INFORMATION_PATHS} from './public-page-catalog.js?v=20260914';

// Shared allowlist: unknown and private routes never load Google Analytics.
export function measurementPage(pathname) {
  if (typeof pathname !== 'string' || pathname.length > 400 || !pathname.startsWith('/') || /[\\%?#\s\u0000-\u001f\u007f]/u.test(pathname) || pathname.includes('//') || /(?:^|\/)\.{1,2}(?:\/|$)/.test(pathname)) return null;
  // Alias visits share their established page classification. This does not
  // expand measurement to private city pages, account pages or payment routes.
  pathname = toLegacyPublicPath(pathname);
  const fixed = new Set(['/', '/index.html', '/descobrir', '/descobrir.html', '/loja', '/loja.html',
    '/entregas', '/entregas.html', '/social', '/social.html', '/cidade', '/cidade-premium', '/cidade-premium.html',
    '/pesquisar.html', '/buscar.html', '/plantas-e-jardinagem', '/noticias', '/receitas', '/esportes',
    '/tecnologia', '/inteligencia-artificial', '/entretenimento', '/conteudo', '/livros',
    '/centro-educacional.html', '/para-empresas.html', '/portfolio', '/portfolio.html', '/solucoes.html', '/como-funciona.html',
    '/sobre.html', '/contato.html', '/afiliados.html', '/porque-vitrinecity.html', '/ofertas', '/cursos', '/guias/plantas-em-vasos.html']);
  if (fixed.has(pathname) || PUBLIC_INFORMATION_PATHS.has(pathname)) return { path: pathname === '/index.html' ? '/' : pathname, title: 'VitrineCity — ' + (pathname === '/' || pathname === '/index.html' ? 'Início' : pathname.replace(/^\//, '').replace(/\.html$/, '').replaceAll('-', ' ')) };
  // Public catalog/content pages retain their identity instead of sharing /detalhe.
  if (/^\/produto\/[1-9]\d*(?:\/[a-z0-9-]+)?$/.test(pathname) || /^\/(?:ofertas|cursos|artigo|livro|cidade|categoria|centros|cinema|musicas)\/[a-z0-9-]+$/.test(pathname) || /^\/(?:guias|artigos)\/[a-z0-9-]+\.html$/.test(pathname)) {
    const label = pathname.split('/').filter(Boolean).slice(1).join(' / ').replace(/\.html$/, '').replaceAll('-', ' ');
    return { path: pathname, title: 'VitrineCity — ' + label };
  }
  if (/^\/loja\/official_[a-z0-9_]+(?:\/[a-z0-9-]+)?$/.test(pathname)) return {path: pathname, title: 'VitrineCity — loja ' + pathname.split('/').at(-1).replaceAll('-', ' ')};
  // Group unrecognized detail forms; never export arbitrary identifiers.
  // Group public detail pages. Do not export user-authored slugs or store identifiers.
  for (const prefix of ['produto', 'ofertas', 'cursos', 'artigo', 'livro', 'loja', 'cidade']) {
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
