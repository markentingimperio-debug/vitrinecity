import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const publicFile = name => new URL('../public/' + name, import.meta.url);
const html = readFileSync(publicFile('neural-billing.html'), 'utf8');
const js = readFileSync(publicFile('neural-billing.js'), 'utf8');
const css = readFileSync(publicFile('neural-billing.css'), 'utf8');
execFileSync(process.execPath, ['--check', fileURLToPath(publicFile('neural-billing.js'))]);
assert.match(html, /lang="pt-BR"/);
assert.match(html, /name="viewport"/);
assert.match(html, /type="password"/);
assert.match(html, /role="alert"/);
assert.match(html, /aria-live="polite"/);
assert.match(html, /sem cobrança automática/);
assert.match(html, /não reais/);
assert.match(html, /não processa pagamentos nem renova assinaturas/);
assert.match(html, /Créditos da Neural são separados das moedas de anúncios/);
assert.doesNotMatch(html, /<iframe\b|on(?:click|load|error)=|R\$\s*\d|value="\d+"/i);
assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function|localStorage|sessionStorage/);
assert.doesNotMatch(js, /[?&](?:token|access_token|key)=/i);
assert.match(js, /headers\['x-store-token'\] = state\.token/);
assert.match(js, /headers\['x-neural-request'\] = '1'/);
assert.match(js, /credentials: 'same-origin'/);
assert.match(js, /cache: 'no-store'/);
assert.match(js, /crypto\.randomUUID\(\)/);
assert.match(js, /428: 'mfa'/);
assert.match(js, /addEventListener\('pagehide'/);
assert.match(css, /@media\(max-width:700px\)/);
assert.match(css, /focus-visible/);
for (const [, id] of js.matchAll(/\$\('([^']+)'\)/g)) assert.ok(html.includes('id="' + id + '"'), 'Missing DOM selector: ' + id);

class Element {
  constructor(tag = 'div') { this.tagName = tag; this.textContent = ''; this.value = ''; this.hidden = false; this.disabled = false; this.children = []; this.listeners = {}; this.attributes = {}; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tagName === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
  click() { return this.listeners.click?.({ preventDefault() {} }); }
}
const settle = () => new Promise(resolve => setImmediate(resolve));
function harness({ search = '', respond, confirm = () => true }) {
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, new Element()]));
  const created = [], calls = [], timers = new Map(), windowListeners = new Map(); let timerId = 0, uuid = 0;
  runInNewContext(js, {
    document: { getElementById: id => elements.get(id), createElement: tag => { const element = new Element(tag); created.push(element); return element; } },
    location: { search }, URLSearchParams, AbortController,
    window: { addEventListener: (name, listener) => windowListeners.set(name, listener), confirm },
    crypto: { randomUUID: () => 'billing-request-' + (++uuid) },
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => { calls.push({ url, options }); const result = await respond(url, options, calls); return { ok: (result.status || 200) < 400, status: result.status || 200, json: async () => result.data }; }
  });
  return { elements, created, calls, windowListeners, timers, submit: id => elements.get(id).listeners.submit({ preventDefault() {} }), set: (id, value) => { elements.get(id).value = value; } };
}
const base = '/api/admin/vitriny-neural/billing';
const malicious = '<img src=x onerror="alert(1)">';
const plan = { code: 'piloto', name: malicious, monthlyCredits: 1000, taskReserveCredits: 100, inputCreditsPer1000: 2, outputCreditsPer1000: 5 };
const status = { ok: true, enabled: true, active: true, plan, grantedCredits: 1000, usedCredits: 40, reservedCredits: 100, availableCredits: 860, periodStart: 1800000000000, periodEnd: 1801000000000 };
const period = { id: 'period-1', grantedCredits: 1000, periodStart: status.periodStart, periodEnd: status.periodEnd, revokedAt: null };
let failGrant = false, confirmations = true;
const admin = harness({ confirm: () => confirmations, respond: (url, options) => {
  if (options.method === 'POST') {
    if (failGrant && url.endsWith('/periods')) { failGrant = false; throw new Error('Simulated lost response'); }
    return { data: { ok: true } };
  }
  if (url === base + '/plans') return { data: { ok: true, items: [plan] } };
  if (url.endsWith('/status')) return { data: status };
  if (url.endsWith('/periods')) return { data: { ok: true, items: [period] } };
  if (url.endsWith('/ledger')) return { data: { ok: true, items: [{ id: 'entry-1', type: 'review_required', taskId: 'task-1', amountCredits: 100, reason: malicious, createdAt: status.periodStart }] } };
  throw Error('Unexpected request: ' + url);
} });
await settle();
assert.equal(admin.calls.length, 1, 'Admin initially loads plans, not an arbitrary store');
assert.equal(admin.elements.get('admin-controls').hidden, false);
assert.equal(admin.elements.get('grant-period').disabled, true, 'A store must be loaded before granting');
admin.set('store-reference', 'loja/um'); await admin.submit('store-form');
assert.ok(admin.calls.some(call => call.url === base + '/stores/loja%2Fum/status'));
assert.equal(admin.elements.get('available').textContent, '860');
assert.match(admin.elements.get('plan-detail').textContent, /<img/);
assert.equal(admin.elements.get('ledger').children[0].children[1].textContent, 'Aguardando revisão');
assert.equal(admin.elements.get('ledger').children[0].children[2].textContent, 'Sem débito final');
assert.match(admin.elements.get('ledger').children[0].children[3].textContent, /<img/);
assert.ok(!admin.created.some(element => ['img', 'script', 'iframe'].includes(element.tagName)), 'Remote markup is inert text');
const beforeBlank = admin.calls.length; await admin.submit('plan-form');
assert.equal(admin.calls.length, beforeBlank, 'Empty numbers are not silently converted to zero');
for (const [id, value] of Object.entries({ 'plan-code': 'novo', 'plan-name': 'Plano novo', 'plan-monthly': '500', 'plan-reserve': '50', 'plan-input': '2', 'plan-output': '5' })) admin.set(id, value);
await admin.submit('plan-form');
const planRequest = admin.calls.find(call => call.url === base + '/plans' && call.options.method === 'POST');
assert.deepEqual(JSON.parse(planRequest.options.body), { code: 'novo', name: 'Plano novo', monthlyCredits: 500, taskReserveCredits: 50, inputCreditsPer1000: 2, outputCreditsPer1000: 5 });
assert.equal(planRequest.options.headers['x-neural-request'], '1');
assert.equal(planRequest.options.headers['content-type'], 'application/json');
admin.set('period-plan', plan.code); admin.set('period-start', '2027-01-01T00:00'); admin.set('period-end', '2027-02-01T00:00');
confirmations = false; const beforeCancel = admin.calls.length; await admin.submit('period-form');
assert.equal(admin.calls.length, beforeCancel, 'Cancelled confirmation cannot grant credits');
confirmations = true; failGrant = true; await admin.submit('period-form');
assert.match(admin.elements.get('error').textContent, /operação pode ter sido registrada/);
await admin.submit('period-form');
const grants = admin.calls.filter(call => call.options.method === 'POST' && call.url.endsWith('/periods'));
assert.equal(grants.length, 2); assert.deepEqual(JSON.parse(grants[0].options.body), JSON.parse(grants[1].options.body), 'Ambiguous retry reuses identical idempotency key');
assert.equal(typeof JSON.parse(grants[0].options.body).periodStart, 'number');
assert.equal(JSON.parse(grants[0].options.body).planCode, 'piloto');
await admin.elements.get('periods').querySelectorAll('button')[0].click();
assert.ok(admin.calls.some(call => call.url.endsWith('/periods/period-1/revoke') && call.options.body === '{}'));
admin.set('resolve-task', 'task/1'); admin.set('resolve-credits', '0'); admin.set('resolve-reason', 'Processamento não iniciado, confirmado pela operação.'); await admin.submit('resolve-form');
const reconcile = admin.calls.find(call => call.url.endsWith('/tasks/task%2F1/resolve'));
assert.equal(JSON.parse(reconcile.options.body).chargeCredits, 0); assert.ok(JSON.parse(reconcile.options.body).idempotencyKey);

const store = harness({ search: '?store=loja%2Fum', respond: (url, options) => {
  assert.equal(options.method, 'GET', 'Merchant UI only reads its billing records');
  assert.equal(options.headers['x-store-token'], 'secret-store-access'); assert.ok(!url.includes('secret-store-access'));
  assert.ok(url.startsWith('/api/store-portal/loja%2Fum/neural/billing/'));
  return { data: url.endsWith('/status') ? status : { ok: true, items: [] } };
} });
assert.equal(store.calls.length, 0, 'No merchant data is requested before entering a token');
assert.equal(store.elements.get('admin-controls').hidden, true);
assert.equal(store.elements.get('admin-store').hidden, true);
assert.equal(store.elements.get('chat-link').href, '/neural-workspace.html?store=loja%2Fum');
store.set('access-token', 'secret-store-access'); await store.submit('access-form');
assert.equal(store.calls.length, 2); assert.equal(store.elements.get('access-token').value, '');
for (const form of ['plan-form', 'period-form', 'resolve-form', 'store-form']) await store.submit(form);
assert.equal(store.calls.length, 2, 'Even manually triggered admin forms cannot mutate merchant scope');
store.elements.get('disconnect').click();
assert.equal(store.elements.get('available').textContent, '—'); assert.equal(store.elements.get('ledger').children.length, 0); assert.equal(store.elements.get('refresh').disabled, true);
await store.elements.get('refresh').click(); assert.equal(store.calls.length, 2);

const mfa = harness({ search: '?store=loja', respond: () => ({ status: 428, data: { ok: false, error: malicious } }) });
mfa.set('access-token', 'access'); await mfa.submit('access-form');
assert.match(mfa.elements.get('error').textContent, /segundo fator/); assert.doesNotMatch(mfa.elements.get('error').textContent, /<img/);

const expired = harness({ search: '?store=loja', respond: url => ({ data: url.endsWith('/status') ? { ...status, active: false, state: 'expired', spendableCredits: 0 } : { ok: true, items: [] } }) });
expired.set('access-token', 'access'); await expired.submit('access-form');
assert.equal(expired.elements.get('available').textContent, '0', 'Historic balance is not presented as spendable after expiration');
assert.match(expired.elements.get('period-status').textContent, /Período encerrado/);

let release;
const lateResponse = new Promise(resolve => { release = resolve; });
const stale = harness({ search: '?store=loja', respond: () => lateResponse });
stale.set('access-token', 'secret'); const connecting = stale.submit('access-form');
stale.windowListeners.get('pagehide')(); release({ data: { ...status, items: [] } }); await connecting;
assert.equal(stale.elements.get('available').textContent, '—', 'Late response cannot repaint private data after pagehide');
assert.equal(stale.elements.get('ledger').children.length, 0);
assert.ok(stale.calls.every(call => call.options.signal.aborted), 'Outstanding requests are aborted when leaving');
assert.equal(stale.timers.size, 0);
console.log('OK: Neural billing UI — safe DOM, explicit credits, admin confirmations/idempotency, merchant read-only auth/MFA and stale-response cleanup.');
