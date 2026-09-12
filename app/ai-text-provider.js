const DEFAULT_OPENROUTER_MODEL = 'nvidia/nemotron-3.5-lightning:free';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const text = value => String(value || '').trim();
const fail = (code, status = 503) => Object.assign(new Error(code), {code, status});
function completedResponse(data) {
  return data?.status === 'completed' && Array.isArray(data.output) && data.output.some(item =>
    item?.type === 'function_call'
      ? Boolean(text(item.call_id) && text(item.name) && typeof item.arguments === 'string')
      : item?.type === 'message' && Array.isArray(item.content) && item.content.some(part => part?.type === 'output_text' && text(part.text))
  );
}

/** Text selection is independent of image/video credentials. Never return keys. */
export function resolveAiTextConfig(env = process.env) {
  const requested = text(env.AI_TEXT_PROVIDER).toLowerCase();
  const explicit = Boolean(requested && requested !== 'auto');
  const valid = ['', 'auto', 'openai', 'openrouter'].includes(requested);
  const provider = valid ? (explicit ? requested : env.OPENROUTER_API_KEY ? 'openrouter' : 'openai') : '';
  const model = provider === 'openai' && explicit
    ? text(env.OPENAI_DIRECT_MODEL || env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL)
    : text(env.OPENROUTER_MODEL || env.OPENAI_MODEL || (provider === 'openrouter' ? DEFAULT_OPENROUTER_MODEL : DEFAULT_OPENAI_MODEL));
  const key = text(provider === 'openai' ? env.OPENAI_API_KEY : provider === 'openrouter' ? env.OPENROUTER_API_KEY : '');
  const validModel = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(model) && (provider !== 'openai' || !model.includes('/'));
  const error = !valid ? 'ai_text_provider_invalid' : !key ? 'ai_text_key_missing' : !validModel ? 'ai_text_model_invalid' : '';
  return Object.freeze({provider, model: validModel ? model : '', explicit, configured: !error, error});
}

export function createAiTextClient({env = process.env, fetchImpl = globalThis.fetch, onFailure = () => {}} = {}) {
  const config = resolveAiTextConfig(env);
  const apiKey = text(config.provider === 'openai' ? env.OPENAI_API_KEY : env.OPENROUTER_API_KEY);
  const endpoint = config.provider === 'openai' ? 'https://api.openai.com/v1/responses' : 'https://openrouter.ai/api/v1/responses';
  const fallbackModel = text(env.OPENROUTER_FALLBACK_MODEL || 'openrouter/free');
  async function request(body) {
    if (!config.configured) throw fail(config.error);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('ai_text_request_invalid', 400);
    if (body.model !== undefined && body.model !== config.model) throw fail('ai_text_model_override_rejected', 400);
    const models = config.provider === 'openrouter' && fallbackModel && fallbackModel !== config.model
      ? [config.model, fallbackModel] : [config.model];
    let status = 502;
    for (const model of models) {
      let response, data;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST', redirect: 'error', headers: {
            Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json',
            ...(config.provider === 'openrouter' ? {'HTTP-Referer':text(env.SITE_URL || 'https://vitrinecity.com'), 'X-OpenRouter-Title':'VitrineCity Jarvis'} : {})
          },
          body: JSON.stringify({...body, model, store:false}),
          signal: AbortSignal.timeout(config.provider === 'openrouter' ? 30000 : 60000)
        });
        data = await response.json();
      } catch {
        status = response ? (response.status >= 400 ? response.status : 502) : 504;
        onFailure({provider:config.provider, model, status, code:'request_unavailable'});
        continue;
      }
      if (response.ok && !data?.error) {
        if (completedResponse(data)) return data;
        status = 502;
        onFailure({provider:config.provider, model, status, code:'response_not_completed'});
        break;
      }
      status = response.status >= 400 ? response.status : 502;
      const code = /^[A-Za-z0-9_.-]{1,100}$/.test(String(data?.error?.code || '')) ? String(data.error.code) : 'provider_rejected';
      onFailure({provider:config.provider, model, status, code});
      if (config.provider !== 'openrouter' || ![404,408,429,502,503].includes(status)) break;
    }
    throw fail('AI_TEXT_REQUEST_FAILED', status);
  }
  return Object.freeze({config, request});
}
