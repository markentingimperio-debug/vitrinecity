import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { classifySiteAssistantPath as classify, siteAssistantContextPath, safeSiteAssistantUrl, siteAssistantDismissed, SITE_ASSISTANT_DISMISS_MS as DAY } from '../public/site-assistant-policy.js';
import { injectSiteAssistant } from '../site-assistant-page.js';
import { mountSiteAssistant } from '../public/site-assistant.js';

class Node {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.doc = doc; this.children = []; this.attrs = {}; this.listeners = {}; this.dataset = {}; this.hidden = false; this.value = ''; this._text = ''; this.className = ''; this.classList = { add: name => { this.className += ' ' + name; } }; if(tag==='iframe')this.contentWindow={}; }
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

function harness({ path = '/receitas', search = '', disabled = false, stored = null, sessionStorage = new Map(), storageFails = false, context = {}, answer = {}, chat, failChat = false } = {}) {
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
  const win = { document: doc, location: { pathname: path, search, origin: 'https://vitrinecity.com' }, listeners: {}, localStorage: storageApi(storage), sessionStorage: storageApi(sessionStorage), CustomEvent: class { constructor(type) { this.type = type; } }, dispatchEvent(event) { for (const fn of this.listeners[event.type] || []) fn(event); }, addEventListener: Node.prototype.addEventListener, removeEventListener: Node.prototype.removeEventListener,
    setTimeout: () => ++tid, clearTimeout() {}, setInterval(fn) { const id = ++tid; intervals.set(id, fn); return id; }, clearInterval: id => intervals.delete(id) };
  const fetcher = async (url, options) => {
    requests.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    if (url.includes('/context?')) return { ok: true, json: async () => ({ enabled: !disabled, context: { path: new URL(url,'https://vitrinecity.com').searchParams.get('path'), kind: 'recipe' }, greeting: 'Olá! Sou a Lia. Posso ajudar?', quickActions: [{ label: 'Como comprar', message: 'Como faço para comprar?' }], offers: [], ...context }) };
    if (url.endsWith('/chat')) { if (chat) return chat(); return { ok: !failChat, json: async () => ({ reply: 'Veja as informações confirmadas do produto.', offers: [], ...answer }) }; }
    return { ok: true, json: async () => ({ ok: true }) };
  };
  const mount = () => mountSiteAssistant({ window: win, document: doc, fetch: fetcher, now: () => clock });
  return { doc, win, requests, storage, sessionStorage, mount, get intervals() { return intervals.size; }, advance(ms) { for (let n = 0; n < ms; n += 1000) { clock += Math.min(1000, ms - n); for (const fn of [...intervals.values()]) fn(); } }, find: selector => doc.body.querySelector(selector), count: endpoint => requests.filter(r => r.url.endsWith(endpoint)).length };
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const ask = async (h,message='Pode me mostrar?') => {h.find('textarea').value=message;h.find('.vc-assistant-form').fire('submit');await flush();};
const bridge = (h,action,url,extra={}) => h.win.dispatchEvent({type:'message',origin:h.win.location.origin,source:h.find('iframe').contentWindow,data:{type:'vc-lia-viewer',action,url},...extra});

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

test('invitation waits for three visible idle seconds and does not move focus or call AI', async () => {
  const h = harness(); await h.mount().ready; const invitation = h.find('.vc-assistant-invite');
  h.advance(2000); assert.equal(invitation.hidden, true); h.doc.hidden = true; h.doc.fire('visibilitychange'); h.advance(20000); assert.equal(invitation.hidden, true);
  h.doc.hidden = false; h.doc.fire('visibilitychange'); h.advance(1000); assert.equal(invitation.hidden, false);
  assert.equal(h.doc.focusCalls, 0); assert.equal(h.count('/chat'), 0);
  assert.equal(h.requests.filter(r => r.body?.type === 'invitation').length, 1);
});

test('purchase forms pause invitation time and hide visible invitation until idle', async () => {
  const h = harness(); await h.mount().ready; const invitation = h.find('.vc-assistant-invite');
  h.advance(1000); h.doc.activity = true; h.advance(30000); assert.equal(invitation.hidden, true);
  h.doc.activity = false; h.advance(3000); assert.equal(invitation.hidden, false);
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

test('free conversation starts without choices or automatic cards; explicit form submit sends once while busy', async () => {
  let finish; const h = harness({ chat: () => new Promise(resolve => { finish = resolve; }) }); const widget = h.mount(); await widget.ready; widget.open();
  assert.equal(h.find('.vc-assistant-suggestion'),null); assert.equal(h.find('.vc-assistant-offers').children.length,0); assert.equal(h.find('.vc-assistant-actions').children.length,0);
  h.find('textarea').value='Como faço para comprar?'; assert.equal(h.count('/chat'), 0);
  const form = h.find('form'); form.fire('submit'); form.fire('submit'); assert.equal(h.count('/chat'), 1);
  const call = h.requests.find(r => r.url.endsWith('/chat')); assert.deepEqual(call.body, { message: 'Como faço para comprar?', contextPath: '/receitas' }); assert.equal(call.options.credentials, 'same-origin');
  finish({ ok: true, json: async () => ({ reply: 'Resposta correta.', offers: [] }) }); await flush(); assert.match(h.find('.vc-assistant-log').textContent, /Resposta correta/);
  assert.equal(h.requests.filter(r => /message|purchase/.test(r.body?.type || '')).length, 0);
});

test('failed chat never retries automatically and keeps message for explicit retry', async () => {
  const h = harness({ failChat: true }); const widget = h.mount(); await widget.ready; widget.open(); h.find('textarea').value = 'Quero comprar'; h.find('form').fire('submit'); await flush(); h.advance(90000);
  assert.equal(h.count('/chat'), 1); assert.equal(h.find('textarea').value, 'Quero comprar'); assert.match(h.find('.vc-assistant-status').textContent, /Não consegui confirmar/);
});

test('a verified LIA5 benefit is shown after a response and never as an initial prompt or arbitrary coupon', async () => {
  for (const [offer,expected] of [[{code:'LIA5',percent:5,description:'5% na compra própria. Não inclui frete.'},true],[{code:'OTHER',percent:99,description:'<script>inventado</script>'},false],[null,false]]) {
    const h = harness({answer:{discountOffer:offer}});const widget=h.mount();await widget.ready;
    const note=h.find('.vc-assistant-discount');assert.equal(note.hidden,true);widget.open();
    h.find('textarea').value='Como comprar?';h.find('form').fire('submit');await flush();
    assert.equal(note.hidden,!expected);if(expected)assert.match(note.textContent,/LIA5.*Não inclui frete/);
  }
});

test('offers are text nodes, unsafe links omitted and clicks use registered asset only', async () => {
  const h = harness({ answer: { offers: [{ id: 'x', title: '<script>wrong</script>', url: 'javascript:alert(1)' }, { id: 'affiliate:kit', assetType: 'affiliate', assetId: 'kit', title: '<img onerror=bad>', url: '/ofertas/kit', kind: 'affiliate', description: 'Oferta confirmada.' }] } }); const widget = h.mount(); await widget.ready;widget.open();h.find('textarea').value='Mostre a oferta';h.find('form').fire('submit');await flush();
  assert.equal(h.find('.vc-assistant-offers').children.length, 1); assert.equal(h.find('.vc-assistant-offers').querySelectorAll('img').length, 0); assert.match(h.find('h3').textContent, /<img onerror=bad>/);
  assert.match(h.find('.vc-assistant-disclosure').textContent, /comissão/); h.find('.vc-assistant-offer-link').fire('click');
  assert.deepEqual(h.requests.find(r => r.body?.type === 'offer_click').body, { type: 'offer_click', assetType: 'affiliate', assetId: 'kit' });
});

test('prayer stays passive and filters commerce while keeping prayer navigation', async () => {
  const h = harness({ path: '/oracao-do-dia.html', answer: { offers: [{ title: 'Produto', url: '/produto/13' }], actions: [{ label: 'Oração de hoje', url: '/oracao-do-dia.html', kind: 'internal' }, { label: 'Comprar', url: '/produto/13', kind: 'internal' }] } }); const widget = h.mount(); await widget.ready; h.advance(30000);
  assert.equal(h.intervals, 0); assert.equal(h.find('.vc-assistant-invite').hidden, true); assert.equal(h.doc.focusCalls, 0);
  widget.open();h.find('textarea').value='Mostre a oração de hoje';h.find('form').fire('submit');await flush();
  assert.equal(h.find('.vc-assistant-panel').hidden, false);assert.equal(h.find('.vc-assistant-offers').children.length, 0);assert.equal(h.find('.vc-assistant-actions').children.length, 1);
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
  let prevented = false; destination.fire('click', {preventDefault() { prevented = true; }}); assert.equal(prevented, true);
  assert.equal(h.find('iframe').src,'https://vitrinecity.com/produto/13?lia=1');
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

test('minimizing preserves the transcript and unfinished message without dismissing the assistant', async () => {
  const h=harness(); const widget=h.mount(); await widget.ready; widget.open();
  h.find('textarea').value='Preciso de uma forma'; h.find('form').fire('submit'); await flush();
  const transcript=h.find('.vc-assistant-log').textContent;
  h.find('textarea').value='Qual tamanho você sugere?'; const minimize=h.find('.vc-assistant-minimize'); minimize.focus(); minimize.fire('click');
  assert.equal(h.find('.vc-assistant-panel').hidden,true); assert.equal(h.find('.vc-assistant-invite').hidden,true);
  assert.equal(h.find('.vc-assistant-log').textContent,transcript); assert.equal(h.find('textarea').value,'Qual tamanho você sugere?');
  assert.equal(h.find('.vc-assistant-log').getAttribute('aria-live'),'off'); assert.equal(h.doc.activeElement,widget.launcher);
  assert.equal(widget.launcher.getAttribute('aria-expanded'),'false'); assert.equal(h.sessionStorage.has(PANEL_KEY),false);
  assert.equal(h.storage.has('vc-assistant-dismiss-until-v1'),false); assert.equal(h.requests.filter(r=>r.body?.type==='dismiss').length,0);
  h.advance(60000); assert.equal(h.find('.vc-assistant-invite').hidden,true); assert.equal(h.intervals,0);
  widget.launcher.fire('click'); assert.equal(h.find('.vc-assistant-panel').hidden,false);
  assert.equal(h.find('.vc-assistant-log').textContent,transcript); assert.equal(h.find('textarea').value,'Qual tamanho você sugere?');
  assert.equal(h.doc.activeElement,h.find('textarea')); assert.equal(h.sessionStorage.has('vc-assistant-minimized-until-v1'),false);
  assert.equal(h.count('/chat'),1);
});

test('a minimized conversation stays minimized on the next page and never stores its text', async () => {
  const h=harness({context:{history:previousConversation}}); const first=h.mount(); await first.ready; first.open(); first.minimize();
  h.win.dispatchEvent({type:'pagehide'}); first.destroy();
  assert.deepEqual([...h.sessionStorage.keys()],['vc-assistant-minimized-until-v1']);
  assert.match(h.sessionStorage.get('vc-assistant-minimized-until-v1'),/^\d+$/);
  const next=harness({path:'/produto/13',sessionStorage:h.sessionStorage,context:{history:previousConversation}});
  const widget=next.mount(); await widget.ready; next.advance(20000);
  assert.equal(next.find('.vc-assistant-panel').hidden,true); assert.equal(next.find('.vc-assistant-invite').hidden,true);
  assert.equal(next.doc.focusCalls,0); assert.equal(next.intervals,0); assert.equal(next.count('/chat'),0);
  assert.equal(next.find('.vc-assistant-log').children.length,2);
  widget.launcher.fire('click'); assert.equal(next.find('.vc-assistant-panel').hidden,false);
  assert.equal(next.find('.vc-assistant-log').children.length,2);
  next.find('.vc-assistant-panel-close').fire('click');
  assert.equal(next.sessionStorage.has('vc-assistant-minimized-until-v1'),false);
  assert.equal(next.storage.has('vc-assistant-dismiss-until-v1'),true);
});

test('a response arriving while minimized stays quiet and remains available when reopened', async () => {
  let finish;const h=harness({chat:()=>new Promise(resolve=>{finish=resolve;})});const widget=h.mount();await widget.ready;widget.open();
  h.find('textarea').value='Qual tamanho?';h.find('form').fire('submit');widget.minimize();
  finish({ok:true,json:async()=>({reply:'Confira as medidas no produto.'})});await flush();
  assert.equal(h.find('.vc-assistant-panel').hidden,true);assert.equal(h.find('.vc-assistant-log').getAttribute('aria-live'),'off');
  assert.equal(h.count('/chat'),1);assert.match(h.find('.vc-assistant-log').textContent,/Confira as medidas/);
  widget.launcher.fire('click');assert.match(h.find('.vc-assistant-log').textContent,/Confira as medidas/);
});

test('maximize toggles a labelled non-modal reading size without moving focus or changing conversation state', async () => {
  const h=harness({context:{history:previousConversation}});const widget=h.mount();await widget.ready;widget.open();
  const panel=h.find('.vc-assistant-panel'),expand=h.find('.vc-assistant-expand'),transcript=h.find('.vc-assistant-log').textContent;
  expand.focus();const focusCalls=h.doc.focusCalls,storageBefore=[...h.sessionStorage];
  assert.equal(expand.getAttribute('aria-label'),'Ampliar conversa');assert.equal(expand.getAttribute('aria-pressed'),'false');
  expand.fire('click');assert.equal(panel.dataset.expanded,'true');assert.equal(expand.getAttribute('aria-label'),'Restaurar tamanho');
  assert.equal(expand.getAttribute('aria-pressed'),'true');assert.equal(expand.textContent,'Restaurar');
  assert.equal(h.doc.activeElement,expand);assert.equal(h.doc.focusCalls,focusCalls);assert.equal(panel.getAttribute('aria-modal'),null);
  assert.equal(panel.getAttribute('role'),null);assert.equal(h.find('.vc-assistant-log').textContent,transcript);
  assert.deepEqual([...h.sessionStorage],storageBefore);assert.equal(h.storage.size,0);
  expand.fire('click');assert.equal(panel.dataset.expanded,'false');assert.equal(expand.getAttribute('aria-pressed'),'false');
  assert.equal(expand.textContent,'Ampliar');assert.equal(h.doc.focusCalls,focusCalls);assert.equal(h.count('/chat'),0);
});

test('window controls retain visible labels and work with blocked storage; invalid minimized markers expire', async () => {
  const h=harness({storageFails:true});const widget=h.mount();await widget.ready;widget.open();
  const controls=h.find('.vc-assistant-window-controls').querySelectorAll('button');
  assert.deepEqual(controls.map(control=>control.textContent),['Minimizar','Ampliar','Fechar']);
  for(const control of controls){assert.equal(control.type,'button');assert.ok(control.getAttribute('aria-label'));assert.equal(control.getAttribute('tabindex'),null);}
  widget.toggleExpanded();widget.minimize();assert.equal(h.find('.vc-assistant-panel').hidden,true);widget.launcher.fire('click');
  assert.equal(h.find('.vc-assistant-panel').hidden,false);assert.equal(h.find('.vc-assistant-panel').dataset.expanded,'true');
  assert.deepEqual([...h.storage,...h.sessionStorage],[]);
  for(const marker of ['garbage','100000',String(100000+PANEL_KEEP_MS+1)]){
    const next=harness({sessionStorage:new Map([['vc-assistant-minimized-until-v1',marker]]),context:{history:previousConversation}});await next.mount().ready;
    assert.equal(next.sessionStorage.has('vc-assistant-minimized-until-v1'),false);next.advance(10000);assert.equal(next.find('.vc-assistant-invite').hidden,false);
  }
});

test('expanded layout stays within desktop and mobile viewports and controls can shrink and wrap at zoom', () => {
  const css=readFileSync(new URL('../public/site-assistant.css',import.meta.url),'utf8');
  const expanded=css.match(/\.vc-assistant-panel\[data-expanded="true"\]\{([^}]+)\}/)?.[1];assert.ok(expanded);
  assert.match(expanded,/width:min\(720px,calc\(100vw - 36px\)\)/);
  assert.match(expanded,/max-height:calc\(100dvh - 112px\)/);
  assert.match(css,/@media\(max-width:600px\)\{\.vc-assistant-panel\[data-expanded="true"\]\{[^}]*width:auto;/);
  assert.match(css,/\.vc-assistant-window-controls\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)[^}]*min-width:0/);
  assert.match(css,/\.vc-assistant-window-control\{[^}]*min-height:48px[^}]*max-width:100%[^}]*white-space:normal[^}]*overflow-wrap:anywhere/);
  assert.match(css,/\.vc-assistant-panel\{[^}]*overflow-y:auto/);
  assert.match(css,/@media\(max-height:560px\)\{\.vc-assistant-panel\[data-expanded="true"\]\{height:auto;max-height:calc\(100dvh - 16px\)/);
});

test('mobile conversation, expanded and city panels use both container edges instead of viewport width including the scrollbar',()=>{
  const css=readFileSync(new URL('../public/site-assistant.css',import.meta.url),'utf8');
  const mobile=css.split(/\r?\n/).filter(line=>line.startsWith('@media(max-width:600px)')).join('\n');
  for(const selector of ['.vc-assistant-panel','.vc-assistant-panel[data-expanded="true"]','.vc-assistant[data-kind="city"] .vc-assistant-panel']){
    const rule=mobile.split(selector+'{')[1]?.split('}')[0];assert.ok(rule,selector);
    for(const declaration of ['left:max(8px,env(safe-area-inset-left))','right:max(8px,env(safe-area-inset-right))','width:auto'])assert.ok(rule.split(';').includes(declaration),selector+' '+declaration);
  }
  assert.doesNotMatch(mobile,/width:calc\(100vw - 16px\)/,'A viewport scrollbar must not push the left edge outside its containing block.');
});

test('public course checkout allows only manual course help and derives a canonical context from its slug', () => {
  assert.deepEqual(classify('/course-checkout.html'),{enabled:true,kind:'course_checkout',proactive:false,commercial:true,path:'/course-checkout.html'});
  assert.equal(siteAssistantContextPath('/course-checkout.html','?curso=canva-para-lojas&utm_source=facebook'),'/cursos/canva-para-lojas');
  assert.equal(siteAssistantContextPath('/produto/13','?curso=ignored&email=private@example.test'),'/produto/13');
  assert.equal(siteAssistantContextPath('/checkout','?curso=canva-para-lojas'),'');
  const html='<html><body><form id="course-payment-form"></form></body></html>';
  assert.match(injectSiteAssistant(html,{path:'/course-checkout.html'}),/site-assistant\.js/);
  assert.equal(injectSiteAssistant(html,{path:'/pagamento.html'}),html);
});

test('missing, duplicate or malformed course slugs create no widget, request or timers', async () => {
  for(const search of ['', '?curso=', '?curso=../admin', '?curso=%2Fadmin', '?curso=canva&curso=canva', '?curso=canva&curso=other',
    '?curso=canva%00lojas', '?curso=Canva', '?curso=canva--lojas', '?curso=canva-', '?curso='+('a'.repeat(102)), '?Curso=canva']){
    const h=harness({path:'/course-checkout.html',search});assert.equal(h.mount(),null,search);
    assert.equal(h.requests.length,0);assert.equal(h.doc.body.children.length,0);assert.equal(h.intervals,0);
  }
  const unavailable=harness({path:'/course-checkout.html',search:'?curso=curso-retirado',disabled:true});await unavailable.mount().ready;
  assert.equal(unavailable.doc.body.children.length,0);assert.equal(unavailable.count('/chat'),0);
  const mismatch=harness({path:'/course-checkout.html',search:'?curso=canva-para-lojas',context:{context:{path:'/cursos/outro',kind:'course'}}});await mismatch.mount().ready;
  assert.equal(mismatch.doc.body.children.length,0);assert.equal(mismatch.count('/chat'),0);
});

test('checkout leaves registration fields and focus untouched, never auto-opens, and sends only course context plus explicit chat', async () => {
  const h=harness({path:'/course-checkout.html',search:'?curso=canva-para-lojas&email=private@example.test&nome=Maria&token=private-token',
    sessionStorage:new Map([[PANEL_KEY,String(100000+PANEL_KEEP_MS)]]),context:{history:previousConversation}});
  const paymentForm=h.doc.createElement('form');paymentForm.id='course-payment-form';
  const email=h.doc.createElement('input');email.name='email';email.value='personal@example.test';paymentForm.append(email);h.doc.body.append(paymentForm);h.doc.activeElement=email;
  const widget=h.mount();await widget.ready;h.advance(60000);
  assert.equal(h.find('.vc-assistant-panel').hidden,true);assert.equal(h.find('.vc-assistant-invite').hidden,true);
  assert.equal(h.doc.activeElement,email);assert.equal(h.doc.focusCalls,0);assert.equal(h.intervals,0);
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'/api/site-assistant/context?path=%2Fcursos%2Fcanva-para-lojas');
  assert.equal(h.find('.vc-assistant-log').children.length,2);assert.equal(paymentForm.listeners.submit,undefined);
  widget.launcher.fire('click');h.find('textarea').value='Como acesso o curso depois da compra?';h.find('.vc-assistant-form').fire('submit');await flush();
  assert.deepEqual(h.requests.find(r=>r.url.endsWith('/chat')).body,{message:'Como acesso o curso depois da compra?',contextPath:'/cursos/canva-para-lojas'});
  assert.doesNotMatch(JSON.stringify(h.requests),/private@example|personal@example|private-token|Maria|utm_source/);
  assert.equal(email.value,'personal@example.test');assert.equal(paymentForm.listeners.submit,undefined);
});

test('a minimized course conversation remains available on checkout with working reading-size controls', async () => {
  const h=harness({path:'/cursos/canva-para-lojas',context:{history:previousConversation}});const first=h.mount();await first.ready;first.open();first.minimize();
  h.win.dispatchEvent({type:'pagehide'});first.destroy();
  const checkout=harness({path:'/course-checkout.html',search:'?curso=canva-para-lojas',sessionStorage:h.sessionStorage,context:{history:previousConversation}});
  const widget=checkout.mount();await widget.ready;checkout.advance(60000);
  assert.equal(checkout.find('.vc-assistant-panel').hidden,true);assert.equal(checkout.find('.vc-assistant-invite').hidden,true);
  assert.equal(checkout.doc.focusCalls,0);widget.launcher.fire('click');const transcript=checkout.find('.vc-assistant-log').textContent;
  const expand=checkout.find('.vc-assistant-expand');expand.focus();const focusCalls=checkout.doc.focusCalls;expand.fire('click');
  assert.equal(checkout.find('.vc-assistant-panel').dataset.expanded,'true');assert.equal(checkout.doc.focusCalls,focusCalls);
  widget.minimize();widget.launcher.fire('click');
  assert.equal(checkout.find('.vc-assistant-log').textContent,transcript);assert.equal(checkout.find('.vc-assistant-panel').dataset.expanded,'true');
  assert.equal(checkout.count('/chat'),0);assert.equal(checkout.storage.size,0);
});

test('checkout hides only its own course checkout action so a helpful link cannot reset the registration form', async () => {
  const actions=[
    {label:'Abrir resumo deste curso',url:'/course-checkout.html?curso=canva-para-lojas'},
    {label:'Outro curso',url:'/course-checkout.html?curso=marketing-digital'},
    {label:'Conteúdo deste curso',url:'/cursos/canva-para-lojas'},
    {label:'Referência externa',url:'https://example.test/course-checkout.html?curso=canva-para-lojas'}
  ];
  const h=harness({path:'/course-checkout.html',search:'?curso=canva-para-lojas',
    chat:async()=>({ok:true,json:async()=>({reply:'Use as opções de cadastro e acesso no resumo deste curso.',actions})})});
  const widget=h.mount();await widget.ready;widget.open();
  h.find('textarea').value='Preciso criar uma conta?';h.find('.vc-assistant-form').fire('submit');await flush();
  assert.deepEqual(h.find('.vc-assistant-actions').children.map(node=>node.textContent),['Outro curso','Conteúdo deste curso','Referência externa (site parceiro, nova aba)']);
  assert.equal(h.find('.vc-assistant-actions').children[0].href,'https://vitrinecity.com/course-checkout.html?curso=marketing-digital');
  const landing=harness({path:'/cursos/canva-para-lojas',answer:{actions}});const landingWidget=landing.mount();await landingWidget.ready;landingWidget.open();await ask(landing);
  assert.equal(landing.find('.vc-assistant-actions').children[0].textContent,'Abrir resumo deste curso');
});

test('Lia header owns its natural height instead of inheriting the education page fixed header dimensions', () => {
  const host=readFileSync(new URL('../public/centro-educacional.html',import.meta.url),'utf8');
  const css=readFileSync(new URL('../public/site-assistant.css',import.meta.url),'utf8');
  assert.match(host,/header\{height:74px/);
  assert.match(host,/@media\(max-width:760px\)\{header\{height:66px/);
  const heading=css.match(/\.vc-assistant \.vc-assistant-heading\{([^}]+)\}/)?.[1];
  assert.ok(heading);
  // Both fixed host heights must lose to this scoped rule. Natural height
  // includes the controls row; flex cannot shrink that row behind the log.
  for(const declaration of ['height:auto','min-height:0','max-height:none','flex:0 0 auto','flex-shrink:0','position:static','margin:0']){
    assert.ok(heading.split(';').includes(declaration),declaration);
  }
  assert.match(css,/\.vc-assistant-window-controls\{[^}]*display:grid/);
  assert.match(css,/@media\(max-width:600px\)\{[^\n]*\.vc-assistant \.vc-assistant-heading\{padding:14px 12px 13px 17px\}/);
  assert.match(css,/@media\(max-height:560px\)\{[^\n]*\.vc-assistant \.vc-assistant-heading\{padding:8px 12px\}/);
  assert.doesNotMatch(css,/\.vc-assistant(?: \.vc-assistant)?-heading\{[^}]*height:\d+px/);
});

test('Lia can direct a learner to their courses without mounting on that private page or exposing session query strings', async () => {
  const origin='https://vitrinecity.com';
  assert.equal(classify('/meus-cursos.html').enabled,false);
  assert.equal(siteAssistantContextPath('/meus-cursos.html',''),'');
  assert.equal(safeSiteAssistantUrl('/meus-cursos.html',origin),origin+'/meus-cursos.html');
  for(const query of ['token=private','sessionId=private','password=private','auth=private','secret=private']){
    assert.equal(safeSiteAssistantUrl('/meus-cursos.html?'+query,origin),'');
  }
  const privatePage=harness({path:'/meus-cursos.html'});
  assert.equal(privatePage.mount(),null);assert.equal(privatePage.requests.length,0);assert.equal(privatePage.intervals,0);
  const actions=[{label:'Ver meus cursos',url:'/meus-cursos.html',kind:'internal',assetType:'navigation',assetId:'courses'}];
  const h=harness({path:'/course-checkout.html',search:'?curso=canva-para-lojas',answer:{actions}});const widget=h.mount();await widget.ready;widget.open();await ask(h);
  const link=h.find('.vc-assistant-actions').children[0];
  assert.equal(link.textContent,'Ver meus cursos');assert.equal(link.href,origin+'/meus-cursos.html');
});

test('opening Lia ignores automatic welcome suggestions, offers and actions until a visitor asks',async()=>{
  const h=harness({context:{offers:[{title:'Curso',url:'/cursos/curso'}],actions:[{label:'Comprar',url:'/produto/13'}]}});
  const widget=h.mount();await widget.ready;widget.open();
  assert.equal(h.find('.vc-assistant-quick').hidden,true);assert.equal(h.find('.vc-assistant-offers').children.length,0);assert.equal(h.find('.vc-assistant-actions').children.length,0);
  assert.equal(h.find('iframe').src,undefined);assert.equal(h.find('.vc-assistant-content').hidden,true);assert.equal(h.count('/chat'),0);
  assert.match(h.find('.vc-assistant-intro').textContent,/Lia/);assert.equal(h.find('.vc-assistant-form').hidden,false);
});

test('nested pages never mount a second Lia even without a lia query marker',()=>{
  const h=harness();h.win.self=h.win;h.win.top={};assert.equal(h.mount(),null);assert.equal(h.requests.length,0);assert.equal(h.doc.body.children.length,0);
});

test('an internal result opens in the panel and conversation resumes with public viewer context only',async()=>{
  const actions=[{label:'Ver o curso',url:'/course-checkout.html?curso=canva-para-lojas',assetType:'course',assetId:'canva-para-lojas'}];
  const h=harness({answer:{actions}});const widget=h.mount();await widget.ready;widget.open();await ask(h,'Quero aprender a criar imagens');
  const originalLog=h.find('.vc-assistant-log').textContent;let prevented=false;
  h.find('.vc-assistant-action').fire('click',{preventDefault(){prevented=true;}});
  const frame=h.find('iframe');assert.equal(prevented,true);assert.equal(frame.src,'https://vitrinecity.com/course-checkout.html?curso=canva-para-lojas&lia=1');
  assert.equal(h.win.location.pathname,'/receitas');assert.equal(h.find('.vc-assistant-form').hidden,true);
  assert.equal(frame.getAttribute('sandbox'),'allow-scripts allow-same-origin allow-forms');
  bridge(h,'ready',frame.src,{data:{type:'vc-lia-viewer',action:'ready',url:frame.src,name:'private-name',password:'private-password'}});
  h.find('.vc-assistant-content-back').fire('click');assert.equal(h.find('.vc-assistant-form').hidden,false);
  assert.equal(h.find('.vc-assistant-log').textContent,originalLog);assert.equal(h.find('.vc-assistant-content-resume').hidden,false);
  await ask(h,'Como faço para continuar?');
  assert.deepEqual(h.requests.filter(r=>r.url.endsWith('/chat')).at(-1).body,{message:'Como faço para continuar?',contextPath:'/cursos/canva-para-lojas'});
  assert.doesNotMatch(JSON.stringify(h.requests),/private-name|private-password|lia=1/);
  h.find('.vc-assistant-content-resume').fire('click');assert.equal(h.find('iframe'),frame);assert.equal(frame.src,'https://vitrinecity.com/course-checkout.html?curso=canva-para-lojas&lia=1');
  widget.minimize();widget.launcher.fire('click');assert.equal(h.find('iframe'),frame);assert.equal(h.find('.vc-assistant-content').hidden,false);
  h.find('.vc-assistant-expand').fire('click');assert.equal(h.find('iframe'),frame);assert.equal(h.find('.vc-assistant-panel').dataset.expanded,'true');
});

test('another viewer document needs an explicit confirmation and same content does not reload',async()=>{
  const h=harness({answer:{actions:[{label:'Abrir',url:'/produto/13'},{label:'Outro conteúdo',url:'/course-checkout.html?curso=canva-para-lojas'}]}});const widget=h.mount();await widget.ready;widget.open();await ask(h);h.find('.vc-assistant-action').fire('click');
  const frame=h.find('iframe'),initial=frame.src;frame.localFormState='preserved';bridge(h,'ready',initial);
  h.find('.vc-assistant-content-back').fire('click');h.find('.vc-assistant-actions').children[1].fire('click');assert.equal(frame.src,initial);assert.equal(h.find('.vc-assistant-content-confirm').hidden,false);
  h.find('.vc-assistant-content-keep').fire('click');assert.equal(frame.src,initial);assert.equal(frame.localFormState,'preserved');
  bridge(h,'navigate',initial);assert.equal(h.find('.vc-assistant-content-confirm').hidden,true);assert.equal(frame.src,initial);
  h.find('.vc-assistant-content-back').fire('click');h.find('.vc-assistant-actions').children[1].fire('click');h.find('.vc-assistant-content-replace').fire('click');
  assert.equal(h.find('iframe'),frame);assert.equal(frame.src,'https://vitrinecity.com/course-checkout.html?curso=canva-para-lojas&lia=1');
  assert.equal(h.win.location.pathname,'/receitas');
});

test('purchase form navigation stays inside the viewer without replacing the last public chat context',async()=>{
  const h=harness({answer:{actions:[{label:'Abrir produto',url:'/produto/13'}]}});const widget=h.mount();await widget.ready;widget.open();await ask(h);h.find('.vc-assistant-action').fire('click');
  const frame=h.find('iframe');bridge(h,'ready',frame.src);
  for(const url of ['/entrar.html?returnTo=%2Floja.html','/minha-conta.html?returnTo=%2Floja.html']){
    bridge(h,'navigate',url);assert.equal(new URL(frame.src).pathname,new URL(url,h.win.location.origin).pathname);
    assert.equal(h.find('.vc-assistant-content-confirm').hidden,true);bridge(h,'ready',frame.src);
    h.find('.vc-assistant-content-back').fire('click');await ask(h,'Como sigo com esta compra?');
    assert.equal(h.requests.filter(r=>r.url.endsWith('/chat')).at(-1).body.contextPath,'/produto/13');
    h.find('.vc-assistant-content-resume').fire('click');assert.equal(h.find('iframe'),frame);
  }
  const current=frame.src;bridge(h,'navigate','/admin.html');bridge(h,'navigate','/pagamento.html');assert.equal(frame.src,current);
  bridge(h,'external','/privacy.html');assert.equal(h.find('.vc-assistant-content-external-link').target,'_blank');assert.equal(frame.src,current);
});

test('forged bridge messages and unsafe destinations cannot change the viewer or chat context',async()=>{
  const h=harness({answer:{actions:[{label:'Abrir',url:'/produto/13'}]}});const widget=h.mount();await widget.ready;widget.open();await ask(h);h.find('.vc-assistant-action').fire('click');
  const frame=h.find('iframe'),initial=frame.src;
  bridge(h,'ready',initial,{origin:'https://evil.test'});bridge(h,'ready',initial,{source:{}});
  for(const url of ['/admin.html','javascript:alert(1)','/produto/13?token=secret','https://evil.test/produto/13'])bridge(h,'navigate',url);
  bridge(h,'ready','/produto/99?lia=1');assert.equal(frame.src,initial);assert.equal(h.find('.vc-assistant-content-confirm').hidden,true);
  h.find('.vc-assistant-content-back').fire('click');await ask(h,'Qual o próximo passo?');assert.equal(h.requests.filter(r=>r.url.endsWith('/chat')).at(-1).body.contextPath,'/receitas');
  widget.destroy();assert.equal(h.win.listeners.message.length,0);
});

test('external payment remains a protected explicit link without replacing the viewer or parent page',async()=>{
  const h=harness({answer:{actions:[{label:'Abrir',url:'/course-checkout.html?curso=canva'}]}});const widget=h.mount();await widget.ready;widget.open();await ask(h);h.find('.vc-assistant-action').fire('click');
  const frame=h.find('iframe'),initial=frame.src;
  bridge(h,'external','https://www.mercadopago.com.br/checkout/test?pref_id=known');
  const link=h.find('.vc-assistant-content-external-link');assert.equal(link.textContent,'Continuar pagamento');assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');
  assert.equal(link.href,'https://www.mercadopago.com.br/checkout/test?pref_id=known');assert.equal(frame.src,initial);assert.equal(h.win.location.pathname,'/receitas');
  bridge(h,'external','https://partner.example/product');assert.match(h.find('.vc-assistant-content-external').textContent,/site parceiro/);assert.equal(frame.src,initial);
  bridge(h,'external','https://mercadopago.com.br.evil.test/product');assert.doesNotMatch(h.find('.vc-assistant-content-external-link').textContent,/pagamento/);
});

test('an outer checkout for course A does not hide course B checkout actions after opening B in the viewer',async()=>{
  const answer={actions:[{label:'Conhecer curso B',url:'/cursos/curso-b'}]};
  const h=harness({path:'/course-checkout.html',search:'?curso=curso-a',answer});const widget=h.mount();await widget.ready;widget.open();await ask(h);
  h.find('.vc-assistant-action').fire('click');const frame=h.find('iframe');bridge(h,'ready',frame.src);
  h.find('.vc-assistant-content-back').fire('click');answer.actions=[{label:'Comprar curso B',url:'/course-checkout.html?curso=curso-b'}];await ask(h,'Quero comprar o curso B');
  assert.equal(h.requests.filter(r=>r.url.endsWith('/chat')).at(-1).body.contextPath,'/cursos/curso-b');
  const purchase=h.find('.vc-assistant-action');assert.equal(purchase.textContent,'Comprar curso B');purchase.fire('click');
  assert.equal(h.find('.vc-assistant-content-confirm').hidden,false);h.find('.vc-assistant-content-replace').fire('click');
  assert.equal(frame.src,'https://vitrinecity.com/course-checkout.html?curso=curso-b&lia=1');bridge(h,'ready',frame.src);
  let loads=0,savedUrl=frame.src;Object.defineProperty(frame,'src',{get:()=>savedUrl,set:value=>{loads++;savedUrl=value;}});
  h.find('.vc-assistant-content-back').fire('click');await ask(h,'Continuar a compra');h.find('.vc-assistant-action').fire('click');
  assert.equal(loads,0);assert.equal(h.find('iframe'),frame);assert.equal(h.find('.vc-assistant-content-confirm').hidden,true);
  assert.equal(h.win.location.search,'?curso=curso-a');
});

test('a blocked navigation from the current frame explains the problem without opening or exposing the rejected URL',async()=>{
  const h=harness({answer:{actions:[{label:'Abrir',url:'/produto/13'}]}});const widget=h.mount();await widget.ready;widget.open();await ask(h);h.find('.vc-assistant-action').fire('click');
  const frame=h.find('iframe'),initial=frame.src;bridge(h,'ready',initial);
  bridge(h,'navigate','/admin.html?token=private',{origin:'https://evil.test'});assert.equal(h.find('.vc-assistant-content-status').textContent,'');
  bridge(h,'navigate','/admin.html?token=private');assert.match(h.find('.vc-assistant-content-status').textContent,/Não consegui abrir este link aqui/);
  assert.doesNotMatch(h.find('.vc-assistant-content-status').textContent,/admin|private|token/);assert.equal(frame.src,initial);assert.equal(h.find('.vc-assistant-content-external-link'),null);
  h.find('.vc-assistant-content-back').fire('click');await ask(h,'Pode me ajudar?');assert.equal(h.requests.filter(r=>r.url.endsWith('/chat')).at(-1).body.contextPath,'/produto/13');
});
