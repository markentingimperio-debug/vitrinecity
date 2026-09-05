import { measurementPage } from './public/measurement-policy.js';
export function injectPublicMeasurement(html, pathname) {
  if (!measurementPage(pathname) || typeof html !== 'string' || !/<\/body>/i.test(html)) return html;
  const tag = '<script src="/analytics.js?v=ga4-20260905" data-vc-google-analytics="enabled" defer></script>';
  const existing = /<script\b[^>]*\bsrc\s*=\s*["']\/analytics\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/ig;
  // Replace prior first-party loader rather than double-counting page views.
  let seen = false;
  const page = html.replace(existing, () => { if (seen) return ''; seen = true; return tag; });
  return seen ? page : page.replace(/<\/body>/i, tag + '</body>');
}
