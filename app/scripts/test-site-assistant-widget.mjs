import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySiteAssistantPath as classify, safeSiteAssistantUrl, siteAssistantDismissed, SITE_ASSISTANT_DISMISS_MS as DAY } from '../public/site-assistant-policy.js';
import { injectSiteAssistant } from '../site-assistant-page.js';
import { mountSiteAssistant } from '../public/site-assistant.js';

class Node {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.doc = doc; this.children = []; this.attrs = {}; this.listeners = {}; this.dataset = {}; this.hidden = false; this.value = ''; this._text = ''; this.className = ''; this.classList = { add: name => { this.className += ' ' + name; } }; }
  set textContent(value) { this._text = value; this.children = []; }
  get textContent() { return this._text + this.children.map(n => n.textContent).join(''); }
  get isConnected() { return this === this.doc.body || !!this.parent?.isConnected; }
  get firstElementChild() { return this.children[0]; }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const node of this.children) node.parent = null; this.children = []; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); this.parent = null; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  hasAttribute(key) { return Object.hasOwn(this.attrs, key); }
  removeAttribute(key) { delete this.attrs[key]; }
  getAttribute(key) { return this.attrs[key] ?? null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn); }
  fire(type, data = {}) { const event = { target: this, preventDefault() {}, stopPropagation() {}, ...data }; for (const fn of this.listeners[type] || []) fn(event); }
  focus() { this.doc.activeElement = this; this.doc.focusCalls++; }
  matches(selector) { return selector.split(',').some(s => { s = s.trim(); return s.startsWith('.') ? this.className.split(' ').includes(s.slice(1)) : s.startsWith('#') ? this.id === s.slice(1) : s.toUpperCase() === this.tagName; }); }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function harness({ path = '/receitas', disabled = false, stored = null, sessionStorage = new Map(), storageFails = false, context = {}, chat, failChat = false } = {}) {
  let clock = 100000, tid = 0; const intervals = new Map(), requests = [], storage = new Map();
  if (stored !== null) storage.set('vc-assistant-dismiss-until-v1', String(stored));
  const doc = { hidden: false, focusCalls: 0, activity: false, listeners: {}, createElement(tag) { return new Node(tag, this); }, addEventListener: Node.prototype.addEventListener, removeEventListener: Node.prototype.removeEventListener, fire: Node.prototype.fire };
  doc.body = new Node('body', doc); doc.documentElement = new Node('html', doc); doc.activeElement = doc.body;
  doc.querySelector = selector => {
    if (selector === '[data-vc-assistant]') return doc.body.children.find(n => n.dataset.vcAssistant) || null;
    if (selector.startsWith('dialog[open]')) return doc.activity ? {} : null;
    return doc.body.querySelector(selector);
  };
  const storageApi = map => ({ getItem(key) { if (storageFails) throw new Error('Storage unavailable'); return map.get(key) ?? null; }, setItem(key, value) { if (storageFails) throw new Error('Storage unavailable'); map.set(key, value); }, removeItem(key) { if (storageFails) throw new Error('Storage unavailable'); map.delete(key); } });
  const win = { document: doc, location: { pathname: path, origin: 'https://vitrinecity.com' }, listeners: {}, localStorage: storageApi(storage), sessionStorage: storageApi(sessionStorage), CustomEvent: class { constructor(type) { this.type = type; } }, dispatchEvent(event) { for (const fn of this.listeners[event.type] || []) fn(event); }, addEventListener: Node.prototype.addEventListener, removeEventListener: Node.prototype.removeEventListener,
    setTimeout: () => ++tid, clearTimeout() {}, setInterval(fn) { const id = ++tid; intervals.set(id, fn); return id; }, clearInterval: id => intervals.delete(id) };
  const fetcher = async (url, options) => {
    requests.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    if (url.includes('/context?')) return { ok: true, json: async () => ({ enabled: !disabled, context: { path: classify(path).path, kind: 'recipe' }, greeting: 'Olá! Sou a Lia. Posso ajudar?', quickActions: [{ label: 'Como comprar', message: 'Como faço para comprar?' }], offers: [], ...context }) };
    if (url.endsWith('/chat')) { if (chat) return chat(); return { ok: !failChat, json: async () => ({ reply: 'Veja as informações confirmadas do produto.', offers: [] }) }; }
    return { ok: true, json: async () => ({ ok: true }) };
  };
  const mount = () => mountSiteAssistant({ window: win, document: doc, fetch: fetcher, now: () => clock });
  return { doc, win, requests, storage, sessionStorage, mount, get intervals() { return intervals.size; }, advance(ms) { for (let n = 0; n < ms; n += 1000) { clock += Math.min(1000, ms - n); for (const fn of [...intervals.values()]) fn(); } }, find: selector => doc.body.querySelector(selector), count: endpoint => requests.filter(r => r.url.endsWith(endpoint)).length };
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test('positive public route policy covers aliases, articles and excludes private/AMP routes', () => {
  for (const path of ['/', '/multiverso/', '/vitriny-multiverse-explore.html', '/loja', '/loja/abc/loja', '/produto/13', '/produto/13/adubo', '/ofertas/kit', '/servicos-digitais.html', '/cursos', '/cursos/curso', '/receitas', '/plantas-e-jardinagem', '/inteligencia-artificial', '/artigo/salada', '/stories']) assert.equal(classify(path).enabled, true, path);
  for (const path of ['/admin.html', '/admin/dashboard', '/api/site-assistant/chat', '/entrar-cidade.html', '/carteira', '/minha-conta.html', '/pedidos.html', '/pagamento.html', '/checkout', '/chat-social.html', '/meus-creditos', '/stories/salada', '/unknown', '/loja?token=secret', '//loja', '/loja/%2e%2e/admin', '/loja/../admin', '/loja\\admin']) assert.equal(classify(path).enabled, false, path);
  assert.deepEqual(classify('/oracao-do-dia/'), { enabled: true, kind: 'prayer', proactive: false, commercial: false, path: '/oracao-do-dia' });
});

test('injection is idempotent, preserves source classes and does not inject into AMP or private HTML', () => {
  const html = '<!doctype html><html lang="pt-BR"><body class="original"><h1>Receita</h1></body></html>';
  const injected = injectSiteAssistant(html, { path: '/receitas' });
  assert.match(injected, /body class="original"/); assert.equal((injected.match(/site-assistant\.js/g) || []).length, 1);
  assert.equal(injectSiteAssistant(injected, { path: '/receitas' }), injected);
  for (const amp of ['amp', 'amp=""', '⚡']) { const source = html.replace('<html ', '<html ' + amp + ' '); assert.equal(injectSiteAssistant(source, { path: '/receitas' }), source); }
  assert.equal(injectSiteAssistant(html, { path: '/stories/salada' }), html);
  assert.equal(injectSiteAssistant(html, { path: '/receitas', amp: true }), html);
  assert.equal(injectSiteAssistant(html, { path: '/pagamento.html' }), html);
});

test('safe links reject scripts, credentials, token queries and private destinations; signup CTA remains allowed', () => {
  const origin = 'https://vitrinecity.com';
  for (const value of ['javascript:alert(1)', 'data:text/html,test', '//evil.test', 'https://u:p@evil.test/', '/admin.html', '/carteira', '/produto/13?token=secret', 'http://external.test']) assert.equal(safeSiteAssistantUrl(value, origin), '', value);
  for (const value of ['/entrar-cidade.html', '/centro-educacional.html#curso', '/ofertas/kit', 'https://chat.whatsapp.com/known']) assert.ok(safeSiteAssistantUrl(value, origin));
  assert.equal(classify('/entrar-cidade.html').enabled, false);
  assert.equal(safeSiteAssistantUrl('/assets/prayer/image.png', origin, { image: true }), origin + '/assets/prayer/image.png');
});

test('dismissal lasts 24 hours and rejects malformed or indefinite stored expiry', () => {
  assert.equal(siteAssistantDismissed(100001, 100000), true);
  assert.equal(siteAssistantDismissed(100000 + DAY, 100000), true);
  for (const until of ['bad', null, 100000, 100000 + DAY + 1]) assert.equal(siteAssistantDismissed(until, 100000), false);
});

test('excluded pages create no DOM, fetch, timers or singleton', () => {
  for (const path of ['/admin.html', '/checkout', '/stories/a', '/entrar-cidade.html']) { const h = harness({ path }); assert.equal(h.mount(), null); assert.equal(h.doc.body.children.length, 0); assert.equal(h.requests.length, 0); assert.equal(h.intervals, 0); }
});

test('singleton mounts once and disabled backend removes it without chat request', async () => {
  const h = harness(); const widget = h.mount(); await widget.ready;
  assert.equal(h.mount(), widget); assert.equal(h.requests.filter(r => r.url.includes('/context?')).length, 1); assert.equal(h.count('/chat'), 0); assert.equal(h.doc.focusCalls, 0);
  const off = harness({ disabled: true }); await off.mount().ready; assert.equal(off.doc.body.children.length, 0); assert.equal(off.intervals, 0);
});

test('invitation waits for ten visible idle seconds and does not move focus or call AI', async () => {
  const h = harness(); await h.mount().ready; const invitation = h.find('.vc-assistant-invite');
  h.advance(9000); assert.equal(invitation.hidden, true); h.doc.hidden = true; h.doc.fire('visibilitychange'); h.advance(20000); assert.equal(invitation.hidden, true);
  h.doc.hidden = false; h.doc.fire('visibilitychange'); h.advance(1000); assert.equal(invitation.hidden, false);
  assert.equal(h.doc.focusCalls, 0); assert.equal(h.count('/chat'), 0);
  assert.equal(h.requests.filter(r => r.body?.type === 'invitation').length, 1);
});

test('purchase forms pause invitation time and hide visible invitation until idle', async () => {
  const h = harness(); await h.mount().ready; const invitation = h.find('.vc-assistant-invite');
  h.advance(5000); h.doc.activity = true; h.advance(30000); assert.equal(invitation.hidden, true);
  h.doc.activity = false; h.advance(6000); assert.equal(invitation.hidden, false);
  h.doc.activity = true; h.advance(1000); assert.equal(invitation.hidden, true);
  h.doc.activity = false; h.advance(1000); assert.equal(invitation.hidden, false);
});

test('dismiss persists for 24h; manual reopening and Escape remain available with focus return', async () => {
  const h = harness(); const widget = h.mount(); await widget.ready; h.advance(10000);
  h.find('.vc-assistant-quiet').fire('click'); assert.equal(h.find('.vc-assistant-invite').hidden, true); assert.equal(h.intervals, 0);
  assert.equal(Number(h.storage.get('vc-assistant-dismiss-until-v1')), 110000 + DAY);
  widget.launcher.focus(); widget.launcher.fire('click'); assert.equal(h.find('.vc-assistant-panel').hidden, false); assert.equal(h.doc.activeElement.tagName, 'TEXTAREA'); assert.equal(h.count('/chat'), 0);
  h.find('.vc-assistant-panel').fire('keydown', { key: 'Escape' }); assert.equal(h.find('.vc-assistant-panel').hidden, true); assert.equal(h.doc.activeElement, widget.launcher);
  const returned = harness({ stored: 110000 + DAY }); await returned.mount().ready; returned.advance(20000); assert.equal(returned.find('.vc-assistant-invite').hidden, true);
});

test('quick action fills the composer only; explicit form submit sends once while busy', async () => {
  let finish; const h = harness({ chat: () => new Promise(resolve => { finish = resolve; }) }); const widget = h.mount(); await widget.ready; widget.open();
  h.find('.vc-assistant-suggestion').fire('click'); assert.equal(h.find('textarea').value, 'Como faço para comprar?'); assert.equal(h.count('/chat'), 0);
  const form = h.find('form'); form.fire('submit'); form.fire('submit'); assert.equal(h.count('/chat'), 1);
  const call = h.requests.find(r => r.url.endsWith('/chat')); assert.deepEqual(call.body, { message: 'Como faço para comprar?', contextPath: '/receitas' }); assert.equal(call.options.credentials, 'same-origin');
  finish({ ok: true, json: async () => ({ reply: 'Resposta correta.', offers: [] }) }); await flush(); assert.match(h.find('.vc-assistant-log').textContent, /Resposta correta/);
  assert.equal(h.requests.filter(r => /message|purchase/.test(r.body?.type || '')).length, 0);
});

test('failed chat never retries automatically and keeps message for explicit retry', async () => {
  const h = harness({ failChat: true }); const widget = h.mount(); await widget.ready; widget.open(); h.find('textarea').value = 'Quero comprar'; h.find('form').fire('submit'); await flush(); h.advance(90000);
  assert.equal(h.count('/chat'), 1); assert.equal(h.find('textarea').value, 'Quero comprar'); assert.match(h.find('.vc-assistant-status').textContent, /Não consegui confirmar/);
});

test('offers are text nodes, unsafe links omitted and clicks use registered asset only', async () => {
  const h = harness({ context: { offers: [{ id: 'x', title: '<script>wrong</script>', url: 'javascript:alert(1)' }, { id: 'affiliate:kit', assetType: 'affiliate', assetId: 'kit', title: '<img onerror=bad>', url: '/ofertas/kit', kind: 'affiliate', description: 'Oferta confirmada.' }] } }); const widget = h.mount(); await widget.ready;
  assert.equal(h.find('.vc-assistant-offers').children.length, 1); assert.equal(h.find('.vc-assistant-offers').querySelectorAll('img').length, 0); assert.match(h.find('h3').textContent, /<img onerror=bad>/);
  assert.match(h.find('.vc-assistant-disclosure').textContent, /comissão/); h.find('.vc-assistant-offer-link').fire('click');
  assert.deepEqual(h.requests.find(r => r.body?.type === 'offer_click').body, { type: 'offer_click', assetType: 'affiliate', assetId: 'kit' });
});

test('prayer stays passive and filters commerce while keeping prayer navigation', async () => {
  const h = harness({ path: '/oracao-do-dia.html', context: { offers: [{ title: 'Produto', url: '/produto/13' }], actions: [{ label: 'Oração de hoje', url: '/oracao-do-dia.html', kind: 'internal' }, { label: 'Comprar', url: '/produto/13', kind: 'internal' }] } }); const widget = h.mount(); await widget.ready; h.advance(30000);
  assert.equal(h.intervals, 0); assert.equal(h.find('.vc-assistant-invite').hidden, true); assert.equal(h.find('.vc-assistant-offers').children.length, 0); assert.equal(h.find('.vc-assistant-actions').children.length, 1); assert.equal(h.doc.focusCalls, 0);
  widget.open(); assert.equal(h.find('.vc-assistant-panel').hidden, false);
});

test('no session IDs, conversation, personal name or cookies are persisted in browser storage', async () => {
  const h = harness({ context: { visitorName: 'Luís', greeting: 'Olá, Luís. Sou a Lia.' } }); const widget = h.mount(); await widget.ready; widget.dismiss(); widget.open();
  assert.deepEqual([...h.storage.keys()], ['vc-assistant-dismiss-until-v1']); assert.match(h.find('.vc-assistant-intro').textContent, /Olá, Luís/); assert.equal(h.doc.cookie, undefined);
  h.find('textarea').value = 'Meu nome é Luís e procuro adubo'; h.find('form').fire('submit'); await flush();
  assert.deepEqual([...h.sessionStorage.keys()], ['vc-assistant-panel-until-v1']);
  for (const value of [...h.storage.values(), ...h.sessionStorage.values()]) assert.match(value, /^\d+$/, 'Only UI expiry timestamps may be stored');
  assert.doesNotMatch(JSON.stringify([...h.storage, ...h.sessionStorage]), /Luís|adubo|Resposta|sessionId|cookie/);
  widget.destroy(); assert.equal(h.doc.body.children.length, 0); assert.equal(h.intervals, 0);
});

const PANEL_KEY = 'vc-assistant-panel-until-v1';
const PANEL_KEEP_MS = 30 * 60 * 1000;
const previousConversation = [
  {role: 'user', content: 'Preciso de adubo para as minhas plantas.', contextPath: '/plantas-e-jardinagem'},
  {role: 'assistant', content: 'Qual planta você está cuidando?', contextPath: '/plantas-e-jardinagem'},
];

test('server history resumes as safe text without a second introduction or starter suggestions', async () => {
  const h = harness({ path: '/produto/13', context: {history: previousConversation,
    greeting: 'Olá novamente, vou me apresentar outra vez.'} });
  await h.mount().ready;
  const rows = h.find('.vc-assistant-log').children;
  assert.equal(rows.length, 2); assert.equal(rows[0].querySelector('strong').textContent, 'Você');
  assert.equal(rows[1].querySelector('strong').textContent, 'Lia');
  assert.equal(rows[1].querySelector('p').textContent, previousConversation[1].content);
  assert.equal(h.find('.vc-assistant-intro').hidden, true);
  assert.equal(h.find('.vc-assistant-intro').textContent, '');
  assert.equal(h.find('.vc-assistant-quick').hidden, true); assert.equal(h.find('.vc-assistant-suggestion'), null);
  assert.equal(h.find('.vc-assistant-panel').hidden, true); assert.equal(h.doc.focusCalls, 0);
  h.advance(10000); const invite = h.find('.vc-assistant-invite');
  assert.equal(invite.hidden, false); assert.match(invite.textContent, /Continuar conversa/);
  assert.doesNotMatch(invite.textContent, /me apresentar|Sou a Lia|sou a Lia/); assert.equal(h.count('/chat'), 0);
});

test('same-tab navigation restores the open panel from server history without moving focus or replaying an open event', async () => {
  const h = harness({chat: async () => ({ok: true, json: async () => ({reply: 'Qual planta você está cuidando?',
    actions: [{label: 'Ver o adubo', url: '/produto/13', assetType: 'navigation', assetId: 'loja'}]})})});
  const first = h.mount(); await first.ready; first.open();
  h.find('textarea').value = 'Preciso de adubo para as minhas plantas.'; h.find('form').fire('submit'); await flush();
  const destination = h.find('.vc-assistant-action');
  assert.equal(destination.href, 'https://vitrinecity.com/produto/13'); assert.equal(destination.target, undefined);
  let prevented = false; destination.fire('click', {preventDefault() { prevented = true; }}); assert.equal(prevented, false);
  h.win.dispatchEvent({type: 'pagehide'}); first.destroy();
  const next = harness({path: '/produto/13', sessionStorage: h.sessionStorage, context: {history: previousConversation}});
  const reader = next.doc.createElement('button'); next.doc.body.append(reader); next.doc.activeElement = reader;
  await next.mount().ready;
  assert.equal(next.find('.vc-assistant-panel').hidden, false);
  assert.equal(next.doc.activeElement, reader); assert.equal(next.doc.focusCalls, 0);
  assert.equal(next.find('.vc-assistant-log').getAttribute('aria-live'), 'off');
  assert.equal(next.find('.vc-assistant-log').children.length, 2); assert.equal(next.intervals, 0);
  assert.equal(next.count('/chat'), 0); assert.equal(next.requests.filter(r => r.body?.type === 'open').length, 0);
  next.find('textarea').value = 'É uma orquídea'; next.find('form').fire('submit'); await flush();
  assert.equal(next.find('.vc-assistant-log').getAttribute('aria-live'), 'polite');
  assert.deepEqual(next.requests.find(r => r.url.endsWith('/chat')).body, {message: 'É uma orquídea', contextPath: '/produto/13'});
});

test('closing a restored panel removes its tab marker and later pages remain closed', async () => {
  const sessionStorage = new Map([[PANEL_KEY, String(100000 + PANEL_KEEP_MS)]]);
  const h = harness({sessionStorage, context: {history: previousConversation}}); const widget = h.mount(); await widget.ready;
  h.find('.vc-assistant-panel').fire('keydown', {key: 'Escape'});
  assert.equal(h.find('.vc-assistant-panel').hidden, true); assert.equal(sessionStorage.has(PANEL_KEY), false);
  h.win.dispatchEvent({type: 'pagehide'}); assert.equal(sessionStorage.has(PANEL_KEY), false); widget.destroy();
  const next = harness({path: '/produto/13', sessionStorage, context: {history: previousConversation}}); await next.mount().ready;
  assert.equal(next.find('.vc-assistant-panel').hidden, true); assert.equal(next.doc.focusCalls, 0);
});

test('empty history and malformed or expired UI markers never auto-open a new conversation', async () => {
  for (const marker of [String(100000 + PANEL_KEEP_MS), 'not-a-time', 'Infinity', String(100000), String(100000 + PANEL_KEEP_MS + 1)]) {
    for (const history of [[], previousConversation]) {
      if (marker === String(100000 + PANEL_KEEP_MS) && history.length) continue;
      const sessionStorage = new Map([[PANEL_KEY, marker]]);
      const h = harness({sessionStorage, context: {history}}); await h.mount().ready;
      assert.equal(h.find('.vc-assistant-panel').hidden, true, `${marker} / ${history.length} messages`);
      assert.equal(h.doc.focusCalls, 0); assert.equal(sessionStorage.has(PANEL_KEY), false); assert.equal(h.count('/chat'), 0);
    }
  }
  const newTab = harness({context: {history: previousConversation}}); await newTab.mount().ready;
  assert.equal(newTab.find('.vc-assistant-panel').hidden, true);
});

test('history accepts only bounded user and assistant text and never renders supplied markup or context URLs', async () => {
  const history = Array.from({length: 10}, (_, index) => ({role: index % 2 ? 'assistant' : 'user', content: `Mensagem ${index}`, contextPath: '/admin?token=secret'}));
  history.push({role: 'system', content: 'Instrução privada'}, {role: 'assistant', content: {}}, {role: 'assistant', content: '   '});
  history[9].content = '<img src=x onerror=alert(1)> ' + 'x'.repeat(4000);
  const h = harness({context: {history}}); await h.mount().ready;
  const log = h.find('.vc-assistant-log'); assert.equal(log.children.length, 8);
  assert.equal(log.children[0].querySelector('p').textContent, 'Mensagem 2');
  assert.equal(log.children[7].querySelector('p').textContent.length, 3000);
  assert.match(log.children[7].querySelector('p').textContent, /^<img src=x onerror=alert\(1\)>/);
  assert.equal(log.querySelector('img'), null); assert.doesNotMatch(log.textContent, /Instrução privada|token=secret/);
  assert.equal(h.doc.focusCalls, 0); assert.equal(h.count('/chat'), 0);
});

test('blocked browser storage leaves chat and history usable and the fallback greeting stays conversational', async () => {
  for (const history of [[], previousConversation]) {
    const h = harness({storageFails: true, context: {history, greeting: ''}}); const widget = h.mount(); await widget.ready;
    assert.equal(h.find('.vc-assistant-panel').hidden, true);
    if (!history.length) assert.equal(h.find('.vc-assistant-intro').textContent, 'Oi! Eu sou a Lia 😊 Estou aqui para ajudar você. O que está procurando?');
    assert.match(h.find('.vc-assistant-heading').textContent, /Lia · Assistente com IA/);
    widget.open(); h.find('textarea').value = 'Oi, Lia'; h.find('form').fire('submit'); await flush();
    assert.equal(h.count('/chat'), 1); assert.match(h.find('.vc-assistant-log').textContent, /informações confirmadas/);
    widget.close(); assert.equal(h.find('.vc-assistant-panel').hidden, true);
    assert.deepEqual([...h.storage, ...h.sessionStorage], []);
  }
});
