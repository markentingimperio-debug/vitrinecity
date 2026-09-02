import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel=fs.readFileSync(new URL('../public/painel-lojista.html',import.meta.url),'utf8');

assert.match(panel,/dataset\.tab='ads'/,'aba Publicidade ausente');
for(const plan of ['Destaque','Banner Premium','Tráfego','Completo'])assert.match(panel,new RegExp(plan));
for(const field of ['adsPlan','adsCity','adsCategory','adsStartsOn','adsDurationDays','adsBudget','adsCreativeFile','adsCreativeUrl'])assert.match(panel,new RegExp(`id="${field}"`));
assert.match(panel,/imageData\(document\.getElementById\('adsCreativeFile'/,'upload deve reutilizar otimização existente');
assert.match(panel,/vitrine-ads/,'contrato Ads do portal ausente');
for(const metric of ['Impressões','Cliques','Pedidos','Conversão','ROAS'])assert.match(panel,new RegExp(metric));
assert.match(panel,/mediaCents/,'verba de mídia deve ser apresentada separadamente');
assert.match(panel,/managementFeeCents/,'taxa de gestão deve ser apresentada separadamente');
assert.match(panel,/statusLabel/,'status/aprovação ausente');
assert.match(panel,/commerceLoading/,'fluxo anterior deve permanecer');
assert.match(panel,/ringOrderBell/,'alerta sonoro deve permanecer');
assert.match(panel,/deliveryTracking/,'tempo real deve permanecer');
assert.match(panel,/foodProductFields/,'cardápio deve permanecer');

console.log('seller ads panel static tests passed');
