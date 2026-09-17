import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Codex } from '@openai/codex-sdk';

const HOST = process.env.LIA_CODEX_HOST || '127.0.0.1';
const PORT = Number(process.env.LIA_CODEX_PORT || 8790);
const TOKEN = String(process.env.LIA_CODEX_WORKER_TOKEN || '');
const WORKSPACE_ROOT = path.resolve(process.env.LIA_CODEX_WORKSPACE_ROOT || '/opt/lia/workspaces');
const EXECUTION_ENABLED = process.env.LIA_CODEX_EXECUTION_ENABLED === '1';
const OPENAI_CONFIGURED = Boolean(String(process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY || '').trim());
const MAX_BODY_BYTES = 64 * 1024;
const MAX_INSTRUCTION_CHARS = 8000;

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('invalid_port');
if (TOKEN.length < 32) throw new Error('LIA_CODEX_WORKER_TOKEN must have at least 32 characters');

await fs.mkdir(WORKSPACE_ROOT, { recursive: true, mode: 0o750 });

// Importing/constructing the SDK does not start a model turn.
const codex = new Codex({ env: { PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin' } });
if (!codex || typeof codex.startThread !== 'function') throw new Error('codex_sdk_unavailable');

function sha256(value) {
  return createHash('sha256').update(String(value)).digest();
}
function safeEqual(a, b) {
  const aa = sha256(a);
  const bb = sha256(b);
  return timingSafeEqual(aa, bb);
}
function authorized(req) {
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const header = String(req.headers['x-lia-codex-token'] || '');
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
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('invalid_json'), { status: 400 });
  }
}
function validWorkspaceName(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value);
}
async function workspaceInfo(name) {
  if (!validWorkspaceName(name)) throw Object.assign(new Error('invalid_workspace'), { status: 400 });
  const root = path.resolve(WORKSPACE_ROOT);
  const target = path.resolve(root, name);
  if (target === root || !target.startsWith(root + path.sep)) throw Object.assign(new Error('invalid_workspace'), { status: 400 });
  let real;
  try {
    real = await fs.realpath(target);
  } catch (error) {
    if (error?.code === 'ENOENT') throw Object.assign(new Error('workspace_not_found'), { status: 404 });
    throw error;
  }
  if (real === root || !real.startsWith(root + path.sep)) throw Object.assign(new Error('workspace_escape_blocked'), { status: 400 });
  const git = path.join(real, '.git');
  try {
    const stat = await fs.stat(git);
    if (!stat.isDirectory() && !stat.isFile()) throw new Error('not_git');
  } catch {
    throw Object.assign(new Error('workspace_not_git'), { status: 400 });
  }
  return { name, path: real };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, {
        ok: true,
        service: 'lia-codex-worker',
        version: '2026-09-17-v1',
        sdkLoaded: true,
        executionEnabled: EXECUTION_ENABLED,
        openaiConfigured: OPENAI_CONFIGURED,
        bind: HOST,
      });
    }

    if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });

    if (req.method === 'GET' && url.pathname === '/v1/capabilities') {
      return send(res, 200, {
        sdk: '@openai/codex-sdk',
        executionEnabled: EXECUTION_ENABLED,
        openaiConfigured: OPENAI_CONFIGURED,
        sandboxPolicy: 'workspace-write when later enabled',
        webSearch: false,
        networkAccess: false,
        productionDeploy: false,
        shellOutsideCodexSandbox: false,
      });
    }

    if (req.method === 'POST' && url.pathname === '/v1/dry-run') {
      const body = await readJson(req);
      const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
      if (!instruction || instruction.length > MAX_INSTRUCTION_CHARS) {
        return send(res, 400, { error: 'invalid_instruction' });
      }
      const workspace = await workspaceInfo(body.workspace);
      return send(res, 200, {
        ok: true,
        dryRun: true,
        executionStarted: false,
        wouldUse: {
          workspace: workspace.name,
          sandboxMode: 'workspace-write',
          approvalPolicy: 'never',
          networkAccessEnabled: false,
          webSearchEnabled: false,
        },
        instructionHash: createHash('sha256').update(instruction).digest('hex'),
      });
    }

    if (req.method === 'POST' && url.pathname === '/v1/run') {
      if (!EXECUTION_ENABLED) return send(res, 423, { error: 'execution_locked' });
      if (!OPENAI_CONFIGURED) return send(res, 503, { error: 'openai_not_configured' });
      // Deliberately fail closed until the gateway issues a budget lease.
      return send(res, 423, { error: 'budget_lease_required' });
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
    event: 'lia_codex_worker_started',
    host: HOST,
    port: PORT,
    sdkLoaded: true,
    executionEnabled: EXECUTION_ENABLED,
    openaiConfigured: OPENAI_CONFIGURED,
  }));
});
