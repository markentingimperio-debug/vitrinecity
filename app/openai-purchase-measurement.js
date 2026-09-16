import { createHash } from 'node:crypto';

export function openaiPurchaseReceipts(db, req) {
  if (!Number.isSafeInteger(req.user?.id) || req.get('x-vc-analytics-consent') !== 'accepted'
    || req.get('x-vc-openai-ads-consent') !== 'accepted') return [];
  try {
    const checkout = db.prepare(`SELECT metadata_json FROM analytics_events
      WHERE event_name='checkout_start' AND asset_type=? AND asset_id=? AND user_id=?
      AND created_at >= datetime('now','-7 days') ORDER BY id DESC LIMIT 1`);
    const purchase = db.prepare(`SELECT 1 FROM analytics_events WHERE event_name='purchase'
      AND path='/webhook' AND asset_type=? AND asset_id=? AND value_cents=?
      AND created_at >= datetime('now','-7 days') LIMIT 1`);
    const eligible = (type, order) => {
      let metadata; try { metadata = JSON.parse(checkout.get(type, order.reference, req.user.id)?.metadata_json || 'null'); } catch { return false; }
      return metadata?.origin === 'server' && metadata?.openaiConsent === true
        && Number.isSafeInteger(order.amount_cents) && order.amount_cents > 0
        && !!purchase.get(type, order.reference, order.amount_cents);
    };
    const receipt = (order, contents) => ({
      event: 'order_created',
      eventId: 'vc_purchase_' + createHash('sha256').update('openai-purchase:' + order.reference).digest('hex'),
      data: { type: 'contents', amount: order.amount_cents, currency: 'BRL', contents }
    });
    const courses = db.prepare(`SELECT reference,course_slug,course_title,amount_cents,mp_payment_id
      FROM course_orders WHERE user_id=? AND status='approved'
      AND updated_at >= datetime('now','-7 days') ORDER BY id DESC LIMIT 50`).all(req.user.id);
    const result = courses.flatMap(order => {
      if (!/^\d+$/.test(String(order.mp_payment_id || '')) || !/^[a-z0-9-]+$/.test(order.course_slug)
        || !eligible('course', order)) return [];
      return [receipt(order, [{ id: 'course-' + order.course_slug, name: order.course_title, content_type: 'product', quantity: 1 }])];
    });
    const products = db.prepare(`SELECT reference,total_cents AS amount_cents,products_cents,shipping_cents
      FROM marketplace_orders WHERE buyer_user_id=? AND payment_status='approved'
      AND created_at >= datetime('now','-7 days') ORDER BY id DESC LIMIT 50`).all(req.user.id);
    const approved = db.prepare("SELECT 1 FROM marketplace_payment_events WHERE order_reference=? AND payment_status='approved' LIMIT 1");
    const items = db.prepare('SELECT product_id,quantity,unit_price_cents FROM marketplace_order_items WHERE order_reference=?');
    for (const order of products) {
      if (!eligible('marketplace', order) || !approved.get(order.reference)) continue;
      const rows = items.all(order.reference);
      if (!rows.length || rows.length > 200 || rows.some(item => !Number.isSafeInteger(item.product_id) || item.product_id < 1
        || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || !Number.isSafeInteger(item.unit_price_cents) || item.unit_price_cents < 0)) continue;
      if (!Number.isSafeInteger(order.products_cents) || !Number.isSafeInteger(order.shipping_cents) || order.shipping_cents < 0
        || rows.reduce((sum, item) => sum + item.quantity * item.unit_price_cents, 0) !== order.products_cents
        || order.products_cents + order.shipping_cents !== order.amount_cents) continue;
      result.push(receipt(order, rows.map(item => ({ id: 'product-' + item.product_id, content_type: 'product', quantity: item.quantity }))));
    }
    return result;
  } catch { return []; } // Optional measurement must never break access to a purchase.
}

export function setupOpenAIPurchaseMeasurement({ app, db, requireUser }) {
  app.get('/api/measurement/openai-purchases', requireUser, (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.json({ receipts: openaiPurchaseReceipts(db, req) });
  });
}
