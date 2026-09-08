import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {deflateSync} from 'node:zlib';
import {createStoryImageProvider} from '../web-story-provider.js';

function crc32(bytes){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;}
function chunk(type,data){const label=Buffer.from(type),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);label.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc32(Buffer.concat([label,data])),out.length-4);return out;}
function png(width=640,height=1024,{headerOnly=false}={}){const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;const signature=Buffer.from([137,80,78,71,13,10,26,10]);return Buffer.concat([signature,chunk('IHDR',header),...(headerOnly?[]:[chunk('IDAT',deflateSync(Buffer.alloc((width*3+1)*height))),chunk('IEND',Buffer.alloc(0))])]);}
async function directory(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vitriny-story-provider-'));try{await fn(dir);}finally{const resolved=path.resolve(dir);if(path.dirname(resolved)===path.resolve(os.tmpdir())&&path.basename(resolved).startsWith('vitriny-story-provider-'))await fs.rm(resolved,{recursive:true,force:true});}}
test('one existing-provider request, deferred real model, inline raster persisted privately to a public asset path',()=>directory(async outputDir=>{
  let calls=0,modelCalls=0;const bytes=png();const provider=createStoryImageProvider({model:()=>{modelCalls++;return 'configured-image-model';},outputDir,request:async(url,options,timeout)=>{calls++;assert.equal(url,'https://openrouter.ai/api/v1/images');assert.equal(options.method,'POST');const body=JSON.parse(options.body);assert.equal(body.model,'configured-image-model');assert.equal(body.n,1);assert.equal(body.aspect_ratio,'9:16');assert.equal(timeout,120000);return {data:{data:[{b64_json:bytes.toString('base64')}]}};}});
  assert.equal(modelCalls,0);const url=await provider('Uma ilustração conceitual vertical');assert.equal(calls,1);assert.equal(modelCalls,1);assert.match(url,/^\/uploads\/generated-videos\/story-ai-[a-f0-9-]+\.png$/);assert.deepEqual(await fs.readFile(path.join(outputDir,path.basename(url))),bytes);
}));
test('URLs, SVG, malformed/oversized bytes and nonportrait dimensions are rejected without output',()=>directory(async outputDir=>{
  const payloads=[{image_url:{url:'https://attacker.test/image.png'}},{b64_json:'data:image/svg+xml;base64,'+Buffer.from('<svg/>').toString('base64')},{b64_json:'%%%bad'},{b64_json:png(640,640).toString('base64')},{b64_json:png(1200,675).toString('base64')},{b64_json:png(639,1000).toString('base64')},{b64_json:png(640,10001,{headerOnly:true}).toString('base64')},{b64_json:Buffer.concat([png(),Buffer.alloc(8*1024*1024)]).toString('base64')}];
  for(const item of payloads){let calls=0;const provider=createStoryImageProvider({model:'configured',outputDir,request:async()=>{calls++;return {data:{data:[item]}};}});await assert.rejects(provider('Teste de validação'));assert.equal(calls,1);}
  assert.deepEqual(await fs.readdir(outputDir),[]);
}));
test('provider failure is not retried; accepted data URLs contain only supported inline image bytes',()=>directory(async outputDir=>{
  let calls=0;const failed=createStoryImageProvider({model:'configured',outputDir,request:async()=>{calls++;throw Error('provider_failure_fixture');}});await assert.rejects(failed('Teste'),/provider_failure_fixture/);assert.equal(calls,1);
  const provider=createStoryImageProvider({model:'configured',outputDir,request:async()=>({data:{images:[{image_url:{url:'data:image/png;base64,'+png().toString('base64')}}]}})});assert.match(await provider('Teste'),/\.png$/);
}));
