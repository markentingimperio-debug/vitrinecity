import assert from 'node:assert/strict';
import {test} from 'node:test';
import Database from 'better-sqlite3';
import {createCoinWallet} from '../vitrine-coins-wallet.js';
import {migrateLegacyCoins} from '../vitrine-coins-migration.js';

const START=1800000000000,DAY=86400000;
function fixture(){
  const db=new Database(':memory:');db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2);
    CREATE TABLE wallets(user_id INTEGER PRIMARY KEY,balance_units INTEGER NOT NULL);
    CREATE TABLE credit_orders(reference TEXT PRIMARY KEY,user_id INTEGER,amount_cents INTEGER,fee_cents INTEGER,credit_units INTEGER,credited_units INTEGER,status TEXT,terms_version TEXT,mp_payment_id TEXT);
    CREATE TABLE credit_batches(id INTEGER PRIMARY KEY,user_id INTEGER,order_reference TEXT,original_units INTEGER,remaining_units INTEGER,expires_at INTEGER,status TEXT,created_at TEXT);
    CREATE TABLE city_reward_settings(id INTEGER PRIMARY KEY,coins_per_real INTEGER);INSERT INTO city_reward_settings VALUES(1,100);
    CREATE TABLE city_reward_batches(id INTEGER PRIMARY KEY,user_id INTEGER,source_key TEXT,points INTEGER,remaining INTEGER,created_ms INTEGER,expires_ms INTEGER);
    CREATE TABLE city_reward_audit(id INTEGER PRIMARY KEY,coins_per_real INTEGER);
    CREATE TABLE city_reward_orders(reference TEXT PRIMARY KEY,points INTEGER,debited INTEGER,status TEXT);
    CREATE TABLE social_posts(id TEXT PRIMARY KEY,cta_charge_status TEXT,cta_charge_units INTEGER);
    CREATE TABLE social_credit_allocations(post_id TEXT,batch_id INTEGER,units INTEGER);
    CREATE TABLE social_stories(id TEXT PRIMARY KEY,cta_charge_status TEXT,cta_charge_units INTEGER);
    CREATE TABLE social_story_credit_allocations(story_id TEXT,batch_id INTEGER,units INTEGER);
    CREATE TABLE neural_ai_credit_lots(id TEXT PRIMARY KEY,scope TEXT,payment_reference TEXT,amount_micro INTEGER,charged_micro INTEGER,reserved_micro INTEGER,created_at INTEGER,expires_at INTEGER,terms_version TEXT);
    CREATE TABLE neural_ai_credit_reservations(scope TEXT,request_id TEXT,state TEXT);
    CREATE TABLE neural_ai_credit_scope_holds(scope TEXT,payment_reference TEXT);
    CREATE TABLE neural_paid_chat_requests(request_id TEXT,phase TEXT);`);
  const wallet=createCoinWallet({db,enabled:true,now:()=>START});return {db,wallet};
}
function ads(db,{id=1,user=1,remaining=4800,expires=START+90*DAY,status='approved',reference='credit_order_1'}={}){
  db.prepare('INSERT INTO wallets VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET balance_units=balance_units+excluded.balance_units').run(user,remaining);
  db.prepare('INSERT INTO credit_orders VALUES(?,?,?,?,?,?,?,?,?)').run(reference,user,1000,150,8160,8160,status,'legacy-90',`mp${id}`);
  db.prepare('INSERT INTO credit_batches VALUES(?,?,?,?,?,?,?,?)').run(id,user,reference,8160,remaining,expires,'active',new Date(START-DAY).toISOString());
}
const reward=(db,{id=1,user=1,remaining=301,expires=START+60*DAY}={})=>db.prepare('INSERT INTO city_reward_batches VALUES(?,?,?,?,?,?,?)').run(id,user,`game:${id}`,remaining,remaining,START-DAY,expires);
const migrate=(f,extra={})=>migrateLegacyCoins({...f,now:()=>START,...extra});
const legacy=db=>JSON.stringify(['wallets','credit_orders','credit_batches','city_reward_batches'].map(table=>db.prepare(`SELECT * FROM ${table}`).all()));

test('dry-run reads only; per-lot economic conversion and original expirations are preserved',()=>{
  const f=fixture(),{db,wallet}=f;try{ads(db);reward(db);const before=legacy(db),schema=db.prepare('SELECT name FROM sqlite_master ORDER BY name').all();db.pragma('query_only=ON');const plan=migrate(f);assert.equal(plan.ok,true);assert.equal(plan.completed,false);assert.equal(plan.summary.totalAtoms,'768960000');assert.equal(wallet.status(1).availableAtoms,'0');assert.deepEqual(db.prepare('SELECT name FROM sqlite_master ORDER BY name').all(),schema);db.pragma('query_only=OFF');
    const result=migrate(f,{dryRun:false});assert.equal(result.completed,true);assert.equal(result.snapshotHash,plan.snapshotHash);assert.equal(wallet.status(1).availableAtoms,'768960000');assert.equal(legacy(db),before);
    const lots=db.prepare('SELECT source_id,amount_atoms,expires_at FROM vitrine_coin_lots ORDER BY source_id').all();assert.deepEqual(lots,[{source_id:'legacy-ads:credit_order_1',amount_atoms:480000000,expires_at:START+90*DAY},{source_id:'legacy-reward:1',amount_atoms:288960000,expires_at:START+60*DAY}]);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM vitrine_coin_migration_sources WHERE length(metadata_hash)=64').get().n,2);
  }finally{db.close();}
});
test('committed global marker prevents reimport after restart or later legacy history updates',()=>{
  const f=fixture(),{db,wallet}=f;try{ads(db);migrate(f,{dryRun:false});wallet.spend(1,{requestId:'ads:one',amountAtoms:'100000000',service:'ads'});
    db.prepare('UPDATE wallets SET balance_units=999999').run();db.prepare('UPDATE credit_batches SET remaining_units=999999').run();
    const restarted=createCoinWallet({db,enabled:true,now:()=>START});assert.equal(migrateLegacyCoins({db,wallet:restarted,dryRun:false,now:()=>START+DAY}).duplicate,true);assert.equal(restarted.status(1).availableAtoms,'380000000');assert.equal(db.prepare('SELECT COUNT(*) n FROM vitrine_coin_lots').get().n,1);
  }finally{db.close();}
});
test('wallet coverage mismatch blocks cutover without changing either ledger',()=>{
  const f=fixture(),{db,wallet}=f;try{ads(db);db.prepare('UPDATE wallets SET balance_units=4801').run();const before=legacy(db),report=migrate(f);assert.equal(report.ok,false);assert(report.issues.some(x=>x.code==='legacy_ads_coverage_mismatch'));
    assert.throws(()=>migrate(f,{dryRun:false}),{code:'coin_migration_blocked'});assert.equal(wallet.status(1).availableAtoms,'0');assert.equal(legacy(db),before);assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='vitrine_coin_migrations'").get(),undefined);
  }finally{db.close();}
});
test('pending credit orders are not money and do not block zero-balance cutover',()=>{
  const f=fixture(),{db,wallet}=f;try{db.exec("INSERT INTO wallets VALUES(1,0);INSERT INTO credit_orders VALUES('pending',1,1000,150,8160,0,'pending','new-terms',NULL)");const report=migrate(f,{dryRun:false});assert.equal(report.ok,true);assert.equal(report.summary.pendingCreditOrders,1);assert.equal(wallet.status(1).availableAtoms,'0');assert.equal(db.prepare('SELECT COUNT(*) n FROM vitrine_coin_lots').get().n,0);
  }finally{db.close();}
});
test('expired remainder stays expired while zero lots are recorded without minting',()=>{
  const f=fixture(),{db,wallet}=f;try{ads(db,{remaining:0});reward(db,{remaining:50,expires:START-1});const report=migrate(f,{dryRun:false});assert.equal(report.summary.sourceRows,2);assert.equal(wallet.status(1).availableAtoms,'0');assert.equal(wallet.status(1).expiredAtoms,'48000000');assert.equal(db.prepare('SELECT lot_id FROM vitrine_coin_migration_sources WHERE source_id=?').get('legacy-ads:credit_order_1').lot_id,null);
  }finally{db.close();}
});
test('ambiguous owner, unproved payment, malformed fee and duplicate underlying payment are blocked',()=>{
  for(const mutate of [db=>db.prepare('UPDATE credit_orders SET user_id=2').run(),db=>db.prepare("UPDATE credit_orders SET status='pending'").run(),db=>db.prepare('UPDATE credit_orders SET fee_cents=1001').run(),db=>db.prepare('UPDATE credit_batches SET user_id=999').run(),db=>{ads(db,{id:2,user:2,reference:'second'});db.prepare("UPDATE credit_orders SET mp_payment_id='mp1'").run();}]){
    const f=fixture();try{ads(f.db);mutate(f.db);assert.equal(migrate(f).ok,false);assert.throws(()=>migrate(f,{dryRun:false}),{code:'coin_migration_blocked'});}finally{f.db.close();}
  }
});
test('reward ratios must be exact and historical changing ratios require review',()=>{
  for(const mutate of [db=>db.exec('UPDATE city_reward_settings SET coins_per_real=7'),db=>db.exec('INSERT INTO city_reward_audit VALUES(1,200)'),db=>db.exec('DELETE FROM city_reward_settings')]){
    const f=fixture();try{reward(f.db,{remaining:1});mutate(f.db);assert.equal(migrate(f).ok,false);assert.throws(()=>migrate(f,{dryRun:false}),{code:'coin_migration_blocked'});}finally{f.db.close();}
  }
});
test('old refundable video/story allocations and course reservations block automatic migration',()=>{
  for(const sql of ["INSERT INTO social_posts VALUES('p','paid',500);INSERT INTO social_credit_allocations VALUES('p',1,500)","INSERT INTO social_stories VALUES('s','paid',500);INSERT INTO social_story_credit_allocations VALUES('s',1,500)","INSERT INTO social_credit_allocations VALUES('orphan',1,500)","INSERT INTO city_reward_orders VALUES('c',10,1,'approved')","INSERT INTO city_reward_orders VALUES('c',10,0,'pending')"]){
    const f=fixture();try{ads(f.db);f.db.exec(sql);const report=migrate(f);assert.equal(report.ok,false);assert(report.issues.some(x=>/unsupported/.test(x.code)));}finally{f.db.close();}
  }
});
test('legacy AI migrations require explicit user owner and reject reservations, jobs or holds',()=>{
  for(const sql of ["INSERT INTO neural_ai_credit_reservations VALUES('user:1','r','reserved')","INSERT INTO neural_paid_chat_requests VALUES('r','dispatched')","INSERT INTO neural_ai_credit_scope_holds VALUES('user:1','p')"]){
    const f=fixture();try{f.db.exec(sql);assert.equal(migrate(f).ok,false);}finally{f.db.close();}
  }
  for(const scope of ['store:1','admin:1','user:999']){const f=fixture();try{f.db.prepare('INSERT INTO neural_ai_credit_lots VALUES(?,?,?,?,?,?,?,?,?)').run('lot1',scope,'mp:ai',1000000,0,0,START,START+60*DAY,'old-ai');assert.equal(migrate(f).ok,false);}finally{f.db.close();}}
  const f=fixture();try{f.db.prepare('INSERT INTO neural_ai_credit_lots VALUES(?,?,?,?,?,?,?,?,?)').run('lot1','user:1','mp:ai',1000000,123,0,START,START+60*DAY,'old-ai');const r=migrate(f,{dryRun:false});assert.equal(r.ok,true);assert.equal(f.wallet.status(1).availableAtoms,String(999877n*96n));}finally{f.db.close();}
});
test('conflicting partial target imports block; later failure atomically rolls back all copied lots',()=>{
  const f=fixture();try{ads(f.db);f.wallet.grant(1,{sourceId:'legacy-ads:credit_order_1',amountAtoms:'1',origin:'test',createdAt:START,expiresAt:START+DAY,termsVersion:'x'});assert.equal(migrate(f).ok,false);}finally{f.db.close();}
  const f2=fixture();try{ads(f2.db);reward(f2.db);f2.db.exec("CREATE TRIGGER reject_second BEFORE INSERT ON vitrine_coin_lots WHEN NEW.origin='legacy_rewards' BEGIN SELECT RAISE(ABORT,'injected');END;");assert.throws(()=>migrate(f2,{dryRun:false}),/injected/);assert.equal(f2.wallet.status(1).availableAtoms,'0');assert.equal(f2.db.prepare("SELECT 1 FROM sqlite_master WHERE name='vitrine_coin_migrations'").get(),undefined);}finally{f2.db.close();}
});
