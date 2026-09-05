import fs from 'node:fs';
import { affiliateArticles } from './affiliate-articles.js';
import { setupAffiliateIndexNow } from './affiliate-indexnow.js';
import { setupPlatformOperations } from './platform-operations.js';

export const platforms = { mercadolivre: 'Mercado Livre', shopee: 'Shopee', tiktok: 'TikTok' };
const hosts = {
  mercadolivre: ['meli.la', 'mercadolivre.com.br'],
  shopee: ['shopee.com.br', 's.shopee.com.br', 'shope.ee'],
  tiktok: ['tiktok.com', 'getstartedtiktok.partnerlinks.io']
};
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function validAffiliateUrl(value, platform) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') &&
      (hosts[platform] || []).some(h => u.hostname === h || u.hostname.endsWith('.'+h));
  } catch { return false; }
}

// A successful HTTP response confirms reachability only, never stock or commission.
// Every redirect is validated; no requests to arbitrary admin-supplied hosts.
export async function checkAffiliateLink(url, platform, fetcher = fetch) {
  const signal = AbortSignal.timeout(12000);
  try {
    for (let i = 0; i < 6; i++) {
      if (!validAffiliateUrl(url, platform)) return 'review';
      const response = await fetcher(url, { method:'HEAD', redirect:'manual', signal });
      if ([301,302,303,307,308].includes(response.status)) {
        const next = response.headers.get('location');
        if (!next) return 'review';
        url = new URL(next, url).href;
        continue;
      }
      if ([404,410].includes(response.status)) return 'broken';
      return response.ok ? 'reachable' : 'review';
    }
  } catch { /* timeouts, blocks and failures require review, not stock changes */ }
  return 'review';
}

function document(title, body, canonical, image = '', description = '') {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | VitrineCity</title><meta name="description" content="${esc(description || title)}"><link rel="canonical" href="${esc(canonical)}"><meta property="og:description" content="${esc(description || title)}"><meta property="og:site_name" content="VitrineCity"><meta property="og:title" content="${esc(title)}"><meta property="og:type" content="website"><meta property="og:url" content="${esc(canonical)}">${image ? `<meta property="og:image" content="${esc(image)}">` : ''}<link rel="stylesheet" href="/affiliate-catalog.css"></head><body><header><a class="brand" href="/">vitrine<span>city</span></a><nav><a href="/pesquisar.html">Pesquisar</a><a href="/ofertas">Seleção de produtos</a></nav></header><main>${body}</main><footer>VitrineCity · <a href="/privacy.html">Privacidade</a> · <a href="/contato.html">Contato</a></footer></body></html>`;
}

export function setupAffiliateCatalog({ app, db, requireAdmin, sameOriginOnly, siteUrl, publicDir, startMonitor = true, fetcher = fetch }) {
  db.exec(`CREATE TABLE IF NOT EXISTS affiliate_catalog (
    slug TEXT PRIMARY KEY, platform TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
    category TEXT NOT NULL, keywords TEXT NOT NULL, image TEXT NOT NULL DEFAULT '',
    affiliate_url TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', availability TEXT NOT NULL DEFAULT 'unknown',
    evidence TEXT NOT NULL DEFAULT '', health TEXT NOT NULL DEFAULT 'unchecked', checked_at TEXT,
    clicks INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS affiliate_catalog_audit (
      id INTEGER PRIMARY KEY, slug TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS affiliate_catalog_migrations (id TEXT PRIMARY KEY);`);
  if (!db.prepare('SELECT id FROM affiliate_catalog_migrations WHERE id=?').get('initial-ml-20260905')) {
    const seeds = JSON.parse(fs.readFileSync(new URL('./affiliate-catalog-seed.json', import.meta.url), 'utf8'));
    db.transaction(() => {
      for (const row of seeds) {
        db.prepare(`INSERT OR IGNORE INTO affiliate_catalog
          (slug,platform,title,description,category,keywords,image,affiliate_url,status,evidence)
          VALUES (@slug,@platform,@title,@description,@category,@keywords,@image,@affiliate_url,'published',@evidence)`).run(row);
      }
      db.prepare('INSERT INTO affiliate_catalog_migrations VALUES (?)').run('initial-ml-20260905');
    })();
  }
  const all = () => db.prepare('SELECT * FROM affiliate_catalog ORDER BY title').all();
  const indexnow = setupAffiliateIndexNow({db,siteUrl,rows:all,fetcher,start:startMonitor});
  setupPlatformOperations({app,db,requireAdmin,sameOriginOnly,publicDir});
  const published = () => all().filter(p => p.status === 'published');
  const audit = (slug, action, detail) => db.prepare('INSERT INTO affiliate_catalog_audit(slug,action,detail) VALUES (?,?,?)').run(slug,action,detail);
  const origin = new URL(siteUrl).origin;
  const pagePath = p => '/ofertas/'+p.slug;
  const canBuy = p => p.status === 'published' && p.availability !== 'unavailable' && p.health !== 'broken';
  let running = false;
  async function checkDue(forceSlug) {
    if (running) return false;
    running = true;
    try {
      const rows = all().filter(p => forceSlug ? p.slug === forceSlug : p.status === 'published' &&
        (!p.checked_at || Date.now()-Date.parse(p.checked_at)>86400000)).slice(0,100);
      for (const row of rows) {
        const health = await checkAffiliateLink(row.affiliate_url,row.platform,fetcher);
        const changed = db.prepare('UPDATE affiliate_catalog SET health=?,checked_at=? WHERE slug=? AND revision=?')
          .run(health,new Date().toISOString(),row.slug,row.revision);
        if (changed.changes && row.health !== health) audit(row.slug,'link_check',health);
      }
      return true;
    } finally { running = false; }
  }
  // The due timestamp survives restarts; no browser cookies or customer requests are used.
  const timer = startMonitor ? setInterval(() => checkDue().catch(() => {}),3600000) : null;
  timer?.unref();
  const initial = startMonitor ? setTimeout(() => checkDue().catch(() => {}),60000) : null;
  initial?.unref();

  app.get('/admin-vendas-afiliadas.html', requireAdmin, (_req,res) => res.sendFile(publicDir+'/admin-vendas-afiliadas.html'));
  app.get('/api/admin/affiliate-catalog',requireAdmin,(_req,res) => res.set('Cache-Control','no-store').json({ items:all(), running,
    audit:db.prepare('SELECT * FROM affiliate_catalog_audit ORDER BY id DESC LIMIT 60').all() }));
  app.put('/api/admin/affiliate-catalog/:slug',requireAdmin,sameOriginOnly,(req,res) => {
    const slug = req.params.slug, b = req.body || {};
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length>100) return res.status(400).json({error:'Identificador inválido.'});
    if (!platforms[b.platform] || !validAffiliateUrl(b.affiliate_url,b.platform)) return res.status(400).json({error:'Informe um link HTTPS da plataforma escolhida.'});
    if (!['draft','published','paused'].includes(b.status) || !['unknown','available','unavailable'].includes(b.availability)) return res.status(400).json({error:'Status inválido.'});
    for (const [key,max] of Object.entries({title:180,description:2000,category:80,keywords:600,image:1000,evidence:400})) {
      if (typeof b[key] !== 'string' || b[key].length>max || (['title','description','category'].includes(key) && !b[key].trim())) return res.status(400).json({error:'Confira os campos do produto.'});
    }
    if (b.image) {
      try { const image = new URL(b.image); if(image.protocol!=='https:' || image.username || image.password)throw Error(); }
      catch { return res.status(400).json({error:'Imagem deve usar HTTPS.'}); }
    }
    const old = db.prepare('SELECT * FROM affiliate_catalog WHERE slug=?').get(slug);
    if (old && Number(b.revision)!==old.revision) return res.status(409).json({error:'O produto foi alterado. Recarregue antes de salvar.'});
    if (!old && all().length>=1000) return res.status(400).json({error:'Limite de 1.000 produtos atingido.'});
    db.transaction(() => {
      db.prepare(`INSERT INTO affiliate_catalog (slug,platform,title,description,category,keywords,image,affiliate_url,status,availability,evidence)
        VALUES (@slug,@platform,@title,@description,@category,@keywords,@image,@affiliate_url,@status,@availability,@evidence)
        ON CONFLICT(slug) DO UPDATE SET platform=excluded.platform,title=excluded.title,description=excluded.description,
        category=excluded.category,keywords=excluded.keywords,image=excluded.image,affiliate_url=excluded.affiliate_url,
        status=excluded.status,availability=excluded.availability,evidence=excluded.evidence,
        health=CASE WHEN affiliate_catalog.affiliate_url=excluded.affiliate_url THEN affiliate_catalog.health ELSE 'unchecked' END,
        checked_at=CASE WHEN affiliate_catalog.affiliate_url=excluded.affiliate_url THEN affiliate_catalog.checked_at ELSE NULL END,
        revision=affiliate_catalog.revision+1,updated_at=CURRENT_TIMESTAMP`).run({slug,...Object.fromEntries(['platform','title','description','category','keywords','image','affiliate_url','status','availability','evidence'].map(k=>[k,b[k].trim()]))});
      audit(slug,old?'edited':'created',JSON.stringify({previousLink:old?.affiliate_url || null,newLink:b.affiliate_url,status:b.status,availability:b.availability}));
    })();
    return res.json({ok:true});
  });
  app.post('/api/admin/affiliate-catalog/:slug/check',requireAdmin,sameOriginOnly,async(req,res) => {
    if (!db.prepare('SELECT slug FROM affiliate_catalog WHERE slug=?').get(req.params.slug)) return res.status(404).json({error:'Produto não encontrado.'});
    if (running) return res.status(409).json({error:'Uma verificação já está em andamento.'});
    await checkDue(req.params.slug);
    return res.json({ok:true});
  });

  function card(p) {
    return `<article class="card">${p.image?`<a href="${pagePath(p)}"><img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" width="360" height="240"></a>`:''}<div><span class="eyebrow">${esc(p.category)} · ${platforms[p.platform]}</span><h2><a href="${pagePath(p)}">${esc(p.title)}</a></h2><p>${esc(p.description)}</p><a class="button secondary" href="${pagePath(p)}">Ver detalhes e oferta</a></div></article>`;
  }
  app.get('/api/affiliate-highlights', (_req,res) => res.set('Cache-Control','public, max-age=60').json({items:
    published().filter(canBuy).slice(0,12).map(p=>({title:p.title,description:p.description,image:p.image,url:pagePath(p),platform:platforms[p.platform]}))}));
  app.get('/ofertas', (req,res) => {
    const platform = platforms[req.query.plataforma] ? req.query.plataforma : '';
    const items = published().filter(p=>!platform || p.platform===platform);
    const body = `<section class="intro"><span class="eyebrow">Curadoria VitrineCity</span><h1>Escolhas para o seu dia a dia</h1><p>Ferramentas, cozinha e casa conectada. Uma seleção por utilidade e pelos sinais de procura informados nas plataformas.</p><p class="disclosure">Publicidade · Alguns links são de afiliado e podem gerar comissão para a VitrineCity.</p></section><nav class="filters" aria-label="Plataformas"><a href="/ofertas" ${!platform?'aria-current="page"':''}>Todas</a>${Object.entries(platforms).map(([id,label])=>`<a href="/ofertas?plataforma=${id}" ${platform===id?'aria-current="page"':''}>${label}</a>`).join('')}</nav><section class="grid">${items.map(card).join('') || '<p>Estamos preparando a seleção desta plataforma.</p>'}</section><section class="note"><h2>Guias para escolher e usar</h2><p>${affiliateArticles.map(article=>`<a href="${esc(article.url)}">${esc(article.title)}</a>`).join(' · ')}</p></section><section class="note"><h2>Como selecionamos</h2><p>A seleção inicial do Mercado Livre reúne produtos identificados como “Mais vendido” na central de afiliados em 05/09/2026. Isso não representa um ranking de todo o mercado nem um teste de uso da VitrineCity. Confira vendedor, modelo, voltagem, frete, garantia e preço antes de comprar.</p></section>`;
    return res.type('html').send(document('Seleção de produtos',body,origin+'/ofertas'));
  });
  app.get('/ofertas/:slug',(req,res) => {
    const p = db.prepare('SELECT * FROM affiliate_catalog WHERE slug=?').get(req.params.slug);
    if (!p || p.status==='draft') return res.status(404).type('html').send(document('Produto não encontrado','<h1>Produto não encontrado</h1><a href="/ofertas">Ver seleção de produtos</a>',origin+'/ofertas'));
    const body = `<p><a href="/ofertas">← Seleção de produtos</a></p><section class="detail">${p.image?`<img src="${esc(p.image)}" alt="${esc(p.title)}" width="540" height="420">`:''}<div><span class="eyebrow">${esc(p.category)} · ${platforms[p.platform]}</span><h1>${esc(p.title)}</h1><p>${esc(p.description)}</p>${p.evidence?`<p class="muted">${esc(p.evidence)}</p>`:''}<p class="disclosure">Publicidade · Link de afiliado: a VitrineCity pode receber comissão.</p>${canBuy(p)?`<a class="button" href="${esc(p.affiliate_url)}" data-affiliate-id="${p.slug}" rel="sponsored noopener noreferrer" target="_blank">Conferir preço no ${platforms[p.platform]} ↗</a><p class="muted">Preço, estoque e condições são confirmados na plataforma de compra.</p>`:'<p class="unavailable">Oferta temporariamente indisponível. Estamos revisando o link de compra.</p><a class="button secondary" href="/ofertas">Explorar outros produtos</a>'}</div></section><section class="note"><h2>Antes de escolher</h2><p>Confira a descrição completa do vendedor e compare as medidas, a versão e os acessórios incluídos. Para aparelhos elétricos, verifique a voltagem. A compra e o atendimento do pedido acontecem na plataforma indicada.</p></section><script src="/affiliate-click.js" defer></script>`;
    const related=published().filter(other=>other.slug!==p.slug&&other.category===p.category&&canBuy(other)).slice(0,3);
    const relatedHtml=related.length?`<section class="note"><h2>Veja também nesta categoria</h2><ul>${related.map(other=>`<li><a href="${pagePath(other)}">${esc(other.title)}</a></li>`).join('')}</ul></section>`:'';
    return res.type('html').set('Cache-Control','no-store').send(document(p.title,body+relatedHtml,origin+pagePath(p),p.image,p.description.slice(0,180)));
  });
  // Aggregate button events only: these are not unique visitors, orders or commissions.
  const clickWindows = new Map();
  app.post('/api/affiliate-click/:slug',sameOriginOnly,(req,res) => {
    const now=Date.now(), key=req.ip;
    if (clickWindows.size>10000) clickWindows.clear();
    const previous=clickWindows.get(key);
    if(previous && now-previous.time<60000 && previous.count>=30)return res.status(429).end();
    clickWindows.set(key,previous && now-previous.time<60000 ? {time:previous.time,count:previous.count+1}:{time:now,count:1});
    db.prepare("UPDATE affiliate_catalog SET clicks=clicks+1 WHERE slug=? AND status='published'").run(req.params.slug);
    return res.status(204).end();
  });
  return {
    searchContent: () => [...affiliateArticles,...published().map(p=>({kind:'article',title:p.title,description:'Seleção com link de afiliado. '+p.description,keywords:p.keywords+' '+p.category+' '+platforms[p.platform],url:pagePath(p)}))],
    sitemapPaths: () => ['/ofertas',...affiliateArticles.map(article=>article.url),...published().map(pagePath)],
    checkDue, indexnow, close: () => { clearInterval(timer);clearTimeout(initial);indexnow.close(); }
  };
}
