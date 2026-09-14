import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import vm from 'node:vm';
import express from 'express';
import Database from 'better-sqlite3';
import {createCoinWallet} from '../vitrine-coins-wallet.js';
import {migrateLegacyCoins} from '../vitrine-coins-migration.js';
import {setupCityRewards,REWARD_TERMS} from '../city-rewards.js';
import {creditExpiryForOrder,ADS_TERMS_VERSION} from '../credits-policy.js';
import {assertCoinStatus,atomsFromLegacyAdsUnits,quoteCoinTopup,VITRINE_COINS_POLICY} from '../public/vitrine-coins-contract.js';

const source=readFileSync(new URL('../server.js',import.meta.url),'utf8'),DAY=86400000;
function extract(start,end){const first=source.indexOf(start),last=source.indexOf(end,first+start.length);assert.ok(first>=0&&last>first,`Server fixture missing: ${start}`);return source.slice(first,last);}
const serverFunctions=[
  extract('function walletBalanceUnits(', '\nconst ADS_MANAGEMENT_RATE'),
  extract('const expireCreditBatches =', '\napp.use(express.json'),
  extract('function grantReviewReward(', "\napp.post('/api/marketplace/orders/:reference/reviews'"),
  extract('const consumeMessageCredits =','\nasync function metaJson'),
  extract("app.post('/api/whatsapp/conversations/:contactId/send'","\napp.get('/api/webhooks/whatsapp'"),
  extract('const chargeSocialLink =','\nfunction socialVisitorKey'),
  extract('const chargeStoryLink =',"\napp.post('/api/social/media/photo'"),
  extract('const applyCreditPayment =',"\napp.post('/api/payments/mercadopago/webhook'"),
  extract('const buyCourseWithCoins =',"\napp.post('/api/services/videos/checkout'"),
  extract("app.get('/api/coins/status'",'\nconst cityExploration=')
].join('\n');

async function fixture(t,{enabled=true,legacyRewards=0}={}){
  let time=Date.parse('2026-09-14T12:00:00Z'),providerCalls=0,whatsappHook=null;
  const db=new Database(':memory:');
  db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY); CREATE TABLE affiliates(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2),(3);');
  db.exec(extract('CREATE TABLE IF NOT EXISTS wallets (','CREATE TABLE IF NOT EXISTS affiliates ('));
  db.exec(extract('CREATE TABLE IF NOT EXISTS course_orders (','CREATE TABLE IF NOT EXISTS managed_courses ('));
  db.exec(`INSERT INTO wallets(user_id) VALUES(1),(2),(3);
    CREATE TABLE ad_campaigns(order_reference TEXT UNIQUE,status TEXT,updated_at TEXT);
    CREATE TABLE social_posts(id INTEGER PRIMARY KEY,user_id INTEGER,cta_charge_units INTEGER,cta_charge_status TEXT);
    CREATE TABLE social_stories(id INTEGER PRIMARY KEY,user_id INTEGER,cta_charge_units INTEGER,cta_charge_status TEXT);
    CREATE TABLE social_credit_allocations(post_id INTEGER,batch_id INTEGER,units INTEGER);
    CREATE TABLE social_story_credit_allocations(story_id INTEGER,batch_id INTEGER,units INTEGER);
    CREATE TABLE verified_delivery_reviews(id INTEGER PRIMARY KEY,order_reference TEXT);
    CREATE TABLE review_rewards(review_id INTEGER UNIQUE,user_id INTEGER,reward_units INTEGER,idempotency_key TEXT UNIQUE);
    CREATE TABLE whatsapp_accounts(id INTEGER PRIMARY KEY,user_id INTEGER,status TEXT,usage_day TEXT,credits_used_today INTEGER,daily_credit_limit INTEGER,token_encrypted TEXT,phone_number_id TEXT,updated_at TEXT);
    CREATE TABLE whatsapp_contacts(id INTEGER PRIMARY KEY,account_id INTEGER,wa_id TEXT,last_message_at TEXT);
    CREATE TABLE whatsapp_messages(account_id INTEGER,contact_id INTEGER,meta_message_id TEXT UNIQUE,direction TEXT,body TEXT,status TEXT,credit_units INTEGER);
    CREATE TABLE vitrine_coin_legacy_payments(payment_id TEXT PRIMARY KEY,order_reference TEXT UNIQUE,user_id INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
  const wallet=createCoinWallet({db,enabled,now:()=>time}),app=express();app.use(express.json());
  const requireUser=(req,res,next)=>{const id=Number(req.get('x-user'));if(![1,2,3].includes(id))return res.sendStatus(401);req.user={id,email:`fixture${id}@example.test`};next();};
  const sameOriginOnly=(req,res,next)=>req.get('origin')==='https://vitrinecity.com'?next():res.sendStatus(403);
  const courses=new Map([['course',{slug:'course',title:'Curso próprio',priceCents:2399,status:'active'}]]);
  const rewards=setupCityRewards({app,db,coinWallet:wallet,expectedCollectorId:'2293261177',requireUser,requireAdmin:requireUser,sameOriginOnly,publicDir:'.',now:()=>time,
    getCourse:slug=>courses.get(slug),paymentReady:()=>true,searchPayments:async()=>({payments:[],complete:true}),
    createPreference:async()=>{providerCalls++;return {id:'fixture-preference',init_point:'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=fixture'};}});
  db.prepare('UPDATE city_reward_settings SET daily_limit=1000').run();
  if(legacyRewards)db.prepare('INSERT INTO city_reward_batches(user_id,source_key,points,remaining,created_ms,expires_ms) VALUES(1,?,?,?,?,?)').run('old-task',legacyRewards,legacyRewards,time,time+DAY);
  if(enabled)assert.equal(migrateLegacyCoins({db,wallet,now:()=>time,dryRun:false}).completed,true);
  class ClockDate extends Date{constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}}
  const context={app,db,Date:ClockDate,coinWallet:wallet,assertCoinStatus,atomsFromLegacyAdsUnits,quoteCoinTopup,VITRINE_COINS_POLICY,ADS_TERMS_VERSION,ADS_VALIDITY_DAYS:60,
    creditExpiryForOrder,randomUUID,createHash,SOCIAL_LINK_PRICE_UNITS:500,requireUser,sameOriginOnly,
    isAdminUser:()=>false,WHATSAPP_MESSAGE_CREDIT_UNITS:100,decryptWhatsAppToken:()=> 'fixture-only',whatsappVersion:()=> 'v1',
    metaJson:async()=>{providerCalls++;return whatsappHook?whatsappHook():{messages:[{id:'wamid.fixture'}]};},
    process:{env:{VITRINY_NEURAL_AI_MP_COLLECTOR_ID:'2293261177'}},
    activeEnrollment:(id,slug)=>db.prepare("SELECT 1 FROM course_enrollments WHERE user_id=? AND course_slug=? AND status='active'").get(id,slug),
    managedCourse:slug=>courses.get(slug),courseReady:()=>true,
    adminAnalytics:{recordPurchase:()=>{throw Error('Legacy full purchase must not record a conversion');}}
  };
  vm.runInNewContext(serverFunctions+'\nglobalThis.operations={walletBalanceUnits,publicWallet,grantReviewReward,consumeMessageCredits,chargeSocialLink,refundSocialLink,chargeStoryLink,refundStoryLink,applyCreditPayment};',context);
  const server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  async function http(path,{user=1,method='GET',body,origin='https://vitrinecity.com'}={}){
    const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{'x-user':String(user),'Content-Type':'application/json',origin},body:body===undefined?undefined:JSON.stringify(body)});
    const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:response.status,data};
  }
  const fund=(id,amountCents=1000,sourceId='fixture-purchase')=>wallet.grant(id,{sourceId,amountAtoms:quoteCoinTopup(amountCents).netAtoms,origin:'purchase',createdAt:time,expiresAt:time+60*DAY,termsVersion:VITRINE_COINS_POLICY.version});
  const approved=(reference,overrides={})=>({id:'123456789',external_reference:reference,collector_id:2293261177,live_mode:true,currency_id:'BRL',transaction_amount:10,status:'approved',date_approved:new Date(time).toISOString(),...overrides});
  const creditOrder=(reference='ads_fixture',terms=ADS_TERMS_VERSION)=>{
    db.prepare("INSERT INTO credit_orders(reference,user_id,amount_cents,fee_cents,credit_units,terms_version,status) VALUES(?,1,1000,150,8160,?,'pending')").run(reference,terms);
    db.prepare("INSERT INTO ad_campaigns VALUES(?,'awaiting_payment',NULL)").run(reference);
    return db.prepare('SELECT * FROM credit_orders WHERE reference=?').get(reference);
  };
  return {db,wallet,rewards,http,fund,approved,creditOrder,operations:context.operations,advance:ms=>{time+=ms;},time:()=>time,providerCalls:()=>providerCalls,setWhatsAppHook:hook=>{whatsappHook=hook;}};
}

test('server HTTP exposes exact unified owner status and never combines another user wallet',async t=>{
  const f=await fixture(t,{legacyRewards:301});
  const result=await f.http('/api/coins/status');assert.equal(result.status,200);assert.equal(result.data.ok,true);assertCoinStatus(result.data);
  assert.equal(result.data.availableAtoms,'288960000');assert.equal(result.data.availableCoins,'28.896');
  assert.equal((await f.http('/api/coins/status',{user:2})).data.availableAtoms,'0');assert.equal((await f.http('/api/coins/status',{user:0})).status,401);
  assert.equal(f.operations.publicWallet(1).balanceUnits,2889.6);
  assert.equal(migrateLegacyCoins({db:f.db,wallet:f.wallet,dryRun:false}).duplicate,true);
  assert.equal(f.db.prepare('SELECT remaining FROM city_reward_batches').get().remaining,301,'Migration never overwrites legacy history');
});

test('validated tasks and purchases fund the same Ads, message, video-link and Story consumers once',async t=>{
  const f=await fixture(t);assert.equal(f.rewards.grantGame(1,1000,'farm:one'),1000);assert.equal(f.rewards.grantGame(1,1000,'farm:one'),0);
  assert.equal(f.wallet.status(1).availableCoins,'96');
  f.operations.consumeMessageCredits(1,480,'Clique patrocinado','sponsored_click','click:one');
  f.operations.consumeMessageCredits(1,480,'Clique patrocinado','sponsored_click','click:one');
  f.operations.consumeMessageCredits(1,100,'Mensagem','whatsapp_message','message:one');
  f.db.exec("INSERT INTO social_posts VALUES(1,1,500,'pending'); INSERT INTO social_stories VALUES(1,1,500,'pending');");
  f.operations.chargeSocialLink(1,1);f.operations.chargeSocialLink(1,1);f.operations.chargeStoryLink(1,1);
  assert.equal(f.wallet.status(1).availableCoins,'80.2');
  assert.equal(f.db.prepare('SELECT balance_units FROM wallets WHERE user_id=1').get().balance_units,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM credit_batches').get().n,0);
  f.operations.refundSocialLink(1,'moderation');f.operations.refundSocialLink(1,'moderation');
  f.operations.refundStoryLink(1,'moderation');f.operations.refundStoryLink(1,'moderation');
  assert.equal(f.wallet.status(1).availableCoins,'90.2');
  assert.throws(()=>f.operations.chargeSocialLink(1,1));assert.throws(()=>f.operations.chargeStoryLink(1,1));
  assert.equal(f.db.prepare('SELECT cta_charge_status status FROM social_posts WHERE id=1').get().status,'refunded');
  f.fund(1);assert.equal(f.wallet.status(1).availableCoins,'171.8');
  f.operations.consumeMessageCredits(1,100,'Mensagem','whatsapp_message','message:two');
  assert.equal(f.wallet.status(1).availableCoins,'170.8');
});

test('review rewards share spendable lots and duplicate delivery reviews cannot grant again',async t=>{
  const f=await fixture(t);f.db.exec("INSERT INTO verified_delivery_reviews VALUES(1,'delivery-one'),(2,'delivery-one');");
  assert.equal(f.operations.grantReviewReward(1,1,'review-one'),true);assert.equal(f.operations.grantReviewReward(1,2,'review-two'),false);
  assert.equal(f.wallet.status(1).availableCoins,'5');f.operations.consumeMessageCredits(1,500,'Anúncio','sponsored_click','click:review');
  assert.equal(f.wallet.status(1).availableAtoms,'0');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM review_rewards').get().n,1);
});

test('real reward checkout reserves purchased Coins, caps course discount, and reconciles once',async t=>{
  const f=await fixture(t);f.fund(1);
  const quote=await f.http('/api/rewards/quote?kind=course&slug=course&usePoints=true');
  assert.equal(quote.data.discountCents,719);assert.equal(quote.data.payCents,1680);assert.equal(quote.data.points,719);
  const body={kind:'course',slug:'course',key:'course-fixture-checkout',termsAccepted:true,termsVersion:REWARD_TERMS,usePoints:true,payCents:1680,points:719};
  const checkout=await f.http('/api/rewards/checkout',{method:'POST',body});assert.equal(checkout.status,201,JSON.stringify(checkout.data));
  assert.equal(f.wallet.status(1).reservedAtoms,'690240000');assert.equal(f.wallet.status(1).availableAtoms,'125760000');
  assert.equal((await f.http('/api/rewards/checkout',{method:'POST',body})).status,200);assert.equal(f.providerCalls(),1);
  const payment=f.approved(checkout.data.reference,{transaction_amount:16.8});
  for(const changed of [{transaction_amount:1},{transaction_amount:16.8001},{collector_id:1},{live_mode:false},{id:'bad-id'},{currency_id:'USD'}])assert.throws(()=>f.rewards.settle(checkout.data.reference,{...payment,...changed}));
  assert.equal(f.wallet.status(1).reservedAtoms,'690240000');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM course_enrollments').get().n,0);
  f.rewards.settle(checkout.data.reference,payment);f.rewards.settle(checkout.data.reference,payment);
  assert.equal(f.wallet.status(1).chargedAtoms,'690240000');assert.equal(f.wallet.status(1).reservedAtoms,'0');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM course_enrollments WHERE status=\'active\'').get().n,1);
  f.rewards.settle(checkout.data.reference,{...payment,status:'refunded'});f.rewards.settle(checkout.data.reference,{...payment,status:'refunded'});f.rewards.settle(checkout.data.reference,payment);
  assert.equal(f.wallet.status(1).availableAtoms,'816000000');assert.equal(f.db.prepare('SELECT status FROM course_enrollments').get().status,'revoked');
});

test('reward rejection releases only its reservation and late payment cannot create a free discount',async t=>{
  const f=await fixture(t);f.fund(1);
  const q=(await f.http('/api/rewards/quote?kind=course&slug=course&usePoints=true')).data;
  const checkout=await f.http('/api/rewards/checkout',{method:'POST',body:{kind:'course',slug:'course',key:'course-release-checkout',termsAccepted:true,termsVersion:REWARD_TERMS,usePoints:true,payCents:q.payCents,points:q.points}});
  const payment=f.approved(checkout.data.reference,{transaction_amount:q.payCents/100});
  f.rewards.settle(checkout.data.reference,{...payment,status:'rejected'});assert.equal(f.wallet.status(1).availableAtoms,'816000000');
  f.operations.consumeMessageCredits(1,8000,'Anúncio','sponsored_click','ad:spent-before-late');
  const result=f.rewards.settle(checkout.data.reference,payment);assert.equal(result.status,'review_required');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM course_enrollments').get().n,0);
});

test('old full-course route refuses new purchase without side effects and preserves past enrollment',async t=>{
  const f=await fixture(t);f.fund(1);const before=f.wallet.status(1).availableAtoms;
  const denied=await f.http('/api/courses/course/checkout-coins',{method:'POST',body:{termsAccepted:true}});
  assert.equal(denied.status,409);assert.equal(denied.data.code,'course_coins_discount_only');assert.equal(denied.data.maxDiscountPercent,30);
  assert.equal(denied.data.nextUrl,'/central-creditos.html?curso=course');assert.equal(f.wallet.status(1).availableAtoms,before);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM course_orders').get().n,0);assert.equal(f.providerCalls(),0);
  f.db.exec("INSERT INTO course_orders(reference,user_id,course_slug,course_title,amount_cents,status) VALUES('course_coin_historical',1,'course','Curso',2399,'approved'); INSERT INTO course_enrollments(user_id,course_slug,order_reference,status) VALUES(1,'course','course_coin_historical','active');");
  assert.equal((await f.http('/api/courses/course/checkout-coins',{method:'POST',body:{termsAccepted:true}})).data.alreadyEnrolled,true);
  assert.equal(f.db.prepare('SELECT status FROM course_orders').get().status,'approved');
});

test('legacy approved topup credits once, uses exact recipient/amount, and freezes reordered reversal',async t=>{
  const f=await fixture(t),order=f.creditOrder(),payment=f.approved(order.reference);
  for(const changed of [{collector_id:1},{live_mode:false},{currency_id:'USD'},{transaction_amount:10.001},{external_reference:'ads_other'}])assert.throws(()=>f.operations.applyCreditPayment(order,{...payment,...changed}));
  assert.equal(f.wallet.status(1).availableAtoms,'0');
  f.operations.applyCreditPayment(order,payment);f.operations.applyCreditPayment(order,payment);
  assert.equal(f.wallet.status(1).availableAtoms,'816000000');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM credit_batches').get().n,0);
  f.operations.consumeMessageCredits(1,100,'Clique','sponsored_click','legacy:spend');
  assert.throws(()=>f.operations.applyCreditPayment(order,{...payment,id:'999'}));
  f.operations.applyCreditPayment(order,{...payment,status:'refunded'});f.operations.applyCreditPayment(order,{...payment,status:'refunded'});f.operations.applyCreditPayment(order,payment);
  const held=f.wallet.status(1);assert.equal(held.frozen,true);assert.equal(held.availableAtoms,'0');assert.equal(held.frozenAtoms,'806000000');assert.equal(held.chargedAtoms,'10000000');
  assert.equal(f.db.prepare('SELECT status FROM credit_orders').get().status,'refunded');
  assert.throws(()=>f.operations.consumeMessageCredits(1,100,'Clique','sponsored_click','legacy:blocked'));
});

test('canonical Ads receipt preserves fractional Coins and new 60-day expiry',async t=>{
  const f=await fixture(t),order=f.creditOrder('ads_fraction',VITRINE_COINS_POLICY.version);
  f.db.prepare('UPDATE credit_orders SET amount_cents=501,fee_cents=75,credit_units=4089 WHERE reference=?').run(order.reference);
  f.operations.applyCreditPayment(order,f.approved(order.reference,{transaction_amount:5.01}));
  assert.equal(f.wallet.status(1).availableCoins,'40.896');
  assert.equal(f.db.prepare('SELECT expires_at-created_at age FROM vitrine_coin_lots').get().age,60*DAY);
});

test('restoring a local purchase after expiry cannot extend a task lot',async t=>{
  const f=await fixture(t,{legacyRewards:100});f.db.exec("INSERT INTO social_posts VALUES(1,1,500,'pending');");
  f.operations.chargeSocialLink(1,1);f.advance(2*DAY);f.operations.refundSocialLink(1,'expired-moderation');
  assert.equal(f.wallet.status(1).availableAtoms,'0');assert.equal(f.wallet.status(1).expiredAtoms,'96000000');
});

test('disabled flag keeps legacy functions unchanged and unified status unavailable',async t=>{
  const f=await fixture(t,{enabled:false});assert.equal((await f.http('/api/coins/status')).status,503);
  f.rewards.grantGame(1,100,'disabled:task');assert.equal(f.rewards.available(1).points,100);
  assert.equal(f.db.prepare('SELECT remaining FROM city_reward_batches').get().remaining,100);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vitrine_coin_lots').get().n,0);
});

test('WhatsApp claims the last daily slot before await and stores a canonical hash of the real receipt',async t=>{
  const f=await fixture(t);f.fund(1);
  f.db.exec("INSERT INTO whatsapp_accounts VALUES(1,1,'connected','',0,100,'fixture','fixture',NULL); INSERT INTO whatsapp_contacts VALUES(1,1,'5511999999999',NULL);");
  let markStarted,complete;const started=new Promise(resolve=>{markStarted=resolve;});
  f.setWhatsAppHook(()=>{markStarted();return new Promise(resolve=>{complete=resolve;});});
  const first=f.http('/api/whatsapp/conversations/1/send',{method:'POST',body:{message:'Mensagem de teste'}});await started;
  assert.equal(f.wallet.status(1).reservedAtoms,'10000000');assert.equal(f.db.prepare('SELECT credits_used_today n FROM whatsapp_accounts').get().n,100);
  assert.equal((await f.http('/api/whatsapp/conversations/1/send',{method:'POST',body:{message:'Segunda mensagem'}})).status,409);assert.equal(f.providerCalls(),1);
  const receipt='wamid.fixture+/=';complete({messages:[{id:receipt}]});assert.equal((await first).status,201);
  assert.equal(f.wallet.status(1).reservedAtoms,'0');assert.equal(f.wallet.status(1).chargedAtoms,'10000000');
  assert.equal(f.db.prepare('SELECT credits_used_today n FROM whatsapp_accounts').get().n,100);
  assert.equal(f.db.prepare('SELECT meta_message_id id FROM whatsapp_messages').get().id,receipt);
  assert.equal(f.db.prepare('SELECT receipt_id id FROM vitrine_coin_requests').get().id,'meta:'+createHash('sha256').update(receipt).digest('hex'));
});

test('uncertain WhatsApp result preserves funds and daily quota and never resends automatically',async t=>{
  const f=await fixture(t);f.fund(1);
  f.db.exec("INSERT INTO whatsapp_accounts VALUES(1,1,'connected','',0,100,'fixture','fixture',NULL); INSERT INTO whatsapp_contacts VALUES(1,1,'5511999999999',NULL);");
  assert.equal((await f.http('/api/whatsapp/conversations/1/send',{user:2,method:'POST',body:{message:'Teste'}})).status,404);
  assert.equal((await f.http('/api/whatsapp/conversations/1/send',{method:'POST',origin:'https://other.test',body:{message:'Teste'}})).status,403);
  f.setWhatsAppHook(()=>{throw Error('Response lost after provider accepted');});
  const unknown=await f.http('/api/whatsapp/conversations/1/send',{method:'POST',body:{message:'Teste'}});assert.equal(unknown.status,502);assert.match(unknown.data.error,/confirmar/);
  assert.equal(f.wallet.status(1).reservedAtoms,'10000000');assert.equal(f.db.prepare('SELECT state FROM vitrine_coin_requests').get().state,'held');
  assert.equal(f.db.prepare('SELECT credits_used_today n FROM whatsapp_accounts').get().n,100);
  assert.equal((await f.http('/api/whatsapp/conversations/1/send',{method:'POST',body:{message:'Teste'}})).status,409);assert.equal(f.providerCalls(),1);
});
