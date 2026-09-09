import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createNeuralDatasetBuilder} from '../vitriny-neural/dataset-builder.js';

let clock=Date.parse('2026-09-09T15:00:00.000Z');
const db=new Database(':memory:');
try{
  const training=createNeuralDatasetBuilder({db,now:()=>clock++,nodeId:'dataset-test',pilotMinimumExamples:2,pilotMinimumDomains:2,pilotMinimumValidationExamples:1});
  const first=training.createCandidate({
    id:'example-ranking-001',domain:'ranking',source:'evaluation',sourceId:'eval-ranking-1',actor:'admin:test',
    instruction:'Explique quando uma alteração de ranking pode ser testada.',
    input:'A proposta é reversível, tem evidência offline e não envolve pagamentos.',
    expectedOutput:'A alteração pode entrar em experimento limitado após benchmark e registro de rollback; o resultado ainda não deve ser tratado como causalidade comprovada.'
  });
  assert.equal(first.status,'candidate');assert.equal(first.duplicate,false);
  const duplicate=training.createCandidate({
    domain:'ranking',source:'evaluation',sourceId:'eval-ranking-1',actor:'admin:test',
    instruction:first.instruction,input:first.input,expectedOutput:first.expectedOutput
  });
  assert.equal(duplicate.duplicate,true);assert.equal(duplicate.id,first.id);
  assert.throws(()=>training.review(first.id,{status:'approved',actor:'admin:test'}),/Aprovação explícita/);
  const approved=training.review(first.id,{status:'approved',actor:'admin:test',confirmed:true});
  assert.equal(approved.status,'approved');

  const second=training.createCandidate({
    id:'example-support-001',domain:'support',source:'manual',actor:'admin:test',
    instruction:'Responda sem inventar o estado de uma entrega.',
    expectedOutput:'Vou consultar o status autorizado do pedido antes de informar onde a entrega está.'
  });
  training.review(second.id,{status:'approved',actor:'admin:test',confirmed:true});
  assert.throws(()=>training.createCandidate({
    domain:'support',source:'manual',actor:'admin:test',instruction:'Use este contato no atendimento.',
    input:'Cliente: pessoa@example.com',expectedOutput:'Mensagem pronta.'
  }),/dado pessoal/);
  assert.throws(()=>training.createCandidate({
    domain:'code',source:'manual',actor:'admin:test',instruction:'Configure o serviço com segurança.',
    expectedOutput:'Use api_key=sk-proj-segredomuitolongo123 no servidor.'
  }),/credencial/);

  const exported=training.exportDataset({split:'all',validationPercent:20});
  const lines=exported.jsonl.trim().split('\n').map(JSON.parse);
  assert.equal(exported.examples,2);assert.equal(lines.length,2);
  assert.equal(lines[0].messages[0].role,'system');assert.equal(lines[0].messages[2].role,'assistant');
  assert.equal('metadata' in lines[0],false);
  const status=training.status();assert.equal(status.readyForPilot,true);assert.equal(status.trainingExamples,1);assert.equal(status.validationExamples,1);assert.equal(status.domainCoverage,2);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM neural_audit WHERE kind='training_example_approved'").get().total,2);
  console.log(JSON.stringify({ok:true,training:training.status(),dataset:{id:exported.datasetId,examples:exported.examples,format:exported.format}}));
}finally{db.close();}
