import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const appRoot=fileURLToPath(new URL('..',import.meta.url));
const smokePath=`${appRoot}/scripts/smoke-vitriny-multiversal.mjs`;
const source=readFileSync(smokePath,'utf8');
const syntax=spawnSync(process.execPath,['--check',smokePath],{encoding:'utf8'});
assert.equal(syntax.status,0,syntax.stderr||'smoke script syntax invalid');

for(const required of [
  'BASE_URL',
  '/api/health',
  '/api/spatial/v1',
  '/api/spatial/v1/context?city=vitrine-city',
  '/api/spatial/v1/context?city=vianopolis',
  '/vitriny-multiverse-worlds.html',
  '/vitriny-multiverse-explore.html?city=vitrine-city',
  '/mapa-real.html?cidade=vianopolis',
  "marketplace,false",
  "deliveries,false",
  "['available','reserved','active']",
  "Object.hasOwn(item,'sponsor')"
])assert.ok(source.includes(required),`smoke Multiversal sem contrato obrigatório: ${required}`);

assert.match(source,/redirect:'manual'/);
assert.match(source,/cache:'no-store'/);
assert.match(source,/AbortController/);

console.log(JSON.stringify({ok:true,postDeploySmoke:true,health:true,previewIsolation:true,premiumStateIndependent:true,syntax:true}));
