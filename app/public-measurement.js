import { measurementPage } from './public/measurement-policy.js';
export function injectPublicMeasurement(html, pathname) {
  if (!measurementPage(pathname) || typeof html !== 'string' || !/<\/body>/i.test(html)) return html;
  const openai = /^\/(?:produto|loja|cursos)(?:\/|$)/.test(pathname) || /^\/ofertas\/[a-z0-9-]+\/?$/.test(pathname);
  if (openai) {
    html = html.replace(/<script\b[^>]*\bsrc\s*=\s*["']\/(?:openai-ads|openai-product-events)\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/ig, '');
  }
  const tag = '<script src="/analytics.js?v=public-pages-20260914" data-vc-google-analytics="enabled" defer></script>';
  const loader = openai ? '<script src="/openai-product-events.js?v=public-pages-20260914" defer></script>' + tag.replace(' defer', ' data-vc-openai-ads="enabled" defer') : tag;
  const existing = /<script\b[^>]*\bsrc\s*=\s*["']\/analytics\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/ig;
  // Replace prior first-party loader rather than double-counting page views.
  let seen = false;
  const page = html.replace(existing, () => { if (seen) return ''; seen = true; return loader; });
  return seen ? page : page.replace(/<\/body>/i, loader + '</body>');
}
