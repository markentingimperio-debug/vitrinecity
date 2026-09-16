import assert from 'node:assert/strict';
import {test} from 'node:test';
import express from 'express';
import Database from 'better-sqlite3';
import {createNeuralChatEngine} from '../vitriny-neural/chat-engine.js';
import {mountNeuralChatApi} from '../vitriny-neural/chat-api.js';

test('chat API authenticates each owner, protects writes, stores private attachments and recovers requests',async()=>{
  const db=new Database(':memory:'),calls=[],app=express();
  const chat=createNeuralChatEngine({db,config:{enabled:true,mode:'advisory'},qualifications:{latest:()=>null},skills:{status:()=>({providers:[]}),invoke:()=>{throw Error('Must not call');}},env:{VITRINY_NEURAL_TASKS_STORES:'a,b'}});
  app.use(express.json({limit:'5mb'}));
  mountNeuralChatApi({app,chat,
    requireAdmin:(req,res,next)=>{if(!req.get('x-test-admin'))return res.status(401).end();req.user={id:req.get('x-test-admin')};next();},
    sameOriginOnly:(req,res,next)=>req.get('origin')==='https://vitrinecity.test'?next():res.status(403).end(),
    getAuthorizedStore:(req,res)=>{calls.push(req.params.reference);if(req.get('x-store-token')!==`store-${req.params.reference}`){res.status(403).end();return null;}return {storeReference:req.params.reference};}});
  const server=await new Promise(resolve=>{const listening=app.listen(0,'127.0.0.1',()=>resolve(listening));});
  const base='/api/admin/vitriny-neural/chat',origin=`http://127.0.0.1:${server.address().port}`;
  const request=(path='',{method='GET',body,headers={},admin='1'}={})=>fetch(origin+base+path,{method,headers:{...(admin?{'x-test-admin':admin}:{}),...(method!=='GET'?{'content-type':'application/json','x-neural-request':'1',origin:'https://vitrinecity.test'}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  try{
    assert.equal((await request('/status',{admin:null})).status,401);
    assert.equal((await request('/status',{admin:'../no'})).status,403);
    assert.equal((await request('/attachments',{method:'POST',body:{},headers:{'x-neural-request':''}})).status,403);
    assert.equal((await request('/attachments',{method:'POST',body:{},headers:{origin:'https://foreign.test'}})).status,403);
    const uploaded=await request('/attachments',{method:'POST',body:{name:'contexto.txt',mimeType:'text/plain',dataBase64:Buffer.from('Texto de referência privado.').toString('base64')}});
    assert.equal(uploaded.status,201);const attachment=(await uploaded.json()).attachment;
    assert.equal((await request('/attachments/'+attachment.id,{admin:'2'})).status,404);
    const downloaded=await request('/attachments/'+attachment.id);
    assert.equal(downloaded.headers.get('cache-control'),'no-store');assert.equal(downloaded.headers.get('x-content-type-options'),'nosniff');assert.match(downloaded.headers.get('content-security-policy'),/sandbox/);assert.equal(await downloaded.text(),'Texto de referência privado.');
    const accepted=await request('/messages',{method:'POST',body:{message:'Resuma este documento.',attachmentIds:[attachment.id],idempotencyKey:'request-http-test-001'}});
    assert.equal(accepted.status,202);const submitted=await accepted.json();assert.equal(submitted.ok,true);assert.equal(submitted.status,'unavailable');
    const saved=await request('/conversations/'+submitted.conversationId);const data=await saved.json();assert.equal(data.messages.length,2);assert.equal(data.messages[0].attachments[0].id,attachment.id);
    assert.equal((await request('/conversations/'+submitted.conversationId,{admin:'2'})).status,404);
    assert.equal((await request('/requests/by-key/request-http-test-001',{admin:'2'})).status,404);
    assert.equal((await (await request('/requests/by-key/request-http-test-001')).json()).request.id,submitted.requestId);
    assert.equal((await request('/messages',{method:'POST',body:{message:'Teste seguro.',idempotencyKey:'request-http-forged',scope:'admin:2'}})).status,400);
    const storeBase=origin+'/api/store-portal/a/neural/chat';
    assert.equal((await fetch(storeBase+'/status')).status,403);
    const store=await fetch(storeBase+'/status',{headers:{'x-store-token':'store-a'}});assert.equal(store.status,200);assert.ok(calls.includes('a'));
    assert.equal((await fetch(storeBase+'/attachments/'+attachment.id,{headers:{'x-store-token':'store-a'}})).status,404);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
