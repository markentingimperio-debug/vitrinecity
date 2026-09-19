import assert from 'node:assert/strict';
import {test,afterEach} from 'node:test';
import Database from 'better-sqlite3';
import {createNeuralChatEngine, routeChatIntent} from '../vitriny-neural/chat-engine.js';
import {createOpenAICompatibleProvider} from '../vitriny-neural/providers/openai-compatible.js';

const capabilities=['support.draft-reply','support.summarize','growth.content-plan','growth.campaign-plan','growth.seo-plan','growth.diagnose','code.plan','research.verify','research.summarize','commerce.seller-diagnose','ranking.evaluate'];
const fixtures=[];afterEach(()=>{for(const fixture of fixtures.splice(0))fixture.chat.close();});
function fixture({respond,qualified=true,config={enabled:true,mode:'advisory'},now=Date.now,timeoutMs,queueOptions,env={},paidRuntime=null,db=new Database(':memory:')}={}){
  const calls=[];
  const provider={id:'local-fixture',modelName:'fixture-v1',local:true,policy:{enabled:true,allowedCapabilities:capabilities},capabilities};
  const qualifications={latest:()=>qualified?{modelName:provider.modelName,qualification:{productionEligible:true,allowedCapabilities:capabilities}}:null};
  const skills={status:()=>({providers:[provider,{...provider,id:'paid-fixture',local:false}]}),invoke:async(capability,input,options)=>{
    options.onAttempt?.({type:'started',provider:provider.id,modelName:provider.modelName});
    calls.push({capability,input,options});
    const result=await(respond?respond({capability,input,options}):{provider:provider.id,output:{model:provider.modelName,text:'Resposta baseada no contexto fornecido.'}});
    options.onAttempt?.({type:'completed',provider:provider.id,modelName:provider.modelName});return result;
  }};
  const chat=createNeuralChatEngine({db,skills,qualifications,config,now,timeoutMs,queueOptions,paidRuntime,env:{VITRINY_NEURAL_TASKS_STORES:'shop-a,shop-b',...env}});
  const result={chat,calls,db};fixtures.push(result);return result;
}
const request=(chat,message='Crie um texto para minha loja.',key='request-chat-test-001',extra={})=>chat.submit('admin:1',{message,idempotencyKey:key,...extra});
const upload=(chat,name='contexto.txt',value='O produto pesa 2 kg.',scope='admin:1')=>chat.upload(scope,{name,mimeType:'text/plain',dataBase64:Buffer.from(value).toString('base64')});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const answer={provider:'local-fixture',output:{model:'fixture-v1',text:'Resposta final recebida.'}};

test('DeepSeek-shaped secrets are rejected in prompts and text attachments before persistence',()=>{
  const f=fixture();try{
    for(const secret of ['sk-'+'a'.repeat(32),'DEEPSEEK_API_KEY=fixture-private-token']){
      assert.throws(()=>request(f.chat,secret,'request-deepseek-secret'),{code:'chat_input_invalid'});
      assert.throws(()=>upload(f.chat,'context.txt',secret),{code:'chat_attachment_invalid'});
    }
    assert.equal(f.calls.length,0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM neural_chat_messages').get().n,0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM neural_chat_attachments').get().n,0);
  }finally{f.chat.close();f.db.close();}
});

test('explicit paid primary quotes before dispatch even with a qualified local model',async()=>{
  const quotes=new Map(),paidRuntime={enabled:true,prefersText:true,setScopeAuthorizer(){},
    prepare(scope,input){quotes.set(input.requestId,{scope,kind:input.kind,quoteId:'quote-fixture',amountMicro:5});return quotes.get(input.requestId);},
    owns:(scope,id)=>quotes.get(id)?.scope===scope,payment:(_scope,id)=>quotes.get(id),artifacts:()=>[],close(){}};
  const f=fixture({paidRuntime});try{
    const item=request(f.chat,'Escreva um texto curto.','request-primary-paid-001');
    assert.equal(item.status,'awaiting_confirmation');assert.equal(item.payment.amountMicro,5);
    await tick();assert.equal(f.calls.length,0,'Local must not run alongside a paid quote');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM neural_durable_jobs').get().n,0);
    const duplicate=request(f.chat,'Escreva um texto curto.','request-primary-paid-001');
    assert.equal(duplicate.requestId,item.requestId);assert.equal(quotes.size,1);
    assert.throws(()=>request(f.chat,'Escreva um texto.','request-client-preference',{prefersText:true}),{code:'chat_input_invalid'});
    const action=request(f.chat,'Publique o texto no Instagram.','request-primary-action');
    assert.equal(action.status,'unavailable');assert.equal(quotes.size,1);
  }finally{f.chat.close();f.db.close();}
});

test('local-first admin uses local before paid text and only offers paid quote after explicit local escalation',async()=>{
  const quotes=new Map();let prepares=0;
  const paidRuntime={enabled:true,prefersText:true,setScopeAuthorizer(){},status(){return {capabilities:{chat:true}};},
    prepare(scope,input){prepares++;const payment={quoteId:'quote-'+input.requestId.replace(/-/g,'').slice(0,24),currency:'BRL',amountMicro:7,expiresAt:Date.now()+60000,kind:'chat',summary:'Cotação DeepSeek',state:'quoted',chargedMicro:null};quotes.set(input.requestId,{scope,payment});return payment;},
    owns:(scope,id)=>quotes.get(id)?.scope===scope,payment:(_scope,id)=>quotes.get(id)?.payment,artifacts:()=>[],close(){}};
  let responseText='Resposta local concluída.';
  const f=fixture({paidRuntime,env:{LIA_LOCAL_FIRST_ADMIN:'1'},respond:async()=>({provider:'local-fixture',output:{model:'fixture-v1',text:responseText}})});
  try{
    const first=request(f.chat,'Escreva um texto curto.','request-local-first-admin-001');await f.chat.wait(first.requestId);
    assert.equal(f.chat.request('admin:1',first.requestId).status,'completed');assert.equal(prepares,0);assert.equal(f.calls.length,1);

    responseText='[LIA_PRECISA_API] Preciso de um modelo externo para concluir.';
    const second=request(f.chat,'Analise este pedido mais difícil.','request-local-first-admin-002');await f.chat.wait(second.requestId);
    for(let i=0;i<6;i++)await tick();
    const conversation=f.chat.conversation('admin:1',second.conversationId);
    assert.equal(prepares,1,'paid provider is only quoted after local escalation');
    const quoted=conversation.messages.find(message=>message.role==='assistant'&&message.status==='awaiting_confirmation');
    assert.ok(quoted?.payment);assert.equal(quoted.payment.state,'quoted');
    assert.match(conversation.messages.find(message=>message.requestId===second.requestId&&message.role==='assistant').text,/modelo local não concluiu/i);
  }finally{f.chat.close();f.db.close();}
});

test('unavailable paid primary does not prevent already qualified local text',async()=>{
  let prepares=0;const paidRuntime={enabled:true,prefersText:true,setScopeAuthorizer(){},prepare(){prepares++;return null;},owns:()=>false,close(){}};
  const f=fixture({paidRuntime});try{
    const item=request(f.chat,'Escreva um texto.','request-primary-unavailable');await f.chat.wait(item.requestId);
    assert.equal(prepares,1);assert.equal(f.calls.length,1);assert.equal(f.chat.request('admin:1',item.requestId).status,'completed');
  }finally{f.chat.close();f.db.close();}
});
// Keeps the registry's pre-dispatch phase and its transport separately
// controllable, so cross-worker races do not depend on timing a real network.
function stagedFixture({db=new Database(':memory:'),now=Date.now,timeoutMs=1000}={}){
  let resolve,reject,options,starts=0;
  const transport=new Promise((yes,no)=>{resolve=yes;reject=no;});
  const provider={id:'local-fixture',modelName:'fixture-v1',local:true,policy:{enabled:true,allowedCapabilities:capabilities},capabilities};
  const chat=createNeuralChatEngine({db,now,timeoutMs,config:{enabled:true,mode:'advisory'},env:{},
    qualifications:{latest:()=>({modelName:'fixture-v1',qualification:{productionEligible:true,allowedCapabilities:capabilities}})},
    skills:{status:()=>({providers:[provider]}),invoke:(_capability,_input,context)=>{options=context;return transport;}}});
  const result={chat,db,transport,resolve,reject,start(){options.onAttempt({type:'started',provider:'local-fixture',modelName:'fixture-v1'});starts++;},
    complete(){options.onAttempt({type:'completed',provider:'local-fixture',modelName:'fixture-v1'});resolve(answer);},get starts(){return starts;}};
  fixtures.push(result);return result;
}

test('intent routing is internal and media never falls back to a text script',()=>{
  assert.equal(routeChatIntent('Gere um vídeo a partir desta imagem').kind,'video');
  assert.equal(routeChatIntent('Quero uma foto de um cachorro').kind,'image');
  assert.equal(routeChatIntent('Crie um roteiro de vídeo sobre plantas').capability,'growth.content-plan');
  assert.equal(routeChatIntent('Crie um site para minha loja').capability,'code.plan');
  assert.equal(routeChatIntent('Resuma o documento anexado').capability,'research.summarize');
  assert.equal(routeChatIntent('Gere um vídeo a partir desse prompt de texto').kind,'video');
  assert.equal(routeChatIntent('Crie uma imagem com texto escrito na capa').kind,'image');
  assert.equal(routeChatIntent('Crie um roteiro para gerar um vídeo').capability,'growth.content-plan');
  assert.equal(routeChatIntent('Pesquise na internet e depois crie um texto').kind,'research');
});

test('external action verbs take priority over nouns such as text while drafting remains available',async()=>{
  const f=fixture();try{
    for(const [index,message]of ['Envie o texto para o cliente.','Publique esse roteiro no Instagram.','Por favor, envie a descrição.','  Agora mande o texto para a loja.'].entries()){
      assert.equal(routeChatIntent(message).kind,'action');
      const item=request(f.chat,message,`request-outbound-denied-${index}`);
      assert.equal(item.status,'unavailable');assert.match(f.chat.conversation('admin:1',item.conversationId).messages[1].text,/nenhuma dessas ações/i);
    }
    assert.equal(f.calls.length,0);
    const draft=request(f.chat,'Escreva um rascunho para enviar ao cliente.','request-outbound-draft');await f.chat.wait(draft.requestId);
    assert.equal(f.calls.length,1);assert.equal(f.calls[0].capability,'growth.content-plan');
  }finally{f.db.close();}
});

test('conversation persists, continuation uses only scoped server history and references are untrusted',async()=>{
  const f=fixture();try{
    const a=upload(f.chat);
    const one=request(f.chat,undefined,undefined,{attachmentIds:[a.id]});await f.chat.wait(one.requestId);
    const next=request(f.chat,'Agora deixe o texto mais curto.','request-chat-test-002',{conversationId:one.conversationId});await f.chat.wait(next.requestId);
    const saved=f.chat.conversation('admin:1',one.conversationId);
    assert.equal(saved.messages.length,4);assert.equal(saved.messages[0].attachments[0].id,a.id);
    assert.equal(f.calls[0].options.localOnly,true);assert.equal(f.calls[0].options.evaluation,false);
    assert.deepEqual(f.calls[0].options.allowedProviders,['local-fixture']);
    assert.match(JSON.stringify(f.calls[0].input.untrustedContext),/O produto pesa 2 kg/);
    assert.equal(f.calls[0].input.untrustedContext.trusted,false);
    assert.match(JSON.stringify(f.calls[1].input.untrustedContext),/Resposta baseada no contexto/);
    assert.throws(()=>f.chat.conversation('admin:2',one.conversationId),{code:'chat_not_found'});
    assert.throws(()=>request(f.chat,'Outro texto.','request-chat-foreign',{conversationId:crypto.randomUUID()}),{code:'chat_not_found'});
    assert.throws(()=>f.chat.readAttachment('admin:2',a.id),{code:'chat_not_found'});
  }finally{f.db.close();}
});

test('completed conversation can be deleted while request audit remains and orphan attachment is removed',async()=>{
  const f=fixture();try{
    const attachment=upload(f.chat,'delete-me.txt','Conteúdo temporário.');
    const item=request(f.chat,'Resuma este documento.','request-delete-chat-001',{attachmentIds:[attachment.id]});await f.chat.wait(item.requestId);
    assert.equal(f.chat.request('admin:1',item.requestId).status,'completed');
    const deleted=f.chat.deleteConversation('admin:1',item.conversationId);
    assert.deepEqual(deleted,{id:item.conversationId,deleted:true});
    assert.deepEqual(f.chat.list('admin:1'),[]);
    assert.throws(()=>f.chat.conversation('admin:1',item.conversationId),{code:'chat_not_found'});
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM neural_chat_messages WHERE conversation_id=?').get(item.conversationId).n,0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM neural_chat_attachments WHERE id=?').get(attachment.id).n,0);
    assert.equal(f.chat.requestByKey('admin:1','request-delete-chat-001').requestId,item.requestId,'request audit/idempotency remains');
  }finally{f.chat.close();f.db.close();}
});

test('conversation with an active request cannot be deleted',async()=>{
  const f=stagedFixture();try{
    const item=request(f.chat,'Escreva um texto.','request-delete-chat-active');
    assert.throws(()=>f.chat.deleteConversation('admin:1',item.conversationId),{code:'chat_delete_blocked'});
    f.chat.cancel('admin:1',item.requestId);
  }finally{f.chat.close();f.db.close();}
});

test('idempotency includes attachment identity and recovers without replay',async()=>{
  const f=fixture();try{
    const first=upload(f.chat),second=upload(f.chat,'outra.txt','Outro conteúdo.');
    const one=request(f.chat,'Escreva o texto.','request-idempotent-001',{attachmentIds:[first.id]});await f.chat.wait(one.requestId);
    assert.equal(request(f.chat,'Escreva o texto.','request-idempotent-001',{attachmentIds:[first.id]}).requestId,one.requestId);
    assert.throws(()=>request(f.chat,'Escreva o texto.','request-idempotent-001',{attachmentIds:[second.id]}),{code:'chat_conflict'});
    assert.equal(f.chat.requestByKey('admin:1','request-idempotent-001').id,one.requestId);
    assert.equal(f.calls.length,1);
  }finally{f.db.close();}
});

test('unavailable image and video requests do not invoke any model or generate media',async()=>{
  const f=fixture();try{
    for(const [i,message]of ['Gere um vídeo da loja.','Faça uma imagem de uma planta.'].entries()){
      const item=request(f.chat,message,'request-media-test-'+i);await f.chat.wait(item.requestId);
      const saved=f.chat.conversation('admin:1',item.conversationId);
      assert.equal(saved.messages[1].status,'unavailable');assert.match(saved.messages[1].text,/não|indisponível/i);
    }
    assert.equal(f.calls.length,0);assert.equal(f.chat.status('admin:1').paidGenerationEnabled,false);
  }finally{f.db.close();}
});

test('media continuation keeps intent and external research does not masquerade as browsing',async()=>{
  const f=fixture();try{
    const first=request(f.chat,'Gere um vídeo de uma planta.','request-media-follow1');
    const follow=request(f.chat,'Agora com 10 segundos.','request-media-follow2',{conversationId:first.conversationId});
    assert.equal(follow.status,'unavailable');
    assert.match(f.chat.conversation('admin:1',first.conversationId).messages[3].text,/vídeo/);
    const lookup=request(f.chat,'Pesquise na internet as notícias de hoje.','request-research-now');
    assert.equal(lookup.status,'unavailable');assert.equal(f.calls.length,0);
    const writing=request(f.chat,'Agora escreva um roteiro.','request-media-follow3',{conversationId:first.conversationId});await f.chat.wait(writing.requestId);
    assert.equal(f.calls.length,1);assert.equal(f.calls[0].capability,'growth.content-plan');
  }finally{f.db.close();}
});

test('expired lease retains concurrency until the cancelled transport really settles',async()=>{
  let clock=Date.now(),release;const f=fixture({now:()=>clock,respond:()=>new Promise(resolve=>{release=resolve;})});try{
    const first=request(f.chat);await new Promise(resolve=>setImmediate(resolve));clock+=46000;
    assert.equal(f.chat.requestByKey('admin:1','request-chat-test-001').status,'interrupted');
    assert.equal(f.calls[0].options.signal.aborted,true);
    const next=request(f.chat,'Mais uma resposta.','request-after-timeout');assert.equal(next.status,'queued');assert.equal(f.calls.length,1);
    assert.equal(f.chat.status('admin:1').queue.requiresReview,true);f.chat.cancel('admin:1',next.id);
    release({provider:'local-fixture',output:{model:'fixture-v1',text:'Late ignored'}});await f.chat.wait(first.requestId);
    assert.doesNotMatch(JSON.stringify(f.chat.conversation('admin:1',first.conversationId)),/Late ignored/);
  }finally{f.db.close();}
});

test('deadline returns interrupted but does not free an unacknowledged transport slot',async()=>{
  let release;const f=fixture({timeoutMs:100,respond:()=>new Promise(resolve=>{release=resolve;})});try{
    const first=request(f.chat);await new Promise(resolve=>setTimeout(resolve,150));
    assert.equal(f.chat.requestByKey('admin:1','request-chat-test-001').status,'interrupted');
    const queued=request(f.chat,'Mais uma resposta.','request-deadline-new');assert.equal(queued.status,'queued');assert.equal(f.calls.length,1);
    assert.equal(f.chat.status('admin:1').queue.unresolved,1);f.chat.cancel('admin:1',queued.id);
    release({provider:'local-fixture',output:{model:'fixture-v1',text:'Late ignored'}});await f.chat.wait(first.requestId);
    const next=request(f.chat,'Gere uma imagem.','request-deadline-fresh');assert.equal(next.status,'unavailable');
  }finally{f.db.close();}
});

test('valid raster stays private and is never represented as model vision',()=>{
  const f=fixture();try{
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64');
    const a=f.chat.upload('admin:1',{name:'foto.png',mimeType:'image/png',dataBase64:png.toString('base64')});
    assert.equal(a.kind,'image');assert.equal(a.width,1);assert.equal(a.textAvailable,false);assert.ok(!Object.hasOwn(a,'data'));
    assert.deepEqual(f.chat.readAttachment('admin:1',a.id).data,png);
    const first=request(f.chat,'O que aparece nesta imagem?','request-visual-test01',{attachmentIds:[a.id]});
    assert.equal(first.status,'unavailable');assert.equal(f.calls.length,0);
    assert.match(f.chat.conversation('admin:1',first.conversationId).messages[1].text,/Não analisei/);
    const follow=request(f.chat,'Explique essa imagem.','request-visual-test02',{conversationId:first.conversationId});assert.equal(follow.status,'unavailable');
  }finally{f.db.close();}
});

test('retention and per-message attachment limits are enforced without deleting data',()=>{
  const f=fixture();try{
    const files=[];for(let n=0;n<40;n++)files.push(upload(f.chat,`arquivo-${n}.txt`,`Contexto ${n}`));
    assert.throws(()=>upload(f.chat,'extra.txt','Mais contexto'),{code:'chat_attachment_quota'});
    assert.throws(()=>request(f.chat,'Leia estes dados.','request-too-many-files',{attachmentIds:files.slice(0,4).map(f=>f.id)}),{code:'chat_input_invalid'});
    assert.throws(()=>request(f.chat,'Leia estes dados.','request-duplicate-files',{attachmentIds:[files[0].id,files[0].id]}),{code:'chat_input_invalid'});
    assert.throws(()=>f.chat.submit('store:shop-a',{message:'Leia os dados.',idempotencyKey:'request-other-store',attachmentIds:[files[0].id]}),{code:'chat_not_found'});
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM neural_chat_attachments').get().n,40);
  }finally{f.db.close();}
});

test('short greeting is accepted and long source context is bounded while follow-up survives',async()=>{
  const f=fixture();try{
    const greeting=request(f.chat,'oi','request-short-greeting');await f.chat.wait(greeting.requestId);
    const a=upload(f.chat,'grande.txt','Referência '.repeat(5000));
    const first=request(f.chat,'Resuma este documento.','request-context-first',{attachmentIds:[a.id]});await f.chat.wait(first.requestId);
    const follow=request(f.chat,'Agora deixe mais curto.','request-context-follow',{conversationId:first.conversationId});await f.chat.wait(follow.requestId);
    const context=f.calls.at(-1).input.untrustedContext;
    assert.equal(context.truncated,true);assert.ok(context.documents.reduce((n,d)=>n+d.text.length,0)+context.history.reduce((n,m)=>n+m.text.length,0)<=16000);
    assert.ok(context.history.some(m=>m.role==='assistant'));
  }finally{f.db.close();}
});

test('reopened service recovers durable history and never replays an uncertain request',async()=>{
  const f=fixture();try{
    const item=request(f.chat);await f.chat.wait(item.requestId);
    f.db.prepare("UPDATE neural_chat_requests SET status='running',lease_token='legacy-lease',lease_until=0 WHERE id=?").run(item.requestId);
    f.db.prepare("UPDATE neural_chat_messages SET status='running',text='' WHERE request_id=? AND role='assistant'").run(item.requestId);
    const restarted=fixture({db:f.db});
    const saved=restarted.chat.conversation('admin:1',item.conversationId);
    assert.equal(saved.messages[1].status,'interrupted');assert.equal(restarted.calls.length,0);
    assert.equal(restarted.chat.requestByKey('admin:1','request-chat-test-001').status,'interrupted');
    assert.equal(request(restarted.chat).duplicate,true);assert.equal(restarted.calls.length,0);
  }finally{f.db.close();}
});

test('restarting after store revocation safely reaps expired work without blocking admin reads',async()=>{
  const f=fixture();try{
    const item=f.chat.submit('store:shop-a',{message:'Escreva um texto.',idempotencyKey:'request-revoked-store'});await f.chat.wait(item.requestId);
    f.db.prepare("UPDATE neural_chat_requests SET status='running',lease_token='old-process-lease',lease_until=0 WHERE id=?").run(item.requestId);
    f.db.prepare("UPDATE neural_chat_messages SET status='running',text='' WHERE request_id=? AND role='assistant'").run(item.requestId);
    const restarted=fixture({db:f.db,env:{VITRINY_NEURAL_TASKS_STORES:'shop-b'}});
    assert.doesNotThrow(()=>restarted.chat.status('admin:1'));assert.deepEqual(restarted.chat.list('admin:1'),[]);
    assert.equal(f.db.prepare('SELECT status FROM neural_chat_requests WHERE id=?').get(item.requestId).status,'interrupted');
    assert.equal(f.db.prepare("SELECT status FROM neural_chat_messages WHERE request_id=? AND role='assistant'").get(item.requestId).status,'interrupted');
    assert.throws(()=>restarted.chat.conversation('store:shop-a',item.conversationId),{code:'chat_access_denied'});
    assert.throws(()=>restarted.chat.submit('store:shop-a',{message:'Mais um texto.',idempotencyKey:'request-store-revoked-new'}),{code:'chat_access_denied'});
    assert.equal(restarted.calls.length,0);assert.doesNotThrow(()=>restarted.chat.status('admin:1'));
  }finally{f.db.close();}
});

test('unqualified or shadow models are not used as an evaluation bypass',async()=>{
  for(const options of [{qualified:false},{config:{enabled:true,mode:'shadow'}}]){
    const f=fixture(options);try{const item=request(f.chat);await f.chat.wait(item.requestId);assert.equal(f.calls.length,0);assert.equal(f.chat.requestByKey('admin:1','request-chat-test-001').status,'unavailable');}finally{f.db.close();}
  }
});

test('attachments reject unsupported, forged, over-limit and invalid UTF-8 files',()=>{
  const f=fixture();try{
    const put=(name,mimeType,buffer)=>f.chat.upload('admin:1',{name,mimeType,dataBase64:buffer.toString('base64')});
    assert.throws(()=>put('x.svg','image/svg+xml',Buffer.from('<svg/>')),{code:'chat_attachment_invalid'});
    assert.throws(()=>put('x.pdf','application/pdf',Buffer.from('%PDF-1.7')),{code:'chat_attachment_invalid'});
    assert.throws(()=>put('x.png','image/png',Buffer.from('not an image')),{code:'chat_attachment_invalid'});
    assert.throws(()=>put('x.txt',['text/plain'],Buffer.from('texto')),{code:'chat_attachment_invalid'});
    assert.throws(()=>put('x.txt','text/plain',Buffer.from([0xff,0xfe,0x00])),{code:'chat_attachment_invalid'});
    assert.throws(()=>put('x.txt','text/plain',Buffer.alloc(65537,65)),{code:'chat_attachment_too_large'});
    assert.throws(()=>put('../x.txt','text/plain',Buffer.from('data')),{code:'chat_attachment_invalid'});
    assert.equal(upload(f.chat).textAvailable,true);
    assert.throws(()=>f.chat.submit('admin:1',{message:'Teste válido.',idempotencyKey:'request-forged-scope',scope:'admin:2'}),{code:'chat_input_invalid'});
  }finally{f.db.close();}
});

test('cancel propagates abort, retains conversation and never accepts late success',async()=>{
  let release;const f=fixture({respond:()=>new Promise(resolve=>{release=resolve;})});try{
    const item=request(f.chat);await new Promise(resolve=>setImmediate(resolve));
    f.chat.cancel('admin:1',item.requestId);
    assert.equal(f.calls[0].options.signal.aborted,true);
    release({provider:'local-fixture',output:{model:'fixture-v1',text:'Late answer'}});await f.chat.wait(item.requestId);
    assert.equal(f.chat.requestByKey('admin:1','request-chat-test-001').status,'cancelled');
    assert.ok(!JSON.stringify(f.chat.conversation('admin:1',item.conversationId)).includes('Late answer'));
  }finally{f.db.close();}
});

test('provider errors and incomplete content do not become a completed answer',async()=>{
  for(const respond of [()=>{throw new Error('sk-secret-private-user-prompt');},()=>({provider:'local-fixture',output:{model:'fixture-v1',text:'partial',finishReason:'content_filter'}})]){
    const f=fixture({respond});try{const item=request(f.chat);await f.chat.wait(item.requestId);const saved=f.chat.conversation('admin:1',item.conversationId);assert.equal(saved.messages[1].status,'failed');assert.doesNotMatch(JSON.stringify(saved),/sk-secret|partial/);}finally{f.db.close();}
  }
});

test('tool-call responses are never completed as plain chat answers',async()=>{
  for(const fields of [{finishReason:'tool_calls'},{finishReason:'function_call'},{tool_calls:[{type:'function',function:{name:'send_message'}}]},{function_call:{name:'publish'}},{tool_calls:[]},{toolCallsPresent:true}]){
    const f=fixture({respond:()=>({provider:'local-fixture',output:{model:'fixture-v1',text:'Suposto sucesso externo.',...fields}})});
    try{const item=request(f.chat);await f.chat.wait(item.requestId);const saved=f.chat.conversation('admin:1',item.conversationId);assert.equal(saved.messages[1].status,'failed');assert.doesNotMatch(saved.messages[1].text,/Suposto sucesso/);}finally{f.db.close();}
  }
});

test('real model adapter preserves a tool-attempt marker even when raw finish_reason says stop',async()=>{
  const adapter=createOpenAICompatibleProvider({id:'local-fixture',baseUrl:'https://fixture.invalid',model:'fixture-v1',local:true,
    fetchImpl:async()=>new Response(JSON.stringify({model:'fixture-v1',choices:[{finish_reason:'stop',message:{content:'Suposto sucesso externo.',tool_calls:[{type:'function',function:{name:'send_message',arguments:'{}'}}]}}]}),{headers:{'content-type':'application/json'}})});
  const f=fixture({respond:async({capability,input,options})=>({provider:'local-fixture',output:await adapter.invoke({capability,input,options,signal:options.signal})})});
  try{const item=request(f.chat);await f.chat.wait(item.requestId);assert.equal(f.chat.conversation('admin:1',item.conversationId).messages[1].status,'failed');}finally{f.db.close();}
});

test('fifty requests from ten accounts persist queued and resume exactly once after restart',async()=>{
  const first=fixture(),items=[];try{
    for(let scope=1;scope<=10;scope++)for(let n=0;n<5;n++){
      const item=first.chat.submit(`admin:${scope}`,{message:`Escreva o texto ${n}.`,idempotencyKey:`request-backlog-${scope}-${n}`});
      assert.equal(item.status,'queued');assert.deepEqual(item.queue,{lane:'chat',position:null});items.push(item);
    }
    assert.equal(first.calls.length,0);first.chat.close();
    const reopened=fixture({db:first.db});await reopened.chat.wait(items.at(-1).id);
    assert.equal(reopened.calls.length,50);assert.equal(first.calls.length,0);
    assert.equal(first.db.prepare("SELECT COUNT(*) n FROM neural_chat_requests WHERE status='completed'").get().n,50);
    assert.equal(first.db.prepare("SELECT COUNT(*) n FROM neural_durable_jobs WHERE status='completed'").get().n,50);
    const recovered=reopened.chat.submit('admin:1',{message:'Escreva o texto 0.',idempotencyKey:'request-backlog-1-0'});
    assert.equal(recovered.id,items[0].id);assert.equal(recovered.duplicate,true);assert.equal(reopened.calls.length,50);
    assert.equal(reopened.chat.status('admin:1').queue.pending,0);
  }finally{first.db.close();}
});

test('one active request per conversation and queued cancellation never invokes a provider',async()=>{
  let release;const f=fixture({respond:()=>new Promise(resolve=>{release=resolve;})});try{
    const first=request(f.chat);assert.equal(first.status,'queued');
    assert.throws(()=>request(f.chat,'Outro texto.','request-same-conversation',{conversationId:first.conversationId}),{code:'chat_busy'});
    const next=request(f.chat,'Outro texto.','request-other-conversation');assert.equal(next.status,'queued');
    assert.equal(f.chat.cancel('admin:1',next.id).status,'cancelled');await tick();assert.equal(f.calls.length,1);
    release(answer);await f.chat.wait(first.id);assert.equal(f.calls.length,1);
    assert.equal(f.chat.requestByKey('admin:1','request-other-conversation').status,'cancelled');
  }finally{f.db.close();}
});

test('transport rejection remains unknown across restart and only scoped status discloses it',async()=>{
  const first=fixture({respond:()=>{throw Error('transport outcome unknown');}});try{
    const item=request(first.chat);await first.chat.wait(item.id);
    assert.equal(first.chat.request('admin:1',item.id).status,'failed');
    const held=first.chat.status('admin:1');assert.equal(held.queue.requiresReview,true);assert.equal(held.queue.unresolved,1);assert.match(held.notice,/revisão segura/);
    assert.deepEqual(first.chat.status('admin:2').queue,{enabled:true,pending:0,running:0,unresolved:0,requiresReview:false});
    first.chat.close();const reopened=fixture({db:first.db});
    const queued=request(reopened.chat,'Outro texto.','request-unknown-after-restart');await tick();
    assert.equal(queued.status,'queued');assert.equal(reopened.calls.length,0);assert.equal(reopened.chat.status('admin:1').queue.unresolved,1);
    assert.equal(reopened.chat.request('admin:1',item.id).status,'failed');
    assert.equal(first.db.prepare('SELECT status FROM neural_durable_jobs WHERE id=?').get(item.id).status,'unknown');
  }finally{first.db.close();}
});

test('restart with revoked store cancels never-dispatched work without blocking admin reads',async()=>{
  const first=fixture();try{
    const item=first.chat.submit('store:shop-a',{message:'Escreva o texto.',idempotencyKey:'request-revoked-queued'});first.chat.close();
    const reopened=fixture({db:first.db,env:{VITRINY_NEURAL_TASKS_STORES:'shop-b'}});await tick();
    assert.doesNotThrow(()=>reopened.chat.status('admin:1'));assert.deepEqual(reopened.chat.list('admin:1'),[]);
    assert.equal(first.db.prepare('SELECT status FROM neural_chat_requests WHERE id=?').get(item.id).status,'unavailable');
    assert.equal(first.db.prepare('SELECT status FROM neural_durable_jobs WHERE id=?').get(item.id).status,'cancelled');
    assert.throws(()=>reopened.chat.request('store:shop-a',item.id),{code:'chat_access_denied'});assert.equal(reopened.calls.length,0);assert.equal(first.calls.length,0);
  }finally{first.db.close();}
});

test('another engine reaping between transport resolution and answer commit does not discard success',async()=>{
  const first=stagedFixture();try{
    const item=request(first.chat);await tick();first.start();const second=fixture({db:first.db});
    let observed;
    first.transport.then(()=>{second.chat.status('admin:1');observed=first.db.prepare('SELECT status FROM neural_chat_requests WHERE id=?').get(item.id).status;});
    first.complete();await first.chat.wait(item.id);
    assert.equal(observed,'running');assert.equal(second.chat.request('admin:1',item.id).status,'completed');
    assert.equal(second.chat.conversation('admin:1',item.conversationId).messages[1].text,answer.output.text);
    assert.equal(second.calls.length,0);assert.equal(first.starts,1);
  }finally{first.db.close();}
});

test('an expired pre-dispatch worker cannot fail a newer lease or make a provider call',async()=>{
  let clock=1000;const first=stagedFixture({now:()=>clock});try{
    const item=request(first.chat);await tick();
    const oldToken=first.db.prepare('SELECT lease_token FROM neural_durable_jobs WHERE id=?').get(item.id).lease_token;
    clock+=1001;const second=stagedFixture({db:first.db,now:()=>clock});await tick();
    const newToken=first.db.prepare('SELECT lease_token FROM neural_durable_jobs WHERE id=?').get(item.id).lease_token;assert.notEqual(newToken,oldToken);
    let rejected;try{first.start();}catch(error){rejected=error;}assert.ok(rejected);first.reject(rejected);await first.chat.wait(item.id);
    assert.equal(first.starts,0);assert.equal(second.chat.request('admin:1',item.id).status,'queued');
    assert.equal(first.db.prepare('SELECT lease_token FROM neural_durable_jobs WHERE id=?').get(item.id).lease_token,newToken);
    second.start();second.complete();await second.chat.wait(item.id);assert.equal(second.chat.request('admin:1',item.id).status,'completed');
    assert.equal(second.starts,1);
  }finally{first.db.close();}
});
