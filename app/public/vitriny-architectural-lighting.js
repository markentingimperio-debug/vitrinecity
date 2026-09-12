import * as THREE from '/vendor/three/three.module.js';
import {HDRLoader} from './assets/architectural-lighting/HDRLoader.js';

// A 1 MB CC0 HDR supplies lighting; a 151 KB photographic sky preserves cloud detail.
// Keep the existing environment until loading and PMREM creation both succeed.
export function configureArchitecturalLighting({renderer,scene,sun,profile={id:'STANDARD'}}){
  const lite=profile.id==='LITE',previousEnvironment=scene.environment;
  const previousBackground=scene.background;
  const previous={toneMapping:renderer.toneMapping,exposure:renderer.toneMappingExposure,
    fogColor:scene.fog?.color.clone(),fogDensity:scene.fog?.density,
    environmentIntensity:scene.environmentIntensity,backgroundIntensity:scene.backgroundIntensity,
    backgroundBlurriness:scene.backgroundBlurriness,backgroundRotation:scene.backgroundRotation.clone(),
    environmentRotation:scene.environmentRotation.clone(),lighting:scene.userData.architecturalLighting,
    sun:sun?{color:sun.color.clone(),intensity:sun.intensity,position:sun.position.clone(),target:sun.target.position.clone(),normalBias:sun.shadow.normalBias,bias:sun.shadow.bias,radius:sun.shadow.radius,
      shadowBounds:{left:sun.shadow.camera.left,right:sun.shadow.camera.right,top:sun.shadow.camera.top,bottom:sun.shadow.camera.bottom,near:sun.shadow.camera.near,far:sun.shadow.camera.far}}:null,
    lights:scene.children.filter(light=>light.isHemisphereLight||light.isAmbientLight).map(light=>({light,intensity:light.intensity,color:light.color.clone(),groundColor:light.groundColor?.clone()}))};
  let disposed=false,restored=false,environmentTarget=null,hdrTexture=null,skyTexture=null,photoDome=null,hiddenHorizon=null,horizonVisible=true;
  function disposeDome(){if(!photoDome)return;photoDome.removeFromParent();photoDome.geometry.dispose();photoDome.material.dispose();photoDome=null;}
  function restore(){
    if(restored)return;restored=true;
    renderer.toneMapping=previous.toneMapping;renderer.toneMappingExposure=previous.exposure;
    if(previous.fogColor&&scene.fog){scene.fog.color.copy(previous.fogColor);if(previous.fogDensity!==undefined)scene.fog.density=previous.fogDensity;}
    scene.environmentIntensity=previous.environmentIntensity;scene.backgroundIntensity=previous.backgroundIntensity;
    scene.backgroundBlurriness=previous.backgroundBlurriness;
    scene.backgroundRotation.copy(previous.backgroundRotation);scene.environmentRotation.copy(previous.environmentRotation);
    if(previous.lighting===undefined)delete scene.userData.architecturalLighting;else scene.userData.architecturalLighting=previous.lighting;
    previous.lights.forEach(({light,intensity,color,groundColor})=>{light.intensity=intensity;light.color.copy(color);if(groundColor)light.groundColor.copy(groundColor);});
    if(previous.sun){sun.color.copy(previous.sun.color);sun.intensity=previous.sun.intensity;sun.position.copy(previous.sun.position);sun.target.position.copy(previous.sun.target);sun.target.updateMatrixWorld();sun.shadow.normalBias=previous.sun.normalBias;sun.shadow.bias=previous.sun.bias;sun.shadow.radius=previous.sun.radius;Object.assign(sun.shadow.camera,previous.sun.shadowBounds);sun.shadow.camera.updateProjectionMatrix();}
    if(environmentTarget&&scene.environment===environmentTarget.texture)scene.environment=previousEnvironment;
    if(skyTexture&&scene.background===skyTexture)scene.background=previousBackground;
    if(hiddenHorizon)hiddenHorizon.visible=horizonVisible;
  }
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=.8;
  if(scene.fog){scene.fog.color.set('#a39784');if('density' in scene.fog)scene.fog.density=.00035;}
  for(const light of scene.children){
    if(light.isHemisphereLight){light.color.set('#adc6e5');light.groundColor.set('#8d6844');light.intensity=.18;}
    if(light.isAmbientLight)light.intensity=.025;
  }
  if(sun){
    sun.color.set('#ffc58c');sun.intensity=2.2;
    // Photographic sun: 4.92 degrees above the horizon, 20 degrees east of north.
    sun.position.set(-34,32.7,-437);sun.target.position.set(-164,0,-80);
    sun.shadow.normalBias=.035;sun.shadow.bias=-.00006;sun.shadow.radius=2;
    // Concentrate the existing 2048px map on the boulevard and its occluders.
    // The former 440m vertical span spent most texels above the 150m skyline.
    Object.assign(sun.shadow.camera,{left:-230,right:150,top:190,bottom:-50,near:1,far:1100});
    sun.shadow.camera.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
  }

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
      scene.environmentIntensity=lite ? .56 : .58;
      if(photograph){
        photograph.colorSpace=THREE.SRGBColorSpace;
        // Direct panorama sampling avoids Three's automatic 2048px cubemap for a 4K sky.
        const geometry=new THREE.SphereGeometry(1500,lite?24:40,lite?12:20);
        const material=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,fog:false,toneMapped:false,
          uniforms:{photograph:{value:photograph},rotation:{value:1.927361639},intensity:{value:.95}},
          vertexShader:'varying vec3 direction;void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
          fragmentShader:'uniform sampler2D photograph;uniform float rotation;uniform float intensity;varying vec3 direction;void main(){vec3 d=normalize(direction);float c=cos(rotation),s=sin(rotation);d=vec3(c*d.x-s*d.z,d.y,s*d.x+c*d.z);vec2 uv=vec2(atan(d.z,d.x)*.159154943+.5,asin(clamp(d.y,-1.0,1.0))*.318309886+.5);gl_FragColor=vec4(texture2D(photograph,uv).rgb*intensity,1.0);\n#include <colorspace_fragment>\n}'});
        photoDome=new THREE.Mesh(geometry,material);photoDome.name='architectural-photographic-sky';photoDome.frustumCulled=false;photoDome.renderOrder=-100;
        photoDome.onBeforeRender=(_renderer,_scene,camera)=>{photoDome.position.copy(camera.position);photoDome.updateMatrixWorld();};
        scene.add(photoDome);
      }else{
        scene.background=texture;scene.backgroundIntensity=.4;scene.backgroundBlurriness=0;
      }
      // Keep sky/reflections in exactly the same coordinate system.
      scene.backgroundRotation.set(0,1.927361639,0);scene.environmentRotation.copy(scene.backgroundRotation);
      hiddenHorizon=scene.getObjectByName('orbital-horizon');
      if(hiddenHorizon){horizonVisible=hiddenHorizon.visible;hiddenHorizon.visible=false;}
      scene.userData.architecturalLighting='photographic-sunset';
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
