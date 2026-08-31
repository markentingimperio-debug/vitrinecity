import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const renderer = fs.readFileSync(new URL('../public/discover-renderer.js', import.meta.url), 'utf8');
const enhancements = fs.readFileSync(new URL('../public/discover-enhancements.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../public/descobrir-social.html', import.meta.url), 'utf8');

assert.doesNotMatch(enhancements, /\.innerHTML\s*=/, 'Aprimoramentos não devem interpretar dados da API como HTML.');
assert.match(enhancements, /replaceChildren/, 'Aprimoramentos devem montar nós DOM seguros.');
assert.match(page, /\/discover-renderer\.js/, 'A página deve carregar o renderizador seguro compartilhado.');
assert.doesNotMatch(page, /\.innerHTML\s*=/, 'A página base não deve interpretar dados da API como HTML.');
for (const marker of ['safeInternalPath', 'safeImageUrl', "parsed.protocol === 'https:'", 'parsed.username || parsed.password']) {
  assert.ok(renderer.includes(marker), `Política de URL ausente: ${marker}`);
}
for (const forbidden of ['javascript:', 'data:', 'blob:', 'file:']) {
  assert.ok(!renderer.includes(`return '${forbidden}`), `Esquema perigoso permitido: ${forbidden}`);
}

const context = { window: {}, location: { origin: 'https://vitrinecity.com' }, URL };
vm.runInNewContext(renderer, context);
const { safeInternalPath, safeImageUrl, safePlayerUrl } = context.window.VitrineDiscoverRenderer;
assert.equal(safeInternalPath('/cidade/sao-paulo?ordem=alta'), '/cidade/sao-paulo?ordem=alta');
assert.equal(safeInternalPath('//evil.example/roubo'), '');
assert.equal(safeInternalPath('javascript:alert(1)'), '');
assert.equal(safeImageUrl('/uploads/avatar.webp'), 'https://vitrinecity.com/uploads/avatar.webp');
assert.equal(safeImageUrl('https://cdn.example/avatar.webp'), 'https://cdn.example/avatar.webp');
assert.equal(safeImageUrl('http://cdn.example/avatar.webp'), '');
assert.equal(safeImageUrl('data:image/svg+xml,<svg onload=alert(1)>'), '');
assert.equal(safeImageUrl('https://user:secret@cdn.example/avatar.webp'), '');
assert.equal(safePlayerUrl('https://iframe.videodelivery.net/abc?autoplay=true'), 'https://iframe.videodelivery.net/abc?autoplay=true');
assert.equal(safePlayerUrl('https://iframe.videodelivery.net:444/abc'), '');
assert.equal(safePlayerUrl('https://user:secret@iframe.videodelivery.net/abc'), '');
assert.equal(safePlayerUrl('https://evil.example/embed'), '');
for (const marker of ['AbortController', 'controller.signal.aborted', 'data-post-id']) {
  assert.ok(page.includes(marker) || enhancements.includes(marker), `Proteção contra respostas obsoletas ausente: ${marker}`);
}
assert.match(enhancements, /postsById\.get\(post\.dataset\.postId\)/, 'Engajamento deve ser associado pelo ID estável da publicação.');

console.log('discover-security: ok');
