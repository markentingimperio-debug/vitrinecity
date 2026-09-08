// Only these published page aliases are rewritten. Existing catalogs, API routes,
// payment callbacks and old .html addresses keep their established behavior.
export const CLEAN_PUBLIC_ROUTES = Object.freeze({
  '/multiverso': '/vitriny-multiverse-explore.html',
  '/jogos': '/vitriny-games.html',
  '/mini-fazenda': '/vitriny-mini-fazenda.html',
  '/arena-musical': '/vitriny-music-arena.html',
  '/sala-de-cinema': '/vitriny-cinema.html',
  '/meus-creditos': '/central-creditos.html',
  '/pesquisar': '/pesquisar.html',
  '/centro-educacional': '/centro-educacional.html',
  '/acessos': '/acessos.html',
  '/afiliados': '/afiliados.html',
  '/porque-vitrinecity': '/porque-vitrinecity.html',
  '/solucoes': '/solucoes.html',
  '/carteira': '/carteira.html',
  '/para-empresas': '/para-empresas.html',
  '/sobre': '/sobre.html',
  '/contato': '/contato.html',
  '/comprar-lote': '/comprar-lote.html',
  '/como-funciona': '/como-funciona.html'
});

const CLEAN_BY_LEGACY = Object.freeze(Object.fromEntries(
  Object.entries(CLEAN_PUBLIC_ROUTES).map(([clean, legacy]) => [legacy, clean])
));

// Exact path matching intentionally does not decode, normalize or trim input.
// This helper is a route lookup, not validation for arbitrary untrusted URLs.
export function toLegacyPublicPath(pathname) {
  return typeof pathname === 'string' && Object.hasOwn(CLEAN_PUBLIC_ROUTES, pathname)
    ? CLEAN_PUBLIC_ROUTES[pathname] : pathname;
}

// Root-relative links are unambiguously same-origin. Absolute URLs (including
// affiliate links), protocol-relative URLs and unknown paths pass through intact.
export function toCleanPublicHref(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) return value;
  const separator = value.search(/[?#]/);
  const pathname = separator < 0 ? value : value.slice(0, separator);
  if (!Object.hasOwn(CLEAN_BY_LEGACY, pathname)) return value;
  return CLEAN_BY_LEGACY[pathname] + (separator < 0 ? '' : value.slice(separator));
}
