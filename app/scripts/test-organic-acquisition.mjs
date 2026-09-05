import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import express from 'express';
import { setupAdminAnalytics } from '../admin-analytics.js';
import { classifyAcquisition, acquisitionReport, recordAcquisitionSignup, setupOrganicAcquisition } from '../organic-acquisition.js';

function fixture() {
  const db = new Database(':memory:'), app = express(); app.use(express.json());
  db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY)');
  const requireAdmin = (req, res, next) => req.get('x-test-admin') === 'yes' ? next() : res.sendStatus(401);
  setupAdminAnalytics({ app, db, requireAdmin, publicDir: '/tmp' });
  setupOrganicAcquisition({ app, db, requireAdmin, publicDir: '/tmp' });
  return { app, db };
}
test('acquisition classification does not mistake unknown, paid or spoofed referrers for organic', () => {
  assert.equal(classifyAcquisition({}), 'Direto / origem desconhecida');
  assert.equal(classifyAcquisition({ referrer: 'https://www.google.com.br/search?q=x' }), 'Busca orgânica provável');
  assert.equal(classifyAcquisition({ referrer: 'https://google.com.evil.test' }), 'Outras referências');
  assert.equal(classifyAcquisition({ fbclid: 'abc', referrer: 'https://l.facebook.com' }), 'Social / referência provável');
  assert.equal(classifyAcquisition({ utm_medium: 'paid_social' }), 'Mídia paga identificada');
  assert.equal(classifyAcquisition({ gclid: 'abc', utm_medium: 'organic' }), 'Mídia paga identificada');
  assert.equal(classifyAcquisition({ utm_medium: 'organic_social' }), 'Social orgânico identificado');
  assert.equal(classifyAcquisition({ referrer: 'https://vitrinecity.com/social' }), 'Direto / origem desconhecida');
});
test('opt-in signup requires a known session, deduplicates and aggregates only the cohort', () => {
  const { db } = fixture();
  try {
    db.exec("INSERT INTO users(id) VALUES (1),(2),(3); INSERT INTO analytics_sessions(session_id,landing_path,first_seen_at) VALUES ('vc_1234567890abcdef','/loja?private@example.com','2026-09-04 10:00:00'),('vc_old123456789abc','/old','2020-01-01 00:00:00')");
    const req = (consent, sid = 'vc_1234567890abcdef') => ({ path: '/api/auth/register', get: key => ({ 'x-vc-session': sid, 'x-vc-analytics-consent': consent })[key] });
    recordAcquisitionSignup(db, req('essential'), 1);
    recordAcquisitionSignup(db, req('accepted', 'vc_nonexistentabc'), 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM analytics_events').get().n, 0);
    recordAcquisitionSignup(db, req('accepted'), 1);
    recordAcquisitionSignup(db, req('accepted'), 1);
    recordAcquisitionSignup(db, req('accepted'), 2);
    recordAcquisitionSignup(db, req('accepted', 'vc_old123456789abc'), 3);
    db.exec("UPDATE analytics_events SET created_at='2026-09-04 12:00:00'; INSERT INTO analytics_events(session_id,event_name,asset_type,created_at) VALUES ('vc_1234567890abcdef','click','organic_cta','2026-09-04 12:00:00'),('vc_1234567890abcdef','click','organic_cta','2026-09-04 12:01:00')");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM analytics_events WHERE event_name='signup_confirmed' AND user_id=1").get().n, 1);
    const data = acquisitionReport(db, 7, new Date('2026-09-05T20:00:00Z'));
    assert.deepEqual(data.summary, { sessions: 1, engagedSessions: 1, signupSessions: 1 });
    assert.equal(data.landings[0].label, '/loja');
    assert(!JSON.stringify(data).includes('private@'));
    assert(!JSON.stringify(data).includes('vc_123'));
    assert.equal(data.truncated, false);
  } finally { db.close(); }
});
test('read-only report is protected, noncacheable, validates range; clients cannot forge confirmed signups', async () => {
  const { app, db } = fixture(), server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(base + '/api/admin/organic-acquisition')).status, 401);
    assert.equal((await fetch(base + '/admin-captacao.html')).status, 401);
    const response = await fetch(base + '/api/admin/organic-acquisition?days=7', { headers: { 'x-test-admin': 'yes' } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).summary.sessions, 0);
    for (const days of ['365', 'abc', '7%20OR%201=1', '07', '']) assert.equal((await fetch(base + '/api/admin/organic-acquisition?days=' + days, { headers: { 'x-test-admin': 'yes' } })).status, 400);
    assert.equal((await fetch(base + '/api/analytics/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'vc_1234567890abcdef', eventName: 'signup_confirmed' }) })).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); db.close(); }
});
test('guide has one canonical and H1, no gate, and both registration handlers record success only', () => {
  const html = readFileSync(new URL('../public/guias/plantas-em-vasos.html', import.meta.url), 'utf8');
  assert.equal((html.match(/<h1>/g) || []).length, 1); assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
  assert.match(html, /Sem cadastro obrigatório/); assert.doesNotMatch(html, /<form/);
  assert.match(html, /returnTo=%2Fsocial/); assert.match(html, /data-asset-type="organic_cta"/);
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.equal((server.match(/recordAcquisitionSignup\(db,\s?req,\s?userId\)/g) || []).length, 2);
  assert.match(server, /ADMIN_HTML_PATHS\.add\('\/admin-captacao.html'\)/);
});
