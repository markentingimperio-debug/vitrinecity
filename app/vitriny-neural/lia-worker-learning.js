import {createHash} from 'node:crypto';

const sha=value=>createHash('sha256').update(value).digest('hex');
const ID='lia-shadow-faq-20260922-v1';
const LESSON='Ao criar uma página, altere o arquivo no workspace privado, execute o teste local e só diga que concluiu quando houver arquivo modificado e teste aprovado. Se não conseguir editar ou testar, descreva a falha.';
const validityMs=30*24*60*60*1000;
const safeHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const safeText=value=>typeof value==='string'&&value.length>0&&value.length<=500&&!/[\u0000-\u001f\u007f]/.test(value)&&
  !/\b(?:password|senha|secret|token|api[_ -]?key)\b\s*[:=]/i.test(value);

export function createLiaWorkerLearning({db,now=Date.now}={}){
  if(!db?.prepare||!db?.exec||!db?.transaction)throw new TypeError('Lia worker learning requires SQLite.');
  db.exec(`CREATE TABLE IF NOT EXISTS lia_worker_learning(
    id TEXT PRIMARY KEY,scope TEXT NOT NULL,lesson TEXT NOT NULL,evidence_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('active','revoked')),
    expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,revoked_at INTEGER);
    CREATE INDEX IF NOT EXISTS idx_lia_worker_learning_active ON lia_worker_learning(scope,status,expires_at);`);
  const seal=(id,scope,lesson,evidence,expiresAt)=>sha(JSON.stringify({id,scope,lesson,evidence,expiresAt}));
  function retrieve(){
    const at=now();
    return db.prepare("SELECT * FROM lia_worker_learning WHERE scope='code' AND status='active' AND expires_at>? ORDER BY created_at DESC LIMIT 3").all(at)
      .filter(row=>{
        try{return safeText(row.lesson)&&safeHash(row.content_hash)&&seal(row.id,row.scope,row.lesson,JSON.parse(row.evidence_json),row.expires_at)===row.content_hash;}
        catch{return false;}
      }).map(row=>row.lesson);
  }
  function publishFaqProof({ledgerDb}={}){
    if(!ledgerDb?.prepare)throw new TypeError('Private administrative ledger required.');
    const row=ledgerDb.prepare('SELECT * FROM admin_teaching_pilot_runs WHERE id=?').get(ID);
    if(!row||row.state!=='completed'||row.code!=='shadow_eval_passed'||row.provider!=='openai'||row.model!=='gpt-5.6-luna'||
      row.receipt_id?.startsWith('lia-gateway-task:')!==true||!Number.isSafeInteger(row.actual_micro)||row.actual_micro!==row.charged_micro||row.charged_micro>row.maximum_micro)
      throw new Error('Lia worker proof unconfirmed.');
    let result;
    try{result=JSON.parse(row.result_json);}catch{throw new Error('Lia worker proof invalid.');}
    const task=result?.task,evaluation=result?.evaluation;
    if(result?.taskId!==task?.id||row.receipt_id!=='lia-gateway-task:'+task.id||task.status!=='completed'||
      task.workspace!=='lia-shadow-faq-20260922'||task.result?.model!=='gpt-5.6-luna'||
      JSON.stringify(task.result?.git?.after?.changedFiles)!=='["index.html"]'||evaluation?.passed!==true||
      evaluation.reason!=='independent_test_passed'||evaluation.learningApproved!==false||!safeHash(evaluation.fileSha256)||
      evaluation.fileSha256!=='18871c17f48e5765a1111a11d19100b975dc52c028f598831d00bcde4b3807d5'||
      evaluation.test!=='node --test: 1 passed, 0 failed; git diff --check: passed')
      throw new Error('Lia worker proof invalid.');
    const evidence={runId:ID,taskId:task.id,receiptId:row.receipt_id,fileSha256:evaluation.fileSha256,
      baselineCommit:evaluation.baselineCommit,test:evaluation.test,reviewedAt:evaluation.reviewedAt};
    if(typeof evidence.baselineCommit!=='string'||!/^[a-f0-9]{40}$/.test(evidence.baselineCommit)||
      !Number.isFinite(Date.parse(evidence.reviewedAt))||Date.parse(evidence.reviewedAt)>now())
      throw new Error('Lia worker proof invalid.');
    const at=now(),expiresAt=at+validityMs,hash=seal(ID,'code',LESSON,evidence,expiresAt);
    return db.transaction(()=>{
      const prior=db.prepare('SELECT * FROM lia_worker_learning WHERE id=?').get(ID);
      if(prior){
        if(prior.status==='active'&&prior.lesson===LESSON&&prior.evidence_json===JSON.stringify(evidence)&&
          prior.content_hash===seal(ID,'code',LESSON,evidence,prior.expires_at))return {published:false,alreadyPresent:true,id:ID};
        throw new Error('Lia worker lesson conflict.');
      }
      db.prepare("INSERT INTO lia_worker_learning(id,scope,lesson,evidence_json,content_hash,status,expires_at,created_at) VALUES(?,?,?,?,?,'active',?,?)")
        .run(ID,'code',LESSON,JSON.stringify(evidence),hash,expiresAt,at);
      return {published:true,alreadyPresent:false,id:ID,expiresAt:new Date(expiresAt).toISOString()};
    }).immediate();
  }
  function revoke(id=ID){
    return db.prepare("UPDATE lia_worker_learning SET status='revoked',revoked_at=? WHERE id=? AND status='active'").run(now(),id).changes;
  }
  return Object.freeze({retrieve,publishFaqProof,revoke});
}
