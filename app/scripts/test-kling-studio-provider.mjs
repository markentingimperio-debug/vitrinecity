import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, mkdir, readFile, rm, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {createKlingStudioProvider, resolveKlingStudioConfig, klingStudioJobId, klingStudioPollingUrl, klingStudioReceipt, KLING_STUDIO_DEFAULTS} from '../kling-studio-provider.js';

const MODEL = 'kling-video-v3_0';
const ID = 'gen_' + 'Ab9_'.repeat(24) + 'Z';
const BINDING = createHash('sha256').update('kling.ai:123456').digest('hex');
const POLL = `https://kling.ai/mcp#${BINDING}/${ID}`;
const FILE = 'https://v15-kling.klingai.com/generated/test.mp4?signature=temporary';
const JOB = Object.freeze({provider: 'kling_studio', jobId: ID, pollingUrl: POLL});
const DATA = {id: ID, polling_url: POLL, status: 'completed', content_url: FILE};
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(24)]);
const wrap = body => ({ok: true, status: 200, body});
const account = () => ({userId: 123456, membershipType: 'VIP', membershipTypeDescription: 'Standard', availableRemainCredits: 660});
function who() {
  return {user: {userId: 123456, user_id: 123456}, availableModels: {text_to_video: {models: [{model: MODEL, inputs: [], arguments: [
    {name: 'prompt', required: true},
    {name: 'duration', allowedValues: Array.from({length: 13}, (_, index) => String(index + 3))},
    {name: 'aspect_ratio', allowedValues: ['16:9', '9:16', '1:1']},
    {name: 'resolution', default: '4k', allowedValues: ['720p', '1080p', '4k']},
    {name: 'enable_audio', allowedValues: ['true', 'false']},
    {name: 'prefer_multi_shots', allowedValues: ['true', 'false']},
    {name: 'imageCount', allowedValues: ['1', '2', '3', '4']}
  ]}]}}};
}
const normal = name => wrap(name === 'who_am_i' ? who() : name === 'account' ? account() : name === 'text_to_video'
  ? {generationId: ID, generation_id: ID, status: 'QUEUING', creditsConsumed: 40}
  : {generationId: ID, status: 'PROCESSING'});

async function fixture(t, {responder = normal, downloadResponses = [{body: MP4}], addresses = [{address: '8.8.8.8', family: 4}], lookupFailure = false, env = {}, home, ...options} = {}) {
  const directory = home || await mkdtemp(join(tmpdir(), 'kling-provider-test-'));
  if (!home) { await writeFile(join(directory, '.credentials'), 'test-only-placeholder', {mode: 0o600}); t.after(() => rm(directory, {recursive: true, force: true})); }
  const calls = [], observations = [], downloads = [], lookups = [];
  const environment = {KLING_HOME: directory, OPENAI_API_KEY: 'unused-secret', NODE_OPTIONS: '--import=untrusted', NODE_TLS_REJECT_UNAUTHORIZED: '0', HTTPS_PROXY: 'https://untrusted', ...env};
  const execFileImpl = (file, args, childOptions, callback) => {
    calls.push({file, args, options: childOptions});
    Promise.resolve().then(() => responder(args[1], args)).then(raw => callback(null, typeof raw === 'string' ? raw : JSON.stringify(raw), ''), error => callback(error, '', 'private stderr and secret'));
  };
  const downloadRequest = (url, childOptions, callback) => {
    const req = new EventEmitter(); req.destroy = () => { req.destroyed = true; };
    const index = downloads.length; downloads.push({url, options: childOptions, req});
    queueMicrotask(() => childOptions.lookup(new URL(url).hostname, {all: index % 2 === 0}, (error, address, family) => {
      if (error) { req.emit('error', error); return; }
      downloads[index].connected = {address, family};
      if (req.destroyed) return;
      const spec = downloadResponses[index] || downloadResponses.at(-1);
      if (spec.hang) return;
      const response = new PassThrough(); response.statusCode = spec.status || 200;
      response.headers = {'content-type': 'video/mp4', ...spec.headers}; callback(response);
      queueMicrotask(() => {
        if (spec.lateSocketError) req.emit('error', Error('private socket error'));
        if (spec.abort) response.emit('aborted');
        else if (!response.destroyed) response.end(spec.body || Buffer.alloc(0));
      });
    }));
    return req;
  };
  const client = createKlingStudioProvider({env: environment, execFileImpl, resolveCliImpl: () => join(directory, 'official-cli.js'), downloadRequest,
    lookupImpl: async (host, query) => { lookups.push({host, query}); if (lookupFailure) throw Error('private DNS error'); return addresses; },
    observer: {run: async (id, run) => { const entry = {id, state: 'started'}; observations.push(entry); try { const result = await run(); entry.state = 'completed'; return result; } catch (error) { entry.state = 'failed'; throw error; } }}, ...options});
  return {client, calls, observations, downloads, lookups, directory, environment};
}

test('configuration requires private absolute home and only the pinned model; it exposes no private paths or credentials', () => {
  const config = resolveKlingStudioConfig({KLING_HOME: join(tmpdir(), 'private-home-secret'), OPENAI_API_KEY: 'secret'});
  assert.equal(config.configured, true); assert.equal(config.videoModel, MODEL);
  assert.deepEqual(config.durationOptions, Array.from({length: 13}, (_, index) => index + 3));
  assert.deepEqual(config.aspectRatioOptions, ['9:16', '16:9', '1:1']);
  assert.equal(config.resolution, '1080p'); assert.equal(config.audioAlwaysOn, false);
  assert.equal(KLING_STUDIO_DEFAULTS.durationSeconds, 5); assert.equal(KLING_STUDIO_DEFAULTS.cliVersion, '0.2.0');
  assert.doesNotMatch(JSON.stringify(config), /private|secret|KLING_HOME/);
  assert.equal(Object.isFrozen(config), true);
  for (const env of [{}, {KLING_HOME: 'relative'}, {KLING_HOME: tmpdir(), KLING_VIDEO_MODEL: 'kling-video-v3_0_omni'}]) assert.equal(resolveKlingStudioConfig(env).configured, false);
});

test('account readiness is read-only, validates current account, reports source without inventing a paid-credit breakdown', async t => {
  const f = await fixture(t); const value = await f.client.getAccountCapabilities();
  assert.deepEqual(f.calls.map(call => call.args[1]), ['who_am_i', 'account']);
  assert.equal(value.connected, true); assert.equal(value.availableCredits, 660); assert.equal(value.usablePaidCredits, null);
  assert.equal(value.accountBinding, BINDING); assert.equal(value.creditUnit, 'credits');
  assert.equal(value.creditsSource, 'query_membership_and_credits.availableRemainCredits');
  assert.doesNotMatch(JSON.stringify(value), /123456|userId|token|secret/);
  assert.deepEqual(f.observations, [{id: 'kling_studio_account', state: 'completed'}]);
});

test('creation invokes one paid text command with explicit cost-affecting settings and an account-bound exact receipt', async t => {
  const f = await fixture(t); const result = await f.client.createVideo({prompt: ' A peaceful garden at dawn '});
  assert.equal(result.provider, 'kling_studio');
  assert.deepEqual(result.data, {id: ID, polling_url: POLL, status: 'queued'});
  assert.deepEqual(klingStudioReceipt(result.data), {jobId: ID, pollingUrl: POLL});
  assert.deepEqual(f.calls.map(call => call.args[1]), ['who_am_i', 'account', 'text_to_video']);
  const paid = f.calls.at(-1);
  assert.equal(paid.file, process.execPath); assert.equal(paid.options.shell, false); assert.equal(paid.options.windowsHide, true);
  assert.equal(paid.options.maxBuffer, 1024 * 1024); assert.equal(paid.options.timeout, 120000); assert.equal(paid.options.killSignal, 'SIGKILL');
  assert.deepEqual(paid.args.slice(1), ['text_to_video', '--model', MODEL, '--duration', '5', '--aspect_ratio', '9:16', '--resolution', '1080p', '--enable_audio', 'false', '--imageCount', '1', '--prefer_multi_shots', 'false', 'A peaceful garden at dawn', '--quiet']);
  assert.deepEqual(paid.options.env, {KLING_HOME: f.directory, KLING_NONINTERACTIVE: '1', NO_COLOR: '1', LANG: 'en_US.UTF-8'});
  assert.doesNotMatch(JSON.stringify(paid), /unused-secret|NODE_OPTIONS|HTTPS_PROXY|NODE_TLS/);
  assert.equal(f.downloads.length, 0);
  await assert.rejects(access(join(f.directory, '.vitrinecity-cli-lock')));
});

test('unsupported inputs and flags cannot upload files, start login, switch models or multiply paid outputs', async t => {
  const f = await fixture(t);
  for (const value of [{prompt: ''}, {prompt: '--help'}, {prompt: '--skill-name=malicious'}, {prompt: '-q'}, {prompt: 'x\0y'}, {prompt: 'x'.repeat(8001)},
    {model: 'kling-video-v3_0_omni'}, {durationSeconds: 2}, {durationSeconds: 16}, {durationSeconds: '5'}, {resolution: '4k'}, {generateAudio: true}, {imageCount: 2}, {preferMultiShots: true}, {image: 'private.file'}, {inputs: []}, {elements: []}, {image_url: 'private.file'}, {unknownOption: true}]) {
    await assert.rejects(f.client.createVideo({prompt: 'A garden', ...value}), error => error.status === 400);
  }
  assert.equal(f.calls.length, 0);
});

test('real shell-free child execution bounds output and timeout without exposing private stderr', async t => {
  for (const mode of ['large', 'timeout']) {
    const f = await fixture(t, {execFileImpl: undefined, createTimeoutMs: mode === 'timeout' ? 50 : 3000});
    const cli = join(f.directory, 'official-cli.js');
    await writeFile(cli, `const cmd=process.argv[2];
if(cmd==='who_am_i') process.stdout.write(${JSON.stringify(JSON.stringify(wrap(who())))});
else if(cmd==='account') process.stdout.write(${JSON.stringify(JSON.stringify(wrap(account())))});
else { process.stderr.write('private-secret'); ${mode === 'large' ? "process.stdout.write('a'.repeat(2*1024*1024));" : 'setTimeout(()=>{},10000);'} }
`);
    await assert.rejects(f.client.createVideo({prompt: 'Garden'}), error => {
      assert.equal(error.submissionUncertain, true); assert.doesNotMatch(error.message, /secret|private/);
      return ['kling_studio_timeout', 'kling_studio_response_too_large'].includes(error.code);
    });
    await assert.rejects(access(join(f.directory, '.vitrinecity-cli-lock')));
  }
});

test('live capabilities, identity disagreement and insufficient credits stop before the paid command', async t => {
  for (const mode of ['credits', 'account', 'capabilities', 'identity']) {
    const f = await fixture(t, {responder: name => {
      const raw = normal(name);
      if (mode === 'credits' && name === 'account') raw.body.availableRemainCredits = 39;
      if (mode === 'account' && name === 'account') raw.body.userId = 999;
      if (mode === 'capabilities' && name === 'who_am_i') raw.body.availableModels.text_to_video.models[0].arguments.find(arg => arg.name === 'resolution').allowedValues = ['4k'];
      if (mode === 'identity' && name === 'who_am_i') raw.body.user.user_id = 999;
      return raw;
    }});
    await assert.rejects(f.client.createVideo({prompt: 'Garden'}));
    assert.ok(f.calls.every(call => call.args[1] !== 'text_to_video'));
  }
});

test('paid errors and invalid receipts remain uncertain, sanitized, and are never retried', async t => {
  for (const answer of [() => { throw Error('private prompt and access_token=secret'); }, () => { throw Object.assign(Error('secret'), {killed: true, signal: 'SIGKILL'}); },
    () => 'not JSON private secret', () => wrap({generationId: '../bad'}), () => wrap({generationId: ID, generation_id: 'different'}),
    () => wrap({generationId: ID, padding: 'a'.repeat(1024 * 1024)}), () => ({ok: false, status: 400, body: {message: 'private secret'}})]) {
    const f = await fixture(t, {responder: name => name === 'text_to_video' ? answer() : normal(name)});
    await assert.rejects(f.client.createVideo({prompt: 'Garden'}), error => { assert.equal(error.submissionUncertain, true); assert.doesNotMatch(error.message, /private|secret/); return true; });
    assert.equal(f.calls.filter(call => call.args[1] === 'text_to_video').length, 1);
    assert.equal(f.downloads.length, 0);
  }
});

test('separate clients sharing one home serialize identity, credit reads and paid sends as complete transactions', async t => {
  const order = []; const responder = async name => { order.push(name); await delay(3); return normal(name); };
  const first = await fixture(t, {responder}); const second = await fixture(t, {home: first.directory, responder});
  await Promise.all([first.client.createVideo({prompt: 'First garden'}), second.client.createVideo({prompt: 'Second garden'})]);
  assert.deepEqual(order, ['who_am_i', 'account', 'text_to_video', 'who_am_i', 'account', 'text_to_video']);
});

test('existing live or abandoned locks time out without stealing and missing credentials never start the CLI', async t => {
  const f = await fixture(t, {lockTimeoutMs: 10});
  const lock = join(f.directory, '.vitrinecity-cli-lock'); await mkdir(lock);
  const owner = JSON.stringify({pid: process.pid, token: 'existing-owner', createdAt: '2000-01-01'});
  await writeFile(join(lock, 'owner.json'), owner);
  await assert.rejects(f.client.getAccountCapabilities(), {code: 'kling_studio_busy'});
  assert.equal(await readFile(join(lock, 'owner.json'), 'utf8'), owner); assert.equal(f.calls.length, 0);
  const missing = await fixture(t); await rm(join(missing.directory, '.credentials'));
  await assert.rejects(missing.client.createVideo({prompt: 'Garden'}), {code: 'kling_studio_auth_unavailable'});
  assert.equal(missing.calls.length, 0);
});

test('receipt validation preserves the long opaque ID and rejects edits, foreign providers and changed accounts before polling', async t => {
  assert.equal(klingStudioJobId(ID), ID); assert.equal(klingStudioPollingUrl(POLL, ID), POLL);
  for (const id of [ID + '?x', '../id', ' id ', 123]) assert.equal(klingStudioJobId(id), '');
  for (const url of [POLL + '/extra', POLL.replace('https:', 'http:'), POLL.replace('kling.ai', 'evil.test'), POLL.replace(ID, 'different'), POLL.replace('/mcp#', '/mcp?#'), POLL.replace(BINDING, BINDING.toUpperCase())]) assert.equal(klingStudioPollingUrl(url, ID), '');
  const f = await fixture(t);
  await assert.rejects(f.client.getVideo({...JOB, provider: 'google'}), {code: 'ai_video_provider_mismatch'});
  await assert.rejects(f.client.getVideo({...JOB, pollingUrl: POLL + '?x'}), {code: 'ai_video_receipt_invalid'});
  assert.equal(f.calls.length, 0);
  const changed = await fixture(t, {responder: name => { const raw = normal(name); if (name === 'who_am_i') raw.body.user = {userId: 999, user_id: 999}; return raw; }});
  await assert.rejects(changed.client.getVideo(JOB), {code: 'kling_studio_account_mismatch', status: 409});
  assert.deepEqual(changed.calls.map(call => call.args[1]), ['who_am_i']);
});

test('query normalizes documented statuses without leaking upstream errors or submitting generation', async t => {
  for (const [body, expected] of [[{status: 'QUEUING'}, 'processing'], [{status: 'running'}, 'processing'], [{status: 'FAILED', error: 'private secret'}, 'failed'],
    [{status: 'SUCCEED', works: [{url: FILE}]}, 'completed'], [{status: 'partial_completed', works: [{url_without_watermark: FILE}]}, 'completed'],
    [{status: 'COMPLETED', works: [{status: 'COMPLETED', contentType: 'video', content_type: 'video', url: FILE, urlWithoutWatermark: FILE}]}, 'completed']]) {
    const f = await fixture(t, {responder: name => name === 'query_tasks' ? wrap({generation_id: ID, ...body}) : normal(name)});
    const result = await f.client.getVideo(JOB); assert.equal(result.data.status, expected);
    assert.equal(result.data.id, ID); assert.equal(result.data.polling_url, POLL);
    assert.doesNotMatch(JSON.stringify(result.data), /private|secret/);
    assert.deepEqual(f.calls.map(call => call.args.slice(1)), [['who_am_i', '--quiet'], ['query_tasks', ID, '--quiet']]);
  }
});

test('query rejects mismatched IDs, unknown state, incomplete or multiple outputs, and unrelated CDN URLs', async t => {
  for (const body of [{generationId: 'wrong', status: 'PROCESSING'}, {status: 'unknown'}, {status: 'COMPLETED', works: []},
    {status: 'partial_completed', works: [{url: FILE}, {url: FILE}]}, {status: 'COMPLETED', works: [{url: 'https://evil.test/video.mp4'}]},
    {status: 'COMPLETED', works: [{status: 'FAILED', url: FILE}]}, {status: 'COMPLETED', works: [{content_type: 'image', url: FILE}]}]) {
    const f = await fixture(t, {responder: name => name === 'query_tasks' ? wrap(body) : normal(name)});
    await assert.rejects(f.client.getVideo(JOB), error => error.status === 502);
    assert.equal(f.calls.filter(call => call.args[1] === 'query_tasks').length, 1); assert.equal(f.downloads.length, 0);
  }
});

test('download validates ownership, pins a public DNS address, verifies MP4, and never forwards credentials', async t => {
  const f = await fixture(t); assert.deepEqual(await f.client.downloadVideo(DATA, JOB), MP4);
  assert.deepEqual(f.calls.map(call => call.args[1]), ['who_am_i']);
  assert.equal(f.downloads[0].url, FILE); assert.equal(f.downloads[0].options.agent, false);
  assert.deepEqual(f.downloads[0].options.headers, {Accept: 'video/mp4,application/octet-stream'});
  assert.deepEqual(f.downloads[0].connected.address, [{address: '8.8.8.8', family: 4}]);
  assert.doesNotMatch(JSON.stringify(f.downloads), /Authorization|Cookie|secret|credentials/);
});

test('downloads reject forged receipts, arbitrary hosts, local DNS and unsafe redirects', async t => {
  const f = await fixture(t);
  for (const content_url of ['https://klingai.com/video.mp4', 'https://v15-kling.klingai.com.evil.test/a', 'https://user:pass@v15-kling.klingai.com/a', 'http://v15-kling.klingai.com/a', 'https://v15-kling.klingai.com:444/a', 'https://127.0.0.1/a']) await assert.rejects(f.client.downloadVideo({...DATA, content_url}, JOB));
  await assert.rejects(f.client.downloadVideo({...DATA, id: 'different'}, JOB)); assert.equal(f.calls.length + f.downloads.length, 0);
  for (const options of [{addresses: [{address: '127.0.0.1', family: 4}]}, {addresses: [{address: '8.8.8.8', family: 4}, {address: '10.0.0.1', family: 4}]}, {addresses: []}, {lookupFailure: true}]) {
    const local = await fixture(t, options); await assert.rejects(local.client.downloadVideo(DATA, JOB), error => ['video_download_address_blocked', 'video_download_dns_failed'].includes(error.code));
    assert.equal(local.downloads[0].connected, undefined);
  }
  const redirected = await fixture(t, {downloadResponses: [{status: 302, headers: {location: 'https://evil.test/private'}}]});
  await assert.rejects(redirected.client.downloadVideo(DATA, JOB), {code: 'video_download_url_invalid'}); assert.equal(redirected.downloads.length, 1);
});

test('download limits reject malformed, oversized, truncated, interrupted and timed-out streams', async t => {
  for (const [spec, code, options] of [
    [{body: MP4, headers: {'content-type': 'text/html'}}, 'video_download_response_invalid'],
    [{body: MP4, headers: {'content-length': '500000000'}}, 'video_download_response_invalid'],
    [{body: MP4, headers: {'content-length': '100'}}, 'video_download_incomplete'],
    [{body: Buffer.from('not an MP4 file')}, 'video_download_not_mp4'],
    [{body: MP4}, 'video_download_too_large', {maxDownloadBytes: 12}],
    [{status: 503}, 'video_download_http_temporary'],
    [{abort: true}, 'video_download_incomplete'],
    [{hang: true}, 'video_download_timeout', {downloadTimeoutMs: 5}]
  ]) {
    const f = await fixture(t, {downloadResponses: [spec], ...options});
    await assert.rejects(f.client.downloadVideo(DATA, JOB), {code}); assert.equal(f.downloads.length, 1);
  }
});

test('same-CDN redirects remain unauthenticated and loops are bounded', async t => {
  const f = await fixture(t, {downloadResponses: [{status: 302, headers: {location: FILE + '&next=1'}, lateSocketError: true}, {body: MP4}]});
  assert.deepEqual(await f.client.downloadVideo(DATA, JOB), MP4); assert.equal(f.downloads.length, 2);
  assert.deepEqual(f.downloads[1].options.headers, {Accept: 'video/mp4,application/octet-stream'});
  const loop = await fixture(t, {downloadResponses: [{status: 302, headers: {location: FILE}}]});
  await assert.rejects(loop.client.downloadVideo(DATA, JOB), {code: 'video_download_redirect_blocked'}); assert.equal(loop.downloads.length, 3);
});
