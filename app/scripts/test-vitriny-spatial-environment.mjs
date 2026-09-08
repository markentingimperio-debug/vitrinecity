import assert from 'node:assert/strict';
import {planSpatialCityEnvironment} from '../vitriny-spatial/city-environment.js';

const isInsideTransit=position=>Math.abs(position.x)<58&&position.z>74&&position.z<128;

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
  assert.ok(lite.districtLights.length<=standard.districtLights.length);
  assert.ok(standard.districtLights.length<=ultra.districtLights.length);
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
  for(const light of ultra.districtLights){
    assert.ok(['commerce','social','creator','food','education','entertainment','business','services'].includes(light.districtId));
    assert.ok(light.accentIndex>=0&&light.accentIndex<8);assert.ok(light.height>=5);assert.ok(light.intensity>=.7&&light.intensity<=1);
    assert.ok(Number.isFinite(light.position.x)&&Number.isFinite(light.position.z));
    assert.equal(isInsideTransit(light.position),false);
  }
  assert.equal(new Set(lite.districtLights.map(item=>item.districtId)).size,8);
  assert.equal(lite.districtLights.length,8);
  assert.ok(lite.districtLights.every(light=>!isInsideTransit(light.position)));
  for(const slot of ultra.premiumSlots){
    assert.equal(slot.status,'available');assert.equal(slot.sponsor,'');assert.ok(slot.slotId.startsWith(`premium:${cityId}:`));
  }
  const repeat=planSpatialCityEnvironment(cityId,{profileId:'STANDARD'});
  assert.deepEqual(repeat,standard);
}

const sponsored=planSpatialCityEnvironment('vitrine-city',{
  profileId:'STANDARD',now:Date.parse('2026-09-08T12:00:00Z'),premiumAssignments:[
    {slotId:'premium:vitrine-city:0',districtId:'commerce',status:'active',sponsor:'Loja Jardim',campaignRef:'campaign:123',approved:true},
    {slotId:'premium:vitrine-city:1',districtId:'social',status:'active',sponsor:'Pendente',approved:false}
  ]
});
assert.equal(sponsored.premiumSlots.find(slot=>slot.slotId==='premium:vitrine-city:0')?.status,'active');
assert.equal(sponsored.premiumSlots.find(slot=>slot.slotId==='premium:vitrine-city:0')?.sponsor,'Loja Jardim');
assert.equal(sponsored.premiumSlots.find(slot=>slot.slotId==='premium:vitrine-city:1')?.status,'reserved');
assert.equal(sponsored.premiumSlots.find(slot=>slot.slotId==='premium:vitrine-city:1')?.sponsor,'');

assert.throws(()=>planSpatialCityEnvironment('nao-existe'),/city_not_found/);
console.log(JSON.stringify({ok:true,cities:4,profiles:3,premium:true,districtFurniture:true,districtLights:true,premiumOverlay:true,transitProtected:true}));
