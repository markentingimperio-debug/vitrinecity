// PRIVATE TEST PREVIEW ONLY. No production DB, no exchange connections, no trading routes.
import express from 'express';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { createCryptoObservability, mountCryptoObservability } from '../crypto-observability.js';
import { seedCryptoTables, fixtureReport } from './crypto-matrix-fixtures.mjs';
const app = express(), db = new Database(':memory:'), now = Date.now(); seedCryptoTables(db, now);
const obs = createCryptoObservability(db);
for (let day = 8; day > 0; day--) obs.record(fixtureReport(now - day * 86400000, day % 2 ? 'SELL' : 'BUY', 'BTCUSDT', day % 2 ? -0.05 : null));
const off = fixtureReport(now, 'OFF'); off.reports = []; off.realizedPnlUsd = -0.2; obs.record(off);
mountCryptoObservability({ app, observability: obs, requireAdmin: (_req, _res, next) => next() });
app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));
const server = app.listen(4301, process.env.PREVIEW_BIND_ALL === '1' ? '0.0.0.0' : '127.0.0.1', () => console.log('Synthetic Crypto Matrix preview ready on 4301'));
process.on('SIGTERM', () => { server.closeAllConnections(); server.close(() => { db.close(); process.exit(0); }); });
