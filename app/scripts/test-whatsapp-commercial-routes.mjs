import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import Database from 'better-sqlite3';
import {isWhatsAppCommercialGroupAllowed,WHATSAPP_COMMERCIAL_EXCLUDED_REASON} from '../whatsapp-commercial-policy.js';

const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
const start=source.indexOf("app.post('/api/admin/whatsapp-qr/schedules',");
const end=source.indexOf("app.get('/api/admin/whatsapp-qr/campaigns',",start);
assert(start>=0&&end>start);

function fixture(t) {
  const db=new Database(':memory:'),routes=new Map(),calls=[];
  t.after(()=>db.close());
  db.exec(`CREATE TABLE whatsapp_qr_schedules(id TEXT PRIMARY KEY,group_jid TEXT,group_name TEXT,sitemap_url TEXT,message TEXT,scheduled_at TEXT,campaign_id TEXT);
    CREATE TABLE whatsapp_qr_campaigns(id TEXT,name TEXT,days INTEGER,interval_hours INTEGER,start_hour INTEGER,end_hour INTEGER,groups_count INTEGER,schedules_count INTEGER,status TEXT DEFAULT 'active',created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
  const links=['/para-empresas.html','/loja','/solucoes.html','/como-funciona.html','/cidade','/social'].map(path=>'https://vitrinecity.com'+path);
  const context=vm.createContext({app:{post:(route,...handlers)=>routes.set(route,handlers.at(-1))},db,requireAdmin(){},sameOriginOnly(){},URL,Date,randomUUID,
    isWhatsAppCommercialGroupAllowed:jid=>isWhatsAppCommercialGroupAllowed(jid,{WHATSAPP_COMMERCIAL_EXCLUDED_GROUP_JIDS:'111@g.us'}),WHATSAPP_COMMERCIAL_EXCLUDED_REASON,
    whatsappQrSitemapLinks:async()=>{calls.push('sitemap');return links;},
    whatsappQrData:value=>value.data,
    whatsappQrRequest:async(path,options)=>{assert.equal(options,undefined);assert.equal(path,'/chat/history?chat_jid=index');calls.push('history');return {data:{history:[{chat_jid:'111@g.us'},{chat_jid:'222@g.us'},{chat_jid:'222@g.us'},{chat_jid:'123@s.whatsapp.net'}]}};}});
  vm.runInContext(source.slice(start,end),context);
  return {db,calls,async request(route,body={}){const res={statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};await routes.get('/api/admin/whatsapp-qr/'+route)({body},res);return res;}};
}

test('actual schedule route rejects the reserved group before lookup or writing and preserves allowed recipients',async t=>{
  const f=fixture(t),body={groupJid:'111@g.us',groupName:'Grupo reservado',sitemapUrl:'https://vitrinecity.com/loja',message:'Mensagem de teste',scheduledAt:new Date(Date.now()+600000).toISOString()};
  const rejected=await f.request('schedules',body);assert.equal(rejected.statusCode,409);assert.equal(f.calls.length,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM whatsapp_qr_schedules').get().n,0);
  const allowed=await f.request('schedules',{...body,groupJid:'222@g.us'});assert.equal(allowed.statusCode,201);
  assert.deepEqual(f.db.prepare('SELECT group_jid FROM whatsapp_qr_schedules').all(),[{group_jid:'222@g.us'}]);
});

test('actual sitemap campaign selects only permitted group IDs and never contacts a send endpoint',async t=>{
  const f=fixture(t),result=await f.request('campaigns/sitemap');
  assert.equal(result.statusCode,201);assert.equal(result.body.groups,1);assert.ok(result.body.schedules>0);
  assert.deepEqual(f.db.prepare('SELECT DISTINCT group_jid FROM whatsapp_qr_schedules').all(),[{group_jid:'222@g.us'}]);
  assert.deepEqual(f.calls,['sitemap','history']);
});
