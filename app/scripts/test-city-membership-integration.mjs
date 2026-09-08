// Runs the complete server with a new database, no credentials and outbound fetch disabled.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import Database from 'better-sqlite3';
const dataDir=mkdtempSync(path.join(tmpdir(),'vitriny-city-member-')),port=41000+Math.floor(Math.random()*1000),origin=`http://127.0.0.1:${port}`;
const guard=path.join(dataDir,'outbound-guard.mjs');
writeFileSync(guard,`globalThis.fetch=async()=>{throw Error('External fetch disabled in isolated membership test')};`);
const env=Object.fromEntries(['PATH','SystemRoot','WINDIR','TEMP','TMP'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
Object.assign(env,{DATA_DIR:dataDir,PORT:String(port),SITE_URL:origin,MERCADOPAGO_WEBHOOK_SECRET:'isolated-membership-test'});
const child=spawn(process.execPath,['--import',pathToFileURL(guard).href,'server.js'],{cwd:new URL('..',import.meta.url),env,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);
const request=(url,options={})=>fetch(origin+url,{...options,redirect:'manual',headers:{origin,'Content-Type':'application/json',...options.headers}});
let db;
try{
  let ready=false;for(let i=0;i<100;i++){try{if((await request('/api/health')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)break;await new Promise(r=>setTimeout(r,100));}assert.ok(ready,output.slice(-2500));
  for(const page of ['/vitriny-multiverse-explore.html?city=silvania','/vitriny-games.html','/vitriny-mini-fazenda.html','//vitriny-games.html','/%76itriny-mini-fazenda.html']){const response=await request(page);assert.equal(response.status,302,page);assert.match(response.headers.get('location'),/^\/entrar-cidade\.html\?returnTo=/);assert.match(response.headers.get('cache-control'),/no-store/);}
  for(const page of ['/loja','/entrar-cidade.html','/vitriny-multiverse-worlds.html'])assert.equal((await request(page)).status,200,page);
  assert.equal((await request('/api/games/farm')).status,401);
  const account={name:'Pessoa de teste',email:'city-member@example.test',password:'isolated-password-2026',adultConfirmed:true,termsAccepted:true,accountContext:'city',whatsapp:'5562999990000',communications:{email:true,whatsapp:false}};
  let response=await request('/api/auth/register',{method:'POST',body:JSON.stringify(account)});assert.equal(response.status,201,await response.clone().text());const cookie=response.headers.get('set-cookie').split(';')[0],headers={cookie};
  response=await request('/api/privacy/communications',{headers});assert.deepEqual((await response.json()).preferences,{email:true,whatsapp:false});
  assert.equal((await request('/vitriny-mini-fazenda.html',{headers})).status,200);
  response=await request('/api/games/farm/action',{method:'POST',headers,body:JSON.stringify({type:'plant',plot:0,crop:'carrot'})});assert.equal(response.status,200);assert.equal((await response.json()).state.coins,58);
  response=await request('/api/games/farm',{headers});assert.equal((await response.json()).state.plots[0].crop,'carrot','Progress is stored in the account');
  response=await request('/api/privacy/communications',{method:'PUT',headers,body:'{"email":false,"whatsapp":false}'});assert.equal(response.status,200);assert.deepEqual((await response.json()).preferences,{email:false,whatsapp:false});
  assert.equal((await request('/api/privacy/communications',{method:'PUT',headers:{...headers,origin:'https://example.invalid'},body:'{"email":true,"whatsapp":true}'})).status,403);
  response=await request('/api/privacy/export',{headers});assert.equal(response.status,200);const exported=await response.json();assert.ok(exported.farmProgress);
  db=new Database(path.join(dataDir,'vitrinecity.db'));assert.equal(db.prepare("SELECT document_version FROM consent_records WHERE purpose='account_terms' ORDER BY id DESC LIMIT 1").get().document_version,'city-account-2026-09-08');
  const userId=db.prepare('SELECT id FROM users WHERE email=?').get(account.email).id;db.prepare("UPDATE users SET account_status='suspended' WHERE id=?").run(userId);assert.equal((await request('/vitriny-games.html',{headers})).status,403);assert.equal((await request('/api/games/farm',{headers})).status,403);
  console.log('city-membership-integration: registration, session, consent, public commerce, gated city, persistent farm and privacy export passed');
}finally{
  db?.close();if(child.exitCode===null&&child.signalCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}
  const resolved=path.resolve(dataDir);if(path.dirname(resolved)===path.resolve(tmpdir())&&path.basename(resolved).startsWith('vitriny-city-member-'))rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
