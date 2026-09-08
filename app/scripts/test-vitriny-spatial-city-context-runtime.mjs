import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spatialEcosystemDestinations,withSpatialCityContext} from '../public/vitriny-spatial-city-context.js';

const appRoot=fileURLToPath(new URL('..',import.meta.url));
const html=readFileSync(`${appRoot}/public/vitriny-multiverse-explore.html`,'utf8');
const runtime=readFileSync(`${appRoot}/public/vitriny-spatial-city-context-runtime.js`,'utf8');

assert.match(html,/id="ecosystemLinks"/);
assert.match(html,/id="ecosystemContextStatus"/);
assert.match(html,/src="\/vitriny-spatial-city-context-runtime\.js"/);
assert.match(runtime,/spatialEcosystemDestinations/);
assert.match(runtime,/fetchSpatialCityContext/);
assert.equal(withSpatialCityContext('/social.html','anapolis'),'/social.html?cidade=anapolis');

const preview=spatialEcosystemDestinations({cityId:'anapolis',cityStatus:'active'});
assert.deepEqual(preview.filter(item=>item.enabled).map(item=>item.id),['social','map']);
assert.deepEqual(preview.filter(item=>!item.enabled).map(item=>item.id),['marketplace','deliveries']);
const active=spatialEcosystemDestinations({cityId:'vitrine-city',cityStatus:'active'});
assert.equal(active.every(item=>item.enabled),true);

console.log(JSON.stringify({ok:true,previewEnabled:preview.filter(item=>item.enabled).map(item=>item.id),activeEnabled:active.map(item=>item.id)}));
