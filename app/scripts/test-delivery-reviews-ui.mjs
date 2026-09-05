import assert from 'node:assert/strict';
import fs from 'node:fs';

const buyer=fs.readFileSync(new URL('../public/pedidos.html',import.meta.url),'utf8');
const seller=fs.readFileSync(new URL('../public/painel-lojista.html',import.meta.url),'utf8');

for(const text of ['Avaliar loja','Avaliar entregador','5 moedas','Comentário'])assert.match(buyer,new RegExp(text,'i'));
assert.match(buyer,/storeRating/);
assert.match(buyer,/courierRating/);
assert.match(buyer,/min="1" max="5"/);
assert.match(buyer,/customerConfirmedAt/,'avaliação só deve aparecer após confirmação');
assert.match(buyer,/alreadyReviewed|Já avaliado/);
assert.match(buyer,/pending_moderation|Em moderação/);
assert.match(buyer,/delivery-review/,'contrato de criação da avaliação ausente');

for(const text of ['Avaliações verificadas','Média','Responder','Denunciar'])assert.match(seller,new RegExp(text,'i'));
assert.match(seller,/Compra verificada/);
assert.match(seller,/seller-reviews/);
assert.match(seller,/review-response/);
assert.match(seller,/review-report/);
assert.doesNotMatch(seller,/delete-review|Apagar avaliação|Excluir avaliação/i,'lojista não pode apagar avaliações');
for(const preserved of [/ringOrderBell/,/deliveryTracking/,/VitrineCity Ads/,/foodProductFields/])assert.match(seller,preserved);

console.log('delivery reviews UI static tests passed');
