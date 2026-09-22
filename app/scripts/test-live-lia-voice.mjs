import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveLiaSession, mountLiveLiaVoice, validLiveOffer} from '../live-lia-voice.js';

const offer = 'v=0\r\no=- 123 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\na=rtpmap:111 opus/48000/2\r\n';

test('validates an audio SDP offer before any chargeable call', async () => {
  assert.equal(validLiveOffer(offer), true);
  for (const sdp of ['', 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 111\r\n', 'x'.repeat(65537)]) {
    let called = false;
    await assert.rejects(createLiveLiaSession({sdp, apiKey: 'test', fetchImpl: () => {called = true;}}), /inválida/);
    assert.equal(called, false);
  }
});

test('creates private WebRTC session with server key and factual backend', async () => {
  let call;
  const result = await createLiveLiaSession({sdp: offer, apiKey: 'test-only', fetchImpl: async (url, options) => {
    call = {url, options};
    return {ok: true, json: async () => ({session: {id: 'live_123'}, transport: {sdp: 'v=0\r\nanswer'}})};
  }});
  assert.equal(call.url, 'https://api.openai.com/v1/live/sessions');
  assert.equal(call.options.headers.Authorization, 'Bearer test-only');
  const body = JSON.parse(call.options.body);
  assert.equal(body.session.model, 'gpt-live-1');
  assert.equal(body.session.delegation.responses.tools[0].type, 'web_search');
  assert.equal(body.transport.sdp, offer);
  assert.deepEqual(result, {session: {id: 'live_123'}, transport: {type: 'webrtc', sdp: 'v=0\r\nanswer'}});
});

test('route requires admin and same origin before starting billable session', async () => {
  const routes = [];
  mountLiveLiaVoice({app: {get: (...args) => routes.push(args), post: (...args) => routes.push(args)}, requireAdmin: () => {}, sameOriginOnly: () => {}, apiKey: ''});
  assert.equal(routes.length, 2);
  assert.equal(routes[1][0], '/api/admin/live-studio/lia/voice-live/session');
  assert.equal(routes[1].length, 4);
});
