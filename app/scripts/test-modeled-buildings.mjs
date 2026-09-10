import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';

const threeUrl=import.meta.resolve('three'),coreUrl=new URL('../public/vitriny-store-building-core.js',import.meta.url).href;
const code=readFileSync(new URL('../public/vitriny-modeled-buildings.js',import.meta.url),'utf8').replaceAll("'/vendor/three/three.module.js'",JSON.stringify(threeUrl)).replaceAll("'./vitriny-store-building-core.js'",JSON.stringify(coreUrl));
const {mountModeledBuildings,validateModeledRetail,MODELED_RETAIL_ASSETS,MODELED_RETAIL_LAYOUT}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
function model(){
  const scene=new THREE.Group(),material=new THREE.MeshStandardMaterial({color:'#426b89'});material.name='VC_Accent';
  const body=new THREE.Mesh(new THREE.BoxGeometry(24,29,18),material);body.position.y=14.5;scene.add(body);return {scene,body};
}
function store(name='Galeria local',reference='fixture'){
  const parent=new THREE.Group(),fallback=new THREE.Group(),display=new THREE.Group();parent.rotation.y=-Math.PI/2;parent.position.set(-126,0,145);
  parent.userData={store:true,href:'/loja/'+reference,interiorHref:'/vitriny-store-interior.html?store='+reference,reference};
  display.userData={storefrontItem:true,href:'/produto/produto-real'};parent.add(fallback,display);
  const entity={name,reference,size:{width:24,depth:18,height:9}};return {parent,fallback,display,entity};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const noSign=()=>{};

test('GLB loading keeps the live fallback, store identity, products and doorway until success',async()=>{
  const pending=deferred(),f=store(),asset=model(),layouts=[],removed=[];
  const manager=mountModeledBuildings({loadModel:()=>pending.promise,createSign:noSign,disposeFallback:group=>removed.push(group),shadows:true});
  const identity=f.parent.userData,anchor=f.parent.localToWorld(new THREE.Vector3(0,2.5,9.4));
  const result=manager.mountStore(f.parent,f.entity,f.fallback,{onReady:layout=>layouts.push(layout)});
  assert.equal(f.fallback.parent,f.parent);assert.equal(f.parent.userData.architecture.status,'loading');
  pending.resolve(asset);const ready=await result;
  assert.equal(ready.status,'ready');assert.equal(f.fallback.parent,null);assert.deepEqual(removed,[f.fallback]);
  assert.equal(f.parent.userData,identity);assert.equal(f.parent.userData.reference,'fixture');assert.equal(f.display.parent,f.parent);
  assert.deepEqual(f.parent.localToWorld(new THREE.Vector3(0,2.5,9.4)).toArray(),anchor.toArray());
  assert.deepEqual(layouts,[MODELED_RETAIL_LAYOUT]);assert.equal(f.parent.userData.architecture.source,'blender-glb');
  assert.equal(ready.group.children[0].children[0].castShadow,true);
  manager.dispose();assert.equal(ready.group.parent,null);assert.equal(f.display.parent,f.parent);
});

test('multiple stores coalesce each asset load and share geometry while retaining independent accents',async()=>{
  const assets=[],urls=[],fixtures=[store('Loja Azul','one'),store('Centro Educacional','two'),store('Beemi','three'),store('Loja Azul','four'),store('Agrotécnica','five'),store('Sertaneja','six')];
  const manager=mountModeledBuildings({createSign:noSign,loadModel:async url=>{urls.push(url);const asset=model();asset.body.material.name='VC_Accent.002';assets.push(asset);return asset;}});
  const results=await Promise.all(fixtures.map(f=>manager.mountStore(f.parent,f.entity,f.fallback)));
  assert.equal(urls.length,3);assert.deepEqual(new Set(urls),new Set(Object.values(MODELED_RETAIL_ASSETS)));
  const meshes=results.map(result=>result.group.children[0].children[0]);
  assert.equal(meshes[0].geometry,meshes[1].geometry);assert.equal(meshes[0].material,meshes[3].material);
  assert.notEqual(meshes[0].material,meshes[1].material);assert.notEqual(meshes[0].material,meshes[2].material);
  assert.equal(meshes[0].material.color.getHexString(),'426b89');assert.equal(meshes[1].material.color.getHexString(),'245d78');assert.equal(meshes[2].material.color.getHexString(),'714852');
  assert.equal(meshes[4].material.color.getHexString(),'256348');assert.equal(meshes[5].material.color.getHexString(),'a55738');
  const counts=new Map();for(const asset of assets)for(const resource of [asset.body.geometry,asset.body.material])resource.addEventListener('dispose',()=>counts.set(resource,(counts.get(resource)||0)+1));
  for(const mesh of meshes)if(!counts.has(mesh.material)){counts.set(mesh.material,0);mesh.material.addEventListener('dispose',()=>counts.set(mesh.material,counts.get(mesh.material)+1));}
  manager.dispose();manager.dispose();for(const count of counts.values())assert.equal(count,1);
});

test('missing or invalid GLBs keep every fallback and never alter product billboards',async()=>{
  let requests=0,layouts=0;const manager=mountModeledBuildings({createSign:noSign,loadModel:async()=>{requests++;throw new Error('404');}});
  const fixtures=[store('Loja','one'),store('Loja','two')];
  const states=await Promise.all(fixtures.map(f=>manager.mountStore(f.parent,f.entity,f.fallback,{onReady:()=>layouts++})));
  assert.equal(requests,1);assert.equal(layouts,0);
  for(const [i,state] of states.entries()){assert.equal(state.status,'fallback');assert.equal(fixtures[i].fallback.parent,fixtures[i].parent);assert.equal(fixtures[i].parent.userData.architecture.status,'unavailable');}
  manager.dispose();
  const asset=model();asset.body.scale.x=20;let geometryDisposals=0;asset.body.geometry.addEventListener('dispose',()=>geometryDisposals++);
  const invalid=mountModeledBuildings({createSign:noSign,loadModel:async()=>asset}),f=store();
  assert.equal((await invalid.mountStore(f.parent,f.entity,f.fallback)).status,'fallback');assert.equal(f.fallback.parent,f.parent);assert.equal(geometryDisposals,1);invalid.dispose();assert.equal(geometryDisposals,1);
});

test('a late GLB response after disposal releases its resources without resurrecting stores',async()=>{
  const pending=deferred(),asset=model(),f=store();let geometryDisposals=0,materialDisposals=0,layouts=0;
  asset.body.geometry.addEventListener('dispose',()=>geometryDisposals++);asset.body.material.addEventListener('dispose',()=>materialDisposals++);
  const manager=mountModeledBuildings({loadModel:()=>pending.promise,createSign:noSign});
  const loading=manager.mountStore(f.parent,f.entity,f.fallback,{onReady:()=>layouts++});
  manager.dispose();pending.resolve(asset);
  assert.equal((await loading).status,'disposed');assert.equal(layouts,0);assert.equal(geometryDisposals,1);assert.equal(materialDisposals,1);assert.equal(f.fallback.parent,f.parent);
});

test('a store detached while loading is not restored by its pending model',async()=>{
  const pending=deferred(),f=store(),manager=mountModeledBuildings({loadModel:()=>pending.promise,createSign:noSign});
  const world=new THREE.Scene();world.add(f.parent);
  const loading=manager.mountStore(f.parent,f.entity,f.fallback);f.parent.removeFromParent();pending.resolve(model());
  assert.equal((await loading).status,'detached');assert.equal(f.parent.children.length,2);assert.equal(world.children.length,0);manager.dispose();
});

test('retail model geometry rejects nonfinite positions and excessive draw cost',()=>{
  const invalid=model();invalid.body.geometry.attributes.position.array[0]=NaN;assert.throws(()=>validateModeledRetail(invalid.scene),/Invalid architectural geometry/);
  const excessive=model();for(let i=0;i<32;i++)excessive.scene.add(excessive.body.clone());assert.throws(()=>validateModeledRetail(excessive.scene),/lot contract/);
  const okay=model();assert.deepEqual(validateModeledRetail(okay.scene),{meshes:1,triangles:12,drawCalls:1,height:29});
});
