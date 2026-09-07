import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createVitrinyNeural } from '../vitriny-neural/core.js';
import { createVitrinyNeuralSqliteStore } from '../vitriny-neural/sqlite-store.js';

const db = new Database(':memory:');
const store = createVitrinyNeuralSqliteStore(db);
const neural = createVitrinyNeural({ store, nodeId:'test-node', now:()=>Date.parse('2026-09-06T20:00:00.000Z') });

try {
  const first = neural.ingest({
    type:'content.view', source:'vitrine-social', entityType:'post', entityId:'p1',
    dedupeKey:'view:p1:u1:2026-09-06T20:00', payload:{ watchSeconds:42, completed:true }, priority:3
  });
  assert.equal(first.accepted,true);
  const duplicate = neural.ingest({
    type:'content.view', source:'vitrine-social', entityType:'post', entityId:'p1',
    dedupeKey:'view:p1:u1:2026-09-06T20:00', payload:{ watchSeconds:42, completed:true }
  });
  assert.equal(duplicate.duplicate,true);

  const results = await neural.workBatch(async event => ({ learnedFrom:event.type }), { workerId:'test-worker', limit:10 });
  assert.equal(results.length,1);
  assert.equal(results[0].ok,true);
  assert.equal(db.prepare("SELECT status FROM neural_events WHERE id=?").get(first.id).status,'processed');

  const signal = neural.signal({ metric:'content.retention', dimension:'post:p1', value:0.82, confidence:0.99, metadata:{ sample:1000 } });
  assert.ok(signal.id>0);

  const candidate = neural.lesson({
    domain:'content', hypothesis:'Quizzes com gancho em até 4 segundos elevam retenção.',
    evidence:{ metric:'content.retention', delta:0.18 }, reward:0.7, confidence:0.88, sourceEventCount:1200
  });
  assert.equal(candidate.status,'candidate');

  const automatic = neural.lesson({
    domain:'ranking', hypothesis:'Aumentar discretamente o peso de conclusão para conteúdos de alta retenção.',
    evidence:{ offlineEvaluation:true, regression:false }, reward:0.22, confidence:0.97, sourceEventCount:8000,
    verified:true, lowRisk:true
  });
  assert.equal(automatic.status,'approved');

  const approved = neural.approveLesson(candidate.id,{ actor:'admin:test', confirmed:true });
  assert.equal(approved.status,'approved');

  const status = neural.status();
  assert.equal(status.name,'Vitriny Neural');
  assert.equal(status.store.driver,'sqlite');
  assert.equal(status.policy.destructiveActions,false);
  console.log(JSON.stringify({ok:true,status}));
} finally {
  db.close();
}
