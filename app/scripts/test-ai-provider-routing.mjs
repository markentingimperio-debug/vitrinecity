import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createAiTextClient} from '../ai-text-provider.js';
import {resolveMediaConfig} from '../ai-media-provider.js';
import {openRouterOperation} from '../integration-health.js';

const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
const env={OPENAI_API_KEY:'openai-offline-key',OPENROUTER_API_KEY:'router-offline-key',OPENROUTER_MODEL:'nvidia/legacy',AI_TEXT_PROVIDER:'openai',AI_MEDIA_PROVIDER:'openai',OPENAI_DIRECT_MODEL:'gpt-4o-mini',OPENAI_IMAGE_MODEL:'gpt-image-2'};
function section(start,end){const from=source.indexOf(start),to=source.indexOf(end,from+start.length);assert(from>=0&&to>from);return source.slice(from,to);}

test('actual editorial and Gestora entry points use direct Responses with selected model only',async()=>{
  const calls=[],observed=[];
  const aiTextClient=createAiTextClient({env,fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'OK'}]}]})};}});
  const context=vm.createContext({aiTextClient,AI_TEXT_CONFIG:aiTextClient.config,OPENAI_MODEL:aiTextClient.config.model,
    integrationObserver:{run:(id,fn)=>{observed.push(id);return fn();}},fetch:()=>{throw Error('legacy fetch forbidden');},openRouterRequest:()=>{throw Error('router forbidden');}});
  vm.runInContext(section('function responseOutputText(', 'function decodeHtmlText(')+section('async function requestOpenAI(', 'function openRouterHeaders(')+section('async function requestEditorialText(', 'async function generateEditorialDraft('),context);
  assert.equal(await vm.runInContext("requestEditorialText('Synthetic system','Synthetic user',80)",context),'OK');
  assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.openai.com/v1/responses');
  const body=JSON.parse(calls[0].options.body);assert.equal(body.model,'gpt-4o-mini');assert.equal(body.max_output_tokens,80);assert.equal(body.store,false);assert.equal(body.input[1].content[0].type,'input_text');assert.deepEqual(observed,['openai_text']);
});

test('all actual legacy OpenRouter operation types fail before network when explicitly disabled',async()=>{
  let calls=0;
  const context=vm.createContext({URL,AI_TEXT_CONFIG:{provider:'openai'},AI_MEDIA_CONFIG:resolveMediaConfig(env),AI_API_KEY:env.OPENROUTER_API_KEY,openRouterOperation,fetch:()=>{calls++;throw Error('unexpected');}});
  vm.runInContext(section('async function performOpenRouterRequest(', 'function parseEditorialJson('),context);
  for(const suffix of ['responses','chat/completions','images','videos','videos/original-job','key'])await assert.rejects(vm.runInContext(`performOpenRouterRequest('https://openrouter.ai/api/v1/${suffix}')`,context),error=>error.code==='openrouter_disabled'&&error.status===503);
  assert.equal(calls,0);
});

test('actual editorial image setup follows explicit selection and rejects invalid configuration before network',async()=>{
  for(const invalid of [false,true]) {
    let directCalls=0;let coverOptions;
    const current={...env,...(invalid?{OPENAI_IMAGE_MODEL:'qwen/wrong-provider'}:{})};
    const context=vm.createContext({process:{env:current},SITE_URL:'https://vitrinecity.com',generatedMediaDir:'/unused',OPENROUTER_IMAGE_MODEL:'qwen/legacy',
      createMediaProvider:()=>({config:resolveMediaConfig(current)}),integrationObserver:{run:(_id,fn)=>fn()},
      createOpenAIStoryRequest:()=>async()=>{directCalls++;return 'OK';},createEditorialCoverGenerator:options=>{coverOptions=options;return ()=>{};},openRouterRequest:()=>{throw Error('router forbidden');},console:{error(){}}});
    vm.runInContext(section('const rawStoryOpenAIRequest=', 'const webStories ='),context);
    assert.equal(vm.runInContext('storyImageProvider()',context),'openai');assert.equal(coverOptions.openRouterConfigured(),false);
    assert.equal(coverOptions.openAIConfigured(),!invalid);
    if(invalid)await assert.rejects(async()=>vm.runInContext('storyOpenAIRequest()',context),error=>error.message==='ai_media_model_invalid');
    else {assert.equal(vm.runInContext('storyImageModel()',context),'gpt-image-2');assert.equal(await vm.runInContext('storyOpenAIRequest()',context),'OK');}
    assert.equal(directCalls,invalid?0:1);
  }
});

test('manual ad-video script honors media disablement before any fetch or file write',async()=>{
  const script=readFileSync(new URL('./generate-vitrinecity-ad-video.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
  let calls=0;const context=vm.createContext({process:{env},createMediaProvider:()=>({config:resolveMediaConfig(env)}),fetch:()=>{calls++;throw Error('unexpected');},fs:{mkdir(){calls++;},writeFile(){calls++;}},console:{log(){}}});
  await assert.rejects(vm.runInContext('(async()=>{'+script+'})()',context),/vídeos por IA estão indisponíveis/);assert.equal(calls,0);
});

test('Google video selection blocks legacy video routing even when images still select OpenRouter',async()=>{
  let calls=0;
  const context=vm.createContext({URL,AI_TEXT_CONFIG:{provider:'openai'},AI_MEDIA_CONFIG:{provider:'openrouter',videoProvider:'google'},AI_API_KEY:env.OPENROUTER_API_KEY,openRouterOperation,fetch:()=>{calls++;throw Error('unexpected');}});
  vm.runInContext(section('async function performOpenRouterRequest(', 'function parseEditorialJson('),context);
  for(const suffix of ['videos','videos/old-job'])await assert.rejects(vm.runInContext(`performOpenRouterRequest('https://openrouter.ai/api/v1/${suffix}')`,context),error=>error.code==='openrouter_disabled');
  assert.equal(calls,0);
});

test('manual 30-second ad script rejects Google duration without changing its script or sending a request',async()=>{
  const script=readFileSync(new URL('./generate-vitrinecity-ad-video.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
  let calls=0;const context=vm.createContext({createMediaProvider:()=>({config:{videoProvider:'google',videoEnabled:true,videoDurationOptions:[4,6,8]},createVideo(){calls++;}}),fs:{mkdir(){calls++;},writeFile(){calls++;}}});
  await assert.rejects(vm.runInContext('(async()=>{'+script+'})()',context),/roteiro de anúncio tem 30 segundos/);assert.equal(calls,0);
});
