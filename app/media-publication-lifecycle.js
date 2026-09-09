import { randomUUID } from 'node:crypto';

const UID = /^[a-f0-9]{32}$/i;
const BLOCKED = new Set(['deleted', 'rejected']);
const MODERATION_BLOCKED = new Set(['removed', 'rejected', 'suspended']);
const MESSAGE = {
  not_started: 'Ainda não enviado à Vitrine Social.',
  submitting: 'Enviando vídeo. Aguarde o comprovante; não é necessário enviar novamente.',
  processing: 'Envio confirmado. O vídeo está sendo processado.',
  pending_review: 'Vídeo pronto, aguardando aprovação de conteúdo.',
  published: 'Publicado na Vitrine Social.',
  unknown: 'O envio não pôde ser confirmado. Nenhum novo envio será feito automaticamente.',
  error: 'O processamento falhou. Confira o vídeo existente antes de qualquer nova publicação.',
  blocked: 'Publicação suspensa, removida ou não aprovada.',
  paused: 'Vídeo pronto. A publicação aguarda a retomada das rotinas.',
  source_changed: 'O arquivo ou a aprovação mudou. A publicação permanece bloqueada.'
};

export function captureQuizMontage(db, quizId) {
  const quiz=db.prepare('SELECT * FROM admin_viral_quizzes WHERE id=?').get(quizId);
  const project=quiz?.media_project_id?db.prepare('SELECT * FROM admin_media_projects WHERE id=?').get(quiz.media_project_id):null;
  const task=quiz?.task_id?db.prepare('SELECT * FROM admin_agent_tasks WHERE id=?').get(quiz.task_id):null;
  if(!quiz||quiz.status!=='in_production'||!project||!task||project.task_id!==quiz.task_id||project.format!=='short_video'||
    !['script','assets','editing'].includes(project.production_status)||project.published_post_id||task?.status==='cancelled'||
    db.prepare('SELECT 1 FROM media_publication_attempts WHERE project_id=?').get(project.id))return null;
  const scenes=db.prepare('SELECT * FROM viral_quiz_scenes WHERE quiz_id=? ORDER BY scene_number').all(quizId);
  if(scenes.length!==9||scenes.some((scene,index)=>scene.scene_number!==index+1||scene.status!=='downloaded'||!scene.local_path))return null;
  return {quiz,project,scenes,fingerprint:JSON.stringify({quiz,project,task,scenes})};
}

export function commitQuizMontage({db,capture,outputUrl,canRun=()=>true}) {
  return db.transaction(()=>{
    const current=captureQuizMontage(db,capture.quiz.id);
    if(!canRun()||!current||current.fingerprint!==capture.fingerprint)return false;
    db.prepare("UPDATE admin_viral_quizzes SET status='approved',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(capture.quiz.id);
    db.prepare("UPDATE admin_media_projects SET output_url=?,production_status='approved',progress=100,duration_seconds=65,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(outputUrl,capture.project.id);
    db.prepare("UPDATE admin_agent_tasks SET status='completed',result_summary=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run('Montagem concluída; a publicação seguirá a configuração e as verificações aplicáveis.',capture.quiz.task_id);
    const add=db.prepare('INSERT OR IGNORE INTO viral_distribution_jobs(quiz_id,provider,status) VALUES (?,?,?)');
    for(const provider of ['vitrine_social','instagram','facebook','tiktok','youtube','kwai','bilibili'])add.run(capture.quiz.id,provider,provider==='vitrine_social'?'pending':'awaiting_connection');
    return true;
  }).immediate();
}

export function streamIsReady(post) {
  // Existing published rows predate the receipt column. Never demote them on a delayed callback.
  return post?.media_type === 'image' || post?.stream_state === 'ready' || post?.status === 'ready';
}

export function streamTransition(post, video, { restricted = false, sourceBlocked = false, paused = false } = {}) {
  const received = video?.readyToStream === true || video?.readytoStream === true || video?.status?.state === 'ready'
    ? 'ready' : video?.status?.state === 'error' ? 'error' : 'processing';
  const streamState = streamIsReady(post) ? 'ready' : post.stream_state === 'error' && received === 'processing' ? 'error' : received;
  let status;
  if (BLOCKED.has(post.status) || MODERATION_BLOCKED.has(post.moderation_status)) status = post.status;
  else if (restricted || sourceBlocked) status = 'pending_review';
  else if (paused && post.status !== 'ready') status = streamState === 'error' ? 'error' : 'processing';
  else if (streamState === 'ready') status = post.moderation_status === 'approved' ? 'ready' : 'pending_review';
  else status = streamState;
  return { status, streamState, moderationStatus: post.moderation_status === 'pending' && post.moderation_reason ? 'flagged' : post.moderation_status };
}

export function createMediaPublicationLifecycle({ db, getConfig, siteUrl, canRun = () => true, fetchImpl = fetch, now = Date.now, onReady = () => {}, onError = () => {} }) {
  if (!db.prepare('PRAGMA table_info(social_posts)').all().some(c => c.name === 'stream_state')) {
    db.exec("ALTER TABLE social_posts ADD COLUMN stream_state TEXT NOT NULL DEFAULT ''");
  }
  db.exec(`CREATE TABLE IF NOT EXISTS media_publication_attempts (
    project_id INTEGER PRIMARY KEY REFERENCES admin_media_projects(id) ON DELETE CASCADE,
    id TEXT NOT NULL UNIQUE,
    post_id TEXT NOT NULL UNIQUE,
    source_url TEXT NOT NULL,
    source_format TEXT NOT NULL,
    account_id TEXT NOT NULL DEFAULT '',
    stream_uid TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL CHECK(state IN ('submitting','confirmed','unknown','error')),
    started_at INTEGER NOT NULL,
    error_code TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`);

  const readProject = id => db.prepare(`SELECT m.*,t.title FROM admin_media_projects m JOIN admin_agent_tasks t ON t.id=m.task_id WHERE m.id=?`).get(id);
  const readAttempt = id => db.prepare('SELECT * FROM media_publication_attempts WHERE project_id=?').get(id);
  const readPost = id => id ? db.prepare('SELECT * FROM social_posts WHERE id=?').get(id) : null;
  const fail = (message, status = 409) => Object.assign(new Error(message), { status });
  const sourceBlocked = (attempt, project) => !project || project.production_status === 'cancelled' ||
    db.prepare('SELECT status FROM admin_agent_tasks WHERE id=?').get(project.task_id)?.status==='cancelled' ||
    Boolean(db.prepare("SELECT 1 FROM admin_viral_quizzes WHERE media_project_id=? AND status='cancelled'").get(project.id)) || (attempt &&
    (project.output_url !== attempt.source_url || project.format !== attempt.source_format || !['approved','published'].includes(project.production_status)));
  const restricted = userId => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='social_account_restrictions'").get() &&
    db.prepare("SELECT 1 FROM social_account_restrictions WHERE user_id=? AND status='suspended' AND (restricted_until IS NULL OR restricted_until>datetime('now'))").get(userId));

  function snapshot(projectOrId) {
    const project = typeof projectOrId === 'object' ? projectOrId : readProject(projectOrId);
    if (!project) return null;
    const attempt = readAttempt(project.id), post = readPost(attempt?.post_id || project.published_post_id);
    let status = 'not_started';
    if (attempt || project.published_post_id || project.production_status === 'published') {
      if (sourceBlocked(attempt, project)) status = 'source_changed';
      else if (!post) status = 'unknown';
      else if (BLOCKED.has(post.status) || MODERATION_BLOCKED.has(post.moderation_status) || restricted(post.user_id)) status = 'blocked';
      else if (post.status === 'ready' && post.moderation_status === 'approved') status = 'published';
      else if (post.stream_state === 'ready' && post.moderation_status === 'approved' && !canRun()) status = 'paused';
      else if (post.status === 'pending_review') status = 'pending_review';
      else if (post.status === 'error' || attempt?.state === 'error') status = 'error';
      else if (attempt?.state === 'unknown' || post.status === 'unknown' || (attempt?.state === 'submitting' && now() - attempt.started_at > 45000)) status = 'unknown';
      else if (attempt?.state === 'submitting') status = 'submitting';
      else status = 'processing';
    }
    const uid = attempt?.stream_uid || post?.video_uid || '';
    return { status, message: MESSAGE[status], postId: post?.id || attempt?.post_id || project.published_post_id || null,
      receiptId:UID.test(uid)?uid:null,publicUrl:status==='published'?`/social/post/${encodeURIComponent(post.id)}`:null,
      hasReceipt: Boolean(UID.test(uid)), canReconcile: Boolean(UID.test(uid) && post?.media_type !== 'image'),
      canPublish: status === 'not_started' && project.production_status === 'approved',
      errorCode: attempt?.error_code || null };
  }

  function projectChanges(postId) {
    const projects = db.prepare(`SELECT * FROM admin_media_projects WHERE published_post_id=? OR id IN
      (SELECT project_id FROM media_publication_attempts WHERE post_id=?)`).all(postId, postId);
    for (const project of projects) {
      const publication = snapshot(project), published = publication.status === 'published';
      if (published || project.production_status === 'published') db.prepare("UPDATE admin_media_projects SET production_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND production_status!='cancelled'").run(published ? 'published' : 'approved', project.id);
      const quizzes = db.prepare('SELECT id,status FROM admin_viral_quizzes WHERE media_project_id=?').all(project.id);
      for (const quiz of quizzes) {
        if (quiz.status !== 'cancelled' && (published || quiz.status === 'published')) db.prepare('UPDATE admin_viral_quizzes SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(published ? 'published' : 'approved', quiz.id);
        db.prepare(`UPDATE viral_distribution_jobs SET status=?,publication_id=?,error_message=?,updated_at=CURRENT_TIMESTAMP
          WHERE quiz_id=? AND provider='vitrine_social'`).run(published && quiz.status !== 'cancelled' ? 'published' : 'pending', postId, published ? '' : publication.message, quiz.id);
      }
    }
  }

  function applyStream(video) {
    if (!UID.test(String(video?.uid || ''))) return { ignored: true };
    return db.transaction(() => {
      const uid = String(video.uid);
      let post = db.prepare('SELECT * FROM social_posts WHERE video_uid=?').get(uid);
      // A signed callback can arrive before the copy response or after a crash. The random journal ID binds it to this attempt.
      if (!post && typeof video.meta?.vitrinePublicationId === 'string') {
        const attempt = db.prepare('SELECT * FROM media_publication_attempts WHERE id=?').get(video.meta.vitrinePublicationId);
        if (attempt && (!attempt.stream_uid || attempt.stream_uid === uid)) {
          post = readPost(attempt.post_id);
          if (post) {
            db.prepare("UPDATE social_posts SET video_uid=? WHERE id=? AND video_uid=?").run(uid, post.id, post.video_uid);
            db.prepare("UPDATE media_publication_attempts SET stream_uid=?,state='confirmed',error_code='',updated_at=CURRENT_TIMESTAMP WHERE project_id=?").run(uid, attempt.project_id);
            post = readPost(post.id);
          }
        }
      }
      if (!post) return { ignored: true };
      const attempt = db.prepare('SELECT * FROM media_publication_attempts WHERE post_id=?').get(post.id);
      const project = attempt ? readProject(attempt.project_id) : db.prepare('SELECT * FROM admin_media_projects WHERE published_post_id=?').get(post.id);
      const blockedSource = project ? sourceBlocked(attempt, project) : Boolean(attempt);
      const next = streamTransition(post, video, { restricted: restricted(post.user_id), sourceBlocked: blockedSource, paused: Boolean(project) && !canRun() });
      const duration = Number(video.duration);
      db.prepare(`UPDATE social_posts SET status=?,stream_state=?,moderation_status=?,duration_seconds=COALESCE(?,duration_seconds),
        error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(next.status, next.streamState, next.moderationStatus,
        Number.isFinite(duration) && duration > 0 ? duration : null, next.streamState === 'error' ? 'Falha no processamento do vídeo.' : '', post.id);
      if (attempt) db.prepare("UPDATE media_publication_attempts SET stream_uid=?,state='confirmed',error_code='',updated_at=CURRENT_TIMESTAMP WHERE project_id=?").run(uid, attempt.project_id);
      projectChanges(post.id);
      if (next.status === 'ready' && post.status !== 'ready') onReady(readPost(post.id));
      if (next.status === 'error' && post.status !== 'error') onError(post);
      return { postId: post.id, status: next.status };
    }).immediate();
  }

  function config(accountId) {
    const value = getConfig();
    if (!UID.test(String(value?.accountId || '')) || !value?.token) throw fail('Configure o Cloudflare Stream para conferir ou enviar vídeos.', 503);
    if (accountId && value.accountId !== accountId) throw fail('A conta de vídeo mudou. Confira a conta vinculada ao comprovante antes de continuar.');
    return value;
  }
  function sourceUrl(value) {
    let url;
    try { url = new URL(value, siteUrl); } catch { throw fail('O arquivo final precisa ter um endereço público válido.'); }
    if (url.protocol !== 'https:' || url.username || url.password || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname)) throw fail('O arquivo final precisa usar um endereço público HTTPS.');
    return url.href;
  }

  async function publish(projectId, userId, category = 'geral') {
    let project = readProject(projectId);
    if (!project) throw fail('Projeto não encontrado.', 404);
    // Returning an existing receipt never creates another upload, even following an ambiguous failure.
    if (readAttempt(projectId) || project.published_post_id || project.production_status === 'published') return snapshot(project);
    if (!canRun()) throw fail('A pausa geral está ativa.');
    if (restricted(userId)) throw fail('O autor está com a conta suspensa. Nenhum envio foi iniciado.');
    if (!project.output_url || project.production_status !== 'approved' || sourceBlocked(null,project)) throw fail('Aprove a criação antes de publicar; projetos cancelados não serão enviados.');
    if (!['image','short_video','long_video'].includes(project.format)) throw fail('Este formato ainda não pode ser publicado na Vitrine Social.');
    const sourceFormat=project.format;
    const url = sourceUrl(project.output_url), settings = project.format === 'image' ? null : config();
    const claim = db.transaction(() => {
      project = readProject(projectId);
      if (readAttempt(projectId) || project.published_post_id) return null;
      if (!canRun() || restricted(userId) || project.production_status !== 'approved' || sourceBlocked(null,project) || project.format!==sourceFormat || sourceUrl(project.output_url) !== url) throw fail('A criação ou a autorização mudou. Confira o projeto.');
      const id = randomUUID(), postId = randomUUID(), image = project.format === 'image';
      db.prepare(`INSERT INTO media_publication_attempts (project_id,id,post_id,source_url,source_format,account_id,state,started_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(projectId, id, postId, project.output_url, project.format, settings?.accountId || '', image ? 'confirmed' : 'submitting', now());
      db.prepare(`INSERT INTO social_posts (id,user_id,video_uid,media_type,image_url,caption,category,status,stream_state,moderation_status,moderated_by,moderated_at)
        VALUES (?,?,?,?,?,?,?,?,?,'approved',?,CURRENT_TIMESTAMP)`).run(postId, userId, `factory-pending-${postId}`, image ? 'image' : 'video', image ? project.output_url : '', project.caption || project.title, category, image ? 'ready' : 'uploading', image ? 'ready' : '', userId);
      db.prepare('UPDATE admin_media_projects SET published_post_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(postId, projectId);
      projectChanges(postId);
      if (image) onReady(readPost(postId));
      return { id, postId, image };
    }).immediate();
    if (!claim || claim.image) return snapshot(projectId);
    try {
      // The only credential-bearing host is fixed; redirects must never forward a bearer token.
      const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${settings.accountId}/stream/copy`, {
        method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${settings.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, meta: { name: project.title, vitrinePublicationId: claim.id } }), signal: AbortSignal.timeout(30000)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false || !UID.test(String(payload.result?.uid || ''))) {
        const definite = !response.ok && response.status >= 400 && response.status < 500 && payload.success === false;
        db.prepare("UPDATE media_publication_attempts SET state=?,error_code=?,updated_at=CURRENT_TIMESTAMP WHERE project_id=? AND stream_uid=''")
          .run(definite ? 'error' : 'unknown', definite ? `stream_http_${response.status}` : 'receipt_unconfirmed', projectId);
        db.prepare("UPDATE social_posts SET status=?,error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='uploading'").run(definite ? 'error' : 'unknown', definite ? 'O provedor recusou o envio.' : MESSAGE.unknown, claim.postId);
      } else {
        const attempt = readAttempt(projectId);
        if (attempt.stream_uid && attempt.stream_uid !== payload.result.uid) throw fail('O comprovante não corresponde ao envio.');
        const existing = db.prepare('SELECT id FROM social_posts WHERE video_uid=?').get(payload.result.uid);
        if (existing && existing.id !== claim.postId) throw fail('O comprovante já pertence a outro envio.');
        applyStream({ ...payload.result, meta: { vitrinePublicationId: claim.id } });
      }
    } catch {
      db.prepare("UPDATE media_publication_attempts SET state='unknown',error_code='receipt_unconfirmed',updated_at=CURRENT_TIMESTAMP WHERE project_id=? AND stream_uid=''").run(projectId);
      db.prepare("UPDATE social_posts SET status='unknown',error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='uploading'").run(MESSAGE.unknown, claim.postId);
    }
    projectChanges(claim.postId);
    return snapshot(projectId);
  }

  async function reconcile(projectId) {
    const project = readProject(projectId);
    if (!project) throw fail('Projeto não encontrado.', 404);
    const attempt = readAttempt(projectId), post = readPost(attempt?.post_id || project.published_post_id);
    const uid = attempt?.stream_uid || post?.video_uid || '';
    if (!UID.test(uid) || post?.media_type === 'image') return snapshot(project);
    const settings = config(attempt?.account_id);
    let payload, response;
    try {
      response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${settings.accountId}/stream/${uid}`, {
        method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${settings.token}` }, signal: AbortSignal.timeout(15000)
      });
      payload = await response.json();
    } catch { throw fail('Não foi possível conferir o comprovante agora. O vídeo não foi enviado novamente.', 502); }
    if (!response.ok || payload.success === false || payload.result?.uid !== uid) throw fail('O provedor não confirmou este comprovante. O vídeo não foi enviado novamente.', 502);
    applyStream(payload.result);
    return snapshot(projectId);
  }

  function approvalStatus(post) {
    const project = db.prepare('SELECT * FROM admin_media_projects WHERE published_post_id=?').get(post.id);
    if (project && sourceBlocked(readAttempt(project.id), project)) return 'pending_review';
    if (restricted(post.user_id)) return 'pending_review';
    if (project && !canRun() && post.status !== 'ready') return 'processing';
    if (streamIsReady(post)) return 'ready';
    return post.stream_state === 'error' || post.status === 'error' ? 'error' : 'processing';
  }
  return { snapshot, publish, reconcile, applyStream, projectChanges, approvalStatus };
}
