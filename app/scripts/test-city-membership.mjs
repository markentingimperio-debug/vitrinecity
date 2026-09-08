import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import {setupCityMembership} from '../city-membership.js';
import {memberPage,memberReturn} from '../public/vitriny-membership-core.js';
const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2)");
const app=express();app.use(express.json());const currentUser=req=>['1','2'].includes(req.headers['x-test-user'])?{id:Number(req.headers['x-test-user']),account_status:'active'}:null;
const requireUser=(req,res,next)=>{req.user=currentUser(req);return req.user?next():res.sendStatus(401);};
const sameOriginOnly=(req,res,next)=>req.headers.origin==='https://evil.test'?res.sendStatus(403):next();
setupCityMembership(app,{db,currentUser,requireUser,sameOriginOnly});app.use((req,res)=>res.send('public or authenticated content'));
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const action=(body,user='1',origin)=>fetch(`${base}/api/games/farm/action`,{method:'POST',headers:{'Content-Type':'application/json','x-test-user':user,...(origin?{origin}:{})},body:JSON.stringify(body)});
try{
  for(const path of ['/vitriny-mini-fazenda.html','/vitriny-mini-fazenda','/%76itriny-games.html','/jogos','/mini-fazenda','/arena-musical','/sala-de-cinema','/meus-creditos']){assert.equal(memberPage(path),true);const r=await fetch(base+path,{redirect:'manual'});assert.equal(r.status,302,path);assert.ok(r.headers.get('location').startsWith('/entrar-cidade.html?returnTo='));}
  for(const path of ['/','/loja','/produto/12/adubo','/vitriny-multiverse-worlds.html','/cidade','/cidade.html','/multiverso','/v/br/go/silvania',...['explore','preview','district','food','creator','entertainment','business'].map(name=>'/vitriny-multiverse-'+name+'.html'),'/vitriny-store-interior.html']){assert.equal(memberPage(path),false);assert.equal((await fetch(base+path,{redirect:'manual'})).status,200,path);}
  assert.equal(memberReturn('/multiverso?city=silvania&return=1#lojas'),'/multiverso?city=silvania&return=1#lojas');
  assert.equal(memberReturn('/v/br/go/silvania?return=1'),'/v/br/go/silvania?return=1');
  for(const path of ['https://evil.test','//evil.test','/\\evil.test','/admin'])assert.equal(memberReturn(path),'/vitriny-multiverse-explore.html?city=vitrine-city');
  assert.equal((await fetch(base+'/api/games/farm')).status,401);
  assert.equal((await action({type:'plant',plot:0,crop:'carrot'},'1','https://evil.test')).status,403);
  let r=await action({type:'plant',plot:0,crop:'carrot',userId:2,state:{coins:999999}});assert.equal(r.status,200);let result=await r.json();assert.equal(result.state.coins,58);
  r=await fetch(base+'/api/games/farm',{headers:{'x-test-user':'2'}});assert.equal((await r.json()).state.coins,60,'Each account owns its own farm');
  assert.equal((await action({type:'harvest',plot:0,now:Date.now()+9999999})).status,409,'The server owns growth time');
  result.state.plots[0].readyAt=Date.now()-1;db.prepare('UPDATE city_farm_progress SET state_json=? WHERE user_id=1').run(JSON.stringify(result.state));
  const concurrent=await Promise.all([action({type:'harvest',plot:0}),action({type:'harvest',plot:0})]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
  r=await fetch(base+'/api/games/farm',{headers:{'x-test-user':'1'}});assert.equal((await r.json()).state.coins,64,'Duplicate harvest requests cannot double the reward');
}finally{await new Promise(resolve=>server.close(resolve));db.close();}
console.log(JSON.stringify({ok:true,membership:'public city and commerce, private activities, safe return, account isolation, server time, atomic progress'}));
