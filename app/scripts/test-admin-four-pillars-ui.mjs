import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/admin.html', import.meta.url), 'utf8');
for (const label of ['Visão Geral', 'Gestão de Entregadores', 'Gestão de Lojistas', 'Gestão de Clientes']) {
  assert.match(html, new RegExp(label, 'i'), `pilar administrativo ausente: ${label}`);
}
assert.match(html, /href="\/admin-entregas\.html"/);
assert.match(html, /href="\/admin-lojas\.html"/);
assert.match(html, /href="\/admin-identidade\.html"/);
assert.match(html, /href="\/admin-social-moderacao\.html"/);
for (const metric of ['Entregas', 'Vendas', 'Avaliações', 'Pendências']) assert.match(html, new RegExp(metric, 'i'));
for (const action of ['editar', 'autorizar', 'aprovar', 'acompanhar', 'pagar', 'repasses', 'restringir', 'conversar']) {
  assert.match(html, new RegExp(action, 'i'), `ação administrativa ausente: ${action}`);
}
assert.match(html, /refer[eê]ncia [uú]nica/i);
assert.match(html, /preserva o hist[oó]rico financeiro/i);
for (const id of ['managementType', 'managementReference', 'managementAction', 'managementExecute', 'profileChatForm', 'reviewsQueue']) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `controle funcional ausente: ${id}`);
}
for (const endpoint of ['/api/admin/profiles/', '/messages', '/api/admin/reviews', '/api/admin/review-appeals/']) {
  assert.ok(html.includes(endpoint), `integração administrativa ausente: ${endpoint}`);
}
assert.match(html, /confirm_payment/);
assert.match(html, /Idempotency-Key/i);
assert.match(html, /data-review-action="publish"/);
assert.match(html, /data-review-action="hide"/);
assert.match(html, /data-appeal-action="approve"/);
console.log('admin-four-pillars-ui: ok');
