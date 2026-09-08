import assert from 'node:assert/strict';
import {mapBusinessesToSpatialEntities,fetchSpatialBusinesses} from '../public/vitriny-spatial-business-registry.js';

const raw=[
  {order_reference:'b',business_name:'Empresa B',business_type:'retail',product_count:4,rating_average:4.1,city:'Anápolis',state:'GO'},
  {order_reference:'a',business_name:'Empresa A',business_type:'retail',product_count:12,rating_average:4.9,city:'Goiânia',state:'GO'}
];
const mapped=mapBusinessesToSpatialEntities(raw,{limit:10,rows:2});
assert.equal(mapped.length,2);
assert.equal(mapped[0].reference,'a');
assert.equal(mapped[0].entityType,'business');
assert.equal(mapped.every(item=>item.district==='business'),true);
assert.equal(new Set(mapped.map(item=>`${item.position.x}:${item.position.z}`)).size,2);
assert.equal(mapped[0].href,'/loja/a/empresa-a');
let called=0;
const fetched=await fetchSpatialBusinesses({limit:1,fetchImpl:async(url,options)=>{called++;assert.equal(url,'/api/marketplace/stores');assert.equal(options.headers.accept,'application/json');return new Response(JSON.stringify({stores:raw}),{status:200,headers:{'content-type':'application/json'}});}});
assert.equal(called,1);assert.equal(fetched.length,1);assert.equal(fetched[0].reference,'a');
await assert.rejects(()=>fetchSpatialBusinesses({fetchImpl:async()=>new Response('{}',{status:503})}),/spatial_business_503/);
console.log(JSON.stringify({ok:true,entities:mapped.length,first:mapped[0].href}));
