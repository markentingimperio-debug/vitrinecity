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
  assert.ok(lite.districtFurniture.length<=standard.districtFurniture.length);
  assert.ok(standard.districtFurniture.length<=ultra.districtFurniture.length);
  assert.ok(lite.premiumSlots.length<=standard.premiumSlots.length);
  assert.ok(standard.premiumSlots.length<=ultra.premiumSlots.length);
  assert.equal(lite.zones.some(zone=>zone.id==='central-plaza'),true);
  assert.equal(lite.zones.some(zone=>zone.id==='transit-forecourt'),true);
  assert.equal(lite.zones.some(zone=>zone.id==='premium-ring'),true);
  for(const building of ultra.skyline){
    assert.ok(Math.hypot(building.position.x,building.position.z)>=100);
    assert.ok(building.size.height>=3&&building.size.height<=240);
    assert.ok(Number.isFinite(building.rotationY));
  }
  for(const item of ultra.districtFurniture){
    assert.ok(['commerce','social','creator','food','education','entertainment','business','services'].includes(item.districtId));
    assert.ok(Number.isFinite(item.position.x)&&Number.isFinite(item.position.z));
  }
  for(const slot of ultra.premiumSlots){
    assert.equal(slot.status,'available');assert.equal(slot.sponsor,'');assert.ok(slot.slotId.startsWith(`premium:${cityId}:`));
  }
  const repeat=planSpatialCityEnvironment(cityId,{profileId:'STANDARD'});
  assert.deepEqual(repeat,standard);
}
assert.throws(()=>planSpatialCityEnvironment('nao-existe'),/city_not_found/);
console.log(JSON.stringify({ok:true,cities:4,profiles:3,premium:true,districtFurniture:true}));
