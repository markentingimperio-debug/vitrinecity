import test from 'node:test';
import assert from 'node:assert/strict';
import {parseServiceReply,validateServiceReply,serviceReplyFromResponse} from '../service-reply-format.js';

const good='Olá! Posso ajudar com isso. Você pode me contar qual é a sua dúvida?';
const json=JSON.stringify({reply:good});
const invalid=fn=>assert.throws(fn,error=>error.code==='invalid_service_reply'&&!error.message.includes('PRIVATE_MARKER'));

test('accepts only a complete single-property JSON object, optionally inside one whole JSON fence',()=>{
  assert.equal(parseServiceReply(json),good);assert.equal(parseServiceReply('  '+json+'\n'),good);
  assert.equal(parseServiceReply('```json\n'+json+'\n```'),good);assert.equal(parseServiceReply('```\n'+json+'\n```'),good);
  assert.equal(parseServiceReply(JSON.stringify({reply:'Você pode dizer "quero ajuda".\nVamos conferir juntos.'})),'Você pode dizer "quero ajuda".\nVamos conferir juntos.');
  for(const raw of [good,'Aqui está: '+json,json+' Obrigado!',json+json,'[]','null','"reply"','{}','{"reply":null}','{"reply":1}','{"reply":[]}','{"reply":"Oi","analysis":"PRIVATE_MARKER"}','{"reply":"Oi","reply":"Outra"}','```json\n'+json+'\n```\nPRIVATE_MARKER','{"reply":"Oi"',{},undefined])invalid(()=>parseServiceReply(raw));
});

test('rejects reasoning and technical content whether plain, fenced, JSON wrapped or obfuscated',()=>{
  for(const reply of ["Here's a thinking process: PRIVATE_MARKER",'Analysis: PRIVATE_MARKER','<think>PRIVATE_MARKER</think>Olá!','I think the user wants a link.','The user asked about this product.','System prompt: PRIVATE_MARKER','Raciocínio: devo responder em português.','Análise:\nVou pensar antes.','Preciso responder ao usuário com educação.','```json\n{"reply":"Oi"}\n```','{"reply":"Olá"}','ｔｈｉｎｋ: PRIVATE_MARKER','ana\u200blysis: PRIVATE_MARKER','Olá!\x00PRIVATE_MARKER']){
    invalid(()=>validateServiceReply(reply));invalid(()=>parseServiceReply(JSON.stringify({reply})));
  }
});

test('never truncates an oversized or missing response into something that could be sent',()=>{
  assert.equal(parseServiceReply(JSON.stringify({reply:'á'.repeat(600)})).length,600);
  assert.equal(Array.from(parseServiceReply(JSON.stringify({reply:'🌿'.repeat(600)}))).length,600);
  for(const reply of ['á'.repeat(601),'🌿'.repeat(601),'','  \n  ',false,null])invalid(()=>parseServiceReply(JSON.stringify({reply})));
  invalid(()=>parseServiceReply(' '.repeat(8193)+json));
});

test('legitimate Portuguese customer replies including links, analysis of soil and courtesy remain valid',()=>{
  for(const reply of ['Bom dia! Obrigado por entrar em contato.','Podemos encaminhar seu pedido para análise de solo.','Receita disponível aqui: https://vitrinecity.com/artigo/bolo','Olá!\nEm qual etapa você precisa de ajuda?','Seu comentário ajuda a melhorar nosso atendimento.'])assert.equal(validateServiceReply(reply),reply);
});

test('Responses API selects only completed assistant final content, never reasoning or tool outputs',()=>{
  const result={status:'completed',output:[{type:'reasoning',summary:[{text:'PRIVATE_MARKER'}],content:[{type:'output_text',text:'PRIVATE_MARKER'}]},{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:json}]}]};
  assert.equal(serviceReplyFromResponse(result),good);
  for(const payload of [{...result,status:'incomplete'},{...result,output:[result.output[0]]},{...result,output:[result.output[1],result.output[1]]},{...result,output:[{...result.output[1],status:'in_progress'}]},{...result,output:[{...result.output[1],role:'tool'}]},{...result,output:[{...result.output[1],content:[{type:'refusal',refusal:'No'}]}]},{...result,output:[{type:'function_call',name:'x'},result.output[1]]}])invalid(()=>serviceReplyFromResponse(payload));
});

test('chat final content excludes provider reasoning fields and rejects truncated or ambiguous choices',()=>{
  const choice={finish_reason:'stop',message:{role:'assistant',content:json,reasoning:'PRIVATE_MARKER',reasoning_details:[{text:'PRIVATE_MARKER'}]}};
  assert.equal(serviceReplyFromResponse({choices:[choice]}),good);assert.equal(serviceReplyFromResponse({output_text:json}),good);
  assert.equal(serviceReplyFromResponse({choices:[{...choice,message:{role:'assistant',content:[{type:'text',text:json}]}}]}),good);
  for(const payload of [{choices:[{...choice,finish_reason:'length'}]},{choices:[choice,choice]},{choices:[{message:{role:'assistant',reasoning:json}}]},{choices:[{...choice,message:{...choice.message,tool_calls:[{}]}}]},{choices:[{...choice,message:{...choice.message,content:'PRIVATE_MARKER'}}]},{choices:[{...choice,message:{...choice.message,content:[{type:'reasoning',text:json}]}}]},{reasoning:json},null])invalid(()=>serviceReplyFromResponse(payload));
});
