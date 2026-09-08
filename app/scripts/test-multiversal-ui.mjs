import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const appDir=fileURLToPath(new URL('..',import.meta.url));
const repoDir=path.resolve(appDir,'..');
const publicDir=path.join(appDir,'public');
const html=readFileSync(path.join(publicDir,'multiversal.html'),'utf8');
const js=readFileSync(path.join(publicDir,'multiversal.js'),'utf8');
const css=readFileSync(path.join(publicDir,'multiversal.css'),'utf8');
const cityCss=readFileSync(path.join(publicDir,'multiversal-city.css'),'utf8');

for(const id of ['realmGrid','realmSearch','realmFilters','resumeCard','realmCount']){
  assert.match(html,new RegExp(`id=["']${id}["']`),`multiversal.html precisa de #${id}`);
}
assert.match(html,/multiversal\.js\?v=1/);
assert.match(css,/\.realm-grid/);
assert.match(css,/@media \(max-width: 620px\)/);
assert.match(cityCss,/\.city-context/);

const syntax=spawnSync(process.execPath,['--check',path.join(publicDir,'multiversal.js')],{encoding:'utf8'});
assert.equal(syntax.status,0,syntax.stderr||syntax.stdout);

for(const city of ['silvania-go','anapolis-go','vianopolis-go'])assert.ok(js.includes(city),`cidade ausente: ${city}`);
for(const api of ['/api/multiversal/cities','/api/multiversal/realms','/api/multiversal/transition'])assert.ok(js.includes(api),`API ausente: ${api}`);

const destinationFiles=[
  'cidade-25d-demo.html','mapa-real.html','social.html','loja.html','entregas.html',
  'centro-educacional.html','jarvis-public.html','navegar.html'
];
for(const file of destinationFiles)assert.equal(existsSync(path.join(publicDir,file)),true,`destino Multiversal ausente: ${file}`);

const compose=readFileSync(path.join(repoDir,'docker-compose.yml'),'utf8');
const caddy=readFileSync(path.join(repoDir,'Caddyfile'),'utf8');
assert.match(compose,/\n  multiversal:\n/);
assert.match(compose,/multiversal-server\.js/);
assert.match(compose,/api\/multiversal\/health/);
assert.match(caddy,/handle \/api\/multiversal\/\*/);
assert.match(caddy,/reverse_proxy multiversal:3001/);

console.log(JSON.stringify({ok:true,destinations:destinationFiles.length,cities:3,apis:3}));
