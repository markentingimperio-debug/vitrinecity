import test from 'node:test';
import assert from 'node:assert/strict';
import {socialCampaignPayload,socialRequestKey,socialImageUrl,socialPageUrl,suggestedCaption,mountSocialCampaigns} from '../public/admin-social-comment-campaigns.js';

const origin='https://vitrinecity.com',tick=()=>new Promise(resolve=>setImmediate(resolve));
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const source={key:'editorial:bolo-de-cenoura',title:'Bolo de cenoura',summary:'Ingredientes e preparo do bolo de cenoura.',image:'/uploads/bolo.jpg',url:origin+'/noticias/bolo-de-cenoura',commercial:false};
const account={id:'1',pageId:'1234',pageName:'Campo & Conhecimento',instagramId:'777',instagramUsername:'campo'};
const caption=suggestedCaption(source,'QUERO RECEITA');
const dto=(change={})=>({id:'campaign-1',status:'draft',source,account,surface:'facebook_page',postId:'1234_789',groupId:'',keyword:'QUERO RECEITA',caption,privateReply:'Aqui está a receita: '+source.url,readiness:{ready:true,missing:[]},counts:{sent:0,pending:0},...change});
const payload=(change={})=>({sourceKey:source.key,accountId:'1',surface:'facebook_page',postId:'1234_789',groupId:'',keyword:'QUERO RECEITA',caption,invite:'none',...change});
const catalog={items:[source,{...source,key:'editorial:plantas',title:'<b>Plantas</b>',summary:'Cuidados com plantas.'}],accounts:[account]};

function fixture(t,fetcher,{saved='',denyStorage=false}={}){
  class Element{
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.listeners={};this.dataset={};this.attrs={};this.value='';this.textContent='';this.disabled=false;this.hidden=false;}
    append(...items){this.children.push(...items);}
    replaceChildren(...items){this.children=items;}
    setAttribute(name,value){this.attrs[name]=value;}
    addEventListener(name,fn){(this.listeners[name]||=new Set()).add(fn);}
    removeEventListener(name,fn){this.listeners[name]?.delete(fn);}
    dispatch(name){for(const fn of this.listeners[name]||[])fn({preventDefault(){},target:this});}
    reportValidity(){return true;}
    focus(){this.focused=true;}
    select(){this.selected=true;}
  }
  const document=new Element(),window=new Element(),root=new Element(),nodes={};document.hidden=false;document.createElement=tag=>new Element(tag);root.ownerDocument=document;document.defaultView=window;window.location={origin};
  let stored=saved,copied='';window.localStorage={getItem:()=>{if(denyStorage)throw Error('denied');return stored;},setItem:(_key,value)=>{if(denyStorage)throw Error('denied');stored=value;}};window.navigator={clipboard:{writeText:async value=>{copied=value;}}};
  for(const id of ['Form','Notice','Reload','Search','SearchCatalog','Source','SourceCount','SourceCard','Account','Surface','CheckConnection','ConnectionState','ConnectionTitle','ConnectionMissing','ConnectionChecks','PostId','GroupId','GroupField','Keyword','Caption','Suggest','Invite','Prepare','Preview','PreviewTitle','Summary','Readiness','Missing','Cover','PublicCaption','PrivateReply','Copy','Counts','PreviewNote','Activate','Pause','Refresh','History'])nodes[id]=new Element();
  nodes.Surface.value='facebook_page';nodes.Keyword.value='QUERO RECEITA';nodes.Invite.value='none';
  root.querySelector=selector=>nodes[selector.slice(3)];nodes.Form.querySelectorAll=()=>['Search','SearchCatalog','Source','Account','Surface','CheckConnection','PostId','GroupId','Keyword','Caption','Suggest','Invite','Prepare'].map(key=>nodes[key]);
  const timers=new Map();let timerId=0,keyCount=0;
  const controller=mountSocialCampaigns(root,{document,window,fetcher,randomUUID:()=>`key-${++keyCount}`,setTimer:fn=>{timers.set(++timerId,fn);return timerId;},clearTimer:id=>timers.delete(id)});
  t.after(()=>controller.destroy());
  const select=()=>{nodes.Source.value=source.key;nodes.Source.dispatch('change');nodes.Account.value='1';nodes.Account.dispatch('change');nodes.PostId.value='1234_789';nodes.Suggest.dispatch('click');};
  return {nodes,document,window,controller,timers,select,get stored(){return stored;},get copied(){return copied;}};
}

test('draft captions invite an explicit request without links or invented personal stories; payload bounds IDs and keywords',()=>{
  const value=socialCampaignPayload(payload({postId:''}));assert.equal(value.postId,'');assert.match(value.caption,/Comente QUERO RECEITA/);assert.doesNotMatch(value.caption,/https?:|triste|bom dia|exclusiv/i);
  assert.match(suggestedCaption({...source,commercial:true}),/Publicidade/);
  assert.doesNotMatch(suggestedCaption({...source,summary:'Veja https://evil.test aqui.'}),/evil\.test/);
  for(const change of [{sourceKey:''},{accountId:''},{surface:'personal_profile'},{keyword:'QUAL PLANTA'},{caption:'Qual planta é esta?'},{caption:caption+' https://site.test'},{caption:'x'.repeat(1801)},{postId:'https://facebook.com/post'},{groupId:'a'},{surface:'facebook_group'},{invite:'scarcity'}])assert.throws(()=>socialCampaignPayload(payload(change)));
  assert.equal(socialCampaignPayload(payload({surface:'facebook_group',groupId:'999'})).groupId,'999');
});

test('request keys survive identical retries; images and public pages reject unsafe URLs',()=>{
  let count=0;const key=socialRequestKey(()=>String(++count));assert.equal(key(payload()),key(payload()));assert.equal(count,1);assert.notEqual(key(payload({postId:''})),key(payload()));
  assert.equal(socialPageUrl(source.url,origin),source.url);assert.equal(socialImageUrl(source.image,origin),origin+source.image);
  for(const value of ['javascript:alert(1)','//evil.test/a.jpg','https://u:p@vitrinecity.com/uploads/a.jpg','https://127.0.0.1/a.jpg'])assert.equal(socialImageUrl(value,origin),'');
  for(const value of ['javascript:alert(1)','//vitrinecity.com/recipe','/admin','/api/secret','https://evil.test/noticia'])assert.equal(socialPageUrl(value,origin),'');
});

test('catalog starts without selected source or account; filters are safe text; no automatic preview or activation',async t=>{
  const calls=[],f=fixture(t,async(url,options)=>{calls.push({url,options});return response(url.endsWith('/catalog')?catalog:{campaigns:[]});});await tick();
  assert.equal(calls.length,2);assert.ok(calls.every(call=>!call.options.method));assert.equal(f.nodes.Source.value,'');assert.equal(f.nodes.Account.value,'');assert.equal(f.nodes.Activate.disabled,true);assert.equal(f.nodes.Source.children[2].textContent,'<b>Plantas</b>');
  f.nodes.Search.value='plantas';f.nodes.Search.dispatch('input');assert.equal(f.nodes.Source.children.length,2);assert.equal(f.nodes.SourceCount.textContent,'1 conteúdos encontrados');
});

test('preview retry reuses its key, blocks duplicate clicks, and never activates; edits require a new preview',async t=>{
  const calls=[];let previews=0,finish;
  const f=fixture(t,async(url,options)=>{calls.push({url,options});if(url.endsWith('/catalog'))return response(catalog);if(!options.method)return response({campaigns:[]});if(++previews===1)throw TypeError('network');return new Promise(resolve=>{finish=resolve;});});await tick();f.select();f.nodes.Form.dispatch('submit');await tick();assert.match(f.nodes.Notice.textContent,/conexão falhou/);
  f.nodes.Form.dispatch('submit');f.nodes.Form.dispatch('submit');await tick();const posts=calls.filter(call=>call.options.method==='POST');assert.equal(posts.length,2);assert.equal(JSON.parse(posts[0].options.body).idempotencyKey,JSON.parse(posts[1].options.body).idempotencyKey);
  finish(response(dto()));await tick();assert.equal(f.nodes.Activate.disabled,false);assert.equal(f.nodes.PreviewTitle.focused,true);assert.equal(f.stored,'campaign-1');assert.equal(calls.filter(call=>call.url.endsWith('/activate')).length,0);
  f.nodes.Copy.dispatch('click');await tick();assert.equal(f.copied,caption);f.nodes.Caption.value+=' Alteração';f.nodes.Caption.dispatch('input');assert.equal(f.nodes.Activate.disabled,true);
});

test('activation requires readiness, runs once per click sequence; active polling cancels when hidden and pause is explicit',async t=>{
  const calls=[];let finishActivation,finishPoll;
  const f=fixture(t,(url,options)=>{calls.push({url,options});if(url.endsWith('/catalog'))return Promise.resolve(response(catalog));if(url.endsWith('/preview'))return Promise.resolve(response(dto()));if(url.endsWith('/activate'))return new Promise(resolve=>{finishActivation=resolve;});if(url.endsWith('/pause'))return Promise.resolve(response(dto({status:'paused'})));if(url.endsWith('/campaign-1'))return new Promise(resolve=>{finishPoll=resolve;});return Promise.resolve(response({campaigns:[]}));});await tick();f.select();f.nodes.Form.dispatch('submit');await tick();
  f.nodes.Activate.dispatch('click');f.nodes.Activate.dispatch('click');assert.equal(calls.filter(call=>call.url.endsWith('/activate')).length,1);finishActivation(response(dto({status:'active',counts:{sent:2}})));await tick();assert.equal(f.nodes.Pause.disabled,false);assert.match(f.nodes.Counts.textContent,/Aceitas pelo serviço: 2/);assert.equal(f.timers.size,1);
  const poll=[...f.timers.values()][0];f.timers.clear();poll();await tick();const pending=calls.at(-1);f.document.hidden=true;f.document.dispatch('visibilitychange');assert.equal(pending.options.signal.aborted,true);finishPoll(response(dto({status:'paused'})));await tick();assert.equal(f.nodes.PreviewTitle.textContent,'Respostas ativas');
  f.nodes.Pause.dispatch('click');await tick();assert.equal(f.nodes.PreviewTitle.textContent,'Respostas pausadas');assert.equal(f.timers.size,0);
});

test('unready previews cannot activate; last campaign restoration performs only reads and cannot silently resume',async t=>{
  const calls=[],f=fixture(t,async(url,options)=>{calls.push({url,options});return response(url.endsWith('/catalog')?catalog:url.endsWith('/campaign-1')?dto({status:'paused'}):{campaigns:[]});},{saved:'campaign-1'});await tick();assert.ok(calls.every(call=>!call.options.method));assert.equal(f.nodes.Activate.disabled,true);assert.equal(f.nodes.PreviewTitle.textContent,'Respostas pausadas');
  const blocked=fixture(t,async(url,options)=>response(url.endsWith('/catalog')?catalog:options.method?dto({postId:'',readiness:{ready:false,missing:['Informe o ID da publicação.']}}):{campaigns:[]}),{denyStorage:true});await tick();blocked.select();blocked.nodes.PostId.value='';blocked.nodes.Form.dispatch('submit');await tick();assert.equal(blocked.nodes.Activate.disabled,true);assert.equal(blocked.nodes.Missing.children[0].textContent,'Informe o ID da publicação.');blocked.nodes.Activate.dispatch('click');assert.equal(blocked.nodes.PreviewTitle.textContent,'Prévia preparada');
});

test('connection verification is a selected-account GET, exposes missing permissions and never creates a post or activates',async t=>{
  const calls=[],f=fixture(t,async(url,options)=>{calls.push({url,options});if(url.endsWith('/catalog'))return response(catalog);if(url.includes('/connection?'))return response({account,surface:'facebook_page',readiness:{ready:false,missing:['Autorize pages_messaging.','Informe o ID da publicação.'],details:{permissionCheck:false,subscriptionCheck:true}}});return response({campaigns:[]});});await tick();
  assert.equal(f.nodes.CheckConnection.disabled,true);f.nodes.Account.value='1';f.nodes.Account.dispatch('change');assert.equal(f.nodes.CheckConnection.disabled,false);f.nodes.CheckConnection.dispatch('click');await tick();
  assert.match(calls.at(-1).url,/\/connection\?accountId=1&surface=facebook_page$/);assert.ok(calls.every(call=>!call.options.method));assert.match(f.nodes.ConnectionChecks.textContent,/não confirmadas/);assert.match(f.nodes.ConnectionChecks.textContent,/Assinatura de comentários: verificada/);assert.equal(f.nodes.ConnectionMissing.children[0].textContent,'Autorize pages_messaging.');assert.equal(f.nodes.Activate.disabled,true);
  f.nodes.Surface.value='instagram';f.nodes.Surface.dispatch('change');assert.equal(f.nodes.ConnectionState.hidden,true);
});

test('server search keeps matches found in the article body instead of filtering them out by title again',async t=>{
  const calls=[],f=fixture(t,async(url,options)=>{calls.push({url,options});if(url.includes('/catalog?q='))return response({items:[source],accounts:[account]});return response(url.endsWith('/catalog')?catalog:{campaigns:[]});});await tick();
  f.nodes.Search.value='farinha & ovos';f.nodes.Search.dispatch('input');assert.equal(f.nodes.Source.children.length,1);f.nodes.SearchCatalog.dispatch('click');await tick();
  assert.ok(calls.some(call=>call.url.endsWith('/catalog?q=farinha%20%26%20ovos')));assert.equal(f.nodes.Source.children.length,2);assert.equal(f.nodes.Source.children[1].textContent,source.title);assert.ok(calls.every(call=>!call.options.method));
  assert.equal(socialCampaignPayload(payload({sourceKey:'a'.repeat(300)})).sourceKey.length,300);assert.throws(()=>socialCampaignPayload(payload({sourceKey:'a'.repeat(301)})));
});
