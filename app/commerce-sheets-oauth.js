import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {isIP} from 'node:net';

// Official contracts: developers.google.com/identity/protocols/oauth2/web-server
// and developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/batchGet.
export const COMMERCE_SHEETS_ID = '1er693LuabDfElCPE0di9GW29YM9d6l0UIjb-IQMN7oM';
export const COMMERCE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
export const COMMERCE_SHEETS_RANGES = Object.freeze([
  'Precificacao!A3:N30', 'Configuracoes!A3:B16', 'Dashboard!A1:B18'
]);
const LIMITS = [[28, 14], [14, 2], [18, 2]];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const BATCH_URL = `https://sheets.googleapis.com/v4/spreadsheets/${COMMERCE_SHEETS_ID}/values:batchGet`;
const SPREADSHEET_URL = `https://docs.google.com/spreadsheets/d/${COMMERCE_SHEETS_ID}/edit`;
const SAFE_ERROR = Symbol('commerce_sheets_safe_error');
const fail = code => Object.assign(new Error(code), {code, [SAFE_ERROR]: true});
const safe = error => error?.[SAFE_ERROR] ? error : fail('commerce_sheets_unavailable');
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const tokenValid = value => typeof value === 'string' && value.length > 0 && value.length <= 8192 && !/[\u0000-\u0020\u007f]/.test(value);
const exactScope = value => typeof value === 'string' && value.trim() === COMMERCE_SHEETS_SCOPE;

function secureOrigin(value) {
  try {
    const url = new URL(value), host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash ||
        !host.includes('.') || isIP(host) || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return null;
    return url.origin;
  } catch { return null; }
}

function costsValues(payload) {
  if (!payload || payload.spreadsheetId !== COMMERCE_SHEETS_ID || !Array.isArray(payload.valueRanges) || payload.valueRanges.length !== 3)
    throw fail('commerce_sheets_values_invalid');
  return payload.valueRanges.map((valueRange, index) => {
    const expected = COMMERCE_SHEETS_RANGES[index], [sheet, cells] = expected.split('!');
    if (!valueRange || ![expected, `'${sheet}'!${cells}`].includes(valueRange.range) ||
        (valueRange.majorDimension !== undefined && valueRange.majorDimension !== 'ROWS')) throw fail('commerce_sheets_values_invalid');
    const values = valueRange.values === undefined ? [] : valueRange.values, [rowLimit, columnLimit] = LIMITS[index];
    if (!Array.isArray(values) || values.length > rowLimit) throw fail('commerce_sheets_values_invalid');
    const rows = values.map(row => {
      if (!Array.isArray(row) || row.length > columnLimit) throw fail('commerce_sheets_values_invalid');
      return row.map(cell => {
        if (typeof cell === 'boolean' || (typeof cell === 'number' && Number.isFinite(cell))) return cell;
        if (typeof cell === 'string' && cell.length <= 500 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(cell)) return cell;
        throw fail('commerce_sheets_values_invalid');
      });
    });
    return {range: expected, rows};
  });
}

// This service owns only commerce_sheets_* tables. getConfig supplies the app's
// client credentials, never another integration's access or refresh token.
// Construction and status do not decrypt tokens or make network calls.
export function createCommerceSheetsOAuth({db, encrypt, decrypt, siteUrl, getConfig = () => ({}), commitRead, now = Date.now, fetchImpl = fetch}) {
  const origin = secureOrigin(siteUrl), redirectUri = origin ? origin + '/api/admin/commerce/sheets/callback' : null;
  let refreshing = null, reading = null;
  db.exec(`CREATE TABLE IF NOT EXISTS commerce_sheets_control (
    id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO commerce_sheets_control(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS commerce_sheets_oauth_states (
      state_hash TEXT PRIMARY KEY, admin_id INTEGER NOT NULL, session_hash TEXT NOT NULL,
      verifier_encrypted TEXT NOT NULL, config_hash TEXT NOT NULL, revision INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS commerce_sheets_account (
      id INTEGER PRIMARY KEY CHECK(id=1), access_encrypted TEXT NOT NULL, refresh_encrypted TEXT NOT NULL,
      expires_at INTEGER NOT NULL, scope TEXT NOT NULL, config_hash TEXT NOT NULL, revision INTEGER NOT NULL,
      status TEXT NOT NULL, refresh_owner TEXT NOT NULL DEFAULT '', refresh_until INTEGER NOT NULL DEFAULT 0,
      refresh_failures INTEGER NOT NULL DEFAULT 0, refresh_next_at INTEGER NOT NULL DEFAULT 0, last_sync_at TEXT);`);
  const enabled = () => process.env.COMMERCE_GOOGLE_OAUTH_ENABLED === 'true' && Boolean(origin);
  const revision = () => db.prepare('SELECT revision FROM commerce_sheets_control WHERE id=1').get().revision;
  const account = () => db.prepare('SELECT * FROM commerce_sheets_account WHERE id=1').get();
  function config() {
    let value;
    try { value = getConfig() || {}; } catch { return {configured: false}; }
    const {clientId, clientSecret} = value;
    if (typeof clientId !== 'string' || !/^[-A-Za-z0-9.]{10,250}\.apps\.googleusercontent\.com$/.test(clientId) || !tokenValid(clientSecret))
      return {configured: false};
    return {configured: true, clientId, clientSecret, fingerprint: hash(JSON.stringify([clientId, clientSecret, redirectUri, COMMERCE_SHEETS_SCOPE]))};
  }
  function ready() {
    if (!enabled()) throw fail('commerce_sheets_disabled');
    const current = config();
    if (!current.configured) throw fail('commerce_sheets_app_missing');
    return current;
  }
  function protect(value) {
    try {
      const encrypted = encrypt(value);
      if (!tokenValid(encrypted) || encrypted === value) throw new Error();
      return encrypted;
    } catch { throw fail('commerce_sheets_encryption_unavailable'); }
  }
  function reveal(value) {
    try {
      const plain = decrypt(value);
      if (!tokenValid(plain)) throw new Error();
      return plain;
    } catch { throw fail('commerce_sheets_encryption_unavailable'); }
  }
  function status() {
    const base = {enabled: enabled(), configured: false, connected: false, status: 'disabled', redirectUri,
      spreadsheetId: COMMERCE_SHEETS_ID, spreadsheetUrl: SPREADSHEET_URL, ranges: [...COMMERCE_SHEETS_RANGES],
      scopes: [COMMERCE_SHEETS_SCOPE], readOnly: true, lastSyncAt: null, refreshRetryAt: null};
    if (!base.enabled) return {...base, detail: origin ? 'A conexão Google para custos está desativada. Habilite a configuração e cadastre o endereço de retorno antes de autorizar.' : 'Configure um endereço público HTTPS para autorizar a planilha.'};
    const current = config(), stored = account();
    const connected = Boolean(current.configured && stored?.status === 'connected' && stored.config_hash === current.fingerprint &&
      stored.revision === revision() && exactScope(stored.scope) && stored.refresh_encrypted);
    const state = !current.configured ? 'unconfigured' : connected ? 'connected' : stored?.config_hash !== current.fingerprint ? 'not_connected' : stored?.status || 'not_connected';
    return {...base, configured: current.configured, connected, status: state, lastSyncAt: connected ? stored.last_sync_at : null,
      refreshRetryAt: connected && stored.refresh_next_at > now() ? stored.refresh_next_at : null,
      detail: connected ? (stored.last_sync_at ? 'Conta autorizada e leitura da planilha verificada. Os valores da planilha não comprovam lucro realizado.' : 'Conta autorizada para leitura. O acesso à planilha ainda precisa ser verificado.') :
        current.configured ? 'Autorize esta conexão Google para consultar apenas as três faixas de custos definidas.' : 'O aplicativo Google ainda precisa ser configurado para esta conexão.'};
  }
  function begin({adminId, sessionKey} = {}) {
    const current = ready();
    if (!Number.isSafeInteger(adminId) || adminId <= 0 || !tokenValid(sessionKey)) throw fail('commerce_sheets_admin_session_invalid');
    const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url'), encryptedVerifier = protect(verifier);
    db.transaction(() => {
      db.prepare('UPDATE commerce_sheets_control SET revision=revision+1 WHERE id=1').run();
      db.prepare('DELETE FROM commerce_sheets_oauth_states').run();
      db.prepare("UPDATE commerce_sheets_account SET status='reconnecting' WHERE id=1").run();
      db.prepare('INSERT INTO commerce_sheets_oauth_states VALUES(?,?,?,?,?,?,?)')
        .run(hash(state), adminId, hash(sessionKey), encryptedVerifier, current.fingerprint, revision(), now() + 600000);
    }).immediate();
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({client_id: current.clientId, redirect_uri: redirectUri, response_type: 'code',
      scope: COMMERCE_SHEETS_SCOPE, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256'}).toString();
    return {authorizationUrl: url.href};
  }
  async function request(url, options, maxBytes = 32768) {
    let response, payload;
    try {
      response = await fetchImpl(url, {...options, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(15000)});
      if (Number(response.headers?.get('content-length')) > maxBytes) throw fail('commerce_sheets_response_invalid');
      let text = '';
      if (response.body?.getReader) {
        const reader = response.body.getReader(), chunks = [];
        let bytes = 0;
        try {
          for (;;) {
            const {done, value} = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > maxBytes) { await reader.cancel(); throw fail('commerce_sheets_response_invalid'); }
            chunks.push(Buffer.from(value));
          }
          text = Buffer.concat(chunks).toString('utf8');
        } finally { reader.releaseLock(); }
      } else {
        text = await response.text();
        if (Buffer.byteLength(text, 'utf8') > maxBytes) throw fail('commerce_sheets_response_invalid');
      }
      payload = JSON.parse(text);
    } catch (error) { throw error?.[SAFE_ERROR] ? error : fail('commerce_sheets_request_failed'); }
    if (url === TOKEN_URL && payload?.error === 'invalid_grant') throw fail('commerce_sheets_reconnect_required');
    if (url === TOKEN_URL && (response.status === 429 || response.status >= 500) && typeof payload?.error === 'string' &&
        payload.error && !payload.access_token && !payload.refresh_token) {
      throw fail('commerce_sheets_oauth_temporary');
    }
    if (!response.ok || !payload || typeof payload !== 'object' || Array.isArray(payload) || payload.error)
      throw fail(url === TOKEN_URL ? 'commerce_sheets_oauth_rejected' : 'commerce_sheets_read_rejected');
    return payload;
  }
  function tokenData(payload, previousScope = '') {
    const scope = payload.scope === undefined ? previousScope : payload.scope;
    if (!tokenValid(payload.access_token) || String(payload.token_type).toLowerCase() !== 'bearer' || !exactScope(scope) ||
        !Number.isSafeInteger(payload.expires_in) || payload.expires_in < 60 || payload.expires_in > 86400)
      throw fail('commerce_sheets_scopes_or_token_invalid');
    return {scope: COMMERCE_SHEETS_SCOPE, expiresAt: now() + payload.expires_in * 1000};
  }
  function unchanged(expectedRevision, fingerprint) {
    const current = ready();
    if (revision() !== expectedRevision || current.fingerprint !== fingerprint) throw fail('commerce_sheets_connection_changed');
  }
  async function complete({state, code, adminId, sessionKey} = {}) {
    const current = ready();
    if (!tokenValid(state) || !tokenValid(code) || !tokenValid(sessionKey) || !Number.isSafeInteger(adminId) || adminId <= 0)
      throw fail('commerce_sheets_state_invalid');
    const attempt = db.transaction(() => {
      const row = db.prepare('SELECT * FROM commerce_sheets_oauth_states WHERE state_hash=? AND admin_id=? AND session_hash=? AND expires_at>?')
        .get(hash(state), adminId, hash(sessionKey), now());
      if (!row || row.config_hash !== current.fingerprint || row.revision !== revision()) throw fail('commerce_sheets_state_invalid');
      db.prepare('DELETE FROM commerce_sheets_oauth_states WHERE state_hash=?').run(hash(state));
      return row;
    }).immediate();
    const payload = await request(TOKEN_URL, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({client_id: current.clientId, client_secret: current.clientSecret, code, code_verifier: reveal(attempt.verifier_encrypted),
        redirect_uri: redirectUri, grant_type: 'authorization_code'})});
    const token = tokenData(payload);
    if (!tokenValid(payload.refresh_token)) throw fail('commerce_sheets_offline_access_missing');
    const access = protect(payload.access_token), refresh = protect(payload.refresh_token);
    db.transaction(() => {
      unchanged(attempt.revision, attempt.config_hash);
      db.prepare(`INSERT INTO commerce_sheets_account(id,access_encrypted,refresh_encrypted,expires_at,scope,config_hash,revision,status)
        VALUES(1,?,?,?,?,?,?,'connected') ON CONFLICT(id) DO UPDATE SET access_encrypted=excluded.access_encrypted,
        refresh_encrypted=excluded.refresh_encrypted,expires_at=excluded.expires_at,scope=excluded.scope,config_hash=excluded.config_hash,
        revision=excluded.revision,status='connected',refresh_owner='',refresh_until=0,refresh_failures=0,refresh_next_at=0,last_sync_at=NULL`)
        .run(access, refresh, token.expiresAt, token.scope, attempt.config_hash, attempt.revision);
    }).immediate();
    return status();
  }
  async function renew() {
    const current = ready(), stored = account();
    if (!status().connected) throw fail('commerce_sheets_reconnect_required');
    if (stored.expires_at > now() + 120000) return reveal(stored.access_encrypted);
    if (stored.refresh_next_at > now()) throw fail('commerce_sheets_refresh_retry_later');
    if (stored.refresh_owner) {
      if (stored.refresh_until <= now()) db.prepare("UPDATE commerce_sheets_account SET status='needs_review' WHERE revision=? AND refresh_owner=?").run(stored.revision, stored.refresh_owner);
      throw fail('commerce_sheets_refresh_pending_review');
    }
    const owner = randomUUID();
    if (!db.prepare("UPDATE commerce_sheets_account SET refresh_owner=?,refresh_until=? WHERE id=1 AND revision=? AND status='connected' AND refresh_owner=''")
      .run(owner, now() + 45000, stored.revision).changes) throw fail('commerce_sheets_refresh_busy');
    try {
      const payload = await request(TOKEN_URL, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({client_id: current.clientId, client_secret: current.clientSecret, refresh_token: reveal(stored.refresh_encrypted), grant_type: 'refresh_token'})});
      const token = tokenData(payload, stored.scope);
      if (payload.refresh_token !== undefined && !tokenValid(payload.refresh_token)) throw fail('commerce_sheets_scopes_or_token_invalid');
      unchanged(stored.revision, stored.config_hash);
      const saved = db.prepare(`UPDATE commerce_sheets_account SET access_encrypted=?,refresh_encrypted=?,expires_at=?,scope=?,
        refresh_owner='',refresh_until=0,refresh_failures=0,refresh_next_at=0 WHERE id=1 AND revision=? AND config_hash=?
        AND status='connected' AND refresh_owner=? AND refresh_until>?`)
        .run(protect(payload.access_token), payload.refresh_token ? protect(payload.refresh_token) : stored.refresh_encrypted,
          token.expiresAt, token.scope, stored.revision, stored.config_hash, owner, now());
      if (!saved.changes) throw fail('commerce_sheets_connection_changed');
      return payload.access_token;
    } catch (error) {
      if (error?.code === 'commerce_sheets_oauth_temporary' && stored.refresh_failures < 2) {
        db.prepare("UPDATE commerce_sheets_account SET refresh_owner='',refresh_until=0,refresh_failures=refresh_failures+1,refresh_next_at=? WHERE revision=? AND refresh_owner=? AND status='connected'")
          .run(now() + (stored.refresh_failures === 0 ? 60000 : 300000), stored.revision, owner);
        throw fail('commerce_sheets_refresh_retry_later');
      }
      db.prepare("UPDATE commerce_sheets_account SET status='needs_review' WHERE revision=? AND refresh_owner=? AND status='connected'").run(stored.revision, owner);
      throw fail('commerce_sheets_refresh_pending_review');
    }
  }
  function accessToken() {
    if (!refreshing) refreshing = renew().finally(() => { refreshing = null; });
    return refreshing;
  }
  async function read() {
    ready();
    const stored = account();
    if (!stored || !status().connected) throw fail('commerce_sheets_reconnect_required');
    const token = await accessToken();
    unchanged(stored.revision, stored.config_hash);
    if (!status().connected) throw fail('commerce_sheets_reconnect_required');
    const url = new URL(BATCH_URL);
    for (const range of COMMERCE_SHEETS_RANGES) url.searchParams.append('ranges', range);
    url.searchParams.set('majorDimension', 'ROWS');
    url.searchParams.set('valueRenderOption', 'UNFORMATTED_VALUE');
    const payload = await request(url.href, {method: 'GET', headers: {Authorization: 'Bearer ' + token, Accept: 'application/json'}}, 262144);
    const values = costsValues(payload), measuredAt = new Date(now()).toISOString();
    unchanged(stored.revision, stored.config_hash);
    const result = {source: 'google_sheets_api', spreadsheetId: COMMERCE_SHEETS_ID, spreadsheetUrl: SPREADSHEET_URL, readOnly: true, measuredAt, values};
    // Business mapping and snapshot persistence share the same database transaction
    // as the success stamp. A valid HTTP response alone is not a completed sync.
    db.transaction(() => {
      if (typeof commitRead !== 'function') throw fail('commerce_sheets_consumer_missing');
      unchanged(stored.revision, stored.config_hash);
      const committed = commitRead(result);
      if (committed && typeof committed.then === 'function') throw fail('commerce_sheets_consumer_invalid');
      const saved = db.prepare("UPDATE commerce_sheets_account SET last_sync_at=? WHERE id=1 AND revision=? AND config_hash=? AND status='connected'")
        .run(measuredAt, stored.revision, stored.config_hash);
      if (!saved.changes) throw fail('commerce_sheets_connection_changed');
    }).immediate();
    return result;
  }
  function disconnect() {
    db.transaction(() => {
      db.prepare('UPDATE commerce_sheets_control SET revision=revision+1 WHERE id=1').run();
      db.prepare('DELETE FROM commerce_sheets_oauth_states').run();
      db.prepare('DELETE FROM commerce_sheets_account').run();
    }).immediate();
    return {...status(), detail: 'Conexão da planilha removida desta central. A revogação na Conta Google é separada.'};
  }
  const sync = fn => (...args) => { try { return fn(...args); } catch (error) { throw safe(error); } };
  return {
    status: sync(status), begin: sync(begin), disconnect: sync(disconnect),
    async complete(input) { try { return await complete(input); } catch (error) { throw safe(error); } },
    async readCosts() {
      if (!reading) reading = read().finally(() => { reading = null; });
      try { return await reading; } catch (error) { throw safe(error); }
    }
  };
}
