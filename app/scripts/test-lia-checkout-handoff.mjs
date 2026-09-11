import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { safeSiteAssistantContentUrl, siteAssistantContextPath } from '../public/site-assistant-policy.js';

const html = name => readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');
const inline = (name, marker) => [...html(name).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(source => source.includes(marker));
const shopInline = inline('loja.html', 'const vcCheckoutButton=');
const shopSource = shopInline.slice(shopInline.indexOf('const vcCheckoutButton='));
const authSource = inline('entrar.html', 'function navigateAfterAuth');
const accountSource = inline('minha-conta.html', 'function navigateAccount').replace(/\s+load\(\);loadStores\(\);\s*$/, '');
const response = (data, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
const payment = () => response({ reference: 'shop_test', checkoutUrl: 'https://www.mercadopago.com.br/checkout/test', shipping: { shippingCents: 100 } }, 201);

function surface({ pathname = '/loja', search = '?carrinho=1&lia=1', bridge } = {}) {
  const nodes = new Map(), redirects = [], handoffs = [];
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, { disabled: false, checked: true, style: {}, values: {}, listeners: {}, focus() {}, addEventListener(type, fn) { this.listeners[type] = fn; } });
    return nodes.get(id);
  };
  const location = { pathname, search, origin: 'https://vitrinecity.com', assign: url => redirects.push(url) };
  Object.defineProperty(location, 'href', { set: url => redirects.push(url) });
  const window = bridge === undefined ? {} : { vcLiaNavigate: url => { handoffs.push(url); return typeof bridge === 'function' ? bridge(url) : bridge; } };
  const context = vm.createContext({ document: { getElementById: get }, location, window, URL, URLSearchParams, navigator: {}, console,
    FormData: class { constructor(form) { this.values = form.values || {}; } get(key) { return this.values[key] ?? null; } [Symbol.iterator]() { return Object.entries(this.values)[Symbol.iterator](); } } });
  return { context, get, redirects, handoffs, async submit(id) { const node = get(id); return node.listeners.submit({ preventDefault() {}, currentTarget: node, target: node }); } };
}

function shop({ bridge, customer = response({ address: { id: 7 } }), quote = { shippingCents: 100 }, checkout = payment, search } = {}) {
  const h = surface({ bridge, search }), requests = []; let quotes = 0;
  Object.assign(h.context, { cart: [{ id: 11, quantity: 2 }], cartItems: () => [{ productId: 11, quantity: 2 }], deliveryMode: { value: 'carrier' },
    calculateShipping: async () => { quotes++; return quote; },
    fetch: async (url, opts = {}) => { requests.push({ url, ...opts }); if (url === '/api/checkout/customer') return customer; if (url === '/api/marketplace/checkout') return checkout(); throw Error('Unexpected request ' + url); } });
  vm.runInContext(shopSource, h.context);
  return { ...h, requests, quotes: () => quotes, click: () => h.get('checkout').onclick({ preventDefault() {} }), purchases: () => requests.filter(item => item.method === 'POST') };
}

test('marketplace payment navigates normally or hands the same validated link to Lia', async () => {
  for (const bridge of [undefined, false, true]) {
    const h = shop({ bridge }); await h.click(); await h.click();
    assert.equal(h.purchases().length, 1); assert.equal(h.get('checkout').disabled, true);
    assert.deepEqual(JSON.parse(h.purchases()[0].body), { addressId: 7, items: [{ productId: 11, quantity: 2 }], deliveryMode: 'carrier', termsAccepted: true });
    if (bridge === true) { assert.equal(h.redirects.length, 0); assert.deepEqual(h.handoffs, ['https://www.mercadopago.com.br/checkout/test']); assert.match(h.get('status').textContent, /Continue pelo link de pagamento na conversa/); }
    else assert.deepEqual(h.redirects, ['https://www.mercadopago.com.br/checkout/test']);
  }
});

test('guest and missing-address navigation preserve the complete cart return URL', async () => {
  for (const bridge of [false, true]) for (const [customer, target] of [[response({}, 401), '/entrar.html'], [response({ address: null }), '/minha-conta.html']]) {
    const h = shop({ bridge, customer, search: '?delivery=local&carrinho=1&lia=1' }); await h.click();
    const urls = bridge ? h.handoffs : h.redirects, url = new URL(urls[0], 'https://vitrinecity.com');
    assert.equal(url.pathname, target); assert.equal(url.searchParams.get('returnTo'), '/loja?delivery=local&carrinho=1&lia=1');
    assert.equal(h.purchases().length, 0); assert.equal(h.quotes(), 0); if (bridge) assert.equal(h.redirects.length, 0);
  }
});

test('marketplace blocks a concurrent submit while the provider request is pending', async () => {
  let release; const h = shop({ bridge: true, checkout: () => new Promise(resolve => { release = resolve; }) });
  const first = h.click(); await new Promise(resolve => setImmediate(resolve)); await h.click(); assert.equal(h.purchases().length, 1);
  release(payment()); await first; await h.click(); assert.equal(h.purchases().length, 1);
});

test('uncertain checkout, malformed JSON, unsafe URL and missing reference cannot hand off or retry', async () => {
  for (const checkout of [
    () => { throw Error('network'); }, () => response({ error: 'provider' }, 502),
    () => ({ ...payment(), json: async () => { throw Error('json'); } }),
    () => response({ reference: 'shop_test', checkoutUrl: 'https://mercadopago.com.br.evil.test/' }, 201),
    () => response({ reference: 'shop_test', checkoutUrl: 'https://name:secret@www.mercadopago.com.br/' }, 201),
    () => response({ checkoutUrl: 'https://www.mercadopago.com.br/checkout/test' }, 201),
    () => response({ reference: 'shop_test', checkoutUrl: 'https://www.mercadopago.com.br/checkout/test' }, 200)
  ]) {
    const h = shop({ bridge: true, checkout }); await h.click(); await h.click();
    assert.equal(h.purchases().length, 1); assert.equal(h.redirects.length, 0); assert.equal(h.handoffs.length, 0); assert.equal(h.get('checkout').disabled, true); assert.match(h.get('status').textContent, /Não repita/);
  }
});

test('failed bridge after preference creation stays locked without fallback or another payment', async () => {
  const h = shop({ bridge: () => { throw Error('parent unavailable'); } }); await h.click(); await h.click();
  assert.equal(h.purchases().length, 1); assert.equal(h.handoffs.length, 1); assert.equal(h.redirects.length, 0); assert.equal(h.get('checkout').disabled, true);
});

test('known preflight rejections permit an explicit corrected retry without automatic checkout', async () => {
  let count = 0; const h = shop({ checkout: () => ++count === 1 ? response({ error: 'Estoque insuficiente' }, 409) : payment() });
  await h.click(); assert.equal(h.purchases().length, 1); assert.equal(h.get('checkout').disabled, false); assert.match(h.get('status').textContent, /Estoque insuficiente/);
  await h.click(); assert.equal(h.purchases().length, 2); assert.equal(h.redirects.length, 1);
});

test('unchecked terms, unavailable account and missing quote never create payment', async () => {
  for (const opts of [{ unchecked: true }, { customer: response({}, 503) }, { quote: null }]) {
    const h = shop(opts); if (opts.unchecked) h.get('marketplaceTerms').checked = false; await h.click();
    assert.equal(h.purchases().length, 0); assert.equal(h.redirects.length, 0); assert.equal(h.get('checkout').disabled, false);
  }
});

test('login and registration hand off only the saved return path, or navigate normally', async () => {
  for (const bridge of [undefined, false, true]) for (const id of ['login', 'register']) {
    const destination = '/loja?carrinho=1&lia=1', h = surface({ bridge, pathname: '/entrar.html', search: '?lia=1&returnTo=' + encodeURIComponent(destination) }), requests = [];
    h.get(id).values = { name: 'Cliente teste', email: 'cliente@example.test', password: 'not-a-real-password', adult: 'on', terms: 'on', postalCode: '00000000' };
    h.context.fetch = async (url, opts) => { requests.push({ url, opts }); return response({ ok: true }); };
    vm.runInContext(authSource, h.context); await h.submit(id);
    assert.equal(requests.length, 1); assert.equal(requests[0].url, id === 'login' ? '/api/auth/login' : '/api/customer/register');
    assert.deepEqual(bridge === true ? h.handoffs : h.redirects, [destination]); if (bridge === true) assert.equal(h.redirects.length, 0);
  }
});

test('invalid login remains in place and unsafe return URL falls back to account', async () => {
  const h = surface({ bridge: true, search: '?returnTo=' + encodeURIComponent('/\\evil.test') });
  h.context.fetch = async () => response({ ok: true }); vm.runInContext(authSource, h.context); await h.submit('login'); assert.deepEqual(h.handoffs, ['/minha-conta.html']);
  const bad = surface({ bridge: true }); bad.context.fetch = async () => response({ error: 'Senha incorreta' }, 401); vm.runInContext(authSource, bad.context); await bad.submit('login'); assert.equal(bad.handoffs.length, 0); assert.equal(bad.redirects.length, 0);
});

test('expired account session flattens the purchase return and login resumes the cart', async () => {
  for (const bridge of [false, true]) {
    const search = '?lia=1&returnTo=' + encodeURIComponent('/loja?carrinho=1&lia=1'), h = surface({ bridge, pathname: '/minha-conta.html', search });
    h.context.fetch = async () => response({}, 401); vm.runInContext(accountSource, h.context); await vm.runInContext('load()', h.context);
    const urls = bridge ? h.handoffs : h.redirects, url = new URL(urls[0], 'https://vitrinecity.com');
    assert.equal(url.pathname, '/entrar.html'); assert.equal(url.searchParams.get('returnTo'), '/loja?carrinho=1&lia=1'); assert.equal(url.searchParams.get('lia'), '1');
    assert.equal(safeSiteAssistantContentUrl(url.href, h.context.location.origin), url.href); if (bridge) assert.equal(h.redirects.length, 0);
    const login = surface({ bridge, pathname: '/entrar.html', search: url.search }); login.context.fetch = async () => response({ ok: true });
    vm.runInContext(authSource, login.context); await login.submit('login');
    assert.deepEqual(bridge ? login.handoffs : login.redirects, ['/loja?carrinho=1&lia=1']);
    assert.equal(siteAssistantContextPath('/minha-conta.html', search), ''); assert.equal(siteAssistantContextPath('/entrar.html', url.search), '');
  }
});

test('missing, private, sensitive or nested purchase return falls back without a redirect chain', async () => {
  for (const requested of ['', '/admin.html', '/loja?returnTo=%2Floja', '/loja?token=private', '/entrar.html?returnTo=%2Floja']) {
    const h = surface({ bridge: true, pathname: '/minha-conta.html', search: '?lia=1' + (requested ? '&returnTo=' + encodeURIComponent(requested) : '') });
    h.context.fetch = async () => response({}, 401); vm.runInContext(accountSource, h.context); await vm.runInContext('load()', h.context);
    const url = new URL(h.handoffs[0], h.context.location.origin);
    assert.equal(url.searchParams.get('returnTo'), '/minha-conta.html?lia=1'); assert.equal(url.searchParams.get('lia'), '1');
    assert.equal(safeSiteAssistantContentUrl(url.href, h.context.location.origin), url.href); assert.equal(h.redirects.length, 0);
  }
});

test('account login preserves public course selection and leaves normal-page navigation normal', async () => {
  const h = surface({ bridge: false, pathname: '/minha-conta.html', search: '?returnTo=' + encodeURIComponent('/course-checkout.html?curso=cozinha-basica') });
  h.context.fetch = async () => response({}, 401); vm.runInContext(accountSource, h.context); await vm.runInContext('load()', h.context);
  const url = new URL(h.redirects[0], h.context.location.origin);
  assert.equal(url.searchParams.get('returnTo'), '/course-checkout.html?curso=cozinha-basica'); assert.equal(url.searchParams.has('lia'), false);
  assert.equal(safeSiteAssistantContentUrl(url.href, h.context.location.origin), url.href);
});

test('saving the delivery address returns to checkout only after server confirmation', async () => {
  for (const bridge of [false, true]) for (const accepted of [false, true]) {
    const destination = '/loja?carrinho=1&lia=1', h = surface({ bridge, pathname: '/minha-conta.html', search: '?lia=1&returnTo=' + encodeURIComponent(destination) });
    h.context.fetch = async url => { assert.equal(url, '/api/customer/addresses'); return response(accepted ? { ok: true, id: 9 } : { error: 'Endereço inválido' }, accepted ? 201 : 400); };
    vm.runInContext(accountSource, h.context); h.context.addressEvent = { preventDefault() {}, target: { values: { recipientName: 'Cliente teste', postalCode: '00000000' } } }; await vm.runInContext('saveAddress(addressEvent)', h.context);
    const urls = bridge ? h.handoffs : h.redirects; assert.deepEqual(urls, accepted ? [destination] : []); if (bridge) assert.equal(h.redirects.length, 0);
  }
});
