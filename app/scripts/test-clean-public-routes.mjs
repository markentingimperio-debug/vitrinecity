import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import express from 'express';
import Database from 'better-sqlite3';
import { CLEAN_PUBLIC_ROUTES, cleanPublicRoutes, toCleanPublicHref, toLegacyPublicPath } from '../clean-public-routes.js';
import { setupCityMembership } from '../city-membership.js';
import { memberPage, memberReturn } from '../public/vitriny-membership-core.js';
import { inferSpatialPresenceDistrict } from '../public/vitriny-spatial-presence-client.js';
import { measurementPage, measurementContext } from '../public/measurement-policy.js';

test('aliases target real unique HTML pages and do not replace existing catalog namespaces', () => {
  assert.equal(new Set(Object.values(CLEAN_PUBLIC_ROUTES)).size, Object.keys(CLEAN_PUBLIC_ROUTES).length);
  for (const [clean, legacy] of Object.entries(CLEAN_PUBLIC_ROUTES)) {
    assert.match(clean, /^\/[a-z][a-z-]+$/);
    assert.match(legacy, /^\/[a-z][a-z-]+\.html$/);
    assert.ok(existsSync(new URL('../public' + legacy, import.meta.url)), legacy);
    assert.equal(toCleanPublicHref(legacy), clean);
    assert.equal(toLegacyPublicPath(clean), legacy);
  }
  for (const reserved of ['/', '/cidade', '/cidade-premium', '/cinema', '/cinema/arena', '/musicas', '/loja', '/social', '/descobrir', '/ofertas', '/entregas', '/servicos-digitais', '/api/auth/me', '/admin', '/pagamento']) {
    assert.equal(toLegacyPublicPath(reserved), reserved);
  }
});

test('only known root-relative links change, with exact query and fragment preservation', () => {
  assert.equal(toCleanPublicHref('/vitriny-multiverse-explore.html?city=silvania&return=1#lojas'), '/multiverso?city=silvania&return=1#lojas');
  assert.equal(toCleanPublicHref('/centro-educacional.html?ref=ABC%2F9#curso-a'), '/centro-educacional?ref=ABC%2F9#curso-a');
  for (const unchanged of [undefined, null, 3, '', '/multiverso?city=silvania', '/nao-existe.html', '/admin.html', 'https://vitrinecity.com/sobre.html', 'https://example.com/sobre.html?affiliate=123', '//example.com/sobre.html', 'javascript:alert(1)', 'sobre.html', '../sobre.html', '/pasta/../sobre.html', '/%73obre.html', '/sobre.html/extra', '/sobre.html\\evil', '/sobre.html?x=\r\n', '/sobre.html?x=with space']) {
    assert.equal(toCleanPublicHref(unchanged), unchanged);
  }
});

test('middleware leaves methods, malformed paths and unknown routes untouched', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const req = { method, url: '/multiverso?city=silvania' }; let calls = 0;
    cleanPublicRoutes(req, {}, () => calls++);
    assert.equal(req.url, '/multiverso?city=silvania'); assert.equal(calls, 1);
  }
  for (const url of ['/Multiverso', '/multiverso/', '/multiverso/extra', '//multiverso', '/%6dultiverso', '/%ZZ', '/a/../multiverso', '/multiverso\\', '/multiverso#fragment', '/multiverso\n', '/multiverso?x=\r\n', 'https://example.com/multiverso', '/vitriny-multiverse-explore.html?city=silvania']) {
    const req = { method: 'GET', url }; let calls = 0;
    cleanPublicRoutes(req, {}, () => calls++);
    assert.equal(req.url, url); assert.equal(calls, 1);
  }
});

test('safe return paths preserve public city visits and private activities without admitting external destinations', () => {
  for (const pathname of ['/multiverso', '/jogos', '/mini-fazenda', '/arena-musical', '/sala-de-cinema', '/meus-creditos']) {
    assert.equal(memberPage(pathname), pathname !== '/multiverso');
    const destination = pathname + '?city=silvania&selecao=exemplo%2D1#continuar';
    assert.equal(memberReturn(destination), destination);
    assert.equal(memberPage(CLEAN_PUBLIC_ROUTES[pathname]), pathname !== '/multiverso');
  }
  const fallback = '/vitriny-multiverse-explore.html?city=vitrine-city';
  for (const rejected of ['/pesquisar', '/centro-educacional', '/acessos', '/carteira', '/admin', 'https://evil.test/multiverso', '//evil.test/multiverso', '/\\evil.test/multiverso', '/multiverso%0d%0aLocation:evil', '/multiverso?x=%5c']) {
    assert.equal(memberReturn(rejected), fallback, rejected);
  }
});

test('presence recognizes the clean city path and retains existing district behavior', () => {
  assert.equal(inferSpatialPresenceDistrict({ pathname: '/multiverso', search: '?city=silvania' }), 'central');
  assert.equal(inferSpatialPresenceDistrict({ pathname: '/vitriny-multiverse-explore.html' }), 'central');
  assert.equal(inferSpatialPresenceDistrict({ pathname: '/vitriny-multiverse-district.html', search: '?district=education' }), 'education');
  assert.equal(inferSpatialPresenceDistrict({ pathname: '/pesquisar' }), null);
});

test('public alias analytics use the same classification and do not expose private pages or query details', () => {
  for (const [clean, legacy] of Object.entries(CLEAN_PUBLIC_ROUTES)) {
    assert.deepEqual(measurementPage(clean), measurementPage(legacy), clean);
  }
  for (const excludedPath of ['/multiverso', '/jogos', '/mini-fazenda', '/arena-musical', '/sala-de-cinema', '/meus-creditos', '/carteira', '/acessos', '/comprar-lote', '/admin', '/api/auth/me']) {
    assert.equal(measurementPage(excludedPath), null, excludedPath);
  }
  assert.deepEqual(measurementContext({ pathname: '/pesquisar', origin: 'https://vitrinecity.com', search: '?q=private-query&email=user%40example.test&utm_source=city-guide' }, 'https://example.test/path?private=1'), {
    page_location: 'https://vitrinecity.com/pesquisar.html?utm_source=city-guide',
    page_referrer: 'https://example.test',
    page_title: 'VitrineCity — pesquisar'
  });
  assert.equal(measurementContext({ pathname: '/meus-creditos', origin: 'https://vitrinecity.com', search: '?ref=private-order' }, ''), null);
});

test('real membership gate protects GET and HEAD aliases before page serving', async () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY)');
  const app = express();
  app.use(cleanPublicRoutes);
  // Match the production order: rewrite, security headers, membership, pages.
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });
  setupCityMembership(app, { db, currentUser: req => req.get('X-Test-Member') ? { id: 1, account_status: req.get('X-Test-Member') } : null, requireUser: (_req, res) => res.sendStatus(401), sameOriginOnly: (_req, _res, next) => next() });
  app.get(Object.values(CLEAN_PUBLIC_ROUTES), (req, res) => res.set('X-Resolved-Path', req.path).json({ url: req.url, originalUrl: req.originalUrl, query: req.query }));
  app.get('/cinema/:slug', (req, res) => res.json({ film: req.params.slug }));
  app.post('/multiverso', (_req, res) => res.status(405).send('Unchanged method'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const pathname of ['/jogos', '/mini-fazenda', '/arena-musical', '/sala-de-cinema', '/meus-creditos']) {
      for (const method of ['GET', 'HEAD']) {
        const denied = await fetch(origin + pathname + '?city=silvania&selecao=exemplo', { method, redirect: 'manual' });
        assert.equal(denied.status, 302, `${method} ${pathname}`);
        assert.match(denied.headers.get('location'), /^\/entrar-cidade\.html\?returnTo=/);
        assert.equal(new URL(denied.headers.get('location'), origin).searchParams.get('returnTo'), pathname + '?city=silvania&selecao=exemplo');
        assert.equal(denied.headers.get('cache-control'), 'private,no-store');
        assert.equal(denied.headers.get('x-content-type-options'), 'nosniff');
      }
      const restricted = await fetch(origin + pathname, { headers: { 'X-Test-Member': 'restricted' } });
      assert.equal(restricted.status, 403, pathname);
      const allowed = await fetch(origin + pathname + '?city=silvania&return=1&token=a%2Fb', { headers: { 'X-Test-Member': 'active' } });
      assert.equal(allowed.status, 200);
      assert.equal(allowed.headers.get('cache-control'), 'private,no-store');
      assert.deepEqual(await allowed.json(), { url: CLEAN_PUBLIC_ROUTES[pathname] + '?city=silvania&return=1&token=a%2Fb', originalUrl: pathname + '?city=silvania&return=1&token=a%2Fb', query: { city: 'silvania', return: '1', token: 'a/b' } });
      const old = await fetch(origin + CLEAN_PUBLIC_ROUTES[pathname], { headers: { 'X-Test-Member': 'active' } });
      assert.equal(old.status, 200);
      assert.equal((await old.json()).url, CLEAN_PUBLIC_ROUTES[pathname]);
      const oldDenied = await fetch(origin + CLEAN_PUBLIC_ROUTES[pathname], { redirect: 'manual' });
      assert.equal(oldDenied.status, 302);
      const head = await fetch(origin + pathname + '?city=silvania', { method: 'HEAD', headers: { 'X-Test-Member': 'active' } });
      assert.equal(head.status, 200);
      assert.equal(head.headers.get('x-resolved-path'), CLEAN_PUBLIC_ROUTES[pathname]);
      assert.equal(await head.text(), '');
    }
    for (const pathname of ['/multiverso', '/pesquisar', '/centro-educacional', '/sobre', '/acessos']) {
      const response = await fetch(origin + pathname);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-resolved-path'), CLEAN_PUBLIC_ROUTES[pathname]);
      assert.equal(response.headers.get('cache-control'), null);
    }
    for (const pathname of ['/multiverso', '/vitriny-multiverse-explore.html']) {
      const response = await fetch(origin + pathname + '?city=silvania&return=1');
      assert.deepEqual(await response.json(), {url:'/vitriny-multiverse-explore.html?city=silvania&return=1',originalUrl:pathname+'?city=silvania&return=1',query:{city:'silvania',return:'1'}});
      const head = await fetch(origin + pathname, {method:'HEAD'});
      assert.equal(head.status,200);
      assert.equal(await head.text(),'');
    }
    assert.deepEqual(await (await fetch(origin + '/cinema/arena')).json(), { film: 'arena' });
    assert.equal((await fetch(origin + '/multiverso', { method: 'POST' })).status, 405);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});
