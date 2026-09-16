// Runs before page controllers. Only a Lia iframe can request navigation from
// its parent; the parent independently validates the origin, frame and URL.
(() => {
  if (window.top === window.self || new URLSearchParams(location.search).get('lia') !== '1') return;
  document.documentElement.setAttribute('data-lia-embedded', '');
  const externalPaths = new Set(['/entrar-cidade.html', '/meus-cursos.html', '/pedidos.html', '/social', '/entregas', '/recuperar-acesso.html', '/termos-creditos.html', '/termos-marketplace.html', '/privacy.html']);
  const post = (action, url) => window.parent.postMessage({ type: 'vc-lia-viewer', action, url }, location.origin);
  window.vcLiaNavigate = value => {
    // In an embedded page, even a rejected destination must not fall back to
    // navigating the iframe to an unvalidated external or private document.
    if (typeof value !== 'string' || value.length > 2048 || /[\\\u0000-\u0020\u007f]/.test(value) || value.startsWith('//')) return true;
    try {
      const url = new URL(value, location.href);
      if (url.username || url.password || !['http:', 'https:'].includes(url.protocol) || (url.origin !== location.origin && url.protocol !== 'https:')) return true;
      const external = url.origin !== location.origin || /^\/ir\//.test(url.pathname) || externalPaths.has(url.pathname);
      if (!external) url.searchParams.set('lia', '1');
      post(external ? 'external' : 'navigate', url.href);
    } catch { /* Invalid links cannot navigate the embedding page. */ }
    return true;
  };
  document.addEventListener('click', event => {
    const link = event.target?.closest?.('a[href]');
    if (!link || event.defaultPrevented || event.button > 0 || link.hasAttribute('download')) return;
    const href = link.getAttribute('href');
    if (href?.startsWith('#')) return;
    event.preventDefault();
    window.vcLiaNavigate(link.href);
  });
  const ready = () => post('ready', location.href);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
})();
