// Complete server, fresh isolated database, and no external network requests.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac} from 'node:crypto';
import Database from 'better-sqlite3';
import {assertCoinStatus,VITRINE_COINS_POLICY} from '../public/vitrine-coins-contract.js';

const dataDir=mkdtempSync(path.join(tmpdir(),'vitrine-coins-http-'));
const port=47000+Math.floor(Math.random()*1000),origin=`http://127.0.0.1:${port}`,secret='isolated-coins-webhook';
const guard=`let preference;globalThis.fetch=async(input,options={})=>{
  const url=String(input);
  if(url==='https://api.mercadopago.com/checkout/preferences'&&options.method==='POST'){
    preference=JSON.parse(options.body);
    return Response.json({id:'isolated-preference',init_point:'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=isolated'});
  }
  if(url==='https://api.mercadopago.com/v1/payments/123456'&&preference){
    return Response.json({id:123456,external_reference:preference.external_reference,collector_id:2293261177,live_mode:true,currency_id:'BRL',transaction_amount:preference.items[0].unit_price,status:'approved',date_approved:new Date().toISOString()});
  }
  throw Error('External request disabled by isolated Coins test');
};`;
const env=Object.fromEntries(['PATH','SystemRoot','WINDIR','TEMP','TMP'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
Object.assign(env,{DATA_DIR:dataDir,PORT:String(port),SITE_URL:origin,VITRINE_COINS_ENABLED:'true',MERCADOPAGO_ACCESS_TOKEN:'isolated-fixture',MERCADOPAGO_WEBHOOK_SECRET:secret,VITRINY_NEURAL_AI_MP_COLLECTOR_ID:'2293261177'});
const child=spawn(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(guard),'server.js'],{cwd:new URL('..',import.meta.url),env,stdio:['ignore','pipe','pipe']});
let output='',db;child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
async function request(url,{method='GET',body,headers={},...rest}={}){return fetch(origin+url,{method,redirect:'manual',...rest,headers:{origin,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});}
try{
  let ready=false;for(let i=0;i<150;i++){try{if((await request('/api/health')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)break;await new Promise(resolve=>setTimeout(resolve,100));}
  assert.ok(ready,output.slice(-4000));
  assert.equal((await request('/api/coins/status')).status,401);
  const registration=await request('/api/auth/register',{method:'POST',body:{name:'Coin Fixture',email:'coin-fixture@example.test',password:'isolated-password-2026',adultConfirmed:true,termsAccepted:true}});
  assert.equal(registration.status,201,await registration.clone().text());const cookie=registration.headers.get('set-cookie').split(';')[0],headers={cookie};
  let status=await (await request('/api/coins/status',{headers})).json();assertCoinStatus(status);assert.equal(status.availableAtoms,'0');
  const quoteResponse=await request('/api/credits/quote',{method:'POST',headers,body:{dailyCredits:48,durationDays:1}});assert.equal(quoteResponse.status,200);
  const {quote}=await quoteResponse.json();assert.equal(quote.termsVersion,VITRINE_COINS_POLICY.version);assert.equal(quote.netAtoms,'2448000000');assert.equal(quote.grossAtoms,'2880000000');assert.equal(quote.feeAtoms,'432000000');
  assert.equal((await request('/api/credits/checkout',{method:'POST',headers,body:{termsVersion:'2026-09-08-ads-60'}})).status,409,'Old terms must not silently authorize a new unified purchase');
  const checkout=await request('/api/credits/checkout',{method:'POST',headers,body:{termsVersion:quote.termsVersion,termsAccepted:true,amountCents:quote.amountCents,dailyCredits:48,dailyBudgetCents:quote.dailyBudgetCents,durationDays:1,
    campaignChannel:'internal',placement:'search',objective:'visits',destinationType:'site',destinationUrl:'https://example.test/product',creativeTitle:'Produto de teste',creativeText:'Conheça este produto especial de teste.',keywords:'produto',targetAudience:'Pessoas interessadas em produtos',reachKm:10,startsOn:new Date().toISOString().slice(0,10)}});
  assert.equal(checkout.status,201,await checkout.clone().text());const order=await checkout.json();assert.match(order.reference,/^ads_/);
  db=new Database(path.join(dataDir,'vitrinecity.db'));
  assert.equal(db.prepare('SELECT terms_version FROM credit_orders WHERE reference=?').get(order.reference).terms_version,VITRINE_COINS_POLICY.version);
  assert.equal((await (await request('/api/coins/status',{headers})).json()).availableAtoms,'0','Opening checkout never grants Coins');
  const requestId='coins-fixture',ts='123456',signature=createHmac('sha256',secret).update(`id:123456;request-id:${requestId};ts:${ts};`).digest('hex');
  const webhookHeaders={'x-request-id':requestId,'x-signature':`ts=${ts},v1=${signature}`};
  assert.equal((await request('/api/payments/mercadopago/webhook?data.id=123456&type=payment',{method:'POST',body:{type:'payment',data:{id:'123456'}}})).status,401);
  for(let n=0;n<2;n++)assert.equal((await request('/api/payments/mercadopago/webhook?data.id=123456&type=payment',{method:'POST',headers:webhookHeaders,body:{type:'payment',data:{id:'123456'}}})).status,200);
  status=await (await request('/api/coins/status',{headers})).json();assert.equal(status.availableAtoms,quote.netAtoms);assert.equal(status.availableCoins,'244.8');
  const userId=status.userId;assert.equal(db.prepare('SELECT balance_units FROM wallets WHERE user_id=?').get(userId).balance_units,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM credit_batches').get().n,0);
  db.prepare("UPDATE ad_campaigns SET status='active' WHERE order_reference=?").run(order.reference);
  const serve=await request('/api/ads/serve?q=produto');const ad=(await serve.json()).ads[0];assert.ok(ad?.clickUrl,'Campaign selection must use unified balance rather than zero legacy wallet');
  assert.equal((await request(ad.clickUrl)).status,302);assert.equal((await request(ad.clickUrl)).status,302);
  status=await (await request('/api/coins/status',{headers})).json();assert.equal(status.availableCoins,'240');assert.equal(status.chargedAtoms,'48000000');
  const rewardQuote=await (await request('/api/rewards/quote?kind=avatar&usePoints=true',{headers})).json();assert.equal(rewardQuote.discountCents,300);assert.equal(rewardQuote.points,300);assert.equal(rewardQuote.payCents,700);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM vitrine_coin_migrations').get().n,1);
  const rollback=spawn(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(guard),'server.js'],{cwd:new URL('..',import.meta.url),env:{...env,PORT:String(port+1001),VITRINE_COINS_ENABLED:'false'},stdio:['ignore','pipe','pipe']});
  let rollbackOutput='';rollback.stdout.on('data',chunk=>rollbackOutput+=chunk);rollback.stderr.on('data',chunk=>rollbackOutput+=chunk);
  const rollbackExit=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{rollback.kill();reject(Error('Unsafe legacy rollback did not fail closed'));},10000);rollback.once('exit',code=>{clearTimeout(timeout);resolve(code);});});
  assert.notEqual(rollbackExit,0);assert.match(rollbackOutput,/coin_cutover_requires_unified_wallet/);
  assert.equal((await (await request('/api/coins/status',{headers})).json()).availableAtoms,status.availableAtoms);
  console.log('vitrine-coins-server-http: real startup/cutover, authentication, exact top-up terms, signed provider reconciliation/replay, funded Ads selection/debit and shared discount balance passed; external network blocked');
}finally{
  db?.close();child.kill();if(child.exitCode===null)await new Promise(resolve=>child.once('exit',resolve));
  const resolved=path.resolve(dataDir),parent=path.resolve(tmpdir());if(path.dirname(resolved)!==parent||!path.basename(resolved).startsWith('vitrine-coins-http-'))throw Error('Unsafe temporary cleanup path');
  rmSync(resolved,{recursive:true,force:true});
}
