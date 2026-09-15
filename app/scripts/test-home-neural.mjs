import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {HOME_NEURAL_PATH,HOME_NEURAL_LOGIN,mountHomeNeuralLinks} from '../public/vitriny-home-neural.js';

function fixture(fetchImpl,{timeout=false,empty=false}={}){
  const links=empty?[]:[new Map(),new Map()];
  const nodes=links.map(item=>({setAttribute:(key,value)=>item.set(key,value)}));
  const calls=[];let cleared=0;
  return {links,calls,get cleared(){return cleared;},run:()=>mountHomeNeuralLinks({document:{querySelectorAll:selector=>{assert.equal(selector,'[data-home-neural]');return nodes;}},fetch:async(...args)=>{calls.push(args);return fetchImpl(...args);},AbortController,setTimeout:callback=>{if(timeout)callback();return 17;},clearTimeout:id=>{assert.equal(id,17);cleared++;}})};
}
test('homepage prominently links the personal chat with an ordinary login fallback',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const hero=html.match(/<section class="home-hero"[\s\S]*?<\/section>/)?.[0]||'';
  assert.match(hero,/<h2>Vitrine Neural<\/h2>/);
  assert.match(hero,/Conversar com a IA/);assert.match(hero,/Converse com a IA\. Transforme suas ideias em imagens, vídeos ou mensagens\./);
  assert.doesNotMatch(hero,/\bLia\b/i,'personal paid-chat entry must not impersonate the sales assistant');
  assert.match(hero,/Vitrine Coins/);assert.match(hero,/antes de confirmar/);
  assert.match(hero,/href="\/multiverso\?city=vitrine-city"/);
  assert.match(hero,/aria-describedby="home-neural-note"/);
  assert.doesNotMatch(hero,/<form|<input|<textarea|<iframe|autoplay|gr[aá]tis|gratuit/i);
  assert.doesNotMatch(html,/Jarvis|jarvis-public/);
  assert.equal([...html.matchAll(/data-home-neural href="([^"]+)"/g)].length,2);
  for(const [,href] of html.matchAll(/data-home-neural href="([^"]+)"/g))assert.equal(href,HOME_NEURAL_LOGIN);
  assert.match(html,/type="module" src="\/vitriny-home-neural\.js\?v=20260915"/);
  assert.equal(new URL(HOME_NEURAL_LOGIN,'https://vitrinecity.com').searchParams.get('returnTo'),HOME_NEURAL_PATH);
});
test('mobile access remains in normal flow and reduced-motion preference survives',()=>{
  const css=readFileSync(new URL('../public/vitriny-home.css',import.meta.url),'utf8');
  assert.match(css,/@media\(max-width:740px\)[\s\S]*\.hero-actions\{display:grid;grid-template-columns:1fr/);
  assert.doesNotMatch(css,/\.hero-(?:actions|neural-cta|neural-intro)[^{]*\{[^}]*position:(?:fixed|absolute)/);
  assert.match(css,/\.hero-neural-cta:focus-visible/);assert.match(css,/prefers-reduced-motion:reduce/);
});
test('anonymous session keeps login with personal chat return target',async()=>{
  const f=fixture(async()=>({ok:false,status:401}));await f.run();
  assert.ok(f.links.every(l=>l.get('href')===HOME_NEURAL_LOGIN));assert.equal(f.cleared,1);
});
test('authenticated users get personal scope, never admin or store scope',async()=>{
  const f=fixture(async()=>({ok:true,json:async()=>({authenticated:true,user:{name:'Private fixture',email:'test@example.invalid',admin:true}})}));await f.run();
  assert.ok(f.links.every(l=>l.get('href')===HOME_NEURAL_PATH));assert.equal(f.calls.length,1);
  const [url,options]=f.calls[0];assert.equal(url,'/api/auth/me');assert.equal(options.method,'GET');assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');assert.equal(options.body,undefined);
});
test('truthy or malformed authentication must not skip login',async()=>{
  for(const authenticated of [undefined,false,'true',1,{}]){const f=fixture(async()=>({ok:true,json:async()=>({authenticated})}));await f.run();assert.ok(f.links.every(l=>l.get('href')===HOME_NEURAL_LOGIN));}
});
test('network and JSON failures preserve ordinary navigation',async()=>{
  for(const fetchImpl of [async()=>{throw Error('offline');},async()=>({ok:true,json:async()=>{throw Error('not JSON');}})]){const f=fixture(fetchImpl);await f.run();assert.ok(f.links.every(l=>l.get('href')===HOME_NEURAL_LOGIN));assert.equal(f.cleared,1);}
});
test('late responses after timeout cannot replace the fallback',async()=>{
  const f=fixture(async()=>({ok:true,json:async()=>({authenticated:true})}),{timeout:true});await f.run();assert.ok(f.links.every(l=>l.get('href')===HOME_NEURAL_LOGIN));assert.equal(f.calls[0][1].signal.aborted,true);
});
test('no access targets means no session or backend calls',async()=>{
  const f=fixture(async()=>{throw Error('must not call');},{empty:true});await f.run();assert.equal(f.calls.length,0);
});
test('navigation code has no prompt, transaction, credential storage, or external destination',()=>{
  const js=readFileSync(new URL('../public/vitriny-home-neural.js',import.meta.url),'utf8');
  assert.doesNotMatch(js,/method:\s*['"](?:POST|PATCH|PUT|DELETE)|localStorage|sessionStorage|innerHTML|window\.open|api\/neural|idempotency|access_token|console\./);
  const workspace=readFileSync(new URL('../public/neural-workspace.js',import.meta.url),'utf8');
  assert.match(workspace,/params\.get\('personal'\) === '1'/);assert.match(workspace,/personal \? '\/api\/neural\/chat'/);
  const login=readFileSync(new URL('../public/entrar.html',import.meta.url),'utf8');assert.match(login,/params\.get\('returnTo'\)/);
});
