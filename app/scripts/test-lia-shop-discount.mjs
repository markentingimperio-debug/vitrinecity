import test from 'node:test';
import assert from 'node:assert/strict';
import {mountLiaShopDiscount} from '../public/lia-shop-discount.js';
import {validLiaQuote} from '../public/lia-discount.js';

class Element {
  constructor(){this.children=[];this.hidden=false;this.textContent='';this.checked=true;this.attrs={};}
  append(node){this.children.push(node);}
  replaceChildren(){this.children=[];}
  setAttribute(key,value){this.attrs[key]=value;}
  before(node){this.beforeNode=node;}
  get text(){return this.textContent+this.children.map(node=>node.text).join('');}
}
const quote=(eligible=true,originalAmountCents=2399)=>({eligible,couponCode:eligible?'LIA5':'',percent:eligible?5:0,originalAmountCents,discountCents:eligible?Math.round(originalAmountCents/20):0,amountCents:originalAmountCents-(eligible?Math.round(originalAmountCents/20):0)});
function harness(fetcher=async()=>({ok:true,json:async()=>({quote:quote()})})){
  const nodes=new Map(['total','marketplaceTerms','status','orderBreakdown'].map(id=>[id,new Element()])),requests=[];
  const doc={getElementById:id=>nodes.get(id)||null,createElement:()=>new Element()};let items=[{productId:1,quantity:1}],shipping=100;
  const controller=mountLiaShopDiscount({doc,getItems:()=>items,getShippingCents:()=>shipping,fetchImpl:async(url,options)=>{requests.push({url,options});return fetcher(url,options);}});
  return {controller,nodes,requests,setItems:value=>{items=value;},setShipping:value=>{shipping=value;},panel:()=>nodes.get('total').beforeNode};
}
const flush=async()=>{for(let n=0;n<20;n++)await Promise.resolve();};
test('server quote displays original, five-percent benefit and whole shipping without sending personal data',async()=>{
  const h=harness();await h.controller.refresh();assert.match(h.panel().text,/Produtos: R\$\s*23,99/);assert.match(h.panel().text,/LIA5 · 5%/);assert.match(h.panel().text,/1,20/);assert.match(h.panel().text,/Entrega: R\$\s*1,00/);assert.match(h.nodes.get('total').textContent,/23,79/);assert.equal(h.nodes.get('orderBreakdown').hidden,true);
  assert.deepEqual(JSON.parse(h.requests[0].options.body),{items:[{productId:1,quantity:1}]});assert.equal(h.requests[0].url,'/api/marketplace/checkout/quote');assert.equal(h.requests[0].options.cache,'no-store');
});
test('expiry updates the amount and unchecks acceptance; other sellers receive no discount notice',async()=>{
  let eligible=true;const h=harness(async()=>({ok:true,json:async()=>({quote:quote(eligible)})}));await h.controller.refresh();h.nodes.get('marketplaceTerms').checked=true;eligible=false;await h.controller.refresh();assert.equal(h.nodes.get('marketplaceTerms').checked,false);assert.doesNotMatch(h.panel().text,/LIA5/);assert.match(h.nodes.get('total').textContent,/24,99/);
});
test('an old in-flight quote never prices a newer cart and a new quote is requested after it finishes',async()=>{
  const releases=[];const h=harness(()=>new Promise(resolve=>releases.push(resolve)));h.controller.changed();h.setItems([{productId:2,quantity:3}]);h.controller.changed();
  releases[0]({ok:true,json:async()=>({quote:quote(true,1000)})});await flush();assert.equal(h.controller.current(),null);assert.equal(h.requests.length,2);
  releases[1]({ok:true,json:async()=>({quote:quote(true,3000)})});await flush();assert.equal(h.controller.current().originalAmountCents,3000);assert.match(h.nodes.get('total').textContent,/29,50/);
});
test('failed or malformed quotes leave payment unpriced and report a clear error without retries',async()=>{
  for(const data of [{quote:null},{quote:{...quote(),amountCents:1}}]){const h=harness(async()=>({ok:true,json:async()=>data}));await h.controller.changed();assert.equal(h.controller.current(),null);assert.match(h.nodes.get('status').textContent,/Não foi possível confirmar/);assert.equal(h.requests.length,1);}
});
test('empty cart clears the prior benefit and does not request or store a transcript',async()=>{
  const h=harness();await h.controller.refresh();h.setItems([]);await h.controller.changed();assert.equal(h.controller.current(),null);assert.equal(h.panel().hidden,true);assert.equal(h.requests.length,1);
});
test('display validation rejects forged percentages, missing flags and inconsistent monetary fields',()=>{
  for(const value of [{...quote(),percent:50},{...quote(),eligible:'true'},{...quote(),couponCode:'LIA50'},{...quote(),amountCents:-1},{...quote(false),discountCents:1},null])assert.equal(validLiaQuote(value),null);
  assert.deepEqual(validLiaQuote(quote()),quote());
});
