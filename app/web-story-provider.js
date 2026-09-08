import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {rasterSize} from './web-story-assets.js';

const OPENAI_IMAGE_URL='https://api.openai.com/v1/images/generations',MAX_RESPONSE=16*1024*1024;
const requestError=(code,status)=>Object.assign(Error(code),{code,status});

/** Direct image requests never redirect, retry or expose provider error bodies. */
export function createOpenAIStoryRequest({apiKey=()=>process.env.OPENAI_API_KEY,fetchImpl=fetch}={}) {
  return async(url,options={},timeout=120000)=>{
    if(url!==OPENAI_IMAGE_URL||options.method!=='POST'||typeof options.body!=='string'||options.body.length>32768)throw requestError('openai_story_request_invalid',400);
    let body;try{body=JSON.parse(options.body);}catch{throw requestError('openai_story_request_invalid',400);}
    if(!body||body.n!==1||typeof body.model!=='string'||!body.model.trim())throw requestError('openai_story_request_invalid',400);
    const key=String((typeof apiKey==='function'?apiKey():apiKey)||'').trim();
    if(!key)throw requestError('openai_story_not_configured',503);
    const signal=AbortSignal.timeout(Math.min(120000,Number.isFinite(timeout)?Math.max(1,Math.trunc(timeout)):120000));
    let response;
    try{response=await fetchImpl(OPENAI_IMAGE_URL,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:options.body,redirect:'error',signal});}
    catch{throw requestError(signal.aborted?'openai_story_timeout':'openai_story_network_error',signal.aborted?504:502);}
    if(response.status!==200){await response.body?.cancel?.().catch(()=>{});throw requestError('openai_story_http_error',response.status);}
    if(!/^application\/json(?:\s*;|$)/i.test(String(response.headers.get('content-type')||''))||Number(response.headers.get('content-length'))>MAX_RESPONSE){await response.body?.cancel?.().catch(()=>{});throw requestError('openai_story_response_invalid',502);}
    const reader=response.body?.getReader();if(!reader)throw requestError('openai_story_response_invalid',502);
    let size=0;const chunks=[];
    try{
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_RESPONSE)throw requestError('openai_story_response_too_large',502);chunks.push(Buffer.from(value));}
      let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw requestError('openai_story_response_invalid',502);}
      if(!data||typeof data!=='object'||Array.isArray(data))throw requestError('openai_story_response_invalid',502);
      return {data,headers:response.headers};
    }catch(error){if(typeof error.code==='string'&&error.code.startsWith('openai_story_'))throw error;throw requestError(signal.aborted?'openai_story_timeout':'openai_story_response_invalid',signal.aborted?504:502);}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  };
}

// The existing gestora client owns credentials and provider configuration.
// Only inline image bytes are accepted; no provider-controlled download URL.
export function createStoryImageProvider({request,model,outputDir,provider='openrouter'}) {
  return async prompt=>{
    const selected=typeof provider==='function'?provider():provider;
    if(!['openai','openrouter'].includes(selected))throw requestError('story_provider_invalid',400);
    const actualModel=(typeof model==='function'?model():model)||(selected==='openai'?'gpt-image-2':'qwen/qwen-image-3');
    const body={model:actualModel,prompt:String(prompt).slice(0,1600),n:1,...(selected==='openai'?{size:'1024x1536',quality:'medium'}:{aspect_ratio:'9:16'})};
    const result=await request(selected==='openai'?OPENAI_IMAGE_URL:'https://openrouter.ai/api/v1/images',{method:'POST',body:JSON.stringify(body)},120000);
    const item=result.data?.data?.[0]||result.data?.images?.[0];
    const raw=item?.b64_json||item?.image_url?.url;
    if(typeof raw!=='string'||raw.length>12*1024*1024)throw Error('story_image_invalid');
    const encoded=raw.replace(/^data:image\/(?:png|jpeg|webp);base64,/, '');
    if(!encoded||encoded.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw Error('story_image_invalid');
    const bytes=Buffer.from(encoded,'base64'),size=rasterSize(bytes);
    if(bytes.length>8*1024*1024||Math.min(size.width,size.height)<640||size.width>10000||size.height>10000||size.width*size.height>40000000||size.height<=size.width)throw Error('story_image_quality');
    const file='story-ai-'+randomUUID()+'.'+(size.type==='jpeg'?'jpg':size.type);
    await fs.mkdir(outputDir,{recursive:true});
    await fs.writeFile(path.join(outputDir,file),bytes,{flag:'wx'});
    return '/uploads/generated-videos/'+file;
  };
}
