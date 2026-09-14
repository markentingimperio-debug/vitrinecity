/** Canonical, additive v1 contract shared by private-chat UI and server tests.
 * This is a same-runtime ES module: no executable remote schemas/generators.
 * queued: accepted and persisted, not yet dispatched; running: dispatched once.
 * Terminal states never imply a paid receipt or permission to retry.
 * Existing request fields/paths are unchanged; queue metadata is optional.
 */
import {VITRINE_COINS_POLICY,quoteCoinTopup,assertCoinStatus} from './vitrine-coins-contract.js';
export const CHAT_CONTRACT_VERSION = 1;
export const CHAT_MESSAGE_STATES = Object.freeze(['awaiting_confirmation','queued','running','completed','unavailable','failed','cancelled','interrupted']);
export const CHAT_ACTIVE_STATES = Object.freeze(['queued','running']);
export const CHAT_QUEUE_LANES = Object.freeze(['chat','image','video']);
export const isChatActive = status => CHAT_ACTIVE_STATES.includes(status);
export const isChatPending = status => status === 'awaiting_confirmation' || isChatActive(status);
export const CHAT_ARTIFACT_MAX_BYTES = 64 * 1024 * 1024;
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const nonnegative = value => Number.isSafeInteger(value) && value >= 0;
/** Integer micro-reais; displayed price is server-authoritative, never recalculated by the client.
 * quoted is not consent, reserved is not charged, held requires reconciliation.
 * A confirmation must reference this request's quote and an immutable idempotency key.
 */
export function assertChatPayment(value) {
  if (!plain(value) || !opaque(value.quoteId) || value.currency !== 'BRL' || !nonnegative(value.amountMicro) || value.amountMicro < 1 ||
      !nonnegative(value.expiresAt) || !CHAT_QUEUE_LANES.includes(value.kind) || typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 500 ||
      !['quoted','reserved','settled','held','released'].includes(value.state) || !(value.chargedMicro === null || nonnegative(value.chargedMicro)) ||
      (['quoted','reserved','held','released'].includes(value.state) && value.chargedMicro !== null) ||
      (value.state === 'settled' && value.chargedMicro === null)) throw new TypeError('chat_payment_invalid');
  return value;
}
export function assertChatWallet(value) {
  if (!plain(value) || value.currency !== 'BRL' || !nonnegative(value.availableMicro) || !nonnegative(value.reservedMicro)) throw new TypeError('chat_wallet_invalid');
  return value;
}
export function assertAiPurchaseOrder(value) {
  if (!plain(value) || typeof value.reference !== 'string' || !/^ai_[a-f0-9-]{36}$/.test(value.reference) ||
      !['creating','pending','payment_unknown','authorized','in_process','in_mediation','approved','rejected','cancelled','refunded','charged_back','review_required'].includes(value.status) ||
      ![1000,2500,5000,10000].includes(value.amountCents) || !nonnegative(value.createdAt) || !nonnegative(value.expiresAt) || value.expiresAt <= value.createdAt ||
      !(value.checkoutUrl === null || typeof value.checkoutUrl === 'string')) throw new TypeError('ai_purchase_order_invalid');
  if (value.checkoutUrl !== null) {
    let url; try { url = new URL(value.checkoutUrl); } catch { throw new TypeError('ai_purchase_order_invalid'); }
    if (value.status !== 'pending' || url.protocol !== 'https:' || url.username || url.password || url.port ||
        !['mercadopago.com','mercadopago.com.br'].some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain))) throw new TypeError('ai_purchase_order_invalid');
  }
  if(value.policyVersion!==undefined){
    if(value.policyVersion!==VITRINE_COINS_POLICY.version)throw new TypeError('ai_purchase_order_invalid');
    const quote=quoteCoinTopup(value.amountCents);
    for(const key of ['feeCents','netCents','netAtoms','netCoins'])if(value[key]!==quote[key])throw new TypeError('ai_purchase_order_invalid');
  }
  return value;
}
export function assertAiPurchaseStatus(value) {
  if (!plain(value) || value.currency !== 'BRL' || !['availableMicro','reservedMicro','chargedMicro','expiredMicro','frozenMicro'].every(key => nonnegative(value[key])) ||
      typeof value.frozen !== 'boolean' || typeof value.canPurchase !== 'boolean' || !Array.isArray(value.presetsCents) ||
      value.presetsCents.length !== 4 || value.presetsCents.some((amount,index) => amount !== [1000,2500,5000,10000][index]) ||
      !plain(value.terms) || !['2026-09-14-ai-prepaid-15-v1',VITRINE_COINS_POLICY.version].includes(value.terms.version) || value.terms.validityDays !== 60 ||
      !['summary','refunds'].every(key => typeof value.terms[key] === 'string' && value.terms[key].length > 0 && value.terms[key].length <= 4000) ||
      !Array.isArray(value.orders) || value.orders.length > 100) throw new TypeError('ai_purchase_status_invalid');
  if(value.terms.version===VITRINE_COINS_POLICY.version){
    for(const key of ['feeStage','topupFeeBps','usageMarkupBps','coinsPerBRL'])if(value.terms[key]!==VITRINE_COINS_POLICY[key])throw new TypeError('ai_purchase_status_invalid');
    assertCoinStatus(value.coinWallet);
  }
  value.orders.forEach(assertAiPurchaseOrder);
  return value;
}
/** Output metadata only. Never accept provider URLs, bearer tokens or local paths.
 * Authenticated content/download routes take the opaque id, not a URL from a model.
 */
export function assertChatArtifact(value) {
  const allowed = ['id','requestId','kind','name','mimeType','bytes','width','height','durationSeconds','availability'];
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key)) || !opaque(value.id) || !opaque(value.requestId) ||
      !['image','video'].includes(value.kind) || !['ready','unavailable'].includes(value.availability) ||
      typeof value.name !== 'string' || !value.name.trim() || value.name.length > 160 || /[\\/:<>\x00-\x1f\x7f]/.test(value.name) ||
      !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > CHAT_ARTIFACT_MAX_BYTES ||
      !(value.kind === 'video' ? value.mimeType === 'video/mp4' : ['image/png','image/jpeg','image/webp'].includes(value.mimeType)) ||
      ['width','height'].some(key => value[key] !== undefined && (!Number.isSafeInteger(value[key]) || value[key] < 1 || value[key] > 16384)) ||
      (value.durationSeconds !== undefined && (value.kind !== 'video' || !Number.isFinite(value.durationSeconds) || value.durationSeconds <= 0 || value.durationSeconds > 600))) throw new TypeError('chat_artifact_invalid');
  return value;
}
/** Optional status.queue: counts are only for the authenticated owner.
 * requiresReview means a dispatched request lacks proof of completion; no retry.
 */
export function assertChatQueueStatus(value) {
  if (!value || typeof value !== 'object' || typeof value.enabled !== 'boolean' || typeof value.requiresReview !== 'boolean' ||
      !['pending','running','unresolved'].every(k => Number.isSafeInteger(value[k]) && value[k] >= 0) ||
      value.requiresReview !== (value.unresolved > 0)) throw new TypeError('chat_queue_status_invalid');
  return value;
}
export function assertChatReceipt(value) {
  if (!value || typeof value !== 'object' ||
      !['id','requestId','conversationId','messageId'].every(k => typeof value[k] === 'string' && value[k].length > 0) ||
      value.id !== value.requestId || !CHAT_MESSAGE_STATES.includes(value.status) ||
      !['createdAt','updatedAt'].every(k => Number.isSafeInteger(value[k]) && value[k] >= 0)) throw new TypeError('chat_receipt_invalid');
  if (value.queue !== undefined && (!value.queue || !CHAT_QUEUE_LANES.includes(value.queue.lane) ||
      !(value.queue.position === null || Number.isSafeInteger(value.queue.position) && value.queue.position >= 1))) throw new TypeError('chat_queue_invalid');
  if (value.payment !== undefined) assertChatPayment(value.payment);
  if (value.status === 'awaiting_confirmation' && value.payment?.state !== 'quoted') throw new TypeError('chat_payment_invalid');
  return value;
}
