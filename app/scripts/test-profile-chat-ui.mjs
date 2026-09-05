import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=relative=>fs.readFileSync(new URL(relative,import.meta.url),'utf8');
const buyerOrders=read('../public/pedidos.html');
const buyerAccount=read('../public/minha-conta.html');
const seller=read('../public/painel-lojista.html');
const widget=read('../public/profile-chat.js');

for(const page of [buyerOrders,buyerAccount]){
  assert.match(page,/data-profile-chat="customer"/,'chat do cliente deve estar disponível');
  assert.match(page,/profile-chat\.js/,'componente compartilhado deve ser carregado');
}
assert.match(seller,/data-profile-chat="store"/,'chat da loja deve estar disponível');
assert.match(seller,/data-tab="messages"/,'painel lojista deve expor a aba de mensagens');
assert.match(seller,/profile-chat\.js/);

assert.match(widget,/\/api\/profile\/messages/);
assert.match(widget,/\/api\/store-portal\/\$\{encodeURIComponent\(reference\)\}\/messages/);
assert.match(widget,/searchParams\.set\('token',token\)/,'GET da loja deve autenticar com token');
assert.match(widget,/JSON\.stringify\(\{message,token\}\)/,'POST da loja deve autenticar com token');
assert.match(widget,/maxlength="2000"/);
assert.match(widget,/aria-live="polite"/);
assert.match(widget,/button\.disabled=true/,'envio deve impedir duplo clique');
assert.match(widget,/response\.status===401/,'sessão expirada deve ser tratada');
assert.match(widget,/setInterval|setTimeout/,'conversa deve atualizar sem recarregar a página');
assert.match(widget,/textContent/,'mensagens recebidas devem ser inseridas como texto, não HTML');

console.log('profile chat UI static tests passed');
