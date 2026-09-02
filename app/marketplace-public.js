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

function videoPresentation(value, origin) {
  const url=absoluteUrl(value,origin);if(!url)return null;
  try{const parsed=new URL(url),host=parsed.hostname.replace(/^www\./,'');
    if(host==='youtube.com'||host==='m.youtube.com'){const id=parsed.searchParams.get('v');if(id&&/^[\w-]{6,20}$/.test(id))return {kind:'embed',url:`https://www.youtube-nocookie.com/embed/${id}`};}
    if(host==='youtu.be'){const id=parsed.pathname.slice(1);if(/^[\w-]{6,20}$/.test(id))return {kind:'embed',url:`https://www.youtube-nocookie.com/embed/${id}`};}
    if(host==='vimeo.com'){const id=parsed.pathname.split('/').filter(Boolean)[0];if(/^\d+$/.test(id))return {kind:'embed',url:`https://player.vimeo.com/video/${id}`};}
    if(/\.(mp4|webm|mov)$/i.test(parsed.pathname))return {kind:'file',url};
  }catch{}
  return {kind:'link',url};
}

export function publicStorePath(store) {
  return `/loja/${encodeURIComponent(String(store?.order_reference || ''))}/${marketplaceSlug(store?.business_name)}`;
}

function foodStore(store) {
  return ['food', 'hybrid'].includes(String(store?.business_type || '').toLowerCase());
}

function storeOpen(store) {
  if (!foodStore(store)) return true;
  if (store.accepts_orders === false || Number(store.accepts_orders) === 0) return false;
  return store.is_open === undefined ? true : Boolean(store.is_open);
}

function preparationLabel(store) {
  const min = Math.max(0, Math.round(Number(store.preparation_min_minutes) || 0));
  const max = Math.max(min, Math.round(Number(store.preparation_max_minutes) || min));
  return min ? `${min}${max > min ? `–${max}` : ''} min de preparo` : '';
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
    buyUrl: absoluteUrl(product.product_url, origin),
    image: absoluteUrl(product.image_url, origin) || new URL(productFallback, origin).toString()
  }));
  const websiteLabel = /(?:^|\.)shopee\.com\.br$|(?:^|\.)shope\.ee$/i.test((() => {
    try { return new URL(store.website_url).hostname; } catch { return ''; }
  })()) ? 'Loja oficial Shopee' : 'Site';
  const channels = [
    ['WhatsApp', store.whatsapp ? `https://wa.me/${String(store.whatsapp).replace(/\D/g,'')}` : ''],
    [websiteLabel, store.website_url],
    ['Instagram', store.instagram_url],
    ['TikTok', store.tiktok_url],
    ['Google Maps', store.google_maps_url]
  ].map(([label, value]) => ({ label, url: absoluteUrl(value, origin) })).filter(channel => channel.url);
  const sameAs = channels.map(channel => channel.url);
  const gallery=[store.gallery_1_url,store.gallery_2_url,store.gallery_3_url].map(value=>absoluteUrl(value,origin)).filter(Boolean);
  const video=videoPresentation(store.video_url,origin);
  const isFood=foodStore(store),isOpen=storeOpen(store),preparation=preparationLabel(store);
  const schema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': ['Store', 'LocalBusiness'],
    name: store.business_name,
    description,
    url: canonical,
    image: hero,
    ...(store.logo_url ? { logo: absoluteUrl(store.logo_url, origin) || hero } : {}),
    ...(sameAs.length ? { sameAs } : {}),
    ...(store.address||store.city?{address:{'@type':'PostalAddress',streetAddress:store.address||'',addressLocality:store.city||'',addressRegion:store.state||'',postalCode:store.postal_code||'',addressCountry:'BR'}}:{})
  }).replace(/</g, '\\u003c');
  const breadcrumbSchema = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Vitriny Loja', item: `${origin}/loja` },
      { '@type': 'ListItem', position: 2, name: store.business_name, item: canonical }
    ]
  }).replace(/</g, '\\u003c');
  const productCard = product => `<article class="card">
      <a href="${escapeHtml(product.path)}"><img src="${escapeHtml(product.image)}" onerror="this.onerror=null;this.src='${escapeHtml(productFallback)}'" alt="${escapeHtml(product.name)}"></a>
      <div class="copy"><small>${escapeHtml(product.category || 'Produto')}</small>
      <h2><a href="${escapeHtml(product.path)}">${escapeHtml(product.name)}</a></h2>
      <div class="price">${(product.price_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div>
      <div class="stock">${isFood?(product.available_now===false||Number(product.available_now)===0?'Indisponível agora':escapeHtml(product.preparation_minutes?`${product.preparation_minutes} min de preparo`:'Disponível')):`${product.stock_quantity} em estoque`}</div>
      <a class="button${(!isOpen||(isFood&&(product.available_now===false||Number(product.available_now)===0)))?' disabled':''}" href="${escapeHtml(product.buyUrl || product.path)}"${product.buyUrl?' target="_blank" rel="noopener sponsored"':''}>${!isOpen?'Loja fechada':product.buyUrl?'Comprar':isFood?'Ver item':'Ver produto'}</a></div></article>`;
  const categoryNames=[...new Set(safeProducts.map(product=>String(product.category||'Outros').trim()||'Outros'))];
  const productCards = isFood ? categoryNames.map(category=>`<section class="menu-section"><h2>${escapeHtml(category)}</h2><div class="grid">${safeProducts.filter(product=>(String(product.category||'Outros').trim()||'Outros')===category).map(productCard).join('')}</div></section>`).join('') : safeProducts.map(productCard).join('');
  const emptyState = '<div class="empty"><h2>Esta loja está preparando o catálogo.</h2><p>Volte em breve para conhecer os produtos.</p></div>';
  return `<!doctype html><html lang="pt-BR"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(store.business_name)} — loja na Vitriny City</title>
    <meta name="description" content="${escapeHtml(description)}">
    <link rel="canonical" href="${escapeHtml(canonical)}">
    <meta property="og:type" content="website"><meta property="og:title" content="${escapeHtml(store.business_name)} — Vitriny Loja">
    <meta property="og:description" content="${escapeHtml(description)}"><meta property="og:image" content="${escapeHtml(hero)}">
    <script type="application/ld+json">${schema}</script>
    <script type="application/ld+json">${breadcrumbSchema}</script>
    <style>:root{--blue:#1768e6;--yellow:#ffc628;--line:#263b5b;--panel:#101d34;--muted:#aebed3;--green:#38d39f}*{box-sizing:border-box}body{margin:0;background:#07101d;color:#f7faff;font-family:Inter,Arial,sans-serif}a{color:inherit;text-decoration:none}header{padding:17px max(18px,5vw);border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center}.brand{font-size:24px;font-weight:950}.brand span{color:var(--yellow)}.back,.button{display:inline-block;padding:11px 14px;background:var(--blue);border-radius:11px;font-weight:900}.button.disabled{background:#34445c;color:#aebed3;pointer-events:none}.back{background:#15243c}.hero{padding:46px max(18px,5vw);display:grid;grid-template-columns:minmax(220px,360px) 1fr;gap:34px;align-items:center;background:radial-gradient(circle at 80% 0,#1768e64c,transparent 35rem)}.hero img{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:24px;border:1px solid var(--line);background:#14213a}h1{font-size:clamp(36px,6vw,66px);line-height:1;margin:0 0 14px}.description{color:#cad5e5;line-height:1.6;max-width:720px}.location{color:var(--muted)}.promotion{color:var(--yellow);font-weight:900}.operation{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.badge{padding:8px 11px;border-radius:99px;background:#182942;font-weight:900}.badge.open{background:#123b32;color:#8af0ce}.badge.closed{background:#4a2027;color:#ffbac4}.links{display:flex;flex-wrap:wrap;gap:9px;margin-top:20px}.links a{padding:9px 12px;background:#15243c;border-radius:10px;font-weight:800}main{padding:32px max(18px,5vw) 90px}.media{margin-bottom:38px}.gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.gallery img{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:16px;border:1px solid var(--line)}.video{margin-top:14px}.video iframe,.video video{width:100%;max-height:620px;aspect-ratio:16/9;border:0;border-radius:18px;background:#000}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.menu-section{margin:0 0 36px}.menu-section>h2{font-size:27px}.card{background:var(--panel);border:1px solid var(--line);border-radius:18px;overflow:hidden}.card img{width:100%;aspect-ratio:1;object-fit:cover;background:#17263e}.copy{padding:15px}.copy small,.stock{color:var(--muted)}.copy h2{font-size:17px;min-height:42px}.price{font-size:21px;font-weight:950;margin:10px 0}.stock{margin-bottom:14px}.empty{grid-column:1/-1;padding:50px;text-align:center;border:1px dashed #496180;border-radius:18px}@media(max-width:960px){.grid{grid-template-columns:repeat(3,1fr)}}@media(max-width:720px){.hero{grid-template-columns:1fr}.grid{grid-template-columns:repeat(2,1fr)}.gallery{grid-template-columns:1fr 1fr}}@media(max-width:440px){.grid,.gallery{grid-template-columns:1fr}}</style>
    <script src="/analytics.js" defer></script></head><body>
    <header><a class="brand" href="/loja">Vitriny <span>Loja</span></a><a class="back" href="/loja">← Todas as lojas</a></header>
    <section class="hero"><img src="${escapeHtml(hero)}" onerror="this.onerror=null;this.src='${escapeHtml(productFallback)}'" alt="Fachada ou marca da loja ${escapeHtml(store.business_name)}">
    <div><h1>${escapeHtml(store.business_name)}</h1><p class="description">${escapeHtml(description)}</p>
    ${isFood?`<div class="operation"><span class="badge ${isOpen?'open':'closed'}">${isOpen?'Aberto · aceitando pedidos':'Fechado para pedidos'}</span>${preparation?`<span class="badge">${escapeHtml(preparation)}</span>`:''}</div>`:''}
    ${store.address||store.city?`<p class="location">${escapeHtml([store.address,store.city,store.state].filter(Boolean).join(' · '))}</p>`:''}
    ${store.promotion_text ? `<p class="promotion">${escapeHtml(store.promotion_text)}</p>` : ''}
    ${channels.length ? `<div class="links">${channels.map(channel => `<a href="${escapeHtml(channel.url)}" rel="noopener noreferrer">${channel.label}</a>`).join('')}</div>` : ''}</div></section>
    <main>${gallery.length||video?`<section class="media"><h2>Conheça a empresa</h2>${gallery.length?`<div class="gallery">${gallery.map((url,index)=>`<img src="${escapeHtml(url)}" alt="Foto ${index+1} de ${escapeHtml(store.business_name)}">`).join('')}</div>`:''}${video?`<div class="video">${video.kind==='embed'?`<iframe src="${escapeHtml(video.url)}" title="Vídeo de ${escapeHtml(store.business_name)}" loading="lazy" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`:video.kind==='file'?`<video src="${escapeHtml(video.url)}" controls preload="metadata"></video>`:`<a class="button" href="${escapeHtml(video.url)}" target="_blank" rel="noopener">Assistir ao vídeo da empresa</a>`}</div>`:''}</section>`:''}<h2>${isFood?'Cardápio':'Produtos da loja'}</h2>${isFood?(productCards||emptyState):`<div class="grid">${productCards || emptyState}</div>`}</main>
    </body></html>`;
}
