import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import {setupLiaVideoStudio} from '../lia-video-studio.js';

function fixture(){
  const db=new Database(':memory:');
  db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT);
    INSERT INTO users(id,name,email) VALUES (1,'Cliente','cliente@example.com'),(2,'Sem Plano','sem@example.com');`);
  const app=express();app.use(express.json());
  const requireUser=(req,_res,next)=>{req.user={id:Number(req.get('x-user-id')||1),email:'cliente@example.com'};next();};
  const requireAdmin=(req,_res,next)=>{req.user={id:99,email:'admin@example.com',is_admin:1};next();};
  const sameOriginOnly=(_req,_res,next)=>next();
  let published=0;
  const service=setupLiaVideoStudio({
    app,db,requireUser,requireAdmin,sameOriginOnly,
    planContent:async(job,durations)=>({
      narration:`Narração para ${job.title} com duração controlada.`,
      description:'Descrição pronta para publicação.',
      hashtags:['vitrinecity','videoia'],
      scenePrompts:durations.map((duration,index)=>`Cena ${index+1}, duração ${duration}s`)
    }),
    startScene:async scene=>({jobId:`provider-${scene.id}`,pollingUrl:`/jobs/${scene.id}`,model:'test-video'}),
    pollScene:async scene=>({state:'completed',localPath:`/tmp/scene-${scene.id}.mp4`,outputUrl:`/uploads/scene-${scene.id}.mp4`}),
    synthesizeNarration:async job=>({localPath:`/tmp/${job.id}.mp3`}),
    composeVideo:async job=>({outputUrl:`/uploads/generated-videos/${job.id}.mp4`}),
    finalizeMedia:async()=>({id:321}),
    publishVitrine:async()=>{published+=1;return {postId:'post-1',publicUrl:'/social/post/post-1'};}
  });
  const server=app.listen(0);
  const base=`http://127.0.0.1:${server.address().port}`;
  const api=async(path,{method='GET',body,userId=1}={})=>{
    const response=await fetch(base+path,{method,headers:{'content-type':'application/json','x-user-id':String(userId)},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,data:await response.json()};
  };
  return {db,service,server,api,published:()=>published};
}

test('cliente precisa de plano e plano controla minutos, agendamento e autopublicação',async t=>{
  const f=fixture();t.after(()=>{f.server.close();f.db.close();});
  let response=await f.api('/api/lia/video/jobs',{method:'POST',userId:2,body:{prompt:'Criar um vídeo de teste completo',durationSeconds:16}});
  assert.equal(response.status,402);
  assert.equal(response.data.code,'lia_video_plan_required');

  response=await f.api('/api/admin/lia-video/plans',{method:'POST',body:{
    code:'pro',name:'Plano Pro',maxVideoSeconds:60,monthlyVideoSeconds:120,maxScheduledPosts:3,allowScheduling:true,allowAutoPublish:true
  }});
  assert.equal(response.status,201);

  const start=new Date(Date.now()-60_000).toISOString(),end=new Date(Date.now()+86400_000).toISOString();
  response=await f.api('/api/admin/lia-video/subscriptions',{method:'POST',body:{userId:1,planCode:'pro',periodStart:start,periodEnd:end}});
  assert.equal(response.status,201);

  response=await f.api('/api/lia/video/jobs',{method:'POST',body:{
    title:'Vídeo 16 segundos',prompt:'Criar um vídeo educativo de jardinagem com narração e cenas dinâmicas',
    durationSeconds:16,aspectRatio:'9:16',voice:'coral',channels:['vitrine_social','youtube'],autoPublish:true
  }});
  assert.equal(response.status,201);
  const id=response.data.item.id;
  assert.equal(response.data.item.status,'queued');

  for(let i=0;i<12;i++)await f.service.process();
  response=await f.api('/api/lia/video/jobs');
  const job=response.data.items.find(item=>item.id===id);
  assert.equal(job.status,'published');
  assert.equal(job.outputUrl,`/uploads/generated-videos/${id}.mp4`);
  assert.equal(job.mediaProjectId,321);
  assert.equal(job.description,'Descrição pronta para publicação.');
  assert.deepEqual(job.hashtags,['vitrinecity','videoia']);
  assert.equal(job.scenes.length,2);
  assert.equal(job.distribution.find(item=>item.provider==='vitrine_social').status,'published');
  assert.equal(job.distribution.find(item=>item.provider==='youtube').status,'awaiting_connection');
  assert.equal(f.published(),1);

  const status=await f.api('/api/lia/video/status');
  assert.equal(status.data.subscription.usedVideoSeconds,16);
  assert.equal(status.data.remainingVideoSeconds,104);
});

test('plano rejeita duração acima do limite e agendamento fora do período',async t=>{
  const f=fixture();t.after(()=>{f.server.close();f.db.close();});
  await f.api('/api/admin/lia-video/plans',{method:'POST',body:{
    code:'curto',name:'Curto',maxVideoSeconds:30,monthlyVideoSeconds:60,maxScheduledPosts:1,allowScheduling:true,allowAutoPublish:true
  }});
  const start=new Date(Date.now()-60_000).toISOString(),end=new Date(Date.now()+3600_000).toISOString();
  await f.api('/api/admin/lia-video/subscriptions',{method:'POST',body:{userId:1,planCode:'curto',periodStart:start,periodEnd:end}});

  let response=await f.api('/api/lia/video/jobs',{method:'POST',body:{prompt:'Vídeo acima do limite contratado',durationSeconds:31}});
  assert.equal(response.status,422);
  assert.equal(response.data.code,'lia_video_duration_not_allowed');

  response=await f.api('/api/lia/video/jobs',{method:'POST',body:{
    prompt:'Vídeo com agendamento fora do período do plano',durationSeconds:20,autoPublish:true,
    scheduleAt:new Date(Date.now()+7200_000).toISOString()
  }});
  assert.equal(response.status,422);
  assert.equal(response.data.code,'lia_video_schedule_outside_plan');
});
