import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { run, createApi, openJournal, TARGET, PRAYER_META_CHANNELS, validateManifest } from '../prayer-meta-adapter.js';

// Entire suite is offline: no credential loading, provider generation or publication.
const VIDEO = '123456789012', CONTAINER = '234567890123', MEDIA = '345678901234', POST = '456789012345';
const manifest = { campaign: 'oracao-2026-09-12', videoPath: path.resolve('synthetic-prayer.mp4'), publicVideoUrl: 'https://vitrinecity.com/prayer-media/2026-09-12/short.mp4', title: 'Oração de teste', caption: 'Uma oração de teste com imagem e voz criadas com inteligência artificial.' };
const info = { sha256: 'a'.repeat(64), bytes: 512, durationSeconds: 30, width: 720, height: 1280, fps: 30, videoCodec: 'h264', audioCodec: 'aac' };
const fbStory = () => ({ post_id: POST, status: 'PUBLISHED', media_type: 'video', media_id: VIDEO, url: `https://www.facebook.com/stories/${TARGET.pageId}/${POST}/` });
const igStory = () => ({ id: MEDIA, owner: { id: TARGET.instagramId }, username: TARGET.instagramUsername, media_type: 'VIDEO', media_product_type: 'STORY', permalink: `https://www.instagram.com/stories/${TARGET.instagramUsername}/1234567890123456/`, is_ai_generated: true });

function fixture(channel = 'facebook-stories') {
  let stored = null, allowed = true, failPost = '', failGet = false, story = channel === 'facebook-stories' ? fbStory() : igStory(), containerStatus = 'FINISHED';
  const calls = [], saves = [];
  const journal = { load: () => structuredClone(stored), save: value => { stored = structuredClone(value); saves.push(structuredClone(value)); } };
  const api = {
    async preflight(value) { calls.push(['preflight', value]); return { requiredScopesPresent: true }; },
    async verifyPublic() { calls.push(['verifyPublic']); },
    async post(endpoint, body) {
      const attempt = body.upload_phase === 'start' ? 'start' : body.upload_phase === 'finish' ? 'finish' : endpoint.endsWith('/media_publish') ? 'publish' : 'create';
      assert.equal(stored.attempts[attempt].state, 'pending_unknown', 'durable intent must precede every POST');
      calls.push(['post', endpoint, structuredClone(body)]);
      if (failPost === attempt) throw Object.assign(new Error('private provider URL and token must never persist'), { code: 'prayer_network_or_response_unknown' });
      return attempt === 'start' ? { video_id: VIDEO, upload_url: 'https://attacker.invalid/ignored' } : attempt === 'finish' ? { success: true, post_id: POST } : { id: attempt === 'publish' ? MEDIA : CONTAINER };
    },
    async upload(id, bytes) { assert.equal(stored.attempts.upload.state, 'pending_unknown'); assert.equal(id, VIDEO); assert.equal(bytes.length, 512); calls.push(['upload']); if (failPost === 'upload') throw Error('timeout'); return { success: true }; },
    async get(endpoint, params) {
      calls.push(['get', endpoint, params]);
      if (failGet) throw Object.assign(new Error('temporary GET failure'), { code: 'prayer_network_or_response_unknown' });
      if (endpoint.endsWith('/stories')) return { data: story ? Array.isArray(story) ? story : [story] : [] };
      if (endpoint === VIDEO) return { id: VIDEO, from: { id: TARGET.pageId }, description: manifest.caption, permalink_url: `https://www.facebook.com/reel/${VIDEO}`, status: { video_status: 'ready', uploading_phase: { status: 'complete' }, processing_phase: { status: 'complete' }, publishing_phase: { status: 'complete' } } };
      if (endpoint === CONTAINER) return { id: CONTAINER, status_code: containerStatus };
      if (endpoint === MEDIA) return { ...igStory(), caption: manifest.caption, media_product_type: 'REELS', permalink: 'https://www.instagram.com/reel/fixture123/' };
      throw Error('unexpected endpoint');
    },
  };
  const options = { channel, manifest, credentialVersion: 'synthetic-version', local: { buffer: Buffer.alloc(512), info }, api, journal, canPublish: () => allowed };
  return { options, calls, saves, journal, state: () => stored, run: mode => run({ ...options, mode }), setAllowed: value => allowed = value, setFailPost: value => failPost = value, setFailGet: value => failGet = value, setStory: value => story = value, setContainer: value => containerStatus = value, writeCount: () => calls.filter(x => ['post', 'upload'].includes(x[0])).length };
}
async function publishSteps(f) { await f.run('prepare'); for (let i = 0; i < 5 && f.state().phase !== 'publishing'; i++) await f.run('step'); assert.equal(f.state().phase, 'publishing'); }

test('Facebook Story is uploaded separately and verified only on the exact Page Stories edge', async () => {
  const f = fixture(); await publishSteps(f);
  assert.deepEqual(f.calls.filter(x => x[0] === 'post'), [
    ['post', `${TARGET.pageId}/video_stories`, { upload_phase: 'start' }],
    ['post', `${TARGET.pageId}/video_stories`, { upload_phase: 'finish', video_id: VIDEO, is_ai_generated: true }],
  ]);
  assert.equal(f.state().postId, POST); assert.equal(f.state().verifiedAt, undefined);
  await f.run('status'); assert.equal(f.state().phase, 'published_verified'); assert.equal(f.state().verification.kind, 'page_stories_edge');
  assert.equal(f.state().permalink, fbStory().url); assert.equal(f.state().publicReachVerified, false);
});

test('Instagram Story waits for FINISHED, excludes Reel caption/share fields and validates Story owner', async () => {
  const f = fixture('instagram-stories'); await f.run('prepare'); await f.run('step');
  f.setContainer('IN_PROGRESS'); await f.run('step'); assert.equal(f.state().phase, 'processing'); assert.equal(f.writeCount(), 1);
  f.setContainer('FINISHED'); await f.run('step'); assert.equal(f.state().phase, 'ready_to_publish'); await f.run('step');
  assert.deepEqual(f.calls.find(x => x[0] === 'post'), ['post', `${TARGET.instagramId}/media`, { media_type: 'STORIES', video_url: manifest.publicVideoUrl, is_ai_generated: true }]);
  assert.equal(f.state().phase, 'publishing'); await f.run('status');
  assert.equal(f.state().phase, 'published_verified'); assert.equal(f.state().mediaId, MEDIA); assert.equal(f.state().aiLabelReadback, true);
  assert.equal(f.calls.filter(x => x[0] === 'verifyPublic').length, 2);
});

test('Facebook v26 observed lowercase status and padded single-story URL verify without weakening credential URL checks', async () => {
  const f=fixture(); await publishSteps(f);
  const url='https://facebook.com/stories/122098852472061143/UzpfSVNDOjEzOTc2NjQ2NzE3NjY5MjI=/?view_single=1';
  f.setStory({...fbStory(),status:'published',url}); await f.run('status');
  assert.equal(f.state().phase,'published_verified'); assert.equal(f.state().permalink,url);
  for(const suffix of ['?view_single=2','?view_single=1&access_token=secret','?redirect=https://evil.invalid']){
    const bad=fixture(); await publishSteps(bad); bad.setStory({...fbStory(),status:'published',url:url.split('?')[0]+suffix});
    await assert.rejects(bad.run('status'),{code:'prayer_story_verification_failed'});
  }
});

for (const channel of ['facebook-stories', 'instagram-stories']) {
  test(`${channel}: transient GET failure remains retryable without republishing`, async () => {
    const f = fixture(channel); await publishSteps(f); const n = f.writeCount(), before = structuredClone(f.state());
    f.setFailGet(true); await assert.rejects(f.run('status'), { code: 'prayer_network_or_response_unknown' }); assert.deepEqual(f.state(), before);
    f.setFailGet(false); await f.run('status'); assert.equal(f.state().phase, 'published_verified'); assert.equal(f.writeCount(), n);
  });
  test(`${channel}: saved confirmation remains historical after expiry and never replays`, async () => {
    const f = fixture(channel); await publishSteps(f); await f.run('status'); const before = structuredClone(f.state()), n = f.calls.length;
    f.setStory(null); f.setFailGet(true); await f.run('step'); await f.run('status'); assert.deepEqual(f.state(), before); assert.equal(f.calls.length, n);
  });
  test(`${channel}: pause and changed binding prevent any write`, async () => {
    const f = fixture(channel); await f.run('prepare'); f.setAllowed(false); await assert.rejects(f.run('step'), { code: 'prayer_publication_paused' }); assert.equal(f.writeCount(), 0);
    await assert.rejects(run({ ...f.options, mode: 'step', manifest: { ...manifest, title: 'Changed' } }), { code: 'prayer_receipt_binding_changed' });
    await assert.rejects(run({ ...f.options, mode: 'step', credentialVersion: 'another-account' }), { code: 'prayer_receipt_binding_changed' }); assert.equal(f.writeCount(), 0);
  });
  test(`${channel}: missing result is unverified, even if video processing succeeded`, async () => {
    const f = fixture(channel); await publishSteps(f); f.setStory(null); await f.run('status'); assert.equal(f.state().phase, 'published_needs_verification'); assert.equal(f.state().verifiedAt, undefined);
  });
}

test('uncertain Facebook finish can be reconciled by exact unique video on Page Stories without a second POST', async () => {
  const f = fixture(); await f.run('prepare'); await f.run('step'); await f.run('step'); f.setFailPost('finish'); await f.run('step');
  assert.equal(f.state().phase, 'held_unknown'); assert.equal(f.state().postId, undefined); assert.doesNotMatch(JSON.stringify(f.state()), /private provider|attacker/);
  const n = f.writeCount(); await f.run('status'); assert.equal(f.state().phase, 'published_verified'); assert.equal(f.state().postId, POST); assert.equal(f.writeCount(), n);
});

test('uncertain Facebook upload stays held even after successful upload status; no automatic finish', async () => {
  const f = fixture(); await f.run('prepare'); await f.run('step'); f.setFailPost('upload'); await f.run('step'); const n = f.writeCount();
  for (let i = 0; i < 3; i++) await f.run('step'); assert.equal(f.state().phase, 'held_unknown'); assert.equal(f.writeCount(), n); assert.equal(f.state().attempts.finish, undefined);
});

test('uncertain Instagram publish remains held with only container receipt, never create/publish again', async () => {
  const f = fixture('instagram-stories'); await f.run('prepare'); await f.run('step'); await f.run('step'); f.setFailPost('publish'); await f.run('step');
  const n = f.writeCount(); f.setContainer('PUBLISHED'); await f.run('step'); await f.run('status'); assert.equal(f.state().phase, 'held_unknown'); assert.equal(f.writeCount(), n);
});

test('Stories readback refuses wrong placement, owner, media identity and hostile links', async () => {
  for (const bad of [{ media_product_type: 'REELS' }, { owner: { id: '99999999' } }, { username: 'another' }, { permalink: 'https://evil.invalid/stories/123' }, { permalink: 'https://www.instagram.com/reel/123/' }]) {
    const f = fixture('instagram-stories'); await publishSteps(f); f.setStory({ ...igStory(), ...bad }); await assert.rejects(f.run('status'), { code: 'prayer_story_verification_failed' }); assert.equal(f.state().phase, 'publishing');
  }
  for (const bad of [{ media_type: 'photo' }, { status: 'DRAFT' }, { url: 'https://www.facebook.com.evil.invalid/stories/123' }, { url: 'https://www.facebook.com/stories/123/?access_token=secret' }]) {
    const f = fixture(); await publishSteps(f); f.setStory({ ...fbStory(), ...bad }); await assert.rejects(f.run('status'), { code: 'prayer_story_verification_failed' });
  }
  const f = fixture(); await publishSteps(f); f.setStory({ ...fbStory(), media_id: '99999999' }); await f.run('status'); assert.equal(f.state().phase, 'published_needs_verification');
});

test('ambiguous Facebook Story matches never become confirmed', async () => {
  const f = fixture(); await publishSteps(f); f.setStory([fbStory(), fbStory()]); await assert.rejects(f.run('status'), { code: 'prayer_story_verification_failed' });
});

test('Story spec limits fail before network; Reel 200MB contract remains unchanged', async () => {
  const f = fixture('instagram-stories');
  for (const delta of [{ bytes: 100 * 1024 * 1024 + 1 }, { durationSeconds: 61 }, { durationSeconds: NaN }, { width: 1921 }]) {
    await assert.rejects(run({ ...f.options, mode: 'prepare', local: { info: { ...info, ...delta } } }), { code: 'prayer_story_video_specs_invalid' });
  }
  assert.equal(f.calls.length, 0);
  await run({ ...fixture('instagram').options, mode: 'prepare', local: { info: { ...info, bytes: 150 * 1024 * 1024 } } });
});

test('actual journals isolate Reels and Stories with exclusive locks and unchanged filenames', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prayer-meta-stories-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const journals = PRAYER_META_CHANNELS.map(channel => openJournal(dir, channel, manifest.campaign));
  try {
    assert.equal(new Set(journals.map(j => j.file)).size, 4);
    for (let i = 0; i < journals.length; i++) { journals[i].save({ channel: PRAYER_META_CHANNELS[i] }); assert.equal(path.basename(journals[i].file), `${manifest.campaign}-${PRAYER_META_CHANNELS[i]}.json`); }
    assert.throws(() => openJournal(dir, 'facebook-stories', manifest.campaign), { code: 'prayer_lock_held_manual_review' });
    assert.throws(() => openJournal(dir, '../facebook', manifest.campaign), { code: 'prayer_journal_invalid' });
  } finally { journals.forEach(j => j.close()); }
});

test('legacy Reel payload order, bindings, fields and readback remain unchanged', async () => {
  for (const channel of ['facebook', 'instagram']) {
    const f = fixture(channel); await f.run('prepare');
    const legacyManifest = { campaign: manifest.campaign, videoPath: path.resolve(manifest.videoPath), publicVideoUrl: manifest.publicVideoUrl, title: manifest.title, caption: manifest.caption };
    const legacyTarget = { accountId: 7, userId: 4, pageId: '127910957075609', pageName: 'Campo & Conhecimento', instagramId: '17841461502665390', instagramUsername: 'agrotecniica' };
    assert.equal(f.state().binding, createHash('sha256').update(JSON.stringify({ manifest: legacyManifest, channel, info, account: legacyTarget })).digest('hex'));
    assert.equal(JSON.stringify(validateManifest(manifest)), JSON.stringify(legacyManifest));
    await publishSteps(f); await f.run('status'); assert.equal(f.state().phase, 'published_verified');
    const posts = f.calls.filter(x => x[0] === 'post');
    if (channel === 'facebook') assert.deepEqual(posts.at(-1), ['post', `${TARGET.pageId}/video_reels`, { upload_phase: 'finish', video_id: VIDEO, video_state: 'PUBLISHED', title: manifest.title, description: manifest.caption, is_ai_generated: true }]);
    else assert.deepEqual(posts[0], ['post', `${TARGET.instagramId}/media`, { media_type: 'REELS', video_url: manifest.publicVideoUrl, caption: manifest.caption, share_to_feed: true, is_ai_generated: true }]);
    const n = f.writeCount(); await f.run('step'); assert.equal(f.writeCount(), n);
    await assert.rejects(run({ ...f.options, channel: channel + '-stories', mode: 'prepare' }), { code: 'prayer_receipt_binding_changed' });
  }
});

test('Graph adapter adds only fixed Story edges and uploads to canonical Meta host, ignoring supplied hosts', async () => {
  const calls = [], api = createApi({ token: 'test-only', appToken: 'test-app', appId: '111111', version: 'v26.0' }, async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify({ success: true }), { status: 200 }); });
  await api.post(`${TARGET.pageId}/video_stories`, { upload_phase: 'start' }); await api.get(`${TARGET.pageId}/stories`, { fields: 'post_id,media_id,url' }); await api.upload(VIDEO, Buffer.alloc(32));
  assert.ok(calls.every(c => ['graph.facebook.com', 'rupload.facebook.com'].includes(new URL(c.url).hostname)));
  assert.equal(calls.at(-1).url, `https://rupload.facebook.com/video-upload/v26.0/${VIDEO}`);
  assert.equal(calls.at(-1).options.redirect, 'manual');
  for (const endpoint of ['https://evil.invalid', `${TARGET.pageId}/stories/extra`, `${TARGET.pageId}/../me`, `${TARGET.pageId}/feed`]) assert.throws(() => api.get(endpoint), { code: 'prayer_endpoint_invalid' });
});

test('Stories preflight uses correct platform scopes and Instagram quota/identity checks', async () => {
  for (const channel of ['facebook-stories', 'instagram-stories']) {
    const requests = [], scopes = ['pages_show_list', 'pages_read_engagement', channel.startsWith('facebook') ? 'pages_manage_posts' : 'instagram_basic', ...(channel.startsWith('instagram') ? ['instagram_content_publish'] : [])];
    const api = createApi({ token: 'test-only', appToken: 'test-app', appId: '111111', version: 'v26.0' }, async url => {
      const endpoint = new URL(url).pathname.split('/').slice(2).join('/'); requests.push(endpoint);
      const data = endpoint === 'debug_token' ? { data: { is_valid: true, app_id: '111111', scopes } } : endpoint === 'me' ? { id: TARGET.pageId, instagram_business_account: { id: TARGET.instagramId } } : endpoint.endsWith('content_publishing_limit') ? { data: [{ config: { quota_total: 100 }, quota_usage: 1 }] } : { id: TARGET.instagramId, username: TARGET.instagramUsername };
      return new Response(JSON.stringify(data));
    });
    const proof = await api.preflight(channel); assert.equal(proof.pageId, TARGET.pageId);
    assert.equal(requests.includes(`${TARGET.instagramId}/content_publishing_limit`), channel === 'instagram-stories');
    if (channel === 'instagram-stories') assert.equal(proof.instagramId, TARGET.instagramId);
    scopes.pop(); await assert.rejects(api.preflight(channel), { code: 'prayer_token_permissions_invalid' });
  }
});
