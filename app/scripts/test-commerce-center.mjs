import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
import { createCommerceCenter, normalizeCommerceCosts, setupCommerceCenter, sheetsCostReferences } from '../commerce-center.js';

const clock = () => Date.parse('2026-09-15T12:00:00Z');
const csv = (rows = ['shopee;Loja teste;TEST-1;1kg;Produto exemplo;10,50;2,50;0,50;2026-09-15']) => 'plataforma;loja;sku;variacao;produto;preco;custo;embalagem;data_base\n' + rows.join('\n');
function service(t) { const db = new Database(':memory:'); t.after(() => db.close()); return { db, s: createCommerceCenter({ db, now: clock }) }; }
test('CSV preserves cents, unknown costs and platform/store/SKU/variation/date identity', () => {
  const result = normalizeCommerceCosts(csv(), clock); assert.equal(result.errors.length, 0);
  assert.deepEqual([result.items[0].priceCents, result.items[0].costCents, result.items[0].packagingCents], [1050, 250, 50]);
  const missing = normalizeCommerceCosts(csv(['kwai;Loja teste;TEST-1;;Produto;10;;;2026-09-15']), clock).items[0];
  assert.equal(missing.costCents, null); assert.equal(missing.packagingCents, null);
  assert.notEqual(missing.id, result.items[0].id);
  for (const row of ['shopee;Loja teste;;1kg;Produto;10;1;0;2026-09-15', 'shopee;Loja teste;TEST-1;1kg;Produto;10;1;0;2026-02-30', 'shopee;Loja teste;TEST-1;1kg;Produto;10;1;0;2027-01-01', 'shopee;Loja teste;TEST-1;1kg;Produto;10;-1;0;2026-09-15', 'shopee;Loja teste;TEST-1;1kg;Produto;10;1.200;0;2026-09-15']) assert.equal(normalizeCommerceCosts(csv([row]), clock).errors.length, 1);
});
test('CSV bounds, duplicates and divergent same identity are blocked', () => {
  assert.throws(() => normalizeCommerceCosts('x'.repeat(512 * 1024 + 1)), /512 KB/);
  const row = csv().split('\n')[1];
  assert.equal(normalizeCommerceCosts(csv([row, row]), clock).duplicates.length, 1);
  assert.equal(normalizeCommerceCosts(csv([row, row.replace(';2,50;', ';3,50;')]), clock).errors.length, 1);
  assert.throws(() => normalizeCommerceCosts(csv(Array(1001).fill(row)), clock), /1.000/);
});
test('preview requires admin-bound explicit confirmation; repeat is idempotent', t => {
  const { db, s } = service(t); const p = s.preview(csv(), 1);
  assert.equal(db.prepare('SELECT count(*) n FROM commerce_cost_versions').get().n, 0);
  assert.throws(() => s.confirm(p.digest, 1, false), /confirme/);
  assert.throws(() => s.confirm(p.digest, 2, true), /expirada/);
  assert.equal(s.confirm(p.digest, 1, true).added, 1);
  assert.equal(s.confirm(p.digest, 1, true).repeated, true);
  assert.equal(s.confirm(s.preview(csv(), 1).digest, 1, true).added, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM commerce_cost_versions').get().n, 1);
});
test('new dated costs preserve history; prior-date divergence never overwrites it', t => {
  const { db, s } = service(t);
  s.confirm(s.preview(csv([csv().split('\n')[1].replace('2026-09-15', '2026-09-14')]), 1).digest, 1, true);
  s.confirm(s.preview(csv(), 1).digest, 1, true);
  assert.equal(db.prepare('SELECT count(*) n FROM commerce_cost_versions').get().n, 2);
  assert.equal(s.overview().costs.count, 1);
  assert.equal(s.overview().costs.items[0].observedAt, '2026-09-15');
  const conflict = s.preview(csv([csv().split('\n')[1].replace(';2,50;', ';9,50;')]), 1);
  assert.equal(conflict.digest, null); assert.equal(conflict.errors.length, 1);
});
test('conflict after preview and expiration do not partially write', t => {
  const { db, s } = service(t); const preview = s.preview(csv(), 1);
  const other = s.preview(csv([csv().split('\n')[1].replace(';2,50;', ';9,50;')]), 2); s.confirm(other.digest, 2, true);
  assert.throws(() => s.confirm(preview.digest, 1, true), /mudaram/);
  const expired = s.preview(csv([csv().split('\n')[1].replace(';2,50;', ';9,50;')]), 1); db.prepare('UPDATE commerce_cost_previews SET expires_at=0').run();
  assert.throws(() => s.confirm(expired.digest, 1, true), /expirada/);
  assert.equal(db.prepare('SELECT count(*) n FROM commerce_cost_versions').get().n, 1);
});
test('overview keeps imported orders, observations and historical references separate', t => {
  const { db, s } = service(t);
  db.exec("CREATE TABLE retention_orders(platform TEXT,external_store TEXT); INSERT INTO retention_orders VALUES('kwai','Loja A'),('shopee','Loja B'); CREATE TABLE retention_imports(state TEXT,published_at TEXT); INSERT INTO retention_imports VALUES('imported','2026-09-01');");
  s.saveAuditSnapshot({ observedAt: '2026-09-15', observations: [{ id: 'sample', value: 100, unit: 'BRL', periodLabel: 'Período fictício' }], references: [{ product: 'Somente referência', costCents: 25 }] });
  const data = s.overview(); assert.equal(data.costs.count, 0); assert.equal(data.costs.references.length, 1);
  assert.equal(data.orders.count, 2); assert.equal(data.orders.lastImportAt, '2026-09-01');
  assert.equal(data.decisionPolicy.automaticSpending, false); assert.equal(data.decisionPolicy.profitVerified, false);
  assert.equal(data.connections.find(c => c.id === 'kwai').status, 'needs_approval');
  assert.equal(data.sheet.status, 'needs_setup'); assert.equal(data.sheet.lastSyncAt, null);
});
test('overview totals count all current identities, not only the first thousand rows', t => {
  const { s } = service(t), source = csv().split('\n')[1];
  const rows = Array.from({ length: 1000 }, (_, i) => source.replace('TEST-1', 'TEST-' + i));
  s.confirm(s.preview(csv(rows), 1).digest, 1, true);
  s.confirm(s.preview(csv([source.replace('TEST-1', 'LAST').replace(';2,50;', ';;')]), 1).digest, 1, true);
  const data = s.overview(); assert.equal(data.costs.count, 1001); assert.equal(data.costs.items.length, 1000);
  assert.equal(data.costs.missingCount, 1); assert.equal(data.costs.truncated, true);
});
test('Sheets mappings retain unknown source dates, reject drift and do not join by name', () => {
  const result = sheetsCostReferences({ measuredAt: '2026-09-15T12:00:00Z', values: [
    { range: 'Precificacao!A3:N30', rows: [['ID', 'Produto', 'Preco Venda (R$)', 'Custo Produto (R$)', 'Insumos/Embalagem (R$)'], [1, 'Produto teste', 10.97, 0.21, 0.38], ['', 'Nota']] },
    { range: 'Dashboard!A1:B18', rows: [['Título'], ['Período histórico de teste']] }
  ] });
  assert.equal(result.references[0].costCents, 21); assert.equal(result.references[0].observedAt, null);
  assert.equal(result.references[0].sku, ''); assert.equal(result.references.length, 1);
  assert.throws(() => sheetsCostReferences({ values: [{ range: 'Precificacao!A3:N30', rows: [['ID', 'Novos cabeçalhos']] }] }), /Cabeçalhos/);
  assert.throws(() => sheetsCostReferences({ values: [{ range: 'Precificacao!A3:N30', rows: [['ID', 'Produto', 'Custo Produto (R$)', 'Preco Venda (R$)', 'Insumos/Embalagem (R$)'], [1, 'Produto teste', 20, 5, 1]] }] }), /Cabeçalhos/);
});
async function httpFixture(t) {
  const db = new Database(':memory:'); const app = express(); app.use(express.json({ limit: '1mb' }));
  const admin = (req, res, next) => { const user = Number(req.get('x-user')); if (!user) return res.status(401).json({ error: 'login' }); if (user !== 1) return res.status(403).json({ error: 'restricted' }); req.user = { id: user }; next(); };
  const publicDir = fileURLToPath(new URL('../public', import.meta.url));
  const sheets = { status: () => ({ enabled: false, configured: false }), begin: () => { throw Error('SECRET-FAKE-PROVIDER'); }, complete: async () => { throw Error('SECRET-FAKE-PROVIDER'); }, readCosts: async () => { throw Error('SECRET-FAKE-PROVIDER'); } };
  const service = setupCommerceCenter({ app, db, requireAdmin: admin, sameOriginOnly: (_req, _res, next) => next(), siteUrl: 'https://vitrinecity.test', publicDir, sheets, getSessionKey: () => 'test-session', now: clock });
  app.use(express.static(publicDir, { extensions: ['html'] }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const call = async (url, body, user = 1, origin = 'https://vitrinecity.test', type = 'application/json') => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method: body ? 'POST' : 'GET', headers: { 'x-user': String(user), ...(origin ? { origin } : {}), 'content-type': type }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.text(), headers: r.headers };
  };
  const rawCall = path => new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: server.address().port, path }, res => {
      let body = ''; res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }); req.on('error', reject); req.end();
  });
  return { call, rawCall, db, service };
}
test('HTTP admin gating, no-store, escaped static aliases and origin checks', async t => {
  const { call } = await httpFixture(t);
  for (const url of ['/api/admin/commerce/overview', '/admin-commerce', '/admin-commerce.html', '/%61dmin-commerce.html', '/admin-commerce%2ehtml', '/admin-commerce.html/']) {
    for (const user of [0, 2]) { const r = await call(url, null, user); assert.equal(r.status, user ? 403 : 401, url); assert.match(r.headers.get('cache-control'), /no-store/); }
  }
  for (const origin of [null, 'null', 'https://evil.test']) assert.equal((await call('/api/admin/commerce/costs/preview', { content: csv() }, 1, origin)).status, 403);
  assert.equal((await call('/api/admin/commerce/costs/preview', { content: csv() }, 1, 'https://vitrinecity.test', 'text/plain')).status, 403);
  const response = await call('/api/admin/commerce/costs/preview', { content: csv() });
  assert.equal(response.status, 200); const p = JSON.parse(response.body);
  assert.equal((await call('/api/admin/commerce/costs/confirm', { digest: p.digest, confirmed: true })).status, 200);
});
test('raw dot-segment URLs cannot reach the public static fallback', async t => {
  const { rawCall } = await httpFixture(t);
  for (const path of ['/x/%2e%2e/admin-commerce.html', '/x/..%2fadmin-commerce.html', '/%2e/admin-commerce.html', '/./admin-commerce.html']) {
    const r = await rawCall(path); assert.equal(r.status, 401, path); assert.match(r.headers['cache-control'], /no-store/);
  }
});
test('provider errors never expose secrets and failed sync preserves observations', async t => {
  const { call, service, db } = await httpFixture(t);
  service.saveAuditSnapshot({ measuredAt: '2026-09-14', references: [{ product: 'PRIVATE-COMMERCE-SENTINEL' }] }, 'google_sheets_api');
  for (const endpoint of ['/sheets/connect', '/sheets/sync']) { const r = await call('/api/admin/commerce' + endpoint, {}); assert.ok(r.status >= 400); assert.doesNotMatch(r.body, /SECRET-FAKE/); }
  assert.equal(db.prepare('SELECT count(*) n FROM commerce_audit_snapshots').get().n, 1);
  const overview = await call('/api/admin/commerce/overview'); assert.match(overview.body, /PRIVATE-COMMERCE-SENTINEL/);
  const html = await call('/admin-commerce.html'); assert.doesNotMatch(html.body, /PRIVATE-COMMERCE-SENTINEL/);
});
