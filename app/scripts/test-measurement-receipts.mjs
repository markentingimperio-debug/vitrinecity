import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../public/measurement-receipts.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const tx = 'vc_' + 'a'.repeat(32);
const purchase = { key: 'purchase_' + tx, event: 'purchase', params: { transaction_id: tx, currency: 'BRL', value: 25, shipping: 5,
  items: [{ item_id: 'p_42', price: 12.5, quantity: 2, item_name: 'Private' }], email: 'secret@example.test' } };
function page({ accepted = true, conversion = true, blocked = false, seed = [], locks = false } = {}) {
  const values = new Map(seed), calls = [], events = [], lockCalls = [];
  if (accepted) for (const key of ['vc_analytics_consent', 'vc_google_analytics_consent_v1']) values.set(key, 'accepted');
  if (conversion) values.set('vc_conversion_measurement_consent_v1', 'accepted');
  let lockTail = Promise.resolve();
  const sandbox = { Date, Event, document: { dispatchEvent: e => events.push(e.type) },
    localStorage: { getItem: key => { if (blocked) throw Error('blocked'); return values.get(key); },
      setItem: (key, value) => { if (blocked) throw Error('blocked'); values.set(key, value); }, removeItem: key => values.delete(key) },
    navigator: locks ? { locks: { request: (key, action) => { lockCalls.push(key); lockTail = lockTail.then(action); return lockTail; } } } : {}
  };
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  const flush = () => sandbox.flushReceipts((...args) => calls.push(args), { page_location: 'https://vitrinecity.com/' }, 'G-0V9KJQMH0V');
  return { sandbox, values, calls, events, lockCalls, flush };
}
test('receipts are opt-in only, sanitized and validated; no customer fields reach Google', async () => {
  for (const options of [{ accepted: false }, { conversion: false }, { blocked: true }]) {
    const p = page(options); p.sandbox.enqueueReceipts([purchase]); await p.flush(); assert.equal(p.calls.length, 0);
  }
  const p = page(); p.sandbox.enqueueReceipts([purchase]); await p.flush();
  assert.equal(p.calls.length, 1); assert.equal(p.calls[0][1], 'purchase');
  assert.equal(p.calls[0][2].value, 25); assert.equal(p.calls[0][2].shipping, 5);
  assert.doesNotMatch(JSON.stringify(p.calls), /Private|secret|email|item_name/);
  for (const value of [{ ...purchase, event: 'custom' }, { ...purchase, key: 'bad@key' },
    { ...purchase, params: { ...purchase.params, value: '25' } },
    { ...purchase, params: { ...purchase.params, value: 30 } },
    { ...purchase, params: { ...purchase.params, transaction_id: 'raw-order-id' } },
    { ...purchase, params: { ...purchase.params, items: [] } }]) {
    assert.equal(p.sandbox.sanitizeReceipt(value), null);
  }
});
test('private-page queue survives navigation and dispatches once; replay and concurrent flushes do not duplicate', async () => {
  const privatePage = page(); privatePage.sandbox.enqueueReceipts([purchase, purchase]); assert.equal(privatePage.calls.length, 0);
  const publicPage = page({ seed: [...privatePage.values], locks: true });
  await Promise.all([publicPage.flush(), publicPage.flush()]);
  assert.equal(publicPage.calls.length, 1); assert.equal(publicPage.lockCalls.length, 2);
  publicPage.sandbox.enqueueReceipts([purchase]); await publicPage.flush(); assert.equal(publicPage.calls.length, 1);
  publicPage.sandbox.enqueueReceipts([{ key: 'signup_12345678', event: 'sign_up', params: { password: 'secret' } }]);
  await publicPage.flush(); assert.equal(publicPage.calls[1][1], 'sign_up'); assert.doesNotMatch(JSON.stringify(publicPage.calls), /password|secret/);
});
test('refund requires a tracked purchase, revocation and expiry discard pending receipts', async () => {
  const p = page(), refund = { ...purchase, key: 'refund_' + tx, event: 'refund' };
  p.sandbox.enqueueReceipts([refund]); await p.flush(); assert.equal(p.calls.length, 0);
  p.sandbox.enqueueReceipts([purchase]); await p.flush();
  p.sandbox.enqueueReceipts([refund]); await p.flush(); assert.deepEqual(p.calls.map(c => c[1]), ['purchase', 'refund']);
  p.sandbox.enqueueReceipts([{ key: 'signup_pending', event: 'sign_up' }]);
  p.values.set('vc_conversion_measurement_consent_v1', 'essential');
  await p.flush(); assert.equal(p.calls.length, 2); assert.equal(p.values.has('vc_measurement_pending_v1'), false);
  const stale = page({ seed: [['vc_measurement_pending_v1', JSON.stringify([{ ...purchase, at: Date.now() - 8 * 86400000 }])]] });
  await stale.flush(); assert.equal(stale.calls.length, 0);
  stale.values.set('vc_measurement_pending_v1', '{invalid'); await stale.flush(); assert.equal(stale.calls.length, 0);
});
