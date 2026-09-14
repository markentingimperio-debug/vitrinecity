import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFactGroundedDraft,FactGroundedDraftError,FACT_GROUNDED_DRAFT_LIMITS as limits,FACT_GROUNDED_DRAFT_FORMATS as formats} from '../vitriny-neural/fact-grounded-drafts.js';

const productFacts=()=>[
  {id:'product.name',text:'Organizador de gavetas com 6 divisórias.'},
  {id:'product.price',text:'Preço informado: R$ 29,90.'},
  {id:'product.stock',text:'Disponibilidade não confirmada.'},
  {id:'product.color',text:'Cor informada: azul.',required:false}
];
function fails(input,code){
  assert.throws(()=>createFactGroundedDraft(input),error=>error instanceof FactGroundedDraftError&&error.code===code);
}

test('default rendering works without a model and preserves every supplied character',()=>{
  const facts=productFacts();
  facts[0].text='  Organizador — 6 divisórias, 30 × 20 cm.  ';
  const before=structuredClone(facts),result=createFactGroundedDraft({facts});
  assert.equal(result.text,facts.map(fact=>fact.text).join('\n'));
  assert.deepEqual(result.factIds,facts.map(fact=>fact.id));
  assert.deepEqual(result.grounding,{method:'literal_facts',scope:'supplied_facts_only',externallyVerified:false});
  assert.equal(result.draft,true);
  assert.deepEqual(facts,before);
  assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.factIds)&&Object.isFrozen(result.grounding));
});

test('selection can only reorder known facts and omit explicitly optional statements',()=>{
  const facts=productFacts(),selection={factIds:['product.price','product.name','product.stock']};
  const result=createFactGroundedDraft({facts,selection});
  assert.equal(result.text,`${facts[1].text}\n${facts[0].text}\n${facts[2].text}`);
  assert.deepEqual(result.factIds,selection.factIds);
  facts[1].text='Modelo alterou o preço para R$ 1,00.';
  selection.factIds[0]='product.color';
  assert.ok(result.text.startsWith('Preço informado: R$ 29,90.'));
  assert.equal(result.factIds[0],'product.price');
});

test('support draft cannot gain a delivery promise by attaching valid citations',()=>{
  const facts=[
    {id:'order.status',text:'O pedido está em separação.'},
    {id:'order.deadline',text:'O prazo de entrega ainda não foi confirmado.'}
  ];
  const factIds=facts.map(fact=>fact.id);
  for(const extra of [
    {text:'Seu pedido chega amanhã. [order.status]'},
    {claims:[{text:'Reembolso aprovado.',factIds:['order.status']}]},
    {reply:'Já avisamos a transportadora.'},
    {title:'Entrega garantida amanhã!'},
    {factIds,output:'Benefício extra sem vínculo literal.'}
  ])fails({facts,selection:{factIds,...extra}},'unexpected_field');
  const result=createFactGroundedDraft({facts,selection:{factIds}});
  assert.equal(result.text,'O pedido está em separação.\nO prazo de entrega ainda não foi confirmado.');
});

test('formatting changes only fixed separators and bullet prefixes, never supplied text',()=>{
  const facts=[{id:'literal',text:'<img src=x onerror="alert(1)">'},{id:'status',text:'  Sem envio confirmado.  '}];
  const expected={
    lines:'<img src=x onerror="alert(1)">\n  Sem envio confirmado.  ',
    paragraphs:'<img src=x onerror="alert(1)">\n\n  Sem envio confirmado.  ',
    bullets:'- <img src=x onerror="alert(1)">\n-   Sem envio confirmado.  '
  };
  assert.deepEqual(formats,Object.keys(expected));
  for(const format of formats)assert.equal(createFactGroundedDraft({facts,format}).text,expected[format]);
  for(const format of [undefined,null,'html','markdown','',{},['lines'],0])fails({facts,format},'invalid_format');
});

test('unknown, duplicate and omitted required facts fail closed',()=>{
  const facts=productFacts();
  fails({facts,selection:{factIds:['product.name','product.price','product.stock','invented.benefit']}},'unknown_fact_id');
  fails({facts,selection:{factIds:['product.name','product.price','product.stock','product.name']}},'duplicate_selected_id');
  fails({facts,selection:{factIds:['product.name','product.price']}},'missing_required_fact');
  fails({facts:[{id:'qualification',text:'Ação não executada.',required:true},{id:'status',text:'Plano pronto.',required:false}],selection:{factIds:['status']}},'missing_required_fact');
});

test('registry rejects duplicate IDs and duplicate literal statements',()=>{
  fails({facts:[{id:'same',text:'Primeiro fato.'},{id:'same',text:'Segundo fato.'}]},'duplicate_fact_id');
  fails({facts:[{id:'first',text:'Uma declaração.'},{id:'second',text:'Uma declaração.'}]},'duplicate_fact_text');
});

test('strict schema rejects prose, coercion, extra fields and invalid flags',()=>{
  for(const value of [null,undefined,[],42,'{"facts":[]}'])fails(value,'invalid_object');
  fails({},'missing_field');
  fails({facts:productFacts(),claims:['invented']},'unexpected_field');
  for(const facts of [null,{},'fato',true])fails({facts},'invalid_array');
  for(const value of [null,'fato',[],42])fails({facts:[value]},'invalid_object');
  fails({facts:[{id:'fact',text:'Um fato.',claim:'Outro fato.'}]},'unexpected_field');
  for(const required of [undefined,null,0,1,'true','false'])fails({facts:[{id:'fact',text:'Um fato.',required}]},'invalid_required');
  for(const id of [null,42,'',' spaced','line\nbreak','a/b','a'.repeat(limits.maxIdLength+1)])fails({facts:[{id,text:'Um fato.'}]},'invalid_fact_id');
  for(const text of [null,42,false,{},'', '  ', 'text\nclaim', 'text\r\nclaim', 'text\tclaim', 'text\u0000claim', 'text\u0085claim', 'text\u2028claim', 'text\u2029claim'])fails({facts:[{id:'fact',text}]},'invalid_fact_text');
  for(const selection of [null,undefined,[],42,'{"factIds":["fact"]}'])fails({facts:productFacts(),selection},'invalid_object');
  fails({facts:productFacts(),selection:{}},'missing_field');
  fails({facts:productFacts(),selection:{factIds:['product.name'],text:undefined}},'unexpected_field');
  fails({facts:productFacts(),selection:{factIds:[{id:'product.name',text:'invented'}]}},'invalid_fact_id');
});

test('all facts are validated even when selection would omit the invalid record',()=>{
  fails({facts:[{id:'valid',text:'Fato completo.'},{id:'invalid',text:'',required:false}],selection:{factIds:['valid']}},'invalid_fact_text');
  fails({facts:[{id:'valid',text:'Fato completo.'},{id:'invalid',text:'x'.repeat(limits.maxFactLength+1),required:false}],selection:{factIds:['valid']}},'invalid_fact_text');
});

test('bounds reject overflow instead of silently truncating facts or selections',()=>{
  fails({facts:[]},'invalid_count');
  fails({facts:Array.from({length:limits.maxFacts+1},(_,index)=>({id:`f${index}`,text:`Fato ${index}.`}))},'invalid_count');
  const atFactLimit={id:'max',text:'a'.repeat(limits.maxFactLength)};
  assert.equal(createFactGroundedDraft({facts:[atFactLimit]}).text,atFactLimit.text);
  fails({facts:[{...atFactLimit,text:atFactLimit.text+'a'}]},'invalid_fact_text');
  const maximumFacts=Array.from({length:limits.maxFacts},(_,index)=>({id:`f${index}`,text:`Fato ${index}.`}));
  assert.equal(createFactGroundedDraft({facts:maximumFacts}).factIds.length,limits.maxFacts);
  fails({facts:maximumFacts,selection:{factIds:[]}},'invalid_count');
  fails({facts:maximumFacts,selection:{factIds:[...maximumFacts.map(fact=>fact.id),'f0']}},'invalid_count');
  const totalLimitFacts=Array.from({length:limits.maxTotalFactLength/limits.maxFactLength},(_,index)=>({id:`f${index}`,text:String(index).padEnd(limits.maxFactLength,'a')}));
  assert.equal(createFactGroundedDraft({facts:totalLimitFacts}).text.length,limits.maxTotalFactLength+totalLimitFacts.length-1);
  fails({facts:[...totalLimitFacts,{id:'extra',text:'x',required:false}],selection:{factIds:totalLimitFacts.map(fact=>fact.id)}},'invalid_count');
  assert.equal(createFactGroundedDraft({facts:[{id:'a'.repeat(limits.maxIdLength),text:'At the ID limit.'}]}).factIds[0].length,limits.maxIdLength);
});

test('JSON-like input does not execute field getters or inherit claims',()=>{
  let getterCalls=0;
  const input={};Object.defineProperty(input,'facts',{enumerable:true,get(){getterCalls++;return productFacts();}});
  fails(input,'invalid_field');
  const fact={id:'fact'};Object.defineProperty(fact,'text',{enumerable:true,get(){getterCalls++;return 'Invented text.';}});
  fails({facts:[fact]},'invalid_field');
  const sparse=new Array(1);fails({facts:sparse},'invalid_array');
  const accessorArray=[];Object.defineProperty(accessorArray,0,{enumerable:true,get(){getterCalls++;return fact;}});
  fails({facts:accessorArray},'invalid_array');
  const tagged=productFacts();tagged.claim='Unsupported claim';fails({facts:tagged},'invalid_array');
  fails({facts:[Object.assign(Object.create({text:'Inherited fact'}),{id:'fact'})]},'invalid_object');
  const selection=JSON.parse('{"factIds":["product.name","product.price","product.stock"],"__proto__":{"claim":"invented"}}');
  fails({facts:productFacts(),selection},'unexpected_field');
  assert.equal(getterCalls,0);
});

test('grounding explicitly means fidelity to supplied statements, not external verification',()=>{
  const text='O registro fornecido afirma uma entrega em Marte.';
  const result=createFactGroundedDraft({facts:[{id:'unverified',text}]});
  assert.equal(result.text,text);
  assert.equal(result.grounding.externallyVerified,false);
  assert.equal(result.grounding.scope,'supplied_facts_only');
});
