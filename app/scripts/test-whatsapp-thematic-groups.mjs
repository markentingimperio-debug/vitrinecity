import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import {WHATSAPP_THEMATIC_GROUPS as groups,whatsappCampaignDirectory} from '../whatsapp-group-directory.js';
import {isWhatsAppCommercialGroupAllowed} from '../whatsapp-commercial-policy.js';
import {setupWhatsAppThematicGroups,thematicScheduleId} from '../whatsapp-thematic-groups.js';
import {createWhatsAppScheduleProcessor} from '../whatsapp-schedule-worker.js';

const origin='https://vitrinecity.com',excluded='120363314271911782@g.us',own='555000000000:4@s.whatsapp.net';
const ids=groups.map(group=>group.jid);
function fixture(t){
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE whatsapp_qr_schedules(id TEXT PRIMARY KEY,group_jid TEXT,group_name TEXT,sitemap_url TEXT,message TEXT,scheduled_at TEXT,status TEXT DEFAULT 'pending',provider_message_id TEXT,error TEXT,sent_at TEXT,campaign_id TEXT,confirmation_state TEXT DEFAULT '',claimed_at INTEGER);
    CREATE TABLE editorial_articles(slug TEXT PRIMARY KEY,title TEXT,portal TEXT,status TEXT,published_at TEXT);
    INSERT INTO editorial_articles VALUES('salada-caseira','Salada caseira','receitas','published','2026-09-10'),('bolo-de-cenoura','Bolo de cenoura','receitas','published','2026-09-09'),('horta-em-casa','Horta em casa','plantas-e-jardinagem','published','2026-09-10'),('receita-rascunho','Rascunho','receitas','draft','2026-09-11'),('motos','Motos','esportes','published','2026-09-11');`);
  const state={time:Date.parse('2026-09-11T16:00:00Z'),paused:false,reads:[],sends:[],receipt:true,
    canonical:groups.map(group=>({JID:group.jid,Name:group.name,IsAnnounce:true,Participants:[{JID:own.replace(':4',''),IsAdmin:true}]})),
    links:['/','/loja','/centro-educacional.html','/artigo/salada-caseira','/artigo/bolo-de-cenoura','/artigo/horta-em-casa','/artigo/receita-rascunho','/artigo/motos'].map(p=>origin+p)};
  const app=express();app.use(express.json());
  const options={app,db,siteUrl:origin,now:()=>state.time,canRun:()=>!state.paused,whatsappQrData:value=>value.data,
    getSitemapLinks:async()=>{await state.onLinks?.();return state.links;},
    whatsappQrRequest:async(path,request)=>{
      if(request){assert.equal(path,'/chat/send/text');state.sends.push(JSON.parse(request.body));if(state.throwSend)throw Error('timeout');return {data:state.receipt?{Id:'ACK'+state.sends.length}:{}};}
      state.reads.push(path);await state.onRead?.(path);
      if(path==='/session/status')return {data:{connected:true,loggedIn:true,jid:own}};
      if(path==='/group/list')return {data:{Groups:state.canonical}};
      assert.fail('Unexpected endpoint '+path);
    },requireAdmin:(req,res,next)=>req.headers['x-admin']==='yes'?next():res.sendStatus(401),sameOriginOnly:(req,res,next)=>req.headers.origin===origin?next():res.sendStatus(403)};
  const service=setupWhatsAppThematicGroups(options),rows=()=>db.prepare('SELECT * FROM whatsapp_qr_schedules ORDER BY scheduled_at').all();
  const worker=createWhatsAppScheduleProcessor({...options,now:()=>new Date(state.time),prepareScheduledMessage:service.prepareScheduledMessage});
  t.after(()=>db.close());
  return {db,state,app,options,service,rows,worker,enable:()=>service.configure({enabled:true,groupJids:ids})};
}

test('canonical directory adds only the four authorized groups and excludes 06 even if admin and in history',()=>{
  const state={jid:own},canonical=[...groups,{jid:excluded,name:'Receitas 06'},{jid:'999@g.us',name:'Other'}].map(group=>({JID:group.jid,Name:group.name,IsAnnounce:true,Participants:[{JID:own.replace(':4',''),IsAdmin:true}]}));
  const args={history:{history:[{chat_jid:excluded},{chat_jid:'888@g.us'}]},groupData:{Groups:canonical},state,isGroupAllowed:jid=>isWhatsAppCommercialGroupAllowed(jid,{})};
  assert.deepEqual(whatsappCampaignDirectory(args).map(x=>x.jid).sort(),[...ids,'888@g.us'].sort());
  canonical[0].Participants[0].IsAdmin=false;
  args.history.history.push({chat_jid:ids[0]});
  assert(!whatsappCampaignDirectory(args).some(x=>x.jid===ids[0]));
  assert.deepEqual(whatsappCampaignDirectory({...args,groupData:null}),[{jid:'888@g.us',name:'888'}]);
  assert.equal(isWhatsAppCommercialGroupAllowed(excluded,{}),false);
});

test('starts disabled; preview is read-only, thematic and never includes the excluded group',async t=>{
  const f=fixture(t);assert.equal(f.service.status().enabled,false);assert.deepEqual(await f.service.scheduleDue(),{scheduled:0});
  const preview=await f.service.preview();assert.equal(preview.length,4);assert.equal(f.rows().length,0);assert.equal(f.state.sends.length,0);
  assert(preview.filter(x=>x.topic==='recipes').every(x=>x.sourceUrl.includes('/artigo/salada-caseira')));
  assert(preview.find(x=>x.topic==='plants').sourceUrl.includes('/artigo/horta-em-casa'));
  assert.equal(preview.find(x=>x.topic==='platform').sourceUrl,origin+'/');
  assert(preview.find(x=>x.topic==='platform').message.includes('Este grupo agora reúne'));
  await assert.rejects(f.service.configure({enabled:true,groupJids:[excluded]}),error=>error.status===400);
});

test('one deterministic schedule per day and group survives restart and concurrent ticks without expanding recipients',async t=>{
  const f=fixture(t);await f.enable();
  const second=setupWhatsAppThematicGroups({...f.options,app:null});
  await Promise.all([f.service.scheduleDue(),second.scheduleDue(),f.service.scheduleDue()]);
  const rows=f.rows();assert.equal(rows.length,4);assert.deepEqual(rows.map(x=>x.group_jid),ids);
  assert(rows.every(x=>x.id===thematicScheduleId(x.group_jid,'2026-09-11')&&x.status==='pending'));
  for(let i=1;i<rows.length;i++)assert.equal(Date.parse(rows[i].scheduled_at)-Date.parse(rows[i-1].scheduled_at),5*60000);
  assert.equal(f.state.sends.length,0);assert.equal((await second.scheduleDue()).scheduled,0);
  f.state.time+=86400000;assert.equal((await f.service.scheduleDue()).scheduled,4);assert.equal(f.rows().length,8);
});

test('fresh worker preflight uses real published sources and receipts; subsequent days rotate relevant articles',async t=>{
  const f=fixture(t);await f.enable();await f.service.scheduleDue();f.state.time+=20*60000;await f.worker();await f.worker();
  assert.equal(f.state.sends.length,4);assert(f.rows().every(x=>x.status==='sent'&&x.confirmation_state==='confirmed'));
  assert.deepEqual(f.state.sends.map(x=>x.Phone),ids);assert(f.state.sends.every(x=>x.Id&&x.Body.includes('utm_campaign=thematic-v1')));
  f.state.time=Date.parse('2026-09-12T13:00:00Z');await f.service.scheduleDue();
  const next=f.rows().filter(x=>x.status==='pending');assert.equal(next.length,4);
  assert(next.filter(x=>x.campaign_id.includes('recipes')).every(x=>x.sitemap_url.includes('bolo-de-cenoura')));
  assert(!next.find(x=>x.campaign_id.includes('platform')).message.includes('Este grupo agora reúne'));
});

test('an unknown provider outcome is never retried and blocks new days for that group only',async t=>{
  const f=fixture(t);await f.enable();await f.service.scheduleDue();f.state.time+=3*60000;f.state.receipt=false;
  await f.worker();await f.worker();assert.equal(f.state.sends.length,1);assert.equal(f.rows()[0].confirmation_state,'unknown');
  f.state.time=Date.parse('2026-09-12T13:00:00Z');assert.equal((await f.service.scheduleDue()).scheduled,3);
  assert(f.service.status().groups.find(x=>x.jid===ids[0]).needsReview);
});

test('pause prevents provider reads and catches configuration changes while planning',async t=>{
  const f=fixture(t);await f.enable();const before=f.state.reads.length;f.state.paused=true;
  await f.service.scheduleDue();assert.equal(f.state.reads.length,before);assert.equal(f.rows().length,0);
  f.state.paused=false;f.state.onLinks=async()=>{await f.service.configure({enabled:false,groupJids:[]});};
  assert.equal((await f.service.scheduleDue()).scheduled,0);assert.equal(f.rows().length,0);
});

test('disabled and changed configuration cannot cross the final synchronous dispatch boundary',async t=>{
  const f=fixture(t);await f.enable();await f.service.scheduleDue();f.state.time+=3*60000;
  const first=f.rows()[0];f.db.prepare("UPDATE whatsapp_qr_schedules SET status='processing' WHERE id=?").run(first.id);
  const request=await f.service.prepareScheduledMessage(first);assert.equal(request.beforeSubmit(),true);
  await f.service.configure({enabled:false,groupJids:[]});assert.equal(request.beforeSubmit(),false);
  assert.equal(f.rows()[0].status,'processing');assert(f.rows().slice(1).every(x=>x.status==='cancelled'));
  assert.equal(f.state.sends.length,0);
});

test('permission, group rename, removed article or sitemap URL block submission without provider sends',async t=>{
  for(const kind of ['permission','rename','unpublished','sitemap']){
    const f=fixture(t);await f.enable();await f.service.scheduleDue();f.state.time+=3*60000;
    if(kind==='permission')f.state.canonical[0].Participants[0].IsAdmin=false;
    if(kind==='rename')f.state.canonical[0].Name='Tema alterado';
    if(kind==='unpublished')f.db.prepare("UPDATE editorial_articles SET status='draft' WHERE slug='salada-caseira'").run();
    if(kind==='sitemap')f.state.links=f.state.links.filter(x=>!x.includes('salada-caseira'));
    await f.worker();assert.equal(f.state.sends.length,0,kind);assert.equal(f.rows()[0].confirmation_state,'not_submitted',kind);
    await assert.rejects(f.service.configure({enabled:true,groupJids:[excluded]}));
  }
});

test('final synchronous guard catches a newly unpublished source and elapsed business window',async t=>{
  for(const change of ['unpublished','portal','18h','new-day']){
    const f=fixture(t);await f.enable();await f.service.scheduleDue();f.state.time+=3*60000;
    const item=f.rows()[0];f.db.prepare("UPDATE whatsapp_qr_schedules SET status='processing' WHERE id=?").run(item.id);
    const request=await f.service.prepareScheduledMessage(item);assert.equal(request.beforeSubmit(),true);
    if(change==='unpublished')f.db.prepare("UPDATE editorial_articles SET status='draft' WHERE slug='salada-caseira'").run();
    if(change==='portal')f.db.prepare("UPDATE editorial_articles SET portal='esportes' WHERE slug='salada-caseira'").run();
    if(change==='18h')f.state.time=Date.parse('2026-09-11T21:01:00Z');
    if(change==='new-day')f.state.time+=86400000;
    assert.equal(request.beforeSubmit(),false,change);assert.equal(f.state.sends.length,0);
  }
});

test('the business window does not accumulate missed-day sends or resurrect cancelled work',async t=>{
  const f=fixture(t);await f.enable();
  for(const when of ['2026-09-11T12:59:00Z','2026-09-11T21:00:00Z']){f.state.time=Date.parse(when);assert.equal((await f.service.scheduleDue()).scheduled,0);}
  f.state.time=Date.parse('2026-09-11T13:00:00Z');await f.service.scheduleDue();
  f.state.time=Date.parse('2026-09-12T13:00:00Z');await f.worker();await f.worker();
  assert.equal(f.state.sends.length,0);assert(f.rows().every(x=>x.confirmation_state==='not_submitted'));
  await f.service.configure({enabled:false,groupJids:[]});await f.enable();
  f.state.time=Date.parse('2026-09-11T17:00:00Z');assert.equal((await f.service.scheduleDue()).scheduled,0);
});

test('configuration endpoints require admin and same-origin mutation; preview never posts',async t=>{
  const f=fixture(t),server=f.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const url='http://127.0.0.1:'+server.address().port+'/api/admin/whatsapp-qr/thematic-plan';
  assert.equal((await fetch(url)).status,401);
  assert.equal((await fetch(url,{method:'PUT',headers:{'x-admin':'yes','Content-Type':'application/json'},body:JSON.stringify({enabled:true,groupJids:ids})})).status,403);
  const r=await fetch(url,{method:'PUT',headers:{'x-admin':'yes',origin,'Content-Type':'application/json'},body:JSON.stringify({enabled:true,groupJids:ids})});
  assert.equal(r.status,200);assert.deepEqual((await r.json()).groupJids,ids);
  assert.equal((await fetch(url+'/preview',{headers:{'x-admin':'yes'}})).status,200);
  assert.equal(f.rows().length,0);assert.equal(f.state.sends.length,0);
});
