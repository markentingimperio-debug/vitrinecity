import assert from 'node:assert/strict';
import {adaptSpatialApiChunk,createSpatialApiChunkLoader,fetchSpatialCityContext,normalizeSpatialCityId,spatialCityFromLocation,spatialExplorerHref,spatialFallbackCity} from '../public/vitriny-spatial-api-client.js';

assert.equal(normalizeSpatialCityId('ANAPOLIS'),'anapolis');
assert.equal(normalizeSpatialCityId('../admin'),'vitrine-city');
assert.equal(spatialCityFromLocation({search:'?city=goiania'}),'goiania');
assert.equal(spatialExplorerHref('silvania'),'/vitriny-multiverse-explore.html?city=silvania');
assert.equal(spatialExplorerHref('anapolis',{returnState:true}),'/vitriny-multiverse-explore.html?city=anapolis&return=1');
assert.equal(spatialFallbackCity('goiania').worldKey,'br:go:goiania');

const city=await fetchSpatialCityContext({cityId:'anapolis',fetchImpl:async url=>{
  assert.equal(url,'/api/spatial/v1/cities/anapolis');
  return new Response(JSON.stringify({apiVersion:1,city:{id:'anapolis',worldKey:'br:go:anapolis',name:'Anápolis',status:'preview',chunkSize:128,route:'/v/br/go/anapolis'}}),{status:200,headers:{'content-type':'application/json'}});
}});
assert.equal(city.name,'Anápolis');
assert.equal(city.status,'preview');

const raw={apiVersion:1,city:{id:'anapolis',worldKey:'br:go:anapolis'},chunk:{x:2,z:-3,size:128},buildings:[{id:'b1',kind:'office',position:{x:300,z:-320},size:{width:20,depth:18,height:32},windowDensity:.75}]};
const adapted=adaptSpatialApiChunk(raw,{cityId:'anapolis',requestedId:'br:go:anapolis@2,-3'});
assert.equal(adapted.id,'br:go:anapolis@2,-3');
assert.equal(adapted.source,'spatial-api-v1');
assert.equal(adapted.buildings.length,1);
assert.equal(adapted.buildings[0].detail,.75);
await assert.rejects(async()=>adaptSpatialApiChunk(raw,{cityId:'goiania',requestedId:'br:go:goiania@2,-3'}),/spatial_chunk_invalid/);

const sources=[];
const loader=createSpatialApiChunkLoader({cityId:'silvania',fallback:false,onSource:source=>sources.push(source),fetchImpl:async url=>{
  assert.equal(url,'/api/spatial/v1/cities/silvania/chunks/0/1');
  return new Response(JSON.stringify({apiVersion:1,city:{id:'silvania',worldKey:'br:go:silvania'},chunk:{x:0,z:1,size:128},buildings:[]}),{status:200,headers:{'content-type':'application/json'}});
}});
const chunk=await loader('br:go:silvania@0,1');
assert.equal(chunk.worldKey,'br:go:silvania');
assert.deepEqual(sources,['api']);
await assert.rejects(()=>loader('br:go:goiania@0,1'),/spatial_chunk_world_mismatch/);

const fallbackSources=[];
const fallbackLoader=createSpatialApiChunkLoader({cityId:'goiania',onSource:source=>fallbackSources.push(source),fetchImpl:async()=>{throw new Error('offline');}});
const fallbackChunk=await fallbackLoader('br:go:goiania@0,0');
assert.equal(fallbackChunk.source,'local-fallback');
assert.equal(fallbackChunk.worldKey,'br:go:goiania');
assert.deepEqual(fallbackSources,['fallback']);

console.log(JSON.stringify({ok:true,city:city.id,chunk:adapted.id,fallback:fallbackChunk.source}));
