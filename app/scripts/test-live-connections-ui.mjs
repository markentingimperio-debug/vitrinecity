import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

const html = fs.readFileSync(new URL('../public/admin-live.html',import.meta.url),'utf8');
const source = fs.readFileSync(new URL('../public/admin-live-connections.js',import.meta.url),'utf8');
const YT = '/api/admin/live-studio/youtube-chat', IG = '/api/admin/instagram-messaging';
const turn = () => new Promise(resolve => setImmediate(resolve));
async function fixture({active=false,connected=false,igIds=[5,7],hook,query=''}={}) {
  const nodes = new Map(), calls = [], navigations = [], listeners = {};
  class Element {
    constructor(tag='div') { this.tagName=tag; this.value=''; this.textContent=''; this.children=[]; this.disabled=false; this.checked=false; this.listeners={}; }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children=items; this.textContent=''; }
    addEventListener(event,fn) { this.listeners[event]=fn; }
  }
  for (const match of html.matchAll(/id="([^"]+)"/g)) nodes.set(match[1],new Element());
  const states = {
    youtube:{oauth:{configured:true,connected,redirectUri:'https://vitrinecity.com'+YT+'/oauth/callback',channelTitle:null},connected:false,oauthConnected:connected,state:'not_connected',broadcastId:null,channelId:'UCPN5ciXL85GdPGNjpWRIqrA',deadline:null,replyLimit:30,items:[],counts:{},error:active?null:'youtube_chat_live_session_required'},
    instagram:{configured:true,loginConfigId:'123456789012345',settings:{enabled:false,autoReply:false,liveCommentsEnabled:false,accountIds:igIds,dailyLimit:30},accounts:[{id:5,label:'Conta de receitas',connected:true},{id:7,label:'Campo e Conhecimento',connected:true}]},
    studio:{status:{online:true,streaming:active,recording:false,continuous:false,durationSeconds:7200,deadline:Date.now()/1000+7200}}
  };
  const respond = (value,ok=true,status=ok?200:400) => ({ok,status,json:async()=>structuredClone(value)});
  const fetch = async (url,options={}) => {
    calls.push({url,options,body:options.body?JSON.parse(options.body):null});
    const custom = await hook?.({url,options,states,respond}); if (custom) return custom;
    if (!options.method) return respond(url===YT+'/status'?states.youtube:url===IG?states.instagram:states.studio);
    if (url===YT+'/oauth/connect') return respond({authorizationUrl:'https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({redirect_uri:states.youtube.oauth.redirectUri,response_type:'code',state:'opaque-server-state'})});
    if (url===YT+'/broadcast') { Object.assign(states.youtube,{connected:true,state:'connected',broadcastId:JSON.parse(options.body).broadcastId,autoReply:true,deadline:states.studio.status.deadline*1000}); return respond(states.youtube); }
    if (url===YT+'/disconnect') { Object.assign(states.youtube,{connected:false,state:'disconnected',autoReply:false}); return respond(states.youtube); }
    if (url===IG) { states.instagram.settings={...states.instagram.settings,...JSON.parse(options.body)}; return respond(states.instagram); }
    if (url===IG+'/login') { states.instagram.loginConfigId=JSON.parse(options.body).configId; return respond(states.instagram); }
    return respond(states.youtube.oauth);
  };
  const window={location:{search:query,assign:url=>navigations.push(url)},addEventListener:(event,fn)=>{listeners[event]=fn;}};
  vm.runInNewContext(source,{document:{getElementById:id=>nodes.get(id),createElement:tag=>new Element(tag),createTextNode:text=>text},window,fetch,URL,URLSearchParams,Date,console});
  await turn(); await turn();
  const get = id=>nodes.get(id);
  const event = (id,type='click')=>get(id).listeners[type]?.({preventDefault(){}});
  const change = (id,value)=>{get(id).checked=value;return event(id,'change');};
  const accounts = ()=>get('liveIgAccounts').children.map(label=>label.children[0]);
  return {get,event,change,accounts,calls,navigations,states,listeners,writes:()=>calls.filter(c=>c.options.method)};
}

test('markup keeps timer separate, credentials private and public/private channels explicit',()=>{
  assert.match(html,/admin-live\.js\?v=20260912-two-hours/);
  assert.match(html,/admin-live-connections\.js\?v=/);
  assert.match(html,/id="liveYtClientSecret" type="password" autocomplete="new-password"/);
  assert.match(html,/YouTube · chat público/); assert.match(html,/Instagram · Direct privado/);
  assert.match(html,/intent=instagram_messages&amp;returnTo=admin/);
  assert.doesNotMatch(source,/localStorage|sessionStorage|innerHTML|\/control|TRANSMITIR|voice/);
});

test('opening is GET-only and preserves actual saved accounts without auto-activation',async()=>{
  const f=await fixture();
  assert.deepEqual(f.calls.map(c=>c.url).sort(),[YT+'/status',IG,'/api/admin/live-studio'].sort());
  assert.equal(f.writes().length,0);assert.equal(f.navigations.length,0);
  assert.ok(f.calls.every(c=>c.options.credentials==='same-origin'&&c.options.cache==='no-store'));
  assert.deepEqual(f.accounts().filter(n=>n.checked).map(n=>Number(n.value)),[5,7]);
  assert.equal(f.get('liveIgEnabled').checked,false); assert.equal(f.get('liveIgLiveComments').checked,false);
  assert.equal(f.get('liveYtAutoReply').checked,false); assert.equal(f.get('liveYtBind').disabled,true);
  assert.match(f.get('liveYtStatus').textContent,/Falta autorizar/);
});

test('account 7 is a draft default only when the saved list is empty and that connection exists',async()=>{
  const f=await fixture({igIds:[]});
  assert.deepEqual(f.accounts().filter(n=>n.checked).map(n=>Number(n.value)),[7]);
  assert.equal(f.writes().length,0);assert.deepEqual(f.states.instagram.settings.accountIds,[]);
  f.states.instagram.accounts=[]; await f.event('liveConnectionsRefresh');
  assert.match(f.get('liveIgAccounts').textContent,/Nenhuma conta/);
  await f.change('liveIgEnabled',true);await f.event('liveIgForm','submit');
  assert.equal(f.writes().length,0);assert.match(f.get('liveConnectionsNotice').textContent,/Selecione a conta/);
});

test('saving Google credentials requires both values and clears the secret even on failure',async()=>{
  const f=await fixture({hook:async({url,respond})=>url.endsWith('/oauth/app')?respond({error:'DO_NOT_DISPLAY_SECRET'},false):null});
  f.get('liveYtClientId').value='123456789012.apps.googleusercontent.com';await f.event('liveYtClientId','input');
  await f.event('liveYtAppForm','submit');assert.equal(f.writes().length,0);
  f.get('liveYtClientSecret').value='PRIVATE_CLIENT_SECRET';await f.event('liveYtClientSecret','input');
  await f.event('liveYtAppForm','submit');
  assert.equal(f.writes().length,1);assert.deepEqual(f.writes()[0].body,{clientId:'123456789012.apps.googleusercontent.com',clientSecret:'PRIVATE_CLIENT_SECRET'});
  assert.equal(f.get('liveYtClientSecret').value,'');assert.equal(f.get('liveYtSaveApp').disabled,true);
  assert.doesNotMatch(f.get('liveConnectionsNotice').textContent,/PRIVATE_CLIENT_SECRET|DO_NOT_DISPLAY_SECRET/);
});

test('Google authorization is explicit and duplicate clicks create only one grant',async()=>{
  const f=await fixture();
  await Promise.all([f.event('liveYtAuthorize'),f.event('liveYtAuthorize')]);
  assert.equal(f.writes().length,1);assert.equal(f.navigations.length,1);
  assert.equal(new URL(f.navigations[0]).origin,'https://accounts.google.com');
  assert.equal(f.get('liveYtAuthorize').disabled,true);
});

test('OAuth cannot redirect to another host or a different callback even through Google',async()=>{
  for (const authorizationUrl of ['https://evil.test/?code=unsafe','https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=https%3A%2F%2Fevil.test&response_type=code&state=foo']) {
    const f=await fixture({hook:async({url,respond})=>url.endsWith('/oauth/connect')?respond({authorizationUrl}):null});
    await f.event('liveYtAuthorize');assert.equal(f.navigations.length,0);assert.match(f.get('liveConnectionsNotice').textContent,/endereço.*validado/);
  }
});

test('binding requires current two-hour session, authorization and explicit reply permission',async()=>{
  const f=await fixture({active:false,connected:true});f.get('liveYtBroadcastId').value='https://www.youtube.com/watch?v=abcdefghijk';
  await f.change('liveYtAutoReply',true);await f.event('liveYtBroadcastForm','submit');assert.equal(f.writes().length,0);
  f.states.studio.status.streaming=true;await f.event('liveConnectionsRefresh');
  await Promise.all([f.event('liveYtBroadcastForm','submit'),f.event('liveYtBroadcastForm','submit')]);
  assert.equal(f.writes().length,1);assert.deepEqual(f.writes()[0].body,{broadcastId:'abcdefghijk',autoReply:true});
  assert.equal(f.writes()[0].url,YT+'/broadcast');assert.equal(f.get('liveYtBind').disabled,true);
  assert.match(f.get('liveYtSession').textContent,/chat público.*Limite da sessão/);
});

test('unsafe and ambiguous broadcast URLs are rejected without creating a binding',async()=>{
  const f=await fixture({active:true,connected:true});await f.change('liveYtAutoReply',true);
  for (const value of ['https://evil.test/watch?v=abcdefghijk','http://youtube.com/watch?v=abcdefghijk','https://youtube.com/watch?v=abcdefghijk&v=12345678901','https://youtube.com@evil.test/watch?v=abcdefghijk','https://youtube.com/shorts/abcdefghijk']) {
    f.get('liveYtBroadcastId').value=value;await f.event('liveYtBroadcastForm','submit');
  }
  assert.equal(f.writes().length,0);assert.match(f.get('liveConnectionsNotice').textContent,/link oficial/);
});

test('a network timeout after binding reconciles by GET and cannot automatically submit again',async()=>{
  const f=await fixture({active:true,connected:true,hook:async({url,states})=>{
    if(url===YT+'/broadcast'){Object.assign(states.youtube,{connected:true,state:'connected',broadcastId:'abcdefghijk',autoReply:true});throw Error('timeout');}
  }});
  await f.change('liveYtAutoReply',true);f.get('liveYtBroadcastId').value='abcdefghijk';
  await f.event('liveYtBroadcastForm','submit');await f.event('liveYtBroadcastForm','submit');
  assert.equal(f.writes().length,1);assert.equal(f.get('liveYtBind').disabled,true);
  assert.match(f.get('liveConnectionsNotice').textContent,/Não foi possível confirmar/);
  assert.ok(f.calls.filter(c=>c.url===YT+'/status').length>=2);
});

test('connected status alone and counters do not claim a verified reply',async()=>{
  const f=await fixture({active:true,connected:true});
  Object.assign(f.states.youtube,{connected:true,state:'connected',counts:{sent:8},items:[{state:'sent',providerReplyId:null,confirmedAt:Date.now()},{state:'held_unknown',providerReplyId:'abc',confirmedAt:Date.now()}]});
  await f.event('liveConnectionsRefresh');assert.match(f.get('liveYtReceipts').textContent,/Nenhuma resposta/);
  f.states.youtube.items.push({state:'sent',providerReplyId:'LCC.Ehw:test+/=',confirmedAt:Date.now()});
  await f.event('liveConnectionsRefresh');assert.match(f.get('liveYtReceipts').textContent,/1 envio\(s\) com recibo/);assert.match(f.get('liveYtReceipts').textContent,/não confirma leitura/);
  assert.match(f.get('liveYtSession').textContent,/30 respostas nesta sessão de 2 horas/);
});

test('Instagram settings are explicit, preserve account selection and do not change on a refresh',async()=>{
  const f=await fixture();await f.change('liveIgEnabled',true);await f.change('liveIgAutoReply',true);await f.change('liveIgLiveComments',true);
  const recipe=f.accounts().find(n=>n.value==='5');recipe.checked=false;recipe.listeners.change();
  await f.event('liveConnectionsRefresh');assert.equal(f.get('liveIgEnabled').checked,true);assert.equal(f.accounts().find(n=>n.value==='5').checked,false);
  await Promise.all([f.event('liveIgForm','submit'),f.event('liveIgForm','submit')]);
  assert.equal(f.writes().length,1);assert.equal(f.writes()[0].options.method,'PUT');
  assert.deepEqual(f.writes()[0].body,{enabled:true,autoReply:true,liveCommentsEnabled:true,accountIds:[7]});
  assert.doesNotMatch(f.get('liveIgReadiness').textContent,/resposta entregue confirmada/);
});

test('YouTube outage does not prevent pausing Instagram; missing authorization cannot enable YouTube',async()=>{
  const f=await fixture({hook:async({url,respond})=>url===YT+'/status'?respond({error:'provider unavailable'},false,503):null});
  assert.equal(f.get('liveYtBind').disabled,true);assert.equal(f.get('liveYtAuthorize').disabled,true);
  assert.equal(f.get('liveIgSave').disabled,false);
  await f.event('liveIgForm','submit');assert.equal(f.writes().length,1);assert.equal(f.writes()[0].url,IG);assert.equal(f.writes()[0].body.enabled,false);
});

test('callback needs review is honest and page exit clears typed credentials',async()=>{
  const f=await fixture({query:'?youtubeChat=needs_review'});
  assert.match(f.get('liveConnectionsNotice').textContent,/autorização.*não foi concluída/);
  f.get('liveYtClientSecret').value='PRIVATE';f.listeners.pagehide();assert.equal(f.get('liveYtClientSecret').value,'');assert.equal(f.writes().length,0);
});

test('Instagram login configuration is an explicit non-secret save and preserves unsaved input',async()=>{
  const f=await fixture();assert.equal(f.get('liveIgLoginConfigId').value,'123456789012345');
  f.get('liveIgLoginConfigId').value='123-not-a-config';await f.event('liveIgLoginConfigId','input');
  await f.event('liveIgLoginForm','submit');assert.equal(f.writes().length,0);
  f.get('liveIgLoginConfigId').value='987654321012345';await f.event('liveIgLoginConfigId','input');
  await f.event('liveConnectionsRefresh');assert.equal(f.get('liveIgLoginConfigId').value,'987654321012345');
  await Promise.all([f.event('liveIgLoginForm','submit'),f.event('liveIgLoginForm','submit')]);
  assert.equal(f.writes().length,1);assert.equal(f.writes()[0].url,IG+'/login');assert.equal(f.writes()[0].options.method,'PUT');
  assert.deepEqual(f.writes()[0].body,{configId:'987654321012345'});assert.equal(f.get('liveIgLoginConfigId').value,'987654321012345');
  assert.equal(f.states.instagram.settings.enabled,false);assert.equal(f.navigations.length,0);
});
