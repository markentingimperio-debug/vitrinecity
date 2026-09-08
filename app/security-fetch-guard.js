const nativeFetch = globalThis.fetch;
const allowedAiOrigins = new Set(['https://openrouter.ai', 'https://api.openai.com']);

function aiSecrets() {
  return new Set([process.env.OPENROUTER_API_KEY, process.env.OPENAI_API_KEY]
    .map(value => String(value || '').trim()).filter(Boolean));
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
  const secrets = aiSecrets();
  if (!url || !secrets.size) return nativeFetch(input, init);

  const headers = guardedHeaders(input, init);
  const bearer = /^Bearer\s+(.+)$/i.exec(headers.get('authorization') || '');
  if (bearer && secrets.has(bearer[1].trim()) && !allowedAiOrigins.has(url.origin)) {
    headers.delete('authorization');
    return nativeFetch(input, { ...init, headers });
  }
  return nativeFetch(input, init);
};
