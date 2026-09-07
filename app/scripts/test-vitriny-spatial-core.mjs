import assert from 'node:assert/strict';
import {
  VITRINY_SPATIAL_VERSION,createWorldRouter,parseSpatialPath,spatialPath,spatialRouteKey,
  chunkCoords,desiredChunkSet,diffChunks,createChunkEngine,assessDevice,adaptProfile,
  generateBuilding,generateBlock,centralPlazaLayout,centralPlazaPortals
} from '../vitriny-spatial/index.js';

assert.equal(VITRINY_SPATIAL_VERSION,1);
const route=parseSpatialPath('/v/BR/GO/anapolis/commerce/loja-x');
assert.deepEqual(route,{root:'v',country:'br',region:'go',city:'anapolis',district:'commerce',place:'loja-x',depth:5});
assert.equal(spatialPath(route),'/v/br/go/anapolis/commerce/loja-x');
assert.equal(spatialRouteKey(route),'br:go:anapolis:commerce:loja-x');

const router=createWorldRouter({defaultRoute:{country:'br',region:'go',city:'vitrine-city'}});
for(const portal of centralPlazaPortals())router.registerPortal(portal);
assert.equal(router.listPortals().length,8);
assert.equal(spatialPath(router.followPortal('portal-commerce','/v/br/go/vitrine-city')),'/v/br/go/vitrine-city/commerce');

assert.deepEqual(chunkCoords({x:0,z:0},{chunkSize:128}),{x:0,z:0,chunkSize:128});
assert.deepEqual(chunkCoords({x:-1,z:129},{chunkSize:128}),{x:-1,z:1,chunkSize:128});
const desired=desiredChunkSet({x:64,z:64},{worldKey:'br:go:vitrine-city',chunkSize:128,radius:1});
assert.equal(desired.ids.size,9);
const delta=diffChunks(new Set(['a','b']),new Set(['b','c']));
assert.deepEqual(delta.load,['c']);assert.deepEqual(delta.unload,['a']);assert.deepEqual(delta.keep,['b']);

const events=[];
const engine=createChunkEngine({chunkSize:128,radius:1,maxLoaded:20});
const first=await engine.update({position:{x:10,z:10},worldKey:'world',loadChunk:async id=>{events.push(['load',id]);return{id};},unloadChunk:async id=>events.push(['unload',id])});
assert.equal(first.loaded.length,9);
const second=await engine.update({position:{x:280,z:10},worldKey:'world',loadChunk:async id=>({id}),unloadChunk:async id=>events.push(['unload',id])});
assert.equal(second.loaded.length,9);assert.equal(second.unload.length>0,true);

assert.equal(assessDevice({deviceMemory:2,hardwareConcurrency:2,width:390,height:844,mobile:true}).recommended,'lite');
assert.equal(assessDevice({deviceMemory:8,hardwareConcurrency:8,width:1920,height:1080,webgpu:true}).recommended,'ultra');
assert.equal(adaptProfile('ultra',{fps:25}).id,'standard');
assert.equal(adaptProfile('lite',{fps:80}).id,'standard');

const a=generateBuilding({id:'store-1',kind:'retail',seed:'same'}),b=generateBuilding({id:'store-1',kind:'retail',seed:'same'});
assert.deepEqual(a,b);
const block=generateBlock({worldKey:'world',chunkX:2,chunkZ:-1,grid:3,seed:'city'});
assert.equal(block.buildings.length,9);
assert.equal(block.buildings.every(item=>Number.isFinite(item.position.x)&&Number.isFinite(item.size.height)),true);

const plaza=centralPlazaLayout();
assert.equal(plaza.districts.length,8);
assert.equal(new Set(plaza.districts.map(x=>x.id)).size,8);
assert.equal(plaza.center.id,'vitriny-neural-core');

console.log(JSON.stringify({ok:true,spatialVersion:VITRINY_SPATIAL_VERSION,portals:router.listPortals().length,chunks:first.loaded.length,profile:'adaptive',buildings:block.buildings.length}));
