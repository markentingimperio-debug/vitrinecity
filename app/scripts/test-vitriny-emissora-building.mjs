import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {EMISSORA_BUILDING,intersectsEmissoraLot} from '../public/vitriny-emissora-core.js';
import {CITY_GUIDE_ITEMS,filterCityGuide} from '../public/vitriny-city-guide-core.js';
import {arrangeStoreBuildings} from '../public/vitriny-store-building-core.js';
import {createDoorEntryTracker} from '../public/vitriny-door-entry.js';

const source=await fs.readFile(new URL('../public/vitriny-emissora-building.js',import.meta.url),'utf8');
const {mountEmissoraBuilding}=await import('data:text/javascript;base64,'+Buffer.from(source
  .replace("'/vendor/three/three.module.js'",JSON.stringify(import.meta.resolve('three')))
  .replace("'./vitriny-emissora-core.js'",JSON.stringify(new URL('../public/vitriny-emissora-core.js',import.meta.url).href))).toString('base64'));

function mount(){
  const scene=new THREE.Scene(),box=new THREE.BoxGeometry(1,1,1),signs=[],parts=[];
  const architecture=Object.fromEntries(['stone','graphite','brass','warm','glass'].map(name=>[name,new THREE.MeshBasicMaterial()]));
  architecture.part=(parent,material,x,y,z,w,h,d)=>{const mesh=new THREE.Mesh(box,material);mesh.position.set(x,y,z);mesh.scale.set(w,h,d);parent.add(mesh);parts.push(mesh);return mesh;};
  architecture.textSign=(parent,label,options)=>{const mesh=new THREE.Mesh(new THREE.PlaneGeometry(options.width,options.height),architecture.graphite);mesh.position.set(0,options.y,options.z);parent.add(mesh);signs.push({label,...options});return mesh;};
  const group=mountEmissoraBuilding({scene,architecture});return {scene,group,box,signs,parts,architecture};
}

test('public guide names the emissora, supports topic searches and links directly without an account action',()=>{
  const items=CITY_GUIDE_ITEMS.filter(item=>item.id==='emissora');assert.equal(items.length,1);
  assert.equal(items[0].href,'/emissora');assert.equal(items[0].place,'emissora');assert.equal(items[0].action,undefined);
  for(const query of ['emissora','editorial','noticias','esportes','receitas'])assert.ok(filterCityGuide(query).some(item=>item.id==='emissora'));
  assert.ok(!/ao vivo|transmissão|24 horas/i.test(items[0].description));
});

test('dedicated lot excludes procedural buildings while keeping the plaza, venues and store expansion clear',()=>{
  const lot=EMISSORA_BUILDING;
  assert.equal(intersectsEmissoraLot({position:lot.position,size:{width:12,depth:12}}),true);
  assert.equal(intersectsEmissoraLot({position:{x:lot.position.x+35,z:lot.position.z},size:{width:20,depth:20}}),true);
  for(const venue of [
    {position:{x:0,z:0},size:{width:160,depth:160}},
    {position:{x:0,z:100},size:{width:620,depth:25}},
    {position:{x:116,z:154},size:{width:74,depth:52}},
    {position:{x:-57,z:196},size:{width:66,depth:48}},
    {position:{x:4,z:151},size:{width:52,depth:30}}
  ])assert.equal(intersectsEmissoraLot(venue),false);
  const stores=arrangeStoreBuildings(Array.from({length:48},(_,i)=>({reference:'store-'+String(i).padStart(2,'0'),name:'Loja '+i,size:{width:24,depth:18},position:{x:0,z:0}})));
  for(const store of stores)assert.equal(intersectsEmissoraLot(store),false);
  assert.equal(intersectsEmissoraLot(null),false);
});

test('building shares existing geometry/materials and uses only two static legible signs',()=>{
  const {scene,group,parts,box,signs,architecture}=mount(),lot=EMISSORA_BUILDING;
  assert.equal(scene.children.length,1);assert.equal(group.userData.href,'/emissora');assert.equal(group.userData.store,true);
  assert.deepEqual(group.position.toArray(),[lot.position.x,0,lot.position.z]);
  assert.ok(parts.length<=45,`${parts.length} parts exceed the small venue budget`);assert.ok(parts.every(part=>part.geometry===box&&Object.values(architecture).includes(part.material)));
  assert.equal(signs.length,2);assert.equal(signs[0].label,'EMISSORA VITRINECITY');assert.ok(signs[0].width>=40);assert.equal(signs[1].label,'ABRIR EMISSORA');
  const bounds=new THREE.Box3().setFromObject(group);assert.ok(bounds.min.x>=lot.position.x-lot.size.width/2-.01&&bounds.max.x<=lot.position.x+lot.size.width/2+.01);assert.ok(bounds.min.z>=lot.position.z-lot.size.depth/2-.01&&bounds.max.z<=lot.position.z+lot.size.depth/2+.01);assert.ok(bounds.max.y<40);
});

test('existing door tracker enters the correct destination when walking toward the rotated facade',()=>{
  const {group}=mount(),config=EMISSORA_BUILDING.entrance;
  const anchor=group.localToWorld(new THREE.Vector3(config.x,config.y,config.z)),normal=new THREE.Vector3(0,0,1).transformDirection(group.matrixWorld);
  const door={anchor,normal,href:group.userData.href,reference:group.userData.reference},tracker=createDoorEntryTracker(),point=distance=>anchor.clone().addScaledVector(normal,distance);
  assert.equal(tracker.step({position:point(3),moving:true,enabled:true,doors:[door]}),null);
  assert.equal(tracker.step({position:point(1.5),moving:true,enabled:true,doors:[door]}),door);
  tracker.reset();assert.equal(tracker.step({position:point(1),moving:false,enabled:true,doors:[door]}),null);
});
