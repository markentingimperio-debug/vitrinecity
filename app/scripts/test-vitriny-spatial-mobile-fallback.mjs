import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const appRoot=fileURLToPath(new URL('..',import.meta.url));
const html=readFileSync(`${appRoot}/public/vitriny-multiverse-explore.html`,'utf8');
const js=readFileSync(`${appRoot}/public/vitriny-multiverse-explore.js`,'utf8');

assert.match(html,/width=device-width,initial-scale=1,viewport-fit=cover/);
assert.match(html,/env\(safe-area-inset-top\)/);
assert.match(html,/@media\(pointer:coarse\)\{\.pad\{display:grid\}\}/);
for(const label of ['Avançar','Mover para a esquerda','Recuar','Mover para a direita'])assert.match(html,new RegExp(`aria-label="${label}"`));
assert.match(html,/href="\/vitriny-multiverse-worlds\.html"/);
assert.match(html,/href="\/cidade\.html"/);
assert.match(html,/id="ecosystemLinks"/);

assert.match(js,/matchMedia\('\(max-width:760px\)'\)\.matches/);
assert.match(js,/id=score>=6\?'ULTRA':score>=3\?'STANDARD':'LITE'/);
assert.match(js,/new THREE\.WebGLRenderer/);
assert.match(js,/3D indisponível neste aparelho\. Use o World Gate ou a cidade clássica\./);
assert.match(js,/renderer\.setPixelRatio\(profile\.pixel\)/);
assert.match(js,/profile\.id!=='LITE'/);
assert.match(js,/if\(!isActiveCity\)/);

console.log(JSON.stringify({ok:true,mobileControls:4,webglFallback:true,classicFallback:true,cityContextHud:true}));
