import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
const code=readFileSync(new URL('../public/vitriny-building-brands.js',import.meta.url),'utf8').replace("'/vendor/three/three.module.js'",JSON.stringify(import.meta.resolve('three')));
const {mountBuildingBrands}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const texts=[],document={createElement:()=>({getContext:()=>({beginPath(){},roundRect(){},fill(){},stroke(){},measureText:t=>({width:t.length*40}),fillText:t=>texts.push(t)})})};
function fixture(){const scene=new THREE.Scene(),parent=new THREE.Group();parent.userData={label:'Agrotécnica · Plantas',reference:'store-1'};const body=new THREE.Mesh(new THREE.BoxGeometry(20,30,16));body.position.y=15;parent.add(body);scene.add(parent);const camera=new THREE.PerspectiveCamera(55,1,.1,1000);camera.position.set(0,40,95);camera.lookAt(0,35,0);return {scene,parent,body,camera};}
test('floating brand preserves store identity, remains above the roof and faces the camera',()=>{
  const f=fixture(),brands=mountBuildingBrands({scene:f.scene,document}),entry=brands.register(f.parent);brands.tick(.05,{camera:f.camera});
  assert.equal(entry.marker.userData.label,f.parent.userData.label);assert.equal(entry.marker.userData.reference,'store-1');assert.ok(texts.join(' ').includes('Agrotécnica'));
  assert.ok(entry.marker.position.y-entry.radius>30);assert.equal(entry.marker.visible,true);assert.ok(entry.marker.quaternion.angleTo(f.camera.quaternion)<.00001);
  assert.equal(brands.register(f.parent),entry,'Duplicate registration never creates another ring');assert.equal(brands.root.children.length,1);
  const rotation=entry.orbit.rotation.z,y=entry.marker.position.y;brands.tick(.1,{camera:f.camera,paused:true});assert.equal(entry.orbit.rotation.z,rotation);assert.equal(entry.marker.position.y,y);
  brands.tick(.1,{camera:f.camera});assert.notEqual(entry.orbit.rotation.z,rotation);
  f.body.scale.y=2;brands.refresh(f.parent);brands.tick(0,{camera:f.camera});assert.ok(entry.marker.position.y-entry.radius>45);
  f.scene.remove(f.parent);brands.tick(0,{camera:f.camera});assert.equal(entry.marker.visible,false);
  brands.dispose();assert.equal(brands.root.parent,null);assert.doesNotThrow(()=>brands.dispose());assert.equal(brands.register(f.parent),null);
});
test('unnamed buildings are not assigned invented brands and distant markers are culled',()=>{
  const f=fixture(),brands=mountBuildingBrands({scene:f.scene,document,lite:true});assert.equal(brands.register(new THREE.Group()),null);
  const entry=brands.register(f.parent);f.parent.position.z=-600;brands.tick(0,{camera:f.camera});assert.equal(entry.marker.visible,false);brands.dispose();
});
