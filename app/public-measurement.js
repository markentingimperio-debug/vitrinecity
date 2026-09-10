import { measurementPage } from './public/measurement-policy.js';
export function injectPublicMeasurement(html, pathname) {
  if (!measurementPage(pathname) || typeof html !== 'string' || !/<\/body>/i.test(html)) return html;
  const openai = /^\/(?:produto|loja)(?:\/|$)/.test(pathname);
  if (openai) {
    html = html.replace(/<script\b[^>]*\bsrc\s*=\s*["']\/(?:openai-ads|openai-product-events)\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/ig, '');
    html = html.replace(/<\/body>/i, '<script src="/openai-product-events.js?v=20260910" defer></script></body>');
  }
  const tag = '<script src="/analytics.js?v=products-20260910" data-vc-google-analytics="enabled" defer></script>';
  const loader = openai ? tag.replace(' defer', ' data-vc-openai-ads="enabled" defer') : tag;
  const existing = /<script\b[^>]*\bsrc\s*=\s*["']\/analytics\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/ig;
  // Replace prior first-party loader rather than double-counting page views.
  let seen = false;
  const page = html.replace(existing, () => { if (seen) return ''; seen = true; return loader; });
  return seen ? page : page.replace(/<\/body>/i, loader + '</body>');
}
