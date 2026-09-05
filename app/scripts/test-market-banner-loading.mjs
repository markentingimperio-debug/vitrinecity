import assert from 'node:assert/strict';
import fs from 'node:fs';

const loader = fs.readFileSync(new URL('../public/global-market-banner.js', import.meta.url), 'utf8');
const outdoor = fs.readFileSync(new URL('../public/market-outdoor.js', import.meta.url), 'utf8');
const prepare = fs.readFileSync(new URL('../prepare-public-highlights.js', import.meta.url), 'utf8');

assert.ok(loader.includes("css.href='/market-outdoor.css?v=3'"), 'O CSS deve começar a carregar no loader global.');
assert.ok(loader.includes('window.__vcMarketStylesReady.then'), 'A publicidade deve aguardar o CSS antes de entrar no DOM.');
assert.ok(outdoor.includes('!await window.__vcMarketStylesReady'), 'O banner deve aguardar o CSS antes de entrar no DOM.');
assert.ok(!outdoor.includes("document.head.append(css)"), 'O módulo não deve inserir uma segunda folha de estilo tardiamente.');
assert.ok(prepare.includes('global-market-banner.js?v=7'), 'A versão do loader deve invalidar o cache antigo.');

console.log('Banner mobile: conteúdo dinâmico aguarda o CSS e evita flash sem estilo.');
