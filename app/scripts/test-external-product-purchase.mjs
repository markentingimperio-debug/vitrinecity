import test from 'node:test';
import assert from 'node:assert/strict';
import {externalPhysicalProductDestination,applyExternalPhysicalProductLinks} from '../public/vitriny-external-product-purchase.js';

const official={id:11,name:'Adubo NPK para Rosa do Deserto',product_type:'physical',product_url:'https://adubonpkparaplantas.com.br/product/adubo-npk-rosa-do-deserto/'};
test('a physical product opens its configured shop without creating a competing internal purchase',()=>{
  assert.deepEqual(externalPhysicalProductDestination(official),{href:official.product_url,host:'adubonpkparaplantas.com.br',label:'Ver opções na loja'});
  const basic={...official,product_type:undefined};assert.equal(externalPhysicalProductDestination(basic).href,official.product_url);
});

test('internal and digital products retain their current purchase behavior',()=>{
  for(const product of [{id:1},{...official,product_url:''},{...official,product_url:'/produto/11/adubo'},{...official,product_url:'https://vitrinecity.com/produto/11/adubo'},{...official,product_type:'digital'}])assert.equal(externalPhysicalProductDestination(product),null);
  assert.equal(externalPhysicalProductDestination({...official,product_url:'http://localhost:4173/produto/11'},{origin:'http://localhost:4173'}),null);
});

test('purchase links reject executable, credentialed and malformed URLs',()=>{
  for(const product_url of ['javascript:alert(1)','data:text/html,buy','file:///payment','//evil.example/pay','https://user:password@example.com/pay','https://example.com/a b','https://example.com/a\\b','https://example.com/%0apayment','https://example.com/%0Dpayment','https://example.com/%5cpayment','https://','https://exam\tple.com/pay'])assert.equal(externalPhysicalProductDestination({...official,product_url}),null,product_url);
  assert.equal(externalPhysicalProductDestination(official,{origin:'invalid'}),null);
});

test('visible cards disclose the destination and no longer carry an add-to-cart action',()=>{
  const state=new Map(),created=[];
  const ownerDocument={createElement:tag=>{const element={tag,style:{}};created.push(element);return element;}};
  const container={ownerDocument,querySelector:selector=>state.get(selector)};
  for(const id of [11,12,13])state.set(`[data-add="${id}"]`,{replaceWith(...elements){state.set(`[data-add="${id}"]`,null);state.set(id,elements);}});
  const products=[official,{...official,id:12,product_url:''},{...official,id:13,product_type:'digital'}];
  assert.equal(applyExternalPhysicalProductLinks(container,products),1);
  const [link,note]=state.get(11);
  assert.equal(link.tag,'a');assert.equal(link.href,official.product_url);assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');
  assert.equal(link.textContent,'Ver opções na loja');assert.match(note.textContent,/adubonpkparaplantas\.com\.br.*outra aba/);
  assert.ok(state.get('[data-add="12"]'));assert.ok(state.get('[data-add="13"]'));
  assert.equal(applyExternalPhysicalProductLinks(container,products),0,'Repeated render decoration must not duplicate purchase links');
  assert.equal(created.length,2);
});

test('invalid product identifiers cannot alter other cards',()=>{
  let queries=0;const container={querySelector:()=>{queries++;throw new Error('Unexpected card lookup');}};
  for(const id of ['11"] a',NaN,Infinity,-1,0]){
    assert.equal(applyExternalPhysicalProductLinks(container,[{...official,id}]),0);
  }
  assert.equal(queries,0);
});
