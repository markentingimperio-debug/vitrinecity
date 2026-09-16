import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import express from 'express';
import Database from 'better-sqlite3';
import {registerWhatsAppProductCampaigns} from '../whatsapp-product-campaigns.js';
import {isWhatsAppCommercialGroupAllowed} from '../whatsapp-commercial-policy.js';

const API = '/api/admin/whatsapp-qr/product-campaigns';
const origin = 'https://vitrinecity.com';
const jpeg = (width=900,height=1100) => Buffer.from([255,216,255,192,0,11,8,height>>8,height&255,width>>8,width&255,1,1,17,0,255,217]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t,options={}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(),'vc-wa-products-'));
  const dbPath = path.join(dataDir,'test.db');
  let db = new Database(dbPath), time = Date.parse('2026-09-09T12:00:00Z');
  db.exec(`CREATE TABLE affiliate_catalog(slug TEXT PRIMARY KEY,platform TEXT,title TEXT,description TEXT,category TEXT,image TEXT,
    affiliate_url TEXT,status TEXT,availability TEXT,health TEXT,revision INTEGER,updated_at TEXT);
    CREATE TABLE whatsapp_qr_schedules(id TEXT PRIMARY KEY,group_jid TEXT,group_name TEXT,sitemap_url TEXT,message TEXT,scheduled_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending',provider_message_id TEXT,error TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,sent_at TEXT);`);
  const insert = db.prepare('INSERT INTO affiliate_catalog VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  function add(slug,override={}) {
    const row = {slug,platform:'mercadolivre',title:'Produto '+slug,description:'Descrição pública conferida.',category:'Casa',image:'https://http2.mlstatic.com/'+slug+'.webp',
      affiliate_url:'https://meli.la/fixture-'+slug,status:'published',availability:'unknown',health:'unchecked',revision:1,updated_at:'2026-09-09',...override};
    insert.run(...Object.values(row));
    return row;
  }
  add('produto-a'); add('produto-b');
  const state = {connected:true,groups:['111@g.us','222@g.us'],fetches:[],conversions:0,providerCalls:[],bytes:jpeg(),responseStatus:200,
    extraNames:[{JID:'999@g.us',Name:'Não está no histórico'}]};
  const requestProvider = async (pathname,init) => {
    assert.equal(init,undefined,'All provider calls in this module must be read-only.');
    state.providerCalls.push(pathname);
    if(pathname === '/session/status')return {data:{connected:state.connected,loggedIn:state.connected}};
    if(pathname === '/chat/history?chat_jid=index')return {data:{history:[...state.groups.map(jid => ({chat_jid:jid})),{chat_jid:'123@s.whatsapp.net'},{chat_jid:'bogus@evil.test'},...state.groups.slice(0,1).map(jid => ({chat_jid:jid}))]}};
    if(pathname === '/group/list')return {data:{Groups:[...state.groups.map((jid,i) => ({JID:jid,Name:'Grupo '+(i+1)})),...state.extraNames]}};
    throw Error('Unexpected provider endpoint: '+pathname);
  };
  const fetchImpl = async (url,init) => {
    state.fetches.push(url);
    assert.equal(new URL(url).hostname,'http2.mlstatic.com');
    assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');
    assert(!init.headers.Token);assert(!init.headers.Authorization);
    if(options.fetchImpl)return options.fetchImpl(url,init,state);
    return new Response(state.bytes,{status:state.responseStatus,headers:{'content-type':'image/webp'}});
  };
  const convertImage = async ({inputPath,outputPath}) => {
    state.conversions++;
    assert(inputPath.startsWith(path.join(dataDir,'whatsapp-product-images')+path.sep));
    assert.equal((await fs.readFile(inputPath)).length,state.bytes.length);
    if(options.convertImage)return options.convertImage({inputPath,outputPath,state});
    await fs.writeFile(outputPath,jpeg());
  };
  let server, service;
  async function start() {
    const app = express();app.use(express.json());
    service = registerWhatsAppProductCampaigns({app,db,dataDir,siteUrl:origin,now:() => time,fetchImpl,...(options.realConverter ? {} : {convertImage}),
      isGroupAllowed:options.isGroupAllowed,
      whatsappQrRequest:requestProvider,whatsappQrData:value => value.data ?? value,
      requireAdmin:(req,res,next) => req.headers['x-test-admin'] === 'yes' ? next() : res.status(401).end(),
      sameOriginOnly:(req,res,next) => req.headers.origin === origin ? next() : res.status(403).end()});
    server = app.listen(0,'127.0.0.1');await new Promise(resolve => server.once('listening',resolve));
  }
  await start();
  async function stop() { server.closeAllConnections();await new Promise(resolve => server.close(resolve)); }
  async function req(suffix='',body,extra={}) {
    const response = await fetch('http://127.0.0.1:'+server.address().port+API+suffix,{method:body === undefined ? 'GET' : 'POST',
      headers:{'x-test-admin':'yes',origin,'Content-Type':'application/json',...extra},...(body === undefined ? {} : {body:JSON.stringify(body)})});
    const result = response.headers.get('content-type')?.includes('image/jpeg') ? Buffer.from(await response.arrayBuffer()) : await response.json().catch(() => ({}));
    return {status:response.status,body:result,headers:response.headers};
  }
  function input(overrides={}) {
    return {products:[{slug:'produto-a',message:'Conheça os detalhes e compare antes de escolher.'},{slug:'produto-b',message:'Veja as informações deste produto na nossa página.'}],
      groupJids:['111@g.us','222@g.us'],startAtISO:new Date(time+600000).toISOString(),intervalMinutes:120,idempotencyKey:'fixture_campaign_0001',...overrides};
  }
  const f = {get db(){return db;},get service(){return service;},state,req,input,add,dataDir,
    advance(ms){time+=ms;},async restart(){await stop();db.close();db=new Database(dbPath);await start();}};
  t.after(async () => { await stop();db.close();await fs.rm(dataDir,{recursive:true,force:true}); });
  return f;
}

test('catalog requires admin, retains eligible ML products and only current connected groups',async t => {
  const f = await fixture(t);
  for(const [slug,override] of [['paused',{status:'paused'}],['unavailable',{availability:'unavailable'}],['broken',{health:'broken'}],
    ['other-platform',{platform:'shopee'}],['no-photo',{image:''}],['unsafe-photo',{image:'https://http2.mlstatic.com.evil.test/photo.jpg'}],
    ['unsafe-affiliate',{affiliate_url:'javascript:alert(1)'}]])f.add(slug,override);
  assert.equal((await f.req('/catalog',undefined,{'x-test-admin':'no'})).status,401);
  assert.equal(f.state.providerCalls.length,0);
  const result = await f.req('/catalog');
  assert.equal(result.status,200);assert.deepEqual(result.body.items.map(item => item.slug).sort(),['produto-a','produto-b']);
  assert.deepEqual(result.body.groups,[{jid:'111@g.us',name:'Grupo 1'},{jid:'222@g.us',name:'Grupo 2'}]);
  assert(result.body.items.every(item => !('affiliate_url' in item) && item.url.startsWith(origin+'/ofertas/')));
  assert.equal(f.state.fetches.length,0,'Listing never downloads photos.');
  f.state.connected=false;assert.equal((await f.req('/catalog')).status,409);
});

test('reserved groups disappear from commercial choices and cannot create or publish drafts; other groups remain eligible',async t => {
  const env={WHATSAPP_COMMERCIAL_EXCLUDED_GROUP_JIDS:''};
  const f=await fixture(t,{isGroupAllowed:jid=>isWhatsAppCommercialGroupAllowed(jid,env)});
  const draft=await f.req('/preview',f.input());assert.equal(draft.status,201);
  const snapshot=f.db.prepare('SELECT groups_json FROM whatsapp_product_campaigns WHERE id=?').get(draft.body.id);
  env.WHATSAPP_COMMERCIAL_EXCLUDED_GROUP_JIDS='111@g.us';
  const catalog=await f.req('/catalog');assert.deepEqual(catalog.body.groups,[{jid:'222@g.us',name:'Grupo 2'}]);
  const calls=f.state.providerCalls.length,photos=f.state.fetches.length;
  assert.equal((await f.req('/preview',f.input({idempotencyKey:'excluded_preview_0002'}))).status,409);
  assert.equal((await f.req('/'+draft.body.id+'/publish',{})).status,409);
  assert.equal(f.state.providerCalls.length,calls);assert.equal(f.state.fetches.length,photos);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM whatsapp_qr_schedules').get().n,0);
  assert.deepEqual(f.db.prepare('SELECT groups_json FROM whatsapp_product_campaigns WHERE id=?').get(draft.body.id),snapshot);
  const other=await f.req('/preview',f.input({groupJids:['222@g.us'],idempotencyKey:'allowed_preview_0003'}));
  assert.equal(other.status,201);assert.equal((await f.req('/'+other.body.id+'/publish',{})).status,200);
  assert.deepEqual(f.db.prepare('SELECT DISTINCT group_jid FROM whatsapp_qr_schedules').all(),[{group_jid:'222@g.us'}]);
});

test('reservation applied during photo preparation prevents saving a newly excluded preview',async t => {
  const env={WHATSAPP_COMMERCIAL_EXCLUDED_GROUP_JIDS:''};
  const f=await fixture(t,{isGroupAllowed:jid=>isWhatsAppCommercialGroupAllowed(jid,env),convertImage:async({outputPath})=>{await fs.writeFile(outputPath,jpeg());env.WHATSAPP_COMMERCIAL_EXCLUDED_GROUP_JIDS='111@g.us';}});
  assert.equal((await f.req('/preview',f.input())).status,409);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM whatsapp_product_campaigns').get().n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM whatsapp_qr_schedules').get().n,0);
});

test('preview persists exact photos and recipients, but creates no sends; snapshot photo is admin-only',async t => {
  const f = await fixture(t);
  const result = await f.req('/preview',f.input());
  assert.equal(result.status,201);assert.equal(result.body.status,'draft');assert.equal(result.body.total,4);
  assert.deepEqual(result.body.counts,{pending:0,processing:0,sent:0,failed:0,unknown:0,cancelled:0});
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM whatsapp_qr_schedules').get().n,0);
  assert.equal(f.state.fetches.length,2);
  for(const product of result.body.products) {
    assert(product.caption.includes('Publicidade'));assert(product.caption.includes('Link de afiliado'));
    assert(!product.caption.includes('meli.la'));assert(product.caption.includes(product.url));
    const url = new URL(product.url);assert.equal(url.origin,origin);assert.equal(url.pathname,'/ofertas/'+product.slug);
    assert.equal(url.searchParams.get('utm_campaign'),result.body.id);
    const suffix = product.image.slice(API.length);
    assert.equal((await f.req(suffix,undefined,{'x-test-admin':'no'})).status,401);
    const photo = await f.req(suffix);assert.equal(photo.status,200);assert.deepEqual(photo.body,jpeg());
  }
  assert(!JSON.stringify(result.body).includes(f.dataDir));
  assert(!f.state.providerCalls.some(value => value.includes('/send/')));
});

test('same preview key including concurrent requests is idempotent and differing selection conflicts',async t => {
  const f = await fixture(t);
  const input = f.input();
  const [first,second] = await Promise.all([f.req('/preview',input),f.req('/preview',input)]);
  assert.equal(first.body.id,second.body.id);assert.equal(f.state.fetches.length,2);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM whatsapp_product_campaigns').get().n,1);
  assert.equal((await f.req('/preview',{...input,groupJids:['111@g.us']})).status,409);
  f.advance(3600000);
  assert.equal((await f.req('/preview',input)).body.id,first.body.id,'A retry recovers the old preview even after its scheduled time.');
});

test('publication is atomic, idempotent, spaced by product, and preserves only selected snapshot groups',async t => {
  const f = await fixture(t);
  const draft = (await f.req('/preview',f.input())).body;
  f.state.groups.push('333@g.us');
  const [a,b] = await Promise.all([f.req('/'+draft.id+'/publish',{}),f.req('/'+draft.id+'/publish',{})]);
  assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(a.body.counts.pending,4);
  const schedules = f.db.prepare('SELECT * FROM whatsapp_qr_schedules ORDER BY scheduled_at').all();
  assert.equal(schedules.length,4);assert.equal(new Set(schedules.map(item => item.id)).size,4);
  assert(schedules.every(item => item.campaign_id === draft.id && ['111@g.us','222@g.us'].includes(item.group_jid)));
  assert.equal(Date.parse(schedules[1].scheduled_at)-Date.parse(schedules[0].scheduled_at),2000);
  assert.equal(Date.parse(schedules[2].scheduled_at)-Date.parse(schedules[0].scheduled_at),120*60000);
  await f.restart();
  const after = await f.req('/'+draft.id+'/publish',{});assert.equal(after.status,200);assert.equal(after.body.counts.pending,4);
  assert.equal((await f.req('')).body.campaigns[0].id,draft.id);
  assert.equal(f.state.fetches.length,2,'Restart and publication must reuse exact preview photos.');
});

test('removed group, edited product, inactive product and overdue draft block publication without partial schedules',async t => {
  const f = await fixture(t);
  const draft = (await f.req('/preview',f.input())).body;
  f.state.groups=['111@g.us'];assert.equal((await f.req('/'+draft.id+'/publish',{})).status,409);
  f.state.groups=['111@g.us','222@g.us'];
  f.db.prepare("UPDATE affiliate_catalog SET status='paused' WHERE slug='produto-a'").run();
  assert.equal((await f.req('/'+draft.id+'/publish',{})).status,409);
  f.db.prepare("UPDATE affiliate_catalog SET status='published',title='Descrição alterada' WHERE slug='produto-a'").run();
  assert.equal((await f.req('/'+draft.id+'/publish',{})).status,409);
  f.db.prepare("UPDATE affiliate_catalog SET title='Produto produto-a' WHERE slug='produto-a'").run();
  f.advance(3600000);assert.equal((await f.req('/'+draft.id+'/publish',{})).status,409);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM whatsapp_qr_schedules').get().n,0);
});

test('request validation rejects duplicates, limits, unsafe groups, bad URLs and CSRF before image requests',async t => {
  const f = await fixture(t);
  assert.equal((await f.req('/preview',f.input(),{origin:'https://attacker.test'})).status,403);
  const invalid = [
    {groupJids:['111@g.us','111@g.us']},{groupJids:['123@s.whatsapp.net']},{groupJids:[]},
    {groupJids:Array.from({length:51},(_,i) => i+'@g.us')},
    {products:[{slug:'produto-a',message:'x'},{slug:'produto-a',message:'x'}]},
    {products:Array.from({length:6},(_,i) => ({slug:'produto-'+i,message:'x'}))},
    {products:[{slug:'produto-a',message:'x'.repeat(1201)}]},
    {products:[{slug:'produto-a',message:'Clique https://meli.la/test'}]},
    {intervalMinutes:29},{intervalMinutes:1441},{intervalMinutes:'120'},{idempotencyKey:'short'},
    {startAtISO:'invalid'},{startAtISO:'2026-09-08T12:00:00Z'},{startAtISO:'2027-09-09T12:00:00Z'}
  ];
  for(const override of invalid)assert.equal((await f.req('/preview',f.input(override))).status,400,JSON.stringify(override));
  assert.equal((await f.req('/preview',f.input({groupJids:['999@g.us']}))).status,409);
  f.db.prepare("UPDATE affiliate_catalog SET image='http://http2.mlstatic.com/a.jpg' WHERE slug='produto-a'").run();
  assert.equal((await f.req('/preview',f.input())).status,409);
  assert.equal(f.state.fetches.length,0);assert.equal(f.state.conversions,0);
});

test('photo failures hold the entire draft; redirects and oversized rasters never reach converter',async t => {
  const f = await fixture(t);
  const cases = [{status:302,bytes:jpeg()},{status:200,bytes:Buffer.from('<svg>not raster</svg>')},{status:200,bytes:jpeg(9000,9000)},
    {status:200,bytes:Buffer.alloc(8*1024*1024+1,1)}];
  for(const item of cases) {
    f.state.responseStatus=item.status;f.state.bytes=item.bytes;
    const result = await f.req('/preview',f.input());
    assert([400,502].includes(result.status));assert.equal(f.state.conversions,0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM whatsapp_product_campaigns').get().n,0);
  }
  f.state.responseStatus=200;f.state.bytes=jpeg();
  const okay = await f.req('/preview',f.input());assert.equal(okay.status,201,'Same key can be retried after a failed preparation.');
});

test('provider/converter errors are sanitized and never persist ready drafts or schedule rows',async t => {
  const f = await fixture(t,{convertImage:async() => { throw Error('Token=private-fixture-secret /private/files'); }});
  const result = await f.req('/preview',f.input());assert.equal(result.status,502);
  assert(!JSON.stringify(result.body).includes('private-fixture-secret'));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM whatsapp_product_campaigns').get().n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM whatsapp_qr_schedules').get().n,0);
});

test('scheduled image uses stable provider ID, authoritative snapshot and fresh eligibility; no send occurs here',async t => {
  const f = await fixture(t);
  const draft = (await f.req('/preview',f.input())).body;
  await f.req('/'+draft.id+'/publish',{});
  const schedule = f.db.prepare('SELECT * FROM whatsapp_qr_schedules ORDER BY scheduled_at LIMIT 1').get();
  await assert.rejects(f.service.prepareScheduledMessage(schedule),/revisado/);
  f.db.prepare("UPDATE whatsapp_qr_schedules SET status='processing' WHERE id=?").run(schedule.id);
  const message = await f.service.prepareScheduledMessage({...schedule,group_jid:'999@g.us'});
  assert.equal(message.pathname,'/chat/send/image');assert.equal(message.body.Phone,'111@g.us');
  assert.equal(message.body.Id,schedule.id.toUpperCase());assert(message.body.Caption.includes('/ofertas/produto-a?'));
  assert.equal(message.body.Image,'data:image/jpeg;base64,'+jpeg().toString('base64'));
  assert.deepEqual(await f.service.prepareScheduledMessage(schedule),message);
  f.db.prepare("UPDATE affiliate_catalog SET health='broken' WHERE slug=?").run(schedule.product_slug);
  await assert.rejects(f.service.prepareScheduledMessage(schedule),/indisponível|pausado/);
  f.db.prepare("UPDATE affiliate_catalog SET health='unchecked' WHERE slug=?").run(schedule.product_slug);
  f.db.prepare("UPDATE whatsapp_qr_schedules SET status='cancelled' WHERE id=?").run(schedule.id);
  await assert.rejects(f.service.prepareScheduledMessage(schedule),/revisado/);
  assert(!f.state.providerCalls.some(value => value.includes('/send/')));
});

test('changed cached bytes and path substitution cannot be sent or exposed; legacy text still returns null',async t => {
  const f = await fixture(t);
  const draft = (await f.req('/preview',f.input())).body;
  await f.req('/'+draft.id+'/publish',{});
  const schedule = f.db.prepare('SELECT * FROM whatsapp_qr_schedules LIMIT 1').get();
  f.db.prepare("UPDATE whatsapp_qr_schedules SET status='processing' WHERE id=?").run(schedule.id);
  await fs.writeFile(path.join(f.dataDir,'whatsapp-product-images',schedule.image_path),jpeg(800,900));
  await assert.rejects(f.service.prepareScheduledMessage(schedule),/alterada/);
  assert.equal((await f.req(draft.products[0].image.slice(API.length))).status,409);
  f.db.prepare("UPDATE whatsapp_qr_schedules SET image_path='../private.jpg' WHERE id=?").run(schedule.id);
  await assert.rejects(f.service.prepareScheduledMessage(schedule),/revisado/);
  f.db.prepare("INSERT INTO whatsapp_qr_schedules(id,group_jid,message,status) VALUES ('legacy','111@g.us','Texto antigo','processing')").run();
  assert.equal(await f.service.prepareScheduledMessage({id:'legacy'}),null);
});

test('terminal failure status reports review, and repeat publication never recreates or retries failed schedules',async t => {
  const f = await fixture(t);
  const draft = (await f.req('/preview',f.input())).body;
  await f.req('/'+draft.id+'/publish',{});
  f.db.prepare("UPDATE whatsapp_qr_schedules SET status='failed' WHERE campaign_id=?").run(draft.id);
  const result = await f.req('/'+draft.id+'/publish',{});
  assert.equal(result.body.status,'needs_review');assert.equal(result.body.counts.failed,4);
  assert.equal(result.body.counts.pending,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM whatsapp_qr_schedules').get().n,4);
  f.db.prepare("UPDATE whatsapp_qr_schedules SET status='sent' WHERE campaign_id=?").run(draft.id);
  const unverified=await f.req('/'+draft.id);assert.equal(unverified.body.status,'needs_review');assert.equal(unverified.body.counts.unknown,4);assert.equal(unverified.body.counts.sent,0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM whatsapp_qr_schedules WHERE status='sent' AND provider_message_id IS NULL").get().n,4,'Projection preserves old rows');
  f.db.prepare("UPDATE whatsapp_qr_schedules SET provider_message_id='ACK_'||id WHERE campaign_id=?").run(draft.id);
  assert.equal((await f.req('/'+draft.id)).body.status,'completed');
});

test('unknown sends are visible as review and replaying campaign publication cannot requeue them',async t=>{
  const f=await fixture(t),draft=(await f.req('/preview',f.input())).body;
  await f.req('/'+draft.id+'/publish',{});
  f.db.prepare("UPDATE whatsapp_qr_schedules SET status='failed',confirmation_state='unknown',error='Confirmar conversa' WHERE campaign_id=?").run(draft.id);
  const before=f.db.prepare('SELECT * FROM whatsapp_qr_schedules ORDER BY id').all();
  const result=await f.req('/'+draft.id+'/publish',{});
  assert.equal(result.body.status,'needs_review');assert.equal(result.body.counts.unknown,4);assert.equal(result.body.counts.sent,0);assert.equal(result.body.counts.failed,0);
  assert.deepEqual(f.db.prepare('SELECT * FROM whatsapp_qr_schedules ORDER BY id').all(),before);
});

test('cancellation or product pause during image read is rechecked before preparing the send',async t => {
  const f = await fixture(t);
  const draft = (await f.req('/preview',f.input())).body;
  await f.req('/'+draft.id+'/publish',{});
  const schedule = f.db.prepare('SELECT * FROM whatsapp_qr_schedules LIMIT 1').get();
  const originalRead = fs.readFile;
  for(const action of [() => f.db.prepare("UPDATE whatsapp_qr_schedules SET status='cancelled' WHERE id=?").run(schedule.id),
    () => f.db.prepare("UPDATE affiliate_catalog SET status='paused' WHERE slug=?").run(schedule.product_slug)]) {
    f.db.prepare("UPDATE whatsapp_qr_schedules SET status='processing' WHERE id=?").run(schedule.id);
    fs.readFile = async (...args) => {
      const result = await originalRead(...args);
      if(path.basename(String(args[0])) === schedule.image_path)action();
      return result;
    };
    try { await assert.rejects(f.service.prepareScheduledMessage(schedule),/cancelado|pausado|indisponível/); }
    finally { fs.readFile = originalRead; }
  }
});

test('real FFmpeg converts a shipped raster to the exact protected JPEG snapshot without network input',async t => {
  const oldPath = process.env.PATH;
  if(process.platform === 'win32')process.env.PATH = 'C:/Users/Teste/AppData/Local/Programs/DICloak/vendor/ffmpeg/bin'+path.delimiter+(oldPath || '');
  try {
    if(spawnSync('ffmpeg',['-version'],{stdio:'ignore',windowsHide:true}).status !== 0) { t.skip('FFmpeg is not installed on this test host.'); return; }
    const f = await fixture(t,{realConverter:true});
    f.state.bytes = await fs.readFile(new URL('../public/assets/recipes/bolo-cenoura.jpg',import.meta.url));
    const result = await f.req('/preview',f.input({products:[{slug:'produto-a',message:'Confira os detalhes.'}],groupJids:['111@g.us']}));
    assert.equal(result.status,201,JSON.stringify(result.body));
    const photo = await f.req(result.body.products[0].image.slice(API.length));
    assert.equal(photo.status,200);assert.equal(photo.body[0],255);assert.equal(photo.body[1],216);
    assert(photo.body.length <= 8*1024*1024);
    const snapshot = JSON.parse(f.db.prepare('SELECT products_json FROM whatsapp_product_campaigns WHERE id=?').get(result.body.id).products_json)[0];
    assert.equal(snapshot.imagePath,hash(photo.body)+'.jpg');
    assert.equal(f.state.fetches.length,1);assert(!f.state.providerCalls.some(endpoint => endpoint.includes('/send/')));
  } finally { process.env.PATH = oldPath; }
});
