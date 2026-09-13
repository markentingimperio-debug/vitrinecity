import * as THREE from '/vendor/three/three.module.js';
import {HDRLoader} from './assets/architectural-lighting/HDRLoader.js';
import {spatialCityHour,resolveSpatialDayPhase} from './vitriny-spatial-adaptive-experience.js';

// A shared Brasilia clock drives gradual light/sky transitions. Night retains
// enough fill light for shopping and navigation, including phones without shadows.
const NIGHT={exposure:.98,ambient:.065,hemi:.8,sun:.25,environment:.24,photo:0,daylight:0,sky:'#09152f',horizon:'#30476a',fog:'#283d58',ground:'#596b85',sunColor:'#adcaff'};
const DAY={exposure:1.02,ambient:.09,hemi:1.55,sun:2.65,environment:.78,photo:0,daylight:1,sky:'#3887cd',horizon:'#c8e5f3',fog:'#bdd5e0',ground:'#bac2b0',sunColor:'#fff2dc'};
const DAWN={exposure:1,ambient:.075,hemi:1.1,sun:1.2,environment:.5,photo:.65,daylight:.48,sky:'#557bae',horizon:'#f5ba91',fog:'#c9b5a2',ground:'#a99a86',sunColor:'#ffd1a0'};
const DUSK={...DAWN,hemi:1.05,sun:1.5,photo:1,daylight:.36};
const KEYFRAMES=[[0,NIGHT],[5,NIGHT],[6,DAWN],[7,DAY],[16,DAY],[18,DUSK],[19,NIGHT],[24,NIGHT]];
const COLOR_KEYS=new Set(['sky','horizon','fog','ground','sunColor']);
export function architecturalDaylight(hour=spatialCityHour()){
  const h=((Number.isFinite(Number(hour))?Number(hour):12)%24+24)%24;
  const index=KEYFRAMES.findIndex(([at])=>at>h),[start,a]=KEYFRAMES[index-1],[end,b]=KEYFRAMES[index];
  const linear=(h-start)/(end-start),mix=linear*linear*(3-2*linear),state={hour:h,phase:resolveSpatialDayPhase(h).id};
  for(const key of Object.keys(a))state[key]=COLOR_KEYS.has(key)?new THREE.Color(a[key]).lerp(new THREE.Color(b[key]),mix):a[key]+(b[key]-a[key])*mix;
  return state;
}

// A 1 MB CC0 HDR supplies reflections; the photographic sunset is used at dusk.
// Keep the existing environment until loading and PMREM creation both succeed.
export function configureArchitecturalLighting({renderer,scene,sun,profile={id:'STANDARD'},now=()=>new Date()}){
  const lite=profile.id==='LITE',previousEnvironment=scene.environment;
  const previousBackground=scene.background;
  const previous={toneMapping:renderer.toneMapping,exposure:renderer.toneMappingExposure,
    fogColor:scene.fog?.color.clone(),fogDensity:scene.fog?.density,
    environmentIntensity:scene.environmentIntensity,backgroundIntensity:scene.backgroundIntensity,
    backgroundBlurriness:scene.backgroundBlurriness,backgroundRotation:scene.backgroundRotation.clone(),
    environmentRotation:scene.environmentRotation.clone(),lighting:scene.userData.architecturalLighting,dayPhase:scene.userData.dayPhase,
    sun:sun?{color:sun.color.clone(),intensity:sun.intensity,position:sun.position.clone(),target:sun.target.position.clone(),normalBias:sun.shadow.normalBias,bias:sun.shadow.bias,radius:sun.shadow.radius,
      shadowBounds:{left:sun.shadow.camera.left,right:sun.shadow.camera.right,top:sun.shadow.camera.top,bottom:sun.shadow.camera.bottom,near:sun.shadow.camera.near,far:sun.shadow.camera.far}}:null,
    lights:scene.children.filter(light=>light.isHemisphereLight||light.isAmbientLight).map(light=>({light,intensity:light.intensity,color:light.color.clone(),groundColor:light.groundColor?.clone()}))};
  let disposed=false,restored=false,environmentTarget=null,hdrTexture=null,skyTexture=null,photoDome=null,hiddenHorizon=null,horizonVisible=true,phaseTimer=null;
  function stopClock(){if(phaseTimer!==null)clearInterval(phaseTimer);phaseTimer=null;globalThis.document?.removeEventListener?.('visibilitychange',refresh);}
  function disposeDome(){if(!photoDome)return;photoDome.removeFromParent();photoDome.geometry.dispose();photoDome.material.dispose();photoDome=null;}
  function restore(){
    if(restored)return;restored=true;stopClock();
    renderer.toneMapping=previous.toneMapping;renderer.toneMappingExposure=previous.exposure;
    if(previous.fogColor&&scene.fog){scene.fog.color.copy(previous.fogColor);if(previous.fogDensity!==undefined)scene.fog.density=previous.fogDensity;}
    scene.environmentIntensity=previous.environmentIntensity;scene.backgroundIntensity=previous.backgroundIntensity;
    scene.backgroundBlurriness=previous.backgroundBlurriness;
    scene.backgroundRotation.copy(previous.backgroundRotation);scene.environmentRotation.copy(previous.environmentRotation);
    if(previous.lighting===undefined)delete scene.userData.architecturalLighting;else scene.userData.architecturalLighting=previous.lighting;
    if(previous.dayPhase===undefined)delete scene.userData.dayPhase;else scene.userData.dayPhase=previous.dayPhase;
    previous.lights.forEach(({light,intensity,color,groundColor})=>{light.intensity=intensity;light.color.copy(color);if(groundColor)light.groundColor.copy(groundColor);});
    if(previous.sun){sun.color.copy(previous.sun.color);sun.intensity=previous.sun.intensity;sun.position.copy(previous.sun.position);sun.target.position.copy(previous.sun.target);sun.target.updateMatrixWorld();sun.shadow.normalBias=previous.sun.normalBias;sun.shadow.bias=previous.sun.bias;sun.shadow.radius=previous.sun.radius;Object.assign(sun.shadow.camera,previous.sun.shadowBounds);sun.shadow.camera.updateProjectionMatrix();}
    if(environmentTarget&&scene.environment===environmentTarget.texture)scene.environment=previousEnvironment;
    if(skyTexture&&scene.background===skyTexture)scene.background=previousBackground;
    if(hiddenHorizon)hiddenHorizon.visible=horizonVisible;
  }
  function refresh(){
    if(disposed||restored)return;
    const state=architecturalDaylight(spatialCityHour(now()));
    renderer.toneMappingExposure=state.exposure;
    scene.userData.dayPhase=state.phase;
    if(scene.fog){scene.fog.color.copy(state.fog);if('density' in scene.fog)scene.fog.density=.00035;}
    for(const {light} of previous.lights){
      if(light.isHemisphereLight){light.color.copy(state.horizon);light.groundColor.copy(state.ground);light.intensity=state.hemi;}
      if(light.isAmbientLight)light.intensity=state.ambient;
    }
    const angle=(state.hour-6)/12*Math.PI;
    const direction=new THREE.Vector3(Math.cos(angle)*.8,Math.max(.13,Math.abs(Math.sin(angle))),-.55).normalize();
    if(sun){sun.color.copy(state.sunColor);sun.intensity=state.sun;sun.position.copy(sun.target.position).addScaledVector(direction,450);}
    if(environmentTarget)scene.environmentIntensity=state.environment;
    if(photoDome){
      const uniforms=photoDome.material.uniforms;
      uniforms.top.value.copy(state.sky);uniforms.horizon.value.copy(state.horizon);uniforms.daylight.value=state.daylight;
      uniforms.photoMix.value=skyTexture===hdrTexture?0:state.photo;uniforms.sunDirection.value.copy(direction);
    }
    scene.userData.architecturalLighting='brasilia-day-night';
  }
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  if(sun){
    sun.target.position.set(-164,0,-80);
    sun.shadow.normalBias=.035;sun.shadow.bias=-.00006;sun.shadow.radius=2;
    // Concentrate the existing 2048px map on the boulevard and its occluders.
    // The former 440m vertical span spent most texels above the 150m skyline.
    Object.assign(sun.shadow.camera,{left:-230,right:150,top:190,bottom:-50,near:1,far:1100});
    sun.shadow.camera.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
  }
  refresh();

  const skySize=lite?'2k':'4k';
  const ready=Promise.all([
    new HDRLoader().loadAsync('/assets/architectural-lighting/kloppenheim06-sunset-1k.hdr').catch(()=>null),
    new THREE.TextureLoader().loadAsync(`/assets/architectural-lighting/kloppenheim06-sky-${skySize}.webp`).catch(()=>null)
  ]).then(([texture,photograph])=>{
    if(disposed||!texture){texture?.dispose();photograph?.dispose();if(!disposed)restore();return false;}
    hdrTexture=texture;skyTexture=photograph||texture;
    let generator;
    try{
      texture.mapping=THREE.EquirectangularReflectionMapping;
      generator=new THREE.PMREMGenerator(renderer);
      environmentTarget=generator.fromEquirectangular(texture);
      scene.environment=environmentTarget.texture;
      {
        if(photograph)photograph.colorSpace=THREE.SRGBColorSpace;
        // Direct panorama sampling avoids Three's automatic 2048px cubemap for a 4K sky.
        const geometry=new THREE.SphereGeometry(1500,lite?24:40,lite?12:20);
        const material=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,fog:false,toneMapped:false,
          uniforms:{photograph:{value:skyTexture},rotation:{value:1.927361639},photoMix:{value:0},daylight:{value:1},top:{value:new THREE.Color()},horizon:{value:new THREE.Color()},sunDirection:{value:new THREE.Vector3()}},
          vertexShader:'varying vec3 direction;void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
          fragmentShader:`uniform sampler2D photograph;uniform float rotation;uniform float photoMix;uniform float daylight;uniform vec3 top;uniform vec3 horizon;uniform vec3 sunDirection;varying vec3 direction;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
void main(){vec3 d=normalize(direction);float height=max(d.y,0.0);vec3 sky=mix(horizon,top,pow(height,.38));
vec2 p=d.xz/(height+.28)*3.0;float clouds=noise(p)*.57+noise(p*2.03)*.28+noise(p*4.07)*.15;
float mask=smoothstep(.57,.8,clouds)*smoothstep(.015,.2,height);sky=mix(sky,mix(vec3(.15,.20,.29),vec3(.9,.94,1.0),daylight),mask*.68);
float disk=max(dot(d,sunDirection),0.0);sky+=mix(vec3(.24,.32,.46),vec3(1.0,.9,.7),daylight)*(pow(disk,1400.0)*.85+pow(disk,38.0)*.08);
float star=step(.9985,hash(floor(d.xz/(height+.15)*700.0)))*smoothstep(.18,.4,height)*(1.0-daylight);sky+=vec3(star*.36);
float c=cos(rotation),s=sin(rotation);vec3 rotated=vec3(c*d.x-s*d.z,d.y,s*d.x+c*d.z);vec2 uv=vec2(atan(rotated.z,rotated.x)*.159154943+.5,asin(clamp(rotated.y,-1.0,1.0))*.318309886+.5);
gl_FragColor=vec4(mix(sky,texture2D(photograph,uv).rgb*.95,photoMix),1.0);
#include <colorspace_fragment>
}`});
        photoDome=new THREE.Mesh(geometry,material);photoDome.name='architectural-photographic-sky';photoDome.frustumCulled=false;photoDome.renderOrder=-100;
        photoDome.onBeforeRender=(_renderer,_scene,camera)=>{photoDome.position.copy(camera.position);photoDome.updateMatrixWorld();};
        scene.add(photoDome);
      }
      // Keep sky/reflections in exactly the same coordinate system.
      scene.backgroundRotation.set(0,1.927361639,0);scene.environmentRotation.copy(scene.backgroundRotation);
      hiddenHorizon=scene.getObjectByName('orbital-horizon');
      if(hiddenHorizon){horizonVisible=hiddenHorizon.visible;hiddenHorizon.visible=false;}
      refresh();phaseTimer=setInterval(refresh,30000);phaseTimer.unref?.();
      globalThis.document?.addEventListener?.('visibilitychange',refresh);
      return true;
    }catch{
      restore();
      disposeDome();texture.dispose();photograph?.dispose();environmentTarget?.dispose();environmentTarget=null;hdrTexture=null;skyTexture=null;
      return false;
    }finally{generator?.dispose();}
  }).catch(()=>{restore();return false;});

  return {ready,dispose(){
    if(disposed)return;disposed=true;
    restore();
    disposeDome();environmentTarget?.dispose();hdrTexture?.dispose();if(skyTexture!==hdrTexture)skyTexture?.dispose();
  }};
}
