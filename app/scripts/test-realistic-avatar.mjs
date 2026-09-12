import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import * as THREE from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const source=readFileSync(new URL('../public/vitriny-realistic-avatar.js',import.meta.url),'utf8').replace("'/vendor/three/three.module.js'",JSON.stringify(import.meta.resolve('three')));
const {createRealisticVisitor,loadRealisticVisitor,REALISTIC_AVATAR_URL}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const bytes=readFileSync(new URL('../public/assets/avatars/vc-visitor-realistic-v1.glb',import.meta.url));
const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));const binary=()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
const load=()=>new GLTFLoader().parseAsync(binary(),'');

test('local avatar includes bounded geometry, complete skin weights, animations and recorded CC0 sources',()=>{
  assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length);assert.ok(bytes.length<1500000);
  assert.ok(json.meshes.length<=14);assert.equal(json.skins.length,1);assert.ok(json.skins[0].joints.length<=40);
  assert.deepEqual(json.animations.map(c=>c.name).sort(),['Idle','Walk']);
  const triangles=json.meshes.reduce((sum,mesh)=>sum+mesh.primitives.reduce((n,p)=>n+json.accessors[p.indices].count/3,0),0);assert.ok(triangles>20000&&triangles<40000);
  for(const buffer of json.buffers)assert.equal(buffer.uri,undefined);for(const image of json.images||[])assert.equal(image.uri,undefined);
  for(const node of json.nodes.filter(n=>n.mesh!==undefined)){assert.equal(node.skin,0,'Eyes, soles and footwear must follow the skeleton too');for(const p of json.meshes[node.mesh].primitives){assert.ok(p.attributes.JOINTS_0!==undefined);assert.ok(p.attributes.WEIGHTS_0!==undefined);}}
  const provenance=JSON.parse(readFileSync(new URL('../public/assets/avatars/manifest.json',import.meta.url),'utf8'));assert.equal(provenance.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(provenance.upstreamLicense,'CC0-1.0');assert.equal(provenance.upstreamRevision,'a8bc2d54ff0ac92e78ff71431b1023eda42bf482');
  assert.match(readFileSync(new URL('../public/assets/avatars/LICENSE-MAKEHUMAN-CC0.txt',import.meta.url),'utf8'),/CC0 1.0 Universal/);
});

test('real exported skin is finite and normalized, walks within human scale, and colors/premium stay independent',async()=>{
  const gltf=await load(),person=createRealisticVisitor(gltf);person.group.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(person.group);assert.ok(bounds.max.y>1.7&&bounds.max.y<1.95);assert.ok(bounds.min.y>-.12&&bounds.min.y<.08);
  person.group.traverse(o=>{if(!o.isSkinnedMesh)return;const weights=o.geometry.attributes.skinWeight;for(let i=0;i<weights.count;i++){const sum=weights.getX(i)+weights.getY(i)+weights.getZ(i)+weights.getW(i);assert.ok(Math.abs(sum-1)<.002);}for(const value of o.geometry.attributes.position.array)assert.ok(Number.isFinite(value));});
  const leg=person.group.getObjectByName('upperleg01L');assert.ok(leg);const rest=leg.quaternion.clone();for(let i=0;i<20;i++)person.tick(1/60,true);assert.ok(rest.angleTo(leg.quaternion)>.05);
  person.group.updateMatrixWorld(true);const walkBounds=new THREE.Box3().setFromObject(person.group);assert.ok(walkBounds.max.y<2&&walkBounds.min.y>-.18);assert.ok(walkBounds.max.z-walkBounds.min.z<1.3);
  person.setAppearance('#593a2a','#705c84');assert.equal(person.materials.skin[0].color.getHexString(),'593a2a');assert.equal(person.materials.shirt[0].color.getHexString(),'705c84');
  const orbit=[];person.group.traverse(o=>{if(o.material?.name?.startsWith('AvatarOrbit'))orbit.push(o);});assert.ok(orbit.length);assert.ok(orbit.every(o=>!o.visible));person.setPremium(true);assert.ok(orbit.every(o=>o.visible));person.setPremium(false);assert.ok(orbit.every(o=>!o.visible));assert.equal(person.materials.shirt[0].color.getHexString(),'705c84');
  const skeletons=new Set();person.group.traverse(o=>{if(o.skeleton)skeletons.add(o.skeleton);});let disposedBoneTextures=0;
  for(const skeleton of skeletons){skeleton.computeBoneTexture();skeleton.boneTexture.addEventListener('dispose',()=>disposedBoneTextures++);}
  person.dispose();person.dispose();assert.equal(disposedBoneTextures,skeletons.size,'Shared skeleton GPU textures must be released exactly once');
});

test('first-party loader rejects failed or malformed downloads and accepts the actual embedded GLB',async()=>{
  await assert.rejects(()=>loadRealisticVisitor({fetchImpl:async()=>({ok:false})}),/avatar_asset_unavailable/);
  await assert.rejects(()=>loadRealisticVisitor({fetchImpl:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(50)})}),/avatar_asset_invalid/);
  let calls=0;const person=await loadRealisticVisitor({fetchImpl:async(url,options)=>{calls++;assert.equal(url,REALISTIC_AVATAR_URL);assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');return {ok:true,arrayBuffer:async()=>binary()};},makeLoader:async()=>new GLTFLoader()});assert.equal(calls,1);person.dispose();
  assert.throws(()=>createRealisticVisitor({scene:new THREE.Group(),animations:[]}),/avatar_rig_invalid/);
});
