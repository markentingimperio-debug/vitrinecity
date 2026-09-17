import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

const HOST = process.env.LIA_GATEWAY_HOST || '127.0.0.1';
const PORT = Number(process.env.LIA_GATEWAY_PORT || 8787);
const DATA_DIR = path.resolve(process.env.LIA_DATA_DIR || '/opt/lia/data');
const TASKS_FILE = path.join(DATA_DIR, 'dev-tasks.json');
const TOKEN = String(process.env.LIA_GATEWAY_TOKEN || '');
const MAX_BODY_BYTES = 64 * 1024;
const MAX_INSTRUCTION_CHARS = 8000;
const DEFAULT_MAX_TASK_BUDGET_USD = 1.00;
const MAX_TASK_BUDGET_USD = Number(process.env.LIA_MAX_TASK_BUDGET_USD || DEFAULT_MAX_TASK_BUDGET_USD);
const MAX_DAILY_BUDGET_USD = Number(process.env.LIA_MAX_DAILY_BUDGET_USD || 5.00);
const MAX_TASKS_RETAINED = 500;

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('invalid_port');
if (!Number.isFinite(MAX_TASK_BUDGET_USD) || MAX_TASK_BUDGET_USD <= 0) throw new Error('invalid_task_budget');
if (!Number.isFinite(MAX_DAILY_BUDGET_USD) || MAX_DAILY_BUDGET_USD <= 0) throw new Error('invalid_daily_budget');
if (TOKEN.length < 32) throw new Error('LIA_GATEWAY_TOKEN must have at least 32 characters');

await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o750 });

let tasks = [];
try {
  const raw = await fs.readFile(TASKS_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) tasks = parsed;
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

function isoNow() { return new Date().toISOString(); }
function dayKey(value = new Date()) { return value.toISOString().slice(0, 10); }
function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function safeEqual(a, b) {
  const aa = Buffer.from(sha256(a));
  const bb = Buffer.from(sha256(b));
  return timingSafeEqual(aa, bb);
}
function authorized(req) {
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const header = String(req.headers['x-lia-gateway-token'] || '');
  return (bearer && safeEqual(bearer, TOKEN)) || (header && safeEqual(header, TOKEN));
}
function send(res, status, payload) {
  const raw = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(raw),
  });
  res.end(raw);
}
async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('payload_too_large'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('invalid_json'), { status: 400 }); }
}
async function persist() {
  if (tasks.length > MAX_TASKS_RETAINED) tasks = tasks.slice(-MAX_TASKS_RETAINED);
  const tmp = `${TASKS_FILE}.tmp-${process.pid}`;
  await fs.writeFile(tmp, `${JSON.stringify(tasks, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, TASKS_FILE);
}
function findTask(id) { return tasks.find((task) => task.id === id); }
function publicTask(task) {
  return {
    id: task.id,
    status: task.status,
    instruction: task.instruction,
    requestedBudgetUsd: task.requestedBudgetUsd,
    authorizedBudgetUsd: task.authorizedBudgetUsd,
    spentUsd: task.spentUsd,
    modelPolicy: task.modelPolicy,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    authorizedAt: task.authorizedAt || null,
    cancelledAt: task.cancelledAt || null,
    note: task.note || null,
  };
}
function todayAuthorizedUsd() {
  const today = dayKey();
  return tasks
    .filter((task) => String(task.authorizedAt || '').startsWith(today) && task.status !== 'cancelled')
    .reduce((sum, task) => sum + Number(task.authorizedBudgetUsd || 0), 0);
}
function validMoney(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && Math.round(value * 1000000) === value * 1000000;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, {
        ok: true,
        service: 'lia-dev-gateway',
        version: '2026-09-17-v1',
        executionEnabled: false,
        openaiConfigured: false,
        bind: HOST,
      });
    }

    if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });

    if (req.method === 'GET' && url.pathname === '/v1/budget') {
      return send(res, 200, {
        maxTaskBudgetUsd: MAX_TASK_BUDGET_USD,
        maxDailyBudgetUsd: MAX_DAILY_BUDGET_USD,
        authorizedTodayUsd: Number(todayAuthorizedUsd().toFixed(6)),
        executionEnabled: false,
      });
    }

    if (req.method === 'GET' && url.pathname === '/v1/tasks') {
      return send(res, 200, { tasks: tasks.slice(-100).reverse().map(publicTask) });
    }

    if (req.method === 'POST' && url.pathname === '/v1/tasks') {
      const body = await readJson(req);
      const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
      const requestedBudgetUsd = Number(body.requestedBudgetUsd);
      if (!instruction || instruction.length > MAX_INSTRUCTION_CHARS) return send(res, 400, { error: 'invalid_instruction' });
      if (!validMoney(requestedBudgetUsd) || requestedBudgetUsd > MAX_TASK_BUDGET_USD) {
        return send(res, 400, { error: 'invalid_requested_budget', maxTaskBudgetUsd: MAX_TASK_BUDGET_USD });
      }
      const now = isoNow();
      const task = {
        id: randomUUID(),
        status: 'draft',
        instruction,
        requestedBudgetUsd,
        authorizedBudgetUsd: 0,
        spentUsd: 0,
        modelPolicy: 'blocked_until_executor_phase',
        createdAt: now,
        updatedAt: now,
        note: 'Nenhuma API de IA pode ser chamada nesta fase.',
      };
      tasks.push(task);
      await persist();
      return send(res, 201, { task: publicTask(task) });
    }

    const match = url.pathname.match(/^\/v1\/tasks\/([0-9a-f-]+)\/(authorize|cancel)$/i);
    if (req.method === 'POST' && match) {
      const [, id, action] = match;
      const task = findTask(id);
      if (!task) return send(res, 404, { error: 'task_not_found' });

      if (action === 'cancel') {
        if (task.status === 'cancelled') return send(res, 200, { task: publicTask(task), duplicate: true });
        if (!['draft', 'authorized'].includes(task.status)) return send(res, 409, { error: 'task_not_cancellable' });
        task.status = 'cancelled';
        task.cancelledAt = isoNow();
        task.updatedAt = task.cancelledAt;
        await persist();
        return send(res, 200, { task: publicTask(task) });
      }

      if (task.status !== 'draft') return send(res, 409, { error: 'task_not_authorizable' });
      const body = await readJson(req);
      const budgetUsd = Number(body.budgetUsd);
      if (!validMoney(budgetUsd) || budgetUsd > task.requestedBudgetUsd || budgetUsd > MAX_TASK_BUDGET_USD) {
        return send(res, 400, { error: 'invalid_authorized_budget', maxTaskBudgetUsd: MAX_TASK_BUDGET_USD });
      }
      const projected = todayAuthorizedUsd() + budgetUsd;
      if (projected > MAX_DAILY_BUDGET_USD + 1e-9) {
        return send(res, 409, {
          error: 'daily_budget_exceeded',
          authorizedTodayUsd: Number(todayAuthorizedUsd().toFixed(6)),
          maxDailyBudgetUsd: MAX_DAILY_BUDGET_USD,
        });
      }
      task.status = 'authorized';
      task.authorizedBudgetUsd = budgetUsd;
      task.authorizedAt = isoNow();
      task.updatedAt = task.authorizedAt;
      task.note = 'Orçamento reservado, mas execução permanece desativada até a fase do executor.';
      await persist();
      return send(res, 200, { task: publicTask(task) });
    }

    return send(res, 404, { error: 'not_found' });
  } catch (error) {
    return send(res, error?.status || 500, { error: error?.status ? error.message : 'internal_error' });
  }
});

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({
    event: 'lia_dev_gateway_started',
    host: HOST,
    port: PORT,
    executionEnabled: false,
    openaiConfigured: false,
  }));
});
