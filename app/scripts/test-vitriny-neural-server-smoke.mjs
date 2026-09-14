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
const dataDir=mkdtempSync(path.join(tmpdir(),'vitriny-neural-smoke-'));
const probe=createServer();
await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
const port=probe.address().port;
await new Promise(resolve=>probe.close(resolve));
const origin=`http://127.0.0.1:${port}`;
const secret='neural-smoke-store-secret-fixture-only';
const adminBase='/api/admin/vitriny-neural/tasks';
const storeBase=reference=>`/api/store-portal/${reference}/neural/tasks`;
const adminChat='/api/admin/vitriny-neural/chat';
const storeChat=reference=>`/api/store-portal/${reference}/neural/chat`;
const digest=value=>createHash('sha256').update(value).digest('hex');
const storeToken=reference=>createHmac('sha256',secret).update(`store:${reference}`).digest('base64url');

// Import the real server, but prohibit outgoing requests in this disposable child.
// No configured credentials are inherited and no production database is opened.
const bootstrap=`
  import net from 'node:net';
  import fs from 'node:fs';
  import path from 'node:path';
  const blocked=()=>{throw new Error('external_network_disabled_in_smoke');};
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
    LIVE_STUDIO_DIR:path.join(dataDir,'live-studio'),
    STORE_PORTAL_SECRET:secret,ADMIN_EMAILS:'',JARVIS_LOCAL_MODEL:'0',
    VITRINY_NEURAL_ENABLED:'0',VITRINY_NEURAL_TASKS_ENABLED:'0',
    VITRINY_NEURAL_TASKS_STORES:'smoke-store-a,smoke-store-mfa,smoke-store-no-profile',
    VITRINY_NEURAL_CHAT_STORES:'smoke-store-a,smoke-store-b,smoke-store-mfa,smoke-store-no-profile',
    META_SOCIAL_METRICS_AUTO_SYNC:'0'
  },stdio:['ignore','pipe','pipe']
});
let output='',spawnError=null,db;
child.stdout.on('data',chunk=>{output=(output+chunk).slice(-16000);});
child.stderr.on('data',chunk=>{output=(output+chunk).slice(-16000);});
child.on('error',error=>{spawnError=error;});
const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
async function waitForServer(){
  for(let attempt=0;attempt<100;attempt++){
    if(spawnError)throw spawnError;
    if(child.exitCode!==null)throw new Error(`Smoke server exited: ${output}`);
    try{
      const response=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(700)});
      if(response.ok)return;
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error(`Smoke server failed to start: ${output}`);
}
async function request(route,{method='GET',body,headers={}}={}){
  const response=await fetch(origin+route,{
    method,headers:{origin,...(method==='GET'?{}:{'content-type':'application/json','x-neural-request':'1'}),...headers},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(4000)
  });
  const text=await response.text();
  const json=response.headers.get('content-type')?.includes('application/json')?JSON.parse(text):null;
  if(route.startsWith('/api/'))assert.equal(response.headers.get('cache-control'),'no-store',`${method} ${route} cache policy`);
  return{response,status:response.status,text,json};
}
function seedUser(isAdmin,suffix=''){
  const id=Number(db.prepare('INSERT INTO users(name,email,password_hash,is_admin) VALUES(?,?,?,?)')
    .run(isAdmin?'Smoke Admin':'Smoke Customer',`${isAdmin?'admin':'customer'}${suffix}@smoke.invalid`,'fixture-no-password-login',isAdmin?1:0).lastInsertRowid);
  const token=randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(digest(token),id,Date.now()+60000);
  return `vc_session=${token}`;
}
function seedStore(reference,{profile=true,status='approved',operation='active'}={}){
  db.prepare('INSERT INTO lot_orders(reference,name,email,amount_cents,status,business_name) VALUES(?,?,?,?,?,?)')
    .run(reference,'Smoke Merchant',`${reference}@smoke.invalid`,100,status,'Smoke Store');
  if(profile)db.prepare('INSERT INTO store_profiles(order_reference,business_name,review_status,operational_status) VALUES(?,?,?,?)')
    .run(reference,'Smoke Store','published',operation);
}

try{
  await waitForServer();
  db=new Database(path.join(dataDir,'vitrinecity.db'));
  const adminCookie=seedUser(true),customerCookie=seedUser(false),secondAdminCookie=seedUser(true,'-second');
  seedStore('smoke-store-a');seedStore('smoke-store-b');
  seedStore('smoke-store-no-profile',{profile:false});
  seedStore('smoke-store-inactive',{operation:'restricted'});
  seedStore('smoke-store-unpaid',{status:'pending'});
  seedStore('smoke-store-mfa');

  let result=await request(adminBase+'/status');
  assert.equal(result.status,401);
  result=await request(adminBase+'/status',{headers:{cookie:customerCookie}});
  assert.equal(result.status,403);
  result=await request(adminBase+'/status',{headers:{cookie:adminCookie}});
  assert.equal(result.status,200);assert.equal(result.json.enabled,false);assert.equal(result.json.draftOnly,true);
  result=await request(adminBase,{headers:{cookie:adminCookie}});
  assert.equal(result.status,200);assert.deepEqual(result.json.items,[]);
  result=await request(adminBase,{method:'POST',headers:{cookie:adminCookie},body:{instruction:'Crie um texto da loja.',idempotencyKey:'admin_smoke_disabled_1'}});
  assert.equal(result.status,503);assert.equal(result.json.code,'task_disabled');

  // Chat routes run through the real server's session/admin middleware, not a
  // test replacement. Storing context is distinct from enabling inference.
  result=await request(adminChat+'/status');assert.equal(result.status,401);
  result=await request(adminChat+'/status',{headers:{cookie:customerCookie}});assert.equal(result.status,403);
  result=await request(adminChat+'/status',{headers:{cookie:adminCookie}});
  assert.equal(result.status,200);assert.equal(result.json.ok,true);
  assert.equal(result.json.capabilities.text,false);assert.equal(result.json.paidGenerationEnabled,false);
  const adminAttachmentBody={name:'contexto-privado.txt',mimeType:'text/plain',dataBase64:Buffer.from('Contexto privado do primeiro administrador.').toString('base64')};
  result=await request(adminChat+'/attachments',{method:'POST',headers:{cookie:customerCookie},body:adminAttachmentBody});assert.equal(result.status,403);
  result=await request(adminChat+'/attachments',{method:'POST',headers:{cookie:adminCookie,origin:'https://foreign.invalid'},body:adminAttachmentBody});assert.equal(result.status,403);
  result=await request(adminChat+'/attachments',{method:'POST',headers:{cookie:adminCookie,'x-neural-request':''},body:adminAttachmentBody});assert.equal(result.status,403);
  result=await request(adminChat+'/attachments',{method:'POST',headers:{cookie:adminCookie},body:adminAttachmentBody});
  assert.equal(result.status,201);const adminAttachment=result.json.attachment;
  assert.equal(adminAttachment.textAvailable,true);assert.equal(adminAttachment.kind,'text');assert.ok(!Object.hasOwn(adminAttachment,'data'));
  const adminMessageBody={message:'Resuma este documento.',attachmentIds:[adminAttachment.id],idempotencyKey:'smoke_admin_chat_001'};
  result=await request(adminChat+'/messages',{method:'POST',headers:{cookie:adminCookie},body:adminMessageBody});
  assert.equal(result.status,202);assert.equal(result.json.status,'unavailable');const adminRequest=result.json;
  result=await request(adminChat+'/conversations/'+adminRequest.conversationId,{headers:{cookie:adminCookie}});
  assert.equal(result.status,200);assert.equal(result.json.messages.length,2);
  assert.equal(result.json.messages[0].text,adminMessageBody.message);assert.equal(result.json.messages[0].attachments[0].id,adminAttachment.id);
  assert.equal(result.json.messages[1].status,'unavailable');assert.match(result.json.messages[1].text,/nenhuma API paga/i);
  result=await request(adminChat+'/requests/by-key/'+adminMessageBody.idempotencyKey,{headers:{cookie:adminCookie}});
  assert.equal(result.status,200);assert.equal(result.json.request.id,adminRequest.requestId);
  result=await request(adminChat+'/messages',{method:'POST',headers:{cookie:adminCookie},body:adminMessageBody});
  assert.equal(result.status,200);assert.equal(result.json.duplicate,true);assert.equal(result.json.requestId,adminRequest.requestId);
  result=await request(adminChat+'/attachments/'+adminAttachment.id,{headers:{cookie:adminCookie}});
  assert.equal(result.status,200);assert.equal(result.text,'Contexto privado do primeiro administrador.');
  assert.equal(result.response.headers.get('x-content-type-options'),'nosniff');assert.match(result.response.headers.get('content-security-policy'),/sandbox/);
  assert.match(result.response.headers.get('content-disposition'),/^attachment;/);
  result=await request(adminChat+'/conversations',{headers:{cookie:secondAdminCookie}});assert.equal(result.status,200);assert.deepEqual(result.json.items,[]);
  for(const route of ['/attachments/'+adminAttachment.id,'/conversations/'+adminRequest.conversationId,'/requests/'+adminRequest.requestId,'/requests/by-key/'+adminMessageBody.idempotencyKey]){
    result=await request(adminChat+route,{headers:{cookie:secondAdminCookie}});assert.equal(result.status,404,'one admin cannot read another admin private chat');
  }
  result=await request(adminChat+'/requests/'+adminRequest.requestId+'/cancel',{method:'POST',headers:{cookie:secondAdminCookie},body:{}});assert.equal(result.status,404);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM neural_chat_conversations').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM neural_chat_requests').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM neural_chat_messages').get().n,2);
  assert.equal(db.prepare('SELECT typeof(data) type FROM neural_chat_attachments WHERE id=?').get(adminAttachment.id).type,'blob');

  const factualRoute='/api/admin/vitriny-neural/factual-draft';
  const factualBody={facts:[{id:'f1',text:'Capa de almofada em algodão cru, com zíper.'},{id:'f2',text:'Não acompanha enchimento.'}],format:'paragraphs'};
  result=await request(factualRoute,{method:'POST',body:factualBody});assert.equal(result.status,401);
  result=await request(factualRoute,{method:'POST',headers:{cookie:customerCookie},body:factualBody});assert.equal(result.status,403);
  result=await request(factualRoute,{method:'POST',headers:{cookie:adminCookie,origin:'https://foreign.invalid'},body:factualBody});assert.equal(result.status,403);
  result=await request(factualRoute,{method:'POST',headers:{cookie:adminCookie},body:factualBody});
  assert.equal(result.status,200);assert.equal(result.json.ok,true);
  assert.equal(result.json.draft.text,factualBody.facts.map(fact=>fact.text).join('\n\n'));
  assert.equal(result.json.draft.grounding.externallyVerified,false);
  result=await request(factualRoute,{method:'POST',headers:{cookie:adminCookie},body:{facts:[]}});assert.equal(result.status,400);

  result=await request(storeBase('smoke-store-a')+'/status');assert.equal(result.status,403);
  result=await request(storeBase('smoke-store-a')+'/status',{headers:{'x-store-token':'invalid-fixture'}});assert.equal(result.status,403);
  const merchantHeaders={'x-store-token':storeToken('smoke-store-a')};
  result=await request(storeBase('smoke-store-a')+'/status',{headers:merchantHeaders});
  assert.equal(result.status,200);assert.equal(result.json.enabled,false);
  result=await request(storeBase('smoke-store-a')+`/status?token=${encodeURIComponent(storeToken('smoke-store-a'))}&reference=smoke-store-b&scope=admin`);
  assert.equal(result.status,200,'canonical route reference must survive query parsing and middleware mounting');
  result=await request(storeBase('smoke-store-b')+`/status?reference=smoke-store-a`,{headers:merchantHeaders});
  assert.equal(result.status,403,'a valid store A token must not authorize route store B');
  result=await request(storeBase('smoke-store-b')+'/status',{headers:{'x-store-token':storeToken('smoke-store-b')}});
  assert.equal(result.status,403);assert.equal(result.json.code,'task_scope_denied','valid portal auth does not override Neural store allowlist');

  result=await request(storeChat('smoke-store-a')+'/status');assert.equal(result.status,403);
  result=await request(storeChat('smoke-store-a')+'/status',{headers:merchantHeaders});
  assert.equal(result.status,200);assert.equal(result.json.capabilities.text,false);assert.equal(result.json.paidGenerationEnabled,false);
  result=await request(storeChat('smoke-store-b')+'/status',{headers:merchantHeaders});assert.equal(result.status,403,'store A credential is not valid for chat B');
  const merchantBHeaders={'x-store-token':storeToken('smoke-store-b')};
  result=await request(storeChat('smoke-store-b')+'/status',{headers:merchantBHeaders});assert.equal(result.status,200,'chat B is explicitly enrolled for isolation checks');
  result=await request(storeChat('smoke-store-a')+'/attachments',{method:'POST',headers:merchantHeaders,body:{name:'loja-a.md',mimeType:'text/markdown',dataBase64:Buffer.from('Referência privada da loja A.').toString('base64')}});
  assert.equal(result.status,201);const storeAttachment=result.json.attachment;
  result=await request(storeChat('smoke-store-a')+'/messages',{method:'POST',headers:merchantHeaders,body:{message:'Resuma este material.',attachmentIds:[storeAttachment.id],idempotencyKey:'smoke_store_chat_a_001'}});
  assert.equal(result.status,202);assert.equal(result.json.status,'unavailable');const storeRequest=result.json;
  result=await request(storeChat('smoke-store-a')+'/conversations/'+storeRequest.conversationId,{headers:merchantHeaders});
  assert.equal(result.status,200);assert.equal(result.json.messages[0].attachments[0].id,storeAttachment.id);
  result=await request(storeChat('smoke-store-a')+'/attachments/'+storeAttachment.id,{headers:merchantHeaders});
  assert.equal(result.status,200);assert.equal(result.text,'Referência privada da loja A.');
  result=await request(storeChat('smoke-store-b')+'/conversations',{headers:merchantBHeaders});assert.equal(result.status,200);assert.deepEqual(result.json.items,[]);
  for(const route of ['/attachments/'+storeAttachment.id,'/conversations/'+storeRequest.conversationId,'/requests/'+storeRequest.requestId]){
    result=await request(storeChat('smoke-store-b')+route,{headers:merchantBHeaders});assert.equal(result.status,404,'authenticated store B cannot read chat A');
    result=await request(adminChat+route,{headers:{cookie:adminCookie}});assert.equal(result.status,404,'admin private chat route does not bypass store ownership');
  }
  result=await request(storeChat('smoke-store-a')+'/attachments/'+adminAttachment.id,{headers:merchantHeaders});assert.equal(result.status,404);
  result=await request(storeChat('smoke-store-b')+'/messages',{method:'POST',headers:merchantBHeaders,body:{message:'Use esse anexo.',attachmentIds:[storeAttachment.id],idempotencyKey:'smoke_store_chat_b_001'}});
  assert.equal(result.status,404,'foreign attachment cannot be assigned to a new request');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM neural_chat_requests').get().n,2);

  for(const [reference,expected]of [['smoke-store-absent',404],['smoke-store-no-profile',404],['smoke-store-inactive',403],['smoke-store-unpaid',409]]){
    result=await request(storeBase(reference)+'/status',{headers:{'x-store-token':storeToken(reference)}});
    assert.equal(result.status,expected,reference);
  }
  result=await request(storeBase('smoke-store-a'),{method:'POST',body:{instruction:'Crie um roteiro curto.',idempotencyKey:'store_smoke_disabled_1',token:storeToken('smoke-store-a')}});
  assert.equal(result.status,503);assert.equal(result.json.code,'task_disabled');
  result=await request(storeBase('smoke-store-a'),{method:'POST',headers:merchantHeaders,body:{instruction:'Crie um roteiro curto.',idempotencyKey:'store_smoke_disabled_2',scope:'admin'}});
  assert.equal(result.status,400);assert.equal(result.json.code,'task_input_invalid');
  result=await request(storeBase('smoke-store-a'),{method:'POST',headers:{...merchantHeaders,'x-neural-request':''},body:{instruction:'Crie um roteiro curto.',idempotencyKey:'store_smoke_disabled_3'}});
  assert.equal(result.status,403);

  db.prepare(`INSERT INTO marketplace_seller_profiles(store_reference,seller_type,legal_name,tax_id_hash,tax_id_last4,declarations_version,totp_enabled)
    VALUES(?,'cpf','Smoke MFA Merchant','fixture-hash','1234','smoke-test',1)`).run('smoke-store-mfa');
  const mfaHeaders={'x-store-token':storeToken('smoke-store-mfa')};
  result=await request(storeBase('smoke-store-mfa')+'/status',{headers:mfaHeaders});
  assert.equal(result.status,428);assert.equal(result.json.mfaRequired,true);
  result=await request(storeChat('smoke-store-mfa')+'/status',{headers:mfaHeaders});assert.equal(result.status,428);assert.equal(result.json.mfaRequired,true);
  result=await request(storeChat('smoke-store-mfa')+'/attachments',{method:'POST',headers:mfaHeaders,body:adminAttachmentBody});assert.equal(result.status,428);
  const mfaToken=randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO seller_mfa_sessions(session_hash,store_reference,expires_at) VALUES(?,?,?)')
    .run(digest(mfaToken),'smoke-store-mfa',Date.now()+60000);
  mfaHeaders.cookie=`vc_store_mfa_${digest('smoke-store-mfa').slice(0,12)}=${mfaToken}`;
  result=await request(storeBase('smoke-store-mfa')+'/status',{headers:mfaHeaders});
  assert.equal(result.status,200);assert.equal(result.json.enabled,false);
  result=await request(storeChat('smoke-store-mfa')+'/status',{headers:mfaHeaders});assert.equal(result.status,200);assert.equal(result.json.capabilities.text,false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM neural_tasks').get().n,0,'disabled/invalid calls must not persist tasks');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM neural_task_attempts').get().n,0,'new chat requests do not create task inference attempts');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM neural_chat_requests WHERE status<>'unavailable'").get().n,0,'no model or paid generation was enabled by the chat');

  result=await request('/neural-workspace.html');
  assert.equal(result.status,200);assert.match(result.response.headers.get('content-type'),/text\/html/);
  assert.match(result.text,/id="command"/);assert.match(result.text,/neural-workspace\.js/);
  result=await request('/neural-workspace.js');assert.equal(result.status,200);assert.match(result.text,/x-neural-request/i);
  result=await request('/neural-workspace.css');assert.equal(result.status,200);assert.match(result.response.headers.get('content-type'),/text\/css/);
  console.log(JSON.stringify({ok:true,suite:'vitriny-neural-server-smoke',server:'real app/server.js',tasks:'disabled',database:'temporary',externalNetwork:'blocked in child',checks:['admin auth and no-store','merchant portal and canonical reference','inactive/unpaid/missing profile','store allowlist','MFA','disabled/invalid submissions','private chat admin isolation','private chat merchant isolation','private attachment blob storage','chat idempotency and durable recovery','chat MFA','no inference or paid generation','static workspace assets']}));
}finally{
  db?.close();
  if(child.exitCode===null&&!spawnError)child.kill('SIGTERM');
  if(!spawnError)await exited;
  rmSync(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
