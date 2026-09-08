import assert from 'node:assert/strict';
import {adaptSpatialApiChunk,createSpatialApiChunkLoader,fetchSpatialCities,fetchSpatialCityContext,normalizeSpatialCityId,spatialCityFromLocation,spatialExplorerHref,spatialFallbackCities,spatialFallbackCity} from '../public/vitriny-spatial-api-client.js';
import {isKnownSpatialContextCity,spatialContextCityFromLocation,spatialEcosystemDestination,spatialEcosystemDestinations,withSpatialCityContext} from '../public/vitriny-spatial-city-context.js';

assert.equal(normalizeSpatialCityId('ANAPOLIS'),'anapolis');
assert.equal(normalizeSpatialCityId('../admin'),'vitrine-city');
assert.equal(spatialCityFromLocation({search:'?city=goiania'}),'goiania');
assert.equal(spatialCityFromLocation({search:'?city=vianopolis'}),'vianopolis');
assert.equal(spatialExplorerHref('silvania'),'/vitriny-multiverse-explore.html?city=silvania');
assert.equal(spatialExplorerHref('vianopolis',{returnState:true}),'/vitriny-multiverse-explore.html?city=vianopolis&return=1');
assert.equal(spatialFallbackCity('goiania').worldKey,'br:go:goiania');
assert.equal(spatialFallbackCity('vianopolis').name,'Vianópolis');
assert.equal(spatialFallbackCities().length,5);

assert.equal(isKnownSpatialContextCity('vianopolis'),true);
assert.equal(isKnownSpatialContextCity('nao-existe'),false);
assert.equal(spatialContextCityFromLocation({search:'?cidade=vianopolis'}),'vianopolis');
assert.equal(spatialContextCityFromLocation({search:'?city=goiania'}),'goiania');
assert.equal(spatialContextCityFromLocation({search:'?cidade=nao-existe'}),'vitrine-city');
assert.equal(withSpatialCityContext('/social.html?tab=local#top','anapolis'),'/social.html?tab=local&cidade=anapolis#top');
assert.equal(withSpatialCityContext('/mapa-real.html','vianopolis'),'/mapa-real.html?cidade=vianopolis');
assert.equal(withSpatialCityContext('https://example.com','anapolis'),null);
assert.equal(withSpatialCityContext('/checkout/order','anapolis'),null);
assert.equal(withSpatialCityContext('/social.html','nao-existe'),null);
const previewDestinations=spatialEcosystemDestinations({cityId:'vianopolis',cityStatus:'active'});
assert.equal(previewDestinations.length,4);
assert.equal(previewDestinations.find(item=>item.id==='social').enabled,true);
assert.equal(previewDestinations.find(item=>item.id==='map').enabled,true);
assert.equal(previewDestinations.find(item=>item.id==='marketplace').enabled,false);
assert.equal(previewDestinations.find(item=>item.id==='deliveries').enabled,false);
assert.equal(previewDestinations.find(item=>item.id==='marketplace').href,'/loja.html?cidade=vianopolis');
assert.equal(spatialEcosystemDestination('marketplace',{cityId:'vitrine-city',cityStatus:'active'}).enabled,true);
assert.equal(spatialEcosystemDestination('missing',{cityId:'vitrine-city'}),null);

const listed=await fetchSpatialCities({fetchImpl:async url=>{
  assert.equal(url,'/api/spatial/v1/cities?country=br&region=go');
  return new Response(JSON.stringify({apiVersion:1,items:[
    {id:'vitrine-city',worldKey:'br:go:vitrine-city',name:'Vitrine City',status:'active',chunkSize:128,route:'/v/br/go/vitrine-city'},
    {id:'anapolis',worldKey:'br:go:anapolis',name:'Anápolis',status:'preview',chunkSize:128,route:'/v/br/go/anapolis'},
    {id:'vianopolis',worldKey:'br:go:vianopolis',name:'Vianópolis',status:'preview',chunkSize:128,route:'/v/br/go/vianopolis'},
    {id:'../admin',worldKey:'br:go:../admin',name:'Inválida'}
  ]}),{status:200,headers:{'content-type':'application/json'}});
}});
assert.equal(listed.length,3);
assert.equal(listed[0].status,'active');
assert.equal(listed[1].id,'anapolis');
assert.equal(listed[2].id,'vianopolis');

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
const fallbackLoader=createSpatialApiChunkLoader({cityId:'vianopolis',onSource:source=>fallbackSources.push(source),fetchImpl:async()=>{throw new Error('offline');}});
const fallbackChunk=await fallbackLoader('br:go:vianopolis@0,0');
assert.equal(fallbackChunk.source,'local-fallback');
assert.equal(fallbackChunk.worldKey,'br:go:vianopolis');
assert.deepEqual(fallbackSources,['fallback']);

console.log(JSON.stringify({ok:true,city:city.id,cities:listed.length,chunk:adapted.id,fallback:fallbackChunk.source,vianopolis:true,cityContext:true}));
