import assert from 'node:assert/strict';
import { marketplaceSlug, publicStorePath, renderPublicStorePage } from '../marketplace-public.js';

assert.equal(marketplaceSlug('Agrotécnica & Cia'), 'agrotecnica-cia');
assert.equal(publicStorePath({ order_reference: 'LOJA 01', business_name: 'Agrotécnica' }), '/loja/LOJA%2001/agrotecnica');

const html = renderPublicStorePage({
  siteUrl: 'https://vitrinecity.com/app',
  store: {
    order_reference: 'STORE-1',
    business_name: 'Loja <Segura>',
    description: 'Tudo para casa </script><script>alert(1)</script>',
    facade_url: '',
    logo_url: '',
    website_url: 'javascript:alert(1)',
    instagram_url: 'https://instagram.com/loja',
    tiktok_url: '',
    promotion_text: 'Oferta & qualidade'
  },
  products: [{
    id: 7,
    name: 'Produto Especial',
    category: 'Casa & Jardim',
    price_cents: 1590,
    stock_quantity: 4,
    image_url: 'javascript:alert(2)'
  }]
});

assert.match(html, /<link rel="canonical" href="https:\/\/vitrinecity\.com\/loja\/STORE-1\/loja-segura">/);
assert.match(html, /"@type":\["Store","LocalBusiness"\]/);
assert.match(html, /"@type":"BreadcrumbList"/);
assert.match(html, /Loja &lt;Segura&gt;/);
assert.doesNotMatch(html, /javascript:alert/);
assert.doesNotMatch(html, /javascript:alert\(2\)/);
assert.match(html, />Instagram<\/a>/);
assert.doesNotMatch(html, /<\/script><script>alert/);
assert.match(html, /\\u003c\/script>\\u003cscript>alert/);
assert.match(html, /\/produto\/7\/produto-especial/);
assert.match(html, /R\$ 15,90|R\$ 15,90/);

const foodHtml = renderPublicStorePage({
  siteUrl: 'https://vitrinecity.com',
  store: {
    order_reference: 'FOOD-1', business_name: 'Sabor da Cidade', description: 'Refeições feitas na hora.',
    business_type: 'food', accepts_orders: 1, is_open: true,
    preparation_min_minutes: 20, preparation_max_minutes: 35
  },
  products: [
    { id: 10, name: 'Prato feito', category: 'Almoço', price_cents: 2490, stock_quantity: 99, available_now: 1 },
    { id: 11, name: 'Suco', category: 'Bebidas', price_cents: 700, stock_quantity: 99, available_now: 0 }
  ]
});
assert.match(foodHtml, /Cardápio/);
assert.match(foodHtml, /Aberto · aceitando pedidos/);
assert.match(foodHtml, /20–35 min de preparo/);
assert.match(foodHtml, /<h2>Almoço<\/h2>/);
assert.match(foodHtml, /<h2>Bebidas<\/h2>/);
assert.match(foodHtml, /Indisponível agora/);
assert.doesNotMatch(foodHtml, /99 em estoque/);

console.log('marketplace-public: ok');
