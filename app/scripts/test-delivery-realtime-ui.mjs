import assert from 'node:assert/strict';
import fs from 'node:fs';

const seller=fs.readFileSync(new URL('../public/painel-lojista.html',import.meta.url),'utf8');
const buyer=fs.readFileSync(new URL('../public/pedidos.html',import.meta.url),'utf8');

for(const page of [seller,buyer]){
  for(const label of ['Pagamento aprovado','Preparando','Pronto','Coletado','Saiu para entrega','Entregue'])assert.match(page,new RegExp(label));
  assert.match(page,/deliveryTracking\?\.location/,'posição deve vir do contrato protegido de tracking');
  assert.match(page,/\/api\/maps\/config/);
  assert.match(page,/maps\.googleapis\.com\/maps\/api\/js/);
  assert.match(page,/current>=3&&current<5/,'mapa deve existir somente entre coleta e entrega');
  assert.match(page,/Última atualização/);
  assert.match(page,/visibilityState==='visible'/,'polling deve pausar fora da aba visível');
}

assert.match(seller,/commerceLoading/,'polling do lojista deve impedir sobreposição');
assert.match(seller,/ringOrderBell/,'alerta sonoro do lojista deve ser preservado');
assert.match(buyer,/ordersLoading/,'polling do comprador deve impedir sobreposição');
assert.match(buyer,/setTimeout\(pollOrders,12000\)/,'polling encadeado esperado');
assert.doesNotMatch(buyer,/setInterval\(loadOrders/,'não criar polling concorrente');

console.log('delivery realtime UI static tests passed');
