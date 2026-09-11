// Dated prayer publication adapter. Importing this module performs no I/O.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createDecipheriv } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const TARGET = Object.freeze({ accountId: 7, userId: 4, pageId: '127910957075609', pageName: 'Campo & Conhecimento', instagramId: '17841461502665390', instagramUsername: 'agrotecniica' });
const campaignValid = value => /^oracao-\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value.slice(7)+'T00:00:00Z').toISOString().slice(0,10)===value.slice(7);
const MAX_BYTES = 200 * 1024 * 1024;
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const numericId = value => typeof value === 'string' && /^[1-9][0-9]{5,30}$/.test(value);
const knownStatus = (value, allowed) => allowed.includes(value) ? value : null;
const safeCode = error => /^prayer_[a-z0-9_]+$/.test(error?.code) ? error.code : 'prayer_operation_failed';
const now = () => new Date().toISOString();

export function validateManifest(input) {
  if (!input || !campaignValid(input.campaign) || !path.isAbsolute(input.videoPath || '')) fail('prayer_manifest_invalid');
  const caption = String(input.caption || '').trim();
  const title = String(input.title || '').trim();
  if (caption.length < 20 || caption.length > 2200 || !/inteligência artificial/i.test(caption) || !title || title.length > 100) fail('prayer_disclosure_or_caption_invalid');
  let url; try { url = new URL(input.publicVideoUrl); } catch { fail('prayer_public_url_invalid'); }
  if (url.protocol !== 'https:' || !['vitrinecity.com', 'www.vitrinecity.com'].includes(url.hostname) || url.port || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('.mp4')) fail('prayer_public_url_invalid');
  return { campaign: input.campaign, videoPath: path.resolve(input.videoPath), publicVideoUrl: url.href, title, caption };
}

export function validateVideo(buffer, probe) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 32 || buffer.length > MAX_BYTES || buffer.toString('ascii', 4, 8) !== 'ftyp') fail('prayer_mp4_invalid');
  const video = probe?.streams?.find(s => s.codec_type === 'video');
  const audio = probe?.streams?.find(s => s.codec_type === 'audio');
  const duration = Number(probe?.format?.duration);
  const fraction = String(video?.avg_frame_rate || '').split('/').map(Number);
  const fps = fraction[0] / fraction[1];
  if (!video || video.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p' || video.width < 540 || video.height < 960 || Math.abs(video.width / video.height - 9 / 16) > 0.001 || fps < 23 || fps > 60 || duration < 4 || duration > 60) fail('prayer_video_specs_invalid');
  if (!audio || audio.codec_name !== 'aac' || Number(audio.sample_rate) > 48000 || ![1, 2].includes(audio.channels)) fail('prayer_audio_specs_invalid');
  // A real atom walk avoids matching an accidental "moov" sequence inside media bytes.
  let moov = -1, mdat = -1;
  for (let offset = 0; offset + 8 <= buffer.length;) {
    let size = buffer.readUInt32BE(offset); const atom = buffer.toString('ascii', offset + 4, offset + 8);
    if (size === 1) { if (offset + 16 > buffer.length) fail('prayer_mp4_invalid'); const big = buffer.readBigUInt64BE(offset + 8); if (big > BigInt(Number.MAX_SAFE_INTEGER)) fail('prayer_mp4_invalid'); size = Number(big); }
    if (size === 0) size = buffer.length - offset;
    if (size < 8 || offset + size > buffer.length) fail('prayer_mp4_invalid');
    if (atom === 'moov') moov = offset; if (atom === 'mdat') mdat = offset;
    offset += size;
  }
  if (moov < 0 || mdat < 0 || moov > mdat) fail('prayer_faststart_required');
  return { sha256: digest(buffer), bytes: buffer.length, durationSeconds: duration, width: video.width, height: video.height, fps, videoCodec: 'h264', audioCodec: 'aac' };
}

export function inspectLocalVideo(manifest, ffprobe = '/usr/bin/ffprobe') {
  const st = fs.statSync(manifest.videoPath);
  if (!st.isFile() || st.size > MAX_BYTES) fail('prayer_mp4_invalid');
  const buffer = fs.readFileSync(manifest.videoPath);
  let probe; try { probe = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', manifest.videoPath], { timeout: 15000, maxBuffer: 1024 * 1024, encoding: 'utf8', windowsHide: true, shell: false })); } catch { fail('prayer_probe_failed'); }
  return { buffer, info: validateVideo(buffer, probe) };
}

export function loadCredential(env = process.env, Database) {
  const Db = Database || createRequire('/app/package.json')('better-sqlite3');
  const db = new Db('/data/vitrinecity.db', { readonly: true, fileMustExist: true });
  let row;
  try { row = db.prepare('SELECT id,user_id,page_id,page_name,instagram_id,instagram_username,token_encrypted,status FROM social_accounts WHERE id=?').get(TARGET.accountId); } finally { db.close(); }
  if (!row || row.id !== TARGET.accountId || row.user_id !== TARGET.userId || row.page_id !== TARGET.pageId || row.instagram_id !== TARGET.instagramId || row.instagram_username !== TARGET.instagramUsername || row.status !== 'connected') fail('prayer_account_binding_invalid');
  const secret = String(env.META_SOCIAL_TOKEN_ENCRYPTION_KEY || env.WHATSAPP_TOKEN_ENCRYPTION_KEY || '');
  if (secret.length < 24 || !env.META_SOCIAL_APP_ID || !env.META_SOCIAL_APP_SECRET) fail('prayer_credentials_unavailable');
  let token;
  try {
    const [iv, tag, data, extra] = row.token_encrypted.split('.');
    if (!iv || !tag || !data || extra) fail('prayer_token_invalid');
    const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update('social:' + secret).digest(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    token = Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    if (!token || /[\r\n]/.test(token)) fail('prayer_token_invalid');
  } catch { fail('prayer_token_invalid'); }
  const version = String(env.META_SOCIAL_API_VERSION || env.META_API_VERSION || 'v26.0');
  if (!/^v[0-9]{2}\.0$/.test(version)) fail('prayer_api_version_invalid');
  return { token, version, appId: String(env.META_SOCIAL_APP_ID), appToken: `${env.META_SOCIAL_APP_ID}|${env.META_SOCIAL_APP_SECRET}`, credentialVersion: digest(row.token_encrypted) };
}

export function createApi(credential, fetchImpl = globalThis.fetch) {
  async function json(url, { method = 'GET', body, upload = false, app = false, byteLength } = {}) {
    let response;
    try {
      response = await fetchImpl(url, { method, redirect: 'manual', signal: AbortSignal.timeout(upload ? 60000 : 30000), headers: { Authorization: `${upload ? 'OAuth' : 'Bearer'} ${app ? credential.appToken : credential.token}`, ...(upload ? { 'Content-Type': 'application/octet-stream', offset: '0', file_size: String(byteLength), 'Content-Length': String(byteLength) } : body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body });
      if (response.status >= 300 && response.status < 400) fail('prayer_redirect_blocked');
      const text = await response.text();
      if (text.length > 1024 * 1024) fail('prayer_response_invalid');
      const data = JSON.parse(text);
      if (!response.ok || data?.error) {
        const code = Number(data?.error?.code);
        throw Object.assign(new Error('prayer_meta_rejected'), { code: 'prayer_meta_rejected', httpStatus: response.status, metaCode: Number.isInteger(code) ? code : null });
      }
      return data;
    } catch (error) {
      if (error?.code?.startsWith('prayer_')) throw error;
      fail('prayer_network_or_response_unknown');
    }
  }
  function graph(endpoint, params = {}, method = 'GET', app = false) {
    if (!/^(?:me|debug_token|[1-9][0-9]{5,30})(?:\/(?:video_reels|media|media_publish|content_publishing_limit))?$/.test(endpoint)) fail('prayer_endpoint_invalid');
    const url = new URL(`https://graph.facebook.com/${credential.version}/${endpoint}`);
    const body = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    if (method === 'GET') url.search = body.toString();
    return json(url.href, { method, app, ...(method === 'POST' ? { body } : {}) });
  }
  return {
    get: (endpoint, params) => graph(endpoint, params),
    post: (endpoint, params) => graph(endpoint, params, 'POST'),
    async preflight(channel) {
      const debug = await graph('debug_token', { input_token: credential.token }, 'GET', true);
      const d = debug?.data; const epoch = Math.floor(Date.now() / 1000);
      const required = channel === 'facebook' ? ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'] : ['pages_show_list', 'pages_read_engagement', 'instagram_basic', 'instagram_content_publish'];
      if (!d?.is_valid || String(d.app_id) !== credential.appId || (d.expires_at && d.expires_at <= epoch) || (d.data_access_expires_at && d.data_access_expires_at <= epoch) || required.some(s => !d.scopes?.includes(s))) fail('prayer_token_permissions_invalid');
      for (const scope of required) {
        const granular = d.granular_scopes?.find(s => s.scope === scope);
        if (granular?.target_ids?.length && !granular.target_ids.some(id => [TARGET.pageId, TARGET.instagramId].includes(String(id)))) fail('prayer_token_target_invalid');
      }
      const page = await graph('me', { fields: 'id,name,instagram_business_account{id,username}' });
      if (String(page.id) !== TARGET.pageId) fail('prayer_page_identity_invalid');
      if (channel === 'instagram') {
        if (String(page.instagram_business_account?.id) !== TARGET.instagramId) fail('prayer_instagram_binding_invalid');
        const ig = await graph(TARGET.instagramId, { fields: 'id,username' });
        if (String(ig.id) !== TARGET.instagramId || ig.username !== TARGET.instagramUsername) fail('prayer_instagram_identity_invalid');
        const limit = await graph(`${TARGET.instagramId}/content_publishing_limit`, { fields: 'config,quota_usage' });
        const quota = limit?.data?.[0];
        if (!Number.isFinite(quota?.config?.quota_total) || !Number.isFinite(quota?.quota_usage) || quota.quota_usage >= quota.config.quota_total) fail('prayer_instagram_quota_unavailable');
      }
      return { checkedAt: now(), accountId: TARGET.accountId, pageId: TARGET.pageId, ...(channel === 'instagram' ? { instagramId: TARGET.instagramId } : {}), requiredScopesPresent: true, publicReachVerified: false };
    },
    upload(videoId, buffer) {
      if (!numericId(videoId)) fail('prayer_video_receipt_invalid');
      return json(`https://rupload.facebook.com/video-upload/${credential.version}/${videoId}`, { method: 'POST', upload: true, body: buffer, byteLength: buffer.length });
    },
    async verifyPublic(manifest, info) {
      let response;
      try { response = await fetchImpl(manifest.publicVideoUrl, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(30000) }); } catch { fail('prayer_public_video_unavailable'); }
      if (!response.ok || response.status >= 300 || !response.body) fail('prayer_public_video_unavailable');
      const hash = createHash('sha256'); let bytes = 0;
      for await (const part of response.body) { bytes += part.length; if (bytes > MAX_BYTES || bytes > info.bytes) fail('prayer_public_video_mismatch'); hash.update(part); }
      if (bytes !== info.bytes || hash.digest('hex') !== info.sha256) fail('prayer_public_video_mismatch');
    },
  };
}

function syncDirectory(dir) {
  // Directory fsync is supported by Linux; Windows fixtures cannot open a directory.
  if (process.platform !== 'win32') { const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
}

export function openJournal(directory, channel, campaign) {
  if (!campaignValid(campaign)) fail('prayer_campaign_invalid');
  if (!['facebook', 'instagram'].includes(channel) || !path.isAbsolute(directory)) fail('prayer_journal_invalid');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${campaign}-${channel}.json`);
  const lock = path.join(directory, `${campaign}-${channel}.lock`);
  try { fs.mkdirSync(lock, { mode: 0o700 }); } catch { fail('prayer_lock_held_manual_review'); }
  // Never steal a lock, even after a crash. An operator must establish no process remains.
  syncDirectory(directory);
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: now() }), { mode: 0o600 });
  return {
    load() { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; fail('prayer_journal_unreadable'); } },
    save(value) {
      const temp = `${file}.${process.pid}.tmp`;
      const fd = fs.openSync(temp, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temp, file); syncDirectory(directory);
    },
    close() { fs.unlinkSync(path.join(lock, 'owner.json')); fs.rmdirSync(lock); syncDirectory(directory); },
    file,
  };
}

function validPermalink(raw, channel) {
  try {
    const url = new URL(raw, channel === 'facebook' ? 'https://www.facebook.com' : undefined);
    const hosts = channel === 'facebook' ? ['www.facebook.com', 'facebook.com'] : ['www.instagram.com', 'instagram.com'];
    if (url.protocol !== 'https:' || !hosts.includes(url.hostname) || url.port || url.username || url.password || url.searchParams.has('access_token')) return null;
    if ([...url.searchParams.keys()].some(key => key !== 'v') || url.hash) return null;
    if (channel === 'instagram' && !/^\/(?:reel|p)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

export async function run({ mode, channel, manifest: raw, credentialVersion, local, api, journal, canPublish = () => true }) {
  if (!['prepare', 'step', 'status'].includes(mode) || !['facebook', 'instagram'].includes(channel)) fail('prayer_command_invalid');
  const manifest = validateManifest(raw);
  const binding = digest(JSON.stringify({ manifest, channel, info: local.info, account: TARGET }));
  let state = journal.load();
  if (state && (state.binding !== binding || state.channel !== channel || state.campaign !== manifest.campaign || state.credentialVersion !== credentialVersion)) fail('prayer_receipt_binding_changed');
  if (!state && mode !== 'prepare') fail('prayer_prepare_required');
  if (!state) state = { version: 1, campaign: manifest.campaign, channel, binding, credentialVersion, manifest, video: local.info, target: TARGET, phase: 'prepared', attempts: {}, createdAt: now(), publicReachVerified: false };
  const save = () => { state.updatedAt = now(); journal.save(state); };
  if (mode === 'prepare') {
    state.preflight = await api.preflight(channel);
    if (channel === 'instagram') await api.verifyPublic(manifest, local.info);
    save(); return state;
  }
  // A persisted intent precedes every POST. A lost response can never cause replay.
  async function once(name, request, validate, next) {
    if (state.attempts[name]) fail('prayer_write_already_attempted');
    if (!canPublish()) fail('prayer_publication_paused');
    state.attempts[name] = { state: 'pending_unknown', startedAt: now() }; save();
    try {
      const data = await request(); const receipt = validate(data);
      state.attempts[name] = { ...state.attempts[name], state: 'acknowledged', completedAt: now(), ...receipt };
      Object.assign(state, receipt, { phase: next }); save();
    } catch (error) {
      state.attempts[name].error = safeCode(error);
      if (Number.isInteger(error.httpStatus)) state.attempts[name].httpStatus = error.httpStatus;
      if (Number.isInteger(error.metaCode)) state.attempts[name].metaCode = error.metaCode;
      state.phase = 'held_unknown'; save();
      // Provider error text/URLs are never persisted or printed.
    }
  }
  async function refresh() {
    if (channel === 'facebook' && state.videoId) {
      const data = await api.get(state.videoId, { fields: 'id,status,from,description,permalink_url' });
      if (String(data.id) !== state.videoId || (data.from && String(data.from.id) !== TARGET.pageId)) fail('prayer_video_receipt_invalid');
      const status = data.status || {};
      const phaseStatuses = ['complete', 'not_started', 'in_progress', 'error'];
      state.remote = { checkedAt: now(), videoStatus: knownStatus(status.video_status, ['ready', 'processing', 'error', 'uploading']), uploading: knownStatus(status.uploading_phase?.status, phaseStatuses), processing: knownStatus(status.processing_phase?.status, phaseStatuses), publishing: knownStatus(status.publishing_phase?.status, phaseStatuses) };
      if (status.video_status === 'error') state.phase = 'failed';
      else if (status.publishing_phase?.status === 'complete') {
        const link = validPermalink(data.permalink_url, channel);
        if (String(data.from?.id) === TARGET.pageId && data.description === manifest.caption && link) Object.assign(state, { phase: 'published_verified', permalink: link, verifiedAt: now() });
        else state.phase = 'published_needs_verification';
      } else if (status.uploading_phase?.status === 'complete' && !state.attempts.finish && state.attempts.upload) state.phase = 'uploaded';
      save();
    }
    if (channel === 'instagram' && state.containerId && !state.mediaId) {
      const data = await api.get(state.containerId, { fields: 'id,status_code' });
      if (String(data.id) !== state.containerId) fail('prayer_container_receipt_invalid');
      state.remote = { checkedAt: now(), containerStatus: knownStatus(data.status_code, ['IN_PROGRESS', 'FINISHED', 'ERROR', 'EXPIRED', 'PUBLISHED']) };
      if (['ERROR', 'EXPIRED'].includes(data.status_code)) state.phase = 'failed';
      else if (data.status_code === 'FINISHED' && !state.attempts.publish) state.phase = 'ready_to_publish';
      else if (data.status_code === 'PUBLISHED') state.phase = 'published_needs_verification';
      save();
    }
    if (channel === 'instagram' && state.mediaId) {
      const data = await api.get(state.mediaId, { fields: 'id,owner,username,caption,media_type,media_product_type,permalink,is_ai_generated' });
      const link = validPermalink(data.permalink, channel);
      if (String(data.id) !== state.mediaId || String(data.owner?.id) !== TARGET.instagramId || data.username !== TARGET.instagramUsername || data.caption !== manifest.caption || data.media_type !== 'VIDEO' || data.media_product_type !== 'REELS' || !link) fail('prayer_media_verification_failed');
      Object.assign(state, { phase: 'published_verified', permalink: link, verifiedAt: now(), aiLabelReadback: data.is_ai_generated === true }); save();
    }
    return state;
  }
  if (mode === 'status' || ['held_unknown', 'publishing', 'published_needs_verification', 'published_verified', 'failed'].includes(state.phase)) return refresh();
  state.preflight = await api.preflight(channel); save();
  if (channel === 'facebook') {
    if (state.phase === 'prepared') await once('start', () => api.post(`${TARGET.pageId}/video_reels`, { upload_phase: 'start' }), data => { if (!numericId(data.video_id)) fail('prayer_video_receipt_invalid'); return { videoId: data.video_id }; }, 'started');
    else if (state.phase === 'started') await once('upload', () => api.upload(state.videoId, local.buffer), data => { if (data.success !== true) fail('prayer_upload_unconfirmed'); return {}; }, 'uploaded');
    else if (state.phase === 'uploaded') await once('finish', () => api.post(`${TARGET.pageId}/video_reels`, { upload_phase: 'finish', video_id: state.videoId, video_state: 'PUBLISHED', title: manifest.title, description: manifest.caption, is_ai_generated: true }), data => { if (data.success !== true) fail('prayer_publish_unconfirmed'); return {}; }, 'publishing');
  } else {
    if (state.phase === 'prepared') {
      await api.verifyPublic(manifest, local.info);
      await once('create', () => api.post(`${TARGET.instagramId}/media`, { media_type: 'REELS', video_url: manifest.publicVideoUrl, caption: manifest.caption, share_to_feed: true, is_ai_generated: true }), data => { if (!numericId(data.id)) fail('prayer_container_receipt_invalid'); return { containerId: data.id }; }, 'processing');
    } else if (state.phase === 'processing') await refresh();
    else if (state.phase === 'ready_to_publish') {
      await refresh();
      if (state.remote.containerStatus === 'FINISHED') await once('publish', () => api.post(`${TARGET.instagramId}/media_publish`, { creation_id: state.containerId }), data => { if (!numericId(data.id)) fail('prayer_media_receipt_invalid'); return { mediaId: data.id }; }, 'publishing');
    }
  }
  return state;
}

export async function cli(argv = process.argv.slice(2)) {
  const [mode, channel, manifestFile, ...extra] = argv;
  if (extra.length || !['prepare', 'step', 'status'].includes(mode) || !['facebook', 'instagram'].includes(channel) || !manifestFile) fail('prayer_usage_prepare_step_status_channel_manifest');
  const manifest = validateManifest(JSON.parse(fs.readFileSync(manifestFile, 'utf8')));
  const local = inspectLocalVideo(manifest, process.env.PRAYER_FFPROBE || '/usr/bin/ffprobe');
  const credential = loadCredential();
  // Fixed persistent receipt root. Never use /tmp or switch folders to bypass a receipt.
  const journal = openJournal('/data/prayer-publications', channel, manifest.campaign);
  try {
    const result = await run({ mode, channel, manifest, credentialVersion: credential.credentialVersion, local, api: createApi(credential), journal });
    console.log(JSON.stringify({ campaign: result.campaign, channel, target: channel === 'facebook' ? TARGET.pageName : '@' + TARGET.instagramUsername, phase: result.phase, videoId: result.videoId, containerId: result.containerId, mediaId: result.mediaId, permalink: result.permalink, aiLabelReadback: result.aiLabelReadback, remote: result.remote, receiptFile: journal.file, publicReachVerified: false }, null, 2));
  } finally { journal.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) cli().catch(error => { console.error(JSON.stringify({ error: safeCode(error) })); process.exitCode = 1; });
