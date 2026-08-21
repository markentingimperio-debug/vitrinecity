import Database from 'better-sqlite3';

const db = new Database(process.env.DATA_DIR ? process.env.DATA_DIR + '/vitrinecity.db' : '/data/vitrinecity.db');
db.pragma('foreign_keys = ON');

const storeReference = 'official_agrotecnica';
const products = [
  { sku:'AGRO-TERRA-3KG', name:'Terra vegetal adubada 3 kg', description:'Terra vegetal preparada para vasos, jardins, hortas e plantio doméstico.', category:'Terra e substratos', price:1190, stock:50, weight:3000, image:'/assets/store-seed/terra.svg' },
  { sku:'AGRO-TERRA-6KG', name:'Terra vegetal adubada 6 kg', description:'Terra vegetal preparada para vasos, jardins, hortas e plantio doméstico.', category:'Terra e substratos', price:1700, stock:50, weight:6000, image:'/assets/store-seed/terra.svg' },
  { sku:'AGRO-TERRA-12KG', name:'Terra vegetal adubada 12 kg', description:'Terra vegetal preparada para vasos, jardins, hortas e plantio doméstico.', category:'Terra e substratos', price:2700, stock:40, weight:12000, image:'/assets/store-seed/terra.svg' },
  { sku:'AGRO-NPK-1KG', name:'NPK 10-10-10 composto orgânico 1 kg', description:'Composto orgânico NPK 10-10-10 para manutenção nutricional de plantas.', category:'Adubos e fertilizantes', price:1090, stock:50, weight:1000, image:'/assets/store-seed/adubo.svg' },
  { sku:'AGRO-NPK-3KG', name:'NPK 10-10-10 composto orgânico 3 kg', description:'Composto orgânico NPK 10-10-10 para manutenção nutricional de plantas.', category:'Adubos e fertilizantes', price:1390, stock:50, weight:3000, image:'/assets/store-seed/adubo.svg' },
  { sku:'AGRO-BICARB-1KG', name:'Bicarbonato de sódio 1 kg', description:'Bicarbonato de sódio em embalagem de 1 kg. Confira as orientações de uso no rótulo.', category:'Utilidades', price:1555, stock:40, weight:1000, image:'/assets/store-seed/utilidades.svg' }
];

const insertOrder = db.prepare(`INSERT INTO lot_orders
  (reference,name,email,whatsapp,amount_cents,status,business_name,segment,fulfillment_status,confirmation_status)
  VALUES (?,?,?,?,0,'approved',?,?,'active','confirmed')
  ON CONFLICT(reference) DO UPDATE SET business_name=excluded.business_name,segment=excluded.segment,
  status='approved',fulfillment_status='active',confirmation_status='confirmed',updated_at=CURRENT_TIMESTAMP`);
const insertStore = db.prepare(`INSERT INTO store_profiles
  (order_reference,business_name,description,whatsapp,website_url,promotion_text,review_status,submitted_at,reviewed_at,published_at)
  VALUES (?,?,?,?,?,?,'published',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
  ON CONFLICT(order_reference) DO UPDATE SET business_name=excluded.business_name,description=excluded.description,
  whatsapp=excluded.whatsapp,website_url=excluded.website_url,promotion_text=excluded.promotion_text,
  review_status='published',published_at=COALESCE(store_profiles.published_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP`);
const findProduct = db.prepare('SELECT id FROM store_products WHERE store_reference=? AND sku=?');
const insertProduct = db.prepare(`INSERT INTO store_products
  (store_reference,name,description,category,price_cents,image_url,active,sku,stock_quantity,weight_grams,fiscal_ncm,marketplace_enabled)
  VALUES (?,?,?,?,?,?,1,?,?,?,'',1)`);
const updateProduct = db.prepare(`UPDATE store_products SET name=?,description=?,category=?,price_cents=?,image_url=?,
  active=1,stock_quantity=?,weight_grams=?,marketplace_enabled=1,updated_at=CURRENT_TIMESTAMP WHERE id=?`);

db.transaction(() => {
  insertOrder.run(storeReference,'Agrotecnica','loja@agrotecnica.local','', 'Agrotecnica','Jardinagem e agricultura');
  insertStore.run(storeReference,'Agrotecnica','Terra, adubos e produtos para cultivo e jardinagem. Catálogo oficial com preços editáveis no painel do lojista.','','','Produtos para cuidar do seu cultivo.');
  for (const product of products) {
    const found=findProduct.get(storeReference,product.sku);
    if (found) updateProduct.run(product.name,product.description,product.category,product.price,product.image,product.stock,product.weight,found.id);
    else insertProduct.run(storeReference,product.name,product.description,product.category,product.price,product.image,product.sku,product.stock,product.weight);
  }
})();

console.log('Catálogo oficial preparado:', {
  loja: db.prepare('SELECT business_name,review_status FROM store_profiles WHERE order_reference=?').get(storeReference),
  produtos: db.prepare('SELECT COUNT(*) total FROM store_products WHERE store_reference=? AND active=1 AND marketplace_enabled=1').get(storeReference).total
});
