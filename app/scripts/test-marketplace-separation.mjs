import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const deliveries=readFileSync(new URL('../public/entregas.html',import.meta.url),'utf8');
const shop=readFileSync(new URL('../public/loja.html',import.meta.url),'utf8');
const banner=readFileSync(new URL('../public/global-market-banner.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');

assert.match(deliveries,/vc-entregas-hero\.png/);
assert.match(deliveries,/Compras e entregas locais/);
assert.match(deliveries,/Loja Oficial/);
assert.match(deliveries,/delivery=local/);
assert.match(shop,/VC Entregas — compras locais/);
assert.match(shop,/Entrega digital/);
assert.match(banner,/isLocalDelivery/);
assert.match(server,/delivery=String\(req\.query\.delivery/);
assert.match(server,/s\.fulfillment_mode IN \('local','both'\)/);
console.log('marketplace separation: ok');
