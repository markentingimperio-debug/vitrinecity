import http from 'node:http';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SOCKET = process.env.LIA_MEDIA_SOCKET || '/run/lia-media-worker/media.sock';
const ENABLED = process.env.LIA_MEDIA_EXECUTION_ENABLED === '1';
const TOKEN = String(process.env.LIA_MEDIA_CONTROL_TOKEN || '');
const ROOT = path.resolve(process.env.LIA_MEDIA_ARTIFACT_ROOT || '/opt/lia/artifacts');
const FFMPEG = process.env.LIA_MEDIA_FFMPEG || '/usr/bin/ffmpeg';
const FFPROBE = process.env.LIA_MEDIA_FFPROBE || '/usr/bin/ffprobe';
const TIMEOUT_MS = Math.max(1000, Math.min(30 * 60 * 1000, Number(process.env.LIA_MEDIA_TIMEOUT_MS || 600000)));

if (!TOKEN || TOKEN.length < 32) throw new Error('LIA_MEDIA_CONTROL_TOKEN ausente ou fraco');
for (const bin of [FFMPEG, FFPROBE]) {
  if (!fssync.existsSync(bin)) throw new Error(`binario ausente: ${bin}`);
}

await fs.mkdir(ROOT, { recursive: true });
await fs.mkdir(path.dirname(SOCKET), { recursive: true });
await fs.rm(SOCKET, { force: true }).catch(() => {});

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
  return String(req.headers.authorization || '') === `Bearer ${TOKEN}`;
}

async function readJson(req, limit = 128 * 1024) {
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

function safePath(relative, mustExist = false) {
  if (typeof relative !== 'string' || relative.length < 1 || relative.length > 240) throw new Error('path invalido');
  if (path.isAbsolute(relative) || relative.includes('\0')) throw new Error('path invalido');
  const resolved = path.resolve(ROOT, relative);
  const prefix = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
  if (!(resolved === ROOT || resolved.startsWith(prefix))) throw new Error('path fora do artifact root');
  if (mustExist && !fssync.existsSync(resolved)) throw new Error(`arquivo nao encontrado: ${relative}`);
  return resolved;
}

function assertExt(file, allowed) {
  const ext = path.extname(file).toLowerCase();
  if (!allowed.includes(ext)) throw new Error(`extensao nao permitida: ${ext}`);
}

function positiveNumber(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} invalido`);
  return n;
}

function intNumber(value, name, opts = {}) {
  const n = positiveNumber(value, name, opts);
  if (!Number.isInteger(n)) throw new Error(`${name} deve ser inteiro`);
  return n;
}

function run(bin, args, timeout = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
    });
    let stdout = '';
    let stderr = '';
    const max = 2 * 1024 * 1024;

    child.stdout.on('data', (d) => {
      if (stdout.length < max) stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d) => {
      if (stderr.length < max) stderr += d.toString('utf8');
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('media timeout'));
    }, timeout);

    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`processo falhou rc=${code}: ${stderr.slice(-4000)}`));
      resolve({ stdout, stderr });
    });
  });
}

async function prepareOutput(relative, exts) {
  const output = safePath(relative, false);
  assertExt(output, exts);
  await fs.mkdir(path.dirname(output), { recursive: true });
  return output;
}

async function handleAction(payload) {
  if (!ENABLED) {
    const err = new Error('media worker bloqueado');
    err.code = 'DISABLED';
    throw err;
  }

  const action = String(payload.action || '');
  const input = safePath(payload.input, true);

  if (action === 'probe') {
    const { stdout } = await run(FFPROBE, [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      input,
    ], Math.min(TIMEOUT_MS, 60000));
    return { ok: true, action, probe: JSON.parse(stdout) };
  }

  if (action === 'thumbnail') {
    const output = await prepareOutput(payload.output, ['.jpg', '.jpeg', '.png', '.webp']);
    const at = positiveNumber(payload.timeSeconds ?? 0, 'timeSeconds', { min: 0, max: 24 * 3600 });
    const args = ['-y', '-ss', String(at), '-i', input, '-frames:v', '1'];
    if (payload.width || payload.height) {
      const w = intNumber(payload.width || 1280, 'width', { min: 16, max: 7680 });
      const h = intNumber(payload.height || 720, 'height', { min: 16, max: 4320 });
      args.push('-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`);
    }
    args.push(output);
    await run(FFMPEG, args);
    return { ok: true, action, output: path.relative(ROOT, output) };
  }

  if (action === 'clip') {
    const output = await prepareOutput(payload.output, ['.mp4', '.mov', '.mkv', '.webm']);
    const start = positiveNumber(payload.startSeconds ?? 0, 'startSeconds', { min: 0, max: 24 * 3600 });
    const duration = positiveNumber(payload.durationSeconds, 'durationSeconds', { min: 0.1, max: 6 * 3600 });
    await run(FFMPEG, [
      '-y',
      '-ss', String(start),
      '-i', input,
      '-t', String(duration),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      output,
    ]);
    return { ok: true, action, output: path.relative(ROOT, output) };
  }

  if (action === 'videoResize') {
    const output = await prepareOutput(payload.output, ['.mp4']);
    const width = intNumber(payload.width, 'width', { min: 16, max: 3840 });
    const height = intNumber(payload.height, 'height', { min: 16, max: 2160 });
    const vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
    await run(FFMPEG, [
      '-y', '-i', input,
      '-vf', vf,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      output,
    ]);
    return { ok: true, action, output: path.relative(ROOT, output) };
  }

  if (action === 'imageResize') {
    const output = await prepareOutput(payload.output, ['.jpg', '.jpeg', '.png', '.webp']);
    const width = intNumber(payload.width, 'width', { min: 16, max: 7680 });
    const height = intNumber(payload.height, 'height', { min: 16, max: 7680 });
    const vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
    await run(FFMPEG, ['-y', '-i', input, '-vf', vf, '-frames:v', '1', output]);
    return { ok: true, action, output: path.relative(ROOT, output) };
  }

  if (action === 'audioNormalize') {
    const output = await prepareOutput(payload.output, ['.mp4', '.m4a', '.mp3', '.wav']);
    await run(FFMPEG, [
      '-y', '-i', input,
      '-af', 'loudnorm=I=-16:LRA=11:TP=-1.5',
      output,
    ]);
    return { ok: true, action, output: path.relative(ROOT, output) };
  }

  throw new Error('action nao permitida');
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      return json(res, 200, {
        ok: true,
        worker: 'lia-media-worker',
        enabled: ENABLED,
        artifactRoot: ROOT,
        actions: ['probe', 'thumbnail', 'clip', 'videoResize', 'imageResize', 'audioNormalize'],
      });
    }

    if (!authed(req)) return json(res, 401, { ok: false, error: 'unauthorized' });

    if (req.method === 'POST' && req.url === '/v1/media/run') {
      const payload = await readJson(req);
      return json(res, 200, await handleAction(payload));
    }

    return json(res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    const status = error?.code === 'DISABLED' ? 423 : 400;
    return json(res, status, { ok: false, error: String(error?.message || error) });
  }
});

server.listen(SOCKET, async () => {
  await fs.chmod(SOCKET, 0o660);
  process.stdout.write(JSON.stringify({
    event: 'listening',
    worker: 'lia-media-worker',
    socket: SOCKET,
    enabled: ENABLED,
  }) + '\n');
});
