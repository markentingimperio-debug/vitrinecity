import express from 'express';
import Database from 'better-sqlite3';
import fs from 'node:fs';
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
import { originalCourse } from './course-content.js';

const app = express();
const dir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || '/data';
const courseFilesDir = path.resolve(process.env.COURSE_FILES_DIR || '/private-courses');
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
CREATE TABLE IF NOT EXISTS affiliates (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  status TEXT NOT NULL DEFAULT 'active',
  terms_version TEXT NOT NULL DEFAULT '2026-08-14',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS affiliate_commissions (
  id INTEGER PRIMARY KEY,
  affiliate_id INTEGER NOT NULL REFERENCES affiliates(id),
  order_type TEXT NOT NULL,
  order_reference TEXT NOT NULL,
  gross_amount_cents INTEGER NOT NULL,
  rate_bps INTEGER NOT NULL,
  commission_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  available_at INTEGER,
  payment_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(order_type, order_reference)
);
CREATE TABLE IF NOT EXISTS course_orders (
  id INTEGER PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  course_slug TEXT NOT NULL,
  course_title TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  affiliate_id INTEGER REFERENCES affiliates(id),
  status TEXT NOT NULL DEFAULT 'created',
  mp_preference_id TEXT,
  mp_payment_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS course_enrollments (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  course_slug TEXT NOT NULL,
  order_reference TEXT NOT NULL UNIQUE REFERENCES course_orders(reference),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS service_orders (
  id INTEGER PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  service_slug TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  whatsapp TEXT,
  amount_cents INTEGER NOT NULL,
  affiliate_id INTEGER REFERENCES affiliates(id),
  status TEXT NOT NULL DEFAULT 'created',
  delivery_status TEXT NOT NULL DEFAULT 'awaiting_payment',
  mp_preference_id TEXT,
  mp_payment_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_credit_orders_user ON credit_orders(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_user ON wallet_ledger(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_affiliate ON affiliate_commissions(affiliate_id, created_at);
CREATE INDEX IF NOT EXISTS idx_course_orders_user ON course_orders(user_id, created_at);`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(item => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
ensureColumn('lot_orders', 'affiliate_id', 'INTEGER REFERENCES affiliates(id)');

const SITE_URL = process.env.SITE_URL || 'https://vitrinecity.com';
const LOT_PRICE_CENTS = 1500;
const CREDIT_PACKAGE = Object.freeze({ amountCents: 1000, feeCents: 30, creditUnits: 970 });
const COURSE_PRICE_CENTS = 2399;
const VIDEO_PACKAGE = Object.freeze({ slug: '10-videos-loja', amountCents: 20000, quantity: 10 });
const REFERRAL_RATE_BPS = 600;
const VIDEO_CREATOR_RATE_BPS = 8500;
const COMMISSION_HOLD_MS = 30 * 24 * 60 * 60 * 1000;
const AFFILIATE_COOKIE = 'vc_ref';
const AFFILIATE_COOKIE_AGE_SECONDS = 60 * 60 * 24 * 30;
const COURSES = Object.freeze({
  'geladinhos-gourmet': Object.freeze({
    slug: 'geladinhos-gourmet', title: 'Geladinhos Gourmet: produção e vendas',
    priceCents: COURSE_PRICE_CENTS, modules: 5,
    license: 'Conteúdo original VitrineCity. Acesso individual; proibida a redistribuição.'
  }),
  'logo-no-canva': Object.freeze({
    slug: 'logo-no-canva', title: 'Criação de Logo no Canva',
    priceCents: COURSE_PRICE_CENTS, modules: 7,
    license: 'Conteúdo original VitrineCity. Acesso individual; proibida a redistribuição.'
  }),
  'ia-para-pequenos-negocios': Object.freeze({
    slug: 'ia-para-pequenos-negocios', title: 'IA para Pequenos Negócios',
    priceCents: COURSE_PRICE_CENTS, modules: 5,
    license: 'Conteúdo original VitrineCity. Acesso individual; proibida a redistribuição.'
  }),
  'canva-para-lojas': Object.freeze({
    slug: 'canva-para-lojas', title: 'Canva para Lojas',
    priceCents: COURSE_PRICE_CENTS, modules: 5,
    license: 'Conteúdo original VitrineCity. Acesso individual; proibida a redistribuição.'
  }),
  'vendas-pelo-whatsapp': Object.freeze({
    slug: 'vendas-pelo-whatsapp', title: 'Vendas pelo WhatsApp',
    priceCents: COURSE_PRICE_CENTS, modules: 5,
    license: 'Conteúdo original VitrineCity. Acesso individual; proibida a redistribuição.'
  })
});
const COURSE_FILE_EXTENSIONS = new Set(['.pdf', '.mp4', '.webm', '.m4v', '.mp3', '.jpg', '.jpeg', '.png', '.zip']);
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

function courseRoot(slug) {
  if (!COURSES[slug]) return null;
  return path.join(courseFilesDir, slug);
}

function listCourseFiles(slug) {
  const root = courseRoot(slug);
  if (!root || !fs.existsSync(root)) return [];
  const files = [];
  const visit = (directory, relativeDirectory = '', depth = 0) => {
    if (depth > 4) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath, relativePath, depth + 1);
      if (entry.isFile() && COURSE_FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const stat = fs.statSync(absolutePath);
        files.push({ path: relativePath, name: entry.name, size: stat.size,
          type: path.extname(entry.name).slice(1).toLowerCase() });
      }
    }
  };
  visit(root);
  return files.sort((a, b) => a.path.localeCompare(b.path, 'pt-BR', { numeric: true }));
}

function courseReady(slug) {
  return Boolean(originalCourse(slug)?.lessons?.length) || listCourseFiles(slug).length > 0;
}

function activeEnrollment(userId, slug) {
  return db.prepare("SELECT 1 FROM course_enrollments WHERE user_id=? AND course_slug=? AND status='active' LIMIT 1")
    .get(userId, slug);
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

function referralAffiliate(req, buyerEmail = '', buyerUserId = null) {
  const code = String(parseCookies(req)[AFFILIATE_COOKIE] || '').trim();
  if (!code) return null;
  const affiliate = db.prepare(`SELECT a.id,a.user_id,a.code,u.email
    FROM affiliates a JOIN users u ON u.id=a.user_id
    WHERE a.code=? AND a.status='active'`).get(code);
  if (!affiliate) return null;
  if (buyerUserId && Number(affiliate.user_id) === Number(buyerUserId)) return null;
  if (buyerEmail && affiliate.email.toLowerCase() === String(buyerEmail).trim().toLowerCase()) return null;
  return affiliate;
}

const syncAffiliateCommission = db.transaction(({ affiliateId, orderType, orderReference, grossAmountCents, rateBps, payment }) => {
  if (!affiliateId) return;
  const paymentStatus = String(payment.status || 'unknown');
  const reversalStatuses = new Set(['refunded', 'charged_back', 'cancelled', 'rejected']);
  if (paymentStatus !== 'approved' && !reversalStatuses.has(paymentStatus)) return;
  const status = reversalStatuses.has(paymentStatus) ? 'reversed' : orderType === 'video_package' ? 'awaiting_delivery' : 'pending';
  const availableAt = status === 'pending' ? Date.now() + COMMISSION_HOLD_MS : null;
  const commissionCents = Math.round(grossAmountCents * rateBps / 10000);
  db.prepare(`INSERT INTO affiliate_commissions
    (affiliate_id,order_type,order_reference,gross_amount_cents,rate_bps,commission_cents,status,available_at,payment_id)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(order_type,order_reference) DO UPDATE SET
      status=CASE WHEN affiliate_commissions.status='paid' AND excluded.status!='reversed' THEN 'paid' ELSE excluded.status END,
      available_at=excluded.available_at,payment_id=excluded.payment_id,updated_at=CURRENT_TIMESTAMP`)
    .run(affiliateId, orderType, orderReference, grossAmountCents, rateBps, commissionCents,
      status, availableAt, String(payment.id));
});

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

app.get('/r/:code', (req, res) => {
  const affiliate = db.prepare("SELECT code FROM affiliates WHERE code=? AND status='active'").get(String(req.params.code || '').slice(0, 40));
  if (!affiliate) return res.redirect(302, '/afiliados.html?erro=codigo');
  const destinations = {
    lot: '/comprar-lote.html', courses: '/centro-educacional.html',
    videos: '/pacote-videos.html', affiliate: '/afiliados.html'
  };
  let destination = destinations[String(req.query.to || '')] || '/';
  const slug = String(req.query.slug || '');
  if (destination === destinations.courses && COURSES[slug]) destination += `#${encodeURIComponent(slug)}`;
  res.append('Set-Cookie', `${AFFILIATE_COOKIE}=${encodeURIComponent(affiliate.code)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${AFFILIATE_COOKIE_AGE_SECONDS}`);
  return res.redirect(302, destination);
});

app.get('/api/courses', (_req, res) => res.json({
  priceCents: COURSE_PRICE_CENTS,
  courses: Object.values(COURSES).map(({ slug, title, priceCents, modules, license }) =>
    ({ slug, title, priceCents, modules, available: courseReady(slug), license,
      description: originalCourse(slug)?.description || '',
      audience: originalCourse(slug)?.audience || '',
      contentType: originalCourse(slug) ? 'original' : 'licensed' }))
}));

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

app.post('/api/affiliates/register', requireUser, (req, res) => {
  if (!req.user.adult_confirmed || !req.body?.termsAccepted) {
    return res.status(400).json({ error: 'Confirme que é maior de 18 anos e aceite os termos do programa.' });
  }
  const existing = db.prepare('SELECT code,status FROM affiliates WHERE user_id=?').get(req.user.id);
  if (existing) return res.json({ ok: true, affiliate: existing });
  const base = req.user.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '').slice(0, 16) || 'parceiro';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = `${base}${randomBytes(3).toString('hex')}`;
    try {
      db.prepare("INSERT INTO affiliates (user_id,code,status) VALUES (?,?,'active')").run(req.user.id, code);
      return res.status(201).json({ ok: true, affiliate: { code, status: 'active' } });
    } catch (error) {
      if (!String(error?.message || '').includes('UNIQUE')) break;
    }
  }
  return res.status(500).json({ error: 'Não foi possível criar seu código agora.' });
});

app.get('/api/affiliates/me', requireUser, (req, res) => {
  const affiliate = db.prepare('SELECT id,code,status,created_at FROM affiliates WHERE user_id=?').get(req.user.id);
  if (!affiliate) return res.status(404).json({ error: 'Você ainda não participa do programa.' });
  const commissions = db.prepare(`SELECT order_type,order_reference,gross_amount_cents,rate_bps,
    commission_cents,status,available_at,created_at FROM affiliate_commissions
    WHERE affiliate_id=? ORDER BY id DESC LIMIT 100`).all(affiliate.id);
  const totals = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN status IN ('pending','approved','awaiting_delivery') THEN commission_cents ELSE 0 END),0) pending_cents,
    COALESCE(SUM(CASE WHEN status='paid' THEN commission_cents ELSE 0 END),0) paid_cents
    FROM affiliate_commissions WHERE affiliate_id=?`).get(affiliate.id);
  return res.json({
    affiliate: { code: affiliate.code, status: affiliate.status, createdAt: affiliate.created_at },
    links: {
      lot: `${SITE_URL}/r/${affiliate.code}?to=lot`,
      courses: `${SITE_URL}/r/${affiliate.code}?to=courses`,
      videos: `${SITE_URL}/r/${affiliate.code}?to=videos`
    }, totals, commissions
  });
});

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
  const affiliate = referralAffiliate(req, order.email);
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
        metadata: { product: 'founder_lot', customer_whatsapp: order.whatsapp, affiliate_code: affiliate?.code || '' }
      }), signal: AbortSignal.timeout(12000)
    });
    const data = await response.json();
    if (!response.ok || !data.id || !data.init_point) {
      console.error('Mercado Pago preference error', response.status, data?.message || 'unknown');
      return res.status(502).json({ error: 'Não foi possível iniciar o pagamento agora.' });
    }
    db.prepare(`INSERT INTO lot_orders (reference,name,email,whatsapp,amount_cents,affiliate_id,status,mp_preference_id)
      VALUES (?,?,?,?,?,?,'pending',?)`).run(reference, order.name, order.email, order.whatsapp, LOT_PRICE_CENTS, affiliate?.id || null, data.id);
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

app.post('/api/courses/:slug/checkout', requireUser, async (req, res) => {
  const course = COURSES[String(req.params.slug || '')];
  if (!course) return res.status(404).json({ error: 'Curso não encontrado.' });
  if (!courseReady(course.slug)) return res.status(409).json({ error: 'Este curso está em preparação. A compra será liberada quando as aulas estiverem na área privada.' });
  if (!req.body?.termsAccepted) return res.status(400).json({ error: 'Aceite os termos da compra para continuar.' });
  if (!process.env.MERCADOPAGO_ACCESS_TOKEN || !process.env.MERCADOPAGO_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Pagamento temporariamente indisponível.' });
  }
  if (!allowAttempt(checkoutAttempts, `course:${req.user.id}`, 5, 10 * 60 * 1000)) {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
  }
  const affiliate = referralAffiliate(req, req.user.email, req.user.id);
  const reference = `course_${randomUUID()}`;
  db.prepare(`INSERT INTO course_orders
    (reference,user_id,course_slug,course_title,amount_cents,affiliate_id,status)
    VALUES (?,?,?,?,?,?,'created')`).run(reference, req.user.id, course.slug, course.title,
      course.priceCents, affiliate?.id || null);
  try {
    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST', headers: { ...mpHeaders(), 'X-Idempotency-Key': reference },
      body: JSON.stringify({
        items: [{ id: `vitrinecity-${course.slug}`, title: course.title,
          description: 'Curso digital com acesso individual na área do aluno', category_id: 'services',
          quantity: 1, currency_id: 'BRL', unit_price: course.priceCents / 100 }],
        payer: { name: req.user.name, email: req.user.email }, external_reference: reference,
        notification_url: `${SITE_URL}/api/payments/mercadopago/webhook`,
        back_urls: {
          success: `${SITE_URL}/meus-cursos.html?resultado=sucesso&ref=${encodeURIComponent(reference)}`,
          pending: `${SITE_URL}/meus-cursos.html?resultado=pendente&ref=${encodeURIComponent(reference)}`,
          failure: `${SITE_URL}/centro-educacional.html?resultado=falha`
        },
        auto_return: 'approved', statement_descriptor: 'VITRINECITY',
        metadata: { product: 'course', course_slug: course.slug, affiliate_code: affiliate?.code || '' }
      }), signal: AbortSignal.timeout(12000)
    });
    const data = await response.json();
    if (!response.ok || !data.id || !data.init_point) throw new Error(data?.message || 'preference_failed');
    db.prepare("UPDATE course_orders SET status='pending',mp_preference_id=?,updated_at=CURRENT_TIMESTAMP WHERE reference=?")
      .run(data.id, reference);
    return res.status(201).json({ checkoutUrl: data.init_point, reference });
  } catch (error) {
    db.prepare("UPDATE course_orders SET status='failed',updated_at=CURRENT_TIMESTAMP WHERE reference=?").run(reference);
    console.error('Mercado Pago course preference error', error?.message || 'unknown');
    return res.status(502).json({ error: 'Não foi possível iniciar o pagamento agora.' });
  }
});

app.post('/api/services/videos/checkout', async (req, res) => {
  if (!process.env.MERCADOPAGO_ACCESS_TOKEN || !process.env.MERCADOPAGO_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Pagamento temporariamente indisponível.' });
  }
  if (!allowAttempt(checkoutAttempts, `videos:${req.ip}`, 5, 10 * 60 * 1000)) {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
  }
  const { name, email, whatsapp = '', consent, termsAccepted } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!consent || !termsAccepted || typeof name !== 'string' || name.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Informe seus dados e aceite os termos do pacote.' });
  }
  const affiliate = referralAffiliate(req, normalizedEmail);
  const reference = `video_${randomUUID()}`;
  db.prepare(`INSERT INTO service_orders
    (reference,service_slug,name,email,whatsapp,amount_cents,affiliate_id,status,delivery_status)
    VALUES (?,?,?,?,?,?,?,'created','awaiting_payment')`).run(reference, VIDEO_PACKAGE.slug,
      name.trim().slice(0, 100), normalizedEmail.slice(0, 160), String(whatsapp).trim().slice(0, 30),
      VIDEO_PACKAGE.amountCents, affiliate?.id || null);
  try {
    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST', headers: { ...mpHeaders(), 'X-Idempotency-Key': reference },
      body: JSON.stringify({
        items: [{ id: 'vitrinecity-pacote-10-videos', title: 'Pacote de 10 vídeos para loja',
          description: 'Criação e divulgação de 10 vídeos curtos para uma loja VitrineCity', category_id: 'services',
          quantity: 1, currency_id: 'BRL', unit_price: VIDEO_PACKAGE.amountCents / 100 }],
        payer: { name: name.trim().slice(0, 100), email: normalizedEmail }, external_reference: reference,
        notification_url: `${SITE_URL}/api/payments/mercadopago/webhook`,
        back_urls: {
          success: `${SITE_URL}/pagamento.html?resultado=sucesso&servico=videos`,
          pending: `${SITE_URL}/pagamento.html?resultado=pendente&servico=videos`,
          failure: `${SITE_URL}/pacote-videos.html?resultado=falha`
        },
        auto_return: 'approved', statement_descriptor: 'VITRINECITY',
        metadata: { product: 'video_package', quantity: VIDEO_PACKAGE.quantity, affiliate_code: affiliate?.code || '' }
      }), signal: AbortSignal.timeout(12000)
    });
    const data = await response.json();
    if (!response.ok || !data.id || !data.init_point) throw new Error(data?.message || 'preference_failed');
    db.prepare("UPDATE service_orders SET status='pending',mp_preference_id=?,updated_at=CURRENT_TIMESTAMP WHERE reference=?")
      .run(data.id, reference);
    return res.status(201).json({ checkoutUrl: data.init_point, reference });
  } catch (error) {
    db.prepare("UPDATE service_orders SET status='failed',updated_at=CURRENT_TIMESTAMP WHERE reference=?").run(reference);
    console.error('Mercado Pago video package error', error?.message || 'unknown');
    return res.status(502).json({ error: 'Não foi possível iniciar o pagamento agora.' });
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
    if (reference.startsWith('course_')) {
      const order = db.prepare('SELECT * FROM course_orders WHERE reference=?').get(reference);
      if (!order) return res.sendStatus(200);
      if (amountCents !== order.amount_cents || payment.currency_id !== 'BRL') return res.sendStatus(400);
      const status = String(payment.status || 'unknown');
      db.prepare(`UPDATE course_orders SET status=?,mp_payment_id=?,updated_at=CURRENT_TIMESTAMP WHERE reference=?`)
        .run(status, String(payment.id), order.reference);
      if (status === 'approved') {
        db.prepare(`INSERT INTO course_enrollments (user_id,course_slug,order_reference,status)
          VALUES (?,?,?,'active') ON CONFLICT(order_reference) DO UPDATE SET status='active',updated_at=CURRENT_TIMESTAMP`)
          .run(order.user_id, order.course_slug, order.reference);
      } else if (['refunded', 'charged_back', 'cancelled', 'rejected'].includes(status)) {
        db.prepare("UPDATE course_enrollments SET status='revoked',updated_at=CURRENT_TIMESTAMP WHERE order_reference=?")
          .run(order.reference);
      }
      syncAffiliateCommission({ affiliateId: order.affiliate_id, orderType: 'course', orderReference: order.reference,
        grossAmountCents: order.amount_cents, rateBps: REFERRAL_RATE_BPS, payment });
      return res.sendStatus(200);
    }
    if (reference.startsWith('video_')) {
      const order = db.prepare('SELECT * FROM service_orders WHERE reference=?').get(reference);
      if (!order) return res.sendStatus(200);
      if (amountCents !== order.amount_cents || payment.currency_id !== 'BRL') return res.sendStatus(400);
      const status = String(payment.status || 'unknown');
      const deliveryStatus = status === 'approved' ? 'awaiting_brief' :
        ['refunded', 'charged_back', 'cancelled', 'rejected'].includes(status) ? 'cancelled' : order.delivery_status;
      db.prepare(`UPDATE service_orders SET status=?,delivery_status=?,mp_payment_id=?,updated_at=CURRENT_TIMESTAMP WHERE reference=?`)
        .run(status, deliveryStatus, String(payment.id), order.reference);
      syncAffiliateCommission({ affiliateId: order.affiliate_id, orderType: 'video_package', orderReference: order.reference,
        grossAmountCents: order.amount_cents, rateBps: VIDEO_CREATOR_RATE_BPS, payment });
      return res.sendStatus(200);
    }
    const order = db.prepare('SELECT * FROM lot_orders WHERE reference=?').get(reference);
    if (!order) return res.sendStatus(200);
    if (amountCents !== order.amount_cents || payment.currency_id !== 'BRL') return res.sendStatus(400);
    db.prepare(`UPDATE lot_orders SET status=?,mp_payment_id=?,updated_at=CURRENT_TIMESTAMP WHERE reference=?`)
      .run(String(payment.status || 'unknown'), String(payment.id), order.reference);
    syncAffiliateCommission({ affiliateId: order.affiliate_id, orderType: 'lot', orderReference: order.reference,
      grossAmountCents: order.amount_cents, rateBps: REFERRAL_RATE_BPS, payment });
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

app.get('/api/my-courses', requireUser, (req, res) => {
  const enrollments = db.prepare(`SELECT e.course_slug,e.status,e.created_at,o.course_title
    FROM course_enrollments e JOIN course_orders o ON o.reference=e.order_reference
    WHERE e.user_id=? ORDER BY e.id DESC`).all(req.user.id);
  return res.json({ courses: enrollments.map(item => ({
    ...item,
    contentReady: courseReady(item.course_slug)
  })) });
});

app.get('/api/my-courses/:slug/materials', requireUser, (req, res) => {
  const slug = String(req.params.slug || '');
  if (!COURSES[slug]) return res.status(404).json({ error: 'Curso não encontrado.' });
  if (!activeEnrollment(req.user.id, slug)) return res.status(403).json({ error: 'Acesso disponível somente para alunos matriculados.' });
  const original = originalCourse(slug);
  return res.json({
    course: { slug, title: COURSES[slug].title },
    lessons: (original?.lessons || []).map(({ slug: lessonSlug, title, duration, objective }) =>
      ({ slug: lessonSlug, title, duration, objective })),
    files: listCourseFiles(slug)
  });
});

app.get('/api/my-courses/:slug/lessons/:lessonSlug', requireUser, (req, res) => {
  const slug = String(req.params.slug || '');
  const course = originalCourse(slug);
  if (!COURSES[slug] || !course) return res.status(404).json({ error: 'Curso ou aula não encontrado.' });
  if (!activeEnrollment(req.user.id, slug)) return res.status(403).json({ error: 'Acesso disponível somente para alunos matriculados.' });
  const lesson = course.lessons.find(item => item.slug === String(req.params.lessonSlug || ''));
  if (!lesson) return res.status(404).json({ error: 'Aula não encontrada.' });
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  return res.json({ course: { slug, title: COURSES[slug].title }, lesson });
});

app.get('/api/my-courses/:slug/material', requireUser, (req, res) => {
  const slug = String(req.params.slug || '');
  const root = courseRoot(slug);
  if (!root || !activeEnrollment(req.user.id, slug)) return res.status(403).json({ error: 'Acesso não autorizado.' });
  const requested = String(req.query.path || '').replaceAll('\\', '/');
  const absolutePath = path.resolve(root, requested);
  if (!requested || (!absolutePath.startsWith(`${root}${path.sep}`) && absolutePath !== root)) {
    return res.status(400).json({ error: 'Arquivo inválido.' });
  }
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile() ||
      !COURSE_FILE_EXTENSIONS.has(path.extname(absolutePath).toLowerCase())) {
    return res.status(404).json({ error: 'Arquivo não encontrado.' });
  }
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(absolutePath))}` });
  return res.sendFile(absolutePath);
});

app.get('/api/courses/orders/:reference', requireUser, (req, res) => {
  const order = db.prepare(`SELECT reference,course_slug,course_title,status,created_at,updated_at
    FROM course_orders WHERE reference=? AND user_id=?`).get(req.params.reference, req.user.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  return res.json(order);
});

app.get('/api/payments/mercadopago/status', (_req, res) => {
  const configured = Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN && process.env.MERCADOPAGO_WEBHOOK_SECRET);
  return res.status(configured ? 200 : 503).json({ ok: configured, configured, mode: 'production' });
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.listen(process.env.PORT || 3000, () => console.log('VitrineCity online'));
