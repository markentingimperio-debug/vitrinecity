import * as THREE from '/vendor/three/three.module.js';
import {fetchSpatialEnvironment} from './vitriny-spatial-environment-client.js';
import {combineSpatialLodFactors,createSpatialDistanceLodController,createSpatialLodController,premiumSpatialSlotState,resolveSpatialDayPhase} from './vitriny-spatial-adaptive-experience.js';

const ACCENTS=['#6ee7ff','#8f8cff','#e48cff','#ffb36b','#85e6a8','#6f9cff','#b58cff','#6edbcf'];
function color(value,fallback){try{return new THREE.Color(String(value||fallback));}catch{return new THREE.Color(fallback);}}
function instanced(group,geometry,material,count,name){const mesh=new THREE.InstancedMesh(geometry,material,count);mesh.name=name;mesh.frustumCulled=true;mesh.userData.baseCount=count;group.add(mesh);return mesh;}
function setTransform(mesh,index,{x=0,y=0,z=0,sx=1,sy=1,sz=1,ry=0},matrix,quaternion,scale,position){position.set(x,y,z);quaternion.setFromEuler(new THREE.Euler(0,ry,0));scale.set(sx,sy,sz);matrix.compose(position,quaternion,scale);mesh.setMatrixAt(index,matrix);}
function setCount(mesh,factor){if(!mesh?.isInstancedMesh)return;const base=mesh.userData.baseCount||mesh.count;mesh.count=Math.max(0,Math.min(base,Math.ceil(base*factor)));mesh.visible=mesh.count>0;}
function cameraDistance(camera){const x=Number(camera?.position?.x),z=Number(camera?.position?.z);return Number.isFinite(x)&&Number.isFinite(z)?Math.hypot(x,z):0;}

export async function mountSpatialCityEnvironment({scene,camera=null,cityId,identity,profileId='STANDARD',shadows=false,fetchImpl=globalThis.fetch}={}){
  if(!scene?.add)throw new TypeError('spatial_environment_scene_required');
  const environment=await fetchSpatialEnvironment({cityId,profileId,fetchImpl});
  const group=new THREE.Group();group.name=`city-environment:${environment.cityId}:${environment.profileId}`;group.userData={spatialEnvironment:true,cityId:environment.cityId,profileId:environment.profileId};
  const accent=color(identity?.palette?.accent,'#6ee7ff'),secondary=color(identity?.palette?.secondary,'#8f8cff');
  const matrix=new THREE.Matrix4(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3(),position=new THREE.Vector3();
  const meshes={};

  if(environment.skyline.length){
    const geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial({color:'#172334',metalness:.52,roughness:.32,vertexColors:true,emissive:accent,emissiveIntensity:.035});
    const skyline=meshes.skyline=instanced(group,geometry,material,environment.skyline.length,'themed-skyline');skyline.castShadow=Boolean(shadows);skyline.receiveShadow=Boolean(shadows);
    environment.skyline.forEach((item,index)=>{setTransform(skyline,index,{x:item.position.x,y:item.size.height/2,z:item.position.z,sx:item.size.width,sy:item.size.height,sz:item.size.depth,ry:item.rotationY},matrix,quaternion,scale,position);const base=color(ACCENTS[item.accentIndex],identity?.palette?.accent||'#6ee7ff');base.lerp(index%2?secondary:accent,.34+item.windowDensity*.22);skyline.setColorAt(index,base);});
    skyline.instanceMatrix.needsUpdate=true;if(skyline.instanceColor)skyline.instanceColor.needsUpdate=true;
  }

  if(environment.vegetation.length){
    const trunk=meshes.trunks=instanced(group,new THREE.CylinderGeometry(.18,.28,1,profileId==='LITE'?5:7),new THREE.MeshStandardMaterial({color:'#4e4031',roughness:.88}),environment.vegetation.length,'urban-green-trunks');
    const crown=meshes.vegetation=instanced(group,new THREE.SphereGeometry(1,profileId==='LITE'?6:10,profileId==='LITE'?5:7),new THREE.MeshStandardMaterial({color:'#2f714f',roughness:.82,vertexColors:true}),environment.vegetation.length,'urban-green-crowns');
    environment.vegetation.forEach((item,index)=>{const h=(item.kind==='palm'?5.8:item.kind==='cerrado-tree'?4.3:3.8)*item.scale,crownY=h+(item.kind==='garden'?.8:1.6)*item.scale;setTransform(trunk,index,{x:item.position.x,y:h/2,z:item.position.z,sx:item.kind==='palm'?.65:1,sy:h,sz:item.kind==='palm'?.65:1},matrix,quaternion,scale,position);setTransform(crown,index,{x:item.position.x,y:crownY,z:item.position.z,sx:(item.kind==='garden'?1.7:2.2)*item.scale,sy:(item.kind==='canopy'?1.1:1.6)*item.scale,sz:(item.kind==='garden'?1.7:2.2)*item.scale},matrix,quaternion,scale,position);const c=color(item.kind==='cerrado-tree'?'#6f9b55':item.kind==='palm'?'#3f8f66':'#3d7f58','#3d7f58');c.lerp(accent,.08);crown.setColorAt(index,c);});
    trunk.instanceMatrix.needsUpdate=true;crown.instanceMatrix.needsUpdate=true;if(crown.instanceColor)crown.instanceColor.needsUpdate=true;
  }

  if(environment.lights.length){
    const poles=meshes.lightPoles=instanced(group,new THREE.CylinderGeometry(.07,.09,1,6),new THREE.MeshStandardMaterial({color:'#26384a',metalness:.65,roughness:.28}),environment.lights.length,'urban-light-poles');
    const bulbs=meshes.lights=instanced(group,new THREE.SphereGeometry(.24,profileId==='LITE'?6:10,profileId==='LITE'?4:7),new THREE.MeshBasicMaterial({color:identity?.palette?.accent||'#6ee7ff'}),environment.lights.length,'urban-light-bulbs');
    environment.lights.forEach((item,index)=>{setTransform(poles,index,{x:item.position.x,y:item.height/2,z:item.position.z,sy:item.height},matrix,quaternion,scale,position);setTransform(bulbs,index,{x:item.position.x,y:item.height+.12,z:item.position.z,sx:.8+item.intensity*.35,sy:.8+item.intensity*.35,sz:.8+item.intensity*.35},matrix,quaternion,scale,position);});poles.instanceMatrix.needsUpdate=true;bulbs.instanceMatrix.needsUpdate=true;
  }

  if(environment.districtLights?.length){
    const poles=meshes.districtLightPoles=instanced(group,new THREE.CylinderGeometry(.09,.12,1,6),new THREE.MeshStandardMaterial({color:'#21364b',metalness:.72,roughness:.24}),environment.districtLights.length,'district-light-poles');
    const bulbs=meshes.districtLights=instanced(group,new THREE.SphereGeometry(.34,profileId==='LITE'?6:10,profileId==='LITE'?4:7),new THREE.MeshBasicMaterial({color:'#ffffff',vertexColors:true,transparent:true,opacity:.92}),environment.districtLights.length,'district-light-beacons');
    environment.districtLights.forEach((item,index)=>{setTransform(poles,index,{x:item.position.x,y:item.height/2,z:item.position.z,sy:item.height},matrix,quaternion,scale,position);const glow=.9+item.intensity*.45;setTransform(bulbs,index,{x:item.position.x,y:item.height+.18,z:item.position.z,sx:glow,sy:glow,sz:glow},matrix,quaternion,scale,position);bulbs.setColorAt(index,color(ACCENTS[item.accentIndex],identity?.palette?.accent||'#6ee7ff'));});
    poles.instanceMatrix.needsUpdate=true;bulbs.instanceMatrix.needsUpdate=true;if(bulbs.instanceColor)bulbs.instanceColor.needsUpdate=true;
  }

  if(environment.furniture.length){
    const furniture=meshes.furniture=instanced(group,new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:'#263646',metalness:.24,roughness:.58}),environment.furniture.length,'urban-furniture');
    environment.furniture.forEach((item,index)=>{const kiosk=item.kind==='kiosk',seat=item.kind==='garden-seat'||item.kind==='transit-seat';setTransform(furniture,index,{x:item.position.x,y:kiosk?1.4:.45,z:item.position.z,sx:kiosk?2.3:seat?2.5:2.8,sy:kiosk?2.8:.5,sz:kiosk?2.3:.8,ry:item.rotationY},matrix,quaternion,scale,position);});furniture.instanceMatrix.needsUpdate=true;
  }

  if(environment.districtFurniture?.length){
    const furniture=meshes.districtFurniture=instanced(group,new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:'#1d3348',emissive:accent,emissiveIntensity:.08,metalness:.34,roughness:.42}),environment.districtFurniture.length,'district-furniture');
    environment.districtFurniture.forEach((item,index)=>{const kiosk=/kiosk|pod|showcase/.test(item.kind);setTransform(furniture,index,{x:item.position.x,y:kiosk?1.25:.42,z:item.position.z,sx:kiosk?2.2:2.7,sy:kiosk?2.5:.48,sz:kiosk?1.6:.78,ry:item.rotationY},matrix,quaternion,scale,position);});furniture.instanceMatrix.needsUpdate=true;
  }

  const premiumSlots=[];
  for(const raw of environment.premiumSlots||[]){
    const slot=premiumSpatialSlotState(raw);if(!slot)continue;
    const source=(environment.premiumSlots||[]).find(item=>item.slotId===slot.slotId);if(!source)continue;
    const marker=new THREE.Group();marker.name=slot.slotId;marker.userData={premiumSlot:true,...slot};marker.position.set(source.position.x,0,source.position.z);marker.rotation.y=source.rotationY||0;
    const base=new THREE.Mesh(new THREE.CylinderGeometry(2.8,3.2,.55,profileId==='LITE'?12:24),new THREE.MeshStandardMaterial({color:slot.status==='active'?'#18334a':'#132336',emissive:slot.status==='active'?accent:'#000000',emissiveIntensity:slot.status==='active'?.18:0,metalness:.5,roughness:.32}));base.position.y=.275;marker.add(base);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(2.6,.12,6,profileId==='LITE'?20:40),new THREE.MeshBasicMaterial({color:slot.status==='active'?accent:secondary,transparent:true,opacity:slot.status==='active'?.78:.42}));ring.rotation.x=Math.PI/2;ring.position.y=.68;marker.add(ring);group.add(marker);premiumSlots.push(marker);
  }

  const premium=new THREE.Mesh(new THREE.RingGeometry(122,154,profileId==='LITE'?48:96),new THREE.MeshBasicMaterial({color:identity?.palette?.secondary||'#8f8cff',transparent:true,opacity:.035,side:THREE.DoubleSide,depthWrite:false}));premium.rotation.x=-Math.PI/2;premium.position.y=.015;premium.name='premium-zone-ring';group.add(premium);

  const hemi=scene.children.find(item=>item?.isHemisphereLight)||null,directional=scene.children.find(item=>item?.isDirectionalLight)||null;
  const original={hemi:hemi?.intensity??null,directional:directional?.intensity??null,fog:scene.fog?.density??null};
  let currentPhase=null;
  function applyPhase(){
    const phase=resolveSpatialDayPhase(new Date().getHours());if(currentPhase?.id===phase.id)return;currentPhase=phase;group.userData.dayPhase=phase.id;
    if(hemi&&original.hemi!=null)hemi.intensity=original.hemi*phase.ambient;
    if(directional&&original.directional!=null)directional.intensity=original.directional*phase.sun;
    if(scene.fog&&original.fog!=null)scene.fog.density=original.fog*phase.fog;
    if(meshes.skyline?.material)meshes.skyline.material.emissiveIntensity=.035+.12*phase.emissive;
    if(meshes.lights?.material){meshes.lights.material.opacity=.45+.5*phase.emissive;meshes.lights.material.transparent=true;}
    if(meshes.districtLights?.material)meshes.districtLights.material.opacity=.52+.46*phase.emissive;
  }
  applyPhase();const phaseTimer=setInterval(applyPhase,60000);

  const fpsLod=createSpatialLodController({profile:profileId});
  const distanceLod=createSpatialDistanceLodController({profile:profileId,initialDistance:cameraDistance(camera)});
  let fpsFactors=fpsLod.factors,distanceFactors=distanceLod.factors;
  function applyLod(){
    const factors=combineSpatialLodFactors(fpsFactors,distanceFactors);
    setCount(meshes.skyline,factors.skyline);setCount(meshes.trunks,factors.vegetation);setCount(meshes.vegetation,factors.vegetation);setCount(meshes.lightPoles,factors.lights);setCount(meshes.lights,factors.lights);setCount(meshes.districtLightPoles,factors.lights);setCount(meshes.districtLights,factors.lights);setCount(meshes.furniture,factors.furniture);setCount(meshes.districtFurniture,factors.districtFurniture);
    const visiblePremium=Math.ceil(premiumSlots.length*factors.premium);premiumSlots.forEach((item,index)=>item.visible=index<visiblePremium);premium.visible=factors.premium>0;
    group.userData.lodLevel=fpsLod.level;group.userData.distanceTier=distanceLod.tier;group.userData.lodFactors=factors;
  }
  applyLod();
  let raf=0,frames=0,clock=performance.now(),distanceClock=clock,disposed=false;
  function sample(now){
    if(disposed)return;raf=requestAnimationFrame(sample);
    if(document.hidden){frames=0;clock=distanceClock=now;return;}
    frames++;
    if(now-distanceClock>=250){
      const result=distanceLod.sample(cameraDistance(camera));distanceClock=now;group.userData.cameraDistance=Math.round(result.distance);
      if(result.changed){distanceFactors=result.factors;applyLod();}
    }
    if(now-clock>=1000){
      const fps=frames*1000/(now-clock),result=fpsLod.sample(fps);frames=0;clock=now;group.userData.fps=Math.round(fps);
      if(result.changed){fpsFactors=result.factors;applyLod();}
    }
  }
  raf=requestAnimationFrame(sample);

  scene.add(group);
  return Object.freeze({group,environment,get phase(){return currentPhase?.id||'day';},get lodLevel(){return fpsLod.level;},get distanceTier(){return distanceLod.tier;},dispose(){disposed=true;cancelAnimationFrame(raf);clearInterval(phaseTimer);if(hemi&&original.hemi!=null)hemi.intensity=original.hemi;if(directional&&original.directional!=null)directional.intensity=original.directional;if(scene.fog&&original.fog!=null)scene.fog.density=original.fog;scene.remove(group);group.traverse(object=>{object.geometry?.dispose?.();for(const material of Array.isArray(object.material)?object.material:[object.material])material?.dispose?.();});}});
}
