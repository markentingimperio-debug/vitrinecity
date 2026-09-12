import { classifySiteAssistantPath, siteAssistantEmbeddedPath } from './public/site-assistant-policy.js';

export function injectSiteAssistantContent(html, { path = '', embedded = false, amp = false } = {}) {
  if (!embedded || amp || !siteAssistantEmbeddedPath(path) || typeof html !== 'string' || !/<head\b[^>]*>/i.test(html) || /<html\b[^>]*\s(?:amp|⚡)(?:\s|=|>)/i.test(html)) return html;
  // Build-time HTML can already contain these loaders. Avoid nested widgets,
  // advertising fetches and install prompts inside the active purchase.
  let page = html.replace(/<script\b[^>]*\bsrc\s*=\s*["'][^"']*\/(?:site-assistant|global-market-banner|pwa-install)\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/gi, '');
  if (/\bsrc=["']\/site-assistant-bridge\.js/.test(page)) return page;
  return page.replace(/<head\b[^>]*>/i, '$&<script src="/site-assistant-bridge.js?v=20260911-chat-content"></script><link rel="stylesheet" href="/site-assistant-embedded.css?v=20260911-chat-content">');
}

export function injectSiteAssistant(html, { path = '', amp = false } = {}) {
  if (typeof html !== 'string' || amp || !classifySiteAssistantPath(path).enabled || !/<\/body\s*>/i.test(html)) return html;
  if (/<html\b[^>]*\s(?:amp|⚡)(?:\s|=|>)/i.test(html) || /<script\b[^>]*\bsrc\s*=\s*["'][^"']*(?:cdn\.ampproject\.org|\/site-assistant\.js)(?:[?"'])/i.test(html) || /\bdata-vc-site-assistant\s*=/i.test(html)) return html;
  const css = /\bhref\s*=\s*["']\/site-assistant\.css(?:[?"'])/i.test(html) ? '' : '<link rel="stylesheet" href="/site-assistant.css?v=20260911-chat-content">';
  const loader = '<script type="module" src="/site-assistant.js?v=20260911-lia-sales" data-vc-site-assistant="enabled"></script>';
  return html.replace(/<\/body\s*>/i, css + loader + '</body>');
}
