import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {fetchSpatialNavigationContext,normalizeSpatialNavigationContext,spatialEcosystemDestinations,withSpatialCityContext} from '../public/vitriny-spatial-city-context.js';

const appRoot=fileURLToPath(new URL('..',import.meta.url));
const html=readFileSync(`${appRoot}/public/vitriny-multiverse-explore.html`,'utf8');
const runtime=readFileSync(`${appRoot}/public/vitriny-spatial-city-context-runtime.js`,'utf8');

assert.match(html,/id="ecosystemLinks"/);
assert.match(html,/id="ecosystemContextStatus"/);
assert.match(html,/src="\/vitriny-spatial-city-context-runtime\.js"/);
assert.match(runtime,/spatialEcosystemDestinations/);
assert.match(runtime,/fetchSpatialNavigationContext/);
assert.match(runtime,/local-fallback/);
assert.equal(withSpatialCityContext('/social.html','anapolis'),'/social.html?cidade=anapolis');

const preview=spatialEcosystemDestinations({cityId:'anapolis',cityStatus:'active'});
assert.deepEqual(preview.filter(item=>item.enabled).map(item=>item.id),['social','map']);
assert.deepEqual(preview.filter(item=>!item.enabled).map(item=>item.id),['marketplace','deliveries']);
const active=spatialEcosystemDestinations({cityId:'vitrine-city',cityStatus:'active'});
assert.equal(active.every(item=>item.enabled),true);

const normalized=normalizeSpatialNavigationContext({apiVersion:1,contextMode:'navigation-only',city:{id:'vianopolis',name:'Vianópolis',status:'active'}},{cityId:'vianopolis'});
assert.equal(normalized.source,'spatial-api-v1');
assert.deepEqual(normalized.modules.filter(item=>item.enabled).map(item=>item.id),['social','map']);
assert.deepEqual(normalized.modules.filter(item=>!item.enabled).map(item=>item.id),['marketplace','deliveries']);
assert.throws(()=>normalizeSpatialNavigationContext({apiVersion:1,contextMode:'navigation-only',city:{id:'goiania'}},{cityId:'vianopolis'}),/spatial_context_invalid/);

let requested='';
const fetched=await fetchSpatialNavigationContext({cityId:'vianopolis',fetchImpl:async(url,options)=>{
  requested=url;assert.equal(options.cache,'no-store');assert.ok(options.signal);
  return new Response(JSON.stringify({apiVersion:1,contextMode:'navigation-only',city:{id:'vianopolis',name:'Vianópolis',status:'preview'},modules:[]}),{status:200,headers:{'content-type':'application/json'}});
}});
assert.equal(requested,'/api/spatial/v1/context?city=vianopolis');
assert.equal(fetched.city.id,'vianopolis');
assert.deepEqual(fetched.modules.filter(item=>item.enabled).map(item=>item.id),['social','map']);
await assert.rejects(()=>fetchSpatialNavigationContext({cityId:'missing',fetchImpl:async()=>new Response('{}')}),/spatial_context_city_invalid/);
await assert.rejects(()=>fetchSpatialNavigationContext({cityId:'vianopolis',fetchImpl:async()=>new Response('{}',{status:503})}),/spatial_context_503/);

console.log(JSON.stringify({ok:true,canonicalContext:true,previewEnabled:preview.filter(item=>item.enabled).map(item=>item.id),activeEnabled:active.map(item=>item.id)}));
