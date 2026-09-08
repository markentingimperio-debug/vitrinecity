// Full server, disposable data, fake provider responses and no outbound network.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHmac} from 'node:crypto';
import Database from 'better-sqlite3';
const dataDir=mkdtempSync(path.join(tmpdir(),'vitriny-reward-integration-')),port=46000+Math.floor(Math.random()*1000),origin=`http://127.0.0.1:${port}`;
const guard=path.join(dataDir,'provider.mjs'),fixture=path.join(dataDir,'payment.json'),sent=path.join(dataDir,'preference.json');
writeFileSync(fixture,'{}');
writeFileSync(guard,`import {readFileSync,writeFileSync} from 'node:fs';
globalThis.fetch=async(input,options={})=>{const url=new URL(String(input));
if(url.origin!=='https://api.mercadopago.com')throw Error('Outbound request disabled in integration test');
if(url.pathname==='/checkout/preferences'&&options.method==='POST'){writeFileSync(${JSON.stringify(sent)},options.body);return Response.json({id:'isolated-preference',init_point:'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=isolated-preference'});}
if(url.pathname==='/v1/payments/9001')return Response.json(JSON.parse(readFileSync(${JSON.stringify(fixture)},'utf8')));
if(url.pathname==='/v1/payments/search')return Response.json({results:[JSON.parse(readFileSync(${JSON.stringify(fixture)},'utf8'))],paging:{total:1}});
throw Error('Unexpected isolated provider request');};`);
const env=Object.fromEntries(['PATH','SystemRoot','WINDIR','TEMP','TMP'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
Object.assign(env,{DATA_DIR:dataDir,PORT:String(port),SITE_URL:origin,MERCADOPAGO_ACCESS_TOKEN:'TEST-isolated-no-network',MERCADOPAGO_WEBHOOK_SECRET:'isolated-reward-secret'});
const child=spawn(process.execPath,['--import',pathToFileURL(guard).href,'server.js'],{cwd:new URL('..',import.meta.url),env,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);
const request=(url,options={})=>fetch(origin+url,{...options,redirect:'manual',headers:{origin,'Content-Type':'application/json',...options.headers}});
let db;
try{
  let ready=false;for(let i=0;i<100;i++){try{if((await request('/api/health')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)break;await new Promise(r=>setTimeout(r,100));}assert.ok(ready,output.slice(-2500));
  assert.equal((await request('/api/rewards/me')).status,401);
  const registration=await request('/api/auth/register',{method:'POST',body:JSON.stringify({name:'Visitante de teste',email:'rewards@example.test',password:'isolated-reward-2026',adultConfirmed:true,termsAccepted:true,accountContext:'city'})});assert.equal(registration.status,201);const headers={cookie:registration.headers.get('set-cookie').split(';')[0]};
  const action=body=>request('/api/games/farm/action',{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal((await action({type:'plant',crop:'carrot',plot:0})).status,200);
  assert.equal((await action({type:'harvest',plot:0,now:Date.now()+999999999,rewardPoints:9999})).status,409,'Client clocks and rewards cannot speed up a harvest');
  db=new Database(path.join(dataDir,'vitrinecity.db'));const userId=db.prepare('SELECT id FROM users WHERE email=?').get('rewards@example.test').id;
  const farm=JSON.parse(db.prepare('SELECT state_json FROM city_farm_progress WHERE user_id=?').get(userId).state_json);farm.plots[0].plantedAt=Date.now()-60000;farm.plots[0].readyAt=Date.now()-30000;db.prepare('UPDATE city_farm_progress SET state_json=? WHERE user_id=?').run(JSON.stringify(farm),userId);
  const harvests=await Promise.all([action({type:'harvest',plot:0}),action({type:'harvest',plot:0})]);assert.deepEqual(harvests.map(r=>r.status).sort(),[200,409]);
  assert.equal((await (await request('/api/rewards/me',{headers})).json()).balance.points,4,'Exactly one net reward is granted for the harvested plot');
  db.prepare('INSERT INTO city_reward_batches(user_id,source_key,points,remaining,created_ms,expires_ms) VALUES(?,?,?,?,?,?)').run(userId,'isolated-earned-fixture',296,296,Date.now(),Date.now()+60*86400000);
  const q=await (await request('/api/rewards/quote?kind=avatar&usePoints=true',{headers})).json();assert.equal(q.payCents,700);
  const body={kind:'avatar',key:'integration-avatar-order',termsAccepted:true,termsVersion:q.termsVersion,usePoints:true,payCents:q.payCents,points:q.points};
  assert.equal((await request('/api/rewards/checkout',{method:'POST',headers:{...headers,origin:'https://evil.test'},body:JSON.stringify(body)})).status,403);
  const checkout=await request('/api/rewards/checkout',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(checkout.status,201,await checkout.clone().text());const reference=(await checkout.json()).reference;
  const preference=JSON.parse(readFileSync(sent,'utf8'));assert.equal(preference.external_reference,reference);assert.equal(preference.items[0].unit_price,7);assert.equal(preference.items[0].currency_id,'BRL');assert.equal(preference.expires,true);
  let payment={id:9001,external_reference:reference,currency_id:'BRL',transaction_amount:7,status:'approved'};writeFileSync(fixture,JSON.stringify(payment));
  const webhook='/api/payments/mercadopago/webhook?data.id=9001&type=payment';assert.equal((await request(webhook,{method:'POST',body:'{}'})).status,401);
  const ts=String(Date.now()),requestId='reward-integration',signature=createHmac('sha256',env.MERCADOPAGO_WEBHOOK_SECRET).update(`id:9001;request-id:${requestId};ts:${ts};`).digest('hex');
  const notify=()=>request(webhook,{method:'POST',headers:{'x-request-id':requestId,'x-signature':`ts=${ts},v1=${signature}`},body:'{}'});
  writeFileSync(fixture,JSON.stringify({...payment,transaction_amount:.01}));assert.ok((await notify()).status>=400);assert.equal((await (await request('/api/rewards/me',{headers})).json()).avatar.active,false);
  writeFileSync(fixture,JSON.stringify(payment));assert.equal((await notify()).status,200);const first=await (await request('/api/rewards/me',{headers})).json();assert.equal(first.avatar.active,true);assert.equal(first.balance.points,0);
  assert.equal((await notify()).status,200);assert.equal((await (await request('/api/rewards/me',{headers})).json()).avatar.expiresAt,first.avatar.expiresAt);
  assert.equal((await request('/api/rewards/checkout',{method:'POST',headers,body:JSON.stringify(body)})).status,409);
  assert.equal((await request('/api/rewards/orders/'+reference+'/refresh',{method:'POST',headers,body:'{}'})).status,200);
  writeFileSync(fixture,JSON.stringify({...payment,status:'refunded'}));assert.equal((await notify()).status,200);const reversed=await (await request('/api/rewards/me',{headers})).json();assert.equal(reversed.balance.points,300);assert.equal(reversed.avatar.active,false);
  console.log('city-rewards-integration: authenticated quotes, atomic harvest, forged time/reward rejection, provider preference, signed webhooks, exact amount, replay, reconciliation and reversal passed');
}finally{
  db?.close();if(child.exitCode===null&&child.signalCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}
  const resolved=path.resolve(dataDir);if(path.dirname(resolved)===path.resolve(tmpdir())&&path.basename(resolved).startsWith('vitriny-reward-integration-'))rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
