const METRICS = Object.freeze([
  'sessions', 'invitations', 'opens', 'dismissals', 'messages', 'messagingSessions',
  'offerClicks', 'offerClickSessions', 'signups', 'paidOrders', 'revenueCents', 'pendingOrders'
]);

const finiteCount = value => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1_000_000_000, Math.trunc(number))) : 0;
};

function aggregateMetrics(value) {
  let input = value;
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { input = {}; }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
  return Object.fromEntries(METRICS.map(key => [key, finiteCount(input[key])]));
}

function iso(value, fallback) {
  const date = new Date(Number(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function statusText(value) {
  const status = String(value || '').trim();
  return /^[a-z][a-z0-9_:-]{0,60}$/.test(status) ? status : 'unknown';
}

/**
 * Feeds only the 24-hour sales review aggregates into Vitriny Neural. The
 * bridge never sends transcripts, names, paths, cookies, IPs or affiliate
 * guesses, and it creates review-only lessons. A human must approve any
 * future lesson before it can influence production behavior.
 */
export function setupSiteSalesNeural({ app, db, requireAdmin, neural = null, canRun = () => false, now = Date.now, schedule = true, intervalMs = 5 * 60 * 1000 } = {}) {
  if (!db?.prepare || !db?.exec) throw new TypeError('Aprendizado do atendimento requer SQLite.');
  if (!app || typeof app.get !== 'function') throw new TypeError('Aprendizado do atendimento requer Express.');
  db.exec(`CREATE TABLE IF NOT EXISTS site_sales_neural_reviews(
    review_id INTEGER PRIMARY KEY,
    lesson_id TEXT NOT NULL UNIQUE,
    synced_at TEXT NOT NULL
  );`);

  const enabled = () => {
    try { return canRun() === true && Boolean(neural?.signal) && Boolean(neural?.lesson); }
    catch { return false; }
  };

  function status() {
    const synced = Number(db.prepare('SELECT COUNT(*) n FROM site_sales_neural_reviews').get()?.n || 0);
    const hasLessons = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='neural_lessons'").get());
    const candidates = hasLessons ? Number(db.prepare("SELECT COUNT(*) n FROM neural_lessons WHERE status='candidate'").get()?.n || 0) : 0;
    const promoted = hasLessons ? Number(db.prepare("SELECT COUNT(*) n FROM neural_lessons WHERE status='approved' AND id LIKE 'site-sales-review-%'").get()?.n || 0) : 0;
    const last = db.prepare('SELECT synced_at FROM site_sales_neural_reviews ORDER BY synced_at DESC LIMIT 1').get()?.synced_at || null;
    return {
      enabled: enabled(),
      mode: 'candidate_only',
      syncedReviews: synced,
      candidateLessons: candidates,
      promotedLessons: promoted,
      lastSyncAt: last,
      privacy: 'aggregate_only',
      automaticPromotion: false
    };
  }

  function sync() {
    if (!enabled()) return { status: 'paused', ...status(), synced: 0, errors: 0 };
    const rows = db.prepare(`SELECT id,version_id,window_start,window_end,status,metrics_json
      FROM site_sales_reviews ORDER BY id ASC`).all();
    let synced = 0;
    let errors = 0;
    const nowIso = () => new Date(Number(now())).toISOString();
    for (const row of rows) {
      if (db.prepare('SELECT 1 FROM site_sales_neural_reviews WHERE review_id=?').get(row.id)) continue;
      const metrics = aggregateMetrics(row.metrics_json);
      const sessions = metrics.sessions;
      const value = sessions ? Math.max(0, Math.min(1, metrics.paidOrders / sessions)) : 0;
      const confidence = sessions ? Math.min(0.9, sessions / 100) : 0;
      const lessonId = `site-sales-review-${row.id}`;
      const reviewStatus = statusText(row.status);
      const evidence = {
        source: 'site_sales.review',
        privacy: 'aggregate_only',
        reviewStatus,
        versionId: Number(row.version_id) || 0,
        metrics
      };
      const hypothesis = reviewStatus === 'conversion_observed'
        ? 'A abordagem teve ao menos uma compra paga atribuída; manter para revisão humana.'
        : reviewStatus === 'no_traffic'
          ? 'A abordagem teve tráfego insuficiente; não há evidência para alterar o atendimento.'
          : 'A abordagem deve ser comparada com uma única variação usando o funil agregado observado.';
      try {
        db.transaction(() => {
          neural.signal({
            metric: 'site_sales.review.conversion_rate',
            dimension: `version:${Number(row.version_id) || 0}`,
            value,
            confidence,
            windowStart: iso(row.window_start, nowIso()),
            windowEnd: iso(row.window_end, nowIso()),
            metadata: { aggregate: true, privacy: 'no_raw_personal_data', reviewStatus, sessions, messages: metrics.messages, offerClicks: metrics.offerClicks, signups: metrics.signups, paidOrders: metrics.paidOrders, pendingOrders: metrics.pendingOrders, revenueCents: metrics.revenueCents }
          });
          if (!db.prepare('SELECT 1 FROM neural_lessons WHERE id=?').get(lessonId)) {
            neural.lesson({
              id: lessonId,
              domain: 'commerce',
              hypothesis,
              evidence,
              reward: 0,
              confidence,
              sourceEventCount: sessions,
              verified: false,
              lowRisk: false
            });
          }
          db.prepare('INSERT INTO site_sales_neural_reviews(review_id,lesson_id,synced_at) VALUES(?,?,?)').run(row.id, lessonId, nowIso());
        }).immediate();
        synced++;
      } catch {
        errors++;
      }
    }
    return { status: 'synced', ...status(), synced, errors };
  }

  app.get('/api/admin/site-assistant/learning', requireAdmin, (_req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.json(status());
  });

  const timer = schedule ? setInterval(() => { try { sync(); } catch {} }, Math.max(10_000, Number(intervalMs) || 5 * 60 * 1000)) : null;
  timer?.unref?.();
  return { sync, status, close() { if (timer) clearInterval(timer); } };
}
