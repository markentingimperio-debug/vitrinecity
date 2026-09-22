import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveEcosystemContext} from '../vitriny-neural/live-ecosystem-context.js';
import {enrichPaidChatInput} from '../vitriny-neural/paid-platform-context.js';

const db={prepare(sql){
  if(sql.includes('sqlite_master'))return {get:()=>({})};
  if(sql.includes('FROM store_products'))return {all:()=>[
    {id:9,name:'Adubo NPK 10-10-10 Líquido',category:'Adubos',business_name:'Agrotecnica'},
    {id:10,name:'Adubo NPK orgânico',category:'Adubos',business_name:'Agrotecnica'},
    {id:11,name:'Outro produto',category:'Adubos',business_name:'Agrotecnica'}
  ]};
  if(sql.includes('FROM managed_courses'))return {all:()=>[]};
  if(sql.includes('FROM store_profiles'))return {all:()=>[]};
  throw Error(`Unexpected query: ${sql}`);
}};

test('Lia receives relevant live catalog entries and verified internal routes',()=>{
  const provider=createLiveEcosystemContext({db,now:()=>Date.parse('2026-09-22T17:00:00Z')});
  const result=provider('quero npk');
  assert.equal(result.products.length,2);
  assert.equal(result.products[0].url,'https://vitrinecity.com/produto/9');
  assert.match(result.note,/não comprova estoque/);
  const input={messages:[{role:'user',content:'quero npk'}],maxOutputTokens:1024};
  const enriched=enrichPaidChatInput(input,{question:'quero npk',at:Date.parse('2026-09-22T17:00:00Z'),liveEcosystemProvider:provider});
  assert.match(enriched.messages[0].content,/Adubo NPK 10-10-10 Líquido/);
  assert.equal(enriched.messages.at(-1).content,'quero npk');
  assert.equal(input.messages.length,1);
});

test('unrelated questions and private data stay out of the public snapshot',()=>{
  const provider=createLiveEcosystemContext({db});
  assert.equal(provider('qual é a previsão do tempo?'),null);
  const routes=provider('onde fica a cidade?');
  assert.equal(routes.products.length,0);
  assert.equal(routes.routes[0].url,'https://vitrinecity.com/cidade');
  assert.equal(JSON.stringify(routes).includes('user_id'),false);
});
