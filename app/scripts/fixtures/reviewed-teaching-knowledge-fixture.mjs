// Synthetic local receipts only. No provider adapter is ever invoked.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import {createNeuralDatasetBuilder} from '../../vitriny-neural/dataset-builder.js';
import {teachingSources,teachingSourceRevision} from '../../vitriny-neural/admin-teaching-sources.js';
import {planTeaching,reviewerMessages,validateTeacherResponse} from '../run-admin-teaching-pilot.mjs';
import {hashDeepSeekPaidChatRequest} from '../../vitriny-neural/providers/deepseek-paid-chat.js';
import {hashOpenAiPaidChatRequest} from '../../vitriny-neural/providers/openai-paid-chat.js';
import {REVIEWED_TEACHING_POLICY} from '../../vitriny-neural/reviewed-teaching-knowledge.js';

export const TEACHING_FIXTURE_NOW=Date.parse('2026-09-15T12:00:00.000Z');
const sha=value=>createHash('sha256').update(value).digest('hex');
export function createReviewedTeachingFixture(t,{domains=['platform'],reviseIds=[]}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lia-reviewed-fixture-')),file=path.join(directory,'ledger.sqlite');
  const writer=new Database(file),db=new Database(':memory:'),now=()=>TEACHING_FIXTURE_NOW;
  const builder=createNeuralDatasetBuilder({db,now}),reports=[],ledgerFingerprint=sha(file);
  writer.exec(`CREATE TABLE admin_teaching_pilot_runs(id TEXT PRIMARY KEY,operation_hash TEXT,request_hash TEXT,provider TEXT,model TEXT,role TEXT,state TEXT,
    maximum_micro INTEGER,charged_micro INTEGER,actual_micro INTEGER,actual_usd_micro INTEGER,receipt_id TEXT,input_json TEXT,result_json TEXT,code TEXT,created_at INTEGER,finished_at INTEGER);`);
  function insert(plan,kind,text,messages){
    const provider=kind==='teacher'?'deepseek':'openai',model=kind==='teacher'?'deepseek-flash':'gpt-5.6-luna';
    const id=kind==='teacher'?plan.teacherId:plan.reviewerId+'-plain-text-v1',providerReceiptId='fixture-'+plan.domain+'-'+kind;
    const request={model,messages,maxOutputTokens:8192,...(kind==='reviewer'?{reasoningEffort:'none',requestProfile:'plain-text-v1'}:{})};
    const requestHash=(kind==='teacher'?hashDeepSeekPaidChatRequest:hashOpenAiPaidChatRequest)(request);
    const input={messages,maxOutputTokens:8192,inputBound:Buffer.byteLength(JSON.stringify(messages))+2048,...(kind==='reviewer'?{requestProfile:'plain-text-v1'}:{})};
    const result={ok:true,status:'completed',code:null,finishReason:'stop',text,transportStarted:true,billingDisposition:'reconcile',provider,requestedModel:model,model,
      providerReceiptId,receiptId:provider+':'+providerReceiptId,usage:{known:true,inputTokens:2000,cachedInputTokens:0,outputTokens:500,totalTokens:2500}};
    writer.prepare('INSERT INTO admin_teaching_pilot_runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,sha(JSON.stringify({role:kind,providerId:provider,requestHash})),requestHash,provider,model,kind,'completed',1000,100,100,20,result.receiptId,JSON.stringify(input),JSON.stringify(result),null,TEACHING_FIXTURE_NOW-1000,TEACHING_FIXTURE_NOW-500);
    return{id,state:'completed',code:null,maximumMicroBrl:'1000',chargedMicroBrl:'100',actualMicroBrl:'100',actualMicroUsd:'20',receiptId:result.receiptId};
  }
  for(const domain of domains){
    const plan=planTeaching({domain,sources:teachingSources,sourceRevision:teachingSourceRevision,now});
    const answers=validateTeacherResponse(JSON.stringify({lessons:plan.lessons.map(q=>({id:q.id,answer:'A resposta pública deve respeitar fontes aprovadas, registrar limitações e não executar ações sem autorização.',sourceIds:q.sourceIds}))}),plan);
    const reviews={reviews:plan.lessons.map(q=>({id:q.id,decision:reviseIds.includes(q.id)?'revise':'accept',reason:reviseIds.includes(q.id)?'Revisar este exemplo sintético.':'Parecer sintético compatível com as fontes públicas.'}))};
    const teacher=insert(plan,'teacher',JSON.stringify(answers),plan.teacherMessages),reviewer=insert(plan,'reviewer',JSON.stringify(reviews),reviewerMessages(plan,answers));
    reports.push({format:'vitrinecity-admin-teaching-report-v1',domain,planHash:plan.planHash,ledgerFingerprint,reviewProfile:'plain-text-v1',sourceRevision:teachingSourceRevision,observedAt:new Date(TEACHING_FIXTURE_NOW).toISOString(),state:'completed',approval:'candidate',applied:false,datasetIngested:false,weightTraining:false,teacher,reviewer,validationError:null,lessons:answers.lessons,reviews:reviews.reviews,budget:{synthetic:true}});
    for(const lesson of answers.lessons)builder.createCandidate({id:'teach-'+lesson.id+'-'+plan.planHash.slice(0,24),domain,instruction:plan.lessons.find(q=>q.id===lesson.id).question,
      input:lesson.sourceIds.map(id=>'['+id+'] '+teachingSources.find(s=>s.id===id).body).join('\n\n'),expectedOutput:lesson.answer,source:'lesson',sourceId:(domain==='platform'?'deepseek-awaiting-review:':'deepseek-openai-candidate:')+lesson.id+':'+plan.planHash,actor:'fixture-author'});
  }
  const ledgerDb=new Database(file,{readonly:true,fileMustExist:true});
  const authorization={policyId:REVIEWED_TEACHING_POLICY,scope:'lia-reviewed-knowledge-only',confirmed:true};
  const options={db,ledgerDb,ledgerFingerprint,reports,authorization,now};
  t.after(()=>{ledgerDb.close();writer.close();db.close();assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('lia-reviewed-fixture-'));fs.rmSync(directory,{recursive:true,force:true});});
  return{db,ledgerDb,writer,reports,authorization,ledgerFingerprint,now,options,builder};
}
