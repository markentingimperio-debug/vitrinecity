import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import { setupAffiliateCatalog } from '../affiliate-catalog.js';

const app = express(), db = new Database(':memory:');
const catalog = setupAffiliateCatalog({ app, db, siteUrl: 'https://vitrinecity.com', publicDir: '/tmp', startMonitor: false,
  requireAdmin: (_req,res) => res.status(401).end(), sameOriginOnly: (_req,res) => res.status(403).end(),
  fetcher: () => { throw new Error('No external requests allowed'); } });
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const html = async path => {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  return response.text();
};
try {
  const listing = await html('/ofertas');
  assert.match(listing, /6 produtos encontrados/);
  assert.match(listing, /role="search"/);
  assert.match(listing, /name="q"/);
  assert.match(listing, /name="categoria"/);
  assert.match(listing, /affiliate-products\.css/);
  assert.match(listing, /href="#main-content"/);
  assert.match(listing, /Publicidade/);

  const filtered = await html('/ofertas?categoria=Ferramentas&q=DIVISOES&plataforma=mercadolivre');
  assert.match(filtered, /1 produto encontrado/);
  assert.match(filtered, /<h2><a href="\/ofertas\/bolsa-ferramentas-vonder-bl005"/);
  assert.doesNotMatch(filtered, /<h2><a href="\/ofertas\/echo-dot-5-alexa"/);
  assert.match(filtered, /plataforma=shopee&amp;categoria=Ferramentas&amp;q=DIVISOES/);
  assert.match(filtered, /name="plataforma" value="mercadolivre"/);
  assert.match(await html('/ofertas?q=vidro%20potes'), /1 produto encontrado/);
  assert.match(await html('/ofertas?plataforma=shopee'), /Nenhum produto nesta combinação/);
  assert.match(await html('/ofertas?categoria=inexistente'), /0 produtos encontrados/);
  assert.match(await html('/ofertas?plataforma=constructor'), /6 produtos encontrados/);
  assert.match(await html('/ofertas?q=a&q=b&categoria=x&categoria=y'), /6 produtos encontrados/);
  const injected = await html('/ofertas?q='+encodeURIComponent('"><script>alert(1)</script>'));
  assert.doesNotMatch(injected, /<script>alert/);
  assert.match(injected, /&lt;script&gt;/);
  assert.match(await html('/ofertas?q='+'z'.repeat(300)), new RegExp('value="z{160}"'));

  const product = db.prepare('SELECT * FROM affiliate_catalog WHERE slug=?').get('potes-vidro-rishon-370ml');
  const detail = await html('/ofertas/'+product.slug);
  assert.ok(detail.includes(product.affiliate_url));
  assert.ok(detail.includes(product.description));
  assert.ok(detail.indexOf('data-affiliate-id=') < detail.indexOf('id="detalhes-produto"'), 'Purchase action precedes full description');
  assert.match(detail, /rel="sponsored noopener noreferrer"/);
  assert.match(detail, /rel="canonical" href="https:\/\/vitrinecity.com\/ofertas\/potes-vidro-rishon-370ml"/);
  assert.match(detail, /Fonte das informações da seleção/);
  assert.match(detail, /Veja também nesta categoria/);
  assert.match(detail, /categoria=Cozinha/);
  assert.match(detail, /Preço, frete, estoque e condições são confirmados/);
  assert.doesNotMatch(detail, /<[^>]+(?:aggregateRating|priceCurrency|itemprop="price")/);

  // All fixture edits are in memory. Never change the production catalog to run tests.
  db.prepare('UPDATE affiliate_catalog SET image=?,title=?,description=?,evidence=? WHERE slug=?')
    .run('', '<script>fixture</script>', '<b>descrição</b>', '<img onerror=fixture>', product.slug);
  const escaped = await html('/ofertas/'+product.slug);
  assert.match(escaped, /Imagem não informada/);
  assert.match(escaped, /&lt;script&gt;fixture&lt;\/script&gt;/);
  assert.match(escaped, /&lt;b&gt;descrição&lt;\/b&gt;/);
  assert.doesNotMatch(escaped, /<script>fixture|<img onerror=fixture/);

  for (const update of ["health='broken'", "health='unchecked',availability='unavailable'", "availability='unknown',status='paused'"]) {
    db.prepare('UPDATE affiliate_catalog SET '+update+' WHERE slug=?').run(product.slug);
    const unavailable = await html('/ofertas/'+product.slug);
    assert.match(unavailable, /Oferta temporariamente indisponível/);
    assert.ok(!unavailable.includes(product.affiliate_url));
    assert.doesNotMatch(unavailable, /data-affiliate-id/);
  }
  assert.ok(!(await html('/ofertas')).includes('/ofertas/'+product.slug), 'Paused products leave listing');
  db.prepare("UPDATE affiliate_catalog SET status='draft' WHERE slug=?").run(product.slug);
  assert.equal((await fetch(base+'/ofertas/'+product.slug)).status, 404);
  assert.equal((await fetch(base+'/ofertas/missing')).status, 404);
  assert.equal((await fetch(base+'/api/admin/affiliate-catalog')).status, 401);
  assert.equal((await fetch(base+'/admin-vendas-afiliadas.html')).status, 401);
  assert.match(await html('/ofertas/echo-dot-5-alexa'), /Outros produtos da seleção/);
  console.log('Affiliate pages: filters, mobile-first action order, escaping, real links, availability and access protection passed.');
} finally {
  catalog.close(); server.closeAllConnections();
  await new Promise(resolve => server.close(resolve)); db.close();
}
