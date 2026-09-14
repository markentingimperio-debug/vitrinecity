import {createHash, randomUUID} from 'node:crypto';

const MAX_CREDITS = 1_000_000_000;
const MAX_EPOCH = 8_640_000_000_000_000;
const MAX_PERIOD_MS = 366 * 24 * 60 * 60 * 1000;
const SECRET = /-----BEGIN [^-]*PRIVATE KEY-----|\b(?:sk-proj-|ghp_|github_pat_|AKIA)[A-Za-z0-9_-]{10,}|\bBearer\s+[A-Za-z0-9._-]{16,}/i;
const fail = (code, status=400) => {throw Object.assign(new Error(code), {code, status});};
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const truthy = value => ['1','true','yes','on'].includes(String(value || '').toLowerCase());
function integer(value, min=0, max=MAX_CREDITS) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('billing_input_invalid');
  return value;
}
function boundedText(value, max, min=1) {
  if (typeof value !== 'string' || value.length < min || value.length > max || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value) || SECRET.test(value)) fail('billing_input_invalid');
  return value;
}
function identifier(value, max=128) {
  boundedText(value, max);
  if (!/^[A-Za-z0-9_.:-]+$/.test(value)) fail('billing_input_invalid');
  return value;
}
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail('billing_input_invalid');
  return value;
}
function scopeCheck(scope) {
  if (typeof scope !== 'string' || !/^store:[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(scope)) fail('billing_scope_denied', 403);
  return scope;
}
function actorCheck(actorId) {return identifier(actorId, 128);}
function keyCheck(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{12,100}$/.test(key)) fail('billing_input_invalid');
  return key;
}

/** Independent AI credit ledger. No money, payment processor, Ads wallet, or
 * automatic subscription renewal is implemented here. Period grants are manual.
 * Callers must authenticate/authorize the actor and derive scope server-side. */
export function createNeuralBilling({db, env=process.env, now=Date.now}={}) {
  if (!db?.transaction) throw new TypeError('Neural billing requires SQLite.');
  const enabled = truthy(env.VITRINY_NEURAL_BILLING_ENABLED);
  const clock = () => integer(now(), 0, MAX_EPOCH);
  const requireEnabled = () => {if (!enabled) fail('billing_disabled', 503);};
  const atomic = fn => {const transaction=db.transaction(fn); return (...args) => transaction.immediate(...args);};
  db.exec(`
    CREATE TABLE IF NOT EXISTS neural_billing_plans (
      code TEXT PRIMARY KEY, name TEXT NOT NULL, monthly_credits INTEGER NOT NULL,
      task_reserve_credits INTEGER NOT NULL, input_credits_per_1000 INTEGER NOT NULL,
      output_credits_per_1000 INTEGER NOT NULL, request_hash TEXT NOT NULL,
      actor_id TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS neural_billing_periods (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, plan_code TEXT NOT NULL,
      period_start INTEGER NOT NULL, period_end INTEGER NOT NULL,
      granted_credits INTEGER NOT NULL, task_reserve_credits INTEGER NOT NULL,
      input_credits_per_1000 INTEGER NOT NULL, output_credits_per_1000 INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, actor_id TEXT NOT NULL,
      revoked_at INTEGER, revoked_by TEXT, created_at INTEGER NOT NULL,
      UNIQUE(scope,idempotency_key));
    CREATE INDEX IF NOT EXISTS idx_neural_billing_period_scope ON neural_billing_periods(scope,period_start,period_end);
    CREATE TABLE IF NOT EXISTS neural_billing_reservations (
      scope TEXT NOT NULL, task_id TEXT NOT NULL, period_id TEXT NOT NULL,
      reserved_credits INTEGER NOT NULL, charged_credits INTEGER NOT NULL DEFAULT 0,
      input_credits_per_1000 INTEGER NOT NULL, output_credits_per_1000 INTEGER NOT NULL,
      state TEXT NOT NULL DEFAULT 'reserved', created_at INTEGER NOT NULL, settled_at INTEGER,
      PRIMARY KEY(scope,task_id));
    CREATE INDEX IF NOT EXISTS idx_neural_billing_reservations_period ON neural_billing_reservations(period_id,state);
    CREATE TABLE IF NOT EXISTS neural_billing_attempt_events (
      scope TEXT NOT NULL, task_id TEXT NOT NULL, attempt_id TEXT NOT NULL,
      type TEXT NOT NULL, provider TEXT NOT NULL, model_name TEXT NOT NULL,
      input_tokens INTEGER, output_tokens INTEGER, known INTEGER NOT NULL,
      duration_ms INTEGER, request_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(scope,task_id,attempt_id,type));
    CREATE TABLE IF NOT EXISTS neural_billing_ledger (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, period_id TEXT NOT NULL, task_id TEXT,
      type TEXT NOT NULL, delta_granted INTEGER NOT NULL DEFAULT 0,
      delta_used INTEGER NOT NULL DEFAULT 0, delta_reserved INTEGER NOT NULL DEFAULT 0,
      actor_id TEXT, reason TEXT, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_neural_billing_ledger_scope ON neural_billing_ledger(scope,created_at);
    CREATE TABLE IF NOT EXISTS neural_billing_resolutions (
      scope TEXT NOT NULL, idempotency_key TEXT NOT NULL, task_id TEXT NOT NULL,
      charge_credits INTEGER NOT NULL, reason TEXT NOT NULL, actor_id TEXT NOT NULL,
      request_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(scope,idempotency_key));
  `);
  function append({scope, periodId, taskId=null, type, granted=0, used=0, reserved=0, actorId=null, reason=null}) {
    db.prepare('INSERT INTO neural_billing_ledger(id,scope,period_id,task_id,type,delta_granted,delta_used,delta_reserved,actor_id,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(),scope,periodId,taskId,type,granted,used,reserved,actorId,reason,clock());
  }
  function planView(row) {
    return {code:row.code, name:row.name, monthlyCredits:row.monthly_credits,
      taskReserveCredits:row.task_reserve_credits, inputCreditsPer1000:row.input_credits_per_1000,
      outputCreditsPer1000:row.output_credits_per_1000, createdAt:row.created_at};
  }
  const createPlan = atomic((input,actorId) => {
    requireEnabled(); actorCheck(actorId);
    object(input,['code','name','monthlyCredits','taskReserveCredits','inputCreditsPer1000','outputCreditsPer1000']);
    if (typeof input.code !== 'string' || !/^[a-z0-9][a-z0-9_-]{2,63}$/.test(input.code)) fail('billing_input_invalid');
    const payload={code:input.code, name:boundedText(input.name,100), monthlyCredits:integer(input.monthlyCredits,1),
      taskReserveCredits:integer(input.taskReserveCredits,1), inputCreditsPer1000:integer(input.inputCreditsPer1000),
      outputCreditsPer1000:integer(input.outputCreditsPer1000)};
    if (payload.taskReserveCredits > payload.monthlyCredits) fail('billing_input_invalid');
    const requestHash=hash(payload), previous=db.prepare('SELECT * FROM neural_billing_plans WHERE code=?').get(payload.code);
    if (previous) {if (previous.request_hash !== requestHash) fail('billing_plan_conflict',409); return {...planView(previous),duplicate:true};}
    db.prepare('INSERT INTO neural_billing_plans(code,name,monthly_credits,task_reserve_credits,input_credits_per_1000,output_credits_per_1000,request_hash,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(payload.code,payload.name,payload.monthlyCredits,payload.taskReserveCredits,payload.inputCreditsPer1000,payload.outputCreditsPer1000,requestHash,actorId,clock());
    return planView(db.prepare('SELECT * FROM neural_billing_plans WHERE code=?').get(payload.code));
  });
  function plans() {return db.prepare('SELECT * FROM neural_billing_plans ORDER BY code').all().map(planView);}
  function periodView(row) {
    const used=db.prepare("SELECT COALESCE(SUM(charged_credits),0) used, COALESCE(SUM(CASE WHEN state IN ('reserved','review_required') THEN reserved_credits ELSE 0 END),0) reserved FROM neural_billing_reservations WHERE period_id=?").get(row.id);
    const current=clock(), state=row.revoked_at !== null ? 'revoked' : current < row.period_start ? 'scheduled' : current >= row.period_end ? 'expired' : 'active';
    const availableCredits=row.granted_credits-used.used-used.reserved;
    return {enabled, id:row.id, periodId:row.id, scope:row.scope, active:state==='active', state,
      plan:planView(db.prepare('SELECT * FROM neural_billing_plans WHERE code=?').get(row.plan_code)),
      periodStart:row.period_start, periodEnd:row.period_end, grantedCredits:row.granted_credits,
      usedCredits:used.used, reservedCredits:used.reserved, availableCredits,
      spendableCredits:state==='active' && enabled ? availableCredits : 0,
      revokedAt:row.revoked_at, createdAt:row.created_at};
  }
  function periodRow(scope,id) {
    const row=db.prepare('SELECT * FROM neural_billing_periods WHERE scope=? AND id=?').get(scope,id);
    if (!row) fail('billing_period_not_found',404);
    return row;
  }
  function periodStatus(scope) {
    scopeCheck(scope);
    const current=clock();
    const row=db.prepare('SELECT * FROM neural_billing_periods WHERE scope=? AND period_start<=? AND period_end>? ORDER BY period_start DESC LIMIT 1').get(scope,current,current)
      || db.prepare('SELECT * FROM neural_billing_periods WHERE scope=? ORDER BY period_start DESC LIMIT 1').get(scope);
    return row ? periodView(row) : {enabled,scope,active:false,state:'none',id:null,periodId:null,plan:null,periodStart:null,periodEnd:null,grantedCredits:0,usedCredits:0,reservedCredits:0,availableCredits:0,spendableCredits:0};
  }
  function periods(scope) {
    scopeCheck(scope);
    return db.prepare('SELECT * FROM neural_billing_periods WHERE scope=? ORDER BY created_at DESC,id DESC LIMIT 20').all(scope).map(periodView);
  }
  function getPeriod(scope,id){scopeCheck(scope);identifier(id);return periodView(periodRow(scope,id));}
  const grantPeriod = atomic((input,actorId) => {
    requireEnabled(); actorCheck(actorId);
    object(input,['scope','planCode','periodStart','periodEnd','idempotencyKey']);
    const scope=scopeCheck(input.scope), planCode=identifier(input.planCode,64),
      periodStart=integer(input.periodStart,0,MAX_EPOCH),periodEnd=integer(input.periodEnd,0,MAX_EPOCH),
      idempotencyKey=keyCheck(input.idempotencyKey);
    if (periodEnd<=periodStart || periodEnd-periodStart>MAX_PERIOD_MS) fail('billing_input_invalid');
    const requestHash=hash({scope,planCode,periodStart,periodEnd});
    const previous=db.prepare('SELECT * FROM neural_billing_periods WHERE scope=? AND idempotency_key=?').get(scope,idempotencyKey);
    if (previous) {if (previous.request_hash!==requestHash) fail('billing_conflict',409); return {...periodView(previous),duplicate:true};}
    const plan=db.prepare('SELECT * FROM neural_billing_plans WHERE code=?').get(planCode);
    if (!plan) fail('billing_plan_not_found',404);
    // Revoked periods also participate: revoking cannot mint another allowance
    // for the same service window. Adjacent [start,end) windows are permitted.
    if (db.prepare('SELECT 1 FROM neural_billing_periods WHERE scope=? AND period_start<? AND period_end>? LIMIT 1').get(scope,periodEnd,periodStart)) fail('billing_period_overlap',409);
    const id=randomUUID();
    db.prepare('INSERT INTO neural_billing_periods(id,scope,plan_code,period_start,period_end,granted_credits,task_reserve_credits,input_credits_per_1000,output_credits_per_1000,idempotency_key,request_hash,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id,scope,planCode,periodStart,periodEnd,plan.monthly_credits,plan.task_reserve_credits,plan.input_credits_per_1000,plan.output_credits_per_1000,idempotencyKey,requestHash,actorId,clock());
    append({scope,periodId:id,type:'grant',granted:plan.monthly_credits,actorId});
    return periodView(periodRow(scope,id));
  });
  const revokePeriod = atomic((id,actorId) => {
    requireEnabled(); actorCheck(actorId); identifier(id);
    const row=db.prepare('SELECT * FROM neural_billing_periods WHERE id=?').get(id);
    if (!row) fail('billing_period_not_found',404);
    if (row.revoked_at !== null) return {...periodView(row),duplicate:true};
    db.prepare('UPDATE neural_billing_periods SET revoked_at=?,revoked_by=? WHERE id=?').run(clock(),actorId,id);
    append({scope:row.scope,periodId:id,type:'revoke',actorId});
    return periodView(periodRow(row.scope,id));
  });
  function reservation(scope,taskId) {
    scopeCheck(scope);identifier(taskId);
    const row=db.prepare('SELECT * FROM neural_billing_reservations WHERE scope=? AND task_id=?').get(scope,taskId);
    if (!row) fail('billing_reservation_not_found',404);
    return row;
  }
  function measurement(scope,taskId,row) {
    const events=db.prepare('SELECT * FROM neural_billing_attempt_events WHERE scope=? AND task_id=? ORDER BY rowid').all(scope,taskId);
    const started=events.filter(event=>event.type==='started'), terminals=events.filter(event=>event.type!=='started');
    let inputTokens=0,outputTokens=0;
    for (const event of terminals) {if (event.known) {inputTokens+=event.input_tokens;outputTokens+=event.output_tokens;}}
    // Integer math: round once per total token direction, never per call. An
    // extreme measured overrun is represented exactly, not as a rounded float.
    const inputCost=(BigInt(inputTokens)*BigInt(row.input_credits_per_1000)+999n)/1000n;
    const outputCost=(BigInt(outputTokens)*BigInt(row.output_credits_per_1000)+999n)/1000n;
    const exact=inputCost+outputCost, overflow=exact>BigInt(Number.MAX_SAFE_INTEGER);
    const pendingAttempts=started.length-terminals.length, unknownAttempts=terminals.filter(event=>!event.known).length;
    return {inputTokens,outputTokens,attemptCount:started.length,knownAttempts:terminals.length-unknownAttempts,pendingAttempts,unknownAttempts,
      measuredCredits:overflow ? null : Number(exact),measuredCreditsExact:exact.toString(),measurementOverflow:overflow,
      usageComplete:pendingAttempts===0 && unknownAttempts===0,budgetExceeded:exact>BigInt(row.reserved_credits)};
  }
  function report(scope,taskId) {
    scopeCheck(scope);identifier(taskId);
    const row=db.prepare('SELECT * FROM neural_billing_reservations WHERE scope=? AND task_id=?').get(scope,taskId);
    if (!row) return null;
    const usage=measurement(scope,taskId,row);
    const closed=['settled','reconciled'].includes(row.state);
    const state=!closed && (usage.unknownAttempts || usage.budgetExceeded) ? 'review_required' : row.state;
    return {scope,taskId,periodId:row.period_id,state,reservedCredits:row.reserved_credits,
      heldCredits:closed?0:row.reserved_credits,chargedCredits:row.charged_credits,...usage,
      inputCreditsPer1000:row.input_credits_per_1000,outputCreditsPer1000:row.output_credits_per_1000,
      createdAt:row.created_at,settledAt:row.settled_at};
  }
  function assertActive(scope) {
    requireEnabled();scopeCheck(scope);
    const current=clock(),period=db.prepare('SELECT * FROM neural_billing_periods WHERE scope=? AND period_start<=? AND period_end>? AND revoked_at IS NULL LIMIT 1').get(scope,current,current);
    if (!period) fail('billing_subscription_required',402);
    return periodView(period);
  }
  function assertRunnable(scope,taskId) {
    requireEnabled();const row=reservation(scope,taskId),period=periodRow(scope,row.period_id),current=clock();
    if (period.revoked_at!==null || current<period.period_start || current>=period.period_end) fail('billing_subscription_required',402);
    if (['settled','reconciled'].includes(row.state)) fail('billing_reservation_closed',409);
    const usage=report(scope,taskId);
    if (usage.state==='review_required') fail('billing_usage_review_required',409);
    if (BigInt(usage.measuredCreditsExact)>=BigInt(row.reserved_credits)) fail('billing_task_budget_exhausted',402);
    return usage;
  }
  const reserve = atomic((scope,taskId) => {
    requireEnabled();scopeCheck(scope);identifier(taskId);
    if (db.prepare('SELECT 1 FROM neural_billing_reservations WHERE scope=? AND task_id=?').get(scope,taskId)) return {...report(scope,taskId),duplicate:true};
    const current=clock(), active=assertActive(scope), period=periodRow(scope,active.id);
    const balance=periodView(period);
    if (balance.availableCredits<period.task_reserve_credits) fail('billing_credits_exhausted',402);
    db.prepare('INSERT INTO neural_billing_reservations(scope,task_id,period_id,reserved_credits,input_credits_per_1000,output_credits_per_1000,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(scope,taskId,period.id,period.task_reserve_credits,period.input_credits_per_1000,period.output_credits_per_1000,current);
    append({scope,periodId:period.id,taskId,type:'reserve',reserved:period.task_reserve_credits});
    return report(scope,taskId);
  });
  const recordAttempt = atomic((scope,taskId,event) => {
    requireEnabled();const row=reservation(scope,taskId);
    object(event,['attemptId','type','provider','modelName','inputTokens','outputTokens','known','durationMs']);
    const attemptId=identifier(event.attemptId),provider=identifier(event.provider,128),modelName=boundedText(event.modelName??'',160,0);
    if (!['started','completed','failed'].includes(event.type)) fail('billing_input_invalid');
    const type=event.type,known=event.known??false,inputTokens=event.inputTokens??null,outputTokens=event.outputTokens??null,durationMs=event.durationMs??null;
    if (typeof known!=='boolean') fail('billing_input_invalid');
    if (durationMs!==null) integer(durationMs,0,MAX_EPOCH);
    if (known) {integer(inputTokens);integer(outputTokens);} else if (inputTokens!==null || outputTokens!==null) fail('billing_input_invalid');
    if (type==='started' && (known || inputTokens!==null || outputTokens!==null || durationMs!==null)) fail('billing_input_invalid');
    const payload={attemptId,type,provider,modelName,inputTokens,outputTokens,known,durationMs},requestHash=hash(payload);
    const previous=db.prepare('SELECT request_hash FROM neural_billing_attempt_events WHERE scope=? AND task_id=? AND attempt_id=? AND type=?').get(scope,taskId,attemptId,type);
    if (previous) {if (previous.request_hash!==requestHash) fail('billing_attempt_conflict',409); return {...report(scope,taskId),duplicate:true};}
    const start=db.prepare("SELECT * FROM neural_billing_attempt_events WHERE scope=? AND task_id=? AND attempt_id=? AND type='started'").get(scope,taskId,attemptId);
    if (type==='started') {
      assertRunnable(scope,taskId);
      if (db.prepare("SELECT COUNT(*) n FROM neural_billing_attempt_events WHERE scope=? AND task_id=? AND type='started'").get(scope,taskId).n>=256) fail('billing_attempt_limit',429);
    } else {
      if (!start || start.provider!==provider || start.model_name!==modelName) fail('billing_attempt_conflict',409);
      if (db.prepare("SELECT 1 FROM neural_billing_attempt_events WHERE scope=? AND task_id=? AND attempt_id=? AND type<>'started'").get(scope,taskId,attemptId)) fail('billing_attempt_conflict',409);
      // A late terminal after explicit reconciliation remains an audit event;
      // it cannot debit the merchant again or start another paid attempt.
    }
    db.prepare('INSERT INTO neural_billing_attempt_events(scope,task_id,attempt_id,type,provider,model_name,input_tokens,output_tokens,known,duration_ms,request_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(scope,taskId,attemptId,type,provider,modelName,inputTokens,outputTokens,known?1:0,durationMs,requestHash,clock());
    return report(scope,taskId);
  });
  const settle = atomic((scope,taskId) => {
    requireEnabled();const row=reservation(scope,taskId);
    if (['settled','reconciled'].includes(row.state)) return {...report(scope,taskId),duplicate:true};
    const usage=measurement(scope,taskId,row);
    if (!usage.usageComplete || usage.budgetExceeded) {
      db.prepare("UPDATE neural_billing_reservations SET state='review_required' WHERE scope=? AND task_id=?").run(scope,taskId);
      if (row.state!=='review_required') append({scope,periodId:row.period_id,taskId,type:'review_required',reason:usage.budgetExceeded?'reserved_budget_exceeded':'usage_incomplete'});
      return report(scope,taskId);
    }
    db.prepare("UPDATE neural_billing_reservations SET state='settled',charged_credits=?,settled_at=? WHERE scope=? AND task_id=?").run(usage.measuredCredits,clock(),scope,taskId);
    append({scope,periodId:row.period_id,taskId,type:'settle',used:usage.measuredCredits,reserved:-row.reserved_credits});
    return report(scope,taskId);
  });
  const resolve = atomic((scope,taskId,input,actorId) => {
    requireEnabled();actorCheck(actorId);const row=reservation(scope,taskId);
    object(input,['chargeCredits','reason','idempotencyKey']);
    const chargeCredits=integer(input.chargeCredits,0,row.reserved_credits),reason=boundedText(input.reason,500,5),idempotencyKey=keyCheck(input.idempotencyKey);
    const requestHash=hash({taskId,chargeCredits,reason}),previous=db.prepare('SELECT * FROM neural_billing_resolutions WHERE scope=? AND idempotency_key=?').get(scope,idempotencyKey);
    if (previous) {if (previous.request_hash!==requestHash) fail('billing_conflict',409); return {...report(scope,taskId),duplicate:true};}
    if (row.state!=='review_required') fail('billing_review_required',409);
    db.prepare('INSERT INTO neural_billing_resolutions(scope,idempotency_key,task_id,charge_credits,reason,actor_id,request_hash,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(scope,idempotencyKey,taskId,chargeCredits,reason,actorId,requestHash,clock());
    db.prepare("UPDATE neural_billing_reservations SET state='reconciled',charged_credits=?,settled_at=? WHERE scope=? AND task_id=?").run(chargeCredits,clock(),scope,taskId);
    append({scope,periodId:row.period_id,taskId,type:'reconcile',used:chargeCredits,reserved:-row.reserved_credits,actorId,reason});
    return report(scope,taskId);
  });
  function ledger(scope) {
    scopeCheck(scope);
    return db.prepare("SELECT id,period_id periodId,task_id taskId,type, CASE WHEN type='grant' THEN delta_granted WHEN type='reserve' THEN delta_reserved ELSE delta_used END amountCredits,delta_granted deltaGranted,delta_used deltaUsed,delta_reserved deltaReserved,actor_id actorId,reason,created_at createdAt FROM neural_billing_ledger WHERE scope=? ORDER BY rowid DESC LIMIT 50").all(scope);
  }
  return {enabled,createPlan,plans,grantPeriod,periodStatus,periods,getPeriod,revokePeriod,reserve,assertActive,assertRunnable,recordAttempt,report,settle,resolve,ledger};
}
