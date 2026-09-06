// Read-only observability. This module never contacts an exchange or changes trading controls.
export const CRYPTO_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];
const ACTIONS = ['BUY', 'SELL', 'HOLD', 'OFF'];
const numeric = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12 ? value : null;
const text = (value, size = 160) => typeof value === 'string' ? value.slice(0, size) : '';
const parse = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };
const iso = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(value)) return null;
  const time = Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};
const stale = (value, now, minutes) => !iso(value) || now - Date.parse(iso(value)) > minutes * 60000 || Date.parse(iso(value)) > now + 300000;

export function normalizeCryptoReport(body, now = Date.now()) {
  const checkedAt = iso(body?.checkedAt);
  if (!checkedAt || Date.parse(checkedAt) < Date.UTC(2020, 0, 1) || Date.parse(checkedAt) > now + 300000 ||
      !ACTIONS.includes(body?.action?.type) || (body.environment && body.environment !== 'Binance Spot Testnet')) return null;
  const action = body.action;
  if (['BUY', 'SELL'].includes(action.type) && !CRYPTO_SYMBOLS.includes(action.symbol)) return null;
  const reports = CRYPTO_SYMBOLS.flatMap(symbol => {
    const item = Array.isArray(body.reports) ? body.reports.find(row => row?.symbol === symbol) : null;
    if (!item) return [];
    return [{ symbol, price: numeric(item.price), score: numeric(item.score), rsi: numeric(item.rsi),
      ema9: numeric(item.ema9), ema21: numeric(item.ema21), momentum1hPct: numeric(item.momentum1hPct),
      positives: Array.isArray(item.positives) ? item.positives.slice(0, 5).map(x => text(x)) : [],
      negatives: Array.isArray(item.negatives) ? item.negatives.slice(0, 5).map(x => text(x)) : [] }];
  });
  const positions = CRYPTO_SYMBOLS.flatMap(symbol => {
    const position = body.positions?.[symbol];
    return position && numeric(position.quantity) > 0 ? [{ symbol, quantity: numeric(position.quantity),
      entryQuoteUsd: numeric(position.entryQuoteUsd), entryPrice: numeric(position.entryPrice), openedAt: iso(position.openedAt) }] : [];
  });
  return { checkedAt, action: { type: action.type, symbol: CRYPTO_SYMBOLS.includes(action.symbol) ? action.symbol : null,
    reason: text(action.reason, 300), quoteUsd: numeric(action.quoteUsd), pnlUsd: numeric(action.pnlUsd),
    // Evidence reported by our testnet executor, not independently reconciled with the exchange.
    reportedOrder: ['BUY', 'SELL'].includes(action.type) && Boolean(action.orderId) },
  reports, positions, realizedPnlUsd: numeric(body.realizedPnlUsd) };
}

export function createCryptoObservability(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS crypto_matrix_history (
    checked_at TEXT PRIMARY KEY, action_type TEXT NOT NULL, symbol TEXT,
    reported_order INTEGER NOT NULL, pnl_usd REAL, realized_pnl_usd REAL,
    report_json TEXT NOT NULL, source TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ); CREATE INDEX IF NOT EXISTS idx_crypto_matrix_action ON crypto_matrix_history(action_type, checked_at);`);
  const insert = db.prepare(`INSERT OR IGNORE INTO crypto_matrix_history
    (checked_at,action_type,symbol,reported_order,pnl_usd,realized_pnl_usd,report_json,source) VALUES (?,?,?,?,?,?,?,?)`);
  function record(body, source = 'executor', now = Date.now()) {
    const item = normalizeCryptoReport(body, now);
    if (!item || !['executor', 'journal', 'snapshot'].includes(source)) return false;
    return insert.run(item.checkedAt, item.action.type, item.action.symbol, Number(item.action.reportedOrder),
      item.action.pnlUsd, item.realizedPnlUsd, JSON.stringify(item), source).changes === 1;
  }
  function seedLatest() {
    const row = db.prepare('SELECT * FROM binance_demo_report WHERE id=1').get();
    if (row) record({ checkedAt: row.checked_at, action: parse(row.action_json, {}), reports: parse(row.reports_json, []),
      positions: parse(row.positions_json, {}), realizedPnlUsd: row.realized_pnl_usd }, 'snapshot');
  }
  function snapshot(days = 30, now = Date.now()) {
    if (![7, 30, 90].includes(days)) throw new RangeError('Período inválido');
    const since = new Date(now - days * 86400000).toISOString();
    const until = new Date(now + 300000).toISOString();
    const control = db.prepare('SELECT demo_enabled,updated_at FROM binance_trading_control WHERE id=1').get();
    const heartbeat = db.prepare('SELECT ok,mode,connected,key_can_withdraw,executor_checked_at,received_at FROM binance_local_heartbeat WHERE id=1').get();
    const last = db.prepare('SELECT report_json,source,received_at FROM crypto_matrix_history ORDER BY checked_at DESC LIMIT 1').get();
    const latest = last ? parse(last.report_json, null) : null;
    const summary = db.prepare(`SELECT COUNT(*) AS cycles, MIN(checked_at) AS firstAt, MAX(checked_at) AS lastAt,
      SUM(CASE WHEN action_type='OFF' THEN 1 ELSE 0 END) AS offCycles,
      SUM(CASE WHEN action_type='BUY' AND reported_order=1 THEN 1 ELSE 0 END) AS buys,
      SUM(CASE WHEN action_type='SELL' AND reported_order=1 THEN 1 ELSE 0 END) AS sells,
      SUM(CASE WHEN action_type='SELL' AND reported_order=1 THEN pnl_usd END) AS realizedInPeriod,
      SUM(CASE WHEN action_type='SELL' AND reported_order=1 AND pnl_usd>0 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN action_type='SELL' AND reported_order=1 AND pnl_usd<0 THEN 1 ELSE 0 END) AS losses,
      SUM(CASE WHEN action_type='SELL' AND reported_order=1 AND pnl_usd IS NOT NULL THEN 1 ELSE 0 END) AS pricedSells
      FROM crypto_matrix_history WHERE checked_at BETWEEN ? AND ?`).get(since, until);
    for (const key of ['offCycles', 'buys', 'sells', 'wins', 'losses', 'pricedSells']) summary[key] ||= 0;
    summary.winRate = summary.pricedSells ? summary.wins / summary.pricedSells * 100 : null;
    const series = db.prepare(`SELECT checked_at,realized_pnl_usd FROM crypto_matrix_history
      WHERE checked_at IN (SELECT MAX(checked_at) FROM crypto_matrix_history
        WHERE checked_at BETWEEN ? AND ? AND realized_pnl_usd IS NOT NULL GROUP BY substr(checked_at,1,10))
      ORDER BY checked_at`).all(since, until).map(row => ({ at: row.checked_at, value: row.realized_pnl_usd }));
    const agents = CRYPTO_SYMBOLS.map(symbol => {
      const recent = db.prepare(`SELECT report_json FROM crypto_matrix_history WHERE checked_at<=? AND
        EXISTS (SELECT 1 FROM json_each(report_json,'$.reports') WHERE json_extract(value,'$.symbol')=?)
        ORDER BY checked_at DESC LIMIT 1`).get(until, symbol);
      const report = recent ? parse(recent.report_json, null) : null;
      const stats = db.prepare(`SELECT COUNT(*) AS orders,
        SUM(CASE WHEN action_type='SELL' THEN 1 ELSE 0 END) AS exits,
        SUM(CASE WHEN action_type='SELL' AND pnl_usd IS NOT NULL THEN 1 ELSE 0 END) AS pricedExits,
        SUM(CASE WHEN action_type='SELL' THEN pnl_usd END) AS pnlUsd
        FROM crypto_matrix_history WHERE symbol=? AND reported_order=1 AND checked_at BETWEEN ? AND ?`).get(symbol, since, until);
      return { symbol, strategyVersion: 'EMA-RSI v1', checkedAt: report?.checkedAt || null,
        stale: stale(report?.checkedAt, now, 30), signal: report?.reports.find(item => item.symbol === symbol) || null,
        ...stats, pnlUsd: stats.pricedExits === stats.exits ? stats.pnlUsd : null, exits: stats.exits || 0 };
    });
    const timeline = db.prepare(`SELECT report_json,source FROM crypto_matrix_history
      WHERE checked_at BETWEEN ? AND ? AND action_type IN ('BUY','SELL') ORDER BY checked_at DESC LIMIT 50`).all(since, until)
      .map(row => { const report = parse(row.report_json, {}); return { at: report.checkedAt, ...report.action, source: row.source }; });
    const monitorStale = stale(heartbeat?.received_at, now, 12) || stale(heartbeat?.executor_checked_at, now, 12);
    return { generatedAt: new Date(now).toISOString(), days, environment: 'Binance Spot Testnet', realLocked: true,
      demoEnabled: control ? Boolean(control.demo_enabled) : null, controlUpdatedAt: control?.updated_at || null,
      monitor: { status: !heartbeat ? 'unknown' : monitorStale ? 'stale' :
        heartbeat.ok && heartbeat.connected && heartbeat.mode === 'read_only' && !heartbeat.key_can_withdraw ? 'read_only' : 'attention',
      checkedAt: heartbeat?.executor_checked_at || null },
      latest: latest ? { ...latest, source: last.source, receivedAt: last.received_at, stale: stale(latest.checkedAt, now, 30) } : null,
      summary, series, agents, timeline,
      evidence: { storage: 'VPS · SQLite', historicalSource: 'Journal do executor / relatórios recebidos',
        strategy: 'EMA 9/21 + RSI 14 + momentum de 1h · candles de 15 min',
        version: 'EMA-RSI v1', backtest: false, outOfSample: false, automaticLearning: false, exchangeReconciled: false } };
  }
  return { record, seedLatest, snapshot };
}

export function mountCryptoObservability({ app, requireAdmin, observability }) {
  app.get('/api/admin/crypto-matrix', requireAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const days = req.query.days === undefined ? 30 : Number(req.query.days);
    if (![7, 30, 90].includes(days)) return res.status(400).json({ error: 'Escolha 7, 30 ou 90 dias.' });
    try { return res.json(observability.snapshot(days)); }
    catch { return res.status(503).json({ error: 'Histórico temporariamente indisponível. Tente atualizar novamente.' }); }
  });
}
