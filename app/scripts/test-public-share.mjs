import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mountPublicShare,publicShareUrl,publicSharePath} from '../public/public-share.js';

const origin='https://vitrinecity.com';
const url=(value,options={})=>publicShareUrl(value,{origin,...options});
test('public catalog, editorial, city and games routes are eligible, private and unknown routes are not',()=>{
  for(const path of ['/','/produto/11/rosa-do-deserto','/loja/official_agrotecnica','/cursos/plantas','/artigo/plantas','/livro/guia','/categoria/substratos','/stories/plantas','/social/post/official-seed-022','/multiverso','/cidade-premium','/cidade/silvania','/musicas/playlist-publica','/cinema/filme-publico','/artigos/guia.html','/portfolio','/privacy.html','/mini-fazenda','/jogos','/games/','/games/blocos','/games/jardim'])assert.equal(publicSharePath(path),true,path);
  for(const path of ['/admin','/admin-live.html','/api/lots','/minha-conta.html','/entrar.html','/entrar-cidade.html','/carteira','/pedidos.html','/course-checkout.html','/presente.html','/chat-social.html','/buscar.html','/pesquisar','/games/dados','/games/entrar','/games/unknown','/unknown.html','//produto/11','/produto/%31','/produto/../admin','/loja/a?token=b'])assert.equal(publicSharePath(path),false,path);
});
test('same-origin public canonical is clean while foreign, private, duplicate and malicious destinations never escape',()=>{
  assert.equal(url('/produto/11?token=private&email=private%40example.test#cart',{canonical:'/produto/11/rosa-do-deserto?auth=private'}),origin+'/produto/11/rosa-do-deserto');
  for(const canonical of ['https://outside.test/produto/12','//outside.test/produto/12','/admin','javascript:alert(1)','/minha-conta.html','https://x:y@vitrinecity.com/loja'])assert.equal(url('/produto/11',{canonical}),origin+'/produto/11');
  for(const input of ['https://outside.test/produto/11','https://x:y@vitrinecity.com/loja','javascript:alert(1)','/admin?returnTo=/loja','/loja\\evil'])assert.equal(url(input),'');
});
test('only public post, edition, city, store and course identity survives the query',()=>{
  assert.equal(url('/social?post=official-seed-022&usuario=private&token=private',{canonical:'/social'}),origin+'/social/post/official-seed-022');
  assert.equal(url('/oracao-do-dia.html?dia=2026-09-12&email=x',{canonical:'/oracao-do-dia'}),origin+'/oracao-do-dia?dia=2026-09-12');
  assert.equal(url('/oracao-do-dia?dia=2026-02-31'),origin+'/oracao-do-dia');
  assert.equal(url('/oracao-do-dia?dia=2026-09-12',{editionDay:'2026-09-13'}),origin+'/oracao-do-dia?dia=2026-09-13');
  assert.equal(url('/multiverso?city=silvania&return=1&token=private#saved'),origin+'/multiverso?city=silvania');
  assert.equal(url('/loja.html?store=official_agrotecnica&q=private&carrinho=1'),origin+'/loja.html?store=official_agrotecnica');
  assert.equal(url('/centro-educacional?curso=plantas-em-vasos&checkout=1'),origin+'/cursos/plantas-em-vasos');
  for(const input of ['/social?post=a&post=b','/social?post=person%40example.test','/multiverso?city=private%40example.test','/games/?install=1&plant=private'])assert.doesNotMatch(url(input),/[?#]/);
});

class Events{
  listeners=new Map();
  addEventListener(type,callback){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(callback);}
  removeEventListener(type,callback){this.listeners.get(type)?.delete(callback);}
  async emit(type,extras={}){const e={type,target:this,prevented:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extras};await Promise.all([...(this.listeners.get(type)||[])].map(fn=>fn(e)));return e;}
}
class Element extends Events{
  constructor(tag,doc){super();this.tagName=tag;this.doc=doc;this.attrs={};this.children=[];this.hidden=false;this._text='';}
  setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]??null;}hasAttribute(k){return Object.hasOwn(this.attrs,k);}
  set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
  append(...nodes){for(const n of nodes){n.remove();n.parent=this;this.children.push(n);}}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);this.parent=null;}
  insertAdjacentElement(where,node){assert.equal(where,'afterend');const p=this.parent;node.remove();node.parent=p;p.children.splice(p.children.indexOf(this)+1,0,node);}
  focus(){this.doc.activeElement=this;}select(){this.selected=true;}
}
function fixture({path='/produto/11/rosa-do-deserto',canonical='',robots='',amp=false,existingShare=false,citySlot=true}={}){
  const doc=new Events(),win=new Events();doc.title='VitrineCity';doc.createElement=tag=>new Element(tag,doc);doc.documentElement=doc.createElement('html');doc.head=doc.createElement('head');doc.body=doc.createElement('body');doc.documentElement.append(doc.head,doc.body);
  if(amp)doc.documentElement.setAttribute('amp','');
  const main=doc.createElement('main'),board=doc.createElement('button'),footer=doc.createElement('footer');main.append(board);doc.body.append(main,footer);board.focus();
  if(canonical){const link=doc.createElement('link');link.setAttribute('rel','canonical');link.setAttribute('href',canonical);doc.head.append(link);}
  if(robots){const meta=doc.createElement('meta');meta.setAttribute('name','robots');meta.setAttribute('content',robots);doc.head.append(meta);}
  if(existingShare)board.id='sharePrayer';
  const slot=citySlot?doc.createElement('div'):null;if(slot)main.append(slot);
  const all=n=>[n,...n.children.flatMap(all)];
  doc.getElementById=id=>all(doc.documentElement).find(n=>n.id===id)||null;
  doc.querySelectorAll=q=>q==='meta[name]'?doc.head.children.filter(n=>n.tagName==='meta'):q==='link[rel="canonical"]'?doc.head.children.filter(n=>n.getAttribute('rel')==='canonical'):[];
  doc.querySelector=q=>q==='main'?main:q==='#cityTools .view-controls'?slot:null;
  win.location=new URL(path,origin);win.top=win.self=win;win.navigator={};
  return{doc,win,main,board,footer,slot,mount:()=>mountPublicShare({document:doc,window:win})};
}
test('mount is nonmodal and deduplicated, no native share, navigation, clipboard, storage or focus on opening',()=>{
  const f=fixture();let activity=0;f.win.navigator.share=()=>activity++;f.win.navigator.clipboard={writeText:()=>activity++};f.win.fetch=()=>activity++;f.win.open=()=>activity++;f.win.localStorage={getItem:()=>{throw Error('must not inspect');}};
  const ui=f.mount();assert.ok(ui);assert.equal(activity,0);assert.equal(f.doc.activeElement,f.board);assert.equal(f.doc.body.children[1],ui.panel);assert.equal(f.mount(),null);
  assert.equal(ui.account.href,'/entrar-cidade.html?returnTo=%2Fproduto%2F11%2Frosa-do-deserto');assert.match(ui.panel.textContent,/Cadastro opcional/);assert.equal(ui.panel.getAttribute('role'),null);
});
test('cancelled native share neither copies nor reports delivery; pending native request rejects double clicks',async()=>{
  const f=fixture();let finish,calls=0,copies=0;f.win.navigator.share=()=>{calls++;return new Promise((_,reject)=>finish=reject);};f.win.navigator.clipboard={writeText:()=>copies++};const ui=f.mount();
  const first=ui.share.emit('click');assert.equal(calls,1);assert.equal(ui.share.disabled,true);await ui.share.emit('click');assert.equal(calls,1);
  finish(Object.assign(new Error('user cancel'),{name:'AbortError'}));await first;
  assert.equal(copies,0);assert.equal(ui.status.textContent,'Compartilhamento cancelado.');assert.equal(ui.share.disabled,false);assert.notEqual(ui.options.open,true);
});
test('native success reports chooser only, missing API and native failure offer explicit alternatives',async()=>{
  const f=fixture(),ui=f.mount();await ui.share.emit('click');assert.equal(ui.options.open,true);assert.match(ui.status.textContent,/Escolha/);
  f.win.navigator.share=async()=>{};await ui.share.emit('click');assert.match(ui.status.textContent,/Opções.*abertas/);assert.doesNotMatch(ui.status.textContent,/enviado|entregue|concluído/);
  f.win.navigator.share=async()=>{throw new Error('private error detail');};await ui.share.emit('click');assert.match(ui.status.textContent,/Não foi possível/);assert.doesNotMatch(ui.status.textContent,/private/);
});
test('copy confirms only clipboard success; rejected clipboard selects only the public link',async()=>{
  const f=fixture({path:'/produto/11?token=secret&email=person%40example.test'}),ui=f.mount();const writes=[];f.win.navigator.clipboard={writeText:async text=>writes.push(text)};
  await ui.copy.emit('click');assert.deepEqual(writes,[origin+'/produto/11']);assert.match(ui.status.textContent,/Link copiado/);assert.equal(ui.manual.hidden,true);
  f.win.navigator.clipboard.writeText=async()=>{throw Error('denied');};await ui.copy.emit('click');assert.equal(ui.manual.hidden,false);assert.equal(ui.input.value,origin+'/produto/11');assert.equal(ui.input.readOnly,true);assert.equal(ui.input.selected,true);assert.equal(f.doc.activeElement,ui.input);assert.doesNotMatch(ui.status.textContent,/Link copiado/);
});
test('WhatsApp is an explicit protected link and every action revalidates the current public page',async()=>{
  const f=fixture({path:'/social?post=official-seed-022&token=private'}),ui=f.mount();let opened=0;f.win.open=()=>opened++;
  assert.equal(opened,0);assert.equal(ui.whatsapp.target,'_blank');assert.equal(ui.whatsapp.rel,'noopener noreferrer');
  const e=await ui.whatsapp.emit('click');assert.equal(e.prevented,false);assert.equal(new URL(ui.whatsapp.href).searchParams.get('text'),origin+'/social/post/official-seed-022');assert.equal(opened,0,'Only browser anchor default navigates, after the user click');
  f.win.location=new URL('/minha-conta.html?token=private',origin);const blocked=await ui.whatsapp.emit('click');assert.equal(blocked.prevented,true);assert.equal(ui.panel.hidden,true);
});
test('plant app shares only its public URL and copied signup invitation preserves a clean first-party return',async()=>{
  const f=fixture({path:'/games/plantas?plant=private-name&email=private%40example.test#notes'}),ui=f.mount(),writes=[];
  f.win.localStorage={getItem(){throw Error('Plant records must not be inspected');}};
  f.win.navigator.clipboard={writeText:async text=>writes.push(text)};
  assert.ok(ui);assert.equal(writes.length,0);await ui.copy.emit('click');assert.equal(writes[0],origin+'/games/plantas');
  await ui.copyInvitation.emit('click');assert.match(writes[1],/Crie sua conta, se quiser/);assert.ok(writes[1].endsWith(origin+'/entrar-cidade.html?returnTo=%2Fgames%2Fplantas'));assert.doesNotMatch(writes[1],/private|notes|email/);assert.match(ui.status.textContent,/Convite copiado/);
});
test('private, noindex, error, embedded and AMP documents have zero added UI or stylesheet',()=>{
  for(const options of [{path:'/admin-live.html'},{path:'/games/dados'},{robots:'noindex,follow'},{robots:'NONE'},{amp:true}]){const f=fixture(options);assert.equal(f.mount(),null);assert.equal(f.doc.getElementById('vc-public-share-style'),null);}
  const f=fixture();f.win.top={};assert.equal(f.mount(),null);
  const e=fixture();e.doc.title='Página não encontrada · VitrineCity';assert.equal(e.mount(),null);
});
test('city uses only the existing movable controls, preserves richer page share and cleans up',async()=>{
  const f=fixture({path:'/multiverso?city=silvania',robots:'noindex,nofollow,noarchive'}),ui=f.mount();assert.equal(ui.panel.parent,f.slot);assert.equal(f.doc.body.children.length,2);assert.equal(f.doc.activeElement,f.board);
  assert.ok(fixture({path:'/vitriny-multiverse-explore.html?city=vitrine-city',robots:'noindex,nofollow'}).mount());
  assert.equal(fixture({path:'/cidade-premium',robots:'noindex'}).mount(),null,'exception is limited to the two requested public city paths');
  assert.equal(fixture({path:'/multiverso',citySlot:false}).mount(),null);
  const richer=fixture({path:'/oracao-do-dia',existingShare:true}),r=richer.mount();assert.equal(r.share.parent,undefined);assert.equal(r.copy.parent,undefined);assert.ok(r.copyInvitation.parent);assert.ok(r.account.parent);assert.equal(richer.board.listeners.size,0);
  await f.win.emit('pagehide',{persisted:true});assert.ok(ui.panel.parent);await f.win.emit('pagehide',{persisted:false});assert.equal(ui.panel.parent,null);ui.dispose();
});
test('CSS remains in document flow with mobile wrapping, touch size and reduced motion; hooks do not change manifests',()=>{
  const css=readFileSync(new URL('../public/public-share.css',import.meta.url),'utf8');assert.doesNotMatch(css,/position\s*:\s*(fixed|absolute|sticky)/);assert.match(css,/min-height:44px/);assert.match(css,/minmax\(0,1fr\)/);assert.match(css,/prefers-reduced-motion:reduce/);
  const pwa=readFileSync(new URL('../public/pwa-install.js',import.meta.url),'utf8');assert.match(pwa,/hasAttribute\('amp'\)/);assert.ok(pwa.indexOf('public-share.js')<pwa.indexOf('const isStandalone'));
  const app=readFileSync(new URL('../public/games/app.js',import.meta.url),'utf8');assert.match(app,/mountPublicShare/);assert.match(app,/scope:'\/games\/'/);
});
