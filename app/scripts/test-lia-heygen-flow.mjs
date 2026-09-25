import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {createLiaPostProduction} from '../lia-postproduction/executor.mjs';
import {createLocalEditor,runMediaCommand,hashBytes} from '../lia-postproduction/media.mjs';
import {createElevenLabsHeyGenProviders} from '../lia-postproduction/heygen.mjs';
import {createPostProductionCoinBilling} from '../lia-postproduction/coin-billing.mjs';
let root,source,audio;const fixtures=[];
const dimensions={'9:16':[160,284],'16:9':[284,160],'1:1':[160,160]};
before(async()=>{
 root=fs.mkdtempSync(path.join(os.tmpdir(),'heygen-flow-'));fs.chmodSync(root,0o700);source=path.join(root,'source.mp4');
 await runMediaCommand('ffmpeg',['-hide_banner','-nostdin','-v','error','-threads','1','-f','lavfi','-i','color=c=gray:size=160x284:rate=25:duration=10','-an','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',source]);
 await runMediaCommand('ffmpeg',['-hide_banner','-nostdin','-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.4','-c:a','libmp3lame',path.join(root,'voice.mp3')]);
 audio=fs.readFileSync(path.join(root,'voice.mp3'));
});
after(()=>{for(const f of fixtures){for(const e of f.executors)e.close();f.db.close();}fs.rmSync(root,{recursive:true,force:true});});
function spec({count=1,duration=10,speaker=true}={}){return {projectRevisionId:'reviewed-1',durationSeconds:count*duration,aspectRatio:'9:16',language:'pt-BR',audioMode:speaker?'character_speech':'narration',voiceProfileId:'approved-voice',captions:'none',scenes:Array.from({length:count},(_,i)=>({id:'scene_'+(i+1),durationMs:duration*1000,speech:'Olá!',speakerVisible:speaker,source:'generated_scene'}))};}
function fixture({lost=false,onUpload=null}={}){
 const work=fs.mkdtempSync(path.join(root,'job-'));fs.chmodSync(work,0o700);const db=new Database(path.join(work,'jobs.sqlite'));db.pragma('journal_mode=WAL');
 db.exec('CREATE TABLE reserved(id TEXT PRIMARY KEY,hash TEXT,amount INTEGER,state TEXT);');
 const conversationId=randomUUID(),assets=new Map(),jobs=new Map(),calls={voice:0,upload:0,create:0,poll:0};let clock=Date.now();
 const fetchImpl=async(url,request)=>{
  if(url.startsWith('https://api.elevenlabs.io/')){calls.voice++;return Response.json({audio_base64:audio.toString('base64'),alignment:{characters:['O','l','á','!'],character_start_times_seconds:[0,.05,.1,.2],character_end_times_seconds:[.05,.1,.2,.3]}});}
  assert(url.startsWith('https://api.heygen.com/'));
  if(url.endsWith('/assets')){calls.upload++;if(onUpload)onUpload();const file=request.body.get('file'),id='asset_'+calls.upload;assets.set(id,Buffer.from(await file.arrayBuffer()));return Response.json({data:{asset_id:id,mime_type:file.type,size_bytes:file.size}});}
  if(request.method==='POST'){calls.create++;if(lost)throw Error('provider secret not exposed');const body=JSON.parse(request.body),id='ls_'+calls.create;jobs.set(id,assets.get(body.video.asset_id));return Response.json({data:{lipsync_id:id}});}
  calls.poll++;return Response.json({data:{id:url.split('/').at(-1),status:'completed',duration:10,video_url:'https://files.heygen.ai/'+url.split('/').at(-1)}});
 };
 const providers=createElevenLabsHeyGenProviders({elevenLabsKey:'test-eleven-key',heygenKey:'test-heygen-key',accountBinding:'f'.repeat(64),fetchImpl});
 const billing={quote:()=>({quoteId:randomUUID(),maximumMicroBrl:100,expiresAt:clock+600000}),
 reserve:({requestId,fingerprint,quote})=>db.prepare("INSERT OR IGNORE INTO reserved VALUES(?,?,?,'reserved')").run(requestId,fingerprint,quote.maximumMicroBrl),
 isReserved:({requestId,fingerprint})=>{const r=db.prepare('SELECT * FROM reserved WHERE id=?').get(requestId);return !!r&&r.hash===fingerprint&&r.state!=='released';},
 hold:({requestId})=>db.prepare("UPDATE reserved SET state='held' WHERE id=?").run(requestId),
 release:({requestId})=>db.prepare("UPDATE reserved SET state='released' WHERE id=?").run(requestId)};
 const cfg={db,root:work,sourceRoots:[root],enabled:true,providers,now:()=>clock,editor:createLocalEditor({dimensions}),billing,
  authorize:(scope,conv)=>scope==='user:1'&&conv===conversationId,
  resolveSource:async scope=>({scope,root,localPath:source,sha256:hashBytes(fs.readFileSync(source)),singleSpeakerApproved:true}),
  resolveVoice:async(scope,_id,language)=>({scope,language,licensed:true,voiceId:'test-voice',model:'eleven_flash_v2_5'}),
  downloadSync:async url=>jobs.get(new URL(url).pathname.slice(1))};
 const executor=createLiaPostProduction(cfg);const f={db,cfg,executor,executors:[executor],calls,
 draft:s=>executor.prepare('user:1',{conversationId,sourceJobId:'lv_test',specification:s||spec()}),
 approve:(d,e=executor)=>e.approve('user:1',d.id,{quoteId:d.quote.quoteId,approvalFingerprint:d.approvalFingerprint,idempotencyKey:'approval-'+d.id}),
 async finish(d){for(let i=0;i<200;i++){clock+=5100;await executor.tick();const row=executor.get('user:1',d.id);if(!['queued','working','waiting_sync'].includes(row.status))return row;}throw Error('not finished');}};
 fixtures.push(f);return f;
}
test('draft quotes HeyGen explicitly, zero uploads and no reserved money',async()=>{const f=fixture(),d=await f.draft();assert.deepEqual(d.quote.synchronization,{provider:'heygen',mode:'precision'});assert.equal(f.calls.upload,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM reserved').get().n,0);});
test('actual local MP4 after ElevenLabs and HeyGen simulated transports',async()=>{const f=fixture(),d=await f.draft();f.approve(d);const r=await f.finish(d);assert.equal(r.status,'ready_for_review',r.errorCode);assert.equal(r.output.audioVerified,true);assert(Math.abs(r.output.durationMs-10000)<=120);assert.deepEqual(f.calls,{voice:1,upload:2,create:1,poll:1});assert(f.executor.output('user:1',d.id).data.length>1000);});
test('six ten second scenes form one minute and preserve approved voice',async()=>{const f=fixture(),d=await f.draft(spec({count:6,duration:10}));f.approve(d);const r=await f.finish(d);assert.equal(r.status,'ready_for_review',r.errorCode);assert(Math.abs(r.output.durationMs-60000)<=120);assert.equal(f.calls.voice,6);assert.equal(f.calls.create,6);});
test('narration never uploads to HeyGen',async()=>{const f=fixture(),d=await f.draft(spec({speaker:false}));f.approve(d);const r=await f.finish(d);assert.equal(r.status,'ready_for_review',r.errorCode);assert.equal(f.calls.upload,0);assert.equal(f.calls.create,0);});
test('lost paid HeyGen POST remains held with no retry',async()=>{const f=fixture({lost:true}),d=await f.draft();f.approve(d);const r=await f.finish(d);assert.equal(r.status,'review_required');assert.equal(r.errorCode,'heygen_result_unknown');await f.executor.tick();assert.equal(f.calls.create,1);assert.equal(f.db.prepare('SELECT state FROM reserved').get().state,'held');});
test('another provider cannot approve or take an old job',async()=>{const f=fixture(),d=await f.draft();const providers={...f.cfg.providers,synchronizationBinding:'sync:lipsync-2'};const other=createLiaPostProduction({...f.cfg,providers});f.executors.push(other);assert.throws(()=>f.approve(d,other),{code:'postproduction_provider_changed'});f.approve(d);assert.equal(await other.tick(),false);assert.equal(f.calls.voice,0);});
test('cancel during first asset upload prevents second upload and paid lip sync',async()=>{let cancel;const f=fixture({onUpload:()=>cancel?.()}),d=await f.draft();f.approve(d);cancel=()=>f.executor.cancel('user:1',d.id);const r=await f.finish(d);assert.equal(r.status,'cancelled');assert.equal(f.calls.upload,1);assert.equal(f.calls.create,0);});
test('price for Sync may not silently be reused for HeyGen',()=>{const wallet={unified:true,allowsScope:()=>true,reserve(){},authorizeReservation(){},release(){},settle(){}};const billing=createPostProductionCoinBilling({wallet,tariff:{version:'test',reviewedAt:Date.now(),speechMicroBrlPer1000Chars:1,syncMicroBrlPerSecond:1,editingMicroBrl:1}});assert.throws(()=>billing.quote({scope:'user:1',billingInputs:{speechCharacters:10,syncMilliseconds:5000,synchronization:{provider:'heygen',mode:'precision'}}}),{code:'heygen_tariff_not_reviewed'});});

test('project shorter than ten seconds is refused by the existing plan, without dispatch',async()=>{const f=fixture();await assert.rejects(f.draft(spec({duration:5})),{code:'audio_edit_duration_invalid'});assert.deepEqual(f.calls,{voice:0,upload:0,create:0,poll:0});});
