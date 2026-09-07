import assert from 'node:assert/strict';
import {planSpatialCityGates,spatialCityGateHint} from '../public/vitriny-spatial-city-gates.js';

const cities=[
  {id:'vitrine-city',worldKey:'br:go:vitrine-city',name:'Vitrine City',status:'active',route:'/v/br/go/vitrine-city'},
  {id:'silvania',worldKey:'br:go:silvania',name:'Silvânia',status:'preview',route:'/v/br/go/silvania'},
  {id:'anapolis',worldKey:'br:go:anapolis',name:'Anápolis',status:'preview',route:'/v/br/go/anapolis'},
  {id:'goiania',worldKey:'br:go:goiania',name:'Goiânia',status:'preview',route:'/v/br/go/goiania'},
  {id:'../admin',worldKey:'br:go:../admin',name:'Inválida',status:'active'}
];

const gates=planSpatialCityGates({currentCityId:'vitrine-city',cities,radius:100});
assert.equal(gates.length,3);
assert.deepEqual(gates.map(g=>g.id),['silvania','anapolis','goiania']);
assert.equal(gates[0].href,'/vitriny-multiverse-explore.html?city=silvania');
assert.equal(gates.every(g=>Math.abs(Math.hypot(g.x,g.z)-100)<0.01),true);
assert.match(spatialCityGateHint(gates[0],'Vitrine City'),/Silvânia/);
assert.match(spatialCityGateHint(gates[0],'Vitrine City'),/preview/);
assert.equal(Object.isFrozen(gates),true);
assert.equal(Object.isFrozen(gates[0]),true);

const reverse=planSpatialCityGates({currentCityId:'anapolis',cities});
assert.equal(reverse.some(g=>g.id==='anapolis'),false);
assert.equal(reverse.some(g=>g.id==='vitrine-city'),true);
assert.equal(reverse.find(g=>g.id==='vitrine-city').status,'active');

console.log(JSON.stringify({ok:true,gates:gates.length,from:'vitrine-city',to:gates.map(g=>g.id)}));
