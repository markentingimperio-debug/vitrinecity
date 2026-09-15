import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { createMediaPublicationLifecycle } from '../media-publication-lifecycle.js';
import { createPrayerVitrineSocial } from '../prayer-vitrine-social.js';

const DAY = '2026-09-12', UID = 'a'.repeat(32), ACCOUNT = 'b'.repeat(32), hash = v => createHash('sha256').update(v).digest('hex');
function fixture(t, mediaOptions={}) {
  const db = new Database(':memory:'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prayer-social-'));
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,account_status TEXT); INSERT INTO users VALUES(4,'active');
    CREATE TABLE social_profiles(user_id INTEGER PRIMARY KEY,handle TEXT); INSERT INTO social_profiles VALUES(4,'agrotecnica');
    CREATE TABLE admin_specialist_agents(id INTEGER PRIMARY KEY,code TEXT,status TEXT); INSERT INTO admin_specialist_agents VALUES(7,'midia','active');
    CREATE TABLE admin_agent_tasks(id INTEGER PRIMARY KEY,agent_id INTEGER REFERENCES admin_specialist_agents(id),created_by_user_id INTEGER REFERENCES users(id),title TEXT,instructions TEXT,status TEXT,result_summary TEXT,completed_at TEXT,updated_at TEXT);
    CREATE TABLE admin_media_projects(id INTEGER PRIMARY KEY,task_id INTEGER UNIQUE REFERENCES admin_agent_tasks(id),format TEXT,channels TEXT,source_notes TEXT,production_status TEXT,script TEXT,output_url TEXT,aspect_ratio TEXT,duration_seconds REAL,progress INTEGER,caption TEXT,video_provider TEXT,published_post_id TEXT DEFAULT '',updated_at TEXT);
    CREATE TABLE admin_viral_quizzes(id INTEGER PRIMARY KEY,media_project_id INTEGER,task_id INTEGER,status TEXT,updated_at TEXT);
    CREATE TABLE viral_distribution_jobs(quiz_id INTEGER,provider TEXT,status TEXT,publication_id TEXT,error_message TEXT,updated_at TEXT);
    CREATE TABLE social_posts(id TEXT PRIMARY KEY,user_id INTEGER,video_uid TEXT NOT NULL UNIQUE,media_type TEXT DEFAULT 'video',image_url TEXT,caption TEXT,category TEXT,status TEXT,moderation_status TEXT DEFAULT 'pending',moderation_reason TEXT DEFAULT '',moderated_by INTEGER,moderated_at TEXT,duration_seconds REAL,error_message TEXT DEFAULT '',updated_at TEXT);
    CREATE TABLE social_account_restrictions(user_id INTEGER PRIMARY KEY,status TEXT,restricted_until TEXT);
    CREATE TABLE prayer_sharing_settings(id INTEGER PRIMARY KEY,enabled INTEGER,start_day TEXT,groups_json TEXT);
    INSERT INTO prayer_sharing_settings VALUES(1,1,'2026-09-12','[{"jid":"123@g.us"}]');`);
  const format=mediaOptions.format||'short',folder = path.join(dir, 'prayer-media', DAY, format); fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, 'video.mp4'), readyFile = path.join(folder, 'ready.json'), bytes = Buffer.alloc(512, 1), script = { title: 'Oração de sábado', text: 'Que este dia tenha paz e esperança.' };
  const manifest = { campaign: `oracao-${DAY}`, videoPath: file, publicVideoUrl: `https://vitrinecity.com/prayer-media/${DAY}/${format}.mp4`, title: script.title, caption: 'Oração de sábado. Imagem e voz criadas com inteligência artificial. #Oracao20260912' };
  const ready = { day: DAY, format, durationSeconds:mediaOptions.duration||(format==='short'?30:65), bytes: bytes.length, sha256: hash(bytes), binding: hash(JSON.stringify(script)), script, caption: manifest.caption, videoPath: file, publicVideoUrl: manifest.publicVideoUrl };
  fs.writeFileSync(file, bytes); fs.writeFileSync(readyFile, JSON.stringify(ready));
  const state = { calls: [], ready: [], allowed: true, paused: false, configured: true, moderation: '', time: new Date('2026-09-12T10:03:00Z'), handler: async () => ({ uid: UID, status: { state: 'inprogress' } }) };
  const lifecycle = createMediaPublicationLifecycle({ db, siteUrl: 'https://vitrinecity.com', canRun: () => !state.paused, now: () => state.time.getTime(), getConfig: () => ({ accountId: ACCOUNT, token: 'synthetic-token' }), onReady: p => state.ready.push(p.id), fetchImpl: async (url, options) => { state.calls.push({ url, method: options.method, body: options.body }); return { ok: true, status: 200, json: async () => ({ success: true, result: await state.handler(url, options) }) }; } });
  const options = { db, dataDir: dir, mediaPublications: lifecycle, isPublisherAllowed: id => id === 4 && state.allowed, moderationReason: () => state.moderation, canRun: () => !state.paused, now: () => state.time, isConfigured: () => state.configured };
  const adapter = createPrayerVitrineSocial(options), args = { day: DAY, manifest, mode: 'step', canPublish: () => state.allowed };
  return { db, dir, file, readyFile, ready, manifest, state, lifecycle, options, adapter, args, publish: overrides => adapter.publish({ ...args, ...overrides }), row: () => db.prepare('SELECT * FROM prayer_vitrine_social_runs').get(), post: () => db.prepare('SELECT * FROM social_posts').get(), posts: () => state.calls.filter(c => c.method === 'POST') };
}

test('real lifecycle imports one authorized dated project, waits for Stream then exposes verified public post', async t => {
  const f = fixture(t); const first = await f.publish(); assert.equal(first.state, 'processing'); assert.equal(first.permalink, null); assert.equal(f.posts().length, 1);
  const project = f.db.prepare('SELECT * FROM admin_media_projects').get(), task = f.db.prepare('SELECT * FROM admin_agent_tasks').get();
  assert.equal(project.production_status, 'approved'); assert.equal(project.video_provider, 'prayer_ready_import'); assert.equal(task.status, 'completed'); assert.equal(task.created_by_user_id, 4);
  assert.equal(JSON.parse(project.source_notes).sha256, f.ready.sha256); assert.equal(f.post().moderation_status, 'approved'); assert.equal(f.post().user_id, 4); assert.equal(f.post().status, 'processing');
  assert.equal(JSON.parse(f.state.calls[0].body).url, f.manifest.publicVideoUrl);
  f.state.handler = async () => ({ uid: UID, readyToStream: true, duration: 30 });
  const done = await f.publish({ mode: 'status', canPublish: () => false }); assert.equal(done.state, 'published_verified'); assert.equal(done.permalink, `/social/post/${f.post().id}`); assert.equal(f.state.ready.length, 1);
  await f.publish(); assert.equal(f.posts().length, 1); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM admin_media_projects').get().n, 1); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM social_posts').get().n, 1);
});

test('only the dated prayer wrapper accepts its bounded master and reuses one Stream upload',async t=>{
 for(const duration of [61,65]){const f=fixture(t,{format:'tiktok',duration});assert.equal(f.adapter.sourceFormat(DAY),null);assert.equal((await f.publish()).state,'processing');assert.equal(f.adapter.sourceFormat(DAY),'tiktok');const project=f.db.prepare('SELECT * FROM admin_media_projects').get();assert.equal(project.duration_seconds,duration);assert.equal(project.output_url,f.manifest.publicVideoUrl);f.state.handler=async()=>({uid:UID,readyToStream:true,duration});assert.equal((await f.publish({mode:'status',canPublish:()=>false})).state,'published_verified');assert.equal(f.posts().length,1);}
 const invalid=fixture(t,{format:'tiktok',duration:90});await assert.rejects(invalid.publish(),/source_changed/);assert.equal(invalid.posts().length,0);
});

test('existing short Vitrine Social source is discovered without a second project or changed binding',async t=>{
 const f=fixture(t);await f.publish();const row=f.row();assert.equal(f.adapter.sourceFormat(DAY),'short');f.db.prepare('DELETE FROM prayer_vitrine_social_runs').run();assert.equal(f.adapter.sourceFormat(DAY),'short');await f.publish();assert.equal(f.row().project_id,row.project_id);assert.equal(f.row().source_binding,row.source_binding);assert.equal(f.posts().length,1);
});

test('default callbacks are inactive and read-only status never creates a project or upload', async t => {
  const f = fixture(t); const inactive = createPrayerVitrineSocial({ db: f.db, dataDir: f.dir, mediaPublications: f.lifecycle });
  assert.equal(inactive.status().connected, false); await inactive.publish(f.args); await f.publish({ mode: 'status' });
  assert.equal(f.posts().length, 0); assert.equal(f.row(), undefined); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM admin_media_projects').get().n, 0);
});

test('global pause, disabled prayer, no selected group and outside window cannot start a publication', async t => {
  const f = fixture(t);
  for (const change of [() => f.state.paused = true, () => { f.state.paused = false; f.db.exec('UPDATE prayer_sharing_settings SET enabled=0'); }, () => f.db.exec("UPDATE prayer_sharing_settings SET enabled=1,groups_json='[]'"), () => { f.db.exec(`UPDATE prayer_sharing_settings SET groups_json='[{"jid":"123@g.us"}]'`); f.state.time = new Date('2026-09-12T10:45:00Z'); }, () => f.state.time = new Date('2026-09-13T10:01:00Z')]) {
    change(); assert.equal((await f.publish()).state, 'paused');
  }
  assert.equal(f.posts().length, 0); assert.equal(f.row(), undefined);
});

test('permission and profile are exact, suspended publisher and flagged caption never get approved by wrapper', async t => {
  const f = fixture(t); f.db.exec("UPDATE social_profiles SET handle='another'"); assert.equal((await f.publish()).state, 'paused');
  f.db.exec("UPDATE social_profiles SET handle='agrotecnica'; UPDATE users SET account_status='suspended'"); assert.equal((await f.publish()).state, 'paused');
  f.db.exec("UPDATE users SET account_status='active'"); f.state.moderation = 'flagged'; await assert.rejects(f.publish(), { code: 'prayer_social_moderation_required' });
  f.state.moderation = ''; f.db.exec("INSERT INTO social_account_restrictions VALUES(4,'suspended',NULL)"); await assert.rejects(f.publish()); assert.equal(f.posts().length, 0); assert.equal(f.post(), undefined);
});

test('hash, source date, script and public URL are immutable before publication', async t => {
  const f = fixture(t);
  await assert.rejects(f.publish({ manifest: { ...f.manifest, publicVideoUrl: 'https://vitrinecity.com/other.mp4' } }), { code: 'prayer_social_source_invalid' });
  fs.writeFileSync(f.readyFile, JSON.stringify({ ...f.ready, script: { ...f.ready.script, text: 'Changed' } })); await assert.rejects(f.publish(), { code: 'prayer_social_source_changed' });
  fs.writeFileSync(f.readyFile, JSON.stringify(f.ready)); fs.appendFileSync(f.file, 'x'); await assert.rejects(f.publish(), { code: 'prayer_social_source_changed' }); assert.equal(f.posts().length, 0);
});

test('unknown provider receipt survives a new adapter instance and never uploads twice', async t => {
  const f = fixture(t); f.state.handler = async () => { throw Error('synthetic private detail'); }; assert.equal((await f.publish()).state, 'held_unknown');
  const resumed = createPrayerVitrineSocial(f.options); assert.deepEqual(resumed.pendingDays(), [DAY]);
  assert.equal((await resumed.publish(f.args)).state, 'held_unknown'); assert.equal(f.posts().length, 1); assert.doesNotMatch(JSON.stringify(f.row()), /private detail|synthetic-token/);
});

test('cross-instance concurrent calls use one durable lifecycle claim', async t => {
  const f = fixture(t); let release; f.state.handler = () => new Promise(resolve => release = resolve);
  const first = f.publish(), second = await createPrayerVitrineSocial(f.options).publish(f.args); assert.equal(second.state, 'publishing'); assert.equal(f.posts().length, 1);
  release({ uid: UID, status: { state: 'inprogress' } }); await first; assert.equal(f.db.prepare('SELECT COUNT(*) n FROM social_posts').get().n, 1);
});

test('ready readback after deadline never creates a new POST and preserves moderation and global pause', async t => {
  const f = fixture(t); await f.publish(); f.state.time = new Date('2026-09-12T12:00:00Z'); f.state.paused = true;
  f.state.handler = async () => ({ uid: UID, readyToStream: true }); assert.equal((await f.publish({ mode: 'status' })).state, 'paused'); assert.equal(f.post().stream_state, 'ready'); assert.notEqual(f.post().status, 'ready');
  f.state.paused = false; f.db.exec("UPDATE social_posts SET status='pending_review',moderation_status='pending'"); assert.equal((await f.publish({ mode: 'status' })).state, 'needs_review'); assert.equal(f.post().moderation_status, 'pending'); assert.equal(f.posts().length, 1);
});

test('cancelled project or changed file cannot be reconciled into publication', async t => {
  const f = fixture(t); await f.publish(); f.state.handler = async () => ({ uid: UID, readyToStream: true });
  f.db.exec("UPDATE admin_media_projects SET production_status='cancelled'"); await assert.rejects(f.publish({ mode: 'status' }), { code: 'prayer_social_source_changed' }); assert.equal(f.state.calls.length, 1); assert.equal(f.post().status, 'processing');
  f.db.exec("UPDATE admin_media_projects SET production_status='approved'"); fs.appendFileSync(f.file, 'changed'); await assert.rejects(f.publish({ mode: 'status' }), { code: 'prayer_social_source_changed' }); assert.equal(f.state.calls.length, 1);
});

test('a same-day manual post without matching project blocks a duplicate rather than fabricating a receipt', async t => {
  const f = fixture(t); f.db.prepare("INSERT INTO social_posts(id,user_id,video_uid,caption,status,moderation_status) VALUES('manual',4,?,?,'ready','approved')").run('c'.repeat(32), f.manifest.caption);
  await assert.rejects(f.publish(), { code: 'prayer_social_existing_publication_needs_review' }); assert.equal(f.posts().length, 0); assert.equal(f.row(), undefined);
});

test('exact approved owned project is reused without modifying unrelated quizzes or tasks', async t => {
  const f = fixture(t); f.db.prepare("INSERT INTO admin_agent_tasks(id,agent_id,created_by_user_id,title,instructions,status) VALUES(8,7,4,?,'Manually reviewed','completed')").run(f.manifest.title);
  f.db.prepare("INSERT INTO admin_media_projects(id,task_id,format,production_status,output_url,caption) VALUES(9,8,'short_video','approved',?,?)").run(f.manifest.publicVideoUrl, f.manifest.caption);
  f.db.exec("INSERT INTO admin_viral_quizzes VALUES(20,99,99,'cancelled',NULL); INSERT INTO viral_distribution_jobs VALUES(20,'youtube','awaiting_connection',NULL,NULL,NULL)");
  const before = f.db.prepare('SELECT * FROM admin_viral_quizzes').all(); await f.publish(); assert.equal(f.row().project_id, 9); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM admin_media_projects').get().n, 1); assert.deepEqual(f.db.prepare('SELECT * FROM admin_viral_quizzes').all(), before);
  assert.equal(f.db.prepare('SELECT instructions FROM admin_agent_tasks WHERE id=8').get().instructions, 'Manually reviewed'); assert.equal(f.db.prepare('SELECT status FROM viral_distribution_jobs').get().status, 'awaiting_connection');
});

test('last synchronous canPublish check aborts without any provider request', async t => {
  const f = fixture(t); let checks = 0;
  await assert.rejects(f.publish({ canPublish: () => ++checks < 4 }), { code: 'prayer_social_paused' }); assert.equal(f.posts().length, 0); assert.equal(f.post(), undefined);
});
