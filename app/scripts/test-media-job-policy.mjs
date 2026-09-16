import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaJobPolicy,requireMediaJob} from '../media-job-policy.js';
import {resolveMediaConfig} from '../ai-media-provider.js';

const openai=resolveMediaConfig({AI_MEDIA_PROVIDER:'openai',OPENAI_API_KEY:'synthetic-key'});
const openrouter=resolveMediaConfig({AI_MEDIA_PROVIDER:'openrouter',OPENROUTER_API_KEY:'synthetic-key'});

test('legacy rows without an explicit provider stay attached to OpenRouter after migration',()=>{
  const job=Object.freeze({format:'short_video',remote_job_id:'job-original',polling_url:'https://openrouter.ai/api/v1/videos/job-original',output_url:'/uploads/generated-videos/approved.mp4'});
  const before=JSON.stringify(job);
  const access=mediaJobPolicy(job,openai);
  assert.equal(access.provider,'openrouter');assert.equal(access.generationAvailable,false);assert.equal(access.syncAvailable,false);
  assert.equal(access.generationBlockCode,'ai_media_job_provider_mismatch');
  assert.throws(()=>requireMediaJob(job,openai),{status:409,code:'ai_media_job_provider_mismatch'});
  assert.equal(JSON.stringify(job),before);
});

test('same-provider legacy video remains eligible while another provider cannot claim its receipt',()=>{
  const job={video_provider:'openrouter',status:'generating',remote_job_id:'job-original'};
  assert.equal(requireMediaJob(job,openrouter).generationAvailable,true);
  assert.equal(mediaJobPolicy(job,openrouter).syncAvailable,true);
  assert.equal(mediaJobPolicy({...job,video_provider:'openai'},openrouter).syncAvailable,false);
  assert.throws(()=>requireMediaJob({...job,video_provider:'openai'},openrouter),{status:409});
});

test('OpenAI images remain independent of disabled new videos and use image provenance',()=>{
  const image={format:'image',image_provider:'openai',video_provider:'openrouter'};
  const allowed=requireMediaJob(image,openai);
  assert.equal(allowed.provider,'openai');assert.equal(allowed.generationAvailable,true);assert.equal(allowed.syncAvailable,false);
  assert.equal(allowed.generationBlockCode,null);
  const oldImage={...image,image_provider:'openrouter',video_provider:'openai'};
  assert.throws(()=>requireMediaJob(oldImage,openai),{status:409,code:'ai_media_job_provider_mismatch'});
});

test('unavailable OpenAI video returns the configured reason without authorizing a new request',()=>{
  const job=Object.freeze({format:'short_video',video_provider:'openai',production_status:'script'});
  const result=mediaJobPolicy(job,openai);
  assert.equal(result.generationAvailable,false);assert.equal(result.syncAvailable,false);
  assert.equal(result.generationBlockCode,'ai_video_unavailable');assert.equal(result.generationBlockReason,openai.videoReason);
  assert.throws(()=>requireMediaJob(job,openai),{status:503,code:'ai_video_unavailable',message:openai.videoReason});
  assert.deepEqual(job,{format:'short_video',video_provider:'openai',production_status:'script'});
});

test('missing image configuration cannot approve image generation despite matching provider',()=>{
  const config=resolveMediaConfig({AI_MEDIA_PROVIDER:'openai',OPENROUTER_API_KEY:'synthetic-unused'});
  assert.throws(()=>requireMediaJob({format:'image',image_provider:'openai'},config),{status:503,code:'ai_image_unavailable'});
});

test('Google video selection is independent of OpenAI images and never claims historical receipts',()=>{
  const config=resolveMediaConfig({AI_MEDIA_PROVIDER:'openai',AI_VIDEO_PROVIDER:'google',OPENAI_API_KEY:'image-test',GEMINI_API_KEY:'video-test'});
  assert.equal(requireMediaJob({format:'image',image_provider:'openai'},config).generationAvailable,true);
  assert.equal(requireMediaJob({format:'short_video',video_provider:'google'},config).syncAvailable,true);
  for(const video_provider of ['openrouter','openai']){
    assert.throws(()=>requireMediaJob({format:'short_video',video_provider},config),{status:409,code:'ai_media_job_provider_mismatch'});
  }
  const noVideoKey=resolveMediaConfig({AI_MEDIA_PROVIDER:'openai',AI_VIDEO_PROVIDER:'google',OPENAI_API_KEY:'image-test'});
  assert.equal(requireMediaJob({format:'image',image_provider:'openai'},noVideoKey).generationAvailable,true);
  assert.throws(()=>requireMediaJob({format:'short_video',video_provider:'google'},noVideoKey),{status:503,code:'ai_video_unavailable'});
});
