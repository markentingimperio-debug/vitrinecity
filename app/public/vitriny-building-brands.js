import * as THREE from '/vendor/three/three.module.js';

// Brand names come from the existing building/store registry. No remote artwork
// or inferred merchant identity is needed to identify a building from above.
export function mountBuildingBrands({scene,lite=false,document=globalThis.document}={}){
  const root=new THREE.Group();root.name='floating-building-brands';scene.add(root);
  const entries=new Map(),resources=new Set(),world=new THREE.Vector3(),bounds=new THREE.Box3();
  const orientation=new THREE.Quaternion(),frustum=new THREE.Frustum(),projection=new THREE.Matrix4();let elapsed=0,disposed=false;
  const arcGeometry=new THREE.TorusGeometry(1,.024,5,lite?40:64,Math.PI*1.42),dotGeometry=new THREE.SphereGeometry(.047,8,6);
  resources.add(arcGeometry);resources.add(dotGeometry);
  function register(parent,{name=parent?.userData?.label,roof=null}={}){
    if(disposed||!parent?.isObject3D||typeof name!=='string'||!name.trim())return null;
    if(entries.has(parent))return entries.get(parent);
    name=name.trim().slice(0,120);parent.updateWorldMatrix(true,true);bounds.setFromObject(parent);parent.getWorldPosition(world);
    const height=Number.isFinite(roof)?world.y+roof:bounds.max.y;
    if(!Number.isFinite(height))return null;
    const size=bounds.getSize(new THREE.Vector3()),radius=Math.max(5,Math.min(8.5,Math.max(size.x,size.z)*.17));
    const marker=new THREE.Group();marker.name='building-brand:'+name;marker.userData={buildingBrand:true,label:name,reference:parent.userData.reference||parent.name};root.add(marker);
    const orbit=new THREE.Group();marker.add(orbit);
    const material=new THREE.MeshBasicMaterial({color:'#f8d384',transparent:true,opacity:.9,toneMapped:false,depthWrite:false});resources.add(material);
    for(const angle of [0,Math.PI]){const arc=new THREE.Mesh(arcGeometry,material);arc.rotation.z=angle;arc.scale.setScalar(radius*(angle? .92:1));orbit.add(arc);}
    for(const angle of [.1,Math.PI+.1]){const dot=new THREE.Mesh(dotGeometry,material);dot.scale.setScalar(radius);dot.position.set(Math.cos(angle)*radius,Math.sin(angle)*radius,0);orbit.add(dot);}
    const canvas=document.createElement('canvas');canvas.width=768;canvas.height=320;const ctx=canvas.getContext('2d');
    ctx.fillStyle='#102c30ed';ctx.strokeStyle='#dbc28a';ctx.lineWidth=3;ctx.beginPath();ctx.roundRect(2,26,764,268,40);ctx.fill();ctx.stroke();
    const lines=[];let line='';ctx.font='600 82px system-ui';
    for(const word of name.split(/\s+/)){const next=line?line+' '+word:word;if(line&&ctx.measureText(next).width>710){lines.push(line);line=word;}else line=next;}if(line)lines.push(line);
    const font=Math.min(82,Math.floor(220/Math.max(1,lines.length*1.15)));ctx.font=`600 ${font}px system-ui`;ctx.fillStyle='#fff5df';ctx.textAlign='center';ctx.textBaseline='middle';
    lines.forEach((text,i)=>ctx.fillText(text,384,160+(i-(lines.length-1)/2)*(font+6),710));
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;resources.add(texture);
    const labelMaterial=new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,toneMapped:false});resources.add(labelMaterial);
    const plane=new THREE.PlaneGeometry(radius*2.3,radius*.96);resources.add(plane);
    const label=new THREE.Mesh(plane,labelMaterial);label.position.z=.05;marker.add(label);
    const entry={parent,marker,orbit,radius,height,material,labelMaterial,distance:0,phase:entries.size*.77};entries.set(parent,entry);
    return entry;
  }
  function refresh(parent){const entry=entries.get(parent);if(!entry)return;bounds.setFromObject(parent);if(Number.isFinite(bounds.max.y))entry.height=bounds.max.y;}
  function tick(dt,{camera,paused=false}={}){
    if(disposed||!camera)return;if(!paused&&Number.isFinite(dt))elapsed+=Math.max(0,Math.min(dt,.1));
    camera.updateWorldMatrix(true,false);camera.getWorldQuaternion(orientation);projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);frustum.setFromProjectionMatrix(projection);
    const visible=[];
    for(const entry of entries.values()){
      const {parent,marker,radius}=entry;parent.getWorldPosition(world);
      marker.position.set(world.x,entry.height+radius+2.2+Math.sin(elapsed*.65+entry.phase)*.3,world.z);
      marker.quaternion.copy(orientation);entry.orbit.rotation.z=elapsed*.22+entry.phase;
      entry.distance=camera.position.distanceTo(marker.position);marker.visible=Boolean(parent.parent)&&entry.distance<(lite?310:430)&&frustum.intersectsSphere(new THREE.Sphere(marker.position,radius*1.4));
      if(marker.visible)visible.push(entry);
    }
    visible.sort((a,b)=>a.distance-b.distance);
    visible.forEach((entry,index)=>{entry.marker.visible=index<(lite?12:22);const opacity=Math.max(.36,Math.min(.95,1-(entry.distance-90)/460));entry.material.opacity=opacity;entry.labelMaterial.opacity=opacity;});
  }
  function dispose(){if(disposed)return;disposed=true;root.removeFromParent();for(const resource of resources)resource.dispose();resources.clear();entries.clear();}
  return {root,register,refresh,tick,dispose};
}
