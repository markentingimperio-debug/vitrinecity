// Run in an isolated container without production credentials, data or network.
import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const directory=fileURLToPath(new URL('.',import.meta.url));
const excluded=new Set(['test-platform-release.mjs','test-public-smoke.mjs']);
const files=readdirSync(directory).filter(name=>/^test-.+\.mjs$/.test(name)&&!excluded.has(name)).sort();
const failures=[];
for(const name of files){
  const result=spawnSync(process.execPath,[directory+name],{cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8',timeout:90000});
  if(result.status!==0){failures.push(name);console.log('FAIL '+name);console.log((result.stdout+'\n'+result.stderr).slice(-4000));}
  else console.log('PASS '+name);
}
console.log(JSON.stringify({tests:files.length,passed:files.length-failures.length,failures}));
if(failures.length)process.exitCode=1;
