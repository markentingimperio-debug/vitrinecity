import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {GAMES_APP_PAGES,decorateGamesAppPage} from '../games-app-pages.js';
import {mountGamesApp} from '../public/games/app.js';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
for(const [path,file] of Object.entries(GAMES_APP_PAGES))test(`app decoration preserves the real game and confines navigation: ${path}`,()=>{
  const original=read(`../public/${file}`),page=decorateGamesAppPage(original,{path});
  assert.match(page,/data-games-app="true"/);
  if(path!=='/games/plantas')assert.match(page,/<a\b[^>]*href="\/games\/"[^>]*>← Início<\/a>/);
  for(const id of [...original.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]))assert.ok(page.includes(`id="${id}"`),`preserve #${id}`);
  assert.doesNotMatch(page,/data-city-chat|farm-rewards|central-creditos|vitriny-multiverse-explore|explorerReturnHref|vitriny-city-chat\.(?:js|css)/);
  for(const link of page.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g))assert.ok(link[1].startsWith('/games/')||link[1].startsWith('#'),`outside navigation ${link[1]}`);
  assert.equal((page.match(/rel="manifest"/g)||[]).length,1);
  assert.equal((page.match(/rel="apple-touch-icon"/g)||[]).length,1);
  for(const asset of ['app.js','app.css','install.js','install.css'])assert.equal((page.match(new RegExp(`/games/${asset.replace('.','\\.')}\\?v=1`,'g'))||[]).length,1);
  assert.equal(decorateGamesAppPage(page,{path}),page,'repeated decoration is stable');
  if(path==='/games/fazenda')assert.match(page,/src="\/vitriny-mini-fazenda\.js\?v=/);
  if(['/games/blocos','/games/jardim'].includes(path))assert.match(page,/src="\/vitriny-casual\.js\?v=1/);
});

test('decoration removes other product chrome without touching the original page contract',()=>{
  const original='<html><head><link rel="manifest" href="/manifest.webmanifest"><link rel="stylesheet" href="/site-assistant.css?v=3"></head><body><main id="game"></main><script src="/pwa-install.js?v=2"></script><script src="/global-market-banner.js?v=5"></script><script type="module" src="/site-assistant.js?v=17"></script><script src="/site-assistant-bridge.js"></script><script src="/game-only.js"></script></body></html>';
  assert.equal(decorateGamesAppPage(original,{path:'/vitriny-games.html'}),original);
  for(const path of ['/games/entrar','/games/../comprar','/games/unknown','/games'])assert.equal(decorateGamesAppPage(original,{path}),original);
  const app=decorateGamesAppPage(original,{path:'/games/'});
  assert.doesNotMatch(app,/site-assistant|pwa-install|global-market-banner|href="\/manifest\.webmanifest/);
  assert.match(app,/src="\/game-only\.js"/);
});

test('manifest has an independent games identity and actual packaged icons',()=>{
  const manifest=JSON.parse(read('../public/games/manifest.webmanifest'));
  assert.equal(manifest.name,'VitrineCity Cultiva');assert.equal(manifest.id,'/games/');assert.equal(manifest.start_url,'/games/');assert.equal(manifest.scope,'/games/');
  assert.equal(manifest.display,'standalone');assert.equal(manifest.lang,'pt-BR');
  assert.deepEqual(manifest.shortcuts.map(s=>s.url),['/games/plantas','/games/blocos','/games/jardim','/games/fazenda']);
  for(const icon of manifest.icons){assert.ok(existsSync(new URL(`../public${icon.src}`,import.meta.url)));assert.match(icon.sizes,/^(192|512)x\1$/);}
  assert.ok(manifest.icons.some(icon=>icon.purpose==='maskable'));
  assert.equal(manifest.related_applications,undefined,'no invented Play Store listing');
});

test('Cultiva hub highlights local plant notes and online guidance while keeping original game branding untouched',()=>{
  const original=read('../public/vitriny-games.html'),page=decorateGamesAppPage(original,{path:'/games/'});
  assert.match(original,/<title>VitrineCity Games/);assert.doesNotMatch(original,/data-cultiva-intro/);
  assert.match(page,/<title>VitrineCity Cultiva/);assert.match(page,/href="\/games\/plantas"/);assert.match(page,/href="\/games\/cuidados"/);
  assert.match(page,/anotações e os próximos cuidados neste aparelho/);assert.match(page,/com conexão à internet/);
  assert.ok(page.indexOf('class="cultiva-tools"')<page.indexOf('class="game-grid"'));
  assert.doesNotMatch(page,/VitrineCity Games|VITRINECITY GAMES|\/ GAMES<\/span>/);
});

test('app runtime keeps game return after farm script assignment and only registers its own scope',async()=>{
  const listeners=new Map(),registrations=[];let callback,disconnected=false,href='/city';
  const back={getAttribute:()=>href,setAttribute:(_key,value)=>{href=value;}};
  const doc={readyState:'loading',getElementById:id=>id==='backCity'?back:null};
  const win={location:{pathname:'/games/fazenda'},navigator:{serviceWorker:{register:async(...args)=>{registrations.push(args);}}},MutationObserver:class{constructor(fn){callback=fn;}observe(element,options){assert.equal(element,back);assert.deepEqual(options.attributeFilter,['href']);}disconnect(){disconnected=true;}},addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type,fn)=>{if(listeners.get(type)===fn)listeners.delete(type);}};
  const dispose=mountGamesApp({document:doc,window:win});assert.equal(href,'/games/');assert.equal(registrations.length,0);
  href='/vitriny-multiverse-explore.html';callback();assert.equal(href,'/games/');
  listeners.get('load')();await Promise.resolve();assert.deepEqual(registrations,[['/games/sw.js',{scope:'/games/',updateViaCache:'none'}]]);
  dispose();assert.equal(disconnected,true);assert.equal(listeners.has('load'),false);
  win.location.pathname='/';registrations.length=0;mountGamesApp({document:doc,window:win});assert.equal(registrations.length,0);
});
