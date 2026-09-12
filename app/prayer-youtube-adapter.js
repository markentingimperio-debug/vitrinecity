import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {validateManifest,inspectLocalVideo} from './prayer-meta-adapter.js';
import {YOUTUBE_PRAYER_CHANNEL} from './youtube-oauth.js';
import {prayerManifestFormat,prayerDurationAllowed} from './prayer-distribution-media.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{11}$/.test(value);
const validDay=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\d$/.test(value)&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const terminal=new Set(['published_verified','private_requires_review','failed','needs_review']);
const fail=code=>Object.assign(Error(code),{code});
const safeError=error=>/^youtube_[a-z0-9_]+$/.test(error?.code)?error.code:'youtube_response_unknown';
function safeSession(raw){
  try{const u=new URL(raw);return u.protocol==='https:'&&u.hostname==='www.googleapis.com'&&!u.port&&!u.username&&!u.password&&!u.hash&&u.pathname==='/upload/youtube/v3/videos'&&u.searchParams.get('uploadType')==='resumable'&&Boolean(u.searchParams.get('upload_id'))?u.href:null;}catch{return null;}
}

// Durable one-video-per-day journal. A missing/expired session never starts a second upload.
export function createPrayerYouTubeAdapter({db,dataDir,oauth,encrypt,decrypt,fetchImpl=fetch,inspect=inspectLocalVideo,now=Date.now}){
  db.exec(`CREATE TABLE IF NOT EXISTS prayer_youtube_uploads(day TEXT PRIMARY KEY,channel_id TEXT NOT NULL,binding TEXT NOT NULL,manifest_json TEXT NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,connection_revision TEXT NOT NULL,
    phase TEXT NOT NULL,session_encrypted TEXT,video_id TEXT,error TEXT,attempt_count INTEGER NOT NULL DEFAULT 0,next_check_at INTEGER NOT NULL DEFAULT 0,remote_json TEXT,
    claim_owner TEXT NOT NULL DEFAULT '',claim_until INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);`);
  const read=day=>db.prepare('SELECT * FROM prayer_youtube_uploads WHERE day=?').get(day);
  const sourceFormat=day=>{const row=read(day);return row?prayerManifestFormat(JSON.parse(row.manifest_json),day,dataDir):null;};
  const connection=()=>oauth.status();
  function manual(day){
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='prayer_channel_runs'").get())return null;
    const row=db.prepare("SELECT * FROM prayer_channel_runs WHERE day=? AND channel='youtube' AND state='published_verified'").get(day);
    if(!row)return null;
    let id=null;try{const u=new URL(row.permalink);if(['www.youtube.com','youtube.com','youtu.be'].includes(u.hostname)&&u.protocol==='https:')id=u.hostname==='youtu.be'?u.pathname.slice(1):u.searchParams.get('v')||u.pathname.split('/')[2];}catch{}
    return {state:'published_verified',providerId:validId(id)?id:null,permalink:validId(id)?'https://www.youtube.com/shorts/'+id:null,error:null,publicReachVerified:false,source:'existing_receipt'};
  }
  function snapshot(day){const existing=manual(day);if(existing)return existing;const row=read(day);return row?{state:row.phase,providerId:row.video_id||null,permalink:row.phase==='published_verified'?'https://www.youtube.com/shorts/'+row.video_id:null,error:row.error||null,publicReachVerified:false,remote:row.remote_json?JSON.parse(row.remote_json):null}:null;}
  function claim(day,owner){return db.prepare("UPDATE prayer_youtube_uploads SET claim_owner=?,claim_until=? WHERE day=? AND (claim_owner='' OR claim_until<=?)").run(owner,now()+360000,day,now()).changes===1;}
  function save(day,owner,fields){
    const allowed=new Set(['phase','session_encrypted','video_id','error','attempt_count','next_check_at','remote_json']);
    if(Object.keys(fields).some(key=>!allowed.has(key)))throw fail('youtube_journal_invalid');
    const keys=Object.keys(fields);
    if(db.prepare(`UPDATE prayer_youtube_uploads SET ${keys.map(k=>k+'=?').join(',')},updated_at=? WHERE day=? AND claim_owner=? AND claim_until>?`).run(...keys.map(k=>fields[k]),now(),day,owner,now()).changes!==1)throw fail('youtube_claim_changed');
  }
  async function request(url,options={}){
    const response=await fetchImpl(url,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(60000),...options});
    let data=null;
    if(response.status!==308){try{data=await response.json();}catch{}}
    return {response,data};
  }
  async function publish({day,manifest:raw,canPublish=()=>false,mode='status'}){
    if(!validDay(day)||!['step','status'].includes(mode))throw fail('youtube_request_invalid');
    const previous=manual(day);if(previous)return previous;
    let row=read(day),local,manifest,binding;
    if(!row&&mode==='status')return {state:'not_started',providerId:null,permalink:null,error:null};
    if(!row&&(!canPublish()||!connection().connected))return {state:'paused',providerId:null,permalink:null,error:null};
    if(raw){
      manifest=validateManifest(raw);
      let format;try{format=prayerManifestFormat(manifest,day,dataDir);}catch{throw fail('youtube_source_invalid');}
      const expected=path.resolve(dataDir,'prayer-media',day,format,'video.mp4');
      if(manifest.campaign!=='oracao-'+day||manifest.videoPath!==expected||!fs.realpathSync(manifest.videoPath).startsWith(fs.realpathSync(dataDir)+path.sep))throw fail('youtube_source_invalid');
      local=inspect(manifest,undefined,{channel:'youtube'});
      if(format==='tiktok'&&!prayerDurationAllowed(manifest,local.info?.durationSeconds,'youtube'))throw fail('youtube_source_invalid');
      if(!Buffer.isBuffer(local.buffer)||local.buffer.length!==local.info.bytes||hash(local.buffer)!==local.info.sha256)throw fail('youtube_source_changed');
      binding=hash(JSON.stringify({day,channel:YOUTUBE_PRAYER_CHANNEL,manifest,sha256:local.info.sha256,bytes:local.info.bytes}));
      if(row&&row.binding!==binding)throw fail('youtube_source_changed');
    }else if(!row||mode!=='status')throw fail('youtube_source_missing');
    if(!row){
      const c=connection();if(!c.connected||!c.revision||!canPublish())return {state:'paused',providerId:null,permalink:null,error:null};
      db.prepare(`INSERT OR IGNORE INTO prayer_youtube_uploads(day,channel_id,binding,manifest_json,sha256,bytes,connection_revision,phase,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'prepared',?,?)`)
        .run(day,YOUTUBE_PRAYER_CHANNEL,binding,JSON.stringify(manifest),local.info.sha256,local.info.bytes,c.revision,now(),now());row=read(day);
      if(row.binding!==binding)throw fail('youtube_source_changed');
    }
    if(terminal.has(row.phase))return snapshot(day);
    if(!connection().connected)return {...snapshot(day),error:'youtube_reconnect_required'};
    if(row.next_check_at>now())return snapshot(day);
    const owner=randomUUID();if(!claim(day,owner))return {...snapshot(day),busy:true};
    try{
      row=read(day);manifest=JSON.parse(row.manifest_json);
      const authorized=connection();
      if(authorized.channelId!==YOUTUBE_PRAYER_CHANNEL)throw fail('youtube_channel_mismatch');
      const token=await oauth.accessToken();
      const auth={Authorization:'Bearer '+token};
      // Bound to the connection that was checked immediately before this run. A reconnect cannot revive an old in-flight dispatch.
      const current=()=>{const c=connection();return c.connected&&c.revision===authorized.revision;};
      const writable=()=>mode==='step'&&current()&&canPublish()&&!manual(day)&&read(day)?.claim_owner===owner&&read(day).claim_until>now()&&
        local&&hash(local.buffer)===row.sha256&&hash(fs.readFileSync(manifest.videoPath))===row.sha256;
      const set=fields=>{save(day,owner,fields);row=read(day);};
      const accept=data=>{if(!validId(data?.id))throw fail('youtube_receipt_invalid');set({video_id:data.id,phase:'processing',error:null,next_check_at:now()+30000});};
      async function verify(){
        if(!current())throw fail('youtube_connection_changed');
        let result;try{result=await request('https://www.googleapis.com/youtube/v3/videos?part=id,snippet,status,processingDetails&id='+row.video_id,{headers:auth});}catch{throw fail('youtube_verification_temporary');}
        const {response,data}=result;
        if(response.status===429||response.status>=500||(response.ok&&Array.isArray(data?.items)&&data.items.length===0))throw fail('youtube_verification_temporary');
        if(!response.ok||!Array.isArray(data?.items)||data.items.length!==1)throw fail('youtube_verification_unavailable');
        const video=data.items[0],s=video.status||{};
        if(video.id!==row.video_id||video.snippet?.channelId!==YOUTUBE_PRAYER_CHANNEL||video.snippet?.title!==manifest.title||video.snippet?.description!==manifest.caption||s.selfDeclaredMadeForKids!==false||s.containsSyntheticMedia!==true)throw fail('youtube_receipt_binding_changed');
        const remote={privacyStatus:s.privacyStatus||null,uploadStatus:s.uploadStatus||null,processingStatus:video.processingDetails?.processingStatus||null,checkedAt:new Date(now()).toISOString()};
        const failed=['failed','rejected','deleted'].includes(s.uploadStatus)||video.processingDetails?.processingStatus==='failed';
        const phase=failed?'failed':s.privacyStatus==='private'||s.privacyStatus==='unlisted'?'private_requires_review':s.privacyStatus==='public'&&s.uploadStatus==='processed'?'published_verified':'processing';
        set({phase,remote_json:JSON.stringify(remote),error:phase==='private_requires_review'?'youtube_private_requires_review':failed?'youtube_processing_failed':null,next_check_at:now()+60000});
      }
      if(row.video_id){await verify();return snapshot(day);}
      if(!row.session_encrypted){
        if(row.phase!=='prepared'){set({phase:'held_unknown',error:'youtube_session_result_unknown',next_check_at:now()+3600000});return snapshot(day);}
        if(!writable())return {...snapshot(day),error:'youtube_publication_paused'};
        // Persist intent before either a session request or any video bytes are submitted.
        set({phase:'initiating',attempt_count:row.attempt_count+1});
        if(!writable()){set({phase:'prepared',error:'youtube_publication_paused'});return snapshot(day);}
        const body={snippet:{title:manifest.title,description:manifest.caption,categoryId:'22',defaultLanguage:'pt-BR'},status:{privacyStatus:'public',selfDeclaredMadeForKids:false,containsSyntheticMedia:true}};
        const {response}=await request('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',{method:'POST',headers:{...auth,'Content-Type':'application/json','X-Upload-Content-Type':'video/mp4','X-Upload-Content-Length':String(row.bytes)},body:JSON.stringify(body)});
        const url=safeSession(response.headers?.get('location'));
        if(response.status!==200||!url)throw fail('youtube_session_result_unknown');
        set({session_encrypted:encrypt(url),phase:'session_ready',error:null});
      }
      const session=safeSession(decrypt(row.session_encrypted));if(!session)throw fail('youtube_session_invalid');
      let offset=0;
      if(row.phase!=='session_ready'||mode==='status'){
        if(!current())throw fail('youtube_connection_changed');
        const {response,data}=await request(session,{method:'PUT',headers:{...auth,'Content-Length':'0','Content-Range':'bytes */'+row.bytes}});
        if([200,201].includes(response.status)){accept(data);await verify();return snapshot(day);}
        if(response.status===404||response.status===410){set({phase:'needs_review',error:'youtube_session_expired',next_check_at:0});return snapshot(day);}
        if(response.status!==308)throw fail('youtube_session_status_unknown');
        const range=response.headers?.get('range');
        if(range){const match=/^bytes=0-(\d+)$/.exec(range);if(!match)throw fail('youtube_session_range_invalid');offset=Number(match[1])+1;}
        if(!Number.isSafeInteger(offset)||offset<0||offset>=row.bytes)throw fail('youtube_session_range_invalid');
        set({phase:'uploading',error:null,next_check_at:now()+30000});
      }
      if(!writable())return snapshot(day);
      set({phase:'bytes_sending',attempt_count:row.attempt_count+1});
      if(!writable()){set({phase:'uploading',error:'youtube_publication_paused'});return snapshot(day);}
      const {response,data}=await request(session,{method:'PUT',headers:{...auth,'Content-Type':'video/mp4','Content-Length':String(row.bytes-offset),'Content-Range':`bytes ${offset}-${row.bytes-1}/${row.bytes}`},body:local.buffer.subarray(offset)});
      if([200,201].includes(response.status)){accept(data);await verify();}
      else if(response.status===308)set({phase:'uploading',next_check_at:now()+30000});
      else throw fail('youtube_upload_result_unknown');
      return snapshot(day);
    }catch(error){
      try{
        const latest=read(day),tokenWait=error.code==='youtube_refresh_retry_later',readWait=Boolean(latest?.video_id&&error.code==='youtube_verification_temporary');
        const delay=readWait?Math.min(900000,Math.max(60000,(latest.next_check_at-latest.updated_at)*2)):60000;
        save(day,owner,{phase:tokenWait?latest.phase:readWait?'processing':latest?.video_id?'needs_review':'held_unknown',error:safeError(error),next_check_at:Math.max(now()+delay,tokenWait&&Number.isSafeInteger(error.retryAt)?error.retryAt:0)});
      }catch{}
      return snapshot(day);
    }finally{db.prepare("UPDATE prayer_youtube_uploads SET claim_owner='',claim_until=0 WHERE day=? AND claim_owner=?").run(day,owner);}
  }
  return {publish,status:connection,snapshot,sourceFormat,pendingDays:()=>db.prepare("SELECT day FROM prayer_youtube_uploads WHERE phase NOT IN ('published_verified','private_requires_review','failed','needs_review') ORDER BY day LIMIT 30").all().map(r=>r.day)};
}
