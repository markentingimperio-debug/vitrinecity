import assert from 'node:assert/strict';
import fs from 'node:fs';

const page=fs.readFileSync(new URL('../public/solucoes.html',import.meta.url),'utf8');
const home=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
for(const expected of ['R$10 por mês','R$200 por pacote','VitrineCity Ads','Marketplace','Cursos livres','Programa de afiliados'])assert.equal(page.includes(expected),true,`conteúdo ausente: ${expected}`);
assert.match(page,/Nenhuma vaga oficial aberta no momento/);
assert.match(page,/não publica vagas fictícias/i);
assert.match(page,/application\/ld\+json/);
assert.match(page,/https:\/\/vitrinecity\.com\/solucoes\.html/);
assert.match(home,/href="\/solucoes\.html"/);
assert.match(server,/'\/solucoes\.html'/);
console.log('services-catalog: ok');
