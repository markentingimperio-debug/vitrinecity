import test from 'node:test';
import assert from 'node:assert/strict';
import {mountLiveLia} from '../public/admin-live-lia.js';

class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.textContent='';this.value='';this.style={};this.events={};this.attributes={};}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  setAttribute(name,value){this.attributes[name]=value;}
  addEventListener(name,callback){this.events[name]=callback;}
}
const walk=node=>[node,...node.children.flatMap(walk)];
function fixture(items=[]){
  const main=new Element('main'),doc={querySelector:value=>value==='main'?main:null,getElementById:id=>walk(main).find(node=>node.id===id)||null,createElement:tag=>new Element(tag),createTextNode:text=>{const node=new Element('#text');node.textContent=text;return node;}};
  const state={canPrepare:true,textConfigured:true,voiceConfigured:true,quota:{voice:{used:0,limit:3,remaining:3},text:{used:0,limit:20,remaining:20}},audienceMode:'manual',studio:{online:true,streaming:false,recording:false},items};
  const calls=[];let responder=null;const fetchImpl=async(url,options)=>{calls.push({url,options});if(responder)return responder(url,options);return {ok:true,json:async()=>options.method==='POST'?{item:state.items[0]}:state};};
  return {main,doc,state,calls,fetchImpl,setResponder:fn=>responder=fn,button:text=>walk(main).find(node=>node.tagName==='BUTTON'&&node.textContent===text),nodes:tag=>walk(main).filter(node=>node.tagName===tag.toUpperCase())};
}
const approved={id:'6a75a713-783a-4d69-a35f-176f8a30c3e0',question:'Qual substrato está disponível?',context:{path:'/produto/1/substrato',title:'Substrato'},status:'approved',revision:2,reply:'Confira os detalhes deste substrato para vasos.',mode:'catalog',aiState:'',voiceState:'',approvedHash:'a'.repeat(64),sourceCurrent:true,offers:[{id:'product:1',title:'Substrato',url:'/produto/1/substrato'}],offer:{id:'product:1',title:'Substrato',url:'/produto/1/substrato'},media:null};
test('opening and refreshing the studio calls status only and states manual questions, no lip sync and daily limits',async()=>{
  const f=fixture(),ui=await mountLiveLia(f.doc,f.fetchImpl);assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.method,undefined);assert.match(walk(f.main).map(node=>node.textContent).join(' '),/A boca da personagem não se movimenta/);assert.match(walk(f.main).map(node=>node.textContent).join(' '),/Voz: 0 de 3/);await ui.refresh();assert.equal(f.calls.length,2);assert.ok(f.calls.every(call=>!call.options.method));ui.close();
});
test('preparing voice requires its explicit button; duplicate clicks while pending make exactly one request',async()=>{
  const f=fixture([approved]),ui=await mountLiveLia(f.doc,f.fetchImpl);let release;
  f.setResponder(async(_url,options)=>{if(options.method==='POST')await new Promise(resolve=>release=resolve);return {ok:true,json:async()=>options.method==='POST'?{item:approved}:f.state};});
  const button=f.button('Preparar voz e retrato — usa 1 preparação');assert.equal(button.disabled,false);const first=button.events.click();await Promise.resolve();button.events.click();assert.equal(f.calls.filter(call=>call.options.method==='POST').length,1);
  const request=f.calls.find(call=>call.options.method==='POST');assert.match(request.url,/\/voice$/);assert.deepEqual(JSON.parse(request.options.body),{revision:2,expectedHash:'a'.repeat(64)});release();await first;assert.ok(!f.calls.some(call=>/\/control$/.test(call.url)));ui.close();
});
test('review requires the checkbox and reading a ready clip never issues an OBS command or autoplay',async()=>{
  const item={...approved,status:'draft',approvedHash:''},f=fixture([item]),ui=await mountLiveLia(f.doc,f.fetchImpl);
  f.button('Aprovar este texto').events.click();assert.equal(f.calls.length,1);f.nodes('input').find(node=>node.type==='checkbox').checked=true;f.button('Aprovar este texto').events.click();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.filter(call=>call.options.method==='POST').length,1);assert.match(f.calls.find(call=>call.options.method==='POST').url,/\/review$/);ui.close();
  const ready=fixture([{...approved,voiceState:'ready',media:{duration:12,previewUrl:'/api/admin/live-studio/lia/answers/'+approved.id+'/media'}}]),second=await mountLiveLia(ready.doc,ready.fetchImpl);const video=ready.nodes('video')[0];assert.equal(video.controls,true);assert.equal(video.autoplay,undefined);assert.equal(ready.calls.length,1);assert.equal(ready.button('Exibir resposta na sessão ativa').disabled,true);assert.equal(ready.button('Testar resposta no OBS — privado').disabled,false);second.close();
});
test('copy asks for the current server-approved link and provides a manual fallback without dispatching a message',async()=>{
  const f=fixture([approved]),ui=await mountLiveLia(f.doc,f.fetchImpl);f.setResponder(async url=>({ok:true,json:async()=>url.endsWith('/share')?{text:'Informações atuais.\nhttps://vitrinecity.com/produto/1/substrato',sourceCurrent:true,sent:false}:f.state}));
  await f.button('Copiar mensagem e link do produto').events.click();assert.equal(f.calls.length,2);assert.match(f.calls[1].url,/\/questions\/.+\/share$/);assert.equal(f.calls[1].options.method,undefined);assert.ok(!f.calls.some(call=>/messages|send|control/.test(call.url)));assert.match(walk(f.main).map(node=>node.textContent).join(' '),/Nenhum envio foi feito/);ui.close();
});
