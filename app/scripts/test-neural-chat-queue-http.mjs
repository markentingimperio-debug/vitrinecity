import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import express from 'express';
import Database from 'better-sqlite3';
import {createNeuralChatEngine} from '../vitriny-neural/chat-engine.js';
import {mountNeuralChatApi} from '../vitriny-neural/chat-api.js';
import {CHAT_MESSAGE_STATES,isChatActive,assertChatReceipt,assertChatQueueStatus} from '../public/neural-chat-contract.js';

const BASE='/api/admin/vitriny-neural/chat';
const CAPABILITY='support.draft-reply';
const OWNERS=['queue-owner-a','queue-owner-b'];
const nextTurn=()=>new Promise(resolve=>setImmediate(resolve));
async function eventually(check,label){
  const deadline=Date.now()+5000;
  do{const value=await check();if(value)return value;await delay(10);}while(Date.now()<deadline);
  assert.fail('Timed out waiting for '+label);
}

// Real API and engine; only authentication and local inference are fixtures.
// No credentials, environment-derived provider, paid adapter or external URL is
// loaded. Every HTTP request below is restricted to the listening loopback origin.
async function fixture(){
  const db=new Database(':memory:'),app=express(),calls=[],hooks=[],pending=new Set();
  const config={enabled:true,mode:'advisory'};
  const provider={id:'http-local-fixture',modelName:'http-fixture-v1',local:true,capabilities:[CAPABILITY],policy:{enabled:true,allowedCapabilities:[CAPABILITY]}};
  const qualifications={latest:id=>id===provider.id?{modelName:provider.modelName,qualification:{productionEligible:true,allowedCapabilities:[CAPABILITY]}}:null};
  const skills={
    status:()=>({providers:[provider,{...provider,id:'http-paid-denied',local:false}]}),
    invoke:async(capability,input,options)=>{
      assert.equal(capability,CAPABILITY);
      assert.equal(options.localOnly,true);
      assert.equal(options.evaluation,false);
      assert.deepEqual(options.allowedProviders,[provider.id]);
      assert.equal(input.webSearchPerformed,false);
      assert.equal(input.neverSendAutomatically,true);
      const started={type:'started',provider:provider.id,modelName:provider.modelName};
      options.onAttempt(started);hooks.push(started);
      let release;
      const completion=new Promise(resolve=>{release=resolve;});
      const call={message:input.message,options,complete:()=>release({provider:provider.id,output:{model:provider.modelName,text:'Resposta local confirmada: '+input.message}})};
      calls.push(call);pending.add(call);
      try{
        const result=await completion;
        const completed={type:'completed',provider:provider.id,modelName:provider.modelName};
        options.onAttempt(completed);hooks.push(completed);
        return result;
      }finally{pending.delete(call);}
    }
  };
  const chat=createNeuralChatEngine({db,skills,qualifications,config,env:{},queueOptions:{concurrency:1,perScopeConcurrency:1,providerConcurrency:1,pollIntervalMs:100}});
  app.use(express.json({limit:'32kb'}));
  mountNeuralChatApi({app,chat,
    requireAdmin:(req,res,next)=>{const id=req.get('x-test-admin');if(!OWNERS.includes(id))return res.status(401).json({ok:false});req.user={id};next();},
    sameOriginOnly:(req,res,next)=>req.get('origin')==='https://vitrinecity.test'?next():res.status(403).json({ok:false}),
    getAuthorizedStore:(_req,res)=>{res.status(403).json({ok:false});return null;}
  });
  const server=await new Promise(resolve=>{const listening=app.listen(0,'127.0.0.1',()=>resolve(listening));});
  const origin='http://127.0.0.1:'+server.address().port;
  let httpCalls=0;
  async function request(path,{owner=OWNERS[0],method='GET',body}={}){
    const url=new URL(BASE+path,origin);
    assert.equal(url.origin,origin,'HTTP fixture cannot contact another origin');
    assert.equal(url.hostname,'127.0.0.1');
    httpCalls++;
    const response=await fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(5000),headers:{'x-test-admin':owner,...(method==='GET'?{}:{'content-type':'application/json','x-neural-request':'1',origin:'https://vitrinecity.test'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    return {status:response.status,data:await response.json()};
  }
  async function submit(owner,key,message){
    const response=await request('/messages',{owner,method:'POST',body:{message,idempotencyKey:key}});
    assert.equal(response.status,202);
    assert.equal(response.data.ok,true);
    const receipt=assertChatReceipt(response.data);
    assert.equal(receipt.status,'queued');assert.equal(isChatActive(receipt.status),true);
    assert.deepEqual(receipt.queue,{lane:'chat',position:null});
    return {owner,key,message,receipt};
  }
  async function readReceipt(item){
    const response=await request('/requests/'+item.receipt.requestId,{owner:item.owner});
    assert.equal(response.status,200);assert.equal(response.data.ok,true);
    const result=assertChatReceipt(response.data.request);
    assert.equal(result.requestId,item.receipt.requestId);assert.equal(result.conversationId,item.receipt.conversationId);assert.equal(result.messageId,item.receipt.messageId);
    assert.ok(result.updatedAt>=result.createdAt);
    for(const key of ['scope','lease_token','leaseToken','provider_id','lease_owner'])assert.equal(Object.hasOwn(result,key),false,'private durable metadata not exposed: '+key);
    return result;
  }
  async function readStatus(owner){
    const response=await request('/status',{owner});assert.equal(response.status,200);
    assert.equal(response.data.paidGenerationEnabled,false);
    assert.equal(response.data.capabilities.image,false);assert.equal(response.data.capabilities.video,false);
    assertChatQueueStatus(response.data.queue);
    return response.data;
  }
  async function readHistory(item,expected){
    const response=await request('/conversations/'+item.receipt.conversationId,{owner:item.owner});
    assert.equal(response.status,200);assert.equal(response.data.conversation.id,item.receipt.conversationId);
    const messages=response.data.messages;
    assert.equal(messages.length,2);
    for(const message of messages){assert.ok(CHAT_MESSAGE_STATES.includes(message.status));assert.equal(typeof message.text,'string');assert.equal(message.requestId,item.receipt.requestId);assert.ok(Array.isArray(message.attachments));}
    const assistant=messages.find(message=>message.role==='assistant');assert.equal(assistant.status,expected);
    return assistant;
  }
  async function close(){
    chat.close();
    for(const call of pending)call.complete();
    await nextTurn();await nextTurn();
    await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections?.();});
    db.close();
    assert.ok(httpCalls>0);
  }
  return {request,submit,readReceipt,readStatus,readHistory,close,config,calls,hooks};
}

test('real HTTP accepts two owners concurrently, serializes local inference and shares UI receipt contract',async()=>{
  const f=await fixture();
  try{
    const items=await Promise.all([
      f.submit(OWNERS[0],'http-queue-owner-a-001','Olá, explique o pedido da conta A.'),
      f.submit(OWNERS[1],'http-queue-owner-b-001','Olá, explique o pedido da conta B.')
    ]);
    await eventually(()=>f.calls.length===1,'first provider attempt');
    const first=items.find(item=>item.message===f.calls[0].message),second=items.find(item=>item!==first);
    assert.ok(first);assert.ok(second);
    assert.equal((await f.readReceipt(first)).status,'running');await f.readHistory(first,'running');
    assert.equal((await f.readReceipt(second)).status,'queued');await f.readHistory(second,'queued');
    assert.deepEqual((await f.readStatus(first.owner)).queue,{enabled:true,pending:0,running:1,requiresReview:false,unresolved:0});
    assert.deepEqual((await f.readStatus(second.owner)).queue,{enabled:true,pending:1,running:0,requiresReview:false,unresolved:0});
    for(const item of items){
      const otherOwner=OWNERS.find(owner=>owner!==item.owner);
      for(const path of ['/requests/'+item.receipt.requestId,'/requests/by-key/'+item.key,'/conversations/'+item.receipt.conversationId]){
        const response=await f.request(path,{owner:otherOwner});assert.equal(response.status,404);assert.equal(response.data.code,'chat_not_found');
      }
      const recovered=await f.request('/requests/by-key/'+item.key,{owner:item.owner});
      assert.equal(recovered.status,200);assert.equal(assertChatReceipt(recovered.data.request).requestId,item.receipt.requestId);
    }
    assert.equal(f.calls.length,1,'GET receipt/history/recovery never starts a second provider while occupied');
    f.calls[0].complete();
    await eventually(async()=>((await f.readReceipt(first)).status==='completed'),'first completed HTTP receipt');
    await eventually(()=>f.calls.length===2,'second provider attempt after first settled');
    assert.equal(f.calls[1].message,second.message);assert.equal((await f.readReceipt(second)).status,'running');
    f.calls[1].complete();
    await eventually(async()=>((await f.readReceipt(second)).status==='completed'),'second completed HTTP receipt');
    for(const item of items){
      const assistant=await f.readHistory(item,'completed');assert.equal(assistant.text,'Resposta local confirmada: '+item.message);
      assert.deepEqual((await f.readStatus(item.owner)).queue,{enabled:true,pending:0,running:0,requiresReview:false,unresolved:0});
    }
    assert.deepEqual(f.hooks.map(event=>event.type),['started','completed','started','completed']);
    assert.equal(f.calls.length,2);
  }finally{await f.close();}
});

test('real HTTP queued cancellation is owner-scoped and does not invoke the cancelled provider job',async()=>{
  const f=await fixture();
  try{
    const running=await f.submit(OWNERS[0],'http-cancel-running-001','Olá, mantenha o primeiro pedido ocupado.');
    await eventually(()=>f.calls.length===1,'occupied local provider');
    const queued=await f.submit(OWNERS[1],'http-cancel-queued-001','Olá, este pedido será cancelado antes de começar.');
    assert.equal((await f.readReceipt(queued)).status,'queued');
    const forbidden=await f.request('/requests/'+queued.receipt.requestId+'/cancel',{owner:running.owner,method:'POST',body:{}});
    assert.equal(forbidden.status,404);assert.equal((await f.readReceipt(queued)).status,'queued');
    for(let count=0;count<2;count++){
      const response=await f.request('/requests/'+queued.receipt.requestId+'/cancel',{owner:queued.owner,method:'POST',body:{}});
      assert.equal(response.status,200);const cancelled=assertChatReceipt(response.data);
      assert.equal(cancelled.requestId,queued.receipt.requestId);assert.equal(cancelled.status,'cancelled');assert.equal(isChatActive(cancelled.status),false);
    }
    await f.readHistory(queued,'cancelled');
    f.calls[0].complete();
    await eventually(async()=>((await f.readReceipt(running)).status==='completed'),'occupant finishes after queued cancellation');
    const recovered=await f.request('/requests/by-key/'+queued.key,{owner:queued.owner});
    assert.equal(assertChatReceipt(recovered.data.request).status,'cancelled');
    assert.equal(f.calls.length,1);assert.equal(f.calls.some(call=>call.message===queued.message),false);
    assert.deepEqual(f.hooks.map(event=>event.type),['started','completed']);
    assert.deepEqual((await f.readStatus(queued.owner)).queue,{enabled:true,pending:0,running:0,requiresReview:false,unresolved:0});
  }finally{await f.close();}
});

test('real HTTP shadow pause before queued claim prevents dispatch and reports private readiness/review honestly',async()=>{
  const f=await fixture();
  try{
    const running=await f.submit(OWNERS[0],'http-shadow-running-001','Olá, ocupe o modelo durante a conferência.');
    await eventually(()=>f.calls.length===1,'provider occupied before pause');
    const queued=await f.submit(OWNERS[1],'http-shadow-queued-001','Olá, não inicie este pedido depois da pausa.');
    assert.equal((await f.readReceipt(queued)).status,'queued');
    f.config.mode='shadow';
    const paused=await f.readStatus(queued.owner);
    assert.equal(paused.capabilities.text,false);assert.equal(paused.queue.enabled,false);
    assert.equal(paused.queue.requiresReview,false,'another account transport is not exposed as this owner review');
    assert.equal((await f.readReceipt(queued)).status,'unavailable');await f.readHistory(queued,'unavailable');
    assert.equal((await f.readReceipt(running)).status,'interrupted');
    assert.equal(f.calls[0].options.signal.aborted,true);
    const ownerStatus=await f.readStatus(running.owner);
    assert.equal(ownerStatus.queue.requiresReview,true);assert.equal(ownerStatus.queue.unresolved,1);
    assert.equal(f.calls.length,1,'queued item never invokes inference after shadow pause');
    f.calls[0].complete();
    await eventually(async()=>!(await f.readStatus(running.owner)).queue.requiresReview,'actual response proof releases only the old hold');
    assert.equal((await f.readReceipt(running)).status,'interrupted','late response cannot turn interrupted history into success');
    assert.equal((await f.readReceipt(queued)).status,'unavailable');
    assert.equal(f.calls.length,1);assert.equal(f.calls.some(call=>call.message===queued.message),false);
    assert.deepEqual(f.hooks.map(event=>event.type),['started','completed']);
  }finally{await f.close();}
});
