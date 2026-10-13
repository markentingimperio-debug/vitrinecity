// Runs the public e-book pages and private delivery against an isolated server and database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

test('a página de compra aponta para o catálogo e o PDF só abre para quem pagou', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'vitrine-herb-ebook-'));
  const dataDir = path.join(root, 'data');
  const filesDir = path.join(root, 'private-courses');
  const slug = '50-ervas-medicinais';
  const port = 43000 + Math.floor(Math.random() * 1000);
  const origin = `http://127.0.0.1:${port}`;
  const guard = path.join(root, 'outbound-guard.mjs');
  const capturedPreference = path.join(root, 'mercado-pago-preference.json');
  mkdirSync(dataDir);
  mkdirSync(path.join(filesDir, slug), { recursive: true });
  writeFileSync(guard, `import { writeFileSync } from 'node:fs';
globalThis.fetch=async(url,options)=>{
  if(String(url)==='https://api.mercadopago.com/checkout/preferences'){
    writeFileSync(${JSON.stringify(capturedPreference)},options.body);
    return new Response(JSON.stringify({id:'pref-ebook-test',init_point:'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=ebook-test'}),{status:201,headers:{'Content-Type':'application/json'}});
  }
  throw Error('External fetch disabled in isolated e-book test');
};`);
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']
    .filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, { DATA_DIR: dataDir, COURSE_FILES_DIR: filesDir, LIVE_STUDIO_DIR: path.join(root, 'live-studio'), PORT: String(port), SITE_URL: origin,
    BOOK_AUTOMATION_ENABLED: 'false', MERCADOPAGO_ACCESS_TOKEN: 'TEST-isolated-ebook', MERCADOPAGO_WEBHOOK_SECRET: 'isolated-ebook-test' });
  let output = '';
  const launch = () => {
    const instance = spawn(process.execPath, ['--import', pathToFileURL(guard).href, 'server.js'],
      { cwd: new URL('..', import.meta.url), env, stdio: ['ignore', 'pipe', 'pipe'] });
    instance.stdout.on('data', chunk => output += chunk);
    instance.stderr.on('data', chunk => output += chunk);
    return instance;
  };
  let child = launch();
  const request = (url, options = {}) => fetch(origin + url, { redirect: 'manual', ...options,
    headers: { origin, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  async function waitForServer() {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await request('/api/health')).ok) { ready = true; break; } } catch {}
      if (child.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, output.slice(-2500));
  }
  async function stopServer() {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await exited;
    }
  }
  let db;
  try {
    await waitForServer();

    let response = await request('/ebook-50-ervas-medicinais');
    assert.equal(response.status, 200);
    const salePage = await response.text();
    assert.match(salePage, /R\$ 15,99/);
    assert.match(salePage, /ebook-50-ervas-medicinais\.js/);
    assert.match(salePage, /rel="canonical" href="https:\/\/vitrinecity\.com\/ebook-50-ervas-medicinais"/);
    assert.match(salePage, /meu-ebook-50-ervas-medicinais\.html/);
    assert.doesNotMatch(salePage, /href="[^"]+\.pdf/);
    assert.equal((await request('/meu-ebook-50-ervas-medicinais.html')).status, 200);
    assert.equal((await request('/assets/ebooks/50-ervas-medicinais-vitrine-city.png', { method: 'HEAD' })).status, 200);
    assert.equal((await request('/api/courses/50-ervas-medicinais/checkout', { method: 'POST', body: '{}' })).status, 401);

    const feed = async () => (await (await request('/feeds/meta-catalog.csv')).text()).split('\n')
      .find(line => line.includes(`course-${slug}`));
    const sitemap = async () => (await (await request('/sitemap.xml')).text());
    assert.equal(await feed(), undefined, 'Produto inexistente não entra no feed');
    assert.doesNotMatch(await sitemap(), /\/ebook-50-ervas-medicinais/);

    db = new Database(path.join(dataDir, 'vitrinecity.db'));
    const seeded = db.prepare('SELECT * FROM managed_courses WHERE slug=?').get(slug);
    assert.equal(seeded.status, 'active', 'Banco novo recebe cadastro inicial');
    assert.equal(seeded.price_cents, 1599);
    assert.equal(seeded.material_url, '', 'Cadastro inicial não expõe o PDF');
    db.prepare("UPDATE managed_courses SET status='draft' WHERE slug=?").run(slug);
    assert.equal(await feed(), undefined, 'Rascunho não entra no feed');
    db.prepare("UPDATE managed_courses SET status='active',price_cents=999 WHERE slug=?").run(slug);
    assert.equal(await feed(), undefined, 'Preço diferente da página não entra no feed');
    db.prepare('UPDATE managed_courses SET price_cents=1599 WHERE slug=?').run(slug);
    assert.equal(await feed(), undefined, 'Sem PDF privado não há oferta no feed');
    assert.doesNotMatch(await sitemap(), /\/ebook-50-ervas-medicinais/);
    writeFileSync(path.join(filesDir, slug, '50-ervas-medicinais.pdf'), '%PDF-1.4\n%%EOF\n');
    const row = await feed();
    assert.ok(row);
    assert.match(row, /15\.99 BRL/);
    assert.match(row, /\/ebook-50-ervas-medicinais(?:,|"|$)/);
    assert.doesNotMatch(row, /\/centro-educacional\.html|\.pdf/);
    assert.match(await sitemap(), /\/ebook-50-ervas-medicinais<\/loc>/);
    response = await request('/api/courses');
    const course = (await response.json()).courses.find(item => item.slug === slug);
    assert.equal(course.available, true);
    assert.equal(course.priceCents, 1599);

    const fileUrl = `/api/my-courses/${slug}/material?path=50-ervas-medicinais.pdf`;
    assert.equal((await request(fileUrl)).status, 401, 'Visitante não recebe o arquivo');
    response = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({
      name: 'Compradora Teste', email: 'ebook-buyer@example.test', password: 'isolated-password-2026',
      adultConfirmed: true, termsAccepted: true }) });
    assert.equal(response.status, 201, await response.clone().text());
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const headers = { cookie };
    assert.equal((await request(fileUrl, { headers })).status, 403, 'Conta sem compra não recebe o arquivo');
    response = await request(`/api/courses/${slug}/checkout`, { method: 'POST', headers, body: JSON.stringify({ termsAccepted: true }) });
    assert.equal(response.status, 201, await response.clone().text());
    assert.match((await response.json()).checkoutUrl, /^https:\/\/www\.mercadopago\.com\.br\//);
    const preference = JSON.parse(readFileSync(capturedPreference, 'utf8'));
    assert.equal(preference.items[0].description, 'E-book digital em PDF com acesso individual após pagamento');
    assert.equal(preference.items[0].unit_price, 15.99);
    assert.equal(preference.back_urls.failure, `${origin}/ebook-50-ervas-medicinais?resultado=falha`);
    assert.equal(preference.metadata.product, 'course', 'O webhook mantém o fluxo existente');

    const buyer = db.prepare('SELECT id FROM users WHERE email=?').get('ebook-buyer@example.test');
    db.prepare(`INSERT INTO course_orders(reference,user_id,course_slug,course_title,amount_cents,status)
      VALUES(?,?,?,?,?,'approved')`).run('course_ebook-test', buyer.id, slug, '50 Ervas Medicinais', 1599);
    db.prepare(`INSERT INTO course_enrollments(user_id,course_slug,order_reference,status)
      VALUES(?,?,?,'active')`).run(buyer.id, slug, 'course_ebook-test');
    response = await request(`/api/my-courses/${slug}/materials`, { headers });
    assert.equal(response.status, 200);
    assert.ok((await response.json()).files.some(file => file.path === '50-ervas-medicinais.pdf'));
    response = await request(fileUrl, { headers });
    assert.equal(response.status, 200, 'Compra aprovada libera o arquivo');
    assert.match(response.headers.get('content-type'), /application\/pdf/);
    db.prepare("UPDATE managed_courses SET status='paused' WHERE slug=?").run(slug);
    await stopServer();
    child = launch();
    await waitForServer();
    assert.equal(db.prepare('SELECT status FROM managed_courses WHERE slug=?').get(slug).status, 'paused',
      'Novo início não reativa um produto pausado pelo administrador');
    assert.equal(await feed(), undefined);
    response = await request('/api/my-courses', { headers });
    const enrollment = (await response.json()).courses.find(item => item.course_slug === slug);
    assert.equal(enrollment.status, 'active');
    assert.equal(enrollment.contentReady, false, 'A pausa encerra novas vendas');
    assert.equal((await request(fileUrl, { headers })).status, 200, 'Compradora mantém o PDF após pausa de vendas');
    db.prepare("UPDATE course_enrollments SET status='revoked' WHERE order_reference=?").run('course_ebook-test');
    assert.equal((await request(fileUrl, { headers })).status, 403, 'Estorno revoga acesso');
  } finally {
    db?.close();
    await stopServer();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
