import assert from 'node:assert/strict';
import express from 'express';
import {SPATIAL_CITIES,listSpatialCities,spatialCity,spatialCityDistrict} from '../vitriny-spatial/city-registry.js';
import {setupSpatialApi,spatialApiChunk} from '../spatial-api.js';

assert.equal(SPATIAL_CITIES.length,5);
assert.equal(new Set(SPATIAL_CITIES.map(city=>city.id)).size,5);
assert.equal(new Set(SPATIAL_CITIES.map(city=>city.worldKey)).size,5);
assert.deepEqual(SPATIAL_CITIES.map(city=>city.id),['vitrine-city','silvania','anapolis','vianopolis','goiania']);
assert.equal(spatialCity('ANAPOLIS').name,'Anápolis');
assert.equal(spatialCity('VIANOPOLIS').name,'Vianópolis');
assert.equal(spatialCity('missing'),null);
assert.equal(spatialCityDistrict('goiania','commerce').path,'/v/br/go/goiania/commerce');
assert.equal(spatialCityDistrict('vianopolis','social').path,'/v/br/go/vianopolis/social');
assert.equal(listSpatialCities({status:'preview'}).length,4);
assert.equal(SPATIAL_CITIES.every(city=>city.districts.length===8),true);

const a=spatialApiChunk('anapolis',2,-3),b=spatialApiChunk('anapolis',2,-3),c=spatialApiChunk('goiania',2,-3),v=spatialApiChunk('vianopolis',2,-3);
assert.deepEqual(a,b);
assert.equal(a.chunk.id,'br:go:anapolis:2:-3');
assert.equal(a.buildings.length,9);
assert.notDeepEqual(a.buildings,c.buildings);
assert.notDeepEqual(a.buildings,v.buildings);
assert.throws(()=>spatialApiChunk('missing',0,0),/city_not_found/);
assert.throws(()=>spatialApiChunk('anapolis','2.5',0),/chunk_x_invalid/);
assert.throws(()=>spatialApiChunk('anapolis',99999,0),/chunk_x_out_of_range/);

const app=express();setupSpatialApi(app);
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const base=`http://127.0.0.1:${server.address().port}`;
async function request(path){const response=await fetch(base+path);return{status:response.status,cache:response.headers.get('cache-control'),json:await response.json()};}
try{
  const root=await request('/api/spatial/v1');
  assert.equal(root.status,200);assert.equal(root.json.apiVersion,1);assert.equal(root.json.cityCount,5);assert.equal(root.json.capabilities.includes('themed-environment'),true);assert.equal(root.json.capabilities.includes('premium-zone-registry'),true);
  const cities=await request('/api/spatial/v1/cities?status=preview&region=go');
  assert.equal(cities.status,200);assert.equal(cities.json.count,4);assert.ok(cities.cache.includes('public'));
  assert.ok(cities.json.items.some(item=>item.id==='vianopolis'));
  const city=await request('/api/spatial/v1/cities/silvania');
  assert.equal(city.json.city.route,'/v/br/go/silvania');assert.equal(city.json.city.physicalIntegration,'logical');
  const vianopolis=await request('/api/spatial/v1/cities/vianopolis');
  assert.equal(vianopolis.status,200);assert.equal(vianopolis.json.city.name,'Vianópolis');assert.equal(vianopolis.json.city.status,'preview');
  const environment=await request('/api/spatial/v1/cities/vianopolis/environment?profile=LITE');
  assert.equal(environment.status,200);assert.equal(environment.json.environment.cityId,'vianopolis');assert.equal(environment.json.environment.profileId,'LITE');assert.equal(environment.json.environment.skyline.length,12);assert.ok(environment.cache.includes('public'));
  assert.equal((await request('/api/spatial/v1/cities/silvania/environment?profile=MEGA')).status,400);
  const premium=await request('/api/spatial/v1/cities/vianopolis/premium-zones?profile=LITE');
  assert.equal(premium.status,200);assert.equal(premium.json.cityId,'vianopolis');assert.equal(premium.json.profileId,'LITE');assert.equal(premium.json.count,premium.json.items.length);assert.equal(premium.json.activeCount,0);assert.equal(premium.json.items.every(item=>item.status==='available'),true);assert.ok(premium.cache.includes('public'));
  assert.equal((await request('/api/spatial/v1/cities/silvania/premium-zones?profile=MEGA')).status,400);
  assert.equal((await request('/api/spatial/v1/cities/missing/premium-zones')).status,404);
  const districts=await request('/api/spatial/v1/cities/anapolis/districts');
  assert.equal(districts.json.items.length,8);
  const district=await request('/api/spatial/v1/cities/vianopolis/districts/food');
  assert.equal(district.json.district.path,'/v/br/go/vianopolis/food');
  const chunk=await request('/api/spatial/v1/cities/vianopolis/chunks/1/-2');
  assert.equal(chunk.status,200);assert.equal(chunk.json.chunk.x,1);assert.equal(chunk.json.buildings.length,9);
  assert.equal((await request('/api/spatial/v1/cities/missing')).status,404);
  assert.equal((await request('/api/spatial/v1/cities/anapolis/chunks/nope/0')).status,400);
  assert.equal((await request('/api/spatial/v1/cities?status=private')).status,400);
}finally{await new Promise(resolve=>server.close(resolve));}

console.log(JSON.stringify({ok:true,cities:SPATIAL_CITIES.map(city=>({id:city.id,status:city.status})),buildings:a.buildings.length,premiumApi:true,vianopolis:true}));
