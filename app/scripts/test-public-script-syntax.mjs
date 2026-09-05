import {readdirSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../public/',import.meta.url));
let checked=0;const failures=[];
function inspect(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){
 const file=path.join(dir,entry.name);if(entry.isDirectory()){inspect(file);continue;}
 if(!entry.name.endsWith('.html'))continue;
 const html=readFileSync(file,'utf8');
 for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  const [,attributes,source]=match,type=attributes.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
  if(!source.trim()||type&&!['module','text/javascript','application/javascript'].includes(type))continue;
  const name=path.relative(root,file)+':'+(html.slice(0,match.index).split('\n').length);checked++;
  try{if(type==='module'){
   const result=spawnSync(process.execPath,['--check','--input-type=module'],{input:source,encoding:'utf8'});
   if(result.status!==0)throw Error(result.stderr);
  }else new vm.Script(source,{filename:name});}
  catch(error){failures.push({file:name,error:error.message});}
 }
}}
inspect(root);console.log(JSON.stringify({checked,failures},null,2));if(failures.length)process.exitCode=1;
