import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createKlingPaidImageAdapter,hashKlingPaidImageRequest} from '../vitriny-neural/providers/kling-paid-image.js';
import {createKlingPaidVideoAdapter,hashKlingPaidVideoRequest} from '../vitriny-neural/providers/kling-paid-video.js';

const NOW=1800000000000;
const content=()=>({prompt:'Uma planta em vaso azul.',aspectRatio:'1:1',externalTaskId:'image-fixture-001'});
function input(extra={}){const body={...content(),...extra};return {requestId:'request-fixture-001',...body,permit:{authorized:true,scope:'admin:1',requestId:'request-fixture-001',requestHash:hashKlingPaidImageRequest(body),model:'kling-v3',accountBinding:'fixture-account',policyRevision:'fixture-policy',externalTaskId:body.externalTaskId,reservationId:'request-fixture-001',quoteId:'quote-fixture-001',maximumMicroBrl:'500000',expiresAt:NOW+60000}};}
const task=(extra={})=>({task_id:'provider-fixture-001',task_status:'submitted',task_info:{external_task_id:'image-fixture-001'},created_at:NOW,updated_at:NOW,...extra});
const json=data=>new Response(JSON.stringify({code:0,data}),{headers:{'content-type':'application/json'}});
function fixture(options={}){const calls=[];let once=false;const adapter=createKlingPaidImageAdapter({enabled:true,apiKey:'fixture-not-real',accountBinding:'fixture-account',policyRevision:'fixture-policy',now:()=>NOW,assertAuthorized:()=>{if(once)return false;once=true;return true;},assertPollAuthorized:()=>true,fetchImpl:async(url,init)=>{calls.push({url,init});return json(task());},...options});return {adapter,calls};}

test('Kling image calls the documented endpoint with one image and requires an exact one-use permit',async()=>{
  const f=fixture(),r=await f.adapter.invoke(input());assert.equal(r.status,'accepted');assert.equal(r.billingDisposition,'hold');assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].url,'https://api-singapore.klingai.com/v1/images/generations');assert.deepEqual(JSON.parse(f.calls[0].init.body),{model_name:'kling-v3',prompt:content().prompt,n:1,resolution:'1k',aspect_ratio:'1:1',watermark_info:{enabled:false},external_task_id:'image-fixture-001'});
  assert.equal((await f.adapter.invoke(input())).transportStarted,false);assert.equal(f.calls.length,1);
  for(const patch of [{model:'kling-v1'},{requestHash:'f'.repeat(64)},{maximumMicroBrl:'0'},{expiresAt:NOW},{accountBinding:'wrong-account'}]){const g=fixture(),i=input();Object.assign(i.permit,patch);assert.equal((await g.adapter.invoke(i)).transportStarted,false);assert.equal(g.calls.length,0);}
});
test('image polling proves the same task and never converts an unlabelled cash deduction into dollars',async()=>{
  let current=task();const f=fixture({fetchImpl:async()=>json(current)}),submitted=await f.adapter.invoke(input());
  current=task({task_status:'succeed',final_unit_deduction:'8',final_balance_deduction:{quota:'0',list_price:'0.028'},task_result:{images:[{index:0,url:'https://p1-kling.klingai.com/output.png'}]}});
  let result=await f.adapter.poll({receipt:submitted.receipt});assert.equal(result.status,'completed');assert.equal(result.remoteTerminal,true);assert.deepEqual(result.billing.entries,[{charge_type:'unit',package_type:'image',amount:'8'}]);
  current.final_balance_deduction.quota='0.028';result=await f.adapter.poll({receipt:submitted.receipt});assert.equal(result.status,'completed');assert.equal(result.billing.known,false);assert.equal(result.billingDisposition,'hold');
  current.task_info.external_task_id='other-account-task';result=await f.adapter.poll({receipt:submitted.receipt});assert.equal(result.output,null);assert.equal(result.receiptId,submitted.receiptId);assert.equal(result.remoteTerminal,null);
});
test('no key or permit, unsafe output and network uncertainty never allow a second paid POST',async()=>{
  const f=fixture({enabled:false});assert.equal((await f.adapter.invoke(input())).transportStarted,false);assert.equal(f.calls.length,0);
  let calls=0;const g=fixture({fetchImpl:async()=>{calls++;throw Error('PRIVATE secret provider error');}}),r=await g.adapter.invoke(input());assert.equal(r.billingDisposition,'hold');assert.equal(r.transportStarted,true);assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);assert.equal((await g.adapter.invoke(input())).transportStarted,false);assert.equal(calls,1);
  let current=task();const h=fixture({fetchImpl:async()=>json(current)}),s=await h.adapter.invoke(input());current=task({task_status:'succeed',task_result:{images:[{url:'http://127.0.0.1/private'}]}});const polled=await h.adapter.poll({receipt:s.receipt});assert.equal(polled.output,null);assert.equal(polled.remoteTerminal,true);
});
function pngHeader(){const b=Buffer.alloc(45);Buffer.from('89504e470d0a1a0a','hex').copy(b);b.writeUInt32BE(13,8);b.write('IHDR',12);b.writeUInt32BE(300,16);b.writeUInt32BE(300,20);Buffer.from('0000000049454e44ae426082','hex').copy(b,33);return b.toString('base64');}
test('private reference bytes bind the media quote and use documented image and image-to-video Base64 fields',async()=>{
  const referenceImageBase64=pngHeader(),f=fixture(),i=input({referenceImageBase64});assert.notEqual(i.permit.requestHash,hashKlingPaidImageRequest(content()));assert.equal((await f.adapter.invoke(i)).status,'accepted');assert.equal(JSON.parse(f.calls[0].init.body).image,referenceImageBase64);
  let captured;const body={prompt:'Anime esta planta.',resolution:'720p',aspectRatio:'16:9',durationSeconds:5,externalTaskId:'video-fixture-001',referenceImageBase64};
  const v=createKlingPaidVideoAdapter({enabled:true,apiKey:'fixture-not-real',accountBinding:'fixture-account',policyRevision:'fixture-policy',now:()=>NOW,assertAuthorized:()=>true,fetchImpl:async(url,init)=>{captured={url,body:JSON.parse(init.body)};return json({id:'task-fixture-001',external_id:body.externalTaskId,status:'submitted',create_time:NOW,update_time:NOW});}});
  const permit={...i.permit,requestHash:hashKlingPaidVideoRequest(body),model:'kling-3.0',externalTaskId:body.externalTaskId};assert.equal((await v.invoke({requestId:i.requestId,...body,permit})).status,'accepted');assert.equal(captured.url,'https://api-singapore.klingai.com/image-to-video/kling-3.0');assert.equal(captured.body.contents[1].url,referenceImageBase64);assert.equal(captured.body.contents[1].type,'first_frame');assert.equal(captured.body.settings.aspect_ratio,undefined);
  assert.throws(()=>hashKlingPaidImageRequest({...content(),referenceImageBase64:'https://private.invalid/image'}));assert.throws(()=>hashKlingPaidImageRequest({...content(),referenceImageBase64:'data:image/png;base64,'+referenceImageBase64}));
});
