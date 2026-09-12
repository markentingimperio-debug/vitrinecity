import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import Database from 'better-sqlite3';
import {setupCityExploration,explorationDay,explorationLevel,EXPLORATION_VIEW_MS,decorateExplorationPage} from '../city-exploration.js';
import {setupCityRewards} from '../city-rewards.js';
import {memberReturn} from '../public/vitriny-membership-core.js';

test('Brasilia dates and phase boundaries are determined independently of the client clock',()=>{
  assert.equal(explorationDay(Date.parse('2026-09-11T02:59:59Z')),'2026-09-10');
  assert.equal(explorationDay(Date.parse('2026-09-11T03:00:00Z')),'2026-09-11');
  assert.equal(explorationLevel(99).level,1);assert.equal(explorationLevel(100).level,2);
  assert.equal(explorationLevel(205).progress,5);
  const html=decorateExplorationPage('<body>Loja</body>',{storeReference:'"><script>bad</script>',productId:5});
  assert.ok(!html.includes('<script>bad'));assert.ok(html.includes('data-reward-product="5"'));
  for(const path of ['/loja/official_agrotecnica/agrotecnica','/produto/20/adubo-organico'])assert.equal(memberReturn(path),path);
  for(const path of ['/loja/../../../admin','/produto/https://evil.test','//evil.test/loja/example','/loja/%5cevil.test'])assert.ok(memberReturn(path).startsWith('/vitriny-multiverse-explore'));
});

test('a store visit requires the matching available product, viewing time and one atomic daily award',async()=>{
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2);
    CREATE TABLE store_profiles(order_reference TEXT PRIMARY KEY,business_name TEXT,review_status TEXT);
    CREATE TABLE store_products(id INTEGER PRIMARY KEY,store_reference TEXT,active INTEGER,marketplace_enabled INTEGER,stock_quantity INTEGER,price_cents INTEGER);
    INSERT INTO store_profiles VALUES('agro','Agrotecnica','published'),('country','Country','published'),('empty','Empty','published'),('draft','Draft','pending');
    INSERT INTO store_products VALUES(1,'agro',1,1,5,1200),(2,'country',1,1,5,1500),(3,'agro',0,1,5,800),(4,'draft',1,1,5,900);`);
  let time=Date.parse('2026-09-10T15:00:00Z');const now=()=>time,app=express();app.use(express.json());
  const requireUser=(req,res,next)=>{const id=Number(req.get('x-user'));if(![1,2].includes(id))return res.sendStatus(401);req.user={id};next();};
  const sameOriginOnly=(req,res,next)=>req.get('origin')==='https://city.test'?next():res.sendStatus(403);
  const rewards=setupCityRewards({app,db,requireUser,requireAdmin:requireUser,sameOriginOnly,publicDir:'',getCourse:()=>null,paymentReady:()=>false,now});
  const exploration=setupCityExploration({app,db,requireUser,sameOriginOnly,rewards,now});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin=`http://127.0.0.1:${server.address().port}`;
  async function request(action='',body,user=1,site='https://city.test'){
    const response=await fetch(origin+'/api/rewards/exploration'+action,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-user':String(user),origin:site},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,data:await response.json().catch(()=>null)};
  }
  try{
    assert.equal((await request('',undefined,0)).status,401);
    assert.equal((await request('/start',{storeReference:'agro'},1,'https://evil.test')).status,403);
    const checks=await Promise.all([request('/check-in',{}),request('/check-in',{})]);assert.equal(checks.filter(c=>c.data.checkedInNow).length,1);assert.equal(exploration.summary(1).xp,5);
    assert.deepEqual(exploration.summary(1).dailyGoal,{target:2,completed:0,remaining:2,achieved:false,available:true,rewardCoinsPerStore:1,bonusCoins:0});
    assert.deepEqual(exploration.summary(1).dailyStores.map(s=>s.reference),['agro','country'],'The itinerary contains only published stores with eligible products');
    assert.equal((await request('/start',{storeReference:'draft'})).status,404);
    assert.equal((await request('/start',{storeReference:'empty'})).data.eligible,false);
    const start=(await request('/start',{storeReference:'agro'})).data;assert.ok(start.token);
    assert.equal((await request('/start',{storeReference:'agro'})).data.token,start.token);
    assert.equal((await request('/complete',{token:start.token,productId:1})).data.code,'product_required');
    assert.equal((await request('/view',{token:start.token,productId:2})).data.code,'product_mismatch');
    assert.equal((await request('/view',{token:start.token,productId:3})).status,400);
    assert.equal((await request('/view',{token:start.token,productId:1},2)).status,409);
    assert.equal((await request('/view',{token:start.token,productId:1})).status,200);
    assert.equal((await request('/complete',{token:start.token,productId:1,elapsedMs:999999,coins:100000,date:'2099-01-01'})).data.code,'view_incomplete');
    time+=EXPLORATION_VIEW_MS;
    const claims=await Promise.all(Array.from({length:8},()=>request('/complete',{token:start.token,productId:1})));
    assert.equal(claims.filter(c=>c.data.awarded).length,1);assert.equal(rewards.available(1).points,1);assert.equal(exploration.summary(1).xp,15);
    assert.deepEqual(exploration.summary(1).visitedToday,['agro']);
    assert.deepEqual(exploration.summary(1).dailyStores,[{reference:'country',name:'Country',completed:false},{reference:'agro',name:'Agrotecnica',completed:true}],'Unvisited eligible stores come first');
    assert.equal(exploration.summary(1).dailyGoal.completed,1);assert.equal(exploration.summary(1).dailyGoal.achieved,false);
    assert.equal((await request('/start',{storeReference:'agro'})).data.alreadyClaimed,true);
    const another=(await request('/start',{storeReference:'country'})).data;
    await request('/view',{token:another.token,productId:2});time+=EXPLORATION_VIEW_MS;
    db.prepare('UPDATE store_products SET active=0 WHERE id=2').run();assert.equal((await request('/complete',{token:another.token,productId:2})).data.code,'product_required');
    db.prepare('UPDATE store_products SET active=1 WHERE id=2').run();db.prepare('UPDATE city_reward_settings SET enabled=0').run();assert.equal((await request('/complete',{token:another.token,productId:2})).data.code,'paused');
    db.prepare('UPDATE city_reward_settings SET enabled=1,daily_limit=1').run();assert.equal((await request('/complete',{token:another.token,productId:2})).data.code,'daily_limit');
    db.prepare('UPDATE city_reward_settings SET daily_limit=100').run();assert.equal((await request('/complete',{token:another.token,productId:2})).data.awarded,true);
    assert.equal(exploration.summary(1).dailyGoal.achieved,true);assert.equal(rewards.available(1).points,2,'Finishing the daily goal does not create bonus coins');
    time=Date.parse('2026-09-11T02:59:59Z');assert.equal((await request('/start',{storeReference:'agro'})).data.alreadyClaimed,true);
    time=Date.parse('2026-09-11T03:00:01Z');assert.equal((await request('/complete',{token:start.token,productId:1})).data.code,'expired');
    assert.equal(exploration.summary(1).dailyGoal.completed,0);assert.equal(exploration.summary(1).dailyGoal.achieved,false);
    const next=(await request('/start',{storeReference:'agro'})).data;assert.notEqual(next.token,start.token);await request('/view',{token:next.token,productId:1});time+=EXPLORATION_VIEW_MS;
    assert.equal((await request('/complete',{token:next.token,productId:1})).data.awarded,true);assert.equal(rewards.available(1).points,3);
    await request('/check-in',{});assert.equal(exploration.summary(1).streak,2);
    time+=2*86400000;await request('/check-in',{});assert.equal(exploration.summary(1).streak,1);
    const expires=(await request('/start',{storeReference:'country'})).data;time+=31*60000;assert.equal((await request('/view',{token:expires.token,productId:2})).data.code,'expired');
    assert.notEqual((await request('/start',{storeReference:'country'})).data.token,expires.token);
    assert.equal(exploration.exportUser(1).visits.length,4);assert.equal(exploration.summary(2).xp,0);
    db.prepare('DELETE FROM users WHERE id=1').run();assert.equal(db.prepare('SELECT COUNT(*) n FROM city_exploration_visits').get().n,0);
  }finally{await new Promise(r=>server.close(r));db.close();}
});

test('daily goal uses only eligible distinct stores, adapts to availability and never grants a bonus',async()=>{
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1);
    CREATE TABLE store_profiles(order_reference TEXT PRIMARY KEY,business_name TEXT,review_status TEXT);
    CREATE TABLE store_products(id INTEGER PRIMARY KEY,store_reference TEXT,active INTEGER,marketplace_enabled INTEGER,stock_quantity INTEGER,price_cents INTEGER);`);
  let time=Date.parse('2026-09-11T15:00:00Z');const now=()=>time,app=express();app.use(express.json());
  const requireUser=(req,_res,next)=>{req.user={id:1};next();};
  const rewards=setupCityRewards({app,db,requireUser,requireAdmin:requireUser,sameOriginOnly:(_req,_res,next)=>next(),publicDir:'',getCourse:()=>null,paymentReady:()=>false,now});
  const exploration=setupCityExploration({app,db,requireUser,sameOriginOnly:(_req,_res,next)=>next(),rewards,now});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api/rewards/exploration`;
  async function request(path='',body){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(response.status,200);return response.json();}
  try{
    assert.deepEqual((await request()).dailyGoal,{target:0,completed:0,remaining:0,achieved:false,available:false,rewardCoinsPerStore:1,bonusCoins:0});
    db.exec(`INSERT INTO store_profiles VALUES('a','A','published'),('b','B','published'),('c','C','published'),('d','D','published'),('hidden','Hidden','pending'),('empty','Empty','published');
      INSERT INTO store_products VALUES(1,'a',1,1,1,100),(2,'b',1,1,0,100),(3,'c',1,1,0,100),(4,'d',1,1,0,100),
        (5,'hidden',1,1,1,100),(6,'a',1,1,1,100),(7,'empty',0,1,1,100),(8,'empty',1,0,1,100),(9,'empty',1,1,1,0);`);
    assert.equal((await request()).dailyGoal.target,1,'Two eligible products from one store count as one store');
    db.prepare('UPDATE store_products SET stock_quantity=1 WHERE id IN (2,3,4)').run();
    assert.equal((await request()).dailyGoal.target,3);
    const untouched=await request('/start',{storeReference:'a',target:1,completed:99,bonusCoins:100});
    assert.ok(untouched.token);assert.equal((await request()).dailyGoal.completed,0,'An entry alone cannot advance the goal');
    await request('/check-in',{target:1,completed:99});
    for(const [index,storeReference] of ['a','b','c','d'].entries()){
      const visit=await request('/start',{storeReference});
      await request('/view',{token:visit.token,productId:index+1});time+=EXPLORATION_VIEW_MS;
      const result=await request('/complete',{token:visit.token,productId:index+1,dailyGoal:{target:1,completed:99},coins:1000});
      assert.equal(result.balance,index+1);assert.equal(result.dailyRewards.earned,index+1);
      assert.equal(result.dailyGoal.completed,Math.min(3,index+1));assert.equal(result.dailyGoal.achieved,index>=2);
      assert.equal(result.visitedToday.length,index+1);assert.equal(result.xp,(index+1)*10+5);
      assert.equal(result.dailyGoal.bonusCoins,0);
      const replay=await request('/complete',{token:visit.token,productId:index+1});assert.equal(replay.awarded,false);assert.equal(replay.balance,index+1);
    }
    const summary=await request();assert.equal(summary.rules.dailyGoalStores,3);assert.equal(summary.dailyGoal.remaining,0);assert.equal(summary.dailyRewards.remaining,96);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM city_reward_batches').get().n,4,'Only the four visit grants exist');
    db.prepare('UPDATE store_products SET stock_quantity=0').run();
    const unavailable=await request();assert.equal(unavailable.dailyGoal.target,0);assert.equal(unavailable.dailyGoal.available,false);assert.equal(unavailable.dailyGoal.achieved,false);assert.equal(unavailable.visitedToday.length,4);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
