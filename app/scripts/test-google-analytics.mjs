import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { measurementPage, measurementContext } from '../public/measurement-policy.js';
import { injectPublicMeasurement } from '../public-measurement.js';

test('public allowlist excludes account, payment, forms and unknown routes', () => {
  for (const route of ['/admin.html', '/admin-growth.html', '/entrar.html', '/cadastro.html', '/carteira.html', '/api/health', '/perfil/teste', '/unknown', '/produto/a%40b', '/loja/../admin']) {
    // Browser-normalized paths are used by the loader.
    assert.equal(measurementPage(new URL(route, 'https://vitrinecity.com').pathname), null, route);
  }
  for (const route of ['/', '/index.html', '/porque-vitrinecity.html', '/portfolio', '/portfolio.html', '/social', '/loja.html', '/guias/plantas-em-vasos.html', '/produto/123', '/ofertas', '/ofertas/adubo', '/artigo/novo']) assert.ok(measurementPage(route), route);
});
test('only bounded campaign identifiers survive; user content and private referrers do not', () => {
  const url = new URL('https://vitrinecity.com/produto/nome-de-pessoa?email=secret%40example.com&token=abc&q=confidential&utm_source=meta&utm_medium=paid_social&utm_campaign=campanha_01&utm_term=private%40mail.com&gclid=Safe-ID_123#private-form');
  const context = measurementContext(url, 'https://ref.example/private/customer?email=x');
  assert.equal(context.page_location, 'https://vitrinecity.com/produto/detalhe?utm_source=meta&utm_medium=paid_social&utm_campaign=campanha_01&gclid=Safe-ID_123');
  assert.equal(context.page_referrer, 'https://ref.example'); assert.equal(context.page_title, 'VitrineCity — produto');
  assert.equal(measurementContext(new URL('https://vitrinecity.com/'), 'javascript:alert(1)').page_referrer, '');
  assert.equal(measurementContext(new URL('https://vitrinecity.com/?utm_source=' + 'x'.repeat(161)), '').page_location, 'https://vitrinecity.com/');
});
test('injection covers static and dynamic HTML once and leaves private/non-HTML responses untouched', () => {
  const original = '<html><body>Welcome</body></html>';
  for (const route of ['/', '/porque-vitrinecity.html', '/portfolio', '/portfolio.html', '/guias/plantas-em-vasos.html', '/ofertas/plantas']) {
    const html = injectPublicMeasurement(original, route);
    assert.match(html, /data-vc-google-analytics="enabled"/); assert.equal(injectPublicMeasurement(html, route), html);
    assert.equal((injectPublicMeasurement('<body><script src="/analytics.js" defer></script><script src="/analytics.js?v=old"></script></body>', route).match(/src="\/analytics\.js/g) || []).length, 1);
  }
  for (const route of ['/admin.html', '/entrar.html', '/carteira.html']) assert.equal(injectPublicMeasurement(original, route), original);
  assert.equal(injectPublicMeasurement('{"ok":true}', '/'), '{"ok":true}');
});

const source = readFileSync(new URL('../public/google-analytics.js', import.meta.url), 'utf8').replace(/^import .*\r?\n/gm, '');
function run({ consent = 'accepted', googleConsent = 'accepted', href = 'https://vitrinecity.com/?email=secret%40example.com&utm_source=meta', blocked = false } = {}) {
  const values = new Map([['vc_analytics_consent', consent], ['vc_google_analytics_consent_v1', googleConsent]]);
  const listeners = {}, scripts = [];
  const sandbox = { measurementContext, flushReceipts: () => {}, clearPendingReceipts: () => {}, location: new URL(href), Date,
    localStorage: { getItem: key => { if (blocked) throw Error('unavailable'); return values.get(key); } },
    addEventListener: (name, fn) => { listeners[name] = fn; },
    document: { referrer: 'https://ref.example/private?token=secret', createElement: () => ({}),
      head: { appendChild: script => scripts.push(script) }, addEventListener: (name, fn) => { listeners[name] = fn; } } };
  sandbox.window = sandbox; vm.createContext(sandbox); vm.runInContext('(() => {' + source + '})()', sandbox);
  return { sandbox, values, listeners, scripts };
}
test('basic consent mode makes no Google request without both permissions or outside public production pages', () => {
  for (const options of [{ consent: null }, { consent: 'essential' }, { googleConsent: null }, { googleConsent: 'essential' }, { blocked: true }, { href: 'https://vitrinecity.com/entrar.html' }, { href: 'https://vitrinecity.com/admin.html' }, { href: 'http://localhost:3000/' }]) {
    const p = run(options); assert.equal(p.scripts.length, 0); assert.equal(p.sandbox.dataLayer, undefined);
  }
});
test('one sanitized page view targets the verified stream, advertising features stay denied, revocation stops collection', () => {
  const p = run(); assert.equal(p.scripts.length, 1);
  assert.equal(p.scripts[0].src, 'https://www.googletagmanager.com/gtag/js?id=G-0V9KJQMH0V');
  assert.equal(p.scripts[0].referrerPolicy, 'strict-origin');
  const entries = p.sandbox.dataLayer.map(args => Array.from(args));
  const config = entries.find(e => e[0] === 'config'); assert.equal(config[1], 'G-0V9KJQMH0V');
  assert.equal(config[2].send_page_view, false); assert.equal(config[2].allow_google_signals, false);
  assert.equal(config[2].allow_ad_personalization_signals, false);
  assert.equal(entries.find(e => e[0] === 'consent' && e[1] === 'default')[2].ad_storage, 'denied');
  const events = entries.filter(e => e[0] === 'event'); assert.equal(events.length, 1); assert.equal(events[0][1], 'page_view');
  assert.equal(events[0][2].page_location, 'https://vitrinecity.com/?utm_source=meta');
  assert.equal(events[0][2].page_referrer, 'https://ref.example');
  assert.doesNotMatch(JSON.stringify(entries), /secret|private|email/);
  vm.runInContext('(() => {' + source + '})()', p.sandbox);
  assert.equal(p.scripts.length, 1);
  p.values.set('vc_google_analytics_consent_v1', 'essential'); p.listeners['vc:measurement-consent']();
  assert.equal(p.sandbox['ga-disable-G-0V9KJQMH0V'], true);
});
