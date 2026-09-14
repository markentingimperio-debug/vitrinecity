import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mountNeuralWorkspace } from '../public/neural-workspace.js';

const publicFile = name => new URL('../public/' + name, import.meta.url);
const html = readFileSync(publicFile('neural-workspace.html'), 'utf8');
const js = readFileSync(publicFile('neural-workspace.js'), 'utf8');
const css = readFileSync(publicFile('neural-workspace.css'), 'utf8');
execFileSync(process.execPath, ['--check', fileURLToPath(publicFile('neural-workspace.js'))]);
assert.match(html, /lang="pt-BR"/);
assert.match(html, /name="viewport"/);
assert.match(html, /<script type="module" src="\/neural-workspace\.js"><\/script>/);
assert.match(html, /type="password"/);
assert.match(html, /maxlength="6000"/);
assert.match(html, /role="alert"/);
assert.match(html, /aria-live="polite"/);
assert.match(html, /Código gerado não foi executado nem testado/);
assert.match(html, /integrações ainda indisponíveis/);
assert.doesNotMatch(html, /<select\b|<iframe\b|on(?:click|load|error)=/i);
assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function|localStorage|sessionStorage/);
assert.doesNotMatch(js, /(?:location|window)\.(?:assign|open)\s*\(/);
assert.doesNotMatch(js, /[?&](?:token|access_token|key)=/i);
assert.match(js, /headers\['x-store-token'\] = state\.token/);
assert.match(js, /headers\['x-neural-request'\] = '1'/);
assert.match(js, /credentials: 'same-origin'/);
assert.match(js, /cache: 'no-store'/);
assert.match(js, /instruction, idempotencyKey: crypto\.randomUUID\(\)/);
assert.match(js, /428: 'mfa'/);
assert.match(js, /\/api\/admin\/vitriny-neural\/tasks/);
assert.match(js, /\/api\/store-portal\//);
assert.match(js, /encodeURIComponent\(storeReference\)/);
assert.match(js, /\/file\?path=' \+ encodeURIComponent\(path\)/);
assert.match(js, /new Blob\(\[downloaded\], \{ type: 'application\/octet-stream' \}\)/);
assert.match(js, /link\.download =/);
assert.match(js, /URL\.revokeObjectURL/);
assert.match(js, /if \(!canSend\(\)\) return/);
assert.match(js, /setTimeout\(\(\) => pollTask\(task\.id\), 2000\)/);
assert.match(js, /addEventListener\('pagehide'/);
assert.match(js, /state\.token = ''/);
assert.match(css, /@media\(max-width:700px\)/);
assert.match(css, /focus-visible/);
for (const [, id] of js.matchAll(/\$\('([^']+)'\)/g)) assert.ok(html.includes('id="' + id + '"'), 'Missing DOM selector: ' + id);
for (const state of ['queued', 'running', 'draft_ready', 'failed', 'cancelled', 'interrupted', 'blocked']) assert.ok(js.includes(state), 'Missing task state: ' + state);

class Element {
  constructor(tag = 'div') { this.tagName = tag; this.textContent = ''; this.value = ''; this.hidden = false; this.disabled = false; this.children = []; this.attributes = {}; this.listeners = {}; this.dataset = {}; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  remove() { this.removed = true; }
  focus() { this.focused = true; }
  click() { this.clicked = true; return this.listeners.click?.({ preventDefault() {} }); }
}
const settle = () => new Promise(resolve => setImmediate(resolve));
function harness({ search = '', respond }) {
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, new Element()]));
  const created = [], calls = [], timers = new Map(), windowListeners = new Map(), blobs = [];
  let timerId = 0, uuid = 0;
  const document = {
    getElementById: id => elements.get(id),
    createElement: tag => { const element = new Element(tag); created.push(element); return element; },
    querySelectorAll: () => [], body: new Element('body')
  };
  class FakeURL extends URL {
    static createObjectURL(blob) { blobs.push(blob); return 'blob:workspace-test'; }
    static revokeObjectURL() {}
  }
  mountNeuralWorkspace({
    document, location: { search }, URLSearchParams, URL: FakeURL, Blob, AbortController,
    window: { addEventListener: (name, listener) => windowListeners.set(name, listener) },
    crypto: { randomUUID: () => 'task-request-' + (++uuid) },
    setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => {
      calls.push({ url, options });
      const result = await respond(url, options, calls);
      return { ok: (result.status || 200) < 400, status: result.status || 200, json: async () => result.data, blob: async () => new Blob([result.body || ''], { type: 'text/html' }) };
    }
  });
  return { elements, created, calls, timers, windowListeners, blobs, submit: id => elements.get(id).listeners.submit({ preventDefault() {} }) };
}

const adminBase = '/api/admin/vitriny-neural/tasks';
const maliciousText = '<img src=x onerror="alert(1)">';
const task = { id: 'task-1', instruction: 'Crie um site', kind: 'website', status: 'queued', stepCount: 0, files: [], events: [] };
const admin = harness({ respond: (url, options) => {
  if (url.endsWith('/status')) return { data: { ok: true, enabled: true, localOnly: true, draftOnly: true, usage: { dailyTasks: 1, remaining: 3 }, limits: { dailyTasks: 4 } } };
  if (url === adminBase && options.method === 'GET') return { data: { ok: true, items: [] } };
  if (url === adminBase && options.method === 'POST') return { data: { ok: true, item: task } };
  if (url.endsWith('/run')) return { data: { ok: true, item: { ...task, status: 'running' } } };
  if (url.includes('/file?')) return { body: maliciousText };
  if (url.endsWith('/task-1')) return { data: { ok: true, item: { ...task, status: 'draft_ready', resultText: maliciousText, stepCount: 1, files: [{ path: 'index.html', bytes: 100 }], events: [{ step: 1, tool: '<script>', outcome: maliciousText }] } } };
  throw Error('Unexpected request: ' + url);
} });
await settle();
assert.equal(admin.calls.length, 2);
assert.equal(admin.elements.get('send').disabled, false);
assert.equal(admin.elements.get('quota-status').textContent, '1 tarefa(s) usada(s) · limite 4 · 3 disponível(is)');
admin.elements.get('command').value = 'Crie um site';
const firstSubmit = admin.submit('command-form');
await admin.submit('command-form');
await firstSubmit;
assert.equal(admin.calls.filter(call => call.options.method === 'POST' && call.url === adminBase).length, 1, 'Concurrent sends must not create duplicates');
const creation = admin.calls.find(call => call.options.method === 'POST' && call.url === adminBase);
assert.deepEqual(JSON.parse(creation.options.body), { instruction: 'Crie um site', idempotencyKey: 'task-request-1' });
assert.equal(creation.options.headers['x-neural-request'], '1');
assert.ok(admin.calls.some(call => call.url.endsWith('/run') && call.options.body === '{}'));
assert.equal(admin.elements.get('send').disabled, true, 'Running task blocks another submit');
const poll = [...admin.timers.values()].find(timer => timer.delay === 2000);
assert.ok(poll, 'Running tasks poll every two seconds');
await poll.callback();
assert.equal(admin.elements.get('task-output').textContent, maliciousText, 'Generated markup is shown as text');
assert.equal(admin.elements.get('send').disabled, false);
await admin.elements.get('task-files').children[0].click();
assert.equal(admin.blobs[0].type, 'application/octet-stream');
assert.ok(admin.created.some(element => element.tagName === 'a' && element.download === 'index.html' && element.clicked));
assert.ok(!admin.created.some(element => ['iframe', 'script', 'img'].includes(element.tagName)), 'Generated output is never inserted as executable elements');

const store = harness({ search: '?store=loja%2Fum', respond: (url, options) => {
  assert.equal(options.headers['x-store-token'], 'private-store-password');
  assert.ok(url.startsWith('/api/store-portal/loja%2Fum/neural/tasks'));
  assert.ok(!url.includes('private-store-password'));
  return url.endsWith('/status') ? { data: { ok: true, enabled: true, localOnly: true, draftOnly: true } } : { data: { ok: true, items: [{ ...task, status: 'queued' }] } };
} });
assert.equal(store.calls.length, 0, 'Store page must wait for authentication');
store.elements.get('access-token').value = 'private-store-password';
await store.submit('access-form'); await settle();
assert.equal(store.elements.get('access-token').value, '', 'Password input is cleared after connection');
assert.equal(store.calls.filter(call => call.options.method === 'POST').length, 0, 'Recovered queued tasks are not started automatically');
assert.equal(store.elements.get('start-task').hidden, false);
store.elements.get('disconnect').click();
assert.equal(store.elements.get('send').disabled, true);
assert.equal(store.elements.get('task-list').children.length, 0);

const mfa = harness({ search: '?store=loja', respond: () => ({ status: 428, data: { ok: false, error: maliciousText } }) });
mfa.elements.get('access-token').value = 'private-store-password';
await mfa.submit('access-form'); await settle();
assert.match(mfa.elements.get('error').textContent, /segundo fator/);
assert.ok(!mfa.elements.get('error').textContent.includes(maliciousText), 'Remote error messages are not echoed');

const unqualified = harness({ respond: () => ({ status: 503, data: { ok: false, code: 'task_provider_unqualified', error: maliciousText } }) });
await settle();
assert.match(unqualified.elements.get('error').textContent, /benchmark/);
assert.ok(!unqualified.elements.get('error').textContent.includes(maliciousText));

const exhausted = harness({ respond: url => url.endsWith('/status')
  ? { data: { ok: true, enabled: true, usage: { dailyTasks: 1, remaining: 9, dailyRuns: 10, remainingRuns: 0 }, limits: { dailyTasks: 10 } } }
  : { data: { ok: true, items: [task] } }
});
await settle();
assert.equal(exhausted.elements.get('send').disabled, true, 'Exhausted run quota blocks new submissions');
assert.equal(exhausted.elements.get('start-task').disabled, true, 'Exhausted run quota blocks queued starts');
assert.equal(exhausted.elements.get('refresh').disabled, false, 'Exhausted run quota does not block history refresh');
assert.equal(exhausted.elements.get('task-list').children.length, 1);
assert.match(exhausted.elements.get('quota-status').textContent, /10 execução\(ões\) usada\(s\)/);
assert.match(exhausted.elements.get('quota-status').textContent, /cota diária de execuções esgotada/);
exhausted.elements.get('command').value = 'Crie um site';
await exhausted.submit('command-form');
assert.equal(exhausted.calls.filter(call => call.options.method === 'POST').length, 0);

let attempts = 0;
for(const billing of [
  {enabled:true,active:false,availableCredits:100,plan:{taskReserveCredits:10}},
  {enabled:true,active:true,availableCredits:9,reservedCredits:10,usedCredits:1,plan:{taskReserveCredits:10}}
]){
  const blocked=harness({respond:url=>url.endsWith('/status')?{data:{ok:true,enabled:true,billing}}:{data:{ok:true,items:[task]}}});
  await settle();assert.equal(blocked.elements.get('send').disabled,true);assert.equal(blocked.elements.get('start-task').disabled,true);
  assert.equal(blocked.elements.get('refresh').disabled,false);assert.equal(blocked.elements.get('task-list').children.length,1);
  blocked.elements.get('command').value='Novo pedido';await blocked.submit('command-form');assert.equal(blocked.calls.filter(call=>call.options.method==='POST').length,0);
}
const paid=harness({respond:url=>url.endsWith('/status')?{data:{ok:true,enabled:true,billing:{enabled:true,active:true,availableCredits:50,reservedCredits:10,usedCredits:40,plan:{taskReserveCredits:10}}}}:{data:{ok:true,items:[]}}});
await settle();assert.equal(paid.elements.get('send').disabled,false);assert.match(paid.elements.get('billing-status').textContent,/50 créditos disponíveis/);
assert.equal(store.elements.get('billing-link').href,'/neural-billing.html?store=loja%2Fum');

const retry = harness({ respond: (url, options) => {
  if (url.endsWith('/status')) return { data: { ok: true, enabled: true } };
  if (options.method === 'GET') return { data: { ok: true, items: [] } };
  if (url === adminBase && ++attempts === 1) throw Error('Network disconnected');
  return { data: { ok: true, item: { ...task, status: 'blocked' } } };
} });
await settle(); retry.elements.get('command').value = 'Crie um site';
await retry.submit('command-form'); await retry.submit('command-form');
const attemptsBodies = retry.calls.filter(call => call.options.method === 'POST' && call.url === adminBase).map(call => JSON.parse(call.options.body));
assert.equal(attemptsBodies.length, 2);
assert.equal(attemptsBodies[0].idempotencyKey, attemptsBodies[1].idempotencyKey, 'Retry after uncertain receipt reuses the same idempotency key');
console.log('Neural workspace: syntax, DOM safety, command lifecycle, concurrency, store authentication, MFA, downloads and idempotent retry passed.');
