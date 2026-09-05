import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
const source = readFileSync(new URL('../public/analytics.js', import.meta.url), 'utf8');
const storage = seed => { const values = new Map(Object.entries(seed || {})); return { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, String(v)), values }; };
function page({ consent, session = storage(), href = 'https://vitrinecity.com/guias/plantas-em-vasos.html?utm_source=instagram&utm_medium=organic_social&utm_campaign=plantas_vasos', blocked = false } = {}) {
  const calls = [], elements = [], listeners = {};
  const element = () => ({ dataset: {}, appendChild() {}, remove() {}, addEventListener(name, fn) { this[name] = fn; } });
  const local = blocked ? { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } } : storage(consent ? { vc_analytics_consent: consent } : {});
  const document = { referrer: 'https://www.instagram.com/private-path?secret=abc',
    head: { appendChild() {} }, body: { appendChild(e) { elements.push(e); } },
    createElement: element, querySelector: () => null, addEventListener: (name, fn) => { listeners[name] = fn; } };
  const sandbox = { document, location: new URL(href), localStorage: local, sessionStorage: session, crypto: webcrypto, URL, URLSearchParams, Headers, Request, Uint8Array,
    fetch: async (input, init) => { calls.push({ input, init }); return { json: async () => ({ experiment: null }) }; } };
  sandbox.window = sandbox; vm.createContext(sandbox); vm.runInContext(source, sandbox);
  return { sandbox, calls, elements, listeners, local, session };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('no optional requests, tracking ID or headers before consent or for essentials', async () => {
  for (const consent of [undefined, 'essential']) {
    const p = page({ consent }); await settle(); assert.equal(p.calls.length, 0); assert.equal(p.session.values.size, 0);
    await p.sandbox.fetch('/api/customer/register', { method: 'POST' });
    assert.equal(p.calls[0].init.headers, undefined);
    if (!consent) { p.elements[0].click({ target: { dataset: { choice: 'essential' } } }); await settle(); assert.equal(p.calls.length, 1); }
  }
});
test('accepted attribution survives navigation, omits referrer private path, and creates only one page view', async () => {
  const first = page({ consent: 'accepted' }); await settle();
  const firstEvent = JSON.parse(first.calls.find(c => c.input === '/api/analytics/events').init.body);
  assert.equal(firstEvent.utmSource, 'instagram'); assert.equal(firstEvent.referrer, 'https://www.instagram.com');
  assert.equal(firstEvent.landingPath, '/guias/plantas-em-vasos.html');
  const second = page({ consent: 'accepted', session: first.session, href: 'https://vitrinecity.com/entrar.html?returnTo=%2Fsocial' }); await settle();
  const events = second.calls.filter(c => c.input === '/api/analytics/events'); assert.equal(events.length, 1);
  const payload = JSON.parse(events[0].init.body);
  assert.equal(payload.sessionId, firstEvent.sessionId); assert.equal(payload.utmSource, 'instagram'); assert.equal(payload.landingPath, firstEvent.landingPath);
  vm.runInContext(source, second.sandbox); await settle(); assert.equal(second.calls.filter(c => c.input === '/api/analytics/events').length, 1);
});
test('fetch instrumentation preserves Headers and Request options and never tags third parties', async () => {
  const p = page({ consent: 'accepted' }); await settle();
  await p.sandbox.fetch(new Request('https://vitrinecity.com/api/customer/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Keep': 'yes' }, body: '{}' }));
  let call = p.calls.at(-1); assert.equal(call.init.headers.get('X-Keep'), 'yes'); assert.equal(call.init.headers.get('Content-Type'), 'application/json'); assert.equal(call.init.headers.get('X-VC-Analytics-Consent'), 'accepted'); assert.equal(call.input.method, 'POST');
  await p.sandbox.fetch('/api/health', { headers: new Headers({ 'X-Keep': 'value' }) }); assert.equal(p.calls.at(-1).init.headers.get('X-Keep'), 'value');
  for (const url of ['https://third.example/api/x', '//third.example/api/x', '/assets/site.svg']) { await p.sandbox.fetch(url); assert.equal(p.calls.at(-1).init.headers, undefined); }
  p.local.setItem('vc_analytics_consent', 'essential'); await p.sandbox.fetch('/api/health'); assert.equal(p.calls.at(-1).init.headers, undefined);
});
test('storage failures do not break forms or bypass consent', async () => {
  const p = page({ blocked: true }); await p.sandbox.fetch('/api/customer/register', { method: 'POST' }); assert.equal(p.calls.length, 1); assert.equal(p.calls[0].init.headers, undefined);
  p.elements[0].click({ target: { dataset: { choice: 'accepted' } } }); await settle(); assert.equal(p.calls.length, 1);
});
