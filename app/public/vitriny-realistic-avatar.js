import * as THREE from '/vendor/three/three.module.js';

export const REALISTIC_AVATAR_URL='/assets/avatars/vc-visitor-realistic-v1.glb';
let download;
const loaderFactory=async()=>new (await import('/vendor/three/addons/loaders/GLTFLoader.js')).GLTFLoader();
export async function loadRealisticVisitor({skinColor='#c88d61',outfitColor='#2f697b',fetchImpl=globalThis.fetch,makeLoader=loaderFactory}={}){
  const read=async()=>{
    const response=await fetchImpl(REALISTIC_AVATAR_URL,{credentials:'same-origin',cache:'force-cache',redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('avatar_asset_unavailable');
    const bytes=await response.arrayBuffer();
    if(bytes.byteLength<20||bytes.byteLength>3*1024*1024||new DataView(bytes).getUint32(0,true)!==0x46546c67)throw Error('avatar_asset_invalid');
    return bytes;
  };
  let bytes;
  if(fetchImpl===globalThis.fetch){download??=read().catch(error=>{download=null;throw error;});bytes=await download;}else bytes=await read();
  const gltf=await (await makeLoader()).parseAsync(bytes.slice(0),'');
  return createRealisticVisitor(gltf,{skinColor,outfitColor});
}

export function createRealisticVisitor(gltf,{skinColor='#c88d61',outfitColor='#2f697b'}={}){
  const group=gltf?.scene,clips=gltf?.animations;
  if(!group?.isObject3D||!Array.isArray(clips)||!clips.some(c=>c.name==='Idle')||!clips.some(c=>c.name==='Walk'))throw Error('avatar_rig_invalid');
  group.name='realistic-visitor';
  const materials={skin:[],shirt:[]},premium=[];
  let skinned=0;
  group.traverse(object=>{
    if(!object.isMesh)return;
    object.castShadow=true;object.receiveShadow=false;object.frustumCulled=false;
    if(object.isSkinnedMesh)skinned++;
    for(const material of Array.isArray(object.material)?object.material:[object.material]){
      if(material.name==='AvatarSkin')materials.skin.push(material);
      if(material.name==='AvatarShirt')materials.shirt.push(material);
      if(material.name.startsWith('AvatarOrbit')){premium.push(object);object.visible=false;}
    }
  });
  if(!skinned||!materials.skin.length||!materials.shirt.length)throw Error('avatar_materials_invalid');
  const mixer=new THREE.AnimationMixer(group),idle=mixer.clipAction(clips.find(c=>c.name==='Idle')),walk=mixer.clipAction(clips.find(c=>c.name==='Walk'));
  idle.play();walk.play();walk.setEffectiveWeight(0);
  let amount=0,outfit=outfitColor,paid=false,disposed=false;
  function appearance(skinValue,outfitValue){outfit=outfitValue;for(const material of materials.skin)material.color.set(skinValue);for(const material of materials.shirt)material.color.set(paid?'#b89b60':outfit);}
  function setPremium(value){paid=value===true;for(const object of premium)object.visible=paid;for(const material of materials.shirt){material.color.set(paid?'#b89b60':outfit);material.metalness=paid?.58:0;material.roughness=paid?.39:.92;}}
  function tick(dt,moving=false){if(disposed)return;const delta=Math.max(0,Math.min(Number(dt)||0,.1));amount=THREE.MathUtils.damp(amount,moving?1:0,10,delta);idle.setEffectiveWeight(1-amount);walk.setEffectiveWeight(amount);mixer.update(delta);}
  appearance(skinColor,outfitColor);mixer.update(0);
  function dispose(){if(disposed)return;disposed=true;mixer.stopAllAction();mixer.uncacheRoot(group);const geometry=new Set(),mats=new Set(),skeletons=new Set();group.traverse(o=>{if(o.geometry)geometry.add(o.geometry);if(o.skeleton)skeletons.add(o.skeleton);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])mats.add(m);});for(const skeleton of skeletons)skeleton.dispose();for(const g of geometry)g.dispose();for(const m of mats)m.dispose();group.removeFromParent();}
  return {group,materials,tick,setAppearance:appearance,setPremium,dispose};
}
