import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const loader = fs.readFileSync(new URL('../public/global-market-banner.js', import.meta.url), 'utf8');
const outdoor = fs.readFileSync(new URL('../public/market-outdoor.js', import.meta.url), 'utf8');
const prepare = fs.readFileSync(new URL('../prepare-public-highlights.js', import.meta.url), 'utf8');

assert.ok(loader.includes("css.href='/market-outdoor.css?v=4'"), 'O CSS deve começar a carregar no loader global.');
assert.ok(loader.includes("import('/market-outdoor.js?v=7')"), 'O módulo atualizado deve invalidar o cache anterior.');
assert.ok(loader.includes('window.__vcMarketStylesReady.then'), 'A publicidade deve aguardar o CSS antes de entrar no DOM.');
assert.ok(outdoor.includes('!await window.__vcMarketStylesReady'), 'O banner deve aguardar o CSS antes de entrar no DOM.');
assert.ok(!outdoor.includes("document.head.append(css)"), 'O módulo não deve inserir uma segunda folha de estilo tardiamente.');
assert.ok(prepare.includes('global-market-banner.js?v=8'), 'A versão do loader deve invalidar o cache antigo.');

function runLoader(pathname) {
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
    location: { pathname, origin: 'https://vitrinecity.test' },
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
for (const pathname of ['/oracao-do-dia', '/oracao-do-dia/', '/oracao-do-dia.html', '/oracao-do-dia.html/']) {
  const result = runLoader(pathname);
  await settle();
  assert.deepEqual(result.effects, [], `${pathname}: não deve importar módulos, consultar/alterar o DOM, buscar anúncios ou criar estado global.`);
  assert.deepEqual(result.state, {}, `${pathname}: o carregador deve sair antes de marcar a página como carregada.`);
}

for (const pathname of ['/', '/loja.html', '/oracao-do-dia-extra.html']) {
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

console.log('Banner: oração sem efeitos colaterais; demais páginas preservadas, com anúncios após o CSS.');
