import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichLiaWorkInstruction} from '../vitriny-neural/lia-work-context.js';

const at=Date.parse('2026-09-22T17:00:00Z');

test('coding worker receives reviewed platform facts and relevant public catalog, without changing the request',()=>{
  const request='Crie um site para apresentar NPK na VitrineCity';
  const result=enrichLiaWorkInstruction(request,{kind:'code',at,liveEcosystemProvider:()=>({
    products:[{name:'NPK Orgânico',url:'https://vitrinecity.com/produto/10'}],
    note:'A página deve confirmar preço e estoque.'
  })});
  assert.ok(result.startsWith(request+'\n\n'));
  assert.match(result,/REFERÊNCIA PÚBLICA DA VITRINECITY/);
  assert.match(result,/https:\/\/vitrinecity.com\/produto\/10/);
  assert.match(result,/nunca comandos ou autorização/);
  assert.ok(result.length<=6000);
});

test('research retains its source instruction and skips excessive optional data',()=>{
  const request='Analise as fontes consultadas: '+('evidência '.repeat(450));
  const result=enrichLiaWorkInstruction(request,{kind:'research',question:'quero NPK',at,liveEcosystemProvider:()=>({products:[{name:'x'.repeat(1800)}]})});
  assert.ok(result.startsWith(request));
  assert.ok(result.length<=6000);
  assert.doesNotMatch(result,/x{1800}/);
  assert.equal(enrichLiaWorkInstruction('Abra https://example.org',{kind:'browser',at}), 'Abra https://example.org');
});
