import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import express from 'express';
import {createLiveLia,setupLiveLia} from '../live-lia.js';
import {createLiveLiaMedia} from '../live-lia-media.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const result=(reply='O substrato precisa permitir a drenagem, conforme a descrição do produto.',offerId='product:1')=>({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply,offerId})}]}]});
function fixture(t,overrides={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'live-lia-')),db=new Database(':memory:');
  const state={running:true,time:Date.parse('2026-09-12T15:00:00Z'),textCalls:0,voiceCalls:0,text:async()=>result(),duringVoice:null};
  let context={kind:'product',title:'Substrato para vasos',path:'/produto/1/substrato',commercial:true,body:'Substrato para vasos. A descrição recomenda boa drenagem.',updatedAt:'2026-09-12'},offer={id:'product:1',title:'Substrato para vasos',url:'/produto/1/substrato',kind:'product',description:'Descrição publicada.'};
  let service;
  const media={config:{configured:true},prepare:async input=>{
    state.voiceCalls++;assert.equal(input.canRun(),true);assert.deepEqual(service.reserveDailyOperation({id:input.id,textHash:hash(input.text)}),{allowed:true});
    if(state.duringVoice)await state.duringVoice(input);if(!input.canRun())throw Error('source changed');
    const bytes=Buffer.from('synthetic-verified-media-'+input.id),directory=path.join(root,'lia-answers');fs.mkdirSync(directory,{recursive:true});
    const file=input.id+'.mp4';fs.writeFileSync(path.join(directory,file),bytes);
    const metadata={answerId:input.id,file,sha256:hash(bytes),bytes:bytes.length,duration:12,width:720,height:1280};fs.writeFileSync(path.join(directory,input.id+'.json'),JSON.stringify(metadata));
    return {...metadata,previewUrl:'/api/admin/live-studio/lia/answers/'+input.id+'/media'};
  }};
  const options={db,root,resolveContext:value=>context&&value===context.path?context:null,offersFor:()=>offer?[offer]:[],requestText:async body=>{state.textCalls++;assert.equal(body.store,false);return state.text(body);},textConfigured:()=>true,media,canRun:()=>state.running,now:()=>state.time,...overrides};
  service=createLiveLia(options);
  t.after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
  const enqueue=(actor=1,changes={})=>service.enqueue(actor,{clientKey:randomUUID(),contextPath:'/produto/1/substrato',question:'Como cuidar das minhas plantas?',...changes});
  const approved=()=>{let item=enqueue();item=service.review(1,item.id,{revision:item.revision,reply:'Este substrato pode ser conferido na página do produto.',offerId:'product:1',approved:true});return item;};
  const ready=async()=>{const item=approved();return service.voice(1,item.id,{revision:item.revision,expectedHash:item.approvedHash});};
  const studio=(changes={})=>fs.writeFileSync(path.join(root,'status.json'),JSON.stringify({updatedAt:state.time,streaming:false,recording:false,...changes}));
  return {root,db,state,service,options,media,enqueue,approved,ready,studio,setContext:value=>context=value,setOffer:value=>offer=value};
}

test('opening the administrative queue is read-only and reports actual manual/voice/limits without starting providers',t=>{
  const f=fixture(t),status=f.service.status(1);assert.equal(status.audienceMode,'manual');assert.equal(status.lipSync,false);assert.equal(status.studio.online,false);assert.equal(status.quota.voice.limit,3);assert.equal(status.quota.text.limit,20);assert.equal(status.items.length,0);assert.equal(f.state.textCalls,0);assert.equal(f.state.voiceCalls,0);assert.equal(fs.existsSync(path.join(f.root,'command.json')),false);
});
test('question idempotency and administrative ownership never use the visitor history or collect phone/email',t=>{
  const f=fixture(t),input={clientKey:randomUUID(),question:'Pode ajudar pessoa@example.com +55 11 99999-9999?'},item=f.enqueue(1,input);assert.doesNotMatch(item.question,/example|99999/);assert.equal(f.enqueue(1,input).id,item.id);assert.throws(()=>f.service.review(2,item.id,{revision:1,dismiss:true}),{status:404});
  assert.throws(()=>f.enqueue(1,{...input,question:'Outra pergunta nesta chave'}));assert.notEqual(f.enqueue(2,input).id,item.id);assert.throws(()=>f.enqueue(1,{contextPath:'/admin'}));assert.throws(()=>f.enqueue(1,{question:'<script>alert(1)</script>'}));assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'site_assistant_%'").get().n,0);
});
test('catalog draft is usable with AI disabled and respects source withdrawal before any generation',async t=>{
  const f=fixture(t,{textConfigured:()=>false});let item=f.enqueue();item=await f.service.draft(1,item.id,{revision:1,mode:'catalog'});assert.equal(item.mode,'catalog');assert.match(item.reply,/boa drenagem/);assert.equal(item.status,'draft');assert.equal(f.state.textCalls,0);assert.equal(f.service.status(1).quota.text.used,0);
  const another=f.enqueue();f.setContext(null);await assert.rejects(f.service.draft(1,another.id,{revision:1,mode:'catalog'}),{code:'live_lia_source_changed'});assert.equal(f.service.status(1).items[0].sourceCurrent,false);
});
test('text generation is explicit, reserves once, validates offered IDs and never automatically retries uncertainty',async t=>{
  const f=fixture(t);let item=f.enqueue();item=await f.service.draft(1,item.id,{revision:1,mode:'ai'});assert.equal(item.mode,'ai');assert.equal(f.state.textCalls,1);assert.equal(f.service.status(1).quota.text.used,1);await assert.rejects(f.service.draft(1,item.id,{revision:item.revision,mode:'ai'}));assert.equal(f.state.textCalls,1);
  const unknown=f.enqueue();f.state.text=async()=>{throw Error('provider secret must not leak');};await assert.rejects(f.service.draft(1,unknown.id,{revision:1,mode:'ai'}),{code:'live_lia_result_uncertain'});await assert.rejects(f.service.draft(1,unknown.id,{revision:1,mode:'ai'}));assert.equal(f.state.textCalls,2);
  const repaired=f.service.review(1,unknown.id,{revision:1,reply:'Confira a orientação publicada na página deste produto.',offerId:null,approved:true});assert.equal(repaired.status,'approved');
});
test('pause, concurrent dismissal and changed catalog prevent a late text response from becoming an approved answer',async t=>{
  for(const mode of ['pause','dismiss','source']){
    const f=fixture(t),item=f.enqueue();f.state.text=async()=>{if(mode==='pause')f.state.running=false;else if(mode==='dismiss')f.service.review(1,item.id,{revision:1,dismiss:true});else f.setOffer(null);return result();};
    await assert.rejects(f.service.draft(1,item.id,{revision:1,mode:'ai'}));const saved=f.service.status(1).items[0];assert.notEqual(saved.status,'approved');assert.equal(saved.reply,'');assert.equal(f.state.textCalls,1);
  }
});
test('review uses revision CAS, current catalog and explicit text; no forged offer or silent payment action',t=>{
  const f=fixture(t),item=f.enqueue();assert.throws(()=>f.service.review(1,item.id,{revision:9,reply:'Texto confirmado.',offerId:null,approved:true}));assert.throws(()=>f.service.review(1,item.id,{revision:1,reply:'Texto confirmado.',offerId:'product:999',approved:true}));const reviewed=f.service.review(1,item.id,{revision:1,reply:'Texto confirmado.',offerId:null,approved:true});assert.match(reviewed.approvedHash,/^[a-f0-9]{64}$/);assert.equal(reviewed.revision,2);assert.equal(f.state.voiceCalls,0);assert.equal(fs.existsSync(path.join(f.root,'command.json')),false);
});
test('copying a product message rereads approval and source, keeps affiliate disclosure and never sends it',t=>{
  const f=fixture(t),item=f.approved(),shared=f.service.share(1,item.id);assert.equal(shared.sent,false);assert.equal(shared.url,'https://vitrinecity.com/produto/1/substrato');assert.match(shared.text,/Este substrato/);assert.throws(()=>f.service.share(2,item.id),{status:404});
  f.setOffer(null);assert.throws(()=>f.service.share(1,item.id),{code:'live_lia_source_changed'});assert.equal(f.state.voiceCalls,0);assert.equal(f.state.textCalls,0);
  const g=fixture(t);g.setOffer({id:'affiliate:vaso',title:'Vaso do parceiro',description:'Informações públicas',url:'/ofertas/vaso',kind:'affiliate'});const question=g.enqueue(),approved=g.service.review(1,question.id,{revision:1,reply:'Você pode conferir esta opção de vaso.',offerId:'affiliate:vaso',approved:true});assert.match(g.service.share(1,approved.id).text,/Publicidade · Link de afiliado/);
});
test('voice binds approved text, reserves only three daily preparations and never starts a stream',async t=>{
  const f=fixture(t),first=await f.ready();assert.equal(first.voiceState,'ready');assert.equal(f.service.mediaFile(1,first.id).metadata.sha256,first.media.sha256);assert.equal((await f.service.voice(1,first.id,{revision:first.revision,expectedHash:first.approvedHash})).media.sha256,first.media.sha256);assert.equal(f.state.voiceCalls,1);
  await f.ready();await f.ready();const fourth=f.approved();await assert.rejects(f.service.voice(1,fourth.id,{revision:fourth.revision,expectedHash:fourth.approvedHash}),{code:'live_lia_daily_limit'});assert.equal(f.state.voiceCalls,3);assert.equal(f.service.status(1).quota.voice.remaining,0);assert.equal(fs.existsSync(path.join(f.root,'command.json')),false);
  f.state.time=Date.parse('2026-09-13T02:59:59Z');assert.equal(f.service.status(1).quota.voice.remaining,0);f.state.time++;f.state.time+=999;assert.equal(f.service.status(1).quota.date,'2026-09-13');assert.equal(f.service.status(1).quota.voice.remaining,3);
});
test('voice source withdrawal, pause or failed result stays uncertain and no retry or reapproval can charge again',async t=>{
  const f=fixture(t),item=f.approved();f.state.duringVoice=()=>{f.setOffer(null);};await assert.rejects(f.service.voice(1,item.id,{revision:item.revision,expectedHash:item.approvedHash}),{code:'live_lia_result_uncertain'});assert.equal(f.state.voiceCalls,1);assert.equal(f.service.status(1).items[0].voiceState,'uncertain');await assert.rejects(f.service.voice(1,item.id,{revision:item.revision,expectedHash:item.approvedHash}));assert.equal(f.state.voiceCalls,1);
});
test('the exact local busy result reopens only an unsubmitted voice preparation, requiring another explicit click',async t=>{
  let calls=0;const f=fixture(t,{media:{config:{configured:true},prepare:async()=>{calls++;throw Object.assign(Error('busy'),{code:'live_lia_preparation_busy'});}}}),item=f.approved(),input={revision:item.revision,expectedHash:item.approvedHash};
  await assert.rejects(f.service.voice(1,item.id,input),{code:'live_lia_preparation_busy',status:409});assert.equal(calls,1);assert.equal(f.service.status(1).items[0].voiceState,'');assert.equal(f.service.status(1).quota.voice.used,0);
  await assert.rejects(f.service.voice(1,item.id,input),{code:'live_lia_preparation_busy'});assert.equal(calls,2);
});
test('playback is explicit, hash-bound, one-shot and requires a live or private recording; preview never requests StartStream',async t=>{
  const f=fixture(t),item=await f.ready(),input={answerId:item.id,expectedHash:item.approvedHash};assert.throws(()=>f.service.control(1,{...input,action:'preview-answer'}),{code:'live_lia_studio_offline'});f.studio();assert.throws(()=>f.service.control(1,{...input,action:'play-answer'}),{code:'live_lia_session_required'});
  const preview=f.service.control(1,{...input,action:'preview-answer'});assert.equal(preview.publicationVerified,false);const command=JSON.parse(fs.readFileSync(path.join(f.root,'command.json')));assert.equal(command.action,'preview-answer');assert.equal(command.sha256,item.media.sha256);assert.equal(command.answerId,item.id);assert.doesNotMatch(JSON.stringify(command),/StartStream|rtmps|Texto confirmado/);
  fs.unlinkSync(path.join(f.root,'command.json'));assert.throws(()=>f.service.control(1,{...input,action:'preview-answer'}),{code:'live_lia_answer_already_requested'});
  f.studio({streaming:true});assert.throws(()=>f.service.control(1,{...input,action:'preview-answer'}),{code:'live_lia_preview_requires_idle'});assert.equal(f.service.control(1,{...input,action:'play-answer'}).accepted,true);
});
test('modified bytes, stale source, active answer and a pending command block playback without changing the base config',async t=>{
  const f=fixture(t),item=await f.ready();f.studio({streaming:true,answer:{state:'playing'}});const input={action:'play-answer',answerId:item.id,expectedHash:item.approvedHash};assert.throws(()=>f.service.control(1,input),{code:'live_lia_studio_busy'});f.studio({streaming:true,answer:{state:'failed',cleanupPending:true}});assert.throws(()=>f.service.control(1,input),{code:'live_lia_studio_busy'});f.studio({streaming:true});
  fs.writeFileSync(path.join(f.root,'command.json'),'existing');assert.throws(()=>f.service.control(1,input));assert.equal(fs.readFileSync(path.join(f.root,'command.json'),'utf8'),'existing');fs.unlinkSync(path.join(f.root,'command.json'));
  fs.appendFileSync(path.join(f.root,'lia-answers',item.media.file),'changed');assert.throws(()=>f.service.control(1,input));assert.equal(fs.existsSync(path.join(f.root,'config.json')),false);assert.equal(fs.existsSync(path.join(f.root,'command.json')),false);
});
test('real HTTP routes require admin, origin and JSON; opening/reloading never generates text or voice',async t=>{
  const f=fixture(t),app=express();app.use(express.json());const auth=(req,res,next)=>{if(req.headers['x-admin']!=='1')return res.sendStatus(403);req.user={id:1};next();},origin=(req,res,next)=>req.headers.origin==='https://vitrinecity.com'?next():res.sendStatus(403);
  setupLiveLia({app,requireAdmin:auth,sameOriginOnly:origin,...f.options});const server=await new Promise(resolve=>{const listening=app.listen(0,'127.0.0.1',()=>resolve(listening));});t.after(()=>new Promise(resolve=>server.close(resolve)));const base='http://127.0.0.1:'+server.address().port+'/api/admin/live-studio/lia';
  assert.equal((await fetch(base)).status,403);assert.equal((await fetch(base,{headers:{'x-admin':'1'}})).status,200);assert.equal((await fetch(base+'/questions',{method:'POST',headers:{'x-admin':'1','Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/questions',{method:'POST',headers:{'x-admin':'1',origin:'https://vitrinecity.com','Content-Type':'text/plain'},body:'{}'})).status,415);assert.equal(f.state.textCalls,0);assert.equal(f.state.voiceCalls,0);
});
test('the real media adapter and administrative approval share a durable quota, manifest and private preview contract',async t=>{
  const f=fixture(t);let integrated,calls=0;const wav=Buffer.alloc(32044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
  const media=createLiveLiaMedia({env:{OPENAI_API_KEY:'mock-key'},liveStudioDir:f.root,publicDir:fileURLToPath(new URL('../public/',import.meta.url)),reserveDailyOperation:input=>integrated.reserveDailyOperation(input),fetchImpl:async()=>{calls++;return new Response(wav,{headers:{'content-type':'audio/wav'}});},execute:async(binary,args)=>{
    if(binary==='mock-ffmpeg'){fs.writeFileSync(args.at(-1),'verified fake encoder output');return {stdout:''};}
    assert.equal(binary,'mock-ffprobe');return {stdout:JSON.stringify(args.at(-1).endsWith('.wav')?{streams:[{codec_type:'audio',codec_name:'pcm_s16le',channels:1,sample_rate:'16000'}],format:{duration:'1'}}:{streams:[{codec_type:'video',codec_name:'h264',width:720,height:1280},{codec_type:'audio',codec_name:'aac'}],format:{duration:'1'}})};
  },ffmpegPath:'mock-ffmpeg',ffprobePath:'mock-ffprobe'});
  integrated=createLiveLia({...f.options,media});const item=f.approved(),ready=await integrated.voice(1,item.id,{revision:item.revision,expectedHash:item.approvedHash});assert.equal(ready.voiceState,'ready');assert.equal(calls,1);assert.equal(integrated.status(1).quota.voice.used,1);assert.equal(media.status(item.id).state,'ready');assert.equal(integrated.mediaFile(1,item.id).metadata.sha256,ready.media.sha256);
  await integrated.voice(1,item.id,{revision:item.revision,expectedHash:item.approvedHash});assert.equal(calls,1);assert.equal(fs.existsSync(path.join(f.root,'command.json')),false);
});
