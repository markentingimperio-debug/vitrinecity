import express from 'express';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const app = express();
const port = Number(process.env.MULTIVERSAL_PORT || process.env.PORT || 3001);
const dataDir = process.env.DATA_DIR || '/data';
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'vitrinecity.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const DEFAULT_CITY = 'silvania-go';
const transitionAttempts = new Map();

const SEED_CITIES = Object.freeze([
  Object.freeze({ slug:'silvania-go', name:'Silvânia', state:'Goiás', stateCode:'GO', status:'pilot', sortOrder:10 }),
  Object.freeze({ slug:'anapolis-go', name:'Anápolis', state:'Goiás', stateCode:'GO', status:'enabled', sortOrder:20 }),
  Object.freeze({ slug:'vianopolis-go', name:'Vianópolis', state:'Goiás', stateCode:'GO', status:'enabled', sortOrder:30 })
]);

const SEED_REALMS = Object.freeze([
  Object.freeze({ slug:'centro-25d', title:'Centro Vitrine 2.5D', category:'experience', categoryLabel:'Experiência', badge:'CIDADE DIGITAL', entryPath:'/cidade-25d-demo.html', imagePath:'/assets/centro-vitrine-25d-v2.webp', description:'Explore ruas, prédios, lojas, serviços e atrações em uma cidade navegável em perspectiva 2.5D.', sortOrder:10 }),
  Object.freeze({ slug:'mapa-real', title:'Vitrine no Mundo Real', category:'mobility', categoryLabel:'Mobilidade', badge:'MAPA REAL', entryPath:'/mapa-real.html', imagePath:'/assets/mapa-mestre.jpg', description:'Veja empresas e pontos da plataforma no mapa real e conecte a experiência digital ao endereço físico.', sortOrder:20 }),
  Object.freeze({ slug:'vitriny-social', title:'Vitriny Social', category:'social', categoryLabel:'Social', badge:'REDE SOCIAL', entryPath:'/social.html', imagePath:'/assets/vitriny-city-norte.jpg', description:'Descubra pessoas, empresas, vídeos, publicações e tendências dentro da camada social da VitrineCity.', sortOrder:30 }),
  Object.freeze({ slug:'mercado', title:'Mercado & Lojas', category:'commerce', categoryLabel:'Comércio', badge:'MARKETPLACE', entryPath:'/loja.html', imagePath:'/assets/vitriny-city-leste.jpg', description:'Entre nas vitrines comerciais, conheça produtos e conecte descoberta, loja e compra no mesmo ecossistema.', sortOrder:40 }),
  Object.freeze({ slug:'entregas', title:'Vitrine Entregas', category:'mobility', categoryLabel:'Mobilidade', badge:'LOGÍSTICA', entryPath:'/entregas.html', imagePath:'/assets/vc-entregas-hero.png', description:'Camada logística para pedidos locais, entregadores, acompanhamento e conexão entre loja e cliente.', sortOrder:50 }),
  Object.freeze({ slug:'educacao', title:'Centro Educacional', category:'experience', categoryLabel:'Experiência', badge:'CONHECIMENTO', entryPath:'/centro-educacional.html', imagePath:'/assets/centro-educacional-premium-v2.png', description:'Cursos, materiais, conteúdos e experiências de aprendizado integrados à cidade digital.', sortOrder:60 }),
  Object.freeze({ slug:'neural', title:'Vitriny Neural', category:'intelligence', categoryLabel:'Inteligência', badge:'IA DA CIDADE', entryPath:'/jarvis-public.html', imagePath:'/assets/cidade-premium.jpg', description:'A camada de inteligência que pesquisa, orienta e conecta capacidades da plataforma em uma única interface.', sortOrder:70 }),
  Object.freeze({ slug:'navegar', title:'Portal de Navegação', category:'mobility', categoryLabel:'Mobilidade', badge:'ROTAS & CIDADES', entryPath:'/navegar.html', imagePath:'/assets/vitriny-city-base.jpg', description:'Ponto de passagem entre cidades, rotas e experiências geográficas do ecossistema VitrineCity.', sortOrder:80 })
]);

db.exec(`
CREATE TABLE IF NOT EXISTS multiversal_cities (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  state TEXT NOT NULL,
  state_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'enabled' CHECK(status IN ('pilot','enabled','paused')),
  sort_order INTEGER NOT NULL DEFAULT 100,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS multiversal_realms (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  category_label TEXT NOT NULL,
  badge TEXT NOT NULL,
  entry_path TEXT NOT NULL,
  image_path TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'enabled' CHECK(status IN ('enabled','paused')),
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS multiversal_city_realms (
  city_slug TEXT NOT NULL REFERENCES multiversal_cities(slug) ON DELETE CASCADE,
  realm_slug TEXT NOT NULL REFERENCES multiversal_realms(slug) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'enabled' CHECK(status IN ('enabled','paused')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(city_slug, realm_slug)
);
CREATE TABLE IF NOT EXISTS multiversal_transitions (
  id INTEGER PRIMARY KEY,
  city_slug TEXT NOT NULL REFERENCES multiversal_cities(slug),
  from_realm TEXT,
  to_realm TEXT NOT NULL REFERENCES multiversal_realms(slug),
  source_path TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_multiversal_transitions_city_created
ON multiversal_transitions(city_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_multiversal_transitions_realm_created
ON multiversal_transitions(to_realm, created_at DESC);
`);

const seed = db.transaction(() => {
  const cityInsert = db.prepare(`INSERT INTO multiversal_cities(slug,name,state,state_code,status,sort_order)
    VALUES (@slug,@name,@state,@stateCode,@status,@sortOrder)
    ON CONFLICT(slug) DO UPDATE SET name=excluded.name,state=excluded.state,state_code=excluded.state_code,
      status=CASE WHEN multiversal_cities.status='paused' THEN 'paused' ELSE excluded.status END,
      sort_order=excluded.sort_order,updated_at=CURRENT_TIMESTAMP`);
  for (const city of SEED_CITIES) cityInsert.run(city);

  const realmInsert = db.prepare(`INSERT INTO multiversal_realms
    (slug,title,category,category_label,badge,entry_path,image_path,description,status,sort_order)
    VALUES (@slug,@title,@category,@categoryLabel,@badge,@entryPath,@imagePath,@description,'enabled',@sortOrder)
    ON CONFLICT(slug) DO UPDATE SET title=excluded.title,category=excluded.category,
      category_label=excluded.category_label,badge=excluded.badge,entry_path=excluded.entry_path,
      image_path=excluded.image_path,description=excluded.description,sort_order=excluded.sort_order,
      updated_at=CURRENT_TIMESTAMP`);
  for (const realm of SEED_REALMS) realmInsert.run(realm);

  const cityRealmInsert = db.prepare(`INSERT OR IGNORE INTO multiversal_city_realms(city_slug,realm_slug,status)
    VALUES (?,?,'enabled')`);
  for (const city of SEED_CITIES) for (const realm of SEED_REALMS) cityRealmInsert.run(city.slug, realm.slug);
});
seed();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit:'16kb' }));
app.use((req,res,next) => {
  res.set({
    'X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'SAMEORIGIN',
    'Referrer-Policy':'strict-origin-when-cross-origin',
    'Cache-Control': req.method === 'GET' ? 'public, max-age=30' : 'no-store'
  });
  next();
});

function safeSlug(value) {
  const slug = String(value || '').trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : '';
}

function cityBySlug(value) {
  const slug = safeSlug(value) || DEFAULT_CITY;
  return db.prepare(`SELECT slug,name,state,state_code stateCode,status,sort_order sortOrder
    FROM multiversal_cities WHERE slug=? AND status IN ('pilot','enabled')`).get(slug)
    || db.prepare(`SELECT slug,name,state,state_code stateCode,status,sort_order sortOrder
      FROM multiversal_cities WHERE slug=? AND status IN ('pilot','enabled')`).get(DEFAULT_CITY)
    || null;
}

function realmBySlug(value, citySlug) {
  const slug = safeSlug(value);
  if (!slug) return null;
  return db.prepare(`SELECT r.slug,r.title,r.category,r.category_label categoryLabel,r.badge,
    r.entry_path entryPath,r.image_path imagePath,r.description,r.status,r.sort_order sortOrder
    FROM multiversal_realms r
    JOIN multiversal_city_realms cr ON cr.realm_slug=r.slug
    WHERE r.slug=? AND cr.city_slug=? AND r.status='enabled' AND cr.status='enabled'`).get(slug, citySlug) || null;
}

function appendCity(entryPath, citySlug) {
  const separator = entryPath.includes('?') ? '&' : '?';
  return `${entryPath}${separator}cidade=${encodeURIComponent(citySlug)}`;
}

function publicRealm(row, citySlug) {
  return { ...row, href:appendCity(row.entryPath, citySlug) };
}

function sameOrigin(req) {
  const origin = String(req.get('origin') || '');
  if (!origin) return true;
  try { return new URL(origin).host === String(req.get('host') || ''); }
  catch { return false; }
}

function allowTransition(req) {
  const key = String(req.ip || 'unknown');
  const now = Date.now();
  const attempts = (transitionAttempts.get(key) || []).filter(time => now - time < 60_000);
  if (attempts.length >= 120) return false;
  attempts.push(now);
  transitionAttempts.set(key, attempts);
  if (transitionAttempts.size > 2000) {
    for (const [candidate,times] of transitionAttempts) {
      if (!times.some(time => now - time < 60_000)) transitionAttempts.delete(candidate);
    }
  }
  return true;
}

app.get('/api/multiversal/health', (_req,res) => {
  res.set('Cache-Control','no-store');
  return res.json({ ok:true, service:'vitrinecity-multiversal-core', database:'connected', now:new Date().toISOString() });
});

app.get('/api/multiversal/cities', (_req,res) => {
  const items = db.prepare(`SELECT slug,name,state,state_code stateCode,status,sort_order sortOrder
    FROM multiversal_cities WHERE status IN ('pilot','enabled') ORDER BY sort_order,name`).all();
  return res.json({ items, defaultCity:DEFAULT_CITY, updatedAt:new Date().toISOString() });
});

app.get('/api/multiversal/realms', (req,res) => {
  const city = cityBySlug(req.query.cidade);
  if (!city) return res.status(503).json({ error:'Nenhuma cidade do Multiversal está disponível.' });
  const items = db.prepare(`SELECT r.slug,r.title,r.category,r.category_label categoryLabel,r.badge,
      r.entry_path entryPath,r.image_path imagePath,r.description,r.status,r.sort_order sortOrder
    FROM multiversal_realms r
    JOIN multiversal_city_realms cr ON cr.realm_slug=r.slug
    WHERE cr.city_slug=? AND r.status='enabled' AND cr.status='enabled'
    ORDER BY r.sort_order,r.title`).all(city.slug).map(row => publicRealm(row, city.slug));
  return res.json({ city, items, updatedAt:new Date().toISOString() });
});

app.get('/api/multiversal/context', (req,res) => {
  const city = cityBySlug(req.query.cidade);
  if (!city) return res.status(503).json({ error:'Nenhuma cidade do Multiversal está disponível.' });
  const requestedRealm = safeSlug(req.query.universo);
  const realm = requestedRealm ? realmBySlug(requestedRealm, city.slug) : null;
  return res.json({
    city,
    realm: realm ? publicRealm(realm, city.slug) : null,
    multiversalPath:`/multiversal.html?cidade=${encodeURIComponent(city.slug)}${realm ? `&universo=${encodeURIComponent(realm.slug)}` : ''}`,
    updatedAt:new Date().toISOString()
  });
});

app.post('/api/multiversal/transition', (req,res) => {
  res.set('Cache-Control','no-store');
  if (!sameOrigin(req)) return res.status(403).json({ error:'Origem da transição não autorizada.' });
  if (!allowTransition(req)) return res.status(429).json({ error:'Muitas transições em pouco tempo.' });

  const city = cityBySlug(req.body?.citySlug || req.body?.cidade);
  if (!city) return res.status(400).json({ error:'Cidade inválida.' });
  const toRealm = realmBySlug(req.body?.toRealm, city.slug);
  if (!toRealm) return res.status(400).json({ error:'Universo de destino inválido para esta cidade.' });

  const fromSlug = safeSlug(req.body?.fromRealm);
  const fromRealm = fromSlug ? realmBySlug(fromSlug, city.slug) : null;
  let sourcePath = String(req.body?.sourcePath || '').trim().slice(0,240);
  if (sourcePath && !/^\/[A-Za-z0-9_./?=&%-]*$/.test(sourcePath)) sourcePath = '';

  db.prepare(`INSERT INTO multiversal_transitions(city_slug,from_realm,to_realm,source_path)
    VALUES (?,?,?,?)`).run(city.slug, fromRealm?.slug || null, toRealm.slug, sourcePath);

  return res.status(201).json({
    ok:true,
    city,
    fromRealm:fromRealm?.slug || null,
    toRealm:toRealm.slug,
    href:appendCity(toRealm.entryPath, city.slug)
  });
});

app.use((req,res) => res.status(404).json({ error:'Rota Multiversal não encontrada.' }));

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`VitrineCity Multiversal Core listening on ${port}`);
});

function shutdown() {
  server.close(() => {
    try { db.close(); } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
