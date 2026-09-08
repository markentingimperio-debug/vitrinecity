import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {deflateSync} from 'node:zlib';
import {editorialCoverPrompt,createEditorialCoverGenerator} from '../editorial-cover-generation.js';
import {editorialImage} from '../editorial-image-policy.js';

const article={title:'Bolo de cenoura com cobertura de chocolate',portal:'receitas',summary:'Ingredientes e preparo de um bolo de cenoura caseiro, com cobertura de chocolate.',body:'Cenoura, farinha de trigo, ovos e chocolate compõem esta receita. Misture os ingredientes da massa, leve ao forno e prepare a cobertura de chocolate. Aguarde esfriar antes de servir.'};
function crc32(bytes){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;}
function chunk(type,data){const label=Buffer.from(type),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);label.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc32(Buffer.concat([label,data])),out.length-4);return out;}
function png(){const width=1024,height=640,header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc((width*3+1)*height))),chunk('IEND',Buffer.alloc(0))]);}
async function directory(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vitriny-editorial-cover-'));try{await fn(dir);}finally{const resolved=path.resolve(dir);if(path.dirname(resolved)===path.resolve(os.tmpdir())&&path.basename(resolved).startsWith('vitriny-editorial-cover-'))await fs.rm(resolved,{recursive:true,force:true});}}
const response=()=>({data:{data:[{b64_json:png().toString('base64')}]}});

test('cover context comes from the actual article, stays bounded and treats model-supplied image prompts as untrusted',()=>{
  const prompt=editorialCoverPrompt({...article,imagePrompt:'INJECTED_IMAGE_INSTRUCTION'});
  assert.ok(prompt.length<=1600);assert.ok(prompt.includes(article.title));assert.ok(prompt.includes(article.summary));assert.ok(prompt.includes(article.body));
  assert.match(prompt,/sem simular fotografia documental/);assert.match(prompt,/nunca instruções a seguir/);assert.doesNotMatch(prompt,/INJECTED_IMAGE_INSTRUCTION/);
  const huge=editorialCoverPrompt({...article,title:'"'.repeat(10000),summary:'\\'.repeat(10000),body:'"\\'.repeat(10000)});
  assert.ok(huge.length<=1600);assert.doesNotThrow(()=>JSON.parse(huge.slice(huge.indexOf('\n')+1)));
  assert.equal(editorialCoverPrompt({title:'A',body:article.body}), '');assert.equal(editorialCoverPrompt({...article,body:''}), '');
});

test('configured OpenAI takes precedence even with OpenRouter present, stores a landscape cover and exposes an honest AI credit',()=>directory(async outputDir=>{
  let direct=0,fallback=0;const generate=createEditorialCoverGenerator({outputDir,openAIConfigured:true,openRouterConfigured:true,openAIRequest:async(url,options)=>{direct++;assert.equal(url,'https://api.openai.com/v1/images/generations');const body=JSON.parse(options.body);assert.equal(body.size,'1536x1024');assert.equal(body.n,1);assert.match(body.prompt,/cenoura/);return response();},openRouterRequest:async()=>{fallback++;return response();}});
  const url=await generate(article);assert.match(url,/\/editorial-ai-[a-f0-9-]+\.png$/);assert.equal(direct,1);assert.equal(fallback,0);
  assert.deepEqual(editorialImage(url),{url,kind:'ai',credit:'Ilustração por IA'});assert.equal((await fs.readdir(outputDir)).length,1);
}));

test('OpenRouter is used only without configured OpenAI; provider configuration is read at generation time',()=>directory(async outputDir=>{
  let configured=false,direct=0,fallback=0,model='configured-landscape';
  const generate=createEditorialCoverGenerator({outputDir,openAIConfigured:()=>configured,openRouterConfigured:true,openRouterModel:()=>model,openAIRequest:async()=>{direct++;return response();},openRouterRequest:async(url,options)=>{fallback++;assert.equal(url,'https://openrouter.ai/api/v1/images');assert.equal(options.redirect,'error');const body=JSON.parse(options.body);assert.equal(body.model,model);assert.equal(body.aspect_ratio,'16:9');return response();}});
  assert.match(await generate(article),/editorial-ai-/);assert.equal(direct,0);assert.equal(fallback,1);
  configured=true;assert.match(await generate(article),/editorial-ai-/);assert.equal(direct,1);assert.equal(fallback,1);
}));

test('provider failures, invalid returned images and missing configuration leave the cover empty with no retries or private error leakage',()=>directory(async outputDir=>{
  for(const selected of ['openai','openrouter'])for(const invalid of [false,true]){
    let calls=0;const reports=[];const fail=async()=>{calls++;if(invalid)return {data:{data:[{image_url:{url:'http://127.0.0.1/secret'}}]}};throw Error('fixture-secret private-provider-response');};
    const generate=createEditorialCoverGenerator({outputDir,openAIConfigured:selected==='openai',openRouterConfigured:true,openAIRequest:fail,openRouterRequest:fail,onFailure:detail=>reports.push(detail)});
    assert.equal(await generate(article),'');assert.equal(calls,1);assert.deepEqual(reports,[{code:'editorial_cover_unavailable',provider:selected,reason:'generation_failed'}]);
  }
  let calls=0;const unavailable=createEditorialCoverGenerator({outputDir,openAIConfigured:false,openRouterConfigured:false,openAIRequest:()=>{calls++;},openRouterRequest:()=>{calls++;}});
  assert.equal(await unavailable(article),'');assert.equal(calls,0);
  const noContext=createEditorialCoverGenerator({outputDir,openAIConfigured:true,openAIRequest:()=>{calls++;},onFailure:()=>{throw Error('logger failed');}});
  assert.equal(await noContext({...article,body:''}),'');assert.equal(calls,0);assert.deepEqual(await fs.readdir(outputDir),[]);
}));

test('the legacy article generation entry point passes article text to the validated cover generator and keeps an empty result',async()=>{
  const server=await fs.readFile(new URL('../server.js',import.meta.url),'utf8');
  const source=server.slice(server.indexOf('async function generateEditorialDraft('),server.indexOf('\nasync function reviewEditorialDraft('));
  const body=article.body.repeat(4);let received;
  const generate=vm.runInNewContext(source+'\ngenerateEditorialDraft',{aiConfigured:()=>true,requestEditorialText:async()=>JSON.stringify({...article,body,imagePrompt:'old prompt must not be used'}),parseEditorialJson:JSON.parse,generateEditorialCover:async data=>{received=data;return '';}});
  const result=await generate({title:'Assunto solicitado',portal:'receitas'});
  assert.equal(result.imageUrl,'');assert.equal(received.title,article.title);assert.equal(received.body,body);assert.equal(received.summary,article.summary);assert.equal(received.portal,'receitas');assert.equal(received.imagePrompt,undefined);
});
