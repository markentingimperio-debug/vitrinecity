import assert from 'node:assert/strict';
import {spatialChunkCoords,spatialChunkId,desiredSpatialChunks,diffSpatialChunks,parseSpatialChunkId,generateSpatialChunk,createSpatialClientRuntime} from '../public/vitriny-spatial-client-core.js';

assert.deepEqual(spatialChunkCoords({x:0,z:0},{chunkSize:128}),{x:0,z:0,chunkSize:128});
assert.deepEqual(spatialChunkCoords({x:-1,z:129},{chunkSize:128}),{x:-1,z:1,chunkSize:128});
assert.equal(spatialChunkId('br:go:vitrine-city',{x:-2,z:3}),'br:go:vitrine-city@-2,3');
assert.deepEqual(parseSpatialChunkId('br:go:vitrine-city@-2,3'),{worldKey:'br:go:vitrine-city',x:-2,z:3});
const desired=desiredSpatialChunks({x:5,z:5},{worldKey:'br:go:vitrine-city',chunkSize:128,radius:1});
assert.equal(desired.ids.size,9);
const diff=diffSpatialChunks(new Set(['a','b']),new Set(['b','c']));assert.deepEqual(diff,{load:['c'],unload:['a'],keep:['b']});
const a=generateSpatialChunk('br:go:vitrine-city@0,0',{chunkSize:128,grid:3,seed:'same'}),b=generateSpatialChunk('br:go:vitrine-city@0,0',{chunkSize:128,grid:3,seed:'same'});
assert.deepEqual(a,b);assert.equal(a.buildings.length,9);assert.equal(a.buildings.every(x=>Number.isFinite(x.size.height)&&x.size.height>0),true);
const unloaded=[];const runtime=createSpatialClientRuntime({worldKey:'br:go:vitrine-city',chunkSize:128,radius:0,maxLoaded:2,onUnload:id=>unloaded.push(id)});
let state=await runtime.update({x:1,z:1});assert.equal(state.loaded.length,1);assert.equal(state.center.x,0);
state=await runtime.update({x:130,z:1});assert.equal(state.loaded.length,1);assert.equal(state.center.x,1);assert.equal(unloaded.includes('br:go:vitrine-city@0,0'),true);
await runtime.clear();assert.equal(runtime.status().loaded.length,0);
console.log(JSON.stringify({ok:true,spatialClient:{deterministicBuildings:a.buildings.length,unloaded:unloaded.length}}));
