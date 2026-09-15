// Runs the same browser manifest separated by test-platform-release.mjs.
// Fixtures bind loopback; ops/verify-release.sh also denies all external networking.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const appDirectory=fileURLToPath(new URL('../../app/',import.meta.url));
const suites=JSON.parse(readFileSync(new URL('./suites.json',import.meta.url),'utf8'));
assert.ok(Array.isArray(suites)&&suites.length>0,'The browser release manifest must not be empty');
assert.equal(new Set(suites).size,suites.length,'Browser suites must run exactly once');
for(const name of suites){
  assert.ok(/^test-[a-z0-9-]+-browser\.mjs$/.test(name),`Invalid browser suite: ${name}`);
  assert.ok(existsSync(path.join(appDirectory,'scripts',name)),`Missing browser suite: ${name}`);
}
const modulePath=process.env.PLAYWRIGHT_MODULE||fileURLToPath(new URL('./node_modules/playwright/index.mjs',import.meta.url));
assert.ok(existsSync(modulePath),'Install the pinned browser test runtime before running release QA');
const tooling=JSON.parse(readFileSync(new URL('./package.json',import.meta.url),'utf8'));
const actualPlaywright=JSON.parse(readFileSync(path.join(path.dirname(modulePath),'package.json'),'utf8'));
assert.equal(actualPlaywright.version,tooling.dependencies.playwright,'Browser runtime does not match the committed Playwright version');
const appLock=JSON.parse(readFileSync(path.join(appDirectory,'package-lock.json'),'utf8'));
const actualThree=JSON.parse(readFileSync(path.join(appDirectory,'node_modules/three/package.json'),'utf8'));
assert.equal(tooling.dependencies.three,appLock.packages['node_modules/three'].version,'Browser fixture must match the application Three.js version');
assert.equal(actualThree.version,tooling.dependencies.three,'Browser runtime does not match the committed Three.js version');
const failures=[];
for(const name of suites){
  const result=spawnSync(process.execPath,[path.join(appDirectory,'scripts',name)],{
    cwd:appDirectory,
    env:{...process.env,PLAYWRIGHT_MODULE:modulePath},
    encoding:'utf8',
    timeout:180000,
    maxBuffer:8*1024*1024
  });
  if(result.stdout)process.stdout.write(result.stdout);
  if(result.stderr)process.stderr.write(result.stderr);
  if(result.status!==0){failures.push(name);console.error(`FAIL browser ${name}: ${result.error?.message||result.signal||result.status}`);}
  else console.log(`PASS browser ${name}`);
}
console.log(JSON.stringify({browserTests:suites.length,passed:suites.length-failures.length,failures}));
if(failures.length)process.exitCode=1;
