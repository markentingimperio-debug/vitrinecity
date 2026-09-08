import assert from 'node:assert/strict';
import {arrangeStoreBuildings,intersectsStoreBuilding,storeBuildingIdentity} from '../public/vitriny-store-building-core.js';

const names=['Agrotecnica','Beemi — Agência Shopee','Centro Educacional VitrineCity','Sertaneja Moda Country'];
const input=names.map((name,index)=>({reference:'store-'+index,name,href:'/loja/store-'+index+'/loja',size:{width:22,depth:16,height:9},position:{x:112,z:index*10}}));
const before=structuredClone(input),stores=arrangeStoreBuildings([...input,...input]);
assert.equal(stores.length,4,'Duplicate API records must never create two buildings for one store');
assert.deepEqual(input,before,'Presentation cannot overwrite catalogue records');
assert.deepEqual(stores.map(s=>s.href),input.map(s=>s.href),'Each door keeps its store destination');
assert.equal(new Set(stores.map(s=>s.buildingIdentity.style)).size,4);
assert.deepEqual(arrangeStoreBuildings([...input].reverse()),stores,'API arrival order does not move a store');
for(const store of stores)assert.ok(intersectsStoreBuilding({position:store.position,size:{width:10,depth:10}},store),'Procedural scenery must not occupy a shop lot');
const expanded=arrangeStoreBuildings(Array.from({length:48},(_,i)=>({reference:'future-'+String(i).padStart(2,'0'),name:'Loja '+i,href:'/loja/future-'+i+'/loja',position:{x:0,z:0},size:{width:22,depth:16,height:9}})));
for(let i=0;i<expanded.length;i++)for(let j=0;j<i;j++)assert.equal(intersectsStoreBuilding({position:expanded[i].position,size:{width:expanded[i].size.depth,depth:expanded[i].size.width}},expanded[j]),false,'Registered stores have distinct lots');
assert.ok(expanded.every(s=>Math.abs(s.position.z-100)>7+s.size.width/2),'Store lots stay clear of the cross street');
assert.ok(storeBuildingIdentity('Nova loja').towerHeight>20,'Future stores also receive complete buildings');
console.log('store-buildings: unique lots, 48-store spacing, individual identities, preserved catalogue links and cross-street clearance passed');
