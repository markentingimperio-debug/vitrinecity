import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createGoogleVideoProvider, resolveGoogleVideoConfig, googleVideoJobId, googleVideoPollingUrl, googleVideoReceipt} from '../google-video-provider.js';

const ORIGIN = 'https://generativelanguage.googleapis.com';
const MODEL = 'veo-3.1-lite-generate-preview';
const ID = `models/${MODEL}/operations/operation_123`;
const POLL = `${ORIGIN}/v1beta/${ID}`;
const FILE = `${ORIGIN}/v1beta/files/video123:download?alt=media`;
const ENV = {GEMINI_API_KEY: 'gemini-test-secret', OPENAI_API_KEY: 'openai-unused-secret', OPENROUTER_API_KEY: 'router-unused-secret'};
const JOB = Object.freeze({provider: 'google', jobId: ID, pollingUrl: POLL});
const DATA = {id: ID, polling_url: POLL, status: 'completed', content_url: FILE};
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(24)]);
const json = (value, options = {}) => new Response(JSON.stringify(value), {headers: {'Content-Type': 'application/json'}, ...options});
const completed = () => ({name: ID, done: true, response: {generateVideoResponse: {generatedSamples: [{video: {uri: FILE, mimeType: 'video/mp4'}}]}}});

function fixture({env = ENV, responder = () => json({name: ID}), downloadResponses = [{body: MP4}], addresses = [{address: '142.250.1.1', family: 4}], lookupFailure = false, ...options} = {}) {
  const calls = [], downloads = [], lookups = [], observations = [];
  const fetchImpl = async (url, options) => { calls.push({url, options}); return responder(url, options); };
  // This stub invokes the real adapter's DNS validation and stream listeners.
  const downloadRequest = (url, options, callback) => {
    const req = new EventEmitter(); req.destroy = () => { req.destroyed = true; };
    const index = downloads.length;
    downloads.push({url, options, req});
    queueMicrotask(() => options.lookup(new URL(url).hostname, {all: index % 2 === 0}, (error, address, family) => {
      if (error) { req.emit('error', error); return; }
      downloads[index].connected = {address, family};
      if (req.destroyed) return;
      const spec = downloadResponses[index] || downloadResponses.at(-1);
      if (spec.hang) return;
      const response = new PassThrough();
      response.statusCode = spec.status || 200;
      response.headers = {'content-type': 'video/mp4', ...spec.headers};
      callback(response);
      queueMicrotask(() => {
        if (spec.lateSocketError) req.emit('error', Error('redirect socket was closed'));
        if (spec.abort) response.emit('aborted');
        else if (!response.destroyed) response.end(spec.body || Buffer.alloc(0));
      });
    }));
    return req;
  };
  const client = createGoogleVideoProvider({env, fetchImpl, downloadRequest,
    lookupImpl: async (host, options) => { lookups.push({host, options}); if (lookupFailure) throw Error('private DNS details'); return addresses; },
    observer: {run: async (id, run) => { const entry = {id, state: 'started'}; observations.push(entry); try { const result = await run(); entry.state = 'completed'; return result; } catch (error) { entry.state = 'failed'; throw error; } }}, ...options});
  return {client, calls, downloads, lookups, observations};
}

test('Google configuration is independent, safe and has only the documented model/capability choices', () => {
  const config = resolveGoogleVideoConfig({...ENV, AI_MEDIA_PROVIDER: 'openai', GOOGLE_API_KEY: 'wrong-key', OPENROUTER_VIDEO_MODEL: 'google/private'});
  assert.equal(config.provider, 'google'); assert.equal(config.configured, true); assert.equal(config.videoEnabled, true);
  assert.equal(config.videoModel, MODEL); assert.equal(config.audioAlwaysOn, true); assert.equal(config.resolution, '720p');
  assert.deepEqual(config.durationOptions, [4, 6, 8]); assert.deepEqual(config.aspectRatioOptions, ['9:16', '16:9']);
  assert.deepEqual(config.videoOptions, [MODEL, 'veo-3.1-fast-generate-preview', 'veo-3.1-generate-preview']);
  assert.doesNotMatch(JSON.stringify(config), /secret|wrong-key|private|API_KEY/);
  assert.equal(Object.isFrozen(config), true); assert.equal(Object.isFrozen(config.videoOptions), true);
});

test('missing Google credentials or unknown model block without using another provider or Google key alias', async () => {
  for (const env of [{OPENAI_API_KEY: 'a', OPENROUTER_API_KEY: 'b', GOOGLE_API_KEY: 'c'}, {...ENV, GOOGLE_VIDEO_MODEL: 'sora-2'}, {...ENV, GOOGLE_VIDEO_MODEL: 'google/veo-3.1-lite'}]) {
    const f = fixture({env});
    assert.equal(f.client.config.videoEnabled, false);
    await assert.rejects(f.client.createVideo({prompt: 'An orchard at dawn'}), error => error.status === 503);
    await assert.rejects(f.client.getVideo(JOB), error => error.status === 503);
    await assert.rejects(f.client.downloadVideo(DATA, JOB), error => error.status === 503);
    assert.equal(f.calls.length + f.downloads.length, 0);
  }
});

test('create sends exactly one documented REST request and returns a normalized receipt without polling', async () => {
  const f = fixture();
  const result = await f.client.createVideo({prompt: ' An orchard at dawn '});
  assert.equal(result.provider, 'google'); assert.deepEqual(result.data, {id: ID, polling_url: POLL, status: 'queued'});
  assert.deepEqual(googleVideoReceipt(result.data), {jobId: ID, pollingUrl: POLL});
  assert.equal(f.calls.length, 1); const {url, options} = f.calls[0];
  assert.equal(url, `${ORIGIN}/v1beta/models/${MODEL}:predictLongRunning`);
  assert.deepEqual(JSON.parse(options.body), {instances: [{prompt: 'An orchard at dawn'}], parameters: {durationSeconds: 4, aspectRatio: '9:16', resolution: '720p', numberOfVideos: 1}});
  assert.deepEqual(options.headers, {'x-goog-api-key': ENV.GEMINI_API_KEY, 'Content-Type': 'application/json'});
  assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal);
  assert.equal(f.downloads.length, 0); assert.deepEqual(f.observations, [{id: 'google_video', state: 'completed'}]);
  assert.doesNotMatch(JSON.stringify(f.calls), /openai-unused|router-unused/);
});

test('all supported durations and ratios preserve the selected model and never upgrade it automatically', async () => {
  const model = 'veo-3.1-fast-generate-preview';
  const f = fixture({env: {...ENV, GOOGLE_VIDEO_MODEL: model}, responder: () => json({name: ID.replace(MODEL, model)})});
  for (const durationSeconds of [4, 6, 8]) for (const aspectRatio of ['9:16', '16:9']) {
    await f.client.createVideo({prompt: 'An orchard', durationSeconds, aspectRatio, generateAudio: true});
    assert.deepEqual(JSON.parse(f.calls.at(-1).options.body).parameters, {durationSeconds, aspectRatio, resolution: '720p', numberOfVideos: 1});
    assert.ok(f.calls.at(-1).url.includes(model));
  }
  assert.equal(f.calls.length, 6);
});

test('unsupported input including silent output is rejected before a paid request', async () => {
  const f = fixture();
  for (const input of [{prompt: ''}, {prompt: 'x'.repeat(8001)}, {model: 'google/veo-3.1-lite'}, {durationSeconds: 5}, {durationSeconds: '4'}, {aspectRatio: '1:1'}, {generateAudio: false}, {generateAudio: 1}, {resolution: '1080p'}]) {
    await assert.rejects(f.client.createVideo({prompt: 'An orchard', ...input}), error => error.status === 400);
  }
  assert.equal(f.calls.length, 0);
});

test('operation identifiers and polling URLs must remain exact, with legacy provider receipts untouched', async () => {
  assert.equal(googleVideoJobId(ID), ID); assert.equal(googleVideoPollingUrl(`/v1beta/${ID}`, ID), POLL);
  for (const id of ['job-or', ID + '/more', ID + '?key=secret', ID.replace('operation_123', '../foo'), ID.replace(MODEL, 'sora-2')]) assert.equal(googleVideoJobId(id), '');
  for (const url of [POLL + '?key=secret', POLL + '#x', POLL.replace('operation_123', 'other'), POLL.replace(ORIGIN, 'https://evil.test'), POLL.replace('/operations/', '/operations/../operations/'), POLL.replace('operation', '%6fperation'), '//generativelanguage.googleapis.com/v1beta/' + ID]) assert.equal(googleVideoPollingUrl(url, ID), '');
  const f = fixture(); const old = Object.freeze({provider: 'openrouter', jobId: 'job-or', pollingUrl: 'https://openrouter.ai/api/v1/videos/job-or', outputUrl: '/uploads/preserved.mp4'});
  const snapshot = JSON.stringify(old);
  await assert.rejects(f.client.getVideo(old), {code: 'ai_video_provider_mismatch', status: 409});
  await assert.rejects(f.client.downloadVideo(DATA, old), {code: 'ai_video_provider_mismatch', status: 409});
  await assert.rejects(f.client.getVideo({...JOB, pollingUrl: POLL + '?key=x'}), {code: 'ai_video_receipt_invalid', status: 409});
  assert.equal(JSON.stringify(old), snapshot); assert.equal(f.calls.length + f.downloads.length, 0);
});

test('poll normalizes processing/completion/terminal failure with one GET each and no private provider payload', async () => {
  const raw = [{name: ID}, completed(), {name: ID, done: true, error: {code: 3, message: 'Private prompt and key=secret'}}, {name: ID, done: true, response: {generateVideoResponse: {raiMediaFilteredCount: 1, raiMediaFilteredReasons: ['Private prompt']}}}];
  const f = fixture({responder: () => json(raw.shift())});
  for (const status of ['processing', 'completed', 'failed', 'failed']) {
    const result = await f.client.getVideo(JOB);
    assert.equal(result.data.id, ID); assert.equal(result.data.status, status);
    assert.doesNotMatch(JSON.stringify(result.data), /Private|key=secret/);
  }
  assert.equal(f.calls.length, 4); assert.ok(f.calls.every(call => call.url === POLL && call.options.method === 'GET' && !call.options.body));
  assert.equal(f.downloads.length, 0);
});

test('a valid receipt is preserved even when the initial POST contains a malformed completed result', async () => {
  const f = fixture({responder: () => json({name: ID, done: true, response: {private: 'payload'}})});
  const created = await f.client.createVideo({prompt: 'An orchard'});
  assert.deepEqual(googleVideoReceipt(created.data), {jobId: ID, pollingUrl: POLL});
  assert.equal(created.data.status, 'queued'); assert.equal(f.calls.length, 1);
});

test('malformed 200 polls are failures in health and cannot produce a downloadable asset', async () => {
  for (const raw of [{name: ID.replace('123', '456')}, {name: ID, done: 'true'}, {name: ID, done: false, response: {}}, {name: ID, done: true}, {...completed(), response: {generateVideoResponse: {generatedSamples: [{video: {uri: 'https://evil.test/file.mp4'}}]}}}]) {
    const f = fixture({responder: () => json(raw)});
    await assert.rejects(f.client.getVideo(JOB), error => error.status === 502);
    assert.deepEqual(f.observations, [{id: 'google_video', state: 'failed'}]);
    assert.equal(f.calls.length, 1); assert.equal(f.downloads.length, 0);
  }
});

test('HTTP errors, malformed responses and network failures do not retry paid requests or reveal provider errors', async () => {
  for (const responder of [() => json({error: {message: 'private-secret'}}, {status: 403}), () => json({error: {message: 'private-secret'}}, {status: 503}), () => { throw Error('private-secret'); }, () => json({name: 'not-an-operation'}), () => json({}, {headers: {'Content-Type': 'text/html'}}), () => json({}, {headers: {'Content-Type': 'application/json', 'Content-Length': String(2 * 1024 * 1024)}})]) {
    const f = fixture({responder});
    await assert.rejects(f.client.createVideo({prompt: 'An orchard'}), error => { assert.doesNotMatch(error.message, /private-secret/); assert.equal(error.submissionUncertain, error.status >= 500); return true; });
    assert.equal(f.calls.length, 1); assert.equal(f.downloads.length, 0);
  }
});

test('JSON reads enforce their byte limit even without Content-Length', async () => {
  const f = fixture({responder: () => json({name: ID, unused: 'a'.repeat(1024 * 1024)})});
  await assert.rejects(f.client.createVideo({prompt: 'An orchard'}), {code: 'google_video_response_too_large', submissionUncertain: true});
  assert.equal(f.calls.length, 1);
});

test('POST timeout is uncertain and polling timeout never starts another generation', async () => {
  const f = fixture({createTimeoutMs: 5, pollTimeoutMs: 5, responder: (_url, {signal}) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('private abort payload')), {once: true}))});
  // AbortSignal.timeout is unref'ed; keep this tiny isolated test alive until both promises settle.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(f.client.createVideo({prompt: 'An orchard'}), {code: 'google_video_timeout', status: 504, submissionUncertain: true});
    await assert.rejects(f.client.getVideo(JOB), {code: 'google_video_timeout', status: 504});
    assert.deepEqual(f.calls.map(call => call.options.method), ['POST', 'GET']);
  } finally { clearTimeout(keepAlive); }
});

test('download validates receipt, exact File API URL, MP4 bytes and public address before returning a buffer', async () => {
  const f = fixture();
  assert.deepEqual(await f.client.downloadVideo(DATA, JOB), MP4);
  assert.equal(f.downloads.length, 1); assert.equal(f.downloads[0].url, FILE);
  assert.deepEqual(f.downloads[0].options.headers, {Accept: 'video/mp4,application/octet-stream', 'x-goog-api-key': ENV.GEMINI_API_KEY});
  assert.deepEqual(f.downloads[0].connected.address, [{address: '142.250.1.1', family: 4}]);
  assert.equal(f.downloads[0].options.agent, false); assert.equal(f.calls.length, 0);
  assert.deepEqual(f.observations, [{id: 'google_video', state: 'completed'}]);
});

test('download never forwards the API key on a validated Google CDN redirect', async () => {
  const cdn = 'https://video-download.googleusercontent.com/generated/asset.mp4?signature=temporary';
  const f = fixture({downloadResponses: [{status: 302, headers: {location: cdn}, lateSocketError: true}, {body: MP4}]});
  assert.deepEqual(await f.client.downloadVideo(DATA, JOB), MP4);
  assert.equal(f.downloads.length, 2); assert.equal(f.lookups.length, 2);
  assert.equal(f.downloads[0].options.headers['x-goog-api-key'], ENV.GEMINI_API_KEY);
  assert.deepEqual(f.downloads[1].options.headers, {Accept: 'video/mp4,application/octet-stream'});
  assert.equal(f.downloads[1].connected.address, '142.250.1.1');
  assert.doesNotMatch(JSON.stringify(f.downloads[1]), /secret|Authorization|Cookie/);
});

test('redirects to untrusted/internal hosts, HTTP, auth-bearing URLs and redirect loops are blocked', async () => {
  for (const location of ['https://evil.test/video.mp4', 'https://googleusercontent.com.evil.test/a', 'http://storage.googleapis.com/a', 'https://user:pass@storage.googleapis.com/a', 'https://storage.googleapis.com/a?key=private', FILE, 'https://127.0.0.1/a', '/relative']) {
    const f = fixture({downloadResponses: [{status: 302, headers: {location}}]});
    await assert.rejects(f.client.downloadVideo(DATA, JOB), error => ['video_download_redirect_blocked', 'video_download_url_invalid'].includes(error.code));
    assert.equal(f.downloads.length, 1);
  }
  const f = fixture({downloadResponses: [{status: 302, headers: {location: 'https://storage.googleapis.com/loop'}}]});
  await assert.rejects(f.client.downloadVideo(DATA, JOB), {code: 'video_download_redirect_blocked'});
  assert.equal(f.downloads.length, 3);
});

test('direct arbitrary or mismatched download data cannot send a key or issue requests', async () => {
  const f = fixture();
  for (const data of [{...DATA, id: 'different'}, {...DATA, status: 'processing'}, {...DATA, content_url: FILE + '&key=bad'}, {...DATA, content_url: FILE.replace('/files/', '/files/../files/')}, {...DATA, content_url: 'https://storage.googleapis.com/direct.mp4'}]) await assert.rejects(f.client.downloadVideo(data, JOB), {code: 'ai_video_receipt_invalid', status: 409});
  assert.equal(f.downloads.length + f.calls.length, 0);
});

test('download DNS fails closed and reports fixed diagnostics', async () => {
  for (const options of [{addresses: [{address: '127.0.0.1', family: 4}]}, {addresses: [{address: '142.250.1.1', family: 4}, {address: '10.0.0.1', family: 4}]}, {addresses: []}, {lookupFailure: true}]) {
    const f = fixture(options);
    await assert.rejects(f.client.downloadVideo(DATA, JOB), error => { assert.doesNotMatch(error.message, /private/); return ['video_download_address_blocked', 'video_download_dns_failed'].includes(error.code); });
    assert.equal(f.downloads.length, 1); assert.equal(f.downloads[0].connected, undefined);
  }
});

test('download rejects oversize, truncated, non-MP4, wrong MIME, failed HTTP and timed-out streams', async () => {
  for (const [spec, code, options] of [
    [{body: MP4, headers: {'content-type': 'text/html'}}, 'video_download_response_invalid'],
    [{body: MP4, headers: {'content-length': '500000000'}}, 'video_download_response_invalid'],
    [{body: MP4, headers: {'content-length': '100'}}, 'video_download_incomplete'],
    [{body: Buffer.from('not a video file')}, 'video_download_not_mp4'],
    [{body: MP4}, 'video_download_too_large', {maxDownloadBytes: 12}],
    [{status: 503}, 'video_download_http_temporary'],
    [{abort: true}, 'video_download_incomplete'],
    [{hang: true}, 'video_download_timeout', {downloadTimeoutMs: 5}]
  ]) {
    const f = fixture({downloadResponses: [spec], ...options});
    await assert.rejects(f.client.downloadVideo(DATA, JOB), {code});
    assert.equal(f.downloads.length, 1); assert.equal(f.observations[0].state, 'failed');
  }
});
