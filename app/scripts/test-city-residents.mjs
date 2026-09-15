import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import * as THREE from 'three';
import {CITY_RESIDENTS,RESIDENT_DEPARTMENTS,RESIDENT_SPECIALTIES,STUDIO_CHANNELS,createResidentCatalog,residentPose,residentDesk,residentVisibleRoster,residentConversation,intersectsResidentBuilding,safeResidentHref} from '../public/vitriny-city-residents-core.js';

test('fictional identities are fixed, immutable and cover every real catalog department',()=>{
  const catalog=createResidentCatalog();assert.deepEqual(catalog,createResidentCatalog());
  assert.equal(CITY_RESIDENTS.length,211);assert.equal(RESIDENT_DEPARTMENTS.length,23);
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
      if(person.specialty&&d.newBuilding){assert.ok(Math.abs(pose.x-d.position.x)<=7.0001);assert.ok(pose.z-d.position.z>=-5.7001&&pose.z-d.position.z<=21.5);}
      else{assert.ok(Math.abs(pose.x-d.position.x)<4.1);assert.ok(Math.abs(pose.z-d.position.z-(d.newBuilding?20:0))<=1.41);assert.equal(pose.interior,false);}
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
const sceneSource=readFileSync(new URL('../public/vitriny-city-residents-scene.js',import.meta.url),'utf8').replaceAll("'/vendor/three/three.module.js'",JSON.stringify(threeURL)).replaceAll("'./vitriny-urban-models.js?v=20260915-residents-2'",JSON.stringify(urbanURL)).replaceAll("'./vitriny-city-residents-core.js?v=20260915-residents-2'",JSON.stringify(coreURL));
const {mountCityResidents,mountResidentPavilion}=await import(dataModule(sceneSource));
function fakeArchitecture(){
  const geometry=new THREE.BoxGeometry(1,1,1),a={textSign(parent){const sign=new THREE.Group();parent.add(sign);return sign;}};
  for(const color of ['stone','wood','graphite','brass','warm','glass'])a[color]=new THREE.MeshBasicMaterial({transparent:color==='glass',opacity:color==='glass'?.16:1});
  a.part=(parent,material,x,y,z,w,h,d)=>{const p=new THREE.Mesh(geometry,material);p.position.set(x,y,z);p.scale.set(w,h,d);parent.add(p);return p;};return a;
}
test('LITE scene uses bounded instancing and can select any resident without losing their identity',()=>{
  const scene=new THREE.Scene(),architecture=fakeArchitecture(),mounted=mountCityResidents({scene,architecture,profileId:'LITE'});
  const crowd=scene.getObjectByName('virtual-residents-simulation'),batches=()=>crowd.children.filter(c=>c.isInstancedMesh);
  assert.ok(batches().length<=4);const before=batches()[0].instanceMatrix.array.slice();mounted.tick(1,{paused:true});assert.deepEqual(batches()[0].instanceMatrix.array,before);
  mounted.tick(.1);assert.notDeepEqual(batches()[0].instanceMatrix.array,before);
  const last=CITY_RESIDENTS.at(-1),pose=mounted.select(last.id);assert.ok(pose);assert.ok(batches()[0].count<=16*100);
  assert.equal(mounted.venues.length,3);mounted.dispose();assert.equal(scene.getObjectByName('virtual-residents-simulation'),undefined);
});

test('each fixed department has eight specialists and selection prioritizes its team within 16/40',()=>{
  const catalog=createResidentCatalog();
  for(const limit of [16,40])for(const d of RESIDENT_DEPARTMENTS.filter(d=>d.newBuilding))assert.equal(residentVisibleRoster(catalog,'',limit).filter(p=>p.departmentId===d.id&&p.specialty).length,limit===16?2:4);
  for(const d of RESIDENT_DEPARTMENTS){
    const specialists=CITY_RESIDENTS.filter(p=>p.departmentId===d.id&&p.specialty);assert.equal(specialists.length,8);
    assert.deepEqual(specialists.map(p=>p.specialty),RESIDENT_SPECIALTIES.map(s=>s.id));
    for(const limit of [16,40]){
      const selected=specialists[7],roster=residentVisibleRoster(catalog,selected.id,limit),colleagues=catalog.residents.filter(p=>p.departmentId===d.id);
      assert.equal(roster.length,limit);assert.equal(roster[0].id,selected.id);assert.equal(new Set(roster.map(p=>p.id)).size,limit);
      assert.ok(roster.slice(0,colleagues.length).every(p=>p.departmentId===d.id));
    }
  }
});

test('pavilion routes pass through the open entrance, avoid desks and complete a continuous work-talk-return cycle',()=>{
  for(const d of RESIDENT_DEPARTMENTS.filter(d=>d.newBuilding))for(const person of CITY_RESIDENTS.filter(p=>p.departmentId===d.id&&p.specialty)){
    const actions=new Set();let previous;
    for(let elapsed=0;elapsed<=112;elapsed+=.25){
      const pose=residentPose(person,d,elapsed),x=pose.x-d.position.x,z=pose.z-d.position.z;actions.add(pose.action);
      assert.ok(Math.abs(x)<14.3&&z>-12.3);
      if(Math.abs(z-12.5)<.6)assert.ok(Math.abs(x)<1.5,'Doorway must not contain a glass wall or path through it');
      if(previous)assert.ok(Math.hypot(pose.x-previous.x,pose.z-previous.z)<1,'No teleporting between routine phases');
      for(let slot=0;slot<8;slot++){const desk=residentDesk(slot);assert.ok(!(Math.abs(x-desk.x)<1.8&&Math.abs(z-desk.z)<.95),'Desk footprint must stay clear');}
      previous=pose;
    }
    assert.deepEqual([...actions].sort(),['reception','talk','walk','work']);
  }
});

test('new pavilion models include eight desks and transparent sides with a genuine central doorway',()=>{
  const a=fakeArchitecture(),d=RESIDENT_DEPARTMENTS.find(d=>d.id==='studio'),venue=mountResidentPavilion({building:d,architecture:a});
  const glass=venue.children.filter(c=>c.material===a.glass&&c.position.z===12.5);assert.equal(glass.length,2);
  for(const pane of glass)assert.ok(Math.abs(pane.position.x)-pane.scale.x/2>=2);
  assert.equal(venue.children.filter(c=>c.material===a.wood&&c.position.y===1.15).length,8);
});

test('paired colleagues keep separate lanes through the aisle and open doorway',()=>{
  for(const d of RESIDENT_DEPARTMENTS.filter(d=>d.newBuilding))for(let pair=0;pair<4;pair++){
    const people=[pair*2,pair*2+1].map(slot=>CITY_RESIDENTS.find(p=>p.departmentId===d.id&&p.specialty&&p.slot===slot));
    for(let elapsed=0;elapsed<=112;elapsed+=.125){
      const [a,b]=people.map(person=>residentPose(person,d,elapsed));if(!a.moving&&!b.moving)continue;
      assert.ok(Math.hypot(a.x-b.x,a.z-b.z)>=1.19,'Paired walkers must not overlap');
      for(const pose of [a,b])if(Math.abs(pose.z-d.position.z-12.5)<.6){assert.ok(Math.abs(Math.abs(pose.x-d.position.x)-.6)<.0001);assert.ok(Math.abs(pose.x-d.position.x)+.3<2,'Body clears the four-metre doorway');}
    }
  }
});

test('scripted dialogue names two local fictional peers and never creates task receipts',()=>{
  const catalog=createResidentCatalog(),person=catalog.residents.find(p=>p.id==='studio-specialist-research'),dialogue=residentConversation(person,catalog);
  assert.equal(dialogue.simulated,true);assert.equal(dialogue.speakers.length,2);assert.equal(new Set(dialogue.speakers).size,2);
  assert.ok(dialogue.lines.join(' ').includes('não um registro de trabalho realizado'));
  assert.deepEqual(dialogue,residentConversation(person,catalog));
  const cross=residentConversation(person,catalog,{crossDepartment:true});assert.equal(cross.simulated,true);assert.equal(new Set(cross.departments).size,2);assert.equal(new Set(cross.speakers).size,2);assert.match(cross.lines.join(' '),/nenhuma tarefa foi criada ou executada/);
});

test('directory and simulation contain no request, task mutation, generated text or token calls',()=>{
  for(const file of ['vitriny-city-residents.js','vitriny-city-residents-core.js','vitriny-city-residents-scene.js']){
    const text=readFileSync(new URL('../public/'+file,import.meta.url),'utf8');
    assert.doesNotMatch(text,/\bfetch\s*\(|XMLHttpRequest|sendBeacon|\/api\/admin|sales-agents|Math\.random\s*\(/);
  }
  const html=readFileSync(new URL('../public/vitriny-multiverse-explore.html',import.meta.url),'utf8');assert.match(html,/vitriny-city-residents\.js/);assert.match(html,/vitriny-city-residents\.css/);
});
