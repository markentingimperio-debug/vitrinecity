import assert from 'node:assert/strict';
import express from 'express';
import {SPATIAL_CITIES,listSpatialCities,spatialCity,spatialCityDistrict} from '../vitriny-spatial/city-registry.js';
import {setupSpatialApi,spatialApiChunk} from '../spatial-api.js';

assert.equal(SPATIAL_CITIES.length,4);
assert.equal(new Set(SPATIAL_CITIES.map(city=>city.id)).size,4);
assert.equal(new Set(SPATIAL_CITIES.map(city=>city.worldKey)).size,4);
assert.deepEqual(SPATIAL_CITIES.map(city=>city.id),['vitrine-city','silvania','anapolis','goiania']);
assert.equal(spatialCity('ANAPOLIS').name,'Anápolis');
assert.equal(spatialCity('missing'),null);
assert.equal(spatialCityDistrict('goiania','commerce').path,'/v/br/go/goiania/commerce');
assert.equal(listSpatialCities({status:'preview'}).length,3);
assert.equal(SPATIAL_CITIES.every(city=>city.districts.length===8),true);

const a=spatialApiChunk('anapolis',2,-3),b=spatialApiChunk('anapolis',2,-3),c=spatialApiChunk('goiania',2,-3);
assert.deepEqual(a,b);
assert.equal(a.chunk.id,'br:go:anapolis:2:-3');
assert.equal(a.buildings.length,9);
assert.notDeepEqual(a.buildings,c.buildings);
assert.throws(()=>spatialApiChunk('missing',0,0),/city_not_found/);
assert.throws(()=>spatialApiChunk('anapolis','2.5',0),/chunk_x_invalid/);
assert.throws(()=>spatialApiChunk('anapolis',99999,0),/chunk_x_out_of_range/);

const app=express();setupSpatialApi(app);
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const base=`http://127.0.0.1:${server.address().port}`;
async function request(path){const response=await fetch(base+path);return{status:response.status,cache:response.headers.get('cache-control'),json:await response.json()};}
try{
  const root=await request('/api/spatial/v1');
  assert.equal(root.status,200);assert.equal(root.json.apiVersion,1);assert.equal(root.json.cityCount,4);assert.equal(root.json.capabilities.includes('themed-environment'),true);
  const cities=await request('/api/spatial/v1/cities?status=preview&region=go');
  assert.equal(cities.status,200);assert.equal(cities.json.count,3);assert.ok(cities.cache.includes('public'));
  const city=await request('/api/spatial/v1/cities/silvania');
  assert.equal(city.json.city.route,'/v/br/go/silvania');assert.equal(city.json.city.physicalIntegration,'logical');
  const environment=await request('/api/spatial/v1/cities/silvania/environment?profile=LITE');
  assert.equal(environment.status,200);assert.equal(environment.json.environment.cityId,'silvania');assert.equal(environment.json.environment.profileId,'LITE');assert.equal(environment.json.environment.skyline.length,12);assert.ok(environment.cache.includes('public'));
  assert.equal((await request('/api/spatial/v1/cities/silvania/environment?profile=MEGA')).status,400);
  const districts=await request('/api/spatial/v1/cities/anapolis/districts');
  assert.equal(districts.json.items.length,8);
  const district=await request('/api/spatial/v1/cities/anapolis/districts/food');
  assert.equal(district.json.district.path,'/v/br/go/anapolis/food');
  const chunk=await request('/api/spatial/v1/cities/anapolis/chunks/1/-2');
  assert.equal(chunk.status,200);assert.equal(chunk.json.chunk.x,1);assert.equal(chunk.json.buildings.length,9);
  assert.equal((await request('/api/spatial/v1/cities/missing')).status,404);
  assert.equal((await request('/api/spatial/v1/cities/anapolis/chunks/nope/0')).status,400);
  assert.equal((await request('/api/spatial/v1/cities?status=private')).status,400);
}finally{await new Promise(resolve=>server.close(resolve));}

console.log(JSON.stringify({ok:true,cities:SPATIAL_CITIES.map(city=>({id:city.id,status:city.status})),buildings:a.buildings.length}));
