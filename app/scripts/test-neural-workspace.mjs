import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mountNeuralWorkspace, validateNeuralAttachment } from '../public/neural-workspace.js';
const html = readFileSync(new URL('../public/neural-workspace.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../public/neural-workspace.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/neural-workspace.css', import.meta.url), 'utf8');
assert.match(html, /lang="pt-BR"/);
assert.match(html, /name="viewport"/);
assert.match(html, /<script type="module" src="\/neural-workspace\.js"><\/script>/);
assert.match(html, /Lia/);
assert.match(html, /PDF e DOCX ainda não/);
assert.match(html, /ainda não interpreta seu conteúdo visual/);
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
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=items;}
  setAttribute(k,v){this.attributes[k]=v;}
  getAttribute(k){return this.attributes[k]??null;}
  addEventListener(k,f){this.listeners[k]=f;}
  remove(){this.removed=true;}
  focus(){this.focused=true;}
  click(){return this.listeners.click?.({preventDefault(){}});}
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function settled(){for(let i=0;i<5;i++)await settle();}
function harness({search='',respond}){
  const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(([,id])=>[id,new Element()]));
  elements.get('history-toggle').attributes['aria-expanded']='false';
  const calls=[],timers=new Map(),listeners=new Map(),created=[],revoked=[];let uuid=0,timer=0;
  class FakeURL extends URL {static createObjectURL(){return 'blob:private-'+(++uuid);}static revokeObjectURL(url){revoked.push(url);}}
  class Reader{readAsDataURL(){this.result='data:text/plain;base64,aGVsbG8=';this.onload();}}
  mountNeuralWorkspace({document:{getElementById:id=>elements.get(id),createElement:tag=>{const e=new Element(tag);created.push(e);return e;},querySelectorAll:()=>[],body:new Element('body')},window:{addEventListener:(k,v)=>listeners.set(k,v)},location:{search},URLSearchParams,URL:FakeURL,Blob,AbortController,FileReader:Reader,crypto:{randomUUID:()=> 'message-request-'+(++uuid)},setTimeout:(f,ms)=>{timers.set(++timer,{f,ms});return timer;},clearTimeout:id=>timers.delete(id),fetch:async(url,options)=>{
    calls.push({url,options});const result=await respond(url,options);
    return {ok:(!result.status||result.status<400),status:result.status||200,json:async()=>result.data,blob:async()=>new Blob([result.body||'photo'],{type:result.mime||'image/png'})};
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
  if(url.endsWith('/messages')){const body=JSON.parse(options.body);posts++;received.push(body);currentMessages.push({id:'u'+posts,role:'user',text:body.message,status:'completed',attachments:[]},{id:'a'+posts,role:'assistant',text:malicious,status:'completed',attachments:[]});return {data:{ok:true,conversationId:conversation.id,requestId:'request-'+posts,status:'completed'}};}
  if(url.endsWith('/conversations/'+conversation.id))return {data:{ok:true,conversation,messages:currentMessages}};
  throw Error('Unexpected '+url);
}});
await settled();
assert.equal(app.calls.length,2);
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
  if(url.includes('/requests/by-key/'))return found?{data:{ok:true,request:{conversationId:'c-found'}}}:{status:404};
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
    return {data:{ok:true,conversationId:'c-original',requestId:'same-receipt',status:'completed'}};
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
console.log('Lia chat UI: continuous conversations, attachment validation/context, scoped auth, inert output, IME, recovery-only GET, no duplicate POST and restored history passed.');
