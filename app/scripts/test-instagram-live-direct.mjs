import assert from 'node:assert/strict';
import {sendInstagramLiveDirect} from '../instagram-live-direct.js';
const args={instagramId:'123',commentId:'456',mediaId:'789',text:'Olá! Sou o assistente virtual da VitrineCity.',token:'test-only'};
let requests=[];
const reply=(ok,data,status=200)=>({ok,status,json:async()=>data});
assert.deepEqual(await sendInstagramLiveDirect({...args,fetchImpl:async(url,options)=>{
  requests.push({url,options});return requests.length===1?reply(true,{data:[{id:'789'}]}):reply(true,{message_id:'sent-1'});
}}),{messageId:'sent-1'});
assert.equal(requests.length,2);
assert.equal(requests[1].url,'https://graph.facebook.com/v26.0/123/messages');
assert.deepEqual(JSON.parse(requests[1].options.body),{recipient:{comment_id:'456'},message:{text:args.text}});
assert.ok(requests.every(r=>!r.url.includes('test-only')));
for(const first of [reply(true,{data:[]}),reply(true,{data:[{id:'999'}]}),reply(false,{},403),reply(true,{})]){
  let count=0;await assert.rejects(sendInstagramLiveDirect({...args,fetchImpl:async()=>{count++;return first}}));assert.equal(count,1);
}
let attempts=0;
await assert.rejects(sendInstagramLiveDirect({...args,fetchImpl:async()=>{if(++attempts===1)return reply(true,{data:[{id:'789'}]});throw Error('token must never leak');}}),/send_unknown/);
assert.equal(attempts,2);
await assert.rejects(sendInstagramLiveDirect({...args,mediaId:'../invalid',fetchImpl:()=>{throw Error('must not call')}}),/invalid_reply/);
console.log('Instagram live Direct: destination, active-live guard, secret hygiene, no retry OK');
