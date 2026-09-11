import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CARE_TYPES,PLANTS_STORAGE_KEY,MAX_PLANTS,emptyPlants,validPlantDate,localPlantDay,validPlants,plantFields,changePlants,pendingPlantCare,plantCareLabel,readPlants,writePlants} from '../public/games/plants-core.js';
const day='2026-09-11';
const add=(state,id,fields={})=>changePlants(state,{type:'add',id,fields:{name:'Zamioculca',location:'Sala',note:'Folhas novas',...fields}},day);
const storage=()=>{const map=new Map();return{map,getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};};

test('plants support a real local CRUD without assigning any automatic care',()=>{
  const original=emptyPlants(),first=add(original,'zami'),before=structuredClone(first);
  assert.equal(original.plants.length,0);assert.equal(first.plants[0].care,null);assert.deepEqual(first.plants[0].history,[]);assert.equal(first.plants[0].createdOn,day);
  const edited=changePlants(first,{type:'edit',id:'zami',fields:{name:'Minha planta',location:'Quarto',note:'Checar folhas'}},day);
  assert.deepEqual(first,before);assert.equal(edited.plants[0].name,'Minha planta');assert.equal(edited.revision,2);assert.equal(edited.plants[0].createdOn,day);
  const deleted=changePlants(edited,{type:'delete',id:'zami'},day);assert.equal(deleted.plants.length,0);assert.equal(deleted.revision,3);
});

test('the user must choose the care date and custom care has a meaningful label',()=>{
  for(const type of Object.keys(CARE_TYPES)){
    const state=add(emptyPlants(),type,{type,date:'2026-09-12',custom:'Girar o vaso'});
    assert.deepEqual(state.plants[0].care,{type,date:'2026-09-12',custom:type==='outro'?'Girar o vaso':''});
  }
  assert.equal(plantFields({name:'Planta',type:'regar',date:''}).care,null);
  assert.throws(()=>plantFields({name:'Planta',type:'outro',date:day,custom:'  '}));
  assert.throws(()=>plantFields({name:'Planta',type:'__proto__',date:day}));
  assert.equal(plantCareLabel({type:'outro',custom:'Girar o vaso'}),'Girar o vaso');
});

test('pending care is based only on selected calendar dates and never completes itself',()=>{
  let state=add(emptyPlants(),'today',{date:day,type:'revisar'});state=add(state,'past',{date:'2026-09-09',type:'regar'});state=add(state,'later',{date:'2026-09-12',type:'adubar'});state=add(state,'unscheduled');
  const before=structuredClone(state);assert.deepEqual(pendingPlantCare(state,day).map(p=>p.id),['past','today']);assert.deepEqual(state,before);
  assert.deepEqual(pendingPlantCare(state,'2026-09-12').map(p=>p.id),['past','today','later']);
  assert.deepEqual(pendingPlantCare(state,'invalid'),[]);
});

test('recording done clears the schedule unless the user supplies another date',()=>{
  const first=add(emptyPlants(),'zami',{date:day,type:'regar'});
  const done=changePlants(first,{type:'complete',id:'zami',nextDate:''},day);
  assert.equal(done.plants[0].care,null);assert.deepEqual(done.plants[0].history,[{type:'regar',custom:'',date:day,completedOn:day}]);assert.deepEqual(pendingPlantCare(done,day),[]);
  assert.throws(()=>changePlants(done,{type:'complete',id:'zami'},day),/agendado/);
  const next=changePlants(first,{type:'complete',id:'zami',nextDate:'2026-09-20'},day);assert.equal(next.plants[0].care.date,'2026-09-20');assert.equal(next.plants[0].history[0].date,day);
  assert.throws(()=>changePlants(first,{type:'complete',id:'zami',nextDate:'2026-09-10'},day),/futura/);
  let many=first;for(let i=0;i<12;i++)many=changePlants(many,{type:'complete',id:'zami',nextDate:day},day);assert.equal(many.plants[0].history.length,8);
});

test('date validation handles calendar boundaries and uses the device local day',()=>{
  for(const date of ['2024-02-29','2026-12-31',day])assert.equal(validPlantDate(date),true);
  for(const date of ['2026-02-29','2026-04-31','2026-13-01','2026-9-1','not a day','2100-01-01'])assert.equal(validPlantDate(date),false);
  assert.equal(localPlantDay(new Date(2026,8,11,0,1)),day);assert.equal(localPlantDay(new Date(2026,8,11,23,59)),day);
});

test('local persistence survives reload, preserves damaged content and reports storage failure',()=>{
  const disk=storage();assert.equal(readPlants(disk).status,'empty');const state=add(emptyPlants(),'zami',{date:day,type:'revisar'});
  assert.equal(writePlants(disk,state),true);assert.deepEqual(readPlants(disk),{status:'ok',state});assert.deepEqual([...disk.map.keys()],[PLANTS_STORAGE_KEY]);
  for(const raw of ['broken json','{"version":2,"plants":[]}','x'.repeat(500001)]){disk.setItem(PLANTS_STORAGE_KEY,raw);assert.equal(readPlants(disk).status,'corrupt');assert.equal(disk.getItem(PLANTS_STORAGE_KEY),raw);}
  const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('quota');}};assert.equal(readPlants(blocked).status,'unavailable');assert.equal(writePlants(blocked,state),false);
  assert.equal(writePlants(disk,{...state,version:7}),false);
});

test('malformed records, duplicate IDs and oversized lists fail closed',()=>{
  const state=add(emptyPlants(),'safe');
  for(const change of [{id:'<svg>'},{name:''},{name:'x'.repeat(81)},{location:'x'.repeat(121)},{note:'x'.repeat(2001)},{care:{type:'regar',custom:'',date:'2026-02-31'}},{history:Array(9).fill({type:'regar',custom:'',date:day,completedOn:day})}])assert.equal(validPlants({...state,plants:[{...state.plants[0],...change}]}),false);
  assert.equal(validPlants({...state,plants:[state.plants[0],state.plants[0]]}),false);
  assert.throws(()=>add(state,'safe'));assert.throws(()=>add(emptyPlants(),'empty',{name:'  '}));
  const full={version:1,revision:0,plants:Array.from({length:MAX_PLANTS},(_,i)=>({...state.plants[0],id:'p'+i}))};assert.equal(validPlants(full),true);assert.throws(()=>add(full,'extra'),/100/);
});

test('notes are plain text data, and the UI has no HTML interpolation or network calls',()=>{
  const xss='<img src=x onerror=alert(1)>',state=add(emptyPlants(),'safe',{name:xss,note:'<script>alert(1)</script>'});assert.equal(state.plants[0].name,xss);assert.equal(validPlants(state),true);
  const source=readFileSync(new URL('../public/games/plants.js',import.meta.url),'utf8');assert.doesNotMatch(source,/innerHTML|insertAdjacentHTML|\bfetch\(|XMLHttpRequest|Notification|serviceWorker/);assert.match(source,/\.textContent=/);assert.match(source,/latest\.revision!==baseRevision/);
  const html=readFileSync(new URL('../public/games/plants.html',import.meta.url),'utf8');assert.match(html,/VitrineCity Cultiva/);assert.match(html,/Não enviamos notificações em segundo plano/);assert.match(html,/href="\/games\/cuidados"/);assert.match(html,/href="\/games\/ajuda"/);
});
