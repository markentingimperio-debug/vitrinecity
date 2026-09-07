import assert from 'node:assert/strict';
import {fetchStoreInteriorData,layoutStoreProducts,normalizeInteriorProduct} from '../public/vitriny-store-interior-core.js';

const products=[
  {id:3,store_reference:'ref-a',name:'Terra Vegetal 3 kg',description:'Solo pronto',category:'Jardinagem',price_cents:1255,stock_quantity:20,rating_average:4.8},
  {id:4,store_reference:'ref-a',name:'NPK 3 kg',category:'Adubos',price_cents:1397,stock_quantity:15},
  {id:5,store_reference:'ref-b',name:'Outro produto',category:'Outros',price_cents:999,stock_quantity:5}
];
const normalized=normalizeInteriorProduct(products[0]);
assert.equal(normalized.href,'/produto/3/terra-vegetal-3-kg');
assert.equal(normalized.priceCents,1255);
assert.equal(normalizeInteriorProduct({id:'x',store_reference:'ref-a',name:'x'}),null);

const layout=layoutStoreProducts(products,{storeReference:'ref-a',columns:2});
assert.equal(layout.length,2);
assert.equal(layout.every(item=>item.storeReference==='ref-a'),true);
assert.equal(new Set(layout.map(item=>`${item.position.x}:${item.position.z}`)).size,2);

const calls=[];
const result=await fetchStoreInteriorData({storeReference:'ref-a',storeName:'Agrotécnica',fetchImpl:async url=>{
  calls.push(url);
  if(url==='/api/marketplace/stores')return new Response(JSON.stringify({stores:[{order_reference:'ref-a',business_name:'Agrotécnica'},{order_reference:'ref-b',business_name:'Outra'}]}),{status:200,headers:{'content-type':'application/json'}});
  if(url.startsWith('/api/marketplace/products?q='))return new Response(JSON.stringify({products}),{status:200,headers:{'content-type':'application/json'}});
  return new Response('{}',{status:404});
}});
assert.equal(calls.length,2);
assert.equal(calls.some(url=>url.includes('Agrot%C3%A9cnica')),true);
assert.equal(result.store.business_name,'Agrotécnica');
assert.equal(result.products.length,2);
await assert.rejects(()=>fetchStoreInteriorData({storeReference:'missing',fetchImpl:async url=>url.includes('/stores')?new Response(JSON.stringify({stores:[]}),{status:200}):new Response(JSON.stringify({products:[]}),{status:200})}),/spatial_store_not_found/);

console.log(JSON.stringify({ok:true,products:result.products.length,first:result.products[0].href}));
