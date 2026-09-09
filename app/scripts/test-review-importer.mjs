import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import express from 'express';
import { normalizeReviewInput, parseReviewCsv, shopeeProduct, setupReviewImporter, renderImportedReviewSource } from '../review-importer.js';

const sourceUrl = 'https://shopee.com.br/product/390179975/23698375162/';
const review = { author: 'cliente_publico', rating: 4, date: '2026-08-01 13:20', body: 'Chegou bem. Ainda vou experimentar.', review_id: 'original-1', variation: '3 kg' };
const input = (rows = [review], more = {}) => ({ productId: 12, sourceUrl, content: JSON.stringify(rows), ...more });
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
async function fixture(t) {
  const db = new Database(':memory:'); db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2);
    CREATE TABLE store_profiles(order_reference TEXT PRIMARY KEY,business_name TEXT);
    INSERT INTO store_profiles VALUES('agro','Agrotécnica'),('another','Outra loja');
    CREATE TABLE store_products(id INTEGER PRIMARY KEY,name TEXT,store_reference TEXT REFERENCES store_profiles(order_reference));
    INSERT INTO store_products VALUES(12,'Adubo orgânico','agro'),(20,'Terra vegetal','agro'),(30,'Outro produto','another');
    CREATE TABLE marketplace_product_reviews(id INTEGER PRIMARY KEY,product_id INTEGER REFERENCES store_products(id),user_id INTEGER REFERENCES users(id),rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),title TEXT DEFAULT '',body TEXT DEFAULT '',status TEXT DEFAULT 'published' CHECK(status IN ('pending','published','rejected')),verified_purchase INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(product_id,user_id));
    INSERT INTO marketplace_product_reviews(product_id,user_id,rating,body,verified_purchase) VALUES(12,2,3,'Avaliação nativa',1);`);
  const app = express(); app.use(express.json({ limit: '5mb' }));
  const auth = (req, res, next) => { if (!req.headers['x-test-user']) return res.status(401).json({ error: 'Autenticação necessária.' }); req.user = { id: Number(req.headers['x-test-user']) }; next(); };
  const sameOrigin = (req, res, next) => req.headers.origin === 'https://vitrinecity.test' ? next() : res.status(403).end();
  setupReviewImporter({ app, db, requireAdmin: auth, sameOriginOnly: sameOrigin, publicDir: new URL('../public', import.meta.url).pathname });
  app.use((error, _req, res, _next) => res.status(500).json({ error: 'Falha de teste na transação.' }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const call = async (url, data, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/review-imports${url}`, { method: data ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', origin: 'https://vitrinecity.test', 'x-test-user': '1', ...headers }, ...(data ? { body: JSON.stringify(data) } : {}) });
    const text = await response.text(); return { status: response.status, data: text ? JSON.parse(text) : null };
  };
  return { db, call };
}

test('CSV: BOM, ponto e vírgula, texto multilinha e aspas', () => {
  const rows = parseReviewCsv('\uFEFFautor;nota;data;comentario\r\ncliente;2;2026-07-01;"Não gostei;\nembalagem ""aberta"""\r\n');
  assert.equal(rows[0].comentario, 'Não gostei;\nembalagem "aberta"');
  assert.equal(normalizeReviewInput({ ...input(), content: '\uFEFFautor;nota;data;comentario\ncliente;2;2026-07-01;Ruim' }).rows[0].rating, 2);
  assert.throws(() => parseReviewCsv('a,a\n1,2'), /repetidas/);
  assert.throws(() => parseReviewCsv('a,b\n1,"aberto'), /fechadas/);
  assert.throws(() => parseReviewCsv('a,b\n1,2,3'), /colunas/);
});
test('links aceitos identificam produto e removem rastreamento', () => {
  assert.equal(shopeeProduct('https://shopee.com.br/Adubo-i.390179975.23698375162?tracking=1').url, sourceUrl);
  for (const url of ['http://shopee.com.br/product/1/2/', 'https://shopee.com.br.evil.test/product/1/2/', 'https://user:pass@shopee.com.br/product/1/2/', 'https://shopee.com.br:444/product/1/2/', 'https://shopee.com.br/loja', 'javascript:alert(1)']) assert.throws(() => shopeeProduct(url));
});
test('dados inválidos não ganham nota, data ou autor inventados', () => {
  for (const change of [{ rating: 0 }, { rating: 6 }, { rating: 4.8 }, { author: '' }, { date: '' }, { date: '2026-02-30' }, { date: '2026-13-01' }, { date: '2026-08-01 25:00' }, { date: '2026-02-30T10:00:00Z' }, { itemid: '999' }, { body: 'x'.repeat(5001) }]) {
    const data = normalizeReviewInput(input([{ ...review, ...change }])); assert.equal(data.errors.length, 1, JSON.stringify(change).slice(0, 100));
  }
  assert.throws(() => normalizeReviewInput(input([], { content: 'x'.repeat(2 * 1024 * 1024 + 1) })), /2 MB/);
  assert.throws(() => normalizeReviewInput(input(Array(2001).fill(review))), /2000/);
});
test('JSON da Shopee e grupos de produtos preservam conteúdo', () => {
  const native = normalizeReviewInput(input([], { content: JSON.stringify({ data: { ratings: [{ author_username: 'pessoa', rating_star: 1, ctime: 1754004000, comment: 'Produto avariado', cmtid: '99', itemid: 23698375162, shopid: 390179975 }] } }) }));
  assert.equal(native.rows[0].rating, 1); assert.equal(native.rows[0].externalId, '99');
  const grouped = normalizeReviewInput({ content: JSON.stringify({ products: [{ product_id: 12, source_url: sourceUrl, reviews: [review] }, { product_id: 20, source_url: 'https://shopee.com.br/product/390179975/22293806148/', reviews: [{ ...review, body: '' }] }] }) });
  assert.deepEqual(grouped.rows.map(row => row.productId), [12, 20]); assert.equal(grouped.rows[1].body, '');
});
test('autenticação e origem protegem leitura, prévia e publicação', async t => {
  const { call } = await fixture(t);
  assert.equal((await call('/products', null, { 'x-test-user': '' })).status, 401);
  assert.equal((await call('/preview', input(), { 'x-test-user': '' })).status, 401);
  assert.equal((await call('/preview', input(), { origin: 'https://evil.test' })).status, 403);
  assert.equal((await call('/missing/publish', { confirmed: true }, { origin: 'https://evil.test' })).status, 403);
});
test('prévia não publica; confirmação publica uma vez com autoria e origem', async t => {
  const { db, call } = await fixture(t);
  const before = db.prepare('SELECT COUNT(*) n FROM marketplace_product_reviews').get().n;
  const preview = await call('/preview', input()); assert.equal(preview.status, 200); assert.equal(preview.data.summary.new, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM marketplace_product_reviews').get().n, before);
  const id = preview.data.id;
  assert.equal((await call(`/${id}/publish`, {})).status, 400);
  assert.equal((await call(`/${id}/publish`, { confirmed: true }, { 'x-test-user': '2' })).status, 404);
  const published = await call(`/${id}/publish`, { confirmed: true, content: 'tampered' }); assert.equal(published.status, 200);
  const stored = db.prepare('SELECT r.*,s.author_name,s.source_url FROM marketplace_product_reviews r JOIN marketplace_review_sources s ON s.review_id=r.id').get();
  assert.equal(stored.user_id, null); assert.equal(stored.verified_purchase, 0); assert.equal(stored.rating, 4); assert.equal(stored.body, review.body); assert.equal(stored.author_name, review.author); assert.equal(stored.source_url, sourceUrl);
  assert.equal((await call(`/${id}/publish`, { confirmed: true })).data.alreadyProcessed, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM marketplace_review_sources').get().n, 1);
});
test('duplicatas no lote, entre lotes e após retry são ignoradas', async t => {
  const { call, db } = await fixture(t);
  const first = (await call('/preview', input([review, review, { ...review, review_id: '' }]))).data;
  assert.deepEqual(first.summary, { total: 3, new: 1, duplicates: 2, invalid: 0 });
  const concurrent = (await call('/preview', input())).data;
  await call(`/${first.id}/publish`, { confirmed: true });
  const second = await call(`/${concurrent.id}/publish`, { confirmed: true }); assert.equal(second.data.summary.new, 0);
  const changedText = (await call('/preview', input([{ ...review, body: 'Texto atualizado' }]))).data; assert.equal(changedText.summary.duplicates, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM marketplace_review_sources').get().n, 1);
});
test('produto inexistente ou anúncio associado incorretamente bloqueia todo o lote', async t => {
  const { call, db } = await fixture(t);
  assert.equal((await call('/preview', input([review], { productId: 999 }))).status, 422);
  const data = (await call('/preview', input())).data; await call(`/${data.id}/publish`, { confirmed: true });
  assert.equal((await call('/preview', input([{ ...review, review_id: '2' }], { productId: 20 }))).status, 422);
  const mixed = await call('/preview', input([review, { ...review, rating: 9 }])); assert.equal(mixed.status, 422); assert.equal(mixed.data.id, undefined);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM marketplace_review_sources').get().n, 1);
});
test('prévia expirada não pode publicar', async t => {
  const { call, db } = await fixture(t); const data = (await call('/preview', input())).data;
  db.prepare("UPDATE marketplace_review_imports SET created_at=datetime('now','-2 days') WHERE id=?").run(data.id);
  assert.equal((await call(`/${data.id}/publish`, { confirmed: true })).status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM marketplace_review_sources').get().n, 0);
});
test('ocultar e restaurar preservam avaliações nativas e auditoria', async t => {
  const { call, db } = await fixture(t); const data = (await call('/preview', input())).data;
  await call(`/${data.id}/publish`, { confirmed: true });
  assert.equal((await call(`/${data.id}/visibility`, { action: 'hide' })).status, 200);
  assert.equal(db.prepare('SELECT status FROM marketplace_product_reviews WHERE user_id=2').get().status, 'published');
  assert.equal(db.prepare('SELECT status FROM marketplace_product_reviews WHERE user_id IS NULL').get().status, 'pending');
  await call(`/${data.id}/visibility`, { action: 'restore' });
  assert.equal(db.prepare('SELECT status FROM marketplace_product_reviews WHERE user_id IS NULL').get().status, 'published');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM marketplace_review_import_audit').get().n, 3);
  assert.equal((await call('')).data.batches[0].imported_count, 1);
});
test('falha na gravação desfaz todo o lote atomicamente', async t => {
  const { call, db } = await fixture(t); const data = (await call('/preview', input([review, { ...review, author: 'outro', review_id: '2', rating: 2 }]))).data;
  db.exec("CREATE TRIGGER reject_test BEFORE INSERT ON marketplace_review_sources WHEN NEW.external_id='2' BEGIN SELECT RAISE(ABORT,'test rollback'); END;");
  assert.equal((await call(`/${data.id}/publish`, { confirmed: true })).status, 500);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM marketplace_review_sources').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM marketplace_product_reviews WHERE user_id IS NULL').get().n, 0);
  assert.equal(db.prepare('SELECT status FROM marketplace_review_imports WHERE id=?').get(data.id).status, 'preview');
});
test('atribuição pública usa link seguro e escapa variações', () => {
  const html = renderImportedReviewSource({ source: 'shopee', source_url: sourceUrl, variation: '<img src=x onerror=alert(1)>' }, escape);
  assert.match(html, />Avaliação<\/a>/); assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img/);
  assert.equal(renderImportedReviewSource({ source: 'shopee', source_url: 'javascript:alert(1)' }, escape), '');
  assert.equal(renderImportedReviewSource({ source: null }, escape), '');
});
