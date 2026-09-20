/** Durable, opt-in post-production executor. Uses the application's SQLite handle.
 * Billing and ownership ports MUST be trusted server implementations, not request JSON.
 * It does not invent prices, debit a second wallet or repeat uncertain paid requests.
 */
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {planLiaAudioEditing} from '../lia-video-audio-editing-plan.mjs';
import {requireValue,problem} from './providers.mjs';
import {privateRoot,hashBytes,readPrivate,writePrivate,stageOwnedFile,captionsFromAlignment} from './media.mjs';
const ID=/^[a-z0-9][a-z0-9_-]{0,99}$/i;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const clone=value=>JSON.parse(JSON.stringify(value));
const fingerprint=value=>hashBytes(Buffer.from(JSON.stringify(value)));
const scopeValid=scope=>typeof scope==='string'&&/^user:[1-9]\d{0,14}$/.test(scope);
function syncResult(value){requireValue(!value?.then,'billing_must_share_sqlite_transaction');return value;}

export function createLiaPostProduction({db,root,sourceRoots,enabled=false,providers,editor,downloadSync,
  authorize,resolveSource,resolveVoice,billing,now=Date.now,maxScenes=60}={}) {
  requireValue(db?.transaction&&typeof enabled==='boolean'&&Array.isArray(sourceRoots)&&sourceRoots.length>0,'executor_configuration_invalid');
  for(const fn of [authorize,resolveSource,resolveVoice,downloadSync,providers?.preflight,providers?.speech,providers?.startSync,providers?.pollSync,
    editor?.probe,editor?.prepareScene,editor?.muxScene,editor?.assemble,billing?.quote,billing?.reserve,billing?.isReserved,billing?.release,billing?.hold])requireValue(typeof fn==='function','executor_port_missing');
  root=privateRoot(root);sourceRoots=sourceRoots.map(value=>path.resolve(value));
  requireValue(Number.isSafeInteger(maxScenes)&&maxScenes>=1&&maxScenes<=60,'executor_scene_limit_invalid');
  let closed=false;
  const controllers=new Map();
  db.exec(`CREATE TABLE IF NOT EXISTS lia_postproduction_jobs(
    id TEXT PRIMARY KEY,scope TEXT NOT NULL,conversation_id TEXT NOT NULL,source_job_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,spec_json TEXT NOT NULL,quote_json TEXT NOT NULL,voice_json TEXT NOT NULL,inputs_json TEXT NOT NULL,
    status TEXT NOT NULL,confirmation_key TEXT,review_json TEXT,error_code TEXT NOT NULL DEFAULT '',output_json TEXT,
    lease_token TEXT,lease_until INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(scope,confirmation_key));
  CREATE INDEX IF NOT EXISTS lia_postproduction_due ON lia_postproduction_jobs(status,next_at,lease_until);
  CREATE TABLE IF NOT EXISTS lia_postproduction_stages(
    job_id TEXT NOT NULL REFERENCES lia_postproduction_jobs(id),stage_key TEXT NOT NULL,paid INTEGER NOT NULL,
    state TEXT NOT NULL,data_json TEXT,started_at INTEGER NOT NULL,finished_at INTEGER,
    PRIMARY KEY(job_id,stage_key));`);
  const find=id=>db.prepare('SELECT * FROM lia_postproduction_jobs WHERE id=?').get(id);
  function allowed(scope,conversationId){requireValue(scopeValid(scope)&&UUID.test(conversationId)&&authorize(scope,conversationId)===true,'postproduction_access_denied');}
  function owned(scope,id){requireValue(UUID.test(id),'postproduction_not_found');const row=find(id);requireValue(row?.scope===scope,'postproduction_not_found');allowed(scope,row.conversation_id);return row;}
  const dir=id=>privateRoot(path.join(root,id));
  function dto(row){const specification=JSON.parse(row.spec_json),quote=JSON.parse(row.quote_json),output=row.output_json&&JSON.parse(row.output_json);
    return {id:row.id,conversationId:row.conversation_id,sourceJobId:row.source_job_id,status:row.status,errorCode:row.error_code,
      approvalFingerprint:row.fingerprint,quote,specification,output:output?{bytes:output.bytes,durationMs:output.durationMs,width:output.width,height:output.height,
        audioVerified:output.audioVerified,languageVerified:false,lipSyncQualityVerified:false,
        previewPath:`/api/neural/chat/postproduction/${row.id}/video`,captionsPath:output.captions?`/api/neural/chat/postproduction/${row.id}/captions`:null}:null,
      userReview:row.review_json?JSON.parse(row.review_json):null,publicationAuthorized:false,automaticPaidRetry:false};}
  async function prepare(scope,{conversationId,sourceJobId,specification}={}) {
    requireValue(enabled&&!closed,'postproduction_disabled');allowed(scope,conversationId);
    requireValue(typeof sourceJobId==='string'&&ID.test(sourceJobId),'postproduction_source_invalid');
    const plan=planLiaAudioEditing(specification);requireValue(plan.specification.scenes.length<=maxScenes,'postproduction_scene_limit');
    const count=db.prepare("SELECT COUNT(*) n FROM lia_postproduction_jobs WHERE scope=? AND status NOT IN ('cancelled','failed','completed')").get(scope).n;
    requireValue(count<3,'postproduction_active_limit');
    const voice=clone(await resolveVoice(scope,plan.specification.voiceProfileId,plan.specification.language));
    requireValue(voice?.licensed===true&&voice.scope===scope&&voice.language===plan.specification.language,'voice_not_authorized');
    providers.preflight({voice,sync:plan.requirements.sync});
    const id=randomUUID(),work=path.join(root,id);fs.mkdirSync(work,{mode:0o700});
    const inputs=[];
    try {
      for(let i=0;i<plan.specification.scenes.length;i++){
        const scene=plan.specification.scenes[i],asset=await resolveSource(scope,sourceJobId,scene);
        requireValue(asset?.scope===scope&&sourceRoots.includes(path.resolve(asset.root)),'source_not_authorized');
        if(scene.speakerVisible)requireValue(asset.singleSpeakerApproved===true,'speaker_review_required');
        const file=stageOwnedFile({root:asset.root,source:asset.localPath,expectedSha256:asset.sha256,targetRoot:work,targetName:`s${i}-source.mp4`});
        const meta=await editor.probe(work,file.name,'mov');requireValue(meta.video.length===1&&meta.durationMs>=scene.durationMs-40,'scene_too_short');
        inputs.push({...file,singleSpeakerApproved:asset.singleSpeakerApproved===true});
      }
      const spec=clone(plan.specification),approvalFingerprint=fingerprint({spec,voice,inputs,sourceJobId,conversationId});
      const raw=await billing.quote({scope,requestId:id,fingerprint:approvalFingerprint,billingInputs:plan.billingInputs});
      requireValue(raw&&typeof raw.quoteId==='string'&&ID.test(raw.quoteId)&&Number.isSafeInteger(raw.maximumMicroBrl)&&raw.maximumMicroBrl>0&&raw.maximumMicroBrl<=1e11&&Number.isSafeInteger(raw.expiresAt)&&raw.expiresAt>now()&&raw.expiresAt<=now()+86400000,'postproduction_quote_invalid');
      const quote={quoteId:raw.quoteId,maximumMicroBrl:raw.maximumMicroBrl,expiresAt:raw.expiresAt,currency:'BRL'};
      // Recheck access and capacity after asynchronous preparation.
      allowed(scope,conversationId);
      db.transaction(()=>{
        requireValue(db.prepare("SELECT COUNT(*) n FROM lia_postproduction_jobs WHERE scope=? AND status NOT IN ('cancelled','failed','completed')").get(scope).n<3,'postproduction_active_limit');
        db.prepare("INSERT INTO lia_postproduction_jobs(id,scope,conversation_id,source_job_id,fingerprint,spec_json,quote_json,voice_json,inputs_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'draft',?,?)")
          .run(id,scope,conversationId,sourceJobId,approvalFingerprint,JSON.stringify(spec),JSON.stringify(quote),JSON.stringify(voice),JSON.stringify(inputs),now(),now());
      }).immediate();
      return dto(find(id));
    } catch(error){fs.rmSync(work,{recursive:true,force:true});throw error;}
  }
  const approveTx=db.transaction((scope,id,input)=>{
    requireValue(enabled&&!closed,'postproduction_disabled');const row=owned(scope,id),quote=JSON.parse(row.quote_json);
    requireValue(input&&Object.keys(input).sort().join(',')==='approvalFingerprint,idempotencyKey,quoteId'&&ID.test(input.idempotencyKey)&&input.idempotencyKey.length>=12,'postproduction_approval_invalid');
    requireValue(input.approvalFingerprint===row.fingerprint&&input.quoteId===quote.quoteId,'postproduction_approval_mismatch');
    if(row.confirmation_key){requireValue(row.confirmation_key===input.idempotencyKey,'postproduction_confirmation_conflict');return dto(row);}
    requireValue(row.status==='draft'&&quote.expiresAt>now(),'postproduction_quote_expired');
    const prior=db.prepare('SELECT id FROM lia_postproduction_jobs WHERE scope=? AND confirmation_key=?').get(scope,input.idempotencyKey);requireValue(!prior,'postproduction_confirmation_conflict');
    syncResult(billing.reserve({scope,requestId:id,fingerprint:row.fingerprint,quote}));
    requireValue(syncResult(billing.isReserved({scope,requestId:id,fingerprint:row.fingerprint,quote}))===true,'postproduction_reservation_missing');
    db.prepare("UPDATE lia_postproduction_jobs SET status='queued',confirmation_key=?,updated_at=? WHERE id=?").run(input.idempotencyKey,now(),id);
    return dto(find(id));
  });
  function stop(scope,id){
    return db.transaction(()=>{const row=owned(scope,id);if(['completed','cancelled'].includes(row.status))return dto(row);
      if(row.confirmation_key){const sent=db.prepare('SELECT 1 FROM lia_postproduction_stages WHERE job_id=? AND paid=1 LIMIT 1').get(id);
        syncResult((sent?billing.hold:billing.release)({scope,requestId:id,reason:sent?'cancelled_after_dispatch':'not_dispatched'}));}
      db.prepare("UPDATE lia_postproduction_jobs SET status='cancelled',updated_at=? WHERE id=?").run(now(),id);controllers.get(id)?.abort();return dto(find(id));
    }).immediate();
  }
  function live(id,token){requireValue(enabled&&!closed,'postproduction_disabled');const row=find(id);requireValue(row&&row.lease_token===token&&row.lease_until>now()&&!['cancelled','review_required','completed','ready_for_review'].includes(row.status),'postproduction_lease_lost');
    allowed(row.scope,row.conversation_id);requireValue(syncResult(billing.isReserved({scope:row.scope,requestId:id,fingerprint:row.fingerprint,quote:JSON.parse(row.quote_json)}))===true,'postproduction_reservation_missing');return row;}
  const lookupStage=(id,key)=>db.prepare('SELECT * FROM lia_postproduction_stages WHERE job_id=? AND stage_key=?').get(id,key);
  async function stage(id,token,key,paid,operation){
    let prior=lookupStage(id,key);if(prior?.state==='done')return JSON.parse(prior.data_json);
    if(prior?.state==='started'&&paid)throw problem('paid_result_requires_reconciliation');
    db.transaction(()=>{live(id,token);db.prepare("INSERT INTO lia_postproduction_stages(job_id,stage_key,paid,state,started_at) VALUES(?,?,?,'started',?) ON CONFLICT(job_id,stage_key) DO UPDATE SET state='started'").run(id,key,paid?1:0,now());}).immediate();
    const result=await operation();
    // Save receipts even after cancellation, but never deliver or submit a next stage.
    db.prepare("UPDATE lia_postproduction_stages SET state='done',data_json=?,finished_at=? WHERE job_id=? AND stage_key=? AND state='started'").run(JSON.stringify(result),now(),id,key);
    live(id,token);return result;
  }
  async function executeOne(row,token,signal){
    const spec=JSON.parse(row.spec_json),voice=JSON.parse(row.voice_json),inputs=JSON.parse(row.inputs_json),work=dir(row.id);
    const currentVoice=clone(await resolveVoice(row.scope,spec.voiceProfileId,spec.language));
    requireValue(fingerprint(currentVoice)===fingerprint(voice)&&currentVoice.licensed===true,'voice_not_authorized');
    providers.preflight({voice,sync:spec.scenes.some(s=>s.speakerVisible)});
    const allCues=[],edited=[];let offset=0;
    for(let index=0;index<spec.scenes.length;index++){
      const scene=spec.scenes[index],prefix=`s${index}`;live(row.id,token);
      requireValue(hashBytes(readPrivate(work,inputs[index].name))===inputs[index].sha256,'source_changed');
      if(!lookupStage(row.id,prefix+':voice')){
        await stage(row.id,token,prefix+':voice',true,async()=>{
          const result=await providers.speech({...voice,text:scene.speech,previousText:spec.scenes[index-1]?.speech||'',nextText:spec.scenes[index+1]?.speech||''},signal);
          const audio=writePrivate(work,prefix+'-voice.mp3',result.audio);
          return {...audio,alignment:result.alignment,providerRequestId:result.requestId};
        });return;
      }
      const speech=await stage(row.id,token,prefix+':voice',true,()=>{throw problem('paid_retry_denied');});
      requireValue(hashBytes(readPrivate(work,speech.name))===speech.sha256,'voice_file_changed');
      if(!lookupStage(row.id,prefix+':prepare')?.data_json){
        await stage(row.id,token,prefix+':prepare',false,()=>editor.prepareScene(work,{source:inputs[index].name,voice:speech.name,durationMs:scene.durationMs,aspectRatio:spec.aspectRatio,index},signal));return;
      }
      const prepared=JSON.parse(lookupStage(row.id,prefix+':prepare').data_json);
      requireValue(hashBytes(readPrivate(work,prepared.silent))===prepared.silentSha256&&hashBytes(readPrivate(work,prepared.padded))===prepared.paddedSha256,'prepared_inputs_changed');
      let video=prepared.silent;
      if(scene.speakerVisible){
        if(!lookupStage(row.id,prefix+':sync')){
          await stage(row.id,token,prefix+':sync',true,()=>providers.startSync({video:readPrivate(work,prepared.silent),audio:readPrivate(work,prepared.padded)},signal));return;
        }
        const submitted=await stage(row.id,token,prefix+':sync',true,()=>{throw problem('paid_retry_denied');});
        if(!lookupStage(row.id,prefix+':sync-result')?.data_json){
          requireValue(now()-lookupStage(row.id,prefix+':sync').started_at<24*3600000,'sync_wait_expired');
          const receipt=submitted.status==='COMPLETED'?submitted:await providers.pollSync(submitted.id,signal);
          requireValue(!['FAILED','REJECTED'].includes(receipt.status),'sync_generation_failed');
          if(receipt.status!=='COMPLETED'){
            live(row.id,token);db.prepare("UPDATE lia_postproduction_jobs SET status='waiting_sync',next_at=? WHERE id=? AND lease_token=?").run(now()+5000,row.id,token);return;
          }
          await stage(row.id,token,prefix+':sync-result',false,async()=>writePrivate(work,prefix+'-sync.mp4',await downloadSync(receipt.outputUrl,signal)));return;
        }
        const synced=JSON.parse(lookupStage(row.id,prefix+':sync-result').data_json);
        requireValue(hashBytes(readPrivate(work,synced.name))===synced.sha256,'sync_file_changed');video=synced.name;
      }
      if(!lookupStage(row.id,prefix+':edit')?.data_json){
        await stage(row.id,token,prefix+':edit',false,()=>editor.muxScene(work,{video,audio:prepared.padded,durationMs:scene.durationMs,index},signal));return;
      }
      const part=JSON.parse(lookupStage(row.id,prefix+':edit').data_json);requireValue(hashBytes(readPrivate(work,part.name))===part.sha256,'edited_file_changed');
      edited.push(part.name);const cues=captionsFromAlignment(speech.alignment,offset);
      requireValue(cues.every(c=>c.endMs<=offset+scene.durationMs+40),'caption_outside_scene');allCues.push(...cues);offset+=scene.durationMs;
    }
    const output=await stage(row.id,token,'final:edit',false,()=>editor.assemble(work,{scenes:edited,cues:allCues,captions:spec.captions,durationSeconds:spec.durationSeconds,aspectRatio:spec.aspectRatio},signal));
    live(row.id,token);
    syncResult(billing.hold({scope:row.scope,requestId:row.id,reason:'delivery_cost_reconciliation'}));
    db.prepare("UPDATE lia_postproduction_jobs SET status='ready_for_review',output_json=?,error_code='',updated_at=? WHERE id=? AND lease_token=? AND status!='cancelled'").run(JSON.stringify(output),now(),row.id,token);
  }
  async function tick(){
    if(!enabled||closed)return false;
    const token=randomUUID();
    const row=db.transaction(()=>{const row=db.prepare("SELECT * FROM lia_postproduction_jobs WHERE status IN ('queued','working','waiting_sync') AND lease_until<=? AND next_at<=? ORDER BY created_at LIMIT 1").get(now(),now());if(!row)return null;
      db.prepare("UPDATE lia_postproduction_jobs SET lease_token=?,lease_until=?,status='working' WHERE id=?").run(token,now()+90000,row.id);return row;
    }).immediate();if(!row)return false;
    const controller=new AbortController();controllers.set(row.id,controller);
    const heartbeat=setInterval(()=>{try{if(closed)return controller.abort();const result=db.prepare("UPDATE lia_postproduction_jobs SET lease_until=? WHERE id=? AND lease_token=? AND status IN ('working','waiting_sync')").run(now()+90000,row.id,token);if(!result.changes)controller.abort();}catch{controller.abort();}},10000);heartbeat.unref();
    try{live(row.id,token);await executeOne(row,token,controller.signal);}
    catch(error){
      const current=find(row.id);if(current?.lease_token===token&&current.status!=='cancelled'){
        try{syncResult(billing.hold({scope:row.scope,requestId:row.id,reason:'execution_requires_review'}));}catch{}
        const code=typeof error?.code==='string'&&/^[a-z0-9_]{1,80}$/.test(error.code)?error.code:'postproduction_execution_failed';
        db.prepare("UPDATE lia_postproduction_jobs SET status='review_required',error_code=?,updated_at=? WHERE id=? AND lease_token=?").run(code,now(),row.id,token);
      }
    }finally{clearInterval(heartbeat);controllers.delete(row.id);db.prepare('UPDATE lia_postproduction_jobs SET lease_token=NULL,lease_until=0 WHERE id=? AND lease_token=?').run(row.id,token);}
    return true;
  }
  function review(scope,id,input){
    return db.transaction(()=>{const row=owned(scope,id),spec=JSON.parse(row.spec_json);
      requireValue(['ready_for_review','completed'].includes(row.status),'postproduction_output_not_ready');
      requireValue(input&&Object.keys(input).sort().join(',')==='languageAndTextConfirmed,visualAndLipSyncConfirmed'&&input.languageAndTextConfirmed===true&&input.visualAndLipSyncConfirmed===true,'postproduction_review_required');
      // Human acceptance is recorded separately from automatic technical verification.
      if(row.status!=='completed')db.prepare("UPDATE lia_postproduction_jobs SET status='completed',review_json=?,updated_at=? WHERE id=?").run(JSON.stringify({reviewedAt:now(),language:spec.language,languageAndTextConfirmed:true,visualAndLipSyncConfirmed:true}),now(),id);
      return dto(find(id));
    }).immediate();
  }
  function output(scope,id,kind='video'){
    const row=owned(scope,id);requireValue(['ready_for_review','completed'].includes(row.status)&&row.output_json,'postproduction_output_not_ready');
    const data=JSON.parse(row.output_json),name=kind==='video'?data.name:kind==='captions'?data.captions:null;requireValue(name,'postproduction_output_not_found');
    const bytes=readPrivate(dir(id),name);if(kind==='video')requireValue(hashBytes(bytes)===data.sha256,'postproduction_output_changed');
    return {data:bytes,mimeType:kind==='video'?'video/mp4':'application/x-subrip',name:kind==='video'?'lia-video.mp4':'lia-legendas.srt'};
  }
  return Object.freeze({enabled,prepare,review,approve:(scope,id,input)=>approveTx.immediate(scope,id,input),cancel:stop,tick,
    get:(scope,id)=>dto(owned(scope,id)),list:(scope,conversationId)=>{allowed(scope,conversationId);return db.prepare('SELECT * FROM lia_postproduction_jobs WHERE scope=? AND conversation_id=? ORDER BY created_at DESC LIMIT 30').all(scope,conversationId).map(dto);},output,
    close:()=>{closed=true;for(const controller of controllers.values())controller.abort();}});
}
