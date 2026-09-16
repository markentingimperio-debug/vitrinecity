import assert from 'node:assert/strict';
import {test,afterEach} from 'node:test';
import Database from 'better-sqlite3';
import {createNeuralChatEngine} from '../vitriny-neural/chat-engine.js';
const caps=['support.draft-reply','growth.content-plan','research.summarize','code.plan'];
const opened=[];
afterEach(()=>{for(const f of opened.splice(0)){f.chat.close();if(f.db.open)f.db.close();}});
function fixture({answer='Resposta local completa.',qualified=true,env={},throwTransport=false,finishReason='stop',respond=null,quoteFails=false}={}){
 const db=new Database(':memory:'),quotes=new Map(),calls=[],paidCalls=[];
 db.exec('CREATE TABLE preservation_probe(id INTEGER PRIMARY KEY,knowledge TEXT); INSERT INTO preservation_probe VALUES(1,\'memoria anterior\')');
 const provider={id:'local-fixture',modelName:'fixture-v1',local:true,policy:{enabled:true,allowedCapabilities:caps},capabilities:caps};
 const paid={enabled:true,prefersText:true,setScopeAuthorizer(){},status:()=>({capabilities:{chat:true,image:true,video:true}}),
  prepare(scope,input){if(quoteFails)throw Error('quote unavailable');const quote={scope,kind:input.kind,quoteId:'quote-'+input.requestId,amountMicro:5,currency:'BRL',state:'quoted'};quotes.set(input.requestId,quote);return quote;},
  owns:(scope,id)=>quotes.get(id)?.scope===scope,payment:(_scope,id)=>quotes.get(id),artifacts:()=>[],close(){},
  confirm(...args){paidCalls.push(args);},wait:async()=>{}};
 const chat=createNeuralChatEngine({db,config:{enabled:true,mode:'advisory'},env:{LIA_LOCAL_FIRST_ADMIN:'1',VITRINY_NEURAL_CHAT_STORES:'shop-a',VITRINE_COINS_ENABLED:'true',...env},paidRuntime:paid,
  qualifications:{latest:()=>qualified?{modelName:provider.modelName,qualification:{productionEligible:true,allowedCapabilities:caps}}:null},
  skills:{status:()=>({providers:[provider]}),invoke:async(capability,input,options)=>{
   options.onAttempt({type:'started',provider:provider.id,modelName:provider.modelName});calls.push({capability,input,options});
   if(throwTransport)throw Error('transport unknown');
   const result=respond?await respond():{provider:provider.id,output:{model:provider.modelName,text:answer,finishReason}};
   options.onAttempt({type:'completed',provider:provider.id,modelName:provider.modelName});return result;
  }}});
 const f={db,chat,quotes,calls,paidCalls};opened.push(f);return f;
}
const request=(f,message='Escreva um texto sobre jardinagem.',key='request-local-first-001',scope='admin:1',extra={})=>f.chat.submit(scope,{message,idempotencyKey:key,...extra});
const settle=async(f,r)=>{await f.chat.wait(r.requestId);await new Promise(r=>setImmediate(r));};
test('admin local-first does not request paid quote when local succeeds',async()=>{const f=fixture(),r=request(f);await settle(f,r);assert.equal(f.chat.request('admin:1',r.requestId).status,'completed');assert.equal(f.calls.length,1);assert.equal(f.quotes.size,0);assert.equal(f.paidCalls.length,0);assert.equal(f.calls[0].options.localOnly,true);});
test('explicit local insufficiency creates exactly one NEW quote and no paid dispatch',async()=>{const f=fixture({answer:'[LIA_PRECISA_API] Faltam informacoes.'}),r=request(f);await settle(f,r);const rows=f.db.prepare('SELECT * FROM neural_chat_requests ORDER BY rowid').all();assert.equal(rows.length,2);assert.notEqual(rows[0].id,rows[1].id);assert.equal(rows[0].status,'unavailable');assert.equal(rows[1].status,'awaiting_confirmation');assert.equal(f.quotes.size,1);assert.equal(f.paidCalls.length,0);assert.equal(f.calls.length,1);assert.equal(rows[0].conversation_id,rows[1].conversation_id);});
test('confirmed incomplete response can only OFFER existing paid quote',async()=>{const f=fixture({answer:'Texto incompleto...',finishReason:'length'}),r=request(f);await settle(f,r);assert.equal(f.quotes.size,1);assert.equal(f.paidCalls.length,0);assert.equal(f.chat.request('admin:1',r.requestId).status,'failed');});
test('idempotent retry never creates another quote',async()=>{const f=fixture({answer:'[LIA_PRECISA_API] Preciso de apoio.'}),r=request(f);await settle(f,r);const duplicate=request(f);assert.equal(duplicate.requestId,r.requestId);assert.equal(f.quotes.size,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM neural_chat_requests').get().n,2);});
test('Kling image and video use original paid prepare, never local generation',async()=>{const f=fixture();for(const [i,message]of ['Crie uma imagem de uma planta.','Gere um vídeo de chuva.'].entries()){const r=request(f,message,'request-media-preserved-'+i);assert.equal(r.status,'awaiting_confirmation');assert.equal(r.payment.kind,i===0?'image':'video');}assert.equal(f.quotes.size,2);assert.equal(f.calls.length,0);assert.equal(f.paidCalls.length,0);});
test('user and store paid-primary preferences stay unchanged',()=>{const f=fixture();for(const [i,scope]of ['store:shop-a','user:7'].entries()){const r=request(f,undefined,'request-scope-preserve-'+i,scope);assert.equal(r.status,'awaiting_confirmation');}assert.equal(f.quotes.size,2);assert.equal(f.calls.length,0);});
test('missing local model uses the existing paid quote',()=>{const f=fixture({qualified:false}),r=request(f);assert.equal(r.status,'awaiting_confirmation');assert.equal(f.calls.length,0);assert.equal(f.paidCalls.length,0);});
test('feature flag off preserves original administrative paid preference',()=>{const f=fixture({env:{LIA_LOCAL_FIRST_ADMIN:'0'}}),r=request(f);assert.equal(r.status,'awaiting_confirmation');assert.equal(f.calls.length,0);});
test('unknown transport failure never escalates automatically',async()=>{const f=fixture({throwTransport:true}),r=request(f);await settle(f,r);assert.equal(f.quotes.size,0);assert.equal(f.paidCalls.length,0);});
test('cancelled local response never offers paid work',async()=>{let release;const f=fixture({respond:()=>new Promise(resolve=>release=()=>resolve({provider:'local-fixture',output:{model:'fixture-v1',text:'[LIA_PRECISA_API] Ajuda.'}}))}),r=request(f);await new Promise(resolve=>setImmediate(resolve));f.chat.cancel('admin:1',r.requestId);release();await settle(f,r);assert.equal(f.quotes.size,0);assert.equal(f.chat.request('admin:1',r.requestId).status,'cancelled');});
test('quote failure rolls back the extra messages and preserves previous data',async()=>{const f=fixture({quoteFails:true,answer:'[LIA_PRECISA_API] Ajuda.'}),r=request(f);await settle(f,r);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM neural_chat_requests').get().n,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM neural_chat_messages').get().n,2);assert.equal(f.db.prepare('SELECT knowledge FROM preservation_probe WHERE id=1').get().knowledge,'memoria anterior');assert.equal(f.paidCalls.length,0);});
test('client cannot request force fallback or change internal feature settings',()=>{const f=fixture();assert.throws(()=>request(f,undefined,undefined,'admin:1',{apiFallback:true}),{code:'chat_input_invalid'});assert.equal(f.quotes.size,0);});
