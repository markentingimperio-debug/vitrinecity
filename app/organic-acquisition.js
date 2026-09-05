import path from 'node:path';

const LIMIT = 10000;
const belongs = (host, domain) => host === domain || host.endsWith(`.${domain}`);
export function classifyAcquisition(row) {
  const medium = String(row.utm_medium || '').toLowerCase();
  if (/^(cpc|ppc|paid|paid_social|paid_search|display|cpm|retargeting)$/.test(medium) || row.gclid) return 'Mídia paga identificada';
  if (medium === 'organic_social') return 'Social orgânico identificado';
  if (medium === 'organic') return 'Orgânico identificado';
  if (['referral', 'group'].includes(medium)) return 'Indicação identificada';
  if (medium || row.utm_source) return 'Outra campanha identificada';
  let host = '';
  try { host = new URL(row.referrer).hostname.toLowerCase(); } catch {}
  if (['google.com', 'google.com.br', 'bing.com', 'duckduckgo.com', 'search.yahoo.com'].some(d => belongs(host, d))) return 'Busca orgânica provável';
  if (['instagram.com', 'facebook.com', 'tiktok.com', 'youtube.com', 'youtu.be', 'kwai.com', 't.co', 'pinterest.com'].some(d => belongs(host, d))) return 'Social / referência provável';
  if (host && !belongs(host, 'vitrinecity.com')) return 'Outras referências';
  return 'Direto / origem desconhecida';
}

function landingGroup(value) {
  const pathname = String(value || '').split(/[?#]/)[0];
  if (['/', '/loja', '/social', '/entrar.html', '/plantas-e-jardinagem', '/guias/plantas-em-vasos.html'].includes(pathname)) return pathname;
  if (pathname.startsWith('/produto/')) return '/produto/…';
  if (pathname.startsWith('/loja/')) return '/loja/…';
  return 'Outras páginas';
}

export function acquisitionReport(db, days, now = new Date()) {
  const end = now.toISOString().slice(0, 19).replace('T', ' ');
  const start = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const rows = db.prepare(`WITH cohort AS (
    SELECT session_id,landing_path,referrer,utm_source,utm_medium,utm_campaign,utm_content,gclid
    FROM analytics_sessions WHERE first_seen_at>=? AND first_seen_at<=?
    ORDER BY first_seen_at DESC,session_id LIMIT ?
  ), activity AS (
    SELECT e.session_id,
      MAX(CASE WHEN e.event_name='click' AND e.asset_type='organic_cta' THEN 1 ELSE 0 END) engaged,
      MAX(CASE WHEN e.event_name='signup_confirmed' THEN 1 ELSE 0 END) signup
    FROM analytics_events e JOIN cohort c ON c.session_id=e.session_id
    WHERE e.created_at>=? AND e.created_at<=? GROUP BY e.session_id
  ) SELECT c.*,COALESCE(a.engaged,0) engaged,COALESCE(a.signup,0) signup
    FROM cohort c LEFT JOIN activity a ON a.session_id=c.session_id`).all(start, end, LIMIT + 1, start, end);
  const channels = new Map(), landings = new Map(), campaigns = new Map();
  const summary = { sessions: 0, engagedSessions: 0, signupSessions: 0 };
  const add = (map, label, row) => {
    const value = map.get(label) || { label, sessions: 0, engagedSessions: 0, signupSessions: 0 };
    value.sessions++; value.engagedSessions += row.engaged; value.signupSessions += row.signup;
    map.set(label, value);
  };
  for (const row of rows.slice(0, LIMIT)) {
    summary.sessions++; summary.engagedSessions += row.engaged; summary.signupSessions += row.signup;
    add(channels, classifyAcquisition(row), row);
    add(landings, landingGroup(row.landing_path), row);
    // The campaign builder uses slugs, never email addresses or arbitrary URLs.
    const campaign = /^[a-z0-9_-]{1,80}$/.test(row.utm_campaign || '') ? row.utm_campaign : 'Sem campanha válida';
    const slug = value => /^[a-z0-9_-]{1,80}$/.test(value || '') ? value : 'não informado';
    add(campaigns, `${campaign} · ${slug(row.utm_source)} · ${slug(row.utm_content)}`, row);
  }
  const sorted = map => [...map.values()].sort((a, b) => b.sessions - a.sessions).slice(0, 30);
  return { range: { days, start, end }, truncated: rows.length > LIMIT, limit: LIMIT, summary,
    channels: sorted(channels), landings: sorted(landings), campaigns: sorted(campaigns) };
}

export function recordAcquisitionSignup(db, req, userId) {
  try {
    const sid = String(req.get('x-vc-session') || '');
    if (req.get('x-vc-analytics-consent') !== 'accepted' || !/^[a-zA-Z0-9_-]{16,80}$/.test(sid) || !Number.isSafeInteger(userId) || userId < 1) return;
    if (!db.prepare('SELECT 1 FROM analytics_sessions WHERE session_id=?').get(sid)) return;
    if (db.prepare("SELECT 1 FROM analytics_events WHERE event_name='signup_confirmed' AND user_id=? LIMIT 1").get(userId)) return;
    db.prepare(`INSERT INTO analytics_events(session_id,user_id,event_name,path,asset_type,asset_id)
      VALUES (?,?,'signup_confirmed',?,'account','')`).run(sid, userId, req.path);
  } catch {
    // Optional measurement must never fail an otherwise valid registration.
    console.warn('[organic-acquisition] Registration measurement unavailable');
  }
}

export function setupOrganicAcquisition({ app, db, requireAdmin, publicDir }) {
  app.get('/admin-captacao.html', requireAdmin, (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDir, 'admin-captacao.html'));
  });
  app.get('/api/admin/organic-acquisition', requireAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const days = req.query.days === undefined ? 30 : Number(req.query.days);
    if (![7, 30].includes(days) || (req.query.days !== undefined && !/^(7|30)$/.test(String(req.query.days)))) return res.status(400).json({ error: 'Escolha 7 ou 30 dias.' });
    res.json(acquisitionReport(db, days));
  });
}
