import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const html=await readFile(new URL('../public/admin-tiktok.html',import.meta.url),'utf8');
const script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('let currentSetup='));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture({refreshAvailable=true,post}={}){
  const nodes=new Map(),calls=[];
  const $=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',disabled:false,className:'',style:{},value:'',reset(){}});return nodes.get(id);};
  const setup={connected:false,appConfigured:true,refreshAvailable,account:{open_id:'PRIVATE_OPEN_ID',scopes:'user.info.basic,video.list',status:'connected',expires_at:Date.now()-60_000}};
  const context=vm.createContext({document:{querySelector:$},location:{href:''},Date,Number,Boolean,String,Error,JSON,fetch:async(url,options)=>{
    calls.push({url,options});
    if(options?.method==='POST')return post?post(url,options):{ok:true,status:200,json:async()=>({ok:true,status:'refreshed',reason:'Autorização renovada.',account:{openId:'PRIVATE_OPEN_ID'}})};
    return {ok:true,status:200,json:async()=>setup};
  }});
  vm.runInContext(script,context);await tick();
  return {$,calls,setup,nodes};
}
test('initial page reads setup only, explains expired authorization and never displays account ID',async()=>{
  const f=await fixture();assert.equal(f.calls.length,1);assert.equal(f.calls[0].options,undefined);assert.match(f.$('#globalStatus').textContent,/EXPIRADO/);assert.match(f.$('#connectionInfo').textContent,/expirou/);assert.equal(f.$('#renew').disabled,false);
  assert.doesNotMatch([...f.nodes.values()].map(x=>x.textContent).join(' '),/PRIVATE_OPEN_ID/);assert.match(html,/id="renewMessage" role="status" aria-live="polite"/);
});
test('unavailable refresh stays disabled and does not request renewal',async()=>{
  const f=await fixture({refreshAvailable:false});assert.equal(f.$('#renew').disabled,true);await f.$('#renew').onclick();assert.equal(f.calls.length,1);
});
test('renewal is explicit and double click cannot duplicate it',async()=>{
  let resolve;const gate=new Promise(r=>{resolve=r;});const f=await fixture({post:async()=>{await gate;return {ok:true,status:200,json:async()=>({ok:true,reason:'Autorização renovada.'})};}});
  const pending=f.$('#renew').onclick();await f.$('#renew').onclick();assert.equal(f.calls.filter(c=>c.options?.method==='POST').length,1);assert.equal(f.$('#renew').disabled,true);
  resolve();await pending;const post=f.calls.find(c=>c.options?.method==='POST');assert.equal(post.url,'/api/admin/social/intelligence/tiktok/refresh');assert.equal(post.options.body,'{}');assert.match(f.$('#renewMessage').textContent,/renovada/);
});
test('uncertain renewal is not repeated until an explicit fresh state read',async()=>{
  const f=await fixture({post:async()=>({ok:false,status:409,json:async()=>({error:'Renovação não confirmada. Reconecte a conta.'})})});
  await f.$('#renew').onclick();assert.equal(f.$('#renew').disabled,true);assert.match(f.$('#renewMessage').textContent,/não confirmada/);
  await f.$('#renew').onclick();assert.equal(f.calls.filter(c=>c.options?.method==='POST').length,1);
  await f.$('#checkState').onclick();assert.equal(f.calls.filter(c=>c.options?.method==='POST').length,1);assert.match(f.$('#renewMessage').textContent,/Nenhuma renovação/);
});
