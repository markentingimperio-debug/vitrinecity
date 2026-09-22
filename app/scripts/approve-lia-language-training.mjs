import Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {createNeuralDatasetBuilder} from '../vitriny-neural/dataset-builder.js';
import {liaLanguageTrainingCases as cases,liaLanguageTrainingProvenance as provenance} from './fixtures/lia-language-training-cases.mjs';

const database=process.argv.find(value=>value.startsWith('--database='))?.slice(11);
const confirmed=process.argv.includes('--confirm-owner-approval');
if(!database||!path.isAbsolute(database))throw new Error('absolute_database_path_required');
if(!confirmed)throw new Error('explicit_owner_approval_required');

const hash=value=>createHash('sha256').update(String(value)).digest('hex');
const expectedHash=item=>hash(JSON.stringify({domain:item.domain,instruction:item.instruction,input:item.input,expectedOutput:item.expectedOutput,...provenance}));
const db=new Database(database),builder=createNeuralDatasetBuilder({db,nodeId:'lia-language-eval-v1'});
let approved=0,alreadyApproved=0;
try{
  db.transaction(()=>{
    for(const expected of cases){
      const item=builder.get(expected.id);
      if(!item||item.contentHash!==expectedHash(expected)||item.source!==provenance.source||item.sourceId!==provenance.sourceId)throw new Error('language_candidate_integrity_invalid');
      if(item.status==='approved'){alreadyApproved++;continue;}
      if(item.status!=='candidate')throw new Error('language_candidate_not_approvable');
      builder.review(item.id,{status:'approved',actor:'owner-approval-20260922',reason:'Avaliação linguística aprovada: regressões, contexto e falso positivo passaram nos testes independentes.',confirmed:true});
      approved++;
    }
  }).immediate();
  const dataset=builder.exportDataset({split:'all'}),status=builder.status();
  console.log(JSON.stringify({approved,alreadyApproved,published:cases.length,datasetId:dataset.datasetId,totalApproved:dataset.totalApproved,status}));
}finally{db.close();}
