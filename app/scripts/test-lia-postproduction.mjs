import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import Database from 'better-sqlite3';
import express from 'express';
import {createVoiceSyncProviders,speechBody,publicIPv4,createSyncDownloader,boundedBytes} from '../lia-postproduction/providers.mjs';
import {createLocalEditor,runMediaCommand,hashBytes,readPrivate,makeSrt,captionsFromAlignment} from '../lia-postproduction/media.mjs';
import {createLiaPostProduction} from '../lia-postproduction/executor.mjs';
import {mountLiaPostProductionApi} from '../lia-postproduction/http.mjs';
import {createPostProductionCoinBilling} from '../lia-postproduction/coin-billing.mjs';
import {setupLiaVideoPostProduction} from '../lia-postproduction/setup.mjs';
import {createLiaStudioSceneResolver} from '../lia-postproduction/studio-source.mjs';
let root,source,shortAudio,longAudio;
const instances=[];const conversation=randomUUID();
const dimensions={'9:16':[160,284],'16:9':[284,160],'1:1':[160,160]};
const editor=createLocalEditor({dimensions});
before(async()=>{
 root=fs.mkdtempSync(path.join(os.tmpdir(),'lia-post-tests-'));fs.chmodSync(root,0o700);
 source=path.join(root,'source.mp4');
 await runMediaCommand('ffmpeg',['-hide_banner','-nostdin','-v','error','-threads','1','-f','lavfi','-i','color=c=gray:size=160x284:rate=25:duration=15','-an','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',source]);
 for(const [name,duration] of [['short',0.5],['long',6]])await runMediaCommand('ffmpeg',['-hide_banner','-nostdin','-v','error','-f','lavfi','-i',`sine=frequency=440:duration=${duration}`,'-c:a','libmp3lame',path.join(root,name+'.mp3')]);
 shortAudio=fs.readFileSync(path.join(root,'short.mp3'));longAudio=fs.readFileSync(path.join(root,'long.mp3'));
});
after(async()=>{for(const h of instances){h.executor.close();h.db.close();}fs.rmSync(root,{recursive:true,force:true});});
function alignment(text){const characters=Array.from(text);return {characters,character_start_times_seconds:characters.map((_,i)=>i*0.4/characters.length),character_end_times_seconds:characters.map((_,i)=>(i+1)*0.4/characters.length)};}
function specification({count=2,duration=5,mode='narration',captions='burn_in_and_srt',language='pt-BR'}={}){
 return {projectRevisionId:'revision-1',durationSeconds:count*duration,aspectRatio:'9:16',language,audioMode:mode,voiceProfileId:'presenter',captions,
 scenes:Array.from({length:count},(_,i)=>({id:'scene_'+(i+1),durationMs:duration*1000,speech:i?'Muito bem.':'Olá mundo.',speakerVisible:mode==='character_speech'&&i===0,source:'generated_scene'}))};
}
function harness(options={}){
 const work=fs.mkdtempSync(path.join(root,'work-'));fs.chmodSync(work,0o700);
 const db=new Database(path.join(work,'ledger.sqlite'));db.pragma('journal_mode=WAL');
 db.exec(`CREATE TABLE test_balance(scope TEXT PRIMARY KEY,amount INTEGER);INSERT INTO test_balance VALUES('user:1',1000000);
 CREATE TABLE test_reservation(id TEXT PRIMARY KEY,scope TEXT,amount INTEGER,fingerprint TEXT,state TEXT);`);
 let clock=Date.now(),access=true;const calls={voice:0,sync:0,poll:0,download:0};const syncVideos=new Map();
 const transport=async(url,request)=>{
   if(url.startsWith('https://api.elevenlabs.io/')){
     calls.voice++;const body=JSON.parse(request.body);assert.equal(request.headers['xi-api-key'],'test-eleven-key');assert.equal(request.redirect,'error');
     assert.equal(body.language_code,options.language==='en'?'en':'pt');assert(!request.headers.Authorization);
     if(options.voiceTransport)return options.voiceTransport({body,request,calls});
     if(options.lostVoice)throw Error('sensitive provider token must never leak');
     return Response.json({audio_base64:(options.longAudio?longAudio:shortAudio).toString('base64'),alignment:alignment(body.text)});
   }
   if(url==='https://api.sync.so/v2/generate'){
     calls.sync++;assert.equal(request.headers['x-api-key'],'test-sync-key');assert(request.body instanceof FormData);
     assert.deepEqual(JSON.parse(request.body.get('options')),{sync_mode:'cut_off'});const id='task_'+calls.sync;
     syncVideos.set(id,Buffer.from(await request.body.get('video').arrayBuffer()));
     return Response.json({id,model:'lipsync-2',status:'PENDING'},{status:201});
   }
   if(url.startsWith('https://api.sync.so/v2/generate/')){
     calls.poll++;assert.equal(request.method,'GET');const id=url.split('/').at(-1);
     return Response.json({id,model:'lipsync-2',status:options.syncPending?'PROCESSING':'COMPLETED',outputUrl:'https://outputs.example/'+id});
   }
   throw Error('unapproved test request');
 };
 const providers=createVoiceSyncProviders({elevenLabsKey:'test-eleven-key',syncKey:'test-sync-key',fetchImpl:transport});
 const billing={
   quote:()=>({quoteId:randomUUID(),maximumMicroBrl:1000,expiresAt:clock+600000}),
   reserve:({scope,requestId,fingerprint,quote})=>{const row=db.prepare('SELECT * FROM test_reservation WHERE id=?').get(requestId);if(row){assert.equal(row.fingerprint,fingerprint);return;}
     const result=db.prepare('UPDATE test_balance SET amount=amount-? WHERE scope=? AND amount>=?').run(quote.maximumMicroBrl,scope,quote.maximumMicroBrl);assert.equal(result.changes,1);
     db.prepare("INSERT INTO test_reservation VALUES(?,?,?,?,'reserved')").run(requestId,scope,quote.maximumMicroBrl,fingerprint);},
   isReserved:({scope,requestId,fingerprint,quote})=>{const r=db.prepare('SELECT * FROM test_reservation WHERE id=? AND scope=?').get(requestId,scope);return !!r&&r.fingerprint===fingerprint&&r.amount===quote.maximumMicroBrl&&['reserved','held'].includes(r.state);},
   release:({scope,requestId})=>{const r=db.prepare("SELECT * FROM test_reservation WHERE id=? AND scope=? AND state='reserved'").get(requestId,scope);if(r){db.prepare('UPDATE test_balance SET amount=amount+? WHERE scope=?').run(r.amount,scope);db.prepare("UPDATE test_reservation SET state='released' WHERE id=?").run(requestId);}},
   hold:({requestId})=>db.prepare("UPDATE test_reservation SET state='held' WHERE id=? AND state!='released'").run(requestId)
 };
 const config={db,root:work,sourceRoots:[root],enabled:options.enabled??true,providers,editor,now:()=>clock,
   authorize:(scope,conv)=>access&&scope==='user:1'&&conv===conversation,
   resolveSource:async(scope)=>({scope:options.wrongOwner?'user:2':scope,root,localPath:options.source||source,sha256:hashBytes(fs.readFileSync(source)),singleSpeakerApproved:options.speakerApproved??true}),
   resolveVoice:async(scope,_id,language)=>({scope,licensed:options.licensed??true,voiceId:'voice_test_1',model:'eleven_flash_v2_5',language}),billing,
   downloadSync:async(url)=>{calls.download++;return syncVideos.get(new URL(url).pathname.slice(1));}};
 const executor=createLiaPostProduction(config);
 const h={db,work,config,executor,calls,billing,advance:ms=>clock+=ms,revoke:()=>{access=false;},
   async draft(spec=specification()){return executor.prepare('user:1',{conversationId:conversation,sourceJobId:'lv_original',specification:spec});},
   approve(draft){return executor.approve('user:1',draft.id,{approvalFingerprint:draft.approvalFingerprint,quoteId:draft.quote.quoteId,idempotencyKey:'approve-'+draft.id});},
   async finish(draft){for(let i=0;i<400;i++){h.advance(5100);await executor.tick();const row=executor.get('user:1',draft.id);if(!['queued','working','waiting_sync'].includes(row.status))return row;}throw Error('test never finished');}};
 instances.push(h);return h;
}
test('draft and disabled tick do not invoke a provider or reserve a balance',async()=>{const h=harness();await h.draft();assert.equal(await h.executor.tick(),false);assert.equal(h.calls.voice,0);assert.equal(h.db.prepare('SELECT amount FROM test_balance').get().amount,1000000);});
test('approval is explicit, bound and idempotent',async()=>{const h=harness();const d=await h.draft();h.approve(d);h.approve(d);assert.equal(h.db.prepare('SELECT COUNT(*) n FROM test_reservation').get().n,1);assert.equal(h.calls.voice,0);
 assert.throws(()=>h.executor.approve('user:1',d.id,{approvalFingerprint:'bad',quoteId:d.quote.quoteId,idempotencyKey:'abc123456789'}),{code:'postproduction_approval_mismatch'});});
test('changed confirmation key does not create a second debit',async()=>{const h=harness(),d=await h.draft();h.approve(d);assert.throws(()=>h.executor.approve('user:1',d.id,{approvalFingerprint:d.approvalFingerprint,quoteId:d.quote.quoteId,idempotencyKey:'other-key-123456'}),{code:'postproduction_confirmation_conflict'});assert.equal(h.db.prepare('SELECT amount FROM test_balance').get().amount,999000);});
test('actual 10 second MP4, captions and audible track without Sync for narration',async()=>{const h=harness(),d=await h.draft();h.approve(d);const done=await h.finish(d);assert.equal(done.status,'ready_for_review',done.errorCode);assert.equal(h.calls.voice,2);assert.equal(h.calls.sync,0);assert(done.output.audioVerified);assert(Math.abs(done.output.durationMs-10000)<130);assert.equal(done.output.width,160);assert.equal(done.output.languageVerified,false);assert(h.executor.output('user:1',d.id).data.length>1000);assert(h.executor.output('user:1',d.id,'captions').data.toString().includes('Olá mundo.'));assert.throws(()=>h.executor.review('user:1',d.id,{languageAndTextConfirmed:false,visualAndLipSyncConfirmed:true}),{code:'postproduction_review_required'});const accepted=h.executor.review('user:1',d.id,{languageAndTextConfirmed:true,visualAndLipSyncConfirmed:true});assert.equal(accepted.status,'completed');assert.equal(accepted.output.languageVerified,false);assert(accepted.userReview.languageAndTextConfirmed);assert.equal(h.db.prepare('SELECT state FROM test_reservation').get().state,'held');});
test('character speech uses one Sync task only for visible speaker; real remux afterwards',async()=>{const h=harness(),d=await h.draft(specification({mode:'character_speech'}));h.approve(d);const done=await h.finish(d);assert.equal(done.status,'ready_for_review',done.errorCode);assert.deepEqual(h.calls,{voice:2,sync:1,poll:1,download:1});assert.equal(done.output.lipSyncQualityVerified,false);});
test('one minute is six ten-second scenes in one verified MP4',async()=>{const h=harness(),d=await h.draft(specification({count:6,duration:10,captions:'none'}));h.approve(d);const done=await h.finish(d);assert.equal(done.status,'ready_for_review',done.errorCode);assert.equal(h.calls.voice,6);assert(Math.abs(done.output.durationMs-60000)<=120);assert.equal(done.output.captionsPath,null);});
test('English requested in every speech body',async()=>{const h=harness({language:'en'}),d=await h.draft(specification({language:'en',captions:'none'}));h.approve(d);await h.executor.tick();assert.equal(h.calls.voice,1);});
test('speech too long is held for revision, never sped up, cut or sent to Sync',async()=>{const h=harness({longAudio:true}),d=await h.draft(specification({mode:'character_speech'}));h.approve(d);const r=await h.finish(d);assert.equal(r.status,'review_required');assert.equal(r.errorCode,'speech_revision_required');assert.equal(h.calls.voice,1);assert.equal(h.calls.sync,0);});
test('unknown paid voice response is never resent by a later tick',async()=>{const h=harness({lostVoice:true}),d=await h.draft();h.approve(d);const r=await h.finish(d);assert.equal(r.status,'review_required');assert.equal(r.errorCode,'provider_result_unknown');await h.executor.tick();await h.executor.tick();assert.equal(h.calls.voice,1);assert(!JSON.stringify(r).includes('sensitive'));});
test('restart with a DISPATCHING stage never automatically repeats that paid stage',async()=>{const h=harness(),d=await h.draft();h.approve(d);h.db.prepare("INSERT INTO lia_postproduction_stages(job_id,stage_key,paid,state,started_at) VALUES(?,'s0:voice',1,'started',?)").run(d.id,Date.now());const r=await h.finish(d);assert.equal(r.errorCode,'paid_result_requires_reconciliation');assert.equal(h.calls.voice,0);});
test('lease prevents two executor objects from dispatching the same job concurrently',async()=>{let resolve,started;const waiting=new Promise(r=>started=r);const h=harness({voiceTransport:async({body})=>{started();return new Promise(r=>resolve=()=>r(Response.json({audio_base64:shortAudio.toString('base64'),alignment:alignment(body.text)})));}}),d=await h.draft();h.approve(d);const other=createLiaPostProduction(h.config);const first=h.executor.tick();await waiting;assert.equal(await other.tick(),false);resolve();await first;assert.equal(h.calls.voice,1);other.close();});
test('queued cancellation releases once without dispatch',async()=>{const h=harness(),d=await h.draft();h.approve(d);h.executor.cancel('user:1',d.id);h.executor.cancel('user:1',d.id);await h.executor.tick();assert.equal(h.calls.voice,0);assert.equal(h.db.prepare('SELECT amount FROM test_balance').get().amount,1000000);});
test('cancellation during TTS preserves receipt privately, holds budget and never delivers',async()=>{let resolve,started;const waiting=new Promise(r=>started=r);const h=harness({voiceTransport:async({body})=>{started();return new Promise(r=>resolve=()=>r(Response.json({audio_base64:shortAudio.toString('base64'),alignment:alignment(body.text)})));}}),d=await h.draft();h.approve(d);const active=h.executor.tick();await waiting;h.executor.cancel('user:1',d.id);resolve();await active;assert.equal(h.executor.get('user:1',d.id).status,'cancelled');assert.equal(h.db.prepare('SELECT state FROM test_reservation').get().state,'held');assert.throws(()=>h.executor.output('user:1',d.id),{code:'postproduction_output_not_ready'});});
test('expired quote does not reserve budget',async()=>{const h=harness(),d=await h.draft();h.advance(600001);assert.throws(()=>h.approve(d),{code:'postproduction_quote_expired'});assert.equal(h.db.prepare('SELECT COUNT(*) n FROM test_reservation').get().n,0);});
test('revoked access is checked again by the worker',async()=>{const h=harness(),d=await h.draft();h.approve(d);h.revoke();await h.executor.tick();assert.equal(h.calls.voice,0);assert.equal(h.db.prepare('SELECT status FROM lia_postproduction_jobs').get().status,'review_required');});
test('missing reservation blocks dispatch',async()=>{const h=harness(),d=await h.draft();h.approve(d);h.db.prepare("UPDATE test_reservation SET state='released'").run();await h.executor.tick();assert.equal(h.calls.voice,0);});
test('cross-account read, confirmation and download are denied',async()=>{const h=harness(),d=await h.draft();assert.throws(()=>h.executor.get('user:2',d.id),{code:'postproduction_not_found'});assert.throws(()=>h.executor.output('user:2',d.id),{code:'postproduction_not_found'});});
test('wrong asset owner is rejected before reserve/provider',async()=>{const h=harness({wrongOwner:true});await assert.rejects(h.draft(),{code:'source_not_authorized'});assert.equal(h.calls.voice,0);});
test('voice license must be resolved by the server',async()=>{const h=harness({licensed:false});await assert.rejects(h.draft(),{code:'voice_not_authorized'});});
test('visible speaker needs reviewed source evidence before Sync',async()=>{const h=harness({speakerApproved:false});await assert.rejects(h.draft(specification({mode:'character_speech'})),{code:'speaker_review_required'});});
test('source symbolic link is not followed',async()=>{const link=path.join(root,'link-'+randomUUID()+'.mp4');fs.symlinkSync(source,link);const h=harness({source:link});await assert.rejects(h.draft());assert.equal(h.calls.voice,0);fs.unlinkSync(link);});
test('changed private snapshot fails before TTS',async()=>{const h=harness(),d=await h.draft();h.approve(d);fs.appendFileSync(path.join(h.work,d.id,'s0-source.mp4'),'tamper');const r=await h.finish(d);assert.equal(r.errorCode,'source_changed');assert.equal(h.calls.voice,0);});
test('pending Sync receipt survives re-instantiation; only GET is repeated',async()=>{const h=harness({syncPending:true}),d=await h.draft(specification({mode:'character_speech'}));h.approve(d);for(let i=0;i<5;i++){h.advance(5100);await h.executor.tick();}assert.equal(h.calls.sync,1);const other=createLiaPostProduction(h.config);h.advance(5100);await other.tick();assert.equal(h.calls.sync,1);assert(h.calls.poll>=2);other.close();});
test('no more than three active drafts per account',async()=>{const h=harness();await h.draft();await h.draft();await h.draft();await assert.rejects(h.draft(),{code:'postproduction_active_limit'});});
test('disabled executor cannot prepare jobs or call providers',async()=>{const h=harness({enabled:false});await assert.rejects(h.draft(),{code:'postproduction_disabled'});assert.equal(await h.executor.tick(),false);});
test('unsupported language is not silently translated',async()=>{const h=harness();await assert.rejects(h.draft(specification({language:'es'})),{code:'audio_edit_language_invalid'});});
test('models that ignore language_code cannot be selected',()=>{assert.throws(()=>speechBody({voiceId:'voice',model:'eleven_multilingual_v2',language:'pt-BR',text:'Olá'}),{code:'voice_configuration_invalid'});});
test('text and neighboring context stay exactly as approved',()=>{const b=speechBody({voiceId:'voice',model:'eleven_flash_v2_5',language:'pt-BR',text:'Oi, João!',previousText:'Antes.',nextText:'Depois.'});assert.equal(b.text,'Oi, João!');assert.equal(b.language_code,'pt');assert.equal(b.previous_text,'Antes.');assert.equal(b.next_text,'Depois.');});
for(const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','172.18.0.1','192.168.1.1','100.64.0.1','198.18.0.1','224.1.2.3','::1','::ffff:127.0.0.1'])test('reject non-public destination '+ip,()=>assert.equal(publicIPv4(ip),false));
test('public IPv4 is permitted',()=>assert.equal(publicIPv4('8.8.8.8'),true));
for(const url of ['http://allowed.example/video','https://other.example/video','https://user:password@allowed.example/video','https://allowed.example:8443/video','https://allowed.example/video#hash'])test('download rejects '+url,async()=>{const d=createSyncDownloader({allowedHosts:['allowed.example'],lookupImpl:async()=>{throw Error('must not resolve');}});await assert.rejects(d(url),{code:'download_url_denied'});});
test('DNS resolving to private address is blocked',async()=>{const d=createSyncDownloader({allowedHosts:['allowed.example'],lookupImpl:async()=>[{address:'127.0.0.1'}]});await assert.rejects(d('https://allowed.example/video'),{code:'download_address_denied'});});
test('download pins approved DNS and sends no authorization headers',async()=>{
 const d=createSyncDownloader({allowedHosts:['allowed.example'],lookupImpl:async()=>[{address:'8.8.8.8'}],requestImpl:(url,options,callback)=>{
 assert.deepEqual(options.headers,{accept:'video/mp4'});options.lookup(url.hostname,{},(err,address,family)=>{assert.equal(err,null);assert.equal(address,'8.8.8.8');assert.equal(family,4);});
 const req=new EventEmitter();req.destroy=()=>{};req.end=()=>{const response=Readable.from([Buffer.alloc(100)]);response.statusCode=200;response.headers={'content-type':'video/mp4'};callback(response);};return req;
 }});assert.equal((await d('https://allowed.example/video')).length,100);
});
test('bounded provider response rejects excessive bytes',async()=>{await assert.rejects(boundedBytes(new Response(Buffer.alloc(10)),5),{code:'provider_response_too_large'});});
test('large Sync uploads fail before a request',async()=>{let count=0;const p=createVoiceSyncProviders({syncKey:'secret-key',fetchImpl:async()=>count++});await assert.rejects(p.startSync({video:Buffer.alloc(20_000_000),audio:Buffer.alloc(100)}),{code:'sync_upload_limit'});assert.equal(count,0);});
test('caption renderer does not interpret injected ASS/HTML',()=>{const value=makeSrt([{startMs:0,endMs:1000,text:'{\\an8}<script> teste\nFim'}]);assert(!/[{}<>\\]/.test(value.split('\n')[2]));assert(value.includes('00:00:00,000'));});
test('HTTP uses existing authentication, CSRF marker and private previews with byte ranges',async()=>{
 const h=harness(),d=await h.draft();h.approve(d);const ready=await h.finish(d);assert.equal(ready.status,'ready_for_review');
 const app=express();app.use(express.json({limit:'128kb'}));const auth=(req,res,next)=>{const n=Number(req.get('x-test-user'));if(!n)return res.status(401).end();req.user={id:n};next();};
 const api=mountLiaPostProductionApi({app,executor:h.executor,requireUser:auth,sameOriginOnly:(req,res,next)=>req.get('origin')==='https://vitrinecity.com'?next():res.status(403).end()});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port+'/api/neural/chat/postproduction';
 try{
 assert.equal((await fetch(base+'/'+d.id)).status,401);
 assert.equal((await fetch(base+'/'+d.id,{headers:{'x-test-user':'2'}})).status,404);
 const res=await fetch(base+'/'+d.id+'/video',{headers:{'x-test-user':'1',range:'bytes=0-31'}});assert.equal(res.status,206);assert.equal((await res.arrayBuffer()).byteLength,32);assert.equal(res.headers.get('cache-control'),'no-store');
 assert.equal((await fetch(base+'/'+d.id+'/video',{headers:{'x-test-user':'1',range:'bytes=0-1,4-6'}})).status,416);
 assert.equal((await fetch(base+'/'+d.id+'/cancel',{method:'POST',headers:{'x-test-user':'1','content-type':'application/json'},body:'{}'})).status,403);
 const output=await (await fetch(base+'/'+d.id,{headers:{'x-test-user':'1'}})).json();assert(!JSON.stringify(output).includes(h.work));assert(!JSON.stringify(output).includes('test-eleven-key'));
 }finally{await api.close();await new Promise(r=>server.close(r));}
});
test('PR216 source bridge resolves downloaded scene without creating another generation',async()=>{
 const h=harness();h.db.exec("CREATE TABLE lia_video_jobs(id TEXT,user_id INTEGER,status TEXT);CREATE TABLE lia_video_scenes(job_id TEXT,scene_number INTEGER,status TEXT,local_path TEXT);INSERT INTO lia_video_jobs VALUES('lv_original',1,'generating');");
 h.db.prepare("INSERT INTO lia_video_scenes VALUES('lv_original',1,'downloaded',?)").run(source);
 const resolve=createLiaStudioSceneResolver({db:h.db,generatedMediaRoot:root});const r=await resolve('user:1','lv_original',{id:'scene_1',source:'generated_scene'});assert.equal(r.scope,'user:1');assert.equal(r.singleSpeakerApproved,false);await assert.rejects(resolve('user:2','lv_original',{id:'scene_1',source:'generated_scene'}),{code:'source_not_authorized'});
});

test('host setup is inert by default and needs no credentials when disabled',()=>{const setup=setupLiaVideoPostProduction();assert.equal(setup.enabled,false);setup.start();});
test('canonical wallet adapter uses existing reserve/hold/release API and integer ceilings',()=>{
 const log=[],wallet={unified:true,allowsScope:()=>true,reserve:(...v)=>log.push(['reserve',...v]),authorizeReservation:()=>true,release:(...v)=>log.push(['release',...v]),settle:(...v)=>log.push(['settle',...v])};
 const b=createPostProductionCoinBilling({wallet,tariff:{version:'test-only',reviewedAt:Date.now(),speechMicroBrlPer1000Chars:1001,syncMicroBrlPerSecond:201,editingMicroBrl:5}});
 const quote=b.quote({scope:'user:1',billingInputs:{speechCharacters:10,syncMilliseconds:1500}});assert.equal(quote.maximumMicroBrl,11+302+5);
 b.reserve({scope:'user:1',requestId:'id',fingerprint:'hash',quote});b.hold({scope:'user:1',requestId:'id'});assert.equal(log[1][3].actualMicroBrl,null);assert.throws(()=>b.release({scope:'user:1',requestId:'id',reason:'after_dispatch'}),{code:'postproduction_release_denied'});
});
test('expired tariff refuses to quote rather than invent a price',()=>{
 const wallet={unified:true,allowsScope:()=>true,reserve(){},authorizeReservation(){},release(){},settle(){}};
 const b=createPostProductionCoinBilling({wallet,now:()=>Date.now(),tariff:{version:'old',reviewedAt:0,speechMicroBrlPer1000Chars:1,syncMicroBrlPerSecond:1,editingMicroBrl:0}});
 assert.throws(()=>b.quote({scope:'user:1',billingInputs:{speechCharacters:1,syncMilliseconds:0}}),{code:'postproduction_tariff_stale'});
});
