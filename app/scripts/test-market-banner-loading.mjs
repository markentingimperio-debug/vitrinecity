import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { injectPublicMeasurement } from '../public-measurement.js';
import { injectSiteAssistant } from '../site-assistant-page.js';

const loader = fs.readFileSync(new URL('../public/global-market-banner.js', import.meta.url), 'utf8');
const outdoor = fs.readFileSync(new URL('../public/market-outdoor.js', import.meta.url), 'utf8');
const prepare = fs.readFileSync(new URL('../prepare-public-highlights.js', import.meta.url), 'utf8');

assert.ok(loader.includes("css.href='/market-outdoor.css?v=4'"), 'O CSS deve começar a carregar no loader global.');
assert.ok(loader.includes("import('/market-outdoor.js?v=7')"), 'O módulo atualizado deve invalidar o cache anterior.');
assert.ok(loader.includes('window.__vcMarketStylesReady.then'), 'A publicidade deve aguardar o CSS antes de entrar no DOM.');
assert.ok(outdoor.includes('!await window.__vcMarketStylesReady'), 'O banner deve aguardar o CSS antes de entrar no DOM.');
assert.ok(!outdoor.includes("document.head.append(css)"), 'O módulo não deve inserir uma segunda folha de estilo tardiamente.');
assert.ok(prepare.includes('global-market-banner.js?v=9'), 'A versão do loader deve invalidar o cache antigo.');

function runLoader(pathname, search = '') {
  const effects = [];
  const state = {};
  let stylesheet;
  const element = tag => {
    const listeners = {};
    return {
      tag, dataset: {}, listeners,
      addEventListener(type, callback) { effects.push(['listener', tag, type]); listeners[type] = callback; },
      setAttribute(name, value) { effects.push(['attribute', tag, name, value]); },
      append(child) { effects.push(['append', tag, child.tag]); },
    };
  };
  const context = {
    URL,
    location: { pathname, search, origin: 'https://vitrinecity.test' },
    window: new Proxy(state, { set(target, key, value) { effects.push(['window', key]); target[key] = value; return true; } }),
    document: {
      querySelector(selector) { effects.push(['query', selector]); return null; },
      getElementById(id) { effects.push(['find', id]); return null; },
      createElement(tag) {
        effects.push(['create', tag]);
        const node = element(tag);
        if (tag === 'link') stylesheet = node;
        return node;
      },
      head: { append(node) { effects.push(['stylesheet', node.href]); } },
      body: { prepend(node) { effects.push(['ui', node.id]); } },
    },
    fetch: async url => {
      effects.push(['fetch', url]);
      return { ok: true, json: async () => ({ ads: [{ title: 'Loja de teste', clickUrl: 'https://vitrinecity.test/anuncio' }] }) };
    },
    loadModule: async url => { effects.push(['import', url]); return {}; },
  };
  // Intercept only the module-loading boundary; execute the actual guard and DOM logic.
  // This avoids experimental VM module flags while making import attempts observable.
  vm.runInNewContext(loader.replace(/\bimport\s*\(/g, 'loadModule('), context, { filename: 'global-market-banner.js' });
  return { effects, state, loadStyles: () => stylesheet?.listeners.load() };
}

const settle = () => new Promise(resolve => setImmediate(resolve));
for (const pathname of ['/oracao-do-dia', '/oracao-do-dia/', '/oracao-do-dia.html', '/oracao-do-dia.html/', '/course-checkout.html', '/course-checkout.html/']) {
  const result = runLoader(pathname, '?curso=canva-para-lojas&utm_source=facebook');
  await settle();
  assert.deepEqual(result.effects, [], `${pathname}: não deve importar módulos, consultar/alterar o DOM, buscar anúncios ou criar estado global.`);
  assert.deepEqual(result.state, {}, `${pathname}: o carregador deve sair antes de marcar a página como carregada.`);
}

for (const pathname of ['/', '/loja.html', '/oracao-do-dia-extra.html', '/course-checkout.html-extra', '/cursos/canva-para-lojas']) {
  const result = runLoader(pathname);
  assert.deepEqual(result.effects.filter(([type]) => type === 'import').map(([, url]) => url), ['/platform-performance.js?v=1', '/market-outdoor.js?v=7'], `${pathname}: as importações comerciais devem permanecer ativas.`);
  assert.equal(result.effects.filter(([type]) => type === 'stylesheet').length, 1, `${pathname}: a folha de estilo deve ser inserida uma única vez.`);
  await settle();
  assert.equal(result.effects.some(([type]) => type === 'fetch' || type === 'ui'), false, `${pathname}: anúncio e interface devem aguardar o CSS.`);
  result.loadStyles();
  await settle();
  assert.deepEqual(result.effects.filter(([type]) => type === 'fetch'), [['fetch', '/api/ads/serve?placement=banner']], `${pathname}: a consulta de anúncios deve permanecer ativa após o CSS.`);
  assert.deepEqual(result.effects.filter(([type]) => type === 'ui'), [['ui', 'vc-paid-sponsor-strip']], `${pathname}: a publicidade deve continuar sendo exibida.`);
}

// Exercise the real build script against in-memory files; never rewrite public
// HTML or boot the production server just to verify its injection boundaries.
const checkoutHtml = fs.readFileSync(new URL('../public/course-checkout.html', import.meta.url), 'utf8');
const sampleHtml = '<!doctype html><html><head></head><body><main>Conteúdo público</main></body></html>';
const buildFiles = new Map([
  ['/fixture/public/course-checkout.html', checkoutHtml],
  ['/fixture/public/index.html', sampleHtml],
  ['/fixture/public/loja.html', sampleHtml]
]);
const fixtureFs = {
  readdirSync: () => [...buildFiles.keys()].map(file => ({ name: path.posix.basename(file), isSymbolicLink: () => false, isDirectory: () => false })),
  readFileSync: file => buildFiles.get(file),
  writeFileSync: (file, content) => buildFiles.set(file, content)
};
const buildSource = prepare.replace(/^import .*;\r?$/gm, '')
  .replace(/^const publicRoot = .*;\r?$/m, "const publicRoot = '/fixture/public';");
vm.runInNewContext(buildSource, { fs: fixtureFs, path: path.posix, injectPublicMeasurement, injectSiteAssistant });
const preparedCheckout = buildFiles.get('/fixture/public/course-checkout.html');
assert.ok(!preparedCheckout.includes('/global-market-banner.js'), 'Build: o checkout não deve receber nenhuma versão do loader publicitário.');
assert.match(preparedCheckout, /src="\/site-assistant\.js\?/, 'Build: a Lia deve permanecer disponível no checkout.');
assert.match(preparedCheckout, /course-checkout\.js\?v=1/, 'Build: o script do formulário deve ser preservado.');
for (const filename of ['index.html', 'loja.html']) {
  const prepared = buildFiles.get('/fixture/public/' + filename);
  assert.match(prepared, /global-market-banner\.js\?v=9/, `${filename}: publicidade preservada.`);
  assert.match(prepared, /analytics\.js\?/, `${filename}: medição existente preservada.`);
  assert.match(prepared, /src="\/site-assistant\.js\?/, `${filename}: Lia preservada.`);
}

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const sendWrapper = server.match(/app\.use\(\(req, res, next\) => \{\r?\n  const send = res\.send\.bind\(res\);[\s\S]+?\r?\n\}\);/)?.[0];
const staticMiddleware = server.split(/\r?\n/).find(line => line.startsWith('app.use((req,res,next)=>') && line.includes('const candidates=relative.endsWith'));
assert.ok(sendWrapper && staticMiddleware, 'Os dois pontos reais de injeção do servidor devem ser exercitados.');
function serveFixture(pathname, prepared) {
  const handlers = [], headers = new Map();
  let body, nextCalls = 0;
  const files = prepared ? buildFiles : new Map([
    ['/fixture/public/course-checkout.html', checkoutHtml],
    ['/fixture/public/index.html', sampleHtml],
    ['/fixture/public/loja.html', sampleHtml]
  ]);
  const context = {
    app: { use: handler => handlers.push(handler) }, dir: '/fixture', path: path.posix,
    fs: { existsSync: file => files.has(file), readFileSync: file => files.get(file) },
    Buffer, injectPublicMeasurement, injectSiteAssistant
  };
  vm.runInNewContext(sendWrapper + '\n' + staticMiddleware, context);
  const req = { method: 'GET', path: pathname };
  const res = {
    locals: {}, getHeader: key => headers.get(key), setHeader: (key, value) => headers.set(key, value),
    type(value) { headers.set('content-type', value === 'html' ? 'text/html' : value); return this; },
    send(value) { body = value; return this; }
  };
  handlers[0](req, res, () => { nextCalls++; });
  handlers[1](req, res, () => { nextCalls++; });
  assert.equal(nextCalls, 1, 'O HTML deve ser atendido pelo middleware estático após instalar o wrapper.');
  return body;
}
for (const prepared of [false, true]) {
  const checkout = serveFixture('/course-checkout.html', prepared);
  assert.ok(!checkout.includes('/global-market-banner.js'), 'Servidor: nem o middleware estático nem o wrapper podem recolocar v3/v5 no checkout.');
  assert.match(checkout, /src="\/site-assistant\.js\?/, 'Servidor: Lia preservada.');
  assert.match(checkout, /id="course-payment-form"/, 'Servidor: formulário preservado.');
  assert.match(checkout, /course-checkout\.js\?v=1/, 'Servidor: lógica de pagamento preservada.');
  assert.match(checkout, /pwa-install\.js\?v=2/, 'Servidor: outros injetores não foram alterados.');
  for (const pathname of ['/', '/loja.html']) {
    const html = serveFixture(pathname, prepared);
    assert.match(html, /global-market-banner\.js\?/, `${pathname}: publicidade preservada.`);
    assert.match(html, /analytics\.js\?/, `${pathname}: medição preservada.`);
  }
}

console.log('Banner: oração e pagamento do curso sem efeitos colaterais; demais páginas preservadas, com anúncios após o CSS.');
