import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';

const dataDir = mkdtempSync(path.join(tmpdir(), 'vitrinecity-importer-api-'));
const port = 37000 + Math.floor(Math.random() * 2000), origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.js'], { cwd: new URL('..', import.meta.url), env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), SITE_URL: origin, STORE_PORTAL_SECRET: 'isolated-review-test-secret' }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
let db;
const request = (url, options = {}) => fetch(origin + url, { ...options, headers: { origin, 'Content-Type': 'application/json', ...options.headers } });
try {
  let ready = false;
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`${origin}/api/health`)).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(ready, `Server failed: ${output.slice(-5000)}`);
  const anonymous = await request('/admin-avaliacoes', { redirect: 'manual' }); assert.equal(anonymous.status, 302);
  assert.equal((await request('/api/admin/review-imports')).status, 401);
  const signup = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ name: 'Teste do importador', email: `review-${port}@example.com`, password: 'isolated-password-123', adultConfirmed: true, termsAccepted: true }) });
  assert.equal(signup.status, 201); const cookie = signup.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/admin/review-imports', { headers: { cookie } })).status, 403);
  db = new Database(path.join(dataDir, 'vitrinecity.db'));
  db.prepare('UPDATE users SET is_admin=1 WHERE email=?').run(`review-${port}@example.com`);
  db.prepare("INSERT INTO lot_orders(reference,name,email,amount_cents,status,business_name,fulfillment_status) VALUES ('import-test','Loja Teste','import@example.com',100,'approved','Loja Teste','published')").run();
  db.prepare("INSERT INTO store_profiles(order_reference,business_name,review_status) VALUES ('import-test','Loja Teste','published')").run();
  db.prepare("INSERT INTO store_products(store_reference,name,description,price_cents,stock_quantity,marketplace_enabled) VALUES ('import-test','Produto de teste','Descrição do produto para testes isolados',1000,10,1)").run();
  const product = db.prepare(`SELECT p.id,p.name FROM store_products p JOIN store_profiles s ON s.order_reference=p.store_reference WHERE p.active=1 AND p.marketplace_enabled=1 AND p.price_cents>0 AND p.stock_quantity>0 AND s.review_status='published' LIMIT 1`).get();
  assert.ok(product, 'Published seed product available');
  const adminPage = await request('/admin-avaliacoes', { headers: { cookie } }); assert.equal(adminPage.status, 200); assert.match(await adminPage.text(), /Preparar importação/);
  const preview = await request('/api/admin/review-imports/preview', { method: 'POST', headers: { cookie }, body: JSON.stringify({ productId: product.id, sourceUrl: 'https://shopee.com.br/product/390179975/23698375162/', content: JSON.stringify([{ author: '<img src=x onerror=alert(1)>', rating: 2, date: '2026-08-01', body: 'Embalagem aberta. <script>alert(1)</script>', variation: '3 kg' }]) }) });
  assert.equal(preview.status, 200); const batch = await preview.json();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM marketplace_review_sources').get().n, 0);
  const publish = await request(`/api/admin/review-imports/${batch.id}/publish`, { method: 'POST', headers: { cookie }, body: JSON.stringify({ confirmed: true }) }); assert.equal(publish.status, 200);
  const publicPage = await request(`/produto/${product.id}`); assert.equal(publicPage.status, 200); const html = await publicPage.text();
  assert.match(html, /Avaliação importada da Shopee/); assert.match(html, /Embalagem aberta\. &lt;script&gt;/); assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /Inclui 1 avaliação importada da Shopee/); assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/); assert.doesNotMatch(html, /✓ Compra verificada/);
  const hide = await request(`/api/admin/review-imports/${batch.id}/visibility`, { method: 'POST', headers: { cookie }, body: JSON.stringify({ action: 'hide' }) }); assert.equal(hide.status, 200);
  const hiddenHtml = await (await request(`/produto/${product.id}`)).text(); assert.doesNotMatch(hiddenHtml, /Avaliação importada da Shopee/);
  console.log('review-importer-api: real admin auth, preview, publish, public escaping, attribution and hide passed');
} finally {
  db?.close(); child.kill(); if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
}
