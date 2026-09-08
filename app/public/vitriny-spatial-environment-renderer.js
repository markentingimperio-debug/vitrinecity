import * as THREE from '/vendor/three/three.module.js';
import {fetchSpatialEnvironment} from './vitriny-spatial-environment-client.js';

const ACCENTS=['#6ee7ff','#8f8cff','#e48cff','#ffb36b','#85e6a8','#6f9cff','#b58cff','#6edbcf'];
function color(value,fallback){try{return new THREE.Color(String(value||fallback));}catch{return new THREE.Color(fallback);}}
function instanced(group,geometry,material,count,name){const mesh=new THREE.InstancedMesh(geometry,material,count);mesh.name=name;mesh.frustumCulled=true;group.add(mesh);return mesh;}
function setTransform(mesh,index,{x=0,y=0,z=0,sx=1,sy=1,sz=1,ry=0},matrix,quaternion,scale,position){position.set(x,y,z);quaternion.setFromEuler(new THREE.Euler(0,ry,0));scale.set(sx,sy,sz);matrix.compose(position,quaternion,scale);mesh.setMatrixAt(index,matrix);}

export async function mountSpatialCityEnvironment({scene,cityId,identity,profileId='STANDARD',shadows=false,fetchImpl=globalThis.fetch}={}){
  if(!scene?.add)throw new TypeError('spatial_environment_scene_required');
  const environment=await fetchSpatialEnvironment({cityId,profileId,fetchImpl});
  const group=new THREE.Group();group.name=`city-environment:${environment.cityId}:${environment.profileId}`;
  group.userData={spatialEnvironment:true,cityId:environment.cityId,profileId:environment.profileId};
  const accent=color(identity?.palette?.accent,'#6ee7ff'),secondary=color(identity?.palette?.secondary,'#8f8cff');
  const matrix=new THREE.Matrix4(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3(),position=new THREE.Vector3();

  if(environment.skyline.length){
    const geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial({color:'#172334',metalness:.52,roughness:.32,vertexColors:true});
    const skyline=instanced(group,geometry,material,environment.skyline.length,'themed-skyline');skyline.castShadow=Boolean(shadows);skyline.receiveShadow=Boolean(shadows);
    environment.skyline.forEach((item,index)=>{
      setTransform(skyline,index,{x:item.position.x,y:item.size.height/2,z:item.position.z,sx:item.size.width,sy:item.size.height,sz:item.size.depth,ry:item.rotationY},matrix,quaternion,scale,position);
      const base=color(ACCENTS[item.accentIndex],identity?.palette?.accent||'#6ee7ff');base.lerp(index%2?secondary:accent,.34+item.windowDensity*.22);skyline.setColorAt(index,base);
    });
    skyline.instanceMatrix.needsUpdate=true;if(skyline.instanceColor)skyline.instanceColor.needsUpdate=true;
  }

  if(environment.vegetation.length){
    const trunk=instanced(group,new THREE.CylinderGeometry(.18,.28,1,profileId==='LITE'?5:7),new THREE.MeshStandardMaterial({color:'#4e4031',roughness:.88}),environment.vegetation.length,'urban-green-trunks');
    const crown=instanced(group,new THREE.SphereGeometry(1,profileId==='LITE'?6:10,profileId==='LITE'?5:7),new THREE.MeshStandardMaterial({color:'#2f714f',roughness:.82,vertexColors:true}),environment.vegetation.length,'urban-green-crowns');
    environment.vegetation.forEach((item,index)=>{
      const h=(item.kind==='palm'?5.8:item.kind==='cerrado-tree'?4.3:3.8)*item.scale,crownY=h+(item.kind==='garden'?.8:1.6)*item.scale;
      setTransform(trunk,index,{x:item.position.x,y:h/2,z:item.position.z,sx:item.kind==='palm'?.65:1,sy:h,sz:item.kind==='palm'?.65:1},matrix,quaternion,scale,position);
      setTransform(crown,index,{x:item.position.x,y:crownY,z:item.position.z,sx:(item.kind==='garden'?1.7:2.2)*item.scale,sy:(item.kind==='canopy'?1.1:1.6)*item.scale,sz:(item.kind==='garden'?1.7:2.2)*item.scale},matrix,quaternion,scale,position);
      const c=color(item.kind==='cerrado-tree'?'#6f9b55':item.kind==='palm'?'#3f8f66':'#3d7f58','#3d7f58');c.lerp(accent,.08);crown.setColorAt(index,c);
    });
    trunk.instanceMatrix.needsUpdate=true;crown.instanceMatrix.needsUpdate=true;if(crown.instanceColor)crown.instanceColor.needsUpdate=true;
  }

  if(environment.lights.length){
    const poles=instanced(group,new THREE.CylinderGeometry(.07,.09,1,6),new THREE.MeshStandardMaterial({color:'#26384a',metalness:.65,roughness:.28}),environment.lights.length,'urban-light-poles');
    const bulbs=instanced(group,new THREE.SphereGeometry(.24,profileId==='LITE'?6:10,profileId==='LITE'?4:7),new THREE.MeshBasicMaterial({color:identity?.palette?.accent||'#6ee7ff'}),environment.lights.length,'urban-light-bulbs');
    environment.lights.forEach((item,index)=>{
      setTransform(poles,index,{x:item.position.x,y:item.height/2,z:item.position.z,sy:item.height},matrix,quaternion,scale,position);
      setTransform(bulbs,index,{x:item.position.x,y:item.height+.12,z:item.position.z,sx:.8+item.intensity*.35,sy:.8+item.intensity*.35,sz:.8+item.intensity*.35},matrix,quaternion,scale,position);
    });poles.instanceMatrix.needsUpdate=true;bulbs.instanceMatrix.needsUpdate=true;
  }

  if(environment.furniture.length){
    const furniture=instanced(group,new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:'#263646',metalness:.24,roughness:.58}),environment.furniture.length,'urban-furniture');
    environment.furniture.forEach((item,index)=>{
      const kiosk=item.kind==='kiosk',seat=item.kind==='garden-seat'||item.kind==='transit-seat';
      setTransform(furniture,index,{x:item.position.x,y:kiosk?1.4:.45,z:item.position.z,sx:kiosk?2.3:seat?2.5:2.8,sy:kiosk?2.8:.5,sz:kiosk?2.3:.8,ry:item.rotationY},matrix,quaternion,scale,position);
    });furniture.instanceMatrix.needsUpdate=true;
  }

  const premium=new THREE.Mesh(new THREE.RingGeometry(122,154,profileId==='LITE'?48:96),new THREE.MeshBasicMaterial({color:identity?.palette?.secondary||'#8f8cff',transparent:true,opacity:.035,side:THREE.DoubleSide,depthWrite:false}));premium.rotation.x=-Math.PI/2;premium.position.y=.015;premium.name='premium-zone-ring';group.add(premium);
  scene.add(group);
  return Object.freeze({group,environment,dispose(){scene.remove(group);group.traverse(object=>{object.geometry?.dispose?.();for(const material of Array.isArray(object.material)?object.material:[object.material])material?.dispose?.();});}});
}
