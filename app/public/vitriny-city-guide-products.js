import {normalizeInteriorProduct} from './vitriny-store-interior-core.js';

// Read the public catalog independently of the 3D renderer. Never start a cart
// or follow a seller URL here: every result opens its VitrineCity product page.
export function guideProductItems(products = []) {
  const seen = new Set();
  return (Array.isArray(products) ? products : []).flatMap(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const product = normalizeInteriorProduct(raw);
    if (!product || seen.has(product.id)) return [];
    seen.add(product.id);
    const storeName = String(raw.store_name || '').trim().slice(0, 120);
    return [{
      id: `product-${product.id}`, title: product.name, product: true,
      description: [product.category, storeName].filter(Boolean).join(' · '),
      keywords: [product.name, product.description, product.category, storeName], group: 'comprar',
      landmark: 'Produto', href: product.href
    }];
  }).slice(0, 24);
}

export async function fetchGuideProducts(query, {fetchImpl = globalThis.fetch, signal} = {}) {
  const search = String(query || '').trim().slice(0, 80)
    .replace(/\badubos\b/gi, 'adubo').replace(/\bsubstratos\b/gi, 'substrato');
  if (search.length < 2) return [];
  const response = await fetchImpl(`/api/marketplace/products?q=${encodeURIComponent(search)}`, {
    headers: {accept: 'application/json'}, signal
  });
  if (!response.ok) throw new Error('catalog_unavailable');
  const data = await response.json();
  if (!Array.isArray(data?.products)) throw new Error('catalog_invalid');
  return guideProductItems(data.products);
}
