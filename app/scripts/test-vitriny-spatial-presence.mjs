import assert from 'node:assert/strict';
import {createSpatialPresenceTracker,normalizeSpatialPresenceDistrict,SPATIAL_PRESENCE_DISTRICTS} from '../spatial-presence.js';
import {inferSpatialPresenceDistrict} from '../public/vitriny-spatial-presence-client.js';

let clock=1_000_000;
const tracker=createSpatialPresenceTracker({now:()=>clock,ttlMs:50_000,maxSessions:3});

assert.equal(normalizeSpatialPresenceDistrict('SOCIAL'),'social');
assert.equal(normalizeSpatialPresenceDistrict('admin'),null);
assert.equal(SPATIAL_PRESENCE_DISTRICTS.includes('central'),true);

let state=tracker.heartbeat('session_abcdefghijklmnop','social');
assert.equal(state.total,1);
assert.equal(state.count,1);
assert.equal(state.districts.social,1);

state=tracker.heartbeat('session_abcdefghijklmnop','business');
assert.equal(state.total,1);
assert.equal(state.districts.social,0);
assert.equal(state.districts.business,1);

tracker.heartbeat('session_qrstuvwxyz123456','business');
assert.equal(tracker.snapshot().total,2);
assert.equal(tracker.snapshot().districts.business,2);

clock+=49_000;
tracker.heartbeat('session_abcdefghijklmnop','business');
assert.equal(tracker.snapshot().total,2);
clock+=2_000;
assert.equal(tracker.snapshot().total,1);

assert.throws(()=>tracker.heartbeat('short','social'),/invalid_session/);
assert.throws(()=>tracker.heartbeat('session_valid_123456789','admin'),/invalid_district/);

tracker.heartbeat('session_2222222222222222','food');
tracker.heartbeat('session_3333333333333333','education');
assert.equal(tracker.snapshot().total,3);
assert.throws(()=>tracker.heartbeat('session_4444444444444444','social'),/presence_capacity/);
tracker.leave('session_2222222222222222');
assert.equal(tracker.snapshot().total,2);

assert.equal(inferSpatialPresenceDistrict({pathname:'/vitriny-multiverse-explore.html',search:''}),'central');
assert.equal(inferSpatialPresenceDistrict({pathname:'/vitriny-store-interior.html',search:'?store=abc'}),'commerce');
assert.equal(inferSpatialPresenceDistrict({pathname:'/vitriny-multiverse-district.html',search:'?district=education'}),'education');
assert.equal(inferSpatialPresenceDistrict({pathname:'/vitriny-multiverse-district.html',search:'?district=admin'}),null);
assert.equal(inferSpatialPresenceDistrict({pathname:'/outra-pagina.html',search:''}),null);

console.log(JSON.stringify({ok:true,total:tracker.snapshot().total,districts:SPATIAL_PRESENCE_DISTRICTS.length}));
