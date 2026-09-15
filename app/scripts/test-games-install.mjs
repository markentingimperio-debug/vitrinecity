import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mountGamesInstall, gamesInstallContext, gamesInstallDismissed, GAMES_INSTALL_DISMISS_KEY as KEY, GAMES_INSTALL_DISMISS_MS as WEEK} from '../public/games/install.js';

class Events {
  listeners = new Map();
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  async emit(type, data = {}) {
    const event = {type, target:this, defaultPrevented:false, preventDefault() { this.defaultPrevented = true; }, ...data};
    await Promise.all([...this.listeners.get(type) || []].map(fn => fn(event)));
    return event;
  }
}
class Element extends Events {
  constructor(tag, doc) { super(); this.tagName=tag.toUpperCase(); this.doc=doc; this.children=[]; this.attrs={}; this.hidden=false; this.disabled=false; this._text=''; }
  set textContent(value) { this._text=String(value); this.children=[]; }
  get textContent() { return this._text+this.children.map(child=>child.textContent).join(''); }
  setAttribute(key, value) { this.attrs[key]=String(value); }
  getAttribute(key) { return this.attrs[key]; }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parent=this; this.children.push(node); } }
  contains(node) { return node===this || this.children.some(child=>child.contains(node)); }
  remove() { if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this); this.parent=null; }
  insertAdjacentElement(position, node) { assert.equal(position,'afterend'); const parent=this.parent; node.remove(); node.parent=parent; parent.children.splice(parent.children.indexOf(this)+1,0,node); }
  focus() { this.doc.activeElement=this; }
}
function fixture({path='/vitriny-blocks.html', search='', stored=null, blockedStorage=false, standalone=false, ios=false}={}) {
  const doc=new Events(); doc.hidden=false; doc.createElement=tag=>new Element(tag,doc); doc.body=doc.createElement('body');
  const main=doc.createElement('main'), board=doc.createElement('button'), footer=doc.createElement('footer'); board.id='board'; main.append(board); doc.body.append(main,footer); board.focus();
  const find=(node,id)=>node.id===id?node:node.children.map(child=>find(child,id)).find(Boolean);
  doc.getElementById=id=>find(doc.body,id); doc.querySelector=selector=>selector==='main'?main:null;
  const win=new Events(), display=new Events(), storage=new Map(), timers=new Map(); let clock=2000000000000, serial=0;
  if(stored!==null)storage.set(KEY,String(stored));
  win.location={pathname:path,search}; win.self=win.top=win; win.navigator={standalone:ios}; display.matches=standalone; win.matchMedia=()=>display;
  win.localStorage={getItem(key){if(blockedStorage)throw Error('blocked');return storage.get(key)||null;},setItem(key,value){if(blockedStorage)throw Error('blocked');storage.set(key,value);}};
  win.setTimeout=(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:clock+ms});return id;}; win.clearTimeout=id=>timers.delete(id);
  const mount=()=>mountGamesInstall({document:doc,window:win,now:()=>clock});
  function advance(ms) { clock+=ms; for(const [id,timer] of [...timers])if(timer.at<=clock){timers.delete(id);timer.fn();} }
  return{doc,win,main,board,footer,storage,timers,display,mount,advance,get now(){return clock;}};
}

test('invitation is scoped to original games and exact app pages',()=>{
  for(const path of ['/jogos','/jogos/','/vitriny-games.html','/vitriny-blocks.html','/vitriny-merge.html','/vitriny-mini-fazenda.html','/mini-fazenda','/mini-fazenda/'])assert.equal(gamesInstallContext(path),'original');
  for(const path of ['/games/','/games/blocos','/games/jardim','/games/fazenda','/games/plantas'])assert.equal(gamesInstallContext(path),'app');
  for(const path of ['/','/admin','/loja','/games/offline.html','/games/install.js','/games/unknown'])assert.equal(fixture({path}).mount(),null);
  const framed=fixture(); framed.win.top={}; assert.equal(framed.mount(),null);
});

test('original pages wait for use and delay, stay below play area, and link only to canonical app',async()=>{
  const f=fixture(), ui=f.mount(); assert.equal(ui.panel.hidden,true); f.advance(15000); assert.equal(ui.panel.hidden,true);
  const key=await f.doc.emit('keydown',{target:f.board,code:'ArrowLeft'}); assert.equal(key.defaultPrevented,false);
  assert.equal(ui.panel.hidden,false); assert.equal(f.doc.activeElement,f.board); assert.equal(f.doc.body.children[1],ui.panel); assert.equal(f.doc.body.children[2],f.footer);
  assert.equal(ui.action.tagName,'A'); assert.equal(ui.action.href,'/games/?install=1'); assert.equal(ui.action.textContent,'Instalar VitrineCity Cultiva');
  let calls=0; const event=await f.win.emit('beforeinstallprompt',{prompt:()=>calls++});
  assert.equal(event.defaultPrevented,false,'Do not claim an install event belonging to a different manifest on the original site'); assert.equal(calls,0);
  assert.equal(f.mount(),null,'A second loader cannot duplicate the invitation');
});

test('activity alone does not show or install and no page focus changes',async()=>{
  const f=fixture({path:'/games/blocos'}),ui=f.mount(); await f.doc.emit('pointerdown',{target:f.board}); assert.equal(ui.panel.hidden,true);
  let calls=0; const event=await f.win.emit('beforeinstallprompt',{prompt:async()=>{calls++;return{outcome:'accepted'};}});
  assert.equal(event.defaultPrevented,true); assert.equal(calls,0); f.advance(14999); assert.equal(ui.panel.hidden,true); f.advance(1); assert.equal(ui.panel.hidden,false); assert.equal(f.doc.activeElement,f.board);
  assert.equal(ui.action.tagName,'BUTTON'); assert.equal(ui.action.textContent,'Instalar VitrineCity Cultiva');
});

test('the real Mini Fazenda clean alias mounts the Cultiva invitation and keeps the canonical install destination',async()=>{
  const f=fixture({path:'/mini-fazenda'}),ui=f.mount();assert.ok(ui);
  f.advance(15000);await f.doc.emit('pointerdown',{target:f.board});
  assert.equal(ui.panel.hidden,false);assert.equal(ui.action.href,'/games/?install=1');assert.equal(ui.action.textContent,'Instalar VitrineCity Cultiva');
  assert.equal(f.doc.activeElement,f.board);
});

test('native prompt is a one-shot explicit click with a busy guard and accepted is not claimed as installed',async()=>{
  const f=fixture({path:'/games/',search:'?install=1'}),ui=f.mount(); let resolve, calls=0;
  await f.win.emit('beforeinstallprompt',{prompt:()=>{calls++;return new Promise(r=>resolve=r);},userChoice:Promise.resolve({outcome:'accepted'})});
  const click=ui.action.emit('click'); assert.equal(calls,1); assert.equal(ui.action.disabled,true);
  await ui.action.emit('click'); assert.equal(calls,1); resolve({outcome:'accepted'}); await click;
  assert.equal(ui.panel.hidden,true); assert.ok(gamesInstallDismissed(f.storage.get(KEY),f.now)); assert.doesNotMatch(ui.panel.textContent,/instalado|Play Store/);
  assert.equal(f.doc.activeElement,f.board);
});

test('prompt dismissal and Agora não persist only a seven-day timestamp',async()=>{
  const f=fixture({path:'/games/',search:'?install=1'}),ui=f.mount();
  await f.win.emit('beforeinstallprompt',{prompt:async()=>({outcome:'dismissed'})}); await ui.action.emit('click');
  assert.equal(ui.panel.hidden,true); assert.deepEqual([...f.storage],[[KEY,String(f.now)]]);
  assert.equal(gamesInstallDismissed(f.storage.get(KEY),f.now+WEEK-1),true); assert.equal(gamesInstallDismissed(f.storage.get(KEY),f.now+WEEK),false);
  const dismissed=fixture({stored:f.now}); const hidden=dismissed.mount(); dismissed.advance(20000); await dismissed.doc.emit('pointerdown'); assert.equal(hidden.panel.hidden,true);
  const manual=fixture({path:'/games/',search:'?install=1',stored:f.now}); assert.equal(manual.mount().panel.hidden,false,'An explicit later installation request may reopen help');
  const plain=fixture(), p=plain.mount(); await p.close.emit('click'); assert.equal(p.panel.hidden,true); assert.equal(plain.storage.get(KEY),String(plain.now));
  for(const invalid of ['garbage','Infinity','-2',String(f.now+1)])assert.equal(gamesInstallDismissed(invalid,f.now),false);
});

test('missing or failed native prompt offers conditional browser help without installation or navigation',async()=>{
  const f=fixture({path:'/games/',search:'?install=1'}),ui=f.mount(); assert.equal(ui.action.textContent,'Como instalar');
  await ui.action.emit('click'); assert.equal(ui.help.hidden,false); assert.match(ui.help.textContent,/se disponível/); assert.match(ui.help.textContent,/continue jogando/); assert.equal(ui.action.getAttribute('aria-expanded'),'true'); assert.equal(f.doc.activeElement,f.board);
  let calls=0; await f.win.emit('beforeinstallprompt',{prompt:()=>{calls++;throw Error('unavailable');}}); await ui.action.emit('click');
  assert.equal(calls,1); assert.match(ui.help.textContent,/Não foi possível/); assert.equal(ui.action.disabled,false); await ui.action.emit('click'); assert.equal(calls,1,'A consumed prompt is never reused');
  assert.equal(ui.panel.hidden,false); assert.deepEqual([...f.storage],[]);
});

test('appinstalled and standalone suppress invitations; storage failures still allow dismissal',async()=>{
  for(const options of [{standalone:true},{ios:true}])assert.equal(fixture(options).mount(),null);
  const f=fixture({path:'/games/',search:'?install=1'}),ui=f.mount(); await f.win.emit('appinstalled'); assert.equal(ui.panel.hidden,true);
  await f.win.emit('beforeinstallprompt',{prompt:()=>{throw Error('must not open');}}); await ui.action.emit('click'); assert.equal(ui.panel.hidden,true);
  const change=fixture({path:'/games/',search:'?install=1'}),v=change.mount(); change.display.matches=true; await change.display.emit('change'); assert.equal(v.panel.hidden,true);
  const blocked=fixture({blockedStorage:true}),b=blocked.mount(); blocked.advance(20000); await blocked.doc.emit('pointerdown'); assert.equal(b.panel.hidden,false); await b.close.emit('click'); assert.equal(b.panel.hidden,true);
});

test('cross-tab dismissal, hidden tabs and cleanup do not re-show or consume prompts',async()=>{
  const f=fixture({path:'/games/',search:'?install=1'}),ui=f.mount();
  f.doc.hidden=true; await f.doc.emit('visibilitychange'); assert.equal(ui.panel.hidden,true); f.doc.hidden=false; await f.doc.emit('visibilitychange'); assert.equal(ui.panel.hidden,false);
  await f.win.emit('storage',{key:KEY,newValue:String(f.now)}); assert.equal(ui.panel.hidden,true);
  await f.win.emit('pagehide',{persisted:true}); assert.equal(f.doc.body.contains(ui.panel),true);
  await f.win.emit('pagehide',{persisted:false}); assert.equal(f.doc.body.contains(ui.panel),false); assert.equal(f.timers.size,0);
  const event=await f.win.emit('beforeinstallprompt',{prompt:()=>{throw Error('disposed');}}); assert.equal(event.defaultPrevented,false); ui.dispose();
});

test('page wiring and scoped CSS preserve the game area, touch targets and reduced motion',()=>{
  for(const name of ['vitriny-games','vitriny-blocks','vitriny-merge','vitriny-mini-fazenda']){
    const html=readFileSync(new URL(`../public/${name}.html`,import.meta.url),'utf8');
    assert.equal((html.match(/src="\/games\/install\.js\?v=1"/g)||[]).length,1,name+' includes one invitation module');
    assert.equal((html.match(/href="\/games\/install\.css\?v=1"/g)||[]).length,1,name+' includes one stylesheet');
  }
  const css=readFileSync(new URL('../public/games/install.css',import.meta.url),'utf8');
  assert.doesNotMatch(css,/position\s*:\s*(fixed|absolute)/); assert.match(css,/min-height:44px/); assert.match(css,/prefers-reduced-motion:reduce/); assert.match(css,/display-mode:standalone/);
});
