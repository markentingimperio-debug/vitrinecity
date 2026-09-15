import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import {createCommerceSheetsOAuth, COMMERCE_SHEETS_ID, COMMERCE_SHEETS_SCOPE, COMMERCE_SHEETS_RANGES} from '../commerce-sheets-oauth.js';
import {createCommerceCenter,sheetsCostReferences} from '../commerce-center.js';

const response = (value, status = 200) => new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json'}});
const encrypt = value => 'protected:' + Buffer.from(value).toString('base64');
const decrypt = value => Buffer.from(value.slice(10), 'base64').toString();
const validConfig = () => ({clientId: '123456789012-commerce-fixture.apps.googleusercontent.com', clientSecret: 'APP_SECRET_FIXTURE'});
const tokenPayload = () => ({access_token: 'ACCESS_SECRET_FIXTURE', refresh_token: 'REFRESH_SECRET_FIXTURE', expires_in: 3600, token_type: 'Bearer', scope: COMMERCE_SHEETS_SCOPE});
const sheetPayload = () => ({spreadsheetId: COMMERCE_SHEETS_ID, valueRanges: COMMERCE_SHEETS_RANGES.map(range => ({range, majorDimension: 'ROWS', values: [['Produto', 12.5], ['Saldo', 0], ['Confirmado', true]]}))});
function fixture(t, options = {}) {
  const previous = process.env.COMMERCE_GOOGLE_OAUTH_ENABLED;
  process.env.COMMERCE_GOOGLE_OAUTH_ENABLED = options.enabled ?? 'true';
  const db = new Database(':memory:');
  t.after(() => {db.close(); if (previous === undefined) delete process.env.COMMERCE_GOOGLE_OAUTH_ENABLED; else process.env.COMMERCE_GOOGLE_OAUTH_ENABLED = previous;});
  let time = Date.parse('2026-09-15T15:00:00Z');
  const calls = [], state = {config: validConfig(), token: tokenPayload(), sheet: sheetPayload()};
  const fetchImpl = async (url, opts) => {calls.push({url, opts}); return options.fetchImpl ? options.fetchImpl(url, opts, state) : response(url.startsWith('https://sheets.googleapis.com/') ? state.sheet : state.token);};
  const service = createCommerceSheetsOAuth({db, encrypt, decrypt, siteUrl: 'https://vitrinecity.com', getConfig: () => state.config, commitRead:()=>{}, now: () => time, fetchImpl, ...options.service});
  const identity = {adminId: 7, sessionKey: 'ADMIN_SESSION_FIXTURE'};
  const begin = () => new URL(service.begin(identity).authorizationUrl).searchParams.get('state');
  const connect = () => service.complete({...identity, state: begin(), code: 'AUTH_CODE_FIXTURE'});
  return {db, service, state, calls, identity, begin, connect, advance: ms => {time += ms;}};
}

test('explicit flag and public HTTPS are required; disabled status never loads config, decrypts or contacts Google', async t => {
  const forbidden = () => assert.fail('Disabled service touched credentials or network');
  for (const flag of ['false', '', '1', 'TRUE']) {
    const f = fixture(t, {enabled: flag, service: {getConfig: forbidden, encrypt: forbidden, decrypt: forbidden, fetchImpl: forbidden}});
    assert.equal(f.service.status().enabled, false);
    assert.equal(f.service.status().configured, false);
    assert.equal(f.service.status().connected, false);
    assert.throws(() => f.begin(), /commerce_sheets_disabled/);
    await assert.rejects(f.service.complete({...f.identity, state: 'fixture', code: 'fixture'}), /commerce_sheets_disabled/);
    await assert.rejects(f.service.readCosts(), /commerce_sheets_disabled/);
  }
  for (const siteUrl of ['http://vitrinecity.com', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://app.localhost', 'https://app.local', 'https://u:p@vitrinecity.com', 'https://vitrinecity.com:8443', 'invalid']) {
    const f = fixture(t, {service: {siteUrl, getConfig: forbidden, decrypt: forbidden, fetchImpl: forbidden}});
    assert.equal(f.service.status().enabled, false);
    assert.equal(f.service.status().redirectUri, null);
    assert.throws(() => f.begin(), /commerce_sheets_disabled/);
  }
});

test('construction is inert and dedicated tables never overwrite Search Console or YouTube accounts', async t => {
  const f = fixture(t);
  f.db.exec("CREATE TABLE google_search_oauth(id INTEGER, marker TEXT); INSERT INTO google_search_oauth VALUES(1,'original-search'); CREATE TABLE youtube_upload_account(id INTEGER, marker TEXT); INSERT INTO youtube_upload_account VALUES(1,'original-youtube');");
  assert.equal(f.calls.length, 0);
  assert.equal(f.service.status().configured, true);
  assert.equal(f.service.status().connected, false);
  assert.equal(f.service.status().lastSyncAt, null);
  await f.connect();
  f.service.disconnect();
  assert.equal(f.db.prepare('SELECT marker FROM google_search_oauth').get().marker, 'original-search');
  assert.equal(f.db.prepare('SELECT marker FROM youtube_upload_account').get().marker, 'original-youtube');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM commerce_sheets_account').get().n, 0);
});

test('consent uses only Sheets readonly, PKCE, fixed callback and admin/session bound one-use state', async t => {
  const f = fixture(t), url = new URL(f.service.begin(f.identity).authorizationUrl), state = url.searchParams.get('state');
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.pathname, '/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('scope'), COMMERCE_SHEETS_SCOPE);
  assert.equal(url.searchParams.get('include_granted_scopes'), 'false');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://vitrinecity.com/api/admin/commerce/sheets/callback');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  const stored = f.db.prepare('SELECT * FROM commerce_sheets_oauth_states').get();
  assert.notEqual(stored.state_hash, state);
  assert.notEqual(stored.session_hash, f.identity.sessionKey);
  assert.equal(stored.admin_id, 7);
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(decrypt(stored.verifier_encrypted)).digest('base64url'));
  await assert.rejects(f.service.complete({...f.identity, adminId: 8, state, code: 'CODE'}), /state_invalid/);
  await assert.rejects(f.service.complete({...f.identity, sessionKey: 'OTHER', state, code: 'CODE'}), /state_invalid/);
  assert.equal(f.calls.length, 0);
  await f.service.complete({...f.identity, state, code: 'CODE'});
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://oauth2.googleapis.com/token');
  assert.equal(f.calls[0].opts.body.get('code_verifier'), decrypt(stored.verifier_encrypted));
  await assert.rejects(f.service.complete({...f.identity, state, code: 'CODE'}), /state_invalid/);
  assert.equal(f.calls.length, 1);
  const expired = f.begin(); f.advance(600000);
  await assert.rejects(f.service.complete({...f.identity, state: expired, code: 'CODE'}), /state_invalid/);
});

test('missing config, broken encryption, changed credentials and invalid grants cannot connect', async t => {
  const f = fixture(t); f.state.config = {};
  assert.equal(f.service.status().configured, false);
  assert.throws(() => f.begin(), /app_missing/);
  const broken = fixture(t, {service: {encrypt: () => {throw new Error('DONT_ECHO_PRIVATE_SECRET');}}});
  assert.throws(() => broken.begin(), error => error.code === 'commerce_sheets_encryption_unavailable' && !String(error).includes('PRIVATE_SECRET'));
  const changed = fixture(t), state = changed.begin(); changed.state.config.clientSecret = 'NEW_APP_SECRET';
  await assert.rejects(changed.service.complete({...changed.identity, state, code: 'CODE'}), /state_invalid/);
  assert.equal(changed.calls.length, 0);
  for (const mutate of [p => {p.scope += ' https://www.googleapis.com/auth/drive';}, p => {p.scope = 'https://www.googleapis.com/auth/webmasters.readonly';}, p => {delete p.scope;}, p => {delete p.refresh_token;}, p => {p.token_type = 'wrong';}, p => {p.expires_in = '3600';}, p => {p.access_token = 'secret\nheader';}]) {
    const invalid = fixture(t); mutate(invalid.state.token);
    await assert.rejects(invalid.connect());
    assert.equal(invalid.service.status().connected, false);
    assert.equal(invalid.db.prepare('SELECT COUNT(*) n FROM commerce_sheets_account').get().n, 0);
  }
});

test('encrypted credentials never reach status; completing OAuth does not read any sheet', async t => {
  const f = fixture(t), status = await f.connect(), row = f.db.prepare('SELECT * FROM commerce_sheets_account').get();
  assert.equal(status.connected, true);
  assert.equal(status.lastSyncAt, null);
  assert.equal(decrypt(row.access_encrypted), f.state.token.access_token);
  assert.equal(decrypt(row.refresh_encrypted), f.state.token.refresh_token);
  assert.notEqual(row.access_encrypted, f.state.token.access_token);
  assert.doesNotMatch(JSON.stringify(status), /ACCESS_SECRET|REFRESH_SECRET|APP_SECRET|AUTH_CODE|ADMIN_SESSION/);
  assert.equal(f.calls.length, 1);
  f.state.config.clientSecret = 'CHANGED_APP_SECRET';
  assert.equal(f.service.status().connected, false);
  await assert.rejects(f.service.readCosts(), /reconnect_required/);
  assert.equal(f.calls.length, 1);
});

test('cost read uses one fixed GET with three fixed ranges, strips extra fields and never computes profit', async t => {
  const f = fixture(t); await f.connect();
  f.state.sheet.secret = 'UNEXPECTED_SECRET';
  f.state.sheet.valueRanges[0].unexpected = {private: true};
  f.state.sheet.valueRanges[0].range = "'Precificacao'!A3:N30";
  const result = await f.service.readCosts({spreadsheetId: 'IGNORED_OTHER_SHEET'}), call = f.calls[1], url = new URL(call.url);
  assert.equal(url.origin, 'https://sheets.googleapis.com');
  assert.equal(url.pathname, `/v4/spreadsheets/${COMMERCE_SHEETS_ID}/values:batchGet`);
  assert.deepEqual(url.searchParams.getAll('ranges'), COMMERCE_SHEETS_RANGES);
  assert.equal(url.searchParams.get('majorDimension'), 'ROWS');
  assert.equal(url.searchParams.get('valueRenderOption'), 'UNFORMATTED_VALUE');
  assert.equal(call.opts.method, 'GET');
  assert.equal(call.opts.body, undefined);
  assert.equal(call.opts.credentials, 'omit');
  assert.equal(call.opts.redirect, 'error');
  assert.ok(call.opts.signal instanceof AbortSignal);
  assert.equal(call.opts.headers.Authorization, 'Bearer ACCESS_SECRET_FIXTURE');
  assert.equal(result.source, 'google_sheets_api');
  assert.equal(result.readOnly, true);
  assert.deepEqual(result.values[0], {range: COMMERCE_SHEETS_RANGES[0], rows: [['Produto', 12.5], ['Saldo', 0], ['Confirmado', true]]});
  assert.equal(f.service.status().lastSyncAt, result.measuredAt);
  assert.doesNotMatch(JSON.stringify(result), /UNEXPECTED_SECRET|ACCESS_SECRET|profit|lucroReal/);
});
test('sync stamp and private snapshot are atomic after financial-header validation', async t => {
  let center, rejectAfterSave = false;
  const f = fixture(t, { service: { commitRead: result => {
    center.saveAuditSnapshot(sheetsCostReferences(result), 'google_sheets_api');
    if (rejectAfterSave) throw Error('SIMULATED_PERSISTENCE_FAILURE');
  } } });
  center = createCommerceCenter({ db: f.db }); await f.connect();
  await assert.rejects(f.service.readCosts());
  assert.equal(f.service.status().lastSyncAt, null);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_audit_snapshots').get().n, 0);
  f.state.sheet.valueRanges[0].values = [['ID', 'Produto', 'Preco Venda (R$)', 'Custo Produto (R$)', 'Insumos/Embalagem (R$)'], [1, 'Produto de teste', 10, 2, 1]];
  f.state.sheet.valueRanges[2].values = [['Título'], ['Período histórico']];
  await f.service.readCosts(); const previous = f.service.status().lastSyncAt;
  assert.ok(previous); assert.equal(center.latest('google_sheets_api').references[0].costCents, 200);
  rejectAfterSave = true; f.advance(60000);
  await assert.rejects(f.service.readCosts());
  assert.equal(f.service.status().lastSyncAt, previous);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_audit_snapshots').get().n, 1);
});

test('wrong spreadsheet, excess rows/cells, objects and control text are rejected without a successful sync stamp', async t => {
  for (const mutate of [p => {p.spreadsheetId = 'OTHER';}, p => {p.valueRanges.pop();}, p => {p.valueRanges[0].range = 'Other!A3:N30';},
    p => {p.valueRanges[0].majorDimension = 'COLUMNS';}, p => {p.valueRanges[0].values = Array.from({length: 29}, () => []);},
    p => {p.valueRanges[1].values = [Array(3).fill(1)];}, p => {p.valueRanges[0].values = [[{private: 'SECRET'}]];},
    p => {p.valueRanges[0].values = [['x'.repeat(501)]];}, p => {p.valueRanges[0].values = [['bad\u0000text']];}]) {
    const f = fixture(t); await f.connect(); mutate(f.state.sheet);
    await assert.rejects(f.service.readCosts(), /values_invalid/);
    assert.equal(f.service.status().lastSyncAt, null);
  }
  const empty = fixture(t); await empty.connect(); empty.state.sheet.valueRanges.forEach(value => {delete value.values;});
  assert.deepEqual((await empty.service.readCosts()).values.map(value => value.rows), [[], [], []]);
});

test('response bytes are bounded and provider errors never echo private content', async t => {
  let mode = 'normal';
  const f = fixture(t, {fetchImpl: async (url, _opts, state) => {
    if (!url.startsWith('https://sheets.googleapis.com/')) return response(state.token);
    if (mode === 'large') return new Response('x'.repeat(262145));
    if (mode === 'error') return response({error: {message: 'PROVIDER_PRIVATE_SECRET'}}, 403);
    throw new Error('NETWORK_PRIVATE_SECRET');
  }});
  await f.connect();
  for (mode of ['large', 'error', 'network']) await assert.rejects(f.service.readCosts(), error => error.code.startsWith('commerce_sheets_') && !String(error).includes('PRIVATE_SECRET'));
  assert.equal(f.service.status().lastSyncAt, null);
});

test('refresh preserves omitted refresh/scope, coalesces parallel reads and encrypts the new access token', async t => {
  const f = fixture(t); await f.connect(); f.advance(3600001);
  f.state.token.access_token = 'NEW_ACCESS_SECRET'; delete f.state.token.refresh_token; delete f.state.token.scope;
  const [a, b] = await Promise.all([f.service.readCosts(), f.service.readCosts()]);
  assert.deepEqual(a, b);
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[1].opts.body.get('grant_type'), 'refresh_token');
  assert.equal(f.calls[1].opts.body.get('refresh_token'), 'REFRESH_SECRET_FIXTURE');
  assert.equal(f.calls[2].opts.headers.Authorization, 'Bearer NEW_ACCESS_SECRET');
  assert.equal(decrypt(f.db.prepare('SELECT refresh_encrypted FROM commerce_sheets_account').get().refresh_encrypted), 'REFRESH_SECRET_FIXTURE');
});

test('lost refresh response requires review without repeated token exchanges', async t => {
  let broken = false;
  const f = fixture(t, {fetchImpl: async (_url, _opts, state) => {if (broken) throw new Error('PRIVATE_SECRET'); return response(state.token);}});
  await f.connect(); f.advance(3600001); broken = true;
  await assert.rejects(f.service.readCosts(), /refresh_pending_review/);
  const count = f.calls.length;
  await assert.rejects(f.service.readCosts(), /reconnect_required/);
  assert.equal(f.calls.length, count);
  assert.equal(f.service.status().status, 'needs_review');
});

test('explicit temporary refresh errors back off and stop after three failures', async t => {
  let temporary = false;
  const f = fixture(t, {fetchImpl: async (_url, _opts, state) => temporary ? response({error: 'temporarily_unavailable'}, 503) : response(state.token)});
  await f.connect(); f.advance(3600001); temporary = true;
  await assert.rejects(f.service.readCosts(), /refresh_retry_later/);
  const count = f.calls.length;
  await assert.rejects(f.service.readCosts(), /refresh_retry_later/);
  assert.equal(f.calls.length, count);
  f.advance(60000); await assert.rejects(f.service.readCosts(), /refresh_retry_later/);
  f.advance(300000); await assert.rejects(f.service.readCosts(), /refresh_pending_review/);
  assert.equal(f.service.status().connected, false);
});

test('disconnect during authorization, refresh or sheet read cannot restore tokens or return stale data', async t => {
  for (const phase of ['authorization', 'refresh', 'sheet']) {
    let held = false, release, entered;
    const gate = new Promise(resolve => {release = resolve;}), waiting = new Promise(resolve => {entered = resolve;});
    const f = fixture(t, {fetchImpl: async (url, _opts, state) => {
      if (held) {entered(); await gate;}
      return response(url.startsWith('https://sheets.googleapis.com/') ? state.sheet : state.token);
    }});
    if (phase !== 'authorization') await f.connect();
    if (phase === 'refresh') f.advance(3600001);
    held = true;
    const pending = phase === 'authorization' ? f.connect() : f.service.readCosts();
    await waiting;
    f.service.disconnect(); release();
    await assert.rejects(pending);
    assert.equal(f.service.status().connected, false);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM commerce_sheets_account').get().n, 0);
  }
});

test('disabling the flag with an existing connection prevents any subsequent Google read', async t => {
  const f = fixture(t); await f.connect();
  process.env.COMMERCE_GOOGLE_OAUTH_ENABLED = 'false';
  assert.equal(f.service.status().connected, false);
  await assert.rejects(f.service.readCosts(), /commerce_sheets_disabled/);
  assert.equal(f.calls.length, 1);
  f.service.disconnect();
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM commerce_sheets_account').get().n, 0);
});
