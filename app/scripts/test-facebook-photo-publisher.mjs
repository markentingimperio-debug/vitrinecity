import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import express from 'express';
import Database from 'better-sqlite3';
import {registerFacebookPhotoPublisher,createApprovedFacebookPosterReader} from '../facebook-photo-publisher.js';

const origin='https://vitrinecity.com',API='/api/admin/facebook-photo-publications',hash=value=>createHash('sha256').update(value).digest('hex');
const image='/story-assets/'+'a'.repeat(32)+'.jpg',bytes=Buffer.from([255,216,255,217]);
async function fixture(t){
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE social_accounts(id INTEGER PRIMARY KEY,user_id INTEGER,page_id TEXT,page_name TEXT,token_encrypted TEXT,status TEXT,updated_at TEXT);
    INSERT INTO social_accounts VALUES(1,1,'100','Página da VitrineCity','TOKEN_SECRET','connected','2026-09-09');
    CREATE TABLE social_posts(id TEXT PRIMARY KEY,caption TEXT,image_url TEXT,status TEXT,moderation_status TEXT,media_type TEXT);
    CREATE TABLE ecosystem_distribution_outbox(publication_id TEXT,source_key TEXT,source_hash TEXT,story_id TEXT,status TEXT,channel TEXT,updated_at TEXT);
    CREATE TABLE editorial_web_stories(id TEXT PRIMARY KEY,slug TEXT,published_json TEXT,published_source_hash TEXT);
    CREATE TABLE editorial_articles(id TEXT PRIMARY KEY,status TEXT);`);
  const source={title:'Bolo de cenoura',summary:'Aprenda o preparo completo.',body:'Ingredientes e modo de preparo completos.',image_url:image,updated_at:'2026-09-09',commercial:false};
  const sourceHash=hash(JSON.stringify([source.title,source.summary,source.body,source.image_url,source.updated_at]));
  db.prepare('INSERT INTO social_posts VALUES(?,?,?,?,?,?)').run('social-1','Uma receita de bolo com preparo explicado.',image,'ready','approved','image');
  db.prepare('INSERT INTO ecosystem_distribution_outbox VALUES(?,?,?,?,?,?,?)').run('social-1','recipe',sourceHash,'story-1','published','vitriny_social','2026-09-09');
  db.prepare('INSERT INTO editorial_web_stories VALUES(?,?,?,?)').run('story-1','bolo-de-cenoura',JSON.stringify({title:source.title,poster:image}),sourceHash);
  const state={source,time:Date.parse('2026-09-09T15:00:00Z'),paused:false,ready:true,sends:[],confirms:[],reads:0};
  const adapter={inspect:async()=>{if(state.inspectHook)return state.inspectHook();return {ready:state.ready,missing:state.ready?[]:['pages_manage_posts'],credentialVersion:'test-version'};},
    send:async input=>{if(!input.isCurrent())throw Object.assign(Error('paused'),{code:'publication_cancelled_before_send',notSubmitted:true});state.sends.push(input);if(state.sendHook)return state.sendHook(input);return {photoId:'700',postId:'100_701'};},
    confirm:async input=>{state.confirms.push(input);if(state.confirmHook)return state.confirmHook(input);return {published:true,url:'https://www.facebook.com/100/posts/701'};}};
  const app=express();app.use(express.json());
  const register=target=>registerFacebookPhotoPublisher({app:target,db,siteUrl:origin,sourceCatalog:{get:()=>state.source},metaAdapter:adapter,
    readPoster:async()=>{state.reads++;return {bytes,sha256:state.imageHash||hash(bytes)};},accountAllowed:row=>row.user_id===1,canRun:()=>!state.paused,now:()=>state.time,
    requireAdmin:(req,res,next)=>{if(req.headers['x-admin']!=='yes')return res.sendStatus(401);req.user={id:1};next();},sameOriginOnly:(req,res,next)=>req.headers.origin===origin?next():res.sendStatus(403)});
  register(app);const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const request=async(path='',method='GET',body,headers={})=>{const response=await fetch('http://127.0.0.1:'+server.address().port+API+path,{method,headers:{'x-admin':'yes',origin,'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});const text=await response.text();return {status:response.status,body:response.headers.get('content-type')?.includes('application/json')?JSON.parse(text):text};};
  const preview=(extra={})=>request('/preview','POST',{socialPostId:'social-1',accountId:1,idempotencyKey:randomUUID(),...extra});
  const publish=job=>request('/'+job.id+'/publish','POST',{previewHash:job.previewHash});
  return {db,state,request,preview,publish,register};
}

test('admin/origin enforced and catalog exposes no credentials or third-party customer accounts',async t=>{
  const f=await fixture(t);assert.equal((await f.request('/catalog','GET',undefined,{'x-admin':'no'})).status,401);
  assert.equal((await f.request('/preview','POST',{}, {origin:'https://evil.test'})).status,403);
  f.db.prepare('INSERT INTO social_accounts VALUES(?,?,?,?,?,?,?)').run(2,2,'200','Customer Page','CUSTOMER_SECRET','connected','2026-09-10');
  const response=await f.request('/catalog');assert.equal(response.body.items.length,1);assert.equal(response.body.accounts.length,1);assert(!JSON.stringify(response.body).includes('SECRET'));
  assert.equal((await f.preview({accountId:2})).status,403);
});
test('persistent preview binds approval hash, image and Page; duplicate preview stays single',async t=>{
  const f=await fixture(t),key=randomUUID();const [a,b]=await Promise.all([f.preview({idempotencyKey:key}),f.preview({idempotencyKey:key})]);
  assert.equal(a.status,200);assert.equal(b.body.id,a.body.id);assert.match(a.body.previewHash,/^[a-f0-9]{64}$/);assert.equal(f.state.sends.length,0);
  assert.equal((await f.preview({idempotencyKey:key,caption:'Outra legenda aprovada para receita.'})).status,409);
  assert.equal((await f.request('/'+a.body.id+'/publish','POST',{previewHash:'wrong'})).status,409);
  f.register(express());assert.equal((await f.request('/'+a.body.id)).body.id,a.body.id);
});
test('public captions reject bare shorteners, URLs, HTML and controls before provider work',async t=>{
  const f=await fixture(t);
  for(const caption of ['Veja a receita em wa.me/55123','Acesse agora bit.ly/receita','Confira loja.com.br/oferta','Veja oferta.dev/curso','Veja https://example.com/curso','<b>Receita completa</b>','Receita com\u0000 texto'])assert.equal((await f.preview({caption})).status,400);
  const normal=await f.preview({caption:'Você prefere cobertura cremosa? Conheça esta receita, com 1.5 colher de açúcar.'});assert.equal(normal.status,200);
  assert.equal(f.state.sends.length,0);
});

test('a blocked preview can recheck newly granted permissions without changing its reviewed content',async t=>{
  const f=await fixture(t),idempotencyKey=randomUUID();f.state.ready=false;
  const before=(await f.preview({idempotencyKey})).body;assert.equal(before.readiness.ready,false);
  f.state.ready=true;const after=(await f.preview({idempotencyKey})).body;
  assert.equal(after.id,before.id);assert.equal(after.previewHash,before.previewHash);assert.equal(after.readiness.ready,true);
  assert.equal(f.state.sends.length,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM facebook_photo_publications').get().n,1);
});
test('source withdrawal, changed image and Page identity block publication after preview',async t=>{
  const f=await fixture(t),draft=(await f.preview()).body;
  f.state.source.body+=' Mudou.';assert.equal((await f.publish(draft)).status,409);f.state.source.body='Ingredientes e modo de preparo completos.';
  f.state.imageHash='changed';assert.equal((await f.publish(draft)).status,409);delete f.state.imageHash;
  f.db.prepare("UPDATE social_posts SET moderation_status='pending'").run();assert.equal((await f.publish(draft)).status,409);
  f.db.prepare("UPDATE social_posts SET moderation_status='approved'").run();f.db.prepare("UPDATE social_accounts SET page_id='999'").run();assert.equal((await f.publish(draft)).status,409);
  assert.equal(f.state.sends.length,0);
});
test('two drafts and duplicate Page credentials never produce two attempts for the same source version',async t=>{
  const f=await fixture(t);f.db.prepare('INSERT INTO social_accounts VALUES(?,?,?,?,?,?,?)').run(2,1,'100','Another credential','SECOND_SECRET','connected','2026-09-10');
  const key=randomUUID();await f.preview({idempotencyKey:key});assert.equal((await f.preview({idempotencyKey:key,accountId:2})).status,409);
  const a=(await f.preview()).body,b=(await f.preview({accountId:2})).body;
  const results=await Promise.all([f.publish(a),f.publish(a),f.publish(b)]);
  assert.equal(f.state.sends.length,1);assert(results.some(result=>result.body.status==='published'));
  assert.equal((await f.publish(a)).body.status,'published');assert.equal(f.state.sends.length,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM facebook_photo_bindings').get().n,1);
});
test('definitive rejection is recorded without repeating a submitted request; a new reviewed draft can try after correction',async t=>{
  const f=await fixture(t),draft=(await f.preview()).body;
  f.state.sendHook=()=>{throw Object.assign(Error('Provider secret must not escape'),{code:'meta_permission_denied',definitive:true});};
  assert.equal((await f.publish(draft)).body.status,'failed');assert.equal((await f.publish(draft)).body.status,'failed');assert.equal(f.state.sends.length,1);
  f.state.sendHook=null;const corrected=(await f.preview()).body;assert.equal((await f.publish(corrected)).body.status,'published');assert.equal(f.state.sends.length,2);
});
test('pause or withdrawal during asynchronous readiness never reaches POST',async t=>{
  const f=await fixture(t),draft=(await f.preview()).body;
  f.state.paused=true;assert.equal((await f.publish(draft)).status,409);f.state.paused=false;
  f.state.inspectHook=async()=>{f.state.paused=true;return {ready:true};};assert.equal((await f.publish(draft)).status,409);
  assert.equal(f.state.sends.length,0);
});
test('missing grants block and a confirmed send persists provider receipt only after exact confirmation',async t=>{
  const f=await fixture(t),draft=(await f.preview()).body;
  f.state.ready=false;assert.equal((await f.publish(draft)).status,409);assert.equal(f.state.sends.length,0);
  f.state.ready=true;const sent=await f.publish(draft);assert.equal(sent.body.status,'published');assert.equal(sent.body.photoId,'700');assert.equal(sent.body.postId,'100_701');assert.equal(f.state.confirms.length,1);
  assert(!JSON.stringify(sent.body).includes('SECRET'));
});
test('ambiguous submission is unknown and never retries; confirmation failure reconciles via GET only',async t=>{
  const f=await fixture(t),draft=(await f.preview()).body;
  f.state.sendHook=()=>{throw Object.assign(Error('TOKEN_SECRET'),{uncertain:true});};assert.equal((await f.publish(draft)).body.status,'unknown');
  assert.equal((await f.publish(draft)).body.status,'unknown');assert.equal(f.state.sends.length,1);assert.equal((await f.request('/'+draft.id+'/reconcile','POST',{})).status,409);
  const g=await fixture(t),second=(await g.preview()).body;
  g.state.confirmHook=()=>{throw Error('TOKEN_SECRET');};const result=await g.publish(second);assert.equal(result.body.status,'unknown');assert.equal(result.body.photoId,'700');assert(!JSON.stringify(result.body).includes('SECRET'));
  g.state.confirmHook=null;assert.equal((await g.request('/'+second.id+'/reconcile','POST',{})).body.status,'published');assert.equal(g.state.sends.length,1);assert.equal(g.state.confirms.length,2);
});
test('stale process is marked unknown and its binding survives restart',async t=>{
  const f=await fixture(t),draft=(await f.preview()).body;
  f.db.prepare("UPDATE facebook_photo_publications SET status='submitting',claim='crashed',attempted_at=? WHERE id=?").run(f.state.time-121000,draft.id);
  f.db.prepare("INSERT INTO facebook_photo_bindings SELECT page_id,source_key,source_hash,id FROM facebook_photo_publications WHERE id=?").run(draft.id);
  f.register(express());assert.equal((await f.request('/'+draft.id)).body.status,'unknown');assert.equal((await f.request()).body.items[0].status,'unknown');
  assert.equal(f.db.prepare('SELECT status FROM facebook_photo_publications WHERE id=?').get(draft.id).status,'submitting');
  assert.equal((await f.publish(draft)).body.status,'unknown');assert.equal(f.state.sends.length,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM facebook_photo_bindings').get().n,1);
});
test('local poster reader rejects remote/encoded/traversal paths without fetching anything',async()=>{
  const reader=createApprovedFacebookPosterReader({dataDir:'/nonexistent-readonly-fixture'});
  for(const image of ['https://evil.test/photo.jpg','//169.254.169.254/a','/story-assets/../secret.jpg','/story-assets/%2e%2e/secret.jpg','/uploads/private.jpg','/story-assets/'+'a'.repeat(32)+'.jpg?secret'])await assert.rejects(reader(image));
});

test('after a confirmation crash the read-only panel can reconcile stored IDs without a second send',async t=>{
  const f=await fixture(t),draft=(await f.preview()).body;
  f.db.prepare("UPDATE facebook_photo_publications SET status='confirming',photo_id='700',post_id='100_701',claim='crashed',attempted_at=? WHERE id=?").run(f.state.time-121000,draft.id);
  f.db.prepare('INSERT INTO facebook_photo_bindings SELECT page_id,source_key,source_hash,id FROM facebook_photo_publications WHERE id=?').run(draft.id);
  const visible=(await f.request('/'+draft.id)).body;assert.equal(visible.status,'unknown');assert.equal(visible.photoId,'700');assert.equal(visible.postId,'100_701');
  assert.equal(f.db.prepare('SELECT status FROM facebook_photo_publications WHERE id=?').get(draft.id).status,'confirming');
  const result=await f.request('/'+draft.id+'/reconcile','POST',{});assert.equal(result.body.status,'published');assert.equal(f.state.sends.length,0);assert.equal(f.state.confirms.length,1);
});
