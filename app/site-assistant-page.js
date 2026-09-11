import { classifySiteAssistantPath } from './public/site-assistant-policy.js';

export function injectSiteAssistant(html, { path = '', amp = false } = {}) {
  if (typeof html !== 'string' || amp || !classifySiteAssistantPath(path).enabled || !/<\/body\s*>/i.test(html)) return html;
  if (/<html\b[^>]*\s(?:amp|⚡)(?:\s|=|>)/i.test(html) || /<script\b[^>]*\bsrc\s*=\s*["'][^"']*(?:cdn\.ampproject\.org|\/site-assistant\.js)(?:[?"'])/i.test(html) || /\bdata-vc-site-assistant\s*=/i.test(html)) return html;
  const css = /\bhref\s*=\s*["']\/site-assistant\.css(?:[?"'])/i.test(html) ? '' : '<link rel="stylesheet" href="/site-assistant.css?v=20260911-window-controls">';
  const loader = '<script type="module" src="/site-assistant.js?v=20260911-window-controls" data-vc-site-assistant="enabled"></script>';
  return html.replace(/<\/body\s*>/i, css + loader + '</body>');
}
