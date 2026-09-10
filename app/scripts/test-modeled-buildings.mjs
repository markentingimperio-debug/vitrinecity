import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';

const threeUrl=import.meta.resolve('three'),coreUrl=new URL('../public/vitriny-store-building-core.js',import.meta.url).href;
const code=readFileSync(new URL('../public/vitriny-modeled-buildings.js',import.meta.url),'utf8').replaceAll("'/vendor/three/three.module.js'",JSON.stringify(threeUrl)).replaceAll("'./vitriny-store-building-core.js'",JSON.stringify(coreUrl));
const {mountModeledBuildings,validateModeledRetail,MODELED_RETAIL_ASSETS,MODELED_RETAIL_LAYOUT,AGROTECNICA_STORE_SIGN,createAgrotecnicaStoreSign}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
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

function signDocument(){
  const labels=[],document={createElement(){return {width:0,height:0,getContext(){return {clearRect(){},fillRect(){},fillText(label){labels.push(label);}};}};}};
  return {document,labels};
}

test('Agrotecnica category sign preserves the real shop destination and remains above the catalog',()=>{
  const parent=new THREE.Group(),{document,labels}=signDocument(),entity={name:'Agrotécnica',reference:'official_agrotecnica',href:'/loja/official_agrotecnica/agrotecnica'};
  const group=createAgrotecnicaStoreSign(parent,entity,{document}),face=group.children[0],spec=AGROTECNICA_STORE_SIGN;
  assert.deepEqual(labels,['ADUBO PARA PLANTAS','VER PRODUTOS →']);
  assert.equal(group.name,'store-sign:official_agrotecnica:adubo-para-plantas');assert.equal(group.userData.href,entity.href);assert.equal(group.userData.reference,entity.reference);assert.equal(group.userData.storeName,'Agrotécnica');
  assert.equal(group.userData.store,true);assert.equal(group.userData.storeSign,true);assert.deepEqual(face.userData,group.userData);
  assert.ok(spec.y-spec.height/2>MODELED_RETAIL_LAYOUT.y+MODELED_RETAIL_LAYOUT.height/2,'The category sign must not cover the product panel');
  assert.ok(spec.y+spec.height/2<29,'The category sign must stay below the roofline');
  parent.updateMatrixWorld(true);
  const hit=new THREE.Raycaster(new THREE.Vector3(0,spec.y,35),new THREE.Vector3(0,0,-1)).intersectObject(parent,true)[0];
  assert.equal(hit.object,face);assert.equal(hit.object.userData.href,entity.href);
  const texture=face.material.map;assert.ok(Math.abs(texture.image.width/texture.image.height-spec.width/spec.height)<.03,'Canvas must preserve physical lettering proportions');
  texture.dispose();face.material.dispose();face.geometry.dispose();
});

test('only the official Agrotecnica receives the category sign with a safe internal destination',()=>{
  const parent=new THREE.Group(),{document}=signDocument();
  for(const entity of [{reference:'other_store',href:'/loja/other_store'},{reference:'official_agrotecnica'},{reference:'official_agrotecnica',href:'https://example.com/store'},{reference:'official_agrotecnica',href:'//example.com/store'},{reference:'official_agrotecnica',href:'/loja/one\\two'}])assert.equal(createAgrotecnicaStoreSign(parent,entity,{document}),null);
  assert.equal(parent.children.length,0);
});

test('Agrotecnica keeps its original name and disposes both signs with the modeled building',async()=>{
  const priorDocument=globalThis.document,{document,labels}=signDocument();globalThis.document=document;
  const f=store('Agrotécnica','official_agrotecnica');f.entity.href='/loja/official_agrotecnica/agrotecnica';
  const manager=mountModeledBuildings({loadModel:async()=>model()});
  try{
    const result=await manager.mountStore(f.parent,f.entity,f.fallback);assert.equal(result.status,'ready');
    assert.deepEqual(labels,['Agrotécnica','ADUBO PARA PLANTAS','VER PRODUTOS →']);
    const group=result.group.getObjectByName('modeled-store-name'),counts=new Map();let meshes=0;
    group.traverse(object=>{if(!object.isMesh)return;meshes++;for(const resource of [object.geometry,object.material,object.material.map]){counts.set(resource,0);resource.addEventListener('dispose',()=>counts.set(resource,counts.get(resource)+1));}});
    assert.equal(meshes,2);manager.dispose();manager.dispose();for(const count of counts.values())assert.equal(count,1);assert.equal(result.group.parent,null);
  }finally{manager.dispose();globalThis.document=priorDocument;}
});
