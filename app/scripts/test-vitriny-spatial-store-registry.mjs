import assert from 'node:assert/strict';
import {normalizeSpatialStore,mapStoresToSpatialEntities,fetchSpatialStores} from '../public/vitriny-spatial-store-registry.js';

const raw=[
  {order_reference:'ref-b',business_name:'Loja B',business_type:'retail',product_count:5,rating_average:4.7,city:'Anápolis',state:'GO'},
  {order_reference:'ref-a',business_name:'Café Árvore',business_type:'food',product_count:12,rating_average:4.9,accepting_orders:1,city:'Silvânia',state:'GO'},
  {order_reference:'',business_name:'Inválida'}
];
const normalized=normalizeSpatialStore(raw[1]);
assert.equal(normalized.id,'store:ref-a');
assert.equal(normalized.kind,'food');
assert.equal(normalized.href,'/loja/ref-a/cafe-arvore');
assert.equal(normalized.productCount,12);
assert.equal(normalized.rating,4.9);

const a=mapStoresToSpatialEntities(raw,{limit:10});
const b=mapStoresToSpatialEntities([...raw].reverse(),{limit:10});
assert.equal(a.length,2);
assert.deepEqual(a,b);
assert.equal(a[0].reference,'ref-a');
assert.equal(a.every(item=>item.district==='commerce'&&item.entityType==='store'),true);
assert.equal(a.every(item=>Number.isFinite(item.position.x)&&Number.isFinite(item.size.height)),true);
assert.equal(new Set(a.map(item=>`${item.position.x}:${item.position.z}`)).size,a.length);

let called=0;
const fetched=await fetchSpatialStores({limit:1,fetchImpl:async(url,options)=>{called++;assert.equal(url,'/api/marketplace/stores');assert.equal(options.headers.accept,'application/json');return new Response(JSON.stringify({stores:raw}),{status:200,headers:{'content-type':'application/json'}});}});
assert.equal(called,1);
assert.equal(fetched.length,1);
assert.equal(fetched[0].reference,'ref-a');
await assert.rejects(()=>fetchSpatialStores({fetchImpl:async()=>new Response('{}',{status:503})}),/spatial_stores_503/);

console.log(JSON.stringify({ok:true,stores:a.length,first:a[0].href}));
