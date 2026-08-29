import { createHmac } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const appRoot = resolve(new URL('..', import.meta.url).pathname.replace(/^\/(.:)/, '$1'));
const projectRoot = resolve(appRoot, '..');
const envPath = process.env.BINANCE_LOCAL_ENV || resolve(projectRoot, '.env.binance.local');
const heartbeatPath = resolve(appRoot, '.binance-local-heartbeat.json');
const intervalMs = Math.max(60_000, Number(process.env.BINANCE_MONITOR_INTERVAL_MS || 300_000));

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).filter(line => line && !line.trimStart().startsWith('#')).map(line => {
    const index = line.indexOf('=');
    return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
  }));
}

async function config() {
  const values = parseEnv(await readFile(envPath, 'utf8'));
  if (!values.BINANCE_API_KEY || !values.BINANCE_API_SECRET) throw new Error('Credenciais locais da Binance não configuradas.');
  return {
    apiKey: values.BINANCE_API_KEY,
    apiSecret: values.BINANCE_API_SECRET,
    maxUsd: Number(values.BINANCE_MAX_USD || 50),
    mode: 'read_only',
    heartbeatUrl: values.VITRINECITY_HEARTBEAT_URL || '',
    heartbeatToken: values.VITRINECITY_HEARTBEAT_TOKEN || ''
  };
}

async function publishHeartbeat(cfg, heartbeat) {
  if (!cfg.heartbeatUrl || !cfg.heartbeatToken) return;
  const response = await fetch(cfg.heartbeatUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.heartbeatToken}` },
    body: JSON.stringify(heartbeat)
  });
  if (!response.ok) throw new Error(`Painel VitrineCity HTTP ${response.status}`);
}

async function signedAccount(cfg) {
  const query = `timestamp=${Date.now()}&recvWindow=5000`;
  const signature = createHmac('sha256', cfg.apiSecret).update(query).digest('hex');
  const response = await fetch(`https://api.binance.com/api/v3/account?${query}&signature=${signature}`, {
    headers: { 'X-MBX-APIKEY': cfg.apiKey }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Binance HTTP ${response.status}: ${data.msg || 'falha desconhecida'}`);
  return {
    connected: true,
    canTrade: Boolean(data.canTrade),
    canWithdraw: Boolean(data.canWithdraw),
    canDeposit: Boolean(data.canDeposit),
    assetsWithBalance: Array.isArray(data.balances)
      ? data.balances.filter(item => Number(item.free) + Number(item.locked) > 0).length
      : 0
  };
}

async function apiRestrictions(cfg) {
  const query = `timestamp=${Date.now()}&recvWindow=5000`;
  const signature = createHmac('sha256', cfg.apiSecret).update(query).digest('hex');
  const response = await fetch(`https://api.binance.com/sapi/v1/account/apiRestrictions?${query}&signature=${signature}`, {
    headers: { 'X-MBX-APIKEY': cfg.apiKey }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Binance restrictions HTTP ${response.status}: ${data.msg || 'falha desconhecida'}`);
  if (data.enableWithdrawals) throw new Error('Proteção acionada: a chave Binance permite saques. Desative saques antes de usar o executor.');
  return {
    ipRestricted: Boolean(data.ipRestrict),
    keyCanTradeSpot: Boolean(data.enableSpotAndMarginTrading),
    keyCanWithdraw: Boolean(data.enableWithdrawals)
  };
}

async function check() {
  const cfg = await config();
  try {
    const [account, restrictions] = await Promise.all([signedAccount(cfg), apiRestrictions(cfg)]);
    const heartbeat = { ok: true, checkedAt: new Date().toISOString(), mode: cfg.mode, maxUsd: cfg.maxUsd, ...restrictions, ...account };
    await writeFile(heartbeatPath, `${JSON.stringify(heartbeat, null, 2)}\n`, { mode: 0o600 });
    await publishHeartbeat(cfg, heartbeat);
    console.log(JSON.stringify(heartbeat));
  } catch (error) {
    const heartbeat = { ok: false, checkedAt: new Date().toISOString(), mode: cfg.mode, maxUsd: cfg.maxUsd, error: error.message };
    await writeFile(heartbeatPath, `${JSON.stringify(heartbeat, null, 2)}\n`, { mode: 0o600 });
    console.error(JSON.stringify(heartbeat));
    process.exitCode = 1;
  }
}

if (process.argv.includes('--once')) {
  await check();
} else {
  await check();
  setInterval(check, intervalMs);
}
