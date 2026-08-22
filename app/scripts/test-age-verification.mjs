import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';

const dataDir=mkdtempSync(path.join(tmpdir(),'vitriny-age-')),port=39500+Math.floor(Math.random()*400),origin=`http://127.0.0.1:${port}`,secret='age-verification-test-secret';
const child=spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,DATA_DIR:dataDir,PORT:String(port),SITE_URL:origin,AGE_VERIFICATION_PROVIDER:'test-identity',AGE_VERIFICATION_START_URL:'https://identity.example/verify/{reference}',AGE_VERIFICATION_WEBHOOK_SECRET:secret},stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
const request=(url,options={})=>fetch(origin+url,{...options,redirect:'manual',headers:{origin,'Content-Type':'application/json',...(options.headers||{})}});
async function wait(){for(let i=0;i<80;i++){try{if((await fetch(origin+'/api/health')).ok)return}catch{}await new Promise(resolve=>setTimeout(resolve,100))}throw new Error(output)}
function signed(body,timestamp=Math.floor(Date.now()/1000)){const raw=JSON.stringify(body),signature=createHmac('sha256',secret).update(`${timestamp}.`).update(raw).digest('hex');return{raw,headers:{'x-age-verification-timestamp':String(timestamp),'x-age-verification-signature':`sha256=${signature}`}}}
function birthDate(yearsAgo){const date=new Date();date.setUTCFullYear(date.getUTCFullYear()-yearsAgo);return date.toISOString().slice(0,10)}

try{
  await wait();const email=`age-${port}@example.com`;
  let response=await request('/api/auth/register',{method:'POST',body:JSON.stringify({name:'Pessoa Teste',email,password:'senha-segura-123',adultConfirmed:true,termsAccepted:true})});assert.equal(response.status,201);const cookie=response.headers.get('set-cookie').split(';')[0];
  response=await request('/api/identity/age-verification/start',{method:'POST',headers:{cookie},body:'{}'});assert.equal(response.status,400);
  response=await request('/api/identity/age-verification/start',{method:'POST',headers:{cookie},body:JSON.stringify({consent:true})});assert.equal(response.status,200);let started=await response.json();assert.match(started.verificationUrl,/^https:\/\/identity\.example\/verify\//);const reference=started.verificationUrl.split('/').pop();
  response=await request('/api/affiliates/register',{method:'POST',headers:{cookie},body:JSON.stringify({termsAccepted:true})});assert.equal(response.status,403);assert.equal((await response.json()).verificationRequired,true);
  const underage={eventId:'event-underage',reference,status:'verified',documentVerified:true,livenessPassed:true,dateOfBirth:birthDate(17)};let message=signed(underage);
  response=await request('/api/identity/age-verification/webhook',{method:'POST',headers:message.headers,body:message.raw});assert.equal(response.status,200);
  response=await request('/api/identity/age-verification',{headers:{cookie}});assert.deepEqual(await response.json(),{status:'rejected',over18:false,verifiedAt:null,expiresAt:null});
  response=await request('/api/identity/age-verification/start',{method:'POST',headers:{cookie},body:JSON.stringify({consent:true})});started=await response.json();const secondReference=started.verificationUrl.split('/').pop();
  const verified={eventId:'event-verified',reference:secondReference,status:'verified',documentVerified:true,livenessPassed:true,dateOfBirth:birthDate(20)};message=signed(verified);
  response=await request('/api/identity/age-verification/webhook',{method:'POST',headers:message.headers,body:message.raw});assert.equal(response.status,200);assert.equal((await response.json()).duplicate,false);
  response=await request('/api/identity/age-verification/webhook',{method:'POST',headers:message.headers,body:message.raw});assert.equal((await response.json()).duplicate,true);
  response=await request('/api/identity/age-verification',{headers:{cookie}});const result=await response.json();assert.equal(result.status,'verified');assert.equal(result.over18,true);
  response=await request('/api/affiliates/register',{method:'POST',headers:{cookie},body:JSON.stringify({termsAccepted:true})});assert.equal(response.status,201);
  const db=new Database(path.join(dataDir,'vitrinecity.db')),stored=JSON.stringify(db.prepare('SELECT * FROM age_verifications').all());assert.equal(stored.includes(verified.dateOfBirth),false);assert.equal(db.prepare('SELECT COUNT(*) count FROM age_verification_events').get().count,2);db.close();
  const stale=signed({...verified,eventId:'event-stale'},Math.floor(Date.now()/1000)-601);response=await request('/api/identity/age-verification/webhook',{method:'POST',headers:stale.headers,body:stale.raw});assert.equal(response.status,401);
  console.log('age-verification: ok');
}finally{child.kill();await new Promise(resolve=>child.once('exit',resolve));await new Promise(resolve=>setTimeout(resolve,200));rmSync(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
