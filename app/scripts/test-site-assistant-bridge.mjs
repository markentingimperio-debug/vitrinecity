import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {classifySiteAssistantPath,siteAssistantContextPath,siteAssistantEmbeddedPath,safeSiteAssistantContentUrl} from '../public/site-assistant-policy.js';
import {siteAssistantDestination} from '../public/site-assistant-content.js';
import {injectSiteAssistant,injectSiteAssistantContent} from '../site-assistant-page.js';
import {isGamesAppPath} from '../games-app-routes.js';

const origin='https://vitrinecity.com';
const bridgeSource=readFileSync(new URL('../public/site-assistant-bridge.js',import.meta.url),'utf8');
function bridge({url=origin+'/produto/13/adubo?lia=1',embedded=true,readyState='loading'}={}){
  const messages=[],attributes={},listeners=new Map(),location=new URL(url);
  const doc={readyState,documentElement:{setAttribute(key,value){attributes[key]=value;}},addEventListener(type,callback){listeners.set(type,callback);}};
  for(const key of ['forms','querySelector','querySelectorAll','getElementById'])Object.defineProperty(doc,key,{get(){throw Error('Bridge must not inspect forms or private page fields');}});
  const win={location,parent:{postMessage(payload,targetOrigin){messages.push({payload:JSON.parse(JSON.stringify(payload)),targetOrigin});}}};win.self=win;win.top=embedded?{}:win;
  vm.runInNewContext(bridgeSource,{window:win,document:doc,location,URL,URLSearchParams,fetch(){throw Error('Bridge must not fetch');},localStorage:{getItem(){throw Error('Bridge must not read storage');}}});
  return {win,messages,attributes,listeners,ready(){listeners.get('DOMContentLoaded')?.();},click({href='/loja?carrinho=1',button=0,download=false,defaultPrevented=false,anchor=true}={}){
    let prevented=false;const link={href:new URL(href,location).href,getAttribute:key=>key==='href'?href:null,hasAttribute:key=>key==='download'&&download};
    listeners.get('click')?.({target:{closest:()=>anchor?link:null},button,defaultPrevented,preventDefault(){prevented=true;}});return prevented;
  }};
}

test('bridge is inert on normal top-level navigation and frames without the explicit viewer marker',()=>{
  for(const options of [{embedded:false},{url:origin+'/loja?lia=0'},{url:origin+'/loja'}]){
    const h=bridge(options);assert.deepEqual(h.attributes,{});assert.equal(h.win.vcLiaNavigate,undefined);assert.equal(h.listeners.size,0);assert.deepEqual(h.messages,[]);
  }
});

test('embedded bridge announces only its URL to its exact origin and never reads form fields or storage',()=>{
  const h=bridge({url:origin+'/entrar.html?lia=1'});assert.equal(h.attributes['data-lia-embedded'],'');assert.equal(h.messages.length,0);
  h.ready();assert.deepEqual(h.messages,[{payload:{type:'vc-lia-viewer',action:'ready',url:origin+'/entrar.html?lia=1'},targetOrigin:origin}]);
  const loaded=bridge({readyState:'complete'});assert.equal(loaded.messages[0].payload.action,'ready');assert.equal(loaded.messages[0].targetOrigin,origin);
});

test('internal navigation preserves product, cart and review identity while setting exactly one embed marker',()=>{
  const h=bridge();
  for(const input of ['/loja?carrinho=1','/produto/13/adubo?avaliacoes=2&lia=0#avaliacoes','/course-checkout.html?curso=canva']){
    assert.equal(h.win.vcLiaNavigate(input),true);const record=h.messages.at(-1),url=new URL(record.payload.url);
    assert.equal(record.payload.action,'navigate');assert.equal(record.targetOrigin,origin);assert.deepEqual(url.searchParams.getAll('lia'),['1']);
    const requested=new URL(input,origin);assert.equal(url.pathname,requested.pathname);assert.equal(url.hash,requested.hash);
    for(const [key,value] of requested.searchParams)if(key!=='lia')assert.equal(url.searchParams.get(key),value);
  }
});

test('legal pages, recovery, affiliate redirects and payment providers request explicit external continuation',()=>{
  const h=bridge();
  for(const input of ['/termos-creditos.html','/termos-marketplace.html','/privacy.html','/recuperar-acesso.html','/meus-cursos.html','/ir/partner-1','https://www.mercadopago.com.br/checkout/test?pref_id=fixture']){
    h.win.vcLiaNavigate(input);const record=h.messages.at(-1);assert.equal(record.payload.action,'external');assert.equal(record.payload.url,new URL(input,origin).href);assert.equal(record.targetOrigin,origin);
    const target=siteAssistantDestination(record.payload.url,origin);assert.equal(target.kind,'external');assert.equal(target.contextPath,undefined);
  }
});

test('invalid destinations are consumed without navigation, message, fetch or controller fallback',()=>{
  const h=bridge();
  for(const input of [null,{},'javascript:alert(1)','data:text/html,bad','//evil.test','https://user:password@evil.test/','http://evil.test/','/loja\\admin','/loja\nadmin','x'.repeat(2049)])assert.equal(h.win.vcLiaNavigate(input),true);
  assert.equal(h.messages.length,0);
  // The bridge cannot authorize a private destination; the parent validates it.
  h.win.vcLiaNavigate('/admin.html');assert.equal(siteAssistantDestination(h.messages.at(-1).payload.url,origin),null);
});

test('only ordinary document link clicks are intercepted; hash, download and handled actions stay local',()=>{
  const h=bridge();assert.equal(h.click(),true);assert.equal(h.messages.length,1);
  for(const options of [{href:'#avaliacoes'},{download:true},{defaultPrevented:true},{button:1},{anchor:false}])assert.equal(h.click(options),false);
  assert.equal(h.messages.length,1);
});

test('the only private forms permitted in the viewer never become an assistant context',()=>{
  for(const path of ['/entrar.html','/minha-conta.html','/presente.html']){
    assert.equal(siteAssistantEmbeddedPath(path),true);assert.equal(classifySiteAssistantPath(path).enabled,false);assert.equal(siteAssistantContextPath(path,'?lia=1&returnTo=%2Floja'),'');
    const target=siteAssistantDestination(path+'?returnTo=%2Floja%3Fcarrinho%3D1',origin);assert.equal(target.kind,'embedded');assert.equal(target.contextPath,'');
  }
  for(const path of ['/admin.html','/carteira','/meus-dados.html','/pagamento.html','/pedidos.html','/minha-conta','/entrar.html/extra'])assert.equal(siteAssistantEmbeddedPath(path),false,path);
});

test('content URL boundaries reject credentials, sensitive queries, private returns and nested returns',()=>{
  for(const input of ['//evil.test','javascript:alert(1)','http://evil.test/','https://name:secret@vitrinecity.com/loja','/api/users','/loja?token=secret','/loja?%74oken=secret','/minha-conta.html?password=x',
    '/entrar.html?returnTo=https%3A%2F%2Fevil.test','/entrar.html?returnTo=%2F%2Fevil.test','/entrar.html?returnTo=%2Fadmin.html','/entrar.html?returnTo=%2Floja%3Fsession%3Dx',
    '/entrar.html?returnTo=%2Floja&returnTo=%2Freceitas','/entrar.html?returnTo='+encodeURIComponent('/minha-conta.html?returnTo=/loja')])assert.equal(safeSiteAssistantContentUrl(input,origin),'',input);
  assert.equal(safeSiteAssistantContentUrl('/entrar.html?returnTo=%2Floja%3Fcarrinho%3D1',origin),origin+'/entrar.html?returnTo=%2Floja%3Fcarrinho%3D1');
});

const html='<!doctype html><html lang="pt-BR"><head><title>Original</title></head><body class="original"><form id="existing"><input name="email"></form><script src="/course-checkout.js" type="module"></script><script type="module" src="/site-assistant.js?v=old"></script><script src="/global-market-banner.js?v=3" defer></script><script src="/pwa-install.js?v=2"></script></body></html>';
test('embedded HTML keeps original forms/controllers, removes nested widgets/banner/PWA, and is idempotent',()=>{
  for(const path of ['/produto/13/adubo','/course-checkout.html','/entrar.html','/minha-conta.html','/presente.html']){
    const embedded=injectSiteAssistantContent(html,{path,embedded:true});
    assert.match(embedded,/<body class="original">/);assert.match(embedded,/<form id="existing"><input name="email"><\/form>/);assert.match(embedded,/src="\/course-checkout.js"/);
    assert.doesNotMatch(embedded,/src="\/(?:site-assistant|global-market-banner|pwa-install)\.js/);
    assert.equal((embedded.match(/site-assistant-bridge\.js/g)||[]).length,1);assert.equal((embedded.match(/site-assistant-embedded\.css/g)||[]).length,1);
    assert.equal(injectSiteAssistantContent(embedded,{path,embedded:true}),embedded);
  }
});

test('normal, unknown and AMP HTML stay unchanged by the content injector',()=>{
  assert.equal(injectSiteAssistantContent(html,{path:'/loja'}),html);
  for(const path of ['/admin.html','/api/users','/meus-dados.html'])assert.equal(injectSiteAssistantContent(html,{path,embedded:true}),html);
  for(const marker of ['amp','amp=""','⚡']){const amp=html.replace('<html ','<html '+marker+' ');assert.equal(injectSiteAssistantContent(amp,{path:'/loja',embedded:true}),amp);}
  assert.equal(injectSiteAssistantContent(html,{path:'/loja',embedded:true,amp:true}),html);
});

test('production response wrapper applies embed suppression before normal PWA/banner injection and leaves normal navigation intact',()=>{
  const server=readFileSync(new URL('../server.js',import.meta.url),'utf8').replace(/\r\n/g,'\n'),start=server.indexOf('app.use((req, res, next) => {\n  const send = res.send.bind(res);'),end=server.indexOf("app.set('trust proxy'",start);
  assert.ok(start>0&&end>start);let middleware;
  vm.runInNewContext(server.slice(start,end),{app:{use(fn){middleware=fn;}},Buffer,isGamesAppPath,injectPublicMeasurement:page=>page,injectSiteAssistant,injectSiteAssistantContent});
  function render({embedded=false,buffer=false,method='GET',path='/loja',amp=false}={}){
    let output;const headers={'content-type':'text/html'},req={method,path,query:embedded?{lia:'1'}:{}};
    const res={locals:{vcAmpStory:amp},getHeader:key=>headers[key],setHeader(key,value){headers[key]=value;},send(body){output=body;return this;}};
    middleware(req,res,()=>{});res.send(buffer?Buffer.from(html):html);return {output,headers};
  }
  const embedded=render({embedded:true,buffer:true});assert.ok(Buffer.isBuffer(embedded.output));assert.equal(embedded.headers['Content-Length'],embedded.output.length);assert.match(embedded.output.toString(),/site-assistant-bridge/);assert.doesNotMatch(embedded.output.toString(),/global-market-banner|pwa-install/);
  const normal=render().output;assert.match(normal,/site-assistant\.js/);assert.match(normal,/global-market-banner/);assert.match(normal,/pwa-install/);assert.doesNotMatch(normal,/site-assistant-bridge/);
  assert.equal(render({embedded:true,method:'POST'}).output,html);assert.equal(render({embedded:true,path:'/admin.html'}).output,html);assert.equal(render({embedded:true,amp:true}).output,html);
});
