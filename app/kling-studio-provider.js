import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {execFile} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash, randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdir, readFile, writeFile, unlink, rmdir, realpath, stat} from 'node:fs/promises';
import {dirname, isAbsolute, join} from 'node:path';
import {hostname} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {publicImageAddress} from './catalog-product-images.js';

// Official OAuth/MCP client: https://kling.ai/app/mcp/guide . This adapter never
// logs in, supplies API tokens, uploads files, or retries a generation command.
const require = createRequire(import.meta.url);
const ENDPOINT = 'https://kling.ai/mcp';
const VERSION = '0.2.0';
const MODEL = 'kling-video-v3_0';
const DURATIONS = Object.freeze(Array.from({length: 13}, (_, index) => index + 3));
const RATIOS = Object.freeze(['9:16', '16:9', '1:1']);
const MAX_JSON_BYTES = 1024 * 1024;
const LOCK_NAME = '.vitrinecity-cli-lock';
const clean = value => typeof value === 'string' ? value.trim() : '';
const fail = (code, status = 503) => Object.assign(new Error(code), {code, status});
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export const KLING_STUDIO_DEFAULTS = Object.freeze({provider: 'kling_studio', model: MODEL,
  cliVersion: VERSION, endpoint: ENDPOINT, durationSeconds: 5, aspectRatio: '9:16', resolution: '1080p',
  generateAudio: false, imageCount: 1, preferMultiShots: false, estimatedCreditsPerSecond: 8,
  createTimeoutMs: 120000, pollTimeoutMs: 90000, lockTimeoutMs: 20000, maxStdoutBytes: MAX_JSON_BYTES,
  downloadTimeoutMs: 120000, maxDownloadBytes: 250 * 1024 * 1024});

/** Configuration is safe for the admin API; OAuth readiness is checked separately. */
export function resolveKlingStudioConfig(env = process.env) {
  const model = clean(env.KLING_VIDEO_MODEL) || MODEL;
  const home = clean(env.KLING_HOME);
  const error = model !== MODEL ? 'kling_studio_model_invalid' : !home || !isAbsolute(home) ? 'kling_studio_home_missing' : '';
  return Object.freeze({provider: 'kling_studio', configured: !error, videoConfigured: !error, videoEnabled: !error,
    videoModel: model === MODEL ? model : '', videoOptions: Object.freeze(model === MODEL ? [MODEL] : []),
    durationOptions: DURATIONS, aspectRatioOptions: RATIOS, resolution: '1080p', audioAlwaysOn: false,
    defaultDurationSeconds: 5, generateAudio: false, imageCount: 1, preferMultiShots: false,
    error, videoReason: error ? 'A conexão com a conta Kling precisa ser configurada.' : ''});
}

export const klingStudioJobId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(value) ? value : '';
function marker(id, binding) { return `${ENDPOINT}#${binding}/${id}`; }
export function klingStudioPollingUrl(value, jobId) {
  if (!klingStudioJobId(jobId) || typeof value !== 'string') return '';
  const match = /^https:\/\/kling\.ai\/mcp#([a-f0-9]{64})\/([A-Za-z0-9][A-Za-z0-9_-]{0,159})$/.exec(value);
  return match && match[2] === jobId && value === marker(jobId, match[1]) ? value : '';
}
export function klingStudioReceipt(data) {
  const jobId = klingStudioJobId(data?.id);
  return {jobId, pollingUrl: klingStudioPollingUrl(data?.polling_url, jobId)};
}
function generationId(body) {
  const id = body?.generationId ?? body?.generation_id;
  if (body?.generationId !== undefined && body?.generation_id !== undefined && body.generationId !== body.generation_id) return '';
  return klingStudioJobId(id);
}
function accountId(value) {
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value) ? value : '';
}
function identity(body) {
  const id = accountId(body?.user?.userId ?? body?.user?.user_id);
  if (!id || body.user.userId !== undefined && body.user.user_id !== undefined && accountId(body.user.userId) !== accountId(body.user.user_id)) throw fail('kling_studio_identity_invalid', 502);
  return {id, binding: createHash('sha256').update(`kling.ai:${id}`).digest('hex')};
}
function capabilities(body) {
  const catalog = body?.availableModels?.text_to_video ?? body?.available_models?.text_to_video;
  const models = Array.isArray(catalog) ? catalog : catalog?.models;
  const spec = Array.isArray(models) ? models.find(item => item?.model === MODEL) : null;
  if (!spec || !Array.isArray(spec.arguments) || spec.arguments.some(arg => !object(arg) || typeof arg.name !== 'string') || spec.inputs !== undefined && !Array.isArray(spec.inputs) || (spec.inputs || []).some(item => !object(item) || item.required)) throw fail('kling_studio_capabilities_unavailable', 503);
  const args = new Map(spec.arguments.map(arg => [arg.name, arg]));
  const allowed = name => args.get(name)?.allowedValues ?? args.get(name)?.allowed_values;
  const accepts = (name, value) => Array.isArray(allowed(name)) && allowed(name).includes(String(value));
  if (!args.has('prompt') || !accepts('resolution', '1080p') || !accepts('enable_audio', false) || !accepts('prefer_multi_shots', false) || !accepts('imageCount', 1) || spec.arguments.some(arg => arg.required && !['prompt', 'duration', 'aspect_ratio', 'resolution', 'enable_audio', 'prefer_multi_shots', 'imageCount'].includes(arg.name))) throw fail('kling_studio_capabilities_unavailable', 503);
  const durationOptions = DURATIONS.filter(value => accepts('duration', value));
  const aspectRatioOptions = RATIOS.filter(value => accepts('aspect_ratio', value));
  if (!durationOptions.length || !aspectRatioOptions.length) throw fail('kling_studio_capabilities_unavailable', 503);
  return {videoModel: MODEL, durationOptions, aspectRatioOptions, resolution: '1080p', audioAlwaysOn: false};
}
function account(body, expected) {
  if (accountId(body?.userId ?? body?.user_id) !== expected.id) throw fail('kling_studio_account_mismatch', 409);
  if (body.userId !== undefined && body.user_id !== undefined && accountId(body.userId) !== accountId(body.user_id)) throw fail('kling_studio_account_mismatch', 409);
  const credits = body?.availableRemainCredits;
  if (typeof credits !== 'number' || !Number.isFinite(credits) || credits < 0) throw fail('kling_studio_account_invalid', 502);
  return {accountBinding: expected.binding, membershipType: clean(body.membershipType).slice(0, 80),
    membershipTypeDescription: clean(body.membershipTypeDescription).slice(0, 160), availableCredits: credits,
    usablePaidCredits: null, creditsSource: 'query_membership_and_credits.availableRemainCredits', creditUnit: 'credits'};
}

function officialCli() {
  try {
    const path = require.resolve('@klingai/cli-global/package.json');
    const pkg = JSON.parse(readFileSync(path, 'utf8'));
    if (pkg.name !== '@klingai/cli-global' || pkg.version !== VERSION || pkg.bin?.kling !== 'dist/cli.js') throw Error();
    return join(dirname(path), 'dist', 'cli.js');
  } catch { throw fail('kling_studio_runtime_unavailable'); }
}
function childEnvironment(env, home) {
  // Deliberately exclude NODE_OPTIONS, proxy/TLS overrides and every platform key.
  const result = {KLING_HOME: home, KLING_NONINTERACTIVE: '1', NO_COLOR: '1', LANG: 'en_US.UTF-8'};
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) {
    if (typeof env[key] === 'string' && env[key]) result[key] = env[key];
  }
  return result;
}

/** Atomic directory creation serializes credential refresh and generation across
 * app processes sharing one private KLING_HOME. Never steal an existing lock:
 * after a crashed owner, an operator must verify it stopped before removing it. */
async function withAccountLock(home, timeoutMs, run) {
  let directory;
  try {
    directory = await realpath(home);
    if (!(await stat(join(directory, '.credentials'))).isFile()) throw Error();
  } catch { throw fail('kling_studio_auth_unavailable'); }
  const lock = join(directory, LOCK_NAME), owner = join(lock, 'owner.json');
  const token = randomUUID(), deadline = Date.now() + timeoutMs;
  while (true) {
    try { await mkdir(lock, {mode: 0o700}); break; }
    catch (error) {
      if (error?.code !== 'EEXIST') throw fail('kling_studio_lock_unavailable');
      if (Date.now() >= deadline) throw fail('kling_studio_busy', 503);
      await delay(Math.min(100, Math.max(1, deadline - Date.now())));
    }
  }
  try {
    try { await writeFile(owner, JSON.stringify({pid: process.pid, hostname: hostname(), token, createdAt: new Date().toISOString()}), {mode: 0o600, flag: 'wx'}); }
    catch { throw fail('kling_studio_lock_unavailable'); }
    return await run(directory);
  } finally {
    // An unexpected lock replacement fails closed instead of deleting its owner.
    try {
      const state = JSON.parse(await readFile(owner, 'utf8'));
      if (state.token === token) { await unlink(owner); await rmdir(lock); }
    } catch { /* Preserve an unrecognized lock for operator inspection. */ }
  }
}

function downloadTarget(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\\\s]/.test(value)) throw fail('video_download_url_invalid', 502);
  let url; try { url = new URL(value); } catch { throw fail('video_download_url_invalid', 502); }
  // The official Studio result was observed on v15-kling.klingai.com. Restrict
  // this initial integration to that evidenced CDN; new hosts require review.
  const cdn = url.hostname === 'v15-kling.klingai.com';
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || !cdn) throw fail('video_download_url_invalid', 502);
  return url;
}
function downloadMp4(value, {request, lookupImpl, timeoutMs, maxBytes}) {
  return new Promise((resolve, reject) => {
    let finished = false, activeRequest;
    const finish = (error, bytes) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      if (error) { activeRequest?.destroy(); reject(error); } else resolve(bytes);
    };
    const timer = setTimeout(() => finish(fail('video_download_timeout', 504)), timeoutMs);
    function visit(rawUrl, redirects = 0) {
      let url; try { url = downloadTarget(rawUrl); } catch (error) { finish(error); return; }
      let redirected = false;
      try {
        const req = request(url.href, {agent: false, family: 4, headers: {Accept: 'video/mp4,application/octet-stream'},
          lookup(host, options, callback) {
            lookupImpl(host, {family: 4, all: true}).then(addresses => {
              if (!addresses.length || addresses.some(item => item.family !== 4 || !publicImageAddress(item.address))) return callback(fail('video_download_address_blocked', 502));
              if (options.all) callback(null, [addresses[0]]); else callback(null, addresses[0].address, 4);
            }, () => callback(fail('video_download_dns_failed', 502)));
          }
        }, response => {
          if (finished) { response.destroy(); return; }
          if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
            const target = response.headers.location; redirected = true; response.destroy();
            if (redirects >= 2) { finish(fail('video_download_redirect_blocked', 502)); return; }
            visit(target, redirects + 1); return;
          }
          if ([408, 429].includes(response.statusCode) || response.statusCode >= 500) {
            response.destroy(); finish(fail('video_download_http_temporary', 502)); return;
          }
          const type = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
          const declared = response.headers['content-length'];
          if (response.statusCode !== 200 || !['video/mp4', 'application/octet-stream'].includes(type) || declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
            response.destroy(); finish(fail('video_download_response_invalid', 502)); return;
          }
          const chunks = []; let length = 0;
          response.on('data', chunk => {
            length += chunk.length;
            if (length > maxBytes) { response.destroy(); finish(fail('video_download_too_large', 502)); return; }
            chunks.push(chunk);
          });
          response.on('error', () => finish(fail('video_download_incomplete', 502)));
          response.on('aborted', () => finish(fail('video_download_incomplete', 502)));
          response.on('end', () => {
            if (declared !== undefined && length !== Number(declared)) { finish(fail('video_download_incomplete', 502)); return; }
            const bytes = Buffer.concat(chunks);
            if (bytes.length < 12 || bytes.toString('ascii', 4, 8) !== 'ftyp') { finish(fail('video_download_not_mp4', 502)); return; }
            finish(null, bytes);
          });
        });
        activeRequest = req;
        req.on('error', error => { if (!redirected) finish(fail(['video_download_address_blocked', 'video_download_dns_failed'].includes(error?.code) ? error.code : 'video_download_failed', 502)); });
      } catch { finish(fail('video_download_failed', 502)); }
    }
    visit(value);
  });
}

export function createKlingStudioProvider({env = process.env, observer = null, execFileImpl = execFile,
  resolveCliImpl = officialCli, downloadRequest = https.get, lookupImpl = lookup,
  createTimeoutMs = KLING_STUDIO_DEFAULTS.createTimeoutMs, pollTimeoutMs = KLING_STUDIO_DEFAULTS.pollTimeoutMs,
  lockTimeoutMs = KLING_STUDIO_DEFAULTS.lockTimeoutMs, maxStdoutBytes = MAX_JSON_BYTES,
  downloadTimeoutMs = KLING_STUDIO_DEFAULTS.downloadTimeoutMs, maxDownloadBytes = KLING_STUDIO_DEFAULTS.maxDownloadBytes} = {}) {
  const config = resolveKlingStudioConfig(env), home = clean(env.KLING_HOME);
  const observe = (run, id = 'kling_studio_video') => observer ? observer.run(id, run) : run();
  const ready = () => { if (!config.videoEnabled) throw fail(config.error); };
  function command(directory, name, args = [], paid = false) {
    let cli; try { cli = resolveCliImpl(); } catch { throw fail('kling_studio_runtime_unavailable'); }
    if (typeof cli !== 'string' || !isAbsolute(cli)) throw fail('kling_studio_runtime_unavailable');
    return new Promise((resolve, reject) => {
      try { execFileImpl(process.execPath, [cli, name, ...args, '--quiet'], {
        cwd: directory, env: childEnvironment(env, directory), shell: false, windowsHide: true,
        encoding: 'utf8', timeout: paid ? createTimeoutMs : pollTimeoutMs, killSignal: 'SIGKILL', maxBuffer: maxStdoutBytes
      }, (error, stdout) => {
        const uncertain = code => Object.assign(fail(code, 502), paid ? {submissionUncertain: true} : {});
        if (error) {
          if (error.code === 'ENOENT' || error.code === 'EACCES') { reject(fail('kling_studio_runtime_unavailable')); return; }
          const code = error.killed || error.signal ? 'kling_studio_timeout' : error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'kling_studio_response_too_large' : 'kling_studio_command_failed';
          reject(uncertain(code)); return;
        }
        if (typeof stdout !== 'string' || Buffer.byteLength(stdout) > maxStdoutBytes) { reject(uncertain('kling_studio_response_too_large')); return; }
        let raw; try { raw = JSON.parse(stdout); } catch { reject(uncertain('kling_studio_response_invalid')); return; }
        if (!object(raw) || raw.ok !== true || !object(raw.body)) { reject(uncertain('kling_studio_response_invalid')); return; }
        resolve(raw.body);
      }); } catch { reject(fail('kling_studio_runtime_unavailable')); }
    });
  }
  const locked = (run, id) => { ready(); return observe(() => withAccountLock(home, lockTimeoutMs, run), id); };
  function validateJob(job) {
    if (job?.provider !== 'kling_studio') throw fail('ai_video_provider_mismatch', 409);
    ready();
    const url = klingStudioPollingUrl(job.pollingUrl, job.jobId);
    if (!url) throw fail('ai_video_receipt_invalid', 409);
    return url.slice(ENDPOINT.length + 1, ENDPOINT.length + 65);
  }
  async function current(directory, expected = '') {
    const raw = await command(directory, 'who_am_i');
    const user = identity(raw);
    if (expected && user.binding !== expected) throw fail('kling_studio_account_mismatch', 409);
    return {raw, user};
  }
  const response = data => ({provider: 'kling_studio', headers: new Headers(), data});
  async function getAccountCapabilities() {
    return locked(async directory => {
      const {raw, user} = await current(directory);
      return {provider: 'kling_studio', connected: true, ...capabilities(raw), ...account(await command(directory, 'account'), user)};
    }, 'kling_studio_account');
  }
  async function createVideo(options = {}) {
    ready();
    if (!object(options)) throw fail('ai_media_video_options_invalid', 400);
    const {prompt, model = MODEL, durationSeconds = 5, aspectRatio = '9:16', generateAudio = false,
      resolution = '1080p', imageCount = 1, preferMultiShots = false} = options;
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8000 || /^-/.test(prompt.trim()) || prompt.includes('\0')) throw fail('ai_media_prompt_invalid', 400);
    if (model !== MODEL) throw fail('ai_media_model_invalid', 400);
    if (!DURATIONS.includes(durationSeconds) || !RATIOS.includes(aspectRatio) || resolution !== '1080p' || generateAudio !== false || imageCount !== 1 || preferMultiShots !== false) throw fail('ai_media_video_options_invalid', 400);
    if (['image', 'images', 'imageUrl', 'imagePath', 'inputImage', 'inputs', 'files', 'video', 'tailImage', 'elements'].some(key => Object.hasOwn(options, key))) throw fail('kling_studio_text_only', 400);
    if (Object.keys(options).some(key => !['prompt', 'model', 'durationSeconds', 'aspectRatio', 'generateAudio', 'resolution', 'imageCount', 'preferMultiShots', 'manual'].includes(key))) throw fail('ai_media_video_options_invalid', 400);
    return locked(async directory => {
      const {raw, user} = await current(directory);
      const supported = capabilities(raw);
      if (!supported.durationOptions.includes(durationSeconds) || !supported.aspectRatioOptions.includes(aspectRatio)) throw fail('kling_studio_capabilities_unavailable');
      const balance = account(await command(directory, 'account'), user);
      if (balance.availableCredits < durationSeconds * KLING_STUDIO_DEFAULTS.estimatedCreditsPerSecond) throw fail('kling_studio_credits_insufficient', 402);
      const body = await command(directory, 'text_to_video', ['--model', MODEL, '--duration', String(durationSeconds),
        '--aspect_ratio', aspectRatio, '--resolution', '1080p', '--enable_audio', 'false', '--imageCount', '1', '--prefer_multi_shots', 'false', prompt.trim()], true);
      const id = generationId(body);
      if (!id) throw Object.assign(fail('ai_video_receipt_invalid', 502), {submissionUncertain: true});
      return response({id, polling_url: marker(id, user.binding), status: 'queued'});
    });
  }
  async function getVideo(job) {
    const binding = validateJob(job);
    return locked(async directory => {
      await current(directory, binding);
      const body = await command(directory, 'query_tasks', [job.jobId]);
      // Some query responses omit the ID; if supplied, it must match exactly.
      if ((body.generationId !== undefined || body.generation_id !== undefined) && generationId(body) !== job.jobId) throw fail('ai_video_receipt_invalid', 502);
      const base = {id: job.jobId, polling_url: job.pollingUrl};
      const status = clean(body.status).toLowerCase();
      if (['submitted', 'pending', 'queuing', 'queueing', 'processing', 'running'].includes(status)) return response({...base, status: 'processing'});
      if (['failed', 'failure', 'cancelled', 'canceled', 'expired'].includes(status)) return response({...base, status: 'failed', error: {code: 'kling_studio_generation_failed'}});
      if (!['succeed', 'succeeded', 'success', 'completed', 'partial_completed'].includes(status) || !Array.isArray(body.works) || body.works.length !== 1) throw fail('kling_studio_response_invalid', 502);
      const work = body.works[0];
      if (!object(work) || work.status !== undefined && !['succeed', 'succeeded', 'success', 'completed'].includes(clean(work.status).toLowerCase()) || ['contentType', 'content_type'].some(key => work[key] !== undefined && work[key] !== 'video')) throw fail('kling_studio_response_invalid', 502);
      const value = work.url_without_watermark || work.urlWithoutWatermark || work.url;
      const url = downloadTarget(value).href;
      return response({...base, status: 'completed', content_url: url});
    });
  }
  async function downloadVideo(data, job) {
    const binding = validateJob(job);
    if (data?.id !== job.jobId || data?.polling_url !== job.pollingUrl || data?.status !== 'completed') throw fail('ai_video_receipt_invalid', 409);
    const url = downloadTarget(data.content_url).href;
    // Check current ownership before downloading; CDN requests carry no tokens.
    await locked(directory => current(directory, binding));
    return observe(() => downloadMp4(url, {request: downloadRequest, lookupImpl, timeoutMs: downloadTimeoutMs, maxBytes: maxDownloadBytes}));
  }
  return Object.freeze({config, createVideo, getVideo, downloadVideo, getAccountCapabilities});
}
