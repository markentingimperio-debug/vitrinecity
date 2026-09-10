const nativeFetch = globalThis.fetch;
const aiOriginKeys = () => new Map([
  ['https://openrouter.ai', String(process.env.OPENROUTER_API_KEY || '').trim()],
  ['https://api.openai.com', String(process.env.OPENAI_API_KEY || '').trim()],
  ['https://generativelanguage.googleapis.com', String(process.env.GEMINI_API_KEY || '').trim()]
]);

function aiSecrets() {
  return new Set([process.env.OPENROUTER_API_KEY, process.env.OPENAI_API_KEY, process.env.GEMINI_API_KEY]
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
  let changed = false;
  if (bearer && secrets.has(bearer[1].trim()) && aiOriginKeys().get(url.origin) !== bearer[1].trim()) {
    headers.delete('authorization');
    changed = true;
  }
  const googleKey = headers.get('x-goog-api-key');
  if (googleKey && secrets.has(googleKey.trim()) && (url.origin !== 'https://generativelanguage.googleapis.com' || googleKey.trim() !== String(process.env.GEMINI_API_KEY || '').trim())) {
    headers.delete('x-goog-api-key');
    changed = true;
  }
  return nativeFetch(input, changed ? { ...init, headers } : init);
};
