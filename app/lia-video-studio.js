import { randomUUID } from 'node:crypto';

const CUSTOMER_BASE='/api/lia/video';
const ADMIN_BASE='/api/admin/lia-video';
const PLAN_CODE=/^[a-z0-9][a-z0-9_-]{1,39}$/;
const CHANNELS=new Set(['vitrine_social','instagram','facebook','tiktok','youtube','kwai']);
const VOICES=new Set(['alloy','ash','ballad','coral','echo','fable','onyx','nova','sage','shimmer','verse','marin','cedar']);
const ASPECTS=new Set(['9:16','16:9','1:1']);
const TERMINAL=new Set(['ready','published','failed','cancelled']);

function fail(code,status=400,message=code){throw Object.assign(new Error(message),{code,status});}
function clean(value,max=5000){return String(value??'').trim().slice(0,max);}
function int(value,min,max,fallback=null){const n=Number(value);return Number.isSafeInteger(n)&&n>=min&&n<=max?n:fallback;}
function bool(value){return value===true||value===1||String(value).toLowerCase()==='true';}
function json(value,fallback){try{return JSON.parse(value);}catch{return fallback;}}
function iso(value){const time=Date.parse(String(value||''));return Number.isFinite(time)?new Date(time).toISOString():null;}
function nowIso(now){return new Date(now()).toISOString();}
function publicPlan(row){return row?{code:row.code,name:row.name,maxVideoSeconds:Number(row.max_video_seconds),monthlyVideoSeconds:Number(row.monthly_video_seconds),maxScheduledPosts:Number(row.max_scheduled_posts),allowScheduling:Boolean(row.allow_scheduling),allowAutoPublish:Boolean(row.allow_auto_publish),active:Boolean(row.active)}:null;}
function publicSubscription(row){return row?{id:row.id,planCode:row.plan_code,status:row.status,periodStart:row.period_start,periodEnd:row.period_end,reservedVideoSeconds:Number(row.reserved_video_seconds||0),usedVideoSeconds:Number(row.used_video_seconds||0),reservedScheduledPosts:Number(row.reserved_scheduled_posts||0),usedScheduledPosts:Number(row.used_scheduled_posts||0)}:null;}
function publicJob(row){return row?{id:row.id,userId:Number(row.user_id),title:row.title,prompt:row.prompt,durationSeconds:Number(row.duration_seconds),aspectRatio:row.aspect_ratio,voice:row.voice,channels:json(row.channels_json,[]),scheduleAt:row.schedule_at||null,autoPublish:Boolean(row.auto_publish),status:row.status,script:row.script||'',description:row.description||'',hashtags:json(row.hashtags_json,[]),outputUrl:row.output_url||'',mediaProjectId:row.media_project_id||null,publicationId:row.publication_id||null,error:row.error||'',createdAt:row.created_at,updatedAt:row.updated_at}:null;}

export function setupLiaVideoStudio({app,db,requireUser,requireAdmin,sameOriginOnly,canRun=()=>true,now=Date.now,planContent,startScene,pollScene,synthesizeNarration,composeVideo,finalizeMedia,publishVitrine}={}){
  if(!app||!db||![requireUser,requireAdmin,sameOriginOnly,planContent,startScene,pollScene,synthesizeNarration,composeVideo,finalizeMedia,publishVitrine].every(fn=>typeof fn==='function'))throw new TypeError('LIA Video Studio requer dependências completas.');
  db.exec(`CREATE TABLE IF NOT EXISTS lia_video_plans(
    code TEXT PRIMARY KEY,name TEXT NOT NULL,max_video_seconds INTEGER NOT NULL,monthly_video_seconds INTEGER NOT NULL,
    max_scheduled_posts INTEGER NOT NULL DEFAULT 0,allow_scheduling INTEGER NOT NULL DEFAULT 0,allow_auto_publish INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS lia_video_subscriptions(
    id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,plan_code TEXT NOT NULL REFERENCES lia_video_plans(code),
    status TEXT NOT NULL CHECK(status IN ('active','revoked','expired')),period_start TEXT NOT NULL,period_end TEXT NOT NULL,
    reserved_video_seconds INTEGER NOT NULL DEFAULT 0,used_video_seconds INTEGER NOT NULL DEFAULT 0,
    reserved_scheduled_posts INTEGER NOT NULL DEFAULT 0,used_scheduled_posts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE INDEX IF NOT EXISTS idx_lia_video_sub_user ON lia_video_subscriptions(user_id,status,period_end);
  CREATE TABLE IF NOT EXISTS lia_video_jobs(
    id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,subscription_id TEXT REFERENCES lia_video_subscriptions(id),
    created_by_admin INTEGER NOT NULL DEFAULT 0,title TEXT NOT NULL,prompt TEXT NOT NULL,duration_seconds INTEGER NOT NULL,
    aspect_ratio TEXT NOT NULL,voice TEXT NOT NULL,channels_json TEXT NOT NULL,schedule_at TEXT,auto_publish INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK(status IN ('queued','planning','generating','narrating','editing','ready','publishing','published','failed','cancelled')),
    script TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '',hashtags_json TEXT NOT NULL DEFAULT '[]',
    audio_path TEXT NOT NULL DEFAULT '',output_url TEXT NOT NULL DEFAULT '',media_project_id INTEGER,publication_id TEXT NOT NULL DEFAULT '',error TEXT NOT NULL DEFAULT '',
    quota_state TEXT NOT NULL DEFAULT 'none' CHECK(quota_state IN ('none','reserved','used','refunded')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE INDEX IF NOT EXISTS idx_lia_video_jobs_status ON lia_video_jobs(status,created_at);
  CREATE INDEX IF NOT EXISTS idx_lia_video_jobs_user ON lia_video_jobs(user_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS lia_video_scenes(
    id INTEGER PRIMARY KEY,job_id TEXT NOT NULL REFERENCES lia_video_jobs(id) ON DELETE CASCADE,scene_number INTEGER NOT NULL,
    duration_seconds INTEGER NOT NULL,prompt TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','submitting','generating','downloaded','failed')),
    remote_job_id TEXT NOT NULL DEFAULT '',polling_url TEXT NOT NULL DEFAULT '',model TEXT NOT NULL DEFAULT '',local_path TEXT NOT NULL DEFAULT '',output_url TEXT NOT NULL DEFAULT '',error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(job_id,scene_number));
  CREATE INDEX IF NOT EXISTS idx_lia_video_scenes_status ON lia_video_scenes(status,id);
  CREATE TABLE IF NOT EXISTS lia_video_distribution(
    job_id TEXT NOT NULL REFERENCES lia_video_jobs(id) ON DELETE CASCADE,provider TEXT NOT NULL,status TEXT NOT NULL,
    publication_id TEXT NOT NULL DEFAULT '',publication_url TEXT NOT NULL DEFAULT '',error TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(job_id,provider));`);

  const activeSubscription=userId=>db.prepare(`SELECT s.*,p.name,p.max_video_seconds,p.monthly_video_seconds,p.max_scheduled_posts,p.allow_scheduling,p.allow_auto_publish,p.active plan_active
    FROM lia_video_subscriptions s JOIN lia_video_plans p ON p.code=s.plan_code
    WHERE s.user_id=? AND s.status='active' AND p.active=1 AND s.period_start<=? AND s.period_end>? ORDER BY s.period_end DESC LIMIT 1`).get(userId,nowIso(now),nowIso(now));
  const readJob=id=>db.prepare('SELECT * FROM lia_video_jobs WHERE id=?').get(id);
  const scenes=id=>db.prepare('SELECT * FROM lia_video_scenes WHERE job_id=? ORDER BY scene_number').all(id);
  const distributions=id=>db.prepare('SELECT * FROM lia_video_distribution WHERE job_id=? ORDER BY provider').all(id);
  const jobDto=row=>({...publicJob(row),scenes:scenes(row.id).map(s=>({sceneNumber:s.scene_number,durationSeconds:s.duration_seconds,status:s.status,outputUrl:s.output_url,error:s.error})),distribution:distributions(row.id).map(d=>({provider:d.provider,status:d.status,publicationId:d.publication_id||null,publicationUrl:d.publication_url||null,error:d.error||''}))});

  function reserveQuota(userId,durationSeconds,scheduled,autoPublish,scheduleAt){
    return db.transaction(()=>{
      const sub=activeSubscription(userId);if(!sub)fail('lia_video_plan_required',402,'Plano de vídeo ativo necessário.');
      if(durationSeconds>Number(sub.max_video_seconds))fail('lia_video_duration_not_allowed',422,'A duração excede o limite do plano.');
      if(Number(sub.used_video_seconds)+Number(sub.reserved_video_seconds)+durationSeconds>Number(sub.monthly_video_seconds))fail('lia_video_quota_exhausted',402,'Minutos de vídeo do período esgotados.');
      if(autoPublish&&!sub.allow_auto_publish)fail('lia_video_autopublish_not_allowed',403,'Seu plano não inclui autopublicação.');
      if(scheduled){
        if(!sub.allow_scheduling)fail('lia_video_scheduling_not_allowed',403,'Seu plano não inclui agendamento.');
        if(scheduleAt&&Date.parse(scheduleAt)>=Date.parse(sub.period_end))fail('lia_video_schedule_outside_plan',422,'O agendamento precisa ocorrer dentro do período ativo do plano.');
        if(Number(sub.used_scheduled_posts)+Number(sub.reserved_scheduled_posts)+1>Number(sub.max_scheduled_posts))fail('lia_video_schedule_quota_exhausted',402,'Cota de agendamentos esgotada.');
      }
      db.prepare(`UPDATE lia_video_subscriptions SET reserved_video_seconds=reserved_video_seconds+?,reserved_scheduled_posts=reserved_scheduled_posts+?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(durationSeconds,scheduled?1:0,sub.id);
      return sub;
    }).immediate();
  }
  function settleQuota(job,state){
    if(!job.subscription_id||job.quota_state!=='reserved')return;
    db.transaction(()=>{
      const current=readJob(job.id);if(!current||current.quota_state!=='reserved')return;
      const scheduled=Boolean(current.schedule_at);
      if(state==='used')db.prepare(`UPDATE lia_video_subscriptions SET reserved_video_seconds=MAX(0,reserved_video_seconds-?),used_video_seconds=used_video_seconds+?,reserved_scheduled_posts=MAX(0,reserved_scheduled_posts-?),used_scheduled_posts=used_scheduled_posts+?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(current.duration_seconds,current.duration_seconds,scheduled?1:0,scheduled?1:0,current.subscription_id);
      else db.prepare(`UPDATE lia_video_subscriptions SET reserved_video_seconds=MAX(0,reserved_video_seconds-?),reserved_scheduled_posts=MAX(0,reserved_scheduled_posts-?),updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(current.duration_seconds,scheduled?1:0,current.subscription_id);
      db.prepare('UPDATE lia_video_jobs SET quota_state=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(state,current.id);
    }).immediate();
  }
  function validateJob(input,{admin=false}={}){
    const title=clean(input.title,180)||'Vídeo LIA';const prompt=clean(input.prompt,6000);if(prompt.length<10)fail('lia_video_prompt_invalid',400,'Descreva o vídeo em pelo menos 10 caracteres.');
    const durationSeconds=int(input.durationSeconds,10,3600);if(!durationSeconds)fail('lia_video_duration_invalid',400,'Informe duração entre 10 e 3600 segundos.');
    const aspectRatio=ASPECTS.has(String(input.aspectRatio))?String(input.aspectRatio):'9:16';
    const voice=VOICES.has(String(input.voice))?String(input.voice):'coral';
    const channels=[...new Set((Array.isArray(input.channels)?input.channels:['vitrine_social']).map(String).filter(x=>CHANNELS.has(x)))];if(!channels.length)channels.push('vitrine_social');
    const scheduleAt=input.scheduleAt?iso(input.scheduleAt):null;if(input.scheduleAt&&!scheduleAt)fail('lia_video_schedule_invalid',400,'Data de agendamento inválida.');
    if(scheduleAt&&Date.parse(scheduleAt)<now()-60000)fail('lia_video_schedule_invalid',400,'Agendamento precisa estar no futuro.');
    return {title,prompt,durationSeconds,aspectRatio,voice,channels,scheduleAt,autoPublish:bool(input.autoPublish),admin};
  }
  function createJob(userId,input,{admin=false}={}){
    const data=validateJob(input,{admin});let sub=null;
    if(!admin)sub=reserveQuota(userId,data.durationSeconds,Boolean(data.scheduleAt),data.autoPublish,data.scheduleAt);
    const id='lv_'+randomUUID().replaceAll('-','');
    try{
      db.prepare(`INSERT INTO lia_video_jobs(id,user_id,subscription_id,created_by_admin,title,prompt,duration_seconds,aspect_ratio,voice,channels_json,schedule_at,auto_publish,status,quota_state)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'queued',?)`).run(id,userId,sub?.id||null,admin?1:0,data.title,data.prompt,data.durationSeconds,data.aspectRatio,data.voice,JSON.stringify(data.channels),data.scheduleAt,data.autoPublish?1:0,sub?'reserved':'none');
      return jobDto(readJob(id));
    }catch(error){if(sub){db.prepare(`UPDATE lia_video_subscriptions SET reserved_video_seconds=MAX(0,reserved_video_seconds-?),reserved_scheduled_posts=MAX(0,reserved_scheduled_posts-?),updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(data.durationSeconds,data.scheduleAt?1:0,sub.id);}throw error;}
  }
  function cancelJob(row){
    if(!row||TERMINAL.has(row.status))return row;
    db.prepare("UPDATE lia_video_jobs SET status='cancelled',error='',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status NOT IN ('ready','published','failed','cancelled')").run(row.id);
    settleQuota({...row,quota_state:row.quota_state},'refunded');
    return readJob(row.id);
  }

  const customerWrite=[requireUser,sameOriginOnly];
  app.get(CUSTOMER_BASE+'/status',requireUser,(req,res)=>{
    const sub=activeSubscription(req.user.id),plan=sub?publicPlan({...sub,code:sub.plan_code,name:sub.name,active:sub.plan_active}):null;
    return res.json({ok:true,enabled:true,plan,subscription:publicSubscription(sub),remainingVideoSeconds:sub?Math.max(0,Number(sub.monthly_video_seconds)-Number(sub.used_video_seconds)-Number(sub.reserved_video_seconds)):0,ttsRequired:true,autoPublishProviders:['vitrine_social']});
  });
  app.get(CUSTOMER_BASE+'/jobs',requireUser,(req,res)=>res.json({ok:true,items:db.prepare('SELECT * FROM lia_video_jobs WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(req.user.id).map(jobDto)}));
  app.post(CUSTOMER_BASE+'/jobs',...customerWrite,(req,res)=>{try{return res.status(201).json({ok:true,item:createJob(req.user.id,req.body||{})});}catch(error){return res.status(error.status||500).json({ok:false,code:error.code||'lia_video_create_failed',error:error.status?error.message:'Não foi possível criar o vídeo.'});}});
  app.post(CUSTOMER_BASE+'/jobs/:id/cancel',...customerWrite,(req,res)=>{const row=db.prepare('SELECT * FROM lia_video_jobs WHERE id=? AND user_id=?').get(req.params.id,req.user.id);if(!row)return res.status(404).json({ok:false,error:'Vídeo não encontrado.'});return res.json({ok:true,item:jobDto(cancelJob(row))});});

  const adminWrite=[requireAdmin,sameOriginOnly];
  app.get(ADMIN_BASE+'/customers',requireAdmin,(req,res)=>{const q=clean(req.query?.q,120).toLowerCase(),like='%'+q.replace(/[%_]/g,'')+'%';const items=db.prepare(`SELECT id,name,email FROM users WHERE ?='' OR lower(name) LIKE ? OR lower(email) LIKE ? ORDER BY id DESC LIMIT 30`).all(q,like,like);return res.json({ok:true,items});});
  app.get(ADMIN_BASE+'/subscriptions',requireAdmin,(_req,res)=>{const items=db.prepare(`SELECT s.*,u.name user_name,u.email user_email,p.name plan_name FROM lia_video_subscriptions s JOIN users u ON u.id=s.user_id JOIN lia_video_plans p ON p.code=s.plan_code ORDER BY s.created_at DESC LIMIT 100`).all().map(row=>({...publicSubscription(row),userId:row.user_id,userName:row.user_name,userEmail:row.user_email,planName:row.plan_name}));return res.json({ok:true,items});});
  app.get(ADMIN_BASE+'/plans',requireAdmin,(_req,res)=>res.json({ok:true,items:db.prepare('SELECT * FROM lia_video_plans ORDER BY code').all().map(publicPlan)}));
  app.post(ADMIN_BASE+'/plans',...adminWrite,(req,res)=>{try{const code=String(req.body?.code||'').toLowerCase();if(!PLAN_CODE.test(code))fail('lia_video_plan_invalid',400,'Código de plano inválido.');const name=clean(req.body?.name,120);if(name.length<2)fail('lia_video_plan_invalid',400,'Nome do plano inválido.');const maxVideo=int(req.body?.maxVideoSeconds,10,3600),monthly=int(req.body?.monthlyVideoSeconds,10,1_000_000),scheduled=int(req.body?.maxScheduledPosts,0,10000,0);if(!maxVideo||!monthly||maxVideo>monthly)fail('lia_video_plan_invalid',400,'Limites do plano inválidos.');db.prepare(`INSERT INTO lia_video_plans(code,name,max_video_seconds,monthly_video_seconds,max_scheduled_posts,allow_scheduling,allow_auto_publish,active) VALUES (?,?,?,?,?,?,?,1) ON CONFLICT(code) DO UPDATE SET name=excluded.name,max_video_seconds=excluded.max_video_seconds,monthly_video_seconds=excluded.monthly_video_seconds,max_scheduled_posts=excluded.max_scheduled_posts,allow_scheduling=excluded.allow_scheduling,allow_auto_publish=excluded.allow_auto_publish,active=1,updated_at=CURRENT_TIMESTAMP`).run(code,name,maxVideo,monthly,scheduled,bool(req.body?.allowScheduling)?1:0,bool(req.body?.allowAutoPublish)?1:0);return res.status(201).json({ok:true,item:publicPlan(db.prepare('SELECT * FROM lia_video_plans WHERE code=?').get(code))});}catch(error){return res.status(error.status||500).json({ok:false,code:error.code||'lia_video_plan_failed',error:error.message});}});
  app.post(ADMIN_BASE+'/subscriptions',...adminWrite,(req,res)=>{try{const userId=int(req.body?.userId,1,Number.MAX_SAFE_INTEGER),planCode=String(req.body?.planCode||''),start=iso(req.body?.periodStart),end=iso(req.body?.periodEnd);if(!userId||!PLAN_CODE.test(planCode)||!start||!end||Date.parse(end)<=Date.parse(start))fail('lia_video_subscription_invalid',400,'Assinatura inválida.');if(!db.prepare('SELECT 1 FROM users WHERE id=?').get(userId))fail('lia_video_user_not_found',404,'Cliente não encontrado.');if(!db.prepare('SELECT 1 FROM lia_video_plans WHERE code=? AND active=1').get(planCode))fail('lia_video_plan_not_found',404,'Plano não encontrado.');db.prepare("UPDATE lia_video_subscriptions SET status='revoked',updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND status='active'").run(userId);const id='lvs_'+randomUUID().replaceAll('-','');db.prepare(`INSERT INTO lia_video_subscriptions(id,user_id,plan_code,status,period_start,period_end) VALUES (?,?,?,'active',?,?)`).run(id,userId,planCode,start,end);return res.status(201).json({ok:true,item:publicSubscription(db.prepare('SELECT * FROM lia_video_subscriptions WHERE id=?').get(id))});}catch(error){return res.status(error.status||500).json({ok:false,code:error.code||'lia_video_subscription_failed',error:error.message});}});
  app.get(ADMIN_BASE+'/jobs',requireAdmin,(_req,res)=>res.json({ok:true,items:db.prepare('SELECT * FROM lia_video_jobs ORDER BY created_at DESC LIMIT 100').all().map(jobDto)}));
  app.post(ADMIN_BASE+'/jobs',...adminWrite,(req,res)=>{try{const userId=int(req.body?.userId,1,Number.MAX_SAFE_INTEGER);if(!userId||!db.prepare('SELECT 1 FROM users WHERE id=?').get(userId))fail('lia_video_user_not_found',404,'Cliente não encontrado.');return res.status(201).json({ok:true,item:createJob(userId,req.body||{},{admin:true})});}catch(error){return res.status(error.status||500).json({ok:false,code:error.code||'lia_video_create_failed',error:error.message});}});
  app.post(ADMIN_BASE+'/jobs/:id/cancel',...adminWrite,(req,res)=>{const row=readJob(req.params.id);if(!row)return res.status(404).json({ok:false,error:'Vídeo não encontrado.'});return res.json({ok:true,item:jobDto(cancelJob(row))});});

  let running=false;
  async function process(){
    if(running||!canRun())return false;running=true;
    try{
      const due=db.prepare("SELECT * FROM lia_video_jobs WHERE status='ready' AND auto_publish=1 AND instr(channels_json,'vitrine_social')>0 AND (schedule_at IS NULL OR schedule_at<=?) ORDER BY COALESCE(schedule_at,created_at),created_at LIMIT 1").get(nowIso(now));
      if(due){
        db.prepare("UPDATE lia_video_jobs SET status='publishing',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='ready'").run(due.id);
        try{const receipt=await publishVitrine(jobDto(readJob(due.id)));db.prepare("UPDATE lia_video_jobs SET status='published',publication_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(String(receipt?.postId||receipt?.publicationId||''),due.id);db.prepare("UPDATE lia_video_distribution SET status='published',publication_id=?,publication_url=?,error='',updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND provider='vitrine_social'").run(String(receipt?.postId||receipt?.publicationId||''),String(receipt?.publicUrl||''),due.id);}
        catch(error){db.prepare("UPDATE lia_video_jobs SET status='ready',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(String(error?.message||'publication_failed').slice(0,500),due.id);db.prepare("UPDATE lia_video_distribution SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND provider='vitrine_social'").run(String(error?.message||'publication_failed').slice(0,500),due.id);}
        return true;
      }
      let job=db.prepare("SELECT * FROM lia_video_jobs WHERE status IN ('queued','planning','generating','narrating','editing') ORDER BY created_at LIMIT 1").get();if(!job)return false;
      if(job.status==='queued'){
        db.prepare("UPDATE lia_video_jobs SET status='planning',error='',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'").run(job.id);job=readJob(job.id);
        try{const count=Math.ceil(job.duration_seconds/8),durations=Array.from({length:count},(_,i)=>i===count-1?job.duration_seconds-8*(count-1):8),plan=await planContent(publicJob(job),durations);if(!plan||!Array.isArray(plan.scenePrompts)||plan.scenePrompts.length!==count)throw Error('lia_video_plan_invalid');db.transaction(()=>{db.prepare("UPDATE lia_video_jobs SET script=?,description=?,hashtags_json=?,status='generating',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='planning'").run(clean(plan.narration,20000),clean(plan.description,2200),JSON.stringify((plan.hashtags||[]).map(x=>String(x).replace(/^#/,'').slice(0,50)).filter(Boolean).slice(0,20)),job.id);const ins=db.prepare('INSERT INTO lia_video_scenes(job_id,scene_number,duration_seconds,prompt) VALUES (?,?,?,?)');durations.forEach((duration,index)=>ins.run(job.id,index+1,duration,clean(plan.scenePrompts[index],1800)));})();return true;}catch(error){db.prepare("UPDATE lia_video_jobs SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(String(error?.message||'planning_failed').slice(0,500),job.id);settleQuota({...job,quota_state:job.quota_state},'refunded');return true;}
      }
      if(job.status==='generating'){
        const pending=db.prepare("SELECT * FROM lia_video_scenes WHERE job_id=? AND status='pending' ORDER BY scene_number LIMIT 1").get(job.id);
        if(pending){db.prepare("UPDATE lia_video_scenes SET status='submitting',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").run(pending.id);try{const receipt=await startScene({...pending,aspectRatio:job.aspect_ratio});db.prepare("UPDATE lia_video_scenes SET status='generating',remote_job_id=?,polling_url=?,model=?,error='',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(receipt.jobId,receipt.pollingUrl,receipt.model||'',pending.id);}catch(error){db.prepare("UPDATE lia_video_scenes SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(String(error?.message||'generation_submit_failed').slice(0,500),pending.id);}return true;}
        const active=db.prepare("SELECT * FROM lia_video_scenes WHERE job_id=? AND status='generating' ORDER BY scene_number LIMIT 2").all(job.id);
        for(const scene of active){try{const result=await pollScene(scene);if(result.state!=='completed')continue;db.prepare("UPDATE lia_video_scenes SET status='downloaded',local_path=?,output_url=?,error='',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(result.localPath,result.outputUrl||'',scene.id);}catch(error){if(error?.retryable!==true)db.prepare("UPDATE lia_video_scenes SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(String(error?.message||'generation_failed').slice(0,500),scene.id);}}
        const failed=db.prepare("SELECT 1 FROM lia_video_scenes WHERE job_id=? AND status='failed' LIMIT 1").get(job.id);if(failed){db.prepare("UPDATE lia_video_jobs SET status='failed',error='Uma ou mais cenas falharam.',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(job.id);settleQuota({...job,quota_state:job.quota_state},'refunded');return true;}
        const totals=db.prepare("SELECT COUNT(*) total,SUM(status='downloaded') done FROM lia_video_scenes WHERE job_id=?").get(job.id);if(Number(totals.total)>0&&Number(totals.total)===Number(totals.done))db.prepare("UPDATE lia_video_jobs SET status='narrating',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(job.id);return true;
      }
      if(job.status==='narrating'){
        try{const audio=await synthesizeNarration(publicJob(job));db.prepare("UPDATE lia_video_jobs SET audio_path=?,status='editing',error='',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='narrating'").run(audio.localPath,job.id);}catch(error){db.prepare("UPDATE lia_video_jobs SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(String(error?.message||'tts_failed').slice(0,500),job.id);settleQuota({...job,quota_state:job.quota_state},'refunded');}return true;
      }
      if(job.status==='editing'){
        try{const current=readJob(job.id),parts=scenes(job.id);const composed=await composeVideo(publicJob(current),parts,current.audio_path);const media=await finalizeMedia(publicJob(current),composed.outputUrl);db.transaction(()=>{db.prepare("UPDATE lia_video_jobs SET output_url=?,media_project_id=?,status='ready',error='',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='editing'").run(composed.outputUrl,media?.id||null,job.id);const ins=db.prepare('INSERT OR REPLACE INTO lia_video_distribution(job_id,provider,status,error) VALUES (?,?,?,?)');for(const provider of json(current.channels_json,[]))ins.run(job.id,provider,provider==='vitrine_social'?(current.auto_publish?'scheduled':'ready'):'awaiting_connection','');})();settleQuota({...current,quota_state:current.quota_state},'used');return true;}catch(error){db.prepare("UPDATE lia_video_jobs SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(String(error?.message||'editing_failed').slice(0,500),job.id);settleQuota({...job,quota_state:job.quota_state},'refunded');return true;}
      }
      return false;
    }finally{running=false;}
  }
  return {process,activeSubscription,job:id=>{const row=readJob(id);return row?jobDto(row):null;}};
}
