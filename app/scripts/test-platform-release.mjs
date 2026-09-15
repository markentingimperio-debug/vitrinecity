// Run in an isolated container without production credentials, data or network.
import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const directory=fileURLToPath(new URL('.',import.meta.url));
// The release verifier runs this exact manifest in its mandatory browser container.
// Keep browser-only dependencies out of the application image.
const browserTests=JSON.parse(readFileSync(new URL('../../ops/browser-tests/suites.json',import.meta.url),'utf8'));
assert.ok(Array.isArray(browserTests)&&browserTests.length>0);
assert.equal(new Set(browserTests).size,browserTests.length);
for(const name of browserTests)assert.ok(/^test-[a-z0-9-]+-browser\.mjs$/.test(name)&&readdirSync(directory).includes(name),`Invalid browser suite: ${name}`);
const excluded=new Set(['test-platform-release.mjs','test-public-smoke.mjs',...browserTests]);
console.log('Required in the isolated browser release runner: '+browserTests.join(', '));
const files=readdirSync(directory).filter(name=>/^test-.+\.mjs$/.test(name)&&!excluded.has(name)).sort();
const failures=[];
for(const name of files){
  const result=spawnSync(process.execPath,[directory+name],{cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8',timeout:90000});
  if(result.status!==0){failures.push(name);console.log('FAIL '+name);console.log((result.stdout+'\n'+result.stderr).slice(-4000));}
  else console.log('PASS '+name);
}
console.log(JSON.stringify({tests:files.length,passed:files.length-failures.length,failures}));
if(failures.length)process.exitCode=1;
