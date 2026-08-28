const PLACE_FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress',
  'places.nationalPhoneNumber', 'places.websiteUri', 'places.googleMapsUri',
  'places.primaryTypeDisplayName', 'places.rating', 'places.userRatingCount',
  'places.businessStatus'
].join(',');

const cleanText = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanPhone = value => String(value || '').replace(/[^\d+]/g, '').slice(0, 24);
const cleanUrl = value => {
  const text = cleanText(value, 700);
  if (!text) return '';
  try { const url = new URL(text); return /^https?:$/.test(url.protocol) ? url.toString() : ''; } catch { return ''; }
};

export const isPublicNetworkAddress = address => {
  if (!net.isIP(address)) return false;
  const normalized = address.toLowerCase();
  if (normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return false;
  const ipv4 = normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized;
  if (!net.isIPv4(ipv4)) return true;
  const [a, b] = ipv4.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
};

async function assertPublicWebsite(url) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('website_not_public');
  const addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => !isPublicNetworkAddress(item.address))) throw new Error('website_not_public');
  return parsed;
}

function normalizedPublicLink(value) {
  return cleanUrl(String(value || '').replaceAll('&amp;', '&').replaceAll('&#38;', '&'));
}
const safeDecode = value => { try { return decodeURIComponent(value); } catch { return value; } };
const isWhatsAppGroupUrl = value => {
  try { return new URL(value).hostname.toLowerCase() === 'chat.whatsapp.com'; } catch { return false; }
};

export function extractPublicBusinessContacts(html) {
  const source = String(html || '').slice(0, 1_000_000);
  const hrefs = [...source.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(match => normalizedPublicLink(match[1])).filter(Boolean);
  const social = (hosts) => hrefs.find(value => {
    try { const host = new URL(value).hostname.replace(/^www\./, '').toLowerCase(); return hosts.some(item => host === item || host.endsWith(`.${item}`)); } catch { return false; }
  }) || '';
  const emailCandidates = [
    ...[...source.matchAll(/mailto:([^?"'\s<>]+)/gi)].map(match => safeDecode(match[1])),
    ...[...source.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map(match => match[0])
  ].map(value => cleanText(value, 180).toLowerCase()).filter(value => /^\S+@\S+\.\S+$/.test(value) && !/\.(png|jpe?g|gif|svg|webp)$/i.test(value));
  const whatsappUrl = social(['wa.me', 'api.whatsapp.com']);
  const whatsappGroupUrl = social(['chat.whatsapp.com']);
  let whatsapp = '';
  try {
    const parsed = new URL(whatsappUrl), text = `${parsed.pathname} ${parsed.searchParams.get('phone') || ''}`;
    whatsapp = cleanPhone(text);
  } catch {}
  return {
    email: emailCandidates[0] || '', whatsapp, whatsappGroupUrl,
    instagramUrl: social(['instagram.com']), facebookUrl: social(['facebook.com', 'fb.com']),
    tiktokUrl: social(['tiktok.com'])
  };
}

async function fetchPublicBusinessContacts(initialUrl, fetchImpl = fetch) {
  let current = cleanUrl(initialUrl);
  if (!current) return {};
  for (let redirects = 0; redirects < 4; redirects += 1) {
    await assertPublicWebsite(current);
    const response = await fetchImpl(current, {
      redirect: 'manual', signal: AbortSignal.timeout(5000),
      headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'VitrineCityBusinessDirectory/1.0 (+https://vitrinecity.com)' }
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return {};
      current = cleanUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok || !String(response.headers.get('content-type') || '').toLowerCase().includes('text/html')) return {};
    const length = Number(response.headers.get('content-length') || 0);
    if (length > 1_000_000) return {};
    return extractPublicBusinessContacts((await response.text()).slice(0, 1_000_000));
  }
  return {};
}

export function setupBusinessProspecting({ app, db, requireAdmin, sameOriginOnly, allowAttempt }) {
  const searchAttempts = new Map();
  db.exec(`CREATE TABLE IF NOT EXISTS business_prospects (
    id INTEGER PRIMARY KEY,
    place_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    phone_public TEXT NOT NULL DEFAULT '',
    website_url TEXT NOT NULL DEFAULT '',
    maps_url TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    whatsapp TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','reviewed','contacted','interested','registered','discarded')),
    notes TEXT NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT
  );
  CREATE INDEX IF NOT EXISTS idx_business_prospects_status_updated
    ON business_prospects(status, updated_at DESC);
  CREATE TABLE IF NOT EXISTS outreach_templates (
    code TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS outreach_events (
    id INTEGER PRIMARY KEY, prospect_id INTEGER NOT NULL REFERENCES business_prospects(id) ON DELETE CASCADE,
    channel TEXT NOT NULL CHECK(channel IN ('whatsapp','email')), template_code TEXT NOT NULL,
    message_body TEXT NOT NULL, contact_confirmed INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_outreach_events_prospect_created ON outreach_events(prospect_id, created_at DESC);`);
  const prospectColumns = new Set(db.prepare('PRAGMA table_info(business_prospects)').all().map(column => column.name));
  for (const [name, definition] of [
    ['source', "TEXT NOT NULL DEFAULT 'google_places'"],
    ['instagram_url', "TEXT NOT NULL DEFAULT ''"],
    ['facebook_url', "TEXT NOT NULL DEFAULT ''"],
    ['tiktok_url', "TEXT NOT NULL DEFAULT ''"],
    ['whatsapp_group_url', "TEXT NOT NULL DEFAULT ''"],
    ['enrichment_status', "TEXT NOT NULL DEFAULT 'pending'"],
    ['enriched_at', 'TEXT']
  ]) {
    if (!prospectColumns.has(name)) db.exec(`ALTER TABLE business_prospects ADD COLUMN ${name} ${definition}`);
  }
  const saveEnrichment = db.prepare(`UPDATE business_prospects SET
    email=CASE WHEN email='' AND @email<>'' THEN @email ELSE email END,
    whatsapp=CASE WHEN whatsapp='' AND @whatsapp<>'' THEN @whatsapp ELSE whatsapp END,
    instagram_url=CASE WHEN instagram_url='' AND @instagramUrl<>'' THEN @instagramUrl ELSE instagram_url END,
    facebook_url=CASE WHEN facebook_url='' AND @facebookUrl<>'' THEN @facebookUrl ELSE facebook_url END,
    tiktok_url=CASE WHEN tiktok_url='' AND @tiktokUrl<>'' THEN @tiktokUrl ELSE tiktok_url END,
    whatsapp_group_url=CASE WHEN whatsapp_group_url='' AND @whatsappGroupUrl<>'' THEN @whatsappGroupUrl ELSE whatsapp_group_url END,
    enrichment_status=@enrichmentStatus,enriched_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=@id`);
  async function enrichProspects(rows) {
    const queue = rows.filter(row => row.website_url), enriched = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (cursor < queue.length) {
        const row = queue[cursor++];
        let contacts = {}, enrichmentStatus = 'not_found';
        try {
          contacts = await fetchPublicBusinessContacts(row.website_url);
          if (Object.values(contacts).some(Boolean)) enrichmentStatus = 'found';
        } catch { enrichmentStatus = 'unavailable'; }
        const values = { id: row.id, email: '', whatsapp: '', whatsappGroupUrl: '', instagramUrl: '', facebookUrl: '', tiktokUrl: '', ...contacts, enrichmentStatus };
        saveEnrichment.run(values);
        enriched.push(values);
      }
    });
    await Promise.all(workers);
    return enriched;
  }
  db.prepare(`INSERT OR IGNORE INTO outreach_templates(code,title,body) VALUES (?,?,?)`).run(
    'convite-inicial', 'Convite para a Vitrine City',
    'Olá, {{empresa}}! Encontrei sua empresa e gostaria de convidar você para conhecer a Vitrine City, nossa cidade digital para negócios locais. Posso lhe enviar os detalhes de cadastro?'
  );

  app.get('/admin-prospeccao.html', requireAdmin, (_req, res) =>
    res.sendFile(new URL('./public/admin-prospeccao.html', import.meta.url).pathname));

  app.get('/api/admin/prospecting/status', requireAdmin, (_req, res) => res.json({
    configured: Boolean(cleanText(process.env.GOOGLE_PLACES_API_KEY, 300)),
    provider: 'Google Places API (New)'
  }));

  app.post('/api/admin/prospecting/search', requireAdmin, sameOriginOnly, async (req, res) => {
    const query = cleanText(req.body?.query, 180);
    if (query.length < 3) return res.status(400).json({ error: 'Informe uma busca com pelo menos 3 caracteres.' });
    const key = cleanText(process.env.GOOGLE_PLACES_API_KEY, 300);
    if (!key) return res.status(503).json({ error: 'A chave do Google Places ainda não foi configurada.' });
    if (!allowAttempt(searchAttempts, `places:${req.user.id}`, 20, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'Limite de 20 buscas por hora atingido.' });
    }
    try {
      const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': PLACE_FIELDS },
        body: JSON.stringify({ textQuery: query, languageCode: 'pt-BR', regionCode: 'BR', pageSize: 20 })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error?.message || 'Não foi possível consultar o Google Places.');
      const items = (payload.places || []).map(place => ({
        placeId: place.id || '', name: cleanText(place.displayName?.text, 180),
        address: cleanText(place.formattedAddress, 300), category: cleanText(place.primaryTypeDisplayName?.text, 100),
        phonePublic: cleanPhone(place.nationalPhoneNumber), websiteUrl: cleanUrl(place.websiteUri),
        mapsUrl: cleanUrl(place.googleMapsUri), rating: Number(place.rating || 0),
        reviews: Number(place.userRatingCount || 0), businessStatus: cleanText(place.businessStatus, 50)
      })).filter(place => place.placeId && place.name);
      const saveLead = db.prepare(`INSERT INTO business_prospects
        (place_id,name,address,category,phone_public,website_url,maps_url,created_by)
        VALUES (@placeId,@name,@address,@category,@phonePublic,@websiteUrl,@mapsUrl,@createdBy)
        ON CONFLICT(place_id) DO UPDATE SET name=excluded.name,address=excluded.address,category=excluded.category,
        phone_public=excluded.phone_public,website_url=excluded.website_url,maps_url=excluded.maps_url,
        updated_at=CURRENT_TIMESTAMP`);
      const saveResults = db.transaction(results => {
        for (const item of results) saveLead.run({ ...item, createdBy: req.user.id });
      });
      saveResults(items);
      const findLead = db.prepare('SELECT * FROM business_prospects WHERE place_id=?');
      await enrichProspects(items.map(item => findLead.get(item.placeId)).filter(Boolean));
      const enrichedItems = items.map(item => {
        const saved = findLead.get(item.placeId);
        return { ...item, email: saved.email, whatsapp: saved.whatsapp,
          instagramUrl: saved.instagram_url, facebookUrl: saved.facebook_url, tiktokUrl: saved.tiktok_url,
          whatsappGroupUrl: saved.whatsapp_group_url,
          enrichmentStatus: saved.enrichment_status };
      });
      return res.json({ items: enrichedItems, autoSaved: items.length, source: 'google_places', searchedAt: new Date().toISOString() });
    } catch (error) { return res.status(502).json({ error: cleanText(error.message, 240) || 'Falha ao consultar o Google Places.' }); }
  });

  app.get('/api/admin/prospecting/leads', requireAdmin, (_req, res) => {
    const items = db.prepare(`SELECT * FROM business_prospects ORDER BY updated_at DESC, id DESC LIMIT 300`).all();
    return res.json({ items });
  });

  app.post('/api/admin/prospecting/enrich', requireAdmin, sameOriginOnly, async (req, res) => {
    if (!allowAttempt(searchAttempts, `enrich:${req.user.id}`, 3, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'A atualização automática poderá ser executada novamente mais tarde.' });
    }
    const rows = db.prepare(`SELECT * FROM business_prospects WHERE website_url<>'' AND
      (email='' OR whatsapp='' OR instagram_url='' OR facebook_url='' OR tiktok_url='' OR whatsapp_group_url='')
      ORDER BY CASE enrichment_status WHEN 'pending' THEN 0 ELSE 1 END,updated_at ASC LIMIT 25`).all();
    const results = await enrichProspects(rows);
    return res.json({ checked: rows.length, found: results.filter(item => item.enrichmentStatus === 'found').length });
  });

  app.post('/api/admin/prospecting/public-profiles', requireAdmin, sameOriginOnly, (req, res) => {
    const name = cleanText(req.body?.name, 180);
    const instagramUrl = cleanUrl(req.body?.instagramUrl), facebookUrl = cleanUrl(req.body?.facebookUrl);
    const tiktokUrl = cleanUrl(req.body?.tiktokUrl), whatsappGroupUrl = cleanUrl(req.body?.whatsappGroupUrl);
    if (whatsappGroupUrl && !isWhatsAppGroupUrl(whatsappGroupUrl)) return res.status(400).json({ error: 'Informe um convite público válido de grupo do WhatsApp.' });
    const profileUrl = instagramUrl || facebookUrl || tiktokUrl || whatsappGroupUrl;
    if (!name || !profileUrl) return res.status(400).json({ error: 'Informe o nome e pelo menos um perfil público.' });
    const source = instagramUrl ? 'instagram' : facebookUrl ? 'facebook' : tiktokUrl ? 'tiktok' : 'whatsapp_group';
    const email = cleanText(req.body?.email, 180);
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'E-mail inválido.' });
    const placeId = `public:${source}:${Buffer.from(profileUrl).toString('base64url').slice(0, 250)}`;
    db.prepare(`INSERT INTO business_prospects
      (place_id,name,address,category,phone_public,email,whatsapp,notes,source,instagram_url,facebook_url,tiktok_url,whatsapp_group_url,created_by)
      VALUES (@placeId,@name,@address,@category,@phonePublic,@email,@whatsapp,@notes,@source,@instagramUrl,@facebookUrl,@tiktokUrl,@whatsappGroupUrl,@createdBy)
      ON CONFLICT(place_id) DO UPDATE SET name=excluded.name,address=excluded.address,category=excluded.category,
      phone_public=excluded.phone_public,email=excluded.email,whatsapp=excluded.whatsapp,notes=excluded.notes,
      instagram_url=excluded.instagram_url,facebook_url=excluded.facebook_url,tiktok_url=excluded.tiktok_url,whatsapp_group_url=excluded.whatsapp_group_url,
      updated_at=CURRENT_TIMESTAMP`).run({
        placeId, name, address: cleanText(req.body?.address, 300), category: cleanText(req.body?.category, 100),
        phonePublic: cleanPhone(req.body?.phonePublic), email, whatsapp: cleanPhone(req.body?.whatsapp),
        notes: cleanText(req.body?.notes, 1200), source, instagramUrl, facebookUrl, tiktokUrl, whatsappGroupUrl,
        createdBy: req.user.id
      });
    return res.status(201).json({ ok: true });
  });

  app.post('/api/admin/prospecting/leads', requireAdmin, sameOriginOnly, (req, res) => {
    const placeId = cleanText(req.body?.placeId, 300), name = cleanText(req.body?.name, 180);
    if (!placeId || !name) return res.status(400).json({ error: 'Empresa do Google inválida.' });
    const values = {
      placeId, name, address: cleanText(req.body?.address, 300), category: cleanText(req.body?.category, 100),
      phonePublic: cleanPhone(req.body?.phonePublic), websiteUrl: cleanUrl(req.body?.websiteUrl), mapsUrl: cleanUrl(req.body?.mapsUrl),
      email: cleanText(req.body?.email, 180), whatsapp: cleanPhone(req.body?.whatsapp), notes: cleanText(req.body?.notes, 1200)
    };
    if (values.email && !/^\S+@\S+\.\S+$/.test(values.email)) return res.status(400).json({ error: 'E-mail inválido.' });
    db.prepare(`INSERT INTO business_prospects(place_id,name,address,category,phone_public,website_url,maps_url,email,whatsapp,notes,created_by)
      VALUES (@placeId,@name,@address,@category,@phonePublic,@websiteUrl,@mapsUrl,@email,@whatsapp,@notes,@createdBy)
      ON CONFLICT(place_id) DO UPDATE SET name=excluded.name,address=excluded.address,category=excluded.category,
      phone_public=excluded.phone_public,website_url=excluded.website_url,maps_url=excluded.maps_url,
      email=CASE WHEN excluded.email<>'' THEN excluded.email ELSE business_prospects.email END,
      whatsapp=CASE WHEN excluded.whatsapp<>'' THEN excluded.whatsapp ELSE business_prospects.whatsapp END,
      notes=CASE WHEN excluded.notes<>'' THEN excluded.notes ELSE business_prospects.notes END,
      updated_at=CURRENT_TIMESTAMP`).run({ ...values, createdBy: req.user.id });
    return res.status(201).json({ ok: true });
  });

  app.patch('/api/admin/prospecting/leads/:id', requireAdmin, sameOriginOnly, (req, res) => {
    const status = cleanText(req.body?.status, 30);
    const allowed = new Set(['new','reviewed','contacted','interested','registered','discarded']);
    if (!allowed.has(status)) return res.status(400).json({ error: 'Status inválido.' });
    const result = db.prepare('UPDATE business_prospects SET status=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(status, cleanText(req.body?.notes, 1200), Number(req.params.id));
    return result.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Empresa não encontrada.' });
  });

  app.get('/api/admin/prospecting/templates', requireAdmin, (_req, res) => {
    res.json({ items: db.prepare('SELECT code,title,body,updated_at FROM outreach_templates ORDER BY code').all() });
  });

  app.put('/api/admin/prospecting/templates/:code', requireAdmin, sameOriginOnly, (req, res) => {
    const code = cleanText(req.params.code, 40), title = cleanText(req.body?.title, 100), body = cleanText(req.body?.body, 1600);
    if (!/^[a-z0-9-]{3,40}$/.test(code) || !title || !body) return res.status(400).json({ error: 'Modelo inválido.' });
    db.prepare(`INSERT INTO outreach_templates(code,title,body,updated_by,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(code) DO UPDATE SET title=excluded.title,body=excluded.body,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`)
      .run(code, title, body, req.user.id);
    res.json({ ok: true });
  });

  app.post('/api/admin/prospecting/leads/:id/prepare-invite', requireAdmin, sameOriginOnly, (req, res) => {
    const channel = cleanText(req.body?.channel, 20), templateCode = cleanText(req.body?.templateCode, 40);
    const contactConfirmed = req.body?.contactConfirmed === true;
    if (!['whatsapp','email'].includes(channel) || !contactConfirmed) return res.status(400).json({ error: 'Confirme que o contato foi publicado pela empresa ou autorizado para receber a mensagem.' });
    const prospect = db.prepare('SELECT * FROM business_prospects WHERE id=?').get(Number(req.params.id));
    const template = db.prepare('SELECT * FROM outreach_templates WHERE code=?').get(templateCode);
    if (!prospect || !template) return res.status(404).json({ error: 'Empresa ou modelo não encontrado.' });
    const recipient = channel === 'whatsapp' ? cleanPhone(prospect.whatsapp || prospect.phone_public) : cleanText(prospect.email, 180);
    if (!recipient) return res.status(400).json({ error: channel === 'whatsapp' ? 'Cadastre um WhatsApp comercial antes de preparar o convite.' : 'Cadastre um e-mail comercial antes de preparar o convite.' });
    const message = cleanText(template.body.replaceAll('{{empresa}}', prospect.name), 1600);
    db.prepare(`INSERT INTO outreach_events(prospect_id,channel,template_code,message_body,contact_confirmed,created_by)
      VALUES (?,?,?,?,?,?)`).run(prospect.id, channel, template.code, message, 1, req.user.id);
    db.prepare(`UPDATE business_prospects SET status=CASE WHEN status='new' THEN 'contacted' ELSE status END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(prospect.id);
    const actionUrl = channel === 'whatsapp'
      ? `https://wa.me/${recipient.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`
      : `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent('Convite para a Vitrine City')}&body=${encodeURIComponent(message)}`;
    res.json({ actionUrl, message });
  });
}
import { lookup } from 'node:dns/promises';
import net from 'node:net';
