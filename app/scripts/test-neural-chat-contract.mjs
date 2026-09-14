import assert from 'node:assert/strict';
import {test} from 'node:test';
import Database from 'better-sqlite3';
import {CHAT_MESSAGE_STATES,CHAT_ACTIVE_STATES,isChatActive,isChatPending,assertChatReceipt,assertChatQueueStatus,assertChatPayment,assertChatWallet,assertChatArtifact,assertAiPurchaseStatus,assertAiPurchaseOrder} from '../public/neural-chat-contract.js';
import {createNeuralChatEngine} from '../vitriny-neural/chat-engine.js';

test('private chat canonical contract accepts every supported lifecycle and rejects unknown states',()=>{
  const receipt={id:'opaque-id',requestId:'opaque-id',conversationId:'opaque-conversation',messageId:'opaque-message',createdAt:0,updatedAt:1};
  for(const status of CHAT_MESSAGE_STATES){
    assert.equal(assertChatReceipt({...receipt,status,...(status==='awaiting_confirmation'?{payment:{quoteId:'quote-test',currency:'BRL',amountMicro:1000000,expiresAt:100,kind:'video',summary:'Vídeo de teste',state:'quoted',chargedMicro:null}}:{})}).status,status);
    assert.equal(isChatActive(status),CHAT_ACTIVE_STATES.includes(status));
  }
  assert.equal(isChatActive('completed'),false);
  assert.equal(isChatActive('provider_state_not_validated'),false);
  for(const change of [{status:'unknown'},{id:42},{id:'another-request'},{createdAt:NaN},{updatedAt:-1},{queue:{lane:'unapproved',position:1}},{queue:{lane:'chat',position:0}},{queue:{lane:'video',position:1.2}}]){
    assert.throws(()=>assertChatReceipt({...receipt,status:'queued',...change}));
  }
  assertChatReceipt({...receipt,status:'queued',queue:{lane:'chat',position:1}});
  assertChatReceipt({...receipt,status:'running',queue:{lane:'chat',position:null}});
  assertChatQueueStatus({enabled:true,pending:2,running:1,requiresReview:false,unresolved:0});
  assertChatQueueStatus({enabled:true,pending:1,running:0,requiresReview:true,unresolved:1});
  assert.throws(()=>assertChatQueueStatus({enabled:true,pending:0,running:0,requiresReview:false,unresolved:1}));
  assert.throws(()=>assertChatQueueStatus({enabled:true,pending:-1,running:0,requiresReview:false,unresolved:0}));
});

test('paid quote, owner wallet and private output metadata are fail-closed additive fields',()=>{
  const payment={quoteId:'quote-test',currency:'BRL',amountMicro:1000000,expiresAt:100,kind:'video',summary:'Vídeo de teste',state:'quoted',chargedMicro:null};
  assert.equal(assertChatPayment(payment),payment);assert.ok(isChatPending('awaiting_confirmation'));assert.equal(isChatActive('awaiting_confirmation'),false);
  for(const invalid of [{amountMicro:0},{amountMicro:NaN},{chargedMicro:0},{state:'settled'},{expiresAt:-1},{currency:'USD'},{summary:''}])assert.throws(()=>assertChatPayment({...payment,...invalid}));
  assertChatPayment({...payment,state:'settled',chargedMicro:900000});
  assertChatWallet({currency:'BRL',availableMicro:0,reservedMicro:1000000});
  assert.throws(()=>assertChatWallet({currency:'BRL',availableMicro:-1,reservedMicro:0}));
  const artifact={id:'artifact-1',requestId:'request-1',kind:'video',name:'video.mp4',mimeType:'video/mp4',bytes:100,durationSeconds:5,availability:'ready'};
  assert.equal(assertChatArtifact(artifact),artifact);
  for(const change of [{url:'https://evil.example/video.mp4'},{name:'../video.mp4'},{mimeType:'text/html'},{bytes:64*1024*1024+1},{availability:'pending'},{durationSeconds:-1}])assert.throws(()=>assertChatArtifact({...artifact,...change}));
});

test('credit purchases accept only official checkout links, exact presets and versioned terms',()=>{
  const order={reference:'ai_55555555-5555-4555-8555-555555555555',status:'pending',amountCents:1000,checkoutUrl:'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=fixture',createdAt:1,expiresAt:100};
  assertAiPurchaseOrder(order);
  for(const url of ['http://www.mercadopago.com.br','https://mercadopago.com.br.evil.test','https://mercadopago.com.br@evil.test','javascript:alert(1)','https://www.mercadopago.com.br:8443'])assert.throws(()=>assertAiPurchaseOrder({...order,checkoutUrl:url}));
  assert.throws(()=>assertAiPurchaseOrder({...order,status:'approved'}));
  assertAiPurchaseOrder({...order,status:'approved',checkoutUrl:null});
  const status={currency:'BRL',availableMicro:0,reservedMicro:0,chargedMicro:0,expiredMicro:0,frozenMicro:0,frozen:false,canPurchase:true,presetsCents:[1000,2500,5000,10000],terms:{version:'2026-09-14-ai-prepaid-15-v1',validityDays:60,summary:'Créditos de IA',refunds:'Direitos preservados'},orders:[order]};
  assertAiPurchaseStatus(status);
  assert.throws(()=>assertAiPurchaseStatus({...status,presetsCents:[100]}));
  assert.throws(()=>assertAiPurchaseStatus({...status,terms:{...status.terms,validityDays:10}}));
});

test('real private-chat receipts, recovery and unavailable messages conform without a paid API',async()=>{
  const db=new Database(':memory:');
  const chat=createNeuralChatEngine({db,config:{enabled:true,mode:'shadow'},env:{},
    qualifications:{latest:()=>null},skills:{status:()=>({providers:[]}),invoke:()=>{throw Error('Network must not run');}}});
  try{
    const input={message:'Olá, Lia.',idempotencyKey:'contract-check-20260914'};
    const accepted=chat.submit('admin:contract',input);
    assertChatReceipt(accepted);assert.equal(accepted.status,'unavailable');
    assertChatReceipt(chat.request('admin:contract',accepted.requestId));
    assertChatReceipt(chat.requestByKey('admin:contract',input.idempotencyKey));
    assertChatReceipt(chat.submit('admin:contract',input));
    const history=chat.conversation('admin:contract',accepted.conversationId);
    assert.ok(history.messages.every(m=>CHAT_MESSAGE_STATES.includes(m.status)));
    const status=chat.status('admin:contract');
    if(status.queue!==undefined)assertChatQueueStatus(status.queue);
    assert.equal(status.paidGenerationEnabled,false);
  }finally{await chat.close?.();db.close();}
});
