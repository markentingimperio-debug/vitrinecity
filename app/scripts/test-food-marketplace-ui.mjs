import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const admin = readFileSync(new URL('../public/admin-lojas.html', import.meta.url), 'utf8');
const shop = readFileSync(new URL('../public/loja.html', import.meta.url), 'utf8');

assert.match(admin, /Operação e cardápio/);
assert.match(admin, /id="businessType"/);
assert.match(admin, /id="acceptsOrders"/);
assert.match(admin, /preparationMinMinutes/);
assert.match(admin, /preparationMaxMinutes/);
assert.match(admin, /Mercado Pago:/);
assert.match(admin, /\/food-profile/);
assert.match(admin, /business_hours|businessHours/);
assert.match(admin, /menu_categories|menuCategories/);

assert.match(shop, /id='deliveryEta'/);
assert.match(shop, /Estimativa total:/);
assert.match(shop, /Preparo .*rota aproximada/);
assert.match(shop, /food-badge/);
assert.match(shop, /Fechado para pedidos/);
assert.match(shop, /Adicionar ao pedido/);

console.log('food-marketplace-ui: ok');
