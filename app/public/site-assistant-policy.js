import { toLegacyPublicPath } from './vitriny-public-routes.js';

// Shared by the public loader and the server. Unknown/private routes stay out.
// This deliberately accepts a pathname only, never a URL, query or fragment.
export function classifySiteAssistantPath(value) {
  const blocked = { enabled: false, kind: 'excluded', proactive: false, commercial: false, path: '' };
  if (typeof value !== 'string' || value.length > 400 || !value.startsWith('/') || /[\\%?#\s\u0000-\u001f\u007f]/u.test(value) || value.includes('//') || /(?:^|\/)\.{1,2}(?:\/|$)/.test(value)) return blocked;
  const path = value.length > 1 ? value.replace(/\/$/, '') : value;
  const legacy = toLegacyPublicPath(path);
  const allow = (kind, proactive = true, commercial = true) => ({ enabled: true, kind, proactive, commercial, path });
  if (path === '/course-checkout.html') return allow('course_checkout', false);
  if (['/oracao-do-dia', '/oracao-do-dia.html'].includes(path)) return allow('prayer', false, false);
  if (['/', '/index.html'].includes(path)) return allow('home');
  if (legacy === '/vitriny-multiverse-explore.html') return allow('city');
  if (/^\/produto\/[1-9]\d*(?:\/[a-z0-9-]+)?$/.test(path)) return allow('product');
  if (/^\/loja(?:\.html|\/[a-zA-Z0-9_-]+(?:\/[a-z0-9-]+)?)?$/.test(path)) return allow('store');
  if (/^\/ofertas(?:\/[a-z0-9-]+)?$/.test(path) || /^\/centros\/(?:mercadolivre|shopee|cakto|kiwify|tiktok)$/.test(path)) return allow('affiliate');
  if (/^\/artigo\/[a-z0-9-]+$/.test(path)) return allow('article');
  if (['/receitas', '/esportes', '/noticias', '/curiosidades', '/tecnologia', '/plantas-e-jardinagem', '/inteligencia-artificial', '/entretenimento', '/livros', '/stories'].includes(path)) return allow(path === '/receitas' ? 'recipe' : 'portal');
  if (['/servicos-digitais', '/servicos-digitais.html'].includes(path)) return allow('service');
  if (/^\/cursos(?:\/[a-z0-9-]+)?$/.test(path) || legacy === '/centro-educacional.html') return allow('course');
  if (['/sobre.html', '/contato.html', '/como-funciona.html', '/porque-vitrinecity.html', '/solucoes.html', '/para-empresas.html', '/pesquisar.html'].includes(legacy)) return allow('info');
  return { ...blocked, path };
}

// A public course checkout can offer manual help about one published course.
// Only its canonical slug becomes assistant context; form data and other query
// parameters never enter a chat request.
export function siteAssistantContextPath(pathname, search = '') {
  const policy = classifySiteAssistantPath(pathname);
  if (!policy.enabled) return '';
  if (policy.kind !== 'course_checkout') return policy.path;
  if (typeof search !== 'string') return '';
  const slugs = new URLSearchParams(search).getAll('curso');
  if (slugs.length !== 1 || slugs[0].length > 101 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugs[0])) return '';
  return '/cursos/' + slugs[0];
}

export const SITE_ASSISTANT_DISMISS_MS = 24 * 60 * 60 * 1000;
export function siteAssistantDismissed(until, now = Date.now()) {
  const timestamp = Number(until);
  return Number.isFinite(timestamp) && timestamp > now && timestamp <= now + SITE_ASSISTANT_DISMISS_MS;
}

// Product links must come from the server, and never execute code or expose
// session-bearing query strings on private pages. External links use HTTPS.
export function safeSiteAssistantUrl(value, origin, { image = false } = {}) {
  if (typeof value !== 'string' || value.length > 2048 || /[\\\u0000-\u0020\u007f]/.test(value) || value.startsWith('//')) return '';
  try {
    const base = new URL(origin);
    const url = new URL(value, base);
    if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) return '';
    if (url.origin !== base.origin && url.protocol !== 'https:') return '';
    if (!image && url.origin === base.origin) {
      if (!classifySiteAssistantPath(url.pathname).enabled && !['/entrar-cidade.html', '/meus-cursos.html', '/social'].includes(url.pathname) && !/^\/ir\/[a-zA-Z0-9_-]+$/.test(url.pathname)) return '';
      if ([...url.searchParams.keys()].some(key => /token|session|password|secret|auth/i.test(key))) return '';
    }
    return url.href;
  } catch { return ''; }
}

// The viewer may host these two existing customer forms, but their contents and
// URLs never become AI context. This does not enable the assistant on them.
const EMBEDDED_CUSTOMER_FORMS = ['/entrar.html', '/minha-conta.html'];
const CONTENT_LINKS = ['/entrar-cidade.html', '/meus-cursos.html', '/pedidos.html', '/social', '/entregas', '/recuperar-acesso.html', '/termos-creditos.html', '/termos-marketplace.html', '/privacy.html'];
export function siteAssistantEmbeddedPath(path) {
  return classifySiteAssistantPath(path).enabled || EMBEDDED_CUSTOMER_FORMS.includes(path);
}

export function safeSiteAssistantContentUrl(value, origin) {
  if (typeof value !== 'string' || value.length > 2048 || /[\\\u0000-\u0020\u007f]/.test(value) || value.startsWith('//')) return '';
  try {
    const base = new URL(origin), url = new URL(value, base);
    if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) return '';
    if (url.origin !== base.origin) return url.protocol === 'https:' ? url.href : '';
    if (!siteAssistantEmbeddedPath(url.pathname) && !CONTENT_LINKS.includes(url.pathname) && !/^\/ir\/[a-zA-Z0-9_-]+$/.test(url.pathname)) return '';
    if ([...url.searchParams.keys()].some(key => /token|session|password|secret|auth/i.test(key))) return '';
    if (url.searchParams.has('returnTo')) {
      const returns = url.searchParams.getAll('returnTo');
      if (returns.length !== 1 || !returns[0].startsWith('/') || returns[0].startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(returns[0])) return '';
      const destination = new URL(returns[0], base);
      if (destination.origin !== base.origin || !siteAssistantEmbeddedPath(destination.pathname) || [...destination.searchParams.keys()].some(key => /returnTo|token|session|password|secret|auth/i.test(key))) return '';
    }
    return url.href;
  } catch { return ''; }
}
