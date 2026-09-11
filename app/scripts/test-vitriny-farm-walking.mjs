import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FARM_BEDS,farmWalkable,farmRoute,farmInteractionPoint,createFarmWalker} from '../public/vitriny-farm-walking.js';
test('all twelve canteiros and animal care points have collision-free routes',()=>{
  for(const target of [...FARM_BEDS.map((_,plot)=>({kind:'plot',plot})),{kind:'animal',animal:'chicken'},{kind:'animal',animal:'cow'}]){const goal=farmInteractionPoint(target),walker=createFarmWalker();assert.ok(farmWalkable(goal),JSON.stringify({target,goal}));assert.equal(walker.moveTo(goal),true,JSON.stringify(target));for(let i=0;i<2500&&walker.hasRoute;i++){const step=walker.step(.08);assert.ok(farmWalkable(step.position));}assert.equal(walker.near(target),true,JSON.stringify({target,position:walker.position}));assert.equal(walker.hasRoute,false);}
});
test('keyboard movement cannot cross a bed, house, pond, fence or boundary, even with huge dt',()=>{
  for(const [position,input] of [[{x:-9.2,z:1.08},{x:0,z:-1}],[{x:-7,z:-3.5},{x:0,z:-1}],[{x:7.7,z:1.45},{x:0,z:-1}],[{x:3.4,z:7},{x:1,z:0}],[{x:0,z:10.9},{x:0,z:1}]]){const walker=createFarmWalker({position});for(let i=0;i<150;i++)assert.ok(farmWalkable(walker.step(100,input).position));}
});
test('destination is local only, invalid goals fail closed and stopping cancels navigation',()=>{
  const walker=createFarmWalker(),before=walker.position;assert.equal(walker.moveTo({x:7.7,z:-1.6}),false);assert.deepEqual(walker.position,before);assert.equal(farmRoute(before,{x:NaN,z:0}),null);assert.equal(farmInteractionPoint({kind:'plot',plot:99}),null);assert.equal(walker.moveTo(farmInteractionPoint({kind:'plot',plot:0})),true);assert.equal(walker.near({kind:'plot',plot:0}),false);walker.step(.08);walker.stop();const stopped=walker.position;for(let i=0;i<10;i++)walker.step(.08);assert.deepEqual(walker.position,stopped);assert.equal(walker.hasRoute,false);
});
test('diagonal keyboard input at a bed corner cannot combine two free axes into a collision',()=>{
  const walker=createFarmWalker({position:{x:-10.69,z:.94}});for(let i=0;i<80;i++){const result=walker.step(.03,{x:1,z:-1});assert.ok(farmWalkable(result.position),JSON.stringify(result.position));}
});
