import {createHash, createHmac, randomBytes, randomUUID} from 'node:crypto';
import {isIP} from 'node:net';

// Official contracts verified 2026-09-15:
// https://open.shopee.com/developer-guide/20
// https://open.shopee.com/documents/v2/v2.public.get_access_token?module=104&type=1
// https://open.shopee.com/documents/v2/v2.public.refresh_access_token?module=104&type=1
// https://open.shopee.com/documents/v2/v2.shop.get_shop_info?module=92&type=1
// This adapter permits identity reads only. App permissions are assigned by
// Shopee; there is no documented per-scope selector in this authorization flow.
const AUTH_URL = 'https://open.shopee.com.br/auth';
const API_ORIGIN = 'https://partner.shopeemobile.com';
const TOKEN_PATH = '/api/v2/auth/token/get';
const REFRESH_PATH = '/api/v2/auth/access_token/get';
const SHOP_PATH = '/api/v2/shop/get_shop_info';
const SAFE_ERROR = Symbol('commerce_shopee_safe_error');
const fail = code => Object.assign(new Error(code), {code, [SAFE_ERROR]: true});
const safe = error => error?.[SAFE_ERROR] ? error : fail('commerce_shopee_unavailable');
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const tokenValid = value => typeof value === 'string' && value.length > 0 && value.length <= 8192 && !/[\u0000-\u0020\u007f]/.test(value);
const idValue = value => {
  if (typeof value === 'string' && !/^[1-9][0-9]{0,15}$/.test(value)) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};
const textValid = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value);

function secureOrigin(value) {
  try {
    const url = new URL(value), host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash ||
        !host.includes('.') || isIP(host) || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return null;
    return url.origin;
  } catch { return null; }
}

export function createCommerceShopeeOAuth({db, encrypt, decrypt, siteUrl, getConfig = () => ({}), now = Date.now, fetchImpl = fetch}) {
  const origin = secureOrigin(siteUrl), redirectUri = origin ? origin + '/api/admin/commerce/shopee/callback' : null;
  const verifying = new Map();
  // Construction does not read configuration, decrypt credentials or contact Shopee.
  db.exec(`CREATE TABLE IF NOT EXISTS commerce_shopee_control (
    id INTEGER PRIMARY KEY CHECK(id=1), epoch INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO commerce_shopee_control(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS commerce_shopee_oauth_states (
      state_hash TEXT PRIMARY KEY, admin_id INTEGER NOT NULL, session_hash TEXT NOT NULL,
      config_hash TEXT NOT NULL, epoch INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS commerce_shopee_connect_locks (
      shop_id INTEGER PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS commerce_shopee_shops (
      shop_id INTEGER PRIMARY KEY, shop_name TEXT NOT NULL, region TEXT NOT NULL,
      authorized_at INTEGER NOT NULL, authorization_expires_at INTEGER NOT NULL,
      access_encrypted TEXT NOT NULL, refresh_encrypted TEXT NOT NULL,
      access_expires_at INTEGER NOT NULL, refresh_expires_at INTEGER NOT NULL,
      config_hash TEXT NOT NULL, revision TEXT NOT NULL, epoch INTEGER NOT NULL, status TEXT NOT NULL,
      refresh_owner TEXT NOT NULL DEFAULT '', refresh_until INTEGER NOT NULL DEFAULT 0, last_verified_at TEXT);`);
  const epoch = () => db.prepare('SELECT epoch FROM commerce_shopee_control WHERE id=1').get().epoch;
  const account = shopId => db.prepare('SELECT * FROM commerce_shopee_shops WHERE shop_id=?').get(shopId);
  function config() {
    if (!origin) return {enabled: false, configured: false};
    let value;
    try { value = getConfig() || {}; } catch { return {enabled: false, configured: false}; }
    if (value.enabled !== true) return {enabled: false, configured: false};
    const partnerId = idValue(value.partnerId), partnerKey = value.partnerKey;
    if (!partnerId || partnerId > 4294967295 || !tokenValid(partnerKey) || partnerKey.length < 16)
      return {enabled: true, configured: false};
    return {enabled: true, configured: true, partnerId, partnerKey, fingerprint: hash(JSON.stringify([partnerId, partnerKey, redirectUri]))};
  }
  function ready() {
    const current = config();
    if (!current.enabled) throw fail('commerce_shopee_disabled');
    if (!current.configured) throw fail('commerce_shopee_app_missing');
    return current;
  }
  function protect(value) {
    try {
      const encrypted = encrypt(value);
      if (!tokenValid(encrypted) || encrypted === value) throw new Error();
      return encrypted;
    } catch { throw fail('commerce_shopee_encryption_unavailable'); }
  }
  function reveal(value) {
    try {
      const plain = decrypt(value);
      if (!tokenValid(plain)) throw new Error();
      return plain;
    } catch { throw fail('commerce_shopee_encryption_unavailable'); }
  }
  function live(stored, current) {
    return Boolean(stored && current.configured && stored.config_hash === current.fingerprint && stored.epoch === epoch() &&
      stored.status === 'connected' && stored.region === 'BR' && stored.authorization_expires_at > now() && stored.refresh_expires_at > now() &&
      (!stored.refresh_owner || stored.refresh_until > now()));
  }
  function status() {
    const current = config(), base = {enabled: current.enabled, configured: current.configured, connected: false, status: 'disabled',
      detail: 'A conexão direta Shopee está desativada. Configure um aplicativo aprovado antes de autorizar suas lojas.',
      redirectUri, shops: [], lastVerifiedAt: null, readOnly: true, dataSyncAvailable: false};
    if (!current.enabled) return base;
    if (!current.configured) return {...base, status: 'unconfigured', detail: 'Configure o Partner ID e a chave do aplicativo aprovado na Shopee.'};
    const rows = db.prepare('SELECT * FROM commerce_shopee_shops WHERE config_hash=? AND epoch=? ORDER BY shop_id').all(current.fingerprint, epoch());
    const shops = rows.map(row => ({shopId: row.shop_id, shopName: row.shop_name, region: row.region,
      authorizedAt: new Date(row.authorized_at).toISOString(), expiresAt: new Date(row.authorization_expires_at).toISOString(),
      connected: live(row, current), status: live(row, current) ? 'connected' : row.status === 'connected' ? 'needs_review' : row.status,
      lastVerifiedAt: row.last_verified_at}));
    const connected = shops.some(shop => shop.connected), stamps = shops.map(shop => shop.lastVerifiedAt).filter(Boolean).sort();
    return {...base, connected, shops, status: connected ? 'connected' : shops.length ? 'needs_review' : 'not_connected',
      lastVerifiedAt: stamps.at(-1) || null,
      detail: connected ? 'Identidade de loja brasileira verificada. Pedidos, catálogo, financeiro, atendimento e anúncios ainda não são sincronizados.' :
        shops.length ? 'A conexão precisa de nova autorização ou revisão. Nenhum dado comercial está sendo sincronizado.' : 'Autorize cada loja no login oficial da Shopee para verificar sua identidade.'};
  }
  function begin({adminId, sessionKey} = {}) {
    const current = ready();
    if (!Number.isSafeInteger(adminId) || adminId <= 0 || !tokenValid(sessionKey)) throw fail('commerce_shopee_admin_session_invalid');
    const probe = randomBytes(32).toString('base64url');
    if (reveal(protect(probe)) !== probe) throw fail('commerce_shopee_encryption_unavailable');
    const state = randomBytes(32).toString('base64url');
    db.transaction(() => {
      db.prepare('DELETE FROM commerce_shopee_oauth_states WHERE expires_at<=? OR (admin_id=? AND session_hash=?)').run(now(), adminId, hash(sessionKey));
      if (db.prepare('SELECT COUNT(*) n FROM commerce_shopee_oauth_states').get().n >= 100) throw fail('commerce_shopee_authorization_busy');
      db.prepare('INSERT INTO commerce_shopee_oauth_states VALUES(?,?,?,?,?,?)').run(hash(state), adminId, hash(sessionKey), current.fingerprint, epoch(), now() + 600000);
    }).immediate();
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({partner_id: String(current.partnerId), auth_type: 'seller', redirect_uri: redirectUri, response_type: 'code', state}).toString();
    return {authorizationUrl: url.href};
  }
  function unchanged(expectedEpoch, fingerprint) {
    const current = ready();
    if (epoch() !== expectedEpoch || current.fingerprint !== fingerprint) throw fail('commerce_shopee_connection_changed');
  }
  function signedUrl(path, current, accessToken, shopId) {
    const timestamp = Math.floor(now() / 1000), suffix = path === SHOP_PATH ? accessToken + String(shopId) : '';
    const sign = createHmac('sha256', current.partnerKey).update(String(current.partnerId) + path + timestamp + suffix).digest('hex');
    const url = new URL(API_ORIGIN + path);
    url.search = new URLSearchParams({partner_id: String(current.partnerId), timestamp: String(timestamp), sign}).toString();
    if (path === SHOP_PATH) { url.searchParams.set('access_token', accessToken); url.searchParams.set('shop_id', String(shopId)); }
    return url.href;
  }
  async function request(path, current, {body, accessToken, shopId} = {}) {
    if (![TOKEN_PATH, REFRESH_PATH, SHOP_PATH].includes(path)) throw fail('commerce_shopee_request_invalid');
    let response, payload;
    try {
      response = await fetchImpl(signedUrl(path, current, accessToken, shopId), {
        method: path === SHOP_PATH ? 'GET' : 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'},
        ...(body ? {body: JSON.stringify(body)} : {}), redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(15000)
      });
      if (Number(response.headers?.get('content-length')) > 32768) throw fail('commerce_shopee_response_invalid');
      let text = '';
      if (response.body?.getReader) {
        const reader = response.body.getReader(), chunks = [];
        let bytes = 0;
        try {
          for (;;) {
            const {done, value} = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > 32768) { await reader.cancel(); throw fail('commerce_shopee_response_invalid'); }
            chunks.push(Buffer.from(value));
          }
          text = Buffer.concat(chunks).toString('utf8');
        } finally { reader.releaseLock(); }
      } else {
        text = await response.text();
        if (Buffer.byteLength(text, 'utf8') > 32768) throw fail('commerce_shopee_response_invalid');
      }
      payload = JSON.parse(text);
    } catch (error) { throw error?.[SAFE_ERROR] ? error : fail('commerce_shopee_request_failed'); }
    if (!response.ok || !payload || typeof payload !== 'object' || Array.isArray(payload) || payload.error !== '')
      throw fail(path === SHOP_PATH ? 'commerce_shopee_identity_rejected' : 'commerce_shopee_oauth_rejected');
    return payload;
  }
  function tokenData(payload, shopId, current, refresh = false) {
    if (!tokenValid(payload.access_token) || !tokenValid(payload.refresh_token) ||
      !Number.isSafeInteger(payload.expire_in) || payload.expire_in < 60 || payload.expire_in > 14400 ||
      (payload.partner_id !== undefined && idValue(payload.partner_id) !== current.partnerId)) throw fail('commerce_shopee_token_invalid');
    // Guide 20 returns shop_id_list for main_account_id exchanges; the documented
    // single-shop exchange may omit it. The requested shop_id is sent with the
    // one-use code, then verified with a signed get_shop_info before persistence.
    // Never accept a contradictory identity when either optional field is present.
    if ((refresh || payload.shop_id !== undefined) && idValue(payload.shop_id) !== shopId)
      throw fail('commerce_shopee_shop_binding_invalid');
    if (payload.shop_id_list !== undefined && (!Array.isArray(payload.shop_id_list) || payload.shop_id_list.length > 100 ||
      !payload.shop_id_list.every(id => idValue(id) !== null) || !payload.shop_id_list.some(id => idValue(id) === shopId)))
      throw fail('commerce_shopee_shop_binding_invalid');
    return {accessExpiresAt: now() + payload.expire_in * 1000, refreshExpiresAt: now() + 30 * 86400000};
  }
  function shopData(payload, shopId) {
    if (payload.region !== 'BR' || payload.status !== 'NORMAL' || !textValid(payload.shop_name) ||
      (payload.shop_id !== undefined && idValue(payload.shop_id) !== shopId) ||
      !Number.isSafeInteger(payload.auth_time) || !Number.isSafeInteger(payload.expire_time) || payload.auth_time <= 0 ||
      payload.auth_time * 1000 > now() + 300000 || payload.expire_time <= payload.auth_time ||
      payload.expire_time * 1000 <= now() || payload.expire_time * 1000 > now() + 366 * 86400000)
      throw fail('commerce_shopee_shop_identity_invalid');
    return {shopName: payload.shop_name.trim(), authorizedAt: payload.auth_time * 1000, expiresAt: payload.expire_time * 1000};
  }
  async function complete({state, code, shopId: inputId, adminId, sessionKey} = {}) {
    const current = ready(), shopId = idValue(inputId), owner = randomUUID();
    if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state) || !tokenValid(code) || code.length > 2048 || !shopId ||
      !tokenValid(sessionKey) || !Number.isSafeInteger(adminId) || adminId <= 0) throw fail('commerce_shopee_state_invalid');
    const attempt = db.transaction(() => {
      const row = db.prepare('SELECT * FROM commerce_shopee_oauth_states WHERE state_hash=? AND admin_id=? AND session_hash=? AND expires_at>?')
        .get(hash(state), adminId, hash(sessionKey), now());
      if (!row || row.config_hash !== current.fingerprint || row.epoch !== epoch()) throw fail('commerce_shopee_state_invalid');
      const lock = db.prepare('SELECT * FROM commerce_shopee_connect_locks WHERE shop_id=?').get(shopId);
      if (lock && lock.expires_at > now()) throw fail('commerce_shopee_authorization_busy');
      // Reserve capacity before the non-idempotent token exchange. Concurrent
      // callbacks for new stores count as occupied slots until their lock expires.
      const occupied = db.prepare(`SELECT COUNT(*) n FROM (
        SELECT shop_id FROM commerce_shopee_shops UNION
        SELECT shop_id FROM commerce_shopee_connect_locks WHERE expires_at>?)`).get(now()).n;
      if (!account(shopId) && occupied >= 20) throw fail('commerce_shopee_shop_limit');
      db.prepare('DELETE FROM commerce_shopee_oauth_states WHERE state_hash=?').run(hash(state));
      db.prepare('INSERT INTO commerce_shopee_connect_locks VALUES(?,?,?) ON CONFLICT(shop_id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at')
        .run(shopId, owner, now() + 60000);
      db.prepare("UPDATE commerce_shopee_shops SET status='reconnecting',revision=?,refresh_owner='',refresh_until=0 WHERE shop_id=?").run(owner, shopId);
      return row;
    }).immediate();
    try {
      // Consume state before the non-idempotent exchange; never retry this code.
      const payload = await request(TOKEN_PATH, current, {body: {partner_id: current.partnerId, code, shop_id: shopId}});
      const token = tokenData(payload, shopId, current), access = protect(payload.access_token), refresh = protect(payload.refresh_token);
      unchanged(attempt.epoch, attempt.config_hash);
      const identity = shopData(await request(SHOP_PATH, current, {accessToken: payload.access_token, shopId}), shopId);
      db.transaction(() => {
        unchanged(attempt.epoch, attempt.config_hash);
        const lock = db.prepare('SELECT * FROM commerce_shopee_connect_locks WHERE shop_id=? AND owner=? AND expires_at>?').get(shopId, owner, now());
        if (!lock) throw fail('commerce_shopee_connection_changed');
        db.prepare(`INSERT INTO commerce_shopee_shops(shop_id,shop_name,region,authorized_at,authorization_expires_at,access_encrypted,
          refresh_encrypted,access_expires_at,refresh_expires_at,config_hash,revision,epoch,status,last_verified_at)
          VALUES(?,?,'BR',?,?,?,?,?,?,?,?,?,'connected',?) ON CONFLICT(shop_id) DO UPDATE SET shop_name=excluded.shop_name,
          region=excluded.region,authorized_at=excluded.authorized_at,authorization_expires_at=excluded.authorization_expires_at,
          access_encrypted=excluded.access_encrypted,refresh_encrypted=excluded.refresh_encrypted,access_expires_at=excluded.access_expires_at,
          refresh_expires_at=excluded.refresh_expires_at,config_hash=excluded.config_hash,revision=excluded.revision,epoch=excluded.epoch,
          status='connected',refresh_owner='',refresh_until=0,last_verified_at=excluded.last_verified_at`)
          .run(shopId, identity.shopName, identity.authorizedAt, identity.expiresAt, access, refresh, token.accessExpiresAt,
            token.refreshExpiresAt, current.fingerprint, owner, attempt.epoch, new Date(now()).toISOString());
      }).immediate();
      return status();
    } catch (error) {
      db.prepare("UPDATE commerce_shopee_shops SET status='needs_review' WHERE shop_id=? AND revision=?").run(shopId, owner);
      throw error;
    } finally { db.prepare('DELETE FROM commerce_shopee_connect_locks WHERE shop_id=? AND owner=?').run(shopId, owner); }
  }
  async function accessToken(stored, current) {
    if (stored.access_expires_at > now() + 120000) return reveal(stored.access_encrypted);
    if (stored.refresh_owner) throw fail('commerce_shopee_refresh_pending_review');
    const owner = randomUUID();
    if (!db.prepare("UPDATE commerce_shopee_shops SET refresh_owner=?,refresh_until=? WHERE shop_id=? AND revision=? AND status='connected' AND refresh_owner=''")
      .run(owner, now() + 45000, stored.shop_id, stored.revision).changes) throw fail('commerce_shopee_refresh_busy');
    try {
      const previousRefresh = reveal(stored.refresh_encrypted);
      const payload = await request(REFRESH_PATH, current, {body: {partner_id: current.partnerId, refresh_token: previousRefresh, shop_id: stored.shop_id}});
      const token = tokenData(payload, stored.shop_id, current, true);
      if (payload.refresh_token === previousRefresh) throw fail('commerce_shopee_token_invalid');
      unchanged(stored.epoch, stored.config_hash);
      const saved = db.prepare(`UPDATE commerce_shopee_shops SET access_encrypted=?,refresh_encrypted=?,access_expires_at=?,refresh_expires_at=?,
        refresh_owner='',refresh_until=0 WHERE shop_id=? AND revision=? AND config_hash=? AND epoch=? AND status='connected' AND refresh_owner=? AND refresh_until>?`)
        .run(protect(payload.access_token), protect(payload.refresh_token), token.accessExpiresAt, token.refreshExpiresAt,
          stored.shop_id, stored.revision, current.fingerprint, stored.epoch, owner, now());
      if (!saved.changes) throw fail('commerce_shopee_connection_changed');
      return payload.access_token;
    } catch {
      // The provider may have consumed the single-use refresh token even on a
      // timeout/invalid response. Fail closed; a new explicit authorization is required.
      db.prepare("UPDATE commerce_shopee_shops SET status='needs_review' WHERE shop_id=? AND revision=? AND refresh_owner=?")
        .run(stored.shop_id, stored.revision, owner);
      throw fail('commerce_shopee_refresh_pending_review');
    }
  }
  async function verify(shopId) {
    const current = ready(), stored = account(shopId);
    if (!live(stored, current)) throw fail('commerce_shopee_reconnect_required');
    const token = await accessToken(stored, current);
    unchanged(stored.epoch, stored.config_hash);
    if (!live(account(shopId), current) || account(shopId).revision !== stored.revision) throw fail('commerce_shopee_connection_changed');
    try {
      const identity = shopData(await request(SHOP_PATH, current, {accessToken: token, shopId}), shopId);
      unchanged(stored.epoch, stored.config_hash);
      const saved = db.prepare(`UPDATE commerce_shopee_shops SET shop_name=?,authorized_at=?,authorization_expires_at=?,last_verified_at=?
        WHERE shop_id=? AND revision=? AND epoch=? AND config_hash=? AND status='connected'`)
        .run(identity.shopName, identity.authorizedAt, identity.expiresAt, new Date(now()).toISOString(), shopId, stored.revision, stored.epoch, current.fingerprint);
      if (!saved.changes) throw fail('commerce_shopee_connection_changed');
      return status();
    } catch (error) {
      db.prepare("UPDATE commerce_shopee_shops SET status='needs_review' WHERE shop_id=? AND revision=?").run(shopId, stored.revision);
      throw error;
    }
  }
  function disconnect(inputId) {
    const shopId = inputId === undefined ? null : idValue(inputId);
    if (inputId !== undefined && !shopId) throw fail('commerce_shopee_shop_invalid');
    db.transaction(() => {
      // Invalidate pending consent links. A targeted removal fences that shop's
      // in-flight callback through its lock, without disabling other stores.
      db.prepare('DELETE FROM commerce_shopee_oauth_states').run();
      if (shopId) {
        db.prepare('DELETE FROM commerce_shopee_shops WHERE shop_id=?').run(shopId);
        db.prepare('DELETE FROM commerce_shopee_connect_locks WHERE shop_id=?').run(shopId);
      } else {
        db.prepare('UPDATE commerce_shopee_control SET epoch=epoch+1 WHERE id=1').run();
        db.prepare('DELETE FROM commerce_shopee_shops').run();
        db.prepare('DELETE FROM commerce_shopee_connect_locks').run();
      }
    }).immediate();
    return {...status(), detail: 'Conexão removida desta central. A revogação na Shopee é separada.'};
  }
  const sync = fn => (...args) => { try { return fn(...args); } catch (error) { throw safe(error); } };
  return {status: sync(status), begin: sync(begin), disconnect: sync(disconnect),
    async complete(input) { try { return await complete(input); } catch (error) { throw safe(error); } },
    async verifyShop(inputId) {
      const shopId = idValue(inputId);
      if (!shopId) throw fail('commerce_shopee_shop_invalid');
      if (!verifying.has(shopId)) verifying.set(shopId, verify(shopId).catch(error => {throw safe(error);}).finally(() => verifying.delete(shopId)));
      return verifying.get(shopId);
    }
  };
}
