import assert from 'node:assert/strict';
import {test} from 'node:test';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {createCoinWallet} from '../vitrine-coins-wallet.js';
import {quoteCoinTopup,atomsFromMicroBRL,atomsFromLegacyAdsUnits,atomsFromRewardPoints,assertCoinStatus} from '../public/vitrine-coins-contract.js';

const START=1800000000000,DAY=86400000;
function fixture(enabled=true){const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2)');let time=START;const wallet=createCoinWallet({db,enabled,now:()=>time});return {db,wallet,setTime:t=>time=t};}
const grant=(wallet,extra={},user=1)=>wallet.grant(user,{sourceId:'payment:one',amountAtoms:'816000000',origin:'purchase',createdAt:START,expiresAt:START+60*DAY,termsVersion:'coins-v1',paymentReference:'mercadopago:123',...extra});
const reserve=(wallet,extra={},user=1)=>wallet.reserve(user,{requestId:'request:one',maximumAtoms:'96000000',quoteId:'quote:one',requestHash:'a'.repeat(64),service:'api:video',...extra});
const settle=(wallet,extra={})=>wallet.settle(1,'request:one',{actualAtoms:'72000000',receiptId:'kling:receipt1',...extra});

test('canonical fee occurs once on top-up; usage unit conversions remain exact',()=>{
  assert.deepEqual(quoteCoinTopup(1000),{policyVersion:'vitrine-coins-topup-15-v1',amountCents:1000,feeCents:150,netCents:850,netAtoms:'816000000',netCoins:'81.6'});
  assert.equal(atomsFromMicroBRL('1'),'96');assert.equal(atomsFromLegacyAdsUnits('1'),'100000');assert.equal(atomsFromRewardPoints('301','100'),'288960000');
  assert.throws(()=>atomsFromRewardPoints('1','7'));
  for(const input of [1.1,'-1','1e3','01','9000000000000001',NaN])assert.throws(()=>atomsFromMicroBRL(input));
});
test('disabled wallet is inert and owner must be an existing numeric authenticated user',()=>{
  const {db,wallet}=fixture(false);try{assert.throws(()=>grant(wallet),{code:'coin_wallet_disabled'});assert.equal(wallet.status(1).availableAtoms,'0');
    for(const owner of ['store:1','admin:1','user:1',0,-1,1.1,'01',{},null,3])assert.throws(()=>wallet.status(owner),{code:'coin_owner_denied'});
  }finally{db.close();}
});
test('grants preserve source, exact value and expiration and reject duplicate payment under another source',()=>{
  const {db,wallet,setTime}=fixture();try{
    const lot=grant(wallet);assert.equal(lot.expiresAt,START+60*DAY);assert.equal(grant(wallet).duplicate,true);assert.equal(wallet.status('1').availableAtoms,'816000000');assertCoinStatus(wallet.status(1));
    assert.throws(()=>grant(wallet,{amountAtoms:'816000001'}),{code:'coin_conflict'});assert.throws(()=>grant(wallet,{},2),{code:'coin_conflict'});
    assert.throws(()=>grant(wallet,{sourceId:'different'}),{code:'coin_conflict'});
    for(const amountAtoms of [1,'-1','0','1.2','9000000000000001'])assert.throws(()=>grant(wallet,{sourceId:'invalid',amountAtoms,paymentReference:null}),{code:'coin_amount_invalid'});
    setTime(START+60*DAY);assert.equal(wallet.status(1).availableAtoms,'0');assert.equal(wallet.status(1).expiredAtoms,'816000000');assert.throws(()=>reserve(wallet),{code:'coin_wallet_insufficient'});
  }finally{db.close();}
});
test('reservation binds quote/hash/service/owner and is globally idempotent across users',()=>{
  const {db,wallet}=fixture();try{grant(wallet);reserve(wallet);assert.equal(reserve(wallet).duplicate,true);assert.equal(wallet.status(1).reservedAtoms,'96000000');assert.equal(wallet.status(1).availableAtoms,'720000000');
    for(const change of [{quoteId:'another'},{requestHash:'b'.repeat(64)},{maximumAtoms:'1'},{service:'ads'}])assert.throws(()=>reserve(wallet,change),{code:'coin_conflict'});
    assert.throws(()=>reserve(wallet,{},2),{code:'coin_conflict'});assert.throws(()=>wallet.settle(2,'request:one',{actualAtoms:'1',receiptId:'receipt:x'}),{code:'coin_request_not_found'});
  }finally{db.close();}
});
test('shared local/API balance cannot be overspent and charged once with no usage markup',()=>{
  const {db,wallet}=fixture();try{grant(wallet,{amountAtoms:'120000000'});reserve(wallet);assert.throws(()=>wallet.spend(1,{requestId:'ads:too-much',amountAtoms:'24000001',service:'sponsored_click'}),{code:'coin_wallet_insufficient'});
    wallet.spend(1,{requestId:'ads:one',amountAtoms:'24000000',service:'sponsored_click'});assert.equal(settle(wallet).chargedAtoms,'72000000');assert.equal(settle(wallet).duplicate,true);
    assert.equal(wallet.status(1).chargedAtoms,'96000000');assert.equal(wallet.status(1).availableAtoms,'24000000');assert.equal(wallet.status(1).reservedAtoms,'0');
    assert.throws(()=>settle(wallet,{actualAtoms:'1'}),{code:'coin_conflict'});
  }finally{db.close();}
});
test('unknown or over-quote receipt holds full reservation and same-receipt reconciliation charges once',()=>{
  const {db,wallet}=fixture();try{grant(wallet);reserve(wallet);assert.equal(settle(wallet,{actualAtoms:null}).state,'held');assert.equal(settle(wallet,{actualAtoms:null}).duplicate,true);assert.equal(wallet.status(1).chargedAtoms,'0');assert.equal(wallet.status(1).reservedAtoms,'96000000');
    assert.throws(()=>settle(wallet,{receiptId:'other:receipt'}),{code:'coin_conflict'});assert.equal(settle(wallet).state,'settled');
    reserve(wallet,{requestId:'request:two'});const over={actualAtoms:'100000000',receiptId:'kling:over'};assert.equal(wallet.settle(1,'request:two',over).state,'held');
    assert.throws(()=>wallet.settle(1,'request:two',{...over,actualAtoms:'96000000'}),{code:'coin_conflict'});
    assert.throws(()=>wallet.release(1,'request:two',{reason:'cancel',noConsumptionConfirmed:true}),{code:'coin_conflict'});
    reserve(wallet,{requestId:'request:three'});assert.throws(()=>wallet.settle(1,'request:three',{actualAtoms:'1',receiptId:'kling:over'}),{code:'coin_conflict'});
  }finally{db.close();}
});
test('expiration during reservation preserves actual charge and expires unused release without renewal',()=>{
  const {db,wallet,setTime}=fixture();try{grant(wallet,{amountAtoms:'120000000',expiresAt:START+100});reserve(wallet);setTime(START+200);assert.equal(wallet.status(1).reservedAtoms,'96000000');assert.equal(wallet.status(1).expiredAtoms,'24000000');settle(wallet);
    assert.equal(wallet.status(1).chargedAtoms,'72000000');assert.equal(wallet.status(1).expiredAtoms,'48000000');assert.equal(wallet.status(1).availableAtoms,'0');
  }finally{db.close();}
});
test('release requires explicit no-consumption evidence and is idempotent preserving expiry',()=>{
  const {db,wallet,setTime}=fixture();try{grant(wallet,{expiresAt:START+100});reserve(wallet);settle(wallet,{actualAtoms:null});
    assert.throws(()=>wallet.release(1,'request:one',{reason:'cancel'}),{code:'coin_input_invalid'});setTime(START+200);
    const input={reason:'provider confirmed no charge',noConsumptionConfirmed:true};assert.equal(wallet.release(1,'request:one',input).state,'released');assert.equal(wallet.release(1,'request:one',input).duplicate,true);
    assert.equal(wallet.status(1).reservedAtoms,'0');assert.equal(wallet.status(1).expiredAtoms,'816000000');assert.throws(()=>settle(wallet),{code:'coin_conflict'});
  }finally{db.close();}
});
test('local spend/refund tracks FEFO allocations exactly and never extends original expirations',()=>{
  const {db,wallet,setTime}=fixture();try{
    grant(wallet,{amountAtoms:'40000000',expiresAt:START+100});grant(wallet,{sourceId:'payment:two',paymentReference:'mp:two',amountAtoms:'60000000',expiresAt:START+1000});
    const input={requestId:'story:1',amountAtoms:'70000000',service:'story_link',description:'Story link'};
    wallet.spend(1,input);assert.equal(wallet.spend(1,input).duplicate,true);setTime(START+200);
    const result=wallet.restore(1,'story:1',{reason:'rejected moderation'});assert.equal(result.state,'restored');assert.equal(wallet.restore(1,'story:1',{reason:'rejected moderation'}).duplicate,true);
    assert.equal(wallet.status(1).availableAtoms,'60000000');assert.equal(wallet.status(1).expiredAtoms,'40000000');assert.equal(wallet.status(1).chargedAtoms,'0');
    assert.equal(db.prepare('SELECT expires_at FROM vitrine_coin_lots WHERE source_id=?').get('payment:one').expires_at,START+100);
    assert.throws(()=>wallet.restore(1,'story:1',{reason:'different'}),{code:'coin_conflict'});
  }finally{db.close();}
});
test('reserved local course discount can settle/refund, but consumed APIs cannot restore',()=>{
  const {db,wallet}=fixture();try{grant(wallet);reserve(wallet,{service:'reward_course'});settle(wallet);assert.equal(wallet.restore(1,'request:one',{reason:'course refund'}).state,'restored');
    reserve(wallet,{requestId:'request:api'});wallet.settle(1,'request:api',{actualAtoms:'1',receiptId:'api:paid'});assert.throws(()=>wallet.restore(1,'request:api',{reason:'give back'}),{code:'coin_api_restore_denied'});
    for(const service of ['api:video','kling','chat','unknown'])assert.throws(()=>wallet.spend(1,{requestId:'illegal',amountAtoms:'1',service}),{code:'coin_local_service_denied'});
  }finally{db.close();}
});
test('dispute freezes new spending without deleting funds or preventing audited settlement/release',()=>{
  const {db,wallet}=fixture();try{grant(wallet);reserve(wallet);const input={paymentReference:'mp:dispute',reason:'charged_back'};wallet.freeze(1,input);assert.equal(wallet.freeze(1,input).duplicate,true);
    assert.equal(wallet.status(1).frozen,true);assert.equal(wallet.status(1).availableAtoms,'0');assert.equal(wallet.status(1).frozenAtoms,'720000000');assert.equal(wallet.status(1).reservedAtoms,'96000000');
    assert.throws(()=>reserve(wallet,{requestId:'blocked'}),{code:'coin_wallet_frozen'});assert.throws(()=>wallet.spend(1,{requestId:'blocked:ads',amountAtoms:'1',service:'ads'}),{code:'coin_wallet_frozen'});
    settle(wallet);assert.equal(wallet.status(1).frozenAtoms,'744000000');assert.equal(wallet.status(1).chargedAtoms,'72000000');assert.equal(wallet.status(2).frozen,false);
  }finally{db.close();}
});
test('verified dispute progression preserves both audit reasons while remaining frozen',()=>{
  const {db,wallet}=fixture();try{grant(wallet);wallet.freeze(1,{paymentReference:'mercadopago:123',reason:'in_mediation'});assert.equal(wallet.freeze(1,{paymentReference:'mercadopago:123',reason:'refunded'}).duplicate,false);assert.equal(wallet.freeze(1,{paymentReference:'mercadopago:123',reason:'refunded'}).duplicate,true);assert.equal(wallet.status(1).frozenAtoms,'816000000');const event=wallet.history(1).find(e=>e.type==='freeze_updated');assert.equal(event.details.previousReason,'in_mediation');assert.equal(event.details.reason,'refunded');}finally{db.close();}
});
test('database errors roll back all allocations and debits, and reconstruction retains evidence',()=>{
  const {db,wallet}=fixture();try{grant(wallet);db.exec("CREATE TRIGGER fail_coin_event BEFORE INSERT ON vitrine_coin_events WHEN NEW.type='reserved' BEGIN SELECT RAISE(ABORT,'injected');END;");assert.throws(()=>reserve(wallet),/injected/);assert.equal(wallet.status(1).reservedAtoms,'0');assert.equal(db.prepare('SELECT COUNT(*) n FROM vitrine_coin_requests').get().n,0);db.exec('DROP TRIGGER fail_coin_event');
    reserve(wallet);settle(wallet,{actualAtoms:null});const restarted=createCoinWallet({db,enabled:true,now:()=>START});assert.equal(restarted.status(1).reservedAtoms,'96000000');assert.equal(restarted.settle(1,'request:one',{actualAtoms:'96',receiptId:'kling:receipt1'}).chargedAtoms,'96');assert.equal(restarted.history(1).filter(e=>e.type==='settled').length,1);
  }finally{db.close();}
});
test('amount cap and all exported balances stay within exact integers',()=>{
  const {db,wallet}=fixture();try{grant(wallet,{amountAtoms:'9000000000000000'});assert.throws(()=>grant(wallet,{sourceId:'overflow',paymentReference:null,amountAtoms:'1'}),{code:'coin_wallet_capacity'});
    reserve(wallet,{maximumAtoms:'8999999999999999'});settle(wallet,{actualAtoms:'8999999999999999'});assert.equal(wallet.status(1).availableAtoms,'1');assert.equal(wallet.status(1).chargedAtoms,'8999999999999999');assertCoinStatus(wallet.status(1));
  }finally{db.close();}
});
test('two independent SQLite connections racing API and Ads cannot overspend shared funds',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'vitrine-coins-race-')),filename=path.join(directory,'wallet.db'),db=new Database(filename);
  const workers=[];
  try{
    db.pragma('journal_mode=WAL');db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1)');const wallet=createCoinWallet({db,enabled:true,now:()=>START});grant(wallet,{amountAtoms:'96000000'});
    const gate=new SharedArrayBuffer(4),walletURL=new URL('../vitrine-coins-wallet.js',import.meta.url).href,databaseURL=import.meta.resolve('better-sqlite3');
    const calls=['api','ads'].map(kind=>new Promise((resolve,reject)=>{
      const worker=new Worker(`import {parentPort,workerData} from 'node:worker_threads';
        const {default:Database}=await import(workerData.databaseURL);const {createCoinWallet}=await import(workerData.walletURL);
        const db=new Database(workerData.filename);db.pragma('busy_timeout=5000');const wallet=createCoinWallet({db,enabled:true,now:()=>workerData.start});
        parentPort.postMessage({ready:true});Atomics.wait(new Int32Array(workerData.gate),0,0);
        try {const result=workerData.kind==='api'?wallet.reserve(1,{requestId:'race:api',maximumAtoms:'60000000',quoteId:'race:quote',requestHash:'a'.repeat(64),service:'api:video'}):wallet.spend(1,{requestId:'race:ads',amountAtoms:'60000000',service:'ads'});parentPort.postMessage({ok:true,state:result.state});}catch(error){parentPort.postMessage({ok:false,code:error.code,message:error.message});}finally{db.close();}`,
      {eval:true,workerData:{kind,filename,databaseURL,walletURL,gate,start:START}});
      workers.push(worker);worker.on('error',reject);worker.on('message',message=>{if(message.ready){if(++ready===2){Atomics.store(new Int32Array(gate),0,1);Atomics.notify(new Int32Array(gate),0,2);}}else resolve(message);});
    }));let ready=0;
    const results=await Promise.all(calls);assert.equal(results.filter(x=>x.ok).length,1);assert.equal(results.find(x=>!x.ok).code,'coin_wallet_insufficient');assert.equal(wallet.status(1).availableAtoms,'36000000');assert.equal(BigInt(wallet.status(1).reservedAtoms)+BigInt(wallet.status(1).chargedAtoms),60000000n);
  }finally{await Promise.all(workers.map(worker=>worker.terminate()));db.close();assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));assert(path.basename(directory).startsWith('vitrine-coins-race-'));rmSync(directory,{recursive:true,force:true});}
});
test('missing allocation coverage cannot silently release or settle corrupted reservation',()=>{
  const {db,wallet}=fixture();try{grant(wallet);reserve(wallet);db.prepare('DELETE FROM vitrine_coin_allocations WHERE request_id=?').run('request:one');assert.throws(()=>settle(wallet),{code:'coin_integrity'});assert.throws(()=>wallet.release(1,'request:one',{reason:'not dispatched',noConsumptionConfirmed:true}),{code:'coin_integrity'});assert.equal(wallet.status(1).reservedAtoms,'96000000');}finally{db.close();}
});
