import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {rasterSize} from './web-story-assets.js';

// The existing gestora client owns credentials and provider configuration.
// Only inline image bytes are accepted; no provider-controlled download URL.
export function createStoryImageProvider({request,model,outputDir}) {
  return async prompt=>{
    const result=await request('https://openrouter.ai/api/v1/images',{method:'POST',body:JSON.stringify({model:typeof model==='function'?model():model,prompt:String(prompt).slice(0,1600),n:1,aspect_ratio:'9:16'})},120000);
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
