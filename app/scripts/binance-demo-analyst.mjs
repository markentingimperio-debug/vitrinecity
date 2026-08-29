import { createHmac } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const appRoot = resolve(new URL('..', import.meta.url).pathname.replace(/^\/(.:)/, '$1'));
const projectRoot = resolve(appRoot, '..');
const envPath = process.env.BINANCE_TESTNET_ENV || resolve(projectRoot, '.env.binance.testnet');
const statePath = resolve(appRoot, '.binance-demo-state.json');
const journalPath = resolve(appRoot, 'binance-demo-journal.jsonl');
const symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];

function env(text) {
  return Object.fromEntries(text.split(/\r?\n/).filter(x => x && !x.startsWith('#')).map(line => {
    const i = line.indexOf('='); return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
  }));
}
const cfgRaw = env(await readFile(envPath, 'utf8'));
const cfg = {
  key: cfgRaw.BINANCE_TESTNET_API_KEY,
  secret: cfgRaw.BINANCE_TESTNET_API_SECRET,
  base: cfgRaw.BINANCE_TESTNET_BASE_URL || 'https://testnet.binance.vision',
  maxUsd: Math.min(50, Number(cfgRaw.BINANCE_TESTNET_MAX_USD || 50)),
  orderUsd: Math.min(10, Number(cfgRaw.BINANCE_TESTNET_ORDER_USD || 10)),
  controlUrl: cfgRaw.VITRINECITY_DEMO_CONTROL_URL || '',
  reportUrl: cfgRaw.VITRINECITY_DEMO_REPORT_URL || '',
  panelToken: cfgRaw.VITRINECITY_HEARTBEAT_TOKEN || ''
};
if (!cfg.key || !cfg.secret || !cfg.base.includes('testnet.binance.vision')) throw new Error('Executor demo exige credenciais e URL do Binance Testnet.');

async function state() {
  try { return JSON.parse(await readFile(statePath, 'utf8')); }
  catch { return { environment: 'testnet', positions: {}, realizedPnlUsd: 0, orderCount: 0 }; }
}
async function saveState(value) { await writeFile(statePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); }
async function journal(value) { await appendFile(journalPath, `${JSON.stringify(value)}\n`, { mode: 0o600 }); }
async function panelRequest(url, options = {}) {
  if (!url || !cfg.panelToken) return null;
  const response = await fetch(url, { ...options, headers: { ...(options.headers || {}), authorization: `Bearer ${cfg.panelToken}` } });
  if (!response.ok) throw new Error(`Painel VitrineCity HTTP ${response.status}`);
  return response.json();
}
async function publish(record) {
  return panelRequest(cfg.reportUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(record) });
}
function ema(values, period) {
  const k = 2 / (period + 1); return values.reduce((v, x, i) => i ? x * k + v * (1 - k) : x, values[0]);
}
function rsi(values, period = 14) {
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const d = values[i] - values[i - 1]; if (d >= 0) gains += d; else losses -= d;
  }
  if (!losses) return 100; const rs = (gains / period) / (losses / period); return 100 - 100 / (1 + rs);
}
async function analysis(symbol) {
  const response = await fetch(`${cfg.base}/api/v3/klines?symbol=${symbol}&interval=15m&limit=60`);
  if (!response.ok) throw new Error(`Klines ${symbol} HTTP ${response.status}`);
  const rows = await response.json(); const closes = rows.map(x => Number(x[4])); const price = closes.at(-1);
  const fast = ema(closes.slice(-30), 9), slow = ema(closes.slice(-45), 21), strength = rsi(closes);
  const momentumPct = (price / closes.at(-5) - 1) * 100;
  const positives = [], negatives = [];
  if (fast > slow) positives.push('EMA9 acima da EMA21'); else negatives.push('EMA9 abaixo ou igual à EMA21');
  if (strength >= 50 && strength <= 68) positives.push(`RSI saudável em ${strength.toFixed(1)}`);
  else if (strength > 68) negatives.push(`RSI elevado em ${strength.toFixed(1)}`);
  else negatives.push(`RSI fraco em ${strength.toFixed(1)}`);
  if (momentumPct > 0) positives.push(`momento de 1h positivo em ${momentumPct.toFixed(2)}%`);
  else negatives.push(`momento de 1h negativo em ${momentumPct.toFixed(2)}%`);
  const score = (fast > slow ? 2 : -2) + (strength >= 50 && strength <= 68 ? 1 : -1) + (momentumPct > 0 ? 1 : -1);
  return { symbol, price, ema9: fast, ema21: slow, rsi: strength, momentum1hPct: momentumPct, score, positives, negatives };
}
function signed(params) {
  const query = new URLSearchParams(params).toString();
  return `${query}&signature=${createHmac('sha256', cfg.secret).update(query).digest('hex')}`;
}
async function order(params) {
  const body = signed({ ...params, newOrderRespType: 'FULL', timestamp: String(Date.now()), recvWindow: '5000' });
  const response = await fetch(`${cfg.base}/api/v3/order`, { method: 'POST', headers: { 'X-MBX-APIKEY': cfg.key, 'content-type': 'application/x-www-form-urlencoded' }, body });
  const data = await response.json(); if (!response.ok) throw new Error(`Ordem demo HTTP ${response.status}: ${data.msg || 'erro'}`); return data;
}

async function run() {
  const current = await state();
  const control = await panelRequest(cfg.controlUrl);
  if (control && !control.demoEnabled) {
    const record = { checkedAt: new Date().toISOString(), environment: 'Binance Spot Testnet', maxExposureUsd: cfg.maxUsd,
      reports: [], action: { type: 'OFF', reason: 'Robô demo desligado pelo painel administrativo.' },
      positions: current.positions, realizedPnlUsd: current.realizedPnlUsd };
    await journal(record); await publish(record); console.log(JSON.stringify(record)); return;
  }
  const reports = await Promise.all(symbols.map(analysis));
  const exposure = Object.values(current.positions).reduce((sum, p) => sum + p.entryQuoteUsd, 0);
  let action = { type: 'HOLD', reason: 'Nenhum sinal atingiu os critérios.' };
  for (const report of reports) {
    const position = current.positions[report.symbol];
    if (!position) continue;
    const pnlPct = (report.price / position.entryPrice - 1) * 100;
    if (pnlPct >= 2 || pnlPct <= -1 || report.score <= -2) {
      const result = await order({ symbol: report.symbol, side: 'SELL', type: 'MARKET', quantity: position.quantity });
      const quote = Number(result.cummulativeQuoteQty); const pnl = quote - position.entryQuoteUsd;
      current.realizedPnlUsd += pnl; current.orderCount += 1; delete current.positions[report.symbol];
      action = { type: 'SELL', symbol: report.symbol, orderId: result.orderId, quantity: result.executedQty, quoteUsd: quote, pnlUsd: pnl, reason: pnlPct >= 2 ? 'alvo de 2% atingido' : pnlPct <= -1 ? 'stop de 1% atingido' : 'tendência enfraqueceu' };
      break;
    }
  }
  if (action.type === 'HOLD' && exposure + cfg.orderUsd <= cfg.maxUsd) {
    const best = reports.filter(x => !current.positions[x.symbol]).sort((a, b) => b.score - a.score)[0];
    if (best?.score >= 3) {
      const result = await order({ symbol: best.symbol, side: 'BUY', type: 'MARKET', quoteOrderQty: String(cfg.orderUsd) });
      const quantity = result.executedQty, quote = Number(result.cummulativeQuoteQty);
      current.positions[best.symbol] = { quantity, entryQuoteUsd: quote, entryPrice: quote / Number(quantity), openedAt: new Date().toISOString(), orderId: result.orderId };
      current.orderCount += 1; action = { type: 'BUY', symbol: best.symbol, orderId: result.orderId, quantity, quoteUsd: quote, reason: 'melhor oportunidade com score mínimo de 3' };
    }
  }
  const record = { checkedAt: new Date().toISOString(), environment: 'Binance Spot Testnet', maxExposureUsd: cfg.maxUsd, reports, action, positions: current.positions, realizedPnlUsd: current.realizedPnlUsd };
  await saveState(current); await journal(record); await publish(record); console.log(JSON.stringify(record));
}
await run();
