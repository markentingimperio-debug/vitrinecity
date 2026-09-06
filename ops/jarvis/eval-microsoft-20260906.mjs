// Mount this operator-only harness alongside /app/jarvis-core.js.
// Production is opened read-only; all curriculum writes target :memory: only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import Database from 'better-sqlite3';
import {createJarvis} from './jarvis-core.js';
import {validateCurriculum, applyCurriculum, planCurriculum} from './scripts/jarvis-curriculum.mjs';

const setting = process.env.EVAL_LOCAL_MODEL ?? '0';
assert.ok(['0', '1'].includes(setting), 'EVAL_LOCAL_MODEL must be 0 or 1.');
const localModel = setting === '1';
const readPack = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const pack = validateCurriculum(readPack('/lesson.json'));
assert.equal(pack.documents.length, 2, 'Revision v2 must contain exactly two additions.');
assert.equal(pack.corrections.length, 0, 'Existing knowledge must not be corrected by this pilot.');
assert.ok(Array.isArray(pack.questions) && pack.questions.length === 6, 'Expect six pilot questions.');
const targets = new Map(pack.documents.map(doc => [doc.title, doc]));
const questionCounts = new Map(pack.documents.map(doc => [doc.title, 0]));
const uniqueQuestions = new Set();
for (const q of pack.questions) {
  assert.ok(typeof q.question === 'string' && q.question.length >= 3 && q.question.length <= 700, 'Invalid pilot question.');
  assert.ok(targets.has(q.title), 'Each pilot question must identify a document in this pack.');
  assert.ok(!uniqueQuestions.has(q.question), 'Duplicate pilot question.');
  uniqueQuestions.add(q.question);
  questionCounts.set(q.title, questionCounts.get(q.title) + 1);
  if (q.answerIncludes !== undefined) assert.ok(Array.isArray(q.answerIncludes) && q.answerIncludes.every(t => typeof t === 'string' && t.length > 0), 'Invalid expected answer terms.');
}
assert.ok([...questionCounts.values()].every(count => count === 3), 'Expect three questions per new document, including a held-out wording.');
const controls = ['/initial.json', '/search-lesson.json', '/learning-lesson.json'].flatMap(file => {
  const lesson = readPack(file);
  assert.ok(Array.isArray(lesson.questions) && lesson.questions.length > 0, 'Missing control questions.');
  return lesson.questions;
});
const live = new Database('/data/vitrinecity.db', {readonly:true, fileMustExist:true});
let db;
let modelCalls = 0;
try {
  const snapshot = live.prepare('SELECT * FROM jarvis_documents ORDER BY id').all();
  assert.equal(snapshot.length, 13, 'Memory baseline changed; inspect before evaluating this pilot.');
  // Recompute this exact canonical digest immediately before a separately approved import.
  const snapshotHashFormat = 'sha256:utf8-json:rows-id-ascending:object-keys-sorted';
  const orderedSnapshot = [...snapshot].sort((a, b) => a.id - b.id).map(row =>
    Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])));
  const snapshotSha256 = createHash('sha256').update(JSON.stringify(orderedSnapshot)).digest('hex');
  const existingIds = new Set(snapshot.map(doc => doc.id));
  const assertSame = (actual, expected, message) => assert.ok(isDeepStrictEqual(actual, expected), message);
  const guard = () => {
    assert.equal(live.prepare('SELECT enabled FROM jarvis_settings WHERE id=1').get()?.enabled, 1, 'Jarvis paused; postpone evaluation.');
    assert.equal(live.prepare("SELECT COUNT(*) n FROM jarvis_runs WHERE status='running'").get().n, 0, 'Live query in progress; postpone evaluation.');
  };
  const plan = planCurriculum(live, pack);
  assert.equal(plan.operations.length, 2, 'Revision v2 must plan exactly two new records.');
  assert.ok(plan.operations.every(op => op.kind === 'create'), 'Pilot plan would modify existing knowledge.');
  assert.equal(plan.skipped.length, 0, 'Pilot overlaps existing knowledge; review duplicate before testing.');

  db = new Database(':memory:');
  const core = createJarvis(db, {
    env:{JARVIS_LOCAL_MODEL:localModel ? '1' : '0'},
    fetchImpl:(url, options) => {
      assert.ok(localModel, 'Network calls are forbidden when EVAL_LOCAL_MODEL=0.');
      assert.equal(url, 'http://jarvis-model:8080/v1/chat/completions', 'Unexpected model endpoint.');
      guard();
      modelCalls++;
      return fetch(url, {...options, signal:AbortSignal.any([options.signal, AbortSignal.timeout(25000)])});
    }
  });
  // Remove bootstrap rows only in the disposable database, then copy every source row.
  db.transaction(() => {
    db.prepare('DELETE FROM jarvis_documents').run();
    const insert = db.prepare('INSERT INTO jarvis_documents(id,title,body,source,status,revision,expires_at,created_at,updated_at,updated_by) VALUES(@id,@title,@body,@source,@status,@revision,@expires_at,@created_at,@updated_at,@updated_by)');
    for (const row of snapshot) insert.run(row);
  })();
  assertSame(db.prepare('SELECT * FROM jarvis_documents ORDER BY id').all(), snapshot, 'Disposable snapshot differs from the read-only source.');
  const preserveExisting = () => {
    const rows = db.prepare('SELECT * FROM jarvis_documents ORDER BY id').all().filter(doc => existingIds.has(doc.id));
    // Boolean equality avoids logging document bodies in an assertion diff.
    assertSame(rows, snapshot, 'Existing document content or metadata changed in the evaluation.');
  };
  const expectedRank = (sources, target) => sources.findIndex(s => s.title === target.title && s.source === target.source) + 1;
  const baseline = pack.questions.map(q => ({question:q.question, expected:q.title, rank:expectedRank(core.retrieve(q.question), targets.get(q.title))}));
  const controlTargets = controls.map(q => {
    const candidates = snapshot.filter(doc => doc.title === q.title);
    assert.equal(candidates.length, 1, 'Control target missing or ambiguous in the current memory.');
    return candidates[0];
  });
  const beforeControls = controls.map((q, i) => expectedRank(core.retrieve(q.question), controlTargets[i]));
  const installed = applyCurriculum(db, pack, {confirmed:true}); // Reviewed test input; never the live database.
  assert.equal(installed.changes.length, 2);
  assert.ok(installed.changes.every(change => change.kind === 'create' && !existingIds.has(change.id)));
  assert.equal(applyCurriculum(db, pack, {confirmed:true}).changes.length, 0, 'Reapplication must be a no-op.');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM jarvis_documents').get().n, snapshot.length + 2);
  preserveExisting();
  const afterControls = controls.map((q, i) => expectedRank(core.retrieve(q.question), controlTargets[i]));
  const controlResults = controls.map((q, i) => ({question:q.question, expected:q.title, beforeRank:beforeControls[i], afterRank:afterControls[i]}));
  console.log(JSON.stringify({snapshotSha256, snapshotHashFormat, baseline, controls:controlResults}));
  assert.ok(beforeControls.every((rank, i) => rank === 0 || afterControls[i] > 0), 'A previously retrieved control source disappeared.');
  assert.ok(beforeControls.every((rank, i) => rank === 0 || afterControls[i] <= rank), 'A control source ranked worse after the pilot; review before importing.');
  assert.ok(afterControls.filter(Boolean).length >= beforeControls.filter(Boolean).length, 'Control coverage decreased.');

  const results = [];
  for (const q of pack.questions) {
    if (localModel) guard();
    const answer = await core.ask({question:q.question}, 0);
    const rank = expectedRank(answer.sources, targets.get(q.title));
    let reportedAnswer = answer.answer;
    let omittedExistingExcerpts = 0;
    for (const source of answer.sources.filter(s => existingIds.has(s.id))) {
      if (source.excerpt && reportedAnswer.includes(source.excerpt)) {
        reportedAnswer = reportedAnswer.split(source.excerpt).join('[Trecho de conhecimento preexistente omitido deste relatório.]');
        omittedExistingExcerpts++;
      }
    }
    const result = {
      question:q.question, expected:q.title, expectedSourceFound:rank > 0, rank,
      mode:answer.mode, reason:answer.reason, answer:reportedAnswer, durationMs:answer.durationMs,
      omittedExistingExcerpts,
      termsFound:q.answerIncludes?.length ? q.answerIncludes.every(term => answer.answer.toLocaleLowerCase('pt-BR').includes(term.toLocaleLowerCase('pt-BR'))) : null
    };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  const unknownQuestion = 'Qual será o faturamento exato amanhã?';
  assert.equal(core.retrieve(unknownQuestion).length, 0, 'Unknown forecast unexpectedly matched knowledge; inspect without generating.');
  if (localModel) guard();
  const callsBeforeUnknown = modelCalls;
  const unknown = await core.ask({question:unknownQuestion}, 0);
  assert.equal(unknown.status, 'no_sources');
  assert.equal(modelCalls, callsBeforeUnknown, 'A question without sources must not call the model.');
  if (!localModel) assert.equal(modelCalls, 0, 'Offline evaluation performed a model request.');
  // Post-evaluation lifecycle probe: archive only a record created in this disposable database.
  const archiveTarget = core.get(installed.changes[0].id);
  assert.ok(!existingIds.has(archiveTarget.id), 'Archive probe must never target an existing document.');
  assert.equal(targets.get(archiveTarget.title)?.source, archiveTarget.source, 'Archive probe must belong to this pilot.');
  const archived = core.transition(archiveTarget.id, {status:'archived', revision:archiveTarget.revision}, 0);
  const archiveReapply = applyCurriculum(db, pack, {confirmed:true});
  assert.equal(archiveReapply.changes.length, 0, 'Reapplication must preserve an archived pilot document.');
  assert.equal(core.get(archived.id).status, 'archived');
  assertSame(core.get(archived.id), archived, 'Reapplication changed the archived document or its revision.');
  preserveExisting();
  assertSame(live.prepare('SELECT * FROM jarvis_documents ORDER BY id').all(), snapshot, 'Live memory changed during evaluation; results need a fresh review.');
  assert.equal(db.pragma('quick_check', {simple:true}), 'ok');
  const summary = {
    pilot:pack.id, localModel, modelCalls, snapshotSha256, snapshotHashFormat,
    existingDocuments:snapshot.length, additions:installed.changes.length,
    preservedExisting:true, liveMemoryUnchanged:true, reapplicationChanges:0,
    postEvaluationArchiveProbe:{scope:'disposable_database_only', reapplicationChanges:archiveReapply.changes.length, archivedDocumentPreserved:true},
    baselineSourceMatches:baseline.filter(r => r.rank > 0).length,
    sourceMatches:results.filter(r => r.expectedSourceFound).length, total:results.length,
    generated:results.filter(r => r.mode === 'local_model').length,
    fallbacks:results.filter(r => r.mode === 'retrieval').length,
    controlMatchesBefore:beforeControls.filter(Boolean).length,
    controlMatchesAfter:afterControls.filter(Boolean).length, totalControls:controls.length,
    unknown:unknown.status, semanticReview:'required; citations and term matches are not a correctness verdict'
  };
  console.log(JSON.stringify({summary}));
  assert.ok(results.every(r => r.expectedSourceFound), 'Pilot source missing from at least one answer.');
} finally {
  db?.close();
  live.close();
}
