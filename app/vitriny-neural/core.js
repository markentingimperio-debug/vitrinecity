import { randomUUID } from 'node:crypto';

const NAME = 'Vitriny Neural';
const VERSION = 1;
const EVENT_TYPE = /^[a-z][a-z0-9._:-]{1,79}$/;
const SOURCE = /^[a-z][a-z0-9._:-]{1,63}$/;
const DOMAINS = new Set(['growth','ranking','search','content','ads','commerce','operations','code','vision','support','platform']);
const SECRET_PATTERN = /-----BEGIN .*PRIVATE KEY-----|\b(?:sk-proj-|ghp_|github_pat_|AKIA)[A-Za-z0-9_\-]{10,}/;

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function cleanText(value, max, min = 0) {
  const text = String(value ?? '').trim();
  if (text.length < min || text.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) {
    fail('Texto inválido ou acima do limite.');
  }
  if (SECRET_PATTERN.test(text)) fail('Credenciais não podem entrar no Vitriny Neural.');
  return text;
}

function jsonPayload(value, maxBytes) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) fail('O payload do evento deve ser um objeto JSON.');
  let json;
  try { json = JSON.stringify(value); } catch { fail('O payload não pode ser serializado.'); }
  if (Buffer.byteLength(json, 'utf8') > maxBytes) fail('O payload do evento excede o limite.');
  if (SECRET_PATTERN.test(json)) fail('Credenciais não podem entrar no Vitriny Neural.');
  return JSON.parse(json);
}

function confidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) fail('Confiança deve estar entre 0 e 1.');
  return number;
}

function reward(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < -1 || number > 1) fail('Recompensa deve estar entre -1 e 1.');
  return number;
}

export function createVitrinyNeural({ store, now = Date.now, nodeId = 'local', maxEventBytes = 32 * 1024 } = {}) {
  if (!store || typeof store.init !== 'function') throw new TypeError('Vitriny Neural requer um storage adapter.');
  store.init({ version: VERSION, nodeId });
  const stamp = () => new Date(now()).toISOString();

  function ingest(input = {}) {
    const type = cleanText(input.type, 80, 2);
    const source = cleanText(input.source, 64, 2);
    if (!EVENT_TYPE.test(type) || !SOURCE.test(source)) fail('Tipo ou origem de evento inválidos.');
    const payload = jsonPayload(input.payload, maxEventBytes);
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date(now());
    if (!Number.isFinite(occurredAt.getTime())) fail('Data do evento inválida.');
    const entityType = input.entityType ? cleanText(input.entityType, 64) : '';
    const entityId = input.entityId ? cleanText(input.entityId, 160) : '';
    const dedupeKey = input.dedupeKey ? cleanText(input.dedupeKey, 180) : '';
    const priority = Math.max(0, Math.min(9, Number(input.priority) || 0));
    return store.enqueueEvent({
      id: input.id ? cleanText(input.id, 120, 8) : randomUUID(),
      type, source, entityType, entityId, payload, dedupeKey, priority,
      occurredAt: occurredAt.toISOString(), receivedAt: stamp(), nodeId
    });
  }

  async function workBatch(handler, { workerId = `${nodeId}:worker`, limit = 25, leaseMs = 60_000 } = {}) {
    if (typeof handler !== 'function') throw new TypeError('handler precisa ser função.');
    const safeWorker = cleanText(workerId, 120, 3);
    const batch = store.claimEvents({ workerId: safeWorker, limit: Math.max(1, Math.min(200, Number(limit) || 25)), leaseMs, now: now() });
    const results = [];
    for (const event of batch) {
      try {
        const output = await handler(event);
        store.ackEvent({ id: event.id, workerId: safeWorker, outcome: output ?? null, at: stamp() });
        results.push({ id: event.id, ok: true });
      } catch (error) {
        store.failEvent({ id: event.id, workerId: safeWorker, error: String(error?.message || 'worker_failed').slice(0, 500), at: stamp() });
        results.push({ id: event.id, ok: false });
      }
    }
    return results;
  }

  function signal(input = {}) {
    const metric = cleanText(input.metric, 100, 2);
    const dimension = cleanText(input.dimension || 'global', 180, 1);
    const value = Number(input.value);
    if (!Number.isFinite(value)) fail('Valor de sinal inválido.');
    return store.recordSignal({
      metric, dimension, value,
      confidence: confidence(input.confidence ?? 1),
      windowStart: input.windowStart ? new Date(input.windowStart).toISOString() : stamp(),
      windowEnd: input.windowEnd ? new Date(input.windowEnd).toISOString() : stamp(),
      metadata: jsonPayload(input.metadata, maxEventBytes),
      createdAt: stamp(), nodeId
    });
  }

  function lesson(input = {}) {
    const domain = cleanText(input.domain, 40, 2);
    if (!DOMAINS.has(domain)) fail('Domínio de aprendizagem inválido.');
    const verified = input.verified === true;
    const lowRisk = input.lowRisk === true;
    const lesson = {
      id: input.id ? cleanText(input.id, 120, 8) : randomUUID(),
      domain,
      hypothesis: cleanText(input.hypothesis, 1200, 12),
      evidence: jsonPayload(input.evidence, 64 * 1024),
      reward: reward(input.reward ?? 0),
      confidence: confidence(input.confidence ?? 0),
      sourceEventCount: Math.max(0, Math.min(1_000_000_000, Number(input.sourceEventCount) || 0)),
      risk: lowRisk ? 'low' : 'review',
      status: verified && lowRisk && confidence(input.confidence ?? 0) >= 0.95 ? 'approved' : 'candidate',
      createdAt: stamp(), updatedAt: stamp(), nodeId
    };
    return store.addLesson(lesson);
  }

  function approveLesson(id, { actor = 'admin', confirmed = false } = {}) {
    if (!confirmed) fail('Aprovação explícita é obrigatória.', 409);
    return store.transitionLesson({ id: cleanText(id, 120, 8), status: 'approved', actor: cleanText(actor, 120, 2), at: stamp() });
  }

  function rejectLesson(id, { actor = 'admin', reason = '' } = {}) {
    return store.transitionLesson({ id: cleanText(id, 120, 8), status: 'rejected', actor: cleanText(actor, 120, 2), reason: cleanText(reason || 'rejeitado', 500, 2), at: stamp() });
  }

  function status() {
    return {
      name: NAME,
      version: VERSION,
      nodeId,
      policy: {
        eventDriven: true,
        storageAdapter: true,
        automaticLowRiskLearning: true,
        destructiveActions: false,
        paymentActions: false,
        secretsInMemory: false,
        humanApprovalForHighRisk: true
      },
      store: store.status({ now: now() })
    };
  }

  return { ingest, workBatch, signal, lesson, approveLesson, rejectLesson, status };
}

export const vitrinyNeuralContract = Object.freeze({
  name: NAME,
  version: VERSION,
  domains: [...DOMAINS],
  requiredStoreMethods: ['init','enqueueEvent','claimEvents','ackEvent','failEvent','recordSignal','addLesson','transitionLesson','status']
});
