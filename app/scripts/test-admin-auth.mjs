import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import Database from 'better-sqlite3';
const dataDir=mkdtempSync(path.join(tmpdir(),'vitriny-admin-auth-')),port=38000+Math.floor(Math.random()*1000),origin=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,DATA_DIR:dataDir,PORT:String(port),SITE_URL:origin,MERCADOPAGO_WEBHOOK_SECRET:'admin-auth-test'},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);
const request=(url,options={})=>fetch(origin+url,{...options,redirect:options.redirect||'manual',headers:{origin,'Content-Type':'application/json',...(options.headers||{})}});
async function wait(){for(let i=0;i<80;i++){try{if((await fetch(origin+'/api/health')).ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw new Error(output)}
try{
  await wait();const email=`admin-${port}@example.com`,password='senha-administrativa-123';
  let response=await request('/admin');assert.equal(response.status,302);assert.equal(response.headers.get('location'),'/admin-login.html');
  response=await request('/api/auth/register',{method:'POST',body:JSON.stringify({name:'Gestor Teste',email,password,adultConfirmed:true,termsAccepted:true})});assert.equal(response.status,201);const regularCookie=response.headers.get('set-cookie').split(';')[0];
  response=await request('/api/admin/auth/login',{method:'POST',headers:{cookie:regularCookie},body:JSON.stringify({email,password})});assert.equal(response.status,401);assert.equal((await response.json()).error,'Credenciais administrativas inválidas.');
  const db=new Database(path.join(dataDir,'vitrinecity.db'));db.prepare('UPDATE users SET is_admin=1 WHERE email=?').run(email);const userId=db.prepare('SELECT id FROM users WHERE email=?').get(email).id;
  db.prepare("INSERT INTO social_profiles(user_id,handle,city) VALUES (?,'gestor-teste','Anápolis')").run(userId);
  db.prepare("INSERT INTO social_posts(id,user_id,video_uid,caption,category,city,status) VALUES ('intelligence-post',?,'video-intelligence','Conteúdo repetido para promoção','negocios','Anápolis','ready')").run(userId);
  db.prepare("INSERT INTO social_posts(id,user_id,video_uid,caption,category,city,status) VALUES ('spam-2',?,'video-spam-2','Conteúdo repetido para promoção','negocios','Anápolis','ready')").run(userId);
  db.prepare("INSERT INTO social_posts(id,user_id,video_uid,caption,category,city,status) VALUES ('spam-3',?,'video-spam-3','Conteúdo repetido para promoção','negocios','Anápolis','ready')").run(userId);
  db.prepare("INSERT INTO social_posts(id,user_id,video_uid,caption,category,city,status) VALUES ('artificial-post',?,'video-artificial','Conteúdo com crescimento atípico','negocios','Goiânia','ready')").run(userId);
  db.prepare("INSERT INTO social_engagement_events(post_id,actor_key,event_day,impressions,watch_ms,completions,skips,replays,profile_clicks,cta_clicks) VALUES ('intelligence-post','visitor',date('now'),10,120000,6,2,1,3,2)").run();
  db.prepare("INSERT INTO social_engagement_events(post_id,actor_key,event_day,impressions,watch_ms,completions,skips,replays,profile_clicks,cta_clicks) VALUES ('artificial-post','visitor-risk',date('now'),40,1000,0,0,130,0,0)").run();
  db.prepare("INSERT INTO social_external_insights(provider,content_key,views,clicks,conversions) VALUES ('meta','external-test',100,7,2)").run();db.close();
  response=await request('/api/admin/auth/login',{method:'POST',headers:{cookie:regularCookie},body:JSON.stringify({email,password})});assert.equal(response.status,200);const setCookie=response.headers.get('set-cookie')||'';assert.match(setCookie,/Max-Age=28800/);const adminCookie=setCookie.split(';')[0];
  response=await request('/api/admin/auth/status',{headers:{cookie:adminCookie}});assert.deepEqual(await response.json(),{authenticated:true,administrator:true});
  response=await request('/admin',{headers:{cookie:adminCookie}});assert.equal(response.status,200);assert.match(await response.text(),/Painel de crescimento/i);
  response=await request('/api/admin/social/intelligence/status',{headers:{cookie:adminCookie}});assert.equal(response.status,200);const intelligence=await response.json();assert.equal(intelligence.overview.clicks,12);assert.equal(intelligence.overview.conversions,2);assert.equal(intelligence.newCreators[0].handle,'gestor-teste');assert.ok(intelligence.cities.some(city=>city.city==='Anápolis'&&city.completionRate===.6));assert.ok(intelligence.alerts.some(a=>a.alertType==='duplicate_spam'));assert.ok(intelligence.alerts.some(a=>a.alertType==='artificial_growth'));assert.ok(intelligence.alerts.some(a=>a.alertType==='suspicious_engagement'));
  const alertId=intelligence.alerts.find(a=>a.status==='open').id;response=await request(`/api/admin/social/intelligence/alerts/${alertId}`,{method:'PATCH',headers:{cookie:adminCookie},body:JSON.stringify({status:'acknowledged',note:'Em revisão'})});assert.equal(response.status,200);
  const auditDb=new Database(path.join(dataDir,'vitrinecity.db'));const audits=auditDb.prepare('SELECT * FROM admin_login_audit ORDER BY id').all();auditDb.close();assert.equal(audits.length,2);assert.deepEqual(audits.map(a=>a.success),[0,1]);assert.ok(audits.every(a=>!a.email_hash.includes(email)));
  const page=readFileSync(new URL('../public/admin-login.html',import.meta.url),'utf8');assert.match(page,/Acesso administrativo/);assert.match(page,/noindex,nofollow/);assert.doesNotMatch(page,/Criar conta/);
  console.log('admin-auth: ok');
}finally{child.kill();await new Promise(r=>child.once('exit',r));await new Promise(r=>setTimeout(r,200));try{rmSync(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:100})}catch(error){if(error.code!=='EPERM')throw error}}
