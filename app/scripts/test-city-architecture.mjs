import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
const threeUrl=import.meta.resolve('three');
const load=async name=>import('data:text/javascript;base64,'+Buffer.from(readFileSync(new URL('../public/'+name,import.meta.url),'utf8').replaceAll("'/vendor/three/three.module.js'",JSON.stringify(threeUrl))).toString('base64'));
const {roundedFootprintGeometry,batchArchitecturalParts,leafyCanopyGeometry}=await load('vitriny-architectural-geometry.js');
const {createUrbanPerson,createUrbanCrowd}=await load('vitriny-urban-models.js');

test('rounded buildings preserve their lot dimensions and have finite surfaces at both quality levels',()=>{
  for(const segments of [3,6])for(const [w,d,r] of [[24,18,2.6],[46,36,5],[1,.08,.025]]){
    const g=roundedFootprintGeometry(w,d,r,segments);g.computeBoundingBox();const size=g.boundingBox.getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.x-w)<1e-5&&Math.abs(size.z-d)<1e-5&&Math.abs(size.y-1)<1e-5);
    for(const a of Object.values(g.attributes))assert.ok([...a.array].every(Number.isFinite));g.dispose();
  }
  for(const lite of [true,false]){const g=leafyCanopyGeometry(lite);assert.ok(g.attributes.position.count<1500);assert.ok([...g.attributes.normal.array].every(Number.isFinite));g.dispose();}
});

test('batching preserves positions under rotated stores and keeps photograph click targets intact',()=>{
  const parent=new THREE.Group();parent.position.set(-126,0,145);parent.rotation.y=-Math.PI/2;
  const store=new THREE.Group();store.userData={store:true,reference:'real-store',href:'/loja/real-store'};parent.add(store);
  const geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial(),original=[];
  for(let i=0;i<6;i++){const tree=new THREE.Group();tree.position.set(i*3,4,-7);store.add(tree);const part=new THREE.Mesh(geometry,material);part.position.set(.5,2,1);part.userData.architecturalPart=true;tree.add(part);original.push(part);}
  const board=new THREE.Group();board.userData.billboard=true;store.add(board);
  const photo=new THREE.Mesh(geometry,material);photo.userData.architecturalPart=true;board.add(photo);
  parent.updateMatrixWorld(true);const before=original.map(p=>p.matrixWorld.clone());assert.equal(batchArchitecturalParts(store),5);
  parent.updateMatrixWorld(true);const batch=store.children.find(p=>p.isInstancedMesh);assert.equal(batch.count,6);assert.equal(photo.parent,board);
  for(let i=0;i<6;i++){const matrix=new THREE.Matrix4();batch.getMatrixAt(i,matrix);matrix.premultiply(batch.matrixWorld);for(let j=0;j<16;j++)assert.ok(Math.abs(matrix.elements[j]-before[i].elements[j])<1e-5);}
  assert.equal(store.userData.href,'/loja/real-store');geometry.dispose();material.dispose();
});

test('human models have adult scale, faces, articulated knees and a bounded instanced crowd',()=>{
  const person=createUrbanPerson();person.group.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(person.group).getSize(new THREE.Vector3());
  assert.ok(bounds.y>1.7&&bounds.y<1.9);assert.ok(bounds.x<.75);person.pose(Math.PI/2,true);assert.ok(person.knees.some(k=>k.rotation.x>.1));
  const parent=new THREE.Group(),crowd=createUrbanCrowd({parent,count:24});crowd.people.forEach((p,i)=>{p.group.position.set(i,.3,2);p.pose(i,true);});crowd.update();
  assert.ok(parent.children.length<=4,'Population must stay instanced rather than adding one draw call per facial part');
  for(const batch of parent.children)assert.ok([...batch.instanceMatrix.array].every(Number.isFinite));crowd.dispose();
});
