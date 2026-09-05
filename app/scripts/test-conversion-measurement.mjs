import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import express from 'express';
import { setupAdminAnalytics } from '../admin-analytics.js';
import { conversionHeader, orderMeasurementReceipts } from '../conversion-measurement.js';

const sid = 'vc_1234567890abcdef';
const request = (consent = 'accepted', google = 'accepted', id = 1) => ({
  path: '/api/marketplace/checkout', user: { id },
  get: key => ({ 'x-vc-session': sid, 'x-vc-analytics-consent': consent, 'x-vc-google-analytics-consent': google })[key]
});
function fixture() {
  const db = new Database(':memory:'), app = express(); app.use(express.json());
  db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2)');
  const analytics = setupAdminAnalytics({ app, db, requireAdmin: (_req, res) => res.sendStatus(401), publicDir: '/tmp' });
  db.prepare('INSERT INTO analytics_sessions(session_id,utm_source,utm_campaign) VALUES (?,?,?)').run(sid, 'meta', 'campaign_one');
  db.exec(`CREATE TABLE marketplace_payment_events(order_reference TEXT,payment_status TEXT);
    CREATE TABLE marketplace_order_items(id INTEGER PRIMARY KEY,order_reference TEXT,product_id INTEGER,quantity INTEGER,unit_price_cents INTEGER);`);
  return { db, app, analytics };
}
test('success receipt contains no form fields and requires explicit Google conversion opt-in', () => {
  for (const req of [request('essential'), request('accepted', null), request('accepted', 'essential')]) {
    const headers = {}; conversionHeader(req, { set: (key, value) => headers[key] = value }, 'sign_up', { email: 'secret@example.test' });
    assert.deepEqual(headers, {});
  }
  const headers = {}, res = { set: (key, value) => headers[key] = value };
  conversionHeader(request(), res, 'sign_up', { email: 'secret@example.test', name: 'Private' }, 'signup_test_123');
  assert.deepEqual(JSON.parse(headers['X-VC-Measurement']), { key: 'signup_test_123', event: 'sign_up', params: {} });
  conversionHeader(request(), res, 'begin_checkout', { value: 12.34, customer: 'Private' }, 'checkout_test_123');
  assert.deepEqual(JSON.parse(headers['X-VC-Measurement']).params, { currency: 'BRL', value: 12.34 });
  assert.doesNotThrow(() => conversionHeader(request(), { set() { throw Error('closed'); } }, 'sign_up'));
});
test('checkout keeps first touch, server-only conversions cannot be forged, failures do not fail business operations', async () => {
  const { db, app, analytics } = fixture(), server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    analytics.recordOrderAttribution(request('essential'), 'order-private', 'marketplace');
    analytics.recordCheckout(request('essential'), 'order-private', 'marketplace', 2500);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM analytics_events').get().n, 0);
    analytics.recordOrderAttribution(request(), 'order-one', 'marketplace');
    db.prepare('UPDATE analytics_sessions SET utm_campaign=?').run('changed');
    analytics.recordOrderAttribution(request(), 'order-one', 'marketplace');
    assert.equal(db.prepare('SELECT utm_campaign FROM analytics_order_attribution').get().utm_campaign, 'campaign_one');
    analytics.recordCheckout(request(), 'order-one', 'marketplace', 2500);
    assert.deepEqual(JSON.parse(db.prepare('SELECT metadata_json FROM analytics_events').get().metadata_json), { origin: 'server', googleConsent: true });
    analytics.recordPurchase('order-one', 'marketplace', 2500);
    analytics.recordPurchase('order-one', 'marketplace', 2500);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM analytics_events WHERE event_name='purchase'").get().n, 1);
    for (const eventName of ['signup_confirmed', 'lead', 'checkout_start', 'purchase']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/analytics/events`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, eventName, metadata: { origin: 'server', googleConsent: true } })
      });
      assert.equal(response.status, 400, eventName);
    }
    db.close();
    assert.doesNotThrow(() => analytics.recordCheckout(request(), 'order-two', 'marketplace', 100));
    assert.doesNotThrow(() => analytics.recordOrderAttribution(request(), 'order-two', 'marketplace'));
    assert.doesNotThrow(() => analytics.recordPurchase('order-one', 'marketplace', 2500));
  } finally { await new Promise(resolve => server.close(resolve)); if (db.open) db.close(); }
});
test('only owner, recent opted-in checkout and confirmed payment produce minimal deterministic ecommerce receipts', () => {
  const { db, analytics } = fixture();
  try {
    const order = { reference: 'private-order-reference', buyer_user_id: 1, payment_status: 'approved', products_cents: 2500, shipping_cents: 500 };
    db.prepare('INSERT INTO marketplace_order_items VALUES(1,?,42,2,1250)').run(order.reference);
    const receipts = (req = request(), value = order) => orderMeasurementReceipts(db, req, [value]);
    assert.deepEqual(receipts(), []);
    analytics.recordCheckout(request(), order.reference, 'marketplace', 2500);
    assert.deepEqual(receipts(), []); // No verified payment.
    db.prepare('INSERT INTO marketplace_payment_events VALUES(?,?)').run(order.reference, 'approved');
    assert.deepEqual(receipts(request('essential')), []);
    assert.deepEqual(receipts(request('accepted', 'essential')), []);
    assert.deepEqual(receipts(request('accepted', 'accepted', 2)), []);
    assert.deepEqual(receipts(request(), { ...order, payment_status: 'pending' }), []);
    const receipt = receipts()[0];
    assert.equal(receipt.event, 'purchase'); assert.equal(receipt.params.value, 25); assert.equal(receipt.params.shipping, 5);
    assert.deepEqual(receipt.params.items, [{ item_id: 'p_42', quantity: 2, price: 12.5 }]);
    assert.doesNotMatch(JSON.stringify(receipt), /private-order-reference|buyer|email|name/);
    assert.deepEqual(receipts()[0], receipt);
    assert.equal(receipts(request(), { ...order, payment_status: 'refunded' })[0].event, 'refund');
    assert.deepEqual(receipts(request(), { ...order, products_cents: 9999 }), []);
    db.exec("UPDATE analytics_events SET metadata_json='{}'");
    assert.deepEqual(receipts(), []);
    db.exec(`UPDATE analytics_events SET metadata_json='{"origin":"server","googleConsent":true}',created_at=datetime('now','-8 days')`);
    assert.deepEqual(receipts(), []);
    db.close(); assert.deepEqual(receipts(), []);
  } finally { if (db.open) db.close(); }
});
test('real route wiring only issues receipts after success, private order page keeps Google excluded', () => {
  const source = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.equal((source.match(/conversionHeader\(req,\s?res,\s?'sign_up'\)/g) || []).length, 2);
  assert.match(source, /insertOrder\(\);\s+adminAnalytics.recordOrderAttribution\(req, reference, 'marketplace'\);\s+adminAnalytics.recordCheckout/);
  assert.match(source, /measurementReceipts: orderMeasurementReceipts\(db, req, orders\)/);
  const page = readFileSync(new URL('../public/pedidos.html', import.meta.url), 'utf8');
  assert.match(page, /analytics\.js\?v=conversions/);
  assert.doesNotMatch(page, /data-vc-google-analytics|googletagmanager/);
});
