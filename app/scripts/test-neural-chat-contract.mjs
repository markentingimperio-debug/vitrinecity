import assert from 'node:assert/strict';
import {test} from 'node:test';
import Database from 'better-sqlite3';
import {CHAT_MESSAGE_STATES,CHAT_ACTIVE_STATES,isChatActive,assertChatReceipt,assertChatQueueStatus} from '../public/neural-chat-contract.js';
import {createNeuralChatEngine} from '../vitriny-neural/chat-engine.js';

test('private chat canonical contract accepts every supported lifecycle and rejects unknown states',()=>{
  const receipt={id:'opaque-id',requestId:'opaque-id',conversationId:'opaque-conversation',messageId:'opaque-message',createdAt:0,updatedAt:1};
  for(const status of CHAT_MESSAGE_STATES){
    assert.equal(assertChatReceipt({...receipt,status}).status,status);
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
