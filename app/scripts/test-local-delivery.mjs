import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculateLocalDelivery, googleRouteDistance } from '../local-delivery.js';

assert.deepEqual(calculateLocalDelivery(500), {distanceMeters:500,distanceKm:0.5,additionalKm:0,feeCents:500,platformCents:50,courierCents:450});
assert.equal(calculateLocalDelivery(1000).feeCents,500);
assert.equal(calculateLocalDelivery(1001).feeCents,550);
assert.equal(calculateLocalDelivery(5000).courierCents,630);
assert.throws(()=>calculateLocalDelivery(30001),/distance_out_of_range/);
let request;
const route=await googleRouteDistance({origin:'Loja',destination:'Cliente',apiKey:'test',fetchImpl:async(url,options)=>{
  request={url,options};return {ok:true,json:async()=>({routes:[{distanceMeters:2450,duration:'420s'}]})};
}});
assert.equal(route.distanceMeters,2450);
assert.match(request.url,/routes\.googleapis\.com/);
assert(!request.options.body.includes('test'));
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('../public/admin-entregas.html',import.meta.url),'utf8');
assert.match(server,/CREATE TABLE IF NOT EXISTS local_delivery_settings/);
assert.match(server,/CREATE TABLE IF NOT EXISTS local_delivery_jobs/);
assert.match(server,/\/api\/marketplace\/local-delivery\/quote/);
assert.match(server,/\/api\/admin\/local-delivery/);
assert.match(admin,/Tarifa base/);
assert.match(admin,/Comissão VitrineCity/);
console.log('local-delivery: ok');
