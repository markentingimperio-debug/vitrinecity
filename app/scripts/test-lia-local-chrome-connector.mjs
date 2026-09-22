import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import express from 'express';
import Database from 'better-sqlite3';
import {createLocalBrowserPlan,validateLocalBrowserResult} from '../vitriny-neural/local-browser-connector.js';
import {referenceMediaKind} from '../public/neural-reference-media.js';
import {setupLiaChatOperations} from '../vitriny-neural/lia-chat-operations.js';

const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const connectorRoot=path.resolve(appRoot,'..','ops','lia-chrome-connector');
const manifest=JSON.parse(fs.readFileSync(path.join(connectorRoot,'manifest.json'),'utf8'));
const background=await import(pathToFileURL(path.join(connectorRoot,'background.js')));

test('plano local entende erro ortográfico e reprodução no YouTube',()=>{
  const plan=createLocalBrowserPlan('acesa o youtub e colca uma musica eletronica pra toca');
  assert.equal(new URL(plan.url).hostname,'www.youtube.com');
  assert.equal(new URL(plan.url).searchParams.get('search_query'),'musica eletronica');
  assert.equal(plan.playback,true);
});

test('plano local bloqueia IP e rede local',()=>{
  for(const input of ['abra https://127.0.0.1/admin','abra https://router.local/']){
    assert.throws(()=>createLocalBrowserPlan(input));
  }
});

test('confirmação de reprodução exige vídeo avançando no YouTube',()=>{
  const plan=createLocalBrowserPlan('abra o youtube e toque musica eletrônica');
  const valid=validateLocalBrowserResult(plan,{connector:'lia-chrome-connector-v1',finalUrl:'https://www.youtube.com/watch?v=abc123',title:'Música eletrônica',playing:true,audible:true,adShowing:false,currentTime:2.4});
  assert.equal(valid.playing,true);
  assert.throws(()=>validateLocalBrowserResult(plan,{connector:'lia-chrome-connector-v1',finalUrl:'https://www.youtube.com/watch?v=abc123',title:'Música eletrônica',playing:false,audible:true,adShowing:false,currentTime:0}));
  assert.throws(()=>validateLocalBrowserResult(plan,{connector:'lia-chrome-connector-v1',finalUrl:'https://www.youtube.com/watch?v=abc123',title:'Anúncio',playing:true,audible:true,adShowing:true,currentTime:2}));
  assert.throws(()=>validateLocalBrowserResult(plan,{connector:'lia-chrome-connector-v1',finalUrl:'https://www.youtube.com/watch?v=abc123',title:'Sem som',playing:true,audible:false,adShowing:false,currentTime:2}));
  assert.throws(()=>validateLocalBrowserResult(plan,{connector:'lia-chrome-connector-v1',finalUrl:'https://example.com/',title:'Página',playing:true,audible:true,adShowing:false,currentTime:2}));
});

test('conector limita origem, permissões e destinos',()=>{
  assert.equal(manifest.manifest_version,3);
  assert.deepEqual(manifest.content_scripts[0].matches,['https://vitrinecity.com/*','https://www.vitrinecity.com/*']);
  assert.deepEqual(manifest.permissions,['tabs','scripting']);
  assert.equal(background.safeTarget({url:'https://www.youtube.com/results?search_query=jazz',playback:true}).playback,true);
  assert.throws(()=>background.safeTarget({url:'https://192.168.1.1/',playback:false}));
  assert.throws(()=>background.safeTarget({url:'https://admin.internal/',playback:false}));
  assert.throws(()=>background.safeTarget({url:'http://example.com/',playback:false}));
});

test('painel prefere o conector e mantém confirmação no servidor',()=>{
  const source=fs.readFileSync(path.join(appRoot,'public','neural-workspace.js'),'utf8');
  for(const marker of ["connectorCall('ping'","/local/start","connectorCall('execute'","/local/complete","/local/uncertain"])assert.match(source,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.ok(source.indexOf("/local/start")<source.indexOf("connectorCall('execute'"));
  assert.ok(source.indexOf("connectorCall('execute'")<source.indexOf("/local/complete"));
});

test('imagem de referência não é confundida com redimensionamento determinístico',()=>{
  assert.equal(referenceMediaKind('use esta imagem e crie uma nova capa'),'image-reference');
  assert.equal(referenceMediaKind('redimensione esta imagem para 1080x1920'),'');
});

test('servidor reserva, recebe prova local e conclui uma única vez sem chamar a VPS',async t=>{
  const db=new Database(':memory:');t.after(()=>db.close());
  db.exec(`CREATE TABLE neural_chat_conversations(id TEXT PRIMARY KEY,scope TEXT NOT NULL,title TEXT,created_at INTEGER,updated_at INTEGER);
    CREATE TABLE neural_chat_messages(id TEXT PRIMARY KEY,conversation_id TEXT,request_id TEXT,role TEXT,text TEXT,status TEXT,sequence INTEGER,created_at INTEGER);`);
  const reserved=new Map(),settled=new Map();
  const wallet={enabled:true,status:()=>({availableAtoms:'999999999',reservedAtoms:'0',frozen:false}),
    reserve(_user,{requestId,maximumAtoms}){reserved.set(requestId,maximumAtoms);return{state:'reserved'};},
    settle(_user,requestId,{actualAtoms,receiptId}){if(settled.has(requestId))return settled.get(requestId);const value={state:'settled',actualAtoms,receiptId};settled.set(requestId,value);return value;}};
  let remoteCalls=0;const app=express();app.use(express.json());
  setupLiaChatOperations({app,db,coinWallet:wallet,requireUser:(req,_res,next)=>{req.user={id:1};next();},sameOriginOnly:(_req,_res,next)=>next(),
    env:{LIA_CHAT_OPERATIONS_ENABLED:'0',LIA_OPERATIONS_URL:'https://lia.invalid',LIA_OPERATIONS_TOKEN:'x'.repeat(32)},fetchImpl:async()=>{remoteCalls++;throw Error('unexpected_remote_call');}});
  const server=await new Promise(resolve=>{const value=app.listen(0,()=>resolve(value));});t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}/api/neural/chat/operations`;
  const post=async(path,body)=>{const response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-lia-operations-request':'1'},body:JSON.stringify(body)});return{status:response.status,body:await response.json()};};
  const consent=await post('/consent',{version:'lia-auto-credits-20260922-v1',enabled:true});assert.equal(consent.status,200);
  const quote=await post('/quote',{instruction:'acesa o youtub e colca jazz pra toca',mimeType:'',localConnector:true});assert.equal(quote.body.item.supported,true);
  const key='local-browser-test-0001';
  const started=await post('/local/start',{instruction:'acesa o youtub e colca jazz pra toca',idempotencyKey:key,autoDebit:true});
  assert.equal(started.status,201);assert.equal(started.body.target.playback,true);assert.equal(remoteCalls,0);
  const completed=await post('/local/complete',{operationId:started.body.operationId,idempotencyKey:key,result:{connector:'lia-chrome-connector-v1',finalUrl:'https://www.youtube.com/watch?v=abc123',title:'Jazz instrumental',playing:true,audible:true,adShowing:false,currentTime:3.2}});
  assert.equal(completed.status,201);assert.equal(remoteCalls,0);assert.equal(settled.size,1);
  const row=db.prepare('SELECT status,error,result_json FROM lia_chat_operations WHERE id=?').get(started.body.operationId);
  assert.equal(row.status,'completed');assert.equal(row.error,'');assert.equal(JSON.parse(row.result_json).executor,'lia-chrome-connector-v1');
  assert.match(db.prepare("SELECT text FROM neural_chat_messages WHERE request_id=? AND role='assistant'").get(started.body.operationId).text,/Reprodução confirmada/);
  const duplicate=await post('/local/complete',{operationId:started.body.operationId,idempotencyKey:key,result:{}});
  assert.equal(duplicate.status,200);assert.equal(duplicate.body.duplicate,true);assert.equal(settled.size,1);
});
