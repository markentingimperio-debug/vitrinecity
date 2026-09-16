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

async function fixture({ repetitions = 0, accepted = true, targets = ['instagram','youtube'], facebookConfigured = false } = {}) {
  const elements = new Map(), posts = [], configurations = [], confirmations = [], intervals = [];
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
    config: { title: 'Apresentação revisada', media: 'catalogo.mp4', repetitions, destination: 'https://vitrinecity.com', platform: 'instagram', server: 'rtmps://live-upload.instagram.com/rtmp/', targets },
    profiles: { instagram: { hasKey: true, server: 'rtmps://live-upload.instagram.com/rtmp/' }, youtube: { hasKey: true, server: 'rtmps://a.rtmps.youtube.com/live2' }, facebook: {hasKey:facebookConfigured,server:facebookConfigured?'rtmps://rtmp-api.facebook.com:443/rtmp/':''} },
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
      if (options.method === 'PUT') {
        assert.equal(url,'/api/admin/live-studio/config');
        const body=JSON.parse(options.body);configurations.push(body);
        state.config={...state.config,...body,key:undefined};
        state.profiles[body.platform]={server:body.server,hasKey:body.clearKey?false:Boolean(body.key)||state.profiles[body.platform]?.hasKey===true};
        return {ok:true,status:200,json:async()=>({ok:true})};
      }
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
  return { elements, posts, configurations, confirmations, state, intervals, networks:vm.runInContext('networkRows',context), defer() { deferPost = true; }, release() { releasePost(); } };
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

test('Facebook is a separate output and opening an old configuration never selects it automatically',async()=>{
  const f=await fixture();
  assert.deepEqual(f.elements.get('platform').children.map(option=>option.value),['instagram','facebook','youtube','tiktok']);
  assert.equal(f.elements.get('target-facebook').checked,false);
  assert.equal(f.configurations.length,0);assert.equal(f.posts.length,0);
  assert.match(f.networks.facebook.status.textContent,/Facebook: Configuração pendente/);
  assert.equal(f.networks.facebook.stop.disabled,true);
  const instagramProfile=structuredClone(f.state.profiles.instagram);
  f.elements.get('key').value='PRIVATE_UNSAVED_INSTAGRAM';
  f.elements.get('platform').value='facebook';f.elements.get('platform').onchange();
  assert.equal(f.elements.get('key').value,'');assert.equal(f.elements.get('server').value,'');
  assert.equal(f.elements.get('server').placeholder,'rtmps://rtmp-api.facebook.com:443/rtmp/');
  assert.match(f.elements.get('platformHelp').textContent,/Facebook Live Producer da Página correta/);
  assert.match(f.elements.get('platformHelp').textContent,/chave do Instagram.*separada/);
  assert.deepEqual(f.state.profiles.instagram,instagramProfile);
});

test('saving only Facebook credentials preserves other profiles, clears the input and starts nothing',async()=>{
  const f=await fixture(),before=structuredClone({instagram:f.state.profiles.instagram,youtube:f.state.profiles.youtube});
  f.elements.get('platform').value='facebook';f.elements.get('platform').onchange();
  f.elements.get('server').value='rtmps://rtmp-api.facebook.com:443/rtmp/';f.elements.get('key').value='OFFLINE_PRIVATE_FACEBOOK_KEY';
  f.elements.get('target-facebook').checked=true;
  await f.elements.get('config').onsubmit({preventDefault(){}});
  assert.equal(f.configurations.length,1);assert.equal(f.configurations[0].platform,'facebook');
  assert.equal(f.configurations[0].key,'OFFLINE_PRIVATE_FACEBOOK_KEY');
  assert.deepEqual(f.configurations[0].targets,['instagram','facebook','youtube']);
  assert.deepEqual({instagram:f.state.profiles.instagram,youtube:f.state.profiles.youtube},before);
  assert.equal(f.elements.get('key').value,'');assert.match(f.elements.get('keyStatus').textContent,/privada; não exibida/);
  assert.equal(f.posts.length,0);assert.equal(f.elements.get('sessionDuration').value,'7200');
  assert.equal(f.elements.get('target-tiktok').checked,false);
});

test('three-network start names Instagram Facebook and YouTube with the unchanged two-hour control contract',async()=>{
  const f=await fixture({targets:['instagram','facebook','youtube'],facebookConfigured:true});
  assert.equal(f.elements.get('start').disabled,false);
  assert.equal(f.elements.get('target-facebook').checked,true);f.elements.get('reviewed').checked=true;
  await f.elements.get('start').onclick();
  assert.deepEqual(f.posts,[{action:'start',confirm:'TRANSMITIR',durationSeconds:7200}]);
  assert.match(f.confirmations[0],/Instagram, Facebook, YouTube por 2 horas/);
  assert.match(f.confirmations[0],/públicas imediatamente/);
  assert.equal(f.configurations.length,0);
});

test('Facebook requires its own saved profile even when Instagram and YouTube have credentials',async()=>{
  const f=await fixture({targets:['instagram','facebook','youtube']});
  assert.equal(f.elements.get('start').disabled,true);assert.equal(f.state.profiles.facebook.hasKey,false);
  assert.equal(f.posts.length,0);assert.equal(f.configurations.length,0);
});

test('Facebook sending telemetry stays distinct from publication and individual stop affects only Facebook',async()=>{
  const f=await fixture({targets:['instagram','facebook','youtube'],facebookConfigured:true});
  Object.assign(f.state.status,{streaming:true,durationSeconds:7200,continuous:false,deadline:Date.now()/1000+7000,remaining:7000,networks:{instagram:{state:'sending'},facebook:{state:'sending'},youtube:{state:'sending'}}});
  await f.intervals[0]();
  assert.match(f.networks.facebook.status.textContent,/Facebook: Enviando sinal — publicação não verificada/);
  assert.equal(f.networks.facebook.stop.disabled,false);
  await f.networks.facebook.stop.onclick();
  assert.deepEqual(f.posts,[{action:'stop-network',platform:'facebook'}]);
  assert.equal(f.state.status.networks.instagram.state,'sending');assert.equal(f.state.status.networks.youtube.state,'sending');
  assert.equal(f.elements.get('sessionDuration').value,'7200');assert.equal(f.elements.get('sessionDuration').disabled,true);
  f.state.status.networks.facebook.state='failed';await f.intervals[0]();
  assert.match(f.networks.facebook.status.textContent,/Falha/);assert.equal(f.networks.facebook.stop.disabled,true);
});
