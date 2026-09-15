import {marketplaceSlug,publicStorePath} from './marketplace-public.js';

// One read-only selection for the public JSON API and the initial shop HTML.
export function publicMarketplaceProducts(db,query={}, {siteUrl='https://vitrinecity.com',referer=''}={}) {
  const category=String(query.category||'').trim().slice(0,80);
  const search=String(query.q||'').trim().slice(0,80);
  let delivery=String(query.delivery||'').trim().toLowerCase();
  if(!delivery){try{delivery=new URL(String(referer||''),siteUrl).searchParams.get('delivery')||'';}catch{delivery='';}}
  return db.prepare(`SELECT p.id,p.store_reference,p.name,p.description,p.category,p.price_cents,
      p.image_url,p.product_url,p.sku,p.stock_quantity,p.variation_label,p.delivery_min_days,p.delivery_max_days,p.return_days,
      p.product_type,p.menu_category_id,p.menu_sort_order,p.preparation_minutes,p.available,
      s.business_name AS store_name,s.business_type AS store_business_type,s.preparation_min_minutes AS store_preparation_min_minutes,
      s.preparation_max_minutes AS store_preparation_max_minutes,s.accepting_orders AS store_accepting_orders,s.fulfillment_mode AS store_fulfillment_mode,
      COALESCE((SELECT ROUND(AVG(r.rating),1) FROM marketplace_product_reviews r WHERE r.product_id=p.id AND r.status='published'),0) rating_average,
      (SELECT COUNT(*) FROM marketplace_product_reviews r WHERE r.product_id=p.id AND r.status='published') rating_count
    FROM store_products p JOIN store_profiles s ON s.order_reference=p.store_reference
    WHERE p.active=1 AND p.marketplace_enabled=1 AND p.available=1 AND p.price_cents>0 AND p.stock_quantity>0
      AND s.review_status='published' AND (?!='local' OR p.product_type='digital' OR s.fulfillment_mode IN ('delivery','local','both')) AND (?='' OR p.category=?)
      AND (?='' OR p.name LIKE '%'||?||'%' OR p.description LIKE '%'||?||'%' OR s.business_name LIKE '%'||?||'%')
    ORDER BY p.updated_at DESC,p.id DESC LIMIT 120`).all(delivery,category,category,search,search,search,search);
}

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function imageUrl(value,siteUrl,fallback){
  try{const url=new URL(String(value||fallback),siteUrl);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)return url.href;}catch{}
  return new URL(fallback,siteUrl).href;
}

export function renderMarketplaceCatalog(page,products,{siteUrl='https://vitrinecity.com',productFallback='/assets/store-seed/utilidades.svg',query={}}={}){
  const marker='<div class="grid" id="products"><div class="empty">Carregando a loja...</div></div>';
  if(typeof page!=='string'||page.split(marker).length!==2)throw new Error('marketplace_catalog_anchor_invalid');
  const cards=products.map(product=>{
    if(!Number.isSafeInteger(product.id)||product.id<=0)throw new Error('marketplace_catalog_product_invalid');
    const productPath=`/produto/${product.id}/${marketplaceSlug(product.name,'produto')}`;
    const storePath=publicStorePath({order_reference:product.store_reference,business_name:product.store_name});
    const price=(product.price_cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
    return `<article class="card"><img src="${escape(imageUrl(product.image_url,siteUrl,productFallback))}" data-fallback="${escape(productFallback)}" alt="${escape(product.name)}" loading="lazy"><div class="copy"><small><a class="seller-link" href="${escape(storePath)}">${escape(product.store_name)}</a> · ${escape(product.category||'Produtos')}</small><h2><a href="${escape(productPath)}">${escape(product.name)}</a></h2><div class="price">${escape(price)}</div><a class="button" href="${escape(productPath)}">Ver produto</a></div></article>`;
  }).join('');
  const searched=Boolean(String(query.q||query.category||'').trim());
  const empty=searched?'<div class="empty"><h2>Nenhum produto encontrado nesta busca.</h2><p>Experimente outro termo ou veja o catálogo completo.</p><a class="button" href="/loja">Ver todos os produtos</a></div>':'<div class="empty"><h2>Nenhum produto disponível no momento.</h2><p>Conheça os outros espaços da cidade enquanto as lojas atualizam o catálogo.</p><a class="button" href="/">Abrir VitrineCity</a></div>';
  return page.replace(marker,()=>`<div class="grid" id="products">${cards||empty}</div>`);
}
