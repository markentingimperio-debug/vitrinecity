import assert from 'node:assert/strict';
import {createSpatialLodController,premiumSpatialSlotState,resolveSpatialDayPhase,spatialLodFactors} from '../public/vitriny-spatial-adaptive-experience.js';

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

assert.deepEqual(premiumSpatialSlotState({slotId:'premium:vitrine-city:1',districtId:'commerce',status:'available',sponsor:'x'}),{slotId:'premium:vitrine-city:1',districtId:'commerce',status:'available',sponsor:''});
assert.equal(premiumSpatialSlotState({slotId:'',districtId:'commerce'}),null);

console.log(JSON.stringify({ok:true,phase:resolveSpatialDayPhase(18).id,lod:lod.level}));
