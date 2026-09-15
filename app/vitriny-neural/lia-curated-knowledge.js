import {createHash} from 'node:crypto';
import {teachingSources,teachingSourceRevision} from './admin-teaching-sources.js';

export const LIA_CURATED_POLICY='lia-original-reviewed-knowledge-v1';
export const LIA_CURATED_ACTOR='system:lia-curated-publisher';
const SCOPE='lia-curated-knowledge-only';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const sha=value=>createHash('sha256').update(value).digest('hex');
const exists=(db,name)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
const sourceMap=new Map(teachingSources.map(source=>[source.id,source]));
const safeText=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value)&&!/-----BEGIN|\b(?:api[_ -]?key|senha|password|bearer)\s*[:=]/i.test(value);
function clock(now){const at=now();if(!Number.isSafeInteger(at)||at<=0||at>8640000000000000)fail('lia_curated_clock_invalid');return at;}
function table(db){db.exec(`CREATE TABLE IF NOT EXISTS lia_curated_knowledge(
  id TEXT PRIMARY KEY,lesson_id TEXT NOT NULL UNIQUE,domain TEXT NOT NULL,question TEXT NOT NULL,answer TEXT NOT NULL,
  source_ids_json TEXT NOT NULL,source_revision TEXT NOT NULL,report_hash TEXT NOT NULL,review_hash TEXT NOT NULL,
  content_hash TEXT NOT NULL,expires_at TEXT NOT NULL,policy_id TEXT NOT NULL,approval_actor TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','revoked')),created_at TEXT NOT NULL,revoked_at TEXT,revocation_reason TEXT);
  CREATE INDEX IF NOT EXISTS idx_lia_curated_status ON lia_curated_knowledge(status,expires_at);`);}
function seal(row){return sha(canonical({id:row.id,lessonId:row.lesson_id,domain:row.domain,question:row.question,answer:row.answer,sourceIds:JSON.parse(row.source_ids_json),sourceRevision:row.source_revision,reportHash:row.report_hash,reviewHash:row.review_hash,expiresAt:row.expires_at,policyId:row.policy_id,actor:row.approval_actor}));}
function reportShape(report,at){
  if(!plain(report)||report.format!=='vitrinecity-lia-training-revision-report-v1'||report.state!=='completed'||report.externalPublication!==false||report.weightTraining!==false||report.coinDebits!==0||report.targetCount!==9||report.accepted!==9||report.revise!==0||report.providerCalls!==12||!Array.isArray(report.sourceRevisions)||report.sourceRevisions.length!==2||report.sourceRevisions.some(x=>x!==teachingSourceRevision)||!Array.isArray(report.sourcePlanHashes)||report.sourcePlanHashes.length!==2||report.sourcePlanHashes.some(x=>typeof x!=='string'||!/^[a-f0-9]{64}$/.test(x))||!Array.isArray(report.providers)||report.providers.length!==3||!Array.isArray(report.replacements)||report.replacements.length!==9)fail('lia_curated_report_invalid');
  const observed=Date.parse(report.observedAt);if(!Number.isFinite(observed)||observed>at)fail('lia_curated_report_invalid');
  for(const provider of report.providers){
    if(!plain(provider)||!Array.isArray(provider.ids)||provider.ids.length<1||!plain(provider.teacher)||!plain(provider.reviewer))fail('lia_curated_receipt_invalid');
    for(const receipt of [provider.teacher,provider.reviewer])if(receipt.state!=='completed'||receipt.code!==null||typeof receipt.receiptId!=='string'||!/^(?:deepseek|openai):[A-Za-z0-9][A-Za-z0-9_.:-]{1,159}$/.test(receipt.receiptId)||![receipt.chargedMicroBrl,receipt.actualMicroBrl,receipt.actualMicroUsd].every(x=>typeof x==='string'&&/^\d+$/.test(x)))fail('lia_curated_receipt_invalid');
  }
  const seen=new Set();
  for(const item of report.replacements){
    if(!plain(item)||typeof item.id!=='string'||seen.has(item.id)||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,79}$/.test(item.id)||!safeText(item.domain,80)||!safeText(item.question,500)||!safeText(item.newAnswer,900)||!Array.isArray(item.sourceIds)||!item.sourceIds.length||item.sourceIds.some(id=>!sourceMap.has(id)||id==='COINS')||!plain(item.review)||item.review.id!==item.id||item.review.decision!=='accept'||!safeText(item.review.reason,500))fail('lia_curated_item_invalid');
    seen.add(item.id);
  }
  return{observed,seen};
}
function expiryFor(sourceIds){
  const dates=sourceIds.map(id=>sourceMap.get(id)?.expiresAt).filter(value=>typeof value==='string').map(value=>Date.parse(value.length===10?value+'T23:59:59.999Z':value));
  if(dates.length!==sourceIds.length||dates.some(value=>!Number.isFinite(value)))fail('lia_curated_source_invalid');
  return new Date(Math.min(...dates)).toISOString();
}

/** Publish only the report produced by the bounded admin revision runner. */
export function publishLiaTrainingRevision({db,report,authorization,now=Date.now,dryRun=false}={}){
  if(!plain(authorization)||canonical(authorization)!==canonical({policyId:LIA_CURATED_POLICY,scope:SCOPE,confirmed:true}))fail('lia_curated_authorization_required');
  const at=clock(now),{observed}=reportShape(report,at);if(!db?.prepare||!db?.transaction||typeof dryRun!=='boolean')fail('lia_curated_config_invalid');
  const reportHash=sha(canonical(report)),items=report.replacements.map(item=>{
    const expiresAt=expiryFor(item.sourceIds),reviewHash=sha(canonical(item.review)),record={id:'lia-curated-'+item.id,lesson_id:item.id,domain:item.domain,question:item.question,answer:item.newAnswer,source_ids_json:JSON.stringify([...new Set(item.sourceIds)].sort()),source_revision:teachingSourceRevision,report_hash:reportHash,review_hash:reviewHash,expires_at:expiresAt,policy_id:LIA_CURATED_POLICY,approval_actor:LIA_CURATED_ACTOR};
    record.content_hash=seal(record);return{item,record};
  });
  if(new Set(items.map(x=>x.record.id)).size!==items.length)fail('lia_curated_item_invalid');
  if(dryRun)return{policyId:LIA_CURATED_POLICY,actor:LIA_CURATED_ACTOR,accepted:items.length,published:0,duplicates:0,expiresAt:items[0]?.record.expires_at||null,dryRun:true,coinDebits:0,weightTraining:false};
  table(db);let duplicates=0;
  for(const {record} of items){const prior=db.prepare('SELECT * FROM lia_curated_knowledge WHERE id=?').get(record.id);if(prior){if(prior.status!=='active'||prior.content_hash!==record.content_hash||seal(prior)!==prior.content_hash)fail('lia_curated_conflict');duplicates++;}}
  const publish=()=>{let published=0;for(const {record} of items){if(db.prepare('SELECT 1 FROM lia_curated_knowledge WHERE id=?').get(record.id))continue;db.prepare('INSERT INTO lia_curated_knowledge(id,lesson_id,domain,question,answer,source_ids_json,source_revision,report_hash,review_hash,content_hash,expires_at,policy_id,approval_actor,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,\'active\',?)').run(record.id,record.lesson_id,record.domain,record.question,record.answer,record.source_ids_json,record.source_revision,record.report_hash,record.review_hash,record.content_hash,record.expires_at,record.policy_id,record.approval_actor,new Date(at).toISOString());if(exists(db,'neural_audit'))db.prepare('INSERT INTO neural_audit(id,kind,subject_id,actor,details_json,created_at) VALUES(?,?,?,?,?,?)').run(sha(record.id+record.content_hash+at), 'lia_curated_knowledge_published',record.id,LIA_CURATED_ACTOR,JSON.stringify({policyId:LIA_CURATED_POLICY,reportHash,observedAt:new Date(observed).toISOString(),coinDebits:0,weightTraining:false}),new Date(at).toISOString());published++;}return published;};
  const published=db.transaction(publish).immediate();return{policyId:LIA_CURATED_POLICY,actor:LIA_CURATED_ACTOR,accepted:items.length,published,duplicates,expiresAt:items[0]?.record.expires_at||null,dryRun:false,coinDebits:0,weightTraining:false};
}

const stopWords=new Set('a ao as os de da do das dos e em um uma para por com que qual quais como onde quando quanto tenho tem fazer quero saber sobre me se na no nas nos ao ela ele isso esta este sao voce voces lia jarvis vitrinecity video videos venda vendas cidade plataforma'.split(' '));
const words=value=>[...new Set((String(value||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().match(/[a-z0-9]{2,40}/g)||[]).filter(word=>!stopWords.has(word)))].slice(0,32);

/** Read-only runtime provider for the active, sealed curated rows. */
export function createLiaCuratedKnowledge({db,now=Date.now}={}){
  if(!db?.prepare||typeof now!=='function')fail('lia_curated_config_invalid');
  function retrieve(query){
    if(typeof query!=='string'||query.length>4000)return[];const tokens=words(query);if(!tokens.length)return[];
    try{
      const at=clock(now);if(!exists(db,'lia_curated_knowledge'))return[];
      const rows=db.prepare("SELECT * FROM lia_curated_knowledge WHERE status='active' AND policy_id=? AND approval_actor=? AND expires_at>? ORDER BY id LIMIT 100").all(LIA_CURATED_POLICY,LIA_CURATED_ACTOR,new Date(at).toISOString());
      const ranked=rows.map(row=>{if(seal(row)!==row.content_hash)return null;const title=new Set(words(row.question)),body=new Set(words(row.answer)),matches=tokens.filter(token=>title.has(token)||body.has(token));return{row,matches:matches.length,score:matches.reduce((total,token)=>total+(title.has(token)?3:1),0)};}).filter(Boolean).filter(row=>row.matches>=Math.min(2,tokens.length)).sort((a,b)=>b.score-a.score||a.row.id.localeCompare(b.row.id));
      const result=[];let remaining=1200;for(const {row} of ranked){if(row.answer.length>remaining)continue;result.push({citation:'LK'+(result.length+1),title:row.question.slice(0,160),source:'lia-reviewed-knowledge:curated-'+row.lesson_id,revision:row.source_revision+':'+row.content_hash.slice(0,16),expiresAt:row.expires_at,excerpt:row.answer,trust:'reference-data-only'});remaining-=row.answer.length;if(result.length===2)break;}return result;
    }catch{return[];}
  }
  return Object.freeze({retrieve});
}
