import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {formatCoins,formatCoinBRL,coinSummary} from '../public/vitrine-coins-ui.js';
import {atomsFromRewardPoints,atomsFromMicroBRL,quoteCoinTopup} from '../public/vitrine-coins-contract.js';

test('Coin display preserves atomic fractions and locale without floating accounting',()=>{
  assert.equal(formatCoins('1'),'0,0000001');
  assert.equal(formatCoins('8999999999999999'),'899.999.999,9999999');
  assert.equal(coinSummary('816000000'),'81,6 Vitrine Coins (R$ 8,50)');
  assert.equal(formatCoinBRL('1'),'R$ 0,00000001');
  assert.equal(formatCoinBRL(atomsFromMicroBRL(1)),'R$ 0,000001');
  assert.equal(formatCoins('0'),'0');
  assert.throws(()=>formatCoins('-1'));
  assert.throws(()=>formatCoins('NaN'));
});
test('Legacy reward units convert, rather than relabel or add nominally',()=>{
  assert.equal(formatCoins(atomsFromRewardPoints(100,100)),'9,6');
  assert.equal(formatCoins(atomsFromRewardPoints(300,100)),'28,8');
  assert.notEqual(formatCoins(atomsFromRewardPoints(100,100)),'100');
  assert.throws(()=>atomsFromRewardPoints(1,7));
});
test('Only the canonical topup contract computes the 15 percent fee',()=>{
  assert.equal(coinSummary(quoteCoinTopup(1000).netAtoms),'81,6 Vitrine Coins (R$ 8,50)');
  assert.equal(coinSummary(quoteCoinTopup(501).netAtoms),'40,896 Vitrine Coins (R$ 4,26)');
  assert.equal(coinSummary(atomsFromMicroBRL(1000000)),'9,6 Vitrine Coins (R$ 1,00)');
});
test('Central and personal chat consumers use canonical data and retain legacy distinction',async()=>{
  const central=await readFile(new URL('../public/central-creditos.js',import.meta.url),'utf8');
  const chat=await readFile(new URL('../public/neural-workspace.js',import.meta.url),'utf8');
  const html=await readFile(new URL('../public/central-creditos.html',import.meta.url),'utf8');
  assert.match(central,/assertCoinStatus/);assert.match(central,/atomsFromRewardPoints/);
  assert.match(central,/pontos anteriores/);assert.match(central,/q\.discountCents>Math\.floor\(q\.priceCents\*\.3\)/);
  assert.match(chat,/\/api\/neural\/chat/);assert.match(chat,/storeReference/);
  assert.match(html,/personal=1/);assert.match(html,/Não há pagamento integral do curso/);
});
