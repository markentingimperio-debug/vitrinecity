import assert from 'node:assert/strict';
import {test} from 'node:test';
import Database from 'better-sqlite3';
import {createReviewedTeachingFixture,TEACHING_FIXTURE_NOW} from './fixtures/reviewed-teaching-knowledge-fixture.mjs';
import {publishReviewedTeachingKnowledge,revokeReviewedTeachingKnowledge,createReviewedTeachingKnowledge,REVIEWED_TEACHING_POLICY,REVIEWED_TEACHING_ACTOR} from '../vitriny-neural/reviewed-teaching-knowledge.js';
import {neuralDatasetPolicy} from '../vitriny-neural/dataset-builder.js';

const domains=['platform','commerce','operations','growth','search'];
const counts=db=>Object.fromEntries(db.prepare('SELECT status,COUNT(*) n FROM neural_training_examples GROUP BY status').all().map(r=>[r.status,r.n]));
const noTable=db=>!db.prepare("SELECT 1 FROM sqlite_master WHERE name='lia_reviewed_knowledge'").get();
const rowFor=(f,lessonId)=>f.db.prepare('SELECT * FROM neural_training_examples WHERE id LIKE ?').get('teach-'+lessonId+'-%');
const query='explorar recursos públicos pessoais administrativos login permissão';

test('dry-run validates exact receipts/candidates but leaves both supplied databases unchanged',t=>{
  const f=createReviewedTeachingFixture(t),before=f.db.serialize(),ledger=f.writer.serialize();
  const result=publishReviewedTeachingKnowledge({...f.options,dryRun:true});
  assert.equal(result.accepted,10);assert.equal(result.dryRun,true);assert.equal(noTable(f.db),true);
  assert.deepEqual(f.db.serialize(),before);assert.deepEqual(f.writer.serialize(),ledger);
});

test('explicit policy publishes 48 accepted lessons and leaves two revise rows and unrelated candidates untouched',t=>{
  const f=createReviewedTeachingFixture(t,{domains,reviseIds:['platform-05','operations-07']});
  const revised=rowFor(f,'platform-05');f.db.prepare('UPDATE neural_training_examples SET expected_output=? WHERE id=?').run('Correção anterior que não deve ser alterada.',revised.id);
  const beforeRevision=f.db.prepare('SELECT * FROM neural_training_examples WHERE id=?').get(revised.id);
  f.builder.createCandidate({domain:'platform',instruction:'Um exemplo arbitrário fora do piloto.',expectedOutput:'Permanece candidato, sem publicação automática.',source:'manual'});
  const ledger=f.writer.serialize(),result=publishReviewedTeachingKnowledge(f.options);
  assert.equal(result.published,48);assert.equal(result.retainedForRevision,2);assert.deepEqual(counts(f.db),{approved:48,candidate:3});
  assert.deepEqual(f.db.prepare('SELECT * FROM neural_training_examples WHERE id=?').get(revised.id),beforeRevision);
  assert.deepEqual(f.writer.serialize(),ledger);assert.equal(neuralDatasetPolicy.humanApprovalRequired,true);assert.equal(neuralDatasetPolicy.automaticTraining,false);
  const audited=f.db.prepare("SELECT actor,details_json FROM neural_audit WHERE kind='lia_reviewed_knowledge_published'").all();
  assert.equal(audited.length,48);for(const event of audited){assert.equal(event.actor,REVIEWED_TEACHING_ACTOR);assert.equal(JSON.parse(event.details_json).humanReview,false);}
});

test('re-import is idempotent, creates no second approval/audit and never changes ledger receipts',t=>{
  const f=createReviewedTeachingFixture(t),ledger=f.writer.serialize();publishReviewedTeachingKnowledge(f.options);const before=f.db.serialize();
  const again=publishReviewedTeachingKnowledge(f.options);assert.equal(again.published,0);assert.equal(again.duplicates,10);
  assert.deepEqual(f.db.serialize(),before);assert.deepEqual(f.writer.serialize(),ledger);
});

test('authorization must explicitly target knowledge only; general dataset human approval remains unchanged',t=>{
  const f=createReviewedTeachingFixture(t);
  for(const authorization of [undefined,{}, {...f.authorization,confirmed:false},{...f.authorization,scope:'publish-posts'},{...f.authorization,actor:'human-admin'},{...f.authorization,policyId:'human-review'}]){
    assert.throws(()=>publishReviewedTeachingKnowledge({...f.options,authorization}),{code:'reviewed_knowledge_authorization_required'});
  }
  assert.equal(noTable(f.db),true);assert.deepEqual(counts(f.db),{candidate:10});
  assert.throws(()=>f.builder.review(rowFor(f,'platform-01').id,{status:'approved',confirmed:false}));
});

test('writer ledger or operational ledger substitution is rejected before publication',t=>{
  const f=createReviewedTeachingFixture(t);
  for(const ledgerDb of [f.writer,f.db])assert.throws(()=>publishReviewedTeachingKnowledge({...f.options,ledgerDb}),{code:'reviewed_knowledge_config_invalid'});
  assert.equal(noTable(f.db),true);
});

test('receipt token counters must be complete nonnegative integers, coherent and within the saved request bounds',t=>{
  const changes=[{cachedInputTokens:-1},{inputTokens:1.5},{cachedInputTokens:2001},{totalTokens:1},{outputTokens:8193,totalTokens:10193},{inputTokens:Number.MAX_SAFE_INTEGER+1},{inputTokens:100000, totalTokens:100500}];
  for(const change of changes){
    const f=createReviewedTeachingFixture(t),id=f.reports[0].reviewer.id;
    const row=f.writer.prepare('SELECT result_json FROM admin_teaching_pilot_runs WHERE id=?').get(id),result=JSON.parse(row.result_json);
    Object.assign(result.usage,change);f.writer.prepare('UPDATE admin_teaching_pilot_runs SET result_json=? WHERE id=?').run(JSON.stringify(result),id);
    const before=f.db.serialize(),ledger=f.writer.serialize();assert.throws(()=>publishReviewedTeachingKnowledge(f.options),{code:'reviewed_knowledge_receipt_invalid'});
    assert.deepEqual(f.db.serialize(),before);assert.deepEqual(f.writer.serialize(),ledger);assert.equal(noTable(f.db),true);
  }
});

test('even matching report totals cannot authorize malformed or over-reserved receipt amounts',t=>{
  const changes=[['maximumMicroBrl','maximum_micro',-1],['actualMicroUsd','actual_usd_micro',-1],['actualMicroUsd','actual_usd_micro',1.5],['actualMicroUsd','actual_usd_micro',Number.MAX_SAFE_INTEGER+1],['actualMicroBrl','actual_micro',99],['chargedMicroBrl','charged_micro',1001]];
  for(const [key,column,value] of changes){
    const f=createReviewedTeachingFixture(t),summary=f.reports[0].reviewer;
    summary[key]=String(value);f.writer.prepare(`UPDATE admin_teaching_pilot_runs SET ${column}=? WHERE id=?`).run(value,summary.id);
    const before=f.db.serialize(),ledger=f.writer.serialize();assert.throws(()=>publishReviewedTeachingKnowledge(f.options),{code:'reviewed_knowledge_receipt_invalid'});
    assert.deepEqual(f.db.serialize(),before);assert.deepEqual(f.writer.serialize(),ledger);assert.equal(noTable(f.db),true);
  }
});

test('one conflicting/rejected accepted candidate fails the entire batch without partial approval',t=>{
  for(const mutation of ["status='rejected'","expected_output='Texto adulterado sem alterar o hash'","input_text='Dados de outra conta'","source='manual'"]){
    const f=createReviewedTeachingFixture(t);f.db.exec(`UPDATE neural_training_examples SET ${mutation} WHERE id='${rowFor(f,'platform-10').id}'`);
    const before=f.db.serialize();assert.throws(()=>publishReviewedTeachingKnowledge(f.options),{code:'reviewed_knowledge_candidate_conflict'});
    assert.deepEqual(f.db.serialize(),before);assert.equal(noTable(f.db),true);
  }
});

test('an insertion failure rolls back table, approved statuses and all audits atomically',t=>{
  const f=createReviewedTeachingFixture(t);f.db.exec(`CREATE TRIGGER refuse_approval BEFORE UPDATE ON neural_training_examples WHEN NEW.id='${rowFor(f,'platform-10').id}' BEGIN SELECT RAISE(ABORT,'fixture rollback'); END;`);
  const before=f.db.serialize();assert.throws(()=>publishReviewedTeachingKnowledge(f.options),/fixture rollback/);
  assert.equal(noTable(f.db),true);assert.deepEqual(counts(f.db),{candidate:10});assert.deepEqual(f.db.serialize(),before);
});

test('retrieval creates no tables and issues only SELECTs even with an absent knowledge base',t=>{
  const db=new Database(':memory:');t.after(()=>db.close());const statements=[];
  const reader={prepare(sql){statements.push(sql);assert.match(sql,/^SELECT /);return db.prepare(sql);}};
  const knowledge=createReviewedTeachingKnowledge({db:reader,now:()=>TEACHING_FIXTURE_NOW});assert.deepEqual(statements,[]);
  assert.deepEqual(knowledge.retrieve('como vender produtos'),[]);assert.ok(statements.length);assert.equal(noTable(db),true);
});

test('retrieval returns at most two whole answers/1200 chars with bounded public provenance as data',t=>{
  const f=createReviewedTeachingFixture(t);publishReviewedTeachingKnowledge(f.options);const statements=[];
  const reader={prepare(sql){statements.push(sql);assert.match(sql,/^SELECT /);return f.db.prepare(sql);}};
  const before=f.db.serialize(),knowledge=createReviewedTeachingKnowledge({db:reader,now:f.now}),items=knowledge.retrieve('fontes aprovadas');
  assert.equal(items.length,2);assert.ok(items.reduce((n,item)=>n+item.excerpt.length,0)<=1200);
  for(const item of items){assert.match(item.citation,/^LK[12]$/);assert.match(item.source,/^lia-reviewed-knowledge:platform-/);assert.match(item.revision,/^lia-admin-20260915-v1:[a-f0-9]{16}$/);assert.equal(item.trust,'reference-data-only');assert.equal(item.expiresAt,'2026-10-15T23:59:59.999Z');assert.ok(f.reports[0].lessons.some(l=>l.answer===item.excerpt));}
  assert.doesNotMatch(JSON.stringify(items),/receiptId|fixture-platform|ledgerFingerprint|inputHash|resultHash/);
  assert.deepEqual(f.db.serialize(),before);assert.ok(statements.length);
});

test('current dataset edits, rejection or changed reviewer remove knowledge without relying on stored content_hash',t=>{
  for(const change of ["expected_output='Conteúdo alterado'","instruction='Outra instrução privada'","input_text='Outra conversa privada'","status='rejected'","review_actor='human-admin'","review_reason='another-policy'"]){
    const f=createReviewedTeachingFixture(t);publishReviewedTeachingKnowledge(f.options);
    const knowledge=createReviewedTeachingKnowledge({db:f.db,now:f.now});assert.ok(knowledge.retrieve(query).some(r=>r.source.endsWith('platform-02')));
    f.db.exec(`UPDATE neural_training_examples SET ${change} WHERE id='${rowFor(f,'platform-02').id}'`);
    assert.ok(knowledge.retrieve(query).every(r=>!r.source.endsWith('platform-02')));
  }
});

test('expired sources or corrupt publication hashes are omitted, not repaired during a chat',t=>{
  const f=createReviewedTeachingFixture(t);publishReviewedTeachingKnowledge(f.options);
  assert.deepEqual(createReviewedTeachingKnowledge({db:f.db,now:()=>Date.parse('2026-10-16T00:00:00Z')}).retrieve(query),[]);
  f.db.prepare('UPDATE lia_reviewed_knowledge SET answer=?').run('Uma resposta adulterada.');const before=f.db.serialize();
  assert.deepEqual(createReviewedTeachingKnowledge({db:f.db,now:f.now}).retrieve(query),[]);assert.deepEqual(f.db.serialize(),before);
});

test('COINS lessons stay out of retrieval by complete curriculum permission set',t=>{
  const f=createReviewedTeachingFixture(t);publishReviewedTeachingKnowledge(f.options);const knowledge=createReviewedTeachingKnowledge({db:f.db,now:f.now});
  for(const lessonId of ['platform-07','platform-08']){
    const question=rowFor(f,lessonId).instruction;
    assert.ok(knowledge.retrieve(question).every(r=>!r.source.endsWith(lessonId)));
  }
});

test('logical revocation preserves evidence, restores only its own unchanged approval, and blocks implicit reactivation',t=>{
  const f=createReviewedTeachingFixture(t);publishReviewedTeachingKnowledge(f.options);
  const records=f.db.prepare('SELECT * FROM lia_reviewed_knowledge ORDER BY id LIMIT 2').all();
  f.db.prepare("UPDATE neural_training_examples SET review_actor='human-reviewer' WHERE id=?").run(records[1].example_id);
  const revoked=revokeReviewedTeachingKnowledge({db:f.db,ids:records.map(r=>r.id),authorization:f.authorization,reason:'rollback',now:f.now});
  assert.deepEqual(revoked,{revoked:2,restoredCandidates:1});assert.equal(f.db.prepare('SELECT COUNT(*) n FROM lia_reviewed_knowledge').get().n,10);
  assert.equal(f.db.prepare('SELECT status FROM neural_training_examples WHERE id=?').get(records[1].example_id).status,'approved');
  for(const row of records)assert.equal(f.db.prepare('SELECT status FROM lia_reviewed_knowledge WHERE id=?').get(row.id).status,'revoked');
  assert.throws(()=>publishReviewedTeachingKnowledge(f.options),{code:'reviewed_knowledge_candidate_conflict'});
  assert.deepEqual(revokeReviewedTeachingKnowledge({db:f.db,ids:records.map(r=>r.id),authorization:f.authorization,reason:'rollback',now:f.now}),{revoked:0,restoredCandidates:0});
});

test('expired knowledge can be revoked and its unchanged automated dataset approval rolled back',t=>{
  const f=createReviewedTeachingFixture(t);publishReviewedTeachingKnowledge(f.options);const ids=f.db.prepare('SELECT id FROM lia_reviewed_knowledge').all().map(r=>r.id);
  const result=revokeReviewedTeachingKnowledge({db:f.db,ids,authorization:f.authorization,reason:'source-invalidated',now:()=>Date.parse('2026-11-01T00:00:00Z')});
  assert.deepEqual(result,{revoked:10,restoredCandidates:10});assert.deepEqual(counts(f.db),{candidate:10});
});

test('no arbitrary tenant/private/manual approved dataset item can enter the narrow retrieval table',t=>{
  const f=createReviewedTeachingFixture(t);const arbitrary=f.builder.createCandidate({domain:'platform',instruction:'Atender uma conta particular fora do currículo.',expectedOutput:'Canário privado de outra conta.',source:'manual'});
  f.builder.review(arbitrary.id,{status:'approved',confirmed:true,actor:'authorized-human'});publishReviewedTeachingKnowledge(f.options);
  assert.equal(f.db.prepare('SELECT 1 FROM lia_reviewed_knowledge WHERE example_id=?').get(arbitrary.id),undefined);
  assert.deepEqual(createReviewedTeachingKnowledge({db:f.db,now:f.now}).retrieve('Canário privado outra conta'),[]);
});
