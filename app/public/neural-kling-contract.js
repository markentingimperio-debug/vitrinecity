/** Shared admin-only readiness contract. An authenticated API check is not a
 * paid generation test, a balance guarantee, or permission to bill customers. */
export const KLING_READINESS_VERSION = 2;
export const KLING_API_LINKS = Object.freeze({
  console: 'https://kling.ai/dev/api-key',
  pricing: 'https://kling.ai/dev/pricing',
  documentation: 'https://kling.ai/document-api/api/get-started/authentication',
  terms: 'https://kling.ai/document-api/guides/protocols/paid-service'
});
export const KLING_READINESS_STATES = Object.freeze({
  credentials_missing: 'Chave da API pendente',
  not_checked: 'Chave configurada; acesso não conferido',
  access_verified: 'Acesso à API conferido; geração ainda não testada',
  credentials_rejected: 'A API não aceitou a credencial',
  unavailable: 'Não foi possível conferir o acesso'
});
export function assertKlingReadiness(value) {
  const keys = ['version','provider','stage','configured','checkedAt','generationEnabled','customerBillingEnabled','studioCreditsShared','balanceFreshness','packageCount'];
  const invalid = () => { throw new TypeError('kling_readiness_invalid'); };
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value,key))) invalid();
  if (![1,KLING_READINESS_VERSION].includes(value.version) || value.provider !== 'kling_api' || !Object.hasOwn(KLING_READINESS_STATES,value.stage) || typeof value.configured !== 'boolean') invalid();
  if (value.generationEnabled !== false || value.customerBillingEnabled !== false || value.studioCreditsShared !== false || value.balanceFreshness !== 'up_to_12_hours') invalid();
  if (value.checkedAt !== null && (typeof value.checkedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.checkedAt) || !Number.isFinite(Date.parse(value.checkedAt)) || new Date(value.checkedAt).toISOString() !== value.checkedAt)) invalid();
  if (value.packageCount !== null && (!Number.isSafeInteger(value.packageCount) || value.packageCount < 0)) invalid();
  if ((value.stage === 'credentials_missing') !== !value.configured) invalid();
  if (['credentials_missing','not_checked'].includes(value.stage) && (value.checkedAt !== null || value.packageCount !== null)) invalid();
  if (!['credentials_missing','not_checked'].includes(value.stage) && value.checkedAt === null) invalid();
  // v2: verified access can omit package information. null means not reported,
  // never zero packages or available balance. v1 still requires a known count.
  if (value.stage === 'access_verified' ? value.version === 1 && value.packageCount === null : value.packageCount !== null) invalid();
  return value;
}
