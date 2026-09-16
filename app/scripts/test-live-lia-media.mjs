import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {createLiveLiaMedia,resolveLiveLiaMediaConfig,liveLiaOverlay,LIVE_LIA_PORTRAIT,LIVE_LIA_PORTRAIT_SHA256} from '../live-lia-media.js';

const digest=value=>createHash('sha256').update(value).digest('hex');
const publicDir=fileURLToPath(new URL('../public/',import.meta.url));
const speech='Olá! Posso ajudar você a conhecer os cuidados com as suas plantas.';
const offer={id:'product:47',title:'Adubo para plantas em vasos',url:'/produto/47/adubo-para-plantas',kind:'product'};
function wav(seconds=1){
  const rate=16000,samples=rate*seconds,bytes=Buffer.alloc(44+samples*2);
  bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(samples*2,40);
  for(let n=0;n<samples;n++)bytes.writeInt16LE(Math.round(Math.sin(n*2*Math.PI*440/rate)*1200),44+n*2);
  return bytes;
}
function fixture(t,{fetchResult,executeResult,reserveResult,environment={},audioDuration=1,videoDuration=audioDuration}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'live-lia-media-qa-')),liveStudioDir=path.join(directory,'live-studio');
  const id=randomUUID(),counts={fetch:0,quota:0,render:0,probe:0},requests=[],commands=[];let allowed=true;
  const env={OPENAI_API_KEY:'synthetic-QA-key',...environment};let lastQuota;
  const f={directory,liveStudioDir,id,counts,requests,commands,env,get allowed(){return allowed;},pause(){allowed=false;},resume(){allowed=true;},paths(answerId=id){const answers=path.join(liveStudioDir,'lia-answers'),job=path.join(answers,'intents',answerId);return {answers,job,intent:path.join(job,'intent.json'),voice:path.join(job,'voice.json'),audio:path.join(job,'voice.wav'),video:path.join(answers,answerId+'.mp4'),manifest:path.join(answers,answerId+'.json'),globalLock:path.join(answers,'preparation.lock'),renderLock:path.join(job,'render.lock')};}};
  function reserveDailyOperation(input){
    counts.quota++;lastQuota=input;const p=f.paths(input.id);assert.equal(JSON.parse(fs.readFileSync(p.intent)).textHash,input.textHash);assert.equal(fs.existsSync(p.globalLock),true);
    return reserveResult?reserveResult(input,f):{allowed:true};
  }
  async function fetchImpl(url,options){
    counts.fetch++;requests.push({url,options});assert.equal(url,'https://api.openai.com/v1/audio/speech');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');
    assert.equal(lastQuota.textHash,digest(JSON.parse(options.body).input));assert.equal(fs.existsSync(f.paths(lastQuota.id).intent),true);assert.equal(allowed,true);
    return fetchResult?fetchResult({url,options},f):new Response(wav(),{headers:{'content-type':'audio/wav'}});
  }
  async function execute(binary,args,options){
    commands.push({binary,args,options});assert.equal(options.windowsHide,true);assert.equal(options.shell,undefined);assert.equal(args.includes('file,pipe'),true);
    if(binary==='qa-ffmpeg'){
      counts.render++;assert.equal(options.timeout,120000);assert.equal(args.includes('2'),true);assert.equal(args.includes('http:'),false);
      if(executeResult)return executeResult({binary,args,options},f);
      // Unit fixture only: the real renderer/probe is exercised by the separate
      // operator's offline FFmpeg QA. No environment switch bypasses it in app.
      fs.writeFileSync(args.at(-1),Buffer.from('unit-test-mp4-output'));return {stdout:''};
    }
    assert.equal(binary,'qa-ffprobe');counts.probe++;
    const info=args.at(-1).endsWith('.wav')?{streams:[{codec_type:'audio',codec_name:'pcm_s16le',channels:1,sample_rate:'16000'}],format:{duration:String(audioDuration)}}:{streams:[{codec_type:'video',codec_name:'h264',width:720,height:1280},{codec_type:'audio',codec_name:'aac'}],format:{duration:String(videoDuration)}};
    return {stdout:JSON.stringify(info)};
  }
  f.build=(overrides={})=>createLiveLiaMedia({env,publicDir,liveStudioDir,reserveDailyOperation,fetchImpl,execute,ffmpegPath:'qa-ffmpeg',ffprobePath:'qa-ffprobe',now:()=>new Date('2026-09-12T12:00:00.000Z'),...overrides});
  f.media=f.build();f.prepare=(extra={},media=f.media)=>media.prepare({id,text:speech,offer,canRun:()=>allowed,...extra});
  t.after(()=>{const target=path.resolve(directory),prefix=path.resolve(os.tmpdir())+path.sep+'live-lia-media-qa-';assert(target.startsWith(prefix));fs.rmSync(target,{recursive:true,force:true});});
  return f;
}

test('factory, public configuration and status do not submit, create files or claim online readiness',t=>{
  const f=fixture(t);assert.equal(f.media.config.configured,true);assert.equal(f.media.config.costUsd,null);assert.equal(f.media.config.paid,true);assert.equal(f.media.config.connected,undefined);
  assert.doesNotMatch(JSON.stringify(f.media.config),/synthetic-QA-key|live-studio/);assert.equal(f.media.status(f.id).state,'not_prepared');assert.equal(fs.existsSync(f.liveStudioDir),false);
  assert.deepEqual(f.counts,{fetch:0,quota:0,render:0,probe:0});assert.equal(resolveLiveLiaMediaConfig({}).configured,false);
  assert.equal(digest(fs.readFileSync(path.join(publicDir,LIVE_LIA_PORTRAIT))),LIVE_LIA_PORTRAIT_SHA256);
});

test('approved text, image and offer produce a bound private manifest with one paid intent',async t=>{
  const f=fixture(t),result=await f.prepare(),p=f.paths(),manifest=JSON.parse(fs.readFileSync(p.manifest)),body=JSON.parse(f.requests[0].options.body);
  assert.equal(f.counts.fetch,1);assert.equal(f.counts.quota,1);assert.equal(f.counts.render,1);assert.equal(body.input,speech);assert.equal(body.voice,'coral');assert.equal(body.model,'gpt-4o-mini-tts');assert.equal(body.response_format,'wav');assert.match(body.instructions,/português brasileiro/);
  assert.equal(result.file,f.id+'.mp4');assert.equal(result.previewUrl,'/api/admin/live-studio/lia/answers/'+f.id+'/media');assert.equal(result.duration,1);assert.equal(manifest.width,720);assert.equal(manifest.height,1280);assert.equal(manifest.sha256,digest(fs.readFileSync(p.video)));assert.equal(manifest.costUsd,null);assert.equal(manifest.portraitSha256,LIVE_LIA_PORTRAIT_SHA256);
  assert.equal(fs.existsSync(p.globalLock),false);assert.equal(fs.existsSync(p.renderLock),false);assert.equal(f.media.status(f.id).state,'ready');assert.equal(JSON.stringify(manifest).includes(speech),false);
  const filter=f.commands.find(row=>row.binary==='qa-ffmpeg').args;assert.equal(filter[filter.indexOf('-i')+1],path.join(publicDir,LIVE_LIA_PORTRAIT));assert.match(filter[filter.indexOf('-vf')+1],/ass=overlay-[a-f0-9-]+\.ass$/);
});

test('cache is validated after restart before quota or key availability and never narrates twice',async t=>{
  const f=fixture(t),first=await f.prepare();const restarted=f.build({env:{}});assert.deepEqual(await f.prepare({},restarted),first);assert.deepEqual(f.counts,{fetch:1,quota:1,render:1,probe:2});
});

test('concurrent clicks and independent answers serialize before a second quota or POST',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;}),f=fixture(t,{fetchResult:(_request,f)=>f.counts.fetch===1?gate:new Response(wav())});const first=f.prepare();
  await assert.rejects(f.prepare(),{code:'live_lia_preparation_busy'});const otherId=randomUUID();await assert.rejects(f.prepare({id:otherId},f.build()),{code:'live_lia_preparation_busy'});
  assert.equal(fs.existsSync(f.paths(otherId).intent),false);assert.equal(f.counts.quota,1);assert.equal(f.counts.fetch,1);release(new Response(wav()));await first;
  await f.prepare({id:otherId});assert.equal(f.counts.quota,2);assert.equal(f.counts.fetch,2);assert.equal(f.counts.render,2);
});

test('timeout, explicit HTTP failure and malformed audio stay unconfirmed across restart',async t=>{
  for(const response of [()=>{throw Error('SECRET timeout');},()=>new Response('unavailable',{status:500}),()=>new Response('not wave')]){
    const f=fixture(t,{fetchResult:response});await assert.rejects(f.prepare(),{code:'live_lia_voice_unconfirmed'});await assert.rejects(f.prepare({},f.build()),{code:'live_lia_voice_unconfirmed'});
    assert.equal(f.counts.fetch,1);assert.equal(f.counts.quota,1);assert.equal(f.counts.render,0);assert.equal(f.media.status(f.id).state,'voice_unconfirmed');assert.doesNotMatch(fs.readFileSync(f.paths().intent,'utf8'),/SECRET/);
  }
});

test('unknown empty speech and interrupted receipt cannot be retried through another approved text',async t=>{
  const f=fixture(t,{fetchResult:()=>new Response(wav().subarray(0,20))});await assert.rejects(f.prepare(),{code:'live_lia_voice_unconfirmed'});
  for(const change of [{text:'Outro texto aprovado.'},{offer:{...offer,title:'Outra oferta'}},{offer:null}])await assert.rejects(f.prepare(change),{code:'live_lia_binding_changed'});
  assert.equal(f.counts.fetch,1);
});

test('pause, quota failure and pause inside the quota callback prevent all paid submission',async t=>{
  const paused=fixture(t);paused.pause();await assert.rejects(paused.prepare(),{code:'live_lia_preparation_paused'});assert.equal(fs.existsSync(paused.liveStudioDir),false);
  const limited=fixture(t,{reserveResult:()=>({allowed:false})});await assert.rejects(limited.prepare(),{code:'live_lia_daily_limit'});assert.equal(limited.counts.fetch,0);assert.equal(limited.counts.quota,1);assert.equal(fs.existsSync(limited.paths().globalLock),false);
  const stopped=fixture(t,{reserveResult:(_input,f)=>{f.pause();return {allowed:true};}});await assert.rejects(stopped.prepare(),{code:'live_lia_preparation_paused'});assert.equal(stopped.counts.fetch,0);
});

test('pause after voice acceptance preserves exact audio and permits only local rendering later',async t=>{
  const f=fixture(t,{fetchResult:(_request,f)=>{f.pause();return new Response(wav());}});await assert.rejects(f.prepare(),{code:'live_lia_preparation_paused'});
  assert.equal(f.media.status(f.id).state,'voice_received');const before=fs.readFileSync(f.paths().audio);f.resume();await f.prepare({},f.build());assert.deepEqual(fs.readFileSync(f.paths().audio),before);assert.equal(f.counts.fetch,1);assert.equal(f.counts.quota,1);assert.equal(f.counts.render,1);
});

test('local encoder failure can be retried without paying again and hides raw process errors',async t=>{
  let broken=true;const f=fixture(t,{executeResult:({args})=>{if(broken)throw Object.assign(Error('SECRET stderr path'),{stderr:'SECRET'});fs.writeFileSync(args.at(-1),'local-render');return {stdout:''};}});
  await assert.rejects(f.prepare(),error=>error.code==='live_lia_render_failed'&&!error.message.includes('SECRET'));assert.equal(f.media.status(f.id).state,'voice_received');broken=false;
  await f.prepare({},f.build());assert.equal(f.counts.fetch,1);assert.equal(f.counts.render,2);assert.equal(f.counts.quota,1);
});

test('audio longer than sixty seconds is held for review, never silently truncated or renarrated',async t=>{
  const f=fixture(t,{audioDuration:60.1});await assert.rejects(f.prepare(),{code:'live_lia_audio_needs_review'});await assert.rejects(f.prepare({},f.build()),{code:'live_lia_audio_needs_review'});assert.equal(f.counts.render,0);assert.equal(f.counts.fetch,1);
});

test('invalid video dimensions/duration cannot become a ready manifest',async t=>{
  const f=fixture(t,{videoDuration:61});await assert.rejects(f.prepare(),{code:'live_lia_render_invalid'});assert.equal(fs.existsSync(f.paths().manifest),false);assert.equal(fs.existsSync(f.paths().video),false);assert.equal(f.counts.fetch,1);
});

test('pause while encoding retains immutable clip but does not return playback approval',async t=>{
  const f=fixture(t,{executeResult:({args},f)=>{fs.writeFileSync(args.at(-1),'render-then-pause');f.pause();return {stdout:''};}});
  await assert.rejects(f.prepare(),{code:'live_lia_preparation_paused'});assert.equal(f.media.status(f.id).state,'ready');const before=fs.readFileSync(f.paths().video);
  await assert.rejects(f.prepare({text:'Texto alterado'}),{code:'live_lia_preparation_paused'});f.resume();await assert.rejects(f.prepare({text:'Texto alterado'}),{code:'live_lia_binding_changed'});await f.prepare();assert.equal(f.counts.fetch,1);assert.equal(f.counts.render,1);assert.deepEqual(fs.readFileSync(f.paths().video),before);
});

test('global stale lock is not stolen across process restart or new answer id',async t=>{
  const f=fixture(t),p=f.paths();fs.mkdirSync(p.answers,{recursive:true});fs.writeFileSync(p.globalLock,JSON.stringify({id:randomUUID(),answerId:randomUUID(),createdAt:'2000-01-01T00:00:00Z'}));
  await assert.rejects(f.prepare({},f.build()),{code:'live_lia_preparation_busy'});assert.equal(f.counts.fetch,0);assert.equal(f.counts.quota,0);assert.equal(fs.existsSync(p.intent),false);
});

test('stale per-answer rendering lock and a partial final file are never overwritten',async t=>{
  const f=fixture(t,{fetchResult:(_request,f)=>{f.pause();return new Response(wav());}});await assert.rejects(f.prepare());f.resume();const p=f.paths();fs.writeFileSync(p.renderLock,JSON.stringify({id:'interrupted'}));await assert.rejects(f.prepare({},f.build()),{code:'live_lia_render_needs_review'});fs.unlinkSync(p.renderLock);
  fs.writeFileSync(p.video,'partial-existing');await assert.rejects(f.prepare(),{code:'live_lia_existing_artifact'});assert.equal(fs.readFileSync(p.video,'utf8'),'partial-existing');assert.equal(f.counts.fetch,1);assert.equal(f.counts.render,0);
});

test('changed saved audio or finished video fails its stored hash without a fresh paid request',async t=>{
  const f=fixture(t,{fetchResult:(_request,f)=>{f.pause();return new Response(wav());}});await assert.rejects(f.prepare());f.resume();fs.appendFileSync(f.paths().audio,'tampered');assert.equal(f.media.status(f.id).state,'review_required');await assert.rejects(f.prepare(),{code:'live_lia_voice_changed'});assert.equal(f.counts.fetch,1);
  const ready=fixture(t);await ready.prepare();fs.appendFileSync(ready.paths().video,'tampered');assert.equal(ready.media.status(ready.id).state,'review_required');await assert.rejects(ready.prepare(),{code:'live_lia_file_changed'});assert.equal(ready.counts.fetch,1);
});

test('invalid identity, text, model, paths and offer destinations fail before quota/network',async t=>{
  const f=fixture(t);
  for(const change of [{id:'../not-id'},{text:' '},{text:'x'.repeat(601)},{text:'<script>bad</script>'},{canRun:async()=>true},{offer:{...offer,url:'https://evil.invalid/a'}},{offer:{...offer,url:'https://vitrinecity.com.evil.invalid/a'}},{offer:{...offer,url:'/admin'}},{offer:{...offer,url:'/cursos/curso?token=private'}},{offer:{...offer,url:'/produto/47/a%2fb'}},{offer:{...offer,url:'/produto/47/a#secret'}}])await assert.rejects(f.prepare(change));
  for(const env of [{},{OPENAI_API_KEY:'qa',LIVE_LIA_TTS_MODEL:'wrong'},{OPENAI_API_KEY:'qa',LIVE_LIA_TTS_VOICE:'wrong'}])await assert.rejects(f.prepare({},f.build({env})),{code:'live_lia_not_configured'});
  await assert.rejects(f.prepare({},f.build({reserveDailyOperation:null})),{code:'live_lia_not_configured'});await assert.rejects(f.prepare({},f.build({liveStudioDir:'relative'})),{code:'live_lia_not_configured'});
  assert.equal(f.counts.fetch,0);assert.equal(f.counts.quota,0);
});

test('approved safe course/service offer and no-offer narration are supported without external assets',async t=>{
  for(const value of [null,{id:'course:plants',title:'Cuidados com plantas',url:'/cursos/cuidados-com-plantas',kind:'course'},{id:'service:site',title:'Página para seu negócio',url:'/servicos-digitais.html?servico=pagina',kind:'service'}]){const f=fixture(t);await f.prepare({offer:value});assert.equal(f.counts.fetch,1);}
});

test('frame identifies AI narration, uses only approved words and escapes subtitle control syntax',()=>{
  const overlay=liveLiaOverlay({text:'Texto aprovado {\\pos(1,1)} sem novas promessas.',offer:{...offer,title:'Título aprovado'},duration:5});
  assert.match(overlay,/Lia · assistente com IA/);assert.match(overlay,/Retrato ilustrativo com narração/);assert.match(overlay,/vitrinecity.com\/produto\/47\/adubo-para-plantas/);assert.match(overlay,/Título aprovado/);assert.doesNotMatch(overlay,/\{\\pos/);assert.doesNotMatch(overlay,/https?:\/\/|garantia|desconto/);
});

test('affiliate disclosure is derived in both frame and durable manifest without arbitrary copy',async t=>{
  const f=fixture(t),affiliate={id:'affiliate:tool',title:'Ferramenta para jardinagem',url:'/ofertas/ferramenta',kind:'affiliate'};await f.prepare({offer:affiliate});
  const manifest=JSON.parse(fs.readFileSync(f.paths().manifest)),overlay=liveLiaOverlay({text:speech,offer:affiliate,duration:1});assert.equal(manifest.disclosure,'Link de afiliado · podemos receber comissão');assert.match(overlay,/Link de afiliado · podemos receber comissão/);
});

test('OBS reader permissions are applied only to deliverables and parent, with private intents retained',()=>{
  const source=fs.readFileSync(new URL('../live-lia-media.js',import.meta.url),'utf8'),body=source.slice(source.indexOf('function workerReadable('),source.indexOf('function offerValue('));
  const calls=[],context=vm.createContext({process:{getuid:()=>0},fs:{chownSync:(...args)=>calls.push(['owner',...args]),chmodSync:(...args)=>calls.push(['mode',...args]),statSync:file=>({isDirectory:()=>file==='answers'})}});
  vm.runInContext(body+'workerReadable("answers");workerReadable("clip.mp4");workerReadable("receipt.json");',context);
  assert.deepEqual(calls,[['owner','answers',10001,10001],['mode','answers',0o750],['owner','clip.mp4',10001,10001],['mode','clip.mp4',0o640],['owner','receipt.json',10001,10001],['mode','receipt.json',0o640]]);
  assert.match(source,/workerReadable\(answers\)/);assert.match(source,/workerReadable\(p\.video\)/);assert.match(source,/workerReadable\(p\.manifest\)/);assert.doesNotMatch(source,/workerReadable\(p\.(?:voice|audio|intent|job)\)/);
  assert.match(source,/openSync\(file,'wx',0o600\)/);assert.match(source,/recursive:true,mode:0o700/);
});

test('oversized clip is not marked ready beyond the private preview thirty MiB limit',async t=>{
  const f=fixture(t,{executeResult:({args})=>{fs.writeFileSync(args.at(-1),Buffer.alloc(30*1024*1024+1));return {stdout:''};}});
  await assert.rejects(f.prepare(),{code:'live_lia_file_invalid'});assert.equal(fs.existsSync(f.paths().manifest),false);assert.equal(f.counts.fetch,1);assert.equal(f.media.status(f.id).state,'voice_received');
});

test('changed portrait cannot consume quota or silently become a new identity',async t=>{
  const f=fixture(t),copy=path.join(f.directory,'public'),image=path.join(copy,LIVE_LIA_PORTRAIT);fs.mkdirSync(path.dirname(image),{recursive:true});fs.copyFileSync(path.join(publicDir,LIVE_LIA_PORTRAIT),image);fs.appendFileSync(image,'tampered');
  await assert.rejects(f.prepare({},f.build({publicDir:copy})),{code:'live_lia_portrait_changed'});assert.equal(f.counts.fetch,0);assert.equal(f.counts.quota,0);
});
