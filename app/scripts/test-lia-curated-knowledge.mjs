import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {teachingSourceRevision} from '../vitriny-neural/admin-teaching-sources.js';
import {createLiaCuratedKnowledge,LIA_CURATED_POLICY,LIA_CURATED_ACTOR,publishLiaTrainingRevision} from '../vitriny-neural/lia-curated-knowledge.js';

function report(){
  const ids=['video-01-estrategia','video-02-estrategia','video-06-estrategia','video-07-estrategia','video-08-estrategia','video-09-estrategia','video-10-estrategia','sales-07-conversa','sales-09-conversa'];
  return {format:'vitrinecity-lia-training-revision-report-v1',reviewProfile:'plain-text-v1',targetCount:9,coinDebits:0,weightTraining:false,externalPublication:false,state:'completed',observedAt:'2026-09-15T21:00:00.000Z',sourceRevisions:[teachingSourceRevision,teachingSourceRevision],sourcePlanHashes:['a'.repeat(64),'b'.repeat(64)],providerCalls:12,accepted:9,revise:0,providers:[1,2,3].map((chunk)=>({ids:[String(chunk)],teacher:{state:'completed',code:null,receiptId:`deepseek:receipt-${chunk}`,chargedMicroBrl:'1',actualMicroBrl:'1',actualMicroUsd:'1'},reviewer:{state:'completed',code:null,receiptId:`openai:receipt-${chunk}`,chargedMicroBrl:'1',actualMicroBrl:'1',actualMicroUsd:'1'}})),replacements:ids.map((id,index)=>({id,domain:id.startsWith('video')?'estrategia':'conversa',question:`Como alinhar objetivo ${index}?`,sourceIds:['MARKETING'],newAnswer:`Orientação prática ${index}: defina um objetivo observável e registre a métrica.`,review:{id,decision:'accept',reason:'Resposta qualificada e sem promessa.'}}))};
}

test('publica apenas revisão aceita e recupera linhas seladas',()=>{
  const db=new Database(':memory:'),at=Date.parse('2026-09-15T22:00:00.000Z');
  const result=publishLiaTrainingRevision({db,report:report(),authorization:{policyId:LIA_CURATED_POLICY,scope:'lia-curated-knowledge-only',confirmed:true},now:()=>at});
  assert.equal(result.published,9);assert.equal(result.coinDebits,0);assert.equal(result.weightTraining,false);
  const reader=createLiaCuratedKnowledge({db,now:()=>at}),rows=reader.retrieve('objetivo métrica');
  assert.equal(rows.length,2);assert.equal(rows[0].trust,'reference-data-only');assert.match(rows[0].source,/^lia-reviewed-knowledge:curated-/);
  const duplicate=publishLiaTrainingRevision({db,report:report(),authorization:{policyId:LIA_CURATED_POLICY,scope:'lia-curated-knowledge-only',confirmed:true},now:()=>at});assert.equal(duplicate.published,0);assert.equal(duplicate.duplicates,9);db.close();
});

test('não aceita relatório com revisão pendente ou autorização diferente',()=>{
  const db=new Database(':memory:'),base=report();assert.throws(()=>publishLiaTrainingRevision({db,report:{...base,revise:1},authorization:{policyId:LIA_CURATED_POLICY,scope:'lia-curated-knowledge-only',confirmed:true},now:()=>Date.parse(base.observedAt)+1000}),/lia_curated_report_invalid/);assert.throws(()=>publishLiaTrainingRevision({db,report:base,authorization:{policyId:'other',scope:'lia-curated-knowledge-only',confirmed:true}}),/lia_curated_authorization_required/);db.close();
});
