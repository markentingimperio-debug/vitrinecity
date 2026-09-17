export const MODEL_PROFILES = Object.freeze({
  economico: Object.freeze({
    model: 'gpt-5.6-luna', reasoning: 'low', inputUsdPerMTok: 0.20, cachedInputUsdPerMTok: 0.02, outputUsdPerMTok: 1.20,
    maxOutputTokens: 1024, premium: false,
  }),
  dev: Object.freeze({
    model: 'gpt-5.4-mini', reasoning: 'medium', inputUsdPerMTok: 0.75, cachedInputUsdPerMTok: 0.075, outputUsdPerMTok: 4.50,
    maxOutputTokens: 2048, premium: false,
  }),
  codex: Object.freeze({
    model: 'gpt-5.3-codex', reasoning: 'medium', inputUsdPerMTok: 1.75, cachedInputUsdPerMTok: 0.175, outputUsdPerMTok: 14.00,
    maxOutputTokens: 2048, premium: false,
  }),
  avancado: Object.freeze({
    model: 'gpt-5.6-terra', reasoning: 'medium', inputUsdPerMTok: 2.00, cachedInputUsdPerMTok: 0.20, outputUsdPerMTok: 12.00,
    maxOutputTokens: 2048, premium: false,
  }),
  forte: Object.freeze({
    model: 'gpt-5.6-sol', reasoning: 'high', inputUsdPerMTok: 4.00, cachedInputUsdPerMTok: 0.40, outputUsdPerMTok: 20.00,
    maxOutputTokens: 2048, premium: false,
  }),
  maximo: Object.freeze({
    model: 'gpt-6-astra', reasoning: 'high', inputUsdPerMTok: 10.00, cachedInputUsdPerMTok: 1.00, outputUsdPerMTok: 50.00,
    maxOutputTokens: 2048, premium: true,
  }),
});

export function profileNames() { return Object.keys(MODEL_PROFILES); }
export function resolveProfile(name) {
  const key = String(name || 'dev').trim().toLowerCase();
  const value = MODEL_PROFILES[key];
  if (!value) return null;
  return { name: key, ...value };
}
export function actualCostMicroUsd(usage, profile) {
  const input = Math.max(0, Number(usage?.input_tokens || 0));
  const cached = Math.min(input, Math.max(0, Number(usage?.cached_input_tokens || 0)));
  const output = Math.max(0, Number(usage?.output_tokens || 0));
  const regular = Math.max(0, input - cached);
  return Math.ceil(
    regular * profile.inputUsdPerMTok +
    cached * profile.cachedInputUsdPerMTok +
    output * profile.outputUsdPerMTok
  );
}
export function conservativeReservationMicroUsd(bodyBytes, profile) {
  const inputTokenUpperBound = Math.max(1, Number(bodyBytes || 0));
  return Math.ceil(
    inputTokenUpperBound * profile.inputUsdPerMTok +
    profile.maxOutputTokens * profile.outputUsdPerMTok
  );
}
