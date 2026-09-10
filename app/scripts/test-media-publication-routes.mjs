import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import Database from 'better-sqlite3';

test('real admin routes and signed callbacks preserve moderation, receipts and truthful publication', {timeout:45000}, async()=>{
  const temp=mkdtempSync(path.join(tmpdir(),'vitriny-stream-offline-')),port=41000+Math.floor(Math.random()*1000),origin=`http://127.0.0.1:${port}`;
  const mock=path.join(temp,'mock.json'),log=path.join(temp,'calls.json'),preload=path.join(temp,'provider-mock.mjs'),uid='a'.repeat(32),secret='stream-offline-secret';
  writeFileSync(mock,JSON.stringify({uid,ready:false}));writeFileSync(log,'[]');
  writeFileSync(preload,`import fs from 'node:fs';
    globalThis.fetch=async(input,opts={})=>{
      const url=new URL(String(input)),config=JSON.parse(fs.readFileSync(process.env.STREAM_TEST_MOCK));
      if(url.origin!=='https://api.cloudflare.com'||!url.pathname.includes('/stream/'))throw Error('OFFLINE_TEST_NETWORK_BLOCKED');
      const calls=JSON.parse(fs.readFileSync(process.env.STREAM_TEST_LOG));calls.push({method:opts.method,path:url.pathname});fs.writeFileSync(process.env.STREAM_TEST_LOG,JSON.stringify(calls));
      return new Response(JSON.stringify({success:true,result:{uid:config.uid,readyToStream:config.ready,status:{state:config.ready?'ready':'inprogress'}}}),{status:200,headers:{'Content-Type':'application/json'}});
    };`);
  const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:temp,TMP:temp,DATA_DIR:temp,PORT:String(port),SITE_URL:origin,
    AI_MEDIA_PROVIDER:'openrouter',OPENROUTER_API_KEY:'OFFLINE_ONLY',
    STREAM_TEST_MOCK:mock,STREAM_TEST_LOG:log,CLOUDFLARE_ACCOUNT_ID:'c'.repeat(32),CLOUDFLARE_STREAM_API_TOKEN:'OFFLINE_ONLY',CLOUDFLARE_STREAM_WEBHOOK_SECRET:secret};
  let output='',db;
  const child=spawn(process.execPath,['--import',pathToFileURL(preload).href,'server.js'],{cwd:new URL('..',import.meta.url),env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const request=(url,opts={})=>fetch(origin+url,{...opts,headers:{origin,'Content-Type':'application/json',...opts.headers}});
  const json=(method,body,cookie)=>({method,body:JSON.stringify(body),headers:{cookie}});
  try{
    let healthy=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok){healthy=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(healthy,output);
    assert.equal((await request('/api/admin/media-projects/1/publish-vitriny',{method:'POST'})).status,401);
    assert.equal((await request('/api/admin/media-projects/1/sync-publication',{method:'POST'})).status,401);
    let response=await request('/api/auth/register',json('POST',{name:'Teste Stream',email:'stream@example.com',password:'senha-forte-12345',adultConfirmed:true,termsAccepted:true}));assert.equal(response.status,201);
    const userCookie=response.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/api/admin/media-projects/1/sync-publication',json('POST',{},userCookie))).status,403);
    db=new Database(path.join(temp,'vitrinecity.db'));const userId=db.prepare("SELECT id FROM users WHERE email='stream@example.com'").get().id;
    db.prepare('UPDATE users SET is_admin=1 WHERE id=?').run(userId);db.prepare("UPDATE admin_specialist_agents SET status='active' WHERE code='midia'").run();
    response=await request('/api/admin/auth/login',json('POST',{email:'stream@example.com',password:'senha-forte-12345'}));assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];
    response=await request('/api/admin/media-factory',json('POST',{format:'short_video',title:'Vídeo de teste',prompt:'Vídeo ilustrativo para teste local'},cookie));assert.equal(response.status,201);const id=(await response.json()).project.id;
    db.prepare("UPDATE admin_media_projects SET output_url='https://vitrinecity.com/uploads/test.mp4',production_status='approved' WHERE id=?").run(id);
    assert.equal((await request(`/api/admin/media-projects/${id}/publish-vitriny`,{...json('POST',{},cookie),headers:{cookie,origin:'https://outro.example'}})).status,403);
    response=await request(`/api/admin/media-projects/${id}/publish-vitriny`,json('POST',{},cookie));assert.equal(response.status,202);const first=await response.json();assert.equal(first.publication.status,'processing');const postId=first.postId;
    response=await request(`/api/admin/media-projects/${id}/publish-vitriny`,json('POST',{},cookie));assert.equal((await response.json()).postId,postId);assert.equal(JSON.parse(readFileSync(log)).length,1);
    assert.equal((await request(`/api/admin/media-projects/${id}`,json('PATCH',{productionStatus:'published'},cookie))).status,409);
    assert.equal((await request(`/api/admin/media-projects/${id}`,json('PATCH',{productionStatus:'approved',outputUrl:'https://vitrinecity.com/other.mp4'},cookie))).status,409);
    const signed=async(video,bad=false)=>{const raw=JSON.stringify(video),time=Math.floor(Date.now()/1000),sig=createHmac('sha256',secret).update(time+'.').update(raw).digest('hex');return request('/api/webhooks/cloudflare-stream',{method:'POST',body:raw,headers:{'webhook-signature':`time=${time},sig1=${bad?'0'.repeat(64):sig}`}})};
    assert.equal((await signed({uid,readyToStream:true},true)).status,401);assert.equal(db.prepare('SELECT status FROM social_posts WHERE id=?').get(postId).status,'processing');
    assert.equal((await signed({uid,readyToStream:true,duration:36})).status,200);let row=db.prepare('SELECT * FROM social_posts WHERE id=?').get(postId);assert.equal(row.status,'ready');assert.equal(row.moderation_status,'approved');assert.equal(row.stream_state,'ready');
    await signed({uid,status:{state:'inprogress'}});await signed({uid,status:{state:'error'}});assert.equal(db.prepare('SELECT status FROM social_posts WHERE id=?').get(postId).status,'ready');
    const ordinary='b'.repeat(32);db.prepare("INSERT INTO social_posts(id,user_id,video_uid,status,moderation_status) VALUES('ordinary-test',?,?,'uploading','pending')").run(userId,ordinary);
    await request('/api/admin/social/posts/ordinary-test/moderation',json('PATCH',{action:'approve'},cookie));assert.equal(db.prepare("SELECT status FROM social_posts WHERE id='ordinary-test'").get().status,'processing');
    db.prepare("UPDATE social_posts SET moderation_status='pending' WHERE id='ordinary-test'").run();await signed({uid:ordinary,readyToStream:true});assert.equal(db.prepare("SELECT status FROM social_posts WHERE id='ordinary-test'").get().status,'pending_review');
    await request('/api/admin/social/posts/ordinary-test/moderation',json('PATCH',{action:'approve'},cookie));assert.equal(db.prepare("SELECT status FROM social_posts WHERE id='ordinary-test'").get().status,'ready');
    response=await request(`/api/admin/social/posts/${postId}/moderation`,json('PATCH',{action:'remove',reasonCode:'outro',note:'Removido durante teste local.'},cookie));assert.equal(response.status,200);
    await signed({uid,readyToStream:true});assert.equal(db.prepare('SELECT status FROM social_posts WHERE id=?').get(postId).status,'deleted');
    writeFileSync(mock,JSON.stringify({uid,ready:true}));response=await request(`/api/admin/media-projects/${id}/sync-publication`,json('POST',{},cookie));assert.equal((await response.json()).publication.status,'blocked');
    assert.deepEqual(JSON.parse(readFileSync(log)).map(x=>x.method),['POST','GET']);
    const legacy='d'.repeat(32);db.prepare("INSERT INTO social_posts(id,user_id,video_uid,status,moderation_status) VALUES('legacy-ready',?,?,'ready','approved')").run(userId,legacy);await signed({uid:legacy,status:{state:'inprogress'}});assert.equal(db.prepare("SELECT status FROM social_posts WHERE id='legacy-ready'").get().status,'ready');
    response=await request('/api/admin/media-factory',{headers:{cookie}});const project=(await response.json()).projects.find(x=>x.id===id);assert.equal(project.publication.status,'blocked');assert.notEqual(project.production_status,'published');
    response=await request('/api/admin/media-factory',json('POST',{format:'short_video',title:'Tarefa a cancelar',prompt:'Montagem somente para teste'},cookie));const cancelled=(await response.json()).project;
    db.prepare("UPDATE admin_media_projects SET output_url='https://vitrinecity.com/uploads/cancelled.mp4',production_status='approved' WHERE id=?").run(cancelled.id);
    assert.equal((await request(`/api/admin/agent-tasks/${cancelled.task_id}`,json('PATCH',{action:'cancel'},cookie))).status,200);
    assert.equal((await request(`/api/admin/media-projects/${cancelled.id}/publish-vitriny`,json('POST',{},cookie))).status,409);
    response=await request('/api/admin/media-factory',json('POST',{format:'image',title:'Imagem suspensa',prompt:'Imagem somente para teste'},cookie));const image=(await response.json()).project;
    db.prepare("UPDATE admin_media_projects SET output_url='https://vitrinecity.com/uploads/image.jpg',production_status='approved' WHERE id=?").run(image.id);
    db.prepare("INSERT INTO social_account_restrictions(user_id,status,reason_code,note) VALUES(?,'suspended','outro','Suspensão de teste')").run(userId);
    assert.equal((await request(`/api/admin/media-projects/${image.id}/publish-vitriny`,json('POST',{},cookie))).status,409);
    assert.equal(db.prepare('SELECT count(*) n FROM media_publication_attempts WHERE project_id IN (?,?)').get(cancelled.id,image.id).n,0);
    assert.deepEqual(JSON.parse(readFileSync(log)).map(x=>x.method),['POST','GET']);
  }finally{
    db?.close();if(child.exitCode===null&&child.signalCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited}rmSync(temp,{recursive:true,force:true});
  }
});
