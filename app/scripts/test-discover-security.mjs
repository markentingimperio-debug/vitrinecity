import assert from 'node:assert/strict';
import fs from 'node:fs';

const renderer = fs.readFileSync(new URL('../public/discover-renderer.js', import.meta.url), 'utf8');
const enhancements = fs.readFileSync(new URL('../public/discover-enhancements.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../public/descobrir-social.html', import.meta.url), 'utf8');

assert.doesNotMatch(enhancements, /\.innerHTML\s*=/, 'Aprimoramentos não devem interpretar dados da API como HTML.');
assert.match(enhancements, /replaceChildren/, 'Aprimoramentos devem montar nós DOM seguros.');
assert.match(page, /\/discover-renderer\.js/, 'A página deve carregar o renderizador seguro compartilhado.');
assert.doesNotMatch(page, /\.innerHTML\s*=/, 'A página base não deve interpretar dados da API como HTML.');
for (const marker of ['safeInternalPath', 'safeImageUrl', "parsed.protocol === 'https:'", 'parsed.username || parsed.password', "parsed.origin === 'https://iframe.videodelivery.net'"]) {
  assert.ok(renderer.includes(marker), `Política de URL ausente: ${marker}`);
}
for (const forbidden of ['javascript:', 'data:', 'blob:', 'file:']) {
  assert.ok(!renderer.includes(`return '${forbidden}`), `Esquema perigoso permitido: ${forbidden}`);
}

for (const marker of ['AbortController', 'controller.signal.aborted', 'data-post-id']) {
  assert.ok(page.includes(marker) || enhancements.includes(marker), `Proteção contra respostas obsoletas ausente: ${marker}`);
}
assert.match(enhancements, /postsById\.get\(post\.dataset\.postId\)/, 'Engajamento deve ser associado pelo ID estável da publicação.');

console.log('discover-security: ok');
