import assert from 'node:assert/strict';
import {test} from 'node:test';
import express from 'express';
import Database from 'better-sqlite3';
import {createCoinWallet} from '../vitrine-coins-wallet.js';
import {VITRINE_COINS_POLICY} from '../public/vitrine-coins-contract.js';
import {setupLiaChatOperations} from '../vitriny-neural/lia-chat-operations.js';

async function fixture({failRemote=false}={}){
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY);
    INSERT INTO users(id) VALUES(1);
    CREATE TABLE neural_chat_conversations(id TEXT PRIMARY KEY,scope TEXT NOT NULL,title TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE neural_chat_messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,request_id TEXT NOT NULL,role TEXT NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL,sequence INTEGER NOT NULL,created_at INTEGER NOT NULL,UNIQUE(conversation_id,sequence));`);
  let clock=1000;const wallet=createCoinWallet({db,enabled:true,now:()=>clock});
  wallet.grant(1,{sourceId:'fixture-grant',amountAtoms:'100000000',origin:'purchase',createdAt:900,expiresAt:100000,termsVersion:VITRINE_COINS_POLICY.version,paymentReference:null});
  const app=express();app.use(express.json({limit:'5mb'}));
  const fetchImpl=async(url,options={})=>{
    if(String(url).endsWith('/v1/operations/tasks')){
      if(failRemote)return new Response(JSON.stringify({ok:false,error:'browser_failed'}),{status:502,headers:{'content-type':'application/json'}});
      return new Response(JSON.stringify({ok:true,item:{id:'op_fixture',status:'completed',result:'Página acessada com sucesso.',artifacts:[{path:'browser/vitrine-home.png',kind:'image'}]}}),{status:201,headers:{'content-type':'application/json'}});
    }
    if(String(url).includes('/v1/operations/artifact'))return new Response(Buffer.from('png'),{status:200,headers:{'content-type':'application/octet-stream','content-disposition':'attachment; filename="vitrine-home.png"'}});
    throw new Error('unexpected '+url);
  };
  setupLiaChatOperations({app,db,coinWallet:wallet,
    requireUser:(req,_res,next)=>{req.user={id:1};next();},
    sameOriginOnly:(req,res,next)=>req.get('origin')==='https://vitrinecity.test'?next():res.status(403).end(),
    env:{LIA_CHAT_OPERATIONS_ENABLED:'true',LIA_OPERATIONS_URL:'https://lia.example.test',LIA_OPERATIONS_TOKEN:'x'.repeat(64),LIA_BROWSER_PRICE_MICRO_BRL:'104167',LIA_MEDIA_PRICE_MICRO_BRL:'520833'},
    fetchImpl});
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const origin='http://127.0.0.1:'+server.address().port;
  const json=(path,body,headers={})=>fetch(origin+path,{method:'POST',headers:{origin:'https://vitrinecity.test','content-type':'application/json',...headers},body:JSON.stringify(body)});
  return {db,wallet,server,origin,json,setClock:v=>{clock=v;}};
}

test('browser operation quotes, charges canonical Vitrine Coins once and persists result in chat',async()=>{
  const f=await fixture();try{
    const quote=await f.json('/api/neural/chat/operations/quote',{instruction:'Abra a Vitrine City e tire um print'});
    assert.equal(quote.status,200);const q=(await quote.json()).item;assert.equal(q.kind,'browser');assert.equal(q.supported,true);assert.equal(q.priceCoins,'1.0000032');
    const run=await f.json('/api/neural/chat/operations/run',{instruction:'Abra a Vitrine City e tire um print',idempotencyKey:'lia_browser_test_001',confirmCharge:true},{'x-lia-operations-request':'1'});
    assert.equal(run.status,201);const data=await run.json();assert.equal(data.ok,true);
    const status=f.wallet.status(1);assert.equal(status.chargedAtoms,'10000032');assert.equal(status.reservedAtoms,'0');
    const messages=f.db.prepare('SELECT role,text,status FROM neural_chat_messages WHERE conversation_id=? ORDER BY sequence').all(data.conversationId);
    assert.equal(messages.length,2);assert.equal(messages[0].role,'user');assert.equal(messages[1].status,'completed');assert.match(messages[1].text,/Página acessada/);assert.match(messages[1].text,/LIA_ARTIFACT/);
    const duplicate=await f.json('/api/neural/chat/operations/run',{instruction:'Abra a Vitrine City e tire um print',idempotencyKey:'lia_browser_test_001',confirmCharge:true},{'x-lia-operations-request':'1'});
    assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).duplicate,true);assert.equal(f.wallet.status(1).chargedAtoms,'10000032');
  }finally{await new Promise(resolve=>f.server.close(resolve));f.db.close();}
});

test('failed remote operation releases the reservation and leaves an auditable failed chat message',async()=>{
  const f=await fixture({failRemote:true});try{
    const before=f.wallet.status(1).availableAtoms;
    const run=await f.json('/api/neural/chat/operations/run',{instruction:'Abra https://vitrinecity.com e tire uma captura',idempotencyKey:'lia_browser_test_002',confirmCharge:true},{'x-lia-operations-request':'1'});
    assert.equal(run.status,502);
    const after=f.wallet.status(1);assert.equal(after.availableAtoms,before);assert.equal(after.reservedAtoms,'0');assert.equal(after.chargedAtoms,'0');
    const message=f.db.prepare("SELECT text,status FROM neural_chat_messages WHERE role='assistant' ORDER BY rowid DESC LIMIT 1").get();
    assert.equal(message.status,'failed');assert.match(message.text,/reserva foi liberada/i);
  }finally{await new Promise(resolve=>f.server.close(resolve));f.db.close();}
});

test('insufficient balance does not create chat messages or a phantom operation',async()=>{
  const f=await fixture();try{
    f.db.prepare('UPDATE vitrine_coin_lots SET amount_atoms=1000').run();
    const run=await f.json('/api/neural/chat/operations/run',{instruction:'Abra https://vitrinecity.com e tire uma captura',idempotencyKey:'lia_browser_test_003',confirmCharge:true},{'x-lia-operations-request':'1'});
    assert.equal(run.status,402);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM neural_chat_messages').get().n,0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM lia_chat_operations').get().n,0);
  }finally{await new Promise(resolve=>f.server.close(resolve));f.db.close();}
});
