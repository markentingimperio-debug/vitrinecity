import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

const MAX_ROWS = 2000;
const MAX_BYTES = 2 * 1024 * 1024;
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error(message); };
const text = (value, max, label) => {
  if (value != null && !['string', 'number'].includes(typeof value)) fail(`${label}: use texto.`);
  const result = String(value ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (result.length > max) fail(`${label}: limite de ${max} caracteres.`);
  return result;
};
const header = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[\s-]+/g, '_');
const pick = (row, ...keys) => keys.map(key => row[key]).find(value => value != null && value !== '');

export function shopeeProduct(value) {
  let url;
  try { url = new URL(String(value ?? '').trim()); } catch { fail('Informe o link completo do produto na Shopee.'); }
  if (url.protocol !== 'https:' || !['shopee.com.br', 'www.shopee.com.br'].includes(url.hostname) || url.username || url.password || url.port) fail('Use um link de produto em https://shopee.com.br.');
  const match = url.pathname.match(/^\/product\/([1-9]\d*)\/([1-9]\d*)\/?$/) || url.pathname.match(/-i\.([1-9]\d*)\.([1-9]\d*)\/?$/);
  if (!match) fail('O link deve apontar para um produto, não para uma loja ou link encurtado.');
  return { shopId: match[1], itemId: match[2], key: `${match[1]}/${match[2]}`, url: `https://shopee.com.br/product/${match[1]}/${match[2]}/` };
}

export function parseReviewCsv(content) {
  const source = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const first = source.split('\n', 1)[0];
  const separator = first.includes(';') ? ';' : first.includes('\t') ? '\t' : ',';
  const rows = []; let row = [], field = '', quoted = false, closed = false;
  for (let index = 0; index <= source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === undefined) fail('CSV com aspas não fechadas.');
      if (char === '"') {
        if (source[index + 1] === '"') { field += '"'; index++; }
        else { quoted = false; closed = true; }
      } else field += char;
    } else if (char === separator || char === '\n' || char === undefined) {
      row.push(field); field = ''; closed = false;
      if (char !== separator) {
        if (row.some(value => value.trim())) rows.push(row);
        row = [];
        if (rows.length > MAX_ROWS + 1) fail(`Use até ${MAX_ROWS} avaliações por arquivo.`);
      }
    } else if (char === '"' && field === '' && !closed) quoted = true;
    else {
      if (closed || char === '"') fail('CSV inválido: coloque campos com aspas entre aspas duplas.');
      field += char;
    }
  }
  if (rows.length < 2) fail('O CSV precisa de cabeçalho e ao menos uma avaliação.');
  const names = rows.shift().map(header);
  if (new Set(names).size !== names.length || names.some(name => !name)) fail('O cabeçalho do CSV contém colunas vazias ou repetidas.');
  return rows.map((values, index) => {
    if (values.length !== names.length) fail(`Linha ${index + 2}: quantidade de colunas diferente do cabeçalho.`);
    return Object.fromEntries(names.map((name, column) => [name, values[column]]));
  });
}

function dateValue(value) {
  const input = String(value ?? '').trim();
  if (!input) fail('Informe a data original da avaliação.');
  let iso;
  if (/^\d{10}$/.test(input)) iso = new Date(Number(input) * 1000).toISOString();
  else {
    const local = input.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (local) {
      const [year, month, day, hour, minute, second] = local.slice(1).map(Number);
      const check = new Date(Date.UTC(year, month - 1, day));
      if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) fail('Data inválida.');
      iso = `${local[1]}-${local[2]}-${local[3]}T${local[4] || '12'}:${local[5] || '00'}:${local[6] || '00'}-03:00`;
    } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(input)) {
      const calendar = input.slice(0, 10), check = new Date(`${calendar}T12:00:00Z`);
      if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0, 10) !== calendar) fail('Data inválida.');
      iso = input;
    } else fail('Use data no formato AAAA-MM-DD, com horário opcional, ou timestamp Unix.');
  }
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() > Date.now() + 86400000 || parsed.getUTCFullYear() < 2010) fail('Data original inválida ou no futuro.');
  return parsed.toISOString().slice(0, 19).replace('T', ' ');
}

export function normalizeReviewInput({ content, productId, sourceUrl, format = 'auto' } = {}) {
  if (typeof content !== 'string' || !content.trim()) fail('Selecione um arquivo ou cole as avaliações.');
  if (Buffer.byteLength(content) > MAX_BYTES) fail('O arquivo deve ter até 2 MB.');
  if (!['auto', 'json', 'csv'].includes(format)) fail('Formato inválido.');
  let rows;
  if (format === 'json' || (format === 'auto' && /^[\s\uFEFF]*[\[{]/.test(content))) {
    let data;
    try { data = JSON.parse(content.replace(/^\uFEFF/, '')); } catch { fail('JSON inválido. Confira o arquivo.'); }
    if (Array.isArray(data?.products)) {
      rows = data.products.flatMap(group => {
        if (!Array.isArray(group.reviews)) fail('Cada produto do JSON deve conter uma lista reviews.');
        return group.reviews.map(review => ({ ...review, product_id: group.product_id, source_url: group.source_url }));
      });
    } else rows = Array.isArray(data) ? data : data?.reviews ?? data?.data?.ratings ?? data?.ratings;
  } else rows = parseReviewCsv(content);
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS) fail(`Informe de 1 a ${MAX_ROWS} avaliações por arquivo.`);
  const normalized = [], errors = [];
  rows.forEach((raw, index) => {
    try {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Avaliação inválida.');
      const row = Object.fromEntries(Object.entries(raw).map(([key, value]) => [header(key), value]));
      const id = Number(pick(row, 'product_id', 'produto_id') ?? productId);
      if (!Number.isSafeInteger(id) || id < 1) fail('Informe o ID do produto na VitrineCity.');
      const source = shopeeProduct(pick(row, 'source_url', 'url_origem', 'link_shopee') ?? sourceUrl);
      for (const [field, expected] of [['shopid', source.shopId], ['itemid', source.itemId]]) {
        if (row[field] != null && String(row[field]) !== expected) fail('A avaliação pertence a outro anúncio da Shopee.');
      }
      const rating = Number(pick(row, 'rating', 'nota', 'rating_star'));
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) fail('A nota deve ser um número inteiro de 1 a 5.');
      const author = text(pick(row, 'author', 'autor', 'nome', 'author_name', 'author_username'), 100, 'Nome público');
      if (!author) fail('Informe o nome público ou apelido original do cliente.');
      const createdAt = dateValue(pick(row, 'date', 'data', 'created_at', 'ctime'));
      const body = text(pick(row, 'body', 'comment', 'comentario', 'texto'), 5000, 'Comentário');
      const title = text(pick(row, 'title', 'titulo'), 200, 'Título');
      const variation = text(pick(row, 'variation', 'variacao', 'model_name'), 200, 'Variação');
      const externalId = text(pick(row, 'review_id', 'id_avaliacao', 'cmtid'), 100, 'ID original');
      const fingerprint = digest(JSON.stringify([source.key, author.toLowerCase(), rating, createdAt, body, title]));
      normalized.push({ line: index + 1, productId: id, source, rating, author, createdAt, body, title, variation, externalId: externalId || null, fingerprint });
    } catch (error) { errors.push({ line: index + 1, message: error.message }); }
  });
  return { rows: normalized, errors, total: rows.length };
}

export function setupReviewImporter({ app, db, requireAdmin, sameOriginOnly, publicDir }) {
  db.exec(`CREATE TABLE IF NOT EXISTS marketplace_review_imports (
    id TEXT PRIMARY KEY, admin_user_id INTEGER NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'preview',
    payload_json TEXT NOT NULL, summary_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS marketplace_review_product_links (
    source_product_key TEXT PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES store_products(id), source_url TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS marketplace_review_sources (
    review_id INTEGER PRIMARY KEY REFERENCES marketplace_product_reviews(id) ON DELETE CASCADE,
    batch_id TEXT NOT NULL REFERENCES marketplace_review_imports(id), source TEXT NOT NULL DEFAULT 'shopee',
    source_product_key TEXT NOT NULL, source_url TEXT NOT NULL, external_id TEXT, fingerprint TEXT NOT NULL UNIQUE,
    author_name TEXT NOT NULL, variation TEXT NOT NULL DEFAULT '', imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source,source_product_key,external_id)
  );
  CREATE INDEX IF NOT EXISTS idx_marketplace_review_sources_batch ON marketplace_review_sources(batch_id);
  CREATE TABLE IF NOT EXISTS marketplace_review_import_audit (
    id INTEGER PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES marketplace_review_imports(id),
    admin_user_id INTEGER NOT NULL REFERENCES users(id), action TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`);
  app.get(['/admin-avaliacoes.html', '/admin-avaliacoes'], requireAdmin, (_req, res) => res.set('Cache-Control', 'no-store').sendFile(path.join(publicDir, 'admin-avaliacoes.html')));
  app.use('/api/admin/review-imports', requireAdmin, (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const product = db.prepare('SELECT p.id,p.name,p.store_reference,s.business_name store_name FROM store_products p JOIN store_profiles s ON s.order_reference=p.store_reference WHERE p.id=?');
  const linked = db.prepare('SELECT product_id FROM marketplace_review_product_links WHERE source_product_key=?');
  const duplicate = db.prepare(`SELECT review_id FROM marketplace_review_sources WHERE fingerprint=? OR (source='shopee' AND source_product_key=? AND external_id=?)`);
  const audit = (batch, user, action) => db.prepare('INSERT INTO marketplace_review_import_audit(batch_id,admin_user_id,action) VALUES (?,?,?)').run(batch, user, action);
  const inspect = rows => {
    const seen = new Set(), links = new Map(), checked = [], errors = [];
    for (const row of rows) {
      const item = product.get(row.productId);
      if (!item) { errors.push({ line: row.line, message: 'Produto não encontrado na VitrineCity.' }); continue; }
      const previous = links.get(row.source.key) ?? linked.get(row.source.key)?.product_id;
      if (previous != null && previous !== row.productId) { errors.push({ line: row.line, message: 'Este anúncio da Shopee já está associado a outro produto. Confira a correspondência.' }); continue; }
      links.set(row.source.key, row.productId);
      const key = row.externalId ? `${row.source.key}:${row.externalId}` : row.fingerprint;
      const isDuplicate = seen.has(key) || seen.has(row.fingerprint) || Boolean(duplicate.get(row.fingerprint, row.source.key, row.externalId));
      seen.add(key); seen.add(row.fingerprint);
      checked.push({ ...row, productName: item.name, storeName: item.store_name, duplicate: isDuplicate });
    }
    return { rows: checked, errors };
  };
  const summaryFor = (rows, errors, total) => ({ total, new: rows.filter(row => !row.duplicate).length, duplicates: rows.filter(row => row.duplicate).length, invalid: errors.length });
  const safe = handler => (req, res, next) => {
    try { return handler(req, res); } catch (error) { next(error); }
  };
  app.get('/api/admin/review-imports/products', safe((_req, res) => res.json({ products: db.prepare(`SELECT p.id,p.name,p.store_reference,s.business_name store_name,
    (SELECT source_url FROM marketplace_review_product_links l WHERE l.product_id=p.id LIMIT 1) source_url
    FROM store_products p JOIN store_profiles s ON s.order_reference=p.store_reference ORDER BY s.business_name,p.name`).all() })));
  app.get('/api/admin/review-imports', safe((_req, res) => res.json({ batches: db.prepare(`SELECT id,status,summary_json,created_at,published_at,
    (SELECT COUNT(*) FROM marketplace_review_sources s WHERE s.batch_id=i.id) imported_count
    FROM marketplace_review_imports i WHERE status!='preview' ORDER BY created_at DESC,id DESC LIMIT 100`).all().map(row => ({ ...row, summary: JSON.parse(row.summary_json), summary_json: undefined })) })));
  app.post('/api/admin/review-imports/preview', sameOriginOnly, safe((req, res) => {
    let parsed;
    try { parsed = normalizeReviewInput(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
    const checked = inspect(parsed.rows), errors = [...parsed.errors, ...checked.errors], summary = summaryFor(checked.rows, errors, parsed.total);
    if (errors.length) return res.status(422).json({ error: 'Corrija as avaliações inválidas antes de importar.', summary, errors, rows: checked.rows });
    const id = randomUUID();
    db.transaction(() => {
      db.prepare("DELETE FROM marketplace_review_imports WHERE status='preview' AND created_at<datetime('now','-1 day')").run();
      const pending = db.prepare("SELECT COUNT(*) count FROM marketplace_review_imports WHERE admin_user_id=? AND status='preview'").get(req.user.id).count;
      if (pending >= 50) fail('Muitas prévias pendentes. Aguarde a expiração em 24 horas.');
      db.prepare('INSERT INTO marketplace_review_imports(id,admin_user_id,payload_json,summary_json) VALUES (?,?,?,?)').run(id, req.user.id, JSON.stringify(parsed.rows), JSON.stringify(summary));
    })();
    return res.json({ id, summary, rows: checked.rows, errors: [], expiresInHours: 24 });
  }));
  app.post('/api/admin/review-imports/:id/publish', sameOriginOnly, safe((req, res) => {
    if (req.body?.confirmed !== true) return res.status(400).json({ error: 'Confirme a conferência dos produtos e das avaliações.' });
    const batch = db.prepare('SELECT * FROM marketplace_review_imports WHERE id=?').get(String(req.params.id));
    if (!batch || batch.admin_user_id !== req.user.id) return res.status(404).json({ error: 'Prévia não encontrada para esta conta.' });
    if (batch.status !== 'preview') return res.json({ id: batch.id, status: batch.status, alreadyProcessed: true, summary: JSON.parse(batch.summary_json) });
    if (Date.parse(`${batch.created_at.replace(' ', 'T')}Z`) < Date.now() - 86400000) return res.status(409).json({ error: 'Prévia expirada. Gere uma nova prévia.' });
    const result = db.transaction(() => {
      const checked = inspect(JSON.parse(batch.payload_json));
      if (checked.errors.length) return { errors: checked.errors };
      for (const row of checked.rows.filter(row => !row.duplicate)) {
        const review = db.prepare(`INSERT INTO marketplace_product_reviews(product_id,user_id,rating,title,body,status,verified_purchase,created_at) VALUES (?,NULL,?,?,?,'published',0,?)`).run(row.productId, row.rating, row.title, row.body, row.createdAt);
        db.prepare('INSERT INTO marketplace_review_sources(review_id,batch_id,source_product_key,source_url,external_id,fingerprint,author_name,variation) VALUES (?,?,?,?,?,?,?,?)').run(Number(review.lastInsertRowid), batch.id, row.source.key, row.source.url, row.externalId, row.fingerprint, row.author, row.variation);
        db.prepare('INSERT OR IGNORE INTO marketplace_review_product_links(source_product_key,product_id,source_url) VALUES (?,?,?)').run(row.source.key, row.productId, row.source.url);
      }
      const summary = summaryFor(checked.rows, [], checked.rows.length);
      db.prepare("UPDATE marketplace_review_imports SET status='published',summary_json=?,payload_json='[]',published_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(JSON.stringify(summary), batch.id);
      audit(batch.id, req.user.id, 'publish');
      return { summary };
    })();
    if (result.errors) return res.status(409).json({ error: 'A associação dos produtos mudou. Gere uma nova prévia.', errors: result.errors });
    return res.json({ id: batch.id, status: 'published', ...result });
  }));
  app.post('/api/admin/review-imports/:id/visibility', sameOriginOnly, safe((req, res) => {
    const next = { hide: 'hidden', restore: 'published' }[req.body?.action];
    if (!next) return res.status(400).json({ error: 'Ação inválida.' });
    const batch = db.prepare("SELECT id,status FROM marketplace_review_imports WHERE id=? AND status IN ('published','hidden')").get(String(req.params.id));
    if (!batch) return res.status(404).json({ error: 'Lote publicado não encontrado.' });
    db.transaction(() => {
      db.prepare('UPDATE marketplace_product_reviews SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id IN (SELECT review_id FROM marketplace_review_sources WHERE batch_id=?)').run(next === 'published' ? 'published' : 'pending', batch.id);
      db.prepare('UPDATE marketplace_review_imports SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(next, batch.id);
      audit(batch.id, req.user.id, req.body.action);
    })();
    return res.json({ id: batch.id, status: next });
  }));
}

export function renderImportedReviewSource(review, escapeHtml) {
  if (review.source !== 'shopee') return '';
  let source;
  try { source = shopeeProduct(review.source_url); } catch { return ''; }
  return `<div class="review-source"><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer nofollow">Avaliação importada da Shopee ↗</a>${review.variation ? `<div>Variação: ${escapeHtml(review.variation)}</div>` : ''}</div>`;
}
