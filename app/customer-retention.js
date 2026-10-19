import { createHash, randomBytes, randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import path from 'node:path';

const LIMIT = 10000, BYTES = 3 * 1024 * 1024;
const hash = value => createHash('sha256').update(value).digest('hex');
const key = parts => hash(JSON.stringify(parts));
const header = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const clean = (value, max = 200) => {
  if (value != null && !['string', 'number'].includes(typeof value)) throw new Error('Use valores de texto nas colunas.');
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (text.length > max) throw new Error(`Campo excede ${max} caracteres.`);
  return ['-', '--', 'N/A', 'null'].includes(text) ? '' : text;
};
export function retentionPhone(value) {
  const raw = clean(value, 40);
  if (!raw) return { value: '', status: 'missing' };
  if (/[*xX•]/.test(raw)) return { value: '', status: 'masked' };
  if (/[^\d+() .-]/.test(raw)) return { value: '', status: 'invalid' };
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
  if (!/^55[1-9]\d(?:[2-5]\d{7}|9\d{8})$/.test(digits)) return { value: '', status: 'invalid' };
  return { value: digits, status: 'available' };
}
export function retentionEmail(value) {
  const email = clean(value, 254).toLowerCase();
  if (!email) return { value: '', status: 'missing' };
  if (/[*•]/.test(email)) return { value: '', status: 'masked' };
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return { value: '', status: 'invalid' };
  return { value: email, status: 'available' };
}
export function parseRetentionCsv(content) {
  const source = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const first = source.split('\n')[0];
  const delimiter = first.includes('\t') ? '\t' : first.includes(';') ? ';' : ',';
  const rows = []; let row = [], field = '', quoted = false, closed = false;
  for (let i = 0; i <= source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === undefined) throw new Error('Há aspas não fechadas na planilha.');
      if (ch === '"') { if (source[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
      else field += ch;
    } else if (ch === delimiter || ch === '\n' || ch === undefined) {
      row.push(field); field = ''; closed = false;
      if (ch !== delimiter) { if (row.some(v => v.trim())) rows.push(row); row = []; }
      if (rows.length > LIMIT + 1) throw new Error(`Limite de ${LIMIT} linhas por lote.`);
    } else if (ch === '"' && !field && !closed) quoted = true;
    else { if (closed || ch === '"') throw new Error('Aspas inválidas na planilha.'); field += ch; }
  }
  if (rows.length < 2) throw new Error('Inclua o cabeçalho e ao menos um pedido.');
  // UpSeller repeats some financial columns. Conflicting repeated fields are never silently overwritten.
  const names = rows.shift().map(header);
  return rows.map((values, index) => {
    if (values.length !== names.length) throw new Error(`Linha ${index + 2}: quantidade de colunas incorreta.`);
    const out = Object.create(null);
    names.forEach((name, i) => {
      if (!name) return;
      if (name in out && out[name] !== values[i]) throw new Error(`Linha ${index + 2}: coluna repetida com valores diferentes (${name}).`);
      out[name] = values[i];
    });
    return out;
  });
}
function dateValue(value) {
  const text = clean(value, 60);
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}T${br[4] || '12'}:${br[5] || '00'}:${br[6] || '00'}-03:00` : /^\d{4}-\d{2}-\d{2}$/.test(text) ? text + 'T12:00:00-03:00' : text.replace(' ', 'T');
  const calendar = iso.slice(0, 10), valid = new Date(calendar + 'T12:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}T/.test(iso) || !Number.isFinite(valid.getTime()) || valid.toISOString().slice(0, 10) !== calendar) throw new Error('Data do pedido inválida.');
  const date = new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(iso) ? iso : iso + '-03:00');
  if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now() + 86400000 || date.getUTCFullYear() < 2010) throw new Error('Data do pedido inválida ou futura.');
  return date.toISOString();
}
function money(value) {
  let text = clean(value, 30).replace(/R\$|[\s\u200e\u200f]/g, '');
  if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('Valor do pedido inválido.');
  const cents = Math.round(Number(text) * 100);
  if (!Number.isSafeInteger(cents) || cents > 100000000) throw new Error('Valor do pedido fora do limite.');
  return cents;
}
function paidStatus(status, paidAt) {
  const s = header(status);
  if (/cancel|devol|reembols|refund|unpaid|awaitingpayment|aguardandopagamento|naopago/.test(s)) return false;
  return Boolean(paidAt) || /^(pago|pagado|paid|aprovado|approved|concluido|completed|entregue|delivered|enviado|shipped)$/.test(s);
}
export function normalizeRetentionInput(content) {
  if (typeof content !== 'string' || !content.trim()) throw new Error('Escolha um arquivo ou cole os dados da planilha.');
  if (Buffer.byteLength(content) > BYTES) throw new Error('Limite de 3 MB por lote.');
  let rows;
  if (/^[\s\uFEFF]*[\[{]/.test(content)) {
    try { const data = JSON.parse(content.replace(/^\uFEFF/, '')); rows = Array.isArray(data) ? data : data.orders; }
    catch { throw new Error('JSON inválido.'); }
  } else rows = parseRetentionCsv(content);
  if (!Array.isArray(rows) || !rows.length || rows.length > LIMIT) throw new Error(`Informe entre 1 e ${LIMIT} linhas.`);
  const orders = new Map(), errors = [], stores = new Set(); let repeatedLines = 0;
  rows.forEach((raw, index) => {
    try {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Linha inválida.');
      const r = Object.fromEntries(Object.entries(raw).map(([k, v]) => [header(k), v]));
      const get = (...names) => names.map(n => r[header(n)]).find(v => v != null && v !== '');
      const platformInput = header(get('Plataformas', 'Plataforma', 'platform'));
      const platform = { shopee: 'shopee', kwai: 'kwai', kwaishop: 'kwai' }[platformInput];
      if (!platform) throw new Error('Informe a plataforma Shopee ou Kwai.');
      const store = clean(get('Nome da Loja no UpSeller', 'Loja', 'store'), 120);
      const orderId = clean(get('Nº de Pedido da Plataforma', 'order_id'), 100);
      const buyerId = clean(get('ID do Comprador', 'buyer_id'), 100);
      if (!store || !orderId) throw new Error('Loja e número do pedido da plataforma são obrigatórios.');
      if (/\*|•/.test(orderId + buyerId) || /\d[eE]\+\d/.test(orderId + buyerId)) throw new Error('Identificador mascarado ou em notação científica. Exporte como texto.');
      const name = clean(get('Nome de Comprador', 'Nome do Destinatário', 'name'), 160);
      if (!name) throw new Error('Nome do comprador não informado.');
      const date = dateValue(get('Hora do Pedido', 'Data', 'ordered_at'));
      const totalCents = money(get('Valor do Pedido', 'Valor Total', 'total'));
      const status = clean(get('Estado do Pedido', 'status'), 80);
      const paidAt = clean(get('Hora do Pagamento', 'paid_at'), 60);
      if (paidAt) dateValue(paidAt);
      const phone = retentionPhone(get('Celular do Destinatário', 'Telefone do Destinatário', 'Telefone', 'phone', 'whatsapp'));
      const email = retentionEmail(get('Email', 'E-mail', 'email'));
      const postal = clean(get('CEP', 'postal_code'), 12).replace(/\D/g, '');
      const address = { street: clean(get('Endereço 1', 'Endereço do Destinatário', 'street'), 300), number: clean(get('Número', 'number'), 30), complement: clean(get('Endereço 2', 'complement'), 200), neighborhood: clean(get('Bairro', 'neighborhood'), 100), city: clean(get('Cidade', 'city'), 100), state: clean(get('Estado', 'state'), 80), postal: /^\d{8}$/.test(postal) ? postal : '' };
      const product = clean(get('Nome do Anúncio', 'Nome do Produto', 'product'), 300);
      const sku = clean(get('SKU', 'sku'), 100), variant = clean(get('Variação', 'variant'), 100);
      const quantityInput = get('Qtd. do Produto', 'quantity');
      const quantity = quantityInput == null || quantityInput === '' ? 1 : Number(quantityInput);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000) throw new Error('Quantidade do produto inválida.');
      const sourceKey = key([platform, store, buyerId ? 'buyer' : 'order', buyerId || orderId]);
      const orderKey = key([platform, store, orderId]);
      const base = { orderKey, sourceKey, platform, store, orderId, buyerId, name, date, totalCents, paid: paidStatus(status, paidAt), status, phone, email, address };
      const line = { product, sku, variant, quantity }, lineKey = key([clean(get('Nº do Subpedido', 'line_id'), 100), product, sku, variant]);
      if (orders.has(orderKey)) {
        const previous = orders.get(orderKey);
        if (JSON.stringify(previous.base) !== JSON.stringify(base)) throw new Error('O mesmo pedido tem dados divergentes. Corrija as linhas antes de importar.');
        if (previous.lines.has(lineKey)) {
          if (JSON.stringify(previous.lines.get(lineKey)) !== JSON.stringify(line)) throw new Error('Item repetido com quantidade divergente.');
          repeatedLines++;
        } else previous.lines.set(lineKey, line);
      } else orders.set(orderKey, { base, lines: new Map([[lineKey, line]]) });
      stores.add(store);
    } catch (error) { errors.push({ line: index + 2, message: error.message }); }
  });
  const normalized = [...orders.values()].map(({ base, lines }) => ({ ...base, items: [...lines.values()] }));
  const buyers = new Map(); let ambiguousContacts = 0;
  for (const row of normalized) {
    if (!buyers.has(row.sourceKey)) buyers.set(row.sourceKey, { phone: { ...row.phone }, email: { ...row.email } });
    else {
      const previous = buyers.get(row.sourceKey);
      if ((previous.email.value && row.email.value && previous.email.value !== row.email.value) || (previous.phone.value && row.phone.value && previous.phone.value !== row.phone.value)) ambiguousContacts++;
      if (!previous.email.value && row.email.value) previous.email = { ...row.email };
      if (!previous.phone.value && row.phone.value) previous.phone = { ...row.phone };
    }
  }
  return { orders: normalized, errors, summary: { lines: rows.length, orders: normalized.length, customers: buyers.size, stores: [...stores], repeatedLines, ambiguousContacts, withoutBuyerId: normalized.filter(r => !r.buyerId).length, withPhone: [...buyers.values()].filter(r => r.phone.value).length, withEmail: [...buyers.values()].filter(r => r.email.value).length, paidOrders: normalized.filter(r => r.paid).length } };
}
const safeCsv = value => '"' + String(value ?? '').replace(/^[\s]*[=+@-]/, v => "'" + v).replace(/"/g, '""') + '"';
const csv = rows => '\uFEFF' + rows.map(row => row.map(safeCsv).join(';')).join('\r\n');
const escaped = text => String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export function setupCustomerRetention({ app, db, requireAdmin, requireUser, sameOriginOnly, publicDir, siteUrl, campaignPreferences, sendVerification, signingSecret, allowAttempt }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS retention_customers (
      id TEXT PRIMARY KEY, source_key TEXT NOT NULL UNIQUE, platform TEXT NOT NULL, external_store TEXT NOT NULL,
      buyer_id TEXT NOT NULL DEFAULT '', store_reference TEXT NOT NULL, name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone_status TEXT NOT NULL, email_status TEXT NOT NULL,
      address_json TEXT NOT NULL DEFAULT '{}', contact_conflict INTEGER NOT NULL DEFAULT 0, linked_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      suppressed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS idx_retention_customer_store ON retention_customers(store_reference,linked_user_id);
    CREATE TABLE IF NOT EXISTS retention_orders (
      order_key TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES retention_customers(id), platform TEXT NOT NULL,
      external_store TEXT NOT NULL, order_id TEXT NOT NULL, ordered_at TEXT NOT NULL, total_cents INTEGER NOT NULL,
      paid INTEGER NOT NULL, status TEXT NOT NULL, items_json TEXT NOT NULL, postal TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT '', fingerprint TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS idx_retention_order_customer ON retention_orders(customer_id,ordered_at);
    CREATE INDEX IF NOT EXISTS idx_retention_order_claim ON retention_orders(platform,order_id);
    CREATE TABLE IF NOT EXISTS retention_imports (
      id TEXT PRIMARY KEY, admin_id INTEGER NOT NULL, file_name TEXT NOT NULL, store_reference TEXT NOT NULL,
      rows_json TEXT NOT NULL, summary_json TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'preview', expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, published_at TEXT);
    CREATE TABLE IF NOT EXISTS retention_preferences (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, store_reference TEXT NOT NULL,
      email TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', email_consent INTEGER NOT NULL DEFAULT 0,
      whatsapp_consent INTEGER NOT NULL DEFAULT 0, email_verified INTEGER NOT NULL DEFAULT 0,
      consent_version TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,store_reference));
    CREATE TABLE IF NOT EXISTS retention_tokens (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      store_reference TEXT NOT NULL, email TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS retention_events (
      id INTEGER PRIMARY KEY, actor_id INTEGER, action TEXT NOT NULL, subject TEXT NOT NULL, detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS retention_campaigns (
      id TEXT PRIMARY KEY, admin_id INTEGER NOT NULL, name TEXT NOT NULL, store_reference TEXT NOT NULL,
      channel TEXT NOT NULL, message TEXT NOT NULL, filters_json TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `);
  const base = '/api/admin/recompra';
  const event = (actor, action, subject, detail = {}) => db.prepare('INSERT INTO retention_events(actor_id,action,subject,detail_json) VALUES(?,?,?,?)').run(actor || null, action, subject, JSON.stringify(detail));
  const noStore = (_req, res, next) => { res.set('Cache-Control', 'private,no-store'); next(); };
  const store = reference => db.prepare('SELECT order_reference reference,business_name name FROM store_profiles WHERE order_reference=?').get(String(reference || ''));
  const stores = () => db.prepare('SELECT order_reference reference,business_name name FROM store_profiles ORDER BY business_name').all();
  const fail = (res, error) => res.status(400).json({ error: error.message });
  app.get(['/admin-recompra', '/admin-recompra.html'], requireAdmin, noStore, (_req, res) => res.sendFile(path.join(publicDir, 'admin-recompra.html')));
  app.get(['/recompra', '/recompra/confirmar', '/recompra/sair'], noStore, (req, res) => { res.set('Referrer-Policy', 'no-referrer'); res.sendFile(path.join(publicDir, 'recompra.html')); });
  app.use(base, requireAdmin, noStore);
  app.get(base + '/overview', (_req, res) => res.json({
    stores: stores(), connection: { type: 'file', formats: ['csv', 'tsv', 'json'], maxRows: LIMIT, maxBytes: BYTES, automaticSync: false },
    channels: { emailVerification: Boolean(sendVerification), whatsappSending: false },
    stats: db.prepare(`SELECT count(*) customers,sum(CASE WHEN phone!='' THEN 1 ELSE 0 END) with_phone,sum(CASE WHEN email!='' THEN 1 ELSE 0 END) with_email,sum(CASE WHEN linked_user_id IS NOT NULL THEN 1 ELSE 0 END) linked,sum(contact_conflict) conflicts FROM retention_customers`).get(),
    orders: db.prepare('SELECT count(*) count,sum(CASE WHEN paid=1 THEN total_cents ELSE 0 END) paid_cents FROM retention_orders').get(),
    imports: db.prepare('SELECT id,file_name,summary_json,state,created_at,published_at FROM retention_imports ORDER BY created_at DESC LIMIT 20').all().map(r => ({ ...r, summary: JSON.parse(r.summary_json), summary_json: undefined })),
    campaigns: db.prepare('SELECT id,name,channel,message,state,created_at FROM retention_campaigns ORDER BY created_at DESC LIMIT 20').all()
  }));
  app.post(base + '/preview', sameOriginOnly, (req, res) => {
    try {
      if (!allowAttempt(`retention-preview:${req.user.id}`, 12, 60000)) return res.status(429).json({ error: 'Aguarde um minuto antes de preparar outro lote.' });
      const target = store(req.body?.storeReference); if (!target) throw new Error('Escolha a loja da VitrineCity que receberá estes pedidos.');
      const data = normalizeRetentionInput(req.body.content);
      const id = randomUUID();
      let unchanged = 0, updates = 0;
      for (const row of data.orders) {
        const customer = db.prepare('SELECT store_reference FROM retention_customers WHERE source_key=?').get(row.sourceKey);
        if (customer && customer.store_reference !== target.reference) data.errors.push({ line: null, message: 'Uma origem deste arquivo já pertence a outra loja na VitrineCity.' });
        const current = db.prepare('SELECT fingerprint FROM retention_orders WHERE order_key=?').get(row.orderKey);
        if (current?.fingerprint === key([row])) unchanged++; else if (current) updates++;
      }
      const summary = { ...data.summary, unchanged, updates, newOrders: data.orders.length - unchanged - updates, errors: data.errors.length, target: target.name };
      db.prepare("DELETE FROM retention_imports WHERE state='preview' AND expires_at<?").run(Date.now());
      if (!data.errors.length) db.prepare('INSERT INTO retention_imports(id,admin_id,file_name,store_reference,rows_json,summary_json,expires_at) VALUES(?,?,?,?,?,?,?)').run(id, req.user.id, clean(req.body.fileName || 'Planilha colada', 160), target.reference, JSON.stringify(data.orders), JSON.stringify(summary), Date.now() + 3600000);
      res.json({ id: data.errors.length ? null : id, summary, errors: data.errors.slice(0, 100), sample: data.orders.slice(0, 50).map(r => ({ name: r.name, platform: r.platform, store: r.store, orderId: r.orderId, date: r.date, totalCents: r.totalCents, phone: r.phone.status, email: r.email.status, paid: r.paid })) });
    } catch (error) { fail(res, error); }
  });
  app.post(base + '/imports/:id/confirm', sameOriginOnly, (req, res) => {
    if (req.body?.confirmed !== true) return res.status(400).json({ error: 'Confirme a loja e a prévia antes de importar.' });
    try {
      const result = db.transaction(() => {
        const batch = db.prepare('SELECT * FROM retention_imports WHERE id=? AND admin_id=?').get(req.params.id, req.user.id);
        if (!batch) throw new Error('Prévia não encontrada.');
        if (batch.state === 'imported') return { repeated: true, summary: JSON.parse(batch.summary_json) };
        if (batch.expires_at < Date.now()) throw new Error('A prévia expirou. Prepare o arquivo novamente.');
        let added = 0, updated = 0, unchanged = 0;
        for (const r of JSON.parse(batch.rows_json)) {
          let c = db.prepare('SELECT * FROM retention_customers WHERE source_key=?').get(r.sourceKey);
          if (c && c.store_reference !== batch.store_reference) throw new Error('A origem foi associada a outra loja. Refazer a prévia.');
          if (!c) {
            const id = randomUUID();
            db.prepare(`INSERT INTO retention_customers(id,source_key,platform,external_store,buyer_id,store_reference,name,phone,email,phone_status,email_status,address_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,r.sourceKey,r.platform,r.store,r.buyerId,batch.store_reference,r.name,r.phone.value,r.email.value,r.phone.status,r.email.status,JSON.stringify(r.address));
            c = db.prepare('SELECT * FROM retention_customers WHERE id=?').get(id);
          } else {
            const conflict = (c.phone && r.phone.value && c.phone !== r.phone.value) || (c.email && r.email.value && c.email !== r.email.value);
            const phoneStatus = r.phone.value && !c.phone ? 'available' : c.phone_status === 'missing' ? r.phone.status : c.phone_status;
            const emailStatus = r.email.value && !c.email ? 'available' : c.email_status === 'missing' ? r.email.status : c.email_status;
            db.prepare(`UPDATE retention_customers SET phone=CASE WHEN phone='' THEN ? ELSE phone END,email=CASE WHEN email='' THEN ? ELSE email END,phone_status=?,email_status=?,contact_conflict=MAX(contact_conflict,?),updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(r.phone.value,r.email.value,phoneStatus,emailStatus,conflict?1:0,c.id);
          }
          const fingerprint = key([r]), existing = db.prepare('SELECT * FROM retention_orders WHERE order_key=?').get(r.orderKey);
          if (existing && existing.customer_id !== c.id) throw new Error('O comprador deste pedido mudou. Revise a origem antes de atualizar.');
          if (existing?.fingerprint === fingerprint) { unchanged++; continue; }
          db.prepare(`INSERT INTO retention_orders(order_key,customer_id,platform,external_store,order_id,ordered_at,total_cents,paid,status,items_json,postal,city,region,fingerprint) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(order_key) DO UPDATE SET ordered_at=excluded.ordered_at,total_cents=excluded.total_cents,paid=excluded.paid,status=excluded.status,items_json=excluded.items_json,postal=excluded.postal,city=excluded.city,region=excluded.region,fingerprint=excluded.fingerprint,updated_at=CURRENT_TIMESTAMP`).run(r.orderKey,c.id,r.platform,r.store,r.orderId,r.date,r.totalCents,r.paid?1:0,r.status,JSON.stringify(r.items),r.address.postal,r.address.city,r.address.state,fingerprint);
          if (existing) updated++; else added++;
        }
        const summary = { ...JSON.parse(batch.summary_json), added, updated, unchanged };
        db.prepare("UPDATE retention_imports SET state='imported',rows_json='[]',summary_json=?,published_at=CURRENT_TIMESTAMP WHERE id=?").run(JSON.stringify(summary), batch.id);
        event(req.user.id, 'import', batch.id, { added, updated, unchanged });
        return { repeated: false, summary };
      })(); res.json({ ok: true, ...result });
    } catch (error) { fail(res, error); }
  });
  app.get(base + '/customers', (req, res) => {
    const page = Math.floor(Math.max(1, Math.min(100000, Number(req.query.page) || 1)));
    const q = String(req.query.q || '').trim().slice(0, 100).replace(/[\\%_]/g, '\\$&');
    const params = [`%${q}%`, String(req.query.store || '')];
    const where = `WHERE c.name LIKE ? ESCAPE '\\' AND (?='' OR c.store_reference=?)`;
    const args = [params[0], params[1], params[1]];
    const total = db.prepare(`SELECT count(*) n FROM retention_customers c ${where}`).get(...args).n;
    const items = db.prepare(`SELECT c.*,count(o.order_key) order_count,max(o.ordered_at) last_order,COALESCE(sum(CASE WHEN o.paid=1 THEN o.total_cents ELSE 0 END),0) paid_cents FROM retention_customers c LEFT JOIN retention_orders o ON o.customer_id=c.id ${where} GROUP BY c.id ORDER BY last_order DESC,c.id LIMIT 50 OFFSET ?`).all(...args,(page-1)*50);
    res.json({ items: items.map(r => ({ ...r, source_key: undefined, address_json: undefined, city: JSON.parse(r.address_json).city || '', state: JSON.parse(r.address_json).state || '' })), total, page });
  });
  app.post(base + '/customers/:id/suppress', sameOriginOnly, (req, res) => {
    const result = db.prepare('UPDATE retention_customers SET suppressed=1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Cliente não encontrado.' });
    event(req.user.id, 'suppress', req.params.id); res.json({ ok: true });
  });
  const publicBase = '/api/recompra';
  function geography(query) {
    const reference=String(query.store||''),days=Number(query.days||180),level=query.level==='city'?'city':'state';
    if(!Number.isSafeInteger(days)||days<1||days>3650)throw new Error('Período inválido.');
    const cutoff=new Date(Date.now()-days*86400000).toISOString();
    const raw=db.prepare(`SELECT o.customer_id,o.city,o.region,o.total_cents FROM retention_orders o JOIN retention_customers c ON c.id=o.customer_id WHERE o.paid=1 AND o.ordered_at>=? AND (?='' OR c.store_reference=?)`).all(cutoff,reference,reference);
    const regions=new Map();let withoutRegion=0;
    const states={'acre':'AC','alagoas':'AL','amapa':'AP','amazonas':'AM','bahia':'BA','ceara':'CE','distritofederal':'DF','espiritosanto':'ES','goias':'GO','maranhao':'MA','matogrosso':'MT','matogrossodosul':'MS','minasgerais':'MG','para':'PA','paraiba':'PB','parana':'PR','pernambuco':'PE','piaui':'PI','riodejaneiro':'RJ','riograndedonorte':'RN','riograndedosul':'RS','rondonia':'RO','roraima':'RR','santacatarina':'SC','saopaulo':'SP','sergipe':'SE','tocantins':'TO'};
    for(const r of raw){const state=states[header(r.region)]||Object.values(states).find(s=>s===r.region.trim().toUpperCase());if(!state||(level==='city'&&!r.city.trim())){withoutRegion++;continue;}const city=level==='city'?r.city.trim():'';const id=state+':'+header(city);if(!regions.has(id))regions.set(id,{state,city,orders:0,revenueCents:0,customers:new Set()});const item=regions.get(id);item.orders++;item.revenueCents+=r.total_cents;item.customers.add(r.customer_id);}
    const items=[...regions.values()].sort((a,b)=>b.orders-a.orders||b.revenueCents-a.revenueCents).map(r=>({...r,customers:r.customers.size,share:raw.length?Math.round(r.orders/raw.length*1000)/10:0}));
    return {items,level,days,totalOrders:raw.length,withoutRegion,source:'Endereço de entrega registrado no pedido',targeting:'Região ampla: pode alcançar clientes e outras pessoas da região. Não identifica compradores na Meta.'};
  }
  app.get(base+'/geography',(req,res)=>{try{res.json(geography(req.query));}catch(e){fail(res,e);}});
  app.post(base+'/geography/export',sameOriginOnly,(req,res)=>{try{const data=geography(req.body||{});event(req.user.id,'geography_export','regions',{count:data.items.length});res.set('Content-Disposition','attachment; filename="regioes-para-anuncios.csv"').type('text/csv').send(csv([['Estado','Cidade','Pedidos pagos','Cadastros de origem','Valor dos pedidos','Participação (%)'],...data.items.map(i=>[i.state,i.city,i.orders,i.customers,(i.revenueCents/100).toFixed(2),i.share])]));}catch(e){fail(res,e);}});
  app.use(publicBase, noStore);
  app.get(publicBase + '/stores', (_req, res) => res.json({ stores: stores().filter(s => db.prepare('SELECT 1 FROM retention_customers WHERE store_reference=? LIMIT 1').get(s.reference)) }));
  app.get(publicBase + '/me', requireUser, (req, res) => res.json({ name: req.user.name, email: req.user.email, phone: req.user.whatsapp || '', emailVerificationAvailable: Boolean(sendVerification), preferences: db.prepare('SELECT store_reference,email_consent,whatsapp_consent,email_verified FROM retention_preferences WHERE user_id=?').all(req.user.id), purchases: db.prepare('SELECT DISTINCT store_reference FROM retention_customers WHERE linked_user_id=?').all(req.user.id) }));
  app.post(publicBase + '/claim', sameOriginOnly, requireUser, (req, res) => {
    if (!allowAttempt(`retention-claim-ip:${req.ip}`, 20, 3600000) || !allowAttempt(`retention-claim:${req.user.id}`, 8, 3600000)) return res.status(429).json({ error: 'Aguarde antes de tentar vincular outra compra.' });
    try {
      const b = req.body || {}, postal = clean(b.postal, 12).replace(/\D/g, '');
      if (!/^\d{8}$/.test(postal)) throw new Error('Informe os oito números do CEP usado no pedido.');
      const rows = db.prepare(`SELECT c.id,c.linked_user_id,c.suppressed FROM retention_orders o JOIN retention_customers c ON c.id=o.customer_id WHERE c.store_reference=? AND o.platform=? AND o.order_id=? AND o.postal=? AND o.paid=1`).all(clean(b.storeReference,120),clean(b.platform,20),clean(b.orderId,100),postal);
      if (rows.length !== 1 || rows[0].suppressed || (rows[0].linked_user_id != null && rows[0].linked_user_id !== req.user.id)) throw new Error('Não foi possível vincular esta compra. Confira loja, plataforma, pedido e CEP ou procure o atendimento.');
      db.prepare('UPDATE retention_customers SET linked_user_id=? WHERE id=? AND (linked_user_id IS NULL OR linked_user_id=?)').run(req.user.id,rows[0].id,req.user.id);
      event(req.user.id,'claim',rows[0].id); res.json({ ok: true });
    } catch (error) { fail(res,error); }
  });
  app.post(publicBase + '/preferences', sameOriginOnly, requireUser, async (req, res) => {
    try {
      const b = req.body || {}, target = store(b.storeReference);
      if (!target || typeof b.email !== 'boolean' || typeof b.whatsapp !== 'boolean') throw new Error('Escolha a loja e os canais desejados.');
      const email = retentionEmail(req.user.email).value, phone = retentionPhone(req.user.whatsapp).value;
      if (b.whatsapp && !phone) throw new Error('Cadastre um WhatsApp válido em Minha conta.');
      if (b.email && !email) throw new Error('Cadastre um e-mail válido em Minha conta.');
      const previous = db.prepare('SELECT * FROM retention_preferences WHERE user_id=? AND store_reference=?').get(req.user.id,target.reference);
      const verified = previous?.email === email && previous?.email_verified === 1;
      const needsConfirmation = b.email && (!verified || previous?.email_consent !== 1);
      if (needsConfirmation && !sendVerification) return res.status(503).json({ error: 'A confirmação de e-mail está temporariamente indisponível. Tente mais tarde.' });
      if (needsConfirmation && (!allowAttempt(`retention-verify:${req.user.id}`,3,3600000) || !allowAttempt(`retention-email:${hash(email)}`,3,3600000))) return res.status(429).json({ error: 'Aguarde antes de solicitar outro e-mail.' });
      let token = null;
      db.transaction(() => {
        db.prepare(`INSERT INTO retention_preferences(user_id,store_reference,email,phone,email_consent,whatsapp_consent,email_verified,consent_version) VALUES(?,?,?,?,?,?,?,'recompra-2026-09-10') ON CONFLICT(user_id,store_reference) DO UPDATE SET email=excluded.email,phone=excluded.phone,email_consent=excluded.email_consent,whatsapp_consent=excluded.whatsapp_consent,email_verified=excluded.email_verified,consent_version=excluded.consent_version,updated_at=CURRENT_TIMESTAMP`).run(req.user.id,target.reference,email,phone,b.email?1:0,b.whatsapp?1:0,needsConfirmation?0:verified?1:0);
        const global = campaignPreferences.read(req.user);
        if ((b.email && !global.email) || (b.whatsapp && !global.whatsapp)) campaignPreferences.record(req,req.user,{ email: global.email || b.email, whatsapp: global.whatsapp || b.whatsapp },'retention_preferences');
        db.prepare('DELETE FROM retention_tokens WHERE expires_at<? OR (user_id=? AND store_reference=?)').run(Date.now(),req.user.id,target.reference);
        if (needsConfirmation) {
          token = randomBytes(32).toString('base64url');
          db.prepare('INSERT INTO retention_tokens(token_hash,user_id,store_reference,email,expires_at) VALUES(?,?,?,?,?)').run(hash(token),req.user.id,target.reference,email,Date.now()+1800000);
        }
        event(req.user.id,'preferences',target.reference,{ email:b.email,whatsapp:b.whatsapp,version:'recompra-2026-09-10',emailDigest:hash(email),phoneDigest:phone?hash(phone):'' });
      })();
      if (token) {
        const url = `${siteUrl}/recompra/confirmar#${token}`;
        try { await sendVerification({ to: email, subject: `Confirme as ofertas de ${target.name} na VitrineCity`, text: `Você solicitou receber ofertas de ${target.name} na VitrineCity.\n\nConfirme na sua conta pelo link, válido por 30 minutos:\n${url}\n\nSe não foi você, ignore este e-mail. Nenhuma oferta será liberada sem confirmação. Você pode cancelar em Minha conta ou no link de saída de cada campanha.`, html: `<p>Você solicitou receber ofertas de <strong>${escaped(target.name)}</strong> na VitrineCity.</p><p><a href="${escaped(url)}">Confirmar meu e-mail e receber ofertas</a></p><p>O link vale por 30 minutos. Se não foi você, ignore esta mensagem.</p>` }); }
        catch { db.prepare('DELETE FROM retention_tokens WHERE token_hash=?').run(hash(token)); return res.status(502).json({ error: 'Não foi possível enviar a confirmação. A autorização permanece pendente. Tente novamente mais tarde.' }); }
      }
      res.json({ ok:true, emailPending:Boolean(token), whatsappPending:b.whatsapp, message:token?'Confira seu e-mail para confirmar.':'Preferências salvas.' });
    } catch (error) { fail(res,error); }
  });
  app.post(publicBase + '/confirm', sameOriginOnly, requireUser, (req,res) => {
    const token = String(req.body?.token || '');
    const row = db.prepare('SELECT * FROM retention_tokens WHERE token_hash=? AND user_id=? AND expires_at>?').get(hash(token),req.user.id,Date.now());
    if (!row || retentionEmail(req.user.email).value !== row.email) return res.status(400).json({error:'Link inválido ou expirado. Solicite outra confirmação.'});
    const result = db.transaction(() => {
      const changed = db.prepare('UPDATE retention_preferences SET email_verified=1,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND store_reference=? AND email=? AND email_consent=1').run(req.user.id,row.store_reference,row.email);
      db.prepare('DELETE FROM retention_tokens WHERE token_hash=?').run(hash(token));
      if(changed.changes)event(req.user.id,'email_confirmed',row.store_reference,{emailDigest:hash(row.email)});
      return changed.changes;
    })();
    return result?res.json({ok:true}):res.status(400).json({error:'Esta autorização já foi cancelada.'});
  });
  function unsubscribeToken(userId,storeReference,email) {
    const secret = signingSecret(); if (!secret || secret.length < 24) throw new Error('A saída de campanhas ainda não está configurada.');
    const payload = Buffer.from(JSON.stringify([userId,storeReference,hash(email)])).toString('base64url');
    return payload+'.'+createHmac('sha256',secret).update('retention-unsubscribe:'+payload).digest('base64url');
  }
  app.post(publicBase + '/unsubscribe',sameOriginOnly,(req,res) => {
    try {
      const token=String(req.body?.token||''); if(token.length>1000)throw new Error('Link inválido.');
      const [payload,signature,...extra]=token.split('.'), secret=signingSecret();
      if(!payload||!signature||extra.length||!secret||secret.length<24)throw new Error('Link inválido.');
      const expected=createHmac('sha256',secret).update('retention-unsubscribe:'+payload).digest();
      const supplied=Buffer.from(signature,'base64url');
      if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))throw new Error('Link inválido.');
      const [userId,storeReference,emailHash]=JSON.parse(Buffer.from(payload,'base64url').toString());
      const row=db.prepare('SELECT * FROM retention_preferences WHERE user_id=? AND store_reference=?').get(userId,storeReference);
      if(row&&hash(row.email)===emailHash)db.transaction(()=>{db.prepare('UPDATE retention_preferences SET email_consent=0,whatsapp_consent=0,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND store_reference=?').run(userId,storeReference);db.prepare('DELETE FROM retention_tokens WHERE user_id=? AND store_reference=?').run(userId,storeReference);event(userId,'unsubscribe',storeReference);})();
      res.json({ok:true});
    }catch(error){fail(res,error);}
  });
  function audience(filters,channel) {
    if(channel!=='email') return {items:[],excluded:{channelUnavailable:1},totalCustomers:0};
    const target=store(filters.storeReference);if(!target)throw new Error('Escolha uma loja.');
    const days=Number(filters.days||0);if(!Number.isSafeInteger(days)||days<0||days>3650)throw new Error('Intervalo inválido.');
    const city=clean(filters.city,100).toLowerCase(), product=clean(filters.product,100).toLowerCase();
    const cutoff=Date.now()-days*86400000;
    const customers=db.prepare(`SELECT c.*,max(o.ordered_at) last_order FROM retention_customers c JOIN retention_orders o ON o.customer_id=c.id AND o.paid=1 WHERE c.store_reference=? GROUP BY c.id ORDER BY last_order DESC`).all(target.reference);
    const excluded={suppressed:0,unlinked:0,consent:0,unverified:0,filter:0,duplicate:0,conflict:0};const items=[],seen=new Set();
    for(const c of customers){
      if(c.suppressed){excluded.suppressed++;continue;}if(c.contact_conflict){excluded.conflict++;continue;}
      if(!c.linked_user_id){excluded.unlinked++;continue;}
      const u=db.prepare('SELECT id,name,email,whatsapp,account_status FROM users WHERE id=?').get(c.linked_user_id);
      const p=db.prepare('SELECT * FROM retention_preferences WHERE user_id=? AND store_reference=?').get(c.linked_user_id,target.reference);
      if(!u||u.account_status!=='active'||!p?.email_consent||!campaignPreferences.read(u).email){excluded.consent++;continue;}
      const email=retentionEmail(u.email).value;
      if(!p.email_verified||!email||email!==p.email){excluded.unverified++;continue;}
      if(new Date(c.last_order).getTime()>cutoff||(city&&!String(JSON.parse(c.address_json).city||'').toLowerCase().includes(city))||(product&&!db.prepare('SELECT items_json FROM retention_orders WHERE customer_id=? AND paid=1').all(c.id).some(o=>JSON.parse(o.items_json).some(i=>`${i.product} ${i.sku}`.toLowerCase().includes(product))))){excluded.filter++;continue;}
      if(seen.has(email)){excluded.duplicate++;continue;}seen.add(email);
      items.push({customerId:c.id,name:u.name,email,store:target.name,lastOrder:c.last_order,unsubscribeUrl:`${siteUrl}/recompra/sair#${unsubscribeToken(u.id,target.reference,email)}`});
    }return {items,excluded,totalCustomers:customers.length};
  }
  app.post(base+'/audience',sameOriginOnly,(req,res)=>{try{const a=audience(req.body?.filters||{},req.body?.channel||'email');res.json({...a,items:a.items.slice(0,50),eligible:a.items.length});}catch(e){fail(res,e);}});
  app.post(base+'/campaigns',sameOriginOnly,(req,res)=>{
    try{const b=req.body||{},name=clean(b.name,120),message=clean(b.message,3000),channel=clean(b.channel,20),filters=b.filters||{};if(!name||!message||!['email','whatsapp'].includes(channel)||!store(filters.storeReference))throw new Error('Informe nome, mensagem, canal e loja.');audience(filters,channel);const id=randomUUID();db.prepare('INSERT INTO retention_campaigns(id,admin_id,name,store_reference,channel,message,filters_json) VALUES(?,?,?,?,?,?,?)').run(id,req.user.id,name,filters.storeReference,channel,message,JSON.stringify({storeReference:filters.storeReference,days:Number(filters.days||0),city:clean(filters.city,100),product:clean(filters.product,100)}));event(req.user.id,'campaign_draft',id);res.json({ok:true,id,state:'draft'});}catch(e){fail(res,e);}
  });
  app.post(base+'/campaigns/:id/export',sameOriginOnly,(req,res)=>{
    try{const campaign=db.prepare('SELECT * FROM retention_campaigns WHERE id=?').get(req.params.id);if(!campaign)throw new Error('Campanha não encontrada.');if(campaign.channel!=='email')return res.status(409).json({error:'O canal WhatsApp ainda precisa de integração oficial e confirmação do contato.'});const a=audience(JSON.parse(campaign.filters_json),'email');event(req.user.id,'audience_export',campaign.id,{count:a.items.length});res.set('Content-Disposition','attachment; filename="publico-recompra.csv"').type('text/csv').send(csv([['Nome','Email','Loja','Última compra','Cancelar ofertas'],...a.items.map(i=>[i.name,i.email,i.store,i.lastOrder,i.unsubscribeUrl])]));}catch(e){fail(res,e);}
  });
  const exportUser = userId => ({
    preferences: db.prepare('SELECT store_reference,email,phone,email_consent,whatsapp_consent,email_verified,consent_version,updated_at FROM retention_preferences WHERE user_id=?').all(userId),
    linkedPurchases: db.prepare('SELECT o.platform,c.store_reference,o.order_id,o.ordered_at,o.total_cents,o.status FROM retention_orders o JOIN retention_customers c ON c.id=o.customer_id WHERE c.linked_user_id=? ORDER BY o.ordered_at DESC').all(userId)
  });
  return { audience, exportUser };
}
