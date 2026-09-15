import { createHash } from 'node:crypto';
import { teachingSources, teachingSourceRevision } from './admin-teaching-sources.js';
import { LIA_CURATED_ACTOR, LIA_CURATED_POLICY } from './lia-curated-knowledge.js';

const SCOPE = 'lia-curated-knowledge-only';
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const canonical = (value) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const sourceMap = new Map(teachingSources.map((source) => [source.id, source]));
const safe = (value, max) => typeof value === 'string' && value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) && !/-----BEGIN|\b(?:api[_ -]?key|senha|password|bearer)\s*[:=]/i.test(value);
const exists = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
const clock = (now) => { const at = now(); if (!Number.isSafeInteger(at) || at <= 0 || at > 8640000000000000) fail('lia_rounds_clock_invalid'); return at; };
const seal = (row) => sha(canonical({ id: row.id, lessonId: row.lesson_id, domain: row.domain, question: row.question, answer: row.answer, sourceIds: JSON.parse(row.source_ids_json), sourceRevision: row.source_revision, reportHash: row.report_hash, reviewHash: row.review_hash, expiresAt: row.expires_at, policyId: row.policy_id, actor: row.approval_actor }));
const expiry = (ids) => {
  const dates = ids.map((id) => sourceMap.get(id)?.expiresAt).filter(Boolean).map((value) => Date.parse(value.length === 10 ? `${value}T23:59:59.999Z` : value));
  if (dates.length !== ids.length || dates.some((value) => !Number.isFinite(value))) fail('lia_rounds_source_invalid');
  return new Date(Math.min(...dates)).toISOString();
};
function table(db) { db.exec(`CREATE TABLE IF NOT EXISTS lia_curated_knowledge(id TEXT PRIMARY KEY,lesson_id TEXT NOT NULL UNIQUE,domain TEXT NOT NULL,question TEXT NOT NULL,answer TEXT NOT NULL,source_ids_json TEXT NOT NULL,source_revision TEXT NOT NULL,report_hash TEXT NOT NULL,review_hash TEXT NOT NULL,content_hash TEXT NOT NULL,expires_at TEXT NOT NULL,policy_id TEXT NOT NULL,approval_actor TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('active','revoked')),created_at TEXT NOT NULL,revoked_at TEXT,revocation_reason TEXT); CREATE INDEX IF NOT EXISTS idx_lia_curated_status ON lia_curated_knowledge(status,expires_at);`); }
function reportShape(report, at) {
  if (!plain(report) || report.format !== 'vitrinecity-lia-training-rounds-report-v1' || report.state !== 'completed' || report.sourceRevision !== teachingSourceRevision || report.roundCount !== 5 || report.lessonsPerRound !== 100 || report.totalLessons !== 500 || report.targetCount !== report.accepted || report.accepted !== 471 || report.revise !== 29 || report.providerCalls !== 100 || report.coinDebits !== 0 || report.weightTraining !== false || report.externalPublication !== false || !Array.isArray(report.rounds) || report.rounds.length !== 5 || !Array.isArray(report.replacements) || report.replacements.length !== 471) fail('lia_rounds_report_invalid');
  const observed = Date.parse(report.observedAt); if (!Number.isFinite(observed) || observed > at) fail('lia_rounds_report_invalid');
  for (const round of report.rounds) {
    if (!plain(round) || !Number.isInteger(round.round) || round.round < 1 || round.round > 5 || !/^[a-f0-9]{64}$/.test(round.planHash) || round.accepted + round.revise !== 100 || round.providerCalls !== 20 || !Array.isArray(round.providers) || round.providers.length !== 20) fail('lia_rounds_report_invalid');
    for (const receipt of round.providers) if (!plain(receipt) || receipt.state !== 'completed' || receipt.code !== null || typeof receipt.receiptId !== 'string' || !/^(?:deepseek|openai):[A-Za-z0-9][A-Za-z0-9_.:-]{1,159}$/.test(receipt.receiptId) || ![receipt.chargedMicroBrl, receipt.actualMicroBrl, receipt.actualMicroUsd].every((value) => typeof value === 'string' && /^\d+$/.test(value))) fail('lia_rounds_receipt_invalid');
  }
  const seen = new Set();
  for (const item of report.replacements) {
    if (!plain(item) || typeof item.id !== 'string' || seen.has(item.id) || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,119}$/.test(item.id) || !safe(item.domain, 80) || !safe(item.question, 600) || !safe(item.newAnswer, 900) || !Array.isArray(item.sourceIds) || !item.sourceIds.length || item.sourceIds.some((id) => !sourceMap.has(id) || id === 'COINS') || !plain(item.review) || item.review.id !== item.id || item.review.decision !== 'accept' || !safe(item.review.reason, 500)) fail('lia_rounds_item_invalid');
    seen.add(item.id);
  }
  return { observed };
}

/** Publish only accepted lessons from the bounded five-round report. */
export function publishLiaTrainingRounds({ db, report, authorization, now = Date.now, dryRun = false } = {}) {
  if (!plain(authorization) || canonical(authorization) !== canonical({ policyId: LIA_CURATED_POLICY, scope: SCOPE, confirmed: true })) fail('lia_rounds_authorization_required');
  const at = clock(now); if (!db?.prepare || !db?.transaction || typeof dryRun !== 'boolean') fail('lia_rounds_config_invalid');
  const { observed } = reportShape(report, at); const reportHash = sha(canonical(report));
  const items = report.replacements.map((item) => {
    const sourceIds = [...new Set(item.sourceIds)].sort(); const record = { id: `lia-curated-rounds-${item.id}`, lesson_id: item.id, domain: item.domain, question: item.question, answer: item.newAnswer, source_ids_json: JSON.stringify(sourceIds), source_revision: teachingSourceRevision, report_hash: reportHash, review_hash: sha(canonical(item.review)), expires_at: expiry(sourceIds), policy_id: LIA_CURATED_POLICY, approval_actor: LIA_CURATED_ACTOR };
    record.content_hash = seal(record); return record;
  });
  if (dryRun) return { policyId: LIA_CURATED_POLICY, actor: LIA_CURATED_ACTOR, accepted: items.length, published: 0, duplicates: 0, dryRun: true, coinDebits: 0, weightTraining: false };
  table(db); let duplicates = 0;
  for (const record of items) { const prior = db.prepare('SELECT * FROM lia_curated_knowledge WHERE id=?').get(record.id); if (prior) { if (prior.status !== 'active' || prior.content_hash !== record.content_hash || seal(prior) !== prior.content_hash) fail('lia_rounds_conflict'); duplicates += 1; } }
  const publish = () => { let published = 0; for (const record of items) { if (db.prepare('SELECT 1 FROM lia_curated_knowledge WHERE id=?').get(record.id)) continue; db.prepare("INSERT INTO lia_curated_knowledge(id,lesson_id,domain,question,answer,source_ids_json,source_revision,report_hash,review_hash,content_hash,expires_at,policy_id,approval_actor,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?, 'active', ?)").run(record.id, record.lesson_id, record.domain, record.question, record.answer, record.source_ids_json, record.source_revision, record.report_hash, record.review_hash, record.content_hash, record.expires_at, record.policy_id, record.approval_actor, new Date(at).toISOString()); if (exists(db, 'neural_audit')) db.prepare('INSERT INTO neural_audit(id,kind,subject_id,actor,details_json,created_at) VALUES(?,?,?,?,?,?)').run(sha(record.id + record.content_hash + at), 'lia_curated_knowledge_published', record.id, LIA_CURATED_ACTOR, JSON.stringify({ policyId: LIA_CURATED_POLICY, reportHash, observedAt: new Date(observed).toISOString(), coinDebits: 0, weightTraining: false, batch: 'five-rounds' }), new Date(at).toISOString()); published += 1; } return published; };
  const published = db.transaction(publish).immediate(); return { policyId: LIA_CURATED_POLICY, actor: LIA_CURATED_ACTOR, accepted: items.length, published, duplicates, dryRun: false, coinDebits: 0, weightTraining: false };
}
