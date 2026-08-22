import assert from 'node:assert/strict';
import fs from 'node:fs';

const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
for(const label of ['Variação','Prazo estimado','Frete','Devolução','Avaliações de clientes'])assert.match(server,new RegExp(label));
assert.match(server,/marketplace_product_reviews/);
assert.match(server,/aggregateRating/);
assert.match(server,/Compra verificada/);
assert.match(server,/Calculado no checkout/);
assert.match(server,/delivery_min_days/);
assert.match(server,/return_days/);
console.log('product-purchase-details: ok');
