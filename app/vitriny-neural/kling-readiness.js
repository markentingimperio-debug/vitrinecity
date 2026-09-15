import {KLING_READINESS_VERSION,assertKlingReadiness} from '../public/neural-kling-contract.js';

// Official free read endpoint, QPS <= 1; remaining quantities may lag 12 hours.
// https://kling.ai/document-api/api/assets/account-usage
const ENDPOINT = 'https://api-singapore.klingai.com/account/costs';
const LIMIT = 262144;
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const discard = response => { try { Promise.resolve(response?.body?.cancel()).catch(() => {}); } catch {} };

/** One private API key, never Studio credentials. No purchases, generation,
 * balances, customer records, environment mutation, logging or model inference.
 * Single-flight and a 60s cache bound queries for this app process. Multiple
 * app processes sharing a key must share a rate limiter before scaling out. */
export function createKlingReadiness({env = process.env, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 10000} = {}) {
  if (typeof fetchImpl !== 'function' || typeof now !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new TypeError('kling_readiness_config_invalid');
  const key = typeof env.KLING_API_KEY === 'string' ? env.KLING_API_KEY.trim() : '';
  const configured = Boolean(key), validKey = /^[\x21-\x7e]{1,4096}$/.test(key);
  let latest = null, flight = null, validUntil = 0;
  const clock = () => { const time = now(); if (!Number.isSafeInteger(time) || time < 3600000 || time > 8640000000000000) throw new TypeError('kling_readiness_clock_invalid'); return time; };
  const result = (stage, checkedAt = null, packageCount = null) => Object.freeze(assertKlingReadiness({
    version: KLING_READINESS_VERSION, provider: 'kling_api', stage, configured, checkedAt,
    generationEnabled: false, customerBillingEnabled: false, studioCreditsShared: false,
    balanceFreshness: 'up_to_12_hours', packageCount
  }));
  function status() {
    if (!configured) return result('credentials_missing');
    return latest && clock() < validUntil ? latest : result('not_checked');
  }
  async function check() {
    if (!configured) return status();
    if (flight) return flight;
    const started = clock();
    if (latest && started < validUntil) return latest;
    const checkedAt = new Date(started).toISOString();
    if (!validKey) { latest = result('credentials_rejected', checkedAt); validUntil = started + 60000; return latest; }
    const controller = new AbortController(); let reader, timer;
    const unavailable = () => result('unavailable', checkedAt);
    const read = async () => {
      let response;
      try {
        const url = `${ENDPOINT}?start_time=${started - 3600000}&end_time=${started}`;
        response = await fetchImpl(url, {method: 'GET', redirect: 'error', signal: controller.signal,
          headers: {Authorization: `Bearer ${key}`, Accept: 'application/json', 'Content-Type': 'application/json'}});
        if (controller.signal.aborted) return unavailable();
        if ([401,403].includes(response.status)) return result('credentials_rejected', checkedAt);
        if (response.redirected || !response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) return unavailable();
        const length = response.headers.get('content-length');
        if (length !== null && (!/^\d+$/.test(length) || BigInt(length) > BigInt(LIMIT))) return unavailable();
        reader = response.body?.getReader(); if (!reader) return unavailable();
        const chunks = []; let bytes = 0;
        for (;;) {
          const part = await reader.read();
          if (controller.signal.aborted) return unavailable();
          if (part.done) break;
          if (!(part.value instanceof Uint8Array)) return unavailable();
          bytes += part.value.byteLength; if (bytes > LIMIT) return unavailable();
          chunks.push(part.value);
        }
        const body = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(Buffer.concat(chunks, bytes)));
        if (!plain(body) || body.code !== 0 || !plain(body.data) || body.data.code !== 0) return unavailable();
        if (!Object.hasOwn(body.data,'resource_pack_subscribe_infos')) return result('access_verified', checkedAt);
        const packs = body.data.resource_pack_subscribe_infos;
        if (!Array.isArray(packs) || packs.length > 10000 || !packs.every(plain)) return unavailable();
        return result('access_verified', checkedAt, packs.length);
      } catch { return unavailable(); }
      finally { try { if (reader) Promise.resolve(reader.cancel()).catch(() => {}); else discard(response); } catch {} }
    };
    const timeout = new Promise(resolve => { timer = setTimeout(() => {
      controller.abort(); try { Promise.resolve(reader?.cancel()).catch(() => {}); } catch {}
      resolve(unavailable());
    }, timeoutMs); });
    flight = Promise.race([read(), timeout]).then(value => {
      latest = value; validUntil = clock() + 60000; return value;
    }).finally(() => { clearTimeout(timer); flight = null; });
    return flight;
  }
  return Object.freeze({status, check});
}

/** Admin-only endpoint. GET never contacts Kling. POST checks existing access
 * and accepts NO key, cost, URL, prompt, provider override or customer payload. */
export function mountKlingReadinessApi({app, requireAdmin, sameOriginOnly, readiness} = {}) {
  if (!app || typeof requireAdmin !== 'function' || typeof sameOriginOnly !== 'function' || typeof readiness?.status !== 'function' || typeof readiness?.check !== 'function') throw new TypeError('kling_readiness_guards_required');
  const base = '/api/admin/vitriny-neural/kling';
  const headers = (_req,res,next) => { res.set('Cache-Control','no-store'); res.set('X-Content-Type-Options','nosniff'); next(); };
  const reply = method => async (_req,res) => {
    try { return res.json({ok:true,status:assertKlingReadiness(await readiness[method]())}); }
    catch { return res.status(503).json({ok:false,error:'Não foi possível conferir a integração Kling agora.'}); }
  };
  app.get(base + '/status', headers, requireAdmin, reply('status'));
  app.post(base + '/check', headers, requireAdmin, sameOriginOnly, (req,res,next) => {
    if (req.get('x-neural-request') !== '1' || !req.is('application/json') || !plain(req.body) || Object.keys(req.body).length || Object.keys(req.query || {}).length) return res.status(400).json({ok:false,error:'A conferência não aceita dados, chaves ou parâmetros.'});
    next();
  }, reply('check'));
}
