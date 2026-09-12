import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const html = fs.readFileSync(new URL('../public/admin-live.html', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('../public/admin-live.js', import.meta.url), 'utf8');
// The optional Lia module is a separate, already tested panel. Run the real studio
// initialization and event handlers without importing that unrelated module.
const studioSource = source.slice(0, source.indexOf("import('/admin-live-lia.js')"));
const flush = () => new Promise(resolve => setImmediate(resolve));

async function fixture({ repetitions = 0, accepted = true } = {}) {
  const elements = new Map(), posts = [], confirmations = [], intervals = [];
  class Element {
    constructor(tag = 'div') { this.tagName = tag; this.value = ''; this.src = ''; this.textContent = ''; this.children = []; this.disabled = false; this.checked = false; this.listeners = {}; }
    set id(value) { this._id = value; elements.set(value, this); }
    get id() { return this._id; }
    append(...items) { this.children.push(...items); }
    prepend(...items) { this.children.unshift(...items); }
    before() {}
    replaceChildren(...items) { this.children = items; }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    get nextElementSibling() { return this._sibling ||= new Element(); }
  }
  for (const match of html.matchAll(/id="([^"]+)"/g)) { const element = new Element(); element.id = match[1]; }
  elements.get('sessionDuration').value = html.match(/id="sessionDuration"[^>]*><option value="([^"]+)" selected>/)[1];
  const selectors = new Map(['label[for="server"]', 'aside', 'h1 + p', 'main'].map(key => [key, new Element()]));
  const document = { getElementById: id => elements.get(id), createElement: tag => new Element(tag), createTextNode: text => text, querySelector: selector => selectors.get(selector) || null };
  const state = {
    config: { title: 'Apresentação revisada', media: 'catalogo.mp4', repetitions, destination: 'https://vitrinecity.com', platform: 'instagram', server: 'rtmps://live-upload.instagram.com/rtmp/', targets: ['instagram', 'youtube'] },
    profiles: { instagram: { hasKey: true, server: 'rtmps://live-upload.instagram.com/rtmp/' }, youtube: { hasKey: true, server: 'rtmps://a.rtmps.youtube.com/live2' } },
    media: [{ file: 'catalogo.mp4', label: 'Catálogo revisado', duration: 470.66 }],
    status: { online: true, streaming: false, recording: false, updatedAt: Date.now() }
  };
  let releasePost = null, deferPost = false;
  const context = vm.createContext({
    document, Option: function(text, value) { const el = new Element('option'); el.value = value; el.textContent = text; return el; },
    location: {}, console, setInterval: callback => intervals.push(callback),
    confirm: text => { confirmations.push(text); return accepted; },
    fetch: async (url, options = {}) => {
      assert.equal(url.startsWith('/api/admin/live-studio'), true);
      if (options.method === 'POST') {
        posts.push(JSON.parse(options.body));
        if (deferPost) await new Promise(resolve => { releasePost = resolve; });
        return { ok: true, status: 202, json: async () => ({ message: 'Comando recebido; acompanhe o status.' }) };
      }
      assert.equal(options.method, undefined, 'reading the panel must not alter configuration');
      return { ok: true, status: 200, json: async () => state };
    }
  });
  vm.runInContext(studioSource, context);
  await flush();
  return { elements, posts, confirmations, state, intervals, defer() { deferPost = true; }, release() { releasePost(); } };
}

test('existing unlimited config opens with explicit two-hour default and no automatic start', async () => {
  const f = await fixture();
  assert.equal(f.elements.get('sessionDuration').value, '7200');
  assert.equal(f.posts.length, 0);
  assert.match(f.elements.get('start').textContent, /2 horas/);
  assert.match(f.elements.get('sessionTiming').textContent, /reiniciar.*não prolonga/);
  f.elements.get('reviewed').checked = true;
  await f.elements.get('start').onclick();
  assert.deepEqual(f.posts, [{ action: 'start', confirm: 'TRANSMITIR', durationSeconds: 7200 }]);
  assert.match(f.confirmations[0], /Instagram, YouTube por 2 horas, com encerramento automático/);
  assert.match(f.confirmations[0], /públicas imediatamente/);
});

test('review and confirmation remain required; invalid duration never sends a command', async () => {
  const f = await fixture({ accepted: false });
  await f.elements.get('start').onclick();
  assert.equal(f.confirmations.length, 0);
  f.elements.get('reviewed').checked = true;
  await f.elements.get('start').onclick();
  assert.equal(f.posts.length, 0);
  f.elements.get('sessionDuration').value = '36000';
  await f.elements.get('start').onclick();
  assert.equal(f.posts.length, 0);
  assert.match(f.elements.get('message').textContent, /Selecione a duração/);
});

test('legacy duration requires an explicit selection and names the unlimited mode', async () => {
  const f = await fixture();
  f.elements.get('sessionDuration').value = 'configured';
  f.elements.get('sessionDuration').onchange();
  assert.match(f.elements.get('sessionTiming').textContent, /tempo ilimitado, até você parar/);
  f.elements.get('reviewed').checked = true;
  await f.elements.get('start').onclick();
  assert.deepEqual(f.posts, [{ action: 'start', confirm: 'TRANSMITIR' }]);
  assert.match(f.confirmations[0], /tempo ilimitado, até você parar/);
});

test('preview and stop never inherit the two-hour parameter; double click is bounded', async () => {
  const f = await fixture();
  await f.elements.get('preview').onclick();
  await f.elements.get('stop').onclick();
  assert.deepEqual(f.posts, [{ action: 'preview' }, { action: 'stop' }]);
  f.elements.get('reviewed').checked = true;
  f.defer();
  const first = f.elements.get('start').onclick();
  await flush();
  assert.equal(f.elements.get('start').disabled, true);
  await f.elements.get('start').onclick();
  assert.equal(f.posts.length, 3);
  f.release();
  await first;
});

test('worker deadline is shown as confirmed and cannot be edited during transmission', async () => {
  const f = await fixture();
  Object.assign(f.state.status, { streaming: true, durationSeconds: 7200, startedAt: 1789228800, deadline: 1789236000, remaining: 7190, continuous: false });
  await f.intervals[0]();
  assert.match(f.elements.get('sessionTiming').textContent, /Encerramento confirmado pelo OBS:/);
  assert.match(f.elements.get('sessionTiming').textContent, /7190 segundos/);
  assert.equal(f.elements.get('sessionDuration').disabled, true);
  assert.equal(f.elements.get('start').disabled, true);
  assert.match(f.elements.get('telemetry').textContent, /2 horas · encerramento automático/);
  assert.equal(f.posts.length, 0);
});
