import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import express from 'express';
import Database from 'better-sqlite3';

const source = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
function extract(start, end) {
  const begin = source.indexOf(start), finish = source.indexOf(end, begin + start.length);
  assert.ok(begin >= 0 && finish > begin, `Missing server fixture: ${start}`);
  return source.slice(begin, finish);
}
const enrollmentFunction = extract('function activeEnrollment(', '\nfunction courseProgress(');
const authFunction = extract('function requireUser(', '\nfunction lotOccupation(');
const checkoutRoute = extract("app.post('/api/courses/:slug/checkout',", '\nconst buyCourseWithCoins =');
const orderSchema = extract('CREATE TABLE IF NOT EXISTS course_orders (', 'CREATE TABLE IF NOT EXISTS managed_courses (');

async function fixture(t, { configured = true } = {}) {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY); CREATE TABLE affiliates(id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1),(2),(3);');
  db.exec(orderSchema);
  const courses = new Map([
    ['canva-para-lojas', { slug: 'canva-para-lojas', title: 'Canva para Lojas', priceCents: 2399, status: 'active' }],
    ['outro-curso', { slug: 'outro-curso', title: 'Outro curso', priceCents: 1799, status: 'active' }],
    ['pausado', { slug: 'pausado', title: 'Pausado', priceCents: 2399, status: 'paused' }],
    ['preparacao', { slug: 'preparacao', title: 'Preparação', priceCents: 2399, status: 'active' }]
  ]);
  const calls = { provider: [], consent: [], checkout: [], attribution: [], capture: [] };
  const users = new Map([1, 2, 3].map(id => [String(id), {
    id, name: `Aluno ${id}`, email: `aluno${id}@example.com`, account_status: id === 3 ? 'restricted' : 'active'
  }]));
  const app = express();
  app.use(express.json());
  vm.runInNewContext(`${enrollmentFunction}\n${authFunction}\n${checkoutRoute}`, {
    app, db, randomUUID, AbortSignal, console,
    currentUser: req => users.get(req.headers.cookie?.match(/(?:^|;\s*)session=(\d+)(?:;|$)/)?.[1]) || null,
    isAdministrativeUser: () => false,
    managedCourse: slug => courses.get(slug), courseReady: slug => slug !== 'preparacao',
    recordConsent: (...args) => calls.consent.push(args),
    process: { env: configured ? { MERCADOPAGO_ACCESS_TOKEN: 'fixture-only', MERCADOPAGO_WEBHOOK_SECRET: 'fixture-only' } : {} },
    checkoutAttempts: new Map(), allowAttempt: () => true, referralAffiliate: () => null,
    adminAnalytics: {
      recordOrderAttribution: (...args) => calls.attribution.push(args),
      recordCheckout: (...args) => calls.checkout.push(args)
    },
    fetch: async (url, options) => {
      calls.provider.push({ url, ...options, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ id: 'fixture-preference', init_point: 'https://www.mercadopago.com.br/checkout/fixture' }) };
    },
    mpHeaders: () => ({}), SITE_URL: 'https://example.com', marketplaceWebhookRouteSignature: () => 'fixture-signature',
    recordSiteSales: (...args) => calls.capture.push(args)
  });
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(async () => { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); db.close(); });
  const request = async ({ session = 1, slug = 'canva-para-lojas', body = { termsAccepted: true } } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/courses/${slug}/checkout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(session ? { cookie: `session=${session}` } : {}) },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  };
  const seedOrder = ({ userId = 1, slug = 'canva-para-lojas', paymentStatus = 'approved', enrollmentStatus = null } = {}) => {
    const reference = `previous_${randomUUID()}`;
    db.prepare('INSERT INTO course_orders(reference,user_id,course_slug,course_title,amount_cents,status) VALUES (?,?,?,?,?,?)')
      .run(reference, userId, slug, 'Curso anterior', 2399, paymentStatus);
    if (enrollmentStatus) db.prepare('INSERT INTO course_enrollments(user_id,course_slug,order_reference,status) VALUES (?,?,?,?)')
      .run(userId, slug, reference, enrollmentStatus);
    return reference;
  };
  return { db, calls, request, seedOrder };
}

test('HTTP checkout directs an already enrolled student to their courses without another order or provider call', async t => {
  const f = await fixture(t, { configured: false });
  const reference = f.seedOrder({ enrollmentStatus: 'active' });
  const response = await f.request({ body: { userId: 2, termsAccepted: false } });
  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    error: 'Você já possui acesso a este curso.', code: 'course_already_enrolled',
    alreadyEnrolled: true, nextUrl: '/meus-cursos.html'
  });
  assert.deepEqual(f.db.prepare('SELECT reference,status FROM course_orders').all(), [{ reference, status: 'approved' }]);
  for (const calls of Object.values(f.calls)) assert.equal(calls.length, 0, 'No payment, consent, or conversion side effects');
});

test('HTTP checkout scopes active enrollment to the authenticated student and exact course', async t => {
  const f = await fixture(t);
  f.seedOrder({ userId: 2, enrollmentStatus: 'active' });
  f.seedOrder({ slug: 'outro-curso', enrollmentStatus: 'active' });
  const response = await f.request({ body: { termsAccepted: true, userId: 2, priceCents: 1 } });
  assert.equal(response.status, 201);
  const created = f.db.prepare('SELECT user_id,course_slug,amount_cents,status FROM course_orders WHERE reference=?').get(response.body.reference);
  assert.deepEqual(created, { user_id: 1, course_slug: 'canva-para-lojas', amount_cents: 2399, status: 'pending' });
  assert.equal(f.calls.provider.length, 1);
  assert.equal(f.calls.provider[0].body.payer.email, 'aluno1@example.com');
  assert.equal(f.calls.provider[0].body.items[0].unit_price, 23.99);
});

test('pending payment and inactive enrollment do not falsely claim that the student already owns the course', async t => {
  for (const enrollmentStatus of [null, 'pending', 'cancelled', 'revoked']) {
    await t.test(enrollmentStatus || 'pending order only', async t => {
      const f = await fixture(t);
      f.seedOrder({ paymentStatus: 'pending', enrollmentStatus });
      const response = await f.request();
      assert.equal(response.status, 201);
      assert.equal(f.calls.provider.length, 1);
      assert.equal(response.body.alreadyEnrolled, undefined);
    });
  }
});

test('HTTP authentication, availability, and purchase consent requirements remain enforced', async t => {
  const f = await fixture(t);
  assert.equal((await f.request({ session: null })).status, 401);
  assert.equal((await f.request({ session: 3 })).status, 403);
  assert.equal((await f.request({ slug: 'inexistente' })).status, 404);
  assert.equal((await f.request({ slug: 'pausado' })).status, 404);
  const preparing = await f.request({ slug: 'preparacao' });
  assert.equal(preparing.status, 409);
  assert.equal(preparing.body.alreadyEnrolled, undefined);
  assert.equal((await f.request({ body: { termsAccepted: false } })).status, 400);
  assert.equal(f.calls.provider.length, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM course_orders').get().count, 0);
});
