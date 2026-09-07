import assert from 'node:assert/strict';
import {createSpatialTelemetryTracker,normalizeSpatialTelemetryEvent,SPATIAL_TELEMETRY_EVENTS} from '../spatial-telemetry.js';

let clock=1_000_000;
const tracker=createSpatialTelemetryTracker({now:()=>clock,bucketMs:60_000,retentionBuckets:3});

assert.equal(SPATIAL_TELEMETRY_EVENTS.includes('render_sample'),true);
assert.deepEqual(normalizeSpatialTelemetryEvent({event:'district_enter',district:'SOCIAL',profile:'lite',fpsBucket:'GOOD',targetType:'district'}),{
  event:'district_enter',district:'social',profile:'LITE',fpsBucket:'good',targetType:'district'
});
assert.equal(normalizeSpatialTelemetryEvent({event:'secret_event',district:'social'}),null);
assert.equal(normalizeSpatialTelemetryEvent({event:'district_enter',district:'admin'}),null);

tracker.record({event:'district_enter',district:'social',profile:'STANDARD',targetType:'district'});
tracker.record({event:'entity_open',district:'social',profile:'STANDARD',targetType:'profile'});
tracker.record({event:'render_sample',district:'social',profile:'STANDARD',fpsBucket:'good'});
let state=tracker.snapshot();
assert.equal(state.total,3);
assert.equal(state.byDistrict.social,3);
assert.equal(state.byEvent.entity_open,1);
assert.equal(state.byProfile.STANDARD,3);
assert.equal(state.byFps.good,1);
assert.equal(state.byTarget.profile,1);

clock+=61_000;
tracker.record({event:'district_enter',district:'commerce',profile:'LITE',targetType:'district'});
assert.equal(tracker.bucketCount(),2);
clock+=121_000;
state=tracker.snapshot();
assert.equal(state.total,1);
assert.equal(state.byDistrict.commerce,1);
assert.equal(tracker.bucketCount(),1);
assert.throws(()=>tracker.record({event:'entity_open',district:'admin'}),/telemetry_invalid/);

console.log(JSON.stringify({ok:true,total:state.total,windowMinutes:state.windowMinutes}));
