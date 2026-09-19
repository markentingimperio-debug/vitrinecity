import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {CHAT_MESSAGE_STATES,isChatActive,assertChatReceipt,assertChatQueueStatus} from '../../public/neural-chat-contract.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=path.resolve(fileURLToPath(new URL('../../public/',import.meta.url)));
const conversation={id:'11111111-1111-4111-8111-111111111111',title:'Minha conversa'};
const files=new Map(),messages=[],requests=new Map(),external=[],errors=[],results=[];
let sends=0,uploads=0,uncertain=false,rejectBeforeReceipt=0,deferNext=false,lastQueuedId=null,cancellations=0,deletions=0,historyFault=null,receiptReads=0;
const sendAttempts=[];
const receipt=(requestId,messageId,state)=>assertChatReceipt({id:requestId,requestId,conversationId:conversation.id,messageId,status:state,createdAt:1,updatedAt:1,...(state==='queued'?{queue:{lane:'chat',position:null}}:{})});
function updateRequest(requestId,state){
  assert.ok(CHAT_MESSAGE_STATES.includes(state));
  for(const [key,item] of requests)if(item.requestId===requestId)requests.set(key,receipt(requestId,item.messageId,state));
  const assistant=messages.find(message=>message.requestId===requestId&&message.role==='assistant');
  if(assistant){assistant.status=state;assistant.text=state==='completed'?'Resposta da fila concluída.':state==='cancelled'?'Pedido cancelado antes de iniciar.':'';if(state==='queued')assistant.queue={lane:'chat',position:null};else delete assistant.queue;}
}
const status={ok:true,enabled:true,mode:'local',paidGenerationEnabled:false,capabilities:{text:true,image:false,video:false},attachments:{maxPerMessage:3,imageMaxBytes:2097152,textMaxBytes:65536},queue:assertChatQueueStatus({enabled:true,pending:0,running:0,requiresReview:false,unresolved:0})};
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');
    const send=(data,code=200)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    if(url.pathname==='/api/coins/status')return send({ok:false,error:'Carteira unificada indisponível na fixture legada.'},503);
    if(url.pathname.startsWith('/api/admin/vitriny-neural/chat')){
      const route=url.pathname.slice('/api/admin/vitriny-neural/chat'.length);
      let body={};
      if(req.method==='POST'){assert.equal(req.headers['x-neural-request'],'1');const chunks=[];for await(const chunk of req)chunks.push(chunk);body=JSON.parse(Buffer.concat(chunks).toString());}
      if(route==='/status')return send(status);
      if(route==='/conversations')return send({ok:true,items:messages.length?[conversation]:[]});
      if(route==='/conversations/'+conversation.id){
        const output=historyFault==='omit'?messages.filter(message=>message.role!=='assistant'||message.requestId!==lastQueuedId):messages.map(message=>historyFault==='unknown'&&message.role==='assistant'&&message.requestId===lastQueuedId?{...message,status:'unrecognized'}:message);
        return send({ok:true,conversation,messages:output});
      }
      if(route==='/conversations/'+conversation.id+'/delete'&&req.method==='POST'){
        deletions++;messages.splice(0,messages.length);requests.clear();lastQueuedId=null;return send({ok:true,id:conversation.id,deleted:true});
      }
      if(route==='/attachments'&&req.method==='POST'){
        const id='22222222-2222-4222-8222-'+String(++uploads).padStart(12,'0'),data=Buffer.from(body.dataBase64,'base64');
        const attachment={id,name:body.name,mimeType:body.mimeType,kind:body.mimeType.startsWith('image/')?'image':'text',bytes:data.length,textAvailable:body.mimeType.startsWith('text/')};
        files.set(id,{attachment,data});return send({ok:true,attachment},201);
      }
      if(route.startsWith('/attachments/')){
        const file=files.get(route.split('/').pop());if(!file)return send({ok:false},404);
        res.writeHead(200,{'Content-Type':file.attachment.mimeType,'X-Content-Type-Options':'nosniff'});res.end(file.data);return;
      }
      if(route==='/messages'&&req.method==='POST'){
        sendAttempts.push(JSON.stringify(body));
        if(rejectBeforeReceipt>0){rejectBeforeReceipt--;res.writeHead(200,{'Content-Type':'application/json'});res.end('{');return;}
        sends++;const requestId='33333333-3333-4333-8333-'+String(sends).padStart(12,'0');
        assert.ok(!('model'in body)&&!('area'in body),'UI does not request a model or area');
        messages.push({id:'user-'+sends,role:'user',text:body.message,status:'completed',attachments:body.attachmentIds.map(id=>files.get(id).attachment),requestId});
        const unavailable=/video|vídeo|imagem gerada/i.test(body.message);
        const messageState=unavailable?'unavailable':deferNext?'queued':'completed';deferNext=false;
        const accepted=receipt(requestId,'user-'+sends,messageState);
        messages.push({id:'assistant-'+sends,role:'assistant',text:unavailable?'A geração de vídeo ainda não está disponível neste chat. Sua imagem foi anexada, mas não houve geração.':isChatActive(messageState)?'':'Recebi seu pedido. <img src=x onerror=alert(1)> Este texto permanece inerte.',status:messageState,attachments:[],requestId,...(accepted.queue?{queue:accepted.queue}:{})});
        requests.set(body.idempotencyKey,accepted);
        if(messageState==='queued')lastQueuedId=requestId;
        if(uncertain){uncertain=false;res.writeHead(200,{'Content-Type':'application/json'});res.end('{');return;}
        return send({ok:true,...accepted},202);
      }
      if(/^\/requests\/[^/]+\/cancel$/.test(route)&&req.method==='POST'){
        const requestId=route.split('/')[2],item=[...requests.values()].find(candidate=>candidate.requestId===requestId);
        if(!item)return send({ok:false},404);cancellations++;updateRequest(requestId,'cancelled');return send({ok:true,...receipt(requestId,item.messageId,'cancelled')});
      }
      if(route.startsWith('/requests/by-key/')){const request=requests.get(decodeURIComponent(route.split('/').pop()));return request?send({ok:true,request}):send({ok:false},404);}
      if(/^\/requests\/[^/]+$/.test(route)&&req.method==='GET'){receiptReads++;const request=[...requests.values()].find(item=>item.requestId===route.split('/').pop());return request?send({ok:true,request}):send({ok:false},404);}
      return send({ok:false},404);
    }
    if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    res.setHeader('Content-Type',({js:'text/javascript; charset=utf-8',css:'text/css',html:'text/html; charset=utf-8'})[file.split('.').pop()]||'application/octet-stream');
    res.end(await readFile(file));
  }catch(error){errors.push(error.message);res.writeHead(500);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.CASUAL_QA_BROWSER?{executablePath:process.env.CASUAL_QA_BROWSER}:{channel:'chrome'})});
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce'});
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  for(const width of [320,360,390,412,768,1280]){
    await page.setViewportSize({width,height:844});
    await page.goto(origin+'/neural-workspace.html');
    await page.waitForFunction(()=>document.getElementById('service-status').textContent==='Chat conectado');
    const measure=await page.evaluate(()=>{
      const composer=document.getElementById('command-form').getBoundingClientRect(),send=document.getElementById('send').getBoundingClientRect(),input=document.getElementById('command').getBoundingClientRect();
      return {width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,composerBottom:composer.bottom,viewportHeight:innerHeight,sendWidth:send.width,sendHeight:send.height,inputWidth:input.width,selectors:document.querySelectorAll('select').length};
    });
    assert.ok(measure.overflow<=1,'no horizontal scrolling at '+width);assert.ok(measure.composerBottom<=measure.viewportHeight,'composer visible');assert.ok(measure.inputWidth>=width-85||width>700,'usable mobile input');
    assert.ok(measure.sendHeight>=44&&measure.sendWidth>=44,'touch target');assert.equal(measure.selectors,0);
    results.push(measure);
    if(process.env.NEURAL_QA_OUTPUT&&[390,1280].includes(width)){await mkdir(process.env.NEURAL_QA_OUTPUT,{recursive:true});await page.screenshot({path:path.join(process.env.NEURAL_QA_OUTPUT,'chat-empty-'+width+'.png')});}
  }
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Mostrar conversas'}).click();
  await page.getByRole('button',{name:'Nova conversa'}).click();
  await page.locator('#command').fill('Olá, me ajude com minha loja');
  await page.locator('#command').press('Shift+Enter');assert.equal(sends,0);assert.match(await page.locator('#command').inputValue(),/\n/);
  await page.locator('#command').press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('#messages>li').length===2);
  assert.equal(sends,1);assert.equal(await page.locator('#messages img').count(),0);
  assert.match(await page.locator('#messages').innerText(),/<img src=x/);
  await page.locator('#command').fill('Agora faça mais curto');
  await page.locator('#send').click();
  await page.waitForFunction(()=>document.querySelectorAll('#messages>li').length===4);
  const postsBeforeReload=sends;await page.reload();await page.waitForFunction(()=>document.querySelectorAll('#messages>li').length===4);assert.equal(sends,postsBeforeReload);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
  await page.locator('#attachment-input').setInputFiles({name:'referencia.png',mimeType:'image/png',buffer:png});
  assert.equal(uploads,0,'attachment selected but not sent');
  await page.getByRole('button',{name:'Remover referencia.png'}).click();assert.equal(await page.locator('#attachment-previews li').count(),0);
  await page.locator('#attachment-input').setInputFiles([{name:'referencia.png',mimeType:'image/png',buffer:png},{name:'contexto.txt',mimeType:'text/plain',buffer:Buffer.from('Nome da loja: Jardim feliz.')}]);
  assert.equal(await page.locator('#attachment-previews li').count(),2);
  await page.locator('#command').fill('Gere um vídeo a partir desta imagem');await page.locator('#send').click();
  await page.waitForFunction(()=>document.querySelectorAll('#messages>li').length===6);
  assert.equal(uploads,2);assert.match(await page.locator('#messages').innerText(),/não houve geração/);
  assert.equal(await page.locator('#messages video').count(),0,'no fake generated player');
  await page.locator('#attachment-input').setInputFiles({name:'documento.pdf',mimeType:'application/pdf',buffer:Buffer.from('test')});
  await page.locator('#error').waitFor({state:'visible'});assert.match(await page.locator('#error').innerText(),/PDF e DOCX/);
  assert.equal(await page.locator('#attachment-previews li').count(),0);
  uncertain=true;await page.locator('#command').fill('Pedido com falha de conexão');await page.locator('#send').click();await page.locator('#recovery').waitFor({state:'visible'});
  const before=sends;await page.locator('#recover-request').click();await page.locator('#recovery').waitFor({state:'hidden'});assert.equal(sends,before,'recovery must not repeat send');
  await page.locator('#command').fill('Uma composição de teclado');
  await page.locator('#command').dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});assert.equal(sends,before,'IME must not send');
  rejectBeforeReceipt=2;
  await page.locator('#attachment-input').setInputFiles({name:'original.txt',mimeType:'text/plain',buffer:Buffer.from('Contexto original para repetir com a mesma chave.')});
  await page.locator('#command').fill('Pedido original para recuperação explícita');
  const attemptsBefore=sendAttempts.length;
  await page.locator('#send').click();await page.locator('#recovery').waitFor({state:'visible'});
  const uploadsAfterFirst=uploads;
  assert.equal(sendAttempts.length,attemptsBefore+1);
  assert.equal(await page.locator('#retry-request').isVisible(),false);
  await page.locator('#recover-request').click();await page.locator('#retry-request').waitFor({state:'visible'});
  assert.equal(sendAttempts.length,attemptsBefore+1,'404 alone cannot create another POST');
  await page.locator('#history-toggle').click();await page.locator('#refresh').click();
  await page.waitForFunction(()=>!document.getElementById('refresh').disabled);await page.locator('#history-toggle').click();
  assert.equal(sendAttempts.length,attemptsBefore+1,'refresh cannot retry pending message');
  await page.locator('#retry-request').click();await page.waitForFunction(()=>!document.getElementById('recover-request').disabled);
  assert.equal(sendAttempts.length,attemptsBefore+2);
  assert.equal(sendAttempts.at(-1),sendAttempts[attemptsBefore]);assert.equal(uploads,uploadsAfterFirst);
  assert.equal(await page.locator('#recovery').isVisible(),true,'a second lost reply remains held');
  assert.equal(await page.locator('#retry-request').isVisible(),false);
  await page.locator('#recover-request').click();await page.locator('#retry-request').waitFor({state:'visible'});
  await page.locator('#retry-request').click();await page.locator('#recovery').waitFor({state:'hidden'});
  assert.equal(sendAttempts.length,attemptsBefore+3);
  assert.equal(sendAttempts.at(-1),sendAttempts[attemptsBefore]);assert.equal(uploads,uploadsAfterFirst);
  assert.equal(await page.locator('#command').inputValue(),'');assert.equal(await page.locator('#attachment-previews li').count(),0);
  deferNext=true;
  await page.locator('#command').fill('Prepare uma resposta quando houver capacidade');await page.locator('#send').click();
  await page.waitForFunction(()=>document.querySelector('#messages>li:last-child .message-state')?.textContent==='Na fila');
  assert.equal(await page.locator('#cancel-request').innerText(),'Cancelar pedido');
  assert.equal(await page.locator('#new-conversation').isDisabled(),true);
  assert.equal(await page.locator('#messages>li:last-child').getAttribute('aria-busy'),'true');
  assert.doesNotMatch(await page.locator('#messages>li:last-child').innerText(),/\d+\s*(%|segundos|minutos)/i,'queue cannot invent progress or ETA');
  const queuedSends=sendAttempts.length;
  await page.reload();await page.waitForFunction(()=>document.querySelector('#messages>li:last-child .message-state')?.textContent==='Na fila');
  assert.equal(sendAttempts.length,queuedSends,'reload of queued request never sends');
  assert.equal(await page.locator('#cancel-request').isVisible(),true);
  if(process.env.NEURAL_QA_OUTPUT)await page.screenshot({path:path.join(process.env.NEURAL_QA_OUTPUT,'chat-queued-mobile.png')});
  historyFault='unknown';
  await page.locator('#error').waitFor({state:'visible'});
  await page.locator('#command').fill('Não enviar enquanto o estado não for confirmado');
  assert.equal(await page.locator('#send').isDisabled(),true,'invalid polling state cannot unlock send');
  assert.equal(await page.locator('#cancel-request').isVisible(),true);
  assert.equal(sendAttempts.length,queuedSends,'invalid polling cannot send automatically');
  historyFault='omit';
  await page.waitForResponse(response=>response.url().endsWith('/requests/'+lastQueuedId)&&response.status()===200);
  await page.waitForFunction(()=>document.getElementById('send').disabled&&!document.getElementById('cancel-request').hidden);
  assert.ok(receiptReads>=1,'partial history is checked using request receipt');
  assert.equal(sendAttempts.length,queuedSends,'partial history cannot send automatically');
  historyFault=null;
  updateRequest(lastQueuedId,'running');
  await page.waitForFunction(()=>document.querySelector('#messages>li:last-child .message-state')?.textContent==='Em andamento');
  assert.equal(await page.locator('#cancel-request').innerText(),'Parar');
  updateRequest(lastQueuedId,'completed');
  await page.waitForFunction(()=>document.querySelector('#messages>li:last-child .message-content')?.textContent==='Resposta da fila concluída.');
  assert.equal(await page.locator('#cancel-request').isVisible(),false);
  assert.equal(sendAttempts.length,queuedSends,'queue lifecycle only reads status');
  deferNext=true;uncertain=true;
  await page.locator('#command').fill('Outro pedido aguardando na fila');await page.locator('#send').click();await page.locator('#recovery').waitFor({state:'visible'});
  const queueRecoverySends=sendAttempts.length;
  await page.locator('#recover-request').click();await page.locator('#recovery').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('#messages>li:last-child .message-state')?.textContent==='Na fila');
  assert.equal(sendAttempts.length,queueRecoverySends,'queued receipt recovered with GET only');
  assert.equal(await page.locator('#cancel-request').innerText(),'Cancelar pedido');
  await page.locator('#cancel-request').click();
  await page.waitForFunction(()=>document.querySelector('#messages>li:last-child .message-state')?.textContent==='Cancelado');
  assert.equal(cancellations,1);assert.equal(sendAttempts.length,queueRecoverySends);
  assert.equal(await page.locator('#cancel-request').isVisible(),false);
  if(process.env.NEURAL_QA_OUTPUT)await page.screenshot({path:path.join(process.env.NEURAL_QA_OUTPUT,'chat-conversation-mobile.png')});
  deferNext=true;
  await page.locator('#command').fill('Conferir interrupção sem repetir');await page.locator('#send').click();
  await page.waitForFunction(()=>document.querySelector('#messages>li:last-child .message-state')?.textContent==='Na fila');
  const beforeReview=sendAttempts.length;
  updateRequest(lastQueuedId,'interrupted');status.queue=assertChatQueueStatus({enabled:true,pending:0,running:0,requiresReview:true,unresolved:1});
  await page.locator('#queue-review-notice').waitFor({state:'visible'});
  assert.match(await page.locator('#queue-review-notice').innerText(),/Não reenvie para evitar duplicação/);
  assert.equal(await page.locator('#cancel-request').isVisible(),false,'review hold is not running');
  await page.locator('#command').fill('Rascunho preservado durante conferência');assert.equal(await page.locator('#send').isDisabled(),true);
  assert.equal(sendAttempts.length,beforeReview);
  if(process.env.NEURAL_QA_OUTPUT)await page.screenshot({path:path.join(process.env.NEURAL_QA_OUTPUT,'chat-review-mobile.png')});
  await page.reload();await page.locator('#queue-review-notice').waitFor({state:'visible'});
  await page.locator('#command').fill('Não repetir');assert.equal(await page.locator('#send').isDisabled(),true);
  assert.equal(sendAttempts.length,beforeReview,'review reload is GET only');
  status.queue=assertChatQueueStatus({enabled:true,pending:0,running:0,requiresReview:false,unresolved:0});
  status.mode='shadow';status.capabilities.text=false;
  const beforeShadow=sends;
  await page.reload();
  await page.waitForFunction(()=>document.getElementById('mode-label').textContent==='Em preparação');
  assert.equal(await page.locator('#service-status').innerText(),'Histórico conectado · respostas ainda indisponíveis');
  assert.equal(await page.locator('#capability-notice').isVisible(),true);
  assert.match(await page.locator('#capability-notice').innerText(),/modelo ainda não está habilitado para responder/);
  assert.equal(await page.locator('#attach').isEnabled(),true);
  await page.locator('#command').fill('Guardar meu pedido');assert.equal(await page.locator('#send').isEnabled(),true);
  assert.equal(sends,beforeShadow,'shadow status check cannot submit requests');
  if(process.env.NEURAL_QA_OUTPUT)await page.screenshot({path:path.join(process.env.NEURAL_QA_OUTPUT,'chat-preparing-mobile.png')});
  await page.getByRole('button',{name:'Mostrar conversas'}).click();
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:/Excluir conversa Minha conversa/}).click();
  await page.waitForFunction(()=>document.getElementById('history-empty')?.hidden===false);
  assert.equal(deletions,1,'conversation deletion requires confirmation and reaches server once');
  assert.equal(await page.locator('#messages>li').count(),0);
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,viewports:results,continuousConversation:true,historyRecoveredWithoutPost:true,attachmentsPreviewRemove:true,attachmentUploads:uploads,unsupportedPdfHonest:true,videoUnavailableHonest:true,shadowReadinessHonest:true,shadowStorageAvailable:true,timeoutRecoveredWithGet:true,explicitSamePayloadRetryAfter404:true,noAttachmentReupload:true,secondLossHeld:true,queuedRunningCompleted:true,queuedReloadGetOnly:true,queuedRecoveryGetOnly:true,queuedCancellation:true,invalidHistoryHeld:true,missingAssistantReceiptChecked:true,reviewStatusVisible:true,reviewReloadGetOnly:true,canonicalReceipts:true,imeSafe:true,conversationDelete:true,externalRequests:0,paidCalls:0}));
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
