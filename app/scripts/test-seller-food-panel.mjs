import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel = fs.readFileSync(new URL('../public/painel-lojista.html', import.meta.url), 'utf8');

for (const tab of ['registration', 'operation', 'catalog', 'payments', 'orders']) {
  assert.match(panel, new RegExp(`data-tab="${tab}"`), `aba ${tab} ausente`);
}

for (const field of [
  'businessType', 'street', 'addressNumber', 'addressComplement', 'neighborhood',
  'acceptingOrders', 'preparationMinMinutes', 'preparationMaxMinutes', 'pickupInstructions',
  'productPreparationMinutes', 'productDietaryTags', 'productAllergens', 'productOptions',
  'productAvailable', 'productFeatured'
]) {
  assert.match(panel, new RegExp(`id="${field}"`), `campo ${field} ausente`);
}

assert.match(panel, /dayNames=.*monday.*tuesday.*wednesday.*thursday.*friday.*saturday.*sunday/s, 'grade semanal incompleta');
assert.match(panel, /min>max/, 'validação da faixa de preparo ausente');
assert.match(panel, /day\.opens>=day\.closes/, 'validação dos horários ausente');
assert.match(panel, /\/operations/, 'contrato da operação ausente');
assert.match(panel, /food-status/);
assert.match(panel, /\['accept','Aceitar pedido'\]/);
assert.match(panel, /\['prepare','Iniciar preparo'\]/);
assert.match(panel, /\['ready','Marcar pronto'\]/);
assert.match(panel, /taxIdMasked/);
assert.match(panel, /providerUserIdMasked/, 'painel deve usar apenas identificador Mercado Pago mascarado');
assert.match(panel, /menu-categories/);
assert.match(panel, /productMenuCategory/);
assert.match(panel, /products\/\$\{id\}\/options/);
assert.doesNotMatch(panel, /agência bancária|senha bancária|número da conta/i, 'painel não deve coletar segredo bancário');

// Regressões importantes do painel atual.
assert.match(panel, /Ativar som de novos pedidos/);
assert.match(panel, /ringOrderBell/);
assert.match(panel, /Produtos da minha loja/);
assert.match(panel, /marketplaceEnabled/);

console.log('seller food panel static tests passed');
