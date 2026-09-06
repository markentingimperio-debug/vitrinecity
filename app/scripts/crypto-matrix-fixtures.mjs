// Synthetic data exclusively for tests and isolated previews. Never import into production.
export function seedCryptoTables(db, now = Date.now()) {
  db.exec(`CREATE TABLE binance_trading_control(id INTEGER PRIMARY KEY,demo_enabled INTEGER,real_enabled INTEGER,updated_at TEXT);
    CREATE TABLE binance_local_heartbeat(id INTEGER PRIMARY KEY,ok INTEGER,mode TEXT,connected INTEGER,key_can_withdraw INTEGER,executor_checked_at TEXT,received_at TEXT);
    CREATE TABLE binance_demo_report(id INTEGER PRIMARY KEY,checked_at TEXT,action_json TEXT,reports_json TEXT,positions_json TEXT,realized_pnl_usd REAL);
    INSERT INTO binance_trading_control VALUES(1,0,0,'2026-09-01 18:46:07');`);
  db.prepare('INSERT INTO binance_local_heartbeat VALUES(1,1,?,1,0,?,?)').run('read_only', new Date(now).toISOString(), new Date(now).toISOString());
}
export function fixtureReport(now, type = 'HOLD', symbol = 'BTCUSDT', pnlUsd = null) {
  return { environment: 'Binance Spot Testnet', checkedAt: new Date(now).toISOString(),
    action: { type, symbol, reason: type === 'SELL' ? 'Saída de teste: critério da estratégia atingido.' : 'Sinal demonstrativo da prévia isolada.',
      orderId: ['BUY','SELL'].includes(type) ? 'fixture-only' : null, pnlUsd, quoteUsd: 10 },
    reports: ['BTCUSDT','ETHUSDT','BNBUSDT'].map((symbol, i) => ({ symbol, price: [77800,2440,690][i], score: 2,
      rsi: 61.3, momentum1hPct: -0.14, ema9: 25, ema21: 24, positives: ['EMA9 acima da EMA21'], negatives: ['Momento de 1h negativo'] })),
    realizedPnlUsd: pnlUsd ?? 0, positions: {} };
}
