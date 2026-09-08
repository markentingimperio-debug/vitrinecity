import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spatialEcosystemDestination} from '../public/vitriny-spatial-city-context.js';
import {applySpatialMapCityContext,spatialMapCityName,spatialMapContextCity} from '../public/vitriny-spatial-map-context.js';

assert.equal(spatialMapCityName('vianopolis'),'Vianópolis');
assert.equal(spatialMapCityName('ANAPOLIS'),'Anápolis');
assert.equal(spatialMapCityName('vitrine-city'),'');
assert.equal(spatialMapContextCity({search:'?cidade=vianopolis'}),'vianopolis');
assert.equal(spatialMapContextCity({search:'?city=goiania'}),'goiania');

let changes=0;
const citySelect={
  value:'',
  options:[{value:''},{value:'Silvânia'},{value:'Vianópolis'},{value:'Goiânia'}],
  dispatchEvent(event){if(event?.type==='change')changes++;return true;}
};
const statusNode={dataset:{}};
assert.equal(applySpatialMapCityContext({cityId:'vianopolis',citySelect,statusNode}),true);
assert.equal(citySelect.value,'Vianópolis');
assert.equal(changes,1);
assert.equal(statusNode.dataset.spatialCityContext,'vianopolis');
assert.equal(applySpatialMapCityContext({cityId:'anapolis',citySelect,statusNode}),false);
assert.equal(citySelect.value,'Vianópolis');

const destination=spatialEcosystemDestination('map',{cityId:'vianopolis',cityStatus:'preview'});
assert.equal(destination.enabled,true);
assert.equal(destination.href,'/mapa-real.html?cidade=vianopolis');
assert.equal(spatialMapContextCity({search:new URL(destination.href,'https://vitrinecity.local').search}),'vianopolis');

const appRoot=fileURLToPath(new URL('..',import.meta.url));
const html=readFileSync(`${appRoot}/public/mapa-real.html`,'utf8');
assert.match(html,/type="module" src="\/vitriny-spatial-map-context\.js"/);
assert.match(html,/id="city"/);
assert.match(html,/id="status"/);

console.log(JSON.stringify({ok:true,journey:'multiversal-map-city',city:'vianopolis',filter:'Vianópolis'}));
