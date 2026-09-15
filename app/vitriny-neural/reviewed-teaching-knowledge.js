import {createHash,randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {createNeuralDatasetBuilder} from './dataset-builder.js';
import {teachingSources,teachingSourceRevision} from './admin-teaching-sources.js';
import {planTeaching,reviewerMessages,validateTeacherResponse,validateReviewerResponse} from '../scripts/run-admin-teaching-pilot.mjs';
import {hashDeepSeekPaidChatRequest} from './providers/deepseek-paid-chat.js';
import {hashOpenAiPaidChatRequest} from './providers/openai-paid-chat.js';

export const REVIEWED_TEACHING_POLICY='admin-authorized-gpt-review-v1';
export const REVIEWED_TEACHING_ACTOR='system:gpt-reviewed-teaching';
const SCOPE='lia-reviewed-knowledge-only',FORMAT='vitrinecity-admin-teaching-report-v1';
const DOMAINS=new Set(['platform','commerce','operations','growth','search']);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const same=(a,b)=>canonical(a)===canonical(b);
const isHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const isPlain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const exists=(db,name)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
function clock(now){const at=now();if(!Number.isSafeInteger(at)||at<=0||at>8640000000000000)fail('reviewed_knowledge_clock_invalid');return at;}
function parsed(raw,max=262144){if(typeof raw!=='string'||Buffer.byteLength(raw)>max)fail('reviewed_knowledge_evidence_invalid');try{return JSON.parse(raw);}catch{fail('reviewed_knowledge_evidence_invalid');}}
function authorize(value){
  if(!isPlain(value)||!same(value,{policyId:REVIEWED_TEACHING_POLICY,scope:SCOPE,confirmed:true}))fail('reviewed_knowledge_authorization_required');
}
function planFor(domain,at){return planTeaching({domain,sources:teachingSources,sourceRevision:teachingSourceRevision,now:()=>at});}
function expiresFor(plan){return new Date(Math.min(...plan.sources.map(s=>Date.parse(s.expiresAt.length===10?s.expiresAt+'T23:59:59.999Z':s.expiresAt)))).toISOString();}
function sourceHashes(plan){return plan.sources.map(source=>({id:source.id,hash:sha(canonical(source))}));}
function expectedCandidate(plan,lesson){
  const question=plan.lessons.find(q=>q.id===lesson.id);
  return{id:'teach-'+lesson.id+'-'+plan.planHash.slice(0,24),domain:plan.domain,instruction:question.question,
    input:lesson.sourceIds.map(id=>'['+id+'] '+plan.sources.find(s=>s.id===id).body).join('\n\n'),expectedOutput:lesson.answer,
    source:'lesson',sourceId:(plan.domain==='platform'?'deepseek-awaiting-review:':'deepseek-openai-candidate:')+lesson.id+':'+plan.planHash};
}
function candidateHash(c){return sha(JSON.stringify({domain:c.domain,instruction:c.instruction,input:c.input,expectedOutput:c.expectedOutput,source:c.source,sourceId:c.sourceId}));}
function candidateMatches(row,c){return row&&row.id===c.id&&row.domain===c.domain&&row.instruction===c.instruction&&row.input_text===c.input&&row.expected_output===c.expectedOutput&&row.source===c.source&&row.source_id===c.sourceId&&row.content_hash===candidateHash(c);}
function requestFor(provider,messages){return{model:provider==='deepseek'?'deepseek-flash':'gpt-5.6-luna',messages,maxOutputTokens:8192,...(provider==='openai'?{reasoningEffort:'none',requestProfile:'plain-text-v1'}:{})};}
function requestHash(provider,messages){return(provider==='deepseek'?hashDeepSeekPaidChatRequest:hashOpenAiPaidChatRequest)(requestFor(provider,messages));}

// Only this operator reads the private ledger. It never constructs the paid
// pilot, changes its budget, retries a request or invokes a provider.
function operation(ledgerDb,summary,{id,provider,role,messages,at}){
  const row=ledgerDb.prepare('SELECT * FROM admin_teaching_pilot_runs WHERE id=?').get(id);
  if(!row||row.id!==summary?.id||row.state!=='completed'||summary.state!=='completed'||row.provider!==provider||row.role!==role||row.model!==requestFor(provider,messages).model||row.code!==null||summary.code!==null)fail('reviewed_knowledge_receipt_invalid');
  if(!Number.isSafeInteger(row.created_at)||!Number.isSafeInteger(row.finished_at)||row.created_at>row.finished_at||row.finished_at>at)fail('reviewed_knowledge_receipt_invalid');
  const input=parsed(row.input_json,65536),result=parsed(row.result_json);
  const expectedInput={messages,maxOutputTokens:8192,inputBound:Buffer.byteLength(JSON.stringify(messages),'utf8')+2048,...(provider==='openai'?{requestProfile:'plain-text-v1'}:{})};
  const requested=requestHash(provider,messages);
  if(!same(input,expectedInput)||row.request_hash!==requested||row.operation_hash!==sha(JSON.stringify({role,providerId:provider,requestHash:requested})))fail('reviewed_knowledge_request_mismatch');
  if(result.ok!==true||result.status!=='completed'||result.transportStarted!==true||result.billingDisposition!=='reconcile'||result.usage?.known!==true||result.code!==null||result.finishReason!=='stop'||result.provider!==provider||result.requestedModel!==row.model||typeof result.text!=='string'||result.text.length>16000)fail('reviewed_knowledge_receipt_invalid');
  const usage=result.usage;
  if(!isPlain(usage)||!['inputTokens','cachedInputTokens','outputTokens','totalTokens'].every(key=>Number.isSafeInteger(usage[key])&&usage[key]>=0)||usage.cachedInputTokens>usage.inputTokens||BigInt(usage.inputTokens)+BigInt(usage.outputTokens)!==BigInt(usage.totalTokens)||usage.inputTokens>expectedInput.inputBound||usage.outputTokens>expectedInput.maxOutputTokens)fail('reviewed_knowledge_receipt_invalid');
  if(![row.model,...(provider==='deepseek'?['deepseek-v4-flash']:[])].includes(result.model))fail('reviewed_knowledge_receipt_invalid');
  if(typeof row.receipt_id!=='string'||!new RegExp('^'+provider+':[A-Za-z0-9][A-Za-z0-9_.:-]{1,159}$').test(row.receipt_id)||summary.receiptId!==row.receipt_id||result.receiptId!==row.receipt_id||result.providerReceiptId!==row.receipt_id.slice(provider.length+1))fail('reviewed_knowledge_receipt_invalid');
  if(ledgerDb.prepare('SELECT COUNT(*) count FROM admin_teaching_pilot_runs WHERE receipt_id=?').get(row.receipt_id).count!==1)fail('reviewed_knowledge_receipt_reused');
  // Bind report totals to the receipt without recalculating or modifying money.
  for(const [key,column] of [['maximumMicroBrl','maximum_micro'],['chargedMicroBrl','charged_micro'],['actualMicroBrl','actual_micro'],['actualMicroUsd','actual_usd_micro']])if(!Number.isSafeInteger(row[column])||row[column]<0||summary[key]!==String(row[column]))fail('reviewed_knowledge_receipt_invalid');
  if(row.actual_micro!==row.charged_micro||row.charged_micro>row.maximum_micro)fail('reviewed_knowledge_receipt_invalid');
  return {id,provider,model:row.model,requestHash:requested,inputHash:sha(row.input_json),resultHash:sha(row.result_json),receiptId:row.receipt_id,text:result.text,textHash:sha(result.text)};
}

function validatedReport(report,ledgerDb,ledgerFingerprint,at){
  if(!isPlain(report)||Buffer.byteLength(canonical(report))>256000||report.format!==FORMAT||!DOMAINS.has(report.domain)||report.sourceRevision!==teachingSourceRevision||report.ledgerFingerprint!==ledgerFingerprint||report.reviewProfile!=='plain-text-v1'||report.state!=='completed'||report.approval!=='candidate'||report.validationError!==null||report.applied!==false||report.datasetIngested!==false||report.weightTraining!==false)fail('reviewed_knowledge_report_invalid');
  const observed=Date.parse(report.observedAt);if(!Number.isFinite(observed)||observed>at)fail('reviewed_knowledge_report_invalid');
  const plan=planFor(report.domain,at);if(report.planHash!==plan.planHash)fail('reviewed_knowledge_plan_mismatch');
  const teacher=operation(ledgerDb,report.teacher,{id:plan.teacherId,provider:'deepseek',role:'teacher',messages:plan.teacherMessages,at:observed});
  const answers=validateTeacherResponse(teacher.text,plan);
  if(!same(answers,validateTeacherResponse(JSON.stringify({lessons:report.lessons}),plan)))fail('reviewed_knowledge_result_mismatch');
  const reviewer=operation(ledgerDb,report.reviewer,{id:plan.reviewerId+'-plain-text-v1',provider:'openai',role:'reviewer',messages:reviewerMessages(plan,answers),at:observed});
  const reviews=validateReviewerResponse(reviewer.text,plan);
  if(!same(reviews,validateReviewerResponse(JSON.stringify({reviews:report.reviews}),plan)))fail('reviewed_knowledge_result_mismatch');
  return{plan,answers,reviews,teacher,reviewer,ledgerFingerprint};
}
function provenanceFor(batch,lesson){
  return {version:1,policyId:REVIEWED_TEACHING_POLICY,actor:REVIEWED_TEACHING_ACTOR,scope:SCOPE,
    domain:batch.plan.domain,lessonId:lesson.id,sourceRevision:batch.plan.sourceRevision,planHash:batch.plan.planHash,
    sources:sourceHashes(batch.plan),ledgerFingerprint:batch.ledgerFingerprint,teacher:batch.teacher,reviewer:batch.reviewer};
}
function seal(row){return sha(canonical({id:row.id,exampleId:row.example_id,domain:row.domain,lessonId:row.lesson_id,question:row.question,answer:row.answer,exampleHash:row.example_hash,provenance:parsed(row.provenance_json),expiresAt:row.expires_at,policyId:row.policy_id,actor:row.approval_actor}));}
function verifyStored(row,at){
  if(!row||row.policy_id!==REVIEWED_TEACHING_POLICY||row.approval_actor!==REVIEWED_TEACHING_ACTOR||!isHash(row.content_hash)||seal(row)!==row.content_hash)fail('reviewed_knowledge_integrity_invalid');
  const proof=parsed(row.provenance_json,50000),plan=planFor(row.domain,at);
  if(!same(Object.keys(proof).sort(),['version','policyId','actor','scope','domain','lessonId','sourceRevision','planHash','sources','ledgerFingerprint','teacher','reviewer'].sort())||proof.version!==1||proof.policyId!==REVIEWED_TEACHING_POLICY||proof.actor!==REVIEWED_TEACHING_ACTOR||proof.scope!==SCOPE||proof.domain!==row.domain||proof.lessonId!==row.lesson_id||proof.sourceRevision!==plan.sourceRevision||proof.planHash!==plan.planHash||!same(proof.sources,sourceHashes(plan))||!isHash(proof.ledgerFingerprint))fail('reviewed_knowledge_integrity_invalid');
  const expiry=Date.parse(row.expires_at);if(!Number.isFinite(expiry)||expiry<=at||expiry>Date.parse(expiresFor(plan)))fail('reviewed_knowledge_expired');
  for(const [kind,provider,id] of [['teacher','deepseek',plan.teacherId],['reviewer','openai',plan.reviewerId+'-plain-text-v1']]){
    const receipt=proof[kind];
    if(!isPlain(receipt)||receipt.id!==id||receipt.provider!==provider||receipt.model!==requestFor(provider,[]).model||typeof receipt.text!=='string'||receipt.text.length>16000||sha(receipt.text)!==receipt.textHash||!['requestHash','inputHash','resultHash','textHash'].every(k=>isHash(receipt[k]))||typeof receipt.receiptId!=='string'||!receipt.receiptId.startsWith(provider+':'))fail('reviewed_knowledge_integrity_invalid');
  }
  const answers=validateTeacherResponse(proof.teacher.text,plan),reviews=validateReviewerResponse(proof.reviewer.text,plan);
  if(proof.teacher.requestHash!==requestHash('deepseek',plan.teacherMessages)||proof.reviewer.requestHash!==requestHash('openai',reviewerMessages(plan,answers)))fail('reviewed_knowledge_integrity_invalid');
  const lesson=answers.lessons.find(l=>l.id===row.lesson_id),review=reviews.reviews.find(r=>r.id===row.lesson_id);
  if(!lesson||review?.decision!=='accept')fail('reviewed_knowledge_not_accepted');
  const candidate=expectedCandidate(plan,lesson);
  if(row.id!=='lia-reviewed-'+candidate.id||row.example_id!==candidate.id||row.question!==candidate.instruction||row.answer!==candidate.expectedOutput||row.example_hash!==candidateHash(candidate))fail('reviewed_knowledge_integrity_invalid');
  return{candidate,plan,review};
}
function table(db){db.exec(`CREATE TABLE IF NOT EXISTS lia_reviewed_knowledge(
  id TEXT PRIMARY KEY,example_id TEXT NOT NULL UNIQUE,domain TEXT NOT NULL,lesson_id TEXT NOT NULL,question TEXT NOT NULL,answer TEXT NOT NULL,
  example_hash TEXT NOT NULL,provenance_json TEXT NOT NULL,content_hash TEXT NOT NULL,expires_at TEXT NOT NULL,
  policy_id TEXT NOT NULL,approval_actor TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('active','revoked')),
  created_at TEXT NOT NULL,revoked_at TEXT,revocation_reason TEXT);
  CREATE INDEX IF NOT EXISTS idx_lia_reviewed_status ON lia_reviewed_knowledge(status,expires_at);`);}
function audit(db,kind,id,details,at){db.prepare('INSERT INTO neural_audit(id,kind,subject_id,actor,details_json,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),kind,id,REVIEWED_TEACHING_ACTOR,JSON.stringify(details),new Date(at).toISOString());}
function checkedCandidate(db,c){const row=db.prepare('SELECT * FROM neural_training_examples WHERE id=?').get(c.id);if(!candidateMatches(row,c))fail('reviewed_knowledge_candidate_conflict');return row;}

/** Explicit, narrow administrative policy; NOT the general dataset review API.
 * All receipts are read from an independently opened read-only ledger. Candidate
 * validation uses the existing privacy gate in a private, ephemeral scratch DB.
 * dryRun validates but writes nothing to either supplied DB. */
export function publishReviewedTeachingKnowledge({db,ledgerDb,ledgerFingerprint,reports,authorization,now=Date.now,dryRun=false}={}){
  authorize(authorization);const at=clock(now);
  if(!db?.prepare||!db?.transaction||!db?.exec||!ledgerDb?.prepare||ledgerDb===db||ledgerDb.readonly!==true||!isHash(ledgerFingerprint)||typeof dryRun!=='boolean')fail('reviewed_knowledge_config_invalid');
  if(!exists(db,'neural_training_examples')||!exists(db,'neural_audit'))fail('reviewed_knowledge_dataset_missing');
  if(!Array.isArray(reports)||!reports.length||reports.length>5||new Set(reports.map(r=>r?.domain)).size!==reports.length)fail('reviewed_knowledge_report_invalid');
  const batches=reports.map(report=>validatedReport(report,ledgerDb,ledgerFingerprint,at)),items=[];
  const scratch=new Database(':memory:');
  try{
    const validator=createNeuralDatasetBuilder({db:scratch,now:()=>at,nodeId:'reviewed-teaching-validation'});
    for(const batch of batches)for(const lesson of batch.answers.lessons){
      if(batch.reviews.reviews.find(r=>r.id===lesson.id).decision!=='accept')continue;
      const candidate=expectedCandidate(batch.plan,lesson),validated=validator.createCandidate({...candidate,actor:REVIEWED_TEACHING_ACTOR});
      if(validated.contentHash!==candidateHash(candidate))fail('reviewed_knowledge_candidate_invalid');
      const record={id:'lia-reviewed-'+candidate.id,example_id:candidate.id,domain:candidate.domain,lesson_id:lesson.id,question:candidate.instruction,answer:candidate.expectedOutput,example_hash:validated.contentHash,provenance_json:canonical(provenanceFor(batch,lesson)),expires_at:expiresFor(batch.plan),policy_id:REVIEWED_TEACHING_POLICY,approval_actor:REVIEWED_TEACHING_ACTOR};
      record.content_hash=seal(record);items.push({candidate,record});
    }
  }finally{scratch.close();}
  const check=({candidate,record})=>{
    const example=checkedCandidate(db,candidate),prior=exists(db,'lia_reviewed_knowledge')?db.prepare('SELECT * FROM lia_reviewed_knowledge WHERE example_id=?').get(candidate.id):null;
    if(prior){verifyStored(prior,at);if(prior.status!=='active'||prior.content_hash!==record.content_hash||example.status!=='approved'||example.review_actor!==REVIEWED_TEACHING_ACTOR||example.review_reason!==REVIEWED_TEACHING_POLICY)fail('reviewed_knowledge_candidate_conflict');return true;}
    if(example.status!=='candidate')fail('reviewed_knowledge_candidate_conflict');return false;
  };
  const duplicates=items.filter(check).length,summary={policyId:REVIEWED_TEACHING_POLICY,actor:REVIEWED_TEACHING_ACTOR,accepted:items.length,retainedForRevision:batches.length*10-items.length,published:items.length-duplicates,duplicates,dryRun,providerCalls:0,coinDebits:0,weightTraining:false};
  if(dryRun)return summary;
  return db.transaction(()=>{
    table(db);let published=0;
    for(const item of items){
      if(check(item))continue;const {candidate:c,record:r}=item;
      const updated=db.prepare("UPDATE neural_training_examples SET status='approved',review_actor=?,review_reason=?,updated_at=? WHERE id=? AND status='candidate' AND content_hash=?").run(REVIEWED_TEACHING_ACTOR,REVIEWED_TEACHING_POLICY,new Date(at).toISOString(),c.id,r.example_hash);
      if(updated.changes!==1)fail('reviewed_knowledge_candidate_conflict');
      db.prepare("INSERT INTO lia_reviewed_knowledge(id,example_id,domain,lesson_id,question,answer,example_hash,provenance_json,content_hash,expires_at,policy_id,approval_actor,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'active',?)")
        .run(r.id,r.example_id,r.domain,r.lesson_id,r.question,r.answer,r.example_hash,r.provenance_json,r.content_hash,r.expires_at,r.policy_id,r.approval_actor,new Date(at).toISOString());
      audit(db,'lia_reviewed_knowledge_published',r.id,{policyId:REVIEWED_TEACHING_POLICY,exampleId:c.id,contentHash:r.content_hash,humanReview:false,automatedReviewer:'openai'},at);published++;
    }
    return{...summary,published,duplicates:items.length-published};
  }).immediate();
}

/** Logical rollback only. Never delete evidence or overwrite a later review. */
export function revokeReviewedTeachingKnowledge({db,ids,authorization,reason,now=Date.now}={}){
  authorize(authorization);const at=clock(now);
  if(!db?.transaction||!Array.isArray(ids)||!ids.length||ids.length>50||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^lia-reviewed-teach-[a-z]+-\d{2}-[a-f0-9]{24}$/.test(id))||typeof reason!=='string'||!['admin-revoked','source-invalidated','review-corrected','rollback'].includes(reason))fail('reviewed_knowledge_revocation_invalid');
  if(!exists(db,'lia_reviewed_knowledge'))return{revoked:0,restoredCandidates:0};
  return db.transaction(()=>{
    let revoked=0,restoredCandidates=0;
    for(const id of ids){
      const row=db.prepare('SELECT * FROM lia_reviewed_knowledge WHERE id=?').get(id);if(!row||row.status==='revoked')continue;
      if(row.policy_id!==REVIEWED_TEACHING_POLICY||row.approval_actor!==REVIEWED_TEACHING_ACTOR)fail('reviewed_knowledge_revocation_invalid');
      db.prepare("UPDATE lia_reviewed_knowledge SET status='revoked',revoked_at=?,revocation_reason=? WHERE id=? AND status='active'").run(new Date(at).toISOString(),reason,id);
      // Do not reset a rejected, manually reviewed or subsequently edited row.
      const example=db.prepare('SELECT * FROM neural_training_examples WHERE id=?').get(row.example_id);
      if(example?.status==='approved'&&example.review_actor===REVIEWED_TEACHING_ACTOR&&example.review_reason===REVIEWED_TEACHING_POLICY&&example.content_hash===row.example_hash){
        // Expired/withdrawn source packs must still be revocable. Check the
        // original sealed snapshot, not current source eligibility, for rollback.
        const candidate={id:example.id,domain:example.domain,instruction:example.instruction,input:example.input_text,expectedOutput:example.expected_output,source:example.source,sourceId:example.source_id};
        let matches=false;try{matches=seal(row)===row.content_hash&&candidateHash(candidate)===row.example_hash&&example.id===row.example_id&&example.instruction===row.question&&example.expected_output===row.answer;}catch{}
        if(matches)restoredCandidates+=db.prepare("UPDATE neural_training_examples SET status='candidate',review_actor='',review_reason='',updated_at=? WHERE id=? AND status='approved' AND review_actor=? AND content_hash=?").run(new Date(at).toISOString(),row.example_id,REVIEWED_TEACHING_ACTOR,row.example_hash).changes;
      }
      audit(db,'lia_reviewed_knowledge_revoked',id,{policyId:REVIEWED_TEACHING_POLICY,reason},at);revoked++;
    }
    return{revoked,restoredCandidates};
  }).immediate();
}

const stopWords=new Set('a o as os de da do das dos e em um uma para por com que qual quais como onde quando quanto tenho tem fazer quero saber sobre me se na no nas nos ao ela ele isso esta este sao voce voces lia jarvis vitrinecity'.split(' '));
const normalize=value=>String(value??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const words=value=>[...new Set((normalize(value).match(/[a-z0-9]{2,40}/g)||[]).filter(word=>!stopWords.has(word)))].slice(0,32);

/** Runtime retrieval is SELECT-only, including construction and absent tables.
 * No scratch DB, account history, tenant documents, provider calls or approval.
 * Return complete answers as reference DATA, never system/tool instructions. */
export function createReviewedTeachingKnowledge({db,now=Date.now}={}){
  if(!db?.prepare||typeof now!=='function')fail('reviewed_knowledge_config_invalid');
  function retrieve(query){
    if(typeof query!=='string'||query.length>4000)return[];const tokens=words(query);if(!tokens.length)return[];
    try{
      const at=clock(now);if(!exists(db,'lia_reviewed_knowledge')||!exists(db,'neural_training_examples'))return[];
      // Filter to this code-reviewed curriculum before LIMIT. Retained history
      // must neither crowd out current lessons nor widen the retrieval scope.
      const currentIds=[];
      for(const domain of DOMAINS){try{const plan=planFor(domain,at);for(const lesson of plan.lessons)if(!lesson.sourceIds.includes('COINS'))currentIds.push('lia-reviewed-teach-'+lesson.id+'-'+plan.planHash.slice(0,24));}catch{}}
      if(!currentIds.length)return[];
      const rows=db.prepare(`SELECT * FROM lia_reviewed_knowledge WHERE status='active' AND expires_at>? AND policy_id=? AND approval_actor=? AND id IN (${currentIds.map(()=>'?').join(',')}) ORDER BY id LIMIT 50`).all(new Date(at).toISOString(),REVIEWED_TEACHING_POLICY,REVIEWED_TEACHING_ACTOR,...currentIds);
      const ranked=rows.map(row=>{const title=new Set(words(row.question)),body=new Set(words(row.answer)),matches=tokens.filter(t=>title.has(t)||body.has(t));return{row,matches:matches.length,score:matches.reduce((n,t)=>n+(title.has(t)?3:1),0)};}).filter(r=>r.matches>=Math.min(2,tokens.length)).sort((a,b)=>b.score-a.score||a.row.id.localeCompare(b.row.id));
      const result=[];let remaining=1200;
      for(const {row} of ranked){
        try{
          const {candidate,plan}=verifyStored(row,at);
          // Monetary policy remains solely in the canonical platform seed.
          // Use the curriculum allowlist, NOT the teacher's narrower citations.
          if(plan.lessons.find(l=>l.id===row.lesson_id).sourceIds.includes('COINS'))continue;
          const example=checkedCandidate(db,candidate);if(example.status!=='approved'||example.review_actor!==REVIEWED_TEACHING_ACTOR||example.review_reason!==REVIEWED_TEACHING_POLICY)continue;
          if(row.answer.length>remaining)continue;
          result.push({citation:'LK'+(result.length+1),title:row.question.slice(0,160),source:'lia-reviewed-knowledge:'+row.lesson_id,revision:plan.sourceRevision+':'+row.content_hash.slice(0,16),expiresAt:row.expires_at,excerpt:row.answer,trust:'reference-data-only'});
          remaining-=row.answer.length;if(result.length===2)break;
        }catch{/* A stale or inconsistent row is unavailable, never authoritative. */}
      }
      return result;
    }catch{return[];}
  }
  return Object.freeze({retrieve});
}
