import { randomUUID } from 'node:crypto';

function clampLimit(value, fallback = 25) {
  return Math.max(1, Math.min(200, Number(value) || fallback));
}

export function createVitrinyNeuralSqliteStore(db) {
  if (!db?.prepare || !db?.exec) throw new TypeError('SQLite store requer uma conexão better-sqlite3.');

  function init({ version, nodeId }) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS neural_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS neural_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        source TEXT NOT NULL,
        entity_type TEXT NOT NULL DEFAULT '',
        entity_id TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL,
        dedupe_key TEXT,
        priority INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','processed','failed','dead_letter')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        lease_owner TEXT NOT NULL DEFAULT '',
        lease_until INTEGER NOT NULL DEFAULT 0,
        outcome_json TEXT NOT NULL DEFAULT 'null',
        error_message TEXT NOT NULL DEFAULT '',
        occurred_at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        processed_at TEXT,
        node_id TEXT NOT NULL DEFAULT ''
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_neural_events_dedupe ON neural_events(dedupe_key) WHERE dedupe_key IS NOT NULL AND dedupe_key<>'';
      CREATE INDEX IF NOT EXISTS idx_neural_events_queue ON neural_events(status,priority DESC,received_at,id);
      CREATE INDEX IF NOT EXISTS idx_neural_events_entity ON neural_events(entity_type,entity_id,occurred_at);
      CREATE TABLE IF NOT EXISTS neural_signals (
        id INTEGER PRIMARY KEY,
        metric TEXT NOT NULL,
        dimension TEXT NOT NULL,
        value REAL NOT NULL,
        confidence REAL NOT NULL,
        window_start TEXT NOT NULL,
        window_end TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        node_id TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_neural_signals_metric ON neural_signals(metric,dimension,window_end DESC);
      CREATE TABLE IF NOT EXISTS neural_lessons (
        id TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        hypothesis TEXT NOT NULL,
        evidence_json TEXT NOT NULL DEFAULT '{}',
        reward REAL NOT NULL DEFAULT 0,
        confidence REAL NOT NULL DEFAULT 0,
        source_event_count INTEGER NOT NULL DEFAULT 0,
        risk TEXT NOT NULL DEFAULT 'review',
        status TEXT NOT NULL DEFAULT 'candidate' CHECK(status IN ('candidate','approved','rejected','expired')),
        review_actor TEXT NOT NULL DEFAULT '',
        review_reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        node_id TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_neural_lessons_status ON neural_lessons(status,domain,confidence DESC,updated_at DESC);
      CREATE TABLE IF NOT EXISTS neural_checkpoints (
        component TEXT PRIMARY KEY,
        cursor TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS neural_audit (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        subject_id TEXT NOT NULL DEFAULT '',
        actor TEXT NOT NULL DEFAULT '',
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_neural_audit_created ON neural_audit(created_at DESC);
    `);
    const upsert = db.prepare(`INSERT INTO neural_meta(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`);
    upsert.run('schema_version', String(version));
    upsert.run('active_node', String(nodeId || 'local'));
  }

  function audit(kind, subjectId = '', actor = '', details = {}, at = new Date().toISOString()) {
    db.prepare('INSERT INTO neural_audit(id,kind,subject_id,actor,details_json,created_at) VALUES(?,?,?,?,?,?)')
      .run(randomUUID(), kind, subjectId, actor, JSON.stringify(details ?? {}), at);
  }

  function enqueueEvent(event) {
    const insert = db.prepare(`INSERT OR IGNORE INTO neural_events
      (id,type,source,entity_type,entity_id,payload_json,dedupe_key,priority,status,occurred_at,received_at,node_id)
      VALUES (?,?,?,?,?,?,?,?, 'pending',?,?,?)`);
    const result = insert.run(event.id,event.type,event.source,event.entityType,event.entityId,JSON.stringify(event.payload),event.dedupeKey||null,event.priority,event.occurredAt,event.receivedAt,event.nodeId);
    if (!result.changes && event.dedupeKey) {
      const existing = db.prepare('SELECT id,status FROM neural_events WHERE dedupe_key=?').get(event.dedupeKey);
      return { accepted:false, duplicate:true, id:existing?.id || null, status:existing?.status || null };
    }
    audit('event_ingested', event.id, event.source, { type:event.type, priority:event.priority }, event.receivedAt);
    return { accepted:true, duplicate:false, id:event.id, status:'pending' };
  }

  function claimEvents({ workerId, limit, leaseMs, now }) {
    const safeLimit = clampLimit(limit);
    const leaseUntil = Number(now) + Math.max(5_000, Math.min(10 * 60_000, Number(leaseMs) || 60_000));
    return db.transaction(() => {
      db.prepare(`UPDATE neural_events SET status='pending',lease_owner='',lease_until=0
        WHERE status='processing' AND lease_until>0 AND lease_until<=?`).run(Number(now));
      const rows = db.prepare(`SELECT * FROM neural_events
        WHERE status='pending' ORDER BY priority DESC,received_at,id LIMIT ?`).all(safeLimit);
      const claim = db.prepare(`UPDATE neural_events SET status='processing',lease_owner=?,lease_until=?,attempt_count=attempt_count+1
        WHERE id=? AND status='pending'`);
      const claimed=[];
      for (const row of rows) {
        if (!claim.run(workerId,leaseUntil,row.id).changes) continue;
        claimed.push({
          id:row.id,type:row.type,source:row.source,entityType:row.entity_type,entityId:row.entity_id,
          payload:JSON.parse(row.payload_json||'{}'),priority:row.priority,occurredAt:row.occurred_at,
          receivedAt:row.received_at,attemptCount:Number(row.attempt_count||0)+1
        });
      }
      return claimed;
    }).immediate();
  }

  function ackEvent({ id, workerId, outcome, at }) {
    const result = db.prepare(`UPDATE neural_events SET status='processed',outcome_json=?,error_message='',processed_at=?,lease_owner='',lease_until=0
      WHERE id=? AND status='processing' AND lease_owner=?`).run(JSON.stringify(outcome ?? null),at,id,workerId);
    if (result.changes) audit('event_processed', id, workerId, {}, at);
    return { ok:Boolean(result.changes) };
  }

  function failEvent({ id, workerId, error, at }) {
    const row=db.prepare('SELECT attempt_count FROM neural_events WHERE id=?').get(id);
    const terminal=Number(row?.attempt_count||0)>=5;
    const result=db.prepare(`UPDATE neural_events SET status=?,error_message=?,processed_at=?,lease_owner='',lease_until=0
      WHERE id=? AND status='processing' AND lease_owner=?`).run(terminal?'dead_letter':'failed',String(error||'worker_failed').slice(0,500),at,id,workerId);
    if (result.changes) audit(terminal?'event_dead_letter':'event_failed', id, workerId, { error:String(error||'worker_failed').slice(0,500) }, at);
    return { ok:Boolean(result.changes), terminal };
  }

  function recordSignal(signal) {
    const result=db.prepare(`INSERT INTO neural_signals(metric,dimension,value,confidence,window_start,window_end,metadata_json,created_at,node_id)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(signal.metric,signal.dimension,signal.value,signal.confidence,signal.windowStart,signal.windowEnd,JSON.stringify(signal.metadata),signal.createdAt,signal.nodeId);
    return { id:Number(result.lastInsertRowid) };
  }

  function addLesson(lesson) {
    db.prepare(`INSERT INTO neural_lessons
      (id,domain,hypothesis,evidence_json,reward,confidence,source_event_count,risk,status,created_at,updated_at,node_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(lesson.id,lesson.domain,lesson.hypothesis,JSON.stringify(lesson.evidence),lesson.reward,lesson.confidence,lesson.sourceEventCount,lesson.risk,lesson.status,lesson.createdAt,lesson.updatedAt,lesson.nodeId);
    audit('lesson_created', lesson.id, lesson.nodeId, { domain:lesson.domain,status:lesson.status,confidence:lesson.confidence }, lesson.createdAt);
    return { ...lesson };
  }

  function transitionLesson({ id, status, actor, reason = '', at }) {
    const result=db.prepare(`UPDATE neural_lessons SET status=?,review_actor=?,review_reason=?,updated_at=? WHERE id=?`)
      .run(status,actor,reason,at,id);
    if (!result.changes) return null;
    audit('lesson_'+status, id, actor, { reason }, at);
    return db.prepare('SELECT * FROM neural_lessons WHERE id=?').get(id);
  }

  function status({ now }) {
    const queue=db.prepare(`SELECT status,COUNT(*) total FROM neural_events GROUP BY status`).all();
    const lessons=db.prepare(`SELECT status,COUNT(*) total FROM neural_lessons GROUP BY status`).all();
    const signals=db.prepare('SELECT COUNT(*) total,MAX(created_at) last_at FROM neural_signals').get();
    const deadLetters=Number(db.prepare("SELECT COUNT(*) total FROM neural_events WHERE status='dead_letter'").get().total||0);
    return {
      driver:'sqlite',portable:true,
      queue:queue.map(row=>({status:row.status,total:Number(row.total||0)})),
      lessons:lessons.map(row=>({status:row.status,total:Number(row.total||0)})),
      signals:{total:Number(signals.total||0),lastAt:signals.last_at||null},
      deadLetters,
      now:new Date(Number(now)).toISOString(),
      migrationTargets:['postgresql','redis-streams','kafka','object-storage','vector-store']
    };
  }

  return { init, enqueueEvent, claimEvents, ackEvent, failEvent, recordSignal, addLesson, transitionLesson, status };
}
