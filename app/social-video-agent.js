import {createHash,randomUUID} from 'node:crypto';

export function directVideoPublisher(user, configuredIds='') {
  return user?.account_status==='active' && Number.isSafeInteger(user?.id) &&
    String(configuredIds).split(',').map(v=>v.trim()).filter(v=>/^[1-9]\d*$/.test(v)).includes(String(user.id));
}
const fingerprint=p=>createHash('sha256').update(JSON.stringify([p.user_id,p.video_uid,p.caption,p.cta_label,p.cta_url,p.moderation_status,p.moderation_reason,p.moderated_at])).digest('hex');

// Only caption and sampled video frames leave the server; no user identity or credentials.
export function createVideoSafetyReview({apiKey,fetchImpl=fetch}) {
  return async(post,video)=>{
    if(!apiKey())throw Error('moderation_unconfigured');
    const base=new URL(video.thumbnail);
    if(base.protocol!=='https:'||base.username||base.password||base.port||
      !/^(?:customer-[a-z0-9]+\.cloudflarestream\.com|videodelivery\.net)$/.test(base.hostname)||
      base.pathname!==`/${post.video_uid}/thumbnails/thumbnail.jpg`)throw Error('thumbnail_invalid');
    const duration=Number(video.duration);if(!(duration>0&&duration<=3600))throw Error('duration_invalid');
    const times=[.05,.25,.5,.75,.95].map(f=>Math.min(duration-.05,Math.max(0,duration*f)).toFixed(2));
    const input=[{type:'text',text:[post.caption,post.cta_label,post.cta_url].filter(Boolean).join('\n')||'Vídeo sem legenda.'}];
    for(const time of times){
      const u=new URL(base);u.search='';u.searchParams.set('time',time+'s');u.searchParams.set('width','480');
      const r=await fetchImpl(u,{redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!r.ok||!/^image\/jpeg\b/.test(r.headers.get('content-type')||''))throw Error('thumbnail_unavailable');
      if(Number(r.headers.get('content-length'))>2*1024*1024)throw Error('thumbnail_too_large');
      const chunks=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>2*1024*1024)throw Error('thumbnail_too_large');chunks.push(chunk);}
      if(!size)throw Error('thumbnail_empty');
      input.push({type:'image_url',image_url:{url:'data:image/jpeg;base64,'+Buffer.concat(chunks).toString('base64')}});
    }
    const r=await fetchImpl('https://api.openai.com/v1/moderations',{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+apiKey(),'Content-Type':'application/json'},body:JSON.stringify({model:'omni-moderation-latest',input})});
    if(!r.ok)throw Error('moderation_unavailable');const d=await r.json();
    if(!d.id||!Array.isArray(d.results)||!d.results.length||d.results.some(x=>typeof x.flagged!=='boolean'||!x.categories||!Object.keys(x.categories).length))throw Error('moderation_invalid');
    const flags=[...new Set(d.results.flatMap(x=>Object.entries(x.categories).filter(([,v])=>v===true).map(([k])=>k)))];
    return {approved:d.results.every(x=>!x.flagged)&&!flags.length,flags,model:d.model||'omni-moderation-latest',receipt:d.id,sampledFrames:times.length,coverage:'caption_and_sampled_frames'};
  };
}

export function createSocialVideoAgent({db,lifecycle,getConfig,review,canRun=()=>true,now=Date.now,schedule=true,fetchImpl=fetch}) {
  db.exec(`CREATE TABLE IF NOT EXISTS social_video_agent_jobs(post_id TEXT PRIMARY KEY REFERENCES social_posts(id),state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,claim TEXT NOT NULL DEFAULT '',lease_until INTEGER NOT NULL DEFAULT 0,decision_json TEXT NOT NULL DEFAULT '{}',error_code TEXT NOT NULL DEFAULT '',updated_at INTEGER NOT NULL DEFAULT 0)`);
  const read=id=>db.prepare('SELECT * FROM social_posts WHERE id=?').get(id);
  const blocked=p=>!p||!['uploading','processing','pending_review'].includes(p.status)||!['pending','flagged','approved'].includes(p.moderation_status)||
    db.prepare("SELECT 1 FROM social_account_restrictions WHERE user_id=? AND status='suspended' AND (restricted_until IS NULL OR restricted_until>CURRENT_TIMESTAMP)").get(p.user_id)||
    db.prepare("SELECT 1 FROM social_reports WHERE post_id=? AND status='open'").get(p.id)||
    db.prepare('SELECT account_status FROM users WHERE id=?').get(p.user_id)?.account_status!=='active';
  let busy=false;
  async function run(){
    if(busy||!canRun())return;const config=getConfig();if(!config.enabled)return;
    busy=true;
    try{
      const rows=db.prepare(`SELECT p.id FROM social_posts p LEFT JOIN social_video_agent_jobs j ON j.post_id=p.id
        WHERE p.media_type='video' AND p.status IN ('uploading','processing','pending_review') AND p.moderation_status IN ('pending','flagged','approved')
        AND (j.post_id IS NULL OR (j.state IN ('pending','retry','working') AND j.next_at<=? AND j.lease_until<=?))
        ORDER BY COALESCE(j.updated_at,0),p.created_at LIMIT 12`).all(now(),now());
      for(const {id} of rows){
        if(!canRun())break;let post=read(id);if(blocked(post)||!/^[a-f0-9]{32}$/i.test(post.video_uid))continue;
        const claim=randomUUID();
        const acquired=db.transaction(()=>{db.prepare('INSERT OR IGNORE INTO social_video_agent_jobs(post_id) VALUES(?)').run(id);return db.prepare("UPDATE social_video_agent_jobs SET claim=?,lease_until=?,state='working',updated_at=? WHERE post_id=? AND lease_until<=? AND state IN ('pending','retry','working')").run(claim,now()+180000,now(),id,now()).changes;}).immediate();
        if(!acquired)continue;
        const save=(state,decision={},error='',delay=0)=>db.prepare("UPDATE social_video_agent_jobs SET state=?,decision_json=?,error_code=?,next_at=?,lease_until=0,claim='',updated_at=? WHERE post_id=? AND claim=?").run(state,JSON.stringify(decision),error,now()+delay,now(),id,claim);
        try{
          const r=await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/stream/${post.video_uid}`,{headers:{Authorization:'Bearer '+config.token},redirect:'error',signal:AbortSignal.timeout(15000)});
          const payload=await r.json();if(!r.ok||payload.result?.uid!==post.video_uid)throw Error('stream_unavailable');
          const video=payload.result;lifecycle.applyStream(video);post=read(id);
          if(post.status==='ready'){save('published');continue;}if(post.status==='error'){save('error',{},'stream_processing_failed');continue;}
          if(blocked(post)){save('review');continue;}
          if(post.stream_state!=='ready'){save('pending',{},'',15000);continue;}
          const original=fingerprint(post),user=db.prepare('SELECT id,account_status FROM users WHERE id=?').get(post.user_id);
          const direct=directVideoPublisher(user,config.directUserIds);
          const decision=direct?{approved:true,method:'owner_direct'}:post.moderation_reason?{approved:false,flags:['caption_rule'],method:'caption_rule'}:await review(post,video);
          db.transaction(()=>{
            const current=read(id),job=db.prepare('SELECT claim,lease_until FROM social_video_agent_jobs WHERE post_id=?').get(id);
            if(!canRun()||job?.claim!==claim||job.lease_until<=now()||blocked(current)||fingerprint(current)!==original){save('review',{},'state_changed');return;}
            const status=decision.approved?lifecycle.approvalStatus(current):'pending_review';
            if(decision.approved&&status!=='ready'){save('review',decision,'publication_blocked');return;}
            db.prepare("UPDATE social_posts SET moderation_status=?,moderation_reason=?,moderated_by=NULL,moderated_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(decision.approved?'approved':'flagged',decision.approved?'':'Análise adicional necessária.',id);
            db.prepare("INSERT INTO social_moderation_actions(post_id,author_id,admin_id,action,reason_code,note,previous_status,new_status) VALUES(?,?,NULL,?,'outro',?,?,?)").run(id,post.user_id,decision.approved?'auto_approve':'auto_review',JSON.stringify(decision).slice(0,1500),current.status,status);
            if(decision.approved)lifecycle.applyStream(video);
            save(decision.approved?'published':'review',decision);
          }).immediate();
        }catch{
          const job=db.prepare('SELECT attempts FROM social_video_agent_jobs WHERE post_id=?').get(id);const attempts=(job?.attempts||0)+1;
          db.prepare('UPDATE social_video_agent_jobs SET attempts=? WHERE post_id=? AND claim=?').run(attempts,id,claim);
          save(attempts>=4?'review':'retry',{},'analysis_temporarily_unavailable',Math.min(300000,15000*2**attempts));
        }
      }
    }finally{busy=false;}
  }
  const timer=schedule?setInterval(()=>run().catch(()=>{}),15000):null;timer?.unref();
  return {run,close:()=>clearInterval(timer),status:id=>db.prepare('SELECT state,attempts,error_code FROM social_video_agent_jobs WHERE post_id=?').get(id)||null};
}
