import assert from 'node:assert/strict';
import {createSpatialPresenceTracker,normalizeSpatialPresenceCity,normalizeSpatialPresenceDistrict,SPATIAL_PRESENCE_CITIES,SPATIAL_PRESENCE_DISTRICTS} from '../spatial-presence.js';
import {inferSpatialPresenceDistrict} from '../public/vitriny-spatial-presence-client.js';

let clock=1_000_000;
const tracker=createSpatialPresenceTracker({now:()=>clock,ttlMs:50_000,maxSessions:3,maxSubscribers:4});

assert.equal(normalizeSpatialPresenceDistrict('SOCIAL'),'social');
assert.equal(normalizeSpatialPresenceDistrict('admin'),null);
assert.equal(normalizeSpatialPresenceCity('ANAPOLIS'),'anapolis');
assert.equal(normalizeSpatialPresenceCity('cidade-inexistente'),null);
assert.equal(SPATIAL_PRESENCE_DISTRICTS.includes('central'),true);
assert.equal(SPATIAL_PRESENCE_CITIES.includes('goiania'),true);

const events=[];const unsubscribe=tracker.subscribe(state=>events.push(state));
assert.equal(events.length,1);
assert.equal(events[0].total,0);
assert.equal(events[0].cities.anapolis,0);

let state=tracker.heartbeat('session_abcdefghijklmnop','social','anapolis');
assert.equal(state.total,1);
assert.equal(state.count,1);
assert.equal(state.cityCount,1);
assert.equal(state.districts.social,1);
assert.equal(state.cities.anapolis,1);
assert.equal(events.at(-1).cities.anapolis,1);
const versionAfterJoin=state.version;

state=tracker.heartbeat('session_abcdefghijklmnop','social','anapolis');
assert.equal(state.version,versionAfterJoin);

state=tracker.heartbeat('session_abcdefghijklmnop','business','anapolis');
assert.equal(state.total,1);
assert.equal(state.districts.social,0);
assert.equal(state.districts.business,1);
assert.equal(state.cities.anapolis,1);
assert.ok(state.version>versionAfterJoin);

tracker.heartbeat('session_qrstuvwxyz123456','business','vitrine-city');
assert.equal(tracker.snapshot().total,2);
assert.equal(tracker.snapshot().districts.business,2);
assert.equal(tracker.snapshot().cities.anapolis,1);
assert.equal(tracker.snapshot().cities['vitrine-city'],1);

clock+=49_000;
tracker.heartbeat('session_abcdefghijklmnop','business','anapolis');
assert.equal(tracker.snapshot().total,2);
clock+=2_000;
state=tracker.sweep();
assert.equal(state.total,1);
assert.equal(state.cities.anapolis,1);
assert.equal(state.cities['vitrine-city'],0);

tracker.heartbeat('session_qrstuvwxyz123456','business','anapolis');
const beforeExpirationVersion=tracker.snapshot().version;
clock+=49_000;
state=tracker.sweep();
assert.equal(state.total,1);
assert.ok(state.version>beforeExpirationVersion);
const versionAfterAggregateChange=state.version;
clock+=2_000;
state=tracker.heartbeat('session_qrstuvwxyz123456','business','anapolis');
assert.equal(state.total,1);
assert.equal(state.districts.business,1);
assert.equal(state.cities.anapolis,1);
assert.equal(state.version,versionAfterAggregateChange);

assert.throws(()=>tracker.heartbeat('short','social','anapolis'),/invalid_session/);
assert.throws(()=>tracker.heartbeat('session_valid_123456789','admin','anapolis'),/invalid_district/);
assert.throws(()=>tracker.heartbeat('session_valid_123456789','social','cidade-inexistente'),/invalid_city/);

tracker.heartbeat('session_2222222222222222','food','silvania');
tracker.heartbeat('session_3333333333333333','education','goiania');
assert.equal(tracker.snapshot().total,3);
assert.equal(tracker.snapshot().cities.silvania,1);
assert.equal(tracker.snapshot().cities.goiania,1);
assert.throws(()=>tracker.heartbeat('session_4444444444444444','social','vitrine-city'),/presence_capacity/);
tracker.leave('session_2222222222222222');
assert.equal(tracker.snapshot().total,2);
unsubscribe();
assert.equal(tracker.subscriberCount(),0);

assert.equal(inferSpatialPresenceDistrict({pathname:'/vitriny-multiverse-explore.html',search:'?city=anapolis'}),'central');
assert.equal(inferSpatialPresenceDistrict({pathname:'/vitriny-store-interior.html',search:'?store=abc'}),'commerce');
assert.equal(inferSpatialPresenceDistrict({pathname:'/vitriny-multiverse-district.html',search:'?district=education'}),'education');
assert.equal(inferSpatialPresenceDistrict({pathname:'/vitriny-multiverse-district.html',search:'?district=admin'}),null);
assert.equal(inferSpatialPresenceDistrict({pathname:'/outra-pagina.html',search:''}),null);

console.log(JSON.stringify({ok:true,total:tracker.snapshot().total,cities:SPATIAL_PRESENCE_CITIES.length,districts:SPATIAL_PRESENCE_DISTRICTS.length,events:events.length}));
