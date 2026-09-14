import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import Database from 'better-sqlite3';

const appDir=fileURLToPath(new URL('..',import.meta.url));
const dataDir=mkdtempSync(path.join(tmpdir(),'vitriny-neural-billing-smoke-'));
const probe=createServer();
await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
const port=probe.address().port;
await new Promise(resolve=>probe.close(resolve));
const origin=`http://127.0.0.1:${port}`;
const secret='billing-smoke-store-secret-fixture-only';
const adminBase='/api/admin/vitriny-neural/billing';
const adminStore=reference=>`${adminBase}/stores/${reference}`;
const storeBase=reference=>`/api/store-portal/${reference}/neural/billing`;
const digest=value=>createHash('sha256').update(value).digest('hex');
const storeToken=reference=>createHmac('sha256',secret).update(`store:${reference}`).digest('base64url');
const networkMarker='billing_smoke_external_network_attempt';
// The real server uses only a disposable database. Even a mistaken provider or
// payment call cannot leave this child, and any such attempt fails this test.
const bootstrap=`
  import net from 'node:net';
  import fs from 'node:fs';
  import path from 'node:path';
  const blocked=()=>{
    process.stderr.write('billing_smoke_external_network_attempt\\n');
    throw new Error('external_network_disabled_in_smoke');
  };
  net.Socket.prototype.connect=blocked;
  globalThis.fetch=async()=>blocked();
  const mkdir=fs.mkdirSync;
  fs.mkdirSync=(folder,options)=>{
    const target=path.resolve(String(folder)),root=process.env.DATA_DIR;
    if(target!==root&&!target.startsWith(root+path.sep))throw new Error('directory_outside_smoke_fixture');
    return mkdir(folder,options);
  };
  await import('./server.js');
`;
const child=spawn(process.execPath,['--input-type=module','--eval',bootstrap],{
  cwd:appDir,
  env:{
    PATH:process.env.PATH,NODE_ENV:'test',DATA_DIR:dataDir,PORT:String(port),SITE_URL:origin,
    LIVE_STUDIO_DIR:path.join(dataDir,'live-studio'),STORE_PORTAL_SECRET:secret,
    ADMIN_EMAILS:'',JARVIS_LOCAL_MODEL:'0',VITRINY_NEURAL_ENABLED:'0',
    VITRINY_NEURAL_TASKS_ENABLED:'0',VITRINY_NEURAL_BILLING_ENABLED:'1',
    META_SOCIAL_METRICS_AUTO_SYNC:'0'
  },stdio:['ignore','pipe','pipe']
});
let output='',spawnError=null,networkAttempted=false,db;
const capture=chunk=>{output=(output+chunk).slice(-16000);networkAttempted ||= output.includes(networkMarker);};
child.stdout.on('data',capture);child.stderr.on('data',capture);
child.on('error',error=>{spawnError=error;});
const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
async function waitForServer(){
  for(let attempt=0;attempt<100;attempt++){
    if(spawnError)throw spawnError;
    if(child.exitCode!==null)throw new Error(`Billing smoke server exited: ${output}`);
    try{const response=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(700)});if(response.ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error(`Billing smoke server failed to start: ${output}`);
}
async function request(route,{method='GET',body,headers={},cacheExpected=true}={}){
  const response=await fetch(origin+route,{
    method,headers:{origin,...(method==='GET'?{}:{'content-type':'application/json','x-neural-request':'1'}),...headers},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(4000)
  });
  const text=await response.text();
  const json=response.headers.get('content-type')?.includes('application/json')?JSON.parse(text):null;
  if(cacheExpected)assert.equal(response.headers.get('cache-control'),'no-store',`${method} ${route} cache policy`);
  assert.ok(!text.includes(secret),'store authentication secret cannot appear in a response');
  return{status:response.status,text,json};
}
function seedUser(isAdmin){
  const id=Number(db.prepare('INSERT INTO users(name,email,password_hash,is_admin) VALUES(?,?,?,?)')
    .run(isAdmin?'Billing Smoke Admin':'Billing Smoke Customer',isAdmin?'admin@billing-smoke.invalid':'customer@billing-smoke.invalid','fixture-no-password-login',isAdmin?1:0).lastInsertRowid);
  const token=randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(digest(token),id,Date.now()+60000);
  db.prepare('INSERT INTO wallets(user_id,balance_units) VALUES(?,?)').run(id,12345);
  return{id,cookie:`vc_session=${token}`};
}
function seedStore(reference,{profile=true,operation='active',status='approved'}={}){
  db.prepare('INSERT INTO lot_orders(reference,name,email,amount_cents,status,business_name) VALUES(?,?,?,?,?,?)')
    .run(reference,'Billing Smoke Merchant',`${reference}@billing-smoke.invalid`,100,status,'Billing Smoke Store');
  if(profile)db.prepare('INSERT INTO store_profiles(order_reference,business_name,review_status,operational_status) VALUES(?,?,?,?)')
    .run(reference,'Billing Smoke Store','published',operation);
}
function financialSnapshot(){
  return{
    wallets:db.prepare('SELECT * FROM wallets ORDER BY user_id').all(),
    walletLedger:db.prepare('SELECT * FROM wallet_ledger ORDER BY id').all(),
    creditOrders:db.prepare('SELECT * FROM credit_orders ORDER BY id').all(),
    lotOrders:db.prepare('SELECT * FROM lot_orders ORDER BY id').all()
  };
}

try{
  await waitForServer();
  db=new Database(path.join(dataDir,'vitrinecity.db'));
  const admin=seedUser(true),customer=seedUser(false),adminHeaders={cookie:admin.cookie};
  seedStore('billing-store-a');seedStore('billing-store-b');
  seedStore('billing-store-no-profile',{profile:false});
  seedStore('billing-store-inactive',{operation:'restricted'});
  seedStore('billing-store-unpaid',{status:'pending'});
  seedStore('billing-store-mfa');
  db.prepare(`INSERT INTO marketplace_seller_profiles(store_reference,seller_type,legal_name,tax_id_hash,tax_id_last4,declarations_version,totp_enabled)
    VALUES(?,'cpf','Billing Smoke MFA Merchant','fixture-hash','1234','smoke-test',1)`).run('billing-store-mfa');
  const financialBefore=financialSnapshot();
  let result=await request(adminBase+'/plans');assert.equal(result.status,401);
  result=await request(adminBase+'/plans',{headers:{cookie:customer.cookie}});assert.equal(result.status,403);
  result=await request(adminBase+'/plans',{headers:adminHeaders});assert.equal(result.status,200);assert.deepEqual(result.json.items,[]);
  const plan={code:'billing-fixture',name:'Plano de teste sem preço',monthlyCredits:100,taskReserveCredits:20,inputCreditsPer1000:1,outputCreditsPer1000:2};
  result=await request(adminBase+'/plans',{method:'POST',body:plan,headers:adminHeaders});
  assert.equal(result.status,201);assert.equal(result.json.item.code,plan.code);
  assert.equal(db.prepare('SELECT actor_id FROM neural_billing_plans WHERE code=?').get(plan.code).actor_id,String(admin.id));
  result=await request(adminBase+'/plans',{method:'POST',body:plan,headers:adminHeaders});assert.equal(result.status,200);assert.equal(result.json.item.duplicate,true);
  result=await request(adminBase+'/plans',{method:'POST',body:{...plan,monthlyCredits:200},headers:adminHeaders});assert.equal(result.status,409);assert.equal(result.json.code,'billing_plan_conflict');
  for(const extra of [{scope:'admin'},{priceCents:100},{currency:'BRL'},{monthlyPrice:1}]){
    result=await request(adminBase+'/plans',{method:'POST',body:{...plan,...extra},headers:adminHeaders});assert.equal(result.status,400);
  }
  result=await request(adminBase+'/plans',{method:'POST',body:{...plan,code:'csrf-fixture'},headers:{...adminHeaders,'x-neural-request':''}});assert.equal(result.status,403);
  result=await request(adminBase+'/plans',{method:'POST',body:{...plan,code:'csrf-fixture'},headers:{...adminHeaders,origin:'https://evil.invalid'}});assert.equal(result.status,403);

  const timestamp=Date.now();
  const period={planCode:plan.code,periodStart:timestamp-1000,periodEnd:timestamp+30*24*60*60*1000,idempotencyKey:'billing_period_fixture_1'};
  for(const reference of ['billing-store-missing','billing-store-no-profile']){
    result=await request(adminStore(reference)+'/periods',{method:'POST',body:period,headers:adminHeaders});assert.equal(result.status,404,reference);
  }
  result=await request(adminStore('billing-store-a')+'/periods',{method:'POST',body:{...period,scope:'store:billing-store-b'},headers:adminHeaders});assert.equal(result.status,400);
  result=await request(adminStore('billing-store-a')+'/periods?scope=admin',{method:'POST',body:period,headers:adminHeaders});
  assert.equal(result.status,201);const periodA=result.json.item;
  assert.equal(periodA.scope,'store:billing-store-a');assert.equal(periodA.availableCredits,100);assert.equal(periodA.active,true);
  result=await request(adminStore('billing-store-a')+'/periods',{method:'POST',body:period,headers:adminHeaders});assert.equal(result.status,200);assert.equal(result.json.item.id,periodA.id);
  result=await request(adminStore('billing-store-a')+'/periods',{method:'POST',body:{...period,periodEnd:period.periodEnd+1},headers:adminHeaders});assert.equal(result.status,409);assert.equal(result.json.code,'billing_conflict');
  result=await request(adminStore('billing-store-a')+'/periods',{method:'POST',body:{...period,idempotencyKey:'billing_overlap_fixture'},headers:adminHeaders});assert.equal(result.status,409);assert.equal(result.json.code,'billing_period_overlap');
  result=await request(adminStore('billing-store-b')+'/periods',{method:'POST',body:period,headers:adminHeaders});assert.equal(result.status,201);const periodB=result.json.item;

  const merchantHeaders={'x-store-token':storeToken('billing-store-a')};
  for(const suffix of ['/status','/ledger']){
    result=await request(storeBase('billing-store-a')+suffix);assert.equal(result.status,403);
    result=await request(storeBase('billing-store-b')+suffix,{headers:merchantHeaders});assert.equal(result.status,403,'a store A credential cannot read store B');
  }
  result=await request(storeBase('billing-store-a')+'/status?scope=store:billing-store-b',{headers:merchantHeaders});
  assert.equal(result.status,200);assert.equal(result.json.enabled,true);assert.equal(result.json.currency,'ai_credits');assert.equal(result.json.scope,'store:billing-store-a');
  assert.equal(result.json.availableCredits,100);assert.equal(result.json.reservedCredits,0);assert.equal(result.json.usedCredits,0);
  result=await request(storeBase('billing-store-a')+'/ledger?scope=admin',{headers:merchantHeaders});
  assert.equal(result.status,200);assert.equal(result.json.items.length,1);assert.equal(result.json.items[0].type,'grant');
  assert.ok(!result.text.includes(periodB.id),'another store period is not exposed');
  for(const [reference,status]of [['billing-store-no-profile',404],['billing-store-unpaid',409],['billing-store-inactive',403]]){
    result=await request(storeBase(reference)+'/status',{headers:{'x-store-token':storeToken(reference)}});assert.equal(result.status,status);
  }
  const mfaHeaders={'x-store-token':storeToken('billing-store-mfa')};
  result=await request(storeBase('billing-store-mfa')+'/status',{headers:mfaHeaders});assert.equal(result.status,428);assert.equal(result.json.mfaRequired,true);
  result=await request(storeBase('billing-store-mfa')+'/ledger',{headers:mfaHeaders});assert.equal(result.status,428);
  const mfaToken=randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO seller_mfa_sessions(session_hash,store_reference,expires_at) VALUES(?,?,?)')
    .run(digest(mfaToken),'billing-store-mfa',Date.now()+60000);
  mfaHeaders.cookie=`vc_store_mfa_${digest('billing-store-mfa').slice(0,12)}=${mfaToken}`;
  result=await request(storeBase('billing-store-mfa')+'/status',{headers:mfaHeaders});assert.equal(result.status,200);assert.equal(result.json.active,false);
  for(const suffix of ['/plans','/periods',`/periods/${periodA.id}/revoke`,'/tasks/unknown/resolve']){
    result=await request(storeBase('billing-store-a')+suffix,{method:'POST',body:period,headers:merchantHeaders,cacheExpected:false});assert.equal(result.status,404,'merchant credit writes must not exist');
  }
  result=await request(adminStore('billing-store-a')+'/periods',{method:'POST',body:period,headers:merchantHeaders});assert.equal(result.status,401);
  result=await request(adminStore('billing-store-a')+'/tasks/unknown/resolve',{method:'POST',body:{chargeCredits:0,reason:'Teste de tarefa inexistente.',idempotencyKey:'billing_resolution_fixture'},headers:adminHeaders});
  assert.equal(result.status,409);assert.equal(result.json.code,'billing_task_unsettled');
  result=await request(adminStore('billing-store-a')+`/periods/${periodB.id}/revoke`,{method:'POST',body:{},headers:adminHeaders});assert.equal(result.status,404);
  result=await request(adminStore('billing-store-a')+`/periods/${periodA.id}/revoke`,{method:'POST',body:{},headers:adminHeaders});assert.equal(result.status,200);assert.equal(result.json.item.active,false);
  result=await request(storeBase('billing-store-a')+'/status',{headers:merchantHeaders});assert.equal(result.json.active,false);assert.equal(result.json.spendableCredits,0);
  const revoked=db.prepare('SELECT revoked_by FROM neural_billing_periods WHERE id=?').get(periodA.id);assert.equal(revoked.revoked_by,String(admin.id));
  const audit=db.prepare('SELECT type,actor_id FROM neural_billing_ledger WHERE period_id=? ORDER BY rowid').all(periodA.id);
  assert.deepEqual(audit,[{type:'grant',actor_id:String(admin.id)},{type:'revoke',actor_id:String(admin.id)}]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM neural_billing_plans').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM neural_billing_periods').get().n,2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM neural_tasks').get().n,0,'billing calls do not create inference jobs');
  assert.deepEqual(financialSnapshot(),financialBefore,'AI credits must not mutate Ads wallets, orders, or payments');
  assert.equal(networkAttempted,false,'no outgoing model or payment request is attempted');
  console.log(JSON.stringify({ok:true,suite:'vitriny-neural-billing-server',server:'real app/server.js',billing:'enabled',inference:'disabled',database:'temporary',externalNetwork:'blocked in child',checks:['real admin and portal auth with MFA','immutable plans and idempotency','dated period grants to existing stores','canonical store isolation','strict bodies and CSRF','read-only merchant billing','scoped revocation and audit actor','unknown task reconciliation denied','Ads wallets and payment tables unchanged','no outbound payment or model attempt']}));
}finally{
  db?.close();
  if(child.exitCode===null&&!spawnError)child.kill('SIGTERM');
  if(!spawnError)await exited;
  rmSync(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
