import path from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;
const SAFE_EVENTS = new Set([
  'page_view', 'click', 'lead', 'affiliate_signup', 'checkout_start',
  'purchase', 'store_view', 'whatsapp_click'
]);

const clean = (value, size = 160) => String(value || '').trim().slice(0, size);
const sessionId = req => /^[a-zA-Z0-9_-]{16,80}$/.test(String(req.get('x-vc-session') || ''))
  ? String(req.get('x-vc-session')) : '';
const cents = value => Math.round(Number(value || 0) * 100);

function rangeFromQuery(query) {
  const today = new Date();
  const end = /^\d{4}-\d{2}-\d{2}$/.test(String(query.to || '')) ? String(query.to) : today.toISOString().slice(0, 10);
  const fallback = new Date(Date.now() - 29 * DAY_MS).toISOString().slice(0, 10);
  const start = /^\d{4}-\d{2}-\d{2}$/.test(String(query.from || '')) ? String(query.from) : fallback;
  const safeStart = new Date(start) <= new Date(end) && new Date(end) - new Date(start) <= 366 * DAY_MS ? start : fallback;
  return { start: safeStart, end };
}

function dateList(start, end) {
  const result = [];
  for (let time = new Date(`${start}T12:00:00Z`).getTime(); time <= new Date(`${end}T12:00:00Z`).getTime(); time += DAY_MS) {
    result.push(new Date(time).toISOString().slice(0, 10));
  }
  return result;
}

function upsertAdMetric(db, row) {
  db.prepare(`INSERT INTO ad_metrics_daily
    (platform,date,campaign_id,campaign_name,impressions,clicks,spend_cents,conversions,conversion_value_cents)
    VALUES (@platform,@date,@campaignId,@campaignName,@impressions,@clicks,@spendCents,@conversions,@conversionValueCents)
    ON CONFLICT(platform,date,campaign_id) DO UPDATE SET campaign_name=excluded.campaign_name,
      impressions=excluded.impressions,clicks=excluded.clicks,spend_cents=excluded.spend_cents,
      conversions=excluded.conversions,conversion_value_cents=excluded.conversion_value_cents,
      synced_at=CURRENT_TIMESTAMP`).run(row);
}

const actionTotal = (items, names) => (items || []).filter(item => names.includes(item.action_type))
  .reduce((sum, item) => sum + Number(item.value || 0), 0);

async function syncMeta(db, start, end) {
  const token = process.env.META_ACCESS_TOKEN;
  let account = clean(process.env.META_AD_ACCOUNT_ID, 40).replace(/^act_/, '');
  if (!token || !account) throw new Error('Configure META_ACCESS_TOKEN e META_AD_ACCOUNT_ID.');
  const version = clean(process.env.META_API_VERSION || 'v24.0', 12);
  const fields = 'campaign_id,campaign_name,date_start,impressions,clicks,spend,actions,action_values';
  let url = new URL(`https://graph.facebook.com/${version}/act_${account}/insights`);
  url.searchParams.set('fields', fields);url.searchParams.set('time_increment', '1');
  url.searchParams.set('level', 'campaign');url.searchParams.set('limit', '500');
  url.searchParams.set('time_range', JSON.stringify({ since: start, until: end }));
  url.searchParams.set('access_token', token);
  let rows = 0;
  while (url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || `Meta respondeu ${response.status}.`);
    for (const item of data.data || []) {
      upsertAdMetric(db, { platform: 'meta', date: item.date_start, campaignId: String(item.campaign_id),
        campaignName: item.campaign_name || 'Campanha Meta', impressions: Number(item.impressions || 0),
        clicks: Number(item.clicks || 0), spendCents: cents(item.spend),
        conversions: actionTotal(item.actions, ['purchase', 'lead', 'complete_registration']),
        conversionValueCents: cents(actionTotal(item.action_values, ['purchase'])) });
      rows += 1;
    }
    url = data.paging?.next ? new URL(data.paging.next) : null;
  }
  return rows;
}

async function syncTikTok(db, start, end) {
  const token = process.env.TIKTOK_ACCESS_TOKEN;
  const advertiserId = clean(process.env.TIKTOK_ADVERTISER_ID, 40);
  if (!token || !advertiserId) throw new Error('Configure TIKTOK_ACCESS_TOKEN e TIKTOK_ADVERTISER_ID.');
  const url = new URL('https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/');
  url.searchParams.set('advertiser_id', advertiserId);url.searchParams.set('report_type', 'BASIC');
  url.searchParams.set('data_level', 'AUCTION_CAMPAIGN');
  url.searchParams.set('dimensions', JSON.stringify(['campaign_id', 'stat_time_day']));
  url.searchParams.set('metrics', JSON.stringify(['campaign_name','spend','impressions','clicks','conversion','total_purchase_value']));
  url.searchParams.set('start_date', start);url.searchParams.set('end_date', end);url.searchParams.set('page_size', '1000');
  const response = await fetch(url, { headers: { 'Access-Token': token }, signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok || Number(data.code || 0) !== 0) throw new Error(data.message || `TikTok respondeu ${response.status}.`);
  let rows = 0;
  for (const item of data.data?.list || []) {
    const dimensions = item.dimensions || {}, metrics = item.metrics || {};
    upsertAdMetric(db, { platform: 'tiktok', date: String(dimensions.stat_time_day || '').slice(0, 10),
      campaignId: String(dimensions.campaign_id || ''), campaignName: metrics.campaign_name || 'Campanha TikTok',
      impressions: Number(metrics.impressions || 0), clicks: Number(metrics.clicks || 0),
      spendCents: cents(metrics.spend), conversions: Number(metrics.conversion || 0),
      conversionValueCents: cents(metrics.total_purchase_value) });
    rows += 1;
  }
  return rows;
}

async function googleAccessToken() {
  const fields = ['GOOGLE_ADS_CLIENT_ID','GOOGLE_ADS_CLIENT_SECRET','GOOGLE_ADS_REFRESH_TOKEN'];
  if (fields.some(name => !process.env[name])) throw new Error(`Configure ${fields.join(', ')}.`);
  const body = new URLSearchParams({ client_id: process.env.GOOGLE_ADS_CLIENT_ID,
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET, refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    grant_type: 'refresh_token' });
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body,
    signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.error_description || 'Não foi possível autenticar no Google Ads.');
  return data.access_token;
}

async function syncGoogle(db, start, end) {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const customerId = clean(process.env.GOOGLE_ADS_CUSTOMER_ID, 30).replaceAll('-', '');
  if (!developerToken || !customerId) throw new Error('Configure GOOGLE_ADS_DEVELOPER_TOKEN e GOOGLE_ADS_CUSTOMER_ID.');
  const token = await googleAccessToken();
  const version = clean(process.env.GOOGLE_ADS_API_VERSION || 'v25', 8);
  const query = `SELECT campaign.id,campaign.name,segments.date,metrics.impressions,metrics.clicks,
    metrics.cost_micros,metrics.conversions,metrics.conversions_value FROM campaign
    WHERE segments.date BETWEEN '${start}' AND '${end}' AND campaign.status != 'REMOVED'`;
  const headers = { Authorization: `Bearer ${token}`, 'developer-token': developerToken, 'Content-Type': 'application/json' };
  if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) headers['login-customer-id'] = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replaceAll('-', '');
  const response = await fetch(`https://googleads.googleapis.com/${version}/customers/${customerId}/googleAds:searchStream`,
    { method: 'POST', headers, body: JSON.stringify({ query }), signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `Google Ads respondeu ${response.status}.`);
  let rows = 0;
  for (const batch of data || []) for (const item of batch.results || []) {
    upsertAdMetric(db, { platform: 'google', date: item.segments?.date, campaignId: String(item.campaign?.id || ''),
      campaignName: item.campaign?.name || 'Campanha Google', impressions: Number(item.metrics?.impressions || 0),
      clicks: Number(item.metrics?.clicks || 0), spendCents: Math.round(Number(item.metrics?.costMicros || 0) / 10000),
      conversions: Number(item.metrics?.conversions || 0), conversionValueCents: cents(item.metrics?.conversionsValue) });
    rows += 1;
  }
  return rows;
}

export function setupAdminAnalytics({ app, db, requireAdmin, publicDir }) {
  const eventAttempts = new Map();
  db.exec(`CREATE TABLE IF NOT EXISTS analytics_sessions (
    session_id TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),landing_path TEXT,referrer TEXT,
    utm_source TEXT,utm_medium TEXT,utm_campaign TEXT,utm_content TEXT,utm_term TEXT,
    gclid TEXT,fbclid TEXT,ttclid TEXT,consent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS analytics_events (
    id INTEGER PRIMARY KEY,session_id TEXT NOT NULL REFERENCES analytics_sessions(session_id),
    user_id INTEGER REFERENCES users(id),event_name TEXT NOT NULL,path TEXT,asset_type TEXT,asset_id TEXT,
    value_cents INTEGER NOT NULL DEFAULT 0,metadata_json TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS analytics_order_attribution (
    order_reference TEXT PRIMARY KEY,order_type TEXT NOT NULL,session_id TEXT,
    utm_source TEXT,utm_medium TEXT,utm_campaign TEXT,utm_content TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS ad_metrics_daily (
    id INTEGER PRIMARY KEY,platform TEXT NOT NULL,date TEXT NOT NULL,campaign_id TEXT NOT NULL,campaign_name TEXT,
    impressions INTEGER NOT NULL DEFAULT 0,clicks INTEGER NOT NULL DEFAULT 0,spend_cents INTEGER NOT NULL DEFAULT 0,
    conversions REAL NOT NULL DEFAULT 0,conversion_value_cents INTEGER NOT NULL DEFAULT 0,
    synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(platform,date,campaign_id)
  );
  CREATE TABLE IF NOT EXISTS ad_sync_runs (
    id INTEGER PRIMARY KEY,platform TEXT NOT NULL,status TEXT NOT NULL,rows_synced INTEGER NOT NULL DEFAULT 0,
    message TEXT,started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,finished_at TEXT
  );
  CREATE TABLE IF NOT EXISTS optimization_experiments (
    id INTEGER PRIMARY KEY,experiment_key TEXT NOT NULL UNIQUE,name TEXT NOT NULL,page_path TEXT NOT NULL,
    primary_event TEXT NOT NULL,conversion_asset TEXT,status TEXT NOT NULL DEFAULT 'active',
    min_sessions INTEGER NOT NULL DEFAULT 100,min_conversions INTEGER NOT NULL DEFAULT 10,
    winner_variant TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS optimization_variants (
    id INTEGER PRIMARY KEY,experiment_id INTEGER NOT NULL REFERENCES optimization_experiments(id) ON DELETE CASCADE,
    variant_key TEXT NOT NULL,label TEXT NOT NULL,config_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE(experiment_id,variant_key)
  );
  CREATE TABLE IF NOT EXISTS optimization_assignments (
    id INTEGER PRIMARY KEY,experiment_id INTEGER NOT NULL REFERENCES optimization_experiments(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,variant_key TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(experiment_id,session_id)
  );
  CREATE INDEX IF NOT EXISTS idx_analytics_events_date ON analytics_events(created_at,event_name);
  CREATE INDEX IF NOT EXISTS idx_ad_metrics_date ON ad_metrics_daily(date,platform);
  CREATE INDEX IF NOT EXISTS idx_optimization_assignments ON optimization_assignments(experiment_id,variant_key);`);
  const experiment = db.prepare(`INSERT OR IGNORE INTO optimization_experiments
    (experiment_key,name,page_path,primary_event,conversion_asset,status,min_sessions,min_conversions)
    VALUES ('home_primary_cta_2026_08','Botão principal da página inicial','/','click','/cidade-exploravel.html','active',100,10)`).run();
  const experimentId = db.prepare("SELECT id FROM optimization_experiments WHERE experiment_key='home_primary_cta_2026_08'").get().id;
  db.prepare(`INSERT OR IGNORE INTO optimization_variants
    (experiment_id,variant_key,label,config_json) VALUES (?,?,?,?)`).run(experimentId, 'control', 'Original', JSON.stringify({ changes: [] }));
  db.prepare(`INSERT OR IGNORE INTO optimization_variants
    (experiment_id,variant_key,label,config_json) VALUES (?,?,?,?)`).run(experimentId, 'challenger', 'Chamada direta',
      JSON.stringify({ changes: [{ selector: '.hero .actions .button', text: '🧭 Entrar agora na cidade' }] }));

  app.get(['/admin','/admin.html'], requireAdmin, (_req, res) => res.sendFile(path.join(publicDir, 'admin.html')));

  app.post('/api/analytics/events', (req, res) => {
    const sid = clean(req.body?.sessionId, 80);
    const eventName = clean(req.body?.eventName, 40);
    if (!/^[a-zA-Z0-9_-]{16,80}$/.test(sid) || !SAFE_EVENTS.has(eventName)) return res.status(400).json({ error: 'Evento inválido.' });
    const now = Date.now();
    const attempt = eventAttempts.get(sid) || { count: 0, resetAt: now + 60 * 60 * 1000 };
    if (now > attempt.resetAt) { attempt.count = 0; attempt.resetAt = now + 60 * 60 * 1000; }
    attempt.count += 1;eventAttempts.set(sid, attempt);
    if (attempt.count > 240) return res.status(429).json({ error: 'Limite de eventos atingido.' });
    const existing = db.prepare('SELECT session_id FROM analytics_sessions WHERE session_id=?').get(sid);
    const user = req.user || null;
    const values = { sid, userId: user?.id || null, landing: clean(req.body?.landingPath || req.body?.path, 300),
      referrer: clean(req.body?.referrer, 500), source: clean(req.body?.utmSource, 100), medium: clean(req.body?.utmMedium, 100),
      campaign: clean(req.body?.utmCampaign, 160), content: clean(req.body?.utmContent, 160), term: clean(req.body?.utmTerm, 160),
      gclid: clean(req.body?.gclid, 200), fbclid: clean(req.body?.fbclid, 200), ttclid: clean(req.body?.ttclid, 200) };
    if (!existing) db.prepare(`INSERT INTO analytics_sessions
      (session_id,user_id,landing_path,referrer,utm_source,utm_medium,utm_campaign,utm_content,utm_term,gclid,fbclid,ttclid)
      VALUES (@sid,@userId,@landing,@referrer,@source,@medium,@campaign,@content,@term,@gclid,@fbclid,@ttclid)`).run(values);
    else db.prepare('UPDATE analytics_sessions SET user_id=COALESCE(user_id,?),last_seen_at=CURRENT_TIMESTAMP WHERE session_id=?')
      .run(values.userId, sid);
    const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? JSON.stringify(req.body.metadata).slice(0, 2000) : null;
    db.prepare(`INSERT INTO analytics_events
      (session_id,user_id,event_name,path,asset_type,asset_id,value_cents,metadata_json) VALUES (?,?,?,?,?,?,?,?)`)
      .run(sid, values.userId, eventName, clean(req.body?.path, 300), clean(req.body?.assetType, 40),
        clean(req.body?.assetId, 120), Math.max(0, Number(req.body?.valueCents || 0)), metadata);
    return res.status(201).json({ ok: true });
  });

  const experimentHash = value => {
    let hash = 2166136261;
    for (const char of String(value)) { hash ^= char.charCodeAt(0);hash = Math.imul(hash, 16777619); }
    return hash >>> 0;
  };

  app.get('/api/experiments/assignment', (req, res) => {
    const sid = sessionId(req);
    const requestedPathRaw = clean(req.query.path || '/', 300);
    const requestedPath = requestedPathRaw === '/index.html' ? '/' : requestedPathRaw;
    if (!sid) return res.status(400).json({ error: 'Sessão inválida.' });
    const experiment = db.prepare(`SELECT * FROM optimization_experiments
      WHERE page_path=? AND status IN ('active','winner_found','adopted') ORDER BY id LIMIT 1`).get(requestedPath);
    if (!experiment) return res.json({ experiment: null });
    let assignment = db.prepare(`SELECT variant_key FROM optimization_assignments
      WHERE experiment_id=? AND session_id=?`).get(experiment.id, sid);
    if (!assignment) {
      const variants = db.prepare(`SELECT variant_key FROM optimization_variants
        WHERE experiment_id=? ORDER BY id`).all(experiment.id);
      let variantKey = variants[experimentHash(`${sid}:${experiment.experiment_key}`) % variants.length]?.variant_key;
      if (experiment.status === 'adopted' && experiment.winner_variant) {
        variantKey = experiment.winner_variant;
      } else if (experiment.status === 'winner_found' && experiment.winner_variant) {
        variantKey = experimentHash(`${sid}:winner`) % 100 < 90
          ? experiment.winner_variant
          : variants.find(item => item.variant_key !== experiment.winner_variant)?.variant_key || experiment.winner_variant;
      }
      db.prepare(`INSERT OR IGNORE INTO optimization_assignments
        (experiment_id,session_id,variant_key) VALUES (?,?,?)`).run(experiment.id, sid, variantKey);
      assignment = { variant_key: variantKey };
    }
    const variant = db.prepare(`SELECT variant_key,label,config_json FROM optimization_variants
      WHERE experiment_id=? AND variant_key=?`).get(experiment.id, assignment.variant_key);
    let config = {};
    try { config = JSON.parse(variant?.config_json || '{}'); } catch {}
    return res.json({ experiment: { key: experiment.experiment_key, name: experiment.name,
      variant: variant?.variant_key, label: variant?.label, config } });
  });

  function experimentReport(experiment) {
    const variants = db.prepare(`SELECT v.variant_key,v.label,
      COUNT(DISTINCT a.session_id) sessions,
      COUNT(DISTINCT CASE WHEN e.event_name=x.primary_event AND
        (x.conversion_asset IS NULL OR e.asset_id=x.conversion_asset) THEN a.session_id END) conversions,
      COALESCE(SUM(CASE WHEN e.event_name='purchase' THEN e.value_cents ELSE 0 END),0) revenue_cents
      FROM optimization_variants v
      JOIN optimization_experiments x ON x.id=v.experiment_id
      LEFT JOIN optimization_assignments a ON a.experiment_id=v.experiment_id AND a.variant_key=v.variant_key
      LEFT JOIN analytics_events e ON e.session_id=a.session_id AND e.created_at>=a.created_at
      WHERE v.experiment_id=? GROUP BY v.id ORDER BY v.id`).all(experiment.id)
      .map(row => ({ ...row, sessions: Number(row.sessions || 0), conversions: Number(row.conversions || 0),
        revenue_cents: Number(row.revenue_cents || 0),
        conversion_rate: row.sessions ? Number(row.conversions || 0) / Number(row.sessions) : 0 }));
    if (experiment.status === 'active' && variants.length > 1 &&
        variants.every(item => item.sessions >= experiment.min_sessions) &&
        variants.reduce((sum, item) => sum + item.conversions, 0) >= experiment.min_conversions) {
      const ranked = [...variants].sort((a, b) => b.conversion_rate - a.conversion_rate);
      const enoughLift = ranked[0].conversion_rate >= ranked[1].conversion_rate * 1.15 &&
        ranked[0].conversions >= ranked[1].conversions + 3;
      if (enoughLift) {
        db.prepare(`UPDATE optimization_experiments SET status='winner_found',winner_variant=?,
          updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='active'`).run(ranked[0].variant_key, experiment.id);
        experiment.status = 'winner_found';experiment.winner_variant = ranked[0].variant_key;
      }
    }
    return { ...experiment, variants };
  }

  app.get('/api/admin/experiments', requireAdmin, (_req, res) => {
    const experiments = db.prepare(`SELECT id,experiment_key,name,page_path,primary_event,conversion_asset,
      status,min_sessions,min_conversions,winner_variant,created_at,updated_at
      FROM optimization_experiments ORDER BY id DESC`).all().map(experimentReport);
    return res.json({ algorithm: { active: experiments.some(item => ['active','winner_found','adopted'].includes(item.status)),
      method: 'Teste A/B com distribuição determinística, mínimo de amostra e vantagem de 15%',
      safety: 'Sem alteração de preço ou investimento automático' }, experiments });
  });

  app.patch('/api/admin/experiments/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const action = clean(req.body?.action, 30);
    const experiment = db.prepare('SELECT * FROM optimization_experiments WHERE id=?').get(id);
    if (!experiment) return res.status(404).json({ error: 'Experimento não encontrado.' });
    if (action === 'pause') db.prepare("UPDATE optimization_experiments SET status='paused',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
    else if (action === 'resume') db.prepare("UPDATE optimization_experiments SET status='active',winner_variant=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
    else if (action === 'adopt_winner' && experiment.winner_variant) {
      db.prepare("UPDATE optimization_experiments SET status='adopted',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
    } else return res.status(400).json({ error: 'Ação indisponível.' });
    return res.json({ ok: true });
  });

  app.get('/api/admin/connectors', requireAdmin, (_req, res) => {
    const lastRuns = db.prepare(`SELECT r.* FROM ad_sync_runs r JOIN
      (SELECT platform,MAX(id) id FROM ad_sync_runs GROUP BY platform) x ON x.id=r.id`).all();
    const byPlatform = Object.fromEntries(lastRuns.map(item => [item.platform, item]));
    return res.json({ connectors: [
      { platform: 'meta', name: 'Meta Ads', configured: Boolean(process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID), lastRun: byPlatform.meta || null },
      { platform: 'google', name: 'Google Ads', configured: Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN && process.env.GOOGLE_ADS_CUSTOMER_ID && process.env.GOOGLE_ADS_REFRESH_TOKEN), lastRun: byPlatform.google || null },
      { platform: 'tiktok', name: 'TikTok Ads', configured: Boolean(process.env.TIKTOK_ACCESS_TOKEN && process.env.TIKTOK_ADVERTISER_ID), lastRun: byPlatform.tiktok || null }
    ] });
  });

  app.post('/api/admin/ads/sync', requireAdmin, async (req, res) => {
    const { start, end } = rangeFromQuery(req.body || {});
    const requested = clean(req.body?.platform, 20);
    const jobs = { meta: syncMeta, google: syncGoogle, tiktok: syncTikTok };
    const platforms = requested && jobs[requested] ? [requested] : Object.keys(jobs);
    const results = [];
    for (const platform of platforms) {
      const run = db.prepare("INSERT INTO ad_sync_runs(platform,status) VALUES (?,'running')").run(platform);
      try {
        const rows = await jobs[platform](db, start, end);
        db.prepare("UPDATE ad_sync_runs SET status='success',rows_synced=?,message='Sincronização concluída',finished_at=CURRENT_TIMESTAMP WHERE id=?")
          .run(rows, run.lastInsertRowid);results.push({ platform, ok: true, rows });
      } catch (error) {
        const message = clean(error?.message || 'Falha na sincronização', 500);
        db.prepare("UPDATE ad_sync_runs SET status='error',message=?,finished_at=CURRENT_TIMESTAMP WHERE id=?")
          .run(message, run.lastInsertRowid);results.push({ platform, ok: false, error: message });
      }
    }
    return res.json({ start, end, results });
  });

  app.get('/api/admin/dashboard', requireAdmin, (req, res) => {
    const { start, end } = rangeFromQuery(req.query);
    const params = { start, end };
    const visitors = db.prepare(`SELECT COUNT(*) total FROM analytics_sessions
      WHERE date(first_seen_at) BETWEEN @start AND @end`).get(params).total;
    const leads = db.prepare(`SELECT COUNT(*) total FROM leads WHERE date(created_at) BETWEEN @start AND @end`).get(params).total;
    const users = db.prepare(`SELECT COUNT(*) total FROM users WHERE date(created_at) BETWEEN @start AND @end`).get(params).total;
    const affiliates = db.prepare(`SELECT COUNT(*) total FROM affiliates WHERE date(created_at) BETWEEN @start AND @end`).get(params).total;
    const sales = db.prepare(`SELECT SUM(qty) qty,SUM(revenue) revenue FROM (
      SELECT COUNT(*) qty,COALESCE(SUM(amount_cents),0) revenue FROM lot_orders WHERE status='approved' AND date(updated_at) BETWEEN @start AND @end
      UNION ALL SELECT COUNT(*),COALESCE(SUM(amount_cents),0) FROM course_orders WHERE status='approved' AND date(updated_at) BETWEEN @start AND @end
      UNION ALL SELECT COUNT(*),COALESCE(SUM(amount_cents),0) FROM credit_orders WHERE status='approved' AND date(updated_at) BETWEEN @start AND @end
      UNION ALL SELECT COUNT(*),COALESCE(SUM(amount_cents),0) FROM service_orders WHERE status='approved' AND date(updated_at) BETWEEN @start AND @end)`).get(params);
    const ads = db.prepare(`SELECT COALESCE(SUM(spend_cents),0) spend,COALESCE(SUM(impressions),0) impressions,
      COALESCE(SUM(clicks),0) clicks,COALESCE(SUM(conversions),0) conversions,
      COALESCE(SUM(conversion_value_cents),0) conversion_value FROM ad_metrics_daily WHERE date BETWEEN @start AND @end`).get(params);
    const assets = db.prepare(`SELECT * FROM (
      SELECT 'Lotes' asset,COUNT(*) sales,COALESCE(SUM(amount_cents),0) revenue FROM lot_orders WHERE status='approved' AND date(updated_at) BETWEEN @start AND @end
      UNION ALL SELECT 'Cursos',COUNT(*),COALESCE(SUM(amount_cents),0) FROM course_orders WHERE status='approved' AND date(updated_at) BETWEEN @start AND @end
      UNION ALL SELECT 'Moedas',COUNT(*),COALESCE(SUM(amount_cents),0) FROM credit_orders WHERE status='approved' AND date(updated_at) BETWEEN @start AND @end
      UNION ALL SELECT 'Vídeos',COUNT(*),COALESCE(SUM(amount_cents),0) FROM service_orders WHERE status='approved' AND date(updated_at) BETWEEN @start AND @end)`).all(params);
    const campaigns = db.prepare(`SELECT platform,campaign_id,campaign_name,SUM(impressions) impressions,SUM(clicks) clicks,
      SUM(spend_cents) spend_cents,SUM(conversions) conversions,SUM(conversion_value_cents) conversion_value_cents
      FROM ad_metrics_daily WHERE date BETWEEN @start AND @end GROUP BY platform,campaign_id,campaign_name ORDER BY spend_cents DESC LIMIT 100`).all(params);
    const sources = db.prepare(`SELECT COALESCE(NULLIF(a.utm_source,''),'direto') source,
      COALESCE(NULLIF(a.utm_medium,''),'sem mídia') medium,COALESCE(NULLIF(a.utm_campaign,''),'sem campanha') campaign,
      COUNT(*) orders,SUM(CASE a.order_type
        WHEN 'lot' THEN (SELECT amount_cents FROM lot_orders WHERE reference=a.order_reference AND status='approved')
        WHEN 'course' THEN (SELECT amount_cents FROM course_orders WHERE reference=a.order_reference AND status='approved')
        WHEN 'credits' THEN (SELECT amount_cents FROM credit_orders WHERE reference=a.order_reference AND status='approved')
        WHEN 'video_package' THEN (SELECT amount_cents FROM service_orders WHERE reference=a.order_reference AND status='approved')
        ELSE 0 END) revenue_cents
      FROM analytics_order_attribution a WHERE date(a.created_at) BETWEEN @start AND @end
      GROUP BY source,medium,campaign ORDER BY revenue_cents DESC LIMIT 100`).all(params)
      .filter(item => Number(item.revenue_cents || 0) > 0);
    const funnelRows = db.prepare(`SELECT event_name,COUNT(*) total FROM analytics_events
      WHERE date(created_at) BETWEEN @start AND @end GROUP BY event_name`).all(params);
    const funnel = Object.fromEntries(funnelRows.map(item => [item.event_name, item.total]));
    const revenueDaily = db.prepare(`SELECT day,SUM(revenue) revenue FROM (
      SELECT date(updated_at) day,SUM(amount_cents) revenue FROM lot_orders WHERE status='approved' AND date(updated_at) BETWEEN @start AND @end GROUP BY day
      UNION ALL SELECT date(updated_at),SUM(amount_cents) FROM course_orders WHERE status='approved' AND date(updated_at) BETWEEN @start AND @end GROUP BY date(updated_at)
      UNION ALL SELECT date(updated_at),SUM(amount_cents) FROM credit_orders WHERE status='approved' AND date(updated_at) BETWEEN @start AND @end GROUP BY date(updated_at)
      UNION ALL SELECT date(updated_at),SUM(amount_cents) FROM service_orders WHERE status='approved' AND date(updated_at) BETWEEN @start AND @end GROUP BY date(updated_at)) GROUP BY day`).all(params);
    const spendDaily = db.prepare(`SELECT date day,SUM(spend_cents) spend FROM ad_metrics_daily
      WHERE date BETWEEN @start AND @end GROUP BY date`).all(params);
    const revenueMap = Object.fromEntries(revenueDaily.map(item => [item.day, item.revenue]));
    const spendMap = Object.fromEntries(spendDaily.map(item => [item.day, item.spend]));
    const daily = dateList(start, end).map(date => ({ date, revenueCents: revenueMap[date] || 0, spendCents: spendMap[date] || 0 }));
    const recentLeads = db.prepare(`SELECT name,email,whatsapp,interest,created_at FROM leads
      WHERE date(created_at) BETWEEN @start AND @end ORDER BY id DESC LIMIT 100`).all(params);
    return res.json({ range: { start, end }, summary: { visitors, leads, users, affiliates,
      sales: Number(sales.qty || 0), revenueCents: Number(sales.revenue || 0), spendCents: Number(ads.spend || 0),
      impressions: Number(ads.impressions || 0), clicks: Number(ads.clicks || 0), platformConversions: Number(ads.conversions || 0),
      platformConversionValueCents: Number(ads.conversion_value || 0), conversionRate: visitors ? Number(sales.qty || 0) / visitors : 0,
      roas: ads.spend ? Number(sales.revenue || 0) / Number(ads.spend) : null }, assets, campaigns, sources, funnel, daily, recentLeads });
  });

  function serverEvent(req, eventName, assetType, assetId, valueCents = 0) {
    const sid = sessionId(req);if (!sid) return;
    const source = db.prepare('SELECT session_id,user_id FROM analytics_sessions WHERE session_id=?').get(sid);if (!source) return;
    db.prepare(`INSERT INTO analytics_events
      (session_id,user_id,event_name,path,asset_type,asset_id,value_cents) VALUES (?,?,?,?,?,?,?)`)
      .run(sid, source.user_id, eventName, clean(req.originalUrl, 300), clean(assetType, 40), clean(assetId, 120), valueCents);
  }

  return {
    recordOrderAttribution(req, orderReference, orderType) {
      const sid = sessionId(req);if (!sid) return;
      const source = db.prepare('SELECT * FROM analytics_sessions WHERE session_id=?').get(sid);if (!source) return;
      db.prepare(`INSERT OR REPLACE INTO analytics_order_attribution
        (order_reference,order_type,session_id,utm_source,utm_medium,utm_campaign,utm_content) VALUES (?,?,?,?,?,?,?)`)
        .run(orderReference, orderType, sid, source.utm_source, source.utm_medium, source.utm_campaign, source.utm_content);
    },
    recordLead(req, interest) {
      serverEvent(req, 'lead', 'lead', interest);
    },
    recordCheckout(req, reference, orderType, valueCents) {
      serverEvent(req, 'checkout_start', orderType, reference, valueCents);
    },
    recordPurchase(orderReference, orderType, valueCents) {
      const source = db.prepare('SELECT session_id FROM analytics_order_attribution WHERE order_reference=?').get(orderReference);
      if (!source?.session_id) return;
      const exists = db.prepare("SELECT 1 FROM analytics_events WHERE event_name='purchase' AND asset_id=? LIMIT 1").get(orderReference);
      if (exists) return;
      db.prepare(`INSERT INTO analytics_events
        (session_id,event_name,path,asset_type,asset_id,value_cents) VALUES (?,'purchase','/webhook',?,?,?)`)
        .run(source.session_id, orderType, orderReference, valueCents);
    }
  };
}
