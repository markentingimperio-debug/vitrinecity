import assert from 'node:assert/strict';
import {test} from 'node:test';
import express from 'express';
import Database from 'better-sqlite3';
import {createCoinWallet} from '../vitrine-coins-wallet.js';
import {VITRINE_COINS_POLICY} from '../public/vitrine-coins-contract.js';
import {setupLiaChatOperations} from '../vitriny-neural/lia-chat-operations.js';

async function fixture({remoteMode='success',enabled=true}={}){
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY);
    INSERT INTO users(id) VALUES(1);
    CREATE TABLE neural_chat_conversations(id TEXT PRIMARY KEY,scope TEXT NOT NULL,title TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE neural_chat_messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,request_id TEXT NOT NULL,role TEXT NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL,sequence INTEGER NOT NULL,created_at INTEGER NOT NULL,UNIQUE(conversation_id,sequence));`);
  let clock=1000,dispatches=0;const wallet=createCoinWallet({db,enabled:true,now:()=>clock});
  wallet.grant(1,{sourceId:'fixture-grant',amountAtoms:'100000000',origin:'purchase',createdAt:900,expiresAt:100000,termsVersion:VITRINE_COINS_POLICY.version,paymentReference:null});
  const app=express();app.use(express.json({limit:'5mb'}));
  const fetchImpl=async(url)=>{
    if(String(url).endsWith('/v1/operations/tasks')){
      dispatches++;
      if(remoteMode==='transport')throw new TypeError('Simulated connection reset; the worker may already have executed.');
      if(remoteMode==='http')return new Response(JSON.stringify({ok:false,error:'browser_failed'}),{status:502,headers:{'content-type':'application/json'}});
      if(remoteMode==='malformed')return new Response(JSON.stringify({ok:true,item:{status:'completed'}}),{status:201,headers:{'content-type':'application/json'}});
      return new Response(JSON.stringify({ok:true,item:{id:'op_fixture',status:'completed',result:'Página acessada com sucesso.',artifacts:[{path:'browser/vitrine-home.png',kind:'image'}]}}),{status:201,headers:{'content-type':'application/json'}});
    }
    if(String(url).includes('/v1/operations/artifact'))return new Response(Buffer.from('png'),{status:200,headers:{'content-type':'application/octet-stream'}});
    throw new Error('Unexpected transport');
  };
  setupLiaChatOperations({app,db,coinWallet:wallet,
    requireUser:(req,_res,next)=>{req.user={id:1};next();},
    sameOriginOnly:(req,res,next)=>req.get('origin')==='https://vitrinecity.test'?next():res.status(403).end(),
    env:{LIA_CHAT_OPERATIONS_ENABLED:String(enabled),LIA_OPERATIONS_URL:'https://lia.example.test',LIA_OPERATIONS_TOKEN:'x'.repeat(64),LIA_BROWSER_PRICE_MICRO_BRL:'104167',LIA_MEDIA_PRICE_MICRO_BRL:'520833'},fetchImpl});
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const origin='http://127.0.0.1:'+server.address().port;
  const json=(path,body,headers={})=>fetch(origin+path,{method:'POST',headers:{origin:'https://vitrinecity.test','content-type':'application/json',...headers},body:JSON.stringify(body)});
  return {db,wallet,server,origin,json,get dispatches(){return dispatches;},setClock:v=>{clock=v;},async close(){await new Promise(resolve=>server.close(resolve));db.close();}};
}
const command=(key='lia_browser_test_001')=>({instruction:'Abra a Vitrine City e tire um print',idempotencyKey:key,confirmCharge:true});
const execute=(f,body=command())=>f.json('/api/neural/chat/operations/run',body,{'x-lia-operations-request':'1'});

test('browser quotes, settles canonical Vitrine Coins once and persists result in chat',async()=>{
  const f=await fixture();try{
    const quote=await f.json('/api/neural/chat/operations/quote',{instruction:command().instruction});
    assert.equal(quote.status,200);const q=(await quote.json()).item;assert.equal(q.kind,'browser');assert.equal(q.supported,true);assert.equal(q.priceCoins,'1.0000032');
    const run=await execute(f);assert.equal(run.status,201);const data=await run.json();assert.equal(data.ok,true);
    const status=f.wallet.status(1);assert.equal(status.chargedAtoms,'10000032');assert.equal(status.reservedAtoms,'0');
    const messages=f.db.prepare('SELECT role,text,status FROM neural_chat_messages WHERE conversation_id=? ORDER BY sequence').all(data.conversationId);
    assert.equal(messages.length,2);assert.equal(messages[0].role,'user');assert.equal(messages[1].status,'completed');assert.match(messages[1].text,/Página acessada/);assert.match(messages[1].text,/LIA_ARTIFACT/);
    const duplicate=await execute(f);assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).duplicate,true);
    assert.equal(f.wallet.status(1).chargedAtoms,'10000032');assert.equal(f.dispatches,1);
  }finally{await f.close();}
});

for(const remoteMode of ['http','transport','malformed'])test(`uncertain ${remoteMode} preserves the reservation and does not replay`,async()=>{
  const f=await fixture({remoteMode});try{
    const run=await execute(f);assert.equal(run.status,502);const data=await run.json();assert.equal(data.code,'lia_operation_requires_review');
    const status=f.wallet.status(1);assert.equal(status.reservedAtoms,'10000032');assert.equal(status.chargedAtoms,'0');assert.equal(status.availableAtoms,'89999968');
    const message=f.db.prepare("SELECT text,status FROM neural_chat_messages WHERE role='assistant' ORDER BY rowid DESC LIMIT 1").get();
    assert.equal(message.status,'interrupted');assert.match(message.text,/reserva permanece/i);assert.doesNotMatch(message.text,/liberada/);
    const op=f.db.prepare('SELECT status,error FROM lia_chat_operations').get();assert.equal(op.status,'reserved');assert.equal(op.error,'operation_requires_review');
    const same=await execute(f);assert.equal(same.status,200);assert.equal((await same.json()).duplicate,true);
    const another=await execute(f,command('lia_browser_test_second'));assert.equal(another.status,409);
    assert.equal(f.dispatches,1);assert.equal(f.wallet.status(1).reservedAtoms,'10000032');
  }finally{await f.close();}
});

test('insufficient balance creates no conversation, message or phantom operation',async()=>{
  const f=await fixture();try{
    f.db.prepare('UPDATE vitrine_coin_lots SET amount_atoms=1000').run();
    const run=await execute(f);assert.equal(run.status,402);
    for(const table of ['neural_chat_messages','neural_chat_conversations','lia_chat_operations'])assert.equal(f.db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
    assert.equal(f.dispatches,0);assert.equal(f.wallet.status(1).reservedAtoms,'0');
  }finally{await f.close();}
});

test('message admission failure rolls the wallet reservation back atomically',async()=>{
  const f=await fixture();try{
    f.db.exec("CREATE TRIGGER fixture_reject_message BEFORE INSERT ON neural_chat_messages BEGIN SELECT RAISE(ABORT,'fixture error'); END;");
    const run=await execute(f);assert.equal(run.status,502);
    assert.equal(f.dispatches,0);assert.equal(f.wallet.status(1).reservedAtoms,'0');assert.equal(f.wallet.status(1).availableAtoms,'100000000');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM lia_chat_operations').get().n,0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM neural_chat_conversations').get().n,0);
  }finally{await f.close();}
});

test('disabled operations cannot reserve money or dispatch work',async()=>{
  const f=await fixture({enabled:false});try{
    const run=await execute(f);assert.equal(run.status,503);assert.equal(f.dispatches,0);
    assert.equal(f.wallet.status(1).availableAtoms,'100000000');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM lia_chat_operations').get().n,0);
  }finally{await f.close();}
});

test('deleting the conversation also revokes download access to its operational artifacts',async()=>{
  const f=await fixture();try{
    const run=await execute(f);assert.equal(run.status,201);const data=await run.json();
    const url=f.origin+'/api/neural/chat/operations/artifact?operation='+data.operationId+'&path=browser%2Fvitrine-home.png';
    assert.equal((await fetch(url)).status,200);
    f.db.prepare('DELETE FROM neural_chat_conversations WHERE id=?').run(data.conversationId);
    assert.equal((await fetch(url)).status,404);assert.equal(f.wallet.status(1).chargedAtoms,'10000032');
  }finally{await f.close();}
});
