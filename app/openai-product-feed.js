// Public offers selected for the VitrineCity gardening product campaign.
export const PRODUCT_IDS = Object.freeze([8,9,10,11,12,13,14,15,16,17,18,19,20]);
export function productFeedRows(products, siteUrl) {
  const origin = new URL(siteUrl).origin;
  return products.filter(p => PRODUCT_IDS.includes(Number(p.id)) && p.store_reference === 'official_agrotecnica'
    && Number(p.active) === 1 && Number(p.marketplace_enabled) === 1 && p.review_status === 'published'
    && Number.isSafeInteger(p.price_cents) && p.price_cents > 0 && Number(p.stock_quantity) > 0
    && /^https:\/\//.test(p.image_url || '')).map(p => {
      const slug = p.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      return { item_id:`product-${p.id}`, title:p.name, description:p.description || p.name,
        url:`${origin}/produto/${p.id}/${slug}`, brand:p.store_name, seller_name:p.store_name,
        seller_url:`${origin}/loja/official_agrotecnica/agrotecnica`, image_url:p.image_url,
        availability:'in_stock', price:`${(p.price_cents / 100).toFixed(2)} BRL`, is_ads_eligible:'true' };
    });
}
export function productFeedCsv(rows) {
  const columns = ['item_id','title','description','url','brand','seller_name','seller_url','image_url','availability','price','is_ads_eligible'];
  const cell = value => '"' + String(value ?? '').replace(/[\r\n]+/g,' ').replace(/"/g,'""') + '"';
  return [columns.join(','), ...rows.map(row => columns.map(key => cell(row[key])).join(','))].join('\n') + '\n';
}
export function setupOpenAIProductFeed(app, db, siteUrl) {
  app.get('/feeds/openai-products.csv', (_req,res) => {
    const products = db.prepare(`SELECT p.id,p.name,p.description,p.price_cents,p.image_url,p.stock_quantity,
      p.store_reference,p.active,p.marketplace_enabled,s.review_status,s.business_name AS store_name
      FROM store_products p JOIN store_profiles s ON s.order_reference=p.store_reference
      WHERE p.store_reference='official_agrotecnica' ORDER BY p.id`).all();
    res.type('text/csv').set('Cache-Control','public,max-age=300')
      .set('Content-Disposition','inline; filename="vitrinecity-openai-products.csv"')
      .send(productFeedCsv(productFeedRows(products,siteUrl)));
  });
}
