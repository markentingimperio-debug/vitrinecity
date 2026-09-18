import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {setupLiaCustomerOperations} from '../vitriny-neural/lia-customer-operations.js';

function response(status=200){
  return {code:status,body:null,status(value){this.code=value;return this;},json(value){this.body=value;return this;},set(){return this;},end(){return this;}};
}
function req(body={}){
  return {user:{id:1},body,headers:{'x-lia-operations-request':'1'},get(name){return this.headers[String(name).toLowerCase()]||'';},is(type){return type==='application/json';}};
}
function appStub(){
  const routes=[];
  return {routes,get(path,...handlers){routes.push({method:'GET',path,handlers});},post(path,...handlers){routes.push({method:'POST',path,handlers});}};
}
function database(){
  const db=new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY);
    CREATE TABLE wallets(user_id INTEGER PRIMARY KEY REFERENCES users(id),balance_units INTEGER NOT NULL,updated_at TEXT);
    CREATE TABLE credit_batches(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,remaining_units INTEGER NOT NULL,status TEXT NOT NULL,expires_at INTEGER NOT NULL,updated_at TEXT);
    CREATE TABLE wallet_ledger(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,delta_units INTEGER NOT NULL,balance_after_units INTEGER NOT NULL,kind TEXT NOT NULL,description TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO users(id) VALUES(1);
    INSERT INTO wallets(user_id,balance_units) VALUES(1,1000);
    INSERT INTO credit_batches(id,user_id,remaining_units,status,expires_at) VALUES(1,1,1000,'active',4102444800000);`);
  return db;
}
function mount({failRun=false}={}){
  const db=database(),app=appStub();
  const fetchImpl=async(url,options={})=>{
    if(String(url).endsWith('/v1/operations/quote'))return new Response(JSON.stringify({ok:true,kind:'browser',supported:true,needsUpload:false,chargeClass:'browser'}),{status:200,headers:{'content-type':'application/json'}});
    if(String(url).endsWith('/v1/operations/tasks')){
      if(failRun)return new Response(JSON.stringify({ok:false,error:'browser_failed'}),{status:502,headers:{'content-type':'application/json'}});
      return new Response(JSON.stringify({ok:true,item:{id:'op_test',status:'completed',result:'Página acessada',artifacts:[]}}),{status:201,headers:{'content-type':'application/json'}});
    }
    throw new Error('unexpected url '+url);
  };
  setupLiaCustomerOperations({app,db,requireUser:(_q,_s,n)=>n(),sameOriginOnly:(_q,_s,n)=>n(),expireCreditBatches:()=>{},fetchImpl,
    env:{LIA_CUSTOMER_OPERATIONS_ENABLED:'1',LIA_OPERATIONS_URL:'https://lia.example.test',LIA_OPERATIONS_TOKEN:'a'.repeat(64),LIA_BROWSER_PRICE_UNITS:'100',LIA_MEDIA_PRICE_UNITS:'500'}});
  const run=app.routes.find(r=>r.method==='POST'&&r.path==='/api/lia/operations/run').handlers.at(-1);
  return {db,run};
}

test('browser operation reserves Vitrine Coins once and is idempotent',async()=>{
  const {db,run}=mount();
  const body={instruction:'Abra https://vitrinecity.com e tire uma captura',idempotencyKey:'task_browser_001',confirmCharge:true};
  let res=response();await run(req(body),res);
  assert.equal(res.code,201);assert.equal(res.body.ok,true);
  assert.equal(db.prepare('SELECT balance_units FROM wallets WHERE user_id=1').get().balance_units,900);
  assert.equal(db.prepare('SELECT remaining_units FROM credit_batches WHERE id=1').get().remaining_units,900);
  const ledger=db.prepare('SELECT delta_units,kind FROM wallet_ledger ORDER BY id').all();
  assert.deepEqual(ledger,[{delta_units:-100,kind:'lia_operation_reserve'}]);
  assert.equal(db.prepare('SELECT status FROM lia_customer_operations').get().status,'completed');

  res=response();await run(req(body),res);
  assert.equal(res.code,200);assert.equal(res.body.duplicate,true);
  assert.equal(db.prepare('SELECT balance_units FROM wallets WHERE user_id=1').get().balance_units,900);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM wallet_ledger').get().n,1);
});

test('failed operation refunds the exact reserved coins',async()=>{
  const {db,run}=mount({failRun:true});
  const body={instruction:'Abra https://vitrinecity.com e tire uma captura',idempotencyKey:'task_browser_002',confirmCharge:true};
  const res=response();await run(req(body),res);
  assert.equal(res.code,502);assert.equal(res.body.ok,false);
  assert.equal(db.prepare('SELECT balance_units FROM wallets WHERE user_id=1').get().balance_units,1000);
  assert.equal(db.prepare('SELECT remaining_units FROM credit_batches WHERE id=1').get().remaining_units,1000);
  assert.deepEqual(db.prepare('SELECT delta_units,kind FROM wallet_ledger ORDER BY id').all(),[
    {delta_units:-100,kind:'lia_operation_reserve'},
    {delta_units:100,kind:'lia_operation_refund'}
  ]);
  assert.equal(db.prepare('SELECT status FROM lia_customer_operations').get().status,'refunded');
});
