import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {setupGamesAppRoutes,isGamesAppPath,gamesReturn} from '../games-app-routes.js';
import {decorateGamesAppPage} from '../games-app-pages.js';
const publicDir=fileURLToPath(new URL('../public/',import.meta.url));
async function fixture(t){const app=express();setupGamesAppRoutes(app,{publicDir,currentUser:req=>req.get('x-fixture-user')?{account_status:req.get('x-fixture-user')}:null});app.use(express.static(publicDir));const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));return 'http://127.0.0.1:'+server.address().port;}
test('app root redirects once and public hub/puzzles are not account gated',async t=>{
  const base=await fixture(t),first=await fetch(base+'/games',{redirect:'manual'});assert.equal(first.status,302);assert.equal(first.headers.get('location'),'/games/');
  for(const path of ['/games/','/games/blocos','/games/jardim']){const result=await fetch(base+path,{redirect:'manual'});assert.equal(result.status,200);assert.match(result.headers.get('cache-control'),/public/);const page=await result.text();assert.match(page,/data-games-app="true"/);assert.doesNotMatch(page,/src="\/(?:analytics|openai-ads|site-assistant|pwa-install|global-market-banner)\.js/);}
});
test('farm requires active account and is never publicly cacheable',async t=>{
  const base=await fixture(t),guest=await fetch(base+'/games/fazenda',{redirect:'manual'});assert.equal(guest.status,302);assert.equal(guest.headers.get('location'),'/games/entrar?returnTo=%2Fgames%2Ffazenda');assert.match(guest.headers.get('cache-control'),/private,no-store/);
  const blocked=await fetch(base+'/games/fazenda',{headers:{'x-fixture-user':'restricted'}});assert.equal(blocked.status,403);
  const member=await fetch(base+'/games/fazenda',{headers:{'x-fixture-user':'active'}});assert.equal(member.status,200);assert.match(member.headers.get('cache-control'),/no-store/);const page=await member.text();assert.doesNotMatch(page,/data-city-chat|vitriny-city-chat\.js|central-creditos/);
});
test('privacy/deletion and support remain public without exposing private account data',async t=>{
  const base=await fixture(t);for(const page of ['entrar','regras','privacidade','dados','ajuda','cuidados']){const response=await fetch(base+'/games/'+page);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);const html=await response.text();assert.match(html,/VitrineCity Cultiva/);assert.doesNotMatch(html,/src="\/(?:analytics|site-assistant|global-market-banner|pwa-install)\.js/);}
  const privacy=await(await fetch(base+'/games/privacidade')).text();assert.match(privacy,/não são enviados automaticamente à Lia/);assert.match(privacy,/não significa exclusão imediata/);
  const data=await(await fetch(base+'/games/dados')).text();assert.match(data,/data-games-form="deletion"/);assert.match(data,/compartilhada/);
});
test('safe app boundaries and fixed return allowlist prevent redirect escape',()=>{
  for(const path of ['/games','/games/','/games/fazenda','/GAMES/fazenda'])assert.equal(isGamesAppPath(path),true);
  for(const path of ['/games-fake','/my-games','/api/games/farm',null])assert.equal(isGamesAppPath(path),false);
  for(const url of ['//evil.test','https://evil.test','/games/../admin','/games/dados?token=x'])assert.equal(gamesReturn(url),'/games/fazenda');assert.equal(gamesReturn('/games/dados'),'/games/dados');
});
test('Android domain association is public JSON and uses the generated application certificate',async t=>{
  const base=await fixture(t),response=await fetch(base+'/.well-known/assetlinks.json');assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/application\/json/);const entries=await response.json();assert.equal(entries[0].target.package_name,'com.vitrinecity.cultiva');assert.match(entries[0].target.sha256_cert_fingerprints[0],/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/);
});
test('decorator strips build-injected trackers from original game templates',()=>{
  const template=readFileSync(new URL('../public/vitriny-games.html',import.meta.url),'utf8').replace('</body>','<script src="/analytics.js?v=build"></script><script src="/openai-ads.js"></script><script src="/openai-product-events.js"></script><script src="/global-market-banner.js?v=9"></script></body>');
  const page=decorateGamesAppPage(template,{path:'/games/'});assert.doesNotMatch(page,/src="\/(?:analytics|openai-ads|openai-product-events|global-market-banner)\.js/);
  const prepare=readFileSync(new URL('../prepare-public-highlights.js',import.meta.url),'utf8');assert.match(prepare,/pathname.startsWith\('\/games\/'\)\)continue/);
});
test('server skips shared public injectors for app and sends no signup conversion for games registration',()=>{
  const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');assert.match(server,/isGamesAppPath\(req.path\).*return send\(body\)/);assert.match(server,/if\(!gamesAccount\)\{\s*recordAcquisitionSignup[\s\S]*?conversionHeader/);
  const farm=readFileSync(new URL('../public/vitriny-mini-fazenda.js',import.meta.url),'utf8');assert.match(farm,/dataset.gamesApp==="true"\?"\/games\/entrar"/);
});
