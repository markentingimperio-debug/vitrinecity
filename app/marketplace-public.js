const DEFAULT_PRODUCT_FALLBACK = '/assets/store-seed/utilidades.svg';

export function marketplaceSlug(value, fallback = 'loja') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 100) || fallback;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function absoluteUrl(value, origin) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const parsed = new URL(text, origin);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch {
    return '';
  }
}

export function publicStorePath(store) {
  return `/loja/${encodeURIComponent(String(store?.order_reference || ''))}/${marketplaceSlug(store?.business_name)}`;
}

export function renderPublicStorePage({ store, products = [], siteUrl, productFallback = DEFAULT_PRODUCT_FALLBACK }) {
  const origin = new URL(siteUrl).origin;
  const canonicalPath = publicStorePath(store);
  const canonical = `${origin}${canonicalPath}`;
  const description = String(store.description || `Conheça a loja ${store.business_name} na Vitriny City.`).slice(0, 155);
  const heroPath = store.facade_url || store.logo_url || productFallback;
  const hero = absoluteUrl(heroPath, origin) || new URL(productFallback, origin).toString();
  const safeProducts = products.map(product => ({
    ...product,
    path: `/produto/${product.id}/${marketplaceSlug(product.name, 'produto')}`,
    image: absoluteUrl(product.image_url, origin) || new URL(productFallback, origin).toString()
  }));
  const channels = [
    ['Site', store.website_url],
    ['Instagram', store.instagram_url],
    ['TikTok', store.tiktok_url]
  ].map(([label, value]) => ({ label, url: absoluteUrl(value, origin) })).filter(channel => channel.url);
  const sameAs = channels.map(channel => channel.url);
  const schema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: store.business_name,
    description,
    url: canonical,
    image: hero,
    ...(store.logo_url ? { logo: absoluteUrl(store.logo_url, origin) || hero } : {}),
    ...(sameAs.length ? { sameAs } : {})
  }).replace(/</g, '\\u003c');
  const productCards = safeProducts.map(product => `<article class="card">
      <a href="${escapeHtml(product.path)}"><img src="${escapeHtml(product.image)}" onerror="this.onerror=null;this.src='${escapeHtml(productFallback)}'" alt="${escapeHtml(product.name)}"></a>
      <div class="copy"><small>${escapeHtml(product.category || 'Produto')}</small>
      <h2><a href="${escapeHtml(product.path)}">${escapeHtml(product.name)}</a></h2>
      <div class="price">${(product.price_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div>
      <div class="stock">${product.stock_quantity} em estoque</div>
      <a class="button" href="${escapeHtml(product.path)}">Ver produto</a></div></article>`).join('');
  const emptyState = '<div class="empty"><h2>Esta loja está preparando o catálogo.</h2><p>Volte em breve para conhecer os produtos.</p></div>';
  return `<!doctype html><html lang="pt-BR"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(store.business_name)} — loja na Vitriny City</title>
    <meta name="description" content="${escapeHtml(description)}">
    <link rel="canonical" href="${escapeHtml(canonical)}">
    <meta property="og:type" content="website"><meta property="og:title" content="${escapeHtml(store.business_name)} — Vitriny Loja">
    <meta property="og:description" content="${escapeHtml(description)}"><meta property="og:image" content="${escapeHtml(hero)}">
    <script type="application/ld+json">${schema}</script>
    <style>:root{--blue:#1768e6;--yellow:#ffc628;--line:#263b5b;--panel:#101d34;--muted:#aebed3}*{box-sizing:border-box}body{margin:0;background:#07101d;color:#f7faff;font-family:Inter,Arial,sans-serif}a{color:inherit;text-decoration:none}header{padding:17px max(18px,5vw);border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center}.brand{font-size:24px;font-weight:950}.brand span{color:var(--yellow)}.back,.button{display:inline-block;padding:11px 14px;background:var(--blue);border-radius:11px;font-weight:900}.back{background:#15243c}.hero{padding:46px max(18px,5vw);display:grid;grid-template-columns:minmax(220px,360px) 1fr;gap:34px;align-items:center;background:radial-gradient(circle at 80% 0,#1768e64c,transparent 35rem)}.hero img{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:24px;border:1px solid var(--line);background:#14213a}h1{font-size:clamp(36px,6vw,66px);line-height:1;margin:0 0 14px}.description{color:#cad5e5;line-height:1.6;max-width:720px}.promotion{color:var(--yellow);font-weight:900}.links{display:flex;flex-wrap:wrap;gap:9px;margin-top:20px}.links a{padding:9px 12px;background:#15243c;border-radius:10px;font-weight:800}main{padding:32px max(18px,5vw) 90px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.card{background:var(--panel);border:1px solid var(--line);border-radius:18px;overflow:hidden}.card img{width:100%;aspect-ratio:1;object-fit:cover;background:#17263e}.copy{padding:15px}.copy small,.stock{color:var(--muted)}.copy h2{font-size:17px;min-height:42px}.price{font-size:21px;font-weight:950;margin:10px 0}.stock{margin-bottom:14px}.empty{grid-column:1/-1;padding:50px;text-align:center;border:1px dashed #496180;border-radius:18px}@media(max-width:960px){.grid{grid-template-columns:repeat(3,1fr)}}@media(max-width:720px){.hero{grid-template-columns:1fr}.grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:440px){.grid{grid-template-columns:1fr}}</style>
    <script src="/analytics.js" defer></script></head><body>
    <header><a class="brand" href="/loja.html">Vitriny <span>Loja</span></a><a class="back" href="/loja.html">← Todas as lojas</a></header>
    <section class="hero"><img src="${escapeHtml(hero)}" onerror="this.onerror=null;this.src='${escapeHtml(productFallback)}'" alt="Fachada ou marca da loja ${escapeHtml(store.business_name)}">
    <div><h1>${escapeHtml(store.business_name)}</h1><p class="description">${escapeHtml(description)}</p>
    ${store.promotion_text ? `<p class="promotion">${escapeHtml(store.promotion_text)}</p>` : ''}
    ${channels.length ? `<div class="links">${channels.map(channel => `<a href="${escapeHtml(channel.url)}" rel="noopener noreferrer">${channel.label}</a>`).join('')}</div>` : ''}</div></section>
    <main><h2>Produtos da loja</h2><div class="grid">${productCards || emptyState}</div></main>
    </body></html>`;
}
