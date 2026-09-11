import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TRIAL_VERSION, TRIAL_PLAN, validTrial, subscriptionPayload, safeSubscriptionCheckout, buildingOrderState, canCancelBuilding, mountBuildingCheckout, mountBuildingLanding, mountBuildingStatus } from '../public/building-trial.js';

const config = { buildingTrial: { enabled: true, days: 30, monthlyCents: 1000, version: TRIAL_VERSION } };
const order = { reference: 'reservation-1', billingType: 'recurring', status: 'pending', trialVersion: TRIAL_VERSION, trialUntil: '2099-10-11T15:00:00.000Z', trialActive: false, subscriptionStatus: 'pending', billingAmountCents: 1000, paymentReceived: false };
const checkout = { ...order, checkoutUrl: 'https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=verified', manageToken: 'owner-token' };
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
class Element {
  constructor() { this.listeners = {}; this.hidden = false; this.disabled = false; this.checked = false; this.textContent = ''; this.value = ''; this.dataset = {}; this.classes = new Set(); this.classList = { add: n => this.classes.add(n), remove: n => this.classes.delete(n), contains: n => this.classes.has(n), toggle: (n, flag) => flag ? this.classes.add(n) : this.classes.delete(n) }; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  async fire(type) { for (const fn of this.listeners[type] || []) await fn({ preventDefault() {} }); }
  querySelector() { return this.small ||= new Element(); }
}
function fixture({ configValue = config, configStatus = 200, search = '', post = async () => response(checkout, 201), getOrder = async () => response(order), noStorage = false } = {}) {
  const ids = new Map(), get = id => { if (!ids.has(id)) ids.set(id, new Element()); return ids.get(id); };
  const lots = ['COUNTRY-041', 'PARQUE-118', 'SUL-203'].map(code => { const e = new Element(); e.dataset = { lot: code, label: code, place: 'Cidade' }; return e; }); lots[0].classes.add('active');
  const paid = [new Element()], trial = [new Element()], links = [new Element()]; trial[0].hidden = true;
  const doc = { documentElement: new Element(), getElementById: get, querySelectorAll: selector => selector === '.lot' ? lots : selector === '[data-building-trial]' ? trial : selector === '[data-building-paid]' ? paid : selector.startsWith('a[href') ? links : [] };
  const form = get('checkout-form'); form.elements = { consent: new Element() }; form.reportValidity = () => true;
  for (const id of ['paid-option', 'trial-consent-label', 'trial-conditions', 'manage-reservation', 'continue-subscription', 'cancel-subscription', 'storeAction']) get(id).hidden = true;
  get('lotCode').value = 'COUNTRY-041';
  const storage = new Map(), requests = [], redirects = [], timers = new Map();
  const store = { getItem: key => { if (noStorage) throw Error('blocked'); return storage.get(key); }, setItem: (key, value) => { if (noStorage) throw Error('blocked'); storage.set(key, value); } };
  const win = { location: { search, assign: value => redirects.push(value) }, localStorage: store, sessionStorage: store, history: { replaceState: (a,b,url) => { win.location.search = url; } }, confirm: () => true, setTimeout: fn => { const id = timers.size + 1; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id), FormData: class { *[Symbol.iterator]() { yield* Object.entries({ lotCode: get('lotCode').value, businessName: 'Loja Teste', segment: 'Agro e jardinagem', name: 'Responsável', email: 'owner@example.test', whatsapp: '62000000000', consent: form.elements.consent.checked ? 'on' : '' }); } } };
  const fetchImpl = async (path, options = {}) => { requests.push({ path, ...options }); if (path === '/api/lots') return response({ lots: lots.map(e => ({ code: e.dataset.lot, status: 'available' })) }); if (path.endsWith('/config')) return response(configValue, configStatus); if (path.startsWith('/api/orders/')) return getOrder(); return post(path, options); };
  return { doc, win, fetchImpl, get, form, lots, trial, paid, links, requests, redirects, storage, timers };
}
function accept(h) { h.form.elements.consent.checked = true; h.get('trialConsent').checked = true; return h.get('trialConsent').fire('change'); }

test('trial offer requires exact enabled server contract, not a truthy flag or altered terms', () => {
  assert.equal(validTrial(config), true);
  for (const patch of [{ enabled: false }, { enabled: 'true' }, { days: 29 }, { monthlyCents: 2000 }, { version: 'other' }]) assert.equal(validTrial({ buildingTrial: { ...config.buildingTrial, ...patch } }), false);
  assert.equal(validTrial(null), false);
});
test('payload requires explicit trial consent and cannot silently substitute the paid plan', () => {
  assert.throws(() => subscriptionPayload({}, { config, trial: true, accepted: false }), /aceite/);
  assert.throws(() => subscriptionPayload({}, { config: {}, trial: true, accepted: true }), /Nenhuma assinatura paga/);
  assert.throws(() => subscriptionPayload({}, { config: null, trial: false }), /Aguarde/);
  assert.deepEqual(subscriptionPayload({ email: ' user@example.test ', consent: true, zipCode: 'secret', planCode: 'other' }, { config, trial: true, accepted: true }), { lotCode: '', businessName: '', segment: '', name: '', whatsapp: '', email: 'user@example.test', consent: true, planCode: TRIAL_PLAN, trialConsent: true, trialConsentVersion: TRIAL_VERSION });
});
test('checkout starts disabled and unchecked; a single accepted submit reserves once and stores the management token', async () => {
  let release; const h = fixture({ post: () => new Promise(resolve => { release = resolve; }) }); h.get('trialConsent').checked = true;
  const page = mountBuildingCheckout(h);
  assert.equal(h.get('checkout-button').disabled, true); assert.equal(h.get('trialConsent').checked, false);
  await page.ready;
  assert.equal(h.get('trial-conditions').hidden, false); assert.equal(h.get('checkout-button').disabled, true);
  await h.form.fire('submit'); assert.equal(h.requests.filter(r => r.method === 'POST').length, 0);
  await accept(h); const first = h.form.fire('submit'); await h.form.fire('submit');
  assert.equal(h.requests.filter(r => r.method === 'POST').length, 1);
  release(response(checkout, 201)); await first;
  const submitted = JSON.parse(h.requests.find(r => r.method === 'POST').body);
  assert.equal(submitted.planCode, TRIAL_PLAN); assert.equal(submitted.trialConsent, true);
  assert.equal(h.storage.get('vc_store_reservation-1'), 'owner-token'); assert.deepEqual(h.redirects, [checkout.checkoutUrl]);
});
test('explicit paid plan remains paid and never includes trial consent fields', async () => {
  const h = fixture({ search: '?plano=basic_monthly' }); await mountBuildingCheckout(h).ready;
  assert.equal(h.get('trial-consent-label').hidden, true); assert.match(h.get('checkout-button').textContent, /R\$10/);
  h.form.elements.consent.checked = true; await h.form.elements.consent.fire('change'); await h.form.fire('submit');
  const body = JSON.parse(h.requests.find(r => r.method === 'POST').body); assert.equal(body.planCode, 'basic_monthly'); assert.equal(body.trialConsent, undefined);
});
test('unavailable trial link remains blocked with a separate explicit paid option', async () => {
  const h = fixture({ search: '?plano=basic_monthly_trial', configValue: { buildingTrial: { ...config.buildingTrial, enabled: false } } }); await mountBuildingCheckout(h).ready;
  await accept(h); await h.form.fire('submit'); assert.equal(h.get('checkout-button').disabled, true); assert.equal(h.get('paid-option').hidden, false); assert.equal(h.get('trial-conditions').hidden, true); assert.equal(h.requests.filter(r => r.method === 'POST').length, 0);
});
test('failed config keeps purchase disabled and cannot expose a free offer', async () => {
  const h = fixture({ configStatus: 503 }); await mountBuildingCheckout(h).ready; await accept(h); await h.form.fire('submit'); assert.equal(h.get('checkout-button').disabled, true); assert.equal(h.get('trial-conditions').hidden, true); assert.equal(h.requests.filter(r => r.method === 'POST').length, 0);
});
test('declined eligibility does not downgrade or send a second request', async () => {
  const h = fixture({ post: async () => response({ error: 'Este e-mail já utilizou o teste grátis.' }, 409) }); await mountBuildingCheckout(h).ready; await accept(h); await h.form.fire('submit');
  assert.match(h.get('message').textContent, /já utilizou/); assert.equal(h.redirects.length, 0); assert.equal(h.requests.filter(r => r.method === 'POST').length, 1); assert.equal(JSON.parse(h.requests.at(-1).body).planCode, TRIAL_PLAN);
});
test('network-ambiguous creation is not repeated; invalid provider URL cannot redirect', async () => {
  for (const post of [async () => { throw Error('network'); }, async () => ({ ...response({}), json: async () => { throw Error('JSON'); } }), async () => response({ ...checkout, checkoutUrl: 'https://evil.example/steal' })]) {
    const h = fixture({ post }); await mountBuildingCheckout(h).ready; await accept(h); await h.form.fire('submit'); await h.form.fire('submit'); assert.equal(h.redirects.length, 0); assert.equal(h.requests.filter(r => r.method === 'POST').length, 1); assert.equal(h.get('checkout-button').disabled, true);
  }
  for (const url of ['javascript:alert(1)', 'http://mercadopago.com.br', 'https://mercadopago.com.br.evil.test/', 'https://a:b@mercadopago.com.br/']) assert.equal(safeSubscriptionCheckout(url), '');
});
test('blocked browser storage preserves the management link before opening a new checkout tab', async () => {
  const h = fixture({ noStorage: true }); await mountBuildingCheckout(h).ready; await accept(h); await h.form.fire('submit'); assert.equal(h.redirects.length, 0); assert.equal(h.get('manage-reservation').hidden, false); assert.match(h.get('manage-reservation').href, /token=owner-token/); assert.equal(h.get('continue-subscription').href, checkout.checkoutUrl); assert.equal(h.get('continue-subscription').hidden, false);
});
test('lot changes preserve explicit plan selection and exact chosen lot', async () => {
  const h = fixture({ search: '?plano=basic_monthly&lote=COUNTRY-041' }); await mountBuildingCheckout(h).ready; await h.lots[1].fire('click'); assert.match(h.win.location.search, /plano=basic_monthly/); assert.equal(h.get('lotCode').value, 'PARQUE-118');
});
test('landing exposes free copy and updates links only with valid server opt-in', async () => {
  for (const enabled of [true, false]) {
    const h = fixture({ configValue: { buildingTrial: { ...config.buildingTrial, enabled } } }); assert.equal(await mountBuildingLanding(h), enabled); assert.equal(h.trial[0].hidden, !enabled); assert.equal(h.paid[0].hidden, enabled); if (enabled) assert.equal(h.links[0].href, '/comprar-lote.html?plano=' + TRIAL_PLAN);
  }
});
test('order view separates authorized trial, paid receipt, pending authorization, expiry and cancellation', () => {
  assert.equal(buildingOrderState({ ...order, status: 'approved', subscriptionStatus: 'authorized', trialActive: true }).kind, 'trial');
  assert.doesNotMatch(buildingOrderState({ ...order, status: 'approved', trialActive: true }).title, /Pagamento/);
  assert.equal(buildingOrderState(order).kind, 'pending');
  assert.equal(buildingOrderState({ ...order, status: 'approved', paymentReceived: true }).kind, 'paid');
  assert.equal(buildingOrderState({ ...order, status: 'approved', trialActive: true, trialUntil: '2000-01-01T00:00:00Z' }).active, false);
  assert.equal(buildingOrderState({ ...order, subscriptionStatus: 'awaiting_payment' }).active, false);
  assert.equal(buildingOrderState({ ...order, status: 'cancelled', trialActive: true }).kind, 'closed');
  assert.equal(buildingOrderState(null).active, false);
  assert.equal(buildingOrderState({ status: 'approved', billingType: 'one_time' }).kind, 'paid');
});
test('success query without verified order cannot claim payment or trial activation', async () => {
  const h = fixture({ search: '?resultado=sucesso&ref=reservation-1', getOrder: async () => response({}, 503) }); await mountBuildingStatus(h).ready; assert.doesNotMatch(h.get('title').textContent, /recebido|ativo|confirmado/i); assert.match(h.get('billing-message').textContent, /Nenhuma confirmação/); assert.equal(h.get('cancel-subscription').hidden, true);
});
test('pending reservation can be cancelled once with its token without approved materials access', async () => {
  const h = fixture({ search: '?ref=reservation-1&token=owner-token', post: async () => response({ ok: true, status: 'cancelled', subscriptionStatus: 'cancelled' }) }); await mountBuildingStatus({ ...h, panel: true }).ready;
  assert.equal(h.get('cancel-subscription').hidden, false); assert.equal(canCancelBuilding(order, ''), false);
  assert.equal(h.doc.documentElement.dataset.subscriptionSuspended, 'true');
  await h.get('cancel-subscription').fire('click'); await h.get('cancel-subscription').fire('click');
  const posts = h.requests.filter(r => r.method === 'POST'); assert.equal(posts.length, 1); assert.equal(posts[0].path, '/api/store-portal/reservation-1/cancel-subscription'); assert.deepEqual(JSON.parse(posts[0].body), { token: 'owner-token' }); assert.equal(h.get('form').hidden, true); assert.match(h.get('billing-title').textContent, /encerrada/);
});
test('uncertain cancellation never displays confirmation', async () => {
  const h = fixture({ search: '?ref=reservation-1&token=owner-token', post: async () => response({ error: 'O cancelamento está em verificação.' }, 502) }); await mountBuildingStatus(h).ready; await h.get('cancel-subscription').fire('click'); assert.match(h.get('billing-message').textContent, /verificação/); assert.doesNotMatch(h.get('title').textContent, /encerrada/); assert.equal(h.get('cancel-subscription').hidden, false);
});
test('panel unlock callback runs only after the server changes pending to active', async () => {
  let current = order, activations = 0;
  const h = fixture({ search: '?ref=reservation-1&token=owner-token', getOrder: async () => response(current) });
  await mountBuildingStatus({ ...h, panel: true, onActivated: () => activations++ }).ready;
  assert.equal(activations, 0); assert.equal(h.doc.documentElement.dataset.subscriptionSuspended, 'true');
  current = { ...order, status: 'approved', subscriptionStatus: 'authorized', trialActive: true };
  await h.get('refresh-subscription').fire('click'); await h.get('refresh-subscription').fire('click');
  assert.equal(activations, 1); assert.equal(h.doc.documentElement.dataset.subscriptionSuspended, 'false');
});
test('checkout has no legacy duplicate submits, Pix or payer address; terms and all trial surfaces use same module', () => {
  const html = name => readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');
  const buy = html('comprar-lote.html'); assert.doesNotMatch(buy, /pix-button|pix-panel|streetName|zipCode|stopImmediatePropagation|oldFetch|\/mercadopago\/checkout/); assert.equal((buy.match(/mountBuildingCheckout\(\)/g) || []).length, 1); assert.match(buy, /id="checkout-button"[^>]*disabled/); assert.doesNotMatch(buy, /id="trialConsent"[^>]*checked/);
  for (const page of ['comprar-lote.html', 'pagamento.html', 'painel-lojista.html', 'para-empresas.html']) assert.match(html(page), /building-trial\.js\?v=1/);
  const terms = html('termos-predio-digital.html'); for (const text of ['solicitação da reserva', 'R$10 por mês', 'antes da data e horário da primeira cobrança', 'imediatamente', 'uma oferta por e-mail']) assert.ok(terms.includes(text));
});
