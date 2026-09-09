import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {publicationCaptionError,publicationImage,publicationReceiptUrl,publicationCanSend,publicationCanReconcile,publicationState,mountPublications} from '../public/admin-publicacoes.js';

const html=fs.readFileSync(new URL('../public/admin-publicacoes.html',import.meta.url),'utf8'),origin='https://vitrinecity.com',tick=()=>new Promise(resolve=>setImmediate(resolve));
const source={id:'social-1',title:'Bolo de cenoura',image:'/story-assets/'+'a'.repeat(32)+'.jpg',sourceUrl:'/stories/bolo',caption:'Bolo de cenoura com cobertura de chocolate. Confira esta ideia para o café.',commercial:false};
const account={id:9,pageId:'118594311182106',pageName:'Receitas Com Amor'};
const catalog=(change={})=>({items:[source],accounts:[account],paused:false,scope:'facebook_page_photo',...change});
const dto=(change={})=>({id:'publication-1',status:'draft',previewHash:'b'.repeat(64),accountId:9,pageId:account.pageId,pageName:account.pageName,socialPostId:source.id,source:{key:'recipe',title:source.title,image:source.image,url:source.sourceUrl,commercial:false},caption:source.caption,readiness:{ready:true,missing:[],checkedAt:'2026-09-09T15:00:00Z'},photoId:null,postId:null,publicationUrl:null,errorCode:null,createdAt:'2026-09-09T15:00:00Z',updatedAt:'2026-09-09T15:00:00Z',...change});
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
function fixture(t,fetcher,{saved='[]'}={}){
  class Element{
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.listeners={};this.dataset={};this.attrs={};this.value='';this.textContent='';this.disabled=false;this.hidden=false;this.checked=false;}
    append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}setAttribute(name,value){this.attrs[name]=value;}
    addEventListener(name,fn){(this.listeners[name]||=new Set()).add(fn);}removeEventListener(name,fn){this.listeners[name]?.delete(fn);}
    dispatch(name){for(const fn of this.listeners[name]||[])fn({preventDefault(){},target:this});}reportValidity(){return true;}focus(){this.focused=true;}
  }
  const root=new Element(),document=new Element(),window=new Element(),nodes={};document.createElement=tag=>new Element(tag);root.ownerDocument=document;document.defaultView=window;window.location={origin};let stored=saved;window.localStorage={getItem:()=>stored,setItem:(_key,value)=>{stored=value;}};
  for(const match of html.matchAll(/id="pub([^"]+)"/g))nodes[match[1]]=new Element();root.querySelector=selector=>nodes[selector.slice(4)];let key=0;
  const controller=mountPublications(root,{document,window,fetcher,randomUUID:()=>`request-${++key}`});t.after(()=>controller.destroy());
  const select=()=>{nodes.Source.value=source.id;nodes.Source.dispatch('change');nodes.Page.value=String(account.id);nodes.Page.dispatch('change');};
  const review=()=>{nodes.Cover.children[0]?.dispatch('load');nodes.Confirm.checked=true;nodes.Confirm.dispatch('change');};
  return{nodes,controller,select,review,get stored(){return stored;}};
}
function mock(overrides={}){const calls=[];return{calls,fetcher:async(url,options)=>{calls.push({url,options});for(const [suffix,handler] of Object.entries(overrides))if(url.endsWith(suffix))return handler(url,options);return response(url.endsWith('/catalog')?catalog():url.endsWith('/preview')?dto():{items:[]});}};}

test('public copy rejects bare, shortened, Unicode links, HTML and missing commercial disclosure',()=>{
  for(const value of ['Confira aqui https://example.test','Confira wa.me/12345','Confira bit.ly/oferta','Confira exemplo.com.br/oferta','Confira ｈｔｔｐｓ：／／example.test','Veja <b>bolo</b> agora','Use a < b no preparo','x'.repeat(1501),'Pequeno'])assert.ok(publicationCaptionError(value),value);
  assert.ok(publicationCaptionError(source.caption,true));assert.equal(publicationCaptionError('Publicidade. Conheça os detalhes deste produto.',true),'');assert.equal(publicationCaptionError('O preparo leva 1,5 hora. Receita para 12 pessoas.'),'');
});
test('only approved local story posters and exact Facebook receipt hosts render; unknown states cannot send',()=>{
  assert.equal(publicationImage(source.image,origin),origin+source.image);
  for(const value of ['//evil.test/a.jpg','https://evil.test'+source.image,'/assets/other.jpg','/story-assets/../a.jpg',source.image+'?token=secret',source.image.replace('story-assets','%73tory-assets')])assert.equal(publicationImage(value,origin),'');
  assert.equal(publicationReceiptUrl('https://www.facebook.com/123/posts/456'),'https://www.facebook.com/123/posts/456');for(const value of ['javascript:alert(1)','https://facebook.com.evil.test/','https://u:p@facebook.com/a','https://facebook.com:44/a','http://facebook.com/a'])assert.equal(publicationReceiptUrl(value),'');
  const options={paused:false,confirmed:true,imageReady:true};assert.equal(publicationCanSend(dto(),options),true);for(const change of [{dirty:true},{busy:true},{paused:true},{confirmed:false},{imageReady:false},{locked:true}])assert.equal(publicationCanSend(dto(),{...options,...change}),false);
  for(const status of ['published','unknown','failed','submitting','held'])assert.equal(publicationCanSend(dto({status}),options),false);assert.equal(publicationCanSend(dto({readiness:{ready:true,missing:['pages_manage_posts']}}),options),false);assert.equal(publicationState('future')[0],'Estado não informado');
});
test('opening the panel makes only reads and shows actual Page names and IDs',async t=>{
  const m=mock(),f=fixture(t,m.fetcher);await tick();assert.equal(m.calls.length,2);assert.ok(m.calls.every(call=>!call.options.method));assert.equal(f.nodes.Page.children[1].textContent,account.pageName+' · '+account.pageId);assert.equal(f.nodes.Publish.disabled,true);assert.equal(f.nodes.Fields.disabled,false);f.select();assert.equal(f.nodes.Prepare.disabled,false);
});
test('publishing needs loaded image, explicit checkbox and separate click; double click sends once with exact preview hash',async t=>{
  let finish;const m=mock({'/publish':()=>new Promise(resolve=>{finish=resolve;})}),f=fixture(t,m.fetcher);await tick();f.select();f.nodes.Form.dispatch('submit');await tick();assert.equal(m.calls.filter(call=>call.options.method).length,1);assert.equal(f.nodes.Publish.disabled,true);assert.equal(f.nodes.Hash.textContent,'b'.repeat(64));f.review();assert.equal(f.nodes.Publish.disabled,false);f.nodes.Publish.dispatch('click');f.nodes.Publish.dispatch('click');assert.equal(m.calls.filter(call=>call.url.endsWith('/publish')).length,1);const send=m.calls.find(call=>call.url.endsWith('/publish'));assert.deepEqual(JSON.parse(send.options.body),{previewHash:'b'.repeat(64)});assert.equal(send.options.credentials,'same-origin');assert.ok(JSON.parse(f.stored).some(item=>item.id==='publication-1'));
  finish(response(dto({status:'published',photoId:'11',postId:'22_33',publicationUrl:'https://facebook.com/22/posts/33'})));await tick();assert.match(f.nodes.Notice.textContent,/confirmada pelo Facebook/);assert.equal(f.nodes.Publish.disabled,true);assert.equal(f.nodes.History.children[0].children[0].children.at(-1).children.at(-1).href,'https://facebook.com/22/posts/33');
});
test('editing caption or Page invalidates prior review and never triggers publication',async t=>{
  const m=mock(),f=fixture(t,m.fetcher);await tick();f.select();f.nodes.Form.dispatch('submit');await tick();f.review();assert.equal(f.nodes.Publish.disabled,false);f.nodes.Caption.value+=' Texto revisto.';f.nodes.Caption.dispatch('input');assert.equal(f.nodes.Confirm.checked,false);assert.equal(f.nodes.Publish.disabled,true);f.nodes.Publish.dispatch('click');assert.ok(!m.calls.some(call=>call.url.endsWith('/publish')));assert.match(f.nodes.PreviewNote.textContent,/mudou/);
});
test('missing publication scope, a paused coordinator, failed image or mismatched hash never enables publishing',async t=>{
  const m=mock({'/preview':()=>response(dto({readiness:{ready:false,missing:['pages_manage_posts']}}))}),f=fixture(t,m.fetcher);await tick();f.select();f.nodes.Form.dispatch('submit');await tick();f.review();assert.equal(f.nodes.Publish.disabled,true);assert.match(f.nodes.Missing.children[0].textContent,/permissão para publicar/);
  const paused=fixture(t,mock({'/catalog':()=>response(catalog({paused:true}))}).fetcher);await tick();paused.select();assert.equal(paused.nodes.Prepare.disabled,true);
  const image=fixture(t,mock().fetcher);await tick();image.select();image.nodes.Form.dispatch('submit');await tick();image.nodes.Cover.children[0].dispatch('error');image.nodes.Confirm.checked=true;image.nodes.Confirm.dispatch('change');assert.equal(image.nodes.Publish.disabled,true);
  const invalid=fixture(t,mock({'/preview':()=>response(dto({previewHash:''}))}).fetcher);await tick();invalid.select();invalid.nodes.Form.dispatch('submit');await tick();invalid.review();assert.equal(invalid.nodes.Publish.disabled,true);assert.match(invalid.nodes.Notice.textContent,/confirmação completa/);
});
test('lost publication response locks the source/Page pair across refresh and reload; no blind resend',async t=>{
  const m=mock({'/publish':()=>{throw new TypeError('offline');},'/publication-1':()=>response(dto())}),f=fixture(t,m.fetcher);await tick();f.select();f.nodes.Form.dispatch('submit');await tick();f.review();f.nodes.Publish.dispatch('click');await tick();assert.equal(f.nodes.Publish.disabled,true);assert.equal(f.nodes.Prepare.disabled,true);assert.match(f.nodes.Notice.textContent,/interrompida/);f.nodes.Refresh.dispatch('click');await tick();f.nodes.Publish.dispatch('click');f.nodes.Form.dispatch('submit');assert.equal(m.calls.filter(call=>call.url.endsWith('/publish')).length,1);
  const next=mock(),reloaded=fixture(t,next.fetcher,{saved:f.stored});await tick();reloaded.select();assert.equal(reloaded.nodes.Prepare.disabled,true);reloaded.nodes.Form.dispatch('submit');assert.ok(next.calls.every(call=>!call.options.method));
});
test('unknown receipts without both IDs have no reconcile or send; with IDs only confirmation is requested',async t=>{
  for(const change of [{},{photoId:'11'},{postId:'22_33'}])assert.equal(publicationCanReconcile(dto({status:'unknown',...change})),false);
  const value=dto({status:'unknown',photoId:'11',postId:'22_33'}),m=mock({'/reconcile':()=>response({...value,status:'published',publicationUrl:'https://facebook.com/22/posts/33'}),'facebook-photo-publications':()=>response({items:[value]})}),f=fixture(t,m.fetcher);await tick();f.select();assert.equal(f.nodes.Prepare.disabled,true);const actions=f.nodes.History.children[0].children[0].children.at(-1);assert.equal(actions.children[1].textContent,'Verificar recibo no Facebook');actions.children[1].dispatch('click');await tick();assert.equal(m.calls.filter(call=>call.options.method).length,1);assert.ok(m.calls.some(call=>call.url.endsWith('/reconcile')));assert.ok(!m.calls.some(call=>call.url.endsWith('/publish')));
});
test('a conclusive permission refusal before sending clears only its local lock and requires a fresh preview',async t=>{
  const m=mock({'/publish':()=>response(dto({readiness:{ready:false,missing:['pages_manage_posts']}}),409)}),f=fixture(t,m.fetcher);await tick();f.select();f.nodes.Form.dispatch('submit');await tick();f.review();f.nodes.Publish.dispatch('click');await tick();assert.match(f.nodes.Notice.textContent,/impediu o envio/);assert.equal(f.nodes.Publish.disabled,true);assert.equal(f.nodes.Prepare.disabled,false);assert.deepEqual(JSON.parse(f.stored),[]);f.nodes.Publish.dispatch('click');assert.equal(m.calls.filter(call=>call.url.endsWith('/publish')).length,1);
});
test('definitive failed or held attempt permits a new explicitly reviewed draft, never a resend or automatic publication',async t=>{
  for(const status of ['failed','held']){let prepares=0;const m=mock({'/preview':()=>response(dto({id:'publication-'+(++prepares)})),'/publish':()=>response(dto({status,errorCode:'meta_permission_denied'}))}),f=fixture(t,m.fetcher);await tick();f.select();f.nodes.Form.dispatch('submit');await tick();f.review();f.nodes.Publish.dispatch('click');await tick();assert.equal(f.nodes.Prepare.disabled,false);assert.equal(f.nodes.Publish.disabled,true);assert.deepEqual(JSON.parse(f.stored),[]);f.nodes.Publish.dispatch('click');assert.equal(m.calls.filter(call=>call.url.endsWith('/publish')).length,1);f.nodes.Form.dispatch('submit');await tick();const previews=m.calls.filter(call=>call.url.endsWith('/preview'));assert.equal(previews.length,2);assert.notEqual(JSON.parse(previews[0].options.body).idempotencyKey,JSON.parse(previews[1].options.body).idempotencyKey);assert.equal(f.nodes.Publish.disabled,true);assert.equal(m.calls.filter(call=>call.url.endsWith('/publish')).length,1);}
});
test('history is rendered as text, API errors fail closed and malformed preview never becomes publishable',async t=>{
  const malicious=dto({source:{...dto().source,title:'<img src=x onerror=alert(1)>'},status:'unknown',publicationUrl:'javascript:alert(1)'}),m=mock({'facebook-photo-publications':()=>response({items:[malicious]})}),f=fixture(t,m.fetcher);await tick();assert.equal(f.nodes.History.children[0].children[0].children[0].textContent,malicious.source.title);assert.equal(f.nodes.History.children[0].children[0].children.at(-1).children.length,1);
  const auth=fixture(t,mock({'/catalog':()=>response({error:'no_session'},401)}).fetcher);await tick();assert.equal(auth.nodes.Fields.disabled,true);assert.match(auth.nodes.Notice.textContent,/sessão expirou/);
  const mismatch=fixture(t,mock({'/preview':()=>response(dto({accountId:5}))}).fetcher);await tick();mismatch.select();mismatch.nodes.Form.dispatch('submit');await tick();assert.equal(mismatch.nodes.Publish.disabled,true);assert.match(mismatch.nodes.Notice.textContent,/não corresponde/);
});
test('repeated preview preparation reuses an idempotency key until the reviewed copy changes',async t=>{
  const m=mock(),f=fixture(t,m.fetcher);await tick();f.select();f.nodes.Form.dispatch('submit');await tick();f.nodes.Form.dispatch('submit');await tick();let writes=m.calls.filter(call=>call.url.endsWith('/preview'));assert.equal(JSON.parse(writes[0].options.body).idempotencyKey,JSON.parse(writes[1].options.body).idempotencyKey);f.nodes.Caption.value+=' Veja a receita.';f.nodes.Caption.dispatch('input');f.nodes.Form.dispatch('submit');await tick();writes=m.calls.filter(call=>call.url.endsWith('/preview'));assert.notEqual(JSON.parse(writes[0].options.body).idempotencyKey,JSON.parse(writes[2].options.body).idempotencyKey);
});
test('page has connected labels, live notices, separate explicit publish control, mobile touch targets and no inline script',()=>{
  for(const id of ['Search','Source','Page','Caption'])assert.ok(html.includes('for="pub'+id+'"'));assert.match(html,/id="pubNotice" role="status" aria-live="polite"/);assert.match(html,/id="pubPublish"[^>]*type="button" disabled/);assert.match(html,/id="pubConfirm" type="checkbox" disabled/);assert.match(html,/href="\/admin-operacao"/);assert.doesNotMatch(html,/<script[^>]*>\s*[^<\s]/);const css=fs.readFileSync(new URL('../public/admin-publicacoes.css',import.meta.url),'utf8');assert.match(css,/min-height:44px/);assert.match(css,/@media\(max-width:680px\)/);assert.match(css,/focus-visible/);
});
