import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {publicImageAddress} from './catalog-product-images.js';

// REST schema and model capabilities: https://ai.google.dev/gemini-api/docs/veo
// File download: https://github.com/googleapis/js-genai/blob/main/src/node/_node_downloader.ts
const ORIGIN = 'https://generativelanguage.googleapis.com';
const BASE = ORIGIN + '/v1beta';
const MODELS = Object.freeze(['veo-3.1-lite-generate-preview', 'veo-3.1-fast-generate-preview', 'veo-3.1-generate-preview']);
const DURATIONS = Object.freeze([4, 6, 8]);
const RATIOS = Object.freeze(['9:16', '16:9']);
const MAX_JSON_BYTES = 1024 * 1024;
const clean = value => String(value || '').trim();
const fail = (code, status = 503) => Object.assign(new Error(code), {code, status});

/** Configuration does not imply verified billing, quota or model access. */
export function resolveGoogleVideoConfig(env = process.env) {
  const model = clean(env.GOOGLE_VIDEO_MODEL) || MODELS[0];
  const valid = MODELS.includes(model);
  const error = !valid ? 'google_video_model_invalid' : !clean(env.GEMINI_API_KEY) ? 'google_video_key_missing' : '';
  return Object.freeze({provider: 'google', configured: !error, videoConfigured: !error, videoEnabled: !error,
    videoModel: valid ? model : '', videoOptions: Object.freeze(valid ? [model, ...MODELS.filter(item => item !== model)] : []),
    durationOptions: DURATIONS, aspectRatioOptions: RATIOS, resolution: '720p', audioAlwaysOn: true,
    error, videoReason: error ? 'A geração pelo Google Veo ainda não está configurada.' : ''});
}

export function googleVideoJobId(value) {
  if (typeof value !== 'string') return '';
  const parts = /^models\/([^/]+)\/operations\/([A-Za-z0-9][A-Za-z0-9_-]{0,159})$/.exec(value);
  return parts && MODELS.includes(parts[1]) ? value : '';
}

export function googleVideoPollingUrl(value, jobId) {
  if (!googleVideoJobId(jobId) || typeof value !== 'string' || /[\\\s%]/.test(value)) return '';
  const expected = `${BASE}/${jobId}`;
  // Exact equality also rejects credentials, query strings, redirects and normalized traversal.
  return value === expected || value === `/v1beta/${jobId}` ? expected : '';
}

export function googleVideoReceipt(data) {
  const jobId = googleVideoJobId(data?.id);
  return {jobId, pollingUrl: googleVideoPollingUrl(data?.polling_url, jobId)};
}

function fileUrl(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\\\s]/.test(value)) return '';
  const prefix = ORIGIN + '/v1beta/files/';
  if (!value.startsWith(prefix)) return '';
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}:download\?alt=media$/.test(value.slice(prefix.length)) ? value : '';
}

function operationData(raw, expectedId = '', creating = false) {
  const id = googleVideoJobId(raw?.name);
  if (!id || expectedId && id !== expectedId) throw fail('ai_video_receipt_invalid', 502);
  const base = {id, polling_url: `${BASE}/${id}`};
  // Persist a valid creation receipt first, even if the first response already contains a result.
  // The next single GET validates completion; a paid POST must never be repeated to recover it.
  if (creating) return {...base, status: 'queued'};
  if (raw.done !== undefined && typeof raw.done !== 'boolean') throw fail('google_video_response_invalid', 502);
  if (!raw.done) {
    if (raw.error || raw.response) throw fail('google_video_response_invalid', 502);
    return {...base, status: 'processing'};
  }
  if (raw.error) return {...base, status: 'failed', error: {code: 'google_video_generation_failed'}};
  const result = raw.response?.generateVideoResponse;
  if (Number(result?.raiMediaFilteredCount) > 0 && !result?.generatedSamples?.length) {
    return {...base, status: 'failed', error: {code: 'google_video_generation_filtered'}};
  }
  const video = result?.generatedSamples?.[0]?.video;
  const uri = fileUrl(video?.uri);
  if (!uri || result.generatedSamples.length !== 1 || video.mimeType && video.mimeType !== 'video/mp4') throw fail('google_video_response_invalid', 502);
  return {...base, status: 'completed', content_url: uri};
}

function downloadTarget(value, initial) {
  if (initial) {
    if (!fileUrl(value)) throw fail('video_download_url_invalid', 502);
    return new URL(value);
  }
  if (typeof value !== 'string' || value.length > 8192 || /[\\\s]/.test(value)) throw fail('video_download_url_invalid', 502);
  let url;
  try { url = new URL(value); } catch { throw fail('video_download_url_invalid', 502); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) throw fail('video_download_url_invalid', 502);
  // Redirects are a separate unauthenticated request to a Google media CDN only.
  const cdn = url.hostname === 'storage.googleapis.com' || /^(?:[a-z0-9-]+\.)+(?:googleusercontent\.com|storage\.googleapis\.com)$/.test(url.hostname);
  if (!cdn || [...url.searchParams.keys()].some(key => /^(?:key|api[_-]?key|x-goog-api-key)$/i.test(key))) throw fail('video_download_redirect_blocked', 502);
  return url;
}

/** HTTPS transport pins each download/redirect to a checked public IPv4 address.
 * No automatic redirects, forwarded API keys, cookies, authorization or paid retries. */
function downloadMp4(value, {apiKey, request, lookupImpl, timeoutMs, maxBytes}) {
  return new Promise((resolve, reject) => {
    let finished = false, activeRequest;
    const finish = (error, bytes) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      if (error) { activeRequest?.destroy(); reject(error); } else resolve(bytes);
    };
    const timer = setTimeout(() => finish(fail('video_download_timeout', 504)), timeoutMs);
    function visit(rawUrl, redirects = 0) {
      let url;
      try { url = downloadTarget(rawUrl, redirects === 0); } catch (error) { finish(error); return; }
      const headers = {Accept: 'video/mp4,application/octet-stream'};
      if (redirects === 0) headers['x-goog-api-key'] = apiKey;
      let redirected = false;
      try {
        const req = request(url.href, {agent: false, family: 4, headers,
          lookup(host, options, callback) {
            lookupImpl(host, {family: 4, all: true}).then(addresses => {
              if (!addresses.length || addresses.some(item => item.family !== 4 || !publicImageAddress(item.address))) return callback(fail('video_download_address_blocked', 502));
              if (options.all) callback(null, [addresses[0]]); else callback(null, addresses[0].address, 4);
            }, () => callback(fail('video_download_dns_failed', 502)));
          }
        }, response => {
          if (finished) { response.destroy(); return; }
          if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
            const destination = response.headers.location;
            redirected = true;
            response.destroy();
            if (redirects >= 2) { finish(fail('video_download_redirect_blocked', 502)); return; }
            visit(destination, redirects + 1); return;
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
        req.on('error', error => {
          // Destroying the consumed redirect response may close that socket after
          // the next request starts. Its late error cannot cancel the new socket.
          if (!redirected) finish(fail(['video_download_address_blocked', 'video_download_dns_failed'].includes(error?.code) ? error.code : 'video_download_failed', 502));
        });
      } catch { finish(fail('video_download_failed', 502)); }
    }
    visit(value);
  });
}

/** A POST is attempted only once. Caller owns durable job claims/idempotency and
 * must preserve an uncertain submission instead of retrying createVideo. */
export function createGoogleVideoProvider({env = process.env, fetchImpl = globalThis.fetch, observer = null,
  downloadRequest = https.get, lookupImpl = lookup, createTimeoutMs = 60000, pollTimeoutMs = 30000,
  downloadTimeoutMs = 120000, maxDownloadBytes = 250 * 1024 * 1024} = {}) {
  const config = resolveGoogleVideoConfig(env);
  const apiKey = clean(env.GEMINI_API_KEY);
  function ready() { if (!config.videoEnabled) throw fail(config.error); }
  const observe = run => observer ? observer.run('google_video', run) : run();
  async function requestJson(url, {method, body}, validate) {
    ready();
    const signal = AbortSignal.timeout(method === 'POST' ? createTimeoutMs : pollTimeoutMs);
    return observe(async () => {
      try {
        let response;
        try {
          response = await fetchImpl(url, {method, headers: {'x-goog-api-key': apiKey, 'Content-Type': 'application/json'},
            ...(body === undefined ? {} : {body: JSON.stringify(body)}), redirect: 'error', signal});
        } catch { throw fail(signal.aborted ? 'google_video_timeout' : 'google_video_network_error', signal.aborted ? 504 : 502); }
        if (!response.ok) { await response.body?.cancel?.().catch(() => {}); throw fail('google_video_http_error', response.status); }
        if (!/^application\/json(?:\s*;|$)/i.test(clean(response.headers.get('content-type'))) || Number(response.headers.get('content-length')) > MAX_JSON_BYTES) {
          await response.body?.cancel?.().catch(() => {}); throw fail('google_video_response_invalid', 502);
        }
        const reader = response.body?.getReader();
        if (!reader) throw fail('google_video_response_invalid', 502);
        const chunks = []; let length = 0;
        try {
          while (true) {
            const {done, value} = await reader.read(); if (done) break;
            length += value.byteLength;
            if (length > MAX_JSON_BYTES) throw fail('google_video_response_too_large', 502);
            chunks.push(Buffer.from(value));
          }
          let raw;
          try { raw = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('google_video_response_invalid', 502); }
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw fail('google_video_response_invalid', 502);
          return {provider: 'google', headers: response.headers, data: validate(raw)};
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      } catch (error) {
        const safe = /^(?:google_video_|ai_video_)/.test(String(error?.code)) ? error : fail(signal.aborted ? 'google_video_timeout' : 'google_video_response_invalid', signal.aborted ? 504 : 502);
        if (method === 'POST') safe.submissionUncertain = safe.status >= 500;
        throw safe;
      }
    });
  }
  function jobUrl(job) {
    if (job?.provider !== 'google') throw fail('ai_video_provider_mismatch', 409);
    ready();
    const url = googleVideoPollingUrl(job.pollingUrl, job.jobId);
    if (!url) throw fail('ai_video_receipt_invalid', 409);
    return url;
  }
  async function createVideo({prompt, model = config.videoModel, durationSeconds = 4, aspectRatio = '9:16', generateAudio = true, resolution = '720p'} = {}) {
    ready();
    if (!MODELS.includes(model)) throw fail('ai_media_model_invalid', 400);
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8000) throw fail('ai_media_prompt_invalid', 400);
    if (!DURATIONS.includes(durationSeconds) || !RATIOS.includes(aspectRatio) || resolution !== '720p' || generateAudio !== true) throw fail('ai_media_video_options_invalid', 400);
    return requestJson(`${BASE}/models/${model}:predictLongRunning`, {method: 'POST', body: {
      instances: [{prompt: prompt.trim()}], parameters: {durationSeconds, aspectRatio, resolution: '720p', numberOfVideos: 1}
    }}, raw => {
      const data = operationData(raw, '', true);
      if (!data.id.startsWith(`models/${model}/operations/`)) throw fail('ai_video_receipt_invalid', 502);
      return data;
    });
  }
  async function getVideo(job) {
    return requestJson(jobUrl(job), {method: 'GET'}, raw => operationData(raw, job.jobId));
  }
  async function downloadVideo(data, job) {
    jobUrl(job);
    if (data?.id !== job.jobId || data?.status !== 'completed' || !fileUrl(data.content_url)) throw fail('ai_video_receipt_invalid', 409);
    return observe(() => downloadMp4(data.content_url, {apiKey, request: downloadRequest, lookupImpl,
      timeoutMs: downloadTimeoutMs, maxBytes: maxDownloadBytes}));
  }
  return Object.freeze({config, createVideo, getVideo, downloadVideo});
}
