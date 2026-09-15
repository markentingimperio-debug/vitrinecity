import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/admin-youtube.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/admin-youtube.html',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(fetchOverride){
  const nodes=new Map(),calls=[],navigations=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',value:'',disabled:false,listeners:{},addEventListener(name,fn){this.listeners[name]=fn;}});return nodes.get(id);};
  const state={configured:true,connected:false,channelId:'UCPN5ciXL85GdPGNjpWRIqrA',channelTitle:null,detail:'Autorize o canal.',redirectUri:'https://vitrinecity.com/api/admin/prayer-sharing/youtube/callback'};
  const fetch=async(url,options)=>{calls.push({url,options});if(fetchOverride)return fetchOverride(url,options,state);return {ok:true,json:async()=>url.endsWith('/connect')?{authorizationUrl:'https://accounts.google.com/o/oauth2/v2/auth?state=fixture'}:state};};
  vm.runInNewContext(source,{document:{getElementById:node},window:{location:{assign:url=>navigations.push(url)}},location:{search:''},fetch,URL,URLSearchParams});await turn();return {node,calls,navigations,state};
}
test('admin page protects secret input and declares connection/activation separately',()=>{assert.match(html,/type="password"[^>]+autocomplete="new-password"/);assert.match(html,/Conectar a conta não ativa/);assert.doesNotMatch(source,/localStorage|sessionStorage|innerHTML/);assert.match(server,/app\.get\('\/admin-youtube\.html',requireAdmin,publicPage\('admin-youtube\.html'\)\)/);assert.ok(server.indexOf("app.get('/admin-youtube.html'")<server.indexOf("app.use(express.static(path.join(dir, 'public')"));});
test('opening page is status-only and never connects, saves secrets or activates scheduler',async()=>{const f=await fixture();assert.equal(f.calls.length,1);assert.ok(f.calls[0].url.endsWith('/status'));assert.equal(f.calls[0].options.method,undefined);assert.equal(f.node('connect').disabled,false);assert.equal(f.node('disconnect').disabled,true);assert.equal(f.navigations.length,0);});
test('authorization click blocks duplicate requests and only navigates to Google OAuth',async()=>{const f=await fixture();const first=f.node('connect').listeners.click();const second=f.node('connect').listeners.click();await Promise.all([first,second]);assert.equal(f.calls.filter(c=>c.url.endsWith('/connect')).length,1);assert.equal(f.navigations.length,1);assert.equal(f.node('connect').disabled,true);assert.ok(f.calls.every(c=>!c.url.endsWith('/settings')));});
test('unsafe OAuth redirect never leaves page and secrets are cleared after save failure',async()=>{const f=await fixture(async(url,options,state)=>({ok:!url.endsWith('/app'),json:async()=>url.endsWith('/connect')?{authorizationUrl:'https://evil.test/?secret=bad'}:url.endsWith('/app')?{error:'Falha de configuração.'}:state}));await f.node('connect').listeners.click();assert.equal(f.navigations.length,0);assert.match(f.node('error').textContent,/endereço/);f.node('client-id').value='client';f.node('client-secret').value='PRIVATE_SECRET';await f.node('app-form').listeners.submit({preventDefault(){}});assert.equal(f.node('client-secret').value,'');assert.equal(f.calls.filter(c=>c.url.endsWith('/app')).length,1);assert.doesNotMatch(f.node('error').textContent,/PRIVATE_SECRET/);});
