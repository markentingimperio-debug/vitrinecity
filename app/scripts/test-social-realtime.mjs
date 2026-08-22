import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const feed = fs.readFileSync(new URL('../public/social.html', import.meta.url), 'utf8');
const chat = fs.readFileSync(new URL('../public/chat-social.html', import.meta.url), 'utf8');

assert.match(server, /app\.get\('\/api\/social\/live', requireUser/, 'live stream must require authentication');
assert.match(server, /Content-Type','text\/event-stream'/, 'live stream must use server-sent events');
assert.match(server, /sendSocialLive\(otherId,'chat-message'/, 'new chat messages must be pushed to the recipient');
assert.match(server, /sendSocialLive\(userId,'notification'/, 'new social notifications must be pushed to the recipient');
assert.match(server, /totalUnread:items\.reduce/, 'conversation API must expose total unread messages');
assert.match(feed, /new EventSource\('\/api\/social\/live'\)/, 'feed must subscribe to live notifications');
assert.match(chat, /new EventSource\('\/api\/social\/live'\)/, 'chat must subscribe to live messages');
assert.match(chat, /id="total-unread"/, 'chat must display total unread messages');

const appDir = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/(.:)/, '$1'));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitrinecity-realtime-'));
const port = 39000 + Math.floor(Math.random() * 1000);
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.js'], {
  cwd: appDir, env: { ...process.env, PORT:String(port), SITE_URL:origin, DATA_DIR:dataDir, NODE_ENV:'test' },
  stdio:['ignore','ignore','pipe']
});
let serverError = '';
child.stderr.on('data', chunk => { serverError += chunk.toString(); });

async function waitForServer() {
  for (let attempt=0;attempt<50;attempt+=1) {
    try { if ((await fetch(`${origin}/api/health`)).ok) return; } catch {}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error(`test server did not start: ${serverError.slice(0,300)}`);
}
const headers = cookie => ({ Origin:origin, 'Content-Type':'application/json', ...(cookie ? { Cookie:cookie } : {}) });
async function request(url, options={}) {
  const response=await fetch(origin+url,options),body=await response.json();
  assert.ok(response.ok, `${url} failed: ${response.status} ${JSON.stringify(body)}`);
  return { response, body };
}

try {
  await waitForServer();
  const cookies=[];
  for (const suffix of ['a','b']) {
    const {response}=await request('/api/auth/register',{method:'POST',headers:headers(),body:JSON.stringify({
      name:`Realtime ${suffix}`,email:`realtime-${suffix}@example.test`,password:'Realtime!2026',adultConfirmed:true,termsAccepted:true
    })});
    cookies.push(response.headers.get('set-cookie').split(';')[0]);
  }
  const require=createRequire(import.meta.url),Database=require('better-sqlite3'),database=new Database(path.join(dataDir,'vitrinecity.db'));
  const ids=database.prepare("SELECT id,email FROM users WHERE email LIKE 'realtime-%@example.test' ORDER BY email").all();
  database.close();
  const controller=new AbortController();
  const stream=await fetch(`${origin}/api/social/live`,{headers:{Cookie:cookies[1]},signal:controller.signal});
  assert.equal(stream.status,200);assert.match(stream.headers.get('content-type'),/text\/event-stream/);
  const received=new Set(),reader=stream.body.getReader(),decoder=new TextDecoder();let buffer='';
  const collect=(async()=>{while(!received.has('notification')||!received.has('chat-message')){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});for(const block of buffer.split('\n\n').slice(0,-1)){const event=block.match(/^event: (.+)$/m)?.[1];if(event)received.add(event)}buffer=buffer.slice(buffer.lastIndexOf('\n\n')+2)}})();
  await request(`/api/social/users/${ids[1].id}/follow`,{method:'POST',headers:headers(cookies[0])});
  const conversation=await request('/api/social/chat/conversations',{method:'POST',headers:headers(cookies[0]),body:JSON.stringify({userId:ids[1].id})});
  await request(`/api/social/chat/conversations/${conversation.body.id}/messages`,{method:'POST',headers:headers(cookies[0]),body:JSON.stringify({body:'Mensagem em tempo real'})});
  await Promise.race([collect,new Promise((_,reject)=>setTimeout(()=>reject(new Error('live events timed out')),3000))]);
  assert.ok(received.has('notification'));assert.ok(received.has('chat-message'));
  let conversations=await request('/api/social/chat/conversations',{headers:{Cookie:cookies[1]}});
  assert.equal(conversations.body.totalUnread,1);
  await request(`/api/social/chat/conversations/${conversation.body.id}/messages`,{headers:{Cookie:cookies[1]}});
  conversations=await request('/api/social/chat/conversations',{headers:{Cookie:cookies[1]}});
  assert.equal(conversations.body.totalUnread,0);
  controller.abort();
} finally {
  if (child.exitCode===null) {
    child.kill();
    await new Promise(resolve=>child.once('exit',resolve));
  }
  fs.rmSync(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}

console.log('social-realtime: ok');
