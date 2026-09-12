import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PRAYER_FORMATS, PRAYER_MEDIA_POLICY_VERSION, PRAYER_MEDIA_RENDERER, generatePrayerMedia, mediaHash, prayerMediaPlan, prayerVideoScript } from '../prayer-media.js';

test('new TikTok renders target 65 seconds without regenerating a ready historical edition', async () => {
  assert.equal(PRAYER_FORMATS.tiktok, 65);
  assert.equal(PRAYER_FORMATS.short, 30);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prayer-duration-'));
  try {
    const day = '2026-09-13', directory = path.join(root, 'prayer-media', day, 'tiktok');
    await fs.mkdir(directory, { recursive: true });
    const videoPath = path.join(directory, 'video.mp4'), bytes = Buffer.from('existing completed video fixture');
    const script = { day, format: 'tiktok', text: 'Existing reviewed prayer' };
    const ready = { day, format: 'tiktok', videoPath, durationSeconds: 61, script, binding: mediaHash(JSON.stringify(script)), sha256: mediaHash(bytes) };
    await fs.writeFile(videoPath, bytes);
    await fs.writeFile(path.join(directory, 'ready.json'), JSON.stringify(ready));
    const actual = await generatePrayerMedia({ day, format: 'tiktok', dataDir: root, publicDir: root, apiKey: '', fetchImpl: () => { throw Error('must not generate again'); } });
    assert.deepEqual(actual, ready);
    assert.deepEqual(await fs.readFile(videoPath), bytes);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

async function fixture(t,format='tiktok'){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'prayer-render-plan-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const day='2026-09-14',directory=path.join(root,'prayer-media',day,format),duration=PRAYER_FORMATS[format],calls=[];
  const script=prayerVideoScript(day,format);
  const options={day,format,dataDir:root,publicDir:root,apiKey:'isolated-fake-key',
    async fetchImpl(url){
      calls.push({kind:'request',url});
      const plan=JSON.parse(await fs.readFile(path.join(directory,'render-plan.json'),'utf8'));
      assert.equal(plan.targetDurationSeconds,duration);assert.equal(plan.scriptBinding,mediaHash(JSON.stringify(script)),'plan exists before a chargeable request');
      if(url.endsWith('/speech')){
        // The audio/probe/renderer are explicit doubles; no real media or API is used.
        const bytes=Buffer.from('RIFF0000WAVEisolated-audio-fixture');
        return {ok:true,arrayBuffer:async()=>bytes};
      }
      const words=script.text.split(/\s+/).map((word,index)=>({word,start:index*.4,end:index*.4+.35}));
      return {ok:true,json:async()=>({text:script.text,words})};
    },
    async execute(command,args){
      calls.push({kind:'process',command,args});
      if(command.endsWith('/ffmpeg')){await fs.writeFile(args.at(-1),Buffer.from('isolated-render-fixture-'+duration));return {stdout:''};}
      if(args.at(-1).endsWith('voice.wav'))return {stdout:JSON.stringify({format:{duration:duration-1.6}})};
      return {stdout:JSON.stringify({streams:[{codec_type:'video',width:720,height:1280,codec_name:'h264',pix_fmt:'yuv420p'},{codec_type:'audio',codec_name:'aac'}],format:{duration}})};
    }};
  return {root,day,directory,duration,calls,options,requests:()=>calls.filter(call=>call.kind==='request')};
}

test('main65 and story30 have explicit versioned plans and unchanged public format IDs',()=>{
  const main=prayerMediaPlan('2026-09-14','tiktok'),story=prayerMediaPlan('2026-09-14','short');
  assert.equal(main.role,'main');assert.equal(main.targetDurationSeconds,65);assert.equal(story.role,'story');assert.equal(story.targetDurationSeconds,30);
  assert.equal(main.editorialPolicyVersion,PRAYER_MEDIA_POLICY_VERSION);assert.equal(main.renderer,PRAYER_MEDIA_RENDERER);assert(Object.isFrozen(main));
  assert.notEqual(main.scriptBinding,story.scriptBinding);assert.throws(()=>prayerMediaPlan('2026-09-14','long'));
});

test('new rendering pipeline passes65/30 to FFmpeg and persists measured duration with its immutable plan',async t=>{
  for(const format of ['tiktok','short']){
    const f=await fixture(t,format),ready=await generatePrayerMedia(f.options);
    const render=f.calls.find(call=>call.command?.endsWith('/ffmpeg'));
    assert.equal(render.args[render.args.indexOf('-t')+1],String(f.duration));assert(render.args.includes('-n'));assert(!render.args.includes('-y'));
    assert.equal(ready.targetDurationSeconds,f.duration);assert.equal(ready.durationSeconds,f.duration);assert.equal(ready.editorialPolicyVersion,PRAYER_MEDIA_POLICY_VERSION);assert.equal(ready.role,format==='short'?'story':'main');
    assert.equal(ready.publicVideoUrl,`https://vitrinecity.com/prayer-media/${f.day}/${format}.mp4`);
    const plan=JSON.parse(await fs.readFile(path.join(f.directory,'render-plan.json'),'utf8'));
    assert.equal(ready.renderPlanHash,mediaHash(JSON.stringify(plan)));assert.equal(f.requests().length,2,'same existing TTS/transcription pair, no video generator');
    const reused=await generatePrayerMedia({...f.options,apiKey:'',canRun:()=>false,fetchImpl:()=>assert.fail('ready must not recharge'),execute:()=>assert.fail('ready must not rerender')});
    assert.deepEqual(reused,ready);
  }
});

test('ready editions for12/13 return the original bytes and manifests even when paused and unconfigured',async t=>{
  const f=await fixture(t);
  for(const day of ['2026-09-12','2026-09-13'])for(const format of ['short','tiktok']){
    const directory=path.join(f.root,'prayer-media',day,format);await fs.mkdir(directory,{recursive:true});
    const videoPath=path.join(directory,'video.mp4'),bytes=Buffer.from(`historical-${day}-${format}`),script={day,format,text:'Existing reviewed prayer'};
    const ready={day,format,videoPath,durationSeconds:format==='tiktok'?61:30,script,binding:mediaHash(JSON.stringify(script)),sha256:mediaHash(bytes)},original=JSON.stringify(ready);
    await fs.writeFile(videoPath,bytes);await fs.writeFile(path.join(directory,'ready.json'),original);
    assert.deepEqual(await generatePrayerMedia({...f.options,day,format,apiKey:'',canRun:()=>false,fetchImpl:()=>assert.fail('no paid calls'),execute:()=>assert.fail('no process')}),ready);
    assert.equal(await fs.readFile(path.join(directory,'ready.json'),'utf8'),original);assert.deepEqual(await fs.readFile(videoPath),bytes);
    await assert.rejects(fs.stat(path.join(directory,'render-plan.json')),{code:'ENOENT'});
  }
});

test('an unversioned incomplete paid draft is retained for review without a new plan or any charge',async t=>{
  for(const name of ['voice-intent.json','voice.wav','transcript-intent.json','transcript.json','rendering.mp4']){
    const f=await fixture(t);await fs.mkdir(f.directory,{recursive:true});const file=path.join(f.directory,name);await fs.writeFile(file,'historical-incomplete-state');
    await assert.rejects(generatePrayerMedia(f.options),/prayer_media_legacy_draft_review/);assert.equal(f.requests().length,0);assert.equal(await fs.readFile(file,'utf8'),'historical-incomplete-state');
    await assert.rejects(fs.stat(path.join(f.directory,'render-plan.json')),{code:'ENOENT'});
  }
});

test('ambiguous paid requests retain their intent and cannot be repeated after restart',async t=>{
  for(const stage of ['speech','transcriptions']){
    const f=await fixture(t),normal=f.options.fetchImpl;let attempted=0;
    f.options.fetchImpl=async url=>{if(url.endsWith('/'+stage)){attempted++;throw Error('simulated ambiguous response');}return normal(url);};
    await assert.rejects(generatePrayerMedia(f.options),/ambiguous response/);
    await assert.rejects(generatePrayerMedia(f.options),{code:'EEXIST'});assert.equal(attempted,1);
    const intent=JSON.parse(await fs.readFile(path.join(f.directory,stage==='speech'?'voice-intent.json':'transcript-intent.json'),'utf8'));assert.equal(intent.binding,prayerMediaPlan(f.day,'tiktok').scriptBinding);
  }
});

test('a pause while persisting either paid intent prevents that request before dispatch',async t=>{
  for(const stage of ['speech','transcriptions']){
    const f=await fixture(t);let allowed=true;
    f.options.canRun=()=>{const result=allowed;if(stage==='speech'||f.requests().length===1)queueMicrotask(()=>{allowed=false;});return result;};
    await assert.rejects(generatePrayerMedia(f.options),/prayer_paused/);
    assert.equal(f.requests().filter(call=>call.url.endsWith('/'+stage)).length,0);
    assert.equal(f.requests().length,stage==='speech'?0:1);
  }
});

test('a local render retry reuses paid audio and transcript only under the same persisted plan',async t=>{
  const f=await fixture(t),execute=f.options.execute;let renders=0;
  f.options.execute=async(command,args)=>{if(command.endsWith('/ffmpeg')&&++renders===1)throw Error('local renderer unavailable');return execute(command,args);};
  await assert.rejects(generatePrayerMedia(f.options),/local renderer unavailable/);assert.equal(f.requests().length,2);
  assert.equal((await generatePrayerMedia(f.options)).durationSeconds,65);assert.equal(f.requests().length,2);assert.equal(renders,2);
});

test('changing a prepared duration is a binding error before any paid request',async t=>{
  const f=await fixture(t);await fs.mkdir(f.directory,{recursive:true});const plan={...prayerMediaPlan(f.day,'tiktok'),targetDurationSeconds:61};
  await fs.writeFile(path.join(f.directory,'render-plan.json'),JSON.stringify(plan));await assert.rejects(generatePrayerMedia(f.options),/prayer_media_plan_changed/);assert.equal(f.requests().length,0);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.directory,'render-plan.json'),'utf8')).targetDurationSeconds,61);
});

test('the measured output must match65s before publication and correcting a local render does not recharge',async t=>{
  const f=await fixture(t),execute=f.options.execute;let incorrect=true;
  f.options.execute=async(command,args)=>{const result=await execute(command,args);if(incorrect&&command.endsWith('/ffprobe')&&!args.at(-1).endsWith('voice.wav')){const info=JSON.parse(result.stdout);info.format.duration=61;return {stdout:JSON.stringify(info)};}return result;};
  await assert.rejects(generatePrayerMedia(f.options),/prayer_render_invalid/);await assert.rejects(fs.stat(path.join(f.directory,'ready.json')),{code:'ENOENT'});assert.equal(f.requests().length,2);assert.equal((await fs.readdir(f.directory)).some(name=>name.startsWith('rendering-')),false,'failed local output does not accumulate across scheduled retries');
  incorrect=false;assert.equal((await generatePrayerMedia(f.options)).durationSeconds,65);assert.equal(f.requests().length,2);
});

test('a new ready manifest cannot contradict its persisted render plan or silently regenerate',async t=>{
  const f=await fixture(t),ready=await generatePrayerMedia(f.options),file=path.join(f.directory,'ready.json');
  for(const durationSeconds of [61,'not-a-duration']){
    await fs.writeFile(file,JSON.stringify({...ready,durationSeconds}));
    await assert.rejects(generatePrayerMedia({...f.options,fetchImpl:()=>assert.fail('must not regenerate')}),/prayer_media_plan_changed/);
    assert.equal(f.requests().length,2);assert.equal(mediaHash(await fs.readFile(ready.videoPath)),ready.sha256);
  }
});

test('concurrent generation of one edition does not duplicate speech or transcription',async t=>{
  const f=await fixture(t),results=await Promise.allSettled([generatePrayerMedia(f.options),generatePrayerMedia(f.options)]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.filter(result=>result.status==='rejected').length,1);assert.equal(f.requests().length,2);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.directory,'ready.json'),'utf8')).durationSeconds,65);
});

test('an existing unpublished video and a late competing output are never overwritten',async t=>{
  const f=await fixture(t);await fs.mkdir(f.directory,{recursive:true});const videoPath=path.join(f.directory,'video.mp4');await fs.writeFile(videoPath,'existing-output');
  await assert.rejects(generatePrayerMedia(f.options),/prayer_media_unpublished_video_review/);assert.equal(f.requests().length,0);assert.equal(await fs.readFile(videoPath,'utf8'),'existing-output');
  const other=await fixture(t),execute=other.options.execute;
  other.options.execute=async(command,args)=>{const result=await execute(command,args);if(command.endsWith('/ffmpeg'))await fs.writeFile(path.join(other.directory,'video.mp4'),'concurrent-winner');return result;};
  await assert.rejects(generatePrayerMedia(other.options),{code:'EEXIST'});assert.equal(await fs.readFile(path.join(other.directory,'video.mp4'),'utf8'),'concurrent-winner');assert.equal((await fs.readdir(other.directory)).some(name=>name.startsWith('rendering-')),false);
  await assert.rejects(fs.stat(path.join(other.directory,'ready.json')),{code:'ENOENT'});
});
