import { createHash } from 'node:crypto';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MINUTE = 60000;
const DAY = 24 * 60 * MINUTE;
const CACHE_TTL = 10 * MINUTE;
const FAILURE_TTL = 30000;
const MAX_CACHE = 100;
const MAX_VISITORS = 5000;
const MAX_REQUEST_BYTES = 32768;
const REQUEST_TIMEOUT = 8000;

const result = (id, reason, status = 200, retryAfter = 0) => ({
  body: { available: reason === 'eligible', reason, provider: 'youtube', id },
  status,
  retryAfter
});

async function limitedJson(response) {
  const length = Number(response.headers?.get('content-length'));
  const type = String(response.headers?.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (length > MAX_REQUEST_BYTES || type !== 'application/json' || !response.body?.getReader) {
    await response.body?.cancel().catch(() => {});
    throw new Error('invalid_provider_response');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new Error('invalid_provider_response');
      }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    reader.releaseLock();
  }
}

function videoDecision(data, id) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.items) || data.items.length > 1) {
    return result(id, 'unavailable', 503, 30);
  }
  if (!data.items.length) return result(id, 'not_found');
  const video = data.items[0];
  if (video?.id !== id || !video.status || typeof video.status !== 'object' || Array.isArray(video.status)) {
    return result(id, 'unavailable', 503, 30);
  }
  // Do not infer an audience from absent fields or from selfDeclaredMadeForKids.
  if (video.status.madeForKids === true) return result(id, 'made_for_kids');
  if (video.status.madeForKids !== false) return result(id, 'audience_unknown');
  if (video.status.embeddable !== true) return result(id, 'not_embeddable');
  return result(id, 'eligible');
}

/**
 * Public, read-only eligibility check. No content, API key, query history, or raw
 * provider errors are returned or logged. This is not a playback guarantee:
 * claims, region restrictions, or later changes can still block the player.
 * The 100-attempt UTC daily guard is shared by visitors in this process only;
 * it resets on restart and is not the provider's billing or project quota.
 */
export function setupSearchVideoEligibility(app, {
  getEnv = () => process.env,
  fetchImpl = fetch,
  now = Date.now
} = {}) {
  const cache = new Map();
  const pending = new Map();
  const visitors = new Map();
  let keyFingerprint = '';
  let quotaDay = Math.floor(now() / DAY);
  let attempts = 0;

  function remember(id, value) {
    const ttl = value.status >= 400 ? FAILURE_TTL : CACHE_TTL;
    if (cache.size >= MAX_CACHE && !cache.has(id)) cache.delete(cache.keys().next().value);
    cache.set(id, { value, until: now() + ttl });
    return value;
  }

  function gate(req, id) {
    const time = now();
    for (const [key, entry] of visitors) if (entry.until <= time) visitors.delete(key);
    // Keep only ephemeral hashed IP keys, consistent with the metasearch gate.
    const key = createHash('sha256').update(String(req.ip || req.socket?.remoteAddress || 'unknown')).digest('hex');
    const entry = visitors.get(key) || { count: 0, until: time + MINUTE };
    if (entry.count >= 15 || (visitors.size >= MAX_VISITORS && !visitors.has(key))) {
      return result(id, 'rate_limited', 429, Math.max(1, Math.ceil((entry.until - time) / 1000)));
    }
    entry.count++;
    visitors.set(key, entry);
    return null;
  }

  async function lookup(id, apiKey) {
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.search = new URLSearchParams({ part: 'status', id, key: apiKey }).toString();
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT)
      });
      const data = await limitedJson(response);
      if (!response.ok) {
        const errors = Array.isArray(data?.error?.errors) ? data.error.errors.slice(0, 10) : [];
        if ((response.status === 403 || response.status === 429) && errors.some(error =>
          ['quotaExceeded', 'dailyLimitExceeded'].includes(error?.reason))) {
          return result(id, 'quota', 429, 30);
        }
        return result(id, 'unavailable', 503, 30);
      }
      return videoDecision(data, id);
    } catch {
      return result(id, 'unavailable', 503, 30);
    }
  }

  async function check(id) {
    let apiKey;
    try { apiKey = getEnv()?.YOUTUBE_API_KEY; } catch { return result(id, 'unavailable', 503, 30); }
    apiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!apiKey || apiKey.length > 256 || /[\r\n]/.test(apiKey)) {
      cache.clear();
      keyFingerprint = '';
      return result(id, 'not_configured', 503, 30);
    }
    const fingerprint = createHash('sha256').update(apiKey).digest('hex');
    if (keyFingerprint !== fingerprint) { cache.clear(); keyFingerprint = fingerprint; }
    const time = now();
    for (const [key, entry] of cache) if (entry.until <= time) cache.delete(key);
    if (cache.has(id)) return cache.get(id).value;
    if (pending.has(id)) return pending.get(id);
    if (pending.size >= 2) return result(id, 'busy', 429, 8);
    const day = Math.floor(time / DAY);
    if (quotaDay !== day) { quotaDay = day; attempts = 0; }
    if (attempts >= 100) return result(id, 'quota', 429, Math.max(1, Math.ceil(((day + 1) * DAY - time) / 1000)));

    // Reserve before any await. Failed/aborted attempts also consume the guard.
    attempts++;
    const promise = lookup(id, apiKey).then(value => {
      // A runtime configuration change must not reuse a decision from an old key.
      if (keyFingerprint !== fingerprint) return result(id, 'unavailable', 503, 30);
      return remember(id, value);
    }).finally(() => pending.delete(id));
    pending.set(id, promise);
    return promise;
  }

  app.get('/api/search/video-eligibility', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    const id = typeof req.query.id === 'string' && VIDEO_ID.test(req.query.id) ? req.query.id : '';
    const invalid = req.query.provider !== 'youtube' || !id ||
      Object.keys(req.query).some(key => !['provider', 'id'].includes(key));
    let value;
    if (invalid) value = result('', 'invalid_request', 400);
    else value = gate(req, id) || await check(id);
    if (value.retryAfter) res.set('Retry-After', String(value.retryAfter));
    res.status(value.status).json(value.body);
  });
}
