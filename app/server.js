import express from 'express';
import Database from 'better-sqlite3';
import nodemailer from 'nodemailer';
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
import { setupAdminAnalytics } from './admin-analytics.js';

const app = express();
const dir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || '/data';
const courseFilesDir = path.resolve(process.env.COURSE_FILES_DIR || '/private-courses');
fs.mkdirSync(dataDir, { recursive: true });
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
CREATE TABLE IF NOT EXISTS course_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_slug TEXT NOT NULL,
  lesson_slug TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, course_slug, lesson_slug)
);
CREATE TABLE IF NOT EXISTS course_certificates (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  course_slug TEXT NOT NULL,
  verification_code TEXT NOT NULL UNIQUE,
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, course_slug)
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
CREATE TABLE IF NOT EXISTS store_profiles (
  id INTEGER PRIMARY KEY,
  order_reference TEXT NOT NULL UNIQUE REFERENCES lot_orders(reference) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  description TEXT,
  logo_url TEXT,
  facade_url TEXT,
  whatsapp TEXT,
  website_url TEXT,
  instagram_url TEXT,
  tiktok_url TEXT,
  google_maps_url TEXT,
  promotion_text TEXT,
  wants_website INTEGER NOT NULL DEFAULT 0,
  wants_brand_art INTEGER NOT NULL DEFAULT 0,
  review_status TEXT NOT NULL DEFAULT 'draft',
  admin_notes TEXT,
  submitted_at TEXT,
  reviewed_at TEXT,
  published_at TEXT,
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
ensureColumn('lot_orders', 'lot_code', 'TEXT');
ensureColumn('lot_orders', 'business_name', 'TEXT');
ensureColumn('lot_orders', 'segment', 'TEXT');
ensureColumn('lot_orders', 'fulfillment_status', "TEXT NOT NULL DEFAULT 'awaiting_payment'");
ensureColumn('lot_orders', 'reserved_at', 'TEXT');
ensureColumn('lot_orders', 'confirmation_status', "TEXT NOT NULL DEFAULT 'pending'");
ensureColumn('lot_orders', 'confirmation_sent_at', 'TEXT');
ensureColumn('lot_orders', 'confirmation_error', 'TEXT');
ensureColumn('lot_orders', 'plan_code', "TEXT NOT NULL DEFAULT 'founder'");
ensureColumn('lot_orders', 'billing_type', "TEXT NOT NULL DEFAULT 'one_time'");
ensureColumn('lot_orders', 'mp_subscription_id', 'TEXT');
ensureColumn('users', 'is_admin', 'INTEGER NOT NULL DEFAULT 0');

const SITE_URL = process.env.SITE_URL || 'https://vitrinecity.com';
const LOT_PRICE_CENTS = 1500;
const LOT_PLANS = Object.freeze({
  founder: Object.freeze({ code: 'founder', name: 'Prédio Fundador', amountCents: 1500, billingType: 'one_time' }),
  basic_monthly: Object.freeze({ code: 'basic_monthly', name: 'Prédio Essencial Mensal', amountCents: 1000, billingType: 'recurring' })
});
const LOT_CATALOG = Object.freeze({
  'COUNTRY-041': Object.freeze({ code: 'COUNTRY-041', label: 'Lote Country 041', place: 'Avenida Country' }),
  'PARQUE-118': Object.freeze({ code: 'PARQUE-118', label: 'Lote Parque 118', place: 'Região da Praça Central' }),
  'SUL-203': Object.freeze({ code: 'SUL-203', label: 'Lote Sul 203', place: 'Distrito de Serviços' })
});
const AVAILABLE_LOTS = new Set(Object.keys(LOT_CATALOG));
const LOT_HOLD_MINUTES = 45;
const CREDIT_PACKAGE = Object.freeze({ amountCents: 1000, feeCents: 30, creditUnits: 970 });
const COURSE_PRICE_CENTS = 2399;
const VIDEO_PACKAGE = Object.freeze({ slug: '10-videos-loja', amountCents: 20000, quantity: 10 });
const REFERRAL_RATE_BPS = 600;
const COURSE_REFERRAL_RATE_BPS = 4500;
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
  }),
  'precificacao-e-lucro': Object.freeze({
    slug: 'precificacao-e-lucro', title: 'Precificação e Lucro para Pequenos Negócios',
    priceCents: COURSE_PRICE_CENTS, modules: 5,
    license: 'Conteúdo original VitrineCity. Acesso individual; proibida a redistribuição.'
  }),
  'shopee-do-zero': Object.freeze({
    slug: 'shopee-do-zero', title: 'Shopee do Zero às Primeiras Vendas',
    priceCents: COURSE_PRICE_CENTS, modules: 6,
    license: 'Conteúdo original VitrineCity. Acesso individual; proibida a redistribuição.'
  }),
  'videos-curtos-que-vendem': Object.freeze({
    slug: 'videos-curtos-que-vendem', title: 'Vídeos Curtos que Vendem',
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

const mpHeaders = (token = process.env.MERCADOPAGO_ACCESS_TOKEN) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json'
});

const pixAccessToken = () => process.env.MERCADOPAGO_PIX_ACCESS_TOKEN || '';
const pixHeaders = () => mpHeaders(pixAccessToken());

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

function courseProgress(userId, slug) {
  const course = originalCourse(slug);
  const lessonSlugs = course?.lessons?.map(item => item.slug) || [];
  const completed = db.prepare(`SELECT lesson_slug FROM course_progress
    WHERE user_id=? AND course_slug=? ORDER BY completed_at`).all(userId, slug)
    .map(item => item.lesson_slug).filter(value => lessonSlugs.includes(value));
  const certificate = db.prepare(`SELECT verification_code,issued_at FROM course_certificates
    WHERE user_id=? AND course_slug=?`).get(userId, slug) || null;
  return {
    completedLessonSlugs: completed,
    completedCount: completed.length,
    totalLessons: lessonSlugs.length,
    certificateEligible: lessonSlugs.length > 0 && completed.length === lessonSlugs.length,
    certificate
  };
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
  return db.prepare(`SELECT u.id,u.name,u.email,u.whatsapp,u.adult_confirmed,u.is_admin
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`).get(sessionHash(token), Date.now()) || null;
}

const adminEmails = new Set(String(process.env.ADMIN_EMAILS || '').split(',')
  .map(email => email.trim().toLowerCase()).filter(Boolean));

function requireAdmin(req, res, next) {
  const user = currentUser(req);
  if (!user) {
    if (req.path === '/admin' || req.path === '/admin.html') return res.redirect(302, '/carteira.html?admin=1');
    return res.status(401).json({ error: 'Entre na conta administrativa.' });
  }
  if (!user.is_admin && !adminEmails.has(String(user.email).toLowerCase())) {
    return res.status(403).json({ error: 'Acesso restrito à administração.' });
  }
  req.user = user;
  return next();
}

function requireUser(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Entre na sua conta para continuar.' });
  req.user = user;
  return next();
}

function lotOccupation(code) {
  return db.prepare(`SELECT status,business_name,created_at FROM lot_orders
    WHERE lot_code=? AND (
      status='approved' OR
      (status IN ('created','pending') AND datetime(created_at)>=datetime('now',?))
    )
    ORDER BY CASE WHEN status='approved' THEN 0 ELSE 1 END, datetime(created_at) DESC LIMIT 1`)
    .get(code, `-${LOT_HOLD_MINUTES} minutes`);
}

function publicLot(code) {
  const lot = LOT_CATALOG[code];
  if (!lot) return null;
  const occupation = lotOccupation(code);
  const status = occupation?.status === 'approved' ? 'occupied' : occupation ? 'reserved' : 'available';
  return {
    ...lot,
    status,
    businessName: status === 'occupied' ? String(occupation.business_name || 'Loja em implantação') : ''
  };
}

function lotIsAvailable(code) {
  return Boolean(LOT_CATALOG[code]) && publicLot(code).status === 'available';
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function managementSecret() {
  return String(process.env.STORE_PORTAL_SECRET || process.env.MERCADOPAGO_WEBHOOK_SECRET || '').trim();
}

function storeManagementToken(reference) {
  const secret = managementSecret();
  if (!secret) return '';
  return createHmac('sha256', secret).update(`store:${reference}`).digest('base64url');
}

function validStoreManagementToken(reference, provided) {
  const expected = storeManagementToken(reference);
  if (!expected || !provided) return false;
  const actualBuffer = Buffer.from(String(provided));
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function safeExternalUrl(value, max = 500) {
  const text = String(value || '').trim().slice(0, max);
  if (!text) return '';
  try {
    const parsed = new URL(text);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch { return ''; }
}

function publicStoreProfile(reference) {
  const order = db.prepare(`SELECT reference,business_name,segment,lot_code,status,fulfillment_status,
    plan_code,billing_type FROM lot_orders WHERE reference=?`).get(reference);
  if (!order) return null;
  const profile = db.prepare('SELECT * FROM store_profiles WHERE order_reference=?').get(reference);
  return {
    order: { reference: order.reference, businessName: order.business_name, segment: order.segment,
      lotCode: order.lot_code, paymentStatus: order.status, fulfillmentStatus: order.fulfillment_status,
      planCode: order.plan_code, billingType: order.billing_type },
    profile: profile ? {
      businessName: profile.business_name, description: profile.description || '', logoUrl: profile.logo_url || '',
      facadeUrl: profile.facade_url || '', whatsapp: profile.whatsapp || '', websiteUrl: profile.website_url || '',
      instagramUrl: profile.instagram_url || '', tiktokUrl: profile.tiktok_url || '',
      googleMapsUrl: profile.google_maps_url || '', promotionText: profile.promotion_text || '',
      wantsWebsite: Boolean(profile.wants_website), wantsBrandArt: Boolean(profile.wants_brand_art),
      reviewStatus: profile.review_status, adminNotes: profile.admin_notes || '',
      submittedAt: profile.submitted_at, publishedAt: profile.published_at
    } : null
  };
}

function saveStoreImage(reference, kind, value, currentUrl = '') {
  const text = String(value || '').trim();
  if (!text) return currentUrl || '';
  if (!text.startsWith('data:')) return safeExternalUrl(text) || currentUrl || '';
  const match = text.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('Imagem inválida. Envie JPG, PNG ou WebP.');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 2 * 1024 * 1024) throw new Error('A imagem deve ter no máximo 2 MB.');
  const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
  const safeReference = String(reference).replace(/[^a-zA-Z0-9_-]/g, '');
  const folder = path.join(dataDir, 'store-assets');
  fs.mkdirSync(folder, { recursive: true });
  const filename = `${safeReference}-${kind}-${Date.now()}.${extension}`;
  fs.writeFileSync(path.join(folder, filename), buffer, { mode: 0o640 });
  return `/uploads/store-assets/${filename}`;
}

function storePortalAccess(req, res) {
  const reference = String(req.params.reference || '');
  const token = String(req.query.token || req.body?.token || req.get('x-store-token') || '');
  if (!validStoreManagementToken(reference, token)) {
    res.status(403).json({ error: 'Link de acesso inválido ou incompleto.' });
    return null;
  }
  const order = db.prepare('SELECT * FROM lot_orders WHERE reference=?').get(reference);
  if (!order) {
    res.status(404).json({ error: 'Pedido não encontrado.' });
    return null;
  }
  if (order.status !== 'approved') {
    res.status(409).json({ error: 'O painel será liberado após a confirmação do pagamento.' });
    return null;
  }
  return { order, token };
}

const SMTP_USER = String(process.env.SMTP_USER || '').trim();
const SMTP_PASS = String(process.env.SMTP_PASS || '').trim();
const LOT_ADMIN_EMAIL = String(process.env.LOT_ADMIN_EMAIL || 'agrotecnica362@gmail.com').trim();
const mailTransport = SMTP_USER && SMTP_PASS ? nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT || 465),
  secure: String(process.env.SMTP_SECURE || 'true').toLowerCase() !== 'false',
  auth: { user: SMTP_USER, pass: SMTP_PASS }
}) : null;

async function deliverLotConfirmation(reference) {
  const claimed = db.prepare(`UPDATE lot_orders SET confirmation_status='sending',confirmation_error=NULL,
    fulfillment_status='awaiting_assets',reserved_at=COALESCE(reserved_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP
    WHERE reference=? AND status='approved' AND confirmation_status IN ('pending','failed')`).run(reference);
  if (!claimed.changes) return;
  if (!mailTransport) {
    db.prepare(`UPDATE lot_orders SET confirmation_status='pending',confirmation_error='smtp_not_configured',
      updated_at=CURRENT_TIMESTAMP WHERE reference=?`).run(reference);
    console.warn('Confirmação do lote pendente: configure SMTP_USER e SMTP_PASS.');
    return;
  }
  const order = db.prepare('SELECT * FROM lot_orders WHERE reference=?').get(reference);
  const lot = LOT_CATALOG[order.lot_code] || { label: order.lot_code, place: 'VitrineCity' };
  const mapUrl = `${SITE_URL}/cidade-exploravel.html?lote=${encodeURIComponent(order.lot_code)}`;
  const portalUrl = `${SITE_URL}/painel-lojista.html?ref=${encodeURIComponent(order.reference)}&token=${encodeURIComponent(storeManagementToken(order.reference))}`;
  const replyEmail = LOT_ADMIN_EMAIL || SMTP_USER;
  const customerText = `Olá, ${order.name}!\n\nPagamento aprovado e lote reservado na VitrineCity.\n\n` +
    `Loja: ${order.business_name}\nLote: ${lot.label}\nLocalização: ${lot.place}\nReferência: ${order.reference}\n` +
    `Ver no mapa: ${mapUrl}\nConfigurar minha loja: ${portalUrl}\n\nPróxima etapa: acesse seu painel e envie logotipo, fachada, descrição, WhatsApp, Instagram, TikTok, site, Google Maps e promoção. ` +
    `Nossa equipe revisará o material antes da publicação.\n\nVitrineCity`;
  const customerHtml = `<h2>Seu lote está reservado!</h2><p>Olá, ${escapeHtml(order.name)}.</p>` +
    `<p>Recebemos seu pagamento e reservamos o endereço digital da <strong>${escapeHtml(order.business_name)}</strong>.</p>` +
    `<ul><li><strong>Lote:</strong> ${escapeHtml(lot.label)}</li><li><strong>Localização:</strong> ${escapeHtml(lot.place)}</li>` +
    `<li><strong>Referência:</strong> ${escapeHtml(order.reference)}</li></ul>` +
    `<p><a href="${escapeHtml(mapUrl)}">Ver meu lote no mapa da VitrineCity</a></p>` +
    `<p><a style="display:inline-block;background:#1768e6;color:#fff;text-decoration:none;padding:13px 18px;border-radius:10px;font-weight:bold" href="${escapeHtml(portalUrl)}">Configurar minha loja</a></p>` +
    `<h3>Como colocar sua loja no ar</h3><p>Preencha o painel com logotipo, fachada, descrição, WhatsApp, Instagram, TikTok, site, Google Maps e a promoção do letreiro. Nossa equipe revisará o material antes da publicação.</p>`;
  try {
    await mailTransport.sendMail({
      from: process.env.EMAIL_FROM || `VitrineCity <${SMTP_USER}>`,
      to: order.email,
      replyTo: replyEmail,
      subject: `${lot.label} reservado — VitrineCity`,
      text: customerText,
      html: customerHtml
    });
    if (LOT_ADMIN_EMAIL && LOT_ADMIN_EMAIL.toLowerCase() !== order.email.toLowerCase()) {
      await mailTransport.sendMail({
        from: process.env.EMAIL_FROM || `VitrineCity <${SMTP_USER}>`,
        to: LOT_ADMIN_EMAIL,
        replyTo: order.email,
        subject: `Novo lote aprovado: ${lot.label} — ${order.business_name}`,
        text: `Comprador: ${order.name}\nE-mail: ${order.email}\nWhatsApp: ${order.whatsapp || '-'}\nLoja: ${order.business_name}\nSegmento: ${order.segment}\nLote: ${lot.label}\nReferência: ${order.reference}`
      });
    }
    db.prepare(`UPDATE lot_orders SET confirmation_status='sent',confirmation_sent_at=CURRENT_TIMESTAMP,
      confirmation_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE reference=?`).run(reference);
  } catch (error) {
    db.prepare(`UPDATE lot_orders SET confirmation_status='failed',confirmation_error=?,updated_at=CURRENT_TIMESTAMP
      WHERE reference=?`).run(String(error?.message || 'email_failed').slice(0, 240), reference);
    console.error('Erro ao enviar confirmação do lote', error?.message || 'unknown');
  }
}

function scheduleLotConfirmation(reference) {
  setImmediate(() => { void deliverLotConfirmation(reference); });
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

function internalPixStatus(mpOrder) {
  const status = String(mpOrder?.status || 'unknown');
  const detail = String(mpOrder?.status_detail || '');
  if (status === 'processed' && detail === 'accredited') return 'approved';
  if (status === 'canceled' || status === 'expired') return 'cancelled';
  if (status === 'refunded') return 'refunded';
  if (status === 'charged_back') return 'charged_back';
  if (status === 'failed') return 'failed';
  return 'pending';
}

function updateLotFromPixOrder(mpOrder) {
  const reference = String(mpOrder?.external_reference || '');
  const order = db.prepare('SELECT * FROM lot_orders WHERE reference=?').get(reference);
  if (!order) return null;
  const amountCents = Math.round(Number(mpOrder?.total_amount) * 100);
  if (amountCents !== order.amount_cents) throw new Error('pix_order_amount_mismatch');
  const status = internalPixStatus(mpOrder);
  const mpOrderId = String(mpOrder?.id || order.mp_payment_id || '');
  const statusChanged = order.status !== status;
  db.prepare(`UPDATE lot_orders SET status=?,mp_payment_id=?,
    fulfillment_status=CASE WHEN ?='approved' THEN 'awaiting_assets' ELSE fulfillment_status END,
    reserved_at=CASE WHEN ?='approved' THEN COALESCE(reserved_at,CURRENT_TIMESTAMP) ELSE reserved_at END,
    updated_at=CURRENT_TIMESTAMP WHERE reference=?`)
    .run(status, mpOrderId, status, status, order.reference);
  if (statusChanged) {
    syncAffiliateCommission({ affiliateId: order.affiliate_id, orderType: 'lot', orderReference: order.reference,
      grossAmountCents: order.amount_cents, rateBps: REFERRAL_RATE_BPS, payment: { id: mpOrderId, status } });
    if (status === 'approved') {
      adminAnalytics.recordPurchase(order.reference, 'lot', order.amount_cents);
      scheduleLotConfirmation(order.reference);
    }
  }
  return { ...order, status, mp_payment_id: mpOrderId };
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

app.use(express.json({ limit: '5mb' }));
app.set('trust proxy', 1);
const adminAnalytics = setupAdminAnalytics({ app, db, requireAdmin, publicDir: path.join(dir, 'public') });
app.use('/vendor/three', express.static(path.join(dir, 'node_modules/three/build')));
app.use('/uploads/store-assets', express.static(path.join(dataDir, 'store-assets'), {
  immutable: true, maxAge: '30d', fallthrough: false
}));
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
  adminAnalytics.recordLead(req, String(interest).slice(0, 80));
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
  return res.json({ authenticated: true, user: { name: user.name, email: user.email,
    admin: Boolean(user.is_admin || adminEmails.has(String(user.email).toLowerCase())) }, wallet: publicWallet(user.id) });
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

app.get('/api/lots', (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.json({ holdMinutes: LOT_HOLD_MINUTES, lots: Object.keys(LOT_CATALOG).map(publicLot) });
});

app.post('/api/payments/mercadopago/checkout', async (req, res) => {
  const { name, email, whatsapp = '', businessName, segment, lotCode, consent, planCode = 'founder' } = req.body || {};
  const plan = LOT_PLANS[String(planCode)] || LOT_PLANS.founder;
  if (plan.billingType === 'recurring') return res.status(400).json({ error: 'Use o botão de assinatura para o plano mensal.' });
  if (!consent || typeof name !== 'string' || name.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(email || '') ||
      typeof businessName !== 'string' || businessName.trim().length < 2 || typeof segment !== 'string' || segment.trim().length < 2 ||
      !AVAILABLE_LOTS.has(String(lotCode || ''))) {
    return res.status(400).json({ error: 'Informe a loja, o segmento, um lote disponível e os dados do responsável.' });
  }
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token || !process.env.MERCADOPAGO_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Pagamento temporariamente indisponível.' });
  }
  if (!lotIsAvailable(String(lotCode))) {
    return res.status(409).json({ error: 'Este lote já foi reservado. Escolha outro endereço disponível.' });
  }
  if (!allowAttempt(checkoutAttempts, `lot:${req.ip}`, 5, 10 * 60 * 1000)) {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
  }
  const reference = `lot_${randomUUID()}`;
  const order = {
    name: name.trim().slice(0, 100),
    email: email.trim().toLowerCase().slice(0, 160),
    whatsapp: String(whatsapp).trim().slice(0, 30),
    businessName: businessName.trim().slice(0, 100),
    segment: segment.trim().slice(0, 80),
    lotCode: String(lotCode)
  };
  const affiliate = referralAffiliate(req, order.email);
  try {
    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { ...mpHeaders(), 'X-Idempotency-Key': reference },
      body: JSON.stringify({
        items: [{ id: 'vitrinecity-lote-fundador', title: 'Lote Fundador VitrineCity',
          description: 'Espaço digital para divulgar sua loja na VitrineCity', category_id: 'services',
          quantity: 1, currency_id: 'BRL', unit_price: plan.amountCents / 100 }],
        payer: { name: order.name, email: order.email }, external_reference: reference,
        notification_url: `${SITE_URL}/api/payments/mercadopago/webhook`,
        back_urls: {
          success: `${SITE_URL}/pagamento.html?resultado=sucesso`,
          pending: `${SITE_URL}/pagamento.html?resultado=pendente`,
          failure: `${SITE_URL}/pagamento.html?resultado=falha`
        },
        auto_return: 'approved', statement_descriptor: 'VITRINECITY',
        metadata: { product: 'founder_lot', lot_code: order.lotCode, business_name: order.businessName,
          segment: order.segment, customer_whatsapp: order.whatsapp, plan_code: plan.code, affiliate_code: affiliate?.code || '' }
      }), signal: AbortSignal.timeout(12000)
    });
    const data = await response.json();
    if (!response.ok || !data.id || !data.init_point) {
      console.error('Mercado Pago preference error', response.status, data?.message || 'unknown');
      return res.status(502).json({ error: 'Não foi possível iniciar o pagamento agora.' });
    }
    db.prepare(`INSERT INTO lot_orders
      (reference,name,email,whatsapp,lot_code,business_name,segment,amount_cents,affiliate_id,status,mp_preference_id,plan_code,billing_type)
      VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?,?)`).run(reference, order.name, order.email, order.whatsapp,
      order.lotCode, order.businessName, order.segment, plan.amountCents, affiliate?.id || null, data.id, plan.code, plan.billingType);
    adminAnalytics.recordOrderAttribution(req, reference, 'lot');
    adminAnalytics.recordCheckout(req, reference, 'lot', plan.amountCents);
    return res.status(201).json({ checkoutUrl: data.init_point, reference, manageToken: storeManagementToken(reference) });
  } catch (error) {
    console.error('Mercado Pago unavailable', error?.message || 'unknown');
    return res.status(502).json({ error: 'Não foi possível conectar ao Mercado Pago agora.' });
  }
});

app.post('/api/payments/mercadopago/subscription', async (req, res) => {
  const { name, email, whatsapp = '', businessName, segment, lotCode, consent } = req.body || {};
  const plan = LOT_PLANS.basic_monthly;
  if (!consent || typeof name !== 'string' || name.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(email || '') ||
      typeof businessName !== 'string' || businessName.trim().length < 2 || typeof segment !== 'string' || segment.trim().length < 2 ||
      !AVAILABLE_LOTS.has(String(lotCode || ''))) {
    return res.status(400).json({ error: 'Informe corretamente os dados da loja para iniciar a assinatura.' });
  }
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token || !process.env.MERCADOPAGO_WEBHOOK_SECRET || !managementSecret()) {
    return res.status(503).json({ error: 'A assinatura ainda não está disponível no servidor.' });
  }
  if (!lotIsAvailable(String(lotCode))) return res.status(409).json({ error: 'Este prédio já foi reservado.' });
  if (!allowAttempt(checkoutAttempts, `subscription:${req.ip}`, 5, 10 * 60 * 1000)) {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
  }
  const reference = `sub_${randomUUID()}`;
  const order = { name: name.trim().slice(0, 100), email: email.trim().toLowerCase().slice(0, 160),
    whatsapp: String(whatsapp).trim().slice(0, 30), businessName: businessName.trim().slice(0, 100),
    segment: segment.trim().slice(0, 80), lotCode: String(lotCode) };
  const affiliate = referralAffiliate(req, order.email);
  try {
    const response = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST', headers: { ...mpHeaders(), 'X-Idempotency-Key': reference },
      body: JSON.stringify({ reason: `${plan.name} — ${order.businessName}`, external_reference: reference,
        payer_email: order.email, back_url: `${SITE_URL}/pagamento.html?resultado=pendente&ref=${encodeURIComponent(reference)}`,
        auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: plan.amountCents / 100,
          currency_id: 'BRL' }, status: 'pending' }), signal: AbortSignal.timeout(12000)
    });
    const data = await response.json();
    if (!response.ok || !data.id || !data.init_point) {
      console.error('Mercado Pago subscription error', response.status, data?.message || 'unknown');
      return res.status(502).json({ error: 'Não foi possível iniciar a assinatura agora.' });
    }
    db.prepare(`INSERT INTO lot_orders
      (reference,name,email,whatsapp,lot_code,business_name,segment,amount_cents,affiliate_id,status,
       mp_subscription_id,plan_code,billing_type)
      VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?,?)`).run(reference, order.name, order.email, order.whatsapp,
      order.lotCode, order.businessName, order.segment, plan.amountCents, affiliate?.id || null,
      String(data.id), plan.code, plan.billingType);
    adminAnalytics.recordOrderAttribution(req, reference, 'lot_subscription');
    adminAnalytics.recordCheckout(req, reference, 'lot_subscription', plan.amountCents);
    return res.status(201).json({ checkoutUrl: data.init_point, reference, manageToken: storeManagementToken(reference) });
  } catch (error) {
    console.error('Mercado Pago subscription unavailable', error?.message || 'unknown');
    return res.status(502).json({ error: 'Não foi possível conectar ao serviço de assinatura.' });
  }
});

app.post('/api/payments/mercadopago/pix', async (req, res) => {
  const { name, email, whatsapp = '', businessName, segment, lotCode, consent, planCode = 'founder' } = req.body || {};
  if (planCode === 'basic_monthly') return res.status(400).json({ error: 'A assinatura mensal deve ser feita pelo botão de assinatura.' });
  if (!consent || typeof name !== 'string' || name.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(email || '') ||
      typeof businessName !== 'string' || businessName.trim().length < 2 || typeof segment !== 'string' || segment.trim().length < 2 ||
      !AVAILABLE_LOTS.has(String(lotCode || ''))) {
    return res.status(400).json({ error: 'Informe corretamente os dados da vitrine para gerar o Pix.' });
  }
  if (!pixAccessToken()) {
    return res.status(503).json({ error: 'O Pix ainda não foi configurado no servidor.' });
  }
  if (!lotIsAvailable(String(lotCode))) {
    return res.status(409).json({ error: 'Este lote já foi reservado. Escolha outro endereço disponível.' });
  }
  if (!allowAttempt(checkoutAttempts, `lot-pix:${req.ip}`, 5, 10 * 60 * 1000)) {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
  }
  const reference = `lot_${randomUUID()}`;
  const cleanName = name.trim().slice(0, 100);
  const order = {
    name: cleanName,
    email: email.trim().toLowerCase().slice(0, 160),
    whatsapp: String(whatsapp).trim().slice(0, 30),
    businessName: businessName.trim().slice(0, 100),
    segment: segment.trim().slice(0, 80),
    lotCode: String(lotCode)
  };
  const affiliate = referralAffiliate(req, order.email);
  db.prepare(`INSERT INTO lot_orders
    (reference,name,email,whatsapp,lot_code,business_name,segment,amount_cents,affiliate_id,status)
    VALUES (?,?,?,?,?,?,?,?,?,'created')`).run(reference, order.name, order.email, order.whatsapp,
    order.lotCode, order.businessName, order.segment, LOT_PRICE_CENTS, affiliate?.id || null);
  adminAnalytics.recordOrderAttribution(req, reference, 'lot');
  adminAnalytics.recordCheckout(req, reference, 'lot', LOT_PRICE_CENTS);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  try {
    const response = await fetch('https://api.mercadopago.com/v1/orders', {
      method: 'POST',
      headers: { ...pixHeaders(), 'X-Idempotency-Key': reference },
      body: JSON.stringify({
        type: 'online',
        total_amount: (LOT_PRICE_CENTS / 100).toFixed(2),
        external_reference: reference,
        processing_mode: 'automatic',
        payer: { email: order.email },
        transactions: {
          payments: [{
            amount: (LOT_PRICE_CENTS / 100).toFixed(2),
            payment_method: { id: 'pix', type: 'bank_transfer' },
            expiration_time: 'PT30M'
          }]
        }
      }),
      signal: AbortSignal.timeout(12000)
    });
    const data = await response.json();
    const paymentMethod = data?.transactions?.payments?.[0]?.payment_method;
    if (!response.ok || !data.id || !paymentMethod?.qr_code) {
      db.prepare("UPDATE lot_orders SET status='failed',updated_at=CURRENT_TIMESTAMP WHERE reference=?").run(reference);
      console.error('Mercado Pago Pix Orders error', response.status, data?.message || data?.error || 'pix_unavailable');
      if (response.status === 401 || response.status === 403) {
        return res.status(409).json({ error: 'A credencial do Pix não está autorizada. Confira o Access Token do Checkout Transparente.' });
      }
      return res.status(response.status === 400 ? 409 : 502).json({ error:
        data?.message ? `Mercado Pago recusou o Pix: ${String(data.message).slice(0, 140)}` : 'Não foi possível gerar o Pix agora.' });
    }
    db.prepare("UPDATE lot_orders SET status=?,mp_payment_id=?,updated_at=CURRENT_TIMESTAMP WHERE reference=?")
      .run('pending', String(data.id), reference);
    return res.status(201).json({ reference, status: 'pending', manageToken: storeManagementToken(reference),
      qrCode: paymentMethod.qr_code, qrCodeBase64: paymentMethod.qr_code_base64 || '',
      ticketUrl: paymentMethod.ticket_url || '', expiresAt });
  } catch (error) {
    db.prepare("UPDATE lot_orders SET status='failed',updated_at=CURRENT_TIMESTAMP WHERE reference=?").run(reference);
    console.error('Mercado Pago Pix unavailable', error?.message || 'unknown');
    return res.status(502).json({ error: 'Não foi possível conectar ao Pix agora.' });
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
  adminAnalytics.recordOrderAttribution(req, reference, 'credits');
  adminAnalytics.recordCheckout(req, reference, 'credits', CREDIT_PACKAGE.amountCents);
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
  adminAnalytics.recordOrderAttribution(req, reference, 'course');
  adminAnalytics.recordCheckout(req, reference, 'course', course.priceCents);
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
  adminAnalytics.recordOrderAttribution(req, reference, 'video_package');
  adminAnalytics.recordCheckout(req, reference, 'video_package', VIDEO_PACKAGE.amountCents);
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

function validMercadoPagoSignature(req, dataId, secret = process.env.MERCADOPAGO_WEBHOOK_SECRET) {
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
  // A assinatura do Mercado Pago é calculada com o data.id da URL. O corpo
  // normalmente contém o mesmo valor, mas não deve ter prioridade aqui.
  const dataId = req.query['data.id'] || req.body?.data?.id;
  const eventType = String(req.body?.type || req.query.type || req.body?.topic || req.query.topic || '');
  const isOrderEvent = eventType === 'order' || eventType === 'orders';
  const isSubscriptionEvent = ['subscription_preapproval', 'preapproval'].includes(eventType);
  // O mesmo endpoint atende mais de uma aplicação do Mercado Pago. Cada
  // aplicação possui sua própria assinatura secreta, inclusive quando ambas
  // enviam eventos do tipo payment. A notificação continua sendo aceita
  // somente quando o HMAC confere com uma das chaves configuradas.
  const webhookSecrets = [
    process.env.MERCADOPAGO_WEBHOOK_SECRET,
    process.env.MERCADOPAGO_PIX_WEBHOOK_SECRET
  ].map(value => String(value || '').trim()).filter((value, index, values) => value && values.indexOf(value) === index);
  if (!webhookSecrets.some(secret => validMercadoPagoSignature(req, dataId, secret))) return res.sendStatus(401);
  try {
    if (isOrderEvent) {
      if (!pixAccessToken()) return res.sendStatus(503);
      const response = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(dataId)}`, {
        headers: pixHeaders(), signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) return res.sendStatus(502);
      updateLotFromPixOrder(await response.json());
      return res.sendStatus(200);
    }
    if (isSubscriptionEvent) {
      const response = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(dataId)}`, {
        headers: mpHeaders(), signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) return res.sendStatus(502);
      const subscription = await response.json();
      const reference = String(subscription.external_reference || '');
      const order = db.prepare("SELECT * FROM lot_orders WHERE reference=? AND billing_type='recurring'").get(reference);
      if (!order) return res.sendStatus(200);
      const mappedStatus = subscription.status === 'authorized' ? 'approved' :
        subscription.status === 'cancelled' ? 'cancelled' :
        subscription.status === 'paused' ? 'paused' : 'pending';
      db.prepare(`UPDATE lot_orders SET status=?,mp_subscription_id=?,
        fulfillment_status=CASE WHEN ?='approved' THEN 'awaiting_assets' ELSE fulfillment_status END,
        reserved_at=CASE WHEN ?='approved' THEN COALESCE(reserved_at,CURRENT_TIMESTAMP) ELSE reserved_at END,
        updated_at=CURRENT_TIMESTAMP WHERE reference=?`)
        .run(mappedStatus, String(subscription.id || dataId), mappedStatus, mappedStatus, reference);
      if (mappedStatus === 'approved' && order.status !== 'approved') {
        adminAnalytics.recordPurchase(reference, 'lot_subscription', order.amount_cents);
        scheduleLotConfirmation(reference);
      }
      return res.sendStatus(200);
    }
    if (eventType !== 'payment') return res.sendStatus(200);
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
      if (String(payment.status) === 'approved') adminAnalytics.recordPurchase(order.reference, 'credits', order.amount_cents);
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
        grossAmountCents: order.amount_cents, rateBps: COURSE_REFERRAL_RATE_BPS, payment });
      if (status === 'approved') adminAnalytics.recordPurchase(order.reference, 'course', order.amount_cents);
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
      if (status === 'approved') adminAnalytics.recordPurchase(order.reference, 'video_package', order.amount_cents);
      return res.sendStatus(200);
    }
    const order = db.prepare('SELECT * FROM lot_orders WHERE reference=?').get(reference);
    if (!order) return res.sendStatus(200);
    if (amountCents !== order.amount_cents || payment.currency_id !== 'BRL') return res.sendStatus(400);
    const status = String(payment.status || 'unknown');
    db.prepare(`UPDATE lot_orders SET status=?,mp_payment_id=?,
      fulfillment_status=CASE WHEN ?='approved' THEN 'awaiting_assets' ELSE fulfillment_status END,
      reserved_at=CASE WHEN ?='approved' THEN COALESCE(reserved_at,CURRENT_TIMESTAMP) ELSE reserved_at END,
      updated_at=CURRENT_TIMESTAMP WHERE reference=?`)
      .run(status, String(payment.id), status, status, order.reference);
    syncAffiliateCommission({ affiliateId: order.affiliate_id, orderType: 'lot', orderReference: order.reference,
      grossAmountCents: order.amount_cents, rateBps: REFERRAL_RATE_BPS, payment });
    if (status === 'approved') {
      adminAnalytics.recordPurchase(order.reference, 'lot', order.amount_cents);
      scheduleLotConfirmation(order.reference);
    }
    return res.sendStatus(200);
  } catch (error) {
    console.error('Mercado Pago webhook error', error?.message || 'unknown');
    return res.sendStatus(502);
  }
});

app.get('/api/orders/:reference', async (req, res) => {
  let order = db.prepare('SELECT * FROM lot_orders WHERE reference=?').get(req.params.reference);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (order.billing_type === 'recurring' && order.status === 'pending' && order.mp_subscription_id) {
    try {
      const response = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(order.mp_subscription_id)}`, {
        headers: mpHeaders(), signal: AbortSignal.timeout(8000)
      });
      if (response.ok) {
        const subscription = await response.json();
        const status = subscription.status === 'authorized' ? 'approved' :
          subscription.status === 'cancelled' ? 'cancelled' :
          subscription.status === 'paused' ? 'paused' : 'pending';
        db.prepare(`UPDATE lot_orders SET status=?,fulfillment_status=CASE WHEN ?='approved' THEN 'awaiting_assets'
          ELSE fulfillment_status END,reserved_at=CASE WHEN ?='approved' THEN COALESCE(reserved_at,CURRENT_TIMESTAMP)
          ELSE reserved_at END,updated_at=CURRENT_TIMESTAMP WHERE reference=?`)
          .run(status, status, status, order.reference);
        order = db.prepare('SELECT * FROM lot_orders WHERE reference=?').get(order.reference);
      }
    } catch (error) {
      console.error('Mercado Pago subscription status unavailable', error?.message || 'unknown');
    }
  }
  if (order.status === 'pending' && String(order.mp_payment_id || '').startsWith('ORD') && pixAccessToken()) {
    try {
      const response = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(order.mp_payment_id)}`, {
        headers: pixHeaders(), signal: AbortSignal.timeout(8000)
      });
      if (response.ok) order = updateLotFromPixOrder(await response.json()) || order;
    } catch (error) {
      console.error('Mercado Pago Pix status unavailable', error?.message || 'unknown');
    }
  }
  if (order.status === 'approved' && order.confirmation_status !== 'sent') scheduleLotConfirmation(order.reference);
  const lot = LOT_CATALOG[order.lot_code] || { code: order.lot_code, label: order.lot_code, place: 'VitrineCity' };
  return res.json({
    reference: order.reference,
    status: order.status,
    businessName: order.business_name,
    segment: order.segment,
    lot: { ...lot, mapUrl: `${SITE_URL}/cidade-exploravel.html?lote=${encodeURIComponent(order.lot_code || '')}` },
    fulfillmentStatus: order.fulfillment_status,
    confirmationStatus: order.confirmation_status,
    billingType: order.billing_type,
    planCode: order.plan_code,
    manageToken: order.status === 'approved' ? storeManagementToken(order.reference) : '',
    created_at: order.created_at,
    updated_at: order.updated_at
  });
});

app.get('/api/store-portal/:reference', (req, res) => {
  const access = storePortalAccess(req, res);
  if (!access) return;
  return res.json(publicStoreProfile(access.order.reference));
});

app.put('/api/store-portal/:reference', async (req, res) => {
  const access = storePortalAccess(req, res);
  if (!access) return;
  const body = req.body || {};
  const businessName = String(body.businessName || '').trim().slice(0, 100);
  if (businessName.length < 2) return res.status(400).json({ error: 'Informe o nome da loja.' });
  const current = db.prepare('SELECT * FROM store_profiles WHERE order_reference=?').get(access.order.reference);
  let logoUrl;
  let facadeUrl;
  try {
    logoUrl = saveStoreImage(access.order.reference, 'logo', body.logo, current?.logo_url);
    facadeUrl = saveStoreImage(access.order.reference, 'facade', body.facade, current?.facade_url);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  const values = {
    description: String(body.description || '').trim().slice(0, 1200),
    whatsapp: String(body.whatsapp || '').trim().slice(0, 30),
    websiteUrl: safeExternalUrl(body.websiteUrl), instagramUrl: safeExternalUrl(body.instagramUrl),
    tiktokUrl: safeExternalUrl(body.tiktokUrl), googleMapsUrl: safeExternalUrl(body.googleMapsUrl),
    promotionText: String(body.promotionText || '').trim().slice(0, 120),
    wantsWebsite: body.wantsWebsite ? 1 : 0, wantsBrandArt: body.wantsBrandArt ? 1 : 0
  };
  db.prepare(`INSERT INTO store_profiles
    (order_reference,business_name,description,logo_url,facade_url,whatsapp,website_url,instagram_url,
     tiktok_url,google_maps_url,promotion_text,wants_website,wants_brand_art,review_status,submitted_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',CURRENT_TIMESTAMP)
    ON CONFLICT(order_reference) DO UPDATE SET business_name=excluded.business_name,
      description=excluded.description,logo_url=excluded.logo_url,facade_url=excluded.facade_url,
      whatsapp=excluded.whatsapp,website_url=excluded.website_url,instagram_url=excluded.instagram_url,
      tiktok_url=excluded.tiktok_url,google_maps_url=excluded.google_maps_url,
      promotion_text=excluded.promotion_text,wants_website=excluded.wants_website,
      wants_brand_art=excluded.wants_brand_art,review_status='pending',admin_notes=NULL,
      submitted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`)
    .run(access.order.reference, businessName, values.description, logoUrl, facadeUrl, values.whatsapp,
      values.websiteUrl, values.instagramUrl, values.tiktokUrl, values.googleMapsUrl, values.promotionText,
      values.wantsWebsite, values.wantsBrandArt);
  db.prepare(`UPDATE lot_orders SET business_name=?,whatsapp=?,fulfillment_status='pending_review',
    updated_at=CURRENT_TIMESTAMP WHERE reference=?`).run(businessName, values.whatsapp, access.order.reference);
  if (mailTransport) {
    mailTransport.sendMail({ from: process.env.EMAIL_FROM || SMTP_USER, to: LOT_ADMIN_EMAIL,
      subject: `Vitrine pendente de aprovação: ${businessName}`,
      text: `A loja ${businessName} enviou os dados do prédio ${access.order.lot_code}. Acesse ${SITE_URL}/admin.html para revisar.`
    }).catch(error => console.error('Store review email error', error?.message || 'unknown'));
  }
  return res.json({ ok: true, message: 'Dados enviados para aprovação.', ...publicStoreProfile(access.order.reference) });
});

app.post('/api/store-portal/:reference/cancel-subscription', async (req, res) => {
  const access = storePortalAccess(req, res);
  if (!access) return;
  if (access.order.billing_type !== 'recurring' || !access.order.mp_subscription_id) {
    return res.status(409).json({ error: 'Este pedido não possui assinatura recorrente.' });
  }
  try {
    const response = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(access.order.mp_subscription_id)}`, {
      method: 'PUT', headers: mpHeaders(), body: JSON.stringify({ status: 'cancelled' }),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`status_${response.status}`);
    db.prepare("UPDATE lot_orders SET status='cancelled',fulfillment_status='subscription_cancelled',updated_at=CURRENT_TIMESTAMP WHERE reference=?")
      .run(access.order.reference);
    return res.json({ ok: true, message: 'Assinatura cancelada. Não haverá nova cobrança.' });
  } catch (error) {
    console.error('Subscription cancellation error', error?.message || 'unknown');
    return res.status(502).json({ error: 'Não foi possível cancelar automaticamente. Fale com o suporte.' });
  }
});

app.get('/api/admin/store-submissions', requireAdmin, (req, res) => {
  const status = String(req.query.status || '').trim();
  const rows = db.prepare(`SELECT p.*,o.email,o.name AS customer_name,o.lot_code,o.segment,o.plan_code,o.billing_type
    FROM store_profiles p JOIN lot_orders o ON o.reference=p.order_reference
    WHERE (?='' OR p.review_status=?) ORDER BY COALESCE(p.submitted_at,p.created_at) DESC LIMIT 200`).all(status, status);
  return res.json({ submissions: rows });
});

app.patch('/api/admin/store-submissions/:reference', requireAdmin, async (req, res) => {
  const action = String(req.body?.action || '');
  if (!['approve', 'request_changes', 'publish'].includes(action)) return res.status(400).json({ error: 'Ação inválida.' });
  const profile = db.prepare(`SELECT p.*,o.email,o.lot_code FROM store_profiles p JOIN lot_orders o
    ON o.reference=p.order_reference WHERE p.order_reference=?`).get(req.params.reference);
  if (!profile) return res.status(404).json({ error: 'Loja não encontrada.' });
  const reviewStatus = action === 'approve' ? 'approved' : action === 'publish' ? 'published' : 'changes_requested';
  const fulfillmentStatus = action === 'publish' ? 'published' : action === 'approve' ? 'approved' : 'changes_requested';
  const notes = String(req.body?.notes || '').trim().slice(0, 1000);
  db.prepare(`UPDATE store_profiles SET review_status=?,admin_notes=?,reviewed_at=CURRENT_TIMESTAMP,
    published_at=CASE WHEN ?='published' THEN CURRENT_TIMESTAMP ELSE published_at END,updated_at=CURRENT_TIMESTAMP
    WHERE order_reference=?`).run(reviewStatus, notes, reviewStatus, profile.order_reference);
  db.prepare('UPDATE lot_orders SET fulfillment_status=?,updated_at=CURRENT_TIMESTAMP WHERE reference=?')
    .run(fulfillmentStatus, profile.order_reference);
  if (mailTransport) {
    const portalUrl = `${SITE_URL}/painel-lojista.html?ref=${encodeURIComponent(profile.order_reference)}&token=${encodeURIComponent(storeManagementToken(profile.order_reference))}`;
    const label = reviewStatus === 'published' ? 'publicada' : reviewStatus === 'approved' ? 'aprovada' : 'devolvida para ajustes';
    mailTransport.sendMail({ from: process.env.EMAIL_FROM || SMTP_USER, to: profile.email,
      subject: `Sua loja foi ${label} na VitrineCity`,
      text: `Olá! Sua loja ${profile.business_name} foi ${label}. ${notes ? `Observação: ${notes}\n` : ''}Acompanhe em ${portalUrl}`
    }).catch(error => console.error('Store decision email error', error?.message || 'unknown'));
  }
  return res.json({ ok: true, status: reviewStatus });
});

app.get('/api/public/stores/:reference', (req, res) => {
  const data = publicStoreProfile(req.params.reference);
  if (!data?.profile || data.profile.reviewStatus !== 'published') return res.status(404).json({ error: 'Loja não publicada.' });
  return res.json(data);
});

app.post('/api/admin/lot-orders/:reference/resend-confirmation', requireAdmin, (req, res) => {
  const order = db.prepare('SELECT reference,status FROM lot_orders WHERE reference=?').get(req.params.reference);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (order.status !== 'approved') return res.status(409).json({ error: 'O pagamento ainda não foi aprovado.' });
  db.prepare(`UPDATE lot_orders SET confirmation_status='pending',confirmation_error=NULL WHERE reference=?`)
    .run(order.reference);
  scheduleLotConfirmation(order.reference);
  return res.status(202).json({ ok: true, message: 'Reenvio solicitado.' });
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

app.get('/api/my-courses/:slug/progress', requireUser, (req, res) => {
  const slug = String(req.params.slug || '');
  if (!COURSES[slug] || !originalCourse(slug)) return res.status(404).json({ error: 'Curso não encontrado.' });
  if (!activeEnrollment(req.user.id, slug)) return res.status(403).json({ error: 'Acesso disponível somente para alunos matriculados.' });
  return res.json(courseProgress(req.user.id, slug));
});

app.post('/api/my-courses/:slug/progress', requireUser, (req, res) => {
  const slug = String(req.params.slug || '');
  const course = originalCourse(slug);
  const lessonSlug = String(req.body?.lessonSlug || '');
  if (!COURSES[slug] || !course) return res.status(404).json({ error: 'Curso não encontrado.' });
  if (!activeEnrollment(req.user.id, slug)) return res.status(403).json({ error: 'Acesso disponível somente para alunos matriculados.' });
  if (!course.lessons.some(item => item.slug === lessonSlug)) return res.status(400).json({ error: 'Aula inválida.' });
  if (req.body?.completed === false) {
    db.prepare('DELETE FROM course_progress WHERE user_id=? AND course_slug=? AND lesson_slug=?')
      .run(req.user.id, slug, lessonSlug);
  } else {
    db.prepare(`INSERT INTO course_progress (user_id,course_slug,lesson_slug) VALUES (?,?,?)
      ON CONFLICT(user_id,course_slug,lesson_slug) DO UPDATE SET completed_at=CURRENT_TIMESTAMP`)
      .run(req.user.id, slug, lessonSlug);
  }
  return res.json(courseProgress(req.user.id, slug));
});

app.post('/api/my-courses/:slug/certificate', requireUser, (req, res) => {
  const slug = String(req.params.slug || '');
  if (!COURSES[slug] || !originalCourse(slug)) return res.status(404).json({ error: 'Curso não encontrado.' });
  if (!activeEnrollment(req.user.id, slug)) return res.status(403).json({ error: 'Acesso disponível somente para alunos matriculados.' });
  const progress = courseProgress(req.user.id, slug);
  if (!progress.certificateEligible) return res.status(409).json({ error: 'Conclua todas as aulas para emitir o certificado.' });
  let certificate = progress.certificate;
  if (!certificate) {
    for (let attempt = 0; attempt < 5 && !certificate; attempt += 1) {
      const code = `VC-${randomBytes(6).toString('hex').toUpperCase()}`;
      try {
        db.prepare('INSERT INTO course_certificates (user_id,course_slug,verification_code) VALUES (?,?,?)')
          .run(req.user.id, slug, code);
        certificate = db.prepare(`SELECT verification_code,issued_at FROM course_certificates
          WHERE user_id=? AND course_slug=?`).get(req.user.id, slug);
      } catch (error) {
        if (!String(error?.message || '').includes('UNIQUE')) throw error;
        certificate = db.prepare(`SELECT verification_code,issued_at FROM course_certificates
          WHERE user_id=? AND course_slug=?`).get(req.user.id, slug) || null;
      }
    }
  }
  if (!certificate) return res.status(500).json({ error: 'Não foi possível emitir o certificado agora.' });
  return res.json({
    holderName: req.user.name,
    courseTitle: COURSES[slug].title,
    courseSlug: slug,
    totalLessons: progress.totalLessons,
    verificationCode: certificate.verification_code,
    issuedAt: certificate.issued_at,
    verificationUrl: `${SITE_URL}/validar-certificado.html?codigo=${encodeURIComponent(certificate.verification_code)}`
  });
});

app.get('/api/certificates/:code', (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const certificate = db.prepare(`SELECT c.verification_code,c.issued_at,c.course_slug,u.name
    FROM course_certificates c JOIN users u ON u.id=c.user_id WHERE c.verification_code=?`).get(code);
  if (!certificate || !COURSES[certificate.course_slug]) return res.status(404).json({ valid: false, error: 'Certificado não encontrado.' });
  return res.json({ valid: true, holderName: certificate.name, courseTitle: COURSES[certificate.course_slug].title,
    issuedAt: certificate.issued_at, verificationCode: certificate.verification_code });
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
  return res.status(configured ? 200 : 503).json({ ok: configured, configured,
    pixConfigured: Boolean(pixAccessToken()), mode: 'production' });
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.listen(process.env.PORT || 3000, () => console.log('VitrineCity online'));
