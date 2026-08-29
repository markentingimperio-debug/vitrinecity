import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
const executor = readFileSync(new URL('./binance-local-executor.mjs', import.meta.url), 'utf8');
const demo = readFileSync(new URL('./binance-demo-analyst.mjs', import.meta.url), 'utf8');

assert.match(server, /BINANCE_LOCAL_HEARTBEAT_TOKEN/);
assert.match(server, /timingSafeEqual\(configuredHash, suppliedHash\)/);
assert.match(server, /key_can_withdraw/);
assert.match(server, /\/api\/admin\/integrations\/binance-local/);
assert.match(admin, /Binance · Executor local/);
assert.match(admin, /CONECTADO · SOMENTE LEITURA/);
assert.match(executor, /apiRestrictions/);
assert.match(executor, /Proteção acionada: a chave Binance permite saques/);
assert.doesNotMatch(executor, /\/api\/v3\/order/);
assert.match(demo, /testnet\.binance\.vision/);
assert.match(demo, /Math\.min\(50/);
assert.match(demo, /binance-demo-journal\.jsonl/);
assert.doesNotMatch(demo, /fapi|margin|withdraw/i);
console.log('binance local integration tests passed');
