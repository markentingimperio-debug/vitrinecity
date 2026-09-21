import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeAvenueStores,filterAvenueStores} from '../public/avenida-core.js';

const stores=normalizeAvenueStores(
  [{order_reference:'agro',business_name:'Agrotécnica',city:'Silvânia',description:'Jardinagem e cultivo'}],
  [{reference:'agro',name:'Agrotécnica',city:'Silvânia'},{reference:'moda',name:'Sertaneja Moda Country',city:'Goiânia'}]
);
assert.equal(stores.length,2,'loja publicada em duas fontes não deve aparecer duplicada');
assert.equal(filterAvenueStores(stores,'agrotecnica').length,1,'busca deve ignorar acentos');
assert.equal(filterAvenueStores(stores,'moda goiania').length,1,'busca deve combinar palavras');
assert.equal(filterAvenueStores(stores,'inexistente').length,0);
assert.ok(stores.every(store=>store.href.startsWith('/loja/')));

const page=readFileSync(new URL('../public/avenida.html',import.meta.url),'utf8');
const client=readFileSync(new URL('../public/avenida.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
assert.match(page,/id="street"/);
assert.match(page,/id="storeSearch"/);
assert.match(page,/id="tour"/);
assert.match(client,/prefers-reduced-motion/);
assert.match(client,/Promise\.allSettled/);
assert.match(server,/app\.get\('\/avenida', publicPage\('avenida\.html'\)\)/);
console.log('Avenida: dados, busca, rota e controles verificados.');
