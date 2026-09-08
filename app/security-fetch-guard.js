const nativeFetch = globalThis.fetch;
const allowedAiHosts = new Set(['openrouter.ai', 'api.openai.com']);

function aiSecret() {
  return String(process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '').trim();
}

function requestUrl(input) {
  try {
    if (typeof input === 'string' || input instanceof URL) return new URL(input);
    if (input && typeof input.url === 'string') return new URL(input.url);
  } catch {}
  return null;
}

function guardedHeaders(input, init) {
  const inherited = input instanceof Request ? input.headers : undefined;
  return new Headers(init?.headers || inherited || undefined);
}

if (typeof nativeFetch !== 'function') throw new Error('global fetch unavailable');

globalThis.fetch = function guardedFetch(input, init = {}) {
  const url = requestUrl(input);
  const secret = aiSecret();
  if (!url || !secret) return nativeFetch(input, init);

  const headers = guardedHeaders(input, init);
  const authorization = headers.get('authorization');
  if (authorization === `Bearer ${secret}` && !allowedAiHosts.has(url.hostname.toLowerCase())) {
    headers.delete('authorization');
    return nativeFetch(input, { ...init, headers });
  }
  return nativeFetch(input, init);
};
