import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const appRoot=fileURLToPath(new URL('..',import.meta.url));
const calls=[];
const originalFetch=globalThis.fetch;
const originalKey=process.env.OPENROUTER_API_KEY;

try{
  process.env.OPENROUTER_API_KEY='audit-secret-example';
  globalThis.fetch=async(input,init={})=>{
    calls.push({url:String(typeof input==='string'?input:input.url),headers:new Headers(init.headers)});
    return new Response('ok',{status:200});
  };
  await import(`../security-fetch-guard.js?audit=${Date.now()}`);

  await globalThis.fetch('https://cdn.example.invalid/video.mp4',{headers:{Authorization:'Bearer audit-secret-example','X-Test':'1'}});
  assert.equal(calls[0].headers.get('authorization'),null,'AI bearer token must not reach third-party media hosts');
  assert.equal(calls[0].headers.get('x-test'),'1');

  await globalThis.fetch('https://openrouter.ai/api/v1/models',{headers:{Authorization:'Bearer audit-secret-example'}});
  assert.equal(calls[1].headers.get('authorization'),'Bearer audit-secret-example','OpenRouter must retain its own bearer token');

  await globalThis.fetch('https://api.openai.com/v1/responses',{headers:{Authorization:'Bearer audit-secret-example'}});
  assert.equal(calls[2].headers.get('authorization'),'Bearer audit-secret-example','OpenAI must retain its own bearer token');

  const pkg=JSON.parse(readFileSync(`${appRoot}/package.json`,'utf8'));
  const dockerfile=readFileSync(`${appRoot}/Dockerfile`,'utf8');
  assert.match(pkg.scripts.start,/--import \.\/security-fetch-guard\.js/);
  assert.match(dockerfile,/"--import", "\.\/security-fetch-guard\.js"/);
  console.log(JSON.stringify({ok:true,aiTokenEgressGuard:true,productionStartGuarded:true}));
}finally{
  globalThis.fetch=originalFetch;
  if(originalKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalKey;
}
