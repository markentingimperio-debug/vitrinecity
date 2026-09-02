import assert from 'node:assert/strict';
import {eligibleCouriers,haversineMeters,offerExpired} from '../courier-dispatch.js';
const now=Date.now(),store={latitude:-16.65,longitude:-48.61,city:'Silvânia',state:'GO'};
const candidates=eligibleCouriers([
  {id:2,status:'active',available:1,latitude:-16.70,longitude:-48.61,locationAt:new Date(now-1000).toISOString(),city:'Silvânia',state:'GO'},
  {id:1,status:'active',available:1,latitude:-16.651,longitude:-48.61,locationAt:new Date(now-1000).toISOString(),city:'silvânia',state:'go'},
  {id:3,status:'active',available:1,latitude:-16.6501,longitude:-48.61,locationAt:new Date(now-600000).toISOString(),city:'Silvânia',state:'GO'}
],store,{now});
assert.deepEqual(candidates.map(item=>item.id),[1,2]);
assert.ok(haversineMeters(store,candidates[0])<haversineMeters(store,candidates[1]));
assert.deepEqual(eligibleCouriers(candidates,store,{now,excludedIds:[1]}).map(item=>item.id),[2]);
assert.equal(offerExpired(new Date(now-1).toISOString(),now),true);
console.log('courier dispatch tests passed');
