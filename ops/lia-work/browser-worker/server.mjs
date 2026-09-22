import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import dns from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
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
const PUBLIC_WEB_MODE = process.env.LIA_BROWSER_PUBLIC_WEB_MODE === '1';
const blockedIps = new BlockList();
for (const [base, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]) blockedIps.addSubnet(base, prefix, 'ipv4');
for (const [base, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10],
  ['ff00::', 8], ['2001:db8::', 32],
]) blockedIps.addSubnet(base, prefix, 'ipv6');

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
  if (!host || host === 'localhost' || isIP(host) || /\.(?:local|localhost|internal|test|invalid|onion)$/.test(host)) return false;
  if (PUBLIC_WEB_MODE) return true;
  return ALLOWED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

async function urlAllowed(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || (u.port && u.port !== '443')) return false;
    if (u.username || u.password) return false;
    if (!hostAllowed(u.hostname)) return false;
    const addresses = await dns.lookup(u.hostname, { all: true });
    return addresses.length > 0 && addresses.every(({ address, family }) =>
      !address.toLowerCase().startsWith('::ffff:') &&
      !blockedIps.check(address, family === 6 ? 'ipv6' : 'ipv4'));
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
    args: ['--disable-dev-shm-usage', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
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
    if (!['GET', 'HEAD'].includes(route.request().method()) || !(await urlAllowed(target))) {
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
        if (!(await urlAllowed(step.url))) throw new Error(`step ${i}: URL nao permitida`);
        await page.goto(step.url, { waitUntil: step.waitUntil || 'domcontentloaded' });
      } else if (action === 'openFirstYoutubeVideo') {
        const source = new URL(page.url());
        if (!/(^|\.)youtube\.com$/.test(source.hostname) || source.pathname !== '/results') {
          throw new Error(`step ${i}: busca do YouTube obrigatoria`);
        }
        const link = page.locator('a#video-title[href*="/watch"], ytd-video-renderer a[href*="/watch"]').first();
        await link.waitFor({ state: 'attached', timeout: Math.min(TIMEOUT_MS, 20000) });
        const href = await link.getAttribute('href');
        const label = String(await link.getAttribute('title') || await link.innerText().catch(() => '')).trim().slice(0, 200);
        const target = new URL(String(href || ''), page.url());
        if (!/(^|\.)youtube\.com$/.test(target.hostname) || target.pathname !== '/watch' || !target.searchParams.get('v') || !(await urlAllowed(target.href))) {
          throw new Error(`step ${i}: resultado do YouTube invalido`);
        }
        target.searchParams.set('autoplay', '1');
        await page.goto(target.href, { waitUntil: 'domcontentloaded' });
        let playing = false;
        let currentTime = 0;
        let playbackError = '';
        try {
          const playButton = page.locator('.ytp-large-play-button, button.ytp-play-button').first();
          if (await playButton.isVisible().catch(() => false)) await playButton.click({ force: true, timeout: 2000 }).catch(() => {});
          await page.waitForTimeout(1500);
          const video = page.locator('video').first();
          if (await video.count()) {
            const state = await video.evaluate((element) => ({ paused: element.paused, ended: element.ended, currentTime: element.currentTime }), undefined, { timeout: 2000 });
            currentTime = Number(state.currentTime || 0);
            playing = !state.paused && !state.ended && currentTime > 0;
          }
          playbackError = playing ? '' : 'playback_not_confirmed';
        } catch (error) { playbackError = String(error?.message || 'playback_unconfirmed').slice(0, 200); }
        outputs.push({ step: i, action, url: page.url(), title: label, playing, currentTime, ...(playbackError ? { playbackError } : {}) });
      } else if (action === 'click') {
        if (PUBLIC_WEB_MODE) throw new Error('click desativado em pesquisa publica');
        if (typeof step.selector !== 'string' || step.selector.length > 500) throw new Error(`step ${i}: selector invalido`);
        await page.locator(step.selector).first().click();
      } else if (action === 'fill') {
        if (PUBLIC_WEB_MODE) throw new Error('fill desativado em pesquisa publica');
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
      } else if (action === 'links') {
        const links = await page.locator('a[href]').evaluateAll((anchors) => anchors.slice(0, 300).map((a) => ({
          text: String(a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 160),
          url: a.href,
        })).filter((item) => item.text && item.url.startsWith('https://')));
        outputs.push({ step: i, action, links: links.slice(0, 50) });
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
        publicWebMode: PUBLIC_WEB_MODE,
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
