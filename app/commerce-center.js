import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { parseRetentionCsv } from './customer-retention.js';

export const COMMERCE_SHEET_ID = '1er693LuabDfElCPE0di9GW29YM9d6l0UIjb-IQMN7oM';
export const COMMERCE_SHEET_URL = `https://docs.google.com/spreadsheets/d/${COMMERCE_SHEET_ID}/edit#gid=742279060`;
const BASE = '/api/admin/commerce';
const MAX_ROWS = 1000, MAX_BYTES = 512 * 1024;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const heading = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
function text(value, max = 180) {
  if (value == null) return '';
  if (typeof value !== 'string' && typeof value !== 'number') throw Error('Campo de texto inválido.');
  const result = String(value).trim();
  if (result.length > max || /[\u0000-\u001f\u007f]/.test(result)) throw Error('Campo longo demais ou com caracteres inválidos.');
  return result;
}
function money(value) {
  if (value == null || value === '') return null;
  let raw = text(value, 30).replace(/^R\$\s*/, '');
  if (raw.includes(',')) {
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(raw)) throw Error('Valor monetário inválido. Use 10,50 ou 10.50.');
    raw = raw.replace(/\./g, '').replace(',', '.');
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw Error('Valor monetário inválido.');
  const result = Math.round(Number(raw) * 100);
  if (!Number.isSafeInteger(result) || result > 100000000) throw Error('Valor monetário fora do limite.');
  return result;
}
function day(value, now) {
  const result = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw Error('Data-base deve usar AAAA-MM-DD.');
  const date = new Date(result + 'T12:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== result || result > new Date(now()).toISOString().slice(0, 10) || result < '2020-01-01') throw Error('Data-base inválida ou futura.');
  return result;
}
export function normalizeCommerceCosts(content, now = Date.now) {
  if (typeof content !== 'string' || !content.trim() || Buffer.byteLength(content) > MAX_BYTES) throw Error('Informe um CSV de custos com até 512 KB.');
  const raw = parseRetentionCsv(content);
  if (raw.length > MAX_ROWS) throw Error('Limite de 1.000 produtos por lote.');
  const items = [], errors = [], duplicates = [], seen = new Map();
  raw.forEach((original, index) => {
    try {
      const row = Object.fromEntries(Object.entries(original).map(([key, value]) => [heading(key), value]));
      const platform = text(row.plataforma, 20).toLowerCase();
      if (!['shopee', 'kwai'].includes(platform)) throw Error('Plataforma deve ser shopee ou kwai.');
      const store = text(row.loja, 120), sku = text(row.sku, 100), variation = text(row.variacao, 100), product = text(row.produto, 300);
      if (!store || !sku || !product) throw Error('Loja, SKU e produto são obrigatórios. Não vincule produtos apenas pelo nome.');
      if (/[\*•]/.test(sku) || /\d[eE]\+\d/.test(sku)) throw Error('SKU mascarado ou em notação científica. Exporte como texto.');
      const observedAt = day(row.database, now);
      const item = { platform, store, sku, variation, product, observedAt, priceCents: money(row.preco), costCents: money(row.custo), packagingCents: money(row.embalagem), sourceLabel: 'CSV conferido pelo administrador' };
      item.id = hash([platform, store, sku, variation, observedAt]);
      const fingerprint = hash(item), previous = seen.get(item.id);
      if (previous) {
        if (previous !== fingerprint) throw Error('Mesmo SKU, loja, variação e data com valores divergentes.');
        duplicates.push({ line: index + 2, message: 'Linha repetida neste arquivo.' }); return;
      }
      seen.set(item.id, fingerprint); items.push(item);
    } catch (error) { errors.push({ line: index + 2, message: error.message }); }
  });
  return { items, errors, duplicates };
}

export function createCommerceCenter({ db, now = Date.now }) {
  db.exec(`CREATE TABLE IF NOT EXISTS commerce_cost_versions (
    id TEXT PRIMARY KEY, identity_key TEXT NOT NULL, payload_json TEXT NOT NULL, fingerprint TEXT NOT NULL,
    observed_at TEXT NOT NULL, admin_id INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_commerce_cost_identity ON commerce_cost_versions(identity_key,observed_at);
    CREATE TABLE IF NOT EXISTS commerce_cost_previews (
    digest TEXT PRIMARY KEY, admin_id INTEGER NOT NULL, payload_json TEXT NOT NULL, expires_at INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'preview');
    CREATE TABLE IF NOT EXISTS commerce_audit_snapshots (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_commerce_audit_kind ON commerce_audit_snapshots(kind,created_at);`);
  const timestamp = () => new Date(now()).toISOString();
  function preview(content, adminId) {
    const result = normalizeCommerceCosts(content, now);
    for (const item of result.items) {
      const existing = db.prepare('SELECT fingerprint FROM commerce_cost_versions WHERE id=?').get(item.id);
      if (existing && existing.fingerprint !== hash(item)) result.errors.push({ message: 'Já há um custo diferente para este SKU, loja, variação e data-base. O histórico não foi sobrescrito.' });
    }
    // Duplicates require a clean file to keep the preview and confirmation unambiguous.
    const digest = result.errors.length || result.duplicates.length ? null : randomUUID();
    if (digest) db.transaction(() => {
      db.prepare('DELETE FROM commerce_cost_previews WHERE expires_at<=?').run(now());
      db.prepare("DELETE FROM commerce_cost_previews WHERE admin_id=? AND state='preview'").run(adminId);
      db.prepare('INSERT INTO commerce_cost_previews(digest,admin_id,payload_json,expires_at) VALUES(?,?,?,?)').run(digest, adminId, JSON.stringify(result.items), now() + 600000);
    }).immediate();
    return { ...result, digest };
  }
  function confirm(digest, adminId, confirmed) {
    if (confirmed !== true || typeof digest !== 'string') throw Error('Confira a prévia e confirme o lote.');
    return db.transaction(() => {
      const batch = db.prepare('SELECT * FROM commerce_cost_previews WHERE digest=? AND admin_id=?').get(digest, adminId);
      if (!batch || batch.expires_at <= now()) throw Error('Prévia expirada. Confira o arquivo novamente.');
      if (batch.state === 'confirmed') return { ok: true, repeated: true, added: 0 };
      const items = JSON.parse(batch.payload_json); let added = 0;
      for (const item of items) {
        const existing = db.prepare('SELECT fingerprint FROM commerce_cost_versions WHERE id=?').get(item.id);
        if (existing && existing.fingerprint !== hash(item)) throw Error('Os custos mudaram desde a prévia. Confira novamente.');
        if (!existing) added += db.prepare('INSERT INTO commerce_cost_versions VALUES(?,?,?,?,?,?,?)').run(item.id, hash([item.platform, item.store, item.sku, item.variation]), JSON.stringify(item), hash(item), item.observedAt, adminId, timestamp()).changes;
      }
      db.prepare("UPDATE commerce_cost_previews SET state='confirmed',payload_json='[]' WHERE digest=?").run(digest);
      return { ok: true, added, repeated: false };
    }).immediate();
  }
  function saveAuditSnapshot(payload, kind = 'manual_audit') {
    if (!['manual_audit', 'google_sheets_api'].includes(kind) || !payload || typeof payload !== 'object' || Array.isArray(payload)) throw Error('Auditoria inválida.');
    const json = JSON.stringify(payload);
    if (Buffer.byteLength(json) > MAX_BYTES) throw Error('Auditoria excede o limite.');
    const id = hash([kind, payload]);
    db.prepare('INSERT OR IGNORE INTO commerce_audit_snapshots VALUES(?,?,?,?)').run(id, kind, json, timestamp());
    return { id };
  }
  function latest(kind) {
    const row = db.prepare('SELECT payload_json,created_at FROM commerce_audit_snapshots WHERE kind=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(kind);
    return row ? { ...JSON.parse(row.payload_json), savedAt: row.created_at } : null;
  }
  function overview(sheetsStatus = {}, shopeeStatus = {}) {
    const audit = latest('manual_audit'), synced = latest('google_sheets_api');
    const costRows = db.prepare(`SELECT a.payload_json FROM commerce_cost_versions a WHERE NOT EXISTS
      (SELECT 1 FROM commerce_cost_versions b WHERE b.identity_key=a.identity_key AND b.observed_at>a.observed_at)
      ORDER BY a.observed_at DESC,a.id LIMIT 1000`).all().map(row => JSON.parse(row.payload_json));
    const costTotals = db.prepare(`SELECT count(*) count,COALESCE(sum(CASE WHEN json_extract(a.payload_json,'$.costCents') IS NULL
      OR json_extract(a.payload_json,'$.packagingCents') IS NULL THEN 1 ELSE 0 END),0) missingCount
      FROM commerce_cost_versions a WHERE NOT EXISTS (SELECT 1 FROM commerce_cost_versions b WHERE b.identity_key=a.identity_key AND b.observed_at>a.observed_at)`).get();
    const hasOrders = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='retention_orders'").get());
    const platforms = hasOrders ? db.prepare('SELECT platform,external_store store,count(*) count FROM retention_orders GROUP BY platform,external_store ORDER BY platform,external_store LIMIT 100').all() : [];
    const orderCount = hasOrders ? db.prepare('SELECT count(*) count FROM retention_orders').get().count : 0;
    const hasImports = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='retention_imports'").get());
    const lastImportAt = hasImports ? db.prepare("SELECT max(published_at) date FROM retention_imports WHERE state='imported'").get()?.date ?? null : null;
    const sheetStatus = sheetsStatus.connected ? 'connected' : sheetsStatus.status === 'expired' ? 'expired' : 'needs_setup';
    const connections = [
      { id: 'shopee', name: 'Shopee', status: shopeeStatus.connected ? 'connected' : 'needs_approval', configured: Boolean(shopeeStatus.configured), connected: Boolean(shopeeStatus.connected), dataSyncAvailable: false,
        detail: shopeeStatus.connected ? 'Autorização da loja verificada. A importação automática de pedidos, catálogo e anúncios ainda não está disponível nesta versão. Use o histórico por arquivo enquanto isso.' : 'Login oficial depende do cadastro e aprovação do aplicativo VitrineCity. A sessão do navegador não conecta a loja ao servidor. Pedidos podem ser importados por arquivo.',
        actionUrl: 'https://open.shopee.com/', sourceMode: shopeeStatus.connected ? 'authorized_account' : 'approval_required', lastSyncAt: null, lastVerifiedAt: shopeeStatus.lastVerifiedAt || null,
        shops: shopeeStatus.shops || [], redirectUri: shopeeStatus.redirectUri || null },
      { id: 'kwai', name: 'Kwai Shop Brasil', status: 'needs_approval', detail: 'É necessário confirmar o acesso de parceiro à API brasileira. A conexão de vídeos do Kwai não dá acesso à loja, pedidos ou anúncios.', actionUrl: 'https://seller-shop.kwai.com/pt-BR/home', sourceMode: 'approval_required', lastSyncAt: null },
      { id: 'upseller', name: 'UpSeller', status: 'manual_import', detail: 'Histórico de arquivos preservado em Clientes e recompra. A conexão direta das lojas será independente do UpSeller; esta fonte não tem sincronização automática ativa.', actionUrl: '/admin-recompra#importar', sourceMode: 'file_import', lastSyncAt: lastImportAt },
      { id: 'google', name: 'Google Sheets · custos', status: sheetStatus, detail: sheetsStatus.detail || 'Planilha identificada. Falta autorizar sua leitura pela VitrineCity. Vincular um endereço não ativa a sincronização.', actionUrl: COMMERCE_SHEET_URL, sourceMode: sheetsStatus.connected ? 'authorized_read' : 'reference_only', lastSyncAt: synced?.measuredAt || null }
    ];
    return { updatedAt: timestamp(), connections,
      costs: { count: costTotals.count, missingCount: costTotals.missingCount, items: costRows, limit: 1000, truncated: costTotals.count > costRows.length, references: synced?.references || audit?.references || [], referencePeriod: synced?.periodLabel || audit?.referencePeriod || null },
      observations: audit?.observations || [], findings: audit?.findings || [], auditObservedAt: audit?.observedAt || null,
      sheet: { url: COMMERCE_SHEET_URL, title: 'Gestao_Otimizada_Agrotecnica_Shopee', status: sheetStatus, lastSyncAt: synced?.measuredAt || null, configured: Boolean(sheetsStatus.configured), enabled: Boolean(sheetsStatus.enabled), redirectUri: sheetsStatus.redirectUri || null },
      orders: { count: orderCount, platforms, lastImportAt, periodLabel: 'Todo o histórico importado; não é receita mensal nem saldo disponível.' },
      decisionPolicy: { automaticSpending: false, profitVerified: false, detail: 'Sem custo por variação, taxas, devoluções, frete e conciliação do mesmo período, não há lucro validado nem recomendação automática de aumentar orçamento.' } };
  }
  return { preview, confirm, overview, saveAuditSnapshot, latest };
}

export function sheetsCostReferences(result) {
  if (!result || !Array.isArray(result.values)) throw Error('Resposta da planilha inválida.');
  const costs = result.values.find(value => /^'?Precificacao'?\!/.test(value.range))?.rows;
  const dashboard = result.values.find(value => /^'?Dashboard'?\!/.test(value.range))?.rows;
  const expectedHeaders = ['ID', 'Produto', 'Preco Venda (R$)', 'Custo Produto (R$)', 'Insumos/Embalagem (R$)'].map(heading);
  if (!Array.isArray(costs) || costs.length > 28 || !Array.isArray(costs[0]) || expectedHeaders.some((name, index) => heading(costs[0][index]) !== name)) throw Error('Cabeçalhos de custos alterados. Revise o mapeamento da planilha.');
  const references = [];
  for (const [index, row] of costs.entries()) {
    if (index === 0 || !row[1] || !Number.isFinite(Number(row[0])) || String(row[0]).trim() === '') continue;
    references.push({ id: 'sheet-row-' + (index + 3), product: text(row[1], 300), priceCents: money(row[2]), costCents: money(row[3]), packagingCents: money(row[4]), platform: 'shopee', store: '', sku: '', variation: '', observedAt: null, sourceLabel: `Precificacao!A${index + 3}:E${index + 3} · referência sem vínculo a SKU; data do custo não confirmada` });
  }
  if (!references.length) throw Error('Nenhuma referência de custo reconhecida. A leitura anterior foi preservada.');
  return { measuredAt: result.measuredAt, references, periodLabel: text(dashboard?.[1]?.[0] || 'Período não informado na planilha', 500), readOnly: true };
}

export function setupCommerceCenter({ app, db, requireAdmin, sameOriginOnly, publicDir, siteUrl, sheets, shopee, getSessionKey, now = Date.now }) {
  const service = createCommerceCenter({ db, now });
  const privateHeaders = (_req, res, next) => { res.set('Cache-Control', 'no-store, private').set('X-Robots-Tag', 'noindex, nofollow').set('Referrer-Policy', 'no-referrer'); next(); };
  app.use(BASE, privateHeaders);
  // express.static decodes escaped paths: protect those aliases before it runs too.
  app.use((req, res, next) => {
    let pathname; try { pathname = path.posix.normalize(decodeURIComponent(req.path).replaceAll('\\', '/')); } catch { return next(); }
    if (!/^\/admin-commerce(?:\.html)?\/?$/i.test(pathname)) return next();
    privateHeaders(req, res, () => requireAdmin(req, res, next));
  });
  app.get(['/admin-commerce', '/admin-commerce.html'], privateHeaders, requireAdmin, (_req, res) => res.sendFile(path.join(publicDir, 'admin-commerce.html')));
  const origin = (req, res, next) => req.get('origin') === new URL(siteUrl).origin && req.is('application/json') ? sameOriginOnly(req, res, next) : res.status(403).json({ error: 'Abra esta ação pelo painel administrativo.' });
  const identity = req => ({ adminId: req.user.id, sessionKey: getSessionKey(req) });
  app.get(BASE + '/overview', requireAdmin, (_req, res) => res.json(service.overview(sheets.status(), shopee?.status())));
  app.post(BASE + '/costs/preview', requireAdmin, origin, (req, res) => {
    try { res.json(service.preview(req.body?.content, req.user.id)); } catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.post(BASE + '/costs/confirm', requireAdmin, origin, (req, res) => {
    try { res.json(service.confirm(req.body?.digest, req.user.id, req.body?.confirmed)); } catch (error) { res.status(409).json({ error: error.message }); }
  });
  app.post(BASE + '/sheets/connect', requireAdmin, origin, (req, res) => {
    try { res.json(sheets.begin(identity(req))); } catch { res.status(503).json({ error: 'A autorização do Google ainda precisa ser configurada no servidor e no aplicativo oficial. Não envie senhas ou chaves pelo chat.' }); }
  });
  app.post(BASE + '/shopee/connect', requireAdmin, origin, (req, res) => {
    try { res.json(shopee.begin(identity(req))); } catch { res.status(503).json({ error: 'O aplicativo da VitrineCity precisa ser aprovado e configurado na Shopee antes de autorizar a loja. Não envie senhas ou chaves pelo chat.' }); }
  });
  app.get(BASE + '/shopee/callback', requireAdmin, async (req, res) => {
    try { await shopee.complete({ ...identity(req), state: req.query.state, code: req.query.code, shopId: req.query.shop_id }); res.redirect(303, '/admin-commerce.html?shopee=connected'); }
    catch { res.redirect(303, '/admin-commerce.html?shopee=needs_review'); }
  });
  app.get(BASE + '/sheets/callback', requireAdmin, async (req, res) => {
    try { await sheets.complete({ ...identity(req), state: req.query.state, code: req.query.code }); res.redirect(303, '/admin-commerce.html?google=connected'); }
    catch { res.redirect(303, '/admin-commerce.html?google=needs_review'); }
  });
  app.post(BASE + '/sheets/sync', requireAdmin, origin, async (_req, res) => {
    try { const result = sheetsCostReferences(await sheets.readCosts()); res.json({ ok: true, count: result.references.length, measuredAt: result.measuredAt }); }
    catch { res.status(409).json({ error: 'Não foi possível atualizar a leitura. Confira a autorização, o acesso à planilha e seus cabeçalhos. Os dados anteriores foram preservados.' }); }
  });
  return service;
}
