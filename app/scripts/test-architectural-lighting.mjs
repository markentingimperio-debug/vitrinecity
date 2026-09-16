import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';

// Exercise real Three scene objects and the production lifecycle. Only asynchronous
// image decoding and GPU PMREM allocation are substituted, so no browser is needed.
let activeFixture;
const fakeThree={...THREE,
  TextureLoader:class{loadAsync(url){return activeFixture.load('photo',url);}},
  PMREMGenerator:class{
    constructor(){this.fixture=activeFixture;this.fixture.generators++;}
    fromEquirectangular(){
      if(this.fixture.mode==='pmrem-failure')throw new Error('Simulated GPU allocation failure');
      const fixture=this.fixture;
      fixture.target={texture:new THREE.Texture(),dispose(){fixture.targetDisposals++;}};
      return fixture.target;
    }
    dispose(){this.fixture.generatorDisposals++;}
  }
};
const injectionKey=Symbol.for('vitrinecity.architectural-lighting.test-adapters');
globalThis[injectionKey]={THREE:fakeThree,HDRLoader:class{loadAsync(url){return activeFixture.load('hdr',url);}}};
let source=await readFile(new URL('../public/vitriny-architectural-lighting.js',import.meta.url),'utf8');
source=source.replace(/^import \* as THREE[^\n]+/m,"const THREE=globalThis[Symbol.for('vitrinecity.architectural-lighting.test-adapters')].THREE;")
  .replace(/^import \{HDRLoader\}[^\n]+/m,"const HDRLoader=globalThis[Symbol.for('vitrinecity.architectural-lighting.test-adapters')].HDRLoader;")
  .replace("'./vitriny-spatial-adaptive-experience.js'",JSON.stringify(new URL('../public/vitriny-spatial-adaptive-experience.js',import.meta.url).href));
const {configureArchitecturalLighting,architecturalDaylight}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
delete globalThis[injectionKey];

function fixture(mode){
  const scene=new THREE.Scene(),previousEnvironment=new THREE.Texture(),previousBackground=new THREE.Color('#bada55');
  scene.environment=previousEnvironment;scene.background=previousBackground;
  scene.fog=new THREE.FogExp2('#abcdef',.001);
  scene.environmentRotation.set(.1,.2,.3);scene.backgroundRotation.set(.3,.2,.1);
  scene.backgroundIntensity=.9;scene.environmentIntensity=.6;scene.backgroundBlurriness=.02;
  scene.userData.architecturalLighting='original-lighting';
  const hemisphere=new THREE.HemisphereLight('#abcdff','#adbcde',1.7);
  const ambient=new THREE.AmbientLight('#eeeeee',.2),sun=new THREE.DirectionalLight('#ffffff',3);
  sun.position.set(1,2,3);sun.target.position.set(4,5,6);
  sun.shadow.normalBias=.12;sun.shadow.bias=-.0003;sun.shadow.radius=1.5;
  sun.shadow.camera.far=680;sun.shadow.camera.updateProjectionMatrix();
  const horizon=new THREE.Group();horizon.name='orbital-horizon';scene.add(hemisphere,ambient,sun,horizon);
  const renderer={toneMapping:THREE.NeutralToneMapping,toneMappingExposure:1.2};
  const state={mode,scene,renderer,sun,horizon,previousEnvironment,previousBackground,
    generators:0,generatorDisposals:0,targetDisposals:0,previousEnvironmentDisposals:0,
    hdr:new THREE.Texture(),photo:new THREE.Texture(),disposals:{hdr:0,photo:0},pending:[],requests:[],
    load(kind,url){
      this.requests.push({kind,url});
      if(mode==='dispose-before-load')return new Promise(resolve=>this.pending.push(()=>resolve(this[kind])));
      if(mode===`${kind}-failure`)return Promise.reject(new Error(`Simulated ${kind} loading failure`));
      return Promise.resolve(this[kind]);
    },
    snapshot(){return {
      toneMapping:renderer.toneMapping,exposure:renderer.toneMappingExposure,
      environmentIntensity:scene.environmentIntensity,backgroundIntensity:scene.backgroundIntensity,
      backgroundBlurriness:scene.backgroundBlurriness,fogColor:scene.fog.color.toArray(),fogDensity:scene.fog.density,
      backgroundRotation:scene.backgroundRotation.toArray(),environmentRotation:scene.environmentRotation.toArray(),
      lighting:scene.userData.architecturalLighting,horizonVisible:horizon.visible,
      hemisphere:[hemisphere.intensity,...hemisphere.color.toArray(),...hemisphere.groundColor.toArray()],
      ambient:[ambient.intensity,...ambient.color.toArray()],
      sun:[sun.intensity,...sun.color.toArray(),...sun.position.toArray(),...sun.target.position.toArray()],
      shadow:[sun.shadow.normalBias,sun.shadow.bias,sun.shadow.radius,sun.shadow.camera.far,...sun.shadow.camera.projectionMatrix.elements]
    };}
  };
  state.hdr.addEventListener('dispose',()=>state.disposals.hdr++);
  state.photo.addEventListener('dispose',()=>state.disposals.photo++);
  previousEnvironment.addEventListener('dispose',()=>state.previousEnvironmentDisposals++);
  state.original=state.snapshot();return state;
}

const scenarios=[
  ['success','photographic lighting restores the prior scene and releases its own resources once'],
  ['photo-failure','a failed sky photograph keeps the clock-driven sky and HDR reflections'],
  ['hdr-failure','an HDR loading failure preserves the previous environment and lighting'],
  ['pmrem-failure','a GPU environment failure releases decoded textures and restores prior settings'],
  ['dispose-before-load','late image responses after teardown cannot attach a sky or allocate GPU resources']
];

for(const [mode,title] of scenarios)test(title,async()=>{
  for(const profileId of ['STANDARD','LITE']){
    const state=fixture(mode);activeFixture=state;
    const lighting=configureArchitecturalLighting({renderer:state.renderer,scene:state.scene,sun:state.sun,profile:{id:profileId}});
    assert.equal(state.requests.find(request=>request.kind==='photo').url.endsWith(profileId==='LITE'?'2k.webp':'4k.webp'),true);
    assert.equal(state.scene.environment,state.previousEnvironment,'The current environment must stay until the new one is ready');
    if(mode==='dispose-before-load'){
      lighting.dispose();
      assert.deepEqual(state.snapshot(),state.original,'Early teardown restores state immediately');
      state.pending.reverse().forEach(resolve=>resolve());
    }
    const ready=await lighting.ready;
    const successful=mode==='success'||mode==='photo-failure';assert.equal(ready,successful);
    let geometryDisposals=0,materialDisposals=0;
    if(mode==='success'){
      const sky=state.scene.getObjectByName('architectural-photographic-sky');assert.ok(sky);
      sky.geometry.addEventListener('dispose',()=>geometryDisposals++);
      sky.material.addEventListener('dispose',()=>materialDisposals++);
      assert.equal(state.horizon.visible,false);assert.equal(state.scene.environment,state.target.texture);
      assert.equal(state.scene.background,state.previousBackground,'The photograph must be sampled directly rather than creating an additional large background cube');
    }
    if(mode==='photo-failure'){
      assert.equal(state.scene.background,state.previousBackground);assert.equal(state.scene.environment,state.target.texture);
      assert.equal(state.scene.getObjectByName('architectural-photographic-sky').material.uniforms.photoMix.value,0);
    }
    if(!successful)assert.deepEqual(state.snapshot(),state.original,'Failure must restore settings before callers invoke dispose');
    lighting.dispose();lighting.dispose();
    assert.deepEqual(state.snapshot(),state.original);
    assert.equal(state.scene.environment,state.previousEnvironment);assert.equal(state.scene.background,state.previousBackground);
    assert.equal(state.scene.getObjectByName('architectural-photographic-sky'),undefined);
    assert.equal(state.disposals.hdr,mode==='hdr-failure'?0:1);assert.equal(state.disposals.photo,mode==='photo-failure'?0:1);
    assert.equal(state.targetDisposals,successful?1:0);assert.equal(state.generators,state.generatorDisposals);
    assert.equal(state.previousEnvironmentDisposals,0,'The borrowed fallback environment belongs to its original owner');
    assert.equal(geometryDisposals,mode==='success'?1:0);assert.equal(materialDisposals,mode==='success'?1:0);
    if(mode==='dispose-before-load')assert.equal(state.generators,0);
  }
});

test('the same Brasilia clock drives daytime, sunset and readable night without reload',async()=>{
  const state=fixture('success');activeFixture=state;
  let date=new Date('2026-09-13T13:54:00Z'),callback,cleared=false;
  const originalInterval=globalThis.setInterval,originalClear=globalThis.clearInterval;
  globalThis.setInterval=fn=>{callback=fn;return 17;};globalThis.clearInterval=id=>{assert.equal(id,17);cleared=true;};
  try{
    const lighting=configureArchitecturalLighting({scene:state.scene,renderer:state.renderer,sun:state.sun,now:()=>date});
    assert.equal(await lighting.ready,true);
    const sky=state.scene.getObjectByName('architectural-photographic-sky');
    assert.equal(state.scene.userData.dayPhase,'day');assert.equal(sky.material.uniforms.photoMix.value,0);
    const dayIntensity=state.scene.children.find(light=>light.isHemisphereLight).intensity;
    assert.ok(dayIntensity>=1.3&&dayIntensity<=1.45);assert.ok(state.renderer.toneMappingExposure>=.94&&state.renderer.toneMappingExposure<1);
    date=new Date('2026-09-13T21:00:00Z');callback();
    assert.equal(state.scene.userData.dayPhase,'dusk');assert.equal(sky.material.uniforms.photoMix.value,1);
    date=new Date('2026-09-14T01:00:00Z');callback();
    assert.equal(state.scene.userData.dayPhase,'night');assert.equal(sky.material.uniforms.photoMix.value,0);
    assert.ok(state.scene.children.find(light=>light.isHemisphereLight).intensity>=.7);
    assert.ok(state.sun.intensity<.4);assert.ok(state.scene.environmentIntensity<.3);
    lighting.dispose();assert.equal(cleared,true);assert.deepEqual(state.snapshot(),state.original);
  }finally{globalThis.setInterval=originalInterval;globalThis.clearInterval=originalClear;}
});

test('day transitions are continuous, including the midnight wrap',()=>{
  for(const hour of [0,5,6,7,16,18,19,24]){
    const before=architecturalDaylight(hour-.0001),after=architecturalDaylight(hour+.0001);
    for(const key of ['exposure','hemi','sun','environment','photo'])assert.ok(Math.abs(before[key]-after[key])<.001,`${hour}: ${key}`);
    for(const key of ['sky','horizon','fog','ground','sunColor'])for(const channel of ['r','g','b'])assert.ok(Math.abs(before[key][channel]-after[key][channel])<.001,`${hour}: ${key}.${channel}`);
  }
});

test('soft daylight reduces highlight energy without making daytime into night',()=>{
  // Compare versioned presets, not rendered-pixel luminance: ACES, materials and
  // camera direction also affect appearance and require a separate visual check.
  const before={exposure:1.02,hemi:1.55,sun:2.65,environment:.78,horizon:'#c8e5f3',fog:'#bdd5e0'};
  const luminance=color=>.2126*color.r+.7152*color.g+.0722*color.b;
  for(const hour of [7,9,12,15,16]){
    const day=architecturalDaylight(hour);
    assert.equal(day.daylight,1);assert.equal(day.photo,0);
    const directRatio=day.exposure*day.sun/(before.exposure*before.sun);
    const reflectedRatio=day.exposure*day.environment/(before.exposure*before.environment);
    assert.ok(directRatio>=.68&&directRatio<=.72,'direct light remains useful with about 31% less exposure-weighted energy');
    assert.ok(reflectedRatio>=.72&&reflectedRatio<=.78,'reflections are softened rather than disabled');
    assert.ok(day.hemi>=1.3&&day.hemi>=architecturalDaylight(0).hemi*1.6,'preserve broad daytime fill, including shadowless LITE');
    for(const key of ['horizon','fog'])assert.ok(luminance(day[key])<luminance(new THREE.Color(before[key])),'less glaring distant palette');
    assert.ok(day.sky.b>day.sky.r&&day.sunColor.r>day.sunColor.b,'blue sky and warm sun retain the city palette');
  }
  for(const [hour,expected] of [[0,{exposure:.98,ambient:.065,hemi:.8,sun:.25,environment:.24,photo:0,daylight:0}],
    [6,{exposure:1,ambient:.075,hemi:1.1,sun:1.2,environment:.5,photo:.65,daylight:.48}],
    [18,{exposure:1,ambient:.075,hemi:1.05,sun:1.5,environment:.5,photo:1,daylight:.36}],
    [22,{exposure:.98,ambient:.065,hemi:.8,sun:.25,environment:.24,photo:0,daylight:0}]]){
    const state=architecturalDaylight(hour);for(const [key,value] of Object.entries(expected))assert.equal(state[key],value,`${hour}: preserve ${key}`);
  }
});

test('the softer day uses the same light count, shadow budget and asset requests in every profile',async()=>{
  for(const profileId of ['LITE','STANDARD','ULTRA']){
    const state=fixture('success');activeFixture=state;
    state.sun.castShadow=profileId!=='LITE';
    const shadowSize=state.sun.shadow.mapSize.toArray(),lightCount=state.scene.children.filter(node=>node.isLight).length;
    const lighting=configureArchitecturalLighting({scene:state.scene,renderer:state.renderer,sun:state.sun,profile:{id:profileId},now:()=>new Date('2026-09-15T15:00:00Z')});
    assert.equal(await lighting.ready,true);
    const day=architecturalDaylight(12);
    assert.equal(state.renderer.toneMappingExposure,day.exposure);assert.equal(state.sun.intensity,day.sun);
    assert.equal(state.scene.environmentIntensity,day.environment);assert.equal(state.scene.fog.density,.00035);
    assert.equal(state.scene.children.filter(node=>node.isLight).length,lightCount);
    assert.equal(state.sun.castShadow,profileId!=='LITE');assert.deepEqual(state.sun.shadow.mapSize.toArray(),shadowSize);
    assert.equal(state.requests.length,2);assert.equal(state.generators,1);
    assert.equal(state.requests.find(request=>request.kind==='photo').url.endsWith(profileId==='LITE'?'2k.webp':'4k.webp'),true);
    lighting.dispose();assert.deepEqual(state.snapshot(),state.original);
  }
});
