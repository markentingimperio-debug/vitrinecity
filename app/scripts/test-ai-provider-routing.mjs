import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createAiTextClient} from '../ai-text-provider.js';
import {resolveMediaConfig} from '../ai-media-provider.js';
import {openRouterOperation,createIntegrationObserver} from '../integration-health.js';

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

const deepseekEnv={AI_TEXT_PROVIDER:'deepseek',DEEPSEEK_API_KEY:'deepseek-offline-key',AI_TEXT_FALLBACK_PROVIDER:'openai',OPENAI_API_KEY:'openai-offline-key',OPENAI_DIRECT_MODEL:'gpt-4o-mini'};
const textResponse=(model,text='OK')=>({status:'completed',model,output:[{type:'message',content:[{type:'output_text',text}]}]});

test('actual editorial entry uses DeepSeek and observer records rejection and OpenAI fallback separately',async()=>{
  const calls=[],observer=createIntegrationObserver();
  const aiTextClient=createAiTextClient({env:deepseekEnv,fetchImpl:async(url,options)=>{
    calls.push({url,body:JSON.parse(options.body)});
    return calls.length===1?{ok:false,status:429,json:async()=>({error:{code:'rate_limit'}})}:{ok:true,status:200,json:async()=>textResponse('gpt-4o-mini')};
  }});
  const context=vm.createContext({aiTextClient,AI_TEXT_CONFIG:aiTextClient.config,OPENAI_MODEL:aiTextClient.config.model,integrationObserver:observer,
    fetch:()=>{throw Error('legacy fetch forbidden');},openRouterRequest:()=>{throw Error('legacy router forbidden');}});
  vm.runInContext(section('function responseOutputText(', 'function decodeHtmlText(')+section('async function requestOpenAI(', 'function openRouterHeaders(')+section('async function requestEditorialText(', 'async function generateEditorialDraft('),context);
  assert.equal(await vm.runInContext("requestEditorialText('SYSTEM','USER',80)",context),'OK');
  assert.deepEqual(calls.map(c=>c.url),['https://api.deepseek.com/responses','https://api.openai.com/v1/responses']);
  assert.deepEqual(calls.map(c=>c.body.model),['deepseek-flash','gpt-4o-mini']);
  assert.equal(observer.snapshot().find(item=>item.id==='deepseek_text').status,'failed');
  assert.equal(observer.snapshot().find(item=>item.id==='openai_text').status,'completed');
});

test('actual editorial auto routing does not fall back after uncertain OpenRouter consumption',async()=>{
  let calls=0;const aiTextClient=createAiTextClient({env:{OPENROUTER_API_KEY:'fixture-key',OPENAI_API_KEY:'fixture-openai'},fetchImpl:async()=>{calls++;throw Error('unknown transport');}});
  const context=vm.createContext({aiTextClient,AI_TEXT_CONFIG:aiTextClient.config,OPENAI_MODEL:aiTextClient.config.model,integrationObserver:createIntegrationObserver(),
    fetch:()=>{assert.fail('legacy direct OpenAI retry');},openRouterRequest:()=>{assert.fail('legacy router retry');}});
  vm.runInContext(section('function responseOutputText(', 'function decodeHtmlText(')+section('async function requestOpenAI(', 'function openRouterHeaders(')+section('async function requestEditorialText(', 'async function generateEditorialDraft('),context);
  await assert.rejects(vm.runInContext("requestEditorialText('SYSTEM','USER',80)",context),error=>error.code==='AI_TEXT_REQUEST_FAILED');
  assert.equal(calls,1);
});

test('actual public Lia and Live Lia wiring accepts DeepSeek without model override or media calls',async()=>{
  let siteOptions,liveOptions;const calls=[];
  const aiTextClient=createAiTextClient({env:deepseekEnv,fetchImpl:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,status:200,json:async()=>textResponse('deepseek-flash','{"reply":"Olá","offerIds":[]}')};}});
  const context=vm.createContext({aiTextClient,AI_TEXT_CONFIG:aiTextClient.config,integrationObserver:createIntegrationObserver(),
    app:{},db:{},requireAdmin(){},sameOriginOnly(){},currentUser(){},SITE_URL:'https://vitrinecity.com',process:{env:{}},siteSalesExperience:{},
    ecosystemCanRun:()=>true,path:{join:(...args)=>args.join('/')},dir:'/fixture',
    setupSiteSalesAssistant:options=>{siteOptions=options;return {};},createLiveLiaMedia:()=>({config:{configured:false}}),
    setupLiveLia:options=>{liveOptions=options;return {};}});
  vm.runInContext(section('async function requestOpenAI(', 'function openRouterHeaders(')+section('const siteSalesAssistant =', "app.get('/api/admin/media-factory'"),context);
  await siteOptions.requestOpenAI({instructions:'Lia fixture',input:'USER',max_output_tokens:400,store:false});
  await liveOptions.requestText({instructions:'Live fixture',input:'USER',max_output_tokens:350,store:false});
  assert.equal(liveOptions.textConfigured(),true);assert.equal(calls.length,2);
  assert(calls.every(call=>call.url==='https://api.deepseek.com/responses'&&call.body.model==='deepseek-flash'));
  assert.equal(liveOptions.dailyLimit,3);assert.equal(liveOptions.textDailyLimit,20);
  assert.equal(liveOptions.media.config.configured,false);
});

test('actual admin chat stores the observed fallback model and exposes actual provider, not primary configuration',async()=>{
  let handler,result;const writes=[];
  const context=vm.createContext({app:{post:(_path,...handlers)=>{handler=handlers.at(-1);}},requireAdmin(){},aiConfigured:()=>true,
    allowAttempt:()=>true,aiAttempts:new Map(),AI_TEXT_CONFIG:{provider:'deepseek'},OPENAI_MODEL:'deepseek-flash',ADMIN_AI_TOOLS:[],
    db:{prepare:sql=>({all:()=>[],run:(...args)=>{writes.push({sql,args});return {lastInsertRowid:9};}})},
    requestOpenAI:async()=>({...textResponse('gpt-4o-mini-2024-07-18'),aiText:{provider:'openai',model:'gpt-4o-mini-2024-07-18',requestedModel:'gpt-4o-mini',fallbackUsed:true}}),
    responseOutputText:()=> 'OK',console:{error(){assert.fail('unexpected route failure');}}});
  vm.runInContext(section("app.post('/api/admin/ai/chat'", "app.patch('/api/admin/profiles/"),context);
  await handler({user:{id:7},body:{message:'Pergunta sintética'}},{json:value=>{result=value;},status(){return this;}});
  assert.equal(writes.at(-1).args[2],'gpt-4o-mini-2024-07-18');
  assert.equal(result.message.model,'gpt-4o-mini-2024-07-18');assert.equal(result.message.provider,'openai');assert.equal(result.message.fallbackUsed,true);
});
