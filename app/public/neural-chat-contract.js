/** Canonical, additive v1 contract shared by private-chat UI and server tests.
 * This is a same-runtime ES module: no executable remote schemas/generators.
 * queued: accepted and persisted, not yet dispatched; running: dispatched once.
 * Terminal states never imply a paid receipt or permission to retry.
 * Existing request fields/paths are unchanged; queue metadata is optional.
 */
export const CHAT_CONTRACT_VERSION = 1;
export const CHAT_MESSAGE_STATES = Object.freeze(['queued','running','completed','unavailable','failed','cancelled','interrupted']);
export const CHAT_ACTIVE_STATES = Object.freeze(['queued','running']);
export const CHAT_QUEUE_LANES = Object.freeze(['chat','image','video']);
export const isChatActive = status => CHAT_ACTIVE_STATES.includes(status);
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
  return value;
}
