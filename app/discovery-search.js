import { searchPromotions } from './search-promotions.js';
import { suggestSpelling } from './search-spelling.js';
import { recordOperation } from './platform-operations.js';
// VitrineRank v1: explainable local relevance, using only published inventory.
export function normalizeSearch(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function setupDiscoverySearch(app, db, publicStorePath, contentProvider = () => []) {
  db.function('vc_normalize', { deterministic: true }, normalizeSearch);
  function correction(query,city){
    const titles=[...db.prepare("SELECT business_name AS title FROM store_profiles WHERE review_status='published' LIMIT 1000").all(),
      ...db.prepare("SELECT sp.name AS title FROM store_products sp JOIN store_profiles p ON p.order_reference=sp.store_reference WHERE sp.active=1 AND p.review_status='published' LIMIT 2000").all(),...contentProvider()].map(x=>x.title);
    const candidate=suggestSpelling(query,titles);if(!candidate)return null;
    const found=search(candidate,city);return (found.stores.length+found.products.length+(found.contents?.length||0))?candidate:null;
  }
  function search(query, city) {
    const stopWords = new Set(['como','fazer','um','uma','de','do','da','para','com','o','a','os','as','e','em','no','na','quero','comprar']);
    const words = normalizeSearch(query).split(' ').filter(Boolean);
    const relevant = words.filter(word => !stopWords.has(word));
    const terms = (relevant.length ? relevant : words).slice(0, 8);
    if (normalizeSearch(query).length < 2) return { stores: [], products: [] };
    const location = normalizeSearch(city);
    const match = expression => terms.map(() => `instr(' '||vc_normalize(${expression}), ?) > 0`).join(' AND ');
    const stores = db.prepare(`SELECT p.order_reference reference,p.business_name name,p.description,
      p.logo_url logoUrl,p.facade_url facadeUrl,p.city,o.segment,o.lot_code lotCode,
      p.website_url websiteUrl,p.promotion_text promotionText,p.whatsapp,p.instagram_url instagramUrl,
      CASE WHEN vc_normalize(p.business_name)=? THEN 100
        WHEN instr(vc_normalize(p.business_name),?)=1 THEN 70 ELSE 40 END rankScore
      FROM store_profiles p JOIN lot_orders o ON o.reference=p.order_reference
      WHERE p.review_status='published' AND (?='' OR vc_normalize(p.city)=?)
        AND ${match("p.business_name||' '||COALESCE(p.description,'')||' '||COALESCE(o.segment,'')")}
      ORDER BY rankScore DESC,p.business_name,p.order_reference LIMIT 40`)
      .all(normalizeSearch(query), normalizeSearch(query), location, location, ...terms.map(term => ' '+term))
      .map(row => ({ ...row, url: publicStorePath({ order_reference: row.reference, business_name: row.name }),
        rankReason: 'Correspondência com a sua busca' }));
    const products = db.prepare(`SELECT sp.id,sp.name,sp.description,sp.category,sp.price_cents priceCents,
      sp.image_url imageUrl,p.business_name storeName,p.order_reference storeReference,p.city,
      (SELECT COUNT(*) FROM marketplace_product_reviews r WHERE r.product_id=sp.id
        AND r.status='published' AND r.verified_purchase=1) verifiedReviews,
      (SELECT AVG(r.rating) FROM marketplace_product_reviews r WHERE r.product_id=sp.id
        AND r.status='published' AND r.verified_purchase=1) verifiedRating,
      CASE WHEN vc_normalize(sp.name)=? THEN 100
        WHEN instr(vc_normalize(sp.name),?)=1 THEN 70 ELSE 40 END relevance
      FROM store_products sp JOIN store_profiles p ON p.order_reference=sp.store_reference
      WHERE sp.active=1 AND p.review_status='published' AND (?='' OR vc_normalize(p.city)=?)
        AND ${match("sp.name||' '||COALESCE(sp.description,'')||' '||COALESCE(sp.category,'')||' '||p.business_name")}
      ORDER BY relevance + COALESCE((verifiedRating-3)*verifiedReviews/(verifiedReviews+10.0)*5,0) DESC,
        sp.name,sp.id LIMIT 60`).all(normalizeSearch(query), normalizeSearch(query), location, location, ...terms.map(term => ' '+term))
      .map(row => ({ ...row, productUrl: `/produto/${row.id}/${normalizeSearch(row.name).replaceAll(' ', '-') || 'produto'}`,
        rankReason: row.verifiedReviews ? 'Relevância e avaliações de compras verificadas' : 'Correspondência com a sua busca' }));
    const promoted = searchPromotions(query);
    const contents = [...promoted, ...contentProvider().filter(item => !promoted.some(p => p.url === item.url) && terms.every(term => (' '+normalizeSearch([item.title,item.description,item.keywords].filter(Boolean).join(' '))).includes(' '+term)))]
      .slice(0, 20);
    return { stores, products, contents };
  }
  app.get('/api/discovery/search/suggestions', (req, res) => {
    const query = String(req.query.q || '').trim().slice(0, 80);
    const { stores, products, contents = [] } = search(query, req.query.city);
    const seen = new Set();
    const kinds = {course:'Curso',recipe:'Receita',news:'Notícia',sports:'Esporte',article:'Artigo',affiliate:'Oferta de afiliado'};
    const suggestions = [...contents.slice(0, 3).map(item => ({ label: item.title, type: 'content', category: kinds[item.kind] || 'Conteúdo' })),...stores.slice(0, 4).map(s => ({ label: s.name, type: 'store', category: s.segment, city: s.city })),
      ...products.slice(0, 6).map(p => ({ label: p.name, type: 'product', category: p.category, city: p.city }))]
      .filter(item => { const key = normalizeSearch(item.label); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 8);
    if(!suggestions.length){const candidate=correction(query,req.query.city);if(candidate)suggestions.push({label:candidate,type:'content',category:'Você quis dizer?'});}
    res.json({ suggestions });
  });
  app.get('/api/discovery/search', (req, res) => {
    const query = String(req.query.q || '').trim().slice(0, 80);
    const city = String(req.query.city || '').trim().slice(0, 100);
    const result=search(query,city),total=result.stores.length+result.products.length+(result.contents?.length||0);
    if(normalizeSearch(query).length>=2){recordOperation(db,'search');if(!total)recordOperation(db,'search_empty');}
    res.json({ query, city, rankingVersion: 'vitrine-local-v2', ...result, suggestedQuery:total?null:correction(query,city) });
  });
}
