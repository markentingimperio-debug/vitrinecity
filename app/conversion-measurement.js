import { createHash, randomUUID } from 'node:crypto';

export const googleMeasurementAllowed = req => req.get('x-vc-analytics-consent') === 'accepted'
  && req.get('x-vc-google-analytics-consent') === 'accepted';

// Issue only after the corresponding business operation succeeds. No form values.
export function conversionHeader(req, res, event, parameters = {}, key = randomUUID()) {
  try {
    if (!googleMeasurementAllowed(req) || !['sign_up', 'generate_lead', 'begin_checkout'].includes(event)) return;
    const params = event === 'begin_checkout' ? { currency: 'BRL', value: parameters.value } : {};
    if (event === 'begin_checkout' && (!Number.isFinite(params.value) || params.value < 0)) return;
    res.set('X-VC-Measurement', JSON.stringify({ key, event, params }));
  } catch { /* Optional measurement must not fail an otherwise successful operation. */ }
}

export function orderMeasurementReceipts(db, req, orders) {
  try {
    if (!googleMeasurementAllowed(req) || !Number.isSafeInteger(req.user?.id)) return [];
    const checkout = db.prepare("SELECT metadata_json FROM analytics_events WHERE event_name='checkout_start' AND asset_type='marketplace' AND asset_id=? AND created_at>=datetime('now','-7 days') ORDER BY id DESC LIMIT 1");
    const items = db.prepare('SELECT product_id,quantity,unit_price_cents FROM marketplace_order_items WHERE order_reference=? ORDER BY id');
    const approved = db.prepare("SELECT 1 FROM marketplace_payment_events WHERE order_reference=? AND payment_status='approved' LIMIT 1");
    return orders.slice(0, 100).flatMap(order => {
      if (order.buyer_user_id !== req.user.id || !['approved', 'refunded', 'charged_back'].includes(order.payment_status)) return [];
      let meta; try { meta = JSON.parse(checkout.get(order.reference)?.metadata_json || 'null'); } catch { return []; }
      // Old orders and orders created without Google consent are not exported retroactively.
      if (meta?.origin !== 'server' || meta?.googleConsent !== true || !approved.get(order.reference)) return [];
      const id = 'vc_' + createHash('sha256').update('measurement:' + order.reference).digest('hex').slice(0, 32);
      const event = order.payment_status === 'approved' ? 'purchase' : 'refund';
      const products = items.all(order.reference).map(item => ({ item_id: `p_${item.product_id}`, quantity: item.quantity, price: item.unit_price_cents / 100 }));
      if (!products.length || products.length > 200 || !Number.isSafeInteger(order.products_cents) || order.products_cents < 0) return [];
      if (!Number.isSafeInteger(order.shipping_cents) || order.shipping_cents < 0) return [];
      if (products.some(item => !Number.isSafeInteger(item.quantity) || item.quantity < 1 || !Number.isFinite(item.price) || item.price < 0)
        || products.reduce((sum, item) => sum + Math.round(item.price * 100) * item.quantity, 0) !== order.products_cents) return [];
      return [{ key: `${event}_${id}`, event, params: { transaction_id: id, currency: 'BRL', value: order.products_cents / 100,
        shipping: order.shipping_cents / 100, items: products } }];
    });
  } catch { return []; }
}
