// Manual, idempotent TESTNET telemetry import. Never executes the trading script.
import fs from 'node:fs';
import path from 'node:path';
import { createCryptoObservability, normalizeCryptoReport } from '../crypto-observability.js';
const [mode, input, output] = process.argv.slice(2);
if (!['export', 'import'].includes(mode) || !input || !output) throw new Error('Usage: export journal.jsonl sanitized.json | import sanitized.json existing.db');
if (fs.statSync(input).size > 20 * 1024 * 1024) throw new Error('Input exceeds 20 MB');
if (mode === 'export') {
  const lines = fs.readFileSync(input, 'utf8').trim().split(/\r?\n/); if (lines.length > 20000) throw new Error('Too many records');
  let invalid = 0;
  const records = lines.flatMap(line => {
    let raw; try { raw = JSON.parse(line); } catch { invalid++; return []; }
    if (raw.environment !== 'Binance Spot Testnet') { invalid++; return []; }
    const safe = normalizeCryptoReport(raw);
    if (!safe) { invalid++; return []; }
    // An opaque evidence marker preserves the reported-order flag without exposing exchange order IDs.
    return [{ ...safe, environment: 'Binance Spot Testnet', action: { ...safe.action, orderId: safe.action.reportedOrder ? 'reported-testnet-order' : null },
      positions: Object.fromEntries(safe.positions.map(item => [item.symbol, item])) }];
  });
  fs.writeFileSync(output, JSON.stringify({ format: 'vitrinecity-testnet-history-v1', records }), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ exported: records.length, invalid }));
} else {
  const payload = JSON.parse(fs.readFileSync(input, 'utf8'));
  if (payload.format !== 'vitrinecity-testnet-history-v1' || !Array.isArray(payload.records) || payload.records.length > 20000 ||
    payload.records.some(row => row.environment !== 'Binance Spot Testnet' || !normalizeCryptoReport(row))) throw new Error('Invalid sanitized history');
  if (!fs.existsSync(output)) throw new Error('Database must already exist');
  const Database = (await import('better-sqlite3')).default, db = new Database(output, { fileMustExist: true });
  db.pragma('busy_timeout = 5000');
  const backup = path.join(path.dirname(output), 'recovery-backups', `before-crypto-history-${Date.now()}.db`);
  fs.mkdirSync(path.dirname(backup), { recursive: true, mode: 0o700 });
  await db.backup(backup); fs.chmodSync(backup, 0o600);
  const controls = db.prepare('SELECT * FROM binance_trading_control').all();
  const history = createCryptoObservability(db);
  let inserted = 0;
  db.transaction(() => { for (const row of payload.records) if (history.record(row, 'journal')) inserted++; })();
  if (JSON.stringify(db.prepare('SELECT * FROM binance_trading_control').all()) !== JSON.stringify(controls)) throw new Error('Control unexpectedly changed');
  console.log(JSON.stringify({ inserted, duplicates: payload.records.length - inserted, backup, integrity: db.pragma('integrity_check', { simple: true }) }));
  db.close();
}
