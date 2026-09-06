import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import express from 'express';
import Database from 'better-sqlite3';
import { createCryptoObservability, mountCryptoObservability, normalizeCryptoReport } from '../crypto-observability.js';
import { seedCryptoTables, fixtureReport } from './crypto-matrix-fixtures.mjs';
const now = Date.now(), db = new Database(':memory:'); seedCryptoTables(db, now);
const crypto = createCryptoObservability(db);
assert.equal(crypto.snapshot(30, now).summary.cycles, 0);
assert.equal(crypto.snapshot(30, now).summary.winRate, null);
assert.equal(crypto.snapshot(30, now).summary.realizedInPeriod, null);
assert.equal(crypto.snapshot(30, now).monitor.status, 'read_only');
assert.equal(crypto.snapshot(30, now + 13 * 60000).monitor.status, 'stale');
assert.throws(() => crypto.snapshot(10000, now), RangeError);
const buy = fixtureReport(now - 3 * 86400000, 'BUY');
assert.equal(crypto.record(buy, 'journal', now), true);
assert.equal(crypto.record(buy, 'executor', now), false, 'Retries must not duplicate orders');
assert.equal(crypto.record(fixtureReport(now - 2 * 86400000, 'SELL', 'BTCUSDT', 0.2), 'journal', now), true);
assert.equal(crypto.record(fixtureReport(now - 86400000, 'SELL', 'ETHUSDT', -0.4), 'journal', now), true);
const off = fixtureReport(now, 'OFF'); off.reports = []; off.realizedPnlUsd = -0.2;
crypto.record(off, 'executor', now);
const report = crypto.snapshot(30, now);
assert.equal(report.summary.cycles, 4); assert.equal(report.summary.offCycles, 1);
assert.equal(report.summary.buys, 1); assert.equal(report.summary.sells, 2);
assert.equal(report.summary.realizedInPeriod, -0.2); assert.equal(report.summary.winRate, 50);
assert.equal(report.latest.action.type, 'OFF'); assert.equal(report.latest.stale, false);
assert.equal(report.agents[0].stale, true); assert.equal(report.agents[0].signal.score, 2);
assert.equal(report.agents[0].orders, 2); assert.equal(report.agents[0].pnlUsd, 0.2);
assert.equal(report.series.length, 4); assert.equal(report.series.at(-1).value, -0.2);
assert.equal(report.timeline.length, 3); assert.equal(report.realLocked, true); assert.equal(report.demoEnabled, false);
assert.equal(report.evidence.automaticLearning, false); assert.equal(report.evidence.backtest, false);
assert.equal(JSON.stringify(report).includes('orderId'), false);
for (const invalid of [null, {}, { ...buy, checkedAt: 'not-a-date' }, { ...buy, checkedAt: new Date(now + 600000).toISOString() },
  { ...buy, environment: 'production' }, { ...buy, action: { type: 'WITHDRAW' } }, { ...buy, action: { type: 'BUY', symbol: 'FAKE' } }]) {
  assert.equal(crypto.record(invalid, 'journal', now), false);
}
const hostile = fixtureReport(now - 1, 'HOLD'); hostile.reports[0].price = Infinity; hostile.reports[0].positives = ['<img src=x onerror=alert(1)>'];
hostile.positions = { BTCUSDT: { quantity: 1, entryQuoteUsd: NaN, privateKey: 'NEVER_STORE' } }; hostile.secret = 'NEVER_STORE';
const safe = normalizeCryptoReport(hostile, now);
assert.equal(safe.reports[0].price, null); assert.equal(safe.positions[0].entryQuoteUsd, null);
assert.equal(JSON.stringify(safe).includes('NEVER_STORE'), false);
const rawSource = readFileSync(new URL('../public/crypto-matrix.js', import.meta.url), 'utf8');
assert.doesNotMatch(rawSource, /innerHTML|localStorage|Math\.random|\/api\/v3\/order|method:\s*['"](?:POST|PATCH)/);
assert.match(rawSource, /textContent/); assert.match(rawSource, /AbortController/);
const serverSource = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
assert.match(serverSource, /mountCryptoObservability\(\{ app, requireAdmin, observability: cryptoObservability \}\)/);
assert.match(serverSource, /if \(!requireBinanceLocalToken\(req, res\)\) return;[\s\S]*cryptoObservability\.record\(body\)/);
// Runtime HTTP contract: auth precedes snapshot; read requests cannot change controls/history.
const app = express();
mountCryptoObservability({ app, observability: crypto, requireAdmin: (req, res, next) => {
  if (req.headers['x-fixture-admin'] === 'yes') next(); else res.status(401).end();
} });
const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}/api/admin/crypto-matrix`;
try {
  const before = db.prepare('SELECT * FROM binance_trading_control').all();
  assert.equal((await fetch(base)).status, 401);
  const good = await fetch(base, { headers: { 'x-fixture-admin': 'yes' } });
  assert.equal(good.status, 200); assert.equal(good.headers.get('cache-control'), 'no-store');
  assert.equal((await good.json()).realLocked, true);
  for (const days of ['1', '1000', '30%20OR%201=1', 'NaN']) assert.equal((await fetch(`${base}?days=${days}`, { headers: { 'x-fixture-admin': 'yes' } })).status, 400);
  assert.equal((await fetch(base, { method: 'POST', headers: { 'x-fixture-admin': 'yes' } })).status, 404);
  assert.deepEqual(db.prepare('SELECT * FROM binance_trading_control').all(), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM crypto_matrix_history').get().n, 4);
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); }
console.log('Crypto Matrix: normalization, deduplication, P&L, stale/off states, privacy, read-only and HTTP auth checks passed.');
