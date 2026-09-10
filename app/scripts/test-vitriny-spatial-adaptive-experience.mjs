import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {combineSpatialLodFactors,createSpatialDistanceLodController,createSpatialLodController,premiumSpatialSlotState,resolveSpatialDayPhase,spatialLodFactors} from '../public/vitriny-spatial-adaptive-experience.js';

assert.equal(resolveSpatialDayPhase(6).id,'dawn');
assert.equal(resolveSpatialDayPhase(12).id,'day');
assert.equal(resolveSpatialDayPhase(18).id,'dusk');
assert.equal(resolveSpatialDayPhase(23).id,'night');
assert.equal(resolveSpatialDayPhase(-1).id,'night');
assert.equal(spatialLodFactors(99).furniture,0);

const lod=createSpatialLodController({profile:'STANDARD',stableSamples:2});
assert.equal(lod.level,0);
assert.equal(lod.sample(20).changed,false);
assert.equal(lod.sample(20).changed,true);
assert.equal(lod.level,1);
lod.sample(20);lod.sample(20);assert.equal(lod.level,2);
lod.sample(60);lod.sample(60);assert.equal(lod.level,1);
lod.sample(60);lod.sample(60);assert.equal(lod.level,0);

const distance=createSpatialDistanceLodController({profile:'STANDARD'});
assert.equal(distance.tier,0);
assert.equal(distance.sample(200).tier,1);
assert.equal(distance.sample(175).tier,1); // hysteresis: do not flap near threshold
assert.equal(distance.sample(120).tier,0);
assert.equal(distance.sample(420).tier,1); // one tier per sample keeps transitions gradual
assert.equal(distance.sample(420).tier,2);
assert.equal(distance.sample(760).tier,3);
assert.equal(distance.sample(650).tier,3);
assert.equal(distance.sample(580).tier,2);
assert.equal(distance.factors.furniture,0);

const combined=combineSpatialLodFactors(
  {skyline:.82,vegetation:.68,lights:.72,furniture:.55,districtFurniture:.7,premium:.7},
  {skyline:1,vegetation:.74,lights:.78,furniture:.5,districtFurniture:.62,premium:.7}
);
assert.deepEqual(combined,{skyline:.82,vegetation:.68,lights:.72,furniture:.5,districtFurniture:.62,premium:.7});
assert.equal(Object.isFrozen(combined),true);

assert.deepEqual(premiumSpatialSlotState({slotId:'premium:vitrine-city:1',districtId:'commerce',status:'available',sponsor:'x'}),{slotId:'premium:vitrine-city:1',districtId:'commerce',status:'available',sponsor:''});
assert.equal(premiumSpatialSlotState({slotId:'',districtId:'commerce'}),null);

console.log(JSON.stringify({ok:true,phase:resolveSpatialDayPhase(18).id,lod:lod.level,distanceTier:distance.tier}));

// Mount the actual environment renderer with real Three objects. Empty skyline
// data avoids canvas drawing; the light fixture still exercises dusk presentation.
const threeUrl=import.meta.resolve('three');
async function browserModuleUrl(name){
  let source=await readFile(new URL('../public/'+name,import.meta.url),'utf8');
  source=source.replaceAll("'/vendor/three/three.module.js'",JSON.stringify(threeUrl));
  for(const dependency of ['vitriny-architectural-geometry.js','vitriny-spatial-premium-atmosphere.js']){
    if(source.includes(`'./${dependency}'`))source=source.replaceAll(`'./${dependency}'`,JSON.stringify(await browserModuleUrl(dependency)));
  }
  source=source.replace(/from (['"])(\.\/[^'"]+)\1/g,(_match,_quote,path)=>`from ${JSON.stringify(new URL('../public/'+path,import.meta.url).href)}`);
  return 'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
}
const {mountSpatialCityEnvironment}=await import(await browserModuleUrl('vitriny-spatial-environment-renderer.js'));
const globalKeys=['Date','document','requestAnimationFrame','cancelAnimationFrame','setInterval','clearInterval'];
const originals=new Map(globalKeys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
const OriginalDate=Date,intervals=new Map(),frames=new Set();let currentHour=12,nextHandle=1;
globalThis.Date=class extends OriginalDate{getHours(){return currentHour;}};
globalThis.document={hidden:false};
globalThis.requestAnimationFrame=()=>{const handle=nextHandle++;frames.add(handle);return handle;};
globalThis.cancelAnimationFrame=handle=>frames.delete(handle);
globalThis.setInterval=callback=>{const handle=nextHandle++;intervals.set(handle,callback);return handle;};
globalThis.clearInterval=handle=>intervals.delete(handle);
const fetchImpl=async()=>new Response(JSON.stringify({apiVersion:1,environment:{
  cityId:'vitrine-city',worldKey:'br:go:vitrine-city',profileId:'STANDARD',
  skyline:[],vegetation:[],furniture:[],lights:[{id:'fixture',position:{x:20,y:0,z:20},height:5,intensity:1}]
}}),{status:200,headers:{'content-type':'application/json'}});
function lightingScene(){
  const scene=new THREE.Scene(),hemi=new THREE.HemisphereLight('#abcdff','#adbcde',.3),sun=new THREE.DirectionalLight('#ffd399',4);
  scene.add(hemi,sun);scene.fog=new THREE.FogExp2('#abcdef',.0005);return {scene,hemi,sun};
}
try{
  for(const hour of [6,12,18,23]){
    currentHour=hour;const {scene,hemi,sun}=lightingScene();
    const mounted=await mountSpatialCityEnvironment({scene,cityId:'vitrine-city',fixedArchitecturalLighting:true,fetchImpl});
    assert.equal(mounted.phase,'dusk');assert.equal(intervals.size,0,'A fixed sunset must not schedule clock-based lighting changes');
    assert.deepEqual([hemi.intensity,sun.intensity,scene.fog.density],[.3,4,.0005]);
    const bulbs=mounted.group.getObjectByName('urban-light-bulbs');
    assert.equal(bulbs.material.opacity,.45+.5*resolveSpatialDayPhase(18).emissive);
    // The architectural owner may finish loading its HDR after this mount.
    hemi.intensity=.27;sun.intensity=2.1;scene.fog.density=.0002;currentHour=(hour+11)%24;
    mounted.dispose();
    assert.deepEqual([hemi.intensity,sun.intensity,scene.fog.density],[.27,2.1,.0002],'Disposal must not overwrite lighting owned by the architectural controller');
    assert.equal(mounted.group.parent,null);assert.equal(frames.size,0);
  }
  currentHour=12;const {scene,hemi,sun}=lightingScene();
  const adaptive=await mountSpatialCityEnvironment({scene,cityId:'vitrine-city',fetchImpl});
  assert.equal(adaptive.phase,'day');assert.equal(intervals.size,1);
  for(const hour of [23,18,6,12]){
    currentHour=hour;for(const callback of intervals.values())callback();
    const phase=resolveSpatialDayPhase(hour);assert.equal(adaptive.phase,phase.id);
    assert.deepEqual([hemi.intensity,sun.intensity,scene.fog.density],[.3*phase.ambient,4*phase.sun,.0005*phase.fog]);
  }
  adaptive.dispose();assert.deepEqual([hemi.intensity,sun.intensity,scene.fog.density],[.3,4,.0005]);
  assert.equal(intervals.size,0);assert.equal(frames.size,0);
  console.log(JSON.stringify({ok:true,fixedArchitecturalLighting:true,fixedHours:4,adaptiveClock:true,lightingOwnership:true}));
}finally{
  for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
}
