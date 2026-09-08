import assert from 'node:assert/strict';
import {SPATIAL_CITY_IDENTITY_IDS,publicSpatialCityIdentity,spatialCityIdentity,spatialCityIdentityCss} from '../vitriny-spatial/city-identity.js';
import {fallbackSpatialCityIdentity,fetchSpatialCityIdentity,normalizeSpatialCityIdentity,spatialIdentityCityFromLocation} from '../public/vitriny-spatial-city-identity.js';
import {spatialCity} from '../vitriny-spatial/city-registry.js';

assert.deepEqual(SPATIAL_CITY_IDENTITY_IDS,['vitrine-city','silvania','anapolis','vianopolis','goiania']);
for(const id of SPATIAL_CITY_IDENTITY_IDS){
  const identity=publicSpatialCityIdentity(id);assert.ok(identity);assert.match(identity.palette.accent,/^#[0-9a-f]{6}$/i);assert.ok(identity.landmark.height>=30);assert.equal(spatialCity(id).identity.themeId,identity.themeId);
}
assert.equal(spatialCityIdentity('missing'),null);
assert.equal(spatialCityIdentityCss('anapolis')['--spatial-accent'],'#6f9cff');
assert.equal(spatialCityIdentityCss('vianopolis')['--spatial-accent'],'#f0c96b');
assert.equal(spatialIdentityCityFromLocation({search:'?city=goiania'}),'goiania');
assert.equal(spatialIdentityCityFromLocation({search:'?city=vianopolis'}),'vianopolis');
assert.equal(spatialIdentityCityFromLocation({search:'?city=unknown'}),'vitrine-city');

const normalized=normalizeSpatialCityIdentity({themeId:'x',tagline:'Teste',palette:{accent:'javascript:bad'},landmark:{kind:'bad'}},'silvania');
assert.equal(normalized.palette.accent,fallbackSpatialCityIdentity('silvania').palette.accent);
assert.equal(normalized.landmark.kind,'crown');
assert.equal(fallbackSpatialCityIdentity('vianopolis').landmark.id,'cerrado-gateway');

let requested='';
const fetched=await fetchSpatialCityIdentity({cityId:'goiania',fetchImpl:async url=>{requested=url;return new Response(JSON.stringify({city:{identity:publicSpatialCityIdentity('goiania')}}),{status:200,headers:{'content-type':'application/json'}});}});
assert.equal(requested,'/api/spatial/v1/cities/goiania');
assert.equal(fetched.themeId,'green-metropolis');
const offline=await fetchSpatialCityIdentity({cityId:'anapolis',fetchImpl:async()=>{throw new Error('offline');}});
assert.equal(offline.themeId,'connected-axis');
const vianopolisOffline=await fetchSpatialCityIdentity({cityId:'vianopolis',fetchImpl:async()=>{throw new Error('offline');}});
assert.equal(vianopolisOffline.themeId,'cerrado-crossroads');

console.log(JSON.stringify({ok:true,cities:SPATIAL_CITY_IDENTITY_IDS.length,theme:fetched.themeId,vianopolis:vianopolisOffline.themeId}));
