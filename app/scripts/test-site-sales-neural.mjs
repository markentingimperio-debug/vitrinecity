import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import { createVitrinyNeural } from '../vitriny-neural/core.js';
import { createVitrinyNeuralSqliteStore } from '../vitriny-neural/sqlite-store.js';
import { setupSiteSalesNeural } from '../site-sales-neural.js';

function fixture(t, canRun = true) {
  const db = new Database(':memory:');
  const app = express();
  const neural = createVitrinyNeural({
    store: createVitrinyNeuralSqliteStore(db),
    nodeId: 'site-sales-test',
    now: () => Date.parse('2026-09-11T12:00:00Z')
  });
  db.exec(`CREATE TABLE site_sales_reviews(
    id INTEGER PRIMARY KEY,version_id INTEGER,window_start INTEGER,window_end INTEGER,status TEXT,metrics_json TEXT
  );`);
  const bridge = setupSiteSalesNeural({
    app, db, neural, canRun: () => canRun, schedule: false,
    requireAdmin(_req, _res, next) { next(); },
    now: () => Date.parse('2026-09-11T12:00:00Z')
  });
  t.after(() => { bridge.close(); db.close(); });
  return { db, app, neural, bridge };
}

test('sales review sync creates aggregate candidate signals and lessons idempotently', () => {
  const x = fixture({ after() {} });
  x.db.prepare('INSERT INTO site_sales_reviews VALUES(?,?,?,?,?,?)').run(1, 3, Date.parse('2026-09-10T12:00:00Z'), Date.parse('2026-09-11T12:00:00Z'), 'trial_started', JSON.stringify({ sessions: 40, messages: 18, offerClicks: 9, signups: 2, paidOrders: 1, revenueCents: 2500, privateMessage: 'não deve entrar' }));
  const first = x.bridge.sync();
  assert.equal(first.synced, 1);
  assert.equal(x.db.prepare('SELECT COUNT(*) n FROM neural_signals').get().n, 1);
  const lesson = x.db.prepare("SELECT * FROM neural_lessons WHERE id='site-sales-review-1'").get();
  assert.equal(lesson.status, 'candidate');
  assert.equal(lesson.risk, 'review');
  assert.doesNotMatch(lesson.evidence_json, /privateMessage|não deve entrar/);
  const second = x.bridge.sync();
  assert.equal(second.synced, 0);
  assert.equal(x.db.prepare('SELECT COUNT(*) n FROM neural_signals').get().n, 1);
  assert.equal(x.bridge.status().promotedLessons, 0);
});

test('paused neural bridge does not write review candidates', () => {
  const x = fixture({ after() {} }, false);
  x.db.prepare('INSERT INTO site_sales_reviews VALUES(?,?,?,?,?,?)').run(1, 1, 1, 2, 'no_traffic', '{}');
  const result = x.bridge.sync();
  assert.equal(result.status, 'paused');
  assert.equal(x.db.prepare('SELECT COUNT(*) n FROM neural_signals').get().n, 0);
  assert.equal(x.db.prepare('SELECT COUNT(*) n FROM site_sales_neural_reviews').get().n, 0);
});
