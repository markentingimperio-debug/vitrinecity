import {rasterSize} from './web-story-assets.js';
import {videoJobId, videoPollingUrl, downloadVideo as downloadProviderVideo} from './video-provider-receipts.js';

const OPENAI_ORIGIN = 'https://api.openai.com';
const OPENROUTER_ORIGIN = 'https://openrouter.ai';
// https://developers.openai.com/api/docs/guides/image-generation#customize-image-output
// All requested dimensions satisfy the documented 16px, ratio and pixel-count limits.
const IMAGE_MODELS = Object.freeze({
  openai: Object.freeze(['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']),
  openrouter: Object.freeze(['qwen/qwen-image-3', 'meta/muse-image', 'bytedance-seed/seedream-5-0-lite'])
});
const ROUTER_VIDEO_MODELS = Object.freeze(['google/veo-3.1-lite', 'alibaba/wan-3.0', 'bytedance/seedance-2.0-mini']);
const IMAGE_SIZES = Object.freeze({'1:1':'1024x1024', '4:5':'1024x1280', '9:16':'864x1536', '16:9':'1536x864', '2:3':'1024x1536', '3:2':'1536x1024'});
const MAX_RESPONSE_BYTES = 36 * 1024 * 1024;
const clean = value => String(value || '').trim();
const fail = (code, status = 503) => Object.assign(new Error(code), {code, status});
const validModel = value => /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(value);

// Official notice: https://developers.openai.com/api/docs/deprecations#2026-03-24-sora-2-video-generation-models-and-videos-api
// Do not build new paid generation on the retired Sora API or fall back to another provider.
export const OPENAI_VIDEO_UNAVAILABLE_REASON = 'Novos vídeos por IA estão indisponíveis. A API de vídeo Sora da OpenAI será encerrada em 24/09/2026, sem substituto indicado. Os vídeos existentes permanecem disponíveis.';

/** Safe for admin responses: contains no keys, account payloads or inferred credit balance. */
export function resolveMediaConfig(env = process.env) {
  const requested = clean(env.AI_MEDIA_PROVIDER).toLowerCase() || 'auto';
  const valid = ['auto', 'openai', 'openrouter'].includes(requested);
  const provider = valid ? (requested === 'auto' ? (clean(env.OPENROUTER_API_KEY) ? 'openrouter' : 'openai') : requested) : '';
  const key = clean(provider === 'openai' ? env.OPENAI_API_KEY : provider === 'openrouter' ? env.OPENROUTER_API_KEY : '');
  const imageModel = provider === 'openai' ? clean(env.OPENAI_IMAGE_MODEL) || 'gpt-image-2' : provider === 'openrouter' ? clean(env.OPENROUTER_IMAGE_MODEL) || IMAGE_MODELS.openrouter[0] : '';
  const videoModel = provider === 'openrouter' ? clean(env.OPENROUTER_VIDEO_MODEL) || ROUTER_VIDEO_MODELS[0] : '';
  const imageModelValid = validModel(imageModel) && (provider !== 'openai' || IMAGE_MODELS.openai.includes(imageModel));
  const error = !valid ? 'ai_media_provider_invalid' : !key ? 'ai_media_key_missing' : !imageModelValid ? 'ai_media_model_invalid' : '';
  const configured = !error;
  const videoEnabled = configured && provider === 'openrouter' && validModel(videoModel);
  return Object.freeze({provider, explicit: requested !== 'auto', configured, imageConfigured: configured,
    videoConfigured: videoEnabled, videoEnabled,
    videoReason: provider === 'openai' ? OPENAI_VIDEO_UNAVAILABLE_REASON : videoEnabled ? '' : 'A geração de vídeo ainda não está configurada.',
    imageModel: imageModelValid ? imageModel : '', videoModel: provider === 'openrouter' && validModel(videoModel) ? videoModel : '',
    imageOptions: Object.freeze(imageModelValid ? [...new Set([imageModel, ...IMAGE_MODELS[provider]])] : []),
    videoOptions: Object.freeze(provider === 'openrouter' && validModel(videoModel) ? [...new Set([videoModel, ...ROUTER_VIDEO_MODELS])] : []),
    error});
}

function imageData(data) {
  const raw = data?.data?.[0]?.b64_json || data?.images?.[0]?.b64_json || data?.data?.[0]?.image_url?.url || data?.images?.[0]?.image_url?.url;
  if (typeof raw !== 'string' || raw.length > 35 * 1024 * 1024) throw fail('ai_media_image_invalid', 502);
  const encoded = raw.replace(/^data:image\/(?:png|jpeg|webp);base64,/, '');
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw fail('ai_media_image_invalid', 502);
  const bytes = Buffer.from(encoded, 'base64');
  let size;
  try { size = rasterSize(bytes); } catch { throw fail('ai_media_image_invalid', 502); }
  if (bytes.length > 25 * 1024 * 1024 || Math.min(size.width, size.height) < 512 || size.width * size.height > 40000000) throw fail('ai_media_image_invalid', 502);
  return {data: [{b64_json: encoded}], ...(data.usage && typeof data.usage === 'object' ? {usage: data.usage} : {})};
}

/** One selected provider and one request. No retries, alternate provider, redirects or polling loops. */
export function createMediaProvider({env = process.env, fetchImpl = globalThis.fetch, observer = null, downloadImpl = downloadProviderVideo} = {}) {
  const config = resolveMediaConfig(env);
  const apiKey = clean(config.provider === 'openai' ? env.OPENAI_API_KEY : env.OPENROUTER_API_KEY);
  const origin = config.provider === 'openai' ? OPENAI_ORIGIN : OPENROUTER_ORIGIN;
  async function requestJson(url, {method, body}, timeoutMs, validate = data => data) {
    if (!config.configured) throw fail(config.error);
    if (new URL(url).origin !== origin) throw fail('ai_media_origin_mismatch', 400);
    const signal = AbortSignal.timeout(timeoutMs);
    const run = async () => {
      let response;
      try {
        response = await fetchImpl(url, {method, headers: {Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
          ...(body === undefined ? {} : {body: JSON.stringify(body)}), redirect: 'error', signal});
      } catch { throw fail(signal.aborted ? 'ai_media_timeout' : 'ai_media_network_error', signal.aborted ? 504 : 502); }
      if (!response.ok) { await response.body?.cancel?.().catch(() => {}); throw fail('ai_media_http_error', response.status); }
      if (!/^application\/json(?:\s*;|$)/i.test(clean(response.headers.get('content-type'))) || Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
        await response.body?.cancel?.().catch(() => {}); throw fail('ai_media_response_invalid', 502);
      }
      const reader = response.body?.getReader();
      if (!reader) throw fail('ai_media_response_invalid', 502);
      const chunks = []; let length = 0;
      try {
        while (true) {
          const {done, value} = await reader.read(); if (done) break;
          length += value.byteLength; if (length > MAX_RESPONSE_BYTES) throw fail('ai_media_response_too_large', 502);
          chunks.push(Buffer.from(value));
        }
        let data;
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('ai_media_response_invalid', 502); }
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw fail('ai_media_response_invalid', 502);
        return {data: validate(data), headers: response.headers, provider: config.provider};
      } catch (error) {
        if (/^ai_(?:media|video)_/.test(String(error?.code))) throw error;
        throw fail(signal.aborted ? 'ai_media_timeout' : 'ai_media_response_invalid', signal.aborted ? 504 : 502);
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    };
    return observer ? observer.run(`${config.provider}_media`, run) : run();
  }
  function modelFor(requested, type) {
    const value = clean(requested) || config[type + 'Model'];
    if (!config[type + 'Options'].includes(value)) throw fail('ai_media_model_invalid', 400);
    return value;
  }
  function promptFor(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 8000) throw fail('ai_media_prompt_invalid', 400);
    return value.trim();
  }
  function videoOrigin({provider, jobId, pollingUrl} = {}) {
    if (provider !== config.provider) throw fail('ai_video_provider_mismatch', 409);
    if (!config.videoEnabled) throw fail('ai_video_unavailable');
    if (!videoJobId(jobId) || !videoPollingUrl(pollingUrl, jobId)) throw fail('ai_video_receipt_invalid', 409);
    return videoPollingUrl(pollingUrl, jobId);
  }
  async function requestImage({prompt, model, aspectRatio = '1:1', n = 1} = {}) {
    if (!config.imageConfigured) throw fail(config.error);
    if (!Object.hasOwn(IMAGE_SIZES, aspectRatio) || n !== 1) throw fail('ai_media_image_options_invalid', 400);
    const body = {model: modelFor(model, 'image'), prompt: promptFor(prompt), n: 1,
      ...(config.provider === 'openai' ? {size: IMAGE_SIZES[aspectRatio], quality: 'medium', output_format: 'png'} : {aspect_ratio: aspectRatio})};
    return requestJson(origin + (config.provider === 'openai' ? '/v1/images/generations' : '/api/v1/images'), {method: 'POST', body}, 120000, imageData);
  }
  async function createVideo({prompt, model, durationSeconds = 4, aspectRatio = '9:16', generateAudio = false} = {}) {
    if (!config.videoEnabled) throw fail('ai_video_unavailable');
    if (!['1:1', '9:16', '16:9'].includes(aspectRatio) || !Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 120) throw fail('ai_media_video_options_invalid', 400);
    return requestJson(OPENROUTER_ORIGIN + '/api/v1/videos', {method: 'POST', body: {model: modelFor(model, 'video'), prompt: promptFor(prompt),
      duration: durationSeconds, aspect_ratio: aspectRatio, resolution: '720p', generate_audio: Boolean(generateAudio)}}, 60000);
  }
  async function getVideo(job) {
    const url = videoOrigin(job);
    return requestJson(url, {method: 'GET'}, 30000, data => {
      if (data.id !== job.jobId) throw fail('ai_video_receipt_invalid', 502);
      return data;
    });
  }
  async function downloadVideo(data, job) {
    videoOrigin(job);
    if (data?.id !== job.jobId) throw fail('ai_video_receipt_invalid', 502);
    return downloadImpl(data, job.jobId, {apiKey});
  }
  return Object.freeze({config, requestImage, createVideo, getVideo, downloadVideo});
}
