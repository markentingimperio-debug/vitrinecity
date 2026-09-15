import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import Database from 'better-sqlite3';
import {createCommerceShopeeOAuth} from '../commerce-shopee-oauth.js';

const response = (payload, status = 200) => new Response(JSON.stringify(payload), {status, headers: {'Content-Type': 'application/json'}});
const encrypt = value => 'protected:' + Buffer.from(value).toString('base64');
const decrypt = value => Buffer.from(value.slice(10), 'base64').toString();
const TIME = Date.parse('2026-09-15T15:00:00Z');
const config = () => ({enabled: true, partnerId: 123456, partnerKey: 'PARTNER_KEY_SECRET_FIXTURE'});
const tokens = shopId => ({error: '', message: '', access_token: 'ACCESS_SECRET_' + shopId, refresh_token: 'REFRESH_SECRET_' + shopId,
  expire_in: 14400, shop_id_list: [shopId]});
const identity = shopId => ({error: '', shop_name: 'Loja fixture ' + shopId, region: 'BR', status: 'NORMAL',
  auth_time: Math.floor(TIME / 1000) - 3600, expire_time: Math.floor(TIME / 1000) + 180 * 86400});
function fixture(t, options = {}) {
  const db = new Database(':memory:'); t.after(() => db.close());
  let time = TIME;
  const state = {config: config(), mutateToken: p => p, mutateIdentity: p => p}, calls = [];
  const fetchImpl = async (raw, opts) => {
    const url = new URL(raw), body = opts.body ? JSON.parse(opts.body) : undefined;
    assert.equal(url.origin, 'https://partner.shopeemobile.com');
    assert.ok(['/api/v2/auth/token/get', '/api/v2/auth/access_token/get', '/api/v2/shop/get_shop_info'].includes(url.pathname));
    assert.equal(opts.redirect, 'error'); assert.equal(opts.credentials, 'omit'); assert.ok(opts.signal instanceof AbortSignal);
    assert.equal(opts.headers.Accept, 'application/json');
    const shopId = Number(body?.shop_id || url.searchParams.get('shop_id'));
    const suffix = url.pathname.endsWith('/get_shop_info') ? url.searchParams.get('access_token') + shopId : '';
    const expectedSign = createHmac('sha256', state.config.partnerKey).update(String(state.config.partnerId) + url.pathname + url.searchParams.get('timestamp') + suffix).digest('hex');
    assert.equal(url.searchParams.get('sign'), expectedSign);
    assert.equal(url.searchParams.get('partner_id'), String(state.config.partnerId));
    assert.equal(url.searchParams.get('timestamp'), String(Math.floor(time / 1000)));
    if (url.pathname.endsWith('/get_shop_info')) { assert.equal(opts.method, 'GET'); assert.equal(opts.body, undefined); }
    else { assert.equal(opts.method, 'POST'); assert.equal(opts.headers['Content-Type'], 'application/json'); assert.equal(body.partner_id, state.config.partnerId); }
    calls.push({url, opts, body});
    if (options.fetchImpl) return options.fetchImpl(url, opts, state, shopId);
    if (url.pathname.endsWith('/get_shop_info')) return response(state.mutateIdentity(identity(shopId)));
    if (url.pathname.endsWith('/access_token/get')) return response(state.mutateToken({...tokens(shopId), shop_id: shopId, partner_id: state.config.partnerId, refresh_token: 'ROTATED_REFRESH_SECRET_' + shopId}));
    return response(state.mutateToken(tokens(shopId)));
  };
  const service = createCommerceShopeeOAuth({db, encrypt, decrypt, siteUrl: 'https://vitrinecity.com', getConfig: () => state.config, now: () => time, fetchImpl, ...options.service});
  const admin = {adminId: 7, sessionKey: 'ADMIN_SESSION_FIXTURE'};
  const begin = () => new URL(service.begin(admin).authorizationUrl).searchParams.get('state');
  const complete = (shopId = 111, state = begin()) => service.complete({...admin, state, code: 'AUTH_CODE_FIXTURE', shopId});
  return {db, state, service, calls, admin, begin, complete, advance: ms => { time += ms; }};
}

test('construction is inert; strict opt-in, configuration and HTTPS gate every operation', async t => {
  const forbidden = () => assert.fail('Unexpected secret/network operation');
  const inert = fixture(t, {service: {getConfig: forbidden, encrypt: forbidden, decrypt: forbidden, fetchImpl: forbidden}});
  // Construction did not call getConfig. A throwing config safely reports disabled.
  assert.equal(inert.service.status().connected, false);
  for (const enabled of [undefined, false, 'true', 1]) {
    const f = fixture(t, {service: {encrypt: forbidden, decrypt: forbidden, fetchImpl: forbidden}}); f.state.config.enabled = enabled;
    assert.equal(f.service.status().enabled, false); assert.equal(f.service.status().configured, false);
    assert.throws(() => f.begin(), /disabled/); await assert.rejects(f.service.verifyShop(111), /disabled/);
  }
  for (const siteUrl of ['http://vitrinecity.com', 'https://127.0.0.1', 'https://localhost', 'https://app.local', 'https://a:b@vitrinecity.com', 'https://vitrinecity.com:8888']) {
    const f = fixture(t, {service: {siteUrl, getConfig: forbidden}});
    assert.equal(f.service.status().redirectUri, null); assert.throws(() => f.begin(), /disabled/);
  }
  const bad = fixture(t); bad.state.config.partnerId = '1;DROP';
  assert.equal(bad.service.status().configured, false); assert.throws(() => bad.begin(), /app_missing/);
});

test('auth uses the exact current BR flow, fixed callback and hashed admin/session-bound one-use state', async t => {
  const f = fixture(t), url = new URL(f.service.begin(f.admin).authorizationUrl), state = url.searchParams.get('state');
  assert.equal(url.origin, 'https://open.shopee.com.br'); assert.equal(url.pathname, '/auth');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['auth_type', 'partner_id', 'redirect_uri', 'response_type', 'state'].sort());
  assert.equal(url.searchParams.get('auth_type'), 'seller'); assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://vitrinecity.com/api/admin/commerce/shopee/callback');
  const row = f.db.prepare('SELECT * FROM commerce_shopee_oauth_states').get();
  assert.notEqual(row.state_hash, state); assert.notEqual(row.session_hash, f.admin.sessionKey); assert.equal(row.admin_id, 7);
  for (const override of [{adminId: 8}, {sessionKey: 'OTHER_SESSION'}, {shopId: '111x'}, {shopId: ['111']}, {code: ['CODE']}])
    await assert.rejects(f.service.complete({...f.admin, state, code: 'CODE', shopId: 111, ...override}), /state_invalid/);
  assert.equal(f.calls.length, 0);
  await f.complete('111', state);
  assert.deepEqual(f.calls[0].body, {partner_id: 123456, code: 'AUTH_CODE_FIXTURE', shop_id: 111});
  assert.equal(f.calls[0].url.pathname, '/api/v2/auth/token/get');
  await assert.rejects(f.complete(111, state), /state_invalid/); assert.equal(f.calls.length, 2);
  const expired = f.begin(); f.advance(600000); await assert.rejects(f.complete(111, expired), /state_invalid/);
});

test('multiple shops persist independently, encrypted and identity-only; other integrations remain untouched', async t => {
  const f = fixture(t);
  f.db.exec("CREATE TABLE google_search_oauth(marker TEXT); INSERT INTO google_search_oauth VALUES('unchanged'); CREATE TABLE commerce_sheets_account(marker TEXT); INSERT INTO commerce_sheets_account VALUES('unchanged');");
  await f.complete(111); const status = await f.complete(222);
  assert.equal(status.connected, true); assert.equal(status.dataSyncAvailable, false); assert.equal(status.readOnly, true);
  assert.deepEqual(status.shops.map(s => s.shopId), [111, 222]);
  assert.ok(status.lastVerifiedAt); assert.equal(f.calls.length, 4);
  for (const row of f.db.prepare('SELECT * FROM commerce_shopee_shops').all()) {
    assert.equal(decrypt(row.access_encrypted), 'ACCESS_SECRET_' + row.shop_id);
    assert.equal(decrypt(row.refresh_encrypted), 'REFRESH_SECRET_' + row.shop_id);
    assert.notEqual(row.access_encrypted, decrypt(row.access_encrypted));
  }
  assert.doesNotMatch(JSON.stringify(status), /ACCESS_SECRET|REFRESH_SECRET|PARTNER_KEY|AUTH_CODE|ADMIN_SESSION/);
  f.service.disconnect(111);
  assert.deepEqual(f.service.status().shops.map(s => s.shopId), [222]); assert.equal(f.service.status().connected, true);
  assert.equal(f.db.prepare('SELECT marker FROM google_search_oauth').get().marker, 'unchanged');
  assert.equal(f.db.prepare('SELECT marker FROM commerce_sheets_account').get().marker, 'unchanged');
  f.service.disconnect(); assert.equal(f.service.status().shops.length, 0); assert.equal(f.calls.length, 4);
});

test('callback rejects contradictory or malformed shop identity fields and invalid token data', async t => {
  for (const mutate of [p => ({...p, shop_id_list: [222]}), p => ({...p, shop_id_list: []}), p => ({...p, shop_id_list: null}),
    p => ({...p, shop_id_list: '111'}), p => ({...p, shop_id_list: [null, 111]}), p => ({...p, shop_id: 222}),
    p => ({...p, refresh_token: undefined}), p => ({...p, access_token: 'SECRET\r\n'}), p => ({...p, expire_in: '14400'}),
    p => ({...p, expire_in: 999999}), p => ({...p, partner_id: 999})]) {
    const f = fixture(t); f.state.mutateToken = mutate;
    await assert.rejects(f.complete()); assert.equal(f.calls.length, 1); assert.equal(f.service.status().connected, false);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM commerce_shopee_shops').get().n, 0);
  }
});

test('documented single-shop token response without shop_id_list connects only after the signed identity read', async t => {
  const omitList = p => { const {shop_id_list, ...singleShop} = p; return singleShop; };
  const f = fixture(t); f.state.mutateToken = omitList;
  const connected = await f.complete(111);
  assert.equal(connected.connected, true); assert.equal(connected.shops[0].shopId, 111); assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[0].body, {partner_id: 123456, code: 'AUTH_CODE_FIXTURE', shop_id: 111});
  assert.equal(f.calls[1].url.pathname, '/api/v2/shop/get_shop_info');
  assert.equal(f.calls[1].url.searchParams.get('shop_id'), '111');
  assert.equal(f.calls[1].url.searchParams.get('access_token'), 'ACCESS_SECRET_111');
  const rejected = fixture(t); rejected.state.mutateToken = omitList;
  rejected.state.mutateIdentity = p => ({...p, error: 'error_auth', message: 'Invalid partner_id or shopid.'});
  await assert.rejects(rejected.complete(111), /identity_rejected/);
  assert.equal(rejected.service.status().connected, false);
  assert.equal(rejected.db.prepare('SELECT COUNT(*) n FROM commerce_shopee_shops').get().n, 0);
});

test('identity must be top-level Brazilian NORMAL shop with valid bounded name and active authorization', async t => {
  for (const mutate of [p => ({...p, region: 'SG'}), p => ({...p, status: 'BANNED'}), p => ({...p, shop_id: 222}),
    p => ({...p, shop_name: {html: 'bad'}}), p => ({...p, shop_name: 'x'.repeat(201)}), p => ({...p, shop_name: 'bad\u202e'}),
    p => ({...p, expire_time: 1}), p => ({...p, auth_time: '1234'}), p => ({error: '', response: p})]) {
    const f = fixture(t); f.state.mutateIdentity = mutate;
    await assert.rejects(f.complete(), /identity_invalid/); assert.equal(f.calls.length, 2); assert.equal(f.service.status().connected, false);
  }
  const f = fixture(t); f.state.mutateIdentity = p => ({...p, private_buyer_fields: {secret: 'DO_NOT_RETURN'}});
  assert.doesNotMatch(JSON.stringify(await f.complete()), /private_buyer|DO_NOT_RETURN/);
});

test('config changes and crypto failure are closed without leaking secrets or reusing a callback', async t => {
  const broken = fixture(t, {service: {encrypt: () => {throw new Error('PRIVATE_KEY_MUST_NOT_LEAK');}}});
  assert.throws(() => broken.begin(), e => e.code === 'commerce_shopee_encryption_unavailable' && !String(e).includes('PRIVATE_KEY'));
  const f = fixture(t), state = f.begin(); f.state.config.partnerKey = 'NEW_PARTNER_SECRET_FIXTURE';
  await assert.rejects(f.complete(111, state), /state_invalid/); assert.equal(f.calls.length, 0);
  await f.complete(); f.state.config.partnerKey = 'CHANGED_AGAIN_SECRET_FIXTURE';
  assert.equal(f.service.status().connected, false); await assert.rejects(f.service.verifyShop(111), /reconnect_required/);
});

test('bounded response and sanitized provider/network failures consume the code exactly once', async t => {
  for (const kind of ['large', 'provider', 'network', 'malformed']) {
    const f = fixture(t, {fetchImpl: async () => {
      if (kind === 'large') return new Response('x'.repeat(32769));
      if (kind === 'provider') return response({error: 'PRIVATE_ACCESS_SECRET', message: 'PRIVATE_CODE'}, 500);
      if (kind === 'malformed') return new Response('PRIVATE_NON_JSON');
      throw new Error('PRIVATE_NETWORK_URL_WITH_TOKEN');
    }}), state = f.begin();
    await assert.rejects(f.complete(111, state), e => e.code.startsWith('commerce_shopee_') && !String(e).includes('PRIVATE'));
    await assert.rejects(f.complete(111, state), /state_invalid/); assert.equal(f.calls.length, 1);
  }
});

test('refresh rotates single-use tokens atomically, signs public path and coalesces concurrent verification', async t => {
  const f = fixture(t); await f.complete(); f.advance(14400001);
  const [a, b] = await Promise.all([f.service.verifyShop(111), f.service.verifyShop('111')]);
  assert.deepEqual(a, b); assert.equal(f.calls.length, 4);
  assert.equal(f.calls[2].url.pathname, '/api/v2/auth/access_token/get');
  assert.deepEqual(f.calls[2].body, {partner_id: 123456, refresh_token: 'REFRESH_SECRET_111', shop_id: 111});
  assert.equal(decrypt(f.db.prepare('SELECT refresh_encrypted FROM commerce_shopee_shops WHERE shop_id=111').get().refresh_encrypted), 'ROTATED_REFRESH_SECRET_111');
  assert.equal(f.calls[3].url.pathname, '/api/v2/shop/get_shop_info');
  assert.equal(a.connected, true);
});

test('uncertain refresh, wrong shop and non-rotating refresh require new authorization without retry', async t => {
  for (const kind of ['timeout', 'wrong_shop', 'same_refresh', 'provider']) {
    const f = fixture(t, {fetchImpl: async (url, _opts, _state, shopId) => {
      if (url.pathname.endsWith('/get_shop_info')) return response(identity(shopId));
      if (url.pathname.endsWith('/token/get')) return response(tokens(shopId));
      if (kind === 'timeout') throw new Error('PRIVATE_REFRESH_SECRET_TIMEOUT');
      if (kind === 'provider') return response({error: 'PRIVATE_ERROR'}, 503);
      return response({...tokens(shopId), shop_id: kind === 'wrong_shop' ? 999 : shopId,
        refresh_token: kind === 'same_refresh' ? 'REFRESH_SECRET_111' : 'NEW_REFRESH_SECRET'});
    }});
    await f.complete(); f.advance(14400001);
    await assert.rejects(f.service.verifyShop(111), /refresh_pending_review/);
    const calls = f.calls.length; assert.equal(f.service.status().connected, false); assert.equal(f.service.status().status, 'needs_review');
    await assert.rejects(f.service.verifyShop(111), /reconnect_required/); assert.equal(f.calls.length, calls);
  }
});

test('disconnect fences in-flight callbacks and a fresh authorization does not disable other shops', async t => {
  let resume, entered;
  const waiting = new Promise(resolve => {entered = resolve;});
  const f = fixture(t, {fetchImpl: async (url, _opts, _state, shopId) => {
    if (url.pathname.endsWith('/get_shop_info')) { entered(); await new Promise(resolve => {resume = resolve;}); return response(identity(shopId)); }
    return response(tokens(shopId));
  }});
  const pending = f.complete(); await waiting; f.service.disconnect(111); resume();
  await assert.rejects(pending, /connection_changed/); assert.equal(f.service.status().connected, false);
  const normal = fixture(t); await normal.complete(111); const state = normal.begin();
  assert.equal(normal.service.status().connected, true); await normal.complete(222, state); assert.equal(normal.service.status().shops.length, 2);
});

test('refresh completion cannot resurrect a disconnected shop', async t => {
  let resume, entered;
  const waiting = new Promise(resolve => {entered = resolve;});
  const f = fixture(t, {fetchImpl: async (url, _opts, _state, shopId) => {
    if (url.pathname.endsWith('/get_shop_info')) return response(identity(shopId));
    if (url.pathname.endsWith('/token/get')) return response(tokens(shopId));
    entered(); await new Promise(resolve => {resume = resolve;});
    return response({...tokens(shopId), shop_id: shopId, refresh_token: 'ROTATED_REFRESH_SECRET'});
  }});
  await f.complete(); f.advance(14400001);
  const pending = f.service.verifyShop(111); await waiting; f.service.disconnect(111); resume();
  await assert.rejects(pending, /refresh_pending_review/); assert.equal(f.service.status().connected, false);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM commerce_shopee_shops').get().n, 0);
});

test('expired authorization and stale refresh lock cannot initiate further network calls', async t => {
  const f = fixture(t); await f.complete();
  f.db.prepare('UPDATE commerce_shopee_shops SET refresh_owner=?,refresh_until=?').run('UNKNOWN_WORKER', TIME - 1);
  assert.equal(f.service.status().connected, false); await assert.rejects(f.service.verifyShop(111), /reconnect_required/); assert.equal(f.calls.length, 2);
  const expired = fixture(t); await expired.complete(); expired.advance(181 * 86400000);
  assert.equal(expired.service.status().connected, false); await assert.rejects(expired.service.verifyShop(111), /reconnect_required/); assert.equal(expired.calls.length, 2);
});

test('capacity is reserved before token exchange: 19 shops plus two callbacks cannot create a hidden 21st shop', async t => {
  let hold = false, resume, entered;
  const waiting = new Promise(resolve => {entered = resolve;});
  const f = fixture(t, {fetchImpl: async (url, _opts, _state, shopId) => {
    if (url.pathname.endsWith('/get_shop_info')) return response(identity(shopId));
    if (hold) { entered(); await new Promise(resolve => {resume = resolve;}); }
    return response(tokens(shopId));
  }});
  for (let id = 1; id <= 19; id++) await f.complete(id);
  const stateA = f.begin(), otherAdmin = {...f.admin, adminId: 8};
  const stateB = new URL(f.service.begin(otherAdmin).authorizationUrl).searchParams.get('state');
  hold = true;
  const pendingA = f.complete(20, stateA); await waiting;
  await assert.rejects(f.service.complete({...otherAdmin, state: stateB, code: 'OTHER_CODE', shopId: 21}), /shop_limit/);
  assert.equal(f.calls.length, 39); // Nineteen verified pairs, then one reserved token exchange.
  resume(); await pendingA;
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM commerce_shopee_shops').get().n, 20);
  assert.equal(f.service.status().shops.length, 20); assert.equal(f.service.status().shops.at(-1).shopId, 20);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM commerce_shopee_connect_locks').get().n, 0);
});
