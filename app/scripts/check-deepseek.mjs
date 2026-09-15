// Explicit metadata-only diagnostic. Never sends prompts or creates inference.
import {pathToFileURL} from 'node:url';

export async function checkDeepSeek({env=process.env,fetchImpl=globalThis.fetch,probe=false}={}){
  const key=String(env.DEEPSEEK_API_KEY||'').trim();
  const model=String(env.DEEPSEEK_MODEL||'deepseek-flash').trim();
  const result={provider:'deepseek',configured:Boolean(key),model,probed:false,generationVerified:false};
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(model))return {...result,model:null,code:'model_invalid'};
  if(!key)return {...result,code:'key_missing'};
  if(!probe)return {...result,code:'not_probed'};
  if(!/^[\x21-\x7e]{1,512}$/.test(key))return {...result,code:'key_invalid'};
  const discard=response=>{try{Promise.resolve(response?.body?.cancel()).catch(()=>{});}catch{}};
  try{
    const response=await fetchImpl('https://api.deepseek.com/models',{
      method:'GET',redirect:'error',credentials:'omit',
      headers:{Authorization:`Bearer ${key}`,Accept:'application/json'},signal:AbortSignal.timeout(12000)
    });
    result.probed=true;
    if(!response.ok||response.redirected){discard(response);return {...result,httpStatus:response.status,code:'metadata_rejected'};}
    if(Number(response.headers?.get('content-length'))>65536||!response.body?.getReader){discard(response);return {...result,code:'metadata_invalid'};}
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>65536){await reader.cancel();throw Error();}chunks.push(Buffer.from(part.value));}}
    finally{reader.releaseLock();}
    const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!Array.isArray(data.data))return {...result,code:'metadata_invalid'};
    const modelAvailable=data.data.some(item=>item?.id===model);
    return {...result,authenticated:true,modelAvailable,code:modelAvailable?'model_listed':'model_not_listed'};
  }catch{return {...result,code:'metadata_unavailable'};}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const result=await checkDeepSeek({probe:process.argv.includes('--probe')});
  console.log(JSON.stringify(result));
  if(!['not_probed','model_listed'].includes(result.code))process.exitCode=1;
}
