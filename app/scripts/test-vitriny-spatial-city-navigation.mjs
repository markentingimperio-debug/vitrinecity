import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveCityReturnState} from '../public/vitriny-spatial-city-navigation.js';
import {createSpatialReturnState} from '../public/vitriny-spatial-session.js';

const now=Date.parse('2026-09-07T21:00:00Z');
const state=(id,x,age=0)=>createSpatialReturnState({worldKey:`br:go:${id}`,spatialPath:`/v/br/go/${id}`,
  position:{x,y:1.7,z:96},yaw:Math.PI,pitch:0,createdAt:new Date(now-age).toISOString()});
const world='br:go:anapolis';

test('a fresh store return takes priority over an older city checkpoint',()=>{
  const result=resolveCityReturnState(world,{checkpoint:state('anapolis',1,60000),legacy:state('anapolis',22),now});
  assert.equal(result.position.x,22);
});
test('a newer city checkpoint takes priority over stale legacy state',()=>{
  const result=resolveCityReturnState(world,{checkpoint:state('anapolis',33),legacy:state('anapolis',2,60000),now});
  assert.equal(result.position.x,33);
});
test('equal timestamps prefer the explicit store return',()=>{
  const result=resolveCityReturnState(world,{checkpoint:state('anapolis',1),legacy:state('anapolis',44),now});
  assert.equal(result.position.x,44);
});
test('another city cannot replace a matching return point',()=>{
  assert.equal(resolveCityReturnState(world,{checkpoint:state('anapolis',55,60000),legacy:state('goiania',999),now}).position.x,55);
  assert.equal(resolveCityReturnState(world,{checkpoint:state('goiania',999),legacy:state('silvania',999),now}),null);
});
test('expired data never becomes a return point',()=>{
  assert.equal(resolveCityReturnState(world,{checkpoint:state('anapolis',1,7200001),legacy:state('anapolis',2,7200001),now}),null);
});
test('corrupt checkpoint does not hide a valid legacy return',()=>{
  assert.equal(resolveCityReturnState(world,{checkpoint:'{broken',legacy:JSON.stringify(state('anapolis',66)),now}).position.x,66);
  assert.equal(resolveCityReturnState(world,{checkpoint:state('anapolis',77),legacy:'{broken',now}).position.x,77);
});
test('mismatched routes, excessive future dates and invalid worlds fail safely',()=>{
  assert.equal(resolveCityReturnState(world,{checkpoint:{...state('anapolis',1),spatialPath:'/v/br/go/silvania'},legacy:state('anapolis',2,-600000),now}),null);
  for(const key of ['',null,'br:go:../admin','https://evil.invalid'])assert.equal(resolveCityReturnState(key,{checkpoint:state('anapolis',1),now}),null);
});
test('no prior point returns null instead of an invented position',()=>{
  assert.equal(resolveCityReturnState(world,{now}),null);
  assert.equal(resolveCityReturnState(world,{checkpoint:null,legacy:undefined,now}),null);
});
