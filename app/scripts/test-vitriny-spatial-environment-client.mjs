import assert from 'node:assert/strict';
import {fetchSpatialEnvironment,normalizeSpatialEnvironment} from '../public/vitriny-spatial-environment-client.js';
import {planSpatialCityEnvironment} from '../vitriny-spatial/city-environment.js';

const source=planSpatialCityEnvironment('anapolis',{profileId:'STANDARD'});
const normalized=normalizeSpatialEnvironment(source,{cityId:'anapolis',profileId:'STANDARD'});
assert.ok(normalized);
assert.equal(normalized.cityId,'anapolis');
assert.equal(normalized.profileId,'STANDARD');
assert.equal(normalized.skyline.length,source.skyline.length);
assert.equal(normalized.vegetation.length,source.vegetation.length);
assert.equal(normalizeSpatialEnvironment({...source,worldKey:'br:go:evil'},{cityId:'anapolis',profileId:'STANDARD'}),null);
assert.equal(normalizeSpatialEnvironment({...source,profileId:'ULTRA'},{cityId:'anapolis',profileId:'STANDARD'}),null);

let requested='';
const fetched=await fetchSpatialEnvironment({cityId:'anapolis',profileId:'STANDARD',fetchImpl:async url=>{
  requested=url;
  return new Response(JSON.stringify({apiVersion:1,environment:source}),{status:200,headers:{'content-type':'application/json'}});
}});
assert.equal(requested,'/api/spatial/v1/cities/anapolis/environment?profile=STANDARD');
assert.equal(fetched.skyline.length,source.skyline.length);
await assert.rejects(()=>fetchSpatialEnvironment({cityId:'anapolis',profileId:'INVALID',fetchImpl:async()=>new Response('{}')}),/spatial_environment_request_invalid/);
await assert.rejects(()=>fetchSpatialEnvironment({cityId:'anapolis',profileId:'STANDARD',fetchImpl:async()=>new Response('{}',{status:503})}),/spatial_environment_503/);

console.log(JSON.stringify({ok:true,skyline:fetched.skyline.length,vegetation:fetched.vegetation.length}));
