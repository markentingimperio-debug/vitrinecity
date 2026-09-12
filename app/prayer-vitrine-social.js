// The dated prayer wrapper delegates every upload and Stream readback to the existing
// publication lifecycle. It neither creates a provider client nor starts a worker.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validDay } from './prayer-daily.js';
import { validateManifest } from './prayer-meta-adapter.js';
import {prayerManifestFormat,prayerDurationAllowed} from './prayer-distribution-media.js';

const PUBLISHER = 4, HANDLE = 'agrotecnica', MAX_BYTES = 200 * 1024 * 1024;
const hash = value => createHash('sha256').update(value).digest('hex');
const failure = code => Object.assign(new Error(code), { code });
const STATES = Object.freeze({ not_started: 'prepared', submitting: 'publishing', processing: 'processing', pending_review: 'needs_review', published: 'published_verified', unknown: 'held_unknown', error: 'failed', blocked: 'needs_review', paused: 'paused', source_changed: 'needs_review' });

export function createPrayerVitrineSocial({ db, dataDir, mediaPublications, isPublisherAllowed = () => false, moderationReason = () => 'unconfigured', canRun = () => true, now = () => new Date(), isConfigured = () => false }) {
  if (!db || !path.isAbsolute(dataDir || '') || !mediaPublications?.publish || !mediaPublications?.snapshot || !mediaPublications?.reconcile) throw failure('prayer_social_configuration_invalid');
  db.exec(`CREATE TABLE IF NOT EXISTS prayer_vitrine_social_runs (
    day TEXT PRIMARY KEY, project_id INTEGER NOT NULL UNIQUE REFERENCES admin_media_projects(id),
    source_sha256 TEXT NOT NULL, source_binding TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'prepared',
    error TEXT, post_id TEXT, permalink TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`);
  let busy = false;
  const read = day => db.prepare('SELECT * FROM prayer_vitrine_social_runs WHERE day=?').get(day);
  const project = id => db.prepare(`SELECT m.*,t.title,t.created_by_user_id,t.status AS task_status,a.code AS agent_code
    FROM admin_media_projects m JOIN admin_agent_tasks t ON t.id=m.task_id
    JOIN admin_specialist_agents a ON a.id=t.agent_id WHERE m.id=?`).get(id);
  function sourceFormat(day){
    const row=read(day);
    const candidates=row?[project(row.project_id)]:db.prepare(`SELECT m.* FROM admin_media_projects m JOIN admin_agent_tasks t ON t.id=m.task_id
      WHERE t.created_by_user_id=? AND m.output_url IN (?,?)`).all(PUBLISHER,...['short','tiktok'].map(format=>`https://vitrinecity.com/prayer-media/${day}/${format}.mp4`));
    if(!candidates.length)return null;
    if(candidates.length!==1||!candidates[0])throw failure('prayer_social_source_invalid');
    const url=candidates[0].output_url,format=url.endsWith('/tiktok.mp4')?'tiktok':'short';
    try{return prayerManifestFormat({campaign:'oracao-'+day,publicVideoUrl:url,videoPath:path.join(dataDir,'prayer-media',day,format,'video.mp4')},day,dataDir);}catch{throw failure('prayer_social_source_invalid');}
  }
  function publisherAllowed() {
    const user = db.prepare('SELECT id,account_status FROM users WHERE id=?').get(PUBLISHER);
    const profile = db.prepare('SELECT handle FROM social_profiles WHERE user_id=?').get(PUBLISHER);
    return user?.account_status === 'active' && profile?.handle === HANDLE && isPublisherAllowed(PUBLISHER) === true;
  }
  function settingsAllow(day) {
    const row = db.prepare('SELECT enabled,start_day,groups_json FROM prayer_sharing_settings WHERE id=1').get();
    let groups; try { groups = JSON.parse(row?.groups_json); } catch { return false; }
    return row?.enabled === 1 && day >= row.start_day && Array.isArray(groups) && groups.length > 0;
  }
  function withinWindow(day) {
    // Only the current São Paulo edition at 07:00–07:44 may start a new upload.
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now()).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}` === day && parts.hour === '07' && Number(parts.minute) < 45;
  }
  function source(day, raw) {
    if (!validDay(day)) throw failure('prayer_day_invalid');
    const manifest = validateManifest(raw);let format;try{format=prayerManifestFormat(manifest,day,dataDir);}catch{throw failure('prayer_social_source_invalid');}
    const directory = path.join(dataDir, 'prayer-media', day, format), file = path.join(directory, 'video.mp4'), readyPath = path.join(directory, 'ready.json');
    // A ready file cannot redirect us outside this edition through symlinks or JSON paths.
    const realRoot = fs.realpathSync(dataDir);
    if (fs.realpathSync(file) !== path.join(realRoot, 'prayer-media', day, format, 'video.mp4') || fs.realpathSync(readyPath) !== path.join(realRoot, 'prayer-media', day, format, 'ready.json')) throw failure('prayer_social_source_invalid');
    if (fs.statSync(readyPath).size > 1024 * 1024) throw failure('prayer_social_source_invalid');
    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf8')), st = fs.statSync(file);
    if (!st.isFile() || st.size < 32 || st.size > MAX_BYTES || ready.day !== day || ready.format !== format || ready.videoPath !== file || ready.publicVideoUrl !== manifest.publicVideoUrl || ready.caption !== manifest.caption || ready.script?.title !== manifest.title || !prayerDurationAllowed(manifest,ready.durationSeconds,'vitrine_social') || ready.bytes !== st.size || !/^[a-f0-9]{64}$/.test(ready.sha256 || '') || ready.binding !== hash(JSON.stringify(ready.script)) || hash(fs.readFileSync(file)) !== ready.sha256) throw failure('prayer_social_source_changed');
    const binding = hash(JSON.stringify({ day, manifest, sha256: ready.sha256, scriptBinding: ready.binding, publisher: PUBLISHER }));
    return { manifest, ready, binding };
  }
  function ownedProject(row, input) {
    const p = project(row.project_id);
    if (!p || p.created_by_user_id !== PUBLISHER || p.agent_code !== 'midia' || p.task_status !== 'completed' || p.format !== 'short_video' || !['approved', 'published'].includes(p.production_status) || p.output_url !== input.manifest.publicVideoUrl || p.caption !== input.manifest.caption || p.title !== input.manifest.title || row.source_sha256 !== input.ready.sha256 || row.source_binding !== input.binding) throw failure('prayer_social_source_changed');
    return p;
  }
  function result(row, publication) {
    const state = STATES[publication?.status] || 'needs_review';
    const postId = publication?.postId || null;
    const post = postId ? db.prepare('SELECT id,user_id,status,moderation_status,video_uid FROM social_posts WHERE id=?').get(postId) : null;
    const verified = state === 'published_verified' && post?.user_id === PUBLISHER && post.status === 'ready' && post.moderation_status === 'approved' && /^[a-f0-9]{32}$/i.test(post.video_uid || '');
    const finalState = state === 'published_verified' && !verified ? 'needs_review' : state;
    const permalink = verified ? `/social/post/${encodeURIComponent(post.id)}` : null;
    const error = finalState === 'needs_review' ? 'prayer_social_publication_needs_review' : finalState === 'held_unknown' ? 'prayer_social_receipt_unknown' : finalState === 'failed' ? 'prayer_social_processing_failed' : null;
    db.prepare('UPDATE prayer_vitrine_social_runs SET state=?,error=?,post_id=?,permalink=?,updated_at=CURRENT_TIMESTAMP WHERE day=?').run(finalState, error, postId, permalink, row.day);
    return { state: finalState, error, permalink, projectId: row.project_id, postId, hasReceipt: publication?.hasReceipt === true };
  }
  function status() {
    try { const allowed = publisherAllowed(); return { connected: allowed && isConfigured() === true, configured: isConfigured() === true, publisherAllowed: allowed }; }
    catch { return { connected: false, configured: false, publisherAllowed: false }; }
  }
  function pendingDays() { return db.prepare("SELECT day FROM prayer_vitrine_social_runs WHERE state NOT IN ('published_verified','failed') ORDER BY day DESC LIMIT 10").all().map(row => row.day); }
  async function publish({ day, manifest, canPublish = () => false, mode = 'status' }) {
    if (!['step', 'status'].includes(mode) || !validDay(day)) throw failure('prayer_social_command_invalid');
    if (busy) return { state: 'processing', error: null, permalink: null };
    busy = true;
    let row;
    try {
      row = read(day);
      if (!row && mode === 'status') return { state: 'not_started', permalink: null };
      const input = source(day, manifest);
      const allowed = () => mode === 'step' && canPublish() === true && canRun() === true && settingsAllow(day) && withinWindow(day) && publisherAllowed() && isConfigured() === true;
      if (!row) {
        if (!allowed()) return { state: 'paused', permalink: null };
        if (moderationReason(input.manifest.caption)) throw failure('prayer_social_moderation_required');
        row = db.transaction(() => {
          const existing = read(day); if (existing) return existing;
          if (!allowed()) throw failure('prayer_social_paused');
          const agent = db.prepare("SELECT id FROM admin_specialist_agents WHERE code='midia' AND status='active'").get();
          if (!agent) throw failure('prayer_social_agent_unavailable');
          const matches = db.prepare(`SELECT m.id FROM admin_media_projects m JOIN admin_agent_tasks t ON t.id=m.task_id WHERE m.output_url=? AND m.format='short_video' AND m.caption=? AND t.title=? AND t.created_by_user_id=?`).all(input.manifest.publicVideoUrl, input.manifest.caption, input.manifest.title, PUBLISHER);
          if (matches.length > 1) throw failure('prayer_social_existing_publication_needs_review');
          let projectId = matches[0]?.id;
          if (!projectId) {
            // A manually uploaded prayer without the matching project must be inspected, not duplicated.
            if (db.prepare("SELECT 1 FROM social_posts WHERE user_id=? AND caption LIKE ? LIMIT 1").get(PUBLISHER, `%#Oracao${day.replaceAll('-', '')}%`)) throw failure('prayer_social_existing_publication_needs_review');
            const note = JSON.stringify({ type: 'prayer_daily_ready', day, sha256: input.ready.sha256, scriptBinding: input.ready.binding, authorization: 'owner_authorized_prayer_distribution', publisherUserId: PUBLISHER });
            const task = db.prepare(`INSERT INTO admin_agent_tasks(agent_id,created_by_user_id,title,instructions,status,result_summary,completed_at) VALUES(?,?,?,?,'completed',?,CURRENT_TIMESTAMP)`).run(agent.id, PUBLISHER, input.manifest.title, 'Distribuir exclusivamente a edição de oração já preparada e autorizada pelo responsável.', 'Arquivo final conferido por data e hash; nenhuma nova geração de conteúdo.');
            projectId = Number(db.prepare(`INSERT INTO admin_media_projects(task_id,format,channels,source_notes,production_status,script,output_url,aspect_ratio,duration_seconds,progress,caption,video_provider)
              VALUES(?,'short_video','Vitrine Social',?,'approved',?,?,'9:16',?,100,?,'prayer_ready_import')`).run(Number(task.lastInsertRowid), note, input.ready.script.text || '', input.manifest.publicVideoUrl, input.ready.durationSeconds, input.manifest.caption).lastInsertRowid);
          }
          const candidate = { day, project_id: projectId, source_sha256: input.ready.sha256, source_binding: input.binding };
          ownedProject(candidate, input);
          db.prepare('INSERT INTO prayer_vitrine_social_runs(day,project_id,source_sha256,source_binding) VALUES(?,?,?,?)').run(day, projectId, input.ready.sha256, input.binding);
          return read(day);
        }).immediate();
      }
      ownedProject(row, input);
      const current = mediaPublications.snapshot(row.project_id);
      if (!current) throw failure('prayer_social_source_changed');
      if (current.status === 'published' || ['blocked', 'source_changed', 'error', 'pending_review'].includes(current.status)) return result(row, current);
      if (current.status !== 'not_started') {
        // Existing UID only. The lifecycle preserves suspension, moderation, cancellation and pause.
        if (current.canReconcile && publisherAllowed()) return result(row, await mediaPublications.reconcile(row.project_id));
        return result(row, current);
      }
      if (!allowed()) return { state: 'paused', permalink: null, projectId: row.project_id };
      if (moderationReason(input.manifest.caption)) throw failure('prayer_social_moderation_required');
      // Last checks and lifecycle claim are synchronous up to the provider POST. No await gap.
      source(day, manifest); ownedProject(row, input);
      if (!allowed()) throw failure('prayer_social_paused');
      return result(row, await mediaPublications.publish(row.project_id, PUBLISHER, 'oracao'));
    } catch (error) {
      const code = /^prayer_social_[a-z0-9_]+$/.test(error?.code || '') ? error.code : 'prayer_social_operation_needs_review';
      if (row) db.prepare('UPDATE prayer_vitrine_social_runs SET error=?,updated_at=CURRENT_TIMESTAMP WHERE day=?').run(code, day);
      throw failure(code);
    } finally { busy = false; }
  }
  return { publish, status, pendingDays, sourceFormat };
}
