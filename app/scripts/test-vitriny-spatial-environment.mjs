import assert from 'node:assert/strict';
import {planSpatialCityEnvironment} from '../vitriny-spatial/city-environment.js';

for(const cityId of ['vitrine-city','silvania','anapolis','goiania']){
  const lite=planSpatialCityEnvironment(cityId,{profileId:'LITE'});
  const standard=planSpatialCityEnvironment(cityId,{profileId:'STANDARD'});
  const ultra=planSpatialCityEnvironment(cityId,{profileId:'ULTRA'});
  assert.equal(lite.cityId,cityId);
  assert.equal(lite.worldKey,`br:go:${cityId}`);
  assert.equal(lite.profileId,'LITE');
  assert.ok(lite.skyline.length<standard.skyline.length);
  assert.ok(standard.skyline.length<ultra.skyline.length);
  assert.ok(lite.vegetation.length<=standard.vegetation.length);
  assert.ok(standard.vegetation.length<=ultra.vegetation.length);
  assert.equal(lite.zones.some(zone=>zone.id==='central-plaza'),true);
  assert.equal(lite.zones.some(zone=>zone.id==='transit-forecourt'),true);
  for(const building of ultra.skyline){
    assert.ok(Math.hypot(building.position.x,building.position.z)>=100);
    assert.ok(building.size.height>=3&&building.size.height<=240);
    assert.ok(Number.isFinite(building.rotationY));
  }
  const repeat=planSpatialCityEnvironment(cityId,{profileId:'STANDARD'});
  assert.deepEqual(repeat,standard);
}
assert.throws(()=>planSpatialCityEnvironment('nao-existe'),/city_not_found/);
console.log(JSON.stringify({ok:true,cities:4,profiles:3}));
