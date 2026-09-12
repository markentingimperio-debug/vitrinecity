import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import vm from 'node:vm';import Database from 'better-sqlite3';
import {setupPrayerSharing,prayerScheduledAt,prayerPublicationWindow,prayerScheduleId,isWhatsAppPrayerGroupAllowed,PRAYER_SOCIAL_CHANNELS} from '../prayer-sharing.js';
import {isWhatsAppCommercialGroupAllowed} from '../whatsapp-commercial-policy.js';
import {mediaHash,prayerVideoScript,validatePrayerMedia} from '../prayer-media.js';
import {createWhatsAppScheduleProcessor} from '../whatsapp-schedule-worker.js';
import {run as runMeta,validateManifest,TARGET} from '../prayer-meta-adapter.js';
const DAY='2026-09-12',JID='123456789@g.us';
function fixture(t,extra={}){
 const db=new Database(':memory:'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'prayer-sharing-')),routes=new Map();let date=new Date('2026-09-11T18:00:00Z'),permission=true,global=true,calls=0;
 db.exec(`CREATE TABLE whatsapp_qr_schedules(id TEXT PRIMARY KEY,group_jid TEXT,group_name TEXT,sitemap_url TEXT,message TEXT,scheduled_at TEXT,campaign_id TEXT,status TEXT DEFAULT 'pending',confirmation_state TEXT DEFAULT '',claimed_at INTEGER,provider_message_id TEXT,error TEXT,sent_at TEXT);`);
 const app={get(route,...handlers){routes.set('GET '+route,handlers.at(-1));},post(route,...handlers){routes.set('POST '+route,handlers.at(-1));}};
 const request=async route=>{calls++;if(route==='/session/status')return {connected:true,loggedIn:true,jid:'123@s.whatsapp.net'};if(route==='/group/list')return [{JID,Name:'VitrineCity Oração',Participants:permission?[{JID:'123@s.whatsapp.net',IsAdmin:true}]:[]}];throw Error('Unexpected network request');};
 extra.beforeSetup?.(db);
 const service=setupPrayerSharing({app,db,dataDir:dir,publicDir:dir,requireAdmin(){},sameOriginOnly(){},whatsappQrRequest:request,whatsappQrData:x=>x,canRun:()=>global,now:()=>date,generate:async()=>{throw Error('No generation expected');},...extra});
 const initialSettings=service.snapshot();
 db.prepare('UPDATE prayer_sharing_settings SET enabled=1,instagram_enabled=0,social_enabled=0,groups_json=?').run(JSON.stringify([{jid:JID,name:'VitrineCity Oração'}]));
 function ready(day=DAY){const folder=path.join(dir,'prayer-media',day,'short');fs.mkdirSync(folder,{recursive:true});const videoPath=path.join(folder,'video.mp4'),bytes=Buffer.from('validated fixture media with adequate length');fs.writeFileSync(videoPath,bytes);fs.writeFileSync(path.join(folder,'ready.json'),JSON.stringify({day,format:'short',videoPath,publicVideoUrl:`https://vitrinecity.com/prayer-media/${day}/short.mp4`,caption:'Oração completa de teste. Imagem e voz criadas com inteligência artificial. Amém.',sha256:mediaHash(bytes),script:{title:'Oração de sábado'},durationSeconds:30}));}
 t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {db,dir,service,routes,request,ready,initialSettings,now:()=>date,setDate:d=>date=new Date(d),setPermission:p=>permission=p,setGlobal:p=>global=p,calls:()=>calls};
}
test('7h uses São Paulo time through midnight and year boundaries',()=>{assert.equal(prayerScheduledAt(DAY),'2026-09-12T10:00:00.000Z');assert.equal(prayerScheduledAt('2027-01-01'),'2027-01-01T10:00:00.000Z');assert.equal(prayerPublicationWindow(DAY,new Date('2026-09-12T09:59:59Z')),false);assert.equal(prayerPublicationWindow(DAY,new Date('2026-09-12T10:00:00Z')),true);assert.equal(prayerPublicationWindow(DAY,new Date('2026-09-12T10:45:00Z')),false);assert.throws(()=>prayerScheduledAt('2026-02-30'));});
test('daily queue survives repeated ticks and existing receipts without duplicates',t=>{const f=fixture(t);f.ready();f.service.queue(DAY);f.service.queue(DAY);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM whatsapp_qr_schedules').get().n,1);const row=f.db.prepare('SELECT * FROM whatsapp_qr_schedules').get();assert.equal(row.scheduled_at,prayerScheduledAt(DAY));assert.equal(row.id,prayerScheduleId(DAY,JID));f.db.prepare("UPDATE whatsapp_qr_schedules SET status='sent',provider_message_id='receipt123'").run();f.service.queue(DAY);assert.equal(f.db.prepare('SELECT status FROM whatsapp_qr_schedules').get().status,'sent');});
test('global pause and missing media never queue a message',t=>{const f=fixture(t);f.service.queue(DAY);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM whatsapp_qr_schedules').get().n,0);f.ready();f.setGlobal(false);f.service.queue(DAY);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM whatsapp_qr_schedules').get().n,0);});
test('worker sends the dated video once and requires a real receipt',async t=>{const f=fixture(t);f.ready();f.service.queue(DAY);f.setDate('2026-09-12T10:00:00Z');const sent=[];const worker=createWhatsAppScheduleProcessor({db:f.db,now:f.now,prepareScheduledMessage:f.service.prepareScheduledMessage,whatsappQrData:x=>x,whatsappQrRequest:async(p,options)=>{sent.push({p,body:JSON.parse(options.body)});return {Id:'receipt123'};}});await worker();await worker();assert.equal(sent.length,1);assert.equal(sent[0].p,'/chat/send/video');assert.equal(sent[0].body.Phone,JID);assert.match(sent[0].body.Video,/^data:video\/mp4;base64,/);assert.equal(f.db.prepare('SELECT status,confirmation_state FROM whatsapp_qr_schedules').get().confirmation_state,'confirmed');});
test('uncertain submissions are not retried after restart',async t=>{const f=fixture(t);f.ready();f.service.queue(DAY);f.setDate('2026-09-12T10:00:00Z');let sent=0;const opts={db:f.db,now:f.now,prepareScheduledMessage:f.service.prepareScheduledMessage,whatsappQrData:x=>x,whatsappQrRequest:async()=>{sent++;throw Error('timeout');}};await createWhatsAppScheduleProcessor(opts)();await createWhatsAppScheduleProcessor(opts)();assert.equal(sent,1);assert.equal(f.db.prepare('SELECT confirmation_state FROM whatsapp_qr_schedules').get().confirmation_state,'unknown');});
test('membership, caption and last-moment pause are checked before submission',async t=>{const f=fixture(t);f.ready();f.service.queue(DAY);f.setDate('2026-09-12T10:00:00Z');const row=f.db.prepare('SELECT * FROM whatsapp_qr_schedules').get();f.setPermission(false);await assert.rejects(f.service.prepareScheduledMessage(row));f.setPermission(true);await assert.rejects(f.service.prepareScheduledMessage({...row,message:'changed'}));const request=await f.service.prepareScheduledMessage(row);assert.equal(request.beforeSubmit(),true);f.db.prepare('UPDATE prayer_sharing_settings SET enabled=0,revision=revision+1').run();assert.equal(request.beforeSubmit(),false);});
test('expired editions are cancelled while paused; no catch-up on another day',async t=>{const f=fixture(t);f.ready();f.service.queue(DAY);f.db.prepare('UPDATE prayer_sharing_settings SET enabled=0').run();f.setDate('2026-09-13T10:00:00Z');await f.service.tick();assert.equal(f.db.prepare('SELECT status FROM whatsapp_qr_schedules').get().status,'cancelled');});
test('changed media fails before delivery',async t=>{const f=fixture(t);f.ready();f.service.queue(DAY);f.setDate('2026-09-12T10:00:00Z');fs.writeFileSync(path.join(f.dir,'prayer-media',DAY,'short','video.mp4'),'different bytes');await assert.rejects(f.service.prepareScheduledMessage(f.db.prepare('SELECT * FROM whatsapp_qr_schedules').get()));});
test('formats use complete original sentences and no duplicated closing Amen',()=>{const short=prayerVideoScript(DAY,'short'),long=prayerVideoScript(DAY,'tiktok');assert.ok(short.text.split(/\s+/).length>=38);assert.ok(long.text.length>short.text.length);assert.doesNotMatch(long.text,/amém\. Amém\./i);assert.throws(()=>prayerVideoScript(DAY,'bad'));});
test('dedicated group accepts prayer while promotional and Recipes 06 exclusions remain',async t=>{const f=fixture(t),jid='34685244692-1501704641@g.us';assert.equal(isWhatsAppPrayerGroupAllowed(jid),true);assert.equal(isWhatsAppPrayerGroupAllowed('120363314271911782@g.us'),false);const insert=f.db.prepare('INSERT INTO whatsapp_qr_schedules(id,group_jid,message,sitemap_url,scheduled_at,campaign_id) VALUES(?,?,?,?,?,?)');insert.run('prayer',jid,'Oração','https://vitrinecity.com',prayerScheduledAt(DAY),'prayer-v1:'+DAY);insert.run('commerce',jid,'Oferta','https://vitrinecity.com',prayerScheduledAt(DAY),'promotion');f.setDate('2026-09-12T10:00:00Z');let sent=0;const worker=createWhatsAppScheduleProcessor({db:f.db,now:f.now,prepareScheduledMessage:async()=>null,isGroupAllowed:(id,row)=>row?.campaign_id?.startsWith('prayer-v1:')?isWhatsAppPrayerGroupAllowed(id):isWhatsAppCommercialGroupAllowed(id,{WHATSAPP_COMMERCIAL_EXCLUDED_GROUP_JIDS:jid}),whatsappQrData:x=>x,whatsappQrRequest:async()=>{sent++;return {Id:'only-prayer-receipt'};}});await worker();assert.equal(sent,1);assert.equal(f.db.prepare("SELECT status FROM whatsapp_qr_schedules WHERE id='commerce'").get().status,'cancelled');assert.equal(f.db.prepare("SELECT status FROM whatsapp_qr_schedules WHERE id='prayer'").get().status,'sent');});
test('render validation rejects missing audio and wrong duration',()=>{const valid={format:{duration:61},streams:[{codec_type:'video',codec_name:'h264',pix_fmt:'yuv420p',width:720,height:1280},{codec_type:'audio',codec_name:'aac'}]};assert.equal(validatePrayerMedia(valid,61),true);assert.equal(validatePrayerMedia(valid,30),false);assert.equal(validatePrayerMedia({...valid,streams:valid.streams.slice(0,1)},61),false);});
test('Meta campaign journals bind a date and recheck pause after preflight',async()=>{const manifest={campaign:'oracao-'+DAY,videoPath:'/data/test.mp4',publicVideoUrl:'https://vitrinecity.com/prayer-media/'+DAY+'/short.mp4',title:'Oração de sábado',caption:'Oração com imagem e voz criadas com inteligência artificial.'};assert.equal(validateManifest(manifest).campaign,'oracao-'+DAY);assert.throws(()=>validateManifest({...manifest,campaign:'../../x'}));let state,posts=0,allowed=true;const journal={load:()=>state,save:s=>state=structuredClone(s)},api={preflight:async()=>{allowed=false;return {};},verifyPublic:async()=>{},post:async()=>{posts++;return {id:'12345678'};}};const options={channel:'instagram',manifest,credentialVersion:'test',local:{info:{}},api,journal,canPublish:()=>allowed};await runMeta({...options,mode:'prepare'});await assert.rejects(runMeta({...options,mode:'step'}));assert.equal(posts,0);});

function socialFixture(t,hooks={}){
 const writes=[],reads=[],preflights=[],caption='Oração completa de teste. Imagem e voz criadas com inteligência artificial. Amém.';
 const api={
  async preflight(channel){preflights.push(channel);await hooks.preflight?.(channel);return {};},
  async verifyPublic(){reads.push('public-video');await hooks.verifyPublic?.();},
  async post(endpoint,params){writes.push({endpoint,params});await hooks.post?.(endpoint,params);
   if(endpoint===`${TARGET.instagramId}/media`)return {id:params.media_type==='STORIES'?'33000001':'11000001'};
   if(endpoint===`${TARGET.instagramId}/media_publish`)return {id:params.creation_id==='33000001'?'33000002':'11000002'};
   if(endpoint===`${TARGET.pageId}/video_reels`)return params.upload_phase==='start'?{video_id:'22000001'}:{success:true};
   if(endpoint===`${TARGET.pageId}/video_stories`)return params.upload_phase==='start'?{video_id:'44000001'}:{success:true,post_id:'44000002'};
   throw Error('Unexpected fixture POST '+endpoint);
  },
  async upload(id){writes.push({endpoint:'upload',id});await hooks.upload?.(id);return {success:true};},
  async get(endpoint){reads.push(endpoint);await hooks.get?.(endpoint);
   if(['11000001','33000001'].includes(endpoint))return {id:endpoint,status_code:'FINISHED'};
   if(endpoint==='11000002')return {id:endpoint,owner:{id:TARGET.instagramId},username:TARGET.instagramUsername,caption,media_type:'VIDEO',media_product_type:'REELS',permalink:'https://www.instagram.com/reel/TestPrayer/'};
   if(['22000001','44000001'].includes(endpoint))return {id:endpoint,from:{id:TARGET.pageId},description:caption,permalink_url:'https://www.facebook.com/reel/22000001',status:{video_status:'ready',uploading_phase:{status:'complete'},publishing_phase:{status:'complete'}}};
   if(endpoint===`${TARGET.instagramId}/stories`)return {data:[{id:'33000002',owner:{id:TARGET.instagramId},username:TARGET.instagramUsername,media_type:'VIDEO',media_product_type:'STORY',permalink:`https://www.instagram.com/stories/${TARGET.instagramUsername}/33000002/`}]};
   if(endpoint===`${TARGET.pageId}/stories`)return {data:[{post_id:'44000002',media_id:'44000001',status:'PUBLISHED',media_type:'video',url:'https://www.facebook.com/stories/44000002/'}]};
   throw Error('Unexpected fixture GET '+endpoint);
  }
 };
 const f=fixture(t,{metaFactory:()=>({credential:{credentialVersion:'fixture-v1'},api}),inspectVideo:manifest=>({buffer:fs.readFileSync(manifest.videoPath),info:{bytes:44,sha256:'fixture',durationSeconds:30,width:720,height:1280}})});
 f.db.prepare('UPDATE prayer_sharing_settings SET instagram_enabled=1,social_enabled=1').run();f.ready();f.setDate('2026-09-12T10:00:00Z');
 return {...f,writes,reads,preflights,run:channel=>f.db.prepare('SELECT * FROM prayer_channel_runs WHERE day=? AND channel=?').get(DAY,channel),journal:channel=>JSON.parse(fs.readFileSync(path.join(f.dir,'prayer-publications',`oracao-${DAY}-${channel}.json`),'utf8'))};
}

test('new social setting migrates independently without activating a disabled routine or changing the Instagram target',t=>{
 const fresh=fixture(t);assert.equal(fresh.initialSettings.enabled,false);assert.equal(fresh.initialSettings.socialEnabled,true);assert.equal(fresh.initialSettings.instagramEnabled,true);assert.equal(fresh.initialSettings.youtubeEnabled,false);
 const legacy=fixture(t,{beforeSetup(db){db.exec("CREATE TABLE prayer_sharing_settings(id INTEGER PRIMARY KEY,enabled INTEGER,instagram_enabled INTEGER,start_day TEXT,groups_json TEXT,revision INTEGER,updated_at TEXT); INSERT INTO prayer_sharing_settings VALUES(1,1,1,'2026-09-12','[]',7,'2026-09-11')");}});
 assert.equal(legacy.initialSettings.enabled,true);assert.equal(legacy.initialSettings.socialEnabled,true);assert.equal(legacy.initialSettings.instagramEnabled,true);assert.equal(legacy.initialSettings.youtubeEnabled,false);assert.equal(legacy.db.prepare('SELECT revision FROM prayer_sharing_settings').get().revision,7);
});

test('four independent social journals publish once and report only their own verified links',async t=>{
 const f=socialFixture(t);for(let i=0;i<6;i++)await f.service.tick();
 assert.equal(f.writes.length,10);assert.equal(new Set(f.preflights).size,4);
 for(const channel of PRAYER_SOCIAL_CHANNELS){assert.equal(f.run(channel).state,'published_verified',channel);assert.ok(f.run(channel).permalink);assert.equal(f.journal(channel).channel,channel);}
 const priorWrites=f.writes.length,priorReads=f.reads.length;f.setDate('2026-09-14T14:00:00Z');await f.service.tick();assert.equal(f.writes.length,priorWrites);assert.equal(f.reads.length,priorReads);
 assert.deepEqual(f.service.snapshot().channels.filter(c=>PRAYER_SOCIAL_CHANNELS.includes(c.id)).map(c=>c.id),PRAYER_SOCIAL_CHANNELS);
});

test('existing verified Instagram receipt and WhatsApp confirmation are preserved when new social destinations start',async t=>{
 const f=socialFixture(t);f.db.prepare("INSERT INTO prayer_channel_runs(day,channel,state,permalink) VALUES(?,'instagram','published_verified',?)").run(DAY,'https://www.instagram.com/reel/ExistingReceipt/');
 f.service.queue(DAY);f.db.prepare("UPDATE whatsapp_qr_schedules SET status='sent',confirmation_state='confirmed',provider_message_id='existing-wa'").run();
 for(let i=0;i<6;i++)await f.service.tick();assert.equal(f.writes.length,8);assert(!f.preflights.includes('instagram'));assert.equal(f.run('instagram').permalink,'https://www.instagram.com/reel/ExistingReceipt/');assert.equal(f.db.prepare('SELECT provider_message_id FROM whatsapp_qr_schedules').get().provider_message_id,'existing-wa');
});

test('initial GET timeout retries without holding the day or creating a duplicate write',async t=>{
 let failOnce=true;const f=socialFixture(t,{preflight(channel){if(channel==='instagram'&&failOnce){failOnce=false;throw Object.assign(Error('prayer_network_or_response_unknown'),{code:'prayer_network_or_response_unknown'});}}});
 await f.service.tick();assert.equal(f.run('instagram').state,'retry_pending');assert.equal(f.writes.length,0);
 for(let i=0;i<6;i++)await f.service.tick();assert.equal(f.run('instagram').state,'published_verified');assert.equal(f.writes.length,10);
});

test('late verification recovers after GET 503 even while paused and never submits a new post',async t=>{
 let failGet=true;const f=socialFixture(t,{get(endpoint){if(endpoint==='11000002'&&failGet)throw Object.assign(Error('prayer_meta_rejected'),{code:'prayer_meta_rejected',httpStatus:503});}});
 for(let i=0;i<4;i++)await f.service.tick();assert.equal(f.run('instagram').state,'publishing');assert.equal(f.writes.length,10);
 f.setDate('2026-09-12T10:45:00Z');f.setGlobal(false);f.db.prepare('UPDATE prayer_sharing_settings SET enabled=0').run();await f.service.tick();assert.equal(f.run('instagram').state,'publishing');assert.equal(f.run('instagram').error,'prayer_meta_rejected');
 failGet=false;await f.service.tick();assert.equal(f.run('instagram').state,'published_verified');assert.equal(f.writes.length,10);assert(f.service.snapshot().channels.filter(c=>PRAYER_SOCIAL_CHANNELS.includes(c.id)).every(c=>c.state==='paused'));
});

test('missing SQL summary is recovered from a journal after midnight with read-only verification',async t=>{
 const f=socialFixture(t);for(let i=0;i<4;i++)await f.service.tick();f.db.prepare('DELETE FROM prayer_channel_runs').run();f.setDate('2026-09-13T03:05:00Z');await f.service.tick();assert.equal(f.writes.length,10);for(const channel of PRAYER_SOCIAL_CHANNELS)assert.equal(f.run(channel).state,'published_verified');
});

test('held unknown creates no retry and one channel does not stop the others',async t=>{
 const f=socialFixture(t,{post(endpoint,params){if(endpoint===`${TARGET.instagramId}/media`&&params.media_type==='STORIES')throw Error('simulated lost response');}});
 for(let i=0;i<7;i++)await f.service.tick();assert.equal(f.run('instagram-stories').state,'held_unknown');assert.equal(f.journal('instagram-stories').attempts.create.state,'pending_unknown');assert.equal(f.writes.filter(w=>w.params?.media_type==='STORIES').length,1);
 for(const channel of ['instagram','facebook','facebook-stories'])assert.equal(f.run(channel).state,'published_verified');
});

test('no late backfill and channel disable, revision, start day and final global pause block every new write',async t=>{
 const late=socialFixture(t);late.setDate('2026-09-12T10:45:00Z');await late.service.tick();assert.equal(late.preflights.length,0);assert.equal(late.writes.length,0);
 const future=socialFixture(t);future.db.prepare("UPDATE prayer_sharing_settings SET start_day='2026-09-13'").run();await future.service.tick();assert.equal(future.preflights.length,0);
 const disabled=socialFixture(t);disabled.db.prepare('UPDATE prayer_sharing_settings SET social_enabled=0').run();for(let i=0;i<5;i++)await disabled.service.tick();assert.deepEqual([...new Set(disabled.preflights)],['instagram']);assert.equal(disabled.writes.length,2);
 let f;f=socialFixture(t,{preflight(){if(f?.writes.length===0&&f?.preflights.length>4)f.setGlobal(false);}});await f.service.tick();await f.service.tick();assert.equal(f.writes.length,0);
 const revised=socialFixture(t);await revised.service.tick();revised.setGlobal(false);await revised.service.tick();assert.equal(revised.writes.length,0);revised.setGlobal(true);revised.db.prepare('UPDATE prayer_sharing_settings SET enabled=0,revision=revision+1').run();await revised.service.tick();assert.equal(revised.writes.length,0);
});

test('a lost publish response remains held through GET failures and later FINISHED readback',async t=>{
 let lost=false,readFails=false;const f=socialFixture(t,{post(endpoint,params){if(endpoint===`${TARGET.instagramId}/media_publish`&&params.creation_id==='11000001'){lost=true;readFails=true;throw Error('lost publish response');}},get(endpoint){if(readFails&&endpoint==='11000001')throw Object.assign(Error('prayer_meta_rejected'),{code:'prayer_meta_rejected',httpStatus:503});}});
 for(let i=0;i<6;i++)await f.service.tick();assert(lost);assert.equal(f.run('instagram').state,'held_unknown');assert.equal(f.journal('instagram').attempts.publish.state,'pending_unknown');
 readFails=false;f.setDate('2026-09-12T12:00:00Z');await f.service.tick();assert.equal(f.run('instagram').state,'held_unknown');assert.equal(f.writes.filter(w=>w.params?.creation_id==='11000001').length,1);
});

test('a settings revision changed during preflight blocks that write without permanently holding a safe preparation',async t=>{
 let changed=false,f;f=socialFixture(t,{preflight(channel){if(channel==='instagram'&&f.preflights.length>4&&!changed){changed=true;f.db.prepare('UPDATE prayer_sharing_settings SET revision=revision+1').run();}}});
 await f.service.tick();await f.service.tick();assert.equal(f.run('instagram').state,'prepared');assert.equal(f.writes.filter(w=>w.params?.media_type==='REELS').length,0);
 for(let i=0;i<5;i++)await f.service.tick();assert.equal(f.run('instagram').state,'published_verified');assert.equal(f.writes.filter(w=>w.params?.media_type==='REELS').length,1);
});

test('YouTube requires a confirmed connection and preserves a native verified publication',async t=>{
 let connected=false;const calls=[],adapter={status:()=>({connected}),pendingDays:()=>[],publish:async args=>{calls.push(args);return {state:'processing'};}};
 const f=fixture(t,{youtubeAdapter:adapter});f.ready();f.setDate('2026-09-12T10:00:00Z');await f.service.tick();assert.equal(calls.length,0);assert.equal(f.service.snapshot().channels.find(c=>c.id==='youtube').state,'needs_connection');
 connected=true;await f.service.tick();assert.equal(calls.length,0);assert.equal(f.service.snapshot().channels.find(c=>c.id==='youtube').state,'paused');f.db.prepare('UPDATE prayer_sharing_settings SET youtube_enabled=1').run();f.db.prepare("INSERT INTO prayer_channel_runs(day,channel,state,permalink) VALUES(?,'youtube','published_verified','https://youtu.be/1MQXZB9eTZs')").run(DAY);await f.service.tick();assert.equal(calls.length,0);assert.equal(f.service.snapshot().runs.find(r=>r.channel==='youtube').permalink,'https://youtu.be/1MQXZB9eTZs');
});

test('YouTube pending publication uses readback after the window, during pause, and for private or uncertain receipts',async t=>{
 const calls=[],adapter={status:()=>({connected:true}),pendingDays:()=>[DAY],publish:async args=>{calls.push({mode:args.mode,allowed:args.canPublish()});return {state:'processing'};}};
 const f=fixture(t,{youtubeAdapter:adapter});f.db.prepare('UPDATE prayer_sharing_settings SET youtube_enabled=1').run();f.ready();f.setDate('2026-09-12T10:00:00Z');await f.service.tick();assert.deepEqual(calls.at(-1),{mode:'step',allowed:true});
 f.setDate('2026-09-12T10:45:00Z');await f.service.tick();assert.deepEqual(calls.at(-1),{mode:'status',allowed:false});
 f.setDate('2026-09-12T10:01:00Z');for(const state of ['private_requires_review','held_unknown']){f.db.prepare("UPDATE prayer_channel_runs SET state=? WHERE channel='youtube'").run(state);await f.service.tick();assert.deepEqual(calls.at(-1),{mode:'status',allowed:false});}
 f.setGlobal(false);await f.service.tick();assert.deepEqual(calls.at(-1),{mode:'status',allowed:false});
});

test('YouTube activation is explicit, rejects an unconfirmed channel and does not change other social settings',async t=>{
 let connected=false;const f=fixture(t,{youtubeAdapter:{status:()=>({connected}),pendingDays:()=>[],publish:async()=>{throw Error('no upload allowed in activation test');}}});
 const handler=f.routes.get('POST /api/admin/prayer-sharing/settings');async function save(body){let status=200,data;await handler({body},{status(code){status=code;return this;},json(value){data=value;return this;}});return {status,data};}
 let result=await save({enabled:true,youtubeEnabled:true});assert.equal(result.status,409);assert.equal(f.service.snapshot().youtubeEnabled,false);
 connected=true;assert.equal(f.service.snapshot().youtubeEnabled,false);result=await save({enabled:true,youtubeEnabled:true});assert.equal(result.status,200);assert.equal(result.data.youtubeEnabled,true);assert.equal(result.data.instagramEnabled,false);assert.equal(result.data.socialEnabled,false);
 result=await save({enabled:true,youtubeEnabled:false});assert.equal(result.data.youtubeEnabled,false);assert.equal(result.data.enabled,true);assert.equal((await save({enabled:true,youtubeEnabled:'yes'})).status,400);
 f.db.prepare('UPDATE prayer_sharing_settings SET enabled=0,revision=revision+1').run();result=await save({youtubeEnabled:true});assert.equal(result.status,200);assert.equal(result.data.youtubeEnabled,true);assert.equal(result.data.enabled,false,'a YouTube-only change cannot override a concurrent master pause');assert.equal((await save({})).status,400);
});

test('Vitrine Social has an independent receipt, honors the final pause and reads only after the window',async t=>{
 const calls=[];let result='processing',f;const adapter={status:()=>({connected:true}),pendingDays:()=>[DAY],publish:async args=>{calls.push({mode:args.mode,allowed:args.canPublish()});return {state:result,permalink:result==='published_verified'?'/social/post/prayer-local-12':null};}};
 f=fixture(t,{vitrineSocialAdapter:adapter});f.ready();f.setDate('2026-09-12T10:00:00Z');f.db.prepare("INSERT INTO prayer_channel_runs(day,channel,state) VALUES(?,'instagram','published_verified')").run(DAY);await f.service.tick();assert.deepEqual(calls.at(-1),{mode:'step',allowed:true});assert.equal(f.service.snapshot().runs.find(r=>r.channel==='vitrine_social').state,'processing');
 f.setDate('2026-09-13T03:05:00Z');f.setGlobal(false);result='published_verified';await f.service.tick();assert.deepEqual(calls.at(-1),{mode:'status',allowed:false});assert.equal(f.service.snapshot().runs.find(r=>r.channel==='vitrine_social').permalink,'/social/post/prayer-local-12');const count=calls.length;await f.service.tick();assert.equal(calls.length,count);
});

test('admin separates all social results and only renders verified safe links, without publishing on read',async()=>{
 class Element{constructor(tag){this.tagName=tag;this.children=[];this.listeners={};this.textContent='';}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}setAttribute(){}addEventListener(type,fn){this.listeners[type]=fn;}}
 const nodes=Object.fromEntries(['toggle','refresh','status','channels','packages','deliveries','groups','groupCount','error'].map(id=>[id,new Element('div')])),document={getElementById:id=>nodes[id],createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})},calls=[];
 const data={enabled:true,globalPaused:false,nextAt:prayerScheduledAt(DAY),channels:PRAYER_SOCIAL_CHANNELS.map(id=>({id,name:id,state:'scheduled',detail:'Destino'})),packages:[],days:[],groups:[{name:'<script>grupo</script>'}],runs:PRAYER_SOCIAL_CHANNELS.map((channel,i)=>({day:DAY,channel,state:i===1?'held_unknown':'published_verified',permalink:i===2?'javascript:alert(1)':channel.startsWith('instagram')?'https://www.instagram.com/reel/Proof/':'https://www.facebook.com/stories/44000002/'}))};
 data.youtubeEnabled=false;data.channels.push({id:'youtube',name:'YouTube',connected:true,state:'paused',detail:'Conexão confirmada'});
 const facebookStory='https://facebook.com/stories/122098852472061143/UzpfSVNDOjEzOTc2NjQ2NzE3NjY5MjI=/?view_single=1';data.runs.find(row=>row.channel==='facebook-stories').permalink=facebookStory;
 const context={document,URL,Intl,Date,navigator:{},fetch:async(url,options)=>{calls.push({url,options});if(options.method)data.youtubeEnabled=JSON.parse(options.body).youtubeEnabled;return {ok:true,json:async()=>data};}};
 vm.runInNewContext(fs.readFileSync(new URL('../public/admin-oracoes.js',import.meta.url),'utf8'),context);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,1);assert.equal(calls[0].options.method,undefined);assert.equal(nodes.deliveries.children.length,4);assert.match(nodes.deliveries.children[0].textContent,/Instagram · Reel/);assert.match(nodes.deliveries.children[1].textContent,/Facebook · Reel da página: Resultado incerto/);assert.match(nodes.deliveries.children[2].textContent,/Instagram · Stories/);assert.match(nodes.deliveries.children[3].textContent,/Facebook · Stories da página/);
 assert.equal(nodes.deliveries.children[0].children.at(-1).rel,'noopener noreferrer');assert.equal(nodes.deliveries.children[1].children.length,0);assert.equal(nodes.deliveries.children[2].children.length,0);assert.equal(nodes.groups.children[0].textContent,'<script>grupo</script>');
 assert.equal(nodes.deliveries.children[3].children.at(-1).href,facebookStory);assert.equal(context.publicationUrl('facebook-stories',facebookStory),facebookStory);
 for(const url of [facebookStory+'&access_token=secret',facebookStory+'&other=1',facebookStory+'&view_single=1',facebookStory.replace('view_single=1','view_single=2'),facebookStory.replace('facebook.com','evil.test'),facebookStory.replace('/stories/','/reel/'),facebookStory.replace('=/?','===/?')])assert.equal(context.publicationUrl('facebook-stories',url),null,url);
 assert.equal(context.publicationUrl('facebook',facebookStory),null);assert.equal(context.publicationUrl('instagram-stories',facebookStory.replace('facebook.com','instagram.com')),null);
 nodes.refresh.listeners.click();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,2);assert(calls.every(c=>!c.options.method));
 const youtubeButton=nodes.channels.children.at(-1).children.at(-1);assert.equal(youtubeButton.textContent,'Ativar YouTube na rotina');youtubeButton.listeners.click();youtubeButton.listeners.click();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.filter(c=>c.options.method).length,1);assert.deepEqual(JSON.parse(calls.at(-1).options.body),{youtubeEnabled:true});assert.equal(nodes.channels.children.at(-1).children.at(-1).textContent,'Pausar YouTube');
 assert.equal(context.publicationUrl('youtube','https://youtu.be/1MQXZB9eTZs'),'https://youtu.be/1MQXZB9eTZs');assert.equal(context.publicationUrl('youtube','https://evil.test/watch?v=1MQXZB9eTZs'),null);assert.equal(context.publicationUrl('youtube','https://www.youtube.com/watch?v=1MQXZB9eTZs&access_token=secret'),null);assert.equal(context.publicationUrl('vitrine_social','/social/post/prayer-local-12'),'/social/post/prayer-local-12');assert.equal(context.publicationUrl('vitrine_social','/admin.html'),null);
});
