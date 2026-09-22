import test from 'node:test';
import assert from 'node:assert/strict';
import {mountLiveVoice} from '../public/admin-live-voice.js';

class Element {
  constructor(tag) {this.tagName=tag.toUpperCase();this.children=[];this.textContent='';this.events={};this.attributes={};}
  append(...nodes){this.children.push(...nodes);}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(name,callback){this.events[name]=callback;}
}
const walk=node=>[node,...node.children.flatMap(walk)];

test('loading private voice panel checks availability without starting a billable session',async()=>{
  const main=new Element('main'),calls=[];
  const doc={querySelector:selector=>selector==='main'?main:null,getElementById:id=>walk(main).find(node=>node.id===id),createElement:tag=>new Element(tag)};
  const fetchImpl=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({configured:true})};};
  await mountLiveVoice(doc,fetchImpl);
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.method,undefined);
  assert.match(calls[0].url,/\/voice-live\/status$/);
  assert.equal(walk(main).find(node=>node.textContent==='Iniciar conversa privada').disabled,true);
  assert.match(walk(main).map(node=>node.textContent).join(' '),/não é enviada ao OBS/);
});
