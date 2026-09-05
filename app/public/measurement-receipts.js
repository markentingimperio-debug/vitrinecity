const PENDING = 'vc_measurement_pending_v1', SENT = 'vc_measurement_sent_v1';
const TTL = 7 * 86400000;
export function receiptConsent() {
  try { return localStorage.getItem('vc_analytics_consent') === 'accepted' && localStorage.getItem('vc_google_analytics_consent_v1') === 'accepted' && localStorage.getItem('vc_conversion_measurement_consent_v1') === 'accepted'; }
  catch { return false; }
}
export function sanitizeReceipt(value) {
  if (!value || !/^[a-zA-Z0-9_-]{8,100}$/.test(value.key || '') || !['sign_up', 'generate_lead', 'begin_checkout', 'purchase', 'refund'].includes(value.event)) return null;
  const out = { key: value.key, event: value.event, params: {} }, p = value.params || {};
  if (['begin_checkout', 'purchase', 'refund'].includes(value.event)) {
    if (p.currency !== 'BRL' || typeof p.value !== 'number' || !Number.isFinite(p.value) || p.value < 0 || p.value > 10000000) return null;
    out.params = { currency: 'BRL', value: p.value };
  }
  if (['purchase', 'refund'].includes(value.event)) {
    if (!/^vc_[a-f0-9]{32}$/.test(p.transaction_id || '') || !Array.isArray(p.items) || !p.items.length || p.items.length > 200) return null;
    if (typeof p.shipping !== 'number' || !Number.isFinite(p.shipping) || p.shipping < 0) return null;
    const items = [];
    for (const item of p.items) {
      if (!/^p_[1-9][0-9]{0,12}$/.test(item.item_id || '') || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100000
        || typeof item.price !== 'number' || !Number.isFinite(item.price) || item.price < 0 || item.price > 10000000) return null;
      items.push({ item_id: item.item_id, quantity: item.quantity, price: item.price });
    }
    const sum = items.reduce((total, item) => total + Math.round(item.price * 100) * item.quantity, 0);
    if (Math.abs(sum - Math.round(p.value * 100)) > 1) return null;
    Object.assign(out.params, { transaction_id: p.transaction_id, shipping: p.shipping, items });
  }
  return out;
}
function saved(key) {
  try { const entries = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(entries) ? entries.filter(e => Number.isFinite(e.at) && e.at <= Date.now() && Date.now() - e.at < TTL).slice(-200) : []; }
  catch { return []; }
}
export function enqueueReceipts(values) {
  if (!receiptConsent() || !Array.isArray(values)) return;
  try {
    const pending = saved(PENDING), sent = new Set(saved(SENT).map(e => e.key));
    for (const value of values.slice(0, 100)) {
      const receipt = sanitizeReceipt(value);
      if (receipt && !sent.has(receipt.key) && !pending.some(e => e.key === receipt.key)) pending.push({ ...receipt, at: Date.now() });
    }
    localStorage.setItem(PENDING, JSON.stringify(pending.slice(-100)));
    document.dispatchEvent(new Event('vc:measurement-receipts'));
  } catch { /* Storage denial is fail-closed; never interrupt registration or checkout. */ }
}
export function clearPendingReceipts() { try { localStorage.removeItem(PENDING); } catch {} }
export async function flushReceipts(gtag, context, id) {
  // Serialize tabs where Web Locks are available; otherwise deduplication is best effort.
  try {
    if (globalThis.navigator?.locks?.request) return await navigator.locks.request('vc-measurement-dispatch', () => dispatchReceipts(gtag, context, id));
    dispatchReceipts(gtag, context, id);
  } catch {}
}
function dispatchReceipts(gtag, context, id) {
  if (!receiptConsent()) { clearPendingReceipts(); return; }
  try {
    const sent = saved(SENT), keys = new Set(sent.map(e => e.key)), pending = saved(PENDING);
    for (const entry of pending) {
      const receipt = sanitizeReceipt(entry);
      if (!receipt || keys.has(receipt.key)) continue;
      if (receipt.event === 'refund' && !keys.has(`purchase_${receipt.params.transaction_id}`)) continue;
      // Dispatch marker, not a delivery acknowledgement. A blocker can still prevent delivery.
      sent.push({ key: receipt.key, at: Date.now() }); keys.add(receipt.key);
      localStorage.setItem(SENT, JSON.stringify(sent.slice(-200)));
      gtag('event', receipt.event, { ...receipt.params, ...context, send_to: id });
    }
    localStorage.removeItem(PENDING);
  } catch { /* Analytics must never interrupt navigation. */ }
}
