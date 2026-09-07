import assert from 'node:assert/strict';
import {createPlatformBridge} from '../vitriny-neural/platform-bridge.js';
import {createSpatialNeuralBridge} from '../vitriny-neural/spatial-signal-bridge.js';

const ingested=[];
const platform=createPlatformBridge({neural:{ingest:event=>{ingested.push(event);return{accepted:true,id:`e${ingested.length}`};}},pseudonymSalt:'spatial-bridge-test-salt'});
const direct=platform.capture({type:'spatial.aggregate',source:'spatial',entityType:'district',entityId:'social',payload:{activeCount:4,eventCount:12,windowMinutes:60,channel:'multiverse',privateText:'blocked'}});
assert.equal(direct.accepted,true);
assert.equal(ingested[0].payload.activeCount,4);
assert.equal(ingested[0].payload.eventCount,12);
assert.equal('privateText' in ingested[0].payload,false);
assert.equal('actorHash' in ingested[0].payload,false);

let clock=1_800_000;
const captured=[];
const telemetry={snapshot:()=>({
  windowMinutes:60,
  byDistrict:{central:0,commerce:3,social:5,creator:0,food:0,education:0,entertainment:0,business:0,services:0},
  byCity:{'vitrine-city':3,silvania:0,anapolis:5,goiania:0},
  byEvent:{render_sample:8},
  byFps:{poor:1,constrained:2,good:3,excellent:2}
})};
const presence={snapshot:()=>({districts:{central:1,commerce:0,social:2,creator:0,food:0,education:0,entertainment:0,business:0,services:0}})};
const bridge=createSpatialNeuralBridge({capture:event=>{captured.push(event);return{accepted:true};},telemetry,presence,now:()=>clock,intervalMs:60_000});
const result=bridge.pulse();
assert.equal(result.attempted,6);
assert.equal(result.accepted,6);
assert.equal(captured.filter(event=>event.entityType==='district').length,3);
assert.equal(captured.filter(event=>event.entityType==='city').length,2);
assert.equal(captured.find(event=>event.entityId==='social').payload.activeCount,2);
assert.equal(captured.find(event=>event.entityId==='commerce').payload.eventCount,3);
const anapolis=captured.find(event=>event.entityType==='city'&&event.entityId==='anapolis');
assert.equal(anapolis.payload.eventCount,5);
assert.equal(anapolis.payload.channel,'multiverse-city');
assert.match(anapolis.dedupeKey,/^spatial:\d+:city:anapolis$/);
const render=captured.find(event=>event.entityType==='runtime');
assert.equal(render.payload.renderSamples,8);
assert.equal(render.payload.fpsPoor,1);
assert.equal(render.source,'spatial');
assert.equal(render.type,'spatial.aggregate');
assert.match(render.dedupeKey,/^spatial:\d+:render$/);

assert.equal(bridge.status().running,false);
assert.equal(bridge.start(),true);
assert.equal(bridge.status().running,true);
assert.equal(bridge.start(),false);
assert.equal(bridge.stop(),true);
assert.equal(bridge.stop(),false);

console.log(JSON.stringify({ok:true,captured:captured.length,cities:captured.filter(event=>event.entityType==='city').length,policy:platform.policy.rawPersonalData}));
