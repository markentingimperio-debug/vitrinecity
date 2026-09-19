import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createKlingPaidVideoAdapter,hashKlingPaidVideoRequest} from '../vitriny-neural/providers/kling-paid-video.js';
import {videoAudioChoice,nativeAudioTariff,NATIVE_AUDIO_720} from '../vitriny-neural/video-audio-policy.js';
import {inspectChatVideo} from '../vitriny-neural/chat-artifacts.js';
const date=Date.parse('2026-09-19T00:01:00.000Z');
for(const [prompt,wanted] of [
 ['Gere um vídeo de uma planta','off'],['Gere um vídeo com áudio','native'],
 ['Gere um vídeo com som de chuva','native'],['Um vídeo de alguém falando','native'],
 ['Uma pessoa dizendo boa noite no vídeo','native'],['Vídeo com narração','native'],
 ['Vídeo com música','native'],['Vídeo silencioso','off'],['Vídeo mudo de alguém falando','off'],
 ['Vídeo sem som, uma pessoa falando','off'],['Vídeo sem áudio','off'],
 ['Vídeo com som de chuva, sem voz','native'],['Vídeo sem fala','off'],
 ['Video with audio','native'],['Video, no audio','off'],['Video speaking','native']]){
 test('audio intent: '+prompt,()=>assert.equal(videoAudioChoice(prompt),wanted));
}
test('conflicting explicit audio settings require clarification',()=>assert.throws(()=>videoAudioChoice('Vídeo com áudio mas sem áudio')));
test('audio tariff is exact and enabled only by server configuration',()=>{
 assert.equal(nativeAudioTariff({nativeAudio720:{...NATIVE_AUDIO_720,enabled:true}},date).usdPerSecond,'0.126');
 for(const c of [{},{nativeAudio720:{...NATIVE_AUDIO_720,enabled:false}},{nativeAudio720:{...NATIVE_AUDIO_720,enabled:true,usdPerSecond:'0.084'}}])assert.throws(()=>nativeAudioTariff(c,date));
});
const data=()=>({prompt:'A fictional speaker says hello.',resolution:'720p',aspectRatio:'16:9',durationSeconds:5,externalTaskId:'audio-external-001'});
function request(c){return {requestId:'audio-request-001',...c,permit:{authorized:true,scope:'user:1',requestId:'audio-request-001',requestHash:hashKlingPaidVideoRequest(c),model:'kling-3.0',accountBinding:'audio-account',policyRevision:'audio-policy',externalTaskId:c.externalTaskId,reservationId:'audio-request-001',quoteId:'audio-quote-001',maximumMicroBrl:'9000000',expiresAt:date+60000}};}
function fixture(){const calls=[];return {calls,adapter:createKlingPaidVideoAdapter({enabled:true,apiKey:'synthetic-not-a-real-key',accountBinding:'audio-account',policyRevision:'audio-policy',now:()=>date,assertAuthorized:()=>true,fetchImpl:async(url,init)=>{
 calls.push({url,body:JSON.parse(init.body)});return new Response(JSON.stringify({code:0,data:{id:'audio-task-001',external_id:'audio-external-001',status:'submitted',create_time:date,update_time:date}}),{headers:{'content-type':'application/json'}});
}})};}
test('silent legacy body hash is unchanged',()=>{
 const c=data(),body={prompt:c.prompt,settings:{resolution:'720p',aspect_ratio:'16:9',duration:5,audio:'off',multi_shot:false},options:{external_task_id:c.externalTaskId,watermark_info:{enabled:false}}};
 assert.equal(hashKlingPaidVideoRequest(c),createHash('sha256').update(JSON.stringify(body)).digest('hex'));
 assert.equal(hashKlingPaidVideoRequest(c),hashKlingPaidVideoRequest({...c,audio:'off'}));
});
test('native audio changes exact authorization hash',()=>assert.notEqual(hashKlingPaidVideoRequest(data()),hashKlingPaidVideoRequest({...data(),audio:'native'})));
test('native audio is sent once to the same Kling 3.0 endpoint',async()=>{
 const f=fixture(),r=await f.adapter.invoke(request({...data(),audio:'native'}));assert.equal(r.status,'accepted');assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].url,'https://api-singapore.klingai.com/text-to-video/kling-3.0');assert.equal(f.calls[0].body.settings.audio,'native');
 assert.equal(f.calls[0].body.settings.multi_shot,false);assert.equal(f.calls[0].body.settings.duration,5);
});
test('changing audio after quote never sends a paid call',async()=>{
 const f=fixture(),q=request(data());q.audio='native';const r=await f.adapter.invoke(q);assert.equal(r.transportStarted,false);assert.equal(f.calls.length,0);
});
test('invalid audio settings are refused, not coerced',()=>{for(const value of [true,false,null,'on','original','',1,{}])assert.throws(()=>hashKlingPaidVideoRequest({...data(),audio:value}));});
function sample(kind){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lia-audio-fixture-')),p=path.join(root,'clip.mp4');
 const args=['-v','error','-f','lavfi','-i','color=c=black:s=320x320:r=5'];
 if(kind==='tone')args.push('-f','lavfi','-i','sine=frequency=440:sample_rate=16000');
 if(kind==='zero')args.push('-f','lavfi','-i','anullsrc=channel_layout=mono:sample_rate=16000');
 args.push('-t','3','-c:v','libx264','-threads','1','-pix_fmt','yuv420p');
 if(kind!=='none')args.push('-c:a','aac');else args.push('-an');
 args.push('-movflags','+faststart',p);
 const r=spawnSync('ffmpeg',args,{timeout:15000});assert.equal(r.status,0,'synthetic video encoder failed');
 return {p,bytes:fs.readFileSync(p),close(){fs.rmSync(root,{recursive:true,force:true});}};
}
test('real FFmpeg/ffprobe accept a nonzero audio stream',()=>{const f=sample('tone');try{assert.equal(inspectChatVideo(f.p,f.bytes,{requireAudio:true}).audioVerified,true);}finally{f.close();}});
test('real FFmpeg/ffprobe refuse an MP4 without audio for an audio request',()=>{const f=sample('none');try{assert.throws(()=>inspectChatVideo(f.p,f.bytes,{requireAudio:true}),{code:'chat_video_audio_missing'});assert.equal(inspectChatVideo(f.p,f.bytes).width,320);}finally{f.close();}});
test('real FFmpeg/ffprobe refuse a silent all-zero audio stream',()=>{const f=sample('zero');try{assert.throws(()=>inspectChatVideo(f.p,f.bytes,{requireAudio:true}),{code:'chat_video_audio_missing'});}finally{f.close();}});
