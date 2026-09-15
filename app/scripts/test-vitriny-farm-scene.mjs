import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {newFarm,farmAction} from '../public/vitriny-farm-core.js';
const file=path.resolve(import.meta.dirname,'../public/vitriny-farm-scene.js');
const source=readFileSync(file,'utf8').replace("'/vendor/three/three.module.js'",JSON.stringify(pathToFileURL(path.resolve(import.meta.dirname,'../node_modules/three/build/three.module.js')).href)).replace("'/vendor/three/addons/utils/BufferGeometryUtils.js'",JSON.stringify(pathToFileURL(path.resolve(import.meta.dirname,'../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js')).href)).replace("'./vitriny-farm-core.js'",JSON.stringify(pathToFileURL(path.resolve(import.meta.dirname,'../public/vitriny-farm-core.js')).href));
const browserSource=source.replace("'./vitriny-farm-walking.js'",JSON.stringify(pathToFileURL(path.resolve(import.meta.dirname,'../public/vitriny-farm-walking.js')).href));
const {buildFarmWorld,farmGrowth}=await import('data:text/javascript;base64,'+Buffer.from(browserSource).toString('base64'));
const mature=()=>({...newFarm(),xp:130,plots:Array.from({length:12},(_,i)=>({crop:['carrot','corn','strawberry'][i%3],plantedAt:1000,readyAt:31000,watered:true}))});

test('scene mirrors unlocks and actions without advancing account state',()=>{
  const world=buildFarmWorld({textures:false,lowDetail:true});try{let state=newFarm();const original=structuredClone(state);world.update(state,1000);assert.deepEqual(state,original);assert.equal(world.plots.filter(p=>p.actionable).length,3);assert.equal(world.cow.visible,false);assert.equal(world.chickens[0].g.visible,false);assert.equal(world.setHovered(11),false);
    state=farmAction(state,{type:'plant',plot:0,crop:'carrot'},1000).state;world.update(state,2000);assert.equal(world.plots[0].crops.carrot.visible,true);assert.equal(world.plots[0].crops.corn.visible,false);assert.equal(world.plots[0].actionable,true);
    state=farmAction(state,{type:'water',plot:0},2000).state;world.update(state,3000);assert.equal(world.plots[0].actionable,false);assert.equal(world.setHovered(0),false);const before=structuredClone(state);world.update(state,21000);world.animate(20);assert.equal(world.plots[0].border.visible,true);assert.equal(world.plots[0].actionable,true);assert.deepEqual(state,before,'rendering readiness does not harvest or award coins');
    world.update(mature(),40000);assert.equal(world.cow.visible,true);assert.equal(world.chickens.every(c=>c.g.visible),true);assert.equal(world.plots.filter(p=>p.border.visible).length,12);
  }finally{world.dispose();}
});
test('crop geometry is distinct and shared across plots with growth based on authoritative times',()=>{
  const world=buildFarmWorld({textures:false,lowDetail:true});try{world.update(mature(),16000);assert.equal(farmGrowth({plantedAt:1000,readyAt:31000},16000),.5);assert.equal(farmGrowth({plantedAt:1000,readyAt:20500},16000),15000/19500);assert.equal(farmGrowth({plantedAt:1000,readyAt:31000},99000),1);
    const a=world.plots[0].crops,b=world.plots[3].crops;assert.equal(a.carrot.children[0].geometry,b.carrot.children[0].geometry);const count=k=>a[k].children.reduce((n,m)=>n+m.geometry.attributes.position.count,0);assert.equal(new Set(['carrot','corn','strawberry'].map(count)).size,3);assert.equal(world.plots[1].crops.corn.scale.y,.5);
  }finally{world.dispose();}
});
test('detailed foliage remains instanced and bounded on the mobile profile',()=>{
  const world=buildFarmWorld({textures:false,lowDetail:true});try{world.update(mature(),40000);let draws=0,triangles=0,instances=0;world.root.traverseVisible(o=>{if(!o.isMesh)return;draws++;const count=o.geometry.index?.count||o.geometry.attributes.position.count;triangles+=count/3*(o.isInstancedMesh?o.count:1);if(o.isInstancedMesh)instances+=o.count;});assert.equal(instances,6500);assert.ok(draws<170,`draw calls ${draws}`);assert.ok(triangles<250000,`triangles ${triangles}`);console.log(JSON.stringify({mobileFarm:{draws,triangles,leafInstances:instances}}));
  }finally{world.dispose();}
});
test('resources are disposed once and separate scene instances remain usable',()=>{
  const world=buildFarmWorld({textures:false,lowDetail:true}),other=buildFarmWorld({textures:false,lowDetail:true}),calls=new Map();for(const resources of Object.values(world.resources))for(const resource of resources)resource.addEventListener('dispose',()=>calls.set(resource,(calls.get(resource)||0)+1));world.dispose();world.dispose();assert.equal(calls.size,world.resources.geometries.size+world.resources.materials.size+world.resources.maps.size);assert.ok([...calls.values()].every(n=>n===1));other.update(newFarm(),1000);assert.equal(other.plots.filter(p=>p.actionable).length,3);other.dispose();
});
