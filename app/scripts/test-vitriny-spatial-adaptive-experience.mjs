import assert from 'node:assert/strict';
import {combineSpatialLodFactors,createSpatialDistanceLodController,createSpatialLodController,premiumSpatialSlotState,resolveSpatialDayPhase,spatialLodFactors} from '../public/vitriny-spatial-adaptive-experience.js';

assert.equal(resolveSpatialDayPhase(6).id,'dawn');
assert.equal(resolveSpatialDayPhase(12).id,'day');
assert.equal(resolveSpatialDayPhase(18).id,'dusk');
assert.equal(resolveSpatialDayPhase(23).id,'night');
assert.equal(resolveSpatialDayPhase(-1).id,'night');
assert.equal(spatialLodFactors(99).furniture,0);

const lod=createSpatialLodController({profile:'STANDARD',stableSamples:2});
assert.equal(lod.level,0);
assert.equal(lod.sample(20).changed,false);
assert.equal(lod.sample(20).changed,true);
assert.equal(lod.level,1);
lod.sample(20);lod.sample(20);assert.equal(lod.level,2);
lod.sample(60);lod.sample(60);assert.equal(lod.level,1);
lod.sample(60);lod.sample(60);assert.equal(lod.level,0);

const distance=createSpatialDistanceLodController({profile:'STANDARD'});
assert.equal(distance.tier,0);
assert.equal(distance.sample(200).tier,1);
assert.equal(distance.sample(175).tier,1); // hysteresis: do not flap near threshold
assert.equal(distance.sample(120).tier,0);
assert.equal(distance.sample(420).tier,1); // one tier per sample keeps transitions gradual
assert.equal(distance.sample(420).tier,2);
assert.equal(distance.sample(760).tier,3);
assert.equal(distance.sample(650).tier,3);
assert.equal(distance.sample(580).tier,2);
assert.equal(distance.factors.furniture,0);

const combined=combineSpatialLodFactors(
  {skyline:.82,vegetation:.68,lights:.72,furniture:.55,districtFurniture:.7,premium:.7},
  {skyline:1,vegetation:.74,lights:.78,furniture:.5,districtFurniture:.62,premium:.7}
);
assert.deepEqual(combined,{skyline:.82,vegetation:.68,lights:.72,furniture:.5,districtFurniture:.62,premium:.7});
assert.equal(Object.isFrozen(combined),true);

assert.deepEqual(premiumSpatialSlotState({slotId:'premium:vitrine-city:1',districtId:'commerce',status:'available',sponsor:'x'}),{slotId:'premium:vitrine-city:1',districtId:'commerce',status:'available',sponsor:''});
assert.equal(premiumSpatialSlotState({slotId:'',districtId:'commerce'}),null);

console.log(JSON.stringify({ok:true,phase:resolveSpatialDayPhase(18).id,lod:lod.level,distanceTier:distance.tier}));
