import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import Database from 'better-sqlite3';

const dataDir=mkdtempSync(path.join(tmpdir(),'vitrine-customer-')),port=41000+Math.floor(Math.random()*500),origin=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,DATA_DIR:dataDir,PORT:String(port),SITE_URL:origin,STORE_PORTAL_SECRET:'customer-test-secret-with-at-least-32-characters'},stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);
const request=(url,options={})=>fetch(origin+url,{...options,headers:{origin,'content-type':'application/json',...(options.headers||{})}});
async function wait(){for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw new Error(output)}
const registration={name:'Cliente Completo',cpf:'529.982.247-25',email:`cliente-${port}@example.com`,whatsapp:'(62) 99999-1111',password:'senha-segura-123',adultConfirmed:true,termsAccepted:true,address:{postalCode:'75180-000',street:'Rua das Flores',number:'25',complement:'Apto 2',neighborhood:'Centro',city:'Silvânia',state:'GO',latitude:-16.6589,longitude:-48.6088,locationConsent:true}};
try{
  await wait();
  let response=await request('/api/customer/register',{method:'POST',body:JSON.stringify({...registration,cpf:'111.111.111-11'})});assert.equal(response.status,400);
  response=await request('/api/customer/register',{method:'POST',body:JSON.stringify(registration)});assert.equal(response.status,201);const cookie=response.headers.get('set-cookie').split(';')[0];
  const db=new Database(path.join(dataDir,'vitrinecity.db')),user=db.prepare('SELECT * FROM users WHERE email=?').get(registration.email),address=db.prepare('SELECT * FROM customer_addresses WHERE user_id=?').get(user.id);
  assert.equal(user.cpf_last4,'4725');assert.equal(user.cpf_fingerprint.length,64);assert.equal(JSON.stringify(user).includes('52998224725'),false);
  assert.equal(address.is_default,1);assert.equal(address.recipient_name,'Cliente Completo');assert.equal(address.latitude,-16.6589);assert.equal(address.location_consent,1);db.close();
  response=await request('/api/customer/profile',{headers:{cookie}});assert.equal(response.status,200);const profile=await response.json();assert.equal(profile.customer.cpfMasked,'***.***.***-25');assert.equal(JSON.stringify(profile).includes('52998224725'),false);assert.equal(profile.addresses[0].hasLocation,true);assert.equal('latitude' in profile.addresses[0],false);
  response=await request('/api/customer/register',{method:'POST',body:JSON.stringify({...registration,email:`outro-${port}@example.com`})});assert.equal(response.status,409);
  const page=readFileSync(new URL('../public/entrar.html',import.meta.url),'utf8');for(const text of ['CPF','CEP','Bairro','Localização'])assert.match(page,new RegExp(text,'i'));
  const hub=readFileSync(new URL('../public/acessos.html',import.meta.url),'utf8');for(const target of ['/entrar.html','/comprar-lote.html','/entregador.html','/admin-login.html'])assert.ok(hub.includes(target));
  console.log('customer-registration: ok');
}finally{child.kill();await new Promise(r=>child.once('exit',r));await new Promise(r=>setTimeout(r,150));rmSync(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
