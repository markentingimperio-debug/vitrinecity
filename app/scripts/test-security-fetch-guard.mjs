import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const appRoot=fileURLToPath(new URL('..',import.meta.url));
const calls=[];
const originalFetch=globalThis.fetch;
const originalKey=process.env.OPENROUTER_API_KEY;
const originalOpenAiKey=process.env.OPENAI_API_KEY;

try{
  process.env.OPENROUTER_API_KEY='audit-secret-example';
  process.env.OPENAI_API_KEY='audit-openai-example';
  globalThis.fetch=async(input,init={})=>{
    calls.push({url:String(typeof input==='string'?input:input.url),headers:new Headers(init.headers||(input instanceof Request?input.headers:undefined)),method:init.method,body:init.body});
    return new Response('ok',{status:200});
  };
  await import(`../security-fetch-guard.js?audit=${Date.now()}`);

  await globalThis.fetch('https://cdn.example.invalid/video.mp4',{headers:{Authorization:'Bearer audit-secret-example','X-Test':'1'}});
  assert.equal(calls[0].headers.get('authorization'),null,'AI bearer token must not reach third-party media hosts');
  assert.equal(calls[0].headers.get('x-test'),'1');

  await globalThis.fetch('https://openrouter.ai/api/v1/models',{headers:{Authorization:'Bearer audit-secret-example'}});
  assert.equal(calls[1].headers.get('authorization'),'Bearer audit-secret-example','OpenRouter must retain its own bearer token');

  await globalThis.fetch('https://api.openai.com/v1/responses',{headers:{Authorization:'Bearer audit-secret-example'}});
  assert.equal(calls[2].headers.get('authorization'),null,'OpenAI must never receive the OpenRouter bearer token');
  await globalThis.fetch('https://openrouter.ai/api/v1/models',{headers:{Authorization:'Bearer audit-openai-example'}});
  assert.equal(calls.at(-1).headers.get('authorization'),null,'OpenRouter must never receive the OpenAI bearer token');

  await globalThis.fetch('https://cdn.example.invalid/second.mp4',{headers:{Authorization:'Bearer audit-openai-example'}});
  assert.equal(calls.at(-1).headers.get('authorization'),null,'Both configured credentials must be protected');
  for(const url of ['http://openrouter.ai/api/v1/models','https://openrouter.ai:8443/api/v1/models','https://openrouter.ai.attacker.invalid/video']){
    await globalThis.fetch(url,{headers:{Authorization:'bearer audit-openai-example'}});
    assert.equal(calls.at(-1).headers.get('authorization'),null,'Only the exact HTTPS provider origins may receive AI credentials');
  }
  await globalThis.fetch(new Request('https://cdn.example.invalid/video',{headers:{Authorization:'Bearer audit-openai-example','X-Request':'retained'}}));
  assert.equal(calls.at(-1).headers.get('authorization'),null);
  assert.equal(calls.at(-1).headers.get('x-request'),'retained');
  await globalThis.fetch('https://api.openai.com/v1/responses',{method:'POST',body:'{}',headers:{Authorization:'Bearer audit-openai-example'}});
  assert.equal(calls.at(-1).headers.get('authorization'),'Bearer audit-openai-example');
  assert.equal(calls.at(-1).method,'POST');
  assert.equal(calls.at(-1).body,'{}');
  await globalThis.fetch('https://payments.example.invalid',{headers:{Authorization:'Bearer unrelated-payment-token'}});
  assert.equal(calls.at(-1).headers.get('authorization'),'Bearer unrelated-payment-token','Unrelated integration authentication must be preserved');

  const pkg=JSON.parse(readFileSync(`${appRoot}/package.json`,'utf8'));
  const dockerfile=readFileSync(`${appRoot}/Dockerfile`,'utf8');
  assert.match(pkg.scripts.start,/--import \.\/security-fetch-guard\.js/);
  assert.match(dockerfile,/"--import", "\.\/security-fetch-guard\.js"/);
  console.log(JSON.stringify({ok:true,aiTokenEgressGuard:true,productionStartGuarded:true}));
}finally{
  globalThis.fetch=originalFetch;
  if(originalKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalKey;
  if(originalOpenAiKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalOpenAiKey;
}
