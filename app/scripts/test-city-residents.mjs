import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import * as THREE from 'three';
import {CITY_RESIDENTS,RESIDENT_DEPARTMENTS,STUDIO_CHANNELS,createResidentCatalog,residentPose,intersectsResidentBuilding,safeResidentHref} from '../public/vitriny-city-residents-core.js';

test('fictional identities are fixed, immutable and cover every real catalog department',()=>{
  const catalog=createResidentCatalog();assert.deepEqual(catalog,createResidentCatalog());
  assert.equal(new Set(catalog.residents.map(p=>p.id)).size,catalog.residents.length);
  for(const department of catalog.departments){assert.ok(catalog.residents.some(p=>p.departmentId===department.id),department.id);assert.ok(safeResidentHref(department.href));}
  for(const person of CITY_RESIDENTS){assert.ok(Object.isFrozen(person.appearance));assert.equal(person.status,'unconnected');assert.match(person.taskLabel,/Sem tarefa registrada/);assert.ok(person.profession);}
  assert.equal(CITY_RESIDENTS.find(p=>p.id==='lia').profession,'Agente virtual de vendas');
  assert.equal(RESIDENT_DEPARTMENTS.find(d=>d.id==='neural').name,'Vitrine Neural');
});

test('public store guides have stable identities independent of order and no private fields',()=>{
  const a={reference:'official_a',name:'Loja A',href:'/loja/a',position:{x:180,z:32},instructions:'PRIVATE',email:'PRIVATE'},b={...a,reference:'official_b'};
  assert.deepEqual(createResidentCatalog([a,b]),createResidentCatalog([b,a]));
  assert.equal(createResidentCatalog([a,a]).residents.length,CITY_RESIDENTS.length+1);
  assert.ok(!JSON.stringify(createResidentCatalog([a])).includes('PRIVATE'));
  for(const href of ['javascript:alert(1)','//host/path','/api/admin/agents','/bad\\path'])assert.equal(createResidentCatalog([{...a,href}]).residents.length,CITY_RESIDENTS.length);
  assert.deepEqual(createResidentCatalog(null),createResidentCatalog());
  assert.equal(createResidentCatalog([{...a,position:{x:NaN,z:2}}]).residents.length,CITY_RESIDENTS.length);
});

test('studio contains three distinct units with only the user-provided public profile links',()=>{
  assert.deepEqual(STUDIO_CHANNELS.map(c=>c.href),['https://www.youtube.com/@agrotecnica362','https://www.instagram.com/agrotecniica/','https://www.tiktok.com/@agrotecnica5']);
  for(const platform of ['YouTube','Instagram','TikTok'])assert.ok(CITY_RESIDENTS.some(p=>p.departmentId==='studio'&&p.profession.includes(platform)));
});

test('simulation is bounded, deterministic and never claims learning or execution',()=>{
  for(const person of CITY_RESIDENTS){
    const d=RESIDENT_DEPARTMENTS.find(d=>d.id===person.departmentId);
    for(const elapsed of [0,2,12,23,10000]){
      const pose=residentPose(person,d,elapsed);assert.deepEqual(pose,residentPose(person,d,elapsed));
      assert.ok([pose.x,pose.z,pose.yaw].every(Number.isFinite));assert.match(pose.activity,/simulad/);
      assert.ok(Math.abs(pose.x-d.position.x)<4.1);assert.ok(Math.abs(pose.z-d.position.z-(d.newBuilding?20:0))<=1.41);
    }
  }
});

test('three new pavilions reserve their bounded lots without replacing existing public buildings',()=>{
  const newLots=RESIDENT_DEPARTMENTS.filter(d=>d.newBuilding);assert.equal(newLots.length,3);
  for(const d of newLots)assert.equal(intersectsResidentBuilding({position:d.position,size:{width:10,depth:10}}),true);
  assert.equal(intersectsResidentBuilding({position:{x:0,z:0},size:{width:10,depth:10}}),false);
  for(const path of ['neural-workspace.html','recursos-social.html','centro-educacional.html','vitriny-games.html'])assert.ok(existsSync(new URL('../public/'+path,import.meta.url)));
  assert.ok(readFileSync(new URL('../server.js',import.meta.url),'utf8').includes("'/receitas'"));
});

const threeURL=import.meta.resolve('three'),coreURL=new URL('../public/vitriny-city-residents-core.js',import.meta.url).href;
const dataModule=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const urbanURL=dataModule(readFileSync(new URL('../public/vitriny-urban-models.js',import.meta.url),'utf8').replaceAll("'/vendor/three/three.module.js'",JSON.stringify(threeURL)));
const sceneSource=readFileSync(new URL('../public/vitriny-city-residents-scene.js',import.meta.url),'utf8').replaceAll("'/vendor/three/three.module.js'",JSON.stringify(threeURL)).replaceAll("'./vitriny-urban-models.js?v=20260915-residents-1'",JSON.stringify(urbanURL)).replaceAll("'./vitriny-city-residents-core.js'",JSON.stringify(coreURL));
const {mountCityResidents}=await import(dataModule(sceneSource));
test('LITE scene uses bounded instancing and can select any resident without losing their identity',()=>{
  const scene=new THREE.Scene(),architecture={boutique(){},textSign(){return new THREE.Group();}},mounted=mountCityResidents({scene,architecture,profileId:'LITE'});
  const crowd=scene.getObjectByName('virtual-residents-simulation'),batches=()=>crowd.children.filter(c=>c.isInstancedMesh);
  assert.ok(batches().length<=4);const before=batches()[0].instanceMatrix.array.slice();mounted.tick(1,{paused:true});assert.deepEqual(batches()[0].instanceMatrix.array,before);
  mounted.tick(.1);assert.notDeepEqual(batches()[0].instanceMatrix.array,before);
  const last=CITY_RESIDENTS.at(-1),pose=mounted.select(last.id);assert.ok(pose);assert.ok(batches()[0].count<=16*100);
  assert.equal(mounted.venues.length,3);mounted.dispose();assert.equal(scene.getObjectByName('virtual-residents-simulation'),undefined);
});

test('directory and simulation contain no request, task mutation, generated text or token calls',()=>{
  for(const file of ['vitriny-city-residents.js','vitriny-city-residents-core.js','vitriny-city-residents-scene.js']){
    const text=readFileSync(new URL('../public/'+file,import.meta.url),'utf8');
    assert.doesNotMatch(text,/\bfetch\s*\(|XMLHttpRequest|sendBeacon|\/api\/admin|sales-agents|Math\.random\s*\(/);
  }
  const html=readFileSync(new URL('../public/vitriny-multiverse-explore.html',import.meta.url),'utf8');assert.match(html,/vitriny-city-residents\.js/);assert.match(html,/vitriny-city-residents\.css/);
});
