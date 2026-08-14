import express from 'express';
import Database from 'better-sqlite3';
import path from 'node:path';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const app = express();
const dir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || '/data';
const db = new Database(path.join(dataDir, 'vitrinecity.db'));
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, whatsapp TEXT,
  interest TEXT, consent INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);
db.exec(`CREATE TABLE IF NOT EXISTS lot_orders (
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
)`);

const SITE_URL = process.env.SITE_URL || 'https://vitrinecity.com';
const LOT_PRICE_CENTS = 1500;
const mpHeaders = () => ({
  Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
  'Content-Type': 'application/json'
});
const checkoutAttempts = new Map();

app.use(express.json({ limit: '30kb' }));
app.set('trust proxy', 1);
app.use('/vendor/three', express.static(path.join(dir, 'node_modules/three/build')));
app.use(express.static(path.join(dir, 'public'), { extensions: ['html'] }));
app.post('/api/leads', (req, res) => {
  const { name, email, whatsapp = '', interest = '', consent } = req.body || {};
  if (!consent || typeof name !== 'string' || name.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(email || '')) {
    return res.status(400).json({ error: 'Informe nome, e-mail válido e aceite o recebimento de novidades.' });
  }
  db.prepare('INSERT INTO leads (name,email,whatsapp,interest,consent) VALUES (?,?,?,?,1)').run(name.trim().slice(0,100), email.trim().toLowerCase().slice(0,160), String(whatsapp).slice(0,30), String(interest).slice(0,80));
  res.status(201).json({ ok: true });
});

app.post('/api/payments/mercadopago/checkout', async (req, res) => {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token || !process.env.MERCADOPAGO_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Pagamento temporariamente indisponível.' });
  }
  const now = Date.now();
  const recent = (checkoutAttempts.get(req.ip) || []).filter(time => now - time < 10 * 60 * 1000);
  if (recent.length >= 5) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
  checkoutAttempts.set(req.ip, [...recent, now]);
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
        items: [{
          id: 'vitrinecity-lote-fundador',
          title: 'Lote Fundador VitrineCity',
          description: 'Espaço digital para divulgar sua loja na VitrineCity',
          category_id: 'services',
          quantity: 1,
          currency_id: 'BRL',
          unit_price: LOT_PRICE_CENTS / 100
        }],
        payer: { name: order.name, email: order.email },
        external_reference: reference,
        notification_url: `${SITE_URL}/api/payments/mercadopago/webhook`,
        back_urls: {
          success: `${SITE_URL}/pagamento.html?resultado=sucesso`,
          pending: `${SITE_URL}/pagamento.html?resultado=pendente`,
          failure: `${SITE_URL}/pagamento.html?resultado=falha`
        },
        auto_return: 'approved',
        statement_descriptor: 'VITRINECITY',
        metadata: { product: 'founder_lot', customer_whatsapp: order.whatsapp }
      }),
      signal: AbortSignal.timeout(12000)
    });
    const data = await response.json();
    if (!response.ok || !data.id || !data.init_point) {
      console.error('Mercado Pago preference error', response.status, data?.message || 'unknown');
      return res.status(502).json({ error: 'Não foi possível iniciar o pagamento agora.' });
    }
    db.prepare(`INSERT INTO lot_orders
      (reference,name,email,whatsapp,amount_cents,status,mp_preference_id)
      VALUES (?,?,?,?,?,'pending',?)`).run(
      reference, order.name, order.email, order.whatsapp, LOT_PRICE_CENTS, data.id
    );
    return res.status(201).json({ checkoutUrl: data.init_point });
  } catch (error) {
    console.error('Mercado Pago unavailable', error?.message || 'unknown');
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
  if (expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

app.post('/api/payments/mercadopago/webhook', async (req, res) => {
  const dataId = req.body?.data?.id || req.query['data.id'];
  if (!validMercadoPagoSignature(req, dataId)) return res.sendStatus(401);
  if (req.body?.type !== 'payment' && req.query.type !== 'payment') return res.sendStatus(200);
  try {
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(dataId)}`, {
      headers: mpHeaders(),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return res.sendStatus(502);
    const payment = await response.json();
    const order = db.prepare('SELECT * FROM lot_orders WHERE reference = ?').get(payment.external_reference);
    if (!order) return res.sendStatus(200);
    const amountCents = Math.round(Number(payment.transaction_amount) * 100);
    if (amountCents !== order.amount_cents || payment.currency_id !== 'BRL') return res.sendStatus(400);
    db.prepare(`UPDATE lot_orders SET status=?, mp_payment_id=?, updated_at=CURRENT_TIMESTAMP
      WHERE reference=?`).run(String(payment.status || 'unknown'), String(payment.id), order.reference);
    return res.sendStatus(200);
  } catch {
    return res.sendStatus(502);
  }
});

app.get('/api/orders/:reference', (req, res) => {
  const order = db.prepare('SELECT reference,status,created_at,updated_at FROM lot_orders WHERE reference = ?').get(req.params.reference);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  return res.json(order);
});

app.get('/api/payments/mercadopago/status', async (_req, res) => {
  if (!process.env.MERCADOPAGO_ACCESS_TOKEN) return res.status(503).json({ ok: false, configured: false });
  try {
    const response = await fetch('https://api.mercadolibre.com/users/me', {
      headers: mpHeaders(), signal: AbortSignal.timeout(8000)
    });
    return response.ok
      ? res.json({ ok: true, configured: true, mode: 'production' })
      : res.status(502).json({ ok: false, configured: true, mercadoPagoStatus: response.status });
  } catch {
    return res.status(502).json({ ok: false, configured: true });
  }
});
// Verifica a conexão com o Asaas sem criar qualquer cobrança nem retornar dados sensíveis.
app.get('/api/payments/asaas/status', async (_req, res) => {
  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) return res.status(503).json({ ok: false, configured: false, message: 'Chave de pagamento não configurada.' });
  try {
    const response = await fetch('https://api.asaas.com/v3/myAccount', {
      headers: {
        access_token: apiKey,
        accept: 'application/json',
        'User-Agent': 'VitrineCity/1.0'
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        configured: true,
        asaasStatus: response.status,
        message: 'Não foi possível validar a conexão com o Asaas.'
      });
    }
    return res.json({ ok: true, configured: true, mode: process.env.ASAAS_ENV || 'production' });
  } catch {
    return res.status(502).json({ ok: false, configured: true, message: 'Não foi possível conectar ao Asaas agora.' });
  }
});
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.listen(process.env.PORT || 3000, () => console.log('VitrineCity online'));
