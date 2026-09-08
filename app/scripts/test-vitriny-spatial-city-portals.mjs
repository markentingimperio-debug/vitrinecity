import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createSpatialReturnState,SPATIAL_RETURN_KEY} from '../public/vitriny-spatial-session.js';
import {TRANSIT_CITY_IDS,normalizeTransitCity,layoutCityPortals,fetchCityPortals,cityTransitHref,saveCityCheckpoint,loadCityCheckpoint,spatialMovementBasis,intersectsTransitPlaza} from '../public/vitriny-spatial-city-portals.js';

const cities=TRANSIT_CITY_IDS.map(id=>({id,worldKey:`br:go:${id}`,country:'br',region:'go',status:id==='vitrine-city'?'active':'preview'}));
const now=Date.parse('2026-09-07T21:00:00Z');
function storage(){const map=new Map();return{map,getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};}
function state(id,x){return createSpatialReturnState({worldKey:`br:go:${id}`,spatialPath:`/v/br/go/${id}`,position:{x,y:1.7,z:96},yaw:Math.PI,pitch:0,createdAt:new Date(now).toISOString()});}

test('all five cities connect to exactly the other four with deterministic layout',()=>{
  assert.deepEqual(TRANSIT_CITY_IDS,['vitrine-city','silvania','anapolis','vianopolis','goiania']);
  for(const currentCityId of TRANSIT_CITY_IDS){
    const a=layoutCityPortals(cities,{currentCityId}),b=layoutCityPortals([...cities].reverse(),{currentCityId});
    assert.deepEqual(a,b);assert.equal(a.length,4);assert.ok(a.every(p=>p.id!==currentCityId));
    assert.equal(new Set(a.map(p=>p.position.x)).size,4);
    assert.ok(a.every(p=>p.href===cityTransitHref(p.id)));
  }
});
test('Vianopolis is a preview-only destination with canonical route',()=>{
  const portal=layoutCityPortals(cities,{currentCityId:'silvania'}).find(item=>item.id==='vianopolis');
  assert.ok(portal);assert.equal(portal.name,'Vianópolis');assert.equal(portal.status,'preview');
  assert.equal(portal.route,'/v/br/go/vianopolis');assert.equal(portal.href,'/vitriny-multiverse-explore.html?city=vianopolis&return=1');
  assert.match(portal.description,/sem comércio local ativo/);
});
test('unknown, prototype, traversal and cross-world destinations cannot create URLs',()=>{
  for(const invalid of ['constructor','__proto__','toString','/admin','//evil.example','anapolis&checkout=1','%2e%2e','br:go:anapolis',null,{}]){
    assert.throws(()=>cityTransitHref(invalid),/city_invalid/);
    assert.equal(normalizeTransitCity({...cities[1],id:invalid}),null);
  }
  assert.equal(normalizeTransitCity({...cities[1],worldKey:'br:go:goiania'}),null);
  assert.equal(normalizeTransitCity({...cities[1],country:'us'}),null);
  assert.equal(normalizeTransitCity({...cities[1],status:'admin'}),null);
  assert.throws(()=>layoutCityPortals(cities,{currentCityId:'unknown'}),/city_invalid/);
});
test('registry strips free text and external hrefs and deduplicates entries',()=>{
  const a=layoutCityPortals([cities[1],{...cities[1],name:'<script>bad</script>',href:'https://evil.example',route:'/admin'},cities[2]]);
  assert.equal(a.length,2);assert.equal(a[0].name,'Silvânia');assert.equal(a[0].route,'/v/br/go/silvania');
  assert.equal(a[0].href,'/vitriny-multiverse-explore.html?city=silvania&return=1');
});
test('city catalogue uses the existing read-only spatial API',async()=>{
  let calls=0;
  const result=await fetchCityPortals({currentCityId:'anapolis',fetchImpl:async(url,options)=>{
    calls++;assert.equal(url,'/api/spatial/v1/cities');assert.equal(options.method,undefined);assert.ok(options.signal);
    return new Response(JSON.stringify({apiVersion:1,items:cities}),{status:200});
  }});
  assert.equal(calls,1);assert.equal(result.source,'api');assert.equal(result.portals.length,4);
});
test('API failure and invalid JSON give safe offline previews without enabling commerce',async()=>{
  for(const fetchImpl of [async()=>{throw new Error('offline');},async()=>new Response('{}',{status:503}),async()=>new Response('invalid'),async()=>new Response(JSON.stringify({apiVersion:99,items:cities}))]){
    const result=await fetchCityPortals({fetchImpl});assert.equal(result.source,'fallback');
    assert.equal(result.portals.length,4);assert.ok(result.portals.every(p=>p.status==='preview'));
  }
});
test('catalogue timeout aborts its request and does not block fallback travel',async()=>{
  let aborted=false;
  const result=await fetchCityPortals({timeoutMs:100,fetchImpl:(_url,{signal})=>new Promise((_resolve,reject)=>{
    signal.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'));},{once:true});
  })});
  assert.equal(aborted,true);assert.equal(result.source,'fallback');assert.equal(result.portals.length,4);
});
test('A to B to A preserves distinct per-city checkpoints; legacy remains compatible',()=>{
  const s=storage(),options={storage:s,now};
  assert.equal(saveCityCheckpoint(state('anapolis',31),options),true);
  assert.equal(saveCityCheckpoint(state('vianopolis',48),options),true);
  assert.equal(saveCityCheckpoint(state('goiania',72),options),true);
  assert.equal(loadCityCheckpoint('anapolis',options).position.x,31);
  assert.equal(loadCityCheckpoint('vianopolis',options).position.x,48);
  assert.equal(loadCityCheckpoint('goiania',options).position.x,72);
  assert.equal(loadCityCheckpoint('silvania',options),null);
  s.setItem(SPATIAL_RETURN_KEY,JSON.stringify(state('silvania',9)));
  assert.equal(loadCityCheckpoint('silvania',options).position.x,9);
  assert.equal(loadCityCheckpoint('vitrine-city',options),null);
});
test('checkpoint storage is bounded to the city catalogue, excludes metadata and respects expiry',()=>{
  const s=storage();
  for(const id of TRANSIT_CITY_IDS)for(let n=0;n<5;n++)saveCityCheckpoint({...state(id,n),token:'not-stored',actorId:'not-stored',targetId:'not-stored'},{storage:s,now});
  assert.equal(s.map.size,5);assert.ok(![...s.map.values()].join('').includes('not-stored'));
  assert.equal(loadCityCheckpoint('anapolis',{storage:s,now:now+2*60*60*1000+1}),null);
  assert.equal(s.map.size,4);
});
test('corrupt, mismatched or unavailable storage never blocks travel',()=>{
  const s=storage(),options={storage:s,now};
  assert.equal(saveCityCheckpoint({...state('anapolis',1),worldKey:'br:go:silvania'},options),false);
  assert.equal(saveCityCheckpoint('broken',options),false);
  s.setItem('vitrinySpatialCheckpoint:v1:anapolis','{broken');assert.equal(loadCityCheckpoint('anapolis',options),null);
  s.setItem('vitrinySpatialCheckpoint:v1:anapolis',JSON.stringify(state('goiania',999)));assert.equal(loadCityCheckpoint('anapolis',options),null);
  const blocked={getItem(){throw new Error('blocked');},setItem(){throw new Error('full');}};
  assert.equal(saveCityCheckpoint(state('anapolis',1),{storage:blocked,now}),false);
  assert.equal(loadCityCheckpoint('anapolis',{storage:blocked,now}),null);
});
test('forward and strafe directions agree with camera look in every quadrant',()=>{
  for(const yaw of [0,Math.PI/2,Math.PI,Math.PI*1.5,-Math.PI/2]){
    const {forward:f,right:r}=spatialMovementBasis(yaw);
    assert.ok(Math.abs(Math.hypot(f.x,f.z)-1)<1e-12);assert.ok(Math.abs(f.x*r.x+f.z*r.z)<1e-12);
    assert.ok(Math.abs(f.x- Math.sin(-yaw))<1e-12);assert.ok(Math.abs(f.z-Math.cos(-yaw))<1e-12);
  }
  assert.ok(spatialMovementBasis(Math.PI).forward.z<0);assert.ok(spatialMovementBasis(Math.PI).right.x>0);
});
test('procedural buildings cannot block the plaza, transit portals or their approach',()=>{
  const b=(x,z,w=12,d=12)=>({position:{x,z},size:{width:w,depth:d}});
  assert.equal(intersectsTransitPlaza(b(0,0)),true);assert.equal(intersectsTransitPlaza(b(26,96)),true);
  assert.equal(intersectsTransitPlaza(b(0,118)),true);assert.equal(intersectsTransitPlaza(b(70,0)),true);
  assert.equal(intersectsTransitPlaza(b(200,200)),false);assert.equal(intersectsTransitPlaza({}),true);
});
test('explorer wiring, mobile fallback and JS syntax stay in the release gate',()=>{
  const url=new URL('../public/vitriny-multiverse-explore.js',import.meta.url),js=readFileSync(url,'utf8');
  const html=readFileSync(new URL('../public/vitriny-multiverse-explore.html',import.meta.url),'utf8');
  for(const text of ['fetchCityPortals','loadCityCheckpoint(cityId)','saveCityCheckpoint(state)','spatialMovementBasis(yaw)','intersectsTransitPlaza(building)','if(!isActiveCity)','if(activePortal.userData.cityPortal)return travelToCity'])assert.ok(js.includes(text),text);
  assert.ok(js.includes("cityId==='vitrine-city'&&cityContext.status==='active'"));
  assert.ok(js.includes('sharedMaterials.has(material)'));assert.ok(js.includes('if(disposed)return;'));
  for(const id of ['cityLinks','cityStatus','travelStatus','worldGateLink','loadingText'])assert.ok(html.includes(`id="${id}"`));
  assert.ok(html.includes('aria-label="Avançar"'));
  assert.ok(html.includes('href="/?inicio=1"'),'Fallback opens the lightweight home even when direct city entry was selected');
  assert.ok(html.includes('id="loadingGuide"'),'The guide is available while the 3D city loads');
  assert.ok(html.includes('id="cityGuide"'));
  assert.match(html,/<script[^>]+src="\/vitriny-city-guide\.js(?:\?[^"]*)?"/,'The destination guide loads independently of the 3D explorer');
  execFileSync(process.execPath,['--check',fileURLToPath(url)]);
});
