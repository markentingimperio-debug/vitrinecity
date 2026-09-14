import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {mountVitrinyNeuralAdmin} from '../vitriny-neural/admin-api.js';

async function fixture(t){
  let calls=0;
  const forbidden=()=>{calls++;throw Error('Provider must not be called');};
  const app=express();app.use(express.json({limit:'100kb',strict:false}));
  mountVitrinyNeuralAdmin({app,runtime:{neural:{invoke:forbidden},skills:{run:forbidden}},
    requireAdmin:(req,res,next)=>req.get('x-fixture-admin')==='yes'?next():res.status(401).json({error:'unauthorized'}),
    sameOriginOnly:(req,res,next)=>req.get('origin')==='https://vitrinecity.test'?next():res.status(403).json({error:'origin_denied'})});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const headers={'content-type':'application/json','x-neural-request':'1','x-fixture-admin':'yes',origin:'https://vitrinecity.test'};
  const request=async(body,overrides={},query='')=>{
    const h={...headers,...overrides};for(const k of Object.keys(h))if(h[k]===null)delete h[k];
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/admin/vitriny-neural/factual-draft${query}`,{method:'POST',headers:h,body:JSON.stringify(body)});
    return {status:response.status,cache:response.headers.get('cache-control'),body:await response.json()};
  };
  return {request,calls:()=>calls};
}
const product={facts:[{id:'f1',text:'Capa de almofada em algodão cru, com zíper.'},{id:'f2',text:'Não acompanha enchimento.'}]};
test('admin factual route preserves every fact and never calls a model, even without an enabled service',async t=>{
  const f=await fixture(t);
  for(const format of ['lines','paragraphs','bullets']){
    const result=await f.request({...product,format});
    assert.equal(result.status,200);assert.equal(result.cache,'no-store');
    assert.equal(result.body.ok,true);assert.deepEqual(result.body.draft.factIds,['f1','f2']);
    assert.equal(result.body.draft.text,format==='bullets'?product.facts.map(x=>'- '+x.text).join('\n'):product.facts.map(x=>x.text).join(format==='paragraphs'?'\n\n':'\n'));
    assert.deepEqual(result.body.draft.grounding,{method:'literal_facts',scope:'supplied_facts_only',externallyVerified:false});
    assert.deepEqual((await f.request({...product,format})).body,result.body);
  }
  assert.equal(f.calls(),0);
});
test('support drafts add no commitment and HTML stays literal data',async t=>{
  const f=await fixture(t),facts=[{id:'status',text:'Pedido em separação.'},{id:'shipping',text:'Envio ainda não confirmado.'},{id:'literal',text:'<img src=x onerror=alert(1)>'}];
  const result=await f.request({facts});assert.equal(result.status,200);
  assert.equal(result.body.draft.text,facts.map(x=>x.text).join('\n'));assert.equal(f.calls(),0);
});
test('authentication, origin and explicit JSON request are required',async t=>{
  const f=await fixture(t);
  for(const [headers,status] of [[{'x-fixture-admin':null},401],[{origin:'https://other.test'},403],[{'x-neural-request':null},403],[{'content-type':'text/plain'},403]])assert.equal((await f.request(product,headers)).status,status);
  assert.equal((await f.request(product,{},'?model=other')).status,400);assert.equal(f.calls(),0);
});
test('malformed and oversized facts are rejected without echoing their contents',async t=>{
  const f=await fixture(t);
  const invalid=[null,[],{}, {...product,format:'html'},{...product,text:'UNTRUSTED_SENTINEL'}, {facts:[{id:'x',text:'UNTRUSTED_SENTINEL\nsecond line'}]}, {facts:[{id:'x',text:'x'.repeat(501)}]}, {facts:Array.from({length:31},(_,i)=>({id:String(i),text:'fact '+i}))},{...product,selection:{factIds:['f1']}},{...product,selection:{factIds:['f1','f2'],text:'UNTRUSTED_SENTINEL'}}];
  for(const input of invalid){const result=await f.request(input);assert.equal(result.status,400,JSON.stringify(input));assert.doesNotMatch(JSON.stringify(result.body),/UNTRUSTED_SENTINEL/);}
  assert.equal((await f.request({facts:[{id:'x',text:'x'.repeat(70000)}]})).status,413);assert.equal(f.calls(),0);
});
