import assert from 'node:assert/strict';
import express from 'express';
import { setupSearchVideoEligibility } from '../search-video-eligibility.js';

const PATH = '/api/search/video-eligibility';
const VIDEO = 'dQw4w9WgXcQ';
const OTHER = 'abcdefghijk';
const THIRD = 'Ab_cd-12345';
const TEST_KEY = 'local-fixture-key-not-a-credential';
const startTime = Date.parse('2026-09-06T12:00:00Z');
const videoId = index => `test${String(index).padStart(7, '0')}`;
const eligible = (id = VIDEO, status = {}) => ({ items: [{ id, status: { madeForKids: false, embeddable: true, ...status } }] });

async function serve(options) {
  const app = express();
  // Only this isolated mock server trusts synthetic visitor addresses.
  app.set('trust proxy', true);
  setupSearchVideoEligibility(app, options);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    async get(params = { provider: 'youtube', id: VIDEO }, ip = '192.0.2.1') {
      const query = typeof params === 'string' ? params : new URLSearchParams(params).toString();
      const response = await fetch(`${origin}${PATH}?${query}`, { headers: { 'X-Forwarded-For': ip } });
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      const data = await response.json();
      assert.deepEqual(Object.keys(data).sort(), ['available', 'id', 'provider', 'reason']);
      assert.equal(data.provider, 'youtube');
      assert.equal(data.available, data.reason === 'eligible');
      assert.equal(JSON.stringify(data).includes(TEST_KEY), false);
      return { status: response.status, headers: response.headers, data };
    },
    async close() { await new Promise(resolve => server.close(resolve)); }
  };
}

async function fixture(callback, fetchImpl = async () => Response.json(eligible()), options = {}) {
  const instance = await serve({ getEnv: () => ({ YOUTUBE_API_KEY: TEST_KEY }), fetchImpl, now: () => startTime, ...options });
  try { await callback(instance); } finally { await instance.close(); }
}

await fixture(async api => {
  const response = await api.get();
  assert.equal(response.status, 200);
  assert.deepEqual(response.data, { available: true, reason: 'eligible', provider: 'youtube', id: VIDEO });
}, async (url, options) => {
  assert.equal(url.origin, 'https://www.googleapis.com');
  assert.equal(url.pathname, '/youtube/v3/videos');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['id', 'key', 'part']);
  assert.equal(url.searchParams.get('part'), 'status');
  assert.equal(url.searchParams.get('id'), VIDEO);
  assert.equal(url.searchParams.get('key'), TEST_KEY);
  assert.equal(options.method, 'GET');
  assert.equal(options.redirect, 'error');
  assert.equal(options.headers.Accept, 'application/json');
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.body, undefined);
  return Response.json({ ...eligible(), secret: TEST_KEY, player: { embedHtml: '<script>bad()</script>' } });
});

let invalidCalls = 0;
await fixture(async api => {
  for (const id of ['', 'short', `${VIDEO}a`, ` ${VIDEO}`, `${VIDEO}\n`, `${VIDEO},${OTHER}`,
    'https://youtube.com/watch?v=' + VIDEO, '<script>x</script>', 'あいうえおかきくけこさ', 'http://x.xx', '../12345678']) {
    const response = await api.get({ provider: 'youtube', id });
    assert.equal(response.status, 400);
    assert.equal(response.data.reason, 'invalid_request');
    assert.equal(response.data.id, '', 'Invalid inputs must not be reflected.');
  }
  for (const query of [
    `provider=tiktok&id=${VIDEO}`, `provider=YouTube&id=${VIDEO}`, `id=${VIDEO}`,
    `provider=youtube&provider=youtube&id=${VIDEO}`, `provider=youtube&id=${VIDEO}&id=${OTHER}`,
    `provider=youtube&id[]=${VIDEO}`, `provider=youtube&id=${VIDEO}&url=https://127.0.0.1/`,
    `provider=youtube&id=${VIDEO}&key=${TEST_KEY}`, `provider=youtube&id=${VIDEO}&q=private`
  ]) {
    const response = await api.get(query);
    assert.equal(response.status, 400);
    assert.equal(response.data.id, '');
  }
  assert.equal(invalidCalls, 0);
}, async () => { invalidCalls++; throw Error('must not reach provider'); });

for (const [status, reason] of [
  [{ madeForKids: true }, 'made_for_kids'],
  [{ madeForKids: undefined }, 'audience_unknown'],
  [{ madeForKids: null }, 'audience_unknown'],
  [{ madeForKids: 'false' }, 'audience_unknown'],
  [{ madeForKids: 0 }, 'audience_unknown'],
  [{ madeForKids: undefined, selfDeclaredMadeForKids: false }, 'audience_unknown'],
  [{ embeddable: false }, 'not_embeddable'],
  [{ embeddable: undefined }, 'not_embeddable'],
  [{ embeddable: 'true' }, 'not_embeddable'],
  [{ embeddable: 1 }, 'not_embeddable']
]) {
  await fixture(async api => {
    const response = await api.get();
    assert.equal(response.status, 200);
    assert.equal(response.data.reason, reason);
    assert.equal(response.data.available, false);
  }, async () => Response.json(eligible(VIDEO, status)));
}

await fixture(async api => {
  const response = await api.get();
  assert.equal(response.status, 200);
  assert.equal(response.data.reason, 'not_found');
}, async () => Response.json({ items: [] }));

for (const payload of [null, [], {}, { items: {} }, eligible(OTHER), { items: [{ id: VIDEO }] },
  { items: [{ id: VIDEO, status: [] }] }, { items: [{ id: VIDEO, status: 'true' }] },
  { items: [...eligible().items, ...eligible(OTHER).items] }]) {
  await fixture(async api => {
    const response = await api.get();
    assert.equal(response.status, 503);
    assert.equal(response.data.reason, 'unavailable');
  }, async () => Response.json(payload));
}

for (const getEnv of [() => ({}), () => null, () => ({ YOUTUBE_API_KEY: '' }),
  () => ({ YOUTUBE_API_KEY: '  ' }), () => ({ YOUTUBE_API_KEY: 'x'.repeat(257) }),
  () => ({ YOUTUBE_API_KEY: 'x\ny' }), () => ({ YOUTUBE_API_KEY: ['not-a-key'] })]) {
  await fixture(async api => {
    const response = await api.get();
    assert.equal(response.status, 503);
    assert.equal(response.data.reason, 'not_configured');
  }, async () => { throw Error('must not call provider'); }, { getEnv });
}

await fixture(async api => {
  assert.equal((await api.get()).data.reason, 'unavailable');
}, async () => { throw Error('must not call provider'); }, { getEnv: () => { throw Error(TEST_KEY); } });

let clock = startTime, calls = 0;
await fixture(async api => {
  await api.get();
  clock += 599999;
  await api.get();
  assert.equal(calls, 1, 'Eligibility is cached for ten minutes.');
  clock += 1;
  await api.get();
  assert.equal(calls, 2, 'Expired eligibility is checked again.');
}, async () => { calls++; return Response.json(eligible()); }, { now: () => clock });

clock = startTime; calls = 0;
await fixture(async api => {
  assert.equal((await api.get()).data.reason, 'made_for_kids');
  await api.get();
  assert.equal(calls, 1, 'Ineligible statuses are cached too.');
  clock += 600001;
  await api.get();
  assert.equal(calls, 2);
}, async () => { calls++; return Response.json(eligible(VIDEO, { madeForKids: true })); }, { now: () => clock });

clock = startTime; calls = 0;
await fixture(async api => {
  const first = await api.get();
  assert.equal(first.status, 503);
  assert.equal(first.headers.get('retry-after'), '30');
  clock += 29999;
  await api.get();
  assert.equal(calls, 1, 'Failed eligibility is briefly cached.');
  clock += 1;
  await api.get();
  assert.equal(calls, 2, 'Failed eligibility can recover after thirty seconds.');
}, async () => { calls++; throw new Error(TEST_KEY); }, { now: () => clock });

calls = 0;
let runtimeKey = TEST_KEY;
await fixture(async api => {
  assert.equal((await api.get()).data.reason, 'eligible');
  runtimeKey = '';
  assert.equal((await api.get()).data.reason, 'not_configured');
  assert.equal(calls, 1, 'A removed key cannot serve a cached eligible decision.');
  runtimeKey = 'a-different-local-fixture';
  await api.get();
  assert.equal(calls, 2);
}, async () => { calls++; return Response.json(eligible()); }, { getEnv: () => ({ YOUTUBE_API_KEY: runtimeKey }) });

for (const makeResponse of [
  () => new Response('<html>Unavailable</html>', { status: 503, headers: { 'Content-Type': 'text/html' } }),
  () => Response.json({ error: { message: TEST_KEY } }, { status: 403 }),
  () => Response.json({ error: { message: TEST_KEY } }, { status: 429 }),
  () => new Response('{broken', { headers: { 'Content-Type': 'application/json' } }),
  () => new Response(JSON.stringify(eligible()), { headers: { 'Content-Type': 'text/plain' } }),
  () => new Response(JSON.stringify(eligible()), { headers: { 'Content-Type': 'application/json', 'Content-Length': '32769' } }),
  () => new Response(' '.repeat(32769), { headers: { 'Content-Type': 'application/json' } }),
  () => new Response(null, { headers: { 'Content-Type': 'application/json' } }),
  () => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private' } })
]) {
  await fixture(async api => {
    const response = await api.get();
    assert.equal(response.status, 503);
    assert.equal(response.data.reason, 'unavailable');
  }, async () => makeResponse());
}

for (const reason of ['quotaExceeded', 'dailyLimitExceeded']) {
  await fixture(async api => {
    const response = await api.get();
    assert.equal(response.status, 429);
    assert.equal(response.data.reason, 'quota');
    assert.equal(response.headers.get('retry-after'), '30');
  }, async () => Response.json({ error: { message: TEST_KEY, errors: [{ reason }] } }, { status: 403 }));
}

let cancelled = false;
await fixture(async api => {
  assert.equal((await api.get()).data.reason, 'unavailable');
  assert.equal(cancelled, true, 'Oversized streamed responses are cancelled.');
}, async () => new Response(new ReadableStream({
  start(controller) { controller.enqueue(new Uint8Array(16384)); controller.enqueue(new Uint8Array(16385)); },
  cancel() { cancelled = true; }
}), { headers: { 'Content-Type': 'application/json' } }));

clock = startTime; calls = 0;
await fixture(async api => {
  for (let index = 0; index < 15; index++) assert.equal((await api.get()).status, 200);
  const response = await api.get();
  assert.equal(response.status, 429);
  assert.equal(response.data.reason, 'rate_limited');
  assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(calls, 1, 'Even cached lookups have a visitor limit.');
  assert.equal((await api.get(undefined, '192.0.2.2')).status, 200);
  clock += 60000;
  assert.equal((await api.get()).status, 200);
}, async () => { calls++; return Response.json(eligible()); }, { now: () => clock });

const releases = new Map();
const starts = new Map();
const onStart = id => new Promise(resolve => starts.set(id, resolve));
calls = 0;
await fixture(async api => {
  const firstStarted = onStart(VIDEO);
  const first = api.get();
  await firstStarted;
  const duplicate = api.get(undefined, '192.0.2.2');
  const secondStarted = onStart(OTHER);
  const second = api.get({ provider: 'youtube', id: OTHER });
  await secondStarted;
  const busy = await api.get({ provider: 'youtube', id: THIRD });
  assert.equal(busy.status, 429);
  assert.equal(busy.data.reason, 'busy');
  assert.equal(calls, 2, 'There are at most two upstream requests; duplicates share a request.');
  releases.get(VIDEO)();
  releases.get(OTHER)();
  for (const response of await Promise.all([first, duplicate, second])) assert.equal(response.data.reason, 'eligible');
}, async url => {
  calls++;
  const id = url.searchParams.get('id');
  const wait = new Promise(resolve => releases.set(id, resolve));
  starts.get(id)?.();
  await wait;
  return Response.json(eligible(id));
});

clock = startTime; calls = 0;
await fixture(async api => {
  for (let index = 0; index < 100; index++) {
    const response = await api.get({ provider: 'youtube', id: videoId(index) }, `192.0.2.${index + 1}`);
    assert.equal(response.status, index % 2 ? 503 : 200);
  }
  assert.equal(calls, 100);
  let response = await api.get({ provider: 'youtube', id: videoId(100) }, '192.0.2.201');
  assert.equal(response.status, 429);
  assert.equal(response.data.reason, 'quota');
  assert.equal(response.headers.get('retry-after'), '43200');
  assert.equal(calls, 100, 'Failed attempts count toward the shared daily cap.');
  response = await api.get({ provider: 'youtube', id: videoId(0) }, '192.0.2.202');
  assert.equal(response.data.reason, 'eligible', 'The daily cap does not disable cached decisions.');
  clock += 24 * 60 * 60000;
  assert.equal((await api.get({ provider: 'youtube', id: videoId(100) })).data.reason, 'eligible');
  assert.equal(calls, 101, 'UTC day rollover restores the local allowance.');
}, async url => {
  calls++;
  const id = url.searchParams.get('id');
  if (Number(id.slice(4)) % 2) throw Error('fixture failure');
  return Response.json(eligible(id));
}, { now: () => clock });

// Crossing midnight can produce more than 100 still-fresh entries: FIFO must bound the cache.
clock = Date.parse('2026-09-06T23:59:50Z'); calls = 0;
await fixture(async api => {
  for (let index = 0; index < 100; index++) await api.get({ provider: 'youtube', id: videoId(index) }, `192.0.2.${index + 1}`);
  clock += 11000;
  for (let index = 100; index < 200; index++) await api.get({ provider: 'youtube', id: videoId(index) }, `198.51.100.${index - 99}`);
  assert.equal(calls, 200);
  assert.equal((await api.get({ provider: 'youtube', id: videoId(199) })).data.reason, 'eligible');
  assert.equal((await api.get({ provider: 'youtube', id: videoId(0) })).data.reason, 'quota', 'Old entries were evicted, despite not expiring yet.');
  assert.equal(calls, 200);
}, async url => { calls++; return Response.json(eligible(url.searchParams.get('id'))); }, { now: () => clock });

let timeoutAborted = false;
await fixture(async api => {
  const started = Date.now();
  const response = await api.get();
  assert.equal(response.status, 503);
  assert.equal(response.data.reason, 'unavailable');
  assert.equal(timeoutAborted, true);
  assert.ok(Date.now() - started < 12000, 'The provider request times out in a bounded period.');
}, async (_url, options) => new Promise((_resolve, reject) => {
  options.signal.addEventListener('abort', () => { timeoutAborted = true; reject(options.signal.reason); }, { once: true });
}));

console.log('search-video-eligibility: strict inputs, fail-closed audience/embed status, secret isolation, bounded JSON, timeout, cache, deduplication, concurrency, visitor and daily limits passed');
