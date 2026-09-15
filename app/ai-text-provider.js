const DEFAULT_OPENROUTER_MODEL = 'nvidia/nemotron-3.5-lightning:free';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-flash';
const DEEPSEEK_EFFORTS = new Set(['none','low','high','max']);
const ENDPOINTS = Object.freeze({openai:'https://api.openai.com/v1/responses', openrouter:'https://openrouter.ai/api/v1/responses', deepseek:'https://api.deepseek.com/responses'});
const KEY_NAMES = Object.freeze({openai:'OPENAI_API_KEY', openrouter:'OPENROUTER_API_KEY', deepseek:'DEEPSEEK_API_KEY'});
const REJECTION_PROOF = Symbol('ai_text_rejection_proof');
const text = value => String(value || '').trim();
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const fail = (code, status = 503) => Object.assign(new Error(code), {code, status});
const validModel = (model, provider) => /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(model) && (provider === 'openrouter' || !model.includes('/'));
const diagnosticCodes = new Set(['insufficient_quota','rate_limit','rate_limit_exceeded','invalid_api_key','authentication_error','invalid_request_error','model_not_found','context_length_exceeded']);

function completedResponse(data, body) {
  if (data?.status !== 'completed' || !Array.isArray(data.output) || !data.output.length || data.output.length > 64) return false;
  const names = new Set((body.tools || []).filter(tool => tool?.type === 'function').map(tool => tool.name));
  const ids = new Set((Array.isArray(body.input) ? body.input : []).filter(item => item?.type === 'function_call').map(item => item.call_id));
  let useful = false;
  for (const item of data.output) {
    if (!plain(item)) return false;
    if (item.type === 'reasoning') continue;
    if (item.type === 'function_call') {
      if (item.status && item.status !== 'completed' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(item.call_id || '') ||
          !/^[A-Za-z0-9_-]{1,64}$/.test(item.name || '') || ids.has(item.call_id) || !names.has(item.name) ||
          typeof item.arguments !== 'string' || item.arguments.length > 32768) return false;
      try { if (!plain(JSON.parse(item.arguments))) return false; } catch { return false; }
      ids.add(item.call_id); useful = true;
    } else if (item.type === 'message') {
      if (item.status && item.status !== 'completed' || !Array.isArray(item.content) || !item.content.length) return false;
      for (const part of item.content) {
        if (part?.type !== 'output_text' || typeof part.text !== 'string') return false;
        if (text(part.text)) useful = true;
      }
    } else if (!['web_search_call','file_search_call','code_interpreter_call','mcp_list_tools','mcp_call','mcp_approval_request'].includes(item.type)) return false;
  }
  return useful;
}

// DeepSeek's stateless Responses compatibility explicitly ignores unsupported
// fields/tools. Never let that silently remove a caller's safety or tool contract.
// Source: https://api-docs.deepseek.com/guides/responses_api/ (2026-09-15).
function requiresOpenAI(body) {
  const supported = new Set(['model','input','instructions','stream','temperature','top_p','max_output_tokens','top_logprobs','tools','tool_choice','reasoning','text','user','store']);
  if (Object.keys(body).some(key => !supported.has(key) && body[key] !== undefined && body[key] !== null)) return true;
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.some(tool => tool?.type !== 'function'))) return true;
  if (plain(body.tool_choice) && body.tool_choice.type !== 'function') return true;
  if (body.reasoning !== undefined && (!plain(body.reasoning) || !DEEPSEEK_EFFORTS.has(body.reasoning.effort) || Object.keys(body.reasoning).some(key => key !== 'effort'))) return true;
  if (body.text !== undefined && (!plain(body.text) || Object.keys(body.text).some(key => key !== 'format'))) return true;
  if (body.input === undefined || typeof body.input === 'string') return false;
  if (!Array.isArray(body.input)) return true;
  const textParts = parts => typeof parts === 'string' || Array.isArray(parts) && parts.every(part => ['input_text','output_text'].includes(part?.type));
  return body.input.some(item => {
    if (!plain(item)) return true;
    const type = item.type || (item.role ? 'message' : '');
    if (type === 'message') return !['user','assistant','system'].includes(item.role) || !textParts(item.content);
    if (type === 'function_call') return typeof item.arguments !== 'string';
    if (type === 'function_call_output') return !textParts(item.output);
    if (type === 'reasoning') return Boolean(item.encrypted_content) || Boolean(item.summary && (!Array.isArray(item.summary) || item.summary.length));
    return true;
  });
}

/** Text selection is independent of image/video credentials. Never return keys. */
export function resolveAiTextConfig(env = process.env) {
  const requested = text(env.AI_TEXT_PROVIDER).toLowerCase();
  const explicit = Boolean(requested && requested !== 'auto');
  const valid = ['', 'auto', 'openai', 'openrouter', 'deepseek'].includes(requested);
  // Preserve legacy auto behavior. DeepSeek requires explicit opt-in.
  const provider = valid ? (explicit ? requested : env.OPENROUTER_API_KEY ? 'openrouter' : 'openai') : '';
  const model = provider === 'deepseek' ? text(env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL) : provider === 'openai' && explicit
    ? text(env.OPENAI_DIRECT_MODEL || env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL)
    : text(env.OPENROUTER_MODEL || env.OPENAI_MODEL || (provider === 'openrouter' ? DEFAULT_OPENROUTER_MODEL : DEFAULT_OPENAI_MODEL));
  const key = text(env[KEY_NAMES[provider]]);
  const modelValid = validModel(model, provider);
  const fallbackRequested = provider === 'deepseek' ? text(env.AI_TEXT_FALLBACK_PROVIDER).toLowerCase() : '';
  const fallbackProvider = fallbackRequested === 'openai' ? 'openai' : '';
  const fallbackModel = fallbackProvider ? text(env.OPENAI_DIRECT_MODEL || DEFAULT_OPENAI_MODEL) : '';
  const fallbackConfigured = Boolean(fallbackProvider && text(env.OPENAI_API_KEY) && validModel(fallbackModel, 'openai'));
  // DeepSeek defaults to high thinking, which can exhaust Lia's short output
  // budget before answering. This default belongs only to the DeepSeek attempt.
  const reasoningEffort = provider === 'deepseek' ? text(env.DEEPSEEK_REASONING_EFFORT || 'none').toLowerCase() : null;
  const error = !valid ? 'ai_text_provider_invalid' : !key ? 'ai_text_key_missing' : !modelValid ? 'ai_text_model_invalid' :
    fallbackRequested && fallbackRequested !== 'none' && fallbackRequested !== 'openai' ? 'ai_text_fallback_invalid' :
    provider === 'deepseek' && !DEEPSEEK_EFFORTS.has(reasoningEffort) ? 'ai_text_reasoning_invalid' : '';
  return Object.freeze({provider, model: modelValid ? model : '', explicit, configured: !error, error, fallbackProvider, fallbackModel, fallbackConfigured, reasoningEffort});
}

export function createAiTextClient({env = process.env, fetchImpl = globalThis.fetch, onFailure = () => {}} = {}) {
  const config = resolveAiTextConfig(env);
  const credentials = Object.fromEntries(Object.entries(KEY_NAMES).map(([provider, name]) => [provider, text(env[name])]));
  const routerFallback = text(env.OPENROUTER_FALLBACK_MODEL || 'openrouter/free');
  const report = details => { try { onFailure(details); } catch { /* Diagnostics never authorize another request. */ } };
  async function attempt(body, provider, model, fallbackUsed) {
    let response, data;
    try {
      response = await fetchImpl(ENDPOINTS[provider], {
        method:'POST', redirect:'error', credentials:'omit', headers:{Authorization:'Bearer ' + credentials[provider], 'Content-Type':'application/json',
          ...(provider === 'openrouter' ? {'HTTP-Referer':text(env.SITE_URL || 'https://vitrinecity.com'), 'X-OpenRouter-Title':'VitrineCity Jarvis'} : {})},
        body:JSON.stringify({...body, ...(provider === 'deepseek' && body.reasoning === undefined ? {reasoning:{effort:config.reasoningEffort}} : {}), model, store:false}), signal:AbortSignal.timeout(provider === 'openrouter' ? 30000 : 60000)
      });
      data = await response.json();
    } catch {
      const status = response ? response.status >= 400 ? response.status : 502 : 504;
      report({provider, model, status, code:'request_unavailable'});
      throw fail('AI_TEXT_REQUEST_FAILED', status); // A dispatched request may have consumed inference: no replay.
    }
    if (response.ok && !data?.error) {
      if (!completedResponse(data, body)) {
        report({provider, model, status:502, code:'response_not_completed'});
        throw fail('AI_TEXT_REQUEST_FAILED', 502);
      }
      // These fields describe the actual transport/result, not provider-supplied metadata.
      data.aiText = Object.freeze({provider, model:typeof data.model === 'string' && validModel(data.model, provider) ? data.model : null,
        requestedModel:model, fallbackUsed});
      return data;
    }
    const status = response.status >= 400 ? response.status : 502;
    const code = diagnosticCodes.has(data?.error?.code) ? data.error.code : 'provider_rejected';
    report({provider, model, status, code});
    const error = fail('AI_TEXT_REQUEST_FAILED', status);
    // Only a narrow, explicit error envelope proves rejection before generation.
    // Unknown extra output/usage fields cannot be interpreted as free/non-executed.
    if ([401,402,429].includes(status) && plain(data) && plain(data.error) &&
        Object.keys(data).every(key => ['error','request_id'].includes(key)) &&
        Object.keys(data.error).every(key => ['message','type','code','param'].includes(key)) &&
        (typeof data.error.message === 'string' || typeof data.error.code === 'string' || typeof data.error.type === 'string')) error[REJECTION_PROOF] = true;
    throw error;
  }
  async function request(body, {observe = (_details, operation) => operation()} = {}) {
    if (!config.configured) throw fail(config.error);
    if (!plain(body) || body.stream === true || body.tools !== undefined && !Array.isArray(body.tools)) throw fail('ai_text_request_invalid', 400);
    if (body.model !== undefined && body.model !== config.model) throw fail('ai_text_model_override_rejected', 400);
    let provider = config.provider, model = config.model, fallbackUsed = false;
    if (provider === 'deepseek' && requiresOpenAI(body)) {
      if (!config.fallbackConfigured) throw fail('ai_text_capability_unsupported', 400);
      provider = 'openai'; model = config.fallbackModel; fallbackUsed = true;
    }
    const execute = () => observe({provider, model, fallbackUsed}, () => attempt(body, provider, model, fallbackUsed));
    try { return await execute(); }
    catch (error) {
      if (!error?.[REJECTION_PROOF]) throw error;
      if (provider === 'deepseek' && config.fallbackConfigured) { provider = 'openai'; model = config.fallbackModel; }
      else if (provider === 'openrouter' && validModel(routerFallback, 'openrouter') && routerFallback !== model) model = routerFallback;
      else throw error;
      fallbackUsed = true;
      return execute(); // At most one proven-safe fallback; never retry the workflow or any tool.
    }
  }
  return Object.freeze({config, request});
}
