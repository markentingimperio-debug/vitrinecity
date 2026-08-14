import express from 'express';
import Database from 'better-sqlite3';
import path from 'node:path';
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual
} from 'node:crypto';
import { fileURLToPath } from 'node:url';

const app = express();
const dir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || '/data';
const db = new Database(path.join(dataDir, 'vitrinecity.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, whatsapp TEXT,
  interest TEXT, consent INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS lot_orders (
  id INTEGER PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  whatsapp TEXT,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  mp_preference_id TEXT,
  mp_payment_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  whatsapp TEXT,
  password_hash TEXT NOT NULL,
  adult_confirmed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS wallets (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance_units INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS credit_orders (
  id INTEGER PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL,
  credit_units INTEGER NOT NULL,
  credited_units INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'created',
  mp_preference_id TEXT,
  mp_payment_id TEXT,
  terms_version TEXT NOT NULL DEFAULT '2026-08-14',
  terms_accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  delta_units INTEGER NOT NULL,
  balance_after_units INTEGER NOT NULL,
  kind TEXT NOT NULL,
  description TEXT NOT NULL,
  order_reference TEXT,
  payment_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS credit_batches (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  order_reference TEXT NOT NULL UNIQUE REFERENCES credit_orders(reference),
  original_units INTEGER NOT NULL,
  remaining_units INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_credit_orders_user ON credit_orders(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_user ON wallet_ledger(user_id, created_at);`);

const SITE_URL = process.env.SITE_URL || 'https://vitrinecity.com';
const LOT_PRICE_CENTS = 1500;
const CREDIT_PACKAGE = Object.freeze({ amountCents: 1000, feeCents: 30, creditUnits: 970 });
const SESSION_COOKIE = 'vc_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const CREDIT_VALIDITY_MS = 60 * 24 * 60 * 60 * 1000;
const checkoutAttempts = new Map();
const authAttempts = new Map();

const mpHeaders = () => ({
  Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
  'Content-Type': 'application/json'
});

function allowAttempt(store, key, limit, windowMs) {
  const now = Date.now();
  const recent = (store.get(key) || []).filter(time => now - time < windowMs);
  if (recent.length >= limit) return false;
  store.set(key, [...recent, now]);
  return true;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [scheme, salt, expectedHex] = String(stored || '').split(':');
  if (scheme !== 'scrypt' || !salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(part => {
    const index = part.indexOf('=');
    return index < 0 ? ['', ''] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function sessionHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function setSession(res, userId) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)')
    .run(sessionHash(token), userId, Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  res.append('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`);
}

function currentUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  return db.prepare(`SELECT u.id,u.name,u.email,u.whatsapp,u.adult_confirmed
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`).get(sessionHash(token), Date.now()) || null;
}

function requireUser(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Entre na sua conta para continuar.' });
  req.user = user;
  return next();
}

const expireCreditBatches = db.transaction((userId) => {
  const now = Date.now();
  const expired = db.prepare(`SELECT * FROM credit_batches
    WHERE user_id=? AND status='active' AND remaining_units>0 AND expires_at<=?`).all(userId, now);
  for (const batch of expired) {
    const current = db.prepare('SELECT balance_units FROM wallets WHERE user_id=?').get(userId)?.balance_units || 0;
    const delta = -batch.remaining_units;
    const balanceAfter = current + delta;
    db.prepare('UPDATE wallets SET balance_units=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(balanceAfter, userId);
    db.prepare(`UPDATE credit_batches SET remaining_units=0,status='expired',updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(batch.id);
    db.prepare(`INSERT INTO wallet_ledger
      (user_id,delta_units,balance_after_units,kind,description,order_reference)
      VALUES (?,?,?,?,?,?)`).run(userId, delta, balanceAfter, 'expiration',
        'Créditos Vitrine expirados após 60 dias', batch.order_reference);
  }
});

function publicWallet(userId) {
  expireCreditBatches(userId);
  const wallet = db.prepare('SELECT balance_units,updated_at FROM wallets WHERE user_id=?').get(userId);
  const transactions = db.prepare(`SELECT delta_units,kind,description,created_at
    FROM wallet_ledger WHERE user_id=? ORDER BY id DESC LIMIT 30`).all(userId);
  const batches = db.prepare(`SELECT remaining_units,expires_at,order_reference FROM credit_batches
    WHERE user_id=? AND status='active' AND remaining_units>0 ORDER BY expires_at ASC`).all(userId);
  return {
    balanceUnits: wallet?.balance_units || 0,
    updatedAt: wallet?.updated_at || null,
    validityDays: 60,
    nextExpirationAt: batches[0]?.expires_at || null,
    batches,
    transactions
  };
}

app.use(express.json({ limit: '30kb' }));
app.set('trust proxy', 1);
app.use('/vendor/three', express.static(path.join(dir, 'node_modules/three/build')));
app.use(express.static(path.join(dir, 'public'), { extensions: ['html'] }));

app.post('/api/leads', (req, res) => {
  const { name, email, whatsapp = '', interest = '', consent } = req.body || {};
  if (!consent || typeof name !== 'string' || name.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(email || '')) {
    return res.status(400).json({ error: 'Informe nome, e-mail válido e aceite o recebimento de novidades.' });
  }
  db.prepare('INSERT INTO leads (name,email,whatsapp,interest,consent) VALUES (?,?,?,?,1)')
    .run(name.trim().slice(0, 100), email.trim().toLowerCase().slice(0, 160), String(whatsapp).slice(0, 30), String(interest).slice(0, 80));
  return res.status(201).json({ ok: true });
});

app.post('/api/auth/register', (req, res) => {
  if (!allowAttempt(authAttempts, `register:${req.ip}`, 8, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
  }
  const { name, email, whatsapp = '', password, adultConfirmed, termsAccepted } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!adultConfirmed || !termsAccepted || typeof name !== 'string' || name.trim().length < 2 ||
      !/^\S+@\S+\.\S+$/.test(normalizedEmail) || typeof password !== 'string' || password.length < 10) {
    return res.status(400).json({ error: 'Informe os dados, use senha com 10 caracteres e aceite os termos para maiores de 18 anos.' });
  }
  try {
    const create = db.transaction(() => {
      const result = db.prepare(`INSERT INTO users (name,email,whatsapp,password_hash,adult_confirmed)
        VALUES (?,?,?,?,1)`).run(name.trim().slice(0, 100), normalizedEmail.slice(0, 160), String(whatsapp).trim().slice(0, 30), hashPassword(password));
      db.prepare('INSERT INTO wallets (user_id,balance_units) VALUES (?,0)').run(result.lastInsertRowid);
      return Number(result.lastInsertRowid);
    });
    const userId = create();
    setSession(res, userId);
    return res.status(201).json({ ok: true });
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) return res.status(409).json({ error: 'Este e-mail já possui uma conta.' });
    return res.status(500).json({ error: 'Não foi possível criar sua conta agora.' });
  }
});

app.post('/api/auth/login', (req, res) => {
  if (!allowAttempt(authAttempts, `login:${req.ip}`, 10, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
  }
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  }
  setSession(res, user.id);
  return res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sessionHash(token));
  res.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  return res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ authenticated: false });
  return res.json({ authenticated: true, user: { name: user.name, email: user.email }, wallet: publicWallet(user.id) });
});

app.get('/api/wallet', requireUser, (req, res) => res.json(publicWallet(req.user.id)));

app.post('/api/payments/mercadopago/checkout', async (req, res) => {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token || !process.env.MERCADOPAGO_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Pagamento temporariamente indisponível.' });
  }
  if (!allowAttempt(checkoutAttempts, `lot:${req.ip}`, 5, 10 * 60 * 1000)) {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
  }
  const { name, email, whatsapp = '', consent } = req.body || {};
  if (!consent || typeof name !== 'string' || name.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(email || '')) {
    return res.status(400).json({ error: 'Informe nome, e-mail válido e aceite os termos.' });
  }
  const reference = `lot_${randomUUID()}`;
  const order = {
    name: name.trim().slice(0, 100),
    email: email.trim().toLowerCase().slice(0, 160),
    whatsapp: String(whatsapp).trim().slice(0, 30)
  };
  try {
    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { ...mpHeaders(), 'X-Idempotency-Key': reference },
      body: JSON.stringify({
        items: [{ id: 'vitrinecity-lote-fundador', title: 'Lote Fundador VitrineCity',
          description: 'Espaço digital para divulgar sua loja na VitrineCity', category_id: 'services',
          quantity: 1, currency_id: 'BRL', unit_price: LOT_PRICE_CENTS / 100 }],
        payer: { name: order.name, email: order.email }, external_reference: reference,
        notification_url: `${SITE_URL}/api/payments/mercadopago/webhook`,
        back_urls: {
          success: `${SITE_URL}/pagamento.html?resultado=sucesso`,
          pending: `${SITE_URL}/pagamento.html?resultado=pendente`,
          failure: `${SITE_URL}/pagamento.html?resultado=falha`
        },
        auto_return: 'approved', statement_descriptor: 'VITRINECITY',
        metadata: { product: 'founder_lot', customer_whatsapp: order.whatsapp }
      }), signal: AbortSignal.timeout(12000)
    });
    const data = await response.json();
    if (!response.ok || !data.id || !data.init_point) {
      console.error('Mercado Pago preference error', response.status, data?.message || 'unknown');
      return res.status(502).json({ error: 'Não foi possível iniciar o pagamento agora.' });
    }
    db.prepare(`INSERT INTO lot_orders (reference,name,email,whatsapp,amount_cents,status,mp_preference_id)
      VALUES (?,?,?,?,?,'pending',?)`).run(reference, order.name, order.email, order.whatsapp, LOT_PRICE_CENTS, data.id);
    return res.status(201).json({ checkoutUrl: data.init_point });
  } catch (error) {
    console.error('Mercado Pago unavailable', error?.message || 'unknown');
    return res.status(502).json({ error: 'Não foi possível conectar ao Mercado Pago agora.' });
  }
});

app.post('/api/credits/checkout', requireUser, async (req, res) => {
  if (!process.env.MERCADOPAGO_ACCESS_TOKEN || !process.env.MERCADOPAGO_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Pagamento temporariamente indisponível.' });
  }
  if (!req.user.adult_confirmed) return res.status(403).json({ error: 'Disponível somente para maiores de 18 anos.' });
  if (!req.body?.termsAccepted) return res.status(400).json({ error: 'Aceite os termos dos Créditos Vitrine.' });
  if (!allowAttempt(checkoutAttempts, `credits:${req.user.id}`, 5, 10 * 60 * 1000)) {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
  }
  const reference = `coin_${randomUUID()}`;
  db.prepare(`INSERT INTO credit_orders
    (reference,user_id,amount_cents,fee_cents,credit_units,status,terms_version,terms_accepted_at)
    VALUES (?,?,?,?,?,'created','2026-08-14',CURRENT_TIMESTAMP)`)
    .run(reference, req.user.id, CREDIT_PACKAGE.amountCents, CREDIT_PACKAGE.feeCents, CREDIT_PACKAGE.creditUnits);
  try {
    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST', headers: { ...mpHeaders(), 'X-Idempotency-Key': reference },
      body: JSON.stringify({
        items: [{ id: 'vitrinecity-creditos-970', title: '9,70 Créditos Vitrine',
          description: 'Uso interno; validade de 60 dias; taxa de conversão de 3% incluída',
          category_id: 'services', quantity: 1, currency_id: 'BRL', unit_price: CREDIT_PACKAGE.amountCents / 100 }],
        payer: { name: req.user.name, email: req.user.email },
        external_reference: reference,
        notification_url: `${SITE_URL}/api/payments/mercadopago/webhook`,
        back_urls: {
          success: `${SITE_URL}/carteira.html?resultado=sucesso&ref=${encodeURIComponent(reference)}`,
          pending: `${SITE_URL}/carteira.html?resultado=pendente&ref=${encodeURIComponent(reference)}`,
          failure: `${SITE_URL}/carteira.html?resultado=falha&ref=${encodeURIComponent(reference)}`
        },
        auto_return: 'approved', statement_descriptor: 'VITRINECITY',
        metadata: { product: 'internal_credits', user_id: req.user.id, credit_units: CREDIT_PACKAGE.creditUnits }
      }), signal: AbortSignal.timeout(12000)
    });
    const data = await response.json();
    if (!response.ok || !data.id || !data.init_point) {
      db.prepare("UPDATE credit_orders SET status='failed',updated_at=CURRENT_TIMESTAMP WHERE reference=?").run(reference);
      console.error('Mercado Pago credits preference error', response.status, data?.message || 'unknown');
      return res.status(502).json({ error: 'Não foi possível iniciar o pagamento agora.' });
    }
    db.prepare("UPDATE credit_orders SET status='pending',mp_preference_id=?,updated_at=CURRENT_TIMESTAMP WHERE reference=?")
      .run(data.id, reference);
    return res.status(201).json({ checkoutUrl: data.init_point, reference });
  } catch (error) {
    db.prepare("UPDATE credit_orders SET status='failed',updated_at=CURRENT_TIMESTAMP WHERE reference=?").run(reference);
    console.error('Mercado Pago credits unavailable', error?.message || 'unknown');
    return res.status(502).json({ error: 'Não foi possível conectar ao Mercado Pago agora.' });
  }
});

function validMercadoPagoSignature(req, dataId) {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  const signature = String(req.get('x-signature') || '');
  const requestId = String(req.get('x-request-id') || '');
  if (!secret || !signature || !requestId || !dataId) return false;
  const parts = Object.fromEntries(signature.split(',').map(part => part.trim().split('=')));
  if (!parts.ts || !parts.v1) return false;
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest('hex');
  const received = String(parts.v1);
  return expected.length === received.length && timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

const applyCreditPayment = db.transaction((order, payment) => {
  const status = String(payment.status || 'unknown');
  const reversalStatuses = new Set(['refunded', 'charged_back', 'cancelled', 'rejected']);
  const desiredUnits = status === 'approved' ? order.credit_units : reversalStatuses.has(status) ? 0 : order.credited_units;
  const delta = desiredUnits - order.credited_units;
  let balanceAfter = db.prepare('SELECT balance_units FROM wallets WHERE user_id=?').get(order.user_id)?.balance_units || 0;
  if (delta !== 0) {
    balanceAfter += delta;
    db.prepare('UPDATE wallets SET balance_units=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(balanceAfter, order.user_id);
    db.prepare(`INSERT INTO wallet_ledger
      (user_id,delta_units,balance_after_units,kind,description,order_reference,payment_id)
      VALUES (?,?,?,?,?,?,?)`).run(order.user_id, delta, balanceAfter, delta > 0 ? 'purchase' : 'reversal',
        delta > 0 ? 'Compra de Créditos Vitrine aprovada' : 'Ajuste por cancelamento ou estorno',
        order.reference, String(payment.id));
    if (delta > 0) {
      const expiresAt = Date.now() + CREDIT_VALIDITY_MS;
      db.prepare(`INSERT INTO credit_batches
        (user_id,order_reference,original_units,remaining_units,expires_at,status)
        VALUES (?,?,?,?,?,'active')
        ON CONFLICT(order_reference) DO UPDATE SET
          remaining_units=credit_batches.remaining_units+excluded.remaining_units,
          expires_at=excluded.expires_at,status='active',updated_at=CURRENT_TIMESTAMP`)
        .run(order.user_id, order.reference, order.credit_units, delta, expiresAt);
    } else {
      db.prepare(`UPDATE credit_batches SET remaining_units=MAX(0,remaining_units+?),
        status='reversed',updated_at=CURRENT_TIMESTAMP WHERE order_reference=?`).run(delta, order.reference);
    }
  }
  db.prepare(`UPDATE credit_orders SET status=?,credited_units=?,mp_payment_id=?,updated_at=CURRENT_TIMESTAMP
    WHERE reference=?`).run(status, desiredUnits, String(payment.id), order.reference);
});

app.post('/api/payments/mercadopago/webhook', async (req, res) => {
  const dataId = req.body?.data?.id || req.query['data.id'];
  if (!validMercadoPagoSignature(req, dataId)) return res.sendStatus(401);
  if (req.body?.type !== 'payment' && req.query.type !== 'payment') return res.sendStatus(200);
  try {
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(dataId)}`, {
      headers: mpHeaders(), signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return res.sendStatus(502);
    const payment = await response.json();
    const reference = String(payment.external_reference || '');
    const amountCents = Math.round(Number(payment.transaction_amount) * 100);
    if (reference.startsWith('coin_')) {
      const order = db.prepare('SELECT * FROM credit_orders WHERE reference=?').get(reference);
      if (!order) return res.sendStatus(200);
      if (amountCents !== order.amount_cents || payment.currency_id !== 'BRL') return res.sendStatus(400);
      applyCreditPayment(order, payment);
      return res.sendStatus(200);
    }
    const order = db.prepare('SELECT * FROM lot_orders WHERE reference=?').get(reference);
    if (!order) return res.sendStatus(200);
    if (amountCents !== order.amount_cents || payment.currency_id !== 'BRL') return res.sendStatus(400);
    db.prepare(`UPDATE lot_orders SET status=?,mp_payment_id=?,updated_at=CURRENT_TIMESTAMP WHERE reference=?`)
      .run(String(payment.status || 'unknown'), String(payment.id), order.reference);
    return res.sendStatus(200);
  } catch (error) {
    console.error('Mercado Pago webhook error', error?.message || 'unknown');
    return res.sendStatus(502);
  }
});

app.get('/api/orders/:reference', (req, res) => {
  const order = db.prepare('SELECT reference,status,created_at,updated_at FROM lot_orders WHERE reference=?').get(req.params.reference);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  return res.json(order);
});

app.get('/api/credits/orders/:reference', requireUser, (req, res) => {
  expireCreditBatches(req.user.id);
  const order = db.prepare(`SELECT o.reference,o.status,o.credit_units,o.credited_units,o.created_at,o.updated_at,
    b.expires_at FROM credit_orders o LEFT JOIN credit_batches b ON b.order_reference=o.reference
    WHERE o.reference=? AND o.user_id=?`).get(req.params.reference, req.user.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  return res.json(order);
});

app.get('/api/payments/mercadopago/status', (_req, res) => {
  const configured = Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN && process.env.MERCADOPAGO_WEBHOOK_SECRET);
  return res.status(configured ? 200 : 503).json({ ok: configured, configured, mode: 'production' });
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.listen(process.env.PORT || 3000, () => console.log('VitrineCity online'));
