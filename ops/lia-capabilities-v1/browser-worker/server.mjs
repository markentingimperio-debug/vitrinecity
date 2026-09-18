import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const HOST = process.env.LIA_BROWSER_HOST || '0.0.0.0';
const PORT = Number(process.env.LIA_BROWSER_PORT || 8792);
const ENABLED = process.env.LIA_BROWSER_EXECUTION_ENABLED === '1';
const TOKEN = String(process.env.LIA_BROWSER_CONTROL_TOKEN || '');
const ARTIFACT_ROOT = path.resolve(process.env.LIA_BROWSER_ARTIFACT_DIR || '/artifacts/browser');
const MAX_STEPS = Math.max(1, Math.min(50, Number(process.env.LIA_BROWSER_MAX_STEPS || 20)));
const TIMEOUT_MS = Math.max(1000, Math.min(120000, Number(process.env.LIA_BROWSER_TIMEOUT_MS || 30000)));
const ALLOWED_DOMAINS = String(process.env.LIA_BROWSER_ALLOWED_DOMAINS || 'vitrinecity.com')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

if (!TOKEN || TOKEN.length < 32) {
  throw new Error('LIA_BROWSER_CONTROL_TOKEN ausente ou fraco');
}
if (ALLOWED_DOMAINS.length === 0) {
  throw new Error('LIA_BROWSER_ALLOWED_DOMAINS vazio');
}

await fs.mkdir(ARTIFACT_ROOT, { recursive: true });

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(data.length),
    'cache-control': 'no-store',
  });
  res.end(data);
}

function authed(req) {
  const header = String(req.headers.authorization || '');
  return header === `Bearer ${TOKEN}`;
}

function hostAllowed(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost') return false;
  return ALLOWED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

function urlAllowed(raw) {
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    if (u.username || u.password) return false;
    return hostAllowed(u.hostname);
  } catch {
    return false;
  }
}

function artifactPath(relative) {
  if (typeof relative !== 'string' || relative.length < 1 || relative.length > 240) {
    throw new Error('output invalido');
  }
  if (path.isAbsolute(relative) || relative.includes('\0')) throw new Error('output invalido');
  const resolved = path.resolve(ARTIFACT_ROOT, relative);
  const prefix = ARTIFACT_ROOT.endsWith(path.sep) ? ARTIFACT_ROOT : ARTIFACT_ROOT + path.sep;
  if (!(resolved === ARTIFACT_ROOT || resolved.startsWith(prefix))) throw new Error('output fora do artifact root');
  return resolved;
}

async function readJson(req, limit = 256 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('payload muito grande');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function runTask(payload) {
  if (!ENABLED) {
    const err = new Error('browser worker bloqueado');
    err.code = 'DISABLED';
    throw err;
  }
  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  if (steps.length < 1 || steps.length > MAX_STEPS) throw new Error('quantidade de steps invalida');

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
  });
  const context = await browser.newContext({
    acceptDownloads: false,
    serviceWorkers: 'block',
    viewport: { width: 1440, height: 900 },
  });
  context.setDefaultTimeout(TIMEOUT_MS);
  context.setDefaultNavigationTimeout(TIMEOUT_MS);

  const page = await context.newPage();
  const blocked = [];
  const outputs = [];

  await page.route('**/*', async (route) => {
    const target = route.request().url();
    if (target.startsWith('data:') || target.startsWith('blob:') || target === 'about:blank') {
      return route.continue();
    }
    if (!urlAllowed(target)) {
      blocked.push(target.slice(0, 500));
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });

  page.on('dialog', (dialog) => {
    dialog.dismiss().catch(() => {});
  });

  page.on('download', (download) => {
    download.cancel().catch(() => {});
  });

  try {
    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i] || {};
      const action = String(step.action || '');
      if (action === 'goto') {
        if (!urlAllowed(step.url)) throw new Error(`step ${i}: URL nao permitida`);
        await page.goto(step.url, { waitUntil: step.waitUntil || 'domcontentloaded' });
      } else if (action === 'click') {
        if (typeof step.selector !== 'string' || step.selector.length > 500) throw new Error(`step ${i}: selector invalido`);
        await page.locator(step.selector).first().click();
      } else if (action === 'fill') {
        if (typeof step.selector !== 'string' || step.selector.length > 500) throw new Error(`step ${i}: selector invalido`);
        const value = String(step.value ?? '');
        if (value.length > 5000) throw new Error(`step ${i}: value grande demais`);
        await page.locator(step.selector).first().fill(value);
      } else if (action === 'waitFor') {
        if (typeof step.selector !== 'string' || step.selector.length > 500) throw new Error(`step ${i}: selector invalido`);
        await page.locator(step.selector).first().waitFor({ state: step.state || 'visible' });
      } else if (action === 'text') {
        if (typeof step.selector !== 'string' || step.selector.length > 500) throw new Error(`step ${i}: selector invalido`);
        const text = await page.locator(step.selector).first().innerText();
        outputs.push({ step: i, action, text: text.slice(0, 20000) });
      } else if (action === 'screenshot') {
        const name = step.output || `shot-${Date.now()}-${i}.png`;
        const dest = artifactPath(name);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await page.screenshot({ path: dest, fullPage: step.fullPage !== false });
        outputs.push({ step: i, action, artifact: path.relative(ARTIFACT_ROOT, dest) });
      } else {
        throw new Error(`step ${i}: action nao permitida`);
      }
    }

    return {
      ok: true,
      finalUrl: page.url(),
      title: await page.title().catch(() => ''),
      outputs,
      blockedRequests: blocked.slice(0, 50),
      allowedDomains: ALLOWED_DOMAINS,
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      return json(res, 200, {
        ok: true,
        worker: 'lia-browser-worker',
        enabled: ENABLED,
        allowedDomains: ALLOWED_DOMAINS,
        maxSteps: MAX_STEPS,
      });
    }

    if (!authed(req)) return json(res, 401, { ok: false, error: 'unauthorized' });

    if (req.method === 'POST' && req.url === '/v1/browser/run') {
      const payload = await readJson(req);
      const result = await runTask(payload);
      return json(res, 200, result);
    }

    return json(res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    const status = error?.code === 'DISABLED' ? 423 : 400;
    return json(res, status, { ok: false, error: String(error?.message || error) });
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(JSON.stringify({
    event: 'listening',
    worker: 'lia-browser-worker',
    host: HOST,
    port: PORT,
    enabled: ENABLED,
    allowedDomains: ALLOWED_DOMAINS,
  }) + '\n');
});
