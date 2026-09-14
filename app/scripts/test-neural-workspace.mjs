import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mountNeuralWorkspace, validateNeuralAttachment } from '../public/neural-workspace.js';
import { CHAT_MESSAGE_STATES, CHAT_ACTIVE_STATES, isChatActive, assertChatReceipt, assertChatQueueStatus } from '../public/neural-chat-contract.js';
import {assertCoinStatus,VITRINE_COINS_POLICY} from '../public/vitrine-coins-contract.js';
const receipt = (overrides={}) => {
  const requestId=overrides.requestId||'request-fixture';
  return assertChatReceipt({id:requestId,requestId,conversationId:'conversation-1',messageId:'message-fixture',status:'completed',createdAt:1,updatedAt:1,...overrides});
};
const html = readFileSync(new URL('../public/neural-workspace.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../public/neural-workspace.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/neural-workspace.css', import.meta.url), 'utf8');
assert.match(html, /lang="pt-BR"/);
assert.match(html, /name="viewport"/);
assert.match(html, /<script type="module" src="\/neural-workspace\.js"><\/script>/);
assert.match(html, /Lia/);
assert.match(html, /PDF e DOCX ainda não/);
assert.match(html, /media-capability-note/);
assert.match(html, /histórico privado/);
assert.match(html, /role="alert"/);
assert.match(html, /aria-live="polite"/);
assert.doesNotMatch(html, /<select\b|<iframe\b|on(?:click|load|error)=/i);
assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function|localStorage|sessionStorage/);
assert.doesNotMatch(js, /[?&](?:token|access_token|key)=/i);
assert.match(js, /headers\['x-store-token'\] = state\.token/);
assert.match(js, /headers\['x-neural-request'\] = '1'/);
assert.match(js, /credentials: 'same-origin'/);
assert.match(js, /cache: 'no-store'/);
assert.match(js, /isComposing/);
assert.match(js, /keyCode !== 229/);
assert.match(js, /from '\.\/neural-chat-contract\.js'/);
assert.match(js, /new Set\(CHAT_MESSAGE_STATES\)/);
assert.ok(CHAT_MESSAGE_STATES.includes('queued'));
assert.ok(CHAT_ACTIVE_STATES.every(isChatActive));
assert.equal(isChatActive('completed'),false);
assert.match(css, /@media\(max-width:700px\)/);
assert.match(css, /focus-visible/);
for (const [, id] of js.matchAll(/\$\('([^']+)'\)/g)) assert.ok(html.includes('id="' + id + '"'), 'Missing selector ' + id);
assert.equal(validateNeuralAttachment({name:'photo.png',type:'image/png',size:100}).kind,'image');
assert.equal(validateNeuralAttachment({name:'notes.md',type:'',size:100}).mimeType,'text/markdown');
assert.throws(()=>validateNeuralAttachment({name:'secret.svg',type:'image/svg+xml',size:10}),/attachment_type/);
assert.throws(()=>validateNeuralAttachment({name:'notes.pdf',type:'application/pdf',size:10}),/attachment_type/);
assert.throws(()=>validateNeuralAttachment({name:'large.txt',type:'text/plain',size:65537}),/attachment_size/);

class Element {
  constructor(tag='div') { this.tagName=tag;this.textContent='';this.value='';this.hidden=false;this.disabled=false;this.children=[];this.attributes={};this.listeners={};this.dataset={};this.style={};this.scrollHeight=100;this.scrollTop=0;this.clientHeight=100;this.classList={toggle:(name,value)=>{this.attributes[name]=value;}}; }
  append(...items){for(const item of items){item.remove();item.parent=this;this.children.push(item);}}
  insertBefore(item,before){item.remove();item.parent=this;const index=before?this.children.indexOf(before):-1;if(index<0)this.children.push(item);else this.children.splice(index,0,item);}
  replaceChildren(...items){for(const item of this.children)item.parent=null;this.children=[];this.append(...items);}
  setAttribute(k,v){this.attributes[k]=v;}
  getAttribute(k){return this.attributes[k]??null;}
  addEventListener(k,f){this.listeners[k]=f;}
  remove(){this.removed=true;if(this.parent){this.parent.children=this.parent.children.filter(item=>item!==this);this.parent=null;}}
  focus(){this.focused=true;}
  click(){return this.listeners.click?.({preventDefault(){}});}
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function settled(){for(let i=0;i<5;i++)await settle();}
function harness({search='',respond,coinStatus=null}){
  const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(([,id])=>[id,new Element()]));
  elements.get('history-toggle').attributes['aria-expanded']='false';
  const calls=[],timers=new Map(),listeners=new Map(),created=[],revoked=[];let uuid=0,timer=0;
  class FakeURL extends URL {static createObjectURL(){return 'blob:private-'+(++uuid);}static revokeObjectURL(url){revoked.push(url);}}
  class Reader{readAsDataURL(){this.result='data:text/plain;base64,aGVsbG8=';this.onload();}}
  mountNeuralWorkspace({document:{getElementById:id=>elements.get(id),createElement:tag=>{const e=new Element(tag);created.push(e);return e;},querySelectorAll:()=>[],body:new Element('body')},window:{addEventListener:(k,v)=>listeners.set(k,v)},location:{search},URLSearchParams,URL:FakeURL,Blob,AbortController,FileReader:Reader,crypto:{randomUUID:()=> 'message-request-'+(++uuid)},setTimeout:(f,ms)=>{timers.set(++timer,{f,ms});return timer;},clearTimeout:id=>timers.delete(id),fetch:async(url,options)=>{
    calls.push({url,options});const result=url==='/api/coins/status'?(coinStatus?{data:coinStatus}:{status:503,data:{ok:false}}):await respond(url,options);
    return {ok:(!result.status||result.status<400),status:result.status||200,headers:{get:key=>key==='content-type'?(result.mime||'image/png'):null},json:async()=>result.data,blob:async()=>new Blob([result.body||'photo'],{type:result.mime||'image/png'})};
  }});
  return {elements,calls,timers,listeners,created,revoked,submit:()=>elements.get('command-form').listeners.submit({preventDefault(){}})};
}
const base='/api/admin/vitriny-neural/chat';
const status={ok:true,enabled:true,paidGenerationEnabled:false,capabilities:{text:true,image:false,video:false}};
let received=[],conversation={id:'conversation-1',title:'Uma conversa'},currentMessages=[],posts=0;
const malicious='<img src=x onerror=alert(1)>';
const app=harness({respond:async(url,options)=>{
  if(url.endsWith('/status'))return {data:status};
  if(url.endsWith('/conversations'))return {data:{ok:true,items:currentMessages.length?[conversation]:[]}};
  if(url.endsWith('/attachments')&&options.method==='POST')return {data:{ok:true,attachment:{id:'attachment-1',name:'notes.txt',kind:'text',mimeType:'text/plain',bytes:5}}};
  if(url.endsWith('/messages')){const body=JSON.parse(options.body);posts++;received.push(body);currentMessages.push({id:'u'+posts,role:'user',text:body.message,status:'completed',attachments:[]},{id:'a'+posts,role:'assistant',text:malicious,status:'completed',attachments:[]});return {data:{ok:true,...receipt({conversationId:conversation.id,requestId:'request-'+posts,messageId:'u'+posts})}};}
  if(url.endsWith('/conversations/'+conversation.id))return {data:{ok:true,conversation,messages:currentMessages}};
  throw Error('Unexpected '+url);
}});
await settled();
assert.equal(app.calls.length,3);
app.elements.get('command').value='Crie uma descrição';
const first=app.submit();await app.submit();await first;
assert.equal(posts,1,'double send must not duplicate');
assert.equal(received[0].conversationId,undefined);
assert.equal(app.elements.get('messages').children.length,2);
assert.equal(app.elements.get('messages').children[1].children[1].textContent,malicious);
assert.ok(!app.created.some(e=>['iframe','script','img'].includes(e.tagName)),'generated markup is inert');
app.elements.get('command').value='Agora mais curta';await app.submit();
assert.equal(received[1].conversationId,'conversation-1','follow-up stays in same conversation');
assert.equal(app.elements.get('messages').children.length,4,'entire conversation remains visible');
assert.ok(received[1].idempotencyKey!==received[0].idempotencyKey);
app.elements.get('new-conversation').click();
assert.equal(app.elements.get('messages').children.length,0);
assert.equal(app.elements.get('conversation-list').children.length,1,'new conversation does not delete history');
app.elements.get('attachment-input').listeners.change({target:{files:[{name:'notes.txt',type:'text/plain',size:5}]}});
assert.equal(app.elements.get('attachment-previews').children.length,1);
assert.equal(app.calls.filter(c=>c.url.endsWith('/attachments')).length,0,'selection alone does not upload');
app.elements.get('command').value='Resuma este documento';await app.submit();
assert.deepEqual(received[2].attachmentIds,['attachment-1']);
const upload=app.calls.find(c=>c.url.endsWith('/attachments'));
assert.equal(JSON.parse(upload.options.body).mimeType,'text/plain');
assert.equal(upload.options.headers['x-neural-request'],'1');
app.elements.get('history-toggle').click();
assert.equal(app.elements.get('history-toggle').attributes['aria-expanded'],'true');
app.listeners.get('keydown')({key:'Escape'});
assert.equal(app.elements.get('history-toggle').attributes['aria-expanded'],'false');
assert.equal(app.elements.get('history-toggle').focused,true);
let prevented=false;
app.elements.get('command').listeners.keydown({key:'Enter',shiftKey:false,isComposing:true,preventDefault(){prevented=true;}});
assert.equal(prevented,false,'IME Enter does not submit');

let found=false,uncertainPosts=0;
const uncertain=harness({respond:async(url,options)=>{
  if(url.endsWith('/status'))return {data:status};
  if(url.endsWith('/conversations'))return {data:{ok:true,items:[]}};
  if(url.endsWith('/messages')){uncertainPosts++;throw Error('Network unavailable');}
  if(url.includes('/requests/by-key/'))return found?{data:{ok:true,request:receipt({conversationId:'c-found'})}}:{status:404};
  if(url.endsWith('/conversations/c-found'))return {data:{ok:true,conversation:{id:'c-found',title:'Recovered'},messages:[{id:'m-found',role:'assistant',text:'Recebido',status:'completed'}]}};
  throw Error('unexpected '+url);
}});
await settled();uncertain.elements.get('command').value='Pedido incerto';await uncertain.submit();await uncertain.submit();
assert.equal(uncertainPosts,1,'uncertain submission cannot be POSTed again');
assert.equal(uncertain.elements.get('recovery').hidden,false);
assert.equal(uncertain.elements.get('command').value,'Pedido incerto');
await uncertain.elements.get('recover-request').click();assert.equal(uncertainPosts,1);
found=true;await uncertain.elements.get('recover-request').click();
assert.equal(uncertain.elements.get('recovery').hidden,true);
assert.equal(uncertain.elements.get('command').value,'');
assert.equal(uncertainPosts,1);
let retryPosts=0,retryUploads=0;
const retryPayloads=[];
const retryOriginalConversation={id:'c-original',title:'Contexto original'};
const explicitRetry=harness({respond:async(url,options)=>{
  if(url.endsWith('/status'))return {data:status};
  if(url.endsWith('/conversations'))return {data:{ok:true,items:[retryOriginalConversation]}};
  if(url.endsWith('/conversations/c-original'))return {data:{ok:true,conversation:retryOriginalConversation,messages:[]}};
  if(url.endsWith('/attachments')){retryUploads++;return {data:{ok:true,attachment:{id:'attachment-retry',name:'contexto.txt',mimeType:'text/plain',kind:'text',bytes:5}}};}
  if(url.includes('/requests/by-key/'))return {status:404};
  if(url.endsWith('/messages')){
    retryPosts++;retryPayloads.push(options.body);
    if(retryPosts<=2)throw Error('Response lost before receipt confirmation');
    return {data:{ok:true,...receipt({conversationId:'c-original',requestId:'same-receipt'})}};
  }
  throw Error('unexpected retry request '+url);
}});
await settled();
explicitRetry.elements.get('attachment-input').listeners.change({target:{files:[{name:'contexto.txt',type:'text/plain',size:5}]}});
explicitRetry.elements.get('command').value='Pedido original com contexto';await explicitRetry.submit();
assert.equal(retryPosts,1);assert.equal(retryUploads,1);
assert.equal(explicitRetry.elements.get('command').disabled,true,'uncertain draft stays immutable in the composer');
assert.equal(explicitRetry.elements.get('retry-request').hidden,true,'explicit retry is unavailable before GET 404');
await explicitRetry.elements.get('retry-request').click();assert.equal(retryPosts,1);
await explicitRetry.elements.get('recover-request').click();assert.equal(retryPosts,1,'GET 404 never posts automatically');
assert.equal(explicitRetry.elements.get('retry-request').hidden,false);
await explicitRetry.elements.get('refresh').click();await settled();assert.equal(retryPosts,1,'history refresh never retries');
explicitRetry.elements.get('command').value='DOM tampering must not replace pending payload';
const retryClick=explicitRetry.elements.get('retry-request').click();await explicitRetry.elements.get('retry-request').click();await retryClick;
assert.equal(retryPosts,2,'double click dispatches only one explicit retry');
assert.equal(retryUploads,1,'retry does not upload attachments again');
assert.equal(retryPayloads[1],retryPayloads[0],'retry preserves exact body, key, original conversation and attachment IDs');
assert.equal(explicitRetry.elements.get('recovery').hidden,false,'second uncertain result keeps the hold');
assert.equal(explicitRetry.elements.get('retry-request').hidden,true,'another retry requires a fresh 404 recovery');
await explicitRetry.submit();assert.equal(retryPosts,2);
await explicitRetry.elements.get('recover-request').click();assert.equal(retryPosts,2);
await explicitRetry.elements.get('retry-request').click();
assert.equal(retryPosts,3);assert.equal(retryPayloads[2],retryPayloads[0]);assert.equal(retryUploads,1);
assert.equal(explicitRetry.elements.get('recovery').hidden,true);
assert.equal(explicitRetry.elements.get('command').value,'');
assert.equal(explicitRetry.elements.get('attachment-previews').children.length,0);
const store=harness({search:'?store=loja%2Fum',respond:async(url,options)=>{
  assert.ok(url.startsWith('/api/store-portal/loja%2Fum/neural/chat'));
  assert.equal(options.headers['x-store-token'],'private-password');
  assert.ok(!url.includes('private-password'));
  return url.endsWith('/status')?{data:status}:{data:{ok:true,items:[]}};
}});
assert.equal(store.calls.length,0);
store.elements.get('access-token').value='private-password';
store.elements.get('access-form').listeners.submit({preventDefault(){}});
await settled();
assert.equal(store.elements.get('access-token').value,'');
assert.equal(store.elements.get('billing-link').href,'/neural-billing.html?store=loja%2Fum');
assert.equal(store.elements.get('tasks-link').href,'/neural-tasks.html?store=loja%2Fum');
store.elements.get('disconnect').click();
assert.equal(store.elements.get('send').disabled,true);
assert.equal(store.elements.get('messages').children.length,0);
const shadow=harness({respond:async url=>url.endsWith('/status')?{data:{...status,mode:'shadow',capabilities:{text:false,image:false,video:false}}}:{data:{ok:true,items:[]}}});
await settled();
assert.equal(shadow.elements.get('service-status').textContent,'Histórico conectado · respostas ainda indisponíveis');
assert.equal(shadow.elements.get('mode-label').textContent,'Em preparação');
assert.equal(shadow.elements.get('capability-notice').hidden,false);
assert.equal(shadow.elements.get('attach').disabled,false,'attachments remain available in history-only mode');
shadow.elements.get('command').value='Guardar meu pedido';shadow.elements.get('command').listeners.input();
assert.equal(shadow.elements.get('send').disabled,false,'saving a message remains available in history-only mode');
assert.match(shadow.elements.get('billing-status').textContent,/Gerações pagas não estão ativas/);
const reopened=harness({respond:async(url,options)=>{
  assert.equal(options.method,'GET','reopening never posts');
  return url.endsWith('/status')?{data:status}:url.endsWith('/conversations')?{data:{ok:true,items:[conversation]}}:{data:{ok:true,conversation,messages:[{id:'a-running',role:'assistant',text:'',status:'running',requestId:'r-existing'}]}};
}});
await settled();assert.equal(reopened.elements.get('send').disabled,true);assert.ok([...reopened.timers.values()].some(t=>t.ms===2000));
let queueState='queued';
const queueReceipt=()=>receipt({requestId:'request-queued',status:queueState,...(queueState==='queued'?{queue:{lane:'chat',position:2}}:{})});
const queueMessages=()=>[{id:'message-user-queued',role:'user',text:'Pedido na fila',status:'completed',requestId:'request-queued'}, {id:'message-assistant-queued',role:'assistant',text:queueState==='completed'?'Resposta concluída.':'',status:queueState,requestId:'request-queued',...(queueState==='queued'?{queue:{lane:'chat',position:2}}:{})}];
const queued=harness({respond:async(url,options)=>{
  if(url.endsWith('/status'))return {data:status};
  if(url.endsWith('/conversations'))return {data:{ok:true,items:[conversation]}};
  if(url.endsWith('/conversations/conversation-1'))return {data:{ok:true,conversation,messages:options.method==='GET'?queueMessages():[]}};
  if(url.endsWith('/messages'))return {data:{ok:true,...queueReceipt()}};
  throw Error('Unexpected queue request '+url);
}});
await settled();
assert.equal(queued.elements.get('send').disabled,true,'reopening queued work blocks a duplicate send');
assert.equal(queued.elements.get('new-conversation').disabled,true);
assert.equal(queued.elements.get('cancel-request').hidden,false);
assert.equal(queued.elements.get('cancel-request').textContent,'Cancelar pedido');
assert.equal(queued.elements.get('messages').children[1].attributes['aria-busy'],'true');
assert.equal(queued.elements.get('messages').children[1].children.at(-1).textContent,'Na fila · posição 2');
assert.equal(queued.calls.filter(call=>call.options.method==='POST').length,0,'recovered queue only issues GET');
await queued.elements.get('refresh').click();await settled();
assert.equal(queued.calls.filter(call=>call.options.method==='POST').length,0,'refreshing queued work does not dispatch');
queueState='running';await [...queued.timers.values()].find(timer=>timer.ms===2000).f();
assert.equal(queued.elements.get('messages').children[1].children.at(-1).textContent,'Em andamento');
assert.equal(queued.elements.get('cancel-request').textContent,'Parar');
assert.match(queued.elements.get('announcement').textContent,/saiu da fila/);
queueState='completed';queued.elements.get('command').value='Próximo pedido';await [...queued.timers.values()].find(timer=>timer.ms===2000).f();
assert.equal(queued.elements.get('cancel-request').hidden,true);
assert.equal(queued.elements.get('send').disabled,false);
assert.equal(queued.elements.get('messages').children[1].children[1].textContent,'Resposta concluída.');
assert.ok(![...queued.timers.values()].some(timer=>timer.ms===2000),'terminal state stops polling');
queueState='queued';
const queuedCancel=harness({respond:async(url,options)=>{
  if(url.endsWith('/status'))return {data:status};
  if(url.endsWith('/conversations'))return {data:{ok:true,items:[conversation]}};
  if(url.endsWith('/conversations/conversation-1'))return {data:{ok:true,conversation,messages:queueMessages()}};
  if(url.endsWith('/requests/request-queued/cancel')){assert.equal(options.body,'{}');queueState='cancelled';return {data:{ok:true,...queueReceipt()}};}
  throw Error('Unexpected queued cancellation '+url);
}});
await settled();await queuedCancel.elements.get('cancel-request').click();
assert.equal(queuedCancel.calls.filter(call=>call.options.method==='POST').length,1);
assert.equal(queuedCancel.elements.get('cancel-request').hidden,true);
assert.equal(queuedCancel.elements.get('messages').children[1].children.at(-1).textContent,'Cancelado');
assert.equal(queuedCancel.elements.get('announcement').textContent,'Cancelamento confirmado.');
// Even if conversation readback fails, a valid queued receipt must remain active
// and polled; a malformed receipt must never discard the pending command.
for(const mode of ['post','recovery','retry']){
  let sent=0,foundQueued=false;
  const pendingQueue=harness({respond:async(url)=>{
    if(url.endsWith('/status'))return {data:status};
    if(url.endsWith('/conversations'))return {data:{ok:true,items:[]}};
    if(url.endsWith('/messages')){sent++;if(mode!=='post'&&sent===1)throw Error('lost reply');return {data:{ok:true,...receipt({status:'queued',requestId:'receipt-queued',queue:{lane:'chat',position:null}})}};}
    if(url.includes('/requests/by-key/'))return mode==='retry'&&!foundQueued?{status:404}:{data:{ok:true,request:receipt({status:'queued',requestId:'receipt-queued'})}};
    if(url.endsWith('/conversations/conversation-1'))return {status:503};
    throw Error('Unexpected receipt '+url);
  }});
  await settled();pendingQueue.elements.get('command').value='Pedido durável';await pendingQueue.submit();
  if(mode!=='post'){await pendingQueue.elements.get('recover-request').click();if(mode==='retry'){foundQueued=true;await pendingQueue.elements.get('retry-request').click();}}
  assert.equal(pendingQueue.elements.get('cancel-request').hidden,false,mode+' receipt keeps queued work active');
  assert.equal(pendingQueue.elements.get('send').disabled,true);
  assert.ok([...pendingQueue.timers.values()].some(timer=>timer.ms===2000),mode+' polls even if first history read fails');
  assert.equal(sent,mode==='retry'?2:1);
}
const invalidReceipt=harness({respond:async url=>url.endsWith('/status')?{data:status}:url.endsWith('/conversations')?{data:{ok:true,items:[]}}:url.endsWith('/messages')?{data:{ok:true,conversationId:'conversation-1',requestId:'incomplete',status:'queued'}}:{data:{ok:true,request:{conversationId:'conversation-1',status:'queued'}}}});
await settled();invalidReceipt.elements.get('command').value='Preserve o pedido';await invalidReceipt.submit();
assert.equal(invalidReceipt.elements.get('recovery').hidden,false);
assert.equal(invalidReceipt.elements.get('command').value,'Preserve o pedido');
await invalidReceipt.elements.get('recover-request').click();
assert.equal(invalidReceipt.elements.get('recovery').hidden,false,'invalid recovery receipt cannot release uncertainty');
assert.equal(invalidReceipt.calls.filter(call=>call.options.method==='POST').length,1);
// Unknown message states are not silently omitted: an invalid history must not
// release a request or make another send possible, including after reopening.
for (const scenario of ['unknown-state', 'duplicate-id', 'missing-request', 'wrong-conversation']) {
  let corrupt=false;
  const guarded=harness({respond:async url=>{
    if(url.endsWith('/status'))return {data:status};
    if(url.endsWith('/conversations'))return {data:{ok:true,items:[conversation]}};
    const message={id:'a-guarded',role:'assistant',text:'',status:'queued',requestId:'r-guarded'};
    if(corrupt&&scenario==='unknown-state')message.status='maybe-finished';
    if(corrupt&&scenario==='missing-request')delete message.requestId;
    return {data:{ok:true,conversation:corrupt&&scenario==='wrong-conversation'?{id:'someone-else'}:conversation,messages:corrupt&&scenario==='duplicate-id'?[message,message]:[message]}};
  }});
  await settled();guarded.elements.get('command').value='Não duplicar';corrupt=true;
  await [...guarded.timers.values()].find(timer=>timer.ms===2000).f();
  assert.equal(guarded.elements.get('send').disabled,true,scenario+' cannot unlock a known request');
  assert.equal(guarded.elements.get('cancel-request').hidden,false);
  assert.match(guarded.elements.get('error').textContent,/confirmar a resposta/);
  await guarded.submit();assert.equal(guarded.calls.filter(call=>call.options.method==='POST').length,0);
}
// A well-formed but partial conversation needs the same request's receipt.
for (const confirmation of ['queued','running','completed','wrong-id','wrong-conversation','invalid','not-found']) {
  let omit=false,requestReads=0;
  const partial=harness({respond:async url=>{
    if(url.endsWith('/status'))return {data:status};
    if(url.endsWith('/conversations'))return {data:{ok:true,items:[conversation]}};
    if(url.endsWith('/requests/r-partial')){
      requestReads++;
      if(confirmation==='not-found')return {status:404};
      const proof=receipt({requestId:confirmation==='wrong-id'?'wrong-request':'r-partial',conversationId:confirmation==='wrong-conversation'?'wrong-conversation':conversation.id,status:['queued','running','completed'].includes(confirmation)?confirmation:'completed'});
      if(confirmation==='invalid')delete proof.messageId;
      return {data:{ok:true,request:proof}};
    }
    return {data:{ok:true,conversation,messages:omit?[]:[{id:'a-partial',role:'assistant',text:'',status:'queued',requestId:'r-partial'}]}};
  }});
  await settled();partial.elements.get('command').value='Próximo pedido';omit=true;
  await [...partial.timers.values()].find(timer=>timer.ms===2000).f();
  assert.equal(requestReads,1,'partial history confirms with GET receipt');
  assert.equal(partial.elements.get('send').disabled,confirmation!=='completed',confirmation+' receipt releases only a proven terminal request');
  assert.equal(partial.calls.filter(call=>call.options.method==='POST').length,0);
}
// Review holds are owner-scoped status, not a fake in-progress message. The
// visible warning survives reload and makes no promise of automatic release.
const needsReview=assertChatQueueStatus({enabled:true,pending:0,running:0,requiresReview:true,unresolved:1});
let reviewState='queued',reviewQueue={...needsReview,requiresReview:false,unresolved:0,pending:1};
const review=harness({respond:async url=>{
  if(url.endsWith('/status'))return {data:{...status,queue:reviewQueue}};
  if(url.endsWith('/conversations'))return {data:{ok:true,items:[conversation]}};
  return {data:{ok:true,conversation,messages:[{id:'a-review',requestId:'r-review',role:'assistant',text:'',status:reviewState}]}};
}});
await settled();reviewState='interrupted';reviewQueue=needsReview;
await [...review.timers.values()].find(timer=>timer.ms===2000).f();
assert.equal(review.elements.get('queue-review-notice').hidden,false);
assert.match(review.elements.get('queue-review-notice').textContent,/interrompido aguardando conferência.*Não reenvie/);
assert.equal(review.elements.get('cancel-request').hidden,true,'interrupted review is not shown as running');
review.elements.get('command').value='Não repetir';review.elements.get('command').listeners.input();
assert.equal(review.elements.get('send').disabled,true);
assert.equal(review.elements.get('command').disabled,false,'draft can still be edited');
await review.elements.get('refresh').click();await settled();await review.submit();
assert.equal(review.elements.get('queue-review-notice').hidden,false);
assert.equal(review.calls.filter(call=>call.options.method==='POST').length,0,'review and refresh never dispatch');
const malformedQueue=harness({respond:async url=>url.endsWith('/status')?{data:{...status,queue:{...needsReview,requiresReview:false}}}:{data:{ok:true,items:[]}}});
await settled();malformedQueue.elements.get('command').value='Não enviar';malformedQueue.elements.get('command').listeners.input();
assert.equal(malformedQueue.elements.get('send').disabled,true,'invalid queue status cannot enable the composer');
let initialHistoryInvalid=true;
const invalidReopened=harness({respond:async url=>url.endsWith('/status')?{data:status}:url.endsWith('/conversations')?{data:{ok:true,items:[conversation]}}:{data:{ok:true,conversation,messages:[{id:'a-reopened',requestId:'r-reopened',role:'assistant',text:'Confira o estado',status:initialHistoryInvalid?'unknown':'completed'}]}}});
await settled();invalidReopened.elements.get('command').value='Rascunho preservado';invalidReopened.elements.get('command').listeners.input();
assert.equal(invalidReopened.elements.get('send').disabled,true,'invalid first history read fails closed without a previously known request');
assert.equal(invalidReopened.elements.get('new-conversation').disabled,true);
initialHistoryInvalid=false;await invalidReopened.elements.get('refresh').click();await settled();
assert.equal(invalidReopened.elements.get('send').disabled,false,'a valid explicit refresh can finish the history check');
assert.equal(invalidReopened.elements.get('command').value,'Rascunho preservado');
assert.equal(invalidReopened.calls.filter(call=>call.options.method==='POST').length,0);
// A cancelled account's pending HTTP result must not alter the new session.
let finishOldCancel;
const switched=harness({search:'?store=one',respond:async(url,options)=>{
  if(url.endsWith('/status'))return {data:status};
  if(url.endsWith('/conversations'))return {data:{ok:true,items:options.headers['x-store-token']==='first'?[conversation]:[]}};
  if(url.endsWith('/cancel'))return new Promise(resolve=>{finishOldCancel=resolve;});
  return {data:{ok:true,conversation,messages:[{id:'a-old',role:'assistant',text:'',status:'queued',requestId:'r-old'}]}};
}});
switched.elements.get('access-token').value='first';switched.elements.get('access-form').listeners.submit({preventDefault(){}});await settled();
const oldCancellation=switched.elements.get('cancel-request').click();await settled();
switched.elements.get('disconnect').click();
switched.elements.get('access-token').value='second';switched.elements.get('access-form').listeners.submit({preventDefault(){}});await settled();
switched.elements.get('command').value='Rascunho do novo acesso';
finishOldCancel({data:{ok:true,...receipt({requestId:'r-old',status:'cancelled'})}});await oldCancellation;
assert.equal(switched.elements.get('messages').children.length,0);
assert.equal(switched.elements.get('command').value,'Rascunho do novo acesso');
assert.equal(switched.elements.get('cancel-request').hidden,true);
assert.notEqual(switched.elements.get('announcement').textContent,'Cancelamento confirmado.');
console.log('Lia chat UI: canonical receipts, durable queue lifecycle/cancellation, invalid-history fail-closed, missing-message receipt recovery, scoped review holds, stale cancellation isolation, context, IME, GET recovery, exact retry and readiness transparency passed.');

// Paid operations have an explicit quote boundary; polls and reloads are GET-only.
const quotedPayment={quoteId:'quote-paid',currency:'BRL',amountMicro:1150000,expiresAt:Date.now()+600000,kind:'video',summary:'Vídeo de 5 segundos',state:'quoted',chargedMicro:null};
const paidWallet={currency:'BRL',availableMicro:5000000,reservedMicro:0};
const paidStatus={...status,paidGenerationEnabled:true,capabilities:{text:true,image:true,video:true},wallet:paidWallet};
const paidArtifacts=[{id:'artifact-video',requestId:'request-paid',kind:'video',name:'video.mp4',mimeType:'video/mp4',bytes:5,durationSeconds:5,availability:'ready'}, {id:'artifact-image',requestId:'request-paid',kind:'image',name:'imagem.png',mimeType:'image/png',bytes:5,availability:'ready'}];
let paidState='awaiting_confirmation',confirmPosts=0,loseConfirmation=true,paidDownloadReads=0;
const paymentView=()=>({...quotedPayment,state:paidState==='completed'?'settled':paidState==='awaiting_confirmation'?'quoted':'reserved',chargedMicro:paidState==='completed'?1000000:null});
const paidReceipt=()=>receipt({requestId:'request-paid',status:paidState,payment:paymentView()});
const paidMessages=()=>[{id:'paid-message',requestId:'request-paid',role:'assistant',text:paidState==='completed'?'Aqui está seu resultado.':'Confira o valor antes de gerar.',status:paidState,payment:paymentView(),artifacts:paidState==='completed'?paidArtifacts:[]}];
const paid=harness({respond:async(url,options)=>{
  if(url.endsWith('/status'))return {data:paidStatus};
  if(url.endsWith('/conversations'))return {data:{ok:true,items:[conversation]}};
  if(url.endsWith('/conversations/'+conversation.id))return {data:{ok:true,conversation,messages:paidMessages()}};
  if(url.endsWith('/requests/request-paid/confirm')){confirmPosts++;assert.deepEqual(Object.keys(JSON.parse(options.body)).sort(),['idempotencyKey','quoteId']);if(loseConfirmation){loseConfirmation=false;throw Error('lost confirmation response');}paidState='queued';return {data:{ok:true,...paidReceipt()}};}
  if(url.endsWith('/requests/request-paid'))return {data:{ok:true,request:paidReceipt()}};
  if(url.includes('/artifacts/')){if(url.endsWith('/download'))paidDownloadReads++;const artifact=paidArtifacts.find(item=>url.includes(item.id));assert.ok(artifact);return {body:'photo',mime:artifact.mimeType};}
  throw Error('unexpected paid route '+url);
}});
await settled();assert.match(paid.elements.get('billing-status').textContent,/5,00.*0,00/);
assert.equal(confirmPosts,0);assert.equal(paid.elements.get('cancel-request').textContent,'Cancelar pedido');
const confirmButton=paid.created.find(element=>element.dataset.confirmPayment==='true');assert.ok(confirmButton&&!confirmButton.disabled);
await confirmButton.click();assert.equal(confirmPosts,1);assert.equal(paid.elements.get('recovery').hidden,false);
await paid.elements.get('recover-request').click();assert.equal(confirmPosts,1);assert.equal(paid.elements.get('recovery').hidden,false,'awaiting state cannot prove an in-flight confirmation was rejected');
await confirmButton.click();assert.equal(confirmPosts,1,'uncertain confirm is never repeated');
paidState='queued';await paid.elements.get('recover-request').click();assert.equal(paid.elements.get('recovery').hidden,true);assert.equal(confirmPosts,1);
paidState='completed';await [...paid.timers.values()].find(timer=>timer.ms===2000).f();await settled();
const videoNode=paid.created.find(element=>element.tagName==='video');assert.ok(videoNode);assert.equal(videoNode.controls,true);assert.equal(videoNode.playsInline,true);assert.equal(videoNode.preload,'metadata');assert.equal(videoNode.autoplay,undefined);assert.ok(videoNode.src.startsWith('blob:'));
assert.equal(paid.created.filter(element=>element.tagName==='video').length,1);
await paid.elements.get('refresh').click();await settled();
assert.equal(paid.created.filter(element=>element.tagName==='video').length,1,'refresh retains the same player DOM node');
assert.equal(paid.calls.filter(call=>call.url.endsWith('/artifacts/artifact-video/content')).length,1,'same artifact is not fetched on every history poll');
const downloadButton=paid.created.find(element=>element.textContent==='Baixar vídeo');await downloadButton.click();assert.equal(paidDownloadReads,1);
assert.equal(paid.calls.filter(call=>call.options.method==='POST').length,1,'view/download/refresh never generate or charge');
const oldVideoUrl=videoNode.src;paid.listeners.get('pagehide')();assert.ok(paid.revoked.includes(oldVideoUrl));assert.equal(paid.elements.get('messages').children.length,0);
for(const invalid of ['wallet','payment','artifact']){
  const invalidPaid=harness({respond:async url=>{
    if(url.endsWith('/status'))return {data:invalid==='wallet'?{...paidStatus,wallet:{...paidWallet,availableMicro:-1}}:paidStatus};
    if(url.endsWith('/conversations'))return {data:{ok:true,items:[conversation]}};
    const message={...paidMessages()[0]};
    if(invalid==='payment')message.payment={...quotedPayment,amountMicro:NaN};
    if(invalid==='artifact')message.artifacts=[{...paidArtifacts[0],url:'https://untrusted.example/video'}];
    return {data:{ok:true,conversation,messages:[message]}};
  }});await settled();invalidPaid.elements.get('command').value='Não repetir';invalidPaid.elements.get('command').listeners.input();assert.equal(invalidPaid.elements.get('send').disabled,true);assert.equal(invalidPaid.created.filter(element=>element.tagName==='video').length,0);assert.equal(invalidPaid.calls.filter(call=>call.options.method==='POST').length,0);
}
console.log('Lia paid media UI: explicit quote, exact confirmation, no repeat on uncertainty, microBRL wallet, retained private player, download, cleanup and malformed-data fail-closed passed.');

const unifiedCoins=assertCoinStatus({ok:true,currency:'VITRINE_COINS',policyVersion:VITRINE_COINS_POLICY.version,unified:true,frozen:false,availableAtoms:'816000000',reservedAtoms:'96000000',chargedAtoms:'0',expiredAtoms:'0'});
const purchaseFixture={ok:true,currency:'BRL',availableMicro:0,reservedMicro:0,chargedMicro:0,expiredMicro:0,frozenMicro:0,frozen:false,canPurchase:true,presetsCents:[1000,2500,5000,10000],terms:{version:VITRINE_COINS_POLICY.version,validityDays:60,summary:'Vitrine Coins válidas por 60 dias.',refunds:'Direitos legais preservados.',feeStage:'topup',topupFeeBps:1500,usageMarkupBps:0,coinsPerBRL:'9.6'},coinWallet:unifiedCoins,orders:[]};
let purchaseAttempts=0;const purchasePayloads=[];
const checkout=harness({coinStatus:unifiedCoins,search:'?personal=1',respond:async(url,options)=>{
  assert.ok(url.startsWith('/api/neural/chat/'),'personal mode uses authenticated personal chat, never admin/store');
  if(url.endsWith('/credits/status'))return {data:purchaseFixture};
  if(url.endsWith('/status'))return {data:paidStatus};
  if(url.endsWith('/conversations'))return {data:{ok:true,items:[]}};
  if(url.endsWith('/credits/checkout')){
    purchaseAttempts++;purchasePayloads.push(options.body);if(purchaseAttempts===1)throw Error('response lost after checkout might exist');
    return {data:{ok:true,order:{reference:'ai_55555555-5555-4555-8555-555555555555',status:'pending',amountCents:1000,checkoutUrl:'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=fixture',createdAt:1,expiresAt:Date.now()+600000}}};
  }
  throw Error('unexpected checkout '+url);
}});
await settled();assert.equal(checkout.calls.some(call=>call.url.includes('/credits')),false,'initial chat does not start purchase checks');
await checkout.elements.get('credits-toggle').click();await settled();assert.equal(purchaseAttempts,0);
let amountButton=checkout.created.find(element=>element.dataset.creditAmount==='1000');await amountButton.click();assert.equal(purchaseAttempts,0,'unchecked terms cannot create checkout even by programmatic click');
checkout.elements.get('credits-terms').checked=true;await amountButton.click();assert.equal(purchaseAttempts,1);assert.equal(checkout.elements.get('credits-retry').hidden,false);
await amountButton.click();assert.equal(purchaseAttempts,1,'uncertain checkout does not create new key');
await checkout.elements.get('credits-refresh').click();assert.equal(purchaseAttempts,1,'status GET never repeats checkout');
await checkout.elements.get('credits-retry').click();assert.equal(purchaseAttempts,2);assert.equal(purchasePayloads[0],purchasePayloads[1],'explicit recovery uses exact purchase key, amount and accepted terms');
assert.equal(checkout.elements.get('credits-retry').hidden,true);assert.ok(checkout.created.some(element=>element.tagName==='a'&&element.href?.startsWith('https://www.mercadopago.com.br/')&&element.rel==='noopener noreferrer'));
console.log('Lia credit purchase UI: explicit consent, no automatic checkout, immutable same-key recovery and official payment link passed.');
