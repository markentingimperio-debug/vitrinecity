import fs from 'node:fs';
import { affiliateArticles } from './affiliate-articles.js';
import { setupAffiliateIndexNow } from './affiliate-indexnow.js';
import { setupPlatformOperations } from './platform-operations.js';
import { setupAffiliateCenters } from './affiliate-centers.js';
import {setupAffiliatePartners,partnerPagePath,partnerOutboundPath,partnerSharePath} from './affiliate-partners.js';

export const platforms = { mercadolivre: 'Mercado Livre', shopee: 'Shopee', tiktok: 'TikTok', cakto: 'Cakto', kiwify: 'Kiwify' };
const hosts = {
  mercadolivre: ['meli.la', 'mercadolivre.com.br'],
  shopee: ['shopee.com.br', 's.shopee.com.br', 'shope.ee'],
  tiktok: ['tiktok.com', 'getstartedtiktok.partnerlinks.io'],
  cakto: ['pay.cakto.com.br'],
  kiwify: ['pay.kiwify.com.br', 'kiwify.app']
};
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function validAffiliateUrl(value, platform) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') &&
      (Object.hasOwn(hosts, platform) ? hosts[platform] : []).some(h => u.hostname === h ||
        (!['cakto','kiwify'].includes(platform) && u.hostname.endsWith('.'+h)));
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
  const styles = '<link rel="stylesheet" href="/affiliate-catalog.css"><link rel="stylesheet" href="/affiliate-products.css">';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | VitrineCity</title><meta name="description" content="${esc(description || title)}"><link rel="canonical" href="${esc(canonical)}"><meta property="og:description" content="${esc(description || title)}"><meta property="og:site_name" content="VitrineCity"><meta property="og:title" content="${esc(title)}"><meta property="og:type" content="website"><meta property="og:url" content="${esc(canonical)}">${image ? `<meta property="og:image" content="${esc(image)}">` : ''}${styles}</head><body class="affiliate-public"><a class="skip-link" href="#main-content">Pular para o conteúdo</a><header><a class="brand" href="/">vitrine<span>city</span></a><nav aria-label="Navegação principal"><a href="/pesquisar.html">Pesquisar</a><a href="/ofertas">Seleção de produtos</a></nav></header><main id="main-content">${body}</main><footer>VitrineCity · <a href="/privacy.html">Privacidade</a> · <a href="/contato.html">Contato</a></footer></body></html>`;
}

const searchText = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
const queryText = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
// These partner platforms can sell digital or physical products. Do not infer
// delivery, access duration or recurring billing solely from the platform name.
const flexibleFormat = p => ['cakto', 'kiwify'].includes(p.platform);
function selectionUrl({ platform = '', category = '', query = '', page=1 } = {}) {
  const params = new URLSearchParams();
  if (platform) params.set('plataforma', platform);
  if (category) params.set('categoria', category);
  if (query) params.set('q', query);
  if (page>1) params.set('p',String(page));
  return '/ofertas' + (params.size ? '?' + params.toString() : '');
}

export function setupAffiliateCatalog({ app, db, requireAdmin, requireUser, sameOriginOnly, siteUrl, publicDir, startMonitor = true, fetcher = fetch }) {
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
  const published = () => db.prepare("SELECT * FROM affiliate_catalog WHERE status='published' ORDER BY title").all();
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
  app.get('/api/admin/affiliate-catalog',requireAdmin,(req,res) => {
    const platform=queryText(req.query.plataforma,30),query=queryText(req.query.q,120),clauses=[],values=[];
    if(Object.hasOwn(platforms,platform)){clauses.push('platform=?');values.push(platform);}
    if(query){clauses.push('instr(lower(title || \' \' || slug),lower(?))>0');values.push(query);}
    const where=clauses.length?' WHERE '+clauses.join(' AND '):'',total=db.prepare('SELECT COUNT(*) total FROM affiliate_catalog'+where).get(...values).total,pageSize=50,pages=Math.max(1,Math.ceil(total/pageSize)),page=Math.min(pages,Math.max(1,Number.parseInt(String(req.query.p||'1'),10)||1));
    return res.set('Cache-Control','no-store').json({items:db.prepare('SELECT * FROM affiliate_catalog'+where+' ORDER BY title,slug LIMIT ? OFFSET ?').all(...values,pageSize,(page-1)*pageSize),total,page,pages,running,audit:db.prepare('SELECT * FROM affiliate_catalog_audit ORDER BY id DESC LIMIT 60').all()});
  });
  app.put('/api/admin/affiliate-catalog/:slug',requireAdmin,sameOriginOnly,(req,res) => {
    const slug = req.params.slug, b = req.body || {};
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length>100) return res.status(400).json({error:'Identificador inválido.'});
    if (!Object.hasOwn(platforms,b.platform) || !validAffiliateUrl(b.affiliate_url,b.platform)) return res.status(400).json({error:'Informe um link HTTPS da plataforma escolhida.'});
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
    if (!old && db.prepare('SELECT COUNT(*) total FROM affiliate_catalog').get().total>=50000) return res.status(400).json({error:'Limite de capacidade do catálogo atingido. Consulte a administração da plataforma.'});
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
    return `<article class="card"><a class="card-media" href="${pagePath(p)}" aria-label="${esc(p.title)}">${p.image?`<img src="${esc(p.image)}" alt="" loading="lazy" decoding="async" width="360" height="240">`:'<span class="image-placeholder">Imagem não informada</span>'}</a><div><span class="eyebrow">${esc(p.category)} · ${platforms[p.platform]}</span><h2><a href="${pagePath(p)}">${esc(p.title)}</a></h2><p class="card-description">${esc(p.description)}</p><p class="card-condition">${canBuy(p)?(flexibleFormat(p)?'Preço e condições na plataforma parceira':'Preço e frete na loja parceira'):'Oferta em revisão'}</p><a class="button secondary" href="${pagePath(p)}">Ver detalhes e oferta <span aria-hidden="true">→</span></a></div></article>`;
  }
  const centers=setupAffiliateCenters({app,db,document,card,siteUrl});
  const partners=typeof requireUser==='function'?setupAffiliatePartners({app,db,requireUser,requireAdmin,siteUrl,document,platforms,validAffiliateUrl,publicDir}):null;
  app.get('/api/affiliate-highlights', (_req,res) => res.set('Cache-Control','public, max-age=60').json({items:
    published().filter(canBuy).slice(0,12).map(p=>({title:p.title,description:p.description,image:p.image,url:pagePath(p),platform:platforms[p.platform]}))}));
  app.get('/ofertas', (req,res) => {
    const requestedPlatform = queryText(req.query.plataforma, 30);
    const platform = Object.hasOwn(platforms, requestedPlatform) ? requestedPlatform : '';
    const query = queryText(req.query.q, 160), category = queryText(req.query.categoria, 80);
    const rows = published();
    const categories = [...new Set(rows.map(p=>p.category))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    const terms = searchText(query).split(/\s+/).filter(Boolean);
    const items = rows.filter(p=>(!platform || p.platform===platform) && (!category || p.category===category) &&
      terms.every(term=>searchText(p.title+' '+p.description+' '+p.keywords+' '+p.category+' '+platforms[p.platform]).includes(term)));
    const pages=Math.max(1,Math.ceil(items.length/24)),page=Math.min(pages,Math.max(1,Number.parseInt(String(req.query.p||'1'),10)||1)),pageItems=items.slice((page-1)*24,page*24);
    const pagination=pages>1?`<nav class="filters" aria-label="Páginas de produtos">${page>1?`<a href="${esc(selectionUrl({platform,category,query,page:page-1}))}">← Anterior</a>`:''}<span>Página ${page} de ${pages}</span>${page<pages?`<a href="${esc(selectionUrl({platform,category,query,page:page+1}))}">Próxima →</a>`:''}</nav>`:'';
    const body = `<section class="intro catalog-intro"><span class="eyebrow">Curadoria VitrineCity</span><h1>Escolhas para o seu dia a dia</h1><p>Explore produtos por categoria, descubra os detalhes e confira as condições diretamente na loja parceira.</p><p class="disclosure">Publicidade · Alguns links são de afiliado e podem gerar comissão para a VitrineCity.</p></section>
      <form class="catalog-search" action="/ofertas" method="get" role="search" aria-label="Buscar produtos da seleção">
        ${platform?`<input type="hidden" name="plataforma" value="${platform}">`:''}
        <label>O que você procura?<input type="search" name="q" value="${esc(query)}" maxlength="160" placeholder="Ex.: potes de vidro, ferramentas"></label>
        <label>Categoria<select name="categoria"><option value="">Todas as categorias</option>${category&&!categories.includes(category)?`<option value="${esc(category)}" selected>${esc(category)}</option>`:''}${categories.map(c=>`<option value="${esc(c)}" ${c===category?'selected':''}>${esc(c)}</option>`).join('')}</select></label>
        <button type="submit">Buscar produtos</button>
      </form>
      <nav class="filters" aria-label="Plataformas"><a href="${esc(selectionUrl({category,query}))}" ${!platform?'aria-current="page"':''}>Todas</a>${Object.entries(platforms).map(([id,label])=>`<a href="${esc(selectionUrl({platform:id,category,query}))}" ${platform===id?'aria-current="page"':''}>${label}</a>`).join('')}</nav>
      <div class="results-heading"><h2>${items.length} ${items.length===1?'produto encontrado':'produtos encontrados'}</h2>${query||category||platform?'<a href="/ofertas">Limpar filtros</a>':'<span class="muted">Conheça antes de escolher</span>'}</div>
      <section class="grid" aria-label="Produtos encontrados">${pageItems.map(card).join('') || '<div class="empty-selection"><h2>Nenhum produto nesta combinação</h2><p>Tente outra palavra, categoria ou plataforma.</p><a class="button secondary" href="/ofertas">Ver todos os produtos</a></div>'}</section>${pagination}<section class="note"><h2>Guias para escolher e usar</h2><p>${affiliateArticles.map(article=>`<a href="${esc(article.url)}">${esc(article.title)}</a>`).join(' · ')}</p></section><section class="note"><h2>Como selecionamos</h2><p>As informações de cada produto indicam sua fonte e data de consulta. Em cursos e softwares, confira o conteúdo ou plano incluído, requisitos, acesso e eventual cobrança recorrente. A presença no catálogo não representa garantia de resultados.</p><p>A seleção inicial do Mercado Livre reúne produtos identificados como “Mais vendido” na central de afiliados em 05/09/2026. Isso não representa um ranking de todo o mercado nem um teste de uso da VitrineCity. Confira vendedor, modelo, voltagem, frete, garantia e preço antes de comprar.</p></section>`;
    return res.type('html').send(document('Seleção de produtos',body,origin+'/ofertas'));
  });
  app.get('/ofertas/:slug',(req,res) => {
    const p = db.prepare('SELECT * FROM affiliate_catalog WHERE slug=?').get(req.params.slug);
    if (!p || p.status==='draft') return res.status(404).type('html').send(document('Produto não encontrado','<h1>Produto não encontrado</h1><a href="/ofertas">Ver seleção de produtos</a>',origin+'/ofertas'));
    const partner=partners?.find(req.query.parceiro);
    if(partner&&canBuy(p))partners.record(req,partner,'product_view',p.slug);
    const flexible = flexibleFormat(p);
    const destination = (['shopee','cakto','kiwify'].includes(p.platform)?'na ':'no ')+platforms[p.platform];
    const conditions = flexible ? 'Confira formato, preço total, prazo de acesso ou entrega e suporte. Se for assinatura, confira também renovação, cobrança recorrente e cancelamento antes de contratar.' : 'Preço, frete, estoque e condições são confirmados na plataforma de compra.';
    const checklist = flexible ? '<li>Confira quem é o produtor e o que está incluído no produto ou plano escolhido.</li><li>Verifique requisitos, formato e prazo de acesso ou entrega.</li><li>Se for assinatura, confira valor total, frequência de cobrança, renovação e cancelamento.</li><li>Leia as regras de suporte e reembolso apresentadas pelo produtor e pela plataforma.</li>' : '<li>Confira o modelo, as medidas e a quantidade da variação.</li><li>Verifique o vendedor, o frete e o prazo para o seu endereço.</li><li>Compare os acessórios incluídos e as condições de garantia.</li><li>Para aparelhos elétricos, confirme a voltagem e a alimentação.</li>';
    const body = `<nav class="breadcrumbs" aria-label="Caminho da página"><a href="/ofertas">Seleção de produtos</a>${centers.paths.includes(`/centros/${p.platform}`)?`<span aria-hidden="true">/</span><a href="/centros/${p.platform}">${platforms[p.platform]}</a>`:''}<span aria-hidden="true">/</span><a href="${esc(selectionUrl({category:p.category}))}">${esc(p.category)}</a></nav>
      <section class="detail product-detail"><figure class="product-media">${p.image?`<img src="${esc(p.image)}" alt="${esc(p.title)}" width="540" height="420" fetchpriority="high">`:'<div class="image-placeholder">Imagem não informada</div>'}<figcaption>${flexible?'Imagem do produto. Confira a apresentação completa na plataforma.':'Confira a variação e as imagens completas no anúncio.'}</figcaption></figure>
        <div class="product-summary"><span class="platform-label">${platforms[p.platform]}</span><h1>${esc(p.title)}</h1>
          <dl class="product-facts"><div><dt>Categoria</dt><dd><a href="${esc(selectionUrl({category:p.category}))}">${esc(p.category)}</a></dd></div><div><dt>${flexible?'Plataforma de compra':'Compra e atendimento'}</dt><dd>${platforms[p.platform]}</dd></div></dl>
          <div class="offer-box"><p class="offer-title">Confira a oferta atual</p><p class="muted">${conditions}</p><p class="disclosure">Publicidade · Link de afiliado: a VitrineCity pode receber comissão.</p>
          ${canBuy(p)?`<a class="button purchase-link" href="${esc(p.affiliate_url)}" data-affiliate-id="${p.slug}" rel="sponsored noopener noreferrer" target="_blank">${flexible?'Ver detalhes':'Ver preço'} ${destination} <span aria-hidden="true">↗</span></a><span class="destination-note">Você será direcionado à plataforma parceira em outra aba.</span>`:'<p class="unavailable">Oferta temporariamente indisponível. Estamos revisando o link de compra.</p><a class="button secondary" href="/ofertas">Explorar outros produtos</a>'}</div>
          <a class="description-link" href="#detalhes-produto">Ler descrição e cuidados <span aria-hidden="true">↓</span></a>
        </div></section>
      <div class="product-information"><section class="note" id="detalhes-produto"><span class="eyebrow">Conheça o produto</span><h2>Descrição e cuidados</h2><p class="product-description">${esc(p.description)}</p>${p.evidence?`<details class="selection-evidence"><summary>Fonte das informações da seleção</summary><p class="muted">${esc(p.evidence)}</p></details>`:''}</section>
        <section class="note purchase-checklist"><h2>Antes de escolher</h2><ul>${checklist}</ul><p class="muted">${flexible?'A compra é processada pela plataforma indicada; a entrega, o acesso e o suporte seguem as condições do produtor. A VitrineCity não garante resultados, vendas ou renda.':'A compra e o atendimento do pedido acontecem na plataforma indicada.'}</p></section></div><script src="/affiliate-click.js" defer></script>`;
    const alternatives=published().filter(other=>other.slug!==p.slug&&canBuy(other));
    const sameCategory=alternatives.filter(other=>other.category===p.category);
    const related=(sameCategory.length?sameCategory:alternatives).slice(0,3);
    const relatedHtml=related.length?`<section class="related-products"><div class="results-heading"><h2>${sameCategory.length?'Veja também nesta categoria':'Outros produtos da seleção'}</h2><a href="/ofertas">Ver seleção completa</a></div><div class="grid">${related.map(card).join('')}</div></section>`:'';
    let html=document(p.title,body+relatedHtml,origin+pagePath(p),p.image,p.description.slice(0,180));
    if(partner){
      html=html.replace(`href="${esc(p.affiliate_url)}" data-affiliate-id`, `href="${partnerOutboundPath(partner.code,p.slug)}" data-affiliate-id`)
        .replaceAll('href="/ofertas"',`href="${partnerPagePath(partner.code)}"`)
        .replaceAll('href="/ofertas?',`href="${partnerPagePath(partner.code)}?`)
        .replace(/href="\/centros\/[a-z]+"/g,`href="${partnerPagePath(partner.code)}"`)
        .replace('<section class="detail product-detail">',`<p class="disclosure">Indicação de <a href="${partnerPagePath(partner.code)}">${esc(partner.code)}</a></p><section class="detail product-detail">`);
      for(const other of related)html=html.replaceAll(`href="${pagePath(other)}"`,`href="${partnerSharePath(partner.code,other.slug)}"`);
    }
    return res.type('html').set('Cache-Control','no-store').send(html);
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
    sitemapPaths: () => ['/ofertas',...centers.paths,...affiliateArticles.map(article=>article.url),...published().map(pagePath)],
    checkDue, indexnow, close: () => { clearInterval(timer);clearTimeout(initial);indexnow.close(); }
  };
}
