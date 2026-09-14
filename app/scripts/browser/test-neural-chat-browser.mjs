import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=path.resolve(fileURLToPath(new URL('../../public/',import.meta.url)));
const conversation={id:'11111111-1111-4111-8111-111111111111',title:'Minha conversa'};
const files=new Map(),messages=[],requests=new Map(),external=[],errors=[],results=[];
let sends=0,uploads=0,uncertain=false,rejectBeforeReceipt=0;
const sendAttempts=[];
const status={ok:true,enabled:true,mode:'local',paidGenerationEnabled:false,capabilities:{text:true,image:false,video:false},attachments:{maxPerMessage:3,imageMaxBytes:2097152,textMaxBytes:65536}};
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');
    const send=(data,code=200)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    if(url.pathname.startsWith('/api/admin/vitriny-neural/chat')){
      const route=url.pathname.slice('/api/admin/vitriny-neural/chat'.length);
      let body={};
      if(req.method==='POST'){assert.equal(req.headers['x-neural-request'],'1');const chunks=[];for await(const chunk of req)chunks.push(chunk);body=JSON.parse(Buffer.concat(chunks).toString());}
      if(route==='/status')return send(status);
      if(route==='/conversations')return send({ok:true,items:messages.length?[conversation]:[]});
      if(route==='/conversations/'+conversation.id)return send({ok:true,conversation,messages});
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
        messages.push({id:'assistant-'+sends,role:'assistant',text:unavailable?'A geração de vídeo ainda não está disponível neste chat. Sua imagem foi anexada, mas não houve geração.':'Recebi seu pedido. <img src=x onerror=alert(1)> Este texto permanece inerte.',status:unavailable?'unavailable':'completed',attachments:[],requestId});
        requests.set(body.idempotencyKey,{id:requestId,conversationId:conversation.id,status:'completed'});
        if(uncertain){uncertain=false;res.writeHead(200,{'Content-Type':'application/json'});res.end('{');return;}
        return send({ok:true,conversationId:conversation.id,requestId,messageId:'user-'+sends,status:unavailable?'unavailable':'completed'},202);
      }
      if(route.startsWith('/requests/by-key/')){const request=requests.get(decodeURIComponent(route.split('/').pop()));return request?send({ok:true,request}):send({ok:false},404);}
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
  if(process.env.NEURAL_QA_OUTPUT)await page.screenshot({path:path.join(process.env.NEURAL_QA_OUTPUT,'chat-conversation-mobile.png')});
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
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,viewports:results,continuousConversation:true,historyRecoveredWithoutPost:true,attachmentsPreviewRemove:true,attachmentUploads:uploads,unsupportedPdfHonest:true,videoUnavailableHonest:true,shadowReadinessHonest:true,shadowStorageAvailable:true,timeoutRecoveredWithGet:true,explicitSamePayloadRetryAfter404:true,noAttachmentReupload:true,secondLossHeld:true,imeSafe:true,externalRequests:0,paidCalls:0}));
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
