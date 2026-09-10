import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaProvider, resolveMediaConfig, OPENAI_VIDEO_UNAVAILABLE_REASON} from '../ai-media-provider.js';
import {videoReceipt, videoProjectUnchanged} from '../video-provider-receipts.js';
import {createIntegrationObserver} from '../integration-health.js';

const both = {OPENAI_API_KEY: 'openai-test-secret', OPENROUTER_API_KEY: 'router-test-secret'};
const openai = {...both, AI_MEDIA_PROVIDER: 'openai'};
const router = {...both, AI_MEDIA_PROVIDER: 'openrouter'};
const pngHeader = (width = 1024, height = 1024) => {
  const bytes = Buffer.alloc(24);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes.toString('base64');
};
const imageResult = () => ({data: [{b64_json: pngHeader()}], usage: {total_tokens: 12}});
const response = (data, init = {}) => new Response(JSON.stringify(data), {headers: {'Content-Type': 'application/json'}, ...init});
function fixture(env = openai, responder = () => response(imageResult())) {
  const calls = [], observations = [], downloads = [];
  const client = createMediaProvider({env,
    fetchImpl: async (url, options) => { calls.push({url, options}); return responder(url, options); },
    observer: {run: async (id, run) => { observations.push(id); return run(); }},
    downloadImpl: async (...args) => { downloads.push(args); return Buffer.from('local-mp4-fixture'); }});
  return {client, calls, observations, downloads};
}

test('auto retains legacy preference while explicit media selection is independent of text and keys', () => {
  assert.equal(resolveMediaConfig(both).provider, 'openrouter');
  assert.equal(resolveMediaConfig({...both, AI_MEDIA_PROVIDER: 'auto'}).explicit, false);
  const config = resolveMediaConfig({...openai, AI_TEXT_PROVIDER: 'openrouter', OPENROUTER_IMAGE_MODEL: 'private/router-model'});
  assert.equal(config.provider, 'openai');
  assert.equal(config.explicit, true);
  assert.equal(config.imageConfigured, true);
  assert.equal(config.imageModel, 'gpt-image-2');
  assert.ok(config.imageOptions.every(model => model.startsWith('gpt-image-')));
  assert.equal(config.videoEnabled, false);
  assert.equal(config.videoConfigured, false);
  assert.equal(config.videoModel, '');
  assert.deepEqual(config.videoOptions, []);
  assert.equal(config.videoReason, OPENAI_VIDEO_UNAVAILABLE_REASON);
  assert.doesNotMatch(JSON.stringify(config), /test-secret|private\/router-model|API_KEY/);
});

test('invalid or missing explicit provider credentials never fall back to another account', async () => {
  for (const env of [{...both, AI_MEDIA_PROVIDER: 'typo'}, {AI_MEDIA_PROVIDER: 'openai', OPENROUTER_API_KEY: both.OPENROUTER_API_KEY}, {...openai, OPENAI_IMAGE_MODEL: 'qwen/qwen-image-3'}, {...openai, OPENAI_IMAGE_MODEL: 'gpt-image-unknown'}, {...openai, OPENAI_IMAGE_MODEL: 'gpt-image-1'}, {...openai, OPENAI_IMAGE_MODEL: 'gpt-image-1.5'}]) {
    const f = fixture(env);
    assert.equal(f.client.config.configured, false);
    await assert.rejects(f.client.requestImage({prompt: 'A quiet library'}), error => error.status === 503 && error.code.startsWith('ai_media_'));
    assert.equal(f.calls.length, 0);
  }
});

test('OpenAI image requests use the official endpoint, selected key, exact ratios and normalized image bytes', async () => {
  const f = fixture();
  for (const [aspectRatio, size] of Object.entries({'1:1':'1024x1024','4:5':'1024x1280','9:16':'864x1536','16:9':'1536x864','2:3':'1024x1536','3:2':'1536x1024'})) {
    const result = await f.client.requestImage({prompt: 'A quiet library', aspectRatio});
    assert.equal(result.provider, 'openai');
    assert.equal(result.data.data[0].b64_json, pngHeader());
    assert.deepEqual(result.data.usage, {total_tokens: 12});
    const {url, options} = f.calls.at(-1);
    assert.equal(url, 'https://api.openai.com/v1/images/generations');
    assert.equal(options.headers.Authorization, 'Bearer ' + both.OPENAI_API_KEY);
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), {model: 'gpt-image-2', prompt: 'A quiet library', n: 1, size, quality: 'medium', output_format: 'png'});
  }
  assert.deepEqual(f.observations, Array(6).fill('openai_media'));
  assert.ok(f.calls.every(call => !JSON.stringify(call).includes(both.OPENROUTER_API_KEY)));
});

test('OpenAI rejects legacy project models and unsupported input before any paid request', async () => {
  const f = fixture();
  for (const input of [{model: 'qwen/qwen-image-3'}, {aspectRatio: '200:1'}, {n: 2}, {prompt: ''}, {prompt: 'x'.repeat(8001)}]) {
    await assert.rejects(f.client.requestImage({prompt: 'A quiet library', ...input}), error => error.status === 400);
  }
  assert.equal(f.calls.length, 0);
});

test('new OpenAI videos remain unavailable regardless of stale enable flags and never invoke a provider', async () => {
  const f = fixture({...openai, OPENAI_VIDEO_ENABLED: '1', OPENAI_VIDEO_MODEL: 'sora-2'});
  assert.equal(f.client.config.videoEnabled, false);
  await assert.rejects(f.client.createVideo({prompt: 'A quiet library', durationSeconds: 4}), {code: 'ai_video_unavailable', status: 503});
  await assert.rejects(f.client.getVideo({provider: 'openai', jobId: 'video_123', pollingUrl: 'https://api.openai.com/v1/videos/video_123'}), {code: 'ai_video_unavailable'});
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.downloads, []);
});

test('switching to OpenAI preserves legacy receipts/assets and blocks both repoll and redownload at the old provider', async () => {
  const f = fixture();
  const oldJob = Object.freeze({provider: 'openrouter', jobId: 'job-old', pollingUrl: 'https://openrouter.ai/api/v1/videos/job-old', outputUrl: '/uploads/generated-videos/approved-old.mp4'});
  const before = JSON.stringify(oldJob);
  await assert.rejects(f.client.getVideo(oldJob), {code: 'ai_video_provider_mismatch', status: 409});
  await assert.rejects(f.client.downloadVideo({id: oldJob.jobId, status: 'completed'}, oldJob), {code: 'ai_video_provider_mismatch', status: 409});
  assert.equal(JSON.stringify(oldJob), before);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.downloads, []);
});

test('HTTP and network failures remain one attempt with fixed diagnostics and no cross-provider fallback', async () => {
  for (const responder of [() => response({error: {message: 'Bearer private-payload'}}, {status: 403}), () => { throw Error('private-payload'); }]) {
    const f = fixture(openai, responder);
    await assert.rejects(f.client.requestImage({prompt: 'A quiet library'}), error => {
      assert.doesNotMatch(error.message, /Bearer|private-payload/);
      return [403, 502].includes(error.status);
    });
    assert.equal(f.calls.length, 1);
    assert.equal(new URL(f.calls[0].url).origin, 'https://api.openai.com');
  }
});

test('inline image validation rejects downloads, malformed base64, invalid dimensions and oversized responses', async () => {
  for (const data of [{data: [{url: 'https://cdn.example/image.png'}]}, {data: [{b64_json: 'https://cdn.example/image.png'}]}, {data: [{b64_json: 'not base64'}]}, {data: [{b64_json: pngHeader(1, 1)}]}, {data: [{b64_json: pngHeader(10000, 10000)}]}]) {
    const f = fixture(openai, () => response(data));
    await assert.rejects(f.client.requestImage({prompt: 'A quiet library'}), {code: 'ai_media_image_invalid'});
    assert.equal(f.calls.length, 1);
  }
  for (const headers of [{'Content-Type': 'text/html'}, {'Content-Type': 'application/json', 'Content-Length': String(37 * 1024 * 1024)}]) {
    const f = fixture(openai, () => response(imageResult(), {headers}));
    await assert.rejects(f.client.requestImage({prompt: 'A quiet library'}), {code: 'ai_media_response_invalid'});
    assert.equal(f.calls.length, 1);
  }
});

test('legacy auto mode retains OpenRouter image mapping without changing its configured model or key', async () => {
  const f = fixture({...both, OPENROUTER_IMAGE_MODEL: 'qwen/qwen-image-3'});
  const result = await f.client.requestImage({prompt: 'A quiet library', aspectRatio: '16:9'});
  assert.equal(result.provider, 'openrouter');
  assert.equal(f.calls[0].url, 'https://openrouter.ai/api/v1/images');
  assert.equal(f.calls[0].options.headers.Authorization, 'Bearer ' + both.OPENROUTER_API_KEY);
  assert.deepEqual(JSON.parse(f.calls[0].options.body), {model: 'qwen/qwen-image-3', prompt: 'A quiet library', n: 1, aspect_ratio: '16:9'});
  assert.deepEqual(f.observations, ['openrouter_media']);
});

test('health records an invalid 200 image as a failure and marks success only after image validation',async()=>{
  const observer=createIntegrationObserver({now:()=>Date.parse('2026-09-10T12:00:00Z')});
  let calls=0;
  const client=createMediaProvider({env:openai,observer,fetchImpl:async()=>response(++calls===1?{data:[{b64_json:'invalid image bytes'}]}:imageResult())});
  await assert.rejects(client.requestImage({prompt:'A quiet library'}),{code:'ai_media_image_invalid'});
  assert.equal(calls,1);
  const failed=observer.snapshot().find(item=>item.id==='openai_media');
  assert.equal(failed.status,'failed');assert.equal(failed.code,'unavailable');
  assert.equal(observer.snapshot().find(item=>item.id==='openrouter_media').status,'unverified');
  await client.requestImage({prompt:'A quiet library'});
  assert.equal(calls,2);
  const completed=observer.snapshot().find(item=>item.id==='openai_media');
  assert.equal(completed.status,'completed');assert.equal(completed.code,null);
});

test('legacy video mode preserves one create, original receipt, same job GET and original download key', async () => {
  const f = fixture(router, (_url, options) => response(options.method === 'POST' ? {id: 'job-old', polling_url: '/api/v1/videos/job-old'} : {id: 'job-old', status: 'completed'}));
  const created = await f.client.createVideo({prompt: 'A quiet library', durationSeconds: 8, aspectRatio: '9:16', generateAudio: true});
  const job = {provider: created.provider, ...videoReceipt(created.data)};
  const polled = await f.client.getVideo(job);
  const file = await f.client.downloadVideo(polled.data, job);
  assert.deepEqual(file, Buffer.from('local-mp4-fixture'));
  assert.deepEqual(f.calls.map(call => call.options.method), ['POST', 'GET']);
  assert.equal(f.calls[1].url, 'https://openrouter.ai/api/v1/videos/job-old');
  assert.equal(f.downloads[0][1], 'job-old');
  assert.deepEqual(f.downloads[0][2], {apiKey: both.OPENROUTER_API_KEY});
  assert.equal(JSON.parse(f.calls[0].options.body).generate_audio, true);
  assert.equal(f.calls.every(call => call.options.redirect === 'error'), true);
});

test('video queries require a matching provider and an exact original job URL', async () => {
  const f = fixture(router);
  for (const job of [{provider: 'openai', jobId: 'job-old', pollingUrl: 'https://openrouter.ai/api/v1/videos/job-old'}, {provider: 'openrouter', jobId: 'job-old', pollingUrl: 'https://openrouter.ai/api/v1/videos/other'}, {provider: 'openrouter', jobId: 'job-old', pollingUrl: 'https://evil.example/api/v1/videos/job-old'}, {jobId: 'job-old', pollingUrl: '/api/v1/videos/job-old'}]) {
    await assert.rejects(f.client.getVideo(job), error => error.status === 409);
  }
  assert.equal(f.calls.length, 0);
  const mismatch = fixture(router, () => response({id: 'different-job', status: 'completed'}));
  await assert.rejects(mismatch.client.getVideo({provider: 'openrouter', jobId: 'job-old', pollingUrl: '/api/v1/videos/job-old'}), {code: 'ai_video_receipt_invalid'});
  assert.equal(mismatch.downloads.length, 0);
});

test('a concurrent provider change invalidates the video project snapshot', () => {
  const project = {format: 'short_video', production_status: 'editing', video_provider: 'openrouter', remote_job_id: 'job-old', polling_url: '/api/v1/videos/job-old'};
  assert.equal(videoProjectUnchanged(project, {...project}), true);
  assert.equal(videoProjectUnchanged({...project, video_provider: 'openai'}, project), false);
  assert.equal(videoProjectUnchanged({format: 'short_video'}, {format: 'short_video'}), true);
});
