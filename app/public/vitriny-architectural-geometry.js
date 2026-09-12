import * as THREE from '/vendor/three/three.module.js';

export function leafyCanopyGeometry(lite=false){
  const vertices=[],colors=[],count=lite?110:210;
  for(let i=0;i<count;i++){
    const u=(i*.754877666)%1,v=(i*.569840296)%1,azimuth=u*Math.PI*2,elevation=Math.acos(2*v-1),radius=.25+.8*((i*.438579)%1);
    const center=new THREE.Vector3(Math.sin(elevation)*Math.cos(azimuth)*radius,Math.cos(elevation)*radius*.88,Math.sin(elevation)*Math.sin(azimuth)*radius);
    const right=new THREE.Vector3(Math.cos(azimuth),.3,Math.sin(azimuth)).normalize().multiplyScalar(.10+(i%4)*.025),up=new THREE.Vector3(-Math.sin(azimuth)*.5,1,Math.cos(azimuth)*.5).normalize().multiplyScalar(.19+(i%5)*.027);
    const points=[center.clone().sub(up),center.clone().add(right),center.clone().add(up),center.clone().sub(right)];
    for(const index of [0,1,2,0,2,3]){vertices.push(...points[index].toArray());const shade=.74+(i%7)*.045;colors.push(shade,shade,.85*shade);}
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.computeVertexNormals();return geometry;
}

// A rounded footprint, extruded vertically. Vertical dimensions never distort its corners.
export function roundedFootprintGeometry(width, depth, radius = 1, segments = 5) {
  const w=Math.max(.01,width),d=Math.max(.01,depth),r=Math.max(.001,Math.min(radius,w/2-.001,d/2-.001));
  const x=-w/2,z=-d/2,shape=new THREE.Shape();
  shape.moveTo(x+r,z);shape.lineTo(x+w-r,z);shape.quadraticCurveTo(x+w,z,x+w,z+r);
  shape.lineTo(x+w,z+d-r);shape.quadraticCurveTo(x+w,z+d,x+w-r,z+d);
  shape.lineTo(x+r,z+d);shape.quadraticCurveTo(x,z+d,x,z+d-r);
  shape.lineTo(x,z+r);shape.quadraticCurveTo(x,z,x+r,z);
  const geometry=new THREE.ExtrudeGeometry(shape,{depth:1,bevelEnabled:false,steps:1,curveSegments:segments});
  geometry.rotateX(-Math.PI/2);geometry.translate(0,-.5,0);geometry.computeVertexNormals();
  const p=geometry.attributes.position,n=geometry.attributes.normal,uv=geometry.attributes.uv;
  for(let i=0;i<p.count;i++){
    if(Math.abs(n.getY(i))>.9)uv.setXY(i,p.getX(i)/w+.5,p.getZ(i)/d+.5);
    else uv.setXY(i,Math.abs(n.getX(i))>.5?p.getZ(i)/8:p.getX(i)/8,p.getY(i)+.5);
  }
  return geometry;
}

// Batch only static kit pieces beneath their existing semantic parent. Store doors,
// billboard photographs, animated objects and their click targets stay independent.
export function batchArchitecturalParts(root) {
  root.updateWorldMatrix(true,true);
  const buckets=new Map(),inverse=new THREE.Matrix4().copy(root.matrixWorld).invert();
  root.traverse(object=>{
    if(!object.isMesh||object.isInstancedMesh||!object.userData.architecturalPart||!object.visible||object.material.transparent)return;
    let parent=object.parent;
    while(parent&&parent!==root){if(Object.keys(parent.userData).some(k=>['storefrontItem','billboard','store','portal'].includes(k)))return;parent=parent.parent;}
    const key=[object.geometry.uuid,object.material.uuid,object.castShadow,object.receiveShadow].join(':');
    if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(object);
  });
  let saved=0;
  for(const objects of buckets.values()){
    if(objects.length<3)continue;
    const first=objects[0],batch=new THREE.InstancedMesh(first.geometry,first.material,objects.length);
    batch.name='architecture-batch';batch.castShadow=first.castShadow;batch.receiveShadow=first.receiveShadow;
    objects.forEach((object,i)=>{batch.setMatrixAt(i,new THREE.Matrix4().multiplyMatrices(inverse,object.matrixWorld));object.removeFromParent();});
    batch.instanceMatrix.needsUpdate=true;batch.computeBoundingSphere();root.add(batch);saved+=objects.length-1;
  }
  return saved;
}
