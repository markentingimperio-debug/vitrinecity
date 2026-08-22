import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../public/social-accessibility.js', import.meta.url), 'utf8');
new Function(source);

for (const marker of [
  'Pular para o conteúdo principal', ':focus-visible', 'prefers-reduced-motion',
  "setAttribute('aria-live'", "setAttribute('aria-label'", "setAttribute('role', 'tablist'",
  'ArrowLeft', 'nameDynamicControls'
]) assert.ok(source.includes(marker), `Recurso de acessibilidade ausente: ${marker}`);

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
for (const route of ['/social.html', '/descobrir-social.html', '/perfil-social.html', '/chat-social.html']) {
  assert.ok(server.includes(route), `Rota social não coberta: ${route}`);
}
assert.ok(server.includes("'/social-accessibility.js'"), 'Script acessível não é injetado nas páginas sociais.');
console.log('acessibilidade-social: ok');
